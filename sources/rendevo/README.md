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

## Recherche LinkedIn assistée via Chrome Companion (0.2.7 / Runtipi V18)

Depuis **Prospects → Trouver des prospects**, le nouveau mode **Dans mon LinkedIn (Companion)** fonctionne **sans clé Brave Search**. Installer l'extension Companion V18 depuis **Réglages → Intégrations**, sélectionner une campagne de type `linkedin_companion` dans l'extension et cliquer sur **Rechercher dans mon LinkedIn**. Rendevo fournit via l'API Companion uniquement les mots-clés autorisés de la cible de la campagne (premier poste, secteur, localisation et mot-clé), modifiables dans l'extension. Un clic explicite ouvre un onglet standard de recherche de personnes LinkedIn, dans la session Chrome déjà connectée, sans requête réseau du serveur vers LinkedIn.

**Important :** la recherche s'effectue visuellement sur le site LinkedIn ; Companion n'accède pas au contenu de la page, n'extrait pas automatiquement la liste de résultats, et ne récupère aucun cookie. L'utilisateur ouvre les profils retenus un à un et valide leur ajout via Companion. Cette fonctionnalité ne contourne aucune restriction de compte et n'utilise pas une API LinkedIn officielle. Pour obtenir une liste indexée directement dans Rendevo, le mode alternatif Brave Search reste disponible.

## Découverte de profils professionnels depuis le web public (0.2.6 / catalogue V17)

Dans **Prospects → Trouver des prospects**, sélectionner **Recherche web publique** : Rendevo propose une recherche de profils LinkedIn déjà indexés par l'API [Brave Search](https://brave.com/search/api/), sans ouvrir de session LinkedIn ni interroger LinkedIn ou son API Voyager. Un abonnement/API key Brave personnel est nécessaire ; cette clé se saisit dans la fenêtre de recherche, est chiffrée AES-GCM dans les réglages de l'espace et n'est pas renvoyée par les API Rendevo. Le fournisseur Brave facture ses requêtes selon son barème et propose un crédit mensuel ; aucune clé n'est préconfigurée.

Choisir éventuellement une campagne **assistée**, renseigner poste, secteur, localisation, mots-clés (les critères de la campagne peuvent être repris), puis cliquer **Rechercher des profils**. Chaque requête explicite interroge l'index Brave une fois, avec un maximum de 20 résultats, et un délai minimal de 10 secondes entre recherches. Les URLs sont validées (HTTPS et domaine LinkedIn exact) et normalisées ; les titres/extraits affichés sont des **suggestions indicatives**, potentiellement anciennes.

**Aucun prospect n'est ajouté au stade de la recherche.** Cocher les personnes pertinentes, contrôler l'URL source et corriger le nom proposé, puis cliquer **Importer les profils sélectionnés**. L'import s'effectue uniquement dans une campagne assistée du même espace (ou sans campagne) et respecte les doublons existants. Messages et invitations restent entièrement manuels. Aucune collecte de cookies, aucun scraping, aucun accès automatique à LinkedIn.

## Télécharger Chrome Companion directement depuis Rendevo (0.2.5 / Runtipi V16)

Dans **Réglages → Intégrations → Rendevo Companion**, le bouton **Télécharger l’extension Chrome (.zip)** appelle directement la route authentifiée `GET /api/companion/download`. Rendevo fournit le fichier `Rendevo-Companion-V16.zip` depuis son conteneur Docker. L'archive est créée pendant la construction de l'image Docker à partir des fichiers `extension/`, puis placée dans `web/dist` ; aucun appel à GitHub n'est nécessaire lors du téléchargement. Décompresser le ZIP et charger le dossier contenant `manifest.json` depuis `chrome://extensions` → Mode développeur → Charger l'extension non empaquetée. Les jetons Companion, les cookies LinkedIn et les données de compte existants restent inchangés.

## Rendevo Companion connecté directement (0.2.4 / Runtipi V15)

Depuis V15, l'extension Chrome communique directement avec une API Rendevo **limitée et révocable**, sans onglet intermédiaire pour l'import. Créez un code d'association à usage unique (5 minutes) dans **Réglages → Intégrations** ; saisissez-le dans l'extension après avoir autorisé l'origine HTTPS de votre propre Rendevo. L'extension reçoit un jeton Companion valable 90 jours, uniquement autorisé à consulter les campagnes Companion et à importer sur clic une URL de profil LinkedIn. Le serveur ne stocke que les hashes des codes et jetons. Les dispositifs sont révocables dans les réglages. Une migration non destructive `002_companion.sql` initialise les tables nécessaires. Aucune lecture de cookies LinkedIn, aucun scraping et aucun envoi de messages.

## Rendevo Companion pour Chrome (0.2.3 / Runtipi V14)

**Alternative sans copie de cookies**. Le fournisseur « LinkedIn Companion (Chrome) » n'exécute aucun appel à LinkedIn depuis Rendevo. Le moteur de campagne impose l'import manuel de prospects et la validation humaine des brouillons ; l'envoi reste à la charge de l'utilisateur dans LinkedIn.

**Installer l'extension :** téléchargez l'artefact `Rendevo-Companion-V16` depuis le workflow [Rendevo image](https://github.com/Ajilis/runtipi-appstore/actions/workflows/rendevo-image.yml), extrayez le fichier ZIP et sélectionnez le dossier contenant `manifest.json` dans `chrome://extensions` → Mode développeur → Charger l'extension non empaquetée.

**Associer l'application :** ouvrir l'extension et enregistrer l'URL HTTPS de votre instance (voir **Réglages → Intégrations**). L'extension conserve uniquement cette origine dans le stockage local Chrome, sans token ni cookie. Dans le même navigateur, connectez-vous normalement à Rendevo. Créez un compte « LinkedIn Companion (Chrome) », associez-le à une campagne assistée. Depuis une page de profil LinkedIn `/in/…`, cliquez sur l'extension puis « Préparer l'import » : le formulaire d'import de Rendevo s'ouvre avec l'URL préremplie, mais **aucune importation n'est faite sans cliquer « Importer »**.

L'extension lit uniquement l'URL de l'onglet actif sur action explicite de l'utilisateur ; elle ne lit ni cookies ni DOM LinkedIn, n'installe aucun script dans la page, n'effectue aucune requête réseau vers LinkedIn et ne détient aucune autorisation d'hôte. Les messages approuvés se copient manuellement depuis Rendevo, et l'utilisateur confirme leurs envois réels. Ce mode ne prétend pas être une API LinkedIn officielle et ne permet aucun accès autonome au compte lorsque Chrome est fermé. Voir `extension/README.md`.

## Connexion expérimentale à son propre LinkedIn par cookies

Dans **Réglages → Comptes LinkedIn → Ajouter un compte**, choisir **Mon LinkedIn (cookie)**.
Renseigner **les deux valeurs** `li_at` et `JSESSIONID` de votre propre navigateur déjà connecté,
puis cliquer sur **Ajouter** et **Tester**. Ces informations sont des identifiants de session
équivalents à un mot de passe : ne les communiquez jamais par chat, e-mail ou ticket.
Rendevo chiffre les deux valeurs avec le secret applicatif et ne les renvoie pas dans son API.

**Cookie supplémentaire (0.2.2 / catalogue V13) :** dans le même formulaire LinkedIn, un champ facultatif **Nom du cookie supplémentaire** prérempli avec `TEST` et modifiable apparaît à côté du champ **Valeur du cookie supplémentaire**, vide par défaut. Le nom est validé côté serveur et la valeur facultative chiffrée avec le même coffre de secrets ; l'API ne renvoie que la présence de la valeur, jamais son contenu. On peut remplacer ou supprimer cette valeur en modifiant un compte existant. **Ce cookie ne participe pas à la requête de vérification LinkedIn**, qui reste limitée à `li_at` et `JSESSIONID`. Ne pas considérer cette configuration comme un moyen de conserver ou restaurer une session LinkedIn invalidée.

Après la connexion, **Réglages → Comptes LinkedIn** affiche le nom, l'intitulé du profil, la photo (si disponible) et le lien vers le profil. Le bouton **Tester** lance explicitement la vérification et mémorise les informations publiques du profil dans la configuration du compte. Le simple chargement ou rafraîchissement de la page n'appelle jamais LinkedIn et ne modifie jamais le statut du compte. Un contrôle échoué, même en cas de réponse HTTP 401, ne modifie jamais l'état d'un compte déjà vérifié. L'échec reste visible dans la notification : il ne garantit ni l'expiration ni la validité de la session. Seul un contrôle réussi marque un compte Actif. Le statut « Dernier test OK » désigne le dernier contrôle positif, et non une garantie de validité permanente. Aucun cookie n'est envoyé au navigateur.

Le contrôle en lecture seule utilise un en-tête User-Agent de **Chrome 143 sur macOS**, mais reste une requête Node.js ponctuelle, pas un navigateur réel. Ce changement ne garantit pas que LinkedIn autorise ou reconnaisse la session.

**Diagnostic de session (0.1.6) :** Réglages → Comptes LinkedIn affiche la présence (mais non la valeur) des cookies chiffrés, la dernière vérification réussie et la dernière vérification échouée, le code HTTP et une catégorie d'erreur autorisée. Les requêtes ne sont effectuées qu'après clic sur **Tester** ; un verrou atomique PostgreSQL impose **90 secondes** entre deux tests par compte et indique le délai restant. Un échec ne déconnecte pas le compte et ne modifie pas ses cookies. Remplacer les cookies efface les anciennes informations de profil et de diagnostic. Aucun navigateur dédié n'est utilisé et le dernier succès ne garantit pas que la session soit toujours valide.

**Diagnostic réseau (0.1.7) :** la vérification utilise `redirect: 'manual'` pour distinguer les redirections LinkedIn HTTP 301/302/303/307/308 des erreurs de transport, sans jamais suivre une redirection avec les cookies. Les catégories DNS, TLS/certificat, connexion coupée/refusée, délai dépassé et panne réseau indéterminée sont affichées séparément. Ni URL de redirection, ni message d'exception, ni cookie ne sont enregistrés dans le diagnostic. Une redirection peut indiquer une étape de connexion ou de contrôle côté LinkedIn, mais le diagnostic ne prouve pas la validité de la session. Le délai minimal de 90 secondes entre tests et la conservation du dernier état validé restent inchangés.

**Analyse des redirections (0.1.8) :** lorsque LinkedIn renvoie HTTP 301/302/303/307/308, Rendevo examine **sans suivre** l'en-tête Location pour classifier uniquement la destination : page de connexion LinkedIn, vérification de sécurité, autre page LinkedIn, destination externe/non HTTPS ou cible absente/inconnue. Seule la catégorie autorisée est renvoyée au navigateur et enregistrée dans PostgreSQL ; l'URL complète, les paramètres, les cookies et les en-têtes bruts ne sont jamais exposés ni conservés dans le diagnostic. Une redirection seule ne prouve pas l'expiration des cookies. Les vérifications restent manuelles, espacées de 90 secondes, et préservent le dernier résultat positif.

**Familles de redirection détaillées (0.1.9) :** la destination HTTP 301/302/303/307/308 est désormais classée, sans jamais suivre la redirection, entre connexion directe, vérification de sécurité, authentification/autorisation indirecte, accueil/fil d’actualité, page de profil, chemin d’API Voyager, autre page LinkedIn, destination externe ou destination inconnue. La classification inspecte uniquement le protocole, le domaine et la famille du **chemin**. Les paramètres d’URL, fragments, chemins complets, cibles de redirection et cookies ne sont ni exposés ni enregistrés ; seule une catégorie fixe est persistée. Ces étiquettes sont des indices, pas une preuve de validité ou d’expiration de session.

**Profil utilisateur (0.2.1 / catalogue V12) :** dans **Réglages → Mon compte**, le nom peut être modifié après inscription. Modifier l'adresse e-mail de connexion nécessite de confirmer le mot de passe actuel ; l'adresse est normalisée en minuscules, validée et protégée contre les doublons. Le changement prend effet immédiatement sans e-mail de vérification : les prochaines connexions doivent utiliser la nouvelle adresse. Le compte, les rôles, espaces, sessions et données persistantes sont conservés. La mise à jour ne touche pas aux cookies LinkedIn.

**Campagnes assistées (0.2.0, sans Unipile) :** associez le compte LinkedIn par cookies à une campagne active. Le connecteur **ne recherche pas et n'envoie jamais automatiquement** sur LinkedIn. Dans **Campagnes → Réglages**, choisissez « Mon LinkedIn (cookie) », définissez l'offre/la cible, puis activez la campagne. L'encart « Campagne assistée » propose **Importer des profils CSV / URLs** : les prospects sont qualifiés avec les données fournies. Le moteur prépare les invitations, messages et relances selon la séquence, avec **validation humaine obligatoire**, même pour les invitations sans note. Dans **Messages → À valider**, relisez puis validez chaque brouillon. Dans **À envoyer**, ouvrez LinkedIn, copiez le message et envoyez-le vous-même. **Après l'envoi réel**, cliquez sur **J'ai envoyé sur LinkedIn** et confirmez : le contenu final du message est conservé, les compteurs et le suivi sont actualisés. Indiquez « Invitation acceptée » si le prospect accepte, puis collez les réponses reçues. Le serveur empêche de marquer comme envoyé un brouillon non approuvé ou un compte automatisé et évite le double comptage. Les cookies restent chiffrés ; aucun navigateur dédié ni Unipile n'est nécessaire pour ce mode assisté. Les paramètres validation=all et auto_discovery=false sont imposés côté serveur pour les campagnes par cookies. Les seules opérations réseau avec cette session restent les vérifications d'identité.

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
