// État partagé du client et règles d'affichage (sans DOM) : images, objectif, recherche, tri.
import type { Card, Species, Tier } from "./api";

export const TIERS_DESC: Tier[] = ["SIR", "IR", "FA"];
export const TIER_LABEL: Record<Tier, string> = {
  FA: "Full art",
  IR: "Illustration Rare",
  SIR: "Special Illustration Rare",
};
export const STATUS_LABEL: Record<Species["status"], string> = {
  manquante: "À acheter",
  a_verifier: "À améliorer",
  complete: "Complète",
  choisie: "Choix conservé",
};
/** Cartes hors français : ajoutées seulement quand l'espèce n'a aucune IR/SIR en français. */
const LANGUE_LABEL: Record<string, string> = { ja: "Japonaise" };
export const langueOf = (langue: string) => (langue === "fr" ? null : (LANGUE_LABEL[langue] ?? langue.toUpperCase()));
/** Cartes de repli, signalées comme telles. */
export const CATEGORIE_NOTE: Record<string, string> = {
  CHR: "Character Rare",
  SHINY: "Chromatique, pas full art",
};

export const store: { data: Species[] } = { data: [] };
export const byNum = (n: number) => store.data.find((s) => s.num === n);

/** Miniature de la carte (TCGdex, ~25 Ko) ; null si TCGdex n'a pas encore d'image. */
export const cardImg = (c: Card) => c.image ?? c.price?.image ?? null;
/** Version haute définition (~100 Ko) pour la visionneuse. */
export const cardImgHigh = (c: Card) => cardImg(c)?.replace(/\/low\.webp$/, "/high.webp") ?? null;
/** Illustration du Pokémon (dépôt public PokéAPI, SVG ~30 Ko), quand aucune carte n'a d'image. */
export const artImg = (num: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/dream-world/${num}.svg`;

export const targetOf = (s: Species) => (s.target ? s.cards.find((c) => c.id === s.target) : undefined);
export const ownedCard = (s: Species) =>
  s.owned?.card_id ? s.cards.find((c) => c.id === s.owned?.card_id) : undefined;
/** Prix de la carte visée (ce qu'il reste à payer pour cette espèce). */
export const targetPrice = (s: Species) => targetOf(s)?.price?.trend ?? null;

/** Tirage au sort mémorisé pour la session : l'image d'une tuile ne change qu'au rechargement de la page. */
const pick = new Map<number, string>();

export interface Visual {
  src: string;
  /** owned : ta carte · sir / fa : une carte tirée au hasard · art : illustration du Pokémon */
  kind: "owned" | "sir" | "fa" | "art";
  card?: Card;
}

/**
 * Image d'une espèce : ta carte, sinon la version que tu vises, sinon une SIR au hasard, sinon une full art au
 * hasard (versions écartées exclues), sinon l'illustration du Pokémon.
 */
export function visualOf(s: Species): Visual {
  const mine = ownedCard(s);
  const mineSrc = mine && cardImg(mine);
  if (mine && mineSrc) return { src: mineSrc, kind: "owned", card: mine };
  const wished = s.wish ? s.cards.find((c) => c.id === s.wish) : undefined;
  const wishedSrc = wished && cardImg(wished);
  if (wished && wishedSrc) return { src: wishedSrc, kind: wished.tier === "SIR" ? "sir" : "fa", card: wished };
  const shown = s.cards.filter((c) => !c.excluded && cardImg(c));
  const sir = shown.filter((c) => c.tier === "SIR");
  const pool = sir.length ? sir : shown.filter((c) => c.categorie !== "SHINY");
  if (pool.length) {
    let card = pool.find((c) => c.id === pick.get(s.num));
    if (!card) {
      card = pool[Math.floor(Math.random() * pool.length)]!;
      pick.set(s.num, card.id);
    }
    return { src: cardImg(card)!, kind: sir.length ? "sir" : "fa", card };
  }
  return { src: artImg(s.num), kind: "art" };
}

/** Texte comparable : minuscules, sans accents (« Salamèche » = « salameche »). */
export const fold = (t: string) =>
  t
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const haystacks = new WeakMap<Species, string>();
function haystack(s: Species): string {
  let h = haystacks.get(s);
  if (h === undefined) {
    h = fold(
      [
        s.nom_fr,
        s.nom_en,
        ...s.cards.flatMap((c) => [c.nom_fr, c.set_name, c.code_cm ?? "", c.cm_label, c.illustrateur ?? ""]),
      ].join(" "),
    );
    haystacks.set(s, h);
  }
  return h;
}

/**
 * « 25 » ou « #025 » : numéro exact ; sinon chaque mot doit figurer dans le nom (FR ou anglais) ou une carte
 * (nom, extension, code Cardmarket, illustrateur).
 */
export function matches(s: Species, query: string): boolean {
  const q = fold(query.trim());
  if (!q) return true;
  const n = /^#?0*(\d{1,3})$/.exec(q);
  if (n && Number(n[1]) <= 151) return s.num === Number(n[1]);
  const h = haystack(s);
  return q.split(/\s+/).every((w) => h.includes(w));
}

export type Filter = "all" | "manquante" | "a_verifier" | "complete" | "choisie" | "commande" | "alertes" | "none";

/** Alerte déclenchée : la tendance est passée sous le prix maximum fixé (versions écartées ignorées). */
export const alertHit = (c: Card) =>
  c.alert != null && !c.excluded && c.price?.trend != null && c.price.trend <= c.alert;
export type Sort = "num" | "asc" | "desc";

export function passes(s: Species, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "none") return s.cards.length === 0;
  if (f === "commande") return s.order !== null;
  if (f === "alertes") return s.cards.some(alertHit);
  // une espèce commandée n'est plus « à acheter » ni « à améliorer »
  if (f === "manquante" || f === "a_verifier") return s.cards.length > 0 && s.status === f && !s.order;
  return s.cards.length > 0 && s.status === f;
}

/** Tri par prix de la carte visée ; les espèces sans prix (terminées, sans carte, prix inconnu) à la fin. */
export function sortSpecies(list: Species[], sort: Sort): Species[] {
  if (sort === "num") return list;
  const dir = sort === "asc" ? 1 : -1;
  return [...list].sort((a, b) => {
    const pa = targetPrice(a);
    const pb = targetPrice(b);
    if (pa == null || pb == null) return pa == null ? (pb == null ? a.num - b.num : 1) : -1;
    return dir * (pa - pb) || a.num - b.num;
  });
}

export function stats(data: Species[]) {
  const count = (f: (s: Species) => boolean) => data.filter(f).length;
  return {
    done: count((s) => s.status === "complete" || s.status === "choisie"),
    toBuy: count((s) => s.status === "manquante" && s.cards.length > 0 && !s.order),
    toUpgrade: count((s) => s.status === "a_verifier" && !s.order),
    ordered: count((s) => s.order !== null),
    alerts: count((s) => s.cards.some(alertHit)),
    none: count((s) => s.cards.length === 0),
    /** Reste à payer pour atteindre l'objectif partout (cartes au prix connu, hors commandes en cours). */
    remaining: data.reduce((t, s) => t + (s.order ? 0 : (targetPrice(s) ?? 0)), 0),
  };
}

/** Bon prix : la tendance est au moins 10 % sous la moyenne des ventes sur 30 jours. */
export const goodDeal = (c: Card) => {
  const p = c.price;
  return p?.trend != null && p.avg30 != null && p.avg30 > 0 && p.trend <= p.avg30 * 0.9;
};

/** Emplacement dans un classeur 9 cases, dans l'ordre du Pokédex : page et case (1 à 9, de gauche à droite). */
export const slotOf = (num: number) => ({ page: Math.ceil(num / 9), case: ((num - 1) % 9) + 1 });

/** États de la grille Cardmarket. */
export const CONDITIONS: Record<string, string> = {
  MT: "Mint",
  NM: "Near Mint",
  EX: "Excellent",
  GD: "Good",
  LP: "Light Played",
  PL: "Played",
  PO: "Poor",
};

/** « 29/10 » depuis une date ISO. */
export const shortDate = (iso: string | undefined | null) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");
