import { redirect } from "next/navigation";

/**
 * Die alte Sitzung („Abend“) gibt es nicht mehr: Wiederholen läuft auf dem
 * Tisch, ein Thema am Stück (Modell 23, Plan E). Wer die alte Adresse aufruft,
 * landet auf der Startseite, dort steht „Wiederholen“.
 */
export default function SitzungPage(): never {
  redirect("/");
}
