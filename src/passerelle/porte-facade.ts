/**
 * LA PORTE DE LA FAÇADE : ouvrir une session depuis Breizhcosystem, sans second mot de passe.
 *
 * POURQUOI C'EST UN MODE, ET PAS LE NOUVEAU FONCTIONNEMENT. Les comptes du jeu sont LOCAUX par construction :
 * « l'entreprise gère seule ses accès, sans éditeur ni service extérieur » (`comptes.ts`). Une installation
 * auto-hébergée ne doit jamais avoir besoin de l'éditeur pour que quelqu'un se connecte — c'est la promesse, et
 * c'est aussi ce qui la rend utilisable le jour où l'éditeur n'existe plus. Cette porte ne s'ouvre donc QUE si
 * l'instance a été démarrée avec la clé publique de la façade et son identifiant d'entreprise : sans ces deux
 * réglages, le module refuse tout, et le jeu se connecte comme avant.
 *
 * CE QUI CIRCULE, ET CE QUI NE CIRCULE PAS. La façade signe un jeton court qui dit : quelle entreprise, quelle
 * personne, quel rôle, jusqu'à quand. L'instance n'a que la clé PUBLIQUE : elle vérifie, elle ne pourrait pas
 * fabriquer un jeton même si on prenait son disque. Aucun secret partagé, aucun aller-retour vers la façade au
 * moment de la connexion — une panne de Breizhcosystem ne doit pas empêcher quelqu'un d'entrer chez lui.
 *
 * LES QUATRE REFUS, ET CE QU'ILS ÉVITENT.
 *   · signature : un jeton fabriqué ailleurs ;
 *   · entreprise : le jeton d'un client ouvrant l'instance d'un autre — le seul défaut qui ne se rattrape pas ;
 *   · durée : un lien retrouvé dans un historique, un journal de proxy, un message ;
 *   · usage unique : le même lien rejoué (dans le dos de la personne, ou par qui l'a lu quelque part).
 *
 * FORMAT, VOLONTAIREMENT MINUSCULE : `bz1.<charge>.<signature>`, les deux en base64url, la signature portant sur
 * la chaîne `bz1.<charge>` telle quelle. Pas de JWT : pas de négociation d'algorithme, donc pas d'`alg: none` ni de
 * confusion de clé — une seule forme est acceptée, Ed25519, et tout le reste est refusé sans être lu.
 */
import { createPublicKey, verify as verifierSignature, type KeyObject } from 'node:crypto';

export const PREFIXE = 'bz1';
/** Au-delà, ce n'est plus un jeton : on refuse sans même le découper. */
export const TAILLE_MAX = 4000;
/** Durée de vie acceptée au maximum, quoi que dise le jeton : une façade abusée ne peut pas signer l'éternité. */
export const DUREE_MAX_S = 300;
/** Tolérance d'horloge entre la façade et l'instance : deux machines ne sont jamais à la seconde près. */
export const DERIVE_S = 30;

export interface ChargePorte {
  /** Entreprise à laquelle ce jeton donne accès. Doit être celle de l'instance, sinon tout s'écroule. */
  entreprise: string;
  /** Personne, telle que la façade la connaît (son identifiant de compte Breizhcosystem). */
  personne: string;
  /** Nom affiché, pour que la fiche d'accès ne soit pas un identifiant. */
  nom: string;
  /** Rôle côté façade. Le jeu le traduit en profil ; il ne reçoit jamais de droits tout faits. */
  role: 'administrateur' | 'collaborateur';
  /** Fin de validité, en secondes depuis 1970. */
  expire: number;
  /** Identifiant du jeton : c'est lui qui rend l'usage unique vérifiable. */
  jeton: string;
}

export type RefusPorte =
  | 'desactivee' | 'forme' | 'signature' | 'entreprise' | 'expire' | 'trop_long' | 'rejoue';

export interface ResultatPorte {
  ok: boolean;
  refus: RefusPorte | null;
  charge: ChargePorte | null;
}

/** Ce que l'instance sait d'elle-même. Sans `clePublique` ni `entreprise`, la porte n'existe pas. */
export interface ReglagePorte {
  clePublique: string | null;
  entreprise: string | null;
}

/**
 * La porte est-elle seulement installée ? Lu une fois au démarrage pour que l'écran puisse le dire, plutôt que de
 * laisser quelqu'un chercher pourquoi « Ouvrir depuis Breizhcosystem » ne fait rien.
 */
export const porteOuverte = (r: ReglagePorte): boolean => Boolean(r.clePublique?.trim() && r.entreprise?.trim());

/** Réglage lu dans l'environnement : posé par l'éditeur au démarrage d'une instance hébergée, jamais ailleurs. */
export function reglagePorte(env: NodeJS.ProcessEnv = process.env): ReglagePorte {
  return {
    clePublique: env.LB_FACADE_CLE?.trim() || null,
    entreprise: env.LB_FACADE_ENTREPRISE?.trim() || null,
  };
}

const b64 = (t: string): Buffer | null => {
  if (!/^[A-Za-z0-9_-]+$/.test(t)) return null;
  try {
    return Buffer.from(t, 'base64url');
  } catch {
    return null;
  }
};

const texte = (x: unknown, max: number): string =>
  (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/**
 * La clé publique de la façade, au format PEM ou en 32 octets bruts (base64url). Rendue `null` si elle n'est pas
 * une clé Ed25519 : une clé d'un autre type ne doit pas pouvoir servir par accident.
 */
export function cleFacade(brut: string | null): KeyObject | null {
  const t = (brut ?? '').trim();
  if (!t) return null;
  try {
    if (t.includes('BEGIN')) {
      const k = createPublicKey(t);
      return k.asymmetricKeyType === 'ed25519' ? k : null;
    }
    const octets = b64(t);
    if (!octets || octets.length !== 32) return null;
    // DER d'une clé publique Ed25519 : en-tête fixe de 12 octets, puis les 32 octets de la clé
    const der = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), octets]);
    const k = createPublicKey({ key: der, format: 'der', type: 'spki' });
    return k.asymmetricKeyType === 'ed25519' ? k : null;
  } catch {
    return null;
  }
}

/** Charge relue d'un jeton : rien n'est pris tel quel, tout est borné et vérifié. */
function lireCharge(brut: unknown): ChargePorte | null {
  if (typeof brut !== 'object' || brut === null) return null;
  const x = brut as Record<string, unknown>;
  const entreprise = texte(x.entreprise, 80);
  const personne = texte(x.personne, 80);
  const jeton = texte(x.jeton, 80);
  const role = x.role === 'administrateur' || x.role === 'collaborateur' ? x.role : null;
  const expire = typeof x.expire === 'number' && Number.isFinite(x.expire) ? Math.floor(x.expire) : null;
  if (!entreprise || !personne || !jeton || !role || expire === null) return null;
  return { entreprise, personne, nom: texte(x.nom, 80) || personne, role, expire, jeton };
}

/**
 * VÉRIFIER UN JETON D'OUVERTURE. Rend la charge seulement si tout tient : signature, entreprise, durée, usage.
 *
 * `dejaVu` dit si ce jeton a déjà servi, et doit l'enregistrer : c'est à l'appelant de le tenir, parce que lui seul
 * sait ce qui survit à un redémarrage. La vérification de la signature vient AVANT l'enregistrement — sinon
 * n'importe qui remplirait ce registre avec des jetons inventés.
 */
export function verifierPorte(
  brut: unknown,
  o: { reglage: ReglagePorte; maintenant: Date; dejaVu?: (jeton: string, expire: number) => boolean },
): ResultatPorte {
  const refus = (r: RefusPorte): ResultatPorte => ({ ok: false, refus: r, charge: null });
  if (!porteOuverte(o.reglage)) return refus('desactivee');
  if (typeof brut !== 'string' || !brut) return refus('forme');
  if (brut.length > TAILLE_MAX) return refus('trop_long');

  const parts = brut.split('.');
  if (parts.length !== 3 || parts[0] !== PREFIXE) return refus('forme');
  const charge64 = parts[1] as string;
  const signature = b64(parts[2] as string);
  const charge = b64(charge64);
  if (!signature || !charge || signature.length !== 64) return refus('forme');

  const cle = cleFacade(o.reglage.clePublique);
  if (!cle) return refus('desactivee');
  // la signature porte sur « bz1.<charge> » : le préfixe est signé lui aussi, pour qu'une autre version du format
  // ne puisse pas être relue comme celle-ci
  if (!verifierSignature(null, Buffer.from(`${PREFIXE}.${charge64}`, 'utf8'), cle, signature)) return refus('signature');

  let lu: unknown;
  try {
    lu = JSON.parse(charge.toString('utf8'));
  } catch {
    return refus('forme');
  }
  const c = lireCharge(lu);
  if (!c) return refus('forme');

  // L'ENTREPRISE D'ABORD. Un jeton valable, signé, frais, mais émis pour un autre client : c'est le seul défaut qui
  // mettrait les données d'une entreprise sous les yeux d'une autre, et il ne se rattrape pas.
  if (c.entreprise !== o.reglage.entreprise) return refus('entreprise');

  const maintenant = Math.floor(o.maintenant.getTime() / 1000);
  if (c.expire <= maintenant - DERIVE_S) return refus('expire');
  // une façade abusée ne signe pas l'éternité : au-delà du plafond, le jeton est refusé même s'il est authentique
  if (c.expire > maintenant + DUREE_MAX_S + DERIVE_S) return refus('expire');

  if (o.dejaVu?.(c.jeton, c.expire)) return refus('rejoue');
  return { ok: true, refus: null, charge: c };
}

/** Ce qu'on dit à la personne. Jamais pourquoi précisément : un refus ne doit pas apprendre à en fabriquer un bon. */
export const PHRASE_REFUS = 'Ce lien ne permet pas d’ouvrir cette installation. Revenez à Breizhcosystem et rouvrez-la depuis votre compte.';

/**
 * Registre des jetons déjà servis, en mémoire. Un jeton ne vaut que quelques minutes : il n'y a rien à garder au
 * redémarrage, et redémarrer ne rouvre donc aucune porte — les jetons d'avant sont expirés de toute façon.
 */
export class JetonsServis {
  readonly #vus = new Map<string, number>();
  readonly #max: number;

  constructor(max = 5000) {
    this.#max = max;
  }

  /** Vrai si ce jeton a DÉJÀ servi. Sinon il est enregistré, et le prochain passage le refusera. */
  servi(jeton: string, expire: number, maintenant: Date): boolean {
    const s = Math.floor(maintenant.getTime() / 1000);
    for (const [k, e] of this.#vus) if (e <= s) this.#vus.delete(k);
    if (this.#vus.has(jeton)) return true;
    // plein : on refuse plutôt que d'oublier un jeton récent, qui pourrait alors être rejoué
    if (this.#vus.size >= this.#max) return true;
    this.#vus.set(jeton, expire);
    return false;
  }
}
