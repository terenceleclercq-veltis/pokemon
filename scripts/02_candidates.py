"""Étape 2 : cartes candidates (full art possibles) des 151 espèces, depuis TCGdex.

Sortie : data/raw/candidates_fr.json  (détail des cartes FR, champs utiles uniquement)
         data/raw/en_ids.json         (ids EN candidats, pour détecter les cartes absentes en FR)
Les classements full art se font à l'étape 3, avec la table docs/rarity_mapping.csv.
"""
import json

from common import DATA, get_json

BASE = "https://api.tcgdex.net/v2/{}/cards"

# Raretés FR pouvant contenir des full arts (large à dessein : le tri se fait à l'étape 3).
RARITIES_FR = [
    "Ultra Rare", "Holo Rare V", "Holo Rare VMAX", "Holo Rare VSTAR",
    "Illustration rare", "Illustration spéciale rare", "Chromatique ultra rare",
    "Shiny rare", "Shiny rare V", "Shiny rare VMAX", "Holo Rare", "Rare Holo",
    "Magnifique rare", "Radieux Rare", "Hyper rare", "Couronne", "Méga Hyper Rare",
    "Deux Chromatiques", "Un Chromatique", "Double rare", "Rare",
]
RARITIES_EN = [
    "Ultra Rare", "Holo Rare V", "Holo Rare VMAX", "Holo Rare VSTAR",
    "Illustration rare", "Special illustration rare", "Shiny Ultra Rare",
    "Shiny rare", "Shiny rare V", "Shiny rare VMAX", "Holo Rare", "Rare Holo",
    "Amazing Rare", "Radiant Rare", "Hyper rare", "Crown", "Mega Hyper Rare",
    "Two Shiny", "One Shiny", "Double rare", "Rare", "Secret Rare",
]
GALLERY_PREFIXES = ("TG", "GG")


def ids(lang, params):
    return {c["id"]: c for c in (get_json(BASE.format(lang), params) or [])}


def main():
    kanto = {}  # id -> numéros de Pokédex de Kanto
    briefs = {}
    for n in range(1, 152):
        for cid, c in ids("fr", {"dexId": f"eq:{n}"}).items():
            kanto.setdefault(cid, []).append(n)
            briefs[cid] = c
    print("cartes FR liées à Kanto :", len(kanto))

    wanted = set()
    for r in RARITIES_FR:
        wanted |= set(ids("fr", {"rarity": f"eq:{r}"})) & set(kanto)
    wanted |= {cid for cid, c in briefs.items() if str(c["localId"]).startswith(GALLERY_PREFIXES)}
    print("candidates FR (raretés + galeries) :", len(wanted))

    out = []
    for i, cid in enumerate(sorted(wanted), 1):
        d = get_json(f"{BASE.format('fr')}/{cid}")
        if not d:
            continue
        out.append({
            "id": d["id"], "localId": d["localId"], "name": d["name"],
            "rarity": d.get("rarity"), "category": d.get("category"),
            "suffix": d.get("suffix"), "stage": d.get("stage"),
            "illustrator": d.get("illustrator"), "image": d.get("image"),
            "dexId": d.get("dexId"), "kanto_dex": sorted(kanto[cid]),
            "set": {"id": d["set"]["id"], "name": d["set"]["name"],
                    "official": d["set"]["cardCount"]["official"],
                    "total": d["set"]["cardCount"]["total"]},
            "variants_detailed": d.get("variants_detailed"),
            "pricing": d.get("pricing"),
        })
        if i % 100 == 0:
            print(f"  {i}/{len(wanted)}")
    (DATA / "raw" / "candidates_fr.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))

    # Côté EN : ids des mêmes raretés, pour repérer les cartes qui n'existent pas en FR.
    en_kanto = {}
    for n in range(1, 152):
        for cid in ids("en", {"dexId": f"eq:{n}"}):
            en_kanto.setdefault(cid, []).append(n)
    en_wanted = set()
    for r in RARITIES_EN:
        en_wanted |= set(ids("en", {"rarity": f"eq:{r}"})) & set(en_kanto)
    en_only = sorted(en_wanted - set(kanto))
    (DATA / "raw" / "en_ids.json").write_text(json.dumps(
        {cid: en_kanto[cid] for cid in sorted(en_wanted)}, indent=1))
    print("candidates EN :", len(en_wanted), "dont absentes de TCGdex FR :", len(en_only))


if __name__ == "__main__":
    main()
