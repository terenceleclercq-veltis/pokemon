#!/usr/bin/env bash
# Configuration unique GitHub + service token Cloudflare (voir docs/gitops.md).
# À lancer sur votre poste : bash scripts/configurer-github.sh
# Prérequis : gh (authentifié avec un compte admin du dépôt), curl, python3.
# Aucun secret n'est affiché ni écrit sur disque : saisie masquée, transmis par stdin à `gh secret set`.
# Relançable : chaque étape vérifie ce qui existe déjà.
set -euo pipefail

REPO="terenceleclercq-veltis/pokemon"
CF_API="https://api.cloudflare.com/client/v4"
URL_STAGING="https://pokedex-staging.veltis.be"
URL_PRODUCTION="https://pokedex.veltis.be"

ok() { printf '  \033[32m✔\033[0m %s\n' "$1"; }
ko() { printf '  \033[31m✘\033[0m %s\n' "$1"; }
titre() { printf '\n\033[1m%s\033[0m\n' "$1"; }
lire_secret() { # lire_secret VAR "invite" : saisie masquée
  local __v
  read -rsp "  $2 : " __v
  echo
  [ -n "$__v" ] || { ko "valeur vide"; exit 1; }
  printf -v "$1" '%s' "$__v"
}
poser_secret() { # poser_secret NOM ENV VALEUR
  printf '%s' "$3" | gh secret set "$1" --env "$2" --repo "$REPO" >/dev/null && ok "secret $1 ($2)"
}

titre "0. Vérifications"
for c in gh curl python3; do command -v "$c" >/dev/null || { ko "$c manquant"; exit 1; }; done
gh auth status >/dev/null 2>&1 || { ko "gh non authentifié : lancez « gh auth login »"; exit 1; }
[ "$(gh api "repos/$REPO" --jq .permissions.admin)" = "true" ] || { ko "votre compte n'est pas admin de $REPO"; exit 1; }
MOI_LOGIN=$(gh api user --jq .login)
MOI_ID=$(gh api user --jq .id)
ok "gh connecté en tant que $MOI_LOGIN (admin du dépôt)"

titre "1. Visibilité du dépôt"
echo "  CodeQL, la revue des dépendances, le secret scanning et la push protection sont gratuits"
echo "  sur un dépôt public, et indisponibles sur un dépôt privé de compte personnel."
read -rp "  Rendre le dépôt public ? Tapez PUBLIC pour confirmer, Entrée pour le garder privé : " choix
PUBLIC=false
if [ "$choix" = "PUBLIC" ]; then
  gh repo edit "$REPO" --visibility public --accept-visibility-change-consequences
  PUBLIC=true
  ok "dépôt public"
else
  ok "dépôt gardé privé"
fi

titre "2. Branche par défaut et sécurité"
gh api -X PATCH "repos/$REPO" -f default_branch=main >/dev/null && ok "branche par défaut = main"
gh api -X PUT "repos/$REPO/vulnerability-alerts" >/dev/null && ok "Dependabot alerts activées"
if gh api -X PATCH "repos/$REPO" --input - >/dev/null 2>&1 <<'EOF'; then
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
EOF
  ok "secret scanning et push protection activés"
else
  ko "secret scanning / push protection indisponibles (dépôt privé sans GitHub Secret Protection)"
fi

titre "3. Environnements staging et production"
for env in staging production; do
  if [ "$env" = production ]; then
    reviewers="[{\"type\":\"User\",\"id\":$MOI_ID}]"
  else
    reviewers="[]"
  fi
  gh api -X PUT "repos/$REPO/environments/$env" --input - >/dev/null <<EOF
{"wait_timer":0,"prevent_self_review":false,"reviewers":$reviewers,
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
  if ! gh api "repos/$REPO/environments/$env/deployment-branch-policies" --jq '.branch_policies[].name' | grep -qx main; then
    gh api -X POST "repos/$REPO/environments/$env/deployment-branch-policies" -f name=main -f type=branch >/dev/null
  fi
  ok "environnement $env (branche main uniquement$([ "$env" = production ] && echo ", approbation : $MOI_LOGIN"))"
done
gh variable set APP_URL --env staging --body "$URL_STAGING" --repo "$REPO" && ok "APP_URL (staging) = $URL_STAGING"
gh variable set APP_URL --env production --body "$URL_PRODUCTION" --repo "$REPO" && ok "APP_URL (production) = $URL_PRODUCTION"

titre "4. Secrets Cloudflare pour la CI"
echo "  Jeton CI à créer dans Cloudflare (My Profile > API Tokens > Create Token > Custom) :"
echo "    Account > Workers Scripts > Edit ; Account > D1 > Edit ; Account > Account Settings > Read"
echo "    Zone > Workers Routes > Edit, limité à la zone veltis.be"
lire_secret CF_ACCOUNT_ID "CLOUDFLARE_ACCOUNT_ID"
lire_secret CF_CI_TOKEN "CLOUDFLARE_API_TOKEN (jeton CI ci-dessus)"
for env in staging production; do
  poser_secret CLOUDFLARE_ACCOUNT_ID "$env" "$CF_ACCOUNT_ID"
  poser_secret CLOUDFLARE_API_TOKEN "$env" "$CF_CI_TOKEN"
done
unset CF_CI_TOKEN

titre "5. Service token Access « ci-smoke »"
if gh secret list --env production --repo "$REPO" | grep -q '^CF_ACCESS_CLIENT_SECRET'; then
  ok "secrets du service token déjà posés (étape ignorée ; supprimez-les pour en recréer un)"
  CLIENT_ID="(inchangé)"
else
echo "  Il faut un jeton Cloudflare avec Access: Service Tokens Edit (le jeton de configuration donné"
echo "  à Claude convient ; il n'est utilisé que pour cette étape). Claude ajoute ensuite les politiques."
lire_secret CF_ADMIN_TOKEN "jeton Cloudflare d'administration Access"
REPONSE=$(curl -sS -X POST "$CF_API/accounts/$CF_ACCOUNT_ID/access/service_tokens" \
  -H "Authorization: Bearer $CF_ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data '{"name":"ci-smoke","duration":"8760h"}')
champ() { REPONSE="$REPONSE" python3 -c 'import json,os,sys;d=json.loads(os.environ["REPONSE"]);r=d.get("result") or {};print(r.get(sys.argv[1],"") if d.get("success") else "")' "$1"; }
CLIENT_ID=$(champ client_id)
if [ -z "$CLIENT_ID" ]; then
  ko "création refusée : $(REPONSE="$REPONSE" python3 -c 'import json,os;print(json.loads(os.environ["REPONSE"]).get("errors"))')"
  exit 1
fi
CLIENT_SECRET=$(champ client_secret)
unset REPONSE
for env in staging production; do
  poser_secret CF_ACCESS_CLIENT_ID "$env" "$CLIENT_ID"
  poser_secret CF_ACCESS_CLIENT_SECRET "$env" "$CLIENT_SECRET"
done
unset CLIENT_SECRET CF_ADMIN_TOKEN
fi

titre "6. Ruleset sur main"
CHECKS='{"context":"Lint, types, tests unitaires et intégration"},{"context":"Tests navigateur (Playwright + axe)"},{"context":"Scripts de données (seed synchronisé)"},{"context":"Sécurité (dépendances, secrets, configuration)"}'
if [ "$PUBLIC" = true ]; then
  CHECKS="$CHECKS"',{"context":"analyze (javascript-typescript)"},{"context":"analyze (python)"},{"context":"analyze (actions)"}'
fi
if gh api "repos/$REPO/rulesets" --jq '.[].name' | grep -qx "Protection de main"; then
  ok "ruleset déjà présent (non modifié)"
else
  gh api -X POST "repos/$REPO/rulesets" --input - >/dev/null <<EOF
{"name":"Protection de main","target":"branch","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/heads/main"],"exclude":[]}},
 "rules":[
  {"type":"deletion"},{"type":"non_fast_forward"},{"type":"required_linear_history"},
  {"type":"pull_request","parameters":{"required_approving_review_count":0,"dismiss_stale_reviews_on_push":true,
    "require_code_owner_review":false,"require_last_push_approval":false,"required_review_thread_resolution":true,
    "allowed_merge_methods":["squash","rebase"]}},
  {"type":"required_status_checks","parameters":{"strict_required_status_checks_policy":true,
    "do_not_enforce_on_create":false,"required_status_checks":[$CHECKS]}}
 ]}
EOF
  ok "ruleset « Protection de main » créé"
fi

titre "Terminé. À transmettre à Claude (rien de secret) :"
echo "  Visibilité : $([ "$PUBLIC" = true ] && echo publique || echo privée)"
echo "  CI_SERVICE_TOKEN_ID = $CLIENT_ID"
