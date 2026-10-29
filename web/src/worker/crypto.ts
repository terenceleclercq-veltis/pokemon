// AES-256-GCM pour les identifiants Cardmarket. Clé = secret ENC_KEY, jamais stockée en base.
const b64e = (u: Uint8Array) => btoa(String.fromCharCode(...u));
const b64d = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function importKey(secret: string | undefined): Promise<CryptoKey> {
  if (!secret) throw new Error("ENC_KEY manquante");
  const raw = b64d(secret);
  if (raw.length !== 32) throw new Error("ENC_KEY doit faire 32 octets");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** `aad` lie le chiffré à son usage (empêche de réutiliser un chiffré pour une autre clé de réglage). */
export async function encryptJson(secret: string | undefined, obj: unknown, aad: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) },
    await importKey(secret),
    new TextEncoder().encode(JSON.stringify(obj)),
  );
  return `v1.${b64e(iv)}.${b64e(new Uint8Array(ct))}`;
}

export async function decryptJson<T>(secret: string | undefined, blob: string, aad: string): Promise<T> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("format chiffré inconnu");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64d(iv), additionalData: new TextEncoder().encode(aad) },
    await importKey(secret),
    b64d(ct),
  );
  return JSON.parse(new TextDecoder().decode(pt)) as T;
}
