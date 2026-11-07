# Trackhop — synchronisation de playlists auto-hébergée

**Trackhop Server 1.8.1 (bêta)** synchronise les playlists de plusieurs plateformes musicales, notamment Spotify, YouTube Music, TIDAL, Deezer, Navidrome, Jellyfin et Plex (selon leurs méthodes de connexion disponibles). La synchronisation peut être planifiée depuis votre serveur, sans PC allumé.

## Installation sur Runtipi 4.9.1

1. Ajouter l'App Store `https://github.com/Ajilis/runtipi-appstore` dans **Paramètres → App Stores** et actualiser le catalogue.
2. Installer **Trackhop** en indiquant l'URL publique **HTTPS** de Cloudflare Tunnel (par exemple `https://trackhop.exemple.fr` sans slash final). Conserver le mot de passe généré.
3. Accès réseau local : `http://IP_DU_SERVEUR:8293`. Identifiant : `admin`. Mot de passe : valeur générée par Runtipi.
4. Dans Cloudflare Zero Trust, créer un hostname public pour le tunnel et choisir une origine de type **HTTP** avec l'adresse `http://IP_DU_SERVEUR:8293`.
5. Ouvrir `https://trackhop.exemple.fr` pour l'accès distant. L'adresse configurée dans `SONGPORT_URL` sert aussi aux redirections OAuth `/callback` et doit être enregistrée auprès des plateformes exigeant une URL de rappel.

Si `cloudflared` tourne **sur l'hôte en mode réseau hôte**, `http://127.0.0.1:8293` convient. S'il tourne **dans un conteneur Docker distinct**, `127.0.0.1` désigne ce conteneur et non le serveur Runtipi ; utiliser l'adresse LAN de l'hôte ou un mécanisme d'accès à l'hôte.

## Aucun routage Traefik

Le port hôte **8293/tcp** est directement publié vers **8080/tcp** dans le conteneur. Le service n'utilise pas `x-runtipi.is_main`, et son étiquette `traefik.enable` vaut `false`. Dans `config.json`, `exposable` et `force_expose` valent `false` ; Runtipi ne doit pas proposer son système d'exposition par domaine pour Trackhop.

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

**Il n'existe pas de base PostgreSQL, MySQL ou SQLite à créer** : l'application stocke ses données en JSON. Sauvegarder l'intégralité de `app-data/<slug-du-store>/trackhop/data`, et garder les paramètres Runtipi, notamment son `app.env` contenant le mot de passe, en lieu sûr. Faire une sauvegarde cohérente à l'arrêt de l'application. Runtipi peut supprimer les données lors d'une désinstallation.

## Sécurité et limites

- Ne **jamais** rediriger le port 8293 depuis la box Internet. Le filtrer au niveau du pare-feu hôte pour limiter les clients aux réseaux locaux de confiance et au tunnel.
- L'accès LAN demandé est en **HTTP non chiffré** : éviter les réseaux Wi-Fi non fiables. L'accès distant doit passer par le hostname HTTPS de Cloudflare et, de préférence, par une politique Cloudflare Access.
- Protéger le dossier `/data` et les sauvegardes : `tokens.json` peut contenir des secrets. Le processus `songport` est un utilisateur non privilégié de l'image officielle : il doit pouvoir écrire dans le dossier persistant.
- Les services Spotify, Google, Deezer et autres peuvent imposer leurs propres identifiants OAuth et une URL publique HTTPS. Les connecteurs non officiels peuvent être instables.
- Trackhop Server est marqué **bêta** par son auteur. Les variables d'environnement commencent toujours par `SONGPORT_` pour compatibilité avec l'ancien nom du projet.

[Guide Docker officiel](https://trackhop.org/guide/docker) · [Dépôt source](https://github.com/xlollx/Trackhop).

**Logo :** icône officielle Trackhop © 2026 xlollx, licence **CC BY-SA 4.0**, dérivée du [SVG officiel](https://github.com/xlollx/Trackhop/blob/main/docs/store/logo.svg) (conversion JPEG pour Runtipi). Le programme Trackhop est publié sous licence AGPL-3.0-only.
