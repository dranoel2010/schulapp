import "@/components/kombi/form/form.css";

/**
 * Anmeldung, Einrichtung und Verbinden im Stil von Modell 23 (Plan 2.2):
 * Papier `--bg`, linke Kante 22px, Titel 28/650, Felder wie die Zeile,
 * Primärknopf `.btn` — ohne Zeile und ohne Shell. Am Rechner steht der
 * Inhalt in derselben mittigen Spalte wie die App (bis 680px).
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="solo">
      <div className="solo-in">{children}</div>
    </main>
  );
}
