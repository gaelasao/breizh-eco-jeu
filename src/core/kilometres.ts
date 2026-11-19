/**
 * INDEMNITÉS KILOMÉTRIQUES. Un indépendant qui roule avec sa voiture personnelle pour ses clients peut déduire ses
 * trajets au barème forfaitaire de l'administration, plutôt que de garder chaque ticket de carburant. Le barème
 * couvre déjà la dépréciation du véhicule, l'entretien, les pneus, le carburant et l'assurance — c'est pour ça
 * qu'on n'additionne rien d'autre par-dessus.
 *
 * LE BARÈME EST UNE DONNÉE, PAS DU CODE. Il est publié chaque année par l'administration et il change. Il est donc
 * écrit ici comme une table DATÉE, avec sa source, et l'écran affiche l'année qu'il applique. Le jour où il bouge,
 * on ajoute une table et on ne touche à aucun calcul. Un barème caché dans une formule, personne ne sait plus de
 * quelle année il date, et c'est une déclaration fiscale fausse.
 *
 * CE QUE ÇA NE FAIT PAS. Ce n'est pas une déclaration : c'est une estimation, à vérifier et à justifier. Le barème
 * ne couvre ni les péages, ni le stationnement, ni les intérêts d'emprunt — qui se déduisent en plus, avec leurs
 * justificatifs. Les deux-roues et cyclomoteurs ont leurs propres barèmes, qui ne sont pas ici : mieux vaut ne rien
 * dire que d'appliquer le barème voiture à un scooter.
 *
 * Source : barème applicable en 2026 (revenus 2025), non revalorisé par rapport à l'année précédente.
 * https://www.economie.gouv.fr/particuliers/impots-et-fiscalite/gerer-mon-impot-sur-le-revenu/impot-sur-le-revenu-tout-savoir-sur-le-bareme-des-frais-kilometriques
 */

/** Une tranche : jusqu'à `jusqua` kilomètres, le montant vaut `parKm × d + fixe`. */
interface Tranche { jusqua: number; parKm: number; fixe: number }

/** L'année d'application du barème écrit ici. Affichée à l'écran : personne ne doit avoir à deviner. */
export const ANNEE_BAREME = 2026;

/**
 * Le barème voitures thermiques, hybrides et à hydrogène, par puissance administrative. Les clés sont les
 * puissances charnières : 3 CV et moins, 4, 5, 6, 7 CV et plus.
 */
export const BAREME: Readonly<Record<number, readonly Tranche[]>> = Object.freeze({
  3: [{ jusqua: 5000, parKm: 0.529, fixe: 0 }, { jusqua: 20_000, parKm: 0.316, fixe: 1065 }, { jusqua: Infinity, parKm: 0.370, fixe: 0 }],
  4: [{ jusqua: 5000, parKm: 0.606, fixe: 0 }, { jusqua: 20_000, parKm: 0.340, fixe: 1330 }, { jusqua: Infinity, parKm: 0.407, fixe: 0 }],
  5: [{ jusqua: 5000, parKm: 0.636, fixe: 0 }, { jusqua: 20_000, parKm: 0.357, fixe: 1395 }, { jusqua: Infinity, parKm: 0.427, fixe: 0 }],
  6: [{ jusqua: 5000, parKm: 0.665, fixe: 0 }, { jusqua: 20_000, parKm: 0.374, fixe: 1457 }, { jusqua: Infinity, parKm: 0.447, fixe: 0 }],
  7: [{ jusqua: 5000, parKm: 0.697, fixe: 0 }, { jusqua: 20_000, parKm: 0.394, fixe: 1515 }, { jusqua: Infinity, parKm: 0.470, fixe: 0 }],
});

/**
 * Majoration des véhicules 100 % électriques. L'administration publie une seconde table, mais elle vaut exactement
 * la première majorée de 20 % : on applique la majoration plutôt que de recopier quinze chiffres de plus, qu'il
 * faudrait alors tenir à jour deux fois.
 */
export const MAJORATION_ELECTRIQUE = 1.2;

/** Puissances du barème, dans l'ordre. */
export const PUISSANCES = Object.freeze([3, 4, 5, 6, 7]);

/** La ligne du barème qui s'applique : en dessous de 3 CV c'est la première, au-dessus de 7 CV c'est la dernière. */
export function ligneBareme(cv: number): readonly Tranche[] {
  const arrondi = Math.round(cv);
  const borne = Math.min(7, Math.max(3, Number.isFinite(arrondi) ? arrondi : 0));
  return BAREME[borne] as readonly Tranche[];
}

export interface Indemnite {
  /** Kilomètres professionnels retenus. */
  km: number;
  /** Puissance appliquée, après bornage (3 à 7). */
  cv: number;
  electrique: boolean;
  /** Montant en euros, arrondi à l'euro : une estimation ne se donne pas au centime. */
  montant: number;
  /** La formule appliquée, en toutes lettres, pour que le chiffre soit vérifiable sans ouvrir le code. */
  formule: string;
  annee: number;
}

const fr = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 3 });

/**
 * L'indemnité pour une distance professionnelle annuelle. `null` dès qu'il manque de quoi calculer : sans
 * kilomètres ni puissance, on ne rend pas zéro euro — zéro se lirait comme une réponse.
 */
export function indemniteKilometrique(km: unknown, cv: unknown, electrique = false): Indemnite | null {
  const d = Number(km);
  const p = Number(cv);
  if (!Number.isFinite(d) || d <= 0 || !Number.isFinite(p) || p <= 0) return null;
  const lignes = ligneBareme(p);
  const t = lignes.find((x) => d <= x.jusqua) ?? (lignes[lignes.length - 1] as Tranche);
  const base = d * t.parKm + t.fixe;
  const montant = electrique ? base * MAJORATION_ELECTRIQUE : base;
  const cœur = t.fixe ? `(${fr(d)} km × ${fr(t.parKm)}) + ${fr(t.fixe)}` : `${fr(d)} km × ${fr(t.parKm)}`;
  return {
    km: d,
    cv: Math.min(7, Math.max(3, Math.round(p))),
    electrique,
    montant: Math.round(montant),
    formule: electrique ? `${cœur}, majoré de 20 % (électrique)` : cœur,
    annee: ANNEE_BAREME,
  };
}
