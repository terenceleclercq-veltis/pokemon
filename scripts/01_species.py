"""Étape 1 : les 151 espèces de Kanto (n°, nom FR, nom EN) via PokéAPI -> data/species_kanto.csv"""
import csv

from common import DATA, get_json

API = "https://pokeapi.co/api/v2/pokemon-species/{}"


def name_in(names, lang):
    return next(n["name"] for n in names if n["language"]["name"] == lang)


def main():
    rows = []
    for n in range(1, 152):
        d = get_json(API.format(n))
        rows.append((n, name_in(d["names"], "fr"), name_in(d["names"], "en")))
    with open(DATA / "species_kanto.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["numero", "nom_fr", "nom_en"])
        w.writerows(rows)
    print(f"{len(rows)} espèces écrites")


if __name__ == "__main__":
    main()
