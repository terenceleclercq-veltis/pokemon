// Service worker : le site reste consultable hors ligne (dernières données lues, images déjà vues).
// Réseau d'abord pour la page, le code et les lectures d'API (jamais de version périmée quand on est en ligne) ;
// cache d'abord pour les images de cartes (immuables). Écritures et prix en direct : jamais interceptés.
const sw = self as unknown as ServiceWorkerGlobalScope;

const APP = "app-v1";
const IMG = "img-v1";
/** Images gardées au plus (les plus anciennes sortent d'abord) : ~25 Ko pièce, quelques dizaines de Mo en tout. */
const IMG_MAX = 1000;
const SHELL = ["/", "/app.js", "/style.css", "/icon.svg", "/manifest.webmanifest"];
/** Fichiers et lectures gardés pour le mode hors ligne (le reste passe directement au réseau). */
const KEPT = /^\/(app\.js|style\.css|icon\.svg|icon-\d+\.png|manifest\.webmanifest|placeholders\.(html|js|css))$/;
const API_KEPT = /^\/api\/(pokedex|purchases|budget|species\/\d{1,3}\/history)$/;
const IMG_HOSTS = new Set(["assets.tcgdex.net", "raw.githubusercontent.com"]);

sw.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(APP)
      .then((c) => c.addAll(SHELL))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== APP && k !== IMG).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

/** Copie d'une réponse avec un en-tête de plus. */
function withHeader(res: Response, name: string, value: string): Response {
  const headers = new Headers(res.headers);
  headers.set(name, value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

async function networkFirst(req: Request, api: boolean): Promise<Response> {
  const cache = await caches.open(APP);
  let res: Response;
  try {
    // API : la redirection vers la connexion Access (session expirée) est repérée au lieu d'être suivie
    res = await (api ? fetch(req, { redirect: "manual" }) : fetch(req));
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: !api, ignoreVary: true });
    if (!hit) throw err;
    // lecture d'API servie hors ligne : le client affiche un bandeau avec la date de la donnée
    return api ? withHeader(hit, "X-Offline", hit.headers.get("X-Cached-At") ?? "inconnue") : hit;
  }
  if (res.type === "opaqueredirect" && api)
    return Response.json({ error: "Session expirée : recharge la page." }, { status: 401 });
  // seulement une vraie réponse du site : jamais une redirection vers la connexion Access, ni une erreur
  if (res.ok && res.type === "basic" && !res.redirected)
    await cache.put(req, api ? withHeader(res.clone(), "X-Cached-At", new Date().toISOString()) : res.clone());
  return res;
}

async function trim(cache: Cache): Promise<void> {
  const keys = await cache.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - IMG_MAX)).map((k) => cache.delete(k)));
}

async function cacheFirst(e: FetchEvent): Promise<Response> {
  const cache = await caches.open(IMG);
  const hit = await cache.match(e.request.url);
  if (hit) return hit;
  // requête CORS (les deux hôtes l'autorisent) : réponse lisible, donc mesurée au plus juste par le navigateur
  const res = await fetch(e.request.url, { mode: "cors", credentials: "omit" }).catch(() => fetch(e.request));
  if (res.ok && res.type === "cors") {
    await cache.put(e.request.url, res.clone());
    e.waitUntil(trim(cache));
  }
  return res;
}

sw.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === sw.location.origin) {
    if (req.mode === "navigate") e.respondWith(networkFirst(req, false));
    else if (KEPT.test(url.pathname)) e.respondWith(networkFirst(req, false));
    else if (API_KEPT.test(url.pathname)) e.respondWith(networkFirst(req, true));
  } else if (IMG_HOSTS.has(url.hostname) && req.destination === "image") e.respondWith(cacheFirst(e));
});
