-- Lot 6 (expand, ajout uniquement) : illustrateur de la carte (TCGdex), relevé avec le prix et l'image.
-- NULL : pas encore relevé ; '' : inconnu de TCGdex.
ALTER TABLE cards ADD COLUMN illustrateur TEXT;
