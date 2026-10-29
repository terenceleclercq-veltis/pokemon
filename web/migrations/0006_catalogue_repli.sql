-- Catalogue de repli pour les espèces sans IR/SIR (décisions de Terence, 29/10/2026), mêmes règles que
-- scripts/06_seed_web.py : formes (Hisui, Alola, Méga) si aucune IR/SIR de forme normale ; Character Rare ;
-- Voltorbe de Hisui AR japonaise ; chromatiques sans full art seulement pour les espèces sans aucune autre carte.
-- Ajout seul, rien n'est supprimé ; seulement si l'espèce existe ; seed.sql pose les mêmes lignes.
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sm12-242',81,'Magnéti','Cosmic Eclipse','242','CHR','FA','certain',398539,'CEC 242','Magnemite [Mirror Shot]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 81);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sm12-243',109,'Smogo','Cosmic Eclipse','243','CHR','FA','certain',398544,'CEC 243','Koffing [Blow-Away Bomb | Poison Gas]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 109);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'me03-103',36,'Méga-Mélodelfe-ex','Perfect Order','103','UR_ex','FA','certain',877520,'POR 103','Mega Clefable ex [Luminous Wing | Shooting Moons]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 36);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'me03-119',36,'Méga-Mélodelfe-ex','Perfect Order','119','SIR','SIR','certain',877536,'POR 119','Mega Clefable ex [Luminous Wing | Shooting Moons]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 36);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sm12-225',39,'Méga-Lockpin et Rondoudou GX','Cosmic Eclipse','225','FA_GX','FA','certain',408719,'CEC 225','Mega Lopunny & Jigglypuff GX [Jumping Balloon | Puffy Smashers GX]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 39);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sm12-226',39,'Méga-Lockpin et Rondoudou GX','Cosmic Eclipse','226','FA_GX','FA','probable',408724,'CEC 226','Mega Lopunny & Jigglypuff GX [Jumping Balloon | Puffy Smashers GX]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 39);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv06-181',58,'Caninos de Hisui','Twilight Masquerade','181','IR','IR','certain',769355,'TWM 181','Hisuian Growlithe [Blazing Destruction | Take Down]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 58);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'swsh11tg-TG08',59,'Arcanin de Hisui','Lost Origin Trainer Gallery','TG08','TG','FA','certain',674228,'LOR TG08','Hisuian Arcanine [Very Vulnerable | Sharp Fang]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 59);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'swsh12-179',59,'Arcanin de Hisui V','Silver Tempest','179','FA_V','FA','probable',682226,'SIT 179','Hisuian Arcanine V [Irresistible Force | Rock Bullet]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 59);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sm4-102',76,'Grolem d’Alola GX','Crimson Invasion','102','FA_GX','FA','probable',311949,'CIN 102','Alolan Golem GX [Hammer In | Super Electromagnetic Tackle | Heavy Rock GX]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 76);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sm3-138',89,'Grotadmorv d’Alola GX','Burning Shadows','138','FA_GX','FA','probable',299536,'BUS 138','Alolan Muk GX [Chemical Breath | Crunch | Tri Hazard GX]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 89);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'swsh12.5gg-GG01',100,'Voltorbe de Hisui','Crown Zenith Galarian Gallery','GG01','GG','FA','certain',691880,'CRZ GG01','Hisuian Voltorb [Cheerful Charge | Ram]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 100);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'swsh11-172',101,'Électrode de Hisui V','Lost Origin','172','FA_V','FA','probable',670823,'LOR 172','Hisuian Electrode V [Tantrum Blast | Solar Shot]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 101);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'me03-102',121,'Méga-Staross-ex','Perfect Order','102','UR_ex','FA','certain',877519,'POR 102','Mega Starmie ex [Jetting Blow | Nebula Beam]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 121);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'me03-118',121,'Méga-Staross-ex','Perfect Order','118','SIR','SIR','certain',877535,'POR 118','Mega Starmie ex [Jetting Blow | Nebula Beam]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 121);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'xy9-115',130,'M-Léviator EX','BREAKpoint','115','FA_EX','FA','probable',NULL,'BKP 115',NULL,'fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 130);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'me02.5-290',149,'Méga-Dracolosse-ex','Ascended Heroes','290','SIR','SIR','certain',869901,'ASC 290','Mega Dragonite ex [Sky Transport | Ryuno Glide]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 149);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'S12a-173',100,'Voltorbe de Hisui','VSTAR Universe','173','AR','IR','certain',687735,'s12a 173','Hisuian Voltorb [Cheerful Charge | Ram]','ja'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 100);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-092',43,'Mystherbe','Paldean Fates','092','SHINY','FA','certain',751631,'PAF 092','Oddish [Razor Leaf]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 43);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-169',56,'Férosinge','Paldean Fates','169','SHINY','FA','certain',751708,'PAF 169','Mankey [Monkey Beatdown]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 56);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-170',57,'Colossinge','Paldean Fates','170','SHINY','FA','certain',751709,'PAF 170','Primeape [Raging Punch]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 57);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-148',63,'Abra','Paldean Fates','148','SHINY','FA','certain',751687,'PAF 148','Abra [Psyshot]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 63);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-149',64,'Kadabra','Paldean Fates','149','SHINY','FA','certain',751688,'PAF 149','Kadabra [Teleportation Attack]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 64);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'swsh4.5sv-SV047',77,'Ponyta de Galar','Shining Fates Shiny Vault','SV047','SHINY','FA','certain',539618,'SHF SV047','Galarian Ponyta [Psy Bolt]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 77);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'swsh4.5sv-SV063',83,'Canarticho de Galar','Shining Fates Shiny Vault','SV063','SHINY','FA','certain',539703,'SHF SV063','Galarian Farfetch''d [Rock Smash | Pierce]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 83);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'ex9-107',83,'Canarticho','Emerald','107','SHINY','FA','certain',276618,'EM 107','Farfetch''d [Spearhead | Nosedive]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 83);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-199',84,'Doduo','Paldean Fates','199','SHINY','FA','certain',751738,'PAF 199','Doduo [Reckless Charge]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 84);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-200',85,'Dodrio','Paldean Fates','200','SHINY','FA','certain',751739,'PAF 200','Dodrio [Zooming Draw | Ballistic Beak]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 85);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'pl1-129',107,'Tygnon','Platinum','129','SHINY','FA','certain',278550,'PL 129','Hitmonchan Lv.33 [Jab | Special Punch]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 107);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-118',120,'Stari','Paldean Fates','118','SHINY','FA','certain',751657,'PAF 118','Staryu [Swift]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 120);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sv04.5-095',123,'Insécateur','Paldean Fates','095','SHINY','FA','certain',751634,'PAF 095','Scyther [Agility | Cut]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 123);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'sma-SV1',123,'Insécateur','Hidden Fates Shiny Vault','SV1','SHINY','FA','certain',NULL,'HIF SV1',NULL,'fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 123);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'pl1-130',123,'Insécateur','Platinum','130','SHINY','FA','certain',278551,'PL 130','Scyther Lv.25 [Swords Dance | Slash]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 123);
INSERT OR IGNORE INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, langue)
  SELECT 'pl1-128',125,'Elektek','Platinum','128','SHINY','FA','certain',278549,'PL 128','Electabuzz Lv.35 [Thundershock | Thunderpunch]','fr'
  WHERE EXISTS (SELECT 1 FROM species WHERE num = 125);
