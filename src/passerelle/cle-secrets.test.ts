/**
 * Clé des secrets et adresse du webhook sortant (constat jeu-connecteurs-10) : en ligne, la clé vient de l'identifiant
 * systemd (hors du dossier des données) et n'y est jamais créée ; l'adresse du webhook sortant, qui donne accès à elle
 * seule au scénario Make ou Zapier, est chiffrée au repos et masquée pour le navigateur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Stockage, dechiffrerAvecPhrase } from './stockage.ts';
import { Application } from './application.ts';

function avecEnv<T>(env: Record<string, string | undefined>, f: () => T): T {
  const avant = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return f(); } finally {
    for (const [k, v] of Object.entries(avant)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('en ligne : clé lue dans l’identifiant systemd, aucune clé écrite à côté des données', () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-cle-'));
  try {
    const donnees = join(d, 'donnees');
    const identifiants = join(d, 'identifiants');
    const cle = randomBytes(32);
    // identifiant systemd ($CREDENTIALS_DIRECTORY/cle-secrets) : utilisé, rien n'est créé dans les données
    mkdirSync(identifiants);
    writeFileSync(join(identifiants, 'cle-secrets'), `${cle.toString('base64')}\n`);
    const s = avecEnv({ CREDENTIALS_DIRECTORY: identifiants, LB_CLE_HORS_DONNEES: '1', LB_CLE_SECRETS: undefined }, () => new Stockage(donnees));
    assert.deepEqual(s.cle, cle);
    assert.equal(existsSync(join(donnees, 'cle-secrets')), false);
    // identifiant absent en ligne : démarrage refusé, jamais de clé neuve (elle rendrait les jetons illisibles)
    assert.throws(() => avecEnv({ CREDENTIALS_DIRECTORY: join(d, 'absent'), LB_CLE_HORS_DONNEES: '1', LB_CLE_SECRETS: undefined }, () => new Stockage(donnees)), /introuvable/);
    assert.equal(existsSync(join(donnees, 'cle-secrets')), false);
    // l'identifiant l'emporte sur une ancienne copie restée dans les données
    writeFileSync(join(donnees, 'cle-secrets'), randomBytes(32).toString('base64'));
    assert.deepEqual(avecEnv({ CREDENTIALS_DIRECTORY: identifiants, LB_CLE_HORS_DONNEES: '1', LB_CLE_SECRETS: undefined }, () => new Stockage(donnees)).cle, cle);
    // poste de bureau (sans systemd) : comportement inchangé, clé créée dans le dossier des données
    const bureau = join(d, 'bureau');
    const b = avecEnv({ CREDENTIALS_DIRECTORY: undefined, LB_CLE_HORS_DONNEES: undefined, LB_CLE_SECRETS: undefined }, () => new Stockage(bureau));
    assert.equal(readFileSync(join(bureau, 'cle-secrets'), 'utf8'), b.cle.toString('base64'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('webhook sortant : adresse chiffrée au repos (état, export), masquée pour le navigateur, gardée si renvoyée masquée', async () => {
  const URL_HOOK = 'https://hook.eu1.make.com/abcdefghijklmnopqrstuvwxyz012345';
  const cle = randomBytes(32);
  const appels: string[] = [];
  const f = (async (url: URL | string) => { appels.push(String(url)); return new Response('ok'); }) as typeof fetch;
  const app = await Application.creer({ exemple: 'pme', fetch: f }, cle);
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  const c = app.synchro.creer(p, { source: 'webhook', config: { urlSortante: URL_HOOK }, typeObjet: 'entreprise', roles: ['client'], mapping: { Nom: '__nom' }, sens: 'deux', intervalleS: 3600 }) as { id: string; config: Record<string, string> };
  assert.equal(c.config.urlSortante, 'https://hook.eu1.make.com/…', 'navigateur : hôte seulement');
  assert.equal(JSON.stringify(app.synchro.lister(p)).includes('abcdefghijklmnop'), false);
  // état enregistré (monde.json, sauvegardes) et export : jamais l'adresse en clair
  const etat = JSON.stringify(app.instantane());
  assert.equal(etat.includes('abcdefghijklmnop'), false, 'état chiffré');
  assert.match(etat, /"urlSortante":"v1\./);
  const phrase = 'phrase-de-test-assez-longue-pour-l-export';
  const fichier = await app.exporter(p, { phrase });
  assert.equal((await dechiffrerAvecPhrase(fichier, phrase)).includes('abcdefghijklmnop'), false, 'export chiffré');
  // l'adresse reste utilisable, et l'adresse masquée renvoyée par le navigateur ne la remplace pas
  app.synchro.modifier(p, c.id, { config: { urlSortante: 'https://hook.eu1.make.com/…' } });
  await app.synchro.notifier('essai', { a: 1 });
  assert.deepEqual(appels, [URL_HOOK]);
  // rechargement depuis l'état enregistré (même clé) : l'adresse est relue ; autre clé : effacée, signalée
  const relue = await Application.creer({ fetch: f, etat: JSON.parse(etat) }, cle);
  appels.length = 0;
  await relue.synchro.notifier('essai', { a: 2 });
  assert.deepEqual(appels, [URL_HOOK]);
  const ailleurs = await Application.creer({ fetch: f, etat: JSON.parse(etat) }, randomBytes(32));
  const pa = ailleurs.monde.profil('dirigeante');
  assert.ok(pa);
  const vue = ailleurs.synchro.lister(pa)[0];
  assert.equal(vue?.config.urlSortante, '', 'illisible avec une autre clé : effacée, jamais envoyée de travers');
  assert.equal(vue?.statut, 'erreur');
  app.arreter();
  relue.arreter();
  ailleurs.arreter();
});
