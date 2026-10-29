import { authenticate } from "./auth.js";
import { cardmarketGet } from "./cardmarket.js";
import { cheapestPerTier, isInt, speciesStatus, TIER_LABEL, wantsLine } from "./logic.js";
import { fetchPrice, refreshPrices } from "./prices.js";
import { decrypt, encrypt } from "./secrets.js";

const SEC_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https://assets.tcgdex.net data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=()", "Cross-Origin-Opener-Policy": "same-origin",
};
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const bad = (msg, status = 400) => json({ error: msg }, status);
const withSec = (r) => { const h = new Headers(r.headers); for (const [k, v] of Object.entries(SEC_HEADERS)) h.set(k, v); return new Response(r.body, { status: r.status, headers: h }); };
const audit = (env, actor, action, detail) => env.DB.prepare("INSERT INTO audit_log (at,actor,action,detail) VALUES (?,?,?,?)").bind(new Date().toISOString(), actor, action, detail ? String(detail).slice(0, 500) : null).run();
const body = async (req) => { if (+(req.headers.get("content-length") || 0) > 1_000_000) throw new Error("trop gros"); return req.json(); };

async function pokedex(env) {
  const [sp, cards, owned, keep, prices] = await Promise.all(["species ORDER BY num", "cards", "owned", "keep", "price_cache"].map((t) => env.DB.prepare(`SELECT * FROM ${t}`).all().then((r) => r.results)));
  const pmap = Object.fromEntries(prices.map((p) => [p.card_id, p]));
  const ownedBy = Object.fromEntries(owned.map((o) => [o.species_num, o])), keepBy = Object.fromEntries(keep.map((k) => [k.species_num, k]));
  return sp.map((s) => {
    const cs = cards.filter((c) => c.species_num === s.num);
    const o = ownedBy[s.num] ?? null;
    const { status, higher } = speciesStatus({ cards: cs, owned: o, keep: keepBy[s.num] });
    const best = cheapestPerTier(cs, pmap);
    return { num: s.num, nom_fr: s.nom_fr, status, owned: o, keep: keepBy[s.num] ?? null, higher: higher.map((c) => c.id),
      options: Object.entries(best).map(([tier, c]) => ({ tier, label: TIER_LABEL[tier], card: c, price: pmap[c.id] ?? null })),
      cards: cs.map((c) => ({ ...c, price: pmap[c.id] ?? null })), no_card: cs.length === 0 };
  });
}

async function route(req, env, ctx, user) {
  const url = new URL(req.url), p = url.pathname, m = req.method;
  if (m !== "GET" && m !== "HEAD") { // anti-CSRF : en-tête custom + Origin identique
    const origin = req.headers.get("Origin");
    if (req.headers.get("X-Requested-With") !== "pokedex" || (origin && origin !== url.origin)) return bad("requête refusée", 403);
  }
  if (p === "/api/pokedex" && m === "GET") return json(await pokedex(env));

  let mt;
  if ((mt = p.match(/^\/api\/species\/(\d{1,3})\/prices$/)) && m === "GET") { // prix en direct
    const n = +mt[1]; if (!isInt(n, 1, 151)) return bad("espèce invalide");
    const cs = (await env.DB.prepare("SELECT id FROM cards WHERE species_num=?").bind(n).all()).results;
    return json(await refreshPrices(env, cs.map((c) => c.id)));
  }
  if ((mt = p.match(/^\/api\/species\/(\d{1,3})\/owned$/))) {
    const n = +mt[1]; if (!isInt(n, 1, 151)) return bad("espèce invalide");
    if (m === "DELETE") { await env.DB.batch([env.DB.prepare("DELETE FROM owned WHERE species_num=?").bind(n), env.DB.prepare("DELETE FROM keep WHERE species_num=?").bind(n)]); await audit(env, user, "owned.delete", n); return json({ ok: true }); }
    if (m === "PUT") {
      const b = await body(req); let tier = b.tier, cardId = b.card_id ?? null;
      if (cardId) { const c = await env.DB.prepare("SELECT tier FROM cards WHERE id=? AND species_num=?").bind(cardId, n).first(); if (!c) return bad("carte inconnue pour cette espèce"); tier = c.tier; }
      if (!["FA", "IR", "SIR"].includes(tier)) return bad("tier invalide");
      const note = typeof b.note === "string" ? b.note.slice(0, 300) : null;
      await env.DB.prepare("INSERT INTO owned (species_num,card_id,tier,note,updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(species_num) DO UPDATE SET card_id=?2,tier=?3,note=?4,updated_at=?5").bind(n, cardId, tier, note, new Date().toISOString()).run();
      await env.DB.prepare("DELETE FROM keep WHERE species_num=?").bind(n).run(); // nouvelle carte : décision à reprendre
      await audit(env, user, "owned.set", `${n} ${cardId ?? tier}`); return json({ ok: true });
    }
  }
  if ((mt = p.match(/^\/api\/species\/(\d{1,3})\/keep$/)) && ["PUT", "DELETE"].includes(m)) {
    const n = +mt[1]; if (!isInt(n, 1, 151)) return bad("espèce invalide");
    if (m === "DELETE") await env.DB.prepare("DELETE FROM keep WHERE species_num=?").bind(n).run();
    else {
      if (!(await env.DB.prepare("SELECT 1 FROM owned WHERE species_num=?").bind(n).first())) return bad("espèce non possédée");
      const b = await body(req).catch(() => ({}));
      await env.DB.prepare("INSERT INTO keep (species_num,note,decided_at) VALUES (?1,?2,?3) ON CONFLICT(species_num) DO UPDATE SET note=?2,decided_at=?3").bind(n, typeof b.note === "string" ? b.note.slice(0, 300) : null, new Date().toISOString()).run();
    }
    await audit(env, user, `keep.${m}`, n); return json({ ok: true });
  }
  if (p === "/api/wants" && m === "GET") { // liste d'envies à coller dans Cardmarket (espèces manquantes)
    const tier = url.searchParams.get("tier"); if (!["FA", "IR", "SIR", "cheapest"].includes(tier)) return bad("tier invalide");
    const lines = (await pokedex(env)).filter((s) => s.status === "manquante").flatMap((s) => {
      const opts = tier === "cheapest" ? s.options.sort((a, b) => (a.price?.trend ?? 1e9) - (b.price?.trend ?? 1e9)).slice(0, 1) : s.options.filter((o) => o.tier === tier);
      return opts.map((o) => wantsLine(o.card));
    });
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
  if (p === "/api/export" && m === "GET") {
    const t = async (n) => (await env.DB.prepare(`SELECT * FROM ${n}`).all()).results;
    return json({ version: 1, owned: await t("owned"), keep: await t("keep") });
  }
  if (p === "/api/import" && m === "POST") {
    const b = await body(req); if (b?.version !== 1 || !Array.isArray(b.owned) || !Array.isArray(b.keep) || b.owned.length > 151) return bad("fichier invalide");
    const st = [];
    for (const o of b.owned) { if (!isInt(o.species_num, 1, 151) || !["FA", "IR", "SIR"].includes(o.tier)) return bad("ligne invalide"); st.push(env.DB.prepare("INSERT OR REPLACE INTO owned (species_num,card_id,tier,note,updated_at) VALUES (?,?,?,?,?)").bind(o.species_num, o.card_id ?? null, o.tier, o.note ? String(o.note).slice(0, 300) : null, new Date().toISOString())); }
    for (const k of b.keep) { if (!isInt(k.species_num, 1, 151)) return bad("ligne invalide"); st.push(env.DB.prepare("INSERT OR REPLACE INTO keep (species_num,note,decided_at) VALUES (?,?,?)").bind(k.species_num, k.note ? String(k.note).slice(0, 300) : null, new Date().toISOString())); }
    if (st.length) await env.DB.batch(st); await audit(env, user, "import", st.length); return json({ ok: true, lignes: st.length });
  }
  if (p === "/api/cardmarket" && m === "GET") { // jamais de valeur : uniquement l'état de la liaison
    const r = await env.DB.prepare("SELECT updated_at FROM settings WHERE key='cardmarket'").first();
    return json({ linked: !!r, updated_at: r?.updated_at ?? null });
  }
  if (p === "/api/cardmarket" && m === "PUT") {
    if (!env.ENC_KEY) return bad("ENC_KEY non configurée", 500);
    const b = await body(req); const f = ["appToken", "appSecret", "accessToken", "accessSecret"];
    if (!f.every((k) => typeof b[k] === "string" && b[k].length > 5 && b[k].length < 200)) return bad("identifiants incomplets");
    await env.DB.prepare("INSERT INTO settings (key,value,updated_at) VALUES ('cardmarket',?1,?2) ON CONFLICT(key) DO UPDATE SET value=?1,updated_at=?2").bind(await encrypt(env, Object.fromEntries(f.map((k) => [k, b[k]]))), new Date().toISOString()).run();
    await audit(env, user, "cardmarket.link"); return json({ ok: true });
  }
  if (p === "/api/cardmarket" && m === "DELETE") { await env.DB.prepare("DELETE FROM settings WHERE key='cardmarket'").run(); await audit(env, user, "cardmarket.unlink"); return json({ ok: true }); }
  if (p === "/api/cardmarket/test" && m === "POST") {
    const r = await env.DB.prepare("SELECT value FROM settings WHERE key='cardmarket'").first(); if (!r) return bad("non lié", 404);
    const res = await cardmarketGet(await decrypt(env, r.value), "https://api.cardmarket.com/ws/v2.0/output.json/account");
    return json({ status: res.status, username: res.body?.account?.username ?? null });
  }
  if (p === "/api/prices/refresh" && m === "POST") { ctx.waitUntil(refreshMissing(env)); return json({ ok: true }); }
  return bad("introuvable", 404);
}

async function refreshMissing(env) { // prix des cartes des espèces manquantes ou à vérifier
  const rows = (await env.DB.prepare("SELECT c.id FROM cards c LEFT JOIN owned o ON o.species_num=c.species_num LEFT JOIN keep k ON k.species_num=c.species_num WHERE o.species_num IS NULL OR (k.species_num IS NULL AND c.tier > o.tier)").all()).results;
  await refreshPrices(env, rows.map((r) => r.id).slice(0, 400));
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const user = await authenticate(req, env);
    if (!user) return withSec(new Response("Accès refusé", { status: 401 }));
    try {
      if (url.pathname.startsWith("/api/")) return withSec(await route(req, env, ctx, user));
      return withSec(await env.ASSETS.fetch(req));
    } catch (e) {
      console.error(e); return withSec(bad("erreur interne", 500)); // pas de détail côté client
    }
  },
  async scheduled(_e, env, ctx) { ctx.waitUntil(refreshMissing(env)); },
};
