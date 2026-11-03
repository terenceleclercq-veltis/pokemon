import { describe, expect, it } from "vitest";
import {
  borders,
  CARD_RATIO,
  cardRegion,
  cutCorners,
  detectCard,
  glare,
  gray,
  growQuad,
  homography,
  matColor,
  otsu,
  project,
  pxPerMm,
  quadMotion,
  quadShape,
  refineQuad,
  sameFace,
  sharpness,
  signature,
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

/** Fond sombre (tapis) des faces synthétiques. */
const MAT = [30, 24, 28];

/**
 * Face redressée synthétique (`mm` px/mm) : carte aux coins arrondis (3 mm) sur le tapis, bordure unie, liseré blanchi
 * au bord, illustration texturée. `cut` : mm de carte perdus sous le bas de l'image (bord mal repéré au redressement).
 */
function face(
  mm: number,
  b: { g: number; d: number; h: number; b: number },
  border: number[],
  art: (x: number, y: number) => number[],
  cut = 0,
) {
  const [w, h] = [63 * mm, 88 * mm];
  const tall = 88 + cut;
  const rgba = new Uint8ClampedArray(w * h * 4);
  let seed = 7;
  const noise = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5) * 8;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      // position sur la carte, en mm
      const [u, v] = [(x + 0.5) / mm, (y + 0.5) / mm];
      const dx = Math.max(3 - u, u - 60, 0);
      const dy = Math.max(3 - v, v - (tall - 3), 0);
      const inBorder = u < b.g || u >= 63 - b.d || v < b.h || v >= tall - b.b;
      const edge = u < 0.15 || u >= 63 - 0.15 || v < 0.15 || v >= tall - 0.15;
      const c = Math.hypot(dx, dy) > 3 ? MAT : edge ? [245, 245, 245] : inBorder ? border : art(x, y);
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) rgba[i + k] = c[k]! + noise();
      rgba[i + 3] = 255;
    }
  return { rgba, w, h };
}

describe("scanner : centrage", () => {
  it("recto full art : bordures mesurées au dixième de mm, centrage 58/42 à gauche-droite", () => {
    const mm = 10;
    const { rgba, w, h } = face(mm, { g: 2.5, d: 3.5, h: 3, b: 3 }, [228, 196, 52], (x, y) =>
      ((x >> 4) + (y >> 4)) % 2 ? [40, 120, 200] : [200, 60, 90],
    );
    const r = borders(rgba, w, h, mm)!;
    expect(r).not.toBeNull();
    expect(r.gauche).toBeCloseTo(2.5, 0);
    expect(Math.abs(r.gauche - 2.5)).toBeLessThan(0.15);
    expect(Math.abs(r.droite - 3.5)).toBeLessThan(0.15);
    expect(Math.abs(r.haut - 3)).toBeLessThan(0.15);
    expect(Math.abs(r.bas - 3)).toBeLessThan(0.15);
    expect(r.lr).toBeGreaterThan(57);
    expect(r.lr).toBeLessThan(59.5);
    expect(r.tb).toBeLessThan(51.5);
    expect(r.sure).toBe(true);
    expect(r.coupe).toEqual([]);
  });
  it("verso : bordure bleue, motif plus sombre ; image uniforme : pas de mesure", () => {
    const mm = 10;
    const { rgba, w, h } = face(mm, { g: 5, d: 5, h: 4.2, b: 5.8 }, [45, 95, 205], (x, y) =>
      Math.sin(x / 9) * Math.cos(y / 11) > 0 ? [20, 50, 140] : [30, 70, 165],
    );
    const r = borders(rgba, w, h, mm)!;
    expect(Math.abs(r.gauche - 5)).toBeLessThan(0.15);
    expect(Math.abs(r.haut - 4.2)).toBeLessThan(0.15);
    expect(r.tb).toBeGreaterThan(57);
    expect(r.tb).toBeLessThan(59);
    expect(r.lr).toBeLessThan(51);
    expect(r.sure).toBe(true);
    const flat = face(mm, { g: 3, d: 3, h: 3, b: 3 }, [200, 200, 200], () => [200, 200, 200]);
    expect(borders(flat.rgba, flat.w, flat.h, mm)).toBeNull();
  });
  it("carte coupée en bas (bord mal repéré) : coins du bas signalés, bordure trop fine, mesure non fiable", () => {
    const mm = 10;
    const art = (x: number, y: number) => (((x >> 4) + (y >> 4)) % 2 ? [40, 120, 200] : [200, 60, 90]);
    const { rgba, w, h } = face(mm, { g: 3, d: 3, h: 3, b: 3 }, [200, 190, 185], art, 2);
    expect(cutCorners(rgba, w, h, mm)).toEqual(["bd", "bg"]);
    const r = borders(rgba, w, h, mm)!;
    // 1 mm de bordure restant en bas, lue entre 1 et 1,5 mm : centrage haut-bas faussé, au-delà de 65/35
    expect(r.bas).toBeLessThan(1.5);
    expect(r.tb).toBeGreaterThan(65);
    expect(r).toMatchObject({ sure: false, coupe: ["bd", "bg"] });
  });
  it("verso sur fond sombre : bordure bleu foncé confondue avec le fond, carte coupée ; sur fond clair : entière", () => {
    const [w, h] = [480, 640];
    const shot = (bg: number[]) => {
      const rgba = back(w, h, bg);
      const g = gray(rgba, w, h);
      const d = detectCard(g, w, h)!;
      const q = refineQuad(g, w, h, d.quad);
      return cutCorners(warp(rgba, w, h, q, 630, 880), 630, 880, 10);
    };
    expect(shot([55, 42, 45])).toEqual(["hg", "hd", "bd", "bg"]);
    expect(shot([235, 235, 230])).toEqual([]);
  });
});

interface PhotoOpts {
  deg?: number;
  edge?: number[];
  art?: (u: number, v: number) => number[];
  gain?: number;
}

/**
 * Photo synthétique d'une carte aux coins arrondis (63 × 88 mm, 80 % de la hauteur), tournée de `deg` degrés, sur le
 * fond `bg` : bordure `edge` de 3,5 mm, illustration `art(u, v)` (mm). Par défaut, un verso : bordure bleu foncé,
 * motif bleu clair. `gain` : exposition.
 */
function photo(w: number, h: number, bg: number[], o: PhotoOpts = {}) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const s = (h * 0.8) / 88; // px par mm
  const a = ((o.deg ?? 4) * Math.PI) / 180;
  const edge = o.edge ?? [40, 38, 64];
  const art = o.art ?? ((u: number, v: number) => (Math.sin(u / 3 + v / 5) > 0 ? [110, 150, 200] : [90, 130, 185]));
  const gain = o.gain ?? 1;
  const color = (x: number, y: number) => {
    // repère de la carte, en mm depuis son coin haut gauche
    const [dx, dy] = [x - w / 2, y - h / 2];
    const u = (dx * Math.cos(a) + dy * Math.sin(a)) / s + 31.5;
    const v = (-dx * Math.sin(a) + dy * Math.cos(a)) / s + 44;
    const out = Math.hypot(Math.max(3 - u, u - 60, 0), Math.max(3 - v, v - 85, 0)) > 3;
    if (u < 0 || u > 63 || v < 0 || v > 88 || out) return bg;
    return (u < 3.5 || u > 59.5 || v < 3.5 || v > 84.5 ? edge : art(u, v)).map((c) => c * gain);
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const c = color(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
          for (let k = 0; k < 3; k++) sum[k]! += c[k]! / 9;
        }
      const i = (y * w + x) * 4;
      for (let k = 0; k < 3; k++) rgba[i + k] = sum[k]!;
      rgba[i + 3] = 255;
    }
  return rgba;
}
const back = (w: number, h: number, bg: number[]) => photo(w, h, bg);

/** Coins réels de la carte de `photo` (haut gauche, haut droit, bas droit, bas gauche de la carte). */
function truth(w: number, h: number, deg = 4): Quad {
  const s = (h * 0.8) / 88;
  const a = (deg * Math.PI) / 180;
  return [
    [0, 0],
    [63, 0],
    [63, 88],
    [0, 88],
  ].map(([u, v]) => {
    const [dx, dy] = [(u! - 31.5) * s, (v! - 44) * s];
    return { x: w / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: h / 2 + dx * Math.sin(a) + dy * Math.cos(a) };
  }) as Quad;
}

describe("scanner : bord réel, retournement, résolution", () => {
  it("verso sur fond sombre, coupé à la détection : le vrai bord est retrouvé à moins de 0,5 mm", () => {
    const [w, h] = [480, 640];
    const rgba = photo(w, h, [55, 42, 45]);
    const g = gray(rgba, w, h);
    const q = refineQuad(g, w, h, detectCard(g, w, h)!.quad);
    // fond mesuré autour du contour : à 4-10 mm, au-delà de la bordure perdue
    const cut = (quad: Quad) => cutCorners(warp(rgba, w, h, quad, 630, 880), 630, 880, 10, matColor(rgba, w, h, quad));
    expect(matColor(rgba, w, h, q)).toEqual([55, 42, 45]);
    expect(cut(q)).toHaveLength(4);
    const grown = growQuad(rgba, w, h, q);
    // bordure bleu foncé et tapis noir proches : sans le fond mesuré, les coins passeraient pour coupés
    expect(cutCorners(warp(rgba, w, h, grown, 630, 880), 630, 880, 10)).toHaveLength(4);
    expect(cut(grown)).toEqual([]);
    const ppm = pxPerMm(grown);
    truth(w, h).forEach((p, i) => expect(near(p, grown[i]!) / ppm).toBeLessThan(0.5));
  });
  it("carte bien détourée sur fond uni : rien ne bouge", () => {
    const [w, h] = [480, 640];
    const rgba = photo(w, h, [235, 235, 230]);
    const g = gray(rgba, w, h);
    const q = refineQuad(g, w, h, detectCard(g, w, h)!.quad);
    growQuad(rgba, w, h, q).forEach((p, i) => expect(near(p, q[i]!)).toBeLessThan(1));
  });
  it("retournement : même face malgré l'exposition ou un demi-tour sur la table, autre face reconnue", () => {
    const [w, h] = [360, 480];
    const bg = [30, 28, 32];
    const edge = [200, 200, 195];
    const art = (u: number, v: number) =>
      Math.hypot(u - 31.5, v - 28) < 12 ? [230, 80, 60] : [80 + u * 2, 120, 90 + v];
    const sig = (rgba: Uint8ClampedArray) => {
      const g = gray(rgba, w, h);
      return signature(rgba, w, h, refineQuad(g, w, h, detectCard(g, w, h)!.quad));
    };
    const recto = sig(photo(w, h, bg, { edge, art }));
    expect(sameFace(recto, sig(photo(w, h, bg, { edge, art, gain: 0.7 })))).toBeGreaterThan(0.9);
    expect(sameFace(recto, sig(photo(w, h, bg, { edge, art, deg: 184 })))).toBeGreaterThan(0.8);
    expect(sameFace(recto, sig(photo(w, h, bg)))).toBeLessThan(0.4);
  });
  it("résolution de la carte sur la photo ; zone de carte au-delà des bords", () => {
    const q = truth(480, 640);
    expect(pxPerMm(q)).toBeCloseTo((640 * 0.8) / 88, 2);
    cardRegion(q, 0, 0, 63, 88).forEach((p, i) => expect(near(p, q[i]!)).toBeLessThan(1e-6));
    const corner = cardRegion(q, -3, -3, 12, 12);
    expect(near(corner[0], q[0]) / pxPerMm(q)).toBeCloseTo(3 * Math.SQRT2, 3);
  });
});
