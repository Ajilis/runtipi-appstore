import crypto from 'node:crypto';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(s) {
  return crypto.createHash('sha256').update(s).digest('hex');
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [algo, saltB64, hashB64] = String(stored).split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, actual);
}

// AES-256-GCM encryption for secrets stored in the database (API keys...).
export function makeVault(secret) {
  const key = crypto.createHash('sha256').update('rendevo-vault:' + secret).digest();
  return {
    encrypt(plain) {
      if (plain === undefined || plain === null || plain === '') return '';
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
      return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
    },
    decrypt(blob) {
      if (!blob || !String(blob).startsWith('v1:')) return blob || '';
      try {
        const raw = Buffer.from(String(blob).slice(3), 'base64');
        const d = crypto.createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
        d.setAuthTag(raw.subarray(12, 28));
        return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
      } catch {
        return '';
      }
    },
  };
}

export function hmacHex(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
