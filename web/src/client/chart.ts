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

const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
/** « oct. », ou « janv. 27 » pour le début d'une année. */
export const monthLabel = (m: string) => {
  const [y, mm] = m.split("-");
  const name = MONTHS[Number(mm) - 1] ?? m;
  return mm === "01" ? `${name} ${y?.slice(2)}` : name;
};

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

/** Arrondi « joli » pour l'axe des montants (10, 20, 50, 100…). */
function niceMax(v: number): number {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1)));
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((x) => x >= v) ?? 10 * p;
}

export interface SpendPoint {
  month: string;
  spent: number;
  /** Disponible ce mois (budget + report), null hors budget. */
  available: number | null;
}

/**
 * Dépenses par mois : barres avec montant, axe gradué, et disponible du mois (budget + report) en repère pointillé.
 * Le mois courant est mis en évidence.
 */
export function spendChart(points: readonly SpendPoint[]): SVGSVGElement {
  const w = 640;
  const h = 220;
  const left = 44;
  const top = 18;
  const bottom = 26;
  const plotH = h - top - bottom;
  const max = niceMax(Math.max(1, ...points.map((p) => Math.max(p.spent, p.available ?? 0))));
  const y = (v: number) => top + plotH - (Math.max(0, v) / max) * plotH;
  const slot = (w - left) / Math.max(1, points.length);
  const svg = el("svg", { viewBox: `0 0 ${w} ${h}`, class: "spend", role: "img" });
  svg.setAttribute(
    "aria-label",
    points
      .map((p) => `${monthLabel(p.month)} : ${eur(p.spent)}${p.available != null ? ` sur ${eur(p.available)}` : ""}`)
      .join(", "),
  );
  for (const t of [0, 0.5, 1]) {
    const v = max * t;
    svg.append(
      el("line", { x1: left, x2: w, y1: y(v), y2: y(v), class: "grid" }),
      el("text", { x: left - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" }, eur(v).replace(/,00\s/, " ")),
    );
  }
  points.forEach((p, i) => {
    const x = left + i * slot;
    const current = i === points.length - 1;
    const bar = el("rect", {
      x: (x + slot * 0.18).toFixed(1),
      y: y(p.spent).toFixed(1),
      width: (slot * 0.64).toFixed(1),
      height: Math.max(0, top + plotH - y(p.spent)).toFixed(1),
      rx: 3,
      class: `sb${current ? " now" : ""}${p.available != null && p.spent > p.available ? " over" : ""}`,
    });
    bar.append(
      el(
        "title",
        {},
        `${monthLabel(p.month)} : ${eur(p.spent)} dépensés${p.available != null ? `, ${eur(p.available)} disponibles` : ""}`,
      ),
    );
    if (p.spent > 0) svg.append(bar);
    if (p.available != null && p.available > 0)
      svg.append(
        el("line", {
          x1: (x + slot * 0.08).toFixed(1),
          x2: (x + slot * 0.92).toFixed(1),
          y1: y(p.available).toFixed(1),
          y2: y(p.available).toFixed(1),
          class: "budget",
        }),
      );
    if (p.spent > 0)
      svg.append(
        el(
          "text",
          { x: (x + slot / 2).toFixed(1), y: (y(p.spent) - 4).toFixed(1), "text-anchor": "middle", class: "val" },
          eur(p.spent).replace(/,\d\d\s/, " "),
        ),
      );
    svg.append(
      el(
        "text",
        { x: (x + slot / 2).toFixed(1), y: h - 8, "text-anchor": "middle", class: `axis${current ? " now" : ""}` },
        monthLabel(p.month),
      ),
    );
  });
  return svg;
}
