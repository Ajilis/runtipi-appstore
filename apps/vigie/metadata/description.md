# Vigie Patrimoine

**Version du catalogue Runtipi : 5** · **Version de Vigie : 0.5.0** · **Runtipi minimum : 4.9.1**

## Nouveautés de la version 0.5.0 : établissements et logos

- **Suggestions dès la 3e lettre** dans le champ **Établissement** d'un avoir : vos établissements déjà utilisés d'abord, puis un catalogue de 73 établissements (banques, banques en ligne, néobanques, courtiers, assureurs et plateformes d'assurance-vie, gestion pilotée, épargne salariale, crypto, SCPI, métaux précieux). La recherche ignore les accents et les majuscules et reconnaît les anciens noms ou abréviations : « bourso » propose BoursoBank, « lyonnais » propose LCL. Choix à la souris, au doigt ou au clavier (flèches, Entrée, Échap). La saisie libre reste possible pour un établissement absent de la liste.
- **Pastille d'établissement** dans chaque avoir, le panneau d'un avoir, la mise à jour rapide et la répartition « Actifs par établissement » du tableau de bord.
- **Logos** : aucun logo n'est fourni avec Vigie. Pour un établissement du catalogue, votre serveur récupère l'icône publiée par son site officiel (adresse fixée dans le catalogue, jamais une adresse saisie) et la conserve dans la base. Sinon, ou si la récupération échoue, un **monogramme coloré** (initiales) s'affiche. Les logos manquants sont réessayés automatiquement après quelques jours, ou tout de suite depuis **Réglages → Sécurité du serveur**.
- **Confidentialité** : la récupération d'un logo est une simple requête vers le site public de l'établissement, sans aucune donnée personnelle. Pour qu'aucune connexion sortante ne soit faite, mettre `INSTITUTION_LOGOS=false` dans `data/config/vigie.env` puis redémarrer : seuls les monogrammes s'affichent.

## Nouveautés de la version 0.4.0 : application installable (PWA)

Vigie s'installe comme une application sur téléphone, tablette et ordinateur : icône sur l'écran d'accueil ou dans le menu des applications, ouverture dans sa propre fenêtre sans barre d'adresse, raccourcis **Mise à jour rapide** et **Avoirs** (appui long sur l'icône).

**Condition : une adresse HTTPS.** Les navigateurs n'autorisent l'installation qu'en connexion sécurisée. Utilisez l'adresse Cloudflare Tunnel (par exemple `https://patrimoine.exemple.fr`). Par l'adresse locale `http://IP_DU_SERVEUR:8289`, Vigie reste utilisable normalement dans le navigateur, sans installation.

| Appareil | Installation |
| --- | --- |
| Android (Chrome, Edge, Samsung Internet) | Bouton **Installer Vigie** dans **Mon compte**, ou menu ⋮ → **Installer l'application** |
| iPhone, iPad | Dans **Safari** : **Partager** → **Sur l'écran d'accueil** → **Ajouter** |
| Ordinateur (Chrome, Edge) | Bouton **Installer** de la barre d'adresse, ou **Installer Vigie** dans Mon compte |
| Mac (Safari) | Menu **Fichier** → **Ajouter au Dock** |

**Confidentialité.** Le service worker ne met en cache que l'interface (page, styles, scripts, polices, icônes). Les données de patrimoine, les exports et les sauvegardes ne sont jamais stockés sur l'appareil : sans connexion au serveur, Vigie affiche un écran « hors ligne » et se reconnecte automatiquement dès que le serveur répond.

**Cloudflare Access.** Si l'adresse publique est protégée par Cloudflare Access, le manifeste est demandé avec les cookies de session (`crossorigin="use-credentials"`) : connectez-vous une première fois dans le navigateur avant d'installer.

## Nouveautés de la version 0.3.0

- **Un pictogramme par catégorie**, choisi parmi 22 (portefeuille, carte, banque, espèces, tirelire, assurance, protection, bourse, retraite, entreprise, résidence, immeuble, crypto-actif, lingots, objets de valeur, véhicule, œuvre d'art, forêt et terres, autre, prêt immobilier, crédit, prêt entre proches). Il apparaît dans le tableau de bord, la liste des avoirs, la mise à jour rapide, le détail d'un avoir et les rappels. Les catégories existantes reçoivent automatiquement le pictogramme correspondant à leur nom ; il se change dans **Catégories → Modifier**.
- **Pictogrammes d'interface** : chiffres clés, niveaux de liquidité (disponible, court terme, bloqué), titres de sections, boutons, étiquettes (à actualiser, clôturé, taux manquant), rôles, actions du journal et messages de confirmation.
- **Initiales** des titulaires et des utilisateurs, et pictogramme d'établissement ou de devise dans les répartitions.

## Nouveautés de la version 0.2.0

- **Bouton « Modifier » d'un avoir corrigé.** Toutes les fenêtres ouvertes depuis une autre fenêtre s'affichent désormais : formulaire de modification, confirmations de clôture et de suppression, codes de secours après l'activation de la double authentification, gestion d'un utilisateur.
- **Titulaire en liste déroulante**, avec l'option « Nouveau titulaire… ». La liste se gère dans **Réglages → Titulaires** : ajouter, renommer (tous les avoirs suivent), fusionner deux titulaires en choisissant un nom existant, supprimer un titulaire inutilisé.
- **Prénom et nom** dans Mon compte, à l'installation et dans la gestion des utilisateurs. Les comptes existants sont repris automatiquement (« Alex Martin » devient Alex / Martin).
- **Interface responsive de 320 px à l'écran large**, vérifiée écran par écran : menu repliable sur téléphone et tablette, tableaux affichés en cartes, champs à 16 px (pas de zoom automatique sur iPhone), boutons de 44 px.

La mise à jour applique une migration additive de la base : aucune donnée n'est supprimée.

Vigie donne une vue globale et privée de votre patrimoine. Vous ne gérez aucun mouvement de compte : pour chaque avoir, vous saisissez simplement sa valeur à une date. Vigie calcule le reste.

## Ce que fait Vigie

- **Avoirs par catégorie** : comptes courants, épargne réglementée, assurance-vie, bourse, épargne retraite, épargne salariale, immobilier, crypto-actifs, métaux précieux, autres actifs. Catégories modifiables.
- **Patrimoine net** : les passifs (crédit immobilier, autres crédits) sont déduits des actifs.
- **Historique automatique** : chaque valeur saisie est conservée. Courbe d'évolution sur 3 mois à 3 ans, variations sur 1 mois, 1 an et depuis janvier.
- **Mise à jour rapide** : un écran pour actualiser tous les avoirs d'un coup, avec l'estimation du nouveau patrimoine avant d'enregistrer.
- **Rappels** : les avoirs dont la valeur date de plus de 45 jours (réglable) sont signalés « à actualiser ».
- **Allocation cible** : un pourcentage visé par catégorie, avec l'écart en euros.
- **Répartitions** : par catégorie, établissement (banque, courtier, assureur, plateforme), titulaire (la personne à qui appartient l'avoir : Moi, Conjoint, Commun ou tout autre nom de la liste), devise et liquidité (disponible, sous quelques semaines, bloqué).
- **Multi-devises** : taux saisis à la main ou récupérés auprès de la Banque centrale européenne.
- **Mode discret** : masque les montants à l'écran d'un clic.
- **Exports** : JSON complet, avoirs et historique en CSV (compatibles Excel et LibreOffice). Restauration d'un export JSON.
- **Sauvegardes** : copie quotidienne de la base, téléchargeable depuis Réglages.

## Contrôle d'accès

- Comptes personnels avec mot de passe (10 caractères minimum, haché avec scrypt).
- Trois rôles : **administrateur** (tout), **éditeur** (avoirs, valeurs, catégories, taux), **lecture seule** (consultation et export).
- **Double authentification** TOTP (Aegis, 2FAS, Google Authenticator, Bitwarden…) avec 10 codes de secours. Elle peut être rendue obligatoire pour tous depuis le formulaire Runtipi.
- Blocage temporaire du compte après 5 échecs, limitation par adresse IP, déconnexion après 2 h d'inactivité.
- Sessions visibles et révocables, journal des connexions et des modifications.
- Le **premier compte ne peut être créé que depuis le réseau local**, jamais à travers Cloudflare Tunnel.
- En-têtes de sécurité stricts (CSP, anti-iframe), protection CSRF, cookies `HttpOnly` et `SameSite=Strict`.

## Installation

1. Dans **Runtipi → Settings → App Stores**, actualiser `https://github.com/Ajilis/runtipi-appstore`.
2. Installer **Vigie Patrimoine**. Le port local est **8289**. Le secret est généré par Runtipi. Cocher **Double authentification obligatoire** si Vigie sera accessible par Cloudflare Tunnel.
3. Laisser l'adresse d'écoute à `0.0.0.0` pour l'accès local et par le tunnel.
4. Ouvrir **`http://IP_DU_SERVEUR:8289` depuis le réseau local** et créer le compte administrateur.
5. Dans Cloudflare Tunnel, créer un *Public Hostname* (par exemple `patrimoine.exemple.fr`) vers le service HTTP `http://IP_DU_SERVEUR:8289`, ou `http://127.0.0.1:8289` si `cloudflared` tourne sur le serveur en réseau hôte. Ne pas renseigner l'option « HTTP Host Header ».

Aucune exposition par domaine ni exposition locale Traefik n'est proposée (`exposable: false`) : le port est publié directement par Docker et le conteneur n'est pas relié au réseau de Traefik. **Ne pas ouvrir le port 8289 sur la box.** Pour une protection supplémentaire, placer le nom de domaine public derrière Cloudflare Access.

## Données persistantes

Tout est dans le dossier de l'application Runtipi, `APP_DATA_DIR/data/` :

| Dossier | Contenu |
| --- | --- |
| `config/vigie.env` | Fichier de configuration, créé au premier démarrage puis jamais écrasé |
| `db/vigie.sqlite` | Base de données SQLite (avoirs, historique, comptes, journal) |
| `backups/` | Sauvegardes quotidiennes de la base, conservées 30 jours |

## Fichier de configuration

Modifier `APP_DATA_DIR/data/config/vigie.env`, puis redémarrer l'application dans Runtipi.

| Réglage | Par défaut | Rôle |
| --- | --- | --- |
| `SESSION_IDLE_MINUTES` | 120 | Déconnexion après inactivité |
| `SESSION_MAX_HOURS` | 72 | Durée maximale d'une session |
| `LOGIN_MAX_ATTEMPTS` | 5 | Échecs avant blocage du compte |
| `LOGIN_LOCK_MINUTES` | 15 | Durée du blocage |
| `IP_MAX_FAILURES` | 20 | Échecs tolérés par adresse IP sur 15 min |
| `REQUIRE_2FA` | false | Double authentification obligatoire |
| `SESSION_COOKIE_SECURE` | auto | Cookie `Secure` seulement en HTTPS, pour garder la connexion par `http://IP:8289` |
| `TRUST_CLOUDFLARE_HEADERS` | true | Adresse IP réelle des visiteurs via `CF-Connecting-IP` |
| `ALLOW_SETUP_THROUGH_TUNNEL` | false | Autoriser la création du premier compte via Cloudflare |
| `BACKUP_HOUR` | 3 | Heure de la sauvegarde quotidienne |
| `BACKUP_KEEP_DAYS` | 30 | Durée de conservation (0 désactive) |
| `ECB_RATES_ENABLED` | true | Bouton de récupération des taux BCE |
| `INSTITUTION_LOGOS` | true | Logos des établissements récupérés sur leur site officiel (false : monogrammes uniquement) |
| `LOG_LEVEL` | info | Détail des journaux du conteneur |

## Mises à jour et sauvegardes

Les évolutions de la base sont des migrations additives, appliquées automatiquement au démarrage. Avant une mise à jour, faire une sauvegarde Runtipi ou télécharger la dernière sauvegarde depuis **Réglages → Sauvegardes de la base**. Ne jamais changer le secret de l'application après l'installation : les doubles authentifications enregistrées deviendraient illisibles.

Image Docker : `ghcr.io/ajilis/vigie` (amd64 et arm64), construite par GitHub Actions depuis [`sources/vigie`](https://github.com/Ajilis/runtipi-appstore/tree/main/sources/vigie).
