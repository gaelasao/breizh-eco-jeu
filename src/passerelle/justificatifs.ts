/**
 * Justificatifs photographiés sur place (facture de dépôt, bon de livraison, ticket de carburant).
 *
 * Ce que la personne fait : un bouton, l'appareil photo du téléphone, puis TROIS champs courts — montant, date,
 * fournisseur. Rien d'autre. La photo est rangée ici, rattachée au chantier ou à la commande ouverte, et la ligne
 * entre dans ce qui part au comptable.
 *
 * AUCUNE LECTURE AUTOMATIQUE DE L'IMAGE n'est faite ici : ni reconnaissance embarquée (ce serait une dépendance),
 * ni envoi à un service (les données de l'entreprise ne sortent pas). Les champs sont pré-remplis de ce qu'on sait
 * SANS RIEN LIRE — la date du jour, le dernier fournisseur saisi pour ce chantier — et restent modifiables.
 * Une entreprise qui a branché son propre agent sur le serveur MCP de Living Business peut lui demander de lire la
 * photo : l'agent PROPOSE les trois valeurs (`proposer`), une personne les vérifie et enregistre. C'est son agent,
 * son coût, et rien ne part chez l'éditeur.
 *
 * Où sont les photos :
 * - avec un dossier de données : un fichier par photo dans `<données>/justificatifs/`, dossier 0700, fichiers 0600,
 *   nommés d'après l'identifiant interne (aucun nom de fichier ne vient de la requête) ;
 * - sans dossier (démonstration, tests) : en mémoire, et seulement les dernières (`MEMOIRE_MAX`).
 * Le fichier `monde.json` ne contient QUE la fiche (quelques centaines d'octets) : les mégaoctets d'une photo ne
 * passent jamais par l'état enregistré à chaque changement, ni par la copie chiffrée exportable.
 *
 * Quand c'est trop : au-delà de `PLACE_MAX`, une nouvelle photo est REFUSÉE avec un message clair (jamais une vieille
 * photo effacée d'office : un justificatif comptable ne se jette pas tout seul). L'écran prévient dès `PLACE_AVIS`.
 */
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Profil } from '../demo/donnees.ts';
import { ErreurApi, type Monde } from './monde.ts';

/** Photo acceptée au plus (une photo de facture au téléphone pèse 2 à 4 Mo ; 12 Mo laisse de la marge). */
export const TAILLE_MAX = 12 * 1_000_000;
/** Place occupée par toutes les photos au plus (2 Go ≈ 650 photos de 3 Mo, soit plusieurs années d'un artisan). */
export const PLACE_MAX = 2_000_000_000;
/** À partir de cette part de la place, l'écran prévient (sans rien bloquer). */
export const PLACE_AVIS = 0.8;
/** Sans dossier de données (démonstration) : les photos restent en mémoire, et seulement les dernières. */
export const MEMOIRE_MAX = 20;
/** Dossier des photos, à côté de `monde.json`. */
export const DOSSIER_PHOTOS = 'justificatifs';

/** Types d'image acceptés, reconnus à l'octet (l'en-tête annoncé par le navigateur ne décide de rien). */
export const TYPES_ACCEPTES = Object.freeze(['JPEG', 'PNG', 'WebP', 'HEIC']);

export interface ImageReconnue { mime: string; ext: 'jpg' | 'png' | 'webp' | 'heic' }

const commence = (b: Buffer, octets: readonly number[], a = 0): boolean =>
  b.length >= a + octets.length && octets.every((o, i) => b[a + i] === o);
const marque = (b: Buffer, texte: string, a: number): boolean => b.length >= a + texte.length && b.toString('latin1', a, a + texte.length) === texte;
/** Marques de type d'un fichier HEIF (celles qu'un appareil photo écrit ; `avif` est une autre famille, non acceptée). */
const MARQUES_HEIC = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevm', 'hevs', 'mif1', 'msf1'];

/**
 * Type d'une photo, lu dans ses premiers octets. `null` : ce n'est pas une des images acceptées (un PDF, un document,
 * un fichier renommé). Rien n'est enregistré avant ce contrôle.
 */
export function reconnaitreImage(b: Buffer): ImageReconnue | null {
  if (commence(b, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (commence(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (marque(b, 'RIFF', 0) && marque(b, 'WEBP', 8)) return { mime: 'image/webp', ext: 'webp' };
  if (marque(b, 'ftyp', 4) && MARQUES_HEIC.some((m) => marque(b, m, 8))) return { mime: 'image/heic', ext: 'heic' };
  return null;
}

/**
 * Poids d'un fichier, dit comme on le dit : « 420 ko », « 2,4 Mo », « 1,7 Go ». La MÊME règle qu'à l'écran
 * (`poids` de web/saisie.js) : un refus annoncé là-bas et un refus écrit ici parlent des mêmes nombres.
 */
export function poids(octets: number): string {
  const virgule = (x: number) => x.toFixed(1).replace('.', ',');
  if (octets >= 1_000_000_000) return `${virgule(octets / 1_000_000_000)} Go`;
  if (octets >= 1_000_000) return `${virgule(octets / 1_000_000)} Mo`;
  return `${Math.round(octets / 1000)} ko`;
}

export const REFUS_TYPE = `Ce fichier n’est pas une photo (${TYPES_ACCEPTES.join(', ')} seulement). Reprenez-la avec l’appareil du téléphone.`;
export const refusTaille = (octets: number): string => `Photo trop lourde : ${poids(octets)}, alors que le maximum est ${poids(TAILLE_MAX)}. Reprenez-la en qualité normale.`;
export const refusPlace = (occupe: number, max = PLACE_MAX): string =>
  `Les photos des justificatifs occupent déjà ${poids(occupe)} sur ${poids(max)}. Exportez-les pour votre comptable, puis retirez les plus anciennes : cette photo-ci n’a pas été enregistrée.`;

/**
 * Une photo rangée et ce qu'on en sait. Les trois champs restent vides tant que personne ne les a remplis : le
 * justificatif est alors « à compléter », et l'écran le redit.
 */
export interface FicheJustificatif {
  id: string;
  /** Instant où la photo a été rangée. */
  le: string;
  mime: string;
  ext: string;
  octets: number;
  /** Fiche à laquelle la photo est rattachée (chantier, commande…) ; null : pas encore rangée. */
  concerne: string | null;
  montant: number | null;
  /** Date du justificatif, AAAA-MM-JJ. */
  date: string | null;
  fournisseur: string;
  /** Proposition d'un agent de l'entreprise (serveur MCP) : jamais enregistrée sans qu'une personne la valide. */
  propose: PropositionJustificatif | null;
  /** Profil qui a pris la photo. */
  par: string;
}

export interface PropositionJustificatif {
  montant: number | null;
  date: string | null;
  fournisseur: string;
  le: string;
  /** Qui l'a proposée (« votre agent », nom de la clé d'API) : montré tel quel à l'écran. */
  par: string;
}

export interface EtatJustificatifs {
  fiches: FicheJustificatif[];
}

const ID = /^jt-[0-9a-f]{18}$/;
const EXTENSIONS = new Set(['jpg', 'png', 'webp', 'heic']);
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Texte d'un champ court, sur une ligne, sans caractère de contrôle ni de direction. */
const uneLigne = (x: unknown, max: number): string =>
  (typeof x === 'string' ? x.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Montant lu d'un champ de saisie (« 128,40 », « 128.4 ») : positif, deux décimales. null quand le champ est vide. */
export function montantLu(x: unknown): number | null {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : Number(String(x).replace(/[\s  €]/g, '').replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 10_000_000) throw new ErreurApi(400, 'montant_invalide', 'Montant : un nombre en euros, par exemple 128,40.');
  return Math.round(n * 100) / 100;
}

/** Date lue d'un champ de saisie : AAAA-MM-JJ (celle que donne un champ `type="date"`). null quand le champ est vide. */
export function jourLu(x: unknown): string | null {
  if (x === null || x === undefined || x === '') return null;
  const t = String(x).trim();
  if (!JOUR.test(t) || !new Date(`${t}T00:00:00Z`).toISOString().startsWith(t)) throw new ErreurApi(400, 'date_invalide', 'Date : jour du justificatif, par exemple 16/11/2026.');
  return t;
}

/**
 * Fournisseur proposé, SANS RIEN LIRE DE LA PHOTO : le dernier saisi pour ce chantier, sinon le dernier saisi tout
 * court. Vide quand il n'y en a aucun — le champ reste à remplir, le jeu n'invente pas un nom.
 */
export function fournisseurPropose(fiches: readonly FicheJustificatif[], concerne: string | null): string {
  const remplies = fiches.filter((f) => f.fournisseur).sort((a, b) => a.le.localeCompare(b.le));
  const ici = concerne ? remplies.filter((f) => f.concerne === concerne) : [];
  return (ici.at(-1) ?? remplies.at(-1))?.fournisseur ?? '';
}

function lireFiche(x: unknown): FicheJustificatif | null {
  if (!estObj(x) || typeof x.id !== 'string' || !ID.test(x.id) || typeof x.ext !== 'string' || !EXTENSIONS.has(x.ext)) return null;
  const p = estObj(x.propose) ? x.propose : null;
  return {
    id: x.id,
    le: typeof x.le === 'string' ? x.le : new Date(0).toISOString(),
    mime: typeof x.mime === 'string' ? x.mime.slice(0, 40) : 'image/jpeg',
    ext: x.ext,
    octets: typeof x.octets === 'number' && Number.isFinite(x.octets) && x.octets >= 0 ? Math.round(x.octets) : 0,
    concerne: typeof x.concerne === 'string' && x.concerne ? x.concerne.slice(0, 80) : null,
    montant: typeof x.montant === 'number' && Number.isFinite(x.montant) ? x.montant : null,
    date: typeof x.date === 'string' && JOUR.test(x.date) ? x.date : null,
    fournisseur: uneLigne(x.fournisseur, 120),
    propose: p ? {
      montant: typeof p.montant === 'number' && Number.isFinite(p.montant) ? p.montant : null,
      date: typeof p.date === 'string' && JOUR.test(p.date) ? p.date : null,
      fournisseur: uneLigne(p.fournisseur, 120),
      le: typeof p.le === 'string' ? p.le : new Date(0).toISOString(),
      par: uneLigne(p.par, 80),
    } : null,
    par: typeof x.par === 'string' ? x.par.slice(0, 80) : '',
  };
}

export interface OptionsJustificatifs {
  etat?: EtatJustificatifs | null;
  /** Dossier des données (`<données>/justificatifs/`) ; null = en mémoire. */
  dossier?: string | null;
  changement?: () => void;
  /** Place accordée aux photos ; `PLACE_MAX` par défaut. Abaissée par les tests pour vérifier le refus en clair. */
  placeMax?: number;
}

/** Ce qu'une vue montre d'un justificatif : la fiche, le nom de ce à quoi il est rattaché, et s'il est complet. */
export interface VueJustificatif extends FicheJustificatif {
  concerneNom: string | null;
  complet: boolean;
}

export class Justificatifs {
  readonly #monde: Monde;
  readonly #dossier: string | null;
  readonly #changement: () => void;
  readonly #placeMax: number;
  #fiches: FicheJustificatif[];
  /** Photos gardées en mémoire quand il n'y a pas de dossier de données (démonstration, tests). */
  readonly #memoire = new Map<string, Buffer>();

  constructor(monde: Monde, o: OptionsJustificatifs = {}) {
    this.#monde = monde;
    this.#dossier = o.dossier ? join(o.dossier, DOSSIER_PHOTOS) : null;
    this.#changement = o.changement ?? (() => undefined);
    this.#placeMax = o.placeMax && o.placeMax > 0 ? o.placeMax : PLACE_MAX;
    this.#fiches = (Array.isArray(o.etat?.fiches) ? o.etat.fiches : []).map(lireFiche).filter((f): f is FicheJustificatif => f !== null);
  }

  instantane(): EtatJustificatifs {
    return { fiches: this.#fiches.map((f) => ({ ...f, propose: f.propose ? { ...f.propose } : null })) };
  }

  /** Place occupée par les photos, et ce qu'il reste. */
  place(): { octets: number; nombre: number; max: number; presque: boolean } {
    const octets = this.#fiches.reduce((n, f) => n + f.octets, 0);
    return { octets, nombre: this.#fiches.length, max: this.#placeMax, presque: octets >= this.#placeMax * PLACE_AVIS };
  }

  // ---------------------------------------------------------------- lecture

  /** Justificatifs visibles par ce profil (ceux rattachés à une fiche hors de son périmètre sont écartés). */
  lister(p: Profil, sid: string, concerne: string | null = null): VueJustificatif[] {
    const noms = this.#monde.nomsVisibles(p, sid);
    const res: VueJustificatif[] = [];
    for (const f of this.#fiches) {
      if (concerne && f.concerne !== concerne) continue;
      // rattaché à une fiche que ce profil ne voit pas : il ne voit pas la photo non plus
      if (f.concerne && !noms.has(f.concerne)) continue;
      res.push(this.#vue(f, f.concerne ? noms.get(f.concerne) ?? null : null));
    }
    return res.sort((a, b) => b.le.localeCompare(a.le));
  }

  /** Un justificatif précis, avec le contrôle de périmètre. */
  fiche(p: Profil, sid: string, id: unknown): VueJustificatif {
    const f = this.#trouver(id);
    const nom = f.concerne ? this.#nomVisible(p, sid, f.concerne) : null;
    if (f.concerne && nom === null) throw new ErreurApi(404, 'introuvable');
    return this.#vue(f, nom);
  }

  /** Les octets de la photo (écran, export, lecture par l'agent de l'entreprise). */
  photo(p: Profil, sid: string, id: unknown): { octets: Buffer; mime: string; nom: string } {
    const f = this.fiche(p, sid, id);
    const octets = this.#lire(f);
    if (!octets) throw new ErreurApi(410, 'photo_absente', 'La photo n’est plus dans le dossier des données (fichier retiré à la main, ou copie restaurée sans les photos).');
    return { octets, mime: f.mime, nom: `${f.id}.${f.ext}` };
  }

  #vue(f: FicheJustificatif, concerneNom: string | null): VueJustificatif {
    return { ...f, propose: f.propose ? { ...f.propose } : null, concerneNom, complet: f.montant !== null && f.date !== null && f.fournisseur !== '' };
  }

  /** Nom d'une fiche si ce profil la voit, null sinon. */
  #nomVisible(p: Profil, sid: string, id: string): string | null {
    return this.#monde.nomsVisibles(p, sid).get(id) ?? null;
  }

  #trouver(id: unknown): FicheJustificatif {
    const f = typeof id === 'string' && ID.test(id) ? this.#fiches.find((x) => x.id === id) : undefined;
    if (!f) throw new ErreurApi(404, 'introuvable');
    return f;
  }

  // ---------------------------------------------------------------- écriture

  /**
   * Range une photo. Le type est lu dans les octets, la taille et la place sont vérifiées, puis le fichier est écrit
   * AVANT la fiche : une fiche n'existe jamais sans sa photo.
   */
  ajouter(p: Profil, sid: string, octets: Buffer, concerne: unknown = null): VueJustificatif {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit', 'Votre rôle ne permet pas d’ajouter un justificatif.');
    if (!octets.length) throw new ErreurApi(400, 'photo_vide', 'Aucune photo reçue : reprenez-la.');
    if (octets.length > TAILLE_MAX) throw new ErreurApi(413, 'photo_trop_lourde', refusTaille(octets.length));
    const type = reconnaitreImage(octets);
    if (!type) throw new ErreurApi(415, 'pas_une_photo', REFUS_TYPE);
    const place = this.place();
    if (place.octets + octets.length > place.max) throw new ErreurApi(507, 'place_insuffisante', refusPlace(place.octets, place.max));
    const cible = this.#rattachement(p, sid, concerne);
    const f: FicheJustificatif = {
      id: `jt-${randomBytes(9).toString('hex')}`,
      le: this.#monde.maintenant().toISOString(),
      mime: type.mime, ext: type.ext, octets: octets.length,
      concerne: cible?.id ?? null, montant: null, date: null, fournisseur: '', propose: null, par: p.id,
    };
    this.#ecrire(f, octets);
    this.#fiches.push(f);
    this.#monde.tracer(p, 'justificatif.ajoute', f.concerne, `photo ${type.ext.toUpperCase()} de ${poids(f.octets)}`);
    this.#changement();
    return this.#vue(f, cible?.nom ?? null);
  }

  /**
   * Les trois champs, et le rattachement. Ce que la personne enregistre remplace toujours ce qu'un agent avait
   * proposé (la proposition disparaît une fois tranchée).
   */
  completer(p: Profil, sid: string, id: unknown, d: unknown): VueJustificatif {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit', 'Votre rôle ne permet pas de modifier un justificatif.');
    const f = this.#trouver(id);
    if (f.concerne && this.#nomVisible(p, sid, f.concerne) === null) throw new ErreurApi(404, 'introuvable');
    const x = estObj(d) ? d : {};
    const montant = 'montant' in x ? montantLu(x.montant) : f.montant;
    const date = 'date' in x ? jourLu(x.date) : f.date;
    const fournisseur = 'fournisseur' in x ? uneLigne(x.fournisseur, 120) : f.fournisseur;
    const cible = 'concerne' in x ? this.#rattachement(p, sid, x.concerne) : null;
    f.montant = montant;
    f.date = date;
    f.fournisseur = fournisseur;
    if ('concerne' in x) f.concerne = cible?.id ?? null;
    f.propose = null;
    this.#monde.tracer(p, 'justificatif.complete', f.concerne, `${f.fournisseur || 'fournisseur à préciser'} — ${f.montant === null ? 'montant à préciser' : `${f.montant} €`}`);
    this.#changement();
    return this.#vue(f, f.concerne ? this.#nomVisible(p, sid, f.concerne) : null);
  }

  /**
   * Proposition d'un agent de l'entreprise qui a lu la photo sur SON serveur MCP : rien n'est enregistré dans les
   * trois champs, la proposition est montrée à l'écran et une personne la valide. Un agent ne décide jamais.
   */
  proposer(p: Profil, sid: string, id: unknown, d: unknown, par: string): VueJustificatif {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit', 'Votre rôle ne permet pas de proposer les champs d’un justificatif.');
    const f = this.#trouver(id);
    if (f.concerne && this.#nomVisible(p, sid, f.concerne) === null) throw new ErreurApi(404, 'introuvable');
    const x = estObj(d) ? d : {};
    const propose: PropositionJustificatif = {
      montant: montantLu(x.montant), date: jourLu(x.date), fournisseur: uneLigne(x.fournisseur, 120),
      le: this.#monde.maintenant().toISOString(), par: uneLigne(par, 80) || 'un agent',
    };
    if (propose.montant === null && propose.date === null && !propose.fournisseur) throw new ErreurApi(400, 'rien_a_proposer', 'Proposez au moins un des trois champs : montant, date, fournisseur.');
    f.propose = propose;
    this.#monde.tracer(p, 'justificatif.propose', f.concerne, `proposition de ${propose.par} (à valider par une personne)`);
    this.#changement();
    return this.#vue(f, f.concerne ? this.#nomVisible(p, sid, f.concerne) : null);
  }

  /** Retire une photo (la place est rendue tout de suite). Réservé aux profils qui peuvent approuver. */
  supprimer(p: Profil, sid: string, id: unknown): { id: string; octets: number } {
    if (!p.peutApprouver) throw new ErreurApi(403, 'interdit', 'Retirer un justificatif demande un rôle habilité.');
    const f = this.#trouver(id);
    if (f.concerne && this.#nomVisible(p, sid, f.concerne) === null) throw new ErreurApi(404, 'introuvable');
    this.#effacer(f);
    this.#fiches = this.#fiches.filter((x) => x.id !== f.id);
    this.#monde.tracer(p, 'justificatif.retire', f.concerne, `${f.fournisseur || 'sans fournisseur'} — ${poids(f.octets)}`);
    this.#changement();
    return { id: f.id, octets: f.octets };
  }

  /** Une fiche effacée (droit à l'effacement, purge) : ses justificatifs perdent leur rattachement, jamais leur photo. */
  oublierObjet(id: string): number {
    let n = 0;
    for (const f of this.#fiches) if (f.concerne === id) { f.concerne = null; n++; }
    if (n) this.#changement();
    return n;
  }

  /** Fiche à laquelle rattacher la photo : elle doit être visible par ce profil. */
  #rattachement(p: Profil, sid: string, id: unknown): { id: string; nom: string } | null {
    if (id === null || id === undefined || id === '') return null;
    if (typeof id !== 'string') throw new ErreurApi(400, 'rattachement_invalide');
    const nom = this.#nomVisible(p, sid, id);
    if (nom === null) throw new ErreurApi(404, 'introuvable', 'Fiche inconnue ou hors de votre périmètre.');
    return { id, nom };
  }

  // ---------------------------------------------------------------- fichiers

  #chemin(f: { id: string; ext: string }): string | null {
    return this.#dossier ? join(this.#dossier, `${f.id}.${f.ext}`) : null;
  }

  #ecrire(f: FicheJustificatif, octets: Buffer): void {
    const chemin = this.#chemin(f);
    if (!chemin) {
      this.#memoire.set(f.id, octets);
      // en mémoire : seulement les dernières photos (une démonstration ne doit pas remplir la mémoire du serveur)
      for (const id of [...this.#memoire.keys()].slice(0, Math.max(0, this.#memoire.size - MEMOIRE_MAX))) this.#memoire.delete(id);
      return;
    }
    try {
      mkdirSync(this.#dossier as string, { recursive: true, mode: 0o700 });
      const tmp = `${chemin}.${process.pid}.tmp`;
      writeFileSync(tmp, octets, { mode: 0o600 });
      renameSync(tmp, chemin);
      chmodSync(chemin, 0o600);
    } catch (e) {
      throw new ErreurApi(500, 'photo_non_enregistree', `La photo n’a pas pu être enregistrée (${e instanceof Error ? e.message : e}). Rien n’a été ajouté : réessayez.`);
    }
  }

  #lire(f: { id: string; ext: string }): Buffer | null {
    const chemin = this.#chemin(f);
    if (!chemin) return this.#memoire.get(f.id) ?? null;
    try { return existsSync(chemin) ? readFileSync(chemin) : null; } catch { return null; }
  }

  #effacer(f: FicheJustificatif): void {
    const chemin = this.#chemin(f);
    if (!chemin) { this.#memoire.delete(f.id); return; }
    try { unlinkSync(chemin); } catch { /* fichier déjà absent */ }
  }
}

// ---------------------------------------------------------------- ce qui part au comptable

/** En-tête du fichier remis au comptable (le même ordre que `ligneComptable`). */
export const ENTETES_COMPTABLES = Object.freeze(['Date', 'Fournisseur', 'Montant TTC', 'Rattaché à', 'Photo', 'Référence']);

/**
 * Une ligne du fichier remis au comptable. Le montant est écrit à la française (« 128,40 ») et la photo est nommée :
 * c'est le fichier à joindre, celui qui se trouve dans `<données>/justificatifs/`.
 */
export const ligneComptable = (j: VueJustificatif): string[] => [
  j.date ?? '',
  j.fournisseur,
  j.montant === null ? '' : j.montant.toFixed(2).replace('.', ','),
  j.concerneNom ?? '',
  `${j.id}.${j.ext}`,
  j.id,
];

/**
 * Ce qui part au comptable : les justificatifs COMPLETS d'une période, les plus anciens d'abord. Un justificatif
 * encore à compléter n'y entre pas — il est signalé à l'écran, pour que personne ne l'oublie.
 */
export function exportComptable(liste: readonly VueJustificatif[], o: { debut?: string | null; fin?: string | null } = {}):
{ lignes: string[][]; aCompleter: number; total: number } {
  const dans = (j: VueJustificatif) => (!o.debut || (j.date ?? '') >= o.debut) && (!o.fin || (j.date ?? '') <= o.fin);
  const complets = liste.filter((j) => j.complet && dans(j)).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '') || a.le.localeCompare(b.le));
  return {
    lignes: complets.map(ligneComptable),
    aCompleter: liste.filter((j) => !j.complet).length,
    total: Math.round(complets.reduce((s, j) => s + (j.montant ?? 0), 0) * 100) / 100,
  };
}
