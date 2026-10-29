// État de la vue dans l'adresse (#q=…&f=…&s=…&p=25) : liens directs vers une fiche, retour arrière qui la ferme.
import type { Filter, Sort } from "./state";

export type Mode = "grille" | "classeur";

export interface ViewState {
  q: string;
  f: Filter;
  s: Sort;
  /** Affichage : grille filtrable, ou classeur 9 cases (miroir du binder physique). */
  v: Mode;
  /** Fiche ouverte (numéro de Pokédex), null si aucune. */
  p: number | null;
}

const FILTERS: readonly Filter[] = ["all", "manquante", "a_verifier", "complete", "choisie", "commande", "none"];
const SORTS: readonly Sort[] = ["num", "asc", "desc"];

export function readState(): ViewState {
  const h = new URLSearchParams(location.hash.slice(1));
  const f = h.get("f") as Filter | null;
  const s = h.get("s") as Sort | null;
  const p = Number(h.get("p"));
  return {
    v: h.get("v") === "classeur" ? "classeur" : "grille",
    q: h.get("q") ?? "",
    f: f && FILTERS.includes(f) ? f : "all",
    s: s && SORTS.includes(s) ? s : "num",
    p: Number.isInteger(p) && p >= 1 && p <= 151 ? p : null,
  };
}

function toHash(v: ViewState): string {
  const h = new URLSearchParams();
  if (v.q) h.set("q", v.q);
  if (v.f !== "all") h.set("f", v.f);
  if (v.s !== "num") h.set("s", v.s);
  if (v.v !== "grille") h.set("v", v.v);
  if (v.p) h.set("p", String(v.p));
  return h.size ? `#${h}` : location.pathname;
}

/** Remplace l'entrée courante de l'historique (filtres, recherche, fiche suivante). */
export const replaceState = (v: ViewState) => {
  history.replaceState({ pokedex: true }, "", toHash(v));
};
/** Nouvelle entrée d'historique : le bouton retour ramènera à l'état précédent (fiche fermée). */
export const pushState = (v: ViewState) => {
  history.pushState({ pokedex: true }, "", toHash(v));
};
