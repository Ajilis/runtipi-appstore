// Point d'entrée : lit la configuration, ouvre la base et démarre le serveur HTTP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, paths, CONFIG_FILE } from './config.js';
import { createApp, createLogger } from './app.js';

const pkg = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
process.env.APP_VERSION = process.env.APP_VERSION || pkg.version;

const { cfg, created, warnings, secretSource } = loadConfig();
const log = createLogger(cfg.LOG_LEVEL);
if (created) log.info(`Fichier de configuration créé : ${CONFIG_FILE}`);
for (const w of warnings) log.warn(w);
if (secretSource !== 'runtipi') log.warn(`Secret de l'application absent de l'environnement : secret de secours (${secretSource}) dans ${paths.config}/secret.key`);

const app = createApp({ cfg, paths, log });
app.server.listen(cfg.PORT, '0.0.0.0', () => {
  const users = app.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  log.info(`Vigie Patrimoine ${cfg.VERSION} à l'écoute sur le port ${cfg.PORT} (données : ${paths.data})`);
  if (users === 0) log.info('Aucun compte : ouvrez http://IP_DU_SERVEUR:PORT depuis votre réseau local pour créer le compte administrateur.');
});

let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    log.info(`Arrêt demandé (${sig})`);
    const force = setTimeout(() => process.exit(0), 8000);
    force.unref();
    await app.close();
    process.exit(0);
  });
}
