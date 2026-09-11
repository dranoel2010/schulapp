import { timingSafeEqual } from "node:crypto";

import {
  WIKI_EXPORT_DIR_ENV,
  runWikiHandover,
  wikiExportRoot,
  type WikiRunSummary,
} from "@/lib/wiki/run";

/**
 * Die tägliche Übergabe an das Wiki.
 *
 * Einmal am Tag legt die App alles, was sich seit gestern geändert hat, in
 * einen flachen, datierten Ordner IM Obsidian-Vault — in dessen Eingang
 * `topics/schule/inbox`. Nicht daneben: Ein Ordner außerhalb wäre eine
 * Schleuse, die Obsidian gar nicht sieht — dass sie volläuft oder leer bleibt,
 * fiele dann niemandem auf. So steht die Lieferung dort, wo gearbeitet wird.
 * Ein eigener Agent räumt sie von dort ein. Was in den Dateien steht und warum,
 * steht in @/lib/wiki/documents; wie ein Abbruch mittendrin ausgeht, in
 * @/lib/wiki/run.
 *
 * Hier steht nur die Tür: die Anmeldung, die Umgebungsvariable und die
 * Antwort. Fachlogik gehört nach @/lib und nicht in einen Route Handler.
 *
 * Kein Cookie, sondern "Authorization: Bearer <CRON_SECRET>" — dasselbe
 * Geheimnis und dieselbe Prüfung wie in /api/cron/reminders.
 *
 * ── ⚠ WAS AUF DEM NAS EINGETRAGEN WERDEN MUSS ───────────────────────────────
 *
 * Drei Dinge, und ohne alle drei tut diese Route nichts.
 *
 * **1. Der Vault muss IM CONTAINER liegen.** Die App schreibt aus dem
 * Container heraus; ein Pfad, den nur DSM kennt, ist für sie nicht da. In der
 * docker-compose.yml auf dem NAS (die liegt nur dort, nicht im Repo) beim
 * Dienst `app`:
 *
 *   user: "1026:100"
 *   volumes:
 *     - /volume1/homes/Leonard/Drive/wiki/topics/schule/inbox:/uebergabe
 *   environment:
 *     WIKI_EXPORT_DIR: /uebergabe
 *
 * Seit dem 11.9.2026 liegt der Übergabeordner IM Vault und nicht mehr daneben,
 * und der Vault selbst ist aus der `docker`-Freigabe in Leonards persönlichen
 * Ordner gezogen („My Drive"). Von dort gleicht der Synology-Drive-Client ihn
 * mit einem Windows-Rechner ab (dort `C:\Users\drano\wiki`), in beide
 * Richtungen — was die Übergabe schreibt, steht wenige Minuten später auch
 * dort. Der alte Beispielpfad hier zeigte ins Leere: `ls -ld /volume1/wiki`
 * antwortet „No such file or directory".
 *
 * Die Kennung `1026:100` ist Leonard und die Gruppe `users`, und sie steht
 * dort, weil der Vault einem Menschen gehört und abgeglichen wird — deshalb
 * läuft der Container unter Leonards Kennung, statt den Vault für den Server
 * zu öffnen. Das Bild lässt den Server sonst als `node` (1000:1000) laufen,
 * und diese Kennung gibt es auf dem NAS gar nicht: gemessen stand der
 * Tagesordner dann auf „UNKNOWN:UNKNOWN 755", Leonard wurde darin nichts mehr
 * los, und der einordnende Agent hätte die Dateien nach dem Einräumen nicht
 * wegräumen können — der Eingang wäre langsam zugewachsen. Ein Ordner, in den
 * der Server überhaupt nicht schreiben darf, quittiert es schon vorher mit
 * „EACCES", und die Übergabe fällt jede Nacht aus. Der andere Weg wäre
 * gewesen, den Ordner für alle aufzumachen; dann stünden weit offene Rechte in
 * einem Vault, der auf einen fremden Rechner abgeglichen wird. Seit der
 * Änderung entsteht alles als `Leonard:users`, nachgemessen mit einer
 * Schreibprobe, und der Eingang steht wieder auf 755. Angelegt wird er
 * ausdrücklich NICHT von der App: ein fehlender Ordner heißt meistens, dass
 * der Vault gerade nicht eingehängt ist, und dann soll nichts geschrieben
 * werden (siehe @/lib/wiki/folder).
 *
 * **2. Der Auslöser sitzt auf dem NAS.** Nicht GitHub Actions — seit dem
 * 11.9.2026 auch bei den Erinnerungen nicht mehr, und aus demselben Grund: Ein
 * Auslöser auf dem NAS läuft unabhängig von GitHub und vom Tailscale Funnel —
 * er ruft von innen an, also auch dann, wenn draußen etwas klemmt. Und er kennt
 * die 60-Sekunden-Frist nicht, an der `curl` im Workflow abbräche; ein erster,
 * vollständiger Lauf über ein Schuljahr darf hier Minuten dauern. Wie ernst der
 * erste Punkt zu nehmen ist, zeigen genau diese Erinnerungen: Ihr Workflow
 * scheiterte zwölf Läufe in Folge, weil GitHub noch das Geheimnis aus der
 * Vercel-Zeit schickte, und gemerkt hat es niemand.
 *
 * Vorgesehen war dafür der Aufgabenplaner in DSM. Seit dem 11.9.2026 ist es
 * stattdessen eine Zeile in `/etc/crontab`:
 *
 *   30  2  *  *  *  root  /volume1/docker/schulapp/wiki-uebergabe.sh
 *
 * Warum nicht der Planer: Sein einziger Rückkanal ist die E-Mail „Details zum
 * Ausführungsergebnis" — und auf diesem NAS ist keine eingerichtet.
 * `/etc/crontab` beginnt mit `MAILTO=""`, eine SMTP-Konfiguration gibt es
 * nicht. Der Planer wäre hier also stumm, und ein stiller Fehlschlag ist
 * genau das, wogegen der Rest dieser Datei argumentiert. Wer den Planer
 * trotzdem will, richtet ZUERST eine Benachrichtigung ein — sonst tauscht er
 * ein Protokoll gegen gar nichts.
 *
 * 02:30 und nicht 03:30, weil der DSM-Neustart donnerstags um 03:45 einen
 * langen Lauf sonst mittendrin abschneidet — und lang wird er, sobald
 * `wiki_deliveries` geleert wurde. Aus demselben Grund steht `--max-time` auf
 * 900 und nicht auf 3600: lieber laut scheitern als stillschweigend
 * zerschnitten werden.
 *
 * Das Skript in seinen wesentlichen Zeilen:
 *
 *     set -a; . /volume1/docker/schulapp/.env; set +a
 *
 *     antwort=$(curl --fail-with-body -sS --max-time 900 \
 *                 -H "Authorization: Bearer $CRON_SECRET" \
 *                 http://localhost:3000/api/cron/wiki 2>&1)
 *     code=$?
 *
 *     echo "$(date '+%F %T') exit=$code $antwort" >> "$PROTOKOLL"
 *     [ "$code" -eq 0 ] || stoerungsnotiz "$antwort"   # schreibt in den Vault
 *
 * Nachsehen heißt deshalb `tail` und nicht Posteingang:
 *
 *   tail -n 20 /volume1/docker/schulapp/wiki-uebergabe.log
 *
 * Eine Zeile je Lauf, mit Zeitstempel, Rückgabewert und der Antwort der Route
 * im Wortlaut; das Skript beschneidet die Datei selbst auf 500 Zeilen, damit
 * sie nicht auf Jahre anwächst. Der zweite Rückkanal ist der Vault: Bei
 * `exit != 0` entsteht `topics/schule/SCHULAPP-STOERUNG.md`, Synology Drive
 * trägt sie binnen Minuten auf den Windows-Rechner, und in Obsidian steht dann
 * eine Datei, die vorher nicht da war — der Fehlschlag kommt zum Menschen,
 * statt auf ihn zu warten. Bei Erfolg entsteht nichts. Beides ist vorgeführt:
 * Ein Lauf gegen einen falschen Port hinterließ die Notiz mit
 * „curl: (7) Failed to connect" im Wortlaut. `synodsmnotify` wäre der
 * naheliegende dritte Weg gewesen und ist verworfen — DSM 7.4.1 lehnt einen
 * freien Titel ab („title: 'Schulapp' is neither mail string key nor i18n
 * format").
 *
 * `--fail-with-body` und nicht das kürzere `-f`: Beide machen aus einem
 * Fehlerstatus einen Rückgabewert ungleich null, aber `-f` verwirft dabei den
 * Antwortkörper. Im Protokoll stünde dann nur „curl: (22) The requested URL
 * returned error: 500" — und gerade NICHT der Satz, der sagt, was zu tun ist;
 * dasselbe gälte für die Störungsnotiz, die genau diese Ausgabe weiterreicht.
 * Genau auf diesen Satz beruft sich die Begründung unten an der
 * `WIKI_EXPORT_DIR`-Prüfung; mit `-f` war sie all die Zeit eine Zusage, die
 * das Skript nicht einlöste. Den Schalter gibt es seit curl 7.76 (2021). Ist
 * der auf dem NAS älter, tut es `-fsS` weiterhin — der Lauf schlägt dann
 * genauso fehl, nur ohne die Erklärung dazu.
 *
 * Die Adresse ist die, unter der der Container vom NAS aus erreichbar ist —
 * nachsehen mit `sudo docker compose ps`, falls der Port dort anders
 * veröffentlicht ist. Der öffentliche Funnel-Name wäre der Umweg über draußen
 * und genau das, was hier vermieden werden soll.
 *
 * **3. `CRON_SECRET`** steht schon in der `.env` auf dem NAS — es ist dasselbe,
 * mit dem die Erinnerungen laufen. Ein zweites wäre ein zweites, das jemand
 * vergisst zu drehen.
 *
 * Von Hand anstoßen (die Route ist gefahrlos mehrfach aufrufbar: der zweite
 * Lauf eines Tages findet fast nichts zu tun und legt gar keinen Ordner an):
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/wiki
 *
 * ── Wenn der Vault umzieht oder verloren geht ───────────────────────────────
 *
 * Die App merkt sich, WAS sie geliefert hat, und nicht, wohin. Zeigt
 * `WIKI_EXPORT_DIR` auf einen anderen, leeren Ordner, hält sie alles für längst
 * abgeliefert und schreibt dorthin nichts mehr — wer umzieht, nimmt den Inhalt
 * mit. Wer den vollständigen Bestand noch einmal haben will, leert das
 * Gedächtnis:
 *
 *   sudo docker compose exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
 *     -c 'delete from wiki_deliveries;'
 *
 * Der nächste Lauf übergibt danach alles, so wie der allererste. Daten gehen
 * dabei keine verloren; in der Tabelle stehen nur Abdrücke.
 *
 * ── Wann der Lauf als Fehlschlag im Protokoll steht ─────────────────────────
 *
 * Bei jedem 500, und die gibt es in drei Farben: `CRON_SECRET` fehlt,
 * `WIKI_EXPORT_DIR` fehlt oder der Ordner ist nicht da (dann wirft der Lauf),
 * und — der stille Fall — der Lauf kam durch, hat aber KEINEN Ordner
 * geschrieben, obwohl mindestens ein Konto unterwegs gescheitert ist. Warum
 * gerade diese Bedingung, steht bei `handoverFailure()` weiter unten.
 *
 * `exit=0` und trotzdem kein Ordner ist dagegen der Normalfall: an einem Tag,
 * an dem sich nichts geändert hat, gibt es nichts zu übergeben.
 *
 * ── Warum hier kein `after()` und kein `maxDuration` steht ───────────────────
 *
 * Weil die Antwort der Bericht ist und der Auslöser auf dem NAS keine Frist
 * setzt, die kürzer wäre als das `--max-time` im Skript.
 * Ausführlich steht die Begründung samt den Stellen in der Next-Doku am Kopf
 * von @/lib/wiki/run.
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

  if (!isAuthorized(request, secret)) {
    return Response.json({ ok: false, error: "Nicht erlaubt." }, { status: 401 });
  }

  const root = wikiExportRoot();

  // Nicht als „ok, aber nichts zu tun" beantwortet, sondern als Fehler. Ein
  // grüner Lauf, der jede Nacht nichts tut, ist die Antwort, die niemandem
  // auffällt — und die Übergabe fiele monatelang aus, ohne dass es jemand
  // merkt. `curl --fail-with-body` macht daraus einen Rückgabewert ungleich
  // null; das Skript auf dem NAS schreibt genau diesen Satz ins Protokoll und
  // legt die Störungsnotiz im Vault an.
  if (!root) {
    return Response.json(
      {
        ok: false,
        error: `${WIKI_EXPORT_DIR_ENV} ist nicht gesetzt — ohne den Pfad zum Übergabeordner gibt es nichts zu schreiben. Er gehört in die Umgebung des Containers, und der Ordner muss dort eingehängt sein.`,
      },
      { status: 500 },
    );
  }

  try {
    const summary = await runWikiHandover({ root });
    const gescheitert = handoverFailure(summary);

    // Derselbe Grundsatz wie zwanzig Zeilen weiter oben, nur für den Fall, den
    // die Datei sich bis hierher selbst durchgehen ließ: Ein Lauf, der nichts
    // übergeben hat, wird nicht als Erfolg gemeldet.
    if (gescheitert) {
      console.error("Wiki-Übergabe ohne Ergebnis", summary);

      return Response.json(
        { ok: false, error: gescheitert, ...summary },
        { status: 500 },
      );
    }

    return Response.json({ ok: true, ...summary });
  } catch (fehler) {
    // Der Satz aus dem Fehler ist die eigentliche Auskunft — „Den
    // Übergabeordner gibt es nicht: /uebergabe" sagt im Protokoll und in der
    // Störungsnotiz alles, was zu tun ist. Ohne dieses Auffangen stünde dort
    // eine HTML-Seite mit einem Serverfehler und der Satz im
    // Container-Protokoll.
    console.error("Wiki-Übergabe abgebrochen", fehler);

    return Response.json(
      {
        ok: false,
        error:
          fehler instanceof Error
            ? fehler.message
            : "Die Wiki-Übergabe ist abgebrochen.",
      },
      { status: 500 },
    );
  }
}

/**
 * Muss dieser Lauf als Fehlschlag gemeldet werden — und mit welchem Satz?
 *
 * `null` heißt: als Erfolg melden. Sonst ist die Zeichenkette der Satz, der in
 * die Antwort gehört — und damit ins Protokoll auf dem NAS und in die
 * Störungsnotiz im Vault.
 *
 * ── Der Fehler, den diese Funktion behebt ────────────────────────────────────
 *
 * Hier stand vorher `return Response.json({ ok: true, ...summary })`, ohne
 * einen Blick auf `summary.failed`. Nachgemessen: Wirft `planForUser()` — und
 * dafür reicht eine einzige Abfrage in `collectDocuments()`, die Schranke
 * darin oder `assertUniqueIds()` —, dann zählt @/lib/wiki/run `failed += 1`,
 * überspringt das Konto und macht weiter. Bei einem einzigen Konto bleibt
 * `plans` damit leer, `written` und `entfallen` sind leer, der Lauf kehrt vor
 * `writeHandover()` zurück, und die Antwort lautete: HTTP 200 mit
 * `{"ok":true,"folder":null,"users":1,"failed":1}`. Das `curl -fsS` des
 * Auslösers endete also mit 0, im Protokoll stand `exit=0` neben einer
 * Antwort, die `ok: true` sagte, und weil der Rückgabewert stimmte, entstand
 * auch keine Störungsnotiz im Vault — während dort seit Wochen nichts mehr
 * ankam. Ein Rückkanal, den nur der Rückgabewert auslöst, ist genau so viel
 * wert wie die Ehrlichkeit dieses Rückgabewerts. Genau die Antwort, die diese
 * Datei zwanzig Zeilen über der Stelle für das fehlende `WIKI_EXPORT_DIR`
 * ausdrücklich verwirft:
 * „Ein grüner Lauf, der jede Nacht nichts tut, ist die Antwort, die niemandem
 * auffällt."
 *
 * ── Warum `folder === null` dazugehört ───────────────────────────────────────
 *
 * `failed > 0` allein wäre zu scharf. In @/lib/wiki/run wird zweimal gezählt,
 * und die beiden Zählungen bedeuten Verschiedenes:
 *
 *   - In der ERSTEN Schleife (`planForUser()`) heißt `failed`: von diesem
 *     Konto wurde nichts zusammengetragen und deshalb auch nichts geschrieben.
 *   - In der ZWEITEN Schleife (`recordDeliveries()`) heißt `failed`: der
 *     Ordner steht schon, nur der Abdruck in `wiki_deliveries` fehlt. Das ist
 *     laut dem Kopfkommentar von @/lib/wiki/run die Richtung, in die dieser
 *     Vorgang irren DARF — der nächste Lauf liefert dieselben Dateien unter
 *     denselben Kennungen noch einmal, und der Agent legt sie übereinander.
 *     Ein 500 dafür wäre ein Fehlalarm für einen Zustand, der sich selbst
 *     heilt.
 *
 * Die zweite Schleife läuft nur, wenn ein Ordner geschrieben wurde. `folder
 * === null && failed > 0` trifft deshalb ausschließlich den ersten Fall.
 *
 * ── Was diese Bedingung NICHT sieht ──────────────────────────────────────────
 *
 * Ein Teilausfall bei mehreren Konten: Scheitert eines von dreien, steht der
 * Ordner trotzdem, und der Lauf bleibt grün, obwohl von einem Konto nichts
 * übergeben wurde. Unterscheiden ließe sich das nur, wenn `WikiRunSummary` die
 * beiden Zählungen getrennt führte — das ist eine Änderung an @/lib/wiki/run
 * und gehört nicht hierher. Die App hat heute genau ein Konto; dort ist
 * „nichts geschrieben und etwas gescheitert" immer der Totalausfall.
 *
 * Ein Lauf ohne Ordner und ohne Fehler bleibt ausdrücklich grün: das ist der
 * Tag, an dem sich nichts geändert hat, und dafür wird kein Ordner angelegt.
 */
export function handoverFailure(summary: WikiRunSummary): string | null {
  if (summary.failed === 0 || summary.folder !== null) return null;

  const konten = `${summary.failed} von ${summary.users} ${
    summary.users === 1 ? "Konto" : "Konten"
  }`;

  // Der Satz nennt Zahlen und den Weg zum Grund, aber nicht den Grund selbst:
  // Der geworfene Fehler wird in @/lib/wiki/run gefangen und protokolliert,
  // und die Zusammenfassung bringt ihn nicht mit. Ihn hierher durchzureichen
  // hieße, `WikiRunSummary` zu erweitern — dieselbe Änderung an einer fremden
  // Datei, die oben schon ausgeschlossen ist. Der Verweis aufs Protokoll ist
  // dafür der ehrliche Ersatz.
  return (
    `Kein Übergabeordner geschrieben: Bei ${konten} ist das Zusammentragen gescheitert. ` +
    "Heute ist nichts im Vault angekommen. Woran es lag, steht im Protokoll des " +
    'Containers — „sudo docker compose logs app | grep Wiki-Übergabe".'
  );
}

/**
 * Zeichenweise gleich lange Prüfung, damit sich das Geheimnis nicht über die
 * Antwortzeit erraten lässt. Wortgleich zu /api/cron/reminders — zwei Türen,
 * eine Prüfung, und sie darf an der einen nicht schwächer sein als an der
 * anderen.
 */
function isAuthorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization");
  if (!header) return false;

  const given = Buffer.from(header);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length) return false;

  return timingSafeEqual(given, expected);
}
