import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Les tests tournent dans workerd (même runtime qu'en production), avec une D1 locale migrée.
const migrations = await readD1Migrations("./migrations");
// clé de signature de la fédération d'identité : générée à chaque lancement (jamais de clé privée dans le dépôt)
const wif = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const wifPrivate = { ...(await crypto.subtle.exportKey("jwk", wif.privateKey)), kid: "cle-test", alg: "ES256" };
const wifPublic = { ...(await crypto.subtle.exportKey("jwk", wif.publicKey)), kid: "cle-test", alg: "ES256" };

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: migrations,
          ENVIRONMENT: "test",
          ACCESS_TEAM: "equipe-test",
          ACCESS_AUD: "aud-test",
          ALLOWED_EMAIL: "terence@example.com",
          CI_SERVICE_TOKEN_ID: "ci-token.access",
          CLAUDE_ORG_ID: "00000000-0000-4000-8000-000000000001",
          CLAUDE_FEDERATION_RULE_ID: "fdrl_test",
          CLAUDE_SERVICE_ACCOUNT_ID: "svac_test",
          CLAUDE_WORKSPACE_ID: "wrkspc_test",
          ANALYSES_PAR_JOUR: "3",
          WIF_PRIVATE_JWK: JSON.stringify(wifPrivate),
          WIF_PUBLIC_JWK: JSON.stringify(wifPublic),
        },
      },
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "istanbul",
      include: ["src/worker/**"],
      reporter: ["text-summary", "lcov"],
      thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 },
    },
  },
});
