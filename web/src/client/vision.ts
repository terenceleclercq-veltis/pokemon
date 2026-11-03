// Analyse d'image du scanner (sans DOM, testée) : repérage de la carte sur un fond uni (sombre ou clair), netteté,
// reflets, affinage des bords à pleine résolution, vrai bord retrouvé quand le contour passe dans la carte,
// redressement (homographie), empreinte d'une face (retournement), bordures et centrage.

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

/** Droite ajustée en deux passes : sans les points à plus de 2 px (ou 1,5 × l'écart médian) ; null sous 8 points. */
function robustLine(pts: Pt[]): { c: Pt; d: Pt } | null {
  const line = fitLine(pts);
  if (!line) return null;
  const off = (p: Pt) => Math.abs((p.x - line.c.x) * line.d.y - (p.y - line.c.y) * line.d.x);
  const devs = pts.map(off).sort((x, y) => x - y);
  const tol = Math.max(2, 1.5 * (devs[Math.floor(devs.length / 2)] ?? 0));
  const kept = pts.filter((p) => off(p) <= tol);
  return kept.length >= 8 ? fitLine(kept) : null;
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
    return robustLine(pts);
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

/** Partie de la carte d'un gros plan : coin (hg, hd, bd, bg) ou bord (h, d, b, g, anciens scans seulement). */
export type Target = "hg" | "hd" | "bd" | "bg" | "h" | "d" | "b" | "g";

// --- centrage ------------------------------------------------------------------------------------------------------

/** Largeur des quatre bordures d'une face redressée, en mm, et centrage. */
export interface Borders {
  gauche: number;
  droite: number;
  haut: number;
  bas: number;
  /** Part de la plus large des deux bordures, en % : 50 = parfait, 55 = « 55/45 ». */
  lr: number;
  tb: number;
  /**
   * Mesure fiable : bordure trouvée sur la plupart des lignes, positions resserrées, et carte entière sur l'image
   * (aucun coin coupé).
   */
  sure: boolean;
  /** Coins de l'image où la carte est coupée (bord mal repéré au redressement) : la mesure n'est alors pas fiable. */
  coupe: Corner[];
}

type Side = "gauche" | "droite" | "haut" | "bas";
/** Coin de l'image : haut gauche, haut droit, bas droit, bas gauche. */
export type Corner = "hg" | "hd" | "bd" | "bg";

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0;
};

/** Écart de couleur sous lequel un coin de l'image passe pour un morceau de carte. */
const CUT_COLOR = 50;

/**
 * Coins où la carte est coupée sur une face redressée (`mm` pixels par millimètre). Bien détourée, la carte a ses
 * coins arrondis (rayon d'environ 3 mm) : chaque coin de l'image montre le fond. Si un coin a au contraire la
 * couleur de la carte à la même profondeur, 4 à 7 mm plus loin le long d'un des deux côtés, le bord a été mal
 * repéré : la carte déborde de l'image à cet endroit (bordure rognée, centrage faussé). Avec la couleur du fond
 * mesurée autour de la carte à la prise (`mat`), le coin est comparé au fond plutôt qu'à un seuil fixe : une bordure
 * proche du fond (verso bleu foncé sur tapis noir) n'est plus prise pour un coin coupé.
 */
export function cutCorners(rgba: Uint8ClampedArray, w: number, h: number, mm = 20, mat?: number[] | null): Corner[] {
  // couleur médiane d'un rectangle repéré depuis le coin : u le long du côté horizontal, v du côté vertical (mm)
  const patch = (c: Corner, u0: number, u1: number, v0: number, v1: number) => {
    const ch: [number[], number[], number[]] = [[], [], []];
    const span = (a: number, b: number) => [Math.round(a * mm), Math.max(Math.round(a * mm) + 1, Math.round(b * mm))];
    const [ua, ub] = span(u0, u1);
    const [va, vb] = span(v0, v1);
    for (let v = va!; v < vb!; v++)
      for (let u = ua!; u < ub!; u++) {
        const x = c === "hg" || c === "bg" ? u : w - 1 - u;
        const y = c === "hg" || c === "hd" ? v : h - 1 - v;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        for (let k = 0; k < 3; k++) ch[k as 0 | 1 | 2].push(rgba[i + k] ?? 0);
      }
    return ch.map(median);
  };
  const gap = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
  return (["hg", "hd", "bd", "bg"] as const).filter((c) => {
    const corner = patch(c, 0.1, 0.5, 0.1, 0.5);
    const strips = [patch(c, 4, 7, 0.2, 0.7), patch(c, 0.2, 0.7, 4, 7)];
    // fond connu : coin plus proche du bord de carte que du fond (si fond et bord se distinguent)
    if (mat) return strips.some((p) => gap(p, mat) >= 10 && gap(corner, p) < gap(corner, mat));
    return strips.some((p) => gap(corner, p) < CUT_COLOR);
  });
}

/**
 * Couleur du fond autour de la carte, sur la photo d'origine : médiane de points pris de 4 à 10 mm à l'extérieur de
 * chaque côté (au-delà de l'ombre et d'une bordure ratée par la détection). null si la carte remplit la photo.
 */
export function matColor(rgba: Uint8ClampedArray, w: number, h: number, q: Quad): number[] | null {
  const ppm = pxPerMm(q);
  const center = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const ch: [number[], number[], number[]] = [[], [], []];
  q.forEach((a, k) => {
    const b = q[(k + 1) % 4] as Pt;
    const len = dist(a, b) || 1;
    let n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((mid.x - center.x) * n.x + (mid.y - center.y) * n.y < 0) n = { x: -n.x, y: -n.y };
    for (let i = 0; i < 10; i++)
      for (let d = 4; d <= 10; d += 1.5) {
        const t = 0.2 + (0.6 * i) / 9;
        const x = Math.round(a.x + (b.x - a.x) * t + n.x * d * ppm);
        const y = Math.round(a.y + (b.y - a.y) * t + n.y * d * ppm);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const j = (y * w + x) * 4;
        for (let c = 0; c < 3; c++) ch[c as 0 | 1 | 2].push(rgba[j + c] ?? 0);
      }
  });
  return ch[0].length >= 20 ? ch.map(median) : null;
}

/**
 * Bordure d'un côté : sur des lignes perpendiculaires au bord (au milieu du côté, loin des coins arrondis), la
 * couleur de la bordure est prise entre 0,3 et 1,2 mm du bord (le tout premier liseré, blanchi ou mal détouré, est
 * ignoré) ; la bordure s'arrête au premier pixel nettement différent (3 pixels de suite). Médiane des lignes.
 */
function side(rgba: Uint8ClampedArray, w: number, h: number, s: Side, mm: number) {
  const vertical = s === "gauche" || s === "droite";
  const along = vertical ? h : w;
  const depth = Math.min(Math.round(12 * mm), Math.floor((vertical ? w : h) / 2));
  const ref0 = Math.round(0.3 * mm);
  const ref1 = Math.round(1.2 * mm);
  const px = (line: number, t: number): [number, number, number] => {
    const [x, y] =
      s === "gauche" ? [t, line] : s === "droite" ? [w - 1 - t, line] : s === "haut" ? [line, t] : [line, h - 1 - t];
    const i = (y * w + x) * 4;
    return [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0];
  };
  // trois lignes voisines moyennées : moins de bruit (grain, compression JPEG)
  const at = (line: number, t: number) => {
    const a = px(line - 1, t);
    const b = px(line, t);
    const c = px(line + 1, t);
    return [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
  };
  const found: number[] = [];
  let lines = 0;
  for (let line = Math.round(along * 0.2); line < along * 0.8; line += 4) {
    lines++;
    const ref: number[][] = [];
    for (let t = ref0; t < ref1; t++) ref.push(at(line, t));
    const c = [0, 1, 2].map((k) => median(ref.map((p) => p[k]!)));
    const dist = (p: number[]) => Math.hypot(p[0]! - c[0]!, p[1]! - c[1]!, p[2]! - c[2]!);
    const noise = median(ref.map(dist));
    const limit = Math.max(30, 5 * noise);
    let run = 0;
    for (let t = ref1; t < depth; t++) {
      run = dist(at(line, t)) > limit ? run + 1 : 0;
      if (run === 3) {
        found.push(t - 2);
        break;
      }
    }
  }
  const sorted = [...found].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] ?? 0;
  return { px: median(found), share: lines ? found.length / lines : 0, spread: q(0.75) - q(0.25) };
}

/**
 * Bordures d'une face redressée (`mm` pixels par millimètre, 20 pour le scanner) : centrage gauche/droite et
 * haut/bas, comme PSA le juge (« 55/45 »). null si aucune bordure n'est reconnaissable (photo inexploitable).
 * `mat` : couleur du fond mesurée à la prise, pour reconnaître les coins coupés (voir `cutCorners`).
 */
export function borders(rgba: Uint8ClampedArray, w: number, h: number, mm = 20, mat?: number[] | null): Borders | null {
  const m: Record<Side, ReturnType<typeof side>> = {
    gauche: side(rgba, w, h, "gauche", mm),
    droite: side(rgba, w, h, "droite", mm),
    haut: side(rgba, w, h, "haut", mm),
    bas: side(rgba, w, h, "bas", mm),
  };
  const all = Object.values(m);
  if (all.some((r) => r.share < 0.3)) return null;
  const v = (s: Side) => Math.round((m[s].px / mm) * 100) / 100;
  const pct = (a: number, b: number) => Math.round((1000 * Math.max(a, b)) / (a + b)) / 10;
  const [g, d, ht, b] = [v("gauche"), v("droite"), v("haut"), v("bas")];
  const coupe = cutCorners(rgba, w, h, mm, mat);
  return {
    gauche: g,
    droite: d,
    haut: ht,
    bas: b,
    lr: pct(g, d),
    tb: pct(ht, b),
    sure: !coupe.length && all.every((r) => r.share >= 0.7 && r.spread <= 0.5 * mm),
    coupe,
  };
}

// --- scanner : résolution, retournement, bord réel, zones de la carte ----------------------------------------------

/** Résolution de la carte sur la photo, en pixels par mm (côtés moyens rapportés à 63 × 88 mm). */
export function pxPerMm(q: Quad): number {
  const s = quadShape(q);
  return (s.width / 63 + s.height / 88) / 2;
}

/**
 * Quadrilatère de la photo qui couvre la zone [u0, u1] × [v0, v1] de la carte (mm depuis son coin haut gauche),
 * au-delà de la carte comprise : gros plan d'un coin avec un peu de fond autour, comme vu de près.
 */
export function cardRegion(q: Quad, u0: number, v0: number, u1: number, v1: number): Quad {
  const H = homography(
    [
      { x: 0, y: 0 },
      { x: 63, y: 0 },
      { x: 63, y: 88 },
      { x: 0, y: 88 },
    ],
    q,
  );
  const at = (u: number, v: number) => project(H, { x: u, y: v });
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

const SIG_W = 18;
const SIG_H = 25;

/**
 * Empreinte d'une face : la carte redressée en 18 × 25 niveaux de gris (moyennes de blocs 4 × 4), centrée et réduite
 * (indépendante de l'exposition). Sert à voir que la carte a été retournée.
 */
export function signature(rgba: Uint8ClampedArray, w: number, h: number, q: Quad): Float32Array {
  const g = gray(warp(rgba, w, h, q, SIG_W * 4, SIG_H * 4), SIG_W * 4, SIG_H * 4);
  const out = new Float32Array(SIG_W * SIG_H);
  for (let y = 0; y < SIG_H * 4; y++)
    for (let x = 0; x < SIG_W * 4; x++) out[(y >> 2) * SIG_W + (x >> 2)]! += (g[y * SIG_W * 4 + x] ?? 0) / 16;
  const mean = out.reduce((a, b) => a + b, 0) / out.length;
  const sd = Math.sqrt(out.reduce((a, b) => a + (b - mean) ** 2, 0) / out.length) || 1;
  return out.map((v) => (v - mean) / sd);
}

/** Ressemblance de deux empreintes (corrélation, de -1 à 1) ; la carte peut avoir fait un demi-tour sur la table. */
export function sameFace(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let straight = 0;
  let turned = 0;
  for (let i = 0; i < n; i++) {
    straight += a[i]! * b[i]!;
    turned += a[i]! * b[n - 1 - i]!;
  }
  return n ? Math.max(straight, turned) / n : 0;
}

/**
 * Bord réel d'une carte coupée sur la photo (contour passé à l'intérieur : bordure foncée confondue avec un fond
 * sombre, ligne de texte prise pour le bord). Chaque côté est repoussé jusqu'au dernier net changement de couleur
 * dans les 5 mm vers l'extérieur, puis les coins redeviennent les intersections des droites. Un côté sans bord net
 * plus loin reste en place ; à n'adopter que si les coins de l'image montrent ensuite le fond (`cutCorners`).
 */
export function growQuad(rgba: Uint8ClampedArray, w: number, h: number, q: Quad): Quad {
  const ppm = pxPerMm(q);
  const reach = Math.round(5 * ppm);
  const skip = Math.max(3, Math.round(0.3 * ppm));
  const center = { x: q.reduce((s, p) => s + p.x, 0) / 4, y: q.reduce((s, p) => s + p.y, 0) / 4 };
  const at = (x: number, y: number) => {
    const i = (Math.min(h - 1, Math.max(0, Math.round(y))) * w + Math.min(w - 1, Math.max(0, Math.round(x)))) * 4;
    return [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0];
  };
  const lines = q.map((a, k) => {
    const b = q[(k + 1) % 4] as Pt;
    const len = dist(a, b) || 1;
    const e = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
    let n = { x: -e.y, y: e.x };
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if ((mid.x - center.x) * n.x + (mid.y - center.y) * n.y < 0) n = { x: -n.x, y: -n.y }; // vers l'extérieur
    const pts: Pt[] = [];
    for (let i = 0; i < 24; i++) {
      const t = 0.15 + (0.7 * i) / 23;
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      // profil de couleur vers l'extérieur, moyenné sur 3 points le long du bord (grain, compression)
      const prof: number[][] = [];
      for (let s = 0; s <= reach; s++) {
        const c = [0, 0, 0];
        for (const o of [-1, 0, 1]) {
          const v = at(p.x + n.x * s + e.x * o * 2, p.y + n.y * s + e.y * o * 2);
          for (let k2 = 0; k2 < 3; k2++) c[k2]! += v[k2]! / 3;
        }
        prof.push(c);
      }
      const step = (s: number) => {
        const u = prof[s + 2]!;
        const v = prof[s - 2]!;
        return Math.hypot(u[0]! - v[0]!, u[1]! - v[1]!, u[2]! - v[2]!);
      };
      let best = 0;
      for (let s = skip; s <= reach - 2; s++) best = Math.max(best, step(s));
      if (best < 15) continue;
      // dernier changement net vers l'extérieur : centre (pondéré) de la plage où la variation dépasse le seuil
      const limit = Math.max(15, 0.25 * best);
      let end = reach - 2;
      while (end >= skip && step(end) < limit) end--;
      let [sum, weight] = [0, 0];
      for (let s = end; s >= skip && step(s) >= limit; s--) [sum, weight] = [sum + s * step(s), weight + step(s)];
      const at0 = sum / weight;
      pts.push({ x: p.x + n.x * at0, y: p.y + n.y * at0 });
    }
    return robustLine(pts) ?? { c: mid, d: e };
  });
  const out: Pt[] = [];
  for (let k = 0; k < 4; k++) {
    const p = intersect(lines[(k + 3) % 4]!, lines[k]!);
    if (!p || dist(p, q[k] as Pt) > reach * 1.5) return q;
    out.push(p);
  }
  return out as Quad;
}
