// Prix « temps réel » : TCGdex (relevés Cardmarket, EUR), mis en cache 15 min au bord par la Cache API.
const TTL = 900;

export async function fetchPrice(id) {
  const url = `https://api.tcgdex.net/v2/fr/cards/${encodeURIComponent(id)}`;
  const r = await fetch(url, { cf: { cacheTtl: TTL, cacheEverything: true } });
  if (!r.ok) return null;
  const d = await r.json();
  const cm = d.pricing?.cardmarket ?? {};
  return {
    trend: cm.trend || cm["trend-holo"] || null, low: cm.low || null, avg7: cm.avg7 || null,
    updated: cm.updated ?? null, idProduct: cm.idProduct ?? null, image: d.image ? `${d.image}/low.webp` : null,
  };
}

/** Rafraîchit une liste de cartes (concurrence limitée) et met à jour cache + historique. */
export async function refreshPrices(env, ids) {
  const now = new Date().toISOString(), day = now.slice(0, 10), out = {};
  for (let i = 0; i < ids.length; i += 5) {
    await Promise.all(ids.slice(i, i + 5).map(async (id) => {
      const p = await fetchPrice(id).catch(() => null);
      if (!p) return;
      out[id] = p;
      await env.DB.batch([
        env.DB.prepare("INSERT INTO price_cache (card_id,trend,low,avg7,fetched_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(card_id) DO UPDATE SET trend=?2,low=?3,avg7=?4,fetched_at=?5").bind(id, p.trend, p.low, p.avg7, now),
        env.DB.prepare("INSERT INTO price_history (card_id,day,trend,low) VALUES (?1,?2,?3,?4) ON CONFLICT(card_id,day) DO UPDATE SET trend=?3,low=?4").bind(id, day, p.trend, p.low),
        ...(p.image ? [env.DB.prepare("UPDATE cards SET image=?2 WHERE id=?1").bind(id, p.image)] : []),
      ]);
    }));
  }
  return out;
}
