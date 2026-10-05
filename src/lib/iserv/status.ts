import { calendarConfig } from "@/lib/calendar/config";
import { getConnection } from "@/lib/calendar/store";
import { todayInBerlin } from "@/lib/dates";
import { listAllFreePeriods } from "@/lib/free-days";
import { isIservFetchRunning } from "@/lib/iserv/abruf";
import { iservAuswahl } from "@/lib/iserv/auswahl";
import { iservConfig } from "@/lib/iserv/config";
import { klasseVeraltet } from "@/lib/iserv/parse";
import { baueIservStatus, leseQuellen, type IservStatus } from "@/lib/iserv/report";
import { readSnapshots, readState } from "@/lib/iserv/store";

/**
 * Was die Karte „IServ" in den Einstellungen zeigt. Nur Lesen — nie Netz.
 *
 * Ohne ISERV_*-Variablen KEINE Abfrage: Die Seite muss auch laufen, wenn die
 * Tabellen noch gar nicht eingespielt sind (Kopf von scripts/iserv-tabellen.sql).
 * Dasselbe gilt für den Google Kalender: Ist er nicht eingerichtet, fragt diese
 * Funktion auch seine Tabelle nicht.
 */
export async function loadIservStatus(userId: string): Promise<IservStatus> {
  const config = iservConfig();
  const jetzt = new Date();
  const heute = todayInBerlin(jetzt);
  const running = isIservFetchRunning();

  const leer = (ruhtGrund: string | null) =>
    baueIservStatus({
      config,
      ruhtGrund,
      row: null,
      snapshots: new Map(),
      auswertung: null,
      heute,
      jetzt,
      running,
    });

  if (!config.ok) return leer(null);

  if (!calendarConfig().ok) {
    return leer("IServ ruht, solange der Google Kalender auf diesem Server nicht eingerichtet ist.");
  }

  const verbindung = await getConnection(userId);
  const ruhtGrund = !verbindung?.refreshTokenEnc
    ? "IServ ruht, solange der Google Kalender nicht verbunden ist — die Termine hätten kein Ziel."
    : verbindung.blockedAt
      ? "IServ ruht, solange die Verbindung zum Google Kalender unterbrochen ist (Karte darüber)."
      : null;

  const [row, snapshots, freie] = await Promise.all([
    readState(userId),
    readSnapshots(userId),
    listAllFreePeriods(userId),
  ]);

  const cfg = config.config;
  const auswertung = iservAuswahl({
    items: [...snapshots.values()].flatMap((snap) => snap.items),
    filter: {
      klasse: cfg.klasse,
      auch: cfg.auch,
      nie: cfg.nie,
      klasseUnsicher: klasseVeraltet(leseQuellen(row?.sourcesJson ?? "[]"), cfg.klasse, cfg.klassenkalender),
    },
    freieZeiten: freie,
    iservOrigin: cfg.zugang.origin,
    // Nur für die Wünsche, die hier niemand braucht — die Karte zeigt Listen.
    appOrigin: "",
  });

  return baueIservStatus({
    config,
    ruhtGrund,
    row,
    snapshots,
    auswertung,
    heute,
    jetzt,
    running,
  });
}
