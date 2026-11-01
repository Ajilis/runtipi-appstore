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
