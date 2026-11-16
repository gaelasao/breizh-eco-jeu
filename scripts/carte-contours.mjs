/**
 * Living Business — fabrique les données géographiques de la carte (web/carte/contours.js et web/carte/communes.js).
 *
 * Source des tracés : IGN, ADMIN EXPRESS COG (édition 2018), sous Licence Ouverte / Open Licence (Etalab).
 *   https://github.com/gregoiredavid/france-geojson (conversion SHP → GeoJSON, déjà simplifiée à 25 %)
 * Source des points des codes postaux : API Découpage administratif (geo.api.gouv.fr), Licence Ouverte,
 *   centre de chaque commune (INSEE COG + IGN).
 *
 * Ce script n'est PAS embarqué dans les paquets (scripts/ n'est pas copié) et ne tourne pas au démarrage du jeu :
 * on le lance à la main quand le découpage administratif change.
 *
 *   node scripts/carte-contours.mjs <dossier-des-sources>
 *
 * Le dossier doit contenir regions-version-simplifiee.geojson, departements-version-simplifiee.geojson,
 * communes.json (geo.api.gouv.fr/communes?fields=nom,code,codesPostaux,centre) et
 * departements-regions.json (geo.api.gouv.fr/departements?fields=nom,code,codeRegion).
 *
 * Pourquoi un format maison plutôt que du GeoJSON : la passerelle sert ses fichiers tels quels, sans compression
 * HTTP. Le poids du fichier EST le poids téléchargé. Les tracés sont donc quantifiés sur une grille de 1/1000 de
 * degré (environ 110 m, invisible à l'échelle de la carte), les points écrits en différence du précédent, et chaque
 * nombre en base 64 à longueur variable. Le décodeur tient en vingt lignes dans web/carte/geographie.js.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const GRILLE = 1000; // 1/1000 de degré
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Chaîne écrite en littéral JavaScript entre apostrophes (« Provence-Alpes-Côte d'Azur » en porte une). */
const litteral = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** Régions de France métropolitaine, dans l'ordre d'affichage (les DROM ne sont pas sur cette carte). */
const REGIONS_METRO = ['11', '24', '27', '28', '32', '44', '52', '53', '75', '76', '84', '93', '94'];
/** Départements de la région Bretagne : les seuls tracés au détail fin. */
const BRETAGNE = ['22', '29', '35', '56'];
/** Départements hors métropole : ils ne sont pas sur cette carte. */
const HORS_METRO = ['971', '972', '973', '974', '976'];

// ---------------------------------------------------------------- encodage

/** Entier signé → base 64 à longueur variable (zigzag puis groupes de 5 bits, bit 6 = « la suite »). */
function nombre(n) {
  let v = n < 0 ? -n * 2 - 1 : n * 2;
  let s = '';
  while (v >= 32) {
    s += ALPHABET[(v & 31) | 32];
    v = Math.floor(v / 32);
  }
  return s + ALPHABET[v];
}

/** Suite de points [[lon, lat], …] → chaîne : nombre de points, puis chaque point en différence du précédent. */
function anneau(points) {
  let s = nombre(points.length);
  let px = 0;
  let py = 0;
  for (const [lon, lat] of points) {
    const x = Math.round(lon * GRILLE);
    const y = Math.round(lat * GRILLE);
    s += nombre(x - px) + nombre(y - py);
    px = x;
    py = y;
  }
  return s;
}

// ---------------------------------------------------------------- simplification

/** Distance au carré d'un point à un segment, en degrés corrigés (un degré de longitude vaut cos(lat) degré). */
function distanceCarree([x, y], [ax, ay], [bx, by], k) {
  const dx = (bx - ax) * k;
  const dy = by - ay;
  const px = (x - ax) * k;
  const py = y - ay;
  const l = dx * dx + dy * dy;
  const t = l > 0 ? Math.max(0, Math.min(1, (px * dx + py * dy) / l)) : 0;
  const ex = px - t * dx;
  const ey = py - t * dy;
  return ex * ex + ey * ey;
}

/** Douglas-Peucker, tolérance en degrés de latitude (1 degré ≈ 111 km). */
function simplifier(points, tolerance, k) {
  if (points.length < 3) return points;
  const garder = new Uint8Array(points.length);
  garder[0] = 1;
  garder[points.length - 1] = 1;
  const t2 = tolerance * tolerance;
  const pile = [[0, points.length - 1]];
  while (pile.length) {
    const [i, j] = pile.pop();
    let pire = -1;
    let imax = -1;
    for (let m = i + 1; m < j; m++) {
      const d = distanceCarree(points[m], points[i], points[j], k);
      if (d > pire) { pire = d; imax = m; }
    }
    if (pire > t2 && imax > 0) {
      garder[imax] = 1;
      pile.push([i, imax], [imax, j]);
    }
  }
  return points.filter((_, i) => garder[i]);
}

/** Aire algébrique d'un anneau, en degrés carrés corrigés (sert à écarter les cailloux et à orienter les anneaux). */
function aire(points, k) {
  let a = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    a += (points[j][0] - points[i][0]) * k * (points[j][1] + points[i][1]);
  }
  return a / 2;
}

/** Anneaux d'une géométrie GeoJSON (Polygon ou MultiPolygon) : [{ points, trou }]. */
function anneaux(geometrie) {
  const polys = geometrie.type === 'MultiPolygon' ? geometrie.coordinates : [geometrie.coordinates];
  return polys.flatMap((poly) => poly.map((ring, i) => ({ points: ring, trou: i > 0 })));
}

/**
 * Prépare les anneaux d'une entité : simplification, rejet des cailloux, fermeture retirée (le décodeur reboucle).
 * minAire : en kilomètres carrés ; une île plus petite ne se verrait pas et coûterait son anneau.
 */
function preparer(geometrie, { tolerance, minAire }) {
  const res = [];
  for (const { points, trou } of anneaux(geometrie)) {
    const lat = points.reduce((s, p) => s + p[1], 0) / points.length;
    const k = Math.cos((lat * Math.PI) / 180);
    const a = Math.abs(aire(points, k)) * 111.32 * 111.32;
    if (a < minAire) continue;
    let p = simplifier(points, tolerance, k);
    // anneau fermé dans la source : on retire le point répété
    if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p = p.slice(0, -1);
    if (p.length < 3) continue;
    res.push({ points: p, trou });
  }
  return res;
}

// ---------------------------------------------------------------- sorties

const source = process.argv[2];
if (!source) {
  console.error('Usage : node scripts/carte-contours.mjs <dossier-des-sources>');
  process.exit(2);
}
const lire = (f) => JSON.parse(readFileSync(join(source, f), 'utf8'));
const racine = new URL('../web/carte/', import.meta.url);

// --- contours : régions de métropole (fond et bordure) + départements bretons (bordure seule, détail fin)
{
  const regions = lire('regions-version-simplifiee.geojson').features
    .filter((f) => REGIONS_METRO.includes(f.properties.code))
    .sort((a, b) => REGIONS_METRO.indexOf(a.properties.code) - REGIONS_METRO.indexOf(b.properties.code));
  const departements = lire('departements-version-simplifiee.geojson').features
    .filter((f) => !HORS_METRO.includes(f.properties.code))
    .sort((a, b) => a.properties.code.localeCompare(b.properties.code));
  const regionDuDep = new Map(lire('departements-regions.json').map((d) => [d.code, d.codeRegion]));
  for (const f of departements) {
    const r = regionDuDep.get(f.properties.code);
    if (!r) throw new Error(`région inconnue pour le département ${f.properties.code}`);
    f.properties.region = r;
  }

  let points = 0;
  const encoder = (features, reglages) => features.map((f) => {
    const prepares = preparer(f.geometry, typeof reglages === 'function' ? reglages(f) : reglages);
    points += prepares.reduce((s, a) => s + a.points.length, 0);
    // « ~ » marque un trou : hors de l'alphabet base 64, il ne peut pas se confondre avec un chiffre du tracé
    return `${f.properties.code}:${f.properties.nom}:${prepares.map((a) => (a.trou ? '~' : '') + anneau(a.points)).join('|')}`;
  });
  // régions : vues de 2 500 unités de large, 900 m de tolérance restent sous le pixel ; les îles sous 12 km² sautent
  const lignesRegions = encoder(regions, { tolerance: 0.008, minAire: 12 });
  /* Départements : la Bretagne au détail fin (vue de 800 unités de large, 250 m de tolérance ; Belle-Île, Groix,
     Ouessant et Bréhat restent), les autres au détail des régions — assez pour que l'échelle du milieu marche aussi
     pour une entreprise d'ailleurs en France, sans payer le détail fin de 92 départements qu'on ne survole pas. */
  const lignesDeps = encoder(departements, (f) => (BRETAGNE.includes(f.properties.code)
    ? { tolerance: 0.0022, minAire: 1.2 }
    : { tolerance: 0.008, minAire: 12 }));

  const fichier = `/* Living Business — tracés du découpage administratif français, pour les échelles « Bretagne » et « France »
   de la carte (direction de design §5). Fichier FABRIQUÉ : ne pas modifier à la main, relancer
   \`node scripts/carte-contours.mjs <dossier-des-sources>\`.

   Source : IGN — ADMIN EXPRESS COG (édition 2018), sous Licence Ouverte / Open Licence (Etalab).
   Voir LICENCES-TIERS.md. Tracés simplifiés et quantifiés sur une grille de 1/1000 de degré (environ 110 m) :
   le format et son décodeur sont décrits dans web/carte/geographie.js.

   Une ligne vaut « code:nom:anneau|anneau|… » ; un anneau précédé de « ~ » est un trou (étang, enclave). */

/** Grille des coordonnées : 1/1000 de degré. */
export const GRILLE = ${GRILLE};

/** Régions de France métropolitaine (les DROM ne sont pas sur cette carte). */
export const REGIONS = Object.freeze([
${lignesRegions.map((l) => `  ${litteral(l)},`).join('\n')}
]);

/** Départements de métropole ; la Bretagne (22, 29, 35, 56) au détail fin, les autres au détail des régions. */
export const DEPARTEMENTS = Object.freeze([
${lignesDeps.map((l) => `  ${litteral(l)},`).join('\n')}
]);

/** Région de chaque département : c'est elle qui regroupe ses repères à l'échelle de la France. */
export const REGION_DU_DEPARTEMENT = Object.freeze({
${departements.map((f) => `  '${f.properties.code}': '${f.properties.region}',`).join('\n')}
});
`;
  writeFileSync(new URL('contours.js', racine), fichier);
  console.log(`contours.js : ${(fichier.length / 1024).toFixed(1)} kio, ${regions.length} régions, ${departements.length} départements, ${points} points`);
}

// --- communes : code postal → point (le centre de la commune qui porte ce code)
{
  const communes = lire('communes.json');
  // Un code postal couvre parfois plusieurs communes : on garde la première par code INSEE, un choix stable et
  // vérifiable. Le point sert à poser un repère à quelques kilomètres près, jamais à nommer la commune : le nom
  // affiché vient de la fiche du client (champ « ville »), jamais de cette table.
  const parCode = new Map();
  for (const c of communes.sort((a, b) => a.code.localeCompare(b.code))) {
    const p = c.centre?.coordinates;
    if (!p) continue;
    for (const cp of c.codesPostaux ?? []) if (/^\d{5}$/.test(cp) && !parCode.has(cp)) parCode.set(cp, p);
  }
  const codes = [...parCode.keys()].sort();
  let s = '';
  let pc = 0;
  let px = 0;
  let py = 0;
  for (const cp of codes) {
    const [lon, lat] = parCode.get(cp);
    const n = Number(cp);
    const x = Math.round(lon * GRILLE);
    const y = Math.round(lat * GRILLE);
    s += nombre(n - pc) + nombre(x - px) + nombre(y - py);
    pc = n;
    px = x;
    py = y;
  }
  const fichier = `/* Living Business — point de chaque code postal français, pour poser un client, un lieu ou un chantier
   sur la carte de France (direction de design §5). Fichier FABRIQUÉ : ne pas modifier à la main, relancer
   \`node scripts/carte-contours.mjs <dossier-des-sources>\`.

   Source : API Découpage administratif (geo.api.gouv.fr), Licence Ouverte / Open Licence (Etalab) — centre de la
   commune qui porte le code postal (INSEE COG et IGN). Voir LICENCES-TIERS.md.

   Un code postal couvre parfois plusieurs communes : le point est celui de la première par code INSEE. Il situe à
   quelques kilomètres près, ce qui est l'échelle de cette carte ; il ne sert jamais à nommer la commune. Le nom
   affiché vient toujours de la fiche (champ « ville »).

   Format : suite de triplets (code postal, longitude, latitude), chacun en différence du précédent, sur la grille de
   1/1000 de degré. Décodeur : web/carte/geographie.js. */

/** ${codes.length} codes postaux, du plus petit au plus grand. */
export const CODES_POSTAUX = '${s}';
`;
  writeFileSync(new URL('communes.js', racine), fichier);
  console.log(`communes.js : ${(fichier.length / 1024).toFixed(1)} kio, ${codes.length} codes postaux`);
}
