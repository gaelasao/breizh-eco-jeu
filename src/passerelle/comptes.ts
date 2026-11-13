/**
 * Comptes de connexion LOCAUX : l'entreprise gère seule ses accès, sans éditeur ni service extérieur.
 * - Un compte = un profil d'accès (droits et périmètre réglés dans « Accès et visibilité »).
 * - Mot de passe haché avec scrypt (N = 2^15, r = 8, p = 1, sel aléatoire de 16 octets), comparé à temps constant.
 *   Un identifiant inconnu coûte le même calcul (pas d'indice sur les comptes existants).
 * - Le premier compte (propriétaire) est créé à l'installation, depuis l'ordinateur qui fait tourner le jeu.
 * - Les collègues reçoivent un lien d'invitation à usage unique (7 jours) : l'administrateur ne connaît jamais
 *   leur mot de passe. Un nouveau lien sert aussi à réinitialiser un mot de passe oublié.
 * - Oubli du propriétaire : code de secours (montré une seule fois, empreinte seule enregistrée) ou commande
 *   `npm run secours` lancée sur l'ordinateur (preuve d'accès physique aux données).
 * - 5 échecs sur un identifiant DEPUIS UNE ADRESSE → 15 min de blocage de cette adresse pour cet identifiant (même
 *   comportement que l'identifiant existe ou non) : quelqu'un qui connaît l'identifiant ne bloque pas le titulaire,
 *   qui se connecte d'ailleurs. Toutes adresses confondues, au-delà de 30 échecs par heure sur un identifiant, chaque
 *   essai attend de plus en plus (jusqu'à 8 s) : la force brute répartie est freinée, le bon mot de passe passe.
 * - Tout changement de mot de passe, désactivation ou retrait coupe les sessions ouvertes du compte.
 * - Validation en deux étapes (TOTP, RFC 6238) au choix de chaque personne, obligatoire pour les administrateurs
 *   d'un jeu en ligne : secret chiffré au repos (jamais renvoyé après l'activation), 8 codes de récupération à
 *   usage unique (empreintes seules), un code d'application ne sert qu'une fois. Le secours (code de secours,
 *   `npm run secours`) et un nouveau lien d'invitation la remettent à zéro (téléphone perdu).
 */
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { Profil } from '../demo/donnees.ts';
import { ErreurApi } from './monde.ts';
import { chiffreurEphemere, type Chiffreur } from './stockage.ts';
import { base32, uriOtpauth, verifierTotp } from './totp.ts';

export interface Compte {
  id: string;
  profilId: string;
  identifiant: string;
  /** `s1$<log2 N>$<sel>$<empreinte>` ; null tant que l'invitation n'a pas été acceptée. */
  hash: string | null;
  statut: 'invite' | 'actif' | 'desactive';
  invitation: { empreinte: string; expire: string } | null;
  /** Empreinte SHA-256 du code de secours (null : pas de code). */
  secours: string | null;
  /** Incrémentée à chaque changement de mot de passe ou désactivation : les sessions plus anciennes tombent. */
  version: number;
  creeLe: string;
  derniereConnexion: string | null;
  /** Validation en deux étapes (absente ou null : désactivée). */
  deuxEtapes?: DeuxEtapes | null;
}

export interface DeuxEtapes {
  /** Secret TOTP chiffré (AES-256-GCM, clé des secrets de l'installation). Jamais renvoyé au navigateur. */
  secret: string;
  activeLe: string;
  /** Dernier pas de 30 s accepté : un code déjà utilisé est refusé. */
  dernierPas: number;
  /** Empreintes SHA-256 des codes de récupération restants (usage unique). */
  codes: string[];
}

export interface ResumeDeuxEtapes {
  active: boolean;
  activeLe: string | null;
  codesRestants: number;
}

export interface EtatComptes {
  version: 1;
  installeLe: string | null;
  comptes: Compte[];
}

export interface ResumeConnexion {
  identifiant: string;
  statut: Compte['statut'];
  derniereConnexion: string | null;
  invitationExpire: string | null;
  deuxEtapes: boolean;
}

const LOG_N = 15;
const DUREE_INVITATION_MS = 7 * 24 * 3600_000;
const ESSAIS_MAX = 5;
const BLOCAGE_MS = 15 * 60_000;
/** Plafond par identifiant, toutes adresses confondues : au-delà, l'essai est retardé, jamais refusé pour ce motif. */
export const ESSAIS_GLOBAUX = 30;
const FENETRE_GLOBALE_MS = 3600_000;
const PAS_ATTENTE_MS = 500;
export const ATTENTE_MAX_MS = 8000;

/**
 * Origine d'un essai de connexion : l'adresse en IPv4, le préfixe /64 en IPv6 (un même abonné en tient 2^64 : par
 * adresse entière, il contournerait le verrou). Adresse absente (appel interne, tests) : « inconnue ».
 */
export function origineEssai(adresse: string | null | undefined): string {
  const a = (adresse ?? '').trim().toLowerCase().replace(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/, '$1').replace(/%.*$/, '');
  if (!a) return 'inconnue';
  if (!a.includes(':')) return a;
  const [tete = '', queue = ''] = a.split('::');
  const t = tete ? tete.split(':') : [];
  const q = queue ? queue.split(':') : [];
  const groupes = a.includes('::') ? [...t, ...Array<string>(Math.max(0, 8 - t.length - q.length)).fill('0'), ...q] : t;
  return `${groupes.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}
const COURANTS = new Set(['motdepasse', 'password', 'azertyuiop', 'qwertyuiop', '1234567890', '0123456789', 'azerty1234', 'motdepasse1', 'password123', 'bonjour123', 'soleil1234', 'jetaime123', 'livingbusiness', 'administrateur', 'admin12345']);

const sha = (x: string) => createHash('sha256').update(x).digest('base64url');

function deriver(motDePasse: string, sel: Buffer, logN: number): Promise<Buffer> {
  const N = 2 ** logN;
  return new Promise((ok, ko) => {
    scrypt(motDePasse.normalize('NFKC'), sel, 64, { N, r: 8, p: 1, maxmem: 256 * N * 8 }, (e, k) => (e ? ko(e) : ok(k)));
  });
}

async function hacher(motDePasse: string): Promise<string> {
  const sel = randomBytes(16);
  const k = await deriver(motDePasse, sel, LOG_N);
  return `s1$${LOG_N}$${sel.toString('base64url')}$${k.toString('base64url')}`;
}

/** Compare à temps constant. Un hash absent ou illisible est comparé à un leurre (même durée). */
async function verifierHash(motDePasse: string, hash: string | null): Promise<boolean> {
  const m = hash ? /^s1\$(\d{1,2})\$([A-Za-z0-9_-]{22})\$([A-Za-z0-9_-]{86})$/.exec(hash) : null;
  const logN = m ? Number(m[1]) : LOG_N;
  if (logN < 14 || logN > 20) return false;
  const sel = m ? Buffer.from(m[2] as string, 'base64url') : Buffer.alloc(16);
  const attendu = m ? Buffer.from(m[3] as string, 'base64url') : Buffer.alloc(64);
  const k = await deriver(motDePasse, sel, logN);
  return timingSafeEqual(k, attendu) && m !== null;
}

/** Identifiant : e-mail ou prénom.nom, en minuscules. */
export function normaliserIdentifiant(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const v = x.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._@+-]{1,118}[a-z0-9]$/.test(v) ? v : null;
}

/** Règle simple et lisible : 10 caractères minimum, pas l'identifiant, pas un mot de passe courant. */
export function problemeMotDePasse(mdp: unknown, identifiant: string | null): string | null {
  if (typeof mdp !== 'string') return 'Mot de passe manquant.';
  if (mdp.length < 10) return 'Le mot de passe doit faire au moins 10 caractères (une phrase courte marche très bien).';
  if (mdp.length > 200) return 'Mot de passe trop long (200 caractères au plus).';
  const bas = mdp.toLowerCase();
  if (COURANTS.has(bas) || /^(.)\1+$/.test(mdp) || /^(0123456789|1234567890)+$/.test(mdp)) return 'Ce mot de passe est trop courant : choisissez-en un autre.';
  if (identifiant && identifiant.length >= 3 && bas.includes(identifiant.split('@')[0] as string)) return 'Le mot de passe ne doit pas contenir votre identifiant.';
  return null;
}

/** Code de secours lisible : 5 groupes de 4 caractères (≈ 100 bits), sans lettres ambiguës. */
function codeSecours(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const o = randomBytes(20);
  const c = [...o].map((b) => A[b % 32]).join('');
  return (c.match(/.{4}/g) as string[]).join('-');
}
const normaliserCode = (x: unknown) => (typeof x === 'string' ? x.toUpperCase().replace(/[^A-Z0-9]/g, '') : '');
/** Code de récupération de la validation en deux étapes : 2 groupes de 4 caractères (40 bits), usage unique. */
function codeRecuperation(): string {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return [...randomBytes(8)].map((b, i) => (i === 4 ? '-' : '') + A[b % 32]).join('');
}
const NB_CODES_RECUPERATION = 8;
const DUREE_ENROLEMENT_MS = 15 * 60_000;

export class Comptes {
  #comptes: Compte[];
  #installeLe: string | null;
  #essais = new Map<string, { n: number; jusqua: number }>();
  /** Échecs par identifiant sur une heure, toutes adresses confondues (ralentissement, voir #ralentir). */
  #globaux = new Map<string, { n: number; debut: number }>();
  #attendre: (ms: number) => Promise<void>;
  #changement: () => void;
  #maintenant: () => Date;
  #chiffreur: Chiffreur;
  /** Heure réelle (codes TOTP), indépendante de l'horloge du monde (démonstration, tests). */
  #horloge: () => number;
  /** Activations en cours (secret pas encore confirmé par un premier code) : en mémoire seulement. */
  #enrolements = new Map<string, { secret: Buffer; expire: number }>();

  constructor(o: { etat?: EtatComptes | null; changement?: () => void; maintenant?: () => Date; chiffreur?: Chiffreur; horloge?: () => number; attendre?: (ms: number) => Promise<void> } = {}) {
    this.#changement = o.changement ?? (() => {});
    this.#attendre = o.attendre ?? ((ms) => new Promise((ok) => { setTimeout(ok, ms); }));
    this.#maintenant = o.maintenant ?? (() => new Date());
    this.#chiffreur = o.chiffreur ?? chiffreurEphemere();
    this.#horloge = o.horloge ?? Date.now;
    const e = o.etat;
    this.#comptes = Array.isArray(e?.comptes) ? (e as EtatComptes).comptes.filter((c) => typeof c.id === 'string' && typeof c.identifiant === 'string') : [];
    this.#installeLe = typeof e?.installeLe === 'string' ? e.installeLe : null;
  }

  instantane(): EtatComptes {
    return { version: 1, installeLe: this.#installeLe, comptes: this.#comptes };
  }

  get installe(): boolean {
    return this.#installeLe !== null && this.#comptes.some((c) => c.statut === 'actif');
  }

  // ---------------------------------------------------------------- limitation des essais

  #verifierBlocage(cle: string) {
    const e = this.#essais.get(cle);
    if (e && e.jusqua > Date.now()) throw new ErreurApi(429, 'trop_d_essais', 'Trop d’essais : réessayez dans 15 minutes.');
  }

  #echec(cle: string) {
    const e = this.#essais.get(cle) ?? { n: 0, jusqua: 0 };
    e.n++;
    if (e.n >= ESSAIS_MAX) { e.n = 0; e.jusqua = Date.now() + BLOCAGE_MS; }
    this.#essais.set(cle, e);
    if (this.#essais.size > 10_000) this.#essais.delete(this.#essais.keys().next().value as string);
  }

  /** Au-delà du plafond de l'heure pour cet identifiant : attente croissante avant de vérifier (0,5 s, 1 s… 8 s au plus). */
  async #ralentir(cle: string): Promise<void> {
    const g = this.#globaux.get(cle);
    if (!g || Date.now() - g.debut > FENETRE_GLOBALE_MS) return;
    if (g.n >= ESSAIS_GLOBAUX) await this.#attendre(Math.min(ATTENTE_MAX_MS, PAS_ATTENTE_MS * (g.n - ESSAIS_GLOBAUX + 1)));
  }

  #echecGlobal(cle: string) {
    const t = Date.now();
    const g = this.#globaux.get(cle);
    if (!g || t - g.debut > FENETRE_GLOBALE_MS) {
      this.#globaux.set(cle, { n: 1, debut: t });
      if (this.#globaux.size > 10_000) this.#globaux.delete(this.#globaux.keys().next().value as string);
    } else g.n++;
  }

  // ---------------------------------------------------------------- installation et connexion

  /** Crée le compte du propriétaire (une seule fois). Renvoie le code de secours, à montrer UNE fois. */
  async installer(identifiantBrut: unknown, motDePasse: unknown, profilId: string): Promise<{ compte: Compte; codeSecours: string }> {
    if (this.installe) throw new ErreurApi(409, 'deja_installe', 'Living Business est déjà installé : connectez-vous.');
    const identifiant = normaliserIdentifiant(identifiantBrut);
    if (!identifiant) throw new ErreurApi(400, 'identifiant_invalide', 'Identifiant : votre e-mail ou un prénom (lettres, chiffres, . _ - @).');
    const pb = problemeMotDePasse(motDePasse, identifiant);
    if (pb) throw new ErreurApi(400, 'mot_de_passe_faible', pb);
    const code = codeSecours();
    const maintenant = this.#maintenant().toISOString();
    this.#comptes = this.#comptes.filter((c) => c.profilId !== profilId && c.identifiant !== identifiant);
    const compte: Compte = {
      id: `cpt-${randomUUID().slice(0, 12)}`, profilId, identifiant, hash: await hacher(motDePasse as string), statut: 'actif',
      invitation: null, secours: sha(normaliserCode(code)), version: 1, creeLe: maintenant, derniereConnexion: maintenant,
    };
    this.#comptes.push(compte);
    this.#installeLe = maintenant;
    this.#changement();
    return { compte, codeSecours: code };
  }

  /**
   * Vérifie identifiant + mot de passe. Erreur volontairement identique pour un compte inconnu ou un mauvais mot de passe.
   * `adresse` : celle du client ; le blocage court porte sur la paire (identifiant, adresse), pas sur l'identifiant seul.
   */
  async connecter(identifiantBrut: unknown, motDePasse: unknown, adresse: string | null = null): Promise<Compte> {
    const identifiant = normaliserIdentifiant(identifiantBrut) ?? '';
    const global = `cx:${identifiant}`;
    const cle = `${global}\n${origineEssai(adresse)}`;
    this.#verifierBlocage(cle);
    await this.#ralentir(global);
    const c = this.#comptes.find((x) => x.identifiant === identifiant);
    const ok = await verifierHash(typeof motDePasse === 'string' ? motDePasse.slice(0, 200) : '', c?.hash ?? null);
    if (!ok || !c) { this.#echec(cle); this.#echecGlobal(global); throw new ErreurApi(401, 'identifiants', 'Identifiant ou mot de passe incorrect.'); }
    if (c.statut !== 'actif') throw new ErreurApi(403, 'compte_desactive', 'Ce compte est désactivé : demandez à un administrateur de l’entreprise.');
    this.#essais.delete(cle);
    c.derniereConnexion = this.#maintenant().toISOString();
    this.#changement();
    return c;
  }

  /** Compte actif d'une session (la version doit correspondre : sinon la session a été coupée). */
  actif(id: string | null, version: number): Compte | null {
    const c = id ? this.#comptes.find((x) => x.id === id) : undefined;
    return c && c.statut === 'actif' && c.version === version ? c : null;
  }

  parId(id: string): Compte | null {
    return this.#comptes.find((x) => x.id === id) ?? null;
  }

  pourProfil(profilId: string): ResumeConnexion | null {
    const c = this.#comptes.find((x) => x.profilId === profilId);
    return c ? { identifiant: c.identifiant, statut: c.statut, derniereConnexion: c.derniereConnexion, invitationExpire: c.invitation?.expire ?? null, deuxEtapes: Boolean(c.deuxEtapes) } : null;
  }

  profilsAvecCompte(): Set<string> {
    return new Set(this.#comptes.map((c) => c.profilId));
  }

  // ---------------------------------------------------------------- collègues (administrateur)

  /** Lien d'invitation (nouveau compte, ou réinitialisation d'un mot de passe oublié). Le jeton n'est montré qu'ici. */
  inviter(admin: Profil, cible: Profil, identifiantBrut: unknown): { jeton: string; expire: string; identifiant: string } {
    if (!admin.peutAdministrer) throw new ErreurApi(403, 'interdit');
    let c = this.#comptes.find((x) => x.profilId === cible.id);
    const identifiant = identifiantBrut === undefined || identifiantBrut === '' ? c?.identifiant ?? null : normaliserIdentifiant(identifiantBrut);
    if (!identifiant) throw new ErreurApi(400, 'identifiant_invalide', 'Identifiant : e-mail ou prénom (lettres, chiffres, . _ - @).');
    if (this.#comptes.some((x) => x.identifiant === identifiant && x.profilId !== cible.id)) throw new ErreurApi(409, 'identifiant_pris', 'Cet identifiant est déjà utilisé par une autre personne.');
    if (this.#comptes.length >= 1000 && !c) throw new ErreurApi(409, 'trop_de_comptes');
    const jeton = randomBytes(32).toString('base64url');
    const expire = new Date(this.#maintenant().getTime() + DUREE_INVITATION_MS).toISOString();
    if (!c) {
      c = { id: `cpt-${randomUUID().slice(0, 12)}`, profilId: cible.id, identifiant, hash: null, statut: 'invite', invitation: null, secours: null, version: 1, creeLe: this.#maintenant().toISOString(), derniereConnexion: null };
      this.#comptes.push(c);
    }
    c.identifiant = identifiant;
    c.invitation = { empreinte: sha(jeton), expire };
    this.#changement();
    return { jeton, expire, identifiant };
  }

  #parInvitation(jeton: unknown): Compte {
    if (typeof jeton !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(jeton)) throw new ErreurApi(404, 'invitation_inconnue', 'Lien d’invitation inconnu ou déjà utilisé.');
    const e = Buffer.from(sha(jeton));
    const c = this.#comptes.find((x) => x.invitation && x.invitation.empreinte.length === e.length && timingSafeEqual(Buffer.from(x.invitation.empreinte), e));
    if (!c?.invitation) throw new ErreurApi(404, 'invitation_inconnue', 'Lien d’invitation inconnu ou déjà utilisé.');
    if (c.invitation.expire < this.#maintenant().toISOString()) throw new ErreurApi(410, 'invitation_expiree', 'Ce lien a expiré : demandez-en un nouveau à un administrateur.');
    return c;
  }

  infoInvitation(jeton: unknown): { identifiant: string; profilId: string } {
    const c = this.#parInvitation(jeton);
    return { identifiant: c.identifiant, profilId: c.profilId };
  }

  async accepterInvitation(jeton: unknown, motDePasse: unknown): Promise<Compte> {
    const c = this.#parInvitation(jeton);
    const pb = problemeMotDePasse(motDePasse, c.identifiant);
    if (pb) throw new ErreurApi(400, 'mot_de_passe_faible', pb);
    c.hash = await hacher(motDePasse as string);
    c.invitation = null;
    c.statut = 'actif';
    c.version++;
    c.derniereConnexion = this.#maintenant().toISOString();
    this.#retirerDeuxEtapes(c); // lien remis par un administrateur : téléphone perdu, on repart de zéro
    this.#changement();
    return c;
  }

  #actifsAdmin(profils: readonly Profil[]): Compte[] {
    const admins = new Set(profils.filter((p) => p.peutAdministrer).map((p) => p.id));
    return this.#comptes.filter((c) => c.statut === 'actif' && admins.has(c.profilId));
  }

  desactiver(admin: Profil, cibleId: string, profils: readonly Profil[]) {
    if (!admin.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (cibleId === admin.id) throw new ErreurApi(409, 'soi_meme', 'Vous ne pouvez pas désactiver votre propre compte.');
    const c = this.#comptes.find((x) => x.profilId === cibleId);
    if (!c) throw new ErreurApi(404, 'introuvable');
    if (c.statut === 'actif' && this.#actifsAdmin(profils).filter((x) => x.id !== c.id).length === 0) throw new ErreurApi(409, 'dernier_administrateur');
    c.statut = 'desactive';
    c.invitation = null;
    c.version++;
    this.#changement();
    return this.pourProfil(cibleId);
  }

  reactiver(admin: Profil, cibleId: string) {
    if (!admin.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const c = this.#comptes.find((x) => x.profilId === cibleId);
    if (!c) throw new ErreurApi(404, 'introuvable');
    if (!c.hash) throw new ErreurApi(409, 'jamais_active', 'Cette personne n’a pas encore choisi de mot de passe : envoyez-lui un nouveau lien.');
    c.statut = 'actif';
    c.version++;
    this.#changement();
    return this.pourProfil(cibleId);
  }

  /** Le profil a été supprimé : son compte disparaît (ses sessions tombent aussitôt). */
  retirer(profilId: string) {
    const n = this.#comptes.length;
    this.#comptes = this.#comptes.filter((c) => c.profilId !== profilId);
    if (this.#comptes.length !== n) this.#changement();
  }

  /** Avant de retirer les droits d'administration (ou le profil) `sauf` : il doit rester un administrateur qui peut se connecter. */
  verifierAdministrateurs(profils: readonly Profil[], sauf: string) {
    if (!this.installe) return;
    if (this.#actifsAdmin(profils).filter((c) => c.profilId !== sauf).length === 0) throw new ErreurApi(409, 'dernier_administrateur', 'Il faut garder au moins une personne qui peut se connecter et administrer.');
  }

  // ---------------------------------------------------------------- mon compte, secours

  async changerMotDePasse(compteId: string, actuel: unknown, nouveau: unknown): Promise<Compte> {
    const c = this.parId(compteId);
    if (!c?.hash) throw new ErreurApi(404, 'introuvable');
    const cle = `mdp:${c.id}`;
    this.#verifierBlocage(cle);
    if (!(await verifierHash(typeof actuel === 'string' ? actuel.slice(0, 200) : '', c.hash))) { this.#echec(cle); throw new ErreurApi(401, 'mot_de_passe_actuel', 'Mot de passe actuel incorrect.'); }
    const pb = problemeMotDePasse(nouveau, c.identifiant);
    if (pb) throw new ErreurApi(400, 'mot_de_passe_faible', pb);
    c.hash = await hacher(nouveau as string);
    c.version++;
    this.#changement();
    return c;
  }

  async nouveauCodeSecours(compteId: string, motDePasse: unknown): Promise<string> {
    const c = this.parId(compteId);
    if (!c?.hash) throw new ErreurApi(404, 'introuvable');
    const cle = `mdp:${c.id}`;
    this.#verifierBlocage(cle);
    if (!(await verifierHash(typeof motDePasse === 'string' ? motDePasse.slice(0, 200) : '', c.hash))) { this.#echec(cle); throw new ErreurApi(401, 'mot_de_passe_actuel', 'Mot de passe incorrect.'); }
    const code = codeSecours();
    c.secours = sha(normaliserCode(code));
    this.#changement();
    return code;
  }

  /** Mot de passe oublié : identifiant + code de secours → nouveau mot de passe. Le code est consommé et remplacé. */
  async parCodeSecours(identifiantBrut: unknown, code: unknown, nouveau: unknown, adresse: string | null = null): Promise<{ compte: Compte; codeSecours: string }> {
    const identifiant = normaliserIdentifiant(identifiantBrut) ?? '';
    // même verrou que la connexion : par (identifiant, adresse), et ralentissement au-delà du plafond de l'heure
    const global = `sec:${identifiant}`;
    const cle = `${global}\n${origineEssai(adresse)}`;
    this.#verifierBlocage(cle);
    await this.#ralentir(global);
    const c = this.#comptes.find((x) => x.identifiant === identifiant);
    const donne = Buffer.from(sha(normaliserCode(code)));
    const attendu = Buffer.from(c?.secours ?? sha('aucun-code'));
    if (!c?.secours || !timingSafeEqual(donne, attendu) || c.statut === 'invite') { this.#echec(cle); this.#echecGlobal(global); throw new ErreurApi(401, 'code_secours', 'Identifiant ou code de secours incorrect.'); }
    const pb = problemeMotDePasse(nouveau, c.identifiant);
    if (pb) throw new ErreurApi(400, 'mot_de_passe_faible', pb);
    this.#essais.delete(cle);
    const suivant = codeSecours();
    c.hash = await hacher(nouveau as string);
    c.secours = sha(normaliserCode(suivant));
    c.statut = 'actif';
    c.version++;
    this.#retirerDeuxEtapes(c);
    c.derniereConnexion = this.#maintenant().toISOString();
    this.#changement();
    return { compte: c, codeSecours: suivant };
  }

  /** Comptes administrateurs (pour la réinitialisation sur l'ordinateur, `npm run secours`). */
  administrateurs(profils: readonly Profil[]): { identifiant: string }[] {
    const admins = new Set(profils.filter((p) => p.peutAdministrer).map((p) => p.id));
    return this.#comptes.filter((c) => admins.has(c.profilId) && c.hash).map((c) => ({ identifiant: c.identifiant }));
  }

  /** Réinitialisation sur place (le jeton a été vérifié par l'appelant : il prouve l'accès au dossier des données). */
  async reinitialiserSurPlace(identifiantBrut: unknown, nouveau: unknown, profils: readonly Profil[]): Promise<Compte> {
    const identifiant = normaliserIdentifiant(identifiantBrut);
    const admins = new Set(profils.filter((p) => p.peutAdministrer).map((p) => p.id));
    const c = this.#comptes.find((x) => x.identifiant === identifiant && admins.has(x.profilId));
    if (!c) throw new ErreurApi(404, 'introuvable', 'Choisissez un compte administrateur.');
    const pb = problemeMotDePasse(nouveau, c.identifiant);
    if (pb) throw new ErreurApi(400, 'mot_de_passe_faible', pb);
    c.hash = await hacher(nouveau as string);
    c.statut = 'actif';
    c.invitation = null;
    c.version++;
    c.derniereConnexion = this.#maintenant().toISOString();
    this.#retirerDeuxEtapes(c);
    this.#changement();
    return c;
  }

  // ---------------------------------------------------------------- validation en deux étapes (TOTP)

  resumeDeuxEtapes(c: Compte): ResumeDeuxEtapes {
    return { active: Boolean(c.deuxEtapes), activeLe: c.deuxEtapes?.activeLe ?? null, codesRestants: c.deuxEtapes?.codes.length ?? 0 };
  }

  #retirerDeuxEtapes(c: Compte) {
    c.deuxEtapes = null;
    this.#enrolements.delete(c.id);
  }

  async #verifierMotDePasse(c: Compte, motDePasse: unknown) {
    const cle = `mdp:${c.id}`;
    this.#verifierBlocage(cle);
    if (!(await verifierHash(typeof motDePasse === 'string' ? motDePasse.slice(0, 200) : '', c.hash))) { this.#echec(cle); throw new ErreurApi(401, 'mot_de_passe_actuel', 'Mot de passe incorrect.'); }
    this.#essais.delete(cle);
  }

  /** Début de l'activation : nouveau secret (160 bits), gardé en mémoire 15 min jusqu'au premier code. */
  demarrerDeuxEtapes(compteId: string, emetteur: string): { secret: string; uri: string } {
    const c = this.parId(compteId);
    if (!c?.hash) throw new ErreurApi(404, 'introuvable');
    if (c.deuxEtapes) throw new ErreurApi(409, 'deux_etapes_active', 'La validation en deux étapes est déjà active. Pour changer de téléphone, désactivez-la puis réactivez-la.');
    const secret = randomBytes(20);
    this.#enrolements.set(c.id, { secret, expire: this.#horloge() + DUREE_ENROLEMENT_MS });
    if (this.#enrolements.size > 1000) this.#enrolements.delete(this.#enrolements.keys().next().value as string);
    const b32 = base32(secret);
    return { secret: b32, uri: uriOtpauth(b32, c.identifiant, emetteur) };
  }

  /** Fin de l'activation : le premier code prouve que le téléphone est réglé. Renvoie les codes de récupération (montrés une fois). */
  confirmerDeuxEtapes(compteId: string, code: unknown): { codes: string[]; compte: Compte } {
    const c = this.parId(compteId);
    if (!c?.hash) throw new ErreurApi(404, 'introuvable');
    const e = this.#enrolements.get(c.id);
    if (!e || e.expire < this.#horloge()) throw new ErreurApi(409, 'activation_expiree', 'Activation expirée : recommencez (nouveau QR code).');
    const cle = `2fa:${c.id}`;
    this.#verifierBlocage(cle);
    const pas = verifierTotp(e.secret, code, this.#horloge());
    if (pas === null) { this.#echec(cle); throw new ErreurApi(401, 'code_invalide', 'Code incorrect : saisissez les 6 chiffres affichés par l’application (vérifiez aussi l’heure du téléphone).'); }
    this.#essais.delete(cle);
    this.#enrolements.delete(c.id);
    const codes = Array.from({ length: NB_CODES_RECUPERATION }, codeRecuperation);
    c.deuxEtapes = { secret: this.#chiffreur.chiffrer(e.secret.toString('base64')), activeLe: this.#maintenant().toISOString(), dernierPas: pas, codes: codes.map((x) => sha(normaliserCode(x))) };
    c.version++; // les autres sessions ouvertes (avant la protection) sont coupées
    this.#changement();
    return { codes, compte: c };
  }

  /** Code d'application (6 chiffres) ou code de récupération (consommé). Faux : null. */
  #controlerCode(c: Compte, code: unknown): 'application' | 'recuperation' | null {
    const d = c.deuxEtapes;
    if (!d || typeof code !== 'string' || code.length > 40) return null;
    const chiffres = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(chiffres)) {
      let secret: Buffer;
      try { secret = Buffer.from(this.#chiffreur.dechiffrer(d.secret), 'base64'); } catch { return null; }
      const pas = verifierTotp(secret, chiffres, this.#horloge(), { apres: d.dernierPas });
      if (pas === null) return null;
      d.dernierPas = pas;
      return 'application';
    }
    const donne = Buffer.from(sha(normaliserCode(code)));
    let trouve = -1;
    d.codes.forEach((h, i) => {
      const b = Buffer.from(h);
      if (b.length === donne.length && timingSafeEqual(b, donne) && trouve < 0) trouve = i;
    });
    if (trouve < 0 || normaliserCode(code).length !== 8) return null;
    d.codes.splice(trouve, 1);
    return 'recuperation';
  }

  /** Deuxième étape de la connexion (5 erreurs → 15 min de blocage du compte). */
  verifierDeuxEtapes(compteId: string, code: unknown): { recuperation: boolean; codesRestants: number } {
    const c = this.parId(compteId);
    if (!c?.deuxEtapes) throw new ErreurApi(409, 'deux_etapes_inactive');
    const cle = `2fa:${c.id}`;
    this.#verifierBlocage(cle);
    const r = this.#controlerCode(c, code);
    if (!r) { this.#echec(cle); throw new ErreurApi(401, 'code_invalide', 'Code incorrect ou déjà utilisé.'); }
    this.#essais.delete(cle);
    c.derniereConnexion = this.#maintenant().toISOString();
    this.#changement();
    return { recuperation: r === 'recuperation', codesRestants: c.deuxEtapes.codes.length };
  }

  /** Désactivation : mot de passe ET code valide. */
  async desactiverDeuxEtapes(compteId: string, motDePasse: unknown, code: unknown): Promise<void> {
    const c = this.parId(compteId);
    if (!c?.hash) throw new ErreurApi(404, 'introuvable');
    if (!c.deuxEtapes) return;
    await this.#verifierMotDePasse(c, motDePasse);
    this.verifierDeuxEtapes(c.id, code);
    this.#retirerDeuxEtapes(c);
    this.#changement();
  }

  /**
   * Nouvelle preuve d'identité avant une opération sensible (export complet des données) : mot de passe, puis code de
   * l'application (ou de récupération) si la validation en deux étapes est active. Mêmes blocages que la connexion.
   */
  async confirmerIdentite(compteId: string, motDePasse: unknown, code: unknown): Promise<void> {
    const c = this.parId(compteId);
    if (!c?.hash) throw new ErreurApi(404, 'introuvable');
    await this.#verifierMotDePasse(c, motDePasse);
    if (!c.deuxEtapes) return;
    const cle = `2fa:${c.id}`;
    this.#verifierBlocage(cle);
    if (!this.#controlerCode(c, code)) { this.#echec(cle); throw new ErreurApi(401, 'code_invalide', 'Code de validation incorrect ou déjà utilisé.'); }
    this.#essais.delete(cle);
    this.#changement(); // pas du code ou code de récupération consommé : enregistré (pas de rejeu)
  }

  /** Nouveaux codes de récupération (les anciens ne marchent plus). */
  async nouveauxCodesRecuperation(compteId: string, motDePasse: unknown): Promise<string[]> {
    const c = this.parId(compteId);
    if (!c?.hash) throw new ErreurApi(404, 'introuvable');
    if (!c.deuxEtapes) throw new ErreurApi(409, 'deux_etapes_inactive', 'Activez d’abord la validation en deux étapes.');
    await this.#verifierMotDePasse(c, motDePasse);
    const codes = Array.from({ length: NB_CODES_RECUPERATION }, codeRecuperation);
    c.deuxEtapes.codes = codes.map((x) => sha(normaliserCode(x)));
    this.#changement();
    return codes;
  }
}
