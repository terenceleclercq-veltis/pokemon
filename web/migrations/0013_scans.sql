-- Scans de mes cartes (expand, ajouts uniquement) : photos prises avec le scanner guidé (recto, verso, gros plans des
-- coins et des bords), stockées dans R2 (binding PHOTOS) ; ici, seulement leur description.
CREATE TABLE IF NOT EXISTS scan (
  id TEXT PRIMARY KEY,                                  -- UUID
  species_num INTEGER NOT NULL REFERENCES species(num),
  card_id TEXT REFERENCES cards(id),                    -- ta carte au moment du scan (NULL : carte hors catalogue)
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scan_species ON scan(species_num, created_at);

CREATE TABLE IF NOT EXISTS photo (
  id TEXT PRIMARY KEY,                                  -- UUID ; objet R2 « photos/<id> »
  scan_id TEXT NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
  step TEXT NOT NULL,                                   -- recto, recto-hg, …, verso-b (voir STEPS côté client)
  mime TEXT NOT NULL CHECK (mime IN ('image/jpeg', 'image/webp')),
  width INTEGER NOT NULL CHECK (width > 0),
  height INTEGER NOT NULL CHECK (height > 0),
  bytes INTEGER NOT NULL CHECK (bytes > 0),
  quad TEXT,                                            -- coins de la carte sur la photo d'origine (JSON), vues entières
  sharpness REAL,                                       -- netteté mesurée à la prise (variance du laplacien)
  created_at TEXT NOT NULL,
  UNIQUE (scan_id, step)
);
