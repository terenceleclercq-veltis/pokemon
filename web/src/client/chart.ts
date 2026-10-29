// Petite courbe de prix (SVG construit par l'API DOM : aucun HTML injecté).
import { eur } from "./dom";

const NS = "http://www.w3.org/2000/svg";

/** Courbe de la tendance sur la période ; null s'il y a moins de 3 relevés. */
export function sparkline(points: readonly [string, number][], w = 96, h = 28): SVGSVGElement | null {
  if (points.length < 3) return null;
  const ys = points.map((p) => p[1]);
  const min = Math.min(...ys);
  const max = Math.max(...ys);
  const span = max - min || 1;
  const step = w / (points.length - 1);
  const coords = ys.map((y, i) => `${(i * step).toFixed(1)},${(h - 2 - ((y - min) / span) * (h - 4)).toFixed(1)}`);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w));
  svg.setAttribute("height", String(h));
  svg.setAttribute("class", "spark");
  svg.setAttribute("role", "img");
  const first = ys[0] ?? 0;
  const last = ys[ys.length - 1] ?? 0;
  svg.setAttribute(
    "aria-label",
    `Prix sur ${points.length} relevés, du ${points[0]?.[0] ?? ""} au ${points.at(-1)?.[0] ?? ""} : ${eur(first)} → ${eur(last)}`,
  );
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("points", coords.join(" "));
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", "currentColor");
  line.setAttribute("stroke-width", "1.5");
  line.setAttribute("stroke-linejoin", "round");
  svg.append(line);
  svg.classList.add(last < first ? "down" : last > first ? "up" : "flat");
  return svg;
}

/** Histogramme simple (une barre par libellé), hauteur proportionnelle à la valeur. */
export function bars(entries: readonly [string, number][], w = 320, h = 120): SVGSVGElement {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("class", "bars");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", entries.map(([l, v]) => `${l} : ${eur(v)}`).join(", "));
  const max = Math.max(1, ...entries.map((e) => e[1]));
  const slot = w / Math.max(1, entries.length);
  entries.forEach(([label, v], i) => {
    const bh = (v / max) * (h - 22);
    const rect = document.createElementNS(NS, "rect");
    rect.setAttribute("x", (i * slot + slot * 0.15).toFixed(1));
    rect.setAttribute("y", (h - 16 - bh).toFixed(1));
    rect.setAttribute("width", (slot * 0.7).toFixed(1));
    rect.setAttribute("height", bh.toFixed(1));
    rect.setAttribute("rx", "2");
    const tip = document.createElementNS(NS, "title");
    tip.textContent = `${label} : ${eur(v)}`;
    rect.append(tip);
    const text = document.createElementNS(NS, "text");
    text.setAttribute("x", (i * slot + slot / 2).toFixed(1));
    text.setAttribute("y", String(h - 3));
    text.setAttribute("text-anchor", "middle");
    text.textContent = label;
    svg.append(rect, text);
  });
  return svg;
}
