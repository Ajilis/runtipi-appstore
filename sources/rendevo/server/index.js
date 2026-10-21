// Rendevo entry point: config -> database -> HTTP API + web app -> worker.
import { loadConfig } from './config.js';
import { connectDb, migrate } from './db/index.js';
import { createServer, Router } from './lib/http.js';
import { makeVault } from './lib/crypto.js';
import { AiService } from './services/ai.js';
import { CalendarService } from './services/calendar.js';
import { Activity } from './services/activity.js';
import { Agent } from './services/agent.js';
import { Worker } from './services/worker.js';
import * as providers from './services/providers/index.js';
import { makeAuth } from './routes/auth.js';
import { registerCore } from './routes/core.js';
import { registerProspects } from './routes/prospects.js';
import { registerInbox } from './routes/inbox.js';
import { registerMeetings } from './routes/meetings.js';
import { registerMisc } from './routes/misc.js';
import { registerMcp } from './routes/mcp.js';

const logger = console;

async function main() {
  const config = loadConfig();
  logger.log(`[rendevo] v${config.version} - configuration : ${config.configFile}`);
  const db = await connectDb(config.databaseUrl, { logger });
  await migrate(db, logger);

  const vault = makeVault(config.secret);
  const ai = new AiService({ config, vault, logger });
  const calendar = new CalendarService({ db, logger });
  const activity = new Activity({ db, logger });
  const agent = new Agent({ db, config, ai, calendar, activity, providers, logger });
  const worker = new Worker({ db, config, agent, providers, logger });
  const deps = { db, config, vault, ai, calendar, activity, agent, providers, worker };

  const router = new Router();
  const auth = makeAuth(deps);
  auth.register(router);
  registerCore(router, deps, auth);
  registerProspects(router, deps, auth);
  registerInbox(router, deps, auth);
  registerMeetings(router, deps, auth);
  registerMisc(router, deps, auth);
  registerMcp(router, deps);

  const server = createServer({ router, staticDir: config.staticDir, logger });
  server.requestTimeout = 0; // large media uploads
  server.headersTimeout = 65000;
  server.listen(config.port, '0.0.0.0', () => {
    logger.log(`[rendevo] à l'écoute sur http://0.0.0.0:${config.port}`);
    if (!config.publicUrl) logger.log('[rendevo] PUBLIC_URL non défini : les liens envoyés aux prospects (agenda, vidéo, réservation) seront incomplets.');
  });
  worker.start();

  const shutdown = (sig) => {
    logger.log(`[rendevo] ${sig} reçu, arrêt...`);
    worker.stop();
    server.close(() => db.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 8000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (e) => logger.error('[rendevo] promesse rejetée :', e));

main().catch((e) => {
  logger.error('[rendevo] échec du démarrage :', e);
  process.exit(1);
});
