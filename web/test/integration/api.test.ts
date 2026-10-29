import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetJwksCache } from "../../src/worker/auth";
import { scheduledRefresh } from "../../src/worker/cron";
import { applyPriceGuide, FEED_URL } from "../../src/worker/feed";
import { call, mockOutbound, ORIGIN } from "../helpers";

interface SpeciesDto {
  num: number;
  status: string;
  target: string | null;
  wish: string | null;
  order: { id: number; card_id: string } | null;
  owned: { card_id: string | null } | null;
  higher: string[];
  options: { tier: string; card_id: string }[];
  cards: {
    id: string;
    code_cm: string | null;
    cm_label: string;
    cm_url: string | null;
    tier: string;
    langue: string;
    excluded: boolean;
    price: { trend: number; source?: string; avg30?: number | null } | null;
  }[];
}
const pokedex = async () => (await (await call("/api/pokedex")).json<{ species: SpeciesDto[] }>()).species;
const species = async (n: number) => (await pokedex()).find((s) => s.num === n)!;

beforeEach(() => {
  resetJwksCache();
  mockOutbound({ "xy1-141": 50, "sv03.5-166": 40, "sv03.5-198": 90, "sv03.5-167": 20, "S12a-207": 17 });
});
afterEach(() => vi.restoreAllMocks());

describe("authentification et en-têtes", () => {
  it("401 sans jeton, sur l'API comme sur les pages", async () => {
    expect((await call("/api/pokedex", { auth: false })).status).toBe(401);
    expect((await call("/", { auth: false })).status).toBe(401);
  });
  it("401 avec un jeton forgé", async () => {
    const r = await call("/api/pokedex", { auth: false, headers: { "Cf-Access-Jwt-Assertion": "a.b.c" } });
    expect(r.status).toBe(401);
  });
  it("en-têtes de sécurité sur toutes les réponses", async () => {
    for (const r of [await call("/api/pokedex"), await call("/api/inconnu"), await call("/", { auth: false })]) {
      const csp = r.headers.get("Content-Security-Policy") ?? "";
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("script-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("require-trusted-types-for 'script'");
      expect(r.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(r.headers.get("X-Frame-Options")).toBe("DENY");
      expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
  });
  it("API jamais en cache", async () =>
    expect((await call("/api/pokedex")).headers.get("Cache-Control")).toBe("no-store"));
});

describe("anti-CSRF", () => {
  it("écriture sans en-tête custom refusée", async () =>
    expect((await call("/api/species/1/owned", { method: "PUT", json: { tier: "IR" }, csrf: false })).status).toBe(
      403,
    ));
  it("écriture depuis une autre origine refusée", async () =>
    expect(
      (
        await call("/api/species/1/owned", {
          method: "PUT",
          json: { tier: "IR" },
          headers: { Origin: "https://evil.example" },
        })
      ).status,
    ).toBe(403));
  it("Sec-Fetch-Site cross-site refusé", async () =>
    expect(
      (
        await call("/api/species/1/owned", {
          method: "PUT",
          json: { tier: "IR" },
          headers: { "Sec-Fetch-Site": "cross-site" },
        })
      ).status,
    ).toBe(403));
  it("même origine acceptée", async () =>
    expect(
      (
        await call("/api/species/1/owned", {
          method: "PUT",
          json: { tier: "IR" },
          headers: { Origin: ORIGIN, "Sec-Fetch-Site": "same-origin" },
        })
      ).status,
    ).toBe(200));
  it("corps non JSON refusé", async () =>
    expect(
      (
        await call("/api/species/1/owned", {
          method: "PUT",
          body: "tier=IR",
          headers: { "Content-Type": "text/plain" },
        })
      ).status,
    ).toBe(400));
});

describe("pokédex et cycle de vie d'une espèce", () => {
  it("liste complète, statuts initiaux", async () => {
    const all = await pokedex();
    expect(all.map((s) => s.num)).toEqual([1, 2, 151]);
    expect(all.every((s) => s.status === "manquante")).toBe(true);
    expect((await species(151)).cards).toEqual([]);
  });
  it("expose le code Cardmarket de chaque carte", async () => {
    const cards = (await species(1)).cards;
    expect(Object.fromEntries(cards.map((c) => [c.id, c.code_cm]))).toEqual({
      "xy1-141": "XY 141",
      "sv03.5-166": "MEW 166",
      "sv03.5-198": "MEW 198",
    });
    expect(cards.find((c) => c.id === "sv03.5-198")?.cm_label).toBe("Florizarre ex (MEW 198)");
    expect(cards.find((c) => c.id === "sv03.5-166")?.cm_url).toBe(
      "https://www.cardmarket.com/fr/Pokemon/Products?idProduct=733761",
    );
  });
  it("prix en direct : met à jour cache et options", async () => {
    const live = await (await call("/api/species/1/prices")).json<Record<string, { trend: number }>>();
    expect(live["sv03.5-166"]?.trend).toBe(40);
    const s = await species(1);
    expect(s.cards.find((c) => c.id === "sv03.5-198")?.price?.trend).toBe(90);
    expect(s.options.map((o) => o.tier)).toEqual(["FA", "IR", "SIR"]);
    const hist = await env.DB.prepare("SELECT COUNT(*) n FROM price_history").first<{ n: number }>();
    expect(hist?.n).toBe(3);
  });
  it("carte dans une autre langue : prix lus sur TCGdex dans sa langue, langue exposée", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO species VALUES (46,'Paras','Paras')"),
      env.DB.prepare(
        `INSERT INTO cards (id,species_num,nom_fr,set_name,numero,categorie,tier,confiance,id_product,code_cm,nom_cm,langue)
         VALUES ('S12a-207',46,'Paras','VSTAR Universe','207','AR','IR','certain',687769,'s12a 207','Paras [Absorb]','ja')`,
      ),
    ]);
    const live = await (await call("/api/species/46/prices")).json<Record<string, { trend: number }>>();
    expect(live["S12a-207"]?.trend).toBe(17);
    const urls = vi.mocked(fetch).mock.calls.map(([u]) => String(u instanceof Request ? u.url : u));
    expect(urls).toContain("https://api.tcgdex.net/v2/ja/cards/S12a-207");
    const paras = (await species(46)).cards[0];
    expect(paras).toMatchObject({ langue: "ja", tier: "IR", cm_label: "Paras (s12a 207)" });
    expect((await species(1)).cards.every((c) => c.langue === "fr")).toBe(true);
    // le stockage n'est pas isolé entre tests : on retire l'espèce ajoutée
    await env.DB.batch(
      [
        "DELETE FROM price_history WHERE card_id = 'S12a-207'",
        "DELETE FROM price_cache WHERE card_id = 'S12a-207'",
        "DELETE FROM cards WHERE id = 'S12a-207'",
        "DELETE FROM species WHERE num = 46",
      ].map((q) => env.DB.prepare(q)),
    );
  });
  it("IR possédée -> à vérifier -> « je préfère la mienne » -> choisie", async () => {
    expect((await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } })).status).toBe(200);
    let s = await species(1);
    expect(s.status).toBe("a_verifier");
    expect(s.higher).toEqual(["sv03.5-198"]);
    expect((await call("/api/species/1/keep", { method: "PUT", json: {} })).status).toBe(200);
    expect((await species(1)).status).toBe("choisie");
    // changer de carte invalide la décision
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "xy1-141" } });
    s = await species(1);
    expect(s.status).toBe("a_verifier");
    expect(s.higher.sort()).toEqual(["sv03.5-166", "sv03.5-198"]);
  });
  it("SIR possédée -> complète ; retrait -> manquante", async () => {
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-198" } });
    expect((await species(1)).status).toBe("complete");
    await call("/api/species/1/owned", { method: "DELETE" });
    expect((await species(1)).status).toBe("manquante");
  });
  it("carte hors catalogue déclarée par tier", async () => {
    await call("/api/species/2/owned", { method: "PUT", json: { tier: "SIR" } });
    expect((await species(2)).status).toBe("complete");
  });
  it("refus : carte d'une autre espèce, espèce hors bornes, keep sans possession", async () => {
    expect((await call("/api/species/2/owned", { method: "PUT", json: { card_id: "sv03.5-166" } })).status).toBe(400);
    expect((await call("/api/species/152/owned", { method: "PUT", json: { tier: "IR" } })).status).toBe(400);
    expect((await call("/api/species/0/prices")).status).toBe(400);
    expect((await call("/api/species/1/keep", { method: "PUT", json: {} })).status).toBe(409);
  });
  it("journal d'audit des écritures", async () => {
    await call("/api/species/1/owned", { method: "PUT", json: { tier: "FA" } });
    const row = await env.DB.prepare("SELECT actor, action FROM audit_log").first<{ actor: string; action: string }>();
    expect(row).toEqual({ actor: "terence@example.com", action: "owned.set" });
  });
});

describe("liste d'envies, export/import", () => {
  it("liste d'envies des manquantes, la moins chère", async () => {
    await call("/api/species/1/prices");
    await call("/api/species/2/prices");
    const txt = await (await call("/api/wants?tier=cheapest")).text();
    expect(txt.split("\n").sort()).toEqual(["1 Bulbasaur Leech Seed 151", "1 Ivysaur Leech Seed Vine Whip"]);
    expect((await call("/api/wants?tier=XX")).status).toBe(400);
  });
  it("liste d'achat : SIR sinon IR, triée par prix, dans le budget, avec lien exact", async () => {
    await call("/api/species/1/prices");
    await call("/api/species/2/prices");
    type Buy = { items: { espece: string; label: string; url: string | null; trend: number }[]; total: number };
    const all = await (await call("/api/buylist?tier=sir_ir")).json<Buy>();
    expect(all.items.map((i) => [i.espece, i.trend])).toEqual([
      ["Herbizarre", 20],
      ["Bulbizarre", 90],
    ]);
    expect(all.total).toBe(110);
    expect(all.items[1]?.label).toBe("Florizarre ex (MEW 198)");
    const within = await (await call("/api/buylist?tier=sir_ir&budget=50")).json<Buy>();
    expect(within.items).toEqual([
      {
        num: 2,
        card_id: "sv03.5-167",
        espece: "Herbizarre",
        label: "Herbizarre (MEW 167)",
        url: "https://www.cardmarket.com/fr/Pokemon/Products?idProduct=733762",
        langue: "fr",
        tier: "IR",
        categorie: "IR",
        image: "https://assets.tcgdex.net/fr/x/sv03.5-167/low.webp",
        upgrade: false,
        trend: 20,
      },
    ]);
    expect(within.total).toBe(20);
    expect((await call("/api/buylist?budget=-1")).status).toBe(400);
  });
  it("objectif : la rareté la plus haute, améliorations comprises", async () => {
    await call("/api/species/1/prices");
    await call("/api/species/2/prices");
    expect((await species(1)).target).toBe("sv03.5-198"); // SIR visée
    expect((await species(151)).target).toBeNull(); // aucune carte
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } }); // IR possédée, SIR existe
    type Buy = { items: { espece: string; card_id: string; upgrade: boolean }[] };
    const buy = await (await call("/api/buylist")).json<Buy>(); // objectif par défaut
    expect(buy.items.map((i) => [i.espece, i.card_id, i.upgrade])).toEqual([
      ["Herbizarre", "sv03.5-167", false],
      ["Bulbizarre", "sv03.5-198", true],
    ]);
    // les autres modes ne listent que les espèces manquantes
    expect((await (await call("/api/buylist?tier=cheapest")).json<Buy>()).items.map((i) => i.espece)).toEqual([
      "Herbizarre",
    ]);
    await call("/api/species/1/keep", { method: "PUT", json: {} }); // « je préfère la mienne »
    expect((await species(1)).target).toBeNull();
    expect((await call("/api/wants")).status).toBe(200);
  });
  it("l'ancienne API Cardmarket n'existe plus", async () => {
    expect((await call("/api/cardmarket")).status).toBe(404);
  });
  it("placeholders : une fiche par espèce manquante, ou les 151", async () => {
    type Ph = { items: { num: number; nom_fr: string }[] };
    const miss = await (await call("/api/placeholders")).json<Ph>();
    expect(miss.items).toEqual([
      { num: 1, nom_fr: "Bulbizarre" },
      { num: 2, nom_fr: "Herbizarre" },
      { num: 151, nom_fr: "Mew" },
    ]);
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } });
    expect((await (await call("/api/placeholders")).json<Ph>()).items.map((i) => i.num)).toEqual([2, 151]);
    expect((await (await call("/api/placeholders?scope=all")).json<Ph>()).items.map((i) => i.num)).toEqual([1, 2, 151]);
    expect((await call("/api/placeholders?scope=XX")).status).toBe(400);
  });

  it("export puis import (remplacement atomique)", async () => {
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } });
    await call("/api/species/1/keep", { method: "PUT", json: { note: "j'aime l'illustration" } });
    const dump = await (await call("/api/export")).json();
    await call("/api/species/1/owned", { method: "DELETE" });
    const r = await call("/api/import", { method: "POST", json: dump });
    expect(r.status).toBe(200);
    expect((await species(1)).status).toBe("choisie");
  });
  it("import invalide rejeté sans rien modifier", async () => {
    await call("/api/species/2/owned", { method: "PUT", json: { tier: "IR" } });
    const bad = { version: 1, owned: [{ species_num: 1, card_id: "sv03.5-198", tier: "FA", note: null }], keep: [] };
    expect((await call("/api/import", { method: "POST", json: bad })).status).toBe(400);
    expect(
      (await call("/api/import", { method: "POST", json: { version: 1, owned: [], keep: [{ species_num: 1 }] } }))
        .status,
    ).toBe(400);
    expect((await species(2)).status).toBe("complete");
  });
  it("corps trop gros refusé", async () => {
    const r = await call("/api/import", {
      method: "POST",
      body: "x".repeat(300 * 1024),
      headers: { "Content-Type": "application/json" },
    });
    expect(r.status).toBe(413);
  });
});

describe("version visée, versions écartées", () => {
  it("viser une version précise : elle devient la carte visée", async () => {
    expect((await species(1)).target).toBe("sv03.5-198"); // SIR, seule de sa rareté
    expect((await call("/api/species/1/wish", { method: "PUT", json: { card_id: "xy1-141" } })).status).toBe(200);
    const s = await species(1);
    expect(s.wish).toBe("xy1-141");
    expect(s.target).toBe("xy1-141");
    expect((await call("/api/species/1/wish", { method: "PUT", json: { card_id: "sv03.5-167" } })).status).toBe(400);
    await call("/api/species/1/wish", { method: "DELETE" });
    expect((await species(1)).target).toBe("sv03.5-198");
  });
  it("écarter la SIR : l'objectif redescend à l'IR, et l'IR possédée suffit", async () => {
    await call("/api/species/1/wish", { method: "PUT", json: { card_id: "sv03.5-198" } });
    expect((await call("/api/cards/sv03.5-198/excluded", { method: "PUT", json: { reason: "pas fan" } })).status).toBe(
      200,
    );
    let s = await species(1);
    expect(s.wish).toBeNull(); // une version écartée ne peut plus être visée
    expect(s.target).toBe("sv03.5-166");
    expect(s.cards.find((c) => c.id === "sv03.5-198")?.excluded).toBe(true);
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } });
    expect((await species(1)).status).toBe("complete");
    await call("/api/cards/sv03.5-198/excluded", { method: "DELETE" });
    s = await species(1);
    expect(s.status).toBe("a_verifier");
    expect((await call("/api/cards/inconnue-1/excluded", { method: "PUT", json: {} })).status).toBe(400);
  });
});

describe("commandes", () => {
  type Purchases = { purchases: { id: number; state: string; price_paid: number | null; espece: string }[] };
  it("commandée -> hors liste d'achat -> reçue : passe au binder avec le prix payé", async () => {
    expect(
      (await call("/api/purchases", { method: "POST", json: { card_id: "sv03.5-167", price_paid: 18.5 } })).status,
    ).toBe(201);
    const s = await species(2);
    expect(s.order?.card_id).toBe("sv03.5-167");
    expect(s.status).toBe("manquante");
    const buy = await (await call("/api/buylist")).json<{ items: { espece: string }[] }>();
    expect(buy.items.map((i) => i.espece)).not.toContain("Herbizarre");
    // une seule commande en cours par espèce
    expect((await call("/api/purchases", { method: "POST", json: { card_id: "sv03.5-167" } })).status).toBe(409);
    const { purchases } = await (await call("/api/purchases")).json<Purchases>();
    expect(purchases[0]).toMatchObject({ state: "commandee", price_paid: 18.5, espece: "Herbizarre" });
    const id = purchases[0]!.id;
    expect((await call(`/api/purchases/${id}`, { method: "PATCH", json: { state: "recue" } })).status).toBe(200);
    expect((await species(2)).status).toBe("complete");
    expect((await species(2)).order).toBeNull();
    expect((await call(`/api/purchases/${id}`, { method: "PATCH", json: { state: "annulee" } })).status).toBe(409);
  });
  it("achat déjà en main : directement au binder ; annulation possible avant réception", async () => {
    await call("/api/purchases", { method: "POST", json: { card_id: "sv03.5-198", price_paid: 80, received: true } });
    expect((await species(1)).owned?.card_id).toBe("sv03.5-198");
    await call("/api/purchases", { method: "POST", json: { card_id: "sv03.5-167" } });
    const { purchases } = await (await call("/api/purchases")).json<Purchases>();
    const pending = purchases.find((p) => p.state === "commandee")!;
    await call(`/api/purchases/${pending.id}`, { method: "PATCH", json: { state: "annulee" } });
    expect((await species(2)).order).toBeNull();
    expect((await species(2)).status).toBe("manquante");
    expect((await call("/api/purchases/999", { method: "PATCH", json: { state: "recue" } })).status).toBe(404);
    expect((await call("/api/purchases", { method: "POST", json: { card_id: "x", price_paid: -1 } })).status).toBe(400);
  });
});

describe("sauvegarde v2 et historique", () => {
  it("export/import : versions visées, écartées et commandes comprises", async () => {
    await call("/api/species/1/wish", { method: "PUT", json: { card_id: "xy1-141" } });
    await call("/api/cards/sv03.5-198/excluded", { method: "PUT", json: { reason: "pas fan" } });
    await call("/api/purchases", { method: "POST", json: { card_id: "sv03.5-167", price_paid: 12 } });
    const dump = await (
      await call("/api/export")
    ).json<{
      version: number;
      wish: unknown[];
      excluded: unknown[];
      purchases: unknown[];
    }>();
    expect([dump.version, dump.wish.length, dump.excluded.length, dump.purchases.length]).toEqual([2, 1, 1, 1]);
    await call("/api/species/1/wish", { method: "DELETE" });
    await call("/api/cards/sv03.5-198/excluded", { method: "DELETE" });
    expect((await call("/api/import", { method: "POST", json: dump })).status).toBe(200);
    const s = await species(1);
    expect(s.wish).toBe("xy1-141");
    expect(s.cards.find((c) => c.id === "sv03.5-198")?.excluded).toBe(true);
    expect((await species(2)).order?.card_id).toBe("sv03.5-167");
    // carte inconnue dans une commande : rien n'est modifié
    const bad = { ...dump, purchases: [{ ...(dump.purchases[0] as object), card_id: "inconnue-1" }] };
    expect((await call("/api/import", { method: "POST", json: bad })).status).toBe(400);
    expect((await species(1)).wish).toBe("xy1-141");
  });
  it("historique des prix par carte", async () => {
    await call("/api/species/1/prices");
    const h = await (await call("/api/species/1/history")).json<Record<string, [string, number][]>>();
    expect(h["sv03.5-166"]?.[0]?.[1]).toBe(40);
    expect((await call("/api/species/0/history")).status).toBe(400);
  });
});

describe("guide de prix Cardmarket", () => {
  const feed = (guide: string, trend: number) => ({
    version: 1,
    guide,
    generated_at: "2026-10-30T04:30:00+00:00",
    prices: { "733761": { trend, low: 30, avg1: null, avg7: 60, avg30: 66.95 } },
  });
  const serve = (body: unknown) =>
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === FEED_URL) return Response.json(body);
      throw new Error(`réseau interdit en test : ${url}`);
    });
  it("applique le guide une seule fois, avec moyenne 30 jours et historique", async () => {
    serve(feed("2026-10-30T02:50:00+0100", 69.53));
    expect(await applyPriceGuide(env.DB)).toBe(1);
    expect(await applyPriceGuide(env.DB)).toBe(0); // même guide : rien à refaire
    vi.restoreAllMocks();
    mockOutbound();
    const p = (await species(1)).cards.find((c) => c.id === "sv03.5-166")?.price;
    expect(p).toMatchObject({ trend: 69.53, avg30: 66.95, source: "cardmarket" });
    const h = await env.DB.prepare("SELECT day, trend FROM price_history WHERE card_id = 'sv03.5-166'").all();
    expect(h.results).toEqual([{ day: "2026-10-30", trend: 69.53 }]);
  });
  it("un guide récent n'est pas écrasé par TCGdex ; un guide invalide est ignoré", async () => {
    serve(feed("2026-10-30T02:50:00+0100", 69.53));
    await applyPriceGuide(env.DB);
    vi.restoreAllMocks();
    mockOutbound({ "sv03.5-166": 40 });
    const live = await (await call("/api/species/1/prices")).json<Record<string, { trend: number; source: string }>>();
    expect(live["sv03.5-166"]).toMatchObject({ trend: 69.53, source: "cardmarket" });
    vi.restoreAllMocks();
    serve({ version: 1, guide: "x", prices: {} });
    expect(await applyPriceGuide(env.DB)).toBe(0);
  });
});

describe("cron", () => {
  it("rafraîchit la liste à surveiller, plus anciens d'abord", async () => {
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-198" } }); // complète : hors surveillance
    const n = await scheduledRefresh(env);
    expect(n).toBe(1); // seule Herbizarre (manquante)
    const ids = (await env.DB.prepare("SELECT card_id FROM price_cache").all<{ card_id: string }>()).results.map(
      (r) => r.card_id,
    );
    expect(ids).toEqual(["sv03.5-167"]);
  });
  it("source de prix en panne : aucune écriture, pas d'erreur", async () => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("panne"));
    expect(await scheduledRefresh(env)).toBe(0);
  });
});

describe("santé et service token CI", () => {
  it("santé : 151 espèces attendues", async () => {
    const r = await call("/api/health");
    expect(r.status).toBe(503); // le jeu de test n'a que 3 espèces
    expect(await r.json()).toMatchObject({ ok: false, species: 3 });
  });
  it("le service token ne lit que /api/health", async () => {
    const { signJwt } = await import("../helpers");
    const token = await signJwt({ email: undefined, common_name: "ci-token.access" });
    const headers = { "Cf-Access-Jwt-Assertion": token };
    expect((await call("/api/health", { auth: false, headers })).status).toBe(503);
    expect((await call("/api/pokedex", { auth: false, headers })).status).toBe(403);
    expect(
      (await call("/api/species/1/owned", { auth: false, headers, method: "PUT", json: { tier: "IR" } })).status,
    ).toBe(403);
    const other = await signJwt({ email: undefined, common_name: "autre.access" });
    expect((await call("/api/health", { auth: false, headers: { "Cf-Access-Jwt-Assertion": other } })).status).toBe(
      401,
    );
  });
});
