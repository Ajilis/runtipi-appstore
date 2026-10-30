// Primitives de sécurité : mots de passe (scrypt), jetons, chiffrement AES-256-GCM et TOTP (RFC 6238).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 128 * SCRYPT.N * SCRYPT.r * 2 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const N = Number(n), R = Number(r), P = Number(p);
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(String(password).normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return crypto.timingSafeEqual(actual, expected);
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (password.length > 200) return 'Le mot de passe ne peut pas dépasser 200 caractères.';
  if (/^(.)\1+$/.test(password)) return 'Le mot de passe ne peut pas répéter un seul caractère.';
  return null;
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a)), bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// --- Chiffrement des secrets TOTP au repos -------------------------------------------------------
function deriveKey(appSecret, info) {
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(appSecret, 'utf8'), Buffer.from('vigie-patrimoine'), Buffer.from(info), 32));
}

export function encrypt(appSecret, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(appSecret, 'totp'), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

export function decrypt(appSecret, payload) {
  const [v, iv, tag, ct] = String(payload).split(':');
  if (v !== 'v1') throw new Error('Format de secret chiffré inconnu');
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(appSecret, 'totp'), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64')), decipher.final()]).toString('utf8');
}

// --- TOTP ---------------------------------------------------------------------------------------------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0, value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch); bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20));
}

export function totpAt(secretB32, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secretB32)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / 30);
}

// Renvoie le pas de temps validé (strictement supérieur au dernier utilisé, contre le rejeu) ou null.
export function verifyTotp(secretB32, code, lastStep = 0, now = Date.now()) {
  const clean = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const step = currentStep(now);
  for (const s of [step, step - 1, step + 1]) {
    if (s > lastStep && safeEqual(totpAt(secretB32, s), clean)) return s;
  }
  return null;
}

export function otpauthUri(secretB32, account, issuer = 'Vigie Patrimoine') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// Codes de secours : 10 codes « xxxx-xxxx » à usage unique, stockés hachés.
export function generateRecoveryCodes(count = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const codes = [];
  for (let i = 0; i < count; i++) {
    let s = '';
    for (let j = 0; j < 8; j++) s += alphabet[crypto.randomInt(alphabet.length)];
    codes.push(`${s.slice(0, 4)}-${s.slice(4)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code) {
  const s = String(code || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4)}` : null;
}
