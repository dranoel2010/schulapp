import { and, eq, gte } from "drizzle-orm";

import { db } from "@/db";
import {
  examTopics,
  exams,
  materialPages,
  materialTopics,
  materials,
  subjectTopics,
  subjects,
  users,
} from "@/db/schema";
import { addDays, todayInBerlin } from "@/lib/dates";
import { hashPassword } from "@/lib/password";

/**
 * Erfundener Stoff für die lokale Datenbank, damit die Oberfläche im Browser
 * durchklickbar ist.
 *
 *   npx tsx scripts/saat-abruf.mts
 *
 * ── Warum es das gibt ────────────────────────────────────────────────────────
 *
 * Am 11.9.2026 wurde der Abrufkern zweimal ausgeliefert, ohne dass ihn jemand
 * angemeldet durchgeklickt hatte. Beide Male fand erst danach eine Prüfung
 * Fehler — und zwar solche, die kein Test sieht: eine Frage, die viermal
 * hintereinander steht, ein Knopf, der ins Leere zeigt, eine Zahl, die etwas
 * anderes zählt, als sie behauptet. Das lässt sich nur im Browser finden.
 *
 * Dafür braucht es ein Konto, ein Fach, eine Klausur und ein Blatt mit
 * Abschrift. Auf dem NAS gibt es das alles — aber dort liegen echte
 * Schulinhalte, dort darf nichts kaputtgehen, und das Anmeldepasswort gehört
 * einem Menschen. Also lokal, mit erfundenem Stoff.
 *
 * ── ⚠ Der Riegel ────────────────────────────────────────────────────────────
 *
 * Dieses Skript weigert sich, wenn `DATABASE_URL` gesetzt ist. Es schreibt
 * ausschließlich in die Datei-Datenbank unter `.data/pglite`. Der Grund ist
 * derselbe wie bei `scripts/sql-einspielen.ts`: Ein Saatgut-Skript, das
 * versehentlich die Produktivdatenbank trifft, legt dort ein fremdes Konto und
 * erfundene Blätter an — und niemand merkt es, weil beides aussieht wie das,
 * was ohnehin da ist.
 */

if (process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL ist gesetzt. Dieses Skript sät nur in die lokale Datei-Datenbank.\n" +
      "Abgebrochen, damit es nicht die Produktivdatenbank trifft.",
  );
  process.exit(1);
}

const PASSWORT = "probe1234";
const HEUTE = todayInBerlin();

/**
 * Die Abschrift des Probeblatts.
 *
 * Sie enthält absichtlich eine ⟨unsichere Stelle⟩ mitten im Text: Nur damit
 * lässt sich im Browser prüfen, dass die Quellbindung ein Zitat abweist, das
 * in die Markierung hineinreicht — der Fehler, den die Abnahme am 11.9. fand.
 */
const ABSCHRIFT_1 = [
  "Die Kettenregel",
  "",
  "Ist f(x) = g(h(x)), so gilt f'(x) = g'(h(x)) · h'(x).",
  "Man leitet also die äußere Funktion ab, setzt die innere ein und",
  "multipliziert mit der Ableitung der inneren Funktion.",
  "",
  "Beispiel: f(x) = sin(3x) hat die Ableitung f'(x) = 3 · cos(3x).",
  "Der Faktor 3 ist die ⟨Ableitung der inneren Funktion⟩, nicht ihr Wert.",
  "",
  "Merke: Die Produktregel gilt für ein Produkt zweier Funktionen,",
  "die Kettenregel für eine Funktion IN einer Funktion.",
].join("\n");

const ABSCHRIFT_2 = [
  "Die Produktregel",
  "",
  "Ist f(x) = u(x) · v(x), so gilt f'(x) = u'(x) · v(x) + u(x) · v'(x).",
  "In Worten: erste Ableitung mal zweite Funktion, plus erste Funktion mal",
  "zweite Ableitung.",
  "",
  "Ein häufiger Fehler ist, einfach u'(x) · v'(x) zu schreiben.",
].join("\n");

const leer = Buffer.from([0]);

async function saat(): Promise<void> {
  // ── Das Konto ──────────────────────────────────────────────────────────────
  // Falls schon eines liegt, bekommt es nur ein bekanntes Passwort. Anlegen
  // würde scheitern: createAccount() erlaubt genau ein Konto.
  const hash = await hashPassword(PASSWORT);
  const [vorhanden] = await db.select({ id: users.id }).from(users).limit(1);

  const nutzerId = vorhanden
    ? (
        await db
          .update(users)
          .set({ passwordHash: hash })
          .where(eq(users.id, vorhanden.id))
          .returning({ id: users.id })
      )[0].id
    : (
        await db
          .insert(users)
          .values({ name: "Probe", passwordHash: hash })
          .returning({ id: users.id })
      )[0].id;

  console.log(vorhanden ? "Konto vorhanden, Passwort gesetzt." : "Konto angelegt.");

  // ── Das Fach ───────────────────────────────────────────────────────────────
  const [fachVorhanden] = await db
    .select({ id: subjects.id })
    .from(subjects)
    .where(and(eq(subjects.userId, nutzerId), eq(subjects.name, "Mathematik")))
    .limit(1);

  const fachId =
    fachVorhanden?.id ??
    (
      await db
        .insert(subjects)
        .values({
          userId: nutzerId,
          name: "Mathematik",
          short: "Ma",
          color: "indigo",
        })
        .returning({ id: subjects.id })
    )[0].id;

  // ── Ein Thema, damit die Zuordnung im Formular etwas anzubieten hat ───────
  const [themaVorhanden] = await db
    .select({ id: subjectTopics.id })
    .from(subjectTopics)
    .where(
      and(eq(subjectTopics.subjectId, fachId), eq(subjectTopics.title, "Ableitungsregeln")),
    )
    .limit(1);

  const themaId =
    themaVorhanden?.id ??
    (
      await db
        .insert(subjectTopics)
        .values({
          userId: nutzerId,
          subjectId: fachId,
          title: "Ableitungsregeln",
          matchKey: "ableitungsregeln",
          origin: "blatt",
          lastSeenAt: HEUTE,
        })
        .returning({ id: subjectTopics.id })
    )[0].id;

  // ── Die Klausur: vier Wochen hin, damit die Planung Luft hat ──────────────
  const klausurtag = addDays(HEUTE, 28);
  // `gte(date, heute)` und nicht bloß „irgendeine Klausur in diesem Fach":
  // Eine vergangene zählt für die Planung nicht (`naechsteKlausur` filtert sie
  // weg), und die Saat hielte sie fälschlich für erledigte Arbeit. Genau das
  // ist beim ersten Durchklicken passiert — die Startseite sagte „Keine
  // Prüfung eingetragen", während die Saat „Klausur vorhanden" meinte.
  const [klausurVorhanden] = await db
    .select({ id: exams.id })
    .from(exams)
    .where(
      and(
        eq(exams.userId, nutzerId),
        eq(exams.subjectId, fachId),
        gte(exams.date, HEUTE),
      ),
    )
    .limit(1);

  const klausurId =
    klausurVorhanden?.id ??
    (
      await db
        .insert(exams)
        .values({
          userId: nutzerId,
          subjectId: fachId,
          kind: "klausur",
          date: klausurtag,
          title: "Analysis",
        })
        .returning({ id: exams.id })
    )[0].id;

  if (!klausurVorhanden) console.log(`Klausur am ${klausurtag} angelegt.`);

  // ── Das Thema AN die Klausur hängen ──────────────────────────────────────
  //
  // Ohne diese Zeilen fehlt genau das Glied, um das es dem Nutzer geht: „ich
  // stelle einen Test ein, dann kommen die Tags dran, und dann wird der
  // Lernstoff durch die Tags gemacht." Die Saat legte Klausur UND Thema an und
  // verband beide nie — die Klausur hatte null Themen, /abruf/klausur zeigte
  // „kein Stoff erreichbar", und der Fragenlauf hätte lokal nichts zu tun
  // gehabt. Am 12.9.2026 im Browser aufgefallen, nachdem die Seite drei Tage
  // als „gebaut" galt.
  const [postenVorhanden] = await db
    .select({ id: examTopics.id })
    .from(examTopics)
    .where(
      and(eq(examTopics.examId, klausurId), eq(examTopics.title, "Ableitungsregeln")),
    )
    .limit(1);

  if (!postenVorhanden) {
    await db.insert(examTopics).values({
      examId: klausurId,
      title: "Ableitungsregeln",
      sortOrder: 0,
      // DAS ist der Schlüssel: ein Klausurthema ohne subjectTopicId ist freier
      // Text und führt zu keinem Blatt.
      subjectTopicId: themaId,
    });
    console.log("Das Thema hängt jetzt an der Klausur.");
  }

  // ── Das Blatt mit zwei abgeschriebenen Seiten ─────────────────────────────
  // Nicht „gibt es das Blatt?", sondern „hat es abgeschriebene Seiten?".
  //
  // Der Unterschied hat beim ersten Durchklicken eine halbe Stunde gekostet:
  // Ein abgebrochener Lauf hatte das Blatt angelegt, die Seiten aber nicht, und
  // der nächste Lauf meldete zufrieden „liegt schon da". Die Oberfläche sagte
  // daraufhin „Kein Blatt mit Abschrift" — und es sah aus wie ein Fehler im
  // Abrufkern, war aber ein Blatt ohne Text.
  const [blattVorhanden] = await db
    .select({ id: materials.id, seiteId: materialPages.id })
    .from(materials)
    .leftJoin(materialPages, eq(materialPages.materialId, materials.id))
    .where(and(eq(materials.userId, nutzerId), eq(materials.title, "Ableitungsregeln")))
    .limit(1);

  if (blattVorhanden?.seiteId) {
    console.log("Probeblatt mit Seiten liegt schon da.");
  } else if (blattVorhanden) {
    await db.insert(materialPages).values(
      [ABSCHRIFT_1, ABSCHRIFT_2].map((text, i) => ({
        materialId: blattVorhanden.id,
        sortOrder: i,
        width: 1200,
        height: 1600,
        byteSize: 1,
        image: leer,
        reading: leer,
        thumb: leer,
        transcript: text,
      })),
    );
    console.log("Blatt lag ohne Seiten da — zwei Abschriften nachgetragen.");
  } else {
    const [blatt] = await db
      .insert(materials)
      .values({
        userId: nutzerId,
        subjectId: fachId,
        title: "Ableitungsregeln",
        capturedOn: HEUTE,
        // Eingeordnet, nicht im Eingangskorb — der Abruf liest nur Abschriften.
        filedAt: new Date(),
      })
      .returning({ id: materials.id });

    await db.insert(materialPages).values(
      [ABSCHRIFT_1, ABSCHRIFT_2].map((text, i) => ({
        materialId: blatt.id,
        sortOrder: i,
        width: 1200,
        height: 1600,
        byteSize: 1,
        image: leer,
        reading: leer,
        thumb: leer,
        transcript: text,
      })),
    );
    console.log("Probeblatt mit zwei abgeschriebenen Seiten angelegt.");
  }

  // ── Und das Blatt an dasselbe Thema ──────────────────────────────────────
  //
  // Die zweite Hälfte derselben Kette: Über `material_topics` findet das Thema
  // die Blätter. Fehlt sie, hat die Klausur ein Thema und das Thema kein Blatt
  // — die Oberfläche sagt dann „kein abgeschriebenes Blatt", und es sieht aus
  // wie ein Fehler im Abruf.
  const [blattJetzt] = await db
    .select({ id: materials.id })
    .from(materials)
    .where(and(eq(materials.userId, nutzerId), eq(materials.title, "Ableitungsregeln")))
    .limit(1);

  if (blattJetzt) {
    const [verbunden] = await db
      .select({ materialId: materialTopics.materialId })
      .from(materialTopics)
      .where(
        and(
          eq(materialTopics.materialId, blattJetzt.id),
          eq(materialTopics.subjectTopicId, themaId),
        ),
      )
      .limit(1);

    if (!verbunden) {
      await db
        .insert(materialTopics)
        .values({ materialId: blattJetzt.id, subjectTopicId: themaId });
      console.log("Das Blatt hängt jetzt am Thema — die Kette ist vollständig.");
    }
  }

  console.log(
    `\nFertig. Jetzt: npm run dev — anmelden mit dem Passwort "${PASSWORT}".`,
  );
}

// Drizzle verpackt den Fehler der Datenbank in einen DrizzleQueryError und
// zeigt beim Werfen nur die Abfrage. Die eigentliche Auskunft steht in der
// Ursachenkette — ohne dieses Auspacken sucht man am falschen Ende.
try {
  await saat();
} catch (fehler) {
  console.error("\nFEHLGESCHLAGEN:", fehler instanceof Error ? fehler.message.split("\n")[0] : fehler);
  let ursache: unknown = (fehler as { cause?: unknown }).cause;
  while (ursache) {
    const u = ursache as { message?: string; detail?: string; cause?: unknown };
    console.error("  ursache:", u.message ?? String(ursache), u.detail ? `(${u.detail})` : "");
    ursache = u.cause;
  }
  process.exit(1);
}

/**
 * `--faellig-heute` zieht den frühesten offenen Termin auf heute.
 *
 * Der erste Termin eines neuen Bausteins liegt drei Tage in der Zukunft — der
 * Abend, an dem er entsteht, IST die erste Begegnung. Zum Durchklicken der
 * Sitzung braucht man aber heute etwas Fälliges, sonst leitet /abruf/sitzung
 * folgerichtig auf die Übersicht um und der ganze Abend bleibt ungeprüft.
 */
if (process.argv.includes("--faellig-heute")) {
  const { recallSchedule } = await import("@/recall/schema");
  const { asc, isNull } = await import("drizzle-orm");

  const [naechster] = await db
    .select({ id: recallSchedule.id })
    .from(recallSchedule)
    .where(isNull(recallSchedule.doneAt))
    .orderBy(asc(recallSchedule.dueOn))
    .limit(1);

  if (!naechster) {
    console.log("Kein offener Termin da — erst einen Baustein anlegen.");
  } else {
    await db
      .update(recallSchedule)
      .set({ dueOn: HEUTE })
      .where(eq(recallSchedule.id, naechster.id));
    console.log(`Ein Termin auf heute (${HEUTE}) gezogen.`);
  }
}

/**
 * `--vorschlag` legt ein Vorschlagspaket ab, wie es ein Agentenlauf hinterließe.
 *
 * Darunter absichtlich eine Frage mit NACHERZÄHLTEM Zitat: Nur so lässt sich im
 * Browser sehen, dass die Quellbindung beim Übernehmen auch für die KI greift
 * und die Abweisung samt Grund sichtbar wird.
 */
if (process.argv.includes("--vorschlag")) {
  const { vorschlagAnlegen } = await import("@/recall/proposals");
  const { materialPages: seitenTab, materials: blaetterTab } = await import(
    "@/db/schema"
  );

  const [nutzer] = await db.select({ id: users.id }).from(users).limit(1);
  const [pruefung] = await db
    .select({ id: exams.id })
    .from(exams)
    .where(and(eq(exams.userId, nutzer.id), gte(exams.date, HEUTE)))
    .limit(1);
  const seiten = await db
    .select({ id: seitenTab.id, transcript: seitenTab.transcript })
    .from(seitenTab)
    .innerJoin(blaetterTab, eq(blaetterTab.id, seitenTab.materialId))
    .where(eq(blaetterTab.userId, nutzer.id))
    .limit(2);

  if (!pruefung || seiten.length === 0) {
    console.log("Keine Klausur oder keine Seite da — erst ohne Schalter säen.");
  } else {
    const ergebnis = await vorschlagAnlegen(
      nutzer.id,
      pruefung.id,
      [
        {
          pageId: seiten[0].id,
          promptFree: "Was besagt die Kettenregel?",
          solution:
            "Äußere Funktion ableiten\nInnere Funktion einsetzen\nMit der Ableitung der inneren multiplizieren",
          misconception:
            "Wird mit der Produktregel verwechselt — dort stehen zwei Faktoren nebeneinander, hier eine Funktion IN einer Funktion.",
          sourceQuote: "Ist f(x) = g(h(x)), so gilt f'(x) = g'(h(x)) · h'(x).",
        },
        {
          pageId: seiten[0].id,
          promptFree: "Wie lautet die Ableitung von sin(3x)?",
          solution: "3 · cos(3x)",
          misconception:
            "Der Faktor 3 wird vergessen — das ist die Ableitung der inneren Funktion.",
          sourceQuote:
            "Beispiel: f(x) = sin(3x) hat die Ableitung f'(x) = 3 · cos(3x).",
        },
        {
          pageId: seiten[0].id,
          promptFree: "Worin unterscheiden sich Ketten- und Produktregel?",
          solution: "Kettenregel: Funktion in Funktion\nProduktregel: Produkt zweier Funktionen",
          misconception: "Beide werden verwechselt, weil beide zwei Teile haben.",
          // NACHERZÄHLT, nicht zitiert — muss beim Übernehmen abgewiesen werden.
          sourceQuote:
            "Die Kettenregel gilt bei Verschachtelung, die Produktregel bei einem Produkt.",
        },
      ],
      "Eine Stelle des Blattes war beim Abschreiben unsicher und wurde ausgelassen.",
    );
    console.log(
      ergebnis.ok
        ? `Vorschlag mit ${ergebnis.fragen} Fragen abgelegt (eine davon mit nacherzähltem Zitat).`
        : "Vorschlag konnte nicht abgelegt werden.",
    );
  }
}

/**
 * Die Datenbank zumachen — sonst endet dieses Skript nie.
 *
 * PGlite hält die Ereignisschleife offen, solange die Datei-Datenbank offen
 * ist. Ohne diese Zeile schreibt das Saatgut „Fertig." und läuft weiter; wer es
 * durch eine Pipe schickt (`| tail`), bekommt sogar gar nichts zu sehen, weil
 * die Pipe erst beim Ende schließt. Am 12.9.2026 hat das zwanzig Minuten
 * gekostet: Das Skript sah aus wie hängend und war längst fertig.
 *
 * `close()` und nicht `process.exit()`. Der harte Abbruch lässt
 * `.data/pglite/postmaster.pid` liegen, und die NÄCHSTE Instanz wartet dann auf
 * einen Prozess, den es nicht mehr gibt — genau daran hing dieselbe Stunde ein
 * zweites Mal. Ein ordentliches `close()` räumt die Datei weg.
 */
await (db as unknown as { $client: { close: () => Promise<void> } }).$client.close();
