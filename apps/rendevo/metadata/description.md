# Rendevo

**Version du catalogue Runtipi : 10** · **Version Rendevo : 0.1.9**

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

`ghcr.io/ajilis/rendevo` est construite par GitHub Actions depuis [`sources/rendevo`](https://github.com/Ajilis/runtipi-appstore/tree/main/sources/rendevo) (amd64 et arm64). Version figée dans le Compose : `0.1.9`.
