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
