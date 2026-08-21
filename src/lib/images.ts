/**
 * Die Rechnung hinter dem Verkleinern eines Blattes — Maße, Grenzen, Größen.
 *
 * Reine Rechnung: kein Canvas, kein DOM, keine Datenbank, kein Next. Genau
 * deshalb liegt sie hier und nicht in der Komponente, die den Auslöser zeichnet
 * — dieselbe Trennung wie bei @/lib/topics. Der Auslöser ist eine Client-
 * Komponente, der Server prüft dieselben Grenzen noch einmal, und beide sollen
 * dieselbe Zahl meinen. Stünden die Grenzen an zwei Stellen, nähme die App an
 * einer Tür an, was sie an der anderen ablehnt.
 *
 * **Verkleinert wird im Browser, bevor etwas hochgeht.** Auf dem Server gäbe es
 * dafür nichts: `sharp` steht in den devDependencies und ist in der Cloud gar
 * nicht installiert, und eine Bild-Bibliothek nachzuinstallieren, nur um
 * Bytes wegzuwerfen, die man nie hätte senden müssen, wäre die falsche
 * Richtung. Ein Handyfoto wiegt roh vier bis acht Megabyte; über ein
 * Mobilfunknetz sind das zehn Sekunden Warten im Unterricht. Nach dem
 * Verkleinern auf 1600 Pixel lange Kante bleiben rund 200 bis 300 KB übrig —
 * lesbar bis in die letzte Zeile einer Kopie, und eine Anfrage, die durchgeht,
 * bevor man das Handy wieder eingesteckt hat. Die Rechenzeit dafür hat das
 * Handy ohnehin; es hat das Bild gerade selbst aufgenommen.
 */

/**
 * Die lange Kante des Vollbildes.
 *
 * 1600 Pixel sind die Grenze, an der eine abfotografierte DIN-A4-Seite noch
 * durchgehend lesbar bleibt — auch die Fußnote, auch die handschriftliche
 * Randnotiz. Darunter fängt Kleingedrucktes an zu verschwimmen, darüber wächst
 * die Datei, ohne dass man auf dem Bildschirm mehr sieht.
 */
export const MAX_EDGE = 1600;

/**
 * Die lange Kante der Vorschau.
 *
 * 320 Pixel sind gut das Doppelte dessen, was eine Kachel in der Ablage breit
 * ist — genug für ein Display mit doppelter Pixeldichte und wenig genug, dass
 * eine Vorschau bei rund 15 KB bleibt. Die Ablage zeigt bis zu zweihundert
 * davon auf einmal (`LIST_LIMIT` in @/lib/materials); zusammen sind das rund
 * 3 MB, so viel wie ein Dutzend Vollbilder.
 */
export const THUMB_EDGE = 320;

/**
 * Die JPEG-Qualität beim Verkleinern.
 *
 * 0,72 ist die Stelle, an der ein abfotografiertes Blatt keine sichtbaren
 * Artefakte an den Buchstabenkanten bekommt und trotzdem klein bleibt. Höher
 * kostet Bytes für einen Unterschied, den niemand sieht; niedriger frisst
 * zuerst genau das, worauf es ankommt — dünne Linien und kleine Schrift.
 */
export const JPEG_QUALITY = 0.72;

/**
 * Serverseitiges Sicherheitsnetz je Seite.
 *
 * Nach dem Verkleinern im Browser wird diese Grenze nie erreicht; sie gilt dem
 * Fall, dass das Verkleinern übersprungen wurde — ein anderer Browser, ein
 * direkter Aufruf, ein Fehler im Canvas. Drei Megabyte lassen jedes ehrliche
 * Blatt durch und bleiben weit unter dem, was eine Server Action überhaupt
 * entgegennimmt.
 */
export const MAX_PAGE_BYTES = 3_000_000;

/**
 * Serverseitiges Sicherheitsnetz für die Vorschau.
 *
 * Eine 320 Pixel lange Kante wiegt rund 15 KB; 400 KB sind das Netz und nicht
 * die Erwartung. Die Vorschau braucht trotzdem eine eigene, viel engere Grenze,
 * denn sie reist in derselben Anfrage wie das Vollbild. Gälte für beide
 * dieselbe Grenze, wären zusammen 6 MB zulässig — mehr, als
 * `experimental.serverActions.bodySizeLimit` in next.config.ts durchlässt. Next
 * bräche eine solche Anfrage mit Status 413 ab, bevor die Action überhaupt
 * läuft, und beim Auslöser käme das als abgerissene Verbindung an: der Nutzer
 * läse „Prüf deine Verbindung“, obwohl die Verbindung stand. 3 MB + 400 KB
 * bleiben mit Rand unter den 4 MB, also lehnt der Prüfer ab, was sonst
 * ungeprüft an der Tür gestorben wäre.
 */
export const MAX_THUMB_BYTES = 400_000;

/**
 * So viele Seiten passen an ein Blatt.
 *
 * Zwölf ist mehr, als ein ausgeteiltes Arbeitsblatt je hat, und wenig genug,
 * dass die Detailseite nicht zum Fotoalbum wird. Wer mehr zusammenhat, hat
 * kein Blatt mehr, sondern ein Heft — und das sind zwei Einträge.
 */
export const MAX_PAGES = 12;

/**
 * Was die App als Bild annimmt.
 *
 * JPEG ist, was der Browser beim Verkleinern erzeugt. PNG und WebP stehen
 * daneben, weil ein Screenshot vom Whiteboard oder ein weitergeschicktes Bild
 * genauso ein Blatt ist. HEIC steht nicht dabei: das Canvas gibt es nicht aus,
 * und was hier hereinkommt, kommt aus dem Canvas.
 */
export const ALLOWED_MIME: readonly ["image/jpeg", "image/png", "image/webp"] = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

export type AllowedMime = (typeof ALLOWED_MIME)[number];

/** Kann die App dieses Format lesen? */
export function isAllowedMime(value: string): value is AllowedMime {
  return ALLOWED_MIME.some((mime) => mime === value);
}

/**
 * Passt ein Bild proportional in einen quadratischen Kasten.
 *
 * Vergrößert wird dabei nie: ein Foto, das schon kleiner ist als der Kasten,
 * kommt unverändert zurück. Es hochzurechnen erfände Pixel, die es nie gab,
 * und machte die Datei größer, ohne dass ein Buchstabe schärfer würde.
 *
 * Herauskommen immer ganze Pixel und nie eine Null. Ein Canvas mit der Breite
 * 0 wirft beim Zeichnen nicht, er liefert ein leeres Bild — die Aufnahme wäre
 * also lautlos weg. Bei einem sehr schmalen Streifen (ein Foto von einem
 * Bücherrücken, ein zurechtgeschnittener Zeilenausschnitt) rundet die kurze
 * Kante rechnerisch auf 0; sie bleibt dann bei 1 und das Seitenverhältnis
 * verschiebt sich um diesen einen Pixel. Ein Pixel Verzerrung ist der
 * günstigere Fehler.
 *
 * Unsinnige Eingaben — 0, negativ, NaN — werden wie 1 behandelt statt
 * durchgereicht. Die Funktion rechnet; sie ist nicht die Stelle, an der über
 * eine Fehlermeldung entschieden wird.
 */
export function fitWithin(
  width: number,
  height: number,
  max: number,
): { width: number; height: number } {
  const w = whole(width);
  const h = whole(height);
  const box = whole(max);

  const longest = Math.max(w, h);
  if (longest <= box) return { width: w, height: h };

  const factor = box / longest;
  return {
    width: Math.max(1, Math.round(w * factor)),
    height: Math.max(1, Math.round(h * factor)),
  };
}

/**
 * Eine Dateigröße, wie sie unter einem Blatt steht: "248 KB", "1,2 MB".
 *
 * Deutsch heißt hier: Komma statt Punkt. Gerechnet wird binär (1 KB = 1024
 * Bytes), so wie jeder Dateimanager es zeigt — eine Zahl, die neben der des
 * Betriebssystems steht, soll dieselbe sein.
 *
 * Unter einem Kilobyte stehen die Bytes selbst da, ohne Nachkommastelle. "0 B"
 * ist dabei eine wahre Aussage und kein Platzhalter: eine Seite ohne Bytes gibt
 * es nicht, und wenn doch, soll man es sehen.
 */
export function formatBytes(bytes: number): string {
  const value = whole(bytes, 0);

  if (value < 1024) return `${value} B`;

  if (value < 1024 * 1024) {
    return `${Math.round(value / 1024)} KB`;
  }

  const megabytes = value / (1024 * 1024);
  return `${megabytes.toFixed(1).replace(".", ",")} MB`;
}

/**
 * Macht aus einer Zahl eine ganze, brauchbare Zahl. `floor` statt `round`, weil
 * eine Größe nie größer erscheinen soll, als sie ist.
 */
function whole(value: number, minimum = 1): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.floor(value));
}
