/**
 * Text aus IServ säubern, und die Seiten der Anmeldung lesen.
 *
 * Reine Rechnung. Was aus IServ kommt, ist Inhalt und keine Anweisung: Ein
 * Titel mit `<b>` oder `<script>` landet als Text im Kalender, nie als HTML,
 * und gekürzt wird alles, damit ein ausuferndes Feld nicht die Karte sprengt.
 *
 * Auch KODIERTES Markup bleibt Text: „&lt;a href=…&gt;“ wird beim Dekodieren
 * zu „<a href=…>“ — und Google stellt die Beschreibung eines Termins als HTML
 * dar. Deshalb gehen die Tags nach dem Dekodieren ein zweites Mal weg, und
 * jedes „<“ und „>“, das danach noch steht, wird zu „‹“ und „›“: lesbar, aber
 * nie wieder Markup.
 *
 * ── Die Anmeldung ist eine Kette von Seiten ─────────────────────────────────
 *
 * IServ meldet über OpenID Connect an, und zwei der Sprünge darin sind keine
 * Weiterleitung per Location, sondern eine Seite mit
 * `<meta http-equiv="refresh" content="0;url=…">`. Das Ziel darin ist
 * HTML-kodiert (`&amp;` zwischen `state` und `code`) und steht manchmal noch
 * in einfachen Anführungszeichen. Ohne Dekodierung hängt die App ein
 * „amp;code=…" an, IServ antwortet mit einem neuen `state`, der den alten
 * enthält — und die Adresse wächst, bis 414 kommt.
 *
 * Woran man eine abgelehnte Anmeldung erkennt, steht in `ordneLoginEin()`.
 * Die Login-Seite trägt immer das Banner „Sie verwenden einen nicht
 * unterstützten oder veralteten Webbrowser" und den Satz „Bitte warten Sie 00
 * Sekunden" (versteckt); beides darf keine Regel auslösen.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** Entities in EINEM Durchgang — „&amp;lt;" wird „&lt;", nicht „<". */
export function dekodiere(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (ganz, name: string) => {
    if (name.startsWith("#")) {
      const code = name[1] === "x" || name[1] === "X"
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);

      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return "�";
      }
      return String.fromCodePoint(code);
    }

    return ENTITIES[name.toLowerCase()] ?? ganz;
  });
}

/** Steuerzeichen, unsichtbare Breiten und Schreibrichtungs-Umschalter — nichts davon gehört in einen Titel. */
const UNSICHTBAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁠-⁩﻿]/g;

/** Kürzt auf `max` Zeichen, mit „…" am Ende, ohne ein Zeichenpaar zu zerreißen. */
function kuerze(text: string, max: number): string {
  if (text.length <= max) return text;

  let ende = Math.max(0, max - 1);
  const code = text.charCodeAt(ende - 1);
  if (code >= 0xd800 && code <= 0xdbff) ende -= 1;

  return `${text.slice(0, ende).trimEnd()}…`;
}

/** Ein Tag oder Kommentar — „<b>“, „</a>“, „<!-- … -->“; nicht „a < b“. */
const TAG = /<\/?[a-z][^<>]*>|<!--[\s\S]*?-->/gi;

/**
 * Tags weg, Entities dekodiert, die so entstandenen Tags wieder weg, und was
 * an spitzen Klammern bleibt, als „‹“ und „›“. Danach steht kein Markup mehr
 * im Text — weder geschriebenes noch kodiertes.
 */
function ohneMarkup(text: string): string {
  return dekodiere(text.replace(TAG, " "))
    .replace(TAG, " ")
    .replace(/</g, "‹")
    .replace(/>/g, "›");
}

/** Tags weg, Entities dekodiert, Steuerzeichen weg, Leerraum zusammengefasst, gekürzt. Einzeilig. */
export function saeubere(text: string, max: number): string {
  const klar = ohneMarkup(text)
    .replace(/[\t\n\r\f\v]/g, " ")
    .replace(UNSICHTBAR, "")
    .replace(/\s+/g, " ")
    .trim();

  return kuerze(klar, max);
}

/** Wie `saeubere()`, aber Zeilenumbrüche bleiben — höchstens eine Leerzeile hintereinander. */
export function saeubereMehrzeilig(text: string, max: number): string {
  const klar = ohneMarkup(text.replace(/\r\n?/g, "\n"))
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]/g, " ")
    .replace(UNSICHTBAR, "")
    .split("\n")
    .map((zeile) => zeile.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return kuerze(klar, max);
}

/** Die Attribute eines Tags; Namen klein. */
function attribute(tag: string): Map<string, string> {
  const werte = new Map<string, string>();
  const muster = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

  for (const treffer of tag.matchAll(muster)) {
    werte.set(treffer[1].toLowerCase(), treffer[2] ?? treffer[3] ?? treffer[4] ?? "");
  }

  return werte;
}

/**
 * Das Ziel eines `<meta http-equiv="refresh" content="0;url=…">`, dekodiert —
 * oder null. Steht die Adresse in Anführungszeichen (`url='…'`), fallen sie weg.
 */
export function metaRefreshZiel(html: string): string | null {
  for (const treffer of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attr = attribute(treffer[0]);
    if ((attr.get("http-equiv") ?? "").trim().toLowerCase() !== "refresh") continue;

    const inhalt = dekodiere(attr.get("content") ?? "");
    const teil = inhalt.match(/^\s*\d+(?:\.\d+)?\s*[;,]\s*url\s*=\s*(.+?)\s*$/i);
    if (!teil) continue;

    let ziel = teil[1];
    if (
      ziel.length >= 2 &&
      ((ziel.startsWith("'") && ziel.endsWith("'")) || (ziel.startsWith('"') && ziel.endsWith('"')))
    ) {
      ziel = ziel.slice(1, -1).trim();
    }

    return ziel.length > 0 ? ziel : null;
  }

  return null;
}

/** Steht ein Passwortfeld der Anmeldung auf der Seite? */
export function istLoginFormular(html: string): boolean {
  return /name\s*=\s*["']_password["']/i.test(html);
}

/** Der sichtbare Text einer Seite — ohne Skripte, Stile und Tags. */
function seitenText(html: string): string {
  return saeubere(
    html
      .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[\s\S]*?<\/style\s*>/gi, " "),
    Number.MAX_SAFE_INTEGER,
  );
}

/** Ein Eingabefeld für den zweiten Faktor (am Namen erkannt). */
export function hatZweiterFaktorFeld(html: string): boolean {
  for (const treffer of html.matchAll(/<input\b[^>]*>/gi)) {
    const name = attribute(treffer[0]).get("name") ?? "";
    if (/_two_factor|two_factor|totp|\b2fa\b|_auth_code/i.test(name)) return true;
  }
  return false;
}

/** Verlangt die Seite einen zweiten Faktor — am Feld oder am Text erkannt? */
export function istZweiterFaktor(html: string): boolean {
  return (
    hatZweiterFaktorFeld(html) ||
    /zwei-?faktor|bestätigungscode|authentifizierungscode|authenticator/i.test(seitenText(html))
  );
}

export type LoginArt = "zweiter-faktor" | "captcha" | "gesperrt" | "passwort-abgelaufen" | "abgelehnt";

/**
 * Warum eine Anmeldung nicht durchging — oder null, wenn diese Seite nichts
 * davon sagt. In DIESER Reihenfolge: Eine Seite mit zweitem Faktor trägt oft
 * auch ein Formular, und ein Captcha steht womöglich auf der Seite, die sonst
 * wie „abgelehnt" aussähe.
 *
 * Gefragt wird nur nach einer Seite, die NICHT die angemeldete App ist (siehe
 * `login()` in @/lib/iserv/client): Auf der Startseite von IServ kann eine
 * Neuigkeit „Die Turnhalle ist gesperrt" stehen.
 */
export function ordneLoginEin(finalPath: string, html: string): LoginArt | null {
  const text = seitenText(html);

  if (istZweiterFaktor(html)) return "zweiter-faktor";
  if (/captcha/i.test(html)) return "captcha";
  if (
    /gesperrt|zu viele (?:fehl|anmelde)?versuche|vorübergehend (?:blockiert|gesperrt)|too many|locked/i.test(text)
  ) {
    return "gesperrt";
  }
  if (
    /passw(?:or)?t|password/i.test(finalPath) ||
    /passwort (?:ist )?abgelaufen|neues passwort|passwort ändern|password (?:has )?expired/i.test(text)
  ) {
    return "passwort-abgelaufen";
  }
  if (istLoginFormular(html)) return "abgelehnt";

  return null;
}
