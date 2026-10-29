import { describe, expect, it } from "vitest";
import { cheapestPerTier, higherThan, speciesStatus, wantsLine, type Card, type Owned } from "../../src/worker/logic";

const card = (id: string, tier: Card["tier"]): Card => ({
  id,
  tier,
  species_num: 1,
  nom_fr: id,
  set_name: "S",
  numero: "1",
  categorie: tier,
  confiance: "certain",
  id_product: null,
  code_cm: null,
  image: null,
});
const cards = [card("fa", "FA"), card("ir1", "IR"), card("ir2", "IR"), card("sir", "SIR")];
const owned = (tier: Card["tier"], card_id: string | null): Owned => ({
  species_num: 1,
  tier,
  card_id,
  note: null,
  updated_at: "",
});
const keep = { species_num: 1, note: null, decided_at: "" };

describe("speciesStatus", () => {
  it("manquante sans carte possédée", () => expect(speciesStatus(cards, undefined, undefined)).toBe("manquante"));
  it("à vérifier si une version plus rare existe", () =>
    expect(speciesStatus(cards, owned("IR", "ir1"), undefined)).toBe("a_verifier"));
  it("choisie après « je préfère la mienne »", () =>
    expect(speciesStatus(cards, owned("FA", "fa"), keep)).toBe("choisie"));
  it("complète avec la SIR", () => expect(speciesStatus(cards, owned("SIR", "sir"), undefined)).toBe("complete"));
  it("complète si le catalogue n'a rien de plus rare", () =>
    expect(speciesStatus([card("fa", "FA")], owned("FA", "fa"), undefined)).toBe("complete"));
  it("un keep obsolète n'empêche pas « complète »", () =>
    expect(speciesStatus(cards, owned("SIR", null), keep)).toBe("complete"));
});

describe("higherThan", () => {
  it("ignore les tiers égaux ou inférieurs", () =>
    expect(higherThan(cards, owned("IR", "ir1")).map((c) => c.id)).toEqual(["sir"]));
  it("carte hors catalogue : se base sur le tier", () =>
    expect(higherThan(cards, owned("FA", null)).map((c) => c.id)).toEqual(["ir1", "ir2", "sir"]));
});

describe("cheapestPerTier", () => {
  it("prend le moins cher et relègue les prix inconnus", () => {
    const best = cheapestPerTier(cards, {
      ir1: { trend: 30, low: null, avg7: null },
      ir2: { trend: 9, low: null, avg7: null },
    });
    expect(best.IR?.id).toBe("ir2");
    expect(best.SIR?.id).toBe("sir");
  });
  it("un prix connu bat un prix inconnu", () => {
    const best = cheapestPerTier([card("a", "IR"), card("b", "IR")], { b: { trend: 500, low: null, avg7: null } });
    expect(best.IR?.id).toBe("b");
  });
});

describe("wantsLine", () => {
  it("formate et neutralise les caractères de contrôle", () =>
    expect(wantsLine({ nom_fr: "Mew\nex", set_name: "151", numero: "205", code_cm: null })).toBe("1 Mew ex (151 205)"));
  it("reprend le code Cardmarket quand il est connu", () =>
    expect(wantsLine({ nom_fr: "Bulbizarre", set_name: "151", numero: "166", code_cm: "MEW 166" })).toBe(
      "1 Bulbizarre (MEW 166)",
    ));
});
