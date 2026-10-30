import { describe, expect, it } from "vitest";
import type { Card, Species, Tier } from "../../src/client/api";
import { buyPlan, DEFAULT_OPTIONS, type BuyOptions } from "../../src/client/buyplan";

const card = (id: string, tier: Tier, trend: number | null, avg30: number | null = null): Card => ({
  id,
  nom_fr: id,
  set_name: "S",
  numero: "1",
  code_cm: null,
  cm_label: id,
  cm_url: null,
  tier,
  categorie: tier,
  confiance: "certain",
  langue: "fr",
  excluded: false,
  image: null,
  price: trend == null ? null : { trend, low: null, avg30 },
});
const sp = (num: number, status: Species["status"], cards: Card[], extra: Partial<Species> = {}): Species => ({
  num,
  nom_fr: `E${num}`,
  nom_en: `E${num}`,
  status,
  target: null,
  wish: null,
  order: null,
  owned: null,
  keep: null,
  higher: [],
  cards,
  ...extra,
});
const ids = (o: Partial<BuyOptions>, data: Species[]) =>
  buyPlan(data, { ...DEFAULT_OPTIONS, ...o }).items.map((l) => l.card.id);

// 1 : manquante (SIR 90 visée, IR 40, FA 10) ; 2 : manquante (IR 20) ; 3 : à améliorer (IR possédée, SIR 60)
// 4 : manquante sans prix ; 5 : commandée ; 6 : complète
const DATA = [
  sp(1, "manquante", [card("1-sir", "SIR", 90, 120), card("1-ir", "IR", 40), card("1-fa", "FA", 10)], {
    target: "1-sir",
  }),
  sp(2, "manquante", [card("2-ir", "IR", 20, 21)], { target: "2-ir" }),
  sp(3, "a_verifier", [card("3-ir", "IR", 15), card("3-sir", "SIR", 60, 70)], {
    target: "3-sir",
    owned: { card_id: "3-ir", tier: "IR", note: null },
  }),
  sp(4, "manquante", [card("4-ir", "IR", null)], { target: "4-ir" }),
  sp(5, "manquante", [card("5-ir", "IR", 5)], {
    target: "5-ir",
    order: { id: 1, card_id: "5-ir", price_paid: 5, ordered_at: "" },
  }),
  sp(6, "complete", [card("6-ir", "IR", 1)], { owned: { card_id: "6-ir", tier: "IR", note: null } }),
];

describe("liste d'achat (buyPlan)", () => {
  it("objectif par défaut : une carte par espèce, prix croissant, sans prix à la fin, sans commandes ni complètes", () => {
    expect(ids({}, DATA)).toEqual(["2-ir", "3-sir", "1-sir", "4-ir"]);
  });
  it("prix max par carte : écarte les plus chères et les cartes sans prix, et les compte", () => {
    const p = buyPlan(DATA, { ...DEFAULT_OPTIONS, maxCard: 70 });
    expect(p.items.map((l) => l.card.id)).toEqual(["2-ir", "3-sir"]);
    expect([p.overCard, p.noPrice, p.total]).toEqual([1, 1, 80]);
  });
  it("budget total : dans l'ordre du tri, tant que ça tient ; combinable avec le prix max", () => {
    expect(ids({ budget: 100 }, DATA)).toEqual(["2-ir", "3-sir"]);
    expect(ids({ budget: 100, sort: "desc" }, DATA)).toEqual(["1-sir"]);
    const p = buyPlan(DATA, { ...DEFAULT_OPTIONS, budget: 100, maxCard: 50 });
    expect([p.items.length, p.overCard, p.overBudget]).toEqual([1, 2, 0]);
  });
  it("carte retenue : la moins chère, ou une rareté (au-dessus de la carte possédée pour une amélioration)", () => {
    expect(ids({ choice: "cheapest" }, DATA)).toEqual(["1-fa", "2-ir", "3-sir", "4-ir"]);
    expect(ids({ choice: "IR" }, DATA)).toEqual(["2-ir", "1-ir", "4-ir"]); // 3 : IR déjà possédée
    expect(ids({ choice: "FA" }, DATA)).toEqual(["1-fa"]);
  });
  it("la version visée est toujours celle proposée, jamais une autre version de l'espèce", () => {
    const data = [
      sp(7, "manquante", [card("7-a", "IR", 5), card("7-b", "IR", 9), card("7-s", "SIR", 50)], {
        wish: "7-b",
        target: "7-b",
      }),
    ];
    expect(ids({}, data)).toEqual(["7-b"]);
    expect(ids({ choice: "cheapest" }, data)).toEqual(["7-b"]);
    expect(ids({ choice: "IR" }, data)).toEqual(["7-b"]);
    expect(ids({ choice: "SIR" }, data)).toEqual([]); // pas de SIR de remplacement
  });
  it("prix min par carte : écarte les moins chères, combinable avec le prix max", () => {
    const p = buyPlan(DATA, { ...DEFAULT_OPTIONS, minCard: 50 });
    expect(p.items.map((l) => l.card.id)).toEqual(["3-sir", "1-sir"]);
    expect([p.underCard, p.noPrice]).toEqual([1, 1]);
    expect(ids({ minCard: 50, maxCard: 70 }, DATA)).toEqual(["3-sir"]);
  });
  it("espèces : sans carte seulement, ou à améliorer seulement", () => {
    expect(ids({ scope: "missing" }, DATA)).toEqual(["2-ir", "1-sir", "4-ir"]);
    expect(ids({ scope: "upgrades" }, DATA)).toEqual(["3-sir"]);
  });
  it("bonnes affaires seulement, et tri par meilleure affaire", () => {
    expect(ids({ dealsOnly: true }, DATA)).toEqual(["3-sir", "1-sir"]);
    expect(ids({ sort: "deal" }, DATA).slice(0, 3)).toEqual(["1-sir", "3-sir", "2-ir"]); // −25 %, −14 %, −5 %
  });
});
