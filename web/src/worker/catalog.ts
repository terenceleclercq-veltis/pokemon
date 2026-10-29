// Versions ajoutées depuis le site : recherche de cartes chez TCGdex, puis ajout au catalogue (origine « site »).
import { tcgdexBriefs, tcgdexDetail, tcgdexSet } from "./schemas";

/** Hôte figé (anti-SSRF) ; réponses vérifiées par Zod. */
const API = "https://api.tcgdex.net/v2/fr";
const MAX = 150;

async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const r = await fetcher(url, {
    cf: { cacheTtl: 3600, cacheEverything: true },
    signal: AbortSignal.timeout(6000),
  }).catch(() => null);
  if (!r?.ok) return null;
  return r.json().catch(() => null);
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * Le nom de la carte contient celui de l'espèce comme mot entier : « Abra » garde « Abra » et « Méga-Abra »,
 * pas « Kadabra » ni « Simiabraz » (la recherche par nom de TCGdex cherche une sous-chaîne).
 */
export function nameMatches(card: string, species: string): boolean {
  const s = fold(species).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}])${s}($|[^\\p{L}])`, "u").test(fold(card));
}

// Séries du plus récent au plus ancien : les full arts récentes d'abord. Préfixe de l'id TCGdex, promos
// (« svp ») et sous-extensions (« sma ») comprises.
const ERAS = ["me", "sv", "swsh", "sm", "xy", "bw"];
const era = (id: string) => {
  const i = ERAS.indexOf((/^[a-z]+/.exec(id)?.[0] ?? "").replace(/[pa]$/, ""));
  return i < 0 ? ERAS.length : i;
};
// les full arts sont en fin d'extension (numéros les plus hauts)
const num = (localId: string) => Number.parseInt(localId.replace(/\D+/g, ""), 10) || 0;

export interface Candidate {
  id: string;
  name: string;
  numero: string;
  image: string | null;
}

/** Cartes TCGdex de l'espèce (par numéro de Pokédex, ou par nom exact) absentes du catalogue, récentes d'abord. */
export async function candidates(
  name: string,
  dex: number,
  known: ReadonlySet<string>,
  fetcher: typeof fetch = fetch,
): Promise<Candidate[]> {
  const list = async (u: string) => {
    const p = tcgdexBriefs.safeParse(await getJson(u, fetcher));
    return p.success ? p.data : [];
  };
  const [byDex, byName] = await Promise.all([
    list(`${API}/cards?dexId=eq:${dex}`),
    list(`${API}/cards?name=${encodeURIComponent(name)}`),
  ]);
  const out = new Map<string, Candidate>();
  for (const c of [...byDex, ...byName.filter((c) => nameMatches(c.name, name))])
    // TCG Pocket (A1-…, P-A-…) : cartes numériques, hors sujet
    if (!known.has(c.id) && !out.has(c.id) && !/^(A\d|P-A)/.test(c.id))
      out.set(c.id, { id: c.id, name: c.name, numero: c.localId, image: c.image ? `${c.image}/low.webp` : null });
  return [...out.values()]
    .sort((a, b) => era(a.id) - era(b.id) || num(b.numero) - num(a.numero) || a.id.localeCompare(b.id))
    .slice(0, MAX);
}

/** Fiche d'une carte TCGdex prête à entrer au catalogue ; null si introuvable ou réponse invalide. */
export async function cardFromTcgdex(id: string, fetcher: typeof fetch = fetch) {
  const d = tcgdexDetail.safeParse(await getJson(`${API}/cards/${encodeURIComponent(id)}`, fetcher));
  if (!d.success) return null;
  const set = tcgdexSet.safeParse(await getJson(`${API}/sets/${encodeURIComponent(d.data.set.id)}`, fetcher));
  const abbr = set.success ? set.data.abbreviation?.official : undefined;
  return {
    nom_fr: d.data.name,
    dex: d.data.dexId ?? [],
    set_name: d.data.set.name,
    numero: d.data.localId,
    id_product: d.data.pricing?.cardmarket?.idProduct ?? null,
    // code affiché par Cardmarket (« MEW 166 ») : abréviation officielle de l'extension + numéro
    code_cm: abbr ? `${abbr.split(":")[0]} ${d.data.localId}` : null,
    image: d.data.image ? `${d.data.image}/low.webp` : null,
  };
}
