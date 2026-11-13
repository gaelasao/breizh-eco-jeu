import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alignements, bitsFormat, bitsVersion, blocs, correctionRs, matriceQr, motsDonnees, motsTotaux, qrDataUrl, qrSvg, versionPour } from './qr.ts';

// ---------------------------------------------------------------- décodeur indépendant (tables de la norme recopiées ici)
const EXP: number[] = [];
const LOG: number[] = new Array<number>(256).fill(0);
for (let i = 0, x = 1; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
const mul = (a: number, b: number) => (a === 0 || b === 0 ? 0 : EXP[((LOG[a] as number) + (LOG[b] as number)) % 255] as number);
/** Niveau M : [nombre de blocs, mots de correction par bloc] (ISO/IEC 18004, tableau 9). */
const BLOCS_M: Record<number, [number, number]> = { 1: [1, 10], 2: [1, 16], 3: [1, 26], 4: [2, 18], 5: [2, 24], 6: [4, 16], 7: [4, 18], 8: [4, 22], 9: [5, 22], 10: [5, 26], 11: [5, 30], 12: [8, 22] };
const ALIGN: Record<number, number[]> = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50], 11: [6, 30, 54], 12: [6, 32, 58] };
const MASQUES: ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0, (_x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function decoder(m: boolean[][]): { texte: string; version: number; masque: number } {
  const n = m.length;
  const version = (n - 17) / 4;
  assert.ok(Number.isInteger(version) && version >= 1);
  const lit = (x: number, y: number) => ((m[y] as boolean[])[x] ? 1 : 0);
  // motifs de repérage (7×7, anneau clair puis séparateur clair)
  for (const [ox, oy] of [[0, 0], [n - 7, 0], [0, n - 7]] as const) {
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const d = Math.max(Math.abs(x - 3), Math.abs(y - 3));
      assert.equal(lit(ox + x, oy + y), d === 2 ? 0 : 1, 'motif de repérage');
    }
  }
  for (let i = 8; i < n - 8; i++) { assert.equal(lit(i, 6), i % 2 === 0 ? 1 : 0, 'synchronisation'); assert.equal(lit(6, i), i % 2 === 0 ? 1 : 0); }
  // information de format : deux copies identiques, BCH valide, niveau M
  let f1 = 0;
  let f2 = 0;
  const c1 = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const c2 = [[n - 1, 8], [n - 2, 8], [n - 3, 8], [n - 4, 8], [n - 5, 8], [n - 6, 8], [n - 7, 8], [n - 8, 8], [8, n - 7], [8, n - 6], [8, n - 5], [8, n - 4], [8, n - 3], [8, n - 2], [8, n - 1]];
  c1.forEach(([x, y], i) => { f1 |= lit(x as number, y as number) << i; });
  c2.forEach(([x, y], i) => { f2 |= lit(x as number, y as number) << i; });
  assert.equal(f1, f2, 'deux copies du format');
  assert.equal(lit(8, n - 8), 1, 'module sombre');
  const brut = f1 ^ 0x5412;
  let rem = brut;
  for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10);
  assert.equal(rem, 0, 'BCH du format');
  assert.equal(brut >>> 13, 0b00, 'niveau M');
  const masque = (brut >>> 10) & 7;
  // modules fixes
  const fixe = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  const marquer = (x0: number, y0: number, l: number, h: number) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + l; x++) (fixe[y] as boolean[])[x] = true; };
  marquer(0, 0, 9, 9); marquer(n - 8, 0, 8, 9); marquer(0, n - 8, 9, 8);
  marquer(6, 0, 1, n); marquer(0, 6, n, 1);
  const a = ALIGN[version] as number[];
  for (const cx of a) for (const cy of a) {
    if ((cx === 6 && cy === 6) || (cx === 6 && cy === a[a.length - 1]) || (cx === a[a.length - 1] && cy === 6)) continue;
    marquer(cx - 2, cy - 2, 5, 5);
  }
  if (version >= 7) {
    marquer(n - 11, 0, 3, 6); marquer(0, n - 11, 6, 3);
    let v = 0;
    for (let i = 0; i < 18; i++) v |= lit(n - 11 + (i % 3), Math.floor(i / 3)) << i;
    assert.equal(v >>> 12, version, 'information de version');
  }
  // lecture en zigzag, démasquage
  const bits: number[] = [];
  let montant = true;
  for (let droite = n - 1; droite >= 1; droite -= 2) {
    if (droite === 6) droite = 5;
    for (let k = 0; k < n; k++) {
      const y = montant ? n - 1 - k : k;
      for (const x of [droite, droite - 1]) if (!(fixe[y] as boolean[])[x]) bits.push(lit(x, y) ^ ((MASQUES[masque] as (x: number, y: number) => boolean)(x, y) ? 1 : 0));
    }
    montant = !montant;
  }
  const total = Math.floor(bits.length / 8);
  const mots: number[] = [];
  for (let i = 0; i < total; i++) mots.push(bits.slice(i * 8, i * 8 + 8).reduce((x, b) => (x << 1) | b, 0));
  // désentrelacement, contrôle Reed-Solomon (syndromes nuls), données
  const [nb, ec] = BLOCS_M[version] as [number, number];
  const courts = nb - (total % nb);
  const lc = Math.floor(total / nb) - ec;
  const blocsLus: number[][] = Array.from({ length: nb }, () => []);
  let k = 0;
  for (let i = 0; i <= lc; i++) for (let b = 0; b < nb; b++) if (i < lc || b >= courts) (blocsLus[b] as number[]).push(mots[k++] as number);
  for (let i = 0; i < ec; i++) for (let b = 0; b < nb; b++) (blocsLus[b] as number[]).push(mots[k++] as number);
  const donnees: number[] = [];
  for (const [b, bloc] of blocsLus.entries()) {
    for (let j = 0; j < ec; j++) {
      let s = 0;
      for (const c of bloc) s = mul(s, EXP[j] as number) ^ c;
      assert.equal(s, 0, `syndrome ${j} du bloc ${b}`);
    }
    donnees.push(...bloc.slice(0, bloc.length - ec));
  }
  const flux = donnees.flatMap((o) => Array.from({ length: 8 }, (_, i) => (o >>> (7 - i)) & 1));
  let p = 0;
  const prendre = (l: number) => { let v = 0; for (let i = 0; i < l; i++) v = (v << 1) | (flux[p++] as number); return v; };
  assert.equal(prendre(4), 0b0100, 'mode octet');
  const longueur = prendre(version <= 9 ? 8 : 16);
  const octets = Array.from({ length: longueur }, () => prendre(8));
  return { texte: new TextDecoder().decode(Uint8Array.from(octets)), version, masque };
}

// ---------------------------------------------------------------- tests

test('QR : Reed-Solomon conforme (exemple « HELLO WORLD » 1-M, codes de correction connus)', () => {
  const donnees = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(correctionRs(donnees, 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test('QR : informations de format (M) et de version, alignements, capacités', () => {
  assert.equal(bitsFormat(0), 0b101010000010010);
  assert.equal(bitsFormat(5), 0b100000011001110);
  assert.equal(bitsVersion(7), 0x07c94);
  assert.equal(bitsVersion(40), 0x28c69);
  assert.deepEqual(alignements(1), []);
  assert.deepEqual(alignements(7), [6, 22, 38]);
  assert.deepEqual(alignements(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignements(40), [6, 30, 58, 86, 114, 142, 170]);
  for (let v = 1; v <= 12; v++) assert.deepEqual(alignements(v), ALIGN[v]);
  assert.deepEqual([1, 7, 10, 40].map(motsTotaux), [26, 196, 346, 3706]);
  for (let v = 1; v <= 40; v++) {
    const { nombre, correction } = blocs(v);
    assert.ok(motsDonnees(v) > 0 && Math.floor(motsTotaux(v) / nombre) > correction, `version ${v}`);
    if (BLOCS_M[v]) assert.deepEqual([nombre, correction], BLOCS_M[v]);
  }
  // capacité en octets au niveau M (norme) : 14 en version 1, 122 en 7, 2331 en 40
  assert.equal(versionPour(14), 1);
  assert.equal(versionPour(15), 2);
  assert.equal(versionPour(122), 7);
  assert.equal(versionPour(123), 8);
  assert.equal(versionPour(2331), 40);
  assert.throws(() => versionPour(2332), /trop long/);
});

test('QR : décodé par un lecteur indépendant (versions 1 à 12, les 8 masques, adresse otpauth://)', () => {
  const textes = [1, 14, 15, 26, 60, 84, 100, 122, 150, 180, 200, 250, 287].map((n) => Array.from({ length: n }, (_, i) => String.fromCharCode(33 + ((i * 7 + n) % 90))).join(''));
  textes.push('otpauth://totp/Living%20Business%20(Menuiserie%20Kerlann):mael%40kerlann.example?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=Living%20Business%20(Menuiserie%20Kerlann)&algorithm=SHA1&digits=6&period=30');
  textes.push('Maël, Kerlann — « é ü ç »');
  const versions = new Set<number>();
  for (const t of textes) {
    const d = decoder(matriceQr(t));
    assert.equal(d.texte, t);
    versions.add(d.version);
  }
  assert.ok(versions.size >= 10, `versions couvertes : ${[...versions]}`);
  for (let k = 0; k < 8; k++) {
    const d = decoder(matriceQr('otpauth://totp/Living%20Business:a%40b.fr?secret=JBSWY3DPEHPK3PXP', { masque: k }));
    assert.equal(d.masque, k);
    assert.equal(d.texte, 'otpauth://totp/Living%20Business:a%40b.fr?secret=JBSWY3DPEHPK3PXP');
  }
});

test('QR : SVG autonome (marge de 4 modules) et adresse data: pour la page', () => {
  const svg = qrSvg('https://example.com');
  const n = matriceQr('https://example.com').length;
  assert.match(svg, new RegExp(`^<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n + 8} ${n + 8}"`));
  assert.ok(!/<script|on\w+=/i.test(svg), 'aucun script');
  const url = qrDataUrl('https://example.com');
  assert.match(url, /^data:image\/svg\+xml;base64,/);
  assert.equal(Buffer.from(url.split(',')[1] as string, 'base64').toString('utf8'), svg);
});
