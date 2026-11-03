// Clé de signature de la fédération d'identité Claude (Workload Identity Federation) :
//   node scripts/wif-keys.mjs <staging|production>
// Génère une paire de clés ES256 (P-256). La clé privée part directement dans le secret Worker WIF_PRIVATE_JWK de
// l'environnement (wrangler secret put, par l'entrée standard) : elle n'est jamais affichée, journalisée ni écrite sur
// disque. Seule la clé publique est affichée, à coller dans le JWKS « inline » de l'émetteur, dans la console Claude.
// Rotation : relancer, ajouter la nouvelle clé publique au JWKS (son kid est unique), puis retirer l'ancienne. Une seule
// exécution à la fois par environnement : la dernière écrit le secret, même si elle a été annulée en cours de route.
import { spawn } from "node:child_process";
import { webcrypto } from "node:crypto";

const env = process.argv[2];
if (env !== "staging" && env !== "production") {
  console.error("usage : node scripts/wif-keys.mjs <staging|production>");
  process.exit(2);
}

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
// identifiant unique à chaque génération (date, heure, suffixe aléatoire) : en rotation, la nouvelle clé publique
// s'ajoute à côté de l'ancienne dans le JWKS, sans ambiguïté, puis l'ancienne est retirée
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
const kid = `pokedex-kanto-${env}-${stamp}-${webcrypto.randomUUID().slice(0, 6)}`;
const priv = await webcrypto.subtle.exportKey("jwk", pair.privateKey);
const pub = await webcrypto.subtle.exportKey("jwk", pair.publicKey);

// sorties de wrangler sur la sortie d'erreur : la sortie standard ne porte que la clé publique (capturée par la CI)
const child = spawn("npx", ["wrangler", "secret", "put", "WIF_PRIVATE_JWK", "--env", env], {
  stdio: ["pipe", 2, 2],
});
child.stdin.end(JSON.stringify({ kty: priv.kty, crv: priv.crv, x: priv.x, y: priv.y, d: priv.d, kid, alg: "ES256" }));
const code = await new Promise((resolve) => child.on("close", resolve));
if (code !== 0) {
  console.error(`::error::wrangler secret put a échoué (code ${code}) ; aucune clé publique à enregistrer`);
  process.exit(1);
}

// clé publique seule (pas de « d ») : à coller dans la console Claude
console.log(JSON.stringify({ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid, alg: "ES256", use: "sig" }));
