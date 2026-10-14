# Migration complète : Zammad Debian/Ubuntu → Runtipi

**Application Runtipi :** `zammad:appstore-ajilis` (catalogue version **8**).  
**Zammad cible :** `7.2.2`, PostgreSQL 17, port local `8285/tcp`, sans Elasticsearch.  
**Important :** ce transfert **remplace** les données du nouveau Zammad ; il ne les fusionne pas. Les anciennes données de production ne sont pas supprimées par cette procédure.

Documentation Zammad :
- https://docs.zammad.org/en/latest/appendix/backup-and-restore/
- https://docs.zammad.org/en/latest/appendix/backup-and-restore/docker-compose.html
- https://docs.zammad.org/en/latest/appendix/backup-and-restore/migrate-hosts.html

## Cas confirmé : ancien Zammad 6.5.0 sur Debian Bookworm, PostgreSQL

La source fournit `6.5.0-1753078720.dace359f.bookworm` et l'adaptateur PostgreSQL. La cible Runtipi utilise **Zammad 7.2.2**. C'est un **passage de version majeure (6 → 7)** ; ne pas sauter d'autres versions majeures et lire les notes de rupture de Zammad 7.0 avant validation.

La documentation officielle **recommande de restaurer de préférence dans la même version que la source**, puis de mettre à jour. Avec notre cible déjà en 7.2.2, l'import d'une sauvegarde 6.5.0 suivie de `db:migrate` est un **scénario de migration à tester**, et non une garantie d'import réussi. Préserver l'ancienne instance et ses archives ; ne pas procéder à la bascule des canaux si les migrations Rails ou l'interface ne sont pas validées. Une alternative plus prudente est une instance de transit **6.5.0** puis une mise à niveau contrôlée vers 7.2.2 ; elle nécessite un déploiement de transit compatible qui n'est pas inclus dans l'app du catalogue.

Références :
- https://docs.zammad.org/en/latest/appendix/backup-and-restore/migrate-hosts.html
- https://docs.zammad.org/en/latest/install/update.html
- https://zammad.com/en/product/releases/7-0

Commandes **non destructives** sur l'ancien serveur pour préparer l'export :

```bash
sudo zammad run rails r 'puts "storage_provider=#{Setting.get("storage_provider")}"'
sudo ls -l /opt/zammad/contrib/backup/{config.dist,zammad_backup.sh}
sudo test -f /opt/zammad/contrib/backup/config && sudo grep -E '^(BACKUP_DIR|FULL_FS_DUMP)=' /opt/zammad/contrib/backup/config || true
df -h /var/tmp /opt/zammad
```

Pour les pièces jointes : `DB` (stockage dans PostgreSQL), `File` (répertoire `/opt/zammad/storage`) et `S3` (stockage objet à migrer à part) ne doivent pas être supposés équivalents. Conserver les éventuels réglages système personnalisés qui ne figurent pas dans la base (variables d'environnement, proxy, certificats, identité mail).

## Étape 0 — Contrôles préalables : ne rien arrêter encore

Sur le **serveur Debian/Ubuntu d'origine** :

```bash
dpkg-query -W -f='${Version}\n' zammad
sudo ls -l /opt/zammad/contrib/backup/{config.dist,zammad_backup.sh}
```

Vérifier la version : le Zammad Docker de destination est **7.2.2**. Il est préférable que l'ancien soit aussi en **7.2.2**. Ne pas restaurer un dump d'une version plus récente vers 7.2.2. Les sauvegardes officielles en provenance du paquet doivent utiliser `FULL_FS_DUMP=no` pour n'emporter que les données, et non une version Debian des fichiers applicatifs. Si l'ancien Zammad utilise une base MySQL/MariaDB, **arrêter** : Zammad 7 nécessite PostgreSQL, et une migration du moteur doit être réalisée au préalable.

Sur **RUNTIPI** :

```bash
df -h /root/runtipi
docker ps -a --filter "label=com.docker.compose.project=zammad_appstore-ajilis" --format "table {{.Names}}\t{{.Status}}"
```

Actualiser l'App Store Ajilis et **mettre à jour Zammad vers la version de catalogue 8 avant tout import**. Vérifier que Zammad fonctionne sur sa base actuelle. Prévoir largement assez d'espace disque pour les archives, la sauvegarde de destination, l'extraction et la restauration. Régler temporairement le délai de tâches Runtipi (par exemple 15 minutes) si nécessaire.

## Étape 1 — Sauvegarde de l'ancien serveur (après décision de bascule)

Dans l'ancien Zammad, activer le mode maintenance, suspendre les canaux entrants et sortants (e-mail, etc.) et prendre note des intégrations. Éviter que les deux serveurs n'envoient des messages ou ne récupèrent les mêmes boîtes aux lettres simultanément.

Sur le **serveur Debian/Ubuntu d'origine** :

```bash
sudo sh -c 'test -e /opt/zammad/contrib/backup/config || cp /opt/zammad/contrib/backup/config.dist /opt/zammad/contrib/backup/config'
sudo grep -E '^(BACKUP_DIR|FULL_FS_DUMP)=' /opt/zammad/contrib/backup/config
```

Adapter `/opt/zammad/contrib/backup/config` si nécessaire pour obtenir :

```bash
BACKUP_DIR='/var/tmp/zammad_backup'
FULL_FS_DUMP='no'
```

Puis, lors de la fenêtre de migration :

```bash
sudo systemctl stop zammad
sudo /opt/zammad/contrib/backup/zammad_backup.sh
sudo ls -lh /var/tmp/zammad_backup/*_zammad_*.gz
```

Les **deux fichiers portant le même horodatage** sont nécessaires : `YYYYMMDDHHMMSS_zammad_db.psql.gz` et `YYYYMMDDHHMMSS_zammad_files.tar.gz`. Ne pas transmettre les liens `latest_zammad_*.gz`.

## Étape 2 — Transfert des archives

Depuis l'ancien serveur, copier les deux fichiers choisis (par exemple vers un répertoire temporaire privé du compte SSH), puis les transmettre à RUNTIPI par `scp` :

```bash
mkdir -p -m 700 ~/zammad-transfert
sudo cp /var/tmp/zammad_backup/YYYYMMDDHHMMSS_zammad_db.psql.gz /var/tmp/zammad_backup/YYYYMMDDHHMMSS_zammad_files.tar.gz ~/zammad-transfert/
sudo chown "$(id -un):$(id -gn)" ~/zammad-transfert/*_zammad_*.gz
chmod 600 ~/zammad-transfert/*_zammad_*.gz
scp ~/zammad-transfert/YYYYMMDDHHMMSS_zammad_*.gz UTILISATEUR@192.168.1.16:~/zammad-transfert/
```

**Remplacer** `YYYYMMDDHHMMSS` par le même horodatage sur les deux fichiers et `UTILISATEUR` par le compte SSH réel ; créer au préalable le dossier `~/zammad-transfert` avec permissions 700 sur le serveur RUNTIPI. Les archives contiennent des données personnelles ; ne pas les publier ni les transmettre dans le chat.

## Étape 3 — Préparer la destination (RUNTIPI)

Avant toute restauration : effectuer ou vérifier une **sauvegarde indépendante de la destination**, puis dans Runtipi **Arrêter Zammad** (ne pas Désinstaller, ne pas Réinitialiser). Vérifier qu'aucun conteneur Zammad n'est encore en cours d'exécution :

```bash
docker ps --filter "label=com.docker.compose.project=zammad_appstore-ajilis"
```

Si des conteneurs Zammad sont encore actifs, **ne pas lancer la restauration**. Les autres applications Runtipi continuent à fonctionner.

Le répertoire source de restauration est :

```text
/root/runtipi/app-data/appstore-ajilis/zammad/data/backup/restore
```

**L'activation de l'import est intentionnelle :** créer le dossier `restore`, puis y copier les **deux** archives du même horodatage. Ne placer aucun fichier `latest_*`. Vérifier l'intégrité des archives et leurs noms avant de démarrer :

```bash
DEST=/root/runtipi/app-data/appstore-ajilis/zammad/data/backup/restore
sudo install -d -m 700 "$DEST"
sudo install -m 600 ~/zammad-transfert/YYYYMMDDHHMMSS_zammad_db.psql.gz "$DEST/"
sudo install -m 600 ~/zammad-transfert/YYYYMMDDHHMMSS_zammad_files.tar.gz "$DEST/"
gzip -t "$DEST/YYYYMMDDHHMMSS_zammad_db.psql.gz"
tar -tzf "$DEST/YYYYMMDDHHMMSS_zammad_files.tar.gz" | head -n 20
```

*Important :* la restauration restaure le schéma PostgreSQL de Zammad et ses fichiers de stockage. Si la destination contient des pièces jointes que tu souhaites conserver, sauvegarder séparément et vider préalablement **seulement le répertoire de stockage de Zammad** après vérification. Ne jamais utiliser `docker compose down -v` ni supprimer d'autres volumes.

## Étape 4 — Démarrage et restauration

Dans Runtipi, cliquer **Démarrer** pour Zammad, sans réinstaller l'application. Avec la version 8 :

1. `zammad-postgresql`, Redis et Memcached deviennent sains.
2. `zammad-backup` peut lire `/var/tmp/zammad/restore/` et effectuer la restauration **avant** la fin de `zammad-init`.
3. `zammad-init` attend le renommage du dossier `restore`, puis réalise les migrations nécessaires et devient sain.
4. Rails, WebSocket, scheduler et Nginx démarrent.

Sur RUNTIPI, observer :

```bash
docker logs -f zammad_appstore-ajilis-zammad-backup-1
```

Dans une seconde fenêtre :

```bash
docker logs -f zammad_appstore-ajilis-zammad-init-1
```

La restauration officielle renomme `restore` en `restore_completed_<horodatage>` à la fin. Les logs doivent indiquer `Restore completed.` et l'initialisation doit finir. Si la restauration échoue, **ne pas supprimer le répertoire de restauration**, conserver les logs et la sauvegarde et diagnostiquer ; les autres conteneurs attendent normalement que la migration soit terminée.

## Étape 5 — Contrôles après migration

```bash
docker ps -a --filter "label=com.docker.compose.project=zammad_appstore-ajilis" --format "table {{.Names}}\t{{.Status}}"
```

Contrôler la présence des anciens comptes, groupes, tickets, pièces jointes, règles, déclencheurs et canaux. La restauration copie les paramètres PostgreSQL de **l'ancien** serveur. En particulier, vérifier dans l'administration **System → Settings → Base** que le FQDN et le protocole correspondent au **nouveau domaine HTTPS Cloudflare**. Le `ZAMMAD_FQDN` du formulaire Runtipi n'écrase pas automatiquement une base restaurée. Vérifier les notifications, OAuth/SSO, identifiants SMTP/IMAP, webhooks, chemin des pièces jointes ou stockage objet externe.

**Sans Elasticsearch**, les fonctions de recherche indexée risquent de ne plus fonctionner comme sur l'ancien serveur. Ne pas lancer une reconstruction de l'index Elasticsearch tant que celui-ci reste désactivé.

Une fois les contrôles réalisés et uniquement après accord, réactiver les canaux du nouveau Zammad ; **l'ancien serveur doit rester en maintenance ou à l'arrêt**, pour éviter les traitements de messages en double.

## Réversibilité

Garder l'ancien serveur inchangé et les deux archives d'origine dans un endroit protégé jusqu'à validation de la migration. Si la migration ne fonctionne pas, conserver les sauvegardes et les journaux, ne pas réinitialiser à l'aveugle la base PostgreSQL. Une restauration réussie remplace les données de la destination et ne peut pas être annulée par la simple option « mettre à jour » de Runtipi.
