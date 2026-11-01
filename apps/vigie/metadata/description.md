# Vigie Patrimoine

## Nouveauté 0.9.9 — Plus-values latentes multi-actifs

Pour les actifs non immobiliers éligibles (or, métaux précieux, cryptomonnaies, bourse et autres placements), renseignez facultativement le **prix de revient total** et la **date d'acquisition** dans la fiche de l'avoir. Vigie affiche le gain ou la perte latent(e) brut(e) dans le détail de l'avoir et dans une synthèse sur la page **Avoirs**. Les montants sont inclus dans les exports CSV et les sauvegardes/restaurations JSON. L'immobilier conserve son calcul par quote-part.

Les résultats restent indicatifs : aucun calcul fiscal, aucun mouvement d'achat/vente, et aucun prix de revient supposé pour les anciens avoirs.

**Version du catalogue Runtipi : 8** · **Version de Vigie : 0.8.0** · **Runtipi minimum : 4.9.1**

## Nouveautés de la version 0.8.0 : e-mails, invitations et mot de passe oublié

### Envoi d'e-mails (Réglages → Envoi d'e-mails, administrateurs)

- Renseignez le **serveur SMTP** de votre messagerie ou de votre hébergeur : serveur, port, sécurité (**STARTTLS** sur le port 587, **SSL/TLS** sur le port 465, ou **aucune** pour un relais de votre réseau local), identifiant, mot de passe, adresse et nom d'expédition.
- **Préréglages** : en choisissant smtp.gmail.com, smtp.mail.me.com (iCloud), ssl0.ovh.net, smtp.free.fr, smtp.orange.fr, smtp.sfr.fr ou smtp-relay.brevo.com, le port et la sécurité se remplissent et un conseil s'affiche (Gmail et iCloud exigent un **mot de passe d'application**).
- **Envoyer un e-mail de test** avant même d'enregistrer. En cas d'échec, Vigie explique la cause : serveur introuvable, port bloqué, mauvais mode de sécurité, certificat refusé, identifiant ou mot de passe refusé, expéditeur non autorisé.
- **Adresse de Vigie dans les liens** : l'adresse qu'ouvriront vos invités, par exemple `https://patrimoine.exemple.fr` (Cloudflare Tunnel). Les liens des e-mails utilisent toujours cette adresse enregistrée, jamais celle de la requête.
- Le mot de passe SMTP est **chiffré dans la base** avec le secret de l'application et n'est jamais réaffiché.

### Invitations par e-mail (Utilisateurs → Inviter par e-mail)

- Indiquez l'adresse, éventuellement le prénom et le nom, et le rôle. La personne reçoit un e-mail avec le bouton **Créer mon compte** : elle choisit son nom d'utilisateur et son mot de passe, puis arrive directement connectée (et active la double authentification si elle est obligatoire).
- Le lien est **valable 7 jours et ne sert qu'une fois**. Les **invitations en attente** sont listées : renvoyer l'e-mail, créer un nouveau lien (l'ancien cesse de fonctionner) ou annuler.
- Sans serveur SMTP, ou pour passer par une messagerie instantanée, créez un **lien à transmettre vous-même**.
- « Ajouter directement » (avec un mot de passe provisoire) reste possible.

### Mot de passe oublié

- Lien **« Mot de passe oublié ? »** sur l'écran de connexion, dès que l'envoi d'e-mails est configuré : l'utilisateur indique son nom d'utilisateur ou son adresse et reçoit un lien **valable 1 heure, à usage unique**. Une nouvelle demande remplace le lien précédent.
- Protections : réponse identique que le compte existe ou non, 5 demandes au plus par adresse IP et par quart d'heure, une demande par minute et par compte, rien n'est envoyé à un compte désactivé. Après le changement, **toutes les sessions sont fermées** et un **e-mail d'avis** est envoyé. La double authentification reste demandée à la connexion.
- **Adresse e-mail des utilisateurs** : dans Mon compte (le mot de passe actuel est demandé pour la changer) et dans la gestion des utilisateurs. L'administrateur peut aussi **envoyer un lien de réinitialisation** à un utilisateur.

Le conteneur doit pouvoir joindre votre serveur SMTP. Beaucoup de fournisseurs d'accès bloquent le port 25 vers Internet : préférez 587 ou 465.

## Nouveautés de la version 0.7.0 : logos des établissements

- **Logos en couleur pour presque tout le catalogue.** Vigie ne fournit toujours aucun logo : votre serveur récupère l'icône publiée par le site officiel de chaque établissement. La recherche est plus complète (icônes d'application déclarées dans le manifeste du site, apple-touch-icon, tuile Windows, icônes intégrées à la page, favicon) et Vigie garde la plus nette d'après ses dimensions réelles.
- **Dernier recours : service d'icônes de Google.** Certains sites bloquent les serveurs ou n'offrent qu'une icône de 16 px. Dans ce cas, Vigie demande l'icône du site au service d'icônes de Google, qui ne reçoit que le nom de domaine de l'établissement (par exemple `www.revolut.com`), jamais vos données. Pour l'interdire : `INSTITUTION_LOGOS_FALLBACK=false` dans `data/config/vigie.env`.
- **Préchargement** : les logos des 72 établissements du catalogue sont recherchés peu après le démarrage puis chaque jour, pour s'afficher immédiatement partout, y compris dans les suggestions du champ Établissement. Les logos des versions précédentes sont améliorés automatiquement.
- **Nouvelle page Réglages → Logos des établissements** (administrateurs) : état de chaque logo (officiel avec sa taille et sa provenance, image personnelle, introuvable), filtres « Mes établissements » et « Sans logo », recherche d'un logo à la demande, et recherche de tous les logos manquants avec progression.
- **Image personnelle** pour n'importe quel établissement, y compris un établissement absent du catalogue (« Banque du village », une SCI, un notaire) : PNG, JPEG, WebP ou SVG, réduite à 256 px par le navigateur avant l'envoi. Elle remplace le logo récupéré pour tous les utilisateurs et est incluse dans l'export JSON et la restauration.

Mesure faite depuis un serveur GitHub (hors de France) : 71 logos trouvés sur 72, dont 57 d'au moins 96 px. Quelques établissements ne publient qu'une petite icône (16 à 48 px) ; l'image personnelle permet d'en mettre une plus nette.

## Nouveautés de la version 0.6.0 : prêts et crédits à échéancier

- **Nouvelle catégorie « Prêts accordés »** : l'argent prêté à un proche ou à une société (prêt familial, compte courant d'associé) est un actif, compté dans le patrimoine et classé « bloqué ». Elle est ajoutée aux installations existantes, juste avant « Autres actifs », sauf si vous aviez déjà une catégorie de prêts ou de créances.
- **Échéancier automatique** : pour un prêt accordé ou un crédit (immobilier, auto, consommation), choisissez **Échéancier automatique** au lieu de **Saisie manuelle** et indiquez le montant, le taux annuel, la durée en mois et la date du versement (ou du déblocage). Vigie calcule seul, chaque mois, le capital restant : plus aucune valeur à saisir.
  - **Mensualités constantes** : la même somme chaque mois, arrondie au centime comme sur un tableau bancaire ; la dernière échéance solde les arrondis.
  - **In fine** : seuls les intérêts sont versés chaque mois, le capital est remboursé en une fois à la fin.
  - Taux à 0 % accepté (prêt familial sans intérêts).
- **Aperçu immédiat** pendant la saisie : mensualité, capital restant aujourd'hui, nombre d'échéances passées, dernière échéance et coût total des intérêts.
- **Panneau Échéancier** dans le détail de l'avoir : progression du remboursement, prochaine échéance (part d'intérêts et de capital), intérêts perçus ou payés à ce jour, et **tableau d'amortissement** complet (lignes passées grisées, prochaine échéance en évidence).
- **Partout dans Vigie** : la courbe, l'historique, le tableau de bord, les variations et l'export CSV de l'historique reprennent les valeurs calculées. Un avoir à échéancier n'est jamais signalé « à actualiser » et s'affiche sans champ dans la mise à jour rapide.
- **Remboursement anticipé ou renégociation** : modifiez l'échéancier avec le capital restant, la date de reprise et la durée restante. Les valeurs calculées jusque-là restent dans l'historique.
- **Retour en saisie manuelle** à tout moment, et **clôture** : les valeurs calculées jusqu'à cette date sont enregistrées, rien ne disparaît.
- Les échéanciers sont inclus dans l'**export JSON** et la **restauration**.

Limites : le calcul ne tient pas compte de l'assurance emprunteur, des frais, des différés d'amortissement ni des taux variables. Dans ces cas, passez en saisie manuelle et reportez le capital restant de votre tableau bancaire.

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

- **Avoirs par catégorie** : comptes courants, épargne réglementée, assurance-vie, bourse, épargne retraite, épargne salariale, immobilier, crypto-actifs, métaux précieux, prêts accordés, autres actifs. Catégories modifiables.
- **Patrimoine net** : les passifs (crédit immobilier, autres crédits) sont déduits des actifs.
- **Échéancier automatique** pour les prêts accordés et les crédits : capital restant calculé chaque mois à partir du montant, du taux, de la durée et de la date de versement.
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
- **Invitations par e-mail** (lien valable 7 jours, à usage unique) et **« Mot de passe oublié »** (lien valable 1 heure), une fois l'envoi d'e-mails configuré.
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
| `db/vigie.sqlite` | Base de données SQLite (avoirs, historique, échéanciers, comptes, invitations, réglages SMTP, journal) |
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
| `INSTITUTION_LOGOS` | true | Logos des établissements récupérés sur leur site officiel (false : aucune connexion sortante, images personnelles ou monogrammes) |
| `INSTITUTION_LOGOS_FALLBACK` | true | Si le site bloque ou n'offre qu'une petite icône, icône demandée au service d'icônes de Google (seul le nom de domaine de l'établissement est transmis) |
| `LOG_LEVEL` | info | Détail des journaux du conteneur |

## Mises à jour et sauvegardes

Les évolutions de la base sont des migrations additives, appliquées automatiquement au démarrage. Avant une mise à jour, faire une sauvegarde Runtipi ou télécharger la dernière sauvegarde depuis **Réglages → Sauvegardes de la base**. Ne jamais changer le secret de l'application après l'installation : les doubles authentifications enregistrées deviendraient illisibles.

Image Docker : `ghcr.io/ajilis/vigie` (amd64 et arm64), construite par GitHub Actions depuis [`sources/vigie`](https://github.com/Ajilis/runtipi-appstore/tree/main/sources/vigie).
