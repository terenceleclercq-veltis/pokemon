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

## Configuration (faite le 29/10/2026)

État en place, à refaire seulement pour un nouvel environnement ou un nouveau compte.

**Cloudflare** : compte dédié « pokemon », équipe Zero Trust `weathered-sun-382a`, sous-domaine workers.dev
`pokedex-terence`.
1. Bases D1 `pokedex-staging` et `pokedex` (`npx wrangler d1 create …`), `database_id` dans `wrangler.jsonc`.
2. Site servi sur `https://pokedex-kanto-<env>.pokedex-terence.workers.dev` (`workers_dev: true` par environnement).
   Pas de domaine personnalisé, donc pas de Bot Fight Mode devant les smoke tests.
3. Une application Access par environnement sur cet hostname : politique « Allow » = ton e-mail, politique
   « Service Auth » = service token **ci-smoke** (le Worker ne lui ouvre que `GET /api/health`). `ACCESS_TEAM`,
   `ACCESS_AUD` et `CI_SERVICE_TOKEN_ID` dans `wrangler.jsonc`. Le service token expire au bout d'un an : relancer
   l'étape 3 de `scripts/migrer-compte-pokemon.sh` pour le renouveler, puis mettre à jour `CI_SERVICE_TOKEN_ID`.
4. Aucun secret applicatif : l'ancien `ENC_KEY` (liaison API Cardmarket, retirée) n'est plus lu.
5. Jeton API CI limité au compte pokemon : *Workers Scripts: Edit*, *D1: Edit*, *Account Settings: Read*.

**Promos au style IR** : pour les espèces sans IR ni SIR en français, des promos Black Star au style « Illustration
Rare » sont ajoutées à la main (catégorie `PROMO_IR`, comptée comme IR) après vérification visuelle ; TCGdex les classe
toutes en « Promo » sans distinguer le style.

**Catalogue de repli** (décisions de Terence, 29/10/2026), appliqué par `06_seed_web.py` dans cet ordre :
1. *Formes* (Hisui, Alola, Galar, Méga, Tag Team avec une Méga) : colonne `forme = oui`, retenues seulement si
   l'espèce n'a aucune IR/SIR de forme normale en français.
2. *Autre langue* : `existe_en_fr = non`, `langue` (code TCGdex, ex. `ja`), `id_tcgdex_autre`, catégorie `AR`/`SAR`
   (comptée IR/SIR) ; retenue seulement si l'espèce n'a aucune IR/SIR en français, formes comprises. Prix lus sur
   `api.tcgdex.net/v2/<langue>/cards/<id>`.
3. *Chromatiques sans full art* (catégorie `SHINY`) : seulement si l'espèce n'a aucune autre carte.
Les Character Rare (catégorie `CHR`, full art avec dresseur) comptent comme full art. Ces lignes sont ajoutées à la
main (comme les promos IR) : relancer `04_catalogue.py` les effacerait.

**Veille** : `.github/workflows/veille-catalogue.yml` lance chaque lundi `scripts/08_veille_catalogue.py`, qui
ouvre ou met à jour l'issue « Veille catalogue : nouvelles IR/SIR ». Il parcourt carte par carte les extensions
françaises de moins de 400 jours et les sets de promos (`svp`, `mep`) : les cartes récentes n'ont souvent pas de
`dexId` chez TCGdex, et les libellés de rareté varient (« Illustration spéciale rare »). Il signale les IR/SIR
absentes du catalogue et toute nouvelle promo de Kanto (TCGdex ne distingue pas le style des promos : vérification
visuelle). Une promo écartée va dans `data/promos_examinees.txt`. Japonais : seulement pour une espèce sans IR/SIR
française. Limite : une carte encore absente de TCGdex (ex. Nidorina MEP 101 à sa sortie) n'est pas vue ; l'ajout
reste une PR vérifiée à la main.

**Catalogue** : `data/catalogue_fullart.csv` → `scripts/07_codes_cardmarket.py` (code Cardmarket « MEW 166 », depuis
TCGdex) → `scripts/06_seed_web.py` → `web/seed.sql`. Au premier déploiement d'un environnement (base vide), le pipeline charge `seed.sql`. Ensuite, toute
mise à jour du catalogue passe par `catalogue.yml` (sauvegarde D1 préalable), car `seed.sql` retire les cartes qui
ne sont plus au catalogue.

**GitHub** : environnements, secrets, variables, ruleset et sécurité sont posés par `scripts/configurer-github.sh`
(première configuration) et `scripts/migrer-compte-pokemon.sh` (bascule de compte), à lancer sur un poste avec `gh` :
le proxy des sessions Claude Code cloud refuse ces écritures.
1. Environnements `staging` et `production` : secrets `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
   `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`, variable `APP_URL`.
2. `production` : *Required reviewers* = toi, *Deployment branches* = `main` uniquement.
3. Ruleset sur `main` : PR obligatoire, checks requis (CI et CodeQL), historique linéaire, pas de force-push.
4. Dependabot alerts, secret scanning et push protection activés (dépôt public).

Tant que `wrangler.jsonc` contient `REMPLACER`, le déploiement s'arrête au premier garde-fou (`scripts/check-env.mjs`).
