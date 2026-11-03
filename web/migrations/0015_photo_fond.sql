-- Scanner : couleur du fond autour de la carte, mesurée à la prise sur la photo d'origine (expand, ajout seulement).
-- Sert à reconnaître une image rognée sans confondre le fond et une bordure de couleur proche (verso bleu foncé sur un
-- tapis noir). JSON [r, g, b] ; NULL pour les gros plans et les photos prises avant ce changement.
ALTER TABLE photo ADD COLUMN fond TEXT;
