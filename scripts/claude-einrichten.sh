#!/bin/bash
# shellcheck disable=SC1111  # „…“ sind deutsche Anführungszeichen, mit Absicht
#
# Den Claude-Leser auf dem NAS einrichten und den Postboten ablösen — in einem
# Lauf.
#
# Seit dem 11.10.2026 ruft die App Opus selbst (src/lib/claude/client.ts) und
# schreibt Handschrift ab, die Docling nicht sicher liest. Dafür braucht sie
# ANTHROPIC_API_KEY in ihrer Umgebung, und das kostet echtes Geld: jeder Lauf
# geht auf die Rechnung dieses Schlüssels. Bis dahin las der Postbote, ein
# eigener Container unter /volume1/docker/postbote, mit dem Abo. Beide dürfen
# NIE gleichzeitig lesen — dann lägen zwei Vorschläge am selben Blatt, und
# eines wäre doppelt bezahlt.
#
# Läuft AUF DEM NAS, mit root, und erst NACH einem `hoch` mit dem neuen Stand:
#
#   sudo ~/nas.sh hoch
#   sudo bash /volume1/docker/schulapp/repo/scripts/claude-einrichten.sh
#
# Davor: ~/nas.sh durch die Fassung aus dem neuen Stand ersetzen (README,
# „Auf das NAS bringen“). Die alte kennt die Tabelle leser_laeufe nicht und
# fragt nicht, ob danach zwei läsen. Der Postbote selbst darf bis zu diesem
# Skript weiterlaufen: Ohne Schlüssel liest die neue App keine Handschrift,
# also liest bis Schritt 4 nur er — und ab Schritt 5 nur noch die App.
#
# Abgelöst heißt stillgelegt, nicht gelöscht (Entscheidung des Nutzers vom
# 11.10.2026: „für den Fall der Fälle“). Sein Code bleibt im Repo unter
# harness/, sein Ordner hier auf dem NAS, umbenannt; wie er im Notfall
# wiederkommt, steht im README unter „Der Postbote — stillgelegt, und der
# Rückweg im Notfall“ und am Ende dieses Laufs —
# immer erst, nachdem die App den Schlüssel NICHT mehr hat.
#
# Was es tut, in dieser Reihenfolge, und warum gerade so:
#
#   0. Nachsehen, ohne etwas zu ändern: root, Werkzeuge, Pfade, läuft die App
#      mit dem neuen Code, steht die Tabelle leser_laeufe (ohne sie scheitert
#      jeder Lauf), gibt es die Override-Datei, läuft der Postbote. Und: wie
#      viele Blätter der Leser beim ersten Anstoß liest — bezahlt. Sind es
#      Korbblätter ohne Vorschlag, FRAGT es, ob sie als „vor dem Wechsel
#      gesehen“ vermerkt werden sollen (Vorgabe: ja; geschrieben wird erst in
#      Schritt 4b). Ohne Terminal hält es an, statt still durchzulaufen.
#   1. Den Schlüssel unsichtbar abfragen (oder den aus der .env nehmen) und
#      PRÜFEN, bevor irgendetwas umgestellt ist — aus dem App-Container,
#      kostenlos (scripts/nas-probe-claude.mjs). Ein falscher Schlüssel hält
#      hier an, und der Postbote liest weiter, als wäre nichts gewesen.
#   2. Den Schlüssel in die .env — gesichert vorher, nie ausgegeben.
#   3. Die Namen ANTHROPIC_API_KEY und CLAUDE_BILD in die
#      docker-compose.override.yml, unter services → app → environment. NUR
#      ERGÄNZEN: Die Datei gehört drei anderen Skripten (jev-und-docling.sh,
#      kalender-einrichten.sh, iserv-einrichten.sh) und hält Jev, Docling,
#      Kalender und IServ. Nachgeprüft wird, dass nichts wegfiel und Compose
#      sie noch mag. CLAUDE_BILD steht leer da: Vorgabe ist die gemessene
#      Lesefassung; umgestellt wird erst nach der Abnahme-Messung
#      (scripts/abschrift-messen.mts), dann mit einer Zeile in der .env.
#   4. Den Postboten stilllegen: `docker compose down` in seinem Ordner, dann
#      den Ordner umbenennen in postbote.stillgelegt-<Datum> — nicht löschen.
#      Umbenannt scheitert jedes `cd` eines alten Skripts sauber, statt ihn
#      wieder zu starten; und wer auf einen Stand vor dem Umbau zurück muss,
#      holt ihn mit einem `mv` wieder (unten, „Rückweg“).
#  4b. Bei „ja“ in Schritt 0: je Korbblatt eine Zeile in leser_laeufe
#      (einordnen, kein-vorschlag, „vor dem Wechsel gesehen“, unter seinem
#      jetzigen Stand, mit allen ungelesenen Claude-Seiten als abgeschrieben)
#      — damit liest der Leser sie nicht von selbst, auch nicht nach dem
#      Abhaken; am Blatt bleibt der Knopf. Der Postbote hatte sie in gesehen.json, und die
#      wandert nicht mit (Abnahme vom 11.10.2026: ein Blatt, dessen Vorschlag
#      der Mensch verworfen hatte, wäre sonst noch einmal bezahlt gelesen und
#      womöglich von Jev eingeordnet worden).
#   5. ERST DANACH die App neu erzeugen — ohne Bau — und aus dem Container
#      nachsehen: Kommt der Schlüssel an (verglichen wird nur eine Prüfsumme)?
#      Meldet die App „Claude-Leser bereit“? Nimmt die API ihn an?
#
# Ein zweiter Lauf ist harmlos: Was schon erledigt ist, wird übersprungen, und
# er sagt, was er überspringt. Mit --neuer-schluessel ersetzt er den Schlüssel.
#
# Der Schlüssel steht nie im Protokoll, nie auf dem Bildschirm, in keiner
# Befehlszeile und in keiner Zwischendatei: Er wird unsichtbar gelesen, mit
# printf (eingebaut) in die .env und über eine Pipe in die Probe geschrieben
# und sonst nur als Prüfsumme verglichen. Erlaubt sind nur Zeichen, die ein
# API-Schlüssel hat (A–Z, a–z, 0–9, - und _) — so bleibt die .env für
# erinnerungen.sh, das sie per „.“ einliest, ohne Anführungszeichen sicher.
#
# Alles, was hier steht, landet auch in $APP/claude-einrichten.log.
#
# Für die Probe an einem nachgebauten NAS lassen sich die Pfade verschieben
# (nur dann gilt auch die Pflicht zu root nicht):
#
#   CLAUDE_EINRICHTEN_WURZEL    wird vor alle festen Pfade gesetzt (Standard: leer)
#   CLAUDE_EINRICHTEN_APP, CLAUDE_EINRICHTEN_POST    einzeln
#   CLAUDE_EINRICHTEN_DOCKER    welches docker
#   CLAUDE_EINRICHTEN_EINGABE   woher die Antworten kommen (Standard: /dev/tty)
#
set -u
umask 022

ADRESSE=https://treskownas.tail3a40b0.ts.net
WURZEL=${CLAUDE_EINRICHTEN_WURZEL:-}
APP=${CLAUDE_EINRICHTEN_APP:-$WURZEL/volume1/docker/schulapp}
POST=${CLAUDE_EINRICHTEN_POST:-$WURZEL/volume1/docker/postbote}
EINGABE=${CLAUDE_EINRICHTEN_EINGABE:-/dev/tty}

ENVDATEI="$APP/.env"
OVERRIDE="$APP/docker-compose.override.yml"
PROBE="$APP/repo/scripts/nas-probe-claude.mjs"
LOG="$APP/claude-einrichten.log"
# Nur ASCII: Die .env lesen Compose, die Shell (erinnerungen.sh per `.`) und awk.
ENV_KOMMENTAR="# Claude-Leser (scripts/claude-einrichten.sh). Jeder Lauf kostet Geld - Ausgabelimit in der Console setzen."
NAMEN="ANTHROPIC_API_KEY CLAUDE_BILD"
INNEN=http://127.0.0.1:3000
JETZT=$(date +%Y%m%d-%H%M%S)
HEUTE=$(date +%Y%m%d)

hilfe() {
  echo "Den Claude-Leser auf dem NAS einrichten und den Postboten ablösen (nach nas.sh hoch)."
  echo
  echo "  sudo bash $0                     einrichten; Vorhandenes bleibt"
  echo "  sudo bash $0 --neuer-schluessel  den Schlüssel ersetzen (neu abfragen, prüfen, eintragen)"
}

neuer_schluessel=nein
for arg in "$@"; do
  case "$arg" in
    --neuer-schluessel) neuer_schluessel=ja ;;
    -h|--hilfe|--help)  hilfe; exit 0 ;;
    *) echo "Unbekannt: $arg" >&2; echo >&2; hilfe >&2; exit 1 ;;
  esac
done

if [ -z "$WURZEL" ] && [ "$(id -u)" != 0 ]; then
  echo "Bitte mit sudo starten:  sudo bash $0" >&2
  exit 1
fi
[ -d "$APP" ] || { echo "FEHLER: Kein $APP. Läuft das hier wirklich auf dem NAS?" >&2; exit 1; }

# ---------------------------------------------------------------- Werkzeuge
# Alle, bevor irgendetwas geändert wird: fehlte eines erst mitten im Lauf,
# stünde der Postbote schon still und die App noch ohne Schlüssel.
fehlt_werkzeug=""
for w in awk sed grep tail head cut tr sort seq sleep tee mktemp curl date ls cp cat rm wc mv; do
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
# Wie in nas.sh: sudo nimmt /usr/local/bin aus dem Suchpfad, und genau dort
# liegt docker auf dem NAS.
DOCKER=${CLAUDE_EINRICHTEN_DOCKER:-}
if [ -z "$DOCKER" ]; then
  for d in /usr/local/bin/docker /usr/bin/docker /bin/docker; do
    [ -x "$d" ] && { DOCKER="$d"; break; }
  done
  [ -z "$DOCKER" ] && DOCKER=$(command -v docker 2>/dev/null)
fi
[ -n "$DOCKER" ] || { echo "FEHLER: docker nicht gefunden." >&2; exit 1; }
"$DOCKER" compose version >/dev/null 2>&1 || { echo "FEHLER: \"docker compose\" fehlt." >&2; exit 1; }

dc() { ( cd "$APP" && "$DOCKER" compose "$@" ); }
# Zum Abtippen: weder `cd` in den Ordner (er gehört root) noch `sudo docker`
# (sudo kennt /usr/local/bin nicht) geht auf dem NAS — deshalb diese Form.
zum_abtippen() { echo "sudo sh -c 'cd ${2:-$APP} && $DOCKER compose $1'"; }

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
# Die Eingabe liest von $EINGABE und erscheint deshalb weder hier noch im
# Protokoll. tee überhört Strg-C und das Auflegen (wie in iserv-einrichten.sh):
# stürbe es mit, gingen die letzten Zeilen — „Bis hierher geändert“ — nirgends
# mehr hin.
exec > >(trap '' INT HUP; exec tee -a "$LOG") 2>&1
echo
echo "##### $(date '+%d.%m.%Y %H:%M:%S') — claude-einrichten.sh $*"

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
RUECKWEG=""
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
    [ -n "$RUECKWEG" ] && { echo "Rückweg:" >&2; printf '%s' "$RUECKWEG" >&2; }
  else
    echo "Geändert ist noch nichts." >&2
  fi
  echo "Schick mir die Ausgabe — sie steht auch in $LOG. (Der Schlüssel steht nicht darin.)" >&2
  exit 1
}

trap 'halt "Abgebrochen (Strg-C oder kill)."' INT TERM
trap 'halt "Die Verbindung ist abgerissen (SIGHUP)."' HUP

# ---------------------------------------------------------------- .env
# Der Wert, der gilt: die letzte Zeile des Namens, ohne Wagenrücklauf, Leerraum
# und Anführungszeichen außen herum. Wer den Schlüssel so liest, gibt ihn nie aus.
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

# Wie viele Zeilen der ersten Datei fehlen in der zweiten, und wie viele kamen
# dazu? Für „nur ergänzt“: erwartet sind 0 und die Zahl der eingefügten.
weg_und_dazu() {
  awk '
    NR == FNR { alt[++n] = $0; next }
    { if (i < n && $0 == alt[i + 1]) i++; else dazu++ }
    END { print n - i, dazu + 0 }
  ' "$1" "$2"
}

# Werte aus der .env in einer Meldung von Compose durch *** ersetzen — eine
# Fehlermeldung darf den Schlüssel nicht ins Protokoll tragen.
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

# Sieht aus wie ein API-Schlüssel — und nur wie einer? Ein Admin-Schlüssel
# könnte die Organisation verwalten und gehört nicht in eine App; ein
# Anmelde-Token des Abos (sk-ant-oat…) ist kein API-Schlüssel, die API wiese
# ihn als x-api-key ab.
schluessel_art() {
  case "$1" in
    sk-ant-admin*) echo admin ;;
    sk-ant-oat*)   echo abo ;;
    sk-ant-*)
      case "${1#sk-ant-}" in
        ''|*[!A-Za-z0-9_-]*) echo zeichen ;;
        *) [ "${#1}" -ge 40 ] && echo ok || echo kurz ;;
      esac ;;
    *) echo fremd ;;
  esac
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
lies_verdeckt() {
  IFS= read -rs "$1" <&3 || true
  if [ -t 3 ]; then printf '\n' > "$EINGABE"; fi
}
lies_sichtbar() {
  IFS= read -r "$1" <&3 || true
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

# Die Prüfsumme des Schlüssels, wie die App ihn sieht — nur die Summe verlässt
# den Container. Leer, wenn er dort fehlt.
container_pruefsumme() {
  dc exec -T app node -e 'const k = (process.env.ANTHROPIC_API_KEY || "").trim(); if (k) process.stdout.write(require("crypto").createHash("sha256").update(k, "utf8").digest("hex"))' < /dev/null 2>/dev/null
}

# Die Probe aus dem Container. Mit „vorab“ kommt der Schlüssel über die
# Standardeingabe herein und der Text der Probe als Argument — so steht er in
# keiner Befehlszeile; ohne „vorab“ liest die Probe ihn aus der Umgebung der App.
probe_vorab() {
  local text
  text=$(cat "$PROBE") || return 1
  printf '%s' "$1" | dc exec -T app node --input-type=module -e "$text" -- --schluessel-auf-stdin
}
probe_aus_umgebung() {
  dc exec -T app node --input-type=module - < "$PROBE"
}

# Der Satz zu einem Rückgabewert der Probe (scripts/nas-probe-claude.mjs).
probe_satz() {
  case "$1" in
    2) echo "Die Probe bekam keinen Schlüssel." ;;
    3) echo "Die API weist den Schlüssel ab — falsch eingefügt, widerrufen, oder ohne Rechte. Neu:  sudo bash $0 --neuer-schluessel" ;;
    4) echo "Das Modell ist für diesen Schlüssel nicht verfügbar — in der Console nachsehen, ob der Workspace Opus 5.5 darf." ;;
    5) echo "Die API weist die Form der Anfrage ab. So endete jedes Blatt als „nichts“ — und wäre gemerkt. Das ist ein Fall für mich, nicht für einen neuen Schlüssel." ;;
    *) echo "Die API ist aus dem Container nicht zu erreichen, oder sie antwortet seltsam (Meldung oben). Später noch einmal." ;;
  esac
}

COMPOSE_FEHLER=""
pruefe_compose() {
  local cfg n dienste
  if ! cfg=$(dc config 2>&1 < /dev/null); then
    COMPOSE_FEHLER=$(printf '%s\n' "$cfg" | schwaerzen | head -n 5)
    return 1
  fi
  n=$(printf '%s\n' "$cfg" | grep -cE '^[[:space:]]+(-[[:space:]]*)?(ANTHROPIC_API_KEY|CLAUDE_BILD)[[:space:]]*[:=]')
  if [ "$n" -lt 2 ]; then
    COMPOSE_FEHLER="Compose sieht nur $n der zwei Namen — wird die Override-Datei überhaupt geladen?"
    return 1
  fi
  dienste=$(dc config --services < /dev/null 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
  if [ "$dienste" != "$DIENSTE_VORHER" ]; then
    COMPOSE_FEHLER="Die Dienste haben sich verändert — vorher: $DIENSTE_VORHER, jetzt: $dienste"
    return 1
  fi
  return 0
}

# Steht dieser Name in der Override-Datei unter einem environment?
im_override() {
  grep -qE "^[[:space:]]+(-[[:space:]]*)?$1[[:space:]]*[:=]" "$OVERRIDE" 2>/dev/null
}

# Die Namen, die die anderen drei Skripte eingetragen haben — nach dem
# Ergänzen müssen sie alle noch da sein.
fremde_zeilen() {
  grep -cE '^[[:space:]]+(-[[:space:]]*)?(TYPESAFE_API_KEY|DOCLING_URL|GOOGLE_[A-Z_]+|ISERV_[A-Z_]+|LESER_REGEL)[[:space:]]*[:=]' "$OVERRIDE" 2>/dev/null
}

# Laufende Container eines Dienstes namens postbote — gleich aus welchem
# Ordner. Gefragt wird Docker: `ps` auf dem Synology sieht Container-Prozesse
# nicht, ein Blick dorthin hielte einen laufenden Postboten für tot.
postbote_container() {
  "$DOCKER" ps -q --filter "label=com.docker.compose.service=postbote" 2>/dev/null
}

# Die Override-Datei mit dem Block darin, nach stdout — ans Ende von
# services → app → environment, mit dem Einzug und der Schreibweise (Liste
# oder Zuordnung), die dort schon steht. Dasselbe Einfügen wie in
# iserv-einrichten.sh. Rückgabe 3: kein solcher Abschnitt.
override_ergaenzen() {
  KE_BLOCK="$1" awk '
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
  ' "$OVERRIDE"
}

# ================================================================ 0
schritt "0  Nachsehen (ändert nichts)"

[ -f "$APP/docker-compose.yml" ] || halt "Keine $APP/docker-compose.yml."
[ -f "$ENVDATEI" ] || halt "Keine $ENVDATEI."
[ -f "$PROBE" ] || halt "Keine $PROBE — der Klon ist älter als der Claude-Leser. Ist der Stand committet und nach main gepusht? Dann erst:  sudo ~/nas.sh hoch  (und auf „Fertig.“ achten)"
echo "Stand:     $(git -C "$APP/repo" log -1 --format='%h %s' 2>/dev/null || echo '(unbekannt)')"

grep -q '^COMPOSE_FILE=' "$ENVDATEI" && halt "In der .env steht COMPOSE_FILE — die Override-Datei würde übergangen."

# Ohne Override-Datei fehlen Jev und Docling — jev-und-docling.sh legt sie an,
# und es weigert sich danach, eine fremde anzufassen. Legte dieses Skript sie
# an, käme Jev nie wieder zurück.
if [ ! -f "$OVERRIDE" ]; then
  halt "Keine $OVERRIDE. Die legt jev-und-docling.sh an, die beiden anderen Skripte ergänzen sie; ist sie verschwunden, erst:  sudo bash $APP/repo/scripts/jev-und-docling.sh  — dann kalender-einrichten.sh und iserv-einrichten.sh, dann dieses Skript."
fi

app_cid=$(dc ps -q app < /dev/null 2>/dev/null | head -n 1)
[ -n "$app_cid" ] || halt "Der App-Container läuft nicht. Erst:  sudo ~/nas.sh stand"

# Läuft der neue Code? Der Bau trägt den Tabellennamen in den Server-Chunks;
# ein `hoch`, dessen Bau scheiterte, lässt den alten Container weiterlaufen —
# und der kennt ANTHROPIC_API_KEY nicht: eingerichtet sähe alles aus, und
# gelesen würde nichts.
if dc exec -T app sh -c 'grep -rlq leser_laeufe /app/.next/server' < /dev/null >/dev/null 2>&1; then
  echo "App:       neuer Stand läuft (der Claude-Leser ist im Bau)"
else
  halt "Die laufende App kennt den Claude-Leser noch nicht — der neue Code läuft nicht. Erst:  sudo ~/nas.sh hoch  (und auf „Fertig.“ achten)"
fi

n=$(db_zahl "select count(*) from information_schema.tables where table_schema = current_schema() and table_name = 'leser_laeufe'") \
  || halt "Die Datenbank antwortet nicht: $n"
[ "$n" = 1 ] || halt "Der Datenbank fehlt die Tabelle leser_laeufe — ohne sie scheitert jeder Lauf, und nichts verhindert, dass ein Blatt zweimal bezahlt gelesen wird. Einspielen steht im Kopf von $APP/repo/scripts/leser-laeufe-tabelle.sql (nas.sh hoch hält davor eigentlich an)."
echo "Datenbank: leser_laeufe ist da"

# Steht unter services → app → environment schon etwas, an das sich anfügen
# lässt? Sonst hielte Schritt 3 an — mit dem Schlüssel schon in der .env.
override_fehlt=""
for name in $NAMEN; do
  im_override "$name" || override_fehlt="$override_fehlt $name"
done
if [ -n "$override_fehlt" ] && ! override_ergaenzen "# Probe" > /dev/null; then
  halt "In $OVERRIDE finde ich kein services → app → environment. Dann bitte von Hand darunter je  NAME: \${NAME:-}  für$override_fehlt  — und das Skript noch einmal."
fi

DIENSTE_VORHER=$(dc config --services < /dev/null 2>/dev/null | sort | tr '\n' ' ' | sed 's/ $//')
[ -n "$DIENSTE_VORHER" ] || halt "Compose mag die vorhandenen Dateien schon jetzt nicht:  $(zum_abtippen "config -q")"
echo "Dienste:   $DIENSTE_VORHER"

# Der Postbote: sein Ordner, ein schon stillgelegter, und was gerade läuft.
stillgelegt=$(ls -d "$POST".stillgelegt-* 2>/dev/null | tail -n 1)
laufend=$(postbote_container | tr '\n' ' ' | sed 's/ $//')
if [ -d "$POST" ]; then
  if [ -n "$laufend" ]; then
    echo "Postbote:  Ordner $POST ist da, er läuft ($laufend) — bis Schritt 4 liest weiter er"
  else
    echo "Postbote:  Ordner $POST ist da, er läuft nicht"
  fi
elif [ -n "$stillgelegt" ]; then
  echo "Postbote:  schon stillgelegt ($stillgelegt)${laufend:+ — ABER es läuft einer: $laufend}"
else
  echo "Postbote:  keiner auf diesem NAS${laufend:+ — ABER es läuft einer: $laufend}"
fi
# Einer, der nicht aus $POST läuft, hält Schritt 4 nicht an — dann gar nicht
# erst anfangen, statt mit halb umgestellter .env stehen zu bleiben.
if [ -n "$laufend" ] && [ ! -d "$POST" ]; then
  halt "Es läuft ein Postbote-Container ($laufend), aber nicht aus $POST — den hält dieses Skript nicht an. Erst:  sudo $DOCKER stop $laufend  — dann dieses Skript noch einmal."
fi

# Was der Leser beim ersten Anstoß liest — bezahlt. Gezählt wie im Kopf von
# scripts/leser-laeufe-tabelle.sql: Korbblätter ohne Vorschlag mit einer
# ungelesenen Seite, die die App Claude zugeteilt hat, und ohne gemerkten Lauf
# unter ihrem jetzigen Stand. Seiten ohne Leser (die Altblätter) liest er im
# Korb nie von selbst, nur auf Knopfdruck, und sie stehen deshalb nicht dabei.
#
# Der Stand (`schluessel`) in GENAU der Schreibweise von listPageActivity() in
# src/lib/materials.ts — dieselbe Zeichenkette ist der Schlüssel des
# Gedächtnisses; eine andere wäre ein neuer Fall.
#
# `seiten` sind die ungelesenen Seiten, die Claude lesen könnte (leser
# 'claude' oder NULL) — sie kommen in 4b nach `abgeschrieben`. Ohne sie galt
# der Vermerk nur, solange das Blatt im Korb lag: abgehakt, las die Nachlese
# alle Seiten noch einmal, bezahlt, und übernahm die Abschrift ohne einen
# Menschen — auch an einem Blatt, dessen Vorschlag der Mensch vor dem Wechsel
# verworfen hatte (Nachprüfung vom 11.10.2026). Was davon der Postbote nur
# nicht lesen konnte, lässt sich nicht mehr sagen: gesehen.json kennt nur
# Schlüssel, keine Ergebnisse. „Gesehen“ heißt deshalb hier ganz gesehen; am
# Blatt bleibt der Knopf.
KORB_VOR_DEM_WECHSEL=$(cat <<'SQL'
select m.user_id, m.id,
       to_char(max(p.created_at) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as schluessel,
       coalesce(jsonb_agg(p.id::text order by p.sort_order, p.created_at, p.id)
                  filter (where p.transcript is null and (p.leser = 'claude' or p.leser is null)), '[]'::jsonb) as seiten
  from materials m join material_pages p on p.material_id = m.id
 where m.filed_at is null
   and not exists (select 1 from material_proposals v where v.material_id = m.id)
 group by m.id, m.user_id
having count(*) filter (where p.transcript is null and p.leser = 'claude') > 0
SQL
)
korb=$(db_zahl "select count(*) from ($KORB_VOR_DEM_WECHSEL) k where not exists (select 1 from leser_laeufe l where l.material_id = k.id and l.schluessel = k.schluessel and l.ergebnis in ('vorschlag', 'kein-vorschlag', 'nichts'))") || korb="?"
nach=$(db_zahl "select count(*) from material_pages p join materials m on m.id = p.material_id where m.filed_at is not null and p.transcript is null and p.leser = 'claude'") || nach="?"
echo "Zu lesen:  Korbblätter ohne Vorschlag: $korb; nachgereichte Claude-Seiten an eingeordneten Blättern: $nach"
echo "           (das liest der Leser beim ersten Anstoß — jedes Blatt ein bezahlter Aufruf)"

schluessel_da=nein
[ -n "$(env_wert ANTHROPIC_API_KEY)" ] && schluessel_da=ja
echo "Schlüssel: $([ "$schluessel_da" = ja ] && echo "steht schon in der .env (verborgen)" || echo "noch keiner")"
liest_schon=nein
[ -n "$(container_pruefsumme)" ] && liest_schon=ja
if [ "$schluessel_da" = ja ] && [ -n "$laufend" ] && [ "$liest_schon" = ja ]; then
  echo "ACHTUNG:   Die App hat schon einen Schlüssel, UND ein Postbote läuft — gerade lesen beide. Schritt 4 hält ihn an."
fi

# Die Korbblätter von vor dem Wechsel: der Postbote hat sie gesehen — mit
# „nichts“ abgeschlossen, oder ihr Vorschlag wurde verworfen —, und sein
# Gedächtnis (gesehen.json) wandert nicht mit. Ohne Vermerk liest der neue
# Leser jedes davon beim ersten Anstoß noch einmal, bezahlt, und Jev ordnet
# womöglich ein Blatt ein, dessen Vorschlag ein Mensch abgelehnt hatte.
# Gefragt wird nur vor dem ERSTEN Start mit Schlüssel: liest die App schon,
# ist der Moment vorbei. Geschrieben wird erst in Schritt 4b, wenn der
# Postbote steht — gefragt hier, damit nach der Antwort nichts mehr fragt.
vermerken=nein
if [ "$liest_schon" = ja ]; then
  echo "Vor dem Wechsel: die App liest schon mit einem Schlüssel — nichts mehr zu vermerken."
elif [ "$korb" = "?" ]; then
  halt "Konnte die Korbblätter nicht zählen — die Datenbank antwortet nicht. Geändert ist noch nichts."
elif [ "$korb" != 0 ]; then
  eingabe_oeffnen
  echo
  echo "$korb Korbblätter ohne Vorschlag haben ungelesene Claude-Seiten. Der Postbote hat sie wohl"
  echo "schon gesehen (mit „nichts“ abgeschlossen, oder ihr Vorschlag wurde verworfen)."
  echo "Als „vor dem Wechsel gesehen“ vermerken? Dann liest der neue Leser sie NICHT von selbst —"
  echo "auch nicht, wenn sie danach abgehakt werden —, und am Blatt bleibt „Abschreiben lassen“."
  echo "Nein: er liest jedes einmal, bezahlt."
  frage "Vermerken? [J/n] "
  antwort=""
  lies_sichtbar antwort
  case "$antwort" in
    ""|j|J|ja|Ja|JA|y|Y) vermerken=ja; echo "→ werden in Schritt 4b vermerkt." ;;
    n|N|nein|Nein|NEIN) echo "→ werden nicht vermerkt; der Leser liest sie beim ersten Anstoß." ;;
    *) halt "Antwort „$antwort“ verstehe ich nicht (j oder n). Geändert ist noch nichts." ;;
  esac
fi
echo "Alles da."

# ================================================================ 1
schritt "1  Schlüssel prüfen (ändert nichts)"

schluessel=""
if [ "$schluessel_da" = nein ] || [ "$neuer_schluessel" = ja ]; then
  eingabe_oeffnen
  frage "Anthropic-API-Schlüssel (sk-ant-…) einfügen, dann Enter. Er bleibt unsichtbar: "
  lies_verdeckt schluessel
  # Beim Einfügen kommen gern ein Leerzeichen oder ein Wagenrücklauf mit.
  schluessel=$(printf '%s' "$schluessel" | tr -d '[:space:]')
  [ -n "$schluessel" ] || halt "Kein Schlüssel eingegeben."
  neu=ja
else
  schluessel=$(env_wert ANTHROPIC_API_KEY)
  echo "Nehme den Schlüssel aus der .env. Ersetzen:  sudo bash $0 --neuer-schluessel"
  neu=nein
fi

case "$(schluessel_art "$schluessel")" in
  ok) ;;
  admin) unset schluessel; halt "Das ist ein Admin-Schlüssel (sk-ant-admin…). Er kann die ganze Organisation verwalten und gehört nicht in eine App. Bitte in der Console einen gewöhnlichen API-Schlüssel anlegen, mit Ausgabelimit." ;;
  abo)   unset schluessel; halt "Das ist ein Anmelde-Token des Abos (sk-ant-oat…), kein API-Schlüssel — die API nimmt es so nicht an." ;;
  *)     unset schluessel
         if [ "$neu" = ja ]; then
           halt "Das sieht nicht aus wie ein API-Schlüssel (sk-ant-…, nur Buchstaben, Ziffern, - und _). Beim Einfügen etwas abgeschnitten oder angehängt?"
         else
           halt "Der Schlüssel in der .env sieht nicht aus wie ein API-Schlüssel (sk-ant-…, nur Buchstaben, Ziffern, - und _, ohne Anführungszeichen). Neu:  sudo bash $0 --neuer-schluessel"
         fi ;;
esac

echo "Frage die API aus dem App-Container — kostenlos, und bevor irgendetwas umgestellt ist ..."
probe_vorab "$schluessel" < /dev/null
rc=$?
if [ "$rc" -ne 0 ]; then
  unset schluessel
  halt "$(probe_satz "$rc")"
fi

summe_soll=$(printf '%s' "$schluessel" | pruefsumme)

# ================================================================ 2
schritt "2  Schlüssel in der .env"

# Ab hier läuft es zu Ende, auch wenn die Verbindung abreißt: halb umgestellt —
# Postbote aus, App ohne Schlüssel — wäre schlimmer als fertig.
trap '' HUP

if [ "$neu" = nein ]; then
  echo "Steht schon drin — bleibt."
  s_env="stand schon drin"
  unset schluessel
else
  rechte_vorher=$(rechte "$ENVDATEI")
  sicherung="$ENVDATEI.vor-claude-$JETZT"
  cp -p "$ENVDATEI" "$sicherung" || halt "Konnte die .env nicht sichern."
  if [ "$neuer_schluessel" = ja ]; then
    merke_sicherung "$sicherung   (die .env vor diesem Lauf — mit dem alten Schlüssel)"
  else
    merke_sicherung "$sicherung   (die .env vor diesem Lauf)"
  fi
  echo "Sicherung: $sicherung"

  kommentar_da=nein
  grep -qF "$ENV_KOMMENTAR" "$ENVDATEI" && kommentar_da=ja
  merke_aenderung "ANTHROPIC_API_KEY in die .env geschrieben"
  env_entferne ANTHROPIC_API_KEY
  # printf ist eingebaut: Der Wert steht in keiner Befehlszeile.
  if ! {
    if [ "$kommentar_da" = nein ]; then printf '\n%s\n' "$ENV_KOMMENTAR"; fi
    printf 'ANTHROPIC_API_KEY=%s\n' "$schluessel"
  } >> "$ENVDATEI"; then
    halt "Konnte nicht in die .env schreiben. Zurück:  sudo cp -p $sicherung $ENVDATEI"
  fi
  RUECKWEG="$RUECKWEG  .env:      sudo cp -p $sicherung $ENVDATEI"$'\n'

  zeilen=$(grep -c '^ANTHROPIC_API_KEY=' "$ENVDATEI")
  [ "$zeilen" = 1 ] || halt "ANTHROPIC_API_KEY steht nach dem Schreiben $zeilen-mal in der .env."

  # So liest erinnerungen.sh die Datei: per „.“. Liest die Shell den Schlüssel
  # genau so zurück? Verglichen in einer Subshell, ohne Ausgabe.
  # shellcheck disable=SC1090
  if ( set -e; . "$ENVDATEI" >/dev/null 2>&1; [ "${ANTHROPIC_API_KEY-}" = "$schluessel" ] ); then
    echo "Zurückgelesen: Die Shell liest den Schlüssel aus der .env genau so, wie er eingegeben wurde."
  else
    halt "Die Shell liest den Schlüssel aus der .env anders zurück (oder die .env lässt sich nicht per „.“ lesen). Zurück:  sudo cp -p $sicherung $ENVDATEI"
  fi
  unset schluessel

  rechte_nachher=$(rechte "$ENVDATEI")
  if [ "$rechte_nachher" = "$rechte_vorher" ]; then
    echo "Eingetragen — Rechte wie vorher ($rechte_nachher)."
  else
    echo "Eingetragen — ACHTUNG, Rechte vorher $rechte_vorher, jetzt $rechte_nachher."
  fi
  s_env="eingetragen"
fi

# Lesbar für andere als root? Dann liest jeder Account auf dem NAS den Schlüssel.
case "$(rechte "$ENVDATEI" | cut -d' ' -f1)" in
  -???r*|-??????r*) echo "ACHTUNG: Die .env ist für Gruppe oder andere lesbar — darin steht ein Schlüssel, der Geld ausgeben kann. Enger:  sudo chmod 600 $ENVDATEI" ;;
esac

# ================================================================ 3
schritt "3  Override-Datei"

fehlen=""
for name in $NAMEN; do
  im_override "$name" || fehlen="$fehlen $name"
done
fehlen=${fehlen# }

override_geaendert=nein
override_sicherung=""
if [ -z "$fehlen" ]; then
  echo "Beide Namen stehen schon drin — übersprungen."
  s_override="stand schon drin"
else
  # shellcheck disable=SC2086  # $fehlen sind Namen ohne Leerraum, eine Zeile je Name
  BLOCK=$(printf '%s\n' \
    "# Claude-Leser — ergänzt von scripts/claude-einrichten.sh. Der Schlüssel steht" \
    "# in der .env daneben; fehlt er, liest niemand Handschrift. CLAUDE_BILD leer" \
    "# heißt Lesefassung (gemessen); voll erst nach der Abnahme-Messung." \
    $fehlen)
  BLOCK_ZEILEN=$(printf '%s\n' "$BLOCK" | grep -c '')
  fremd_vorher=$(fremde_zeilen)

  ZWISCHEN=$(mktemp "$APP/.override.neu.XXXXXX") || halt "Konnte keine Zwischendatei anlegen."
  override_ergaenzen "$BLOCK" > "$ZWISCHEN"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    rm -f "$ZWISCHEN"; ZWISCHEN=""
    halt "In $OVERRIDE finde ich kein services → app → environment. Dann bitte von Hand darunter je  NAME: \${NAME:-}  für $fehlen  — und das Skript noch einmal."
  fi

  read -r minus plus <<EOF
$(weg_und_dazu "$OVERRIDE" "$ZWISCHEN")
EOF
  if [ "${minus:-x}" != 0 ] || [ "${plus:-x}" != "$BLOCK_ZEILEN" ]; then
    rm -f "$ZWISCHEN"; ZWISCHEN=""
    halt "Beim Einfügen wären ${minus:-?} Zeilen weggefallen und ${plus:-?} dazugekommen (erwartet: 0 und $BLOCK_ZEILEN). Nichts geschrieben."
  fi

  override_sicherung="$OVERRIDE.vor-claude-$JETZT"
  cp -p "$OVERRIDE" "$override_sicherung" || halt "Konnte die Override-Datei nicht sichern."
  cat "$ZWISCHEN" > "$OVERRIDE" || halt "Konnte die Override-Datei nicht schreiben. Zurück:  sudo cp -p $override_sicherung $OVERRIDE"
  rm -f "$ZWISCHEN"; ZWISCHEN=""

  if ! pruefe_compose; then
    cat "$override_sicherung" > "$OVERRIDE"
    rm -f "$override_sicherung"
    halt "Compose mag die ergänzte Datei nicht — wieder zurückgesetzt: $COMPOSE_FEHLER"
  fi
  [ "$(fremde_zeilen)" = "$fremd_vorher" ] \
    || halt "Nach dem Ergänzen stehen andere Namen von Jev, Docling, Kalender oder IServ in $OVERRIDE als vorher. Zurück:  sudo cp -p $override_sicherung $OVERRIDE"
  override_geaendert=ja
  merke_sicherung "$override_sicherung   (die Override-Datei vor diesem Lauf)"
  merke_aenderung "$fehlen in $OVERRIDE ergänzt"
  RUECKWEG="$RUECKWEG  Override:  sudo cp -p $override_sicherung $OVERRIDE"$'\n'
  echo "Ergänzt:   $OVERRIDE ($BLOCK_ZEILEN Zeilen dazu, keine weg; Dienste unverändert: $DIENSTE_VORHER)"
  s_override="ergänzt, nichts weggenommen"
fi

# ================================================================ 4
schritt "4  Postbote stilllegen"

# VOR dem Neustart der App: Ab Schritt 5 liest sie selbst, und bis dahin muss
# der Postbote aus sein. Ein Blatt, das er beim Anhalten gerade las, liest
# danach die App — einmal, denn sein halber Lauf hat nichts angelegt.
if [ -d "$POST" ]; then
  compose_datei=""
  for f in "$POST"/docker-compose.yml "$POST"/docker-compose.yaml "$POST"/compose.yml "$POST"/compose.yaml; do
    [ -f "$f" ] && { compose_datei=$f; break; }
  done
  if [ -n "$compose_datei" ]; then
    echo "Halte ihn an (docker compose down in $POST) ..."
    ( cd "$POST" && "$DOCKER" compose down ) < /dev/null \
      || halt "Er ließ sich nicht anhalten (Meldung oben). Die App hat den Schlüssel noch nicht — es liest weiter nur er. Von Hand:  $(zum_abtippen down "$POST")  und dieses Skript noch einmal."
    merke_aenderung "Postbote angehalten (docker compose down in $POST)"
  else
    echo "In $POST liegt keine Compose-Datei — nichts anzuhalten."
  fi

  ziel="$POST.stillgelegt-$HEUTE"
  [ -e "$ziel" ] && ziel="$POST.stillgelegt-$JETZT"
  mv "$POST" "$ziel" || halt "Konnte $POST nicht umbenennen. Er ist angehalten; umbenennen von Hand:  sudo mv $POST $ziel"
  merke_aenderung "Ordner umbenannt: $POST → $ziel"
  RUECKWEG="$RUECKWEG  Postbote:  erst ANTHROPIC_API_KEY aus .env und Override nehmen und $(zum_abtippen "up -d app"), dann"$'\n'"             sudo mv $ziel $POST  und  sudo rm -f $POST/harness/lauf.lock  und  $(zum_abtippen "up -d" "$POST")"$'\n'
  stillgelegt=$ziel
  echo "Stillgelegt: $ziel  (nicht gelöscht — zugang.json, gesehen.json und die Anmeldung liegen darin)"
  s_postbote="angehalten und umbenannt: $ziel"
elif [ -n "$stillgelegt" ]; then
  echo "Schon stillgelegt ($stillgelegt) — übersprungen."
  s_postbote="war schon stillgelegt"
else
  echo "Kein Postbote auf diesem NAS — übersprungen."
  s_postbote="gab es hier nicht"
fi

# Läuft trotzdem einer — aus einem anderen Ordner, unter anderem Namen?
laufend=$(postbote_container | tr '\n' ' ' | sed 's/ $//')
if [ -n "$laufend" ]; then
  halt "Es läuft noch ein Postbote-Container ($laufend), nicht aus $POST. Die App bekommt den Schlüssel erst, wenn er aus ist:  sudo $DOCKER stop $laufend  — dann dieses Skript noch einmal (es setzt fort, wo es war)."
fi
echo "Auf diesem NAS läuft kein Postbote mehr."
echo "Läuft irgendwo sonst einer — Laptop, Raspberry Pi —, jetzt anhalten: Ab dem nächsten Schritt liest die App selbst."

# ================================================================ 4b
schritt "4b  Korbblätter von vor dem Wechsel vermerken"

# VOR dem ersten Start mit Schlüssel: danach stößt register() den Leser an,
# und er nähme sie sofort. Eine Zeile je Blatt, wie sie der Leser selbst
# schriebe (src/lib/leser/laeufe.ts) — art einordnen, ergebnis
# kein-vorschlag, unter dem jetzigen Stand, und in `abgeschrieben` jede
# ungelesene Seite für Claude: so erledigt sie den Stand auch für die
# Nachlese, wenn das Blatt danach abgehakt wird (gedaechtnisAus() in
# src/lib/leser/claude-ablauf.ts). `on conflict do nothing`: ein Blatt, das
# schon ein Ergebnis unter diesem Stand hat, bleibt, wie es ist.
#
# Korbblätter MIT Vorschlag (einer des Postboten, der beim Wechsel noch
# liegt) brauchen hier keine Zeile: verwirft ein Mensch ihn später, schreibt
# die App selbst die Spur (verworfenVermerken() in src/lib/leser/laeufe.ts).
if [ "$vermerken" = ja ]; then
  vermerkt=$(psql_db -tAc "with neu as (insert into leser_laeufe (user_id, material_id, art, schluessel, ergebnis, grund, abgeschrieben) select user_id, id, 'einordnen', schluessel, 'kein-vorschlag', 'vor dem Wechsel gesehen', seiten from ($KORB_VOR_DEM_WECHSEL) k on conflict do nothing returning 1) select count(*) from neu" < /dev/null 2>&1) \
    || halt "Konnte die Korbblätter nicht vermerken: $(printf '%s' "$vermerkt" | head -n 3)"
  vermerkt=$(printf '%s' "$vermerkt" | tr -d '[:space:]')
  merke_aenderung "$vermerkt Korbblätter in leser_laeufe als „vor dem Wechsel gesehen“ vermerkt"
  RUECKWEG="$RUECKWEG  Vermerke:  in psql  delete from leser_laeufe where grund = 'vor dem Wechsel gesehen';  (danach liest der Leser diese Blätter, bezahlt)"$'\n'
  echo "Vermerkt: $vermerkt Korbblätter („vor dem Wechsel gesehen“). Lesen lassen geht am Blatt mit „Abschreiben lassen“."
  s_vermerkt="$vermerkt Korbblätter"
else
  echo "Nichts zu vermerken."
  s_vermerkt="nichts"
fi

# ================================================================ 5
schritt "5  App neu erzeugen und prüfen"

summe_ist=$(container_pruefsumme)
if [ "$summe_ist" = "$summe_soll" ] && [ "$override_geaendert" = nein ]; then
  echo "Die App sieht den Schlüssel schon — kein Neustart nötig."
  s_app="lief schon mit dem Schlüssel"
else
  echo "Erzeuge die App neu — ohne Bau, bitte jetzt nicht mit Strg-C abbrechen ..."
  dc up -d app < /dev/null || halt "„up -d app“ ging schief (Meldung oben). Gerade liest niemand Handschrift. Protokoll:  $(zum_abtippen "logs --tail=50 app")"
  merke_aenderung "App-Container neu erzeugt (ohne Bau)"
  warte_auf_app || halt "Die App antwortet nach dem Neustart nicht. Protokoll:  $(zum_abtippen "logs --tail=50 app")"
  summe_ist=$(container_pruefsumme)
  s_app="neu erzeugt, ohne Bau"
fi

if [ -z "$summe_ist" ]; then
  halt "Der Schlüssel kommt im Container nicht an. Steht ANTHROPIC_API_KEY unter services → app → environment (und nicht unter einem anderen Dienst)?"
elif [ "$summe_ist" != "$summe_soll" ]; then
  halt "Die App sieht einen anderen Schlüssel als die .env. Steht ANTHROPIC_API_KEY irgendwo doppelt (docker-compose.yml)?"
fi
echo "Schlüssel im Container: stimmt (verglichen über die Prüfsumme)."

# Die Zeile, die die App beim Start einmal schreibt (claudeZustandMelden in
# src/lib/leser/claude-leser.ts). Nur diese eine, ohne Steuerzeichen: im
# Protokoll steht sonst auch, was Blätter enthalten.
zustand=$(dc logs --tail=400 app < /dev/null 2>&1 | grep -aE 'Claude-Leser (bereit|aus)' | tail -n 1 | LC_ALL=C tr -d '\000-\010\013-\037\177' | cut -c1-200)
echo "Protokoll: ${zustand:-(noch keine Zeile „Claude-Leser …“)}"
case "$zustand" in
  *"Claude-Leser aus"*) halt "Die App meldet den Leser als aus, obwohl der Schlüssel im Container steht. Protokoll:  $(zum_abtippen "logs --tail=100 app")" ;;
esac

probe_aus_umgebung < /dev/null
rc=$?
[ "$rc" -eq 0 ] || halt "Die Probe mit dem Schlüssel aus der Umgebung der App: $(probe_satz "$rc")"
s_probe="angenommen"

# ================================================================ fertig
schritt "Fertig"
echo ".env:      $s_env"
echo "Override:  $s_override"
echo "Postbote:  $s_postbote"
echo "Vermerkt:  $s_vermerkt"
echo "App:       $s_app"
echo "Probe:     $s_probe"
echo
if [ -n "$SICHERUNGEN" ]; then
  echo "Sicherungen dieses Laufs:"
  printf '%s' "$SICHERUNGEN"
  echo "Die .env-Sicherung trägt womöglich einen alten Schlüssel — nach erfolgreichem Lauf löschen."
  echo
fi
echo "Jetzt ein Blatt mit Handschrift hochladen und zusehen — es muss GENAU EIN Lauf erscheinen:"
echo "  $(zum_abtippen "logs -f --tail=20 app") | grep -E 'Claude|Leser'"
echo "Was ein Lauf gekostet hat, steht am Blatt; die Summe des Monats unter $ADRESSE/einstellungen."
echo
echo "Erst wenn das stimmt, die Zugänge des Postboten zurückziehen:"
echo "  - in der App unter Einstellungen → Verbundene Programme den Postboten trennen"
echo "    (und jede weitere Postboten-Zeile von Laptop oder Pi);"
echo "  - die Abo-Anmeldung in seinem claude-home abmelden oder löschen (${stillgelegt:-$POST.stillgelegt-…})."
echo "  Sein Code bleibt stillgelegt liegen (harness/ im Klon); ein Rückweg braucht danach eine neue"
echo "  Zustimmung (npx tsx harness/zugang.mts) und eine neue Anmeldung — README, „Der Postbote — stillgelegt, und der Rückweg im Notfall“."
echo
echo "Rückweg, falls nötig — NIE ZUGLEICH MIT DEM API-LESER: der Postbote kommt nur zurück, wenn die App den Schlüssel NICHT mehr hat:"
echo "  ANTHROPIC_API_KEY aus der .env nehmen (Zeile löschen), dann  $(zum_abtippen "up -d app")"
if [ -n "$stillgelegt" ]; then
  echo "  sudo mv $stillgelegt $POST  und  sudo rm -f $POST/harness/lauf.lock  und  $(zum_abtippen "up -d" "$POST")"
fi
echo "  Nach einem  sudo ~/nas.sh zurueck  auf einen Stand vor dem Umbau ist genau das der Weg: jener Stand liest Handschrift nicht selbst."
exit 0
