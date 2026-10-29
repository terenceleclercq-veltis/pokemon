"""Étape 6 : génère web/seed.sql (espèces + catalogue) depuis data/*.csv. Relançable.

Idempotent et non destructif : upsert des espèces et cartes ; suppression uniquement des cartes
sorties du catalogue ET non référencées par une carte possédée (clé étrangère owned.card_id).
"""
import csv

from common import DATA, ROOT

# promo au style IR = IR ; AR/SAR (japonais) = IR/SIR ; le reste (UR_ex, FA_*, TG, GG, SHINY_*) = FA
TIER = {"IR": "IR", "SIR": "SIR", "PROMO_IR": "IR", "AR": "IR", "SAR": "SIR"}


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
    rows = list(csv.DictReader(open(DATA / "catalogue_fullart.csv", encoding="utf-8")))
    fr = [r for r in rows if r["existe_en_fr"] == "oui" and r["id_tcgdex_fr"]]
    # Autre langue (id_tcgdex_autre) seulement si l'espèce n'a aucune IR ni SIR en français.
    rares_fr = {r["numero_pokedex"] for r in fr if TIER.get(r["categorie_fullart"]) in ("IR", "SIR")}
    autres = [r for r in rows if r.get("langue", "fr") != "fr" and r.get("id_tcgdex_autre")
              and r["numero_pokedex"] not in rares_fr]
    for r in fr + autres:
        langue = r.get("langue") or "fr"
        cid = r["id_tcgdex_fr"] if langue == "fr" else r["id_tcgdex_autre"]
        if cid in ids:
            continue
        ids.append(cid)
        prod = r["url_cardmarket"].rsplit("=", 1)[-1] if r["url_cardmarket"] else ""
        out.append(
            "INSERT INTO cards (id, species_num, nom_fr, set_name, numero, categorie, tier, confiance, id_product, code_cm, nom_cm, "
            "langue) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(id) DO UPDATE SET species_num = excluded.species_num, "
            "nom_fr = excluded.nom_fr, set_name = excluded.set_name, numero = excluded.numero, "
            "categorie = excluded.categorie, tier = excluded.tier, confiance = excluded.confiance, "
            "id_product = excluded.id_product, code_cm = excluded.code_cm, nom_cm = excluded.nom_cm, "
            "langue = excluded.langue;" % (
                q(cid), r["numero_pokedex"], q(r["carte_fr"]), q(r["set"]), q(r["numero"]),
                q(r["categorie_fullart"]), q(TIER.get(r["categorie_fullart"], "FA")), q(r["confiance"]), prod or "NULL",
                q(r.get("code_cardmarket")), q(r.get("nom_cardmarket")), q(langue)))
    keep = ",".join(q(i) for i in ids)
    out.append(f"DELETE FROM price_cache WHERE card_id NOT IN ({keep}) AND card_id NOT IN "
               "(SELECT card_id FROM owned WHERE card_id IS NOT NULL);")
    out.append(f"DELETE FROM cards WHERE id NOT IN ({keep}) AND id NOT IN "
               "(SELECT card_id FROM owned WHERE card_id IS NOT NULL);")
    (ROOT / "web" / "seed.sql").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(len(ids), "cartes dans web/seed.sql, dont", len(autres), "dans une autre langue")


if __name__ == "__main__":
    main()
