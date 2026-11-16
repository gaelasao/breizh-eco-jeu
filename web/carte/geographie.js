/* Living Business — géographie de la carte : décodage des tracés, projection sur le plateau, et résolution d'un point
   à partir des champs d'une fiche (direction de design §5).
   Module PUR : aucun accès au DOM ni à three.js ; testé par src/ds/carte-echelles.test.ts.

   La carte de la ville est une mise en page, pas une géographie (voir l'en-tête de scene.js). Les deux échelles qui
   l'entourent, elles, sont géographiques : tout ce qui y est posé vient d'un code postal réel. Rien n'y est inventé —
   une fiche sans code postal n'apparaît pas, et la carte le dit.

   FORMAT DES TRACÉS (fabriqués par scripts/carte-contours.mjs)
   Un nombre : entier signé en zigzag, écrit en base 64 par groupes de 5 bits, le bit 6 disant « la suite vient ».
   Un anneau : le nombre de points, puis chaque point (longitude, latitude) en différence du précédent, sur une
   grille de 1/1000 de degré. Le dernier point ne répète pas le premier : l'anneau se referme tout seul.
   Une entité : « code:nom:anneau|anneau|… » ; un anneau précédé de « ~ » est un trou (enclave, étang) — « ~ » n'est
   pas dans l'alphabet base 64, il ne peut donc pas se confondre avec un chiffre du tracé.
   Les codes postaux : une suite de triplets (code postal, longitude, latitude), chacun en différence du précédent. */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const RANG = (() => {
  const t = new Int8Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) t[ALPHABET.charCodeAt(i)] = i;
  return t;
})();

/** Échelle des deux cartes géographiques : 1 kilomètre = 2,5 unités de scène (1 unité = 1 mètre dans la ville). */
export const UNITES_PAR_KM = 2.5;
/** Longueur d'un degré de latitude, en kilomètres. */
export const KM_PAR_DEGRE = 111.32;

/** Lit les entiers d'une chaîne encodée, l'un après l'autre. `curseur` : { i } (position, avancée au fil de la lecture). */
export function entier(s, curseur) {
  let v = 0;
  let decalage = 1;
  let c;
  do {
    c = RANG[s.charCodeAt(curseur.i++)];
    if (c < 0) throw new Error('tracé illisible');
    v += (c & 31) * decalage;
    decalage *= 32;
  } while (c & 32);
  return v % 2 ? -(v + 1) / 2 : v / 2;
}

/** Tous les entiers d'une chaîne. */
export function entiers(s) {
  const curseur = { i: 0 };
  const res = [];
  while (curseur.i < s.length) res.push(entier(s, curseur));
  return res;
}

/**
 * Anneaux d'une entité : [{ trou, lon: Float64Array, lat: Float64Array }].
 * `code` : la partie après le deuxième deux-points d'une ligne de contours.js.
 */
export function decoderAnneaux(code, grille = 1000) {
  const res = [];
  for (const part of code.split('|')) {
    const trou = part.startsWith('~');
    const s = trou ? part.slice(1) : part;
    const curseur = { i: 0 };
    const n = entier(s, curseur);
    const lon = new Float64Array(n);
    const lat = new Float64Array(n);
    let x = 0;
    let y = 0;
    for (let k = 0; k < n; k++) {
      x += entier(s, curseur);
      y += entier(s, curseur);
      lon[k] = x / grille;
      lat[k] = y / grille;
    }
    res.push({ trou, lon, lat });
  }
  return res;
}

/** Entités d'une liste de lignes « code:nom:tracé » : [{ code, nom, anneaux }]. */
export function decoderContours(lignes, grille = 1000) {
  return lignes.map((l) => {
    const a = l.indexOf(':');
    const b = l.indexOf(':', a + 1);
    return { code: l.slice(0, a), nom: l.slice(a + 1, b), anneaux: decoderAnneaux(l.slice(b + 1), grille) };
  });
}

/** Codes postaux : Map('56100' → { lon, lat }). */
export function decoderCodesPostaux(s, grille = 1000) {
  const curseur = { i: 0 };
  const res = new Map();
  let code = 0;
  let x = 0;
  let y = 0;
  while (curseur.i < s.length) {
    code += entier(s, curseur);
    x += entier(s, curseur);
    y += entier(s, curseur);
    res.set(String(code).padStart(5, '0'), { lon: x / grille, lat: y / grille });
  }
  return res;
}

/**
 * Projection locale : longitude et latitude → x et z du plateau. Un degré de latitude vaut toujours la même distance ;
 * un degré de longitude vaut cos(latitude) fois moins. On corrige au parallèle de référence, et on garde cette
 * correction partout : sur la France entière, la déformation reste de quelques pour cent, invisible sur une carte de
 * jeu, et le code reste un module pur de dix lignes.
 * Le nord est vers les z négatifs, comme le quartier nord de la ville.
 */
export function projection({ lon0 = -3, lat0 = 48.1, unitesParKm = UNITES_PAR_KM } = {}) {
  const u = KM_PAR_DEGRE * unitesParKm;
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    lon0,
    lat0,
    unitesParKm,
    x: (lon) => (lon - lon0) * k * u,
    z: (lat) => -(lat - lat0) * u,
    lon: (x) => lon0 + x / (k * u),
    lat: (z) => lat0 - z / u,
  };
}

/** Code postal français d'une valeur, ou du premier groupe de 5 chiffres d'une adresse. null si rien n'y ressemble. */
export function codePostalDe(valeur) {
  const s = String(valeur ?? '');
  const exact = s.trim();
  if (/^\d{5}$/.test(exact)) return exact === '00000' ? null : exact;
  const trouve = /(?:^|[^\d])(\d{5})(?:[^\d]|$)/.exec(s);
  return trouve && trouve[1] !== '00000' ? trouve[1] : null;
}

/** Nº de département d'un code postal (« 56100 » → « 56 », « 97400 » → « 974 »). */
export function departementDuCode(cp) {
  if (!cp) return null;
  const deux = cp.slice(0, 2);
  return deux === '97' || deux === '98' ? cp.slice(0, 3) : deux;
}

/**
 * Point d'une fiche : son code postal (champ « code_postal », sinon celui que porte l'adresse), puis le point de ce
 * code dans la table. Retourne { cp, lon, lat } ou null — et null veut dire « on ne sait pas », jamais « au milieu
 * du département ». `champs` : { code_postal, adresse }.
 */
export function pointDe({ code_postal: codePostal, adresse } = {}, table) {
  const cp = codePostalDe(codePostal) ?? codePostalDe(adresse);
  if (!cp) return null;
  const p = table?.get(cp);
  return p ? { cp, lon: p.lon, lat: p.lat } : null;
}

/** Un point est-il dans un anneau ? (lancer de rayon horizontal, règle pair-impair) */
export function dansAnneau({ lon, lat }, px, py) {
  let dedans = false;
  for (let i = 0, j = lon.length - 1; i < lon.length; j = i++) {
    const xi = lon[i];
    const yi = lat[i];
    const xj = lon[j];
    const yj = lat[j];
    if ((yi > py) !== (yj > py) && px < xi + ((py - yi) * (xj - xi)) / (yj - yi)) dedans = !dedans;
  }
  return dedans;
}

/** Un point est-il dans l'entité ? (dans un anneau plein, et dans aucun de ses trous) */
export function dansEntite(anneaux, px, py) {
  let plein = false;
  for (const a of anneaux) {
    if (!dansAnneau(a, px, py)) continue;
    if (a.trou) return false;
    plein = true;
  }
  return plein;
}

/** Boîte englobante d'une entité : { lonMin, lonMax, latMin, latMax }. */
export function boiteDe(anneaux) {
  let lonMin = Infinity;
  let lonMax = -Infinity;
  let latMin = Infinity;
  let latMax = -Infinity;
  for (const a of anneaux) {
    for (let i = 0; i < a.lon.length; i++) {
      if (a.lon[i] < lonMin) lonMin = a.lon[i];
      if (a.lon[i] > lonMax) lonMax = a.lon[i];
      if (a.lat[i] < latMin) latMin = a.lat[i];
      if (a.lat[i] > latMax) latMax = a.lat[i];
    }
  }
  return { lonMin, lonMax, latMin, latMax };
}

/**
 * Point où écrire le nom d'une entité : le centre de son plus grand anneau plein (pas la moyenne de tous, qui
 * tirerait le nom du Finistère vers Ouessant). Le centre d'un polygone en croissant peut tomber dehors : on
 * retombe alors sur le milieu de sa boîte, ramené dans le polygone si possible.
 */
export function ancreDe(anneaux) {
  let meilleur = null;
  let aireMax = 0;
  for (const a of anneaux) {
    if (a.trou) continue;
    let s = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = a.lon.length - 1; i < a.lon.length; j = i++) {
      const f = a.lon[j] * a.lat[i] - a.lon[i] * a.lat[j];
      s += f;
      cx += (a.lon[j] + a.lon[i]) * f;
      cy += (a.lat[j] + a.lat[i]) * f;
    }
    const aire = Math.abs(s) / 2;
    if (aire > aireMax && s !== 0) { aireMax = aire; meilleur = { lon: cx / (3 * s), lat: cy / (3 * s) }; }
  }
  if (meilleur && dansEntite(anneaux, meilleur.lon, meilleur.lat)) return meilleur;
  const b = boiteDe(anneaux);
  const milieu = { lon: (b.lonMin + b.lonMax) / 2, lat: (b.latMin + b.latMax) / 2 };
  return meilleur && !dansEntite(anneaux, milieu.lon, milieu.lat) ? meilleur : milieu;
}

/** Moyenne d'une liste de points { lon, lat } ; null si la liste est vide. */
export function moyenne(points) {
  if (!points.length) return null;
  let lon = 0;
  let lat = 0;
  for (const p of points) { lon += p.lon; lat += p.lat; }
  return { lon: lon / points.length, lat: lat / points.length };
}
