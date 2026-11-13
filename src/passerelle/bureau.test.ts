import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dossierDonnees, ecrireInstance, effacerInstance, instanceActive, lireInstance, ouvrirNavigateur } from './bureau.ts';
import { lancer } from './lancement.ts';

test('dossier des données : dossier utilisateur selon le système (survit aux mises à jour), LB_DONNEES prioritaire', () => {
  assert.equal(dossierDonnees('darwin', {}, '/Users/anna'), '/Users/anna/Library/Application Support/Living Business');
  assert.equal(dossierDonnees('win32', { APPDATA: 'C:\\Users\\anna\\AppData\\Roaming' }, 'C:\\Users\\anna'), join('C:\\Users\\anna\\AppData\\Roaming', 'Living Business'));
  assert.equal(dossierDonnees('linux', {}, '/home/anna'), '/home/anna/.local/share/living-business');
  assert.equal(dossierDonnees('linux', { XDG_DATA_HOME: '/data' }, '/home/anna'), '/data/living-business');
  assert.equal(dossierDonnees('darwin', { LB_DONNEES: '/srv/lb' }, '/Users/anna'), '/srv/lb');
});

test('navigateur : seulement une adresse locale', () => {
  assert.equal(ouvrirNavigateur('https://pirate.example/', 'linux'), false);
  assert.equal(ouvrirNavigateur('http://127.0.0.1:4173/"; rm -rf ~', 'linux'), false);
});

test('instance : reconnue seulement si le processus vit ET que Living Business répond sur le port', async () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-instance-'));
  try {
    assert.equal(await instanceActive(d), null);
    // un autre programme sur le port : pas une instance
    const autre = createServer((_q, r) => r.end('autre'));
    await new Promise<void>((ok) => autre.listen(0, '127.0.0.1', ok));
    ecrireInstance(d, (autre.address() as AddressInfo).port);
    assert.equal(await instanceActive(d), null);
    autre.closeAllConnections();
    autre.close();
    // Living Business : reconnu
    const l = await lancer({ port: 0, hote: '127.0.0.1', dossier: null, demo: false, exemple: 'pme', cookieSecure: false });
    ecrireInstance(d, l.port);
    assert.equal((await instanceActive(d))?.port, l.port);
    effacerInstance(d);
    assert.equal(lireInstance(d), null);
    await l.arreter();
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('port occupé : le lancement essaie le suivant', async () => {
  const bloque = createServer();
  await new Promise<void>((ok) => bloque.listen(0, '127.0.0.1', ok));
  const port = (bloque.address() as AddressInfo).port;
  try {
    const l = await lancer({ port, essais: 5, hote: '127.0.0.1', dossier: null, demo: false, exemple: 'pme', cookieSecure: false });
    assert.notEqual(l.port, port);
    assert.ok(l.port > port && l.port <= port + 4);
    assert.equal(l.url, `http://127.0.0.1:${l.port}/`);
    await l.arreter();
    await assert.rejects(lancer({ port, hote: '127.0.0.1', dossier: null, demo: false, exemple: 'pme', cookieSecure: false }), /déjà utilisé/);
  } finally { bloque.close(); }
});
