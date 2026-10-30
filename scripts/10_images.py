"""Étape 10 : image vérifiée de chaque carte du catalogue -> data/images.csv. Relançable (réseau, sans cache).

TCGdex n'a pas d'image pour toutes les cartes (galeries TG/GG, Coffre étincelant, Détective Pikachu…) et
pokemontcg.io n'a pas encore les extensions récentes : on essaie, dans l'ordre, l'image française de TCGdex,
l'image anglaise de pokemontcg.io (même illustration), puis l'image anglaise de TCGdex, et on ne garde qu'une URL
qui répond réellement (HTTP 200, type image). Les cartes sans image trouvée sont listées en fin d'exécution.
"""
import csv
import datetime
import re
from concurrent.futures import ThreadPoolExecutor

import requests

from common import DATA, UA

TCGDEX = "https://api.tcgdex.net/v2/{lang}/cards/{id}"
OUT = DATA / "images.csv"

session = requests.Session()
session.headers["User-Agent"] = UA


def answers(url):
    """L'URL renvoie bien une image (quelques essais : les hôtes d'images refusent parfois une rafale)."""
    for _ in range(3):
        try:
            r = session.head(url, timeout=20, allow_redirects=True)
            if r.status_code == 405:
                r = session.get(url, timeout=20, stream=True)
            return r.status_code == 200 and r.headers.get("content-type", "").startswith("image/")
        except requests.RequestException:
            continue
    return False


def tcgdex(lang, cid):
    """Image TCGdex (miniature low.webp, comme le site) si l'API en annonce une et qu'elle répond."""
    try:
        r = session.get(TCGDEX.format(lang=lang, id=cid), timeout=20)
        base = r.json().get("image") if r.status_code == 200 else None
    except (requests.RequestException, ValueError):
        return None
    return f"{base}/low.webp" if base and answers(f"{base}/low.webp") else None


def ptcg(r, cid):
    """Image pokemontcg.io : identifiant connu, sinon déduit de celui de TCGdex (« swsh4.5sv-SV047 » ->
    « swsh45sv/SV047 » ou « swsh4pt5sv/SV047 »)."""
    m = re.fullmatch(r"([a-z0-9.]+)-([A-Za-z0-9]+)", r.get("id_ptcg") or "")
    if m:
        urls = [f"https://images.pokemontcg.io/{m[1]}/{m[2]}.png"]
    else:
        s, _, num = cid.rpartition("-")
        num = num.lstrip("0") if num.isdigit() else num
        urls = [f"https://images.pokemontcg.io/{s.replace('.', sep)}/{num}.png" for sep in ("", "pt")] if s else []
    return next((u for u in urls if answers(u)), None)


def find(r):
    langue = r.get("langue") or "fr"
    cid = r["id_tcgdex_fr"] if langue == "fr" else r.get("id_tcgdex_autre")
    if not cid:
        return None, "", ""
    lang = "fr" if langue == "fr" else ("ja" if langue == "ja" else "en")
    for source, get in ((f"tcgdex-{lang}", lambda: tcgdex(lang, cid)), ("pokemontcg", lambda: ptcg(r, cid)),
                        ("tcgdex-en", lambda: tcgdex("en", cid) if lang != "en" else None)):
        url = get()
        if url:
            return cid, url, source
    return cid, "", ""


def main():
    rows = [r for r in csv.DictReader(open(DATA / "catalogue_fullart.csv", encoding="utf-8"))
            if r["id_tcgdex_fr"] or r.get("id_tcgdex_autre")]
    with ThreadPoolExecutor(8) as ex:
        found = {cid: (url, source) for cid, url, source in ex.map(find, rows) if cid}
    today = datetime.date.today().isoformat()
    with open(OUT, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "image", "source", "verifie_le"])
        for cid in sorted(found):
            w.writerow([cid, *found[cid], today])
    missing = sorted(cid for cid, (url, _) in found.items() if not url)
    by = {}
    for url, source in found.values():
        by[source or "aucune"] = by.get(source or "aucune", 0) + 1
    print(len(found), "cartes :", ", ".join(f"{k} {v}" for k, v in sorted(by.items())))
    if missing:
        print("sans image :", " ".join(missing))


if __name__ == "__main__":
    main()
