// Visionneuse plein écran : image haute définition, versions précédente/suivante, reflet holographique.
import type { Card, Species } from "./api";
import { $, $as, eur, h } from "./dom";
import { artImg, cardImg, cardImgHigh, CATEGORIE_NOTE, langueOf, TIER_LABEL } from "./state";

interface Slide {
  low: string;
  high: string;
  alt: string;
  card?: Card;
}

let slides: Slide[] = [];
let index = 0;
let species: Species | undefined;

const dialog = () => $as("viewer", HTMLDialogElement);
const img = () => $as("v-img", HTMLImageElement);

/** Ouvre la visionneuse sur les cartes données (dans l'ordre de la fiche), à partir de `startId`. */
export function openViewer(s: Species, cards: readonly Card[], startId?: string): void {
  species = s;
  slides = cards.flatMap((c) => {
    const low = cardImg(c);
    return low ? [{ low, high: cardImgHigh(c) ?? low, alt: `${c.nom_fr} — ${c.set_name} ${c.numero}`, card: c }] : [];
  });
  if (!slides.length) slides = [{ low: artImg(s.num), high: artImg(s.num), alt: `Illustration de ${s.nom_fr}` }];
  index = Math.max(
    0,
    slides.findIndex((x) => x.card?.id === startId),
  );
  show();
  if (!dialog().open) dialog().showModal();
}

function caption(sl: Slide): Node[] {
  const c = sl.card;
  if (!c) return [h("span", {}, `${species?.nom_fr ?? ""} — aucune carte en image`)];
  const bits = [
    c.code_cm ?? `${c.set_name} ${c.numero}`,
    TIER_LABEL[c.tier],
    langueOf(c.langue),
    CATEGORIE_NOTE[c.categorie],
    c.price?.trend != null ? eur(c.price.trend) : null,
  ].filter(Boolean);
  return [
    h("strong", {}, c.nom_fr),
    h("span", {}, ` · ${bits.join(" · ")}`),
    slides.length > 1 ? h("span", { class: "mut" }, ` · ${index + 1}/${slides.length}`) : null,
    c.cm_url
      ? h(
          "a",
          {
            href: c.cm_url,
            target: "_blank",
            rel: "noopener noreferrer",
            "aria-label": `${c.cm_label} sur Cardmarket`,
          },
          "Cardmarket ↗",
        )
      : null,
  ].filter((x): x is HTMLElement => x !== null);
}

function show(): void {
  const sl = slides[index];
  if (!sl) return;
  const el = img();
  el.alt = sl.alt;
  // miniature déjà en cache tout de suite, puis la haute définition dès qu'elle est chargée
  el.src = sl.low;
  if (sl.high !== sl.low) {
    const hi = new Image();
    hi.onload = () => {
      if (slides[index] === sl) el.src = sl.high;
    };
    hi.src = sl.high;
  }
  $("v-fig").classList.toggle("art", !sl.card);
  $("v-cap").replaceChildren(...caption(sl));
  const many = slides.length > 1;
  $("v-prev").hidden = !many;
  $("v-next").hidden = !many;
  // précharge les voisines pour un défilement fluide
  for (const n of [index - 1, index + 1]) {
    const nb = slides[(n + slides.length) % slides.length];
    if (nb && many) new Image().src = nb.high;
  }
}

function step(d: number): void {
  if (slides.length < 2) return;
  index = (index + d + slides.length) % slides.length;
  show();
}

const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

export function initViewer(): void {
  const dlg = dialog();
  const fig = $("v-fig");
  $("v-prev").addEventListener("click", () => {
    step(-1);
  });
  $("v-next").addEventListener("click", () => {
    step(1);
  });
  dlg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") step(-1);
    else if (e.key === "ArrowRight") step(1);
    else return;
    e.preventDefault();
  });
  // clic sur le fond : ferme
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  // reflet holographique et légère inclinaison qui suivent le pointeur
  fig.addEventListener("pointermove", (e) => {
    if (reduceMotion() || fig.classList.contains("art")) return;
    const r = fig.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    fig.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
    fig.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    fig.style.setProperty("--ry", `${((x - 0.5) * 14).toFixed(2)}deg`);
    fig.style.setProperty("--rx", `${((0.5 - y) * 14).toFixed(2)}deg`);
    fig.classList.add("lit");
  });
  fig.addEventListener("pointerleave", () => {
    fig.classList.remove("lit");
    for (const p of ["--rx", "--ry"]) fig.style.setProperty(p, "0deg");
  });
  // balayage horizontal (tactile) : version précédente / suivante
  let start: { x: number; y: number } | null = null;
  fig.addEventListener("pointerdown", (e) => {
    start = { x: e.clientX, y: e.clientY };
  });
  fig.addEventListener("pointerup", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > 2 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  });
}
