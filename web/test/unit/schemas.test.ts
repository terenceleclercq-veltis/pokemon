import { describe, expect, it } from "vitest";
import { importBody, ownedBody, speciesParam, tcgdexCard } from "../../src/worker/schemas";

describe("validation des entrées", () => {
  it.each(["0", "152", "-1", "1.5", "abc", "1e2"])("refuse l'espèce %s", (num) =>
    expect(speciesParam.safeParse({ num }).success).toBe(false),
  );
  it("accepte 1 et 151", () => {
    expect(speciesParam.parse({ num: "1" }).num).toBe(1);
    expect(speciesParam.parse({ num: "151" }).num).toBe(151);
  });
  it("owned : card_id OU tier, rien d'autre", () => {
    expect(ownedBody.safeParse({ card_id: "sv03.5-166" }).success).toBe(true);
    expect(ownedBody.safeParse({ tier: "SIR" }).success).toBe(true);
    expect(ownedBody.safeParse({ tier: "XX" }).success).toBe(false);
    expect(ownedBody.safeParse({ card_id: "x'; DROP TABLE owned;--" }).success).toBe(false);
    expect(ownedBody.safeParse({ tier: "IR", admin: true }).success).toBe(false);
    expect(ownedBody.safeParse({ tier: "IR", note: "x".repeat(301) }).success).toBe(false);
  });
  it("import : borné à 151 lignes", () => {
    const owned = Array.from({ length: 152 }, (_, i) => ({ species_num: (i % 151) + 1, card_id: null, tier: "FA" }));
    expect(importBody.safeParse({ version: 1, owned, keep: [] }).success).toBe(false);
  });
  it("réponse TCGdex : image hors domaine attendu refusée", () => {
    expect(tcgdexCard.safeParse({ image: "https://evil.example/x" }).success).toBe(false);
    expect(tcgdexCard.safeParse({ pricing: { cardmarket: { trend: -1 } } }).success).toBe(false);
    expect(tcgdexCard.safeParse({ pricing: { cardmarket: { trend: 12.5 } } }).success).toBe(true);
  });
});
