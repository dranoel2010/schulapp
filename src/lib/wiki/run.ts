import { db } from "@/db";
import { users } from "@/db/schema";
import { berlinDay, todayInBerlin } from "@/lib/dates";
import { collectDocuments } from "@/lib/wiki/collect";
import {
  listDeliveries,
  recordDeliveries,
  type DeliveredDocument,
} from "@/lib/wiki/deliveries";
import { documentHash, type WikiDocument } from "@/lib/wiki/documents";
import { assertHandoverRoot, writeHandover } from "@/lib/wiki/folder";
import { countByKind, manifestText, type WikiRemoval } from "@/lib/wiki/manifest";

/**
 * Der Lauf: einmal am Tag alles vergleichen und abliefern, was sich
 * unterscheidet.
 *
 * Die Reihenfolge der Schritte ist die ganze Sicherung dieser Stufe, und sie
 * ist in dieser und keiner anderen Folge richtig:
 *
 *   1. **Wurzelordner prüfen.** Immer, auch wenn hinterher nichts zu tun ist.
 *   2. **Bestand zusammentragen** und mit `wiki_deliveries` vergleichen — je
 *      Nutzer, im Speicher, ohne etwas zu schreiben.
 *   3. **Alles in einen unfertigen Ordner schreiben** und ihn in EINEM Schritt
 *      an seinen Platz umbenennen (siehe @/lib/wiki/folder).
 *   4. **Erst danach** die Abdrücke festhalten und die Zeilen der gelöschten
 *      Dinge vergessen.
 *
 * Bricht der Lauf zwischen 2 und 3 ab, ist nichts passiert. Bricht er zwischen
 * 3 und 4 ab, liegt der Ordner da und die App weiß nichts davon: der nächste
 * Lauf liefert dieselben Dateien noch einmal, unter denselben Kennungen, und
 * der Agent legt sie übereinander. Das ist die Richtung, in die dieser Vorgang
 * irren darf. Andersherum — Abdrücke zuerst — entstünde eine Lücke im Vault,
 * die nie wieder auffiele.
 *
 * ── Warum kein `after()` und kein `maxDuration` ──────────────────────────────
 *
 * Beides gäbe es in Next 16, und beides wäre hier falsch.
 *
 * `after()` schickt die Antwort ab und arbeitet danach weiter. Genau das darf
 * dieser Lauf nicht: Seine Antwort IST der Bericht — wie viele Dateien neu
 * sind, was entfallen ist, ob etwas schiefging. Mit `after()` stünde in der
 * Antwort immer nur „angefangen", und der Aufgabenplaner auf dem NAS, dessen
 * einziger Rückkanal diese Antwort ist, meldete jeden Tag Erfolg. Dazu kommt,
 * dass `after()` gar keine Frist verlängert: „after will run for the platform's
 * default or configured max duration of your route" steht in
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md.
 *
 * `maxDuration` wird laut
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/02-route-segment-config/maxDuration.md
 * von der PLATTFORM aus dem Build gelesen — „Deployment platforms can use
 * maxDuration from the Next.js build output". Die App läuft seit dem 30.8.2026
 * als `next start` in einem Container auf dem NAS; dort liest das niemand, die
 * Zahl täte also nichts und behauptete trotzdem, die Frist sei bedacht. Auf
 * Vercel wäre sie kein Trost, sondern der Grund, warum dieser Lauf dort nicht
 * hingehört: im Hobby-Tarif sind 60 Sekunden das Ende, und ein höherer Wert
 * lässt schon das Deployment scheitern.
 *
 * Deshalb ruft den Lauf der DSM-Aufgabenplaner und nicht GitHub Actions — die
 * Schritte dafür stehen im Route Handler. Der Lauf selbst rechnet nicht mit
 * einer Frist: Ein voller erster Durchgang liest ein Schuljahr und schreibt ein
 * paar hundert kleine Dateien; danach ist er ein Vergleich über denselben
 * Bestand und ein Ordner mit einer Handvoll Dateien darin.
 */

/** Der Name der Umgebungsvariablen mit dem Übergabeordner. */
export const WIKI_EXPORT_DIR_ENV = "WIKI_EXPORT_DIR";

/**
 * Wohin die Übergabe geschrieben wird — oder `null`, wenn es niemand gesagt
 * hat.
 *
 * Der Pfad steht in einer Umgebungsvariablen und nicht im Code, weil er nur auf
 * dem NAS existiert: Der Vault liegt dort, und wo genau, weiß dieses Repo nicht
 * und soll es nicht wissen. Dieselbe Entscheidung wie bei `DATABASE_URL` und
 * den VAPID-Schlüsseln.
 *
 * Ein leerer oder nur aus Leerzeichen bestehender Wert gilt als nicht gesetzt.
 * `WIKI_EXPORT_DIR=` in einer `.env` ist ein Tippfehler und kein Auftrag, in
 * das Arbeitsverzeichnis zu schreiben.
 */
export function wikiExportRoot(): string | null {
  const wert = process.env[WIKI_EXPORT_DIR_ENV]?.trim();

  return wert ? wert : null;
}

/** Was ein Lauf getan hat — zugleich der Text der Antwort des Route Handlers. */
export type WikiRunSummary = {
  /** Kalendertag des Laufs in Berliner Zeit. */
  date: string;
  /** Der geschriebene Ordner; `null` heißt: es gab nichts zu übergeben. */
  folder: string | null;
  /** Wie viele Nutzer angesehen wurden. */
  users: number;
  /** Wie viele davon nicht sauber durchliefen — ihr Bestand bleibt unberührt. */
  failed: number;
  neu: number;
  geaendert: number;
  entfallen: number;
  unveraendert: number;
};

/** Ein Dokument mit seinem Abdruck und der Auskunft, ob es das erste Mal geht. */
type PlannedDocument = DeliveredDocument & { neu: boolean };

/** Was für einen Nutzer zu tun ist, bevor irgendetwas geschrieben wurde. */
type UserPlan = {
  userId: string;
  /** Neu und geändert — nur diese Dateien kommen in den Ordner. */
  written: PlannedDocument[];
  removed: WikiRemoval[];
  unveraendert: number;
  /** Der ganze Bestand, für die Bestandsübersicht im MANIFEST. */
  bestand: WikiDocument[];
};

export async function runWikiHandover(input: {
  root: string;
  /** Nur für Proben; sonst gilt der heutige Tag in Berlin. */
  today?: string;
}): Promise<WikiRunSummary> {
  const date = input.today ?? todayInBerlin();

  // Vor allem anderen: Gibt es den Ordner überhaupt? Ein „nichts zu übergeben"
  // aus einem Lauf, dessen Vault nicht eingehängt war, sähe aus wie ein ruhiger
  // Tag und wäre eine ausgefallene Übergabe.
  await assertHandoverRoot(input.root);

  const alle = await db.select({ id: users.id }).from(users);
  const plans: UserPlan[] = [];
  let failed = 0;

  for (const user of alle) {
    try {
      plans.push(await planForUser(user.id));
    } catch (fehler) {
      // Ein Nutzer mit kaputten Daten darf den Lauf nicht abbrechen — dieselbe
      // Entscheidung wie in der Erinnerungsroute. Sein Bestand bleibt dabei
      // unberührt: Er steht in keinem Plan, also wird von ihm nichts
      // geschrieben und nichts als entfallen gemeldet.
      failed += 1;
      console.error("Wiki-Übergabe fehlgeschlagen", user.id, fehler);
    }
  }

  const written = plans.flatMap((plan) => plan.written);
  const entfallen = plans.flatMap((plan) => plan.removed);
  const unveraendert = plans.reduce((summe, plan) => summe + plan.unveraendert, 0);

  const summary: WikiRunSummary = {
    date,
    folder: null,
    users: alle.length,
    failed,
    neu: written.filter((eintrag) => eintrag.neu).length,
    geaendert: written.filter((eintrag) => !eintrag.neu).length,
    entfallen: entfallen.length,
    unveraendert,
  };

  // Kein Ordner an einem Tag, an dem sich nichts geändert hat. Ein leerer
  // Übergabeordner wäre für den Agenten Arbeit ohne Inhalt — und nach einem
  // Schuljahr lägen zweihundert davon im Vault.
  if (written.length === 0 && entfallen.length === 0) return summary;

  const documents = written.map((eintrag) => eintrag.document);
  const bestand = countByKind(plans.flatMap((plan) => plan.bestand));

  const ergebnis = await writeHandover({
    root: input.root,
    date,
    documents,
    manifest: (folder) =>
      manifestText({
        date,
        folder,
        neu: written.filter((e) => e.neu).map((e) => e.document),
        geaendert: written.filter((e) => !e.neu).map((e) => e.document),
        entfallen,
        unveraendert,
        bestand,
      }),
  });

  // Ab hier steht der Ordner. Alles Folgende darf schiefgehen, ohne dass etwas
  // verloren ist — der nächste Lauf liefert dann dieselben Dateien noch einmal.
  const deliveredAt = new Date();

  for (const plan of plans) {
    try {
      await recordDeliveries({
        userId: plan.userId,
        folder: ergebnis.folder,
        deliveredAt,
        written: plan.written,
        removed: plan.removed.map((eintrag) => eintrag.id),
      });
    } catch (fehler) {
      failed += 1;
      console.error("Wiki-Übergabe nicht festgehalten", plan.userId, fehler);
    }
  }

  return { ...summary, folder: ergebnis.folder, failed };
}

/**
 * Was für einen Nutzer zu übergeben ist — ohne dabei etwas zu schreiben.
 *
 * Der Vergleich ist stumpf und soll es sein: Bekannt und derselbe Abdruck heißt
 * unverändert, bekannt und ein anderer Abdruck heißt geändert, unbekannt heißt
 * neu. Was in `wiki_deliveries` steht und in diesem Bestand nicht mehr
 * vorkommt, ist gelöscht.
 *
 * Der letzte Schluss ist der einzige gefährliche, denn er stützt sich auf eine
 * ABWESENHEIT — und eine unvollständige Liste sähe aus wie viele Löschungen.
 * Deshalb dreht `collectDocuments()` jede Decke, und deshalb wird ein Nutzer,
 * bei dem das Zusammentragen wirft, ganz übersprungen statt halb ausgeliefert.
 */
async function planForUser(userId: string): Promise<UserPlan> {
  const bestand = await collectDocuments(userId);
  assertUniqueIds(bestand);

  const bekannt = await listDeliveries(userId);
  const written: PlannedDocument[] = [];
  const gesehen = new Set<string>();
  let unveraendert = 0;

  for (const document of bestand) {
    gesehen.add(document.id);

    const hash = documentHash(document.text);
    const zeile = bekannt.get(document.id);

    if (zeile && zeile.hash === hash) {
      unveraendert += 1;
      continue;
    }

    written.push({ document, hash, neu: zeile === undefined });
  }

  const removed: WikiRemoval[] = [];

  for (const zeile of bekannt.values()) {
    if (gesehen.has(zeile.docId)) continue;

    removed.push({
      id: zeile.docId,
      // Die Art steht in der Zeile und wird nicht aus der Kennung
      // herausgeschnitten. Eine Zeile mit einer Art, die es im Code nicht mehr
      // gibt, wird trotzdem gemeldet — sie soll aus dem Vault verschwinden,
      // gerade weil niemand mehr weiß, was sie war.
      kind: zeile.kind as WikiRemoval["kind"],
      title: zeile.title,
      folder: zeile.folder,
      deliveredOn: berlinDay(zeile.deliveredAt),
    });
  }

  return { userId, written, removed, unveraendert, bestand };
}

/**
 * Zwei Dokumente mit derselben Kennung wären ein Fehler im Zusammentragen — und
 * einer, der still bliebe: Das zweite überschriebe im Ordner das erste, im
 * MANIFEST stünden beide, und in `wiki_deliveries` gewönne der Abdruck des
 * zuletzt geschriebenen. Danach wechselte die Datei bei jedem Lauf ihren Inhalt
 * und läge jeden Tag im Übergabeordner.
 */
function assertUniqueIds(documents: readonly WikiDocument[]): void {
  const gesehen = new Set<string>();

  for (const document of documents) {
    if (gesehen.has(document.id)) {
      throw new Error(`Die Kennung ${document.id} kommt zweimal vor.`);
    }

    gesehen.add(document.id);
  }
}
