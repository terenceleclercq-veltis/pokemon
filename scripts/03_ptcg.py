"""Étape 3 : cartes des 151 espèces depuis pokemontcg.io (raretés fiables : « Rare Ultra » = full art,
« Rare Holo V/GX/EX » = carte standard). Sortie : data/raw/ptcg_kanto.json"""
import json

from common import DATA, get_json

URL = "https://api.pokemontcg.io/v2/cards"
FIELDS = "id,name,number,rarity,subtypes,supertype,set,nationalPokedexNumbers,cardmarket,artist,images"


def main():
    cards, page = [], 1
    while True:
        d = get_json(URL, {"q": "nationalPokedexNumbers:[1 TO 151]", "pageSize": 250,
                           "page": page, "select": FIELDS}, retries=8)
        cards += d["data"]
        print(f"page {page}: {len(cards)}/{d['totalCount']}")
        if len(cards) >= d["totalCount"] or not d["data"]:
            break
        page += 1
    (DATA / "raw" / "ptcg_kanto.json").write_text(json.dumps(cards, ensure_ascii=False))
    print(len(cards), "cartes")


if __name__ == "__main__":
    main()
