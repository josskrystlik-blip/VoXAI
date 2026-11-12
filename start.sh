#!/usr/bin/env bash
# Script de lancement VoxAI
cd "$(dirname "$0")"
if [ ! -f config.json ]; then
  cp config.example.json config.json
  echo "ℹ️  config.json créé depuis config.example.json"
fi
echo "🎙️ Lancement de VoxAI (Dictaphone Intelligent)..."
exec python3 app.py
