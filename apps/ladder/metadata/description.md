# Ladder — connexion Web avec AuthCrunch

**Ladder 0.0.23** + **AuthCrunch 1.6.2**, catalogue Runtipi **tipi_version 2**. La fenêtre HTTP Basic Auth est remplacée par le **formulaire Web** du portail AuthCrunch. Licence Ladder GPL-3.0 et AuthCrunch Apache-2.0. Aucun Traefik, base SQL ou conteneur init.

## Installer ou mettre à jour dans Runtipi 4.9.1

Ajouter et actualiser l'App Store `https://github.com/Ajilis/runtipi-appstore`. Installer (ou **mettre à jour sans désinstallation**) Ladder. Utiliser les champs existants **Identifiant de connexion Web** (`LADDER_USERNAME`) et **Mot de passe initial de connexion Web** (`LADDER_PASSWORD`), ainsi que l'URL du jeu de règles et éventuellement les domaines autorisés. Les paramètres restent conservés dans l'`app.env` Runtipi. Aucun nouveau domaine Cloudflare n'est nécessaire pour démarrer localement.

Ouvrir `http://IP_DU_SERVEUR:8295/` ; l'accès non authentifié redirige vers `/auth/login` (formulaire). Se connecter avec le compte initial, puis ouvrir Ladder à `/` (par exemple `/https://example.org`). La page `/auth/` donne accès au portail et à la déconnexion. L'authentification ne repose plus sur `USERPASS` de Ladder : seul `ladder-auth` publie un port hôte. Si des comptes sont déjà créés dans AuthCrunch, les modifications d'identifiants en formulaire ne remplacent pas leur base ; utiliser la gestion de compte prévue par AuthCrunch.

## LAN / Cloudflare Tunnel sans Traefik

- LAN `http://IP_DU_SERVEUR:8295/` ; mapping littéral `8295:8080/tcp` du seul service `ladder-auth`.
- Dans Cloudflare Zero Trust, origin **HTTP** `http://IP_DU_SERVEUR:8295` pour un hostname public HTTPS. Si `cloudflared` est lancé directement sur l'hôte, `http://127.0.0.1:8295` peut convenir ; si c'est un conteneur isolé, son loopback n'est pas celui de l'hôte.
- `traefik.enable: "false"` sur chaque service, `exposable=false` dans Runtipi, aucune route Traefik.
- Pour fonctionner simultanément en HTTP LAN et derrière HTTPS Cloudflare, le portail accepte les cookies HTTP non-Secure (`cookie insecure enabled`). Cela réduit la sécurité du réseau local : n'utiliser qu'un LAN de confiance ou envisager un accès HTTPS local. Les sessions/cookies sont distincts pour l'IP LAN et le domaine HTTPS. **Cloudflare Access** et un pare-feu limitant le port hôte sont fortement conseillés ; ne pas rediriger ce port depuis la box Internet.

## Persistance et sauvegardes

`${APP_DATA_DIR}/authcrunch/users.json` : identités locales ; `${APP_DATA_DIR}/authcrunch/signing.key` : clé de signature JWT créée une seule fois et conservée au redémarrage ; `${APP_DATA_DIR}/authcrunch/caddy/` : stockage Caddy. Conserver aussi `app.env` et la configuration du tunnel. Sauvegarder le dossier authcrunch **à l'arrêt** des services et ne jamais effacer la clé JWT en usage, ni `users.json`. La configuration du portail elle-même est injectée par Compose dans le conteneur ; aucun fichier préexistant n'est requis. Aucun volume n'est nécessaire pour Ladder : ses règles sont téléchargées depuis l'URL fournie.

Avant mise à jour, effectuer une sauvegarde, actualiser le catalogue et mettre à jour le service sans désinstaller (une désinstallation pourrait supprimer les données). Le slug `ladder` et les noms de variables d'identifiants existants sont préservés. La première migration invalide la précédente session Basic Auth mais ne supprime aucun compte AuthCrunch déjà enregistré.

## Vérifications sur le serveur

Contrôler que **8295/TCP est libre**, que les deux conteneurs sont `running`, que le portail `/auth/login` accepte le login et que `/` est inaccessible en navigation privée. Tester ensuite la déconnexion, l'origine Cloudflare Tunnel, le comportement des cookies et un redémarrage avec conservation de `users.json` et `signing.key`. En cas d'erreur, consulter les logs des deux services et le résultat de validation `caddy adapt` exécuté avant le démarrage. Aucun test réel sur votre serveur Runtipi n'a été effectué lors de la préparation du catalogue.

## Sécurité et limites

Ne jamais publier directement le port 8080 de Ladder via un override Docker : cela contournerait l'authentification AuthCrunch. Restreindre `LADDER_ALLOWED_DOMAINS` pour éviter un proxy accessible à toute destination ; la liste vide est permissive. Le compte initial est défini dans Caddyfile avec les variables d'environnement Runtipi : un ancien mot de passe contenant `"` peut perturber la syntaxe et doit être modifié avant le démarrage. Les secrets restent hors GitHub. L'utilisateur admin possède les rôles `authp/admin` et `authp/user`, avec API d'administration non activée.

Références : [Ladder](https://github.com/everywall/ladder), [AuthCrunch](https://github.com/authcrunch/authcrunch), [configuration officielle du portail](https://docs.authcrunch.com/docs/start/first-app).
