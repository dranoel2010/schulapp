import { asciiFileName } from "@/lib/pdf/filename";
import { renderSubjectPdf } from "@/lib/pdf/subject-pdf";
import { getSessionUser } from "@/lib/session";

/**
 * Die Auslieferung des Fach-PDF.
 *
 * **Warum hier und nicht in @/lib.** Aus demselben Grund wie bei
 * ../../../material/[id]/page-image-response.ts, und der steht dort
 * ausgeschrieben: in @/lib steht Rechnung und Datenzugriff, keine Datei dort
 * baut eine `Response` oder kennt einen HTTP-Header. In eine `route.ts` darf
 * das auch nicht — daraus nimmt Next nur die Methodennamen und die
 * Segment-Config entgegen, jeder weitere Export wäre ein Fehler. Übrig bleibt
 * das Modul daneben.
 *
 * Gebaut wird das Dokument in @/lib/pdf/subject-pdf; hier steht nur, was aus
 * dem Ergebnis eine Antwort macht.
 *
 * ── Die drei Header, und warum keiner davon abgeschrieben ist ────────────────
 *
 * **`Cache-Control: private, no-store`.** Nebenan, bei den Seitenbildern, steht
 * `private, max-age=31536000, immutable` — und das darf hier NICHT stehen. Der
 * Grund für den harten Cache dort ist, dass die Bytes einer Seite
 * unveränderlich sind: eine Seite bekommt beim Aufnehmen ihre id und wird nie
 * überschrieben. Ein Fach-PDF ist das Gegenteil. Es ändert sich mit jedem
 * neuen Blatt, mit jeder richtiggestellten Abschrift und mit jedem
 * zugeordneten Thema, und seine Adresse bleibt dabei dieselbe. Ein Jahr
 * `immutable` wäre eine Zusage, die schon am nächsten Schultag falsch ist —
 * und die man einem Browser nicht mehr austreiben kann.
 *
 * `no-store` und nicht `no-cache`: das Dokument trägt den Inhalt der Blätter
 * eines Menschen, und `no-store` sagt allen Zwischenstationen, dass davon
 * nirgends eine Kopie liegen bleiben soll. Dieselbe Überlegung, die in
 * KONZEPT.md dazu geführt hat, Schulblätter aus dem Cache des Service Workers
 * herauszuhalten.
 *
 * **`Content-Disposition: attachment`.** Der Header kam im Projekt bisher
 * nicht vor. Ohne ihn benennt der Browser die Datei nach dem letzten Stück der
 * Adresse — sie hieße „pdf", ohne Endung. Mit ihm heißt sie „Mathematik
 * 2026-09-05.pdf".
 *
 * `attachment` und nicht `inline`, obwohl `inline` einen Handgriff spart (das
 * PDF ginge sofort im Betrachter auf, statt erst im Download-Ordner zu
 * landen). Der Ausschlag: dieses Dokument besteht zu großen Teilen aus Text,
 * den die App nicht selbst geschrieben hat — eine Abschrift kommt von einem
 * abfotografierten Blatt über einen Agenten herein. Ein `inline` ausgeliefertes
 * PDF öffnet der Browser im Zusammenhang DIESER Herkunft. pdfkit schreibt Text
 * als Text und baut keine Aktionen ins Dokument, ein Weg hinein ist also nicht
 * bekannt; aber der Handgriff, den `attachment` kostet, ist ein Antippen im
 * Download-Balken, und dafür braucht es keinen bekannten Weg.
 *
 * Der Name steht zweimal im Header, wie es RFC 6266 vorsieht: einmal als
 * `filename=` in reinem ASCII für alles Alte, einmal als `filename*=UTF-8''…`
 * in Prozentschreibweise. Ohne die zweite Form würde aus „Französisch"
 * irgendetwas; ohne die erste hätte ein sehr alter Betrachter gar keinen Namen.
 * `encodeURIComponent()` lässt keine Anführungszeichen und keine Umbrüche
 * durch, der Header kann also nicht zerrissen werden.
 *
 * **`X-Content-Type-Options: nosniff`**, wie bei den Bildern nebenan: der
 * Browser soll die Bytes als das nehmen, was der Content-Type sagt, und nicht
 * selbst raten.
 *
 * ── Sitzung und Besitz ───────────────────────────────────────────────────────
 *
 * `getSessionUser()` und nicht `requireUser()`, wieder wie nebenan: letzteres
 * leitet ohne Sitzung nach /login um, und eine HTML-Seite mit dem Namen einer
 * PDF-Datei ist keine Auskunft. Ein ehrlicher Status ist eine.
 *
 * Die Besitzprüfung liegt vollständig in `renderSubjectPdf()`: `getSubject()`
 * filtert nach `userId`, und jede Abfrage darunter tut es auch — bei den
 * Seiten über den Verbund auf `materials`, weil an `material_pages` keine
 * `userId` hängt. Ein fremdes Fach und ein Fach, das es nicht gibt, kommen
 * beide als `null` zurück und werden beide zu 404. Ein 403 verriete, dass es
 * das Fach gibt.
 */
export async function subjectPdfResponse(subjectId: string): Promise<Response> {
  const user = await getSessionUser();
  if (!user) {
    return plainText("Du bist nicht angemeldet.", 401);
  }

  const pdf = await renderSubjectPdf(user.id, subjectId);

  if (!pdf) {
    return plainText("Dieses Fach gibt es nicht.", 404);
  }

  return new Response(pdf.bytes, {
    headers: {
      "Content-Type": "application/pdf",
      // Setzt sich nicht von selbst; ohne diese Zeile fehlt der Header, und
      // der Browser kann keinen Fortschritt anzeigen.
      "Content-Length": String(pdf.bytes.byteLength),
      "Content-Disposition": contentDisposition(pdf.fileName),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Der `Content-Disposition`-Wert mit dem Dateinamen in beiden Formen.
 *
 * Die ASCII-Fassung steht in Anführungszeichen; `asciiFileName()` lässt keine
 * durch, sie können den Wert also nicht vorzeitig schließen.
 */
function contentDisposition(fileName: string): string {
  const ascii = asciiFileName(fileName);

  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/**
 * Eine Absage in einem Satz — Wortlaut und Aufbau wie bei den Seitenbildern.
 * Ausdrücklich `no-store`: ein „gibt es nicht" von heute darf nicht das PDF
 * von morgen verstellen.
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
