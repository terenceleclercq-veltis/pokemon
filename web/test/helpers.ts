import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { vi } from "vitest";
import worker from "../src/worker/index";

export const TEAM = "equipe-test";
export const AUD = "aud-test";
export const EMAIL = "terence@example.com";
export const ORIGIN = "https://pokedex.example.com";

const b64url = (b: ArrayBuffer | Uint8Array | string) =>
  btoa(
    typeof b === "string" ? b : String.fromCharCode(...new Uint8Array(b instanceof Uint8Array ? b : new Uint8Array(b))),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

let keys: CryptoKeyPair | undefined;
export async function keyPair(): Promise<CryptoKeyPair> {
  keys ??= (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return keys;
}
export async function jwks() {
  const pub = (await crypto.subtle.exportKey("jwk", (await keyPair()).publicKey)) as JsonWebKey;
  return { keys: [{ ...pub, kid: "k1", alg: "RS256", use: "sig" }] };
}
export async function signJwt(claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT", ...header }));
  const p = b64url(
    JSON.stringify({
      aud: [AUD],
      iss: `https://${TEAM}.cloudflareaccess.com`,
      email: EMAIL,
      exp: now + 600,
      iat: now,
      ...claims,
    }),
  );
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    (await keyPair()).privateKey,
    new TextEncoder().encode(`${h}.${p}`),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

/** Remplace fetch sortant : JWKS Access + TCGdex simulés ; tout autre hôte = erreur (pas de réseau en test). */
export function mockOutbound(prices: Record<string, number | null> = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.href === `https://${TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`) return Response.json(await jwks());
    if (url.hostname === "api.tcgdex.net") {
      const id = decodeURIComponent(url.pathname.split("/").pop() ?? "");
      if (!(id in prices)) return new Response("not found", { status: 404 });
      return Response.json({
        image: `https://assets.tcgdex.net/fr/x/${id}`,
        pricing: { cardmarket: { trend: prices[id], low: prices[id] ? prices[id] / 2 : null, avg7: prices[id] } },
      });
    }
    throw new Error(`réseau interdit en test : ${url.href}`);
  });
}

export async function call(
  path: string,
  init: RequestInit & { json?: unknown; auth?: boolean; csrf?: boolean } = {},
): Promise<Response> {
  const { json, auth = true, csrf = true, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (auth) headers.set("Cf-Access-Jwt-Assertion", await signJwt());
  if (csrf) headers.set("X-Requested-With", "pokedex");
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const req = new Request(ORIGIN + path, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const ctx = createExecutionContext();
  const res = await worker.fetch(req, env, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}
