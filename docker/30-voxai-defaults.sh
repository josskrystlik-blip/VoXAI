#!/bin/sh
# Réglages par défaut de VoxAI, définis par l'administrateur via des variables
# d'environnement et servis sur /voxai-defaults.json. Les utilisateurs n'ont rien
# à configurer ; ce qu'ils modifient eux-mêmes reste prioritaire, sauf la
# politique VOXAI_DISABLE_CLOUD qui s'impose toujours.
set -eu
mkdir -p /etc/nginx/voxai
OUT=/etc/nginx/voxai/defaults.json

json_str() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/\\t/g' | tr -d '\r\n'
}

FIELDS=""
add() { # add <clé json> <valeur>
  [ -n "$2" ] || return 0
  FIELDS="$FIELDS${FIELDS:+,}\"$1\":\"$(json_str "$2")\""
}

add provider          "${VOXAI_PROVIDER:-}"
add local_llm_url     "${VOXAI_LLM_URL:-}"
add on_prem_llm_url   "${VOXAI_LLM_URL:-}"
add local_llm_model   "${VOXAI_LLM_MODEL:-}"
add on_prem_llm_model "${VOXAI_LLM_MODEL:-}"
add local_llm_api_key "${VOXAI_LLM_API_KEY:-}"
add local_stt_mode    "${VOXAI_STT_MODE:-}"
add on_prem_stt_url   "${VOXAI_STT_URL:-}"
add on_prem_stt_model "${VOXAI_STT_MODEL:-}"
add on_prem_stt_api_key "${VOXAI_STT_API_KEY:-}"
add language_hint     "${VOXAI_LANGUAGE:-}"
add confluence_url    "${VOXAI_CONFLUENCE_URL:-}"

case "$(echo "${VOXAI_DISABLE_CLOUD:-false}" | tr 'A-Z' 'a-z')" in
  1|true|yes|oui) DISABLE=true ;;
  *) DISABLE=false ;;
esac

printf '{"config":{%s},"policy":{"disable_cloud":%s}}\n' "$FIELDS" "$DISABLE" > "$OUT"
cat > /etc/nginx/voxai/defaults.locations <<'CONF'
location = /voxai-defaults.json {
    alias /etc/nginx/voxai/defaults.json;
    default_type application/json;
    add_header Cache-Control "no-store";
}
CONF
echo "VoxAI : réglages par défaut générés (cloud désactivé : $DISABLE)"
