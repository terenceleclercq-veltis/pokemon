# Pokédex Kanto full art

Site personnel : suivi des 151 espèces, prix en direct (Full art / IR / SIR) des cartes manquantes, détection des
versions plus rares pour les cartes possédées, choix « je préfère la mienne » qui arrête la vérification.

## Pile technique et pourquoi

| Choix                                | Raison                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| Cloudflare Workers + D1 + Assets     | une seule plateforme, pas de serveur, base SQL, cron, limite de débit intégrée          |
| [Hono](https://hono.dev)             | routeur conçu pour Workers (~15 Ko), middlewares de sécurité standards                  |
| TypeScript strict + Zod (`zod/mini`) | types de bout en bout, validation de chaque entrée ; `zod/mini` divise le bundle par 6  |
| Front sans framework (TS + esbuild)  | 151 tuiles et 2 dialogues : un framework ajouterait du poids sans bénéfice ; 9 Ko de JS |
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
- **Réponses externes** (TCGdex, Cardmarket) validées avant usage ; délais d'expiration ; hôtes figés (anti-SSRF).
- **Limite de débit** : 120 requêtes/min par utilisateur (binding Workers Rate Limiting).
- **Secrets Cardmarket** : AES-256-GCM avec données associées, clé `ENC_KEY` hors base, jamais renvoyés au navigateur.
- **Audit** : journal des écritures (rétention 1 an), erreurs internes sans détail côté client.

## Limites connues

- Prix = tendance Cardmarket relevée par TCGdex (tous états et langues), cache 15 min.
- Liaison Cardmarket (OAuth 1.0a) testée contre un vecteur de référence mais **pas contre l'API réelle** : son accès est restreint.
- « Plus rare » = ordre Full art < IR < SIR.
