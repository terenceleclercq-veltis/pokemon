# Modèle GitOps

`main` est la **source de vérité** : ce qui est sur `main` est ce qui tourne. Rien ne se déploie depuis un poste.

```
PR ──► CI (lint, types, tests workerd, E2E navigateur, sécurité) ──► revue ──► merge sur main
                                                                                  │
main ──► CI ──► staging (auto : migrations D1, déploiement, smoke test) ──► production (approbation manuelle)
                     └── échec du smoke test ──► rollback automatique vers la version précédente
```

| Élément | Où c'est déclaré |
|---|---|
| Worker, bindings, crons, limites de débit, environnements | `web/wrangler.jsonc` |
| Schéma de base | `web/migrations/*.sql` (appliquées par la CI, jamais à la main) |
| Catalogue des cartes | `data/catalogue_fullart.csv` → `web/seed.sql` (vérifié synchronisé en CI) |
| Pipeline | `.github/workflows/` |
| Secrets | GitHub Environments (CI) et `wrangler secret` (runtime), jamais dans le repo |

## Workflows

| Fichier | Déclencheur | Rôle |
|---|---|---|
| `ci.yml` | chaque PR, et avant tout déploiement | lint, types, 68 tests dans workerd, couverture ≥ 85 %, E2E Playwright + axe (desktop et mobile), bundle de prod à blanc, audit npm et signatures, recherche de secrets, revue des dépendances |
| `deploy.yml` | push sur `main` | CI → staging → production |
| `_deploy-env.yml` | appelé par `deploy.yml` | garde-fous, migrations, déploiement étiqueté par commit, smoke tests, rollback auto |
| `rollback.yml` | manuel | retour à une version donnée |
| `catalogue.yml` | manuel | sauvegarde D1 puis application idempotente du catalogue |
| `codeql.yml` | PR, main, hebdo | analyse statique (TS, Python, workflows) |
| `dependabot.yml` | hebdo | mises à jour groupées, délai de 7 jours avant adoption |

Bonnes pratiques appliquées : actions figées par SHA, `permissions` minimales, `persist-credentials: false`, aucune
interpolation `${{ }}` dans les scripts (anti-injection), concurrence sérialisée sur les déploiements, npm 11 avec
scripts d'installation bloqués sauf liste blanche (`allowScripts`), versions exactes et lockfile.

## Migrations D1 : règle « expand / contract »

Les migrations s'appliquent **avant** le nouveau code ; l'ancienne version doit donc encore fonctionner avec le nouveau
schéma (et le rollback ne défait pas une migration). Ajouter colonnes/tables dans une livraison, retirer l'ancien usage
dans une livraison suivante. Jamais de `DROP` ou de renommage dans la même livraison que le code qui en dépend.

## Configuration à faire une fois (par Terence)

Je n'ai pas accès au compte Cloudflare ni aux réglages GitHub : ces étapes restent manuelles.

**Cloudflare**
1. Créer deux bases : `npx wrangler d1 create pokedex-staging` et `npx wrangler d1 create pokedex`, reporter les `database_id` dans `wrangler.jsonc`.
2. Zero Trust → Access : une application par environnement (domaine du Worker), politique « Allow » = ton e-mail ;
   reporter `ACCESS_TEAM` et `ACCESS_AUD` dans `wrangler.jsonc`.
3. Créer un **service token** « ci-smoke », l'autoriser dans chaque application (politique « Service Auth ») ; reporter son
   Client ID dans `CI_SERVICE_TOKEN_ID`. Le Worker ne lui ouvre que `GET /api/health`.
4. Ajouter un domaine personnalisé au Worker (`routes` dans `wrangler.jsonc`). workers.dev est activé en staging et
   production uniquement pour les smoke tests (le Bot Fight Mode de la zone bloque les runners GitHub) : son hostname
   doit figurer dans la **même** application Access que le domaine personnalisé.
5. `openssl rand -base64 32 | npx wrangler secret put ENC_KEY --env staging` (puis `--env production`, clé différente).
6. Jeton API Cloudflare limité au compte : *Workers Scripts: Edit*, *D1: Edit*, *Workers Routes: Edit*, *Account Settings: Read*.

**GitHub** (Settings)
1. Environments `staging` et `production` avec les secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET` et la variable `APP_URL`.
2. `production` : *Required reviewers* = toi, *Deployment branches* = `main` uniquement.
3. Ruleset sur `main` : PR obligatoire, checks requis (`Lint, types, tests…`, `Tests navigateur…`, `Scripts de données…`,
   `Sécurité…`, `CodeQL`), historique linéaire, pas de force-push, revue des CODEOWNERS.
4. Activer Dependabot alerts, secret scanning et push protection.

Tant que `wrangler.jsonc` contient `REMPLACER`, le déploiement s'arrête au premier garde-fou (`scripts/check-env.mjs`).
