// Photos de ta carte dans la fiche : bouton « Scanner la carte », dernier scan en vignettes (visionneuse), scans
// précédents, suppression.
import { analysisBlock, type Analyse, type ClaudeStatus } from "./analysis";
import { api, type Species } from "./api";
import { $, $as, action, h, toast } from "./dom";
import { openScanner } from "./scanner";

interface PhotoMeta {
  id: string;
  step: string;
  width: number;
}
interface ScanMeta {
  id: string;
  created_at: string;
  photos: PhotoMeta[];
  analyses: Analyse[];
}
interface Scans {
  scans: ScanMeta[];
  claude: ClaudeStatus;
}

const SIDE: Record<string, string> = { recto: "Recto", verso: "Verso" };
const PART: Record<string, string> = {
  hg: "coin haut gauche",
  hd: "coin haut droit",
  bd: "coin bas droit",
  bg: "coin bas gauche",
  h: "bord du haut",
  d: "bord droit",
  b: "bord du bas",
  g: "bord gauche",
};
/** Étapes du scanner précédent (anciens scans) : vue entière, coins puis bords, recto puis verso. */
const LEGACY = ["recto", "verso"].flatMap((f) => [f, ...Object.keys(PART).map((p) => `${f}-${p}`)]);
const photoNum = (step: string) => /^photo-(\d+)$/.exec(step)?.[1];
/** Libellé d'une photo : « Photo 3 », ou l'étape d'un ancien scan (« Recto · coin haut gauche »). */
const label = (step: string) => {
  const n = photoNum(step);
  if (n) return `Photo ${n}`;
  const [face = "", part] = step.split("-");
  return part ? `${SIDE[face] ?? face} · ${PART[part] ?? part}` : `${SIDE[face] ?? face} entier`;
};
const order = (step: string) => {
  const n = photoNum(step);
  return n ? 100 + Number(n) : LEGACY.indexOf(step);
};
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** Pré-évaluation à lancer dès le prochain affichage (photos enregistrées avec « Enregistrer et pré-évaluer »). */
let autorun = false;
/** Scans par espèce, lus une fois puis gardés jusqu'au prochain scan, analyse ou suppression. */
const cache = new Map<number, Promise<Scans>>();

function load(num: number): Promise<Scans> {
  let p = cache.get(num);
  if (!p) {
    p = api(`/api/species/${num}/scans`)
      .then(async (r) => (await r.json()) as Scans)
      .catch((e: unknown) => {
        cache.delete(num);
        throw e;
      });
    cache.set(num, p);
  }
  return p;
}

const sorted = (photos: PhotoMeta[]) => [...photos].sort((a, b) => order(a.step) - order(b.step));

// --- visionneuse ---------------------------------------------------------------------------------------------------

let viewing: PhotoMeta[] = [];
let at = 0;

function showPhoto(i: number): void {
  at = (i + viewing.length) % viewing.length;
  const p = viewing[at];
  if (!p) return;
  const img = $as("pv-img", HTMLImageElement);
  img.src = `/api/photos/${p.id}`;
  img.alt = label(p.step);
  $("pv-cap").textContent = `${label(p.step)} (${at + 1}/${viewing.length})`;
}

export function initPhotoViewer(): void {
  $("pv-prev").addEventListener("click", () => {
    showPhoto(at - 1);
  });
  $("pv-next").addEventListener("click", () => {
    showPhoto(at + 1);
  });
  $("photo-view").addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft") showPhoto(at - 1);
    if (e.key === "ArrowRight") showPhoto(at + 1);
  });
}

// --- bloc de la fiche ----------------------------------------------------------------------------------------------

function gallery(scan: ScanMeta): HTMLElement {
  const photos = sorted(scan.photos);
  return h(
    "ul",
    { class: "scan-thumbs" },
    ...photos.map((p, i) =>
      h(
        "li",
        {},
        h(
          "button",
          {
            type: "button",
            "aria-label": `Agrandir : ${label(p.step)}`,
            onclick: () => {
              viewing = photos;
              $as("photo-view", HTMLDialogElement).showModal();
              showPhoto(i);
            },
          },
          h("img", { src: `/api/photos/${p.id}/thumb`, alt: "", loading: "lazy", decoding: "async" }),
        ),
      ),
    ),
  );
}

function render(s: Species, { scans, claude }: Scans, changed: () => void): Node[] {
  if (!scans.length)
    return [
      h(
        "p",
        { class: "mut" },
        "Aucune photo : le recto et le verso entiers, plus des gros plans si tu veux ; Claude fait le reste.",
      ),
    ];
  const remove = (scan: ScanMeta) =>
    h(
      "button",
      {
        type: "button",
        class: "link danger",
        onclick: (e: Event) => {
          if (!confirm(`Supprimer le scan du ${day(scan.created_at)} et ses ${scan.photos.length} photos ?`)) return;
          action(e.currentTarget as HTMLButtonElement, async () => {
            await api(`/api/scans/${scan.id}`, { method: "DELETE" });
            cache.delete(s.num);
            toast("Scan supprimé.");
            changed();
          });
        },
      },
      "Supprimer",
    );
  const [last, ...older] = scans;
  if (!last) return [];
  return [
    h(
      "p",
      { class: "scan-meta" },
      `Scan du ${day(last.created_at)} · ${last.photos.length} photo${last.photos.length > 1 ? "s" : ""} `,
      remove(last),
    ),
    gallery(last),
    analysisBlock(
      last,
      claude,
      () => {
        cache.delete(s.num);
        changed();
      },
      autorun && !(autorun = false),
    ),
    older.length
      ? h(
          "details",
          { "data-key": "scans-old" },
          h("summary", {}, `Scans précédents (${older.length})`),
          ...older.map((scan) =>
            h(
              "div",
              { class: "scan-old" },
              h(
                "p",
                { class: "scan-meta" },
                `Scan du ${day(scan.created_at)} · ${scan.photos.length} photos `,
                remove(scan),
              ),
              gallery(scan),
            ),
          ),
        )
      : null,
  ].filter((n): n is HTMLElement => n !== null);
}

/** Photos de ta carte (seulement si l'espèce est au binder) ; `changed` redessine la fiche. */
export function scansBlock(s: Species, changed: () => void): HTMLElement | null {
  if (!s.owned) return null;
  const list = h("div", { class: "scan-list" }, h("p", { class: "mut" }, "Chargement des photos…"));
  let claude: ClaudeStatus | null = null;
  load(s.num)
    .then((data) => {
      claude = data.claude;
      list.replaceChildren(...render(s, data, changed));
    })
    .catch(() => {
      list.replaceChildren(h("p", { class: "mut" }, "Photos indisponibles pour le moment (hors ligne ?)."));
    });
  return h(
    "section",
    { class: "scans" },
    h(
      "h3",
      {},
      "Photos de ma carte ",
      h(
        "button",
        {
          type: "button",
          class: "primary",
          onclick: () => {
            // en série, d'autres cartes reçoivent des photos : leur cache est oublié aussi
            openScanner(s, claude, (num, analyse) => {
              cache.delete(num);
              if (num !== s.num) return;
              autorun = analyse;
              changed();
            });
          },
        },
        "📷 Ajouter des photos",
      ),
    ),
    list,
  );
}
