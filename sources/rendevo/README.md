# Rendevo — sources

## V34 (0.2.23) : connecteur compatible Vultr Serverless Inference

**API :** [documentation Vultr](https://api.vultrinference.com/docs). Dans **Réglages → Intelligence artificielle**, choisir **Vultr Serverless Inference** (fournisseur OpenAI compatible), URL exacte `https://api.vultrinference.com/v1`, puis renseigner la clé Vultr en Bearer et sélectionner un **modèle de chat/génération de texte**. Une configuration déjà enregistrée sur cette URL continue à fonctionner sans ressaisir la clé.

- Le bouton **Récupérer la liste des modèles** appelle `GET /v1/models?format=openrouter&output_modalities=text` pour ne proposer que les modèles qui produisent du texte : la liste générale Vultr comporte aussi des modèles images, audio, embeddings et vidéo, inadaptés à `/chat/completions`.
- Le connecteur envoie **`max_completion_tokens`** au lieu de l'ancien `max_tokens`, comme décrit par Vultr. Pendant la classification structurée des postes, il transmet `reasoning: {"enabled":false}` pour demander une réponse utile plutôt que de consommer le budget de sortie en raisonnement (certains modèles peuvent toutefois raisonner malgré ce réglage).
- Un modèle Vultr inconnu peut être remplacé silencieusement par le modèle par défaut : Rendevo compare **`response.model`** avec le modèle demandé et retourne **`AI_MODEL_MISMATCH`** plutôt que d'afficher un faux succès. Les alias documentés `:express` et `-normalize` sont tolérés.
- Pour la baguette magique, le délai de génération est légèrement étendu sur Vultr (45 secondes, puis 35 secondes si un repli est nécessaire) tout en restant dans la limite habituelle d'un proxy HTTP synchrone. Leurs files d'attente peuvent être plus longues : un résultat reste alors impossible à garantir sans changer de modèle ou de réseau.
- Les connecteurs OpenAI compatibles **autres que Vultr restent inchangés** : pas de `reasoning` Vultr et conservation de `max_tokens` par défaut.

La requête et ses détails sont **validés avec des tests de simulation de l'API Vultr**. Le serveur réel n'a pas été interrogé avec la clé privée de l'utilisateur ; le bouton **Tester la connexion (sans enregistrer)** permet de valider la génération sur son modèle. Aucune migration ni suppression de données, modification de clé ou remplacement des réglages IA enregistrés.


## V33 (0.2.22) : corriger « Le fournisseur IA a interrompu la génération »

Dans **Prospects → Trouver des prospects → Recherche web publique**, le bouton baguette magique conserve le même connecteur IA enregistré, mais ne demande plus immédiatement une réponse longue de 3 400 tokens. La requête principale est limitée à **1 200 tokens** et une douzaine de métiers pertinents ; en cas de connexion interrompue, de délai dépassé, de réponse vide ou de limite de tokens atteinte, Rendevo essaie **une seule fois** une génération simplifiée à **700 tokens**, six postes, avec des délais bornés. Les erreurs définitives de DNS, de connexion refusée, de TLS, d'authentification et de paramètres API ne sont pas répétées.

Les erreurs montrent désormais un **code technique stable sans secret** : `AI_CONNECTION_RESET`, `AI_TIMEOUT`, `AI_DNS`, `AI_CONNECTION_REFUSED`, `AI_TLS`, `AI_PARAMETERS`, `AI_AUTH`, `AI_RATE_LIMIT`, `AI_OUTPUT_TRUNCATED` et autres. Pour les pannes réseau, l'accès au modèle doit être vérifié **depuis le conteneur Rendevo**, pas seulement depuis le navigateur ou la machine hôte. Les coupures sur génération longue peuvent notamment provenir d'un proxy, d'un timeout ou d'un serveur IA à court de ressources. Un bouton « Tester la connexion » qui réussit avec « OK » ne valide pas les requêtes longues.

Les réponses `/chat/completions` dont le `content` est un tableau de blocs texte sont aussi acceptées. Un `finish_reason: length` est détecté comme une limite de génération plutôt que comme une erreur indéfinie. Les messages d'erreur exposés restent indépendants du corps HTTP distant et de la clé API. Les réglages IA existants **ne sont ni remplacés ni effacés** ; aucune migration de schéma PostgreSQL et aucun effacement de prospects, campagnes ou autres données.


## V32 (0.2.21) : correction du générateur d’intitulés avec l’IA déjà configurée

La baguette magique **Prospects → Trouver des prospects → Recherche web publique → Poste recherché** n’impose plus un JSON strictement formaté en `{"rows":[...]}` et ne renvoie plus systématiquement le même message d’échec générique. Le serveur accepte désormais un JSON entouré de balises `json`, un tableau JSON, certaines variantes des noms des colonnes, ainsi que les **tableaux Markdown à quatre colonnes** parfois renvoyés par des modèles OpenAI compatibles. La normalisation, le nettoyage, les limites et la déduplication de V31 restent appliqués.

La première tentative demande **jusqu’à 24 intitulés** pour éviter de tronquer le résultat à cause de la limite en tokens de génération. Si la réponse n’est pas exploitable, le serveur effectue **une seule seconde tentative plus courte**, jusqu’à 12 intitulés. En cas d’échec, un message indique maintenant si le fournisseur rejette la clé, limite les requêtes, ne trouve pas le modèle, refuse les paramètres de génération, dépasse le délai ou renvoie une réponse non structurée / tronquée. **Le détail brut du fournisseur, qui pourrait contenir une clé ou des informations internes, n’est jamais renvoyé au navigateur.**

Le test de connexion IA de Réglages → Intelligence artificielle ne vérifie qu’une courte réponse ; il ne garantit pas que le modèle produit un JSON long valide. **La configuration IA déjà sauvegardée n’est pas modifiée par V32** ; le générateur utilise toujours ce même modèle. Aucune migration PostgreSQL, suppression de donnée, recherche LinkedIn ou import automatique pendant la génération.


## V31 (0.2.20) : baguette magique IA pour « Poste recherché »

Dans **Prospects → Trouver des prospects → Recherche web publique**, le pictogramme **baguette magique** apparaît juste à côté du champ **Poste recherché**. Saisir un mot-clé professionnel (par exemple « directeur commercial », « juriste » ou « responsable RH »), puis cliquer sur la baguette magique. Si ce champ est vide, l'intitulé de la cible de campagne peut servir de mot-clé. Le connecteur IA déjà actif dans **Réglages → Intelligence artificielle** est utilisé sans autre configuration, via `POST /api/discovery/job-titles`.

L'agent suit la demande utilisateur de classification des fonctions professionnelles : intitulés français masculins/féminins, synonymes et abréviations, variantes en anglais, titres hiérarchiquement et institutionnellement associés, fonctions actuelles/anciennes/honorifiques, et métiers voisins clairement distingués. Les résultats sont affichés sous forme d'un **tableau à quatre colonnes** : **Catégorie**, **Intitulé principal**, **Variantes et synonymes LinkedIn**, **Lien avec le mot-clé**. Un **menu déroulant groupé par catégorie** offre les intitulés et leurs variantes ; le bouton **Utiliser ce poste** remplit seulement le champ de recherche. Le lancement du dork DeGoog reste distinct et manuel, tout comme l'import.

L'API exige un utilisateur authentifié et un modèle IA configuré, valide la longueur du mot-clé (2 à 90 caractères), limite les générations répétées à une par 12 secondes et nettoie/limite la sortie IA (60 intitulés maximum, dix variantes par intitulé). Les erreurs du fournisseur ne dévoilent pas la clé API. Le modèle doit pouvoir générer un objet JSON structuré ; les intitulés suggérés sont **potentiellement présents sur LinkedIn**, mais **ne constituent pas une classification officielle LinkedIn**. Aucun enregistrement n'est modifié pendant la génération. Aucun changement de schéma SQL, aucune perte de données de base.


## V30 (0.2.19) : connecteur IA compatible OpenAI générique et sélection des modèles

Dans **Réglages → Intelligence artificielle**, choisir **OpenAI compatible (serveur personnalisé)**, renseigner l'adresse de base de l'API (par exemple `https://llm.example.fr/v1`, `https://api.mistral.ai/v1` ou `http://ollama:11434/v1` sur un réseau local) puis éventuellement la clé API. Le bouton **Récupérer la liste des modèles** utilise **`GET {base_url}/models`** avec `Authorization: Bearer <clé>` seulement si une clé est requise. Il affiche les identifiants des modèles renvoyés par `data[].id`; l'utilisateur en choisit un dans la liste. Le champ Modèle reste éditable pour les fournisseurs qui ne prennent pas en charge `/models`.

**Tester la connexion (sans enregistrer)** fait une véritable génération avec **`POST {base_url}/chat/completions`**, sur l'URL, le modèle et la clé *non encore enregistrés*. Une erreur n'écrase donc plus les anciens réglages. **Enregistrer** écrit ensuite le fournisseur, l'URL et l'identifiant du modèle dans l'espace, chiffre le jeton sur le serveur et préserve l'ancienne clé seulement si l'URL et le fournisseur restent identiques. Une URL différente ne reçoit jamais automatiquement la clé précédente. La réponse de `GET /api/settings` ne comprend plus le texte chiffré de la clé ; seul `has_api_key` est renvoyé. La récupération des modèles n'écrit pas en base.

Les URL publiques nécessitent HTTPS. HTTP est accepté pour les instances locales (localhost, IP privée ou nom d'hôte Docker local) ; aucune redirection vers un autre serveur n'est suivie. Les requêtes ont une limite de temps, et les erreurs des fournisseurs sont contrôlées sans exposer les clés. La liste `GET /models` prouve que l'API annonce un modèle mais ne garantit pas que celui-ci prend en charge `/chat/completions` : utiliser le bouton Tester avant enregistrement. Les modèles n'implémentant que `/responses` ne sont pas encore pris en charge par l'agent.

Aucune migration SQL ni suppression de données pour V30. Les tests CI PostgreSQL de conservation des anciennes bases continuent de bloquer les publications Docker.


## V29 (0.2.18) : pagination DeGoog, défilement infini et import de 200 contacts

DeGoog expose **`GET /api/search?q=...&page=N`** (pagination à partir de 1). Sa réponse JSON peut inclure `totalPages`, mais cette information est facultative selon les moteurs de recherche activés. DeGoog ne dispose pas d'un paramètre API « infinite scroll » : Rendevo implémente ce mode en demandant les pages suivantes à l'API.

Dans **Prospects → Trouver des prospects → Recherche web publique**, l'utilisateur peut choisir **« Bouton Charger plus »** ou **« Défilement infini »**. Le serveur utilise le dork LinkedIn choisi sur la première page pour toutes les pages suivantes, transmet la clé DeGoog uniquement dans l'en-tête Bearer côté serveur, et remonte `page`, `total_pages` (ou `null`), `has_more`, `dork_index` et les diagnostics. Les résultats de pages successives s'ajoutent sans doublons ; les choix et les noms saisis restent mémorisés. Les pages suivantes respectent une courte limite de cadence. Le chargement s'arrête à la fin indiquée par DeGoog, lorsqu'une page n'a plus de résultats, ou à **20 pages**.

L'**import en une opération** accepte désormais **1 à 200 profils LinkedIn revus et cochés**, au lieu de 20. L'import reste une action explicite ; aucun compte LinkedIn n'est consulté directement, et aucun prospect n'est créé lors de la recherche seule. Le serveur vérifie toujours les URL, l'appartenance de la campagne à l'espace et applique la déduplication existante de l'agent. Les anciennes configurations Brave restent prises en charge sans modification de leurs requêtes API.

La mise à jour ne contient aucune migration de base de données, ne supprime aucune table ni aucun contact, et conserve les protections de migrations de V27.


## V28 (0.2.17) : pictogrammes campagnes et recherche web publique LinkedIn

**Campagnes :** chaque ligne propose uniquement de petits pictogrammes accessibles (crayon pour ouvrir l’éditeur et poubelle pour supprimer). La suppression requiert le rôle propriétaire/administrateur et une saisie exacte du nom dans une fenêtre de confirmation. Elle est **logique, non destructrice** : `campaigns.deleted_at` (migration additive `004_campaign_soft_delete.sql`) masque la campagne des listes, la met en archive et annule ses messages programmés encore en attente. Les prospects, messages, réunions et événements historiques restent intacts en base. L’accès à une campagne masquée par API renvoie « introuvable ». Aucune table ou donnée historique n'est détruite.

**Recherche web publique :** la recherche exploite le moteur réellement configuré dans **Réglages → Recherche** et l’API DeGoog `GET /api/search?q=...` (clé Bearer facultative), sans session ni extraction LinkedIn automatique. Les requêtes sont des dorks `site:linkedin.com/in/` suivis des termes de poste, secteur, localisation et mots-clés. Si aucun profil exploitable n’est renvoyé, Rendevo élargit la requête en deux étapes, dans la même limite de 12 secondes. Les URLs `fr.linkedin.com/in/...` et autres sous-domaines linguistiques sont acceptées et normalisées. **Trouver des prospects** affiche les dorks réellement exécutés, le nombre de résultats du moteur et le nombre de profils LinkedIn valides, pour distinguer un moteur injoignable, un index sans résultats et des résultats qui ne sont pas des profils. L’import reste manuel après vérification des suggestions.

Les migrations de V27 continuent de contrôler l’intégrité et la conservation des bases PostgreSQL historiques en CI.


## V27 (0.2.16) : garantie technique de migrations additives et conservation des bases existantes

**Les mises à jour normales ne doivent jamais exiger la suppression ou la recréation de la base Rendevo.** Le stockage persistant Runtipi reste `${APP_DATA_DIR}/data/postgres` (PostgreSQL 17), accompagné des dossiers `${APP_DATA_DIR}/data/config` (incluant le secret de chiffrement) et `${APP_DATA_DIR}/data/uploads` (médias). La configuration et les données ne sont pas supprimées lors d'un changement d'image Docker.

- Les migrations SQL automatiques sont désormais **limitées aux opérations additives**. Une migration contenant une suppression de table ou de colonne, un `DELETE FROM`, `TRUNCATE`, `UPDATE` ou une opération non autorisée échoue **avant toute écriture dans PostgreSQL**.
- Chaque migration appliquée est enregistrée avec une **empreinte SHA-256**. Sur les bases plus anciennes, la colonne d'empreinte est ajoutée et les empreintes de l'historique sont renseignées **sans modifier les enregistrements métier**. Si une migration historique a été modifiée ou manque, Rendevo refuse le démarrage plutôt que de risquer une incohérence.
- La lecture de l'historique et toutes les nouvelles migrations sont sérialisées via un **verrou transactionnel PostgreSQL** ; en cas d'erreur, toute la transaction est annulée. Deux instances qui redémarrent simultanément n'exécutent pas la même migration deux fois.
- **La CI bloque la publication de l'image** tant que la vérification d'immuabilité des anciennes migrations et un test réel de passage d'une base PostgreSQL avec des données préexistantes n'ont pas réussi. Le test vérifie les 16 tables historiques, l'idempotence, la concurrence et le rollback.
- Le document [AGENTS.md](AGENTS.md) fixe ces exigences pour toute version future.

### Sauvegarde recommandée avant les mises à jour

Avant toute mise à jour de production, conserver une **sauvegarde PostgreSQL cohérente** (par exemple `pg_dump -Fc -U rendevo -d rendevo -f /chemin-sur-un-stockage-sur/backup-rendevo.dump` lancé depuis le conteneur PostgreSQL, dans un chemin writable et réellement sauvegardé hors du conteneur), ainsi qu'une copie du dossier de configuration/secret et des uploads. **Tester la restauration dans une base distincte** ; ne pas utiliser la base de production comme banc d'essai. Conserver le mot de passe PostgreSQL et le secret applicatif inchangés, car les clés API stockées dans la base sont chiffrées avec ce secret. Ne jamais supprimer `data/postgres`, lancer `docker compose down -v`, ou réinstaller PostgreSQL avec un nouveau volume pour régler un échec de migration : consulter les logs, préserver le volume, restaurer une sauvegarde uniquement si une intervention le requiert.


## V26 (0.2.15) : tester la connexion DeGoog avant l’enregistrement

Dans **Réglages → Recherche**, le bouton **Tester la connexion** envoie une requête réelle à l’API `GET /api/search` de l’instance DeGoog renseignée. Le test accepte une clé API Bearer facultative (ou réutilise une clé enregistrée **uniquement si le domaine est inchangé**), contrôle l’accès HTTP, le format JSON `results[]` et la disponibilité, sans modifier la configuration de l’espace et sans transmettre la clé au navigateur dans la réponse. Il peut réussir même avec zéro profil indexé, puisque cela prouve que l’API est opérationnelle, sans garantir des résultats de prospection.

**Enregistrer le moteur** reste désactivé avant un test réussi et se désactive immédiatement après une modification de l’URL, de la clé ou de l’option de suppression de clé. Le serveur fournit un jeton de validation **à usage unique valable 3 minutes**, lié à cet utilisateur, cet espace, cette URL et l’empreinte de la clé. Il refuse l’enregistrement d’une configuration DeGoog qui n’a pas été testée (même via l’API). Les configurations historiques Brave ne changent pas. Un refus d’authentification, un format incompatible ou une indisponibilité affiche un message exploitable ; les secrets restent masqués. Un test n’enregistre rien en base.


## V25 (0.2.14) : version serveur dans Companion, moteur DeGoog dans Réglages → Recherche

**Companion V25** indique sa version Chrome (manifeste) dans l’en-tête et affiche la version de l’instance Rendevo connectée, reçue de l’API `/api/companion/status` après authentification du jeton d’appareil. Le formulaire de première association reste minimal et ne contacte pas le serveur sans code valide.

**Trouver des prospects → Recherche web publique** n’affiche plus de champ de configuration du moteur ou de clé. Ces options sont maintenant dans **Réglages → Recherche** : URL d’une instance [DeGoog](https://github.com/degoog-org/degoog) auto-hébergée et clé API facultative. Rendevo appelle **`GET {URL}/api/search?q=...&type=web&lang=fr`** et lit `results[].url/title/snippet`. Si DeGoog exige une clé de recherche, elle est envoyée dans `Authorization: Bearer <clé>`; sinon l’URL suffit. L’URL est limitée à HTTPS (ou HTTP sur localhost/IP privée), sans credentials, chemin non reconnu ni paramètres. Les clés sont chiffrées par le coffre Rendevo ; les API de lecture ne révèlent pas le secret. La recherche reste manuelle, limitée en cadence et à vingt suggestions de profils LinkedIn valides, sans import avant confirmation. Les anciens espaces configurés sur Brave peuvent continuer à utiliser Brave jusqu’à l’enregistrement d’une URL DeGoog. Les données d’anciennes recherches ou campagnes ne sont pas modifiées.


## V24 (0.2.13) : écran d'association Chrome Companion minimal

Le popup de **première association** présente seulement le champ de code et le bouton d'association, sans textes de diagnostic réseau ou d'avertissement de confidentialité. L'origine du serveur reste embarquée dans le ZIP personnalisé et vérifiée silencieusement lors de la validation du code. Seules les erreurs nécessitant une intervention sont affichées. Le texte de dissociation n'est plus conservé après retour au formulaire. La zone « Connectée » conserve ses fonctions de campagnes et d'import. Les règles d'autorisation et de confidentialité restent inchangées.

## V23 (0.2.12) : Companion personnalisé pour ton serveur

Depuis **Réglages → Intégrations**, chaque utilisateur authentifié peut télécharger `Rendevo-Companion-V23.zip` généré à la demande. Le manifeste Chrome intégré déclare une permission **obligatoire** limitée à l'hôte de l'URL publique configurée. Elle est accordée/contrôlable au chargement de l'extension et **n'est plus demandée lors de l'association**. La génération refuse HTTP public, URL non racine ou caractères non autorisés ; seul le domaine configuré est inscrit. Le ZIP est temporaire, effacé après envoi et jamais publié dans `web/dist`. Le JS compagnon contient aussi l'origine exacte (y compris son port) et refuse les codes uniques destinés à un autre serveur. `chrome.permissions.contains` vérifie qu'un utilisateur n'a pas désactivé l'autorisation. Réinstallation dans le même dossier pour conserver les jetons existants ; aucun cookie LinkedIn.

**Note :** Chrome peut ne pas afficher de boîte de dialogue lors du chargement manuel d'une extension non empaquetée, mais la permission est bien inscrite dans son manifeste et contrôlable dans ses paramètres. Les patterns Chrome couvrent les ports du même hôte (pas un port isolé). **PUBLIC_URL doit être correctement configuré**.

## V22 (0.2.11) : un seul code d'association pour Chrome Companion

Depuis **Réglages → Intégrations**, Rendevo génère un code portable regroupant l'origine de l'instance et le secret à usage unique de 5 minutes. Dans **Companion V22**, un seul champ « Code d'association Rendevo » est nécessaire. Le compagnon décode localement l'URL, valide l'origine HTTPS ou HTTP privé, affiche le domaine, demande la permission Chrome uniquement pour cette origine, puis échange le **secret seul** avec l'API actuelle. L'URL et le code ne sont plus saisis séparément. Aucune nouvelle permission LinkedIn ni récupération de cookies. Les extensions déjà associées et la validation du jeton existant sont préservées. Anciennes extensions V21 et antérieures : utiliser le parcours de couplage de leur version ou installer V22.

## Améliorations V21 (0.2.10 / catalogue Runtipi V21)

- La page de connexion affiche la version réelle renvoyée par `GET /api/auth/state`. Une fois connecté, la version de `GET /api/me` s'affiche en petit sous le profil dans la barre latérale.
- Les campagnes sont renommables depuis **Campagnes → Renommer**, avec validation du nom (1 à 120 caractères) et mise à jour dédiée `PATCH /api/campaigns/:id/name`, protégée par les droits administrateur et limitée à l'espace. Dans l'éditeur, le nom est également clairement modifiable.
- Chrome Companion V21 transmet `chrome.runtime.getManifest().version` lors de l'association et via un en-tête de ses appels authentifiés. La migration `003_companion_version.sql` ajoute une colonne facultative à `companion_devices` sans affecter les sessions existantes. **Réglages → Intégrations** affiche la version de chaque extension, et **Réglages → Comptes LinkedIn** montre la dernière version déclarée par une extension associée à l'utilisateur dans cet espace, sans prétendre qu'il s'agit d'une connexion temps réel. Pour les anciennes extensions, la version apparaît comme inconnue jusqu'à la mise à jour et une nouvelle utilisation.

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

## Importer une page de résultats LinkedIn via Companion (0.2.9 / Runtipi V20)

Depuis une recherche de personnes LinkedIn déjà ouverte sur `/search/results/people/`, l'utilisateur peut cliquer **« Lire les profils de cette page LinkedIn »** dans Chrome Companion. Une lecture DOM **ponctuelle, sur clic** et limitée aux liens de profils affichés dans les résultats chargés du contenu principal préremplit la liste des URLs ; elle ne transmet aucune donnée au serveur. L'utilisateur peut corriger ou supprimer des liens, les prévisualise de nouveau après toute modification et confirme explicitement l'import (100 profils maximum) dans une campagne Companion. L'import groupé, la normalisation des domaines, la déduplication, l'authentification restreinte et l'isolation des espaces sont ceux de V19.

La lecture du DOM utilise les permissions Chrome `activeTab` et `scripting`, **sans autorisation LinkedIn permanente**. Pas de requête Voyager, ni cookies, ni pagination, ni défilement automatisé. Les sélecteurs du site peuvent évoluer et rendre la fonctionnalité inopérante. La lecture DOM elle-même peut être soumise aux restrictions de LinkedIn ; examiner ses conditions et la réglementation sur les données personnelles.

## Import groupé manuel des liens LinkedIn dans Companion (0.2.8 / Runtipi V19)

**Rendevo Companion V19** propose une saisie multiligne de profils `https://www.linkedin.com/in/...` fournis volontairement depuis une page de recherche LinkedIn (par exemple `/search/results/people/`). L'utilisateur **prévisualise** la liste, vérifie chaque adresse, puis confirme **l'import groupé**. L'extension supprime les doublons avant de soumettre au maximum 100 profils dans l'API `POST /api/companion/prospects/batch` avec le jeton limité et révocable de Companion. Le serveur vérifie chaque URL, le fournisseur de la campagne et son appartenance à l'espace avant l'import. Les doublons déjà enregistrés sont gérés par l'agent. Aucun navigateur automatisé, aucune lecture de DOM, aucun export de cookies ni scraping LinkedIn : **la V19 n'aspire pas automatiquement une page de résultats**. Les profils sont choisis et les adresses copiées par l'utilisateur.

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
