-- Promos au style « Illustration Rare » pour des espèces sans IR ni SIR en français (vérifiées visuellement) :
-- Ronflex SVP 051 et Magnéton SVP 159, comptées comme IR (categorie PROMO_IR). Ajout seul, rien n'est supprimé ;
-- seulement si l'espèce existe (base vide ou de test : rien) ; seed.sql pose les mêmes lignes.
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm)
  SELECT 'svp-159',82,'Magnéton','SVP Black Star Promos','159','PROMO_IR','IR','certain',796935,'SVP 159','Magneton [Overvolt Discharge | Electric Ball]'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 82);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm)
  SELECT 'svp-051',143,'Ronflex','SVP Black Star Promos','051','PROMO_IR','IR','certain',720390,'SVP 051','Snorlax [Voraciousness | Thudding Press]'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 143);
