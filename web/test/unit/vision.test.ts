import { describe, expect, it } from "vitest";
import {
  CARD_RATIO,
  detectCard,
  framing,
  glare,
  gray,
  homography,
  motion,
  otsu,
  project,
  quadMotion,
  quadShape,
  refineQuad,
  sharpness,
  warp,
  type Pt,
  type Quad,
} from "../../src/client/vision";

/** Carte claire (texture en damier, bordure unie) tournée d'un angle donné, sur un tapis sombre, anticrénelée. */
function scene(w: number, h: number, quad: Quad, opts: { card?: number; bg?: number; hot?: boolean } = {}) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const card = opts.card ?? 200;
  const bg = opts.bg ?? 25;
  // côté signé de chaque arête (quadrilatère convexe, sens horaire en coordonnées image)
  const inside = (x: number, y: number) =>
    quad.every((a, i) => {
      const b = quad[(i + 1) % 4]!;
      return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x) >= 0;
    });
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
      const f = n / 16;
      // damier discret dans la carte : donne du détail pour la netteté
      const tex = ((x >> 3) + (y >> 3)) % 2 ? 0 : 30;
      const v = bg * (1 - f) + (card - tex * f) * f;
      const i = (y * w + x) * 4;
      rgba[i] = rgba[i + 1] = rgba[i + 2] = v;
      rgba[i + 3] = 255;
    }
  if (opts.hot) {
    const c = quad.reduce((s, p) => ({ x: s.x + p.x / 4, y: s.y + p.y / 4 }), { x: 0, y: 0 });
    for (let y = Math.round(c.y) - 12; y < c.y + 12; y++)
      for (let x = Math.round(c.x) - 12; x < c.x + 12; x++) {
        const i = (y * w + x) * 4;
        rgba[i] = rgba[i + 1] = rgba[i + 2] = 255;
      }
  }
  return rgba;
}

/** Rectangle 63:88 de hauteur `hgt`, centré en (cx, cy), tourné de `deg` degrés. */
function card(cx: number, cy: number, hgt: number, deg: number): Quad {
  const a = (deg * Math.PI) / 180;
  const hw = (hgt * CARD_RATIO) / 2;
  const hh = hgt / 2;
  return [
    [-hw, -hh],
    [hw, -hh],
    [hw, hh],
    [-hw, hh],
  ].map(([x, y]) => ({
    x: cx + x! * Math.cos(a) - y! * Math.sin(a),
    y: cy + x! * Math.sin(a) + y! * Math.cos(a),
  })) as Quad;
}

const near = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

describe("scanner : repérage de la carte", () => {
  it("trouve la carte et ses coins, même tournée ; forme 63:88", () => {
    const [w, h] = [240, 320];
    const truth = card(120, 160, 230, 8);
    const g = gray(scene(w, h, truth), w, h);
    expect(otsu(g)).toBeGreaterThan(30);
    const d = detectCard(g, w, h);
    expect(d).not.toBeNull();
    d!.quad.forEach((p, i) => expect(near(p, truth[i]!)).toBeLessThan(4));
    expect(d!.clipped).toBe(false);
    expect(d!.area).toBeGreaterThan(0.4);
    const s = quadShape(d!.quad);
    expect(s.ratio).toBeCloseTo(CARD_RATIO, 1);
    expect(s.skew).toBeLessThan(4);
  });
  it("fond clair : la carte est la zone sombre ; carte qui dépasse signalée ; rien sur une image vide", () => {
    const [w, h] = [200, 260];
    const truth = card(100, 130, 200, -5);
    const d = detectCard(gray(scene(w, h, truth, { card: 40, bg: 230 }), w, h), w, h);
    d!.quad.forEach((p, i) => expect(near(p, truth[i]!)).toBeLessThan(4));
    // carte trop près : elle dépasse en haut et en bas (le fond reste visible sur les côtés)
    const big = detectCard(gray(scene(300, h, card(150, 130, 300, 0)), 300, h), 300, h);
    expect(big?.clipped).toBe(true);
    expect(detectCard(new Uint8Array(w * h).fill(20), w, h)).toBeNull();
  });
  it("affinage à pleine résolution : coins à moins d'un pixel", () => {
    const [w, h] = [480, 640];
    const truth = card(240, 320, 500, 3);
    const g = gray(scene(w, h, truth), w, h);
    // estimation grossière (comme celle de l'image d'analyse réduite, remise à l'échelle) : décalée de quelques pixels
    const rough = truth.map((p, i) => ({ x: p.x + (i % 2 ? 4 : -3), y: p.y + (i < 2 ? -4 : 3) })) as Quad;
    const fine = refineQuad(g, w, h, rough);
    fine.forEach((p, i) => expect(near(p, truth[i]!)).toBeLessThan(1));
  });
  it("mouvement et stabilité", () => {
    const a = card(120, 160, 200, 0);
    const b = card(122, 160, 200, 0);
    expect(quadMotion(a, b, 240, 320)).toBeCloseTo(2 / Math.hypot(240, 320), 5);
    const g1 = new Uint8Array(100).fill(10);
    const g2 = new Uint8Array(100).fill(30);
    expect(motion(g1, g1)).toBe(0);
    expect(motion(g1, g2)).toBe(20);
  });
});

describe("scanner : qualité de la prise", () => {
  it("netteté : une image floue score moins qu'une image nette", () => {
    const [w, h] = [160, 160];
    const sharp = gray(scene(w, h, card(80, 80, 140, 0)), w, h);
    const blurred = new Uint8Array(w * h);
    for (let y = 2; y < h - 2; y++)
      for (let x = 2; x < w - 2; x++) {
        let s = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) s += sharp[(y + dy) * w + x + dx]!;
        blurred[y * w + x] = s / 25;
      }
    expect(sharpness(sharp, w, h)).toBeGreaterThan(2 * sharpness(blurred, w, h));
  });
  it("reflets : pixels saturés au centre de la carte", () => {
    const [w, h] = [200, 260];
    const q = card(100, 130, 200, 0);
    expect(glare(scene(w, h, q), w, q)).toBe(0);
    expect(glare(scene(w, h, q, { hot: true }), w, q)).toBeGreaterThan(0.02);
  });
  it("gros plan : le coin ou le bord demandé est bien au centre du cadre", () => {
    const [w, h] = [200, 200];
    // coin haut gauche de la carte au centre de l'image : la carte occupe le quart bas droit
    const g = gray(
      scene(w, h, [
        { x: 100, y: 100 },
        { x: 400, y: 100 },
        { x: 400, y: 400 },
        { x: 100, y: 400 },
      ]),
      w,
      h,
    );
    const r = { x: 0, y: 0, w, h };
    expect(framing(g, w, r, "hg")).toBeGreaterThan(100);
    expect(framing(g, w, r, "bd")).toBe(0);
    expect(framing(g, w, r, "h")).toBeGreaterThan(40);
    expect(framing(g, w, r, "g")).toBeGreaterThan(40);
    expect(framing(g, w, r, "d")).toBe(0);
  });
});

describe("scanner : redressement", () => {
  it("homographie : les coins tombent juste, et retour à l'identique", () => {
    const from = card(300, 400, 500, 10);
    const to: Quad = [
      { x: 0, y: 0 },
      { x: 630, y: 0 },
      { x: 630, y: 880 },
      { x: 0, y: 880 },
    ];
    const H = homography(from, to);
    from.forEach((p, i) => expect(near(project(H, p), to[i]!)).toBeLessThan(1e-6));
    expect(() => homography([to[0], to[0], to[0], to[0]], to)).toThrow();
  });
  it("la carte redressée remplit l'image : bords clairs, aucun fond sombre", () => {
    const [w, h] = [300, 400];
    const q = card(150, 200, 330, 12);
    const flat = warp(scene(w, h, q), w, h, q, 63, 88);
    expect(flat.length).toBe(63 * 88 * 4);
    // échantillons près des quatre bords (à 2 px) : carte (≥ 150), pas fond (25)
    for (const [x, y] of [
      [2, 44],
      [60, 44],
      [31, 2],
      [31, 85],
    ])
      expect(flat[(y! * 63 + x!) * 4]).toBeGreaterThan(150);
  });
});
