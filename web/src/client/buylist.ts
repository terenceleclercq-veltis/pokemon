// Liste d'achat : cartes visées, de la moins chère à la plus chère, dans le budget ; « Achetée » les passe au binder.
import { api, type Tier } from "./api";
import { $, $as, action, debounce, eur, h, toast } from "./dom";
import { CATEGORIE_NOTE, langueOf } from "./state";

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

/** Déduit le prix du budget restant (champ facultatif) après un achat. */
function spend(amount: number | null): void {
  const input = $as("buy-budget", HTMLInputElement);
  if (!input.value || amount == null) return;
  input.value = String(Math.max(0, Math.round((Number(input.value) - amount) * 100) / 100));
}

/** Marque des cartes comme achetées : elles passent au binder et sortent de la liste. */
async function markBought(list: readonly BuyItem[]): Promise<void> {
  for (const it of list) {
    await api(`/api/species/${it.num}/owned`, { method: "PUT", json: { card_id: it.card_id } });
    spend(it.trend);
  }
  toast(
    list.length === 1
      ? `${list[0]?.espece ?? ""} marqué comme acheté.`
      : `${list.length} cartes marquées comme achetées.`,
  );
  await reload();
  await renderBuylist();
}

function row(it: BuyItem): HTMLElement {
  const lang = langueOf(it.langue);
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
      h("strong", { class: "price" }, eur(it.trend)),
      h(
        "button",
        {
          type: "button",
          "aria-label": `${it.label} achetée`,
          onclick: (e: Event) => {
            action(e.currentTarget as HTMLButtonElement, () => markBought([it]));
          },
        },
        "Achetée",
      ),
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
  const sum = `${r.items.length} carte${r.items.length > 1 ? "s" : ""} · ${eur(r.total)}${
    r.budget ? ` sur ${eur(r.budget)}` : ""
  } (tendance, hors port)`;
  const all = r.items.length
    ? h(
        "button",
        {
          type: "button",
          onclick: (e: Event) => {
            if (!confirm(`Marquer les ${r.items.length} cartes comme achetées ?`)) return;
            action(e.currentTarget as HTMLButtonElement, () => markBought(r.items));
          },
        },
        "Tout marquer comme acheté",
      )
    : null;
  $("buylist").replaceChildren(
    h("p", { class: "mut" }, sum),
    h("ol", { class: "buylist" }, ...r.items.map(row)),
    all ?? "",
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
