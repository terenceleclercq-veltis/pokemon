// Liste d'achat : une carte par espèce à compléter ou à améliorer, selon des réglages indépendants (carte retenue,
// espèces, tri, prix max par carte, budget total, bonnes affaires), calculée sur le pokédex chargé (aussi hors ligne).
// « Commandée » la met en attente (hors liste), « Reçue » l'ajoute au binder ; le prix payé est mémorisé.
import {
  buyPlan,
  DEFAULT_OPTIONS,
  type BuyLine,
  type BuyOptions,
  type BuySort,
  type Choice,
  type Scope,
} from "./buyplan";
import { $, $as, action, debounce, eur, h, toast } from "./dom";
import { closeOrder, order, receivedNow, receptionChecklist } from "./purchase";
import { cardImg, CATEGORIE_NOTE, langueOf, shortDate, store } from "./state";

/** Réglages retenus d'une visite à l'autre (confort de ce navigateur seulement). */
const KEY = "pokedex.liste-achat";
/** Tirage en cours du tri « au hasard » (gardé avec les réglages : la liste ne change pas toute seule). */
let seed = DEFAULT_OPTIONS.seed;
let items: BuyLine[] = [];
let reload: () => Promise<void> = () => Promise.resolve();

/** Déduit le prix du budget restant (champ facultatif) après une commande ou un achat. */
function spend(amount: number | null): void {
  const input = $as("buy-budget", HTMLInputElement);
  if (!input.value || amount == null) return;
  input.value = String(Math.max(0, Math.round((Number(input.value) - amount) * 100) / 100));
}

async function after(msg: string): Promise<void> {
  toast(msg);
  await reload();
  renderBuylist();
}

function row(l: BuyLine): HTMLElement {
  const it = {
    card_id: l.card.id,
    espece: l.s.nom_fr,
    label: l.card.cm_label,
    url: l.card.cm_url,
    tier: l.card.tier,
    categorie: l.card.categorie,
    image: cardImg(l.card),
    upgrade: l.upgrade,
    trend: l.trend,
  };
  const lang = langueOf(l.card.langue);
  const paid = h("input", {
    type: "number",
    min: "0",
    max: "100000",
    step: "0.01",
    inputmode: "decimal",
    value: it.trend != null ? it.trend.toFixed(2) : "",
    "aria-label": `Prix payé pour ${it.label} (€)`,
    title: "Prix payé (€) : prérempli avec la tendance",
  });
  const price = () => (paid.value === "" ? null : Number(paid.value));
  return h(
    "li",
    { class: "buy" },
    it.image
      ? h("img", { src: it.image, alt: "", loading: "lazy", decoding: "async", width: 44, height: 61 })
      : h("span", { class: "ph" }, "?"),
    h(
      "div",
      { class: "grow" },
      it.url
        ? h("a", { href: it.url, target: "_blank", rel: "noopener noreferrer" }, it.label)
        : h("span", {}, `${it.label} (lien inconnu)`),
      h(
        "div",
        { class: "chips" },
        h("span", { class: `chip t-${it.tier}` }, it.tier),
        CATEGORIE_NOTE[it.categorie] ? h("span", { class: "chip" }, CATEGORIE_NOTE[it.categorie]) : null,
        lang ? h("span", { class: "chip lang" }, lang) : null,
        it.upgrade ? h("span", { class: "chip goal", title: "Remplace ta carte actuelle" }, "amélioration") : null,
        l.off != null && l.off >= 0.1
          ? h(
              "span",
              { class: "chip deal", title: "Sous la moyenne des ventes sur 30 jours" },
              `−${Math.round(l.off * 100)} %`,
            )
          : null,
        h("span", { class: "mut" }, it.espece),
      ),
    ),
    h(
      "div",
      { class: "pr" },
      paid,
      h(
        "div",
        { class: "btns" },
        h(
          "button",
          {
            type: "button",
            "aria-label": `${it.label} commandée`,
            title: "Commandée : en attente de réception, hors liste d'achat",
            onclick: (e: Event) => {
              action(e.currentTarget as HTMLButtonElement, async () => {
                await order(it.card_id, price());
                spend(price());
                await after(`${it.espece} : commande enregistrée.`);
              });
            },
          },
          "Commandée",
        ),
        h(
          "button",
          {
            type: "button",
            "aria-label": `${it.label} achetée`,
            title: "Déjà en main : directement au binder",
            onclick: (e: Event) => {
              action(e.currentTarget as HTMLButtonElement, async () => {
                await receivedNow(it.card_id, price());
                spend(price());
                await after(`${it.espece} marqué comme acheté.`);
              });
            },
          },
          "Reçue",
        ),
      ),
    ),
  );
}

/** Commandes en cours (depuis le pokédex chargé) : vérification à réception ou annulation. */
function orders(): HTMLElement | null {
  const pending = store.data.flatMap((s) => {
    const o = s.order;
    const card = o && s.cards.find((c) => c.id === o.card_id);
    return o && card ? [{ s, o, card }] : [];
  });
  if (!pending.length) return null;
  return h(
    "section",
    { class: "orders" },
    h("h3", {}, `En commande (${pending.length})`),
    h(
      "ul",
      { class: "buylist" },
      ...pending.map(({ s, o, card }) => {
        const img = cardImg(card);
        return h(
          "li",
          { class: "buy" },
          img
            ? h("img", { src: img, alt: "", loading: "lazy", decoding: "async", width: 44, height: 61 })
            : h("span", { class: "ph" }, "?"),
          h(
            "div",
            { class: "grow" },
            h("strong", {}, card.cm_label),
            h(
              "div",
              { class: "mut" },
              `${s.nom_fr} · commandée le ${shortDate(o.ordered_at)}${o.price_paid != null ? ` · ${eur(o.price_paid)}` : ""}`,
            ),
            receptionChecklist(card, async () => {
              await closeOrder(o.id, "recue");
              await after(`${s.nom_fr} reçu : ajouté au binder.`);
            }),
          ),
          h(
            "button",
            {
              type: "button",
              class: "link",
              onclick: (e: Event) => {
                if (!confirm("Annuler cette commande ?")) return;
                action(e.currentTarget as HTMLButtonElement, async () => {
                  await closeOrder(o.id, "annulee");
                  await after("Commande annulée.");
                });
              },
            },
            "Annuler",
          ),
        );
      }),
    ),
  );
}

/** Réglages lus dans le formulaire. */
function readOptions(): BuyOptions {
  const num = (id: string) => {
    const v = Number($as(id, HTMLInputElement).value);
    return v > 0 ? v : null;
  };
  return {
    choice: $as("buy-choice", HTMLSelectElement).value as Choice,
    scope: $as("buy-scope", HTMLSelectElement).value as Scope,
    sort: $as("buy-sort", HTMLSelectElement).value as BuySort,
    minCard: num("buy-min"),
    maxCard: num("buy-max"),
    budget: num("buy-budget"),
    dealsOnly: $as("buy-deals", HTMLInputElement).checked,
    query: $as("buy-q", HTMLInputElement).value,
    seed,
  };
}

function writeOptions(o: BuyOptions): void {
  $as("buy-choice", HTMLSelectElement).value = o.choice;
  $as("buy-scope", HTMLSelectElement).value = o.scope;
  $as("buy-sort", HTMLSelectElement).value = o.sort;
  $as("buy-min", HTMLInputElement).value = o.minCard != null ? String(o.minCard) : "";
  $as("buy-max", HTMLInputElement).value = o.maxCard != null ? String(o.maxCard) : "";
  $as("buy-budget", HTMLInputElement).value = o.budget != null ? String(o.budget) : "";
  $as("buy-deals", HTMLInputElement).checked = o.dealsOnly;
  $as("buy-q", HTMLInputElement).value = o.query;
  seed = o.seed;
}

function saved(): BuyOptions {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULT_OPTIONS, ...(JSON.parse(raw) as Partial<BuyOptions>) } : DEFAULT_OPTIONS;
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function save(o: BuyOptions): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    // stockage indisponible (navigation privée) : réglages non retenus
  }
}

/** Résumé : nombre de cartes, total, et ce que les limites ont écarté. */
function summary(p: ReturnType<typeof buyPlan>, o: BuyOptions): string {
  const parts = [`${p.items.length} carte${p.items.length > 1 ? "s" : ""} · ${eur(p.total)}`];
  if (o.budget != null) parts.push(`budget ${eur(o.budget)}, reste ${eur(Math.max(0, o.budget - p.total))}`);
  if (p.underCard) parts.push(`${p.underCard} sous ${eur(o.minCard)} par carte`);
  if (p.overCard) parts.push(`${p.overCard} au-dessus de ${eur(o.maxCard)} par carte`);
  if (p.overBudget) parts.push(`${p.overBudget} hors budget`);
  if (p.noPrice) parts.push(`${p.noPrice} sans prix`);
  return `${parts.join(" · ")} (tendance, hors port)`;
}

export function renderBuylist(): void {
  const o = readOptions();
  $("buy-draw").hidden = o.sort !== "random";
  save(o);
  const plan = buyPlan(store.data, o);
  items = plan.items;
  $("buylist").replaceChildren(
    ...[
      orders(),
      h("p", { class: "mut" }, summary(plan, o)),
      plan.items.length
        ? h("ol", { class: "buylist" }, ...plan.items.map(row))
        : h("p", { class: "mut" }, "Aucune carte avec ces réglages."),
    ].filter((x): x is HTMLElement => x !== null),
  );
}

/** CSV (séparateur « ; », BOM pour Excel) de la liste affichée. */
function exportCsv(): void {
  const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Espèce", "Carte", "Rareté", "Langue", "Amélioration", "Prix tendance (€)", "Lien Cardmarket"],
    ...items.map((l) => [
      l.s.nom_fr,
      l.card.cm_label,
      l.card.tier,
      l.card.langue,
      l.upgrade ? "oui" : "non",
      l.trend?.toFixed(2).replace(".", ",") ?? "",
      l.card.cm_url ?? "",
    ]),
  ].map((l) => l.map(cell).join(";"));
  const url = URL.createObjectURL(new Blob([`\ufeff${lines.join("\r\n")}\r\n`], { type: "text/csv;charset=utf-8" }));
  h("a", { href: url, download: `liste-achat-${new Date().toISOString().slice(0, 10)}.csv` }).click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export function initBuylist(onChange: () => Promise<void>): void {
  reload = onChange;
  writeOptions(saved());
  const form = $as("buy-form", HTMLFormElement);
  $("btn-buy").addEventListener("click", () => {
    $as("buy", HTMLDialogElement).showModal();
    renderBuylist();
  });
  form.addEventListener("change", renderBuylist);
  form.addEventListener("input", debounce(renderBuylist, 300));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
  });
  // « Réinitialiser » : réglages par défaut (le reset natif remettrait les valeurs du HTML, puis on recalcule)
  form.addEventListener("reset", () => {
    setTimeout(() => {
      writeOptions(DEFAULT_OPTIONS);
      renderBuylist();
    });
  });
  $("btn-csv").addEventListener("click", exportCsv);
  $("buy-draw").addEventListener("click", () => {
    seed = Math.floor(Math.random() * 2 ** 31) + 1;
    renderBuylist();
  });
}
