// Photos de ta carte dans la fiche : bouton « Scanner la carte », dernier scan en vignettes (visionneuse), scans
// précédents, suppression.
import { analysisBlock, type Analyse, type ClaudeStatus } from "./analysis";
import { api, type Species } from "./api";
import { $, $as, action, h, toast } from "./dom";
import { openScanner, scanSteps } from "./scanner";

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

const STEPS = scanSteps(true);
const day = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const ORDER = new Map(STEPS.map((s, i) => [s.id, i]));
const LABEL = new Map(STEPS.map((s) => [s.id, s.label]));
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

const sorted = (photos: PhotoMeta[]) =>
  [...photos].sort((a, b) => (ORDER.get(a.step) ?? 99) - (ORDER.get(b.step) ?? 99));

// --- visionneuse ---------------------------------------------------------------------------------------------------

let viewing: PhotoMeta[] = [];
let at = 0;

function showPhoto(i: number): void {
  at = (i + viewing.length) % viewing.length;
  const p = viewing[at];
  if (!p) return;
  const img = $as("pv-img", HTMLImageElement);
  img.src = `/api/photos/${p.id}`;
  img.alt = LABEL.get(p.step) ?? p.step;
  $("pv-cap").textContent = `${LABEL.get(p.step) ?? p.step} (${at + 1}/${viewing.length})`;
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
            "aria-label": `Agrandir : ${LABEL.get(p.step) ?? p.step}`,
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
  if (!scans.length) return [h("p", { class: "mut" }, "Aucune photo : le scanner prend recto, verso et gros plans.")];
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
    analysisBlock(last, claude, () => {
      cache.delete(s.num);
      changed();
    }),
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
  load(s.num)
    .then((data) => {
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
            openScanner(s, () => {
              cache.delete(s.num);
              changed();
            });
          },
        },
        "📷 Scanner la carte",
      ),
    ),
    list,
  );
}
