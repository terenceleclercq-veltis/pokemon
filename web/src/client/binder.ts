// Vue classeur : 17 pages de 9 cases dans l'ordre du Pokédex, miroir du binder physique.
// Case remplie = ta carte ; case vide = placeholder (illustration du Pokémon, numéro, prix de la carte visée).
import type { Species } from "./api";
import { $, eur, h, pad } from "./dom";
import { artImg, cardImg, ownedCard, slotOf, store, targetPrice } from "./state";

const PAGES = 17;

function slot(s: Species): HTMLElement {
  const mine = ownedCard(s);
  const src = mine && cardImg(mine);
  const { page, case: c } = slotOf(s.num);
  const price = targetPrice(s);
  const label = src
    ? `${pad(s.num)} ${s.nom_fr} : ta carte, page ${page} case ${c}`
    : `${pad(s.num)} ${s.nom_fr} : case vide, page ${page} case ${c}`;
  const button = h(
    "button",
    {
      type: "button",
      class: `slot${src ? " filled" : ""}${s.order ? " ordered" : ""}`,
      "data-num": s.num,
      "aria-label": label,
    },
    src
      ? h("img", { src, alt: "", loading: "lazy", decoding: "async", width: 120, height: 168 })
      : h(
          "span",
          { class: "hole" },
          h("span", { class: "n" }, pad(s.num)),
          h("img", { src: artImg(s.num), alt: "", loading: "lazy", decoding: "async", width: 80, height: 80 }),
          h("span", { class: "name" }, s.nom_fr),
          s.order
            ? h("span", { class: "p" }, "⏳ commandée")
            : s.cards.length
              ? h("span", { class: "p" }, price != null ? eur(price) : "prix n/d")
              : h("span", { class: "p" }, "aucune carte"),
        ),
  );
  return h("li", {}, button);
}

export function renderBinder(): void {
  const pages: HTMLElement[] = [];
  for (let p = 1; p <= PAGES; p++) {
    const species = store.data.filter((s) => slotOf(s.num).page === p);
    const filled = species.filter((s) => ownedCard(s) && cardImg(ownedCard(s)!)).length;
    pages.push(
      h(
        "section",
        { class: "page", "aria-label": `Page ${p}` },
        h(
          "h2",
          {},
          `Page ${p}`,
          h("span", { class: "mut" }, ` · n° ${(p - 1) * 9 + 1}–${Math.min(p * 9, 151)} · ${filled}/${species.length}`),
        ),
        h("ul", { class: "slots" }, ...species.map(slot)),
      ),
    );
  }
  $("binder").replaceChildren(...pages);
}
