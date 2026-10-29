// Chiffrement AES-GCM des identifiants Cardmarket. Clé = secret Worker ENC_KEY (base64, 32 octets), jamais en base.
const b64e = (u) => btoa(String.fromCharCode(...u));
const b64d = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const key = (env) => crypto.subtle.importKey("raw", b64d(env.ENC_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);

export async function encrypt(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(env), new TextEncoder().encode(JSON.stringify(obj))));
  return `${b64e(iv)}.${b64e(ct)}`;
}
export async function decrypt(env, s) {
  const [iv, ct] = s.split(".");
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64d(iv) }, await key(env), b64d(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}
