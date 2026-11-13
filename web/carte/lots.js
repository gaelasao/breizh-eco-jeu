/* Living Business — lots de rendu de la carte 3D (direction de design §5.10) : règles pures, sans three.js.
   La scène cuit ses maillages statiques en lots (un maillage par sorte de matériau) ; chaque sommet porte son calque
   (masque), l'orientation de son mur et son objet. Ce module dit quels masques existent, quels murs s'abaissent, quand
   les niveaux de détail s'affichent et où se range une enseigne dans l'atlas. Testé par src/ds/carte.test.ts. */

/** Calques de la carte, dans l'ordre : le masque d'un calque est 1 + son rang. */
export const NOMS_COUCHES = Object.freeze(['entreprise', 'clients', 'fournisseurs', 'partenaires', 'employes', 'presence', 'stock', 'vehicules', 'alertes', 'trafic', 'flux']);
/** Calques cuits en lots ; les autres bougent (alertes pulsées, voitures, colis) et restent des maillages à part. */
export const COUCHES_CUITES = Object.freeze(['entreprise', 'clients', 'fournisseurs', 'partenaires', 'employes', 'presence', 'stock', 'vehicules']);
/** Masques hors calques : 0 toujours visible ; niveaux de détail du décor et des intérieurs. */
export const MASQUE = Object.freeze({ toujours: 0, centreVille: 12, accessoires: 13, personnes: 14, mobilier: 15 });
export const NB_MASQUES = 16;
export const masqueCalque = (nom) => 1 + NOMS_COUCHES.indexOf(nom);

/** Orientation d'un mur (1 : x+, 2 : x−, 3 : z+, 4 : z−) d'après sa normale au sol. */
export function orientationMur(nx, nz) {
  return Math.abs(nx) > Math.abs(nz) ? (nx > 0 ? 1 : 2) : (nz > 0 ? 3 : 4);
}
export const NORMALES_MUR = Object.freeze([null, [1, 0], [-1, 0], [0, 1], [0, -1]]);
/** Seuil du produit scalaire au-delà duquel un mur fait face à la caméra (il s'abaisse à hauteur d'allège). */
export const SEUIL_FACE = 0.25;
/** Hauteur d'allège des murs abaissés (maison de poupée, §5.11). */
export const ALLEGE = 0.95;

/**
 * Murs abaissés, par orientation : [_, x+, x−, z+, z−] (0 ou 1). vers : direction horizontale de la cible vers la
 * caméra, normalisée ; ferme : toits affichés ou vue de dessus (aucun mur abaissé).
 */
export function mursBaisses([vx, vz], ferme = false) {
  return NORMALES_MUR.map((n) => (n && !ferme && n[0] * vx + n[1] * vz > SEUIL_FACE ? 1 : 0));
}
/** Échelle verticale d'un mur de hauteur h : 1 debout, allège / h abaissé. */
export const echelleMur = (baisse, h) => (baisse ? ALLEGE / (h || 3.4) : 1);

/**
 * Niveaux de détail (§5.10) : silhouettes et mobilier seulement de près (moins de 60 % de la distance maximale, comme
 * les petits accessoires), jamais en qualité Économie (§5.11 : coupe sans mobilier, personnes en pastilles).
 */
export function details({ distance, maxDistance, economie = false, employes = true, entreprise = true }) {
  const proche = distance < 0.6 * maxDistance;
  return { personnes: !economie && proche && employes, mobilier: !economie && proche && entreprise, accessoires: !economie && proche };
}

/**
 * Une pièce d'un lieu est du mobilier si elle dépasse du sol (plus de 30 cm) et que son centre est dans l'emprise du
 * bâtiment (l × p, centrée sur l'origine du lieu) : postes, accueil, rayonnages. Le quai ou le parking restent visibles.
 */
export function estMobilier({ cx, cz, haut }, { l, p }) {
  return haut > 0.3 && Math.abs(cx) < l / 2 && Math.abs(cz) < p / 2;
}

/** Atlas des enseignes : pages de 1 024 × 480 px, 2 colonnes × 5 rangées d'enseignes de 512 × 96 px. */
export const ATLAS_ENSEIGNES = Object.freeze({ largeur: 1024, hauteur: 480, enseigneL: 512, enseigneH: 96, parPage: 10 });
/** Place de la n-ième enseigne : page et coin haut gauche en pixels. */
export function placeEnseigne(n) {
  const { parPage, enseigneL, enseigneH } = ATLAS_ENSEIGNES;
  const k = n % parPage;
  return { page: Math.floor(n / parPage), x0: (k % 2) * enseigneL, y0: Math.floor(k / 2) * enseigneH };
}
/** Coordonnées de texture d'un coin (u, v en 0..1 sur l'enseigne) dans la page (texture retournée : v = 1 en haut). */
export function uvEnseigne(u, v, { x0, y0 }) {
  const { largeur, hauteur, enseigneL, enseigneH } = ATLAS_ENSEIGNES;
  return [(x0 + u * enseigneL) / largeur, 1 - (y0 + (1 - v) * enseigneH) / hauteur];
}

/** '#rrggbb' → [r, g, b] en 0..1 (sRVB, tel quel). */
export const rvb = (hex) => [1, 3, 5].map((i) => Number.parseInt(String(hex).slice(i, i + 2), 16) / 255);
