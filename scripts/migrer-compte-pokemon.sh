#!/usr/bin/env bash
# Bascule des secrets GitHub vers le compte Cloudflare « pokemon » (voir docs/gitops.md).
# À lancer une fois sur votre poste : bash scripts/migrer-compte-pokemon.sh
# Prérequis : gh (admin du dépôt), curl, python3. Environnements, ruleset et réglages de sécurité existent déjà
# (scripts/configurer-github.sh) : ce script ne fait qu'écraser les valeurs propres au compte Cloudflare.
# Aucun secret n'est affiché ni écrit sur disque : saisie masquée, transmis par stdin à `gh secret set`.
set -euo pipefail

REPO="terenceleclercq-veltis/pokemon"
CF_API="https://api.cloudflare.com/client/v4"
URL_STAGING="https://pokedex-kanto-staging.pokedex-terence.workers.dev"
URL_PRODUCTION="https://pokedex-kanto-production.pokedex-terence.workers.dev"

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
ok "gh connecté, admin du dépôt"

titre "1. URL des environnements (workers.dev)"
gh variable set APP_URL --env staging --body "$URL_STAGING" --repo "$REPO" && ok "APP_URL (staging) = $URL_STAGING"
gh variable set APP_URL --env production --body "$URL_PRODUCTION" --repo "$REPO" && ok "APP_URL (production) = $URL_PRODUCTION"

titre "2. Compte Cloudflare « pokemon » pour la CI"
echo "  Jeton CI à créer dans le compte pokemon (Manage Account > Account API Tokens > Create Token > Custom) :"
echo "    Account > Workers Scripts > Edit ; Account > D1 > Edit ; Account > Account Settings > Read"
echo "  (aucune permission Zone : le site est servi sur workers.dev)."
lire_secret CF_ACCOUNT_ID "Account ID du compte pokemon"
read -rsp "  CLOUDFLARE_API_TOKEN (nouveau jeton CI, ou Entrée pour garder l'actuel s'il couvre le compte pokemon) : " CF_CI_TOKEN
echo
for env in staging production; do
  poser_secret CLOUDFLARE_ACCOUNT_ID "$env" "$CF_ACCOUNT_ID"
  if [ -n "$CF_CI_TOKEN" ]; then poser_secret CLOUDFLARE_API_TOKEN "$env" "$CF_CI_TOKEN"; else ok "CLOUDFLARE_API_TOKEN ($env) inchangé"; fi
done
unset CF_CI_TOKEN

titre "3. Service token Access « ci-smoke » dans le compte pokemon"
echo "  Jeton Cloudflare avec Access: Service Tokens Edit sur le compte pokemon (celui donné à Claude convient)."
lire_secret CF_ADMIN_TOKEN "jeton Cloudflare d'administration Access"
REPONSE=$(curl -sS -X POST "$CF_API/accounts/$CF_ACCOUNT_ID/access/service_tokens" \
  -H "Authorization: Bearer $CF_ADMIN_TOKEN" -H "Content-Type: application/json" \
  --data '{"name":"ci-smoke","duration":"8760h"}')
unset CF_ADMIN_TOKEN
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
unset CLIENT_SECRET

titre "Terminé. À transmettre à Claude (rien de secret) :"
echo "  CI_SERVICE_TOKEN_ID = $CLIENT_ID"
