# Rendevo — sources

Agent IA de prospection LinkedIn auto-hébergé, inspiré des fonctionnalités de MimikFlow (produit indépendant, marque et code originaux). Empaqueté pour Runtipi dans [`apps/rendevo`](../../apps/rendevo).

## Architecture

```
Navigateur ──HTTP──> rendevo (Node.js 22, port 3000) ──> PostgreSQL 17
                        │  API REST /api/*        │
                        │  Connecteur MCP /mcp    │
                        │  Interface React (web/dist)
                        └─ Worker intégré (toutes les 20 s)
                             ├─ synchronisation des comptes (acceptations, réponses)
                             ├─ progression des séquences
                             ├─ file d'envoi à rythme humain (fenêtre, budgets, délais aléatoires)
                             ├─ rappels de RDV, relances datées, recherche automatique
                             └─ webhooks signés
Fournisseurs LinkedIn : simulation (bac à sable) · Unipile · manuel · cookie (profil uniquement)
IA : API compatible OpenAI ou Anthropic, sinon modèles et règles intégrés
```

Aucune dépendance npm à l'exécution : serveur HTTP, client PostgreSQL (SCRAM-SHA-256), chiffrement AES-GCM et planificateur sont écrits avec les modules natifs de Node.js. Seule la bibliothèque `yaml` (ISC) est embarquée dans `server/vendor/`. L'interface est compilée dans `web/dist` (commitée), l'image Docker n'a donc aucune étape de build.

| Dossier | Rôle |
| --- | --- |
| `server/lib` | HTTP, PostgreSQL, CSV, iCal, crypto, dates/fuseaux |
| `server/services` | IA, qualification, agent (séquences + setter), agenda, worker, fournisseurs |
| `server/routes` | Auth/espaces, réglages/comptes/campagnes, prospects, messages, agenda public, médias/webhooks/stats, MCP |
| `server/db/migrations` | Schéma SQL appliqué au démarrage |
| `web/src` | Interface React (tableau de bord, prospects, campagnes, messages, agenda, médias, réglages, pages publiques) |

## Connexion expérimentale à son propre LinkedIn par cookies

Dans **Réglages → Comptes LinkedIn → Ajouter un compte**, choisir **Mon LinkedIn (cookie)**.
Renseigner **les deux valeurs** `li_at` et `JSESSIONID` de votre propre navigateur déjà connecté,
puis cliquer sur **Ajouter** et **Tester**. Ces informations sont des identifiants de session
équivalents à un mot de passe : ne les communiquez jamais par chat, e-mail ou ticket.
Rendevo chiffre les deux valeurs avec le secret applicatif et ne les renvoie pas dans son API.

Après la connexion, **Réglages → Comptes LinkedIn** affiche le nom, l'intitulé du profil, la photo (si disponible) et le lien vers le profil. Le bouton **Tester** lance explicitement la vérification et mémorise les informations publiques du profil dans la configuration du compte. Le simple chargement ou rafraîchissement de la page n'appelle jamais LinkedIn et ne modifie jamais le statut du compte. Un contrôle échoué, même en cas de réponse HTTP 401, ne modifie jamais l'état d'un compte déjà vérifié. L'échec reste visible dans la notification : il ne garantit ni l'expiration ni la validité de la session. Seul un contrôle réussi marque un compte Actif. Le statut « Dernier test OK » désigne le dernier contrôle positif, et non une garantie de validité permanente. Aucun cookie n'est envoyé au navigateur.

Le contrôle en lecture seule utilise un en-tête User-Agent de **Chrome 143 sur macOS**, mais reste une requête Node.js ponctuelle, pas un navigateur réel. Ce changement ne garantit pas que LinkedIn autorise ou reconnaisse la session.

**Diagnostic de session (0.1.6) :** Réglages → Comptes LinkedIn affiche la présence (mais non la valeur) des cookies chiffrés, la dernière vérification réussie et la dernière vérification échouée, le code HTTP et une catégorie d'erreur autorisée. Les requêtes ne sont effectuées qu'après clic sur **Tester** ; un verrou atomique PostgreSQL impose **90 secondes** entre deux tests par compte et indique le délai restant. Un échec ne déconnecte pas le compte et ne modifie pas ses cookies. Remplacer les cookies efface les anciennes informations de profil et de diagnostic. Aucun navigateur dédié n'est utilisé et le dernier succès ne garantit pas que la session soit toujours valide.

**Diagnostic réseau (0.1.7) :** la vérification utilise `redirect: 'manual'` pour distinguer les redirections LinkedIn HTTP 301/302/303/307/308 des erreurs de transport, sans jamais suivre une redirection avec les cookies. Les catégories DNS, TLS/certificat, connexion coupée/refusée, délai dépassé et panne réseau indéterminée sont affichées séparément. Ni URL de redirection, ni message d'exception, ni cookie ne sont enregistrés dans le diagnostic. Une redirection peut indiquer une étape de connexion ou de contrôle côté LinkedIn, mais le diagnostic ne prouve pas la validité de la session. Le délai minimal de 90 secondes entre tests et la conservation du dernier état validé restent inchangés.

**Analyse des redirections (0.1.8) :** lorsque LinkedIn renvoie HTTP 301/302/303/307/308, Rendevo examine **sans suivre** l'en-tête Location pour classifier uniquement la destination : page de connexion LinkedIn, vérification de sécurité, autre page LinkedIn, destination externe/non HTTPS ou cible absente/inconnue. Seule la catégorie autorisée est renvoyée au navigateur et enregistrée dans PostgreSQL ; l'URL complète, les paramètres, les cookies et les en-têtes bruts ne sont jamais exposés ni conservés dans le diagnostic. Une redirection seule ne prouve pas l'expiration des cookies. Les vérifications restent manuelles, espacées de 90 secondes, et préservent le dernier résultat positif.

**Familles de redirection détaillées (0.1.9) :** la destination HTTP 301/302/303/307/308 est désormais classée, sans jamais suivre la redirection, entre connexion directe, vérification de sécurité, authentification/autorisation indirecte, accueil/fil d’actualité, page de profil, chemin d’API Voyager, autre page LinkedIn, destination externe ou destination inconnue. La classification inspecte uniquement le protocole, le domaine et la famille du **chemin**. Les paramètres d’URL, fragments, chemins complets, cibles de redirection et cookies ne sont ni exposés ni enregistrés ; seule une catégorie fixe est persistée. Ces étiquettes sont des indices, pas une preuve de validité ou d’expiration de session.

**Limite volontaire :** le test réalise seulement une requête HTTPS de lecture sur
`www.linkedin.com/voyager/api/me` pour vérifier la session. L'API Voyager est interne,
non documentée et peut changer ou refuser l'accès à tout moment. Le connecteur
n'effectue **aucun envoi automatique, invitation, recherche ni synchronisation** ;
les campagnes avec ce compte doivent être opérées manuellement. Ce connecteur ne
donne accès ni à une API LinkedIn officiellement prise en charge ni à un OAuth approuvé.
Pour l'automatisation prévue par Rendevo, l'intégration Unipile reste distincte.

**Risque et conformité :** LinkedIn interdit l'utilisation de cookies copiés et les
méthodes automatisées non autorisées. Votre compte peut être restreint. N'utilisez
pas ce connecteur pour contourner un contrôle de connexion. Pour invalider la
session, déconnectez-la dans LinkedIn ; supprimer le compte Rendevo supprime
sa copie locale des cookies.

## Développement

```bash
npm install                     # outils de build (esbuild, react, react-icons)
npm run build:web               # recompile web/dist
DATABASE_URL=postgres://user:pass@localhost:5432/rendevo DATA_DIR=./data npm start
```

Variables : `DATABASE_URL`, `APP_SECRET`, `PUBLIC_URL`, `ALLOW_SIGNUP`, `PORT`, `DATA_DIR`, `TZ`, `AI_PROVIDER`, `AI_BASE_URL`, `AI_MODEL`, `AI_API_KEY`. Le fichier `DATA_DIR/config/rendevo.yml` est créé au premier démarrage.

Pour tester tout le parcours rapidement : compte « Bac à sable », puis dans `rendevo.yml` :

```yaml
worker: { tick_seconds: 5, min_gap_seconds: 2, max_gap_seconds: 4 }
simulation: { speed: 3600 }
```

## Feuille de route

| Étape | Contenu | État |
| --- | --- | --- |
| 1. Cadrage | Analyse fonctionnelle, marque, architecture, modèle de données | Fait |
| 2. Socle | Auth, espaces clients, rôles, réglages, fichier de configuration, migrations | Fait |
| 3. Ciblage | Analyse de l'offre (site web + IA), ICP, qualification et score raisonné, signaux d'achat, import CSV/URLs | Fait |
| 4. Moteur | Séquences, file d'envoi, budgets par compte, fenêtre horaire, délais aléatoires, validation humaine | Fait |
| 5. Setter IA | Intentions, créneaux réels, réservation, confirmation, rappels, absence, relance datée, transfert humain | Fait |
| 6. Agenda | Disponibilités, iCal entrant (occupé) et sortant, page de réservation, visio Jitsi par défaut | Fait |
| 7. Intégrations | Unipile, webhooks signés, connecteur MCP, médias vidéo | Fait |
| 8. À venir | Webhooks Unipile temps réel, OAuth Google/Outlook, Cal.com/Calendly, WhatsApp, A/B testing, CRM natifs (HubSpot, Pipedrive, Folk), e-mails transactionnels, tests automatisés | Prévu |
