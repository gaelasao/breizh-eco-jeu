/**
 * Sprite d'icônes de Breizhcosystem (direction de design §2.5, §4.24, §7.1) — outil de développement.
 *
 *   node scripts/sprite.ts            → écrit web/bz/icones.svg
 *   node scripts/sprite.ts --verifier → échoue si web/bz/icones.svg n'est plus à jour
 *
 * Source : lucide-static 1.71.0 (devDependency, ISC + MIT pour les icônes issues de Feather), réduit aux icônes listées
 * dans web/bz/icones.txt, plus les icônes maison de design/icones-maison/ (préfixe « bz- »).
 * Chaque icône devient <symbol id="i-…" viewBox="0 0 24 24"> : attributs racine, `class`, `style` et <style> retirés ;
 * trait, bouts et couleur sont posés par la classe .bz-icone (stroke: currentColor), qui survit à forced-colors.
 * Le script échoue si un nom manque, ou si un fichier contient autre chose que des formes géométriques.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = new URL('../', import.meta.url);
export const FICHIER_SPRITE = fileURLToPath(new URL('web/bz/icones.svg', RACINE));
const LISTE = fileURLToPath(new URL('web/bz/icones.txt', RACINE));
const LUCIDE = new URL('node_modules/lucide-static/', RACINE);
const MAISON = new URL('design/icones-maison/', RACINE);

const BALISES = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse']);
const ATTRIBUTS = new Set(['d', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'points', 'fill', 'stroke', 'transform']);
const VALEUR = /^[A-Za-z0-9 .,#()+-]*$/; // nombres, commandes de tracé, currentColor, none, translate(…)

/** Noms d'icônes d'un fichier de liste (une par ligne, « # » commente). */
export function lireListe(texte: string): string[] {
  const noms = texte.split('\n').map((l) => l.replace(/#.*/, '').trim()).filter(Boolean);
  for (const n of noms) if (!/^[a-z0-9-]+$/.test(n)) throw new Error(`Nom d'icône invalide : « ${n} »`);
  const doublons = noms.filter((n, i) => noms.indexOf(n) !== i);
  if (doublons.length) throw new Error(`Icônes en double dans la liste : ${doublons.join(', ')}`);
  return noms;
}

/** Contenu d'un SVG d'icône réduit à ses formes, attributs vérifiés. Lève une erreur sur tout le reste. */
export function formes(svg: string, nom: string): string {
  const corps = /<svg\b[^>]*>([\s\S]*)<\/svg>/.exec(svg.replace(/<!--[\s\S]*?-->/g, ''));
  if (!corps) throw new Error(`${nom} : balise <svg> introuvable`);
  const sortie: string[] = [];
  let reste = corps[1] as string;
  const element = /^\s*<([a-z]+)((?:\s+[a-z][a-z0-9-]*="[^"]*")*)\s*\/>/;
  while (reste.trim()) {
    const m = element.exec(reste);
    if (!m) throw new Error(`${nom} : contenu non pris en charge près de « ${reste.trim().slice(0, 40)} »`);
    const balise = m[1] as string;
    if (!BALISES.has(balise)) throw new Error(`${nom} : balise <${balise}> refusée`);
    const attrs: string[] = [];
    for (const a of (m[2] as string).matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/g)) {
      const [, cle, valeur] = a as unknown as [string, string, string];
      if (!ATTRIBUTS.has(cle)) throw new Error(`${nom} : attribut « ${cle} » refusé sur <${balise}>`);
      if (!VALEUR.test(valeur)) throw new Error(`${nom} : valeur refusée pour « ${cle} »`);
      if ((cle === 'fill' || cle === 'stroke') && !['none', 'currentColor'].includes(valeur)) throw new Error(`${nom} : couleur en dur refusée (${cle}="${valeur}")`);
      attrs.push(`${cle}="${valeur}"`);
    }
    sortie.push(`<${balise} ${attrs.join(' ')}/>`);
    reste = reste.slice(m[0].length);
  }
  if (!sortie.length) throw new Error(`${nom} : icône vide`);
  return sortie.join('');
}

export interface Sources {
  lucide: (nom: string) => string | null;
  maison: () => Array<{ nom: string; svg: string }>;
  versionLucide: string;
}

/** Construit le sprite complet (texte du fichier). */
export function construireSprite(noms: string[], src: Sources): string {
  const manquantes = noms.filter((n) => src.lucide(n) === null);
  if (manquantes.length) throw new Error(`Icônes absentes de lucide-static ${src.versionLucide} : ${manquantes.join(', ')}`);
  const symboles = noms.map((n) => `<symbol id="i-${n}" viewBox="0 0 24 24">${formes(src.lucide(n) as string, n)}</symbol>`);
  for (const { nom, svg } of src.maison()) symboles.push(`<symbol id="i-${nom}" viewBox="0 0 24 24">${formes(svg, nom)}</symbol>`);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg">',
    `<!-- Breizhcosystem — sprite d'icônes généré par scripts/sprite.ts ; ne pas éditer à la main.`,
    `     Icônes Lucide ${src.versionLucide} : Copyright (c) 2026 Lucide Icons and Contributors, licence ISC ;`,
    '     icônes issues de Feather : Copyright (c) 2013-present Cole Bemis, licence MIT. Textes complets : /licences/lucide-ISC-MIT.txt',
    '     Icônes « bz-* » : propriété de Breizhcosystem. -->',
    ...symboles,
    '</svg>',
    '',
  ].join('\n');
}

export function sourcesLocales(): Sources {
  const version = (JSON.parse(readFileSync(new URL('package.json', LUCIDE), 'utf8')) as { version: string }).version;
  return {
    versionLucide: version,
    lucide: (nom) => {
      try { return readFileSync(new URL(`icons/${nom}.svg`, LUCIDE), 'utf8'); } catch { return null; }
    },
    maison: () => readdirSync(MAISON).filter((f) => /^bz-[a-z0-9-]+\.svg$/.test(f)).sort()
      .map((f) => ({ nom: f.slice(0, -4), svg: readFileSync(new URL(f, MAISON), 'utf8') })),
  };
}

export function spriteAttendu(): string {
  return construireSprite(lireListe(readFileSync(LISTE, 'utf8')), sourcesLocales());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const attendu = spriteAttendu();
  if (process.argv.includes('--verifier')) {
    let actuel = '';
    try { actuel = readFileSync(FICHIER_SPRITE, 'utf8'); } catch { /* absent */ }
    if (actuel !== attendu) { console.error('web/bz/icones.svg n’est pas à jour : lancez npm run icones:sprite'); process.exit(1); }
    console.log('web/bz/icones.svg est à jour.');
  } else {
    writeFileSync(FICHIER_SPRITE, attendu);
    console.log(`web/bz/icones.svg : ${(attendu.match(/<symbol /g) ?? []).length} icônes, ${Buffer.byteLength(attendu)} octets`);
  }
}
