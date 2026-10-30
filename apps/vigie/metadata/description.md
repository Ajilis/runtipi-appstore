# Vigie Patrimoine

**Version du catalogue Runtipi : 2** · **Version de Vigie : 0.2.0** · **Runtipi minimum : 4.9.1**

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
| `LOG_LEVEL` | info | Détail des journaux du conteneur |

## Mises à jour et sauvegardes

Les évolutions de la base sont des migrations additives, appliquées automatiquement au démarrage. Avant une mise à jour, faire une sauvegarde Runtipi ou télécharger la dernière sauvegarde depuis **Réglages → Sauvegardes de la base**. Ne jamais changer le secret de l'application après l'installation : les doubles authentifications enregistrées deviendraient illisibles.

Image Docker : `ghcr.io/ajilis/vigie` (amd64 et arm64), construite par GitHub Actions depuis [`sources/vigie`](https://github.com/Ajilis/runtipi-appstore/tree/main/sources/vigie).
