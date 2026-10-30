// Import de commandes Cardmarket (sans DOM) : texte copié depuis les pages « Achat #… » -> achats à enregistrer.
// Les cartes sont reconnues par leur code Cardmarket (« Noadkoko (MEG 135) ») ; le port est réparti au prorata.
import type { Card, Species } from "./api";

export interface OrderItem {
  qty: number;
  /** Code tel qu'affiché par Cardmarket (« MEG 135 »). */
  code: string;
  name: string;
  /** Prix unitaire payé (€), null si introuvable dans le texte. */
  price: number | null;
}

export interface Order {
  /** Numéro de l'achat (« 1311183717 »), null si le texte n'en contient pas. */
  id: string | null;
  /** Date de la commande (AAAA-MM-JJ), null si absente. */
  date: string | null;
  shipping: number;
  /** « Valeur de l'article » annoncée, pour vérifier qu'aucune carte n'a été manquée. */
  value: number | null;
  /** La page indique une date d'arrivée. */
  arrived: boolean;
  items: OrderItem[];
}

const euros = (s: string) => Number(s.replace(/\s/g, "").replace(",", "."));
const PRICE = /(\d{1,3}(?:[ .\u202f]\d{3})*,\d{2})\s*€/;
// « Nom (MEG 135) » : abréviation d'extension (lettres et chiffres) puis numéro imprimé (« 099 », « SV049 », « TG03 »)
const ITEM = /([^\n\t()€]{1,80}?)\s*\(([A-Za-z0-9]{2,6})\s+([A-Za-z]{0,3}\d{1,4}[a-z]?)\)/g;

function field(block: string, labels: string): number | null {
  const m = new RegExp(`(?:${labels})\\s*:?\\s*${PRICE.source}`, "i").exec(block);
  return m?.[1] ? euros(m[1]) : null;
}

function parseBlock(block: string, id: string | null): Order {
  const d = /(\d{2})\.(\d{2})\.(\d{4})/.exec(block);
  // la liste des cartes commence après le sommaire : on ne cherche les cartes qu'à partir de « Pokémon Cartes »
  const start = block.search(/Pok[ée]mon\s+(Cartes|Cards|Singles)|\bNom\b|\bName\b/);
  const list = start >= 0 ? block.slice(start) : block;
  const matches = [...list.matchAll(ITEM)];
  const items = matches.map((m, i) => {
    const after = list.slice(m.index + m[0].length, matches[i + 1]?.index ?? list.length);
    const p = PRICE.exec(after);
    // quantité en tête du nom (« 2 x Bulbizarre »), ou juste avant (« 2 x⇥Bulbizarre », tableau copié)
    const q = /^\s*(?:(\d{1,3})\s*x\s+)?(.*)$/s.exec(m[1] ?? "");
    const before = /(\d{1,3})\s*x\s*$/.exec(list.slice(Math.max(0, m.index - 12), m.index));
    return {
      qty: Number(q?.[1] ?? before?.[1] ?? 1),
      code: `${(m[2] ?? "").toUpperCase()} ${(m[3] ?? "").toUpperCase()}`,
      name: (q?.[2] ?? "").trim(),
      price: p?.[1] ? euros(p[1]) : null,
    };
  });
  return {
    id,
    date: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
    shipping: field(block, "Frais de port|Shipping costs?|Shipping") ?? 0,
    value: field(block, "Valeur de l'article|Valeur des articles|Article value|Item value"),
    arrived: /\b(Arriv[ée]e|Arrived)\s*:\s*\d/.test(block),
    items,
  };
}

/** Une ou plusieurs commandes collées à la suite ; chaque « Achat #… » ouvre une nouvelle commande. */
export function parseOrders(text: string): Order[] {
  const heads = [...text.matchAll(/(?:Achat|Purchase|Commande|Order)\s*#\s*(\d{5,})/gi)];
  if (!heads.length) {
    const o = parseBlock(text, null);
    return o.items.length ? [o] : [];
  }
  return heads
    .map((h, i) => parseBlock(text.slice(h.index, heads[i + 1]?.index ?? text.length), h[1] ?? null))
    .filter((o) => o.items.length);
}

/** « MEG 099 » et « MEG 99 », « HIF SV049 » et « HIF SV49 » : même carte. */
export const normCode = (code: string) =>
  code
    .toUpperCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/(\D*)0*(\d+)([A-Z]?)$/, "$1$2$3");

export type Action = "paid" | "received" | "ordered" | "skip";

export interface ImportLine {
  order: Order;
  item: OrderItem;
  s?: Species;
  card?: Card;
  /** Prix payé à enregistrer : prix unitaire + part du port (au prorata de la valeur), arrondi au centime. */
  paid: number | null;
  /** Action proposée : prix payé de « Ma carte » si la carte est déjà au binder, sinon reçue ou commandée. */
  action: Action;
  /** Raison d'ignorer la ligne (carte inconnue, commande en cours…). */
  note?: string;
}

/** Correspondance avec le catalogue et action proposée pour chaque carte des commandes. */
export function planImport(
  orders: readonly Order[],
  species: readonly Species[],
  splitShipping: boolean,
): ImportLine[] {
  const index = new Map<string, { s: Species; card: Card }>();
  for (const s of species) for (const card of s.cards) if (card.code_cm) index.set(normCode(card.code_cm), { s, card });
  return orders.flatMap((order) => {
    const total = order.items.reduce((t, i) => t + (i.price ?? 0) * i.qty, 0);
    const ship = splitShipping ? order.shipping : 0;
    // port réparti au prorata de la valeur ; le reste d'arrondi va à la dernière carte (total exact)
    let given = 0;
    return order.items.map((item, k): ImportLine => {
      const share =
        k === order.items.length - 1
          ? Math.round((ship - given) * 100) / 100
          : total
            ? Math.round(((ship * (item.price ?? 0) * item.qty) / total) * 100) / 100
            : 0;
      given += share;
      const paid = item.price == null ? null : Math.round((item.price + share / item.qty) * 100) / 100;
      const hit = index.get(normCode(item.code));
      if (!hit) return { order, item, paid, action: "skip", note: "carte absente du catalogue" };
      const { s, card } = hit;
      if (s.owned?.card_id === card.id) return { order, item, s, card, paid, action: "paid" };
      if (s.order)
        return { order, item, s, card, paid, action: "skip", note: "une commande est déjà en cours pour cette espèce" };
      return { order, item, s, card, paid, action: order.arrived ? "received" : "ordered" };
    });
  });
}
