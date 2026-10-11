// Kommt der Anthropic-Schlüssel in der App an, und nimmt die API ihn an?
//
// Läuft IM App-Container, mit dessen Umgebung und dessen Netz — nur dort zeigt
// sich, ob die Compose-Dateien den Schlüssel wirklich durchreichen und ob der
// Weg nach draußen offen ist. Das Bild enthält scripts/ nicht; der Text kommt
// deshalb über die Standardeingabe:
//
//   docker compose exec -T app node --input-type=module - < scripts/nas-probe-claude.mjs
//
// Gerufen von scripts/claude-einrichten.sh, und zwar zweimal. Das erste Mal,
// BEVOR irgendetwas umgestellt ist: Dann steht der Schlüssel noch nicht in der
// Umgebung der App, und das Skript reicht ihn über die Standardeingabe herein
// — der Text der Probe kommt dafür als Argument:
//
//   printf '%s' "$schluessel" | docker compose exec -T app \
//     node --input-type=module -e "$(cat scripts/nas-probe-claude.mjs)" -- --schluessel-auf-stdin
//
// So steht er in keiner Befehlszeile, in keiner Datei und in keinem Protokoll,
// und ein falscher Schlüssel hält das Einrichten an, solange der Postbote noch
// liest. Das zweite Mal danach, ohne Argument: jetzt aus der Umgebung, wie die
// App ihn liest.
//
// KOSTENLOS, und das mit Absicht: zwei Fragen, die die API nicht abrechnet.
//
//   1. `models.retrieve` — nimmt die API den Schlüssel an (sonst 401/403), und
//      darf dieser Schlüssel das Modell rufen (sonst 404)?
//   2. `messages.countTokens` mit der Form der echten Anfrage: dieselbe
//      Beta-Kennung, adaptives Denken, derselbe Aufwand, eine strukturierte
//      Antwort. Weist die API diese Form ab (400), täte sie es an jedem Blatt
//      — und jedes Blatt endete als „nichts“ und wäre gemerkt. Hier zeigt es
//      sich vorher, ohne dass ein Blatt dafür bezahlt wird. `fallbacks` und
//      `max_tokens` kennt das Zählen nicht; sie fehlen deshalb.
//
// Ob das Guthaben reicht, sagt keine der beiden Fragen — das zeigt erst der
// erste echte Lauf (402 wird dort zur Pause, nicht zu „nichts“).
//
// Die Werte unten stehen ein zweites Mal hier, weil das Bild src/ nicht
// enthält und die Probe deshalb nichts aus @/lib/claude/client importieren
// kann. Dass sie dort und hier gleich sind, prüft
// src/lib/claude/nas-probe.test.ts.
//
// Der Schlüssel selbst wird nie ausgegeben, auch nicht im Fehlerfall: die
// Meldungen der API enthalten ihn nicht, und hier steht keine Zeile, die ihn
// schriebe.
//
// Rückgabe: 0 = alles gut, 2 = kein Schlüssel, 3 = Schlüssel abgewiesen,
// 4 = Modell für diesen Schlüssel nicht verfügbar, 5 = Form der Anfrage
// abgewiesen, 1 = sonst (Netz, Überlast, Unerwartetes).

import { readFileSync } from "node:fs";

import Anthropic from "@anthropic-ai/sdk";

const MODELL = "claude-opus-5-5";
const EFFORT = "high";
const RUECKFALL_BETA = "server-side-fallback-2026-07-01";
const MAX_TOKENS = 64_000;
const API_ADRESSE = "https://api.anthropic.com";

const ausEingabe = process.argv.includes("--schluessel-auf-stdin");
const schluessel = ausEingabe
  ? readFileSync(0, "utf8").trim()
  : (process.env.ANTHROPIC_API_KEY ?? "").trim();

if (!schluessel) {
  console.log(
    ausEingabe
      ? "Claude: über die Standardeingabe kam kein Schlüssel."
      : "Claude: ANTHROPIC_API_KEY kommt in der App nicht an.",
  );
  process.exit(2);
}

// Wie in der App (anthropicSenden in src/lib/claude/client.ts): feste Adresse
// und kein Zweitschlüssel aus der Umgebung — sonst prüfte die Probe einen
// anderen Weg als den, den die App nimmt.
const client = new Anthropic({
  apiKey: schluessel,
  authToken: null,
  baseURL: API_ADRESSE,
  maxRetries: 1,
  timeout: 20_000,
});

function status(fehler) {
  return fehler instanceof Anthropic.APIError ? fehler.status : undefined;
}

function satz(fehler) {
  return fehler instanceof Error ? fehler.message.slice(0, 300) : String(fehler).slice(0, 300);
}

// ── 1. Schlüssel und Modell ────────────────────────────────────────────────
const beginn = Date.now();
let modell;
try {
  modell = await client.models.retrieve(MODELL);
} catch (fehler) {
  const code = status(fehler);
  if (code === 401 || code === 403) {
    console.log(`Claude: Die API weist den Schlüssel ab (${code}) — falsch abgeschrieben, widerrufen oder ohne Rechte.`);
    process.exit(3);
  }
  if (code === 404) {
    console.log(`Claude: ${MODELL} ist für diesen Schlüssel nicht verfügbar (404).`);
    process.exit(4);
  }
  console.log(`Claude nicht erreichbar${code ? ` (${code})` : ""}: ${satz(fehler)}`);
  process.exit(1);
}

// Nur ein ausdrückliches Nein zählt. Fehlt eine Angabe, weiß die Probe es
// nicht — und ein Fehlalarm hielte das Einrichten an, ohne dass etwas fehlt.
const faehig = modell.capabilities;
const fehlt = [];
if (faehig) {
  if (faehig.image_input?.supported === false) fehlt.push("Bilder");
  if (faehig.structured_outputs?.supported === false) fehlt.push("strukturierte Antwort");
  if (faehig.thinking?.types?.adaptive?.supported === false) fehlt.push("adaptives Denken");
  if (faehig.effort?.[EFFORT]?.supported === false) fehlt.push(`Aufwand ${EFFORT}`);
}
if (typeof modell.max_tokens === "number" && modell.max_tokens < MAX_TOKENS) {
  fehlt.push(`${MAX_TOKENS} Ausgabe-Tokens (nur ${modell.max_tokens})`);
}
if (fehlt.length > 0) {
  console.log(`Claude: ${modell.id} kann nicht, was der Leser braucht: ${fehlt.join(", ")}.`);
  process.exit(5);
}

// ── 2. Die Form der Anfrage ────────────────────────────────────────────────
let gezaehlt;
try {
  gezaehlt = await client.beta.messages.countTokens({
    model: MODELL,
    betas: [RUECKFALL_BETA],
    thinking: { type: "adaptive" },
    output_config: {
      effort: EFFORT,
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      },
    },
    system: "Probe der Schulapp.",
    messages: [{ role: "user", content: "Probe." }],
  });
} catch (fehler) {
  const code = status(fehler);
  if (code === 400) {
    console.log(`Claude: Die API weist die Form der Anfrage ab (400): ${satz(fehler)}`);
    process.exit(5);
  }
  if (code === 401 || code === 403) {
    console.log(`Claude: Beim Zählen weist die API den Schlüssel ab (${code}): ${satz(fehler)}`);
    process.exit(3);
  }
  console.log(`Claude: Zählen ging nicht${code ? ` (${code})` : ""}: ${satz(fehler)}`);
  process.exit(1);
}

console.log(
  `Claude: ${modell.display_name || modell.id} nimmt den Schlüssel an, die Form der Anfrage auch (${gezaehlt.input_tokens} Tokens gezählt), ${Date.now() - beginn} ms — nichts abgerechnet.`,
);
process.exit(0);
