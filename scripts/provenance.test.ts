/**
 * Provenance des paquets publiés : jamais depuis une copie de travail modifiée ni un commit non étiqueté, sources
 * prises dans le commit lui-même, paquets d'essai jamais signés (constat chaine-logicielle-8).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembler, dossierSortie, lireArguments } from './paquets.ts';
import { controlerArbre, ecrireProvenance, exporterCommit, lireProvenance, verifierProvenance, type Provenance } from './provenance.ts';

const gitPresent = spawnSync('git', ['--version']).status === 0 && spawnSync('tar', ['--version']).status === 0;
const RACINE = fileURLToPath(new URL('../', import.meta.url));

/** Dépôt git jetable, sans la configuration de la machine (crochets, signature des commits…). */
function depot(): { dossier: string; git: (...a: string[]) => string } {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-provenance-'));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Essai', GIT_AUTHOR_EMAIL: 'essai@exemple.invalid', GIT_COMMITTER_NAME: 'Essai', GIT_COMMITTER_EMAIL: 'essai@exemple.invalid' };
  const git = (...a: string[]) => execFileSync('git', ['-C', dossier, ...a], { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q');
  writeFileSync(join(dossier, 'package.json'), '{"version":"1.2.3"}\n');
  mkdirSync(join(dossier, 'src'));
  writeFileSync(join(dossier, 'src', 'jeu.ts'), 'export const x = 1;\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'premier');
  return { dossier, git };
}

test('publication : refusée depuis une copie modifiée, un fichier non suivi ou un commit non étiqueté', { skip: !gitPresent && 'git ou tar absent' }, () => {
  const { dossier, git } = depot();
  try {
    assert.throws(() => controlerArbre(dossier, '1.2.3'), /n'est pas étiqueté v1\.2\.3[\s\S]*npm version patch/);
    git('tag', 'v1.2.2');
    assert.throws(() => controlerArbre(dossier, '1.2.3'), /v1\.2\.3/, 'une autre étiquette ne suffit pas');
    git('tag', '-a', '-m', 'version', 'v1.2.3');
    const commit = git('rev-parse', 'HEAD');
    assert.deepEqual(controlerArbre(dossier, '1.2.3'), { commit, etiquette: 'v1.2.3' });
    // fichier non suivi (essai local, fichier arrivé par la synchronisation d'un autre appareil)
    writeFileSync(join(dossier, 'src', 'essai-local.ts'), 'piège\n');
    assert.throws(() => controlerArbre(dossier, '1.2.3'), /Copie de travail modifiée[\s\S]*src\/essai-local\.ts[\s\S]*--essai/);
    rmSync(join(dossier, 'src', 'essai-local.ts'));
    // modification non commitée
    writeFileSync(join(dossier, 'src', 'jeu.ts'), 'export const x = 2;\n');
    assert.throws(() => controlerArbre(dossier, '1.2.3'), /Copie de travail modifiée \(1 fichier : src\/jeu\.ts\)/, 'chemin du fichier modifié donné en entier');
    git('checkout', '-q', '--', 'src/jeu.ts');
    assert.equal(controlerArbre(dossier, '1.2.3').commit, commit);
    assert.throws(() => controlerArbre(join(dossier, 'absent'), '1.2.3'), /dépôt git/);
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test('publication : sources prises dans le commit, rien de la copie de travail', { skip: !gitPresent && 'git ou tar absent' }, () => {
  const { dossier, git } = depot();
  const vers = mkdtempSync(join(tmpdir(), 'lb-export-'));
  try {
    const commit = git('rev-parse', 'HEAD');
    writeFileSync(join(dossier, 'src', 'jeu.ts'), 'export const x = "modifié sur le disque";\n');
    writeFileSync(join(dossier, 'src', 'non-suivi.ts'), 'piège\n');
    exporterCommit(dossier, commit, join(vers, 'source'));
    assert.equal(readFileSync(join(vers, 'source', 'src', 'jeu.ts'), 'utf8'), 'export const x = 1;\n', 'contenu commité');
    assert.equal(existsSync(join(vers, 'source', 'src', 'non-suivi.ts')), false, 'fichier non suivi absent');
    assert.equal(existsSync(join(vers, 'source', '.git')), false);
    assert.throws(() => exporterCommit(dossier, 'HEAD; rm -rf /', join(vers, 'x')), /Commit invalide/);
  } finally {
    rmSync(dossier, { recursive: true, force: true });
    rmSync(vers, { recursive: true, force: true });
  }
});

test('paquet : fichiers pris dans le dossier exporté (option racine), pas dans ce dépôt', () => {
  const faux = mkdtempSync(join(tmpdir(), 'lb-racine-'));
  const sortie = mkdtempSync(join(tmpdir(), 'lb-paquet-racine-'));
  try {
    for (const d of ['src', 'web', 'univers', 'node_modules']) symlinkSync(join(RACINE, d), join(faux, d));
    writeFileSync(join(faux, 'LICENCES-TIERS.md'), 'licences du commit exporté\n');
    writeFileSync(join(faux, 'LICENSE'), 'licence du commit exporté\n');
    writeFileSync(join(faux, 'NOTICE.md'), 'notice du commit exporté\n');
    mkdirSync(join(faux, 'deploiement'));
    writeFileSync(join(faux, 'deploiement', 'installer-jeu.sh'), '#!/usr/bin/env bash\n# installateur du commit exporté\n');
    const d = assembler('linux-x64', sortie, '9.9.9', null, { racine: faux });
    assert.equal(readFileSync(join(d, 'app', 'LICENCES-TIERS.md'), 'utf8'), 'licences du commit exporté\n');
    assert.equal(readFileSync(join(d, 'LICENSE'), 'utf8'), 'licence du commit exporté\n', 'texte de la licence du commit exporté');
    assert.equal(readFileSync(join(d, 'NOTICE.md'), 'utf8'), 'notice du commit exporté\n', 'notice du commit exporté');
    assert.match(readFileSync(join(d, 'installer-jeu.sh'), 'utf8'), /installateur du commit exporté/);
    assert.equal(existsSync(join(d, 'app', 'deploiement', 'signataires-editeur')), false, 'clé de l’éditeur prise dans l’export (absente ici)');
  } finally {
    rmSync(faux, { recursive: true, force: true });
    rmSync(sortie, { recursive: true, force: true });
  }
});

test('fabrication : --essai va dans dist/essai/, option inconnue refusée', () => {
  assert.equal(lireArguments(['linux-x64', '--essai'], {}).essai, true);
  assert.equal(lireArguments(['linux-x64'], {}).essai, false);
  assert.throws(() => lireArguments(['--esai'], {}), /Option inconnue/);
  assert.ok(dossierSortie(true).endsWith(`${sep}dist${sep}essai`));
  assert.ok(dossierSortie(false).endsWith(`${sep}dist`));
});

test('signature : seuls des paquets de publication, de la même version et du même commit', () => {
  const commit = 'a'.repeat(40);
  const p: Provenance = { version: '1.2.3', commit, etiquette: 'v1.2.3', verrou: 'b'.repeat(64), fabrication: 'publication' };
  const texte = ecrireProvenance(p);
  assert.deepEqual(lireProvenance(texte), p);
  assert.deepEqual(verifierProvenance(texte, '1.2.3', commit), p);
  assert.throws(() => verifierProvenance(null, '1.2.3', commit), /PROVENANCE\.txt absent/);
  const essai = ecrireProvenance({ ...p, etiquette: '-', fabrication: 'essai' });
  assert.match(essai, /ESSAI : ne jamais publier/);
  assert.throws(() => verifierProvenance(essai, '1.2.3', commit), /ESSAI/);
  assert.throws(() => verifierProvenance(texte, '1.2.4', commit), /pas de 1\.2\.4/);
  assert.throws(() => verifierProvenance(texte, '1.2.3', 'c'.repeat(40)), /pas depuis cccccccccccc/);
  assert.throws(() => verifierProvenance(ecrireProvenance({ ...p, verrou: '' }), '1.2.3', commit), /illisible|verrou/);
  assert.throws(() => verifierProvenance('n’importe quoi', '1.2.3', commit), /illisible/);
});
