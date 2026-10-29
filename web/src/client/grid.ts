// Grille des 151 espèces : tuiles illustrées, statistiques d'en-tête.
import type { Species } from "./api";
import { $, eur, h, pad } from "./dom";
import type { ViewState } from "./router";
import { alertHit, matches, passes, sortSpecies, stats, store, targetOf, targetPrice, visualOf } from "./state";

let shown: number[] = [];
/** Numéros des espèces affichées, dans l'ordre de la grille. */
export const visibleNums = () => shown;

/** Petit texte sous le nom : ce qu'il reste à faire pour cette espèce. */
function subtitle(s: Species): string {
  if (!s.cards.length) return "Aucune carte";
  const goal = targetOf(s);
  const price = targetPrice(s);
  const what = goal?.categorie === "SHINY" ? "Chromatique" : (goal?.tier ?? "");
  if (s.order) {
    const paid = s.order.price_paid;
    return `Commandée${paid != null ? ` · ${eur(paid)}` : ""}`;
  }
  switch (s.status) {
    case "complete":
      return `Complète · ${s.owned?.tier ?? ""}`;
    case "choisie":
      return "Choix conservé";
    case "a_verifier":
      return `↑ ${what} · ${price != null ? eur(price) : "prix n/d"}`;
    default:
      return `${what} · ${price != null ? eur(price) : "prix n/d"}`;
  }
}

const MARK: Partial<Record<Species["status"], string>> = { complete: "✓", choisie: "✓", a_verifier: "↑" };

function tile(s: Species): HTMLElement {
  const v = visualOf(s);
  const hit = s.cards.some(alertHit);
  const sub = `${subtitle(s)}${hit ? ", alerte de prix atteinte" : ""}`;
  const mark = s.order ? "⏳" : s.cards.length ? MARK[s.status] : undefined;
  return h(
    "button",
    {
      class: `tile ${s.cards.length ? s.status : "none"}${s.order ? " ordered" : ""}`,
      type: "button",
      role: "listitem",
      "data-num": s.num,
      "aria-label": `${pad(s.num)} ${s.nom_fr}, ${sub}`,
    },
    h(
      "span",
      { class: `pic ${v.kind}` },
      h("img", { src: v.src, alt: "", loading: "lazy", decoding: "async", width: 160, height: 223 }),
      mark ? h("span", { class: "mark" }, mark) : null,
      hit ? h("span", { class: "bell", title: "Alerte de prix atteinte" }, "🔔") : null,
    ),
    h("span", { class: "n" }, pad(s.num)),
    h("strong", {}, s.nom_fr),
    h("span", { class: "p" }, subtitle(s)),
  );
}

export function renderStats(): void {
  const st = stats(store.data);
  const text =
    `${st.done}/151 complètes · ${st.toBuy} à acheter · ${st.toUpgrade} à améliorer · ` +
    `${st.ordered ? `${st.ordered} en commande · ` : ""}${st.alerts ? `🔔 ${st.alerts} alerte${st.alerts > 1 ? "s" : ""} · ` : ""}` +
    `${st.none} sans carte · reste ≈ ${eur(st.remaining)}`;
  // n'annonce (aria-live) que les vrais changements
  if ($("progress").textContent !== text) $("progress").textContent = text;
  $("bar-fill").style.width = `${(st.done / 151) * 100}%`;
  $("bar").setAttribute("aria-valuenow", String(st.done));
}

export function renderGrid(view: ViewState): void {
  renderStats();
  const list = sortSpecies(
    store.data.filter((s) => passes(s, view.f) && matches(s, view.q)),
    view.s,
  );
  shown = list.map((s) => s.num);
  $("grid").replaceChildren(...list.map(tile));
  $("empty").hidden = list.length > 0;
}
