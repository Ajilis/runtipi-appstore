# Zammad (sans Elasticsearch)

Zammad est une plateforme de support client et de gestion de tickets open source. La configuration des conteneurs est explicite (sans ancres YAML) pour satisfaire la validation du Compose par Runtipi. Cette version allégée pour Runtipi comprend PostgreSQL, Redis, Memcached, Rails, WebSocket, Nginx et les sauvegardes quotidiennes, **sans Elasticsearch**.

## Accès via Cloudflare Tunnel (sans Traefik)

- Renseigner le domaine public dans `ZAMMAD_DOMAIN` (par exemple `tickets.exemple.fr`, sans `https://`).
- Dans Cloudflare Zero Trust, créer un *Public Hostname* avec le service HTTP `http://127.0.0.1:8285`.
- `cloudflared` doit s'exécuter sur le même serveur, directement sur l'hôte ou dans un conteneur en `network_mode: host`.
- Ne pas activer l'exposition de domaine de Runtipi. Le port 8285 est lié à `127.0.0.1` et évite le port 8284 de Chatwoot. Zammad ne déclare pas `is_main`, afin d'éviter le mappage de port et les routes Traefik automatiques.
- Aucun port PostgreSQL, Redis ou Memcached n'est publié.

## Fonctionnalités et ressources

- Désactivation explicite avec `ELASTICSEARCH_ENABLED=false` pour tous les conteneurs Zammad, notamment `zammad-init`.
- **Limitation :** la recherche plein texte et les fonctionnalités de recherche/rapports nécessitant l'index Elasticsearch peuvent être limitées ou indisponibles.
- Plus besoin du réglage système `vm.max_map_count` requis par Elasticsearch.
- Prévoir les ressources nécessaires au serveur Rails, PostgreSQL, Redis et Memcached ; sans Elasticsearch, l'utilisation mémoire est inférieure à la version complète.

## Mise à jour depuis la version avec Elasticsearch

1. Effectuer une sauvegarde de PostgreSQL et du répertoire de stockage Zammad.
2. Actualiser l'App Store Runtipi, puis mettre à jour Zammad (version du catalogue `tipi_version: 6`).
3. Vérifier que Zammad démarre et que le tunnel répond.
4. Si un ancien conteneur Elasticsearch demeure **orphelin**, le supprimer uniquement après identification. **Ne supprimer aucun volume de données sans sauvegarde et vérification.**

En cas de nouvelle installation, installer directement cette version. Ne jamais supprimer `runtipi-db` ni les volumes PostgreSQL de Zammad pendant une mise à jour.

**Note de sécurité :** le compte PostgreSQL applicatif de cette configuration simplifiée est également le compte initial du serveur PostgreSQL. Pour renforcer les privilèges en production, utiliser le rôle applicatif non privilégié de la configuration officielle.

Documentation : https://github.com/zammad/zammad-docker-compose — https://runtipi.io/docs/reference/dynamic-compose

## Première installation et mise à jour (catalogue v6)

- Au démarrage, **zammad-init** contrôle la base PostgreSQL Zammad. Sur une base neuve, il laisse les migrations et les données initiales de Zammad se créer normalement.
- Si une **installation inachevée** contient déjà le paramètre `6005_postmaster_filter_identify_group`, mais **aucun utilisateur et aucun ticket**, le service effectue d'abord une **sauvegarde PostgreSQL `pg_dump`** dans `data/backup/recovery-incomplete-init-*.dump`, puis réinitialise **uniquement le schéma de la base Zammad** pour relancer une initialisation propre.
- Dès qu'il existe des utilisateurs ou des tickets, **aucune réinitialisation du schéma n'est autorisée**. Le garde laisse intactes les données de l'application.
- Le script n'est pas un mécanisme général de nettoyage Docker : il ne touche ni aux autres applications Runtipi, ni à leurs bases et volumes. Les sauvegardes de récupération restent sur le disque ; les archiver ou supprimer ultérieurement est une décision de l'administrateur.
- Runtipi conserve les montages persistants `data/postgresql`, `data/storage`, `data/redis` et `data/backup` pendant les mises à jour. Une mise à jour Zammad peut **exécuter des migrations SQL nécessaires**, mais ne doit ni effacer ni recréer la base de production. Faire une sauvegarde avant toute mise à jour.
- Le service `zammad-init` reste actif une fois initialisé (état `healthy`), pour que Runtipi le compte comme un conteneur démarré. Rails, scheduler, websocket et sauvegarde attendent son état `healthy` avant de démarrer.
- Lors de la première installation, prévoir un délai de tâche Runtipi suffisant (par exemple 15 minutes), suivant la machine.

**Attention :** si PostgreSQL contient des données réelles, le mécanisme de récupération est désactivé automatiquement. Il ne garantit pas la réparation de tous les scénarios d'échec ; les erreurs différentes de ce cas exigent un diagnostic.
