// Tableau de bord : progression par objectif, valeur de la collection, dépenses, meilleures affaires.
import { api, type Card, type Species, type Tier } from "./api";
import { bars } from "./chart";
import { $, $as, action, eur, h, pad } from "./dom";
import { alertHit, cardImg, goodDeal, ownedCard, stats, store, targetOf, TIER_LABEL } from "./state";

interface PurchaseRow {
  state: "commandee" | "recue" | "annulee";
  price_paid: number | null;
  ordered_at: string;
}

const RANK: Record<Tier, number> = { FA: 1, IR: 2, SIR: 3 };
const objective = (s: Species): Tier | null =>
  s.cards
    .filter((c) => !c.excluded)
    .reduce<Tier | null>((best, c) => (!best || RANK[c.tier] > RANK[best] ? c.tier : best), null);

function progress(data: Species[]): HTMLElement {
  const rows = (["SIR", "IR", "FA"] as Tier[]).map((t) => {
    const group = data.filter((s) => objective(s) === t);
    const done = group.filter((s) => s.status === "complete" || s.status === "choisie").length;
    return h(
      "tr",
      {},
      h("th", { scope: "row" }, `Objectif ${TIER_LABEL[t]}`),
      h("td", {}, `${done} / ${group.length}`),
      h("td", {}, h("progress", { max: group.length || 1, value: done })),
    );
  });
  const none = data.filter((s) => !s.cards.length).length;
  return h(
    "section",
    {},
    h("h3", {}, "Progression"),
    h(
      "table",
      { class: "stats" },
      h("tbody", {}, ...rows, h("tr", {}, h("th", { scope: "row" }, "Sans carte"), h("td", {}, String(none)), h("td"))),
    ),
  );
}

const cardRow = (s: Species, c: Card, extra: string) =>
  h(
    "li",
    { class: "buy" },
    cardImg(c)
      ? h("img", { src: cardImg(c)!, alt: "", loading: "lazy", decoding: "async", width: 44, height: 61 })
      : h("span", { class: "ph" }, "?"),
    h(
      "div",
      { class: "grow" },
      h("button", { type: "button", class: "link", "data-num": s.num }, `${pad(s.num)} ${s.nom_fr}`),
      h("div", { class: "mut" }, c.cm_label),
    ),
    h("strong", { class: "price" }, extra),
  );

function value(data: Species[]): HTMLElement {
  const owned = data.flatMap((s) => {
    const c = ownedCard(s);
    return c ? [{ s, c, v: c.price?.trend ?? 0 }] : [];
  });
  const total = owned.reduce((t, x) => t + x.v, 0);
  const top = [...owned].sort((a, b) => b.v - a.v).slice(0, 5);
  return h(
    "section",
    {},
    h("h3", {}, "Ta collection"),
    h("p", {}, `Valeur estimée : `, h("strong", {}, eur(total)), ` (${owned.length} cartes, prix tendance)`),
    top.length ? h("ol", { class: "buylist" }, ...top.map((x) => cardRow(x.s, x.c, eur(x.v)))) : null,
  );
}

function spending(rows: PurchaseRow[], data: Species[]): HTMLElement {
  // cartes du binder ajoutées par « Je l'ai » sans prix payé : absentes des dépenses
  const unpriced = data.filter((s) => s.owned?.card_id && s.owned.paid == null);
  const kept = rows.filter((r) => r.state !== "annulee");
  const spent = kept.reduce((t, r) => t + (r.price_paid ?? 0), 0);
  const pending = kept.filter((r) => r.state === "commandee");
  const months = new Map<string, number>();
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, 0);
  }
  for (const r of kept) {
    const m = r.ordered_at.slice(0, 7);
    if (months.has(m)) months.set(m, (months.get(m) ?? 0) + (r.price_paid ?? 0));
  }
  const label = (m: string) => `${m.slice(5, 7)}/${m.slice(2, 4)}`;
  return h(
    "section",
    {},
    h("h3", {}, "Dépenses"),
    h(
      "p",
      {},
      `Total : `,
      h("strong", {}, eur(spent)),
      ` sur ${kept.length} achat${kept.length > 1 ? "s" : ""}${pending.length ? ` (dont ${pending.length} en commande)` : ""}.`,
    ),
    kept.length
      ? bars([...months].map(([m, v]) => [label(m), v]))
      : h("p", { class: "mut" }, "Aucun achat enregistré."),
    unpriced.length
      ? h(
          "p",
          { class: "mut" },
          `${unpriced.length} carte${unpriced.length > 1 ? "s" : ""} du binder sans prix payé (non comptée${
            unpriced.length > 1 ? "s" : ""
          }) : renseigne-le dans « Ma carte » de la fiche. `,
          ...unpriced
            .slice(0, 12)
            .flatMap((x, i) => [
              i ? ", " : "",
              h("button", { type: "button", class: "link", "data-num": x.num }, x.nom_fr),
            ]),
          unpriced.length > 12 ? "…" : "",
        )
      : null,
  );
}

function deals(data: Species[]): HTMLElement | null {
  const list = data
    .flatMap((s) => {
      const c = targetOf(s);
      return c && !s.order && goodDeal(c) ? [{ s, c, off: 1 - (c.price?.trend ?? 0) / (c.price?.avg30 ?? 1) }] : [];
    })
    .sort((a, b) => b.off - a.off)
    .slice(0, 8);
  if (!list.length) return null;
  return h(
    "section",
    {},
    h("h3", {}, "Bonnes affaires parmi tes cartes visées"),
    h(
      "ol",
      { class: "buylist" },
      ...list.map((x) => cardRow(x.s, x.c, `${eur(x.c.price?.trend)} (−${Math.round(x.off * 100)} %)`)),
    ),
  );
}

function alerts(data: Species[]): HTMLElement | null {
  const list = data
    .flatMap((s) => s.cards.filter((c) => c.alert != null).map((c) => ({ s, c, hit: alertHit(c) })))
    .sort((a, b) => Number(b.hit) - Number(a.hit) || a.s.num - b.s.num);
  if (!list.length) return null;
  return h(
    "section",
    {},
    h("h3", {}, "Alertes de prix"),
    h(
      "ol",
      { class: "buylist" },
      ...list.map((x) => cardRow(x.s, x.c, `${x.hit ? "🔔 " : ""}${eur(x.c.price?.trend)} / max ${eur(x.c.alert)}`)),
    ),
  );
}

export async function renderDashboard(): Promise<void> {
  const data = store.data;
  const st = stats(data);
  const { purchases } = (await (await api("/api/purchases")).json()) as { purchases: PurchaseRow[] };
  $("stats-body").replaceChildren(
    h(
      "p",
      { class: "lead" },
      `${st.done}/151 complètes · reste à payer pour l'objectif ≈ `,
      h("strong", {}, eur(st.remaining)),
    ),
    ...[progress(data), alerts(data), value(data), deals(data), spending(purchases, data)].filter(
      (x): x is HTMLElement => x !== null,
    ),
  );
}

export function initDashboard(open: (num: number) => void): void {
  $("btn-stats").addEventListener("click", () => {
    $as("stats", HTMLDialogElement).showModal();
    action(null, renderDashboard);
  });
  // un nom d'espèce dans le tableau de bord ouvre sa fiche
  $("stats-body").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-num]");
    if (!b) return;
    $as("stats", HTMLDialogElement).close();
    open(Number(b.dataset.num));
  });
}
