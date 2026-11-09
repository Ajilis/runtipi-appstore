# LobeHub 2.3.2 — Runtipi 4.9.1 — administrateur global et inscriptions verrouillées

Révision Runtipi **13**. LobeHub est hébergé avec ParadeDB/PostgreSQL, Redis, RustFS et une passerelle Nginx sous **un seul hostname Cloudflare Tunnel**. **La première identité est un administrateur global**, créé **avant toute ouverture de l'interface publique**. Les utilisateurs suivants ne peuvent être créés que par cet administrateur au moyen de l'API Better Auth existante.

## Clé Vault : génération sûre et réutilisation (révision Runtipi 5)

Le champ Runtipi `LOBE_KEY_VAULTS_SECRET` génère **64 caractères hexadécimaux**, correspondant à **32 octets aléatoires**. LobeHub attend un encodage **Base64 de 16, 24 ou 32 octets** ; dans cette application, la clé utilisée est toujours de **32 octets**.

- **Première installation :** Runtipi crée le secret une seule fois et le conserve dans `app.env`. Au démarrage, LobeHub convertit la représentation hexadécimale en Base64 canonique avant de charger le serveur. Il n'y a pas de création d'un second secret ni de modification de `app.env`.
- **Redémarrage et mise à jour :** le même secret hexadécimal donne la même clé Base64, sans rotation. Les valeurs Base64 canoniques qui représentent déjà exactement 32 octets (par exemple après une correction manuelle) sont conservées telles quelles.
- **Valeur absente ou incorrecte :** le démarrage échoue avec un message explicite **sans remplacer la clé**. Ne pas réinstaller ni réinitialiser PostgreSQL pour contourner ce contrôle. Vérifier la valeur existante dans les paramètres Runtipi, sans la publier dans des logs ou un ticket.
- **Sauvegarde :** sauvegarder conjointement la configuration Runtipi (`app.env`), `config/jwks.json` et la base PostgreSQL. Toute rotation voulue doit être planifiée avec une migration des données chiffrées.

Cette correction prend aussi en charge les installations existantes qui conservent la valeur hexadécimale de 64 caractères générée par les révisions antérieures : la conversion est **déterministe** et ne régénère rien. Aucun secret n'est imprimé dans les journaux.

## Contrôle de santé HTTP local (révision Runtipi 6)

Le healthcheck utilise désormais `node:http` avec `agent: false` vers `127.0.0.1:3210/`, plutôt que `fetch()`. Il ne suit donc pas les redirections vers le domaine public (par exemple `/signin`), et n'utilise pas de proxy HTTP implicite.

- **Réponse HTTP 2xx ou 3xx :** LobeHub est considéré joignable. Une redirection d'authentification `302` ou `307` est normale.
- **HTTP 4xx ou 5xx, refus de connexion, délai dépassé :** le contrôle échoue et inscrit un diagnostic (ex. `HTTP 500`, `ECONNREFUSED`, `HTTP timeout`) dans `docker inspect --format '{{json .State.Health}}' lobehub_appstore-ajilis-lobehub-1`.
- Le contrôle teste **la réponse locale du serveur web**, pas toutes les dépendances métier ou les chemins de connexion utilisateur ; la base et RustFS sont contrôlés séparément par Compose.
- Il ne modifie ni la base PostgreSQL ni les clés JWT/JWKS et Vault, et ne réduit pas les dépendances de démarrage.

Si l'application reste `unhealthy`, examiner le diagnostic exact et `docker logs` plutôt que de désactiver le healthcheck.

## Installation sans tunnel Cloudflare (révision Runtipi 7)

Le tunnel Cloudflare **n'a pas besoin d'exister lors de la première installation**. L'URL LAN suffit pour l'initialisation, l'accès à l'interface et le provisionnement du premier administrateur.

1. Dans Runtipi, laisser **URL HTTPS publique LobeHub** vide.
2. Renseigner obligatoirement **URL HTTP locale LobeHub**, par exemple `http://192.168.1.10:8292`, avec une IP LAN joignable et le port de la passerelle.
3. Installer et démarrer l'application. LobeHub utilise cette URL LAN pour `APP_URL` et `S3_ENDPOINT`. Le provisionnement administrateur contacte toujours `http://lobehub:3210/api/auth/sign-up/email` à l'intérieur du réseau Docker, et transmet l'origine LAN au lieu d'une origine publique injoignable.
4. Vérifier la santé des services, puis accéder à `http://IP_DU_SERVEUR:8292/signin`. Une authentification fonctionnelle sur LAN doit être testée avant le raccordement externe.
5. **Ensuite seulement**, créer le tunnel Cloudflare vers `http://IP_DU_SERVEUR:8292`. Dans Runtipi, renseigner l'URL HTTPS réelle (par exemple `https://lobe.exemple.fr`), sauvegarder et redémarrer LobeHub pour mettre à jour `APP_URL`, `S3_ENDPOINT` et l'origine autorisée. Une reconnexion peut être nécessaire.

Le healthcheck LobeHub (révision 6) sonde directement le serveur local sans suivre de redirection. La passerelle Nginx (révision 7) vérifie maintenant la page HTML locale `/_runtipi_admin/` au lieu de `/`, évitant les redirections vers un domaine public inexistant. **Le healthcheck ne prouve pas à lui seul que les identifiants admin et les téléchargements de fichiers fonctionnent : tester ces fonctions.**

Si une ancienne installation conserve une valeur `LOBE_PUBLIC_URL` factice mais non vide, la supprimer du formulaire Runtipi pour activer le repli LAN. Aucun volume, secret Vault, JWKS ou mot de passe utilisateur ne doit être réinitialisé pour passer du LAN au tunnel.

## Correctif catalogue : date dans le futur (révision Runtipi 8)

La révision précédente définissait `updated_at` à une date future. Le schéma Runtipi impose que `created_at` et `updated_at` soient strictement antérieurs à l'heure du serveur, faute de quoi **l'application est écartée du catalogue malgré la présence des fichiers dans `repos/`**.

Le champ `updated_at` est désormais omis : Runtipi lui attribue son défaut `0` et n'a plus de date future à valider. `created_at` conserve sa date historique valide. Aucun volume, secret, conteneur ou autre réglage de LobeHub n'est modifié. Pour appliquer : actualiser le store Ajilis, puis rafraîchir l'interface ; le cache du catalogue peut nécessiter jusqu'à 15 minutes d'expiration en l'absence d'invalidation explicite.

**Pour les prochaines révisions** : ne pas introduire d'horodatage prédéfini dans le futur ; omettre `updated_at` est préférable tant qu'aucun horodatage courant fiable n'est disponible.

## Initialisation RustFS robuste (révision Runtipi 9)

RustFS 1.0.4 dispose de deux contrôles : `/health` signale que le service HTTP fonctionne ; `/health/ready` exige que le stockage, IAM et les métadonnées soient prêts. Le healthcheck Docker interroge désormais **`/health/ready`** avant de lancer `rustfs-init`.

`rustfs-init` initialise le bucket privé `lobe` avec quatre étapes clairement identifiées : alias S3, création du bucket avec `--ignore-existing`, accès anonyme privé, configuration CORS. **Seul le code de sortie 3 du client rc (erreur réseau/503) donne lieu à une nouvelle tentative**, au maximum 12 tentatives espacées de cinq secondes par étape ; les autres erreurs échouent immédiatement. Le journal de `rustfs-init` affiche le nom de l'étape, la tentative et le code de sortie sans imprimer les identifiants.

Le conteneur RustFS reçoit les identifiants **exclusivement via ses variables d'environnement** existantes `RUSTFS_ACCESS_KEY` et `RUSTFS_SECRET_KEY`, et non plus via des arguments visibles dans les logs du script de démarrage. Les valeurs des clés ne sont ni régénérées ni modifiées, et les données `rustfs/` sont conservées.

**Sécurité :** si des journaux précédents ont révélé la clé S3, ces secrets doivent être considérés comme exposés. Planifier leur rotation **de manière coordonnée** dans Runtipi et les éventuels clients S3 après sauvegarde et contrôle de l'accès aux fichiers. Ne pas simplement modifier la clé dans le conteneur RustFS : LobeHub et `rustfs-init` doivent utiliser les mêmes valeurs.

Pour diagnostiquer une nouvelle erreur : `docker logs --tail 150 lobehub_appstore-ajilis-rustfs-init-1` et `docker inspect --format '{{json .State.Health}}' lobehub_appstore-ajilis-rustfs-1`. Si la réponse `/health/ready` demeure 503 ou si une étape échoue après les tentatives, consulter les journaux RustFS et le stockage plutôt que réinitialiser le bucket.

## Publication du port LAN 8292 (révision Runtipi 10)

Runtipi convertit les ports Compose destinés à son éditeur YAML avec un découpage sur `:`. La notation initiale `${LOBE_BIND_IP:-0.0.0.0}:${APP_PORT:-8292}:8080/tcp` comporte des séparateurs `:` **à l'intérieur des valeurs par défaut**, ce qui génère un champ `PORT DE L'HÔTE` incorrect et un mauvais `PORT DU CONTENEUR` dans l'éditeur.

La syntaxe retenue est désormais `${LOBE_BIND_IP}:${APP_PORT}:8080/tcp`. Runtipi renseigne `LOBE_BIND_IP` par la valeur par défaut du formulaire (`0.0.0.0`) et injecte `APP_PORT` à partir du port déclaré dans `config.json` (8292 ou l'éventuelle valeur personnalisée). Le découpage de Runtipi retrouve donc exactement trois éléments : adresse IP, port hôte et port conteneur. Seul **TCP** est publié ; UDP n'est pas nécessaire.

Le service `lobehub-s3-gateway` continue de servir l'interface en LAN à `http://IP_DU_SERVEUR:8292`, sans tunnel Cloudflare au premier démarrage. Ce correctif **n'affecte pas le healthcheck interne Nginx** : si le conteneur reste `unhealthy`, consulter `docker logs lobehub_appstore-ajilis-lobehub-s3-gateway-1` et `docker inspect --format '{{json .State.Health}}' lobehub_appstore-ajilis-lobehub-s3-gateway-1`.

## Console administrateur Nginx : suppression de l'erreur 500 (révision Runtipi 11)

Les logs Runtipi montrent que `GET /_runtipi_admin/` échouait avec `HTTP 500` et le message `/etc/nginx/runtipi-admin/index.htmlindex.html is not a directory`. La règle `location = /_runtipi_admin/` utilisait un `alias` pointant **directement sur le fichier `index.html`** ; le module Nginx `index` ajoutait lui aussi `index.html`, produisant un chemin invalide.

La règle utilise désormais un préfixe `location ^~ /_runtipi_admin/` et l'`alias /etc/nginx/runtipi-admin/` (répertoire), avec `index index.html`. Les accès `/_runtipi_admin/` et `/_runtipi_admin/index.html` pointent sur le document statique valide. Le contrôle de santé Nginx garde son URL locale `http://127.0.0.1:8080/_runtipi_admin/` : il devient sain si la page retourne HTTP 200. Les restrictions contre les inscriptions publiques, les signatures S3 et l'authentification Better Auth restent inchangées.

**Mise à jour des installations existantes :** le script `lobehub-init` n'écrase jamais les anciens fichiers de configuration persistants. Il crée donc un **nouveau** fichier `config/nginx-gateway-v4.conf` lors du prochain démarrage, et le service Nginx monte désormais ce nouveau fichier en lecture seule. `nginx-gateway-v3.conf` est conservé pour référence ; ni les données ni les clés ne sont remplacées.

**Limite connue Runtipi 4.12.0 :** la synchronisation des états Docker compte aussi les cinq conteneurs d'initialisation qui se sont normalement terminés avec `Exited (0)`. Le message `5/10 running` peut donc encore faire apparaître LobeHub comme **Arrêté** dans le tableau de bord alors que ses cinq services permanents sont démarrés et sains. Ce défaut de statut nécessite une correction côté Runtipi ; relancer ou réinstaller LobeHub ne le résout pas. Vérifier les états réels avec `docker ps -a --filter "label=com.docker.compose.project=lobehub_appstore-ajilis"`.

**Validation locale :** avec le binaire Nginx, la règle antérieure renvoie HTTP 500 sur `/_runtipi_admin/` ; la nouvelle règle répond HTTP 200 et refuse les fichiers inexistants (404). Cette validation ne remplace pas un test après mise à jour de l'instance réelle.

## Installation autonome sur un Runtipi vierge (révision 13)

**Correctif révision 13 — première installation :** la révision 12 laissait `$result` non échappé deux fois dans le script shell de `lobehub-admin-precheck`. Docker Compose interpolait `$result` en chaîne vide avant de lancer le conteneur, ce qui provoquait `Etat admin inattendu.`, des redémarrages en boucle et un `docker compose up` en échec. La révision 13 utilise `$result` pour laisser la variable shell au conteneur. Tous les autres usages de variables shell de ce Compose ont été revérifiés ; aucun autre `$variable` non échappé n'a été détecté. Les marqueurs de réussite, le maintien en veille des init et les dépendances `service_healthy` restent inchangés.

La première installation LobeHub s'effectue entièrement depuis le formulaire Runtipi, avec une adresse LAN, sans installation de service `systemd`, sans commande SSH et sans Cloudflare Tunnel préalable.

**Problème Runtipi 4.12.0 :** les cinq tâches Compose terminées avec `Exited (0)` étaient comptabilisées dans les dix conteneurs de l'application. Runtipi signalait `5/10 running` et basculait à tort vers « Arrêté ».

**Fonctionnement révision 12 :** les cinq initialiseurs conservent leur logique actuelle (JWKS/configuration, bucket RustFS et CORS, précontrôle admin, inscription du premier compte, promotion en administrateur global). Chacun crée un marqueur d'exécution dans son dossier éphémère `/tmp` **uniquement après succès**, devient `healthy` et reste en veille passive, sans requêtes ni tâches supplémentaires. Les dépendances passent à `condition: service_healthy`. La passerelle Nginx ne démarre qu'après la promotion effective de l'administrateur.

**Résultat attendu : dix conteneurs `Up`**, dont cinq services applicatifs actifs et cinq processus d'initialisation en veille passive. Contrairement à un nettoyage Docker, les cinq conteneurs temporaires **ne sont pas supprimés** : les supprimer automatiquement imposerait des privilèges d'accès au daemon Docker ou une correction du moteur Runtipi. La veille passive permet au Compose de rester autonome sur une installation vierge, au prix d'une faible consommation de mémoire par helper.

À chaque recréation forcée du Compose (mise à jour ou redémarrage), les étapes sont relancées de façon **idempotente** : les JWKS, le bucket privé existant et le mot de passe de l'administrateur ne sont pas remplacés. Si une étape échoue, elle ne produit aucun marqueur de réussite et la suite du démarrage reste bloquée.

**Depuis la révision 11 :** procéder à une mise à jour de l'application dans Runtipi, sans désinstallation et sans toucher aux volumes ou aux secrets. La solution extérieure `systemd` de la PR #57 est désormais obsolète. Si elle avait déjà été installée manuellement sur le serveur, la désactiver **avant** la mise à jour avec `systemctl disable --now runtipi-lobehub-init-cleanup.timer`.

Pour vérifier le résultat : `docker ps -a --filter "label=com.docker.compose.project=lobehub_appstore-ajilis"` ; dix services `Up` doivent apparaître. Les initialiseurs doivent être `healthy` après succès.

## Installation initiale

1. Dans Runtipi, actualiser le store `https://github.com/Ajilis/runtipi-appstore`, puis installer **LobeHub**.
2. Remplir `LOBE_LAN_ORIGIN` (`http://IP_DU_SERVEUR:8292`). Laisser `LOBE_PUBLIC_URL` vide jusqu'à la mise en service du tunnel Cloudflare.
3. Dans **E-mail du premier administrateur global**, indiquer votre adresse e-mail ; saisir un **mot de passe initial de 12 à 64 caractères** dans le champ Runtipi dédié. Le mot de passe doit rester confidentiel.
4. Démarrer l'application. Les services `lobehub-admin-precheck`, `lobehub-admin-register`, `lobehub-admin-promote` s'exécutent **avant** le démarrage de la passerelle publique. Si la base est vide, le premier compte est créé par une requête Better Auth interne, puis reçoit le rôle `admin` Better Auth **et** le rôle global `super_admin` RBAC, avec les permissions existantes. Les données et les secrets restent persistants.
5. Après vérification du fonctionnement local, dans Cloudflare Zero Trust → Tunnels → Public Hostnames, créer un **seul hostname** `lobe.exemple.fr` → HTTP `http://IP_DU_SERVEUR:8292`. Renseigner ensuite ce hostname comme `LOBE_PUBLIC_URL` dans Runtipi et redémarrer l'application.
6. Se connecter à `http://IP_DU_SERVEUR:8292/signin` avant la création du tunnel, puis à `https://lobe.exemple.fr/signin` une fois le tunnel actif, avec les identifiants configurés.

### Si LobeHub était déjà installé

- **Ne pas supprimer ou réinitialiser les volumes, secrets Better Auth, mots de passe PostgreSQL/S3, ni `config/jwks.json`.**
- Renseigner comme `LOBE_ADMIN_EMAIL` **l'e-mail d'un utilisateur qui existe déjà** dans la base. Le compte existant est élevé administrateur global : **son mot de passe n'est pas modifié**. Le champ de mot de passe initial Runtipi n'est utilisé que si la base est vide.
- S'il existe déjà des comptes mais aucun ne correspond à l'e-mail configuré, l'initialisation échoue volontairement et la passerelle publique ne démarre pas. Corriger l'e-mail dans Runtipi ; ne pas supprimer les données pour contourner ce contrôle.
- La liste `LOBE_ALLOWED_EMAILS` de l'ancienne révision n'est plus utilisée : les créations de comptes sont désormais contrôlées par l'API administrateur et non par une inscription publique.

## Comptes : page d'administration

Après connexion avec l'administrateur global, ouvrir **`https://lobe.exemple.fr/_runtipi_admin/`** (ou `http://IP_DU_SERVEUR:8292/_runtipi_admin/` sur le LAN). Il s'agit d'une **interface complémentaire, fournie par le paquet Runtipi**, pas d'un écran natif de LobeHub.

- Cette page vérifie la session actuelle Better Auth et n'affiche les actions de gestion qu'aux comptes ayant le rôle `admin`.
- L'API native `GET /api/auth/admin/list-users` permet de voir les comptes, et `POST /api/auth/admin/create-user` de créer un compte standard avec nom, e-mail et mot de passe provisoire. L'autorisation est vérifiée **côté serveur** par le plugin Better Auth `admin()` de LobeHub.
- La création d'un utilisateur standard **ne donne aucun droit d'administrateur**. Communiquer son mot de passe provisoire de manière sûre ; demander à l'utilisateur de le changer après connexion. Ce paquet ne comprend pas d'envoi d'e-mail automatique ni de procédure d'invitation par lien.
- L'accès public à `/api/auth/sign-up/*` est refusé par Nginx (`403`), et `/signup` redirige vers `/signin`. Une éventuelle mention « S'inscrire » encore affichée par le client LobeHub ne permet **pas** de créer un compte.
- La connexion par e-mail et mot de passe (`/api/auth/sign-in/email`) reste disponible. Les méthodes de création implicite de comptes par authentification anonyme et sociale ne sont pas activées sur cette installation. Les routes de connexion par code OTP et par magic link sont également refusées par la passerelle.

**Sécurité du premier compte :** aucun visiteur Internet ne peut « réclamer » le rôle admin en étant le premier à visiter le formulaire public. Le tout premier compte est provisionné par Runtipi à travers une requête **interne**, sans port LobeHub exposé. Le mot de passe initial figure dans les variables sécurisées de Runtipi : protéger les sauvegardes et accès à `app.env`. Le processus de provisionnement est idempotent : il ne réinitialise jamais le mot de passe d'un utilisateur déjà présent.

## Architecture réseau et RustFS

| Composant | Port publié sur le serveur | Accès |
| --- | --- | --- |
| `lobehub-s3-gateway` (Nginx) | **8292** | LAN + Cloudflare Tunnel |
| LobeHub | Aucun (3210 interne) | Docker uniquement |
| PostgreSQL / ParadeDB | Aucun (5432 interne) | Docker uniquement |
| Redis | Aucun (6379 interne) | Docker uniquement |
| RustFS S3 | **Aucun** (9000 interne) | Docker uniquement |
| Console RustFS | Aucun | Désactivée |

Aucun service n'utilise le routage Traefik (`traefik.enable=false`). Ne pas publier de port via NAT sur le routeur. Si le serveur possède plusieurs interfaces, définir `LOBE_BIND_IP` avec l'IP LAN ou utiliser un pare-feu ; `0.0.0.0` écoute sur toutes les interfaces. Pour cloudflared dans un conteneur séparé, `127.0.0.1` n'est pas l'IP de l'hôte Runtipi.

Les transferts S3 signés `GET`, `HEAD` et `PUT` utilisent `https://lobe.exemple.fr/lobe/<objet>?X-Amz-...`. Nginx refuse les accès S3 non signés et les opérations d'administration ; RustFS valide ensuite les signatures. Les anciens accès anonymes au bucket sont révoqués au démarrage. **Toute personne possédant une URL S3 signée valide peut accéder temporairement à l'objet concerné**, même si RustFS n'a pas de port publié. Pour rendre tout accès aux fichiers exclusivement authentifié par l'application, une modification plus profonde de LobeHub serait nécessaire.

Les navigateurs LAN doivent pouvoir accéder à `https://lobe.exemple.fr` pour les URL signées. La valeur canonique `APP_URL` peut déclencher des redirections HTTPS depuis le LAN. Cloudflare Access sur tout le hostname peut bloquer les téléchargements signés ou certaines requêtes CORS : vérifier les politiques Cloudflare si nécessaire. La taille des fichiers reste soumise aux limites du compte Cloudflare.

## Persistance et sauvegardes

| Emplacement sous `APP_DATA_DIR` | Contenu |
| --- | --- |
| `config/jwks.json` | Clé privée Better Auth/JWKS, créée une seule fois |
| `config/nginx-gateway-v3.conf` | Configuration de la passerelle Nginx, créée une seule fois |
| `config/runtipi-admin-v1.html` | Page de gestion des comptes, créée une seule fois |
| `config/runtipi-admin-state` | État du provisionnement admin |
| `postgres/` | Comptes, rôles `admin` / `super_admin`, agents, conversations |
| `redis/` | Cache et AOF Redis |
| `rustfs/` | Documents, images, pièces jointes |

Runtipi conserve également les variables sensibles. Sauvegarder ensemble les variables d'environnement et ces volumes. Pour une sauvegarde PostgreSQL cohérente, utiliser `pg_dump` ou arrêter la pile. Une mise à jour n'écrase pas les fichiers de configuration versionnés existants, ni les mots de passe utilisateurs.

## Tests après déploiement

1. Vérifier dans les journaux Docker que les services `lobehub-admin-precheck`, `lobehub-admin-register`, `lobehub-admin-promote` se terminent avec succès. En cas d'échec, la passerelle reste fermée : **ne pas supprimer la base de données**.
2. `curl -i -X POST http://IP_DU_SERVEUR:8292/api/auth/sign-up/email` doit retourner **403**. `curl -I http://IP_DU_SERVEUR:8292/signup` doit rediriger vers `/signin`.
3. Se connecter avec le premier compte, ouvrir `/_runtipi_admin/`, créer un utilisateur standard et vérifier qu'il peut se connecter sans pouvoir créer d'autres comptes.
4. Tester avec un utilisateur non administrateur : l'API `/api/auth/admin/create-user` doit refuser l'opération.
5. `curl -i http://IP_DU_SERVEUR:8292/lobe/test` doit retourner **403** sans URL S3 signée ; `docker ps` ne doit pas publier 8293. Tester ensuite un PDF et une image, leur lecture et leur téléchargement via l'URL publique.

**Limite de validation :** le code de LobeHub 2.3.2 confirme les routes Better Auth et le schéma PostgreSQL utilisés. La syntaxe des scripts JavaScript a été vérifiée ; en revanche aucun déploiement Docker, aucune création réelle de compte, aucune requête PostgreSQL de ce scénario et aucun test de bout en bout Cloudflare/RustFS n'ont pu être exécutés sur votre Runtipi. Installer cette révision après sauvegarde des données et vérifier les journaux.

Versions : LobeHub `2.3.2`, ParadeDB `0.26.5-pg17`, PostgreSQL helper `17-alpine`, Node.js helper `24-alpine`, Redis `7.4-alpine`, RustFS `1.0.4`, RustFS rc `v0.1.37`, Nginx `1.28-alpine`. Sans Agent Gateway, Device Gateway, SearXNG ni Elasticsearch.
