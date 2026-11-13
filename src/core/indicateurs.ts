/**
 * Indicateurs de vitalité dérivés des règles de l'univers (LB-07) : pour chaque règle,
 * part des objets conformes parmi ceux dont la donnée est connue ET fraîche.
 * Universel : aucun indicateur sectoriel codé en dur. Pondération 1 par règle (à valider métier).
 */
import { fraicheur, type ObjetMetier } from './model.ts';
import { regleVise, type ContexteRegle } from './situation.ts';
import type { Univers } from './univers.ts';
import type { Indicateur } from './vitalite.ts';

const nombre = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export interface DetailCouverture {
  regle: string;
  total: number;
  mesures: number; // connus et frais
  conformes: number;
}

export function indicateursDepuisRegles(
  u: Univers,
  objets: readonly ObjetMetier[],
  ctx: ContexteRegle,
): { indicateurs: Indicateur[]; couverture: DetailCouverture[] } {
  const indicateurs: Indicateur[] = [];
  const couverture: DetailCouverture[] = [];
  for (const r of u.regles) {
    const vises = objets.filter((o) => regleVise(r, o));
    if (vises.length === 0) continue;
    let mesures = 0;
    let conformes = 0;
    for (const o of vises) {
      const v = nombre(o.champs[r.champ]);
      const s = typeof r.seuil === 'number' ? r.seuil : nombre(o.champs[r.seuil.champ]);
      if (v === null || s === null || fraicheur(o.majLe, ctx.maintenant, ctx.ageMaxMs) !== 'fraiche') continue;
      mesures++;
      if (r.sens === 'min' ? v >= s : v <= s) conformes++;
    }
    couverture.push({ regle: r.id, total: vises.length, mesures, conformes });
    indicateurs.push({
      id: r.id,
      libelle: `${r.libelle} dans les limites`,
      poids: 1,
      valeur: {
        valeur: mesures > 0 ? Math.round((100 * conformes) / mesures) : null,
        provenance: 'calcule',
        source: { id: `calcul:${r.id}`, libelle: `Calcul sur ${mesures} ${vises.length < 2 ? 'objet' : 'objets'} sur ${vises.length}, à jour`, derniereSynchro: null },
        observeLe: mesures > 0 ? ctx.maintenant.toISOString() : null,
      },
    });
  }
  return { indicateurs, couverture };
}
