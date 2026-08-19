/**
 * Rahmen für Anmelden und Einrichten — hier ist der Nutzer noch nicht in der
 * App, also gibt es keine Navigation.
 *
 * Am Handy eine einzelne, senkrecht zentrierte Spalte. Ab mittlerer Breite
 * zwei gleich breite Spalten über die volle Höhe. Beide Spalten liefert die
 * Seite selbst: links das Formular, rechts eine ruhige Fläche mit einem Satz
 * dazu — der lautet beim Anmelden anders als bei der Einrichtung, und nur die
 * Seite weiß, welche der beiden gerade dran ist.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <main className="flex flex-1 flex-col md:grid md:grid-cols-2">
      {children}
    </main>
  );
}
