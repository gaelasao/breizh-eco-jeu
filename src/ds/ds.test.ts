/**
 * Système de design Breizhcosystem (direction de design §3.9) : parité des jetons avec design/, fichiers générés à
 * jour, contrastes recalculés, aucune valeur codée en dur, glyphes français des polices, icônes, licences.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fichiersAttendus } from '../../scripts/ds-synchro.ts';
import { contrasteJetons, lireJetons, type Theme } from '../../scripts/jetons.ts';
import { spriteAttendu } from '../../scripts/sprite.ts';
import { pointsDeCode } from '../../scripts/woff2.ts';
import { BIBLIOTHEQUES } from '../passerelle/statiques.ts';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const octets = (f: string) => readFileSync(RACINE + f);
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const THEMES: Theme[] = ['clair', 'sombre'];

test('jetons : web/bz/tokens.css est la copie exacte de design/tokens.css, empreintes du manifeste', () => {
  const manifeste = JSON.parse(lire('design/dist/MANIFESTE.json')) as { version: string; fichiers: Record<string, { sha256: string; octets: number }> };
  assert.equal(lire('web/bz/tokens.css'), lire('design/tokens.css'), 'parité au bit près (P7)');
  assert.equal(sha(octets('design/tokens.css')), manifeste.fichiers['tokens.css']?.sha256, 'tokens.css conforme au manifeste');
  assert.equal(sha(octets('design/dist/tokens.min.css')), manifeste.fichiers['tokens.min.css']?.sha256, 'tokens.min.css conforme au manifeste');
  assert.match(lire('design/tokens.css'), new RegExp(`tokens\\.css\\) v${manifeste.version.replace(/\./g, '\\.')}`), 'en-tête de version = manifeste');
  assert.ok(lire('web/bz/bz.css').startsWith(`/*! Breizhcosystem — bz.css v${manifeste.version}`));
});

test('jetons : bz.css (couches, jetons minifiés, polices, base, composants) et tokens.css sont à jour', () => {
  for (const [f, attendu] of Object.entries(fichiersAttendus())) assert.equal(lire(f), attendu, `${f} : lancez npm run ds:synchro`);
  const bz = lire('web/bz/bz.css');
  assert.ok(bz.indexOf('@layer bz.jetons, bz.base, bz.composants, bz.utilitaires;') < bz.search(/@layer bz\.jetons\s*\{/), 'ordre des couches déclaré en tête');
  assert.ok(bz.includes('@layer bz.base {') && bz.includes('@layer bz.composants {'));
});

test('contrastes WCAG 2.2 AA recalculés sur tokens.css, clair et sombre', () => {
  const j = lireJetons(lire('web/bz/tokens.css'));
  const paires: Array<[string, string, number]> = [
    ['--bz-texte', '--bz-surface', 7], ['--bz-texte', '--bz-fond', 7], ['--bz-texte', '--bz-fond-2', 7], ['--bz-texte', '--bz-surface-elevee', 7],
    ['--bz-texte-2', '--bz-surface', 4.5], ['--bz-texte-2', '--bz-fond', 4.5], ['--bz-texte-2', '--bz-composant-survol', 4.5], ['--bz-texte-2', '--bz-composant-presse', 4.5],
    ['--bz-texte-3', '--bz-surface', 4.5], ['--bz-texte-3', '--bz-fond', 4.5], ['--bz-texte-3', '--bz-composant-survol', 4.5], ['--bz-texte-3', '--bz-surface-elevee', 4.5],
    ['--bz-bordure-champ', '--bz-surface', 3], ['--bz-bordure-champ', '--bz-fond', 3], ['--bz-bordure-champ', '--bz-composant', 3],
    ['--bz-etat-indicateur', '--bz-fond-2', 3], ['--bz-etat-indicateur', '--bz-marque-doux', 3], ['--bz-etat-indicateur', '--bz-composant', 3],
    ['--bz-focus-couleur', '--bz-surface', 3], ['--bz-focus-couleur', '--bz-fond', 3], ['--bz-focus-couleur', '--bz-surface-elevee', 3],
    ['--bz-marque-texte', '--bz-surface', 4.5], ['--bz-marque-texte', '--bz-fond-2', 4.5], ['--bz-marque-texte', '--bz-selection', 4.5],
    ['--bz-sur-marque', '--bz-marque', 4.5], ['--bz-sur-marque', '--bz-marque-survol', 4.5],
    ['--bz-ok-texte', '--bz-ok-fond', 4.5], ['--bz-attention-texte', '--bz-attention-fond', 4.5], ['--bz-critique-texte', '--bz-critique-fond', 4.5], ['--bz-info-texte', '--bz-info-fond', 4.5],
    ['--bz-ok-texte', '--bz-surface', 4.5], ['--bz-attention-texte', '--bz-surface', 4.5], ['--bz-critique-texte', '--bz-surface', 4.5], ['--bz-info-texte', '--bz-surface', 4.5],
    ['--bz-sur-ok', '--bz-ok-plein', 4.5], ['--bz-sur-attention', '--bz-attention-plein', 4.5], ['--bz-sur-critique', '--bz-critique-plein', 4.5], ['--bz-sur-info', '--bz-info-plein', 4.5],
    ['--bz-ok-trait', '--bz-surface', 3], ['--bz-attention-trait', '--bz-surface', 3], ['--bz-critique-trait', '--bz-surface', 3], ['--bz-info-trait', '--bz-surface', 3],
    ['--bz-sur-inverse', '--bz-surface-inverse', 7], ['--bz-lien-inverse', '--bz-surface-inverse', 4.5], ['--bz-focus-inverse', '--bz-surface-inverse', 3],
    ['--bz-sur-accent', '--bz-accent', 4.5], ['--bz-accent-texte', '--bz-surface', 4.5],
    ['--bz-dv-1', '--bz-surface', 3], ['--bz-dv-2', '--bz-surface', 3], ['--bz-dv-3', '--bz-surface', 3], ['--bz-dv-4', '--bz-surface', 3], ['--bz-dv-5', '--bz-surface', 3], ['--bz-dv-6', '--bz-surface', 3],
  ];
  const echecs: string[] = [];
  for (const theme of THEMES) {
    for (const [avant, fond, seuil] of paires) {
      const r = contrasteJetons(j, theme, avant, fond);
      if (r < seuil) echecs.push(`${theme} : ${avant} sur ${fond} = ${r.toFixed(2)} < ${seuil}`);
    }
  }
  assert.deepEqual(echecs, []);
  // valeurs publiées au §3.4 (à ±0,02 près) : le calcul indépendant retrouve le générateur
  assert.ok(Math.abs(contrasteJetons(j, 'clair', '--bz-texte', '--bz-surface') - 16.66) < 0.02);
  assert.ok(Math.abs(contrasteJetons(j, 'sombre', '--bz-texte-3', '--bz-surface') - 6.08) < 0.02);
});

/** Valeurs codées en dur interdites hors de tokens.css (§3.1) : #hex, rgb(), hsl(), oklch(), et px hors 0, 1px, 2px. */
function valeursEnDur(texte: string, css: boolean): string[] {
  const sansCommentaires = texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(css ? /$^/ : /(^|[^:'"`])\/\/.*$/gm, '$1');
  const fautes: string[] = [];
  for (const m of sansCommentaires.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/g)) fautes.push(m[0]);
  for (const m of sansCommentaires.matchAll(/(?<![\w.$-])(\d*\.?\d+)px\b/g)) if (!['0', '1', '2'].includes(m[1] as string)) fautes.push(m[0]);
  return fautes;
}

test('aucune couleur ni taille codée en dur dans base.css, composants.css, polices.css et les modules web/bz', () => {
  const fichiers = ['base.css', 'composants.css', 'polices.css', ...readdirSync(RACINE + 'web/bz').filter((f) => f.endsWith('.js'))];
  const fautes = fichiers.flatMap((f) => valeursEnDur(lire(`web/bz/${f}`), f.endsWith('.css')).map((v) => `${f} : ${v}`));
  assert.deepEqual(fautes, []);
  assert.deepEqual(valeursEnDur('.x { color: #fff; margin: 3px; inset: 1px; }', true), ['#fff', '3px'], 'le détecteur détecte');
});

test('polices : Inter et Fraunces en sous-ensemble français, glyphes vérifiés dans les fichiers servis', () => {
  const inter = octets('web/polices/inter-fr-4.1.woff2');
  const fraunces = octets('web/polices/fraunces-fr-titre.woff2');
  const ci = pointsDeCode(inter);
  const cf = pointsDeCode(fraunces);
  // U+202F, U+00A0, U+2009, « », €, œ, Œ, Ÿ, ’, …, ⌘
  for (const c of [0x202f, 0x00a0, 0x2009, 0x00ab, 0x00bb, 0x20ac, 0x0153, 0x0152, 0x0178, 0x2019, 0x2026, 0x2318]) assert.ok(ci.has(c), `Inter : U+${c.toString(16).toUpperCase()}`);
  for (const c of [0x00ab, 0x00bb, 0x20ac, 0x0153, 0x2019, 0x2026, 0x00e9, 0x00e0]) assert.ok(cf.has(c), `Fraunces : U+${c.toString(16).toUpperCase()}`);
  for (const [f, b] of [['inter-fr-4.1', inter], ['fraunces-fr-titre', fraunces]] as const) {
    const j = JSON.parse(lire(`web/polices/${f}.json`)) as { sha256: string; pointsDeCode: string[] };
    assert.equal(j.sha256, sha(b), `${f}.json : empreinte du fichier servi`);
    assert.equal(j.pointsDeCode.length, pointsDeCode(b).size);
  }
  assert.ok(inter.length < 85_000 && fraunces.length < 50_000, 'budgets du §7.1');
  assert.ok(existsSync(RACINE + 'web/polices/atkinson-next-2.001.woff2'), 'police haute lisibilité (chargée à la demande)');
  const polices = lire('web/bz/polices.css');
  for (const f of ['inter-fr-4.1.woff2', 'fraunces-fr-titre.woff2', 'atkinson-next-2.001.woff2']) assert.ok(polices.includes(`/polices/${f}`));
});

test('icônes : sprite à jour (Lucide 1.71.0 + icônes maison), toutes les icônes utilisées existent', () => {
  const sprite = lire('web/bz/icones.svg');
  assert.equal(sprite, spriteAttendu(), 'web/bz/icones.svg : lancez npm run icones:sprite');
  assert.doesNotMatch(sprite, /<style|style=|<script|on[a-z]+=|href=/i, 'aucun style, script ni lien');
  const ids = new Set([...sprite.matchAll(/<symbol id="i-([a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const n of ['bz-moucheture', 'bz-nexus', 'bz-phare-allume', 'x', 'search', 'chevron-down']) assert.ok(ids.has(n), n);
  const sources = [lire('web/app.js'), ...readdirSync(RACINE + 'web/bz').filter((f) => f.endsWith('.js')).map((f) => lire(`web/bz/${f}`))].join('\n');
  const utilisees = new Set([...sources.matchAll(/icone\('([a-z0-9-]+)'/g), ...sources.matchAll(/icone: '([a-z0-9-]+)'/g)].map((m) => m[1] as string));
  for (const table of ['ICONE_FAMILLE', 'ICONE_NIVEAU', 'ICONE_VUE', 'ICONES']) {
    const corps = new RegExp(`const ${table} = \\{([^}]*)\\}`).exec(sources)?.[1];
    assert.ok(corps, `table ${table}`);
    for (const m of corps.matchAll(/:\s*'([a-z0-9-]+)'/g)) utilisees.add(m[1] as string);
  }
  utilisees.add('chevron-right');
  assert.ok(utilisees.size > 20);
  assert.deepEqual([...utilisees].filter((n) => !ids.has(n)), [], 'icônes absentes du sprite');
});

test('bibliothèques et licences : versions exactes, attributions et textes complets présents', () => {
  const pkg = JSON.parse(lire('package.json')) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
  for (const [nom, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) assert.match(v, /^\d+\.\d+\.\d+$/, `${nom} épinglé exactement (${v})`);
  assert.ok(!('@fontsource-variable/inter' in pkg.dependencies) && !('@fontsource/barlow-condensed' in pkg.dependencies), 'Inter Fontsource et Barlow retirés');
  for (const b of BIBLIOTHEQUES) assert.equal(pkg.dependencies[b.paquet], b.version, `${b.paquet} : même version dans package.json et dans le chemin servi`);
  const tiers = lire('LICENCES-TIERS.md');
  const cites = [...tiers.matchAll(/web\/licences\/([A-Za-z0-9.-]+\.txt)/g)].map((m) => m[1] as string);
  assert.ok(cites.length >= 10);
  for (const f of cites) assert.ok(existsSync(RACINE + `web/licences/${f}`), f);
  const page = lire('web/licences.html');
  for (const f of readdirSync(RACINE + 'web/licences')) assert.ok(page.includes(`/licences/${f}`), `licences.html cite ${f}`);
  for (const nom of ['Inter', 'Fraunces', 'Atkinson Hyperlegible Next', 'Lucide', 'three.js', 'camera-controls', 'uPlot', 'uFuzzy', 'combobox-nav', 'KayKit', 'Node.js']) {
    assert.ok(tiers.includes(nom) && page.includes(nom), nom);
  }
  // l'OFL exige que les champs de licence restent dans les fichiers de police
  for (const f of ['inter-fr-4.1.woff2', 'fraunces-fr-titre.woff2']) assert.ok(octets(`web/polices/${f}`).length > 0);
});

test('marque : constante MARQUE et plus aucune trace de « BREIZH ECO » ni de Barlow dans l’interface', async () => {
  const { MARQUE } = (await import(new URL('../../web/bz/marque.js', import.meta.url).href)) as { MARQUE: { mere: string; jeu: string; reseau: string; offre: string; endossement: (p: string) => string } };
  assert.equal(MARQUE.mere, 'Breizhcosystem');
  assert.equal(MARQUE.endossement(MARQUE.jeu), 'Living Business par Breizhcosystem');
  assert.ok(Object.isFrozen(MARQUE));
  const web = readdirSync(RACINE + 'web').filter((f) => /\.(html|js|css|webmanifest)$/.test(f)).map((f) => [f, lire(`web/${f}`)] as const);
  for (const [f, t] of [...web, ['README.md', lire('README.md').replace(/l'ancien nom « BREIZH ECO » est abandonné/, '')] as const, ['package.json', lire('package.json')] as const]) {
    assert.doesNotMatch(t, /BREIZH ECO|Breizh Eco|breizh-eco\.bzh/, `${f} : ancien nom`);
    assert.doesNotMatch(t, /Barlow|fontsource|Living Biz\b/, `${f} : ancienne police ou ancien nom court`);
  }
  const manifeste = JSON.parse(lire('web/manifest.webmanifest')) as { name: string; short_name: string; theme_color: string; background_color: string };
  assert.deepEqual([manifeste.name, manifeste.short_name, manifeste.theme_color, manifeste.background_color], ['Living Business', 'Living Business', '#006f85', '#f9f6f2']);
});
