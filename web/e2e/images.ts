// Images de test : une carte (63 × 88, coins arrondis, légèrement tournée) sur un tapis sombre, recto ou verso, en
// BMP (photo « prise » ou « choisie » dans les tests des photos et de la pré-évaluation).
/**
 * Luminance (0-255) de la scène : carte texturée, bordure unie, tapis sombre ; anticrénelée. Recto : bordure claire,
 * damier et disque sombre en haut ; verso : bordure grise, rayures et disque clair en bas (empreinte différente).
 */
function scene(w: number, h: number, face: "recto" | "verso" = "recto"): Uint8Array {
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
    if (Math.abs(u) > 0.46 || Math.abs(v) > 0.47) return face === "recto" ? 205 : 150; // bordure
    if (face === "verso") return Math.hypot(u, v - 0.2) < 0.2 ? 230 : Math.floor((v + 1) * 30) % 2 ? 185 : 95;
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
export function cardBmp(w = 600, h = 800, face: "recto" | "verso" = "recto"): Buffer {
  const g = scene(w, h, face);
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
