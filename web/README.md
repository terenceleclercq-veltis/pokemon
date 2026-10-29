# Pokédex Kanto full art (Cloudflare Worker + D1)

Site personnel : suivi des 151 espèces, prix en direct (Full art / IR / SIR) des cartes manquantes,
détection des versions plus rares pour les cartes déjà possédées, choix « je préfère la mienne ».

## Déploiement (à faire par Terence, avec son compte Cloudflare)

```bash
cd web && npm install
npx wrangler login
npx wrangler d1 create pokedex          # copier database_id dans wrangler.jsonc
npx wrangler d1 execute pokedex --remote --file=schema.sql
python3 ../scripts/06_seed_web.py       # régénère seed.sql si le catalogue change
npx wrangler d1 execute pokedex --remote --file=seed.sql
openssl rand -base64 32 | npx wrangler secret put ENC_KEY   # chiffrement des clés Cardmarket
npx wrangler deploy
```

Ensuite, **avant d'utiliser le site** (sans cela toute requête est refusée : le Worker échoue en mode fermé) :

1. Cloudflare Zero Trust → Access → Applications → ajouter le site (self-hosted), politique « Allow » = ton e-mail uniquement.
2. Reporter dans `wrangler.jsonc` : `ACCESS_TEAM` (nom d'équipe) et `ACCESS_AUD` (Application Audience tag), puis `wrangler deploy`.
3. Ajouter la route/domaine personnalisé (workers.dev et URLs de prévisualisation sont désactivés).

## Sécurité en place

- Authentification : JWT Cloudflare Access vérifié dans le Worker (signature RS256, `aud`, `iss`, expiration, e-mail autorisé). Pas de jeton valide = 401.
- Pas de contournement en production : `DEV_BYPASS_AUTH` n'existe que via `npm run dev` et seulement sur `localhost`.
- Anti-CSRF : en-tête `X-Requested-With` obligatoire + contrôle `Origin` sur toute écriture.
- CSP stricte (aucun script/style inline), HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`.
- Interface sans `innerHTML` (anti-XSS) ; requêtes SQL paramétrées ; entrées validées (bornes, listes blanches, tailles).
- Identifiants Cardmarket : chiffrés AES-GCM avec `ENC_KEY` (secret Worker, hors base), jamais renvoyés au navigateur, lecture seule ; hôte API figé sur `api.cardmarket.com`.
- Journal d'audit (`audit_log`) des modifications. Erreurs internes sans détail côté client.

À ajouter côté dashboard Cloudflare (hors code) : règle WAF de limitation de débit sur `/api/*`, alertes, sauvegarde D1 (`wrangler d1 export`) ou export JSON depuis Réglages.

## Limites connues

- Prix = tendance Cardmarket relevée par TCGdex, tous états/langues confondus, cache 15 min ; ce n'est pas le prix d'une annonce précise.
- Liaison Cardmarket (OAuth 1.0a, `/account`) **non testée** : l'accès à l'API Cardmarket est restreint [à vérifier]. Elle ne passe jamais de commande.
- Catalogue = `data/catalogue_fullart.csv` (formes régionales/Méga et Hyper Rare exclues, cas ambigus à part). « Plus rare » = ordre Full art < IR < SIR.
- Les cartes du set 30e Anniversaire n'ont pas encore de prix chez TCGdex (affichées « n/d »).
