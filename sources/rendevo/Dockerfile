# Rendevo - image de production
# Aucune dépendance npm à l'exécution : serveur Node.js natif + interface déjà compilée (web/dist).
FROM node:22-alpine

ARG APP_VERSION=0.1.3
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
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data/config /data/uploads && chown -R node:node /data

EXPOSE 3000
VOLUME ["/data/config", "/data/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health > /dev/null || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
