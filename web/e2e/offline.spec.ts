import { expect, test } from "@playwright/test";

// Service worker autorisé ici seulement (bloqué ailleurs : il court-circuiterait les simulations réseau).
test.use({ serviceWorkers: "allow" });

test("hors ligne : la grille reste consultable, avec la date des données", async ({ page, context }) => {
  // images simulées (aussi pour les requêtes du service worker, interceptées au niveau du contexte)
  await context.route(
    /^https:\/\/(raw\.githubusercontent\.com|assets\.tcgdex\.net|images\.pokemontcg\.io)\//,
    (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        headers: { "Access-Control-Allow-Origin": "*" },
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="7"><rect width="5" height="7" fill="#c33"/></svg>',
      }),
  );
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(151);
  // service worker actif et page contrôlée : un rechargement en ligne garde les dernières données
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
  await expect(page.locator(".tile")).toHaveCount(151);
  await expect(page.locator("#offline")).toBeHidden();

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(151);
  await expect(page.locator("#offline")).toContainText("Hors ligne : données du");
  // une modification hors ligne : message clair, rien de cassé
  await page.locator('.tile[data-num="1"]').click();
  const dlg = page.locator("#detail");
  await expect(dlg.getByRole("heading", { name: "#001 Bulbizarre" })).toBeVisible();
  await dlg.locator(".versions .opt:not(.mine)").first().getByRole("button", { name: "Écarter" }).click();
  await expect(page.locator(".toast.err").last()).toContainText("Pas de connexion");
  await context.setOffline(false);
});
