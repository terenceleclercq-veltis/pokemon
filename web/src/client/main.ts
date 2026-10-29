// Point d'entrée : chargement, outils de la grille, navigation (adresse ↔ fiche), réglages.
import { api, type Species } from "./api";
import { renderBinder } from "./binder";
import { initBuylist } from "./buylist";
import { closeDetail, initDetail, openDetail, openNum } from "./detail";
import { $, $as, action, debounce, h, toast } from "./dom";
import { renderGrid, renderStats, visibleNums } from "./grid";
import { pushState, readState, replaceState, type Mode, type ViewState } from "./router";
import { initDashboard } from "./stats";
import { alertHit, store, type Filter, type Sort } from "./state";
import { initViewer } from "./viewer";

let view: ViewState = readState();
/** La fiche a ajouté une entrée d'historique : la fermer revient en arrière (bouton retour cohérent). */
let pushed = false;

/** Grille filtrable ou classeur, selon l'affichage choisi. */
function render(): void {
  const binder = view.v === "classeur";
  $("grid").hidden = binder;
  $("binder").hidden = !binder;
  for (const m of ["grille", "classeur"] as Mode[]) $(`v-${m}`).setAttribute("aria-pressed", String(view.v === m));
  if (binder) {
    renderStats();
    $("empty").hidden = true;
    renderBinder();
  } else renderGrid(view);
}

/** Données servies par le service worker hors ligne : bandeau avec la date de la dernière mise à jour. */
function showOffline(since: string | null): void {
  const el = $("offline");
  el.hidden = since === null;
  if (since === null) return;
  const d = new Date(since);
  el.textContent = Number.isNaN(d.getTime())
    ? "Hors ligne : dernières données enregistrées."
    : `Hors ligne : données du ${d.toLocaleDateString("fr-BE")} à ${d.toLocaleTimeString("fr-BE", {
        hour: "2-digit",
        minute: "2-digit",
      })}, en lecture seule jusqu'au retour de la connexion.`;
}

async function load(): Promise<void> {
  const res = await api("/api/pokedex");
  showOffline(res.headers.get("X-Offline"));
  const r = (await res.json()) as { species: Species[] };
  store.data = r.species;
  render();
}

/** Au chargement : alertes de prix atteintes (détail dans la vue « Alertes de prix »). */
function announceAlerts(): void {
  const hits = store.data.filter((s) => s.cards.some(alertHit));
  if (!hits.length) return;
  const names = hits.map((s) => s.nom_fr).join(", ");
  toast(`🔔 ${hits.length > 1 ? `${hits.length} alertes de prix atteintes` : "Alerte de prix atteinte"} : ${names}.`);
}

function showControls(): void {
  $as("q", HTMLInputElement).value = view.q;
  $as("filter", HTMLSelectElement).value = view.f;
  $as("sort", HTMLSelectElement).value = view.s;
}

function setView(patch: Partial<ViewState>): void {
  view = { ...view, ...patch };
  replaceState(view);
  render();
}

function bindTools(): void {
  showControls();
  $("q").addEventListener(
    "input",
    debounce(() => {
      setView({ q: $as("q", HTMLInputElement).value.trim(), v: "grille" });
    }, 120),
  );
  $("filter").addEventListener("change", () => {
    setView({ f: $as("filter", HTMLSelectElement).value as Filter, v: "grille" });
  });
  $("sort").addEventListener("change", () => {
    setView({ s: $as("sort", HTMLSelectElement).value as Sort, v: "grille" });
  });
  // vues rapides : « la moins chère à acheter », « la plus chère »…
  $("quick").addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>("[data-view]");
    if (!b?.dataset.view) return;
    const [f, s] = b.dataset.view.split(":") as [Filter, Sort];
    setView({ q: "", f, s, v: "grille" });
    showControls();
    $("grid").scrollIntoView({ block: "start", behavior: "smooth" });
  });
  for (const id of ["grid", "binder"])
    $(id).addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>("[data-num]");
      if (t) void openDetail(Number(t.dataset.num));
    });
  for (const m of ["grille", "classeur"] as Mode[])
    $(`v-${m}`).addEventListener("click", () => {
      setView({ v: m });
    });
  document.addEventListener("click", (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>("[data-close]");
    if (t) t.closest("dialog")?.close();
  });
}

function bindNavigation(): void {
  initDetail({
    reload: load,
    visible: () => (view.v === "classeur" ? store.data.map((s) => s.num) : visibleNums()),
    shown: (num) => {
      if (view.p === num) return;
      const opening = view.p === null;
      view = { ...view, p: num };
      if (opening) {
        pushState(view);
        pushed = true;
      } else replaceState(view);
    },
    search: (q) => {
      // la recherche remplace l'entrée d'historique de la fiche : closed() n'a plus rien à défaire
      pushed = false;
      view = { ...view, p: null, q, f: "all", v: "grille" };
      replaceState(view);
      closeDetail();
      showControls();
      render();
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
    const changed = next.q !== view.q || next.f !== view.f || next.s !== view.s || next.v !== view.v;
    view = next;
    pushed = false;
    if (changed) {
      showControls();
      render();
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
initDashboard((num) => {
  void openDetail(num);
});
/** Trusted Types (CSP « require-trusted-types-for ») : register() n'accepte qu'une URL validée par une politique. */
interface TrustedTypesLike {
  createPolicy(
    name: string,
    rules: { createScriptURL: (url: string) => string },
  ): {
    createScriptURL(url: string): unknown;
  };
}
function swUrl(): string {
  const tt = (globalThis as { trustedTypes?: TrustedTypesLike }).trustedTypes;
  if (!tt) return "/sw.js";
  const policy = tt.createPolicy("sw", {
    createScriptURL: (url) => {
      if (url !== "/sw.js") throw new TypeError(`URL de service worker refusée : ${url}`);
      return url;
    },
  });
  // objet TrustedScriptURL, accepté par register() à la place d'une chaîne
  return policy.createScriptURL("/sw.js") as string;
}

// hors ligne : le site reste consultable (service worker) ; de retour en ligne, données à jour
if ("serviceWorker" in navigator)
  addEventListener("load", () => {
    // swUrl() peut lever (politique refusée) : erreur attrapée comme un refus d'enregistrement
    Promise.resolve()
      .then(() => navigator.serviceWorker.register(swUrl()))
      .catch((e: unknown) => {
        console.warn("service worker non enregistré", e);
      });
  });
addEventListener("online", () => {
  load().catch(() => undefined);
});
load()
  .then(() => {
    announceAlerts();
    if (view.p) void openDetail(view.p);
  })
  .catch((e: unknown) => {
    $("progress").textContent = `Erreur de chargement : ${e instanceof Error ? e.message : "inconnue"}`;
  });
