-- Migration 0001 : schéma initial. Appliquée par « wrangler d1 migrations apply DB » (CI/CD).
CREATE TABLE IF NOT EXISTS species (
  num INTEGER PRIMARY KEY CHECK (num BETWEEN 1 AND 151),
  nom_fr TEXT NOT NULL, nom_en TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cards (            -- catalogue full art FR (généré par scripts/06_seed_web.py)
  id TEXT PRIMARY KEY,                         -- id TCGdex FR
  species_num INTEGER NOT NULL REFERENCES species(num),
  nom_fr TEXT NOT NULL, set_name TEXT NOT NULL, numero TEXT NOT NULL,
  categorie TEXT NOT NULL, tier TEXT NOT NULL CHECK (tier IN ('FA','IR','SIR')),
  confiance TEXT NOT NULL, id_product INTEGER, image TEXT
);
CREATE INDEX IF NOT EXISTS idx_cards_species ON cards(species_num);
CREATE TABLE IF NOT EXISTS owned (             -- ce que Terence possède (1 ligne par espèce)
  species_num INTEGER PRIMARY KEY REFERENCES species(num),
  card_id TEXT REFERENCES cards(id),           -- carte du catalogue, ou NULL si autre carte
  tier TEXT NOT NULL CHECK (tier IN ('FA','IR','SIR')),
  note TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS keep (              -- « je préfère la mienne » : plus de vérification
  species_num INTEGER PRIMARY KEY REFERENCES species(num),
  note TEXT, decided_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS price_cache (
  card_id TEXT PRIMARY KEY REFERENCES cards(id),
  trend REAL, low REAL, avg7 REAL, fetched_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS price_history (
  card_id TEXT NOT NULL, day TEXT NOT NULL, trend REAL, low REAL,
  PRIMARY KEY (card_id, day)
);
CREATE TABLE IF NOT EXISTS settings (          -- identifiants Cardmarket chiffrés (AES-GCM), jamais en clair
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, detail TEXT
);
