import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Datenschutz",
};

/**
 * Die Datenschutzerklärung — öffentlich, ohne Anmeldung.
 *
 * Google verlangt sie, bevor ein Projekt auf „In production“ gehen darf, und
 * prüft die Adresse im Zustimmungsbildschirm gegen die Authorized Domain. Ohne
 * „In production“ liefe der Refresh Token nach sieben Tagen ab. Deshalb steht
 * sie außerhalb von (app): Dort leitet das Layout ohne Sitzung nach /login,
 * und Google sähe statt der Erklärung eine Anmeldeseite.
 *
 * Sie beschreibt, was die App tatsächlich tut, und nicht mehr. Ändert sich, was
 * an Google geht (Scope, Kalender, Termine), muss dieser Text mit — und
 * ebenso, wenn eine Quelle dazukommt, aus der Termine nach Google wandern
 * (seit Stufe 5: IServ der Schule). Der Text ist statisch und gilt für den
 * Fall, dass IServ eingerichtet ist; ohne ISERV_* fehlt dieser Teil einfach.
 */
export default function DatenschutzPage() {
  return (
    <main className="page mx-auto max-w-2xl space-y-6 py-12">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Datenschutz</h1>
        <p className="text-sm text-muted">Stand: 5. Oktober 2026</p>
      </header>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Was diese App ist</h2>
        <p className="text-muted">
          Eine private Schulapp für genau einen Schüler. Sie läuft auf einem
          eigenen Server zu Hause, hat kein zweites Konto und ist kein
          öffentlicher Dienst.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Was mit deinem Google-Konto passiert</h2>
        <p className="text-muted">
          Erst wenn du in den Einstellungen „Mit Google verbinden“ wählst und
          bei Google zustimmst, legt die App in deinem Google Kalender einen
          eigenen Kalender „Schule“ an. Dorthin schreibt sie Termine aus der
          App: Klausuren, offene Hausaufgaben und freie Tage. Ändert sich ein
          Termin in der App, ändert sie ihn auch dort. Löschst du einen Termin
          in Google, merkt sie sich das und trägt ihn nicht wieder ein.
        </p>
        <p className="text-muted">
          Ist auf dem Server IServ eingerichtet, schreibt sie außerdem Termine
          aus dem IServ der Schule dorthin, die deine Klasse betreffen: aus dem
          Kalender deiner Klasse, deine Aufgaben und die Termine des
          Schulkalenders, die deine Klasse nennen oder für alle den Unterricht
          betreffen — mit Titel, Tag, Uhrzeit, Ort und Beschreibung, wie sie in
          IServ stehen (darin können Kürzel von Lehrkräften vorkommen).
          Ersteller und Teilnehmer eines Termins übernimmt sie nicht.
        </p>
        <p className="text-muted">
          Die App fragt dafür nur nach der Berechtigung{" "}
          <code className="text-sm">calendar.app.created</code>. Damit sieht
          sie ausschließlich den Kalender, den sie selbst angelegt hat — keine
          anderen Kalender, keine Termine darin und keine anderen Daten deines
          Google-Kontos. Aus dem Kalender „Schule“ liest sie nur, ob ihre
          eigenen Termine noch da sind.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Was mit deinem IServ-Konto passiert</h2>
        <p className="text-muted">
          Nur wenn es auf dem Server eingerichtet ist: Die App meldet sich mit
          deinem IServ-Benutzernamen und Passwort bei IServ an — in der Regel
          höchstens alle drei Stunden zwischen 6 und 21 Uhr — und liest dort
          nur; sie sendet,
          ändert und gibt nichts ab. Jede Anmeldung steht in deinen „Letzten
          Anmeldungen“ bei IServ. Benutzername und Passwort stehen nur in der
          Konfiguration des Servers, nicht in der Datenbank; die Sitzung bei
          IServ hält die App nur im Arbeitsspeicher. Gelesen werden der Kalender
          deiner Klasse, der Schulkalender und deine Aufgaben.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Was gespeichert wird</h2>
        <p className="text-muted">
          Der Zugang zu Google (ein Refresh Token) liegt verschlüsselt in der
          Datenbank auf dem Server dieser App, dazu die Kennung des Kalenders
          und welche Termine schon übertragen sind. Aus IServ liegt dort der
          zuletzt gelesene Stand der Termine (ohne Ersteller und Teilnehmer),
          damit ein IServ, das gerade nicht antwortet, nichts aus „Schule“
          löscht. Daten aus Google und aus IServ gehen an niemanden weiter,
          auch nicht an die KI-Dienste, die die App zum Einordnen
          abfotografierter Blätter nutzt, und nicht an KI-Agenten, die die App
          lesen dürfen. Es gibt keine Werbung, kein Tracking und keine
          Auswertung.
        </p>
        <p className="text-muted">
          Der Umgang mit Daten aus Google-APIs folgt der{" "}
          <a
            className="underline"
            href="https://developers.google.com/terms/api-services-user-data-policy"
          >
            Google API Services User Data Policy
          </a>
          , einschließlich der Anforderungen an die eingeschränkte Nutzung
          (Limited Use).
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Verbindung trennen</h2>
        <p className="text-muted">
          In den Einstellungen unter „Google Kalender“ mit „Trennen“, oder bei
          Google unter{" "}
          <a className="underline" href="https://myaccount.google.com/permissions">
            myaccount.google.com/permissions
          </a>
          . Danach vergisst die App den gespeicherten Zugang. Der Kalender
          „Schule“ bleibt in deinem Google-Konto, bis du ihn dort selbst
          löschst.
        </p>
        <p className="text-muted">
          IServ schaltet ab, wer die IServ-Einträge aus der Konfiguration des
          Servers nimmt. Danach meldet sich die App nicht mehr an; schon
          eingetragene Termine bleiben in „Schule“, bis du sie dort löschst.
        </p>
      </section>
    </main>
  );
}
