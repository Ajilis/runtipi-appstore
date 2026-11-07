# LobeHub 2.3.2 — Runtipi 4.9.1 — administrateur global et inscriptions verrouillées

Révision Runtipi **5**. LobeHub est hébergé avec ParadeDB/PostgreSQL, Redis, RustFS et une passerelle Nginx sous **un seul hostname Cloudflare Tunnel**. **La première identité est un administrateur global**, créé **avant toute ouverture de l'interface publique**. Les utilisateurs suivants ne peuvent être créés que par cet administrateur au moyen de l'API Better Auth existante.

## Clé Vault : génération sûre et réutilisation (révision Runtipi 5)

Le champ Runtipi `LOBE_KEY_VAULTS_SECRET` génère **64 caractères hexadécimaux**, correspondant à **32 octets aléatoires**. LobeHub attend un encodage **Base64 de 16, 24 ou 32 octets** ; dans cette application, la clé utilisée est toujours de **32 octets**.

- **Première installation :** Runtipi crée le secret une seule fois et le conserve dans `app.env`. Au démarrage, LobeHub convertit la représentation hexadécimale en Base64 canonique avant de charger le serveur. Il n'y a pas de création d'un second secret ni de modification de `app.env`.
- **Redémarrage et mise à jour :** le même secret hexadécimal donne la même clé Base64, sans rotation. Les valeurs Base64 canoniques qui représentent déjà exactement 32 octets (par exemple après une correction manuelle) sont conservées telles quelles.
- **Valeur absente ou incorrecte :** le démarrage échoue avec un message explicite **sans remplacer la clé**. Ne pas réinstaller ni réinitialiser PostgreSQL pour contourner ce contrôle. Vérifier la valeur existante dans les paramètres Runtipi, sans la publier dans des logs ou un ticket.
- **Sauvegarde :** sauvegarder conjointement la configuration Runtipi (`app.env`), `config/jwks.json` et la base PostgreSQL. Toute rotation voulue doit être planifiée avec une migration des données chiffrées.

Cette correction prend aussi en charge les installations existantes qui conservent la valeur hexadécimale de 64 caractères générée par les révisions antérieures : la conversion est **déterministe** et ne régénère rien. Aucun secret n'est imprimé dans les journaux.

## Installation initiale

1. Dans Runtipi, actualiser le store `https://github.com/Ajilis/runtipi-appstore`, puis installer **LobeHub**.
2. Remplir `LOBE_PUBLIC_URL` (`https://lobe.exemple.fr`) et `LOBE_LAN_ORIGIN` (`http://IP_DU_SERVEUR:8292`).
3. Dans **E-mail du premier administrateur global**, indiquer votre adresse e-mail ; saisir un **mot de passe initial de 12 à 64 caractères** dans le champ Runtipi dédié. Le mot de passe doit rester confidentiel.
4. Démarrer l'application. Les services `lobehub-admin-precheck`, `lobehub-admin-register`, `lobehub-admin-promote` s'exécutent **avant** le démarrage de la passerelle publique. Si la base est vide, le premier compte est créé par une requête Better Auth interne, puis reçoit le rôle `admin` Better Auth **et** le rôle global `super_admin` RBAC, avec les permissions existantes. Les données et les secrets restent persistants.
5. Dans Cloudflare Zero Trust → Tunnels → Public Hostnames, conserver un **seul hostname** `lobe.exemple.fr` → HTTP `http://IP_DU_SERVEUR:8292`. Accès LAN : `http://IP_DU_SERVEUR:8292` ; accès distant : `https://lobe.exemple.fr`.
6. Se connecter à `https://lobe.exemple.fr/signin` avec l'adresse et le mot de passe renseignés dans Runtipi.

### Si LobeHub était déjà installé

- **Ne pas supprimer ou réinitialiser les volumes, secrets Better Auth, mots de passe PostgreSQL/S3, ni `config/jwks.json`.**
- Renseigner comme `LOBE_ADMIN_EMAIL` **l'e-mail d'un utilisateur qui existe déjà** dans la base. Le compte existant est élevé administrateur global : **son mot de passe n'est pas modifié**. Le champ de mot de passe initial Runtipi n'est utilisé que si la base est vide.
- S'il existe déjà des comptes mais aucun ne correspond à l'e-mail configuré, l'initialisation échoue volontairement et la passerelle publique ne démarre pas. Corriger l'e-mail dans Runtipi ; ne pas supprimer les données pour contourner ce contrôle.
- La liste `LOBE_ALLOWED_EMAILS` de l'ancienne révision n'est plus utilisée : les créations de comptes sont désormais contrôlées par l'API administrateur et non par une inscription publique.

## Comptes : page d'administration

Après connexion avec l'administrateur global, ouvrir **`https://lobe.exemple.fr/_runtipi_admin/`** (ou `http://IP_DU_SERVEUR:8292/_runtipi_admin/` sur le LAN). Il s'agit d'une **interface complémentaire, fournie par le paquet Runtipi**, pas d'un écran natif de LobeHub.

- Cette page vérifie la session actuelle Better Auth et n'affiche les actions de gestion qu'aux comptes ayant le rôle `admin`.
- L'API native `GET /api/auth/admin/list-users` permet de voir les comptes, et `POST /api/auth/admin/create-user` de créer un compte standard avec nom, e-mail et mot de passe provisoire. L'autorisation est vérifiée **côté serveur** par le plugin Better Auth `admin()` de LobeHub.
- La création d'un utilisateur standard **ne donne aucun droit d'administrateur**. Communiquer son mot de passe provisoire de manière sûre ; demander à l'utilisateur de le changer après connexion. Ce paquet ne comprend pas d'envoi d'e-mail automatique ni de procédure d'invitation par lien.
- L'accès public à `/api/auth/sign-up/*` est refusé par Nginx (`403`), et `/signup` redirige vers `/signin`. Une éventuelle mention « S'inscrire » encore affichée par le client LobeHub ne permet **pas** de créer un compte.
- La connexion par e-mail et mot de passe (`/api/auth/sign-in/email`) reste disponible. Les méthodes de création implicite de comptes par authentification anonyme et sociale ne sont pas activées sur cette installation. Les routes de connexion par code OTP et par magic link sont également refusées par la passerelle.

**Sécurité du premier compte :** aucun visiteur Internet ne peut « réclamer » le rôle admin en étant le premier à visiter le formulaire public. Le tout premier compte est provisionné par Runtipi à travers une requête **interne**, sans port LobeHub exposé. Le mot de passe initial figure dans les variables sécurisées de Runtipi : protéger les sauvegardes et accès à `app.env`. Le processus de provisionnement est idempotent : il ne réinitialise jamais le mot de passe d'un utilisateur déjà présent.

## Architecture réseau et RustFS

| Composant | Port publié sur le serveur | Accès |
| --- | --- | --- |
| `lobehub-s3-gateway` (Nginx) | **8292** | LAN + Cloudflare Tunnel |
| LobeHub | Aucun (3210 interne) | Docker uniquement |
| PostgreSQL / ParadeDB | Aucun (5432 interne) | Docker uniquement |
| Redis | Aucun (6379 interne) | Docker uniquement |
| RustFS S3 | **Aucun** (9000 interne) | Docker uniquement |
| Console RustFS | Aucun | Désactivée |

Aucun service n'utilise le routage Traefik (`traefik.enable=false`). Ne pas publier de port via NAT sur le routeur. Si le serveur possède plusieurs interfaces, définir `LOBE_BIND_IP` avec l'IP LAN ou utiliser un pare-feu ; `0.0.0.0` écoute sur toutes les interfaces. Pour cloudflared dans un conteneur séparé, `127.0.0.1` n'est pas l'IP de l'hôte Runtipi.

Les transferts S3 signés `GET`, `HEAD` et `PUT` utilisent `https://lobe.exemple.fr/lobe/<objet>?X-Amz-...`. Nginx refuse les accès S3 non signés et les opérations d'administration ; RustFS valide ensuite les signatures. Les anciens accès anonymes au bucket sont révoqués au démarrage. **Toute personne possédant une URL S3 signée valide peut accéder temporairement à l'objet concerné**, même si RustFS n'a pas de port publié. Pour rendre tout accès aux fichiers exclusivement authentifié par l'application, une modification plus profonde de LobeHub serait nécessaire.

Les navigateurs LAN doivent pouvoir accéder à `https://lobe.exemple.fr` pour les URL signées. La valeur canonique `APP_URL` peut déclencher des redirections HTTPS depuis le LAN. Cloudflare Access sur tout le hostname peut bloquer les téléchargements signés ou certaines requêtes CORS : vérifier les politiques Cloudflare si nécessaire. La taille des fichiers reste soumise aux limites du compte Cloudflare.

## Persistance et sauvegardes

| Emplacement sous `APP_DATA_DIR` | Contenu |
| --- | --- |
| `config/jwks.json` | Clé privée Better Auth/JWKS, créée une seule fois |
| `config/nginx-gateway-v3.conf` | Configuration de la passerelle Nginx, créée une seule fois |
| `config/runtipi-admin-v1.html` | Page de gestion des comptes, créée une seule fois |
| `config/runtipi-admin-state` | État du provisionnement admin |
| `postgres/` | Comptes, rôles `admin` / `super_admin`, agents, conversations |
| `redis/` | Cache et AOF Redis |
| `rustfs/` | Documents, images, pièces jointes |

Runtipi conserve également les variables sensibles. Sauvegarder ensemble les variables d'environnement et ces volumes. Pour une sauvegarde PostgreSQL cohérente, utiliser `pg_dump` ou arrêter la pile. Une mise à jour n'écrase pas les fichiers de configuration versionnés existants, ni les mots de passe utilisateurs.

## Tests après déploiement

1. Vérifier dans les journaux Docker que les services `lobehub-admin-precheck`, `lobehub-admin-register`, `lobehub-admin-promote` se terminent avec succès. En cas d'échec, la passerelle reste fermée : **ne pas supprimer la base de données**.
2. `curl -i -X POST http://IP_DU_SERVEUR:8292/api/auth/sign-up/email` doit retourner **403**. `curl -I http://IP_DU_SERVEUR:8292/signup` doit rediriger vers `/signin`.
3. Se connecter avec le premier compte, ouvrir `/_runtipi_admin/`, créer un utilisateur standard et vérifier qu'il peut se connecter sans pouvoir créer d'autres comptes.
4. Tester avec un utilisateur non administrateur : l'API `/api/auth/admin/create-user` doit refuser l'opération.
5. `curl -i http://IP_DU_SERVEUR:8292/lobe/test` doit retourner **403** sans URL S3 signée ; `docker ps` ne doit pas publier 8293. Tester ensuite un PDF et une image, leur lecture et leur téléchargement via l'URL publique.

**Limite de validation :** le code de LobeHub 2.3.2 confirme les routes Better Auth et le schéma PostgreSQL utilisés. La syntaxe des scripts JavaScript a été vérifiée ; en revanche aucun déploiement Docker, aucune création réelle de compte, aucune requête PostgreSQL de ce scénario et aucun test de bout en bout Cloudflare/RustFS n'ont pu être exécutés sur votre Runtipi. Installer cette révision après sauvegarde des données et vérifier les journaux.

Versions : LobeHub `2.3.2`, ParadeDB `0.26.5-pg17`, PostgreSQL helper `17-alpine`, Node.js helper `24-alpine`, Redis `7.4-alpine`, RustFS `1.0.4`, RustFS rc `v0.1.37`, Nginx `1.28-alpine`. Sans Agent Gateway, Device Gateway, SearXNG ni Elasticsearch.
