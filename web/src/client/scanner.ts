// Photos de ta carte : autant que tu veux (20 au plus), prises avec l'appareil photo du téléphone, en pleine qualité,
// zoom compris, ou choisies dans la photothèque. Rien à cadrer ni à détourer : Claude trie les photos (vues entières,
// gros plans), examine la carte et dit s'il manque une photo pour conclure. Puis carte suivante, en série.
import { estimate, type ClaudeStatus } from "./analysis";
import { api, type Species } from "./api";
import { $, $as, action, h } from "./dom";
import { cardImg, store } from "./state";

export const MAX_PHOTOS = 20;
/**
 * Plus grand côté gardé : Claude regarde les images en 2576 px au plus (haute définition d'Opus 5.5) ; au-delà, la
 * photo serait réduite par l'API de toute façon. Les détails fins viennent des gros plans, pris de près.
 */
const MAX_SIDE = 2576;
/** Taille maximale d'une photo envoyée : sous les 5 Mo d'une image pour Claude. */
const MAX_BYTES = 4_500_000;

interface Pick {
  blob: Blob;
  thumb: Blob;
  url: string;
  w: number;
  h: number;
}

let species: Species;
let claudeStatus: ClaudeStatus | null = null;
let onSaved: (num: number, analyse: boolean) => void = () => undefined;
const picks: Pick[] = [];
/** Après un envoi interrompu : le même scan est complété, seules les photos pas encore parties repartent. */
let savedScan: string | null = null;
let sent = new WeakSet<Pick>();

const dialog = () => $as("scan", HTMLDialogElement);

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

function canvas(w: number, hgt: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = hgt;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canevas indisponible");
  ctx.imageSmoothingQuality = "high";
  return [c, ctx];
}

/**
 * Photo prête à l'envoi : orientation appliquée, réduite à 2576 px de côté au plus, réencodée en JPEG (sans les
 * métadonnées de l'appareil : position GPS comprise), sous 4,5 Mo.
 */
async function prepare(file: File): Promise<Pick> {
  const bmp = await createImageBitmap(file);
  try {
    let k = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    for (;;) {
      const [c, ctx] = canvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      let blob = await toBlob(c, 0.92);
      if (blob.size > MAX_BYTES) blob = await toBlob(c, 0.82);
      if (blob.size <= MAX_BYTES || k < 0.3) {
        const tw = 240;
        const [t, tctx] = canvas(tw, Math.round((c.height / c.width) * tw));
        tctx.drawImage(c, 0, 0, t.width, t.height);
        const thumb = await toBlob(t, 0.8);
        const pick = { blob, thumb, url: URL.createObjectURL(blob), w: c.width, h: c.height };
        c.width = c.height = 0; // mémoire des canevas libérée tout de suite (Safari)
        return pick;
      }
      c.width = c.height = 0;
      k *= 0.8;
    }
  } finally {
    bmp.close();
  }
}

function say(msg: string): void {
  $("scan-status").textContent = msg;
}

/** Vignettes des photos choisies (✕ pour en retirer une), boutons et coût estimé à jour. */
function paint(): void {
  $("scan-photos").replaceChildren(
    ...picks.map((p, i) =>
      h(
        "li",
        {},
        h("img", { src: p.url, alt: `Photo ${String(i + 1)}`, width: 96, height: Math.round((p.h / p.w) * 96) }),
        h(
          "button",
          {
            type: "button",
            class: "icon remove",
            "aria-label": `Retirer la photo ${String(i + 1)}`,
            onclick: () => {
              URL.revokeObjectURL(p.url);
              picks.splice(i, 1);
              paint();
            },
          },
          "×",
        ),
      ),
    ),
  );
  const n = picks.length;
  $as("scan-add", HTMLButtonElement).disabled = n >= MAX_PHOTOS;
  $as("scan-save", HTMLButtonElement).disabled = !n;
  const go = $as("scan-analyse", HTMLButtonElement);
  const c = claudeStatus;
  go.disabled = n < 2 || !c?.configured || c.restantes <= 0;
  go.textContent =
    n >= 2 && c?.configured ? `Enregistrer et pré-évaluer (≈ ${usd(estimate(n))})` : "Enregistrer et pré-évaluer";
  say(
    !n
      ? ""
      : n < 2
        ? "1 photo : ajoute le recto et le verso entiers, au moins."
        : `${String(n)} photos${n >= MAX_PHOTOS ? " (maximum atteint)" : ""}.`,
  );
}
const usd = (v: number) => `${v.toLocaleString("fr-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;

async function add(files: File[]): Promise<void> {
  const room = MAX_PHOTOS - picks.length;
  const todo = files.slice(0, room);
  let failed = 0;
  for (const [i, f] of todo.entries()) {
    say(`Préparation de la photo ${String(i + 1)}/${String(todo.length)}…`);
    try {
      picks.push(await prepare(f));
    } catch {
      failed++;
    }
  }
  paint();
  const extra = files.length - todo.length;
  if (failed || extra)
    say(
      [
        failed ? `${String(failed)} photo${failed > 1 ? "s" : ""} illisible${failed > 1 ? "s" : ""}` : "",
        extra ? `${String(extra)} de trop (20 au plus)` : "",
      ]
        .filter(Boolean)
        .join(" ; ") + ".",
    );
}

/** Envoi : un scan, puis chaque photo et sa vignette (« photo-1 », « photo-2 »…). */
function save(btn: HTMLButtonElement, analyse: boolean): void {
  action(btn, async () => {
    const label = btn.textContent;
    const others = [$as("scan-save", HTMLButtonElement), $as("scan-analyse", HTMLButtonElement)];
    for (const b of others) b.disabled = true;
    try {
      savedScan ??= (
        (await (await api(`/api/species/${species.num}/scans`, { method: "POST" })).json()) as { id: string }
      ).id;
      const scan = savedScan;
      for (const [i, p] of picks.entries()) {
        if (sent.has(p)) continue;
        btn.textContent = `Envoi ${String(i + 1)}/${String(picks.length)}…`;
        const q = new URLSearchParams({ w: String(p.w), h: String(p.h) });
        const { id } = (await (
          await api(`/api/scans/${scan}/photos/photo-${String(i + 1)}?${q.toString()}`, {
            method: "PUT",
            body: p.blob,
            headers: { "Content-Type": "image/jpeg" },
          })
        ).json()) as { id: string };
        await api(`/api/photos/${id}/thumb`, {
          method: "PUT",
          body: p.thumb,
          headers: { "Content-Type": "image/jpeg" },
        });
        sent.add(p);
      }
    } finally {
      btn.textContent = label;
      paint();
    }
    const n = picks.length;
    clear();
    onSaved(species.num, analyse);
    if (analyse) dialog().close();
    else await done(n);
  });
}

function clear(): void {
  for (const p of picks) URL.revokeObjectURL(p.url);
  picks.length = 0;
  savedScan = null;
  sent = new WeakSet();
}

/** Prochaine carte au binder sans photos, dans l'ordre du Pokédex après celle-ci. */
function nextSpecies(scanned: Set<number>): Species | null {
  const todo = store.data.filter((s) => s.owned && !scanned.has(s.num) && s.num !== species.num);
  return todo.find((s) => s.num > species.num) ?? todo[0] ?? null;
}

async function done(n: number): Promise<void> {
  let next: Species | null = null;
  try {
    const { species: scanned } = (await (await api("/api/scans")).json()) as { species: number[] };
    next = nextSpecies(new Set(scanned));
  } catch {
    next = null; // hors ligne : pas de suggestion
  }
  $("scan-pick").hidden = true;
  $("scan-done").hidden = false;
  $("scan-done-msg").textContent =
    `✓ ${species.nom_fr} : ${String(n)} photo${n > 1 ? "s" : ""} enregistrée${n > 1 ? "s" : ""}.`;
  const card = next?.cards.find((c) => c.id === next.owned?.card_id) ?? null;
  const img = card ? cardImg(card) : null;
  $("scan-next").replaceChildren(
    ...(next
      ? [
          h("p", { class: "mut" }, "Prochaine carte sans photos :"),
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
            `Photos de #${String(next.num).padStart(3, "0")} ${next.nom_fr}`,
          ),
        ]
      : [h("p", { class: "mut" }, "Toutes tes cartes ont des photos.")]),
  );
}

function start(s: Species): void {
  species = s;
  clear();
  $("scan-step").textContent = s.nom_fr;
  $("scan-pick").hidden = false;
  $("scan-done").hidden = true;
  paint();
}

/**
 * Ouvre l'ajout de photos pour ta carte de cette espèce ; `saved` est appelé après chaque enregistrement (en série
 * aussi), avec `analyse` vrai si la pré-évaluation doit partir tout de suite.
 */
export function openScanner(
  s: Species,
  claude: ClaudeStatus | null,
  saved: (num: number, analyse: boolean) => void,
): void {
  claudeStatus = claude;
  onSaved = saved;
  dialog().showModal();
  start(s);
}

export function initScanner(): void {
  $("scan-add").addEventListener("click", () => {
    $("scan-file").click();
  });
  $as("scan-file", HTMLInputElement).addEventListener("change", (e) => {
    const input = e.currentTarget as HTMLInputElement;
    const files = [...(input.files ?? [])];
    input.value = "";
    if (files.length) void add(files);
  });
  $("scan-save").addEventListener("click", (e) => {
    save(e.currentTarget as HTMLButtonElement, false);
  });
  $("scan-analyse").addEventListener("click", (e) => {
    save(e.currentTarget as HTMLButtonElement, true);
  });
  $("scan-finish").addEventListener("click", () => {
    dialog().close();
  });
  dialog().addEventListener("close", () => {
    clear();
  });
}
