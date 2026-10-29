// Fiche d'une espèce : grande image, objectif, versions de la plus rare à la moins rare, prix et courbe,
// version visée / écartée, alerte de prix, commande en cours, actions sur le binder, versions ajoutées.
import { api, type Candidate, type Card, type Species, type Tier } from "./api";
import { sparkline } from "./chart";
import { $, $as, action, eur, h, pad, toast } from "./dom";
import { closeOrder, receptionChecklist } from "./purchase";
import {
  alertHit,
  byNum,
  cardImg,
  CATEGORIE_NOTE,
  CONDITIONS,
  slotOf,
  goodDeal,
  langueOf,
  ownedCard,
  shortDate,
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

type History = Record<string, [string, number][]>;

let hooks: DetailHooks;
let abort: AbortController | undefined;
let current: number | null = null;
/** Historique des prix de l'espèce affichée (chargé à l'ouverture). */
let history: History = {};

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
function ordered(cards: readonly Card[]): Card[] {
  return TIERS_DESC.flatMap((t) =>
    cards.filter((c) => c.tier === t).sort((a, b) => (a.price?.trend ?? Infinity) - (b.price?.trend ?? Infinity)),
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
    out.push(
      h(
        "span",
        { class: "chip goal", title: s.wish === c.id ? "Version choisie" : "La moins chère de la rareté visée" },
        s.wish === c.id ? "Visée (ton choix)" : "Visée (la moins chère)",
      ),
    );
  if (goodDeal(c))
    out.push(h("span", { class: "chip deal", title: "Au moins 10 % sous la moyenne 30 jours" }, "Bon prix"));
  if (c.alert != null)
    out.push(
      alertHit(c)
        ? h("span", { class: "chip alert hit", title: "Prix sous ton maximum" }, `🔔 Sous ${eur(c.alert)}`)
        : h("span", { class: "chip alert", title: "Alerte de prix" }, `🔔 ≤ ${eur(c.alert)}`),
    );
  if (c.origine === "site") out.push(h("span", { class: "chip", title: "Version ajoutée depuis le site" }, "Ajoutée"));
  return out;
}

/** Après un enregistrement : referme le volet du bouton (sinon il resterait ouvert au rafraîchissement). */
const shut = (btn: EventTarget | null) => {
  (btn as HTMLElement | null)?.closest("details")?.removeAttribute("open");
};

/** Petit bouton d'action secondaire (texte). */
const link = (label: string, onclick: (e: Event) => void, title?: string) =>
  h("button", { type: "button", class: "link", title, onclick }, label);

/** Alerte de prix : prévenir quand la tendance passe sous un maximum (vue « Alertes de prix », tuile 🔔). */
function alertForm(s: Species, c: Card): HTMLElement {
  const id = encodeURIComponent(c.id);
  const max = h("input", {
    type: "number",
    name: "max",
    min: "0.01",
    step: "0.01",
    inputmode: "decimal",
    // proposition : 10 % sous la tendance actuelle
    value: String(c.alert ?? (c.price?.trend != null ? Math.floor(c.price.trend * 0.9) : "")),
    "aria-label": `Prix maximum pour ${c.cm_label}`,
  });
  return h(
    "details",
    { class: "alert-d", "data-key": `alert:${c.id}` },
    h("summary", {}, c.alert != null ? "Modifier l'alerte" : "Alerte de prix"),
    h(
      "div",
      { class: "row" },
      h("label", {}, "Prévenir sous ", max, " €"),
      h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            const btn = e.currentTarget;
            write(btn, async () => {
              const v = Math.round(Number(max.value) * 100) / 100;
              if (!(v > 0)) throw new Error("Prix maximum invalide.");
              await api(`/api/cards/${id}/alert`, { method: "PUT", json: { max_price: v } });
              toast(`Alerte : ${c.cm_label} sous ${eur(v)}.`);
              shut(btn);
              await refresh(s.num);
            });
          },
        },
        "Enregistrer",
      ),
      c.alert != null
        ? link("Retirer l'alerte", (e) => {
            const btn = e.currentTarget;
            write(btn, async () => {
              await api(`/api/cards/${id}/alert`, { method: "DELETE" });
              shut(btn);
              await refresh(s.num);
            });
          })
        : null,
    ),
  );
}

function secondary(s: Species, c: Card): HTMLElement {
  const acts: HTMLElement[] = [];
  // viser une version n'a de sens que s'il reste quelque chose à acheter pour l'espèce
  const open = s.status === "manquante" || s.status === "a_verifier";
  if (open && !c.excluded && s.owned?.card_id !== c.id)
    acts.push(
      s.wish === c.id
        ? link("Ne plus viser", (e) => {
            write(e.currentTarget, async () => {
              await api(`/api/species/${s.num}/wish`, { method: "DELETE" });
              await refresh(s.num);
            });
          })
        : link(
            "Viser cette version",
            (e) => {
              write(e.currentTarget, async () => {
                await api(`/api/species/${s.num}/wish`, { method: "PUT", json: { card_id: c.id } });
                toast(`${c.cm_label} : version visée.`);
                await refresh(s.num);
              });
            },
            "Liste d'achat et reste à payer suivront cette version",
          ),
    );
  acts.push(
    c.excluded
      ? link("Réintégrer", (e) => {
          write(e.currentTarget, async () => {
            await api(`/api/cards/${encodeURIComponent(c.id)}/excluded`, { method: "DELETE" });
            await refresh(s.num);
          });
        })
      : link(
          "Écarter",
          (e) => {
            write(e.currentTarget, async () => {
              await api(`/api/cards/${encodeURIComponent(c.id)}/excluded`, { method: "PUT", json: {} });
              toast(`${c.cm_label} écartée : ignorée pour l'objectif et les achats.`);
              await refresh(s.num);
            });
          },
          "Pas cette version (illustration, pas une vraie full art…)",
        ),
  );
  // une version ajoutée depuis le site se retire (pas une carte du catalogue, ni la tienne, ni celle commandée)
  if (c.origine === "site" && s.owned?.card_id !== c.id && s.order?.card_id !== c.id)
    acts.push(
      link("Retirer cette version", (e) => {
        if (!confirm(`Retirer ${c.cm_label} de la liste des versions ?`)) return;
        write(e.currentTarget, async () => {
          await api(`/api/cards/${encodeURIComponent(c.id)}`, { method: "DELETE" });
          toast(`${c.cm_label} retirée.`);
          await refresh(s.num);
        });
      }),
    );
  // alerte : pas sur ta carte, ni sur une version écartée (ignorée par les alertes)
  return h("div", { class: "acts" }, ...acts, s.owned?.card_id === c.id || c.excluded ? null : alertForm(s, c));
}

function priceBlock(s: Species, c: Card): HTMLElement {
  const mine = s.owned?.card_id === c.id;
  const p = c.price;
  const curve = sparkline(history[c.id] ?? []);
  return h(
    "div",
    { class: "pr" },
    h("div", { class: "price" }, eur(p?.trend)),
    h("div", { class: "mut", title: "Offre la moins chère, tous états" }, `dès ${eur(p?.low)}`),
    p?.avg30 != null
      ? h("div", { class: "mut", title: "Moyenne des ventes sur 30 jours" }, `moy. 30 j ${eur(p.avg30)}`)
      : null,
    curve,
    mine
      ? h("span", { class: "badge" }, "La mienne")
      : c.excluded
        ? null
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
  );
}

function version(s: Species, c: Card, all: readonly Card[]): HTMLElement {
  const mine = s.owned?.card_id === c.id;
  const img = cardImg(c);
  return h(
    "li",
    { class: `opt${mine ? " mine" : ""}${c.excluded ? " out" : ""}` },
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
      secondary(s, c),
    ),
    priceBlock(s, c),
  );
}

async function refresh(num: number): Promise<void> {
  await hooks.reload();
  const fresh = byNum(num);
  if (fresh && current === num) paint(fresh, false);
}

/** Commande en cours : date, prix payé, vérification à réception, annulation. */
function orderBlock(s: Species): HTMLElement | null {
  const o = s.order;
  const card = o && s.cards.find((c) => c.id === o.card_id);
  if (!o || !card) return null;
  return h(
    "div",
    { class: "order" },
    h(
      "p",
      {},
      h("strong", {}, "Commandée"),
      ` le ${shortDate(o.ordered_at)} : ${card.cm_label}${o.price_paid != null ? `, ${eur(o.price_paid)}` : ""}.`,
    ),
    receptionChecklist(card, async () => {
      await closeOrder(o.id, "recue");
      toast(`${s.nom_fr} reçu : ajouté au binder.`);
      await refresh(s.num);
    }),
    link("Annuler la commande", (e) => {
      if (!confirm("Annuler cette commande ?")) return;
      write(e.currentTarget, async () => {
        await closeOrder(o.id, "annulee");
        await refresh(s.num);
      });
    }),
  );
}

/** Ma carte : note, état, gradation, doubles (enregistrés avec « Enregistrer »). */
function myCard(s: Species): HTMLElement | null {
  const o = s.owned;
  if (!o) return null;
  const note = h("input", {
    type: "text",
    name: "note",
    maxlength: "300",
    value: o.note ?? "",
    placeholder: "Achat, provenance…",
  });
  const cond = h(
    "select",
    { name: "condition" },
    h("option", { value: "" }, "—"),
    ...Object.entries(CONDITIONS).map(([k, label]) => h("option", { value: k }, `${k} (${label})`)),
  );
  cond.value = o.condition ?? "";
  const grade = h("input", {
    type: "text",
    name: "grade",
    maxlength: "20",
    value: o.grade ?? "",
    placeholder: "PSA 10",
  });
  const doubles = h("input", { type: "number", name: "doubles", min: "0", max: "99", value: String(o.doubles ?? 0) });
  const resume = [o.condition, o.grade, o.doubles ? `${o.doubles} double${o.doubles > 1 ? "s" : ""}` : null]
    .filter(Boolean)
    .join(" · ");
  return h(
    "details",
    { class: "mycard", "data-key": "mycard" },
    h("summary", {}, `Ma carte${resume ? ` : ${resume}` : ""}`),
    h(
      "div",
      { class: "row" },
      h("label", {}, "État", cond),
      h("label", {}, "Gradée", grade),
      h("label", {}, "Doubles", doubles),
      h("label", { class: "wide" }, "Note", note),
    ),
    h(
      "button",
      {
        type: "button",
        onclick: (e: Event) => {
          const btn = e.currentTarget;
          write(btn, async () => {
            await api(`/api/species/${s.num}/details`, {
              method: "PUT",
              json: {
                note: note.value.trim() || null,
                condition: cond.value || null,
                grade: grade.value.trim() || null,
                doubles: Math.max(0, Math.min(99, Number(doubles.value) || 0)),
              },
            });
            toast("Ma carte : enregistré.");
            shut(btn);
            await refresh(s.num);
          });
        },
      },
      "Enregistrer",
    ),
  );
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
  if (goal && !s.order)
    info.push(
      h(
        "p",
        { class: "goal-line" },
        `Objectif : ${TIER_LABEL[goal.tier]} — ${s.wish === goal.id ? "ton choix" : "la moins chère"}, ${goal.cm_label} : `,
        h("strong", {}, eur(goal.price?.trend)),
        goal.price?.fetched_at
          ? h(
              "span",
              { class: "mut" },
              ` (prix du ${shortDate(goal.price.fetched_at)}, ${goal.price.source === "cardmarket" ? "guide Cardmarket" : "TCGdex"})`,
            )
          : null,
      ),
    );
  info.push(orderBlock(s), myCard(s));
  const slot = slotOf(s.num);
  info.push(h("p", { class: "mut" }, `Classeur : page ${slot.page}, case ${slot.case}.`));
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

/**
 * Ajouter une version que le catalogue n'a pas : cartes TCGdex de l'espèce (recherche au premier dépliage),
 * rareté choisie par Terence. La version ajoutée est gardée par les mises à jour du catalogue.
 */
function addVersion(s: Species): HTMLElement {
  const tier = h(
    "select",
    { name: "tier", "aria-label": "Rareté de la version ajoutée" },
    ...TIERS_DESC.map((t) => h("option", { value: t }, TIER_LABEL[t])),
  );
  tier.value = "IR";
  const list = h("div", { class: "cands" });
  const pick = (c: Candidate) =>
    h(
      "li",
      {},
      h(
        "button",
        {
          type: "button",
          class: "cand",
          title: `${c.name} ${c.numero} (${c.id})`,
          "aria-label": `Ajouter ${c.name} ${c.numero} (${c.id})`,
          onclick: (e: Event) => {
            const t = tier.value as Tier;
            if (!confirm(`Ajouter ${c.name} ${c.numero} (${c.id}) comme ${TIER_LABEL[t]} ?`)) return;
            const btn = e.currentTarget;
            write(btn, async () => {
              await api("/api/cards", { method: "POST", json: { species_num: s.num, id: c.id, tier: t } });
              toast(`${c.name} ${c.numero} ajoutée (${t}).`);
              shut(btn);
              await refresh(s.num);
            });
          },
        },
        c.image
          ? h("img", { src: c.image, alt: "", loading: "lazy", decoding: "async", width: 72, height: 100 })
          : h("span", { class: "ph" }, "?"),
        h("span", { class: "mut" }, c.id),
      ),
    );
  const box = h(
    "details",
    { class: "addv", "data-key": "addv" },
    h("summary", {}, "Ajouter une version manquante"),
    h(
      "p",
      { class: "mut" },
      "Cartes TCGdex de cette espèce absentes de la liste, les plus récentes d'abord. Choisis la rareté, puis la carte.",
    ),
    h("label", {}, "Rareté ", tier),
    list,
  );
  let loaded = false;
  box.addEventListener("toggle", () => {
    if (!box.open || loaded) return;
    loaded = true;
    list.replaceChildren(h("p", { class: "mut", role: "status" }, "Recherche chez TCGdex…"));
    api(`/api/species/${s.num}/candidates`)
      .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
      .then(({ candidates }) => {
        list.replaceChildren(
          candidates.length
            ? h("ul", {}, ...candidates.map(pick))
            : h("p", { class: "mut" }, "Aucune autre carte de cette espèce chez TCGdex."),
        );
      })
      .catch(() => {
        loaded = false;
        list.replaceChildren(h("p", { class: "warn" }, "TCGdex ne répond pas : réessaie plus tard."));
      });
  });
  return box;
}

function paint(s: Species, loading: boolean): void {
  // même espèce redessinée (prix arrivés, modification) : les volets ouverts le restent
  const body = $("detail-body");
  const reopen =
    current === s.num
      ? new Set(
          [...body.querySelectorAll<HTMLDetailsElement>("details[data-key]")]
            .filter((d) => d.open)
            .map((d) => d.dataset.key),
        )
      : new Set<string | undefined>();
  current = s.num;
  dialog().dataset.num = String(s.num);
  $("detail-title").textContent = `${pad(s.num)} ${s.nom_fr}`;
  const kept = ordered(s.cards.filter((c) => !c.excluded));
  const out = ordered(s.cards.filter((c) => c.excluded));
  const all = [...kept, ...out];
  const kids: Node[] = [summary(s, all)];
  if (loading) kids.push(h("p", { class: "mut", role: "status" }, "Actualisation des prix…"));
  for (const tier of TIERS_DESC) {
    const cs = kept.filter((c) => c.tier === tier);
    if (!cs.length) continue;
    kids.push(h("h3", {}, TIER_LABEL[tier]), h("ul", { class: "versions" }, ...cs.map((c) => version(s, c, all))));
  }
  if (out.length)
    kids.push(
      h(
        "details",
        { class: "excluded", "data-key": "excluded" },
        h("summary", {}, `Versions écartées (${out.length})`),
        h("ul", { class: "versions" }, ...out.map((c) => version(s, c, all))),
      ),
    );
  const other = h("details", { "data-key": "other" }, h("summary", {}, "Ma carte n'est pas dans la liste"));
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
  kids.push(other, addVersion(s));
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
  body.replaceChildren(...kids);
  for (const d of body.querySelectorAll<HTMLDetailsElement>("details[data-key]"))
    if (reopen.has(d.dataset.key)) d.open = true;
}

/** Ouvre (ou remplace) la fiche, puis actualise prix et historique. */
export async function openDetail(num: number): Promise<void> {
  const s = byNum(num);
  if (!s) return;
  abort?.abort();
  abort = new AbortController();
  const { signal } = abort;
  const dlg = dialog();
  history = {};
  paint(s, true);
  $("detail-body").scrollTop = 0;
  if (!dlg.open) dlg.showModal();
  hooks.shown(num);
  try {
    const [live, hist] = await Promise.all([
      api(`/api/species/${num}/prices`, { signal }).then((r) => r.json() as Promise<Record<string, Card["price"]>>),
      api(`/api/species/${num}/history`, { signal })
        .then((r) => r.json() as Promise<History>)
        .catch((): History => ({})),
    ]);
    for (const c of s.cards) if (live[c.id]) c.price = { ...c.price, ...live[c.id]! };
    history = hist;
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
    // flèches : espèce voisine, sauf dans un champ ou une liste déroulante
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.altKey || e.ctrlKey || e.metaKey) return;
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
