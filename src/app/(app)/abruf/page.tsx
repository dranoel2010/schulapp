import { redirect } from "next/navigation";

/**
 * Die Abruf-Übersicht gibt es nicht mehr (Modell 23, Plan 2.2 und E):
 * abgefragt wird auf dem Tisch über „Wiederholen“, verwaltet unter
 * `/abruf/bausteine` (dort steht auch „Termine neu rechnen“),
 * `/abruf/eingang` und `/abruf/klausur`.
 */
export default function AbrufPage(): never {
  redirect("/");
}
