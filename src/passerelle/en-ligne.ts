/**
 * Mode « en ligne » : le jeu tourne comme un site internet sur le serveur DE L'ENTREPRISE (son VPS, son nom de
 * domaine), derrière un proxy HTTPS (Caddy) sur la même machine. L'entreprise reste seule maîtresse de ses données.
 * Variables posées par le service système (voir deploiement/installer-jeu.sh) :
 *   LB_EN_LIGNE=1  LB_PROXY=1  LB_ORIGINE=https://<domaine>  LB_HOTES=<domaine>  LB_COOKIE_SECURE=1
 *   LB_DONNEES=/var/lib/living-business  HOST=127.0.0.1  PORT=4173
 *
 * - Première installation à distance : code à usage unique (256 bits) écrit au démarrage dans
 *   `${LB_DONNEES}/installation.txt` (0600, lisible par l'administrateur du serveur seulement) ; seule son empreinte
 *   SHA-256 reste en mémoire ; l'installateur affiche `${LB_ORIGINE}/installation#<code>` (le fragment ne part
 *   jamais vers le serveur ni dans les journaux du proxy) ; le fichier est effacé dès l'installation faite.
 *   Au redémarrage (mise à jour du serveur), le code du fichier est repris : le lien déjà affiché reste valable.
 * - Adresse du client (limites d'essais) : derrière le proxy (LB_PROXY=1), la DERNIÈRE valeur de X-Forwarded-For,
 *   celle ajoutée par Caddy — jamais la première, que le client peut inventer. Sans LB_PROXY, l'en-tête est ignoré.
 */
import { chmodSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { ErreurApi } from './monde.ts';

export const FICHIER_INSTALLATION = 'installation.txt';
const empreinte = (code: string) => createHash('sha256').update(code, 'utf8').digest();

export class CodeInstallation {
  readonly fichier: string | null;
  #empreinte: Buffer | null = null;

  /** `dossier` : dossier des données (null : en mémoire, aucun fichier écrit — installation à distance impossible). */
  constructor(dossier: string | null) {
    this.fichier = dossier ? join(dossier, FICHIER_INSTALLATION) : null;
  }

  get actif(): boolean {
    return this.#empreinte !== null;
  }

  /**
   * Au démarrage, rien d'installé : reprend le code du fichier s'il est intact (le lien déjà affiché par l'installateur
   * reste valable après un redémarrage ou une mise à jour), sinon en crée un nouveau. Un fichier lisible par d'autres
   * que l'utilisateur du service n'est jamais repris.
   */
  preparer(): void {
    if (this.fichier) {
      try {
        const st = statSync(this.fichier);
        const code = readFileSync(this.fichier, 'utf8').trim();
        if (st.isFile() && (st.mode & 0o077) === 0 && /^[A-Za-z0-9_-]{43}$/.test(code)) { this.#empreinte = empreinte(code); return; }
      } catch { /* pas encore de fichier */ }
    }
    this.generer();
  }

  /** Nouveau code (le précédent ne vaut plus rien). Écrit dans le fichier, jamais dans les journaux. */
  generer(): string {
    const code = randomBytes(32).toString('base64url');
    if (this.fichier) {
      const tmp = `${this.fichier}.${process.pid}.tmp`;
      writeFileSync(tmp, `${code}\n`, { mode: 0o600 });
      chmodSync(tmp, 0o600);
      renameSync(tmp, this.fichier);
    }
    this.#empreinte = empreinte(code);
    return code;
  }

  /** Comparaison à temps constant (empreintes de même longueur). */
  verifier(code: unknown): boolean {
    if (!this.#empreinte || typeof code !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(code)) return false;
    return timingSafeEqual(empreinte(code), this.#empreinte);
  }

  /** Installation faite : le code ne sert plus, le fichier disparaît. */
  consommer(): void {
    this.#empreinte = null;
    if (!this.fichier) return;
    try { unlinkSync(this.fichier); } catch { /* déjà effacé */ }
  }
}

/** Adresse du client pour les limites d'essais. */
export function ipClient(req: IncomingMessage, proxy: boolean): string {
  const directe = req.socket.remoteAddress ?? '?';
  if (!proxy) return directe;
  const xff = req.headers['x-forwarded-for'];
  const valeurs = (Array.isArray(xff) ? xff.join(',') : xff ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const derniere = valeurs[valeurs.length - 1];
  return derniere && isIP(derniere) ? derniere : directe;
}

/** Blocage après `max` erreurs en `fenetreMs` (puis `fenetreMs` de blocage), par clé (adresse, compte…). */
export class Verrous {
  readonly #max: number;
  readonly #fenetreMs: number;
  #m = new Map<string, { n: number; debut: number; jusqua: number }>();

  constructor(max = 5, fenetreMs = 15 * 60_000) {
    this.#max = max;
    this.#fenetreMs = fenetreMs;
  }

  verifier(cle: string): void {
    const e = this.#m.get(cle);
    if (e && e.jusqua > Date.now()) throw new ErreurApi(429, 'trop_d_essais', 'Trop d’essais : réessayez dans 15 minutes.');
  }

  echec(cle: string): void {
    const t = Date.now();
    let e = this.#m.get(cle);
    if (!e || t - e.debut > this.#fenetreMs) {
      e = { n: 0, debut: t, jusqua: 0 };
      this.#m.set(cle, e);
      if (this.#m.size > 10_000) this.#m.delete(this.#m.keys().next().value as string);
    }
    if (++e.n >= this.#max) { e.jusqua = t + this.#fenetreMs; e.n = 0; e.debut = t; }
  }

  reussite(cle: string): void {
    this.#m.delete(cle);
  }
}
