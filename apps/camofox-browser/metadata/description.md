# Camofox Browser — Runtipi 4.9.1

Serveur HTTP de navigation Camoufox headless pour agents IA, basé sur [jo-inc/camofox-browser](https://github.com/jo-inc/camofox-browser). Image officielle `ghcr.io/jo-inc/camofox-browser:1.18.1`.

## Installation

1. Ajouter ou actualiser le store `https://github.com/Ajilis/runtipi-appstore`, puis installer **Camofox Browser**.
2. Récupérer et conserver le **jeton de sécurité** généré à l'installation (variable `CAMOFOX_SHARED_KEY`). Il sert aux trois protections natives : `CAMOFOX_ACCESS_KEY`, `CAMOFOX_API_KEY` et `CAMOFOX_ADMIN_KEY`.
3. Accès LAN : `http://IP_DU_SERVEUR:8290/health` ou documentation API `http://IP_DU_SERVEUR:8290/docs`. **Ce projet est avant tout une API, pas une interface de navigation graphique.** La plupart des routes nécessitent `Authorization: Bearer VOTRE_JETON`.
4. Dans Cloudflare Zero Trust → Networks → Tunnels, associer un hostname public HTTPS au service HTTP `http://IP_DU_SERVEUR:8290`. Si cloudflared fonctionne sur le même hôte hors Docker, `http://127.0.0.1:8290` convient avec la valeur d'écoute par défaut `0.0.0.0`. Si cloudflared fonctionne dans un conteneur, `127.0.0.1` pointe vers ce conteneur et **non** vers Runtipi : utiliser l'IP LAN du serveur ou une liaison Docker explicitement configurée.

## Réseau et sécurité

- Port hôte `8290/tcp` publié directement vers `9377/tcp` dans le conteneur ; aucune déclaration `x-runtipi.is_main` ni routage Traefik ; label `traefik.enable=false`.
- Le réglage d'installation `CAMOFOX_LISTEN_ADDRESS` vaut `0.0.0.0` pour permettre accès LAN et tunnel. Il **ne remplace pas un pare-feu** : ne transférez pas le port depuis la box et refusez l'accès externe direct ; vous pouvez indiquer l'IP LAN du serveur si préférable.
- L'accès HTTP à l'API est protégé par un jeton Bearer, y compris via le tunnel. `/health` reste non authentifié pour les sondes. Il est recommandé de protéger également le hostname public par Cloudflare Access.
- Aucun port VNC n'est ouvert. La télémétrie de crash est désactivée.

## Persistance

Les deux montages sont créés dans `app-data/<slug-du-store>/camofox-browser/` :

| Dossier Runtipi | Dossier conteneur | Rôle |
| --- | --- | --- |
| `config/` | `/persistent-config` | `camofox.config.json`, copié depuis l'image au premier lancement, puis réutilisé |
| `data/` | `/data` | Profils, cookies, stockage navigateur, uploads et traces |

- La configuration éditée est copiée dans `/app/camofox.config.json` à chaque démarrage, sans être écrasée côté hôte ; redémarrer pour appliquer les changements.
- Le plugin de persistance de Camofox sauvegarde les cookies et localStorage dans `data/profiles/<hash-utilisateur>/storage_state.json`. IndexedDB n'est conservé que s'il est activé dans la configuration du plugin (`"indexedDB": true`).
- **Camofox ne requiert pas de base de données PostgreSQL/MySQL distincte.** Les données à sauvegarder sont surtout les états de session et les fichiers `config/` et `data/` ; il n'est pas correct d'inventer un service SQL.
- Sauvegarder `config/`, `data/` ainsi que le jeton défini dans Runtipi avant toute désinstallation ou migration.

## Vérification

```bash
curl -fsS http://IP_DU_SERVEUR:8290/health
curl -fsS -H 'Authorization: Bearer VOTRE_JETON' http://IP_DU_SERVEUR:8290/openapi.json
```

Compatibilité prévue pour Runtipi **4.9.1** et architectures Linux **amd64/arm64**. Installation et santé du conteneur sur votre serveur réel non testées ici. Source du logo PNG d'origine : [fox.png](https://github.com/jo-inc/camofox-browser/blob/master/fox.png).
