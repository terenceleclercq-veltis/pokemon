// Secrets et variables hors wrangler.jsonc (complète worker-configuration.d.ts généré).
interface Env {
  /** Clé AES-256 en base64 (wrangler secret put ENC_KEY). */
  ENC_KEY?: string;
  /** Uniquement en local (npm run dev) ; ignoré hors ENVIRONMENT=development et hors localhost. */
  DEV_BYPASS_AUTH?: string;
}
