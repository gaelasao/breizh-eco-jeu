/**
 * Icônes de l'application installable (PWA), dessinées sans aucune dépendance (node:zlib pour le PNG) : le symbole
 * « Moucheture » de Living Business (direction de design §2.3) — moucheture d'hermine blanche dont la queue a trois
 * lobes, sous trois points dont celui du sommet, en Ajonc, est « la lumière » ; conteneur Iroise, rayon 23 %.
 * Géométrie : celle de web/symbole-living-business.svg (grille de 48), vérifiée par scripts/icones.test.ts.
 *
 *   node scripts/icones.ts   → web/icone-192.png, icone-512.png (conteneur arrondi), icone-maskable-192.png,
 *                              icone-maskable-512.png (plein cadre, symbole à 60 % : le système applique son masque),
 *                              apple-touch-icon.png (180 px, plein cadre, symbole à 62 %, sans transparence)
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

type Rgba = [number, number, number, number];
export type Forme = 'arrondie' | 'pleine';

const IROISE: Rgba = [0x00, 0x6f, 0x85, 255];
const BLANC: Rgba = [255, 255, 255, 255];
const AJONC: Rgba = [0xf7, 0xc3, 0x23, 255];

// ---------------------------------------------------------------- la Moucheture (grille de 48, §2.3)
/** Queue : un départ puis des courbes de Bézier cubiques (mêmes coordonnées que le tracé SVG). */
export const QUEUE = Object.freeze({
  depart: [24, 15.5] as const,
  courbes: [
    [23, 24, 19.5, 31, 13, 38.5], [15.6, 38.7, 17.7, 37.7, 19, 36], [20.3, 39.2, 22, 41.8, 24, 44],
    [26, 41.8, 27.7, 39.2, 29, 36], [30.3, 37.7, 32.4, 38.7, 35, 38.5], [28.5, 31, 25, 24, 24, 15.5],
  ] as const,
});
/** Points : gauche, droit (blancs) et sommet (Ajonc, « la lumière »). */
export const POINTS = Object.freeze([
  { x: 13.5, y: 17, r: 4.5, ajonc: false }, { x: 34.5, y: 17, r: 4.5, ajonc: false }, { x: 24, y: 9.5, r: 4.5, ajonc: true },
]);
export const RAYON_CONTENEUR = 11 / 48;

/** Contour de la queue aplati en polygone (24 segments par courbe). */
const POLYGONE: Array<[number, number]> = (() => {
  const pts: Array<[number, number]> = [[QUEUE.depart[0], QUEUE.depart[1]]];
  let [x0, y0]: [number, number] = [QUEUE.depart[0], QUEUE.depart[1]];
  for (const [x1, y1, x2, y2, x3, y3] of QUEUE.courbes) {
    for (let k = 1; k <= 24; k++) {
      const t = k / 24;
      const m = 1 - t;
      pts.push([m * m * m * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3, m * m * m * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3]);
    }
    [x0, y0] = [x3, y3];
  }
  return pts;
})();
function dansQueue(x: number, y: number): boolean {
  let dedans = false;
  for (let i = 0, j = POLYGONE.length - 1; i < POLYGONE.length; j = i++) {
    const [xi, yi] = POLYGONE[i] as [number, number];
    const [xj, yj] = POLYGONE[j] as [number, number];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

/** Couleur d'un point (u, v ∈ [0, 1]) de l'icône, ou null hors de la forme (transparent). `echelle` : part du côté occupée par la grille de 48. */
function couleur(u: number, v: number, forme: Forme, echelle: number): Rgba | null {
  if (forme === 'arrondie') {
    const r = RAYON_CONTENEUR;
    const dx = Math.max(r - u, 0, u - (1 - r));
    const dy = Math.max(r - v, 0, v - (1 - r));
    if (dx * dx + dy * dy > r * r) return null;
  }
  const gx = ((u - 0.5) / echelle) * 48 + 24;
  const gy = ((v - 0.5) / echelle) * 48 + 24;
  for (const p of POINTS) if ((gx - p.x) ** 2 + (gy - p.y) ** 2 <= p.r * p.r) return p.ajonc ? AJONC : BLANC;
  if (dansQueue(gx, gy)) return BLANC;
  return IROISE;
}

/** Pixels RGBA (8 bits), lissés par sur-échantillonnage 4 × 4. */
export function pixelsIcone(cote: number, forme: Forme, echelle: number): Buffer {
  const px = Buffer.alloc(cote * cote * 4);
  const N = 4;
  for (let y = 0; y < cote; y++) {
    for (let x = 0; x < cote; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
        const c = couleur((x + (sx + 0.5) / N) / cote, (y + (sy + 0.5) / N) / cote, forme, echelle);
        if (!c) continue;
        r += c[0]; g += c[1]; b += c[2]; a += 1;
      }
      const i = (y * cote + x) * 4;
      if (a > 0) { px[i] = Math.round(r / a); px[i + 1] = Math.round(g / a); px[i + 2] = Math.round(b / a); }
      px[i + 3] = Math.round((a / (N * N)) * 255);
    }
  }
  return px;
}

// ---------------------------------------------------------------- PNG (RGBA 8 bits, sans filtre, zlib)
const TABLE_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(octets: Uint8Array): number {
  let c = 0xffffffff;
  for (const o of octets) c = (TABLE_CRC[(c ^ o) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function bloc(type: string, donnees: Buffer): Buffer {
  const longueur = Buffer.alloc(4);
  longueur.writeUInt32BE(donnees.length);
  const corps = Buffer.concat([Buffer.from(type, 'ascii'), donnees]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corps));
  return Buffer.concat([longueur, corps, crc]);
}

/** Lignes PNG brutes : un octet de filtre (0) puis les pixels de la ligne. */
export function lignesBrutes(largeur: number, hauteur: number, rgba: Buffer): Buffer {
  const brut = Buffer.alloc((largeur * 4 + 1) * hauteur);
  for (let y = 0; y < hauteur; y++) rgba.copy(brut, y * (largeur * 4 + 1) + 1, y * largeur * 4, (y + 1) * largeur * 4);
  return brut;
}

export function png(largeur: number, hauteur: number, rgba: Buffer): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8; // bits par composante
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloc('IHDR', ihdr),
    bloc('IDAT', deflateSync(lignesBrutes(largeur, hauteur, rgba), { level: 9 })),
    bloc('IEND', Buffer.alloc(0)),
  ]);
}

/** Les icônes publiées : nom de fichier dans web/, côté, forme, part du côté occupée par la grille de 48 du symbole. */
export const ICONES: readonly { nom: string; cote: number; forme: Forme; echelle: number }[] = [
  { nom: 'icone-192.png', cote: 192, forme: 'arrondie', echelle: 1 },
  { nom: 'icone-512.png', cote: 512, forme: 'arrondie', echelle: 1 },
  { nom: 'icone-maskable-192.png', cote: 192, forme: 'pleine', echelle: 0.6 },
  { nom: 'icone-maskable-512.png', cote: 512, forme: 'pleine', echelle: 0.6 },
  { nom: 'apple-touch-icon.png', cote: 180, forme: 'pleine', echelle: 0.62 },
];

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const web = new URL('../web/', import.meta.url);
  for (const i of ICONES) {
    writeFileSync(new URL(i.nom, web), png(i.cote, i.cote, pixelsIcone(i.cote, i.forme, i.echelle)));
    console.log(`web/${i.nom} (${i.cote} × ${i.cote})`);
  }
}
