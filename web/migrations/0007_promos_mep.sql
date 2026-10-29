-- Promos MEP au style IR pour des espèces sans aucune carte : Spectrum MEP 027 et Nidorina MEP 101 (promo full art
-- du Coffret Dresseur d'Élite 30e Anniversaire, pas encore chez TCGdex), comptées comme IR, confiance « probable »
-- (non vérifiées visuellement). Ajout seul ; seulement si l'espèce existe ; seed.sql pose les mêmes lignes.
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'mep-101',30,'Nidorina','MEP Black Star Promos','101','PROMO_IR','IR','probable',895604,'MEP 101','Nidorina [Share Happiness | Bite]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 30);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'mep-027',93,'Spectrum','MEP Black Star Promos','027','PROMO_IR','IR','probable',855283,'MEP 027','Haunter [Spooky Shot]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 93);
