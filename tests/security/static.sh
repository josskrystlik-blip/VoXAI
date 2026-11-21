#!/usr/bin/env bash
# VoxAI — contrôles de sécurité statiques (sans navigateur ni Docker).
# Lancement : bash tests/security/static.sh
set -uo pipefail
cd "$(dirname "$0")/../.."
PASS=0; FAIL=0
ok() { echo "  ✓ $1"; PASS=$((PASS + 1)); }
ko() { echo "  ✗ $1"; [ -n "${2:-}" ] && echo "$2" | sed 's/^/      /'; FAIL=$((FAIL + 1)); }
APP="app.js db.js confluence.js live.js theme-init.js series.js onboarding.js"

echo "Contrôles de sécurité statiques VoxAI"

out="$(grep -nE '\beval\s*\(|new Function\s*\(|document\.write|insertAdjacentHTML|\.outerHTML\s*=' $APP)"
[ -z "$out" ] && ok "Aucune fonction dangereuse (eval, new Function, document.write, insertAdjacentHTML)" || ko "Fonction dangereuse utilisée" "$out"

out="$(grep -nE 'setTimeout\s*\(\s*["'"'"'`]|setInterval\s*\(\s*["'"'"'`]' $APP)"
[ -z "$out" ] && ok "Aucun minuteur avec du code en chaîne" || ko "Minuteur avec code en chaîne" "$out"

grep -q '<meta http-equiv="Content-Security-Policy"' index.html && ok "CSP déclarée dans la page" || ko "CSP absente de index.html"
csp="$(grep -o 'Content-Security-Policy" content="[^"]*"' index.html)"
grep -q "script-src 'self';" <<<"$csp" && ! grep -qE "unsafe-eval" <<<"$csp" && ok "CSP : script-src 'self', sans unsafe-eval" || ko "CSP trop permissive" "$csp"

out="$(grep -nE '<script(\s[^>]*)?>' index.html | grep -v ' src=')"
[ -z "$out" ] && ok "Aucun script en ligne dans la page" || ko "Script en ligne (bloqué par la CSP)" "$out"

out="$(grep -noE '\son[a-z]+\s*=' index.html)"
[ -z "$out" ] && ok "Aucun gestionnaire d'événement en ligne (onclick=…)" || ko "Gestionnaire en ligne" "$out"

out="$(grep -nE '(src|href)="https?://' index.html | grep -v 'aistudio.google.com')"
[ -z "$out" ] && ok "Aucune ressource externe chargée par la page" || ko "Ressource externe" "$out"

out="$(grep -n 'target="_blank"' index.html $APP | grep -v 'noopener')"
[ -z "$out" ] && ok "Liens vers d'autres onglets protégés (rel=noopener)" || ko "target=_blank sans noopener" "$out"

out="$(git ls-files -z | xargs -0 grep -nIE 'AIza[0-9A-Za-z_-]{35}|AQ\.[0-9A-Za-z_-]{30,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[0-9A-Za-z]{36}|xox[baprs]-[0-9A-Za-z-]{10,}' -- 2>/dev/null | grep -v '^tests/security/')"
[ -z "$out" ] && ok "Aucun secret (clé Google, jeton GitHub/Slack, clé privée) dans les fichiers suivis" || ko "Secret potentiel dans le dépôt" "$out"

git ls-files --error-unmatch config.json dictaphone.db >/dev/null 2>&1 && ko "config.json ou dictaphone.db suivis par git" || ok "Fichiers de données locales non suivis par git"

if command -v npm >/dev/null && [ -f package-lock.json ]; then
  if npm audit --audit-level=high >/tmp/voxai-audit.txt 2>&1; then ok "npm audit : aucune vulnérabilité haute ou critique"; else ko "npm audit : vulnérabilités" "$(tail -15 /tmp/voxai-audit.txt)"; fi
fi

echo
echo "$PASS réussi(s), $FAIL échec(s)"
[ "$FAIL" -eq 0 ]
