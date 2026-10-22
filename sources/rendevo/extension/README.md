# Rendevo Companion — extension Chrome V18

L'extension **communique directement avec l'API de ton Rendevo**, sans faire passer les données par un onglet intermédiaire. Elle permet de choisir une campagne Companion et d'y importer l'URL du profil LinkedIn ouvert dans Chrome après clic explicite.

## Installation

1. Mettre Rendevo à jour vers **0.2.7 / catalogue Runtipi V18**.
2. Depuis **Réglages → Intégrations → Rendevo Companion**, cliquer sur **Télécharger l’extension Chrome (.zip)** pour récupérer `Rendevo-Companion-V18.zip` directement depuis Rendevo (sans GitHub). Décompresser, puis ouvrir `chrome://extensions` → **Mode développeur** → **Charger l'extension non empaquetée**, sélectionner le dossier contenant `manifest.json`.
3. Dans Rendevo : **Réglages → Comptes LinkedIn → Ajouter** → **LinkedIn Companion (Chrome)**. Associer ce compte à une campagne assistée.
4. Dans **Réglages → Intégrations → Rendevo Companion**, copier l'URL de l'instance et cliquer sur **Générer un code d'association**. Le code dure **5 minutes** et ne peut servir qu'une fois.
5. Dans Chrome : ouvrir l'extension, coller l'URL de Rendevo, cliquer sur **Autoriser cette instance Rendevo** et accepter la permission Chrome pour ce site précis. Coller le code et cliquer sur **Associer directement l'extension**.
6. Pour lancer une recherche depuis ton LinkedIn : choisir une campagne Companion, vérifier les mots-clés proposés depuis la cible de la campagne (poste, secteur, zone, mots-clés), les adapter si besoin, puis cliquer sur **Rechercher dans mon LinkedIn**. Un nouvel onglet de recherche « Personnes » s'ouvre dans la session Chrome connectée. LinkedIn applique ses propres filtres et restrictions ; **l'extension ne lit ni n'extrait la liste de résultats**.
7. Parcourir les résultats de LinkedIn et ouvrir le profil choisi. Cliquer sur Companion, sélectionner la campagne et cliquer sur **Ajouter ce profil directement à Rendevo**. Aucune fiche n'est importée sans un clic.
8. Pour les messages, cliquer sur **Ouvrir les messages dans Rendevo**, valider et copier les brouillons, puis effectuer les envois toi-même dans LinkedIn.

### Recherche dans la session LinkedIn

La navigation `https://www.linkedin.com/search/results/people/?keywords=...` n'est déclenchée qu'après ton clic et utilise la session de navigation **existante** dans Chrome. Elle ne passe ni par l'API LinkedIn, ni par Brave, ni par le serveur Rendevo. Elle peut dépendre du fonctionnement futur de la recherche LinkedIn. Rendevo ne récupère **pas automatiquement** les résultats depuis la page ; l'utilisateur choisit les profils à importer. Aucune lecture DOM, aucun scraping, aucune récupération de cookies.

## Confidentialité et sécurité

- **Aucun cookie LinkedIn** `li_at`, `JSESSIONID`, `bcookie` n'est lu ou envoyé. Pas de lecture DOM, de collecte de messages, de scraping, ni d'API Voyager depuis cette extension.
- L'autorisation réseau est demandée pour **ton origine Rendevo uniquement**, à l'installation de l'adresse. Le manifeste déclare des origines facultatives (`optional_host_permissions`) qui ne sont pas accordées sans ton consentement.
- Rendevo génère un **code aléatoire à usage unique**, valide cinq minutes. Le serveur n'en stocke que le hash ; il fournit ensuite à l'extension un jeton de périphérique stocké dans `chrome.storage.local`. **Ce jeton permet seulement de lire les campagnes Companion et d'importer une URL de profil**, pas de consulter les cookies, de modifier les messages ni de les envoyer.
- Les jetons expirent après **90 jours** et sont révocables depuis **Réglages → Intégrations → Extensions associées**. Le bouton « Dissocier » efface le jeton local ; pour le révoquer côté serveur, utiliser le bouton « Révoquer » de Rendevo.
- Les réponses API n'exposent ni code d'association ni jeton existant. Les URL LinkedIn ne conservent aucun paramètre de suivi. Les comptes et campagnes sont isolés par espace de travail.
- La possession du jeton local permet les actions limitées décrites ci-dessus ; protéger ton profil Chrome comme tout périphérique connecté. Aucun jeton Rendevo global, mot de passe ou cookie Rendevo n'est copié dans l'extension.
- La connexion directe nécessite que ton serveur Rendevo soit accessible depuis Chrome (adresse HTTPS publique ou HTTP local privé). Aucun compte externe, service tiers ou navigateur automatisé.

L'extension n'accorde **aucun accès API officiel à LinkedIn** et ne peut pas effectuer de prospection quand Chrome est fermé. Tous les messages et invitations restent manuels.
