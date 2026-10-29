// Client Cardmarket API v2.0 (OAuth 1.0a, HMAC-SHA1). NON TESTÉ : l'accès à l'API est restreint [à vérifier].
// Lecture seule : ce module ne passe jamais de commande.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

async function hmacSha1(keyStr, data) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(keyStr), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  return btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data)))));
}

export async function cardmarketGet(creds, url) {
  const u = new URL(url);
  if (u.origin !== "https://api.cardmarket.com") throw new Error("hôte interdit");
  const oauth = {
    oauth_consumer_key: creds.appToken, oauth_token: creds.accessToken,
    oauth_nonce: crypto.randomUUID().replace(/-/g, ""), oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_signature_method: "HMAC-SHA1", oauth_version: "1.0",
  };
  const params = { ...Object.fromEntries(u.searchParams), ...oauth };
  const norm = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const base = `GET&${enc(u.origin + u.pathname)}&${enc(norm)}`;
  oauth.oauth_signature = await hmacSha1(`${enc(creds.appSecret)}&${enc(creds.accessSecret)}`, base);
  oauth.realm = u.origin + u.pathname;
  const auth = "OAuth " + Object.entries(oauth).map(([k, v]) => `${k}="${enc(v)}"`).join(", ");
  const r = await fetch(url, { headers: { Authorization: auth } });
  return { status: r.status, body: r.status === 200 ? await r.json().catch(() => null) : null };
}
