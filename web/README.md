# Pokédex Kanto full art

Site personnel : suivi des 151 espèces en grille illustrée (ta carte, sinon une SIR ou une full art tirée au hasard,
sinon l'illustration du Pokémon), prix en direct, objectif « la SIR si elle existe » (carte visée, reste à payer, liste
d'achat avec améliorations), visionneuse haute définition, tri par prix et vues rapides (« la moins chère à acheter »),
choix « je préfère la mienne » qui arrête la vérification. Prix du guide officiel Cardmarket (moyenne 30 jours, repère
« bon prix », courbe), version visée ou écartée par espèce, commandes suivies jusqu'à réception (vérification de la
carte, prix payé), sauvegarde JSON complète. Vue classeur (17 pages de 9 cases, miroir du binder), statistiques
(progression par objectif, valeur, dépenses, bonnes affaires), « Ma carte » (état, gradation, doubles) et placeholders
imprimables avec emplacement, carte visée et QR code vers l'offre. Versions manquantes ajoutées depuis la fiche
(recherche TCGdex, rareté choisie, gardées par les mises à jour du catalogue), alertes de prix (cloche sur la tuile, vue
rapide, annonce au chargement) et consultation hors ligne (service worker : dernières données et images déjà vues).
Liste d'achat à réglages indépendants : carte retenue (objectif, moins chère, rareté), espèces (sans carte, à
améliorer), tri (dont « au hasard » avec nouveau tirage), recherche, prix min et max par carte, budget total, bonnes
affaires ; la version visée toujours proposée ; calculée dans le navigateur, réglages retenus.
Import de commandes Cardmarket (texte collé de la page « Achat #… » : cartes reconnues par leur code, port réparti,
achats enregistrés). Prix payé et date d'achat dans « Ma carte » (dépenses des statistiques, y compris pour une carte ajoutée par « Je l'ai »).
Statistiques : chiffres clés, budget mensuel avec report (le non-dépensé passe au mois suivant), graphique des
dépenses avec le disponible de chaque mois, reste à payer détaillé. Illustrateur de chaque carte (relevé chez TCGdex avec le prix), affiché dans la fiche et la visionneuse : un clic, ou
une recherche par son nom, montre les espèces dont une carte est de lui.
Scanner de tes cartes (fiche d'une espèce au binder, « Scanner la carte »), inspiré des scanners de documents : deux
photos, recto puis verso, prises toutes seules dès que l'image est stable (le verso quand la carte est retournée), à
la meilleure définition de l'appareil (photo pleine définition quand le navigateur le permet, sinon la vidéo ; ou
l'appareil photo du téléphone). La carte est repérée sur n'importe quel fond, son vrai bord retrouvé quand le contour
passe à l'intérieur (bordure confondue avec le fond), et ses coins restent ajustables à la main, avec une loupe. Recto
et verso sont redressés à plat (63 × 88 mm à 20 px/mm), les gros plans des quatre coins découpés dans la photo
d'origine ; puis la carte suivante sans scan est proposée, pour scanner en série. Photos privées stockées dans R2,
vignettes et visionneuse dans la fiche.
Pré-évaluation PSA d'un scan complet (recto, verso, 8 coins) par Claude Opus 5.5 : le site mesure lui-même le centrage
sur les vues redressées, Claude relève l'état des coins, des bords et de la surface (format imposé, confiance par
constat) et donne son impression du centrage, et le verdict (« candidat PSA 10 », « probable 9 », « 8 ou moins »,
« photos insuffisantes ») découle de règles fixes ; une mesure de centrage douteuse (image rognée, bordures
irrégulières, ou nettement pire que l'impression de Claude) ne plafonne pas la note : l'impression de Claude la
remplace, à confirmer. Coût affiché (~0,25 $), 10 analyses par jour au plus, note PSA réellement obtenue saisie pour
mesurer la fiabilité. Indicatif : PSA examine la surface à la loupe.

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
  Une seule politique Trusted Types (`sw`), qui n'accepte que l'URL du service worker ; celui-ci a sa propre CSP
  (`connect-src` limité au site et aux deux hôtes d'images).
- **XSS** : aucun `innerHTML` (règle ESLint), construction DOM avec liste blanche d'attributs et d'URL.
- **Entrées** : Zod partout (bornes, listes blanches, objets stricts, tailles), corps limité à 256 Ko (photos du
  scanner : 8 Mo, type vérifié sur les premiers octets), SQL paramétré.
- **Photos** : compartiment R2 privé, servies par le Worker derrière Access (cache privé) ; caméra autorisée pour le
  site seul (Permissions-Policy) ; les photos sont réencodées dans le navigateur, sans métadonnées (ni position GPS).
- **Claude sans clé API** : fédération d'identité. Le Worker signe pour chaque échange un jeton ES256 de 5 minutes à
  usage unique (secret `WIF_PRIVATE_JWK`, écrit par un workflow, jamais affiché) ; Anthropic rend un jeton d'accès de
  10 minutes lié à un compte de service, dans un espace de travail plafonné. Photos envoyées par l'API Files (expiration
  d'une heure) puis supprimées ; réponse de Claude revalidée (Zod) avant usage.
- **Réponses externes** (TCGdex) validées avant usage ; délais d'expiration ; hôtes figés (anti-SSRF). Images
  affichées uniquement depuis `assets.tcgdex.net` et `raw.githubusercontent.com` (CSP), jamais copiées dans le dépôt.
- **Limite de débit** : 120 requêtes/min par utilisateur (binding Workers Rate Limiting).
- **Aucun identifiant Cardmarket** : la liaison à l'API Cardmarket (fermée aux particuliers) a été retirée ; le site
  ne fait que pointer vers les pages produit.
- **Audit** : journal des écritures (rétention 1 an), erreurs internes sans détail côté client.

## Limites connues

- Prix = tendance du guide de prix Cardmarket (quotidien, tous états et langues) ; TCGdex sert de repli et fournit les
  images. Une carte absente de TCGdex (promo récente) a un prix mais pas encore d'image. Une version ajoutée depuis le
  site n'est pas dans le guide publié par la CI (limité au catalogue) : son prix vient de TCGdex, relevé à l'ajout puis
  par la tâche planifiée tant qu'elle est utile (espèce à compléter ou alerte posée).
- Hors ligne : lecture seule (grille, classeur, fiches et statistiques avec les dernières données) ; les modifications
  et les prix en direct demandent une connexion.
- « Plus rare » = ordre Full art < IR < SIR ; l'objectif est la rareté la plus haute disponible pour l'espèce.
