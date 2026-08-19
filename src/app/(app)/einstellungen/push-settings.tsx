"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/input";

import type { ReminderTimeState } from "./actions";

/**
 * Erinnerungen einschalten — der heikelste Teil der App, weil der Browser
 * mitreden muss.
 *
 * Die Berechtigung wird ausschließlich nach einem Fingertipp angefragt, nie
 * beim Laden der Seite: Chrome merkt sich weggetippte Nachfragen und blendet
 * sie beim nächsten Mal ganz aus.
 */

/** Wie lange auf den Service Worker gewartet wird, bevor wir aufgeben. */
const READY_TIMEOUT_MS = 4000;

/** Muss zur Prüfung in actions.ts passen. */
const FIRST_HOUR = 6;
const LAST_HOUR = 22;

type Status =
  /** Der Browser wird gerade gefragt — nur der erste Augenblick. */
  | "checking"
  /** Kein Service Worker oder kein PushManager. */
  | "unsupported"
  /** Dem Server fehlt der VAPID-Schlüssel. */
  | "unconfigured"
  /** Alles da, aber noch nicht eingeschaltet. */
  | "off"
  /** Der Nutzer hat abgelehnt. */
  | "denied"
  /** Läuft. */
  | "on";

type Busy = "enable" | "disable" | "test" | null;

/**
 * Der öffentliche VAPID-Schlüssel steht als base64url in der Umgebung, der
 * Browser will ihn als Bytes.
 *
 * base64url benutzt "-" und "_" statt "+" und "/" und lässt die "="-Auffüllung
 * am Ende weg. Beides muss zurückgedreht werden, sonst kann atob() damit
 * nichts anfangen.
 *
 * Rückgabetyp BufferSource, weil applicationServerKey genau das erwartet —
 * Uint8Array trägt je nach TypeScript-Fassung einen anderen Puffertyp.
 */
function base64UrlToBytes(value: string): BufferSource {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

/**
 * Die Anmeldung des Service Workers.
 *
 * Direkt nach dem Laden kann sie noch fehlen, weil sie erst nach dem
 * load-Ereignis passiert — deshalb im zweiten Anlauf auf ready warten. In der
 * Entwicklung läuft gar kein Service Worker, dort löst ready nie aus: nach ein
 * paar Sekunden geben wir auf.
 */
async function findRegistration(): Promise<ServiceWorkerRegistration | null> {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;

  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), READY_TIMEOUT_MS);
    }),
  ]);
}

/** Steht später in den Einstellungen als Name des Geräts. */
function deviceLabel(): string {
  const agent = navigator.userAgent;

  const browser = /Edg\//.test(agent)
    ? "Edge"
    : /OPR\//.test(agent)
      ? "Opera"
      : /Firefox\//.test(agent)
        ? "Firefox"
        : /Chrome\//.test(agent)
          ? "Chrome"
          : /Safari\//.test(agent)
            ? "Safari"
            : "Browser";

  const system = /Android/.test(agent)
    ? "Android"
    : /iPhone|iPad/.test(agent)
      ? "iPhone"
      : /Windows/.test(agent)
        ? "Windows"
        : /Mac OS X/.test(agent)
          ? "Mac"
          : null;

  return system ? `${browser} auf ${system}` : browser;
}

/** Die Meldung des Servers, wenn er eine geschickt hat. */
async function messageFrom(
  response: Response,
  fallback: string,
): Promise<string> {
  const data: unknown = await response.json().catch(() => null);

  if (data && typeof data === "object" && "error" in data) {
    const message = (data as { error: unknown }).error;
    if (typeof message === "string" && message.length > 0) return message;
  }

  return fallback;
}

export type PushSettingsProps = {
  /** Öffentlicher VAPID-Schlüssel; leer, wenn der Server keinen hat. */
  vapidPublicKey: string;
};

export function PushSettings({ vapidPublicKey }: PushSettingsProps) {
  const [status, setStatus] = useState<Status>("checking");
  const [hasWorker, setHasWorker] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (!cancelled) setStatus("unsupported");
        return;
      }

      if (!vapidPublicKey) {
        if (!cancelled) setStatus("unconfigured");
        return;
      }

      const registration = await findRegistration();
      const subscription = registration
        ? await registration.pushManager.getSubscription()
        : null;

      if (cancelled) return;

      setHasWorker(Boolean(registration));

      if (Notification.permission === "denied") {
        setStatus("denied");
      } else if (subscription && Notification.permission === "granted") {
        setStatus("on");
      } else {
        setStatus("off");
      }
    }

    void detect();

    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    setError(null);
    setNote(null);

    if (!hasWorker) {
      setError(
        "Der Dienst im Hintergrund läuft hier nicht — deshalb kann sich das Gerät nicht anmelden. Das klappt nur in der gebauten App.",
      );
      return;
    }

    setBusy("enable");

    try {
      // Ohne vorheriges await: für Chrome zählt sonst der Fingertipp nicht
      // mehr als Anlass für die Nachfrage.
      const permission = await Notification.requestPermission();

      if (permission === "denied") {
        setStatus("denied");
        return;
      }

      if (permission !== "granted") {
        setError(
          "Die Nachfrage ist weggegangen, ohne dass du zugestimmt hast. Du kannst es gleich noch einmal versuchen.",
        );
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64UrlToBytes(vapidPublicKey),
        }));

      const data = subscription.toJSON();
      const p256dh = data.keys?.p256dh;
      const auth = data.keys?.auth;

      if (!data.endpoint || !p256dh || !auth) {
        if (!existing) await subscription.unsubscribe();
        setError("Der Browser hat eine unvollständige Anmeldung geliefert.");
        return;
      }

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: data.endpoint,
          keys: { p256dh, auth },
          label: deviceLabel(),
        }),
      });

      if (!response.ok) {
        // Sonst hielte der Browser eine Anmeldung, von der der Server nichts weiß.
        if (!existing) await subscription.unsubscribe();
        setError(
          await messageFrom(response, "Das Gerät ließ sich nicht anmelden."),
        );
        return;
      }

      setStatus("on");
      setNote("Eingeschaltet. Schick dir am besten gleich eine Testnachricht.");
    } catch {
      setError("Das hat nicht geklappt. Versuch es gleich noch einmal.");
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setError(null);
    setNote(null);
    setBusy("disable");

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();

      if (subscription) {
        // Erst dem Server Bescheid geben, solange die Adresse noch gilt.
        // Geht das schief, räumt er das Gerät beim nächsten Versand selbst weg.
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => null);

        await subscription.unsubscribe();
      }

      setStatus("off");
      setNote("Aus. Auf dieses Gerät kommt jetzt nichts mehr.");
    } catch {
      setError("Das Abmelden hat nicht geklappt. Versuch es gleich noch einmal.");
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setError(null);
    setNote(null);
    setBusy("test");

    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const data: unknown = await response.json().catch(() => null);
      const ok =
        response.ok &&
        Boolean(data) &&
        typeof data === "object" &&
        (data as { ok?: unknown }).ok === true;

      if (ok) {
        setNote("Ist raus. Die Nachricht sollte gleich auf dem Handy stehen.");
        return;
      }

      const message =
        data && typeof data === "object" && "error" in data
          ? (data as { error: unknown }).error
          : null;

      setError(
        typeof message === "string" && message.length > 0
          ? message
          : "Die Testnachricht ließ sich nicht schicken.",
      );
    } catch {
      setError("Die Testnachricht ließ sich nicht schicken.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {status === "checking" ? (
        <p className="text-sm text-muted">
          Einen Moment, der Browser wird gefragt.
        </p>
      ) : null}

      {status === "unsupported" ? (
        <p className="text-sm text-muted">
          Dieser Browser kann keine Erinnerungen empfangen. Auf dem Handy klappt
          es mit Chrome auf Android.
        </p>
      ) : null}

      {status === "unconfigured" ? (
        <p className="text-sm text-muted">
          Auf diesem Server fehlen die Schlüssel für Push-Nachrichten. Bis sie
          eingetragen sind, kann die App nichts schicken.
        </p>
      ) : null}

      {status === "off" ? (
        <>
          <p className="text-sm text-muted">
            Du bekommst eine tägliche Erinnerung zur eingestellten Zeit und eine
            Meldung, wenn eine Prüfung näher rückt.
          </p>
          <Button type="button" onClick={enable} loading={busy === "enable"}>
            Erinnerungen einschalten
          </Button>
        </>
      ) : null}

      {status === "denied" ? (
        <div className="space-y-2 text-sm text-muted">
          <p>
            Du hast Benachrichtigungen für diese Seite abgelehnt. Von hier aus
            lässt sich das nicht zurücknehmen — das geht nur in den
            Browser-Einstellungen.
          </p>
          <p>
            In Chrome: in der Adresszeile auf das Schloss tippen →
            Berechtigungen → Benachrichtigungen auf „Zulassen“ stellen. Danach
            die Seite neu laden.
          </p>
        </div>
      ) : null}

      {status === "on" ? (
        <>
          <p className="flex items-center gap-2 text-sm font-medium text-foreground">
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-success"
            />
            Erinnerungen sind auf diesem Gerät an
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={sendTest}
              loading={busy === "test"}
            >
              Testnachricht schicken
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={disable}
              loading={busy === "disable"}
            >
              Erinnerungen ausschalten
            </Button>
          </div>
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}

      {note ? (
        <p role="status" className="text-sm text-success">
          {note}
        </p>
      ) : null}

      {status !== "unsupported" && status !== "checking" ? (
        <div className="rounded-control bg-surface-muted p-3 text-sm text-muted">
          Erinnerungen kommen nur in der gebauten App an: in der Entwicklung
          läuft der Dienst im Hintergrund absichtlich nicht. Am zuverlässigsten
          ist es, wenn du die Schulapp über Chrome installiert hast.
        </div>
      ) : null}
    </div>
  );
}

const EMPTY_REMINDER_STATE: ReminderTimeState = {};

/** 6 bis 22 Uhr — davor schläft er, danach bringt es nichts mehr. */
const HOURS = Array.from(
  { length: LAST_HOUR - FIRST_HOUR + 1 },
  (_, index) => FIRST_HOUR + index,
);

function hourLabel(hour: number): string {
  return `${hour}:00 Uhr`;
}

export type ReminderTimeProps = {
  action: (
    state: ReminderTimeState,
    formData: FormData,
  ) => Promise<ReminderTimeState>;
  /** Was in der Datenbank steht. */
  hour: number;
};

export function ReminderTime({ action, hour }: ReminderTimeProps) {
  const [state, formAction, pending] = useActionState(
    action,
    EMPTY_REMINDER_STATE,
  );
  const [selected, setSelected] = useState(hour);

  // Die Bestätigung verschwindet, sobald wieder eine andere Zeit dasteht.
  const saved = state.savedHour !== undefined && state.savedHour === selected;

  return (
    <form action={formAction} className="space-y-3">
      <Field
        id="reminderHour"
        label="Tägliche Erinnerung um"
        hint="Zu dieser Zeit meldet sich die App, wenn an dem Tag etwas zu lernen ansteht."
        error={state.error}
      >
        {(control) => (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select
              {...control}
              name="hour"
              value={String(selected)}
              onChange={(event) => setSelected(Number(event.target.value))}
              className="sm:w-40"
            >
              {HOURS.map((value) => (
                <option key={value} value={value}>
                  {hourLabel(value)}
                </option>
              ))}
            </Select>

            <Button
              type="submit"
              variant="secondary"
              loading={pending}
              disabled={selected === hour}
            >
              Speichern
            </Button>
          </div>
        )}
      </Field>

      {saved ? (
        <p role="status" className="text-sm text-success">
          Gespeichert. Die Erinnerung kommt jetzt um {hourLabel(selected)}.
        </p>
      ) : null}
    </form>
  );
}
