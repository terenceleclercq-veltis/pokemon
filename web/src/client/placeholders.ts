// Page d'impression des placeholders de binder : fiches 63 × 88 mm, 9 par feuille A4.
import { api } from "./api";
import { $, $as, h, pad } from "./dom";

interface Item {
  num: number;
  nom_fr: string;
}

const PER_SHEET = 9;
// Illustrations officielles (dépôt public PokéAPI), chargées à l'affichage : rien n'est copié dans le dépôt.
const artwork = (num: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${num}.png`;

function fiche(it: Item): HTMLElement {
  return h(
    "div",
    { class: "ph" },
    h("div", { class: "num" }, pad(it.num)),
    h("img", { src: artwork(it.num), alt: "", loading: "eager", decoding: "async" }),
    h("div", { class: "name" }, it.nom_fr),
  );
}

async function render(): Promise<void> {
  const q = new URLSearchParams({ scope: $as("scope", HTMLSelectElement).value });
  const { items } = (await (await api(`/api/placeholders?${q.toString()}`)).json()) as { items: Item[] };
  const sheets: HTMLElement[] = [];
  for (let i = 0; i < items.length; i += PER_SHEET)
    sheets.push(h("section", { class: "sheet" }, ...items.slice(i, i + PER_SHEET).map(fiche)));
  $("sheets").replaceChildren(...sheets);
  $("count").textContent = `${items.length} fiche${items.length > 1 ? "s" : ""} · ${sheets.length} feuille${
    sheets.length > 1 ? "s" : ""
  } A4`;
}

$("scope").addEventListener("change", () => void render());
$("print").addEventListener("click", () => {
  window.print();
});
void render();
