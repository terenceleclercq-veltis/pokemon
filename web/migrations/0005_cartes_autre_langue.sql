-- Cartes dans une autre langue, seulement pour les espèces sans aucune IR ni SIR en français (règle de Terence) :
-- colonne langue (code TCGdex, « fr » par défaut : les prix sont lus sur /v2/<langue>/cards/<id>).
-- Paras AR et Métamorph AR (VSTAR Universe, japonais), comptées comme IR. Les formes (Hisui, Méga) restent exclues,
-- comme dans le catalogue français. Ajout seul, rien n'est supprimé ; seulement si l'espèce existe ; seed.sql pose
-- les mêmes lignes.
ALTER TABLE cards ADD COLUMN langue TEXT NOT NULL DEFAULT 'fr';
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'S12a-207',46,'Paras','VSTAR Universe','207','AR','IR','certain',687769,'s12a 207','Paras [Absorb]','ja'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 46)
    AND NOT EXISTS (SELECT 1 FROM cards WHERE species_num = 46 AND tier IN ('IR','SIR'));
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'S12a-197',132,'Métamorph','VSTAR Universe','197','AR','IR','certain',687759,'s12a 197','Ditto [Sudden Transformation]','ja'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 132)
    AND NOT EXISTS (SELECT 1 FROM cards WHERE species_num = 132 AND tier IN ('IR','SIR'));
