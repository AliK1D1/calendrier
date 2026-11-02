// Regroupe les migrations Drizzle (drizzle/*.sql, dans l'ordre du journal) en un seul
// fichier supabase/setup.sql, à coller dans le SQL Editor de Supabase (base vide).
// Écrit aussi, pour chaque migration à partir de la 0002, un fichier
// supabase/migration-000N.sql à coller SEUL sur une base où setup.sql a déjà été appliqué.
// Usage : npm run db:setup-sql
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const HEADER = `-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : mise en place complète de la base de données Supabase.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/*.sql : ne pas le modifier
-- à la main (modifier src/lib/db/schema.ts ou drizzle/0001_rls_triggers.sql, puis régénérer).
--
-- À exécuter UNE SEULE FOIS sur une base vide : Supabase → SQL Editor → New query →
-- coller tout le fichier → Run. Tout se fait dans une transaction : en cas d'erreur, rien
-- n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════
`;

/** Migrations qui ont aussi leur fichier séparé (0000 et 0001 sont dans le setup.sql du segment 6). */
export const FIRST_SEPARATE_MIGRATION = 2;

/**
 * @param {string} root
 * @returns {{ idx: number; tag: string }[]}
 */
function readJournal(root) {
  /** @type {{ entries: { idx: number; tag: string }[] }} */
  const journal = JSON.parse(readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"));
  return [...journal.entries].sort((a, b) => a.idx - b.idx);
}

/**
 * @param {string} root
 * @param {string} tag
 * @returns {string}
 */
function migrationBody(root, tag) {
  const sql = readFileSync(join(root, "drizzle", `${tag}.sql`), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/-->\s*statement-breakpoint/g, "")
    .trimEnd();
  return `-- ─── Migration ${tag} ${"─".repeat(Math.max(0, 70 - tag.length))}\n\n${sql}\n`;
}

/**
 * Contenu de supabase/migration-000N.sql : une seule migration, dans une transaction.
 * @param {number} idx
 * @param {string} [root]
 * @returns {string}
 */
export function buildMigrationSql(idx, root = ROOT) {
  const entry = readJournal(root).find((e) => e.idx === idx);
  if (!entry) throw new Error(`Migration ${idx} absente du journal`);
  const header = `-- ════════════════════════════════════════════════════════════════════════════════════════
-- Temps libre commun : migration ${entry.tag} SEULE.
--
-- FICHIER GÉNÉRÉ par « npm run db:setup-sql » à partir de drizzle/${entry.tag}.sql : ne pas le
-- modifier à la main.
--
-- À exécuter UNE SEULE FOIS, sur une base où supabase/setup.sql (ou les migrations
-- précédentes) a déjà été appliqué : Supabase → SQL Editor → New query → coller tout le
-- fichier → Run. Ne pas le coller si le setup.sql appliqué contenait déjà cette migration.
-- Tout se fait dans une transaction : en cas d'erreur, rien n'est appliqué.
-- ════════════════════════════════════════════════════════════════════════════════════════
`;
  return `${header}\nBEGIN;\n\n${migrationBody(root, entry.tag)}\nCOMMIT;\n`;
}

/**
 * Fichiers séparés à écrire : { "supabase/migration-0002.sql": contenu, … }.
 * @param {string} [root]
 * @returns {Record<string, string>}
 */
export function buildSeparateMigrations(root = ROOT) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const e of readJournal(root)) {
    if (e.idx < FIRST_SEPARATE_MIGRATION) continue;
    out[`supabase/migration-${String(e.idx).padStart(4, "0")}.sql`] = buildMigrationSql(
      e.idx,
      root,
    );
  }
  return out;
}

/**
 * Construit le contenu de supabase/setup.sql.
 * @param {string} [root] racine du projet
 * @returns {string}
 */
export function buildSetupSql(root = ROOT) {
  const parts = readJournal(root).map((entry) => migrationBody(root, entry.tag));
  return `${HEADER}\nBEGIN;\n\n${parts.join("\n")}\nCOMMIT;\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(ROOT, "supabase/setup.sql");
  writeFileSync(out, buildSetupSql());
  console.log(`Écrit : ${out}`);
  for (const [rel, content] of Object.entries(buildSeparateMigrations())) {
    writeFileSync(join(ROOT, rel), content);
    console.log(`Écrit : ${join(ROOT, rel)}`);
  }
}
