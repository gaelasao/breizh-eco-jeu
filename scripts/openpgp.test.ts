/**
 * Node.js embarqué dans les paquets : SHASUMS256.txt doit être signé par un publieur de Node.js épinglé dans le dépôt.
 * Vraies signatures de Node.js (EdDSA et RSA) gardées dans scripts/donnees-essai, et clés d'essai créées à l'exécution
 * (aucun secret dans le dépôt) pour jouer un nodejs.org compromis.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lireCles, verifierSignatureDetachee } from './openpgp.ts';
import { CLES_NODE, nodeOfficiel } from './paquets.ts';

const essai = (f: string) => readFileSync(new URL(`./donnees-essai/${f}`, import.meta.url));
const epinglees = lireCles(readFileSync(CLES_NODE, 'utf8'));

// ---------------------------------------------------------------- écriture OpenPGP minimale (essais seulement)
const paquet = (etiquette: number, corps: Buffer) => {
  const n = corps.length;
  const lg = n < 192 ? Buffer.from([n]) : Buffer.from([((n - 192) >> 8) + 192, (n - 192) & 0xff]);
  return Buffer.concat([Buffer.from([0xc0 | etiquette]), lg, corps]);
};
const mpi = (b: Buffer) => {
  let i = 0;
  while (i < b.length - 1 && b[i] === 0) i++;
  const v = b.subarray(i);
  const bits = (v.length - 1) * 8 + (v[0] ? Math.floor(Math.log2(v[0])) + 1 : 0);
  return Buffer.concat([Buffer.from([bits >> 8, bits & 0xff]), v]);
};
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const armure = (b: Buffer) => `-----BEGIN PGP PUBLIC KEY BLOCK-----\n\n${b.toString('base64').replace(/.{1,64}/g, '$&\n')}-----END PGP PUBLIC KEY BLOCK-----\n`;

/** Clé Ed25519 (algorithme 22) au format OpenPGP v4, avec sa clé privée node:crypto. */
function cleEssai(): { texte: string; empreinte: string; privee: KeyObject } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const x = Buffer.from(publicKey.export({ format: 'jwk' }).x as string, 'base64url');
  const oid = Buffer.from([0x2b, 0x06, 0x01, 0x04, 0x01, 0xda, 0x47, 0x0f, 0x01]);
  const corps = Buffer.concat([Buffer.from([4]), u32(1_700_000_000), Buffer.from([22, oid.length]), oid, mpi(Buffer.concat([Buffer.from([0x40]), x]))]);
  const empreinte = createHash('sha1').update(Buffer.from([0x99, corps.length >> 8, corps.length & 0xff])).update(corps).digest('hex').toUpperCase();
  return { texte: armure(paquet(6, corps)), empreinte, privee: privateKey };
}

/** Signature détachée binaire (type 0x00, SHA-256) d'un document, comme `gpg --detach-sign`. */
function signerEssai(cle: { empreinte: string; privee: KeyObject }, document: Buffer, autres = Buffer.alloc(0)): Buffer {
  const hachees = Buffer.concat([Buffer.from([22, 33, 4]), Buffer.from(cle.empreinte, 'hex'), Buffer.from([5, 2]), u32(Math.floor(Date.now() / 1000)), autres]);
  const prefixe = Buffer.concat([Buffer.from([4, 0x00, 22, 8, hachees.length >> 8, hachees.length & 0xff]), hachees]);
  const condensat = createHash('sha256').update(Buffer.concat([document, prefixe, Buffer.from([4, 0xff]), u32(prefixe.length)])).digest();
  const rs = sign(null, condensat, cle.privee);
  return paquet(2, Buffer.concat([prefixe, Buffer.from([0, 0]), condensat.subarray(0, 2), mpi(rs.subarray(0, 32)), mpi(rs.subarray(32))]));
}

// ---------------------------------------------------------------- vraies publications de Node.js

test('Node.js : vraies signatures de SHASUMS256.txt reconnues (EdDSA et RSA), par les clés épinglées seulement', () => {
  assert.ok(epinglees.length >= 8, 'clés des publieurs actifs lues');
  const eddsa = verifierSignatureDetachee(essai('node-SHASUMS256-v24.22.2.txt'), essai('node-SHASUMS256-v24.22.2.txt.sig'), epinglees);
  assert.deepEqual(eddsa, { valide: true, signataire: '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356' });
  const rsa = verifierSignatureDetachee(essai('node-SHASUMS256-v24.18.0.txt'), essai('node-SHASUMS256-v24.18.0.txt.sig'), epinglees);
  assert.deepEqual(rsa, { valide: true, signataire: 'C82FA3AE1CBEDC6BE46B9360C43CEC45C17AB93C' });
});

test('Node.js : empreinte d’archive changée dans SHASUMS256.txt, signature d’une autre version ou clé non épinglée = refus', () => {
  const doc = essai('node-SHASUMS256-v24.22.2.txt');
  const sig = essai('node-SHASUMS256-v24.22.2.txt.sig');
  // un attaquant remplace l'archive et l'empreinte correspondante (tous les octets de la 1re ligne essayés)
  for (let i = 0; i < 64; i++) {
    const modifie = Buffer.from(doc);
    modifie[i] = modifie[i] === 0x30 ? 0x31 : 0x30;
    assert.equal(verifierSignatureDetachee(modifie, sig, epinglees).valide, false, `octet ${i}`);
  }
  // signature authentique d'une AUTRE version de Node.js
  assert.equal(verifierSignatureDetachee(doc, essai('node-SHASUMS256-v24.18.0.txt.sig'), epinglees).valide, false);
  // bonne signature, mais clé du signataire retirée des clés épinglées
  const sans = epinglees.filter((c) => c.principale !== '5BE8A3F6C8A5C01D106C0AD820B1A390B168D356');
  assert.match(verifierSignatureDetachee(doc, sig, sans).raison ?? '', /signataire inconnu/);
  // signature tronquée ou dont la valeur est altérée (les 2 octets de contrôle restent justes)
  assert.equal(verifierSignatureDetachee(doc, sig.subarray(0, sig.length - 10), epinglees).valide, false);
  const alteree = Buffer.from(sig);
  alteree.writeUInt8(alteree.readUInt8(alteree.length - 1) ^ 1, alteree.length - 1);
  assert.equal(verifierSignatureDetachee(doc, alteree, epinglees).valide, false);
});

test('OpenPGP : condensat SHA-1, sous-paquet critique inconnu et signature expirée refusés', () => {
  const cle = cleEssai();
  const cles = lireCles(cle.texte);
  assert.equal(cles[0]?.empreinte, cle.empreinte, 'empreinte v4 recalculée comme gpg');
  const doc = Buffer.from('a'.repeat(64) + '  node-v1.2.3-linux-x64.tar.gz\n');
  const sig = signerEssai(cle, doc);
  assert.equal(verifierSignatureDetachee(doc, sig, cles).valide, true);
  const sha1 = Buffer.from(sig);
  sha1[5] = 2; // octet du condensat (après l'en-tête de paquet de 2 octets)
  assert.match(verifierSignatureDetachee(doc, sha1, cles).raison ?? '', /SHA-1/);
  // sous-paquet haché marqué critique (bit 7) et inconnu : la signature est refusée même si elle est juste
  const critique = signerEssai(cle, doc, Buffer.from([2, 0x80 | 100, 1]));
  assert.match(verifierSignatureDetachee(doc, critique, cles).raison ?? '', /critique/);
  assert.equal(verifierSignatureDetachee(doc, signerEssai(cle, doc, Buffer.from([2, 100, 1])), cles).valide, true, 'non critique : ignoré');
  // signature expirée (sous-paquet 3 : 1 seconde après sa création, vérifiée 10 s plus tard)
  const expiree = signerEssai(cle, doc, Buffer.concat([Buffer.from([5, 3]), u32(1)]));
  assert.match(verifierSignatureDetachee(doc, expiree, cles, Date.now() + 10_000).raison ?? '', /expirée/);
});

// ---------------------------------------------------------------- fabrication : nodejs.org compromis

const tarPresent = spawnSync('tar', ['--version'], { stdio: 'ignore' }).status === 0;

test('paquets : Node.js refusé si nodejs.org sert une archive ET un SHASUMS256.txt remplacés ; cache revérifié', { skip: !tarPresent && 'tar absent' }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-node-'));
  const version = 'v24.99.0';
  const cible = 'linux-x64';
  /** Archive node-<v>-<cible>.tar.gz factice (bin/node + LICENSE). */
  const archive = (contenu: string) => {
    const src = join(d, `src-${contenu}`);
    const racine = join(src, `node-${version}-${cible}`);
    mkdirSync(join(racine, 'bin'), { recursive: true });
    writeFileSync(join(racine, 'bin', 'node'), contenu);
    writeFileSync(join(racine, 'LICENSE'), 'MIT');
    const f = join(d, `${contenu}.tar.gz`);
    execFileSync('tar', ['-czf', f, '-C', src, `node-${version}-${cible}`]);
    return readFileSync(f);
  };
  const publieur = cleEssai();
  const attaquant = cleEssai();
  const cles = lireCles(publieur.texte);
  let servi: Record<string, Buffer> = {};
  const publier = (tgz: Buffer, signataire: typeof publieur | null) => {
    const sommes = Buffer.from(`${createHash('sha256').update(tgz).digest('hex')}  node-${version}-${cible}.tar.gz\n`);
    servi = { [`/${version}/node-${version}-${cible}.tar.gz`]: tgz, [`/${version}/SHASUMS256.txt`]: sommes };
    if (signataire) servi[`/${version}/SHASUMS256.txt.sig`] = signerEssai(signataire, sommes);
  };
  const srv = createServer((req, res) => {
    const b = servi[req.url ?? ''];
    if (!b) { res.writeHead(404); res.end(); return; }
    res.writeHead(200); res.end(b);
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  const origine = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/`;
  try {
    const cache = join(d, 'cache');
    publier(archive('authentique'), publieur);
    const n = await nodeOfficiel(version, cible, cache, { origine, cles });
    assert.equal(readFileSync(n.binaire, 'utf8'), 'authentique');

    // nodejs.org compromis : archive piégée + SHASUMS256.txt recalculé, sans signature puis signé par une autre clé
    rmSync(cache, { recursive: true, force: true });
    publier(archive('piege'), null);
    await assert.rejects(nodeOfficiel(version, cible, cache, { origine, cles }), /signature des publieurs de Node\.js invalide/);
    publier(archive('piege'), attaquant);
    await assert.rejects(nodeOfficiel(version, cible, cache, { origine, cles }), /signataire inconnu/);
    assert.equal(existsSync(join(cache, `SHASUMS256-${version}.txt`)), false, 'SHASUMS256.txt refusé : pas gardé en cache');

    // cache déjà rempli (fabrication précédente) puis modifié sur le poste : revérifié, jamais cru sur parole
    rmSync(cache, { recursive: true, force: true });
    publier(archive('authentique'), publieur);
    await nodeOfficiel(version, cible, cache, { origine, cles });
    const piege = archive('piege');
    writeFileSync(join(cache, `SHASUMS256-${version}.txt`), `${createHash('sha256').update(piege).digest('hex')}  node-${version}-${cible}.tar.gz\n`);
    writeFileSync(join(cache, `node-${version}-${cible}.tar.gz`), piege);
    const m = await nodeOfficiel(version, cible, cache, { origine, cles });
    assert.equal(readFileSync(m.binaire, 'utf8'), 'authentique', 'cache non signé remplacé par la publication signée');
  } finally {
    srv.close();
    rmSync(d, { recursive: true, force: true });
  }
});
