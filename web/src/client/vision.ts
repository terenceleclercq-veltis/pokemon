// Analyse d'image du scanner (sans DOM, testée) : repérage de la carte sur fond sombre, netteté, reflets, affinage des
// bords à pleine résolution, redressement (homographie) et contrôle des gros plans (coin ou bord bien placé).

export interface Pt {
  x: number;
  y: number;
}
/** Coins de la carte : haut gauche, haut droit, bas droit, bas gauche. */
export type Quad = [Pt, Pt, Pt, Pt];
/** Carte Pokémon : 63 × 88 mm. */
export const CARD_RATIO = 63 / 88;

/** Luminance (0-255) d'une image RGBA. */
export function gray(rgba: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4)
    g[i] = (77 * (rgba[j] ?? 0) + 150 * (rgba[j + 1] ?? 0) + 29 * (rgba[j + 2] ?? 0)) >> 8;
  return g;
}

/** Seuil d'Otsu : sépare au mieux deux populations de luminance (fond et carte). */
export function otsu(g: Uint8Array): number {
  const hist = new Float64Array(256);
  for (const v of g) hist[v] = (hist[v] ?? 0) + 1;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * (hist[i] ?? 0);
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let t = 128;
  for (let i = 0; i < 256; i++) {
    wB += hist[i] ?? 0;
    const wF = g.length - wB;
    if (!wB || !wF) continue;
    sumB += i * (hist[i] ?? 0);
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      t = i;
    }
  }
  return t;
}

/** Fond clair ? (coins de l'image plus clairs que le seuil) : la carte est alors la zone sombre. */
function lightBackground(g: Uint8Array, w: number, h: number, t: number): boolean {
  const pw = Math.max(1, Math.round(w * 0.06));
  const ph = Math.max(1, Math.round(h * 0.06));
  let s = 0;
  let n = 0;
  for (const [x0, y0] of [
    [0, 0],
    [w - pw, 0],
    [0, h - ph],
    [w - pw, h - ph],
  ])
    for (let y = y0!; y < y0! + ph; y++)
      for (let x = x0!; x < x0! + pw; x++) {
        s += g[y * w + x] ?? 0;
        n++;
      }
  return s / n > t;
}

export interface Detection {
  quad: Quad;
  /** Part de l'image occupée par la carte (0-1). */
  area: number;
  /** La carte touche le bord de l'image (elle dépasse sans doute). */
  clipped: boolean;
}

/**
 * Carte posée sur un fond uni : plus grande zone (4-connexe) qui se distingue du fond, puis ses quatre coins (points
 * extrêmes selon x + y et x - y, valables tant que la carte est tournée de moins de 45°).
 */
export function detectCard(g: Uint8Array, w: number, h: number): Detection | null {
  const t = otsu(g);
  const invert = lightBackground(g, w, h, t);
  const on = (i: number) => (g[i] ?? 0) > t !== invert;
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let best: { quad: Quad; count: number; clipped: boolean } | null = null;
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !on(start)) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    seen[start] = 1;
    let count = 0;
    let clipped = false;
    // extrêmes : haut gauche (min x+y), bas droit (max x+y), haut droit (max x-y), bas gauche (min x-y)
    let tl = start;
    let br = start;
    let tr = start;
    let bl = start;
    let tlv = Infinity;
    let brv = -Infinity;
    let trv = -Infinity;
    let blv = Infinity;
    while (head < tail) {
      const i = queue[head++] ?? 0;
      const x = i % w;
      const y = (i - x) / w;
      count++;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) clipped = true;
      const s = x + y;
      const d = x - y;
      if (s < tlv) [tlv, tl] = [s, i];
      if (s > brv) [brv, br] = [s, i];
      if (d > trv) [trv, tr] = [d, i];
      if (d < blv) [blv, bl] = [d, i];
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (n >= 0 && !seen[n] && on(n)) {
          seen[n] = 1;
          queue[tail++] = n;
        }
    }
    if (!best || count > best.count) {
      const pt = (i: number): Pt => ({ x: i % w, y: Math.floor(i / w) });
      best = { quad: [pt(tl), pt(tr), pt(br), pt(bl)], count, clipped };
    }
  }
  if (!best || best.count < w * h * 0.02) return null;
  return { quad: best.quad, area: best.count / (w * h), clipped: best.clipped };
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Géométrie d'un quadrilatère : largeur et hauteur moyennes, rapport, écart maximal à l'angle droit (degrés). */
export function quadShape(q: Quad): { width: number; height: number; ratio: number; skew: number } {
  const width = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2;
  const height = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  let skew = 0;
  for (let i = 0; i < 4; i++) {
    const p = q[i] as Pt;
    const a = q[(i + 3) % 4] as Pt;
    const b = q[(i + 1) % 4] as Pt;
    const u = { x: a.x - p.x, y: a.y - p.y };
    const v = { x: b.x - p.x, y: b.y - p.y };
    const cos = (u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y) || 1);
    skew = Math.max(skew, Math.abs((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI - 90));
  }
  return { width, height, ratio: height ? width / height : 0, skew };
}

/** Déplacement maximal d'un coin entre deux détections, en part de la diagonale de l'image. */
export function quadMotion(a: Quad, b: Quad, w: number, h: number): number {
  return Math.max(...a.map((p, i) => dist(p, b[i] as Pt))) / Math.hypot(w, h);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Netteté : variance du laplacien sur une zone (plus elle est haute, plus l'image est nette). */
export function sharpness(g: Uint8Array, w: number, h: number, r: Rect = { x: 0, y: 0, w, h }): number {
  const x0 = Math.max(1, Math.floor(r.x));
  const y0 = Math.max(1, Math.floor(r.y));
  const x1 = Math.min(w - 1, Math.floor(r.x + r.w));
  const y1 = Math.min(h - 1, Math.floor(r.y + r.h));
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      const l = 4 * (g[i] ?? 0) - (g[i - 1] ?? 0) - (g[i + 1] ?? 0) - (g[i - w] ?? 0) - (g[i + w] ?? 0);
      s += l;
      s2 += l * l;
      n++;
    }
  return n ? s2 / n - (s / n) ** 2 : 0;
}

/** Reflets : part des pixels saturés (blanc pur) à l'intérieur de la carte (zone centrale du quadrilatère). */
export function glare(rgba: Uint8ClampedArray, w: number, q: Quad): number {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const mx = (x1 - x0) * 0.08;
  const my = (y1 - y0) * 0.08;
  let n = 0;
  let hot = 0;
  for (let y = Math.ceil(y0 + my); y < y1 - my; y += 2)
    for (let x = Math.ceil(x0 + mx); x < x1 - mx; x += 2) {
      const j = (y * w + x) * 4;
      n++;
      if ((rgba[j] ?? 0) >= 252 && (rgba[j + 1] ?? 0) >= 252 && (rgba[j + 2] ?? 0) >= 252) hot++;
    }
  return n ? hot / n : 0;
}

/** Ligne ajustée (moindres carrés orthogonaux) : point moyen et direction unitaire. */
function fitLine(pts: Pt[]): { c: Pt; d: Pt } | null {
  if (pts.length < 2) return null;
  const c = { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length };
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pts) {
    sxx += (p.x - c.x) ** 2;
    sxy += (p.x - c.x) * (p.y - c.y);
    syy += (p.y - c.y) ** 2;
  }
  const a = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { c, d: { x: Math.cos(a), y: Math.sin(a) } };
}

function intersect(a: { c: Pt; d: Pt }, b: { c: Pt; d: Pt }): Pt | null {
  const den = a.d.x * b.d.y - a.d.y * b.d.x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((b.c.x - a.c.x) * b.d.y - (b.c.y - a.c.y) * b.d.x) / den;
  return { x: a.c.x + t * a.d.x, y: a.c.y + t * a.d.y };
}

/**
 * Coins précis à pleine résolution : sur chaque côté, la bordure fond/carte est cherchée le long de profils
 * perpendiculaires (plus forte variation de luminance), une droite est ajustée sur ces points (les points aberrants
 * écartés), et les coins sont les intersections des droites. Repli sur les coins d'origine si l'affinage échoue.
 */
export function refineQuad(g: Uint8Array, w: number, h: number, q: Quad): Quad {
  const reach = Math.max(6, Math.round(Math.max(w, h) * 0.02));
  const center = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const lum = (x: number, y: number) => {
    const xi = Math.min(w - 1, Math.max(0, Math.round(x)));
    const yi = Math.min(h - 1, Math.max(0, Math.round(y)));
    return g[yi * w + xi] ?? 0;
  };
  const lines = q.map((a, k) => {
    const b = q[(k + 1) % 4] as Pt;
    const len = dist(a, b) || 1;
    let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((mid.x - center.x) * n.x + (mid.y - center.y) * n.y < 0) n = { x: -n.x, y: -n.y }; // normale vers l'extérieur
    const pts: Pt[] = [];
    for (let i = 0; i < 32; i++) {
      const t = 0.12 + (0.76 * i) / 31;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      // profil lissé (moyenne sur 3) le long de la normale ; bordure = plus forte variation
      let bestS = 0;
      let bestG = -1;
      for (let s = -reach; s <= reach; s++) {
        const at = (u: number) =>
          (lum(p.x + n.x * (u - 1), p.y + n.y * (u - 1)) +
            lum(p.x + n.x * u, p.y + n.y * u) +
            lum(p.x + n.x * (u + 1), p.y + n.y * (u + 1))) /
          3;
        const grad = Math.abs(at(s + 1) - at(s - 1));
        if (grad > bestG) [bestG, bestS] = [grad, s];
      }
      if (bestG >= 12) pts.push({ x: p.x + n.x * bestS, y: p.y + n.y * bestS });
    }
    // deux passes : ajustement, puis sans les points à plus de 2 px (ou 1,5 × l'écart médian) de la droite
    let line = fitLine(pts);
    if (!line) return null;
    const off = (p: Pt, l: { c: Pt; d: Pt }) => Math.abs((p.x - l.c.x) * l.d.y - (p.y - l.c.y) * l.d.x);
    const devs = pts.map((p) => off(p, line!)).sort((x, y) => x - y);
    const tol = Math.max(2, 1.5 * (devs[Math.floor(devs.length / 2)] ?? 0));
    const kept = pts.filter((p) => off(p, line!) <= tol);
    line = kept.length >= 8 ? fitLine(kept) : null;
    return line;
  });
  const out: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    // coin k = intersection du côté précédent (k-1 → k) et du côté suivant (k → k+1)
    const prev = lines[(k + 3) % 4];
    const next = lines[k];
    const p = prev && next ? intersect(prev, next) : null;
    if (!p || dist(p, q[k] as Pt) > reach * 1.5) return q;
    out.push(p);
  }
  return out as Quad;
}

/** Homographie qui envoie les quatre points `from` sur les quatre points `to` (matrice 3 × 3, h33 = 1). */
export function homography(from: Quad, to: Quad): number[] {
  // système 8 × 8 : pour chaque paire (x, y) -> (u, v)
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i] as Pt;
    const { x: u, y: v } = to[i] as Pt;
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // élimination de Gauss avec pivot partiel
  for (let c = 0; c < 8; c++) {
    let p = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[p]![c]!)) p = r;
    [A[c], A[p]] = [A[p]!, A[c]!];
    const piv = A[c]![c]!;
    if (Math.abs(piv) < 1e-12) throw new Error("points alignés : homographie impossible");
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r]![c]! / piv;
      for (let k = c; k < 9; k++) A[r]![k]! -= f * A[c]![k]!;
    }
  }
  return [...A.map((row, i) => row[8]! / row[i]!), 1];
}

/** Applique une homographie à un point. */
export function project(H: number[], p: Pt): Pt {
  const d = H[6]! * p.x + H[7]! * p.y + H[8]!;
  return { x: (H[0]! * p.x + H[1]! * p.y + H[2]!) / d, y: (H[3]! * p.x + H[4]! * p.y + H[5]!) / d };
}

/**
 * Redressement : image (RGBA) du quadrilatère `q` remise à plat au format `dw` × `dh` (interpolation bilinéaire).
 * Chaque pixel de destination va chercher sa couleur dans la photo (homographie inverse).
 */
export function warp(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  q: Quad,
  dw: number,
  dh: number,
): Uint8ClampedArray<ArrayBuffer> {
  const H = homography(
    [
      { x: 0, y: 0 },
      { x: dw, y: 0 },
      { x: dw, y: dh },
      { x: 0, y: dh },
    ],
    q,
  );
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const p = project(H, { x: x + 0.5, y: y + 0.5 });
      const fx = Math.min(sw - 1.001, Math.max(0, p.x - 0.5));
      const fy = Math.min(sh - 1.001, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + sw * 4;
      const i11 = i01 + 4;
      const o = (y * dw + x) * 4;
      for (let c = 0; c < 4; c++)
        out[o + c] =
          (src[i00 + c] ?? 0) * (1 - ax) * (1 - ay) +
          (src[i10 + c] ?? 0) * ax * (1 - ay) +
          (src[i01 + c] ?? 0) * (1 - ax) * ay +
          (src[i11 + c] ?? 0) * ax * ay;
    }
  return out;
}

/** Gros plan : coin (hg, hd, bd, bg) ou bord (h, d, b, g) de la carte attendu au centre du cadre. */
export type Target = "hg" | "hd" | "bd" | "bg" | "h" | "d" | "b" | "g";

/**
 * Le gros plan montre-t-il bien la partie demandée ? Le cadre est coupé en deux (bord) ou en quatre (coin) : la
 * partie « carte » doit se distinguer nettement de la partie « fond ». Renvoie l'écart de luminance carte - fond
 * (positif si la carte est bien là où on l'attend ; `bright` : carte plus claire que le fond, cas du fond sombre).
 */
export function framing(g: Uint8Array, w: number, r: Rect, target: Target, bright = true): number {
  const mean = (x0: number, y0: number, x1: number, y1: number) => {
    let s = 0;
    let n = 0;
    for (let y = Math.floor(y0); y < y1; y += 2)
      for (let x = Math.floor(x0); x < x1; x += 2) {
        s += g[y * w + x] ?? 0;
        n++;
      }
    return n ? s / n : 0;
  };
  const { x, y } = r;
  const mx = r.x + r.w / 2;
  const my = r.y + r.h / 2;
  const X = r.x + r.w;
  const Y = r.y + r.h;
  // [zone carte, zone fond] pour chaque cible
  const zones: Record<Target, [number[], number[]]> = {
    hg: [
      [mx, my, X, Y],
      [x, y, mx, my],
    ],
    hd: [
      [x, my, mx, Y],
      [mx, y, X, my],
    ],
    bd: [
      [x, y, mx, my],
      [mx, my, X, Y],
    ],
    bg: [
      [mx, y, X, my],
      [x, my, mx, Y],
    ],
    h: [
      [x, my, X, Y],
      [x, y, X, my],
    ],
    b: [
      [x, y, X, my],
      [x, my, X, Y],
    ],
    g: [
      [mx, y, X, Y],
      [x, y, mx, Y],
    ],
    d: [
      [x, y, mx, Y],
      [mx, y, X, Y],
    ],
  };
  const [card, bg] = zones[target];
  const c = mean(card[0]!, card[1]!, card[2]!, card[3]!);
  const b = mean(bg[0]!, bg[1]!, bg[2]!, bg[3]!);
  return Math.max(0, bright ? c - b : b - c);
}

/** Écart moyen entre deux images en niveaux de gris de même taille (mouvement du téléphone). */
export function motion(a: Uint8Array, b: Uint8Array): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length && i < b.length; i += 7) {
    s += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
    n++;
  }
  return n ? s / n : 0;
}
