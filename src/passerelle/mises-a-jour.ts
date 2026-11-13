/**
 * Alerte « nouvelle version » pour les administrateurs (constat jeu-installation-3). Le jeu, installé chez
 * l'entreprise, n'est jamais corrigé tout seul sur un poste, et l'éditeur n'a aucun moyen de prévenir les entreprises :
 * le jeu lit donc la liste PUBLIQUE des versions sur Breizhcosystem (`GET /v0/telechargements`), comme le ferait un navigateur.
 * Rien n'est envoyé : ni identifiant, ni donnée, ni version installée (la comparaison se fait ici). Seule l'adresse IP
 * du serveur ou de l'ordinateur est visible de Breizhcosystem, comme pour toute visite.
 * Rien n'est téléchargé ni installé d'ici : l'alerte dit quoi faire (en ligne, `sudo living-business-mise-a-jour`,
 * dont la signature est vérifiée sur le serveur). Les textes affichés sont fixés par le jeu : de la réponse de Breizhcosystem,
 * seuls un numéro de version (forme stricte) et l'indication « correctif de sécurité » sont lus.
 */
import { readFileSync } from 'node:fs';
import { appeler, verifierUrl, type Recuperateur } from './sortant.ts';

/** Version de Living Business (package.json). */
export const VERSION_JEU = (() => {
  try { return String((JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: unknown }).version ?? ''); } catch { return ''; }
})();

const FORME = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

export interface EtatMisesAJour {
  verifieLe: string | null;
  /** Dernière version publiée vue sur Breizhcosystem (null : jamais vérifié ou réponse sans version). */
  derniere: string | null;
  /** Breizhcosystem signale cette version comme corrigeant une faille (`gravite: "securite"`). */
  securite: boolean;
  erreur: string | null;
}

export const ETAT_VIDE: EtatMisesAJour = { verifieLe: null, derniere: null, securite: false, erreur: null };

/** a < b : négatif ; a = b : 0 ; a > b : positif (X.Y.Z). */
export function comparerVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
}

export function lireEtat(x: unknown): EtatMisesAJour {
  if (typeof x !== 'object' || x === null) return { ...ETAT_VIDE };
  const e = x as Record<string, unknown>;
  return {
    verifieLe: typeof e.verifieLe === 'string' ? e.verifieLe : null,
    derniere: typeof e.derniere === 'string' && FORME.test(e.derniere) ? e.derniere : null,
    securite: e.securite === true,
    erreur: typeof e.erreur === 'string' ? e.erreur.slice(0, 200) : null,
  };
}

/** Lit la dernière version publiée sur Breizhcosystem (adresse vérifiée : https, jamais une adresse interne). */
export async function lireDerniereVersion(nexus: string, f: Recuperateur): Promise<{ version: string | null; securite: boolean }> {
  const base = await verifierUrl(nexus);
  const r = await appeler(f, new URL('/v0/telechargements', base.origin), { delaiMs: 10_000 });
  const d = (typeof r.donnees === 'object' && r.donnees !== null ? r.donnees : {}) as Record<string, unknown>;
  const version = typeof d.version === 'string' && FORME.test(d.version) ? d.version : null;
  return { version, securite: version !== null && d.gravite === 'securite' };
}

/** Ce que voit un administrateur : version installée, dernière connue, et s'il faut mettre à jour. */
export function resume(e: EtatMisesAJour, auto: boolean, actuelle = VERSION_JEU) {
  const disponible = Boolean(e.derniere && FORME.test(actuelle) && comparerVersions(e.derniere, actuelle) > 0);
  return { actuelle, derniere: e.derniere, disponible, securite: disponible && e.securite, verifieLe: e.verifieLe, erreur: e.erreur, auto };
}
