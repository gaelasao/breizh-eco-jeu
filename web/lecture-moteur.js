/* Living Business — le moteur qui lit la photo d'un justificatif. DANS LE NAVIGATEUR, ET NULLE PART AILLEURS.

   LA PHOTO NE QUITTE PAS L'APPAREIL. Le moteur de lecture (tesseract.js, Apache-2.0) et le modèle français tournent
   dans un fil de travail du navigateur, sur l'image déjà présente en mémoire. Rien n'est envoyé : ni au serveur de
   l'entreprise, ni à l'éditeur, ni à personne. C'est aussi pour ça que ça ne coûte rien au serveur.

   CHARGÉ À LA DEMANDE. Rien de tout ça n'est dans ce qui se télécharge au premier écran : le moteur et le modèle sont
   demandés la PREMIÈRE FOIS qu'on photographie un justificatif, depuis Living Business lui-même (`BASE`, servi par
   src/passerelle/statiques.ts — jamais depuis un site tiers), puis gardés en cache par web/sw.js et, pour le modèle,
   par le moteur lui-même. Quelqu'un qui ne photographie jamais rien ne télécharge jamais rien.
   Une fois en cache, ça marche HORS LIGNE : au fond d'un hangar, sans réseau, la lecture continue de fonctionner.

   SI ÇA NE SE CHARGE PAS, RIEN NE CASSE. `lirePhoto` ne jette jamais : elle répond `{ echec }`, et l'écran revient à
   ce qu'il était — trois champs à remplir à la main. C'est dit en une phrase, sans jargon.

   L'analyse, elle, est ailleurs : web/lecture-photo.js, module pur, testé sans navigateur. Ici il n'y a que le
   chargement, la préparation de l'image et le fil de travail. */

import { lireLaPhoto } from './lecture-photo.js';

/**
 * Dossier d'où viennent le moteur et le modèle français. La version est dans le chemin : une nouvelle version change
 * l'adresse, donc le cache. MÊME VALEUR qu'au serveur (`LECTURE_BASE` de src/passerelle/statiques.ts).
 */
export const BASE = '/lecture/7.0.0/';
/** Langue du modèle : le français seul. Un modèle par langue, et on n'en charge pas d'autre. */
export const LANGUE = 'fra';

/**
 * Le cœur du moteur existe en deux formes. Celle qui utilise les instructions vectorielles du processeur est deux à
 * trois fois plus rapide, et tous les navigateurs depuis 2021 la savent lire ; l'autre est le filet de sécurité.
 * On choisit ICI, et on donne au moteur le chemin EXACT du fichier : laissé libre, il prendrait la variante qui porte
 * son WebAssembly recopié en texte dans le fichier, un mégaoctet de plus à télécharger pour rien.
 */
export const COEURS = Object.freeze({ vectoriel: 'tesseract-core-simd-lstm.js', simple: 'tesseract-core-lstm.js' });
/** Le plus petit module WebAssembly qui n'est valide qu'avec les instructions vectorielles (même sonde que `wasm-feature-detect`). */
const SONDE_VECTORIELLE = Object.freeze([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]);

/** Le cœur à charger sur cet appareil. */
export function coeurPour(fenetre = globalThis) {
  try {
    return fenetre.WebAssembly.validate(new Uint8Array(SONDE_VECTORIELLE)) ? COEURS.vectoriel : COEURS.simple;
  } catch {
    return COEURS.simple;
  }
}

/** Plus grand côté de l'image envoyée au moteur : au-delà on perd du temps sans rien gagner. */
export const COTE_MAX = 1800;
/** Plus petit côté utile : en dessous, les lettres sont trop petites pour être reconnues — on agrandit. */
export const COTE_MIN = 1200;

/** Ce qu'on dit quand le moteur ne se charge pas. Pas de jargon : la personne tape les trois champs, comme avant. */
export const ECHEC_MOTEUR = 'La lecture automatique n’a pas pu démarrer : saisissez les trois champs à la main.';
/** Ce qu'on dit quand la photo n'a pas pu être ouverte (format que ce navigateur ne sait pas décoder). */
export const ECHEC_IMAGE = 'Cette photo n’a pas pu être ouverte pour la lecture : saisissez les trois champs à la main.';

/** Étapes annoncées à l'écran, dans l'ordre. Le premier chargement est le seul long : on le dit, avec sa progression. */
export const ETAPES = Object.freeze({
  moteur: 'Chargement du lecteur (une seule fois)',
  modele: 'Chargement du français (une seule fois)',
  lecture: 'Lecture de la photo',
});

/**
 * Le navigateur sait-il faire ? Il faut WebAssembly, les fils de travail et le décodage d'image hors écran. Tout
 * navigateur de 2021 ou plus les a ; sur un plus ancien, le bouton de lecture n'apparaît pas du tout.
 */
export function moteurPossible(fenetre = globalThis) {
  return Boolean(fenetre && typeof fenetre.WebAssembly === 'object' && typeof fenetre.Worker === 'function'
    && typeof fenetre.createImageBitmap === 'function' && typeof fenetre.OffscreenCanvas === 'function');
}

// ---------------------------------------------------------------- préparer l'image

/** Une toile hors écran de cette taille (OffscreenCanvas : le fil principal n'est pas bloqué par le dessin). */
const toile = (l, h, fenetre) => new fenetre.OffscreenCanvas(l, h);

/**
 * Taille à laquelle lire : un ticket photographié de près fait 3 000 px de large, soit trois fois plus que ce qui
 * sert ; une capture d'écran minuscule, elle, s'agrandit. Le rapport est gardé.
 */
export function tailleDeLecture(largeur, hauteur, { coteMax = COTE_MAX, coteMin = COTE_MIN } = {}) {
  const grand = Math.max(largeur, hauteur);
  if (!(grand > 0)) return { largeur: 0, hauteur: 0, echelle: 1 };
  const echelle = grand > coteMax ? coteMax / grand : grand < coteMin ? Math.min(2, coteMin / grand) : 1;
  return { largeur: Math.max(1, Math.round(largeur * echelle)), hauteur: Math.max(1, Math.round(hauteur * echelle)), echelle };
}

/**
 * Noir et blanc, seuil calculé LOCALEMENT (moyenne du voisinage, par image intégrale). C'est ce qui sauve les photos
 * mal éclairées : une photo prise dans l'ombre d'une camionnette a un coin sombre et un coin clair, et un seuil
 * unique pour toute l'image y perd la moitié du texte.
 */
export function seuillerSurPlace(donnees, largeur, hauteur, { part = 0.85 } = {}) {
  const n = largeur * hauteur;
  const gris = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * 4;
    gris[i] = (donnees[p] * 77 + donnees[p + 1] * 151 + donnees[p + 2] * 28) >> 8;
  }
  // image intégrale : la somme d'un rectangle se lit en quatre accès, quelle que soit la taille de la fenêtre
  const somme = new Int32Array((largeur + 1) * (hauteur + 1));
  for (let y = 0; y < hauteur; y++) {
    let ligne = 0;
    for (let x = 0; x < largeur; x++) {
      ligne += gris[y * largeur + x];
      somme[(y + 1) * (largeur + 1) + (x + 1)] = somme[y * (largeur + 1) + (x + 1)] + ligne;
    }
  }
  const demi = Math.max(7, Math.round(largeur / 48));
  for (let y = 0; y < hauteur; y++) {
    const y0 = Math.max(0, y - demi);
    const y1 = Math.min(hauteur - 1, y + demi);
    for (let x = 0; x < largeur; x++) {
      const x0 = Math.max(0, x - demi);
      const x1 = Math.min(largeur - 1, x + demi);
      const aire = (x1 - x0 + 1) * (y1 - y0 + 1);
      const s = somme[(y1 + 1) * (largeur + 1) + (x1 + 1)] - somme[y0 * (largeur + 1) + (x1 + 1)]
        - somme[(y1 + 1) * (largeur + 1) + x0] + somme[y0 * (largeur + 1) + x0];
      const noir = gris[y * largeur + x] * aire < s * part;
      const p = (y * largeur + x) * 4;
      const v = noir ? 0 : 255;
      donnees[p] = v; donnees[p + 1] = v; donnees[p + 2] = v; donnees[p + 3] = 255;
    }
  }
  return donnees;
}

/** Gris simple (luminance) : ce qu'on essaie quand le noir et blanc a mangé un ticket thermique trop pâle. */
export function grisSurPlace(donnees) {
  for (let p = 0; p < donnees.length; p += 4) {
    const g = (donnees[p] * 77 + donnees[p + 1] * 151 + donnees[p + 2] * 28) >> 8;
    donnees[p] = g; donnees[p + 1] = g; donnees[p + 2] = g; donnees[p + 3] = 255;
  }
  return donnees;
}

/** La photo, mise à la taille de lecture et préparée. `mode` : « seuil » (noir et blanc local) ou « gris ». */
export async function preparerImage(image, { mode = 'seuil', fenetre = globalThis } = {}) {
  const t = tailleDeLecture(image.width, image.height);
  const t2d = toile(t.largeur, t.hauteur, fenetre);
  const ctx = t2d.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, t.largeur, t.hauteur);
  const brut = ctx.getImageData(0, 0, t.largeur, t.hauteur);
  if (mode === 'seuil') seuillerSurPlace(brut.data, t.largeur, t.hauteur);
  else grisSurPlace(brut.data);
  ctx.putImageData(brut, 0, 0);
  return t2d;
}

// ---------------------------------------------------------------- le moteur

/** Le fil de travail, chargé une seule fois par session. */
let attente = null;

/**
 * Les lignes lues, avec la confiance de chacune : c'est ce que l'analyseur pur attend, et c'est elle qui permet de
 * laisser un champ vide au lieu de deviner. Le texte entier sert de repli si le moteur ne détaille pas.
 */
export function lignesDuResultat(donnees) {
  const lignes = [];
  for (const bloc of donnees?.blocks ?? []) {
    for (const p of bloc?.paragraphs ?? []) {
      for (const l of p?.lines ?? []) {
        const texte = String(l?.text ?? '').replace(/\s+$/, '');
        if (texte.trim()) lignes.push({ texte, confiance: Number.isFinite(Number(l?.confidence)) ? Number(l.confidence) : 100 });
      }
    }
  }
  if (lignes.length) return { lignes };
  const texte = String(donnees?.text ?? '');
  const confiance = Number.isFinite(Number(donnees?.confidence)) ? Number(donnees.confidence) : 100;
  return { lignes: texte.split(/\r?\n/).map((t) => ({ texte: t, confiance })) };
}

/**
 * Charge le moteur et le modèle français DEPUIS LIVING BUSINESS. Les trois chemins sont donnés explicitement : sans
 * eux, tesseract.js irait les chercher sur un réseau de diffusion tiers, ce qui est exclu (la photo reste ici, et
 * l'adresse de l'entreprise ne part nulle part). `workerBlobURL: false` garde une adresse en clair, que le cache du
 * navigateur et web/sw.js savent retenir.
 */
export async function chargerMoteur({ base = BASE, surProgres = () => undefined, fenetre = globalThis } = {}) {
  if (attente) return attente;
  attente = (async () => {
    const T = await import(`${base}tesseract.esm.min.js`);
    const creer = T.createWorker ?? T.default?.createWorker;
    if (typeof creer !== 'function') throw new Error('moteur inattendu');
    const w = await creer(LANGUE, 1, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}${coeurPour(fenetre)}`,
      langPath: base.replace(/\/$/, ''),
      workerBlobURL: false,
      gzip: true,
      // le modèle est gardé par le navigateur sous cette clé : elle porte la version, sinon un modèle remplacé
      // continuerait d'être relu depuis l'ancien enregistrement
      cachePath: base.replace(/\/$/, ''),
      logger: (m) => {
        const etape = m?.status === 'loading language traineddata' ? ETAPES.modele
          : m?.status === 'recognizing text' ? ETAPES.lecture : ETAPES.moteur;
        surProgres({ etape, part: Math.max(0, Math.min(1, Number(m?.progress) || 0)) });
      },
    }, { legacyCore: false, legacyLang: false });
    // on garde les colonnes : sur une facture, « Total TTC » et sa valeur restent sur la même ligne
    await w.setParameters({ preserve_interword_spaces: '1' });
    return w;
  })().catch((e) => { attente = null; throw e; });
  return attente;
}

/** Ferme le fil de travail et rend la mémoire (changement de compte, essais). */
export async function oublierMoteur() {
  const w = attente;
  attente = null;
  try { await (await w)?.terminate(); } catch { /* déjà fermé */ }
}

/**
 * Lit la photo et PROPOSE les trois champs. Ne jette jamais : `{ echec }` quand le moteur ou l'image n'ont pas pu
 * être ouverts — l'écran revient alors exactement à ce qu'il était, trois champs à remplir.
 *
 * Deux essais au plus : noir et blanc d'abord (c'est ce qui marche sur une photo mal éclairée), puis gris simple si
 * rien n'a été trouvé (un ticket thermique pâle survit mieux en gris). On s'arrête dès que les trois champs sont là.
 */
export async function lirePhoto(fichier, { base = BASE, surProgres = () => undefined, aujourdhui = '', fournisseursConnus = [], fenetre = globalThis } = {}) {
  if (!moteurPossible(fenetre)) return { echec: ECHEC_MOTEUR };
  let image = null;
  try {
    image = await fenetre.createImageBitmap(fichier);
  } catch {
    return { echec: ECHEC_IMAGE };
  }
  try {
    const w = await chargerMoteur({ base, surProgres, fenetre });
    let meilleur = null;
    for (const mode of ['seuil', 'gris']) {
      const prete = await preparerImage(image, { mode, fenetre });
      const { data } = await w.recognize(prete, {}, { text: true, blocks: true });
      const lu = lireLaPhoto(lignesDuResultat(data), { aujourdhui, fournisseursConnus });
      const compte = (x) => (x.montant !== null ? 1 : 0) + (x.date ? 1 : 0) + (x.fournisseur ? 1 : 0);
      if (!meilleur || compte(lu) > compte(meilleur)) meilleur = lu;
      if (compte(meilleur) === 3) break;
    }
    return { lu: meilleur };
  } catch {
    return { echec: ECHEC_MOTEUR };
  } finally {
    try { image.close(); } catch { /* navigateur sans close() */ }
  }
}
