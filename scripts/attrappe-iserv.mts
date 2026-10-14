/**
 * Die Attrappe von IServ (src/lib/iserv/fixtures.ts) als echter Server auf
 * diesem Rechner — damit sich ein Abruf im Produktionsbau durchspielen lässt,
 * ohne dass irgendetwas die echte Schule erreicht.
 *
 *   ATTRAPPE_PASSWORT=… npx tsx scripts/attrappe-iserv.mts 3591
 *
 * Danach die App mit
 *
 *   ISERV_URL=http://127.0.0.1:3591 ISERV_USER=test.schueler
 *   ISERV_PASSWORD=<dasselbe Passwort> ISERV_KLASSE=10
 *
 * starten (http ist nur für 127.0.0.1 und localhost erlaubt, siehe
 * @/lib/iserv/config). Alle Termine, Ferien und Aufgaben sind erfunden.
 *
 * Die Attrappe kennt nur ihren eigenen Host (https://iserv.example.test).
 * Dieser Server reicht jede Anfrage unter diesem Namen hinein und schreibt die
 * Antwort auf die eigene Adresse um: absolute Adressen im Text, Weiterleitungen
 * und das Cookie-Merkmal `secure` (über http schickte der Client es sonst nie
 * zurück).
 */

import { createServer } from "node:http";

import { fakeIserv, ORIGIN } from "@/lib/iserv/fixtures";

const port = Number(process.argv[2] ?? 3591);
const passwort = process.env.ATTRAPPE_PASSWORT;
if (!passwort) {
  console.error("ATTRAPPE_PASSWORT fehlt.");
  process.exit(1);
}

const hier = `http://127.0.0.1:${port}`;
const fake = fakeIserv({ passwort });

const server = createServer(async (req, res) => {
  const teile: Buffer[] = [];
  for await (const teil of req) teile.push(teil as Buffer);
  const body = Buffer.concat(teile).toString("utf8");

  const headers = new Headers();
  if (req.headers.cookie) headers.set("cookie", req.headers.cookie);
  if (req.headers["content-type"]) headers.set("content-type", String(req.headers["content-type"]));

  const antwort = await fake.fetch(`${ORIGIN}${req.url ?? "/"}`, {
    method: req.method,
    headers,
    body: req.method === "GET" || req.method === "HEAD" ? undefined : body,
  });

  const text = (await antwort.text()).split(ORIGIN).join(hier);
  const kopf: Record<string, string | string[]> = {};
  antwort.headers.forEach((wert, name) => {
    if (name === "set-cookie" || name === "content-length") return;
    kopf[name] = name === "location" ? wert.split(ORIGIN).join(hier) : wert;
  });
  const cookies = antwort.headers.getSetCookie().map((c) => c.replace(/;\s*secure/gi, ""));
  if (cookies.length > 0) kopf["set-cookie"] = cookies;

  res.writeHead(antwort.status, kopf);
  res.end(text);
  console.info(req.method, req.url?.split("?")[0], antwort.status);
});

server.listen(port, "127.0.0.1", () => {
  console.info(`Attrappe von IServ auf ${hier}`);
});
