/**
 * Score de vitalité explicable 0–100 (LB-07, R14).
 * - Donnée absente ou périmée ≠ 0 : elle est exclue et listée.
 * - Couverture = part des poids réellement disponibles et frais.
 * - Sous le seuil de couverture → score non calculable.
 * Ce n'est ni une notation de crédit ni un audit.
 */
import { fraicheur, type Valeur } from './model.ts';

export interface Indicateur {
  id: string;
  libelle: string;
  poids: number; // > 0
  valeur: Valeur<number>; // normalisée 0..100
}

export interface DetailIndicateur {
  id: string;
  libelle: string;
  poids: number;
  valeur: number | null;
  pris: boolean;
  raison: 'ok' | 'manquant' | 'perime' | 'hors_bornes';
}

export interface ResultatVitalite {
  calculable: boolean;
  score: number | null;
  couverture: number; // 0..1
  details: DetailIndicateur[];
}

export interface OptionsVitalite {
  seuilCouverture: number; // 0..1, à valider par métier
  ageMaxMs: number;
  maintenant: Date;
}

export function calculerVitalite(indicateurs: readonly Indicateur[], o: OptionsVitalite): ResultatVitalite {
  const total = indicateurs.reduce((s, i) => s + Math.max(0, i.poids), 0);
  let poidsPris = 0;
  let somme = 0;

  const details = indicateurs.map((i): DetailIndicateur => {
    const v = i.valeur.valeur;
    const base = { id: i.id, libelle: i.libelle, poids: i.poids, valeur: v };
    if (v === null) return { ...base, pris: false, raison: 'manquant' };
    if (v < 0 || v > 100 || Number.isNaN(v)) return { ...base, pris: false, raison: 'hors_bornes' };
    if (fraicheur(i.valeur.observeLe, o.maintenant, o.ageMaxMs) !== 'fraiche') {
      return { ...base, pris: false, raison: 'perime' };
    }
    poidsPris += i.poids;
    somme += v * i.poids;
    return { ...base, pris: true, raison: 'ok' };
  });

  const couverture = total > 0 ? poidsPris / total : 0;
  const calculable = poidsPris > 0 && couverture >= o.seuilCouverture;
  return {
    calculable,
    score: calculable ? Math.round(somme / poidsPris) : null,
    couverture,
    details,
  };
}
