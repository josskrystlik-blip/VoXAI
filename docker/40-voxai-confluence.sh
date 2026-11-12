#!/bin/sh
# Proxy Confluence facultatif : si CONFLUENCE_URL est défini, /confluence/ est relayé vers
# cette instance. Le navigateur appelle alors Confluence via la même origine que VoxAI,
# ce qui évite toute configuration CORS côté Confluence. Aucune donnée n'est conservée.
set -eu
mkdir -p /etc/nginx/voxai
OUT=/etc/nginx/voxai/confluence.locations

if [ -n "${CONFLUENCE_URL:-}" ]; then
  TARGET="${CONFLUENCE_URL%/}"
  case "$TARGET" in
    http://*|https://*) ;;
    *) echo "VoxAI : CONFLUENCE_URL doit commencer par http:// ou https://" >&2; exit 1 ;;
  esac
  UPSTREAM_HOST=$(echo "$TARGET" | sed -E 's#^https?://([^/:]+).*#\1#')
  cat > "$OUT" <<CONF
location = /confluence-proxy.json {
    default_type application/json;
    add_header Cache-Control "no-store";
    return 200 '{"enabled":true}';
}
location /confluence/ {
    proxy_pass $TARGET/;
    proxy_http_version 1.1;
    proxy_set_header Host $UPSTREAM_HOST;
    # Confluence ne doit voir ni l'origine du navigateur (contrôle XSRF) ni ses cookies
    proxy_set_header Origin "";
    proxy_set_header Referer "";
    proxy_set_header Cookie "";
    proxy_hide_header Set-Cookie;
    proxy_ssl_server_name on;
    proxy_ssl_name $UPSTREAM_HOST;
    proxy_read_timeout 120s;
    client_max_body_size 20m;
}
CONF
  echo "VoxAI : proxy Confluence actif vers $TARGET"
else
  cat > "$OUT" <<'CONF'
location = /confluence-proxy.json {
    default_type application/json;
    add_header Cache-Control "no-store";
    return 200 '{"enabled":false}';
}
CONF
fi
