// Fausse caméra pour les tests du scanner : une carte (63 × 88, coins arrondis, légèrement tournée) sur un tapis
// sombre, en vidéo Y4M (lue en boucle par Chromium) et en image BMP (photo « appareil photo »). Générées avant les
// tests.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// dans le projet (dossier ignoré par git), pas dans le dossier temporaire partagé du système
export const FAKE_CAMERA = fileURLToPath(new URL("../.wrangler/fake-camera/camera.y4m", import.meta.url));

/** Luminance (0-255) de la scène : carte claire texturée, bordure unie, tapis sombre ; anticrénelée. */
function scene(w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  const ch = h * 0.8;
  const cw = ch * (63 / 88);
  const a = (3 * Math.PI) / 180;
  const [cx, cy] = [w / 2, h / 2];
  // repère de la carte : u, v dans [-1/2, 1/2]
  const local = (x: number, y: number) => {
    const dx = x - cx;
    const dy = y - cy;
    return { u: (dx * Math.cos(a) + dy * Math.sin(a)) / cw, v: (-dx * Math.sin(a) + dy * Math.cos(a)) / ch };
  };
  const shade = (u: number, v: number) => {
    // tapis, y compris dans les coins arrondis de la carte (rayon 3 mm)
    const [mx, my] = [(u + 0.5) * 63, (v + 0.5) * 88];
    const out = Math.hypot(Math.max(3 - mx, mx - 60, 0), Math.max(3 - my, my - 85, 0)) > 3;
    if (Math.abs(u) > 0.5 || Math.abs(v) > 0.5 || out) return 22;
    if (Math.abs(u) > 0.46 || Math.abs(v) > 0.47) return 205; // bordure
    // illustration : damier + disque, pour la netteté
    const checker = (Math.floor((u + 1) * 40) + Math.floor((v + 1) * 40)) % 2 ? 175 : 115;
    return Math.hypot(u, v + 0.1) < 0.18 ? 90 : checker;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let sy = 0; sy < 3; sy++)
        for (let sx = 0; sx < 3; sx++) {
          const { u, v } = local(x + (sx + 0.5) / 3, y + (sy + 0.5) / 3);
          s += shade(u, v);
        }
      out[y * w + x] = Math.round(s / 9);
    }
  return out;
}

/** Image BMP 24 bits (niveaux de gris) de la scène, pour la photo prise « avec l'appareil photo ». */
export function cardBmp(w = 600, h = 800): Buffer {
  const g = scene(w, h);
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = Buffer.alloc(54 + row * h);
  buf.write("BM", 0);
  buf.writeUInt32LE(buf.length, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(w, 18);
  buf.writeInt32LE(h, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(row * h, 34);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = g[(h - 1 - y) * w + x] ?? 0;
      buf.fill(v, 54 + y * row + x * 3, 54 + y * row + x * 3 + 3);
    }
  return buf;
}

/** Vidéo Y4M (4:2:0, chrominance neutre), image fixe répétée : la carte immobile sous la caméra. */
export default function globalSetup(): void {
  const [w, h] = [480, 640];
  const y = scene(w, h);
  const chroma = Buffer.alloc((w / 2) * (h / 2) * 2, 128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), Buffer.from(y), chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`);
  mkdirSync(dirname(FAKE_CAMERA), { recursive: true });
  writeFileSync(FAKE_CAMERA, Buffer.concat([header, ...Array.from({ length: 10 }, () => frame)]));
}
