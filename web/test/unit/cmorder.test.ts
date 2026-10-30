import { describe, expect, it } from "vitest";
import type { Card, Species, Tier } from "../../src/client/api";
import { normCode, parseOrders, planImport } from "../../src/client/cmorder";

// texte tel que copié depuis deux pages « Achat #… » de Cardmarket (sélection de toute la page)
const TEXT = `Achat #1311183717
Firreshow
À payer: 29.10.2026 15:07
Pas encore payée	Pas encore envoyée	Pas encore arrivée
Sommaire
Contenu	4 Articles
Valeur de l'article	26,90 €
Frais de port	2,55 €
Total	29,45 €
Adresse de livraison
Terence Leclercq
Pokémon Cartes (4)
Trier par...
Nom	Info.	Prix
1 x	Noadkoko (MEG 135)
Exeggutor	#135 MEG NM	7,40 €
1 x	Piafabec (MEG 151)
Spearow	#151 MEG NM	5,00 €
1 x	Grodoudou (PFL 105)
Wigglytuff	#105 PFL NM	5,50 €
2 x	Rattatac (POR 099)
Raticate	#099 POR NM	4,50 €
Achat #1311183713
prsamaral
À payer: 29.10.2026 15:07	Payée: 29.10.2026 15:07
Contenu	2 Articles
Valeur de l'article	10,00 €
Frais de port	2,95 €
Total	12,95 €
Pokémon Cartes (2)
1 x	Triopikeur de la Team Rocket (ASC 239)
Team Rocket's Dugtrio	#239 ASC NM	6,50 €
1 x	Tauros (CRI 096)
Tauros	#096 CRI NM	3,50 €`;

const card = (id: string, code: string, tier: Tier = "IR"): Card => ({
  id,
  nom_fr: id,
  set_name: "S",
  numero: "1",
  code_cm: code,
  cm_label: code,
  cm_url: null,
  tier,
  categorie: tier,
  confiance: "certain",
  langue: "fr",
  excluded: false,
  image: null,
  price: null,
});
const sp = (num: number, cards: Card[], extra: Partial<Species> = {}): Species => ({
  num,
  nom_fr: `E${num}`,
  nom_en: `E${num}`,
  status: "manquante",
  target: null,
  wish: null,
  order: null,
  owned: null,
  keep: null,
  higher: [],
  cards,
  ...extra,
});

describe("import de commandes Cardmarket", () => {
  it("lit chaque commande : numéro, date, port, valeur, cartes et prix", () => {
    const [a, b] = parseOrders(TEXT);
    expect(a).toMatchObject({ id: "1311183717", date: "2026-10-29", shipping: 2.55, value: 26.9, arrived: false });
    expect(a?.items).toEqual([
      { qty: 1, code: "MEG 135", name: "Noadkoko", price: 7.4 },
      { qty: 1, code: "MEG 151", name: "Piafabec", price: 5 },
      { qty: 1, code: "PFL 105", name: "Grodoudou", price: 5.5 },
      { qty: 2, code: "POR 099", name: "Rattatac", price: 4.5 },
    ]);
    expect(b?.items.map((i) => [i.name, i.code, i.price])).toEqual([
      ["Triopikeur de la Team Rocket", "ASC 239", 6.5],
      ["Tauros", "CRI 096", 3.5],
    ]);
  });
  it("texte sans en-tête ni retours à la ligne : une commande, cartes quand même trouvées", () => {
    const [o] = parseOrders(
      "Frais de port 1,93 € 1 x Lamantine (PFL 097) Dewgong 3,00 € 2 x Bulbizarre (MEW 166) 12,00 €",
    );
    expect(o?.items.map((i) => [i.qty, i.code, i.price])).toEqual([
      [1, "PFL 097", 3],
      [2, "MEW 166", 12],
    ]);
    expect(parseOrders("rien à voir")).toEqual([]);
  });
  it("codes équivalents malgré les zéros", () => {
    expect(normCode("POR 099")).toBe(normCode("por 99"));
    expect(normCode("HIF SV049")).toBe("HIF SV49");
  });
  it("port réparti au prorata (total exact) ; action selon le binder et les commandes en cours", () => {
    const data = [
      sp(103, [card("me01-135", "MEG 135")], {
        status: "complete",
        owned: { card_id: "me01-135", tier: "IR", note: null },
      }),
      sp(21, [card("me01-151", "MEG 151")]),
      sp(40, [card("me02-105", "PFL 105")], { order: { id: 1, card_id: "me02-105", price_paid: 5, ordered_at: "" } }),
    ];
    const lines = planImport(parseOrders(TEXT).slice(0, 1), data, true);
    expect(lines.map((l) => [l.item.code, l.paid, l.action])).toEqual([
      ["MEG 135", 8.1, "paid"], // déjà au binder : prix payé seulement
      ["MEG 151", 5.47, "ordered"], // pas encore arrivée : commandée
      ["PFL 105", 6.02, "skip"], // commande déjà en cours
      ["POR 099", 4.93, "skip"], // absente du catalogue (2 exemplaires : prix unitaire)
    ]);
    expect(lines.reduce((t, l) => t + (l.paid ?? 0) * l.item.qty, 0)).toBeCloseTo(29.45, 2);
    expect(planImport(parseOrders(TEXT).slice(0, 1), data, false).map((l) => l.paid)).toEqual([7.4, 5, 5.5, 4.5]);
  });
  it("commande arrivée : la carte va directement au binder", () => {
    const [o] = parseOrders(
      "Achat #123456\nPayée: 01.10.2026\nArrivée: 05.10.2026\nPokémon Cartes (1)\n1 x Tauros (CRI 096) 3,50 €",
    );
    expect(o?.arrived).toBe(true);
    expect(planImport([o!], [sp(128, [card("me04-096", "CRI 096")])], true)[0]?.action).toBe("received");
  });
});
