// Logique métier pure (sans I/O) : testée dans test/logic.test.js
export const TIER_RANK = { FA: 1, IR: 2, SIR: 3 };
export const TIER_LABEL = { FA: "Full art", IR: "Illustration Rare", SIR: "Special Illustration Rare" };

/** Meilleur (moins cher) candidat de chaque tier, d'après les prix connus ; sans prix : le premier. */
export function cheapestPerTier(cards, prices) {
  const out = {};
  for (const c of cards) {
    const p = prices[c.id]?.trend ?? null;
    const cur = out[c.tier];
    const curP = cur ? prices[cur.id]?.trend ?? null : null;
    if (!cur || (p !== null && (curP === null || p < curP))) out[c.tier] = c;
  }
  return out;
}

/**
 * Statut d'une espèce :
 *  - "manquante"  : rien possédé
 *  - "complete"   : possédée, aucune version plus rare n'existe
 *  - "a_verifier" : possédée, une version plus rare existe et aucun choix « je préfère la mienne »
 *  - "choisie"    : possédée, version plus rare existante mais conservation décidée (plus de vérification)
 */
export function speciesStatus({ cards, owned, keep }) {
  if (!owned) return { status: "manquante", higher: [] };
  const rank = TIER_RANK[owned.tier] ?? 0;
  const higher = cards.filter((c) => TIER_RANK[c.tier] > rank && c.id !== owned.card_id);
  if (!higher.length) return { status: "complete", higher };
  return { status: keep ? "choisie" : "a_verifier", higher };
}

export const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

/** Format texte de liste d'envies (une carte par ligne) à coller dans Cardmarket. */
export function wantsLine(c) {
  return `1 ${c.nom_fr} (${c.set_name} ${c.numero})`;
}
