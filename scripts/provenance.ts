/**
 * Provenance des paquets : une PUBLICATION de Living Business se fabrique depuis un commit étiqueté `vX.Y.Z`, jamais
 * depuis la copie de travail telle qu'elle est sur le disque (fichier non suivi, modification non commitée, fichier
 * changé par la synchronisation iCloud depuis un autre appareil, node_modules modifié par un outil de développement).
 *
 * - arbre propre (`git status --porcelain --untracked-files=all` vide) et HEAD étiqueté `v<version de package.json>`
 *   (`npm version patch|minor` crée le commit et l'étiquette) ;
 * - sources exportées du commit (`git archive`) dans un dossier temporaire, hors du dossier de travail ;
 * - dépendances d'exécution réinstallées depuis le verrou dans ce dossier (`npm ci --omit=dev --ignore-scripts` :
 *   intégrité de chaque archive vérifiée par npm) : le node_modules du poste n'entre jamais dans un paquet ;
 * - `PROVENANCE.txt` à côté des paquets (version, commit, étiquette, empreinte du verrou). scripts/signer-publication.ts
 *   ne signe que des paquets fabriqués depuis le commit où il est lui-même lancé (arbre propre, même étiquette).
 *
 * Essai (`--essai`) : depuis la copie de travail, dans dist/essai/, marqué « essai » : jamais signé pour publication.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const FICHIER_PROVENANCE = 'PROVENANCE.txt';

export interface Provenance {
  version: string;
  /** Commit fabriqué (40 caractères hexadécimaux) ; essai : HEAD au moment de l'essai, ou « - ». */
  commit: string;
  /** Étiquette `vX.Y.Z` ; essai : « - ». */
  etiquette: string;
  /** SHA-256 de package-lock.json utilisé. */
  verrou: string;
  fabrication: 'publication' | 'essai';
}

const git = (racine: string, ...args: string[]) =>
  execFileSync('git', ['-C', racine, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd(); // « XY chemin » : l'espace de tête compte

/**
 * Contrôles avant une fabrication ou une signature de publication : arbre propre, HEAD étiqueté `v<version>`.
 * Renvoie le commit et l'étiquette ; lève une erreur qui dit quoi faire sinon.
 */
export function controlerArbre(racine: string, version: string): { commit: string; etiquette: string } {
  let statut: string;
  try { statut = git(racine, 'status', '--porcelain', '--untracked-files=all'); } catch {
    throw new Error(`${racine} n'est pas un dépôt git lisible : une publication se fabrique depuis un commit.`);
  }
  if (statut) {
    const lignes = statut.split('\n');
    throw new Error(`Copie de travail modifiée (${lignes.length} fichier${lignes.length > 1 ? 's' : ''} : ${lignes.slice(0, 5).map((l) => l.slice(3)).join(', ')}${lignes.length > 5 ? '…' : ''}). Une publication se fabrique depuis un commit : commitez ou retirez ces fichiers (git status). Essai sans publication : --essai.`);
  }
  const commit = git(racine, 'rev-parse', 'HEAD');
  const etiquette = `v${version}`;
  const etiquettes = git(racine, 'tag', '--points-at', 'HEAD').split('\n').filter(Boolean);
  if (!etiquettes.includes(etiquette)) {
    throw new Error(`Le commit ${commit.slice(0, 12)} n'est pas étiqueté ${etiquette} (version de package.json) : « npm version patch » (ou minor) crée le commit et l'étiquette. Essai sans publication : --essai.`);
  }
  return { commit, etiquette };
}

/** Exporte le contenu exact du commit (rien de la copie de travail) dans `vers` (créé, vidé s'il existait). */
export function exporterCommit(racine: string, commit: string, vers: string): void {
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error(`Commit invalide : ${commit}`);
  rmSync(vers, { recursive: true, force: true });
  mkdirSync(vers, { recursive: true });
  const archive = `${vers}.tar`;
  try {
    execFileSync('git', ['-C', racine, 'archive', '--format=tar', '-o', archive, commit], { stdio: ['ignore', 'ignore', 'pipe'] });
    execFileSync('tar', ['-xf', archive, '-C', vers], { stdio: ['ignore', 'ignore', 'pipe'] });
  } finally { rmSync(archive, { force: true }); }
}

/** Dépendances d'exécution réinstallées depuis le verrou (intégrité vérifiée par npm), sans script d'installation. */
export function installerDependances(dossier: string): void {
  execFileSync('npm', ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: dossier, stdio: ['ignore', 'inherit', 'inherit'] });
}

export const empreinteVerrou = (dossier: string) => createHash('sha256').update(readFileSync(join(dossier, 'package-lock.json'))).digest('hex');

export function ecrireProvenance(p: Provenance): string {
  return [
    `# Provenance des paquets de Living Business (scripts/paquets.ts)${p.fabrication === 'essai' ? ' — ESSAI : ne jamais publier' : ''}`,
    `version ${p.version}`,
    `commit ${p.commit}`,
    `etiquette ${p.etiquette}`,
    `verrou ${p.verrou}`,
    `fabrication ${p.fabrication}`,
    '',
  ].join('\n');
}

export function lireProvenance(texte: string): Provenance {
  const champs = new Map<string, string>();
  for (const l of texte.split('\n')) {
    const m = /^([a-z]+) (\S+)$/.exec(l.trim());
    if (m) champs.set(m[1] as string, m[2] as string);
  }
  const fabrication = champs.get('fabrication');
  const p = {
    version: champs.get('version') ?? '',
    commit: champs.get('commit') ?? '',
    etiquette: champs.get('etiquette') ?? '',
    verrou: champs.get('verrou') ?? '',
    fabrication: fabrication === 'publication' || fabrication === 'essai' ? fabrication : null,
  };
  if (!p.fabrication || !/^\d+\.\d+\.\d+$/.test(p.version)) throw new Error(`${FICHIER_PROVENANCE} illisible.`);
  return p as Provenance;
}

/**
 * Paquets acceptés pour une publication signée : fabriqués en mode publication, depuis `commit` (celui où l'on signe),
 * étiqueté `v<version>`. Sinon une erreur qui dit pourquoi.
 */
export function verifierProvenance(texte: string | null, version: string, commit: string): Provenance {
  if (texte === null) throw new Error(`${FICHIER_PROVENANCE} absent : ces paquets ne viennent pas de « npm run paquets » sur un commit étiqueté (ni de la CI sur un tag). Rien n'est signé.`);
  const p = lireProvenance(texte);
  if (p.fabrication !== 'publication') throw new Error('Paquets d’ESSAI (--essai, copie de travail) : jamais signés pour publication.');
  if (p.version !== version || p.etiquette !== `v${version}`) throw new Error(`Paquets de la version ${p.version} (${p.etiquette}), pas de ${version} : rien n'est signé.`);
  if (p.commit !== commit) throw new Error(`Paquets fabriqués depuis le commit ${p.commit.slice(0, 12)}, pas depuis ${commit.slice(0, 12)} (celui où l'on signe) : rien n'est signé.`);
  if (!/^[0-9a-f]{64}$/.test(p.verrou)) throw new Error(`${FICHIER_PROVENANCE} : empreinte du verrou absente.`);
  return p;
}
