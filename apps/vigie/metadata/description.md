# Vigie Patrimoine

**Version du catalogue Runtipi : 21** · **Version de Vigie : 0.10.0** · **Runtipi minimum : 4.9.1**

## 1. Pourquoi Vigie ?

Savoir à tout moment **ce que l'on possède et ce que l'on doit**, tous établissements confondus, sans y passer ses soirées.

Un patrimoine est éparpillé : comptes courants et livrets dans plusieurs banques, assurance-vie, PEA, épargne salariale, crypto-actifs, or, résidence principale, crédits en cours, argent prêté à un proche. Pour en avoir une vue d'ensemble, on finit souvent avec un tableur qu'on oublie de tenir à jour, ou avec un agrégateur en ligne qui exige les identifiants de ses banques et conserve ses données chez un tiers.

Vigie prend le parti inverse :

- **Pas de mouvements à saisir.** On ne gère ni opérations ni budget : pour chaque avoir, on note simplement sa valeur à une date (relevé, estimation). Vigie conserve chaque valeur et en tire l'historique, les tendances et les répartitions. Une mise à jour mensuelle prend quelques minutes.
- **Privé et auto-hébergé.** Les données restent sur votre serveur, dans votre installation Runtipi. Aucun identifiant bancaire n'est demandé et aucun montant ne quitte votre serveur. Les seuls échanges avec l'extérieur (nom d'un établissement recherché, logos, taux de la BCE, adresse d'un bien quand vous demandez son estimation) sont décrits plus bas. L'application s'ouvre sur le réseau local ou à distance par Cloudflare Tunnel, avec double authentification.
- **Une vue globale et utile.** Patrimoine net (passifs déduits), évolution dans le temps, répartition par catégorie, établissement, titulaire, devise et liquidité, écart à l'allocation visée : de quoi décider d'un rééquilibrage, d'une épargne de précaution ou d'un remboursement anticipé.
- **Pensé pour un foyer.** Plusieurs comptes, avec des rôles ; invitations par e-mail ; partage de n'importe quel avoir détenu à plusieurs (compte joint, bien en indivision, crédit à deux), chacun ne comptant que sa part.

Vigie n'est ni un logiciel de comptabilité, ni un outil de conseil financier ou fiscal : les estimations et plus-values affichées sont indicatives.

## 2. Fonctionnalités

### Avoirs et catégories

- **Avoirs** : un compte, un placement, un bien ou un crédit, avec son nom, sa catégorie, son établissement, son titulaire, sa devise, sa liquidité et des notes. Une valeur par date ; enregistrer une valeur à une date existante la remplace.
- **13 catégories par défaut** : comptes courants, épargne réglementée, assurance-vie, bourse, épargne retraite, épargne salariale, immobilier, crypto-actifs, métaux précieux, prêts accordés, autres actifs, crédits immobiliers et autres crédits. Elles se renomment, se réordonnent et s'ajoutent librement (actif ou passif, liquidité par défaut, allocation cible, pictogramme parmi 22).
- **Titulaires** : Moi, Conjoint, Commun ou tout autre nom, en liste déroulante ; ajout, renommage, fusion et suppression dans Réglages.
- **Liste des avoirs** groupée par catégorie, avec recherche, mini-courbe, dernière mise à jour et variation. Un avoir se clôture (il sort des totaux, son historique reste) puis se rouvre, ou se supprime.
- **Détail d'un avoir** : valeur actuelle, courbe, historique complet des valeurs avec écarts, et saisie d'une nouvelle valeur.
- **Mise à jour rapide** : un seul écran pour actualiser tous les avoirs à une date, bouton « Inchangée », filtre « à actualiser » et estimation du nouveau patrimoine net avant d'enregistrer.
- **Rappels** : un avoir dont la valeur date de plus de 45 jours (réglable) est signalé « à actualiser ».
- **Montants au format 12.500,50 €** : un point sépare les milliers, une virgule les décimales, partout dans l'application, le journal et les notes d'estimation. À la saisie, « 12.500 », « 12 500 » et « 12500 » donnent le même montant ; « 12,5 » ou « 12.50 » restent des décimales. Les exports CSV gardent des nombres sans séparateur de milliers pour les tableurs.

### Tableau de bord

- **Patrimoine net**, total des actifs et des passifs, en devise de référence.
- **Variations** sur 1 mois, sur 1 an et depuis janvier.
- **Courbe d'évolution** sur 3 mois, 6 mois, 1 an, 3 ans ou depuis le début, avec infobulle.
- **Répartitions** par catégorie (avec l'**allocation cible** et l'écart en euros), par établissement, par titulaire et par devise.
- **Liquidité des actifs** : disponible, sous quelques semaines, bloqué ou illiquide.
- **Avoirs à actualiser** et **mode discret** qui masque tous les montants d'un clic.

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

### Établissements et logos

- **Suggestions dès la 3e lettre** dans le champ Établissement, sans tenir compte des accents ni des majuscules, y compris par ancien nom (« Boursorama » propose BoursoBank) ; saisie libre toujours possible.
- **Annuaire enrichi en direct** au-delà du catalogue embarqué de 73 établissements : OpenFinTech (liste quotidienne vérifiée par empreinte SHA-256), Wikidata et le registre public des entreprises (activités financières). Seul le texte recherché est envoyé à ces services, et les résultats restent disponibles si une source tombe.
- **Pastille d'établissement** dans les listes, les répartitions et la mise à jour rapide : icône carrée venant d'OpenFinTech, de Wikidata ou du site officiel (avec le service d'icônes de Google en dernier recours), sinon un monogramme coloré.
- **Logo complet** (souvent horizontal) affiché dans le détail d'un avoir.
- **Réglages → Établissements** : état du logo de chaque établissement, recherche à la demande, et **image personnelle** (PNG, JPEG, WebP ou SVG) pour n'importe quel établissement, même hors catalogue.
- Chaque source extérieure se désactive dans le fichier de configuration.

### Devises

- **Devise de référence** au choix parmi 30 devises ; avoirs dans n'importe laquelle d'entre elles.
- **Taux de change** saisis à la main ou récupérés auprès de la **Banque centrale européenne** ; un avoir sans taux est signalé.

### Comptes, foyer et partage

- **Un patrimoine par compte** : chaque avoir appartient au compte Vigie qui l'a créé ; tableau de bord, historique et exports sont personnels.
- **Rôles** : administrateur (tout, y compris les comptes, les sauvegardes et la restauration), éditeur (avoirs, valeurs, catégories, taux) et lecture seule.
- **Invitations par e-mail** : la personne reçoit un lien valable 7 jours et à usage unique, choisit son identifiant et son mot de passe, puis arrive connectée. Sans e-mail, un lien peut être transmis à la main ; l'ajout direct avec un mot de passe provisoire reste possible.
- **Partage d'un avoir** avec un autre compte du serveur (compte joint, livret, assurance-vie, bien immobilier, crédit…) : bouton **Partager cet avoir** dans le détail de l'avoir, quote-part proposée (la moitié par défaut, ou la part non attribuée d'un bien en indivision). Le destinataire voit la demande **en haut de ses Avoirs et de son tableau de bord**, avec **Accepter** et **Refuser** (et un e-mail si l'envoi est configuré). Chaque avoir indique s'il est **partagé ou non**, avec qui, **depuis quand** et si le destinataire **a approuvé**, est **en attente** ou **a refusé** ; une étiquette le résume dans la liste. Après accord, chacun ne compte que sa part ; le destinataire voit l'avoir en lecture seule. Le partage se retire à tout moment.
- **Quote-part** : pour un compte joint ou un placement à deux, indiquez votre part (100 % par défaut) ; seule celle-ci entre dans votre patrimoine.
- **Mon compte** : prénom, nom, adresse e-mail, mot de passe, double authentification, sessions ouvertes.

### Sécurité et contrôle d'accès

- Comptes personnels, mots de passe de 10 caractères minimum hachés avec **scrypt** ; **double authentification TOTP** (Aegis, 2FAS, Google Authenticator, Bitwarden…) avec 10 codes de secours, facultative ou obligatoire pour tous (case du formulaire Runtipi ou Réglages → Sécurité).
- **Blocage** temporaire du compte après 5 échecs, **limitation par adresse IP**, déconnexion après 2 h d'inactivité et durée maximale de session (valeurs par défaut, réglables), **sessions visibles et révocables**.
- **« Mot de passe oublié »** : lien valable 1 heure, réponse identique que le compte existe ou non, demandes limitées, sessions fermées et e-mail d'avis après le changement.
- **Journal d'audit** des connexions et des modifications.
- Le **premier compte ne peut être créé que depuis le réseau local**, jamais à travers Cloudflare Tunnel.
- Protection CSRF, en-têtes de sécurité stricts (CSP, anti-iframe), cookies `HttpOnly` et `SameSite=Strict`, `Secure` en HTTPS ; secrets TOTP et mot de passe SMTP chiffrés (AES-256-GCM).
- **Réglages → Sécurité** : durées de session, seuils de blocage, double authentification et logos modifiables par un administrateur, après confirmation de son mot de passe.

### E-mails

- **Serveur SMTP** au choix (STARTTLS, SSL/TLS ou relais local), préréglages Gmail, iCloud, OVHcloud, Free, Orange, SFR et Brevo, et **e-mail de test** avant d'enregistrer, avec des erreurs expliquées en clair.
- Messages envoyés : invitations, liens « Mot de passe oublié », avis de changement de mot de passe, propositions de partage. Les liens utilisent toujours l'adresse publique enregistrée.

### Données, exports et sauvegardes

- **Exports** de votre patrimoine : JSON complet (avoirs, historique, échéanciers, réglages), avoirs et historique en CSV (point-virgule et virgule décimale, ouverture directe dans Excel ou LibreOffice).
- **Restauration** d'un export JSON, précédée d'une sauvegarde automatique ; refusée si d'autres comptes du serveur ont des avoirs, pour ne jamais les effacer.
- **Sauvegardes quotidiennes** de la base (heure et durée de conservation réglables), téléchargeables depuis Réglages, incluses dans les sauvegardes Runtipi.
- Évolutions de la base par **migrations additives** appliquées au démarrage : aucune donnée n'est supprimée lors d'une mise à jour.

### Interface et application installable

- Interface en français, **responsive de 320 px à l'écran large** (menu repliable, tableaux en cartes sur téléphone, cibles tactiles de 44 px), **thème clair ou sombre** selon l'appareil, pictogrammes par catégorie.
- **Réglages en onglets** : Général, Titulaires, Devises, Établissements, Données, E-mails et Sécurité.
- **Application installable (PWA)** sur téléphone, tablette et ordinateur via l'adresse HTTPS : icône, raccourcis, fenêtre autonome. Seule l'interface est mise en cache, jamais les données ; écran hors ligne et reconnexion automatique.

### Installation et exploitation

- **Application Runtipi** (4.9.1 minimum), un seul conteneur, image `ghcr.io/ajilis/vigie` pour amd64 et arm64.
- **Accès réseau** : port 8289 publié directement, sans Traefik ; ouverture par `http://IP_DU_SERVEUR:8289` sur le réseau local et par **Cloudflare Tunnel** depuis l'extérieur. Détails dans « Installation » plus bas.
- **Données persistantes** dans `APP_DATA_DIR/data/` : fichier de configuration `config/vigie.env`, base `db/vigie.sqlite` et `backups/`.

## Nouveautés par version

### Nouveautés de la version 0.10.0 : partage de tout avoir, sans menu dédié

- Le menu **Partages immobiliers** disparaît. Le partage se gère **depuis l'avoir lui-même**, et il n'est plus réservé à l'immobilier : compte joint, livret, assurance-vie, bourse, crédit… tout avoir se partage avec un autre compte du serveur.
- Le détail de chaque avoir a une section **Partage** : **Partagé** oui ou non (ou « Pas encore : en attente de l'accord de… »), votre quote-part, et pour chaque personne la part proposée, la **date de la proposition**, l'envoi de l'e-mail et l'état : **Approuvé le…**, **En attente de son accord** (avec la date d'expiration), **Refusé le…** ou **Expiré**. Les partages terminés restent consultables dans **Partages précédents**.
- La liste des Avoirs affiche une étiquette sur les avoirs concernés : **Partagé, approuvé**, **Partage en attente d'accord**, **Partage refusé** ; chez le destinataire, **Partagé par…**.
- Les **demandes reçues** s'affichent en bandeau **en haut des Avoirs et du tableau de bord**, avec le nom de l'avoir, sa catégorie, la part proposée et sa valeur du jour, et les boutons **Accepter** et **Refuser**. L'e-mail de proposition y mène ; les liens des anciens e-mails aussi.
- **L'e-mail devient facultatif** : un compte sans adresse, ou un serveur sans SMTP, reçoit la demande dans Vigie à sa prochaine connexion.
- **Quote-part du titulaire** : une part proposée par défaut à 50 % pour un avoir détenu à 100 %. À l'acceptation, votre part est réduite d'autant (100 % → 50 %) et vous est **rendue** si le partage prend fin. Pour un bien en indivision déjà déclaré à 60 %, le complément de 40 % est proposé sans toucher à votre part. Le formulaire d'un avoir non immobilier a un champ **Votre quote-part (%)**.
- Migration automatique : les partages immobiliers existants, acceptés ou non, sont repris tels quels. L'export JSON inclut les quote-parts et les partages acceptés de tous les avoirs ; les exports des versions précédentes restent importables.

### Nouveautés de la version 0.9.11 : point des milliers

- Les montants s'affichent avec un **point comme séparateur de milliers** : 12.500,50 € au lieu de 12 500,50 €. Le changement vaut pour le tableau de bord, les avoirs, la mise à jour rapide, le tableau d'amortissement, les pourcentages, les taux de change, la taille des sauvegardes, le journal et les notes d'estimation immobilière.
- À la saisie, **« 12.500 » vaut douze mille cinq cents** (et non 12,50 €). « 12.500,50 », « 12 500,50 » et « 12,500.50 » restent acceptés ; « 12,5 », « 12.5 » et « 0.500 » restent des décimales. Un montant affiché par Vigie, copié puis collé, est relu à l'identique, y compris un montant négatif.
- Les **exports CSV** ne changent pas : nombres sans séparateur de milliers, virgule décimale, pour être lus tels quels par Excel ou LibreOffice.

### Nouveautés de la version 0.9.10 : pastilles lisibles, logo complet dans le détail

- Une **pastille d'établissement** n'affiche plus qu'une image à peu près carrée. Les logos horizontaux de Wikidata (nom de la marque écrit en long) devenaient un trait illisible dans 24 à 36 pixels : la pastille prend désormais l'icône carrée d'OpenFinTech ou du site officiel, et à défaut le monogramme.
- Le **logo complet** horizontal est conservé à part. Il s'affiche, sur fond blanc pour rester lisible en thème sombre, dans le **détail d'un avoir** (ligne Établissement) et sur la page **Réglages → Établissements**, avec sa taille et sa provenance.
- Les logos horizontaux enregistrés comme pastille par les versions 0.9.0 à 0.9.9 sont oubliés par la migration et recherchés de nouveau peu après le démarrage. Les autres logos sont complétés une fois par leur logo complet, sans action de votre part.
- Si un établissement n'a qu'un logo horizontal, la page Établissements l'indique : ajoutez une image carrée pour sa pastille.

### Nouveauté 0.9.9 : plus-values latentes multi-actifs

Pour les actifs non immobiliers éligibles (or, métaux précieux, cryptomonnaies, bourse et autres placements), renseignez facultativement le **prix de revient total** et la **date d'acquisition** dans la fiche de l'avoir. Vigie affiche le gain ou la perte latent(e) brut(e) dans le détail de l'avoir et dans une synthèse sur la page **Avoirs**. Les montants sont inclus dans les exports CSV et les sauvegardes/restaurations JSON. L'immobilier conserve son calcul par quote-part.

Les résultats restent indicatifs : aucun calcul fiscal, aucun mouvement d'achat/vente, et aucun prix de revient supposé pour les anciens avoirs.

### Nouveautés des versions 0.9.0 à 0.9.8

#### Annuaire d'établissements en ligne et Réglages en onglets (0.9.0 à 0.9.2)

- Les suggestions du champ **Établissement** s'enrichissent en direct depuis trois sources ouvertes : **OpenFinTech** (fournisseurs actifs en France, liste mise à jour chaque jour et vérifiée par empreinte SHA-256), **Wikidata** (recherche dès 3 lettres, entités financières uniquement) et le **registre public des entreprises** (API Recherche d'entreprises, activités financières, codes NAF 64 à 66). Ce registre ne garantit pas qu'un établissement soit agréé.
- Les logos viennent d'OpenFinTech, de Wikidata (Wikimedia Commons), puis du site officiel. Seul le texte recherché est envoyé à ces services, jamais vos avoirs ni vos montants. Les résultats sont gardés en base et servent si une source est indisponible. `INSTITUTION_CATALOGUE=false` coupe ces requêtes.
- **Réglages en onglets** : Général, Titulaires, Devises, Établissements, Données, E-mails et Sécurité, chacun accessible directement (par exemple `#/reglages/etablissements`).

#### Immobilier : achat, quote-part, estimation et plus-value (0.9.3 à 0.9.7)

- **Valeur d'achat** et **date d'achat** distinctes de la **valeur actuelle** ; **plus-value latente brute** affichée (sans frais, travaux, crédit ni fiscalité).
- **Quote-part de propriété** de 0,01 % à 100 % : vous saisissez la valeur du bien entier, le patrimoine compte votre part.
- **Estimation sur demande** (bouton « Estimer » à côté de la valeur actuelle), à partir des ventes DVF via le service tiers **GeoRegistry**. L'adresse, le type, la surface et l'état du bien ne lui sont transmis que lorsque vous cliquez. Le résultat (valeur, fourchette, ventes comparables) remplit la valeur actuelle et un compte rendu s'ajoute aux notes ; rien n'est enregistré avant « Enregistrer ».
- Les versions 0.9.5 et 0.9.6 expliquent précisément un échec d'estimation (adresse non reconnue, service limité, réponse inattendue) et lisent correctement les ventes du fournisseur.

#### Sécurité modifiable dans Vigie (0.9.4)

- **Réglages → Sécurité** : délai d'inactivité, durée des sessions, seuil et durée du blocage, double authentification obligatoire, logos et service de secours se règlent par un administrateur, après confirmation de son mot de passe. Ces valeurs, enregistrées en base, priment sur `vigie.env`. La double authentification imposée par le formulaire Runtipi ou par `vigie.env` ne peut pas être retirée depuis Vigie.

#### Un patrimoine par compte, partage d'un bien immobilier (0.9.8)

- **Changement important :** chaque avoir appartient désormais au **compte Vigie qui l'a créé**. Tableau de bord, avoirs, historique et exports sont personnels. À la mise à jour vers 0.9.8, tous les avoirs existants ont été attribués au **premier administrateur** : les autres comptes (par exemple un conjoint en lecture seule) ne voient plus ce patrimoine.
- **Partager ce bien** : le propriétaire d'un bien immobilier propose une quote-part à un autre compte du serveur ayant une adresse e-mail. Le destinataire reçoit un e-mail, puis accepte ou refuse dans **Partages immobiliers** ; le bien apparaît alors dans son patrimoine pour sa part, en lecture seule. La proposition expire après 7 jours et le partage est révocable. Depuis 0.10.0, le partage concerne tous les avoirs et se gère depuis l'avoir (voir plus haut).
- La **restauration d'un export JSON** est refusée si d'autres comptes ont des avoirs : utilisez alors les sauvegardes du serveur.

### Nouveautés de la version 0.8.0 : e-mails, invitations et mot de passe oublié

#### Envoi d'e-mails (Réglages → Envoi d'e-mails, administrateurs)

- Renseignez le **serveur SMTP** de votre messagerie ou de votre hébergeur : serveur, port, sécurité (**STARTTLS** sur le port 587, **SSL/TLS** sur le port 465, ou **aucune** pour un relais de votre réseau local), identifiant, mot de passe, adresse et nom d'expédition.
- **Préréglages** : en choisissant smtp.gmail.com, smtp.mail.me.com (iCloud), ssl0.ovh.net, smtp.free.fr, smtp.orange.fr, smtp.sfr.fr ou smtp-relay.brevo.com, le port et la sécurité se remplissent et un conseil s'affiche (Gmail et iCloud exigent un **mot de passe d'application**).
- **Envoyer un e-mail de test** avant même d'enregistrer. En cas d'échec, Vigie explique la cause : serveur introuvable, port bloqué, mauvais mode de sécurité, certificat refusé, identifiant ou mot de passe refusé, expéditeur non autorisé.
- **Adresse de Vigie dans les liens** : l'adresse qu'ouvriront vos invités, par exemple `https://patrimoine.exemple.fr` (Cloudflare Tunnel). Les liens des e-mails utilisent toujours cette adresse enregistrée, jamais celle de la requête.
- Le mot de passe SMTP est **chiffré dans la base** avec le secret de l'application et n'est jamais réaffiché.

#### Invitations par e-mail (Utilisateurs → Inviter par e-mail)

- Indiquez l'adresse, éventuellement le prénom et le nom, et le rôle. La personne reçoit un e-mail avec le bouton **Créer mon compte** : elle choisit son nom d'utilisateur et son mot de passe, puis arrive directement connectée (et active la double authentification si elle est obligatoire).
- Le lien est **valable 7 jours et ne sert qu'une fois**. Les **invitations en attente** sont listées : renvoyer l'e-mail, créer un nouveau lien (l'ancien cesse de fonctionner) ou annuler.
- Sans serveur SMTP, ou pour passer par une messagerie instantanée, créez un **lien à transmettre vous-même**.
- « Ajouter directement » (avec un mot de passe provisoire) reste possible.

#### Mot de passe oublié

- Lien **« Mot de passe oublié ? »** sur l'écran de connexion, dès que l'envoi d'e-mails est configuré : l'utilisateur indique son nom d'utilisateur ou son adresse et reçoit un lien **valable 1 heure, à usage unique**. Une nouvelle demande remplace le lien précédent.
- Protections : réponse identique que le compte existe ou non, 5 demandes au plus par adresse IP et par quart d'heure, une demande par minute et par compte, rien n'est envoyé à un compte désactivé. Après le changement, **toutes les sessions sont fermées** et un **e-mail d'avis** est envoyé. La double authentification reste demandée à la connexion.
- **Adresse e-mail des utilisateurs** : dans Mon compte (le mot de passe actuel est demandé pour la changer) et dans la gestion des utilisateurs. L'administrateur peut aussi **envoyer un lien de réinitialisation** à un utilisateur.

Le conteneur doit pouvoir joindre votre serveur SMTP. Beaucoup de fournisseurs d'accès bloquent le port 25 vers Internet : préférez 587 ou 465.

### Nouveautés de la version 0.7.0 : logos des établissements

- **Logos en couleur pour presque tout le catalogue.** Vigie ne fournit toujours aucun logo : votre serveur récupère l'icône publiée par le site officiel de chaque établissement. La recherche est plus complète (icônes d'application déclarées dans le manifeste du site, apple-touch-icon, tuile Windows, icônes intégrées à la page, favicon) et Vigie garde la plus nette d'après ses dimensions réelles.
- **Dernier recours : service d'icônes de Google.** Certains sites bloquent les serveurs ou n'offrent qu'une icône de 16 px. Dans ce cas, Vigie demande l'icône du site au service d'icônes de Google, qui ne reçoit que le nom de domaine de l'établissement (par exemple `www.revolut.com`), jamais vos données. Pour l'interdire : `INSTITUTION_LOGOS_FALLBACK=false` dans `data/config/vigie.env`.
- **Préchargement** : les logos des 72 établissements du catalogue sont recherchés peu après le démarrage puis chaque jour, pour s'afficher immédiatement partout, y compris dans les suggestions du champ Établissement. Les logos des versions précédentes sont améliorés automatiquement.
- **Nouvelle page Réglages → Logos des établissements** (administrateurs) : état de chaque logo (officiel avec sa taille et sa provenance, image personnelle, introuvable), filtres « Mes établissements » et « Sans logo », recherche d'un logo à la demande, et recherche de tous les logos manquants avec progression.
- **Image personnelle** pour n'importe quel établissement, y compris un établissement absent du catalogue (« Banque du village », une SCI, un notaire) : PNG, JPEG, WebP ou SVG, réduite à 256 px par le navigateur avant l'envoi. Elle remplace le logo récupéré pour tous les utilisateurs et est incluse dans l'export JSON et la restauration.

Mesure faite depuis un serveur GitHub (hors de France) : 71 logos trouvés sur 72, dont 57 d'au moins 96 px. Quelques établissements ne publient qu'une petite icône (16 à 48 px) ; l'image personnelle permet d'en mettre une plus nette.

### Nouveautés de la version 0.6.0 : prêts et crédits à échéancier

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

### Nouveautés de la version 0.5.0 : établissements et logos

- **Suggestions dès la 3e lettre** dans le champ **Établissement** d'un avoir : vos établissements déjà utilisés d'abord, puis un catalogue de 73 établissements (banques, banques en ligne, néobanques, courtiers, assureurs et plateformes d'assurance-vie, gestion pilotée, épargne salariale, crypto, SCPI, métaux précieux). La recherche ignore les accents et les majuscules et reconnaît les anciens noms ou abréviations : « bourso » propose BoursoBank, « lyonnais » propose LCL. Choix à la souris, au doigt ou au clavier (flèches, Entrée, Échap). La saisie libre reste possible pour un établissement absent de la liste.
- **Pastille d'établissement** dans chaque avoir, le panneau d'un avoir, la mise à jour rapide et la répartition « Actifs par établissement » du tableau de bord.
- **Logos** : aucun logo n'est fourni avec Vigie. Pour un établissement du catalogue, votre serveur récupère l'icône publiée par son site officiel (adresse fixée dans le catalogue, jamais une adresse saisie) et la conserve dans la base. Sinon, ou si la récupération échoue, un **monogramme coloré** (initiales) s'affiche. Les logos manquants sont réessayés automatiquement après quelques jours, ou tout de suite depuis **Réglages → Sécurité du serveur**.
- **Confidentialité** : la récupération d'un logo est une simple requête vers le site public de l'établissement, sans aucune donnée personnelle. Pour qu'aucune connexion sortante ne soit faite, mettre `INSTITUTION_LOGOS=false` dans `data/config/vigie.env` puis redémarrer : seuls les monogrammes s'affichent.

### Nouveautés de la version 0.4.0 : application installable (PWA)

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

### Nouveautés de la version 0.3.0

- **Un pictogramme par catégorie**, choisi parmi 22 (portefeuille, carte, banque, espèces, tirelire, assurance, protection, bourse, retraite, entreprise, résidence, immeuble, crypto-actif, lingots, objets de valeur, véhicule, œuvre d'art, forêt et terres, autre, prêt immobilier, crédit, prêt entre proches). Il apparaît dans le tableau de bord, la liste des avoirs, la mise à jour rapide, le détail d'un avoir et les rappels. Les catégories existantes reçoivent automatiquement le pictogramme correspondant à leur nom ; il se change dans **Catégories → Modifier**.
- **Pictogrammes d'interface** : chiffres clés, niveaux de liquidité (disponible, court terme, bloqué), titres de sections, boutons, étiquettes (à actualiser, clôturé, taux manquant), rôles, actions du journal et messages de confirmation.
- **Initiales** des titulaires et des utilisateurs, et pictogramme d'établissement ou de devise dans les répartitions.

### Nouveautés de la version 0.2.0

- **Bouton « Modifier » d'un avoir corrigé.** Toutes les fenêtres ouvertes depuis une autre fenêtre s'affichent désormais : formulaire de modification, confirmations de clôture et de suppression, codes de secours après l'activation de la double authentification, gestion d'un utilisateur.
- **Titulaire en liste déroulante**, avec l'option « Nouveau titulaire… ». La liste se gère dans **Réglages → Titulaires** : ajouter, renommer (tous les avoirs suivent), fusionner deux titulaires en choisissant un nom existant, supprimer un titulaire inutilisé.
- **Prénom et nom** dans Mon compte, à l'installation et dans la gestion des utilisateurs. Les comptes existants sont repris automatiquement (« Alex Martin » devient Alex / Martin).
- **Interface responsive de 320 px à l'écran large**, vérifiée écran par écran : menu repliable sur téléphone et tablette, tableaux affichés en cartes, champs à 16 px (pas de zoom automatique sur iPhone), boutons de 44 px.

La mise à jour applique une migration additive de la base : aucune donnée n'est supprimée.

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

Modifier `APP_DATA_DIR/data/config/vigie.env`, puis redémarrer l'application dans Runtipi. Les réglages de session, de blocage, de double authentification et de logos peuvent aussi être changés dans **Réglages → Sécurité** : ces valeurs, enregistrées en base, priment sur le fichier (sauf la double authentification imposée, qui reste obligatoire).

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
| `INSTITUTION_CATALOGUE` | true | Suggestions d'établissements enrichies depuis OpenFinTech, Wikidata et le registre public des entreprises (false : catalogue embarqué uniquement, aucune requête vers ces services) |
| `INSTITUTION_LOGOS` | true | Logos des établissements récupérés sur leur site officiel (false : aucune connexion sortante, images personnelles ou monogrammes) |
| `INSTITUTION_LOGOS_FALLBACK` | true | Si le site bloque ou n'offre qu'une petite icône, icône demandée au service d'icônes de Google (seul le nom de domaine de l'établissement est transmis) |
| `LOG_LEVEL` | info | Détail des journaux du conteneur |

## Mises à jour et sauvegardes

Les évolutions de la base sont des migrations additives, appliquées automatiquement au démarrage. Avant une mise à jour, faire une sauvegarde Runtipi ou télécharger la dernière sauvegarde depuis **Réglages → Sauvegardes de la base**. Ne jamais changer le secret de l'application après l'installation : les doubles authentifications enregistrées deviendraient illisibles.

Image Docker : `ghcr.io/ajilis/vigie` (amd64 et arm64), construite par GitHub Actions depuis [`sources/vigie`](https://github.com/Ajilis/runtipi-appstore/tree/main/sources/vigie).
