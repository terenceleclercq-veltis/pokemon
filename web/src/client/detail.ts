// Fiche d'une espèce : grande image, objectif, versions de la plus rare à la moins rare, actions sur le binder.
import { api, type Card, type Species, type Tier } from "./api";
import { $, $as, action, eur, h, pad, toast } from "./dom";
import {
  byNum,
  cardImg,
  CATEGORIE_NOTE,
  langueOf,
  ownedCard,
  targetOf,
  TIER_LABEL,
  TIERS_DESC,
  visualOf,
} from "./state";
import { openViewer } from "./viewer";

export interface DetailHooks {
  /** Recharge le pokédex après une modification. */
  reload: () => Promise<void>;
  /** Numéros des espèces visibles dans la grille, dans l'ordre affiché (navigation ← →). */
  visible: () => number[];
  /** La fiche affichée change (ouverture ou navigation). */
  shown: (num: number) => void;
  /** La fiche se ferme. */
  closed: () => void;
}

let hooks: DetailHooks;
let abort: AbortController | undefined;
let current: number | null = null;

const dialog = () => $as("detail", HTMLDialogElement);
export const openNum = () => (dialog().open ? current : null);

/** Lien vers la version exacte sur Cardmarket (nouvel onglet, sans référent). */
function cmLink(url: string, label: string): HTMLAnchorElement {
  return h(
    "a",
    { href: url, target: "_blank", rel: "noopener noreferrer", class: "cm", "aria-label": `${label} sur Cardmarket` },
    "Cardmarket ↗",
  );
}

/** Code Cardmarket (« MEW 166 ») : un clic copie le libellé exact de la recherche (« Bulbizarre (MEW 166) »). */
function cmCode(code: string, label: string): HTMLButtonElement {
  return h(
    "button",
    {
      type: "button",
      class: "code",
      title: "Copier pour la recherche Cardmarket",
      "aria-label": `Copier « ${label} »`,
      onclick: () => {
        navigator.clipboard.writeText(label).then(
          () => {
            toast(`Copié : ${label}`);
          },
          () => {
            toast(`À rechercher sur Cardmarket : ${label}`);
          },
        );
      },
    },
    code,
  );
}

const write = (btn: EventTarget | null, fn: () => Promise<void>) => {
  action(btn as HTMLButtonElement, fn);
};

/** Versions dans l'ordre d'affichage : SIR, IR puis full art ; chaque rareté de la moins chère à la plus chère. */
function ordered(s: Species): Card[] {
  return TIERS_DESC.flatMap((t) =>
    s.cards.filter((c) => c.tier === t).sort((a, b) => (a.price?.trend ?? Infinity) - (b.price?.trend ?? Infinity)),
  );
}

function badges(c: Card, s: Species): HTMLElement[] {
  const out: HTMLElement[] = [h("span", { class: `chip t-${c.tier}` }, c.tier)];
  const lang = langueOf(c.langue);
  if (lang) out.push(h("span", { class: "chip lang" }, lang));
  const note = CATEGORIE_NOTE[c.categorie];
  if (note) out.push(h("span", { class: "chip" }, note));
  if (c.confiance === "probable")
    out.push(h("span", { class: "chip", title: "Style full art non vérifié" }, "probable"));
  if (s.target === c.id)
    out.push(h("span", { class: "chip goal", title: "La moins chère de la rareté visée" }, "Visée"));
  return out;
}

function version(s: Species, c: Card, all: readonly Card[]): HTMLElement {
  const mine = s.owned?.card_id === c.id;
  const img = cardImg(c);
  return h(
    "li",
    { class: `opt${mine ? " mine" : ""}` },
    h(
      "button",
      {
        type: "button",
        class: "thumb",
        "aria-label": `Agrandir ${c.nom_fr} (${c.set_name})`,
        onclick: () => {
          openViewer(s, all, c.id);
        },
      },
      img
        ? h("img", { src: img, alt: "", loading: "lazy", decoding: "async", width: 72, height: 100 })
        : h("span", { class: "ph" }, "?"),
    ),
    h(
      "div",
      { class: "grow" },
      h("div", { class: "name" }, c.nom_fr, c.code_cm ? cmCode(c.code_cm, c.cm_label) : null),
      h("div", { class: "chips" }, ...badges(c, s)),
      h("div", { class: "mut" }, `${c.set_name} · ${c.numero}`),
      c.cm_url ? cmLink(c.cm_url, c.cm_label) : null,
    ),
    h(
      "div",
      { class: "pr" },
      h("div", { class: "price" }, eur(c.price?.trend)),
      h("div", { class: "mut", title: "Offre la moins chère, tous états" }, `dès ${eur(c.price?.low)}`),
      mine
        ? h("span", { class: "badge" }, "La mienne")
        : h(
            "button",
            {
              type: "button",
              onclick: (e: Event) => {
                write(e.currentTarget, async () => {
                  await api(`/api/species/${s.num}/owned`, { method: "PUT", json: { card_id: c.id } });
                  toast(`${s.nom_fr} ajouté au binder.`);
                  await refresh(s.num);
                });
              },
            },
            "Je l'ai",
          ),
    ),
  );
}

async function refresh(num: number): Promise<void> {
  await hooks.reload();
  const fresh = byNum(num);
  if (fresh && current === num) paint(fresh, false);
}

function summary(s: Species, all: readonly Card[]): HTMLElement {
  const mine = ownedCard(s);
  const goal = targetOf(s);
  const v = visualOf(s);
  const info: (HTMLElement | null)[] = [
    h(
      "p",
      { class: "state" },
      s.owned
        ? `Dans le binder : ${TIER_LABEL[s.owned.tier]}${mine ? ` (${mine.cm_label})` : " (carte hors catalogue)"}`
        : "Pas encore dans le binder.",
    ),
  ];
  if (goal)
    info.push(
      h(
        "p",
        { class: "goal-line" },
        `Objectif : ${TIER_LABEL[goal.tier]} — la moins chère, ${goal.cm_label} : `,
        h("strong", {}, eur(goal.price?.trend)),
      ),
    );
  if (s.status === "a_verifier")
    info.push(
      h("p", { class: "warn" }, `${s.higher.length} version(s) plus rare(s) existe(nt).`),
      h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            write(e.currentTarget, async () => {
              await api(`/api/species/${s.num}/keep`, { method: "PUT", json: {} });
              toast("Choix conservé : plus de vérification.");
              await refresh(s.num);
            });
          },
        },
        "Je préfère la mienne (ne plus vérifier)",
      ),
    );
  if (s.status === "choisie")
    info.push(
      h("p", { class: "mut" }, "Choix conservé : plus de vérification."),
      h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            write(e.currentTarget, async () => {
              await api(`/api/species/${s.num}/keep`, { method: "DELETE" });
              await refresh(s.num);
            });
          },
        },
        "Reprendre la vérification",
      ),
    );
  if (!s.cards.length)
    info.push(
      h(
        "p",
        { class: "mut" },
        "Aucune carte full art connue pour cette espèce : la veille hebdomadaire signalera les prochaines.",
      ),
    );
  return h(
    "div",
    { class: "hero" },
    h(
      "button",
      {
        type: "button",
        class: `zoom ${v.kind}`,
        "aria-label": v.card
          ? `Agrandir ${v.card.nom_fr} (${v.card.set_name})`
          : `Agrandir l'illustration de ${s.nom_fr}`,
        onclick: () => {
          openViewer(s, all, v.card?.id);
        },
      },
      h("img", { src: v.src, alt: "", decoding: "async", width: 220, height: 307 }),
    ),
    h("div", { class: "hero-info" }, ...info.filter((x): x is HTMLElement => x !== null)),
  );
}

function paint(s: Species, loading: boolean): void {
  current = s.num;
  dialog().dataset.num = String(s.num);
  $("detail-title").textContent = `${pad(s.num)} ${s.nom_fr}`;
  const all = ordered(s);
  const kids: Node[] = [summary(s, all)];
  if (loading) kids.push(h("p", { class: "mut", role: "status" }, "Actualisation des prix…"));
  for (const tier of TIERS_DESC) {
    const cs = all.filter((c) => c.tier === tier);
    if (!cs.length) continue;
    kids.push(h("h3", {}, TIER_LABEL[tier]), h("ul", { class: "versions" }, ...cs.map((c) => version(s, c, all))));
  }
  const other = h("details", {}, h("summary", {}, "Ma carte n'est pas dans la liste"));
  for (const t of ["FA", "IR", "SIR"] as Tier[])
    other.append(
      h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            write(e.currentTarget, async () => {
              await api(`/api/species/${s.num}/owned`, { method: "PUT", json: { tier: t } });
              await refresh(s.num);
            });
          },
        },
        `J'ai une ${TIER_LABEL[t]}`,
      ),
    );
  kids.push(other);
  if (s.owned)
    kids.push(
      h(
        "button",
        {
          type: "button",
          class: "danger",
          onclick: (e: Event) => {
            write(e.currentTarget, async () => {
              if (!confirm(`Retirer ${s.nom_fr} du binder ?`)) return;
              await api(`/api/species/${s.num}/owned`, { method: "DELETE" });
              await refresh(s.num);
            });
          },
        },
        "Retirer du binder",
      ),
    );
  $("detail-body").replaceChildren(...kids);
}

/** Ouvre (ou remplace) la fiche, puis actualise les prix en direct. */
export async function openDetail(num: number): Promise<void> {
  const s = byNum(num);
  if (!s) return;
  abort?.abort();
  abort = new AbortController();
  const dlg = dialog();
  paint(s, true);
  $("detail-body").scrollTop = 0;
  if (!dlg.open) dlg.showModal();
  hooks.shown(num);
  try {
    const live = (await (await api(`/api/species/${num}/prices`, { signal: abort.signal })).json()) as Record<
      string,
      Card["price"]
    >;
    for (const c of s.cards) if (live[c.id]) c.price = { ...c.price, ...live[c.id]! };
    if (dlg.open && current === num) paint(s, false);
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
    toast("Prix en direct indisponibles : affichage du dernier relevé.", "err");
    if (current === num) paint(s, false);
  }
}

export function closeDetail(): void {
  if (dialog().open) dialog().close();
}

/** Espèce voisine dans l'ordre de la grille (ou du Pokédex si la fiche n'y figure pas). */
function neighbour(d: 1 | -1): number | null {
  if (current === null) return null;
  const list = hooks.visible();
  const order = list.includes(current) ? list : Array.from({ length: 151 }, (_, i) => i + 1);
  const i = order.indexOf(current);
  return order[(i + d + order.length) % order.length] ?? null;
}

function go(d: 1 | -1): void {
  const n = neighbour(d);
  if (n !== null && n !== current) void openDetail(n);
}

export function initDetail(cb: DetailHooks): void {
  hooks = cb;
  const dlg = dialog();
  $("d-prev").addEventListener("click", () => {
    go(-1);
  });
  $("d-next").addEventListener("click", () => {
    go(1);
  });
  dlg.addEventListener("close", () => {
    abort?.abort();
    current = null;
    hooks.closed();
  });
  dlg.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else return;
    e.preventDefault();
  });
  // balayage horizontal sur mobile : espèce précédente / suivante
  let start: { x: number; y: number } | null = null;
  const body = $("detail-body");
  body.addEventListener("pointerdown", (e) => {
    start = e.pointerType === "touch" ? { x: e.clientX, y: e.clientY } : null;
  });
  body.addEventListener("pointerup", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
  });
}
