/* Living Business — étiquettes de la carte 3D : grammaire à 3 niveaux et placement sans chevauchement
   (direction de design §5.6). Module PUR (aucun accès au DOM ni à three.js) : testé par src/ds/carte.test.ts.

   Niveau 1 : nom de quartier, écrit au sol dans la scène (pas de DOM, pas de placement ici).
   Niveau 2 : pastille d'un lieu ou d'une entité (forme de catégorie, icône, nom), placée par placerEtiquettes().
   Niveau 3 : badge d'alerte collé à la pastille ; une entité en alerte reste visible même au dézoom. */

/** Ordre de priorité du placement : la plus petite valeur est placée d'abord (et n'est donc jamais masquée). */
export const PRIORITE = Object.freeze({ focus: 0, critique: 1, selection: 2, alerte: 3, principal: 4, entite: 5, secondaire: 6 });
export const MAX_ETIQUETTES = Object.freeze({ ordinateur: 40, telephone: 24 });
export const MARGE = 4;            // px entre deux boîtes d'étiquettes
export const ZONE_TACTILE = 44;    // px : au toucher, deux zones de toucher ne se recouvrent jamais
export const HYSTERESIS_MS = 200;  // une étiquette masquée ne réapparaît qu'après 200 ms libre (pas de clignotement)

/** Boîte d'écran d'une étiquette ancrée en (x, y) par son milieu bas (translate(-50 %, -100 %)). */
export function boite({ x, y, l, h }, { tactile = false, marge = MARGE } = {}) {
  const lt = tactile ? Math.max(l, ZONE_TACTILE) : l;
  const ht = tactile ? Math.max(h, ZONE_TACTILE) : h;
  const cy = y - h / 2;
  return { x0: x - lt / 2 - marge / 2, x1: x + lt / 2 + marge / 2, y0: cy - ht / 2 - marge / 2, y1: cy + ht / 2 + marge / 2 };
}
export const chevauche = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/** Tri stable : priorité, puis rang (proximité de la caméra, plus petit d'abord), puis identifiant. */
export function trier(candidats) {
  return [...candidats].sort((a, b) => (a.priorite - b.priorite) || ((a.rang ?? 0) - (b.rang ?? 0)) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Place les étiquettes une par une, par priorité, en gardant celles qui ne chevauchent pas une étiquette déjà placée.
 * candidats : [{ id, x, y, l, h, priorite, rang?, horsEcran? }] (coordonnées d'écran en px).
 * options : { largeur, hauteur, max, tactile, marge, maintenant (ms), etat (Map rendue par l'appel précédent) }.
 * Retour : { visibles: Set<id>, etat: Map<id, { visible, libreDepuis }> } — passer `etat` à l'appel suivant.
 */
export function placerEtiquettes(candidats, { largeur = Infinity, hauteur = Infinity, max = MAX_ETIQUETTES.ordinateur, tactile = false, marge = MARGE, maintenant = 0, etat = new Map() } = {}) {
  const places = [];
  const visibles = new Set();
  const suivant = new Map();
  for (const c of trier(candidats)) {
    const avant = etat.get(c.id);
    const b = boite(c, { tactile, marge });
    // entièrement à l'écran : une étiquette coupée par le bord ne se lit pas
    const dansEcran = !c.horsEcran && c.x - c.l / 2 >= 0 && c.x + c.l / 2 <= largeur && c.y - c.h >= 0 && c.y <= hauteur;
    const libre = dansEcran && places.length < max && !places.some((p) => chevauche(p, b));
    if (!libre) { suivant.set(c.id, { visible: false, libreDepuis: null }); continue; }
    const libreDepuis = avant?.libreDepuis ?? maintenant;
    // déjà visible, première apparition, focus clavier ou alerte critique : tout de suite ; sinon, après 200 ms libre
    const montrer = !avant || avant.visible || c.priorite <= PRIORITE.critique || maintenant - libreDepuis >= HYSTERESIS_MS;
    suivant.set(c.id, { visible: montrer, libreDepuis });
    if (montrer) { places.push(b); visibles.add(c.id); }
  }
  return { visibles, etat: suivant };
}

/**
 * Vue large : les entités d'un quartier (priorité entité ou secondaire, sans alerte) se regroupent en une pastille
 * « Clients +12 ». Les lieux principaux, la sélection, le focus et les alertes restent seuls.
 * Retour : { gardes: candidats gardés, groupes: [{ quartier, ids, nombre }] } (groupes d'au moins 2 entités).
 */
export function regrouperParQuartier(candidats) {
  const gardes = [];
  const parQuartier = new Map();
  for (const c of candidats) {
    if (!c.quartier || c.priorite < PRIORITE.entite) { gardes.push(c); continue; }
    if (!parQuartier.has(c.quartier)) parQuartier.set(c.quartier, []);
    parQuartier.get(c.quartier).push(c);
  }
  const groupes = [];
  for (const [quartier, liste] of parQuartier) {
    if (liste.length < 2) { gardes.push(...liste); continue; }
    groupes.push({ quartier, ids: liste.map((c) => c.id), nombre: liste.length });
  }
  return { gardes, groupes };
}

/** Ordre de parcours au clavier (flèches) : par priorité, puis par rang. Les identifiants en double sont retirés. */
export function ordreClavier(lieux) {
  const vus = new Set();
  return trier(lieux).filter((l) => (vus.has(l.id) ? false : vus.add(l.id)));
}

/** Lieu suivant (sens = 1) ou précédent (sens = -1) dans l'ordre clavier, en boucle. */
export function voisin(ordre, idCourant, sens) {
  if (!ordre.length) return null;
  const i = ordre.findIndex((l) => l.id === idCourant);
  if (i < 0) return ordre[sens > 0 ? 0 : ordre.length - 1];
  return ordre[(i + sens + ordre.length) % ordre.length];
}
