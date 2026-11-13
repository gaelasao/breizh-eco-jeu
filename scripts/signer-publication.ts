/**
 * Signe une publication de Living Business, SUR LE POSTE DE L'ÉDITEUR (jamais sur Breizhcosystem ni dans la CI) :
 *
 *   node scripts/signer-publication.ts --nexus https://reseau.example --cle ~/.ssh/living-business-signature \
 *        [--paquets dossier] [--signataires deploiement/signataires-editeur] [--sortie publication]
 *
 * - `--paquets` : les zips, leur SHA256SUMS.txt et PROVENANCE.txt, de préférence ceux de la version GitHub construite
 *   par la CI sur le tag (`gh release download vX.Y.Z -D …`) ; chaque zip est revérifié contre SHA256SUMS.txt, tous
 *   doivent être de la version de package.json, le paquet Linux est obligatoire. Défaut : dist/.
 * - Provenance (scripts/provenance.ts) : la copie de travail où l'on signe doit être propre et sur le commit étiqueté
 *   vX.Y.Z (c'est SON installer-jeu.sh qui est signé), et PROVENANCE.txt doit dire que les paquets ont été fabriqués
 *   depuis ce même commit, en mode publication. Paquets d'essai (`npm run paquets -- --essai`) : refusés.
 * - `--essai` (CI, clé jetable seulement) : sans ces contrôles, et sans toucher au registre des publications.
 * - `--cle` : clé privée SSH de l'éditeur, idéalement sur clé matérielle (ed25519-sk) ; sa clé publique doit figurer
 *   dans le fichier des signataires (deploiement/signataires-editeur), sinon rien n'est signé.
 * - Résultat dans publication/<version>/ : `deploiement/installer-jeu.sh` (version, paquet Linux, empreinte, clé
 *   publique et adresse de Breizhcosystem inscrites, puis signature sur la dernière ligne) et `dist/` (zips, SHA256SUMS.txt et
 *   SHA256SUMS.txt.sig). Deux signatures au total (deux contacts sur la clé matérielle).
 *
 * Le serveur de l'entreprise exécute le script seulement si la signature se vérifie (voir le bloc « vérification des
 * publications » de deploiement/installer-jeu.sh), puis n'installe que le paquet dont l'empreinte est signée.
 * Publication sur Breizhcosystem : l'éditeur y dépose le dossier publication/<version>/dist (outil hors de ce dépôt).
 * Un numéro de version ne sert qu'une fois : `deploiement/publications-signees.txt` garde le paquet Linux signé pour
 * chaque numéro ; un autre paquet sous un numéro déjà publié, ou un numéro plus ancien, est refusé.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adresseNexus } from '../src/passerelle/bureau.ts';
import { controlerArbre, FICHIER_PROVENANCE, verifierProvenance } from './provenance.ts';

const RACINE = fileURLToPath(new URL('../', import.meta.url));
export const INSTALLATEUR = join(RACINE, 'deploiement', 'installer-jeu.sh');
export const REGISTRE = join(RACINE, 'deploiement', 'publications-signees.txt');
export const SIGNATAIRES_EDITEUR = join(RACINE, 'deploiement', 'signataires-editeur');
export const IDENTITE = 'editeur-living-business';
export const ESPACE_INSTALLATEUR = 'living-business-installateur';
export const ESPACE_PAQUET = 'living-business-paquet';
const PREFIXE_SIGNATURE = '# signature-living-business: ';
const LIGNE_SIGNATAIRE = /^editeur-living-business namespaces="([a-z,-]+)" (ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp256|sk-ecdsa-sha2-nistp256@openssh\.com) ([A-Za-z0-9+/]+={0,2})(?: [A-Za-z0-9._@-]+)?$/;
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Lignes de clés du fichier des signataires (commentaires ignorés) ; une ligne mal formée est refusée. */
export function lireSignataires(texte: string): string[] {
  const lignes = texte.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const l of lignes) {
    const m = LIGNE_SIGNATAIRE.exec(l);
    if (!m) throw new Error(`Ligne de signataire invalide : ${l.slice(0, 80)}`);
    if (!(m[1] as string).split(',').includes(ESPACE_INSTALLATEUR)) throw new Error(`La clé doit autoriser l'espace de noms ${ESPACE_INSTALLATEUR}.`);
  }
  return lignes;
}

const LIGNE_REGISTRE = /^(\d{1,4}\.\d{1,4}\.\d{1,4}) ([0-9a-f]{64}) (\d{4}-\d{2}-\d{2})$/;
const comparerVersions = (a: string, b: string) => {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  return 0;
};

/** Lignes « version empreinte-du-paquet-Linux jour » du registre (commentaires ignorés) ; mal formées : refusées. */
export function lireRegistre(texte: string): { version: string; sha256: string; jour: string }[] {
  return texte.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => {
    const m = LIGNE_REGISTRE.exec(l);
    if (!m) throw new Error(`Ligne invalide dans publications-signees.txt : ${l.slice(0, 100)}`);
    return { version: m[1] as string, sha256: m[2] as string, jour: m[3] as string };
  });
}

/**
 * Registre des publications signées (versionné dans le dépôt) : UN numéro = UN seul paquet, numéros croissants. Un
 * paquet corrigé republié sous le même numéro serait ignoré par les serveurs déjà à ce numéro (et invisible) : refusé.
 * Même numéro et même paquet : nouvelle signature permise (autre adresse de Breizhcosystem, nouvelle clé). Renvoie le
 * registre complété.
 */
export function inscrirePublication(registre: string, version: string, sha256: string, jour: string): string {
  const entrees = lireRegistre(registre);
  const meme = entrees.find((e) => e.version === version);
  if (meme && meme.sha256 !== sha256) throw new Error(`La version ${version} a déjà été publiée avec un autre paquet Linux : changez le numéro dans package.json (npm version patch) avant de signer.`);
  if (meme) return registre;
  const derniere = entrees.map((e) => e.version).sort(comparerVersions).at(-1);
  if (derniere && comparerVersions(version, derniere) < 0) throw new Error(`Version ${version} plus ancienne que la dernière publiée (${derniere}) : refusé.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(jour) || !/^[0-9a-f]{64}$/.test(sha256)) throw new Error('Jour ou empreinte invalide.');
  return `${registre.replace(/\n*$/, registre ? '\n' : '')}${version} ${sha256} ${jour}\n`;
}

export interface Publication {
  nexus: string;
  version: string;
  paquet: string;
  sha256: string;
  signataires: readonly string[];
}

/**
 * Remplit le modèle d'installateur (lignes exactes, jamais un remplacement global des marqueurs). Aucun marqueur ne
 * doit rester : en particulier `__NEXUS_ORIGINE__`, que Breizhcosystem remplacerait en servant le script (signature cassée).
 */
export function preparerInstallateur(modele: string, p: Publication): string {
  const nexus = adresseNexus(p.nexus);
  if (!nexus) throw new Error('Adresse de Breizhcosystem : https://… attendue (ex. https://reseau.breizhcosystem.com).');
  if (!VERSION.test(p.version)) throw new Error(`Version invalide : ${p.version}`);
  if (p.paquet !== `living-business-${p.version}-linux-x64.zip`) throw new Error(`Paquet Linux attendu : living-business-${p.version}-linux-x64.zip`);
  if (!/^[0-9a-f]{64}$/.test(p.sha256)) throw new Error('Empreinte SHA-256 invalide.');
  if (!p.signataires.length) throw new Error('Aucune clé de signataire : ajoutez la clé publique de l’éditeur dans deploiement/signataires-editeur.');
  lireSignataires(p.signataires.join('\n'));
  if (modele.split('\n').some((l) => l.startsWith(PREFIXE_SIGNATURE))) throw new Error('Le modèle est déjà signé.');
  let t = modele;
  const remplir = (variable: string, valeur: string) => {
    const ligne = `${variable}='__${variable}__'`;
    const lignes = t.split('\n');
    const i = lignes.indexOf(ligne);
    if (i < 0 || lignes.indexOf(ligne, i + 1) >= 0) throw new Error(`Ligne « ${ligne} » introuvable ou en double dans le modèle.`);
    lignes[i] = `${variable}='${valeur}'`;
    t = lignes.join('\n');
  };
  remplir('PUBLIE_VERSION', p.version);
  remplir('PUBLIE_PAQUET', p.paquet);
  remplir('PUBLIE_SHA256', p.sha256);
  remplir('SIGNATAIRES', p.signataires.join('\n'));
  t = t.replaceAll('__NEXUS_ORIGINE__', nexus);
  const reste = /__(?:PUBLIE_[A-Z0-9]+|SIGNATAIRES|NEXUS_ORIGINE)__/.exec(t);
  if (reste) throw new Error(`Marqueur non rempli : ${reste[0]}`);
  return t.endsWith('\n') ? t : `${t}\n`;
}

/** Ajoute la signature (armure `ssh-keygen -Y sign`) en dernière ligne, encodée en base64 sur une seule ligne. */
export function ajouterSignature(texte: string, armure: string): string {
  const a = armure.replace(/\r\n/g, '\n').trim();
  if (!/^-----BEGIN SSH SIGNATURE-----\n[A-Za-z0-9+/=\n]+\n-----END SSH SIGNATURE-----$/.test(a)) throw new Error('Signature SSH inattendue.');
  if (!texte.endsWith('\n')) throw new Error('Le texte signé doit finir par un saut de ligne.');
  return `${texte}${PREFIXE_SIGNATURE}${Buffer.from(`${a}\n`).toString('base64')}\n`;
}

/** Bloc des fonctions de vérification de l'installateur (celui qu'exécutent les serveurs des entreprises). */
export function blocVerification(script = readFileSync(INSTALLATEUR, 'utf8')): string {
  const debut = script.indexOf('# >>> vérification des publications');
  const fin = script.indexOf('# <<< vérification des publications');
  if (debut < 0 || fin < debut) throw new Error('Bloc « vérification des publications » introuvable dans installer-jeu.sh.');
  return script.slice(debut, fin);
}

/** Vérifie un script signé exactement comme le fera le serveur (bash + ssh-keygen -Y verify). */
export function verifierCommeLeServeur(scriptSigne: string, signataires: readonly string[]): boolean {
  const d = mkdtempSync(join(tmpdir(), 'lb-verif-'));
  try {
    writeFileSync(join(d, 'bloc.sh'), blocVerification());
    writeFileSync(join(d, 'recu.sh'), scriptSigne);
    writeFileSync(join(d, 'signataires'), `${signataires.join('\n')}\n`);
    execFileSync('bash', ['-c', '. "$1" && verifier_script_signe "$2" "$3" "$4"', '_', join(d, 'bloc.sh'), join(d, 'recu.sh'), join(d, 'signataires'), join(d, 'verifie.sh')], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
}

const sha256 = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');

/** Zips listés dans SHA256SUMS.txt, tous recalculés, tous de `version` ; le paquet Linux est obligatoire. */
export function verifierSommes(dossier: string, version: string): { nom: string; sha256: string }[] {
  const fichier = join(dossier, 'SHA256SUMS.txt');
  if (!existsSync(fichier)) throw new Error(`SHA256SUMS.txt absent de ${dossier} (celui de la CI ou de npm run paquets).`);
  const lignes = readFileSync(fichier, 'utf8').split('\n').filter((l) => l.trim());
  const res: { nom: string; sha256: string }[] = [];
  for (const l of lignes) {
    const m = /^([0-9a-f]{64}) {2}(living-business-(\d+\.\d+\.\d+)-(?:darwin-arm64|darwin-x64|win-x64|linux-x64)\.zip)$/.exec(l);
    if (!m) throw new Error(`Ligne inattendue dans SHA256SUMS.txt : ${l.slice(0, 100)}`);
    const [, attendu, nom, v] = m as unknown as [string, string, string, string];
    if (v !== version) throw new Error(`${nom} n'est pas de la version ${version} (package.json).`);
    const chemin = join(dossier, nom);
    if (!existsSync(chemin)) throw new Error(`${nom} listé mais absent.`);
    if (sha256(chemin) !== attendu) throw new Error(`Empreinte différente de SHA256SUMS.txt pour ${nom} : refusé.`);
    res.push({ nom, sha256: attendu });
  }
  if (!res.some((p) => p.nom === `living-business-${version}-linux-x64.zip`)) throw new Error('Le paquet Linux (linux-x64) est obligatoire : il est installé par installer-jeu.sh.');
  return res;
}

/** Clé publique (type et corps) d'une clé privée SSH, pour vérifier qu'elle est bien celle des signataires. */
function clePublique(cle: string): string {
  const pub = execFileSync('ssh-keygen', ['-y', '-f', cle], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }).trim().split(/\s+/);
  return `${pub[0]} ${pub[1]}`;
}

function signer(cle: string, espace: string, contenu: string | Buffer): string {
  return execFileSync('ssh-keygen', ['-Y', 'sign', '-f', cle, '-n', espace], { input: contenu, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
}

function lireOptions(args: readonly string[]): Record<string, string> {
  const o: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
    if (!m) throw new Error(`Argument inattendu : ${a}`);
    if (m[1] === 'essai') { o.essai = '1'; continue; } // seule option sans valeur
    o[m[1] as string] = m[2] ?? (args[++i] ?? '');
  }
  return o;
}

function principal() {
  const o = lireOptions(process.argv.slice(2));
  if (!o.nexus || !o.cle) throw new Error('Usage : node scripts/signer-publication.ts --nexus https://… --cle ~/.ssh/living-business-signature [--paquets dist] [--signataires …] [--sortie publication] [--essai]');
  const version = (JSON.parse(readFileSync(join(RACINE, 'package.json'), 'utf8')) as { version: string }).version;
  const paquets = resolve(o.paquets ?? join(RACINE, 'dist'));
  const signataires = lireSignataires(readFileSync(resolve(o.signataires ?? SIGNATAIRES_EDITEUR), 'utf8'));
  if (!signataires.length) throw new Error('Aucune clé dans le fichier des signataires : générez la clé de l’éditeur (voir deploiement/signataires-editeur).');
  const cle = resolve(o.cle.replace(/^~(?=\/)/, process.env.HOME ?? '~'));
  const pub = clePublique(cle);
  if (!signataires.some((l) => l.includes(` ${pub}`))) throw new Error('Cette clé ne figure pas parmi les signataires : rien n’est signé.');
  const essai = o.essai === '1';
  if (essai) {
    console.log('ESSAI (--essai) : provenance non contrôlée, registre des publications inchangé. Jamais avec la clé de l’éditeur.');
  } else {
    const { commit } = controlerArbre(RACINE, version);
    const fichier = join(paquets, FICHIER_PROVENANCE);
    const p = verifierProvenance(existsSync(fichier) ? readFileSync(fichier, 'utf8') : null, version, commit);
    console.log(`Provenance : ${p.etiquette}, commit ${p.commit.slice(0, 12)}, verrou ${p.verrou.slice(0, 12)}.`);
  }
  const liste = verifierSommes(paquets, version);
  const linux = liste.find((p) => p.nom.endsWith('-linux-x64.zip')) as { nom: string; sha256: string };
  // Essai (CI, clé jetable) : le registre n'est ni lu ni écrit. Sinon, dès qu'une version est publiée, le paquet d'essai
  // de la CI, fabriqué sous le même numéro avec un autre contenu, serait refusé et la CI resterait rouge jusqu'au numéro
  // suivant (vu le 13 novembre 2026, après les publications 0.1.0 et 0.1.1).
  const registre = essai ? '' : inscrirePublication(existsSync(REGISTRE) ? readFileSync(REGISTRE, 'utf8') : '', version, linux.sha256, new Date().toISOString().slice(0, 10));
  const texte = preparerInstallateur(readFileSync(INSTALLATEUR, 'utf8'), { nexus: o.nexus, version, paquet: linux.nom, sha256: linux.sha256, signataires });
  console.log(`Signature de l'installateur ${version} (touchez la clé matérielle si elle clignote)…`);
  const signe = ajouterSignature(texte, signer(cle, ESPACE_INSTALLATEUR, texte));
  if (!verifierCommeLeServeur(signe, signataires)) throw new Error('La signature produite ne se vérifie pas comme sur un serveur : publication abandonnée.');
  const sortie = resolve(o.sortie ?? join(RACINE, 'publication'), version);
  rmSync(sortie, { recursive: true, force: true });
  mkdirSync(join(sortie, 'dist'), { recursive: true });
  mkdirSync(join(sortie, 'deploiement'), { recursive: true });
  for (const p of liste) cpSync(join(paquets, p.nom), join(sortie, 'dist', p.nom));
  const sommes = readFileSync(join(paquets, 'SHA256SUMS.txt'));
  writeFileSync(join(sortie, 'dist', 'SHA256SUMS.txt'), sommes);
  console.log('Signature des empreintes des paquets…');
  writeFileSync(join(sortie, 'dist', 'SHA256SUMS.txt.sig'), signer(cle, ESPACE_PAQUET, sommes));
  writeFileSync(join(sortie, 'deploiement', 'installer-jeu.sh'), signe);
  chmodSync(join(sortie, 'deploiement', 'installer-jeu.sh'), 0o755);
  console.log(`Publication signée : ${sortie}`);
  if (!essai) {
    writeFileSync(REGISTRE, registre);
    console.log('Registre des publications mis à jour : commitez deploiement/publications-signees.txt (un numéro = un seul paquet).');
  }
  console.log(`À déposer sur Breizhcosystem (outil de l'éditeur) : ${join(sortie, 'dist')}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { principal(); } catch (e) { console.error(e instanceof Error ? e.message : e); process.exit(1); }
}
