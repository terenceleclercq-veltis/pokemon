import { Hono, type Context, type MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";
import type * as z from "zod/mini";
import { devBypass, verifyAccessJwt } from "./auth";
import { cardmarketGet } from "./cardmarket";
import { decryptJson, encryptJson } from "./crypto";
import { audit, cardTier, cardsOf, loadAll } from "./db";
import {
  cheapestPerTier,
  higherThan,
  speciesStatus,
  TIER_LABEL,
  TIERS,
  wantsLine,
  cardmarketLabel,
  cardmarketUrl,
  type Card,
  type Price,
} from "./logic";
import { refreshPrices } from "./prices";
import {
  cardmarketBody,
  importBody,
  keepBody,
  ownedBody,
  speciesParam,
  wantsQuery,
  buylistQuery,
  placeholdersQuery,
  type CardmarketCreds,
} from "./schemas";

type AppEnv = { Bindings: Env; Variables: { user: string } };
type Ctx = Context<AppEnv>;
const CM_KEY = "cardmarket";

export const CSP = {
  defaultSrc: ["'none'"],
  scriptSrc: ["'self'"],
  styleSrc: ["'self'"],
  imgSrc: ["'self'", "https://assets.tcgdex.net"],
  connectSrc: ["'self'"],
  manifestSrc: ["'self'"],
  baseUri: ["'none'"],
  formAction: ["'self'"],
  frameAncestors: ["'none'"],
  requireTrustedTypesFor: ["'script'"],
  trustedTypes: ["'none'"],
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

async function pokedex(db: D1Database) {
  const all = await loadAll(db);
  const price: Record<string, Price> = Object.fromEntries(all.prices.map((p) => [p.card_id, p]));
  const bySpecies = new Map<number, Card[]>();
  for (const c of all.cards) bySpecies.set(c.species_num, [...(bySpecies.get(c.species_num) ?? []), c]);
  const owned = new Map(all.owned.map((o) => [o.species_num, o]));
  const keep = new Map(all.keep.map((k) => [k.species_num, k]));
  return all.species.map((s) => {
    const cards = bySpecies.get(s.num) ?? [];
    const o = owned.get(s.num);
    const best = cheapestPerTier(cards, price);
    return {
      num: s.num,
      nom_fr: s.nom_fr,
      status: speciesStatus(cards, o, keep.get(s.num)),
      owned: o ?? null,
      keep: keep.get(s.num) ?? null,
      higher: o ? higherThan(cards, o).map((c) => c.id) : [],
      options: TIERS.flatMap((t) => (best[t] ? [{ tier: t, label: TIER_LABEL[t], card_id: best[t].id }] : [])),
      cards: cards.map((c) => ({
        ...c,
        cm_label: cardmarketLabel(c),
        cm_url: c.id_product ? cardmarketUrl(c.id_product) : null,
        price: price[c.id] ?? null,
      })),
    };
  });
}

export const app = new Hono<AppEnv>();

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
  return c.json(
    await refreshPrices(
      c.env.DB,
      results.map((r) => r.id),
    ),
  );
});

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
       ON CONFLICT(species_num) DO UPDATE SET card_id = ?2, tier = ?3, note = ?4, updated_at = ?5`,
    ).bind(num, cardId, tier, body.note ?? null, new Date().toISOString()),
    // nouvelle carte possédée : l'ancienne décision « je préfère la mienne » ne vaut plus
    c.env.DB.prepare("DELETE FROM keep WHERE species_num = ?").bind(num),
    audit(c.env.DB, c.get("user"), "owned.set", `${num} ${cardId ?? tier}`),
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

type Species = Awaited<ReturnType<typeof pokedex>>[number];
type WantTier = (typeof TIERS)[number] | "cheapest" | "sir_ir" | "rarest";
const byTrend = (a: { price: Price | null }, b: { price: Price | null }) =>
  (a.price?.trend ?? Infinity) - (b.price?.trend ?? Infinity);

/** Carte(s) visée(s) : la moins chère, une rareté, « SIR, sinon IR », ou la plus rare (SIR > IR > FA). */
function wanted(s: Species, tier: WantTier): Species["cards"] {
  const opts = s.cards.filter((x) => s.options.some((o) => o.card_id === x.id));
  if (tier === "cheapest") return opts.sort(byTrend).slice(0, 1);
  if (tier === "rarest") {
    for (const t of ["SIR", "IR", "FA"] as const) {
      const pick = opts.filter((x) => x.tier === t);
      if (pick.length) return pick.slice(0, 1);
    }
    return [];
  }
  if (tier === "sir_ir") {
    const sir = opts.filter((x) => x.tier === "SIR");
    return (sir.length ? sir : opts.filter((x) => x.tier === "IR")).slice(0, 1);
  }
  return opts.filter((x) => x.tier === tier);
}

app.get("/api/wants", async (c) => {
  const { tier } = parse(wantsQuery, c.req.query());
  const lines = (await pokedex(c.env.DB))
    .filter((s) => s.status === "manquante")
    .flatMap((s) => wanted(s, tier).map(wantsLine));
  return c.text(lines.join("\n"));
});

/** Liste d'achat : liens vers la version exacte sur Cardmarket, du moins cher au plus cher, dans le budget. */
app.get("/api/buylist", async (c) => {
  const { tier, budget } = parse(buylistQuery, c.req.query());
  const all = (await pokedex(c.env.DB))
    .filter((s) => s.status === "manquante")
    .flatMap((s) => wanted(s, tier).map((x) => ({ ...x, espece: s.nom_fr })))
    .sort(byTrend);
  let total = 0;
  const items = [];
  for (const x of all) {
    const p = x.price?.trend;
    if (budget !== undefined && (p == null || total + p > budget)) continue;
    total += p ?? 0;
    items.push({ num: x.species_num, espece: x.espece, label: x.cm_label, url: x.cm_url, trend: p ?? null });
  }
  return c.json({ items, total: Math.round(total * 100) / 100, budget: budget ?? null });
});

/** Placeholders de binder : une fiche par espèce (manquantes ou toutes) avec la carte visée. */
app.get("/api/placeholders", async (c) => {
  const { tier, scope } = parse(placeholdersQuery, c.req.query());
  const items = (await pokedex(c.env.DB))
    .filter((s) => scope === "all" || s.status === "manquante")
    .map((s) => {
      const x = wanted(s, tier)[0];
      return {
        num: s.num,
        nom_fr: s.nom_fr,
        card: x
          ? {
              nom_fr: x.nom_fr,
              code: x.code_cm,
              set_name: x.set_name,
              tier: x.tier,
              image: x.image,
              trend: x.price?.trend ?? null,
            }
          : null,
      };
    });
  return c.json({ items });
});

app.get("/api/export", async (c) => {
  const [owned, keep] = await c.env.DB.batch([
    c.env.DB.prepare("SELECT species_num, card_id, tier, note FROM owned ORDER BY species_num"),
    c.env.DB.prepare("SELECT species_num, note FROM keep ORDER BY species_num"),
  ]);
  c.header("Content-Disposition", 'attachment; filename="pokedex-export.json"');
  return c.json({
    version: 1,
    exported_at: new Date().toISOString(),
    owned: owned?.results ?? [],
    keep: keep?.results ?? [],
  });
});

app.post("/api/import", async (c) => {
  const raw = (await jsonBody(c)) as Record<string, unknown>;
  delete raw.exported_at;
  const b = parse(importBody, raw);
  const ownedNums = new Set(b.owned.map((o) => o.species_num));
  if (ownedNums.size !== b.owned.length) throw fail(400, "espèce en double");
  if (b.keep.some((k) => !ownedNums.has(k.species_num))) throw fail(400, "« keep » sur une espèce non possédée");
  for (const o of b.owned) {
    if (o.card_id) {
      const row = await cardTier(c.env.DB, o.card_id, o.species_num);
      if (!row || row.tier !== o.tier) throw fail(400, `carte ${o.card_id} invalide`);
    }
  }
  const now = new Date().toISOString();
  // import = remplacement complet, atomique
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM keep"),
    c.env.DB.prepare("DELETE FROM owned"),
    ...b.owned.map((o) =>
      c.env.DB.prepare("INSERT INTO owned (species_num, card_id, tier, note, updated_at) VALUES (?, ?, ?, ?, ?)").bind(
        o.species_num,
        o.card_id,
        o.tier,
        o.note ?? null,
        now,
      ),
    ),
    ...b.keep.map((k) =>
      c.env.DB.prepare("INSERT INTO keep (species_num, note, decided_at) VALUES (?, ?, ?)").bind(
        k.species_num,
        k.note ?? null,
        now,
      ),
    ),
    audit(c.env.DB, c.get("user"), "import", `${b.owned.length} possédées, ${b.keep.length} conservées`),
  ]);
  return c.json({ ok: true, owned: b.owned.length, keep: b.keep.length });
});

app.get("/api/cardmarket", async (c) => {
  const r = await c.env.DB.prepare("SELECT updated_at FROM settings WHERE key = ?")
    .bind(CM_KEY)
    .first<{ updated_at: string }>();
  return c.json({ linked: !!r, updated_at: r?.updated_at ?? null }); // jamais les valeurs
});

app.put("/api/cardmarket", async (c) => {
  const creds = parse(cardmarketBody, await jsonBody(c));
  if (!c.env.ENC_KEY) throw fail(500, "chiffrement non configuré");
  const blob = await encryptJson(c.env.ENC_KEY, creds, `settings:${CM_KEY}`);
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3`,
    ).bind(CM_KEY, blob, new Date().toISOString()),
    audit(c.env.DB, c.get("user"), "cardmarket.link"),
  ]);
  return c.json({ ok: true });
});

app.delete("/api/cardmarket", async (c) => {
  await c.env.DB.batch([
    c.env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(CM_KEY),
    audit(c.env.DB, c.get("user"), "cardmarket.unlink"),
  ]);
  return c.json({ ok: true });
});

app.post("/api/cardmarket/test", async (c) => {
  const r = await c.env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(CM_KEY).first<{ value: string }>();
  if (!r) throw fail(404, "compte non lié");
  const creds = await decryptJson<CardmarketCreds>(c.env.ENC_KEY, r.value, `settings:${CM_KEY}`);
  const res = await cardmarketGet(creds, "/ws/v2.0/output.json/account");
  const username = (res.body as { account?: { username?: unknown } } | null)?.account?.username;
  return c.json({ status: res.status, username: typeof username === "string" ? username : null });
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
