import { defineConfig, devices } from "@playwright/test";

/**
 * Tests de bout en bout (navigateur) : `npm run test:e2e`.
 *
 * Ils tournent SANS Supabase (variables vides) : pages publiques, langue, redirection des
 * pages protégées. Les pages connectées demandent une base de test (voir README).
 * Le serveur est celui de production (`npm run build` d'abord), sur le port 3100.
 */
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "fr-CA",
    timezoneId: "America/Toronto",
    trace: "off",
  },
  projects: [
    { name: "ordinateur", use: { ...devices["Desktop Chrome"] } },
    { name: "telephone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run start -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    // Sans Supabase : la connexion est désactivée, les pages protégées redirigent.
    env: { NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "" },
  },
});
