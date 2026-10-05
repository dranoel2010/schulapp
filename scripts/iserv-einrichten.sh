#!/bin/bash
# shellcheck disable=SC1111  # „…“ sind deutsche Anführungszeichen, mit Absicht
#
# IServ auf dem NAS einrichten — einmal, in einem Lauf.
#
# Läuft AUF DEM NAS, mit root, erst NACH einem `hoch` und erst, wenn der
# Google Kalender eingerichtet ist (scripts/kalender-einrichten.sh): IServ
# hängt am stündlichen Lauf des Kalenders (kalender.sh um :15) und trägt seine
# Termine in dessen Kalender „Schule“ ein. Eine eigene Crontab-Zeile gibt es
# nicht.
#
#   sudo ~/nas.sh hoch
#   sudo bash /volume1/docker/schulapp/repo/scripts/iserv-einrichten.sh
#
# Davor: Der Stand mit der IServ-Anbindung muss committet und nach main
# gepusht sein — `hoch` holt nur, was auf GitHub steht, und muss mit
# „Fertig.“ enden.
#
# Was es tut, in dieser Reihenfolge:
#
#   0. Nachsehen, ohne etwas zu ändern: root, Werkzeuge, Pfade, ist der Google
#      Kalender eingerichtet (kalender.sh, Crontab-Zeile, GOOGLE_* in der
#      Override-Datei), läuft die App mit dem neuen Code, antwortet die
#      Datenbank, mag Compose die Dateien.
#   1. Die zwei Tabellen einspielen — nur wenn sie fehlen, in einer
#      Transaktion. VOR den Variablen: Mit Variablen und ohne Tabellen
#      antwortet /einstellungen mit 500 (Kopf von scripts/iserv-tabellen.sql).
#   2. Die vier Pflichtwerte in die .env: Adresse und Account sichtbar
#      abgefragt, das Passwort UNSICHTBAR und zweimal, die Klasse 1–13. Was
#      schon da ist, bleibt — außer mit --neues-passwort bzw. --neue-klasse.
#   3. Die sieben ISERV_*-Namen in die docker-compose.override.yml, NEBEN
#      Google, Jev und Docling. Eingefügt wird nur; nachgeprüft, dass nichts
#      wegfiel und Compose die Datei noch mag. Dann die App neu erzeugen —
#      gebaut wird nichts — und aus dem Container nachsehen, ob die Werte
#      angekommen sind. Für das Passwort vergleicht es nur Prüfsummen und sagt
#      „stimmt“ oder „stimmt nicht“.
#   4. Mit --neues-passwort: die Sperre aufheben, damit der nächste Lauf es
#      wieder versucht.
#   5. Probe: kalender.sh einmal von Hand, und aus der Antwort das Feld
#      `iserv` zeigen. „gelesen“ ist der Erfolg. Bei „blockiert“: Passwort
#      prüfen und NICHT einfach wiederholen — jeder Lauf mit falschem Passwort
#      ist ein Fehlversuch bei IServ.
#
# Ein zweiter Lauf ist harmlos: Was schon erledigt ist, wird übersprungen.
#
# Das Passwort steht nie im Protokoll, nie auf dem Bildschirm und nie in einer
# Prozessliste: Es wird unsichtbar gelesen, mit printf (eingebaut) über eine
# Zwischendatei in die .env geschrieben und nur als Prüfsumme verglichen.
# In der .env steht es in einfachen Anführungszeichen, weil erinnerungen.sh die
# .env per „.“ einliest — deshalb sind ' , Zeilenumbrüche und Leerraum am Rand
# nicht erlaubt.
#
# Alles, was hier steht, landet auch in $APP/iserv-einrichten.log.
#
# Für die Probe an einem nachgebauten NAS lassen sich die Pfade verschieben:
#
#   ISERV_EINRICHTEN_WURZEL    wird vor alle festen Pfade gesetzt (Standard: leer)
#   ISERV_EINRICHTEN_APP, ISERV_EINRICHTEN_CRONTAB    einzeln
#   ISERV_EINRICHTEN_DOCKER    welches docker
#   ISERV_EINRICHTEN_EINGABE   woher die Antworten kommen (Standard: /dev/tty)
#
set -u
umask 022

ADRESSE=https://treskownas.tail3a40b0.ts.net
WURZEL=${ISERV_EINRICHTEN_WURZEL:-}
APP=${ISERV_EINRICHTEN_APP:-$WURZEL/volume1/docker/schulapp}
CRONTAB=${ISERV_EINRICHTEN_CRONTAB:-$WURZEL/etc/crontab}
EINGABE=${ISERV_EINRICHTEN_EINGABE:-/dev/tty}

ENVDATEI="$APP/.env"
OVERRIDE="$APP/docker-compose.override.yml"
SQL="$APP/repo/scripts/iserv-tabellen.sql"
KALENDER_SH="$APP/kalender.sh"
LOG="$APP/iserv-einrichten.log"
# Nur ASCII: Die .env lesen Compose, die Shell (erinnerungen.sh per `.`) und sed.
ENV_KOMMENTAR="# IServ (scripts/iserv-einrichten.sh). Nur lesen; das Passwort steht nur hier und im Passwortmanager."
NAMEN="ISERV_URL ISERV_USER ISERV_PASSWORD ISERV_KLASSE ISERV_AUCH ISERV_NIE ISERV_KLASSENKALENDER"
NAMEN_MUSTER='ISERV_(URL|USER|PASSWORD|KLASSE|AUCH|NIE|KLASSENKALENDER)'
INNEN=http://127.0.0.1:3000
JETZT=$(date +%Y%m%d-%H%M%S)

hilfe() {
  echo "IServ auf dem NAS einrichten (nach kalender-einrichten.sh)."
  echo
  echo "  sudo bash $0                  einrichten; Vorhandenes bleibt"
  echo "  sudo bash $0 --neues-passwort Passwort neu eintragen und die Sperre aufheben"
  echo "  sudo bash $0 --neue-klasse    ISERV_KLASSE neu eintragen (zum Schuljahr)"
}

neues_passwort=nein
neue_klasse=nein
for arg in "$@"; do
  case "$arg" in
    --neues-passwort) neues_passwort=ja ;;
    --neue-klasse)    neue_klasse=ja ;;
    -h|--hilfe|--help) hilfe; exit 0 ;;
    *) echo "Unbekannt: $arg" >&2; echo >&2; hilfe >&2; exit 1 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten:  sudo bash $0" >&2; exit 1; }
[ -d "$APP" ] || { echo "FEHLER: Kein $APP. Läuft das hier wirklich auf dem NAS?" >&2; exit 1; }

# ---------------------------------------------------------------- Werkzeuge
fehlt_werkzeug=""
for w in awk sed grep tail head cut tr sort seq sleep tee mktemp curl date ls cp cat rm wc; do
  command -v "$w" >/dev/null 2>&1 || fehlt_werkzeug="$fehlt_werkzeug $w"
done
if command -v openssl >/dev/null 2>&1; then
  pruefsumme() { openssl dgst -sha256 | sed 's/^.*= *//'; }
elif command -v sha256sum >/dev/null 2>&1; then
  pruefsumme() { sha256sum | cut -d' ' -f1; }
else
  fehlt_werkzeug="$fehlt_werkzeug openssl-oder-sha256sum"
fi
if [ -n "$fehlt_werkzeug" ]; then
  echo "FEHLER: Auf diesem System fehlt:$fehlt_werkzeug. Geändert ist noch nichts." >&2
  exit 1
fi

# ---------------------------------------------------------------- docker
DOCKER=${ISERV_EINRICHTEN_DOCKER:-}
if [ -z "$DOCKER" ]; then
  for d in /usr/local/bin/docker /usr/bin/docker /bin/docker; do
    [ -x "$d" ] && { DOCKER="$d"; break; }
  done
  [ -z "$DOCKER" ] && DOCKER=$(command -v docker 2>/dev/null)
fi
[ -n "$DOCKER" ] || { echo "FEHLER: docker nicht gefunden." >&2; exit 1; }
"$DOCKER" compose version >/dev/null 2>&1 || { echo "FEHLER: \"docker compose\" fehlt." >&2; exit 1; }

dc() { ( cd "$APP" && "$DOCKER" compose "$@" ); }
zum_abtippen() { echo "sudo sh -c 'cd $APP && $DOCKER compose $1'"; }

psql_db() {
  # shellcheck disable=SC2016  # die $-Ausdrücke wertet die Shell IM Container aus
  dc exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-schulapp}" -d "${POSTGRES_DB:-${POSTGRES_USER:-schulapp}}" "$@"' psql "$@"
}

db_zahl() {
  local antwort
  antwort=$(psql_db -tAc "$1" < /dev/null 2>&1) || { echo "$antwort"; return 1; }
  antwort=$(printf '%s' "$antwort" | tr -d '[:space:]')
  case "$antwort" in ''|*[!0-9]*) echo "$antwort"; return 1 ;; esac
  echo "$antwort"
}

# ---------------------------------------------------------------- Protokoll
# Die Eingaben lesen von $EINGABE und erscheinen deshalb weder hier noch im
# Protokoll. tee überhört Strg-C und das Auflegen (wie in kalender-einrichten.sh).
exec > >(trap '' INT HUP; exec tee -a "$LOG") 2>&1
echo
echo "##### $(date '+%d.%m.%Y %H:%M:%S') — iserv-einrichten.sh $*"

EINGABE_OFFEN=nein
ZWISCHEN=""
aufraeumen() {
  [ -n "$ZWISCHEN" ] && rm -f "$ZWISCHEN"
  if [ "$EINGABE_OFFEN" = ja ] && [ -t 3 ]; then stty echo <&3; fi 2>/dev/null
  return 0
}
trap aufraeumen EXIT

GEAENDERT=""
SICHERUNGEN=""
merke_aenderung() { GEAENDERT="$GEAENDERT  - $*"$'\n'; }
merke_sicherung() { SICHERUNGEN="$SICHERUNGEN  $*"$'\n'; }
schritt() { echo; echo "=== $* ==="; }

halt() {
  echo
  echo "HALT: $*" >&2
  if [ -n "$GEAENDERT" ]; then
    echo "Bis hierher geändert:" >&2
    printf '%s' "$GEAENDERT" >&2
    [ -n "$SICHERUNGEN" ] && { echo "Sicherungen:" >&2; printf '%s' "$SICHERUNGEN" >&2; }
  else
    echo "Geändert ist noch nichts." >&2
  fi
  echo "Schick mir die Ausgabe — sie steht auch in $LOG. (Das Passwort steht nicht darin.)" >&2
  exit 1
}

trap 'halt "Abgebrochen (Strg-C oder kill)."' INT TERM
trap 'halt "Die Verbindung ist abgerissen (SIGHUP)."' HUP

# ---------------------------------------------------------------- .env
# Der Wert, der gilt: die letzte Zeile des Namens, ohne Wagenrücklauf,
# Leerraum und Anführungszeichen außen herum. Aufrufer, die das Passwort
# lesen, geben es nie aus.
env_wert() {
  local w
  w=$(grep "^$1=" "$ENVDATEI" 2>/dev/null | tail -n 1)
  w=${w#*=}
  w=${w//$'\r'/}
  w="${w#"${w%%[![:space:]]*}"}"
  w="${w%"${w##*[![:space:]]}"}"
  case "$w" in
    \"*\") w=${w#\"}; w=${w%\"} ;;
    \'*\') w=${w#\'}; w=${w%\'} ;;
  esac
  printf '%s' "$w"
}

# Alle Zeilen der genannten Namen aus der .env nehmen — über eine Zwischendatei
# und `cat >`, damit Datei, Eigentümer und Rechte bleiben.
env_entferne() {
  ZWISCHEN=$(mktemp "$APP/.env.neu.XXXXXX") || halt "Konnte keine Zwischendatei neben der .env anlegen."
  if ! KE_NAMEN="$*" awk '
      BEGIN { n = split(ENVIRON["KE_NAMEN"], namen, " ") }
      { for (i = 1; i <= n; i++) if (index($0, namen[i] "=") == 1) next; print }
    ' "$ENVDATEI" > "$ZWISCHEN"; then
    rm -f "$ZWISCHEN"; ZWISCHEN=""
    halt "Konnte die .env nicht lesen."
  fi
  cat "$ZWISCHEN" > "$ENVDATEI" || halt "Konnte die .env nicht schreiben. Sicherung siehe unten."
  rm -f "$ZWISCHEN"; ZWISCHEN=""
}

# shellcheck disable=SC2012
rechte() { ls -ld "$1" 2>/dev/null | awk '{print $1, $3, $4}'; }

weg_und_dazu() {
  awk '
    NR == FNR { alt[++n] = $0; next }
    { if (i < n && $0 == alt[i + 1]) i++; else dazu++ }
    END { print n - i, dazu + 0 }
  ' "$1" "$2"
}

# Nur der Origin: https, ein Host, höchstens ein Port, kein Pfad, keine Query.
url_ok() {
  case "$1" in https://*) ;; *) return 1 ;; esac
  local rest=${1#https://}
  case "$rest" in ''|*[!A-Za-z0-9.:-]*) return 1 ;; esac
  return 0
}

# IServ-Accounts sind klein, ohne Umlaute, Leerzeichen als Punkte.
user_ok() {
  case "$1" in ''|*[!A-Za-z0-9._@-]*) return 1 ;; esac
  return 0
}

# ' bräche die einfachen Anführungszeichen in der .env, Zeilenumbrüche die
# Zeile, und Leerraum am Rand schneidet env_wert ab.
passwort_ok() {
  [ -n "$1" ] || return 1
  case "$1" in *"'"*|*$'\n'*|*$'\r'*) return 1 ;; esac
  case "$1" in [[:space:]]*|*[[:space:]]) return 1 ;; esac
  return 0
}

klasse_ok() {
  case "$1" in [1-9]|1[0-3]) return 0 ;; esac
  return 1
}

schwaerzen() {
  awk -v q="'" '
    NR == FNR {
      i = index($0, "=")
      if (i > 1 && substr($0, 1, 1) != "#") {
        name = substr($0, 1, i - 1)
        w = substr($0, i + 1); gsub(/\r/, "", w)
        gsub("^[\"" q "]|[\"" q "]$", "", w)
        if ((name ~ /SECRET|KEY|PASS|TOKEN|PRIVATE/ && length(w) >= 4) || length(w) >= 16) geheim[++n] = w
      }
      next
    }
    {
      for (k = 1; k <= n; k++)
        while ((p = index($0, geheim[k])) > 0)
          $0 = substr($0, 1, p - 1) "***" substr($0, p + length(geheim[k]))
      print
    }' "$ENVDATEI" -
}

# ---------------------------------------------------------------- Eingabe
eingabe_oeffnen() {
  [ "$EINGABE_OFFEN" = ja ] && return 0
  { exec 3< "$EINGABE"; } 2>/dev/null \
    || halt "Ich kann nicht fragen: $EINGABE lässt sich nicht öffnen. Bitte in einem Terminal starten, nicht aus einem Cron."
  EINGABE_OFFEN=ja
}
frage() {
  if [ -t 3 ]; then printf '%s' "$1" > "$EINGABE"; else printf '%s\n' "$1" >&2; fi
}
lies() { IFS= read -r "$1" <&3 || true; }
lies_verdeckt() {
  IFS= read -rs "$1" <&3 || true
  if [ -t 3 ]; then printf '\n' > "$EINGABE"; fi
}

# ---------------------------------------------------------------- App
warte_auf_app() {
  printf "Warte auf die App "
  for _ in $(seq 1 20); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$INNEN/" 2>/dev/null || true)
    case "$code" in 200|307|308) echo " HTTP $code"; return 0 ;; esac
    printf "."; sleep 6
  done
  echo " HTTP ${code:-000}"
  return 1
}

# Sieht die App die vier Pflichtwerte? Ausgegeben werden nur NAMEN, nie Werte.
pruefe_container() {
  dc exec -T app node -e '
    const e = process.env, fehlt = [];
    for (const n of ["ISERV_URL", "ISERV_USER", "ISERV_KLASSE"]) if (!(e[n] || "").trim()) fehlt.push(n);
    if (!(e.ISERV_PASSWORD || "").trim()) fehlt.push("ISERV_PASSWORD");
    if (fehlt.length > 0) { console.log(fehlt.join(" ")); process.exit(1); }
  ' < /dev/null 2>&1
}

# Die Prüfsumme des Passworts, wie die App es sieht — nur die Summe verlässt den Container.
container_pruefsumme() {
  dc exec -T app node -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.env.ISERV_PASSWORD || "", "utf8").digest("hex"))' < /dev/null 2>/dev/null
}

COMPOSE_FEHLER=""
pruefe_compose() {
  local cfg n dienste
  if ! cfg=$(dc config 2>&1 < /dev/null); then
    COMPOSE_FEHLER=$(printf '%s\n' "$cfg" | schwaerzen | head -n 5)
    return 1
  fi
  n=$(printf '%s\n' "$cfg" | grep -cE "^[[:space:]]+(-[[:space:]]*)?$NAMEN_MUSTER[[:space:]]*[:=]")
  if [ "$n" -lt 7 ]; then
    COMPOSE_FEHLER="Compose sieht nur $n der sieben ISERV_*-Namen — wird die Override-Datei überhaupt geladen?"
    return 1
  fi
  dienste=$(dc config --services < /dev/null 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
  if [ "$dienste" != "$DIENSTE_VORHER" ]; then
    COMPOSE_FEHLER="Die Dienste haben sich verändert — vorher: $DIENSTE_VORHER, jetzt: $dienste"
    return 1
  fi
  return 0
}

iserv_zeilen() {
  local n
  n=$(grep -cE "^[[:space:]]+(-[[:space:]]*)?$NAMEN_MUSTER[[:space:]]*[:=]" "$1" 2>/dev/null)
  echo "${n:-0}"
}

google_zeilen() {
  local n
  n=$(grep -cE '^[[:space:]]+(-[[:space:]]*)?GOOGLE_(CLIENT_ID|CLIENT_SECRET|TOKEN_KEY)[[:space:]]*[:=]' "$1" 2>/dev/null)
  echo "${n:-0}"
}

aktive_zeilen() {
  awk -v p="$1" '$0 !~ /^[[:space:]]*#/ && index($0, p) > 0' "$CRONTAB"
}

# ================================================================ 0
schritt "0  Nachsehen (ändert nichts)"

[ -f "$APP/docker-compose.yml" ] || halt "Keine $APP/docker-compose.yml."
[ -f "$ENVDATEI" ] || halt "Keine $ENVDATEI."
[ -f "$SQL" ] || halt "Keine $SQL — der Klon ist älter als die IServ-Anbindung. Ist der Stand committet und nach main gepusht? Dann erst:  sudo ~/nas.sh hoch  (und auf „Fertig.“ achten)"
[ -f "$CRONTAB" ] || halt "Keine $CRONTAB."
echo "Stand:     $(git -C "$APP/repo" log -1 --format='%h %s' 2>/dev/null || echo '(unbekannt)')"

grep -q '^COMPOSE_FILE=' "$ENVDATEI" && halt "In der .env steht COMPOSE_FILE — die Override-Datei würde übergangen."

# Der Google Kalender muss stehen: IServ hängt an seinem stündlichen Lauf.
[ -x "$KALENDER_SH" ] || halt "Keine $KALENDER_SH — erst den Google Kalender einrichten:  sudo bash $APP/repo/scripts/kalender-einrichten.sh"
[ -n "$(aktive_zeilen "$KALENDER_SH")" ] || halt "kalender.sh steht nicht aktiv in $CRONTAB — erst kalender-einrichten.sh (oder die Zeile aus der Sicherung zurückholen:  ls -l $CRONTAB.sicherung-*)."
[ -f "$OVERRIDE" ] || halt "Keine $OVERRIDE — erst kalender-einrichten.sh, es legt sie an oder ergänzt sie."
[ "$(google_zeilen "$OVERRIDE")" -ge 3 ] || halt "In $OVERRIDE stehen die GOOGLE_*-Namen nicht — erst kalender-einrichten.sh."
echo "Kalender:  kalender.sh, Crontab-Zeile und GOOGLE_* sind da"

app_cid=$(dc ps -q app < /dev/null 2>/dev/null | head -n 1)
[ -n "$app_cid" ] || halt "Der App-Container läuft nicht. Erst:  sudo ~/nas.sh stand"

# Läuft der neue Code? Der Bau trägt den Tabellennamen in den Server-Chunks;
# ein `hoch`, dessen Bau scheiterte, lässt den alten Container weiterlaufen.
if dc exec -T app sh -c 'grep -rlq iserv_snapshots /app/.next/server' < /dev/null >/dev/null 2>&1; then
  echo "App:       neuer Stand läuft (IServ im Bau gefunden)"
else
  halt "Die laufende App kennt IServ noch nicht — der neue Code läuft nicht. Erst:  sudo ~/nas.sh hoch  (und auf „Fertig.“ achten)"
fi

eins=$(db_zahl "select 1") || halt "Die Datenbank antwortet nicht: $eins"
[ "$eins" = 1 ] || halt "Die Datenbank antwortet seltsam: $eins"
echo "Datenbank: antwortet"

DIENSTE_VORHER=$(dc config --services < /dev/null 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
[ -n "$DIENSTE_VORHER" ] || halt "Compose mag die vorhandenen Dateien schon jetzt nicht:  $(zum_abtippen "config -q")"
echo "Dienste:   $DIENSTE_VORHER"
echo "Alles da."

# ================================================================ 1
schritt "1  Tabellen"

TABELLEN="table_schema = 'public' and table_name in ('iserv_state', 'iserv_snapshots')"
n=$(db_zahl "select count(*) from information_schema.tables where $TABELLEN") || halt "Konnte nicht nachsehen: $n"
case "$n" in
  2)
    echo "Beide Tabellen sind schon da — übersprungen."
    s_tabellen="waren schon da" ;;
  0)
    echo "Spiele $SQL ein — in einer Transaktion, Abbruch beim ersten Fehler ..."
    psql_db --single-transaction -f - < "$SQL" || halt "Das Einspielen ging schief (Meldung oben). Weil es eine Transaktion war, ist dabei nichts liegengeblieben."
    merke_aenderung "Tabellen iserv_state und iserv_snapshots angelegt"
    n=$(db_zahl "select count(*) from information_schema.tables where $TABELLEN") || halt "Konnte nicht nachsehen: $n"
    [ "$n" = 2 ] || halt "Nach dem Einspielen sind $n der beiden Tabellen da."
    s_tabellen="neu angelegt" ;;
  *)
    halt "Nur $n der beiden Tabellen ist da — bitte ansehen:  $(zum_abtippen "exec db psql -U schulapp -d schulapp")  und darin  \\dt iserv_*" ;;
esac
k=$(db_zahl "select count(*) from information_schema.table_constraints where $TABELLEN and constraint_type in ('PRIMARY KEY', 'FOREIGN KEY')") || halt "Konnte nicht nachsehen: $k"
[ "$k" = 4 ] || halt "Die Tabellen sind da, aber mit $k statt 4 Schlüsseln — so hat die SQL-Datei sie nicht angelegt."
echo "Geprüft:   2 Tabellen, 4 Schlüssel"

# ================================================================ 2
schritt "2  Werte in der .env"

url_jetzt=$(env_wert ISERV_URL)
user_jetzt=$(env_wert ISERV_USER)
klasse_jetzt=$(env_wert ISERV_KLASSE)
pw_da=nein
[ -n "$(env_wert ISERV_PASSWORD)" ] && pw_da=ja

neue_url=""
neuer_user=""
neues_pw=""
neue_kl=""

if [ -z "$url_jetzt" ]; then
  eingabe_oeffnen
  frage "IServ-Adresse der Schule, nur der Server (https://…): "
  lies neue_url
  neue_url=${neue_url//[[:space:]]/}
  [ -n "$neue_url" ] || halt "Ohne Adresse geht es nicht. Sie steht im Browser, wenn du bei IServ angemeldet bist: https://server — ohne Pfad."
  neue_url=${neue_url%/}
  url_ok "$neue_url" || halt "Das ist keine Adresse, wie die App sie will: https://server — ohne Pfad, ohne ?…"
  echo "ISERV_URL:      $neue_url"
elif url_ok "${url_jetzt%/}"; then
  echo "ISERV_URL:      steht schon da ($url_jetzt) — bleibt."
else
  halt "Die ISERV_URL in der .env ist keine Adresse der Form https://server — bitte mit einem Editor korrigieren:  sudo vi $ENVDATEI"
fi

if [ -z "$user_jetzt" ]; then
  eingabe_oeffnen
  frage "IServ-Account des Schülers (z. B. vorname.nachname): "
  lies neuer_user
  neuer_user=${neuer_user//[[:space:]]/}
  user_ok "$neuer_user" || halt "Das sieht nicht aus wie ein IServ-Account (nur Buchstaben, Ziffern, . _ - @)."
  echo "ISERV_USER:     angenommen"
else
  echo "ISERV_USER:     steht schon da — bleibt."
fi

if [ "$pw_da" = nein ] || [ "$neues_passwort" = ja ]; then
  eingabe_oeffnen
  frage "IServ-Passwort, dann Enter. Es bleibt unsichtbar: "
  lies_verdeckt neues_pw
  [ -n "$neues_pw" ] || halt "Kein Passwort eingegeben."
  passwort_ok "$neues_pw" || halt "Dieses Passwort kann die .env nicht sicher tragen: kein ' darin, kein Zeilenumbruch, kein Leerzeichen am Anfang oder Ende. Bitte in IServ ein anderes vergeben."
  pw2=""
  frage "Noch einmal, zur Kontrolle: "
  lies_verdeckt pw2
  [ "$neues_pw" = "$pw2" ] || { unset pw2; halt "Die beiden Eingaben sind nicht gleich — nichts geschrieben."; }
  unset pw2
  echo "ISERV_PASSWORD: angenommen (verborgen)"
else
  echo "ISERV_PASSWORD: steht schon da (verborgen) — bleibt. Neu:  sudo bash $0 --neues-passwort"
fi

if [ -z "$klasse_jetzt" ] || [ "$neue_klasse" = ja ]; then
  eingabe_oeffnen
  frage "Klasse des Schülers (1–13)${klasse_jetzt:+, bisher $klasse_jetzt}: "
  lies neue_kl
  neue_kl=${neue_kl//[[:space:]]/}
  klasse_ok "$neue_kl" || halt "Eine Klasse von 1 bis 13, bitte."
  echo "ISERV_KLASSE:   $neue_kl"
elif klasse_ok "$klasse_jetzt"; then
  echo "ISERV_KLASSE:   steht schon da ($klasse_jetzt) — bleibt. Zum Schuljahr:  sudo bash $0 --neue-klasse"
else
  halt "Die ISERV_KLASSE in der .env ist keine Zahl von 1 bis 13. Neu:  sudo bash $0 --neue-klasse"
fi

zu_schreiben=""
[ -n "$neue_url" ] && zu_schreiben="$zu_schreiben ISERV_URL"
[ -n "$neuer_user" ] && zu_schreiben="$zu_schreiben ISERV_USER"
[ -n "$neues_pw" ] && zu_schreiben="$zu_schreiben ISERV_PASSWORD"
[ -n "$neue_kl" ] && zu_schreiben="$zu_schreiben ISERV_KLASSE"

env_geaendert=nein
if [ -z "$zu_schreiben" ]; then
  s_env="alle vier waren schon da"
else
  rechte_vorher=$(rechte "$ENVDATEI")
  sicherung="$ENVDATEI.vor-iserv-$JETZT"
  cp -p "$ENVDATEI" "$sicherung" || halt "Konnte die .env nicht sichern."
  merke_sicherung "$sicherung   (die .env vor diesem Lauf — mit dem alten Passwort, falls eines darin stand)"
  echo "Sicherung: $sicherung"

  kommentar_da=nein
  grep -qF "$ENV_KOMMENTAR" "$ENVDATEI" && kommentar_da=ja
  merke_aenderung "In die .env geschrieben:$zu_schreiben"
  env_entferne "$zu_schreiben"
  # printf ist eingebaut: Kein Wert steht in einer Befehlszeile.
  if ! {
    if [ "$kommentar_da" = nein ]; then printf '\n%s\n' "$ENV_KOMMENTAR"; fi
    if [ -n "$neue_url" ]; then printf 'ISERV_URL=%s\n' "$neue_url"; fi
    if [ -n "$neuer_user" ]; then printf 'ISERV_USER=%s\n' "$neuer_user"; fi
    if [ -n "$neues_pw" ]; then printf "ISERV_PASSWORD='%s'\n" "$neues_pw"; fi
    if [ -n "$neue_kl" ]; then printf 'ISERV_KLASSE=%s\n' "$neue_kl"; fi
  } >> "$ENVDATEI"; then
    halt "Konnte nicht in die .env schreiben. Zurück:  sudo cp -p $sicherung $ENVDATEI"
  fi
  env_geaendert=ja

  for name in ISERV_URL ISERV_USER ISERV_PASSWORD ISERV_KLASSE; do
    zeilen=$(grep -c "^$name=" "$ENVDATEI")
    [ "$zeilen" = 1 ] || halt "$name steht nach dem Schreiben $zeilen-mal in der .env."
  done

  # So liest erinnerungen.sh die Datei: per „.“. Liest die Shell das Passwort
  # genau so zurück? Verglichen in einer Subshell, ohne Ausgabe.
  if [ -n "$neues_pw" ]; then
    # shellcheck disable=SC1090
    if ( set -e; . "$ENVDATEI" >/dev/null 2>&1; [ "${ISERV_PASSWORD-}" = "$neues_pw" ] ); then
      echo "Zurückgelesen: Die Shell liest das Passwort aus der .env genau so, wie es eingegeben wurde."
    else
      halt "Die Shell liest das Passwort aus der .env anders zurück (oder die .env lässt sich nicht per „.“ lesen). Zurück:  sudo cp -p $sicherung $ENVDATEI"
    fi
  fi

  rechte_nachher=$(rechte "$ENVDATEI")
  if [ "$rechte_nachher" = "$rechte_vorher" ]; then
    echo "Eingetragen:$zu_schreiben — Rechte wie vorher ($rechte_nachher)."
  else
    echo "Eingetragen:$zu_schreiben — ACHTUNG, Rechte vorher $rechte_vorher, jetzt $rechte_nachher."
  fi
  s_env="ergänzt:$zu_schreiben"
fi

# Lesbar für andere als root? Dann liest jeder Account auf dem NAS das Passwort.
case "$(rechte "$ENVDATEI" | cut -d' ' -f1)" in
  -???r*|-??????r*) echo "ACHTUNG: Die .env ist für Gruppe oder andere lesbar — darin steht jetzt ein Passwort. Enger:  sudo chmod 600 $ENVDATEI" ;;
esac

# Die Prüfsumme für Schritt 3, ohne das Passwort weiterzugeben.
if [ -n "$neues_pw" ]; then
  summe_soll=$(printf '%s' "$neues_pw" | pruefsumme)
else
  summe_soll=$(env_wert ISERV_PASSWORD | pruefsumme)
fi
unset neues_pw

# ================================================================ 3
schritt "3  Override-Datei und App"

trap '' HUP

BLOCK=$(printf '%s\n' \
  "# IServ — ergänzt von scripts/iserv-einrichten.sh. Die Werte stehen in der" \
  "# .env daneben; fehlt einer der Pflichtwerte, ist IServ aus (README, IServ)." \
  $NAMEN)
BLOCK_ZEILEN=$(printf '%s\n' "$BLOCK" | grep -c '')

override_geaendert=nein
override_sicherung=""
n=$(iserv_zeilen "$OVERRIDE")

if [ "$n" -ge 7 ]; then
  echo "Die sieben ISERV_*-Namen stehen schon drin — übersprungen."
  s_override="stand schon drin"
elif [ "$n" -gt 0 ]; then
  halt "In $OVERRIDE stehen nur $n der sieben ISERV_*-Namen — von Hand begonnen? Das ergänze ich nicht blind. Unter services → app → environment gehören je  NAME: \${NAME:-}  für $NAMEN"
else
  ZWISCHEN=$(mktemp "$APP/.override.neu.XXXXXX") || halt "Konnte keine Zwischendatei anlegen."
  KE_BLOCK="$BLOCK" awk '
    function einzug(s) { match(s, /^ */); return RLENGTH }
    function block(   i, n, z) {
      if (ind == "") ind = "      "
      n = split(ENVIRON["KE_BLOCK"], z, "\n")
      for (i = 1; i <= n; i++) {
        if (z[i] ~ /^#/)   print ind z[i]
        else if (liste)    print ind "- " z[i] "=${" z[i] ":-}"
        else               print ind z[i] ": ${" z[i] ":-}"
      }
      fertig = 1
    }
    {
      if (in_env && !fertig) {
        if ($0 ~ /^[[:space:]]*$/) { halten = halten $0 "\n"; next }
        if (einzug($0) > 4) {
          rest = substr($0, einzug($0) + 1)
          if (!erkannt && rest !~ /^#/) {
            ind = substr($0, 1, einzug($0)); liste = (rest ~ /^- /); erkannt = 1
          }
          printf "%s", halten; halten = ""
          print; next
        }
        block(); printf "%s", halten; halten = ""; in_env = 0
      }
      if ($0 ~ /^services:[[:space:]]*(#.*)?$/) { in_s = 1; print; next }
      if ($0 ~ /^[^[:space:]#]/) { in_s = 0; in_app = 0 }
      else if (in_s && $0 ~ /^  [^[:space:]#][^:]*:[[:space:]]*(#.*)?$/) in_app = ($0 ~ /^  app:/)
      print
      if (in_app && !fertig && $0 ~ /^    environment:[[:space:]]*(#.*)?$/) in_env = 1
    }
    END {
      if (in_env && !fertig) { block(); printf "%s", halten }
      exit fertig ? 0 : 3
    }
  ' "$OVERRIDE" > "$ZWISCHEN"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f "$ZWISCHEN"; ZWISCHEN=""
    halt "In $OVERRIDE finde ich kein services → app → environment. Dann bitte von Hand darunter je  NAME: \${NAME:-}  für $NAMEN  — und das Skript noch einmal."
  fi

  read -r minus plus <<EOF
$(weg_und_dazu "$OVERRIDE" "$ZWISCHEN")
EOF
  if [ "${minus:-x}" != 0 ] || [ "${plus:-x}" != "$BLOCK_ZEILEN" ]; then
    rm -f "$ZWISCHEN"; ZWISCHEN=""
    halt "Beim Einfügen wären ${minus:-?} Zeilen weggefallen und ${plus:-?} dazugekommen (erwartet: 0 und $BLOCK_ZEILEN). Nichts geschrieben."
  fi

  override_sicherung="$OVERRIDE.vor-iserv-$JETZT"
  cp -p "$OVERRIDE" "$override_sicherung" || halt "Konnte die Override-Datei nicht sichern."
  cat "$ZWISCHEN" > "$OVERRIDE" || halt "Konnte die Override-Datei nicht schreiben. Zurück:  sudo cp -p $override_sicherung $OVERRIDE"
  rm -f "$ZWISCHEN"; ZWISCHEN=""

  if ! pruefe_compose; then
    cat "$override_sicherung" > "$OVERRIDE"
    rm -f "$override_sicherung"
    halt "Compose mag die ergänzte Datei nicht — wieder zurückgesetzt: $COMPOSE_FEHLER"
  fi
  [ "$(google_zeilen "$OVERRIDE")" -ge 3 ] || halt "Nach dem Ergänzen fehlen die GOOGLE_*-Namen in $OVERRIDE. Zurück:  sudo cp -p $override_sicherung $OVERRIDE"
  override_geaendert=ja
  merke_sicherung "$override_sicherung   (die Override-Datei vor diesem Lauf)"
  merke_aenderung "Sieben ISERV_*-Namen in $OVERRIDE ergänzt"
  echo "Ergänzt:   $OVERRIDE ($BLOCK_ZEILEN Zeilen dazu, keine weg; Dienste unverändert: $DIENSTE_VORHER)"
  s_override="ergänzt, nichts weggenommen"
fi

fehlen=$(pruefe_container)
rc=$?
summe_ist=$(container_pruefsumme)
if [ "$rc" -eq 0 ] && [ "$summe_ist" = "$summe_soll" ] && [ "$env_geaendert" = nein ] && [ "$override_geaendert" = nein ]; then
  echo "Die App sieht alle Werte schon — kein Neustart nötig."
  s_app="lief schon mit den Werten"
else
  [ "$rc" -ne 0 ] && echo "Im Container fehlen noch: $fehlen"
  echo "Erzeuge die App neu — ohne Bau, bitte jetzt nicht mit Strg-C abbrechen ..."
  dc up -d app < /dev/null || halt "„up -d app“ ging schief (Meldung oben). Protokoll:  $(zum_abtippen "logs --tail=50 app")"
  merke_aenderung "App-Container neu erzeugt (ohne Bau)"
  warte_auf_app || halt "Die App antwortet nach dem Neustart nicht. Protokoll:  $(zum_abtippen "logs --tail=50 app")${override_sicherung:+ — Zurück:  sudo cp -p $override_sicherung $OVERRIDE  und  $(zum_abtippen "up -d app")}"
  fehlen=$(pruefe_container) || halt "Die Werte kommen im Container nicht an — es fehlt: $fehlen"
  summe_ist=$(container_pruefsumme)
  s_app="neu erzeugt, ohne Bau"
fi
if [ -n "$summe_ist" ] && [ "$summe_ist" = "$summe_soll" ]; then
  echo "Passwort im Container: stimmt (verglichen über die Prüfsumme)."
else
  halt "Passwort im Container: stimmt nicht — die App sieht ein anderes als die .env. Steht ISERV_PASSWORD irgendwo doppelt (docker-compose.yml)?"
fi

# ================================================================ 4
schritt "4  Sperre"

if [ "$neues_passwort" = ja ]; then
  # last_attempt_at = null: Sonst wäre der Abruf in Schritt 5 „nicht fällig"
  # (keine drei Stunden seit der Sperre, oder Nacht), und das neue Passwort
  # bliebe ungeprüft. So ist er sofort fällig — wie ein allererster.
  psql_db -c "update iserv_state set blocked_at = null, blocked_reason = null, failures_in_row = 0, last_attempt_at = null" < /dev/null >/dev/null \
    || halt "Konnte die Sperre nicht aufheben. Von Hand: in den Einstellungen „Erneut versuchen“."
  merke_aenderung "Sperre in iserv_state aufgehoben"
  echo "Sperre aufgehoben — die Probe gleich prüft das neue Passwort."
  s_sperre="aufgehoben"
else
  gesperrt=$(db_zahl "select count(*) from iserv_state where blocked_at is not null") || gesperrt=0
  if [ "$gesperrt" != 0 ]; then
    echo "ACHTUNG: IServ ist gesperrt (Grund in den Einstellungen). Mit neuem Passwort:  sudo bash $0 --neues-passwort"
    s_sperre="gesperrt — nicht angefasst"
  else
    echo "Keine Sperre."
    s_sperre="keine"
  fi
fi

# ================================================================ 5
schritt "5  Probe: kalender.sh einmal von Hand"

echo "Das ist eine Anmeldung bei IServ (sofern ein Abruf fällig ist). Sie steht in den „Letzten Anmeldungen“ des Schülers."
probe=$(bash "$KALENDER_SH" < /dev/null 2>&1)
probe_rc=$?
iserv_status=$(printf '%s\n' "$probe" | sed -n 's/.*"iserv":{"status":"\([a-z-]*\)".*/\1/p' | tail -n 1)
iserv_satz=$(printf '%s\n' "$probe" | sed -n 's/.*"iserv":{"status":"[a-z-]*","satz":"\([^"]*\)".*/\1/p' | tail -n 1)
echo "kalender.sh: exit=$probe_rc"
echo "IServ:       ${iserv_status:-(kein Feld iserv in der Antwort)}${iserv_satz:+ — $iserv_satz}"

probe_ok=nein
case "$iserv_status" in
  gelesen)
    echo "Gelesen. In den Einstellungen (Karte IServ) steht jetzt, was übernommen wurde und was knapp draußen blieb."
    probe_ok=ja ;;
  nicht-faellig)
    if [ "$neues_passwort" = ja ]; then
      echo "Nicht fällig — das neue Passwort ist damit NICHT geprüft. In den Einstellungen „Erneut versuchen“ oder auf den nächsten stündlichen Lauf warten."
    else
      echo "Nicht fällig — der letzte Abruf ist keine drei Stunden her, oder es ist zwischen 21 und 6 Uhr. Der nächste fällige stündliche Lauf liest."
      probe_ok=ja
    fi ;;
  ruht)
    echo "IServ ruht: Der Google Kalender ist nicht verbunden. Erst in den Einstellungen verbinden ($ADRESSE/einstellungen)."
    probe_ok=ja ;;
  blockiert)
    echo "BLOCKIERT. IServ hat die Anmeldung abgelehnt (oder verlangt einen zweiten Faktor, ein Captcha, ein neues Passwort)."
    echo "NICHT einfach wiederholen. Erst Account und Passwort im Browser bei IServ prüfen, dann:"
    echo "  sudo bash $0 --neues-passwort" ;;
  teilweise)
    echo "Teilweise gelesen — der öffentliche Kalender kam an, eine andere Quelle nicht oder die Klasse stimmt nicht (Satz oben)."
    echo "Stimmt die Klasse nicht:  sudo bash $0 --neue-klasse"
    probe_ok=ja ;;
  aus)
    echo "Die App sagt, IServ sei aus — dann sieht sie die Variablen anders als Schritt 3. Protokoll:  $(zum_abtippen "logs --tail=50 app") | grep IServ" ;;
  *)
    echo "Kein Erfolg (Satz oben). Mehr:  $(zum_abtippen "logs --tail=100 app") | grep IServ" ;;
esac

# ================================================================ fertig
schritt "Fertig"
echo "Tabellen:  $s_tabellen"
echo ".env:      $s_env"
echo "Override:  $s_override"
echo "App:       $s_app"
echo "Sperre:    $s_sperre"
echo "Probe:     ${iserv_status:-?}"
echo
if [ -n "$SICHERUNGEN" ]; then
  echo "Sicherungen dieses Laufs:"
  printf '%s' "$SICHERUNGEN"
  echo "Die .env-Sicherung trägt womöglich ein altes Passwort — nach erfolgreichem Lauf löschen."
else
  echo "Sicherungen: keine — dieser Lauf hat nichts geändert."
fi
echo
echo "Was in „Schule“ landet und was knapp draußen bleibt, steht in den Einstellungen unter IServ:"
echo "  $ADRESSE/einstellungen#iserv"
echo "Rückweg: die ISERV_*-Zeilen aus .env und Override-Datei nehmen, dann  $(zum_abtippen "up -d app")."
echo "Die schon eingetragenen IServ-Termine bleiben dann in Google stehen."

[ "$probe_ok" = ja ] || exit 1
exit 0
