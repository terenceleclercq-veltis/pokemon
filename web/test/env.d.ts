import type { D1Migration } from "@cloudflare/vitest-plugin";

declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[];
      /** Clé publique de la clé de signature de test (vérification des jetons d'identité). */
      WIF_PUBLIC_JWK: string;
    }
  }
}
