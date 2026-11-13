/**
 * Écrans d'entrée, « Premiers pas » et marque (direction de design §6.1 P5, §2.3, §2.5, §4.6, §4.20) :
 * web/entree.js (module pur : promesses, choix de départ, 2 temps, robustesse du mot de passe), illustration tirée de la
 * maquette, favicon et manifeste, liste blanche des fichiers servis, contrastes des nouveaux composants.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { contrasteJetons, lireJetons, type Theme } from '../../scripts/jetons.ts';
import { problemeMotDePasse } from '../passerelle/comptes.ts';
import { fichiersStatiques } from '../passerelle/statiques.ts';

type Robustesse = { niveau: 'vide' | 'faible' | 'correct' | 'solide'; libelle: string; conseil: string; valide: boolean };
type Module = {
  promesses: (o?: { enLigne?: boolean }) => Array<{ icone: string; titre: string; texte: string }>;
  departs: (e?: { reels: number; organisation?: string } | null) => Array<{ id: string; icone: string; titre: string; texte: string }>;
  TEMPS_INSTALLATION: ReadonlyArray<readonly [string, string]>;
  robustesse: (m: string, identifiant?: string) => Robustesse;
};
const M = (await import(new URL('../../web/entree.js', import.meta.url).href)) as Module;
const lire = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const normaliser = (t: string) => t.replace(/[  ]/g, ' ');

test('robustesse du mot de passe : écrite en texte (Faible, Correct, Solide), alignée sur la règle de la passerelle', () => {
  assert.equal(M.robustesse('').niveau, 'vide');
  const court = M.robustesse('court');
  assert.deepEqual([court.niveau, court.libelle, court.valide], ['faible', 'Faible', false]);
  assert.equal(normaliser(court.conseil), 'Encore 5 caractères au moins.', 'pluriel accordé, sans « (s) »');
  assert.equal(normaliser(M.robustesse('abcdefghi').conseil), 'Encore 1 caractère au moins.');
  assert.equal(M.robustesse('motdepasse123').niveau, 'faible', 'mot de passe courant');
  assert.equal(M.robustesse('aaaaaaaaaaaa').niveau, 'faible', 'un seul caractère répété');
  assert.equal(M.robustesse('maiwenn-2026-quimper', 'maiwenn@legoff.example').niveau, 'faible', 'contient l’identifiant');
  assert.equal(M.robustesse('bonjourmonami').niveau, 'correct');
  assert.equal(M.robustesse('Kerlann2026!x').niveau, 'solide', '12 caractères et 3 sortes');
  assert.equal(M.robustesse('le café de 8 h au port').niveau, 'solide', 'une petite phrase');
  // le client ne déclare jamais valide ce que la passerelle refuse pour la longueur ou l'identifiant (elle reste seule juge)
  for (const [mdp, id] of [['court', 'anne'], ['123456789', 'anne'], ['anne-bris-quimper-29', 'anne'], ['le café de 8 h au port', 'anne'], ['bonjourmonami', 'anne'], ['x'.repeat(201), 'anne']] as const) {
    const serveur = problemeMotDePasse(mdp, id) === null;
    if (M.robustesse(mdp, id).valide) assert.ok(serveur, `« ${mdp.slice(0, 20)} » : le client l’accepte, la passerelle aussi`);
    if (!serveur && mdp.length < 10) assert.equal(M.robustesse(mdp, id).valide, false);
  }
});

test('installation en 2 temps, choix de départ en grandes cartes illustrées, 3 promesses complètes', () => {
  assert.deepEqual(M.TEMPS_INSTALLATION.map(([k]) => k), ['vous', 'securite']);
  assert.deepEqual(M.TEMPS_INSTALLATION.map(([, l]) => l), ['Vous et l’entreprise', 'Sécurité']);
  assert.deepEqual(M.departs().map((d) => d.id), ['vide', 'exemple']);
  const garder = M.departs({ reels: 3, organisation: 'Kerlann Bois' });
  assert.deepEqual(garder.map((d) => d.id), ['garder', 'vide', 'exemple']);
  assert.equal(normaliser(garder[0]?.texte ?? ''), '3 éléments déjà saisis pour Kerlann Bois.');
  assert.equal(normaliser(M.departs({ reels: 1 })[0]?.texte ?? ''), '1 élément déjà saisi.');
  const sprite = lire('web/bz/icones.svg');
  for (const enLigne of [false, true]) {
    const p = M.promesses({ enLigne });
    assert.equal(p.length, 3);
    for (const x of p) {
      assert.match(x.texte, /\.$/, 'phrase complète (aussi sur téléphone)');
      assert.ok(sprite.includes(`id="i-${x.icone}"`), x.icone);
    }
    assert.equal(/serveur/.test(p[0]?.titre ?? ''), enLigne);
  }
  for (const d of garder) assert.ok(sprite.includes(`id="i-${d.icone}"`), d.icone);
});

test('écrans d’entrée : Moucheture, « par Breizhcosystem », illustration du port, restauration visible, plus de « LB »', () => {
  const app = lire('web/app.js');
  assert.doesNotMatch(app, /texte: 'LB'|LIVING BUSINESS|PREMIÈRE UTILISATION|'À GARDER EN LIEU SÛR'|'CONNEXION'/, 'ni monogramme « LB » ni capitales écrites');
  assert.match(app, /h\('img', \{ src: '\/symbole-living-business\.svg', alt: '', width: '28', height: '28' \}\)/, 'symbole produit de 28 px');
  assert.match(app, /h\('small', \{ texte: `par \$\{MARQUE\.mere\}` \}\)/, 'endossement sous le nom');
  assert.match(app, /h\('source', \{ type: 'image\/avif', srcset: `\/illustrations\/\$\{n\}\.avif` \}\)/, 'AVIF avec repli WebP');
  assert.match(app, /class: 'bz-entree__illustration', src: `\/illustrations\/\$\{n\}\.webp`, alt: ''/, 'l’illustration ne porte aucune information');
  assert.ok(app.includes('Vous changez d’ordinateur ? Restaurer une sauvegarde'), 'restauration en lien secondaire visible');
  assert.ok(app.includes("tempsInstallation(S.temps)"), 'installation en 2 temps');
  assert.match(lire('web/bz/composants.css'), /\.bz-entree \{[^}]*min-block-size: 100dvh/, '100dvh');
  // un seul parcours d'accueil : « Premiers pas » ; plus de pastilles, rangs ni progression de « Mise en route »
  assert.doesNotMatch(app, /apercu-etapes|visite-progression|Mise en route · étape|'CONSTRUIRE MON MONDE'|'MISE EN ROUTE|CRÉONS VOTRE MONDE/);
  assert.match(app, /href: `\/\?etape=\$\{e\.id\}`/, 'chaque étape a son lien profond (?etape=donnees)');
  assert.match(app, /\['list-checks', 'Premiers pas', ouvrirPremiersPas\]/, '« Premiers pas » reste dans Aide');
  assert.doesNotMatch(lire('web/style.css'), /\.entree-marque|\.promesses|\.option-depart|\.apercu-etapes/, 'ancien CSS des écrans d’entrée retiré');
});

test('marque : favicon (dessin de 16 à 23 px), manifeste, theme-color et icônes Moucheture (§2.3)', () => {
  const index = lire('web/index.html');
  assert.ok(index.includes('<meta name="theme-color" content="#f9f6f2" media="(prefers-color-scheme: light)">'));
  assert.ok(index.includes('<meta name="theme-color" content="#091115" media="(prefers-color-scheme: dark)">'));
  assert.ok(index.includes('<link rel="icon" type="image/svg+xml" href="/favicon.svg">'));
  const favicon = lire('web/favicon.svg');
  assert.match(favicon, /<circle cx="24" cy="8" r="5\.5" fill="#f7c323"\/>/, 'petite taille : points grossis et écartés');
  assert.match(favicon, /<rect width="48" height="48" rx="11" fill="#006f85"\/>/);
  assert.doesNotMatch(favicon, /<script|on[a-z]+=|href=|<line|<polyline/i, 'ni script ni lignes entre les points');
  const m = JSON.parse(lire('web/manifest.webmanifest')) as { name: string; short_name: string; icons: Array<{ src: string; purpose: string }> };
  assert.deepEqual([m.name, m.short_name], ['Living Business', 'Living Business']);
  for (const i of m.icons) assert.ok(statSync(new URL(`../../web${i.src}`, import.meta.url)).size > 500, i.src);
  assert.deepEqual([...new Set(m.icons.map((i) => i.purpose))].sort(), ['any', 'maskable']);
});

test('liste blanche : illustrations AVIF et WebP, modules de l’assistant et des écrans d’entrée ; rien d’autre', () => {
  const s = fichiersStatiques();
  for (const n of ['port-aube', 'port-nuit']) {
    const avif = s.get(`/illustrations/${n}.avif`);
    const webp = s.get(`/illustrations/${n}.webp`);
    assert.equal(avif?.type, 'image/avif');
    assert.equal(webp?.type, 'image/webp');
    assert.ok((avif?.contenu.length ?? Infinity) <= 20_000, `${n}.avif : 20 Ko au plus (§8.2)`);
    assert.equal(avif?.contenu.subarray(4, 12).toString('latin1'), 'ftypavif', 'vrai fichier AVIF');
    assert.equal(webp?.contenu.subarray(8, 12).toString('latin1'), 'WEBP', 'vrai fichier WebP');
  }
  for (const c of ['/connecter.js', '/entree.js']) assert.equal(s.get(c)?.type, 'text/javascript; charset=utf-8', `${c} servi comme module`);
  assert.equal(s.get('/favicon.svg')?.type, 'image/svg+xml');
  for (const c of ['/illustrations/../package.json', '/illustrations/', '/illustrations/port-aube.png', '/illustrations/port-aube-capture.webp', '/design/vignettes/port-aube-capture.webp', '/__vignettes/port-aube', '/scripts/vignettes.ts', '/scripts/vignettes.py']) {
    assert.equal(s.get(c), undefined, `${c} refusé`);
  }
  // les modules purs n'importent que des fichiers servis
  for (const f of ['/connecter.js', '/entree.js']) {
    for (const i of (s.get(f)?.contenu.toString('utf8') ?? '').matchAll(/from '(\.\/[^']+)'/g)) assert.ok(s.get(new URL(i[1] as string, `http://x${f}`).pathname), `${f} importe ${i[1]}`);
  }
});

test('contrastes des nouveaux composants (assistant, catalogue, écrans d’entrée), clair et sombre', () => {
  const j = lireJetons(lire('web/bz/tokens.css'));
  const paires: Array<[string, string, number, string]> = [
    ['--bz-cat-icone', '--bz-cat-fond', 3, 'pictogramme de famille d’un logiciel'],
    ['--bz-texte-2', '--bz-fond-2', 4.5, 'consignes, « Pourquoi on vous le demande », promesses'],
    ['--bz-texte-3', '--bz-fond-2', 4.5, 'pied du panneau de marque'],
    ['--bz-texte', '--bz-fond-2', 7, 'titres des promesses'],
    ['--bz-marque-texte', '--bz-fond-2', 4.5, 'liens et icônes des promesses'],
    ['--bz-bordure-champ', '--bz-fond-2', 3, 'bord de la zone de dépôt'],
    ['--bz-marque', '--bz-composant', 3, 'barre de progression des étapes'],
    ['--bz-critique-trait', '--bz-composant', 3, 'robustesse : faible'],
    ['--bz-attention-trait', '--bz-composant', 3, 'robustesse : correct'],
    ['--bz-ok-trait', '--bz-composant', 3, 'robustesse : solide'],
    ['--bz-texte-2', '--bz-surface-elevee', 4.5, 'texte du corps de l’assistant'],
    ['--bz-marque-texte', '--bz-marque-doux', 4.5, 'icône d’une réponse choisie'],
  ];
  const echecs: string[] = [];
  for (const theme of ['clair', 'sombre'] as Theme[]) {
    for (const [a, f, seuil, usage] of paires) {
      const r = contrasteJetons(j, theme, a, f);
      if (r < seuil) echecs.push(`${theme} : ${a} sur ${f} (${usage}) = ${r.toFixed(2)} < ${seuil}`);
    }
  }
  assert.deepEqual(echecs, []);
});

test('vignettes (outil de développement) : seule la route POST /__vignettes/<nom en liste blanche> est reçue', async () => {
  const { NOMS_VIGNETTES, recevoirVignette } = await import('../../scripts/vignettes.ts');
  assert.deepEqual([...NOMS_VIGNETTES], ['port-aube', 'port-nuit']);
  const reponse = () => { const r = { code: 0, writeHead(c: number) { r.code = c; return r; }, end() { return r; } }; return r; };
  const dossier = new URL('file:///nulle-part/');
  const req = (method: string, url: string, type = 'image/webp') => ({ method, url, headers: { 'content-type': type }, on() { return this; } });
  for (const [m, u] of [['GET', '/__vignettes/port-aube'], ['POST', '/__vignettes/autre'], ['POST', '/__vignettes/../package.json'], ['POST', '/api/v1/monde']] as const) {
    assert.equal(recevoirVignette(req(m, u) as never, reponse() as never, dossier), false, `${m} ${u} : laissé à la passerelle`);
  }
  const r = reponse();
  assert.equal(recevoirVignette(req('POST', '/__vignettes/port-aube', 'text/html') as never, r as never, dossier), true);
  assert.equal(r.code, 415, 'seulement une image WebP ou PNG');
});
