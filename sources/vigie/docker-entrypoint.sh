#!/bin/sh
# Prépare les dossiers persistants (configuration, base, sauvegardes) puis lance Vigie avec l'utilisateur « node ».
set -e
umask 077
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/config" "$DATA_DIR/db" "$DATA_DIR/backups"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
