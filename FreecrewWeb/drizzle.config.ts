import { defineConfig } from "drizzle-kit";

/**
 * `npm run db:generate` (drizzle-kit generate) n'a pas besoin de connexion.
 * `npm run db:migrate` a besoin de DATABASE_URL (facultatif : voir README, on peut aussi
 * coller supabase/setup.sql dans le SQL Editor de Supabase).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
  schemaFilter: ["public"],
  strict: true,
  verbose: true,
});
