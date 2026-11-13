import { hex, ratio, ratioP3, dist, fmt, mapToSrgb, melange } from './couleurs.mjs';

// ---------- Primitives ----------
// Neutres « ardoise sur chaux » (v1.1) : paliers 0-7 (fonds, composants, bordures) en chaux chaude (teinte 85) en clair,
// en « nuit d'Iroise » (teinte 235) en sombre ; paliers 8-12 (bordure interactive, texte) en ardoise (teinte 250).
const A = 250; // ardoise
const CH = 85; // chaux
const NU = 235; // nuit d'Iroise
export const clair = {
  granit: { 0: [1, 0, CH], 1: [0.975, 0.007, CH], 2: [0.962, 0.008, CH], 3: [0.945, 0.009, CH], 4: [0.925, 0.01, CH], 5: [0.903, 0.011, CH], 6: [0.875, 0.012, CH], 7: [0.83, 0.012, CH], 8: [0.6, 0.016, A], 9: [0.55, 0.017, A], 10: [0.49, 0.018, A], 11: [0.4, 0.018, A], 12: [0.235, 0.016, A] },
  iroise: { 1: [0.985, 0.008, 215], 2: [0.968, 0.017, 215], 3: [0.94, 0.032, 215], 4: [0.91, 0.046, 215], 5: [0.875, 0.06, 215], 6: [0.83, 0.072, 215], 7: [0.755, 0.088, 215], 8: [0.655, 0.105, 215], 9: [0.5, 0.1, 218], 10: [0.445, 0.092, 220], 11: [0.42, 0.085, 220], 12: [0.29, 0.06, 225] },
  ajonc: { 3: [0.965, 0.045, 95], 7: [0.8, 0.13, 90], 9: [0.84, 0.165, 88], 10: [0.8, 0.165, 84], 11: [0.5, 0.105, 80], 12: [0.33, 0.07, 75] },
  ok: { fond: [0.962, 0.03, 152], bord: [0.75, 0.1, 152], plein: [0.52, 0.13, 152], texte: [0.465, 0.115, 152] },
  attention: { fond: [0.965, 0.04, 65], bord: [0.75, 0.12, 62], plein: [0.77, 0.15, 65], texte: [0.5, 0.12, 55], trait: [0.62, 0.15, 58] },
  critique: { fond: [0.962, 0.022, 25], bord: [0.74, 0.12, 25], plein: [0.545, 0.2, 27], texte: [0.5, 0.18, 27] },
  info: { fond: [0.962, 0.02, 262], bord: [0.75, 0.09, 262], plein: [0.52, 0.17, 262], texte: [0.48, 0.16, 262] },
  // Surfaces inverses (toasts, infobulles, bandeau Simulation) : lien et focus lisibles sur --bz-surface-inverse
  inverse: { lien: [0.8, 0.1, 208], focus: [0.72, 0.115, 208] },
  // Données (graphiques uniquement) — inspirées de l'ordre Okabe-Ito, recalculées
  dv: { 1: [0.48, 0.13, 252], 2: [0.62, 0.17, 48], 3: [0.593, 0.113, 176], 4: [0.53, 0.17, 350], 5: [0.4, 0.08, 300], 6: [0.5, 0.1, 100], autre: [0.58, 0.016, A] },
};
export const sombre = {
  granit: { 0: [0.215, 0.018, NU], 1: [0.17, 0.016, NU], 2: [0.195, 0.017, NU], 3: [0.24, 0.019, NU], 4: [0.27, 0.02, NU], 5: [0.3, 0.021, NU], 6: [0.335, 0.022, NU], 7: [0.385, 0.024, NU], 8: [0.56, 0.018, A], 9: [0.62, 0.017, A], 10: [0.68, 0.015, A], 11: [0.82, 0.012, A], 12: [0.945, 0.006, A] },
  iroise: { 1: [0.19, 0.02, 220], 2: [0.215, 0.028, 220], 3: [0.26, 0.045, 218], 4: [0.295, 0.058, 218], 5: [0.33, 0.068, 216], 6: [0.38, 0.078, 216], 7: [0.45, 0.09, 215], 8: [0.55, 0.1, 213], 9: [0.72, 0.115, 208], 10: [0.78, 0.11, 206], 11: [0.8, 0.1, 208], 12: [0.93, 0.04, 205] },
  ajonc: { 3: [0.29, 0.05, 85], 7: [0.6, 0.12, 88], 9: [0.84, 0.165, 88], 10: [0.86, 0.15, 92], 11: [0.89, 0.13, 92], 12: [0.95, 0.06, 95] },
  ok: { fond: [0.27, 0.045, 152], bord: [0.47, 0.09, 152], plein: [0.74, 0.15, 152], texte: [0.8, 0.13, 152] },
  attention: { fond: [0.28, 0.05, 60], bord: [0.5, 0.1, 60], plein: [0.8, 0.14, 68], texte: [0.82, 0.12, 68] },
  critique: { fond: [0.27, 0.06, 25], bord: [0.5, 0.13, 25], plein: [0.7, 0.17, 25], texte: [0.78, 0.13, 25] },
  info: { fond: [0.27, 0.05, 262], bord: [0.5, 0.12, 262], plein: [0.72, 0.13, 262], texte: [0.8, 0.1, 262] },
  inverse: { lien: [0.42, 0.085, 220], focus: [0.5, 0.1, 218] },
  dv: { 1: [0.66, 0.13, 252], 2: [0.8, 0.14, 57], 3: [0.77, 0.12, 177], 4: [0.67, 0.15, 350], 5: [0.556, 0.116, 297], 6: [0.6, 0.12, 105], autre: [0.66, 0.015, A] },
};

// ---------- Scène 3D (indépendante du thème : l'heure de la carte décide) ----------
// Sols des quartiers : distingués par le matériau (motif dans le shader) ET par une teinte de chroma 0,015 à 0,075.
export const quartiers = {
  jour: { clients: [0.82, 0.04, 30], fournisseurs: [0.76, 0.015, A], partenaires: [0.7, 0.05, NU], equipe: [0.8, 0.075, 135], stock: [0.74, 0.05, 65], prospects: [0.87, 0.055, 85] },
  nuit: { clients: [0.34, 0.04, 20], fournisseurs: [0.27, 0.012, A], partenaires: [0.325, 0.05, NU], equipe: [0.32, 0.045, 140], stock: [0.28, 0.04, 70], prospects: [0.37, 0.035, 85] },
};
export const materiaux = { clients: 'pavés de granit rose (damier à deux tons)', fournisseurs: 'enrobé et marquages blancs', partenaires: 'dalles d’ardoise à joints décalés', equipe: 'pelouse', stock: 'planches de quai', prospects: 'sable et étals rayés' };
export const scene = {
  jour: {
    'ciel-zenith': '#7fb6d3', 'ciel-horizon': '#dfeceb', brume: '#dfeceb', mer: '#2f8aa0', 'mer-profonde': '#1d5f74', ecume: '#e9f5f3',
    sable: '#e8dcc2', lande: '#9db37c', granit: '#a9a69e', ardoise: '#4b5763', chaux: '#f4f0e7', bois: '#9a7652', platre: '#ece8e1',
    soleil: '#fff4df', 'hemi-ciel': '#9fc3e0', 'hemi-sol': '#b9ab8f', fenetres: '#3c4a56', surbrillance: '#2ba1b9', phare: '#f2c84b',
    contour: '#323a42', encre: hex(clair.granit[12]), halo: '#f4f0e7',
  },
  nuit: {
    'ciel-zenith': '#08131f', 'ciel-horizon': '#1f3346', brume: '#1a2b3b', mer: '#123542', 'mer-profonde': '#0a2230', ecume: '#6f8f98',
    sable: '#5f5a50', lande: '#3f4c3a', granit: '#4f5357', ardoise: '#262d35', chaux: '#8b8c8a', bois: '#4e3d2e', platre: '#3a3e44',
    soleil: '#a9bedc', 'hemi-ciel': '#31465e', 'hemi-sol': '#1b1e22', fenetres: '#ffd27a', surbrillance: '#4fcbda', phare: '#ffd75e',
    contour: '#05080b', encre: hex(sombre.granit[12]), halo: '#1a2028',
  },
};
for (const m of ['jour', 'nuit']) for (const [q, c] of Object.entries(quartiers[m])) scene[m][`quartier-${q}`] = hex(c);
// Couleurs de la scène qui peuvent se trouver derrière un contrôle (lumières et encre exclues)
const NON_FONDS = new Set(['soleil', 'hemi-ciel', 'hemi-sol', 'encre', 'halo', 'contour']);
export const fondsScene = Object.fromEntries(['jour', 'nuit'].flatMap((m) => Object.entries(scene[m]).filter(([k]) => !NON_FONDS.has(k)).map(([k, v]) => [`${m}-${k}`, v])));

// ---------- Vérifications ----------
// Chaque contrôle : [groupe, avant-plan, fond, seuil, valeur]. Les seuils sont ceux de WCAG 2.2 AA (texte 4,5:1, non textuel 3:1).
export const fails = [];
export const controles = { clair: [], sombre: [] };
function chk(th, groupe, nom, sur, a, b, min) {
  const r = ratio(a, b);
  controles[th].push([groupe, nom, sur, min, r]);
  if (r < min - 1e-9) fails.push(`${th} ${nom} / ${sur} ${r.toFixed(2)} < ${min}`);
  return r;
}
const OPACITES = { 'verre teinté 86 %': 0.86, 'verre vitré 80 %': 0.8, 'verre téléphone 96 %': 0.96 };
export const pireScene = { clair: {}, sombre: {} };
for (const [th, P] of [['clair', clair], ['sombre', sombre]]) {
  const g = P.granit, i = P.iroise;
  const fonds = th === 'clair'
    ? { fond: g[1], 'fond-2': g[2], surface: g[0], composant: g[3], 'composant-survol': g[4] }
    : { fond: g[1], 'fond-2': g[2], surface: g[0], 'surface-elevee': g[3], composant: g[3], 'composant-survol': g[4] };
  const surMarque = th === 'clair' ? [1, 0, 0] : g[1];
  for (const [fn, f] of Object.entries(fonds)) {
    chk(th, 'Texte', 'texte', fn, g[12], f, 7);
    chk(th, 'Texte', 'texte-2', fn, g[11], f, 4.5);
    chk(th, 'Texte', 'texte-3', fn, g[10], f, 4.5);
    chk(th, 'Bordures et indicateurs', 'bordure-champ', fn, g[8], f, 3);
    chk(th, 'Bordures et indicateurs', 'bordure-champ-survol', fn, g[9], f, 3);
    chk(th, 'Marque', 'marque-texte (lien)', fn, i[11], f, 4.5);
    chk(th, 'Bordures et indicateurs', 'etat-indicateur (marque)', fn, i[9], f, 3);
    chk(th, 'Bordures et indicateurs', 'focus', fn, i[9], f, 3);
    for (const t of ['ok', 'attention', 'critique', 'info']) {
      chk(th, 'Statuts', `${t}-texte`, fn, P[t].texte, f, 4.5);
      chk(th, 'Statuts', `${t}-trait`, fn, P[t].trait ?? P[t].plein, f, 3);
    }
    for (const k of [1, 2, 3, 4, 5, 6, 'autre']) chk(th, 'Données', `dv-${k}`, fn, P.dv[k], f, 3);
    chk(th, 'Données', 'dv-neutre (granit-8)', fn, g[8], f, 3);
  }
  // Composant pressé (interrupteur arrêté, segment pressé)
  chk(th, 'Texte', 'texte-2', 'composant-presse', g[11], g[5], 4.5);
  chk(th, 'Texte', 'texte-3', 'composant-presse', g[10], g[5], 4.5);
  // Indicateurs d'état : la bordure doit se voir contre le remplissage doux et contre le fond voisin
  chk(th, 'Bordures et indicateurs', 'etat-indicateur (marque)', 'marque-doux', i[9], i[3], 3);
  chk(th, 'Bordures et indicateurs', 'bordure-champ (segment pressé)', 'surface', g[8], g[0], 3);
  // XP : remplissage Ajonc sur sa piste ; la piste (ou son bord) se voit sur la surface
  const piste = th === 'clair' ? g[11] : g[4], pisteBord = th === 'clair' ? g[11] : g[8];
  chk(th, 'Bordures et indicateurs', 'xp-remplissage (ajonc-9)', 'xp-piste', P.ajonc[9], piste, 3);
  chk(th, 'Bordures et indicateurs', 'xp-piste-bord', 'surface', pisteBord, g[0], 3);
  // Marque
  chk(th, 'Marque', 'sur-marque', 'marque', surMarque, i[9], 4.5);
  chk(th, 'Marque', 'sur-marque', 'marque-survol', surMarque, i[10], 4.5);
  chk(th, 'Marque', 'texte', 'selection (iroise-3)', g[12], i[3], 7);
  chk(th, 'Marque', 'marque-texte (lien)', 'selection (iroise-3)', i[11], i[3], 4.5);
  chk(th, 'Marque', 'texte-2', 'selection (iroise-3)', g[11], i[3], 4.5);
  // Statuts sur leur fond, texte sur aplat
  for (const t of ['ok', 'attention', 'critique', 'info']) {
    chk(th, 'Statuts', `${t}-texte`, `${t}-fond`, P[t].texte, P[t].fond, 4.5);
    const sur = th === 'clair' ? (t === 'attention' ? g[12] : [1, 0, 0]) : g[1];
    chk(th, 'Statuts', `sur-${t} (badge à nombre)`, `${t}-plein`, sur, P[t].plein, 4.5);
  }
  // Surfaces inverses (toasts, infobulles, bandeau Simulation)
  chk(th, 'Surfaces inverses', 'sur-inverse', 'surface-inverse', g[1], g[12], 7);
  chk(th, 'Surfaces inverses', 'inverse-lien', 'surface-inverse', P.inverse.lien, g[12], 4.5);
  chk(th, 'Surfaces inverses', 'inverse-focus', 'surface-inverse', P.inverse.focus, g[12], 3);
  // Accent Ajonc
  const surAjonc = th === 'clair' ? g[12] : g[1];
  chk(th, 'Accent', 'sur-accent', 'ajonc-9', surAjonc, P.ajonc[9], 4.5);
  chk(th, 'Accent', 'accent-texte (ajonc-11)', 'surface', P.ajonc[11], g[0], 4.5);
  chk(th, 'Accent', 'accent-texte (ajonc-11)', 'fond', P.ajonc[11], g[1], 4.5);
  // Verre et étiquettes sur la scène : pire cas sans flou, sur chaque couleur de la scène (jour ET nuit, quel que soit le thème)
  const surf = hex(g[0]);
  const couches = { ...OPACITES, 'étiquette 3D': th === 'clair' ? 0.9 : 0.88 };
  for (const [couche, a] of Object.entries(couches)) {
    let pire2 = { r: 99 }, pire1 = { r: 99 };
    for (const [nomFond, fs] of Object.entries(fondsScene)) {
      const compo = melange(surf, a, fs);
      const r1 = ratio(g[12], compo), r2 = ratio(g[11], compo);
      if (r1 < pire1.r) pire1 = { r: r1, sur: nomFond };
      if (r2 < pire2.r) pire2 = { r: r2, sur: nomFond };
    }
    pireScene[th][couche] = { texte: pire1, 'texte-2': pire2 };
    chk(th, 'Scène 3D', `texte sur ${couche}`, `pire cas : ${pire1.sur}`, g[12], melange(surf, a, fondsScene[pire1.sur]), 4.5);
    chk(th, 'Scène 3D', `texte-2 sur ${couche}`, `pire cas : ${pire2.sur}`, g[11], melange(surf, a, fondsScene[pire2.sur]), 4.5);
  }
}
// Noms de quartier écrits au sol : encre sur le sol de chaque quartier et sur son halo (pas de thème : jour et nuit)
export const controlesScene = [];
for (const m of ['jour', 'nuit']) {
  const S = scene[m];
  for (const q of Object.keys(quartiers[m])) {
    const r = ratio(S.encre, S[`quartier-${q}`]); controlesScene.push([`encre ${m}`, `quartier ${q} ${m}`, 4.5, r]);
    if (r < 4.5) fails.push(`scène encre ${m} / quartier-${q} ${r.toFixed(2)} < 4.5`);
  }
  const r = ratio(S.encre, S.halo); controlesScene.push([`encre ${m}`, `halo ${m}`, 4.5, r]);
  if (r < 4.5) fails.push(`scène encre ${m} / halo ${r.toFixed(2)} < 4.5`);
}
// Rampe séquentielle : exemptée du 3:1 (jamais seule porteuse de valeur : chaque case affiche sa valeur), mais mesurée
export const sequentiel = {};
for (const [th, P] of [['clair', clair], ['sombre', sombre]]) sequentiel[th] = [3, 5, 7, 8, 10].map((k) => +ratio(P.iroise[k], P.granit[0]).toFixed(2));

// Monotonie de la luminosité : chaque échelle va dans un seul sens (palier 0 exclu : en sombre la surface est plus claire que le fond ;
// ajonc-9 et 10 exclus en clair : un jaune plein est forcément plus clair que sa bordure)
export const monotonie = [];
for (const [th, P] of [['clair', clair], ['sombre', sombre]]) {
  for (const ech of ['granit', 'iroise', 'ajonc']) {
    const pas = Object.keys(P[ech]).map(Number).filter((k) => k !== 0 && !(th === 'clair' && ech === 'ajonc' && (k === 9 || k === 10))).sort((a, b) => a - b);
    const sens = th === 'clair' ? -1 : 1;
    let ok = true;
    for (let n = 1; n < pas.length; n++) if (Math.sign(P[ech][pas[n]][0] - P[ech][pas[n - 1]][0]) !== sens) { ok = false; fails.push(`monotonie ${th} ${ech}-${pas[n - 1]} → ${ech}-${pas[n]}`); }
    monotonie.push([th, ech, ok]);
  }
}
// Distances CVD entre catégories de données
export const cvd = {};
for (const [th, P] of [['clair', clair], ['sombre', sombre]]) {
  const ks = [1, 2, 3, 4, 5, 6];
  const res = {};
  for (const mode of [null, 'protan', 'deutan', 'tritan']) {
    let min = 9, pair = '';
    for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) { const d = dist(P.dv[ks[a]], P.dv[ks[b]], mode); if (d < min) { min = d; pair = `${ks[a]}-${ks[b]}`; } }
    res[mode ?? 'normal'] = { min7: +min.toFixed(3), pair };
  }
  cvd[th] = res;
}
// Distances entre sols de quartier (vision normale et deutéranopie)
export const distQuartiers = {};
for (const m of ['jour', 'nuit']) {
  const ks = Object.keys(quartiers[m]); let min = 9, pair = '', minD = 9;
  for (let a = 0; a < ks.length; a++) for (let b = a + 1; b < ks.length; b++) {
    const d = dist(quartiers[m][ks[a]], quartiers[m][ks[b]]); if (d < min) { min = d; pair = `${ks[a]}-${ks[b]}`; }
    minD = Math.min(minD, dist(quartiers[m][ks[a]], quartiers[m][ks[b]], 'deutan'));
  }
  distQuartiers[m] = { min: +min.toFixed(3), pair, deutan: +minD.toFixed(3) };
  if (min < 0.04) fails.push(`quartiers ${m} trop proches : ${pair} ${(min * 100).toFixed(1)}`);
}
if (process.argv[2] === 'check') {
  console.log(fails.length ? fails.join('\n') : 'OK : toutes les paires passent');
  console.log(JSON.stringify({ cvd, distQuartiers, sequentiel, pireScene }, null, 1));
  for (const th of ['clair', 'sombre']) { const P = th === 'clair' ? clair : sombre; console.log(th, Object.fromEntries(Object.entries(P.granit).map(([k, v]) => [k, hex(v)]))); }
}
export { ratioP3, fmt, mapToSrgb };
