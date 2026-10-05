#!/bin/bash
# shellcheck disable=SC1111  # „…“ sind deutsche Anführungszeichen, mit Absicht
#
# Den Google Kalender auf dem NAS einrichten — einmal, in einem Lauf.
#
# Läuft AUF DEM NAS, mit root, und erst NACH einem `hoch` — vorher gibt es
# diese Datei dort nicht, und die laufende App kennt die Route nicht:
#
#   sudo ~/nas.sh hoch
#   sudo bash /volume1/docker/schulapp/repo/scripts/kalender-einrichten.sh
#
# Davor: Der Stand mit der Kalender-Anbindung muss committet und nach main
# gepusht sein — `hoch` holt nur, was auf GitHub steht. Es muss mit „Fertig."
# enden; „Nichts Neues" heißt, der Push fehlt noch.
#
# Danach bleibt ein Handgriff, den kein Skript tun kann: im Browser unter
# Einstellungen „Mit Google verbinden" drücken.
#
# Am besten vom Rechner aus, mit stabiler Verbindung. Reißt sie ab, solange
# das Skript noch fragt, hält es an und sagt, was schon geändert ist; reißt sie
# danach ab, läuft es zu Ende — das Ergebnis steht dann im Protokoll (unten).
#
# Was es tut, in dieser Reihenfolge, und warum gerade so:
#
#   0. Nachsehen, ohne etwas zu ändern: root, Werkzeuge, Pfade, läuft die App
#      mit dem neuen Code, antwortet die Datenbank, mag Compose die Dateien.
#      Passt etwas nicht, hört es hier auf.
#   1. Die zwei Tabellen einspielen — nur wenn sie fehlen, in einer
#      Transaktion, mit Abbruch beim ersten Fehler. VOR den Variablen: Mit
#      Variablen und ohne Tabellen antwortet /einstellungen mit 500 (Kopf von
#      scripts/google-kalender-tabellen.sql). Dass der neue Code schon läuft,
#      schadet nicht: Ohne GOOGLE_*-Variablen fasst er die Tabellen nicht an.
#   2. Die drei GOOGLE_*-Werte in die .env. Client-ID und Secret werden
#      abgefragt (das Secret unsichtbar), der Schlüssel selbst erzeugt. Was
#      schon da ist, bleibt — ein neuer Schlüssel hieße neu verbinden.
#   3. Dieselben drei Namen in die docker-compose.override.yml, NEBEN Jev und
#      Docling, die dort schon stehen. Eingefügt wird nur; nachgeprüft wird,
#      dass nichts wegfiel und Compose die Datei noch mag. Dann die App neu
#      erzeugen — gebaut wird nichts — und aus dem Container nachsehen, ob die
#      Werte angekommen sind. Die Datei gehört damit zweien: Löscht sie
#      jemand (der Rückweg von jev-und-docling.sh tut das), ist auch der
#      Kalender aus.
#   4. kalender.sh neben die Compose-Datei, nach dem Muster von
#      erinnerungen.sh und wiki-uebergabe.sh — aber mit einer eigenen
#      Störungsnotiz, damit die drei Auslöser einander nicht hineinschreiben.
#   5. Die Zeile in /etc/crontab, und crond neu laden — erst, wenn gerade kein
#      Lauf der Schulapp arbeitet. Danach nachsehen, ob die Datei noch so
#      dasteht; schreibt DSM sie beim Neustart neu, kommt der Stand davor
#      zurück, und das Skript hält an.
#   6. Probe: kalender.sh einmal von Hand. Ohne Verbindung antwortet die
#      Route 200 — „noch nicht verbunden" ist keine Störung.
#
# Ein zweiter Lauf ist harmlos: Was schon erledigt ist, wird übersprungen, und
# er sagt, was er überspringt.
#
# Zwei Schalter, beide nur dafür, etwas Vorhandenes zu ersetzen:
#
#   --neue-zugangsdaten   Client-ID und Secret neu abfragen und ersetzen. Ein
#                         neues Secret desselben Clients schadet keiner
#                         Verbindung; eine andere Client-ID heißt trennen und
#                         neu verbinden — dann fragt das Skript nach.
#   --neuer-schluessel    GOOGLE_TOKEN_KEY neu erzeugen. Ein bestehender
#                         Zugang lässt sich danach nicht mehr entschlüsseln —
#                         die Karte sagt „blockiert", und es heißt neu verbinden.
#                         Auch hier fragt das Skript nach, wenn eine Verbindung
#                         besteht.
#
# Alles, was hier steht, landet auch in $APP/kalender-einrichten.log — das
# Secret und der Schlüssel nicht. Beide werden nie ausgegeben.
#
# Für die Probe an einem nachgebauten NAS lassen sich die Pfade verschieben:
#
#   KALENDER_WURZEL    wird vor alle festen Pfade gesetzt (Standard: leer)
#   KALENDER_APP, KALENDER_CRONTAB, KALENDER_NOTIZ    einzeln
#   KALENDER_DOCKER    welches docker
#   KALENDER_EINGABE   woher die Antworten kommen (Standard: /dev/tty)
#
set -u
umask 022

ADRESSE=https://treskownas.tail3a40b0.ts.net
WURZEL=${KALENDER_WURZEL:-}
APP=${KALENDER_APP:-$WURZEL/volume1/docker/schulapp}
CRONTAB=${KALENDER_CRONTAB:-$WURZEL/etc/crontab}
# Im selben Ordner wie die SCHULAPP-STOERUNG.md von wiki-uebergabe.sh und
# erinnerungen.sh, aber eine eigene Datei: Wie die beiden ihre Notiz schreiben
# (anhängen oder überschreiben) und woran sie „heute schon eine" erkennen,
# steht nur auf dem NAS. Teilten sich drei Auslöser eine Datei, könnte eine
# Kalender-Notiz die der Erinnerungen unterdrücken oder die Wiki-Übergabe die
# des Kalenders überschreiben.
NOTIZ=${KALENDER_NOTIZ:-$WURZEL/volume1/homes/Leonard/Drive/wiki/topics/schule/SCHULAPP-STOERUNG-KALENDER.md}
EINGABE=${KALENDER_EINGABE:-/dev/tty}

ENVDATEI="$APP/.env"
OVERRIDE="$APP/docker-compose.override.yml"
SQL="$APP/repo/scripts/google-kalender-tabellen.sql"
KALENDER_SH="$APP/kalender.sh"
LOG="$APP/kalender-einrichten.log"
MARKE="# angelegt von scripts/kalender-einrichten.sh"
# Nur ASCII: Die .env lesen Compose, die Shell (erinnerungen.sh per `.`) und sed.
ENV_KOMMENTAR="# Google Kalender (scripts/kalender-einrichten.sh). GOOGLE_TOKEN_KEY im Passwortmanager sichern - ein Wechsel heisst neu verbinden."
# Tabs wie in den Zeilen, die DSM selbst schreibt.
CRONZEILE=$(printf '15\t*\t*\t*\t*\troot\t%s' "$KALENDER_SH")
# Was kalender.sh ruft, ruft auch dieses Skript: die App direkt an ihrem Port,
# ohne Funnel (wie nas.sh).
INNEN=http://127.0.0.1:3000
JETZT=$(date +%Y%m%d-%H%M%S)
HEUTE=$(date +%Y%m%d)

hilfe() {
  echo "Den Google Kalender auf dem NAS einrichten."
  echo
  echo "  sudo bash $0                       einrichten; Vorhandenes bleibt"
  echo "  sudo bash $0 --neue-zugangsdaten   Client-ID und Secret ersetzen"
  echo "  sudo bash $0 --neuer-schluessel    GOOGLE_TOKEN_KEY neu erzeugen (heißt: neu verbinden)"
}

neue_zugangsdaten=nein
neuer_schluessel=nein
for arg in "$@"; do
  case "$arg" in
    --neue-zugangsdaten) neue_zugangsdaten=ja ;;
    --neuer-schluessel)  neuer_schluessel=ja ;;
    -h|--hilfe|--help)   hilfe; exit 0 ;;
    *) echo "Unbekannt: $arg" >&2; echo >&2; hilfe >&2; exit 1 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten:  sudo bash $0" >&2; exit 1; }
[ -d "$APP" ] || { echo "FEHLER: Kein $APP. Läuft das hier wirklich auf dem NAS?" >&2; exit 1; }

# ---------------------------------------------------------------- Werkzeuge
# Alle, bevor irgendetwas geändert wird — und bevor tee das Protokoll führt.
# Fehlte eines erst mitten im Lauf, stünde die .env schon halb da. Ob DSM sie
# alle hat, ist nur für die belegt, die nas.sh und jev-und-docling.sh dort
# schon benutzt haben; diff und cmp braucht dieses Skript deshalb gar nicht.
# Den Schlüssel macht openssl, sonst head und base64.
fehlt_werkzeug=""
for w in awk sed grep tail head cut tr sort seq sleep tee mktemp curl date ls cp cat chmod rm wc dirname; do
  command -v "$w" >/dev/null 2>&1 || fehlt_werkzeug="$fehlt_werkzeug $w"
done
command -v openssl >/dev/null 2>&1 || command -v base64 >/dev/null 2>&1 || fehlt_werkzeug="$fehlt_werkzeug openssl-oder-base64"
if [ -n "$fehlt_werkzeug" ]; then
  echo "FEHLER: Auf diesem System fehlt:$fehlt_werkzeug. Geändert ist noch nichts." >&2
  exit 1
fi

# ---------------------------------------------------------------- docker
# Wie in nas.sh: sudo nimmt /usr/local/bin aus dem Suchpfad, und genau dort
# liegt docker auf dem NAS.
DOCKER=${KALENDER_DOCKER:-}
if [ -z "$DOCKER" ]; then
  for d in /usr/local/bin/docker /usr/bin/docker /bin/docker; do
    [ -x "$d" ] && { DOCKER="$d"; break; }
  done
  [ -z "$DOCKER" ] && DOCKER=$(command -v docker 2>/dev/null)
fi
[ -n "$DOCKER" ] || { echo "FEHLER: docker nicht gefunden. Läuft das hier wirklich auf dem NAS?" >&2; exit 1; }
"$DOCKER" compose version >/dev/null 2>&1 || { echo "FEHLER: \"docker compose\" fehlt." >&2; exit 1; }

dc() { ( cd "$APP" && "$DOCKER" compose "$@" ); }

# Befehle zum Abtippen. Auf dem NAS geht weder `cd` in den Ordner (er gehört
# root) noch `sudo docker` (sudo kennt /usr/local/bin nicht) — deshalb diese
# Form, wie in nas.sh und jev-und-docling.sh.
zum_abtippen() { echo "sudo sh -c 'cd $APP && $DOCKER compose $1'"; }

# psql im db-Container. Benutzer und Datenbank nimmt er aus seiner eigenen
# Umgebung (POSTGRES_USER/POSTGRES_DB stehen dort ohnehin); "schulapp" nur als
# Rückfall, so wie es im Kopf der SQL-Datei steht.
psql_db() {
  # shellcheck disable=SC2016  # die $-Ausdrücke wertet die Shell IM Container aus
  dc exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-schulapp}" -d "${POSTGRES_DB:-${POSTGRES_USER:-schulapp}}" "$@"' psql "$@"
}

# Eine Zahl aus der Datenbank. Bei einem Fehler steht der Fehler im Ergebnis
# und der Rückgabewert ist ungleich null.
db_zahl() {
  local antwort
  antwort=$(psql_db -tAc "$1" < /dev/null 2>&1) || { echo "$antwort"; return 1; }
  antwort=$(printf '%s' "$antwort" | tr -d '[:space:]')
  case "$antwort" in ''|*[!0-9]*) echo "$antwort"; return 1 ;; esac
  echo "$antwort"
}

# ---------------------------------------------------------------- Protokoll
# Ab hier mitschreiben. Die Eingaben lesen von $EINGABE und erscheinen deshalb
# weder hier noch im Protokoll. tee überhört Strg-C und das Auflegen der
# Verbindung (es sitzt in derselben Prozessgruppe): Stürbe es mit, gingen die
# letzten Zeilen — „Bis hierher geändert" — nirgends mehr hin.
exec > >(trap '' INT HUP; exec tee -a "$LOG") 2>&1
echo
echo "##### $(date '+%d.%m.%Y %H:%M:%S') — kalender-einrichten.sh $*"

EINGABE_OFFEN=nein
ZWISCHEN=""
aufraeumen() {
  [ -n "$ZWISCHEN" ] && rm -f "$ZWISCHEN"
  # Falls mitten in der verdeckten Eingabe abgebrochen wird: Echo wieder an.
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
    if [ -n "$SICHERUNGEN" ]; then
      echo "Sicherungen:" >&2
      printf '%s' "$SICHERUNGEN" >&2
    fi
  else
    echo "Geändert ist noch nichts." >&2
  fi
  echo "Schick mir die Ausgabe — sie steht auch in $LOG." >&2
  exit 1
}

# Abbruch von außen: dieselbe Liste wie bei jedem Halt. Das Auflegen (SIGHUP,
# etwa Termius über Mobilfunk) hält nur, solange noch gefragt wird; ab
# Schritt 3 läuft das Skript weiter (siehe dort).
trap 'halt "Abgebrochen (Strg-C oder kill)."' INT TERM
trap 'halt "Die Verbindung ist abgerissen (SIGHUP)."' HUP

# ---------------------------------------------------------------- .env
# Der Wert, der gilt: die letzte Zeile des Namens, ohne Wagenrücklauf, ohne
# Leerraum und Anführungszeichen außen herum. Gibt ihn aus — Aufrufer, die ein
# Geheimnis lesen, geben ihn nicht weiter.
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

# Alle Zeilen der genannten Namen aus der .env nehmen. Über eine Zwischendatei
# und `cat >`, nicht `mv`: So bleiben Datei, Eigentümer und Rechte dieselben.
# Die Namen gehen über die Umgebung an awk, die Werte kommen nie in eine
# Befehlszeile.
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

# ls und nicht stat: stat schreibt sich auf DSM und am Mac verschieden.
# shellcheck disable=SC2012
rechte() { ls -ld "$1" 2>/dev/null | awk '{print $1, $3, $4}'; }

# Zwei Dateien mit demselben Inhalt? Ohne cmp, das auf DSM nicht belegt ist.
# Der Punkt hinten bewahrt Zeilenenden am Schluss vor dem Abschneiden durch $( ).
# Für kleine Textdateien (kalender.sh, Crontab), nicht für Binäres.
gleicher_inhalt() {
  [ -f "$1" ] && [ -f "$2" ] && [ "$(cat "$1"; echo .)" = "$(cat "$2"; echo .)" ]
}

# Was beim Einfügen wegfiel und was dazukam, ohne diff: Die alten Zeilen
# müssen alle, in ihrer Reihenfolge, in der neuen Datei stehen (gierig gesucht
# — das findet eine solche Folge, wenn es sie gibt); jede übrige neue Zeile
# zählt als dazugekommen. Ausgabe: "<weg> <dazu>".
weg_und_dazu() {
  awk '
    NR == FNR { alt[++n] = $0; next }
    { if (i < n && $0 == alt[i + 1]) i++; else dazu++ }
    END { print n - i, dazu + 0 }
  ' "$1" "$2"
}

# 32 Bytes in base64: 43 Zeichen und ein "=" (so schreibt es openssl) oder 43
# ohne Auffüllung, Standard- oder URL-Alphabet — was @/lib/calendar/config
# annimmt.
schluessel_ok() {
  case "$1" in ''|*[!A-Za-z0-9+/_=-]*) return 1 ;; esac
  local ohne=${1%=}
  case "$ohne" in *=*) return 1 ;; esac
  [ ${#ohne} -eq 43 ]
}

client_id_ok() {
  case "$1" in ''|*[!A-Za-z0-9.-]*) return 1 ;; esac
  case "$1" in ?*.apps.googleusercontent.com) return 0 ;; esac
  return 1
}

# Zeichen außerhalb dieser Liste machen in einer .env Ärger: Compose liest sie
# anders als die Shell, und erinnerungen.sh liest die Datei per `.` ein.
secret_ok() {
  [ ${#1} -ge 10 ] || return 1
  case "$1" in *[!A-Za-z0-9_.~+/=-]*) return 1 ;; esac
  return 0
}

# Die Client-ID ist kein Geheimnis (sie steht in jeder Anmelde-Adresse), aber
# ganz muss sie auch nicht ins Protokoll.
kurz_id() { printf '%s…apps.googleusercontent.com' "$(printf '%s' "$1" | cut -c1-8)"; }

# Ersetzt in einer Ausgabe die geheimen Werte aus der .env durch ***. Für den
# Fall, dass Compose in einer Fehlermeldung einen Wert zitiert. Geheim heißt:
# der Name klingt danach (SECRET, KEY, PASS, TOKEN, PRIVATE), oder der Wert ist
# lang genug, um einer zu sein. Kurze wie POSTGRES_USER=schulapp bleiben stehen
# — sonst würde aus jedem Pfad mit „schulapp" darin Kauderwelsch.
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

# Die Frage dorthin, wo auch geantwortet wird; ohne Terminal ins Protokoll.
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

# Sieht die laufende App die drei Werte, und taugen sie? Gefragt wird node im
# Container, mit derselben Prüfung wie @/lib/calendar/config. Ausgegeben werden
# nur die NAMEN dessen, was fehlt — nie ein Wert.
pruefe_container() {
  dc exec -T app node -e '
    const e = process.env, fehlt = [];
    const t = (n) => (e[n] || "").trim();
    if (!t("GOOGLE_CLIENT_ID").endsWith(".apps.googleusercontent.com")) fehlt.push("GOOGLE_CLIENT_ID");
    if (!t("GOOGLE_CLIENT_SECRET")) fehlt.push("GOOGLE_CLIENT_SECRET");
    if (Buffer.from(t("GOOGLE_TOKEN_KEY"), "base64").length !== 32) fehlt.push("GOOGLE_TOKEN_KEY");
    if (fehlt.length > 0) { console.log(fehlt.join(" ")); process.exit(1); }
  ' < /dev/null 2>&1
}

# Mag Compose die Dateien, und sieht es die drei Namen bei der App? Die
# Ausgabe von `config` enthält die Werte und wird deshalb nur gezählt, nie
# gezeigt. Ein Fehler kommt geschwärzt in $COMPOSE_FEHLER.
COMPOSE_FEHLER=""
pruefe_compose() {
  local cfg n dienste
  if ! cfg=$(dc config 2>&1 < /dev/null); then
    COMPOSE_FEHLER=$(printf '%s\n' "$cfg" | schwaerzen | head -n 5)
    return 1
  fi
  n=$(printf '%s\n' "$cfg" | grep -cE '^[[:space:]]+(-[[:space:]]*)?GOOGLE_(CLIENT_ID|CLIENT_SECRET|TOKEN_KEY)[[:space:]]*[:=]')
  if [ "$n" -lt 3 ]; then
    COMPOSE_FEHLER="Compose sieht nur $n der drei GOOGLE_*-Namen — wird die Override-Datei überhaupt geladen?"
    return 1
  fi
  dienste=$(dc config --services < /dev/null 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
  if [ "$dienste" != "$DIENSTE_VORHER" ]; then
    COMPOSE_FEHLER="Die Dienste haben sich verändert — vorher: $DIENSTE_VORHER, jetzt: $dienste"
    return 1
  fi
  return 0
}

# Die GOOGLE_*-Zeilen in einer YAML-Datei, gleich welcher Form.
google_zeilen() {
  local n
  n=$(grep -cE '^[[:space:]]+(-[[:space:]]*)?GOOGLE_(CLIENT_ID|CLIENT_SECRET|TOKEN_KEY)[[:space:]]*[:=]' "$1" 2>/dev/null)
  echo "${n:-0}"
}

# ---------------------------------------------------------------- crond
finde_befehl() {
  local d
  command -v "$1" 2>/dev/null && return 0
  for d in /usr/syno/bin /usr/syno/sbin /usr/bin /bin /usr/sbin /sbin; do
    [ -x "$d/$1" ] && { echo "$d/$1"; return 0; }
  done
  return 1
}

# Wie man crond auf DSM 7 neu lädt, steht nirgends in diesem Repo: Für die
# Zeilen vom 11.9.2026 ist es nicht festgehalten. DSM 7 läuft mit systemd und
# hat dazu den eigenen Wrapper synosystemctl; synoservice ist der Weg von DSM 6.
# Also der Reihe nach, und gesagt wird, welcher gegriffen hat.
crond_neu_laden() {
  local b
  if b=$(finde_befehl synosystemctl) && "$b" restart crond >/dev/null 2>&1; then
    echo "synosystemctl restart crond"; return 0
  fi
  if b=$(finde_befehl systemctl) && "$b" restart crond >/dev/null 2>&1; then
    echo "systemctl restart crond"; return 0
  fi
  if b=$(finde_befehl synoservice) && "$b" --restart crond >/dev/null 2>&1; then
    echo "synoservice --restart crond"; return 0
  fi
  return 1
}

# Aktive Zeilen (nicht auskommentiert), die einen Pfad enthalten.
aktive_zeilen() {
  awk -v p="$1" '$0 !~ /^[[:space:]]*#/ && index($0, p) > 0' "${2:-$CRONTAB}"
}

# Arbeitet gerade ein Lauf der Schulapp, den crond gestartet hat? Ein Neustart
# von crond unter systemd beendet auch dessen Kinder — erinnerungen.sh stürbe
# mitten im Lauf, und im Protokoll fehlte die Zeile dieser Stunde. Ohne pgrep
# lässt sich das nicht sehen; dann wird nicht gewartet.
cron_lauf_aktiv() {
  command -v pgrep >/dev/null 2>&1 || return 1
  pgrep -f "$APP/(erinnerungen|wiki-uebergabe|kalender)\.sh" >/dev/null 2>&1
}

# Wartet bis zu drei Minuten, bis kein solcher Lauf mehr arbeitet. Rückgabe 1:
# Es arbeitet immer noch einer.
warte_auf_cron_laeufe() {
  cron_lauf_aktiv || return 0
  printf "Ein Lauf der Schulapp arbeitet gerade — warte, damit der Neustart von crond ihn nicht abschießt "
  for _ in $(seq 1 36); do
    sleep 5
    if ! cron_lauf_aktiv; then echo " fertig."; return 0; fi
    printf "."
  done
  echo " läuft noch."
  return 1
}

# ---------------------------------------------------------------- kalender.sh
# Der Inhalt ist fest — kein Datum darin —, damit ein zweiter Lauf beim Vergleichen
# sieht, dass sich nichts geändert hat.
kalender_sh_inhalt() {
  cat <<'KOPF'
#!/bin/bash
# angelegt von scripts/kalender-einrichten.sh — dort ändern, nicht hier; ein
# neuer Lauf des Skripts ersetzt diese Datei.
#
# Der stündliche Abgleich mit dem Google Kalender, gerufen aus /etc/crontab
# um Minute 15 — die Erinnerungen laufen um :05, das Wiki um 02:30, und der
# Lauf um 03:15 ist vor dem DSM-Neustart donnerstags um 03:45 fertig.
#
# Nach dem Muster von erinnerungen.sh und wiki-uebergabe.sh: ruft die Route
# von innen, ohne Funnel; schreibt eine Zeile je Lauf (Zeit, Rückgabewert,
# HTTP-Status, Antwort im Wortlaut) nach kalender.log, beschnitten auf 500
# Zeilen; legt bei einem Fehlschlag eine Störungsnotiz in den Vault, höchstens
# eine am Tag — in eine eigene Datei neben der SCHULAPP-STOERUNG.md der
# beiden anderen.
#
# --max-time 300: Die Route antwortet nach spätestens 285 Sekunden, auch wenn
# der Lauf dann noch arbeitet (Kopf von src/app/api/cron/kalender/route.ts).
# Die Antwort kommt also vor dem Abbruch durch curl.
#
# Ohne Verbindung antwortet die Route 200: „noch nicht verbunden" ist keine
# Störung.
set -u

KOPF
  printf 'APP=%q\n' "$APP"
  printf 'NOTIZ=%q\n' "$NOTIZ"
  cat <<'RUMPF'
LOG="$APP/kalender.log"
TAG="$APP/.kalender-notiz-tag"
URL=http://127.0.0.1:3000/api/cron/kalender

# Nur CRON_SECRET aus der .env, nicht die ganze Datei per `.` — so führt
# dieses Skript nichts aus, was in der .env steht.
geheimnis=$(sed -n 's/^CRON_SECRET=//p' "$APP/.env" 2>/dev/null | tail -n 1 | tr -d '\r')
geheimnis=${geheimnis#\"}; geheimnis=${geheimnis%\"}
geheimnis=${geheimnis#\'}; geheimnis=${geheimnis%\'}

# --fail-with-body (curl ab 7.76) behält bei einem Fehlerstatus den Satz der
# Route; -f verwürfe ihn. Ein älteres curl kann nur -f.
fail=-f
curl --fail-with-body --version >/dev/null 2>&1 && fail=--fail-with-body

# mktemp, wenn es geht; sonst ein fester Name mit der Prozessnummer im Ordner
# daneben, der root gehört. Ohne Rückfall endete ein Lauf ohne mktemp ohne eine
# Zeile im Protokoll — still, genau das, was dieses Skript verhindern soll.
fehler=$(mktemp 2>/dev/null) || fehler="$APP/.kalender-fehler.$$"
trap 'rm -f "$fehler"' EXIT

if [ -z "$geheimnis" ]; then
  code=1; status=000; antwort="CRON_SECRET fehlt in $APP/.env"
else
  # Das Geheimnis geht über stdin an curl (-K -), nicht als Argument: So
  # steht es in keiner Prozessliste.
  ausgabe=$(printf 'header = "Authorization: Bearer %s"\n' "$geheimnis" \
    | curl "$fail" -sS --max-time 300 -K - -w '\n%{http_code}' "$URL" 2>"$fehler")
  code=$?
  status=${ausgabe##*$'\n'}
  antwort=${ausgabe%$'\n'*}
  [ "$antwort" = "$ausgabe" ] && antwort=""
  [ -s "$fehler" ] && antwort="$antwort $(cat "$fehler")"
fi
antwort=$(printf '%s' "$antwort" | tr '\r\n' '  ' | sed 's/^ *//; s/ *$//')

zeile="$(date '+%F %T') exit=$code http=$status $antwort"
echo "$zeile" >> "$LOG"
echo "$zeile"

if [ "$(wc -l < "$LOG")" -gt 500 ]; then
  tail -n 500 "$LOG" > "$LOG.kurz" && cat "$LOG.kurz" > "$LOG"
  rm -f "$LOG.kurz"
fi

[ "$code" -eq 0 ] && exit 0

# Störungsnotiz, höchstens eine am Tag — sonst stünden nach einer
# durchgefallenen Nacht vierundzwanzig gleichlautende Absätze darin.
# Angehängt, nicht überschrieben: Was schon darin steht, hat womöglich noch
# niemand gelesen. Eine eigene Datei, nicht die SCHULAPP-STOERUNG.md der
# Erinnerungen und der Wiki-Übergabe — so hängt keiner der drei Auslöser
# davon ab, wie die anderen beiden schreiben.
heute=$(date +%F)
if [ "$(cat "$TAG" 2>/dev/null)" != "$heute" ]; then
  ordner=$(dirname "$NOTIZ")
  if [ -d "$ordner" ]; then
    neu=nein
    [ -e "$NOTIZ" ] || neu=ja
    {
      echo
      echo "## $(date '+%d.%m.%Y %H:%M') — Google Kalender"
      echo
      echo "Der stündliche Abgleich (kalender.sh) ist gescheitert: exit=$code, HTTP $status."
      echo
      echo '```'
      echo "$antwort"
      echo '```'
      echo
      echo "Protokoll auf dem NAS: \`sudo tail -n 20 $LOG\`. Was zu tun ist, steht meist im Satz oben und in den Einstellungen der App (Karte Google Kalender)."
    } >> "$NOTIZ"
    # Der Vault gehört einem Menschen und wird abgeglichen: dieselbe Kennung
    # wie der Ordner, sonst wird Leonard die Notiz nicht wieder los.
    if [ "$neu" = ja ]; then
      eigner=$(stat -c '%u:%g' "$ordner" 2>/dev/null) && chown "$eigner" "$NOTIZ" 2>/dev/null
    fi
    echo "$heute" > "$TAG"
  else
    echo "$(date '+%F %T') Störungsnotiz nicht geschrieben: $ordner fehlt (Vault nicht eingehängt?)" >> "$LOG"
  fi
fi
exit "$code"
RUMPF
}

# ================================================================ 0
schritt "0  Nachsehen (ändert nichts)"

[ -f "$APP/docker-compose.yml" ] || halt "Keine $APP/docker-compose.yml."
[ -f "$ENVDATEI" ] || halt "Keine $ENVDATEI."
[ -f "$SQL" ] || halt "Keine $SQL — der Klon ist älter als die Kalender-Anbindung. Ist der Stand committet und nach main gepusht? Dann erst:  sudo ~/nas.sh hoch  (und auf „Fertig.“ achten — „Nichts Neues“ heißt, der Push fehlt)"
[ -f "$CRONTAB" ] || halt "Keine $CRONTAB."
echo "Stand:     $(git -C "$APP/repo" log -1 --format='%h %s' 2>/dev/null || echo '(unbekannt)')"

# COMPOSE_FILE in der .env legt die Dateien fest — dann würde die
# Override-Datei still übergangen, und alles sähe eingerichtet aus, ohne es zu
# sein. (Dieselbe Prüfung wie in jev-und-docling.sh.)
grep -q '^COMPOSE_FILE=' "$ENVDATEI" && halt "In der .env steht COMPOSE_FILE — die Override-Datei würde übergangen."

cron_secret=$(env_wert CRON_SECRET)
[ -n "$cron_secret" ] || halt "In der .env steht kein CRON_SECRET — ohne das kann kalender.sh die Route nicht rufen."
# kalender.sh reicht es curl in Anführungszeichen; das hielte ein " oder \ nicht aus.
case "$cron_secret" in *[\"\\]*) halt "Das CRON_SECRET enthält \" oder \\ — das trägt kalender.sh nicht unbeschadet zu curl." ;; esac
unset cron_secret
echo ".env:      $(rechte "$ENVDATEI"), CRON_SECRET da"

app_cid=$(dc ps -q app < /dev/null 2>/dev/null | head -n 1)
[ -n "$app_cid" ] || halt "Der App-Container läuft nicht. Erst:  sudo ~/nas.sh stand"

# Läuft der neue Code? Ohne Anmeldung sagt die Route 401 — gibt es sie nicht,
# antwortet Next mit 404. Ein `hoch`, dessen Bau scheiterte, lässt den alten
# Container weiterlaufen, obwohl der Klon schon neu ist (README, „Was läuft,
# sagt nicht der Klon").
code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 "$INNEN/api/cron/kalender" 2>/dev/null || true)
case "$code" in
  401) echo "App:       neuer Stand läuft (/api/cron/kalender ohne Anmeldung → 401)" ;;
  404) halt "Die laufende App kennt /api/cron/kalender nicht (404) — der neue Code läuft noch nicht. Erst:  sudo ~/nas.sh hoch  (und auf „Fertig.“ achten)" ;;
  500) halt "/api/cron/kalender antwortet ohne Anmeldung mit 500 — dann fehlt CRON_SECRET im Container. Steht es in der docker-compose.yml bei der App?" ;;
  000|"") halt "Die App antwortet nicht auf $INNEN. Nachsehen:  sudo ~/nas.sh stand" ;;
  *) halt "/api/cron/kalender antwortet ohne Anmeldung mit HTTP $code — erwartet war 401." ;;
esac

eins=$(db_zahl "select 1") || halt "Die Datenbank antwortet nicht: $eins"
[ "$eins" = 1 ] || halt "Die Datenbank antwortet seltsam: $eins"
echo "Datenbank: antwortet"

DIENSTE_VORHER=$(dc config --services < /dev/null 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
[ -n "$DIENSTE_VORHER" ] || halt "Compose mag die vorhandenen Dateien schon jetzt nicht:  $(zum_abtippen "config -q")"
echo "Dienste:   $DIENSTE_VORHER"

if [ ! -e "$OVERRIDE" ]; then
  # Steht ein Jev-Schlüssel in der .env, waren Jev und Docling eingerichtet,
  # und ihre Datei ist weg — jev-und-docling.sh löscht sie selbst, wenn ein
  # erneuter Lauf am Bild oder am Formelmodell scheitert. Legte ich jetzt eine
  # an, trüge sie MEINE Marke, und jev-und-docling.sh weigerte sich danach für
  # immer, sie anzufassen.
  if [ -n "$(env_wert TYPESAFE_API_KEY)" ]; then
    halt "Es gibt keine $OVERRIDE, aber in der .env steht ein TYPESAFE_API_KEY — Jev und Docling waren also eingerichtet, und ihre Datei ist verschwunden (jev-und-docling.sh entfernt sie, wenn es bei einem erneuten Lauf scheitert). Erst Jev und Docling zurückholen:  sudo bash $APP/repo/scripts/jev-und-docling.sh  — dann dieses Skript noch einmal; es ergänzt die Datei dann nur. Lege ich sie jetzt an, trägt sie meine Marke, und jev-und-docling.sh fasst sie danach nicht mehr an. Sind Jev und Docling mit Absicht abgeschaltet: die Zeile TYPESAFE_API_KEY in der .env mit # auskommentieren (sudo vi $ENVDATEI), dann dieses Skript noch einmal."
  fi
  echo "Override:  keine — lege ich an (Jev und Docling sind hier nicht eingerichtet)"
elif grep -qF "# angelegt von scripts/jev-und-docling.sh" "$OVERRIDE"; then
  echo "Override:  da, von jev-und-docling.sh — ich ergänze nur"
else
  echo "Override:  da, von Hand — ich ergänze nur, und prüfe danach, dass nichts wegfiel"
fi
echo "Alles da."

# ================================================================ 1
schritt "1  Tabellen"

TABELLEN="table_schema = 'public' and table_name in ('google_calendar_connections', 'google_calendar_events')"
n=$(db_zahl "select count(*) from information_schema.tables where $TABELLEN") || halt "Konnte nicht nachsehen: $n"
case "$n" in
  2)
    echo "Beide Tabellen sind schon da — übersprungen."
    s_tabellen="waren schon da" ;;
  0)
    echo "Spiele $SQL ein — in einer Transaktion, Abbruch beim ersten Fehler ..."
    # `-f -` sagt ausdrücklich, was psql hier ohnehin täte: Ohne -c und -f und
    # mit umgeleiteter Eingabe (exec -T, kein Terminal) liest es stdin wie
    # `-f -`, und --single-transaction gilt für die ganze Datei (startup.c,
    # nachgesehen in REL_13 bis REL_18). Nur im Terminal, ohne Umleitung,
    # bricht psql mit „-1 can only be used in non-interactive mode“ ab —
    # dann ist nichts eingespielt. Halbe Tabellen entstehen so oder so nicht.
    psql_db --single-transaction -f - < "$SQL" || halt "Das Einspielen ging schief (Meldung oben). Weil es eine Transaktion war, ist dabei nichts liegengeblieben."
    merke_aenderung "Tabellen google_calendar_connections und google_calendar_events angelegt"
    n=$(db_zahl "select count(*) from information_schema.tables where $TABELLEN") || halt "Konnte nicht nachsehen: $n"
    [ "$n" = 2 ] || halt "Nach dem Einspielen sind $n der beiden Tabellen da."
    s_tabellen="neu angelegt" ;;
  *)
    halt "Nur $n der beiden Tabellen ist da. Das hinterlässt kein Lauf dieses Skripts (es spielt in einer Transaktion ein) — bitte ansehen:  $(zum_abtippen "exec db psql -U schulapp -d schulapp")  und darin  \\dt google_*" ;;
esac
# Nachsehen, statt es zu glauben: zwei Primärschlüssel, zwei Fremdschlüssel.
k=$(db_zahl "select count(*) from information_schema.table_constraints where $TABELLEN and constraint_type in ('PRIMARY KEY', 'FOREIGN KEY')") || halt "Konnte nicht nachsehen: $k"
[ "$k" = 4 ] || halt "Die Tabellen sind da, aber mit $k statt 4 Schlüsseln — so hat die SQL-Datei sie nicht angelegt."
echo "Geprüft:   2 Tabellen, 4 Schlüssel"

# ================================================================ 2
schritt "2  Werte in der .env"

id_jetzt=$(env_wert GOOGLE_CLIENT_ID)
secret_jetzt=$(env_wert GOOGLE_CLIENT_SECRET)
schluessel_jetzt=$(env_wert GOOGLE_TOKEN_KEY)

# Was steht und taugt, bleibt. Was steht und NICHT taugt, ersetzt das Skript
# nicht von selbst — das hat dann jemand eingetragen, und er soll es wissen.
frag_id=nein
frag_secret=nein
neu_schluessel=nein

if [ "$neue_zugangsdaten" = ja ]; then
  frag_id=ja; frag_secret=ja
else
  if [ -z "$id_jetzt" ]; then
    frag_id=ja
  elif client_id_ok "$id_jetzt"; then
    echo "GOOGLE_CLIENT_ID:     steht schon da ($(kurz_id "$id_jetzt")) — bleibt."
  else
    halt "In der .env steht eine GOOGLE_CLIENT_ID, die nicht auf .apps.googleusercontent.com endet. Ersetzen:  sudo bash $0 --neue-zugangsdaten"
  fi
  if [ -z "$secret_jetzt" ]; then
    frag_secret=ja
  elif secret_ok "$secret_jetzt"; then
    echo "GOOGLE_CLIENT_SECRET: steht schon da (verborgen) — bleibt."
  else
    halt "Das GOOGLE_CLIENT_SECRET in der .env sieht nicht aus wie eines (zu kurz, oder Zeichen, die in der .env Ärger machen). Ersetzen:  sudo bash $0 --neue-zugangsdaten"
  fi
fi

if [ "$neuer_schluessel" = ja ] || [ -z "$schluessel_jetzt" ]; then
  neu_schluessel=ja
elif schluessel_ok "$schluessel_jetzt"; then
  echo "GOOGLE_TOKEN_KEY:     steht schon da (verborgen) — bleibt. Ein neuer hieße neu verbinden."
else
  halt "Der GOOGLE_TOKEN_KEY in der .env ist kein 32-Byte-Schlüssel in base64 — so meldet ihn auch die App. Neu erzeugen:  sudo bash $0 --neuer-schluessel"
fi
unset secret_jetzt schluessel_jetzt

# Ist ein Kalender verbunden? Nur gefragt, wenn etwas geschrieben wird — die
# Tabellen gibt es seit Schritt 1 sicher.
verbunden=0
if [ "$frag_id" = ja ] || [ "$frag_secret" = ja ] || [ "$neu_schluessel" = ja ]; then
  verbunden=$(db_zahl "select count(*) from google_calendar_connections where refresh_token_enc is not null") \
    || halt "Konnte nicht nachsehen, ob ein Kalender verbunden ist: $verbunden"
fi

# Was ein Ersetzen bei bestehender Verbindung anrichtet, hängt davon ab, WAS
# ersetzt wird:
#   - ein anderer Schlüssel: Der Zugang lässt sich nicht mehr entschlüsseln.
#     Die App blockiert, schickt eine Push „Google Kalender getrennt“, der Cron
#     meldet 500; die Karte bietet „Neu verbinden“.
#   - eine andere Client-ID: Ein Zugang gilt nur für den Client, der ihn
#     ausgestellt hat. Google antwortet beim Erneuern unauthorized_client, die
#     App führt das als invalid_client — kein „blockiert“, sondern stündlich
#     ein Fehler. Die Karte bietet dann „Trennen“, danach „Mit Google verbinden“.
#   - ein neues Secret desselben Clients: Der Zugang gilt weiter.
# $neu_verbinden merkt sich, was bestätigt wurde, damit die Probe in Schritt 6
# den 500 erwartet, statt ihn als Störung zu melden.
neu_verbinden=nein
bestaetige() {
  local antwort=""
  eingabe_oeffnen
  frage "Trotzdem ersetzen? Dann „ja“ tippen, sonst Enter: "
  lies antwort
  [ "$antwort" = ja ] || halt "Nicht bestätigt — die .env bleibt, wie sie ist."
}

if [ "$verbunden" != 0 ] && [ "$neu_schluessel" = ja ]; then
  # Fehlt der Schlüssel, ohne dass jemand einen neuen wollte, ist er verloren
  # gegangen — der richtige Weg ist dann der alte Schlüssel, nicht ein neuer.
  [ "$neuer_schluessel" = ja ] || halt "In der .env fehlt GOOGLE_TOKEN_KEY, aber es ist ein Google Kalender verbunden — sein Zugang ist mit dem alten Schlüssel verschlossen. Den alten Schlüssel aus dem Passwortmanager wieder als GOOGLE_TOKEN_KEY=… in $ENVDATEI eintragen (mit einem Editor:  sudo vi $ENVDATEI), dann dieses Skript noch einmal. Ist er verloren:  sudo bash $0 --neuer-schluessel  — danach heißt es neu verbinden."
  echo "ACHTUNG: Es ist ein Google Kalender verbunden. Mit einem neuen Schlüssel lässt sich sein Zugang nicht"
  echo "         mehr entschlüsseln: Die Karte zeigt „blockiert“, das Handy bekommt eine Push „Google Kalender"
  echo "         getrennt“, und der stündliche Lauf meldet 500 — bis du in den Einstellungen „Neu verbinden“ drückst."
  bestaetige
  neu_verbinden=schluessel
fi

neue_id=""
neues_secret=""
neuer_key=""

if [ "$frag_id" = ja ]; then
  eingabe_oeffnen
  # Der Hinweis geht wie die Frage direkt ans Terminal — über tee käme er
  # womöglich erst nach ihr an.
  frage "Die Client-ID steht in der Google Cloud Console unter Clients, beim OAuth-Client vom Typ „Webanwendung“."$'\n'
  # Unsichtbar wie das Secret, obwohl sie keines ist: Google zeigt beide
  # untereinander, und wer die falsche Zeile erwischt, hätte das Secret sonst
  # im Klartext auf dem Bildschirm und im Verlauf des Terminals.
  frage "GOOGLE_CLIENT_ID einfügen, dann Enter. Sie bleibt unsichtbar: "
  lies_verdeckt neue_id
  neue_id=${neue_id//[[:space:]]/}
  [ -n "$neue_id" ] || halt "Keine Client-ID eingegeben."
  # Die Eingabe wird in keiner Meldung wiederholt: Wer hier versehentlich das
  # Secret einfügt, soll es nicht im Protokoll wiederfinden.
  case "$neue_id" in
    GOCSPX-*) halt "Das sieht nach dem Secret aus, nicht nach der Client-ID. Erst die ID (endet auf .apps.googleusercontent.com), danach fragt das Skript nach dem Secret." ;;
  esac
  client_id_ok "$neue_id" || halt "Das ist keine Client-ID: Sie endet auf .apps.googleusercontent.com, etwa 123456789012-abc….apps.googleusercontent.com."
  echo "Client-ID: $(kurz_id "$neue_id")"

  if [ "$verbunden" != 0 ] && [ "$neu_verbinden" = nein ]; then
    if [ "$neue_id" = "$id_jetzt" ]; then
      echo "           dieselbe wie bisher — die Verbindung bleibt gültig."
    else
      if [ -n "$id_jetzt" ]; then
        echo "ACHTUNG: Das ist eine andere Client-ID als bisher ($(kurz_id "$id_jetzt")), und es ist ein Kalender verbunden."
      else
        echo "ACHTUNG: Es ist ein Kalender verbunden, und mit welcher Client-ID, steht nicht mehr in der .env."
        echo "         Ist es dieselbe wie beim Verbinden, bleibt alles gültig. Sonst gilt:"
      fi
      echo "         Sein Zugang gilt nur für den alten Client. Die Karte meldet dann stündlich „Google lehnt die"
      echo "         Zugangsdaten der App ab (invalid_client)“ und der Lauf 500 — bis du in den Einstellungen"
      echo "         „Trennen“ und danach „Mit Google verbinden“ drückst."
      bestaetige
      neu_verbinden=client
    fi
  fi
fi

if [ "$frag_secret" = ja ]; then
  eingabe_oeffnen
  frage "GOOGLE_CLIENT_SECRET einfügen, dann Enter. Es bleibt unsichtbar: "
  lies_verdeckt neues_secret
  neues_secret=${neues_secret//[[:space:]]/}
  [ -n "$neues_secret" ] || halt "Kein Secret eingegeben."
  case "$neues_secret" in
    *.apps.googleusercontent.com) halt "Das ist die Client-ID, nicht das Secret." ;;
  esac
  secret_ok "$neues_secret" || halt "Das sieht nicht aus wie ein Secret — zu kurz, oder mit Zeichen, die in der .env Ärger machen."
  case "$neues_secret" in
    GOCSPX-*) echo "Secret:    angenommen (verborgen)" ;;
    *) echo "Secret:    angenommen (verborgen). Hinweis: Neue Secrets von Google beginnen mit GOCSPX-, dieses nicht." ;;
  esac
  if [ "$verbunden" != 0 ] && [ "$neu_verbinden" = nein ]; then
    echo "           Ein neues Secret desselben Clients lässt die Verbindung gelten."
  fi
fi

if [ "$neu_schluessel" = ja ]; then
  neuer_key=$(openssl rand -base64 32 2>/dev/null | tr -d '\n')
  woher=openssl
  if ! schluessel_ok "$neuer_key"; then
    neuer_key=$(head -c 32 /dev/urandom | base64 | tr -d '\n')
    woher=/dev/urandom
  fi
  schluessel_ok "$neuer_key" || halt "Konnte keinen Schlüssel erzeugen — weder mit openssl noch aus /dev/urandom."
  echo "Schlüssel: neu erzeugt mit $woher (verborgen)"
fi

zu_schreiben=""
[ "$frag_id" = ja ] && zu_schreiben="$zu_schreiben GOOGLE_CLIENT_ID"
[ "$frag_secret" = ja ] && zu_schreiben="$zu_schreiben GOOGLE_CLIENT_SECRET"
[ "$neu_schluessel" = ja ] && zu_schreiben="$zu_schreiben GOOGLE_TOKEN_KEY"

env_geaendert=nein
if [ -z "$zu_schreiben" ]; then
  s_env="alle drei waren schon da"
else
  rechte_vorher=$(rechte "$ENVDATEI")
  sicherung="$ENVDATEI.vor-kalender-$JETZT"
  cp -p "$ENVDATEI" "$sicherung" || halt "Konnte die .env nicht sichern."
  merke_sicherung "$sicherung   (die .env vor diesem Lauf)"
  echo "Sicherung: $sicherung"

  # Alte Zeilen derselben Namen weg — auch leere —, damit keine den neuen
  # Wert überdeckt; dann die neuen ans Ende. printf ist eingebaut: Die Werte
  # stehen in keiner Befehlszeile.
  kommentar_da=nein
  grep -qF "$ENV_KOMMENTAR" "$ENVDATEI" && kommentar_da=ja
  # Ab hier ist die .env angefasst — jeder Halt danach soll das sagen.
  merke_aenderung "In die .env geschrieben:$zu_schreiben"
  env_entferne "$zu_schreiben"
  # Mit if und nicht mit `[ … ] && printf`: Sonst wäre der Block gescheitert,
  # sobald die letzte Bedingung nicht zutrifft — obwohl alles geschrieben ist.
  if ! {
    if [ "$kommentar_da" = nein ]; then printf '\n%s\n' "$ENV_KOMMENTAR"; fi
    if [ "$frag_id" = ja ]; then printf 'GOOGLE_CLIENT_ID=%s\n' "$neue_id"; fi
    if [ "$frag_secret" = ja ]; then printf 'GOOGLE_CLIENT_SECRET=%s\n' "$neues_secret"; fi
    if [ "$neu_schluessel" = ja ]; then printf 'GOOGLE_TOKEN_KEY=%s\n' "$neuer_key"; fi
  } >> "$ENVDATEI"; then
    halt "Konnte nicht in die .env schreiben. Zurück:  sudo cp -p $sicherung $ENVDATEI"
  fi
  unset neues_secret neuer_key
  env_geaendert=ja

  # Nachsehen: jeder Name genau einmal, und brauchbar.
  for name in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_TOKEN_KEY; do
    zeilen=$(grep -c "^$name=" "$ENVDATEI")
    [ "$zeilen" = 1 ] || halt "$name steht nach dem Schreiben $zeilen-mal in der .env."
  done
  client_id_ok "$(env_wert GOOGLE_CLIENT_ID)" || halt "Nach dem Schreiben taugt die GOOGLE_CLIENT_ID in der .env nicht."
  secret_ok "$(env_wert GOOGLE_CLIENT_SECRET)" || halt "Nach dem Schreiben taugt das GOOGLE_CLIENT_SECRET in der .env nicht."
  schluessel_ok "$(env_wert GOOGLE_TOKEN_KEY)" || halt "Nach dem Schreiben taugt der GOOGLE_TOKEN_KEY in der .env nicht."
  rechte_nachher=$(rechte "$ENVDATEI")
  if [ "$rechte_nachher" = "$rechte_vorher" ]; then
    echo "Eingetragen:$zu_schreiben — Rechte wie vorher ($rechte_nachher)."
  else
    echo "Eingetragen:$zu_schreiben — ACHTUNG, Rechte vorher $rechte_vorher, jetzt $rechte_nachher."
  fi
  s_env="ergänzt:$zu_schreiben"
fi

# ================================================================ 3
schritt "3  Override-Datei und App"

# Gefragt ist alles. Reißt ab hier die Verbindung ab, läuft das Skript zu Ende,
# statt mittendrin stehenzubleiben — am schlimmsten wäre das während `up -d
# app`: der alte Container gestoppt, der neue nicht gestartet. Alles Weitere
# steht im Protokoll. Die Kinder (docker compose, curl) erben das Überhören.
trap '' HUP

# Sechs Zeilen, eingerückt wie die Einträge, die schon dort stehen. Die dritte
# ist für den, der die Datei sonst für die von Jev und Docling hält.
BLOCK=$(printf '%s\n' \
  "# Google Kalender — ergänzt von scripts/kalender-einrichten.sh. Die Werte" \
  "# stehen in der .env daneben; fehlt einer, ist die Funktion aus. Wer diese" \
  "# Datei löscht, schaltet auch den Kalender ab (README, Google Kalender)." \
  GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_TOKEN_KEY)
BLOCK_ZEILEN=$(printf '%s\n' "$BLOCK" | grep -c '')

override_geaendert=nein
override_sicherung=""
n=$(google_zeilen "$OVERRIDE")

if [ ! -e "$OVERRIDE" ]; then
  # Gibt es auf diesem NAS seit jev-und-docling.sh — dieser Zweig ist für den
  # Fall, dass jemand ohne Jev und Docling einrichtet (Schritt 0 hat
  # nachgesehen: kein TYPESAFE_API_KEY in der .env). Dann hält aber ein
  # späteres jev-und-docling.sh an (die Datei trägt nicht seine Marke) und
  # will die drei Zeilen von Hand in seine Fassung übernommen haben.
  {
    echo "$MARKE am $(date '+%d.%m.%Y %H:%M')"
    cat <<'YAML'
#
# Ergänzt die docker-compose.yml daneben; Compose lädt diese Datei von selbst
# dazu. Hier stehen nur die Namen — die Werte stehen in der .env. Wer diese
# Datei löscht, schaltet den Google Kalender ab.
services:
  app:
    environment:
      GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID:-}
      GOOGLE_CLIENT_SECRET: ${GOOGLE_CLIENT_SECRET:-}
      GOOGLE_TOKEN_KEY: ${GOOGLE_TOKEN_KEY:-}
YAML
  } > "$OVERRIDE"
  if ! pruefe_compose; then
    rm -f "$OVERRIDE"
    halt "Compose mag die neue Override-Datei nicht — wieder entfernt: $COMPOSE_FEHLER"
  fi
  override_geaendert=ja
  merke_aenderung "Override-Datei angelegt: $OVERRIDE"
  echo "Angelegt: $OVERRIDE"
  echo "Hinweis:  Sie trägt meine Marke. Ein späteres jev-und-docling.sh hält deshalb an („nicht von mir“);"
  echo "          wer Jev und Docling dazuhaben will, nimmt dessen Datei und trägt die drei GOOGLE_*-Zeilen"
  echo "          von Hand unter services → app → environment ein — oder löscht diese Datei, lässt"
  echo "          jev-und-docling.sh laufen und danach dieses Skript noch einmal."
  s_override="neu angelegt"
elif [ "$n" -ge 3 ]; then
  echo "Die drei GOOGLE_*-Namen stehen schon drin — übersprungen."
  s_override="stand schon drin"
elif [ "$n" -gt 0 ]; then
  halt "In $OVERRIDE stehen nur $n der drei GOOGLE_*-Namen — von Hand begonnen? Das ergänze ich nicht blind. Unter services → app → environment gehören:  GOOGLE_CLIENT_ID: \${GOOGLE_CLIENT_ID:-}  GOOGLE_CLIENT_SECRET: \${GOOGLE_CLIENT_SECRET:-}  GOOGLE_TOKEN_KEY: \${GOOGLE_TOKEN_KEY:-}"
else
  # Einfügen ans Ende von services → app → environment. Was dort steht (Jev,
  # Docling), bleibt Zeile für Zeile, wie es war; die Einrückung und die Form
  # (Liste oder Zuordnung) übernimmt der neue Block von den Einträgen davor.
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
    halt "In $OVERRIDE finde ich kein services → app → environment (mit zwei Leerzeichen eingerückt, wie jev-und-docling.sh es anlegt). Dann bitte von Hand darunter:  GOOGLE_CLIENT_ID: \${GOOGLE_CLIENT_ID:-}  GOOGLE_CLIENT_SECRET: \${GOOGLE_CLIENT_SECRET:-}  GOOGLE_TOKEN_KEY: \${GOOGLE_TOKEN_KEY:-}  — und das Skript noch einmal."
  fi

  # Nur hinzugefügt, nichts weggenommen: genau die Zeilen des Blocks neu,
  # keine fort.
  read -r minus plus <<EOF
$(weg_und_dazu "$OVERRIDE" "$ZWISCHEN")
EOF
  if [ "${minus:-x}" != 0 ] || [ "${plus:-x}" != "$BLOCK_ZEILEN" ]; then
    rm -f "$ZWISCHEN"; ZWISCHEN=""
    halt "Beim Einfügen wären ${minus:-?} Zeilen weggefallen und ${plus:-?} dazugekommen (erwartet: 0 und $BLOCK_ZEILEN). Nichts geschrieben."
  fi

  override_sicherung="$OVERRIDE.vor-kalender-$JETZT"
  cp -p "$OVERRIDE" "$override_sicherung" || halt "Konnte die Override-Datei nicht sichern."
  cat "$ZWISCHEN" > "$OVERRIDE" || halt "Konnte die Override-Datei nicht schreiben. Zurück:  sudo cp -p $override_sicherung $OVERRIDE"
  rm -f "$ZWISCHEN"; ZWISCHEN=""

  if ! pruefe_compose; then
    cat "$override_sicherung" > "$OVERRIDE"
    rm -f "$override_sicherung"
    halt "Compose mag die ergänzte Datei nicht — wieder zurückgesetzt: $COMPOSE_FEHLER"
  fi
  override_geaendert=ja
  merke_sicherung "$override_sicherung   (die Override-Datei vor diesem Lauf)"
  merke_aenderung "Drei GOOGLE_*-Namen in $OVERRIDE ergänzt"
  echo "Ergänzt:   $OVERRIDE ($BLOCK_ZEILEN Zeilen dazu, keine weg; Dienste unverändert: $DIENSTE_VORHER)"
  echo "Sicherung: $override_sicherung"
  s_override="ergänzt, nichts weggenommen"
fi

# Sieht die laufende App die Werte schon? Dann kein Neustart.
fehlen=$(pruefe_container)
rc=$?
if [ "$rc" -eq 0 ] && [ "$env_geaendert" = nein ] && [ "$override_geaendert" = nein ]; then
  echo "Die App sieht alle drei schon — kein Neustart nötig."
  s_app="lief schon mit den Werten"
else
  [ "$rc" -ne 0 ] && echo "Im Container fehlen noch: $fehlen"
  echo "Erzeuge die App neu — ohne Bau, bitte jetzt nicht mit Strg-C abbrechen ..."
  dc up -d app < /dev/null || halt "„up -d app“ ging schief (Meldung oben). Protokoll:  $(zum_abtippen "logs --tail=50 app")"
  merke_aenderung "App-Container neu erzeugt (ohne Bau)"
  if ! warte_auf_app; then
    rueck="Protokoll:  $(zum_abtippen "logs --tail=50 app")"
    [ -n "$override_sicherung" ] && rueck="$rueck — Zurück, falls es an der Override-Datei liegt:  sudo cp -p $override_sicherung $OVERRIDE  und  $(zum_abtippen "up -d app")"
    halt "Die App antwortet nach dem Neustart nicht. $rueck"
  fi
  fehlen=$(pruefe_container) || halt "Die Werte kommen im Container nicht an — es fehlt: $fehlen"
  s_app="neu erzeugt, ohne Bau"
fi
echo "Container: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_KEY da und brauchbar (Werte nicht gezeigt)."

# Kommt der Container zu Google durch? Eine absichtlich leere Anfrage — 400 ist
# die richtige Antwort (README, „Reihenfolge auf dem NAS", Schritt 4). Nur ein
# Hinweis, kein Halt: eingerichtet ist trotzdem alles.
google=$(dc exec -T app node -e "fetch('https://oauth2.googleapis.com/token', { method: 'POST', signal: AbortSignal.timeout(20000) }).then((r) => console.log(r.status), (f) => { console.log('kein Durchkommen: ' + ((f.cause && f.cause.code) || f.name)); process.exit(1); })" < /dev/null 2>&1 | tail -n 1)
case "$google" in
  400) echo "Google:    erreichbar aus dem Container (400 auf eine leere Anfrage — so soll es sein)"
       s_google="erreichbar" ;;
  *)   echo "ACHTUNG:   Google aus dem Container: $google — das Verbinden scheitert, bis das geht."
       echo "           (Das NAS hat kein IPv6 ins Internet; und die FritzBox verschluckt gern Namen — siehe README.)"
       s_google="NICHT erreichbar: $google" ;;
esac

# ================================================================ 4
schritt "4  kalender.sh"

ZWISCHEN=$(mktemp "$APP/.kalender.neu.XXXXXX") || halt "Konnte keine Zwischendatei anlegen."
kalender_sh_inhalt > "$ZWISCHEN"
if [ ! -e "$KALENDER_SH" ]; then
  if ! { cat "$ZWISCHEN" > "$KALENDER_SH" && chmod 755 "$KALENDER_SH"; }; then
    halt "Konnte $KALENDER_SH nicht anlegen."
  fi
  merke_aenderung "Angelegt: $KALENDER_SH"
  echo "Angelegt:  $KALENDER_SH"
  s_skript="neu angelegt"
elif gleicher_inhalt "$ZWISCHEN" "$KALENDER_SH"; then
  echo "Steht schon da, in dieser Fassung — übersprungen."
  s_skript="war schon da"
elif grep -qF "$MARKE" "$KALENDER_SH"; then
  sicherung="$KALENDER_SH.vor-$JETZT"
  cp -p "$KALENDER_SH" "$sicherung" || halt "Konnte $KALENDER_SH nicht sichern."
  cat "$ZWISCHEN" > "$KALENDER_SH" || halt "Konnte $KALENDER_SH nicht schreiben. Zurück:  sudo cp -p $sicherung $KALENDER_SH"
  merke_sicherung "$sicherung   (die alte Fassung von kalender.sh)"
  merke_aenderung "Erneuert: $KALENDER_SH"
  echo "Erneuert:  $KALENDER_SH (alte Fassung: $sicherung)"
  s_skript="erneuert"
else
  echo "ACHTUNG: Es gibt schon eine $KALENDER_SH, nicht von mir — wohl von Hand nach dem README."
  echo "         Ich lasse sie stehen; die Probe unten zeigt, ob sie taugt."
  echo "         Meine Fassung statt ihrer:  sudo rm $KALENDER_SH  und das Skript noch einmal."
  s_skript="fremde Fassung, unverändert gelassen"
fi
rm -f "$ZWISCHEN"; ZWISCHEN=""
[ -x "$KALENDER_SH" ] || { chmod 755 "$KALENDER_SH" && echo "Ausführbar gemacht."; }

# ================================================================ 5
schritt "5  Crontab"

crontab_geaendert=nein
vorhanden=$(aktive_zeilen "$KALENDER_SH")
if [ -n "$vorhanden" ]; then
  echo "Steht schon drin — übersprungen:"
  printf '  %s\n' "$vorhanden"
  case "$vorhanden" in
    "$CRONZEILE") ;;
    *) echo "  (anders als meine Zeile „$(printf '%s' "$CRONZEILE" | tr '\t' ' ')“ — ich lasse sie, wie sie ist)" ;;
  esac
  s_crontab="Zeile war schon da"
else
  if grep -qF "$KALENDER_SH" "$CRONTAB"; then
    echo "Hinweis: Eine auskommentierte Zeile mit kalender.sh steht schon drin; ich ergänze eine aktive."
  fi
  sicherung="$CRONTAB.vor-kalender-$JETZT"
  cp -p "$CRONTAB" "$sicherung" || halt "Konnte $CRONTAB nicht sichern."
  merke_sicherung "$sicherung   (die Crontab vor diesem Lauf)"
  # Angehängt, nicht neu geschrieben: Datei, Rechte und alle anderen Zeilen
  # bleiben, wie DSM sie hat.
  [ -s "$CRONTAB" ] && [ -n "$(tail -c 1 "$CRONTAB")" ] && printf '\n' >> "$CRONTAB"
  printf '%s\n' "$CRONZEILE" >> "$CRONTAB" || halt "Konnte nicht in $CRONTAB schreiben."
  crontab_geaendert=ja
  merke_aenderung "Zeile in $CRONTAB ergänzt"
  zahl=$(aktive_zeilen "$KALENDER_SH" | grep -c .)
  [ "$zahl" = 1 ] || halt "Nach dem Ergänzen steht kalender.sh $zahl-mal aktiv in $CRONTAB."
  echo "Ergänzt:   $(printf '%s' "$CRONZEILE" | tr '\t' ' ')"
  echo "Sicherung: $sicherung"
  s_crontab="Zeile ergänzt"
fi

# Die Sicherung erneuern, wie das README es verlangt — aber nur, wenn noch
# keine Sicherung genau diesen Stand hat. So legt ein zweiter Lauf keine an.
gesichert=""
for f in "$CRONTAB".sicherung-*; do
  gleicher_inhalt "$CRONTAB" "$f" && { gesichert=$f; break; }
done
if [ -n "$gesichert" ]; then
  echo "Sicherung des jetzigen Stands liegt schon: $gesichert"
  stand_sicherung=$gesichert
else
  ziel="$CRONTAB.sicherung-$HEUTE"
  [ -e "$ziel" ] && ziel="$CRONTAB.sicherung-$JETZT"
  cp -p "$CRONTAB" "$ziel" || halt "Konnte $CRONTAB nicht nach $ziel sichern."
  merke_sicherung "$ziel   (die Crontab NACH diesem Lauf — für den Fall, dass DSM sie neu schreibt)"
  echo "Gesichert: $ziel — mit allen Schulapp-Zeilen; DSM kann die Datei beim Bearbeiten von Aufgaben neu schreiben."
  stand_sicherung=$ziel
fi

# Die beiden anderen Zeilen müssen auch noch da sein. DSM verliert sie
# womöglich lautlos — wenn, dann soll es hier stehen. Was jetzt aktiv ist,
# wird nach dem Neustart von crond noch einmal gesucht.
nach_neustart_pruefen=("$KALENDER_SH")
for anderes in erinnerungen.sh wiki-uebergabe.sh; do
  if [ -z "$(aktive_zeilen "$APP/$anderes")" ]; then
    echo "ACHTUNG: $anderes steht nicht (mehr) aktiv in $CRONTAB — hat DSM die Datei neu geschrieben?"
    echo "         Eine ältere Sicherung mit der Zeile:  ls -l $CRONTAB.sicherung-*"
  else
    nach_neustart_pruefen+=("$APP/$anderes")
  fi
done

# Ob ein Neustart von crond auf DSM 7 die Datei aus der Datenbank des
# Aufgabenplaners neu schreibt, ist nicht belegt — die Datei trägt dessen
# Zeilen (synoschedtask --run id=…). Täte er es, wären danach alle
# Schulapp-Zeilen weg, und nichts mehr liefe, auch keine Störungsnotiz. Also
# nachsehen, statt es zu glauben: Ist die Datei nach dem Neustart noch die von
# davor? Wenn nicht, und fehlt eine Zeile, kommt der Stand von davor zurück —
# crond wird dann NICHT noch einmal neu gestartet, sonst schriebe er womöglich
# gleich wieder um —, und das Skript hält an.
crontab_nach_neustart_pruefen() {
  local wie=$1 fassung weg="" p
  sleep 2
  if gleicher_inhalt "$CRONTAB" "$stand_sicherung"; then
    echo "Crontab:   nach dem Neustart unverändert (verglichen mit $stand_sicherung)."
    return 0
  fi
  fassung="$CRONTAB.nach-crond-$JETZT"
  cp -p "$CRONTAB" "$fassung" 2>/dev/null && merke_sicherung "$fassung   (die Crontab, wie sie nach dem Neustart von crond aussah)"
  for p in "${nach_neustart_pruefen[@]}"; do
    [ -n "$(aktive_zeilen "$p" 2>/dev/null)" ] || weg="$weg ${p##*/}"
  done
  if [ -z "$weg" ]; then
    echo "ACHTUNG: Der Neustart von crond ($wie) hat $CRONTAB verändert; die Schulapp-Zeilen stehen aber alle noch."
    echo "         Vorher: $stand_sicherung   nachher: $fassung"
    s_crond="$s_crond — Datei danach verändert, Zeilen noch da"
    return 0
  fi
  cat "$stand_sicherung" > "$CRONTAB" \
    || halt "Der Neustart von crond ($wie) hat $CRONTAB neu geschrieben, danach fehlten:$weg — und das Zurücklegen ging schief. Von Hand:  sudo cp -p $stand_sicherung $CRONTAB"
  merke_aenderung "$CRONTAB aus $stand_sicherung zurückgelegt (der Neustart von crond hatte sie neu geschrieben)"
  halt "Der Neustart von crond ($wie) hat $CRONTAB neu geschrieben; danach fehlten:$weg. Ich habe den Stand von davor zurückgelegt (aus $stand_sicherung) und crond nicht noch einmal neu gestartet. Ob er die zurückgelegte Datei liest, zeigt sich um :05 in $APP/erinnerungen.log und um :15 in $APP/kalender.log. Bis das geklärt ist, keine Aufgabe im DSM-Aufgabenplaner bearbeiten, und nach jedem Neustart des NAS nachsehen:  grep schulapp $CRONTAB"
}

if [ "$crontab_geaendert" = ja ]; then
  if ! warte_auf_cron_laeufe; then
    echo "ACHTUNG: crond lade ich deshalb nicht neu. Ob er die geänderte Datei auch so einliest, weiß ich nicht sicher."
    echo "         Bei der nächsten Viertel nach sieh nach:  sudo tail -n 3 $APP/kalender.log"
    echo "         Steht dort keine neue Zeile, und arbeitet gerade nichts mehr:  sudo synosystemctl restart crond"
    s_crond="NICHT neu geladen (ein Lauf arbeitete noch) — bei :15 im kalender.log nachsehen"
  elif wie=$(crond_neu_laden); then
    echo "crond neu geladen ($wie)."
    s_crond="neu geladen ($wie)"
    crontab_nach_neustart_pruefen "$wie"
  else
    echo "ACHTUNG: crond konnte ich nicht neu laden — weder synosystemctl noch systemctl noch synoservice taten es."
    echo "         Ob crond auf DSM 7 die geänderte Datei auch so neu einliest, weiß ich nicht sicher."
    echo "         Bei der nächsten Viertel nach sieh nach:  sudo tail -n 3 $APP/kalender.log"
    echo "         Steht dort keine neue Zeile:  sudo synosystemctl restart crond"
    s_crond="NICHT neu geladen — bei :15 im kalender.log nachsehen"
  fi
else
  echo "Crontab unverändert — crond bleibt, wie er ist."
  s_crond="unverändert"
fi

# ================================================================ 6
schritt "6  Probe: kalender.sh einmal von Hand"

probe=$(bash "$KALENDER_SH" < /dev/null 2>&1)
probe_rc=$?
echo "$probe"
http=$(printf '%s\n' "$probe" | sed -n 's/.* http=\([0-9][0-9][0-9]\) .*/\1/p' | tail -n 1)

probe_ok=nein
# Was im Browser noch zu tun ist: verbinden, neu-verbinden, trennen-verbinden
# oder keiner.
handgriff=verbinden
# Nach einem bestätigten Ersetzen (Schritt 2) ist ein 500 die richtige
# Antwort — aber nur der, den das Ersetzen erklärt: beim Schlüssel „blockiert“,
# bei der Client-ID invalid_client. Jeder andere 500 bleibt eine Störung.
erwartet=nein
if [ "$probe_rc" -ne 0 ] && [ "$http" = 500 ]; then
  # "blockiert":0 steht in jeder Antwort; gemeint ist eine blockierte Verbindung.
  case "$neu_verbinden:$probe" in
    schluessel:*'"blockiert":'[1-9]*) erwartet=ja; handgriff=neu-verbinden ;;
    client:*invalid_client*)          erwartet=ja; handgriff=trennen-verbinden ;;
  esac
fi

if [ "$probe_rc" -eq 0 ]; then
  case "$probe" in
    *'"reason":"nicht-eingerichtet"'*)
      halt "Die Route sagt, die Funktion sei aus (Antwort oben, unter „missing“). Dann sieht die laufende App die Variablen anders, als Schritt 3 sie gesehen hat." ;;
    *'"verbunden":0'*)
      echo "Sauber: HTTP 200, eingerichtet, noch kein Kalender verbunden — so soll es vor dem Verbinden aussehen."
      s_probe="HTTP 200, eingerichtet, noch nicht verbunden" ;;
    *)
      echo "HTTP ${http:-200} — es ist schon ein Kalender verbunden, und der Abgleich lief durch."
      s_probe="HTTP ${http:-200}, verbunden, Abgleich durch"
      handgriff=keiner ;;
  esac
  probe_ok=ja
elif [ "$erwartet" = ja ]; then
  echo "Erwartet: HTTP 500 — der alte Zugang gilt nach dem Ersetzen nicht mehr (Satz oben). Eingerichtet ist alles."
  if [ "$neu_verbinden" = schluessel ]; then
    echo "Die Push „Google Kalender getrennt“ auf dem Handy und die Störungsnotiz von kalender.sh gehören dazu;"
  else
    echo "Die Störungsnotiz von kalender.sh gehört dazu;"
  fi
  echo "bis zum Neu-Verbinden meldet jeder stündliche Lauf 500. Notiz: $NOTIZ"
  s_probe="HTTP 500 wie erwartet nach dem Ersetzen — jetzt neu verbinden"
  probe_ok=ja
else
  case "$http" in
    500) echo "Die Route antwortet 500 — der Satz steht oben. Eingerichtet ist alles; das ist eine Frage an"
         echo "die Route oder den Betrieb, nicht an dieses Skript. Mehr:  $(zum_abtippen "logs --tail=100 app") | grep Google-Kalender" ;;
    401) echo "Die Route sagt 401: Das CRON_SECRET in der .env ist nicht das, mit dem die App läuft." ;;
    000|"") echo "Die App antwortet nicht. Nachsehen:  sudo ~/nas.sh stand" ;;
    *)   echo "Unerwartet: HTTP $http." ;;
  esac
  echo "kalender.sh hat dazu eine Störungsnotiz in den Vault gelegt, sofern heute noch keine kam: $NOTIZ"
  s_probe="FEHLER (exit $probe_rc, HTTP ${http:-?})"
fi

# ================================================================ fertig
schritt "Fertig"
echo "Tabellen:    $s_tabellen"
echo ".env:        $s_env"
echo "Override:    $s_override"
echo "App:         $s_app"
echo "Google:      $s_google"
echo "kalender.sh: $s_skript"
echo "Crontab:     $s_crontab"
echo "crond:       $s_crond"
echo "Probe:       $s_probe"
echo
if [ -n "$SICHERUNGEN" ]; then
  echo "Sicherungen dieses Laufs:"
  printf '%s' "$SICHERUNGEN"
else
  echo "Sicherungen: keine — dieser Lauf hat nichts geändert."
fi
echo

if [ "$probe_ok" != ja ]; then
  echo "NOCH NICHT BEREIT — siehe Probe oben. Schick mir die Ausgabe; sie steht auch in $LOG."
  exit 1
fi

if [ "$handgriff" = keiner ]; then
  echo "Im Browser ist nichts mehr zu tun: Der Kalender ist verbunden, und der Abgleich läuft."
else
  echo "Jetzt du — der eine Handgriff, den kein Skript tun kann:"
  echo "  1. Tailscale an, am Handy oder am Rechner."
  echo "  2. Im BROWSER öffnen — Safari oder Chrome, NICHT die installierte App vom Home-Bildschirm:"
  echo "       $ADRESSE/einstellungen"
  case "$handgriff" in
    neu-verbinden)     echo "  3. Karte „Google Kalender“ → „Neu verbinden“." ;;
    trennen-verbinden) echo "  3. Karte „Google Kalender“ → „Trennen“, danach „Mit Google verbinden“." ;;
    *)                 echo "  3. Karte „Google Kalender“ → „Mit Google verbinden“." ;;
  esac
  echo "  4. Google warnt „Google hat diese App nicht überprüft“ → „Erweitert“ → „Weiter zu …“."
  echo "  5. Zustimmen, und den Haken beim Kalender setzen."
  echo "  Danach zeigt die Karte „verbunden“, und in Google steht der Kalender „Schule“."
  echo "  Sagt Google „redirect_uri_mismatch“: README, „Google Cloud einrichten“, Schritt 4."
fi
echo
echo "Ob der stündliche Lauf greift, steht ab der nächsten Viertel nach in:"
echo "  sudo tail -n 3 $APP/kalender.log"
if [ "$neu_schluessel" = ja ]; then
  echo "Den neuen GOOGLE_TOKEN_KEY in den Passwortmanager — Verlust heißt neu verbinden:"
  echo "  sudo grep ^GOOGLE_TOKEN_KEY= $ENVDATEI"
fi
echo
echo "Rückweg, falls nötig:"
echo "  Cron:      die Zeile mit kalender.sh aus $CRONTAB löschen (Sicherung oben)"
if grep -qF "# angelegt von scripts/jev-und-docling.sh" "$OVERRIDE" 2>/dev/null; then
  echo "  App:       NUR die GOOGLE_*-Zeilen samt Kommentar aus $OVERRIDE löschen — nicht die"
  echo "             Datei, darin stehen auch Jev und Docling. Dann  $(zum_abtippen "up -d app")"
  echo "             Umgekehrt gilt dasselbe: Der Rückweg von jev-und-docling.sh (die Datei löschen) und ein"
  echo "             erneuter Lauf, der dort scheitert, schalten den Kalender mit ab. Danach dieses Skript noch"
  echo "             einmal — es sagt, in welcher Reihenfolge es weitergeht."
else
  echo "  App:       die GOOGLE_*-Zeilen samt Kommentar aus $OVERRIDE löschen, dann  $(zum_abtippen "up -d app")"
fi
echo "  Tabellen:  bleiben liegen — ohne Variablen fasst die App sie nicht an."
