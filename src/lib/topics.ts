/**
 * Themen einer Prüfung — die Regeln, nach denen ein Titel zugeschnitten wird.
 *
 * Reine Rechnung: keine Datenbank, kein React, kein Next. Genau deshalb liegt
 * das hier und nicht in @/lib/exams — `topic-input.tsx` ist eine Client-
 * Komponente, und ein Import aus einem Modul mit Datenbankzugriff zöge die
 * Datenbank ins Browser-Bundle.
 *
 * Die Grenzen standen vorher an zwei Stellen: als TOPIC_MAX_LENGTH und
 * TOPIC_LIMIT in den Server Actions der Klausuren, und noch einmal als
 * MAX_LENGTH im Eingabefeld. `setTopics()` in @/lib/exams kannte beide nicht —
 * über das Formular wurde also gekürzt und gedeckelt, über einen direkten
 * Aufruf nicht. Sobald eine dritte Tür dazukommt, ist das die Stelle, an der
 * die App an einer Tür annimmt, was sie an einer anderen ablehnt.
 *
 * Hier stehen zwei Schlüssel nebeneinander, und sie beantworten zwei
 * verschiedene Fragen. `topicKey()` fragt: sind das zwei Posten derselben
 * Klausur? `vocabularyKey()` fragt: meinen zwei Titel dasselbe Fachthema?
 * Der zweite darf großzügig sein, der erste nicht — warum, steht bei
 * `topicKey()`.
 */

/** Länger als eine Zeile ist kein Thema mehr, sondern eine Zusammenfassung. */
export const TOPIC_MAX_LENGTH = 80;

/** So viele Themen kann ein Mensch vor einer Prüfung nicht durcharbeiten. */
export const TOPIC_LIMIT = 40;

/**
 * Der Schlüssel, unter dem zwei Titel als derselbe gelten.
 *
 * Er faltet nur Rand und Groß-/Kleinschreibung — „Kettenregel " und
 * „kettenregel" sind dasselbe Thema, „Ableitungsregeln" und „Kettenregel"
 * nicht. Umformulierungen erkennt er also ausdrücklich nicht; das wäre eine
 * eigene Aufgabe mit eigenen Fehlern.
 *
 * `toLocaleLowerCase("de")` statt `toLowerCase()`, damit an allen Stellen
 * dieselbe Faltung gilt — vorher benutzte das Formular die eine und
 * `setTopics()` die andere.
 *
 * NICHT mit `vocabularyKey()` zusammenlegen, so ähnlich die beiden auch
 * aussehen. Dieser Schlüssel entscheidet, ob zwei Titel INNERHALB EINER
 * KLAUSUR derselbe Posten sind. Würde er großzügiger, verschmölzen zwei
 * verschiedene Klausurthemen zu einem — und an einem Klausurthema hängen über
 * `study_blocks.topic_id` die Lernblöcke, auch die längst abgehakten. Der
 * Preis für eine großzügigere Faltung wäre also gelöschte Lernhistorie, und
 * zwar lautlos. `vocabularyKey()` dagegen sortiert nur Vorschläge in einer
 * Liste; wer sich dort irrt, sieht es auf dem Bildschirm.
 */
export function topicKey(title: string): string {
  return title.trim().toLocaleLowerCase("de");
}

/**
 * Schneidet eine Themenliste auf das zu, was gespeichert werden darf:
 * getrimmt, auf `TOPIC_MAX_LENGTH` gekürzt, ohne Leerzeilen, ohne Dubletten,
 * höchstens `TOPIC_LIMIT` Stück.
 *
 * Die Reihenfolge bleibt erhalten, und bei zwei gleichen Titeln gewinnt der
 * erste — sonst könnten nicht beide ihr vorhandenes Thema behalten, und die
 * Lernblöcke daran zeigten ins Leere.
 */
export function normalizeTopics(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of titles) {
    if (typeof raw !== "string") continue;

    const title = raw.trim().slice(0, TOPIC_MAX_LENGTH);
    if (!title) continue;

    const key = topicKey(title);
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(title);
    if (result.length >= TOPIC_LIMIT) break;
  }

  return result;
}

/**
 * Wörter, die einen Titel bauen, ohne etwas zu sagen: Artikel, Pronomen,
 * Präpositionen, Konjunktionen.
 *
 * Einzelne Buchstaben stehen auf keiner der beiden Listen, so verlockend das
 * bei „S. 12" wäre: in der Chemie unterscheiden gerade sie die Themen
 * („s-Orbital" gegen „p-Orbital"). Ein überflüssiges „s" im Schlüssel trennt
 * zwei Titel, die zusammengehören — das ist der günstigere Fehler. Weil „S."
 * damit auch keine Fundstelle ist, behält „Bruchrechnung S. 47" seit der
 * Zahlenregel zusätzlich die 47; getrennt stand der Titel wegen des „s" ohnehin.
 */
const FUNCTION_WORDS: readonly string[] = [
  "der", "die", "das", "den", "dem", "des",
  "ein", "eine", "einen", "einem", "einer", "eines",
  "und", "oder", "als", "wie", "dass",
  "in", "im", "ins", "an", "am", "auf", "aus", "bei", "beim", "bis",
  "durch", "fuer", "gegen", "mit", "nach", "ohne", "um",
  "ueber", "unter", "von", "vom", "vor",
  "zu", "zum", "zur", "zwischen",
];

/**
 * Die Schulwörter, die auf eine Fundstelle zeigen statt auf ein Thema — auf ein
 * Blatt, eine Nummer, einen Termin („Arbeitsblatt 3", „Übungen zur …").
 *
 * Sie tun zweierlei: sie fallen selbst aus dem Schlüssel, und sie verraten,
 * dass eine Zahl daneben die Nummer der Fundstelle ist und nicht Teil des
 * Themas. Deshalb stehen sie getrennt von den Funktionswörtern — „Der 1.
 * Weltkrieg" hat einen Artikel, aber keine Fundstelle.
 *
 * Jedes Wort hier ist ein Wort, das zwei verschiedene Themen zu einem machen
 * kann. Deshalb steht nur drauf, was in einem Schulheft wirklich nichts über
 * den Inhalt aussagt — und ausdrücklich keine Zahlwörter: „Erster Weltkrieg"
 * und „Zweiter Weltkrieg" sind zwei Themen, „Erste Ableitung" und „Zweite
 * Ableitung" ebenso. Für die Ziffernschreibweise sorgt die Zahlenregel in
 * `vocabularyKey()`.
 *
 * „Training" und „Lernen" standen einmal hier und sind wieder weg: sie zeigen
 * auf keine Fundstelle, sondern beschreiben eine Tätigkeit — und in Sport und
 * Pädagogik ist genau die das Thema. „Lösung", „Seite" und „Teil" bleiben,
 * obwohl sie in Chemie und Geometrie Fachwörter sind: als ganzer Titel
 * („Lösungen", „Seite 47") zeigen sie fast immer auf das Blatt. Das ist eine
 * Abwägung nach Häufigkeit und keine Wahrheit — wer „Wässrige Lösungen"
 * einträgt, bekommt den Schlüssel „waessrig" und verliert das Substantiv.
 *
 * Die Formen stehen doppelt da (Singular und Plural), weil die Liste vor dem
 * Stemmen greift und „Aufgaben" sonst als „aufgab" durchrutschte. Sie ist die
 * einzige Stelle, an der über Rauschen entschieden wird; der Stamm wird nicht
 * noch einmal gegen sie gehalten. Ein solcher zweiter Test hat „Teiler" (Stamm
 * „teil") mitgenommen und den Titel damit ganz ohne Schlüssel gelassen, also
 * lautlos abgewiesen. Der Preis dafür ist, dass eine hier vergessene Beugung
 * als Inhalt durchgeht — das ist ein Eintrag zu viel in einer Liste, und der
 * steht wenigstens sichtbar da.
 */
const REFERENCE_WORDS: ReadonlySet<string> = new Set([
  "arbeitsblatt", "arbeitsblaetter", "uebungsblatt", "uebungsblaetter",
  "blatt", "blaetter", "ab",
  "uebung", "uebungen", "ueben",
  "uebungsaufgabe", "uebungsaufgaben", "aufgabe", "aufgaben",
  "hausaufgabe", "hausaufgaben", "ha",
  "wiederholung", "wiederholungen", "wiederholen",
  "zusammenfassung", "zusammenfassungen",
  "loesung", "loesungen", "material", "materialien", "kopie", "kopien",
  "hefteintrag", "mitschrift", "tafelbild", "notiz", "notizen",
  "kapitel", "thema", "themen", "teil", "teile", "seite", "seiten",
  "nr", "nummer", "nummern",
  "test", "tests", "klausur", "klausuren",
  "klassenarbeit", "klassenarbeiten",
  "pruefung", "pruefungen", "vorbereitung", "vorbereitungen",
  "einfuehrung", "einfuehrungen", "grundlage", "grundlagen",
  "vertiefung", "vertiefungen",
]);

/** Beides zusammen ist das Rauschen: was nie in den Schlüssel gehört. */
const NOISE_WORDS: ReadonlySet<string> = new Set([
  ...FUNCTION_WORDS,
  ...REFERENCE_WORDS,
]);

/**
 * Endungen, die beim Stemmen abgetragen werden. Höchstens eine davon passt je
 * Wort — keine der zweibuchstabigen endet auf „e" —, die Reihenfolge ist also
 * nur Lesehilfe.
 *
 * Bewusst kurz gehalten. „ung" fehlt zum Beispiel, obwohl es sich anbietet:
 * es machte aus „Bildung" ein „bild" und legte damit zwei Themen zusammen, die
 * nichts miteinander zu tun haben. Ein einzelnes „n" fehlt ebenfalls, und
 * gerade das lässt „Elektron" und „Elektronen" zusammenfinden: „Elektronen"
 * verliert sein „en", „Elektron" bleibt, wie es ist. Mit „n" in der Liste
 * würde daraus „elektro" gegen „elektron", also zwei Themen. Dieselbe Rechnung
 * trägt „Funktion", „Gleichung", „Vektor" und „Reaktion" mit.
 */
const ENDINGS: readonly string[] = ["en", "er", "es", "e"];

/**
 * So lang muss der Rest nach dem Abtrennen mindestens sein.
 *
 * Vier, weil das Deutsche voll von dreibuchstabigen Wörtern ist, die mit dem
 * vierbuchstabigen Nachbarn nichts zu tun haben: „Rat" und „Rate", „Gen" und
 * „Gene", „Ton" und „Tone". Bei drei fielen sie zusammen. Bei fünf ginge
 * dafür Richtiges verloren — „Zelle"/„Zellen" und „Kurve"/„Kurven" blieben
 * getrennt, weil der Stamm nur vier Buchstaben hat. Vier ist die Stelle, an
 * der die Gegenpaare oben („Alkane" gegen „Alkene", „Ökosystem See" gegen
 * „Ökosystem Wald") noch sicher auseinanderstehen.
 */
const STEM_MIN_LENGTH = 4;

/**
 * Faltet einen Titel auf a-z, 0-9 und Leerzeichen herunter.
 *
 * Die Umlaute werden ausgeschrieben und nicht über `normalize("NFD")`
 * abgetragen: das machte aus „ö" ein „o" und verfehlte damit genau die
 * Schreibweise, die hier zusammenfinden soll — „Lösungsformel" und
 * „Loesungsformel". Das vorgeschaltete `normalize("NFC")` setzt nur zusammen,
 * was als Buchstabe plus Trema hereinkommt, und ändert sonst nichts.
 *
 * Alle übrigen Akzente fallen danach doch über NFD weg, und genau in dieser
 * Reihenfolge: Wenn ä/ö/ü/ß schon ae/oe/ue/ss sind, kann der Durchgang sie
 * nicht mehr treffen. Ohne ihn zerschnitte die letzte Zeile jedes akzentuierte
 * Wort in Bruchstücke — aus „réguliers" würden „r" und „guliers" —, und die
 * Bruchstücke sind untereinander kollisionsfähig. Französisch, Spanisch und
 * Latein stehen in der Fächer-Schnellauswahl; ohne Akzent getippt ist dort der
 * Normalfall. Der Preis ist ein Fehlalarm: „péché" und „pêche" bekommen
 * denselben Schlüssel. Er wiegt trotzdem leichter, denn Bruchstücke
 * verschmelzen genauso — „El pretérito" fiel mit dem vertippten „El pret rito"
 * zusammen —, und ein Titel ohne Akzent ist viel häufiger als zwei Titel, die
 * nur der Akzent unterscheidet.
 *
 * Was sich nicht zerlegen lässt (æ, ø, ł), wird weiterhin zum Wortende. Das
 * trennt, statt zu verschmelzen, und bleibt deshalb offen.
 *
 * „ph" zu „f", weil beide Schreibweisen im Heft stehen (Photosynthese,
 * Fotosynthese) und keine von beiden falsch ist.
 */
function fold(title: string): string {
  return title
    .normalize("NFC")
    .toLocaleLowerCase("de")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replaceAll("ph", "f")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Trägt eine Endung ab, aber nur eine und nur, wenn genug Stamm übrig bleibt.
 * Bleibt zu wenig übrig, bleibt das Wort ganz — „See" behält sein „e", sonst
 * stünde da „se", und „Ökosystem See" verlöre seinen Unterschied zu allem
 * anderen, was auf „se" endet.
 *
 * Ein einziger Durchgang, kein Stemmen bis zum Stillstand: jede weitere Runde
 * kürzt Wörter auf Stümpfe, und zwei Stümpfe sehen einander schnell ähnlich.
 * Der Preis ist, dass der Schlüssel nicht auf sich selbst angewandt werden
 * darf — er entsteht immer aus dem Anzeigetitel, nie aus einem Schlüssel.
 */
function stem(word: string): string {
  for (const ending of ENDINGS) {
    if (!word.endsWith(ending)) continue;
    const rest = word.slice(0, word.length - ending.length);
    if (rest.length >= STEM_MIN_LENGTH) return rest;
  }
  return word;
}

/** Eine reine Ziffernfolge: Blattnummer, Ordnungszahl oder Jahreszahl. */
const DIGITS_ONLY = /^[0-9]+$/;

/**
 * Vier Ziffern und mehr: so lang wird keine Blattnummer und keine
 * Aufgabennummer, und auch die Seitenzahl bleibt darunter. Was so lang ist, ist
 * eine Jahreszahl oder eine Größe aus dem Fach — beides Inhalt.
 *
 * Die Grenze ist bewusst nicht „1000 bis 2999", so genau das die Jahreszahl
 * träfe: enger heißt, mehr Zahlen wegzuwerfen, und eine weggeworfene Zahl legt
 * zwei Titel zusammen. „Arbeitsblatt: Primfaktorzerlegung von 3600" darf nicht
 * dasselbe Thema sein wie dasselbe Blatt mit 4500. Sie hängt auch nicht am
 * laufenden Jahr: der Schlüssel steht in der Datenbank und darf sich nicht
 * ändern, nur weil die Systemuhr weitergelaufen ist.
 *
 * Die drei- und zweistelligen Jahre kostet das, aber nur neben einer
 * Fundstelle: „Karl der Große 800" behält die Zahl, „AB 2: Karl der Große 800"
 * verliert sie. Dafür bleibt „Aufgabe 800" eine Aufgabe.
 */
const LONG_NUMBER = /^[0-9]{4,}$/;

/**
 * Der Schlüssel, unter dem ein Titel im Vokabular eines Fachs steht.
 *
 * Er liefert die Inhaltswörter des Titels: gefaltet, gestemmt, sortiert, ohne
 * Dubletten, mit Leerzeichen verbunden. Bleibt nichts Fachliches übrig, ist er
 * leer — „Arbeitsblatt 7" ist kein Thema, sondern eine Fundstelle.
 *
 * Sortiert wird nach Zeichencode und nicht mit `localeCompare`. Der Schlüssel
 * steht in der Datenbank und wird dort verglichen; er darf nicht davon
 * abhängen, welche Sortiertabelle die Laufzeit gerade mitbringt. Nach dem
 * Falten stehen ohnehin nur a-z und 0-9 darin.
 *
 * Im Zweifel trennt er lieber, als er zusammenlegt: zwei Einträge für dasselbe
 * Thema stehen sichtbar untereinander und lassen sich mit einem Tipp
 * zusammenlegen; ein Thema zu viel zusammengelegt heißt, dass Material lautlos
 * aus dem Blick verschwindet.
 *
 * Zahlen sind dabei der schwierige Fall, denn sie sind mal das eine und mal das
 * andere: „Arbeitsblatt 3" nummeriert eine Fundstelle, „Revolution 1848" nennt
 * den Inhalt, und „1. Weltkrieg" unterscheidet zwei Themen voneinander. Also
 * entscheidet der Titel selbst darüber:
 *
 * - Steht ein Fundstellenwort daneben („Arbeitsblatt", „Nr.", „Kapitel"), dann
 *   nummeriert die Zahl das Blatt und fällt weg.
 * - Lange Zahlen bleiben auch dann stehen: in Geschichte ist die Jahreszahl der
 *   Inhalt, und „AB 3: Revolution 1848" darf nicht dasselbe Thema sein wie
 *   „AB 3: Revolution 1918".
 * - Sonst bleibt die Zahl stehen: „1. Weltkrieg" ist nicht „2. Weltkrieg",
 *   „Faust 1" nicht „Faust 2".
 *
 * Tragen kann eine Zahl den Schlüssel aber nie allein — „2026" ist ein Jahrgang
 * und kein Thema. Das ist die Lücke dieser Regel: Wer „1848" als ganzen Titel
 * einträgt, bekommt keine Vokabel.
 */
export function vocabularyKey(title: string): string {
  const words = fold(title)
    .split(" ")
    .filter((word) => word !== "");

  // Eine einzige Frage an den ganzen Titel, bevor die Wörter drankommen: zeigt
  // er auf ein Blatt? Danach richtet sich, was aus seinen Zahlen wird.
  const namesReference = words.some((word) => REFERENCE_WORDS.has(word));

  const content = new Set<string>();
  const numbers = new Set<string>();

  for (const word of words) {
    if (DIGITS_ONLY.test(word)) {
      if (LONG_NUMBER.test(word) || !namesReference) numbers.add(word);
      continue;
    }

    if (NOISE_WORDS.has(word)) continue;
    content.add(stem(word));
  }

  // Ohne ein Fachwort ist der Titel eine Fundstelle, auch wenn Zahlen darin
  // stehen. Zahlen schärfen einen Schlüssel, sie stiften keinen.
  if (content.size === 0) return "";

  return [...content, ...numbers].sort().join(" ");
}

/** Trägt der Titel überhaupt ein Fachwort? Ohne Schlüssel gibt es kein Thema. */
export function hasVocabularyKey(title: string): boolean {
  return vocabularyKey(title) !== "";
}
