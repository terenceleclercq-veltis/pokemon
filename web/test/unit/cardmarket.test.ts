import { describe, expect, it, vi } from "vitest";
import { cardmarketGet, oauthHeader } from "../../src/worker/cardmarket";

// Identifiants fictifs ; signature attendue calculée indépendamment (Python hmac/urllib, RFC 5849).
const creds = {
  appToken: "bfaD9xOU0SXBhtBP",
  appSecret: "pChvrpp6AEOEwxBIIUBOvWcRG3X9xL4Y",
  accessToken: "lBY1xptUJ7ZJSK01x4fNwzw8kAe5b10Q",
  accessSecret: "hc1wJAOX02pGGJK2uAv1ZOiwS7I9Tpoe",
};

describe("OAuth 1.0a Cardmarket", () => {
  it("signature conforme au vecteur de référence", async () => {
    const h = await oauthHeader(
      creds,
      "https://api.cardmarket.com/ws/v2.0/output.json/account",
      "53eb1f44909d6",
      "1407917892",
    );
    expect(h).toContain(`oauth_signature="${encodeURIComponent("KTSpf85OVHXjkPHcdj2PcU1Nk40=")}"`);
    expect(h).toContain('realm="https%3A%2F%2Fapi.cardmarket.com%2Fws%2Fv2.0%2Foutput.json%2Faccount"');
    expect(h).not.toContain(creds.appSecret);
    expect(h).not.toContain(creds.accessSecret);
  });
  it("refuse toute URL hors API Cardmarket (anti-SSRF)", async () => {
    const f = vi.fn();
    await expect(cardmarketGet(creds, "https://evil.example/ws/v2.0/output.json/x", f)).rejects.toThrow();
    await expect(cardmarketGet(creds, "/ws/v1/x", f)).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
