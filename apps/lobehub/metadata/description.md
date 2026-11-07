# LobeHub 2.3.2 — Runtipi 4.9.1 — un seul hostname Cloudflare

La révision Runtipi **2** garde LobeHub, PostgreSQL/ParadeDB, Redis et RustFS sur le réseau Docker interne. **Un seul port hôte 8292** est publié par une passerelle Nginx, sans Traefik.

## Installation

1. Dans Runtipi, actualiser le store `https://github.com/Ajilis/runtipi-appstore`, puis installer ou mettre à jour **LobeHub**.
2. Renseigner `LOBE_PUBLIC_URL=https://lobe.exemple.fr` et `LOBE_LAN_ORIGIN=http://192.168.1.10:8292` (adapter l'adresse à votre serveur). Limiter les inscriptions aux e-mails autorisés.
3. Configurer **un seul** hostname Cloudflare Tunnel : `lobe.exemple.fr` → HTTP `http://IP_DU_SERVEUR:8292`.
4. Accès LAN : `http://IP_DU_SERVEUR:8292` ; accès public : `https://lobe.exemple.fr`.
5. Si vous mettez à jour la version 1 : **supprimer l'ancien hostname S3, ne plus publier 8293, conserver tous vos secrets et volumes existants**.

## Architecture et sécurité

| Composant | Port hôte | Connexion |
| --- | --- | --- |
| Passerelle Nginx `lobehub-s3-gateway` | **8292** | LAN / Cloudflare Tunnel |
| Application LobeHub (3210) | Aucun | Docker privé |
| RustFS S3 (9000) | **Aucun** | Docker privé |
| PostgreSQL / ParadeDB (5432) | Aucun | Docker privé |
| Redis (6379) | Aucun | Docker privé |
| Console RustFS (9001) | Aucun | Désactivée |

Le chemin `https://lobe.exemple.fr/` est acheminé vers LobeHub. Le chemin `https://lobe.exemple.fr/lobe/<objet>?X-Amz-...` transmet **uniquement** des requêtes S3 présignées `GET`, `HEAD` et `PUT` vers RustFS dans Docker. Les `OPTIONS` répondent aux pré-requêtes CORS. Les appels non signés et les méthodes administratives sont refusés par Nginx ; RustFS vérifie ensuite la signature cryptographique, la méthode et l'expiration. Le proxy conserve l'hôte, le chemin et la query string pour ne pas casser SigV4. L'ancien accès anonyme public au bucket est supprimé (`rc anonymous set private`).

**Attention :** RustFS n'est plus directement exposé, mais une URL S3 pré-signée valide permet toujours un accès HTTP à l'objet correspondant via le chemin `/lobe/` du seul hostname public. Cela n'est PAS une interdiction absolue de toute requête S3 depuis Internet. Une isolation totale nécessiterait une modification du code de LobeHub pour faire transiter les transferts par son API applicative authentifiée, ce qui n'est pas inclus ici.

Le domaine public reste nécessaire aux transferts de fichiers depuis le LAN ; les navigateurs LAN doivent donc pouvoir le résoudre et l'atteindre. Cloudflare Access appliqué à tout le hostname peut bloquer les URL signées ou CORS, ainsi que les récupérations par certains modèles IA. Ajuster les politiques Cloudflare si nécessaire, idéalement seulement sur `/lobe/*`, sans rendre le bucket anonyme. Ne pas ouvrir de port S3 sur la box ni de NAT. Par défaut `0.0.0.0` écoute sur toutes les interfaces : préférer l'IP LAN du serveur et un pare-feu si l'hôte est multi-réseaux. Pour cloudflared en Docker distinct, `127.0.0.1` n'est pas l'hôte : utiliser l'IP LAN ou un réseau partagé.

## Persistance et sauvegardes

| Sous-dossier Runtipi `APP_DATA_DIR` | Contenu |
| --- | --- |
| `config/jwks.json` | Clé JWT privée générée une seule fois, mode 0600 |
| `config/nginx-gateway-v1.conf` | Configuration Nginx créée une seule fois et conservée |
| `postgres/` | Conversations, paramètres, utilisateurs, agents |
| `redis/` | Cache Redis / journal AOF |
| `rustfs/` | Documents, images, pièces jointes |

Runtipi conserve aussi les secrets d'installation (Better Auth, KEY_VAULTS_SECRET, mot de passe SQL, accès et secret S3). **Sauvegarder les secrets et les répertoires ensemble.** Lors d'une mise à jour ne pas régénérer les secrets ni supprimer les volumes. Pour PostgreSQL, faire une sauvegarde cohérente (`pg_dump` ou arrêt préalable).

## Vérifications

1. `curl -I http://IP_DU_SERVEUR:8292/` : LobeHub doit répondre (200 ou redirection).
2. `curl -i http://IP_DU_SERVEUR:8292/lobe/test` : **403 attendu** sans signature.
3. `docker ps` : aucune publication pour RustFS sur 8293 ni pour PostgreSQL et Redis.
4. Sur `https://lobe.exemple.fr`, tester l'authentification, l'envoi et l'aperçu d'images et de PDF, puis depuis le LAN. Pour les transferts volumineux, vérifier les limites Cloudflare et le multipart.

Le parseur Nginx et les filtrages de méthodes et signatures ont été testés sur serveur HTTP simulé. **L'exécution réelle dans Runtipi et l'intégration S3/Cloudflare de bout en bout restent à confirmer.** Agent Gateway / Device Gateway, SearXNG et Elasticsearch ne sont pas inclus.

Images : `lobehub/lobehub:2.3.2`, `paradedb/paradedb:0.26.5-pg17`, `redis:7.4-alpine`, `rustfs/rustfs:1.0.4`, `rustfs/rc:v0.1.37`, `nginx:1.28-alpine`.
