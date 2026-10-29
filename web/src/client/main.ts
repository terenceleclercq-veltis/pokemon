// Point d'entrée : chargement, outils de la grille, navigation (adresse ↔ fiche), réglages.
import { api, type Species } from "./api";
import { initBuylist } from "./buylist";
import { closeDetail, initDetail, openDetail, openNum } from "./detail";
import { $, $as, action, debounce, h, toast } from "./dom";
import { renderGrid, visibleNums } from "./grid";
import { pushState, readState, replaceState, type ViewState } from "./router";
import { store, type Filter, type Sort } from "./state";
import { initViewer } from "./viewer";

let view: ViewState = readState();
/** La fiche a ajouté une entrée d'historique : la fermer revient en arrière (bouton retour cohérent). */
let pushed = false;

async function load(): Promise<void> {
  const r = (await (await api("/api/pokedex")).json()) as { species: Species[] };
  store.data = r.species;
  renderGrid(view);
}

function showControls(): void {
  $as("q", HTMLInputElement).value = view.q;
  $as("filter", HTMLSelectElement).value = view.f;
  $as("sort", HTMLSelectElement).value = view.s;
}

function setView(patch: Partial<ViewState>): void {
  view = { ...view, ...patch };
  replaceState(view);
  renderGrid(view);
}

function bindTools(): void {
  showControls();
  $("q").addEventListener(
    "input",
    debounce(() => {
      setView({ q: $as("q", HTMLInputElement).value.trim() });
    }, 120),
  );
  $("filter").addEventListener("change", () => {
    setView({ f: $as("filter", HTMLSelectElement).value as Filter });
  });
  $("sort").addEventListener("change", () => {
    setView({ s: $as("sort", HTMLSelectElement).value as Sort });
  });
  // vues rapides : « la moins chère à acheter », « la plus chère »…
  $("quick").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (!b?.dataset.view) return;
    const [f, s] = b.dataset.view.split(":") as [Filter, Sort];
    setView({ q: "", f, s });
    showControls();
    $("grid").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  $("grid").addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-num]");
    if (t) void openDetail(Number(t.dataset.num));
  });
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-close]");
    if (t) t.closest("dialog")?.close();
  });
}

function bindNavigation(): void {
  initDetail({
    reload: load,
    visible: visibleNums,
    shown: (num) => {
      if (view.p === num) return;
      const opening = view.p === null;
      view = { ...view, p: num };
      if (opening) {
        pushState(view);
        pushed = true;
      } else replaceState(view);
    },
    closed: () => {
      if (view.p === null) return;
      view = { ...view, p: null };
      if (pushed) {
        pushed = false;
        history.back();
      } else replaceState(view);
    },
  });
  // retour/avance du navigateur, ou adresse modifiée à la main
  addEventListener("popstate", () => {
    const next = readState();
    const changed = next.q !== view.q || next.f !== view.f || next.s !== view.s;
    view = next;
    pushed = false;
    if (changed) {
      showControls();
      renderGrid(view);
    }
    if (view.p && openNum() !== view.p) void openDetail(view.p);
    else if (!view.p && openNum() !== null) closeDetail();
  });
}

function bindSettings(): void {
  $("btn-settings").addEventListener("click", () => {
    $as("settings", HTMLDialogElement).showModal();
  });
  $("btn-wants").addEventListener("click", (e) => {
    action(e.currentTarget as HTMLButtonElement, async () => {
      const t = await (
        await api(`/api/wants?tier=${encodeURIComponent($as("wants-tier", HTMLSelectElement).value)}`)
      ).text();
      await navigator.clipboard.writeText(t);
      toast(`${t ? t.split("\n").length : 0} lignes copiées dans le presse-papiers.`);
    });
  });
  $("btn-export").addEventListener("click", (e) => {
    action(e.currentTarget as HTMLButtonElement, async () => {
      const url = URL.createObjectURL(await (await api("/api/export")).blob());
      h("a", { href: url, download: `pokedex-${new Date().toISOString().slice(0, 10)}.json` }).click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 1000);
    });
  });
  $as("file-import", HTMLInputElement).addEventListener("change", (e) => {
    action(null, async () => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      input.value = "";
      if (!file || !confirm("L'import remplace tout le binder actuel. Continuer ?")) return;
      const r = (await (await api("/api/import", { method: "POST", json: JSON.parse(await file.text()) })).json()) as {
        owned: number;
      };
      toast(`${r.owned} espèces importées.`);
      await load();
    });
  });
}

bindTools();
bindNavigation();
bindSettings();
initViewer();
initBuylist(load);
load()
  .then(() => {
    if (view.p) void openDetail(view.p);
  })
  .catch((e: unknown) => {
    $("progress").textContent = `Erreur de chargement : ${e instanceof Error ? e.message : "inconnue"}`;
  });
