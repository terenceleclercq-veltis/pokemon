// Liste d'achat : cartes visées, de la moins chère à la plus chère, dans le budget ; commandes en cours.
// « Commandée » la met en attente (hors liste), « Reçue » l'ajoute au binder ; le prix payé est mémorisé.
import { api, type Tier } from "./api";
import { $, $as, action, debounce, eur, h, toast } from "./dom";
import { closeOrder, order, receivedNow, receptionChecklist } from "./purchase";
import { cardImg, CATEGORIE_NOTE, langueOf, shortDate, store } from "./state";

interface BuyItem {
  num: number;
  card_id: string;
  espece: string;
  label: string;
  url: string | null;
  langue: string;
  tier: Tier;
  categorie: string;
  image: string | null;
  /** Remplace une carte déjà possédée d'une rareté inférieure. */
  upgrade: boolean;
  trend: number | null;
}

let items: BuyItem[] = [];
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
  await renderBuylist();
}

function row(it: BuyItem): HTMLElement {
  const lang = langueOf(it.langue);
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

export async function renderBuylist(): Promise<void> {
  const q = new URLSearchParams({ tier: $as("buy-tier", HTMLSelectElement).value });
  const budget = $as("buy-budget", HTMLInputElement).value;
  if (budget && Number(budget) > 0) q.set("budget", budget);
  const r = (await (await api(`/api/buylist?${q.toString()}`)).json()) as {
    items: BuyItem[];
    total: number;
    budget: number | null;
  };
  items = r.items;
  const sum = `${r.items.length} carte${r.items.length > 1 ? "s" : ""} à acheter · ${eur(r.total)}${
    r.budget ? ` sur ${eur(r.budget)}` : ""
  } (tendance, hors port)`;
  $("buylist").replaceChildren(
    ...[orders(), h("p", { class: "mut" }, sum), h("ol", { class: "buylist" }, ...r.items.map(row))].filter(
      (x): x is HTMLElement => x !== null,
    ),
  );
}

/** CSV (séparateur « ; », BOM pour Excel) de la liste affichée. */
function exportCsv(): void {
  const cell = (v: string | number | null) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Espèce", "Carte", "Rareté", "Langue", "Amélioration", "Prix tendance (€)", "Lien Cardmarket"],
    ...items.map((i) => [
      i.espece,
      i.label,
      i.tier,
      i.langue,
      i.upgrade ? "oui" : "non",
      i.trend?.toFixed(2).replace(".", ",") ?? "",
      i.url ?? "",
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
  const refresh = () => {
    action(null, renderBuylist);
  };
  $("btn-buy").addEventListener("click", () => {
    $as("buy", HTMLDialogElement).showModal();
    refresh();
  });
  $("buy-tier").addEventListener("change", refresh);
  $("buy-budget").addEventListener("input", debounce(refresh, 400));
  $("btn-csv").addEventListener("click", exportCsv);
}
