/**
 * Die Queue der Abgleiche: immer nur einer zur Zeit — und wer auf einen wartet,
 * wartet nicht länger, als er sich vorgenommen hat.
 *
 * Reine Rechnung mit Promises, ohne Datenbank und ohne Google; was ein Lauf
 * tut, reicht @/lib/calendar/sync herein. Warum es die Queue überhaupt gibt und
 * warum sie im Speicher lebt, steht dort im Kopf.
 *
 * ── Anhängen statt einreihen ─────────────────────────────────────────────────
 *
 * Wartet für einen Schlüssel schon ein Lauf, der noch nicht begonnen hat, hängt
 * sich die nächste Anfrage an ihn: Der wartende Lauf liest die Datenbank erst
 * beim Start und nimmt die neue Änderung damit ohnehin mit. Ein zweiter Lauf
 * dahinter fände nichts mehr zu tun.
 *
 * Wer sich anhängt, bringt aber seine eigenen Grenzen mit, und zwei davon
 * gehören auseinander:
 *
 * - **`frist`** — bis wann der Lauf arbeiten darf. Hängen sich mehrere an,
 *   gilt die GROSSZÜGIGSTE, und gerechnet wird erst beim Start. Sonst erbte
 *   eine Änderung, die sich an einen wartenden Knopfdruck hängt, dessen
 *   25 Sekunden — die beim Start längst abgelaufen sein können —, und bliebe
 *   bis zum nächsten Cron liegen.
 * - **`geduld`** — bis wann der Anfragende höchstens auf das Ergebnis wartet.
 *   Die gilt für jeden für sich. Ist sie um, bekommt er `zuLange()` zurück, und
 *   der Lauf arbeitet ungestört weiter. So hängt der Knopf nicht minutenlang
 *   hinter einem langen Lauf, und der Cron antwortet vor dem `--max-time` von
 *   curl, auch wenn er hinter einem anderen Lauf gewartet hat.
 */

export type QueueRequest = {
  /** Bis wann (ms) der Lauf arbeiten darf; `null`: so lange, wie sein eigenes Budget reicht */
  frist: number | null;
  /** Bis wann (ms) der Anfragende höchstens wartet; `null`: bis der Lauf fertig ist */
  geduld: number | null;
};

type Eintrag<T> = {
  lauf: Promise<T>;
  frist: number | null;
};

export type Queue<T> = {
  /**
   * Einen Lauf für diesen Schlüssel anstellen oder sich an den wartenden
   * hängen. `starte` wird nur gebraucht, wenn ein neuer Lauf entsteht — es
   * bekommt beim Start die großzügigste Frist aller Anfragenden.
   */
  request(
    key: string,
    anfrage: QueueRequest,
    starte: (frist: number | null) => Promise<T>,
    zuLange: () => T,
  ): Promise<T>;
  /** Läuft für diesen Schlüssel gerade ein Lauf, oder wartet einer? */
  busy(key: string): boolean;
};

/** Die großzügigere von zwei Fristen — keine Frist ist die großzügigste. */
export function laterFrist(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.max(a, b);
}

export function createQueue<T>(deps: { now?: () => number } = {}): Queue<T> {
  const now = deps.now ?? Date.now;

  // Eine Kette für alle Schlüssel: Es läuft überhaupt nur ein Abgleich zur Zeit.
  let tail: Promise<void> = Promise.resolve();
  const waiting = new Map<string, Eintrag<T>>();
  const running = new Set<string>();

  function hoechstensBis(lauf: Promise<T>, bis: number, zuLange: () => T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const abbruch = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(zuLange()), Math.max(0, bis - now()));
    });

    return Promise.race([lauf, abbruch]).finally(() => clearTimeout(timer));
  }

  return {
    request(key, anfrage, starte, zuLange) {
      let eintrag = waiting.get(key);

      if (eintrag) {
        eintrag.frist = laterFrist(eintrag.frist, anfrage.frist);
      } else {
        const neu = { frist: anfrage.frist } as Eintrag<T>;

        neu.lauf = tail.then(async () => {
          waiting.delete(key);
          running.add(key);

          try {
            return await starte(neu.frist);
          } finally {
            running.delete(key);
          }
        });

        tail = neu.lauf.then(
          () => undefined,
          () => undefined,
        );
        waiting.set(key, neu);
        eintrag = neu;
      }

      return anfrage.geduld === null
        ? eintrag.lauf
        : hoechstensBis(eintrag.lauf, anfrage.geduld, zuLange);
    },

    busy(key) {
      return running.has(key) || waiting.has(key);
    },
  };
}
