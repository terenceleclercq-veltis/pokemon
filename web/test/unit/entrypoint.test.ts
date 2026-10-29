import { describe, expect, it } from "vitest";
import * as entry from "../../src/worker/index";

// Garde-fou : une exportation non-handler fait échouer le démarrage de workerd (vu en E2E).
describe("point d'entrée", () => {
  it("n'exporte que le handler par défaut", () => {
    expect(Object.keys(entry)).toEqual(["default"]);
    expect(typeof entry.default.fetch).toBe("function");
    expect(typeof entry.default.scheduled).toBe("function");
  });
});
