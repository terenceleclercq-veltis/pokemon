// Page d'impression des placeholders de binder : fiches 63 × 88 mm, 9 par feuille A4.
import { api } from "./api";
import { $, $as, eur, h, pad } from "./dom";

interface Item {
  num: number;
  nom_fr: string;
  card: {
    nom_fr: string;
    code: string | null;
    set_name: string;
    tier: string;
    image: string | null;
    trend: number | null;
  } | null;
}

const PER_SHEET = 9;
const TIER = { FA: "Full art", IR: "IR", SIR: "SIR" } as Record<string, string>;

function fiche(it: Item): HTMLElement {
  const c = it.card;
  return h(
    "div",
    { class: "ph" },
    h("div", { class: "num" }, pad(it.num)),
    h("div", { class: "name" }, it.nom_fr),
    c?.image
      ? h("img", { src: c.image, alt: "", loading: "eager", decoding: "async" })
      : h("div", { class: "noimg" }, "image indisponible"),
    c
      ? h(
          "div",
          { class: "card" },
          h("div", {}, c.nom_fr),
          c.code ? h("div", { class: "code" }, c.code) : null,
          h("div", {}, `${c.set_name} · ${eur(c.trend)}`),
        )
      : h("div", { class: "card" }, "Aucune carte full art connue"),
    c ? h("span", { class: "tier" }, TIER[c.tier] ?? c.tier) : null,
  );
}

async function render(): Promise<void> {
  const q = new URLSearchParams({
    tier: $as("tier", HTMLSelectElement).value,
    scope: $as("scope", HTMLSelectElement).value,
  });
  const { items } = (await (await api(`/api/placeholders?${q.toString()}`)).json()) as { items: Item[] };
  const sheets: HTMLElement[] = [];
  for (let i = 0; i < items.length; i += PER_SHEET)
    sheets.push(h("section", { class: "sheet" }, ...items.slice(i, i + PER_SHEET).map(fiche)));
  $("sheets").replaceChildren(...sheets);
  $("count").textContent = `${items.length} fiche${items.length > 1 ? "s" : ""} · ${sheets.length} feuille${
    sheets.length > 1 ? "s" : ""
  } A4`;
}

$("tier").addEventListener("change", () => void render());
$("scope").addEventListener("change", () => void render());
$("print").addEventListener("click", () => {
  window.print();
});
void render();
