# LobeHub 2.3.2 — Runtipi 4.9.1

Déploiement auto-hébergé de [LobeHub](https://github.com/lobehub/lobehub) basé sur son [Compose officiel](https://github.com/lobehub/lobehub/blob/canary/docker-compose/deploy/docker-compose.yml), adapté à **Runtipi 4.9.1**, au LAN et à **Cloudflare Tunnel sans Traefik**.

## Installation et réseau

1. Ajouter le store `https://github.com/Ajilis/runtipi-appstore` dans Runtipi (s'il n'est pas déjà présent), puis actualiser les stores et installer **LobeHub**.
2. Renseigner les deux URL HTTPS, par exemple `https://lobe.exemple.fr` et `https://s3.exemple.fr` ; saisir l'URL LAN **exacte** `http://192.168.1.10:8292` (adapter l'adresse à votre serveur et le port choisi dans Runtipi). Préciser les adresses e-mail autorisées. Conserver les secrets générés.
3. Dans Cloudflare Zero Trust → Tunnels → Public hostnames, déclarer :
   - `lobe.exemple.fr` → service HTTP `http://IP_DU_SERVEUR:8292` ;
   - `s3.exemple.fr` → service HTTP `http://IP_DU_SERVEUR:8293`.
4. Ouvrir **en LAN** `http://IP_DU_SERVEUR:8292`, ou **à distance** `https://lobe.exemple.fr`.

**Attention :** Cloudflare Tunnel fournit HTTPS publiquement mais communique ici en HTTP avec l'origine. Aucune règle de redirection Traefik n'est créée. La valeur `APP_URL` est l'URL publique canonique : certaines opérations d'authentification, OAuth, liens partagés ou redirections peuvent revenir vers cette URL même si l'interface a été ouverte par l'IP LAN. `AUTH_ADDITIONAL_TRUSTED_ORIGINS` autorise aussi l'origine LAN dans Better Auth, sans rendre le comportement de tous les modules identique sur les deux origines.

### Accessibilité de S3

LobeHub génère des URL S3 pré-signées utilisées **directement par le navigateur** pour certains téléversements. Il faut donc que `S3_ENDPOINT` soit une URL accessible depuis le navigateur en LAN **et** à distance ; utiliser le hostname public `https://s3.exemple.fr`. LobeHub accède à RustFS via `S3_INTERNAL_ENDPOINT=http://rustfs:9000` à l'intérieur de Docker. Le navigateur local doit également pouvoir atteindre le hostname public S3 (connexion Internet ou DNS adapté).

N'activez pas mécaniquement Cloudflare Access sur le hostname S3 : les requêtes CORS et les URL pré-signées peuvent être bloquées par des redirections d'authentification. Protéger le hostname applicatif avec Cloudflare Access, conserver les signatures S3, limiter l'exposition S3 au tunnel et appliquer une politique de sécurité Cloudflare adaptée.

Si `cloudflared` est installé directement sur le serveur, `http://127.0.0.1:8292` et `http://127.0.0.1:8293` fonctionnent avec l'écoute `0.0.0.0`. S'il tourne dans un conteneur différent, `127.0.0.1` désigne **ce conteneur**, pas l'hôte ; utiliser l'IP LAN du serveur ou un réseau Docker explicitement commun.

## Ports et sécurité

| Service | Port sur le serveur | Port conteneur | Réseau |
| --- | --- | --- | --- |
| LobeHub | 8292 (ou port Runtipi choisi) | 3210 | LAN + Tunnel |
| RustFS S3 | 8293 (configurable) | 9000 | LAN + Tunnel |
| ParadeDB / PostgreSQL | aucun | 5432 | Docker uniquement |
| Redis | aucun | 6379 | Docker uniquement |
| Console RustFS | aucun | 9001 | non exposée |

Les seuls ports publiés sont LobeHub et S3. Aucun `x-runtipi.is_main`, aucune connexion au réseau Traefik ; `traefik.enable=false` pour chaque service. **0.0.0.0 signifie toutes les interfaces de l'hôte**, pas « LAN uniquement » : choisir l'IP LAN d'écoute et/ou utiliser un pare-feu pour bloquer les interfaces publiques ; ne jamais rediriger ces ports dans la box Internet.

L'inscription est limitée aux e-mails renseignés à l'installation via `AUTH_ALLOWED_EMAILS`. L'authentification de LobeHub reste activée ; ne partagez pas les secrets et activez Cloudflare Access sur l'hôte applicatif si pertinent. Les fichiers S3 ont une politique de lecture publique conforme au Compose officiel de LobeHub ; ne pas y déposer de secrets sensibles sans réévaluer cette politique.

## Persistance et sauvegardes

Tous les volumes sont dans `app-data/<slug-du-store>/lobehub/` sur le serveur :

| Dossier | Utilité |
| --- | --- |
| `config/jwks.json` | clé privée RS256 créée **une seule fois** au démarrage et réutilisée à chaque mise à jour |
| `postgres/` | base de données ParadeDB/PostgreSQL : conversations, agents, paramètres et comptes |
| `redis/` | cache et sessions Redis avec AOF |
| `rustfs/` | objets S3 : fichiers joints, images et documents |

Le fichier de variables `app.env` généré et conservé par Runtipi contient les autres paramètres et secrets d'installation. La clé JWKS est initialisée par un service Node temporaire avec des droits limités (fichier `0600`, propriétaire UID `1001`); RustFS utilise l'UID `10001` et son dossier est initialisé en conséquence. Les services init sont idempotents et n'effacent aucun volume existant.

**Sauvegarder ensemble** `config/`, `postgres/`, `rustfs/`, `redis/` et les secrets du formulaire Runtipi. Pour des sauvegardes cohérentes de PostgreSQL, arrêter la pile ou réaliser un `pg_dump`/backup cohérent ; copier les fichiers d'une base active sans précautions peut produire une sauvegarde invalide. Ne pas changer les mots de passe après création des données sans procédure de migration.

L'application utilise ParadeDB `0.26.5-pg17` avec `pg_search`, Redis `7.4`, RustFS `1.0.4`, `rc` `v0.1.37` et LobeHub `2.3.2`. L'initialisation du bucket `lobe` et des règles CORS se fait automatiquement.

## Limitations et vérification

- Cette intégration privilégie les conversations et la gestion des fichiers. **Agent Gateway / Device Gateway / SearXNG / Elasticsearch** ne sont pas inclus. Les fonctions exigeant ces composants ne sont donc pas disponibles.
- Les requêtes S3 via Cloudflare sont soumises aux limites d'upload et aux règles Cloudflare du compte.
- L'interface et le tunnel doivent être testés après installation. L'environnement du serveur Runtipi de destination n'est pas accessible depuis ce dépôt, donc aucun test d'exécution réelle n'est revendiqué.

Après installation : vérifier les journaux `lobehub-init` puis `rustfs-init` (terminés avec succès), et la santé de `postgresql`, `redis`, `rustfs`, `lobehub`. Tester la connexion sur l'URL publique et sur l'URL LAN, puis l'envoi d'une image et son affichage.

Source du logo JPEG : [Runtipi App Store / Lobe Chat](https://github.com/runtipi/runtipi-appstore/blob/master/apps/lobe-chat/metadata/logo.jpg). Logo PNG courant : [LobeHub](https://github.com/lobehub/lobehub/blob/canary/public/app-icons/icon-192x192.png).
