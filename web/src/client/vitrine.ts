// Vitrine : jusqu'à 5 de tes cartes exposées dans les protections aimantées, au-dessus du classeur.
// Un clic ouvre la fiche ; ajout et retrait depuis la fiche (« Mettre en vitrine »), sur ta carte seulement.
import { api, type Card, type Species } from "./api";
import { $, h, pad, toast } from "./dom";
import { cardImg, store } from "./state";

export const VITRINE_SIZE = 5;

/** Tes cartes en vitrine, dans l'ordre (une carte qui n'est plus la tienne disparaît de l'affichage). */
function shown(): { s: Species; c: Card }[] {
  return store.vitrine.flatMap((id) => {
    const s = store.data.find((x) => x.owned?.card_id === id);
    const c = s?.cards.find((x) => x.id === id);
    return s && c ? [{ s, c }] : [];
  });
}

export const inVitrine = (id: string) => store.vitrine.includes(id);

async function save(cards: string[]): Promise<void> {
  await api("/api/vitrine", { method: "PUT", json: { cards } });
  store.vitrine = cards;
  renderVitrine();
}

/** Ajoute ta carte à la suite (refusé si la vitrine est pleine). */
export async function addToVitrine(c: Card): Promise<boolean> {
  const kept = shown().map((x) => x.c.id);
  if (kept.length >= VITRINE_SIZE) {
    toast(`Vitrine pleine (${VITRINE_SIZE} cartes) : retires-en une depuis sa fiche.`, "err");
    return false;
  }
  await save([...kept, c.id]);
  toast(`${c.cm_label} en vitrine.`);
  return true;
}

export async function removeFromVitrine(c: Card): Promise<void> {
  await save(shown().flatMap((x) => (x.c.id === c.id ? [] : [x.c.id])));
  toast(`${c.cm_label} retirée de la vitrine.`);
}

function slot({ s, c }: { s: Species; c: Card }): HTMLElement {
  const img = cardImg(c);
  return h(
    "li",
    { class: "case" },
    h(
      "button",
      {
        type: "button",
        class: "holder",
        "data-num": s.num,
        "aria-label": `${pad(s.num)} ${c.cm_label} : ouvrir la fiche`,
      },
      img
        ? h("img", { src: img, alt: "", loading: "lazy", decoding: "async", width: 160, height: 223 })
        : h("span", { class: "ph" }, "?"),
    ),
  );
}

const empty = () => h("li", { class: "case empty" }, h("div", { class: "holder" }, h("span", {}, "Libre")));

export function renderVitrine(): void {
  const cards = shown();
  $("vitrine").replaceChildren(
    h(
      "h2",
      { id: "vitrine-title" },
      "Vitrine",
      h(
        "span",
        { class: "mut" },
        cards.length < VITRINE_SIZE ? "« Mettre en vitrine » dans la fiche d'une de tes cartes" : "",
      ),
    ),
    h("ol", { class: "cases" }, ...cards.map(slot), ...Array.from({ length: VITRINE_SIZE - cards.length }, empty)),
  );
}
