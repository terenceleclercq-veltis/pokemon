// Client Cardmarket API v2.0 (OAuth 1.0a HMAC-SHA1), lecture seule. Liaison NON testée en réel :
// l'accès à l'API Cardmarket est restreint [à vérifier]. Ne passe jamais de commande.
import type { CardmarketCreds } from "./schemas";

const API_ORIGIN = "https://api.cardmarket.com";
const enc = (s: string) =>
  encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function hmacSha1(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...sig));
}

/** En-tête Authorization OAuth 1.0a (RFC 5849) pour une requête GET. Pur : testable avec des vecteurs fixes. */
export async function oauthHeader(
  creds: CardmarketCreds,
  url: string,
  nonce: string,
  timestamp: string,
): Promise<string> {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: creds.appToken,
    oauth_token: creds.accessToken,
    oauth_nonce: nonce,
    oauth_timestamp: timestamp,
    oauth_signature_method: "HMAC-SHA1",
    oauth_version: "1.0",
  };
  const params = [...u.searchParams.entries(), ...Object.entries(oauth)]
    .map(([k, v]) => [enc(k), enc(v)] as const)
    .sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = `GET&${enc(u.origin + u.pathname)}&${enc(params)}`;
  oauth.oauth_signature = await hmacSha1(`${enc(creds.appSecret)}&${enc(creds.accessSecret)}`, base);
  const fields = [
    `realm="${enc(u.origin + u.pathname)}"`,
    ...Object.entries(oauth).map(([k, v]) => `${k}="${enc(v)}"`),
  ];
  return "OAuth " + fields.join(", ");
}

export async function cardmarketGet(creds: CardmarketCreds, path: string, fetcher: typeof fetch = fetch) {
  const url = new URL(path, API_ORIGIN);
  if (url.origin !== API_ORIGIN || !url.pathname.startsWith("/ws/v2.0/output.json/")) throw new Error("URL interdite");
  const auth = await oauthHeader(
    creds,
    url.href,
    crypto.randomUUID().replace(/-/g, ""),
    String(Math.floor(Date.now() / 1000)),
  );
  const r = await fetcher(url.href, { headers: { Authorization: auth }, signal: AbortSignal.timeout(8000) });
  return { status: r.status, body: r.ok ? await r.json<unknown>().catch(() => null) : null };
}
