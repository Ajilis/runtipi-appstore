# Ajilis Runtipi App Store

## CloakBrowser — versions

| Composant | Version |
| --- | --- |
| Navigateur Chromium (version vérifiée via le serveur CDP) | `155.0.8059.39` |
| Image du conteneur Docker | `cloakhq/cloakbrowser:0.6.3` |
| Version du logiciel CloakBrowser (dans l'image) | `0.6.3` |
| Révision du catalogue Runtipi | `4` |
| Version minimale de Runtipi | `4.9.1` |

La version **Chromium 155.0.8059.39** a été confirmée sur l'instance Runtipi par `GET /json/version?fingerprint=test01` via le serveur CDP. Une vérification précédente, effectuée par lancement direct du navigateur, indiquait `146.0.7680.177`. Ces valeurs sont observées à des moments différents et ne constituent pas des versions figées par le Compose. La version Chromium peut évoluer indépendamment du tag de l'image Docker.

**Révision 4 (sauvegardes Runtipi) :** le lanceur nettoie les liens symboliques temporaires `SingletonLock`, `SingletonSocket` et `SingletonCookie` aux moments sûrs (démarrage, fin de session, arrêt gracieux), sans effacer les profils ni les bases SQLite. Délai d'arrêt Docker porté à `120s` pour faciliter une sauvegarde après l'arrêt du navigateur. [Procédure de mise à jour et de vérification](apps/cloakbrowser/metadata/description.md#correctif-sauvegarde-revision-runtipi-4).

Accès direct LAN : `http://IP_DU_SERVEUR:8291` ; Cloudflare Tunnel vers ce port HTTP, sans Traefik. **L'API CDP n'étant pas authentifiée**, restreindre le port au LAN et protéger impérativement l'hôte public avec Cloudflare Access. Configuration et profils persistants.

Fichiers : [Docker Compose](apps/cloakbrowser/docker-compose.yml) · [Configuration Runtipi](apps/cloakbrowser/config.json) · [Documentation de CloakBrowser](apps/cloakbrowser/metadata/description.md).

---
**Vigie Patrimoine V3 (0.3.0)** : pictogrammes dans toute l'application, dont un pictogramme au choix par catégorie (22 dessins), repris dans le tableau de bord, les avoirs et la mise à jour rapide. [Documentation](apps/vigie/metadata/description.md).

**Vigie Patrimoine V2 (0.2.0)** : bouton Modifier d'un avoir et fenêtres imbriquées corrigés, Titulaire en liste déroulante gérée dans Réglages, prénom et nom des utilisateurs, interface responsive de 320 px à l'écran large. [Documentation](apps/vigie/metadata/description.md).

**Vigie Patrimoine (0.1.0)** : nouvelle application de suivi de patrimoine personnel sur le port LAN **8289**, sans Traefik ; Cloudflare Tunnel via HTTP local. Avoirs par catégorie sans gestion des mouvements, historique, passifs, contrôle d'accès avec double authentification. [Installation](#installer-vigie-patrimoine-suivi-de-patrimoine-cloudflare-tunnel-sans-traefik).

**Postiz complet (Temporal + Elasticsearch)** — nouvelle entrée `postiz` sur le port LAN **8287**, sans Traefik ; Cloudflare Tunnel via HTTP local. [Installation](apps/postiz/metadata/description.md).

**Rendevo V38 (0.2.27)** : suppression du secteur et du bloc informatif de la recherche web publique ; prompt IA sur les trois champs restants, sans secteur caché issu de la campagne. [Documentation](sources/rendevo/README.md).

**Rendevo V37 (0.2.26)** : nouveau prompt compact pour la baguette magique basé sur les champs de recherche et sortie JSON `value/label/keywords`, affichée directement sous forme de tags de postes. [Documentation](sources/rendevo/README.md).

**Rendevo V36 (0.2.25)** : recherche publique simplifiée sans tableau de fonctions suggérées par l'IA ; affichage conservé en tags colorés et champs de recherche empilés verticalement. [Documentation](sources/rendevo/README.md).

**Rendevo V35 (0.2.24)** : recherche publique LinkedIn avec tags de postes IA colorés et supprimables individuellement ; plusieurs tags se combinent en un `OR` explicite dans le dork final et ses pages suivantes. [Documentation](sources/rendevo/README.md).

**Rendevo V34 (0.2.23)** : connecteur Vultr Serverless Inference vérifié avec sa documentation : découverte des modèles texte, `max_completion_tokens`, limitation du raisonnement et détection du changement silencieux de modèle. [Documentation](sources/rendevo/README.md).

**Rendevo V33 (0.2.22)** : amélioration de la baguette magique IA sur les API OpenAI compatibles : demandes plus courtes, secours automatique en cas de coupure/timeout et diagnostics réseau/HTTP sûrs. [Documentation](sources/rendevo/README.md).

**Rendevo V32 (0.2.21)** : correctif de compatibilité de la baguette magique avec les réponses JSON, tableaux Markdown et sorties tronquées des modèles OpenAI compatibles ; nouvelle tentative courte et diagnostics clairs sans fuite de clé. [Documentation](sources/rendevo/README.md).

**Rendevo V31 (0.2.20)** : baguette magique IA près de « Poste recherché », tableau structuré des fonctions, variantes et liens avec le mot-clé ; sélection en menu déroulant avant recherche, sans import automatique. [Documentation](sources/rendevo/README.md).

**Rendevo V30 (0.2.19)** : connecteur IA OpenAI compatible générique avec liste des modèles `GET /models`, sélection, test non destructif `/chat/completions` et enregistrement sécurisé des identifiants. [Documentation](sources/rendevo/README.md).

**Rendevo V29 (0.2.18)** : recherche publique DeGoog paginée ou en défilement infini, choix conservés entre pages et import manuel jusqu'à **200 contacts** à la fois. [Documentation](sources/rendevo/README.md).

**Rendevo V28 (0.2.17)** : pictogrammes modifier/supprimer les campagnes avec confirmation par saisie du nom et suppression logique conservant les données ; recherche web publique par dorks LinkedIn via DeGoog avec diagnostic affiché. [Documentation](sources/rendevo/README.md).

**Rendevo V27 (0.2.16)** : **migrations PostgreSQL additives, immuables et transactionnelles** ; intégrité SHA-256, tests CI de non-régression sur une ancienne base remplie et conservation des volumes Runtipi. [Documentation des sauvegardes et mises à jour](sources/rendevo/README.md).

**Rendevo V26 (0.2.15)** : **Tester la connexion** dans Réglages → Recherche vérifie l’instance DeGoog et sa clé API avant d’activer Enregistrer ; preuve serveur à usage unique, aucune modification pendant le test. [Documentation](sources/rendevo/README.md).

**Rendevo V25 (0.2.14)** : Chrome Companion affiche désormais la version de Rendevo connectée ; le moteur de prospection web se configure dans **Réglages → Recherche** par URL DeGoog et clé API Bearer facultative. [Documentation du serveur](sources/rendevo/README.md).

**Rendevo V24 (0.2.13)** : **première association Chrome Companion minimaliste** (un champ de code + un bouton), suppression des textes techniques et des messages de dissociation résiduels sur l’écran non connecté. [Documentation Companion](sources/rendevo/extension/README.md).

**Rendevo V23 (0.2.12)** : téléchargement d'un **Companion Chrome personnalisé à ton serveur** ; accès au seul hôte Rendevo déclaré à l'installation, plus de demande d'autorisation lors de l'association par code. [Installer Companion](sources/rendevo/extension/README.md).

**Rendevo V22 (0.2.11)** : association Chrome Companion avec **un seul code à copier-coller** (adresse du serveur + secret temporaire), autorisation Chrome limitée au serveur indiqué. [Documentation du Companion](sources/rendevo/extension/README.md).

**Rendevo V21 (0.2.10)** : version du produit sur la connexion et la barre latérale, bouton pour renommer les campagnes, et version Chrome Companion affichée dans la liste des comptes LinkedIn et des extensions associées. [Voir la documentation Rendevo](sources/rendevo/README.md).

**Rendevo V20 (0.2.9)** : Chrome Companion peut lire sur clic les liens des profils de la page de recherche LinkedIn Personnes affichée dans Chrome, puis les prévisualiser pour import confirmé (sans cookies ni navigation automatique). Voir [les instructions](sources/rendevo/extension/README.md).

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

**Version du catalogue Runtipi : 9** · **Version du logiciel : Zammad 7.2.2**. La v9 n'apporte qu'une amélioration de la visibilité du numéro de version dans la description de l'application et ne modifie pas le Docker Compose ni les volumes persistants.

1. Dans **Runtipi → Settings → App Stores**, actualiser `https://github.com/Ajilis/runtipi-appstore`.
2. Installer ou mettre à jour **Zammad**, renseigner `ZAMMAD_DOMAIN`, et conserver le mot de passe PostgreSQL existant en cas de mise à jour.
3. Configurer un *Public Hostname* Cloudflare vers `http://127.0.0.1:8285` (si cloudflared est sur le même serveur en réseau hôte).
4. Ouvrir le domaine public en HTTPS. Aucune exposition Traefik ni aucun réglage `vm.max_map_count` lié à Elasticsearch n'est nécessaire.

**Différence avec l'ancienne version :** le service Elasticsearch et son volume déclaré ont été retirés du Compose, et `ELASTICSEARCH_ENABLED=false` est appliqué à Zammad. La recherche plein texte indexée peut être indisponible. Sauvegarder les données avant une mise à jour ; ne pas supprimer les volumes PostgreSQL ou le stockage utilisateur.

**Ports :** Chatwoot `8284`, Zammad `8285`, Postiz `8286`, Rendevo `8288` et Vigie `8289`, chacun à associer à un nom de domaine Cloudflare distinct.

**Installation sécurisée (version du catalogue 9) :** Zammad préserve les données et les fichiers de configuration lors des mises à jour et conserve le précontrôle de récupération après une installation inachevée (sauvegarde PostgreSQL avant réinitialisation limitée au cas sans utilisateur ni ticket). Le port `8285:8080/tcp` est accessible sur le LAN (par exemple `http://192.168.1.16:8285/`) et avec Cloudflare Tunnel (`http://127.0.0.1:8285` si cloudflared utilise le réseau hôte). Les connexions applicatives sont prévues sur le domaine public HTTPS canonique ; une adresse IP HTTP peut être redirigée. Ne pas publier ce port sur Internet ; aucun Traefik applicatif. Le port reste fixe à 8285.

Logo Zammad issu de [la source officielle](https://github.com/zammad/zammad/blob/develop/logo.svg). Déploiement Runtipi réel à valider.

**Migration confirmée pour ancienne instance Zammad 6.5.0 PostgreSQL :** passage vers 7.2.2 nécessitant des migrations de base, à tester avant bascule des canaux. La documentation officielle recommande de préférence une restauration à version identique avant mise à niveau. Détails et précautions dans le guide ci-dessous.

**Migration Debian/Ubuntu → Runtipi :** la version 8 (toujours incluse dans la v9) corrige l'ordre de démarrage pour permettre à `zammad-backup` de restaurer les archives du paquet avant `zammad-init`. La restauration n'est activée qu'après dépôt intentionnel des archives officielles dans `data/backup/restore/`. Elle remplace les données de destination : effectuer une sauvegarde avant toute migration. [Procédure complète](apps/zammad/metadata/migration-debian.md).

## Installer Postiz sans Elasticsearch (Cloudflare Tunnel)

1. Dans **Runtipi → Settings → App Stores**, actualiser ce catalogue : `https://github.com/Ajilis/runtipi-appstore`.
2. Installer **Postiz (sans Elasticsearch)** (identifiant `postiz-lite`, port local **8286**). Renseigner l'**URL publique HTTPS** exacte, par exemple `https://postiz.exemple.fr` (sans slash final).
3. Dans Cloudflare Tunnel, faire pointer le *Public Hostname* vers `http://127.0.0.1:8286` si `cloudflared` s'exécute sur le même hôte avec accès à la boucle locale. Sinon adapter le routage réseau du tunnel.
4. **Ne pas exposer le port 8286 sur Internet.** Laisser les inscriptions activées le temps de créer le premier compte, puis cocher **Désactiver les inscriptions Postiz** dans la configuration de l'application.
5. Configurer ensuite les identifiants des réseaux sociaux (OAuth/API) selon les plateformes voulues.

Cette version comprend **5 conteneurs** : Postiz, PostgreSQL Postiz, Redis, Temporal et PostgreSQL Temporal. **Aucun Elasticsearch** : Temporal utilise PostgreSQL pour sa base de visibilité. Les données persistent dans `APP_DATA_DIR`. Elle est destinée à une **nouvelle installation** ; une migration depuis une configuration Temporal/Elasticsearch existante nécessite un plan de sauvegarde. L'image Postiz est actuellement basée sur le tag `latest`, à surveiller avant les mises à jour.

Documentation de l'application : [`apps/postiz-lite/metadata/description.md`](apps/postiz-lite/metadata/description.md).

## Installer Rendevo (agent IA de prospection LinkedIn, Cloudflare Tunnel, sans Traefik)

**Version du catalogue Runtipi : 19** · **Version du logiciel : Rendevo 0.2.8**

Rendevo qualifie vos prospects LinkedIn selon votre cible et leurs signaux d'achat, écrit dans votre style, relance, répond avec un setter IA et réserve les rendez-vous dans vos créneaux libres. Deux conteneurs : l'application (Node.js, image `ghcr.io/ajilis/rendevo`) et PostgreSQL 17.

1. **Image Docker :** elle est construite par GitHub Actions (`.github/workflows/rendevo-image.yml`) à chaque modification de `sources/rendevo/`. Au premier passage, vérifier dans **GitHub → Packages → rendevo → Package settings** que la visibilité est **Public**, sinon Runtipi ne pourra pas télécharger l'image.
2. Dans **Runtipi → Settings → App Stores**, actualiser `https://github.com/Ajilis/runtipi-appstore`, puis installer **Rendevo** (port local **8288**).
3. Renseigner l'**URL publique** exacte du tunnel, par exemple `https://rdv.exemple.fr` (sans slash final). Le secret de l'application et le mot de passe PostgreSQL sont générés par Runtipi.
4. Dans Cloudflare Tunnel, créer un *Public Hostname* `rdv.exemple.fr` vers `http://IP_LAN_DU_SERVEUR:8288` (ou `http://127.0.0.1:8288` si `cloudflared` tourne sur l'hôte en réseau hôte).
5. Accès local : `http://IP_LAN_DU_SERVEUR:8288`. Le premier compte créé devient administrateur ; un assistant configure l'offre, la cible, la voix, le compte LinkedIn (bac à sable, Unipile ou manuel) et les disponibilités.
6. Ne pas ouvrir le port 8288 sur le routeur. Aucun port PostgreSQL n'est publié et aucun routage Traefik n'est utilisé (`exposable: false`).

Données persistantes dans `APP_DATA_DIR/data/` : `config/rendevo.yml` (fichier de configuration créé au premier démarrage : budgets LinkedIn, rythme d'envoi, IA par défaut), `uploads/` (vidéos et documents) et `postgres/` (base de données). Ne jamais changer le secret de l'application après l'installation.

Le connecteur optionnel **Mon LinkedIn (cookie)** vérifie la session uniquement sur clic « Tester » et affiche le nom, la photo disponible et le lien du profil de son propre compte à partir des informations de profil enregistrées de votre propre compte avec `li_at` et `JSESSIONID`, enregistrés chiffrés. Il ne réalise pas de prospection automatique ; l'utilisation de cookies copiés est interdite par LinkedIn et peut entraîner une restriction du compte.

Documentation : [`apps/rendevo/metadata/description.md`](apps/rendevo/metadata/description.md) · Sources et feuille de route : [`sources/rendevo`](sources/rendevo/README.md).

**À valider :** l'image est construite automatiquement après le push ; le déploiement sur une instance Runtipi réelle reste à tester. L'automatisation de LinkedIn par un service tiers est restreinte par les conditions de LinkedIn : utiliser des budgets prudents et la pause en un clic.

## Installer Vigie Patrimoine (suivi de patrimoine, Cloudflare Tunnel, sans Traefik)

**Version du catalogue Runtipi : 3** · **Version du logiciel : Vigie 0.3.0** · **Runtipi minimum : 4.9.1**

Vigie donne une vue globale de votre patrimoine sans gérer les mouvements : une valeur par avoir et par date. Patrimoine net (passifs déduits), historique et variations, répartition par catégorie, établissement, titulaire, devise et liquidité, allocation cible, mise à jour rapide, rappels, multi-devises (taux BCE), mode discret, exports et sauvegardes. Un seul conteneur (Node.js + SQLite, image `ghcr.io/ajilis/vigie`).

1. **Image Docker :** construite par GitHub Actions (`.github/workflows/vigie-image.yml`) à chaque modification de `sources/vigie/`. Au premier passage, vérifier dans **GitHub → Packages → vigie → Package settings** que la visibilité est **Public**, sinon Runtipi ne pourra pas télécharger l'image.
2. Dans **Runtipi → Settings → App Stores**, actualiser `https://github.com/Ajilis/runtipi-appstore`, puis installer **Vigie Patrimoine** (port local **8289**). Le secret est généré par Runtipi ; cocher **Double authentification obligatoire** si Vigie sera joignable par le tunnel.
3. Ouvrir **`http://IP_LAN_DU_SERVEUR:8289` depuis le réseau local** pour créer le compte administrateur : par sécurité, le premier compte ne peut pas être créé à travers Cloudflare.
4. Dans Cloudflare Tunnel, créer un *Public Hostname* (par exemple `patrimoine.exemple.fr`) vers `http://IP_LAN_DU_SERVEUR:8289`, ou `http://127.0.0.1:8289` si `cloudflared` tourne sur l'hôte en réseau hôte.
5. Ne pas ouvrir le port 8289 sur le routeur. Le port est publié directement par Docker, sans service principal Runtipi ni réseau Traefik (`exposable: false`, `traefik.enable=false`).

**Contrôle d'accès :** rôles administrateur, éditeur et lecture seule ; double authentification TOTP avec codes de secours ; blocage après 5 échecs ; sessions révocables ; journal d'audit.

Données persistantes dans `APP_DATA_DIR/data/` : `config/vigie.env` (fichier de configuration créé au premier démarrage, jamais écrasé), `db/vigie.sqlite` (base de données) et `backups/` (sauvegardes quotidiennes). Ne jamais changer le secret de l'application après l'installation.

Documentation : [`apps/vigie/metadata/description.md`](apps/vigie/metadata/description.md) · Sources : [`sources/vigie`](sources/vigie/README.md).

**À valider :** Compose vérifié avec le code de Runtipi 4.9.1 et `docker compose config` ; le déploiement sur une instance Runtipi réelle reste à tester.
