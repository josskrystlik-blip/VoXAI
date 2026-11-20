#!/bin/sh
# En-têtes de sécurité HTTP de VoxAI (inclus par nginx dans chaque réponse).
# VOXAI_CSP_CONNECT_SRC permet de restreindre les serveurs joignables par le navigateur
# (ex. "'self' https://ia.entreprise.fr https://confluence.entreprise.fr").
set -eu
mkdir -p /etc/nginx/voxai
CONNECT="${VOXAI_CSP_CONNECT_SRC:-'self' https: http:}"
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
add_header Permissions-Policy "microphone=(self), camera=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
CONF
echo "VoxAI : en-têtes de sécurité générés"
