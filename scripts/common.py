"""Utilitaires partagés : chemins, GET avec cache disque et pause entre requêtes."""
import hashlib
import json
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
CACHE = DATA / "cache"
REPORTS = ROOT / "reports"
PAUSE = 0.15  # secondes entre deux requêtes réseau (le cache évite les répétitions)
UA = "pokemon-kanto-fullart/0.1 (projet perso, usage non commercial)"

_session = requests.Session()
_session.headers["User-Agent"] = UA


def get_json(url, params=None, retries=4):
    """GET JSON avec cache disque. Le cache est conservé : supprimer data/cache/ pour rafraîchir."""
    key = hashlib.sha1(
        (url + json.dumps(params or {}, sort_keys=True)).encode()
    ).hexdigest()
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    CACHE.mkdir(parents=True, exist_ok=True)
    for attempt in range(retries):
        time.sleep(PAUSE)
        try:
            r = _session.get(url, params=params, timeout=30)
            if r.status_code == 404:
                return None
            r.raise_for_status()
            data = r.json()
            path.write_text(json.dumps(data))
            return data
        except requests.RequestException:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** (attempt + 1))
