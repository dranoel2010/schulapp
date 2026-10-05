/**
 * Ein nachgebautes IServ für die Tests — synthetisch, von Hand geschrieben.
 *
 * Keine Datei hier ist aus einer echten Antwort kopiert. Host, uids, Kürzel,
 * Titel, Tage und Uhrzeiten sind erfunden; die Titel folgen nur den MUSTERN
 * eines echten öffentlichen Kalenders („Kl. 10_…", „…_7. - 12. Kl_Xy",
 * „EA 10.Kl", „LF/gf …_Probeklausur" …), und die Termine tragen alle 29
 * Felder, die IServ schickt — mit `id` und `hash`, die sich bei jedem Abruf
 * ändern, wie bei IServ. Rohantworten einer echten Probe gehören nie hierher:
 * Auch der „öffentliche“ Kalender ist nur für die Mitglieder einer Schule
 * sichtbar.
 *
 * `fakeIserv()` spielt die Anmeldung nach, wie sie am 5.10.2026 gemessen
 * wurde:
 *
 *   GET  /iserv/auth/login                       200 Formular
 *   POST /iserv/auth/login                       302 /iserv/auth/home
 *   GET  /iserv/auth/home                        200 Meta-Refresh → /iserv
 *   GET  /iserv                                  301 /iserv/
 *   GET  /iserv/                                 302 /iserv/auth/auth?…
 *   GET  /iserv/auth/auth?…                      200 Meta-Refresh → /iserv/app/authentication/redirect?state=…&amp;code=…
 *   GET  /iserv/app/authentication/redirect?…    302 /iserv/   (setzt IServSession)
 *   GET  /iserv/                                 200 Startseite
 *
 * Die Cookies liegen auf /iserv/auth und auf /iserv. Ohne gültige
 * IServSession leiten die Daten-Pfade auf /iserv/auth/auth um. Jede Anfrage
 * steht im Protokoll.
 *
 * Kein *.test.ts: Diese Datei läuft nicht selbst, sie wird von den Tests
 * geladen.
 */

export const HOST = "iserv.example.test";
export const ORIGIN = `https://${HOST}`;

// ── eventsources ─────────────────────────────────────────────────────────────

type Quelle = Record<string, unknown>;

export const QUELLE_KLASSE: Quelle = {
  label: "Arbeitsmaterial_10",
  id: "/arbeitsmaterial.10/calendar",
  subscription: false,
  color: "#8AC3E6",
  textColor: "#000000",
  url: "/iserv/calendar/feed/calendar?cal=/arbeitsmaterial.10/calendar",
  type: "cal",
  droppable: true,
};

export const QUELLE_OEFFENTLICH: Quelle = {
  label: "Öffentlich",
  id: "/+public/calendar",
  subscription: false,
  color: "#adadad",
  textColor: "#000000",
  url: "/iserv/calendar/feed/calendar?cal=/%2Bpublic/calendar",
  type: "cal",
  droppable: true,
};

export const QUELLE_AUFGABEN: Quelle = {
  label: "Aufgaben",
  id: "exercise",
  subscription: false,
  color: "#ADADAD",
  textColor: "#000000",
  url: `${ORIGIN}/iserv/calendar4/plugin?plugin=exercise`,
  type: "plugin",
  droppable: true,
};

export const QUELLE_FEIERTAGE: Quelle = {
  label: "Ferien & Feiertage",
  id: "holiday",
  subscription: false,
  color: "#ADADAD",
  textColor: "#000000",
  url: `${ORIGIN}/iserv/calendar4/plugin?plugin=holiday`,
  type: "plugin",
  droppable: true,
};

/** Wie beim Schüler: vier Quellen. */
export const EVENTSOURCES: Quelle[] = [QUELLE_KLASSE, QUELLE_OEFFENTLICH, QUELLE_AUFGABEN, QUELLE_FEIERTAGE];

export const QUELLE_ABO: Quelle = {
  ...QUELLE_KLASSE,
  label: "Abo Klasse 10 Nachbarschule",
  id: "/abo.10/calendar",
  url: "/iserv/calendar/feed/calendar?cal=/abo.10/calendar",
  subscription: true,
};

export const QUELLE_ZWEITE_GRUPPE: Quelle = {
  ...QUELLE_KLASSE,
  label: "Chor-AG",
  id: "/chor-ag/calendar",
  url: "/iserv/calendar/feed/calendar?cal=/chor-ag/calendar",
};

export const QUELLE_ZWEITE_KLASSE_10: Quelle = {
  ...QUELLE_KLASSE,
  label: "Klasse 10b",
  id: "/klasse.10b/calendar",
  url: "/iserv/calendar/feed/calendar?cal=/klasse.10b/calendar",
};

export const QUELLE_KLASSE_11: Quelle = {
  ...QUELLE_KLASSE,
  label: "Arbeitsmaterial_11",
  id: "/arbeitsmaterial.11/calendar",
  url: "/iserv/calendar/feed/calendar?cal=/arbeitsmaterial.11/calendar",
};

export const QUELLE_KLAUSURPLAN: Quelle = {
  ...QUELLE_AUFGABEN,
  label: "Klausurplan",
  id: "exam-plan",
  url: `${ORIGIN}/iserv/calendar4/plugin?plugin=exam-plan`,
};

export const QUELLE_FREMDER_HOST: Quelle = {
  ...QUELLE_OEFFENTLICH,
  url: "https://fremd.example.test/iserv/calendar/feed/calendar?cal=/%2Bpublic/calendar",
};

// ── Termine ──────────────────────────────────────────────────────────────────

export type TerminRoh = {
  uid: string;
  title: string;
  start: string;
  end: string | null;
  allDay?: boolean;
  recurrenceId?: string | null;
  recurring?: boolean;
  location?: string | null;
  description?: string | null;
  status?: string;
  calendarId?: string;
};

/**
 * Ein Termin mit allen 29 Feldern im Format von IServ. `abruf` ändert `id`,
 * `hash` und `when`, wie es bei IServ jeder Abruf tut — der Inhalt bleibt.
 */
export function iservTermin(roh: TerminRoh, abruf = 1): Record<string, unknown> {
  const microtime = `0.${String(1234 + abruf).padStart(8, "0")} ${1791230953 + abruf}`;

  return {
    id: `${roh.uid}${microtime}`,
    uid: roh.uid,
    recurrenceId: roh.recurrenceId ?? null,
    hash: `${abruf.toString(16).padStart(4, "0")}${roh.uid.length.toString(16)}deadbeef${abruf}`,
    title: roh.title,
    description: roh.description ?? null,
    descriptionHtml: roh.description ? `<p>${roh.description}</p>` : null,
    category: null,
    category_color: null,
    start: roh.start,
    end: roh.end,
    timezone: "Europe/Berlin",
    editable: false,
    deletable: true,
    allDay: roh.allDay ?? false,
    recurring: roh.recurring ?? false,
    calendarId: roh.calendarId ?? "/+public/calendar",
    location: roh.location ?? null,
    locationHtml: roh.location ? `<span>${roh.location}</span>` : null,
    when: `Abruf ${abruf}: ${roh.start}`,
    organizer: null,
    creator: "Verwaltung",
    createdAt: `0${abruf % 9}.06.2026 16:52`,
    status: roh.status ?? "CONFIRMED",
    participantsWithStatus: null,
    currentUserPartstat: null,
    showAttendanceButtons: false,
    isOrganizer: false,
    alarms: [],
  };
}

const uid = (n: number) => `20260610-145225-${String(n).padStart(4, "0")}aa@iserv.example.test`;

/** Ein Titel mit 99 Zeichen und „…" — so kürzt IServ selbst lange Titel. */
export const LANGER_TITEL = `${"12.Kl+13.KL_In der Prüfungswoche haben die Klassen 12 und 13 nur Prüfungen nach Plan, der Aushang am Brett gilt. Weitere Infos folgen".slice(0, 99)}…`;

/**
 * Der öffentliche Kalender — erfunden. Die Titel folgen den MUSTERN eines
 * echten Schulkalenders (Trenner „_“, „Kl. 10_…“, „7. - 12. Kl“, Kürzel am
 * Ende, Datum im Titel, Kreise und Gremien, Probeklausuren der Oberstufe), aber
 * Wortlaut, Tage und Uhrzeiten sind ausgedacht und gehören zu keiner Schule.
 */
export const OEFFENTLICH_ROH: TerminRoh[] = [
  { uid: uid(1), title: "10.Kl_Vermessungspraktikum in Musterdorf_14.09.-25.09.26", start: "2026-09-14T00:00:00+02:00", end: "2026-09-26T00:00:00+02:00", allDay: true },
  { uid: uid(2), title: "9.Kl_Forstpraktikum_Bericht", start: "2026-09-16T18:30:00+02:00", end: "2026-09-16T20:00:00+02:00" },
  { uid: uid(3), title: "11. Kl._Berufsorientierung", start: "2026-09-15T00:00:00+02:00", end: "2026-09-16T00:00:00+02:00", allDay: true },
  { uid: uid(4), title: "EA 6.Kl", start: "2026-09-17T19:30:00+02:00", end: "2026-09-17T21:00:00+02:00" },
  { uid: uid(5), title: "Gartensamstag", start: "2026-09-19T09:00:00+02:00", end: "2026-09-19T13:00:00+02:00" },
  { uid: uid(6), title: "SGK_Jahresplanung", start: "2026-10-06T18:00:00+02:00", end: "2026-10-06T20:30:00+02:00", location: "Aula" },
  { uid: uid(7), title: "Gartenkreis", start: "2026-10-14T19:15:00+02:00", end: "2026-10-14T20:45:00+02:00" },
  { uid: uid(8), title: "Nachschreibklausur_7. - 12. Kl_Ab", start: "2026-10-07T15:45:00+02:00", end: "2026-10-07T17:15:00+02:00", location: "Raum 21", description: "Anmeldung &amp; Material:\n<b>bis Freitag</b>\n\n\n\nim Sekretariat" },
  { uid: uid(9), title: "Kl. 10_Vorstellung der Praktikumsberichte", start: "2026-10-08T18:00:00+02:00", end: "2026-10-08T19:30:00+02:00" },
  { uid: uid(10), title: "LF/gf Physik_Probeklausur", start: "2026-10-09T08:00:00+02:00", end: "2026-10-09T13:00:00+02:00" },
  { uid: uid(11), title: "Erntedankfest_Beginn  10 Uhr", start: "2026-10-10T10:00:00+02:00", end: "2026-10-10T14:00:00+02:00" },
  { uid: uid(12), title: "Elternbeirat", start: "2026-10-12T19:30:00+02:00", end: "2026-10-12T21:00:00+02:00" },
  { uid: uid(13), title: "Basarkreistreffen_digital", start: "2026-10-13T20:00:00+02:00", end: "2026-10-13T21:00:00+02:00" },
  { uid: uid(14), title: "Inklusionskreis", start: "2026-10-20T16:30:00+02:00", end: "2026-10-20T18:00:00+02:00", recurring: true, recurrenceId: "20261020T143000Z" },
  { uid: uid(14), title: "Inklusionskreis", start: "2026-11-17T16:30:00+01:00", end: "2026-11-17T18:00:00+01:00", recurring: true, recurrenceId: "20261117T153000Z" },
  { uid: uid(15), title: "1. + 2. Pädagogischer Tag_unterrichtsfrei  (3. Pädagogischer Tag: Mo, 30.11.26)", start: "2026-10-22T00:00:00+02:00", end: "2026-10-24T00:00:00+02:00", allDay: true },
  { uid: uid(16), title: "Herbstferien_Sa. 24. 10. – Sa. 7. 11. 2026", start: "2026-10-24T00:00:00+02:00", end: "2026-11-08T00:00:00+01:00", allDay: true },
  { uid: uid(17), title: "Ferienbetreuung im Hort_26.10.–06.11.", start: "2026-10-26T00:00:00+01:00", end: "2026-11-07T00:00:00+01:00", allDay: true },
  { uid: uid(18), title: "EA 10.Kl", start: "2026-11-18T19:30:00+01:00", end: "2026-11-18T21:30:00+01:00" },
  { uid: uid(19), title: "Apfelernte-Aktionstag", start: "2026-11-21T09:00:00+01:00", end: "2026-11-21T13:00:00+01:00" },
  { uid: uid(20), title: "Unterrichtsende spätestens 12:30_Klassen 1-12_Aufbau Adventsbasar", start: "2026-11-27T12:30:00+01:00", end: "2026-11-27T17:00:00+01:00" },
  { uid: uid(21), title: "Adventsbasar_Schulsamstag", start: "2026-11-28T11:00:00+01:00", end: "2026-11-28T17:00:00+01:00" },
  { uid: uid(22), title: "3.Pädagogischer Tag_unterrichtsfrei", start: "2026-11-30T00:00:00+01:00", end: "2026-12-01T00:00:00+01:00", allDay: true },
  { uid: uid(23), title: "Kl. 9_Exkursion_Naturkundemuseum Begleitung Xy und Zw", start: "2026-12-02T09:30:00+01:00", end: "2026-12-02T13:30:00+01:00" },
  { uid: uid(24), title: "Unterrichtsende um 11:30 Uhr", start: "2026-12-17T11:30:00+01:00", end: "2026-12-17T11:30:00+01:00" },
  { uid: uid(25), title: "Weihnachtsferien_Fr. 18.12.26 – Fr. 1.1.27_letzter Schultag Do. 17.12. bis 11:30 Uhr", start: "2026-12-18T00:00:00+01:00", end: "2027-01-03T00:00:00+01:00", allDay: true },
  { uid: uid(26), title: "Hort geschlossen_24.12.–01.01.", start: "2026-12-24T00:00:00+01:00", end: "2027-01-02T00:00:00+01:00", allDay: true },
  { uid: uid(27), title: "Infoabend Oberstufe_Aula", start: "2027-02-03T19:30:00+01:00", end: "2027-02-03T21:00:00+01:00" },
  { uid: uid(28), title: "Konzert der Chor-AG", start: "2027-01-27T18:00:00+01:00", end: "2027-01-27T19:00:00+01:00" },
  { uid: uid(29), title: "Faschingsfeier der Unterstufe_anschließend unterrichtsfrei", start: "2027-02-16T00:00:00+01:00", end: "2027-02-17T00:00:00+01:00", allDay: true },
  { uid: uid(30), title: "Elternsprechtag_ab 14 Uhr_kein Unterricht nach der 4. Stunde", start: "2027-02-24T14:00:00+01:00", end: "2027-02-24T18:00:00+01:00" },
  { uid: uid(31), title: "Brückentag_Schule und Hort geschlossen", start: "2027-05-07T00:00:00+02:00", end: "2027-05-08T00:00:00+02:00", allDay: true },
  { uid: uid(32), title: "MSA_Prüfung Präsentation", start: "2027-03-09T00:00:00+01:00", end: "2027-03-12T00:00:00+01:00", allDay: true },
  { uid: uid(33), title: "12.Kl_Jahresarbeiten_Aufbau im Saal ab 13:10 Uhr", start: "2027-03-04T13:10:00+01:00", end: "2027-03-04T16:30:00+01:00", location: "Saal" },
  { uid: uid(34), title: LANGER_TITEL, start: "2027-03-01T00:00:00+01:00", end: "2027-03-06T00:00:00+01:00", allDay: true },
  { uid: uid(35), title: "Osterferien_Sa. 20. 3. – So. 4. 4. 2027", start: "2027-03-20T00:00:00+01:00", end: "2027-04-05T00:00:00+02:00", allDay: true },
  { uid: uid(36), title: "Kl. 10_Ausflug (abgesagt)", start: "2026-10-15T08:00:00+02:00", end: "2026-10-15T14:00:00+02:00", status: "CANCELLED" },
  { uid: uid(37), title: "LF Chemie/ LF Musik_Probeklausur", start: "2026-12-10T08:00:00+01:00", end: "2026-12-10T13:00:00+01:00" },
];

/** Der öffentliche Kalender, wie ein Abruf ihn liefert. */
export function oeffentlicherFeed(abruf = 1): Record<string, unknown>[] {
  return OEFFENTLICH_ROH.map((roh) => iservTermin(roh, abruf));
}

/** Der Gruppenkalender der Klasse. */
export const KLASSE_ROH: TerminRoh[] = [
  { uid: uid(101), title: "Epochenheft Geschichte abgeben", start: "2026-10-30T00:00:00+01:00", end: "2026-10-31T00:00:00+01:00", allDay: true, calendarId: "/arbeitsmaterial.10/calendar" },
  { uid: uid(102), title: "Vortreffen Praktikum", start: "2026-11-04T18:15:00+01:00", end: "2026-11-04T19:15:00+01:00", location: "Klassenraum", description: "Bitte &lt;b&gt;pünktlich&lt;/b&gt;. Infos: &lt;a href=&quot;https://boese.example.test/login&quot;&gt;IServ-Anmeldung&lt;/a&gt;", calendarId: "/arbeitsmaterial.10/calendar" },
  { uid: uid(103), title: "Theaterprobe <i>Faust</i>", start: "2026-11-06T14:00:00+01:00", end: "2026-11-06T16:00:00+01:00", calendarId: "/arbeitsmaterial.10/calendar" },
  // Derselbe Termin wie im öffentlichen Kalender — Doppel, der Klassenkalender gewinnt.
  { uid: uid(9), title: "Kl. 10_Vorstellung der Praktikumsberichte", start: "2026-10-08T18:00:00+02:00", end: "2026-10-08T19:30:00+02:00", calendarId: "/arbeitsmaterial.10/calendar" },
];

export function klassenFeed(abruf = 1): Record<string, unknown>[] {
  return KLASSE_ROH.map((roh) => iservTermin(roh, abruf));
}

/** Gesetzliche Feiertage, im Stil des Plugins: 02:00 Ortszeit. */
export const FEIERTAGE_FEED = [
  {
    id: "holiday-holidays_statutory_de_BE-000000000001@iserv.example.test",
    title: "Tag der Deutschen Einheit",
    start: "2026-10-03T02:00:00+02:00",
    end: "2026-10-04T02:00:00+02:00",
    allDay: true,
    editable: false,
    plugin: "holiday",
    displayFields: [{ text: "Gesetzlicher Feiertag", label: "Art" }],
  },
  {
    id: "holiday-holidays_statutory_de_BE-000000000002@iserv.example.test",
    title: "1. Weihnachtsfeiertag",
    start: "2026-12-25T01:00:00+01:00",
    end: "2026-12-26T01:00:00+01:00",
    allDay: true,
    editable: false,
    plugin: "holiday",
    displayFields: [{ text: "Gesetzlicher Feiertag", label: "Art" }],
  },
];

/**
 * Aufgaben im ANGENOMMENEN Format (siehe `parseAufgabenFeed()`): ganztägig,
 * mit Uhrzeit, ohne Ende, mit show-Nummer relativ und absolut, mit
 * numerischer und mit String-id.
 */
export const AUFGABEN_FEED = [
  {
    id: 4711,
    title: "Mathe: Arbeitsblatt Funktionen",
    start: "2026-10-12T00:00:00+02:00",
    end: "2026-10-13T00:00:00+02:00",
    allDay: true,
    editable: false,
    plugin: "exercise",
    url: "/iserv/exercise/show/4711",
    displayFields: [{ label: "Lehrkraft", text: "Xy" }],
  },
  {
    id: "4712",
    title: "Deutsch: Erörterung",
    start: "2026-10-14T08:00:00+02:00",
    end: "2026-10-20T23:59:00+02:00",
    allDay: false,
    plugin: "exercise",
    url: `${ORIGIN}/iserv/exercise/show/4712`,
  },
  {
    id: 4713,
    title: "Bio: Protokoll",
    start: "2026-10-15T23:59:00+02:00",
    end: null,
    allDay: false,
    plugin: "exercise",
  },
];

// ── Seiten ───────────────────────────────────────────────────────────────────

/** Was auf JEDER Login-Seite steht — und keine Regel auslösen darf. */
const LOGIN_RAHMEN = (inhalt: string) => `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><title>IServ - ${HOST}</title></head>
<body>
  <h1>Anmeldung</h1>
  <a href="/iserv/help">Hilfe</a>
  <noscript>Sie haben keine Cookies aktiviert. Cookies sind notwendig um IServ zu benutzen.</noscript>
  <div class="browser-warning hidden">Sie verwenden einen nicht unterstützten oder veralteten Webbrowser. Bitte aktualisieren Sie Ihren Webbrowser oder verwenden Sie einen unterstützten Webbrowser.
    Bestimmte Funktionen oder die gesamte Funktionalität der Website stehen möglicherweise nicht zur Verfügung.
    <a href="/iserv/help/browser">Warum wird mir das angezeigt?</a></div>
  <div class="throttle hidden">Bitte warten Sie <span>00</span> Sekunden, bevor Sie sich erneut anmelden.</div>
  ${inhalt}
  <form id="login-form" class="login-form" method="post">
    <input class="form-control" type="text" name="_username" value="" placeholder="Account" required="required" autofocus/>
    <input class="form-control" type="password" id="password_login" name="_password" placeholder="Passwort" required="required"/>
    <span class="sr-only">Passwort ausblenden</span><span class="sr-only">Passwort anzeigen</span>
    <span class="caps hidden">Warnung: Die Feststelltaste ist aktiviert!</span>
    <input type="checkbox" id="remember_me" name="_remember_me"/> Angemeldet bleiben
    <a href="/iserv/auth/public/password_reset">Passwort vergessen?</a>
    <button type="submit">Anmelden</button>
  </form>
  <footer>${HOST} · Impressum · IServ Schulplattform</footer>
</body>
</html>`;

export const LOGIN_SEITE = LOGIN_RAHMEN("");

export function loginFehlgeschlagen(echo = ""): string {
  return LOGIN_RAHMEN(
    `<div class="alert alert-danger">Anmeldung fehlgeschlagen. Account oder Passwort falsch.${echo}</div>`,
  );
}

export const ZWEI_FAKTOR_SEITE = `<!DOCTYPE html><html><body>
  <h1>Zwei-Faktor-Authentifizierung</h1>
  <p>Bitte geben Sie den Bestätigungscode aus Ihrer Authenticator-App ein.</p>
  <form method="post"><input type="text" name="_auth_code" autocomplete="one-time-code"/><button>Weiter</button></form>
</body></html>`;

export const CAPTCHA_SEITE = LOGIN_RAHMEN('<div class="g-recaptcha" data-sitekey="test-schluessel"></div>');

export const GESPERRT_SEITE = LOGIN_RAHMEN(
  '<div class="alert alert-danger">Ihr Account wurde wegen zu vieler Fehlversuche vorübergehend gesperrt.</div>',
);

export const PASSWORT_ABGELAUFEN_SEITE = `<!DOCTYPE html><html><body>
  <h1>Passwort ändern</h1>
  <p>Ihr Passwort ist abgelaufen. Bitte vergeben Sie ein neues Passwort.</p>
  <form method="post"><input type="password" name="new_password"/></form>
</body></html>`;

/** Die angemeldete Startseite — mit einer Neuigkeit, die wie eine Sperre klingt. */
export const STARTSEITE = `<!DOCTYPE html><html><head><title>IServ</title></head><body>
  <script id="locked-user-data" type="application/json">{"displayname":"Testschüler"}</script>
  <h1>Willkommen</h1>
  <section class="news"><h2>Neuigkeiten</h2><p>Die Turnhalle ist bis Freitag gesperrt.</p></section>
</body></html>`;

export function metaRefresh(ziel: string, mitAnfuehrung = false): string {
  const inhalt = mitAnfuehrung ? `0;url='${ziel}'` : `0;url=${ziel}`;
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8" />
<meta http-equiv="refresh" content="${inhalt}" />
<title>Redirecting to ${ziel}</title></head>
<body>Redirecting to <a href="${ziel}">${ziel}</a>.</body></html>`;
}

export const WARTUNGS_SEITE = `<!DOCTYPE html><html><body><h1>Wartungsarbeiten</h1><p>IServ ist gleich wieder da.</p></body></html>`;

// ── Die Attrappe ─────────────────────────────────────────────────────────────

export type Anfrage = {
  methode: string;
  pfad: string;
  query: string;
  cookies: string[];
};

export type Handler = (anfrage: { url: URL; method: string; body: string }) => Response | Promise<Response>;

export type FakeOptionen = {
  benutzer?: string;
  passwort: string;
  /** Was nach dem POST mit richtigem Passwort geschieht */
  loginErgebnis?: "ok" | "zweiter-faktor" | "captcha" | "gesperrt" | "passwort-abgelaufen" | "unsinn";
  /** Schreibt die Attrappe das gesendete Passwort bei einer Ablehnung in die Seite zurück? */
  echoPasswort?: boolean;
  /** Daten-Pfade: Antwort je Pfad (ohne Query); überschreibt die eingebauten */
  routen?: Record<string, Handler>;
};

export type FakeIserv = {
  fetch: typeof fetch;
  protokoll: Anfrage[];
  /** Alle Sessions verwerfen — die nächste Anfrage leitet zur Anmeldung. */
  sessionsVerwerfen(): void;
  posts(): Anfrage[];
};

export function json(daten: unknown, status = 200): Response {
  return new Response(JSON.stringify(daten), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function html(text: string, status = 200, cookies: string[] = []): Response {
  const headers = new Headers({ "content-type": "text/html; charset=UTF-8" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(text, { status, headers });
}

function weiter(location: string, status = 302, cookies: string[] = []): Response {
  const headers = new Headers({ location });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(null, { status, headers });
}

function cookiesVon(header: string | null): Map<string, string> {
  const map = new Map<string, string>();
  for (const teil of (header ?? "").split(";")) {
    const gleich = teil.indexOf("=");
    if (gleich > 0) map.set(teil.slice(0, gleich).trim(), teil.slice(gleich + 1).trim());
  }
  return map;
}

function htmlKodiert(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function fakeIserv(optionen: FakeOptionen): FakeIserv {
  const benutzer = optionen.benutzer ?? "test.schueler";
  const protokoll: Anfrage[] = [];
  const authSessions = new Set<string>();
  const sessions = new Set<string>();
  let zaehler = 0;

  const neu = (art: string) => `${art}${(zaehler += 1)}x`;

  const datenRouten: Record<string, Handler> = {
    "/iserv/calendar/api/eventsources": () => json(EVENTSOURCES),
    "/iserv/calendar/feed/calendar": ({ url }) => {
      const cal = url.searchParams.get("cal");
      if (!url.searchParams.get("start") || !url.searchParams.get("end")) return json({ error: "start/end" }, 400);
      if (cal === "/+public/calendar") return json(oeffentlicherFeed());
      if (cal === "/arbeitsmaterial.10/calendar") return json(klassenFeed());
      return json([], 404);
    },
    "/iserv/calendar4/plugin": ({ url }) => {
      const plugin = url.searchParams.get("plugin");
      if (plugin === "exercise") return json(AUFGABEN_FEED);
      if (plugin === "holiday") return json(FEIERTAGE_FEED);
      return json([], 404);
    },
    ...optionen.routen,
  };

  const fetchImpl = async (eingabe: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof eingabe === "string" ? eingabe : eingabe instanceof URL ? eingabe.href : eingabe.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const cookies = cookiesVon(headers.get("cookie"));
    const body = typeof init?.body === "string" ? init.body : "";

    protokoll.push({ methode: method, pfad: url.pathname, query: url.search, cookies: [...cookies.keys()] });

    if (url.origin !== ORIGIN) return html("fremd", 404);

    const pfad = url.pathname;
    const angemeldet = sessions.has(cookies.get("IServSession") ?? "");
    const authOk = authSessions.has(cookies.get("IServAuthSession") ?? "");

    // ── Anmeldung ──
    if (pfad === "/iserv/auth/login" && method === "GET") {
      return html(LOGIN_SEITE, 200, [`IServAuthSID=${neu("sid")}; path=/iserv/auth; secure; httponly; samesite=lax`]);
    }

    if (pfad === "/iserv/auth/login" && method === "POST") {
      const form = new URLSearchParams(body);
      const name = form.get("_username");
      const passwort = form.get("_password") ?? "";

      if (name !== benutzer || passwort !== optionen.passwort) {
        const echo = optionen.echoPasswort
          ? ` Eingegeben: ${passwort} / ${encodeURIComponent(passwort)} / ${htmlKodiert(passwort)}`
          : "";
        return html(loginFehlgeschlagen(echo));
      }

      switch (optionen.loginErgebnis ?? "ok") {
        case "zweiter-faktor":
          return weiter("/iserv/auth/login/2fa", 302, [`IServAuthSession=${neu("a")}; path=/iserv/auth`]);
        case "captcha":
          return html(CAPTCHA_SEITE);
        case "gesperrt":
          return html(GESPERRT_SEITE);
        case "passwort-abgelaufen":
          return weiter("/iserv/auth/password/change");
        case "unsinn":
          return weiter("/iserv/irgendwo");
        default: {
          const a = neu("a");
          authSessions.add(a);
          return weiter("/iserv/auth/home", 302, [`IServAuthSession=${a}; path=/iserv/auth; secure; httponly`]);
        }
      }
    }

    if (pfad === "/iserv/auth/login/2fa") return html(ZWEI_FAKTOR_SEITE);
    if (pfad === "/iserv/auth/password/change") return html(PASSWORT_ABGELAUFEN_SEITE);
    if (pfad === "/iserv/irgendwo") return html("<p>Nichts</p>");

    if (pfad === "/iserv/auth/home") {
      return authOk ? html(metaRefresh("/iserv")) : weiter("/iserv/auth/login");
    }

    if (pfad === "/iserv") return weiter("/iserv/", 301);

    if (pfad === "/iserv/") {
      return angemeldet
        ? html(STARTSEITE)
        : weiter("/iserv/auth/auth?_iserv_app_url=%2Fiserv%2Fapp%2Flogin&state=eyJzdGF0ZSI6MX0.abc&nonce=n1");
    }

    if (pfad === "/iserv/auth/auth") {
      return authOk
        ? html(metaRefresh("/iserv/app/authentication/redirect?state=s-123.abc&amp;code=c-456", true))
        : html(metaRefresh("/iserv/auth/login?_target_path=/iserv/auth/auth", true));
    }

    if (pfad === "/iserv/app/authentication/redirect") {
      // Kam „&amp;" undekodiert an, hieße der Parameter „amp;code" — und IServ
      // finge von vorn an.
      if (url.searchParams.get("state") !== "s-123.abc" || url.searchParams.get("code") !== "c-456") {
        return weiter("/iserv/auth/auth?state=nochmal");
      }
      const s = neu("s");
      sessions.add(s);
      return weiter("/iserv/", 302, [
        `IServSession=${s}; path=/iserv; secure; httponly`,
        `IServSAT=${neu("t")}; path=/iserv; secure; httponly`,
        `IServSATId=${neu("i")}; path=/iserv; secure; httponly`,
      ]);
    }

    if (pfad === "/iserv/auth/logout") {
      sessions.delete(cookies.get("IServSession") ?? "");
      return weiter("/iserv/auth/login", 302, [
        "IServSession=deleted; expires=Thu, 01 Jan 1970 00:00:01 GMT; Max-Age=0; path=/iserv",
      ]);
    }

    // ── Daten ──
    const route = datenRouten[pfad];
    if (!route) return html("<h1>404</h1>", 404);
    if (!angemeldet) return weiter("/iserv/auth/auth?_iserv_app_url=%2Fiserv%2Fapp%2Flogin&state=abc");

    return route({ url, method, body });
  };

  return {
    fetch: fetchImpl as typeof fetch,
    protokoll,
    sessionsVerwerfen() {
      sessions.clear();
      authSessions.clear();
    },
    posts() {
      return protokoll.filter((anfrage) => anfrage.methode !== "GET");
    },
  };
}
