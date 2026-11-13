/**
 * Points de code d'une police WOFF2 (table cmap), sans dépendance : en-tête et répertoire des tables (UIntBase128),
 * flux unique décompressé par brotli (node:zlib), puis sous-tables cmap 4 et 12. Outil de test (§3.9 : glyphes français).
 * La table cmap n'est jamais transformée en WOFF2 (seules glyf, loca et hmtx peuvent l'être).
 */
import { brotliDecompressSync } from 'node:zlib';

const ETIQUETTES = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC', 'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat', 'Gloc', 'Feat', 'Sill'];

export function pointsDeCode(woff2: Buffer): Set<number> {
  if (woff2.toString('latin1', 0, 4) !== 'wOF2') throw new Error('Pas un fichier WOFF2');
  const nbTables = woff2.readUInt16BE(12);
  const tailleCompressee = woff2.readUInt32BE(20);
  let p = 48;
  const base128 = () => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const o = woff2[p++] as number;
      v = v * 128 + (o & 0x7f);
      if (!(o & 0x80)) return v;
    }
    throw new Error('UIntBase128 invalide');
  };
  const tables: Array<{ tag: string; longueur: number }> = [];
  for (let t = 0; t < nbTables; t++) {
    const drapeaux = woff2[p++] as number;
    const tag = (drapeaux & 0x3f) === 0x3f ? woff2.toString('latin1', p, (p += 4)) : (ETIQUETTES[drapeaux & 0x3f] as string);
    const transformation = (drapeaux >> 6) & 0x03;
    const longueurOrigine = base128();
    const transformee = (tag === 'glyf' || tag === 'loca') ? transformation === 0 : transformation !== 0;
    const longueur = transformee ? base128() : longueurOrigine;
    tables.push({ tag, longueur });
  }
  const flux = brotliDecompressSync(woff2.subarray(p, p + tailleCompressee));
  let decalage = 0;
  let cmap: Buffer | null = null;
  for (const t of tables) {
    if (t.tag === 'cmap') cmap = flux.subarray(decalage, decalage + t.longueur);
    decalage += t.longueur;
  }
  if (!cmap) throw new Error('Table cmap absente');
  const points = new Set<number>();
  const n = cmap.readUInt16BE(2);
  for (let i = 0; i < n; i++) {
    const off = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(off);
    if (format === 4) {
      const segX2 = cmap.readUInt16BE(off + 6);
      const fins = off + 14;
      const debuts = fins + segX2 + 2;
      const deltas = debuts + segX2;
      const decalages = deltas + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const fin = cmap.readUInt16BE(fins + s * 2);
        const debut = cmap.readUInt16BE(debuts + s * 2);
        const delta = cmap.readInt16BE(deltas + s * 2);
        const rangOff = cmap.readUInt16BE(decalages + s * 2);
        for (let c = debut; c <= fin && c !== 0xffff; c++) {
          let glyphe: number;
          if (rangOff === 0) glyphe = (c + delta) & 0xffff;
          else {
            const g = cmap.readUInt16BE(decalages + s * 2 + rangOff + (c - debut) * 2);
            glyphe = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (glyphe !== 0) points.add(c);
        }
      }
    } else if (format === 12) {
      const groupes = cmap.readUInt32BE(off + 12);
      for (let g = 0; g < groupes; g++) {
        const debut = cmap.readUInt32BE(off + 16 + g * 12);
        const fin = cmap.readUInt32BE(off + 20 + g * 12);
        for (let c = debut; c <= fin; c++) points.add(c);
      }
    }
  }
  return points;
}
