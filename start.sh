#!/usr/bin/env bash
# Lance VoxAI en local (sans GitHub Pages) : simple serveur de fichiers statiques.
# Les données restent dans la base locale du navigateur (IndexedDB).
cd "$(dirname "$0")"
PORT="${PORT:-8080}"
echo "🎙️ VoxAI disponible sur http://localhost:$PORT"
exec python3 -m http.server "$PORT"
