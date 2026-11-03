// Scanner guidé : caméra en direct, contrôle du cadrage, de la stabilité, de la netteté et des reflets, déclenchement
// automatique, carte redressée à plat (63 × 88 mm à 20 px/mm) et gros plans des coins (et des bords, au choix).
// Repli : l'appareil photo du téléphone (la photo est contrôlée et redressée de la même façon).
import { api, type Species } from "./api";
import { $, $as, action, h, toast } from "./dom";
import {
  CARD_RATIO,
  detectCard,
  framing,
  glare,
  gray,
  motion,
  quadMotion,
  quadShape,
  refineQuad,
  sharpness,
  warp,
  type Quad,
  type Rect,
  type Target,
} from "./vision";

export interface Step {
  id: string;
  side: "recto" | "verso";
  /** Gros plan : partie de la carte au centre du cadre ; absent pour la vue entière. */
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
}
interface Verdict {
  ok: boolean;
  msg: string;
  quad?: Quad;
  box?: Rect;
}

const SIDE = { recto: "Recto", verso: "Verso" } as const;
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

/** Procédure : recto entier puis ses gros plans, verso entier puis ses gros plans. */
export function scanSteps(edges: boolean): Step[] {
  const zoom: Target[] = ["hg", "hd", "bd", "bg", ...(edges ? (["h", "d", "b", "g"] as const) : [])];
  return (["recto", "verso"] as const).flatMap((side) => [
    { id: side, side, label: `${SIDE[side]} entier` },
    ...zoom.map((t) => ({ id: `${side}-${t}`, side, target: t, label: `${SIDE[side]} · ${PART[t]}` })),
  ]);
}

const FLAT_W = 1260; // 63 mm à 20 px/mm
const FLAT_H = 1760; // 88 mm
const ANALYSIS = 360; // largeur de l'image d'analyse (px)
const ZOOM_BOX = 0.7; // côté du cadre de gros plan, en part du petit côté de l'image
const HOLD = 4; // images valides d'affilée avant de déclencher
const MAX_PIXELS = 16_000_000; // limite des canevas sur iOS
const ZOOM_MAX_SIDE = 2000;

let species: Species;
let steps: Step[] = [];
let current = 0;
/** Reprise d'une seule photo depuis le récapitulatif. */
let retake = false;
const shots = new Map<string, Shot>();
let stream: MediaStream | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let busy = false;
let ok = 0;
let peak = 0;
let prevQuad: Quad | null = null;
let prevGray: Uint8Array | null = null;
let lastMsg = "";
let savedScan: string | null = null;
const uploaded = new Set<string>();
let onSaved: () => void = () => undefined;

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

function show(part: "intro" | "live" | "review"): void {
  $("scan-intro").hidden = part !== "intro";
  $("scan-live").hidden = part !== "live";
  $("scan-review").hidden = part !== "review";
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
const zoomBox = (w: number, hgt: number): Rect => {
  const side = Math.min(w, hgt) * ZOOM_BOX;
  return { x: (w - side) / 2, y: (hgt - side) / 2, w: side, h: side };
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
    stream = await media.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } },
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

/** Zoom optique ou numérique de la caméra pour les gros plans, quand le navigateur le permet (Android). */
async function setZoom(on: boolean): Promise<void> {
  const track = stream?.getVideoTracks()[0];
  // getCapabilities manque sur d'anciens Safari ; « zoom » n'existe que sur Android (Chrome)
  const caps = (track as { getCapabilities?: () => unknown } | undefined)?.getCapabilities?.() as
    { zoom?: { min: number; max: number } } | undefined;
  if (!track || !caps?.zoom) return;
  const zoom = on ? Math.min(2, caps.zoom.max) : caps.zoom.min;
  await track.applyConstraints({ advanced: [{ zoom } as MediaTrackConstraintSet] }).catch(() => undefined);
}

// --- contrôle en direct --------------------------------------------------------------------------------------------

const keep = (msg: string, extra: Partial<Verdict> = {}): Verdict => ({ ok: false, msg, ...extra });

function checkFull(rgba: Uint8ClampedArray, g: Uint8Array, w: number, hgt: number): Verdict {
  prevGray = g;
  const d = detectCard(g, w, hgt);
  if (!d || d.area < 0.08) {
    prevQuad = null;
    return keep("Pose la carte entière sur un fond sombre, dans le cadre.");
  }
  const moved = prevQuad ? quadMotion(prevQuad, d.quad, w, hgt) : 1;
  prevQuad = d.quad;
  const s = quadShape(d.quad);
  const quad = d.quad;
  if (d.clipped) return keep("Recule un peu : la carte dépasse de l'image.", { quad });
  if (s.ratio > 1) return keep("Tourne la carte à la verticale.", { quad });
  if (s.height < hgt * 0.5) return keep("Rapproche-toi : la carte doit remplir le cadre.", { quad });
  if (Math.abs(s.ratio - CARD_RATIO) > 0.06 || s.skew > 6)
    return keep("Tiens le téléphone bien à plat, juste au-dessus de la carte.", { quad });
  if (glare(rgba, w, quad) > 0.004)
    return keep("Reflet sur la carte : éloigne la lampe ou incline légèrement la carte.", { quad });
  if (moved > 0.008) return keep("Ne bouge plus…", { quad });
  const sharp = sharpness(g, w, hgt, bbox(quad));
  peak = Math.max(sharp, peak * 0.97);
  if (sharp < peak * 0.75) return keep("Mise au point…", { quad });
  return { ok: true, msg: "Parfait, ne bouge plus…", quad };
}

function checkZoom(g: Uint8Array, w: number, hgt: number, target: Target): Verdict {
  const box = zoomBox(w, hgt);
  const moved = prevGray ? motion(prevGray, g) : 99;
  prevGray = g;
  prevQuad = null;
  if (framing(g, w, box, target) < 35)
    return keep(`Place le ${PART[target]} de la carte au centre du cadre, comme sur le schéma.`, { box });
  if (moved > 5) return keep("Ne bouge plus…", { box });
  const sharp = sharpness(g, w, hgt, box);
  peak = Math.max(sharp, peak * 0.97);
  if (sharp < peak * 0.8) return keep("Mise au point… recule un peu si l'image reste floue.", { box });
  return { ok: true, msg: "Parfait, ne bouge plus…", box };
}

/** Cadre guide, schéma du gros plan et carte repérée, par-dessus la vidéo. */
function draw(v: Verdict, w: number, hgt: number): void {
  const c = $as("scan-overlay", HTMLCanvasElement);
  const dpr = window.devicePixelRatio || 1;
  const cw = Math.round(c.clientWidth * dpr);
  const ch = Math.round(c.clientHeight * dpr);
  if (c.width !== cw || c.height !== ch) [c.width, c.height] = [cw, ch];
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, cw, ch);
  // vidéo affichée en « contain » : échelle et marges de l'image d'analysée vers l'écran
  const k = Math.min(cw / w, ch / hgt);
  const ox = (cw - w * k) / 2;
  const oy = (ch - hgt * k) / 2;
  const X = (x: number) => ox + x * k;
  const Y = (y: number) => oy + y * k;
  const color = v.ok ? "#4cc27a" : "#f2b33a";
  ctx.lineWidth = 3 * dpr;
  const step = steps[current];
  if (!step?.target) {
    // cadre au format carte, 80 % de la hauteur
    const gh = hgt * 0.8;
    const gw = gh * CARD_RATIO;
    ctx.setLineDash([10 * dpr, 8 * dpr]);
    ctx.strokeStyle = "#ffffffaa";
    ctx.strokeRect(X((w - gw) / 2), Y((hgt - gh) / 2), gw * k, gh * k);
    ctx.setLineDash([]);
    if (v.quad) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const [i, p] of v.quad.entries())
        if (i) ctx.lineTo(X(p.x), Y(p.y));
        else ctx.moveTo(X(p.x), Y(p.y));
      ctx.closePath();
      ctx.stroke();
    }
    return;
  }
  const b = v.box ?? zoomBox(w, hgt);
  ctx.strokeStyle = color;
  ctx.strokeRect(X(b.x), Y(b.y), b.w * k, b.h * k);
  // schéma : la partie « carte » du cadre grisée, et la bordure attendue en trait plein
  const mx = X(b.x + b.w / 2);
  const my = Y(b.y + b.h / 2);
  const [x0, y0, x1, y1] = [X(b.x), Y(b.y), X(b.x + b.w), Y(b.y + b.h)];
  const card: Record<Target, [number, number, number, number]> = {
    hg: [mx, my, x1, y1],
    hd: [x0, my, mx, y1],
    bd: [x0, y0, mx, my],
    bg: [mx, y0, x1, my],
    h: [x0, my, x1, y1],
    b: [x0, y0, x1, my],
    g: [mx, y0, x1, y1],
    d: [x0, y0, mx, y1],
  };
  const [a, bb, cc, dd] = card[step.target];
  ctx.fillStyle = "#ffffff22";
  ctx.fillRect(a, bb, cc - a, dd - bb);
  ctx.strokeStyle = "#ffffffcc";
  ctx.strokeRect(a, bb, cc - a, dd - bb);
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
  const g = gray(rgba, w, hgt);
  const step = steps[current];
  if (!step) return;
  const verdict = step.target ? checkZoom(g, w, hgt, step.target) : checkFull(rgba, g, w, hgt);
  draw(verdict, w, hgt);
  say(verdict.msg);
  ok = verdict.ok ? ok + 1 : 0;
  if (ok >= HOLD) {
    void capture(verdict);
    return;
  }
  timer = setTimeout(tick, 120);
}

// --- prise et traitement -------------------------------------------------------------------------------------------

/** Image pleine résolution de la vidéo, la plus nette de trois prises rapprochées (zone utile seulement). */
async function grab(region: (w: number, hgt: number) => Rect): Promise<HTMLCanvasElement> {
  const v = video();
  let best: HTMLCanvasElement | null = null;
  let bestSharp = -1;
  for (let i = 0; i < 3; i++) {
    if (i) await new Promise((r) => setTimeout(r, 70));
    const [c, ctx] = canvas(v.videoWidth, v.videoHeight);
    ctx.drawImage(v, 0, 0);
    const r = region(c.width, c.height);
    const rw = Math.max(1, Math.round(r.w));
    const rh = Math.max(1, Math.round(r.h));
    const s = sharpness(gray(ctx.getImageData(r.x, r.y, rw, rh).data, rw, rh), rw, rh);
    if (s > bestSharp) [best, bestSharp] = [c, s];
  }
  return best!;
}

/** Vue entière : coins affinés à pleine résolution puis carte remise à plat ; null si la carte est introuvable. */
async function fullShot(src: HTMLCanvasElement, hint?: Quad): Promise<Shot | null> {
  const w = src.width;
  const hgt = src.height;
  const ctx = src.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const data = ctx.getImageData(0, 0, w, hgt).data;
  const g = gray(data, w, hgt);
  let quad = hint;
  if (!quad) {
    // photo de l'appareil : repérage sur une copie réduite
    const aw = ANALYSIS;
    const ah = Math.round((hgt / w) * aw);
    const [, sctx] = canvas(aw, ah);
    sctx.drawImage(src, 0, 0, aw, ah);
    const d = detectCard(gray(sctx.getImageData(0, 0, aw, ah).data, aw, ah), aw, ah);
    if (!d || d.clipped || d.area < 0.08) return null;
    quad = d.quad.map((p) => ({ x: (p.x * w) / aw, y: (p.y * hgt) / ah })) as Quad;
  }
  const fine = refineQuad(g, w, hgt, quad);
  const flat = warp(data, w, hgt, fine, FLAT_W, FLAT_H);
  const [out, octx] = canvas(FLAT_W, FLAT_H);
  octx.putImageData(new ImageData(flat, FLAT_W, FLAT_H), 0, 0);
  const sharp = sharpness(gray(flat, FLAT_W, FLAT_H), FLAT_W, FLAT_H, {
    x: FLAT_W * 0.1,
    y: FLAT_H * 0.1,
    w: FLAT_W * 0.8,
    h: FLAT_H * 0.8,
  });
  return finish(out, 0.92, { quad: fine, sharp });
}

/** Gros plan : le cadre central à pleine résolution (ou toute la photo de l'appareil). */
async function zoomShot(src: HTMLCanvasElement, crop: boolean): Promise<Shot> {
  const r = crop ? zoomBox(src.width, src.height) : { x: 0, y: 0, w: src.width, h: src.height };
  const k = Math.min(1, ZOOM_MAX_SIDE / Math.max(r.w, r.h));
  const [out, octx] = canvas(Math.round(r.w * k), Math.round(r.h * k));
  octx.drawImage(src, r.x, r.y, r.w, r.h, 0, 0, out.width, out.height);
  const g = gray(octx.getImageData(0, 0, out.width, out.height).data, out.width, out.height);
  return finish(out, 0.92, { sharp: sharpness(g, out.width, out.height) });
}

async function finish(c: HTMLCanvasElement, quality: number, meta: { quad?: Quad; sharp: number }): Promise<Shot> {
  const blob = await toBlob(c, quality);
  const tw = 240;
  const [t, tctx] = canvas(tw, Math.round((c.height / c.width) * tw));
  tctx.drawImage(c, 0, 0, t.width, t.height);
  const thumb = await toBlob(t, 0.8);
  return { blob, thumb, url: URL.createObjectURL(blob), w: c.width, h: c.height, ...meta };
}

async function capture(v: Verdict): Promise<void> {
  busy = true;
  clearTimeout(timer);
  const step = steps[current];
  if (!step) return;
  say("Photo…");
  try {
    let shot: Shot | null;
    if (step.target) {
      shot = await zoomShot(await grab((w, hgt) => zoomBox(w, hgt)), true);
    } else {
      const vw = video().videoWidth;
      const k = vw / ANALYSIS;
      const quad = v.quad?.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad | undefined;
      shot = await fullShot(await grab((w, hgt) => (quad ? bbox(quad) : { x: 0, y: 0, w, h: hgt })), quad);
    }
    if (shot) accept(step, shot);
    else resume("Carte introuvable sur la photo : réessaie.");
  } catch {
    resume("La photo a échoué : réessaie.");
  }
}

/** Photo prise avec l'appareil du téléphone : même contrôle, même redressement. */
async function fromFile(file: File): Promise<void> {
  const step = steps[current];
  if (!step) return;
  busy = true;
  clearTimeout(timer);
  say("Traitement de la photo…");
  const url = URL.createObjectURL(file);
  try {
    // <img> applique l'orientation EXIF ; le canevas la perd, avec les autres métadonnées (position GPS comprise)
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, Math.sqrt(MAX_PIXELS / (img.naturalWidth * img.naturalHeight)));
    const [c, ctx] = canvas(Math.round(img.naturalWidth * k), Math.round(img.naturalHeight * k));
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const shot = step.target ? await zoomShot(c, false) : await fullShot(c);
    if (shot) accept(step, shot);
    else resume("Carte introuvable sur la photo : carte entière, fond sombre, sans reflet.");
  } catch {
    resume("Photo illisible : réessaie.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

function resume(msg: string): void {
  say(msg);
  busy = false;
  ok = 0;
  timer = setTimeout(tick, 600);
}

function accept(step: Step, shot: Shot): void {
  const old = shots.get(step.id);
  if (old) URL.revokeObjectURL(old.url);
  shots.set(step.id, shot);
  uploaded.delete(step.id);
  (navigator as { vibrate?: (ms: number) => boolean }).vibrate?.(40); // absent sur iPhone
  if (retake) {
    review();
    return;
  }
  next(`✓ ${step.label}`);
}

/** Étape suivante ; au changement de face, pause : la carte doit être retournée avant de continuer. */
function next(done: string): void {
  const prev = steps[current];
  current++;
  const step = steps[current];
  if (!step) {
    review();
    return;
  }
  if (prev && prev.side !== step.side) {
    stopCamera();
    say(`${done}. Retourne la carte (verso visible), puis touche « Continuer ».`);
    show("live");
    $("scan-shot").hidden = true;
    $("scan-skip").hidden = true;
    $("scan-native").hidden = true;
    const go = h("button", { type: "button", class: "primary", id: "scan-continue" }, "Continuer");
    go.addEventListener("click", () => {
      go.remove();
      void begin();
    });
    $("scan-live").querySelector(".scan-bar")?.append(go);
    $("scan-step").textContent = `Retourne la carte`;
    return;
  }
  say(done);
  setTimeout(() => void begin(), 700);
}

/** Démarre (ou reprend) l'étape courante en direct. */
async function begin(): Promise<void> {
  const step = steps[current];
  if (!step) return;
  show("live");
  $("scan-step").textContent = `${step.label} (${current + 1}/${steps.length})`;
  $("scan-shot").hidden = false;
  $("scan-native").hidden = false;
  // une vue entière est indispensable ; un gros plan peut être passé (bouton masqué, place gardée : déclencheur centré)
  const skip = $as("scan-skip", HTMLButtonElement);
  skip.hidden = false;
  skip.classList.toggle("invisible", !step.target);
  skip.disabled = !step.target;
  busy = false;
  ok = 0;
  peak = 0;
  prevQuad = null;
  prevGray = null;
  lastMsg = "";
  if (await startCamera()) {
    await setZoom(Boolean(step.target));
    timer = setTimeout(tick, 300);
  }
}

// --- récapitulatif et envoi ----------------------------------------------------------------------------------------

function review(): void {
  stopCamera();
  retake = false;
  show("review");
  $("scan-step").textContent = `${shots.size}/${steps.length} photos`;
  $("scan-shots").replaceChildren(
    ...steps.map((st, i) => {
      const shot = shots.get(st.id);
      return h(
        "li",
        {},
        shot
          ? h("img", { src: shot.url, alt: st.label, width: 96, height: Math.round((shot.h / shot.w) * 96) })
          : h("span", { class: "ph" }, "—"),
        h("span", { class: "lbl" }, st.label),
        h(
          "button",
          {
            type: "button",
            class: "link",
            onclick: () => {
              retake = true;
              current = i;
              void begin();
            },
          },
          shot ? "Refaire" : "Prendre",
        ),
      );
    }),
  );
  $as("scan-save", HTMLButtonElement).disabled = !steps.some((st) => !st.target && shots.has(st.id));
}

/** Envoi : le scan est créé une fois ; après un échec, seules les photos manquantes repartent. */
function save(btn: HTMLButtonElement): void {
  action(btn, async () => {
    const todo = steps.filter((st) => shots.has(st.id) && !uploaded.has(st.id));
    try {
      savedScan ??= (
        (await (await api(`/api/species/${species.num}/scans`, { method: "POST" })).json()) as { id: string }
      ).id;
      let n = 0;
      for (const st of todo) {
        const shot = shots.get(st.id);
        if (!shot) continue;
        btn.textContent = `Envoi ${++n}/${todo.length}…`;
        const q = new URLSearchParams({ w: String(shot.w), h: String(shot.h), sharp: shot.sharp.toFixed(1) });
        if (shot.quad)
          q.set(
            "quad",
            JSON.stringify(shot.quad.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }))),
          );
        const { id } = (await (
          await api(`/api/scans/${savedScan}/photos/${st.id}?${q.toString()}`, {
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
        uploaded.add(st.id);
      }
    } finally {
      btn.textContent = "Enregistrer le scan";
    }
    toast(`Scan enregistré : ${uploaded.size} photo${uploaded.size > 1 ? "s" : ""}.`);
    dialog().close();
    onSaved();
  });
}

/** Ouvre le scanner pour ta carte de cette espèce ; `saved` est appelé après l'enregistrement. */
export function openScanner(s: Species, saved: () => void): void {
  species = s;
  onSaved = saved;
  for (const shot of shots.values()) URL.revokeObjectURL(shot.url);
  shots.clear();
  uploaded.clear();
  savedScan = null;
  current = 0;
  retake = false;
  $("scan-step").textContent = s.nom_fr;
  show("intro");
  dialog().showModal();
}

export function initScanner(): void {
  $("scan-start").addEventListener("click", () => {
    steps = scanSteps($as("scan-edges", HTMLInputElement).checked);
    current = 0;
    void begin();
  });
  $("scan-shot").addEventListener("click", () => {
    if (busy) return;
    // déclenchement manuel : la vue entière doit quand même montrer la carte
    void capture({ ok: true, msg: "", quad: prevQuad ?? undefined });
  });
  $("scan-skip").addEventListener("click", () => {
    if (busy) return;
    busy = true;
    clearTimeout(timer);
    next(`${steps[current]?.label ?? ""} : passé`);
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
  dialog().addEventListener("close", () => {
    stopCamera();
    busy = false;
    document.getElementById("scan-continue")?.remove();
  });
}
