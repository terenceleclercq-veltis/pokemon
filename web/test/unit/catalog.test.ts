import { describe, expect, it } from "vitest";
import { nameMatches } from "../../src/worker/catalog";

describe("nameMatches (recherche de versions par nom)", () => {
  it("garde le nom exact et ses variantes, pas les noms qui le contiennent", () => {
    expect(nameMatches("Abra", "Abra")).toBe(true);
    expect(nameMatches("Méga-Abra", "Abra")).toBe(true);
    expect(nameMatches("Kadabra", "Abra")).toBe(false);
    expect(nameMatches("Simiabraz-ex", "Abra")).toBe(false);
    expect(nameMatches("Mew-ex", "Mew")).toBe(true);
    expect(nameMatches("Mewtwo", "Mew")).toBe(false);
    expect(nameMatches("Rattatac", "Rattata")).toBe(false);
  });
  it("insensible aux accents et à la casse ; symboles et points conservés", () => {
    expect(nameMatches("Évoli de Sacha", "Evoli")).toBe(true);
    expect(nameMatches("Nidoran♀", "Nidoran♀")).toBe(true);
    expect(nameMatches("Nidoran♂", "Nidoran♀")).toBe(false);
    expect(nameMatches("M. Mime", "M. Mime")).toBe(true);
    expect(nameMatches("MxMime", "M. Mime")).toBe(false);
  });
});
