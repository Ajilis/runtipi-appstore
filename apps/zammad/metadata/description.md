# Zammad (sans Elasticsearch)

Zammad est une plateforme de support client et de gestion de tickets open source. La configuration des conteneurs est explicite (sans ancres YAML) pour satisfaire la validation du Compose par Runtipi. Cette version allégée pour Runtipi comprend PostgreSQL, Redis, Memcached, Rails, WebSocket, Nginx et les sauvegardes quotidiennes, **sans Elasticsearch**.

## Accès via le réseau local et Cloudflare Tunnel (sans Traefik)

- Renseigner le domaine public dans `ZAMMAD_DOMAIN` (par exemple `tickets.exemple.fr`, sans `https://`).
- Sur le réseau local, le port TCP **8285** est publié sur les interfaces du serveur (par exemple `http://192.168.1.16:8285/`). Cela permet un diagnostic HTTP local ; l'interface Zammad peut imposer des redirections et sessions sur le domaine HTTPS configuré, qui reste l'adresse recommandée.
- Dans Cloudflare Zero Trust, créer un *Public Hostname* avec le service HTTP `http://127.0.0.1:8285` si cloudflared tourne en réseau hôte sur ce serveur.
- `cloudflared` doit s'exécuter sur le même serveur, directement sur l'hôte ou dans un conteneur en `network_mode: host`.
- Ne pas activer l'exposition de domaine de Runtipi. Le port **8285/tcp** est publié sur l'hôte et évite le port 8284 de Chatwoot. Zammad ne déclare pas `is_main`, afin d'éviter le mappage de port et les routes Traefik automatiques. **Limiter ce port au LAN dans le pare-feu et ne pas le rediriger sur la box Internet.**
- Aucun port PostgreSQL, Redis ou Memcached n'est publié.

## Fonctionnalités et ressources

- Désactivation explicite avec `ELASTICSEARCH_ENABLED=false` pour tous les conteneurs Zammad, notamment `zammad-init`.
- **Limitation :** la recherche plein texte et les fonctionnalités de recherche/rapports nécessitant l'index Elasticsearch peuvent être limitées ou indisponibles.
- Plus besoin du réglage système `vm.max_map_count` requis par Elasticsearch.
- Prévoir les ressources nécessaires au serveur Rails, PostgreSQL, Redis et Memcached ; sans Elasticsearch, l'utilisation mémoire est inférieure à la version complète.

## Mise à jour depuis la version avec Elasticsearch

1. Effectuer une sauvegarde de PostgreSQL et du répertoire de stockage Zammad.
2. Actualiser l'App Store Runtipi, puis mettre à jour Zammad (version du catalogue `tipi_version: 8`).
3. Vérifier que Zammad démarre et que le tunnel répond.
4. Si un ancien conteneur Elasticsearch demeure **orphelin**, le supprimer uniquement après identification. **Ne supprimer aucun volume de données sans sauvegarde et vérification.**

En cas de nouvelle installation, installer directement cette version. Ne jamais supprimer `runtipi-db` ni les volumes PostgreSQL de Zammad pendant une mise à jour.

**Note de sécurité :** le compte PostgreSQL applicatif de cette configuration simplifiée est également le compte initial du serveur PostgreSQL. Pour renforcer les privilèges en production, utiliser le rôle applicatif non privilégié de la configuration officielle.

Documentation : https://github.com/zammad/zammad-docker-compose — https://runtipi.io/docs/reference/dynamic-compose

## Première installation et mise à jour (catalogue v8)

- Au démarrage, **zammad-init** contrôle la base PostgreSQL Zammad. Sur une base neuve, il laisse les migrations et les données initiales de Zammad se créer normalement.
- Si une **installation inachevée** contient déjà le paramètre `6005_postmaster_filter_identify_group`, mais **aucun utilisateur et aucun ticket**, le service effectue d'abord une **sauvegarde PostgreSQL `pg_dump`** dans `data/backup/recovery-incomplete-init-*.dump`, puis réinitialise **uniquement le schéma de la base Zammad** pour relancer une initialisation propre.
- Dès qu'il existe des utilisateurs ou des tickets, **aucune réinitialisation du schéma n'est autorisée**. Le garde laisse intactes les données de l'application.
- Le script n'est pas un mécanisme général de nettoyage Docker : il ne touche ni aux autres applications Runtipi, ni à leurs bases et volumes. Les sauvegardes de récupération restent sur le disque ; les archiver ou supprimer ultérieurement est une décision de l'administrateur.
- Runtipi conserve les montages persistants `data/postgresql`, `data/storage`, `data/redis` et `data/backup` pendant les mises à jour. Une mise à jour Zammad peut **exécuter des migrations SQL nécessaires**, mais ne doit ni effacer ni recréer la base de production. Faire une sauvegarde avant toute mise à jour.
- Le service `zammad-init` reste actif une fois initialisé (état `healthy`), pour que Runtipi le compte comme un conteneur démarré. Rails, scheduler, websocket et sauvegarde attendent son état `healthy` avant de démarrer.
- Lors de la première installation, prévoir un délai de tâche Runtipi suffisant (par exemple 15 minutes), suivant la machine.

**Attention :** si PostgreSQL contient des données réelles, le mécanisme de récupération est désactivé automatiquement. Il ne garantit pas la réparation de tous les scénarios d'échec ; les erreurs différentes de ce cas exigent un diagnostic.

## Éditeur de ports Runtipi et diagnostic

- La version 7 utilise un port TCP explicite et stable, `8285:8080/tcp` : hôte **8285**, conteneur **8080**, TCP uniquement, interface par défaut. Cela évite les erreurs de lecture de la syntaxe `${APP_PORT:-8285}` dans l'éditeur visuel.
- `dynamic_config` est désactivé pour éviter qu'un changement de port dans le formulaire diverge du mappage réellement publié.
- Un test `curl -I http://127.0.0.1:8285/` ou `curl -I http://192.168.1.16:8285/` ne fonctionnera qu'après démarrage effectif de `zammad-nginx` ; tester également le domaine HTTPS Cloudflare configuré.
- L'accès à l'interface peut rediriger vers le domaine HTTPS canonique. Pour un usage interactif fiable sur le LAN, utiliser ce domaine HTTPS (éventuellement avec DNS local adapté) plutôt que l'adresse IP HTTP.

## Migration depuis un Zammad Debian / Ubuntu

La version 8 accepte la **restauration complète par les deux archives officielles** du Zammad paquet : `<date>_zammad_db.psql.gz` et `<date>_zammad_files.tar.gz`. Elle ne récupère pas automatiquement des données d'un autre serveur et ne restaure **rien** tant que les archives n'ont pas été déposées volontairement dans `data/backup/restore/`.

- Le conteneur `zammad-backup` peut maintenant restaurer le contenu de la base **avant** `zammad-init`. Il attend PostgreSQL, Redis et Memcached, mais pas la fin de l'initialisation Rails.
- Si `data/backup/restore/` contient des fichiers, `zammad-init` attend que le service de restauration archive ce dossier après réussite. Cela protège la base contre une initialisation ou un seed concurrents.
- Rails, scheduler, websocket et Nginx démarrent ensuite dans l'ordre usuel. Sur les mises à jour sans dossier `restore`, les données existantes sont préservées et les migrations officielles se déroulent normalement.
- **Destructif sur la destination :** la restauration officielle remplace le schéma PostgreSQL actuel, et l'extraction des fichiers remplace ou ajoute des pièces jointes. Sauvegarder la destination avant l'import ; ne jamais placer des archives dans `restore` par inadvertance.
- Utiliser de préférence la **même version Zammad** sur source et destination. Ne jamais restaurer une base créée par une version plus récente dans un Zammad plus ancien. Vérifier les chemins de stockage externalisé, les intégrations, les connexions e-mail et les paramètres de domaine après migration.

Procédure complète : [Migration Debian/Ubuntu vers Runtipi](migration-debian.md).
