import { timingSafeEqual } from "node:crypto";

import {
  WIKI_EXPORT_DIR_ENV,
  runWikiHandover,
  wikiExportRoot,
  type WikiRunSummary,
} from "@/lib/wiki/run";

/**
 * Die tägliche Übergabe an das Wiki.
 *
 * Einmal am Tag legt die App alles, was sich seit gestern geändert hat, in
 * einen flachen, datierten Ordner neben dem Obsidian-Vault. Ein eigener Agent
 * räumt es von dort ein. Was in den Dateien steht und warum, steht in
 * @/lib/wiki/documents; wie ein Abbruch mittendrin ausgeht, in @/lib/wiki/run.
 *
 * Hier steht nur die Tür: die Anmeldung, die Umgebungsvariable und die
 * Antwort. Fachlogik gehört nach @/lib und nicht in einen Route Handler.
 *
 * Kein Cookie, sondern "Authorization: Bearer <CRON_SECRET>" — dasselbe
 * Geheimnis und dieselbe Prüfung wie in /api/cron/reminders.
 *
 * ── ⚠ WAS AUF DEM NAS EINGETRAGEN WERDEN MUSS ───────────────────────────────
 *
 * Drei Dinge, und ohne alle drei tut diese Route nichts.
 *
 * **1. Der Vault muss IM CONTAINER liegen.** Die App schreibt aus dem
 * Container heraus; ein Pfad, den nur DSM kennt, ist für sie nicht da. In der
 * docker-compose.yml auf dem NAS (die liegt nur dort, nicht im Repo) beim
 * Dienst `app`:
 *
 *   volumes:
 *     - /volume1/wiki/Schulapp/Übergabe:/uebergabe
 *   environment:
 *     WIKI_EXPORT_DIR: /uebergabe
 *
 * Der Ordner muss existieren und dem Benutzer gehören, unter dem der Server
 * läuft — das Dockerfile lässt ihn als `node` laufen und nicht als root. Ein
 * Ordner, der root gehört, quittiert das mit „EACCES", und die Übergabe fällt
 * jede Nacht aus. Angelegt wird er ausdrücklich NICHT von der App: ein
 * fehlender Ordner heißt meistens, dass der Vault gerade nicht eingehängt ist,
 * und dann soll nichts geschrieben werden (siehe @/lib/wiki/folder).
 *
 * **2. Der Aufgabenplaner in DSM.** Nicht GitHub Actions wie bei den
 * Erinnerungen, und das ist der Unterschied: Der Planer auf dem NAS läuft
 * unabhängig von GitHub und vom Tailscale Funnel — er ruft von innen an, also
 * auch dann, wenn draußen etwas klemmt. Und er kennt die Frist nicht, an der
 * `curl` im Workflow abbräche; ein erster, vollständiger Lauf über ein
 * Schuljahr darf hier Minuten dauern.
 *
 *   DSM → Systemsteuerung → Aufgabenplaner → Erstellen → Geplante Aufgabe
 *        → Benutzerdefiniertes Skript
 *
 *   Allgemein:   Aufgabenname „Schulapp Wiki-Übergabe", Benutzer `root`
 *                (er darf die `.env` lesen), Aktiviert angehakt.
 *   Zeitplan:    Täglich, 03:30 Uhr. Nachts, weil ein voller Lauf die
 *                Datenbank eine Weile beschäftigt — und weil der Agent das
 *                Wiki morgens vorfinden soll.
 *   Aufgabeneinstellungen: „Details zum Ausführungsergebnis per E-Mail senden"
 *                anhaken. Das ist der einzige Rückkanal: Was hier als Antwort
 *                herauskommt, ist der Bericht des Laufs, und
 *                `curl --fail-with-body` macht aus einem Fehlschlag eine
 *                fehlgeschlagene Aufgabe — ohne den Bericht wegzuwerfen.
 *   Benutzerdefiniertes Skript:
 *
 *     set -a; . /volume1/docker/schulapp/.env; set +a
 *     curl --fail-with-body -sS --max-time 3600 \
 *          -H "Authorization: Bearer $CRON_SECRET" \
 *          http://localhost:3000/api/cron/wiki
 *
 * `--fail-with-body` und nicht das kürzere `-f`: Beide machen aus einem
 * Fehlerstatus einen Rückgabewert ungleich null, aber `-f` verwirft dabei den
 * Antwortkörper. In der DSM-Mail stünde dann nur „curl: (22) The requested URL
 * returned error: 500" — und gerade NICHT der Satz, der sagt, was zu tun ist.
 * Genau auf diesen Satz beruft sich die Begründung unten an der
 * `WIKI_EXPORT_DIR`-Prüfung; mit `-f` war sie all die Zeit eine Zusage, die
 * das Skript nicht einlöste. Den Schalter gibt es seit curl 7.76 (2021). Ist
 * der auf dem NAS älter, tut es `-fsS` weiterhin — die Aufgabe schlägt dann
 * genauso fehl, nur ohne die Erklärung dazu.
 *
 * Die Adresse ist die, unter der der Container vom NAS aus erreichbar ist —
 * nachsehen mit `sudo docker compose ps`, falls der Port dort anders
 * veröffentlicht ist. Der öffentliche Funnel-Name wäre der Umweg über draußen
 * und genau das, was hier vermieden werden soll.
 *
 * **3. `CRON_SECRET`** steht schon in der `.env` auf dem NAS — es ist dasselbe,
 * mit dem die Erinnerungen laufen. Ein zweites wäre ein zweites, das jemand
 * vergisst zu drehen.
 *
 * Von Hand anstoßen (die Route ist gefahrlos mehrfach aufrufbar: der zweite
 * Lauf eines Tages findet fast nichts zu tun und legt gar keinen Ordner an):
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/wiki
 *
 * ── Wenn der Vault umzieht oder verloren geht ───────────────────────────────
 *
 * Die App merkt sich, WAS sie geliefert hat, und nicht, wohin. Zeigt
 * `WIKI_EXPORT_DIR` auf einen anderen, leeren Ordner, hält sie alles für längst
 * abgeliefert und schreibt dorthin nichts mehr — wer umzieht, nimmt den Inhalt
 * mit. Wer den vollständigen Bestand noch einmal haben will, leert das
 * Gedächtnis:
 *
 *   sudo docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
 *     -c 'delete from wiki_deliveries;'
 *
 * Der nächste Lauf übergibt danach alles, so wie der allererste. Daten gehen
 * dabei keine verloren; in der Tabelle stehen nur Abdrücke.
 *
 * ── Wann die Aufgabe in DSM rot wird ────────────────────────────────────────
 *
 * Bei jedem 500, und die gibt es in drei Farben: `CRON_SECRET` fehlt,
 * `WIKI_EXPORT_DIR` fehlt oder der Ordner ist nicht da (dann wirft der Lauf),
 * und — der stille Fall — der Lauf kam durch, hat aber KEINEN Ordner
 * geschrieben, obwohl mindestens ein Konto unterwegs gescheitert ist. Warum
 * gerade diese Bedingung, steht bei `handoverFailure()` weiter unten.
 *
 * Grün und trotzdem kein Ordner ist dagegen der Normalfall: an einem Tag, an
 * dem sich nichts geändert hat, gibt es nichts zu übergeben.
 *
 * ── Warum hier kein `after()` und kein `maxDuration` steht ───────────────────
 *
 * Weil die Antwort der Bericht ist und der Aufgabenplaner keine Frist setzt.
 * Ausführlich steht die Begründung samt den Stellen in der Next-Doku am Kopf
 * von @/lib/wiki/run.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET fehlt." },
      { status: 500 },
    );
  }

  if (!isAuthorized(request, secret)) {
    return Response.json({ ok: false, error: "Nicht erlaubt." }, { status: 401 });
  }

  const root = wikiExportRoot();

  // Nicht als „ok, aber nichts zu tun" beantwortet, sondern als Fehler. Ein
  // grüner Lauf, der jede Nacht nichts tut, ist die Antwort, die niemandem
  // auffällt — und die Übergabe fiele monatelang aus, ohne dass es jemand
  // merkt. `curl --fail-with-body` macht daraus im Aufgabenplaner eine
  // fehlgeschlagene Aufgabe, und DSM schickt eine Mail mit genau diesem Satz
  // darin.
  if (!root) {
    return Response.json(
      {
        ok: false,
        error: `${WIKI_EXPORT_DIR_ENV} ist nicht gesetzt — ohne den Pfad zum Übergabeordner gibt es nichts zu schreiben. Er gehört in die Umgebung des Containers, und der Ordner muss dort eingehängt sein.`,
      },
      { status: 500 },
    );
  }

  try {
    const summary = await runWikiHandover({ root });
    const gescheitert = handoverFailure(summary);

    // Derselbe Grundsatz wie zwanzig Zeilen weiter oben, nur für den Fall, den
    // die Datei sich bis hierher selbst durchgehen ließ: Ein Lauf, der nichts
    // übergeben hat, wird nicht als Erfolg gemeldet.
    if (gescheitert) {
      console.error("Wiki-Übergabe ohne Ergebnis", summary);

      return Response.json(
        { ok: false, error: gescheitert, ...summary },
        { status: 500 },
      );
    }

    return Response.json({ ok: true, ...summary });
  } catch (fehler) {
    // Der Satz aus dem Fehler ist die eigentliche Auskunft — „Den
    // Übergabeordner gibt es nicht: /uebergabe" sagt in der DSM-Mail alles,
    // was zu tun ist. Ohne dieses Auffangen stünde dort eine HTML-Seite mit
    // einem Serverfehler und der Satz im Container-Protokoll.
    console.error("Wiki-Übergabe abgebrochen", fehler);

    return Response.json(
      {
        ok: false,
        error:
          fehler instanceof Error
            ? fehler.message
            : "Die Wiki-Übergabe ist abgebrochen.",
      },
      { status: 500 },
    );
  }
}

/**
 * Muss dieser Lauf als Fehlschlag gemeldet werden — und mit welchem Satz?
 *
 * `null` heißt: als Erfolg melden. Sonst ist die Zeichenkette der Satz, der in
 * die Antwort und damit in die DSM-Mail gehört.
 *
 * ── Der Fehler, den diese Funktion behebt ────────────────────────────────────
 *
 * Hier stand vorher `return Response.json({ ok: true, ...summary })`, ohne
 * einen Blick auf `summary.failed`. Nachgemessen: Wirft `planForUser()` — und
 * dafür reicht eine einzige Abfrage in `collectDocuments()`, die Schranke
 * darin oder `assertUniqueIds()` —, dann zählt @/lib/wiki/run `failed += 1`,
 * überspringt das Konto und macht weiter. Bei einem einzigen Konto bleibt
 * `plans` damit leer, `written` und `entfallen` sind leer, der Lauf kehrt vor
 * `writeHandover()` zurück, und die Antwort lautete: HTTP 200 mit
 * `{"ok":true,"folder":null,"users":1,"failed":1}`. Das `curl -fsS` des
 * Aufgabenplaners endete also mit 0, DSM verbuchte die Aufgabe als erfolgreich
 * und schickte eine Mail mit der Überschrift „Erfolg" — während im Vault seit
 * Wochen nichts mehr ankam. Genau die Antwort, die diese Datei zwanzig Zeilen
 * über der Stelle für das fehlende `WIKI_EXPORT_DIR` ausdrücklich verwirft:
 * „Ein grüner Lauf, der jede Nacht nichts tut, ist die Antwort, die niemandem
 * auffällt."
 *
 * ── Warum `folder === null` dazugehört ───────────────────────────────────────
 *
 * `failed > 0` allein wäre zu scharf. In @/lib/wiki/run wird zweimal gezählt,
 * und die beiden Zählungen bedeuten Verschiedenes:
 *
 *   - In der ERSTEN Schleife (`planForUser()`) heißt `failed`: von diesem
 *     Konto wurde nichts zusammengetragen und deshalb auch nichts geschrieben.
 *   - In der ZWEITEN Schleife (`recordDeliveries()`) heißt `failed`: der
 *     Ordner steht schon, nur der Abdruck in `wiki_deliveries` fehlt. Das ist
 *     laut dem Kopfkommentar von @/lib/wiki/run die Richtung, in die dieser
 *     Vorgang irren DARF — der nächste Lauf liefert dieselben Dateien unter
 *     denselben Kennungen noch einmal, und der Agent legt sie übereinander.
 *     Ein 500 dafür wäre ein Fehlalarm für einen Zustand, der sich selbst
 *     heilt.
 *
 * Die zweite Schleife läuft nur, wenn ein Ordner geschrieben wurde. `folder
 * === null && failed > 0` trifft deshalb ausschließlich den ersten Fall.
 *
 * ── Was diese Bedingung NICHT sieht ──────────────────────────────────────────
 *
 * Ein Teilausfall bei mehreren Konten: Scheitert eines von dreien, steht der
 * Ordner trotzdem, und der Lauf bleibt grün, obwohl von einem Konto nichts
 * übergeben wurde. Unterscheiden ließe sich das nur, wenn `WikiRunSummary` die
 * beiden Zählungen getrennt führte — das ist eine Änderung an @/lib/wiki/run
 * und gehört nicht hierher. Die App hat heute genau ein Konto; dort ist
 * „nichts geschrieben und etwas gescheitert" immer der Totalausfall.
 *
 * Ein Lauf ohne Ordner und ohne Fehler bleibt ausdrücklich grün: das ist der
 * Tag, an dem sich nichts geändert hat, und dafür wird kein Ordner angelegt.
 */
export function handoverFailure(summary: WikiRunSummary): string | null {
  if (summary.failed === 0 || summary.folder !== null) return null;

  const konten = `${summary.failed} von ${summary.users} ${
    summary.users === 1 ? "Konto" : "Konten"
  }`;

  // Der Satz nennt Zahlen und den Weg zum Grund, aber nicht den Grund selbst:
  // Der geworfene Fehler wird in @/lib/wiki/run gefangen und protokolliert,
  // und die Zusammenfassung bringt ihn nicht mit. Ihn hierher durchzureichen
  // hieße, `WikiRunSummary` zu erweitern — dieselbe Änderung an einer fremden
  // Datei, die oben schon ausgeschlossen ist. Der Verweis aufs Protokoll ist
  // dafür der ehrliche Ersatz.
  return (
    `Kein Übergabeordner geschrieben: Bei ${konten} ist das Zusammentragen gescheitert. ` +
    "Heute ist nichts im Vault angekommen. Woran es lag, steht im Protokoll des " +
    'Containers — „sudo docker compose logs app | grep Wiki-Übergabe".'
  );
}

/**
 * Zeichenweise gleich lange Prüfung, damit sich das Geheimnis nicht über die
 * Antwortzeit erraten lässt. Wortgleich zu /api/cron/reminders — zwei Türen,
 * eine Prüfung, und sie darf an der einen nicht schwächer sein als an der
 * anderen.
 */
function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length) return false;

  return timingSafeEqual(given, expected);
}
