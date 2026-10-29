// Commandes : commandée -> reçue (vérification puis binder) ou annulée ; achat déjà en main.
import { api, type Card } from "./api";
import { action, h } from "./dom";

export const order = (card_id: string, price_paid: number | null) =>
  api("/api/purchases", { method: "POST", json: { card_id, price_paid } });

export const receivedNow = (card_id: string, price_paid: number | null) =>
  api("/api/purchases", { method: "POST", json: { card_id, price_paid, received: true } });

export const closeOrder = (id: number, state: "recue" | "annulee") =>
  api(`/api/purchases/${id}`, { method: "PATCH", json: { state } });

/** Points à vérifier à la réception (le cas du Flagadoss) avant d'ajouter la carte au binder. */
function checks(c: Card): string[] {
  return [
    `Numéro et extension : ${c.code_cm ?? `${c.set_name} ${c.numero}`}`,
    c.tier === "FA" ? "Symbole de rareté conforme à l'annonce" : "Symbole de rareté : étoile(s) dorée(s)",
    "Illustration pleine carte, reflets holographiques et relief",
    "État conforme à l'annonce (coins, bords, surface)",
  ];
}

/** Liste de vérification à cocher ; « Confirmer la réception » n'est actif qu'une fois tout coché. */
export function receptionChecklist(c: Card, onConfirm: () => Promise<void>): HTMLElement {
  const boxes = checks(c).map((label) => {
    const box = h("input", { type: "checkbox" });
    return { box, row: h("li", {}, h("label", {}, box, ` ${label}`)) };
  });
  const confirmBtn = h("button", { type: "button", class: "primary" }, "Confirmer la réception");
  confirmBtn.disabled = true;
  for (const { box } of boxes)
    box.addEventListener("change", () => {
      confirmBtn.disabled = !boxes.every((b) => b.box.checked);
    });
  confirmBtn.addEventListener("click", () => {
    action(confirmBtn, onConfirm);
  });
  return h(
    "details",
    { class: "check" },
    h("summary", {}, "Reçue : vérifier la carte"),
    h("ul", {}, ...boxes.map((b) => b.row)),
    confirmBtn,
  );
}
