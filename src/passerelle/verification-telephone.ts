/**
 * « Mettre en ligne » : vérification automatique que Living Business répond bien sur le téléphone
 * (direction de design §6.1 P9). L'ordinateur affiche un QR code vers `<adresse>/telephone#<jeton>` ; le téléphone
 * ouvre la page, qui renvoie le jeton ; l'assistant voit alors « Votre Living Business répond bien sur votre téléphone ».
 *
 * - Jeton aléatoire de 128 bits, valable 10 minutes, dans le fragment de l'adresse (jamais dans les journaux du proxy).
 * - La page du téléphone n'a besoin d'aucune session et ne reçoit AUCUNE donnée de l'entreprise : seulement « reçu ».
 * - 20 vérifications en cours au plus ; un jeton inconnu ou expiré répond comme un jeton absent.
 */
import { randomBytes } from 'node:crypto';
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os';

export const DUREE_VERIFICATION_MS = 10 * 60_000;
const MAX_EN_COURS = 20;
export const JETON_VERIFICATION = /^[A-Za-z0-9_-]{22}$/;

export interface EtatVerification {
  vu: boolean;
  le: string | null;
  /** « téléphone », « tablette » ou « ordinateur » (déduit de l'agent, jamais gardé au-delà de la vérification). */
  appareil: string | null;
  expire: string;
}

/** Genre d'appareil lu dans l'en-tête User-Agent, pour le message « répond bien sur votre téléphone ». */
export function genreAppareil(agent: string | undefined): 'téléphone' | 'tablette' | 'ordinateur' {
  const a = String(agent ?? '');
  if (/ipad|tablet/i.test(a) || (/android/i.test(a) && !/mobile/i.test(a))) return 'tablette';
  if (/iphone|ipod|android|mobile/i.test(a)) return 'téléphone';
  return 'ordinateur';
}

/** Adresses Tailscale de la machine (100.64.0.0/10) : celles qu'ouvre un téléphone relié au même compte Tailscale. */
export function adressesTailscale(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const ips: string[] = [];
  for (const liste of Object.values(interfaces)) {
    for (const a of liste ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [x, y] = a.address.split('.').map(Number);
      if (x === 100 && (y as number) >= 64 && (y as number) <= 127) ips.push(a.address);
    }
  }
  return [...new Set(ips)];
}

export class VerificationsTelephone {
  #en = new Map<string, { cree: number; vuLe: string | null; appareil: string | null }>();
  #horloge: () => number;

  constructor(horloge: () => number = Date.now) {
    this.#horloge = horloge;
  }

  #nettoyer(): void {
    const t = this.#horloge();
    for (const [k, v] of this.#en) if (t - v.cree > DUREE_VERIFICATION_MS) this.#en.delete(k);
  }

  /** Nouvelle vérification : renvoie le jeton (à mettre dans le fragment de l'adresse) et son expiration. */
  creer(): { jeton: string; expire: string } {
    this.#nettoyer();
    while (this.#en.size >= MAX_EN_COURS) this.#en.delete(this.#en.keys().next().value as string);
    const jeton = randomBytes(16).toString('base64url');
    const cree = this.#horloge();
    this.#en.set(jeton, { cree, vuLe: null, appareil: null });
    return { jeton, expire: new Date(cree + DUREE_VERIFICATION_MS).toISOString() };
  }

  /** Le téléphone a ouvert la page : vrai si le jeton est connu et encore valable. */
  marquer(jeton: string, agent: string | undefined): boolean {
    this.#nettoyer();
    const v = JETON_VERIFICATION.test(jeton) ? this.#en.get(jeton) : undefined;
    if (!v) return false;
    v.vuLe ??= new Date(this.#horloge()).toISOString();
    v.appareil ??= genreAppareil(agent);
    return true;
  }

  /** État d'une vérification (null : inconnue ou expirée). */
  etat(jeton: string): EtatVerification | null {
    this.#nettoyer();
    const v = JETON_VERIFICATION.test(jeton) ? this.#en.get(jeton) : undefined;
    if (!v) return null;
    return { vu: v.vuLe !== null, le: v.vuLe, appareil: v.appareil, expire: new Date(v.cree + DUREE_VERIFICATION_MS).toISOString() };
  }
}
