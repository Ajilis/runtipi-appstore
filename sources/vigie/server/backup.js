// Sauvegardes de la base : copie cohérente par VACUUM INTO, rotation par ancienneté.
import fs from 'node:fs';
import path from 'node:path';

export const BACKUP_NAME = /^vigie-(\d{8})-(\d{6})(-[a-z]+)?\.sqlite$/;

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function createBackup(db, dir, label = '') {
  fs.mkdirSync(dir, { recursive: true });
  const name = `vigie-${stamp()}${label ? '-' + label : ''}.sqlite`;
  const full = path.join(dir, name);
  // Deux sauvegardes dans la même seconde : la plus récente remplace l'autre.
  if (fs.existsSync(full)) fs.unlinkSync(full);
  db.prepare('VACUUM INTO ?').run(full);
  fs.chmodSync(full, 0o600);
  return { name, size: fs.statSync(full).size };
}

export function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => BACKUP_NAME.test(n))
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      return { name, size: st.size, created_at: st.mtimeMs };
    })
    .sort((a, b) => b.created_at - a.created_at);
}

export function pruneBackups(dir, keepDays) {
  if (!keepDays) return 0;
  const limit = Date.now() - keepDays * 86400_000;
  let removed = 0;
  for (const b of listBackups(dir)) {
    if (b.created_at < limit) { fs.unlinkSync(path.join(dir, b.name)); removed += 1; }
  }
  return removed;
}

// Sauvegarde quotidienne à l'heure choisie ; vérifiée toutes les 10 minutes.
export function startBackupScheduler(db, dir, cfg, log) {
  if (!cfg.BACKUP_KEEP_DAYS) return null;
  const tick = () => {
    try {
      const now = new Date();
      if (now.getHours() !== cfg.BACKUP_HOUR) return;
      const today = stamp(now).slice(0, 8);
      if (listBackups(dir).some((b) => b.name.startsWith(`vigie-${today}-`) && b.name.endsWith('-auto.sqlite'))) return;
      const b = createBackup(db, dir, 'auto');
      const removed = pruneBackups(dir, cfg.BACKUP_KEEP_DAYS);
      log.info(`Sauvegarde automatique ${b.name} (${b.size} octets), ${removed} ancienne(s) supprimée(s)`);
    } catch (err) {
      log.error('Échec de la sauvegarde automatique : ' + err.message);
    }
  };
  const timer = setInterval(tick, 10 * 60_000);
  timer.unref();
  setTimeout(tick, 5000).unref();
  return timer;
}
