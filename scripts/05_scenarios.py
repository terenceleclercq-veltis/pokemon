"""Étape 5 : scénarios A/B/C, plan mensuel, liste d'envies -> reports/ """
import csv
import json
import math
from collections import defaultdict
from datetime import date

from common import DATA, REPORTS, ROOT

CFG = json.load(open(ROOT / "config/shipping.json", encoding="utf-8"))
ILLUS = ("IR", "SIR")


def f(x):
    return float(x) if x not in ("", None) else None


def prix_retenu(r):
    """(prix, source). Prudent : si TCGdex et PTCG divergent fortement, on prend le plus haut."""
    t, p = f(r["prix_tendance_eur"]), f(r["prix_tendance_ptcg_eur"])
    if t and r["prix_a_verifier"] and p:
        return max(t, p), "prudent (sources divergentes)"
    if t:
        return t, "tendance TCGdex"
    if p:
        return p, "ancien relevé PTCG (périmé)"
    return None, "prix inconnu"


def port(n_cartes, total):
    unit = CFG["envoi_suivi_eur"] if total / max(1, n_cartes) * 0 + total >= CFG["seuil_envoi_suivi_eur"] else CFG["lettre_simple_eur"]
    bas = math.ceil(n_cartes / CFG["cartes_par_vendeur_bas"]) * unit
    haut = math.ceil(n_cartes / CFG["cartes_par_vendeur_haut"]) * unit
    return round(bas, 2), round(haut, 2)


def main():
    today = date.today().isoformat()
    sp = list(csv.DictReader(open(DATA / "species_kanto.csv", encoding="utf-8")))
    cat = [r for r in csv.DictReader(open(DATA / "catalogue_fullart.csv", encoding="utf-8"))
           if r["existe_en_fr"] == "oui"]
    amb = list(csv.DictReader(open(REPORTS / "cas_ambigus.csv", encoding="utf-8")))
    by = defaultdict(list)
    for r in cat:
        r["_p"], r["_src"] = prix_retenu(r)
        by[int(r["numero_pokedex"])].append(r)
    amb_by = defaultdict(list)
    for r in amb:
        if r["confiance"] == "ambigu":
            amb_by[int(r["numero_pokedex"])].append(r)

    def cheapest(rows):
        priced = [r for r in rows if r["_p"] is not None]
        return min(priced, key=lambda r: r["_p"]) if priced else None

    picks = {"A": {}, "B": {}, "C": {}}
    for s in sp:
        n = int(s["numero"])
        rows = by.get(n, [])
        picks["A"][n] = cheapest(rows)
        picks["B"][n] = cheapest([r for r in rows if r["categorie_fullart"] in ILLUS])
        c = None
        for k in ("SIR", "IR"):
            c = c or cheapest([r for r in rows if r["categorie_fullart"] == k])
        picks["C"][n] = c or cheapest(rows)

    names = {"A": "A - Le moins cher", "B": "B - Illustrations (IR/SIR)", "C": "C - Haut de gamme"}
    tot = {}
    for k, d in picks.items():
        ch = [v for v in d.values() if v]
        cards = sum(v["_p"] for v in ch)
        bas, haut = port(len(ch), cards)
        tot[k] = (len(ch), cards, bas, haut)

    # espèces sans carte exploitable
    no_card = [s for s in sp if not picks["A"][int(s["numero"])]]
    unpriced = [s for s in sp if by.get(int(s["numero"])) and not picks["A"][int(s["numero"])]]
    no_fa = [s for s in no_card if not by.get(int(s["numero"]))]

    # fichiers : liste d'envies + choix par scénario
    with open(REPORTS / "liste_envies.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["scenario", "numero", "espece", "carte_fr", "set", "numero_carte", "categorie", "prix_retenu_eur", "source_prix", "date_releve", "url_cardmarket"])
        for k, d in picks.items():
            for n, v in d.items():
                if v:
                    w.writerow([k, n, v["espece_fr"], v["carte_fr"], v["set"], v["numero"], v["categorie_fullart"],
                                round(v["_p"], 2), v["_src"], v["date_releve"], v["url_cardmarket"]])

    # plan mensuel (scénario A), cartes bon marché d'abord
    plan, month, cur, cur_n = [], 1, 0.0, 0
    for v in sorted((v for v in picks["A"].values() if v), key=lambda v: v["_p"]):
        b, h = port(cur_n + 1, cur + v["_p"])
        if cur + v["_p"] + h > CFG["budget_mensuel_eur"] and cur_n:
            month, cur, cur_n = month + 1, 0.0, 0
        cur += v["_p"]
        cur_n += 1
        plan.append((month, v))
    months = defaultdict(list)
    for m, v in plan:
        months[m].append(v)

    top = sorted((v for v in picks["A"].values() if v), key=lambda v: -v["_p"])[:10]
    flagged = [v for d in picks.values() for v in d.values() if v and v["prix_a_verifier"]]
    flagged = list({v["id_ptcg"]: v for v in flagged}.values())
    stale = {v["id_ptcg"]: v for d in picks.values() for v in d.values() if v and v["_src"].startswith("ancien")}

    L = [f"# Chiffrage collection Kanto full art - phase 1 ({today})", "",
         f"Prix : tendance Cardmarket (EUR) relevée par TCGdex le {max(r['date_releve'] for r in cat)}. Aucun achat effectué.",
         "Décisions de périmètre (Terence, 29/10/2026) : Hyper Rare exclues ; formes de base uniquement (régionales/Méga exclues) ; "
         "espèces sans full art FR signalées et non comptées.", "",
         "## Totaux par scénario", "",
         "| Scénario | Espèces couvertes | Cartes (€) | Port estimé (€) bas-haut | Total (€) |", "|---|---|---|---|---|"]
    for k in "ABC":
        n, c, b, h = tot[k]
        L.append(f"| {names[k]} | {n}/151 | {c:.2f} | {b:.2f} - {h:.2f} | {c+b:.2f} - {c+h:.2f} |")
    L += ["", f"Port **non fiable** : hypothèses de config/shipping.json (lettre {CFG['lettre_simple_eur']} €, suivi {CFG['envoi_suivi_eur']} € dès {CFG['seuil_envoi_suivi_eur']} € de commande, "
          f"1 vendeur pour {CFG['cartes_par_vendeur_bas']} à {CFG['cartes_par_vendeur_haut']} cartes). [à vérifier] Seul le Shopping Wizard ou l'optimisation sur annonces réelles donnera le vrai port.", "",
          f"## Espèces sans full art disponible en français ({len(no_card)})", ""]
    L.append(", ".join(f"{s['numero']} {s['nom_fr']}" for s in no_card))
    n_amb = [s for s in no_card if amb_by.get(int(s["numero"]))]
    L += ["", f"Parmi elles, {len(n_amb)} ont au moins un candidat **ambigu** (secrète/arc-en-ciel/promo/multi-espèces), voir `reports/cas_ambigus.csv` : "
          + ", ".join(s["nom_fr"] for s in n_amb), "",
          "## Les 10 cartes les plus chères (scénario A)", "", "| Espèce | Carte | Set | Catégorie | Prix € | Source |", "|---|---|---|---|---|---|"]
    for v in top:
        L.append(f"| {v['espece_fr']} | {v['carte_fr']} | {v['set']} {v['numero']} | {v['categorie_fullart']} | {v['_p']:.2f} | {v['_src']} |")
    share = sum(v["_p"] for v in top) / tot["A"][1] * 100
    L += ["", f"Ces 10 cartes pèsent {share:.0f} % du total du scénario A.", "",
          f"## Plan d'achat mensuel (scénario A, budget {CFG['budget_mensuel_eur']:.0f} € port inclus)", "",
          "Cartes bon marché d'abord. Le regroupement par vendeur réel n'est possible qu'avec les annonces (étape 6) ; ici 1 lot = 1 mois.", ""]
    for m, vs in months.items():
        c = sum(v["_p"] for v in vs)
        b, h = port(len(vs), c)
        L.append(f"- **Mois {m}** : {len(vs)} cartes, {c:.2f} € + port {b:.2f}-{h:.2f} € ; "
                 f"de {vs[0]['espece_fr']} ({vs[0]['_p']:.2f} €) à {vs[-1]['espece_fr']} ({vs[-1]['_p']:.2f} €)")
    L += [f"", f"Durée estimée : **{len(months)} mois** (scénario A).", "", "## Limites de la méthode", "",
          "- Prix de tendance = indicatif, **toutes langues confondues** (un produit Cardmarket n'a pas de prix par langue) ; "
          "le prix réel d'une annonce FR en état MT/NM/EX peut différer.",
          "- Aucune annonce par vendeur collectée : état/vendeur/port réels non vérifiés (pas d'API Cardmarket, lecture automatique du site non utilisée).",
          f"- {len(flagged)} cartes retenues ont des prix TCGdex/PTCG très divergents (id produit possiblement erroné ; valeur prudente utilisée) : "
          + ", ".join(f"{v['carte_en']} {v['set']} {v['numero']}" for v in flagged) + ".",
          f"- {len(stale)} cartes n'ont que l'ancien relevé PTCG (périmé) : " + ", ".join(f"{v['carte_en']} {v['set']}" for v in stale.values()) + ".",
          "- Cartes du set 30e Anniversaire (sept. 2026) sans prix TCGdex : exclues des scénarios tant que le prix n'est pas relevé.",
          "- Raretés 'Rare Ultra' des ères anciennes = full art 'probable' (Alternate Art non distinguables).",
          "- Existence en FR déduite de TCGdex (couverture à confirmer sur Cardmarket)."]
    (REPORTS / f"chiffrage_{today}.md").write_text("\n".join(L) + "\n", encoding="utf-8")
    print("\n".join(L[:14]))
    print("sans carte:", len(no_card), "| mois:", len(months))


if __name__ == "__main__":
    main()
