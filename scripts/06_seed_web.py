"""Étape 6 : génère web/seed.sql (espèces + catalogue) depuis data/*.csv. Relançable."""
import csv

from common import DATA, ROOT

TIER = {"IR": "IR", "SIR": "SIR"}  # tout le reste (UR_ex, FA_*, TG, GG, SHINY_*) = 'FA'


def q(v):
    return "NULL" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def main():
    out = ["DELETE FROM cards;", "DELETE FROM species;"]
    for r in csv.DictReader(open(DATA / "species_kanto.csv", encoding="utf-8")):
        out.append(f"INSERT INTO species VALUES ({r['numero']},{q(r['nom_fr'])},{q(r['nom_en'])});")
    n = 0
    for r in csv.DictReader(open(DATA / "catalogue_fullart.csv", encoding="utf-8")):
        if r["existe_en_fr"] != "oui" or not r["id_tcgdex_fr"]:
            continue
        prod = r["url_cardmarket"].rsplit("=", 1)[-1] if r["url_cardmarket"] else ""
        out.append(
            "INSERT OR IGNORE INTO cards VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s);" % (
                q(r["id_tcgdex_fr"]), r["numero_pokedex"], q(r["carte_fr"]), q(r["set"]), q(r["numero"]),
                q(r["categorie_fullart"]), q(TIER.get(r["categorie_fullart"], "FA")), q(r["confiance"]),
                prod or "NULL", "NULL"))
        n += 1
    (ROOT / "web" / "seed.sql").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(n, "cartes dans web/seed.sql")


if __name__ == "__main__":
    main()
