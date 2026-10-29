import { defineConfig, devices } from "@playwright/test";

const PORT = 8788;
const PERSIST = ".wrangler/e2e";

// Worker réel (wrangler dev, workerd) + D1 locale dédiée, migrée et remplie avant les tests.
export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  // service worker bloqué (il court-circuiterait les simulations réseau) ; testé à part dans offline.spec.ts
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure", serviceWorkers: "block" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: [
      `rm -rf ${PERSIST}`,
      `npx wrangler d1 migrations apply DB --local --persist-to ${PERSIST}`,
      `npx wrangler d1 execute DB --local --persist-to ${PERSIST} --file=seed.sql`,
      `npx wrangler dev --port ${PORT} --persist-to ${PERSIST} --var DEV_BYPASS_AUTH:1`,
    ].join(" && "),
    url: `http://localhost:${PORT}/`,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: { CI: "1" },
  },
});
