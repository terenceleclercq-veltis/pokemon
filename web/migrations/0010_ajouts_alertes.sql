-- Lot 5 (expand, ajouts uniquement) : versions ajoutées depuis le site, alertes de prix.
-- origine « site » : ajoutée par Terence (recherche TCGdex) ; gardée par les mises à jour du catalogue (seed.sql).
ALTER TABLE cards ADD COLUMN origine TEXT NOT NULL DEFAULT 'catalogue' CHECK (origine IN ('catalogue', 'site'));
-- Alerte : prévenir quand la tendance passe sous le prix maximum.
CREATE TABLE IF NOT EXISTS alert (
  card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  max_price REAL NOT NULL CHECK (max_price > 0),
  created_at TEXT NOT NULL
);
