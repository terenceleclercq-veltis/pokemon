import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Prix simulés : pas de dépendance réseau à TCGdex pendant les tests navigateur. */
async function mockPrices(page: Page) {
  await page.route("**/api/species/*/prices", async (route) => {
    const num = Number(/species\/(\d+)\//.exec(route.request().url())?.[1]);
    const r = await page.request.get(`/api/pokedex`);
    const s = ((await r.json()) as { species: { num: number; cards: { id: string }[] }[] }).species.find(
      (x) => x.num === num,
    );
    const body = Object.fromEntries(
      (s?.cards ?? []).map((c, i) => [c.id, { trend: 10 + i * 5, low: 5 + i, avg7: 10, image: null }]),
    );
    await route.fulfill({ json: body });
  });
}

let consoleErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  await mockPrices(page);
});
test.afterEach(() => {
  // inclut les violations CSP / Trusted Types, qui sont journalisées comme erreurs
  expect(consoleErrors).toEqual([]);
});

test("affiche les 151 espèces et la progression", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(151);
  await expect(page.locator("#progress")).toContainText("/151 complètes");
  await expect(page.locator(".tile").first()).toContainText("Bulbizarre");
});

test("recherche, filtre et état dans l'URL", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Rechercher").fill("dracau");
  await expect(page.locator(".tile")).toHaveCount(1);
  await expect(page).toHaveURL(/#q=dracau/);
  await page.getByLabel("Rechercher").fill("#025");
  await expect(page.locator(".tile")).toHaveText(/Pikachu/);
  await page.getByLabel("Rechercher").fill("");
  await page.getByLabel("Filtrer").selectOption("none");
  await expect(page.locator(".tile").first()).toContainText("Aucune full art FR");
  await page.reload();
  await expect(page.getByLabel("Filtrer")).toHaveValue("none");
});

test("parcours complet : je l'ai, version plus rare, je préfère la mienne", async ({ page }) => {
  await page.goto("/#q=Carapuce");
  const tile = page.locator(".tile", { hasText: "Carapuce" });
  await tile.click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("heading", { name: /Carapuce/ })).toBeVisible();
  await expect(dlg.locator(".price").first()).toContainText("€");
  // possède une Full art alors qu'une IR existe -> à vérifier
  const fa = dlg.locator("h3", { hasText: "Full art" });
  if ((await fa.count()) > 0) {
    await dlg.locator(".opt").first().getByRole("button", { name: "Je l'ai" }).click();
  } else {
    await dlg.getByText("Ma carte n'est pas dans la liste").click();
    await dlg.getByRole("button", { name: "J'ai une Full art" }).click();
  }
  await expect(dlg.getByText(/version\(s\) plus rare/)).toBeVisible();
  await dlg.getByRole("button", { name: /Je préfère la mienne/ }).click();
  await expect(dlg.getByText(/Choix conservé/)).toBeVisible();
  await dlg.getByRole("button", { name: "Fermer" }).click();
  await expect(tile).toHaveClass(/choisie/);
  // nettoyage
  await tile.click();
  page.once("dialog", (d) => void d.accept());
  await dlg.getByRole("button", { name: "Retirer du binder" }).click();
  await expect(tile).toHaveClass(/manquante/);
});

test("navigation clavier : Tab, Entrée, Échap", async ({ page, isMobile }) => {
  test.skip(isMobile, "pas de clavier sur mobile");
  await page.goto("/#q=Bulbizarre");
  await page.locator(".tile").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("code Cardmarket affiché et copié pour la recherche", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "presse-papiers testé sur desktop");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#q=Bulbizarre");
  await page.locator(".tile").first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Copier « Bulbizarre (MEW 166) »" }).click();
  await expect(page.locator(".toast")).toContainText("Copié : Bulbizarre (MEW 166)");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Bulbizarre (MEW 166)");
  const link = page.getByRole("dialog").getByRole("link", { name: "Bulbizarre (MEW 166) sur Cardmarket" });
  await expect(link).toHaveAttribute("href", "https://www.cardmarket.com/fr/Pokemon/Products?idProduct=733761");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("liste d'achat : liens Cardmarket vers la version exacte", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Réglages" }).click();
  await page.locator("#wants-tier").selectOption("sir_ir");
  // pas de budget : la base E2E n'a pas de prix, et le budget écarte les cartes sans prix
  await page.getByRole("button", { name: "Afficher" }).click();
  const links = page.locator("#buylist a");
  await expect(links.first()).toHaveAttribute(
    "href",
    /^https:\/\/www\.cardmarket\.com\/fr\/Pokemon\/Products\?idProduct=\d+$/,
  );
  await expect(page.locator("#buylist")).toContainText("hors port");
});

test("réglages : liste d'envies et export", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "presse-papiers testé sur desktop");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page.getByRole("button", { name: "Réglages" }).click();
  await page.getByRole("button", { name: "Copier" }).click();
  await expect(page.locator(".toast")).toContainText("lignes copiées");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip.split("\n").length).toBeGreaterThan(50);
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exporter (JSON)" }).click();
  expect((await dl).suggestedFilename()).toMatch(/^pokedex-\d{4}-\d{2}-\d{2}\.json$/);
});

test("pas de défilement horizontal", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(151);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("accessibilité (axe) : page et dialogue sans violation sérieuse", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(151);
  const scan = async () =>
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.length}`);
  expect(await scan()).toEqual([]);
  await page.locator(".tile").first().click();
  await expect(page.getByRole("dialog").locator(".price").first()).toBeVisible();
  expect(await scan()).toEqual([]);
});

test("la CSP est bien envoyée et stricte", async ({ page }) => {
  const res = await page.goto("/");
  const csp = res?.headers()["content-security-policy"] ?? "";
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-inline");
  expect(csp).not.toContain("unsafe-eval");
});

test("placeholders : 9 fiches par feuille A4, sans violation CSP", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/placeholders.html");
  await page.locator("#scope").selectOption("all");
  await expect(page.locator("#count")).toHaveText("151 fiches · 17 feuilles A4");
  await expect(page.locator(".sheet").first().locator(".ph")).toHaveCount(9);
  await expect(page.locator(".ph").first()).toContainText("#001");
  await expect(page.locator(".ph img").first()).toHaveAttribute("src", /official-artwork\/1\.png$/);
  expect(errors).toEqual([]);
});
