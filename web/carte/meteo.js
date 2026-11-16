/* Living Business — le temps qu'il fait sur la carte (direction de design §5.2, §5.3).
   Module PUR : aucun accès au DOM ni à three.js ; testé par src/ds/carte.test.ts.

   En Bretagne une averse passe et la lumière revient. Le ciel de la carte suit donc un tour : une longue éclaircie,
   un passage de nuages, une averse brève, puis la lumière qui perce. Rien n'y est aléatoire — le même instant donne
   toujours le même ciel, et la carte au repos ne calcule rien.

   Règle de lisibilité : sous les nuages la lumière devient DOUCE, jamais sombre. Le soleil baisse, la voûte céleste
   monte d'autant ; la scène garde son niveau, elle perd son contraste. C'est ce qui fait un ciel couvert, et c'est
   aussi ce qui laisse lire une étiquette et repérer une alerte. */

/* Les quatre passages d'un tour de ciel, dans l'ordre. `duree` en secondes du temps d'ambiance — celui qui ralentit
   avec l'éloignement et s'arrête quand la carte se repose (§5.8). Un tour dure donc 164 s d'observation rapprochée,
   dont 22 s d'averse : assez pour qu'un ciel se fasse et se défasse pendant qu'on travaille, trop peu pour lasser. */
export const CYCLE = Object.freeze([
  Object.freeze({ nom: 'clair', duree: 72, couverture: 0.08 }),
  Object.freeze({ nom: 'nuages', duree: 34, couverture: 0.74 }),
  Object.freeze({ nom: 'averse', duree: 22, couverture: 0.92 }),
  Object.freeze({ nom: 'eclaircie', duree: 36, couverture: 0.3 }),
]);
/** Durée d'un tour complet, en secondes. */
export const TOUR = CYCLE.reduce((n, p) => n + p.duree, 0);
/** Part d'un passage consacrée au fondu depuis le précédent : le ciel ne change jamais d'un coup. */
export const FONDU = 0.4;
/** Séchage de la pierre après l'averse (secondes) : elle est sèche avant la fin de l'éclaircie. */
export const SECHAGE = 14;
/** Ciel au clair : l'état de repos, celui de la qualité Économie, des animations réduites et de la pause. */
export const CLAIR = Object.freeze({ nom: 'clair', couverture: 0, pluie: 0, mouille: 0, perce: 0 });
/**
 * Plafonds : ce que le temps qu'il fait peut retirer au soleil, et ce qu'il rend à la voûte céleste. La somme garde
 * le niveau d'éclairement à peu près constant — un ciel couvert est doux, pas sombre (contrainte de lisibilité).
 */
export const PLAFOND = Object.freeze({ soleil: 0.62, ciel: 0.5, gris: 0.8, brume: 0.55, perce: 0.22 });

const lisse = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

/** Passage en cours à `t` secondes dans le tour : { passage, precedent, dans (0 → 1 dans le passage) }. */
function passageA(t, cycle) {
  const tour = cycle.reduce((n, p) => n + p.duree, 0);
  let reste = ((t % tour) + tour) % tour;
  for (let i = 0; i < cycle.length; i++) {
    const p = cycle[i];
    if (reste < p.duree) return { passage: p, precedent: cycle[(i - 1 + cycle.length) % cycle.length], dans: reste / p.duree };
    reste -= p.duree;
  }
  const dernier = cycle[cycle.length - 1];
  return { passage: dernier, precedent: cycle[cycle.length - 2] ?? dernier, dans: 0 };
}

/** Fenêtre de pluie dans le tour : l'averse commence après son fondu et s'arrête avant la fin du passage. */
function fenetrePluie(cycle) {
  let debut = 0;
  for (const p of cycle) {
    if (p.nom === 'averse') return { debut: debut + p.duree * 0.18, fin: debut + p.duree * 0.86 };
    debut += p.duree;
  }
  return null;
}

/**
 * Le temps qu'il fait à `secondes` dans le tour.
 * Retourne { nom, couverture (0 ciel pur → 1 couvert), pluie (0 → 1), mouille (0 → 1 : la pierre est encore
 * mouillée), perce (0 → 1 : la lumière qui revient après l'averse) }.
 */
export function etatMeteo(secondes = 0, { cycle = CYCLE } = {}) {
  const t = Number.isFinite(secondes) ? secondes : 0;
  const { passage, precedent, dans } = passageA(t, cycle);
  const k = lisse(dans / FONDU);
  const couverture = precedent.couverture + (passage.couverture - precedent.couverture) * k;
  // l'averse : elle monte, tient, puis s'en va avant la fin de son passage
  const f = fenetrePluie(cycle);
  const tour = cycle.reduce((n, p) => n + p.duree, 0);
  const dansTour = ((t % tour) + tour) % tour;
  let pluie = 0;
  if (f && dansTour >= f.debut && dansTour <= f.fin) {
    const d = (dansTour - f.debut) / (f.fin - f.debut);
    pluie = Math.min(lisse(d / 0.3), lisse((1 - d) / 0.35));
  }
  // pierre mouillée : pleine pendant l'averse, elle sèche pendant l'éclaircie ; au tour suivant il n'en reste rien
  let mouille = 0;
  if (f && pluie > 0) mouille = lisse((dansTour - f.debut) / ((f.fin - f.debut) * 0.3));
  else if (f && dansTour > f.fin) mouille = Math.exp(-(dansTour - f.fin) / SECHAGE);
  // la lumière qui perce : juste après l'averse, le soleil revient d'un coup dans l'air lavé
  const perce = passage.nom === 'eclaircie' ? Math.sin(Math.PI * Math.min(1, dans / 0.55)) : 0;
  return { nom: passage.nom, couverture, pluie, mouille, perce };
}

/**
 * Ce que le temps qu'il fait change à la lumière, en facteurs prêts à multiplier (§5.3).
 * `soleil` et `ciel` : intensités ; `gris` : part de couleur « nuage » mêlée au ciel ; `brume` : part de brume en
 * plus ; `lustre` : la pierre mouillée (rugosité abaissée, qualité Haute seulement).
 */
export function effets(m = CLAIR) {
  return {
    soleil: Math.max(0, 1 - PLAFOND.soleil * m.couverture + PLAFOND.perce * m.perce),
    ciel: 1 + PLAFOND.ciel * m.couverture,
    gris: PLAFOND.gris * m.couverture,
    brume: PLAFOND.brume * m.couverture,
    lustre: m.mouille,
    pluie: m.pluie,
  };
}

/** Instant du tour où un passage est à son cœur (outils de développement : forcer un ciel pour une capture). */
export function coeurDuPassage(nom, { cycle = CYCLE } = {}) {
  let debut = 0;
  for (const p of cycle) {
    if (p.nom === nom) return debut + p.duree * (p.nom === 'eclaircie' ? 0.32 : p.nom === 'averse' ? 0.52 : 0.75);
    debut += p.duree;
  }
  return 0;
}

/** La carte s'ouvre au milieu de l'éclaircie longue : un ciel clair, de la pierre sèche, rien qui s'agite d'emblée. */
export const DEPART = coeurDuPassage('clair');
