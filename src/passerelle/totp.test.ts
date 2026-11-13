import { test } from 'node:test';
import assert from 'node:assert/strict';
import { base32, depuisBase32, hotp, pasDe, totp, uriOtpauth, verifierTotp } from './totp.ts';

const RFC = Buffer.from('12345678901234567890', 'ascii');

test('HOTP : vecteurs de la RFC 4226 (annexe D)', () => {
  const attendus = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  attendus.forEach((code, compteur) => assert.equal(hotp(RFC, compteur), code));
});

test('TOTP : vecteurs SHA-1 de la RFC 6238 (annexe B, 8 chiffres)', () => {
  const vecteurs: [number, string][] = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']];
  for (const [s, code] of vecteurs) assert.equal(totp(RFC, s * 1000, 8), code, `T = ${s}`);
  assert.equal(totp(RFC, 59_000), '287082', '6 chiffres : les 6 derniers');
});

test('base32 (RFC 4648) : aller-retour, sans remplissage, tolérant aux espaces et minuscules', () => {
  assert.equal(base32(RFC), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  assert.equal(base32(Buffer.from('foobar')), 'MZXW6YTBOI');
  assert.deepEqual(depuisBase32('gezd gnbv gy3t qojq gezd gnbv gy3t qojq'), RFC);
  for (let n = 0; n < 40; n++) {
    const b = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
    assert.deepEqual(depuisBase32(base32(b)), b);
  }
  assert.throws(() => depuisBase32('ABC1'), /base32/);
});

test('vérification : ±1 pas de 30 s, rien au-delà, code déjà utilisé refusé, format strict', () => {
  const t = 1_800_000_000_000;
  const p = pasDe(t);
  assert.equal(verifierTotp(RFC, totp(RFC, t), t), p);
  assert.equal(verifierTotp(RFC, totp(RFC, t - 30_000), t), p - 1, 'téléphone en retard de 30 s');
  assert.equal(verifierTotp(RFC, totp(RFC, t + 30_000), t), p + 1, 'téléphone en avance de 30 s');
  const loin = totp(RFC, t + 90_000);
  if (![-1, 0, 1].some((d) => totp(RFC, t + d * 30_000) === loin)) assert.equal(verifierTotp(RFC, loin, t), null, '3 pas plus tard : refusé');
  assert.equal(verifierTotp(RFC, totp(RFC, t), t, { apres: p }), null, 'même pas déjà accepté : rejeu refusé');
  assert.equal(verifierTotp(RFC, totp(RFC, t + 30_000), t, { apres: p }), p + 1);
  assert.equal(verifierTotp(RFC, ` ${totp(RFC, t).slice(0, 3)} ${totp(RFC, t).slice(3)} `, t), p, 'espaces tolérés');
  for (const x of ['', '12345', '1234567', 'abcdef', null, 123456]) assert.equal(verifierTotp(RFC, x, t), null);
});

test('adresse otpauth:// : émetteur et compte encodés, paramètres standard', () => {
  const u = uriOtpauth('JBSWY3DPEHPK3PXP', 'mael@kerlann.example', 'Living Business (Kerlann)');
  assert.equal(u, 'otpauth://totp/Living%20Business%20(Kerlann):mael%40kerlann.example?secret=JBSWY3DPEHPK3PXP&issuer=Living%20Business%20(Kerlann)&algorithm=SHA1&digits=6&period=30');
});
