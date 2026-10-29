// Logique métier pure (sans I/O).
export const TIERS = ["FA", "IR", "SIR"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_RANK: Record<Tier, number> = { FA: 1, IR: 2, SIR: 3 };
export const TIER_LABEL: Record<Tier, string> = {
  FA: "Full art",
  IR: "Illustration Rare",
  SIR: "Special Illustration Rare",
};

export interface Card {
  id: string;
  species_num: number;
  nom_fr: string;
  set_name: string;
  numero: string;
  categorie: string;
  tier: Tier;
  confiance: string;
  id_product: number | null;
  /** Code affiché par Cardmarket à côté du nom (« MEW 166 ») ; null si inconnu. */
  code_cm: string | null;
  image: string | null;
}
export interface Owned {
  species_num: number;
  card_id: string | null;
  tier: Tier;
  note: string | null;
  updated_at: string;
}
export interface Keep {
  species_num: number;
  note: string | null;
  decided_at: string;
}
export interface Price {
  trend: number | null;
  low: number | null;
  avg7: number | null;
  fetched_at?: string;
}
export type Status = "manquante" | "complete" | "a_verifier" | "choisie";

/** Carte la moins chère de chaque tier (prix inconnu = dernier choix). */
export function cheapestPerTier(cards: readonly Card[], prices: Readonly<Record<string, Price>>) {
  const out: Partial<Record<Tier, Card>> = {};
  const p = (c: Card) => prices[c.id]?.trend ?? Number.POSITIVE_INFINITY;
  for (const c of cards) {
    const cur = out[c.tier];
    if (!cur || p(c) < p(cur)) out[c.tier] = c;
  }
  return out;
}

/** Cartes strictement plus rares que celle possédée. */
export function higherThan(cards: readonly Card[], owned: Owned): Card[] {
  const rank = TIER_RANK[owned.tier];
  return cards.filter((c) => TIER_RANK[c.tier] > rank && c.id !== owned.card_id);
}

/**
 * manquante : rien possédé · complete : aucune version plus rare
 * a_verifier : plus rare existante, pas de décision · choisie : « je préfère la mienne » (plus de vérification)
 */
export function speciesStatus(cards: readonly Card[], owned: Owned | undefined, keep: Keep | undefined): Status {
  if (!owned) return "manquante";
  if (higherThan(cards, owned).length === 0) return "complete";
  return keep ? "choisie" : "a_verifier";
}

/**
 * Libellé tel que Cardmarket l'affiche : « Bulbizarre (MEW 166) », « Florizarre ex (MEW 198) ».
 * Cardmarket écrit « ex » sans tiret là où le nom français officiel en a un (« Florizarre-ex ») ;
 * « -EX » et « -GX » sont laissés tels quels. Sans code connu : extension et numéro.
 */
export function cardmarketLabel(c: Pick<Card, "nom_fr" | "set_name" | "numero" | "code_cm">): string {
  const nom = c.nom_fr.replace(/-ex(?=\s|$)/g, " ex");
  // eslint-disable-next-line no-control-regex
  return `${nom} (${c.code_cm ?? `${c.set_name} ${c.numero}`})`.replace(/[\u0000-\u001f]/g, " ");
}

/** Ligne de liste d'envies à coller dans Cardmarket. */
export function wantsLine(c: Pick<Card, "nom_fr" | "set_name" | "numero" | "code_cm">): string {
  return `1 ${cardmarketLabel(c)}`;
}
