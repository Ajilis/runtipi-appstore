# Postiz sans Elasticsearch

Postiz permet de programmer des publications pour plusieurs réseaux sociaux. Cette variante Ajilis de Runtipi utilise **5 services** : Postiz, PostgreSQL, Redis, Temporal et son PostgreSQL. Aucun Elasticsearch n'est lancé ; Temporal initialise sa base `temporal_visibility` dans PostgreSQL.

## Installer via l'App Store Ajilis

1. Rafraîchir le dépôt `https://github.com/Ajilis/runtipi-appstore` dans Runtipi.
2. Installer **Postiz (sans Elasticsearch)**.
3. Renseigner l'URL publique exacte en HTTPS (par exemple `https://postiz.exemple.fr`, sans slash final). Les secrets JWT et PostgreSQL sont générés par Runtipi.
4. Conserver l'option **Désactiver les inscriptions** décochée le temps de créer le premier compte ; l'activer ensuite.
5. Créer dans Cloudflare Tunnel un hôte public vers `http://127.0.0.1:8286` si `cloudflared` fonctionne sur le serveur en mode réseau hôte. Ne pas ouvrir le port 8286 sur le routeur.
6. Configurer les clés et identifiants OAuth des plateformes sociales via une surcharge de configuration Runtipi si nécessaire.

La publication HTTP est liée à `127.0.0.1:8286` uniquement. PostgreSQL, Redis et Temporal ne publient aucun port sur l'hôte. Si `cloudflared` est dans un autre conteneur sans mode réseau hôte, `127.0.0.1` désigne ce conteneur : adapter la connectivité réseau du tunnel.

**Installation neuve uniquement :** ne pas remplacer directement une installation Temporal existante qui stocke sa visibilité dans Elasticsearch sans migration des données et sauvegardes. Sauvegarder `APP_DATA_DIR`. Utilisation de l'image Postiz `latest` : prévoir une stratégie de mise à jour et de tests.

Le fichier Compose suit le format Runtipi `x-runtipi` version 2, mais ce déploiement n'a pas encore été testé sur une instance Runtipi réelle.

Sources : [Postiz](https://github.com/gitroomhq/postiz-app/blob/main/docker-compose.yaml), [Temporal auto-setup](https://github.com/temporalio/docker-builds/blob/main/docker/auto-setup.sh), [Runtipi Dynamic Compose](https://runtipi.io/docs/reference/dynamic-compose).
