# Zammad (sans Elasticsearch)

Zammad est une plateforme de support client et de gestion de tickets open source. La configuration des conteneurs est explicite (sans ancres YAML) pour satisfaire la validation du Compose par Runtipi. Cette version allégée pour Runtipi comprend PostgreSQL, Redis, Memcached, Rails, WebSocket, Nginx et les sauvegardes quotidiennes, **sans Elasticsearch**.

## Accès via Cloudflare Tunnel (sans Traefik)

- Renseigner le domaine public dans `ZAMMAD_DOMAIN` (par exemple `tickets.exemple.fr`, sans `https://`).
- Dans Cloudflare Zero Trust, créer un *Public Hostname* avec le service HTTP `http://127.0.0.1:8285`.
- `cloudflared` doit s'exécuter sur le même serveur, directement sur l'hôte ou dans un conteneur en `network_mode: host`.
- Ne pas activer l'exposition de domaine de Runtipi. Le port 8285 est lié à `127.0.0.1` et évite le port 8284 de Chatwoot.
- Aucun port PostgreSQL, Redis ou Memcached n'est publié.

## Fonctionnalités et ressources

- Désactivation explicite avec `ELASTICSEARCH_ENABLED=false` pour tous les conteneurs Zammad, notamment `zammad-init`.
- **Limitation :** la recherche plein texte et les fonctionnalités de recherche/rapports nécessitant l'index Elasticsearch peuvent être limitées ou indisponibles.
- Plus besoin du réglage système `vm.max_map_count` requis par Elasticsearch.
- Prévoir les ressources nécessaires au serveur Rails, PostgreSQL, Redis et Memcached ; sans Elasticsearch, l'utilisation mémoire est inférieure à la version complète.

## Mise à jour depuis la version avec Elasticsearch

1. Effectuer une sauvegarde de PostgreSQL et du répertoire de stockage Zammad.
2. Actualiser l'App Store Runtipi, puis mettre à jour Zammad (version du catalogue `tipi_version: 4`).
3. Vérifier que Zammad démarre et que le tunnel répond.
4. Si un ancien conteneur Elasticsearch demeure **orphelin**, le supprimer uniquement après identification. **Ne supprimer aucun volume de données sans sauvegarde et vérification.**

En cas de nouvelle installation, installer directement cette version. Ne jamais supprimer `runtipi-db` ni les volumes PostgreSQL de Zammad pendant une mise à jour.

**Note de sécurité :** le compte PostgreSQL applicatif de cette configuration simplifiée est également le compte initial du serveur PostgreSQL. Pour renforcer les privilèges en production, utiliser le rôle applicatif non privilégié de la configuration officielle.

Documentation : https://github.com/zammad/zammad-docker-compose — https://runtipi.io/docs/reference/dynamic-compose
