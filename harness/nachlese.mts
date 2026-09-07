import { nachleseAuftragFuer } from "./auftrag.mts";
import { laufFuerBlatt } from "./kaefig.mts";
import {
  liesZugang,
  Verbindung,
  WerkzeugFehler,
  ZugangVerloren,
} from "./mcp.mts";
import { sperren } from "./sperre.mts";

/**
 * Die Nachlese: schreibt Blätter ab, die längst eingeordnet sind.
 *
 *   npx tsx harness/nachlese.mts                  — zeigt, was zu tun wäre
 *   npx tsx harness/nachlese.mts --blatt <id>     — genau dieses eine Blatt
 *   npx tsx harness/nachlese.mts --alle           — alle, der Reihe nach
 *   npx tsx harness/nachlese.mts --alle --anzahl 3 — höchstens drei
 *   npx tsx harness/nachlese.mts --modell sonnet  — ein anderes Modell
 *
 * **Warum es sie gibt.** Der Postbote arbeitet aus dem Eingangskorb, und der
 * Korb ist die Warteschlange: ein Blatt, das ein Mensch durchgesehen hat, ist
 * für ihn erledigt. Das war richtig, solange das Einordnen die ganze Arbeit
 * war. Seit dem 5.9.2026 gehört die Abschrift dazu — und die fünfzehn Blätter,
 * die vorher hereinkamen, sind eingeordnet, ohne dass je jemand gelesen hätte,
 * was auf ihnen steht. Sie kämen nie wieder an die Reihe. Fach-PDF und
 * Wiki-Übergabe zeigten für sie auf Dauer „noch niemand gelesen".
 *
 * **Sie ist kein zweiter Postbote.** Kein Dienst, keine Schleife, kein
 * Gedächtnis: sie läuft, wenn jemand sie startet, und ist danach fertig. Ihr
 * Gedächtnis ist die Datenbank selbst — eine Seite mit `transcriptChars: null`
 * ist die offene Aufgabe, genau wie beim Postboten das Blatt ohne Vorschlag.
 * Damit gibt es auch hier nichts, was auseinanderlaufen könnte.
 *
 * **Sie schreibt selbst nichts in die App**, so wenig wie der Postbote:
 * geschrieben wird ausschließlich im Käfig, durch `propose_sheet`, dieselbe
 * Tür wie für jeden anderen. Was dabei herauskommt, ist ein Vorschlag im Korb
 * — ein Mensch übernimmt ihn, oder er wirft ihn weg.
 *
 * **Ohne Angabe tut sie nichts.** Fünfzehn Blätter sind fünfzehn Käfigläufe,
 * und die gehen auf dasselbe Tageskontingent wie der Postbote. Ein Aufruf ohne
 * Argumente zeigt deshalb nur, was anläge; gelaufen wird erst auf `--blatt`
 * oder `--alle`. Das ist die Umkehrung der üblichen Vorsicht — beim Postboten
 * ist Laufen der Normalfall —, und sie steht hier, weil eine Nachlese nichts
 * verpasst, wenn sie eine Stunde später startet.
 */

/** Wie viele Blätter `--alle` höchstens anfasst, wenn nichts gesagt ist. */
const HOECHSTENS = 15;

type Seite = {
  id: string;
  sortOrder: number;
  transcriptChars: number | null;
};

type BlattZeile = {
  id: string;
  title: string;
  subject: string;
};

type BlattDetail = BlattZeile & {
  filedAt: string | null;
  pages: Seite[];
};

type VorschlagZeile = {
  id: string;
  origin: string;
  subjectId: string | null;
  title: string | null;
  capturedOn: string | null;
  note: string | null;
  topics: string[];
};

type KorbZeile = {
  id: string;
  proposals: VorschlagZeile[];
};

/** Ein Blatt mit offenen Seiten — die Arbeitseinheit dieses Laufs. */
type Offen = {
  blatt: BlattZeile;
  seiten: number;
  ungelesen: number;
  /** Hängt schon ein Vorschlag daran, der auf einen Menschen wartet? */
  vorschlag: boolean;
};

function argument(name: string): string | undefined {
  const stelle = process.argv.indexOf(`--${name}`);
  return stelle === -1 ? undefined : process.argv[stelle + 1];
}

function schalter(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

/** Eine Zeile fürs Mitlesen: Uhrzeit, dann der Satz. */
function sagen(satz: string): void {
  const jetzt = new Date().toLocaleTimeString("de-DE", { hour12: false });
  console.log(`${jetzt}  ${satz}`);
}

/** Was ein Fehlschlag zu sagen hat, gleich womit er geworfen wurde. */
function fehlertext(grund: unknown): string {
  return grund instanceof Error ? grund.message : String(grund);
}

/**
 * Die Blätter, an denen schon ein Vorschlag hängt.
 *
 * Ein Vorschlag ist eine Abschrift, die es gibt — sie steht nur noch nicht am
 * Blatt, weil niemand sie übernommen hat. Für die Nachlese ist das trotzdem
 * erledigte Arbeit: sie noch einmal zu machen hieße, ein zweites Mal zu
 * bezahlen und dem Menschen zwei Vorschläge an dasselbe Blatt zu legen, die er
 * dann gegeneinander halten darf.
 *
 * Der Postbote hat diese Regel von Anfang an (`proposals.length === 0` in
 * `offene()`); der Nachlese fehlte sie, und am 7.9.2026 hätte das nach einem
 * Lauf, der auf halber Strecke abbrach, prompt sechs Blätter doppelt
 * abgeschrieben.
 */
async function mitVorschlag(verbindung: Verbindung): Promise<Set<string>> {
  const antwort = await verbindung.werkzeug("read_inbox", { limit: 200 });
  const zeilen = (antwort.daten ?? []) as KorbZeile[];

  return new Set(
    zeilen
      .filter((zeile) => zeile.proposals.length > 0)
      .map((zeile) => zeile.id),
  );
}

/**
 * Sucht die Blätter mit ungelesenen Seiten.
 *
 * Ein `read_sheet` je Blatt, und das ist Absicht: `read_material` nennt die
 * Seitenzahl, aber nicht, welche Seite schon gelesen ist — diese Auskunft gibt
 * es nur am einzelnen Blatt (`transcriptChars`). Bei fünfzehn Blättern sind das
 * fünfzehn kurze Abfragen ohne Bilder; die teuren Aufrufe stehen ohnehin im
 * Käfig.
 */
async function offeneBlaetter(verbindung: Verbindung): Promise<Offen[]> {
  const liste = await verbindung.werkzeug("read_material", {});
  const blaetter = (liste.daten ?? []) as BlattZeile[];
  const haengtSchon = await mitVorschlag(verbindung);

  const offen: Offen[] = [];

  for (const blatt of blaetter) {
    const antwort = await verbindung.werkzeug("read_sheet", { sheet: blatt.id });
    const detail = antwort.daten as BlattDetail | undefined;
    if (!detail) continue;

    const ungelesen = detail.pages.filter(
      (seite) => seite.transcriptChars === null,
    ).length;

    if (ungelesen > 0) {
      offen.push({
        blatt,
        seiten: detail.pages.length,
        ungelesen,
        vorschlag: haengtSchon.has(blatt.id),
      });
    }
  }

  return offen;
}

/**
 * Hat der Lauf sein Schweigen gehalten?
 *
 * Die eine Zusage dieses Auftrags lautet: der Vorschlag sagt NUR Abschriften.
 * Sie steht in Prosa im Auftrag, und Prosa ist eine Bitte und keine Sperre —
 * `propose_sheet` nähme einen Titel klaglos an. Bemerkt würde es erst beim
 * Übernehmen, in der Gegenüberstellung, von einem Menschen, der fünfzehn
 * Vorschläge hintereinander bestätigt und beim zwölften nicht mehr hinsieht.
 *
 * Also wird nachgesehen. `read_inbox` liefert zu jedem Vorschlag genau die
 * fünf Felder, die hier leer sein müssen — die Abschriften selbst liefert es
 * nicht, und das ist die Grenze dieser Prüfung: sie kann sagen, dass NICHTS
 * ANDERES vorgeschlagen wurde, aber nicht, wie gut abgeschrieben wurde. Das
 * bleibt am Menschen, und dafür ist es sein Vorschlag.
 */
async function schweigenGeprueft(
  verbindung: Verbindung,
  blattId: string,
): Promise<string[]> {
  const antwort = await verbindung.werkzeug("read_inbox", { limit: 200 });
  const zeilen = (antwort.daten ?? []) as KorbZeile[];
  const zeile = zeilen.find((eintrag) => eintrag.id === blattId);

  if (!zeile || zeile.proposals.length === 0) {
    return ["im Korb liegt kein Vorschlag zu diesem Blatt"];
  }

  // Der jüngste ist der aus diesem Lauf. Ältere kann es geben, wenn schon
  // einmal einer angelegt und nicht übernommen wurde; die gehören nicht hierher.
  const vorschlag = zeile.proposals[zeile.proposals.length - 1]!;

  const verstoesse: string[] = [];
  if (vorschlag.subjectId !== null) verstoesse.push("ein Fach");
  if (vorschlag.title !== null) verstoesse.push("einen Titel");
  if (vorschlag.capturedOn !== null) verstoesse.push("einen Tag");
  if (vorschlag.note !== null) verstoesse.push("eine Notiz");
  if (vorschlag.topics.length > 0) verstoesse.push("Themen");

  return verstoesse;
}

/**
 * Wie ein Blatt ausgegangen ist.
 *
 * „ohne" ist kein Fehler und trotzdem kein Erfolg: der Lauf ist zu Ende
 * gekommen und hat nichts vorgeschlagen — die Frist lief ab, das Modell winkte
 * ab, oder die API hat die Ausgabe verweigert. Es steht hier als eigener Wert,
 * weil der Schlusssatz sonst „fertig" meldet und die Blätter verschweigt, die
 * leer ausgingen. Am 7.9.2026 waren das zwei von vierzehn, und im Log stand
 * darüber ein grüner Satz.
 */
type Ausgang = "vorschlag" | "ohne" | "schluss";

/** Ein Blatt durch den Käfig. */
async function nachlesen(
  verbindung: Verbindung,
  offen: Offen,
  modell: string | undefined,
): Promise<Ausgang> {
  const kurz = offen.blatt.id.slice(0, 8);
  sagen(
    `→ ${kurz} „${offen.blatt.title}" (${offen.blatt.subject}) — ` +
      `${offen.ungelesen} von ${offen.seiten} Seiten ungelesen`,
  );

  const ergebnis = await laufFuerBlatt(
    offen.blatt.id,
    verbindung.adresse,
    await verbindung.zugriffstoken(),
    modell,
    nachleseAuftragFuer(offen.blatt.id),
  );

  // Dieselbe Unterscheidung wie beim Postboten, und aus demselben Grund: das
  // leere Kontingent trifft das nächste Blatt genauso, die abgelaufene Frist
  // sagt über das nächste nichts. Gemerkt wird hier nichts — die ungelesene
  // Seite ist das Gedächtnis, und sie bleibt ungelesen.
  if (ergebnis.art === "pause") {
    sagen(`   abgebrochen: ${ergebnis.grund}`);
    return "schluss";
  }

  if (ergebnis.art === "spaeter") {
    sagen(`   übersprungen, später noch einmal: ${ergebnis.grund}`);
    return "ohne";
  }

  if (ergebnis.art === "nichts") {
    sagen(`   kein Vorschlag: ${ergebnis.grund}`);
    return "ohne";
  }

  const { antwort, kostenUsd, dauerMs } = ergebnis;
  const dauer = `${Math.round(dauerMs / 1000)} s`;

  if (antwort.ergebnis !== "vorschlag") {
    sagen(`   kein Vorschlag: ${antwort.grund || "ohne Angabe"} (${dauer})`);
    return "ohne";
  }

  sagen(
    `   Vorschlag liegt im Korb: ${antwort.abschriften} Abschrift(en) ` +
      `(${dauer}, entspricht ${kostenUsd.toFixed(2)} $)`,
  );

  // Die Zahl oben ist die des Modells. Die Zeile hier ist gemessen — und sie
  // ist die einzige, die etwas beweist.
  //
  // Sie darf dabei aber nicht mehr umwerfen als sich selbst. Am 7.9.2026 ist
  // genau hier ein „fetch failed" hochgeschlagen und hat einen Lauf nach sechs
  // von vierzehn Blättern beendet — die Kontrollabfrage beendete den Stapel,
  // den sie kontrollieren sollte, und das ausgerechnet NACH dem Vorschlag: der
  // lag längst im Korb, die Arbeit war getan und bezahlt. Geht sie schief,
  // bleibt der Vorschlag eben ungeprüft, und das steht als Zeile da.
  let verstoesse: string[] | null = null;
  try {
    verstoesse = await schweigenGeprueft(verbindung, offen.blatt.id);
  } catch (grund) {
    sagen(`   ⚠ nicht geprüft: ${fehlertext(grund)}`);
    sagen(
      "     Der Vorschlag liegt trotzdem im Korb — ob er nur Abschriften " +
        "nennt, zeigt dann erst die Gegenüberstellung.",
    );
  }

  if (verstoesse !== null && verstoesse.length > 0) {
    sagen(`   ⚠ ACHTUNG: der Vorschlag nennt auch ${verstoesse.join(", ")}.`);
    sagen(
      "     Beim Übernehmen ersetzt das, was am Blatt steht — sieh dir die " +
        "Gegenüberstellung genau an, statt zu bestätigen.",
    );
  } else if (verstoesse !== null) {
    sagen("   geprüft: der Vorschlag sagt nur Abschriften, sonst nichts.");
  }

  if (antwort.grund) sagen(`   dazu: ${antwort.grund}`);

  return "vorschlag";
}

async function main(): Promise<void> {
  sperren("Die Nachlese");

  const verbindung = new Verbindung(liesZugang());
  const modell = argument("modell");
  const nurDieses = argument("blatt");
  const alle = schalter("alle");
  const anzahl = Number(argument("anzahl") ?? HOECHSTENS);

  sagen(`Nachlese. ${verbindung.adresse}`);

  const offen = await offeneBlaetter(verbindung);

  if (offen.length === 0) {
    sagen("Kein Blatt hat ungelesene Seiten — es gibt nichts nachzulesen.");
    return;
  }

  const seitenGesamt = offen.reduce((summe, eintrag) => summe + eintrag.ungelesen, 0);
  sagen(
    `${offen.length} Blatt/Blätter mit zusammen ${seitenGesamt} ungelesenen Seiten.`,
  );

  const wartend = offen.filter((eintrag) => eintrag.vorschlag).length;
  if (wartend > 0) {
    sagen(
      `Davon ${wartend} mit einem Vorschlag, der auf einen Menschen wartet — ` +
        "die werden übersprungen.",
    );
  }

  if (nurDieses) {
    const eintrag = offen.find((kandidat) => kandidat.blatt.id === nurDieses);
    if (!eintrag) {
      sagen(
        `Das Blatt ${nurDieses.slice(0, 8)} steht nicht darunter — es gibt es ` +
          "nicht, oder alle seine Seiten sind schon gelesen.",
      );
      return;
    }

    if (eintrag.vorschlag) {
      sagen(
        `An ${nurDieses.slice(0, 8)} hängt schon ein Vorschlag. Übernimm oder ` +
          "verwirf ihn erst — sonst liegen zwei am selben Blatt.",
      );
      return;
    }

    await nachlesen(verbindung, eintrag, modell);
    return;
  }

  if (!alle) {
    console.log();
    for (const eintrag of offen) {
      console.log(
        `  ${eintrag.blatt.id}  ${eintrag.ungelesen}/${eintrag.seiten} offen  ` +
          `„${eintrag.blatt.title}" (${eintrag.blatt.subject})` +
          (eintrag.vorschlag ? "  — Vorschlag wartet, wird übersprungen" : ""),
      );
    }
    console.log(
      "\nEs wurde nichts getan. Ein einzelnes Blatt:\n" +
        "  npx tsx harness/nachlese.mts --blatt <id>\n" +
        "Alle der Reihe nach:\n" +
        "  npx tsx harness/nachlese.mts --alle\n",
    );
    return;
  }

  const anstehend = offen.filter((eintrag) => !eintrag.vorschlag);

  if (anstehend.length === 0) {
    sagen(
      "An jedem offenen Blatt hängt schon ein Vorschlag — es gibt nichts zu " +
        "tun, bis die übernommen oder verworfen sind.",
    );
    return;
  }

  const dran = anstehend.slice(0, Math.max(0, anzahl));
  if (dran.length < anstehend.length) {
    sagen(`Davon werden ${dran.length} bearbeitet.`);
  }

  /*
   * Ein Blatt, das scheitert, darf die übrigen nicht mitnehmen.
   *
   * Der Lauf ist lang — vierzehn Blätter sind zehn Minuten —, und die
   * Verbindung geht über den Funnel nach draußen und wieder herein. Ein
   * „fetch failed" dazwischen ist keine Ausnahme, sondern gehört dazu. Was ein
   * gescheitertes Blatt kostet, ist ein Blatt; was ein abgebrochener Stapel
   * kostet, sind alle danach — und beim nächsten Anlauf fangen sie wieder von
   * vorn an.
   *
   * Zwei Ausnahmen bleiben. `ZugangVerloren` trifft jedes weitere Blatt
   * genauso; da hilft kein Weitermachen, sondern nur eine neue Zustimmung.
   * Und wer dreimal hintereinander scheitert, scheitert nicht mehr am Blatt —
   * dann ist der Dienst weg, und die restlichen Läufe wären Wartezeit mit
   * Kontingent daran.
   */
  let hintereinander = 0;
  let gescheitert = 0;
  let leer = 0;

  for (const eintrag of dran) {
    try {
      const ausgang = await nachlesen(verbindung, eintrag, modell);
      if (ausgang === "schluss") break;
      if (ausgang === "ohne") leer += 1;
      hintereinander = 0;
    } catch (grund) {
      if (grund instanceof ZugangVerloren) throw grund;

      hintereinander += 1;
      gescheitert += 1;
      sagen(`   ✗ ${fehlertext(grund)}`);
      sagen("     Das Blatt bleibt offen und ist beim nächsten Lauf dran.");

      if (hintereinander >= 3) {
        sagen("Dreimal hintereinander gescheitert — der Lauf hört hier auf.");
        break;
      }
    }
  }

  // Der Schlusssatz nennt beides, was NICHT herauskam. Ein „fertig" über einer
  // halben Arbeit ist schlimmer als gar keine Zusammenfassung: es wird gelesen
  // und geglaubt.
  const offengeblieben = [
    gescheitert > 0 ? `${gescheitert} mit einem Fehler` : null,
    leer > 0 ? `${leer} ohne Vorschlag` : null,
  ].filter((teil): teil is string => teil !== null);

  sagen(
    offengeblieben.length === 0
      ? `Nachlese fertig, alle ${dran.length} Blätter liegen als Vorschlag im Korb.`
      : `Nachlese fertig: ${dran.length - gescheitert - leer} von ` +
          `${dran.length} Blättern liegen im Korb, ${offengeblieben.join(", ")}. ` +
          "Die übrigen bleiben offen und sind beim nächsten Lauf wieder dran.",
  );
}

main().catch((grund: unknown) => {
  if (grund instanceof ZugangVerloren || grund instanceof WerkzeugFehler) {
    console.error(`\n${grund.message}`);
    process.exit(1);
  }

  console.error(`\n${grund instanceof Error ? grund.message : String(grund)}`);
  process.exit(1);
});
