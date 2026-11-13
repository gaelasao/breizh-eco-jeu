/**
 * .env.example décrit exactement les variables que le code lit (constat coherence-7) : aucune variable fantôme
 * (l'ancien modèle proposait NEXUS_CLE_ORGANISATION, que rien ne lit, et invitait à ranger une clé en clair), et
 * aucune variable lue par le jeu qui n'y soit pas documentée.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
/** Variables du système ou posées par le jeu lui-même, pas des réglages de l'opérateur. */
const SYSTEME = new Set(['PATH', 'HOME', 'APPDATA', 'CREDENTIALS_DIRECTORY', 'LB_PAQUET', 'LB_APPLICATION_PID']);

function fichiers(dossier: string): string[] {
  return readdirSync(dossier, { withFileTypes: true }).flatMap((e) => {
    const f = join(dossier, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : fichiers(f);
    return /\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name) ? [f] : [];
  });
}

test('.env.example : toutes les variables lues par le code, et seulement elles', () => {
  const lues = new Set<string>();
  for (const f of [...fichiers(join(RACINE, 'src')), ...fichiers(join(RACINE, 'scripts'))]) {
    for (const m of readFileSync(f, 'utf8').matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) lues.add(m[1] as string);
  }
  for (const s of SYSTEME) lues.delete(s);
  const exemple = readFileSync(join(RACINE, '.env.example'), 'utf8');
  const documentees = new Set([...exemple.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1] as string));
  assert.deepEqual([...documentees].filter((v) => !lues.has(v)), [], 'variables du modèle que rien ne lit');
  assert.deepEqual([...lues].filter((v) => !documentees.has(v)).sort(), [], 'variables lues mais absentes du modèle');
  assert.ok(!/NEXUS_CLE|=\s*nx_|=\s*lb_[A-Za-z0-9]/.test(exemple), 'aucune clé à recopier dans un fichier');
});
