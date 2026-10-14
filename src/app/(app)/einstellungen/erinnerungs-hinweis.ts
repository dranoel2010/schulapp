/**
 * Der Kasten unter den Erinnerungen. Der Satz über die Entwicklung gilt nur
 * dort oder wenn der Dienst im Hintergrund fehlt; in der gebauten App steht
 * höchstens der Rat zur installierten App, und installiert gar nichts.
 */
export function erinnerungsHinweis(z: {
  status: string;
  hasWorker: boolean;
  entwicklung: boolean;
  installiert: boolean;
}): string | null {
  if (z.status === "unsupported" || z.status === "checking" || z.status === "unconfigured") return null;
  if (z.entwicklung || !z.hasWorker)
    return "Erinnerungen kommen nur in der gebauten App an. In der Entwicklung läuft der Dienst im Hintergrund nicht.";
  return z.installiert ? null : "Am zuverlässigsten in der installierten App.";
}
