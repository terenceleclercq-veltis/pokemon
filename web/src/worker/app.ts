import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type * as z from "zod/mini";
import { devBypass, verifyAccessJwt } from "./auth";
import { candidates, cardFromTcgdex, nameMatches } from "./catalog";
import { audit, cardById, cardTier, cardsOf, loadAll } from "./db";
import {
  cheapestPerTier,
  higherThan,
  speciesStatus,
  targetCard,
  TIER_LABEL,
  TIERS,
  wantsLine,
  cardmarketLabel,
  cardmarketUrl,
  slotOf,
  type Card,
  type Price,
  type Purchase,
} from "./logic";
import { refreshPrices } from "./prices";
import {
  addCardBody,
  alertBody,
  cardParam,
  detailsBody,
  paidBody,
  excludeBody,
  importBody,
  keepBody,
  ownedBody,
  placeholdersQuery,
  purchaseBody,
  purchaseParam,
  purchasePatch,
  speciesParam,
  wantsQuery,
  wishBody,
} from "./schemas";

type AppEnv = { Bindings: Env; Variables: { user: string } };
type Ctx = Context<AppEnv>;

export const CSP = {
  defaultSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  // images.pokemontcg.io : images des cartes que TCGdex n'illustre pas (galeries, Coffre étincelant…)
  imgSrc: ["'self'", "https://assets.tcgdex.net", "https://raw.githubusercontent.com", "https://images.pokemontcg.io"],
  connectSrc: ["'self'"],
  manifestSrc: ["'self'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  requireTrustedTypesFor: ["'script'"],
  // une seule politique, « sw » : elle n'accepte que l'URL du service worker (client, main.ts)
  trustedTypes: ["sw"],
  upgradeInsecureRequests: [],
};

const fail = (status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500, message: string) =>
  new HTTPException(status, { message });

/** Valide avec Zod ; en cas d'échec, 400 avec les seuls chemins fautifs (pas d'écho des valeurs). */
function parse<S extends z.ZodMiniType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success)
    throw fail(
      400,
      "entrée invalide : " + [...new Set(r.error.issues.map((i) => i.path.join(".") || "corps"))].join(", "),
    );
  return r.data;
}
const jsonBody = async (c: Ctx) => {
  if (!c.req.header("Content-Type")?.startsWith("application/json")) throw fail(400, "JSON attendu");
  return c.req.json<unknown>().catch(() => {
    throw fail(400, "JSON invalide");
  });
};
const speciesNum = (c: Ctx) => parse(speciesParam, { num: c.req.param("num") }).num;

const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const url = new URL(c.req.url);
  const user = devBypass(c.env, url)
    ? "dev@localhost"
    : await verifyAccessJwt(c.req.header("Cf-Access-Jwt-Assertion") ?? null, {
        team: c.env.ACCESS_TEAM,
        aud: c.env.ACCESS_AUD,
        allowedEmail: c.env.ALLOWED_EMAIL,
        serviceTokenId: c.env.CI_SERVICE_TOKEN_ID,
      });
  if (!user) return c.text("Accès refusé", 401);
  // le service token CI ne peut que lire l'état de santé
  if (user.startsWith("service:") && !(c.req.method === "GET" && url.pathname === "/api/health"))
    return c.text("Accès refusé", 403);
  c.set("user", user);
  await next();
};

/** Anti-CSRF : écritures uniquement en same-origin, avec en-tête custom (impossible en cross-site sans CORS). */
const csrf: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    const site = c.req.header("Sec-Fetch-Site");
    if (c.req.header("X-Requested-With") !== "pokedex") throw fail(403, "requête refusée");
    if (origin && origin !== new URL(c.req.url).origin) throw fail(403, "origine refusée");
    if (site && site !== "same-origin" && site !== "none") throw fail(403, "origine refusée");
  }
  await next();
};

const rateLimit: MiddlewareHandler<AppEnv> = async (c, next) => {
  const { success } = await c.env.RATE_LIMITER.limit({ key: c.get("user") });
  if (!success) throw fail(429, "trop de requêtes, réessaie dans une minute");
  await next();
};

/** Prix payé et date d'achat de la carte possédée, s'ils ont été enregistrés pour cette carte. */
const paidOf = (o: { card_id: string | null }, b?: { card_id: string; price_paid: number | null; at: string }) =>
  b && b.card_id === o.card_id ? { paid: b.price_paid, bought_at: b.at } : { paid: null, bought_at: null };

async function pokedex(db: D1Database) {
  const all = await loadAll(db);
  const price: Record<string, Price> = Object.fromEntries(all.prices.map((p) => [p.card_id, p]));
  const bySpecies = new Map<number, Card[]>();
  for (const c of all.cards) bySpecies.set(c.species_num, [...(bySpecies.get(c.species_num) ?? []), c]);
  const owned = new Map(all.owned.map((o) => [o.species_num, o]));
  const keep = new Map(all.keep.map((k) => [k.species_num, k]));
  const wish = new Map(all.wish.map((w) => [w.species_num, w.card_id]));
  const excluded = new Set(all.excluded.map((e) => e.card_id));
  const orders = new Map<number, Purchase>(all.orders.map((o) => [o.species_num, o]));
  const alerts = new Map(all.alerts.map((a) => [a.card_id, a.max_price]));
  // dernier achat reçu par espèce (prix payé de « Ma carte »)
  const bought = new Map(all.bought.map((b) => [b.species_num, b]));
  return all.species.map((s) => {
    const cards = bySpecies.get(s.num) ?? [];
    // versions écartées : affichées, mais ignorées pour l'objectif, le statut et les achats
    const active = cards.filter((c) => !excluded.has(c.id));
    const o = owned.get(s.num);
    const best = cheapestPerTier(active, price);
    const status = speciesStatus(active, o, keep.get(s.num));
    return {
      num: s.num,
      nom_fr: s.nom_fr,
      nom_en: s.nom_en,
      status,
      /** Carte à acheter pour atteindre l'objectif (choix de Terence, sinon rareté la plus haute), null si terminée. */
      target: targetCard(active, status, price, wish.get(s.num))?.id ?? null,
      /** Version choisie par Terence (« viser cette version »), null sinon. */
      wish: wish.get(s.num) ?? null,
      /** Commande en cours pour cette espèce. */
      order: orders.get(s.num) ?? null,
      owned: o ? { ...o, ...paidOf(o, bought.get(s.num)) } : null,
      keep: keep.get(s.num) ?? null,
      higher: o ? higherThan(active, o).map((c) => c.id) : [],
      options: TIERS.flatMap((t) => (best[t] ? [{ tier: t, label: TIER_LABEL[t], card_id: best[t].id }] : [])),
      cards: cards.map((c) => ({
        ...c,
        excluded: excluded.has(c.id),
        /** Alerte : prix maximum souhaité, null sinon. */
        alert: alerts.get(c.id) ?? null,
        cm_label: cardmarketLabel(c),
        cm_url: c.id_product ? cardmarketUrl(c.id_product) : null,
        price: price[c.id] ?? null,
      })),
    };
  });
}

export const app = new Hono<AppEnv>();

// Service worker : ses propres requêtes (mise en cache des images de cartes) relèvent de sa CSP, qui autorise donc
// les deux hôtes d'images en connect-src. Posée après celle de secureHeaders (middleware extérieur).
app.use("/sw.js", async (c, next) => {
  await next();
  c.res.headers.set(
    "Content-Security-Policy",
    `default-src 'none'; connect-src 'self' ${CSP.imgSrc.slice(1).join(" ")}`,
  );
});
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: CSP,
    strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
    referrerPolicy: "no-referrer",
    xFrameOptions: "DENY",
    permissionsPolicy: { camera: [], microphone: [], geolocation: [], payment: [], usb: [] },
    crossOriginEmbedderPolicy: false,
  }),
);
app.use("*", authenticate);
app.use(
  "/api/*",
  rateLimit,
  csrf,
  bodyLimit({
    maxSize: 256 * 1024,
    onError: () => {
      throw fail(413, "corps trop gros");
    },
  }),
);
app.use("/api/*", async (c, next) => {
  await next();
  c.header("Cache-Control", "no-store");
});

app.get("/api/health", async (c) => {
  const db = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM species").first<{ n: number }>();
  const ok = (db?.n ?? 0) === 151;
  return c.json({ ok, species: db?.n ?? 0, environment: c.env.ENVIRONMENT }, ok ? 200 : 503);
});

app.get("/api/pokedex", async (c) =>
  c.json({ generated_at: new Date().toISOString(), species: await pokedex(c.env.DB) }),
);

app.get("/api/species/:num/prices", async (c) => {
  const num = speciesNum(c);
  const { results } = await cardsOf(c.env.DB, num);
  return c.json(await refreshPrices(c.env.DB, results));
});

/** Changement de carte : état et gradation ne valent plus (la nouvelle carte est une autre carte physique). */
const OWNED_CHANGE = `condition = CASE WHEN card_id IS ?2 THEN condition END, grade = CASE WHEN card_id IS ?2 THEN grade END`;

app.put("/api/species/:num/owned", async (c) => {
  const num = speciesNum(c);
  const body = parse(ownedBody, await jsonBody(c));
  let tier = "tier" in body ? body.tier : undefined;
  const cardId = "card_id" in body ? body.card_id : null;
  if (cardId) {
    const row = await cardTier(c.env.DB, cardId, num);
    if (!row) throw fail(400, "carte inconnue pour cette espèce");
    tier = row.tier;
  }
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO owned (species_num, card_id, tier, note, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(species_num) DO UPDATE SET ${OWNED_CHANGE}, card_id = ?2, tier = ?3,
         note = COALESCE(?4, note), updated_at = ?5`,
    ).bind(num, cardId, tier, body.note ?? null, new Date().toISOString()),
    // nouvelle carte possédée : l'ancienne décision « je préfère la mienne » ne vaut plus
    c.env.DB.prepare("DELETE FROM keep WHERE species_num = ?").bind(num),
    audit(c.env.DB, c.get("user"), "owned.set", `${num} ${cardId ?? tier}`),
  ]);
  return c.json({ ok: true });
});

/** Ma carte : note, état (grille Cardmarket), gradation, doubles pour l'échange. */
app.put("/api/species/:num/details", async (c) => {
  const num = speciesNum(c);
  const b = parse(detailsBody, await jsonBody(c));
  const r = await c.env.DB.prepare(
    "UPDATE owned SET note = ?2, condition = ?3, grade = ?4, doubles = ?5, updated_at = ?6 WHERE species_num = ?1",
  )
    .bind(num, b.note ?? null, b.condition ?? null, b.grade ?? null, b.doubles ?? 0, new Date().toISOString())
    .run();
  if (!r.meta.changes) throw fail(409, "espèce non possédée");
  await audit(c.env.DB, c.get("user"), "owned.details", num).run();
  return c.json({ ok: true });
});

/**
 * Prix payé pour la carte possédée (dépenses des statistiques) : met à jour son dernier achat reçu, ou enregistre
 * l'achat s'il n'a pas été fait par la liste d'achat (« Je l'ai »).
 */
app.put("/api/species/:num/paid", async (c) => {
  const num = speciesNum(c);
  const b = parse(paidBody, await jsonBody(c));
  const o = await c.env.DB.prepare("SELECT card_id FROM owned WHERE species_num = ?")
    .bind(num)
    .first<{ card_id: string | null }>();
  if (!o?.card_id) throw fail(409, "aucune carte du catalogue possédée pour cette espèce");
  const last = await c.env.DB.prepare(
    `SELECT id FROM purchase WHERE species_num = ?1 AND card_id = ?2 AND state = 'recue'
     ORDER BY COALESCE(received_at, ordered_at) DESC, id DESC LIMIT 1`,
  )
    .bind(num, o.card_id)
    .first<{ id: number }>();
  const at = b.date ? `${b.date}T12:00:00.000Z` : new Date().toISOString();
  await c.env.DB.batch([
    last
      ? c.env.DB.prepare(
          `UPDATE purchase SET price_paid = ?2, ordered_at = COALESCE(?3, ordered_at),
             received_at = COALESCE(?3, received_at) WHERE id = ?1`,
        ).bind(last.id, b.price_paid ?? null, b.date ? at : null)
      : c.env.DB.prepare(
          `INSERT INTO purchase (species_num, card_id, state, price_paid, ordered_at, received_at)
           VALUES (?1, ?2, 'recue', ?3, ?4, ?4)`,
        ).bind(num, o.card_id, b.price_paid ?? null, at),
    audit(c.env.DB, c.get("user"), "owned.paid", `${num} ${b.price_paid ?? "-"}`),
  ]);
  return c.json({ ok: true });
});

app.delete("/api/species/:num/owned", async (c) => {
  const num = speciesNum(c);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM keep WHERE species_num = ?").bind(num),
    c.env.DB.prepare("DELETE FROM owned WHERE species_num = ?").bind(num),
    audit(c.env.DB, c.get("user"), "owned.delete", num),
  ]);
  return c.json({ ok: true });
});

app.put("/api/species/:num/keep", async (c) => {
  const num = speciesNum(c);
  const body = parse(keepBody, await jsonBody(c));
  if (!(await c.env.DB.prepare("SELECT 1 FROM owned WHERE species_num = ?").bind(num).first()))
    throw fail(409, "espèce non possédée");
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO keep (species_num, note, decided_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(species_num) DO UPDATE SET note = ?2, decided_at = ?3`,
    ).bind(num, body.note ?? null, new Date().toISOString()),
    audit(c.env.DB, c.get("user"), "keep.set", num),
  ]);
  return c.json({ ok: true });
});

app.delete("/api/species/:num/keep", async (c) => {
  const num = speciesNum(c);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM keep WHERE species_num = ?").bind(num),
    audit(c.env.DB, c.get("user"), "keep.delete", num),
  ]);
  return c.json({ ok: true });
});

const cardIdOf = (c: Ctx) => parse(cardParam, { id: c.req.param("id") }).id;

/** Une carte du catalogue, sinon 400. */
async function knownCard(c: Ctx, id: string) {
  const card = await cardById(c.env.DB, id);
  if (!card) throw fail(400, "carte inconnue");
  return card;
}

/** Ta carte pour l'espèce (même effet que « Je l'ai »), dans le batch de l'appelant. */
const setOwned = (db: D1Database, num: number, cardId: string, tier: string, at: string) => [
  db
    .prepare(
      `INSERT INTO owned (species_num, card_id, tier, note, updated_at) VALUES (?1, ?2, ?3, NULL, ?4)
       ON CONFLICT(species_num) DO UPDATE SET ${OWNED_CHANGE}, card_id = ?2, tier = ?3, updated_at = ?4`,
    )
    .bind(num, cardId, tier, at),
  db.prepare("DELETE FROM keep WHERE species_num = ?").bind(num),
];

app.put("/api/species/:num/wish", async (c) => {
  const num = speciesNum(c);
  const { card_id } = parse(wishBody, await jsonBody(c));
  if (!(await cardTier(c.env.DB, card_id, num))) throw fail(400, "carte inconnue pour cette espèce");
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO wish (species_num, card_id, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(species_num) DO UPDATE SET card_id = ?2, updated_at = ?3`,
    ).bind(num, card_id, new Date().toISOString()),
    audit(c.env.DB, c.get("user"), "wish.set", `${num} ${card_id}`),
  ]);
  return c.json({ ok: true });
});

app.delete("/api/species/:num/wish", async (c) => {
  const num = speciesNum(c);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM wish WHERE species_num = ?").bind(num),
    audit(c.env.DB, c.get("user"), "wish.delete", num),
  ]);
  return c.json({ ok: true });
});

app.put("/api/cards/:id/excluded", async (c) => {
  const id = cardIdOf(c);
  const { reason } = parse(excludeBody, await jsonBody(c));
  await knownCard(c, id);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO excluded (card_id, reason, excluded_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(card_id) DO UPDATE SET reason = ?2, excluded_at = ?3`,
    ).bind(id, reason ?? null, new Date().toISOString()),
    // une version écartée ne peut plus être visée
    c.env.DB.prepare("DELETE FROM wish WHERE card_id = ?").bind(id),
    audit(c.env.DB, c.get("user"), "excluded.set", id),
  ]);
  return c.json({ ok: true });
});

app.delete("/api/cards/:id/excluded", async (c) => {
  const id = cardIdOf(c);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM excluded WHERE card_id = ?").bind(id),
    audit(c.env.DB, c.get("user"), "excluded.delete", id),
  ]);
  return c.json({ ok: true });
});

/** Cartes TCGdex de l'espèce absentes du catalogue, pour en ajouter une depuis la fiche. */
app.get("/api/species/:num/candidates", async (c) => {
  const num = speciesNum(c);
  const sp = await c.env.DB.prepare("SELECT nom_fr FROM species WHERE num = ?").bind(num).first<{ nom_fr: string }>();
  if (!sp) throw fail(404, "espèce inconnue");
  const { results } = await c.env.DB.prepare("SELECT id FROM cards").all<{ id: string }>();
  return c.json({ candidates: await candidates(sp.nom_fr, num, new Set(results.map((r) => r.id))) });
});

/** Ajoute une version au catalogue depuis TCGdex (origine « site », gardée par les mises à jour du catalogue). */
app.post("/api/cards", async (c) => {
  const b = parse(addCardBody, await jsonBody(c));
  if (await cardById(c.env.DB, b.id)) throw fail(409, "carte déjà au catalogue");
  const sp = await c.env.DB.prepare("SELECT nom_fr FROM species WHERE num = ?")
    .bind(b.species_num)
    .first<{ nom_fr: string }>();
  if (!sp) throw fail(404, "espèce inconnue");
  const card = await cardFromTcgdex(b.id);
  if (!card) throw fail(400, "carte introuvable chez TCGdex");
  if (!card.dex.includes(b.species_num) && !nameMatches(card.nom_fr, sp.nom_fr))
    throw fail(400, `cette carte n'est pas un ${sp.nom_fr}`);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm,
         nom_cm, langue, image, origine)
       VALUES (?1, ?2, ?3, ?4, ?5, 'SITE', ?6, 'certain', ?7, ?8, NULL, 'fr', ?9, 'site')`,
    ).bind(
      b.id,
      b.species_num,
      card.nom_fr,
      card.set_name,
      card.numero,
      b.tier,
      card.id_product,
      card.code_cm,
      card.image,
    ),
    audit(c.env.DB, c.get("user"), "card.add", `${b.species_num} ${b.id} ${b.tier}`),
  ]);
  // prix tout de suite (TCGdex), sans attendre la prochaine tâche planifiée
  await refreshPrices(c.env.DB, [{ id: b.id, langue: "fr" }]).catch(() => null);
  return c.json({ ok: true }, 201);
});

/** Retire une version ajoutée depuis le site (jamais une carte du catalogue, ni une carte possédée ou commandée). */
app.delete("/api/cards/:id", async (c) => {
  const id = cardIdOf(c);
  const row = await c.env.DB.prepare("SELECT origine FROM cards WHERE id = ?").bind(id).first<{ origine: string }>();
  if (!row) throw fail(404, "carte inconnue");
  if (row.origine !== "site") throw fail(409, "seules les versions ajoutées depuis le site peuvent être retirées");
  const used = await c.env.DB.prepare(
    "SELECT 1 FROM owned WHERE card_id = ?1 UNION SELECT 1 FROM purchase WHERE card_id = ?1",
  )
    .bind(id)
    .first();
  if (used) throw fail(409, "version possédée ou commandée");
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM price_history WHERE card_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM price_cache WHERE card_id = ?").bind(id),
    c.env.DB.prepare("DELETE FROM cards WHERE id = ?").bind(id),
    audit(c.env.DB, c.get("user"), "card.delete", id),
  ]);
  return c.json({ ok: true });
});

app.put("/api/cards/:id/alert", async (c) => {
  const id = cardIdOf(c);
  const { max_price } = parse(alertBody, await jsonBody(c));
  await knownCard(c, id);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO alert (card_id, max_price, created_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(card_id) DO UPDATE SET max_price = ?2`,
    ).bind(id, max_price, new Date().toISOString()),
    audit(c.env.DB, c.get("user"), "alert.set", `${id} ${max_price}`),
  ]);
  return c.json({ ok: true });
});

app.delete("/api/cards/:id/alert", async (c) => {
  const id = cardIdOf(c);
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM alert WHERE card_id = ?").bind(id),
    audit(c.env.DB, c.get("user"), "alert.delete", id),
  ]);
  return c.json({ ok: true });
});

/** Commandes : toutes (suivi des dépenses), les plus récentes d'abord. */
app.get("/api/purchases", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.*, c.nom_fr, c.set_name, c.numero, c.code_cm, c.tier, s.nom_fr AS espece
     FROM purchase p JOIN cards c ON c.id = p.card_id JOIN species s ON s.num = p.species_num
     ORDER BY p.ordered_at DESC LIMIT 500`,
  ).all();
  return c.json({ purchases: results });
});

app.post("/api/purchases", async (c) => {
  const body = parse(purchaseBody, await jsonBody(c));
  const card = await knownCard(c, body.card_id);
  const pending = await c.env.DB.prepare("SELECT id FROM purchase WHERE species_num = ? AND state = 'commandee'")
    .bind(card.species_num)
    .first();
  if (pending) throw fail(409, "commande déjà en cours pour cette espèce");
  const now = body.date ? `${body.date}T12:00:00.000Z` : new Date().toISOString();
  const received = body.received === true;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO purchase (species_num, card_id, state, price_paid, ordered_at, received_at, note)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      card.species_num,
      card.id,
      received ? "recue" : "commandee",
      body.price_paid ?? null,
      now,
      received ? now : null,
      body.note ?? null,
    ),
    ...(received ? setOwned(c.env.DB, card.species_num, card.id, card.tier, now) : []),
    audit(c.env.DB, c.get("user"), received ? "purchase.received" : "purchase.ordered", card.id),
  ]);
  return c.json({ ok: true }, 201);
});

app.patch("/api/purchases/:id", async (c) => {
  const { id } = parse(purchaseParam, { id: c.req.param("id") });
  const body = parse(purchasePatch, await jsonBody(c));
  const p = await c.env.DB.prepare("SELECT * FROM purchase WHERE id = ?").bind(id).first<Purchase>();
  if (!p) throw fail(404, "commande introuvable");
  if (p.state !== "commandee") throw fail(409, "commande déjà clôturée");
  const now = new Date().toISOString();
  const card = await knownCard(c, p.card_id);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE purchase SET state = ?2, price_paid = COALESCE(?3, price_paid), received_at = ?4 WHERE id = ?1",
    ).bind(id, body.state, body.price_paid ?? null, body.state === "recue" ? now : null),
    ...(body.state === "recue" ? setOwned(c.env.DB, p.species_num, p.card_id, card.tier, now) : []),
    audit(c.env.DB, c.get("user"), `purchase.${body.state}`, p.card_id),
  ]);
  return c.json({ ok: true });
});

type Species = Awaited<ReturnType<typeof pokedex>>[number];
type WantTier = (typeof TIERS)[number] | "cheapest" | "sir_ir" | "objectif";
const byTrend = (a: { price: Price | null }, b: { price: Price | null }) =>
  (a.price?.trend ?? Infinity) - (b.price?.trend ?? Infinity);

/** Espèces concernées : manquantes, plus celles à améliorer quand on suit l'objectif. */
const toBuy = (s: Species, tier: WantTier) =>
  !s.order && (s.status === "manquante" || (tier === "objectif" && s.status === "a_verifier"));

/** Carte(s) visée(s) : l'objectif (rareté la plus haute), la moins chère, une rareté, ou « SIR, sinon IR ». */
function wanted(s: Species, tier: WantTier): Species["cards"] {
  if (tier === "objectif") return s.cards.filter((x) => x.id === s.target);
  const opts = s.cards.filter((x) => !x.excluded && s.options.some((o) => o.card_id === x.id));
  if (tier === "cheapest") return opts.sort(byTrend).slice(0, 1);
  if (tier === "sir_ir") {
    const sir = opts.filter((x) => x.tier === "SIR");
    return (sir.length ? sir : opts.filter((x) => x.tier === "IR")).slice(0, 1);
  }
  return opts.filter((x) => x.tier === tier);
}

app.get("/api/wants", async (c) => {
  const { tier } = parse(wantsQuery, c.req.query());
  const lines = (await pokedex(c.env.DB)).filter((s) => toBuy(s, tier)).flatMap((s) => wanted(s, tier).map(wantsLine));
  return c.text(lines.join("\n"));
});

/** Placeholders de binder : une fiche par espèce (manquantes ou toutes). */
app.get("/api/placeholders", async (c) => {
  const { scope } = parse(placeholdersQuery, c.req.query());
  const items = (await pokedex(c.env.DB))
    .filter((s) => scope === "all" || s.status === "manquante")
    .map((s) => {
      const t = s.cards.find((x) => x.id === s.target);
      return {
        num: s.num,
        nom_fr: s.nom_fr,
        slot: slotOf(s.num),
        /** Carte visée (code, prix, lien) pour l'imprimer sur la fiche ; null si rien à acheter. */
        target: t
          ? { label: t.cm_label, code: t.code_cm, tier: t.tier, trend: t.price?.trend ?? null, url: t.cm_url }
          : null,
      };
    });
  return c.json({ items });
});

app.get("/api/species/:num/history", async (c) => {
  const num = speciesNum(c);
  const { results } = await c.env.DB.prepare(
    `SELECT h.card_id, h.day, h.trend FROM price_history h JOIN cards c ON c.id = h.card_id
     WHERE c.species_num = ? AND h.trend IS NOT NULL AND h.day >= date('now', '-180 days')
     ORDER BY h.day`,
  )
    .bind(num)
    .all<{ card_id: string; day: string; trend: number }>();
  const out: Record<string, [string, number][]> = {};
  for (const r of results) (out[r.card_id] ??= []).push([r.day, r.trend]);
  return c.json(out);
});

app.get("/api/export", async (c) => {
  const [owned, keep, wish, excluded, purchases, site, alerts] = await c.env.DB.batch([
    c.env.DB.prepare(
      "SELECT species_num, card_id, tier, note, condition, grade, doubles FROM owned ORDER BY species_num",
    ),
    c.env.DB.prepare("SELECT species_num, note FROM keep ORDER BY species_num"),
    c.env.DB.prepare("SELECT species_num, card_id FROM wish ORDER BY species_num"),
    c.env.DB.prepare("SELECT card_id, reason FROM excluded ORDER BY card_id"),
    c.env.DB.prepare(
      "SELECT card_id, state, price_paid, ordered_at, received_at, note FROM purchase ORDER BY ordered_at, id",
    ),
    c.env.DB.prepare(
      `SELECT id, species_num, nom_fr, set_name, numero, tier, id_product, code_cm, image FROM cards
       WHERE origine = 'site' ORDER BY species_num, id`,
    ),
    c.env.DB.prepare("SELECT card_id, max_price FROM alert ORDER BY card_id"),
  ]);
  c.header("Content-Disposition", 'attachment; filename="pokedex-export.json"');
  return c.json({
    version: 3,
    exported_at: new Date().toISOString(),
    owned: owned?.results ?? [],
    keep: keep?.results ?? [],
    wish: wish?.results ?? [],
    excluded: excluded?.results ?? [],
    purchases: purchases?.results ?? [],
    cards_site: site?.results ?? [],
    alerts: alerts?.results ?? [],
  });
});

app.post("/api/import", async (c) => {
  const raw = (await jsonBody(c)) as Record<string, unknown>;
  delete raw.exported_at;
  const b = parse(importBody, raw);
  const ownedNums = new Set(b.owned.map((o) => o.species_num));
  if (ownedNums.size !== b.owned.length) throw fail(400, "espèce en double");
  if (b.keep.some((k) => !ownedNums.has(k.species_num))) throw fail(400, "« keep » sur une espèce non possédée");
  const db = c.env.DB;
  // versions ajoutées depuis le site : celles de la sauvegarde comptent comme connues (une carte déjà au catalogue
  // garde la version du catalogue)
  const site = new Map((b.cards_site ?? []).map((k) => [k.id, k]));
  const cardOf = async (id: string) => (await cardById(db, id)) ?? site.get(id) ?? null;
  for (const o of b.owned) {
    if (o.card_id) {
      const card = await cardOf(o.card_id);
      if (card?.species_num !== o.species_num || card.tier !== o.tier) throw fail(400, `carte ${o.card_id} invalide`);
    }
  }
  for (const w of b.wish ?? [])
    if ((await cardOf(w.card_id))?.species_num !== w.species_num) throw fail(400, `carte ${w.card_id} invalide`);
  const speciesOf = new Map<string, number>();
  for (const id of new Set(
    [...(b.excluded ?? []), ...(b.purchases ?? []), ...(b.alerts ?? [])].map((x) => x.card_id),
  )) {
    const card = await cardOf(id);
    if (!card) throw fail(400, `carte ${id} invalide`);
    speciesOf.set(id, card.species_num);
  }
  // versions ajoutées depuis le site absentes de la sauvegarde et non référencées par elle : retirées
  const keepIds = JSON.stringify([
    ...site.keys(),
    ...b.owned.flatMap((o) => (o.card_id ? [o.card_id] : [])),
    ...(b.wish ?? []).map((w) => w.card_id),
    ...speciesOf.keys(),
  ]);
  const gone = "SELECT id FROM cards WHERE origine = 'site' AND id NOT IN (SELECT value FROM json_each(?1))";
  const now = new Date().toISOString();
  // import = remplacement complet, atomique (une sauvegarde v1 laisse vides versions visées, écartées et commandes)
  await db.batch([
    ...["keep", "wish", "excluded", "purchase", "owned", "alert"].map((t) => db.prepare(`DELETE FROM ${t}`)),
    db.prepare(`DELETE FROM price_history WHERE card_id IN (${gone})`).bind(keepIds),
    db.prepare(`DELETE FROM price_cache WHERE card_id IN (${gone})`).bind(keepIds),
    db.prepare(`DELETE FROM cards WHERE id IN (${gone})`).bind(keepIds),
    ...[...site.values()].map((k) =>
      db
        .prepare(
          `INSERT INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product,
             code_cm, nom_cm, langue, image, origine)
           VALUES (?1, ?2, ?3, ?4, ?5, 'SITE', ?6, 'certain', ?7, ?8, NULL, 'fr', ?9, 'site')
           ON CONFLICT(id) DO NOTHING`,
        )
        .bind(k.id, k.species_num, k.nom_fr, k.set_name, k.numero, k.tier, k.id_product, k.code_cm, k.image),
    ),
    ...b.owned.map((o) =>
      db
        .prepare(
          `INSERT INTO owned (species_num, card_id, tier, note, condition, grade, doubles, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          o.species_num,
          o.card_id,
          o.tier,
          o.note ?? null,
          o.condition ?? null,
          o.grade ?? null,
          o.doubles ?? 0,
          now,
        ),
    ),
    ...b.keep.map((k) =>
      db
        .prepare("INSERT INTO keep (species_num, note, decided_at) VALUES (?, ?, ?)")
        .bind(k.species_num, k.note ?? null, now),
    ),
    ...(b.wish ?? []).map((w) =>
      db
        .prepare("INSERT INTO wish (species_num, card_id, updated_at) VALUES (?, ?, ?)")
        .bind(w.species_num, w.card_id, now),
    ),
    ...(b.excluded ?? []).map((e) =>
      db
        .prepare("INSERT INTO excluded (card_id, reason, excluded_at) VALUES (?, ?, ?)")
        .bind(e.card_id, e.reason ?? null, now),
    ),
    ...(b.purchases ?? []).map((p) =>
      db
        .prepare(
          `INSERT INTO purchase (species_num, card_id, state, price_paid, ordered_at, received_at, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          speciesOf.get(p.card_id),
          p.card_id,
          p.state,
          p.price_paid ?? null,
          p.ordered_at,
          p.received_at,
          p.note ?? null,
        ),
    ),
    ...(b.alerts ?? []).map((a) =>
      db
        .prepare(
          `INSERT INTO alert (card_id, max_price, created_at) VALUES (?1, ?2, ?3)
           ON CONFLICT(card_id) DO UPDATE SET max_price = ?2`,
        )
        .bind(a.card_id, a.max_price, now),
    ),
    audit(db, c.get("user"), "import", `${b.owned.length} possédées, ${b.keep.length} conservées`),
  ]);
  return c.json({ ok: true, owned: b.owned.length, keep: b.keep.length });
});

app.all("/api/*", () => {
  throw fail(404, "introuvable");
});

app.get("*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const out = new Response(res.body, res);
  // derrière Access : jamais en cache partagé ; revalidation par ETag
  out.headers.set("Cache-Control", "private, no-cache");
  return out;
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(JSON.stringify({ msg: "erreur interne", path: c.req.path, err: String(err) }));
  return c.json({ error: "erreur interne" }, 500);
});
