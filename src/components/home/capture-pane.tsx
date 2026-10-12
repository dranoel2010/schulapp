import { CameraPane } from "@/components/home/camera-pane";
import { captureSubject, type HomeData } from "@/lib/home";

/** Der Kamera-Tab übernimmt weiterhin die bestehende Fachvorbelegung. */

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
