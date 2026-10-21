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
Fournisseurs LinkedIn : simulation (bac à sable) · Unipile · manuel
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
