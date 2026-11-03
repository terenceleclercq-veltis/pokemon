// Secrets et variables hors wrangler.jsonc (complète worker-configuration.d.ts généré).
interface Env {
  /** Uniquement en local (npm run dev) ; ignoré hors ENVIRONMENT=development et hors localhost. */
  DEV_BYPASS_AUTH?: string;
  /** Clé privée (JWK ES256) de la fédération d'identité Claude, écrite par .github/workflows/wif-keys.yml. */
  WIF_PRIVATE_JWK?: string;
}
