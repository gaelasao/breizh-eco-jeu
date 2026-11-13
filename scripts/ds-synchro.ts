/**
 * Synchronisation du système de design (direction de design §3.1) — outil de développement.
 *
 *   npm run ds:synchro                         → web/bz/tokens.css et web/bz/bz.css depuis design/ (copie versionnée)
 *   npm run ds:synchro -- --source ../design   → recopie d'abord le dossier design partagé dans design/
 *   node scripts/ds-synchro.ts --verifier      → échoue si web/bz/ n'est plus à jour (utilisé par les tests)
 *
 * bz.css est le SEUL CSS servi au premier affichage : déclaration des couches, puis dist/tokens.min.css, polices.css,
 * base.css et composants.css, concaténés dans cet ordre.
 */
import { cpSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../', import.meta.url));
const chemin = (...p: string[]) => resolve(RACINE, ...p);
export const COUCHES = '@layer bz.jetons, bz.base, bz.composants, bz.utilitaires;';
const MORCEAUX = ['polices.css', 'base.css', 'composants.css'] as const;

/** Contenu attendu de web/bz/bz.css. */
export function bzCssAttendu(): string {
  const manifeste = JSON.parse(readFileSync(chemin('design/dist/MANIFESTE.json'), 'utf8')) as { version: string };
  const parties = [
    `/*! Breizhcosystem — bz.css v${manifeste.version} : assemblé par scripts/ds-synchro.ts (ne pas éditer) ; sources dans web/bz/ et design/ */`,
    COUCHES,
    readFileSync(chemin('design/dist/tokens.min.css'), 'utf8').trim(),
    ...MORCEAUX.map((f) => readFileSync(chemin('web/bz', f), 'utf8').trim()),
  ];
  return `${parties.join('\n')}\n`;
}

export function fichiersAttendus(): Record<string, string> {
  return {
    'web/bz/tokens.css': readFileSync(chemin('design/tokens.css'), 'utf8'),
    'web/bz/bz.css': bzCssAttendu(),
  };
}

function principal(): void {
  const args = process.argv.slice(2);
  const i = args.indexOf('--source');
  if (i >= 0) {
    const source = resolve(process.cwd(), args[i + 1] ?? '');
    for (const f of ['tokens.css', 'dist', 'outils', 'icones-maison']) {
      if (existsSync(resolve(source, f))) cpSync(resolve(source, f), chemin('design', f), { recursive: true });
    }
    console.log(`design/ recopié depuis ${source}`);
  }
  const attendus = fichiersAttendus();
  if (args.includes('--verifier')) {
    const ecarts = Object.entries(attendus).filter(([f, c]) => !existsSync(chemin(f)) || readFileSync(chemin(f), 'utf8') !== c).map(([f]) => f);
    if (ecarts.length) { console.error(`Pas à jour : ${ecarts.join(', ')} — lancez npm run ds:synchro`); process.exit(1); }
    console.log('web/bz/ est à jour.');
    return;
  }
  for (const [f, c] of Object.entries(attendus)) writeFileSync(chemin(f), c);
  console.log(`web/bz/tokens.css et web/bz/bz.css écrits (${Buffer.byteLength(attendus['web/bz/bz.css'] as string)} octets).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) principal();
