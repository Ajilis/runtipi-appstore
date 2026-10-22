# Rendevo Companion (Chrome, Manifest V3)

Extension **manuelle** pour Rendevo. Aucun cookie LinkedIn (`li_at`, `JSESSIONID`, `bcookie`) n'est lu ou partagé ; aucun contenu de page LinkedIn n'est analysé et aucun message ou invitation n'est envoyé par l'extension.

## Installer

1. Télécharger l'archive **Rendevo-Companion-V14** dans les artefacts de la [GitHub Action Rendevo image](https://github.com/Ajilis/runtipi-appstore/actions/workflows/rendevo-image.yml) et la décompresser (ou récupérer le dossier `sources/rendevo/extension` du dépôt).
2. Ouvrir `chrome://extensions`, activer le **mode développeur**, cliquer **Charger l'extension non empaquetée** et choisir le dossier contenant `manifest.json`.
3. Ouvrir l'extension, saisir l'adresse HTTPS de **ton** instance Rendevo (Cloudflare Tunnel). Le HTTP n'est accepté qu'en local privé.
4. Dans Rendevo, se connecter normalement puis créer un compte **LinkedIn Companion (Chrome)** depuis **Réglages → Comptes LinkedIn**. Associer ce compte à une campagne assistée.
5. Ouvrir un profil LinkedIn `https://www.linkedin.com/in/…`, cliquer sur l'extension puis **Préparer l'import dans Rendevo**.
6. La page **Prospects** s'ouvre avec l'URL déjà renseignée : choisir la campagne et confirmer **Importer**. Pour les messages, cliquer **Ouvrir mes messages Rendevo**, copier puis envoyer manuellement depuis LinkedIn.

**Association et sécurité :** l'extension mémorise seulement **l'origine Rendevo** dans le stockage local de Chrome. L'accès à Rendevo est assuré par la **session de connexion normale** du site ouverte dans Chrome : aucun jeton ni mot de passe n'est transféré à l'extension. Cette version ne donne pas de connexion API à LinkedIn ; elle facilite le travail manuel dans un navigateur connecté.

Autorisations : `activeTab` (lire l'URL de l'onglet actif sur action utilisateur) et `storage` (sauvegarder l'origine Rendevo). Pas de permissions d'hôte, pas d'interception réseau, pas de content scripts, pas de permissions `cookies`. Le lien de profil est normalisé, privé de ses paramètres, et n'est envoyé que vers l'instance Rendevo choisie lors du clic explicite.
