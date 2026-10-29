// Page d'impression des placeholders de binder : fiches 63 × 88 mm, 9 par feuille A4, dans l'ordre du classeur.
// Version enrichie : carte visée (rareté, code, prix) et QR code vers l'offre Cardmarket exacte.
import { encode } from "uqr";
import { api, type Tier } from "./api";
import { $, $as, eur, h, pad } from "./dom";

interface Item {
  num: number;
  nom_fr: string;
  slot: { page: number; case: number };
  target: { label: string; code: string | null; tier: Tier; trend: number | null; url: string | null } | null;
}

const PER_SHEET = 9;
const NS = "http://www.w3.org/2000/svg";
// Illustrations officielles (dépôt public PokéAPI), chargées à l'affichage : rien n'est copié dans le dépôt.
const artwork = (num: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${num}.png`;

/** QR code en SVG (un seul tracé, construit par l'API DOM) ; marge de 2 modules. */
function qr(url: string): SVGSVGElement {
  const { size, data } = encode(url, { ecc: "M", border: 0 });
  let d = "";
  data.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) d += `M${x + 2} ${y + 2}h1v1h-1z`;
    });
  });
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${size + 4} ${size + 4}`);
  svg.setAttribute("class", "qr");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code vers l'offre Cardmarket");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

function fiche(it: Item, rich: boolean): HTMLElement {
  const t = rich ? it.target : null;
  return h(
    "div",
    { class: `ph${t ? " rich" : ""}` },
    h(
      "div",
      { class: "top" },
      h("span", { class: "num" }, pad(it.num)),
      h("span", { class: "slot" }, `p. ${it.slot.page} · c. ${it.slot.case}`),
    ),
    h("img", { src: artwork(it.num), alt: "", loading: "eager", decoding: "async" }),
    h("div", { class: "name" }, it.nom_fr),
    t
      ? h(
          "div",
          { class: "goal" },
          h(
            "div",
            { class: "txt" },
            h("strong", {}, t.tier),
            ` ${t.code ?? ""}`,
            h("br"),
            t.trend != null ? `≈ ${eur(t.trend)}` : "",
          ),
          t.url ? qr(t.url) : null,
        )
      : null,
  );
}

async function render(): Promise<void> {
  const q = new URLSearchParams({ scope: $as("scope", HTMLSelectElement).value });
  const rich = $as("rich", HTMLSelectElement).value === "oui";
  const { items } = (await (await api(`/api/placeholders?${q.toString()}`)).json()) as { items: Item[] };
  const sheets: HTMLElement[] = [];
  for (let i = 0; i < items.length; i += PER_SHEET)
    sheets.push(h("section", { class: "sheet" }, ...items.slice(i, i + PER_SHEET).map((it) => fiche(it, rich))));
  $("sheets").replaceChildren(...sheets);
  $("count").textContent = `${items.length} fiche${items.length > 1 ? "s" : ""} · ${sheets.length} feuille${
    sheets.length > 1 ? "s" : ""
  } A4`;
}

$("scope").addEventListener("change", () => void render());
$("rich").addEventListener("change", () => void render());
$("print").addEventListener("click", () => {
  window.print();
});
void render();
