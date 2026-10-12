#!/bin/bash
#
# Die Schulapp vom Handy aus bedienen.
#
# Gedacht für die Lage, in der man keinen Rechner hat, sondern ein Telefon,
# eine Busfahrt und eine Tastatur, auf der jede Zeile eine Zeile zu viel ist.
# Deshalb gibt es hier kurze Wörter statt langer Befehlsfolgen — und vor
# allem einen Rückweg. Ohne Rückweg schiebt man nichts live, und wer nichts
# live schiebt, sieht unterwegs nie, ob seine Arbeit stimmt.
#
# Läuft AUF DEM NAS und braucht root, weil der Klon unter
# /volume1/docker/schulapp/ root gehört und der Docker-Socket auch:
#
#   sudo /volume1/docker/schulapp/repo/scripts/nas.sh stand
#
# Die vier Wörter:
#
#   stand      Was ist gerade live? Ändert nichts. Das meistgebrauchte. Sagt
#              auch, ob der Claude-Leser einen Schlüssel hat (nie welchen)
#              und was er zuletzt gelesen hat.
#   hoch       Neuen Stand von GitHub holen, bauen, starten, nachsehen. Ging
#              der Bau schief, baut das nächste `hoch` nach. Fehlt der
#              Datenbank eine Spalte, die der neue Stand braucht, hält es VOR
#              dem Bau an und nennt die Zeile, die sie anlegt. Ebenso, wenn
#              danach zwei Leser läsen: die App mit Schlüssel und ein
#              Postbote, der noch läuft.
#   zurueck    Auf den Stand vor dem letzten `hoch` zurück — mit dem
#              Rückfallbild in Sekunden, ohne es per Neubau. Führt der Weg vor
#              den Claude-Leser (11.10.2026), sagt es, wie der stillgelegte
#              Postbote wiederkommt; jener Stand liest Handschrift nicht selbst.
#   postbote   Stillgelegt seit dem 11.10.2026: die App liest Handschrift
#              selbst (scripts/claude-einrichten.sh). Schaltet ihn nicht mehr
#              an, sondern sagt, wo er liegt und wie er im Notfall
#              wiederkommt — nie zugleich mit einer App, die selbst liest.
#
# Bis zum 11.10.2026 stand hier noch mehr: `hoch` und `zurueck` glichen die
# Kopie von harness/ beim Postboten an, und `postbote` schaltete ihn an. Mit
# dem Claude-Leser ist das weg — der Postbote ist stillgelegt, nicht
# gelöscht: sein Code liegt weiter im Klon unter harness/, sein Ordner auf dem
# NAS umbenannt (der Notfall-Rückweg: README, „Der Postbote — stillgelegt,
# und der Rückweg im Notfall“). Eine alte Kopie dieses Skripts (~/nas.sh)
# muss trotzdem VOR dem ersten `hoch` mit dem neuen Stand ersetzt werden
# (README): sie kennt die Tabelle leser_laeufe nicht und fragt nicht, ob
# danach zwei läsen. Läuft sie doch, gleicht sie harness/ noch ab — und
# startet den Postboten neu, sobald eine Datei darin anders ist als seine
# Kopie. Deshalb bleibt harness/ Byte für Byte, wie es war
# (scripts/probe-nas.sh, Abschnitt 6, prüft es mit genau dieser alten Kopie).
#
set -u

APP=/volume1/docker/schulapp
# Wo der Postbote lag — nur noch für Hinweise. claude-einrichten.sh hat den
# Ordner beim Wechsel in postbote.stillgelegt-<Datum> umbenannt und nicht
# gelöscht: Er ist der Rückweg für den Notfall und für `zurueck` auf einen
# Stand davor.
POSTBOTE=/volume1/docker/postbote
ADRESSE=https://treskownas.tail3a40b0.ts.net

# Drei Merkzettel, alle von diesem Skript geschrieben, jeder eine Zeile:
#
#   MERK       wohin `zurueck` führt: was lief, bevor `hoch` gebaut hat
#   GEBAUT     "<Commit> <Bild-ID>": was gerade läuft, der letzte gelungene Bau
#   RUECKFALL  "<Commit> <Bild>": wessen Bild als <Name>:rueckfall bereitliegt
#
# GEBAUT gibt es seit dem 5.10.2026. An dem Tag scheiterte ein Bau an einem
# Netzaussetzer, NACHDEM der pull schon durch war. Der Klon stand damit auf dem
# neuen Stand, die App lief noch auf dem alten — und ein zweites `hoch` sah
# „nichts Neues" und baute nicht. Der Klon allein sagt eben nicht, was läuft.
MERK="$APP/.letzter-stand"
GEBAUT="$APP/.gebauter-stand"
RUECKFALL="$APP/.rueckfall-stand"

# docker compose (v2) oder docker-compose (v1)? Erst dann nachsehen, wenn es
# gebraucht wird — sonst kann das Skript nicht einmal seine eigene Hilfe
# anzeigen, wenn man es versehentlich woanders als auf dem NAS aufruft.
DOCKER=""
DC=""
finde_dc() {
  [ -n "$DC" ] && return 0

  # `sudo` setzt den Suchpfad auf secure_path zurück, und darin fehlt
  # /usr/local/bin — genau dort liegt docker auf dem NAS. Ohne diese Suche
  # scheitert jeder Aufruf mit "command not found", obwohl docker da ist.
  for d in /usr/local/bin/docker /usr/bin/docker /bin/docker; do
    [ -x "$d" ] && { DOCKER="$d"; break; }
  done
  [ -z "$DOCKER" ] && DOCKER=$(command -v docker 2>/dev/null)
  if [ -z "$DOCKER" ]; then
    echo "FEHLER: docker nicht gefunden. Läuft das hier wirklich auf dem NAS?" >&2
    exit 1
  fi

  if "$DOCKER" compose version >/dev/null 2>&1; then
    DC="$DOCKER compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    DC="docker-compose"
  else
    echo "FEHLER: weder \"docker compose\" noch \"docker-compose\" gefunden." >&2
    exit 1
  fi
}

# Eine Zeile, die man auf dem NAS so abtippen kann, wie sie dasteht. Der Ordner
# gehört root, `sudo cd` gibt es nicht, und `sudo docker` scheitert am Suchpfad —
# also eine Shell, die selbst root ist, mit vollem Pfad zu docker.
zum_abtippen() {
  echo "sudo sh -c 'cd $1 && $DC $2'"
}

# Was läuft im App-Container? "<Bild-ID> <Bildname>", leer, wenn keiner läuft.
app_bild() {
  local cid id name
  cid=$( cd "$APP" && $DC ps -q app 2>/dev/null | head -1 )
  [ -n "$cid" ] || return 0
  id=$("$DOCKER" inspect -f '{{.Image}}' "$cid" 2>/dev/null)
  name=$("$DOCKER" inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null)
  [ -n "$id" ] && echo "$id ${name:--}"
  return 0
}

# Welcher Stand läuft? Setzt zwei Variablen:
#
#   GEB_COMMIT  der Commit; leer heißt unbekannt
#   GEB_SICHER  "ja" nur, wenn dieses Skript ihn gebaut hat UND im Container
#               noch genau dieses Bild läuft — sonst ist er bloß angenommen
#
# Hat jemand an diesem Skript vorbei gebaut (`docker compose up -d --build`
# von Hand, so steht es weiter oben in der README), läuft ein anderes Bild als
# notiert. Dann ist der Zettel wertlos, und "unbekannt" die ehrliche Antwort.
lies_gebaut() {
  GEB_COMMIT=""
  GEB_SICHER="nein"
  local commit="" bild="" marke="" jetzt=""
  [ -f "$GEBAUT" ] || return 0
  read -r commit bild marke < "$GEBAUT"
  read -r jetzt _ <<< "$(app_bild)"
  # "-" heißt: als der Zettel geschrieben wurde, lief kein Container. Läuft
  # jetzt einer, ist er an diesem Skript vorbei gestartet worden.
  case "$bild" in
    ""|-) [ -n "$jetzt" ] && return 0 ;;
    *)    [ -n "$jetzt" ] && [ "$bild" != "$jetzt" ] && return 0 ;;
  esac
  GEB_COMMIT=$commit
  if [ "$marke" = "ok" ] && [ -n "$jetzt" ] && [ "$bild" = "$jetzt" ]; then
    GEB_SICHER="ja"
  fi
  return 0
}

# merke_gebaut <Commit> <ok|?> — "?" heißt: angenommen, nicht selbst gebaut.
merke_gebaut() {
  local jetzt=""
  read -r jetzt _ <<< "$(app_bild)"
  echo "$1 ${jetzt:--} $2" > "$GEBAUT"
}

# Ein Commit so, wie man ihn wiedererkennt: Kurzname und Betreff.
kurz() {
  git -C "$APP/repo" log -1 --format='%h %s' "$1" 2>/dev/null || echo "$1"
}

# "schulapp-app:latest" -> "schulapp-app". Ein Doppelpunkt im Registry-Teil
# ("host:5000/name") ist kein Tag und bleibt stehen.
ohne_tag() {
  case "${1##*/}" in
    *:*) echo "${1%:*}" ;;
    *)   echo "$1" ;;
  esac
}

# Liegt im Klon eine andere Fassung dieses Skripts als die, die gerade läuft?
# ~/nas.sh ist eine Kopie (siehe README), und eine Kopie veraltet still: Die
# Reparatur vom 5.10.2026 lag tagelang im Klon, gelaufen ist die alte Fassung.
neue_fassung_melden() {
  local klon="$APP/repo/scripts/nas.sh"
  [ -f "$klon" ] || return 0
  cmp -s "$0" "$klon" && return 0
  echo
  echo "Im Klon liegt eine andere Fassung dieses Skripts. Übernehmen mit:"
  echo "  sudo cp $klon $0"
}

# Antwortet die App? Zwei Fragen, die oft verwechselt werden:
#
#   innen  — läuft die App auf dem NAS überhaupt? Direkt an ihren Port, ohne
#            Umweg. Das ist die Frage nach dem Container.
#   außen  — ist sie über den Funnel erreichbar? Dieser Weg führt vom NAS ins
#            Internet und durch den Tunnel zurück; er kann scheitern, während
#            die App tadellos läuft.
#
# 200 und 307 sind beide gut — die Startseite leitet weiter.
erreichbar_innen() {
  curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:3000/ 2>/dev/null || true
}

# Der Funnel von außen — mit einer Eigenheit dieses Heimnetzes.
#
# Am 16.9.2026 beantwortete der Router den Funnel-Namen mit NXDOMAIN
# (DNS-Rebind-Schutz gegen ts.net). Eine Prüfung, die vom NAS aus denselben
# Router fragt, meldet dann "nicht erreichbar" — und sagt damit nichts über
# den Funnel, sondern nur über den Router. Genau dieser Fehlalarm stand hier.
#
# Deshalb: erst normal fragen, und wenn das scheitert, denselben Namen über
# einen öffentlichen Resolver nachschlagen und es noch einmal versuchen.
# Gibt der zweite Versuch eine Antwort, ist der Funnel in Ordnung und nur der
# Router im Weg. Das Ergebnis kommt als "CODE|Hinweis" zurück.
erreichbar_aussen() {
  local name code ip
  name=${ADRESSE#https://}
  name=${name%%/*}

  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 12 "$ADRESSE/" 2>/dev/null || true)
  if gut "$code"; then echo "$code|"; return 0; fi

  ip=$(nslookup "$name" 9.9.9.9 2>/dev/null | awk '/^Address: /{print $2}' | grep -E '^[0-9.]+$' | head -1)
  if [ -n "$ip" ]; then
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 --resolve "$name:443:$ip" "$ADRESSE/" 2>/dev/null || true)
    if gut "$code"; then
      echo "$code|Funnel in Ordnung — nur der Router löst den Namen nicht auf (Rebind-Schutz)"
      return 0
    fi
  fi
  echo "${code:-000}|wirklich nicht erreichbar"
  return 1
}

gut() {
  case "$1" in 200|301|302|307|308) return 0 ;; *) return 1 ;; esac
}

warte_bis_wach() {
  local i code
  for i in 1 2 3 4 5 6 7 8 9 10; do
    code=$(erreichbar_innen)
    if gut "$code"; then echo "$code"; return 0; fi
    sleep 6
  done
  echo "${code:-000}"
  return 1
}

# Das Bild, das VOR dem Bau lief, als Rückfallbild festnageln.
#
# Ein SCHEITERNDER Bau ist harmlos — der alte Container läuft einfach weiter.
# Gefährlich ist der Bau, der GELINGT und eine kaputte App hochbringt: dann
# trägt das Vorgängerbild keinen Namen mehr (<none>), und `zurueck` müsste es
# neu bauen. Das kostet im Bus dieselben Minuten ein zweites Mal.
#
# Getaggt wird nur ein Stand, der vor dem Bau geantwortet hat. So kann ein
# Bau, der auf eine schon kaputte App folgt, den letzten guten Rückweg nicht
# durch einen schlechten ersetzen.
#
# Damit `zurueck` weiß, wessen Bild da liegt, steht der Commit in $RUECKFALL.
# Klappt das Taggen nicht, läuft der Deploy trotzdem weiter: das hier ist die
# Zugabe, nicht die Absicherung.
#
# (Die Funktion fehlte vom 16.9. bis zum 5.10.2026 — beim Umbau in 1700f06
# gelöscht, der Aufruf blieb stehen. `hoch` meldete "command not found" und
# baute ohne Rückfallbild weiter.)
#
# sichere_bild <Commit> <Bild-ID> <Bildname>
sichere_bild() {
  local stand=$1 id=$2 bild=$3
  case "$bild" in ""|-|sha256:*) bild="" ;; esac
  if [ -n "$id" ] && [ -n "$bild" ] && "$DOCKER" tag "$id" "$(ohne_tag "$bild"):rueckfall" 2>/dev/null; then
    echo "$stand $bild" > "$RUECKFALL"
    echo "Rückfallbild: $(ohne_tag "$bild"):rueckfall ($(kurz "$stand"))"
  else
    echo "(kein Rückfallbild gesetzt — \"zurueck\" baut dann neu, das dauert)"
  fi
  return 0
}

# Liegt das Rückfallbild GENAU dieses Standes bereit?
rueckfall_bereit() {
  local commit="" bild=""
  [ -f "$RUECKFALL" ] || return 1
  read -r commit bild < "$RUECKFALL"
  [ "$commit" = "$1" ] && [ -n "$bild" ] || return 1
  "$DOCKER" image inspect "$(ohne_tag "$bild"):rueckfall" >/dev/null 2>&1
}

# Der schnelle Rückweg: Das Rückfallbild wird wieder zum gültigen Bild und ohne
# Bau gestartet. Passt etwas nicht — anderer Stand, Bild weg, Start scheitert —,
# sagt die Funktion nein, und `zurueck` baut wie früher neu.
rueckfall_nehmen() {
  rueckfall_bereit "$1" || return 1
  local commit="" bild=""
  read -r commit bild < "$RUECKFALL"
  echo "Nehme das Rückfallbild $(ohne_tag "$bild"):rueckfall — ohne Bau."
  "$DOCKER" tag "$(ohne_tag "$bild"):rueckfall" "$bild" || return 1
  ( cd "$APP" && $DC up -d ) || return 1
}

# Wohin `zurueck` führt und wie schnell — für die Meldungen, wenn etwas schiefging.
rueckweg_hinweis() {
  if [ ! -f "$MERK" ]; then
    echo "Einen gemerkten Rückweg gibt es nicht. Ins Protokoll sehen:"
    echo "  $(zum_abtippen "$APP" "logs --tail=50 app")"
    return 0
  fi
  local merk
  merk=$(cat "$MERK")
  echo "Zurück auf $(kurz "$merk"):"
  echo "  sudo $0 zurueck"
  if rueckfall_bereit "$merk"; then
    echo "  (nimmt das Rückfallbild — Sekunden, kein Neubau)"
  else
    echo "  (baut den alten Stand neu, das dauert)"
  fi
}

# ---------------------------------------------------------------- stand
stand() {
  finde_dc
  echo "=== Live-Stand ==="
  if [ -d "$APP/repo/.git" ]; then
    git -C "$APP/repo" log -1 --format='Commit:  %h  %s' 2>/dev/null
    git -C "$APP/repo" log -1 --format='Vom:     %ad' --date=format:'%d.%m.%Y %H:%M' 2>/dev/null
    local zweig
    zweig=$(git -C "$APP/repo" rev-parse --abbrev-ref HEAD 2>/dev/null)
    if [ "$zweig" = "HEAD" ]; then
      echo "Zweig:   (abgekoppelt — du bist per \"zurueck\" hierher gekommen)"
    else
      echo "Zweig:   $zweig"
    fi

    # Der Klon ist nicht dasselbe wie das, was läuft: Scheitert ein Bau, steht
    # der Klon schon woanders und die App noch auf dem alten Stand. Welcher Bau
    # scheiterte, sagt der Zweig — abgekoppelt ist der Klon nur durch `zurueck`.
    local kopf jetzt_bild=""
    lies_gebaut
    kopf=$(git -C "$APP/repo" rev-parse HEAD 2>/dev/null)
    read -r jetzt_bild _ <<< "$(app_bild)"
    if [ -z "$jetzt_bild" ]; then
      echo "ACHTUNG: Es läuft gerade gar keine App. Nur neu starten, ohne Bau:"
      echo "         $(zum_abtippen "$APP" "up -d")"
    elif [ -n "$GEB_COMMIT" ] && [ "$GEB_COMMIT" != "$kopf" ]; then
      echo "ACHTUNG: Es läuft noch $(kurz "$GEB_COMMIT")."
      if [ "$zweig" = "HEAD" ]; then
        echo "         Der Bau beim \"zurueck\" ist nicht durchgekommen. Noch einmal: sudo $0 zurueck"
      else
        echo "         Der Bau beim \"hoch\" ist nicht durchgekommen. Noch einmal: sudo $0 hoch"
      fi
    fi
  else
    echo "(kein Klon unter $APP/repo gefunden)"
  fi

  if [ -f "$MERK" ]; then
    local merk
    merk=$(cat "$MERK")
    if rueckfall_bereit "$merk"; then
      echo "Rückweg: $(kurz "$merk")   (per \"zurueck\", in Sekunden: das Rückfallbild liegt bereit)"
    else
      echo "Rückweg: $(kurz "$merk")   (per \"zurueck\", mit Neubau)"
    fi
  else
    echo "Rückweg: noch keiner gemerkt"
  fi

  echo
  echo "=== Container ==="
  ( cd "$APP" 2>/dev/null && $DC ps 2>/dev/null ) || echo "(nicht lesbar)"

  echo
  echo "=== Claude-Leser ==="
  claude_stand

  echo
  echo "=== Erreichbar ==="
  local ci roh ca hinweis
  ci=$(erreichbar_innen)
  roh=$(erreichbar_aussen); ca=${roh%%|*}; hinweis=${roh#*|}
  echo "innen  (127.0.0.1:3000) -> HTTP ${ci:-000}$(gut "$ci" && echo "  ok" || echo "  ACHTUNG")"
  echo "außen  (Funnel)         -> HTTP ${ca:-000}$(gut "$ca" && echo "  ok" || echo "  ACHTUNG")"
  [ -n "$hinweis" ] && echo "                           $hinweis"
  return 0
}

# ------------------------------------------------- Spalten vor dem Bau
#
# Spalten, ohne die ein Stand nicht läuft — je Zeile Tabelle, Spalte und die
# SQL-Datei, die sie anlegt. Geprüft wird eine Zeile nur, wenn ihre Datei im
# neuen Stand liegt: dann gehört die Spalte zu ihm.
#
# Warum vor dem Bau: Additive Spalten verträgt der alte Code, er fragt sie
# nicht ab. Der neue Code ohne sie scheitert an jeder Seite mit „column does
# not exist“ — Ablage, Korb, Hochladen. Deshalb kommt die SQL-Datei VOR den
# Bau, und dieses Skript sieht nach, statt es zu glauben.
#
# Eine ganz neue Tabelle steht hier mit einer ihrer Spalten: „gibt es
# leser_laeufe.frist_bis?“ ist dieselbe Frage wie „gibt es die Tabelle?“,
# nur dass db_spalte sie schon stellen kann. Ohne leser_laeufe (11.10.2026)
# scheitert jeder Lauf des Claude-Lesers — und mit ihm das Gedächtnis, das
# verhindert, dass ein Blatt zweimal bezahlt gelesen wird. Gefragt wird nach
# `frist_bis` und nicht nach `schluessel`: die kam erst mit der Abnahme vom
# 11.10.2026 in die Datei, und eine Tabelle aus einer Fassung davor hielte
# sonst als „da“ — und jeder Lauf schiene an einer fehlenden Spalte.
#
# Modell 23 (Plan 5.7): je neue SQL-Datei eine Zeile. Die GIN-Indizes
# (kombi-suche.sql) prüft `hoch` nicht: ohne Index ist die Suche nur
# langsamer. Den getauschten CHECK (kombi-arbeitsblaetter-checks.sql) prüft
# `spalten_pruefen` eigens am Ende, er hat keine Spalte.
PFLICHTSPALTEN="material_pages leser scripts/leser-tabellen.sql
leser_laeufe frist_bis scripts/leser-laeufe-tabelle.sql
tagesprotokoll typ scripts/kombi-tagesprotokoll.sql
study_blocks pause_ms scripts/kombi-lernblock-uhr.sql
subject_topics art scripts/kombi-themen-art.sql
arbeitsblaetter inhalt scripts/kombi-arbeitsblaetter.sql
leser_laeufe arbeitsblatt_id scripts/kombi-arbeitsblaetter.sql"

# Postgres im db-Container, Benutzer und Datenbank aus SEINER Umgebung — wie
# psql_db() in scripts/kalender-einrichten.sh; "schulapp" nur als Rückfall.
#
# db_spalte <tabelle> <spalte>  →  "1", "0" oder leer (nicht nachzusehen)
db_spalte() {
  # shellcheck disable=SC2016  # die $-Ausdrücke wertet die Shell IM Container aus
  ( cd "$APP" && $DC exec -T db sh -c 'exec psql -X -tA -U "${POSTGRES_USER:-schulapp}" -d "${POSTGRES_DB:-${POSTGRES_USER:-schulapp}}" -c "$1"' psql \
      "select count(*) from information_schema.columns where table_schema = current_schema() and table_name = '$1' and column_name = '$2'" \
  ) < /dev/null 2>/dev/null | tr -d '[:space:]'
}

# Eine Abfrage, Zeilen mit zwei Leerzeichen zwischen den Spalten. Nur lesend
# benutzt (`stand`).
db_abfrage() {
  # shellcheck disable=SC2016  # die $-Ausdrücke wertet die Shell IM Container aus
  ( cd "$APP" && $DC exec -T db sh -c 'exec psql -X -tA -F "  " -U "${POSTGRES_USER:-schulapp}" -d "${POSTGRES_DB:-${POSTGRES_USER:-schulapp}}" -c "$1"' psql "$1" ) < /dev/null 2>/dev/null
}

# Benutzer und Datenbank, wie sie im db-Container stehen — damit die Zeile
# zum Abtippen die echten Namen trägt und nicht geratene.
db_namen() {
  local namen
  # shellcheck disable=SC2016
  namen=$( cd "$APP" && $DC exec -T db sh -c 'echo "${POSTGRES_USER:-schulapp} ${POSTGRES_DB:-${POSTGRES_USER:-schulapp}}"' < /dev/null 2>/dev/null )
  echo "${namen:-schulapp schulapp}"
}

# spalten_pruefen <Commit> [laeuft] — hält an (Rückgabe 1), wenn eine Spalte
# fehlt. Lässt es sich nicht nachsehen (db antwortet nicht), sagt es das und
# lässt weitermachen: ohne Datenbank ist die App ohnehin kaputt, und eine
# Prüfung, die jeden `hoch` sperrt, weil sie selbst klemmt, wäre schlimmer als
# keine.
#
# Mit „laeuft“ ist es der Zweig „Nichts Neues“: gebaut wird dort nichts, die
# laufende App IST schon der Stand — fehlt ihr die Spalte, scheitert sie jetzt
# schon an jeder Seite. Das passiert, wenn eine alte Kopie dieses Skripts ohne
# Prüfung gebaut hat und das SQL vergessen war. Ohne diesen Blick meldete der
# zweite `hoch` Erfolg, und die App scheiterte weiter an jeder Seite.
spalten_pruefen() {
  local tabelle spalte datei antwort benutzer datenbank
  while read -r tabelle spalte datei; do
    [ -n "$tabelle" ] || continue
    git -C "$APP/repo" cat-file -e "$1:$datei" 2>/dev/null || continue
    antwort=$(db_spalte "$tabelle" "$spalte")
    case "$antwort" in
      1)
        echo "Datenbank: $tabelle.$spalte ist da." ;;
      0)
        read -r benutzer datenbank <<< "$(db_namen)"
        echo >&2
        if [ "${2:-}" = "laeuft" ]; then
          echo "HALT: Der Datenbank fehlt $tabelle.$spalte — und die App, die läuft, braucht sie schon." >&2
          echo "Gebaut wird nichts; bis die Spalte da ist, scheitert jede Seite." >&2
        else
          echo "HALT: Der Datenbank fehlt $tabelle.$spalte — der neue Stand braucht sie." >&2
          echo "Gebaut ist nichts, die App läuft weiter wie bisher." >&2
        fi
        echo >&2
        echo "Vorher sichern und zählen — die Zählzeilen stehen im Kopf von $datei," >&2
        echo "die ganze Reihenfolge im README. Dann einspielen, in einer Transaktion, mit" >&2
        echo "Abbruch beim ersten Fehler und mit Benutzer und Datenbank aus dem db-Container:" >&2
        echo "  sudo sh -c 'cd $APP && $DC exec -T db psql -X -v ON_ERROR_STOP=1 --single-transaction -U $benutzer -d $datenbank -f - < repo/$datei'" >&2
        case "$datei" in
          scripts/kombi-*)
            echo "Modell 23: sechs Dateien in fester Reihenfolge, README „Modell 23 auf dem NAS“." >&2 ;;
        esac
        if [ "$datei" = "scripts/kombi-arbeitsblaetter.sql" ]; then
          echo "Gleich danach, genauso, die Folgedatei (tauscht zwei CHECKs an leser_laeufe):" >&2
          echo "  sudo sh -c 'cd $APP && $DC exec -T db psql -X -v ON_ERROR_STOP=1 --single-transaction -U $benutzer -d $datenbank -f - < repo/scripts/kombi-arbeitsblaetter-checks.sql'" >&2
        fi
        if [ "${2:-}" = "laeuft" ]; then
          echo "Danach noch einmal:  sudo $0 hoch   — es sieht dann noch einmal nach." >&2
        else
          echo "Danach noch einmal:  sudo $0 hoch   — es baut dann nach." >&2
        fi
        return 1 ;;
      *)
        echo "(Ob $tabelle.$spalte da ist, ließ sich nicht nachsehen — die Datenbank antwortet nicht."
        echo " Ich mache trotzdem weiter. Fehlt sie, scheitert danach jede Seite: dann $datei einspielen.)" ;;
    esac
  done <<< "$PFLICHTSPALTEN"

  # Der CHECK-Tausch steht in keiner Spalte: ohne ihn scheitert erst der erste
  # Arbeitsblatt-Lauf. Darum hier eigens nachsehen, sobald der Stand die
  # Datei hat und die Tabelle leser_laeufe da ist.
  if git -C "$APP/repo" cat-file -e "$1:scripts/kombi-arbeitsblaetter-checks.sql" 2>/dev/null; then
    antwort=$(db_abfrage "select count(*) from pg_constraint where conname = 'leser_laeufe_art_check' and pg_get_constraintdef(oid) like '%arbeitsblatt%'" | tr -d '[:space:]')
    case "$antwort" in
      1) echo "Datenbank: leser_laeufe_art_check kennt 'arbeitsblatt'." ;;
      0)
        read -r benutzer datenbank <<< "$(db_namen)"
        echo >&2
        echo "HALT: leser_laeufe_art_check kennt die Lauf-Art 'arbeitsblatt' nicht — der Tausch fehlt." >&2
        echo "Zählzeilen im Kopf von scripts/kombi-arbeitsblaetter-checks.sql, Reihenfolge im README" >&2
        echo "(„Modell 23 auf dem NAS“). Einspielen:" >&2
        echo "  sudo sh -c 'cd $APP && $DC exec -T db psql -X -v ON_ERROR_STOP=1 --single-transaction -U $benutzer -d $datenbank -f - < repo/scripts/kombi-arbeitsblaetter-checks.sql'" >&2
        echo "Danach noch einmal:  sudo $0 hoch" >&2
        return 1 ;;
      *)
        echo "(Ob leser_laeufe_art_check 'arbeitsblatt' kennt, ließ sich nicht nachsehen — ich mache weiter.)" ;;
    esac
  fi
  return 0
}

# ------------------------------------------------------- Claude-Leser
#
# Seit dem 11.10.2026 ruft die App Opus selbst und schreibt Handschrift ab
# (src/lib/claude/client.ts). Bis dahin tat das der Postbote, ein eigener
# Container mit einer Kopie von harness/, die dieses Skript nach jedem `hoch`
# angleichen musste. Das ist vorbei; geblieben sind drei Fragen, und alle drei
# stellt dieses Skript an Docker oder an die Datenbank, nie an `ps` — das `ps`
# des Synology-Hosts sieht Container-Prozesse nicht:
#
#   - Hat die App einen Schlüssel? Ohne ihn liest niemand Handschrift, und
#     nichts im Betrieb fällt dabei auf — die App läuft sonst wie bisher.
#   - Läuft trotzdem noch ein Postbote? Dann lesen zwei, und zwei Vorschläge
#     liegen am selben Blatt — einer davon bezahlt.
#   - Was hat der Leser zuletzt getan, und was hat es diesen Monat gekostet?

# Hat der Stand <Commit> den Claude-Leser? An der Datei, die ihn ausmacht.
claude_im_stand() {
  git -C "$APP/repo" cat-file -e "$1:src/lib/claude/client.ts" 2>/dev/null
}

# Steht ein Schlüssel in der .env? Nur ob, nie welcher. Das allein heißt
# NICHT, dass die App liest: in den Container kommt er nur über die
# Override-Datei (services → app → environment), siehe die beiden darunter.
schluessel_in_env() {
  grep -q '^ANTHROPIC_API_KEY=[^[:space:]]' "$APP/.env" 2>/dev/null
}

# Hat die LAUFENDE App den Schlüssel in ihrer Umgebung? "ja", "nein", oder
# leer (nicht nachzusehen — läuft sie?). Nur ob, nie welcher: node im
# Container schreibt "ja" oder "nein", der Wert verlässt ihn nicht.
schluessel_im_container() {
  # shellcheck disable=SC2016  # die $-Ausdrücke wertet node IM Container aus
  ( cd "$APP" && $DC exec -T app node -e 'process.stdout.write((process.env.ANTHROPIC_API_KEY || "").trim() ? "ja" : "nein")' ) < /dev/null 2>/dev/null
}

# Bekäme ein NEU erzeugter App-Container ihn? Er steht in der .env, UND die
# Override-Datei reicht ihn durch — dasselbe grep wie im_override in
# claude-einrichten.sh. Fehlt die Zeile dort (Schritt 3 hielt an, oder die
# Datei wurde neu angelegt), liest auch der neue Stand nicht.
schluessel_fuer_neue_app() {
  schluessel_in_env \
    && grep -qE '^[[:space:]]+(-[[:space:]]*)?ANTHROPIC_API_KEY[[:space:]]*[:=]' "$APP/docker-compose.override.yml" 2>/dev/null
}

# Nach dem Bau, und wenn es nichts zu bauen gab: Liest dieser Stand
# Handschrift? Gefragt wird die laufende App, nicht die .env — sonst sagte
# `hoch` nichts, obwohl niemand liest, weil der Schlüssel nur in der .env
# steht (Abnahme vom 11.10.2026).
#
# Drei Gründe, warum der Container ihn nicht hat, und jeder bekommt seinen
# Satz: kein Schlüssel; einer in der .env, den die Override-Datei nicht
# durchreicht; oder beides ist da, aber die App lief schon vorher und wurde
# danach nicht neu erzeugt — claude-einrichten.sh hielt zwischen Schritt 3 und
# 5 an. Bis zur Nachprüfung vom 11.10.2026 hieß der dritte Fall auch „reicht
# nicht durch“, und das stimmte nicht.
schluessel_hinweis() {
  claude_im_stand "$1" || return 0
  case "$(schluessel_im_container)" in
    ja) return 0 ;;
    nein) ;;
    *) echo; echo "(Ob die App einen Schlüssel hat, ließ sich nicht nachsehen:  sudo $0 stand)"; return 0 ;;
  esac
  echo
  if schluessel_fuer_neue_app; then
    echo "Handschrift liest die App NICHT: der Schlüssel steht in der .env und in der Override-Datei, aber die"
    echo "laufende App wurde danach nicht neu erzeugt (claude-einrichten.sh hielt vor Schritt 5 an)."
    echo "Noch einmal einrichten — es setzt fort, hält den Postboten an und erzeugt erst dann die App neu:"
  elif schluessel_in_env; then
    echo "Handschrift liest die App NICHT: der Schlüssel steht in der .env, kommt aber nicht in den Container"
    echo "(die Override-Datei reicht ANTHROPIC_API_KEY nicht durch). Einrichten — das ergänzt sie und löst den Postboten ab:"
  else
    echo "Handschrift liest die App erst mit einem Schlüssel — einrichten (löst den Postboten ab):"
  fi
  echo "  sudo bash $APP/repo/scripts/claude-einrichten.sh"
}

# Laufende Container eines Dienstes namens postbote, gleich aus welchem Ordner
# — auch aus einem umbenannten.
postbote_container() {
  "$DOCKER" ps -q --filter "label=com.docker.compose.service=postbote" 2>/dev/null | tr '\n' ' ' | sed 's/ $//'
}

# Der zuletzt stillgelegte Ordner des Postboten, leer, wenn es keinen gibt.
postbote_stillgelegt() {
  # shellcheck disable=SC2012  # Namen mit Datum, ohne Leerzeichen
  ls -d "$POSTBOTE".stillgelegt-* 2>/dev/null | tail -n 1
}

# Für `stand`: Schlüssel (ja/nein), Bildfassung, ein Postbote, der noch läuft,
# die letzten fünf Läufe und die Summe des Monats.
#
# Der `grund` eines Laufs steht hier NICHT: Er kann Text enthalten, den das
# Modell von einem Blatt hat, und ein Blatt soll keine Steuerzeichen in ein
# root-Terminal schreiben können. Was ein Lauf gesagt hat, steht am Blatt.
claude_stand() {
  local antwort schluessel bild laeufer
  # shellcheck disable=SC2016  # die $-Ausdrücke wertet node IM Container aus
  antwort=$( cd "$APP" && $DC exec -T app node -e 'const e = process.env; process.stdout.write(((e.ANTHROPIC_API_KEY || "").trim() ? "ja" : "nein") + " " + ((e.CLAUDE_BILD || "").trim() === "voll" ? "voll" : "lesefassung"))' < /dev/null 2>/dev/null )
  read -r schluessel bild <<< "$antwort"
  case "$schluessel" in
    ja)   echo "Schlüssel: gesetzt (der Wert bleibt verborgen) — Bild: $bild" ;;
    nein) echo "Schlüssel: FEHLT — Handschrift liest niemand. Einrichten:  sudo bash $APP/repo/scripts/claude-einrichten.sh" ;;
    *)    echo "Schlüssel: (nicht nachzusehen — läuft die App?)" ;;
  esac

  laeufer=$(postbote_container)
  if [ -n "$laeufer" ]; then
    if [ "$schluessel" = ja ]; then
      echo "ACHTUNG:   Ein Postbote läuft noch ($laeufer) — mit dem Schlüssel der App lesen ZWEI."
      echo "           Anhalten:  sudo $DOCKER stop $laeufer"
    else
      echo "Postbote:  läuft noch ($laeufer) — er liest, bis claude-einrichten.sh ihn ablöst."
    fi
  fi

  # Erst nachsehen, ob es die Tabelle gibt: ein Stand vor dem 11.10.2026 hat
  # sie nicht, und psql meldete sonst einen Fehler, wo nur „noch nichts“ ist.
  case "$(db_spalte leser_laeufe frist_bis)" in
    1) ;;
    0) echo "Läufe:     (keine Tabelle leser_laeufe in dieser Fassung — ein Stand vor dem Claude-Leser, oder eine ältere scripts/leser-laeufe-tabelle.sql)"; return 0 ;;
    *) echo "Läufe:     (nicht nachzusehen — die Datenbank antwortet nicht)"; return 0 ;;
  esac
  local letzte monat
  letzte="select to_char(created_at at time zone 'Europe/Berlin', 'DD.MM. HH24:MI'), rpad(art, 9), rpad(ergebnis, 14), coalesce(to_char(kosten_usd, 'FM990.000') || ' \$', '?'), left(coalesce(material_id, exam_id)::text, 8), regexp_replace(coalesce(modell, ''), '[^a-z0-9.-]', '', 'g') from leser_laeufe order by created_at desc limit 5"
  # Der Monat wie auf der Seite Einstellungen: ab dem Ersten des Berliner
  # Monats, Mitternacht UTC. Die vierte Zahl sind die bezahlten Abbrüche ohne
  # Messung (laufKosten() in src/lib/leser/laeufe.ts) — gibt es einen, ist die
  # Summe eine Untergrenze, und das steht dabei.
  monat="select count(*) filter (where messung is not null), to_char(coalesce(sum(kosten_usd), 0), 'FM9990.00'), count(*) filter (where messung is not null and kosten_usd is null), count(*) filter (where messung is null and (abbruch is not null or (ergebnis = 'laeuft' and frist_bis < now()))) from leser_laeufe where created_at >= (to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM') || '-01T00:00:00Z')::timestamptz"

  echo "Zuletzt:"
  db_abfrage "$letzte" | LC_ALL=C tr -d '\000-\010\013-\037\177' | sed 's/^/  /'
  antwort=$(db_abfrage "$monat")
  local anzahl usd unbekannt abgebrochen
  read -r anzahl usd unbekannt abgebrochen <<< "$antwort"
  if [ -n "${anzahl:-}" ]; then
    local zusatz="" mindestens=""
    [ -n "${unbekannt:-}" ] && [ "$unbekannt" != 0 ] && zusatz="$zusatz; $unbekannt davon ohne bekannten Preis"
    [ -n "${abgebrochen:-}" ] && [ "$abgebrochen" != 0 ] && zusatz="$zusatz; dazu $abgebrochen abgebrochene, deren Kosten nicht bekannt sind"
    [ -n "$zusatz" ] && { mindestens="mindestens "; zusatz=" (${zusatz#; })"; }
    echo "Diesen Monat: $anzahl Läufe mit Antwort, zusammen $mindestens$usd \$$zusatz"
  fi
  return 0
}

# Vor dem Bau: Läse der neue Stand selbst, während ein Postbote läuft, lägen
# danach zwei Vorschläge am selben Blatt. Dann hier anhalten — gebaut ist
# nichts, und es liest weiter nur, wer bisher las. Ohne Schlüssel liest die
# neue App keine Handschrift; dann darf der Postbote weiterlaufen, bis
# claude-einrichten.sh ihn ablöst.
#
# „Liest selbst“ heißt drei Dinge zugleich: der neue Stand hat den Leser
# (claude_im_stand), und die App HAT den Schlüssel — die laufende in ihrer
# Umgebung, oder ein neu erzeugter Container bekäme ihn über die
# Override-Datei. Bis zur Abnahme vom 11.10.2026 genügte hier „steht in der
# .env“. Stand er nur dort (Schritt 3 von claude-einrichten.sh hielt an, oder
# jev-und-docling.sh legte die Override-Datei neu an), hielt `hoch` mit dem
# Rat `docker stop` an — und danach las niemand mehr Handschrift, ohne dass
# es irgendwo stand.
#
# Das trifft vor allem den Weg zurück nach vorn: `zurueck` auf einen Stand vor
# dem 11.10.2026 braucht den Postboten wieder, und das nächste `hoch` darf
# nicht mit ihm zusammen hochkommen.
#
# zwei_leser_pruefen <Commit> [laeuft] — mit „laeuft“ ist es der Zweig
# „Nichts Neues“ (wie bei spalten_pruefen): gebaut und neu erzeugt wird dort
# nichts, also zählt NUR, was der laufende Container hat. Was ein neu
# erzeugter bekäme, ist dort keine Frage — bis zur Nachprüfung vom 11.10.2026
# zählte es trotzdem, und nach einem claude-einrichten.sh, das zwischen
# Schritt 3 und 5 anhielt (Schlüssel in .env und Override, App noch die alte,
# Postbote liest), hielt `hoch` mit dem Rat `docker stop` an. Wer ihm folgte,
# hatte danach niemanden mehr, der Handschrift liest.
zwei_leser_pruefen() {
  claude_im_stand "$1" || return 0
  local laeufer im_container neue_app=nein
  laeufer=$(postbote_container)
  [ -n "$laeufer" ] || return 0
  im_container=$(schluessel_im_container)
  [ "${2:-}" != laeuft ] && schluessel_fuer_neue_app && neue_app=ja
  if [ "$im_container" = ja ] || [ "$neue_app" = ja ]; then
    echo >&2
    if [ "$im_container" = ja ]; then
      echo "HALT: Ein Postbote läuft ($laeufer), und die App hat den Schlüssel in ihrer Umgebung — der neue Stand liest selbst." >&2
    else
      echo "HALT: Ein Postbote läuft ($laeufer), und die neue App bekäme den Schlüssel (.env und Override-Datei) — sie läse selbst." >&2
    fi
    echo "Zusammen lägen danach zwei Vorschläge am selben Blatt. Gebaut ist nichts." >&2
    echo "Erst den Postboten anhalten, dann noch einmal:" >&2
    echo "  sudo $DOCKER stop $laeufer" >&2
    echo "  sudo $0 hoch" >&2
    return 1
  fi
  if [ "${2:-}" = laeuft ] && [ -z "$im_container" ]; then
    echo "Der Postbote läuft noch ($laeufer). Ob die laufende App einen Schlüssel hat, ließ sich nicht nachsehen:"
    echo "  sudo $0 stand"
    return 0
  elif [ "${2:-}" = laeuft ] && schluessel_fuer_neue_app; then
    echo "Der Postbote läuft noch ($laeufer). Der Schlüssel steht in der .env und in der Override-Datei, aber die"
    echo "laufende App wurde danach nicht neu erzeugt und hat ihn nicht — also liest nur der Postbote. NICHT anhalten."
    echo "Ablösen — claude-einrichten.sh setzt fort, hält ihn an und erzeugt erst dann die App neu:"
  elif schluessel_in_env; then
    echo "Der Postbote läuft noch ($laeufer). Der Schlüssel steht zwar in der .env, aber die App bekommt ihn nicht"
    echo "(die Override-Datei reicht ANTHROPIC_API_KEY nicht durch) — also liest weiter nur der Postbote. NICHT anhalten."
    echo "Ablösen danach — das ergänzt die Override-Datei und hält ihn erst dann an:"
  else
    echo "Der Postbote läuft noch ($laeufer); die neue App hat keinen Schlüssel und liest keine Handschrift."
    echo "Ablösen danach:"
  fi
  echo "  sudo bash $APP/repo/scripts/claude-einrichten.sh"
  return 0
}

# ----------------------------------------------------------------- hoch
hoch() {
  finde_dc
  [ -d "$APP/repo/.git" ] || { echo "FEHLER: kein Klon unter $APP/repo" >&2; exit 1; }

  # Wo stehen wir? Das ist der Rückweg, und er wird VOR allem anderen gemerkt.
  local vorher
  vorher=$(git -C "$APP/repo" rev-parse HEAD) || exit 1
  lies_gebaut
  echo "Jetziger Stand: $(git -C "$APP/repo" log -1 --format='%h %s')"
  if [ -f "$GEBAUT" ] && [ -z "$GEB_COMMIT" ]; then
    echo "(Im Container läuft ein anderes Bild, als ich zuletzt gebaut habe — da hat"
    echo " jemand von Hand gebaut. Ich nehme an, es läuft der Stand im Klon.)"
  fi

  # Nach einem "zurueck" hängt HEAD ab — zurück auf main, sonst holt der
  # pull nichts und der Bau baut denselben alten Stand noch einmal.
  local zweig
  zweig=$(git -C "$APP/repo" rev-parse --abbrev-ref HEAD)
  if [ "$zweig" = "HEAD" ]; then
    echo "HEAD war abgekoppelt — gehe zurück auf main."
    git -C "$APP/repo" checkout main || exit 1
  fi

  echo "Hole von GitHub ..."
  git -C "$APP/repo" pull --ff-only || {
    echo >&2
    echo "FEHLER: pull ging nicht durch." >&2
    echo "Meistens liegen im Klon eigene Änderungen. Ansehen mit:" >&2
    echo "  git -C $APP/repo status" >&2
    exit 1
  }

  # Ab hier liegt der neue Stand im Klon — und damit vielleicht auch eine neue
  # Fassung dieses Skripts. Wie auch immer `hoch` endet, das wird gemeldet.
  trap neue_fassung_melden EXIT

  # Was läuft gerade? Das sagt GEBAUT. Ist es unbekannt (die Datei entsteht
  # erst mit dieser Fassung, und ein Handbau entwertet sie), gilt die alte
  # Annahme: es läuft, was vor dem pull im Klon stand.
  local nachher laeuft
  nachher=$(git -C "$APP/repo" rev-parse HEAD)
  laeuft=${GEB_COMMIT:-$vorher}

  local jetzt_bild=""
  read -r jetzt_bild _ <<< "$(app_bild)"

  if [ "$nachher" = "$laeuft" ] && [ -z "$jetzt_bild" ]; then
    echo "Nichts Neues von GitHub — aber es läuft gerade gar keine App." >&2
    echo "Nur neu starten, ohne Bau:" >&2
    echo "  $(zum_abtippen "$APP" "up -d")" >&2
    echo "Antwortet sie danach nicht:" >&2
    rueckweg_hinweis >&2
    exit 1
  fi

  if [ "$nachher" = "$laeuft" ]; then
    echo "Nichts Neues — der Stand war schon aktuell. Baue nicht neu."
    if [ -z "$GEB_COMMIT" ]; then
      echo "Ob er auch gebaut ist, weiß ich nicht. Ging der letzte Bau schief, so von Hand:"
      echo "  $(zum_abtippen "$APP" "up -d --build")"
    fi
    # Gebaut wird nichts, nachgesehen schon: Kam der laufende Stand mit einer
    # älteren Kopie dieses Skripts aufs NAS, hat sie vielleicht ohne Blick in
    # die Datenbank gebaut. `/` antwortet ohne Anmeldung auch dann, wenn jede
    # Seite an einer fehlenden Spalte scheitert (spalten_pruefen, „laeuft“).
    # Und läuft neben einer App, die selbst liest, noch ein Postbote, steht
    # es hier — anhalten kann es nichts mehr, gebaut ist ja schon.
    if gut "$(erreichbar_innen)"; then
      spalten_pruefen "$nachher" laeuft || exit 1
      zwei_leser_pruefen "$nachher" laeuft || exit 1
      schluessel_hinweis "$nachher"
    else
      echo "Die App antwortet gerade nicht — erst ins Protokoll sehen:"
      echo "  $(zum_abtippen "$APP" "logs --tail=50 app")"
    fi
    exit 0
  fi

  if [ "$vorher" = "$nachher" ]; then
    if [ -z "$jetzt_bild" ]; then
      echo "Von GitHub kam nichts Neues — und es läuft gerade gar keine App."
      echo "Gebaut war zuletzt $(kurz "$laeuft"). Ich baue den Stand im Klon und starte ihn."
    else
      echo "Von GitHub kam nichts Neues — aber es läuft noch $(kurz "$laeuft")."
      echo "Der letzte Bau ist also nicht durchgekommen. Ich baue jetzt nach."
    fi
  fi

  echo
  echo "Neu gegenüber dem, was läuft:"
  { git -C "$APP/repo" log --oneline "$laeuft..$nachher" 2>/dev/null \
    || git -C "$APP/repo" log --oneline "$vorher..$nachher"; } | sed 's/^/  /'
  echo

  # Was läuft, und antwortet es? Beides VOR dem Bau gelesen: danach trägt das
  # alte Bild keinen Namen mehr, und ob es geantwortet hat, weiß keiner.
  local alt_bild="" alt_name="" gesund
  read -r alt_bild alt_name <<< "$(app_bild)"
  gesund=$(erreichbar_innen)

  # War unbekannt, was läuft, wird die Annahme notiert, auf der dieser Lauf
  # beruht. Sonst stünde nach einem gescheiterten Bau wieder nichts da, und
  # das nächste `hoch` sähe „nichts Neues" — genau der Fehler vom 5.10.2026.
  # Das "?" sorgt dafür, dass aus der Annahme nie ein Rückfallbild wird.
  [ -n "$GEB_COMMIT" ] || merke_gebaut "$laeuft" "?"

  # Fehlt der Datenbank eine Spalte, die der neue Stand braucht, hier anhalten
  # — vor dem Bau und vor dem Rückweg, es ändert sich also nichts. Weil eben
  # notiert ist, was läuft, baut das nächste `hoch` nach, sobald sie da ist.
  spalten_pruefen "$nachher" || exit 1
  zwei_leser_pruefen "$nachher" || exit 1

  # Der Rückweg ist der Stand, der jetzt läuft — aber nur, wenn er auch
  # antwortet. War die App schon kaputt, bleibt der alte Rückweg stehen: Er
  # führt zu etwas, das funktioniert hat. Festgehalten wird VOR dem Bau, denn
  # reißt der Lauf mittendrin ab (Funkloch, Strg-C), ist danach nichts mehr da.
  echo "Nagle den laufenden Stand fest ..."
  if gut "$gesund"; then
    echo "$laeuft" > "$MERK"
    if [ "$GEB_SICHER" = "ja" ]; then
      sichere_bild "$laeuft" "$alt_bild" "$alt_name"
    else
      echo "(kein Rückfallbild: welcher Stand läuft, ist nur angenommen — \"zurueck\" baut dann neu)"
    fi
  else
    echo "Die App antwortet gerade nicht (HTTP ${gesund:-000}) — den Rückweg lasse ich, wie er war."
  fi

  echo "Baue und starte ... (das dauert auf dem NAS mehrere Minuten)"
  local bau="ok"
  bauen_und_starten || bau="schief"
  [ "$bau" = "ok" ] && merke_gebaut "$nachher" ok

  if [ "$bau" != "ok" ]; then
    echo >&2
    echo "FEHLER: der Bau ging schief." >&2
    local jetzt
    jetzt=$(erreichbar_innen)
    if gut "$jetzt"; then
      echo "Die App läuft weiter (HTTP $jetzt), auf $(kurz "$laeuft"). Kaputt ist nichts." >&2
      echo "Noch einmal versuchen — das baut jetzt nach, auch ohne Neues von GitHub:" >&2
      echo "  sudo $0 hoch" >&2
      echo "Scheitert es wieder an derselben Stelle, steht der Grund oben im Protokoll." >&2
    else
      echo "Und die App antwortet nicht (HTTP ${jetzt:-000})." >&2
      rueckweg_hinweis >&2
    fi
    exit 1
  fi

  echo
  echo "Warte, bis die App antwortet ..."
  local code
  if code=$(warte_bis_wach); then
    echo "Da ist sie: HTTP $code unter $ADRESSE"
    # Der Claude-Leser im Stand, aber kein Schlüssel IN DER APP: Sie läuft, nur
    # liest niemand Handschrift — still, ohne einen Fehler irgendwo. Einmal
    # sagen, und gefragt wird der Container, nicht die .env.
    schluessel_hinweis "$nachher"
    echo
    echo "Fertig."
  else
    echo >&2
    echo "Sie antwortet nicht (HTTP $code)." >&2
    echo "Erst ins Protokoll sehen:" >&2
    echo "  $(zum_abtippen "$APP" "logs --tail=50 app")" >&2
    echo "Und wenn es nicht offensichtlich ist:" >&2
    rueckweg_hinweis >&2
    exit 1
  fi
}

# -------------------------------------------------------------- zurueck
# Bauen und starten, mit dem Commit als Deployment-ID (Modell 23, Plan A):
# Next hängt sie als `?dpl=` an seine Dateien und lädt bei einem Versatz hart
# neu, statt nach einer Server Action des alten Standes zu suchen. Bisher
# stand hier `up -d --build`; `up` kennt kein `--build-arg`, deshalb erst
# `build`, dann `up`. Im Klon auf dem NAS gibt es `.git`, im Bau-Kontext
# nicht (`.dockerignore`) — deshalb wird die ID hier gelesen und durchgereicht.
bauen_und_starten() {
  local dpl
  dpl=$(git -C "$APP/repo" rev-parse HEAD 2>/dev/null || true)
  ( cd "$APP" && $DC build --build-arg NEXT_DEPLOYMENT_ID="$dpl" && $DC up -d )
}

zurueck() {
  finde_dc
  [ -f "$MERK" ] || { echo "Kein gemerkter Stand da — nichts, wohin zurück." >&2; exit 1; }
  local ziel
  ziel=$(cat "$MERK")
  echo "Zurück auf: $(kurz "$ziel")"
  git -C "$APP/repo" checkout "$ziel" || exit 1
  if ! rueckfall_nehmen "$ziel"; then
    echo "Baue den alten Stand wieder ... (das dauert auf dem NAS mehrere Minuten)"
    bauen_und_starten || {
      echo >&2
      echo "FEHLER: der Bau des alten Standes ging schief." >&2
      if [ -n "$(app_bild)" ]; then
        echo "Im Container läuft weiter, was vorher lief." >&2
      else
        echo "Es läuft gerade gar keine App." >&2
      fi
      echo "Noch einmal versuchen:" >&2
      echo "  sudo $0 zurueck" >&2
      exit 1
    }
  fi
  merke_gebaut "$ziel" ok
  echo
  local code
  if code=$(warte_bis_wach); then
    echo "Wieder da: HTTP $code"
    # Führt der Weg vor den Claude-Leser, liest jener Stand Handschrift nicht
    # selbst. Das tat bis dahin der Postbote, und der liegt stillgelegt
    # daneben. Angeschaltet wird er hier nicht, nur beschrieben: Wer
    # zurückgeht, ist mitten in einer Störung, und ein zweiter Dienst, der von
    # selbst anspringt, ist dort eine Überraschung mehr — zumal er beim
    # nächsten `hoch` wieder aus muss.
    claude_im_stand "$ziel" || postbote_rueckweg_hinweis
    echo
    echo "Du stehst jetzt auf einem abgekoppelten HEAD. Das ist Absicht."
    echo "Der nächste \"hoch\" holt dich von selbst auf main zurück."
  else
    echo "Auch der alte Stand antwortet nicht (HTTP $code) — dann liegt es nicht am Code." >&2
    exit 1
  fi
}

# Für `zurueck` auf einen Stand vor dem 11.10.2026: wie der stillgelegte
# Postbote wiederkommt. Die Sperre muss vorher weg — `docker compose down`
# beendet ihn mit SIGTERM, und dabei bleibt lauf.lock liegen; mit ihr startete
# er nicht. Sie zu löschen ist nur richtig, weil er nicht läuft (am 16.9.2026
# teuer gelernt: einem laufenden die Sperre zu nehmen, erlaubt einen zweiten).
postbote_rueckweg_hinweis() {
  local alt
  alt=$(postbote_stillgelegt)
  echo
  echo "ACHTUNG: Dieser Stand ist älter als der Claude-Leser (11.10.2026) und liest Handschrift nicht selbst."
  echo "Das tat der Postbote; bis er wieder läuft, liest neue Handschrift niemand. Zurückholen:"
  if [ -n "$alt" ]; then
    echo "  sudo mv $alt $POSTBOTE"
  else
    echo "  (keinen Ordner $POSTBOTE.stillgelegt-* gefunden — liegt er woanders, dorthin zurück: $POSTBOTE)"
  fi
  echo "  sudo rm -f $POSTBOTE/harness/lauf.lock"
  echo "  $(zum_abtippen "$POSTBOTE" "up -d")"
  echo "Seine Kopie von harness/ ist die vom Tag des Wechsels und passt zu den Ständen davor (der Code steht auch im Klon unter harness/)."
  echo "Vor dem nächsten \"hoch\" wieder anhalten — sonst hält \"hoch\" an, damit nicht zwei lesen:"
  echo "  $(zum_abtippen "$POSTBOTE" "down")"
}

# ------------------------------------------------------------- postbote
#
# Stillgelegt am 11.10.2026, nicht gelöscht (Entscheidung des Nutzers: „für
# den Fall der Fälle“). Das Wort bleibt, damit ein Finger, der es noch tippt,
# eine Antwort bekommt statt der Hilfe — und weil die Antwort etwas zu sagen
# hat: wo der Postbote liegt und wie er wiederkommt. Angeschaltet wird er hier
# nicht: wer ihn braucht, ist mitten in einer Störung, und der erste Schritt
# des Rückwegs — der App den Schlüssel nehmen — ist einer, den ein Skript
# nicht nebenbei tun soll.
postbote() {
  local alt
  finde_dc
  alt=$(postbote_stillgelegt)
  echo "Der Postbote ist seit dem 11.10.2026 stillgelegt — die App liest Handschrift selbst."
  echo "Ob sie es kann und was sie zuletzt gelesen hat:  sudo $0 stand"
  echo
  echo "Sein Code liegt im Klon unter harness/, der Notfall-Rückweg im README unter „Der Postbote — stillgelegt, und der Rückweg im Notfall“."
  echo "NIE ZUGLEICH MIT DEM API-LESER — erst die App ohne Schlüssel, dann der Postbote:"
  echo "  1. ANTHROPIC_API_KEY aus $APP/.env nehmen (Zeile löschen), dann  $(zum_abtippen "$APP" "up -d app")"
  echo "     und mit  sudo $0 stand  nachsehen: „Schlüssel: FEHLT“."
  if [ -n "$alt" ]; then
    echo "  2. sudo mv $alt $POSTBOTE"
  else
    echo "  2. (keinen Ordner $POSTBOTE.stillgelegt-* gefunden — liegt er woanders, dorthin zurück: $POSTBOTE)"
  fi
  echo "  3. sudo rm -f $POSTBOTE/harness/lauf.lock"
  echo "  4. $(zum_abtippen "$POSTBOTE" "up -d")"
  echo "Nach einem \"zurueck\" auf einen Stand vor dem 11.10.2026 entfällt Schritt 1: jener Stand liest nicht selbst."
  exit 1
}

case "${1:-}" in
  stand)    stand ;;
  hoch)     hoch ;;
  zurueck)  zurueck ;;
  postbote) postbote ;;
  *)
    echo "Die Schulapp vom Handy aus bedienen."
    echo
    echo "  sudo $0 stand      Was ist live? Ändert nichts. Auch: Schlüssel und Läufe des Claude-Lesers."
    echo "  sudo $0 hoch       Neuen Stand holen, bauen, starten, nachsehen."
    echo "  sudo $0 zurueck    Auf den Stand vor dem letzten \"hoch\"."
    echo "  sudo $0 postbote   Stillgelegt (11.10.2026) — sagt, wo er liegt und wie er im Notfall wiederkommt."
    exit 1 ;;
esac
