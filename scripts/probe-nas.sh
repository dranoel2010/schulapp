#!/bin/bash
# shellcheck disable=SC1111  # „…“ sind deutsche Anführungszeichen, mit Absicht
#
# Eine Probe für die Frage, die `nas.sh hoch` vor dem Claude-Leser stellt:
# Lesen danach zwei — die App mit Schlüssel und ein Postbote? (11.10.2026)
#
# Warum es sie gibt: Ein falsches JA hält `hoch` mit dem Rat `docker stop`
# an, und wer ihm folgt, hat danach niemanden mehr, der Handschrift liest. Ein
# falsches NEIN lässt zwei lesen, und das zweite Lesen ist bezahlt. Beides
# sieht man erst auf dem NAS — hier steht ein nachgemachtes daneben: ein
# Ordner unter mktemp, ein `docker`, das nur die Fragen beantwortet, die
# nas.sh stellt, ein echtes git mit einem Klon, der den Claude-Leser hat, und
# nas.sh selbst, ohne seine letzte Zeile (das `case`), mit den festen Pfaden
# auf den nachgemachten Ordner umgebogen.
#
#   bash scripts/probe-nas.sh                 # prüft scripts/nas.sh
#   bash scripts/probe-nas.sh <pfad/nas.sh>   # prüft eine andere Fassung
#
# Nichts davon geht ins Netz oder auf ein echtes Docker. Gelaufen am
# 11.10.2026: gegen den Stand vor der Nachprüfung 10 von 15 (der Zweig
# „Nichts Neues“ hielt mit `docker stop` an, auch wenn die App gar nicht zu
# fragen war, und der Hinweis nannte den falschen Grund), danach 15 von 15.
#
# Abschnitt 6 fragt etwas anderes, und zwar die ALTE Kopie von nas.sh, die
# bis zu ihrem Austausch noch auf dem NAS liegt: startet ihr Abgleich von
# harness/ den stillgelegten Postboten neu? Geprüft wird harness/ dieses
# Repos (oder der Ordner in HARNESS=…) gegen das, was der Postbote zuletzt
# bekam. Am selben Tag nachgeholt: mit dem Kasten „Stillgelegt“ in
# harness/README.md hielt sie ihn an und startete ihn (16 von 19), ohne ihn
# nicht mehr — 19 von 19.
set -u

NAS_SH=${1:-"$(cd "$(dirname "$0")" && pwd)/nas.sh"}
[ -f "$NAS_SH" ] || { echo "Keine nas.sh unter $NAS_SH" >&2; exit 1; }
REPO=$(cd "$(dirname "$0")/.." && pwd)
HARNESS=${HARNESS:-"$REPO/harness"}

WURZEL=$(mktemp -d "${TMPDIR:-/tmp}/probe-nas.XXXXXX")
trap 'rm -rf "$WURZEL"' EXIT

fehler=0
proben=0
pruefe() {
  proben=$((proben + 1))
  if [ "$2" = ja ]; then
    echo "  ✓ $1"
  else
    fehler=$((fehler + 1))
    echo "  ✗ $1"
    [ -n "${3:-}" ] && printf '%s\n' "$3" | sed 's/^/      /'
  fi
}
enthaelt() { printf '%s' "$1" | grep -qF -- "$2" && echo ja || echo nein; }
fehlt() { printf '%s' "$1" | grep -qF -- "$2" && echo nein || echo ja; }

# ── Das nachgemachte NAS ────────────────────────────────────────────────────

APP="$WURZEL/schulapp"
mkdir -p "$APP" "$WURZEL/bin" "$WURZEL/origin"

# Ein Klon mit dem Claude-Leser, und sein „GitHub“ daneben — `hoch` zieht von
# dort, und es kommt nichts Neues.
git -C "$WURZEL/origin" init -q -b main
mkdir -p "$WURZEL/origin/src/lib/claude"
echo "// erfunden" > "$WURZEL/origin/src/lib/claude/client.ts"
git -C "$WURZEL/origin" add -A
git -C "$WURZEL/origin" -c user.name=probe -c user.email=probe@example.invalid commit -q -m leser
git clone -q "$WURZEL/origin" "$APP/repo"
STAND=$(git -C "$APP/repo" rev-parse HEAD)

# Docker beantwortet genau zwei Fragen: läuft ein Postbote, und hat die
# laufende App den Schlüssel (ja/nein, wie node im Container es schreibt).
cat > "$WURZEL/bin/docker" <<'DOCKER'
#!/bin/bash
case "$*" in
  "compose version") echo "Docker Compose version v2-probe" ;;
  "ps -q --filter label=com.docker.compose.service=postbote") printf '%s' "${PROBE_POSTBOTE:-}" ;;
  compose\ exec\ -T\ app\ node*)
    [ "${PROBE_CONTAINER:-nein}" = fehlt ] && { echo "service app is not running" >&2; exit 1; }
    printf '%s' "${PROBE_CONTAINER:-nein}" ;;
  *) echo "probe-docker: $*" >&2 ;;
esac
DOCKER
chmod +x "$WURZEL/bin/docker"

# nas.sh ohne seinen Aufruf am Ende, mit den Pfaden des nachgemachten NAS, und
# mit dem, was ein echtes NAS bräuchte, als Antwort: die App läuft, antwortet,
# ihre Spalten sind da, gebaut ist der Stand im Klon.
SKRIPT="$WURZEL/nas.sh"
{
  sed -e '/^case "\${1:-}" in/,$d' \
      -e "s#^APP=.*#APP=$APP#" \
      -e "s#^POSTBOTE=.*#POSTBOTE=$WURZEL/postbote#" "$NAS_SH"
  cat <<STUBS
finde_dc() { DOCKER="$WURZEL/bin/docker"; DC="\$DOCKER compose"; }
lies_gebaut() { GEB_COMMIT=$STAND; GEB_SICHER=ja; }
app_bild() { echo "bild-probe schulapp-app"; }
erreichbar_innen() { echo 200; }
spalten_pruefen() { return 0; }
neue_fassung_melden() { :; }
STUBS
} > "$SKRIPT"

# Umgebung des nachgemachten NAS: .env und Override-Datei, je nach Fall.
nas() {
  local env=$1 override=$2
  : > "$APP/.env"
  [ "$env" = ja ] && echo "ANTHROPIC_API_KEY=sk-ant-erfunden" > "$APP/.env"
  # In der Form, die jev-und-docling.sh anlegt und claude-einrichten.sh ergänzt.
  printf 'services:\n  app:\n    environment:\n      DOCLING_URL: http://docling:5001\n' > "$APP/docker-compose.override.yml"
  [ "$override" = ja ] && echo '      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}' >> "$APP/docker-compose.override.yml"
}

# Ein Aufruf von `hoch` im Zweig „Nichts Neues“, oder einer einzelnen Funktion.
hoch() {
  ( bash -c ". '$SKRIPT'; hoch" ) 2>&1
}
funktion() {
  ( bash -c ". '$SKRIPT'; finde_dc; $*" ) 2>&1
}

export PROBE_POSTBOTE PROBE_CONTAINER

# ── Die Fälle ───────────────────────────────────────────────────────────────

echo
echo "── 1. Nichts Neues: claude-einrichten.sh hielt nach Schritt 3 an ──"
# .env und Override haben den Schlüssel, die laufende App ist die alte und hat
# ihn nicht, der Postbote liest. Nichts wird gebaut oder neu erzeugt.
nas ja ja
PROBE_POSTBOTE=postbote123 PROBE_CONTAINER=nein
aus=$(hoch); rc=$?
pruefe "kein HALT, Rückgabe 0" "$([ $rc = 0 ] && fehlt "$aus" "HALT")" "$aus"
pruefe "kein Rat, den Postboten anzuhalten" "$(fehlt "$aus" "docker stop")" "$aus"
pruefe "sagt NICHT anhalten und nennt claude-einrichten.sh" "$(enthaelt "$aus" "NICHT anhalten")" "$aus"
pruefe "der Hinweis nennt den wahren Grund: nicht neu erzeugt" "$(enthaelt "$aus" "nicht neu erzeugt")" "$aus"
pruefe "und nicht den falschen: reicht nicht durch" "$(fehlt "$aus" "reicht ANTHROPIC_API_KEY nicht durch")" "$aus"

echo
echo "── 2. Nichts Neues: die laufende App hat den Schlüssel, und ein Postbote liest ──"
PROBE_CONTAINER=ja
aus=$(hoch); rc=$?
pruefe "HALT mit Rückgabe 1 — es lesen gerade zwei" "$([ $rc = 1 ] && enthaelt "$aus" "HALT")" "$aus"
pruefe "und der Rat, den Postboten anzuhalten" "$(enthaelt "$aus" "docker stop postbote123")" "$aus"

echo
echo "── 3. Nichts Neues: die App ist nicht zu fragen ──"
PROBE_CONTAINER=fehlt
aus=$(hoch); rc=$?
pruefe "kein HALT, aber der Weg zu „stand“" "$([ $rc = 0 ] && fehlt "$aus" "HALT")" "$aus"

echo
echo "── 4. Ein neuer Stand wird gebaut ──"
# Vor dem Bau zählt auch, was ein NEU erzeugter Container bekäme.
nas ja ja
PROBE_POSTBOTE=postbote123 PROBE_CONTAINER=nein
aus=$(funktion zwei_leser_pruefen "$STAND"); rc=$?
pruefe "neu gebaut bekäme die App den Schlüssel: HALT" "$([ $rc = 1 ] && enthaelt "$aus" "die neue App bekäme")" "$aus"
nas ja nein
aus=$(funktion zwei_leser_pruefen "$STAND"); rc=$?
pruefe "nur in der .env: kein HALT, nicht anhalten" "$([ $rc = 0 ] && enthaelt "$aus" "NICHT anhalten")" "$aus"
nas nein nein
aus=$(funktion zwei_leser_pruefen "$STAND"); rc=$?
pruefe "ohne Schlüssel: kein HALT" "$([ $rc = 0 ] && fehlt "$aus" "HALT")" "$aus"
PROBE_POSTBOTE=""
nas ja ja
PROBE_CONTAINER=ja
aus=$(funktion zwei_leser_pruefen "$STAND"); rc=$?
pruefe "ohne Postbote: nichts zu sagen" "$([ $rc = 0 ] && [ -z "$aus" ] && echo ja || echo nein)" "$aus"

echo
echo "── 5. Der Hinweis nach dem Bau ──"
PROBE_CONTAINER=nein
nas ja nein
aus=$(funktion schluessel_hinweis "$STAND")
pruefe "nur in der .env: die Override-Datei reicht ihn nicht durch" "$(enthaelt "$aus" "reicht ANTHROPIC_API_KEY nicht durch")" "$aus"
nas nein nein
aus=$(funktion schluessel_hinweis "$STAND")
pruefe "gar kein Schlüssel: einrichten" "$(enthaelt "$aus" "erst mit einem Schlüssel")" "$aus"
PROBE_CONTAINER=ja
aus=$(funktion schluessel_hinweis "$STAND")
pruefe "die App hat ihn: kein Wort" "$([ -z "$aus" ] && echo ja || echo nein)" "$aus"

echo
echo "── 6. Ein altes ~/nas.sh gleicht harness/ ab — und startet den Postboten nicht ──"
# Bis Schritt 2 der Reihenfolge im README („Auf das NAS bringen“) liegt auf
# dem NAS die Kopie von nas.sh vor dem Claude-Leser. Ihr `hoch` vergleicht
# die Prüfsummen von harness/*.mts und harness/README.md im Klon mit der
# Kopie beim Postboten, und weichen sie ab, hält sie ihn an, kopiert und
# startet ihn — auch einen, der gar nicht lief. Am 11.10.2026 so gesehen, als
# harness/README.md einen Kasten „Stillgelegt“ bekam; der steht seitdem im
# README, und harness/ bleibt Byte für Byte, wie es war.
#
# Die alte Kopie ist nas.sh aus ALT, dem letzten Stand mit
# `harness_abgleichen` (6.10.2026, „Jede Seite liest genau einer“, bis zum
# Claude-Leser unverändert). Beim Postboten liegt harness/ aus demselben
# Stand: das ist, was sie zuletzt dorthin kopiert hat.
ALT=e21e4f1
ALT_SH="$WURZEL/alt-nas.sh"
POST="$WURZEL/postbote"
AUFRUFE="$WURZEL/compose-aufrufe"
if ! git -C "$REPO" cat-file -e "$ALT:scripts/nas.sh" 2>/dev/null; then
  pruefe "der alte Stand $ALT ist im Repo" nein "git cat-file -e $ALT:scripts/nas.sh"
else
  mkdir -p "$POST/harness" "$WURZEL/klon/repo"
  git -C "$REPO" archive "$ALT" harness | tar -x -C "$POST"
  # Ein Docker, das nur mitschreibt: der Postbote läuft (noch) nicht.
  cat > "$WURZEL/bin/alt-docker" <<DOCKER
#!/bin/bash
echo "\$*" >> "$AUFRUFE"
exit 0
DOCKER
  chmod +x "$WURZEL/bin/alt-docker"
  # md5sum fehlt auf älteren Macs; md5 -r schreibt dieselbe Zeile anders, und
  # verglichen wird nur mit sich selbst.
  if ! command -v md5sum >/dev/null 2>&1; then
    printf '#!/bin/sh\nexec md5 -r "$@"\n' > "$WURZEL/bin/md5sum"
    chmod +x "$WURZEL/bin/md5sum"
  fi
  {
    git -C "$REPO" show "$ALT:scripts/nas.sh" | sed -e '/^case "\${1:-}" in/,$d' \
      -e "s#^APP=.*#APP=$WURZEL/klon#" -e "s#^POST=.*#POST=$POST#"
    cat <<STUBS
finde_dc() { DOCKER="$WURZEL/bin/alt-docker"; DC="\$DOCKER compose"; }
sleep() { :; }
STUBS
  } > "$ALT_SH"

  # Der Klon nach dem Pull: harness/ so, wie dieser Stand es hat.
  abgleich() {
    rm -rf "$WURZEL/klon/repo/harness" && cp -R "$1" "$WURZEL/klon/repo/harness"
    : > "$AUFRUFE"
    ( PATH="$WURZEL/bin:$PATH" bash -c ". '$ALT_SH'; finde_dc; harness_abgleichen" ) 2>&1
  }

  aus=$(abgleich "$HARNESS")
  pruefe "die alte Kopie findet harness/ unverändert: „schon aktuell“" "$(enthaelt "$aus" "Die Kopie ist schon aktuell.")" "$aus"
  pruefe "sie hält den Postboten nicht an" "$(fehlt "$(cat "$AUFRUFE")" "stop")" "$(cat "$AUFRUFE")"
  pruefe "und startet ihn nicht" "$(fehlt "$(cat "$AUFRUFE")" "up -d")" "$(cat "$AUFRUFE")"

  # Gegenprobe: eine einzige Zeile mehr in harness/README.md, und sie startet
  # ihn — sonst bewiese das Grün oben nichts.
  cp -R "$HARNESS" "$WURZEL/geaendert"
  echo "> Stillgelegt." >> "$WURZEL/geaendert/README.md"
  aus=$(abgleich "$WURZEL/geaendert")
  pruefe "Gegenprobe: eine Zeile mehr in harness/README.md, und sie startet ihn" \
    "$( grep -q "compose stop postbote" "$AUFRUFE" && grep -q "compose up -d" "$AUFRUFE" && echo ja || echo nein)" \
    "$(cat "$AUFRUFE")"
fi

echo
echo "$((proben - fehler)) von $proben Proben bestanden."
[ "$fehler" = 0 ]
