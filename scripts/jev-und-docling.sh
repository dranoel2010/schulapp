#!/bin/bash
#
# Jev und Docling auf dem NAS einrichten — einmal, in einem Lauf.
#
# Läuft AUF DEM NAS, mit root, und erst NACH einem `hoch` — sonst gäbe es
# diese Datei dort noch gar nicht:
#
#   sudo ~/nas.sh hoch
#   sudo bash /volume1/docker/schulapp/repo/scripts/jev-und-docling.sh
#
# Was es tut, in dieser Reihenfolge, und warum gerade so:
#
#   0. Nachsehen, ohne etwas zu ändern: Stand, Speicher, Platz, Netz, ob es
#      schon eine Override-Datei gibt. Passt etwas nicht, hört es hier auf.
#   1. Den Jev-Schlüssel in die .env — unsichtbar eingetippt, nie ausgegeben.
#   2. Eine docker-compose.override.yml neben die docker-compose.yml. Compose
#      lädt sie von selbst dazu; die Compose-Datei selbst bleibt unberührt,
#      und Löschen der einen Datei macht alles wie vorher.
#   3. Das Docling-Bild holen (mehrere GB) und das Formelmodell in ein
#      Docker-Volume laden. Das Bild bringt es NICHT mit — seine Modellliste
#      ist „layout tableformer picture_classifier rapidocr easyocr", und weil
#      es DOCLING_SERVE_ARTIFACTS_PATH setzt, lädt Docling nichts nach,
#      sondern scheitert an jeder Seite mit „Model … not found in
#      artifacts_path". Nachgesehen am 5.10.2026 im Containerfile von
#      docling-serve v1.36.0.
#   4. Starten — die App wird dabei mit den neuen Variablen neu erzeugt,
#      gebaut wird nichts.
#   5. Prüfen, aus dem App-Container heraus: antwortet Jev, rechnet Docling?
#   6. Erst wenn Jev richtig geantwortet hat: den Postboten auf den neuen
#      Auftrag umstellen. Der lässt das Fach weg, weil Jev es bestimmt — ohne
#      Jev bekäme ein Blatt also gar keins.
#
# Ein zweiter Lauf ist harmlos: Was schon erledigt ist, wird übersprungen.
#
# Alles, was hier steht, landet auch in $APP/jev-und-docling.log — der
# Schlüssel nicht.
#
set -u

APP=/volume1/docker/schulapp
POST=/volume1/docker/postbote
OVERRIDE="$APP/docker-compose.override.yml"
MARKE="# angelegt von scripts/jev-und-docling.sh"
MODELLE=/opt/app-root/src/.cache/docling/models
FORMELMODELL=docling-project--CodeFormulaV2
BILD=quay.io/docling-project/docling-serve-cpu:v1.36.0
# Ab diesem Commit kennen App und Postbote Jev, Docling und die Proben.
STAND=ba35d06
JETZT=$(date +%Y%m%d-%H%M%S)
LOG="$APP/jev-und-docling.log"

schritt() { echo; echo "=== $* ==="; }

halt() {
  echo
  echo "HALT: $*" >&2
  echo "Schick mir die Ausgabe — sie steht auch in $LOG." >&2
  exit 1
}

# ---------------------------------------------------------------- docker
# Wie in nas.sh: sudo nimmt /usr/local/bin aus dem Suchpfad, und genau dort
# liegt docker auf dem NAS.
DOCKER=""
for d in /usr/local/bin/docker /usr/bin/docker /bin/docker; do
  [ -x "$d" ] && { DOCKER="$d"; break; }
done
[ -z "$DOCKER" ] && DOCKER=$(command -v docker 2>/dev/null)
[ -n "$DOCKER" ] || { echo "FEHLER: docker nicht gefunden. Läuft das hier wirklich auf dem NAS?" >&2; exit 1; }
"$DOCKER" compose version >/dev/null 2>&1 || { echo "FEHLER: \"docker compose\" fehlt." >&2; exit 1; }

dc()  { ( cd "$APP"  && "$DOCKER" compose "$@" ); }
dcp() { ( cd "$POST" && "$DOCKER" compose "$@" ); }

# Befehle, die dieses Skript zum Abtippen ausgibt. Auf dem NAS geht weder
# `cd` in den Ordner (er gehört root) noch `sudo docker` (sudo kennt
# /usr/local/bin nicht) — deshalb diese Form.
zum_abtippen() { echo "sudo sh -c 'cd $1 && $DOCKER compose $2'"; }

[ "$(id -u)" = 0 ] || { echo "Bitte mit sudo starten:  sudo bash $0" >&2; exit 1; }

# Ab hier mitschreiben. Die Eingabe des Schlüssels liest von /dev/tty und
# erscheint deshalb weder hier noch im Protokoll.
exec > >(tee -a "$LOG") 2>&1
echo
echo "##### $(date '+%d.%m.%Y %H:%M:%S') — jev-und-docling.sh"

# Falls mitten in der Eingabe abgebrochen wird, das Echo wieder anschalten.
trap '{ stty echo < /dev/tty; } 2>/dev/null' EXIT

# ================================================================ 0
schritt "0  Nachsehen (ändert nichts)"

git -C "$APP/repo" merge-base --is-ancestor "$STAND" HEAD 2>/dev/null \
  || halt "Der Klon ist älter als $STAND. Erst:  sudo ~/nas.sh hoch"
echo "Stand:     $(git -C "$APP/repo" log -1 --format='%h %s')"

[ -f "$APP/docker-compose.yml" ] || halt "Keine $APP/docker-compose.yml — die Override-Datei würde nicht geladen."
[ -f "$APP/.env" ] || halt "Keine $APP/.env."
# COMPOSE_FILE in der .env legt die Dateien fest — dann würde die Override-Datei
# still übergangen, und alles sähe eingerichtet aus, ohne es zu sein.
grep -q '^COMPOSE_FILE=' "$APP/.env" && halt "In der .env steht COMPOSE_FILE — die Override-Datei würde übergangen."

# Speicher. Docling hielt am Mac nach zwei Seiten 2,2 GB mit einem Arbeiter
# und 3,4 GB mit zweien (gemessen 5.10.2026); dazu kommen DSM, Postgres, die
# App und der Postbote. Unter 7 GB wird es eng,
# und eng heißt hier: Das NAS lagert aus, und die App wird für alle langsam.
kb=$(awk '/^MemTotal:/{print $2}' /proc/meminfo)
gb=$(awk -v kb="$kb" 'BEGIN{printf "%.1f", kb/1048576}')
echo "Speicher:  $gb GB, $(nproc) Kerne, $(uname -m)"
[ "$kb" -ge 7000000 ] || halt "Nur $gb GB Arbeitsspeicher. Docling braucht 2–3 GB davon — ich stelle es dir leichter ein, wenn du mir die Zahl schickst. Geändert ist noch nichts."

# Platz: das Bild (mehrere GB) und das Formelmodell (rund 600 MB).
frei_kb=$(df -Pk /volume1 | awk 'NR==2{print $4}')
frei_gb=$(awk -v kb="$frei_kb" 'BEGIN{printf "%.0f", kb/1048576}')
echo "Platz:     $frei_gb GB frei auf /volume1"
[ "$frei_kb" -ge 15000000 ] || halt "Nur $frei_gb GB frei — Bild und Modell brauchen gut 10. Geändert ist noch nichts."

# Netz. Docling kommt ins Standardnetz des Projekts; die App muss also auch
# dort hängen, sonst findet sie „docling" nicht.
app_cid=$(dc ps -q app 2>/dev/null | head -1)
[ -n "$app_cid" ] || halt "Der App-Container läuft nicht. Erst:  sudo ~/nas.sh stand"
projekt=$("$DOCKER" inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$app_cid")
netze=$("$DOCKER" inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' "$app_cid")
echo "Netz:      $netze"
case " $netze " in
  *" ${projekt}_default "*) ;;
  *) halt "Die App hängt nicht im Standardnetz ${projekt}_default, sondern in: $netze — dann muss Docling dorthin. Geändert ist noch nichts." ;;
esac

# Läuft auch der neue Stand? Ein `hoch`, dessen Bau scheiterte, lässt den
# alten Container weiterlaufen, der Klon ist aber schon neu. Dann stellte
# Schritt 6 den Postboten auf einen Auftrag um, den die laufende App nicht
# versteht — Blätter ohne Fach im Korb. Gesucht wird ein Name, den es erst
# seit $STAND im gebauten Server gibt.
#
# Seit „ein Leser je Seite“ (6.10.2026) gehört ein zweiter dazu: Schritt 6
# kopiert seitdem einen Postboten, der nur zu einer App mit `leser` passt.
# `unreadAttachedPageIds` gibt es aber schon seit $STAND, auch in der App
# davor — er allein unterschiede „Bau gelungen“ nicht mehr von „Bau
# gescheitert, die Docling-App läuft noch“. `leser_grund` ist ein
# Spaltenname, steht also als Zeichenkette im Bündel und übersteht das
# Verkleinern. Der erste Name bleibt trotzdem stehen: er ist der Grund,
# warum es diese Zeile gibt.
dc exec -T app grep -rqs unreadAttachedPageIds .next/server \
  && dc exec -T app grep -rqs leser_grund .next/server \
  || halt "Die laufende App ist noch die alte — der Bau beim letzten hoch ist wohl gescheitert. Erst:  sudo ~/nas.sh hoch  (und auf „Fertig.“ achten)"
echo "App:       neuer Stand läuft"

[ -d "$POST/harness" ] || halt "Kein $POST/harness — wo läuft der Postbote?"

if [ -e "$OVERRIDE" ] && ! grep -qF "$MARKE" "$OVERRIDE"; then
  halt "Es gibt schon eine $OVERRIDE, und nicht von mir. Die überschreibe ich nicht. Geändert ist noch nichts."
fi
echo "Alles da."

# ================================================================ 1
schritt "1  Jev-Schlüssel"

if grep -q '^TYPESAFE_API_KEY=[^[:space:]]' "$APP/.env"; then
  echo "Steht schon in der .env — übersprungen."
else
  cp -p "$APP/.env" "$APP/.env.vor-jev-$JETZT"
  echo "Sicherung: $APP/.env.vor-jev-$JETZT"
  printf 'Jev-Schlüssel (TypeSafe) einfügen, dann Enter. Er bleibt unsichtbar: ' > /dev/tty
  stty -echo < /dev/tty
  IFS= read -r schluessel < /dev/tty
  stty echo < /dev/tty
  echo > /dev/tty
  # Beim Einfügen kommen gern ein Leerzeichen oder ein Wagenrücklauf mit.
  schluessel=$(printf '%s' "$schluessel" | tr -d '[:space:]')
  [ -n "$schluessel" ] || halt "Kein Schlüssel eingegeben. Geändert ist noch nichts."
  # Leere Zeilen desselben Namens weg, damit keine den Wert überdeckt.
  sed -i '/^TYPESAFE_API_KEY=[[:space:]]*$/d' "$APP/.env"
  printf '\nTYPESAFE_API_KEY=%s\n' "$schluessel" >> "$APP/.env"
  unset schluessel
  echo "Eingetragen ($(grep -c '^TYPESAFE_API_KEY=[^[:space:]]' "$APP/.env") Zeile)."
fi

# ================================================================ 2
schritt "2  Override-Datei"

if [ -e "$OVERRIDE" ]; then
  echo "Steht schon da (von mir) — übersprungen."
else
  {
    echo "$MARKE am $(date '+%d.%m.%Y %H:%M')"
    cat <<'YAML'
#
# Ergänzt die docker-compose.yml daneben; Compose lädt diese Datei von selbst
# dazu. Rückgängig: diese Datei löschen, dann
#   docker compose up -d --remove-orphans
# Die Modelle im Volume bleiben dabei liegen (docker volume ls).
services:
  app:
    environment:
      # Aus der .env daneben. Fehlt er, ordnet die App nichts selbst ein.
      TYPESAFE_API_KEY: ${TYPESAFE_API_KEY:-}
      DOCLING_URL: http://docling:5001

  docling:
    image: quay.io/docling-project/docling-serve-cpu:v1.36.0
    restart: unless-stopped
    # Kein ports: — nur die App spricht mit Docling, im inneren Netz.
    environment:
      # Einer statt zwei: Jeder Arbeiter lädt seine eigenen Modelle.
      DOCLING_SERVE_ENG_LOC_NUM_WORKERS: "1"
    volumes:
      # Das Formelmodell fehlt im Bild; es liegt hier und überlebt Neustarts.
      # Ein Volume, kein Ordner unter /volume1/docker — siehe den Ausfall vom
      # 11.9.2026 im README.
      - doclingmodelle:/opt/app-root/src/.cache/docling/models
    mem_limit: 5g

volumes:
  doclingmodelle:
YAML
  } > "$OVERRIDE"
  echo "Angelegt: $OVERRIDE"
fi

dienste=$(dc config --services 2>&1) || { rm -f "$OVERRIDE"; halt "Compose mag die Datei nicht — wieder entfernt: $dienste"; }
echo "Dienste:   $(echo $dienste)"
case " $(echo $dienste) " in
  *" docling "*) ;;
  *) rm -f "$OVERRIDE"; halt "Compose lädt die Override-Datei nicht dazu (kein „docling“ in: $dienste) — wieder entfernt." ;;
esac

# ================================================================ 3
schritt "3  Docling-Bild und Formelmodell (dauert)"

# Bricht hier etwas ab, kommt die Override-Datei wieder weg: Sonst versuchte
# der nächste `hoch`, ein Docling ohne Bild oder Modell zu starten.
zurueckbauen() { rm -f "$OVERRIDE"; echo "Override-Datei wieder entfernt; die App läuft wie vorher."; }

echo "Hole $BILD ..."
dc pull docling || { zurueckbauen; halt "Das Bild kam nicht an."; }

# Beim ersten Einhängen füllt Docker das leere Volume mit dem, was das Bild an
# dieser Stelle hat — die mitgelieferten Modelle bleiben also da, und das
# Formelmodell kommt dazu.
if dc run --rm --no-deps -T docling test -d "$MODELLE/$FORMELMODELL" 2>/dev/null; then
  echo "Formelmodell liegt schon im Volume — übersprungen."
else
  echo "Lade das Formelmodell (rund 600 MB) ..."
  dc run --rm --no-deps -T docling docling-tools models download -o "$MODELLE" code_formula \
    || { zurueckbauen; halt "Das Formelmodell kam nicht an."; }
  dc run --rm --no-deps -T docling test -d "$MODELLE/$FORMELMODELL" \
    || { zurueckbauen; halt "Der Download lief durch, aber $FORMELMODELL fehlt im Volume."; }
fi
echo "Modelle:   $(dc run --rm --no-deps -T docling ls "$MODELLE" 2>/dev/null | tr '\n' ' ')"

# ================================================================ 4
schritt "4  Starten"

dc up -d || halt "Start ging schief. Zurück:  sudo rm $OVERRIDE  und  $(zum_abtippen "$APP" "up -d --remove-orphans")"

printf "Warte auf die App "
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 http://127.0.0.1:3000/ 2>/dev/null || true)
  case "$code" in 200|307|308) break ;; esac
  printf "."; sleep 6
done
echo " HTTP ${code:-000}"
case "$code" in 200|307|308) ;; *) halt "Die App antwortet nicht. Protokoll:  $(zum_abtippen "$APP" "logs --tail=50 app")" ;; esac

printf "Warte auf Docling "
docling_da=nein
for i in $(seq 1 60); do
  if dc exec -T app node -e "fetch(process.env.DOCLING_URL + '/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))" >/dev/null 2>&1; then
    docling_da=ja; break
  fi
  printf "."; sleep 5
done
echo " $docling_da"

# ================================================================ 5
schritt "5  Prüfen"

jev_ok=nein
if dc exec -T app node --input-type=module - < "$APP/repo/scripts/nas-probe-jev.mjs"; then
  jev_ok=ja
fi

docling_ok=nein
if [ "$docling_da" = ja ]; then
  echo "Docling rechnet zwei Probeseiten — die erste lädt die Modelle, das kann Minuten dauern ..."
  dc exec -T app node --input-type=module - < "$APP/repo/scripts/nas-probe-docling.mjs" && docling_ok=ja
else
  echo "Docling antwortet nach fünf Minuten nicht. Protokoll:  $(zum_abtippen "$APP" "logs --tail=50 docling")"
fi
docling_cid=$(dc ps -q docling 2>/dev/null | head -1)
[ -n "$docling_cid" ] && echo "Speicher:  Docling $("$DOCKER" stats --no-stream --format '{{.MemUsage}}' "$docling_cid")"

# Ein falscher Schlüssel bliebe beim nächsten Lauf stehen (Schritt 1 sieht
# nur, dass einer da ist) — daher der Hinweis, wie er wieder herauskommt.
[ "$jev_ok" = ja ] || halt "Jev antwortet nicht richtig — der Postbote bleibt deshalb beim alten Auftrag. Docling: $docling_ok. War der Schlüssel falsch:  sudo sed -i '/^TYPESAFE_API_KEY=/d' $APP/.env  und das Skript noch einmal."

# ================================================================ 6
schritt "6  Postbote auf den neuen Auftrag"

summen() { ( cd "$1" && md5sum *.mts README.md 2>/dev/null | sort ); }
alt=""

if [ "$(summen "$APP/repo/harness")" = "$(summen "$POST/harness")" ]; then
  echo "Die Kopie unter $POST/harness ist schon aktuell — übersprungen."
else
  alt="$POST/harness-alt-$JETZT"
  mkdir -p "$alt"
  cp -p "$POST"/harness/*.mts "$POST"/harness/README.md "$alt"/ 2>/dev/null
  echo "Sicherung: $alt"
  # Auf vorhandene Dateien kopiert, behalten sie Eigentümer und Rechte — der
  # Postbote läuft nicht als root und muss sie lesen können.
  cp "$APP"/repo/harness/*.mts "$APP/repo/harness/README.md" "$POST/harness/" || halt "Kopieren ging schief. Zurück: cp -p $alt/* $POST/harness/"
  [ "$(summen "$APP/repo/harness")" = "$(summen "$POST/harness")" ] || halt "Nach dem Kopieren weichen die Dateien noch ab."
  echo "Kopiert und verglichen."
fi

# Steht in seiner Compose-Datei ein eigenes --intervall, sieht er nicht alle
# 15 Sekunden nach, sondern so oft, wie dort steht.
if grep -nE -- '--(intervall|ruhe)' "$POST"/docker-compose.y*ml 2>/dev/null; then
  echo "ACHTUNG: Oben steht ein eigenes --intervall/--ruhe für den Postboten — schick mir die Zeile."
fi

# Erst anhalten, dann über nas.sh starten: Nach `docker stop` bleibt
# lauf.lock liegen, und nas.sh räumt sie nur weg, wenn er nicht läuft. Ein
# Blatt, das er gerade liest, kommt in der nächsten Runde noch einmal dran.
if [ -n "$alt" ]; then
  dcp stop postbote
  bash "$APP/repo/scripts/nas.sh" postbote
else
  echo "Nichts kopiert — er läuft ungestört weiter."
fi
echo "claude im Postboten: $(dcp exec -T postbote claude --version 2>&1 | head -1)"

# ================================================================ fertig
schritt "Fertig"
echo "Jev:       $jev_ok"
echo "Docling:   $docling_ok"
echo
echo "Jetzt ein Foto hochladen. Nach ein bis drei Minuten liegt es im Fach, nicht im Eingangskorb."
echo "Zusehen:   $(zum_abtippen "$POST" "logs -f --tail=20 postbote")"
echo "Docling:   $(zum_abtippen "$APP" "logs --tail=200 app") | grep -E 'Leser|Docling|Jev'"
echo
echo "Rückweg, falls nötig:"
if [ -n "$alt" ]; then
  echo "  Postbote:  $(zum_abtippen "$POST" "stop postbote")"
  echo "             sudo sh -c 'cp -p $alt/* $POST/harness/'   und   sudo ~/nas.sh postbote"
fi
echo "  Docling:   sudo rm $OVERRIDE   und   $(zum_abtippen "$APP" "up -d --remove-orphans")"
