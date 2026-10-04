/**
 * Jev — das Entscheidungsmodell, das ein abgeschriebenes Blatt einordnet.
 *
 * Jev von TypeSafe schreibt keinen Text. Es beantwortet festgelegte Fragen
 * (eine Auswahl, ein Ja/Nein) und nennt zu jeder Antwort, wie sicher es ist.
 * Genau das ist Einordnen: welches der dreizehn Fächer, welche der Themen.
 * Abschreiben kann es nicht, es liest keine Bilder. Das bleibt beim Postboten.
 *
 * Gemessen am 4.10.2026 an 20 schon eingeordneten Blättern: 19 Mal dasselbe
 * Fach wie der Mensch, und das zwanzigste hatte der Mensch falsch abgelegt.
 * Pro Blatt etwa 0,3 Sekunden und weit unter einem Hundertstel Cent.
 *
 * Den Unterschied machten die Themen als Hinweis am Fach. Ohne sie hielt Jev
 * Wirtschaftsgeografie (Wirtschaftssektoren, Lieferketten) mit hoher Sicherheit
 * für Sozialkunde. Mit „Geografie. Bisherige Themen: …" war das weg.
 *
 * Gefragt wird direkt bei TypeSafe und nicht über Vercel: Der Betrieb liegt
 * auf dem NAS, und ein fremdes Modell per API ist ausdrücklich in Ordnung, ein
 * Umweg über die alte Plattform nicht.
 *
 * Die Rechnung — welche Fragen gestellt werden und was aus den Antworten
 * folgt — steht in reinen Funktionen ohne Netz. Nur `askJev()` spricht mit
 * dem Dienst.
 */

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

/** Länger wartet der Postbote nicht — dann bleibt das Blatt im Korb. */
const TIMEOUT_MS = 15_000;

/**
 * Ab dieser Wahrscheinlichkeit gilt ein Thema als behandelt. Die Hälfte, weil
 * Ja/Nein die Frage ist: wahrscheinlicher ja als nein.
 */
export const TOPIC_THRESHOLD = 0.5;

/** Mehr Themen trägt kein Blatt — ein Arbeitsblatt ist kein Inhaltsverzeichnis. */
export const MAX_TOPICS = 5;

/**
 * So viel Text bekommt Jev höchstens. Das Kontextfenster ist größer
 * (32 000 Tokens); für das Fach reicht der Anfang eines Blattes, und ein
 * neunseitiges Handout soll nicht an der Grenze scheitern.
 */
export const MAX_STATE_CHARS = 12_000;

export function jevConfigured(): boolean {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };

export type JevAnswer =
  | {
      type: "choice";
      choice: string;
      confidence: number;
      probabilities: Record<string, number>;
    }
  | { type: "noul"; noul: number };

/** Ein Fach, wie es Jev zur Auswahl vorgelegt wird. */
export type JevSubject = { id: string; name: string; topics: string[] };

/**
 * Die Antwortschlüssel. Jev verlangt kurze Namen ohne Leer- und Sonderzeichen;
 * die Zählung hält sie eindeutig, auch wenn zwei Titel gleich klingen.
 */
const subjectKey = (index: number) => `f${index}`;
const topicKey = (index: number) => `t${index}`;

/**
 * Was Jev über das Blatt liest: ein Satz Rahmen, dann die Abschrift.
 *
 * Der Rahmen sagt, was die ⟨spitzen Klammern⟩ bedeuten — sonst läse Jev
 * „⟨unleserlich⟩" als Inhalt des Blattes.
 */
export function jevState(text: string): string {
  const body =
    text.length > MAX_STATE_CHARS ? text.slice(0, MAX_STATE_CHARS) : text;

  return [
    "Abschrift eines abfotografierten Schulblatts. ⟨Spitze Klammern⟩ markieren, was beim Abschreiben unsicher war.",
    "",
    body,
  ].join("\n");
}

/**
 * Die Frage nach dem Fach — jedes Fach mit den Themen, die dort schon geführt
 * werden. Die Hinweise sind der Grund, warum Jev Wirtschaftsgeografie nicht
 * für Sozialkunde hält; ohne sie fiel es bei drei von zwanzig Blättern darauf
 * herein.
 */
export function subjectQuestion(subjects: JevSubject[]): JevQuestion {
  const criteria: Record<string, string> = {};

  subjects.forEach((subject, index) => {
    criteria[subjectKey(index)] =
      subject.topics.length > 0
        ? `${subject.name}. Bisherige Themen: ${subject.topics.slice(0, 20).join(", ")}`
        : subject.name;
  });

  return {
    type: "choice",
    instructions: "Zu welchem Schulfach gehört dieses Blatt?",
    criteria,
  };
}

/** Je Thema eine Ja/Nein-Frage — ein Blatt darf mehrere Themen haben. */
export function topicQuestions(
  subjectName: string,
  topics: string[],
): Record<string, JevQuestion> {
  return Object.fromEntries(
    topics.map((topic, index) => [
      topicKey(index),
      {
        type: "noul",
        instructions: `Behandelt dieses Blatt im Fach ${subjectName} das Thema „${topic}“?`,
      } satisfies JevQuestion,
    ]),
  );
}

/** Das gewählte Fach samt Sicherheit, oder null bei einer kaputten Antwort. */
export function readSubject(
  subjects: JevSubject[],
  answer: JevAnswer | undefined,
): { subject: JevSubject; confidence: number } | null {
  if (!answer || answer.type !== "choice") return null;

  const index = subjects.findIndex((_, i) => subjectKey(i) === answer.choice);
  if (index < 0) return null;

  return { subject: subjects[index], confidence: answer.confidence };
}

/**
 * Die Themen, die Jev wahrscheinlicher bejaht als verneint, die sicherste
 * zuerst, höchstens `MAX_TOPICS`.
 */
export function readTopics(
  topics: string[],
  answers: Record<string, JevAnswer | undefined>,
): string[] {
  return topics
    .map((topic, index) => {
      const answer = answers[topicKey(index)];
      return { topic, p: answer?.type === "noul" ? answer.noul : 0 };
    })
    .filter((entry) => entry.p >= TOPIC_THRESHOLD)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_TOPICS)
    .map((entry) => entry.topic);
}

/** Ein Aufruf bei TypeSafe. Wirft bei jedem Fehler; der Aufrufer fängt. */
export async function askJev(
  state: string,
  questions: Record<string, JevQuestion>,
): Promise<{ answers: Record<string, JevAnswer>; inputTokens: number }> {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key) throw new Error("TYPESAFE_API_KEY fehlt.");

  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, state, questions }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    // Der Körper nennt den Grund (`error_type`, `message`), ins Log damit.
    throw new Error(
      `Jev antwortet mit ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }

  const body = (await response.json()) as {
    answers?: Record<string, JevAnswer>;
    usage?: { input_tokens?: number };
  };

  return {
    answers: body.answers ?? {},
    inputTokens: body.usage?.input_tokens ?? 0,
  };
}
