/** Fichiers statiques : liste blanche (aucun chemin construit depuis l'URL), système de design, polices, bibliothèques. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { BIBLIOTHEQUES, fichiersStatiques } from './statiques.ts';

test('liste blanche : système de design, polices, licences et bibliothèques épinglées sont servis', () => {
  const s = fichiersStatiques();
  for (const c of ['/', '/app.js', '/style.css', '/licences.html', '/bz/bz.css', '/bz/tokens.css', '/bz/theme.js', '/bz/typo.js', '/bz/palette.js', '/bz/icones.svg',
    '/polices/inter-fr-4.1.woff2', '/polices/fraunces-fr-titre.woff2', '/polices/atkinson-next-2.001.woff2', '/licences/inter-OFL.txt', '/vendor/three.module.js']) {
    assert.ok(s.get(c), `${c} servi`);
  }
  assert.equal(s.get('/bz/bz.css')?.type, 'text/css; charset=utf-8');
  assert.equal(s.get('/polices/inter-fr-4.1.woff2')?.type, 'font/woff2');
  assert.equal(s.get('/licences/inter-OFL.txt')?.type, 'text/plain; charset=utf-8');
  for (const b of BIBLIOTHEQUES) {
    const f = s.get(b.chemin);
    assert.ok(f, `${b.chemin} servi`);
    assert.equal(f.cache, 'public, max-age=31536000, immutable', 'version dans le chemin : cache immuable');
  }
  assert.match(s.get('/vendor/ufuzzy@1.0.19.js')?.contenu.toString('utf8') ?? '', /export \{ uFuzzy as default \}/);
  assert.match(s.get('/vendor/combobox-nav@3.0.2.js')?.contenu.toString('utf8') ?? '', /export default class Combobox/);
});

test('liste blanche : modules de la coque et d’« Aujourd’hui », symbole et modules partagés servis', () => {
  const s = fichiersStatiques();
  for (const c of ['/navigation.js', '/aujourdhui.js', '/bz/activite.js', '/bz/infobulle.js', '/bz/annuler.js', '/bz/popover.js']) {
    assert.equal(s.get(c)?.type, 'text/javascript; charset=utf-8', `${c} servi comme module`);
    assert.equal(s.get(c)?.cache, 'no-cache');
  }
  assert.equal(s.get('/symbole-living-business.svg')?.type, 'image/svg+xml');
  assert.doesNotMatch(s.get('/symbole-living-business.svg')?.contenu.toString('utf8') ?? '', /<script|on[a-z]+=|href=/i, 'symbole sans script ni lien');
  // imports relatifs des modules purs : ils restent dans la liste blanche une fois résolus depuis la racine
  for (const f of ['/navigation.js', '/aujourdhui.js']) {
    for (const m of (s.get(f)?.contenu.toString('utf8') ?? '').matchAll(/from '(\.\/[^']+)'/g)) {
      const resolu = new URL(m[1] as string, `http://x${f}`).pathname;
      assert.ok(s.get(resolu), `${f} importe ${resolu}, servi`);
    }
  }
  for (const c of ['/navigation.js/../package.json', '/web/navigation.js', '/aujourdhui.ts', '/navigation', '/src/ds/coque.test.ts']) assert.equal(s.get(c), undefined, `${c} refusé`);
});

test('liste blanche : rien en dehors, ni remontée de dossier, ni ancienne police, ni fichier de travail', () => {
  const s = fichiersStatiques();
  for (const c of ['/bz/../package.json', '/bz/%2e%2e/package.json', '/../package.json', '/package.json', '/node_modules/three/package.json', '/bz/icones.txt',
    '/polices/inter-fr-4.1.json', '/polices/inter.woff2', '/polices/barlow-600.woff2', '/vendor/ufuzzy.js', '/vendor/ufuzzy@9.9.9.js', '/design/tokens.css', '/scripts/polices.py',
    '/src/passerelle/http.ts', '/licences/../LICENCES-TIERS.md', '/bz/', '/polices/', '/BZ/bz.css']) {
    assert.equal(s.get(c), undefined, `${c} refusé`);
  }
});

test('liste blanche : noms de fichiers vérifiés au démarrage (dossier factice)', () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-statiques-'));
  try {
    mkdirSync(join(d, 'web', 'bz'), { recursive: true });
    mkdirSync(join(d, 'web', 'polices'), { recursive: true });
    writeFileSync(join(d, 'web', 'index.html'), '<!doctype html>');
    writeFileSync(join(d, 'web', '.cache.js'), 'x');
    writeFileSync(join(d, 'web', 'bz', 'ok.css'), 'a{}');
    writeFileSync(join(d, 'web', 'bz', 'nom avec espace.css'), 'a{}');
    writeFileSync(join(d, 'web', 'bz', 'script.ts'), 'x');
    writeFileSync(join(d, 'web', 'polices', 'p.woff2'), 'x');
    writeFileSync(join(d, 'web', 'polices', 'p.ttf'), 'x');
    const s = fichiersStatiques(pathToFileURL(`${d}/`));
    assert.deepEqual(s.chemins().filter((c) => !c.startsWith('/vendor/three.')).sort(), ['/', '/bz/ok.css', '/polices/p.woff2'], 'bibliothèques absentes : non servies ; noms douteux écartés');
    assert.equal(s.get('/vendor/three.module.js'), undefined, 'three.js absent : rien à servir');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('passerelle : en-têtes de sécurité, police et bibliothèque servies, ancienne police introuvable', async () => {
  const app = await Application.creer({});
  const serveur: Server = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  try {
    const css = await fetch(`${base}/bz/bz.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-security-policy') ?? '', /font-src 'self'/);
    assert.match(css.headers.get('content-security-policy') ?? '', /style-src 'self';/, 'aucun style en ligne autorisé');
    assert.equal(css.headers.get('x-content-type-options'), 'nosniff');
    const police = await fetch(`${base}/polices/inter-fr-4.1.woff2`);
    assert.equal(police.headers.get('content-type'), 'font/woff2');
    const lib = await fetch(`${base}/vendor/uplot@1.6.32.js`);
    assert.equal(lib.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await fetch(`${base}/polices/inter.woff2`)).status, 404);
    assert.equal((await fetch(`${base}/bz/..%2fpackage.json`)).status, 404);
    const accueil = await (await fetch(`${base}/`)).text();
    assert.match(accueil, /<script src="\/bz\/theme\.js"><\/script>\s*<link rel="stylesheet" href="\/bz\/bz\.css">/, 'theme.js classique et synchrone, avant bz.css');
    assert.match(accueil, /<div id="bz-annonces" role="status" aria-live="polite"/, 'une seule région d’annonces, hors de #app');
    assert.doesNotMatch(accueil, /<div id="app"[^>]*aria-live/, 'plus d’aria-live sur #app');
  } finally {
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});
