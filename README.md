# Ajilis Runtipi App Store

Boutique d'applications personnalisées pour [Runtipi](https://runtipi.io).

## Installer Chatwoot

1. Dans **Runtipi → Settings → App Stores**, ajouter cette URL : `https://github.com/Ajilis/runtipi-appstore`.
2. Actualiser les catalogues et ouvrir **Chatwoot**.
3. Installer sans activer l'exposition de domaine Runtipi. Le port hôte par défaut est **8284**, redirigé par Runtipi vers le port interne **3000**.
4. Renseigner le champ **URL publique Chatwoot (Cloudflare)**, par exemple `https://support.exemple.fr`.
5. Dans Cloudflare Tunnel, créer un Public Hostname `support.exemple.fr` vers `http://IP_LAN_DU_SERVEUR:8284` si `cloudflared` s'exécute hors du réseau Docker de Runtipi. Si `cloudflared` est sur la même machine hors Docker, utiliser `http://127.0.0.1:8284`.
6. Ne pas ouvrir le port 8284 sur le routeur ; limiter son accès au réseau local ou au processus `cloudflared` par pare-feu.
7. Créer le premier administrateur : l'inscription publique étant désactivée par défaut, l'activer temporairement dans le Compose (`ENABLE_ACCOUNT_SIGNUP=true`), redéployer, créer le compte, puis remettre la valeur à `false`.
8. Configurer SMTP avant d'utiliser les notifications par e-mail.

Le déploiement comprend Rails, Sidekiq, PostgreSQL/pgvector et Redis. Pour éviter les timeouts Runtipi au premier démarrage, la préparation de la base (`db:chatwoot_prepare`) est lancée **dans le conteneur web** avant le serveur Rails, et non comme un service `chatwoot-init` avec dépendance bloquante de Docker Compose. La page web peut être indisponible quelques minutes pendant cette préparation ; suivre `docker logs chatwoot_appstore-ajilis-chatwoot-1 -f` pour observer la progression. Les données sont persistantes dans `APP_DATA_DIR`. Aucune base de données n'est exposée sur Internet.

**Production :** figer des versions d'images plutôt que `latest-ce` et configurer des sauvegardes régulières. La configuration n'a pas été testée sur une instance Runtipi réelle.

Documentation : [Chatwoot](https://developers.chatwoot.com/self-hosted/deployment/docker), [Runtipi](https://runtipi.io/docs/reference/dynamic-compose).

## HTTPS via Cloudflare Tunnel

L'application écoute en HTTP sur le port local `8284` et conserve `FORCE_SSL=false` dans Rails pour éviter une redirection HTTPS vers le port local sans serveur TLS. Renseigner `CHATWOOT_FRONTEND_URL` avec l'URL publique **HTTPS** de Cloudflare Tunnel (par exemple `https://support.exemple.fr`). Le chiffrement client HTTPS est assuré par Cloudflare. Tester localement avec `curl -I http://127.0.0.1:8284` : une réponse HTTP ou une redirection applicative normale est attendue, mais pas de redirection vers `https://127.0.0.1:8284/`.

## Installer Zammad sans Elasticsearch (Cloudflare Tunnel, sans Traefik)

1. Dans **Runtipi → Settings → App Stores**, actualiser `https://github.com/Ajilis/runtipi-appstore`.
2. Installer ou mettre à jour **Zammad**, renseigner `ZAMMAD_DOMAIN`, et conserver le mot de passe PostgreSQL existant en cas de mise à jour.
3. Configurer un *Public Hostname* Cloudflare vers `http://127.0.0.1:8285` (si cloudflared est sur le même serveur en réseau hôte).
4. Ouvrir le domaine public en HTTPS. Aucune exposition Traefik ni aucun réglage `vm.max_map_count` lié à Elasticsearch n'est nécessaire.

**Différence avec l'ancienne version :** le service Elasticsearch et son volume déclaré ont été retirés du Compose, et `ELASTICSEARCH_ENABLED=false` est appliqué à Zammad. La recherche plein texte indexée peut être indisponible. Sauvegarder les données avant une mise à jour ; ne pas supprimer les volumes PostgreSQL ou le stockage utilisateur.

**Ports :** Chatwoot `8284` et Zammad `8285`, chacun à associer à un nom de domaine Cloudflare distinct.

**Correction d'installation :** la configuration Zammad ne définit plus `x-runtipi.is_main` sur Nginx, car Runtipi créerait un second mappage automatique du port. Le seul mappage reste `127.0.0.1:8285:8080` pour Cloudflare Tunnel en réseau hôte. Version du catalogue Zammad : **5**.

Logo Zammad issu de [la source officielle](https://github.com/zammad/zammad/blob/develop/logo.svg). Déploiement Runtipi réel à valider.

## Installer Postiz sans Elasticsearch (Cloudflare Tunnel)

1. Dans **Runtipi → Settings → App Stores**, actualiser ce catalogue : `https://github.com/Ajilis/runtipi-appstore`.
2. Installer **Postiz (sans Elasticsearch)** (identifiant `postiz-lite`, port local **8286**). Renseigner l'**URL publique HTTPS** exacte, par exemple `https://postiz.exemple.fr` (sans slash final).
3. Dans Cloudflare Tunnel, faire pointer le *Public Hostname* vers `http://127.0.0.1:8286` si `cloudflared` s'exécute sur le même hôte avec accès à la boucle locale. Sinon adapter le routage réseau du tunnel.
4. **Ne pas exposer le port 8286 sur Internet.** Laisser les inscriptions activées le temps de créer le premier compte, puis cocher **Désactiver les inscriptions Postiz** dans la configuration de l'application.
5. Configurer ensuite les identifiants des réseaux sociaux (OAuth/API) selon les plateformes voulues.

Cette version comprend **5 conteneurs** : Postiz, PostgreSQL Postiz, Redis, Temporal et PostgreSQL Temporal. **Aucun Elasticsearch** : Temporal utilise PostgreSQL pour sa base de visibilité. Les données persistent dans `APP_DATA_DIR`. Elle est destinée à une **nouvelle installation** ; une migration depuis une configuration Temporal/Elasticsearch existante nécessite un plan de sauvegarde. L'image Postiz est actuellement basée sur le tag `latest`, à surveiller avant les mises à jour.

Documentation de l'application : [`apps/postiz-lite/metadata/description.md`](apps/postiz-lite/metadata/description.md).
