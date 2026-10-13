# Chatwoot

Plateforme open source de support client omnicanal, avec interface Rails, traitement asynchrone Sidekiq, PostgreSQL/pgvector et Redis.

## Pré-requis
- Instance Runtipi v4+ sur serveur amd64
- Nom de domaine avec HTTPS
- Au moins 4 Go de RAM recommandés
- SMTP à configurer pour les e-mails sortants

## Premier administrateur
Les inscriptions publiques sont désactivées par défaut (`ENABLE_ACCOUNT_SIGNUP=false`). Pour créer le premier compte, activez temporairement ce paramètre dans la configuration Compose, redéployez puis désactivez-le immédiatement après la création du compte.

Les données sont conservées dans `APP_DATA_DIR`. Prévoyez des sauvegardes de PostgreSQL et des fichiers.
