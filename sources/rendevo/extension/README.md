# Rendevo Companion — extension Chrome V20

L'extension **communique directement avec l'API de ton Rendevo**, sans faire passer les données par un onglet intermédiaire. Elle permet de choisir une campagne Companion, puis d'y importer sur confirmation un profil ou les profils proposés par la page de recherche LinkedIn ouverte dans Chrome.

## Installation

1. Mettre Rendevo à jour vers **0.2.9 / catalogue Runtipi V20**.
2. Depuis **Réglages → Intégrations → Rendevo Companion**, cliquer sur **Télécharger l’extension Chrome (.zip)** pour récupérer `Rendevo-Companion-V20.zip` directement depuis Rendevo (sans GitHub). Décompresser, puis ouvrir `chrome://extensions` → **Mode développeur** → **Charger l'extension non empaquetée**, sélectionner le dossier contenant `manifest.json`.
3. Dans Rendevo : **Réglages → Comptes LinkedIn → Ajouter** → **LinkedIn Companion (Chrome)**. Associer ce compte à une campagne assistée.
4. Dans **Réglages → Intégrations → Rendevo Companion**, copier l'URL de l'instance et cliquer sur **Générer un code d'association**. Le code dure **5 minutes** et ne peut servir qu'une fois.
5. Dans Chrome : ouvrir l'extension, coller l'URL de Rendevo, cliquer sur **Autoriser cette instance Rendevo** et accepter la permission Chrome pour ce site précis. Coller le code et cliquer sur **Associer directement l'extension**.
6. Pour lancer une recherche depuis ton LinkedIn : choisir une campagne Companion, vérifier les mots-clés proposés depuis la cible de la campagne (poste, secteur, zone, mots-clés), les adapter si besoin, puis cliquer sur **Rechercher dans mon LinkedIn**. Un nouvel onglet de recherche « Personnes » s'ouvre dans la session Chrome connectée. LinkedIn applique ses propres filtres et restrictions. Le bouton séparé « Lire les profils de cette page LinkedIn » lit ponctuellement les liens de résultats chargés, après clic.
7. Parcourir la recherche de personnes, puis rouvrir Companion sur cette page et cliquer **Lire les profils de cette page LinkedIn**. Vérifier les liens préremplis, éventuellement supprimer ceux qui ne conviennent pas, cliquer **Prévisualiser les liens** si la liste a été modifiée et enfin **Confirmer et importer les profils dans Rendevo**. Pour un seul profil, ouvrir sa page et utiliser **Ajouter ce profil directement à Rendevo**.
8. Pour les messages, cliquer sur **Ouvrir les messages dans Rendevo**, valider et copier les brouillons, puis effectuer les envois toi-même dans LinkedIn.

### Importer les résultats de la page active (V20)

Sur `https://www.linkedin.com/search/results/people/`, **ouvrir Companion sur l'onglet LinkedIn actif**, sélectionner une campagne et cliquer **« Lire les profils de cette page LinkedIn »**. L'extension demande uniquement l'accès transitoire à l'onglet actif (permissions Chrome `activeTab` et `scripting`), puis identifie les URLs de profils `/in/` présents dans les résultats déjà chargés du contenu principal. Les URLs sont normalisées et dédupliquées, dans la limite de **100 profils par import**.

**Aucune transmission à Rendevo n'a lieu à la lecture.** La fenêtre Companion affiche les URLs, éditables avant tout envoi ; la moindre modification annule la prévalidation et oblige à prévisualiser de nouveau. Le clic distinct **« Confirmer et importer les profils dans Rendevo »** déclenche l'appel API déjà authentifié. Pour capturer une autre page, naviguer normalement dans LinkedIn et répéter l'opération. Il n'y a ni pagination automatique, ni collecte en arrière-plan, ni récupération de cookies, ni requête vers les API privées LinkedIn. Les résultats et le DOM de LinkedIn pouvant changer, le détecteur peut ne trouver aucun profil et nécessiter une adaptation.

**Attention :** même une lecture ponctuelle du DOM peut être considérée comme de l'extraction de données par LinkedIn. Vérifier les conditions d'utilisation du service ainsi que les obligations de protection des données avant tout import.

### Import groupé de liens fournis manuellement (V19)

Après avoir consulté une page de recherche LinkedIn `https://www.linkedin.com/search/results/people/`, **copiez volontairement les adresses des profils qui vous intéressent**. L'extension ne lit ni la page, ni le DOM, ni les cookies LinkedIn. Les résultats n'apparaissent pas automatiquement dans Rendevo.

Dans Companion, sélectionner la campagne puis **coller les URLs dans « Importer une liste de profils LinkedIn »** (une adresse complète `https://www.linkedin.com/in/...` par ligne). Cliquer **« Prévisualiser les liens »** pour vérifier les URLs normalisées et les doublons supprimés. Corriger la liste si nécessaire. Cliquer ensuite sur **« Confirmer et importer les profils dans Rendevo »** : un seul appel API importe au maximum 100 profils dans la campagne sélectionnée. L'API vérifie que les URL sont de véritables profils LinkedIn, refuse les campagnes étrangères et applique la déduplication Rendevo.

La liste collée reste uniquement dans la fenêtre Companion jusqu'à l'import, puis est effacée en cas de succès. En mode collage manuel V19, aucune lecture de page n'est nécessaire. En V20, le bouton distinct de lecture exécute un script local et ponctuel, sans cookies ni envoi de messages.

### Recherche dans la session LinkedIn

La navigation `https://www.linkedin.com/search/results/people/?keywords=...` n'est déclenchée qu'après ton clic et utilise la session de navigation **existante** dans Chrome. Elle ne passe ni par l'API LinkedIn, ni par Brave, ni par le serveur Rendevo. Elle peut dépendre du fonctionnement futur de la recherche LinkedIn. Companion ne transmet **pas automatiquement** les résultats : sur demande explicite, il lit les liens de la page active, les prévisualise puis attend une confirmation d'import. Aucune récupération de cookies ni navigation automatisée.

## Confidentialité et sécurité

- **Aucun cookie LinkedIn** `li_at`, `JSESSIONID`, `bcookie` n'est lu ou envoyé. La seule lecture DOM facultative est limitée aux liens de profils de la page de recherche active, sur clic. Pas de collecte de messages ni d'API Voyager depuis cette extension.
- L'autorisation réseau est demandée pour **ton origine Rendevo uniquement**, à l'installation de l'adresse. La lecture locale du résultat LinkedIn utilise seulement `activeTab` et `scripting` après clic et n'exige pas de permission d'hôte LinkedIn permanente. Le manifeste déclare des origines facultatives (`optional_host_permissions`) qui ne sont pas accordées sans ton consentement.
- Rendevo génère un **code aléatoire à usage unique**, valide cinq minutes. Le serveur n'en stocke que le hash ; il fournit ensuite à l'extension un jeton de périphérique stocké dans `chrome.storage.local`. **Ce jeton permet seulement de lire les campagnes Companion et d'importer, sur confirmation, des URLs de profils**, pas de consulter les cookies, de modifier les messages ni de les envoyer.
- Les jetons expirent après **90 jours** et sont révocables depuis **Réglages → Intégrations → Extensions associées**. Le bouton « Dissocier » efface le jeton local ; pour le révoquer côté serveur, utiliser le bouton « Révoquer » de Rendevo.
- Les réponses API n'exposent ni code d'association ni jeton existant. Les URL LinkedIn ne conservent aucun paramètre de suivi. Les comptes et campagnes sont isolés par espace de travail.
- La possession du jeton local permet les actions limitées décrites ci-dessus ; protéger ton profil Chrome comme tout périphérique connecté. Aucun jeton Rendevo global, mot de passe ou cookie Rendevo n'est copié dans l'extension.
- La connexion directe nécessite que ton serveur Rendevo soit accessible depuis Chrome (adresse HTTPS publique ou HTTP local privé). Aucun compte externe, service tiers ou navigateur automatisé.

L'extension n'accorde **aucun accès API officiel à LinkedIn** et ne peut pas effectuer de prospection quand Chrome est fermé. Tous les messages et invitations restent manuels.
