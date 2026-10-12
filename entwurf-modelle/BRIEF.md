# Vorgabe für alle zehn UI/UX-Modelle

## Worum es geht

Eine Schulapp für einen einzelnen Schüler (10. Klasse), fast nur am Handy benutzt. Was sie kann, steht in `KONZEPT.md` und unter `src/app`: Stundenplan, Hausaufgaben, Klausuren mit Lernplan (Lernblöcke ohne feste Uhrzeit), Noten, Fächer, Material (abfotografierte Blätter mit Abschrift) und „Wissen abrufen“ (Karteikarten-Abfrage).

Der Nutzer hat bisher jeden Entwurf abgelehnt. Sein Satz: „Es sieht immer alles gleich aus, nach KI.“ Er will eine moderne, saubere Oberfläche mit schönen Animationen, die aussieht wie von einer echten Firma mit guten Leuten. Denk an die Sorgfalt von Linear, Things 3, Apple Erinnerungen, Revolut, Notion Calendar oder Arc, ohne eine davon zu kopieren.

## Wann und wofür er die App benutzt (wichtig)

In der Schule hat er kein Handy. Er benutzt die App also vor allem **nach der Schule und zu Hause**: Hausaufgaben eintragen und abhaken, für Klausuren lernen (Lernblöcke, Wissen abrufen), Blätter abfotografieren und wiederfinden. Der Stundenplan gehört dazu, ist aber nur zum Nachsehen da („was habe ich morgen?“) und **nicht die Hauptfunktion**. Er darf die Startseite nicht beherrschen, und ein „Jetzt läuft Mathe, in 15 Minuten“ ergibt keinen Sinn, weil er es in dem Moment nicht sieht.

Die Beispielzeit ist deshalb Montag, 16:40 Uhr, zu Hause nach der Schule.

## Was du baust

Einen klickbaren Prototyp in **einer einzigen Datei** `index.html` in deinem Ordner. Vanilla HTML, CSS und JavaScript, keine Frameworks, keine Build-Schritte. Extern erlaubt sind nur Google Fonts.

- Gerät: Handy, 390 × 844 px. Die Seite füllt genau diesen Bildschirm, mit sicheren Rändern oben und unten.
- Mindestens diese Bildschirme mit echten Übergängen dazwischen: Start („Heute“), Hausaufgaben (abhaken muss sich gut anfühlen), Stundenplan oder Woche, Blatt aufnehmen (Kamera nur angedeutet), und eine Klausur mit ihrem Lernplan.
- Alles auf Deutsch, mit den Beispieldaten unten.

## Animation

Lies und befolge die Skills `emil-design-eng`, `animate`, `apple-design` und `mobile-native`. Kurz:
- Bewegung erklärt, woher etwas kommt und wohin es geht. Keine Deko-Bewegung.
- Kurze Dauern (meist 150 bis 350 ms), echte Easing-Kurven oder Federn, unterbrechbar.
- Nur `transform` und `opacity` animieren. Gesten folgen dem Finger.
- `prefers-reduced-motion` respektieren.

## Was es NICHT sein darf

Lies `redesign-existing-projects` und `design-taste-frontend`. Ausdrücklich verboten, weil es nach KI aussieht:
- grüne oder lila Karten mit runden Ecken auf hellem Grau, eine Karte in der nächsten
- über jeder Überschrift eine kleine Zeile in Großbuchstaben
- Marketing-Sätze wie „Platz für das Wesentliche“ oder „Dein Tag, deine Aufgaben“
- Verläufe als Hintergrund, Glassmorphism ohne Grund, Emojis als Icons
- Zahlen, die die App nicht wissen kann (Trends, Streaks, Fortschrittsprozente ohne Grundlage)

Die Texte schreibst du nach den Regeln aus dem Skill `unslop` (cursor/plugins, pstack): kurz, konkret, ohne Floskeln, ohne Gedankenstriche.

## Beispieldaten (für alle gleich)

Montag, 12.10.2026, 16:40 Uhr, zu Hause.
- Stunden: 08:00–09:30 Deutsch (R. 104), 09:50–11:20 Mathematik (R. 208), 11:40–13:10 Biologie (Bio 1). Danach frei.
- Hausaufgaben für Dienstag: Mathe „S. 84, Nr. 3–5“, Deutsch „Gedichtanalyse beenden“. Eine erledigte von gestern: Englisch „Vokabeln Unit 3“.
- Klausur: Mathematik, Freitag 16.10., Thema „Quadratische Funktionen“. Lernplan: heute ein Lernblock (25 Minuten, Scheitelpunktform), Mittwoch Wiederholung, Donnerstag Probeklausur.
- Noten Mathe bisher: 2, 3+, 2−.

## Zum Schluss

Lege neben `index.html` eine `notiz.md` an, in fünf bis acht Sätzen: das Bedienkonzept, die Schriften, die Farben, die wichtigste Animation, und warum das nicht nach Vorlage aussieht. Öffne die Seite vor dem Abgeben selbst, wenn du kannst, und prüfe sie gegen diese Vorgabe.
