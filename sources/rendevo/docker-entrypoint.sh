#!/bin/sh
# Prépare les dossiers persistants puis lance Rendevo avec l'utilisateur "node".
set -e
DATA_DIR="${DATA_DIR:-/data}"
mkdir -p "$DATA_DIR/config" "$DATA_DIR/uploads"
if [ "$(id -u)" = "0" ]; then
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  exec su-exec node "$@"
fi
exec "$@"
