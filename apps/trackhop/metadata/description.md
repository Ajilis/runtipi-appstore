# Trackhop — synchronisation de playlists auto-hébergée

**Trackhop Server 1.8.1 (bêta)** synchronise les playlists de plusieurs plateformes musicales, notamment Spotify, YouTube Music, TIDAL, Deezer, Navidrome, Jellyfin et Plex (selon leurs méthodes de connexion disponibles). La synchronisation peut être planifiée depuis votre serveur, sans PC allumé.

## Installation sur Runtipi 4.9.1

1. Ajouter l'App Store `https://github.com/Ajilis/runtipi-appstore` dans **Paramètres → App Stores** et actualiser le catalogue.
2. Installer **Trackhop** en indiquant l'URL publique **HTTPS** de Cloudflare Tunnel (par exemple `https://trackhop.exemple.fr` sans slash final). Saisir un **identifiant administrateur** (par défaut `admin`) et **votre propre mot de passe** (minimum 12 caractères). Les deux champs sont disponibles dans le formulaire d'installation Runtipi.
3. Accès réseau local : `http://IP_DU_SERVEUR:8293`. Identifiant : celui indiqué dans le formulaire d'installation Runtipi (par défaut `admin`). Mot de passe : celui que vous avez saisi dans ce formulaire.
4. Dans Cloudflare Zero Trust, créer un hostname public pour le tunnel et choisir une origine de type **HTTP** avec l'adresse `http://IP_DU_SERVEUR:8293`.
5. Ouvrir `https://trackhop.exemple.fr` pour l'accès distant. L'adresse configurée dans `SONGPORT_URL` sert aussi aux redirections OAuth `/callback` et doit être enregistrée auprès des plateformes exigeant une URL de rappel.

Si `cloudflared` tourne **sur l'hôte en mode réseau hôte**, `http://127.0.0.1:8293` convient. S'il tourne **dans un conteneur Docker distinct**, `127.0.0.1` désigne ce conteneur et non le serveur Runtipi ; utiliser l'adresse LAN de l'hôte ou un mécanisme d'accès à l'hôte.

## Accès à l'interface Web et identifiants administrateur

Trackhop Server dispose de sa propre **interface Web** : ouvrir `http://IP_DU_SERVEUR:8293` sur le réseau local, ou l'URL HTTPS Cloudflare Tunnel depuis l'extérieur. Dans Runtipi, l'application est déclarée avec `no_gui: false`, pour que son accès Web ne soit pas masqué.

Depuis la **révision 2 du catalogue**, et maintenu en révision 3, il est possible de personnaliser le compte administrateur pendant l'installation :
- **Identifiant administrateur (login)** : champ `TRACKHOP_USER` (par défaut `admin`), transmis à l'application sous `SONGPORT_USER`.
- **Mot de passe administrateur** : champ masqué de type `password`, `TRACKHOP_PASSWORD`, transmis comme `SONGPORT_PASSWORD`. Ce champ n'est plus de type `random`.

L'application utilise une authentification HTTP : le navigateur peut afficher une fenêtre native de connexion au lieu d'une page de connexion graphique. Ce comportement est normal. Les identifiants demandés correspondent à ceux définis dans le formulaire Runtipi, pas aux identifiants du tableau de bord Runtipi.

**Mise à jour d'une installation existante :** rafraîchir le catalogue Ajilis puis ouvrir les paramètres de Trackhop dans Runtipi pour modifier ou ajouter le login et le mot de passe, si cette option est proposée par l'interface. Une valeur `TRACKHOP_USER` absente conserve automatiquement `admin`, tandis que l'ancien `TRACKHOP_PASSWORD` reste compatible : aucune suppression des données ni réinstallation n'est nécessaire pour appliquer les fichiers du catalogue. Redémarrer Trackhop après une modification de variables. Lorsque Runtipi n'autorise pas l'édition du formulaire d'une application installée, définir les valeurs dans un override `user-config/<slug-du-store>/trackhop/app.env` conformément au guide [Personnaliser la configuration d'une application](https://runtipi.io/docs/guides/customize-app-config), puis redémarrer. En mode multiutilisateur, changer le login dans l'environnement ne renomme pas automatiquement les utilisateurs déjà enregistrés.

## Correctif Runtipi 4.9.1 — éditeur visuel des ports (révision 3)

Certains éditeurs visuels de configuration découpent incorrectement le mappage précédent `${TRACKHOP_LISTEN_ADDRESS:-0.0.0.0}:${APP_PORT:-8293}:8080/tcp` sur les deux-points de `:-`. Les champs peuvent alors afficher des valeurs invalides comme `${TRACKHOP_LISTEN_ADDRESS` et `-0.0.0.0}`, au lieu des véritables ports TCP.

**Correction :** le Docker Compose utilise maintenant uniquement :

```yaml
    ports:
      - "8293:8080/tcp"
```

Cela rend l'interface Web accessible sur `http://IP_DU_SERVEUR:8293`, et laisse Cloudflare Tunnel accéder à cette même origine HTTP, tout en conservant `traefik.enable: "false"`. Aucun port UDP n'est publié. Le champ « Adresse IP d'écoute » a été retiré du formulaire : l'éditeur ne doit plus l'interpréter.

**Pour une installation déjà créée :** actualiser le catalogue et appliquer la mise à jour de Trackhop. Si un override personnalisé ou une modification manuelle du Compose a déjà enregistré l'ancien mappage, corriger sous **Éditer YAML** la section `ports` selon l'exemple ci-dessus, enregistrer et recréer / redémarrer le service depuis Runtipi. Vérifier dans l'onglet **Ports** : hôte **8293**, conteneur **8080**, **TCP uniquement**. Ne pas modifier les volumes et ne pas désinstaller l'application pour cette opération.

Ce port est ouvert sur les interfaces de l'hôte par défaut : limiter sa portée au LAN par le pare-feu du serveur et ne jamais rediriger le port depuis le routeur Internet.

## Aucun routage Traefik

Le port hôte **8293/tcp** est directement publié vers **8080/tcp** dans le conteneur, avec la ligne **fixe** `- "8293:8080/tcp"` dans le Compose (sans variables imbriquées dans `ports`). Le service n'utilise pas `x-runtipi.is_main`, et son étiquette `traefik.enable` vaut `false`. Dans `config.json`, `exposable` et `force_expose` valent `false` ; Runtipi ne doit pas proposer son système d'exposition par domaine pour Trackhop.

Cloudflare Tunnel se configure **en dehors** de ce Compose. Aucun conteneur `cloudflared`, aucun jeton secret, ni règle de routage Traefik ne sont ajoutés.

## Persistance : configuration et données

Le dossier `${APP_DATA_DIR}/data` de Runtipi est monté dans le conteneur sur `/data` **en lecture-écriture**. Il conserve, entre autres :

| Chemin relatif à `/data` | Contenu |
|---|---|
| `store.json` | Configuration, tâches, rapports, cache et état de synchronisation ; stockage des données Trackhop. |
| `tokens.json` | Jetons et identifiants de connexion aux services musicaux, sensibles. |
| `songport.log` | Fichier de log. |
| `csv/` | Listes musicales et autres fichiers CSV. |
| Autres fichiers et sous-dossiers | État supplémentaire, notamment pour plusieurs utilisateurs. |

**Il n'existe pas de base PostgreSQL, MySQL ou SQLite à créer** : l'application stocke ses données en JSON. Sauvegarder l'intégralité de `app-data/<slug-du-store>/trackhop/data`, et garder les paramètres Runtipi, notamment son `app.env` contenant les identifiants, en lieu sûr. Faire une sauvegarde cohérente à l'arrêt de l'application. Runtipi peut supprimer les données lors d'une désinstallation.

## Sécurité et limites

- Ne **jamais** rediriger le port 8293 depuis la box Internet. Le filtrer au niveau du pare-feu hôte pour limiter les clients aux réseaux locaux de confiance et au tunnel.
- L'accès LAN demandé est en **HTTP non chiffré** : éviter les réseaux Wi-Fi non fiables. L'accès distant doit passer par le hostname HTTPS de Cloudflare et, de préférence, par une politique Cloudflare Access.
- Protéger le dossier `/data` et les sauvegardes : `tokens.json` peut contenir des secrets. Le processus `songport` est un utilisateur non privilégié de l'image officielle : il doit pouvoir écrire dans le dossier persistant.
- Les services Spotify, Google, Deezer et autres peuvent imposer leurs propres identifiants OAuth et une URL publique HTTPS. Les connecteurs non officiels peuvent être instables.
- Trackhop Server est marqué **bêta** par son auteur. Les variables d'environnement commencent toujours par `SONGPORT_` pour compatibilité avec l'ancien nom du projet.

[Guide Docker officiel](https://trackhop.org/guide/docker) · [Dépôt source](https://github.com/xlollx/Trackhop).

**Logo :** icône officielle Trackhop © 2026 xlollx, licence **CC BY-SA 4.0**, dérivée du [SVG officiel](https://github.com/xlollx/Trackhop/blob/main/docs/store/logo.svg) (conversion JPEG pour Runtipi). Le programme Trackhop est publié sous licence AGPL-3.0-only.
