import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { claudeConfigured, identityToken, WIF_AUDIENCE, WIF_ISSUER } from "../../src/worker/claude";

const raw = (part: string) =>
  Uint8Array.from(
    atob(
      part
        .replace(/-/g, "+")
        .replace(/_/g, "/")
        .padEnd(Math.ceil(part.length / 4) * 4, "="),
    ),
    (c) => c.charCodeAt(0),
  );
const decode = (part: string) => JSON.parse(new TextDecoder().decode(raw(part))) as Record<string, unknown>;

describe("fédération d'identité Claude", () => {
  it("jeton ES256 de 5 minutes, à usage unique, vérifiable avec la clé publique déposée dans la console", async () => {
    const now = Date.UTC(2026, 10, 3, 12);
    const token = await identityToken(env, now);
    const [h, p, s] = token.split(".") as [string, string, string];
    expect(decode(h)).toEqual({ alg: "ES256", typ: "JWT", kid: "cle-test" });
    const claims = decode(p);
    expect(claims).toMatchObject({
      iss: WIF_ISSUER,
      sub: "pokedex-kanto:test",
      aud: WIF_AUDIENCE,
      iat: now / 1000,
      exp: now / 1000 + 300,
    });
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    const pub = await crypto.subtle.importKey(
      "jwk",
      JSON.parse(env.WIF_PUBLIC_JWK) as JsonWebKey,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      pub,
      raw(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    expect(ok).toBe(true);
    // un nouveau jti à chaque échange (Anthropic refuse un jeton déjà présenté)
    const again = decode((await identityToken(env, now)).split(".")[1]!);
    expect(again.jti).not.toBe(claims.jti);
  });

  it("configuration : identifiants de la console et clé requis ; clé illisible refusée sans écho du secret", async () => {
    expect(claudeConfigured(env)).toBe(true);
    expect(claudeConfigured({ ...env, CLAUDE_FEDERATION_RULE_ID: "" })).toBe(false);
    expect(claudeConfigured({ ...env, WIF_PRIVATE_JWK: undefined })).toBe(false);
    const err = await identityToken({ ...env, WIF_PRIVATE_JWK: "valeur-secrete-illisible" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("WIF_PRIVATE_JWK illisible");
    await expect(identityToken({ ...env, WIF_PRIVATE_JWK: JSON.stringify({ kty: "RSA" }) })).rejects.toThrow(
      "clé EC P-256 avec kid attendue",
    );
  });
});
