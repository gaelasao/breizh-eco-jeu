/**
 * Conservation des sauvegardes sur la machine (constats jeu-connecteurs-5, jeu-installation-5, rgpd-4) : 30 copies
 * quotidiennes, et les copies ponctuelles (avant une restauration…) effacées après 30 jours, jamais gardées sans limite.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONSERVATION_JOURS, Stockage } from './stockage.ts';

test('sauvegardes locales : copies ponctuelles de plus de 30 jours effacées, les récentes et les quotidiennes gardées', () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-conservation-'));
  try {
    assert.equal(CONSERVATION_JOURS, 30);
    const s = new Stockage(d);
    s.planifier(() => ({ version: 1, n: 1 }));
    s.ecrireMaintenant(); // premier état sur le disque
    const dossier = join(d, 'sauvegardes');
    mkdirSync(dossier, { recursive: true });
    const vieille = join(dossier, 'avant-restauration-2026-09-01t10-00-00-000z.json');
    const recente = join(dossier, 'avant-restauration-2026-11-01t10-00-00-000z.json');
    writeFileSync(vieille, '{}');
    writeFileSync(recente, '{}');
    const il = (jours: number) => new Date(Date.now() - jours * 86_400_000);
    utimesSync(vieille, il(31), il(31));
    utimesSync(recente, il(5), il(5));
    s.planifier(() => ({ version: 1, n: 2 }));
    s.ecrireMaintenant(); // première écriture du jour : copie du jour et purge
    assert.equal(existsSync(vieille), false, 'copie avant restauration de plus de 30 jours effacée');
    assert.equal(existsSync(recente), true);
    assert.ok(s.listerSauvegardes().some((x) => x.nom.startsWith('monde-')), 'copie du jour faite');
  } finally { rmSync(d, { recursive: true, force: true }); }
});
