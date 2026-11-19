/**
 * LE SUIVI DE CHANTIER, EN TROIS CHIFFRES. Le devis dit ce que le chantier avait le droit de coûter : tant
 * d'heures, tant d'achats. Le terrain dit ce qu'il a coûté jusqu'ici. L'avancement dit où on en est. Tant qu'on
 * regarde ces trois chiffres séparément, on ne sait rien ; mis l'un contre l'autre, ils disent la seule chose qui
 * compte : est-ce que ce chantier va passer.
 *
 * LA COMPARAISON QUI FAIT TOUT. 25 % des heures consommées pour 30 % d'avancement : en avance. 40 % des heures
 * pour 30 % d'avancement : en retard, et de dix points. C'est la phrase que le conducteur de travaux dit déjà le
 * lundi matin, sauf qu'il la dit de tête et seulement quand il y pense.
 *
 * CE QU'ON NE FAIT PAS. Aucune moyenne entre les heures et les achats : un chantier qui tient ses heures et explose
 * ses achats n'est pas « à moitié bien », il a un problème d'achats. Les deux écarts restent côte à côte. Et aucune
 * cause n'est devinée : intempéries, matériel non livré, malfaçon, c'est le terrain qui sait, et il le dit dans le
 * champ prévu pour ça. Un logiciel qui invente la cause d'un retard fait perdre la confiance qu'il vient de gagner.
 *
 * SANS DONNÉES, RIEN. Pas de budget au devis, ou pas d'avancement : on ne rend pas un écart de zéro, on rend `null`.
 * Un zéro se lit comme « tout va bien » ; un écran vide se lit comme « il manque quelque chose », ce qui est vrai.
 */
import type { ObjetMetier, ValeurChamp } from './model.ts';

/** L'écart d'un poste : ce qui était prévu, ce qui est consommé, et de combien de points on dérive. */
export interface EcartPoste {
  /** Ce que le devis prévoyait. */
  prevu: number;
  /** Ce que le terrain a consommé. */
  consomme: number;
  /** Ce qu'il reste ; négatif quand le budget est déjà dépassé — on le dit, on ne le borne pas à zéro. */
  reste: number;
  /** Part du budget consommée, en points de pourcentage (110 quand on a dépassé de 10 %). */
  part: number;
  /** Part consommée moins avancement : positif = on consomme plus vite qu'on n'avance. */
  ecart: number;
}

export interface EtatChantier {
  avancement: number;
  heures: EcartPoste | null;
  achats: EcartPoste | null;
  /** Le pire des deux écarts : c'est lui qui décide de la couleur, jamais une moyenne. */
  ecart: number | null;
  sens: 'avance' | 'tenu' | 'retard' | null;
  /** Ce que le terrain a déclaré ; jamais deviné. */
  cause: string | null;
}

/** Marge sous laquelle un écart n'en est pas un : un chantier ne se pilote pas au point près. */
export const MARGE_POINTS = 5;

const nombre = (v: ValeurChamp | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function poste(prevu: number | null, consomme: number | null, avancement: number): EcartPoste | null {
  if (prevu === null || prevu <= 0 || consomme === null || consomme < 0) return null;
  const part = (consomme / prevu) * 100;
  return { prevu, consomme, reste: prevu - consomme, part, ecart: part - avancement };
}

/**
 * L'état d'un chantier d'après ses propres champs. `null` partout où l'entreprise n'a rien renseigné : mieux vaut
 * un écran qui demande qu'un chiffre inventé.
 */
export function etatChantier(o: ObjetMetier): EtatChantier {
  const brut = nombre(o.champs.avancement);
  const avancement = brut === null ? 0 : Math.min(100, Math.max(0, brut));
  const heures = brut === null ? null : poste(nombre(o.champs.budget_heures), nombre(o.champs.heures_faites), avancement);
  const achats = brut === null ? null : poste(nombre(o.champs.budget_achats), nombre(o.champs.achats_engages), avancement);
  const ecarts = [heures?.ecart, achats?.ecart].filter((x): x is number => typeof x === 'number');
  const ecart = ecarts.length ? Math.max(...ecarts) : null;
  return {
    avancement,
    heures,
    achats,
    ecart,
    sens: ecart === null ? null : ecart > MARGE_POINTS ? 'retard' : ecart < -MARGE_POINTS ? 'avance' : 'tenu',
    cause: typeof o.champs.cause_ecart === 'string' && o.champs.cause_ecart.trim() ? o.champs.cause_ecart : null,
  };
}

/** La phrase du lundi matin. Vide tant qu'il n'y a pas de quoi la dire. */
export function phraseChantier(e: EtatChantier): string {
  if (e.sens === null || e.ecart === null) return '';
  const points = Math.round(Math.abs(e.ecart));
  const ou = e.heures !== null && (e.achats === null || e.heures.ecart >= e.achats.ecart) ? 'les heures' : 'les achats';
  if (e.sens === 'tenu') return `${e.avancement} % fait, le budget suit.`;
  const cause = e.cause ? ` (${e.cause})` : '';
  return e.sens === 'retard'
    ? `${e.avancement} % fait, et ${ou} consomment ${points} points de plus : ce chantier dérive${cause}.`
    : `${e.avancement} % fait pour ${points} points de budget en moins : ce chantier est en avance.`;
}
