// Liste d'achat (sans DOM) : quelle carte acheter pour chaque espèce, selon des réglages indépendants.
// Une seule carte par espèce ; les espèces commandées ou terminées n'y figurent pas.
import type { Card, Species, Tier } from "./api";
import { goodDeal } from "./state";

/** Carte retenue par espèce : l'objectif (SIR si elle existe), la moins chère, ou une rareté précise. */
export type Choice = "objectif" | "cheapest" | Tier;
/** Espèces : sans carte dans le binder, à améliorer (une version plus rare existe), ou les deux. */
export type Scope = "all" | "missing" | "upgrades";
export type BuySort = "asc" | "desc" | "num" | "deal";

export interface BuyOptions {
  choice: Choice;
  scope: Scope;
  sort: BuySort;
  /** Prix minimum d'une carte : les moins chères sont écartées. */
  minCard: number | null;
  /** Prix maximum d'une carte : les plus chères sont écartées. */
  maxCard: number | null;
  /** Budget total : cartes prises dans l'ordre affiché tant que le total tient dedans. */
  budget: number | null;
  /** Seulement les cartes au moins 10 % sous leur moyenne 30 jours. */
  dealsOnly: boolean;
}

export const DEFAULT_OPTIONS: BuyOptions = {
  choice: "objectif",
  scope: "all",
  sort: "asc",
  minCard: null,
  maxCard: null,
  budget: null,
  dealsOnly: false,
};

export interface BuyLine {
  s: Species;
  card: Card;
  /** Remplace une carte déjà possédée d'une rareté inférieure. */
  upgrade: boolean;
  trend: number | null;
  /** Écart sous la moyenne 30 jours (0,15 = 15 % moins cher), null si inconnu. */
  off: number | null;
}

export interface BuyPlan {
  items: BuyLine[];
  total: number;
  /** Cartes écartées par le prix minimum par carte. */
  underCard: number;
  /** Cartes écartées par le prix maximum par carte. */
  overCard: number;
  /** Cartes qui ne tiennent plus dans le budget total. */
  overBudget: number;
  /** Cartes sans prix connu, écartées dès qu'un prix maximum ou un budget est fixé. */
  noPrice: number;
}

const RANK: Record<Tier, number> = { FA: 1, IR: 2, SIR: 3 };
const price = (c: Card) => c.price?.trend ?? null;
const cheapest = (cards: Card[]) => [...cards].sort((a, b) => (price(a) ?? Infinity) - (price(b) ?? Infinity))[0];

/**
 * Carte retenue pour une espèce, ou undefined si aucune ne correspond au choix. La version visée par Terence est
 * toujours celle proposée, jamais une autre version de l'espèce (une rareté demandée qui n'est pas la sienne écarte
 * l'espèce).
 */
function pick(s: Species, choice: Choice): Card | undefined {
  const wished = s.wish ? s.cards.find((c) => c.id === s.wish) : undefined;
  if (wished) return choice === "objectif" || choice === "cheapest" || wished.tier === choice ? wished : undefined;
  if (choice === "objectif") return s.target ? s.cards.find((c) => c.id === s.target) : undefined;
  // amélioration : seulement une rareté au-dessus de la carte possédée
  const floor = s.owned ? RANK[s.owned.tier] : 0;
  const pool = s.cards.filter((c) => !c.excluded && RANK[c.tier] > floor);
  return cheapest(choice === "cheapest" ? pool : pool.filter((c) => c.tier === choice));
}

function inScope(s: Species, scope: Scope): boolean {
  if (s.order || !s.cards.length) return false;
  if (s.status === "manquante") return scope !== "upgrades";
  if (s.status === "a_verifier") return scope !== "missing";
  return false;
}

const SORTS: Record<BuySort, (a: BuyLine, b: BuyLine) => number> = {
  asc: (a, b) => (a.trend ?? Infinity) - (b.trend ?? Infinity) || a.s.num - b.s.num,
  desc: (a, b) => (b.trend ?? -Infinity) - (a.trend ?? -Infinity) || a.s.num - b.s.num,
  num: (a, b) => a.s.num - b.s.num,
  deal: (a, b) => (b.off ?? -Infinity) - (a.off ?? -Infinity) || a.s.num - b.s.num,
};

export function buyPlan(species: readonly Species[], o: BuyOptions): BuyPlan {
  const lines = species.flatMap((s): BuyLine[] => {
    if (!inScope(s, o.scope)) return [];
    const card = pick(s, o.choice);
    if (!card) return [];
    if (o.dealsOnly && !goodDeal(card)) return [];
    const trend = price(card);
    const avg = card.price?.avg30;
    return [{ s, card, upgrade: s.status === "a_verifier", trend, off: trend != null && avg ? 1 - trend / avg : null }];
  });
  lines.sort(SORTS[o.sort]);
  const plan: BuyPlan = { items: [], total: 0, underCard: 0, overCard: 0, overBudget: 0, noPrice: 0 };
  const limited = o.minCard != null || o.maxCard != null || o.budget != null;
  for (const l of lines) {
    if (l.trend == null) {
      if (limited) plan.noPrice++;
      else plan.items.push(l);
    } else if (o.minCard != null && l.trend < o.minCard) plan.underCard++;
    else if (o.maxCard != null && l.trend > o.maxCard) plan.overCard++;
    else if (o.budget != null && plan.total + l.trend > o.budget + 1e-9) plan.overBudget++;
    else {
      plan.total += l.trend;
      plan.items.push(l);
    }
  }
  plan.total = Math.round(plan.total * 100) / 100;
  return plan;
}
