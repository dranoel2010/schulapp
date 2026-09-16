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
#   hoch       Neuen Stand von GitHub holen, bauen, starten, nachsehen.
#   zurueck    Auf den Stand vor dem letzten `hoch` zurück.
#   postbote   Den Postboten anschalten (räumt die Sperre vorher weg).
#
set -u

APP=/volume1/docker/schulapp
POST=/volume1/docker/postbote
MERK="$APP/.letzter-stand"
ADRESSE=https://treskownas.tail3a40b0.ts.net

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

erreichbar_aussen() {
  curl -4 -s -o /dev/null -w "%{http_code}" --max-time 15 "$ADRESSE/" 2>/dev/null || true
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
  else
    echo "(kein Klon unter $APP/repo gefunden)"
  fi

  if [ -f "$MERK" ]; then
    echo "Rückweg: $(cat "$MERK")   (per \"zurueck\" erreichbar)"
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
  local ci ca
  ci=$(erreichbar_innen); ca=$(erreichbar_aussen)
  echo "innen  (127.0.0.1:3000) -> HTTP ${ci:-000}$(gut "$ci" && echo "  ok" || echo "  ACHTUNG")"
  echo "außen  (Funnel)         -> HTTP ${ca:-000}$(gut "$ca" && echo "  ok" || echo "  ACHTUNG")"
}

# ----------------------------------------------------------------- hoch
hoch() {
  finde_dc
  [ -d "$APP/repo/.git" ] || { echo "FEHLER: kein Klon unter $APP/repo" >&2; exit 1; }

  # Wo stehen wir? Das ist der Rückweg, und er wird VOR allem anderen gemerkt.
  local vorher
  vorher=$(git -C "$APP/repo" rev-parse HEAD) || exit 1
  echo "Jetziger Stand: $(git -C "$APP/repo" log -1 --format='%h %s')"

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

  local nachher
  nachher=$(git -C "$APP/repo" rev-parse HEAD)
  if [ "$vorher" = "$nachher" ]; then
    echo "Nichts Neues — der Stand war schon aktuell. Baue trotzdem nicht neu."
    exit 0
  fi

  echo "$vorher" > "$MERK"
  echo
  echo "Neu dazugekommen:"
  git -C "$APP/repo" log --oneline "$vorher..$nachher" | sed 's/^/  /'
  echo

  echo "Nagle den laufenden Stand fest ..."
  sichere_bild

  echo "Baue und starte ... (das dauert auf dem NAS mehrere Minuten)"
  ( cd "$APP" && $DC up -d --build ) || {
    echo >&2
    echo "FEHLER: der Bau ging schief. Der alte Container läuft meistens weiter." >&2
    echo "Zurück auf den Stand von vorher:  sudo $0 zurueck" >&2
    exit 1
  }

  echo
  echo "Warte, bis die App antwortet ..."
  local code
  if code=$(warte_bis_wach); then
    echo "Da ist sie: HTTP $code unter $ADRESSE"
    echo "Fertig."
  else
    echo >&2
    echo "Sie antwortet nicht (HTTP $code)." >&2
    echo "Erst ins Protokoll sehen:" >&2
    echo "  cd $APP && $DC logs --tail=50" >&2
    echo "Und wenn es nicht offensichtlich ist, zurück:" >&2
    echo "  sudo $0 zurueck        (baut den alten Stand neu, dauert)" >&2
    echo "Schneller, falls oben ein Rückfallbild gesetzt wurde:" >&2
    echo "  docker images | grep rueckfall     dann das Bild zurücktaggen" >&2
    echo "  und  cd $APP && $DC up -d          ohne --build" >&2
    exit 1
  fi
}

# -------------------------------------------------------------- zurueck
zurueck() {
  finde_dc
  [ -f "$MERK" ] || { echo "Kein gemerkter Stand da — nichts, wohin zurück." >&2; exit 1; }
  local ziel
  ziel=$(cat "$MERK")
  echo "Zurück auf: $(git -C "$APP/repo" log -1 --format='%h %s' "$ziel" 2>/dev/null || echo "$ziel")"
  git -C "$APP/repo" checkout "$ziel" || exit 1
  echo "Baue den alten Stand wieder ..."
  ( cd "$APP" && $DC up -d --build ) || exit 1
  echo
  local code
  if code=$(warte_bis_wach); then
    echo "Wieder da: HTTP $code"
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
  echo "Steht da \"Not logged in\":  cd $POST && $DC run --rm -it postbote claude   (darin: /login)"
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
    echo "  sudo $0 hoch       Neuen Stand holen, bauen, starten."
    echo "  sudo $0 zurueck    Auf den Stand vor dem letzten \"hoch\"."
    echo "  sudo $0 postbote   Postbote anschalten (Sperre wird weggeräumt)."
    exit 1 ;;
esac
