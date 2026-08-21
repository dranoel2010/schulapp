import { isAllowedMime } from "@/lib/images";
import { readPageImage } from "@/lib/materials";
import { getSessionUser } from "@/lib/session";

/**
 * Die Auslieferung eines Seitenbildes — für das Vollbild und für die Vorschau
 * dieselbe.
 *
 * **Warum hier und nicht in @/lib.** Dort steht Rechnung und Datenzugriff;
 * keine Datei dort baut eine `Response` oder kennt einen HTTP-Header. Diese
 * Datei tut genau das, sie gehört also zur Adresse und nicht zur Rechnung. Und
 * in eine `route.ts` darf sie auch nicht: aus einer solchen Datei nimmt Next
 * nur die Methodennamen und die Segment-Config entgegen, ein zusätzlicher
 * Export wäre ein Fehler. Übrig bleibt das Modul neben den beiden route.ts —
 * eine gewöhnliche `.ts` unter src/app, so wie die Formulare und Listen neben
 * ihren page.tsx liegen. Nur page/layout/route sind dort besondere Namen.
 *
 * Die beiden Adressen unterscheiden sich in genau einem Wort: welche der
 * beiden bytea-Spalten gelesen wird. Alles andere — Sitzung, Formatschranke,
 * Cache-Control, Content-Length, nosniff — ist an beiden gleich und stand bis
 * zuletzt zweimal da. Sicherheitsrelevante Header doppelt zu führen heißt: wer
 * einen davon härtet und die zweite Datei übersieht, macht einen Fehler, den
 * kein Compiler und kein Test bemerkt.
 *
 * **Warum überhaupt ein eigener Route Handler und nicht `next/image`.** Der
 * Bildoptimierer baut seine interne Anfrage ohne Header, also ohne
 * Session-Cookie — er bekäme von hier eine 401 und zeigte ein kaputtes Bild.
 * Käme er durch, läge das Blatt danach als optimierte Datei unter
 * `/_next/image` und damit außerhalb jeder Besitzprüfung. Ein Schulblatt gehört
 * genau einem Menschen; es hat in einem allgemeinen Bildcache nichts verloren.
 * In der Oberfläche steht deshalb ein schlichtes `<img>` mit dieser Adresse.
 *
 * **Die `id` in der Adresse ist die einer Seite, nicht die des Blattes.** Eine
 * Seite ist unveränderlich: ihre Bytes werden nie überschrieben, ein neues Foto
 * ist eine neue Zeile mit einer neuen id. Dadurch zeigt eine Adresse für immer
 * auf dasselbe Bild — und genau das erlaubt den harten Cache unten. Stünde in
 * der Adresse die id des Blattes und daneben eine Seitennummer, änderte sich
 * der Inhalt hinter der Adresse, sobald jemand eine Seite löscht; ein Jahr
 * `immutable` wäre dann eine Lüge, die man dem Browser nicht mehr austreiben
 * kann.
 *
 * `private` ist Pflicht und nicht Vorsicht: ohne dieses Wort dürfte jeder
 * geteilte Cache auf dem Weg — ein Proxy im Schulnetz, ein CDN — die Kopie
 * aufheben und einem anderen Gerät ausliefern.
 *
 * `requireUser()` steht hier bewusst nicht. Es leitet ohne Sitzung nach /login
 * um, und eine Umleitung auf eine HTML-Seite ist für ein `<img>` keine Aussage,
 * sondern ein kaputtes Bild. `getSessionUser()` und ein ehrlicher Status sagen
 * dem Browser, woran er ist.
 *
 * Für ein fremdes Blatt gibt es denselben Ausgang wie für ein nicht
 * vorhandenes: 404. Ein 403 verriete, dass es die Seite gibt — wer ids
 * durchprobiert, bekäme so eine Antwort auf eine Frage, die er nicht stellen
 * darf.
 *
 * In keiner der beiden route.ts steht ein `export const dynamic`: Route
 * Handler sind in Next 16 grundsätzlich nicht gecacht, und die Cache-Control
 * setzt diese Datei selbst. Falsch gecacht wäre hier der teuerste Fehler des
 * ganzen Vorhabens — der zweite Aufruf bekäme das Bild des ersten.
 */
export async function pageImageResponse(
  id: string,
  variant: "voll" | "vorschau",
): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return plainText("Du bist nicht angemeldet.", 401);
  }

  const page = await readPageImage(user.id, id, variant);

  // Steht in der Zeile ein Format, das die App gar nicht annimmt, ist die Zeile
  // kaputt — dann wird nichts ausgeliefert. Zusammen mit `nosniff` unten
  // schließt das die Tür dagegen, dass der Browser die Bytes als etwas anderes
  // deutet als ein Bild. Dass die Vorschau dasselbe Format trägt wie das
  // Vollbild — die Zeile hat für beide nur eine Spalte —, ist beim Aufnehmen
  // geprüft; siehe readPage() in @/app/(app)/material/actions.
  if (!page || !isAllowedMime(page.mimeType)) {
    return plainText("Dieses Blatt gibt es nicht mehr.", 404);
  }

  return new Response(page.bytes, {
    headers: {
      "Content-Type": page.mimeType,
      // Setzt sich nicht von selbst; ohne diese Zeile fehlt der Header.
      "Content-Length": String(page.bytes.byteLength),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Eine Absage in einem Satz. Ausdrücklich `no-store`: ein "gibt es nicht" von
 * heute darf nicht das Bild von morgen verstellen.
 */
function plainText(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
