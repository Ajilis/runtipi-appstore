# Rendevo Companion — extension Chrome V24

Depuis V21 / 0.2.10, Companion envoie sa version réelle issue du manifeste Chrome au serveur Rendevo lors de l'association et lors des appels authentifiés. Dans **Réglages → Intégrations → Extensions associées**, chaque périphérique affiche la dernière version déclarée (ou « non communiquée » pour une extension ancienne). La version de l'extension la plus récemment utilisée par l'utilisateur est également visible dans **Réglages → Comptes LinkedIn** pour les comptes Companion. Aucun cookie LinkedIn n'est transmis et une réassociation n'est pas nécessaire après mise à jour.

L'extension **communique directement avec l'API de ton Rendevo**, sans faire passer les données par un onglet intermédiaire. Elle permet de choisir une campagne Companion, puis d'y importer sur confirmation un profil ou les profils proposés par la page de recherche LinkedIn ouverte dans Chrome.

## V24 (0.2.13) — première association épurée

Lors de la première ouverture, Companion affiche **uniquement un champ « Code d’association » et le bouton « Associer le Companion »**. Les explications de serveur intégré, d'autorisation Chrome et de confidentialité ne sont plus affichées sur cet écran. En cas de code incorrect, d'instance non correspondante ou d'extension non personnalisée, un message d'erreur concis peut apparaître. Les indications de confidentialité utiles restent accessibles une fois connecté. Après « Dissocier cette extension », l'ancien texte technique ne réapparaît plus : le formulaire d'association est vide et prêt pour un nouveau code. La sécurité, les autorisations et le format du code unique de cinq minutes sont inchangés.

## V23 (0.2.12) — Companion personnalisé avec autorisation à l’installation

**Depuis Rendevo → Réglages → Intégrations, utilise exclusivement « Télécharger Companion pour mon serveur (.zip) ».** Le ZIP est généré par le serveur après authentification : son `manifest.json` contient une permission **obligatoire** `host_permissions` pour l'hôte Rendevo configuré (HTTPS ou HTTP privé). Il ne contient aucune permission globale `https://*/*` et aucune origine facultative. Chrome accorde ou présente cet accès lors du chargement de l'extension, et **ne redemande pas** l'autorisation lors de l'association par code unique. La procédure « extension non empaquetée » peut ne pas afficher de dialogue séparé, contrairement au Chrome Web Store : consulte les détails de l'extension pour contrôler ou retirer son accès au site. Sans accès, Companion indique comment le rétablir plutôt que demander silencieusement de nouveaux sites.

Le code unique V22 reste valable : il est contrôlé pour correspondre **strictement** à l'adresse intégrée lors du téléchargement. Impossible d'utiliser le code d'une autre instance avec cette extension. Les associations existantes sur la même instance sont conservées après une mise à jour **dans le même dossier décompressé**, suivie du bouton « Actualiser » dans `chrome://extensions`. Si le dossier change, Chrome peut créer une seconde extension : mieux vaut réutiliser le dossier existant. L'URL publique Rendevo doit être correctement configurée avant le téléchargement.

**Port** : les permissions Chrome visent un protocole + nom d'hôte, pas un port précis ; une adresse Rendevo `http://192.168.1.16:8288` reçoit la permission `http://192.168.1.16/*`, mais les appels API continuent d'utiliser uniquement le port `8288` et l'origine exacte. Aucun accès permanent à LinkedIn n'est ajouté. Le code reste à usage unique et valable cinq minutes.

## Association simplifiée V22 (0.2.11 — historique)

L'association ne demande plus de recopier l'adresse du serveur : **un seul copier-coller** depuis Rendevo suffit. Le code transmis a le format `RDV1.<origine-URL-encodée>.<secret-temporaire>`. La partie URL est décodée et validée localement dans l'extension ; **elle n'est pas transmise au serveur pendant l'échange**, seul le secret est envoyé à `/api/companion/exchange`. Le code est inutilisable après cinq minutes ou après le premier échange.

L'extension vérifie que l'origine est une URL HTTPS (ou HTTP sur réseau local privé), sans identifiants, chemin, paramètres ou fragments. Chrome demande l'autorisation d'accès **uniquement** à cette origine après un clic explicite. Si l'autorisation est refusée, aucune requête de connexion n'est effectuée et aucun jeton n'est enregistré. Les sessions déjà associées sont conservées, sans nouvelle association. L'API serveur continue à accepter les anciens codes bruts pour les anciennes versions du compagnon, mais **V22 demande le nouveau code unique**.

## Installation

1. Mettre Rendevo à jour vers **0.2.13 / catalogue Runtipi V24**.
2. Depuis **Réglages → Intégrations → Rendevo Companion**, cliquer sur **Télécharger Companion pour mon serveur (.zip)** pour récupérer `Rendevo-Companion-V24.zip`, propre à ton instance. Décompresser, puis ouvrir `chrome://extensions` → **Mode développeur** → **Charger l'extension non empaquetée**, sélectionner le dossier contenant `manifest.json`. Pour mettre à jour une extension V22 installée localement : écraser les fichiers dans le même dossier et cliquer sur **Actualiser**. Contrôler le site autorisé dans les détails Chrome.
3. Dans Rendevo : **Réglages → Comptes LinkedIn → Ajouter** → **LinkedIn Companion (Chrome)**. Associer ce compte à une campagne assistée.
4. Dans **Réglages → Intégrations → Rendevo Companion**, cliquer sur **Générer un code d'association**, puis **Copier le code unique**. Ce code contient **l’adresse du site Rendevo et le secret temporaire** : aucune URL à copier séparément. Il dure **5 minutes** et ne peut servir qu'une fois.
5. Dans Chrome : ouvrir **Companion V24**, **coller uniquement le code unique** et cliquer sur **Associer le Companion**. La permission de ton serveur est déjà déclarée lors de l’installation : aucune seconde demande n'est lancée. Le code doit correspondre au serveur intégré dans le ZIP.
6. Pour lancer une recherche depuis ton LinkedIn : choisir une campagne Companion, vérifier les mots-clés proposés depuis la cible de la campagne (poste, secteur, zone, mots-clés), les adapter si besoin, puis cliquer sur **Rechercher dans mon LinkedIn**. Un nouvel onglet de recherche « Personnes » s'ouvre dans la session Chrome connectée. LinkedIn applique ses propres filtres et restrictions. Le bouton séparé « Lire les profils de cette page LinkedIn » lit ponctuellement les liens de résultats chargés, après clic.
7. Parcourir la recherche de personnes, puis rouvrir Companion sur cette page et cliquer **Lire les profils de cette page LinkedIn**. Vérifier les liens préremplis, éventuellement supprimer ceux qui ne conviennent pas, cliquer **Prévisualiser les liens** si la liste a été modifiée et enfin **Confirmer et importer les profils dans Rendevo**. Pour un seul profil, ouvrir sa page et utiliser **Ajouter ce profil directement à Rendevo**.
8. Pour les messages, cliquer sur **Ouvrir les messages dans Rendevo**, valider et copier les brouillons, puis effectuer les envois toi-même dans LinkedIn.

### Importer les résultats de la page active (V20)

Sur `https://www.linkedin.com/search/results/people/`, **ouvrir Companion sur l'onglet LinkedIn actif**, sélectionner une campagne et cliquer **« Lire les profils de cette page LinkedIn »**. L'extension demande uniquement l'accès transitoire à l'onglet actif (permissions Chrome `activeTab` et `scripting`), puis identifie les URLs de profils `/in/` présents dans les résultats déjà chargés du contenu principal. Les URLs sont normalisées et dédupliquées, dans la limite de **100 profils par import**.

**Aucune transmission à Rendevo n'a lieu à la lecture.** La fenêtre Companion affiche les URLs, éditables avant tout envoi ; la moindre modification annule la prévalidation et oblige à prévisualiser de nouveau. Le clic distinct **« Confirmer et importer les profils dans Rendevo »** déclenche l'appel API déjà authentifié. Pour capturer une autre page, naviguer normalement dans LinkedIn et répéter l'opération. Il n'y a ni pagination automatique, ni collecte en arrière-plan, ni récupération de cookies, ni requête vers les API privées LinkedIn. Les résultats et le DOM de LinkedIn pouvant changer, le détecteur peut ne trouver aucun profil et nécessiter une adaptation.

**Avertissement important :** LinkedIn interdit explicitement les extensions tierces qui extraient ou copient des données de ses pages, même sur action ponctuelle de l'utilisateur. Cette fonctionnalité peut enfreindre ses conditions d'utilisation et entraîner des restrictions de compte. Avant tout usage, vérifier les autorisations nécessaires et les obligations relatives aux données personnelles.

### Import groupé de liens fournis manuellement (V19)

Après avoir consulté une page de recherche LinkedIn `https://www.linkedin.com/search/results/people/`, **copiez volontairement les adresses des profils qui vous intéressent**. L'extension ne lit ni la page, ni le DOM, ni les cookies LinkedIn. Les résultats n'apparaissent pas automatiquement dans Rendevo.

Dans Companion, sélectionner la campagne puis **coller les URLs dans « Importer une liste de profils LinkedIn »** (une adresse complète `https://www.linkedin.com/in/...` par ligne). Cliquer **« Prévisualiser les liens »** pour vérifier les URLs normalisées et les doublons supprimés. Corriger la liste si nécessaire. Cliquer ensuite sur **« Confirmer et importer les profils dans Rendevo »** : un seul appel API importe au maximum 100 profils dans la campagne sélectionnée. L'API vérifie que les URL sont de véritables profils LinkedIn, refuse les campagnes étrangères et applique la déduplication Rendevo.

La liste collée reste uniquement dans la fenêtre Companion jusqu'à l'import, puis est effacée en cas de succès. En mode collage manuel V19, aucune lecture de page n'est nécessaire. En V20, le bouton distinct de lecture exécute un script local et ponctuel, sans cookies ni envoi de messages.

### Recherche dans la session LinkedIn

La navigation `https://www.linkedin.com/search/results/people/?keywords=...` n'est déclenchée qu'après ton clic et utilise la session de navigation **existante** dans Chrome. Elle ne passe ni par l'API LinkedIn, ni par Brave, ni par le serveur Rendevo. Elle peut dépendre du fonctionnement futur de la recherche LinkedIn. Companion ne transmet **pas automatiquement** les résultats : sur demande explicite, il lit les liens de la page active, les prévisualise puis attend une confirmation d'import. Aucune récupération de cookies ni navigation automatisée.

## Confidentialité et sécurité

- **Aucun cookie LinkedIn** `li_at`, `JSESSIONID`, `bcookie` n'est lu ou envoyé. La seule lecture DOM facultative est limitée aux liens de profils de la page de recherche active, sur clic. Pas de collecte de messages ni d'API Voyager depuis cette extension.
- Le ZIP personnalisé V23 déclare à l’installation `host_permissions` pour le seul hôte Rendevo configuré, sans permission globale ni permission facultative. La permission est contrôlable dans les détails de Chrome, sans seconde demande lors de l'association. La lecture locale des résultats LinkedIn n'utilise que `activeTab` et `scripting` après clic, sans permission LinkedIn permanente.
- Rendevo génère un **code aléatoire à usage unique**, valide cinq minutes. Le serveur n'en stocke que le hash ; il fournit ensuite à l'extension un jeton de périphérique stocké dans `chrome.storage.local`. **Ce jeton permet seulement de lire les campagnes Companion et d'importer, sur confirmation, des URLs de profils**, pas de consulter les cookies, de modifier les messages ni de les envoyer.
- Les jetons expirent après **90 jours** et sont révocables depuis **Réglages → Intégrations → Extensions associées**. Le bouton « Dissocier » efface le jeton local ; pour le révoquer côté serveur, utiliser le bouton « Révoquer » de Rendevo.
- Les réponses API n'exposent ni code d'association ni jeton existant. Les URL LinkedIn ne conservent aucun paramètre de suivi. Les comptes et campagnes sont isolés par espace de travail.
- La possession du jeton local permet les actions limitées décrites ci-dessus ; protéger ton profil Chrome comme tout périphérique connecté. Aucun jeton Rendevo global, mot de passe ou cookie Rendevo n'est copié dans l'extension.
- La connexion directe nécessite que ton serveur Rendevo soit accessible depuis Chrome (adresse HTTPS publique ou HTTP local privé). Aucun compte externe, service tiers ou navigateur automatisé.

L'extension n'accorde **aucun accès API officiel à LinkedIn** et ne peut pas effectuer de prospection quand Chrome est fermé. Tous les messages et invitations restent manuels.
