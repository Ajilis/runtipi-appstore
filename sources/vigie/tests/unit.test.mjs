import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAmountToCents, addMonths, isIsoDate } from '../server/portfolio.js';
import { totpAt, base32Encode, base32Decode, verifyTotp, hashPassword, verifyPassword, encrypt, decrypt, normalizeRecoveryCode } from '../server/security.js';
import { parseEcbXml, ratesToBase } from '../server/fx.js';
import { parseEnvFile } from '../server/config.js';
import { isPrivateIp } from '../server/auth.js';

test('lecture des montants saisis', () => {
  assert.equal(parseAmountToCents('12 500,50 €'), 1_250_050);
  assert.equal(parseAmountToCents('12.500,50'), 1_250_050);
  assert.equal(parseAmountToCents('12,500.50'), 1_250_050);
  assert.equal(parseAmountToCents('-35,2'), -3520);
  assert.equal(parseAmountToCents(1234.565), 123_457);
  assert.equal(parseAmountToCents('abc'), null);
  assert.equal(parseAmountToCents(''), null);
  assert.equal(parseAmountToCents('1,2,3'), null);
});

test('dates', () => {
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonths('2024-02-29', -12), '2023-02-28');
  assert.equal(isIsoDate('2026-02-30'), false);
  assert.equal(isIsoDate('2026-10-30'), true);
});

test('TOTP conforme à la RFC 6238 (SHA-1)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32Decode(secret).toString(), '12345678901234567890');
  assert.equal(totpAt(secret, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), '081804');
  const now = 1111111109 * 1000;
  assert.equal(verifyTotp(secret, '081804', 0, now), Math.floor(1111111109 / 30));
  assert.equal(verifyTotp(secret, '081804', Math.floor(1111111109 / 30), now), null, 'rejeu refusé');
});

test('mots de passe scrypt et chiffrement', async () => {
  const h = await hashPassword('un-mot-de-passe');
  assert.match(h, /^scrypt\$32768\$8\$1\$/);
  assert.equal(await verifyPassword('un-mot-de-passe', h), true);
  assert.equal(await verifyPassword('autre', h), false);
  const enc = encrypt('secret'.repeat(8), 'JBSWY3DPEHPK3PXP');
  assert.equal(decrypt('secret'.repeat(8), enc), 'JBSWY3DPEHPK3PXP');
  assert.throws(() => decrypt('autre'.repeat(8), enc));
  assert.equal(normalizeRecoveryCode('ABCD EFGH'), 'abcd-efgh');
});

test('taux de la BCE', () => {
  const xml = `<gesmes:Envelope><Cube><Cube time='2026-10-29'><Cube currency='USD' rate='1.0850'/><Cube currency='CHF' rate='0.9400'/><Cube currency='GBP' rate='0.8500'/></Cube></Cube></gesmes:Envelope>`;
  const p = parseEcbXml(xml);
  assert.equal(p.date, '2026-10-29');
  assert.equal(p.perEur.USD, 1.085);
  const eur = ratesToBase(p.perEur, 'EUR', ['USD', 'CHF', 'JPY']);
  assert.ok(Math.abs(eur.rates.USD - 1 / 1.085) < 1e-9);
  assert.deepEqual(eur.missing, ['JPY']);
  const chf = ratesToBase(p.perEur, 'CHF', ['EUR', 'USD']);
  assert.ok(Math.abs(chf.rates.EUR - 0.94) < 1e-9);
  assert.ok(Math.abs(chf.rates.USD - 0.94 / 1.085) < 1e-9);
});

test('fichier de configuration et adresses privées', () => {
  const v = parseEnvFile('# commentaire\nA=1\nB = "deux" # fin\n\nC=\n');
  assert.deepEqual(v, { A: '1', B: 'deux', C: '' });
  assert.equal(isPrivateIp('192.168.1.20'), true);
  assert.equal(isPrivateIp('::ffff:172.18.0.1'), true);
  assert.equal(isPrivateIp('203.0.113.4'), false);
});
