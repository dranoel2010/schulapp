# syntax=docker/dockerfile:1

# Das Bild, in dem die Schulapp auf dem NAS läuft.
#
# Vorgeschichte: Beim Umzug von Vercel auf das Synology-NAS am 30.8.2026 wurde
# ein Dockerfile direkt dort geschrieben und nie eingecheckt. Es lag damit
# genau an der Stelle, an der niemand es sucht, und ging bei jedem Neuaufsetzen
# des NAS verloren. Diese Datei ist der Nachbau aus dem, was package.json,
# next.config.ts und der Code hergeben — nicht die Abschrift des Originals.
#
# Gebaut wird auf dem NAS aus dem Klon unter /volume1/docker/schulapp/repo,
# angestoßen von einer docker-compose.yml, die daneben liegt und bewusst nicht
# im Repo steht (dort stehen die Geheimnisse). Der Klon ist zugleich der
# Build-Kontext — was ihn nicht erreichen soll, steht in .dockerignore.
#
# ZWEI STUFEN, und zwar nicht der Form halber. Der Bau braucht Dinge, die der
# Betrieb nie wieder anfasst:
#
#   • den gesamten Quelltext samt scripts/ und den Konfigurationsdateien,
#   • die devDependencies — `next build` prüft die Typen mit, dafür muss
#     typescript samt @types da sein, und das CSS entsteht mit tailwindcss und
#     @tailwindcss/postcss,
#   • Werkzeug, das mit der laufenden App nichts zu tun hat: drizzle-kit für
#     die Wanderungen, playwright-core und tsx für die Tests.
#
# Gemessen am 5.9.2026 auf dem Mac sind allein das typescript mit 23 MB,
# playwright-core mit 13 MB und drizzle-kit mit 9,8 MB — in einem Bild, das
# nichts tut als `next start` auszuführen, sind sie totes Gewicht und
# Angriffsfläche. Die zweite Stufe beginnt deshalb bei einem frischen
# node:22-alpine und bekommt nur das Ergebnis gereicht.
#
# WARUM DER VAPID-SCHLÜSSEL EIN ARG SEIN MUSS UND KEINE UMGEBUNGSVARIABLE.
#
# Das ist die eine Zeile, an der dieses Bild still kaputtgehen kann. Alles mit
# dem Präfix NEXT_PUBLIC_ ersetzt Next beim Bauen durch den Wert, den es
# vorfindet — und laut Handbuch (siehe
# node_modules/next/dist/docs/01-app/02-guides/environment-variables.md) nicht
# nur im Browser-Bündel, sondern auch im Node-Teil. Am 5.9.2026 nachgeprüft:
# der Schlüssel aus .env.local steht im gebauten Stand wörtlich in zwei
# Dateien unter .next/server/chunks. Zur Laufzeit liest niemand mehr
# process.env — dort steht gar kein Zugriff mehr, sondern der Wert selbst.
#
# Wer den Schlüssel also erst in der docker-compose.yml unter `environment`
# setzt, setzt ihn an einer Stelle, an der ihn keiner mehr abholt. Die App
# startet trotzdem, die Ablage funktioniert, die Noten stimmen, nur:
# isPushConfigured() in src/lib/push.ts sieht einen leeren PUBLIC_KEY und gibt
# false zurück, die Einstellungsseite bietet keinen Knopf mehr an, sondern den
# Satz „Auf diesem Server fehlen die Schlüssel für Push-Nachrichten", und es
# kommt nie wieder eine Erinnerung an. Kein Fehler im Protokoll, kein roter
# Balken — deshalb steht der Wert hier als ARG und wird vor `npm run build`
# gesetzt.
#
# WARUM KEIN output: "standalone".
#
# next.config.ts setzt es nicht, und diese Datei ändert daran nichts: Der
# Umbau gehörte in die Konfiguration der App und nicht in die Verpackung, und
# er wäre hier ein Nebeneffekt, den beim nächsten Lesen niemand erwartet.
# Standalone würde das Laufzeit-Bild kleiner machen, indem Next selbst
# aussucht, welche Dateien aus node_modules mitkommen. Genau das ist hier der
# Haken: @electric-sql/pglite steht in serverExternalPackages, wird also
# absichtlich NICHT mitgebündelt, und es bringt neben JavaScript drei Dateien
# mit, die kein Bündler von sich aus als Abhängigkeit erkennt —
# dist/pglite.wasm, dist/initdb.wasm und dist/pglite.data (zusammen mit dem
# Rest des Pakets 25 MB, gemessen am 5.9.2026).
#
# Ohne standalone stellt sich die Frage nicht: das Laufzeit-Bild bekommt die
# vollständigen Produktionsabhängigkeiten, und `next start` findet alles dort,
# wo Node es sucht. Auf dem NAS läuft die App zwar gegen den Postgres im
# Nachbarcontainer und rührt PGlite nie an — aber src/db/index.ts importiert
# es ganz oben und ohne Bedingung. Fehlt das Paket, fehlt also nicht bloß die
# Rückfallebene: Dann startet die App überhaupt nicht.
#
# WAS BEIM BAUEN NOCH NÖTIG IST: Netz, und zwar mehr als für npm. In
# src/app/layout.tsx kommen die Schriften Geist und Geist Mono über
# next/font/google; Next lädt sie während `next build` herunter und legt sie
# in den Bau. Ein Container hat dabei keinen Zwischenspeicher von gestern —
# jeder Bau lädt neu, und ohne Internet kann er genau daran scheitern. Das
# passiert beim Bauen, nicht beim Starten, und es ist im Protokoll des Baus zu
# sehen.


# ---------------------------------------------------------------------------
# Stufe 1 — bauen
# ---------------------------------------------------------------------------
FROM node:22-alpine AS bauen

# Alpine hat keine glibc. Die native Übersetzung von Next (@next/swc-…-musl)
# und die Bildbibliothek sharp bringen zwar eigene musl-Varianten mit, aber
# sobald npm für irgendeinen Baustein auf ein gnu-Fertigteil ausweicht, endet
# der Bau mit „Error loading shared library ld-linux-x86-64.so.2" — einer
# Meldung, die nach einem kaputten Paket aussieht und nur bedeutet, dass ein
# Ladepfad fehlt. libc6-compat kostet rund ein Megabyte und nimmt diesen
# ganzen Ast aus dem Spiel; das offizielle Next-Beispiel für Docker macht es
# aus demselben Grund.
RUN apk add --no-cache libc6-compat

WORKDIR /app

# Erst die beiden Dateien, die die Abhängigkeiten festlegen, dann der Rest.
# Docker legt für jede Zeile eine Schicht an und benutzt sie wieder, solange
# sich ihre Eingaben nicht ändern: So kostet eine geänderte Zeile in einer
# Komponente keinen kompletten npm ci — der ist der teuerste Schritt hier.
COPY package.json package-lock.json ./

# npm ci und nicht npm install: ci hält sich strikt an package-lock.json und
# baut aus einem leeren Verzeichnis.
#
# WICHTIG ist, was hier NICHT steht: NODE_ENV=production. In dieser Stufe darf
# es das nicht geben, denn npm überspringt dann die devDependencies — und der
# Bau stürbe im Typprüfer, dem typescript fehlt, oder spätestens beim CSS.
# NODE_ENV setzt erst die zweite Stufe; `next build` schaltet den Bau selbst
# auf Produktion, dafür braucht es die Variable nicht.
RUN npm ci

COPY . .

# Der öffentliche VAPID-Schlüssel — siehe den langen Absatz im Kopf. Er steht
# hier unten und nicht vor `npm ci`, damit ein neuer Schlüssel nicht die
# Schichten mit den Abhängigkeiten entwertet.
#
# Übergeben wird er beim Bauen, in der docker-compose.yml auf dem NAS:
#
#   build:
#     context: ./repo
#     args:
#       NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${NEXT_PUBLIC_VAPID_PUBLIC_KEY}
#
# Ein Geheimnis ist er nicht — er steht im gebauten JavaScript und damit in
# jedem Browser, der die App öffnet. Der private Gegenpart (VAPID_PRIVATE_KEY)
# gehört dagegen ausschließlich in die Laufzeitumgebung und niemals hierher.
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY=""
ENV NEXT_PUBLIC_VAPID_PUBLIC_KEY=$NEXT_PUBLIC_VAPID_PUBLIC_KEY

# Kein Telemetriefunk aus dem Heimnetz heraus.
ENV NEXT_TELEMETRY_DISABLED=1

# Der leere Schlüssel bricht den Bau nicht ab — ein Bild ohne Push ist immer
# noch eine laufende Schulapp, und ein harter Abbruch würde einen Deploy
# verhindern, der vielleicht gerade dringend ist. Er sagt aber Bescheid, denn
# das ist der einzige Augenblick, in dem dieser Fehler noch sichtbar ist.
RUN if [ -z "${NEXT_PUBLIC_VAPID_PUBLIC_KEY}" ]; then \
      echo "!! NEXT_PUBLIC_VAPID_PUBLIC_KEY ist leer. Dieses Bild wird ohne"; \
      echo "!! Push-Anmeldung gebaut — nachträglich per environment gesetzt"; \
      echo "!! wirkt der Wert NICHT. Siehe Kopf des Dockerfiles."; \
    fi; \
    npm run build

# Zwei Dinge, die hier billig sind und im Laufzeit-Bild teuer wären:
#
#   • .next/cache ist der Zwischenspeicher des Bauens. Er wird beim nächsten
#     Bau in einem frischen Container ohnehin nicht wiedergefunden; auf diesem
#     Rechner lagen dort am 5.9.2026 169 MB. `next start` legt das
#     Verzeichnis bei Bedarf selbst wieder an.
#   • npm prune wirft die devDependencies aus node_modules, sodass die zweite
#     Stufe den Ordner einfach übernehmen kann, statt ein zweites Mal aus dem
#     Netz zu installieren. Was `next` selbst als optionale Abhängigkeit
#     mitbringt — die musl-Variante von swc und sharp — bleibt dabei liegen,
#     weil next eine Produktionsabhängigkeit ist.
RUN rm -rf .next/cache && npm prune --omit=dev


# ---------------------------------------------------------------------------
# Stufe 2 — laufen
# ---------------------------------------------------------------------------
FROM node:22-alpine AS laufen

# Aus demselben Grund wie oben: Was in node_modules an fertig übersetzten
# Binärteilen liegt, wird hier ausgeführt und nicht nur gebaut.
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# `next start` hört laut Handbuch von Haus aus auf 0.0.0.0 und Port 3000
# (node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md). PORT
# steht trotzdem da, weil eine Zahl, die man in der Compose-Datei
# wiederfindet, mehr wert ist als eine Voreinstellung, die man kennen muss.
ENV PORT=3000

WORKDIR /app
RUN chown node:node /app

# Nur das Ergebnis kommt herüber: kein Quelltext, keine tsconfig.json, kein
# scripts/. next.config.ts muss mit — `next start` liest es beim Hochfahren
# und übersetzt es selbst mit dem eingebauten SWC, das typescript-Paket
# braucht es dafür nicht (nachgesehen in
# node_modules/next/dist/build/next-config-ts/transpile-config.js).
#
# --chown: Ohne das gehörte alles root, und der Server unten läuft als `node`.
# Er müsste dann beim ersten Zwischenspeichern in .next/cache schreiben und
# dürfte nicht.
COPY --from=bauen --chown=node:node /app/node_modules ./node_modules
COPY --from=bauen --chown=node:node /app/.next ./.next
COPY --from=bauen --chown=node:node /app/public ./public
# Die Schriften für das Fach-PDF. Sie liegen bewusst NICHT unter public/ — der
# Browser braucht sie nie, gelesen werden sie vom Server beim Erzeugen des PDF.
# Genau deshalb muss dieser Ordner hier ausdrücklich stehen: das Laufzeit-Bild
# übernimmt nur die Zeilen, die hier aufgezählt sind, und ein vergessener Ordner
# fällt nicht beim Bauen auf, sondern erst im Betrieb — beim ersten PDF, mit
# einer Meldung über eine fehlende Datei. Was darin liegt und warum es zwei
# Schriften sind, steht in assets/schriften/README.md.
COPY --from=bauen --chown=node:node /app/assets ./assets
COPY --from=bauen --chown=node:node /app/package.json ./package.json
COPY --from=bauen --chown=node:node /app/next.config.ts ./next.config.ts

# Der Server läuft nicht als root. Das Bild steht zwar hinter Tailscale Funnel
# und nicht an einem offenen Port, aber es rendert fremden Text: Auf den
# Blättern in der Ablage steht, was der Postbote gelesen hat, und die
# Antworten des Web MCP kommen von außen.
USER node

EXPOSE 3000

# Ohne DATABASE_URL fällt src/db/index.ts auf PGlite zurück und legt /app/.data
# im Container an. Das sieht aus wie eine leere App — und ist es auch: Beim
# nächsten `docker compose up -d --build` ist alles darin weg, weil eine
# Schicht kein Datenträger ist. Die docker-compose.yml auf dem NAS setzt
# DATABASE_URL auf den Postgres-Container daneben; wer dieses Bild irgendwo
# anders startet, muss das ebenfalls tun.
#
# Kein `npm run start`: dann stünde npm als Prozess 1 zwischen Docker und
# Node, und das SIGTERM eines `docker compose down` erreichte den Server nur
# über diesen Umweg. So bekommt Next es direkt und darf seine offenen
# Verbindungen selbst zumachen.
CMD ["node_modules/.bin/next", "start"]
