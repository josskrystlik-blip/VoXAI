# VoxAI — image Docker : serveur web statique (nginx), aucune donnée stockée côté serveur.
# Toutes les données restent dans la base locale (IndexedDB) du navigateur de l'utilisateur.
FROM nginx:1.27-alpine

LABEL org.opencontainers.image.title="VoxAI" \
      org.opencontainers.image.description="Dictaphone intelligent 100 % local (IndexedDB) avec IA Gemini ou LLM local" \
      org.opencontainers.image.licenses="AGPL-3.0" \
      org.opencontainers.image.source="https://github.com/josskrystlik-blip/VoXAI"

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/40-voxai-confluence.sh /docker-entrypoint.d/40-voxai-confluence.sh
COPY index.html app.js db.js confluence.js live.js style.css /usr/share/nginx/html/

# Facultatif : URL de Confluence à relayer sur /confluence/ (évite les blocages CORS)
ENV CONFLUENCE_URL=""

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz >/dev/null || exit 1
