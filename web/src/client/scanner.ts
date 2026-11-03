// Scanner : deux photos, recto puis verso, à la meilleure définition de l'appareil. Comme les scanners de documents
// (Notes d'iOS, ML Kit) : la carte est repérée sur n'importe quel fond, la photo part toute seule quand l'image est
// stable, le contour reste vérifiable et ajustable. Le verso se prend tout seul quand la carte est retournée. Les
// gros plans des quatre coins sont découpés dans la photo d'origine ; un contour passé à l'intérieur de la carte
// (bordure confondue avec le fond) est repoussé jusqu'au vrai bord. Puis carte suivante, en série.
// Repli : l'appareil photo du téléphone (photo contrôlée et traitée de la même façon).
import { api, type Species } from "./api";
import { $, $as, action, h } from "./dom";
import { editQuad } from "./quad-editor";
import { cardImg, store } from "./state";
import {
  CARD_RATIO,
  cardRegion,
  cutCorners,
  detectCard,
  glare,
  gray,
  growQuad,
  matColor,
  pxPerMm,
  quadMotion,
  quadShape,
  refineQuad,
  sameFace,
  sharpness,
  signature,
  warp,
  type Corner,
  type Quad,
  type Rect,
  type Target,
} from "./vision";

type Side = "recto" | "verso";
export interface Step {
  id: string;
  side: Side;
  /** Gros plan : coin ou bord ; absent pour la vue entière. */
  target?: Target;
  label: string;
}
interface Shot {
  blob: Blob;
  thumb: Blob;
  url: string;
  w: number;
  h: number;
  /** Coins de la carte sur la photo d'origine (vues entières). */
  quad?: Quad;
  sharp: number;
  /** Couleur du fond autour de la carte (vues entières). */
  fond?: number[] | null;
}
/** Une face prise : photo d'origine (pour ajuster le contour), contour, qualité, vue redressée et gros plans. */
interface Face {
  side: Side;
  source: Blob;
  /** Dimensions de la photo d'origine telle que traitée (coordonnées du contour). */
  sw: number;
  sh: number;
  quad: Quad;
  ppm: number;
  fond: number[] | null;
  cut: Corner[];
  glare: number;
  sig: Float32Array;
  view: Shot;
  corners: Record<Corner, Shot>;
  origin: "photo" | "video" | "fichier";
}
interface Verdict {
  ok: boolean;
  msg: string;
  quad?: Quad;
}

const SIDE = { recto: "Recto", verso: "Verso" } as const;
const CORNERS: Corner[] = ["hg", "hd", "bd", "bg"];
const PART: Record<Target, string> = {
  hg: "coin haut gauche",
  hd: "coin haut droit",
  bd: "coin bas droit",
  bg: "coin bas gauche",
  h: "bord du haut",
  d: "bord droit",
  b: "bord du bas",
  g: "bord gauche",
};

/** Étapes enregistrées : vue entière puis gros plans, pour chaque face (les bords : anciens scans seulement). */
export function scanSteps(edges: boolean): Step[] {
  const zoom: Target[] = ["hg", "hd", "bd", "bg", ...(edges ? (["h", "d", "b", "g"] as const) : [])];
  return (["recto", "verso"] as const).flatMap((side) => [
    { id: side, side, label: `${SIDE[side]} entier` },
    ...zoom.map((t) => ({ id: `${side}-${t}`, side, target: t, label: `${SIDE[side]} · ${PART[t]}` })),
  ]);
}

const FLAT_W = 1260; // 63 mm à 20 px/mm
const FLAT_H = 1760; // 88 mm
const ANALYSIS = 360; // largeur de l'image analysée en direct
const HOLD = 4; // images valides d'affilée avant de déclencher
const MAX_PIXELS = 16_000_000; // limite des canevas sur iOS
/** Gros plan découpé : 12 mm de carte autour du coin et 3 mm de fond, à la définition d'origine (60 px/mm au plus). */
const CROP_MM = 15;
const CROP_PPM = [20, 60] as const;
/** Définition sous laquelle les détails fins (blanchiment d'un coin) deviennent difficiles à lire. */
const MIN_PPM = 25;
/** Ressemblance au-delà de laquelle la carte montre encore la face déjà prise (pas encore retournée). */
const SAME_FACE = 0.55;

let species: Species;
let onSaved: (num: number) => void = () => undefined;
let side: Side = "recto";
/** Reprise d'une seule face depuis le récapitulatif. */
let only = false;
const faces: Partial<Record<Side, Face>> = {};
let stream: MediaStream | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let ok = 0;
let peak = 0;
let prevQuad: Quad | null = null;
/** Empreinte de la carte sur la dernière image en direct (contrôle d'une photo pleine définition). */
let liveSig: Float32Array | null = null;
let lastMsg = "";
let savedScan: string | null = null;
const uploaded = new Set<string>();

const dialog = () => $as("scan", HTMLDialogElement);
const video = () => $as("scan-video", HTMLVideoElement);
const analysis = document.createElement("canvas");

function canvas(w: number, hgt: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("canevas indisponible");
  return [c, ctx];
}
/** Libère la mémoire d'un grand canevas tout de suite (Safari compte la mémoire des canevas). */
const drop = (c: HTMLCanvasElement) => {
  c.width = c.height = 0;
};

const toBlob = (c: HTMLCanvasElement, quality: number) =>
  new Promise<Blob>((resolve, reject) => {
    c.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("photo illisible"));
      },
      "image/jpeg",
      quality,
    );
  });

function say(msg: string): void {
  if (msg === lastMsg) return;
  lastMsg = msg;
  $("scan-msg").textContent = msg;
}

function show(part: "live" | "review" | "edit" | "done"): void {
  for (const p of ["live", "review", "edit", "done"] as const) $(`scan-${p}`).hidden = p !== part;
}

const bbox = (q: Quad): Rect => {
  const xs = q.map((p) => p.x);
  const ys = q.map((p) => p.y);
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
  };
};

// --- caméra --------------------------------------------------------------------------------------------------------

async function startCamera(): Promise<boolean> {
  if (stream) return true;
  // absent hors HTTPS et sur de vieux navigateurs, malgré les types
  const media = (navigator as { mediaDevices?: Partial<MediaDevices> }).mediaDevices;
  if (!media?.getUserMedia) {
    say("Caméra en direct indisponible ici : utilise « Appareil photo ».");
    return false;
  }
  try {
    // la plus haute définition proposée (4:3 si possible, le format photo des capteurs)
    stream = await media.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 4032 }, height: { ideal: 3024 } },
    });
  } catch {
    say("Accès à la caméra refusé : autorise-le dans le navigateur, ou utilise « Appareil photo ».");
    return false;
  }
  video().srcObject = stream;
  await video()
    .play()
    .catch(() => undefined);
  return true;
}

function stopCamera(): void {
  clearTimeout(timer);
  for (const t of stream?.getTracks() ?? []) t.stop();
  stream = null;
  video().srcObject = null;
  const c = $as("scan-overlay", HTMLCanvasElement);
  c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
}

type Still = { takePhoto(): Promise<Blob>; getPhotoCapabilities?(): Promise<{ imageWidth?: { max?: number } }> };
const timeout = <T>(p: Promise<T>, ms: number) =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        reject(new Error("délai dépassé"));
      }, ms);
    }),
  ]);

/**
 * Photo pleine définition par l'appareil (ImageCapture : Chrome, Safari 18.4 et plus), quand il annonce mieux que la
 * vidéo. L'orientation et le cadrage d'une photo pouvant différer de la vidéo, la carte y est cherchée (photo telle
 * quelle, ou tournée d'un quart de tour) et comparée à celle de l'image en direct ; sinon, repli sur la vidéo.
 */
async function stillPhoto(live: Float32Array): Promise<{ c: HTMLCanvasElement; blob: Blob } | null> {
  const track = stream?.getVideoTracks()[0];
  const IC = (window as { ImageCapture?: new (t: MediaStreamTrack) => Still }).ImageCapture;
  if (!track || !IC) return null;
  try {
    const ic = new IC(track);
    const caps = await ic.getPhotoCapabilities?.().catch(() => undefined);
    const v = video();
    if (!((caps?.imageWidth?.max ?? 0) > Math.max(v.videoWidth, v.videoHeight))) return null;
    const blob = await timeout(ic.takePhoto(), 5000);
    const bmp = await createImageBitmap(blob);
    const portrait = v.videoHeight > v.videoWidth;
    const turns = bmp.height > bmp.width === portrait ? [0] : [90, 270];
    let best: { c: HTMLCanvasElement; score: number; turn: number } | null = null;
    for (const turn of turns) {
      const c = fit(bmp, turn);
      const quad = coarse(c);
      if (quad) {
        const small = shrink(c);
        const k = small.width / c.width;
        const sq = quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;
        const data = small.getContext("2d")?.getImageData(0, 0, small.width, small.height).data;
        const score = data ? sameFace(signature(data, small.width, small.height, sq), live) : 0;
        drop(small);
        if (!best || score > best.score) {
          if (best) drop(best.c);
          best = { c, score, turn };
          continue;
        }
      }
      drop(c);
    }
    bmp.close();
    if (!best || best.score < 0.6) {
      if (best) drop(best.c);
      return null;
    }
    return { c: best.c, blob: best.turn ? await toBlob(best.c, 0.92) : blob };
  } catch {
    return null;
  }
}

/** Image (ou photo) dans un canevas, tournée de `turn` degrés et réduite sous la limite des canevas d'iOS. */
function fit(img: CanvasImageSource & { width: number; height: number }, turn = 0): HTMLCanvasElement {
  const k = Math.min(1, Math.sqrt(MAX_PIXELS / (img.width * img.height)));
  const [w, hgt] = [Math.round(img.width * k), Math.round(img.height * k)];
  const [c, ctx] = turn ? canvas(hgt, w) : canvas(w, hgt);
  if (turn) {
    ctx.translate(c.width / 2, c.height / 2);
    ctx.rotate((turn * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -hgt / 2, w, hgt);
  } else ctx.drawImage(img, 0, 0, w, hgt);
  return c;
}

/** Copie réduite (ANALYSIS px de large) pour le repérage. */
function shrink(c: HTMLCanvasElement): HTMLCanvasElement {
  const [s, ctx] = canvas(ANALYSIS, Math.round((c.height / c.width) * ANALYSIS));
  ctx.drawImage(c, 0, 0, s.width, s.height);
  return s;
}

/** Contour approximatif de la carte sur une image entière (repérage sur copie réduite) ; null si introuvable. */
function coarse(c: HTMLCanvasElement): Quad | null {
  const s = shrink(c);
  const ctx = s.getContext("2d");
  const d = ctx
    ? detectCard(gray(ctx.getImageData(0, 0, s.width, s.height).data, s.width, s.height), s.width, s.height)
    : null;
  const k = c.width / s.width;
  drop(s);
  if (!d || d.clipped || d.area < 0.05) return null;
  return d.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad;
}

// --- contrôle en direct --------------------------------------------------------------------------------------------

const keep = (msg: string, quad?: Quad): Verdict => ({ ok: false, msg, quad });

/** Contrôles légers : carte entière, à la verticale, assez grande, immobile, nette ; et bien l'autre face. */
function check(rgba: Uint8ClampedArray, g: Uint8Array, w: number, hgt: number): Verdict {
  const d = detectCard(g, w, hgt);
  if (!d || d.area < 0.05) {
    prevQuad = null;
    return keep("Montre la carte entière, à plat sous le téléphone.");
  }
  const moved = prevQuad ? quadMotion(prevQuad, d.quad, w, hgt) : 1;
  prevQuad = d.quad;
  const quad = d.quad;
  const s = quadShape(quad);
  if (d.clipped) return keep("Recule un peu : la carte dépasse de l'image.", quad);
  if (s.ratio > 1) return keep("Tourne la carte à la verticale.", quad);
  if (Math.abs(s.ratio - CARD_RATIO) > 0.12 || s.skew > 15) return keep("Tiens le téléphone un peu plus à plat.", quad);
  if (s.height < hgt * 0.45) return keep("Rapproche-toi un peu de la carte.", quad);
  if (moved > 0.008) return keep("Ne bouge plus…", quad);
  liveSig = signature(rgba, w, hgt, quad);
  const other = faces[side === "recto" ? "verso" : "recto"];
  if (other && sameFace(liveSig, other.sig) > SAME_FACE)
    return keep(side === "verso" ? "Retourne la carte : le verso se prend tout seul." : "Montre le recto.", quad);
  const sharp = sharpness(g, w, hgt, bbox(quad));
  peak = Math.max(sharp, peak * 0.97);
  if (sharp < peak * 0.75) return keep("Mise au point…", quad);
  return { ok: true, msg: "Parfait, ne bouge plus…", quad };
}

/** Contour de la carte repérée, par-dessus la vidéo. */
function draw(v: Verdict, w: number, hgt: number): void {
  const c = $as("scan-overlay", HTMLCanvasElement);
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(c.clientWidth * dpr);
  const ch = Math.round(c.clientHeight * dpr);
  if (c.width !== cw || c.height !== ch) [c.width, c.height] = [cw, ch];
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, cw, ch);
  if (!v.quad) return;
  // vidéo affichée en « contain » : échelle et marges de l'image analysée vers l'écran
  const k = Math.min(cw / w, ch / hgt);
  const ox = (cw - w * k) / 2;
  const oy = (ch - hgt * k) / 2;
  ctx.lineWidth = 3 * dpr;
  ctx.strokeStyle = v.ok ? "#4cc27a" : "#f2b33a";
  ctx.fillStyle = v.ok ? "#4cc27a33" : "#f2b33a22";
  ctx.beginPath();
  for (const [i, p] of v.quad.entries())
    if (i) ctx.lineTo(ox + p.x * k, oy + p.y * k);
    else ctx.moveTo(ox + p.x * k, oy + p.y * k);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function tick(): void {
  if (!stream || busy) return;
  const v = video();
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  if (!vw || !vh) {
    timer = setTimeout(tick, 150);
    return;
  }
  const w = ANALYSIS;
  const hgt = Math.round((vh / vw) * w);
  if (analysis.width !== w || analysis.height !== hgt) [analysis.width, analysis.height] = [w, hgt];
  const ctx = analysis.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  ctx.drawImage(v, 0, 0, w, hgt);
  const rgba = ctx.getImageData(0, 0, w, hgt).data;
  const verdict = check(rgba, gray(rgba, w, hgt), w, hgt);
  draw(verdict, w, hgt);
  say(verdict.msg);
  ok = verdict.ok ? ok + 1 : 0;
  if (ok >= HOLD) {
    void capture(verdict.quad);
    return;
  }
  timer = setTimeout(tick, 120);
}

// --- prise et traitement -------------------------------------------------------------------------------------------

/** Image pleine définition de la vidéo, la plus nette de trois prises rapprochées (zone de la carte). */
async function grab(region: Rect | null): Promise<HTMLCanvasElement> {
  const v = video();
  let best: HTMLCanvasElement | null = null;
  let bestSharp = -1;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 70));
    const [c, ctx] = canvas(v.videoWidth, v.videoHeight);
    ctx.drawImage(v, 0, 0);
    const r = region ?? { x: 0, y: 0, w: c.width, h: c.height };
    const rw = Math.max(1, Math.round(r.w));
    const rh = Math.max(1, Math.round(r.h));
    const s = sharpness(gray(ctx.getImageData(r.x, r.y, rw, rh).data, rw, rh), rw, rh);
    if (s > bestSharp) {
      if (best) drop(best);
      [best, bestSharp] = [c, s];
    } else drop(c);
  }
  return best!;
}

async function finish(c: HTMLCanvasElement, meta: { quad?: Quad; sharp: number; fond?: number[] | null }) {
  const blob = await toBlob(c, 0.92);
  const tw = 240;
  const [t, tctx] = canvas(tw, Math.round((c.height / c.width) * tw));
  tctx.drawImage(c, 0, 0, t.width, t.height);
  const thumb = await toBlob(t, 0.8);
  return { blob, thumb, url: URL.createObjectURL(blob), w: c.width, h: c.height, ...meta } satisfies Shot;
}

async function shotOf(px: Uint8ClampedArray<ArrayBuffer>, w: number, hgt: number, meta: Omit<Shot, keyof Base>) {
  const [c, ctx] = canvas(w, hgt);
  ctx.putImageData(new ImageData(px, w, hgt), 0, 0);
  const s = await finish(c, meta);
  drop(c);
  return s;
}
type Base = Pick<Shot, "blob" | "thumb" | "url" | "w" | "h">;

const cutAt = (data: Uint8ClampedArray, w: number, hgt: number, q: Quad, fond: number[] | null) =>
  cutCorners(warp(data, w, hgt, q, 630, 880), 630, 880, 10, fond);

/**
 * Face à partir d'une image entière : contour affiné à pleine définition ; si des coins de l'image montrent la carte
 * au lieu du fond, le contour est repoussé jusqu'au vrai bord (gardé s'il y a moins de coins coupés).
 */
async function processFace(
  s: Side,
  src: HTMLCanvasElement,
  blob: Blob | null,
  hint: Quad | undefined,
  origin: Face["origin"],
): Promise<Face | null> {
  const [w, hgt] = [src.width, src.height];
  const data = src.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, w, hgt).data;
  const start = hint ?? coarse(src);
  if (!data || !start) return null;
  let quad = refineQuad(gray(data, w, hgt), w, hgt, start);
  let fond = matColor(data, w, hgt, quad);
  let cut = cutAt(data, w, hgt, quad, fond);
  if (cut.length) {
    const grown = growQuad(data, w, hgt, quad);
    const fond2 = matColor(data, w, hgt, grown);
    const cut2 = cutAt(data, w, hgt, grown, fond2);
    if (cut2.length < cut.length) [quad, fond, cut] = [grown, fond2, cut2];
  }
  const source = blob ?? (await toBlob(src, 0.92));
  return build(s, data, w, hgt, quad, fond, cut, source, origin);
}

/** Vue redressée (20 px/mm), gros plans des coins découpés à la définition d'origine, qualité, empreinte. */
async function build(
  s: Side,
  data: Uint8ClampedArray,
  w: number,
  hgt: number,
  quad: Quad,
  fond: number[] | null,
  cut: Corner[],
  source: Blob,
  origin: Face["origin"],
): Promise<Face> {
  const ppm = pxPerMm(quad);
  const flat = warp(data, w, hgt, quad, FLAT_W, FLAT_H);
  const sharp = sharpness(gray(flat, FLAT_W, FLAT_H), FLAT_W, FLAT_H, {
    x: FLAT_W * 0.1,
    y: FLAT_H * 0.1,
    w: FLAT_W * 0.8,
    h: FLAT_H * 0.8,
  });
  const view = await shotOf(flat, FLAT_W, FLAT_H, { quad, sharp, fond });
  const side = Math.round(Math.min(CROP_PPM[1], Math.max(CROP_PPM[0], ppm)) * CROP_MM);
  const corners = {} as Record<Corner, Shot>;
  for (const c of CORNERS) {
    const u = c === "hg" || c === "bg" ? -3 : 63 + 3 - CROP_MM;
    const v = c === "hg" || c === "hd" ? -3 : 88 + 3 - CROP_MM;
    const px = warp(data, w, hgt, cardRegion(quad, u, v, u + CROP_MM, v + CROP_MM), side, side);
    corners[c] = await shotOf(px, side, side, { sharp: sharpness(gray(px, side, side), side, side) });
  }
  return {
    side: s,
    source,
    sw: w,
    sh: hgt,
    quad,
    ppm,
    fond,
    cut,
    glare: glare(data, w, quad),
    sig: signature(data, w, hgt, quad),
    view,
    corners,
    origin,
  };
}

function release(f: Face | undefined): void {
  if (!f) return;
  URL.revokeObjectURL(f.view.url);
  for (const c of CORNERS) URL.revokeObjectURL(f.corners[c].url);
}

async function capture(hint?: Quad): Promise<void> {
  busy = true;
  clearTimeout(timer);
  say("Photo…");
  try {
    const still = liveSig ? await stillPhoto(liveSig) : null;
    let face: Face | null;
    if (still) {
      face = await processFace(side, still.c, still.blob, undefined, "photo");
      drop(still.c);
    } else {
      const k = video().videoWidth / ANALYSIS;
      const q = hint?.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad | undefined;
      const frame = await grab(q ? bbox(q) : null);
      face = await processFace(side, frame, null, q, "video");
      drop(frame);
    }
    if (face) keepFace(face);
    else resume("Carte introuvable sur la photo : réessaie.");
  } catch {
    resume("La photo a échoué : réessaie.");
  }
}

/** Photo prise avec l'appareil du téléphone : même traitement. */
async function fromFile(file: File): Promise<void> {
  busy = true;
  clearTimeout(timer);
  say("Traitement de la photo…");
  try {
    // orientation EXIF appliquée ; le canevas perd les autres métadonnées (position GPS comprise)
    const bmp = await createImageBitmap(file);
    const c = fit(bmp);
    bmp.close();
    const face = await processFace(side, c, null, undefined, "fichier");
    drop(c);
    if (face) keepFace(face);
    else resume("Carte introuvable sur la photo : carte entière, sans reflet.");
  } catch {
    resume("Photo illisible : réessaie.");
  }
}

function resume(msg: string): void {
  say(msg);
  busy = false;
  ok = 0;
  timer = setTimeout(tick, 600);
}

/** Face gardée ; après le recto, le direct continue : le verso partira quand la carte sera retournée. */
function keepFace(face: Face): void {
  release(faces[face.side]);
  faces[face.side] = face;
  uploaded.delete(face.side);
  for (const c of CORNERS) uploaded.delete(`${face.side}-${c}`);
  (navigator as { vibrate?: (ms: number) => boolean }).vibrate?.(40); // absent sur iPhone
  if (!only && face.side === "recto" && !faces.verso) {
    side = "verso";
    $("scan-step").textContent = `${species.nom_fr} · verso (2/2)`;
    $("scan-later").classList.remove("invisible");
    prevQuad = null;
    peak = 0;
    say(
      stream
        ? "✓ Recto. Retourne la carte : le verso se prend tout seul."
        : "✓ Recto. Retourne la carte, puis prends le verso avec « Appareil photo ».",
    );
    busy = false;
    ok = 0;
    timer = setTimeout(tick, 900);
    return;
  }
  review();
}

/** Démarre (ou reprend) la prise de la face attendue, en direct. */
async function begin(): Promise<void> {
  show("live");
  const first = side === "recto" && !only;
  $("scan-step").textContent =
    `${species.nom_fr} · ${only ? `${side} à refaire` : first ? "recto (1/2)" : "verso (2/2)"}`;
  // « Plus tard » : passer le verso (rien à passer pour le recto)
  $("scan-later").classList.toggle("invisible", side === "recto" || only);
  busy = false;
  ok = 0;
  peak = 0;
  prevQuad = null;
  liveSig = null;
  lastMsg = "";
  if (await startCamera()) timer = setTimeout(tick, 300);
}

// --- récapitulatif -------------------------------------------------------------------------------------------------

/** Qualité d'une face, en clair : définition, contour à vérifier, reflets. */
function quality(f: Face): { text: string; warn: boolean }[] {
  const ppm = String(Math.round(f.ppm));
  const out = [
    f.ppm < MIN_PPM
      ? { text: `Définition faible (${ppm} px/mm) : rapproche-toi`, warn: true }
      : {
          text: `${f.origin === "photo" ? "Photo pleine définition" : "Bonne définition"} (${ppm} px/mm)`,
          warn: false,
        },
  ];
  if (f.cut.length) out.push({ text: "Bords à vérifier : ajuste les coins", warn: true });
  if (f.glare > 0.004) out.push({ text: "Reflet sur la carte", warn: true });
  return out;
}

function review(): void {
  stopCamera();
  only = false;
  show("review");
  $("scan-step").textContent = `${species.nom_fr} · vérification`;
  const btn = (label: string, fn: () => void) => h("button", { type: "button", onclick: fn }, label);
  const figure = (s: Side) => {
    const f = faces[s];
    const again = () => {
      only = true;
      side = s;
      void begin();
    };
    if (!f)
      return h(
        "figure",
        { class: "scan-face missing" },
        h("div", { class: "ph" }, "—"),
        h("figcaption", {}, SIDE[s]),
        h("div", { class: "row" }, btn("Prendre", again)),
      );
    return h(
      "figure",
      { class: "scan-face" },
      h("img", { src: f.view.url, alt: `${SIDE[s]} redressé`, width: 160, height: 224 }),
      h("figcaption", {}, SIDE[s]),
      h("ul", { class: "scan-q" }, ...quality(f).map((q) => h("li", { class: q.warn ? "warn" : "" }, q.text))),
      h(
        "div",
        { class: "row" },
        btn("Ajuster les coins", () => void adjust(s)),
        btn("Reprendre", again),
      ),
    );
  };
  $("scan-faces").replaceChildren(figure("recto"), figure("verso"));
  $("scan-crops").replaceChildren(
    ...(["recto", "verso"] as const).flatMap((s) =>
      CORNERS.map((c) => {
        const shot = faces[s]?.corners[c];
        return h(
          "li",
          {},
          shot
            ? h("img", { src: shot.url, alt: `${SIDE[s]} · ${PART[c]}`, width: 72, height: 72 })
            : h("span", { class: "ph" }, "—"),
          h("span", { class: "lbl" }, `${SIDE[s]} · ${PART[c]}`),
        );
      }),
    ),
  );
  $as("scan-save", HTMLButtonElement).disabled = !faces.recto && !faces.verso;
}

/** Contour ajusté à la main sur la photo d'origine, puis face refaite (vue redressée et gros plans). */
async function adjust(s: Side): Promise<void> {
  const f = faces[s];
  if (!f) return;
  show("edit");
  $("scan-step").textContent = `${species.nom_fr} · coins du ${s}`;
  const bmp = await createImageBitmap(f.source);
  const img = fit(bmp);
  bmp.close();
  // la photo d'origine a pu être réduite au traitement : mêmes coordonnées que le contour
  const [c, ctx] = img.width === f.sw ? [img, img.getContext("2d")] : canvas(f.sw, f.sh);
  if (c !== img) ctx?.drawImage(img, 0, 0, f.sw, f.sh);
  const q = await editQuad(
    $("scan-edit-view"),
    c,
    f.quad,
    $as("scan-edit-ok", HTMLButtonElement),
    $as("scan-edit-cancel", HTMLButtonElement),
  );
  if (q) {
    $("scan-step").textContent = `${species.nom_fr} · redressement…`;
    const data = c.getContext("2d", { willReadFrequently: true })?.getImageData(0, 0, f.sw, f.sh).data;
    if (data) {
      const fond = matColor(data, f.sw, f.sh, q);
      const face = await build(s, data, f.sw, f.sh, q, fond, cutAt(data, f.sw, f.sh, q, fond), f.source, f.origin);
      release(f);
      faces[s] = face;
      uploaded.delete(s);
      for (const k of CORNERS) uploaded.delete(`${s}-${k}`);
    }
  }
  drop(c);
  if (c !== img) drop(img);
  review();
}

// --- envoi, puis carte suivante ------------------------------------------------------------------------------------

/** Photos à envoyer : vue entière et 4 gros plans de chaque face prise. */
function photos(): [string, Shot][] {
  return (["recto", "verso"] as const).flatMap((s) => {
    const f = faces[s];
    return f
      ? [[s, f.view] as [string, Shot], ...CORNERS.map((c) => [`${s}-${c}`, f.corners[c]] as [string, Shot])]
      : [];
  });
}

/** Envoi : le scan est créé une fois ; après un échec, seules les photos manquantes repartent. */
function save(btn: HTMLButtonElement): void {
  action(btn, async () => {
    const all = photos();
    const todo = all.filter(([id]) => !uploaded.has(id));
    try {
      savedScan ??= (
        (await (await api(`/api/species/${species.num}/scans`, { method: "POST" })).json()) as { id: string }
      ).id;
      let n = 0;
      for (const [step, shot] of todo) {
        btn.textContent = `Envoi ${String(++n)}/${String(todo.length)}…`;
        const q = new URLSearchParams({ w: String(shot.w), h: String(shot.h), sharp: shot.sharp.toFixed(1) });
        if (shot.quad)
          q.set(
            "quad",
            JSON.stringify(shot.quad.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }))),
          );
        if (shot.fond) q.set("fond", shot.fond.map((v) => String(Math.round(v))).join(","));
        const { id } = (await (
          await api(`/api/scans/${savedScan}/photos/${step}?${q.toString()}`, {
            method: "PUT",
            body: shot.blob,
            headers: { "Content-Type": "image/jpeg" },
          })
        ).json()) as { id: string };
        await api(`/api/photos/${id}/thumb`, {
          method: "PUT",
          body: shot.thumb,
          headers: { "Content-Type": "image/jpeg" },
        });
        uploaded.add(step);
      }
    } finally {
      btn.textContent = "Enregistrer le scan";
    }
    onSaved(species.num);
    await done(all.length);
  });
}

/** Prochaine carte au binder sans scan, dans l'ordre du Pokédex après celle-ci. */
function nextSpecies(scanned: Set<number>): Species | null {
  const todo = store.data.filter((s) => s.owned && !scanned.has(s.num) && s.num !== species.num);
  return todo.find((s) => s.num > species.num) ?? todo[0] ?? null;
}

async function done(n: number): Promise<void> {
  const name = species.nom_fr;
  let next: Species | null = null;
  try {
    const { species: scanned } = (await (await api("/api/scans")).json()) as { species: number[] };
    next = nextSpecies(new Set(scanned));
  } catch {
    next = null; // hors ligne : pas de suggestion
  }
  show("done");
  $("scan-step").textContent = "";
  $("scan-done-msg").textContent = `✓ ${name} : scan enregistré (${String(n)} photos).`;
  const card = next?.cards.find((c) => c.id === next.owned?.card_id) ?? null;
  const img = card ? cardImg(card) : null;
  $("scan-next").replaceChildren(
    ...(next
      ? [
          h("p", { class: "mut" }, "Prochaine carte sans scan :"),
          h(
            "button",
            {
              type: "button",
              class: "primary scan-next",
              onclick: () => {
                start(next);
              },
            },
            img ? h("img", { src: img, alt: "", width: 48, height: 67, loading: "lazy" }) : null,
            `Scanner #${String(next.num).padStart(3, "0")} ${next.nom_fr}`,
          ),
        ]
      : [h("p", { class: "mut" }, "Toutes tes cartes ont un scan.")]),
  );
}

/** Scan d'une espèce : remise à zéro, puis recto en direct. */
function start(s: Species): void {
  species = s;
  release(faces.recto);
  release(faces.verso);
  delete faces.recto;
  delete faces.verso;
  uploaded.clear();
  savedScan = null;
  side = "recto";
  only = false;
  void begin();
}

/** Ouvre le scanner pour ta carte de cette espèce ; `saved` est appelé après chaque scan enregistré (en série aussi). */
export function openScanner(s: Species, saved: (num: number) => void): void {
  onSaved = saved;
  dialog().showModal();
  start(s);
}

export function initScanner(): void {
  $("scan-shot").addEventListener("click", () => {
    if (busy) return;
    // déclenchement manuel : la carte doit quand même être sur la photo
    void capture(prevQuad ?? undefined);
  });
  $("scan-later").addEventListener("click", () => {
    if (busy) return;
    review();
  });
  $("scan-native").addEventListener("click", () => {
    $("scan-file").click();
  });
  $as("scan-file", HTMLInputElement).addEventListener("change", (e) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) void fromFile(file);
  });
  $("scan-save").addEventListener("click", (e) => {
    save(e.currentTarget as HTMLButtonElement);
  });
  $("scan-finish").addEventListener("click", () => {
    dialog().close();
  });
  dialog().addEventListener("close", () => {
    stopCamera();
    busy = false;
  });
}
