// Regroupe les migrations Drizzle (drizzle/*.sql, dans l'ordre du journal) en un seul
// fichier supabase/setup.sql, à coller dans le SQL Editor de Supabase.
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

/**
 * Construit le contenu de supabase/setup.sql.
 * @param {string} [root] racine du projet
 * @returns {string}
 */
export function buildSetupSql(root = ROOT) {
  /** @type {{ entries: { idx: number; tag: string }[] }} */
  const journal = JSON.parse(readFileSync(join(root, "drizzle/meta/_journal.json"), "utf8"));
  const parts = [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map((entry) => {
      const sql = readFileSync(join(root, "drizzle", `${entry.tag}.sql`), "utf8")
        .replace(/\r\n/g, "\n")
        .replace(/-->\s*statement-breakpoint/g, "")
        .trimEnd();
      return `-- ─── Migration ${entry.tag} ${"─".repeat(Math.max(0, 70 - entry.tag.length))}\n\n${sql}\n`;
    });
  return `${HEADER}\nBEGIN;\n\n${parts.join("\n")}\nCOMMIT;\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = join(ROOT, "supabase/setup.sql");
  writeFileSync(out, buildSetupSql());
  console.log(`Écrit : ${out}`);
}
