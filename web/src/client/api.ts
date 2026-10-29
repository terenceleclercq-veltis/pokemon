// Client HTTP : en-tête anti-CSRF systématique, erreurs typées.
export type Tier = "FA" | "IR" | "SIR";
export interface Price {
  trend: number | null;
  low: number | null;
  avg7?: number | null;
  image?: string | null;
}
export interface Card {
  id: string;
  nom_fr: string;
  set_name: string;
  numero: string;
  code_cm: string | null;
  /** Libellé exact de la recherche Cardmarket, calculé par le serveur. */
  cm_label: string;
  /** Page Cardmarket de la version exacte ; null si idProduct inconnu. */
  cm_url: string | null;
  tier: Tier;
  /** Catégorie du catalogue (IR, FA_GX, CHR, SHINY…). */
  categorie: string;
  confiance: string;
  /** « fr », ou autre langue seulement si l'espèce n'a aucune IR/SIR en français. */
  langue: string;
  image: string | null;
  price: Price | null;
}
export interface Species {
  num: number;
  nom_fr: string;
  status: "manquante" | "complete" | "a_verifier" | "choisie";
  owned: { card_id: string | null; tier: Tier; note: string | null } | null;
  keep: { decided_at: string } | null;
  higher: string[];
  cards: Card[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  headers.set("X-Requested-With", "pokedex");
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const r = await fetch(path, {
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    credentials: "same-origin",
  });
  if (!r.ok) {
    const msg = ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? r.statusText;
    throw new ApiError(r.status === 401 ? "Session expirée : recharge la page." : msg, r.status);
  }
  return r;
}
