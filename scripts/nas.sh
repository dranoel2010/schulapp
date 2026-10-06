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
#   stand      Was ist gerade live? Ändert nichts. Das meistgebrauchte.
#   hoch       Neuen Stand von GitHub holen, bauen, starten, nachsehen —
#              und danach die Harness-Kopie des Postboten angleichen, denn
#              App und Postbote wechseln zusammen. Ging der Bau schief, baut
#              das nächste `hoch` nach. Fehlt der Datenbank eine Spalte, die
#              der neue Stand braucht, hält es VOR dem Bau an und nennt die
#              Zeile, die sie anlegt.
#   zurueck    Auf den Stand vor dem letzten `hoch` zurück — mit dem
#              Rückfallbild in Sekunden, ohne es per Neubau. Der Postbote
#              geht mit zurück (seine Kopie wird an den alten Stand
#              angeglichen).
#   postbote   Den Postboten anschalten (räumt die Sperre vorher weg).
#
set -u

APP=/volume1/docker/schulapp
POST=/volume1/docker/postbote
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
  ( cd "$POST" 2>/dev/null && $DC ps 2>/dev/null ) || echo "(Postbote nicht lesbar)"

  echo
  echo "=== Postbote ==="
  local pcid plaeuft
  pcid=$( cd "$POST" && $DC ps -q postbote 2>/dev/null | head -1 )
  plaeuft="nein"
  [ -n "$pcid" ] && [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$pcid" 2>/dev/null)" = "true" ] && plaeuft="ja"

  # Eine Sperre ist nur dann ein Fund, wenn NIEMAND läuft. Läuft der Dienst,
  # hält er sie die ganze Zeit — das ist der Normalfall und kein Fehler.
  if [ -f "$POST/harness/lauf.lock" ]; then
    if [ "$plaeuft" = "ja" ]; then
      echo "Sperre:  gehört dem laufenden Dienst (Nummer $(cat "$POST/harness/lauf.lock" 2>/dev/null)) — in Ordnung"
    else
      echo "Sperre:  LIEGENGEBLIEBEN (Nummer $(cat "$POST/harness/lauf.lock" 2>/dev/null)) — \"postbote\" räumt sie weg"
    fi
  else
    echo "Sperre:  keine"
  fi
  echo "Läuft:   $plaeuft"
  if [ -f "$POST/harness/gesehen.json" ]; then
    echo "Zuletzt gearbeitet: $(date -r "$POST/harness/gesehen.json" '+%d.%m.%Y %H:%M' 2>/dev/null)"
  fi

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
PFLICHTSPALTEN="material_pages leser scripts/leser-tabellen.sql"

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
# zweite `hoch` Erfolg, gliche den Postboten an, und der scheiterte danach in
# jeder Runde an read_inbox.
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
          echo "Gebaut wird nichts; bis die Spalte da ist, scheitert jede Seite. Den Postboten gleiche ich nicht an." >&2
        else
          echo "HALT: Der Datenbank fehlt $tabelle.$spalte — der neue Stand braucht sie." >&2
          echo "Gebaut ist nichts, die App läuft weiter wie bisher." >&2
        fi
        echo >&2
        echo "Vorher sichern und zählen — die Zählzeilen stehen im Kopf von $datei," >&2
        echo "die ganze Reihenfolge im README. Dann einspielen, in einer Transaktion, mit" >&2
        echo "Abbruch beim ersten Fehler und mit Benutzer und Datenbank aus dem db-Container:" >&2
        echo "  sudo sh -c 'cd $APP && $DC exec -T db psql -X -v ON_ERROR_STOP=1 --single-transaction -U $benutzer -d $datenbank -f - < repo/$datei'" >&2
        if [ "${2:-}" = "laeuft" ]; then
          echo "Danach noch einmal:  sudo $0 hoch   — es gleicht dann den Postboten an." >&2
        else
          echo "Danach noch einmal:  sudo $0 hoch   — es baut dann nach." >&2
        fi
        postbote_aus_hinweis
        return 1 ;;
      *)
        echo "(Ob $tabelle.$spalte da ist, ließ sich nicht nachsehen — die Datenbank antwortet nicht."
        echo " Ich mache trotzdem weiter. Fehlt sie, scheitert danach jede Seite: dann $datei einspielen.)" ;;
    esac
  done <<< "$PFLICHTSPALTEN"
  return 0
}

# Ist der Postbote aus, ein Satz dazu. README „Auf das NAS bringen“ hält ihn
# vor dem Wechsel an, und erst ein `hoch`, das durchgeht, startet ihn wieder —
# scheitert es vorher (HALT, Bau, App antwortet nicht), stünde sonst nirgends,
# dass neue Fotos bis auf Weiteres niemand liest. Seine Kopie ist dann nicht
# angeglichen, passt also zur App, die vorher lief.
postbote_aus_hinweis() {
  [ -d "$POST" ] || return 0
  postbote_laeuft && return 0
  echo >&2
  echo "Der Postbote ist aus. Seine Kopie passt zur App von vorher — wieder an, solange die läuft:" >&2
  echo "  sudo $0 postbote      (ein hoch, das durchgeht, startet ihn ohnehin)" >&2
}

# ------------------------------------------------- Postbote angleichen
#
# Wo der Postbote läuft, liegt eine KOPIE von harness/ und kein Klon
# ($POST/harness, siehe harness/README.md) — `git pull` rührt sie nicht an.
# Bis zum 6.10.2026 war das ein Handgriff nach jedem Commit, und vergessen
# kostete schon einmal sieben Tage. Seit „ein Leser je Seite“ müssen App und
# Postbote zusammen wechseln: die App entscheidet, welche Seiten Claude liest,
# und der Auftrag des Postboten muss es wissen. Deshalb gleicht `hoch` die
# Kopie selbst an, sobald die neue App antwortet — und `zurueck` ebenso an
# den alten Stand, sobald der wieder antwortet.
#
# Verglichen und kopiert wird, was scripts/jev-und-docling.sh in Schritt 6
# kopiert: *.mts und README.md aus dem Klon. zugang.json, gesehen.json und
# lauf.lock liegen im selben Ordner und werden beim Kopieren nie angefasst —
# der Zugang ist neunzig Tage lang der Schlüssel zur App, die Merkliste das
# Gedächtnis des Postboten.
#
# Erst anhalten, dann kopieren, dann starten: ein Postbote, der während des
# Kopierens einen Lauf beginnt, liefe mit halb alten, halb neuen Dateien. Ein
# Blatt, das er beim Anhalten gerade las, kommt in der nächsten Runde wieder
# dran. Gestartet wird über `postbote`, das die nach `docker stop`
# liegengebliebene Sperre wegräumt.
#
# Geht das Kopieren schief, kommt die alte Fassung aus der Sicherung zurück,
# und der Postbote läuft mit ihr weiter — der alte Postbote verträgt die neue
# App. Die App bleibt in jedem Fall, wie sie ist.

# harness_summen <ordner> — md5sum, sortiert, über die Dateien, die der KLON
# hat (*.mts und README.md), jede in <ordner> gelesen; fehlt dort eine, steht
# „fehlt“ da. Über die Liste des Klons und nicht über das, was im Ordner
# liegt: Verschwindet eine Datei aus dem Repo, bliebe ihre alte Kopie beim
# Postboten liegen, die Summen wären nie gleich, und jedes `hoch` endete mit
# einem Fehler. Der Postbote lädt nur, was sein Code importiert — eine
# liegengebliebene Datei stört ihn nicht.
harness_summen() {
  local f
  ( cd "$APP/repo/harness" 2>/dev/null && ls *.mts README.md 2>/dev/null ) | while read -r f; do
    if [ -f "$1/$f" ]; then ( cd "$1" && md5sum "$f" ); else echo "fehlt  $f"; fi
  done | sort
}

# Läuft der Postbote-Container? Gefragt wird Docker — `ps` auf dem Synology
# sieht Container-Prozesse nicht (siehe postbote() unten).
postbote_laeuft() {
  local cid
  cid=$( cd "$POST" 2>/dev/null && $DC ps -q postbote 2>/dev/null | head -1 )
  [ -n "$cid" ] && [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" = "true" ]
}

harness_abgleichen() {
  local quelle="$APP/repo/harness" ziel="$POST/harness"
  echo
  echo "Postbote: vergleiche $ziel mit dem Klon ..."

  if [ ! -d "$ziel" ]; then
    echo "Kein $ziel — der Postbote läuft nicht auf diesem NAS. Nichts anzugleichen."
    return 0
  fi
  # Ohne md5sum wären beide Summen leer und damit „gleich“ — ein stilles Ja.
  if ! command -v md5sum >/dev/null 2>&1; then
    echo "FEHLER: md5sum fehlt — ohne Prüfsummen gleiche ich nicht ab." >&2
    echo "Von Hand, wie unter „Der Handgriff nach jedem Commit“ in harness/README.md." >&2
    return 1
  fi

  local soll
  soll=$(harness_summen "$quelle")
  if [ -z "$soll" ]; then
    echo "FEHLER: Im Klon unter $quelle liegt kein Harness." >&2
    return 1
  fi
  if [ "$soll" = "$(harness_summen "$ziel")" ]; then
    echo "Die Kopie ist schon aktuell."
    postbote_laeuft || echo "Er läuft allerdings nicht. Anschalten:  sudo $0 postbote"
    return 0
  fi

  local alt
  alt="$POST/harness-alt-$(date +%Y%m%d-%H%M%S)"
  mkdir -p "$alt" && cp -p "$ziel"/*.mts "$ziel"/README.md "$alt"/ 2>/dev/null
  if ! ls "$alt"/*.mts >/dev/null 2>&1; then
    echo "FEHLER: Die Sicherung nach $alt ging nicht — ich kopiere nichts." >&2
    return 1
  fi
  echo "Sicherung: $alt"

  echo "Halte den Postboten an ..."
  if ! ( cd "$POST" && $DC stop postbote ); then
    echo "FEHLER: Er ließ sich nicht anhalten — kopiert ist nichts, er läuft wie vorher." >&2
    return 1
  fi

  # Auf vorhandene Dateien kopiert, behalten sie Eigentümer und Rechte — der
  # Postbote läuft nicht als root und muss sie lesen können.
  if cp "$quelle"/*.mts "$quelle"/README.md "$ziel"/ \
     && [ "$soll" = "$(harness_summen "$ziel")" ]; then
    echo "Kopiert und verglichen: $(printf '%s\n' "$soll" | wc -l | tr -d ' ') Dateien gleich mit dem Klon."
    postbote
    echo
    echo "Rückweg nur für den Postboten, falls nötig:"
    echo "  $(zum_abtippen "$POST" "stop postbote")"
    echo "  sudo sh -c 'cp -p $alt/* $ziel/'   und   sudo $0 postbote"
    return 0
  fi

  echo >&2
  echo "FEHLER: Kopieren ging schief, oder die Prüfsummen weichen danach ab." >&2
  if cp -p "$alt"/* "$ziel"/; then
    echo "Die alte Fassung liegt wieder dort; der Postbote startet mit ihr." >&2
  else
    echo "Auch das Zurücklegen ging nicht. Von Hand:  sudo sh -c 'cp -p $alt/* $ziel/'" >&2
  fi
  postbote
  return 1
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
    # Der Postbote kann trotzdem hinterherhinken: Kam der neue Stand mit einer
    # älteren Kopie dieses Skripts aufs NAS, die den Abgleich noch nicht
    # kannte, holt das nächste `hoch` ihn hier nach. Nur bei einer App, die
    # antwortet — der neue Postbote gehört zur neuen App, nicht zu einer, die
    # gerade nicht läuft. Und erst nach einem Blick in die Datenbank: `/`
    # antwortet ohne Anmeldung auch dann, wenn jede Seite an einer fehlenden
    # Spalte scheitert (spalten_pruefen, „laeuft“).
    if gut "$(erreichbar_innen)"; then
      spalten_pruefen "$nachher" laeuft || exit 1
      harness_abgleichen || exit 1
    else
      echo "Die App antwortet gerade nicht — den Postboten gleiche ich erst an, wenn sie läuft."
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
  ( cd "$APP" && $DC up -d --build ) || bau="schief"
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
    postbote_aus_hinweis
    exit 1
  fi

  echo
  echo "Warte, bis die App antwortet ..."
  local code
  if code=$(warte_bis_wach); then
    echo "Da ist sie: HTTP $code unter $ADRESSE"
    if ! harness_abgleichen; then
      echo >&2
      echo "Die App läuft auf dem neuen Stand — nur der Postbote ist nicht angeglichen (siehe oben)." >&2
      exit 1
    fi
    echo
    echo "Fertig."
  else
    echo >&2
    echo "Sie antwortet nicht (HTTP $code)." >&2
    echo "Erst ins Protokoll sehen:" >&2
    echo "  $(zum_abtippen "$APP" "logs --tail=50 app")" >&2
    echo "Und wenn es nicht offensichtlich ist:" >&2
    rueckweg_hinweis >&2
    postbote_aus_hinweis
    exit 1
  fi
}

# -------------------------------------------------------------- zurueck
zurueck() {
  finde_dc
  [ -f "$MERK" ] || { echo "Kein gemerkter Stand da — nichts, wohin zurück." >&2; exit 1; }
  local ziel
  ziel=$(cat "$MERK")
  echo "Zurück auf: $(kurz "$ziel")"
  git -C "$APP/repo" checkout "$ziel" || exit 1
  if ! rueckfall_nehmen "$ziel"; then
    echo "Baue den alten Stand wieder ... (das dauert auf dem NAS mehrere Minuten)"
    ( cd "$APP" && $DC up -d --build ) || {
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
    # App und Postbote wechseln zusammen — auch zurück. Der Klon steht jetzt
    # auf dem alten Stand, also gleicht derselbe Abgleich wie bei `hoch` die
    # Harness-Kopie an dessen harness/ an (die neue liegt danach als
    # harness-alt-<Zeit> daneben). Ohne das liefe der neue Postbote gegen die
    # alte App: deren Verzeichnis bietet ein Werkzeug an, das sein Käfig nicht
    # erlaubt, und ein verweigerter Aufruf macht den ganzen Lauf zu „nichts“ —
    # das Blatt wäre gemerkt und bliebe ungelesen im Korb.
    if ! harness_abgleichen; then
      echo >&2
      echo "Die App läuft wieder auf dem alten Stand — nur der Postbote ist nicht angeglichen (siehe oben)." >&2
      exit 1
    fi
    echo
    echo "Du stehst jetzt auf einem abgekoppelten HEAD. Das ist Absicht."
    echo "Der nächste \"hoch\" holt dich von selbst auf main zurück."
  else
    echo "Auch der alte Stand antwortet nicht (HTTP $code) — dann liegt es nicht am Code." >&2
    exit 1
  fi
}

# ------------------------------------------------------------- postbote
#
# WICHTIG, und am 16.9.2026 teuer gelernt: `lauf.lock` ist NICHT immer Müll.
# Läuft der Postbote als Dienst, dann hält er sie die ganze Zeit — genau so
# steht es in harness/README.md. Sie zu entfernen, während er läuft, erlaubt
# einen zweiten Postboten, und dann liegen zwei Vorschläge am selben Blatt.
#
# Container-Prozesse tauchen im `ps` des Synology-Hosts nicht auf. Ein Blick
# dorthin sagt also NICHT, ob er läuft — gefragt wird Docker, sonst niemand.
postbote() {
  finde_dc

  local cid laeuft
  cid=$( cd "$POST" && $DC ps -q postbote 2>/dev/null | head -1 )
  laeuft="nein"
  if [ -n "$cid" ] && [ "$("$DOCKER" inspect -f '{{.State.Running}}' "$cid" 2>/dev/null)" = "true" ]; then
    laeuft="ja"
  fi

  if [ "$laeuft" = "ja" ]; then
    echo "Der Postbote läuft bereits — seit $("$DOCKER" inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null | cut -c1-16)."
    echo "Die Sperre gehört ihm; ich fasse sie nicht an."
    echo
    ( cd "$POST" && $DC ps )
    echo
    echo "--- letzte Zeilen ---"
    ( cd "$POST" && $DC logs --tail=15 postbote 2>&1 ) || true
    echo
    echo "Leere Runden schreiben nichts. Kein Eintrag heißt: nichts zu tun."
    return 0
  fi

  # Er läuft NICHT. Erst jetzt ist eine liegengebliebene Sperre wirklich Müll:
  # `docker stop` schickt SIGTERM, Node führt keine exit-Handler mehr aus.
  if [ -f "$POST/harness/lauf.lock" ]; then
    echo "Er läuft nicht, aber eine Sperre liegt da (Nummer $(cat "$POST/harness/lauf.lock" 2>/dev/null)) — entfernt."
    rm -f "$POST/harness/lauf.lock"
  else
    echo "Er läuft nicht, und es liegt keine Sperre herum."
  fi

  ( cd "$POST" && $DC up -d ) || exit 1
  sleep 8
  echo
  ( cd "$POST" && $DC ps )
  echo
  echo "--- letzte Zeilen ---"
  ( cd "$POST" && $DC logs --tail=25 postbote 2>&1 ) || true
  echo
  echo "Gut ist es, wenn oben \"Postbote wach.\" steht."
  echo "Steht da \"Not logged in\":  $(zum_abtippen "$POST" "run --rm -it postbote claude")   (darin: /login)"
}

case "${1:-}" in
  stand)    stand ;;
  hoch)     hoch ;;
  zurueck)  zurueck ;;
  postbote) postbote ;;
  *)
    echo "Die Schulapp vom Handy aus bedienen."
    echo
    echo "  sudo $0 stand      Was ist live? Ändert nichts."
    echo "  sudo $0 hoch       Neuen Stand holen, bauen, starten, Postbote angleichen."
    echo "  sudo $0 zurueck    Auf den Stand vor dem letzten \"hoch\", Postbote mit."
    echo "  sudo $0 postbote   Postbote anschalten (Sperre wird weggeräumt)."
    exit 1 ;;
esac
