"""Étape 9 : prix de nos cartes extraits du guide de prix public Cardmarket -> JSON. Lecture seule.

Le guide (fichier quotidien, ~16 Mo, 80 000 produits) est la source des prix « tendance » affichés par Cardmarket et
repris par TCGdex. Il couvre aussi les cartes que TCGdex ne connaît pas encore (promos récentes). Seules nos cartes
(idProduct du catalogue) sont gardées : le fichier produit fait quelques dizaines de Ko.
Lancé chaque jour par .github/workflows/prix.yml, qui le publie sur la branche « donnees-prix » ; le Worker le lit
et met à jour ses prix (src/worker/feed.ts).
"""
import csv
import datetime
import json
import sys

import requests

from common import DATA, UA

GUIDE = "https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json"


def euros(v):
    return round(float(v), 2) if isinstance(v, (int, float)) and v > 0 else None


def main():
    sortie = sys.argv[1] if len(sys.argv) > 1 else "prix.json"
    produits = set()
    for r in csv.DictReader(open(DATA / "catalogue_fullart.csv", encoding="utf-8")):
        prod = r["url_cardmarket"].rsplit("=", 1)[-1] if r["url_cardmarket"] else ""
        if prod.isdigit():
            produits.add(int(prod))
    r = requests.get(GUIDE, timeout=180, headers={"User-Agent": UA})
    r.raise_for_status()
    guide = r.json()
    prix = {}
    for p in guide["priceGuides"]:
        if p.get("idProduct") not in produits:
            continue
        # cartes uniquement holographiques : le prix est parfois publié en « -holo »
        pick = lambda k: euros(p.get(k)) or euros(p.get(f"{k}-holo"))  # noqa: E731
        prix[str(p["idProduct"])] = {k: pick(k) for k in ("trend", "low", "avg1", "avg7", "avg30")}
    doc = {
        "version": 1,
        "guide": guide["createdAt"],
        "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "prices": dict(sorted(prix.items(), key=lambda kv: int(kv[0]))),
    }
    with open(sortie, "w", encoding="utf-8") as f:
        json.dump(doc, f, separators=(",", ":"))
    print(len(prix), "prix sur", len(produits), "produits du catalogue ; guide du", guide["createdAt"])


if __name__ == "__main__":
    main()
