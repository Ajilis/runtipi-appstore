# Rendevo

**Version du catalogue Runtipi : 30** · **Version Rendevo : 0.2.19**

**Nouveau V30 — connecteur IA générique OpenAI compatible.** Configurez n’importe quel serveur proposant les routes `/models` et `/chat/completions`, avec une URL de base personnalisée et une clé API facultative si le serveur n'en exige pas. Dans Réglages → Intelligence artificielle, **Récupérer la liste des modèles** permet d'afficher les identifiants et d'en sélectionner un avant enregistrement. **Tester la connexion** lance une génération sur les paramètres provisoires sans effacer une configuration existante. Les clés restent chiffrées et ne sont réutilisées que sur le même serveur. Aucun changement destructif de PostgreSQL.

**Nouveau V29 — pagination de la recherche DeGoog et import jusqu'à 200 contacts.** L'API DeGoog permet `page=N` et peut retourner `totalPages`. Rendevo propose deux modes : **Charger la page suivante** ou **Défilement infini**. La sélection et les noms vérifiés sont conservés entre pages ; les profils sont dédoublonnés. Il est maintenant possible d'importer **200 contacts LinkedIn** en une seule opération après validation manuelle, dans une limite de 20 pages de recherche. Aucun changement destructif de la base PostgreSQL.

**Nouveau V28 — actions de campagne en pictogrammes et recherche dorks LinkedIn.** Les campagnes affichent un crayon « Modifier » et une corbeille « Supprimer », sans texte sur les boutons. La suppression demande de saisir le nom exact et conserve tous les enregistrements historiques grâce à une colonne `deleted_at` ajoutée de manière non destructive. Le moteur DeGoog réglé dans « Réglages → Recherche » reçoit jusqu'à trois dorks LinkedIn publics progressifs ; les requêtes exécutées et les nombres de profils retenus sont affichés pour diagnostiquer les résultats vides. L'import de prospects reste sur confirmation explicite.

**Nouveau V27 — mises à jour PostgreSQL conservatrices.** Les anciennes bases Rendevo sont migrées **sans effacer de table ni d'enregistrement** : mutations SQL destructrices interdites, migrations historiques vérifiées par empreintes SHA-256, verrou et transaction uniques, rollback si erreur. La CI applique les migrations sur une véritable base PostgreSQL historique contenant des prospects et des campagnes, et bloque la publication des images tant que la conservation des données n'est pas vérifiée. Les volumes persistants Runtipi restent inchangés. Une sauvegarde régulière reste recommandée.

**Nouveau V26 — Tester le moteur DeGoog avant sauvegarde.** Dans Réglages → Recherche, le bouton **Tester la connexion** vérifie réellement l’accès réseau, la clé API (si fournie) et le format des résultats. L’enregistrement est désactivé tant que le test échoue, puis autorisé seulement pour les mêmes paramètres et pendant 3 minutes. Le test ne stocke aucune clé et n’affecte pas la configuration précédente. L’application contrôle également cette validation côté serveur pour empêcher les enregistrements non testés.

**Nouveau V25 — Recherche DeGoog et versions Companion.** Le popup Chrome affiche maintenant la version de Rendevo connectée et sa version Companion. La configuration du moteur est retirée de « Trouver des prospects » et déplacée dans le nouveau sous-menu **Réglages → Recherche**. Renseignez l’URL de votre moteur DeGoog compatible `GET /api/search`, puis éventuellement sa clé API Bearer, chiffrée dans Rendevo. Les clés existantes Brave sont conservées tant que vous n’enregistrez pas un moteur DeGoog. Les résultats publics sont toujours vérifiés manuellement avant import.

**Nouveau V24 — première association Companion simplifiée.** À l'ouverture, le popup Chrome affiche uniquement le champ du code d'association et le bouton « Associer le Companion ». Les informations de serveur intégré, de permissions et de confidentialité ne sont pas affichées avant la connexion. Un message apparaît seulement en cas d'erreur utile. Après dissociation, le formulaire est propre et aucun ancien message ne reste visible.

**Nouveau V23 — Companion personnalisé pour ton serveur.** Rendevo génère un ZIP Chrome unique sur demande, après connexion. Le manifeste de cette extension déclare l'autorisation d'accès à ton seul hôte Rendevo lors de l'installation. Plus de demande d'autorisation au moment d'entrer le code d'association. Le Companion vérifie que le code correspond exactement au serveur intégré. Pas de permission sur tous les sites, ni accès permanent à LinkedIn. Si Chrome n'affiche pas de fenêtre pendant le chargement manuel, le site autorisé reste consultable et modifiable dans les réglages de l'extension. Les associations existantes sont conservées en mettant à jour le même dossier.

**Nouveau V22 — association Chrome Companion en un seul code.** Dans Réglages → Intégrations, générer et copier le code d'association unique. Le code contient l'adresse du site Rendevo et le secret à usage unique. Dans Companion V22, **un seul champ** : coller le code, contrôler l'adresse affichée, cliquer « Associer le Companion » et autoriser Chrome sur cette origine. Plus besoin de coller d'abord l'URL du serveur. Les associations existantes continuent de fonctionner, sans récupération de cookies ni permissions LinkedIn supplémentaires.

**Nouveau V21 — versions visibles et renommage de campagnes.** La version Rendevo s'affiche discrètement sur la connexion et près du profil dans la barre latérale. Le bouton **Renommer** figure maintenant sur chaque campagne ; il modifie uniquement le nom de la campagne. La version réelle du Chrome Companion associé est visible dans **Réglages → Extensions associées**, ainsi que la dernière version déclarée de l'utilisateur dans **Réglages → Comptes LinkedIn** pour les comptes Companion. Si un ancien Companion ne transmet pas encore sa version, la mention « non communiquée » apparaît. Aucun nouveau cookie ni secret n'est demandé.

**Nouveau V20 — lire la page de résultats LinkedIn avec Chrome Companion.** Depuis une recherche `https://www.linkedin.com/search/results/people/` déjà ouverte dans Chrome, cliquer **« Lire les profils de cette page LinkedIn »**. Le compagnon détecte les URLs des profils présents dans les résultats chargés, les dédoublonne et propose leur vérification avant un import groupé confirmé dans une campagne Companion (100 maximum). Aucun prospect n'est transmis lors de la lecture. Pas de copie de cookies, pagination ou défilement automatique. Cette lecture locale du DOM sur demande dépend de la structure de LinkedIn et peut être soumise aux conditions du service.

**Nouveau V19 — import groupé de profils dans Chrome Companion.** Dans la page de recherche de personnes LinkedIn, choisir et copier manuellement les adresses des profils intéressants. Dans l'extension Chrome Companion : sélectionner la campagne, coller jusqu'à **100 URLs de profils**, prévisualiser les liens dédoublonnés puis confirmer l'import en une seule opération dans Rendevo. L'authentification utilise le jeton Companion limité ; les faux domaines et campagnes non autorisées sont rejetés. **L'extension n'extrait pas automatiquement le contenu de la page LinkedIn**, ne lit pas ses cookies et n'envoie aucune invitation ni message. Un onglet LinkedIn connecté peut toujours être ouvert pour rechercher des personnes.



**Nouveau V18 — rechercher directement dans son LinkedIn connecté depuis Chrome Companion.** Dans **Prospects → Trouver des prospects**, sélectionner **Dans mon LinkedIn (Companion)**. Dans l'extension, choisir une campagne, vérifier ou modifier les mots-clés automatiquement proposés depuis sa cible (poste, secteur, localisation, mots-clés), puis cliquer sur **Rechercher dans mon LinkedIn**. Chrome ouvre la recherche de personnes sur LinkedIn dans la session déjà active, sans clé Brave. L'utilisateur consulte les résultats, ouvre un profil et l'importe explicitement via Companion. L'extension n'analyse pas les pages LinkedIn, n'extrait pas les listes, ne copie aucun cookie et ne transmet pas d'invitations ou de messages.



**Nouveau V17 — recherche de prospects depuis l'index public du web :** dans **Prospects → Trouver des prospects**, définissez le poste, secteur, zone géographique et mots-clés. Rendevo utilise une **clé personnelle Brave Search API** (service indépendant avec crédits mensuels et tarification selon l'usage), stockée chiffrée, pour proposer au maximum vingt profils professionnels LinkedIn déjà indexés sur le web. **Vérifiez les résultats et sélectionnez-les manuellement avant de les importer** dans une campagne assistée. Aucune session ni cookie LinkedIn n'est utilisé ; aucun scraping ni envoi automatique n'est réalisé. Les informations provenant du moteur sont indicatives et peuvent être obsolètes.



**Nouveau V16 — téléchargement direct de l'extension Chrome.** Depuis **Réglages → Intégrations → Rendevo Companion**, cliquer sur **Télécharger l’extension Chrome (.zip)** pour récupérer immédiatement la version compatible de Companion **depuis votre Rendevo**, sans redirection vers GitHub ni expiration d’artefact. Décompresser l’archive, puis charger le dossier contenant `manifest.json` dans `chrome://extensions` → Mode développeur → Charger l’extension non empaquetée. Téléchargement accessible après connexion à Rendevo ; l’association sécurisée par code temporaire reste identique.



**Nouveau V15 — connexion directe de Chrome Companion à Rendevo.** Dans **Réglages → Intégrations**, générez un code à usage unique valable 5 minutes, puis saisissez-le dans l'extension. Celle-ci communique directement avec les API restreintes de votre instance Rendevo grâce à un jeton dédié, limité aux campagnes Companion et à l'import de profils sur clic. L'autorisation Chrome ne porte que sur le site Rendevo choisi. Le jeton est révocable, expire après 90 jours, et ne donne aucun accès au compte LinkedIn ni aux cookies. Aucun envoi automatique de messages ou d'invitations.


**Nouveau (V14) — Rendevo Companion pour Chrome :** un mode LinkedIn assisté **sans cookies copiés**, avec extension Manifest V3 à installer depuis l'archive GitHub Actions. Sur un profil LinkedIn ouvert, l'extension lit uniquement l'URL de l'onglet actif après clic, puis ouvre le formulaire d'import Rendevo avec cette URL préremplie : **tu confirmes l'import**. Association par l'URL HTTPS de ton Rendevo et ta session web existante ; aucun token LinkedIn ou Rendevo dans l'extension. Messages et invitations restent à envoyer manuellement depuis LinkedIn. Dans **Réglages → Comptes LinkedIn**, sélectionne « LinkedIn Companion (Chrome) ». Le connecteur cookies historique reste disponible.

**Nouveau (V13)** : dans **Réglages → Comptes LinkedIn → Ajouter ou modifier**, un cookie supplémentaire facultatif peut être renseigné avec son nom **TEST** prérempli et modifiable et sa valeur initialement vide. Sa valeur est chiffrée et masquée ; elle peut être remplacée ou supprimée ultérieurement. **Ce cookie supplémentaire n'est pas transmis à LinkedIn lors de « Tester »**, lequel utilise toujours uniquement `li_at` et `JSESSIONID` ; il ne résout pas à lui seul les déconnexions de Chrome.

Dans **Réglages → Mon compte**, modifiez votre nom et l'adresse e-mail utilisée pour vous connecter ; un changement d'e-mail exige votre mot de passe actuel. Les campagnes, espaces et profils existants sont conservés.

Rendevo est un agent de prospection LinkedIn auto-hébergé. Il trouve les prospects qui correspondent à votre offre, repère leurs signaux d'achat (nouveau poste, recrutement, levée de fonds, visite de profil, réaction à un post), leur écrit dans votre style, relance, répond avec un setter IA et place les rendez-vous dans vos créneaux libres.

## Ce que fait l'agent

- **Cible et qualification** : description de l'offre analysée depuis votre site, cible (postes, secteurs, zones, exclusions), score sur 100 avec le raisonnement conservé pour chaque prospect.
- **Prospects chauds** : recherche automatique (Unipile), import CSV, URLs LinkedIn ou personnes ayant réagi à un post, avec dédoublonnage.
- **Séquence** : invitation (avec ou sans note), premier message personnalisé, jusqu'à 8 relances dont une vidéo. La séquence s'arrête dès que le prospect répond.
- **Setter IA** : comprend la réponse (intérêt, question, objection, « plus tard », refus), propose de vrais créneaux libres, réserve, confirme avec lien visio et invitation d'agenda, rappelle le jour J, relance après une absence et reprend contact à la date demandée. Les cas sensibles (prix, contrat, ambiguïté) vous sont transmis.
- **Validation humaine** : pilote automatique, validation des premiers messages, ou de tous les messages.
- **Agenda** : disponibilités, pause déjeuner, délai minimum, agenda existant importé en iCal secret (créneaux occupés exclus), flux iCal de vos RDV, page de réservation publique.
- **Pipeline** : liste, kanban par étape commerciale, export CSV, webhooks signés vers votre CRM.
- **Connecteur MCP** : pilotez l'agent depuis Claude, ChatGPT ou tout client MCP (`/mcp`, jeton dans Réglages > Intégrations).
- **Agence** : espaces clients séparés, accès client en lecture seule, un compte LinkedIn par campagne, budgets par compte.

## Comptes LinkedIn

| Type | Usage |
| --- | --- |
| **Bac à sable** | Simule un compte LinkedIn (acceptations, réponses, réservations). Idéal pour tester messages et setter sans rien envoyer. |
| **Cookie (expérimental)** | Test manuel de sa propre session LinkedIn et affichage du nom, de l'intitulé et de la photo du profil depuis les paramètres avec les cookies li_at et JSESSIONID chiffrés. Aucun envoi, scraping ou synchronisation automatique ; risque de restriction du compte et non-conformité aux conditions LinkedIn. |
| **Unipile** | Automatisation réelle via l'infrastructure tierce [Unipile](https://www.unipile.com) : DSN, jeton API et identifiant du compte connecté. Mot de passe LinkedIn jamais stocké. |
| **Manuel** | Rendevo prépare chaque message ; vous l'envoyez depuis LinkedIn et collez la réponse. Aucune automatisation. |

> Les conditions d'utilisation de LinkedIn restreignent l'automatisation par des tiers. Rendevo applique une fenêtre d'envoi, des délais aléatoires et des budgets prudents par type d'abonnement, mais vous restez responsable de votre compte. La pause générale est disponible en un clic.

## Intelligence artificielle

Réglages > Intelligence artificielle : toute API compatible OpenAI (OpenAI, Mistral, OpenRouter, Ollama local…) ou Anthropic. Sans clé, Rendevo fonctionne avec ses modèles de messages intégrés et un setter à règles.

## Installation

1. Dans **Runtipi → Settings → App Stores**, actualiser `https://github.com/Ajilis/runtipi-appstore`.
2. Installer **Rendevo** (port local **8288**). Renseigner l'**URL publique** exacte du tunnel, par exemple `https://rdv.exemple.fr` (sans slash final). Le secret et le mot de passe PostgreSQL sont générés par Runtipi.
3. Ne pas activer d'exposition par domaine ni d'exposition locale Traefik : l'application n'utilise pas Traefik.
4. Cloudflare Tunnel : créer un *Public Hostname* `rdv.exemple.fr` vers le service `http://IP_DU_SERVEUR:8288` (ou `http://127.0.0.1:8288` si `cloudflared` tourne sur l'hôte en réseau hôte).
5. Ouvrir `http://IP_DU_SERVEUR:8288` sur le réseau local ou l'URL Cloudflare, créer le **compte administrateur** (premier compte), puis suivre l'assistant : offre, cible, voix, compte LinkedIn, disponibilités.

Ne redirigez pas le port 8288 depuis votre box : seul Cloudflare Tunnel doit être exposé à Internet. PostgreSQL n'est publié sur aucun port de l'hôte.

## Données persistantes

| Dossier (`APP_DATA_DIR/data/…`) | Contenu |
| --- | --- |
| `config/rendevo.yml` | Fichier de configuration créé au premier démarrage : budgets LinkedIn, rythme du worker, IA par défaut, bac à sable. Modifier puis redémarrer l'application. |
| `uploads/` | Vidéos et documents partagés avec les prospects |
| `postgres/` | Base de données PostgreSQL 17 |

Sauvegarder ce dossier (ou utiliser la sauvegarde Runtipi) avant toute mise à jour. Ne jamais changer le secret de l'application après l'installation : les clés API enregistrées deviendraient illisibles.

## Image Docker

`ghcr.io/ajilis/rendevo` est construite par GitHub Actions depuis [`sources/rendevo`](https://github.com/Ajilis/runtipi-appstore/tree/main/sources/rendevo) (amd64 et arm64). Version figée dans le Compose : `0.2.4`.
