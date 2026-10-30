// Fenêtre « Importer des commandes Cardmarket » : texte collé -> aperçu (carte reconnue, prix payé, action) -> achats.
import { api } from "./api";
import { type Action, type ImportLine, parseOrders, planImport } from "./cmorder";
import { $, $as, action, eur, h, pad, toast } from "./dom";
import { store } from "./state";

const LABEL: Record<Action, string> = {
  paid: "Prix payé de « Ma carte »",
  received: "Reçue : au binder",
  ordered: "Commandée : en attente",
  skip: "Ignorer",
};

let lines: ImportLine[] = [];
let reload: () => Promise<void> = () => Promise.resolve();

/** Actions possibles pour une ligne : rien si la carte est inconnue ; prix payé si elle est déjà au binder. */
function choices(l: ImportLine): Action[] {
  if (!l.card) return ["skip"];
  if (l.s?.owned?.card_id === l.card.id) return ["paid", "skip"];
  if (l.s?.order) return ["skip"];
  return ["received", "ordered", "skip"];
}

function row(l: ImportLine, i: number): HTMLElement {
  const select = h(
    "select",
    { "aria-label": `Action pour ${l.item.name} (${l.item.code})`, "data-i": i },
    ...choices(l).map((a) => h("option", { value: a }, LABEL[a])),
  );
  select.value = l.action;
  select.addEventListener("change", () => {
    l.action = select.value as Action;
    renderSummary();
  });
  return h(
    "li",
    { class: "imp" },
    h(
      "div",
      { class: "grow" },
      h("strong", {}, `${l.item.qty > 1 ? `${l.item.qty} × ` : ""}${l.item.name} (${l.item.code})`),
      h(
        "div",
        { class: "mut" },
        l.card && l.s ? `${pad(l.s.num)} ${l.s.nom_fr} · ${l.card.tier}` : "",
        l.note ? h("span", { class: "warn" }, ` ${l.note}`) : null,
        l.item.qty > 1 ? h("span", {}, " · un seul exemplaire enregistré (les autres : « Doubles »)") : null,
      ),
    ),
    h("div", { class: "pr" }, h("strong", {}, eur(l.paid)), select),
  );
}

function renderSummary(): void {
  const todo = lines.filter((l) => l.action !== "skip");
  $("cm-apply").textContent = `Enregistrer ${todo.length} achat${todo.length > 1 ? "s" : ""}`;
  $as("cm-apply", HTMLButtonElement).disabled = !todo.length;
}

function analyse(): void {
  const orders = parseOrders($as("cm-text", HTMLTextAreaElement).value);
  if (!orders.length) {
    $("cm-result").replaceChildren(
      h("p", { class: "warn" }, "Aucune carte reconnue : copie toute la page de la commande (Ctrl+A, Ctrl+C)."),
    );
    return;
  }
  lines = planImport(orders, store.data, $as("cm-ship", HTMLInputElement).checked);
  const blocks = orders.map((o) => {
    const items = o.items.reduce((t, i) => t + (i.price ?? 0) * i.qty, 0);
    // contrôle : la somme des cartes lues doit égaler la « valeur de l'article » annoncée
    const gap = o.value != null && Math.abs(o.value - items) > 0.005;
    return h(
      "section",
      {},
      h(
        "h3",
        {},
        `${o.id ? `Achat #${o.id}` : "Commande"}${o.date ? ` du ${o.date.split("-").reverse().join("/")}` : ""}`,
        h(
          "span",
          { class: "mut" },
          ` · ${o.items.length} carte(s) · port ${eur(o.shipping)}${o.arrived ? " · arrivée" : ""}`,
        ),
      ),
      gap
        ? h(
            "p",
            { class: "warn" },
            `Cartes lues : ${eur(items)} pour ${eur(o.value)} annoncés : une carte a peut-être été manquée.`,
          )
        : null,
      h("ol", { class: "buylist" }, ...lines.flatMap((l, i) => (l.order === o ? [row(l, i)] : []))),
    );
  });
  $("cm-result").replaceChildren(
    ...blocks,
    h("div", { class: "row" }, h("button", { id: "cm-apply", type: "button", class: "primary", onclick: apply }, "")),
  );
  renderSummary();
}

async function save(l: ImportLine): Promise<void> {
  if (!l.card || !l.s) return;
  const date = l.order.date ?? undefined;
  if (l.action === "paid")
    await api(`/api/species/${l.s.num}/paid`, { method: "PUT", json: { price_paid: l.paid, date } });
  else
    await api("/api/purchases", {
      method: "POST",
      json: { card_id: l.card.id, price_paid: l.paid, date, ...(l.action === "received" ? { received: true } : {}) },
    });
}

function apply(e: Event): void {
  action(e.currentTarget as HTMLButtonElement, async () => {
    const todo = lines.filter((l) => l.action !== "skip");
    const failed: string[] = [];
    for (const l of todo)
      await save(l).catch((err: unknown) => {
        failed.push(`${l.item.name} (${err instanceof Error ? err.message : "erreur"})`);
      });
    await reload();
    toast(
      failed.length
        ? `${todo.length - failed.length} achat(s) enregistré(s) ; échec : ${failed.join(", ")}.`
        : `${todo.length} achat(s) enregistré(s).`,
      failed.length ? "err" : "ok",
    );
    if (!failed.length) {
      $as("cm-text", HTMLTextAreaElement).value = "";
      $("cm-result").replaceChildren();
      $as("cm-import", HTMLDialogElement).close();
    } else analyse();
  });
}

export function initCmImport(onChange: () => Promise<void>): void {
  reload = onChange;
  // boutons « Importer des commandes Cardmarket » (liste d'achat, réglages)
  for (const b of document.querySelectorAll<HTMLElement>("[data-cm-import]"))
    b.addEventListener("click", () => {
      for (const d of document.querySelectorAll<HTMLDialogElement>("dialog[open]")) d.close();
      $as("cm-import", HTMLDialogElement).showModal();
      $("cm-text").focus();
    });
  $("cm-parse").addEventListener("click", analyse);
  $("cm-ship").addEventListener("change", () => {
    if (lines.length) analyse();
  });
}
