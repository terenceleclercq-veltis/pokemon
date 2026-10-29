import { staleWatchlist } from "./db";
import { refreshPrices } from "./prices";

/** Cartes rafraîchies par passage (reste sous la limite de sous-requêtes du plan gratuit). */
export const CRON_BATCH = 40;

export async function scheduledRefresh(env: Env, fetcher: typeof fetch = fetch): Promise<number> {
  const { results } = await staleWatchlist(env.DB, CRON_BATCH);
  const done = await refreshPrices(env.DB, results, fetcher);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_log WHERE at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-365 days')"),
    env.DB.prepare("DELETE FROM price_history WHERE day < date('now', '-730 days')"),
  ]);
  return Object.keys(done).length;
}
