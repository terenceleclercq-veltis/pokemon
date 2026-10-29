// Prix du guide Cardmarket (publiés chaque jour par la CI sur la branche donnees-prix) -> cache de prix et historique.
import { priceFeed } from "./schemas";

/** Hôte et chemin figés (anti-SSRF) ; fichier public, quelques dizaines de Ko. */
export const FEED_URL = "https://raw.githubusercontent.com/terenceleclercq-veltis/pokemon/donnees-prix/prix.json";
const KEY = "prix_cardmarket";

/**
 * Applique le dernier guide de prix s'il est nouveau (date du guide mémorisée dans settings).
 * Retourne le nombre de cartes mises à jour (0 si rien de neuf ou source indisponible).
 */
export async function applyPriceGuide(db: D1Database, fetcher: typeof fetch = fetch): Promise<number> {
  const r = await fetcher(FEED_URL, { cf: { cacheTtl: 900 }, signal: AbortSignal.timeout(8000) }).catch(() => null);
  if (!r?.ok) return 0;
  const parsed = priceFeed.safeParse(await r.json().catch(() => null));
  if (!parsed.success) return 0;
  const feed = parsed.data;
  const last = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(KEY).first<{ value: string }>();
  if (last?.value === feed.guide) return 0;
  const { results } = await db
    .prepare("SELECT id, id_product FROM cards WHERE id_product IS NOT NULL")
    .all<{ id: string; id_product: number }>();
  const now = new Date().toISOString();
  const day = feed.guide.slice(0, 10);
  const stmts = results.flatMap((c) => {
    const p = feed.prices[String(c.id_product)];
    if (!p || p.trend == null) return [];
    return [
      db
        .prepare(
          `INSERT INTO price_cache (card_id, trend, low, avg7, avg30, fetched_at, source)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'cardmarket')
           ON CONFLICT(card_id) DO UPDATE SET trend = ?2, low = ?3, avg7 = ?4, avg30 = ?5, fetched_at = ?6,
             source = 'cardmarket'`,
        )
        .bind(c.id, p.trend, p.low ?? null, p.avg7 ?? null, p.avg30 ?? null, now),
      db
        .prepare(
          `INSERT INTO price_history (card_id, day, trend, low) VALUES (?1, ?2, ?3, ?4)
           ON CONFLICT(card_id, day) DO UPDATE SET trend = ?3, low = ?4`,
        )
        .bind(c.id, day, p.trend, p.low ?? null),
    ];
  });
  await db.batch([
    ...stmts,
    db
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3`,
      )
      .bind(KEY, feed.guide, now),
  ]);
  return stmts.length / 2;
}
