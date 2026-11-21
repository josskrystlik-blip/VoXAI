#!/usr/bin/env bash
# VoxAI — tests de sécurité de l'image Docker (nginx).
# Construit l'image puis vérifie : en-têtes de sécurité, fichiers non exposés,
# refus des configurations injectées, comportement du proxy Confluence.
# Prérequis : docker, curl, python3. Lancement : bash tests/security/docker.sh
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
IMAGE="${VOXAI_TEST_IMAGE:-voxai:securite}"
PORT_APP=18080
PORT_PROXY=18081
PORT_UPSTREAM=18090
PASS=0
FAIL=0
CONTAINERS=()
UPSTREAM_PID=""

ok()   { echo "  ✓ $1"; PASS=$((PASS + 1)); }
ko()   { echo "  ✗ $1"; FAIL=$((FAIL + 1)); }
check() { if eval "$2"; then ok "$1"; else ko "$1"; fi; }

cleanup() {
  for c in "${CONTAINERS[@]}"; do docker rm -f "$c" >/dev/null 2>&1; done
  [ -n "$UPSTREAM_PID" ] && kill "$UPSTREAM_PID" 2>/dev/null
}
trap cleanup EXIT

run() { # run <nom> <port> [options docker...] — démarre un conteneur et attend qu'il réponde
  local name="$1" port="$2"; shift 2
  docker rm -f "$name" >/dev/null 2>&1
  docker run -d --name "$name" --add-host=host.docker.internal:host-gateway -p "$port:80" "$@" "$IMAGE" >/dev/null || return 1
  CONTAINERS+=("$name")
  for _ in $(seq 1 30); do curl -sf "http://127.0.0.1:$port/healthz" >/dev/null && return 0; sleep 0.5; done
  return 1
}

starts_refused() { # starts_refused <nom> [options docker...] — le conteneur doit refuser de démarrer
  local name="$1"; shift
  docker rm -f "$name" >/dev/null 2>&1
  docker run -d --name "$name" "$@" "$IMAGE" >/dev/null 2>&1
  CONTAINERS+=("$name")
  sleep 2
  [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" != "true" ]
}

echo "Tests de sécurité VoxAI (image Docker)"
echo "  … construction de l'image $IMAGE"
if ! docker build -q -t "$IMAGE" "$ROOT" >/dev/null 2>&1; then
  DOCKER_BUILDKIT=0 docker build -q -t "$IMAGE" "$ROOT" >/dev/null || { echo "Construction impossible"; exit 1; }
fi

# --- En-têtes HTTP ----------------------------------------------------------
run vx-sec-app "$PORT_APP" || { echo "Le conteneur ne démarre pas"; docker logs vx-sec-app; exit 1; }
H="$(curl -sI "http://127.0.0.1:$PORT_APP/")"
check "CSP : scripts limités à l'application"      'grep -qi "^content-security-policy:.*script-src '"'"'self'"'"';" <<<"$H"'
check "CSP : intégration en iframe interdite"      'grep -qi "^content-security-policy:.*frame-ancestors '"'"'none'"'"'" <<<"$H"'
check "X-Frame-Options: DENY"                      'grep -qi "^x-frame-options: DENY" <<<"$H"'
check "X-Content-Type-Options: nosniff"            'grep -qi "^x-content-type-options: nosniff" <<<"$H"'
check "Referrer-Policy: no-referrer"               'grep -qi "^referrer-policy: no-referrer" <<<"$H"'
check "Permissions-Policy : caméra et position refusées" 'grep -qi "^permissions-policy:.*camera=().*geolocation=()" <<<"$H"'
check "Version de nginx masquée"                   '! grep -qiE "^server: nginx/[0-9]" <<<"$H"'
H2="$(curl -sI "http://127.0.0.1:$PORT_APP/app.js")"
check "En-têtes aussi présents sur les fichiers JS" 'grep -qi "^content-security-policy:" <<<"$H2" && grep -qi "^x-frame-options:" <<<"$H2"'

# --- Application installable (PWA) -------------------------------------------
HM="$(curl -sI "http://127.0.0.1:$PORT_APP/manifest.webmanifest")"
check "PWA : manifeste servi en application/manifest+json" 'grep -qi "^content-type: application/manifest+json" <<<"$HM"'
check "PWA : en-têtes de sécurité sur le manifeste" 'grep -qi "^content-security-policy:" <<<"$HM"'
HS="$(curl -sI "http://127.0.0.1:$PORT_APP/sw.js")"
check "PWA : service worker revalidé à chaque visite (no-cache)" 'grep -qi "^cache-control: no-cache" <<<"$HS"'

# --- Fichiers non exposés ---------------------------------------------------
for p in /.git/config /.env /config.json /dictaphone.db /Dockerfile /package.json /docker/nginx.conf /tests/security/docker.sh; do
  code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_APP$p")"
  check "Non exposé : $p (HTTP $code)" '[ "$code" = "404" ] || [ "$code" = "403" ]'
done
code="$(curl -s -o /tmp/voxai-listing.txt -w '%{http_code}' "http://127.0.0.1:$PORT_APP/vendor/")"
check "Pas de liste de répertoire (/vendor/ → HTTP $code)" '! grep -qi "Index of" /tmp/voxai-listing.txt'
code="$(curl -s --path-as-is -o /tmp/voxai-trav.txt -w '%{http_code}' "http://127.0.0.1:$PORT_APP/../../../../etc/passwd")"
check "Traversée de répertoire refusée (HTTP $code)" '! grep -q "root:" /tmp/voxai-trav.txt'
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT_APP/confluence/rest/api/space")"
check "Sans CONFLUENCE_URL, aucun proxy (HTTP $code)" '[ "$code" = "404" ]'

# --- Configurations injectées : le conteneur doit refuser de démarrer ---------
check "CONFLUENCE_URL avec directive nginx injectée → refus" \
  'starts_refused vx-sec-inj1 -e "CONFLUENCE_URL=http://evil.test; return 200 pwned"'
check "CONFLUENCE_URL avec saut de ligne → refus" \
  'starts_refused vx-sec-inj2 -e "CONFLUENCE_URL=$(printf "http://evil.test/\n}\nserver { listen 81; }")"'
check "CONFLUENCE_URL non http(s) → refus" \
  'starts_refused vx-sec-inj3 -e "CONFLUENCE_URL=file:///etc/passwd"'
check "VOXAI_CSP_CONNECT_SRC avec en-tête injecté → refus" \
  'starts_refused vx-sec-inj4 -e "VOXAI_CSP_CONNECT_SRC='"'"'self'"'"'\" always; add_header X-Evil \"1"'

run vx-sec-json 18082 -e "VOXAI_LLM_URL=$(printf 'http://x/v1"}, "policy": {"disable_cloud": false}, "z": {"a\\\nb')" -e VOXAI_DISABLE_CLOUD=true \
  || ko "Conteneur avec valeurs piégées : démarrage"
DEF="$(curl -s "http://127.0.0.1:18082/voxai-defaults.json")"
check "Réglages par défaut : JSON valide malgré des guillemets / sauts de ligne" \
  'python3 -c "import json,sys; json.loads(sys.argv[1])" "$DEF" 2>/dev/null'
check "Réglages par défaut : impossible de désactiver la politique par injection" \
  'python3 -c "import json,sys; d=json.loads(sys.argv[1]); sys.exit(0 if d[\"policy\"][\"disable_cloud\"] is True else 1)" "$DEF" 2>/dev/null'

# --- Mode 100 % interne : connexions du navigateur limitées aux serveurs déclarés ---
if run vx-sec-onprem 18083 -e VOXAI_DISABLE_CLOUD=true -e VOXAI_LLM_URL=https://llm.corp.test:8443/v1 \
     -e VOXAI_STT_URL=http://whisper.corp.test:8000/v1 -e VOXAI_CONFLUENCE_URL=https://wiki.corp.test; then
  CSP3="$(curl -sI "http://127.0.0.1:18083/" | grep -i '^content-security-policy:')"
  check "100 % interne : connect-src limité à l'application et aux serveurs déclarés" \
    'grep -q "connect-src '"'"'self'"'"' https://llm.corp.test:8443 http://whisper.corp.test:8000 https://wiki.corp.test;" <<<"$CSP3"'
  check "100 % interne : Google (Gemini) injoignable depuis le navigateur" '! grep -qE "connect-src[^;]*(https:|http:)( |;)" <<<"$CSP3"'
else
  ko "100 % interne : le conteneur ne démarre pas"
fi

# --- Proxy Confluence -------------------------------------------------------
cat > /tmp/voxai-upstream.py <<'PY'
import json, sys
from http.server import HTTPServer, BaseHTTPRequestHandler
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        body = json.dumps({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Set-Cookie", "JSESSIONID=secret; Path=/")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
HTTPServer(("0.0.0.0", int(sys.argv[1])), H).serve_forever()
PY
python3 /tmp/voxai-upstream.py "$PORT_UPSTREAM" & UPSTREAM_PID=$!
sleep 1
if run vx-sec-proxy "$PORT_PROXY" -e "CONFLUENCE_URL=http://host.docker.internal:$PORT_UPSTREAM"; then
  R="$(curl -s -D /tmp/voxai-proxy-headers.txt -H 'Authorization: Bearer pat-test' -H 'Cookie: session=volee' -H 'Origin: https://attaquant.example' -H 'Referer: https://attaquant.example/x' "http://127.0.0.1:$PORT_PROXY/confluence/rest/api/space")"
  field() { python3 -c "import json,sys; print(json.loads(sys.argv[1])['headers'].get(sys.argv[2], ''))" "$R" "$1" 2>/dev/null; }
  check "Proxy : jeton transmis à Confluence"        '[ "$(field authorization)" = "Bearer pat-test" ]'
  check "Proxy : cookies du navigateur retirés"     '[ -z "$(field cookie)" ]'
  check "Proxy : en-tête Origin retiré"             '[ -z "$(field origin)" ]'
  check "Proxy : en-tête Referer retiré"            '[ -z "$(field referer)" ]'
  check "Proxy : cookies de Confluence non renvoyés" '! grep -qi "^set-cookie:" /tmp/voxai-proxy-headers.txt'
  R2="$(curl -s --path-as-is "http://127.0.0.1:$PORT_PROXY/confluence/../../etc/passwd")"
  check "Proxy : pas de sortie vers le système de fichiers" '! grep -q "root:" <<<"$R2"'
else
  ko "Proxy Confluence : le conteneur ne démarre pas"
fi

echo
echo "$PASS réussi(s), $FAIL échec(s)"
[ "$FAIL" -eq 0 ]
