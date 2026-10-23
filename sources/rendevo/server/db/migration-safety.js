// Fail-closed SQL migration policy. Existing production data must not be
// deleted, truncated, renamed or rewritten by automatic application upgrades.
// For non-additive transformations: use an explicit, reviewed/manual procedure,
// with a tested backup and rollback plan, not an automatic startup migration.
import { createHash } from 'node:crypto';

export function migrationChecksum(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

export function migrationStatements(sql) {
  if (typeof sql !== 'string' || !sql.trim() || sql.includes('\0')) {
    throw new Error('Migration SQL vide ou invalide');
  }
  const out = [];
  let statement = '', mode = 'sql';
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i], next = sql[i + 1];
    if (mode === 'line') {
      if (char === '\n') { statement += ' '; mode = 'sql'; }
    } else if (mode === 'block') {
      if (char === '*' && next === '/') { i++; mode = 'sql'; statement += ' '; }
    } else if (mode === 'single' || mode === 'double') {
      const quote = mode === 'single' ? "'" : '"';
      if (char === quote && next === quote) i++;
      else if (char === quote) mode = 'sql';
      statement += ' ';
    } else if (char === '-' && next === '-') {
      mode = 'line'; i++;
    } else if (char === '/' && next === '*') {
      mode = 'block'; i++;
    } else if (char === "'") {
      mode = 'single'; statement += ' ';
    } else if (char === '"') {
      mode = 'double'; statement += ' ';
    } else if (char === ';') {
      if (statement.trim()) out.push(statement.trim());
      statement = '';
    } else {
      statement += char;
    }
  }
  if (mode === 'single' || mode === 'double' || mode === 'block') {
    throw new Error('Citation ou commentaire SQL non terminé');
  }
  if (statement.trim()) out.push(statement.trim());
  return out;
}

export function assertSafeMigration(filename, sql) {
  if (!/^\d{3}_[a-z0-9_]+\.sql$/.test(filename)) {
    throw new Error('Nom de migration invalide : ' + filename);
  }
  const statements = migrationStatements(sql);
  if (!statements.length) throw new Error('Migration vide : ' + filename);
  for (const stmt of statements) {
    // Reject destructive operations even when nested inside a CREATE TABLE.
    // ON DELETE CASCADE is allowed solely as a foreign-key clause.
    if (/\b(?:DROP|TRUNCATE|UPDATE|RENAME|EXECUTE|CALL|COPY|MERGE|VACUUM|REINDEX)\b/i.test(stmt)
      || /\bDELETE\s+FROM\b/i.test(stmt)) {
      throw new Error('Migration potentiellement destructive interdite : ' + filename);
    }
    const additive = /^(?:CREATE\s+(?:(?:UNIQUE\s+)?INDEX|TABLE|TYPE|EXTENSION)\b|ALTER\s+TABLE\s+[\w.]+\s+ADD\s+(?:(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(?:COLUMN\s+)?|CONSTRAINT\s+)\w+|ALTER\s+TYPE\s+[\w.]+\s+ADD\s+VALUE\b)/i;
    if (!additive.test(stmt)) {
      throw new Error('Opération SQL non additive interdite dans ' + filename + ' : ' + stmt.slice(0, 90));
    }
  }
  return statements.length;
}
