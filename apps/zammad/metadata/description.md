# Zammad

Zammad est un logiciel libre de support client et de gestion de tickets. L'installation Runtipi fournit PostgreSQL, Redis, Memcached, Elasticsearch, Rails, WebSocket, Nginx et les sauvegardes quotidiennes.

## Configuration Cloudflare Tunnel (sans Traefik)

- Domaine : saisir **ZAMMAD_DOMAIN** (par exemple `tickets.exemple.fr`, sans `https://`).
- Dans Cloudflare Zero Trust, configurer le nom d'hôte public vers le service **HTTP** `http://127.0.0.1:8285`.
- Le service `cloudflared` doit être installé sur le serveur Runtipi, directement sur l'hôte ou dans un conteneur utilisant `network_mode: host`.
- Ne pas activer l'exposition de domaine Runtipi.
- Aucun port PostgreSQL, Redis ou Elasticsearch n'est publié.
- Le port **8285** évite un conflit avec Chatwoot (8284) déjà présent dans ce store.

## Prérequis

- Runtipi 4.5 ou plus récent, Docker Compose récent et processeur amd64/arm64.
- Mémoire recommandée pour l'ensemble de l'hôte : au moins 6 à 8 Go.
- Sur l'hôte Docker, configurer `vm.max_map_count=262144` pour Elasticsearch.
- Mettre en place des sauvegardes externes du stockage et de la base de données ; tester la restauration.

Le port hôte est limité à `127.0.0.1` et le chiffrement HTTPS est terminé à Cloudflare. Si le tunnel fonctionne dans un autre conteneur sur un réseau Docker isolé, la route `127.0.0.1` ne fonctionnera pas : adapter la configuration réseau, sans publier le service sur toutes les interfaces.

**Sécurité :** le rôle PostgreSQL initial dispose de privilèges administrateur dans son conteneur. Pour une production durcie, utiliser un rôle applicatif non privilégié comme dans le Compose officiel Zammad.

Sources : https://github.com/zammad/zammad-docker-compose — https://runtipi.io/docs/reference/dynamic-compose
