/**
 * Die Cookies einer IServ-Session — im Speicher, nirgends sonst.
 *
 * Reine Rechnung. Eine Session besteht aus fünf Cookies (IServAuthSession,
 * IServAuthSID, IServSession, IServSAT, IServSATId), und IServ setzt sie auf
 * zwei Pfade: /iserv/auth und /iserv. Deshalb ist der Schlüssel hier (Name,
 * Path) und nicht der Name allein — zwei gleichnamige Cookies auf zwei Pfaden
 * sind zwei Cookies, und beim Senden kommt der längere Pfad zuerst (RFC 6265,
 * 5.4).
 *
 * `Domain` wird nicht beachtet: Die App spricht mit genau einem Origin, und
 * der Client folgt keiner Weiterleitung auf einen anderen
 * (@/lib/iserv/client). Jeder Cookie ist damit host-only.
 *
 * Die Werte kommen nur über `header()` heraus — es gibt kein `toString()` und
 * kein `toJSON()`, das sie zeigte. Ein `console.log(jar)` zeigt nichts.
 */

type Eintrag = {
  name: string;
  value: string;
  path: string;
  /** ms; null = bis zum Ende der Session (hier: bis der Speicher vergisst) */
  expires: number | null;
  secure: boolean;
};

/** RFC 6265, 5.1.4: das Verzeichnis des Anfragepfads. */
export function defaultPath(requestPath: string): string {
  if (!requestPath.startsWith("/")) return "/";
  const letzter = requestPath.lastIndexOf("/");
  return letzter <= 0 ? "/" : requestPath.slice(0, letzter);
}

/** RFC 6265, 5.1.4: Passt der Cookie-Pfad zum Anfragepfad? */
export function pathMatch(cookiePath: string, requestPath: string): boolean {
  if (cookiePath === requestPath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
}

export class CookieJar {
  readonly #eintraege = new Map<string, Eintrag>();

  /** Alle `Set-Cookie` einer Antwort — auch bei 3xx. */
  setFrom(setCookieHeaders: readonly string[], requestUrl: URL, now: number): void {
    for (const header of setCookieHeaders) {
      const [paar, ...attribute] = header.split(";");
      const gleich = paar.indexOf("=");
      if (gleich <= 0) continue;

      const name = paar.slice(0, gleich).trim();
      const value = paar.slice(gleich + 1).trim();
      if (!name) continue;

      let path: string | null = null;
      let expires: number | null = null;
      let maxAge: number | null = null;
      let secure = false;

      for (const attribut of attribute) {
        const istGleich = attribut.indexOf("=");
        const key = (istGleich < 0 ? attribut : attribut.slice(0, istGleich)).trim().toLowerCase();
        const wert = istGleich < 0 ? "" : attribut.slice(istGleich + 1).trim();

        if (key === "path") {
          path = wert.startsWith("/") ? wert : null;
        } else if (key === "expires") {
          const zeit = Date.parse(wert);
          if (!Number.isNaN(zeit)) expires = zeit;
        } else if (key === "max-age") {
          if (/^-?\d+$/.test(wert)) maxAge = Number(wert);
        } else if (key === "secure") {
          secure = true;
        }
      }

      // Max-Age hat Vorrang vor Expires (RFC 6265, 5.3, Schritt 3).
      if (maxAge !== null) expires = maxAge <= 0 ? -Infinity : now + maxAge * 1000;

      const eintrag: Eintrag = {
        name,
        value,
        path: path ?? defaultPath(requestUrl.pathname),
        expires,
        secure,
      };
      const key = `${eintrag.name}\u0000${eintrag.path}`;

      if (expires !== null && expires <= now) {
        this.#eintraege.delete(key);
        continue;
      }

      // Überschreiben ans Ende: Map behält sonst die alte Stelle, und die
      // Reihenfolge beim Senden hinge an einem längst ersetzten Cookie.
      this.#eintraege.delete(key);
      this.#eintraege.set(key, eintrag);
    }
  }

  /** Der Cookie-Header für diese Adresse — leer, wenn nichts passt. */
  header(url: URL, now: number): string {
    const passend: Eintrag[] = [];

    for (const [key, eintrag] of this.#eintraege) {
      if (eintrag.expires !== null && eintrag.expires <= now) {
        this.#eintraege.delete(key);
        continue;
      }
      if (eintrag.secure && url.protocol !== "https:") continue;
      if (!pathMatch(eintrag.path, url.pathname)) continue;
      passend.push(eintrag);
    }

    // Stabil sortiert: längere Pfade zuerst, sonst in der Reihenfolge des Setzens.
    passend.sort((a, b) => b.path.length - a.path.length);

    return passend.map((eintrag) => `${eintrag.name}=${eintrag.value}`).join("; ");
  }

  /** Gibt es einen Cookie dieses Namens mit einem Wert? */
  has(name: string): boolean {
    for (const eintrag of this.#eintraege.values()) {
      if (eintrag.name === name && eintrag.value !== "") return true;
    }
    return false;
  }

  clear(): void {
    this.#eintraege.clear();
  }

  get size(): number {
    return this.#eintraege.size;
  }

  toJSON(): string {
    return `CookieJar(${this.#eintraege.size})`;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `CookieJar(${this.#eintraege.size})`;
  }
}
