/* Living Business — gestes de la carte 3D (direction de design §5.7).
   Une seule constante, utilisée par la légende, l'aide, l'aria-label du canvas et les repères d'aide.
   Module PUR (aucun accès au DOM) : testé par src/ds/carte.test.ts. */

export const GESTES = Object.freeze({
  souris: Object.freeze(['Glisser : déplacer', 'Clic droit ou Maj + glisser : pivoter', 'Molette : zoomer vers le pointeur', 'Double-clic sur un bâtiment : entrer']),
  tactile: Object.freeze(['Un doigt : déplacer', 'Deux doigts : zoomer et pivoter', 'Toucher deux fois et glisser : zoomer d’une main', 'Toucher deux fois un bâtiment : entrer']),
  clavier: Object.freeze(['Flèches : passer d’un lieu à l’autre', 'Maj + flèches : déplacer', '+ et - : zoomer', 'Q et E : pivoter', '0 : recentrer', 'Entrée : ouvrir, puis entrer', 'Échap : sortir']),
});

export const TITRES_GESTES = Object.freeze({ souris: 'À la souris', tactile: 'Au toucher', clavier: 'Au clavier' });

/** aria-label du canvas (role="application") : ce que c'est, puis les gestes du clavier, puis l'équivalent en liste. */
export function libelleCanvas({ tactile = false } = {}) {
  const gestes = tactile ? [...GESTES.tactile, ...GESTES.clavier] : [...GESTES.clavier, ...GESTES.souris];
  return `Carte de l’entreprise en maquette 3D. ${gestes.join('. ')}. Tout est aussi disponible en liste : bouton « Liste des lieux ».`;
}
