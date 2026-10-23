# Emballe l'extension depuis les mêmes fichiers que la version publiée.
# L'archive est servie par l'instance Rendevo (pas par des artefacts GitHub expirables).
FROM alpine:3.21 AS companion-package
RUN apk add --no-cache zip
COPY extension /extension
RUN cd /extension && zip -q -j /Rendevo-Companion.zip manifest.json popup.html popup.js popup.css README.md

# Rendevo - image de production
# Aucune dépendance npm à l'exécution : serveur Node.js natif + interface déjà compilée (web/dist).
FROM node:22-alpine

ARG APP_VERSION=0.2.11
LABEL org.opencontainers.image.title="Rendevo" \
      org.opencontainers.image.description="Agent IA de prospection LinkedIn auto-hébergé" \
      org.opencontainers.image.source="https://github.com/Ajilis/runtipi-appstore" \
      org.opencontainers.image.version="${APP_VERSION}"

RUN apk add --no-cache su-exec tzdata

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=3000 \
    DATA_DIR=/data \
    TZ=Europe/Paris

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web/dist ./web/dist
COPY --from=companion-package /Rendevo-Companion.zip ./web/dist/Rendevo-Companion.zip
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data/config /data/uploads && chown -R node:node /data

EXPOSE 3000
VOLUME ["/data/config", "/data/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
