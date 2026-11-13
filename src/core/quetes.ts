/**
 * Quêtes (LB-08) : objectifs issus de constats vérifiables, avec preuve d'achèvement.
 * Une quête naît d'une situation ouverte et n'est achevée que si une donnée FRAÎCHE prouve
 * le retour dans les limites. Une situation « à vérifier » ne vaut pas achèvement.
 */
import type { ObjetMetier } from './model.ts';
import { situationsPour, type ContexteRegle, type Situation } from './situation.ts';
import type { Univers } from './univers.ts';
import { mesure } from './texte.ts';

export type ActionProposee = 'mouvement' | 'tache.creer';

export interface Quete {
  id: string;
  titre: string;
  objectif: string;
  origine: { regle: string; objetId: string };
  actionProposee: ActionProposee;
  statut: 'ouverte' | 'achevee';
  /** Gravité de la situation d'origine : elle fixe la récompense (core/progression.ts). */
  gravite: 'critique' | 'attention';
  creeLe: string;
  acheveeLe: string | null;
  preuve: { valeur: number | null; seuil: number | null; observeLe: string | null } | null;
}

export function idQuete(regle: string, objetId: string): string {
  return `quete:${regle}:${objetId}`;
}

/**
 * Met à jour l'ensemble des quêtes. Pure : renvoie une nouvelle Map.
 * `situations` = situations courantes de tous les objets.
 */
export function majQuetes(
  u: Univers,
  precedentes: ReadonlyMap<string, Quete>,
  situations: readonly Situation[],
  objets: ReadonlyMap<string, ObjetMetier>,
  ctx: ContexteRegle,
): Map<string, Quete> {
  const res = new Map(precedentes);
  const maintenant = ctx.maintenant.toISOString();

  for (const s of situations) {
    if (s.statut !== 'ouverte' || s.gravite === 'info') continue;
    const id = idQuete(s.regle, s.objetId);
    const existante = res.get(id);
    if (existante?.statut === 'ouverte') continue;
    const regle = u.regles.find((r) => r.id === s.regle);
    const objet = objets.get(s.objetId);
    if (!regle || !objet) continue;
    const seuil = s.preuve.seuil;
    // « Objectif : ≤ 5 000 € » ; un retard maximum de 0 s'écrit « Objectif : plus aucun retard »
    const cible = seuil === null ? '?' : regle.sens === 'max' && seuil === 0 ? null : `${regle.sens === 'min' ? '≥' : '≤'} ${mesure(seuil, regle.unite)}`;
    res.set(id, {
      id,
      titre: `${regle.libelle} — ${objet.nom}`,
      objectif: `Objectif : ${cible ?? `${regle.libelle.toLocaleLowerCase('fr-FR')} ramené à zéro`}, prouvé par une donnée à jour.`,
      origine: { regle: s.regle, objetId: s.objetId },
      actionProposee: regle.mouvement ? 'mouvement' : 'tache.creer',
      statut: 'ouverte',
      gravite: s.gravite === 'critique' ? 'critique' : 'attention',
      creeLe: maintenant,
      acheveeLe: null,
      preuve: null,
    });
  }

  for (const [id, q] of res) {
    if (q.statut !== 'ouverte') continue;
    const objet = objets.get(q.origine.objetId);
    if (!objet) continue;
    const encore = situationsPour(u, objet, null, ctx).find((s) => s.regle === q.origine.regle);
    if (encore) continue; // toujours hors limites OU à vérifier : pas d'achèvement
    const regle = u.regles.find((r) => r.id === q.origine.regle);
    const valeur = regle ? objet.champs[regle.champ] : null;
    const seuil = regle ? (typeof regle.seuil === 'number' ? regle.seuil : objet.champs[regle.seuil.champ]) : null;
    res.set(id, {
      ...q,
      statut: 'achevee',
      acheveeLe: maintenant,
      preuve: {
        valeur: typeof valeur === 'number' ? valeur : null,
        seuil: typeof seuil === 'number' ? seuil : null,
        observeLe: objet.majLe,
      },
    });
  }
  return res;
}
