import { errorText } from "@/lib/calendar/error-text";
import { getConnection } from "@/lib/calendar/store";
import { addDays, berlinDay, formatGerman, timeInBerlin } from "@/lib/dates";
import { listAllFreePeriods, type FreeRange } from "@/lib/free-days";
import { beurteileEinzeln } from "@/lib/iserv/auswahl";
import {
  createIservClient,
  IservFehler,
  sitzungsSpeicher,
  type IservFehlerArt,
  type SitzungsSpeicher,
} from "@/lib/iserv/client";
import {
  EVENTSOURCES_PATH,
  FENSTER_VOR_TAGE,
  FENSTER_ZURUECK_TAGE,
  iservConfig,
  LAUF_BUDGET_CRON_MS,
  type IservConfig,
} from "@/lib/iserv/config";
import {
  klassenProblem,
  klasseVeraltet,
  parseAufgabenFeed,
  parseEventSources,
  parseKalenderFeed,
} from "@/lib/iserv/parse";
import { leseQuellen, STALE_MS, type BlockGrund } from "@/lib/iserv/report";
import { pruefe, type Pruefung, type QuellAntwort, type Snapshot } from "@/lib/iserv/schutz";
import { iservStore, type IservStore } from "@/lib/iserv/store";
import { faellig } from "@/lib/iserv/takt";
import {
  ISERV_QUELLEN,
  QUELL_NAMEN,
  type ErkannteQuelle,
  type IservLaufStatus,
  type IservQuelle,
} from "@/lib/iserv/types";
import { sendToUser, type PushPayload } from "@/lib/push";

/**
 * Ein Abruf bei IServ — der Ablauf, der Netz, Rechnung und Datenbank
 * zusammensetzt.
 *
 * Ein Lauf geht in dieser Reihenfolge:
 *
 *   1. Zustand lesen. Blockiert → kein Netz. Nicht fällig (@/lib/iserv/takt)
 *      → kein Netz.
 *   2. Die App-Seite, VOR dem Netz: die gespeicherten Snapshots und die
 *      freien Tage. Eine kaputte Datenbank soll niemanden bei IServ anmelden.
 *   3. eventsources: Welche Kalender gibt es, welcher ist der der Klasse?
 *   4. Die Feeds, NACHEINANDER (höflich, nicht parallel): öffentlicher
 *      Kalender, Klassenkalender, Aufgaben — im Fenster heute −14 bis +365.
 *   5. Je Quelle der Schutz (@/lib/iserv/schutz): übernehmen, behalten oder
 *      Fehler.
 *   6. Festhalten, in EINER kurzen Transaktion, nachdem alles Netz vorbei ist.
 *
 * Der Abgleich mit Google liest danach nur noch die Snapshots
 * (`iservSource` in @/lib/calendar/sources). Gerufen wird dieser Lauf vom
 * stündlichen Kalender-Cron (vor dessen Abgleichen, damit sie schon den
 * frischen Stand sehen) und vom Knopf „Erneut versuchen" — sonst nie.
 *
 * ── Immer nur ein Abruf zur Zeit ─────────────────────────────────────────────
 *
 * Zwei gleichzeitige Abrufe hießen womöglich zwei Anmeldungen. Die Sperre lebt
 * im Speicher, an `globalThis` (wie die Queue in @/lib/calendar/sync): Wer
 * kommt, während einer läuft, wartet auf dessen Ergebnis — höchstens bis zu
 * seiner eigenen Frist, dann bekommt er „laeuft-schon".
 *
 * ── Nichts scheitert still, nichts plaudert ──────────────────────────────────
 *
 * Ein Fehler steht in der Karte, als EINE Push-Nachricht beim Übergang nach
 * „blockiert" (und eine, wenn seit einem Tag nichts ankam, und eine, wenn die
 * Klasse nicht mehr stimmt), als 500 des Kalender-Crons und im
 * Container-Protokoll mit dem Präfix „IServ:". Ins
 * Protokoll kommen nur Zustand, Zahlen und feste Sätze — nie ein Titel, nie
 * der Benutzer, nie eine Adresse mit Query. Push-Nachrichten sind feste Sätze
 * ohne Text aus IServ.
 */

export type AbrufErgebnis = {
  status: IservLaufStatus;
  satz: string | null;
  warnung: string | null;
};

export type AbrufDeps = {
  config: IservConfig;
  store: IservStore;
  freieZeiten(userId: string): Promise<FreeRange[]>;
  fetch?: typeof fetch;
  speicher: SitzungsSpeicher;
  push(userId: string, payload: PushPayload): Promise<unknown>;
  now?: () => number;
};

const SPERR_PUSH_TITEL: Record<BlockGrund, string> = {
  abgelehnt: "IServ: Anmeldung abgelehnt",
  "zweiter-faktor": "IServ verlangt einen zweiten Faktor",
  gesperrt: "IServ: Konto gesperrt",
  captcha: "IServ verlangt ein Captcha",
  "passwort-abgelaufen": "IServ: Passwort abgelaufen",
};

/** Die eine Nachricht beim Eintritt in „blockiert". */
export function sperrPush(grund: IservFehlerArt): PushPayload {
  return {
    title: SPERR_PUSH_TITEL[grund as BlockGrund] ?? SPERR_PUSH_TITEL.abgelehnt,
    body: "Die Schulapp kommt nicht mehr in IServ und versucht es nicht noch einmal. In den Einstellungen steht, was zu tun ist.",
    url: "/einstellungen#iserv",
    tag: "schulapp-iserv",
  };
}

export const VERALTET_PUSH: PushPayload = {
  title: "IServ seit einem Tag nicht gelesen",
  body: "Die IServ-Termine im Kalender „Schule“ sind womöglich nicht aktuell. Details in den Einstellungen.",
  url: "/einstellungen#iserv",
  tag: "schulapp-iserv",
};

/**
 * Die eine Nachricht, wenn die Einstellung der Klasse nicht mehr passt
 * (`klassenProblem()` in @/lib/iserv/parse) — beim Übergang, nicht bei jedem
 * Lauf. Fest, ohne Text aus IServ.
 */
export const KLASSE_PUSH: PushPayload = {
  title: "IServ: Klasse prüfen",
  body: "Die Schulapp erkennt den Kalender deiner Klasse in IServ nicht mehr eindeutig (neues Schuljahr?). Bis das geklärt ist, nimmt sie keine neuen Klassentermine auf. In den Einstellungen steht, was zu tun ist.",
  url: "/einstellungen#iserv",
  tag: "schulapp-iserv",
};

/** Warum eine Quelle fehlt — fest, ohne Text aus IServ. */
const FEHLT_GRUND: Record<IservQuelle, string> = {
  oeffentlich: "Den öffentlichen Kalender gibt es in IServ nicht mehr.",
  klasse: "Klassenkalender: In IServ ist kein Kalender deiner Klasse mehr zu finden.",
  aufgaben: "Aufgaben: IServ bietet kein Aufgaben-Plugin mehr an.",
};

function echteDeps(config: IservConfig): AbrufDeps {
  return {
    config,
    store: iservStore,
    freieZeiten: listAllFreePeriods,
    speicher: sitzungsSpeicher(),
    push: sendToUser,
  };
}

type Lauf = { promise: Promise<AbrufErgebnis> };

function laufSperre(): { aktuell: Lauf | null } {
  const global = globalThis as unknown as { __schulappIservLauf?: { aktuell: Lauf | null } };
  return (global.__schulappIservLauf ??= { aktuell: null });
}

/** Läuft gerade ein Abruf? Für „liest gerade" in der Karte. */
export function isIservFetchRunning(): boolean {
  return laufSperre().aktuell !== null;
}

/**
 * Ein Abruf für diesen Nutzer. Wirft nie: Was schiefgeht, steht im Ergebnis,
 * in der Datenbank und im Protokoll.
 */
export function runIservFetch(
  userId: string,
  opts: { anlass: "cron" | "hand"; jetzt: Date; deadline: number },
  deps?: AbrufDeps,
): Promise<AbrufErgebnis> {
  const sperre = laufSperre();

  if (sperre.aktuell) {
    const laufend = sperre.aktuell.promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const zuLange = new Promise<AbrufErgebnis>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            status: "laeuft-schon",
            satz: "Ein Abruf bei IServ lief schon und war bis zum Ende der Wartezeit nicht fertig; sein Ergebnis steht danach in den Einstellungen.",
            warnung: null,
          }),
        Math.max(0, opts.deadline - Date.now()),
      );
    });
    return Promise.race([laufend, zuLange]).finally(() => clearTimeout(timer));
  }

  // Die Sperre steht, BEVOR der Lauf beginnt: Endet er ohne ein einziges
  // await (keine Umgebung), räumt sein `finally` sie sonst ab, bevor sie
  // gesetzt ist — und sie bliebe für immer stehen.
  const lauf: Lauf = { promise: Promise.resolve({ status: "aus", satz: null, warnung: null }) };
  sperre.aktuell = lauf;
  lauf.promise = (async () => {
    try {
      let wirklich = deps;
      if (!wirklich) {
        const cfg = iservConfig();
        if (!cfg.ok) return { status: "aus", satz: null, warnung: null } satisfies AbrufErgebnis;
        wirklich = echteDeps(cfg.config);
      }
      return await abrufen(userId, opts, wirklich);
    } finally {
      if (sperre.aktuell === lauf) sperre.aktuell = null;
    }
  })();

  return lauf.promise;
}

async function abrufen(
  userId: string,
  opts: { anlass: "cron" | "hand"; jetzt: Date; deadline: number },
  deps: AbrufDeps,
): Promise<AbrufErgebnis> {
  const { store, config } = deps;
  const zugang = config.zugang;
  const jetzt = opts.jetzt;

  try {
    // 1. Zustand.
    await store.ensureState(userId);
    const zustand = await store.readState(userId);

    if (zustand?.blockedAt) {
      return { status: "blockiert", satz: zustand.lastError ?? "IServ ist blockiert.", warnung: null };
    }
    if (!faellig({ jetzt, zustand, anlass: opts.anlass })) {
      return { status: "nicht-faellig", satz: null, warnung: null };
    }

    // 2. Die App-Seite, vor dem Netz.
    const alt = await store.readSnapshots(userId);
    const freie = await deps.freieZeiten(userId);

    const client = createIservClient(zugang, {
      fetch: deps.fetch,
      now: deps.now,
      deadline: opts.deadline,
      speicher: deps.speicher,
    });

    const sperren = async (fehler: IservFehler): Promise<AbrufErgebnis> => {
      const erste = await store.blockIserv(userId, fehler.art, fehler.satz);
      if (erste) {
        try {
          await deps.push(userId, sperrPush(fehler.art));
        } catch (problem) {
          console.error("IServ: Push-Nachricht nicht verschickt", errorText(problem));
        }
      }
      console.error("IServ: blockiert", fehler.art);
      return { status: "blockiert", satz: fehler.satz, warnung: null };
    };

    // 3. eventsources.
    let erkannt: { quellen: ErkannteQuelle[]; hinweise: string[]; problem: string | null };
    try {
      erkannt = parseEventSources(await client.getJson(EVENTSOURCES_PATH), zugang.origin, {
        klasse: config.klasse,
        klassenkalender: config.klassenkalender,
      });
    } catch (fehler) {
      if (!(fehler instanceof IservFehler)) throw fehler;
      if (fehler.sperrt) return await sperren(fehler);

      await store.saveRun(userId, {
        attemptAt: jetzt,
        success: false,
        snapshots: [],
        error: fehler.satz,
        warning: null,
      });
      console.error("IServ: fehler", fehler.satz);
      return { status: "fehler", satz: fehler.satz, warnung: null };
    }

    // 4. Die Feeds, nacheinander.
    const heute = berlinDay(jetzt);
    const fensterStart = addDays(heute, -FENSTER_ZURUECK_TAGE);
    const params = { start: fensterStart, end: addDays(heute, FENSTER_VOR_TAGE) };

    const warnungen: string[] = [...erkannt.hinweise];
    const antworten = new Map<IservQuelle, QuellAntwort>();
    let felder: string[] | null = null;

    for (const quelle of ["oeffentlich", "klasse", "aufgaben"] as const) {
      const q = erkannt.quellen.find((kandidat) => kandidat.rolle === quelle && kandidat.url);
      if (!q?.url) {
        // Stimmt die Einstellung der Klasse nicht, ist der Klassenkalender
        // nicht leer, sondern unbekannt: ein Fehler, der alte Stand bleibt.
        antworten.set(
          quelle,
          quelle === "klasse" && erkannt.problem
            ? { art: "fehler", fehler: { art: "fehlt", sperrt: false, satz: erkannt.problem } }
            : { art: "fehlt", grund: FEHLT_GRUND[quelle] },
        );
        continue;
      }

      try {
        const json = await client.getJson(q.url, params);

        if (quelle === "aufgaben") {
          const gelesen = parseAufgabenFeed(json, q.label, zugang.origin);
          if (gelesen.items.length > 0) felder = gelesen.felder;
          if (gelesen.unlesbar > 0) {
            warnungen.push(`${gelesen.unlesbar} Einträge von „${QUELL_NAMEN[quelle]}“ unlesbar übersprungen.`);
          }
          antworten.set(quelle, { art: "ok", items: gelesen.items, remoteId: q.id, label: q.label });
        } else {
          const gelesen = parseKalenderFeed(json, quelle, q.label);
          if (gelesen.unlesbar > 0) {
            warnungen.push(`${gelesen.unlesbar} Einträge von „${QUELL_NAMEN[quelle]}“ unlesbar übersprungen.`);
          }
          antworten.set(quelle, { art: "ok", items: gelesen.items, remoteId: q.id, label: q.label });
        }
      } catch (fehler) {
        if (!(fehler instanceof IservFehler)) throw fehler;
        if (fehler.sperrt) return await sperren(fehler);

        // Auch ein 404 auf einen Feed, den eventsources gerade eben genannt
        // hat, ist ein Fehler und kein leerer Kalender.
        antworten.set(quelle, { art: "fehler", fehler });
      }
    }

    // 5. Der Schutz, je Quelle — mit dem Urteil von jetzt fürs Einfrieren.
    const filter = {
      klasse: config.klasse,
      auch: config.auch,
      nie: config.nie,
      klasseUnsicher: klasseVeraltet(erkannt.quellen, config.klasse, config.klassenkalender),
    };
    const beurteile = (item: Parameters<typeof beurteileEinzeln>[0]) => {
      const u = beurteileEinzeln(item, filter, freie);
      return { genommen: u.genommen, regel: u.regel };
    };

    const zuSchreiben: Snapshot[] = [];
    const pruefungen = new Map<IservQuelle, Pruefung>();

    for (const quelle of ISERV_QUELLEN) {
      const antwort = antworten.get(quelle);
      const altSnap = alt.get(quelle) ?? null;
      if (!antwort) continue;
      // Eine Quelle, die es nicht gibt und nie gab: nichts zu schützen, nichts zu schreiben.
      if (antwort.art === "fehlt" && altSnap === null && quelle !== "oeffentlich") continue;

      const pruefung = pruefe({ quelle, alt: altSnap, antwort, fensterStart, jetzt, beurteile });
      pruefungen.set(quelle, pruefung);
      if (pruefung.neu) zuSchreiben.push(pruefung.neu);
      if (pruefung.warnung) warnungen.push(pruefung.warnung);
    }

    const oeffentlich = pruefungen.get("oeffentlich");
    const success = oeffentlich !== undefined && oeffentlich.entscheidung !== "fehler";
    // Der öffentliche Kalender zuerst: Scheitert er, ist er der Grund für „fehler".
    const fehlerSaetze = (["oeffentlich", "klasse", "aufgaben"] as const)
      .flatMap((quelle) => {
        const p = pruefungen.get(quelle);
        return p ? [[quelle, p] as const] : [];
      })
      .filter(([, p]) => p.entscheidung === "fehler")
      .map(([quelle, p]) => `${QUELL_NAMEN[quelle]}: ${p.satz ?? "unbekannter Fehler"}`);

    const status: IservLaufStatus = !success ? "fehler" : fehlerSaetze.length > 0 ? "teilweise" : "gelesen";
    const satz =
      fehlerSaetze.length === 0
        ? null
        : fehlerSaetze[0] + (fehlerSaetze.length > 1 ? ` (und ${fehlerSaetze.length - 1} weitere)` : "");
    if (status === "teilweise") warnungen.push(...fehlerSaetze);

    // Die Feldnamen der ersten nicht leeren Aufgaben-Antwort — einmal.
    let exerciseFields: string | undefined;
    if (felder && felder.length > 0 && !zustand?.exerciseFields) {
      exerciseFields = felder.join(", ");
      console.info("IServ: Aufgaben-Format (nur Feldnamen):", felder);
    }

    // 6. Festhalten — die Feed-Adressen ohne Query.
    const sourcesJson = JSON.stringify(
      erkannt.quellen.map((q) => ({ ...q, url: q.url ? new URL(q.url).pathname : null })),
    );
    const warnung = warnungen.length > 0 ? warnungen.join(" ") : null;

    await store.saveRun(userId, {
      attemptAt: jetzt,
      success,
      snapshots: zuSchreiben,
      error: success ? null : satz,
      warning: warnung,
      sourcesJson,
      exerciseFields,
    });

    const zahlen = ISERV_QUELLEN.map((quelle) => {
      const a = antworten.get(quelle);
      return `${quelle}=${a?.art === "ok" ? a.items.length : (a?.art ?? "-")}`;
    }).join(" ");

    if (status === "gelesen") {
      console.info("IServ: gelesen", zahlen, `Anmeldungen=${client.logins}`, `Hinweise=${warnungen.length}`);
    } else {
      console.error("IServ:", status, satz, zahlen);
    }

    // Die Klasse stimmt nicht (mehr): EINE Push-Nachricht beim Übergang. Der
    // Vergleich läuft gegen die zuletzt gespeicherte Liste der Kalender.
    if (erkannt.problem) {
      const vorher = leseQuellen(zustand?.sourcesJson ?? "[]");
      const warSchon =
        vorher.length > 0 &&
        klassenProblem(vorher, { klasse: config.klasse, klassenkalender: config.klassenkalender }) !== null;

      if (!warSchon) {
        try {
          await deps.push(userId, KLASSE_PUSH);
        } catch (problem) {
          console.error("IServ: Push-Nachricht nicht verschickt", errorText(problem));
        }
      }
    }

    return { status, satz, warnung };
  } catch (unerwartet) {
    // Nur der Satz aus `errorText()`, geschwärzt: Eine gescheiterte Abfrage
    // trüge sonst ihre Parameter (Titel aus IServ) mit.
    const satz = zugang.schwaerze(`Der Abruf bei IServ ist abgebrochen: ${errorText(unerwartet)}`);
    console.error("IServ: Lauf abgebrochen", satz);

    try {
      await store.saveRun(userId, { attemptAt: jetzt, success: false, snapshots: [], error: satz, warning: null });
    } catch (auchDas) {
      console.error("IServ: Abbruch nicht festgehalten", errorText(auchDas));
    }

    return { status: "fehler", satz, warnung: null };
  }
}

/** „Mo, 5.10. 21:15" — für den Satz im Cron. */
function zeitpunkt(wann: Date): string {
  return `${formatGerman(berlinDay(wann), "kurz")} ${timeInBerlin(wann)}`;
}

/**
 * Der Teil des stündlichen Kalender-Crons, der IServ betrifft — gerufen von
 * `runCalendarCron()` in @/lib/calendar/sync, nach dem Vermerk des Crons und
 * VOR den Abgleichen. Wirft nie.
 *
 * IServ ist für genau einen Nutzer gedacht: den, der den Google Kalender
 * verbunden hat. Ohne verbundenen Kalender ruht IServ — es hätte nichts,
 * wohin es die Termine trägt; ist die Verbindung blockiert, meldet sich der
 * Kalender selbst laut.
 *
 * Danach die Prüfung „seit einem Tag nichts": Dann geht EINE Push-Nachricht
 * hinaus, und jede Stunde, in der kein Abruf fällig war, wird zum Fehler —
 * der Cron meldet 500, bis wieder ein Stand ankommt.
 */
export async function runIservCron(connectedIds: readonly string[], start: number): Promise<AbrufErgebnis> {
  try {
    if (!iservConfig().ok) return { status: "aus", satz: null, warnung: null };
    if (connectedIds.length === 0) {
      return { status: "ruht", satz: "Google Kalender nicht verbunden.", warnung: null };
    }
    if (connectedIds.length > 1) {
      return {
        status: "fehler",
        satz: `IServ ist für genau einen verbundenen Nutzer gedacht; es sind ${connectedIds.length}.`,
        warnung: null,
      };
    }

    const userId = connectedIds[0];
    const verbindung = await getConnection(userId);
    if (verbindung?.blockedAt) {
      return { status: "ruht", satz: "Die Verbindung zum Google Kalender ist unterbrochen.", warnung: null };
    }

    const jetzt = new Date();
    let ergebnis = await runIservFetch(userId, {
      anlass: "cron",
      jetzt,
      deadline: start + LAUF_BUDGET_CRON_MS,
    });

    const zustand = await iservStore.readState(userId);
    if (zustand && !zustand.blockedAt) {
      const seit = zustand.lastSuccessAt ?? zustand.createdAt;

      if (jetzt.getTime() - seit.getTime() > STALE_MS) {
        if (await iservStore.markStaleNotified(userId)) {
          try {
            await sendToUser(userId, VERALTET_PUSH);
          } catch (problem) {
            console.error("IServ: Push-Nachricht nicht verschickt", errorText(problem));
          }
        }

        if (ergebnis.status === "nicht-faellig") {
          ergebnis = {
            status: "fehler",
            satz: zustand.lastSuccessAt
              ? `IServ seit über 24 Stunden nicht gelesen — Kalender „Schule“ zeigt den Stand von ${zeitpunkt(zustand.lastSuccessAt)}.`
              : "IServ seit über 24 Stunden nicht gelesen — im Kalender „Schule“ steht noch nichts aus IServ.",
            warnung: ergebnis.warnung,
          };
        }
      }
    }

    return ergebnis;
  } catch (fehler) {
    const satz = `Der Abruf bei IServ ist abgebrochen: ${errorText(fehler)}`;
    console.error("IServ: Cron abgebrochen", satz);
    return { status: "fehler", satz, warnung: null };
  }
}
