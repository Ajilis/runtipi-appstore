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
