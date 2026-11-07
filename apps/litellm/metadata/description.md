# LiteLLM — Runtipi 4.9.1 (LAN et Cloudflare Tunnel)

LiteLLM est une passerelle API unifiée pour les modèles LLM, avec interface d'administration, gestion des modèles et des clés virtuelles, et suivi de consommation.

## Installation et accès

1. Dans Runtipi, ajoutez l'App Store `https://github.com/Ajilis/runtipi-appstore` puis actualisez le catalogue.
2. Installez **LiteLLM**. Runtipi génère une clé maîtresse API, une clé de chiffrement et un mot de passe PostgreSQL. **Choisissez également le mot de passe de l'interface administrateur**, distinct de la clé API maîtresse. Conservez tous ces secrets et le fichier `app.env`.
3. Sur le réseau local, ouvrez `http://IP_DU_SERVEUR:8294/ui` (racine API : `http://IP_DU_SERVEUR:8294`). Connectez-vous avec l'identifiant `admin` et le mot de passe saisi dans le champ **Mot de passe administrateur LiteLLM** (`LITELLM_ADMIN_PASSWORD`). La clé maîtresse de l'API reste `sk-` suivi de `LITELLM_MASTER_SECRET`.
4. Pour Cloudflare Tunnel, créez un hostname public HTTPS dont le service d'origine est `http://IP_DU_SERVEUR:8294`. Aucun domaine ni routage Traefik ne doit être configuré dans Runtipi. Si `cloudflared` fonctionne directement sur le serveur, `http://127.0.0.1:8294` convient également.
5. Protégez le domaine public, et notamment `/ui`, avec **Cloudflare Access**. Le tunnel n'ajoute pas automatiquement une authentification à l'interface LiteLLM.

## Authentification administrateur

- Identifiant UI : `admin` (variable `UI_USERNAME`).
- Mot de passe UI : champ obligatoire `LITELLM_ADMIN_PASSWORD` (transmis à `UI_PASSWORD`).
- Le mot de passe est distinct de `LITELLM_MASTER_KEY`. **Attention : LiteLLM accepte encore la clé maîtresse comme identifiant de connexion de secours tant que le login par secrets d'environnement est autorisé.**
- Pour renforcer la sécurité à long terme, créez un utilisateur individuel `proxy_admin` dans LiteLLM, testez sa connexion, puis configurez `general_settings.disable_env_credential_login: true`. Ne le faites pas avant la création du compte, sous peine de perdre l'accès à l'UI.
- **Si LiteLLM est déjà installé**, actualisez l'App Store et renseignez `LITELLM_ADMIN_PASSWORD` dans la configuration de l'application avant de recréer le conteneur. Sans valeur, la connexion avec le nouveau mot de passe ne fonctionnera pas ; vérifiez aussi les overrides éventuels dans `user-config`.

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
- Le service LiteLLM initialise `config.yaml` lui-même **uniquement si le fichier est absent** ; aucun conteneur d'initialisation séparé n'est créé. Deux conteneurs permanents restent en service (`litellm`, `postgres`), évitant le statut erroné `2/3 running` de Runtipi 4.9.1.

Sources : [LiteLLM](https://github.com/BerriAI/litellm) · [Documentation LiteLLM](https://docs.litellm.ai/docs/proxy/docker_quick_start) · [Documentation Runtipi](https://runtipi.io/docs/guides/create-your-own-app-store).

## Correction Runtipi, révision 3 — état 2/3 conteneurs

Le service ponctuel `litellm-config-init` a été supprimé : Runtipi 4.9.1 comptait son arrêt normal comme un service défaillant et affichait l'application comme `stopped`. LiteLLM initialise maintenant la configuration au démarrage dans le même conteneur, puis exécute son entrypoint officiel. **Aucune suppression de la base PostgreSQL ni du fichier `config.yaml` n'est nécessaire.** Mettre à jour le catalogue puis recréer l'application depuis Runtipi sans désinstaller les données. Contrôler `docker compose ps` et les journaux de `litellm` si un des deux services ne démarre pas.
