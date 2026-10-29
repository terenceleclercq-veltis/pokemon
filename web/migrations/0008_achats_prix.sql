-- Lot 3 (expand, ajouts uniquement) : prix du guide Cardmarket, version visée, versions écartées, commandes.
-- Prix : moyenne 30 jours et source (« cardmarket » = guide de prix quotidien, prioritaire ; « tcgdex » = repli).
ALTER TABLE price_cache ADD COLUMN avg30 REAL;
ALTER TABLE price_cache ADD COLUMN source TEXT NOT NULL DEFAULT 'tcgdex';
-- settings devient un simple clé/valeur (ex. date du dernier guide de prix appliqué) ; l'API Cardmarket est retirée.
-- Version visée : la carte que Terence veut pour l'espèce (sinon la moins chère de la rareté la plus haute).
CREATE TABLE IF NOT EXISTS wish (
  species_num INTEGER PRIMARY KEY REFERENCES species(num),
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  updated_at TEXT NOT NULL
);
-- Versions écartées (« pas cette version », « pas une vraie full art ») : ignorées pour l'objectif et les achats.
CREATE TABLE IF NOT EXISTS excluded (
  card_id TEXT PRIMARY KEY REFERENCES cards(id) ON DELETE CASCADE,
  reason TEXT,
  excluded_at TEXT NOT NULL
);
-- Commandes : commandée -> reçue (passe au binder) ou annulée ; prix payé pour le suivi des dépenses.
CREATE TABLE IF NOT EXISTS purchase (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  species_num INTEGER NOT NULL REFERENCES species(num),
  card_id TEXT NOT NULL REFERENCES cards(id),
  state TEXT NOT NULL CHECK (state IN ('commandee', 'recue', 'annulee')),
  price_paid REAL CHECK (price_paid IS NULL OR price_paid >= 0),
  ordered_at TEXT NOT NULL,
  received_at TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_purchase_state ON purchase(state, species_num);
