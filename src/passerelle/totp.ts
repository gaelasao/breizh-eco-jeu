/**
 * Validation en deux étapes : codes à usage unique basés sur le temps (TOTP, RFC 6238 ; HOTP, RFC 4226).
 * Paramètres compatibles avec toutes les applications d'authentification (Google Authenticator, Microsoft
 * Authenticator, 1Password, Bitwarden, FreeOTP…) : HMAC-SHA-1, 6 chiffres, pas de 30 secondes.
 * Zéro dépendance : node:crypto uniquement.
 */
import { createHmac } from 'node:crypto';

export const PAS_S = 30;
export const CHIFFRES = 6;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Base32 (RFC 4648), sans remplissage : le format des secrets dans les applications d'authentification. */
export function base32(octets: Uint8Array): string {
  let bits = 0;
  let valeur = 0;
  let sortie = '';
  for (const o of octets) {
    valeur = ((valeur << 8) | o) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      sortie += ALPHABET[(valeur >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) sortie += ALPHABET[(valeur << (5 - bits)) & 31];
  return sortie;
}

export function depuisBase32(texte: string): Buffer {
  const propre = texte.toUpperCase().replace(/[\s=-]/g, '');
  const octets: number[] = [];
  let bits = 0;
  let valeur = 0;
  for (const c of propre) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error('base32 invalide');
    valeur = ((valeur << 5) | i) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      octets.push((valeur >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(octets);
}

/** HOTP (RFC 4226) : HMAC-SHA-1 du compteur sur 8 octets, troncature dynamique. */
export function hotp(secret: Uint8Array, compteur: number, chiffres = CHIFFRES): string {
  const c = Buffer.alloc(8);
  c.writeBigUInt64BE(BigInt(compteur));
  const mac = createHmac('sha1', secret).update(c).digest();
  const decalage = (mac[mac.length - 1] as number) & 0x0f;
  const binaire = (((mac[decalage] as number) & 0x7f) << 24) | ((mac[decalage + 1] as number) << 16) | ((mac[decalage + 2] as number) << 8) | (mac[decalage + 3] as number);
  return String(binaire % 10 ** chiffres).padStart(chiffres, '0');
}

/** Numéro du pas de 30 s à l'instant donné (millisecondes). */
export const pasDe = (instantMs: number, pas = PAS_S): number => Math.floor(instantMs / 1000 / pas);

/** TOTP (RFC 6238) à l'instant donné. */
export function totp(secret: Uint8Array, instantMs: number, chiffres = CHIFFRES, pas = PAS_S): string {
  return hotp(secret, pasDe(instantMs, pas), chiffres);
}

/**
 * Vérifie un code à ±`fenetre` pas (décalage d'horloge du téléphone). Renvoie le pas reconnu, ou null.
 * Comparaison sans court-circuit sur toutes les positions de la fenêtre. Un pas ≤ `apres` est refusé
 * (le même code ne sert pas deux fois).
 */
export function verifierTotp(secret: Uint8Array, code: unknown, instantMs: number, o: { fenetre?: number; apres?: number } = {}): number | null {
  if (typeof code !== 'string') return null;
  const propre = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(propre)) return null;
  const centre = pasDe(instantMs);
  const fenetre = o.fenetre ?? 1;
  let trouve: number | null = null;
  for (let d = -fenetre; d <= fenetre; d++) {
    const pas = centre + d;
    const attendu = hotp(secret, pas);
    let diff = 0;
    for (let i = 0; i < CHIFFRES; i++) diff |= attendu.charCodeAt(i) ^ propre.charCodeAt(i);
    if (diff === 0 && pas > (o.apres ?? -1) && trouve === null) trouve = pas;
  }
  return trouve;
}

/** Adresse `otpauth://` à scanner (QR code) ou à ouvrir sur le téléphone. */
export function uriOtpauth(secretBase32: string, compte: string, emetteur: string): string {
  const e = encodeURIComponent(emetteur);
  return `otpauth://totp/${e}:${encodeURIComponent(compte)}?secret=${secretBase32}&issuer=${e}&algorithm=SHA1&digits=${CHIFFRES}&period=${PAS_S}`;
}
