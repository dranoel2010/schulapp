# Der Postbote auf dem Raspberry Pi

Auf dem Laptop läuft er, solange der Deckel offen ist. Ein Pi steht in der Ecke
und schläft nie — dann liegt der Vorschlag schon im Korb, wenn du das nächste
Mal hinsiehst.

**Ehrlich vorweg:** Das hier ist zusammengetragen und geprüft, wo es sich vom
Laptop aus prüfen ließ — dass es ein Linux-arm64-Binary gibt, dass der Postbote
ohne Repo und ohne eine einzige npm-Abhängigkeit läuft, dass die Adressen
antworten. **Auf einem echten Pi ausprobiert ist es nicht.** Wo etwas klemmt,
steht unten eine Tabelle.

## Was der Pi können muss

| | |
|---|---|
| **Modell** | Pi 4 oder 5. Ein Pi 3 ist arm64, hat aber nur 1 GB — eng. |
| **Arbeitsspeicher** | 2 GB Minimum. Allein die Installation von Claude Code braucht rund 512 MB frei, sonst bricht sie mit „Killed" ab. |
| **System** | **64-Bit** Raspberry Pi OS. Das ist die Falle: viele Karten laufen noch mit dem alten 32-Bit-System, und dafür gibt es kein Binary. |
| **Netz** | Nur nach außen. Keine Portfreigabe, keine feste IP — der Pi ruft die App, nie umgekehrt. |

Vor allem anderen:

```bash
uname -m        # muss aarch64 sagen. armv7l heißt: Karte neu bespielen.
free -m         # verfügbarer Speicher
```

Sagt `uname -m` etwas anderes als `aarch64`, hört es hier auf. Das 64-Bit-System
gibt es im Raspberry Pi Imager unter *Raspberry Pi OS (64-bit)*; das Neubespielen
dauert eine halbe Stunde und ist der ganze Aufwand.

Und einmal die Uhr, damit die Zeilen im Protokoll zu deinem Tag passen:

```bash
sudo timedatectl set-timezone Europe/Berlin
```

## 1. Node

Raspberry Pi OS bringt ein zu altes Node mit; gebraucht wird 22 oder neuer.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node -v
```

**NodeSource und nicht nvm** — nicht aus Geschmack, sondern wegen Schritt 6: ein
Dienst startet ohne deine Shell, und nvm legt Node an eine Stelle, die er dann
nicht findet. So liegt es unter `/usr/bin/node`, und der Dienst findet es immer.

Dazu `tsx`, das die TypeScript-Dateien des Postboten ausführt:

```bash
sudo npm install -g tsx
```

Auch das mit Absicht fest installiert: `npx tsx` würde es beim ersten Start
herunterladen, und ein Dienst, der beim Hochfahren erst ins Netz muss, bevor er
etwas tun kann, ist ein Dienst, der manchmal nicht startet.

## 2. Claude Code

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

Nicht mit `sudo` — es installiert in dein Heimatverzeichnis, und das Skript
lehnt `sudo` von sich aus ab. Danach liegt `claude` unter `~/.local/bin`; steht
das nicht im Pfad:

```bash
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
exec $SHELL
claude --version
```

Dann einmal anmelden:

```bash
claude
```

Im Programm `/login` tippen. Es zeigt eine Adresse — die kopierst du an deinen
Laptop, meldest dich dort im Browser an und tippst den Code zurück in den Pi.
Ein Bildschirm am Pi ist dafür nicht nötig.

**Das Abo zahlt, nicht die Karte.** Der Postbote entfernt beim Start einen
`ANTHROPIC_API_KEY` aus der Umgebung, damit nicht versehentlich doch abgerechnet
wird. Ein Blatt entspricht rund 0,30 $, wenn man denselben Lauf über die API
bezahlt hätte.

## 3. Den Postboten hinüberbringen

Er braucht **nichts** außer sich selbst: keine npm-Abhängigkeit, kein
`node_modules`, nicht das Repo drumherum. Nachgemessen — der Ordner läuft allein
in einem leeren Verzeichnis.

```bash
git clone --depth 1 https://github.com/dranoel2010/schulapp.git
cd schulapp/harness
```

Wer nur den Ordner will, kopiert ihn vom Laptop:

```bash
scp -r harness pi@raspberrypi.local:~/postbote
```

> **`zugang.json` bleibt dabei zu Hause.** Sie steht in der `.gitignore`, wird
> also nicht mitgeklont — und mit `scp` gehörte sie ausgeschlossen. Warum, steht
> im nächsten Schritt.

## 4. Die Zustimmung — der knifflige Schritt

Der Pi bekommt eine **eigene** Zustimmung. Die vom Laptop mitzunehmen wäre der
naheliegende Weg und der falsche: beide läsen dann dasselbe Erneuerungs-Token,
das bei jedem Gebrauch getauscht wird, und nähmen sich gegenseitig die
Verbindung weg. Mit zwei Zustimmungen stehen zwei Zeilen in *Einstellungen →
Verbundene Programme*, jede mit eigenem **Trennen**-Knopf.

Nun hat der Pi keinen Browser, und die Antwort der Zustimmungsseite geht an
`127.0.0.1:41751` — also an den Rechner, auf dem der Postbote gerade wartet. Der
Weg dorthin ist eine SSH-Weiterleitung.

**Am Laptop** eine Verbindung mit weitergereichtem Port aufmachen:

```bash
ssh -L 41751:localhost:41751 pi@raspberrypi.local
```

**In dieser Sitzung**, also auf dem Pi:

```bash
cd ~/schulapp/harness
npx tsx zugang.mts
```

Es druckt eine lange Adresse. Die kopierst du in den Browser **deines Laptops**
und drückst *Erlauben*. Der Browser springt dann auf `127.0.0.1:41751` — und
weil der Port weitergereicht wird, landet die Antwort auf dem Pi. Dort steht
danach:

```
Zugang liegt in /home/pi/schulapp/harness/zugang.json (nur für dich lesbar).
```

Zwei Dinge, die dabei schiefgehen:

- **Auf dem Laptop darf gerade nichts auf 41751 lauschen.** Läuft dort
  gleichzeitig `zugang.mts`, landet die Antwort bei ihm statt beim Pi.
- **Die SSH-Sitzung muss offen bleiben**, bis du geklickt hast. Fällt sie
  vorher zu, ist der Port weg.

## 5. Einmal von Hand

Bevor ein Dienst daraus wird, ein Lauf, bei dem du zusiehst:

```bash
npx tsx postbote.mts --einmal
```

Liegt etwas im Korb, dauert es 35 bis 50 Sekunden und es steht ein Vorschlag da.
Liegt nichts darin, sagt er nichts — das ist richtig so.

## 6. Als Dienst

```bash
mkdir -p ~/.config/systemd/user
nano ~/.config/systemd/user/postbote.service
```

```ini
[Unit]
Description=Schulapp-Postbote
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/schulapp/harness
ExecStart=/usr/bin/tsx postbote.mts
# Claude Code liegt in ~/.local/bin, und ein Dienst erbt deinen Pfad nicht.
Environment=PATH=/usr/local/bin:/usr/bin:/bin:%h/.local/bin
Restart=on-failure
# Eine Minute Pause vor dem nächsten Versuch: die Gründe, aus denen er stirbt,
# sind Netz und Kontingent, und beide kommen nicht in zwei Sekunden zurück.
RestartSec=60

[Install]
WantedBy=default.target
```

Anschalten:

```bash
systemctl --user daemon-reload
systemctl --user enable --now postbote
```

Und damit er auch läuft, wenn niemand angemeldet ist — sonst startet ein
Benutzerdienst erst mit deiner ersten Anmeldung und endet mit der letzten:

```bash
sudo loginctl enable-linger $USER
```

Zusehen:

```bash
systemctl --user status postbote
journalctl --user -u postbote -f
```

## 7. Und der Laptop?

**Lass nur einen laufen.** Die Token stoßen sich seit den getrennten
Zustimmungen nicht mehr — jeder hat seinen eigenen. Aber beide sähen in
denselben Korb, und beide griffen sich dasselbe Blatt: dann lägen zwei
Vorschläge daneben, und der Knopf *Übernehmen* verschwindet, sobald mehr als
einer da ist. Aus einem Druck würden drei Handgriffe.

Läuft auf dem Laptop noch einer, beende ihn mit Strg-C. Die Zustimmung darf
stehen bleiben — sie stört nicht und ist da, wenn der Pi einmal ausfällt.

## Wenn etwas klemmt

| Was dasteht | Was es heißt |
|---|---|
| `uname -m` sagt `armv7l` | 32-Bit-System. Karte mit *Raspberry Pi OS (64-bit)* neu bespielen. |
| `Killed` beim Installieren (exit 137) | Zu wenig Speicher. Claude Code braucht rund 512 MB frei. Alles andere schließen, neu starten. |
| `claude: command not found` | `~/.local/bin` fehlt im Pfad — siehe Schritt 2. |
| `tsx: command not found` im Dienst | `Environment=PATH=…` in der Unit fehlt oder `tsx` ist nur lokal installiert. |
| Der Browser sagt „Seite nicht erreichbar" nach *Erlauben* | Die SSH-Weiterleitung steht nicht (mehr). Neu aufbauen und `zugang.mts` noch einmal starten. |
| `Es läuft schon ein Postbote` | Genau das — die Prozessnummer steht daneben. Der Dienst zählt mit. |
| `Die Verbindung gilt nicht mehr` | Getrennt, abgelaufen, oder es liefen zwei auf derselben `zugang.json`. Neu zustimmen. |
| `Kontingent erschöpft (429)` | Das Abo ist für den Moment leer. Er versucht es von allein später wieder. |
| Der Dienst läuft, tut aber nichts | Richtig, wenn der Korb leer ist. `journalctl --user -u postbote -f` zeigt jede Runde. |

## Was der Pi nicht ändert

Er ist ein zweiter Ort, an dem derselbe Postbote läuft — **er wird nicht Teil der
App.** Die App bekommt weiterhin keinen Schlüssel, ruft kein Modell und weiß von
ihm nichts, außer dass da ein verbundenes Programm ist, das lesen und
vorschlagen darf. Geschrieben wird ausschließlich durch `propose_sheet`, und die
letzte Entscheidung triffst weiter du im Eingangskorb.
