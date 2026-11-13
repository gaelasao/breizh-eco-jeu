import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ajouterSignature, blocVerification, ESPACE_INSTALLATEUR, ESPACE_PAQUET, INSTALLATEUR, inscrirePublication, lireRegistre, lireSignataires, preparerInstallateur, REGISTRE, verifierCommeLeServeur, verifierSommes,
} from './signer-publication.ts';

const outils = spawnSync('ssh-keygen', ['-?'], { stdio: 'ignore' }).error === undefined && spawnSync('bash', ['-c', 'true']).status === 0;
const modele = readFileSync(INSTALLATEUR, 'utf8');
const SHA = 'a'.repeat(64);

/** Clé jetable créée à l'exécution (aucun secret dans le dépôt). */
function cleJetable(d: string, nom: string) {
  const f = join(d, nom);
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'essai', '-f', f], { stdio: 'ignore' });
  const pub = readFileSync(`${f}.pub`, 'utf8').trim().split(/\s+/).slice(0, 2).join(' ');
  return { prive: f, ligne: `editeur-living-business namespaces="${ESPACE_INSTALLATEUR},${ESPACE_PAQUET}" ${pub}` };
}
const signer = (cle: string, espace: string, texte: string) => execFileSync('ssh-keygen', ['-Y', 'sign', '-f', cle, '-n', espace], { input: texte, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
const bash = (script: string, args: string[] = [], env: NodeJS.ProcessEnv = {}) => spawnSync('bash', ['-c', script, '_', ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
/** Version asynchrone : le serveur HTTP de l'essai tourne dans ce processus (spawnSync le bloquerait). */
const bashAsync = (script: string, args: string[] = []) => new Promise<{ status: number; stderr: string }>((ok) => {
  execFile('bash', ['-c', script, '_', ...args], { encoding: 'utf8', timeout: 60_000 }, (e, _out, stderr) => ok({ status: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stderr }));
});

test('installateur : plus aucune empreinte prise sur Breizhcosystem ni script exécuté sans vérification', () => {
  assert.doesNotMatch(modele, /\/v0\/telechargements/, 'la liste de Breizhcosystem ne décide plus du paquet');
  assert.doesNotMatch(modele, /exec bash \/tmp\/installer-jeu\.sh/, 'plus de script téléchargé exécuté tel quel');
  // jeu-installation-9 : plus aucun chemin fixe et prévisible dans /tmp (un autre compte pouvait y créer le fichier)
  assert.doesNotMatch(modele, /\/tmp\//, 'aucun chemin fixe dans /tmp');
  assert.match(modele, /travail="\$\(mktemp -d\)"\n  if ! curl [^\n]*-o "\$travail\/recu\.sh"/, 'téléchargement dans un dossier mktemp (0700, root)');
  assert.match(modele, /NOM="\$PUBLIE_PAQUET" SHA="\$PUBLIE_SHA256" VERSION="\$PUBLIE_VERSION"/);
  assert.match(modele, /declare -f verifier_script_signe lancer_publication_signee/, 'la mise à jour embarque la même vérification');
});

test('préparation : marqueurs remplis ligne à ligne, plus rien que Breizhcosystem puisse réécrire', () => {
  const ligne = 'editeur-living-business namespaces="living-business-installateur" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEssaiEssaiEssaiEssaiEssaiEssaiEssaiEssai';
  const t = preparerInstallateur(modele, { nexus: 'https://reseau.example/', version: '1.2.3', paquet: 'living-business-1.2.3-linux-x64.zip', sha256: SHA, signataires: [ligne] });
  assert.match(t, /^PUBLIE_VERSION='1\.2\.3'$/m);
  assert.match(t, /^PUBLIE_PAQUET='living-business-1\.2\.3-linux-x64\.zip'$/m);
  assert.match(t, new RegExp(`^PUBLIE_SHA256='${SHA}'$`, 'm'));
  assert.ok(t.includes(`SIGNATAIRES='${ligne}'`));
  assert.ok(t.includes('NEXUS="${LB_NEXUS:-https://reseau.example}"'));
  // Breizhcosystem remplace __NEXUS_ORIGINE__ en servant le script : sans marqueur, le fichier servi est celui signé
  assert.equal(t.replaceAll('__NEXUS_ORIGINE__', 'https://autre.exemple'), t);
  const base = { nexus: 'https://reseau.example', version: '1.2.3', paquet: 'living-business-1.2.3-linux-x64.zip', sha256: SHA, signataires: [ligne] };
  assert.throws(() => preparerInstallateur(modele, { ...base, version: '../../hors-de-opt' }), /Version invalide/);
  assert.throws(() => preparerInstallateur(modele, { ...base, paquet: 'living-business-9.9.9-linux-x64.zip' }), /Paquet Linux attendu/);
  assert.throws(() => preparerInstallateur(modele, { ...base, signataires: [] }), /Aucune clé/);
  assert.throws(() => preparerInstallateur(modele, { ...base, nexus: 'http://reseau.example' }), /https/);
  assert.throws(() => preparerInstallateur(t, base), /introuvable|déjà signé/, 'un script déjà rempli ne se remplit pas deux fois');
  assert.throws(() => lireSignataires('editeur-living-business namespaces="autre" ssh-ed25519 AAAA'), /espace de noms/);
  assert.throws(() => lireSignataires('pirate ssh-ed25519 AAAA'), /invalide/);
  assert.doesNotThrow(() => lireSignataires(readFileSync(join(import.meta.dirname, '..', 'deploiement', 'signataires-editeur'), 'utf8')), 'fichier des signataires du dépôt bien formé');
});

test('contrôles du serveur : version et nom accordés, pas de retour en arrière', { skip: !outils && 'bash absent' }, () => {
  const bloc = blocVerification();
  const ok = (appel: string) => bash(`${bloc}\n${appel}`).status === 0;
  assert.ok(ok(`publication_valide 1.2.3 living-business-1.2.3-linux-x64.zip ${SHA}`));
  assert.ok(!ok(`publication_valide ../../hors-de-opt living-business-0.1.0-linux-x64.zip ${SHA}`), 'traversée de dossier refusée');
  assert.ok(!ok(`publication_valide 1.2.3 living-business-1.2.4-linux-x64.zip ${SHA}`), 'version et nom doivent concorder');
  assert.ok(!ok('publication_valide 1.2.3 living-business-1.2.3-linux-x64.zip abc'));
  assert.ok(ok('version_inferieure 0.9.9 0.10.0'));
  assert.ok(ok('version_inferieure 1.2.3 1.10.0'));
  assert.ok(!ok('version_inferieure 1.2.3 1.2.3'));
  assert.ok(!ok('version_inferieure 2.0.0 1.99.99'));
});

test('signature : seul le script signé par la clé de l’éditeur passe, tel quel', { skip: !outils && 'ssh-keygen ou bash absent' }, () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-sig-'));
  try {
    const editeur = cleJetable(d, 'editeur');
    const pirate = cleJetable(d, 'pirate');
    const t = preparerInstallateur(modele, { nexus: 'https://reseau.example', version: '1.2.3', paquet: 'living-business-1.2.3-linux-x64.zip', sha256: SHA, signataires: [editeur.ligne] });
    const signe = ajouterSignature(t, signer(editeur.prive, ESPACE_INSTALLATEUR, t));
    assert.equal(verifierCommeLeServeur(signe, [editeur.ligne]), true, 'publication de l’éditeur acceptée');
    // un octet changé (empreinte du paquet remplacée par celle d'un paquet piégé) : refusé
    const piege = signe.replace(`PUBLIE_SHA256='${SHA}'`, `PUBLIE_SHA256='${'b'.repeat(64)}'`);
    assert.notEqual(piege, signe);
    assert.equal(verifierCommeLeServeur(piege, [editeur.ligne]), false, 'script modifié refusé');
    assert.equal(verifierCommeLeServeur(ajouterSignature(t, signer(pirate.prive, ESPACE_INSTALLATEUR, t)), [editeur.ligne]), false, 'autre clé refusée');
    assert.equal(verifierCommeLeServeur(ajouterSignature(t, signer(editeur.prive, ESPACE_PAQUET, t)), [editeur.ligne]), false, 'signature d’un autre usage refusée');
    assert.equal(verifierCommeLeServeur(t, [editeur.ligne]), false, 'script sans signature refusé');
    assert.equal(verifierCommeLeServeur(modele, [editeur.ligne]), false, 'modèle du dépôt refusé');
    assert.equal(verifierCommeLeServeur(signe, ['# aucune clé']), false, 'sans clé enregistrée : refusé');
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('mise à jour (living-business-mise-a-jour) : script de Breizhcosystem exécuté seulement si sa signature se vérifie', { skip: !outils && 'ssh-keygen ou bash absent' }, async () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-maj-'));
  let servi = '';
  const srv = createServer((req, res) => {
    if (req.url === '/installer-jeu.sh') { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(servi); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  try {
    const nexus = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const editeur = cleJetable(d, 'editeur');
    writeFileSync(join(d, 'signataires'), `${editeur.ligne}\n`);
    // génère living-business-mise-a-jour avec le code même de l'installateur (bloc de génération extrait tel quel)
    const debut = modele.indexOf('{\n  echo \'#!/usr/bin/env bash\'');
    const fin = modele.indexOf('} > /usr/local/bin/living-business-mise-a-jour.nouveau');
    assert.ok(debut > 0 && fin > debut, 'génération de la mise à jour trouvée');
    const generation = `${blocVerification()}\nPROTO=(--proto '=http')\n${modele.slice(debut, fin)}} > "$1"`;
    const g = bash(generation, [join(d, 'maj.sh')], { NEXUS: nexus, DOMAINE: 'jeu.exemple.fr', CONF: d });
    assert.equal(g.status, 0, g.stderr);
    const maj = readFileSync(join(d, 'maj.sh'), 'utf8');
    assert.doesNotMatch(maj, /exec bash/);
    const marque = join(d, 'execute');
    const charge = `#!/usr/bin/env bash\necho "$1" > ${JSON.stringify(marque)}\n`;
    const signe = ajouterSignature(charge, signer(editeur.prive, ESPACE_INSTALLATEUR, charge));

    servi = signe.replace('echo "$1"', 'echo "piégé $1"');
    assert.notEqual((await bashAsync('bash "$1"', [join(d, 'maj.sh')])).status, 0, 'script modifié : la mise à jour échoue');
    assert.equal(existsSync(marque), false, 'rien n’a été exécuté');

    servi = charge;
    assert.notEqual((await bashAsync('bash "$1"', [join(d, 'maj.sh')])).status, 0, 'script sans signature : refusé');
    assert.equal(existsSync(marque), false);

    servi = signe;
    const r = await bashAsync('bash "$1"', [join(d, 'maj.sh')]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readFileSync(marque, 'utf8').trim(), 'jeu.exemple.fr', 'publication signée exécutée avec le domaine');
  } finally {
    srv.close();
    rmSync(d, { recursive: true, force: true });
  }
});

test('empreintes des paquets : recalculées, toutes de la version, Linux obligatoire', () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-sommes-'));
  try {
    const sha = (s: string) => execFileSync('node', ['-e', `process.stdout.write(require('node:crypto').createHash('sha256').update(${JSON.stringify(s)}).digest('hex'))`], { encoding: 'utf8' });
    writeFileSync(join(d, 'living-business-1.2.3-linux-x64.zip'), 'linux');
    writeFileSync(join(d, 'living-business-1.2.3-win-x64.zip'), 'windows');
    writeFileSync(join(d, 'SHA256SUMS.txt'), `${sha('linux')}  living-business-1.2.3-linux-x64.zip\n${sha('windows')}  living-business-1.2.3-win-x64.zip\n`);
    assert.equal(verifierSommes(d, '1.2.3').length, 2);
    assert.throws(() => verifierSommes(d, '1.2.4'), /pas de la version/);
    writeFileSync(join(d, 'living-business-1.2.3-win-x64.zip'), 'windows piégé');
    assert.throws(() => verifierSommes(d, '1.2.3'), /Empreinte différente/);
    writeFileSync(join(d, 'SHA256SUMS.txt'), `${sha('windows piégé')}  living-business-1.2.3-win-x64.zip\n`);
    assert.throws(() => verifierSommes(d, '1.2.3'), /Linux/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('jeu : seules des lignes de clé bien formées sont proposées à la vérification', async () => {
  const { signatairesEditeur } = await import('../src/passerelle/signataires.ts');
  const d = mkdtempSync(join(tmpdir(), 'lb-signataires-'));
  try {
    const bonne = 'editeur-living-business namespaces="living-business-installateur" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEssai';
    writeFileSync(join(d, 's'), `# commentaire\n${bonne}\nediteur-living-business namespaces="x" ssh-ed25519 AAAA'; rm -rf /\n`);
    assert.deepEqual(signatairesEditeur(join(d, 's')), [bonne]);
    assert.deepEqual(signatairesEditeur(join(d, 'absent')), []);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test('registre des publications : un numéro = un seul paquet, numéros croissants', () => {
  const A = 'a'.repeat(64);
  const B = 'b'.repeat(64);
  let r = inscrirePublication('# entête\n', '0.1.0', A, '2026-11-09');
  assert.equal(r, `# entête\n0.1.0 ${A} 2026-11-09\n`);
  assert.equal(inscrirePublication(r, '0.1.0', A, '2026-11-12'), r, 'même paquet signé de nouveau : permis, registre inchangé');
  assert.throws(() => inscrirePublication(r, '0.1.0', B, '2026-11-12'), /déjà été publiée avec un autre paquet/, 'correctif sous le même numéro : refusé');
  r = inscrirePublication(r, '0.1.1', B, '2026-11-12');
  assert.throws(() => inscrirePublication(r, '0.0.9', 'c'.repeat(64), '2026-11-12'), /plus ancienne/);
  assert.throws(() => lireRegistre('0.1.0 pas-une-empreinte 2026-11-09'), /invalide/);
  assert.doesNotThrow(() => lireRegistre(readFileSync(REGISTRE, 'utf8')), 'registre du dépôt bien formé');
  const versions = lireRegistre(readFileSync(REGISTRE, 'utf8')).map((e) => e.version);
  assert.equal(new Set(versions).size, versions.length, 'aucun numéro en double dans le registre du dépôt');
});
