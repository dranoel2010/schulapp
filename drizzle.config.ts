import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;

export default defineConfig({
  // Zwei Dateien: der Vertrag (src/db) und der Abrufkern (src/recall), der
  // sich erst bewähren muss. Getrennt, damit ein Rückbau eine Datei ist.
  schema: ["./src/db/schema.ts", "./src/recall/schema.ts"],
  out: "./drizzle",
  dialect: "postgresql",
  ...(url
    ? { dbCredentials: { url } }
    : { driver: "pglite" as const, dbCredentials: { url: "./.data/pglite" } }),
});
