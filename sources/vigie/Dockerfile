# Vigie Patrimoine : image de production.
# Aucune dépendance npm : serveur Node.js natif (http, crypto) et base SQLite intégrée à Node (node:sqlite).
FROM node:24-alpine

ARG APP_VERSION=0.5.0
LABEL org.opencontainers.image.title="Vigie Patrimoine" \
      org.opencontainers.image.description="Vue globale et privée de votre patrimoine, auto-hébergée" \
      org.opencontainers.image.source="https://github.com/Ajilis/runtipi-appstore" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${APP_VERSION}"

RUN apk add --no-cache su-exec tzdata

ENV NODE_ENV=production \
    APP_VERSION=${APP_VERSION} \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Europe/Paris

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
 && mkdir -p /data/config /data/db /data/backups \
 && chown -R node:node /data

EXPOSE 8080
# Pas de VOLUME : le Compose Runtipi monte data/config, data/db et data/backups (un montage de /data entier fonctionne aussi).

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/api/health > /dev/null || exit 1

STOPSIGNAL SIGTERM
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
