"""Étape 7 : ajoute la colonne code_cardmarket à data/catalogue_fullart.csv. Relançable.

Code affiché par Cardmarket à côté du nom (« Bulbizarre (MEW 166) ») : abréviation officielle de
l'extension (TCGdex, champ abbreviation.official) + numéro imprimé (localId TCGdex, partie de l'id après le
dernier tiret, avec ses zéros : « 001 », « SV49 », « TG01 »).
"""
import csv

from common import DATA, get_json

# Sous-extensions sans abréviation propre chez TCGdex : celle de l'extension parente.
PARENT = {"sma": "HIF"}  # Destinées Occultes, Coffre Étincelant


def code(set_id, local_id, cache={}):
    if set_id not in cache:
        s = get_json(f"https://api.tcgdex.net/v2/fr/sets/{set_id}") or {}
        abbr = (s.get("abbreviation") or {}).get("official") or PARENT.get(set_id)
        cache[set_id] = abbr.split(":")[0] if abbr else None  # « LOR:TG » -> « LOR »
    return f"{cache[set_id]} {local_id}" if cache[set_id] else ""


def main():
    path = DATA / "catalogue_fullart.csv"
    rows = list(csv.DictReader(open(path, encoding="utf-8")))
    fields = list(rows[0].keys())
    if "code_cardmarket" not in fields:
        fields.insert(fields.index("url_cardmarket") + 1, "code_cardmarket")
    missing = []
    for r in rows:
        tid = r["id_tcgdex_fr"]
        r["code_cardmarket"] = code(*tid.rsplit("-", 1)) if tid else ""
        if tid and not r["code_cardmarket"]:
            missing.append(tid)
    with open(path, "w", encoding="utf-8", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(rows)
    print(sum(1 for r in rows if r["code_cardmarket"]), "codes ;", len(missing), "sans code :", missing)


if __name__ == "__main__":
    main()
