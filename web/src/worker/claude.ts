// Claude depuis le Worker, sans clé API : fédération d'identité (Workload Identity Federation, docs/gitops.md étape 7).
// Le Worker est son propre émetteur OIDC : pour chaque échange, il signe un jeton ES256 de 5 minutes à usage unique
// avec le secret WIF_PRIVATE_JWK ; Anthropic le vérifie avec la clé publique déposée dans la console Claude (JWKS
// inline) et rend un jeton d'accès de 10 minutes, que le SDK garde en cache et renouvelle.
import Anthropic from "@anthropic-ai/sdk";
import { oidcFederationProvider } from "@anthropic-ai/sdk/lib/credentials/oidc-federation";

/** Émetteur déclaré dans la console Claude : comparé tel quel au champ `iss`, jamais contacté (JWKS inline). */
export const WIF_ISSUER = "https://pokedex-kanto.pokedex-terence.workers.dev";
export const WIF_AUDIENCE = "https://api.anthropic.com";
const API = "https://api.anthropic.com";
/** Durée de vie du jeton d'identité : l'émetteur en accepte jusqu'à 1 h, 5 minutes suffisent à l'échange. */
const ASSERTION_TTL = 300;

/** L'analyse est-elle configurée (identifiants de la console Claude et clé de signature) ? */
export function claudeConfigured(env: Env): boolean {
  return Boolean(
    env.WIF_PRIVATE_JWK && env.CLAUDE_ORG_ID && env.CLAUDE_FEDERATION_RULE_ID && env.CLAUDE_SERVICE_ACCOUNT_ID,
  );
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const b64json = (v: unknown) => b64url(new TextEncoder().encode(JSON.stringify(v)));

let signer: { source: string; key: CryptoKey; kid: string } | undefined;

async function signingKey(env: Env) {
  const source = env.WIF_PRIVATE_JWK ?? "";
  if (signer?.source !== source) {
    let jwk: JsonWebKey & { kid?: string };
    try {
      jwk = JSON.parse(source) as JsonWebKey & { kid?: string };
    } catch {
      // jamais le contenu du secret dans un message d'erreur
      throw new Error("WIF_PRIVATE_JWK illisible");
    }
    if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.d || !jwk.kid)
      throw new Error("WIF_PRIVATE_JWK : clé EC P-256 avec kid attendue");
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d },
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"],
    );
    signer = { source, key, kid: jwk.kid };
  }
  return signer;
}

/** Jeton d'identité du Worker : ES256, 5 minutes, à usage unique (`jti`), sujet `pokedex-kanto:<environnement>`. */
export async function identityToken(env: Env, now = Date.now()): Promise<string> {
  const { key, kid } = await signingKey(env);
  const iat = Math.floor(now / 1000);
  const input = `${b64json({ alg: "ES256", typ: "JWT", kid })}.${b64json({
    iss: WIF_ISSUER,
    sub: `pokedex-kanto:${env.ENVIRONMENT}`,
    aud: WIF_AUDIENCE,
    iat,
    exp: iat + ASSERTION_TTL,
    jti: crypto.randomUUID(),
  })}`;
  // WebCrypto signe ECDSA au format r||s (64 octets) : exactement la signature JWS ES256
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

// fetch global résolu à chaque appel (les tests le remplacent)
const fetcher = (input: string | URL | Request, init?: RequestInit) => fetch(input, init);

function federation(env: Env) {
  return oidcFederationProvider({
    identityTokenProvider: () => identityToken(env),
    federationRuleId: env.CLAUDE_FEDERATION_RULE_ID,
    organizationId: env.CLAUDE_ORG_ID,
    serviceAccountId: env.CLAUDE_SERVICE_ACCOUNT_ID,
    workspaceId: env.CLAUDE_WORKSPACE_ID || undefined,
    baseURL: API,
    fetch: fetcher,
    userAgent: "pokedex-kanto",
  });
}

let cached: { config: string; client: Anthropic } | undefined;

/** Client Claude, un par isolat : le jeton d'accès reste en cache jusqu'à son renouvellement. */
export function claude(env: Env): Anthropic {
  const config = [
    env.ENVIRONMENT,
    env.CLAUDE_ORG_ID,
    env.CLAUDE_FEDERATION_RULE_ID,
    env.CLAUDE_SERVICE_ACCOUNT_ID,
    env.CLAUDE_WORKSPACE_ID,
  ].join("|");
  if (cached?.config !== config)
    cached = {
      config,
      client: new Anthropic({
        credentials: federation(env),
        baseURL: API,
        fetch: fetcher,
        maxRetries: 1,
        timeout: 240_000,
      }),
    };
  return cached.client;
}

/** Vérifie la configuration de bout en bout : un échange de jeton, sans appel au modèle (gratuit). */
export async function checkFederation(env: Env): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await federation(env)();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 300) : "échange refusé" };
  }
}
