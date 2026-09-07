import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Die Sperre, die sich alle teilen, die den Zugang benutzen.
 *
 * **Sie hing bis zum 7.9.2026 im Postboten** und war dort richtig aufgehoben,
 * solange er der einzige Prozess war, der `zugang.json` anfasst. Mit der
 * Nachlese ist er es nicht mehr, und damit wird aus einer privaten Vorsichts-
 * maßnahme eine Abmachung zwischen zweien — die gehört nicht in eine der beiden
 * Dateien, sonst müsste die zweite die erste importieren und startete dabei
 * deren `main()` mit.
 *
 * **Worum es geht, steht unverändert:** zwei Läufe auf derselben `zugang.json`
 * beenden einander. Das Erneuerungs-Token wird bei jedem Gebrauch getauscht;
 * der eine holt sich ein frisches und schreibt es in die Datei, der andere hat
 * das alte noch im Speicher und legt es beim nächsten Mal vor — und das ist
 * genau das Muster, auf das die App wartet. Sie kann „mein zweites Ich" nicht
 * von „jemand hat das Token" unterscheiden und tut das Richtige: sie lehnt ab.
 * Der zweite Lauf stirbt dann mit `invalid_grant`, und im schlechteren Fall ist
 * die ganze Verbindung fällig und muss neu zugestimmt werden.
 *
 * Gemessen am 25.8.2026, und seitdem gilt: **immer nur einer.** Die Nachlese
 * ändert daran nichts, sie erbt es — wer nachlesen will, hält den Postboten so
 * lange an. Das ist keine Unbequemlichkeit, die sich wegprogrammieren ließe:
 * beide sprechen mit derselben App unter demselben Zugang, und der Zugang hat
 * nur ein Token.
 *
 * Die Sperre ist eine Datei mit einer Prozessnummer, keine Zeitmarke: nach
 * einem Absturz oder einem harten Neustart steht dort eine Nummer, unter der
 * niemand mehr läuft, und dann gilt sie nicht. Ein Dienst, der sich nach einem
 * Stromausfall selbst aussperrt, wäre die schlechtere Störung.
 */

const HIER = path.dirname(fileURLToPath(import.meta.url));

/** Die eine Sperrdatei. Ihr Name ist die Abmachung. */
export const SPERRE = path.join(HIER, "lauf.lock");

/** Läuft unter dieser Nummer noch ein Prozess? Signal 0 fragt, ohne zu treffen. */
function lebt(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Nimmt die Sperre oder wirft.
 *
 * `wer` steht in der Fehlermeldung und sagt dem Menschen, was er gerade
 * starten wollte — die Nummer im Text gehört dagegen dem, der schon läuft, und
 * der kann ein anderer sein. Deshalb nennt die Meldung beide Rollen: wer sie
 * liest, hat oft vergessen, dass auf dem NAS ein Postbote als Dienst steht.
 */
export function sperren(wer: string): void {
  // Zwei Versuche: der erste greift nach der Sperre, der zweite kommt nur dann
  // dran, wenn dazwischen eine verwaiste weggeräumt wurde.
  for (let versuch = 0; versuch < 2; versuch += 1) {
    try {
      // `wx` heißt: anlegen, aber nur wenn es sie noch nicht gibt — und zwar in
      // einem Zug. Erst prüfen und dann schreiben hat eine Lücke dazwischen,
      // und genau durch die sind am 25.8.2026 beim Ausprobieren zwei Postboten
      // gleichzeitig gestartet. Beide sahen keine Sperre, beide legten eine an,
      // beide holten sich mit demselben Token ein neues — und dem zweiten wurde
      // es zu Recht verweigert.
      writeFileSync(SPERRE, `${process.pid}\n`, { flag: "wx" });
      break;
    } catch (grund) {
      if ((grund as NodeJS.ErrnoException).code !== "EEXIST") throw grund;

      const pid = existsSync(SPERRE)
        ? Number(readFileSync(SPERRE, "utf8").trim())
        : 0;

      if (Number.isFinite(pid) && pid > 0 && lebt(pid)) {
        throw new Error(
          `${wer} kann nicht starten: es läuft schon ein Lauf (Prozess ${pid}).\n\n` +
            "Postbote und Nachlese teilen sich einen Zugang, dessen Token bei " +
            "jedem Gebrauch getauscht wird — zwei auf einmal nehmen sich " +
            "gegenseitig die Verbindung weg.\n\n" +
            "Auf dem NAS läuft der Postbote als Dienst; dort hält ihn\n" +
            "  sudo docker stop postbote-postbote-1\n" +
            "an, und danach startet ihn\n" +
            "  sudo docker start postbote-postbote-1\n" +
            "wieder.\n\n" +
            `Sonst beenden mit: kill ${pid}\n` +
            `Läuft dort nichts mehr, kann die Sperre weg: rm ${SPERRE}`,
        );
      }

      // Verwaist — die Nummer gehört keinem laufenden Prozess mehr.
      rmSync(SPERRE, { force: true });
    }
  }

  // Aufgeräumt wird auf jedem Weg hinaus — auch bei einem Fehler, auch bei
  // Strg-C. Bliebe die Datei liegen, hilfe immerhin die Prüfung auf die
  // Prozessnummer beim nächsten Start.
  const loesen = () => {
    try {
      rmSync(SPERRE, { force: true });
    } catch {
      // Beim Hinausgehen ist eine liegengebliebene Datei kein Grund zu lärmen.
    }
  };

  process.on("exit", loesen);
}
