# Vigie Patrimoine

Version 0.9.10 · application auto-hébergée pour [Runtipi](https://runtipi.io) · Node.js et SQLite, sans aucune dépendance npm.

Documentation d'installation Runtipi : [`apps/vigie/metadata/description.md`](../../apps/vigie/metadata/description.md).

## 1. Pourquoi Vigie ?

Savoir à tout moment **ce que l'on possède et ce que l'on doit**, tous établissements confondus, sans y passer ses soirées.

Un patrimoine est éparpillé : comptes courants et livrets dans plusieurs banques, assurance-vie, PEA, épargne salariale, crypto-actifs, or, résidence principale, crédits en cours, argent prêté à un proche. Pour en avoir une vue d'ensemble, on finit souvent avec un tableur qu'on oublie de tenir à jour, ou avec un agrégateur en ligne qui exige les identifiants de ses banques et conserve ses données chez un tiers.

Vigie prend le parti inverse :

- **Pas de mouvements à saisir.** On ne gère ni opérations ni budget : pour chaque avoir, on note simplement sa valeur à une date (relevé, estimation). Vigie conserve chaque valeur et en tire l'historique, les tendances et les répartitions. Une mise à jour mensuelle prend quelques minutes.
- **Privé et auto-hébergé.** Les données restent sur votre serveur, dans votre installation Runtipi. Aucun identifiant bancaire n'est demandé et aucun montant ne quitte votre serveur. Les seuls échanges avec l'extérieur (nom d'un établissement recherché, logos, taux de la BCE, adresse d'un bien quand vous demandez son estimation, adresse publique d'un portefeuille crypto et cours des crypto-actifs) sont décrits plus bas. L'application s'ouvre sur le réseau local ou à distance par Cloudflare Tunnel, avec double authentification.
- **Une vue globale et utile.** Patrimoine net (passifs déduits), évolution dans le temps, répartition par catégorie, établissement, titulaire, devise et liquidité, écart à l'allocation visée : de quoi décider d'un rééquilibrage, d'une épargne de précaution ou d'un remboursement anticipé.
- **Pensé pour un foyer.** Plusieurs comptes, et **chacun a son propre patrimoine** (avoirs, catégories, objectifs, réglages, journal) ; invitations par e-mail ; partage de n'importe quel avoir détenu à plusieurs (compte joint, bien en indivision, crédit à deux), chacun ne comptant que sa part.

Vigie n'est ni un logiciel de comptabilité, ni un outil de conseil financier ou fiscal : les estimations et plus-values affichées sont indicatives.

## 2. Fonctionnalités

### Avoirs et catégories

- **Avoirs** : un compte, un placement, un bien ou un crédit, avec son nom, sa catégorie, son établissement, son titulaire, sa devise, sa liquidité et des notes. Une valeur par date ; enregistrer une valeur à une date existante la remplace.
- **13 catégories par défaut, propres à chaque compte** : comptes courants, épargne réglementée, assurance-vie, bourse, épargne retraite, épargne salariale, immobilier, crypto-actifs, métaux précieux, prêts accordés, autres actifs, crédits immobiliers et autres crédits. Elles se renomment, se réordonnent et s'ajoutent librement (actif ou passif, liquidité par défaut, allocation cible, pictogramme parmi 22).
- **Titulaires** : Moi, Conjoint, Commun ou tout autre nom, en liste déroulante ; ajout, renommage, fusion et suppression dans Réglages.
- **Liste des avoirs** groupée par catégorie, avec recherche, mini-courbe, dernière mise à jour et variation. Un avoir se clôture (il sort des totaux, son historique reste) puis se rouvre, ou se supprime.
- **Détail d'un avoir** : valeur actuelle, courbe, historique complet des valeurs avec écarts, et saisie d'une nouvelle valeur.
- **Mise à jour rapide** : un seul écran pour actualiser tous les avoirs à une date, bouton « Inchangée », filtre « à actualiser » et estimation du nouveau patrimoine net avant d'enregistrer.
- **Rappels** : un avoir dont la valeur date de plus de 45 jours (réglable par chaque compte) est signalé « à actualiser ».
- **Montants au format 12.500,50 €** : un point sépare les milliers, une virgule les décimales, partout dans l'application, le journal et les notes d'estimation. À la saisie, « 12.500 », « 12 500 » et « 12500 » donnent le même montant ; « 12,5 » ou « 12.50 » restent des décimales. Les exports CSV gardent des nombres sans séparateur de milliers pour les tableurs.

### Tableau de bord

- **Patrimoine net**, total des actifs et des passifs, en devise de référence.
- **Variations** sur 1 mois, sur 1 an et depuis janvier.
- **Courbe d'évolution** sur 3 mois, 6 mois, 1 an, 3 ans ou depuis le début, avec infobulle.
- **Répartitions** par catégorie (avec l'**allocation cible** et l'écart en euros), par établissement, par titulaire et par devise.
- **Liquidité des actifs** : disponible, sous quelques semaines, bloqué ou illiquide.
- **Avoirs à actualiser** et **mode discret** qui masque tous les montants d'un clic.
- **Bilan patrimonial à imprimer** (1.5.0) : bouton **Bilan à imprimer** du tableau de bord. Une synthèse datée, à la date du jour ou à une date passée (au 1er janvier, au 31 décembre…), qui met en avant le **patrimoine net**, les **disponibilités liquides** et les **plus-values latentes**, puis actifs et passifs, variations, évolution sur 12 mois, actifs par catégorie avec l'allocation cible, liquidité, passifs, plus-values latentes, répartition par établissement, titulaire et devise, et détail de chaque avoir (valeur connue à la date, quote-part). **Imprimer ou enregistrer en PDF** depuis la fenêtre d'impression, en A4 paysage, en couleur avec les logos des établissements et des crypto-actifs, toujours en clair même en thème sombre.

### Prêts et crédits

- **Échéancier automatique** pour un prêt accordé (catégorie « Prêts accordés ») ou un crédit souscrit : à partir du montant, du taux, de la durée et de la date de versement, Vigie calcule chaque mois le capital restant, en **mensualités constantes** (fixes au centime, comme un tableau bancaire) ou **in fine**.
- Aperçu immédiat de la mensualité, du capital restant et du coût des intérêts ; **tableau d'amortissement** complet, prochaine échéance, intérêts perçus ou payés.
- **Remboursement anticipé ou renégociation** en modifiant l'échéancier, sans perdre l'historique ; retour à la saisie manuelle possible à tout moment.

### Immobilier

- **Valeur d'achat et date d'achat** distinctes de la **valeur actuelle**, qui est historisée.
- **Quote-part de propriété** de 0,01 % à 100 % : on saisit la valeur du bien entier, le patrimoine compte sa part.
- **Estimation sur demande** à partir des ventes DVF, via le service tiers GeoRegistry : valeur, fourchette et nombre de ventes comparables, compte rendu ajouté aux notes. L'adresse, le type, la surface et l'état ne sont transmis qu'au clic sur « Estimer ».
- **Plus-value latente brute** (valeur actuelle moins prix d'achat, à hauteur de la quote-part).

### Plus-values latentes des autres placements

- Pour l'or, la crypto, la bourse et les autres actifs, un **prix de revient** et une **date d'acquisition** facultatifs donnent le **gain ou la perte latente brute**, dans le détail de l'avoir et en synthèse sur la page Avoirs, convertis en devise de référence. Ni frais, ni fiscalité, ni mouvements ne sont modélisés.

### Crypto-actifs

- **Actif choisi dans une liste déroulante** : Bitcoin, Ether, USDC et USDT (réseau Ethereum), Solana, Litecoin, Dogecoin et XRP se suivent **par adresse blockchain** ; BNB, Cardano, Polkadot, Avalanche, TRON, Chainlink, Stellar, Cosmos et Monero **par quantité saisie**.
- **Par adresse** : Vigie lit la quantité détenue à l'adresse publique du portefeuille sur un explorateur public (mempool.space, litecoinspace.org, PublicNode pour Ethereum, RPC public Solana, BlockCypher, XRPL Cluster), puis la **valorise au cours du jour** (CoinGecko) dans la devise de l'avoir. Le format de l'adresse est vérifié à la saisie.
- **Actualisation automatique** à l'enregistrement, peu après le démarrage puis **toutes les 6 heures**, et à la demande (**Actualiser maintenant**). Une valeur par jour dans l'historique, avec la quantité et le cours en note (« Auto : 0,6221 BTC × 61.234,56 EUR ») ; la courbe et les totaux se mettent à jour seuls.
- **Détail de l'avoir** : actif, adresse abrégée avec lien vers l'explorateur, quantité, cours retenu, date et heure de la dernière actualisation. En cas d'échec (explorateur ou CoinGecko indisponible), le message s'affiche et la dernière valeur calculée est conservée.
- **Valeur à la main** toujours possible : on indique l'actif sans suivi automatique, comme avant.
- **Prix de revient (PRU)** (1.8.0) : achats et ventes datés, prix de revient unitaire moyen pondéré, plus-values latente et réalisée, quantité déduite des opérations en suivi par quantité, écart signalé en suivi par adresse.
- **Logo de l'actif** (1.6.0) sur la ligne de l'avoir, dans son détail et dans le formulaire, l'établissement restant en médaillon. Logo demandé une fois à CoinGecko puis servi par Vigie ; le symbole (BTC, ETH…) s'affiche en attendant.
- **Limites** : une adresse par avoir. Un portefeuille à plusieurs adresses (portefeuille HD, Ledger, Trezor…) se suit avec un avoir par adresse ou en quantité saisie. Les jetons hors réseau Ethereum (USDC sur Solana, par exemple) et les montants placés sur une plateforme d'échange se suivent en quantité.
- **Confidentialité** : seuls l'adresse publique et le nom de l'actif sont envoyés, jamais un montant, un nom ou une clé ; ne saisissez jamais de clé privée ni de phrase de récupération. Une adresse publique dévoile son solde à qui la connaît : l'explorateur interrogé voit l'adresse IP de votre serveur. L'administrateur coupe ces échanges dans **Réglages → Sécurité** (« Lire les soldes et les cours des crypto-actifs ») ou par `CRYPTO_LOOKUPS=false`.

### Établissements et logos

- **Suggestions dès la 3e lettre** dans le champ Établissement, sans tenir compte des accents ni des majuscules, y compris par ancien nom (« Boursorama » propose BoursoBank) ; saisie libre toujours possible.
- **Annuaire enrichi en direct** au-delà du catalogue embarqué de 73 établissements : OpenFinTech (liste quotidienne vérifiée par empreinte SHA-256), Wikidata et le registre public des entreprises (activités financières). Seul le texte recherché est envoyé à ces services, et les résultats restent disponibles si une source tombe.
- **Pastille d'établissement** dans les listes, les répartitions et la mise à jour rapide : icône carrée venant d'OpenFinTech, de Wikidata ou du site officiel (avec le service d'icônes de Google en dernier recours), sinon un monogramme coloré.
- **Logo complet** (souvent horizontal) affiché dans le détail d'un avoir.
- **Réglages → Établissements** : état du logo de chaque établissement, recherche à la demande, et **image personnelle** (PNG, JPEG, WebP ou SVG) pour n'importe quel établissement, même hors catalogue.
- Chaque source extérieure se désactive dans le fichier de configuration.

### Devises

- **Devise de référence** au choix parmi 30 devises ; avoirs dans n'importe laquelle d'entre elles.
- **Taux de change** communs à tous les comptes : récupérés auprès de la **Banque centrale européenne** par chacun, ou saisis à la main par l'administrateur ; un avoir sans taux est signalé. La devise de référence est commune au serveur.

### Comptes, foyer et partage

- **Un patrimoine par compte** : avoirs, catégories et allocation cible, titulaires, délai de rappel, tableau de bord, historique, journal, exports et restauration sont personnels. Les autres comptes, administrateur compris, ne voient ni vos avoirs ni vos montants, sauf ce que vous partagez.
- **Rôles** : **Utilisateur** (rôle par défaut : gère son propre patrimoine), **Administrateur** (son patrimoine, plus les comptes, les e-mails, la sécurité, les taux saisis à la main, les sauvegardes et les logos) et **Lecture seule** (ne crée rien, consulte les avoirs que d'autres comptes lui partagent). Supprimer un compte qui a des avoirs les supprime avec lui, après une seconde confirmation.
- **Invitations par e-mail** : la personne reçoit un lien valable 7 jours et à usage unique, choisit son identifiant et son mot de passe, puis arrive connectée. Sans e-mail, un lien peut être transmis à la main ; l'ajout direct avec un mot de passe provisoire reste possible.
- **Partage d'un avoir** avec un autre compte du serveur (compte joint, livret, assurance-vie, bien immobilier, crédit…) : bouton **Partager cet avoir** dans le détail de l'avoir, quote-part proposée (la moitié par défaut, ou la part non attribuée d'un bien en indivision). Le destinataire voit la demande **en haut de ses Avoirs et de son tableau de bord**, avec **Accepter** et **Refuser** (et un e-mail si l'envoi est configuré, que le titulaire peut **renvoyer** tant que la demande attend). Chaque avoir indique s'il est **partagé ou non**, avec qui, **depuis quand** et si le destinataire **a approuvé**, est **en attente** ou **a refusé** ; une étiquette le résume dans la liste. Après accord, chacun ne compte que sa part ; le destinataire voit l'avoir en lecture seule. Le partage se retire à tout moment.
- **Répartition visible et corrigeable** (1.4.0) : la demande de partage montre la répartition complète (vous, chaque personne, la part **hors Vigie** d'une personne sans compte ici) avant l'envoi. **Corriger la répartition**, dans le détail de l'avoir, modifie votre part et celle de chaque personne : votre part et les demandes non encore acceptées changent tout de suite ; une part **déjà acceptée ne change qu'avec l'accord de la personne** (proposition en haut de ses Avoirs avec Accepter et Refuser, et e-mail si l'envoi est configuré), la répartition actuelle restant en place d'ici là. La correction vaut pour tout l'historique et s'inscrit au journal de chacun. Filtre **Seulement les avoirs partagés** dans les Avoirs, avec la répartition sur chaque ligne.
- **Quote-part** : pour un compte joint ou un placement à deux, indiquez votre part (100 % par défaut) ; seule celle-ci entre dans votre patrimoine.
- **Mon compte** : prénom, nom, adresse e-mail, mot de passe, double authentification, sessions ouvertes (les connexions mémorisées y sont signalées), mon journal.
- **Rester connecté** : case sur l'écran de connexion, cochée par défaut dans l'application installée. La connexion est mémorisée sur l'appareil jusqu'à 30 jours sans utilisation (réglable, ou retirée, dans Réglages → Sécurité) et se prolonge à chaque usage ; sans la case, elle se ferme avec le navigateur ou après le délai d'inactivité.

### Sécurité et contrôle d'accès

- Mots de passe hachés avec **scrypt** ; **double authentification TOTP** (Aegis, 2FAS, Google Authenticator…) avec 10 codes de secours, facultative ou obligatoire pour tous.
- **Blocage** du compte après plusieurs échecs, **limitation par adresse IP**, déconnexion après inactivité, durée maximale de session, **sessions visibles et révocables**.
- **« Mot de passe oublié »** : lien valable 1 heure, réponse identique que le compte existe ou non, demandes limitées, sessions fermées et e-mail d'avis après le changement.
- **Journal** : chacun consulte le sien dans **Mon compte** ; celui de l'administrateur montre les connexions, la sécurité et l'administration de tous les comptes, sans le détail du patrimoine des autres.
- Le **premier compte ne peut être créé que depuis le réseau local**, jamais à travers Cloudflare Tunnel.
- Protection CSRF, en-têtes de sécurité stricts (CSP, anti-iframe), cookies `HttpOnly` et `SameSite=Strict`, `Secure` en HTTPS ; secrets TOTP et mot de passe SMTP chiffrés (AES-256-GCM).
- **Réglages → Sécurité** : durées de session, seuils de blocage, double authentification et logos modifiables par un administrateur, après confirmation de son mot de passe.

### E-mails

- **Serveur SMTP** au choix (STARTTLS, SSL/TLS ou relais local), préréglages Gmail, iCloud, OVHcloud, Free, Orange, SFR et Brevo, et **e-mail de test** avant d'enregistrer, avec des erreurs expliquées en clair.
- Messages envoyés : invitations, liens « Mot de passe oublié », avis de changement de mot de passe, propositions de partage. Les liens utilisent toujours l'adresse publique enregistrée.

### Données, exports et sauvegardes

- **Exports** de votre patrimoine : JSON complet (avoirs, historique, échéanciers, réglages), avoirs et historique en CSV (point-virgule et virgule décimale, ouverture directe dans Excel ou LibreOffice).
- **Restauration** de son propre export JSON par chaque compte, précédée d'une sauvegarde automatique : seuls ses avoirs, ses catégories et ses réglages sont remplacés, jamais ceux des autres comptes.
- **Sauvegardes quotidiennes** de la base (heure et durée de conservation réglables), téléchargeables depuis Réglages, incluses dans les sauvegardes Runtipi.
- Évolutions de la base par **migrations additives** appliquées au démarrage : aucune donnée n'est supprimée lors d'une mise à jour.

### Interface et application installable

- Interface en français, **responsive de 320 px à l'écran large** (menu repliable, tableaux en cartes sur téléphone, cibles tactiles de 44 px), **thème clair ou sombre** selon l'appareil, pictogrammes par catégorie.
- **Réglages en onglets** : Général, Titulaires, Devises, Établissements, Données, E-mails et Sécurité.
- **Application installable (PWA)** sur téléphone, tablette et ordinateur via l'adresse HTTPS : icône, raccourcis, fenêtre autonome. Seule l'interface est mise en cache, jamais les données ; écran hors ligne et reconnexion automatique.

### Installation et exploitation

- **Application Runtipi** (4.9.1 minimum), un seul conteneur, image `ghcr.io/ajilis/vigie` pour amd64 et arm64.
- **Accès réseau** : port 8289 publié directement, sans Traefik ; ouverture par `http://IP_DU_SERVEUR:8289` sur le réseau local et par **Cloudflare Tunnel** depuis l'extérieur.
- **Données persistantes** dans `APP_DATA_DIR/data/` : fichier de configuration `config/vigie.env`, base `db/vigie.sqlite` et `backups/`.

## 3. Documentation technique

### Architecture

- **Serveur** : Node.js 24, sans aucune dépendance npm (`node:http`, `node:crypto`, `node:sqlite`).
- **Base** : SQLite en mode WAL, `DATA_DIR/db/vigie.sqlite`. Migrations additives dans `server/db.js` : ne jamais modifier une migration publiée, en ajouter une nouvelle.
- **Interface** : application monopage en JavaScript natif (`web/app.js`), graphiques SVG faits main, police Public Sans auto-hébergée. Aucune ressource externe chargée par le navigateur.
- **Configuration** : variables `VIGIE_*` (formulaire Runtipi), puis `DATA_DIR/config/vigie.env`, puis valeurs par défaut (`server/config.js`).

| Fichier | Rôle |
| --- | --- |
| `server/index.js` | Démarrage, arrêt propre |
| `server/app.js` | Serveur HTTP, contrôle de session, rôles et CSRF, fichiers statiques |
| `server/routes.js` | API JSON |
| `server/auth.js` | Sessions, limitation des tentatives, défis de double authentification |
| `server/security.js` | scrypt, AES-256-GCM, TOTP (RFC 6238), codes de secours |
| `server/portfolio.js` | Calculs : valeurs à une date, totaux, répartitions, variations, historique |
| `server/loans.js` | Échéancier de prêt : tableau d'amortissement (mensualités constantes ou in fine), synthèse, valeurs mensuelles |
| `server/fx.js` | Taux de change de la BCE |
| `server/crypto.js` | Crypto-actifs : liste des actifs, contrôle des adresses, soldes lus sur les explorateurs publics (BigInt, sans arrondi), cours CoinGecko, valeur du jour et actualisation toutes les 6 heures |
| `server/backup.js` | Sauvegardes `VACUUM INTO` et rotation |
| `server/mail.js` | Envoi d'e-mails : client SMTP sans dépendance (STARTTLS, SSL/TLS, AUTH PLAIN ou LOGIN), message MIME UTF-8, modèles des e-mails |
| `server/logos.js` | Logos des établissements : images sourcées depuis OpenFinTech ou Wikimedia Commons, ou site officiel, image personnelle prioritaire, cache en base |
| `server/institutions.js` | Annuaire vivant : import OpenFinTech vérifié, recherche Wikidata et Sirene, cache SQLite, dédoublonnage et limitation des requêtes |
| `web/institutions.json` | Catalogue initial de secours (nom, type, alias, site officiel) |
| `web/` | Interface, police et générateur de QR code (MIT, voir `web/vendor`) |

### Modèle de données

- `categories` : actif ou passif, liquidité par défaut, allocation cible.
- `holdings` : un avoir (nom, établissement, titulaire, devise, liquidité, clôture).
- `valuations` : une valeur par avoir et par date (`UNIQUE(holding_id, valued_at)`), en centimes. La valeur d'un avoir à une date est la dernière valeur connue à cette date. Clôturer un avoir enregistre une valeur nulle.
- `loan_schedules` : échéancier facultatif d'un avoir (montant, taux annuel, durée en mois, date de versement, type). Les valeurs de l'avoir à partir de cette date ne sont pas stockées : elles sont calculées à la lecture (`loadState`) et fusionnées avec les valeurs saisies avant. Retirer l'échéancier ou clôturer l'avoir les enregistre dans `valuations`.
- `logo_cache` : icône récupérée par site (`host`), avec ses dimensions et sa provenance ; `ok = 0` mémorise un échec (nouvel essai après 3 jours).
- `institution_logos` : image déposée par l'administrateur, par identifiant du catalogue ou `perso-nom` pour un établissement hors catalogue ; prioritaire sur `logo_cache`.
- `institution_directory` : établissements ajoutés depuis les sources ouvertes, avec provenance, aliases, site et URL du logo. Les 73 entrées embarquées restent intactes.
- `crypto_holdings` (1.3.0) : suivi d'un crypto-actif par avoir : actif, mode (`address`, `quantity` ou `manual`), adresse ou quantité (chaîne décimale exacte), dernière quantité lue, dernier cours, dates de la dernière tentative et du dernier succès, dernière erreur. La valeur calculée est écrite chaque jour dans `valuations` (note « Auto : … »), une seule par date.
- `share_corrections` et `share_correction_items` (1.4.0) : correction de répartition d'un avoir partagé. La part du titulaire avant et après, puis pour chaque partage actif sa part avant et après et si l'accord de la personne est nécessaire (part déjà acceptée qui change). Une seule correction en attente par avoir (index unique partiel) ; elle est appliquée au dernier accord, refusée, ou annulée avec sa raison dès que la répartition change autrement.
- `crypto_logos` (1.6.0) : logo de chaque crypto-actif (image, date, réussite), récupéré auprès de CoinGecko et servi par `/api/crypto/logo/:actif`.
- `crypto_movements` (1.8.0) : achats et ventes datés d'un crypto-actif (quantité en chaîne décimale exacte, montant et frais en centimes dans la devise de l'avoir) ; PRU calculé par `server/crypto-cost.js` (coût moyen pondéré, BigInt).
- `fx_rates` : 1 unité de devise = `rate` devise de référence.
- `users` (adresse e-mail facultative et unique), `sessions`, `audit_log`, `settings` (dont `mail` : réglages SMTP, mot de passe chiffré).
- `invitations` : invitation par e-mail, jeton stocké haché (SHA-256), valable 7 jours, à usage unique.
- `password_resets` : lien « Mot de passe oublié », jeton haché, valable 1 heure ; un seul lien actif par utilisateur.

### Catalogue dynamique (0.9.0)

- **OpenFinTech** : téléchargement quotidien des fournisseurs actifs signalés en France depuis [static.openfintech.io/raw](https://static.openfintech.io/raw/). Le descripteur `latest.json`, `SHA256SUMS` et le hash du fichier `vendors.json` sont vérifiés avant insertion. Les logos PNG connus sont tentés sur `static.openfintech.io`, puis Vigie utilise le site officiel si présent.
- **Wikidata** : recherche à la demande dès 3 caractères, uniquement parmi les entités dont la description est financière ; lecture du site officiel (P856), des alias et du logo (P154) sur Wikimedia Commons. Les images sont téléchargées par le serveur, validées et conservées en base, jamais directement chargées par le navigateur.
- **France** : compléments depuis l'[API Recherche d'Entreprises](https://www.data.gouv.fr/dataservices/api-recherche-dentreprises), limitée ici aux codes NAF 64, 65, 66 ; cette source ne garantit ni agrément bancaire ni logo. Ne pas présenter Sirene comme une liste d'établissements agréés.
- **Confidentialité / résilience** : seul le texte recherché est envoyé à Wikidata et au service public français. Les noms des avoirs, les montants et les identifiants des utilisateurs ne quittent pas Vigie. Les résultats sont conservés dans SQLite et utilisés si une source tombe. Les logos personnalisés passent toujours en priorité.
- **Contrôle** : `INSTITUTION_CATALOGUE=false` désactive toutes les requêtes vers ces trois sources (mais laisse le catalogue embarqué et les entrées déjà mises en cache). `INSTITUTION_LOGOS=false` désactive les téléchargements de logos. L'annuaire est consultable via `GET /api/institutions/catalogue` et enrichi via `GET /api/institutions/search?q=...` (authentification obligatoire).

### Logos : OpenFinTech et Wikidata par défaut (0.9.1)

La recherche des logos suit désormais l'ordre suivant, pour **tous** les établissements
du catalogue historique et les fiches Sirene (depuis 0.9.10, une image horizontale n'est jamais
retenue pour la pastille : voir « Pastilles carrées et logo complet ») :

1. **OpenFinTech** : fournisseur français rapproché par nom exact ou par domaine officiel identique ; les URL de logos sont synchronisées et mises en cache en SQLite.
2. **Wikidata** : recherche des noms exacts en français et en anglais, exclusivement pour les entités décrites comme financières ; récupération du logo P154, sous forme de miniature PNG via Wikimedia Commons.
3. **Site officiel** : recherche du meilleur favicon ou de l'icône de l'application, avec secours Google si autorisé.
4. **Monogramme** si aucune source ne répond ou si les images échouent à la validation.

La recherche Wikidata conserve les résultats positifs 30 jours et les recherches sans correspondance 3 jours, afin de limiter les appels aux serveurs publics. Les images et les échecs sont conservés dans SQLite. Les anciennes images déjà valides restent utilisables pendant une mise à jour ; les échecs des versions précédentes sont réessayés après migration. La recherche de logos utilise le **nom de l'établissement**, jamais les montants ni les noms des avoirs ; aucune donnée personnelle n'est transmise à ces sources. Les images personnalisées restent prioritaires.

La configuration `INSTITUTION_CATALOGUE=false` désactive les recherches Wikidata/OpenFinTech, et `INSTITUTION_LOGOS=false` désactive toutes les récupérations automatiques. Les échecs de téléchargement peuvent aussi provenir de la connexion Internet du conteneur Docker : le nouveau mécanisme ne résout pas à lui seul une panne DNS ou réseau.

### Pastilles carrées et logo complet (0.9.10)

Une pastille (24 à 36 px) n'affiche qu'une image dont le rapport largeur / hauteur reste entre 1/1,5 et 1,5 (`isSquarish` dans `server/logos.js`). Dans `LogoService.refresh`, chaque image des sources ouvertes est classée :

- **à peu près carrée** : elle devient l'image de la pastille (`logo_cache.data`), dans l'ordre OpenFinTech, Wikidata, puis icône du site officiel ;
- **horizontale ou de dimensions inconnues** : elle est gardée comme **logo complet** (`logo_cache.full_*`), jamais en pastille. La pastille prend alors l'icône du site officiel, sinon le monogramme (statut `wide_only` dans la page Établissements).

Wikidata est consulté même quand la pastille vient d'OpenFinTech, pour proposer le logo complet ; la recherche Wikidata reste mise en cache 30 jours (3 jours sans résultat). Le logo complet est servi par `GET /api/institutions/logo/:id/full` (404 s'il n'existe pas) et listé avec sa version dans `GET /api/institutions/logos` (`full`). L'interface l'affiche sur fond blanc dans le détail d'un avoir et dans Réglages → Établissements.

La migration 16 ajoute les colonnes `full_*` et `full_checked_at`, supprime du cache les pastilles horizontales enregistrées par 0.9.0 à 0.9.9 (recherchées de nouveau au préchargement) et laisse `full_checked_at` vide pour les autres, qui sont complétées une seule fois par leur logo complet.

### Correspondances vérifiées (0.9.1)

Les dénominations légales ci-dessous, renvoyées par le registre Sirene, sont associées à leur site de marque **sans modifier les valeurs déjà enregistrées dans les avoirs**, ni leur nom ni leur identifiant d'annuaire :

- **N26 BANK SE** → `n26.com`, marque N26 (voir les [mentions légales N26](https://n26.com/en-fr/imprint)).
- **VIVID MONEY S.A.** → `vivid.money`, marque Vivid Money (voir les [mentions légales Vivid](https://vivid.money/en-fr/imprint/)). Attention : le domaine `vivid-money.lu` a été signalé comme frauduleux par la CSSF ; il n'est jamais utilisé.

Les logos de référence sont récupérés sous forme d'image PNG auprès de Wikimedia Commons, et, en cas d'échec, le serveur continue la recherche d'icône sur le site officiel. Les images personnelles gardent la priorité. Sources et attribution :

- **N26** : [N26 logo.svg](https://commons.wikimedia.org/wiki/File:N26_logo.svg), auteur N26, domaine public selon Wikimedia Commons (marque enregistrée).
- **Vivid** : [Vivid-money-logo.svg](https://commons.wikimedia.org/wiki/File:Vivid-money-logo.svg), auteur *ThisUserIsVivid*, licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Conversion en miniature PNG par Wikimedia Commons ; les crédits restent associés à la source originale.

### Navigation dans les réglages (0.9.1)

La page **Réglages** dispose d'onglets thématiques : **Général** (devise et rappels),
**Titulaires**, **Devises**, **Établissements** (gestion des logos),
**Données** (exports, restauration et sauvegardes), **E-mails** (SMTP)
et **Sécurité** (configuration du serveur). Les rubriques d'administration
restent invisibles aux rôles non administrateurs. Les formulaires, validations,
contrôles d'accès et API existants sont conservés.

La barre d'onglets est défilable sur mobile, utilisable au clavier avec
les flèches, Début et Fin. Le dernier onglet sélectionné est conservé
dans le navigateur et chaque thème peut être ouvert directement,
par exemple `#/reglages/devises` ou `#/reglages/etablissements`.

### Comptes Vigie indépendants et partage d'un avoir (0.9.8, généralisé en 0.10.0)

Depuis 0.9.8, chaque avoir appartient au **compte Vigie qui l'a créé** :
tableaux de bord, avoirs, historiques et exports courants n'exposent pas
les patrimoines d'autres comptes. Les avoirs créés avant 0.9.8 ont été
attribués **au premier administrateur** par une migration SQLite additive.

**Partager un avoir.** Depuis 0.10.0, tout avoir se partage (plus
seulement l'immobilier), depuis la section **Partage** de son détail :
bouton **Partager cet avoir**, choix d'un **compte actif du même
serveur**, quote-part proposée. Il n'y a plus de menu dédié.

- Part proposée par défaut : la **part non attribuée** si le titulaire
  a déclaré moins de 100 % (bien détenu à 60 % → 40 % proposés), sinon
  **la moitié** de sa part (compte joint détenu à 100 % → 50 %).
- Le titulaire garde toujours au moins 0,01 % ; les demandes en attente
  et les parts acceptées sont prises en compte pour ne jamais dépasser 100 %.
- À l'**acceptation**, si la part ne tient pas dans la part non
  attribuée, la quote-part du titulaire est réduite d'autant (100 % →
  50 %). Cette réduction est mémorisée (`deducted_bp`) et **rendue au
  titulaire** si le partage est retiré ou si le destinataire y renonce.

**Approbation.** Le destinataire voit la demande en **bandeau en haut
de ses Avoirs et de son tableau de bord** (nom, catégorie, part proposée
et sa valeur du jour), avec **Accepter** et **Refuser**. Si l'envoi
d'e-mails est configuré (**Réglages → Envoi d'e-mails**) et que le compte
a une adresse, il reçoit aussi un e-mail avec un lien vers ses Avoirs ;
sinon, la demande l'attend à sa prochaine connexion. Le lien seul ne
permet à personne d'autre d'accepter. La demande expire en 7 jours.
Propositions, acceptations, refus et retraits sont inscrits au journal.

**Suivi.** La section **Partage** de chaque avoir indique s'il est
**partagé ou non**, la quote-part du titulaire, et pour chaque personne
la part, la date de la proposition, l'envoi de l'e-mail et l'état :
approuvé (avec la date), en attente (avec l'expiration), refusé ou
expiré. Les partages terminés restent dans **Partages précédents**. La
liste des Avoirs résume l'état par une étiquette. Chez le destinataire,
l'avoir porte « Partagé par… » et se consulte en lecture seule ; il peut
**renoncer à sa part**.

**Calcul.** La valeur de l'avoir entier est conservée **une seule fois**.
Chaque tableau de bord ne compte que la quote-part du compte :
- titulaire avec 60 % d'une maison valant 800.000 € : **480.000 €** ;
- destinataire acceptant 40 % : **320.000 €**.

Les évolutions de valeur se répercutent sur les deux comptes selon leurs
quote-parts ; plus-values latentes et prix de revient sont ramenés à la
part de chacun. L'export JSON personnel inclut les quote-parts et les
partages acceptés des avoirs du compte (section `holding_shares`, les
exports antérieurs avec `real_estate_shares` restent importables) ; les
demandes en attente ne sont pas réémises. L'import JSON global est refusé
s'il détruirait les avoirs d'un autre compte : utilisez alors les
sauvegardes du serveur.

Le partage représente un **accord de suivi financier dans Vigie**,
**pas un transfert légal de propriété**. Les courbes restent fondées sur
l'avoir entier, avec la quote-part actuelle appliquée à l'historique.

### Compatibilité avec le format réel des ventes GeoRegistry (0.9.6)

**Anomalie identifiée grâce à la version 0.9.5** : l'API renvoyait
100 ventes de maisons au bon type dans chaque rayon autour du bien,
mais Vigie en retenait zéro. Ce n'était pas une preuve d'absence de
transactions ; toutes les lignes échouaient au contrôle de leur date.

**Cause vérifiée contre une réponse JSON réelle du fournisseur** le
1er novembre 2026 (sur une adresse publique de test) : les ventes
par adresse comportent un objet `mutation` imbriqué avec
`mutation.date`, `mutation.nature` et `mutation.mutation_uid`. La
distance se trouve dans `distance_meters`. Les exemples abrégés de
la documentation publique montraient plutôt des champs aplatis
`mutation_date`, `nature` et `distance_m`.

Vigie 0.9.6 prend désormais en charge **les deux formats** et utilise
`mutation.mutation_uid` pour éviter les doublons de dispositions
d'une même vente. Il continue à exclure les mutations autres que
des ventes simples, les transactions hors des cinq dernières années,
les valeurs de prix au m² absentes ou incohérentes et les ventes
trop éloignées du rayon demandé. Les messages d'échec détaillent
dorénavant chaque catégorie de rejet (date manquante, date ancienne,
nature de mutation, prix/surface/distance, doublons).

**Contrôle qualité** : des tests utilisent le schéma exact observé dans
la réponse en production de GeoRegistry, ainsi que l'ancien schéma,
sans aucun appel Internet lors de la suite de tests habituelle.
Cela corrige le rejet systématique observé sans promettre qu'un
nombre minimal de ventes représentatives existe pour toute adresse.
Le calcul conserve sa fourchette de prudence et reste soumis à
validation explicite de l'utilisateur avant enregistrement.

### Diagnostiquer les échecs d'estimation DVF (0.9.5)

La version 0.9.4 pouvait afficher « moins de trois ventes locales »
lorsqu'en réalité la recherche d'adresse avait échoué, que le service était
limité (HTTP 429), ou que sa réponse n'avait pas le format attendu.
Ce message pouvait conduire à tort à supposer que la zone n'avait pas de
transactions immobilières.

La version 0.9.5 distingue explicitement :
- **Adresse non reconnue** par le géocodeur BAN : vérifiez la saisie,
  aucune vente ne peut être rattachée à un périmètre sûr.
- **Service DVF indisponible ou limité** : erreur technique claire, pas de
  prétendu manque de ventes.
- **Réponse du fournisseur inexploitable** : erreur de format précise.
- **Ventes insuffisantes après filtres** : détail du rayon (1,5, 5,
  puis 10 km), du nombre de mutations retournées, des maisons ou
  appartements du bon type et des ventes exploitables, pour comprendre
  si les rejets viennent des prix/m² ou d'autres critères.

À défaut de comparables de taille similaire à 5 km, la recherche peut
encore s'élargir à **10 km** pour la médiane au m² du bon type de logement.
Ce calcul n'est proposé que si au moins **3 mutations utilisables,
distinctes, du bon type et récentes** sont présentes. Le résultat porte
toujours une fiabilité **faible** et une fourchette de précaution **±50 %**,
qui n'est pas un intervalle statistique. À 10 km, les quartiers peuvent
présenter des marchés très différents : l'estimation est à considérer
comme un ordre de grandeur, non comme un prix de vente précis.

Aucune source externe ne reçoit le prix ou la date d'achat, ni la part
détenue. Le résultat ne remplace jamais la valeur actuelle tant que
l'utilisateur ne l'a pas explicitement appliqué et sauvegardé.

### Quote-part de propriété immobilière (0.9.4)

Pour chaque bien immobilier, le champ **« Quote-part de propriété (%) »**
permet d'indiquer de **0,01 % à 100 %** de détention, avec une précision
de deux décimales. Par défaut, la quote-part vaut **100 %**, y compris
pour tous les biens créés avant cette version et tous les anciens exports.

Les champs **Valeur d'achat** et **Valeur actuelle** concernent toujours
le **bien immobilier entier**. Le moteur DVF estime lui aussi le bien
entier. En revanche, le tableau de bord, le patrimoine net, les
répartitions, les courbes d'évolution et la liste des avoirs
comptabilisent uniquement **la valeur du bien × la quote-part détenue**.
La plus-value latente est la différence entre la valeur de la part détenue
et le prix d'achat correspondant à cette même part (hors frais, crédits,
fiscalité et éventuels changements de détention dans le temps).
La fiche de détail expose à la fois les deux valeurs du bien entier
et celles de la quote-part, afin de ne pas mélanger les montants.

Les saisies d'historique et la mise à jour rapide attendent toujours la
**valeur du bien entier** ; leur aperçu du patrimoine net tient compte
de la quote-part. L'export JSON, la restauration et le CSV des avoirs
incluent le pourcentage ; les anciens exports sans champ de quote-part
restent compatibles, avec la valeur **100 %**.

La quote-part est un paramètre *actuel* appliqué à l'ensemble de l'historique
pour la lecture du patrimoine. En cas de changement de quote-part au fil
du temps, Vigie ne modélise pas encore l'historique juridique de ces
transferts : les anciennes valorisations restent celles du bien entier.

### Réglages → Sécurité modifiables depuis Vigie (0.9.4)

L'onglet **Réglages → Sécurité** permet désormais à un **administrateur**
de modifier directement, avec confirmation par son mot de passe actuel,
les paramètres suivants : délai de déconnexion par inactivité, durée
maximale d'une nouvelle session, seuil des échecs de connexion, durée
de blocage, double authentification obligatoire, récupération externe
des logos et service de secours pour les logos. Un compte Utilisateur ou
en Lecture seule ne peut pas les modifier.

Les changements sont validés par le serveur, historisés dans le journal
d'audit, actifs immédiatement et persistés dans **SQLite** pour être
restaurés au prochain démarrage. Les sessions déjà créées conservent
leur échéance absolue initiale, mais le délai d'inactivité est évalué
avec la nouvelle durée. Les comptes bloqués avant un changement
conservent leur heure de déblocage actuelle.

**Protection Runtipi :** une obligation de double authentification
imposée au démarrage par Runtipi ou `data/config/vigie.env` ne peut
jamais être désactivée depuis l'interface, même si la base SQLite
contient un réglage contraire. Si la 2FA est rendue obligatoire depuis
Vigie, un utilisateur non équipé doit l'activer dans **Mon compte**
avant de retrouver l'accès à ses données. Le secret cryptographique
de l'application n'est pas modifiable depuis Vigie.

### Estimations immobilières avec peu de ventes DVF (0.9.4)

Si le moteur GeoRegistry renvoie une estimation incomplète, incohérente ou
moins de trois comparables, Vigie utilise **une seconde méthode de calcul**
auprès du même fournisseur : `GET /api/v1/dvf/ventes/address`.
Il cherche d'abord dans un rayon de 1,5 km, puis de 5 km au besoin,
des ventes effectives sur les cinq dernières années. Il privilégie les
ventes du **même type et de surface proche**. Si moins de trois biens sont
comparables en taille, il propose un **troisième niveau de secours** : la
médiane du prix au m² des **maisons seulement** (ou appartements seulement)
vendues localement, même si leur surface diffère, multipliée par la surface
du bien. Il faut toujours **au moins trois ventes locales fiables et distinctes** ;
les transactions sans prix au m² vérifié sont écartées pour ne pas compter des
ventes multi-lots. On privilégie le rayon de 1,5 km, étendu à 5 km si nécessaire
pour trouver d'abord des biens de surface voisine.

Ce troisième calcul est **moins précis**, notamment pour les grandes maisons
et les terrains de tailles diverses : fourchette indicative ±35 %, confiance
« faible », mention explicite de la formule et du rayon dans l'interface.
Ces ventes ne constituent **pas une source indépendante** du moteur initial.

L'interface affiche le nombre de transactions retenues, la confiance
(faible pour le calcul au m²), la méthode et le rayon de recherche.
En l'absence de données vérifiables, Vigie donne une erreur plus précise
plutôt qu'un chiffre arbitraire. Ni la valeur actuelle ni le prix d'achat
ne changent sans validation explicite de l'utilisateur.

L'estimation reste indicative, particulièrement en zone rurale ou lorsque
des biens très différents se trouvent à moins de 5 km.

#### Baguette magique et compte rendu dans les notes

Depuis Vigie **0.9.7**, un **seul clic** sur le bouton **« 🪄 Estimer »**,
accolé à **Valeur actuelle du bien entier**, suffit : après une réponse
valide du fournisseur, le montant estimé apparaît directement dans le champ
**Valeur actuelle** et le compte rendu détaillé s'ajoute aux **notes du bien**.
Il n'y a **plus de second bouton « Appliquer »**. L'utilisateur clique
uniquement sur **« Enregistrer »** pour sauvegarder les modifications en base.
En cas d'erreur réseau ou de résultat non fiable, aucune valeur n'est changée.

Vigie ajoute automatiquement un bilan encadré `[Estimation Vigie]` dans les
**notes du bien** : date, source, montant, fourchette, méthode réellement
utilisée, nombre de ventes, rayon et médiane au m² pour les calculs DVF locaux,
période et dispersion des surfaces/prix observés, limites et incertitudes.
Pour la méthode principale de GeoRegistry, Vigie précise au contraire quels
paramètres (dates, rayons, coefficients) **ne sont pas communiqués** ; elle ne
prétend pas les connaître. Les fourchettes forfaitaires des méthodes de secours
sont présentées comme des précautions **et non des intervalles de confiance
statistiques**. L'effet du terrain, du DPE, des travaux et de l'état réel est
expressément signalé comme non contrôlé pour les calculs de secours.

Les notes personnelles **ne sont jamais effacées** ; un nouveau bilan remplace
uniquement le précédent bloc automatique. Si le texte dépasserait 1 000
caractères, Vigie n'écrase ni les notes, ni la valeur actuelle : elle demande
d'abord de libérer de l'espace. Une valeur saisie manuellement pendant
l'appel réseau ne sera pas écrasée par la réponse tardive. Le prix d'achat,
la date d'achat et la quote-part de propriété restent inchangés.

### Biens immobiliers : achat et valeur actuelle (0.9.3)

Dans le formulaire **Avoirs → Immobilier**, Vigie distingue **Valeur d'achat** et
**Date d'achat** (stables), de la **Valeur actuelle** (mise à jour et historisée).
La plus-value latente brute est calculée par
`valeur_actuelle - valeur_achat` (et en pourcentage du prix d'achat).
Elle n'est pas une plus-value fiscale : frais d'acquisition, travaux,
intérêts, crédit restant et fiscalité ne sont pas déduits.

La **baguette magique** située dans le **champ Valeur actuelle** utilise,
seulement sur demande de l'utilisateur, le moteur de ventes comparables DVF
de [GeoRegistry](https://georegistry.fr/docs/api) : adresse, type de bien,
surface habitable et état général. Un résultat valide présente une valeur
centrale, une fourchette, un indice de confiance et le nombre de comparables.
La proposition ne remplit la Valeur actuelle qu'après confirmation.
L'enregistrement du formulaire reste nécessaire pour modifier l'avoir.
Une indisponibilité, moins de trois ventes comparables ou une réponse incohérente
ne modifient pas la valeur.

GeoRegistry est un **intermédiaire tiers** : l'adresse est transmise à son
service uniquement après avoir cliqué sur la baguette magique, jamais
automatiquement. Le prix d'achat, sa date, le propriétaire et les avoirs ne
lui sont pas transmis. Sans accès à Internet, aucune estimation n'est affichée
et la saisie manuelle reste disponible. La source DVF de GeoRegistry n'est
pas une expertise ni une validation croisée par plusieurs sources indépendantes.

Les champs immobiliers sont conservés dans une table SQLite séparée de
l'historique des valeurs, et sont présents dans l'export JSON, la restauration
et l'export CSV des avoirs. Les anciennes fiches immobilières restent
consultables sans devoir renseigner immédiatement ces nouveaux champs.

### Suivi des plus-values latentes (V1, version 0.9.9)

- L'immobilier conserve son coût d'acquisition et ses quote-parts, sans changement de modèle.
- Pour les autres avoirs éligibles, la table `holding_acquisitions` enregistre facultativement le prix de revient total, la date d'acquisition et l'horodatage de modification.
- Les gains et pertes bruts sont affichés dans les fiches d'avoirs et dans la synthèse de la page Avoirs, avec conversion dans la devise de référence quand un taux existe.
- Les anciens avoirs sans prix de revient restent sans plus-value calculée. Les mouvements, frais et impôts ne sont pas modélisés.
- L'export JSON, l'import JSON et l'export CSV reprennent les nouvelles données.

### Développement

```bash
cd sources/vigie
npm test                                   # tests API et unitaires (node:test)
DATA_DIR=/tmp/vigie PORT=8289 npm start    # http://127.0.0.1:8289
```

Node.js 22.13 ou plus récent est requis pour `node:sqlite`. L'image est construite par `.github/workflows/vigie-image.yml` à chaque modification de `sources/vigie/` ou `apps/vigie/` : tests sur Node 22 et 24, test de démarrage du conteneur, puis publication de `ghcr.io/ajilis/vigie:<version>` et `latest` pour amd64 et arm64.

Le workflow manuel **Vigie logos check** (`.github/workflows/vigie-logos-check.yml`) vérifie depuis Internet que le logo de chaque établissement du catalogue est trouvé, et affiche un rapport texte (dimensions, format, provenance, requêtes en échec). Aucune image n'est conservée.

Pour publier une nouvelle version : augmenter `version` dans `package.json`, `apps/vigie/config.json` (avec `tipi_version` + 1 et `updated_at`) et le tag de l'image dans `apps/vigie/docker-compose.yml`. Le workflow refuse un catalogue incohérent.

### Pistes pour la suite

- Objectifs de patrimoine (épargne de précaution, apport) avec progression.
- Import CSV des valeurs depuis un tableur.
- Cours automatiques optionnels (or, bitcoin) pour les avoirs cotés.
- Instantané PDF mensuel du patrimoine.
