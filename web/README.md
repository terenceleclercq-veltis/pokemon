# Pokédex Kanto full art

Site personnel : suivi des 151 espèces en grille illustrée (ta carte, sinon une SIR ou une full art tirée au hasard,
sinon l'illustration du Pokémon), prix en direct, objectif « la SIR si elle existe » (carte visée, reste à payer, liste
d'achat avec améliorations), visionneuse haute définition, tri par prix et vues rapides (« la moins chère à acheter »),
choix « je préfère la mienne » qui arrête la vérification.

## Pile technique et pourquoi

| Choix                                | Raison                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Cloudflare Workers + D1 + Assets     | une seule plateforme, pas de serveur, base SQL, cron, limite de débit intégrée          |
| [Hono](https://hono.dev)             | routeur conçu pour Workers (~15 Ko), middlewares de sécurité standards                  |
| TypeScript strict + Zod (`zod/mini`) | types de bout en bout, validation de chaque entrée ; `zod/mini` divise le bundle par 6  |
| Front sans framework (TS + esbuild)  | grille, fiche, visionneuse : un framework ajouterait du poids ; ~20 Ko de JS (non gzip) |
| Vitest dans workerd + Playwright     | tests dans le même runtime que la production, et dans un vrai navigateur                |

## Commandes (dans `web/`)

```bash
npm ci                   # installe (npm 11 : scripts d'installation bloqués sauf liste blanche)
npm run dev              # Worker local, auth contournée UNIQUEMENT sur localhost en développement
npm run check            # lint + types + tests (workerd)
npm test -- --coverage   # couverture (seuils imposés)
npm run test:e2e         # Playwright desktop + mobile, accessibilité axe
```

Le déploiement passe exclusivement par la CI : voir [`docs/gitops.md`](../docs/gitops.md).

## Sécurité

- **Authentification** : Cloudflare Access + vérification du JWT dans le Worker (RS256, `aud`, `iss`, `exp`, `nbf`,
  e-mail autorisé, rotation des clés gérée). Échec ou config incomplète = 401 (fail closed).
- **Contournement de dev** : exige `ENVIRONMENT=development` + drapeau + `localhost` ; interdit dans `wrangler.jsonc` (CI).
- **CSRF** : en-tête custom obligatoire + contrôle `Origin` et `Sec-Fetch-Site` sur toute écriture.
- **En-têtes** : CSP stricte sans `unsafe-*` avec Trusted Types, HSTS preload, `nosniff`, `DENY`, `no-referrer`, Permissions-Policy.
- **XSS** : aucun `innerHTML` (règle ESLint), construction DOM avec liste blanche d'attributs et d'URL.
- **Entrées** : Zod partout (bornes, listes blanches, objets stricts, tailles), corps limité à 256 Ko, SQL paramétré.
- **Réponses externes** (TCGdex) validées avant usage ; délais d'expiration ; hôtes figés (anti-SSRF). Images
  affichées uniquement depuis `assets.tcgdex.net` et `raw.githubusercontent.com` (CSP), jamais copiées dans le dépôt.
- **Limite de débit** : 120 requêtes/min par utilisateur (binding Workers Rate Limiting).
- **Aucun identifiant Cardmarket** : la liaison à l'API Cardmarket (fermée aux particuliers) a été retirée ; le site
  ne fait que pointer vers les pages produit.
- **Audit** : journal des écritures (rétention 1 an), erreurs internes sans détail côté client.

## Limites connues

- Prix = tendance Cardmarket relevée par TCGdex (tous états et langues), cache 15 min ; les cartes absentes de TCGdex
  (promos récentes) n'ont pas encore de prix ni d'image.
- « Plus rare » = ordre Full art < IR < SIR ; l'objectif est la rareté la plus haute disponible pour l'espèce.
