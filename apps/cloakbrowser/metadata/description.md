# CloakBrowser — Runtipi 4.9.1

Instance de [CloakBrowser](https://github.com/CloakHQ/CloakBrowser), Chromium furtif pilotable par l'API Chrome DevTools Protocol (CDP) de `cloakserve`. Image Docker officielle **`cloakhq/cloakbrowser:0.6.3`** (Linux amd64/arm64).

**Ce projet ne fournit pas d'interface web de navigation, ni de serveur SQL indépendant.** `GET /` retourne un état JSON et `GET /json/version?fingerprint=monprofil` initialise un navigateur. Le serveur peut être consommé par Playwright et autres clients CDP. Pour une interface web de gestion de profils, il faut un autre produit, CloakBrowser Manager, qui n'est pas le dépôt demandé ici.

## Versions du navigateur et du conteneur

| Élément | Version |
| --- | --- |
| Navigateur Chromium observé sur le serveur Runtipi | `146.0.7680.177` |
| Image Docker / conteneur | `cloakhq/cloakbrowser:0.6.3` |
| Bibliothèque CloakBrowser dans l'image | `0.6.3` |
| Révision du catalogue Runtipi | `3` |

Le numéro Chromium a été vérifié par un lancement direct de `cloakbrowser.launch(headless=True)` sur l'instance ; il peut différer d'une version téléchargée ultérieurement. Le tag `0.6.3` désigne l'image et la bibliothèque CloakBrowser, **pas** la version de Chromium.
## Installer

1. Dans Runtipi 4.9.1 : **Settings → App Stores**, enregistrer `https://github.com/Ajilis/runtipi-appstore` puis actualiser le catalogue ; choisir **CloakBrowser**.
2. Le port hôte est **fixé à `8291/tcp`** : l'éditeur Runtipi 4.9.1 interprétait mal les variables dans une déclaration `ports:`. Aucune variable d'adresse d'écoute n'est utilisée. Une clé de licence CloakBrowser peut être renseignée facultativement.
3. Accès LAN : `http://IP_DU_SERVEUR:8291/` (JSON de santé). Tester le CDP avec `http://IP_DU_SERVEUR:8291/json/version?fingerprint=monprofil`.
4. Dans **Cloudflare Zero Trust → Tunnels**, associer un *Public Hostname* HTTPS (par exemple `cdp.exemple.fr`) au service **HTTP** `http://IP_DU_SERVEUR:8291` (ou `http://127.0.0.1:8291` si cloudflared est exécuté sur l'hôte). **Configurer impérativement une politique Cloudflare Access** pour bloquer tout utilisateur non autorisé ; le CDP n'a aucune authentification native.
5. Ne pas rediriger le port 8291 sur la box, et le filtrer par pare-feu pour n'autoriser que le LAN et cloudflared. Si cloudflared tourne dans un conteneur, son `127.0.0.1` ne désigne pas le serveur Runtipi.

## Réseau et usage

- Publication directe statique `8291:9222/tcp` pour éviter l'erreur de découpage de ports dans Runtipi 4.9.1. Par défaut Docker écoute sur toutes les interfaces réseau de l'hôte : **restreindre impérativement les sources par pare-feu à votre LAN et au tunnel**. **Pas de `x-runtipi.is_main`, aucun routage Traefik**, `exposable=false`, `traefik.enable=false`.
- Test de santé : `curl -fsS http://IP_DU_SERVEUR:8291/`.
- Exemple Playwright Python :

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.connect_over_cdp(
        'http://IP_DU_SERVEUR:8291?fingerprint=monprofil'
    )
    page = browser.new_page()
    page.goto('https://example.com')
    print(page.title())
    browser.close()
```

Utiliser un `fingerprint` stable et distinct par profil. Une requête sans seed réutilise un navigateur par défaut dont l'empreinte peut changer entre redémarrages. Les clients distants derrière Cloudflare Access doivent s'authentifier de façon compatible avec **HTTP et WebSocket** : le tunnel seul ne garantit ni l'authentification ni la compatibilité CDP du client.

## Correctif 502 (revision Runtipi 3)

Si `GET /` renvoie `"status": "ok"` mais `GET /json/version?fingerprint=test01` renvoie `502`, le serveur CDP fonctionne mais Chromium ne rend pas son port de debogage disponible. Le lanceur `cloakserve` demarre directement Chromium : contrairement a `launch(headless=True)` via Playwright, l'option Python `headless=True` n'injecte pas le commutateur Chrome `--headless`. Ce catalogue ajoute explicitement `--headless=new` et augmente l'attente du port CDP de 10 a 45 secondes. Le mode sans interface graphique reste configurable par `config/cloakserve.json` (`headless`: true par defaut).

**Appliquer :** actualiser l'appstore Ajilis dans Runtipi, mettre a jour CloakBrowser (revision de catalogue 3) et redemarrer l'application. Aucune suppression du dossier `profiles/` ni de la configuration. Verifier ensuite `curl -i "http://IP_DU_SERVEUR:8291/json/version?fingerprint=test02"`. Si un 502 persiste, relever les nouveaux logs ; la presence d'erreurs D-Bus/Vulkan ne suffit pas, a elle seule, a etablir la cause du crash.

## Persistance

Les fichiers survivent aux redémarrages dans `runtipi/app-data/<slug-du-store>/cloakbrowser/` :

| Dossier Runtipi | Montage conteneur | Données |
| --- | --- | --- |
| `config/` | `/config` | Fichier `cloakserve.json` créé au premier démarrage |
| `profiles/` | `/profiles` | Profils Chromium, cookies, historique, cache local, préférences, **bases SQLite Chromium** |
| `cache/` | `/root/.cloakbrowser` | Cache du moteur et métadonnées utilisateur |

**Pas de base PostgreSQL/MySQL/Redis externe :** CloakBrowser n'en utilise pas. Les données persistantes résident dans les fichiers des profils Chromium (dont notamment `History` et `Cookies`, au format SQLite).

En version 0.6.3, `cloakserve` efface les profils lorsqu'il nettoie les processus inactifs. Le démarrage de ce paquet charge le programme original depuis l'image Docker et neutralise uniquement sa fonction de suppression de dossier ; les profils demeurent après arrêt, expiration d'inactivité et redémarrage. Cette adaptation dépend de l'implémentation du binaire **0.6.3** ; toute mise à jour doit revérifier ce comportement. Ne jamais partager un profil entre deux instances simultanées.

Fichier persistant `config/cloakserve.json`, créé seulement s'il est absent :

```json
{
  "idle_timeout_seconds": 300,
  "headless": true
}
```

Modifier le fichier puis redémarrer l'application pour appliquer les changements. La valeur `idle_timeout_seconds: 0` désactive l'arrêt des processus inactifs. La conservation des profils reste active.

**Sauvegardes :** arrêter l'application avant de copier `config/`, `profiles/` et `cache/`, afin d'éviter une copie incohérente des fichiers SQLite. Sauvegarder aussi la clé de licence depuis Runtipi. La désinstallation peut supprimer les volumes de données applicatives.

## Sécurité et limitations

**Risque majeur : CDP donne un contrôle complet du navigateur et accès à ses sessions. Ne jamais ouvrir ce port sur Internet.** Cloudflare Tunnel sans Cloudflare Access est insuffisant ; un contrôle d'accès compatible WebSocket est indispensable. Restreindre aussi l'accès LAN à des clients de confiance.

L'installation, le démarrage et les connexions Cloudflare sur votre serveur Runtipi n'ont pas été testés à distance. L'image 0.6.3 inclut le binaire libre ; les versions récentes peuvent requérir une licence CloakHQ. Respecter les conditions de distribution et d'utilisation de celui-ci.
