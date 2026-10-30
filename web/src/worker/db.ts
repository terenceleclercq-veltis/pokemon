// Accès D1 : requêtes paramétrées uniquement.
import type { Card, Keep, Owned, Price, Purchase, Tier } from "./logic";

export interface Species {
  num: number;
  nom_fr: string;
  nom_en: string;
}

export async function loadAll(db: D1Database) {
  const [sp, cards, owned, keep, prices, wish, excluded, orders, alerts, bought] = await db.batch([
    db.prepare("SELECT num, nom_fr, nom_en FROM species ORDER BY num"),
    db.prepare("SELECT * FROM cards ORDER BY species_num, tier, id"),
    db.prepare("SELECT * FROM owned"),
    db.prepare("SELECT * FROM keep"),
    db.prepare("SELECT card_id, trend, low, avg7, avg30, fetched_at, source FROM price_cache"),
    db.prepare("SELECT species_num, card_id FROM wish"),
    db.prepare("SELECT card_id FROM excluded"),
    db.prepare("SELECT * FROM purchase WHERE state = 'commandee' ORDER BY ordered_at"),
    db.prepare("SELECT card_id, max_price FROM alert"),
    db.prepare(
      `SELECT species_num, card_id, price_paid, COALESCE(received_at, ordered_at) AS at FROM purchase
       WHERE state = 'recue' ORDER BY at, id`,
    ),
  ]);
  return {
    species: (sp?.results ?? []) as Species[],
    cards: (cards?.results ?? []) as Card[],
    owned: (owned?.results ?? []) as Owned[],
    keep: (keep?.results ?? []) as Keep[],
    prices: (prices?.results ?? []) as (Price & { card_id: string })[],
    wish: (wish?.results ?? []) as { species_num: number; card_id: string }[],
    excluded: (excluded?.results ?? []) as { card_id: string }[],
    orders: (orders?.results ?? []) as Purchase[],
    alerts: (alerts?.results ?? []) as { card_id: string; max_price: number }[],
    bought: (bought?.results ?? []) as {
      species_num: number;
      card_id: string;
      price_paid: number | null;
      at: string;
    }[],
  };
}

export const cardsOf = (db: D1Database, num: number) =>
  db.prepare("SELECT id, langue FROM cards WHERE species_num = ?").bind(num).all<{ id: string; langue: string }>();

export const cardTier = (db: D1Database, id: string, num: number) =>
  db.prepare("SELECT tier FROM cards WHERE id = ? AND species_num = ?").bind(id, num).first<{ tier: Tier }>();

export const cardById = (db: D1Database, id: string) =>
  db.prepare("SELECT id, species_num, tier FROM cards WHERE id = ?").bind(id).first<{
    id: string;
    species_num: number;
    tier: Tier;
  }>();

/**
 * Cartes à relever chez TCGdex par la tâche planifiée :
 * - d'abord celles dont l'illustrateur n'est pas encore relevé (une fois par carte) ;
 * - puis les cartes utiles (espèce manquante, version plus rare sans décision, alerte de prix) qui ont quelque chose
 *   à rafraîchir : prix absent ou de repli, guide Cardmarket de plus de 48 h, ou image manquante. Une carte au prix
 *   du guide du jour n'est pas relevée (elle bloquait les suivantes, son prix ne changeant pas).
 * Plus anciens prix d'abord.
 */
export const staleWatchlist = (db: D1Database, limit: number, now = new Date()) =>
  db
    .prepare(
      `SELECT c.id, c.langue FROM cards c
       LEFT JOIN owned o ON o.species_num = c.species_num
       LEFT JOIN keep k ON k.species_num = c.species_num
       LEFT JOIN price_cache p ON p.card_id = c.id
       WHERE c.illustrateur IS NULL
          OR ((o.species_num IS NULL
               OR (k.species_num IS NULL AND
                   (CASE c.tier WHEN 'SIR' THEN 3 WHEN 'IR' THEN 2 ELSE 1 END) >
                   (CASE o.tier WHEN 'SIR' THEN 3 WHEN 'IR' THEN 2 ELSE 1 END))
               OR c.id IN (SELECT card_id FROM alert))
              AND (p.card_id IS NULL OR p.source <> 'cardmarket' OR p.fetched_at < ?2 OR c.image IS NULL))
       ORDER BY c.illustrateur IS NULL DESC, COALESCE(p.fetched_at, '') ASC
       LIMIT ?1`,
    )
    .bind(limit, new Date(now.getTime() - 48 * 3600 * 1000).toISOString())
    .all<{ id: string; langue: string }>();

export const audit = (db: D1Database, actor: string, action: string, detail?: string | number) =>
  db
    .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
    .bind(new Date().toISOString(), actor, action, detail === undefined ? null : String(detail).slice(0, 500));
