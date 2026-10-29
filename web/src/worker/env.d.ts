// Secrets et variables hors wrangler.jsonc (complète worker-configuration.d.ts généré).
interface Env {
  /** Uniquement en local (npm run dev) ; ignoré hors ENVIRONMENT=development et hors localhost. */
  DEV_BYPASS_AUTH?: string;
}
