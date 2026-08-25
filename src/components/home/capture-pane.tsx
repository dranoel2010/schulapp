import { CameraPane } from "@/components/home/camera-pane";
import { captureSubject, type HomeData } from "@/lib/home";

/**
 * Die Kameraseite der Startseite — die linke der drei Seiten in der Wischhülle.
 *
 * Sie liegt links vom Raster, weil rechts der Kalender liegt: der Weg zur
 * Kamera ist die Wischrichtung, in der nicht der Tagesablauf steht. Am Handy
 * ist das die kürzeste Geste, die es gibt, und genau darum geht es hier — im
 * Unterricht bleiben für ein abfotografiertes Arbeitsblatt zwei Sekunden.
 *
 * **Diese Datei entscheidet nur noch, in welches Fach das nächste Blatt fällt.**
 * Alles Übrige liegt in @/components/home/camera-pane, denn was dort steht, ist
 * ein laufendes Kamerabild und damit unvermeidlich Sache des Browsers. Die
 * Fächerliste und der Vorschlag kommen dagegen mit HomeData herein — die Seite
 * könnte sie selbst holen, hinge damit aber am Ende des kritischen Pfades
 * von „/“.
 *
 * **Vorgeschlagen wird in drei Stufen, und jede ist eine schwächere Vermutung
 * als die davor:**
 *
 * 1. Das Fach der Stunde, die gerade läuft oder heute noch kommt. Das ist die
 *    einzige Stufe, die etwas weiß.
 * 2. Sonst das Fach des zuletzt aufgenommenen Blattes. Wer abends einen Stapel
 *    abfotografiert, fängt fast immer dort an, wo er aufgehört hat.
 * 3. Sonst das einzige aktive Fach, wenn es nur eines gibt.
 *
 * Früher endete diese Kette bei „dann wähl es selbst“, und die Kamera ging
 * nicht auf, bevor das geschehen war. Das war die Bremse: abends, wenn der
 * Stundenplan schweigt, stand vor jedem Foto ein Auswahlfeld. Jetzt gibt es
 * immer eine Vorbelegung — und sie steht sichtbar auf dem Kamerabild, ist mit
 * einem Antipper zu ändern, und wenn sie falsch ist, schlägt der Postbote das
 * richtige Fach vor, sobald er das Blatt liest. Eine Vermutung, die man sieht
 * und die sich später korrigiert, ist besser als ein Formular vor der Kamera.
 *
 * Ein abgewähltes Fach wird auf keiner Stufe vorgeschlagen. Der Stundenplan
 * kennt kein Archiv — eine Stunde bleibt stehen, auch wenn ihr Fach zugemacht
 * wurde —, und das zuletzt aufgenommene Blatt kann in einem Fach liegen, das
 * seitdem zugemacht wurde. Beides würde sonst still wieder aufgehen.
 */

export function CapturePane({ data }: { data: HomeData }) {
  const subjects = data.subjects;
  const isActive = (id: string) => subjects.some((subject) => subject.id === id);

  // Stufe 1: der Stundenplan. `captureSubject()` lässt abgewählte Fächer schon
  // selbst draußen; die Prüfung hier kostet nichts und hält, falls die Auswahl
  // einmal enger wird als der Stundenplan.
  const suggested = captureSubject(data);
  const fromPlan = suggested && isActive(suggested.id) ? suggested : null;

  // Stufe 2: das zuletzt aufgenommene Blatt. `data.materials` steht in der
  // Reihenfolge der Aufnahme, das erste ist also das jüngste.
  const lastUsed = data.materials.find((item) => isActive(item.subject.id));

  // Stufe 3: das einzige aktive Fach.
  const onlyActive = subjects.length === 1 ? (subjects[0] ?? null) : null;

  const preset = fromPlan ?? lastUsed?.subject ?? onlyActive ?? null;

  // Der Satz steht nur noch im Rückfallweg — dort, wo statt der Kamera der alte
  // Auslöser mit Knopf und Galerie erscheint. Auf dem Kamerabild sagt die
  // Beschriftung oben dasselbe mit einem Wort.
  const lead = preset
    ? `Das Blatt landet in ${preset.name} — ändern kannst du das danach.`
    : subjects.length > 0
      ? "Wähl das Fach, in das die Aufnahme gehört."
      : data.subjectCount > 0
        ? "Alle deine Fächer sind archiviert."
        : "Noch kein Fach angelegt.";

  return (
    <CameraPane
      subjects={subjects}
      presetSubjectId={preset?.id ?? null}
      today={data.today}
      allArchived={subjects.length === 0 && data.subjectCount > 0}
      lead={lead}
    />
  );
}
