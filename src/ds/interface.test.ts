/**
 * Garde-fous de l'interface (direction de design §4.0, §6.4, §8.3) sur web/app.js et web/bz/*.js :
 * pas de « (s) » dans les textes, pas de confirm()/prompt()/alert(), attributs lisibles passés par typo(), h() et remplir().
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const fichiersJs = () => ['web/app.js', 'web/formulaire.js', ...readdirSync(RACINE + 'web/bz').filter((f) => f.endsWith('.js')).map((f) => `web/bz/${f}`)];

/** Textes des littéraux de chaîne d'un source JS ('…', "…", `…` sans leurs ${…}), commentaires et expressions régulières écartés. */
export function litteraux(src: string): string[] {
  const sortie: string[] = [];
  let i = 0;
  let precedent = ''; // dernier caractère significatif, pour distinguer « / » division et expression régulière
  const lireChaine = (fin: string): string => {
    let t = '';
    i++;
    while (i < src.length && src[i] !== fin) {
      if (src[i] === '\\') { t += src.slice(i, i + 2); i += 2; continue; }
      if (fin === '`' && src[i] === '$' && src[i + 1] === '{') {
        // expression de gabarit : on l'analyse comme du code (elle peut contenir des chaînes)
        let profondeur = 1;
        i += 2;
        while (i < src.length) {
          const c = src[i];
          if (c === "'" || c === '"' || c === '`') { sortie.push(lireChaine(c)); continue; }
          if (c === '{') profondeur++;
          else if (c === '}' && --profondeur === 0) break;
          i++;
        }
        i++;
        t += '\u0000';
        continue;
      }
      t += src[i];
      i++;
    }
    i++;
    return t;
  };
  while (i < src.length) {
    const c = src[i] as string;
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
    if (c === "'" || c === '"' || c === '`') { sortie.push(lireChaine(c)); precedent = 'a'; continue; }
    if (c === '/' && /[(,=:[!&|?{};+\-*%<>~^]|^$/.test(precedent)) {
      // expression régulière littérale
      i++;
      let classe = false;
      while (i < src.length && (src[i] !== '/' || classe)) {
        if (src[i] === '\\') i++;
        else if (src[i] === '[') classe = true;
        else if (src[i] === ']') classe = false;
        i++;
      }
      i++;
      while (/[a-z]/.test(src[i] ?? '')) i++;
      precedent = 'a';
      continue;
    }
    if (!/\s/.test(c)) precedent = /[\w$)\]]/.test(c) ? 'a' : c;
    i++;
  }
  return sortie;
}

test('le lecteur de littéraux distingue code, chaînes, gabarits et expressions régulières', () => {
  const l = litteraux("const a = niveau(s); const b = 'élément(s) ok'; const c = `${n} ligne(s) ${f('x')}`; const r = /'(s)'/g; // 'commentaire(s)'");
  assert.deepEqual(l, ['élément(s) ok', 'x', '\u0000 ligne(s) \u0000']);
});

test('aucun pluriel en « (s) » ni « (x) » dans les textes de l’interface : pluriel() ou reformulation', () => {
  const fautes = fichiersJs().flatMap((f) => litteraux(lire(f)).filter((t) => /\p{L}\((?:s|x|e|es)\)/u.test(t)).map((t) => `${f} : ${t.replace(/\u0000/g, '…').slice(0, 80)}`));
  assert.deepEqual(fautes, []);
});

test('aucun confirm(), prompt() ni alert() : dialogues natifs <dialog> (dialogue.js)', () => {
  for (const f of fichiersJs()) {
    const code = lire(f).replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /(?<![\w.$])(?:window\.)?(?:confirm|alert)\s*\(/, `${f} : confirm() ou alert()`);
    assert.doesNotMatch(code, /(?<![\w.$])(?:window\.)?prompt\s*\(/, `${f} : prompt()`);
  }
});

test('attributs lus par les lecteurs d’écran et titre du document : toujours passés par typo()', () => {
  for (const f of fichiersJs()) {
    const code = lire(f);
    for (const m of code.matchAll(/setAttribute\(\s*'(aria-label|title|placeholder|alt)'\s*,\s*([^)]*)\)/g)) {
      assert.match(m[2] as string, /typo\(/, `${f} : setAttribute('${m[1]}', …) sans typo()`);
    }
    for (const m of code.matchAll(/document\.title\s*=\s*([^;]*)/g)) assert.match(m[1] as string, /typo\(/, `${f} : document.title sans typo()`);
  }
});

test('h() applique typo() et remplir() garde le focus ; plus d’aria-live sur #app ni de raccourci S', () => {
  const app = lire('web/app.js');
  assert.match(app, /import \{[^}]*\btypo\b[^}]*\} from '\/bz\/typo\.js'/);
  const corpsH = app.slice(app.indexOf('function h(tag'), app.indexOf('function remplir('));
  assert.match(corpsH, /typo\(String\(v\)\)/, 'texte');
  assert.match(corpsH, /ATTRIBUTS_TYPO\.has\(k\)/, 'aria-label, title, placeholder, alt');
  assert.match(corpsH, /data-brut/, 'échappatoire data-brut');
  assert.match(corpsH, /dataset\.cle/, 'clé « cle » → data-cle');
  const corpsRemplir = app.slice(app.indexOf('function remplir('), app.indexOf('async function api('));
  assert.match(corpsRemplir, /document\.activeElement/);
  assert.match(corpsRemplir, /setSelectionRange/);
  assert.doesNotMatch(app, /aria-live['"]?\s*:\s*['"]polite['"][^\n]*id: 'app'|id: 'app'[^\n]*aria-live/);
  assert.match(app, /h\('dialog', \{ id: 'modale'/, 'les fenêtres de l’application sont un <dialog> natif');
  assert.doesNotMatch(app, /\bs: \(\) => basculerSimulation/, 'la simulation n’est plus sur la touche S (⌘⇧S)');
  assert.match(app, /raccourci\('\$mod\+shift\+s'/);
});
