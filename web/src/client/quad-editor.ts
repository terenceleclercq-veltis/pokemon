// Ajustement des coins de la carte sur la photo d'origine, comme le recadrage des scanners de documents : contour
// tracé sur la photo, quatre poignées à faire glisser du doigt (avec une loupe, le doigt cachant le coin) ou à
// déplacer au clavier (flèches, Maj pour aller plus vite).
import { h } from "./dom";
import type { Pt, Quad } from "./vision";

const NAMES = ["haut gauche", "haut droit", "bas droit", "bas gauche"] as const;
/** Loupe : côté en px CSS, et grossissement par rapport à la photo affichée. */
const LOUPE = 128;
const ZOOM = 4;

/** Contour utilisable : convexe, dans le même sens partout, sans coin replié ni côté nul. */
export function convex(q: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i] as Pt;
    const b = q[(i + 1) % 4] as Pt;
    const c = q[(i + 2) % 4] as Pt;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-6) return false;
    if (sign && Math.sign(cross) !== sign) return false;
    sign = Math.sign(cross);
  }
  return true;
}

/**
 * Ouvre l'éditeur dans `view` avec la photo `img` (aux dimensions des coordonnées du contour) et le contour `start` ;
 * résout le contour validé par `done`, ou null si `cancel`.
 */
export function editQuad(
  view: HTMLElement,
  img: CanvasImageSource & { width: number; height: number },
  start: Quad,
  done: HTMLButtonElement,
  cancel: HTMLButtonElement,
): Promise<Quad | null> {
  const q = start.map((p) => ({ ...p })) as Quad;
  const [W, H] = [img.width, img.height];
  const photo = h("canvas", { class: "qe-photo", "aria-hidden": "true" });
  const loupe = h("canvas", { class: "qe-loupe", "aria-hidden": "true" });
  loupe.hidden = true;
  const handles = NAMES.map((n) =>
    h("button", { type: "button", class: "qe-handle", "aria-label": `Coin ${n} de la carte (flèches pour ajuster)` }),
  );
  view.replaceChildren(photo, ...handles, loupe);
  let [k, ox, oy, dpr] = [1, 0, 0, 1];

  function drawLoupe(i: number): void {
    const p = q[i] as Pt;
    const z = ZOOM * k; // px de loupe par px de photo
    const side = LOUPE / z;
    loupe.hidden = false;
    loupe.width = loupe.height = Math.round(LOUPE * dpr);
    const ctx = loupe.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    ctx.drawImage(img, p.x - side / 2, p.y - side / 2, side, side, 0, 0, LOUPE, LOUPE);
    const c = LOUPE / 2;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "#4cc27a";
    for (const j of [(i + 3) % 4, (i + 1) % 4]) {
      const o = q[j] as Pt;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.lineTo(c + (o.x - p.x) * z, c + (o.y - p.y) * z);
      ctx.stroke();
    }
    ctx.strokeStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(c - 10, c);
    ctx.lineTo(c + 10, c);
    ctx.moveTo(c, c - 10);
    ctx.lineTo(c, c + 10);
    ctx.stroke();
    // du côté opposé au coin : le doigt ne la cache pas
    const right = ox + p.x * k < view.clientWidth / 2;
    loupe.classList.toggle("right", right);
  }

  function paint(active = -1): void {
    const ctx = photo.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, photo.width / dpr, photo.height / dpr);
    ctx.drawImage(img, ox, oy, W * k, H * k);
    ctx.beginPath();
    q.forEach((p, i) => {
      if (i) ctx.lineTo(ox + p.x * k, oy + p.y * k);
      else ctx.moveTo(ox + p.x * k, oy + p.y * k);
    });
    ctx.closePath();
    ctx.lineWidth = 2;
    const ok = convex(q);
    ctx.strokeStyle = ok ? "#4cc27a" : "#f2b33a";
    ctx.stroke();
    handles.forEach((b, i) => {
      b.style.left = `${String(ox + (q[i] as Pt).x * k)}px`;
      b.style.top = `${String(oy + (q[i] as Pt).y * k)}px`;
    });
    if (active >= 0) drawLoupe(active);
    else loupe.hidden = true;
    done.disabled = !ok;
  }

  function layout(): void {
    const r = view.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    photo.width = Math.max(1, Math.round(r.width * dpr));
    photo.height = Math.max(1, Math.round(r.height * dpr));
    k = Math.min(r.width / W, r.height / H) || 1;
    ox = (r.width - W * k) / 2;
    oy = (r.height - H * k) / 2;
    paint();
  }

  const move = (i: number, x: number, y: number) => {
    q[i] = { x: Math.min(W, Math.max(0, x)), y: Math.min(H, Math.max(0, y)) };
    paint(i);
  };
  handles.forEach((b, i) => {
    let grip = { x: 0, y: 0 };
    b.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      const r = view.getBoundingClientRect();
      // écart doigt-coin gardé : le coin ne saute pas sous le doigt
      grip = { x: e.clientX - r.left - (ox + (q[i] as Pt).x * k), y: e.clientY - r.top - (oy + (q[i] as Pt).y * k) };
      paint(i);
    });
    b.addEventListener("pointermove", (e) => {
      if (!b.hasPointerCapture(e.pointerId)) return;
      const r = view.getBoundingClientRect();
      move(i, (e.clientX - r.left - grip.x - ox) / k, (e.clientY - r.top - grip.y - oy) / k);
    });
    const release = () => {
      paint();
    };
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("keydown", (e) => {
      const step = (e.shiftKey ? 10 : 1) / k; // un px d'écran, dix avec Maj
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      move(i, (q[i] as Pt).x + d[0]!, (q[i] as Pt).y + d[1]!);
    });
    b.addEventListener("focus", () => {
      paint(i);
    });
    b.addEventListener("blur", () => {
      paint();
    });
  });
  const watch = new ResizeObserver(layout);
  watch.observe(view);
  layout();

  return new Promise((resolve) => {
    const finish = (r: Quad | null) => {
      watch.disconnect();
      done.onclick = null;
      cancel.onclick = null;
      view.replaceChildren();
      resolve(r);
    };
    done.onclick = () => {
      finish(convex(q) ? q : null);
    };
    cancel.onclick = () => {
      finish(null);
    };
  });
}
