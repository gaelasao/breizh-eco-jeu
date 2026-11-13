/* Living Business — lumière et heure de la carte (direction de design §5.2, §5.3).
   Module PUR : aucun accès au DOM ni à three.js ; testé par src/ds/carte.test.ts.
   L'heure de la carte est indépendante du thème de l'interface : « Réelle » par défaut. Quatre états (aube 6 h à 8 h,
   jour, crépuscule 18 h à 20 h, nuit), interpolés entre les jetons --bz-scene-jour-* et --bz-scene-nuit-*. */

/** Rôles de couleur de la scène : chacun a un jeton --bz-scene-jour-<rôle> et --bz-scene-nuit-<rôle> dans tokens.css. */
export const ROLES_SCENE = Object.freeze([
  'ciel-zenith', 'ciel-horizon', 'brume', 'mer', 'mer-profonde', 'ecume', 'sable', 'lande', 'granit', 'ardoise', 'chaux',
  'bois', 'platre', 'soleil', 'hemi-ciel', 'hemi-sol', 'fenetres', 'surbrillance', 'phare', 'contour', 'encre', 'halo',
  'quartier-clients', 'quartier-fournisseurs', 'quartier-equipe', 'quartier-stock', 'quartier-prospects',
]);

export const REGLAGES_HEURE = Object.freeze({ reelle: 'Réelle', jour: 'Toujours le jour', theme: 'Suivre le thème' });

/** Intensités du §5.3 : hémisphère froide 1,0 ; lumière principale chaude 1,6 le jour, 0,5 la nuit. */
export const INTENSITES = Object.freeze({ hemisphere: 1.0, soleilJour: 1.6, soleilNuit: 0.5 });

/** Palette { jour: { rôle: '#rrggbb' }, nuit: {…}, soleilBas, peinturePerimee } lue par une fonction (getComputedStyle). */
export function lirePalette(lire) {
  const jour = {};
  const nuit = {};
  for (const r of ROLES_SCENE) {
    jour[r] = normaliserHex(lire(`--bz-scene-jour-${r}`));
    nuit[r] = normaliserHex(lire(`--bz-scene-nuit-${r}`));
  }
  const p = Number.parseFloat(String(lire('--bz-scene-peinture-perimee') ?? '').trim());
  return { jour, nuit, soleilBas: normaliserHex(lire('--bz-scene-soleil-bas')), peinturePerimee: Number.isFinite(p) ? p : 0.4 };
}

/** '#ABC', ' #aabbcc ' → '#aabbcc' ; null si ce n'est pas une couleur hexadécimale. */
export function normaliserHex(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(s)) return s;
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  return null;
}

const versRvb = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
const versHex = (c) => `#${c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('')}`;
/** Mélange linéaire de deux couleurs hexadécimales (t = 0 → a, t = 1 → b). */
export function melanger(a, b, t) {
  const ca = versRvb(a);
  const cb = versRvb(b);
  const k = Math.max(0, Math.min(1, t));
  return versHex(ca.map((x, i) => x + ((cb[i] ?? 0) - x) * k));
}

const lisse = (t) => t * t * (3 - 2 * t);

/**
 * État de la lumière pour une date. reglage : 'reelle' (défaut), 'jour' (toujours le jour), 'theme' (nuit si le thème
 * de l'interface est sombre). Retourne { nom, nuit (0 = plein jour → 1 = pleine nuit), soleilBas (0 → 1, teinte
 * chaude de l'aube et du crépuscule), elevation (radians, hauteur de la lumière principale), azimut (radians) }.
 */
export function etatHeure(date = new Date(), { reglage = 'reelle', themeSombre = false } = {}) {
  if (reglage === 'jour' || (reglage === 'theme' && !themeSombre)) return { nom: 'jour', nuit: 0, soleilBas: 0, elevation: 1.0, azimut: 0.7 };
  if (reglage === 'theme') return { nom: 'nuit', nuit: 1, soleilBas: 0, elevation: 0.95, azimut: -0.6 };
  const h = date.getHours() + date.getMinutes() / 60;
  let nom;
  let nuit;
  if (h >= 6 && h < 8) { nom = 'aube'; nuit = 1 - lisse((h - 6) / 2); }
  else if (h >= 8 && h < 18) { nom = 'jour'; nuit = 0; }
  else if (h >= 18 && h < 20) { nom = 'crepuscule'; nuit = lisse((h - 18) / 2); }
  else { nom = 'nuit'; nuit = 1; }
  // teinte chaude au milieu des transitions, nulle en plein jour et en pleine nuit
  const soleilBas = nom === 'aube' || nom === 'crepuscule' ? Math.sin(Math.PI * (1 - Math.abs(nuit * 2 - 1)) / 2) : 0;
  // le soleil se lève à l'est (aube), passe au sud, se couche à l'ouest ; la lune reste haute la nuit
  const jourCourse = Math.max(0, Math.min(1, (h - 6) / 14));
  const elevation = nuit >= 1 ? 0.95 : 0.35 + Math.sin(Math.PI * jourCourse) * 0.75;
  const azimut = nuit >= 1 ? -0.6 : -1.3 + jourCourse * 2.6;
  return { nom, nuit, soleilBas, elevation, azimut };
}

/** Couleur d'un rôle pour un état (mélange jour → nuit). */
export const couleurRole = (palette, role, etat) => melanger(palette.jour[role], palette.nuit[role], etat.nuit);

/** Lumières et ambiance pour un état : couleurs hexadécimales et intensités prêtes pour three.js. */
export function lumieres(palette, etat) {
  const c = (r) => couleurRole(palette, r, etat);
  const soleil = melanger(c('soleil'), palette.soleilBas ?? c('soleil'), etat.soleilBas);
  return {
    zenith: c('ciel-zenith'), horizon: c('ciel-horizon'), brume: c('brume'),
    hemiCiel: c('hemi-ciel'), hemiSol: c('hemi-sol'), hemiIntensite: INTENSITES.hemisphere,
    soleil, soleilIntensite: INTENSITES.soleilJour + (INTENSITES.soleilNuit - INTENSITES.soleilJour) * etat.nuit,
    fenetresAllumees: etat.nuit >= 0.5,
  };
}
