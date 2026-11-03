-- Pré-évaluation PSA d'un scan par Claude (expand, ajouts uniquement) : constats de Claude, centrage mesuré par le
-- site, verdict par règles fixes, coût ; la note PSA réellement obtenue est saisie plus tard (fiabilité mesurée).
CREATE TABLE IF NOT EXISTS analyse (
  id TEXT PRIMARY KEY,                                  -- UUID
  scan_id TEXT NOT NULL REFERENCES scan(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  finished_at TEXT,
  state TEXT NOT NULL CHECK (state IN ('en_cours', 'terminee', 'echec')),
  model TEXT NOT NULL,
  centrage TEXT,                                        -- JSON : bordures mesurées par le site (recto, verso)
  constats TEXT,                                        -- JSON : réponse de Claude (format imposé, revalidée)
  verdict TEXT CHECK (verdict IN ('candidat_10', 'probable_9', 'huit_ou_moins', 'photos_insuffisantes')),
  plafond INTEGER CHECK (plafond BETWEEN 7 AND 10),     -- note maximale plausible d'après les règles
  raisons TEXT,                                         -- JSON : critères limitants et constats incertains
  input_tokens INTEGER,
  output_tokens INTEGER,
  cout_usd REAL,
  erreur TEXT,
  note_psa REAL CHECK (note_psa BETWEEN 1 AND 10)       -- note PSA réellement obtenue
);
CREATE INDEX IF NOT EXISTS idx_analyse_scan ON analyse(scan_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analyse_jour ON analyse(created_at);
