import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetJwksCache } from "../../src/worker/auth";
import { scheduledRefresh } from "../../src/worker/cron";
import { applyPriceGuide, FEED_URL } from "../../src/worker/feed";
import { call, jwks, mockOutbound, ORIGIN, TEAM } from "../helpers";

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
    origine?: string;
    alert?: number | null;
    price: { trend: number; source?: string; avg30?: number | null } | null;
  }[];
}
const pokedex = async () => (await (await call("/api/pokedex")).json<{ species: SpeciesDto[] }>()).species;
const species = async (n: number) => (await pokedex()).find((s) => s.num === n)!;

beforeEach(() => {
  resetJwksCache();
  // la suite enchaîne plus de 120 appels par minute : limiteur neutralisé, testé à part ci-dessous
  vi.spyOn(env.RATE_LIMITER, "limit").mockResolvedValue({ success: true });
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
      expect(csp).toContain("https://images.pokemontcg.io");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("require-trusted-types-for 'script'");
      expect(csp).toContain("trusted-types sw");
      expect(r.headers.get("Strict-Transport-Security")).toContain("max-age=63072000");
      expect(r.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(r.headers.get("X-Frame-Options")).toBe("DENY");
      expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
    }
  });
  it("API jamais en cache", async () =>
    expect((await call("/api/pokedex")).headers.get("Cache-Control")).toBe("no-store"));
});

describe("limite de débit", () => {
  it("429 quand le quota par utilisateur est dépassé", async () => {
    vi.spyOn(env.RATE_LIMITER, "limit").mockResolvedValue({ success: false });
    const r = await call("/api/pokedex");
    expect(r.status).toBe(429);
    expect(await r.json()).toEqual({ error: "trop de requêtes, réessaie dans une minute" });
  });
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
  it("l'ancienne liste d'achat côté serveur n'existe plus (calculée dans le navigateur)", async () => {
    expect((await call("/api/buylist")).status).toBe(404);
  });
  it("objectif : la rareté la plus haute, améliorations comprises", async () => {
    await call("/api/species/1/prices");
    await call("/api/species/2/prices");
    expect((await species(1)).target).toBe("sv03.5-198"); // SIR visée
    expect((await species(151)).target).toBeNull(); // aucune carte
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } }); // IR possédée, SIR existe
    expect(await species(1)).toMatchObject({ status: "a_verifier", target: "sv03.5-198" }); // amélioration visée
    expect((await species(2)).target).toBe("sv03.5-167");
    await call("/api/species/1/keep", { method: "PUT", json: {} }); // « je préfère la mienne »
    expect((await species(1)).target).toBeNull();
    expect((await call("/api/wants")).status).toBe(200);
  });
  it("l'ancienne API Cardmarket n'existe plus", async () => {
    expect((await call("/api/cardmarket")).status).toBe(404);
  });
  it("placeholders : une fiche par espèce manquante, ou les 151", async () => {
    type Ph = {
      items: {
        num: number;
        nom_fr: string;
        slot: { page: number; case: number };
        target: { code: string; tier: string; url: string } | null;
      }[];
    };
    const miss = await (await call("/api/placeholders")).json<Ph>();
    expect(miss.items.map((i) => [i.num, i.nom_fr, i.slot.page, i.slot.case])).toEqual([
      [1, "Bulbizarre", 1, 1],
      [2, "Herbizarre", 1, 2],
      [151, "Mew", 17, 7],
    ]);
    // carte visée imprimée sur la fiche (Bulbizarre : la SIR) ; Mew n'a aucune carte
    expect(miss.items[0]?.target).toMatchObject({ code: "MEW 198", tier: "SIR" });
    expect(miss.items[2]?.target).toBeNull();
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

describe("achat daté (import de commandes Cardmarket)", () => {
  it("la date de la commande devient la date de l'achat ; date invalide refusée", async () => {
    const post = (json: unknown) => call("/api/purchases", { method: "POST", json });
    expect((await post({ card_id: "sv03.5-167", price_paid: 8.24, date: "2026-10-29", received: true })).status).toBe(
      201,
    );
    const { purchases } = await (
      await call("/api/purchases")
    ).json<{
      purchases: { ordered_at: string; received_at: string | null; state: string }[];
    }>();
    expect(purchases[0]).toMatchObject({
      state: "recue",
      ordered_at: "2026-10-29T12:00:00.000Z",
      received_at: "2026-10-29T12:00:00.000Z",
    });
    expect((await species(2)).owned).toMatchObject({ card_id: "sv03.5-167", paid: 8.24 });
    expect((await post({ card_id: "sv03.5-166", date: "29.10.2026" })).status).toBe(400);
  });
});

describe("prix payé (« Ma carte »)", () => {
  type Row = { state: string; price_paid: number | null; ordered_at: string; espece: string };
  const purchases = async () => (await (await call("/api/purchases")).json<{ purchases: Row[] }>()).purchases;
  it("« Je l'ai » puis prix payé : un achat reçu est créé, puis mis à jour (pas de doublon)", async () => {
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } });
    expect((await species(1)).owned).toMatchObject({ paid: null, bought_at: null });
    const r = await call("/api/species/1/paid", { method: "PUT", json: { price_paid: 42.5, date: "2026-10-29" } });
    expect(r.status).toBe(200);
    expect(await purchases()).toEqual([
      expect.objectContaining({ state: "recue", price_paid: 42.5, ordered_at: "2026-10-29T12:00:00.000Z" }),
    ]);
    await call("/api/species/1/paid", { method: "PUT", json: { price_paid: 40 } });
    expect((await purchases()).map((p) => p.price_paid)).toEqual([40]);
    expect((await species(1)).owned).toMatchObject({ paid: 40, bought_at: "2026-10-29T12:00:00.000Z" });
  });
  it("une autre carte pour l'espèce : l'ancien prix ne lui est pas attribué", async () => {
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } });
    await call("/api/species/1/paid", { method: "PUT", json: { price_paid: 30 } });
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-198" } });
    expect((await species(1)).owned).toMatchObject({ paid: null });
  });
  it("refus : espèce non possédée, carte hors catalogue, date ou prix invalides", async () => {
    expect((await call("/api/species/2/paid", { method: "PUT", json: { price_paid: 5 } })).status).toBe(409);
    await call("/api/species/2/owned", { method: "PUT", json: { tier: "IR" } });
    expect((await call("/api/species/2/paid", { method: "PUT", json: { price_paid: 5 } })).status).toBe(409);
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } });
    const bad = (json: unknown) => call("/api/species/1/paid", { method: "PUT", json });
    expect((await bad({ price_paid: -1 })).status).toBe(400);
    expect((await bad({ price_paid: 5, date: "29/10/2026" })).status).toBe(400);
  });
});

describe("ma carte : note, état, gradation, doubles", () => {
  type Owned = { note: string | null; condition: string | null; grade: string | null; doubles: number };
  const owned = async () => (await species(1)).owned as unknown as Owned;
  it("enregistre les détails, les garde si la même carte est re-déclarée, les efface au changement de carte", async () => {
    expect((await call("/api/species/1/details", { method: "PUT", json: { note: "x" } })).status).toBe(409);
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } });
    const details = { note: "achetée à Lille", condition: "NM", grade: "PSA 9", doubles: 2 };
    expect((await call("/api/species/1/details", { method: "PUT", json: details })).status).toBe(200);
    expect(await owned()).toMatchObject(details);
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-166" } });
    expect(await owned()).toMatchObject(details);
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-198" } });
    expect(await owned()).toMatchObject({ note: "achetée à Lille", condition: null, grade: null, doubles: 2 });
    expect((await call("/api/species/1/details", { method: "PUT", json: { condition: "TOP" } })).status).toBe(400);
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
    expect([dump.version, dump.wish.length, dump.excluded.length, dump.purchases.length]).toEqual([3, 1, 1, 1]);
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

describe("versions ajoutées depuis le site", () => {
  /** TCGdex simulé (listes, détail, extension) ; le JWKS Access reste servi. */
  const serveTcgdex = (routes: Record<string, unknown>) =>
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === `${TEAM}.cloudflareaccess.com`) return Response.json(await jwks());
      const body = routes[url.pathname + url.search];
      return body === undefined ? new Response("not found", { status: 404 }) : Response.json(body);
    });
  const detail = (id: string, localId: string, name: string, dexId: number[]) => ({
    id,
    localId,
    name,
    dexId,
    image: `https://assets.tcgdex.net/fr/sv/sv08/${localId}`,
    set: { id: "sv08", name: "Étincelles Déferlantes" },
    pricing: { cardmarket: { idProduct: 790200, trend: 25, avg30: 27 } },
  });
  beforeEach(() => {
    serveTcgdex({
      "/v2/fr/cards?dexId=eq:1": [
        { id: "xy1-141", localId: "141", name: "Florizarre EX" }, // déjà au catalogue
        { id: "base1-44", localId: "44", name: "Bulbizarre", image: "https://assets.tcgdex.net/fr/base/base1/44" },
        { id: "A1-001", localId: "001", name: "Bulbizarre" }, // TCG Pocket
      ],
      "/v2/fr/cards?name=Bulbizarre": [
        { id: "sv08-200", localId: "200", name: "Bulbizarre", image: "https://assets.tcgdex.net/fr/sv/sv08/200" },
        { id: "zz-1", localId: "1", name: "Bulbizarrex" }, // contient le nom sans être Bulbizarre
      ],
      "/v2/fr/cards/sv08-200": detail("sv08-200", "200", "Bulbizarre", [1]),
      "/v2/fr/cards/sv08-201": detail("sv08-201", "201", "Bulbizarre", [1]),
      "/v2/fr/sets/sv08": { abbreviation: { official: "SSP" } },
    });
  });
  const add = (id: string, species_num = 1, tier = "IR") =>
    call("/api/cards", { method: "POST", json: { species_num, id, tier } });

  it("candidates : hors catalogue, sans TCG Pocket ni faux homonymes, récentes d'abord", async () => {
    const r = await (await call("/api/species/1/candidates")).json<{ candidates: { id: string; image: string }[] }>();
    expect(r.candidates.map((c) => c.id)).toEqual(["sv08-200", "base1-44"]);
    expect(r.candidates[0]?.image).toBe("https://assets.tcgdex.net/fr/sv/sv08/200/low.webp");
    expect((await call("/api/species/0/candidates")).status).toBe(400);
  });
  it("ajout : carte au catalogue (origine site), code Cardmarket et prix tout de suite", async () => {
    expect((await add("sv08-200")).status).toBe(201);
    const c = (await species(1)).cards.find((x) => x.id === "sv08-200");
    expect(c).toMatchObject({ origine: "site", tier: "IR", code_cm: "SSP 200" });
    expect(c?.cm_url).toContain("790200");
    expect(c?.price?.trend).toBe(25);
    expect((await add("sv08-200")).status).toBe(409); // déjà au catalogue
    expect((await add("sv08-201", 2)).status).toBe(400); // pas un Herbizarre
    expect((await add("inconnue-9")).status).toBe(400); // introuvable chez TCGdex
    expect((await add("sv08-201", 1, "XX")).status).toBe(400);
  });
  it("retrait : seulement une version ajoutée depuis le site, ni possédée ni commandée", async () => {
    await add("sv08-200");
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv08-200" } });
    expect((await call("/api/cards/sv08-200", { method: "DELETE" })).status).toBe(409);
    await call("/api/species/1/owned", { method: "DELETE" });
    expect((await call("/api/cards/sv08-200", { method: "DELETE" })).status).toBe(200);
    expect((await species(1)).cards.some((x) => x.id === "sv08-200")).toBe(false);
    expect((await call("/api/cards/xy1-141", { method: "DELETE" })).status).toBe(409); // carte du catalogue
    expect((await call("/api/cards/inconnue-1", { method: "DELETE" })).status).toBe(404);
  });
  it("alerte de prix : posée, modifiée, retirée ; suit la carte", async () => {
    expect((await call("/api/cards/sv03.5-166/alert", { method: "PUT", json: { max_price: 45 } })).status).toBe(200);
    await call("/api/cards/sv03.5-166/alert", { method: "PUT", json: { max_price: 35 } });
    expect((await species(1)).cards.find((x) => x.id === "sv03.5-166")?.alert).toBe(35);
    expect((await call("/api/cards/sv03.5-166/alert", { method: "PUT", json: { max_price: 0 } })).status).toBe(400);
    expect((await call("/api/cards/inconnue-1/alert", { method: "PUT", json: { max_price: 5 } })).status).toBe(400);
    await call("/api/cards/sv03.5-166/alert", { method: "DELETE" });
    expect((await species(1)).cards.find((x) => x.id === "sv03.5-166")?.alert).toBeNull();
    // une version retirée emporte son alerte
    await add("sv08-200");
    await call("/api/cards/sv08-200/alert", { method: "PUT", json: { max_price: 20 } });
    await call("/api/cards/sv08-200", { method: "DELETE" });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM alert").first<{ n: number }>())?.n).toBe(0);
  });
  it("sauvegarde v3 : versions ajoutées et alertes restaurées ; une sauvegarde v2 retire les ajouts", async () => {
    await add("sv08-200");
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv08-200" } });
    await call("/api/cards/sv08-200/alert", { method: "PUT", json: { max_price: 20 } });
    const dump = await (
      await call("/api/export")
    ).json<{ version: number; cards_site: unknown[]; alerts: unknown[] }>();
    expect([dump.version, dump.cards_site.length, dump.alerts.length]).toEqual([3, 1, 1]);
    await call("/api/species/1/owned", { method: "DELETE" });
    await call("/api/cards/sv08-200", { method: "DELETE" });
    expect((await call("/api/import", { method: "POST", json: dump })).status).toBe(200);
    const s = await species(1);
    expect(s.owned?.card_id).toBe("sv08-200");
    expect(s.cards.find((x) => x.id === "sv08-200")).toMatchObject({ origine: "site", alert: 20 });
    // sauvegarde v2 (sans versions ajoutées) : l'ajout non référencé est retiré
    const v2 = { version: 2, owned: [], keep: [], wish: [], excluded: [], purchases: [] };
    expect((await call("/api/import", { method: "POST", json: v2 })).status).toBe(200);
    expect((await species(1)).cards.some((x) => x.id === "sv08-200")).toBe(false);
    // version ajoutée invalide : rien n'est modifié
    const bad = { ...dump, cards_site: [{ ...(dump.cards_site[0] as object), image: "https://evil.example/x" }] };
    expect((await call("/api/import", { method: "POST", json: bad })).status).toBe(400);
  });
});

describe("illustrateur", () => {
  it("relevé chez TCGdex avec le prix, exposé dans le pokédex ; vide si TCGdex ne le donne pas", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === `${TEAM}.cloudflareaccess.com`) return Response.json(await jwks());
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      return Response.json({
        ...(id === "sv03.5-166" ? { illustrator: " Yoriyuki Ikegami " } : {}),
        pricing: { cardmarket: { trend: 40 } },
      });
    });
    await call("/api/species/1/prices");
    const cards = (await species(1)).cards as { id: string; illustrateur?: string | null }[];
    expect(cards.find((c) => c.id === "sv03.5-166")?.illustrateur).toBe("Yoriyuki Ikegami");
    expect(cards.find((c) => c.id === "xy1-141")?.illustrateur).toBe("");
    expect((await species(2)).cards[0]).toMatchObject({ illustrateur: null }); // pas encore relevé
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
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === FEED_URL) return Promise.resolve(Response.json(body));
      return Promise.reject(new Error(`réseau interdit en test : ${url}`));
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
  it("relève d'abord les illustrateurs, puis seulement les cartes utiles à rafraîchir", async () => {
    await call("/api/species/1/owned", { method: "PUT", json: { card_id: "sv03.5-198" } }); // complète : hors surveillance
    expect(await scheduledRefresh(env)).toBe(4); // premier passage : illustrateur de chaque carte
    const left = await env.DB.prepare("SELECT COUNT(*) AS n FROM cards WHERE illustrateur IS NULL").first<{
      n: number;
    }>();
    expect(left?.n).toBe(0);
    await env.DB.prepare("DELETE FROM price_cache").run();
    expect(await scheduledRefresh(env)).toBe(1); // ensuite : seule Herbizarre (manquante)
    const ids = (await env.DB.prepare("SELECT card_id FROM price_cache").all<{ card_id: string }>()).results.map(
      (r) => r.card_id,
    );
    expect(ids).toEqual(["sv03.5-167"]);
  });
  it("une carte au prix du guide du jour, avec image, n'est pas relevée chez TCGdex", async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare("UPDATE cards SET illustrateur = 'X', image = 'https://assets.tcgdex.net/fr/x/low.webp'"),
      env.DB.prepare(
        `INSERT INTO price_cache (card_id, trend, fetched_at, source) SELECT id, 9, ?, 'cardmarket' FROM cards`,
      ).bind(now),
    ]);
    expect(await scheduledRefresh(env)).toBe(0); // espèces manquantes, mais rien à relever
    const p = await env.DB.prepare("SELECT trend FROM price_cache WHERE card_id = 'sv03.5-167'").first<{
      trend: number;
    }>();
    expect(p?.trend).toBe(9);
    // guide de plus de 48 h : la carte redevient à relever
    await env.DB.prepare(
      "UPDATE price_cache SET fetched_at = '2020-01-01T00:00:00.000Z' WHERE card_id = 'sv03.5-167'",
    ).run();
    expect(await scheduledRefresh(env)).toBe(1);
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
