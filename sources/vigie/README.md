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
| `server/logos.js` | Logos des établissements : recherche de la meilleure icône sur le site officiel (catalogue uniquement), service d'icônes de Google en dernier recours, préchargement, images personnelles, cache en base |
| `web/institutions.json` | Catalogue des établissements proposés (nom, type, alias, site officiel) |
| `web/` | Interface, police et générateur de QR code (MIT, voir `web/vendor`) |

## Modèle de données

- `categories` : actif ou passif, liquidité par défaut, allocation cible.
- `holdings` : un avoir (nom, établissement, titulaire, devise, liquidité, clôture).
- `valuations` : une valeur par avoir et par date (`UNIQUE(holding_id, valued_at)`), en centimes. La valeur d'un avoir à une date est la dernière valeur connue à cette date. Clôturer un avoir enregistre une valeur nulle.
- `loan_schedules` : échéancier facultatif d'un avoir (montant, taux annuel, durée en mois, date de versement, type). Les valeurs de l'avoir à partir de cette date ne sont pas stockées : elles sont calculées à la lecture (`loadState`) et fusionnées avec les valeurs saisies avant. Retirer l'échéancier ou clôturer l'avoir les enregistre dans `valuations`.
- `logo_cache` : icône récupérée par site (`host`), avec ses dimensions et sa provenance ; `ok = 0` mémorise un échec (nouvel essai après 3 jours).
- `institution_logos` : image déposée par l'administrateur, par identifiant du catalogue ou `perso-nom` pour un établissement hors catalogue ; prioritaire sur `logo_cache`.
- `fx_rates` : 1 unité de devise = `rate` devise de référence.
- `users` (adresse e-mail facultative et unique), `sessions`, `audit_log`, `settings` (dont `mail` : réglages SMTP, mot de passe chiffré).
- `invitations` : invitation par e-mail, jeton stocké haché (SHA-256), valable 7 jours, à usage unique.
- `password_resets` : lien « Mot de passe oublié », jeton haché, valable 1 heure ; un seul lien actif par utilisateur.

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
