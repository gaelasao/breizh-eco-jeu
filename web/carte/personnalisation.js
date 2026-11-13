/* Living Business — personnalisation de la carte (direction de design §5) : le nom, la couleur et la place des lieux
   et des départements tels que la personne veut les voir. Rangé sur son appareil, jamais dans les données de
   l'entreprise : la carte montre les données, la personnalisation ne fait que choisir comment les montrer.
   Règle de base : rien n'est obligatoire. Sans personnalisation, la carte s'affiche exactement comme avant.
   Module PUR (aucun DOM, aucun three.js), testé par src/ds/carte.test.ts. */

/** Couleurs proposées : les mêmes que celles des départements, pour que la carte reste cohérente. */
export const COULEURS_CARTE = Object.freeze([
  Object.freeze({ id: 'bleu', libelle: 'Bleu' }),
  Object.freeze({ id: 'orange', libelle: 'Orange' }),
  Object.freeze({ id: 'vert', libelle: 'Vert' }),
  Object.freeze({ id: 'violet', libelle: 'Violet' }),
  Object.freeze({ id: 'turquoise', libelle: 'Turquoise' }),
  Object.freeze({ id: 'jaune', libelle: 'Jaune' }),
  Object.freeze({ id: 'rouge', libelle: 'Rouge' }),
  Object.freeze({ id: 'ardoise', libelle: 'Ardoise' }),
]);
const VALIDES = new Set(COULEURS_CARTE.map((c) => c.id));
/** Familles d'objets qu'on peut personnaliser : ses propres lieux et ses départements, pas les tiers. */
export const FAMILLES_PERSONNALISABLES = Object.freeze(['lieu', 'departement']);
export const LIMITE_NOM = 40;
export const CLE_RANGEMENT = 'lb-carte-perso';

/**
 * Lecture de ce qui est rangé sur l'appareil. Tolérante par construction : un texte abîmé, une version plus récente
 * ou un réglage inconnu ne doivent jamais empêcher la carte de s'afficher — tout ce qui n'est pas reconnu est ignoré.
 */
export function lirePersonnalisation(texte) {
  let brut;
  try { brut = JSON.parse(String(texte ?? '')); } catch { return {}; }
  if (!brut || typeof brut !== 'object' || Array.isArray(brut)) return {};
  const res = {};
  for (const [id, v] of Object.entries(brut)) {
    if (!id || typeof v !== 'object' || !v || Array.isArray(v)) continue;
    const e = {};
    const nom = typeof v.nom === 'string' ? v.nom.trim().slice(0, LIMITE_NOM) : '';
    if (nom) e.nom = nom;
    if (typeof v.couleur === 'string' && VALIDES.has(v.couleur)) e.couleur = v.couleur;
    if (Number.isInteger(v.place) && v.place >= 0 && v.place < 64) e.place = v.place;
    if (Object.keys(e).length) res[id] = e;
  }
  return res;
}
export const ecrirePersonnalisation = (perso) => JSON.stringify(perso ?? {});
export const estPersonnalisee = (perso) => Object.keys(perso ?? {}).length > 0;

/** Nom à écrire sur la carte, et couleur choisie (null : celle d'origine). */
export const nomCarte = (perso, o) => (o?.id && perso?.[o.id]?.nom) || o?.nom || '';
export const couleurCarte = (perso, id) => perso?.[id]?.couleur ?? null;

/** Un réglage changé. Une valeur vide efface le réglage ; une fiche vidée disparaît (rien ne traîne). */
export function regler(perso, id, champ, valeur) {
  const res = { ...(perso ?? {}) };
  if (!id) return res;
  const e = { ...(res[id] ?? {}) };
  if (champ === 'nom') {
    const n = String(valeur ?? '').trim().slice(0, LIMITE_NOM);
    if (n) e.nom = n; else delete e.nom;
  } else if (champ === 'couleur') {
    if (VALIDES.has(valeur)) e.couleur = valeur; else delete e.couleur;
  } else return res;
  if (Object.keys(e).length) res[id] = e; else delete res[id];
  return res;
}
/** Tout remettre comme avant pour un objet, ou pour la carte entière. */
export function oublier(perso, id = null) {
  if (id === null) return {};
  const res = { ...(perso ?? {}) };
  delete res[id];
  return res;
}

/**
 * Ordre d'affichage : chacun à la place qu'on lui a donnée, les autres derrière dans leur ordre d'origine.
 * `liste` est l'ordre par défaut ; le résultat a toujours exactement les mêmes éléments.
 */
export function ordonner(liste, perso) {
  if (!estPersonnalisee(perso)) return [...liste];
  const n = liste.length;
  const places = new Array(n).fill(null);
  const restants = [];
  for (const o of liste) {
    const p = perso?.[o.id]?.place;
    if (Number.isInteger(p) && p >= 0 && p < n && places[p] === null) places[p] = o; else restants.push(o);
  }
  let k = 0;
  for (let i = 0; i < n; i++) if (places[i] === null) places[i] = restants[k++];
  return places;
}

/** Déplacer un bâtiment d'un cran (−1 : avant, +1 : après). Les places de la série entière sont réécrites : stable. */
export function deplacer(perso, liste, id, sens) {
  const ordre = ordonner(liste, perso);
  const i = ordre.findIndex((o) => o.id === id);
  const j = i + (sens < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= ordre.length) return { ...(perso ?? {}) };
  const suite = [...ordre];
  suite[i] = ordre[j];
  suite[j] = ordre[i];
  const res = { ...(perso ?? {}) };
  suite.forEach((o, k) => { res[o.id] = { ...(res[o.id] ?? {}), place: k }; });
  return res;
}
