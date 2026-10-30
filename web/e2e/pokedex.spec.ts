import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/** Prix et images simulés : aucune dépendance réseau (TCGdex, GitHub) pendant les tests navigateur. */
async function mockOutbound(page: Page) {
  await page.route(/^https:\/\/(raw\.githubusercontent\.com|assets\.tcgdex\.net)\//, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="5" height="7"><rect width="5" height="7" fill="#c33"/></svg>',
    }),
  );
  // pokédex lu une seule fois par test (moins d'appels à l'API locale)
  let pokedex: Promise<{ species: { num: number; cards: { id: string }[] }[] }> | undefined;
  await page.route("**/api/species/*/prices", async (route) => {
    const num = Number(/species\/(\d+)\//.exec(route.request().url())?.[1]);
    pokedex ??= page.request
      .get(`/api/pokedex`)
      .then((r) => r.json() as Promise<{ species: { num: number; cards: { id: string }[] }[] }>);
    const s = (await pokedex).species.find((x) => x.num === num);
    const body = Object.fromEntries(
      (s?.cards ?? []).map((c, i) => [
        c.id,
        { trend: 10 + i * 5, low: 5 + i, avg7: 10, image: `https://assets.tcgdex.net/test/${c.id}/low.webp` },
      ]),
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
  await mockOutbound(page);
});
test.afterEach(async ({ page }) => {
  // une requête simulée encore en vol à la fin du test ne doit pas le faire échouer
  await page.unrouteAll({ behavior: "ignoreErrors" });
  // inclut les violations CSP / Trusted Types, qui sont journalisées comme erreurs
  expect(consoleErrors).toEqual([]);
});

test("affiche les 151 espèces illustrées et la progression", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(151);
  await expect(page.locator("#progress")).toContainText("/151 complètes");
  await expect(page.locator(".tile").first()).toContainText("Bulbizarre");
  // chaque tuile a une image : une carte, ou l'illustration du Pokémon
  await expect(page.locator(".tile .pic img")).toHaveCount(151);
  await expect(page.locator(".tile.none .pic.art img").first()).toHaveAttribute("src", /dream-world\/\d+\.svg$/);
});

test("recherche tolérante, filtre et état dans l'URL", async ({ page }) => {
  await page.goto("/");
  const search = page.getByLabel("Rechercher");
  await search.fill("dracau");
  await expect(page.locator(".tile")).toHaveCount(1);
  await expect(page).toHaveURL(/#q=dracau/);
  await search.fill("#025");
  await expect(page.locator(".tile")).toHaveText(/Pikachu/);
  // sans accent, ou par le nom anglais
  await search.fill("salameche");
  await expect(page.locator(".tile")).toHaveText(/Salamèche/);
  await search.fill("charmander");
  await expect(page.locator(".tile")).toHaveText(/Salamèche/);
  // par code Cardmarket
  await search.fill("MEW 166");
  await expect(page.locator(".tile")).toHaveText(/Bulbizarre/);
  await search.fill("");
  await page.getByLabel("Filtrer").selectOption("none");
  await expect(page.locator(".tile").first()).toContainText("Aucune carte");
  await page.reload();
  await expect(page.getByLabel("Filtrer")).toHaveValue("none");
});

test("vues rapides : la moins chère et la plus chère à acheter", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "La moins chère à acheter" }).click();
  await expect(page.getByLabel("Filtrer")).toHaveValue("manquante");
  await expect(page.getByLabel("Trier")).toHaveValue("asc");
  await expect(page).toHaveURL(/f=manquante&s=asc/);
  await page.getByRole("button", { name: "La plus chère à acheter" }).click();
  await expect(page.getByLabel("Trier")).toHaveValue("desc");
  await expect(page.locator(".tile.none")).toHaveCount(0);
});

test("parcours complet : je l'ai, version plus rare, je préfère la mienne", async ({ page }) => {
  await page.goto("/#q=Carapuce");
  const tile = page.locator(".tile", { hasText: "Carapuce" });
  await tile.click();
  const dlg = page.locator("#detail");
  await expect(dlg.getByRole("heading", { name: /Carapuce/ })).toBeVisible();
  await expect(dlg.locator(".price").first()).toContainText("€");
  // possède une Full art alors qu'une IR existe -> à améliorer
  const fa = dlg.locator("h3:has-text('Full art') + ul .opt");
  if ((await fa.count()) > 0) {
    await fa.first().getByRole("button", { name: "Je l'ai" }).click();
  } else {
    await dlg.getByText("Ma carte n'est pas dans la liste").click();
    await dlg.getByRole("button", { name: "J'ai une Full art" }).click();
  }
  await expect(dlg.getByText(/version\(s\) plus rare/)).toBeVisible();
  await dlg.getByRole("button", { name: /Je préfère la mienne/ }).click();
  await expect(dlg.getByText(/Choix conservé/).first()).toBeVisible();
  await dlg.getByRole("button", { name: "Fermer" }).click();
  await expect(tile).toHaveClass(/choisie/);
  // nettoyage
  await tile.click();
  page.once("dialog", (d) => void d.accept());
  await dlg.getByRole("button", { name: "Retirer du binder" }).click();
  await expect(tile).toHaveClass(/manquante/);
});

test("fiche : adresse partageable, flèches, retour arrière", async ({ page, isMobile }) => {
  test.skip(isMobile, "flèches clavier testées sur desktop");
  await page.goto("/");
  await page.locator(".tile").first().click();
  const dlg = page.locator("#detail");
  await expect(dlg.getByRole("heading", { name: "#001 Bulbizarre" })).toBeVisible();
  await expect(page).toHaveURL(/p=1$/);
  await page.keyboard.press("ArrowRight");
  await expect(dlg.getByRole("heading", { name: "#002 Herbizarre" })).toBeVisible();
  await expect(page).toHaveURL(/p=2$/);
  await page.goBack();
  await expect(dlg).toBeHidden();
  // lien direct vers une fiche
  await page.goto("/#p=25");
  await expect(dlg.getByRole("heading", { name: "#025 Pikachu" })).toBeVisible();
  await expect(dlg.locator(".price").first()).toContainText("€");
});

test("visionneuse : grande image, versions suivantes, fermeture", async ({ page }) => {
  await page.goto("/#q=Bulbizarre");
  await page.locator(".tile").first().click();
  const dlg = page.locator("#detail");
  await expect(dlg.locator(".price").first()).toContainText("€");
  await dlg.locator(".thumb").first().click();
  const viewer = page.locator("#viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer.locator("#v-img")).toHaveAttribute("src", /assets\.tcgdex\.net\/test\/.+\.webp$/);
  const first = await viewer.locator("#v-cap").textContent();
  await viewer.getByRole("button", { name: "Version suivante" }).click();
  await expect(viewer.locator("#v-cap")).not.toHaveText(first ?? "");
  await viewer.getByRole("button", { name: "Fermer la visionneuse" }).click();
  await expect(viewer).toBeHidden();
  await expect(dlg).toBeVisible();
});

test("navigation clavier : Tab, Entrée, Échap", async ({ page, isMobile }) => {
  test.skip(isMobile, "pas de clavier sur mobile");
  await page.goto("/#q=Bulbizarre");
  await page.locator(".tile").first().focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#detail")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#detail")).toBeHidden();
});

test("code Cardmarket affiché et copié pour la recherche", async ({ page, context, isMobile }) => {
  test.skip(isMobile, "presse-papiers testé sur desktop");
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#q=Bulbizarre");
  await page.locator(".tile").first().click();
  const dlg = page.locator("#detail");
  await dlg.getByRole("button", { name: "Copier « Bulbizarre (MEW 166) »" }).click();
  await expect(page.locator(".toast")).toContainText("Copié : Bulbizarre (MEW 166)");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("Bulbizarre (MEW 166)");
  const link = dlg.getByRole("link", { name: "Bulbizarre (MEW 166) sur Cardmarket" });
  await expect(link).toHaveAttribute("href", "https://www.cardmarket.com/fr/Pokemon/Products?idProduct=733761");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("carte japonaise : seulement sans IR/SIR française, signalée comme telle", async ({ page }) => {
  await page.goto("/#q=Paras");
  await page.locator(".tile", { hasText: "Paras" }).first().click();
  const dlg = page.locator("#detail");
  await expect(dlg.locator(".price").first()).toContainText("€");
  const opt = dlg.locator(".opt", { hasText: "s12a 207" });
  await expect(opt.locator(".lang")).toHaveText("Japonaise");
  await expect(opt.getByRole("link", { name: "Paras (s12a 207) sur Cardmarket" })).toHaveAttribute(
    "href",
    "https://www.cardmarket.com/fr/Pokemon/Products?idProduct=687769",
  );
  await dlg.getByRole("button", { name: "Fermer" }).click();
  // les espèces qui ont une IR/SIR française n'ont aucune carte japonaise
  await page.getByLabel("Rechercher").fill("Bulbizarre");
  await expect(page.locator(".tile")).toHaveCount(1);
  await page.locator(".tile").click();
  await expect(dlg.getByRole("heading", { name: /Bulbizarre/ })).toBeVisible();
  await expect(dlg.locator(".lang")).toHaveCount(0);
  await expect(dlg.locator(".price").first()).toContainText("€"); // prix simulés servis avant la fin du test
});

test("cartes de repli : forme admise en IR", async ({ page }) => {
  await page.goto("/#q=Caninos");
  await page.locator(".tile", { hasText: "Caninos" }).click();
  const dlg = page.locator("#detail");
  await expect(dlg.locator(".opt", { hasText: "Caninos de Hisui" })).toBeVisible();
  await expect(dlg.locator("h3", { hasText: "Illustration Rare" })).toBeVisible();
  await expect(dlg.locator(".price").first()).toContainText("€");
});

test("cartes de repli : chromatique signalée, faute d'autre carte", async ({ page }) => {
  await page.goto("/#q=%23063");
  await expect(page.locator(".tile")).toHaveCount(1);
  await expect(page.locator(".tile")).toContainText("Chromatique");
  await page.locator(".tile").click();
  const dlg = page.locator("#detail");
  await expect(dlg.getByRole("heading", { name: /Abra/ })).toBeVisible();
  await expect(dlg.locator(".opt").first()).toContainText(/chromatique, pas full art/i);
  await expect(dlg.locator(".price").first()).toContainText("€"); // prix simulés chargés avant la fin du test
});

test("liste d'achat : objectif, liens exacts et « Achetée »", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Liste d'achat" }).click();
  const dlg = page.locator("#buy");
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name: "Réinitialiser" }).click();
  await expect(dlg.getByLabel("Carte retenue")).toHaveValue("objectif");
  // pas de budget : la base E2E n'a pas de prix, et le budget écarte les cartes sans prix
  const first = dlg.locator("#buylist li").first();
  await expect(first.locator("a")).toHaveAttribute(
    "href",
    /^https:\/\/www\.cardmarket\.com\/fr\/Pokemon\/Products\?idProduct=\d+$/,
  );
  const before = await dlg.locator("#buylist li").count();
  await first.getByRole("button", { name: /achetée$/ }).click();
  await expect(page.locator(".toast")).toContainText("marqué comme acheté");
  await expect(dlg.locator("#buylist li")).toHaveCount(before - 1);
  // export CSV de la liste affichée
  const dl = page.waitForEvent("download");
  await dlg.getByRole("button", { name: "Exporter (CSV)" }).click();
  expect((await dl).suggestedFilename()).toMatch(/^liste-achat-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("liste d'achat : prix max par carte, budget total, réglages retenus", async ({ page }) => {
  // prix simulés : la n-ième espèce visée coûte 10 × n €
  await page.route("**/api/pokedex", async (route) => {
    const res = await route.fetch();
    const dex = (await res.json()) as {
      species: { target: string | null; cards: { id: string; price: unknown }[] }[];
    };
    let n = 0;
    for (const s of dex.species) {
      const c = s.cards.find((x) => x.id === s.target);
      if (c) c.price = { trend: 10 * ++n, low: null };
    }
    await route.fulfill({ response: res, json: dex });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Liste d'achat" }).click();
  const dlg = page.locator("#buy");
  await dlg.getByRole("button", { name: "Réinitialiser" }).click();
  await dlg.getByLabel("Prix max par carte (€)").fill("35");
  await expect(dlg.locator("#buylist ol > li")).toHaveCount(3); // 10, 20, 30 €
  await expect(dlg.locator("#buylist")).toContainText("au-dessus de 35,00 € par carte");
  await dlg.getByLabel("Prix max par carte (€)").fill("");
  await dlg.getByLabel("Budget total (€)").fill("65");
  await expect(dlg.locator("#buylist ol > li")).toHaveCount(3); // 10 + 20 + 30 = 60
  await expect(dlg.locator("#buylist")).toContainText("reste 5,00 €");
  await dlg.getByLabel("Tri").selectOption("desc");
  // prix décroissant : les plus chères d'abord, en sautant celles qui ne tiennent plus (ici 60 €, seule)
  await expect(dlg.locator("#buylist ol > li")).toHaveCount(1);
  await expect(dlg.locator("#buylist ol > li input")).toHaveValue("60.00");
  // réglages retenus d'une visite à l'autre
  await page.reload();
  await page.getByRole("button", { name: "Liste d'achat" }).click();
  await expect(dlg.getByLabel("Budget total (€)")).toHaveValue("65");
  await dlg.getByRole("button", { name: "Réinitialiser" }).click();
  await expect(dlg.getByLabel("Budget total (€)")).toHaveValue("");
});

test("prix payé : « Je l'ai » ouvre « Ma carte », le prix compte dans les dépenses", async ({ page }) => {
  await page.request.delete("/api/species/9/owned", { headers: { "X-Requested-With": "pokedex" } });
  await page.goto("/#p=9");
  const dlg = page.locator("#detail");
  await expect(dlg.locator(".price").first()).toContainText("€");
  await dlg.locator(".versions .opt").first().getByRole("button", { name: "Je l'ai" }).click();
  const paid = dlg.getByLabel("Prix payé (€)");
  await expect(paid).toBeFocused();
  await paid.fill("12.5");
  await dlg.locator("details.mycard").getByRole("button", { name: "Enregistrer" }).click();
  await expect(dlg.locator("details.mycard summary")).toContainText("12,50 €");
  await dlg.getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("button", { name: "Statistiques" }).click();
  await expect(page.locator("#stats")).not.toContainText("Tortank,");
  await page.request.delete("/api/species/9/owned", { headers: { "X-Requested-With": "pokedex" } });
});

test("commande : en attente, vérification à réception, puis binder", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Liste d'achat" }).click();
  const dlg = page.locator("#buy");
  const first = dlg.locator("#buylist ol li").first();
  const label = (await first.locator("a").textContent()) ?? "";
  await first.getByRole("button", { name: /commandée$/ }).click();
  await expect(page.locator(".toast")).toContainText("commande enregistrée");
  const orders = dlg.locator("section.orders");
  await expect(orders).toContainText(label);
  await orders.getByText("Reçue : vérifier la carte").click();
  const confirmBtn = orders.getByRole("button", { name: "Confirmer la réception" });
  await expect(confirmBtn).toBeDisabled();
  for (const box of await orders.getByRole("checkbox").all()) await box.check();
  await confirmBtn.click();
  await expect(page.locator(".toast").last()).toContainText("ajouté au binder");
  await expect(dlg.locator("section.orders")).toHaveCount(0);
});

test("fiche : écarter une version, la réintégrer, viser une version", async ({ page }) => {
  // état connu : Florizarre pas dans le binder (d'autres tests achètent des cartes)
  await page.request.delete("/api/species/3/owned", { headers: { "X-Requested-With": "pokedex" } });
  await page.goto("/#p=3");
  const dlg = page.locator("#detail");
  await expect(dlg.locator(".price").first()).toContainText("€");
  // une version qui n'est pas « la mienne » (d'autres tests ont pu acheter une carte de l'espèce)
  const opt = dlg.locator(".versions .opt:not(.mine)").first();
  const name = (await opt.locator(".code").textContent()) ?? "";
  await opt.getByRole("button", { name: "Écarter" }).click();
  const out = dlg.locator("details.excluded");
  await expect(out).toContainText(`Versions écartées (1)`);
  await out.locator(":scope > summary").click();
  await out.getByRole("button", { name: "Réintégrer" }).click();
  await expect(dlg.locator("details.excluded")).toHaveCount(0);
  await dlg.locator(".versions .opt", { hasText: name }).getByRole("button", { name: "Viser cette version" }).click();
  await expect(dlg.locator(".chip.goal", { hasText: "ton choix" })).toBeVisible();
  await dlg.getByRole("button", { name: "Ne plus viser" }).click();
  await expect(dlg.locator(".chip.goal", { hasText: "ton choix" })).toHaveCount(0);
});

test("alertes de prix : annonce au chargement, cloche, vue rapide, statistiques", async ({ page }) => {
  // Pikachu : prix tendance (20 €) sous l'alerte (50 €), sans attendre une vraie baisse
  await page.route("**/api/pokedex", async (route) => {
    const res = await route.fetch();
    const dex = (await res.json()) as {
      species: { num: number; cards: { alert?: number | null; price: unknown; excluded: boolean }[] }[];
    };
    const card = dex.species.find((s) => s.num === 25)?.cards.find((c) => !c.excluded);
    if (card) Object.assign(card, { alert: 50, price: { trend: 20, low: 15 } });
    await route.fulfill({ response: res, json: dex });
  });
  await page.goto("/");
  await expect(page.locator(".toast")).toContainText("Alerte de prix atteinte : Pikachu.");
  await expect(page.locator('.tile[data-num="25"] .bell')).toBeVisible();
  await expect(page.locator("#progress")).toContainText("🔔 1 alerte");
  await page.locator("#quick").getByRole("button", { name: "Alertes de prix" }).click();
  await expect(page.locator(".tile")).toHaveCount(1);
  await expect(page).toHaveURL(/f=alertes/);
  await page.getByRole("button", { name: "Statistiques" }).click();
  await expect(page.locator("#stats")).toContainText("Alertes de prix");
  await expect(page.locator("#stats")).toContainText("max 50,00");
});

test("fiche : poser, modifier et retirer une alerte de prix", async ({ page }) => {
  await page.goto("/#p=7");
  const dlg = page.locator("#detail");
  await expect(dlg.locator(".price").first()).toContainText("€");
  const opt = dlg.locator(".versions .opt:not(.mine)").first();
  const code = (await opt.locator(".code").textContent()) ?? "";
  await opt.locator("details.alert-d summary").click();
  await opt.getByLabel(/Prix maximum/).fill("12.5");
  await opt.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator(".toast").last()).toContainText("Alerte :");
  const again = dlg.locator(".versions .opt", { hasText: code });
  await expect(again.locator(".chip.alert")).toContainText("12,50");
  await again.locator("details.alert-d summary").click();
  await again.getByRole("button", { name: "Retirer l'alerte" }).click();
  await expect(dlg.locator(".versions .opt", { hasText: code }).locator(".chip.alert")).toHaveCount(0);
});

test("fiche : ajouter une version manquante (recherche TCGdex simulée)", async ({ page }) => {
  await page.route("**/api/species/*/candidates", (route) =>
    route.fulfill({
      json: {
        candidates: [
          {
            id: "sv08-200",
            name: "Carapuce",
            numero: "200",
            image: "https://assets.tcgdex.net/fr/sv/sv08/200/low.webp",
          },
        ],
      },
    }),
  );
  let sent: unknown = null;
  await page.route("**/api/cards", async (route) => {
    sent = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { ok: true } });
  });
  await page.goto("/#p=7");
  const dlg = page.locator("#detail");
  await dlg.locator("details.addv summary").click();
  await dlg.getByLabel("Rareté de la version ajoutée").selectOption("SIR");
  page.once("dialog", (d) => void d.accept());
  await dlg.getByRole("button", { name: "Ajouter Carapuce 200 (sv08-200)" }).click();
  await expect(page.locator(".toast").last()).toContainText("Carapuce 200 ajoutée (SIR).");
  expect(sent).toEqual({ species_num: 7, id: "sv08-200", tier: "SIR" });
});

test("illustrateur : affiché dans la fiche, un clic cherche ses autres cartes", async ({ page }) => {
  await page.route("**/api/pokedex", async (route) => {
    const res = await route.fetch();
    const dex = (await res.json()) as { species: { num: number; cards: { illustrateur?: string | null }[] }[] };
    for (const n of [1, 4]) {
      const card = dex.species.find((s) => s.num === n)?.cards[0];
      if (card) card.illustrateur = "Kawayoo";
    }
    await route.fulfill({ response: res, json: dex });
  });
  await page.goto("/#p=1");
  const dlg = page.locator("#detail");
  await expect(dlg.locator(".price").first()).toContainText("€");
  await dlg.getByRole("button", { name: "Kawayoo" }).first().click();
  await expect(dlg).toBeHidden();
  await expect(page.getByLabel("Rechercher")).toHaveValue("Kawayoo");
  await expect(page.locator(".tile")).toHaveCount(2);
  await expect(page).toHaveURL(/q=Kawayoo/);
  await expect(page).not.toHaveURL(/p=1/);
});

test("vue classeur : 17 pages de 9 cases, une case ouvre la fiche", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Classeur" }).click();
  await expect(page).toHaveURL(/v=classeur/);
  await expect(page.locator("#binder .page")).toHaveCount(17);
  await expect(page.locator("#binder .slot")).toHaveCount(151);
  await expect(page.locator("#grid")).toBeHidden();
  await page.locator("#binder .slot").nth(24).click();
  await expect(page.locator("#detail").getByRole("heading", { name: "#025 Pikachu" })).toBeVisible();
  await expect(page.locator("#detail")).toContainText("Classeur : page 3, case 7.");
  await expect(page.locator("#detail .price").first()).toContainText("€");
  await page.locator("#detail").getByRole("button", { name: "Fermer" }).click();
  await page.getByRole("button", { name: "Grille" }).click();
  await expect(page.locator("#grid")).toBeVisible();
});

test("statistiques : progression, valeur, dépenses", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Statistiques" }).click();
  const dlg = page.locator("#stats");
  await expect(dlg).toContainText("Progression");
  await expect(dlg).toContainText("Valeur estimée");
  await expect(dlg).toContainText("Dépenses");
});

test("ma carte : état, gradation, doubles", async ({ page }) => {
  const headers = { "X-Requested-With": "pokedex" };
  const dex = (await (await page.request.get("/api/pokedex")).json()) as {
    species: { num: number; cards: { id: string }[] }[];
  };
  const card = dex.species.find((x) => x.num === 4)?.cards[0]?.id ?? "";
  await page.request.put("/api/species/4/owned", { headers, data: { card_id: card } });
  await page.goto("/#p=4");
  const dlg = page.locator("#detail");
  await expect(dlg.locator(".price").first()).toContainText("€");
  await dlg.locator("details.mycard summary").click();
  await dlg.getByLabel("État").selectOption("NM");
  await dlg.getByLabel("Gradée").fill("PSA 9");
  await dlg.getByLabel("Doubles").fill("1");
  await dlg.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.locator(".toast")).toContainText("Ma carte : enregistré.");
  await expect(dlg.locator("details.mycard summary")).toHaveText("Ma carte : NM · PSA 9 · 1 double");
  await page.request.delete("/api/species/4/owned", { headers });
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
  // l'ancienne liaison API Cardmarket a disparu
  await expect(page.getByText("Compte Cardmarket")).toHaveCount(0);
});

test("pas de défilement horizontal", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(151);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("accessibilité (axe) : page, fiche et visionneuse sans violation sérieuse", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".tile")).toHaveCount(151);
  const scan = async () =>
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => `${v.id}: ${v.nodes.length}`);
  expect(await scan()).toEqual([]);
  await page.locator(".tile").first().click();
  await expect(page.locator("#detail .price").first()).toContainText("€");
  expect(await scan()).toEqual([]);
  await page.locator("#detail .zoom").click();
  await expect(page.locator("#viewer")).toBeVisible();
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
  // emplacement dans le classeur et carte visée avec QR code (version enrichie, par défaut)
  await expect(page.locator(".ph .slot").first()).toHaveText("p. 1 · c. 1");
  await expect(page.locator(".ph.rich .qr").first()).toBeVisible();
  await page.locator("#rich").selectOption("non");
  await expect(page.locator(".ph .qr")).toHaveCount(0);
  expect(errors).toEqual([]);
});
