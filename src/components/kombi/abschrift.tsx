import { abschriftTeile } from "@/lib/kombi/abschrift";
import { fxTeile } from "@/lib/kombi/text";

/**
 * Die Abschrift eines Blatts (Prototyp `abschriftEl`, Z. 3236–3241) als
 * React-Elemente, nie über innerHTML aus Daten: `h3` für Überschriften,
 * `.formel` (kursiv in Newsreader) für Formelzeilen, sonst `p` mit `{…}`
 * als `.f-in`. Ohne Text „Abschrift folgt“ als `.p-sub`.
 */
export function Abschrift({ absaetze }: { absaetze: string[] }) {
  const teile = abschriftTeile(absaetze);
  return (
    <div className="abschrift">
      {teile.length === 0 ? (
        <p className="p-sub">Abschrift folgt</p>
      ) : (
        teile.map((t, i) =>
          t.art === "h" ? (
            <h3 key={i}>{t.text}</h3>
          ) : t.art === "f" ? (
            <span key={i} className="formel">
              {t.text}
            </span>
          ) : (
            <p key={i}>
              {fxTeile(t.text).map((f, k) =>
                f.formel ? (
                  <span key={k} className={`f-in${f.lead ? " lead" : ""}`}>
                    {f.text}
                  </span>
                ) : (
                  f.text
                ),
              )}
            </p>
          ),
        )
      )}
    </div>
  );
}
