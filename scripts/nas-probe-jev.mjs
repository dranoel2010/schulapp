// Kommt der Jev-Schlüssel in der App an, und antwortet Jev?
//
// Läuft IM App-Container, mit dessen Umgebung — nur dort zeigt sich, ob die
// Compose-Datei den Schlüssel wirklich durchreicht. Das Bild enthält scripts/
// nicht; der Text kommt deshalb über die Standardeingabe:
//
//   docker compose exec -T app node --input-type=module - < scripts/nas-probe-jev.mjs
//
// Gerufen von scripts/jev-und-docling.sh. Eine Frage mit eindeutiger Antwort
// (Photosynthese → Biologie), Kosten weit unter einem Hundertstel Cent. Der
// Schlüssel selbst wird nie ausgegeben, auch nicht im Fehlerfall.
//
// Rückgabe: 0 = Jev hat richtig geantwortet, 2 = Schlüssel fehlt, 1 = sonst.

const key = process.env.TYPESAFE_API_KEY;
if (!key) {
  console.log("Jev: TYPESAFE_API_KEY kommt in der App nicht an.");
  process.exit(2);
}

const start = Date.now();
try {
  const response = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "jev-latest",
      state:
        "Arbeitsblatt: Die Photosynthese. Chloroplasten wandeln Lichtenergie in chemische Energie um.",
      questions: {
        fach: {
          type: "choice",
          instructions: "Zu welchem Schulfach gehört dieses Blatt?",
          criteria: { bio: "Biologie", ma: "Mathematik", de: "Deutsch" },
        },
      },
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const text = await response.text();
  if (!response.ok) {
    console.log(`Jev antwortet mit ${response.status}: ${text.slice(0, 200)}`);
    process.exit(1);
  }

  const answer = JSON.parse(text).answers?.fach;
  const percent = Math.round((answer?.confidence ?? 0) * 100);
  console.log(
    `Jev: ${answer?.choice ?? "keine Antwort"} (${percent} %), ${Date.now() - start} ms`,
  );
  process.exit(answer?.choice === "bio" ? 0 : 1);
} catch (error) {
  console.log(`Jev nicht erreichbar: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}
