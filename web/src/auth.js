// Vérifie le JWT Cloudflare Access (en-tête Cf-Access-Jwt-Assertion). Échec = refus (fail closed).
const b64 = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const dec = (s) => JSON.parse(new TextDecoder().decode(b64(s)));
let jwks = { at: 0, keys: [] };

async function getKeys(team) {
  if (Date.now() - jwks.at < 3600_000 && jwks.keys.length) return jwks.keys;
  const r = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!r.ok) throw new Error("jwks");
  jwks = { at: Date.now(), keys: (await r.json()).keys };
  return jwks.keys;
}

/** Retourne l'email authentifié, ou null. */
export async function authenticate(request, env) {
  const host = new URL(request.url).hostname;
  if (env.DEV_BYPASS_AUTH === "1" && (host === "localhost" || host === "127.0.0.1")) return "dev@localhost";
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token || !env.ACCESS_TEAM || !env.ACCESS_AUD) return null;
  try {
    const [h, p, s] = token.split(".");
    const header = dec(h), payload = dec(p);
    if (header.alg !== "RS256") return null;
    const jwk = (await getKeys(env.ACCESS_TEAM)).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64(s), new TextEncoder().encode(`${h}.${p}`));
    const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!ok || !aud.includes(env.ACCESS_AUD) || payload.exp * 1000 < Date.now()) return null;
    if (payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return null;
    if (env.ALLOWED_EMAIL && payload.email !== env.ALLOWED_EMAIL) return null; // un seul utilisateur autorisé
    return payload.email || "inconnu";
  } catch {
    return null;
  }
}
