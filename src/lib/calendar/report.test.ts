import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readCalendarConfig } from "@/lib/calendar/config";
import {
  cronFailure,
  cronStaleSince,
  deriveState,
  summarize,
  type CalendarCronSummary,
} from "@/lib/calendar/report";

const OK = readCalendarConfig({
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "geheim",
  GOOGLE_TOKEN_KEY: Buffer.alloc(32, 1).toString("base64"),
});
const MISSING = readCalendarConfig({});

const NOW = new Date("2026-10-05T12:00:00Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3_600_000);

describe("deriveState", () => {
  it("nicht eingerichtet, sobald die Umgebung fehlt — egal, was in der Zeile steht", () => {
    const state = deriveState({
      config: MISSING,
      row: { refreshTokenEnc: "v1.a.b.c", blockedAt: null, blockedReason: null },
    });

    assert.equal(state.kind, "nicht-eingerichtet");
    assert.ok(state.kind === "nicht-eingerichtet");
    assert.deepEqual(state.missing, ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_TOKEN_KEY"]);
  });

  it("getrennt ohne Zeile und ohne Token", () => {
    assert.equal(deriveState({ config: OK, row: null }).kind, "getrennt");
    assert.equal(
      deriveState({
        config: OK,
        row: { refreshTokenEnc: null, blockedAt: null, blockedReason: null },
      }).kind,
      "getrennt",
    );
  });

  it("blockiert mit Grund und Zeitpunkt", () => {
    const since = hoursAgo(5);
    const state = deriveState({
      config: OK,
      row: { refreshTokenEnc: "v1.a.b.c", blockedAt: since, blockedReason: "kalender" },
    });

    assert.deepEqual(state, { kind: "blockiert", reason: "kalender", since });
  });

  it("nimmt bei einem unbekannten Grund „zugang“", () => {
    const state = deriveState({
      config: OK,
      row: { refreshTokenEnc: "v1.a.b.c", blockedAt: NOW, blockedReason: "???" },
    });

    assert.ok(state.kind === "blockiert");
    assert.equal(state.reason, "zugang");
  });

  it("verbunden", () => {
    assert.deepEqual(
      deriveState({
        config: OK,
        row: { refreshTokenEnc: "v1.a.b.c", blockedAt: null, blockedReason: null },
      }),
      { kind: "verbunden" },
    );
  });
});

describe("cronStaleSince", () => {
  it("schweigt bei einer frischen Verbindung ohne Cron", () => {
    assert.equal(cronStaleSince({ connectedAt: hoursAgo(1), lastCronAt: null }, NOW), null);
  });

  it("schweigt, wenn der Cron vor einer Stunde lief", () => {
    assert.equal(
      cronStaleSince({ connectedAt: hoursAgo(100), lastCronAt: hoursAgo(1) }, NOW),
      null,
    );
  });

  it("warnt, wenn der Cron vor drei Stunden zuletzt lief", () => {
    const last = hoursAgo(3);

    assert.equal(cronStaleSince({ connectedAt: hoursAgo(100), lastCronAt: last }, NOW), last);
  });

  it("warnt seit dem Verbinden, wenn er nie lief", () => {
    const connectedAt = hoursAgo(3);

    assert.equal(cronStaleSince({ connectedAt, lastCronAt: null }, NOW), connectedAt);
  });
});

describe("summarize", () => {
  const zero = { neu: 0, geaendert: 0, entfernt: 0, verworfen: 0, ausstehend: 0 };

  it("sagt „nichts zu tun“, wenn alles null ist", () => {
    assert.equal(summarize(zero), "nichts zu tun");
  });

  it("nennt nur, was nicht null ist", () => {
    assert.equal(
      summarize({ neu: 2, geaendert: 1, entfernt: 1, verworfen: 1, ausstehend: 3 }),
      "2 neu, 1 geändert, 1 entfernt, 1 von dir gelöscht, 3 Termine noch offen",
    );
    assert.equal(summarize({ ...zero, geaendert: 4 }), "4 geändert");
  });

  it("unterscheidet Einzahl und Mehrzahl bei „noch offen“", () => {
    assert.equal(summarize({ ...zero, ausstehend: 1 }), "1 Termin noch offen");
    assert.equal(summarize({ ...zero, ausstehend: 2 }), "2 Termine noch offen");
  });
});

describe("cronFailure", () => {
  function summary(overrides: Partial<CalendarCronSummary> = {}): CalendarCronSummary {
    return {
      date: "2026-10-05",
      verbunden: 1,
      blockiert: 0,
      mitFehlern: 0,
      neu: 0,
      geaendert: 0,
      entfernt: 0,
      verworfen: 0,
      ausstehend: 0,
      unveraendert: 12,
      missing: [],
      saetze: [],
      ...overrides,
    };
  }

  it("meldet fehlende Variablen, wenn etwas verbunden ist", () => {
    const satz = cronFailure(summary({ missing: ["GOOGLE_TOKEN_KEY"] }));

    assert.ok(satz?.includes("GOOGLE_TOKEN_KEY"), satz ?? "");
    assert.ok(satz?.includes("docker-compose.override.yml"), satz ?? "");
  });

  it("lässt fehlende Variablen ohne Verbindung durch — die Funktion ist dann aus", () => {
    assert.equal(cronFailure(summary({ verbunden: 0, missing: ["GOOGLE_CLIENT_ID"] })), null);
  });

  it("meldet eine blockierte Verbindung mit ihrem Satz", () => {
    const satz = cronFailure(
      summary({ blockiert: 1, saetze: ["Den Kalender „Schule“ gibt es in Google nicht mehr."] }),
    );

    assert.ok(satz?.startsWith("Der Google Kalender ist blockiert: Den Kalender"), satz ?? "");
  });

  it("meldet Fehler mit dem Weg ins Protokoll", () => {
    const satz = cronFailure(summary({ mitFehlern: 1, saetze: ["„HA Mathe“: kaputt"] }));

    assert.ok(satz?.includes("teilweise gescheitert: „HA Mathe“: kaputt"), satz ?? "");
    assert.ok(satz?.includes("grep Google-Kalender"), satz ?? "");
  });

  it("lässt einen Lauf mit nur ausstehenden Terminen grün", () => {
    assert.equal(cronFailure(summary({ ausstehend: 40 })), null);
  });

  it("lässt einen sauberen Lauf grün", () => {
    assert.equal(cronFailure(summary()), null);
  });
});
