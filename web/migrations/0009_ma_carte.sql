-- Lot 4 (expand, ajouts uniquement) : détails de la carte possédée (état, gradation, doubles pour l'échange).
ALTER TABLE owned ADD COLUMN condition TEXT CHECK (condition IS NULL OR condition IN ('MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'));
ALTER TABLE owned ADD COLUMN grade TEXT;
ALTER TABLE owned ADD COLUMN doubles INTEGER NOT NULL DEFAULT 0 CHECK (doubles >= 0);
