import type { BlattAntwort } from "./auftrag";

/**
 * Zwei Beispielblätter aus dem Prototyp (`UEBUNG`, Z. 1231), in der Form,
 * in der Claude antwortet (`BLATT_FORM`), samt Abschriften, in denen jedes
 * Zitat wörtlich steht. Für die Tests (gemockter Claude-Aufruf) und die
 * lokale Saat (scripts/saat-arbeitsblatt.mts) — nie für den Betrieb.
 */

export const ABSCHRIFT_MATHE = [
  "Scheitelpunktform",
  "f(x) = a(x − d)² + e, Scheitelpunkt S(d | e)",
  "Ist a > 0, ist die Parabel nach oben geöffnet, ist a < 0, nach unten.",
  "Ist |a| > 1, ist die Parabel gestreckt, ist |a| < 1, gestaucht.",
  "Die Symmetrieachse ist die Gerade x = d.",
  "Verschiebung: d nach rechts (Minus in der Klammer), e nach oben.",
  "Übung 1: Lies den Scheitelpunkt ab und gib an, ob die Parabel nach oben oder unten geöffnet ist.",
  "Übung 2: Die Normalparabel wird um 1 nach rechts und um 4 nach unten verschoben.",
  "Quadratische Ergänzung: x² + px + q = (x + p/2)² − (p/2)² + q",
  "Beispiel: x² − 4x + 1 = x² − 4x + 2² − 2² + 1 = (x − 2)² − 3",
  "Nullstellen mit der pq-Formel: x = −p/2 ± √((p/2)² − q)",
].join("\n");

const p = (text: string) => ({ art: "p" as const, text });
const erg = (text: string) => ({ art: "erg" as const, text });
const hint = (text: string) => ({ art: "hint" as const, text });
const teile = (t: string[]) => ({ art: "teile" as const, teile: t });
const eq = (z: [string, string][]) => ({
  art: "eq" as const,
  zeilen: z.map(([links, rechts]) => ({ links, rechts })),
});

/** Mathematik · Quadratische Funktionen — wörtlich aus dem Prototyp. */
export const UEBUNG_MATHE: BlattAntwort = {
  teil: "Scheitelpunktform",
  minuten: 20,
  grund: "",
  aufgaben: [
    {
      kurz: "Scheitelpunkt ablesen",
      q: "Lies den Scheitelpunkt ab. Ist die Parabel nach oben oder nach unten geöffnet?",
      teile: ["{f(x) = (x − 4)² + 1}", "{g(x) = −(x + 3)² + 2}", "{h(x) = 2(x − 1)² − 5}"],
      platz: 15,
      zitat: "Übung 1: Lies den Scheitelpunkt ab",
      l: [
        teile([
          "{S(4 | 1)}, nach oben geöffnet",
          "{S(−3 | 2)}, nach unten geöffnet, weil {a = −1}",
          "{S(1 | −5)}, nach oben geöffnet und gestreckt, weil {a = 2}",
        ]),
        hint("Das Vorzeichen in der Klammer dreht sich um: {(x + 3)} heißt {d = −3}."),
      ],
    },
    {
      kurz: "Gleichung aufstellen",
      q: "Die Normalparabel wird um 2 nach links und um 3 nach unten verschoben. Gib die Funktionsgleichung in Scheitelpunktform und den Scheitelpunkt an.",
      platz: 15,
      zitat: "Die Normalparabel wird um 1 nach rechts und um 4 nach unten verschoben.",
      l: [
        p("Nach links heißt {d = −2}, nach unten heißt {e = −3}."),
        erg("{f(x) = (x + 2)² − 3}, Scheitelpunkt {S(−2 | −3)}"),
        hint("Nach links steht in der Klammer ein Plus."),
      ],
    },
    {
      kurz: "Symmetrieachse und Form",
      q: "Gib die Symmetrieachse von {f(x) = −½(x − 5)² + 4} an. Ist die Parabel nach oben oder nach unten geöffnet, gestreckt oder gestaucht?",
      platz: 15,
      zitat: "Die Symmetrieachse ist die Gerade x = d.",
      l: [
        p("Der Scheitelpunkt ist {S(5 | 4)}. Die Symmetrieachse ist die senkrechte Gerade durch ihn."),
        erg("Symmetrieachse {x = 5}"),
        p("Nach unten geöffnet, weil {a = −½} negativ ist. Gestaucht, weil {|a|} kleiner als 1 ist."),
      ],
    },
    {
      kurz: "Ergänzen: {x² − 6x + 11}",
      q: "Bring {f(x) = x² − 6x + 11} in Scheitelpunktform und gib den Scheitelpunkt an.",
      platz: 25,
      zitat: "Quadratische Ergänzung: x² + px + q = (x + p/2)² − (p/2)² + q",
      l: [
        eq([
          ["{f(x)}", "{x² − 6x + 3² − 3² + 11}"],
          ["", "{(x − 3)² − 9 + 11}"],
          ["", "{(x − 3)² + 2}"],
        ]),
        erg("Scheitelpunkt {S(3 | 2)}"),
        hint("Die Ergänzung ist {(6/2)² = 9}. Sie wird gleich wieder abgezogen."),
      ],
    },
    {
      kurz: "Ergänzen: {x² + 8x + 10}",
      q: "Bring {f(x) = x² + 8x + 10} in Scheitelpunktform und gib den Scheitelpunkt an.",
      platz: 25,
      zitat: "Beispiel: x² − 4x + 1 = x² − 4x + 2² − 2² + 1 = (x − 2)² − 3",
      l: [
        eq([
          ["{f(x)}", "{x² + 8x + 4² − 4² + 10}"],
          ["", "{(x + 4)² − 16 + 10}"],
          ["", "{(x + 4)² − 6}"],
        ]),
        erg("Scheitelpunkt {S(−4 | −6)}"),
      ],
    },
    {
      kurz: "Scheitelpunkt und Nullstellen",
      q: "Bring {f(x) = x² − 2x − 8} in Scheitelpunktform. Bestimme dann die Nullstellen mit der pq-Formel.",
      platz: 40,
      zitat: "Nullstellen mit der pq-Formel",
      l: [
        eq([
          ["{f(x)}", "{x² − 2x + 1² − 1² − 8}"],
          ["", "{(x − 1)² − 9}"],
        ]),
        p("Scheitelpunkt {S(1 | −9)}."),
        p("pq-Formel mit {p = −2} und {q = −8}:"),
        eq([
          ["{x}", "{1 ± √(1² + 8)}"],
          ["", "{1 ± √9 = 1 ± 3}"],
        ]),
        erg("Nullstellen {x₁ = −2} und {x₂ = 4}"),
        hint("Hier ist {p = −2}, also {−p/2 = 1} und nicht {−1}."),
      ],
    },
  ],
};

export const ABSCHRIFT_FRANZOESISCH = [
  "Passé composé mit être",
  "Diese Verben bilden das passé composé mit être: aller, venir, partir, arriver, tomber, rester, naître, mourir, sortir, entrer.",
  "Das Partizip wird an das Subjekt angeglichen: elle est allée, ils sont partis.",
  "je suis, tu es, il/elle est, nous sommes, vous êtes, ils/elles sont",
  "Reflexive Verben bilden das passé composé immer mit être: je me suis levé(e).",
  "Ein Mann in der Gruppe reicht für die männliche Pluralform.",
].join("\n");

/** Französisch · Passé composé mit être — wörtlich aus dem Prototyp. */
export const UEBUNG_FRANZOESISCH: BlattAntwort = {
  teil: "Bildung und Angleichung",
  minuten: 20,
  grund: "",
  aufgaben: [
    {
      kurz: "Partizipien bilden",
      q: "Bilde das Partizip Perfekt.",
      teile: ["aller → ___", "venir → ___", "partir → ___", "tomber → ___", "naître → ___", "mourir → ___"],
      fr: true,
      platz: 0,
      zitat: "aller, venir, partir, arriver, tomber, rester, naître, mourir",
      l: [teile(["allé", "venu", "parti", "tombé", "né", "mort"])],
    },
    {
      kurz: "Formen von être",
      q: "Setze die passende Form von être ein.",
      teile: ["Je ___ arrivé.", "Tu ___ partie.", "Nous ___ restés.", "Elles ___ venues."],
      fr: true,
      platz: 0,
      zitat: "je suis, tu es, il/elle est, nous sommes, vous êtes, ils/elles sont",
      l: [teile(["suis", "es", "sommes", "sont"])],
    },
    {
      kurz: "Ins passé composé setzen",
      q: "Setze das Verb ins passé composé.",
      teile: ["Il ___ (aller) à Paris.", "Elle ___ (tomber).", "Ils ___ (partir) hier."],
      fr: true,
      platz: 0,
      zitat: "Diese Verben bilden das passé composé mit être",
      l: [teile(["Il est allé à Paris.", "Elle est tombée.", "Ils sont partis hier."])],
    },
    {
      kurz: "Angleichung",
      q: "Achte auf die Angleichung des Partizips an das Subjekt.",
      teile: ["Marie ___ (arriver) à huit heures.", "Les filles ___ (rester) à la maison.", "Paul et Julie ___ (sortir)."],
      fr: true,
      platz: 0,
      zitat: "Das Partizip wird an das Subjekt angeglichen",
      l: [
        teile(["Marie est arrivée à huit heures.", "Les filles sont restées à la maison.", "Paul et Julie sont sortis."]),
        hint("Ein Mann in der Gruppe reicht für die männliche Pluralform: sortis, nicht sorties."),
      ],
    },
    {
      kurz: "Reflexive Verben",
      q: "Reflexive Verben bilden das passé composé immer mit être.",
      teile: ["Je me ___ (lever) à sept heures. (Ein Mädchen spricht.)", "Nous nous ___ (lever) tard. (Jungen)"],
      fr: true,
      platz: 0,
      zitat: "Reflexive Verben bilden das passé composé immer mit être",
      l: [teile(["Je me suis levée à sept heures.", "Nous nous sommes levés tard."])],
    },
    {
      kurz: "Übersetzen",
      q: "Übersetze ins Französische. Schreib jeden Satz auf eine eigene Linie.",
      teile: ["Sie (eine Frau) ist ins Kino gegangen.", "Wir (Mädchen) sind gestern gekommen.", "Er ist 1990 geboren."],
      platz: 3,
      zitat: "elle est allée, ils sont partis",
      l: [teile(["Elle est allée au cinéma.", "Nous sommes venues hier.", "Il est né en 1990."])],
    },
  ],
};
