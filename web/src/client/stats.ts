// Tableau de bord : chiffres clés, budget et dépenses (avec report), reste à payer détaillé, progression,
// alertes, collection, bonnes affaires.
import { api, type Card, type Species, type Tier } from "./api";
import { availableNow, budgetMonths, type MonthRow } from "./budget";
import { monthLabel, spendChart } from "./chart";
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
    { class: "card-sec" },
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
    { class: "card-sec" },
    h("h3", {}, "Ta collection"),
    h("p", {}, `Valeur estimée : `, h("strong", {}, eur(total)), ` (${owned.length} cartes, prix tendance)`),
    top.length ? h("ol", { class: "buylist" }, ...top.map((x) => cardRow(x.s, x.c, eur(x.v)))) : null,
  );
}

/** Budget et dépenses : disponible ce mois (avec report), graphique sur 12 mois, cartes sans prix payé. */
function spending(rows: PurchaseRow[], data: Species[]): HTMLElement {
  const months = budgetMonths(store.budget, rows, new Date());
  const kept = rows.filter((r) => r.state !== "annulee");
  const spent = kept.reduce((t, r) => t + (r.price_paid ?? 0), 0);
  const pending = kept.filter((r) => r.state === "commandee");
  const now = months.at(-1);
  // cartes du binder ajoutées par « Je l'ai » sans prix payé : absentes des dépenses
  const unpriced = data.filter((s) => s.owned?.card_id && s.owned.paid == null);
  return h(
    "section",
    { class: "card-sec" },
    h("h3", {}, "Budget et dépenses"),
    budgetLine(now),
    h(
      "p",
      { class: "mut" },
      `Total dépensé : ${eur(spent)} sur ${kept.length} achat${kept.length > 1 ? "s" : ""}${
        pending.length ? ` (dont ${pending.length} en commande)` : ""
      }.`,
    ),
    kept.length || store.budget.monthly
      ? h(
          "figure",
          { class: "chart" },
          spendChart(months),
          h(
            "figcaption",
            { class: "legend" },
            h("span", { class: "sw spent" }),
            " dépensé",
            store.budget.monthly ? h("span", { class: "sw budget" }) : null,
            store.budget.monthly ? " disponible (budget + report)" : "",
          ),
        )
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

/** Ce mois-ci : dépensé, disponible et report ; invitation à fixer un budget s'il n'y en a pas. */
function budgetLine(now: MonthRow | undefined): HTMLElement {
  if (!now || now.available == null)
    return h(
      "p",
      {},
      `Ce mois-ci (${monthLabel(now?.month ?? "")}) : `,
      h("strong", {}, eur(now?.spent ?? 0)),
      " dépensés. ",
      h("button", { type: "button", class: "link", "data-open": "settings" }, "Fixer un budget mensuel"),
    );
  const left = now.balance ?? 0;
  const fill = h("span", { class: `fill${left < 0 ? " over" : ""}` });
  fill.style.width = `${Math.min(100, now.available > 0 ? (now.spent / now.available) * 100 : 100)}%`;
  return h(
    "div",
    { class: "budget-now" },
    h(
      "div",
      { class: "meter", role: "img", "aria-label": `${eur(now.spent)} dépensés sur ${eur(now.available)} disponibles` },
      fill,
    ),
    h(
      "p",
      {},
      h("strong", {}, left >= 0 ? `${eur(left)} disponibles` : `${eur(-left)} de dépassement`),
      ` ce mois-ci : ${eur(now.spent)} dépensés sur ${eur(now.available)}`,
      now.carried ? ` (dont report ${now.carried > 0 ? "+" : "−"}${eur(Math.abs(now.carried))})` : "",
      ". ",
      h("button", { type: "button", class: "link", "data-open": "settings" }, "Modifier le budget"),
    ),
  );
}

/** Reste à payer pour l'objectif : total, les cartes les plus chères, et l'alternative « la moins chère ». */
function remaining(data: Species[]): HTMLElement {
  const lines = data
    .flatMap((s) => {
      const c = targetOf(s);
      return c && !s.order ? [{ s, c, p: c.price?.trend ?? null }] : [];
    })
    .sort((a, b) => (b.p ?? 0) - (a.p ?? 0));
  const total = lines.reduce((t, l) => t + (l.p ?? 0), 0);
  const top = lines.slice(0, 10);
  const topSum = top.reduce((t, l) => t + (l.p ?? 0), 0);
  const noPrice = lines.filter((l) => l.p == null).length;
  // même espèces, mais la version la moins chère de chacune (toutes raretés au-dessus de la carte possédée)
  const RANKS: Record<Tier, number> = { FA: 1, IR: 2, SIR: 3 };
  const cheapest = lines.reduce((t, { s }) => {
    const floor = s.owned ? RANKS[s.owned.tier] : 0;
    const ps = s.cards.flatMap((c) =>
      !c.excluded && RANKS[c.tier] > floor && c.price?.trend != null ? [c.price.trend] : [],
    );
    return ps.length ? t + Math.min(...ps) : t;
  }, 0);
  const upgrades = lines.filter((l) => l.s.status === "a_verifier");
  return h(
    "section",
    { class: "card-sec" },
    h("h3", {}, "Reste à payer pour l'objectif"),
    h(
      "p",
      {},
      h("strong", { class: "big" }, eur(total)),
      ` pour ${lines.length} carte${lines.length > 1 ? "s" : ""} (la SIR quand elle existe, ou la version que tu vises)`,
      upgrades.length ? `, dont ${upgrades.length} amélioration${upgrades.length > 1 ? "s" : ""}` : "",
      noPrice ? ` ; ${noPrice} sans prix connu, non comptée${noPrice > 1 ? "s" : ""}` : "",
      ".",
    ),
    h(
      "p",
      { class: "mut" },
      `Les ${top.length} plus chères pèsent ${eur(topSum)} (${total ? Math.round((topSum / total) * 100) : 0} %). `,
      `Avec la version la moins chère de chaque espèce, le total serait de ${eur(cheapest)}. `,
      "Dans une fiche, « Viser cette version » ou « Écarter » change la carte visée.",
    ),
    h(
      "details",
      {},
      h("summary", {}, `Voir les ${top.length} plus chères`),
      h("ol", { class: "buylist" }, ...top.map((l) => cardRow(l.s, l.c, eur(l.p)))),
    ),
  );
}

/** Chiffres clés en tuiles. */
function tiles(data: Species[], rows: PurchaseRow[]): HTMLElement {
  const st = stats(data);
  const owned = data.flatMap((s) => {
    const c = ownedCard(s);
    return c ? [c.price?.trend ?? 0] : [];
  });
  const months = budgetMonths(store.budget, rows, new Date());
  const left = availableNow(months);
  const tile = (label: string, value: string, sub: string, cls = "") =>
    h(
      "div",
      { class: `tile-k ${cls}` },
      h("span", { class: "k" }, label),
      h("strong", {}, value),
      h("span", { class: "s" }, sub),
    );
  return h(
    "div",
    { class: "kpis" },
    tile("Collection", `${st.done}/151`, `${Math.round((st.done / 151) * 100)} % · ${st.toBuy} à acheter`, "ok"),
    tile("Reste à payer", eur(st.remaining), `${st.toBuy + st.toUpgrade} cartes visées`),
    tile("Valeur estimée", eur(owned.reduce((t, v) => t + v, 0)), `${owned.length} cartes au binder`),
    left == null
      ? tile("Ce mois-ci", eur(months.at(-1)?.spent ?? 0), "dépensés · pas de budget")
      : tile(
          "Disponible ce mois",
          eur(left),
          `${eur(months.at(-1)?.spent ?? 0)} dépensés sur ${eur(months.at(-1)?.available ?? 0)}`,
          left < 0 ? "over" : "",
        ),
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
    { class: "card-sec" },
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
    { class: "card-sec" },
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
  const { purchases } = (await (await api("/api/purchases")).json()) as { purchases: PurchaseRow[] };
  $("stats-body").replaceChildren(
    tiles(data, purchases),
    ...[spending(purchases, data), remaining(data), progress(data), alerts(data), value(data), deals(data)].filter(
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
    const t = e.target as HTMLElement;
    // « Fixer un budget » : ouvre les réglages
    if (t.closest("[data-open='settings']")) {
      $as("stats", HTMLDialogElement).close();
      $as("settings", HTMLDialogElement).showModal();
      return;
    }
    const b = t.closest<HTMLElement>("[data-num]");
    if (!b) return;
    $as("stats", HTMLDialogElement).close();
    open(Number(b.dataset.num));
  });
}
