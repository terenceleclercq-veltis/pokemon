import { beforeEach, describe, expect, it } from "vitest";
import { devBypass, resetJwksCache, verifyAccessJwt } from "../../src/worker/auth";
import { AUD, EMAIL, jwks, signJwt, TEAM } from "../helpers";

const cfg = { team: TEAM, aud: AUD, allowedEmail: EMAIL };
const fetcher = (async () => Response.json(await jwks())) as unknown as typeof fetch;

describe("JWT Cloudflare Access", () => {
  beforeEach(() => resetJwksCache());
  it("accepte un jeton valide", async () => expect(await verifyAccessJwt(await signJwt(), cfg, fetcher)).toBe(EMAIL));
  it.each([
    ["mauvaise audience", { aud: ["autre"] }],
    ["mauvais émetteur", { iss: "https://pirate.cloudflareaccess.com" }],
    ["expiré", { exp: Math.floor(Date.now() / 1000) - 3600 }],
    ["pas encore valide", { nbf: Math.floor(Date.now() / 1000) + 3600 }],
    ["autre e-mail", { email: "intrus@example.com" }],
    ["sans e-mail", { email: undefined }],
  ])("refuse : %s", async (_n, claims) =>
    expect(await verifyAccessJwt(await signJwt(claims), cfg, fetcher)).toBeNull(),
  );
  it("refuse alg=none et kid inconnu", async () => {
    expect(await verifyAccessJwt(await signJwt({}, { alg: "none" }), cfg, fetcher)).toBeNull();
    expect(await verifyAccessJwt(await signJwt({}, { kid: "inconnu" }), cfg, fetcher)).toBeNull();
  });
  it("refuse une signature altérée", async () => {
    const t = await signJwt();
    const [h, , s] = t.split(".");
    const forged = btoa(
      JSON.stringify({ aud: [AUD], iss: `https://${TEAM}.cloudflareaccess.com`, email: EMAIL, exp: 9e9 }),
    ).replace(/=+$/, "");
    expect(await verifyAccessJwt(`${h}.${forged}.${s}`, cfg, fetcher)).toBeNull();
  });
  it("refuse si la configuration est incomplète (fail closed)", async () => {
    const t = await signJwt();
    expect(await verifyAccessJwt(t, { ...cfg, aud: "" }, fetcher)).toBeNull();
    expect(await verifyAccessJwt(t, { ...cfg, allowedEmail: "" }, fetcher)).toBeNull();
    expect(await verifyAccessJwt(t, { ...cfg, team: "../evil" }, fetcher)).toBeNull();
    expect(await verifyAccessJwt(null, cfg, fetcher)).toBeNull();
    expect(await verifyAccessJwt("pas.un.jwt", cfg, fetcher)).toBeNull();
  });
  it("e-mail comparé sans casse", async () =>
    expect(await verifyAccessJwt(await signJwt({ email: EMAIL.toUpperCase() }), cfg, fetcher)).toBe(EMAIL));
});

describe("contournement de dev", () => {
  const env = (e: Partial<Env>) => ({ ENVIRONMENT: "development", DEV_BYPASS_AUTH: "1", ...e }) as Env;
  it("autorisé seulement en dev + localhost + drapeau", () => {
    expect(devBypass(env({}), new URL("http://localhost:8787/"))).toBe(true);
    expect(devBypass(env({ ENVIRONMENT: "production" }), new URL("http://localhost/"))).toBe(false);
    expect(devBypass(env({ DEV_BYPASS_AUTH: undefined }), new URL("http://localhost/"))).toBe(false);
    expect(devBypass(env({}), new URL("https://pokedex.example.com/"))).toBe(false);
  });
});
