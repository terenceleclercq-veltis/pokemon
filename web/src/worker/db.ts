// Accès D1 : requêtes paramétrées uniquement.
import type { Card, Keep, Owned, Price, Tier } from "./logic";

export interface Species {
  num: number;
  nom_fr: string;
  nom_en: string;
}

export async function loadAll(db: D1Database) {
  const [sp, cards, owned, keep, prices] = await db.batch([
    db.prepare("SELECT num, nom_fr, nom_en FROM species ORDER BY num"),
    db.prepare("SELECT * FROM cards ORDER BY species_num, tier, id"),
    db.prepare("SELECT * FROM owned"),
    db.prepare("SELECT * FROM keep"),
    db.prepare("SELECT card_id, trend, low, avg7, fetched_at FROM price_cache"),
  ]);
  return {
    species: (sp?.results ?? []) as Species[],
    cards: (cards?.results ?? []) as Card[],
    owned: (owned?.results ?? []) as Owned[],
    keep: (keep?.results ?? []) as Keep[],
    prices: (prices?.results ?? []) as (Price & { card_id: string })[],
  };
}

export const cardsOf = (db: D1Database, num: number) =>
  db.prepare("SELECT id FROM cards WHERE species_num = ?").bind(num).all<{ id: string }>();

export const cardTier = (db: D1Database, id: string, num: number) =>
  db.prepare("SELECT tier FROM cards WHERE id = ? AND species_num = ?").bind(id, num).first<{ tier: Tier }>();

/** Cartes à surveiller : espèces manquantes, ou possédées avec version plus rare et sans décision. Plus anciens prix d'abord. */
export const staleWatchlist = (db: D1Database, limit: number) =>
  db
    .prepare(
      `SELECT c.id FROM cards c
       LEFT JOIN owned o ON o.species_num = c.species_num
       LEFT JOIN keep k ON k.species_num = c.species_num
       LEFT JOIN price_cache p ON p.card_id = c.id
       WHERE o.species_num IS NULL
          OR (k.species_num IS NULL AND
              (CASE c.tier WHEN 'SIR' THEN 3 WHEN 'IR' THEN 2 ELSE 1 END) >
              (CASE o.tier WHEN 'SIR' THEN 3 WHEN 'IR' THEN 2 ELSE 1 END))
       ORDER BY COALESCE(p.fetched_at, '') ASC
       LIMIT ?`,
    )
    .bind(limit)
    .all<{ id: string }>();

export const audit = (db: D1Database, actor: string, action: string, detail?: string | number) =>
  db
    .prepare("INSERT INTO audit_log (at, actor, action, detail) VALUES (?, ?, ?, ?)")
    .bind(new Date().toISOString(), actor, action, detail === undefined ? null : String(detail).slice(0, 500));
