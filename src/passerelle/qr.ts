/**
 * Encodeur de QR code minimal, sans dépendance (ISO/IEC 18004) : mode octet, correction d'erreur M (≈ 15 %),
 * versions 1 à 40 (la plus petite qui convient), masque choisi par les règles de pénalité de la norme.
 * Sert au QR code de la validation en deux étapes (adresse `otpauth://…`, ~150 caractères → version 7 à 9).
 * Sortie : matrice de modules (vrai = sombre), SVG, adresse `data:` (autorisée par la CSP : `img-src 'self' data:`).
 */

/** Niveau M : codes de correction par bloc et nombre de blocs, versions 1 à 40 (indice = version). */
const CORRECTION_PAR_BLOC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NOMBRE_DE_BLOCS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
/** Bits d'indicateur du niveau M dans l'information de format. */
const NIVEAU_M = 0b00;

export const taille = (version: number): number => version * 4 + 17;

/** Modules disponibles pour les données et la correction (hors motifs fixes, format et version). */
export function modulesDonnees(version: number): number {
  let r = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const n = Math.floor(version / 7) + 2;
    r -= (25 * n - 10) * n - 55;
    if (version >= 7) r -= 36;
  }
  return r;
}

export const motsTotaux = (version: number): number => Math.floor(modulesDonnees(version) / 8);
export const blocs = (version: number) => ({ correction: CORRECTION_PAR_BLOC[version] as number, nombre: NOMBRE_DE_BLOCS[version] as number });
/** Mots de données (hors correction) au niveau M. */
export const motsDonnees = (version: number): number => motsTotaux(version) - blocs(version).correction * blocs(version).nombre;

/** Centres des motifs d'alignement (lignes et colonnes). */
export function alignements(version: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const pas = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (n * 2 - 2)) * 2;
  const r = [6];
  for (let pos = taille(version) - 7; r.length < n; pos -= pas) r.splice(1, 0, pos);
  return r;
}

// ---------------------------------------------------------------- Reed-Solomon sur GF(256), polynôme 0x11D

export function multiplierGf(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** Polynôme générateur de degré `degre` (coefficients, terme de plus haut degré omis). */
export function generateurRs(degre: number): number[] {
  const r: number[] = new Array<number>(degre).fill(0);
  r[degre - 1] = 1;
  let racine = 1;
  for (let i = 0; i < degre; i++) {
    for (let j = 0; j < r.length; j++) {
      r[j] = multiplierGf(r[j] as number, racine);
      if (j + 1 < r.length) r[j] = (r[j] as number) ^ (r[j + 1] as number);
    }
    racine = multiplierGf(racine, 0x02);
  }
  return r;
}

/** Mots de correction d'un bloc de données. */
export function correctionRs(donnees: readonly number[], degre: number): number[] {
  const g = generateurRs(degre);
  const r: number[] = new Array<number>(degre).fill(0);
  for (const b of donnees) {
    const facteur = b ^ (r.shift() as number);
    r.push(0);
    for (let i = 0; i < g.length; i++) r[i] = (r[i] as number) ^ multiplierGf(g[i] as number, facteur);
  }
  return r;
}

// ---------------------------------------------------------------- informations de format et de version

/** 15 bits de format (niveau M + masque), code BCH(15,5) puis masque 0x5412. */
export function bitsFormat(masque: number): number {
  const d = (NIVEAU_M << 3) | masque;
  let rem = d;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((d << 10) | rem) ^ 0x5412;
}

/** 18 bits de version (versions ≥ 7), code BCH(18,6). */
export function bitsVersion(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const bit = (x: number, i: number) => ((x >>> i) & 1) !== 0;

/** Condition d'inversion de chacun des 8 masques (x = colonne, y = ligne). */
export function masqueInverse(masque: number, x: number, y: number): boolean {
  switch (masque) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

// ---------------------------------------------------------------- construction

/** Mots de code (données + correction, entrelacés) pour une version donnée. */
export function motsDeCode(octets: Uint8Array, version: number): number[] {
  const capaciteBits = motsDonnees(version) * 8;
  const bitsCompte = version <= 9 ? 8 : 16;
  const bits: number[] = [];
  const pousser = (valeur: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((valeur >>> i) & 1); };
  pousser(0b0100, 4); // mode octet
  pousser(octets.length, bitsCompte);
  for (const o of octets) pousser(o, 8);
  if (bits.length > capaciteBits) throw new Error('QR code : texte trop long pour cette version');
  pousser(0, Math.min(4, capaciteBits - bits.length)); // terminateur
  pousser(0, (8 - (bits.length % 8)) % 8);
  const donnees: number[] = [];
  for (let i = 0; i < bits.length; i += 8) donnees.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let p = 0xec; donnees.length < motsDonnees(version); p ^= 0xec ^ 0x11) donnees.push(p);
  // découpage en blocs (les derniers ont un mot de données de plus), correction, entrelacement
  const { correction, nombre } = blocs(version);
  const total = motsTotaux(version);
  const courts = nombre - (total % nombre);
  const longueurCourte = Math.floor(total / nombre) - correction;
  const listeDonnees: number[][] = [];
  const listeCorrection: number[][] = [];
  for (let i = 0, k = 0; i < nombre; i++) {
    const n = longueurCourte + (i < courts ? 0 : 1);
    const d = donnees.slice(k, k + n);
    k += n;
    listeDonnees.push(d);
    listeCorrection.push(correctionRs(d, correction));
  }
  const sortie: number[] = [];
  for (let i = 0; i <= longueurCourte; i++) for (const d of listeDonnees) if (i < d.length) sortie.push(d[i] as number);
  for (let i = 0; i < correction; i++) for (const c of listeCorrection) sortie.push(c[i] as number);
  return sortie;
}

/** Plus petite version (1 à 40) qui contient ces octets au niveau M. */
export function versionPour(longueur: number): number {
  for (let v = 1; v <= 40; v++) if (4 + (v <= 9 ? 8 : 16) + longueur * 8 <= motsDonnees(v) * 8) return v;
  throw new Error('QR code : texte trop long');
}

class Grille {
  readonly n: number;
  readonly sombre: boolean[][];
  readonly fixe: boolean[][];
  constructor(n: number) {
    this.n = n;
    this.sombre = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    this.fixe = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
  }
  poser(x: number, y: number, s: boolean) {
    (this.sombre[y] as boolean[])[x] = s;
    (this.fixe[y] as boolean[])[x] = true;
  }
}

function motifsFixes(g: Grille, version: number) {
  const n = g.n;
  for (let i = 0; i < n; i++) { g.poser(6, i, i % 2 === 0); g.poser(i, 6, i % 2 === 0); }
  const reperes = [[3, 3], [n - 4, 3], [3, n - 4]] as const;
  for (const [cx, cy] of reperes) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= n || y >= n) continue;
      const d = Math.max(Math.abs(dx), Math.abs(dy));
      g.poser(x, y, d !== 2 && d !== 4);
    }
  }
  const pos = alignements(version);
  for (let i = 0; i < pos.length; i++) for (let j = 0; j < pos.length; j++) {
    if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) g.poser((pos[i] as number) + dx, (pos[j] as number) + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  format(g, 0); // réserve les emplacements (valeur définitive après choix du masque)
  if (version >= 7) {
    const b = bitsVersion(version);
    for (let i = 0; i < 18; i++) {
      const a = n - 11 + (i % 3);
      const c = Math.floor(i / 3);
      g.poser(a, c, bit(b, i));
      g.poser(c, a, bit(b, i));
    }
  }
}

function format(g: Grille, masque: number) {
  const n = g.n;
  const b = bitsFormat(masque);
  for (let i = 0; i <= 5; i++) g.poser(8, i, bit(b, i));
  g.poser(8, 7, bit(b, 6));
  g.poser(8, 8, bit(b, 7));
  g.poser(7, 8, bit(b, 8));
  for (let i = 9; i < 15; i++) g.poser(14 - i, 8, bit(b, i));
  for (let i = 0; i < 8; i++) g.poser(n - 1 - i, 8, bit(b, i));
  for (let i = 8; i < 15; i++) g.poser(8, n - 15 + i, bit(b, i));
  g.poser(8, n - 8, true); // module toujours sombre
}

/** Ordre de placement des modules de données : colonnes de 2, en zigzag, de droite à gauche (colonne 6 sautée). */
export function ordreZigzag(n: number, fixe: readonly (readonly boolean[])[]): [number, number][] {
  const ordre: [number, number][] = [];
  for (let droite = n - 1; droite >= 1; droite -= 2) {
    if (droite === 6) droite = 5;
    for (let v = 0; v < n; v++) {
      for (let j = 0; j < 2; j++) {
        const x = droite - j;
        const montant = ((droite + 1) & 2) === 0;
        const y = montant ? n - 1 - v : v;
        if (!(fixe[y] as readonly boolean[])[x]) ordre.push([x, y]);
      }
    }
  }
  return ordre;
}

function appliquerMasque(g: Grille, masque: number) {
  for (let y = 0; y < g.n; y++) for (let x = 0; x < g.n; x++) {
    if (!(g.fixe[y] as boolean[])[x] && masqueInverse(masque, x, y)) (g.sombre[y] as boolean[])[x] = !(g.sombre[y] as boolean[])[x];
  }
}

/** Pénalité (règles N1 à N4) : plus elle est basse, mieux le code se lit. */
export function penalite(m: readonly (readonly boolean[])[]): number {
  const n = m.length;
  const lignes: string[] = [];
  for (let y = 0; y < n; y++) lignes.push((m[y] as readonly boolean[]).map((s) => (s ? '1' : '0')).join(''));
  for (let x = 0; x < n; x++) lignes.push(m.map((r) => (r[x] ? '1' : '0')).join(''));
  let p = 0;
  for (const l of lignes) {
    for (const s of l.match(/0{5,}|1{5,}/g) ?? []) p += 3 + (s.length - 5); // N1
    const bord = `0000${l}0000`;
    for (const motif of ['10111010000', '00001011101']) {
      for (let i = bord.indexOf(motif); i >= 0; i = bord.indexOf(motif, i + 1)) p += 40; // N3
    }
  }
  let sombres = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const s = (m[y] as readonly boolean[])[x];
      if (s) sombres++;
      if (x + 1 < n && y + 1 < n && s === (m[y] as readonly boolean[])[x + 1] && s === (m[y + 1] as readonly boolean[])[x] && s === (m[y + 1] as readonly boolean[])[x + 1]) p += 3; // N2
    }
  }
  p += Math.floor(Math.abs((sombres * 100) / (n * n) - 50) / 5) * 10; // N4
  return p;
}

/** Matrice du QR code (vrai = module sombre), sans la marge. */
export function matriceQr(contenu: string | Uint8Array, o: { masque?: number } = {}): boolean[][] {
  const octets = typeof contenu === 'string' ? new TextEncoder().encode(contenu) : contenu;
  const version = versionPour(octets.length);
  const g = new Grille(taille(version));
  motifsFixes(g, version);
  const mots = motsDeCode(octets, version);
  const ordre = ordreZigzag(g.n, g.fixe);
  ordre.forEach(([x, y], i) => { (g.sombre[y] as boolean[])[x] = i < mots.length * 8 && bit(mots[i >>> 3] as number, 7 - (i & 7)); });
  let choisi = o.masque ?? -1;
  if (choisi < 0) {
    let meilleure = Infinity;
    for (let k = 0; k < 8; k++) {
      appliquerMasque(g, k);
      format(g, k);
      const p = penalite(g.sombre);
      if (p < meilleure) { meilleure = p; choisi = k; }
      appliquerMasque(g, k); // annule
    }
  }
  appliquerMasque(g, choisi);
  format(g, choisi);
  return g.sombre;
}

/** SVG (modules carrés, marge de 4 modules, noir sur blanc). */
export function qrSvg(contenu: string | Uint8Array, o: { marge?: number } = {}): string {
  const m = matriceQr(contenu);
  const marge = o.marge ?? 4;
  const cote = m.length + marge * 2;
  let d = '';
  m.forEach((ligne, y) => {
    for (let x = 0; x < ligne.length; x++) {
      if (!ligne[x]) continue;
      let fin = x;
      while (fin + 1 < ligne.length && ligne[fin + 1]) fin++;
      d += `M${x + marge} ${y + marge}h${fin - x + 1}v1H${x + marge}z`;
      x = fin;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${cote} ${cote}" shape-rendering="crispEdges"><rect width="${cote}" height="${cote}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

export const qrDataUrl = (contenu: string | Uint8Array): string => `data:image/svg+xml;base64,${Buffer.from(qrSvg(contenu)).toString('base64')}`;
