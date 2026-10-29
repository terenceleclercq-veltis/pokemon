"""Étape 4 : catalogue full art -> data/catalogue_fullart.csv + reports/cas_ambigus.csv

Sources : pokemontcg.io (raretés fiables) + TCGdex FR (existence en français, id produit et prix de
tendance Cardmarket). Règles de périmètre : docs/rarity_mapping.csv, décisions de Terence du 2026-10-29.
"""
import csv
import json
import re
from collections import defaultdict

from common import DATA, REPORTS, ROOT, get_json

TCGDEX = "https://api.tcgdex.net/v2/{}"
FORM_RE = re.compile(r"^(Alolan|Galarian|Hisuian|Paldean|Mega|Primal|M)\b")  # formes : exclues (décision)
CM_URL = "https://www.cardmarket.com/fr/Pokemon/Products?idProduct={}"
SET_OVERRIDES = {"me55c": "30th-c"}  # noms de sets différents entre PTCG et TCGdex
PROMO_FA_SUBTYPES = {"V", "VMAX", "VSTAR", "GX", "EX", "ex"}  # promos susceptibles d'être full art
MAPPING = {r["rarete_ptcg"]: r for r in csv.DictReader(open(ROOT / "docs/rarity_mapping.csv", encoding="utf-8"))}


def norm_name(s):
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("é", "e"))


def norm_num(s):
    s = str(s).upper()
    return s.lstrip("0") or "0" if s.isdigit() else s


def fr_pricing(detail):
    """Prix de tendance Cardmarket (EUR) au niveau produit TCGdex ; id produit ; date du relevé."""
    cm = (detail.get("pricing") or {}).get("cardmarket") or {}
    trend = cm.get("trend") or cm.get("trend-holo") or None
    return (trend, cm.get("idProduct"), (cm.get("updated") or "")[:10])


def main():
    species = {int(r["numero"]): r for r in csv.DictReader(open(DATA / "species_kanto.csv", encoding="utf-8"))}
    ptcg = json.load(open(DATA / "raw" / "ptcg_kanto.json", encoding="utf-8"))

    # sets PTCG -> TCGdex (par nom anglais), et ids FR disponibles par espèce
    en_sets = {norm_name(s["name"]): s["id"] for s in get_json(TCGDEX.format("en") + "/sets")}
    fr_sets = {s["id"] for s in get_json(TCGDEX.format("fr") + "/sets")}
    fr_cards = {}  # (set_tcgdex, num) -> id FR  (listes par set : les dexId des cartes récentes sont parfois absents)
    for sid in sorted(fr_sets):
        for c in (get_json(f"{TCGDEX.format('fr')}/sets/{sid}") or {}).get("cards", []):
            fr_cards[(sid, norm_num(c["localId"]))] = c["id"]

    rows, ambig = [], []
    stats = defaultdict(int)
    for c in ptcg:
        rar = c.get("rarity") or "None"
        m = MAPPING.get(rar)
        if c["supertype"] != "Pokémon" or m is None or m["decision"] == "exclu":
            if m is None and rar != "None":
                stats["rareté inconnue: " + rar] += 1
            continue
        if rar == "Promo" and not PROMO_FA_SUBTYPES & set(c.get("subtypes") or []):
            continue
        dex = c["nationalPokedexNumbers"]
        kanto = [d for d in dex if 1 <= d <= 151]
        form = bool(FORM_RE.match(c["name"]))
        cat, conf, remark = m["categorie_fullart"], m["confiance"], []
        number = norm_num(c["number"])
        if number.startswith("TG") or number.startswith("GG"):
            cat, conf = ("TG" if number.startswith("TG") else "GG"), "certain"
        if cat == "FA":
            sub = set(c.get("subtypes") or [])
            cat = next((f"FA_{k}" for k in ("VSTAR", "VMAX", "V", "GX", "EX", "ex") if k in sub), "FA")
        if len(dex) != 1:
            conf, remark = "ambigu", remark + [f"carte multi-espèces {dex}"]
        if form:
            conf, remark = "exclu_forme", remark + ["forme régionale/Méga/Primo : exclue (décision de Terence)"]

        sid = SET_OVERRIDES.get(c["set"]["id"]) or en_sets.get(norm_name(c["set"]["name"]))
        fr_id = fr_cards.get((sid, number)) if sid in fr_sets else None
        price, prod, date, fr_name = None, None, "", ""
        if fr_id:
            d = get_json(f"{TCGDEX.format('fr')}/cards/{fr_id}")
            if d:
                fr_name = d["name"]
                price, prod, date = fr_pricing(d)
        ptcg_trend = (c.get("cardmarket") or {}).get("prices", {}).get("trendPrice") or 0
        if price and ptcg_trend and not 0.35 < price / ptcg_trend < 3:
            remark.append(f"prix à vérifier : TCGdex {price} € vs PTCG {ptcg_trend} € (relevé PTCG périmé), id produit peut-être erroné")
        for k in kanto:
            row = {
                "numero_pokedex": k, "espece_fr": species[k]["nom_fr"], "espece_en": species[k]["nom_en"],
                "carte_en": c["name"], "carte_fr": fr_name, "set": c["set"]["name"], "set_id_ptcg": c["set"]["id"],
                "numero": c["number"], "rarete_ptcg": rar, "categorie_fullart": cat, "confiance": conf,
                "existe_en_fr": "oui" if fr_id else ("non" if sid in fr_sets else "set absent de TCGdex FR [à vérifier]"),
                "id_tcgdex_fr": fr_id or "", "id_ptcg": c["id"],
                "url_cardmarket": CM_URL.format(prod) if prod else "",
                "prix_tendance_eur": price if price is not None else "",
                "date_releve": date,
                "prix_tendance_ptcg_eur": (c.get("cardmarket") or {}).get("prices", {}).get("trendPrice", ""),
                "date_releve_ptcg": ((c.get("cardmarket") or {}).get("updatedAt") or "").replace("/", "-"),
                "prix_a_verifier": "oui" if any(x.startswith("prix à vérifier") for x in remark) else "",
                "remarque": "; ".join(remark + ([m["remarque"]] if conf != "certain" and m["remarque"] else [])),
            }
            (rows if conf in ("certain", "probable") else ambig).append(row)
    cols = list(rows[0].keys())
    key = lambda r: (r["numero_pokedex"], r["set_id_ptcg"], str(r["numero"]))
    for path, data in ((DATA / "catalogue_fullart.csv", rows), (REPORTS / "cas_ambigus.csv", ambig)):
        with open(path, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, cols)
            w.writeheader()
            w.writerows(sorted(data, key=key))
    print(f"catalogue: {len(rows)} cartes | ambigus/exclus-forme: {len(ambig)}")
    print(dict(stats))


if __name__ == "__main__":
    main()
