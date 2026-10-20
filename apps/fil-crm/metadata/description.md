# Fil CRM

**Version du catalogue Runtipi : 1**  
**Version du logiciel : Fil CRM 0.2.0** (image `ghcr.io/ajilis/crm:sha-b16002e`)  
**Statut :** application Ajilis, accès réseau local et Cloudflare Tunnel, sans Traefik.

Fil CRM est un CRM B2B pour PME françaises : fiches, contacts, pipeline, import CSV, **assistant IA qui décroche** (Retell) et **automate de relances par email** (Brevo). Toutes les entrées, qu'elles viennent d'un humain, de l'assistant ou de l'automate, s'écrivent sur le fil de la fiche.

Le déploiement comprend **3 conteneurs** :
- le site, qui applique les migrations de la base à chaque démarrage ;
- le worker : relances, notifications par email, purge des sessions ;
- PostgreSQL 16.

## Installer via l'App Store Ajilis

1. Dans **Runtipi → Settings → App Stores**, actualiser `https://github.com/Ajilis/runtipi-appstore`.
2. Installer **Fil CRM** sans activer l'exposition de domaine Runtipi, en laissant **Port ouvert** coché. Le port hôte est **8287**, redirigé par Runtipi vers le port interne 3000.
3. Renseigner l'**URL publique** exacte en HTTPS, par exemple `https://crm.exemple.fr`, sans slash final. Le secret de signature et le mot de passe PostgreSQL sont générés par Runtipi.
4. Dans Cloudflare Tunnel, créer un *Public Hostname* `crm.exemple.fr` avec un service HTTP :
   - `http://IP_LAN_DU_SERVEUR:8287` si `cloudflared` s'exécute dans un conteneur sans réseau hôte ou sur une autre machine ;
   - `http://127.0.0.1:8287` si `cloudflared` tourne sur le serveur en réseau hôte.

   Ne pas renseigner l'option « HTTP Host Header » : le site doit recevoir le nom de domaine public pour accepter les formulaires.
5. Ouvrir l'URL publique et cliquer sur **Créer l'espace de votre entreprise** pour créer le premier compte administrateur.

Le premier démarrage prend une à deux minutes : création de la base, migrations, puis démarrage du worker une fois le site prêt.

## Accès local et Cloudflare Tunnel

- Sur le réseau local, le site répond sur `http://IP_DU_SERVEUR:8287`.
- Le cookie de session porte l'attribut `Secure` quand la requête arrive en HTTPS par Cloudflare, et pas en HTTP local. Sans cela, le navigateur refuserait le cookie et la connexion serait impossible par l'adresse IP. C'est le réglage `SESSION_COOKIE_SECURE=auto`.
- `TRUSTED_PROXY_HOPS=1` permet de lire l'adresse IP réelle des visiteurs Cloudflare, pour la limitation des tentatives de connexion.
- **Ne pas ouvrir le port 8287 sur le routeur** et le limiter au réseau local par pare-feu. PostgreSQL ne publie aucun port.

## Fichier de configuration

`APP_DATA_DIR/config/fil.env` est créé au premier démarrage, puis conservé : il n'est jamais écrasé, même lors des mises à jour. Il se modifie en root sur le serveur. Après une modification, arrêter puis redémarrer l'application.

| Réglage | Rôle |
| --- | --- |
| `MAIL_PROVIDER` | `console` par défaut (emails affichés dans les journaux du worker, rien n'est envoyé) ; `brevo` pour un envoi réel |
| `BREVO_API_KEY`, `NOTIFICATIONS_FROM_EMAIL`, `NOTIFICATIONS_FROM_NAME` | envoi par Brevo |
| `RETELL_API_KEY` | assistant vocal (clé Retell marquée « webhook ») |
| `WORKER_INTERVAL_SECONDS` | intervalle du worker, 30 s par défaut |
| `SESSION_COOKIE_SECURE`, `TRUSTED_PROXY_HOPS` | voir ci-dessus |

L'URL publique, le secret et l'accès à la base viennent du formulaire Runtipi : ils l'emportent sur les lignes `APP_URL`, `APP_SECRET` et `DATABASE_URL` du fichier. Ces valeurs se changent dans les réglages de l'application Runtipi.

Pour l'assistant vocal, déclarer chez Retell `https://crm.exemple.fr/api/retell/webhook` et `https://crm.exemple.fr/api/retell/fonctions`. La procédure complète est dans la [documentation de l'assistant](https://github.com/Ajilis/CRM/blob/main/docs/assistant-ia.md).

## Données, sauvegardes, mises à jour

- **Données persistantes** dans `APP_DATA_DIR` :
  - `config/` : le fichier de configuration ;
  - `postgres/` : la base ;
  - `app.env` : URL et secrets gérés par Runtipi.
- **Sauvegardes.** Les sauvegardes Runtipi incluent tout `APP_DATA_DIR`. Pour une copie SQL à chaud, repérer le conteneur avec `docker ps | grep fil-crm`, puis lancer `docker exec <conteneur postgres> pg_dump -U fil fil > fil.sql`.
- **Mises à jour.** L'image est épinglée sur une version précise. Une nouvelle version passe par une nouvelle révision du catalogue, puis par **Update** dans Runtipi. Les migrations de la base s'appliquent automatiquement au démarrage.
- **Désinstaller supprime les données** : sauvegarder avant.

## Limites

- Première version déployée : la couche web compile, mais n'a pas encore été éprouvée en production. Faire un essai complet avant d'y saisir des données réelles.
- Les créneaux proposés par l'assistant ne tiennent compte que des rendez-vous saisis dans Fil : pas encore de synchronisation Google ou Outlook.
- Les réponses par email ne sont pas captées automatiquement.
- Runtipi rend le dossier `APP_DATA_DIR` lisible par tous les utilisateurs du serveur à chaque installation et à chaque démarrage. Le site remet des droits stricts (600) sur `config/fil.env` en démarrant. Réserver le compte du serveur aux administrateurs.
- Ce déploiement suit le format Runtipi `x-runtipi` version 2 et a été validé avec le code de Runtipi 4.9.1. Il n'a pas encore été testé sur une instance Runtipi réelle.

Sources : [Fil CRM](https://github.com/Ajilis/CRM), [Runtipi Dynamic Compose](https://runtipi.io/docs/reference/dynamic-compose).
