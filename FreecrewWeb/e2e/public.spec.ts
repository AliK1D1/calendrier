import { expect, test } from "@playwright/test";

/**
 * Pages publiques, sans Supabase : ce qu'une personne voit avant de se connecter.
 * (Les pages connectées demandent une base de test : voir README, « Tests de bout en bout ».)
 */

const PUBLIC_PAGES = ["/", "/connexion", "/inscription"];

test.describe("accueil", () => {
  test("présente l'app et mène à la connexion et à l'inscription", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Freecrew" })).toBeVisible();
    // L'illustration : trois horaires et le moment libre en commun.
    await expect(page.getByRole("figure")).toContainText("Maya");

    await page.getByRole("main").getByRole("link", { name: "Créer un compte" }).click();
    await expect(page).toHaveURL(/\/inscription$/);
    await expect(page.getByRole("heading", { level: 1, name: "Créer un compte" })).toBeVisible();

    await page.goto("/");
    // Deux liens « Se connecter » (en-tête et accueil) mènent au même endroit.
    await page.getByRole("link", { name: "Se connecter" }).first().click();
    await expect(page).toHaveURL(/\/connexion$/);
    await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
  });
});

test.describe("langue", () => {
  test("le bouton passe en anglais, le choix est gardé, puis revient au français", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", /^fr/);

    await page.getByRole("button", { name: /English/i }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", /^en/);
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();

    // Le choix est dans un cookie : il tient sur une autre page.
    await page.goto("/inscription");
    await expect(page.locator("html")).toHaveAttribute("lang", /^en/);

    await page.getByRole("button", { name: /Français/i }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", /^fr/);
    await expect(page.getByRole("heading", { level: 1, name: "Créer un compte" })).toBeVisible();
  });
});

test.describe("pages protégées", () => {
  for (const path of ["/plans", "/horaire", "/groupes", "/profil", "/lieux", "/etude"]) {
    test(`${path} renvoie à la connexion et retient la page demandée`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/connexion\?/);
      expect(new URL(page.url()).searchParams.get("next")).toBe(path);
      await expect(page.getByRole("heading", { level: 1, name: "Connexion" })).toBeVisible();
    });
  }
});

test.describe("sans configuration Supabase", () => {
  for (const path of ["/connexion", "/inscription"]) {
    test(`${path} dit clairement que la connexion n'est pas configurée`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("main").getByRole("alert")).toContainText(
        "variables Supabase manquantes",
      );
      await expect(page.getByLabel("Adresse courriel")).toBeDisabled();
    });
  }
});

test.describe("installation (PWA)", () => {
  test("le manifeste est servi sans session", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const manifest = (await res.json()) as { name?: string; icons?: unknown[] };
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons?.length).toBeGreaterThan(0);
  });
});

test.describe("mise en page", () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} : pas de défilement horizontal ni d'erreur dans la console`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
      expect(errors).toEqual([]);
    });
  }
});
