import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { crc32, ICONES, lignesBrutes, pixelsIcone, pixelsIconeMac, png, POINTS, QUEUE, RAYON_CONTENEUR } from './icones.ts';

/** Lecture minimale d'un PNG : blocs (CRC vérifié), en-tête, données décompressées. */
function lirePng(b: Buffer) {
  assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const idat: Buffer[] = [];
  let ihdr: Buffer | null = null;
  for (let p = 8; p < b.length;) {
    const n = b.readUInt32BE(p);
    const type = b.subarray(p + 4, p + 8).toString('ascii');
    const donnees = b.subarray(p + 8, p + 8 + n);
    assert.equal(b.readUInt32BE(p + 8 + n), crc32(b.subarray(p + 4, p + 8 + n)), `CRC du bloc ${type}`);
    if (type === 'IHDR') ihdr = donnees;
    if (type === 'IDAT') idat.push(donnees);
    p += 12 + n;
  }
  assert.ok(ihdr);
  return { largeur: ihdr.readUInt32BE(0), hauteur: ihdr.readUInt32BE(4), profondeur: ihdr[8], couleur: ihdr[9], brut: inflateSync(Buffer.concat(idat)) };
}

test('icônes : les PNG publiés sont exactement ceux que dessine scripts/icones.ts', () => {
  for (const i of ICONES) {
    const f = lirePng(readFileSync(new URL(`../web/${i.nom}`, import.meta.url)));
    assert.deepEqual([f.largeur, f.hauteur, f.profondeur, f.couleur], [i.cote, i.cote, 8, 6], i.nom);
    const px = pixelsIcone(i.cote, i.forme, i.echelle);
    assert.ok(f.brut.equals(lignesBrutes(i.cote, i.cote, px)), `${i.nom} : relancez « node scripts/icones.ts »`);
    const alpha = (x: number, y: number) => px[(y * i.cote + x) * 4 + 3];
    if (i.forme === 'arrondie') assert.equal(alpha(0, 0), 0, 'coins arrondis transparents');
    else for (let k = 3; k < px.length; k += 4) assert.equal(px[k], 255, `${i.nom} : sans transparence (masquable, iOS)`);
    // centre de l'icône : couleurs du symbole (Iroise, blanc ou Ajonc), jamais du noir
    const c = (i.cote / 2) * 4 * (i.cote + 1);
    assert.ok((px[c] as number) + (px[c + 1] as number) + (px[c + 2] as number) > 150);
  }
});

test('PNG : encodeur relu par un décodeur (RGBA 8 bits, CRC, zlib)', () => {
  const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 255, 255, 255, 255]);
  const f = lirePng(png(2, 2, rgba));
  assert.deepEqual([f.largeur, f.hauteur], [2, 2]);
  assert.deepEqual([...f.brut], [0, 255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 255, 0, 255, 255, 255, 255]);
  assert.equal(crc32(Buffer.from('IEND')), 0xae426082, 'CRC du bloc IEND (constante connue)');
});

test('icônes : même Moucheture que web/symbole-living-business.svg (§2.3), plus de monogramme « LB »', () => {
  const svg = readFileSync(new URL('../web/symbole-living-business.svg', import.meta.url), 'utf8');
  const d = /<path d="([^"]+)"/.exec(svg)?.[1] ?? '';
  assert.deepEqual(d.match(/-?\d+(?:\.\d+)?/g)?.map(Number), [...QUEUE.depart, ...QUEUE.courbes.flat()], 'tracé de la queue');
  assert.match(d, /^M[^C]+(C[^C]+){6}Z$/, 'un départ, six courbes, fermé');
  for (const p of POINTS) assert.match(svg, new RegExp(`<circle cx="${p.x}" cy="${p.y}" r="${p.r}" fill="${p.ajonc ? '#f7c323' : '#fff'}"/>`), `point ${p.x}, ${p.y}`);
  assert.match(svg, /<rect width="48" height="48" rx="11" fill="#006f85"\/>/);
  assert.equal(RAYON_CONTENEUR, 11 / 48);
  // le point du sommet est en Ajonc (« la lumière ») sur l'icône publiée
  const i = ICONES.find((x) => x.nom === 'icone-512.png');
  assert.ok(i);
  const px = pixelsIcone(i.cote, i.forme, i.echelle);
  const k = (Math.round((9.5 / 48) * i.cote) * i.cote + Math.round(i.cote / 2)) * 4;
  assert.deepEqual([px[k], px[k + 1], px[k + 2]], [0xf7, 0xc3, 0x23]);
});

test('icône Mac : même Moucheture, conteneur à 824/1024 du côté sur fond transparent (gabarit macOS)', () => {
  const cote = 256;
  const px = pixelsIconeMac(cote);
  const alpha = (x: number, y: number) => px[(y * cote + x) * 4 + 3];
  for (const [x, y] of [[0, 0], [cote - 1, 0], [0, cote - 1], [cote - 1, cote - 1], [10, cote / 2], [cote / 2, 10]] as const) assert.equal(alpha(x, y), 0, `marge transparente en ${x},${y}`);
  const corps = Math.round((cote * 824) / 1024);
  const marge = Math.floor((cote - corps) / 2);
  const seul = pixelsIcone(corps, 'arrondie', 1);
  for (const [x, y] of [[corps / 2, corps / 2], [corps / 2, Math.round(corps * 0.2)], [Math.round(corps * 0.15), corps / 2]] as [number, number][]) {
    const i = (y * corps + x) * 4;
    const j = ((y + marge) * cote + x + marge) * 4;
    assert.deepEqual([...px.subarray(j, j + 4)], [...seul.subarray(i, i + 4)], 'même dessin que l’icône arrondie');
  }
});
