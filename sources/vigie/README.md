# Vigie Patrimoine : sources

Application auto-hébergée de suivi de patrimoine personnel : une valeur par avoir et par date, sans gestion des mouvements. Documentation utilisateur et installation Runtipi : [`apps/vigie/metadata/description.md`](../../apps/vigie/metadata/description.md).

## Architecture

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
| `server/backup.js` | Sauvegardes `VACUUM INTO` et rotation |
| `server/mail.js` | Envoi d'e-mails : client SMTP sans dépendance (STARTTLS, SSL/TLS, AUTH PLAIN ou LOGIN), message MIME UTF-8, modèles des e-mails |
| `server/logos.js` | Logos des établissements : images sourcées depuis OpenFinTech ou Wikimedia Commons, ou site officiel, image personnelle prioritaire, cache en base |
| `server/institutions.js` | Annuaire vivant : import OpenFinTech vérifié, recherche Wikidata et Sirene, cache SQLite, dédoublonnage et limitation des requêtes |
| `web/institutions.json` | Catalogue initial de secours (nom, type, alias, site officiel) |
| `web/` | Interface, police et générateur de QR code (MIT, voir `web/vendor`) |

## Modèle de données

- `categories` : actif ou passif, liquidité par défaut, allocation cible.
- `holdings` : un avoir (nom, établissement, titulaire, devise, liquidité, clôture).
- `valuations` : une valeur par avoir et par date (`UNIQUE(holding_id, valued_at)`), en centimes. La valeur d'un avoir à une date est la dernière valeur connue à cette date. Clôturer un avoir enregistre une valeur nulle.
- `loan_schedules` : échéancier facultatif d'un avoir (montant, taux annuel, durée en mois, date de versement, type). Les valeurs de l'avoir à partir de cette date ne sont pas stockées : elles sont calculées à la lecture (`loadState`) et fusionnées avec les valeurs saisies avant. Retirer l'échéancier ou clôturer l'avoir les enregistre dans `valuations`.
- `logo_cache` : icône récupérée par site (`host`), avec ses dimensions et sa provenance ; `ok = 0` mémorise un échec (nouvel essai après 3 jours).
- `institution_logos` : image déposée par l'administrateur, par identifiant du catalogue ou `perso-nom` pour un établissement hors catalogue ; prioritaire sur `logo_cache`.
- `institution_directory` : établissements ajoutés depuis les sources ouvertes, avec provenance, aliases, site et URL du logo. Les 73 entrées embarquées restent intactes.
- `fx_rates` : 1 unité de devise = `rate` devise de référence.
- `users` (adresse e-mail facultative et unique), `sessions`, `audit_log`, `settings` (dont `mail` : réglages SMTP, mot de passe chiffré).
- `invitations` : invitation par e-mail, jeton stocké haché (SHA-256), valable 7 jours, à usage unique.
- `password_resets` : lien « Mot de passe oublié », jeton haché, valable 1 heure ; un seul lien actif par utilisateur.

## Catalogue dynamique (0.9.0)

- **OpenFinTech** : téléchargement quotidien des fournisseurs actifs signalés en France depuis [static.openfintech.io/raw](https://static.openfintech.io/raw/). Le descripteur `latest.json`, `SHA256SUMS` et le hash du fichier `vendors.json` sont vérifiés avant insertion. Les logos PNG connus sont tentés sur `static.openfintech.io`, puis Vigie utilise le site officiel si présent.
- **Wikidata** : recherche à la demande dès 3 caractères, uniquement parmi les entités dont la description est financière ; lecture du site officiel (P856), des alias et du logo (P154) sur Wikimedia Commons. Les images sont téléchargées par le serveur, validées et conservées en base, jamais directement chargées par le navigateur.
- **France** : compléments depuis l'[API Recherche d'Entreprises](https://www.data.gouv.fr/dataservices/api-recherche-dentreprises), limitée ici aux codes NAF 64, 65, 66 ; cette source ne garantit ni agrément bancaire ni logo. Ne pas présenter Sirene comme une liste d'établissements agréés.
- **Confidentialité / résilience** : seul le texte recherché est envoyé à Wikidata et au service public français. Les noms des avoirs, les montants et les identifiants des utilisateurs ne quittent pas Vigie. Les résultats sont conservés dans SQLite et utilisés si une source tombe. Les logos personnalisés passent toujours en priorité.
- **Contrôle** : `INSTITUTION_CATALOGUE=false` désactive toutes les requêtes vers ces trois sources (mais laisse le catalogue embarqué et les entrées déjà mises en cache). `INSTITUTION_LOGOS=false` désactive les téléchargements de logos. L'annuaire est consultable via `GET /api/institutions/catalogue` et enrichi via `GET /api/institutions/search?q=...` (authentification obligatoire).

## Logos : OpenFinTech et Wikidata par défaut (0.9.1)

La recherche des logos suit désormais l'ordre suivant, pour **tous** les établissements
du catalogue historique et les fiches Sirene :

1. **OpenFinTech** : fournisseur français rapproché par nom exact ou par domaine officiel identique ; les URL de logos sont synchronisées et mises en cache en SQLite.
2. **Wikidata** : recherche des noms exacts en français et en anglais, exclusivement pour les entités décrites comme financières ; récupération du logo P154, sous forme de miniature PNG via Wikimedia Commons.
3. **Site officiel** : recherche du meilleur favicon ou de l'icône de l'application, avec secours Google si autorisé.
4. **Monogramme** si aucune source ne répond ou si les images échouent à la validation.

La recherche Wikidata conserve les résultats positifs 30 jours et les recherches sans correspondance 3 jours, afin de limiter les appels aux serveurs publics. Les images et les échecs sont conservés dans SQLite. Les anciennes images déjà valides restent utilisables pendant une mise à jour ; les échecs des versions précédentes sont réessayés après migration. La recherche de logos utilise le **nom de l'établissement**, jamais les montants ni les noms des avoirs ; aucune donnée personnelle n'est transmise à ces sources. Les images personnalisées restent prioritaires.

La configuration `INSTITUTION_CATALOGUE=false` désactive les recherches Wikidata/OpenFinTech, et `INSTITUTION_LOGOS=false` désactive toutes les récupérations automatiques. Les échecs de téléchargement peuvent aussi provenir de la connexion Internet du conteneur Docker : le nouveau mécanisme ne résout pas à lui seul une panne DNS ou réseau.

## Correspondances vérifiées (0.9.1)

Les dénominations légales ci-dessous, renvoyées par le registre Sirene, sont associées à leur site de marque **sans modifier les valeurs déjà enregistrées dans les avoirs**, ni leur nom ni leur identifiant d'annuaire :

- **N26 BANK SE** → `n26.com`, marque N26 (voir les [mentions légales N26](https://n26.com/en-fr/imprint)).
- **VIVID MONEY S.A.** → `vivid.money`, marque Vivid Money (voir les [mentions légales Vivid](https://vivid.money/en-fr/imprint/)). Attention : le domaine `vivid-money.lu` a été signalé comme frauduleux par la CSSF ; il n'est jamais utilisé.

Les logos de référence sont récupérés sous forme d'image PNG auprès de Wikimedia Commons, et, en cas d'échec, le serveur continue la recherche d'icône sur le site officiel. Les images personnelles gardent la priorité. Sources et attribution :

- **N26** : [N26 logo.svg](https://commons.wikimedia.org/wiki/File:N26_logo.svg), auteur N26, domaine public selon Wikimedia Commons (marque enregistrée).
- **Vivid** : [Vivid-money-logo.svg](https://commons.wikimedia.org/wiki/File:Vivid-money-logo.svg), auteur *ThisUserIsVivid*, licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Conversion en miniature PNG par Wikimedia Commons ; les crédits restent associés à la source originale.

## Navigation dans les réglages (0.9.1)

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

## Compatibilité avec le format réel des ventes GeoRegistry (0.9.6)

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

## Diagnostiquer les échecs d'estimation DVF (0.9.5)

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

## Quote-part de propriété immobilière (0.9.4)

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

## Réglages → Sécurité modifiables depuis Vigie (0.9.4)

L'onglet **Réglages → Sécurité** permet désormais à un **administrateur**
de modifier directement, avec confirmation par son mot de passe actuel,
les paramètres suivants : délai de déconnexion par inactivité, durée
maximale d'une nouvelle session, seuil des échecs de connexion, durée
de blocage, double authentification obligatoire, récupération externe
des logos et service de secours pour les logos. Un compte éditeur ou
lecteur ne peut pas les modifier.

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

## Estimations immobilières avec peu de ventes DVF (0.9.4)

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

### Baguette magique et compte rendu dans les notes

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

## Biens immobiliers : achat et valeur actuelle (0.9.3)

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

## Développement

```bash
cd sources/vigie
npm test                                   # tests API et unitaires (node:test)
DATA_DIR=/tmp/vigie PORT=8289 npm start    # http://127.0.0.1:8289
```

Node.js 22.13 ou plus récent est requis pour `node:sqlite`. L'image est construite par `.github/workflows/vigie-image.yml` à chaque modification de `sources/vigie/` ou `apps/vigie/` : tests sur Node 22 et 24, test de démarrage du conteneur, puis publication de `ghcr.io/ajilis/vigie:<version>` et `latest` pour amd64 et arm64.

Le workflow manuel **Vigie logos check** (`.github/workflows/vigie-logos-check.yml`) vérifie depuis Internet que le logo de chaque établissement du catalogue est trouvé, et affiche un rapport texte (dimensions, format, provenance, requêtes en échec). Aucune image n'est conservée.

Pour publier une nouvelle version : augmenter `version` dans `package.json`, `apps/vigie/config.json` (avec `tipi_version` + 1 et `updated_at`) et le tag de l'image dans `apps/vigie/docker-compose.yml`. Le workflow refuse un catalogue incohérent.

## Pistes pour la suite

- Objectifs de patrimoine (épargne de précaution, apport) avec progression.
- Import CSV des valeurs depuis un tableur.
- Cours automatiques optionnels (or, bitcoin) pour les avoirs cotés.
- Instantané PDF mensuel du patrimoine.
