"""Étape 8 : veille du catalogue. Signale les IR/SIR parues depuis le dernier relevé. Lecture seule.

Interroge TCGdex pour chaque espèce de Kanto (filtre exact dexId=eq:N) et liste les cartes absentes du catalogue
et de reports/cas_ambigus.csv (déjà examinées) :
- IR/SIR françaises (toutes espèces) ;
- IR/SIR japonaises, seulement pour les espèces sans aucune IR/SIR française (règle des autres langues).
Écrit le rapport Markdown dans le fichier passé en argument (vide si rien de neuf). Lancé chaque semaine par
.github/workflows/veille-catalogue.yml, qui ouvre ou met à jour une issue.
"""
import csv
import sys
from urllib.parse import quote

from common import DATA, REPORTS, get_json

RARETES = ("Illustration rare", "Special illustration rare")
TIER = {"IR": "IR", "SIR": "SIR", "PROMO_IR": "IR", "AR": "IR", "SAR": "SIR"}


def cartes(langue, num):
    out = []
    for rarete in RARETES:
        url = f"https://api.tcgdex.net/v2/{langue}/cards?dexId=eq:{num}&rarity=eq:{quote(rarete)}"
        out += [(c["id"], c["name"], rarete) for c in get_json(url) or []]
    return out


def main():
    sortie = sys.argv[1] if len(sys.argv) > 1 else None
    especes = list(csv.DictReader(open(DATA / "species_kanto.csv", encoding="utf-8")))
    rows = list(csv.DictReader(open(DATA / "catalogue_fullart.csv", encoding="utf-8")))
    ambig = list(csv.DictReader(open(REPORTS / "cas_ambigus.csv", encoding="utf-8")))
    connus = {r[k] for r in rows for k in ("id_tcgdex_fr", "id_tcgdex_autre") if r.get(k)}
    connus |= {r["id_tcgdex_fr"] for r in ambig if r["id_tcgdex_fr"]}
    rares_fr = {r["numero_pokedex"] for r in rows
                if r["existe_en_fr"] == "oui" and TIER.get(r["categorie_fullart"]) in ("IR", "SIR")}
    lignes = []
    for e in especes:
        num, nom = e["numero"], e["nom_fr"]
        manque = num not in rares_fr
        for cid, name, rarete in cartes("fr", num):
            if cid not in connus:
                note = " — **comble un manque**" if manque else ""
                lignes.append(f"- #{int(num):03d} {nom} : {name} ({rarete}, `{cid}`, français){note}")
        if manque:
            for cid, name, rarete in cartes("ja", num):
                if cid not in connus:
                    lignes.append(f"- #{int(num):03d} {nom} : {name} ({rarete}, `{cid}`, japonais : aucune IR/SIR FR)")
    rapport = ""
    if lignes:
        rapport = ("Cartes IR/SIR absentes du catalogue (à vérifier puis ajouter dans `data/catalogue_fullart.csv`, "
                   "voir docs/gitops.md) :\n\n" + "\n".join(lignes) + "\n")
    if sortie:
        open(sortie, "w", encoding="utf-8").write(rapport)
    print(rapport or "Rien de neuf.")


if __name__ == "__main__":
    main()
