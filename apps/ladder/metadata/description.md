# Ladder — proxy HTTP pour tests et recherche

**Version 0.0.23**, licence GPL-3.0, projet [everywall/ladder](https://github.com/everywall/ladder). Ladder permet aux développeurs et chercheurs de tester le traitement des réponses Web (CORS, CSP, agent utilisateur et règles de transformation). N'utiliser que sur des sites et contenus pour lesquels le test est autorisé, dans le respect des lois et des conditions d'utilisation.

## Installer sur Runtipi 4.9.1

1. Ajouter l'App Store `https://github.com/Ajilis/runtipi-appstore` dans Runtipi, puis actualiser le catalogue.
2. Installer **Ladder** ; définir un identifiant et **un mot de passe fort** dans le formulaire. Ce sont des identifiants **HTTP Basic Auth**, pas un compte administrateur interne avec des rôles. Le mot de passe ne doit pas contenir `:` (séparateur de `USERPASS`).
3. Le champ **URL du jeu de règles** propose le jeu officiel. Facultatif : limiter les destinations avec **Domaines autorisés**, séparés par des virgules. Sans cette limitation, tout domaine est éligible.
4. Ouvrir `http://IP_DU_SERVEUR:8295/` depuis le LAN. Le navigateur affiche une boîte de connexion HTTP ; entrer les deux valeurs définies dans Runtipi. Saisir ensuite une URL à analyser, ou utiliser `/https://example.org`.

Le formulaire Runtipi transmet `LADDER_USERNAME` et `LADDER_PASSWORD` en `USERPASS=identifiant:mot_de_passe`. Il ne s'agit pas d'identifiants Runtipi. Les secrets sont conservés dans la configuration d'instance Runtipi (`app.env`) : sauvegarder ce fichier, sans l'ajouter au dépôt GitHub. Aucun compte ni base de données à initialiser.

## LAN et Cloudflare Tunnel (sans Traefik)

- Adresse LAN : `http://IP_DU_SERVEUR:8295/` ; conteneur sur `8080/tcp`.
- Cloudflare Zero Trust : créer un **hostname public** HTTPS, service d'origine **HTTP**, URL `http://IP_DU_SERVEUR:8295`. Par exemple `https://ladder.exemple.fr` (nom fictif).
- Si `cloudflared` fonctionne sur l'hôte (et non dans un autre conteneur), l'origine `http://127.0.0.1:8295` convient aussi. Depuis un conteneur séparé, son `127.0.0.1` n'est pas celui de l'hôte.
- Le port Docker `8295:8080/tcp` écoute par défaut sur les interfaces hôte ; le **pare-feu doit le limiter au LAN** et aux origines de confiance. Ne jamais rediriger le port sur la box. Activer **Cloudflare Access** devant l'interface publique ; Basic Auth reste indispensable.

Runtipi a `exposable: false`, et Compose a `traefik.enable: "false"` ; aucun routage Traefik. Le mélange HTTP LAN / HTTPS tunnel est utilisable, mais Basic Auth est envoyé sans chiffrement sur le LAN : n'utiliser que des réseaux locaux fiables. Il n'existe pas d'authentification applicative plus granulaire dans cette configuration.

## Règles, persistance et sauvegarde

Ladder est **sans état applicatif local** dans cette installation : pas de base, de comptes locaux, de volume de données ou de conteneur d'initialisation. À chaque démarrage, les règles sont chargées depuis l'URL `LADDER_RULESET_URL` (par défaut le projet [ladder-rules](https://github.com/everywall/ladder-rules)). Le contenu de la branche distante peut évoluer indépendamment de la version du conteneur ; pour un comportement reproductible, pointer vers une URL figée sur un commit.

Les **paramètres et secrets persistants** sont les valeurs `LADDER_*` du `app.env` géré par Runtipi, conservées hors conteneur. Sauvegarder les paramètres Runtipi et la configuration éventuelle du tunnel. Si vous avez personnalisé des fichiers de règles, les sauvegarder séparément et prévoir un override Runtipi adéquat ; cette recette ne monte aucun fichier de règles afin d'éviter les montages de fichier inexistants et les écrasements au démarrage.

## Mise à jour et dépannage

Actualiser le catalogue puis mettre Ladder à jour **sans le désinstaller** ; conserver l'instance `app.env` et ses secrets. La version de l'image Docker est fixée à `v0.0.23` et ne change pas automatiquement. Redémarrer depuis Runtipi après modification des variables. Vérifier le port 8295 libre sur l'hôte, l'état du conteneur `running`, puis les logs Runtipi/Docker si la page ou les règles ne chargent pas. Contrôler DNS et l'accès sortant HTTPS au jeu de règles. Il n'y a ni migration, ni service ponctuel pouvant provoquer `mixed container states`.

## Sécurité et limites

Ladder est un proxy pouvant solliciter des sites externes. **Ne jamais désactiver Basic Auth pour une instance exposée**. Restreindre idéalement les domaines autorisés, placer Cloudflare Access en amont, filtrer le port hôte et ne pas consigner les URL sensibles (`LOG_URLS=false`). Certaines protections anti-bots et restrictions de sites restent effectives. L'image officielle est construite sur une base distroless non-root ; ne pas y ajouter de scripts shell d'initialisation. Le service optionnel FlareSolverr n'est **pas** déployé, car non indispensable et plus exposé en surface d'attaque.

Logo : conversion JPEG du SVG officiel `assets/pigeon.svg` du projet Ladder (source sous licence GPL-3.0 du dépôt).
