/**
 * Logiciel libre : Living Business est distribué sous la licence GNU AGPL version 3 (décision de l'éditeur du
 * 12 novembre 2026). Ces essais gardent ensemble ce qui doit le dire : le texte officiel (LICENSE), l'identifiant de
 * package.json, la notice en français, la page « Licences et crédits », le lien vers le code source et les paquets.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHEMIN_TEXTE_LICENCE, CODE_SOURCE, FICHIER_LICENCE, FICHIER_NOTICE, IDENTIFIANT_LICENCE } from '../src/passerelle/licence.ts';
import { fichiersStatiques } from '../src/passerelle/statiques.ts';
import { assembler, CIBLES, racinePaquet } from './paquets.ts';

const RACINE = new URL('../', import.meta.url);
const octets = (f: string) => readFileSync(new URL(f, RACINE));
const lire = (f: string) => octets(f).toString('utf8');
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** Espaces de toute sorte (fines et insécables comprises) réduites à une espace simple. */
const plat = (t: string) => t.replace(/\s+/g, ' ').trim();

/** Empreinte SHA-256 du texte téléchargé sur https://www.gnu.org/licenses/agpl-3.0.txt le 12 novembre 2026. */
const EMPREINTE_AGPL = '0d96a4ff68ad6d4b6f1f30f713b18d5184912ba8dd389f86aa7710db079abcb0';

test('LICENSE : texte officiel de la GNU AGPL version 3, complet et inchangé', () => {
  assert.equal(FICHIER_LICENCE, 'LICENSE');
  const brut = octets(FICHIER_LICENCE);
  const texte = brut.toString('utf8');
  const lignes = texte.split('\n');
  assert.equal(lignes[0]?.trim(), 'GNU AFFERO GENERAL PUBLIC LICENSE');
  assert.equal(lignes[1]?.trim(), 'Version 3, 19 November 2007');
  assert.match(texte, /Copyright \(C\) 2007 Free Software Foundation, Inc\. <https:\/\/fsf\.org\/>/);
  assert.equal(brut.length, 34_523, 'taille du texte publié sur gnu.org (environ 34 Ko)');
  // les 18 articles, de 0 à 17, dans l'ordre
  const articles = lignes.map((l) => /^ {2}(\d{1,2})\. \S/.exec(l)?.[1]).filter((n) => n !== undefined).map(Number);
  assert.deepEqual(articles, Array.from({ length: 18 }, (_, i) => i));
  assert.match(texte, /^ {2}9\. Acceptance Not Required for Having Copies\.$/m, 'article 9 : aucune acceptation pour utiliser');
  assert.match(texte, /^ {2}13\. Remote Network Interaction; Use with the GNU General Public License\.$/m, 'article 13 : usage en réseau');
  // complet : fin des conditions, puis la section « How to Apply These Terms », jusqu'à sa dernière ligne
  const fin = texte.indexOf('END OF TERMS AND CONDITIONS');
  const appliquer = texte.indexOf('How to Apply These Terms to Your New Programs');
  assert.ok(fin > 0 && appliquer > fin, 'section « How to Apply These Terms » après la fin des conditions');
  assert.ok(texte.endsWith('<https://www.gnu.org/licenses/>.\n'), 'dernière ligne du texte officiel');
  // tel quel : ni fin de ligne Windows, ni caractère ajouté (« changing it is not allowed »)
  assert.doesNotMatch(texte, /\r/);
  assert.doesNotMatch(texte, /[^\x00-\x7f]/, 'texte en ASCII');
  assert.equal(sha256(brut), EMPREINTE_AGPL, 'empreinte du texte publié par la Free Software Foundation');
  assert.match(octets('.gitattributes').toString('utf8'), /^LICENSE -text$/m, 'git ne convertit jamais ses fins de ligne');
});

test('package.json : « AGPL-3.0-only », toujours privé (pas de publication npm par erreur), verrou accordé, dépôt du code source', () => {
  const pkg = JSON.parse(lire('package.json')) as { license?: string; private?: boolean; repository?: { type?: string; url?: string } };
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.equal(pkg.license, IDENTIFIANT_LICENCE, 'même identifiant dans le jeu et dans les paquets');
  assert.equal(pkg.private, true, '« private » n’a rien à voir avec la licence : il empêche seulement « npm publish »');
  const verrou = JSON.parse(lire('package-lock.json')) as { packages: Record<string, { license?: string }> };
  assert.equal(verrou.packages['']?.license, pkg.license, 'verrou accordé à package.json');
  assert.deepEqual(pkg.repository, { type: 'git', url: `git+${CODE_SOURCE}.git` });
});

test('une seule licence : plus de licence d’utilisation maison, la notice en français renvoie au texte officiel', () => {
  assert.equal(FICHIER_NOTICE, 'NOTICE.md');
  assert.equal(existsSync(new URL('LICENCE.txt', RACINE)), false, 'LICENCE.txt retiré : il ajoutait des restrictions, ce que la licence interdit');
  const notice = plat(lire(FICHIER_NOTICE));
  assert.match(notice, /n’a pas de valeur juridique : seul le texte anglais de la licence, dans le fichier LICENSE, fait foi/);
  assert.match(notice, /GNU AGPL v3, identifiant « AGPL-3\.0-only »/);
  // ce qui décrit la licence aux utilisateurs et aux lecteurs du dépôt ne parle plus de l'ancienne
  for (const f of ['LICENCES-TIERS.md', 'web/licences.html', 'web/app.js', 'web/index.html', 'scripts/paquets.ts', 'src/passerelle/licence.ts', 'src/passerelle/statiques.ts']) {
    assert.doesNotMatch(lire(f), /LICENCE\.txt|SEE LICENSE IN|licence d[’']utilisation/i, f);
  }
});

test('code source (article 13) : lien « Code source (AGPL v3) » sur la page « Licences et crédits », même adresse partout', () => {
  assert.equal(CODE_SOURCE, 'https://github.com/gaelasao/breizh-eco-jeu');
  const lien = `<a href="${CODE_SOURCE}" rel="noopener noreferrer">Code source (AGPL v3)</a>`;
  const credits = lire('web/licences.html');
  assert.ok(credits.includes(lien), 'lien vers le code source sur « Licences et crédits »');
  const section = credits.slice(credits.indexOf('<section aria-labelledby="t-licence">'), credits.indexOf('<section aria-labelledby="t-polices">'));
  assert.ok(section.includes(lien), 'dans la section de la licence, en tête de page');
  assert.match(plat(section), /logiciel libre : vous pouvez l’utiliser, l’étudier, le modifier et le redistribuer aux conditions de la licence publique générale GNU Affero, version 3 \(GNU AGPL v3\)/);
  assert.ok(section.includes(`<a href="${CHEMIN_TEXTE_LICENCE}">Texte de la licence GNU AGPL version 3</a>`), 'texte officiel lié');
  assert.ok(section.includes('<a href="/licence.html">La licence en bref</a>'), 'notice en français liée');
  // la page servie par la passerelle est bien celle-là, et le texte officiel est servi tel quel
  const servis = fichiersStatiques();
  assert.ok(servis.get('/licences.html')?.contenu.toString('utf8').includes(lien));
  assert.equal(sha256(servis.get(CHEMIN_TEXTE_LICENCE)?.contenu ?? Buffer.alloc(0)), EMPREINTE_AGPL, 'texte officiel servi par le jeu');
  // marques de l'éditeur : terme additionnel de l'article 7, dit aussi sur la page
  assert.match(plat(credits), /restent des marques de l’éditeur : la licence de Living Business ne donne aucun droit sur elles \(terme additionnel, permis par son article 7\)/);
  // même adresse partout où elle est écrite : une version modifiée les change ensemble
  assert.ok(lire('web/app.js').includes(`const CODE_SOURCE = '${CODE_SOURCE}';`), 'web/app.js');
  assert.ok(lire(FICHIER_NOTICE).includes(`\n${CODE_SOURCE}\n`), 'NOTICE.md');
  for (const f of ['web/app.js', 'web/licences.html', FICHIER_NOTICE, 'LICENCES-TIERS.md', 'scripts/paquets.ts']) {
    const autres = [...lire(f).matchAll(/https:\/\/github\.com\/gaelasao\/[A-Za-z0-9._-]+/g)].map((m) => m[0]).filter((u) => u !== CODE_SOURCE);
    assert.deepEqual(autres, [], `${f} : une seule adresse de dépôt`);
  }
});

test('paquets : chaque paquet embarque LICENSE (texte officiel, inchangé) et la notice, et dit où est le code source', () => {
  const sortie = mkdtempSync(join(tmpdir(), 'lb-logiciel-libre-'));
  try {
    for (const c of CIBLES) {
      const d = racinePaquet(c, assembler(c, sortie, '9.9.9', null));
      for (const f of [join(d, FICHIER_LICENCE), join(d, 'app', FICHIER_LICENCE)]) {
        assert.equal(sha256(readFileSync(f)), EMPREINTE_AGPL, `${c} : ${f.slice(d.length + 1)} est le texte officiel de la GNU AGPL version 3`);
      }
      assert.ok(existsSync(join(d, FICHIER_NOTICE)) && existsSync(join(d, 'app', FICHIER_NOTICE)), `${c} : notice jointe`);
      const lisezmoi = readFileSync(join(d, 'LISEZMOI.txt'), 'utf8');
      assert.match(lisezmoi, /LOGICIEL LIBRE/);
      assert.ok(lisezmoi.includes(CODE_SOURCE), `${c} : adresse du code source dans LISEZMOI.txt`);
      assert.equal((JSON.parse(readFileSync(join(d, 'app', 'package.json'), 'utf8')) as { license?: string }).license, IDENTIFIANT_LICENCE);
      // le jeu lancé depuis le paquet sert la licence et la notice depuis app/
      const servis = fichiersStatiques(pathToFileURL(join(d, 'app') + sep));
      assert.equal(sha256(servis.get(CHEMIN_TEXTE_LICENCE)?.contenu ?? Buffer.alloc(0)), EMPREINTE_AGPL, `${c} : texte officiel servi depuis le paquet`);
      assert.match(servis.get('/licence.html')?.contenu.toString('utf8') ?? '', /<h1 class="bz-t-titre-1">Living Business est un logiciel libre<\/h1>/, `${c} : notice servie depuis le paquet`);
    }
  } finally { rmSync(sortie, { recursive: true, force: true }); }
});

test('composants tiers : LICENCES-TIERS.md dit que rien ne s’oppose à une distribution sous GNU AGPL version 3, et pourquoi', () => {
  const tiers = lire('LICENCES-TIERS.md');
  const debut = tiers.indexOf('## Compatibilité avec la licence GNU AGPL version 3');
  assert.ok(debut > 0, 'section sur la compatibilité');
  const section = plat(tiers.slice(debut, tiers.indexOf('## Polices')));
  assert.match(section, /aucun composant embarqué n'empêche de distribuer Living Business sous la licence GNU AGPL version 3/);
  assert.match(section, /ne remplace pas l'avis d'un juriste/);
  // chaque famille de composants embarqués y est nommée avec sa licence
  for (const [nom, licence] of [['three.js', 'MIT'], ['camera-controls', 'MIT'], ['uPlot', 'MIT'], ['uFuzzy', 'MIT'], ['@github/combobox-nav', 'MIT'],
    ['Lucide', 'ISC'], ['KayKit', 'CC0 1.0'], ['Inter', 'SIL OFL 1.1'], ['Fraunces', 'SIL OFL 1.1'], ['Atkinson Hyperlegible Next', 'SIL OFL 1.1'], ['Node.js', 'Apache 2.0']] as const) {
    assert.ok(section.includes(nom), `${nom} examiné`);
    assert.ok(section.includes(licence), `${nom} : licence ${licence} nommée`);
  }
  // les licences des dépendances d'exécution sont bien celles que le fichier annonce (paquets npm installés)
  const pkg = JSON.parse(lire('package.json')) as { dependencies: Record<string, string> };
  for (const nom of Object.keys(pkg.dependencies)) {
    const dep = JSON.parse(lire(`node_modules/${nom}/package.json`)) as { license?: string };
    assert.equal(dep.license, 'MIT', `${nom} : licence déclarée par le paquet`);
    assert.ok(existsSync(new URL(`node_modules/${nom}/LICENSE`, RACINE)), `${nom} : texte de licence joint au paquet`);
  }
  // aucune police ne déclare de nom réservé (un sous-ensemble est une version modifiée au sens de l'OFL)
  for (const f of ['inter-OFL.txt', 'fraunces-OFL.txt', 'atkinson-OFL.txt']) assert.doesNotMatch(lire(`web/licences/${f}`), /with Reserved Font Name/i, f);
  // formes lisibles des bibliothèques servies minifiées : là où le fichier le dit
  assert.match(section, /dist\/camera-controls\.module\.js/);
  assert.match(section, /dist\/uPlot\.iife\.js/);
  for (const f of ['camera-controls/dist/camera-controls.module.js', 'uplot/dist/uPlot.iife.js']) assert.ok(existsSync(new URL(`node_modules/${f}`, RACINE)), f);
});

test('README : section « Logiciel libre » (licence, lancer depuis les sources, signaler un problème, contribuer), plus rien d’un dépôt privé', () => {
  const readme = lire('README.md');
  const debut = readme.indexOf('\n## Logiciel libre\n');
  assert.ok(debut > 0 && debut < readme.indexOf('\n## Principes non négociables\n'), 'section en tête du fichier');
  const section = readme.slice(debut, readme.indexOf('\n## Principes non négociables\n'));
  assert.match(section, /licence publique générale GNU Affero, version 3\*\* \(GNU AGPL v3, identifiant `AGPL-3\.0-only`\)/);
  for (const lien of ['[LICENSE](LICENSE)', '[NOTICE.md](NOTICE.md)', '[LICENCES-TIERS.md](LICENCES-TIERS.md)', '[SECURITY.md](SECURITY.md)']) {
    assert.ok(section.includes(lien), `lien ${lien}`);
    assert.ok(existsSync(new URL(/\]\(([^)]+)\)/.exec(lien)?.[1] ?? '', RACINE)), `${lien} : le fichier existe`);
  }
  assert.match(section, /en anglais, seul à faire foi/);
  assert.match(section, /Aucune garantie\*\*, dans les limites de la loi/);
  assert.match(section, /restent des marques de l'éditeur/);
  // lancer depuis les sources : commandes qui existent
  const lancer = section.slice(section.indexOf('### Lancer depuis les sources'), section.indexOf('### Signaler un problème'));
  assert.ok(lancer.includes(`git clone ${CODE_SOURCE}.git`), 'adresse du dépôt');
  const scripts = (JSON.parse(lire('package.json')) as { scripts: Record<string, string> }).scripts;
  for (const commande of ['demo', 'start', 'check']) {
    assert.match(lancer, new RegExp(`^npm (run )?${commande}\\b`, 'm'), `npm ${commande} cité`);
    assert.ok(scripts[commande], `script « ${commande} » dans package.json`);
  }
  assert.match(lancer, /^npm ci\b/m);
  // signaler un problème : tickets publics, sauf pour une faille
  const signaler = section.slice(section.indexOf('### Signaler un problème'), section.indexOf('### Contribuer'));
  assert.ok(signaler.includes(`${CODE_SOURCE}/issues`), 'tickets du dépôt');
  assert.match(signaler, /faille de sécurité\*\* : pas de ticket public\. Suivez \[SECURITY\.md\]/);
  // contribuer : sous la même licence ; accord de contribution à décider par l'éditeur, jamais inventé ici
  const contribuer = section.slice(section.indexOf('### Contribuer'));
  assert.match(contribuer, /Les contributions sont acceptées \*\*sous la même licence\*\* \(GNU AGPL version 3\)/);
  assert.match(contribuer, /Restent à décider par l'éditeur : un éventuel accord de contribution \(certificat d'origine « DCO »[^)]*« CLA »\) et la politique de contributions/);
  // plus rien de l'époque du dépôt privé, ni chemin hors du dépôt, ni chemin personnel
  assert.doesNotMatch(readme, /tous droits réservés|dépôt privé|Non choisie|arbitrage n°|\(\.\.\/|`\.\.\/|~\/\.ssh\//i);
  assert.match(readme, /\n## Licence\n\nLogiciel libre sous licence GNU AGPL version 3/);
});
