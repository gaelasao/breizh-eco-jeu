/**
 * Chaîne de fabrication (GitHub Actions) : une étiquette d'action déplacée (v4, v2…) ou un script d'installation npm
 * ne doit pas pouvoir modifier les paquets avant leur publication.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOSSIER = fileURLToPath(new URL('../.github/workflows/', import.meta.url));
const flux = readdirSync(DOSSIER).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ nom: f, texte: readFileSync(join(DOSSIER, f), 'utf8') }));

/** Jobs d'un workflow : nom → lignes (indentation de 2 espaces sous « jobs: »). */
function jobs(texte: string): Map<string, string> {
  const sortie = new Map<string, string>();
  const corps = texte.slice(texte.indexOf('\njobs:\n') + 7);
  let nom = '';
  for (const ligne of corps.split('\n')) {
    const m = /^ {2}([a-z0-9_-]+):\s*$/.exec(ligne);
    if (m) { nom = m[1] as string; sortie.set(nom, ''); continue; }
    if (nom) sortie.set(nom, `${sortie.get(nom)}${ligne}\n`);
  }
  return sortie;
}

test('CI : chaque action est épinglée par empreinte de commit complète (pas par étiquette mobile)', () => {
  assert.ok(flux.length >= 3, 'workflows lus');
  for (const { nom, texte } of flux) {
    for (const m of texte.matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)(.*)$/gm)) {
      assert.match(m[1] as string, /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.\/-]+@[0-9a-f]{40}$/, `${nom} : ${m[1]} doit être épinglée par SHA`);
      assert.match(m[2] as string, /^\s+# v\d+\.\d+\.\d+$/, `${nom} : ${m[1]} garde la version en commentaire (Dependabot)`);
    }
  }
});

test('CI : npm ci sans scripts d’installation ; seule la publication écrit, sans lancer de code du dépôt', () => {
  for (const { nom, texte } of flux) {
    for (const m of texte.matchAll(/\bnpm ci\b[^\n]*/g)) assert.match(m[0], /--ignore-scripts/, `${nom} : ${m[0]}`);
  }
  const paquets = flux.find((f) => f.nom === 'paquets.yml');
  assert.ok(paquets, 'paquets.yml');
  assert.match(paquets.texte, /^permissions:\n {2}contents: read$/m, 'droits par défaut : lecture');
  const j = jobs(paquets.texte);
  const ecrivains = [...j].filter(([, corps]) => /contents:\s*write/.test(corps));
  assert.equal(ecrivains.length, 1, 'un seul job avec contents: write');
  const [nomPub, pub] = ecrivains[0]!;
  assert.match(pub, /needs:\s*\S+/, 'publication après la fabrication');
  assert.doesNotMatch(pub, /actions\/checkout|setup-node|npm |node scripts|run: node/, `${nomPub} : aucun code du dépôt ni de npm lancé avec le droit d’écrire`);
  assert.match(pub, /gh release create/);
  for (const [n, corps] of j) {
    if (n === nomPub) continue;
    if (/node scripts\/paquets\.ts/.test(corps)) assert.match(corps, /contents:\s*read/, `${n} : la fabrication n’a que la lecture`);
  }
});

test('CI sur un dépôt public : une demande de fusion venue d’un fork n’obtient ni secret ni droit d’écriture', () => {
  for (const { nom, texte } of flux) {
    // ces déclencheurs donneraient au code d'un fork les secrets et les droits du dépôt
    assert.doesNotMatch(texte, /pull_request_target|workflow_run|issue_comment/, `${nom} : déclencheur à risque`);
    // droits par défaut du jeton : lecture seule, déclarés dans chaque workflow
    assert.match(texte, /^permissions:\n {2}contents: read$/m, `${nom} : droits par défaut en lecture seule`);
    // aucun secret du dépôt : seulement le jeton automatique de l'exécution
    for (const m of texte.matchAll(/secrets\.([A-Za-z0-9_]+)/g)) assert.equal(m[1], 'GITHUB_TOKEN', `${nom} : secret ${m[1]}`);
    // rien de ce qu'écrit l'auteur d'une demande (titre, texte, nom de branche) n'est inséré dans une commande
    assert.doesNotMatch(texte, /\$\{\{[^}]*github\.(event\.|head_ref)/, `${nom} : pas de valeur de l’événement dans une commande`);
    // un workflow lancé sur les demandes de fusion n'a aucun droit d'écriture, dans aucun job
    if (/^ {2}pull_request:/m.test(texte)) assert.doesNotMatch(texte, /:\s*write\b/, `${nom} : lancé sur les demandes de fusion, lecture seule`);
  }
  const ci = flux.find((f) => f.nom === 'ci.yml');
  assert.ok(ci, 'ci.yml');
  assert.match(ci.texte, /^on:\n {2}push:\n {2}pull_request:$/m, 'essais lancés sur les demandes de fusion');
  // seul paquets.yml écrit (publication d'une version), et jamais sur une demande de fusion : étiquette ou lancement à la main
  for (const { nom, texte } of flux) if (/:\s*write\b/.test(texte)) assert.equal(nom, 'paquets.yml', `${nom} : droit d’écriture`);
  assert.match(flux.find((f) => f.nom === 'paquets.yml')?.texte ?? '', /^on:\n {2}push:\n {4}tags: \['v\*'\]\n {2}workflow_dispatch:$/m);
  // gitleaks lit les commits de la demande (pull-requests: read, sans quoi il échoue sur chaque demande) et n'écrit rien
  const secrets = jobs(ci.texte).get('secrets') ?? '';
  assert.match(secrets, /permissions:\n {6}contents: read\n {6}pull-requests: read/, 'job secrets : lecture des commits de la demande');
  assert.match(secrets, /GITLEAKS_ENABLE_COMMENTS: false/, 'job secrets : aucun commentaire écrit');
  assert.match(secrets, /fetch-depth: 0/, 'tout l’historique est analysé');
  for (const { nom, texte } of flux) for (const m of texte.matchAll(/actions\/checkout@[^\n]*\n(?: {8}[^\n]*\n)*/g)) assert.match(m[0], /persist-credentials: false/, `${nom} : le jeton ne reste pas dans la copie de travail`);
});

const RACINE = fileURLToPath(new URL('../', import.meta.url));

/** Entrées « - package-ecosystem: … » de dependabot.yml : écosystème → texte de l'entrée. */
function entreesDependabot(texte: string): Map<string, string> {
  const sortie = new Map<string, string>();
  for (const morceau of texte.split(/^ {2}- (?=package-ecosystem:)/m).slice(1)) {
    const nom = /^package-ecosystem:\s*(\S+)/.exec(morceau)?.[1];
    if (nom) sortie.set(nom, morceau);
  }
  return sortie;
}

test('Dependabot : 7 jours de quarantaine avant de proposer une version (14 pour une majeure npm)', () => {
  const entrees = entreesDependabot(readFileSync(join(RACINE, '.github', 'dependabot.yml'), 'utf8'));
  assert.deepEqual([...entrees.keys()].sort(), ['github-actions', 'npm']);
  for (const [nom, corps] of entrees) {
    assert.match(corps, /^ {4}cooldown:\n/m, `${nom} : cooldown`);
    const jours = Number(/^ {6}default-days:\s*(\d+)\s*$/m.exec(corps)?.[1]);
    assert.ok(jours >= 7, `${nom} : default-days ≥ 7 (${jours})`);
  }
  const majeures = Number(/^ {6}semver-major-days:\s*(\d+)\s*$/m.exec(entrees.get('npm') ?? '')?.[1]);
  assert.ok(majeures >= 14, `npm : semver-major-days ≥ 14 (${majeures})`);
});

test('npm : aucun script d’installation, ni en CI ni à la main (.npmrc), et aucune dépendance qui en demande', () => {
  const npmrc = readFileSync(join(RACINE, '.npmrc'), 'utf8');
  assert.match(npmrc, /^ignore-scripts=true$/m);
  const verrou = JSON.parse(readFileSync(join(RACINE, 'package-lock.json'), 'utf8')) as { packages: Record<string, { hasInstallScript?: boolean }> };
  const avecScript = Object.entries(verrou.packages).filter(([, p]) => p.hasInstallScript).map(([n]) => n);
  assert.deepEqual(avecScript, [], 'une dépendance avec script d’installation ne marcherait pas avec ignore-scripts : à examiner avant de l’adopter');
  // les scripts du jeu lancés par npm run / npm test ne dépendent d'aucun script « pre » ou « post » (ignorés)
  const scripts = (JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')) as { scripts: Record<string, string> }).scripts;
  assert.deepEqual(Object.keys(scripts).filter((s) => /^(pre|post)/.test(s)), []);
});

test('CI : paquets d’essai hors tag, provenance contrôlée avant la publication de la version', () => {
  const texte = (nom: string) => flux.find((f) => f.nom === nom)?.texte ?? '';
  const installation = texte('installation-en-ligne.yml');
  for (const m of installation.matchAll(/node scripts\/(paquets|signer-publication)\.ts[^\n]*/g)) assert.match(m[0], /--essai/, `installation-en-ligne : ${m[0]}`);
  const paquets = texte('paquets.yml');
  assert.match(paquets, /if \[\[ "\$GITHUB_REF" == refs\/tags\/v\* \]\]; then node scripts\/paquets\.ts; else node scripts\/paquets\.ts --essai; fi/);
  const pub = jobs(paquets).get('publier') ?? '';
  assert.match(pub, /grep -qx 'fabrication publication' PROVENANCE\.txt/);
  assert.match(pub, /grep -qx "etiquette \$GITHUB_REF_NAME" PROVENANCE\.txt/);
  assert.match(pub, /gh release create [^\n]*dist\/PROVENANCE\.txt/);
});

test('CI : paquets fabriqués sur macOS (application Mac), contrôles et publication sur Ubuntu, CI et installation en ligne sur Ubuntu', () => {
  const texte = (nom: string) => flux.find((f) => f.nom === nom)?.texte ?? '';
  const paquets = jobs(texte('paquets.yml'));
  assert.match(paquets.get('fabriquer') ?? '', /^ {4}runs-on: macos-\d+$/m, 'osacompile, codesign et ditto');
  assert.match(paquets.get('fabriquer') ?? '', /test "\$\(zipinfo -1 "\$z" \| cut -d\/ -f1 \| sort -u\)" = "Living Business\.app"/, 'zip Mac : l’application seule');
  assert.match(paquets.get('fabriquer') ?? '', /codesign --verify --deep --strict "\$d\/Living Business\.app"/);
  assert.match(paquets.get('publier') ?? '', /^ {4}runs-on: ubuntu-/m);
  for (const f of ['ci.yml', 'installation-en-ligne.yml']) {
    for (const [n, corps] of jobs(texte(f))) assert.doesNotMatch(corps, /runs-on: macos/, `${f} › ${n} : reste sur Ubuntu`);
  }
});
