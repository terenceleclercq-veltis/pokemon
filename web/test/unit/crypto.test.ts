import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson } from "../../src/worker/crypto";

const KEY = "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=";
const OTHER = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("chiffrement AES-GCM", () => {
  it("aller-retour", async () => {
    const blob = await encryptJson(KEY, { a: "secret" }, "ctx");
    expect(blob).not.toContain("secret");
    expect(await decryptJson(KEY, blob, "ctx")).toEqual({ a: "secret" });
  });
  it("IV aléatoire : deux chiffrés différents", async () =>
    expect(await encryptJson(KEY, 1, "ctx")).not.toBe(await encryptJson(KEY, 1, "ctx")));
  it("mauvaise clé, mauvais contexte ou chiffré altéré : échec", async () => {
    const blob = await encryptJson(KEY, { a: 1 }, "ctx");
    await expect(decryptJson(OTHER, blob, "ctx")).rejects.toThrow();
    await expect(decryptJson(KEY, blob, "autre")).rejects.toThrow();
    const [v, iv, ct] = blob.split(".");
    const bytes = Uint8Array.from(atob(ct!), (c) => c.charCodeAt(0));
    bytes[0]! ^= 0x01; // un vrai octet du chiffré, pas un caractère de padding base64
    await expect(decryptJson(KEY, `${v}.${iv}.${btoa(String.fromCharCode(...bytes))}`, "ctx")).rejects.toThrow();
  });
  it("clé absente ou de mauvaise taille : refus", async () => {
    await expect(encryptJson(undefined, 1, "ctx")).rejects.toThrow(/ENC_KEY/);
    await expect(encryptJson(btoa("court"), 1, "ctx")).rejects.toThrow(/32 octets/);
  });
});
