/* Living Business — atlas partagé des modèles 3D (direction de design §5.10, §8.2).
   Module PUR : aucun accès au DOM ni à three.js ; testé par src/ds/carte.test.ts.

   scene.js active THREE.Cache : tous les modèles d'un pack reçoivent LA MÊME image (un seul ImageBitmap par fichier),
   gardée pour la session et rendue telle quelle à la scène suivante (après un changement de qualité, par exemple).
   Règle : cette image n'est jamais fermée. La fermer la détache pour la texture commune et pour toutes les scènes
   suivantes : immeubles, voitures et mobilier sortent noirs (« texSubImage2D: The source data has been detached »). */

/** Côté de l'atlas hors qualité Haute (§5.10). */
export const COTE_ATLAS_REDUIT = 512;

/**
 * Texture à utiliser pour un modèle : la première rencontrée d'un pack devient la texture commune ; les suivantes sont
 * libérées (dispose : côté carte graphique seulement, jamais l'image) et remplacées par elle.
 * atlas : Map tenue par l'appelant, une entrée par pack. Retourne { texture, premiere }.
 */
export function partagerAtlas(atlas, cle, texture) {
  const commune = atlas.get(cle);
  if (!commune) { atlas.set(cle, texture); return { texture, premiere: true }; }
  if (commune !== texture) texture.dispose?.();
  return { texture: commune, premiere: false };
}

/**
 * Copie réduite d'une image d'atlas (aplats de couleur) : 512 px de large au lieu de 1 024, soit 4 fois moins de mémoire
 * vidéo. Retourne le canevas réduit, ou null s'il n'y a rien à réduire. L'image d'origine reste ouverte : elle est dans
 * le cache et resservira à la prochaine scène. creerCanevas : () => canevas (document.createElement('canvas') dans la page).
 */
export function reduireImage(image, creerCanevas, cote = COTE_ATLAS_REDUIT) {
  if (!image?.width || !image.height || image.width <= cote) return null;
  const c = creerCanevas();
  c.width = cote;
  c.height = Math.round((cote * image.height) / image.width);
  c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
  return c;
}
