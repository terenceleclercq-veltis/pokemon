// Garde-fou de déploiement : node scripts/check-env.mjs <staging|production>
// Échoue si la config de l'environnement contient encore des valeurs à remplacer ou un contournement d'auth.
import { readFileSync } from "node:fs";
import { parse } from "jsonc-parser";

const env = process.argv[2];
const raw = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const cfg = parse(raw);
const errors = [];
if (raw.includes("DEV_BYPASS_AUTH")) errors.push("DEV_BYPASS_AUTH ne doit jamais apparaître dans wrangler.jsonc");
const block = cfg.env?.[env];
if (!block) errors.push(`environnement inconnu : ${env}`);
else {
  const text = JSON.stringify(block);
  if (text.includes("REMPLACER")) errors.push(`valeurs « REMPLACER » restantes dans env.${env}`);
  if (text.includes("00000000-0000-0000-0000-000000000000")) errors.push(`database_id factice dans env.${env}`);
  if (block.vars?.ENVIRONMENT !== env) errors.push(`vars.ENVIRONMENT doit valoir « ${env} »`);
  if (!block.vars?.ALLOWED_EMAIL) errors.push("vars.ALLOWED_EMAIL vide");
}
for (const e of errors) console.error(`::error::${e}`);
process.exit(errors.length ? 1 : 0);
