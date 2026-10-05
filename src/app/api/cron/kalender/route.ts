import { errorText } from "@/lib/calendar/error-text";
import { cronFailure } from "@/lib/calendar/report";
import { runCalendarCron } from "@/lib/calendar/sync";
import { isCronAuthorized } from "@/lib/cron-auth";

/**
 * Der stündliche Abgleich mit dem Google Kalender.
 *
 * Nach jeder Änderung in der App läuft schon ein Abgleich (`after()` in den
 * Server Actions). Dieser hier ist das Netz darunter: Er holt nach, was dabei
 * scheiterte oder vom Zeitbudget gekappt wurde, und er erneuert in jedem Lauf
 * den Zugang bei Google — die stündliche Gesundheitsprüfung. Hat der Nutzer
 * den Zugang entzogen, steht es nach spätestens einer Stunde in den
 * Einstellungen.
 *
 * Hier steht nur die Tür: die Anmeldung und die Antwort. Was ein Lauf tut,
 * steht in @/lib/calendar/sync, wann er als Fehlschlag gilt, bei
 * `cronFailure()` in @/lib/calendar/report.
 *
 * Kein Cookie, sondern "Authorization: Bearer <CRON_SECRET>" — dasselbe
 * Geheimnis und dieselbe Prüfung (@/lib/cron-auth) wie bei den Erinnerungen
 * und der Wiki-Übergabe.
 *
 * ── ⚠ WAS AUF DEM NAS EINGERICHTET WERDEN MUSS ──────────────────────────────
 *
 * Das erledigt scripts/kalender-einrichten.sh in einem Lauf, nach einem
 * `sudo ~/nas.sh hoch`: die Tabellen, die GOOGLE_*-Variablen in `.env` und
 * `docker-compose.override.yml`, `kalender.sh` und die Zeile in `/etc/crontab`.
 * Was es dabei schreibt und warum, steht dort; die Handschritte als Erklärung
 * im README unter „Google Kalender“.
 *
 * Der Auslöser ist diese Zeile in `/etc/crontab`, wie bei den Erinnerungen und
 * der Wiki-Übergabe:
 *
 *   15  *  *  *  *  root  /volume1/docker/schulapp/kalender.sh
 *
 * Minute 15, weil die Erinnerungen um :05 laufen und das Wiki um 02:30; der
 * Lauf um 03:15 ist vor dem DSM-Neustart donnerstags um 03:45 fertig.
 *
 * `kalender.sh` liest aus der `.env` nur `CRON_SECRET` und gibt den Bearer über
 * stdin an curl (`-K -`), damit das Geheimnis in keiner Prozessliste steht —
 * anders als ein `curl -H "Authorization: Bearer $CRON_SECRET"` auf der
 * Kommandozeile. Ohne Tabellen antwortet diese Route mit 500, auch wenn noch
 * nichts verbunden ist; deshalb trägt das Skript die Crontab-Zeile erst ein,
 * wenn die Tabellen da sind.
 *
 * `--max-time 300`: Die Arbeit des Laufs endet 270 Sekunden nach dem Aufruf,
 * und spätestens nach 285 Sekunden antwortet die Route — auch wenn sie hinter
 * einem anderen Lauf warten musste oder ein Schritt noch nicht fertig ist
 * (siehe `LIMITS` in @/lib/calendar/sync). Der Lauf arbeitet dann weiter, und
 * die Antwort ist ein 500 mit dem Satz dazu: Ob er gelingt, weiß der Cron
 * nicht. Die Antwort kommt also vor dem Abbruch durch curl. Nachsehen:
 *
 *   tail -n 20 /volume1/docker/schulapp/kalender.log
 *   grep kalender /etc/crontab
 *
 * Von Hand anstoßen (gefahrlos mehrfach — ein zweiter Lauf findet nichts zu
 * tun):
 *
 *   sudo /volume1/docker/schulapp/kalender.sh
 *
 * ── Wann der Lauf als Fehlschlag im Protokoll steht ─────────────────────────
 *
 * Bei jedem 500, und den gibt es, wenn
 *
 *   - `CRON_SECRET` fehlt,
 *   - die Tabellen fehlen (scripts/google-kalender-tabellen.sql nicht eingespielt),
 *   - die GOOGLE_*-Variablen fehlen, obwohl eine Verbindung besteht,
 *   - die Verbindung blockiert ist (Zugang entzogen, Schlüssel gewechselt,
 *     Kalender gelöscht) — jede Stunde, bis ein Mensch es behebt,
 *   - eine Quelle gescheitert ist,
 *   - ein Termin gescheitert ist, oder Google gedrosselt hat oder nicht
 *     erreichbar war,
 *   - ein Lauf nach 285 Sekunden noch nicht fertig war,
 *   - IServ eingerichtet ist und der Abruf in diesem Lauf scheiterte, nur
 *     teilweise gelang oder blockiert ist (Anmeldung abgelehnt, zweiter
 *     Faktor, Captcha, Sperre, Passwort abgelaufen) — blockiert jede Stunde,
 *     bis ein Mensch in den Einstellungen „Erneut versuchen" drückt,
 *   - IServ seit über 24 Stunden keinen Stand geliefert hat (dann auch in den
 *     Stunden, in denen kein Abruf fällig ist).
 *
 * Grün ohne Arbeit gibt es genau zweimal: Es ist nichts eingerichtet und
 * nichts verbunden, oder es gibt nichts zu tun. Termine, die das Zeitbudget
 * liegen ließ („noch offen"), sind kein Fehler — der nächste Lauf macht weiter.
 * Ebenso wenig ein Stand aus IServ, den der Schutz gegen „alles gelöscht"
 * zurückhält (@/lib/iserv/schutz): Der steht als Warnung in der Karte.
 *
 * Im Feld `iserv` der Antwort stehen nur der Zustand des Abrufs und ein
 * fester Satz — nie ein Titel aus IServ, nie Benutzer oder Passwort. Der
 * Abruf selbst hängt an diesem Lauf; eine eigene Crontab-Zeile gibt es nicht
 * (scripts/iserv-einrichten.sh).
 *
 * ── Warum hier kein `after()` und kein `maxDuration` steht ───────────────────
 *
 * Aus demselben Grund wie bei der Wiki-Übergabe: Die Antwort ist der Bericht,
 * und auf dem NAS liest niemand `maxDuration`. Ausführlich am Kopf von
 * @/lib/wiki/run.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return Response.json(
      { ok: false, error: "CRON_SECRET fehlt." },
      { status: 500 },
    );
  }

  if (!isCronAuthorized(request, secret)) {
    return Response.json({ ok: false, error: "Nicht erlaubt." }, { status: 401 });
  }

  try {
    const summary = await runCalendarCron();
    const gescheitert = cronFailure(summary);

    // Nichts eingerichtet und nichts verbunden: Die Funktion ist schlicht aus,
    // und das ist kein Fehler.
    if (summary.verbunden === 0 && summary.missing.length > 0) {
      return Response.json({ ok: true, reason: "nicht-eingerichtet", ...summary });
    }

    if (gescheitert) {
      console.error("Google-Kalender: Cron mit Fehlern", summary);
      return Response.json({ ok: false, error: gescheitert, ...summary }, { status: 500 });
    }

    return Response.json({ ok: true, ...summary });
  } catch (fehler) {
    // Etwa: die Tabellen fehlen. Der Satz aus dem Fehler ist die Auskunft;
    // ohne das Auffangen stünde im Protokoll eine HTML-Seite. Durch
    // `errorText()`, damit aus einer gescheiterten Abfrage der Grund
    // („relation … does not exist") wird und nicht ihre Parameter.
    const satz = errorText(fehler);
    console.error("Google-Kalender: Cron abgebrochen", satz);

    return Response.json(
      { ok: false, error: `Der Abgleich mit Google ist abgebrochen: ${satz}` },
      { status: 500 },
    );
  }
}
