import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Les tests tournent dans workerd (même runtime qu'en production), avec une D1 locale migrée.
const migrations = await readD1Migrations("./migrations");

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
