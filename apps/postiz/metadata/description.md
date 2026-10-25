# Postiz complet (Temporal + Elasticsearch)

Gestion et programmation de publications sur les réseaux sociaux. Cette variante du catalogue Ajilis utilise la pile Postiz/Temporal avec Elasticsearch, sans reverse proxy Traefik.

## Installation Runtipi 4.9.1

1. Actualiser le store `https://github.com/Ajilis/runtipi-appstore`, installer **Postiz (complet)** (`postiz`).
2. Renseigner une URL HTTPS publique canonique, par exemple `https://postiz.exemple.fr` (sans `/` final). Runtipi génère le JWT et les deux mots de passe PostgreSQL. Laisser l'inscription ouverte pour créer le premier compte.
3. Dans Cloudflare Zero Trust, configurer le Public Hostname `postiz.exemple.fr` avec un origin HTTP `http://127.0.0.1:8287` si `cloudflared` est exécuté sur l'hôte. S'il est dans un conteneur isolé, utiliser l'adresse IP LAN du serveur : `http://IP_LAN_DU_SERVEUR:8287`.
4. En local, ouvrir `http://IP_LAN_DU_SERVEUR:8287`. Le port Docker est lié par défaut à `0.0.0.0` pour permettre l'accès depuis le LAN. Le formulaire permet de le limiter à l'IP LAN. Ne configurer **aucune redirection NAT WAN** vers ce port ; filtrer les interfaces non locales avec le pare-feu hôte.
5. Configurer ensuite dans la surcharge d'environnement Runtipi les clés API/OAuth des plateformes sociales requises. Les URL OAuth doivent utiliser le domaine HTTPS canonique.

**Attention :** Postiz n'accepte qu'une URL front-end/backend publique canonique. Les pages peuvent répondre par IP:port sur le LAN, mais les appels JavaScript, les connexions OAuth ou les redirections peuvent employer le domaine HTTPS Cloudflare. Le mode LAN ne constitue donc pas un fonctionnement complètement autonome hors du tunnel.

## Services et persistance

- `postiz` — seul port publié : `8287:5000`, sans label Traefik et sans `x-runtipi.is_main`
- `postiz-db` — PostgreSQL 17
- `postiz-redis` — Redis 7 avec journal AOF
- `postiz-temporal-db` — PostgreSQL 16 pour Temporal
- `postiz-temporal-es` — Elasticsearch 7.17.27 pour la recherche de workflows
- `postiz-temporal` — Temporal auto-setup 1.28.1
- `postiz-init` — préparation ponctuelle des répertoires et du fichier YAML de configuration Temporal

Les dossiers persistants sous `APP_DATA_DIR` sont `config/`, `uploads/`, `postgres/`, `redis/`, `temporal-postgres/`, `temporal-elasticsearch/` et `temporal-dynamicconfig/`. Les paramètres fournis dans le formulaire restent aussi enregistrés par Runtipi dans sa configuration d'application.

**Prérequis :** hôte `amd64`, suffisamment de RAM/disque pour Elasticsearch, et paramètre noyau Linux `vm.max_map_count` adapté à Elasticsearch (typiquement au moins `262144` pour ES 7). Seule l'interface HTTP Postiz est publiée ; PostgreSQL, Redis, Temporal et Elasticsearch restent sur un réseau Docker privé.

**Sauvegardes :** sauvegarder les dossiers de `APP_DATA_DIR` et la configuration d'installation Runtipi, et effectuer des sauvegardes logiques PostgreSQL cohérentes avant les upgrades. Ne jamais installer `postiz` en pointant vers les données de `postiz-lite` sans procédure de migration. L'image Postiz utilise `latest` : contrôler les montées de version.

Cette définition a été contrôlée statiquement mais **n'a pas fait l'objet d'un démarrage réel sur une instance Runtipi 4.9.1**.

Sources : [docker-compose officiel Postiz](https://github.com/gitroomhq/postiz-app/blob/main/docker-compose.yaml), [documentation Runtipi](https://runtipi.io/docs/reference/dynamic-compose) et [Temporal](https://github.com/temporalio/docker-builds/blob/main/docker-readme/auto-setup.md).
