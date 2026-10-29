// Prix « temps réel » : tendance Cardmarket (EUR) publiée par TCGdex, cache périmètre 15 min.
import { tcgdexCard } from "./schemas";

const EDGE_TTL_S = 900;
const CONCURRENCY = 6;

export interface LivePrice {
  trend: number | null;
  low: number | null;
  avg7: number | null;
  updated: string | null;
  image: string | null;
}

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
    updated: cm.updated ?? null,
    image: parsed.data.image ? `${parsed.data.image}/low.webp` : null,
  };
}

/** Rafraîchit les cartes données (concurrence bornée), écrit cache + historique en un seul batch D1. */
export async function refreshPrices(
  db: D1Database,
  cards: readonly PriceRef[],
  fetcher: typeof fetch = fetch,
): Promise<Record<string, LivePrice>> {
  const out: Record<string, LivePrice> = {};
  const queue = [...cards];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let c = queue.shift(); c !== undefined; c = queue.shift()) {
        const p = await fetchPrice(c, fetcher).catch(() => null);
        if (p) out[c.id] = p;
      }
    }),
  );
  const now = new Date().toISOString();
  const day = now.slice(0, 10);
  const stmts = Object.entries(out).flatMap(([id, p]) => [
    db
      .prepare(
        `INSERT INTO price_cache (card_id, trend, low, avg7, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(card_id) DO UPDATE SET trend = ?2, low = ?3, avg7 = ?4, fetched_at = ?5`,
      )
      .bind(id, p.trend, p.low, p.avg7, now),
    db
      .prepare(
        `INSERT INTO price_history (card_id, day, trend, low) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(card_id, day) DO UPDATE SET trend = ?3, low = ?4`,
      )
      .bind(id, day, p.trend, p.low),
    ...(p.image ? [db.prepare("UPDATE cards SET image = ?2 WHERE id = ?1 AND image IS NOT ?2").bind(id, p.image)] : []),
  ]);
  if (stmts.length) await db.batch(stmts);
  return out;
}
