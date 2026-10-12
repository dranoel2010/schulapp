# 14 Feierabend

Die App öffnet direkt in Schritt 1 und führt in drei Bildschirmen durch den Nachmittag: Neu (zu jedem Fach von heute und unter „Anderes Fach“ eine Aufgabe eintragen oder ein Blatt mit beliebig vielen Seiten fotografieren), Fällig (abhaken per Kreis oder Wischen nach rechts) und Lernen (Klausur mit Lernplan, Lernblock mit Uhr, Abruffragen und Material, oder „Heute nicht lernen“).
Danach kommt „Fertig für heute“, die nur aufzählt, was in dieser Sitzung wirklich passiert ist, und zeigt, was morgen ansteht; die Woche liegt eine Ebene tiefer und ist nur zum Nachsehen da.
Oben steht ein Band mit genau drei Abschnitten, das den Schritt zeigt und antippbar ist; es gibt keine Reiterleiste und keinen Vorschaltbildschirm.
Schriften: Newsreader nur für die h1 (die Fragen „Was ist neu?“ usw.), alles andere in IBM Plex Sans mit Tabellenziffern, dazu Material Symbols Rounded für Icons.
Farben: Papier (#f4f1e9) mit dunkler Tinte und Königsblau (#2a44c0) als einzigem Akzent für Fortschritt, Abhaken und den nächsten Schritt; der Lernblock ist eine eigene Fläche in Nachtblau (#161c36), damit man sieht, dass man in einem anderen Modus ist.
Die wichtigste Animation ist das Abhaken: der Kreis füllt sich, der Haken wird aufgedeckt, der Strich zieht durch den Titel, und nach 350 ms rutscht die Zeile per FLIP in „Erledigt“; beim Wischen folgt die Zeile dem Finger und federt beim Loslassen in einer Bewegung zurück, während sich der Kreis füllt.
Dazu wächst die Fläche des Lernblocks per transform aus ihrem Knopf und schrumpft beim Verlassen dorthin zurück, und am Ende legt sich über die drei Bandabschnitte eine durchgehende Linie.
Es sieht nicht nach Vorlage aus, weil es Papier und Tinte statt Dunkelmodus mit Neonakzent ist, keine Karten und keine Überzeilen hat, keine erfundenen Zahlen zeigt und die Bedienung ein Ablauf statt eines Dashboards ist.
