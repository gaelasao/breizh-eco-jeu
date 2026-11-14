import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adresseNexus, nexusDuPaquet } from '../src/passerelle/bureau.ts';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { CODE_SOURCE } from '../src/passerelle/licence.ts';
import { ETIQUETTE } from '../src/passerelle/demarrage.ts';
import { APPLICATION_MAC, assembler, CIBLES, compresser, infoPlist, lireArguments, macosMinimum, notice, racinePaquet, sbomDependances, sbomPaquet } from './paquets.ts';

const surMac = process.platform === 'darwin';

/** Liste récursive des fichiers d'un dossier. */
function fichiers(d: string, base = d): string[] {
  return readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? fichiers(join(d, e.name), base) : [join(d, e.name).slice(base.length + 1)]));
}

test('paquet : lanceurs double-clic, notice, fichiers d’exécution seulement (ni tests, ni données)', () => {
  const sortie = mkdtempSync(join(tmpdir(), 'lb-paquet-'));
  try {
    for (const c of CIBLES) {
      const d = racinePaquet(c, assembler(c, sortie, '9.9.9', null));
      const liste = fichiers(d);
      assert.ok(!liste.some((f) => f.endsWith('.test.ts')), 'aucun test dans le paquet');
      assert.ok(!liste.some((f) => /(^|[/\\])donnees[/\\]|monde\.json$|cle-secrets$/.test(f)), 'aucune donnée dans le paquet');
      assert.ok(liste.includes(join('app', 'src', 'lanceur.ts')));
      assert.ok(liste.includes(join('app', 'node_modules', 'three', 'build', 'three.module.js')));
      assert.ok(liste.includes(join('app', 'node_modules', '@leeoniya', 'ufuzzy', 'dist', 'uFuzzy.mjs')), 'bibliothèques du système de design');
      assert.ok(liste.includes(join('app', 'web', 'polices', 'inter-fr-4.1.woff2')), 'polices Breizhcosystem');
      assert.ok(liste.includes(join('app', 'LICENCES-TIERS.md')), 'attributions');
      assert.ok(!liste.some((f) => f.includes('fontsource')), 'plus d’Inter Fontsource ni de Barlow');
      assert.equal(JSON.parse(readFileSync(join(d, 'app', 'package.json'), 'utf8')).type, 'module');
      const notice = readFileSync(join(d, 'LISEZMOI.txt'), 'utf8');
      assert.match(notice, c.startsWith('darwin') ? /INSTALLER \(rien d’autre à installer\)/ : /RIEN À INSTALLER/);
      if (c.startsWith('darwin')) {
        // une application : ni lanceur .command, ni installateur de serveur, ni Node.js hors de Contents/MacOS
        assert.deepEqual(readdirSync(join(d, '..', '..', '..')), [APPLICATION_MAC], 'le paquet Mac ne contient que l’application');
        assert.ok(!liste.some((f) => /\.command$|installer-jeu\.sh$/.test(f)), 'ni .command ni installer-jeu.sh');
        assert.ok(existsSync(join(d, 'living-business.icns')), 'icône');
        assert.match(notice, /~\/Bibliothèque\/Application Support\/Living Business/);
      } else if (c.startsWith('win')) {
        const cmd = readFileSync(join(d, 'Living Business.cmd'), 'utf8');
        assert.match(cmd, /\r\n/, 'fins de ligne Windows');
        assert.match(cmd, /node\.exe" --disable-warning=ExperimentalWarning src\\lanceur\.ts %\*/);
        assert.match(readFileSync(join(d, 'Secours mot de passe.cmd'), 'utf8'), /--secours/);
        assert.match(notice, /%APPDATA%\\Living Business/);
      } else {
        const f = 'living-business.sh';
        assert.equal(statSync(join(d, f)).mode & 0o111, 0o111, 'exécutable');
        assert.match(readFileSync(join(d, f), 'utf8'), /^#!\/bin\/sh\n[\s\S]*exec \.\/node /);
      }
      // aucun fichier inutile : moins de 25 Mo hors Node.js
      const taille = liste.reduce((t, f) => t + statSync(join(d, f)).size, 0);
      assert.ok(taille < 25e6, `paquet trop gros : ${taille}`);
    }
  } finally { rmSync(sortie, { recursive: true, force: true }); }
});

test('paquet : adresse de Breizhcosystem préréglée (--nexus ou LB_NEXUS_URL à la fabrication), https seulement', () => {
  // ligne de commande : --nexus l'emporte sur LB_NEXUS_URL ; adresse réduite à l'origine ; vide = aucune
  assert.deepEqual(lireArguments(['darwin-arm64', '--nexus', 'https://Reseau.Example/chemin?x=1'], {}), { cibles: ['darwin-arm64'], nexus: 'https://reseau.example', essai: false });
  assert.deepEqual(lireArguments(['--nexus=https://reseau.example:8443'], {}), { cibles: [...CIBLES], nexus: 'https://reseau.example:8443', essai: false });
  assert.equal(lireArguments([], { LB_NEXUS_URL: 'https://reseau-env.example' }).nexus, 'https://reseau-env.example');
  assert.equal(lireArguments(['--nexus', 'https://reseau-cli.example'], { LB_NEXUS_URL: 'https://reseau-env.example' }).nexus, 'https://reseau-cli.example');
  assert.equal(lireArguments(['win-x64'], { LB_NEXUS_URL: '' }).nexus, null);
  for (const mauvais of ['http://reseau.example', 'https://moi:secret@reseau.example', 'reseau.example', 'https://localhost', 'https://[::1]', 'ftp://reseau.example', '']) {
    assert.throws(() => lireArguments(['--nexus', mauvais], {}), /https:\/\/… attendue/, mauvais);
  }
  assert.throws(() => lireArguments(['--nexus'], {}), /https:\/\/… attendue/);
  assert.throws(() => lireArguments(['amiga-68k'], {}), /Cible inconnue/);
  assert.equal(adresseNexus('https://reseau.example/"; rm -rf ~'), 'https://reseau.example', 'chemin écarté : rien d’autre que l’origine');
  // dans le paquet : app/package.json (lu par le lanceur à chaque démarrage) et la notice
  const sortie = mkdtempSync(join(tmpdir(), 'lb-paquet-nexus-'));
  try {
    const d = assembler('win-x64', sortie, '9.9.9', null, { nexus: 'https://reseau.example' });
    assert.equal(JSON.parse(readFileSync(join(d, 'app', 'package.json'), 'utf8')).nexus, 'https://reseau.example');
    assert.equal(nexusDuPaquet(join(d, 'app', 'package.json')), 'https://reseau.example');
    assert.match(readFileSync(join(d, 'LISEZMOI.txt'), 'utf8'), /RÉSEAU Breizhcosystem[\s\S]*https:\/\/reseau\.example/);
    const sans = assembler('linux-x64', sortie, '9.9.9', null);
    assert.equal(JSON.parse(readFileSync(join(sans, 'app', 'package.json'), 'utf8')).nexus, undefined);
    assert.equal(nexusDuPaquet(join(sans, 'app', 'package.json')), null);
    // sans adresse préréglée : pas de partie « réseau » ni d'adresse (la page de téléchargement reste nommée)
    assert.doesNotMatch(readFileSync(join(sans, 'LISEZMOI.txt'), 'utf8').replaceAll(CODE_SOURCE, ''), /RÉSEAU Breizhcosystem|Adresse préréglée|https:\/\//, 'seule adresse : celle du code source');
    assert.throws(() => assembler('linux-x64', sortie, '9.9.9', null, { nexus: 'http://reseau.example' }), /invalide/);
  } finally { rmSync(sortie, { recursive: true, force: true }); }
});

/** Lance le lanceur du paquet avec le Node.js courant ; résout avec la sortie quand `attendu` apparaît. */
function lancerLanceur(app: string, env: NodeJS.ProcessEnv, args: string[], attendu: RegExp): Promise<{ p: ChildProcess; sortie: string }> {
  return new Promise((ok, ko) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/lanceur.ts', ...args], { cwd: app, env: { ...process.env, ...env } });
    let sortie = '';
    const t = setTimeout(() => { p.kill(); ko(new Error(`délai dépassé : ${sortie}`)); }, 15_000);
    const lire = (b: Buffer) => { sortie += b.toString(); if (attendu.test(sortie)) { clearTimeout(t); ok({ p, sortie }); } };
    p.stdout.on('data', lire);
    p.stderr.on('data', lire);
    p.on('exit', () => { if (attendu.test(sortie)) return; clearTimeout(t); ko(new Error(`arrêt inattendu : ${sortie}`)); });
  });
}

/** Lance le lanceur jusqu'à ce qu'il se termine ; renvoie toute sa sortie. */
function executerLanceur(app: string, env: NodeJS.ProcessEnv, args: string[]): Promise<{ code: number | null; sortie: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/lanceur.ts', ...args], { cwd: app, env: { ...process.env, ...env } });
    let sortie = '';
    p.stdout.on('data', (b: Buffer) => (sortie += b.toString()));
    p.stderr.on('data', (b: Buffer) => (sortie += b.toString()));
    const t = setTimeout(() => p.kill(), 15_000);
    p.on('exit', (code) => { clearTimeout(t); ok({ code, sortie }); });
  });
}

test('lanceur du paquet : démarre, une seule instance (2e double-clic = rouvrir), secours, arrêt propre', async () => {
  const sortie = mkdtempSync(join(tmpdir(), 'lb-lanceur-'));
  const donnees = join(sortie, 'donnees');
  try {
    const d = assembler('linux-x64', sortie, '9.9.9', null, { nexus: 'https://reseau.example' });
    const env = { LB_DONNEES: donnees, LB_NAVIGATEUR: '0', LB_NEXUS_URL: '', PORT: String(41000 + Math.floor(Math.random() * 2000)) };
    const { p: premier, sortie: s1 } = await lancerLanceur(join(d, 'app'), env, [], /Laissez cette fenêtre ouverte/);
    try {
      const url = /(http:\/\/127\.0\.0\.1:\d+\/)/.exec(s1)?.[1] as string;
      assert.ok(url, s1);
      assert.match(s1, /Première fois : créez votre entreprise/);
      assert.match(s1, /Réseau Breizhcosystem \(facultatif\) : https:\/\/reseau\.example /, 'adresse de Breizhcosystem du paquet donnée au jeu');
      const session = await (await fetch(`${url}api/v1/session`)).json();
      assert.equal(session.installe, false);
      assert.equal(session.surPlace, true);
      assert.match(session.aideSecours, /Secours mot de passe/);
      assert.ok(existsSync(join(donnees, 'instance.json')));
      // 2e lancement : rouvre celui qui tourne, ne démarre pas un 2e serveur sur les mêmes données
      const r2 = await executerLanceur(join(d, 'app'), env, []);
      assert.equal(r2.code, 0);
      assert.match(r2.sortie, /déjà ouvert/);
      assert.ok(r2.sortie.includes(url), r2.sortie);
      // secours (mot de passe ET code perdus) : refusé tant que rien n'est installé
      const r3 = await executerLanceur(join(d, 'app'), env, ['--secours']);
      assert.ok(r3.sortie.includes(`${url}secours/`), r3.sortie);
      const lien = /(http:\/\/127\.0\.0\.1:\d+\/secours\/[A-Za-z0-9_-]{43})/.exec(r3.sortie)?.[1] as string;
      assert.ok(lien);
      const s = await fetch(`${url}api/v1/secours-local/${lien.split('/').pop()}`);
      assert.equal(s.status, 200, 'lien de secours valable sur l’instance qui tourne');
    } finally {
      // arrêt (fenêtre fermée) : état écrit, fichier d'instance retiré
      premier.kill('SIGTERM');
      await new Promise((ok) => premier.once('exit', ok));
    }
    assert.ok(existsSync(join(donnees, 'monde.json')));
    assert.ok(!existsSync(join(donnees, 'instance.json')));
  } finally { rmSync(sortie, { recursive: true, force: true }); }
});

test('paquet : script d’installation sur un serveur (installer-jeu.sh) inclus, adresse de Breizhcosystem préréglée si connue', (t) => {
  const source = new URL('../deploiement/installer-jeu.sh', import.meta.url);
  if (!existsSync(source)) { t.skip('deploiement/installer-jeu.sh absent'); return; }
  const sortie = mkdtempSync(join(tmpdir(), 'lb-paquet-installateur-'));
  try {
    // l'application Mac n'en a pas l'usage : le jeu donne la commande qui le télécharge, à lancer sur le serveur
    const mac = assembler('darwin-arm64', sortie, '9.9.9', null, { nexus: 'https://reseau.example', applet: false });
    assert.ok(!fichiers(mac).some((f) => f.endsWith('installer-jeu.sh')), 'pas d’installer-jeu.sh dans l’application Mac');
    assert.ok(existsSync(join(racinePaquet('darwin-arm64', mac), 'app', 'deploiement', 'signataires-editeur')), 'clé de l’éditeur fournie au jeu (Mettre en ligne)');
    const avec = assembler('linux-x64', sortie, '9.9.9', null, { nexus: 'https://reseau.example' });
    const script = readFileSync(join(avec, 'installer-jeu.sh'), 'utf8');
    assert.equal(statSync(join(avec, 'installer-jeu.sh')).mode & 0o111, 0o111, 'exécutable');
    assert.match(script, /^#!\/usr\/bin\/env bash/);
    assert.doesNotMatch(script, /__NEXUS_ORIGINE__/);
    assert.match(script, /https:\/\/reseau\.example/);
    assert.match(script, /^PUBLIE_VERSION='__PUBLIE_VERSION__'$/m, 'copie du paquet = modèle : il récupère la publication signée et la vérifie');
    assert.ok(existsSync(join(avec, 'app', 'deploiement', 'signataires-editeur')), 'clé de l’éditeur fournie au jeu (Mettre en ligne)');
    const sans = assembler('win-x64', sortie, '9.9.9', null);
    // la clé publique de l'éditeur, quand le dépôt en a une, est la seule chose inscrite dans la copie du paquet
    const brut = readFileSync(join(sans, 'installer-jeu.sh'), 'utf8');
    assert.match(brut, /__NEXUS_ORIGINE__/, 'sans adresse : aucune adresse préréglée');
    assert.equal(brut.replace(/^SIGNATAIRES='[^']*'$/m, "SIGNATAIRES='__SIGNATAIRES__'"), readFileSync(source, 'utf8'), 'sans adresse : tel quel, clé de l’éditeur mise à part');
  } finally { rmSync(sortie, { recursive: true, force: true }); }
});

test('notice : passer Gatekeeper ou SmartScreen seulement pour un paquet venu de Breizhcosystem, jamais en réflexe (jeu-installation-8)', () => {
  for (const c of ['darwin-arm64', 'win-x64'] as const) {
    const n = notice(c, '9.9.9', 'v24.0.0', 'https://reseau.example');
    const mac = c === 'darwin-arm64';
    const contournement = c === 'win-x64' ? 'Exécuter quand' : 'Ouvrir quand même';
    const avant = n.indexOf(mac ? 'AVANT : n’ouvrez cette application que si VOUS l’avez téléchargée' : 'AVANT : n’ouvrez ce dossier que si VOUS l’avez téléchargé');
    assert.ok(avant > 0, `${c} : mise en garde présente`);
    assert.ok(avant < n.indexOf(contournement), `${c} : la mise en garde vient avant le contournement`);
    assert.match(n, /https:\/\/reseau\.example\/telecharger/, `${c} : seule source donnée, la page de Breizhcosystem`);
    assert.match(n, /reçu par e-mail, par message ou en pièce jointe[\s\S]*se supprime/, `${c} : fichier reçu = à supprimer`);
    assert.match(n, mac ? /Seulement pour une application téléchargée comme ci-dessus/ : /Seulement pour un dossier téléchargé comme ci-dessus/, `${c} : contournement conditionné`);
    assert.match(n, /Jamais pour un autre fichier/);
    assert.match(n, mac ? /L’application n’est pas encore signée par Apple/ : /ne sont pas encore signés/, `${c} : l’absence de signature est dite, pas cachée`);
    // anciennes consignes, données sans condition
    assert.doesNotMatch(n, /Si « Windows a protégé votre ordinateur » s’affiche :/);
    assert.doesNotMatch(n, /ou clic droit sur le fichier → Ouvrir/);
    assert.match(n, /Un e-mail « nouvelle version » avec un lien ou une pièce jointe n’est pas une source sûre/);
  }
  // sans adresse préréglée : la page est nommée, aucune adresse inventée
  const sans = notice('darwin-x64', '9.9.9', 'v24.0.0', null);
  assert.match(sans, /page « Télécharger Living Business »\s+de Breizhcosystem, ou par le lien de Réglages → À propos/);
  assert.doesNotMatch(sans, /\/telecharger/);
  assert.doesNotMatch(notice('linux-x64', '9.9.9', 'v24.0.0', null), /quand même/, 'Linux : rien à contourner');
});

test('faille de sécurité : même canal de signalement dans LISEZMOI, « Licences et crédits » et SECURITY.md (chaine-logicielle-7)', () => {
  const plat = (t: string) => t.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ');
  for (const c of CIBLES) {
    const n = plat(notice(c, '9.9.9', 'v24.0.0', 'https://reseau.example'));
    assert.match(n, /SIGNALER UNE FAILLE DE SÉCURITÉ/, c);
    assert.match(n, /page « Mentions légales » de Breizhcosystem \(https:\/\/reseau\.example\/mentions-legales\), objet « Sécurité »/, `${c} : adresse de la page quand Breizhcosystem est préréglé`);
    assert.match(n, /sans rendre le problème public avant le correctif/);
  }
  const sans = plat(notice('linux-x64', '9.9.9', 'v24.0.0', null));
  assert.match(sans, /page « Mentions légales » de Breizhcosystem, objet « Sécurité »/, 'sans adresse préréglée : la page est nommée, aucune adresse inventée');
  const page = plat(readFileSync(new URL('../web/licences.html', import.meta.url), 'utf8'));
  assert.match(page, /<h2 id="t-securite"[^>]*>Signaler une faille de sécurité<\/h2>/);
  assert.match(page, /page « Mentions légales » de Breizhcosystem, avec « Sécurité » en objet/);
  const politique = plat(readFileSync(new URL('../SECURITY.md', import.meta.url), 'utf8'));
  assert.match(politique, /page « Mentions légales » de Breizhcosystem \(`<Breizhcosystem>\/mentions-legales`\), objet « Sécurité »/);
  assert.doesNotMatch(politique, /contacter le porteur du projet directement/, 'plus de canal sans adresse');
  assert.ok(existsSync(new URL('../docs/conformite/DIVULGATION-COORDONNEE.md', import.meta.url)), 'politique de divulgation coordonnée');
});

test('logiciel libre : LICENSE (texte officiel, tel quel) et NOTICE.md dans chaque paquet, à la racine et dans app/, nommés par LISEZMOI', () => {
  const racine = fileURLToPath(new URL('../', import.meta.url));
  const licence = readFileSync(join(racine, 'LICENSE'));
  assert.match(licence.toString('utf8'), /^\s+GNU AFFERO GENERAL PUBLIC LICENSE\n\s+Version 3, 19 November 2007\n/);
  const noticeFr = readFileSync(join(racine, 'NOTICE.md'), 'utf8');
  assert.match(noticeFr, /^# Living Business est un logiciel libre\n/);
  const sortie = mkdtempSync(join(tmpdir(), 'lb-paquet-licence-'));
  try {
    for (const c of CIBLES) {
      const d = racinePaquet(c, assembler(c, sortie, '9.9.9', null));
      // le texte officiel n'est jamais réécrit, même pour Windows : copie conforme, octet pour octet
      assert.ok(readFileSync(join(d, 'LICENSE')).equals(licence), `${c} : LICENSE à la racine du paquet, tel quel`);
      assert.ok(readFileSync(join(d, 'app', 'LICENSE')).equals(licence), `${c} : app/LICENSE, servi par la passerelle`);
      // la notice est lue avant le premier lancement : fins de ligne Windows pour win-x64, comme LISEZMOI.txt
      assert.equal(readFileSync(join(d, 'NOTICE.md'), 'utf8'), c.startsWith('win') ? noticeFr.replace(/\n/g, '\r\n') : noticeFr, `${c} : NOTICE.md à la racine du paquet`);
      assert.equal(readFileSync(join(d, 'app', 'NOTICE.md'), 'utf8'), noticeFr, `${c} : app/NOTICE.md, d’où la passerelle tire /licence.html`);
      assert.equal(existsSync(join(d, 'LICENCE.txt')) || existsSync(join(d, 'app', 'LICENCE.txt')), false, `${c} : plus d’ancienne licence d’utilisation`);
      assert.equal(JSON.parse(readFileSync(join(d, 'app', 'package.json'), 'utf8')).license, 'AGPL-3.0-only', `${c} : identifiant de la licence`);
      const brut = readFileSync(join(d, 'LISEZMOI.txt'), 'utf8');
      const n = brut.replace(/[\u00a0\u202f]/g, ' ').replace(/\s+/g, ' ');
      assert.match(n, /LOGICIEL LIBRE Living Business est un logiciel libre, sous licence GNU AGPL version 3 : vous pouvez l’utiliser, l’étudier, le modifier et le redistribuer aux conditions de cette licence\. Rien à accepter pour l’utiliser\. Il est fourni sans garantie, dans les limites de la loi\./, c);
      assert.match(n, c.startsWith('darwin')
        ? /Texte de la licence \(en anglais, seul à faire foi\) : LICENSE\. Résumé en français : NOTICE\.md\. Les deux sont dans l’application \(Living Business\.app\/Contents\/Resources\), et dans le jeu : Réglages → À propos\./
        : /Texte de la licence \(en anglais, seul à faire foi\) : LICENSE\. Résumé en français : NOTICE\.md\. Les deux sont dans ce dossier, et dans le jeu : Réglages → À propos\./, c);
      assert.ok(n.includes(`Code source complet (essais et scripts de fabrication compris) : ${CODE_SOURCE} `), `${c} : où trouver le code source`);
      // plus aucune restriction ni acceptation : la licence permet de redistribuer et ne demande rien pour utiliser
      assert.doesNotMatch(n, /Ne diffusez pas|vous l’acceptez|licence d’utilisation|LICENCE\.txt/i, c);
      for (const l of brut.split(/\r?\n/)) assert.ok(l.length <= 130 || l.startsWith('Inclus :'), `${c} : ligne de ${l.length} caractères`);
    }
  } finally { rmSync(sortie, { recursive: true, force: true }); }
  // un export de commit sans texte de licence, ou sans notice, ne donne pas de paquet
  const faux = mkdtempSync(join(tmpdir(), 'lb-racine-sans-licence-'));
  const sortie2 = mkdtempSync(join(tmpdir(), 'lb-paquet-sans-licence-'));
  try {
    for (const d of ['src', 'web', 'univers', 'node_modules']) symlinkSync(join(racine, d), join(faux, d));
    writeFileSync(join(faux, 'LICENCES-TIERS.md'), 'licences\n');
    mkdirSync(join(faux, 'deploiement'));
    assert.throws(() => assembler('linux-x64', sortie2, '9.9.9', null, { racine: faux }), /Texte de la licence absent : LICENSE/);
    writeFileSync(join(faux, 'LICENSE'), licence);
    assert.throws(() => assembler('linux-x64', sortie2, '9.9.9', null, { racine: faux }), /Notice de la licence absente : NOTICE\.md/);
    writeFileSync(join(faux, 'NOTICE.md'), noticeFr);
    assert.ok(existsSync(join(assembler('linux-x64', sortie2, '9.9.9', null, { racine: faux }), 'LICENSE')), 'les deux présents : paquet fabriqué');
  } finally {
    rmSync(faux, { recursive: true, force: true });
    rmSync(sortie2, { recursive: true, force: true });
  }
});

const npmPresent = spawnSync('npm', ['--version'], { encoding: 'utf8' }).status === 0;

test('nomenclature (SBOM) : dépendances d’exécution du verrou, Node.js et fichiers livrés avec leurs empreintes', { skip: !npmPresent && 'npm absent' }, () => {
  const racine = fileURLToPath(new URL('../', import.meta.url));
  const npmBom = sbomDependances(racine);
  const node = { binaire: '', licence: '', version: 'v24.22.2', archive: { url: 'https://nodejs.org/dist/v24.22.2/node-v24.22.2-linux-x64.tar.gz', sha256: 'a'.repeat(64) } };
  const bom = JSON.parse(sbomPaquet(npmBom, '9.9.9', 'linux-x64', node)) as {
    bomFormat: string; metadata: { component: { name: string; type: string; version: string; licenses?: { license: { id?: string; name?: string } }[]; externalReferences?: { type: string; url: string }[] } };
    components: { 'bom-ref': string; name: string; version: string; type: string; hashes?: { alg: string; content: string }[]; properties?: { name: string; value: string }[] }[];
    dependencies: { ref: string; dependsOn: string[] }[];
  };
  assert.equal(bom.bomFormat, 'CycloneDX');
  assert.deepEqual([bom.metadata.component.name, bom.metadata.component.type, bom.metadata.component.version], ['living-business', 'application', '9.9.9']);
  assert.deepEqual(bom.metadata.component.licenses, [{ license: { id: 'AGPL-3.0-only' } }], 'licence du produit : identifiant SPDX');
  assert.deepEqual(bom.metadata.component.externalReferences?.map((r) => [r.type, r.url]), [['vcs', CODE_SOURCE]], 'où trouver le code source');
  const noms = bom.components.map((c) => c.name);
  for (const d of ['three', 'camera-controls', 'uplot', '@leeoniya/ufuzzy', '@github/combobox-nav']) assert.ok(noms.includes(d), `dépendance d’exécution ${d}`);
  for (const d of ['typescript', 'lucide-static', '@types/node']) assert.ok(!noms.includes(d), `pas d’outil de développement (${d})`);
  const n = bom.components.find((c) => c.name === 'node');
  assert.equal(n?.version, '24.22.2');
  assert.deepEqual(n?.hashes, [{ alg: 'SHA-256', content: 'a'.repeat(64) }], 'archive officielle de Node.js et son empreinte');
  for (const f of ['Inter', 'Fraunces', 'Atkinson Hyperlegible Next', 'Lucide']) {
    const c = bom.components.find((x) => x.name === f);
    const chemin = c?.properties?.find((p) => p.name === 'living-business:fichier')?.value.replace(/^app\//, '') ?? '';
    assert.ok(chemin, `${f} : fichier livré nommé`);
    assert.equal(c?.hashes?.[0]?.content, createHash('sha256').update(readFileSync(join(racine, chemin))).digest('hex'), `${f} : empreinte du fichier livré`);
  }
  assert.equal(bom.components.find((c) => c.name === 'Lucide')?.version, '1.71.0');
  const racineDeps = bom.dependencies.find((d) => d.ref === 'living-business@9.9.9');
  assert.ok(racineDeps?.dependsOn.includes('node@24.22.2') && racineDeps.dependsOn.includes('three@0.187.0'), 'graphe des dépendances rattaché au produit');
  // écrite dans le paquet quand elle est fournie
  const sortie = mkdtempSync(join(tmpdir(), 'lb-paquet-sbom-'));
  try {
    const d = assembler('linux-x64', sortie, '9.9.9', null, { sbomNpm: npmBom });
    assert.equal((JSON.parse(readFileSync(join(d, 'app', 'SBOM.cdx.json'), 'utf8')) as { metadata: { component: { name: string } } }).metadata.component.name, 'living-business');
    assert.match(readFileSync(join(d, 'LISEZMOI.txt'), 'utf8'), /app\/SBOM\.cdx\.json/);
  } finally { rmSync(sortie, { recursive: true, force: true }); }
});

/** Petit binaire Mach-O 64 bits (en-tête et commandes seulement) déclarant une version minimale de macOS. */
function machO(minos: number, commande: 0x32 | 0x24): Buffer {
  const lc = Buffer.alloc(commande === 0x32 ? 24 : 16);
  lc.writeUInt32LE(commande, 0);
  lc.writeUInt32LE(lc.length, 4);
  if (commande === 0x32) { lc.writeUInt32LE(1, 8); lc.writeUInt32LE(minos, 12); } else lc.writeUInt32LE(minos, 8);
  const entete = Buffer.alloc(32);
  entete.writeUInt32LE(0xfeedfacf, 0);
  entete.writeUInt32LE(1, 16);
  entete.writeUInt32LE(lc.length, 20);
  return Buffer.concat([entete, lc]);
}

test('application Mac : Info.plist (nom, identifiant de l’agent de démarrage, version, macOS minimum lu dans Node.js, AGPL)', () => {
  const d = mkdtempSync(join(tmpdir(), 'lb-macho-'));
  try {
    writeFileSync(join(d, 'mince'), machO(0x0d0500, 0x32));
    assert.equal(macosMinimum(join(d, 'mince')), '13.5');
    writeFileSync(join(d, 'ancien'), machO(0x0a0f00, 0x24));
    assert.equal(macosMinimum(join(d, 'ancien')), '10.15');
    // binaire universel : la plus exigeante de ses architectures
    const a = machO(0x0b0000, 0x32);
    const b = machO(0x0d0502, 0x32);
    const fat = Buffer.alloc(8 + 40);
    fat.writeUInt32BE(0xcafebabe, 0);
    fat.writeUInt32BE(2, 4);
    fat.writeUInt32BE(64, 8 + 8);
    fat.writeUInt32BE(256, 8 + 28);
    const universel = Buffer.alloc(256 + b.length);
    fat.copy(universel);
    a.copy(universel, 64);
    b.copy(universel, 256);
    writeFileSync(join(d, 'universel'), universel);
    assert.equal(macosMinimum(join(d, 'universel')), '13.5.2');
    writeFileSync(join(d, 'texte'), 'pas un binaire, pas du tout');
    assert.throws(() => macosMinimum(join(d, 'texte')), /Mach-O attendu/);
    if (surMac) assert.equal(macosMinimum(process.execPath), /minos (\S+)/.exec(spawnSync('vtool', ['-show-build', process.execPath], { encoding: 'utf8' }).stdout)?.[1] ?? macosMinimum(process.execPath), 'comme vtool');
  } finally { rmSync(d, { recursive: true, force: true }); }
  const plist = infoPlist('9.9.9', '13.5');
  const valeur = (k: string) => new RegExp(`<key>${k}</key>\\n\\t<string>([^<]*)</string>`).exec(plist)?.[1];
  assert.equal(valeur('CFBundleName'), 'Living Business');
  assert.equal(valeur('CFBundleIdentifier'), ETIQUETTE, 'même identifiant que l’agent de lancement au démarrage');
  assert.equal(valeur('CFBundleShortVersionString'), '9.9.9');
  assert.equal(valeur('CFBundleVersion'), '9.9.9');
  assert.equal(valeur('LSMinimumSystemVersion'), '13.5');
  assert.equal(valeur('LSApplicationCategoryType'), 'public.app-category.business');
  assert.match(valeur('NSHumanReadableCopyright') ?? '', /Breizhcosystem.*GNU AGPL version 3/);
  assert.equal(valeur('CFBundleExecutable'), 'applet');
  assert.match(plist, /<key>OSAAppletStayOpen<\/key>\n\t<true\/>/, 'applet qui reste ouverte (Dock, Quitter)');
  assert.doesNotMatch(plist, /UsageDescription/, 'aucune autorisation demandée');
  if (surMac) {
    const f = join(tmpdir(), `lb-info-${process.pid}.plist`);
    writeFileSync(f, plist);
    try { assert.equal(spawnSync('plutil', ['-lint', f]).status, 0, 'Info.plist valide'); } finally { rmSync(f, { force: true }); }
  }
});

test('application Mac : applet compilée, signature ad hoc vérifiée, Node.js intact, zip qui ne contient que l’application', { skip: !surMac && 'macOS seulement : osacompile, codesign et ditto' }, () => {
  const sortie = mkdtempSync(join(tmpdir(), 'lb-application-mac-'));
  try {
    const licence = join(sortie, 'LICENSE-node');
    writeFileSync(licence, 'licence de Node.js\n');
    const node = { binaire: process.execPath, licence, version: process.version };
    const d = assembler('darwin-arm64', sortie, '9.9.9', node);
    const appli = join(d, APPLICATION_MAC);
    for (const f of ['Contents/MacOS/applet', 'Contents/MacOS/node', 'Contents/Resources/Scripts/main.scpt', 'Contents/Resources/living-business.icns', 'Contents/Resources/LISEZMOI.txt', 'Contents/Resources/app/src/lanceur.ts']) {
      assert.ok(existsSync(join(appli, f)), f);
    }
    const empreinte = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
    assert.equal(empreinte(join(appli, 'Contents/MacOS/node')), empreinte(process.execPath), 'Node.js tel quel : sa signature d’origine n’est pas remplacée');
    assert.equal(spawnSync('codesign', ['--verify', '--deep', '--strict', appli]).status, 0, 'signature vérifiée (code imbriqué compris)');
    const signature = spawnSync('codesign', ['-dv', appli], { encoding: 'utf8' }).stderr;
    assert.match(signature, /Identifier=bzh\.breizh-eco\.living-business/);
    assert.match(signature, /Signature=adhoc/);
    assert.match(readFileSync(join(appli, 'Contents', 'Info.plist'), 'utf8'), new RegExp(`<string>${macosMinimum(process.execPath).replace('.', '\\.')}</string>`), 'macOS minimum : celui du Node.js inclus');
    const zip = compresser('darwin-arm64', d);
    const entrees = spawnSync('zipinfo', ['-1', zip], { encoding: 'utf8' }).stdout.trim().split('\n');
    assert.deepEqual([...new Set(entrees.map((e) => e.split('/')[0]))], [APPLICATION_MAC], 'une seule chose à la racine du zip : l’application');
    assert.ok(entrees.includes(`${APPLICATION_MAC}/Contents/MacOS/node`));
    const ouvert = join(sortie, 'ouvert');
    mkdirSync(ouvert);
    assert.equal(spawnSync('ditto', ['-x', '-k', zip, ouvert]).status, 0);
    assert.equal(spawnSync('codesign', ['--verify', '--deep', '--strict', join(ouvert, APPLICATION_MAC)]).status, 0, 'toujours valide une fois décompressée');
  } finally { rmSync(sortie, { recursive: true, force: true }); }
});

test('lanceur --application (application Mac) : démarre en arrière-plan, rouvre sans 2e serveur, s’arrête avec l’application', async () => {
  const racine = fileURLToPath(new URL('../', import.meta.url));
  const d = mkdtempSync(join(tmpdir(), 'lb-application-'));
  const donnees = join(d, 'donnees');
  // l'« application » : un processus quelconque dont le serveur suit la vie
  const appli = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  const env = { ...process.env, LB_DONNEES: donnees, LB_NAVIGATEUR: '0', LB_NEXUS_URL: '', PORT: String(43000 + Math.floor(Math.random() * 2000)) };
  const appeler = (...args: string[]) => spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/lanceur.ts', `--application=${appli.pid}`, ...args], { cwd: racine, env, encoding: 'utf8', timeout: 60_000 });
  let serveur = 0;
  try {
    // secours sans entreprise créée : refusé, avec la raison (montrée par l'application dans un dialogue)
    const r0 = appeler('--secours');
    assert.equal(r0.status, 1);
    assert.match(r0.stderr, /Aucune entreprise n’est encore créée sur cet ordinateur/);
    const r1 = appeler();
    assert.equal(r1.status, 0, r1.stderr);
    const [etat, pid, port] = r1.stdout.trim().split(' ');
    assert.equal(etat, 'pret');
    serveur = Number(pid);
    const session = await (await fetch(`http://127.0.0.1:${port}/api/v1/session`)).json() as { surPlace: boolean };
    assert.equal(session.surPlace, true, 'le serveur répond');
    assert.equal(JSON.parse(readFileSync(join(donnees, 'instance.json'), 'utf8')).pid, serveur);
    assert.match(readFileSync(join(donnees, 'journal-serveur.log'), 'utf8'), /Démarré par l’application Living Business/);
    // 2e ouverture (Dock, double-clic) : le même serveur
    const r2 = appeler();
    assert.equal(r2.status, 0, r2.stderr);
    assert.equal(r2.stdout.trim(), `deja ${serveur} ${port}`);
    // l'application disparaît (Quitter, ou arrêt forcé) : son serveur s'arrête proprement
    appli.kill('SIGKILL');
    for (let i = 0; i < 100 && existsSync(join(donnees, 'instance.json')); i++) await new Promise((ok) => setTimeout(ok, 100));
    assert.ok(!existsSync(join(donnees, 'instance.json')), 'serveur arrêté, fichier d’instance retiré');
    await assert.rejects(fetch(`http://127.0.0.1:${port}/api/v1/session`), 'plus rien sur le port');
    serveur = 0;
  } finally {
    appli.kill('SIGKILL');
    if (serveur) try { process.kill(serveur, 'SIGTERM'); } catch { /* déjà arrêté */ }
    rmSync(d, { recursive: true, force: true });
  }
});
