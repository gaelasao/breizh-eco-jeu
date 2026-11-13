/**
 * Fabrique les paquets téléchargeables « rien à installer » : Node.js officiel + le jeu + lanceurs double-clic.
 *
 *   node scripts/paquets.ts                 → les 4 systèmes (dist/living-business-<version>-<cible>.zip)
 *   node scripts/paquets.ts darwin-arm64    → un seul (darwin-arm64, darwin-x64, win-x64, linux-x64)
 *   LB_NODE_MAJEUR=24 (défaut) ou LB_NODE_VERSION=v24.22.2 pour fixer la version de Node.js
 *   --nexus https://reseau.example       → adresse de Breizhcosystem préréglée dans le jeu (ou LB_NEXUS_URL=… à la fabrication)
 *   --essai                                 → essai depuis la copie de travail, dans dist/essai/ (jamais publié)
 *
 * Publication (sans --essai) : refusée si la copie de travail est modifiée ou si HEAD n'est pas étiqueté v<version>.
 * Les sources sont exportées du commit (git archive) hors du dossier de travail, les dépendances réinstallées depuis
 * le verrou (npm ci --omit=dev --ignore-scripts), et dist/PROVENANCE.txt dit de quel commit viennent les paquets
 * (scripts/provenance.ts) : ni un fichier non suivi, ni une modification non commitée, ni un node_modules du poste
 * n'entrent dans un paquet publié.
 *
 * Adresse de Breizhcosystem : https seulement, réduite à l'origine, écrite dans app/package.json (`nexus`) ; le lanceur la donne
 * au jeu (LB_NEXUS_URL) à chaque démarrage, y compris au lancement automatique. LB_NEXUS_URL au lancement l'emporte.
 *
 * Sécurité de la chaîne : Node.js est téléchargé depuis nodejs.org en HTTPS, son empreinte SHA-256 est vérifiée contre
 * SHASUMS256.txt de la même version, et ce SHASUMS256.txt doit porter la signature OpenPGP (SHASUMS256.txt.sig) d'un
 * publieur de Node.js dont la clé est épinglée dans scripts/node-cles-publication.asc : un nodejs.org ou un CDN
 * compromis ne suffit pas à faire passer un autre binaire. La signature est revérifiée à chaque fabrication, cache
 * compris (scripts/openpgp.ts, sans gpg). Seul le binaire `node` (+ sa licence) est gardé.
 * Le paquet ne contient ni tests, ni dépendances de développement, ni données.
 *
 * Licence (logiciel libre, GNU AGPL version 3) : LICENSE, le texte officiel, et NOTICE.md, la notice en français, sont
 * obligatoires et joints à la racine du paquet (lus avant le premier lancement) et dans app/ (la passerelle sert le
 * texte et tire /licence.html de la notice). LICENSE est copié tel quel, octet pour octet ; la notice prend des fins
 * de ligne Windows à la racine du paquet win-x64. LISEZMOI.txt dit où trouver le code source complet.
 *
 * Mac (darwin-arm64, darwin-x64) : le zip ne contient que l'application « Living Business.app » ; la racine du paquet
 * est alors Living Business.app/Contents/Resources (LICENSE, NOTICE.md, LISEZMOI.txt et app/), Node.js est
 * Contents/MacOS/node (sa signature d'origine gardée), et l'applet de paquets/mac/application.applescript, compilée par
 * osacompile, est l'exécutable principal. Signature ad hoc seulement (signerApplicationMac), zip par ditto : ces
 * paquets se fabriquent sur un Mac.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adresseNexus } from '../src/passerelle/bureau.ts';
import { ETIQUETTE } from '../src/passerelle/demarrage.ts';
import { CODE_SOURCE, FICHIER_LICENCE, FICHIER_NOTICE, IDENTIFIANT_LICENCE } from '../src/passerelle/licence.ts';
import { BIBLIOTHEQUES } from '../src/passerelle/statiques.ts';
import { lireCles, verifierSignatureDetachee, type ClePublique } from './openpgp.ts';
import { controlerArbre, ecrireProvenance, empreinteVerrou, exporterCommit, FICHIER_PROVENANCE, installerDependances, type Provenance } from './provenance.ts';
import { lireSignataires } from './signer-publication.ts';

export type Cible = 'darwin-arm64' | 'darwin-x64' | 'win-x64' | 'linux-x64';
export const CIBLES: readonly Cible[] = ['darwin-arm64', 'darwin-x64', 'win-x64', 'linux-x64'];
const systeme = (c: Cible) => (c.startsWith('darwin') ? 'mac' : c.startsWith('win') ? 'windows' : 'linux');

const RACINE = fileURLToPath(new URL('../', import.meta.url));

/** Fichiers d'exécution seulement (ce que le serveur lit réellement). */
const DEPENDANCES = [
  'three/package.json', 'three/LICENSE', 'three/build/three.module.js', 'three/build/three.core.js',
  ...['controls', 'loaders', 'environments', 'postprocessing', 'shaders', 'utils', 'math'].map((d) => `three/examples/jsm/${d}`),
  // bibliothèques du système de design (servies par src/passerelle/statiques.ts) ; les polices sont dans web/polices/
  ...[...new Set(BIBLIOTHEQUES.flatMap((b) => [`${b.paquet}/package.json`, `${b.paquet}/${b.licence}`, `${b.paquet}/${b.fichier}`]))],
];

// ---------------------------------------------------------------- lanceurs et notice

function lanceurs(c: Cible): Record<string, { contenu: string; executable: boolean }> {
  const s = systeme(c);
  if (s === 'windows') {
    const cmd = (args: string) => ['@echo off', 'chcp 65001 >nul', 'title Living Business', 'cd /d "%~dp0app"',
      `"%~dp0app\\node.exe" --disable-warning=ExperimentalWarning src\\lanceur.ts ${args}%*`, 'if errorlevel 1 pause', ''].join('\r\n');
    return { 'Living Business.cmd': { contenu: cmd(''), executable: false }, 'Secours mot de passe.cmd': { contenu: cmd('--secours '), executable: false } };
  }
  if (s === 'mac') return {}; // l'application Living Business.app (applet) lance et rouvre le jeu, ⌥ pour le secours
  const sh = (args: string, titre: string) => ['#!/bin/sh', `# ${titre}`, 'cd "$(dirname "$0")/app" || exit 1',
    `exec ./node --disable-warning=ExperimentalWarning src/lanceur.ts ${args}"$@"`, ''].join('\n');
  return {
    'living-business.sh': { contenu: sh('', 'Living Business — lancez ce fichier. Laissez le terminal ouvert pendant l’utilisation.'), executable: true },
    'secours-mot-de-passe.sh': { contenu: sh('--secours ', 'Mot de passe ET code de secours perdus.'), executable: true },
  };
}

export function notice(c: Cible, version: string, versionNode: string, nexus: string | null = null): string {
  const s = systeme(c);
  const mac = s === 'mac';
  const lancer = s === 'windows' ? '« Living Business » (Living Business.cmd)' : '« living-business.sh »';
  const donnees = s === 'windows' ? '%APPDATA%\\Living Business' : mac ? '~/Bibliothèque/Application Support/Living Business' : '~/.local/share/living-business';
  // Lanceurs (et application Mac) pas encore signés par Apple ni Microsoft (décision de l'éditeur) : le
  // passage de l'avertissement n'est décrit que pour un paquet dont la provenance est connue, jamais comme un réflexe.
  const avant = [mac ? '   AVANT : n’ouvrez cette application que si VOUS l’avez téléchargée sur la page « Télécharger Living Business »'
    : '   AVANT : n’ouvrez ce dossier que si VOUS l’avez téléchargé sur la page « Télécharger Living Business »',
  `   de Breizhcosystem${nexus ? ` (${nexus}/telecharger)` : ''}, ou par le lien de Réglages → À propos de votre jeu.`,
  '   Un fichier reçu par e-mail, par message ou en pièce jointe, ou trouvé sur un autre site, se supprime',
  '   sans l’ouvrir, même s’il semble venir de l’éditeur.'];
  const premiereFois = mac
    ? [...avant,
      '   L’application n’est pas encore signée par Apple : la première fois, macOS dit qu’il ne peut pas la vérifier.',
      '   Seulement pour une application téléchargée comme ci-dessus : Réglages Système → Confidentialité et',
      '   sécurité, puis en bas « Ouvrir quand même » (une seule fois). Jamais pour un autre fichier.']
    : s === 'windows'
      ? [...avant,
        '   Les lanceurs ne sont pas encore signés pour Windows : « Windows a protégé votre ordinateur » peut s’afficher.',
        '   Seulement pour un dossier téléchargé comme ci-dessus : « Informations complémentaires » → « Exécuter quand',
        '   même » (une seule fois). Jamais pour un autre fichier.']
      : ['   Depuis un terminal : ./living-business.sh'];
  const installer = mac
    ? ['INSTALLER (rien d’autre à installer)',
      '1. Ouvrez le fichier téléchargé (.zip) : l’application Living Business apparaît à côté.',
      '2. Glissez-la dans le dossier Applications.',
      '3. Double-cliquez sur Living Business : votre navigateur s’ouvre ; créez votre entreprise et votre accès',
      '   de propriétaire.',
      ...premiereFois,
      '',
      'Pendant l’utilisation, l’icône de Living Business reste dans le Dock : un clic dessus rouvre le navigateur.',
      'Pour arrêter : menu Living Business → Quitter Living Business (⌘Q), ou clic droit sur l’icône du Dock → Quitter.']
    : ['RIEN À INSTALLER',
      '1. Décompressez ce dossier où vous voulez (Documents, Applications, bureau…).',
      `2. Double-cliquez sur ${lancer}.`,
      ...premiereFois,
      '3. Votre navigateur s’ouvre : créez votre entreprise et votre accès de propriétaire.',
      '',
      'Laissez la petite fenêtre de texte ouverte pendant l’utilisation ; fermez-la pour arrêter.',
      'Un 2e double-clic rouvre simplement le navigateur.'];
  const lignes = [
    `LIVING BUSINESS ${version} — votre entreprise, en local`,
    '='.repeat(60),
    '',
    ...installer,
    '',
    'VOS DONNÉES',
    `   Elles sont rangées dans : ${donnees}`,
    mac ? '   (pas dans l’application : vous pouvez la remplacer par une nouvelle version sans rien perdre).'
      : '   (pas dans ce dossier : vous pouvez le remplacer par une nouvelle version sans rien perdre).',
    '   Rien n’est envoyé à l’éditeur sans votre accord. Copie automatique chaque jour (30 jours) ;',
    '   exportez de temps en temps une copie chiffrée : Réglages → Sauvegardes.',
    '',
    'VOS COLLÈGUES (même bureau, même réseau)',
    '   Sur cet ordinateur : Réglages → Équipe et réseau → « Ouvrir à mon équipe »,',
    ...(mac ? ['   et « Lancer au démarrage de l’ordinateur » s’il sert à toute l’équipe (Living Business doit alors être',
      '   dans le dossier Applications).'] : ['   et « Lancer au démarrage de l’ordinateur » s’il sert à toute l’équipe.']),
    '   Puis Réglages → Accès et visibilité → Inviter : un lien personnel par personne.',
    '   Laissez cet ordinateur allumé pendant les heures de travail.',
    '',
    'PARTOUT (téléphone, chantier, maison)',
    '   Réglages → Mettre en ligne : sans serveur (Tailscale), ou sur votre propre serveur,',
    mac ? '   à votre nom (le jeu donne la commande à lancer sur un serveur Ubuntu 24.04).'
      : '   à votre nom (installer-jeu.sh, dans ce dossier, se lance sur un serveur Ubuntu 24.04).',
    '',
    ...(nexus ? ['RÉSEAU Breizhcosystem (facultatif)', `   Adresse préréglée : ${nexus}`, '   Réglages → Breizhcosystem → « Relier mon entreprise » : rien ne part avant, et vous choisissez quoi partager.', '   « Se connecter avec… » (sans compte Breizhcosystem) fait passer les jetons de connexion par ce serveur :', '   voir Réglages → Confidentialité. Avec une clé (mode avancé), rien ne passe par l’éditeur.', ''] : []),
    'MISE À JOUR',
    '   Réglages → À propos → Mises à jour : « Vérifier maintenant » dit s’il existe une nouvelle version',
    '   (correctif de sécurité signalé) et donne le lien de la page de téléchargement de Breizhcosystem. Téléchargez-la là,',
    ...(mac ? ['   et nulle part ailleurs, quittez Living Business, glissez la nouvelle application dans le dossier Applications',
      '   (« Remplacer »), relancez : vos données restent dans leur dossier.',
      '   Un e-mail « nouvelle version » avec un lien ou une pièce jointe n’est pas une source sûre.']
      : ['   et nulle part ailleurs, fermez Living Business, remplacez ce dossier, relancez : vos données restent dans',
        '   leur dossier. Un e-mail « nouvelle version » avec un lien ou une pièce jointe n’est pas une source sûre.']),
    '',
    'MOT DE PASSE OUBLIÉ',
    '   Collègue : un administrateur lui envoie un nouveau lien.',
    '   Propriétaire : « Mot de passe oublié ? » avec le code de secours reçu à l’installation.',
    ...(mac ? ['   Plus de code : sur cet ordinateur, ouvrez Living Business en maintenant la touche ⌥ (Option) enfoncée,',
      '   puis « Ouvrir la page de secours ».']
      : [`   Plus de code : double-cliquez sur « Secours mot de passe » (sur cet ordinateur).`]),
    '',
    'LOGICIEL LIBRE',
    '   Living Business est un logiciel libre, sous licence GNU AGPL version 3 : vous pouvez l’utiliser, l’étudier,',
    '   le modifier et le redistribuer aux conditions de cette licence. Rien à accepter pour l’utiliser.',
    '   Il est fourni sans garantie, dans les limites de la loi.',
    `   Texte de la licence (en anglais, seul à faire foi) : ${FICHIER_LICENCE}. Résumé en français : ${FICHIER_NOTICE}.`,
    mac ? '   Les deux sont dans l’application (Living Business.app/Contents/Resources), et dans le jeu : Réglages → À propos.'
      : '   Les deux sont dans ce dossier, et dans le jeu : Réglages → À propos.',
    `   Code source complet (essais et scripts de fabrication compris) : ${CODE_SOURCE}`,
    '',
    'SIGNALER UNE FAILLE DE SÉCURITÉ',
    '   Vous pensez avoir trouvé une faille dans Living Business ? Écrivez à l’éditeur (Breizhcosystem) à l’adresse',
    `   de contact de la page « Mentions légales » de Breizhcosystem${nexus ? ` (${nexus}/mentions-legales)` : ''}, objet « Sécurité ».`,
    '   Sans données réelles de votre entreprise ni mot de passe, et sans rendre le problème public avant le correctif.',
    '',
    `Inclus : Node.js ${versionNode} (licence MIT, voir app/LICENCE-NODE.txt), three.js, camera-controls, uPlot, uFuzzy et combobox-nav (MIT), icônes Lucide (ISC), polices Inter, Fraunces et Atkinson Hyperlegible Next (OFL). Détail : app/LICENCES-TIERS.md. Liste des composants et de leurs empreintes (CycloneDX) : app/SBOM.cdx.json.`,
    '',
  ];
  return lignes.join(s === 'windows' ? '\r\n' : '\n');
}

// ---------------------------------------------------------------- assemblage

export interface NodeExtrait {
  binaire: string;
  licence: string;
  version: string;
  /** Archive officielle d'où vient le binaire, et son SHA-256 (celui de SHASUMS256.txt signé). */
  archive?: { url: string; sha256: string };
}

export interface OptionsPaquet {
  /** Adresse de Breizhcosystem préréglée (déjà validée par `adresseNexus`). */
  nexus?: string | null;
  /** Dossier d'où viennent les fichiers (défaut : ce dépôt) ; publication : export du commit étiqueté. */
  racine?: string;
  /** Nomenclature des dépendances donnée par npm (`sbomDependances`) : app/SBOM.cdx.json est écrit avec. */
  sbomNpm?: string;
  /** Mac : compiler l'applet et signer l'application (défaut : sur un Mac seulement ; ailleurs, structure seule, pour les essais). */
  applet?: boolean;
}

/** Racine du paquet, là où sont LISEZMOI.txt, LICENSE, NOTICE.md et app/ : le dossier, ou Contents/Resources de l'application Mac. */
export const racinePaquet = (cible: Cible, dossier: string) => (systeme(cible) === 'mac' ? join(dossier, APPLICATION_MAC, 'Contents', 'Resources') : dossier);

/**
 * Construit le dossier du paquet (sans le compresser). `node` null : sans Node.js (tests).
 * Mac : le dossier ne contient que Living Business.app (voir racinePaquet), compilée et signée sur un Mac.
 */
export function assembler(cible: Cible, sortie: string, version: string, node: NodeExtrait | null, options: OptionsPaquet = {}): string {
  const nexus = options.nexus ? adresseNexus(options.nexus) : null;
  if (options.nexus && !nexus) throw new Error(`Adresse de Breizhcosystem invalide : ${options.nexus}`);
  const base = options.racine ?? RACINE;
  const nom = `living-business-${version}-${cible}`;
  const dossier = join(sortie, nom);
  rmSync(dossier, { recursive: true, force: true });
  const mac = systeme(cible) === 'mac';
  const racine = racinePaquet(cible, dossier);
  const app = join(racine, 'app');
  mkdirSync(app, { recursive: true });
  const filtre = (src: string) => !/\.test\.ts$|\.DS_Store$/.test(src);
  cpSync(join(base, 'src'), join(app, 'src'), { recursive: true, filter: filtre });
  cpSync(join(base, 'web'), join(app, 'web'), { recursive: true, filter: filtre });
  cpSync(join(base, 'univers'), join(app, 'univers'), { recursive: true, filter: filtre });
  cpSync(join(base, 'LICENCES-TIERS.md'), join(app, 'LICENCES-TIERS.md'));
  // licence : le texte officiel tel quel (jamais réécrit, même pour Windows), et la notice en français
  const licence = join(base, FICHIER_LICENCE);
  if (!existsSync(licence)) throw new Error(`Texte de la licence absent : ${FICHIER_LICENCE}`);
  cpSync(licence, join(app, FICHIER_LICENCE));
  cpSync(licence, join(racine, FICHIER_LICENCE));
  const fichierNotice = join(base, FICHIER_NOTICE);
  if (!existsSync(fichierNotice)) throw new Error(`Notice de la licence absente : ${FICHIER_NOTICE}`);
  const texteNotice = readFileSync(fichierNotice, 'utf8');
  writeFileSync(join(app, FICHIER_NOTICE), texteNotice);
  writeFileSync(join(racine, FICHIER_NOTICE), cible.startsWith('win') ? texteNotice.replace(/\r?\n/g, '\r\n') : texteNotice);
  for (const d of DEPENDANCES) {
    const src = join(base, 'node_modules', d);
    if (!existsSync(src)) throw new Error(`Dépendance absente : ${d} (lancez npm ci)`);
    cpSync(src, join(app, 'node_modules', d), { recursive: true, filter: filtre });
  }
  writeFileSync(join(app, 'package.json'), `${JSON.stringify({ name: 'living-business', version, private: true, license: IDENTIFIANT_LICENCE, type: 'module', ...(nexus ? { nexus } : {}) }, null, 2)}\n`);
  if (node) {
    // Mac : Contents/MacOS/node, emplacement de code imbriqué accepté par codesign (sa signature d'origine reste intacte)
    const exe = mac ? join(dossier, APPLICATION_MAC, 'Contents', 'MacOS', 'node') : join(app, cible.startsWith('win') ? 'node.exe' : 'node');
    mkdirSync(dirname(exe), { recursive: true });
    cpSync(node.binaire, exe);
    chmodSync(exe, 0o755);
    cpSync(node.licence, join(app, 'LICENCE-NODE.txt'));
  }
  for (const [f, { contenu, executable }] of Object.entries(lanceurs(cible))) {
    writeFileSync(join(dossier, f), contenu, { mode: executable ? 0o755 : 0o644 });
  }
  writeFileSync(join(racine, 'LISEZMOI.txt'), notice(cible, version, node?.version ?? '(non inclus)', nexus));
  if (options.sbomNpm) writeFileSync(join(app, 'SBOM.cdx.json'), sbomPaquet(options.sbomNpm, version, cible, node, base));
  // clé publique de l'éditeur : affichée par le jeu (Réglages → Mettre en ligne) pour vérifier le script avant de le lancer
  const fichierSignataires = join(base, 'deploiement', 'signataires-editeur');
  const signataires = lireSignataires(existsSync(fichierSignataires) ? readFileSync(fichierSignataires, 'utf8') : '');
  mkdirSync(join(app, 'deploiement'), { recursive: true });
  if (existsSync(fichierSignataires)) cpSync(fichierSignataires, join(app, 'deploiement', 'signataires-editeur'));
  // installation sur le serveur de l'entreprise : le modèle voyage aussi avec le paquet, adresse de Breizhcosystem et clé de
  // l'éditeur préréglées si elles sont connues ; il ne fait que récupérer la publication signée et la vérifier
  // (pas dans l'application Mac : le jeu donne la commande qui le télécharge depuis Breizhcosystem, sur le serveur)
  const installateur = join(base, 'deploiement', 'installer-jeu.sh');
  if (!mac && existsSync(installateur)) {
    let script = readFileSync(installateur, 'utf8');
    if (nexus) script = script.replaceAll('__NEXUS_ORIGINE__', nexus);
    if (signataires.length) script = script.replace(/^SIGNATAIRES='__SIGNATAIRES__'$/m, () => `SIGNATAIRES='${signataires.join('\n')}'`);
    writeFileSync(join(dossier, 'installer-jeu.sh'), script, { mode: 0o755 });
  }
  if (mac) applicationMac(join(dossier, APPLICATION_MAC), base, version, node ? macosMinimum(node.binaire) : null, options.applet ?? process.platform === 'darwin');
  return dossier;
}

// ---------------------------------------------------------------- application Mac (Living Business.app)

export const APPLICATION_MAC = 'Living Business.app';
/** macOS minimum quand le Node.js embarqué n'est pas connu (essais sans Node.js). */
const MACOS_PAR_DEFAUT = '11.0';

/**
 * Version minimale de macOS inscrite dans un binaire Mach-O (LC_BUILD_VERSION, sinon LC_VERSION_MIN_MACOSX), la plus
 * exigeante de ses architectures, ex. « 13.5 ». Lue dans les en-têtes, sans outil d'Apple.
 */
export function macosMinimum(fichier: string): string {
  const fd = openSync(fichier, 'r');
  try {
    const lire = (position: number, taille: number) => {
      const b = Buffer.alloc(taille);
      readSync(fd, b, 0, taille, position);
      return b;
    };
    const versions: number[] = [];
    const tranche = (debut: number) => {
      const entete = lire(debut, 32);
      const magique = entete.readUInt32LE(0);
      if (magique !== 0xfeedfacf && magique !== 0xfeedface) throw new Error(`${fichier} : binaire Mach-O attendu`);
      const nombre = entete.readUInt32LE(16);
      const commandes = lire(debut + (magique === 0xfeedfacf ? 32 : 28), entete.readUInt32LE(20));
      for (let i = 0, p = 0; i < nombre && p + 8 <= commandes.length; i++) {
        const cmd = commandes.readUInt32LE(p);
        if (cmd === 0x32 /* LC_BUILD_VERSION */ && commandes.readUInt32LE(p + 8) === 1 /* PLATFORM_MACOS */) versions.push(commandes.readUInt32LE(p + 12));
        if (cmd === 0x24 /* LC_VERSION_MIN_MACOSX */) versions.push(commandes.readUInt32LE(p + 8));
        p += commandes.readUInt32LE(p + 4);
      }
    };
    const debut = lire(0, 8);
    if (debut.readUInt32BE(0) === 0xcafebabe) {
      const n = debut.readUInt32BE(4);
      const table = lire(8, 20 * n);
      for (let i = 0; i < n; i++) tranche(table.readUInt32BE(20 * i + 8));
    } else tranche(0);
    if (!versions.length) throw new Error(`${fichier} : version minimale de macOS introuvable`);
    const v = Math.max(...versions);
    const [x, y, z] = [v >>> 16, (v >> 8) & 0xff, v & 0xff];
    return z ? `${x}.${y}.${z}` : `${x}.${y}`;
  } finally {
    closeSync(fd);
  }
}

const echapperXml = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Info.plist de l'application : identifiant = étiquette de l'agent de lancement au démarrage (demarrage.ts). */
export function infoPlist(version: string, macos: string): string {
  const cles: [string, string | boolean][] = [
    ['CFBundleAllowMixedLocalizations', true],
    ['CFBundleDevelopmentRegion', 'fr'],
    ['CFBundleDisplayName', 'Living Business'],
    ['CFBundleExecutable', 'applet'],
    ['CFBundleIconFile', 'living-business'],
    ['CFBundleIdentifier', ETIQUETTE],
    ['CFBundleInfoDictionaryVersion', '6.0'],
    ['CFBundleName', 'Living Business'],
    ['CFBundlePackageType', 'APPL'],
    ['CFBundleShortVersionString', version],
    ['CFBundleSignature', 'aplt'],
    ['CFBundleVersion', version],
    ['LSApplicationCategoryType', 'public.app-category.business'],
    ['LSMinimumSystemVersion', macos],
    ['LSRequiresCarbon', true],
    ['NSHighResolutionCapable', true],
    ['NSHumanReadableCopyright', `© ${new Date().getUTCFullYear()} Breizhcosystem. Living Business est un logiciel libre, sous licence GNU AGPL version 3 (${IDENTIFIANT_LICENCE}).`],
    ['OSAAppletShowStartupScreen', false],
    ['OSAAppletStayOpen', true],
  ];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    ...cles.map(([k, v]) => `\t<key>${k}</key>\n\t${typeof v === 'boolean' ? (v ? '<true/>' : '<false/>') : `<string>${echapperXml(v)}</string>`}`),
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/**
 * Habille Contents/ : Info.plist, PkgInfo, icône, puis (sur un Mac) l'applet compilée par osacompile — exécutable
 * principal et script — et la signature ad hoc. Ailleurs, la structure seule (essais).
 */
function applicationMac(appli: string, base: string, version: string, macos: string | null, applet: boolean): void {
  const contenu = join(appli, 'Contents');
  mkdirSync(join(contenu, 'MacOS'), { recursive: true });
  writeFileSync(join(contenu, 'Info.plist'), infoPlist(version, macos ?? MACOS_PAR_DEFAUT));
  writeFileSync(join(contenu, 'PkgInfo'), 'APPLaplt');
  cpSync(join(base, 'paquets', 'mac', 'living-business.icns'), join(contenu, 'Resources', 'living-business.icns'));
  if (!applet) return;
  const travail = mkdtempSync(join(tmpdir(), 'lb-applet-'));
  try {
    const compilee = join(travail, 'applet.app', 'Contents');
    execFileSync('osacompile', ['-s', '-o', join(travail, 'applet.app'), join(base, 'paquets', 'mac', 'application.applescript')], { stdio: ['ignore', 'ignore', 'pipe'] });
    cpSync(join(compilee, 'MacOS', 'applet'), join(contenu, 'MacOS', 'applet'));
    chmodSync(join(contenu, 'MacOS', 'applet'), 0o755);
    cpSync(join(compilee, 'Resources', 'Scripts'), join(contenu, 'Resources', 'Scripts'), { recursive: true });
    cpSync(join(compilee, 'Resources', 'applet.rsrc'), join(contenu, 'Resources', 'applet.rsrc'));
  } finally {
    rmSync(travail, { recursive: true, force: true });
  }
  signerApplicationMac(appli);
}

/**
 * Signature de l'application Mac, seul endroit où elle se fait : ad hoc (`codesign --sign -`), sans identité.
 * Sans --deep, pour garder intacte la signature des publieurs de Node.js sur Contents/MacOS/node (code imbriqué, scellé
 * tel quel). Signature Developer ID et notarisation : voir docs/conformite/SECURITE.md (sur le Mac de l'éditeur).
 */
export function signerApplicationMac(appli: string): void {
  execFileSync('codesign', ['--force', '--sign', '-', appli], { stdio: ['ignore', 'ignore', 'pipe'] });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appli], { stdio: ['ignore', 'ignore', 'pipe'] });
}

// ---------------------------------------------------------------- Node.js officiel, vérifié

const sha256 = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

async function telecharger(url: string, vers: string): Promise<void> {
  const r = await fetch(url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`Téléchargement impossible (${r.status}) : ${url}`);
  writeFileSync(vers, Buffer.from(await r.arrayBuffer()));
}

export async function resoudreVersion(): Promise<string> {
  if (process.env.LB_NODE_VERSION) {
    if (!/^v\d+\.\d+\.\d+$/.test(process.env.LB_NODE_VERSION)) throw new Error('LB_NODE_VERSION : vXX.YY.ZZ attendu');
    return process.env.LB_NODE_VERSION;
  }
  const majeur = process.env.LB_NODE_MAJEUR ?? '24';
  const r = await fetch('https://nodejs.org/dist/index.json');
  const liste = (await r.json()) as { version: string; lts: string | false }[];
  const v = liste.find((x) => x.version.startsWith(`v${majeur}.`) && x.lts);
  if (!v) throw new Error(`Aucune version LTS de Node.js ${majeur} trouvée.`);
  return v.version;
}

/** Clés des publieurs de Node.js épinglées dans le dépôt (seules acceptées pour signer SHASUMS256.txt). */
export const CLES_NODE = join(RACINE, 'scripts', 'node-cles-publication.asc');

export interface OptionsNode {
  /** Adresse des publications (essais) ; défaut : https://nodejs.org/dist/ */
  origine?: string;
  /** Clés acceptées ; défaut : celles de scripts/node-cles-publication.asc */
  cles?: readonly ClePublique[];
}

/**
 * SHASUMS256.txt de la version, signé par un publieur épinglé. Le cache (dist/cache) n'est qu'un raccourci : sa
 * signature est revérifiée à chaque appel, et un cache qui ne se vérifie plus est retéléchargé une fois.
 */
async function sommesSignees(base: string, versionNode: string, cache: string, cles: readonly ClePublique[]): Promise<string> {
  const sommes = join(cache, `SHASUMS256-${versionNode}.txt`);
  const sig = `${sommes}.sig`;
  /** Texte vérifié (les octets lus sont ceux dont la signature a été contrôlée), sinon la raison du refus. */
  const verifier = (): { texte: string } | { raison: string } => {
    if (!existsSync(sommes) || !existsSync(sig)) return { raison: 'absent' };
    const octets = readFileSync(sommes);
    const r = verifierSignatureDetachee(octets, readFileSync(sig), cles);
    if (!r.valide) return { raison: r.raison ?? 'signature invalide' };
    console.log(`  Node.js ${versionNode} : SHASUMS256.txt signé par ${r.signataire}`);
    return { texte: octets.toString('utf8') };
  };
  let r = verifier();
  if (!('texte' in r)) {
    try {
      await telecharger(`${base}SHASUMS256.txt`, sommes);
      await telecharger(`${base}SHASUMS256.txt.sig`, sig);
      r = verifier();
    } catch (e) { r = { raison: e instanceof Error ? e.message : String(e) }; }
  }
  if (!('texte' in r)) {
    rmSync(sommes, { force: true });
    rmSync(sig, { force: true });
    throw new Error(`SHASUMS256.txt de Node.js ${versionNode} : signature des publieurs de Node.js invalide (${r.raison}). Fabrication refusée.`);
  }
  return r.texte;
}

export async function nodeOfficiel(versionNode: string, cible: Cible, cache: string, options: OptionsNode = {}): Promise<NodeExtrait> {
  if (!/^v\d+\.\d+\.\d+$/.test(versionNode)) throw new Error(`Version de Node.js invalide : ${versionNode}`);
  mkdirSync(cache, { recursive: true });
  const base = `${options.origine ?? 'https://nodejs.org/dist/'}${versionNode}/`;
  const cles = options.cles ?? lireCles(readFileSync(CLES_NODE, 'utf8'));
  if (!cles.length) throw new Error(`Aucune clé de publieur de Node.js lisible dans ${CLES_NODE}.`);
  const texte = await sommesSignees(base, versionNode, cache, cles);
  const archive = `node-${versionNode}-${cible}.${cible.startsWith('win') ? 'zip' : 'tar.gz'}`;
  const attendu = texte.split('\n').find((l) => l.trim().endsWith(`  ${archive}`))?.split(/\s+/)[0];
  if (!attendu || !/^[0-9a-f]{64}$/.test(attendu)) throw new Error(`Empreinte introuvable pour ${archive}`);
  const fichier = join(cache, archive);
  if (!existsSync(fichier) || sha256(fichier) !== attendu) await telecharger(base + archive, fichier);
  const obtenu = sha256(fichier);
  if (obtenu !== attendu) { rmSync(fichier, { force: true }); throw new Error(`Empreinte SHA-256 incorrecte pour ${archive} : refusé.`); }
  const extrait = join(cache, `node-${versionNode}-${cible}`);
  rmSync(extrait, { recursive: true, force: true });
  mkdirSync(extrait, { recursive: true });
  const racine = `node-${versionNode}-${cible}`;
  if (cible.startsWith('win')) {
    execFileSync('unzip', ['-q', '-o', fichier, `${racine}/node.exe`, `${racine}/LICENSE`, '-d', extrait]);
  } else {
    execFileSync('tar', ['-xzf', fichier, '-C', extrait, `${racine}/bin/node`, `${racine}/LICENSE`]);
  }
  const binaire = join(extrait, racine, cible.startsWith('win') ? 'node.exe' : 'bin/node');
  return { binaire, licence: join(extrait, racine, 'LICENSE'), version: versionNode, archive: { url: base + archive, sha256: attendu } };
}

// ---------------------------------------------------------------- nomenclature logicielle (SBOM, CycloneDX)

/** Nomenclature CycloneDX des dépendances d'exécution, tirée du verrou par npm (sans réseau ni installation). */
export function sbomDependances(racine: string): string {
  return execFileSync('npm', ['sbom', '--sbom-format', 'cyclonedx', '--omit', 'dev', '--package-lock-only'], { cwd: racine, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16e6 });
}

/** Composants embarqués hors npm (voir LICENCES-TIERS.md) : empreinte du fichier réellement livré. */
const EMBARQUES: readonly { nom: string; version: (base: string) => string; licence: { id: string } | { expression: string }; fichier: string; site: string }[] = [
  { nom: 'Inter', version: () => '4.1', licence: { id: 'OFL-1.1' }, fichier: 'web/polices/inter-fr-4.1.woff2', site: 'https://github.com/rsms/inter' },
  { nom: 'Fraunces', version: () => '1.000', licence: { id: 'OFL-1.1' }, fichier: 'web/polices/fraunces-fr-titre.woff2', site: 'https://github.com/undercasetype/Fraunces' },
  { nom: 'Atkinson Hyperlegible Next', version: () => '2.001', licence: { id: 'OFL-1.1' }, fichier: 'web/polices/atkinson-next-2.001.woff2', site: 'https://github.com/googlefonts/atkinson-hyperlegible-next' },
  {
    nom: 'Lucide', licence: { expression: 'ISC AND MIT' }, fichier: 'web/bz/icones.svg', site: 'https://lucide.dev',
    version: (base) => (JSON.parse(readFileSync(join(base, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> }).devDependencies?.['lucide-static'] ?? 'inconnue',
  },
];

/**
 * Nomenclature du paquet d'une cible (préparation de l'annexe I du règlement (UE) 2024/2847, « CRA ») : celle de npm,
 * produit renommé « living-business » (application), plus le Node.js embarqué (archive officielle et son SHA-256) et
 * les polices et icônes livrées (SHA-256 du fichier).
 */
export function sbomPaquet(sbomNpm: string, version: string, cible: Cible, node: NodeExtrait | null, base = RACINE): string {
  type Composant = Record<string, unknown> & { 'bom-ref': string };
  const bom = JSON.parse(sbomNpm) as { metadata?: { component?: Composant } & Record<string, unknown>; components?: Composant[]; dependencies?: { ref: string; dependsOn?: string[] }[] } & Record<string, unknown>;
  const ref = `living-business@${version}`;
  const ancien = bom.metadata?.component?.['bom-ref'];
  bom.metadata = {
    ...bom.metadata,
    component: {
      'bom-ref': ref, type: 'application', name: 'living-business', version,
      description: 'Living Business par Breizhcosystem (paquet téléchargeable)',
      licenses: [{ license: { id: IDENTIFIANT_LICENCE } }],
      externalReferences: [{ type: 'vcs', url: CODE_SOURCE, comment: 'Code source complet (logiciel libre, GNU AGPL version 3)' }],
      properties: [{ name: 'living-business:cible', value: cible }],
    },
  };
  const ajouts: Composant[] = [];
  if (node) {
    const v = node.version.replace(/^v/, '');
    ajouts.push({
      'bom-ref': `node@${v}`, type: 'platform', name: 'node', version: v,
      description: 'Node.js officiel (seuls le binaire node et sa licence sont gardés)',
      licenses: [{ license: { id: 'MIT' } }],
      ...(node.archive ? {
        purl: `pkg:generic/node@${v}?download_url=${encodeURIComponent(node.archive.url)}`,
        hashes: [{ alg: 'SHA-256', content: node.archive.sha256 }],
        externalReferences: [{ type: 'distribution', url: node.archive.url, comment: 'SHA-256 de l’archive, vérifié contre SHASUMS256.txt signé par un publieur de Node.js épinglé' }],
      } : {}),
    });
  }
  for (const e of EMBARQUES) {
    const v = e.version(base);
    ajouts.push({
      'bom-ref': `${e.nom}@${v}`, type: 'file', name: e.nom, version: v, licenses: ['id' in e.licence ? { license: e.licence } : e.licence],
      hashes: [{ alg: 'SHA-256', content: sha256(join(base, e.fichier)) }],
      properties: [{ name: 'living-business:fichier', value: `app/${e.fichier}` }],
      externalReferences: [{ type: 'website', url: e.site }],
    });
  }
  bom.components = [...(bom.components ?? []), ...ajouts];
  const deps = (bom.dependencies ?? []).map((d) => (d.ref === ancien ? { ...d, ref } : d));
  const racineDeps = deps.find((d) => d.ref === ref) ?? (deps.push({ ref, dependsOn: [] }), deps[deps.length - 1]!);
  racineDeps.dependsOn = [...(racineDeps.dependsOn ?? []), ...ajouts.map((c) => c['bom-ref'])];
  for (const c of ajouts) deps.push({ ref: c['bom-ref'], dependsOn: [] });
  bom.dependencies = deps;
  return `${JSON.stringify(bom, null, 2)}\n`;
}

export function compresser(cible: Cible, dossier: string): string {
  const zip = `${dossier}.zip`;
  rmSync(zip, { force: true });
  if (systeme(cible) === 'mac') {
    // l'application seule à la racine du zip (l'utilitaire d'archive la pose telle quelle), sans métadonnées du poste
    execFileSync('ditto', ['-c', '-k', '--norsrc', '--noextattr', '--noqtn', '--noacl', '--keepParent', APPLICATION_MAC, zip], { cwd: dossier });
  } else {
    execFileSync('zip', ['-qry', basename(zip), basename(dossier)], { cwd: resolve(dossier, '..') });
  }
  return zip;
}

// ---------------------------------------------------------------- ligne de commande

/** Cibles demandées, adresse de Breizhcosystem (`--nexus https://…` ou `--nexus=…`, sinon LB_NEXUS_URL ; vide = aucune), essai. */
export function lireArguments(args: readonly string[], env: NodeJS.ProcessEnv = process.env): { cibles: Cible[]; nexus: string | null; essai: boolean } {
  const cibles: Cible[] = [];
  let nexus: string | undefined = env.LB_NEXUS_URL ? env.LB_NEXUS_URL : undefined;
  let essai = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === '--essai') { essai = true; continue; }
    if (a === '--nexus') { nexus = args[++i] ?? ''; continue; }
    if (a.startsWith('--nexus=')) { nexus = a.slice('--nexus='.length); continue; }
    if (a.startsWith('-')) throw new Error(`Option inconnue : ${a} (--nexus, --essai)`);
    if (!(CIBLES as readonly string[]).includes(a)) throw new Error(`Cible inconnue : ${a} (${CIBLES.join(', ')})`);
    cibles.push(a as Cible);
  }
  const adresse = nexus === undefined ? null : adresseNexus(nexus);
  if (nexus !== undefined && !adresse) throw new Error('Adresse de Breizhcosystem (--nexus ou LB_NEXUS_URL) : https://… attendue, sans identifiants (ex. https://reseau.breizhcosystem.com).');
  return { cibles: cibles.length ? cibles : [...CIBLES], nexus: adresse, essai };
}

/** Dossier de sortie : dist/ pour une publication, dist/essai/ pour un essai (jamais pris pour une publication). */
export const dossierSortie = (essai: boolean) => (essai ? join(RACINE, 'dist', 'essai') : join(RACINE, 'dist'));

async function principal() {
  const { cibles, nexus, essai } = lireArguments(process.argv.slice(2));
  if (process.platform !== 'darwin' && cibles.some((c) => systeme(c) === 'mac')) {
    throw new Error('Paquets Mac (application Living Business.app) : à fabriquer sur un Mac (osacompile, codesign, ditto). Ailleurs : précisez win-x64 ou linux-x64.');
  }
  const version = (JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')) as { version: string }).version;
  const sortie = dossierSortie(essai);
  let racine = RACINE;
  let temporaire: string | null = null;
  let provenance: Provenance;
  if (essai) {
    let commit = '-';
    try { commit = execFileSync('git', ['-C', RACINE, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { /* pas de dépôt git */ }
    provenance = { version, commit, etiquette: '-', verrou: empreinteVerrou(RACINE), fabrication: 'essai' };
    console.log(`ESSAI depuis la copie de travail (${sortie}) : ces paquets ne seront jamais signés pour publication.`);
  } else {
    const { commit, etiquette } = controlerArbre(RACINE, version);
    temporaire = mkdtempSync(join(tmpdir(), 'lb-fabrication-'));
    racine = join(temporaire, 'source');
    console.log(`Publication ${etiquette} (commit ${commit.slice(0, 12)}) : sources exportées du commit, dépendances réinstallées depuis le verrou…`);
    exporterCommit(RACINE, commit, racine);
    installerDependances(racine);
    provenance = { version, commit, etiquette, verrou: empreinteVerrou(racine), fabrication: 'publication' };
  }
  try {
    mkdirSync(sortie, { recursive: true });
    rmSync(join(sortie, FICHIER_PROVENANCE), { force: true });
    // nomenclature des dépendances (tirée du verrou de la source fabriquée) : obligatoire pour une publication
    let sbomNpm: string | undefined;
    try { sbomNpm = sbomDependances(racine); } catch (e) {
      if (!essai) throw new Error(`Nomenclature (npm sbom) impossible : ${e instanceof Error ? e.message : e}`);
      console.warn('Essai : nomenclature (npm sbom) indisponible, paquets sans SBOM.cdx.json.');
    }
    const versionNode = await resoudreVersion();
    console.log(`Living Business ${version} · Node.js ${versionNode} · Breizhcosystem ${nexus ?? 'non préréglé'}`);
    const sommes: string[] = [];
    for (const c of cibles) {
      const node = await nodeOfficiel(versionNode, c, join(RACINE, 'dist', 'cache'));
      const dossier = assembler(c, sortie, version, node, { nexus, racine, ...(sbomNpm ? { sbomNpm } : {}) });
      const zip = compresser(c, dossier);
      rmSync(dossier, { recursive: true, force: true });
      sommes.push(`${sha256(zip)}  ${basename(zip)}`);
      console.log(`  ${basename(zip)}  ${(statSync(zip).size / 1e6).toFixed(1)} Mo`);
    }
    writeFileSync(join(sortie, 'SHA256SUMS.txt'), `${sommes.join('\n')}\n`);
    writeFileSync(join(sortie, FICHIER_PROVENANCE), ecrireProvenance(provenance));
    console.log(`Empreintes : ${join(sortie, 'SHA256SUMS.txt')} · provenance : ${join(sortie, FICHIER_PROVENANCE)}`);
  } finally {
    if (temporaire) rmSync(temporaire, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
}
