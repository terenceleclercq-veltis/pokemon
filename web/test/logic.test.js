import test from "node:test";
import assert from "node:assert/strict";
import { cheapestPerTier, speciesStatus, isInt } from "../src/logic.js";

const cards = [
  { id: "a", tier: "FA" }, { id: "b", tier: "IR" }, { id: "c", tier: "SIR" }, { id: "d", tier: "IR" },
];
test("manquante si rien possédé", () => assert.equal(speciesStatus({ cards, owned: null }).status, "manquante"));
test("à vérifier si plus rare existe", () => assert.equal(speciesStatus({ cards, owned: { tier: "IR", card_id: "b" } }).status, "a_verifier"));
test("choix conservé après « je préfère la mienne »", () => assert.equal(speciesStatus({ cards, owned: { tier: "IR", card_id: "b" }, keep: { species_num: 1 } }).status, "choisie"));
test("complète si SIR possédée", () => assert.equal(speciesStatus({ cards, owned: { tier: "SIR", card_id: "c" } }).status, "complete"));
test("complète si aucune version plus rare dans le catalogue", () => assert.equal(speciesStatus({ cards: [cards[0]], owned: { tier: "FA", card_id: "a" } }).status, "complete"));
test("moins cher par tier", () => {
  const best = cheapestPerTier(cards, { b: { trend: 20 }, d: { trend: 9 } });
  assert.equal(best.IR.id, "d"); assert.equal(Object.keys(best).length, 3);
});
test("validation entiers", () => { assert.ok(isInt(5, 1, 151)); assert.ok(!isInt("5", 1, 151)); assert.ok(!isInt(152, 1, 151)); });
