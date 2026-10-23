# Rendevo — règle obligatoire de conservation des données

Ces règles s'appliquent à toute modification de `sources/rendevo/**` ou de `apps/rendevo/**`, notamment aux versions futures publiées via Runtipi.

## Contrat des mises à jour

1. **Aucune migration exécutée automatiquement ne doit supprimer, vider, renommer ou réécrire des données existantes.** Interdiction de `DROP`, `TRUNCATE`, `DELETE FROM`, `UPDATE` de données métier, `ALTER ... DROP/RENAME`, migration avec remise à zéro, `docker compose down -v`, suppression/recréation du dossier PostgreSQL. Les évolutions doivent être additives (nouveaux objets, colonnes nullable ou avec valeur par défaut sûre).
2. **Ne jamais modifier ou supprimer un fichier SQL de migration déjà publié** (`server/db/migrations/*.sql`). Ajouter `004_...`, `005_...`, etc. La CI compare l'historique à la branche de base et le serveur stocke les empreintes SHA-256 des migrations appliquées.
3. **Toute évolution du schéma doit passer par `migrate()`**, dans une transaction unique sous verrou PostgreSQL. Éviter tout DDL depuis les autres chemins de démarrage et les hooks Docker.
4. **Tester avec des données préexistantes** : une véritable base PostgreSQL 17 construite avec les anciennes migrations et contenant des enregistrements dans toutes les tables. La CI doit confirmer la conservation des lignes et des données, les démarrages simultanés, le refus des migrations historiques modifiées et le rollback en cas d'erreur.
5. **Ne jamais remonter les anciennes données par une migration destructive**. Pour un changement incompatible, implémenter une période de compatibilité (anciennes et nouvelles colonnes) et une procédure manuelle distincte, documentée, testée sur une copie de la base, avec sauvegarde, validation et possibilité de retour arrière.
6. **La persistance doit rester stable** : `${APP_DATA_DIR}/data/postgres` pour PostgreSQL, `${APP_DATA_DIR}/data/config` pour les paramètres / le secret de chiffrement, `${APP_DATA_DIR}/data/uploads` pour les médias. Les mises à jour doivent réutiliser ces mêmes répertoires et ne doivent pas régénérer `RENDEVO_APP_SECRET` / `RENDEVO_DB_PASSWORD`.
7. **Une sauvegarde est recommandée avant chaque mise à jour de production**, et impérative avant toute opération manuelle touchant au schéma. Une sauvegarde PostgreSQL logique doit s'accompagner du répertoire de configuration contenant la clé de chiffrement et des uploads. Tester périodiquement la restauration sur une base distincte.
8. **Ne jamais fusionner une PR si les jobs `database-compatibility` et `build` sont rouges.** Le workflow fait dépendre la construction/publication de l'image du test de migrations.

## Vérifications locales et CI

- `node sources/rendevo/scripts/check-migrations.mjs`
- `node --test sources/rendevo/tests/database-migration-policy.test.mjs`
- Sur une instance PostgreSQL jetable nommée **rendevo_migration_ci** : `RENDEVO_MIGRATION_TEST_URL=postgres://.../rendevo_migration_ci node --test sources/rendevo/tests/database-upgrade-postgres.test.mjs`

La base de test doit être isolée. **Ne jamais exécuter ce test contre la base PostgreSQL de production.**

Ces protections préviennent les migrations destructrices et testent la compatibilité sur un schéma historique représentatif. Elles ne remplacent pas les sauvegardes et ne permettent pas de garantir qu'aucune erreur logicielle ou opérationnelle future ne sera possible.
