import { describe, expect, it } from "vitest";
import { availableNow, budgetMonths, monthRange, type PurchaseLike } from "../../src/client/budget";

const buy = (ordered_at: string, price_paid: number | null, state: PurchaseLike["state"] = "recue"): PurchaseLike => ({
  state,
  price_paid,
  ordered_at,
});
const NOW = new Date(2026, 9, 30); // 30 octobre 2026

describe("budget mensuel avec report", () => {
  it("mois consécutifs, passage d'année compris", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });
  it("sans budget : dépenses par mois sur 12 mois, annulées exclues", () => {
    const rows = budgetMonths(
      { monthly: null, since: null },
      [
        buy("2026-10-29T12:00:00.000Z", 94.29),
        buy("2026-10-01T12:00:00.000Z", 5, "annulee"),
        buy("2026-08-15T12:00:00.000Z", 10, "commandee"),
      ],
      NOW,
    );
    expect(rows).toHaveLength(12);
    expect(rows[0]?.month).toBe("2025-11");
    expect(rows.at(-1)).toEqual({ month: "2026-10", spent: 94.29, available: null, carried: null, balance: null });
    expect(rows.find((r) => r.month === "2026-08")?.spent).toBe(10);
    expect(availableNow(rows)).toBeNull();
  });
  it("le non-dépensé est reporté ; un dépassement réduit le mois suivant", () => {
    const rows = budgetMonths(
      { monthly: 50, since: "2026-08" },
      [
        buy("2026-08-10T12:00:00.000Z", 20), // reste 30
        buy("2026-09-10T12:00:00.000Z", 100), // 50 + 30 - 100 = -20
        buy("2026-10-29T12:00:00.000Z", 10), // 50 - 20 - 10 = 20
      ],
      NOW,
    );
    const by = (m: string) => rows.find((r) => r.month === m);
    expect(by("2026-07")).toMatchObject({ available: null });
    expect(by("2026-08")).toMatchObject({ available: 50, carried: 0, balance: 30 });
    expect(by("2026-09")).toMatchObject({ available: 80, carried: 30, balance: -20 });
    expect(by("2026-10")).toMatchObject({ available: 30, carried: -20, balance: 20 });
    expect(availableNow(rows)).toBe(20);
  });
  it("budget commencé avant la période affichée : le report remonte jusqu'au début", () => {
    const rows = budgetMonths({ monthly: 10, since: "2024-01" }, [], NOW);
    expect(rows.at(-1)?.available).toBe(340); // 34 mois de 10 €, rien dépensé
  });
  it("budget qui commence dans le futur : pas encore de disponible", () => {
    expect(availableNow(budgetMonths({ monthly: 10, since: "2026-12" }, [], NOW))).toBeNull();
  });
});
