// Vérification du JWT Cloudflare Access (en-tête Cf-Access-Jwt-Assertion). Tout échec = refus.
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const json = (s: string): unknown => JSON.parse(new TextDecoder().decode(b64url(s)));

interface Jwk extends JsonWebKey {
  kid: string;
}
interface Header {
  alg: string;
  kid: string;
}
interface Payload {
  aud: string | string[];
  iss: string;
  exp: number;
  nbf?: number;
  email?: string;
  common_name?: string;
}
export interface AccessConfig {
  team: string;
  aud: string;
  allowedEmail: string;
  /** Client ID du service token Access de la CI (smoke tests) ; vide = désactivé. */
  serviceTokenId?: string;
}

let cache: { team: string; at: number; keys: Jwk[] } = { team: "", at: 0, keys: [] };
const TTL_MS = 3_600_000;
const SKEW_S = 60;

async function keysFor(team: string, kid: string, fetcher: typeof fetch): Promise<Jwk | undefined> {
  const fresh = cache.team === team && Date.now() - cache.at < TTL_MS;
  let key = fresh ? cache.keys.find((k) => k.kid === kid) : undefined;
  if (key) return key;
  // kid inconnu ou cache expiré : rotation de clés possible -> on recharge une fois
  const r = await fetcher(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) return undefined;
  cache = { team, at: Date.now(), keys: (await r.json<{ keys: Jwk[] }>()).keys };
  key = cache.keys.find((k) => k.kid === kid);
  return key;
}

export function resetJwksCache(): void {
  cache = { team: "", at: 0, keys: [] };
}

/** Identité authentifiée : e-mail de l'utilisateur, « service:<id> » pour le service token CI, ou null. */
export async function verifyAccessJwt(
  token: string | null,
  cfg: AccessConfig,
  fetcher: typeof fetch = fetch,
  now = Date.now() / 1000,
): Promise<string | null> {
  if (!token || !cfg.team || !cfg.aud || !cfg.allowedEmail) return null;
  if (!/^[a-z0-9-]{1,63}$/.test(cfg.team)) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts as [string, string, string];
    const header = json(h) as Header;
    if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
    const jwk = await keysFor(cfg.team, header.kid, fetcher);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
      "verify",
    ]);
    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64url(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!valid) return null;
    const pl = json(p) as Payload;
    const aud = Array.isArray(pl.aud) ? pl.aud : [pl.aud];
    if (!aud.includes(cfg.aud)) return null;
    if (pl.iss !== `https://${cfg.team}.cloudflareaccess.com`) return null;
    if (typeof pl.exp !== "number" || pl.exp + SKEW_S < now) return null;
    if (typeof pl.nbf === "number" && pl.nbf - SKEW_S > now) return null;
    if (!pl.email && cfg.serviceTokenId && pl.common_name === cfg.serviceTokenId) return `service:${pl.common_name}`;
    if (!pl.email || pl.email.toLowerCase() !== cfg.allowedEmail.toLowerCase()) return null;
    return pl.email.toLowerCase();
  } catch {
    return null;
  }
}

/** Contournement réservé au développement local : 3 conditions cumulatives. */
export function devBypass(env: Env, url: URL): boolean {
  return (
    env.ENVIRONMENT === "development" &&
    env.DEV_BYPASS_AUTH === "1" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  );
}
