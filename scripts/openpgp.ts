/**
 * Vérification d'une signature OpenPGP détachée (fichier .sig binaire) avec des clés publiques ÉPINGLÉES dans le dépôt,
 * sans gpg ni dépendance : node:crypto seulement. Sert à scripts/paquets.ts, pour que le Node.js embarqué dans les
 * paquets soit celui que les publieurs de Node.js ont signé, et pas seulement celui que sert nodejs.org.
 *
 * Périmètre volontairement étroit (ce qui suffit pour SHASUMS256.txt.sig) :
 * - paquets OpenPGP v4 (RFC 4880 / RFC 9580), clés et sous-clés RSA (algorithmes 1, 3), EdDSA Ed25519 (22, 27) ;
 * - signatures de document binaire (0x00) ou texte (0x01), condensat SHA-224/256/384/512 (MD5, SHA-1 refusés) ;
 * - émetteur reconnu par son empreinte (sous-paquet 33) ou son identifiant (16), parmi les clés épinglées seulement ;
 * - signature expirée, ou sous-paquet critique inconnu : refusée.
 * Les clés étant épinglées dans le dépôt (et relues à chaque changement), ni les certifications ni les révocations
 * publiées ailleurs ne sont consultées : une clé retirée par Node.js doit être retirée du fichier épinglé.
 */
import { constants, createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';

export interface ClePublique {
  /** Empreinte v4 (40 caractères hexadécimaux, majuscules). */
  empreinte: string;
  /** Empreinte de la clé principale à laquelle cette (sous-)clé appartient. */
  principale: string;
  algo: number;
  cle: KeyObject;
}

const CONDENSATS: Record<number, string> = { 8: 'sha256', 9: 'sha384', 10: 'sha512', 11: 'sha224' };
const OID_ED25519 = Buffer.from([0x2b, 0x06, 0x01, 0x04, 0x01, 0xda, 0x47, 0x0f, 0x01]); // 1.3.6.1.4.1.11591.15.1
const b64url = (b: Buffer) => b.toString('base64url');

/** Blocs « -----BEGIN PGP … ----- » d'un texte : contenu binaire (somme de contrôle CRC-24 vérifiée si présente). */
export function desarmer(texte: string): Buffer[] {
  const blocs: Buffer[] = [];
  const motif = /-----BEGIN PGP [A-Z ]+-----\r?\n([\s\S]*?)-----END PGP [A-Z ]+-----/g;
  for (const m of texte.matchAll(motif)) {
    const lignes = (m[1] as string).split(/\r?\n/);
    const vide = lignes.findIndex((l) => l.trim() === '');
    const corps = lignes.slice(vide + 1).map((l) => l.trim()).filter(Boolean);
    const crc = corps.length && corps[corps.length - 1]!.startsWith('=') ? corps.pop()!.slice(1) : null;
    const donnees = Buffer.from(corps.join(''), 'base64');
    if (crc !== null && crc24(donnees) !== Buffer.from(crc, 'base64').readUIntBE(0, 3)) throw new Error('bloc OpenPGP abîmé (CRC-24)');
    blocs.push(donnees);
  }
  return blocs;
}

function crc24(b: Buffer): number {
  let crc = 0xb704ce;
  for (const octet of b) {
    crc ^= octet << 16;
    for (let i = 0; i < 8; i++) { crc <<= 1; if (crc & 0x1000000) crc ^= 0x1864cfb; }
  }
  return crc & 0xffffff;
}

/** Découpe en paquets (formats ancien et nouveau ; longueurs partielles refusées : inutiles ici). */
export function paquets(b: Buffer): { etiquette: number; corps: Buffer }[] {
  const sortie: { etiquette: number; corps: Buffer }[] = [];
  let i = 0;
  while (i < b.length) {
    const t = b[i++]!;
    if (!(t & 0x80)) throw new Error('paquet OpenPGP mal formé');
    let etiquette: number;
    let longueur: number;
    if (t & 0x40) {
      etiquette = t & 0x3f;
      const o1 = b[i++]!;
      if (o1 < 192) longueur = o1;
      else if (o1 < 224) longueur = ((o1 - 192) << 8) + b[i++]! + 192;
      else if (o1 === 255) { longueur = b.readUInt32BE(i); i += 4; }
      else throw new Error('longueur partielle OpenPGP non prise en charge');
    } else {
      etiquette = (t >> 2) & 0x0f;
      const type = t & 3;
      if (type === 0) longueur = b[i++]!;
      else if (type === 1) { longueur = b.readUInt16BE(i); i += 2; }
      else if (type === 2) { longueur = b.readUInt32BE(i); i += 4; }
      else longueur = b.length - i;
    }
    if (i + longueur > b.length) throw new Error('paquet OpenPGP tronqué');
    sortie.push({ etiquette, corps: b.subarray(i, i + longueur) });
    i += longueur;
  }
  return sortie;
}

/** Entier multiprécision (MPI) à la position i → [valeur sans zéros de tête, position suivante]. */
function mpi(b: Buffer, i: number): [Buffer, number] {
  const bits = b.readUInt16BE(i);
  const n = Math.ceil(bits / 8);
  if (i + 2 + n > b.length) throw new Error('entier OpenPGP tronqué');
  return [b.subarray(i + 2, i + 2 + n), i + 2 + n];
}
const completer = (b: Buffer, n: number) => (b.length >= n ? b : Buffer.concat([Buffer.alloc(n - b.length), b]));

/** Empreinte v4 d'un paquet de clé publique : SHA-1 de 0x99, longueur sur 2 octets, corps. */
const empreinteV4 = (corps: Buffer) => createHash('sha1').update(Buffer.from([0x99, (corps.length >> 8) & 0xff, corps.length & 0xff])).update(corps).digest('hex').toUpperCase();

/** Clé publique v4 (paquet 6 ou 14) → objet de clé node:crypto, ou null si l'algorithme n'est pas pris en charge. */
function lireCle(corps: Buffer): { algo: number; cle: KeyObject; empreinte: string } | null {
  const algo = corps[5]!;
  let cle: KeyObject | null = null;
  if (algo === 1 || algo === 3) {
    const [n, j] = mpi(corps, 6);
    const [e] = mpi(corps, j);
    cle = createPublicKey({ key: { kty: 'RSA', n: b64url(n), e: b64url(e) }, format: 'jwk' });
  } else if (algo === 22) {
    const lo = corps[6]!;
    if (!corps.subarray(7, 7 + lo).equals(OID_ED25519)) return null;
    const [point] = mpi(corps, 7 + lo);
    if (point.length !== 33 || point[0] !== 0x40) return null;
    cle = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(point.subarray(1)) }, format: 'jwk' });
  } else if (algo === 27) {
    cle = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64url(corps.subarray(6, 38)) }, format: 'jwk' });
  }
  return cle ? { algo, cle, empreinte: empreinteV4(corps) } : null;
}

/** Clés (principales et sous-clés) d'un ou plusieurs blocs « PGP PUBLIC KEY BLOCK ». */
export function lireCles(texte: string): ClePublique[] {
  const cles: ClePublique[] = [];
  for (const bloc of desarmer(texte)) {
    let principale = '';
    for (const p of paquets(bloc)) {
      if (p.etiquette !== 6 && p.etiquette !== 14) continue;
      if (p.corps[0] !== 4) { if (p.etiquette === 6) principale = ''; continue; } // v3 (obsolète) ou v6 : non pris en charge
      if (p.etiquette === 6) principale = empreinteV4(p.corps);
      const c = lireCle(p.corps);
      if (c && principale) cles.push({ ...c, principale });
    }
  }
  return cles;
}

interface SousPaquet { type: number; critique: boolean; donnees: Buffer }
function sousPaquets(b: Buffer): SousPaquet[] {
  const sortie: SousPaquet[] = [];
  let i = 0;
  while (i < b.length) {
    const o1 = b[i++]!;
    let n: number;
    if (o1 < 192) n = o1;
    else if (o1 < 255) n = ((o1 - 192) << 8) + b[i++]! + 192;
    else { n = b.readUInt32BE(i); i += 4; }
    if (n < 1 || i + n > b.length) throw new Error('sous-paquet OpenPGP mal formé');
    sortie.push({ type: b[i]! & 0x7f, critique: (b[i]! & 0x80) !== 0, donnees: b.subarray(i + 1, i + n) });
    i += n;
  }
  return sortie;
}

export interface Verification {
  valide: boolean;
  /** Empreinte de la clé PRINCIPALE du signataire (si la signature est valable). */
  signataire?: string;
  raison?: string;
}

/** Vérifie `signature` (fichier .sig binaire, ou armuré) sur `document` avec les seules `cles` épinglées. */
export function verifierSignatureDetachee(document: Buffer, signature: Buffer, cles: readonly ClePublique[], maintenant = Date.now()): Verification {
  let binaire = signature;
  if (signature.subarray(0, 5).toString('latin1') === '-----') binaire = desarmer(signature.toString('utf8'))[0] ?? Buffer.alloc(0);
  let liste: { etiquette: number; corps: Buffer }[];
  try { liste = paquets(binaire); } catch (e) { return { valide: false, raison: (e as Error).message }; }
  const sigs = liste.filter((p) => p.etiquette === 2);
  if (sigs.length !== 1 || liste.length !== 1) return { valide: false, raison: 'une seule signature attendue' };
  const s = sigs[0]!.corps;
  try {
    if (s[0] !== 4) return { valide: false, raison: `signature v${s[0]} non prise en charge` };
    const type = s[1]!;
    const algo = s[2]!;
    const condensat = CONDENSATS[s[3]!];
    if (type !== 0x00 && type !== 0x01) return { valide: false, raison: 'ce n’est pas une signature de document' };
    if (!condensat) return { valide: false, raison: `condensat ${s[3]} refusé (MD5 et SHA-1 ne sont plus sûrs)` };
    const lh = s.readUInt16BE(4);
    const hachees = sousPaquets(s.subarray(6, 6 + lh));
    const lnh = s.readUInt16BE(6 + lh);
    const nonHachees = sousPaquets(s.subarray(8 + lh, 8 + lh + lnh));
    let i = 8 + lh + lnh;
    const gauche = s.subarray(i, i + 2);
    i += 2;

    let creation = 0;
    let expiration = 0;
    let empreinte = '';
    let identifiant = '';
    for (const sp of hachees) {
      if (sp.type === 2) creation = sp.donnees.readUInt32BE(0);
      else if (sp.type === 3) expiration = sp.donnees.readUInt32BE(0);
      else if (sp.type === 33 && sp.donnees[0] === 4) empreinte = sp.donnees.subarray(1).toString('hex').toUpperCase();
      else if (sp.type === 16) identifiant = sp.donnees.toString('hex').toUpperCase();
      else if (sp.critique) return { valide: false, raison: `sous-paquet critique ${sp.type} inconnu` };
    }
    // l'identifiant non haché ne sert qu'à trouver la clé : une fausse valeur ne fait que rater la vérification
    for (const sp of nonHachees) if (sp.type === 16 && !identifiant) identifiant = sp.donnees.toString('hex').toUpperCase();
    if (!creation) return { valide: false, raison: 'date de signature absente' };
    if (expiration && (creation + expiration) * 1000 < maintenant) return { valide: false, raison: 'signature expirée' };

    const cle = cles.find((c) => c.algo === algo && (empreinte ? c.empreinte === empreinte : identifiant !== '' && c.empreinte.endsWith(identifiant)));
    if (!cle) return { valide: false, raison: `signataire inconnu (${empreinte || identifiant || 'sans identifiant'}) : clé absente des clés épinglées` };

    const texte = type === 0x01 ? Buffer.from(document.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8') : document;
    const prefixe = s.subarray(0, 6 + lh);
    const queue = Buffer.alloc(6);
    queue[0] = 0x04; queue[1] = 0xff; queue.writeUInt32BE(prefixe.length, 2);
    const donnees = Buffer.concat([texte, prefixe, queue]);
    const empreinteDonnees = createHash(condensat).update(donnees).digest();
    if (!empreinteDonnees.subarray(0, 2).equals(gauche)) return { valide: false, raison: 'document différent de celui qui a été signé' };

    let ok = false;
    if (algo === 1 || algo === 3) {
      const [sig] = mpi(s, i);
      const taille = Math.ceil((cle.cle.asymmetricKeyDetails?.modulusLength ?? sig.length * 8) / 8);
      ok = verify(condensat, donnees, { key: cle.cle, padding: constants.RSA_PKCS1_PADDING }, completer(sig, taille));
    } else if (algo === 22) {
      const [r, j] = mpi(s, i);
      const [ss] = mpi(s, j);
      ok = r.length <= 32 && ss.length <= 32 && verify(null, empreinteDonnees, cle.cle, Buffer.concat([completer(r, 32), completer(ss, 32)]));
    } else if (algo === 27) {
      ok = verify(null, empreinteDonnees, cle.cle, s.subarray(i, i + 64));
    }
    return ok ? { valide: true, signataire: cle.principale } : { valide: false, raison: 'signature invalide' };
  } catch (e) {
    return { valide: false, raison: `signature mal formée (${(e as Error).message})` };
  }
}
