"""Étape 8 : veille du catalogue. Signale les IR/SIR et promos parues depuis le dernier relevé. Lecture seule.

Français : parcourt les extensions sorties depuis moins de JOURS jours et les sets de promos, carte par carte
(les cartes récentes n'ont souvent pas de dexId chez TCGdex ; les libellés de rareté varient : « Special
illustration rare », « Illustration spéciale rare »…). Une carte de Kanto absente du catalogue, de
reports/cas_ambigus.csv et de data/promos_examinees.txt est signalée si c'est une IR/SIR, ou une promo (TCGdex ne
distingue pas le style des promos : à vérifier visuellement).
Japonais : IR/SIR (filtre dexId=eq:N), seulement pour les espèces sans aucune IR/SIR française.
Écrit le rapport Markdown dans le fichier passé en argument (vide si rien de neuf). Lancé chaque semaine par
.github/workflows/veille-catalogue.yml, qui ouvre ou met à jour une issue.
"""
import csv
import datetime
import re
import sys
from urllib.parse import quote

from common import DATA, REPORTS, get_json

API = "https://api.tcgdex.net/v2"
JOURS = 400
PROMOS = {"svp", "mep"}
RARES = {"illustration rare", "special illustration rare", "illustration spéciale rare"}
TIER = {"IR": "IR", "SIR": "SIR", "PROMO_IR": "IR", "AR": "IR", "SAR": "SIR"}


def main():
    sortie = sys.argv[1] if len(sys.argv) > 1 else None
    especes = {e["nom_fr"]: e["numero"] for e in csv.DictReader(open(DATA / "species_kanto.csv", encoding="utf-8"))}
    rows = list(csv.DictReader(open(DATA / "catalogue_fullart.csv", encoding="utf-8")))
    ambig = list(csv.DictReader(open(REPORTS / "cas_ambigus.csv", encoding="utf-8")))
    connus = {r[k] for r in rows for k in ("id_tcgdex_fr", "id_tcgdex_autre") if r.get(k)}
    connus |= {r["id_tcgdex_fr"] for r in ambig if r["id_tcgdex_fr"]}
    examinees = DATA / "promos_examinees.txt"
    connus |= {l.split("#")[0].strip() for l in examinees.read_text(encoding="utf-8").splitlines()} - {""}
    rares_fr = {r["numero_pokedex"] for r in rows
                if r["existe_en_fr"] == "oui" and TIER.get(r["categorie_fullart"]) in ("IR", "SIR")}
    # « Méga-Florizarre-ex », « Caninos de Hisui », « Nidoran♀ » ; le nom le plus long d'abord (Mewtwo avant Mew)
    noms = "|".join(re.escape(n) for n in sorted(especes, key=len, reverse=True))
    kanto = re.compile(rf"^(?:Méga-)?({noms})(?=$|[\s\-])")
    depuis = (datetime.date.today() - datetime.timedelta(days=JOURS)).isoformat()

    lignes = []
    for s in get_json(f"{API}/fr/sets") or []:
        detail = get_json(f"{API}/fr/sets/{quote(s['id'])}") or {}
        promo = s["id"] in PROMOS
        if not promo and (detail.get("releaseDate") or "") < depuis:
            continue
        for c in detail.get("cards", []):
            m = kanto.match(c["name"])
            if not m or c["id"] in connus:
                continue
            num = especes[m.group(1)]
            rarete = ((get_json(f"{API}/fr/cards/{quote(c['id'])}") or {}).get("rarity") or "").strip()
            if rarete.lower() in RARES:
                quoi = f"{rarete}, français"
            elif promo:
                quoi = "promo : style à vérifier visuellement"
            else:
                continue
            manque = " — **comble un manque**" if num not in rares_fr else ""
            lignes.append(f"- #{int(num):03d} {m.group(1)} : {c['name']} ({quoi}, `{c['id']}`){manque}")
    for nom, num in especes.items():
        if num in rares_fr:
            continue
        for rarete in ("Illustration rare", "Special illustration rare"):
            url = f"{API}/ja/cards?dexId=eq:{num}&rarity=eq:{quote(rarete)}"
            for c in get_json(url) or []:
                if c["id"] not in connus:
                    lignes.append(f"- #{int(num):03d} {nom} : {c['name']} ({rarete}, `{c['id']}`, japonais : aucune IR/SIR FR)")
    rapport = ""
    if lignes:
        rapport = ("Cartes absentes du catalogue (à vérifier puis ajouter dans `data/catalogue_fullart.csv`, ou une promo "
                   "écartée dans `data/promos_examinees.txt` ; voir docs/gitops.md) :\n\n" + "\n".join(sorted(set(lignes)))
                   + "\n")
    if sortie:
        open(sortie, "w", encoding="utf-8").write(rapport)
    print(rapport or "Rien de neuf.")


if __name__ == "__main__":
    main()
