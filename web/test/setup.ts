import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeEach } from "vitest";

// Catalogue minimal : Bulbizarre (FA + IR + SIR), Herbizarre (IR seule), Mew (aucune carte).
const SEED = [
  "INSERT OR IGNORE INTO species VALUES (1,'Bulbizarre','Bulbasaur'),(2,'Herbizarre','Ivysaur'),(151,'Mew','Mew')",
  `INSERT OR IGNORE INTO cards (id,species_num,nom_fr,set_name,numero,categorie,tier,confiance,id_product,code_cm,image) VALUES
   ('xy1-141',1,'Florizarre EX','XY','141','FA_EX','FA','probable',281338,'XY 141',NULL),
   ('sv03.5-166',1,'Bulbizarre','151','166','IR','IR','certain',733761,'MEW 166',NULL),
   ('sv03.5-198',1,'Florizarre-ex','151','198','SIR','SIR','certain',733793,'MEW 198',NULL),
   ('sv03.5-167',2,'Herbizarre','151','167','IR','IR','certain',733762,'MEW 167',NULL)`,
];

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
  // état neuf à chaque test (le stockage n'est pas isolé automatiquement entre tests)
  await env.DB.batch(
    ["audit_log", "settings", "price_history", "price_cache", "keep", "owned"].map((t) =>
      env.DB.prepare(`DELETE FROM ${t}`),
    ),
  );
  for (const q of SEED) await env.DB.prepare(q).run();
});
