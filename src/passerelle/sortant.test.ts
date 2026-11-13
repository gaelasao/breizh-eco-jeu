/**
 * Appels sortants : anti-SSRF (IPv4 intégrée dans IPv6 sous toutes ses formes, adresse vérifiée à la connexion) et
 * lecture bornée des réponses (constats jeu-connecteurs-7 et jeu-connecteurs-8). Aucun appel vers Internet : serveurs
 * locaux sur 127.0.0.1 et réponses simulées.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { adressePrivee, appeler, ErreurSortante, lireTexteBorne, recuperateurProtege, verifierUrl } from './sortant.ts';

async function serveur(gerer: Parameters<typeof createServer>[1]): Promise<{ s: Server; port: number; requetes: () => number }> {
  let n = 0;
  const s = createServer((req, res) => { n++; gerer?.(req, res); });
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  return { s, port: (s.address() as { port: number }).port, requetes: () => n };
}
const fermer = (s: Server) => { s.closeAllConnections(); s.close(); };

function sansLocal<T>(f: () => Promise<T>): Promise<T> {
  const avant = process.env.LB_AUTORISER_LOCAL;
  delete process.env.LB_AUTORISER_LOCAL;
  return f().finally(() => { if (avant === undefined) delete process.env.LB_AUTORISER_LOCAL; else process.env.LB_AUTORISER_LOCAL = avant; });
}
function avecLocal<T>(f: () => Promise<T>): Promise<T> {
  const avant = process.env.LB_AUTORISER_LOCAL;
  process.env.LB_AUTORISER_LOCAL = '1';
  return f().finally(() => { if (avant === undefined) delete process.env.LB_AUTORISER_LOCAL; else process.env.LB_AUTORISER_LOCAL = avant; });
}

test('adresse privée : IPv4 mappée en hexadécimal, compatible, 6to4, Teredo, site local, documentation', () => {
  for (const ip of [
    '::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:a00:1', '::ffff:c0a8:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:127.0.0.1',
    '::7f00:1', '::127.0.0.1', '2002:7f00:1::', '2002:808:808::1', '2001::1', '2001:0:4136:e378::1', '2001:db8::1',
    '3fff::1', 'fec0::1', 'fe80::1%lo0', '64:ff9b::7f00:1', '64:ff9b:1::1', '100::1', '5f00::1', 'ff02::1', '::', '::1',
    '192.88.99.1', '100.64.0.1', '198.18.0.1',
  ]) assert.equal(adressePrivee(ip), true, ip);
  for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808', '2606:4700::1111', '2001:4860:4860::8888', '2a00:1450:4007:80b::200e', '8.8.8.8']) {
    assert.equal(adressePrivee(ip), false, ip);
  }
});

test('verifierUrl : [::ffff:127.0.0.1] et [::ffff:169.254.169.254] (réécrits en hexadécimal par URL) refusés', async () => {
  assert.equal(new URL('https://[::ffff:127.0.0.1]/').hostname, '[::ffff:7f00:1]');
  await assert.rejects(verifierUrl('https://[::ffff:127.0.0.1]:8443/admin'), /privée/);
  await assert.rejects(verifierUrl('https://[::ffff:169.254.169.254]/latest/meta-data/'), /privée/);
  await assert.rejects(verifierUrl('https://[::ffff:10.0.0.1]/'), /privée/);
  await assert.rejects(verifierUrl('https://[2002:a9fe:a9fe::]/'), /privée/);
});

test('connexion : le nom est résolu et vérifié par la connexion elle-même (aucune adresse interne jointe)', async () => {
  const { s, port, requetes } = await serveur((_req, res) => res.end('secret interne'));
  try {
    await sansLocal(async () => {
      // « localhost » n'a pas été vérifié avant : c'est la résolution de la connexion qui refuse 127.0.0.1 / ::1
      const e = await recuperateurProtege(`http://localhost:${port}/`).then(() => null, (x: unknown) => x);
      assert.ok(e instanceof TypeError, 'appel refusé');
      assert.match(String((e.cause as Error | undefined)?.message), /privée/);
      // adresse IP littérale, forme mappée en hexadécimal comprise
      await assert.rejects(recuperateurProtege(`http://127.0.0.1:${port}/`));
      await assert.rejects(recuperateurProtege(`http://[::ffff:7f00:1]:${port}/`));
      await assert.rejects(recuperateurProtege('file:///etc/passwd'));
    });
    assert.equal(requetes(), 0, 'aucune requête n’a atteint le service interne');
    // exception de développement explicite : seul 127.0.0.1 / localhost
    await avecLocal(async () => {
      const r = await recuperateurProtege(`http://127.0.0.1:${port}/`);
      assert.equal(await r.text(), 'secret interne');
    });
  } finally { fermer(s); }
});

test('fetch protégé : JSON compressé lu, redirection jamais suivie, délai respecté, corps envoyé', async () => {
  let recu = '';
  const { s, port } = await serveur((req, res) => {
    if (req.url === '/gzip') { res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }); res.end(gzipSync(JSON.stringify({ ok: 'é' }))); return; }
    if (req.url === '/redir') { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end(); return; }
    if (req.url === '/lent') return; // ne répond jamais
    let c = '';
    req.on('data', (d: Buffer) => { c += d; });
    req.on('end', () => { recu = `${req.method} ${req.headers['content-type']} ${c}`; res.writeHead(204); res.end(); });
  });
  try {
    await avecLocal(async () => {
      const base = `http://127.0.0.1:${port}`;
      assert.deepEqual((await appeler(recuperateurProtege, new URL(`${base}/gzip`))).donnees, { ok: 'é' });
      await assert.rejects(appeler(recuperateurProtege, new URL(`${base}/redir`)), /Redirection refusée/);
      await assert.rejects(recuperateurProtege(`${base}/redir`, { redirect: 'error' }));
      await assert.rejects(appeler(recuperateurProtege, new URL(`${base}/lent`), { delaiMs: 200 }), /délai dépassé/);
      const r = await appeler(recuperateurProtege, new URL(`${base}/envoi`), { methode: 'POST', corps: { a: 1 } });
      assert.equal(r.statut, 204);
      assert.equal(recu, 'POST application/json {"a":1}');
    });
  } finally { fermer(s); }
});

test('lecture bornée : arrêt dès la limite dépassée, longueur annoncée trop grande refusée sans rien lire', async () => {
  let lus = 0;
  const morceau = new Uint8Array(1_000_000).fill(97);
  const enorme = (async () => new Response(new ReadableStream({
    pull(c) { if (lus >= 60_000_000) { c.close(); return; } lus += morceau.length; c.enqueue(morceau); },
  }), { status: 200 })) as typeof fetch;
  await assert.rejects(appeler(enorme, new URL('https://8.8.8.8/'), {}), /trop volumineuse/);
  assert.ok(lus <= 7_000_000, `au plus ~5 Mo en mémoire (lus : ${lus})`);

  let tires = 0;
  const annonce = new Response(new ReadableStream({ pull(c) { tires++; c.enqueue(morceau); } }), { headers: { 'content-length': '900000000' } });
  await assert.rejects(lireTexteBorne(annonce, 5_000_000), (e: unknown) => e instanceof ErreurSortante && /trop volumineuse/.test(e.message));
  assert.ok(tires <= 1, 'corps non lu');
  assert.equal(await lireTexteBorne(new Response('﻿bonjour é'), 100), 'bonjour é');
});

test('lecture bornée sur une vraie connexion : le service qui envoie sans fin est coupé', async () => {
  let envoyes = 0;
  const { s, port } = await serveur((_req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    const bloc = Buffer.alloc(256 * 1024, 32);
    const pousser = () => { while (envoyes < 200 * 1024 * 1024 && res.write(bloc)) envoyes += bloc.length; };
    res.on('drain', pousser);
    res.on('close', () => res.off('drain', pousser));
    pousser();
  });
  try {
    await avecLocal(async () => {
      await assert.rejects(appeler(recuperateurProtege, new URL(`http://127.0.0.1:${port}/`)), /trop volumineuse/);
    });
    assert.ok(envoyes < 50 * 1024 * 1024, `connexion coupée tôt (${Math.round(envoyes / 1e6)} Mo poussés)`);
  } finally { fermer(s); }
});
