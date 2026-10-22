// Loads the persistent YAML configuration file (created on first start)
// and merges environment variables on top of it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse } from './vendor/yaml.mjs';

const DEFAULT_YAML = `# Rendevo - fichier de configuration
# Créé automatiquement au premier démarrage. Les variables d'environnement
# (PUBLIC_URL, DATABASE_URL, APP_SECRET...) restent prioritaires.
# Modifiez ce fichier puis redémarrez l'application depuis Runtipi.

server:
  # URL publique HTTPS (Cloudflare Tunnel). Laisser vide pour utiliser PUBLIC_URL.
  public_url: ""
  # Autoriser de nouvelles inscriptions après la création du compte administrateur.
  allow_signup: false
  # Durée de validité d'une session, en jours.
  session_days: 30

worker:
  enabled: true
  # Fréquence de la boucle d'automatisation, en secondes.
  tick_seconds: 20
  # Délai aléatoire entre deux actions sur un même compte LinkedIn (rythme humain).
  min_gap_seconds: 90
  max_gap_seconds: 420

# Budgets de sécurité par type de compte LinkedIn. Ils s'appliquent par compte,
# quel que soit le nombre de campagnes.
limits:
  free:
    invites_per_day: 15
    invites_per_week: 100
    messages_per_day: 40
    profile_views_per_day: 60
  premium:
    invites_per_day: 25
    invites_per_week: 150
    messages_per_day: 70
    profile_views_per_day: 100
  sales_navigator:
    invites_per_day: 30
    invites_per_week: 200
    messages_per_day: 100
    profile_views_per_day: 150

# Modèle d'IA par défaut (modifiable par espace dans Réglages > IA).
# provider: none | openai | anthropic
#  - openai : toute API compatible OpenAI (OpenAI, Mistral, OpenRouter, Ollama...)
ai:
  provider: none
  base_url: "https://api.openai.com/v1"
  model: ""
  api_key: ""
  temperature: 0.7

# Compte "Simulation" : bac à sable qui imite LinkedIn pour tester le parcours.
simulation:
  accept_rate: 0.5
  reply_rate: 0.55
  # Accélère les délais simulés (1 = réaliste, 60 = une minute devient une seconde).
  speed: 30

uploads:
  max_mb: 200
`;

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && !Array.isArray(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function boolEnv(v) {
  if (v === undefined || v === '') return undefined;
  return ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase());
}

export function loadConfig(env = process.env) {
  const dataDir = env.DATA_DIR || '/data';
  const configDir = path.join(dataDir, 'config');
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(configDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  const configFile = path.join(configDir, 'rendevo.yml');
  if (!fs.existsSync(configFile)) fs.writeFileSync(configFile, DEFAULT_YAML, { mode: 0o640 });
  const defaults = parse(DEFAULT_YAML);
  let fileCfg = {};
  try {
    fileCfg = parse(fs.readFileSync(configFile, 'utf8')) || {};
  } catch (e) {
    console.error(`[config] ${configFile} illisible, valeurs par défaut utilisées :`, e.message);
  }
  const cfg = deepMerge(defaults, fileCfg);

  // Application secret: env first, else a generated secret persisted next to the config.
  let secret = env.APP_SECRET;
  const secretFile = path.join(configDir, '.secret');
  if (!secret) {
    if (fs.existsSync(secretFile)) secret = fs.readFileSync(secretFile, 'utf8').trim();
    else {
      secret = crypto.randomBytes(48).toString('hex');
      fs.writeFileSync(secretFile, secret, { mode: 0o600 });
    }
  }

  const publicUrl = (env.PUBLIC_URL || cfg.server.public_url || '').replace(/\/+$/, '');
  const allowSignup = boolEnv(env.ALLOW_SIGNUP);
  if (allowSignup !== undefined) cfg.server.allow_signup = allowSignup;
  if (env.AI_PROVIDER) cfg.ai.provider = env.AI_PROVIDER;
  if (env.AI_BASE_URL) cfg.ai.base_url = env.AI_BASE_URL;
  if (env.AI_MODEL) cfg.ai.model = env.AI_MODEL;
  if (env.AI_API_KEY) cfg.ai.api_key = env.AI_API_KEY;
  const workerEnabled = boolEnv(env.WORKER_ENABLED);
  if (workerEnabled !== undefined) cfg.worker.enabled = workerEnabled;

  return {
    ...cfg,
    port: parseInt(env.PORT || '3000', 10),
    databaseUrl: env.DATABASE_URL || 'postgres://rendevo:rendevo@localhost:5432/rendevo',
    secret,
    publicUrl,
    timezone: env.TZ || 'Europe/Paris',
    dataDir,
    configFile,
    uploadsDir,
    staticDir: env.STATIC_DIR || path.resolve(path.dirname(new URL(import.meta.url).pathname), '../web/dist'),
    version: env.APP_VERSION || '0.2.7',
  };
}
