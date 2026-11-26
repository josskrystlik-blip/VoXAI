#!/bin/sh
# En-têtes de sécurité HTTP de VoxAI (inclus par nginx dans chaque réponse).
# VOXAI_CSP_CONNECT_SRC permet de restreindre les serveurs joignables par le navigateur
# (ex. "'self' https://ia.entreprise.fr https://confluence.entreprise.fr").
set -eu
mkdir -p /etc/nginx/voxai
origin_of() { # origin_of <url> : « https://hote:port », vide si l'URL n'est pas http(s)
  printf '%s' "$1" | sed -nE 's#^(https?://[A-Za-z0-9.:-]+).*#\1#p'
}

case "$(echo "${VOXAI_DISABLE_CLOUD:-false}" | tr 'A-Z' 'a-z')" in
  1|true|yes|oui) DISABLE_CLOUD=true ;;
  *) DISABLE_CLOUD=false ;;
esac

if [ -n "${VOXAI_CSP_CONNECT_SRC:-}" ]; then
  CONNECT="$VOXAI_CSP_CONNECT_SRC"
elif [ "$DISABLE_CLOUD" = true ] && [ -n "${VOXAI_LLM_URL:-}" ]; then
  # Mode 100 % interne : le navigateur ne peut joindre que l'application et les serveurs
  # déclarés (LLM, Whisper, Confluence). Même un réglage erroné ne peut pas atteindre Google.
  CONNECT="'self'"
  for u in "${VOXAI_LLM_URL:-}" "${VOXAI_STT_URL:-}" "${VOXAI_CONFLUENCE_URL:-}"; do
    o="$(origin_of "$u")"
    [ -n "$o" ] && case " $CONNECT " in *" $o "*) ;; *) CONNECT="$CONNECT $o" ;; esac
  done
  echo "VoxAI : mode 100 % interne, connexions limitées à : $CONNECT"
else
  CONNECT="'self' https: http:"
  [ "$DISABLE_CLOUD" = true ] && echo "VoxAI : VOXAI_DISABLE_CLOUD sans VOXAI_LLM_URL — connexions non restreintes (définissez VOXAI_CSP_CONNECT_SRC)" >&2
fi
if ! printf '%s' "$CONNECT" | grep -Eq "^[A-Za-z0-9 :/.*'_-]+$"; then
  echo "VoxAI : VOXAI_CSP_CONNECT_SRC contient des caractères non autorisés" >&2
  exit 1
fi
CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self'; connect-src $CONNECT; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
cat > /etc/nginx/voxai/security.conf <<CONF
add_header Content-Security-Policy "$CSP" always;
add_header X-Frame-Options "DENY" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header Permissions-Policy "microphone=(self), display-capture=(self), camera=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
CONF
echo "VoxAI : en-têtes de sécurité générés"
