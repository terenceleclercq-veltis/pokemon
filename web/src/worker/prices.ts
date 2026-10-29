// Prix de repli et images : tendance Cardmarket (EUR) publiée par TCGdex, cache périmètre 15 min.
// Le guide de prix Cardmarket (feed.ts) reste prioritaire tant qu'il a moins de 48 h.
import { tcgdexCard } from "./schemas";

const EDGE_TTL_S = 900;
const CONCURRENCY = 6;

export interface LivePrice {
  trend: number | null;
  low: number | null;
  avg7: number | null;
  avg30: number | null;
  updated: string | null;
  image: string | null;
}

/** Prix tel qu'enregistré (guide Cardmarket ou TCGdex), renvoyé au navigateur avec l'image. */
export interface StoredPrice {
  trend: number | null;
  low: number | null;
  avg7: number | null;
  avg30: number | null;
  fetched_at: string;
  source: string;
  image: string | null;
}

const GUIDE_FRESH_MS = 48 * 3600 * 1000;

/** Carte à rafraîchir : id TCGdex et langue de la carte (« fr », ou « ja » pour une carte japonaise). */
export interface PriceRef {
  id: string;
  langue: string;
}

export async function fetchPrice({ id, langue }: PriceRef, fetcher: typeof fetch = fetch): Promise<LivePrice | null> {
  const url = `https://api.tcgdex.net/v2/${encodeURIComponent(langue)}/cards/${encodeURIComponent(id)}`;
  const r = await fetcher(url, {
    cf: { cacheTtl: EDGE_TTL_S, cacheEverything: true },
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return null;
  const parsed = tcgdexCard.safeParse(await r.json().catch(() => null));
  if (!parsed.success) return null;
  const cm = parsed.data.pricing?.cardmarket ?? {};
  return {
    trend: cm.trend || cm["trend-holo"] || null,
    low: cm.low || null,
    avg7: cm.avg7 || null,
    avg30: cm.avg30 || null,
    updated: cm.updated ?? null,
    image: parsed.data.image ? `${parsed.data.image}/low.webp` : null,
  };
}

/**
 * Rafraîchit les cartes données (concurrence bornée) : images, et prix sauf si le guide Cardmarket est récent.
 * Écrit cache + historique en un seul batch D1, puis renvoie les prix enregistrés (source unique pour l'affichage).
 */
export async function refreshPrices(
  db: D1Database,
  cards: readonly PriceRef[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, StoredPrice>> {
  const live: Record<string, LivePrice> = {};
  const queue = [...cards];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let c = queue.shift(); c !== undefined; c = queue.shift()) {
        const p = await fetchPrice(c, fetcher).catch(() => null);
        if (p) live[c.id] = p;
      }
    }),
  );
  const now = new Date();
  const iso = now.toISOString();
  const day = iso.slice(0, 10);
  const fresh = new Date(now.getTime() - GUIDE_FRESH_MS).toISOString();
  const stmts = Object.entries(live).flatMap(([id, p]) => [
    db
      .prepare(
        `INSERT INTO price_cache (card_id, trend, low, avg7, avg30, fetched_at, source)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'tcgdex')
         ON CONFLICT(card_id) DO UPDATE SET trend = ?2, low = ?3, avg7 = ?4, avg30 = ?5, fetched_at = ?6,
           source = 'tcgdex'
         WHERE price_cache.source <> 'cardmarket' OR price_cache.fetched_at < ?7`,
      )
      .bind(id, p.trend, p.low, p.avg7, p.avg30, iso, fresh),
    db
      .prepare(
        `INSERT INTO price_history (card_id, day, trend, low) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(card_id, day) DO NOTHING`,
      )
      .bind(id, day, p.trend, p.low),
    ...(p.image ? [db.prepare("UPDATE cards SET image = ?2 WHERE id = ?1 AND image IS NOT ?2").bind(id, p.image)] : []),
  ]);
  if (stmts.length) await db.batch(stmts);
  if (!cards.length) return {};
  const { results } = await db
    .prepare(
      `SELECT c.id AS card_id, c.image, p.trend, p.low, p.avg7, p.avg30, p.fetched_at, p.source
       FROM cards c JOIN price_cache p ON p.card_id = c.id
       WHERE c.id IN (SELECT value FROM json_each(?1))`,
    )
    .bind(JSON.stringify(cards.map((c) => c.id)))
    .all<StoredPrice & { card_id: string }>();
  return Object.fromEntries(
    results.map(({ card_id, ...p }) => [card_id, { ...p, image: p.image ?? live[card_id]?.image ?? null }]),
  );
}
