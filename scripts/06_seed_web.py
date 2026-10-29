"""Étape 6 : génère web/seed.sql (espèces + catalogue) depuis data/*.csv. Relançable.

Idempotent et non destructif : upsert des espèces et cartes ; suppression uniquement des cartes
sorties du catalogue ET non référencées par une carte possédée (clé étrangère owned.card_id).
"""
import csv

from common import DATA, ROOT

TIER = {"IR": "IR", "SIR": "SIR"}  # tout le reste (UR_ex, FA_*, TG, GG, SHINY_*) = 'FA'


def q(v):
    return "NULL" if v in (None, "") else "'" + str(v).replace("'", "''") + "'"


def main():
    out = []
    for r in csv.DictReader(open(DATA / "species_kanto.csv", encoding="utf-8")):
        out.append(
            f"INSERT INTO species (num, nom_fr, nom_en) VALUES ({r['numero']},{q(r['nom_fr'])},{q(r['nom_en'])}) "
            "ON CONFLICT(num) DO UPDATE SET nom_fr = excluded.nom_fr, nom_en = excluded.nom_en;"
        )
    ids = []
    for r in csv.DictReader(open(DATA / "catalogue_fullart.csv", encoding="utf-8")):
        if r["existe_en_fr"] != "oui" or not r["id_tcgdex_fr"] or r["id_tcgdex_fr"] in ids:
            continue
        ids.append(r["id_tcgdex_fr"])
        prod = r["url_cardmarket"].rsplit("=", 1)[-1] if r["url_cardmarket"] else ""
        out.append(
            "INSERT INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET species_num = excluded.species_num, "
            "nom_fr = excluded.nom_fr, set_name = excluded.set_name, numero = excluded.numero, "
            "categorie = excluded.categorie, tier = excluded.tier, confiance = excluded.confiance, "
            "id_product = excluded.id_product, code_cm = excluded.code_cm, nom_cm = excluded.nom_cm;" % (
                q(r["id_tcgdex_fr"]), r["numero_pokedex"], q(r["carte_fr"]), q(r["set"]), q(r["numero"]),
                q(r["categorie_fullart"]), q(TIER.get(r["categorie_fullart"], "FA")), q(r["confiance"]), prod or "NULL",
                q(r.get("code_cardmarket")), q(r.get("nom_cardmarket"))))
    keep = ",".join(q(i) for i in ids)
    out.append(f"DELETE FROM price_cache WHERE card_id NOT IN ({keep}) AND card_id NOT IN "
               "(SELECT card_id FROM owned WHERE card_id IS NOT NULL);")
    out.append(f"DELETE FROM cards WHERE id NOT IN ({keep}) AND id NOT IN "
               "(SELECT card_id FROM owned WHERE card_id IS NOT NULL);")
    (ROOT / "web" / "seed.sql").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(len(ids), "cartes dans web/seed.sql")


if __name__ == "__main__":
    main()
