# LiteLLM — Runtipi 4.9.1 (LAN et Cloudflare Tunnel)

LiteLLM est une passerelle API unifiée pour les modèles LLM, avec interface d'administration, gestion des modèles et des clés virtuelles, et suivi de consommation.

## Installation et accès

1. Dans Runtipi, ajoutez l'App Store `https://github.com/Ajilis/runtipi-appstore` puis actualisez le catalogue.
2. Installez **LiteLLM**. Runtipi génère une clé administrateur, une clé de chiffrement et un mot de passe PostgreSQL. **Conservez ces valeurs et le fichier `app.env`.**
3. Sur le réseau local, ouvrez `http://IP_DU_SERVEUR:8294/ui` (racine API : `http://IP_DU_SERVEUR:8294`). La clé maîtresse est `sk-` suivi de la valeur `LITELLM_MASTER_SECRET` générée par Runtipi.
4. Pour Cloudflare Tunnel, créez un hostname public HTTPS dont le service d'origine est `http://IP_DU_SERVEUR:8294`. Aucun domaine ni routage Traefik ne doit être configuré dans Runtipi. Si `cloudflared` fonctionne directement sur le serveur, `http://127.0.0.1:8294` convient également.
5. Protégez le domaine public, et notamment `/ui`, avec **Cloudflare Access**. Le tunnel n'ajoute pas automatiquement une authentification à l'interface LiteLLM.

## Persistance et sauvegarde

- `${APP_DATA_DIR}/config/config.yaml` : configuration éditable, créée au premier démarrage et **jamais écrasée** au redémarrage ou à la mise à jour.
- `${APP_DATA_DIR}/postgres/` : données PostgreSQL (modèles enregistrés depuis l'UI, clés virtuelles, comptes, suivi d'usage).
- `app.env` de Runtipi : secrets générés lors de l'installation. Sauvegarder les secrets avec la base et le fichier YAML. **Ne jamais régénérer `LITELLM_SALT_SECRET` sur une base existante.**

Le fichier YAML démarre avec `model_list: []` : ajoutez vos fournisseurs et modèles via l'interface d'administration ou éditez ce fichier, puis redémarrez LiteLLM. `STORE_MODEL_IN_DB=True` active la conservation des modèles créés via l'interface.

## Réseau

Seul le port hôte **8294/tcp** est publié (`8294:4000/tcp`). PostgreSQL reste privé sur le réseau Docker. Aucune route Traefik n'est créée : `exposable: false`, aucune déclaration `x-runtipi.is_main`, et `traefik.enable: "false"` sur LiteLLM.

**Important :** publier `8294` sur l'hôte rend le service accessible sur toutes les interfaces de celui-ci, sauf filtrage réseau. Limitez l'accès au LAN au moyen d'un pare-feu sur le serveur ou le routeur. N'ouvrez **pas** le port 8294 sur la box Internet : Cloudflare Tunnel utilise une connexion sortante.

## Maintenance

- Image LiteLLM versionnée : `ghcr.io/berriai/litellm:v1.108.0`.
- Base PostgreSQL : `postgres:16` (même version majeure lors des mises à jour courantes).
- Pour une sauvegarde cohérente, exécutez `pg_dump` ou arrêtez le service avant une copie du répertoire PostgreSQL. Une simple copie à chaud des fichiers PostgreSQL peut être incohérente.
- Le service d'initialisation écrit `config.yaml` uniquement si le fichier est absent.

Sources : [LiteLLM](https://github.com/BerriAI/litellm) · [Documentation LiteLLM](https://docs.litellm.ai/docs/proxy/docker_quick_start) · [Documentation Runtipi](https://runtipi.io/docs/guides/create-your-own-app-store).
