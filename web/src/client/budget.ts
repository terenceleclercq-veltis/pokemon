// Budget mensuel avec report (sans DOM) : ce qui n'est pas dépensé un mois s'ajoute au suivant, un dépassement
// se retire du suivant. Dépenses = achats non annulés, au mois de la commande.

export interface Budget {
  /** Montant par mois, null s'il n'y a pas de budget. */
  monthly: number | null;
  /** Premier mois du budget (AAAA-MM). */
  since: string | null;
}

export interface PurchaseLike {
  state: "commandee" | "recue" | "annulee";
  price_paid: number | null;
  ordered_at: string;
}

export interface MonthRow {
  /** AAAA-MM */
  month: string;
  spent: number;
  /** Disponible ce mois : budget du mois + report du solde précédent ; null hors budget. */
  available: number | null;
  /** Report reçu du mois précédent (positif : non dépensé ; négatif : dépassement). */
  carried: number | null;
  /** Solde en fin de mois (reporté au suivant). */
  balance: number | null;
}

const round = (v: number) => Math.round(v * 100) / 100;
export const monthOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** Mois de « from » à « to » compris (AAAA-MM). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

/** Dépenses et budget des « span » derniers mois (le mois courant en dernier). */
export function budgetMonths(budget: Budget, purchases: readonly PurchaseLike[], now: Date, span = 12): MonthRow[] {
  const current = monthOf(now);
  const spent = new Map<string, number>();
  for (const p of purchases)
    if (p.state !== "annulee")
      spent.set(p.ordered_at.slice(0, 7), (spent.get(p.ordered_at.slice(0, 7)) ?? 0) + (p.price_paid ?? 0));
  const start = monthOf(new Date(now.getFullYear(), now.getMonth() - (span - 1), 1));
  // soldes depuis le début du budget (qui peut être antérieur à la période affichée)
  const balances = new Map<string, { available: number; carried: number; balance: number }>();
  if (budget.monthly != null && budget.since && budget.since <= current) {
    let carry = 0;
    for (const m of monthRange(budget.since, current)) {
      const available = round(budget.monthly + carry);
      const balance = round(available - (spent.get(m) ?? 0));
      balances.set(m, { available, carried: round(carry), balance });
      carry = balance;
    }
  }
  return monthRange(start, current).map((month) => {
    const b = balances.get(month);
    return {
      month,
      spent: round(spent.get(month) ?? 0),
      available: b?.available ?? null,
      carried: b?.carried ?? null,
      balance: b?.balance ?? null,
    };
  });
}

/** Disponible pour le mois en cours (solde après les achats du mois), null sans budget. */
export const availableNow = (rows: readonly MonthRow[]) => rows.at(-1)?.balance ?? null;
