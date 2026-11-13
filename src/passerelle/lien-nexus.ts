/**
 * Lien avec Breizhcosystem (réseau payant entre entreprises) — côté jeu, dans la passerelle locale.
 * - Liaison en un clic : Breizhcosystem affiche un code, l'entreprise le confirme, le jeu récupère SA clé (une fois).
 * - Partage CIBLÉ et sur accord : rien ne part tant que l'administrateur n'a pas coché une catégorie DANS LE JEU
 *   (après « voir ce qui partirait ») ; une catégorie part seulement si elle est cochée ici ET sur Breizhcosystem. Nouvelle
 *   liaison ou déliaison : tout est décoché.
 * - Ce qui part : profil (secteur), besoins détectés (rupture, renfort, location), surstocks à céder,
 *   capacité libre (nombre de personnes, jamais de nom), notes de santé 0–100 (jamais de montant ; sous 11 personnes,
 *   aucune note du domaine social : absences maladie, baromètre, formation). Jamais le nom
 *   libre d'un projet ou d'un lieu (souvent celui d'un client particulier, avec son adresse).
 * - Rien d'autre ne quitte l'ordinateur. Panne de Breizhcosystem : le jeu continue (dernier état connu).
 * - Agents d'achat : l'agent prépare, une personne valide toujours, le vendeur confirme ; paiement direct au vendeur
 *   (Stripe Checkout, virement, lien du vendeur), jamais via Breizhcosystem. Toute réponse de Breizhcosystem est relue avant usage.
 * - Échanges entre agents de deux entreprises : le jeu demande un prix et suit les échanges par l'agent de l'entreprise
 *   sur Breizhcosystem (protocole A2A, ce qu'une clé a le droit de faire). Il ne valide jamais une proposition : le réseau
 *   le réserve à une personne connectée chez lui ; le jeu donne seulement l'adresse de la page où le faire.
 */
import { randomUUID } from 'node:crypto';
import { personnesEnPoste, ratiosSante, type ResultatSante } from '../core/sante.ts';
import type { ObjetMetier } from '../core/model.ts';
import { lireDroits } from '../nexus/droits.ts';
import type { EtatNexus } from '../nexus/pavillon.ts';
import type { Chiffreur } from './stockage.ts';
import { ErreurApi } from './monde.ts';
import { ErreurSortante, lireTexteBorne, recuperateurProtege, verifierUrl, type Recuperateur } from './sortant.ts';
import { pluriel } from '../core/texte.ts';

export const CATEGORIES = ['profil', 'besoins', 'stocks', 'capacites', 'indicateurs'] as const;
export type Categorie = (typeof CATEGORIES)[number];

export interface EtatLienNexus {
  url: string | null;
  /** Clé d'organisation, chiffrée au repos. */
  cle: string | null;
  organisation: string | null;
  dernierEnvoi: string | null;
  derniereErreur: string | null;
  /** Catégories que l'administrateur a cochées dans le jeu ; vide = rien ne part (protection par défaut). */
  partageAccepte?: Categorie[];
}

export interface DonneesPartage {
  objets: readonly ObjetMetier[];
  planning: ReadonlyMap<string, ReadonlyMap<string, string>>;
  sante: ResultatSante | null;
  maintenant: Date;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

// ---------------------------------------------------------------- validation de ce qui vient de Breizhcosystem (et de l'écran)
// Rien de ce que renvoie Breizhcosystem n'est affiché ou utilisé sans être relu ici : identifiants UUID, textes bornés,
// liens https seulement, paiement en ligne UNIQUEMENT vers une page Stripe Checkout.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const REFERENCE = /^NX-[A-Z0-9]{4,12}$/;
const DEPARTEMENT = /^(?:\d{2,3}|2[AB])$/;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,185}\.[^\s@<>"]{2,}$/;
const estUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);
/** Texte d'une seule ligne, sans caractères de contrôle, tronqué à `max`. */
const ligne = (x: unknown, max: number): string | null => {
  if (typeof x !== 'string') return null;
  const t = x.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};
const positif = (x: unknown, max = 1e9): number | null => { const n = num(x); return n !== null && n > 0 && n <= max ? n : null; };
const positifOuNul = (x: unknown): number | null => { const n = num(x); return n !== null && n >= 0 && n <= 1e12 ? n : null; };

export const STATUTS_COMMANDE = ['a_valider', 'validee', 'confirmee', 'paiement_annonce', 'refusee', 'payee', 'annulee'] as const;
export type StatutCommande = (typeof STATUTS_COMMANDE)[number];
const estStatut = (x: unknown): x is StatutCommande => (STATUTS_COMMANDE as readonly unknown[]).includes(x);
/** Actions sur une commande (le paiement passe par `payer`, l'ancienne action « payée » n'existe plus). */
export const ACTIONS_COMMANDE = ['valider', 'annuler', 'confirmer', 'refuser', 'annoncer', 'recu', 'verifier'] as const;

/** Lien https (lien de paiement du vendeur) ; null sinon. */
export function lienHttps(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 500) return null;
  try {
    const u = new URL(x);
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
}

/** Page de paiement Stripe Checkout, et rien d'autre (null sinon). */
export function lienStripe(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 2000 || !x.startsWith('https://checkout.stripe.com/')) return null;
  try {
    const u = new URL(x);
    const propre = u.toString();
    return u.protocol === 'https:' && u.hostname === 'checkout.stripe.com' && u.port === '' && !u.username && !u.password && propre.startsWith('https://checkout.stripe.com/') ? propre : null;
  } catch { return null; }
}

/** IBAN sans espaces, clé de contrôle (modulo 97) vérifiée ; null sinon. */
export function ibanValide(x: unknown): string | null {
  if (typeof x !== 'string') return null;
  const iban = x.replace(/[\s-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return null;
  let reste = 0;
  for (const c of iban.slice(4) + iban.slice(0, 4)) {
    const v = c >= 'A' ? String(c.charCodeAt(0) - 55) : c;
    for (const chiffre of v) reste = (reste * 10 + Number(chiffre)) % 97;
  }
  return reste === 1 ? iban : null;
}

export interface Proposition {
  type: 'stock' | 'catalogue' | 'capacite';
  id: string;
  titre: string;
  organisation: string;
  organisationId: string | null;
  departement: string | null;
  verifie: boolean;
  quantite: number | null;
  unite: string | null;
  prixUnitaire: number | null;
  total: number | null;
}

function lireProposition(x: unknown): Proposition | null {
  if (!estObj(x) || !['stock', 'catalogue', 'capacite'].includes(x.type as string) || !estUuid(x.id)) return null;
  const titre = ligne(x.titre, 200);
  if (!titre) return null;
  return {
    type: x.type as Proposition['type'], id: x.id, titre,
    organisation: ligne(x.organisation, 200) ?? 'Membre Breizhcosystem',
    organisationId: estUuid(x.organisationId) ? x.organisationId : null,
    departement: typeof x.departement === 'string' && DEPARTEMENT.test(x.departement) ? x.departement : null,
    verifie: x.verifie === true,
    quantite: positifOuNul(x.quantite), unite: ligne(x.unite, 20), prixUnitaire: positifOuNul(x.prixUnitaire), total: positifOuNul(x.total),
  };
}

export interface Paiement {
  stripe: boolean;
  virement: boolean;
  lien: string | null;
}

export interface Commande {
  id: string;
  reference: string | null;
  statut: StatutCommande;
  achat: boolean;
  titre: string;
  autre: string | null;
  quantite: number;
  prixUnitaire: number | null;
  prixPropose: number | null;
  parAgent: boolean;
  creeLe: string | null;
  /** Moyens de paiement du vendeur : pour l'acheteur, quand la commande est confirmée. */
  paiement: Paiement | null;
}

function lireCommande(x: unknown): Commande | null {
  if (!estObj(x) || !estUuid(x.id) || !estStatut(x.statut)) return null;
  const achat = x.achat === true;
  let paiement: Paiement | null = null;
  if (achat && x.statut === 'confirmee') {
    const p = estObj(x.paiement) ? x.paiement : null;
    // ancien Breizhcosystem : seul le lien du vendeur (lienPaiement) était connu
    paiement = { stripe: p?.stripe === true, virement: p?.virement === true, lien: lienHttps(p ? p.lien : x.lienPaiement) };
  }
  const date = x.creeLe ?? x.cree_le;
  const creeLe = typeof date === 'string' && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : null;
  return {
    id: x.id, reference: typeof x.reference === 'string' && REFERENCE.test(x.reference) ? x.reference : null, statut: x.statut, achat,
    titre: ligne(x.titre, 200) ?? '(sans titre)', autre: ligne(x.autre, 200), quantite: positifOuNul(x.quantite) ?? 0,
    prixUnitaire: positifOuNul(x.prixUnitaire), prixPropose: positifOuNul(x.prixPropose), parAgent: x.parAgent === true, creeLe, paiement,
  };
}

export interface Mandat {
  id: string;
  nom: string;
  budgetMensuel: number;
  categories: string[];
  remiseCible: number;
  actif: boolean;
}

function lireMandat(x: unknown): Mandat | null {
  if (!estObj(x) || !estUuid(x.id)) return null;
  return {
    id: x.id, nom: ligne(x.nom, 80) ?? 'Achats courants', budgetMensuel: positifOuNul(x.budgetMensuel) ?? 0,
    categories: Array.isArray(x.categories) ? x.categories.map((c) => ligne(c, 60)).filter((c): c is string => c !== null).slice(0, 20) : [],
    remiseCible: Math.min(0.3, positifOuNul(x.remiseCible) ?? 0), actif: x.actif === true,
  };
}

/** Critères d'une demande à l'agent (« Recherche-moi ça ») ou d'une demande publiée sur le réseau. */
function lireDemande(d: unknown, avecPrix: boolean): Record<string, unknown> {
  const x = estObj(d) ? d : {};
  const texte = typeof x.texte === 'string' ? x.texte.replace(/\s+/g, ' ').trim() : '';
  if (texte.length < 3 || texte.length > 200) throw new ErreurApi(400, 'recherche_invalide', 'Décrivez ce que vous cherchez (3 à 200 caractères).');
  const corps: Record<string, unknown> = { texte };
  const vide = (v: unknown) => v === undefined || v === null || v === '';
  if (!vide(x.quantite)) {
    const q = positif(x.quantite);
    if (q === null) throw new ErreurApi(400, 'quantite_invalide', 'Quantité : un nombre supérieur à 0.');
    corps.quantite = q;
  }
  if (!vide(x.departement)) {
    const dep = typeof x.departement === 'string' ? x.departement.trim().toUpperCase() : '';
    if (!DEPARTEMENT.test(dep)) throw new ErreurApi(400, 'departement_invalide', 'Département : 2 ou 3 caractères (ex. 29, 2A, 974).');
    corps.departement = dep;
  }
  if (avecPrix && !vide(x.prixMax)) {
    const p = positif(x.prixMax);
    if (p === null) throw new ErreurApi(400, 'prix_invalide', 'Prix maximum : un montant supérieur à 0.');
    corps.prixMax = p;
  }
  return corps;
}

// ---------------------------------------------------------------- échanges entre agents de deux entreprises
// L'agent de l'entreprise sur Breizhcosystem se joint par le protocole A2A 1.0 (liaison HTTP+JSON), avec la clé de liaison.
// Une tâche A2A = un échange, vu du côté de l'entreprise. Le réseau peut ajouter des genres d'échanges et des statuts :
// seuls l'identifiant et l'état de la tâche sont exigés ; tout le reste est facultatif, relu, et ignoré s'il est inconnu.

export const VERSION_A2A = '1.0';
/** Statuts d'un échange connus de cette version (demande de prix sur un stock). */
export const STATUTS_ECHANGE = ['attente_vendeur', 'proposee', 'acceptee', 'refusee_vendeur', 'refusee_acheteur', 'annulee', 'expiree'] as const;
export type StatutEchange = (typeof STATUTS_ECHANGE)[number];
const estStatutEchange = (x: unknown): x is StatutEchange => (STATUTS_ECHANGE as readonly unknown[]).includes(x);
/** Où en est un échange : une personne doit décider, il suit son cours, il est conclu, refusé ou arrêté (annulé, expiré). */
export type AvancementEchange = 'attend_personne' | 'en_cours' | 'conclu' | 'refuse' | 'arrete';
const AVANCEMENT_STATUT: Readonly<Record<StatutEchange, AvancementEchange>> = {
  attente_vendeur: 'attend_personne', proposee: 'attend_personne', acceptee: 'conclu', refusee_vendeur: 'refuse', refusee_acheteur: 'arrete', annulee: 'arrete', expiree: 'arrete',
};
/** États d'une tâche A2A : servent seuls quand le statut du réseau est plus récent que le jeu. */
const AVANCEMENT_ETAT: Readonly<Record<string, AvancementEchange>> = {
  TASK_STATE_AUTH_REQUIRED: 'attend_personne', TASK_STATE_INPUT_REQUIRED: 'attend_personne', TASK_STATE_SUBMITTED: 'en_cours', TASK_STATE_WORKING: 'en_cours',
  TASK_STATE_COMPLETED: 'conclu', TASK_STATE_REJECTED: 'refuse', TASK_STATE_CANCELED: 'arrete', TASK_STATE_FAILED: 'arrete',
};
const ETAT_TACHE = /^TASK_STATE_[A-Z_]{1,40}$/;
/** Pages lues au plus pour lister les échanges (100 par page). */
const PAGES_ECHANGES = 5;
/** Échanges terminés rendus au plus (les plus récents) ; ceux qui sont en cours le sont tous. */
const ECHANGES_TERMINES = 20;

export interface PropositionEchange {
  quantite: number;
  /** Prix unitaire hors taxes. */
  prixUnitaire: number;
  /** Quantité × prix, recalculé ici (le total annoncé par le réseau n'est pas repris). */
  total: number;
  valableJusquau: string | null;
  /** Répondu par la règle de l'agent du vendeur, ou par une personne de chez lui. */
  par: 'regle' | 'personne' | null;
}

export interface Echange {
  id: string;
  /** Le côté de l'entreprise dans cet échange. */
  cote: 'acheteur' | 'vendeur' | null;
  /** Statut du réseau ; null : statut plus récent que cette version (l'avancement dit alors l'essentiel). */
  statut: StatutEchange | null;
  avancement: AvancementEchange;
  /** Qui doit agir : une personne de l'entreprise, une personne de l'autre, ou plus personne. */
  attend: 'vous' | 'autre' | null;
  titre: string;
  stockId: string | null;
  /** Quantité et prix unitaire souhaité de la demande, quand le réseau les redonne. */
  quantite: number | null;
  prixSouhaite: number | null;
  proposition: PropositionEchange | null;
  /** Commande née d'une proposition validée (par une personne, sur Breizhcosystem). */
  commande: { reference: string | null; statut: StatutCommande | null } | null;
  /** Phrase du réseau sur l'état (une ligne, bornée) : montrée quand le statut est inconnu de cette version. */
  message: string | null;
  majLe: string | null;
}

const dateIso = (x: unknown): string | null => (typeof x === 'string' && x.length <= 40 && !Number.isNaN(Date.parse(x)) ? new Date(x).toISOString() : null);
const partiesDe = (x: unknown): unknown[] => (estObj(x) && Array.isArray(x.parts) ? x.parts.slice(0, 20) : []);
/** Première partie « data » (un objet) d'un message ou d'un artefact A2A. */
const donneesDe = (x: unknown): Record<string, unknown> | null => {
  for (const p of partiesDe(x)) if (estObj(p) && estObj(p.data)) return p.data;
  return null;
};
/** Première partie « text » d'un message A2A, sur une ligne. */
const texteDe = (x: unknown, max: number): string | null => {
  for (const p of partiesDe(x)) { const t = estObj(p) ? ligne(p.text, max) : null; if (t) return t; }
  return null;
};

/** Une tâche A2A relue comme un échange ; null si elle est illisible (pas d'identifiant, pas d'état). */
function lireEchange(x: unknown): Echange | null {
  if (!estObj(x) || !estUuid(x.id)) return null;
  const etat = estObj(x.status) && typeof x.status.state === 'string' && ETAT_TACHE.test(x.status.state) ? x.status.state : null;
  if (!etat) return null;
  const meta = estObj(x.metadata) && estObj(x.metadata.breizhcosystem) ? x.metadata.breizhcosystem : {};
  const cote = meta.cote === 'acheteur' || meta.cote === 'vendeur' ? meta.cote : null;
  const statut = estStatutEchange(meta.statut) ? meta.statut : null;
  const avancement = statut ? AVANCEMENT_STATUT[statut] : (AVANCEMENT_ETAT[etat] ?? 'en_cours');
  // qui doit agir : pour un statut connu, la règle du réseau (le vendeur répond, puis l'acheteur valide) ; sinon ce qu'il annonce
  const coteAttendu = statut === 'attente_vendeur' ? 'vendeur' : statut === 'proposee' ? 'acheteur'
    : statut ? null : meta.attend === 'personne_acheteur' ? 'acheteur' : meta.attend === 'personne_vendeur' ? 'vendeur' : null;
  const ouvert = avancement === 'attend_personne' || avancement === 'en_cours';
  const premier: unknown = Array.isArray(x.history) ? x.history[0] : null;
  const demande = estObj(premier) && premier.role === 'ROLE_USER' ? donneesDe(premier) : null;
  const artefacts: unknown[] = Array.isArray(x.artifacts) ? x.artifacts.slice(0, 20) : [];
  const artefact = (nom: string) => donneesDe(artefacts.find((a) => estObj(a) && a.artifactId === nom));
  const p = artefact('proposition');
  const quantite = p ? positif(p.quantite, 1_000_000) : null;
  const prix = p ? positifOuNul(p.prixUnitaireHt) : null;
  const c = artefact('commande');
  return {
    id: x.id, cote, statut, avancement,
    attend: !ouvert || !cote || !coteAttendu ? null : coteAttendu === cote ? 'vous' : 'autre',
    titre: ligne(meta.titre, 200) ?? '(sans titre)', stockId: estUuid(meta.stockId) ? meta.stockId : null,
    quantite: demande ? positif(demande.quantite, 1_000_000) : null, prixSouhaite: demande ? positif(demande.prixSouhaite, 10_000_000) : null,
    proposition: p && quantite !== null && prix !== null
      ? { quantite, prixUnitaire: prix, total: Math.round(quantite * prix * 100) / 100, valableJusquau: dateIso(p.valableJusquau), par: p.reponduPar === 'regle' || p.reponduPar === 'personne' ? p.reponduPar : null }
      : null,
    commande: c ? { reference: typeof c.reference === 'string' && REFERENCE.test(c.reference) ? c.reference : null, statut: estStatut(c.statut) ? c.statut : null } : null,
    message: texteDe(estObj(x.status) ? x.status.message : null, 400),
    majLe: estObj(x.status) ? dateIso(x.status.timestamp) : null,
  };
}
const estOuvert = (e: Echange): boolean => e.avancement === 'attend_personne' || e.avancement === 'en_cours';

/**
 * Refus de l'agent, dans la forme du protocole A2A (`{ error: { message, details: [{ reason }] } }`) : la raison, mise en
 * minuscules, a le même sens que le code de l'API (`CLE_INVALIDE` = `cle_invalide`). null : la réponse n'a pas cette forme.
 */
function lireRefusAgent(d: unknown): { code: string | null; message: string | null } | null {
  const e = estObj(d) && estObj(d.error) ? d.error : null;
  if (!e) return null;
  const detail: unknown = Array.isArray(e.details) ? e.details.slice(0, 10).find((x) => estObj(x) && typeof x.reason === 'string') : null;
  const raison = estObj(detail) && typeof detail.reason === 'string' && /^[A-Z0-9_]{1,60}$/.test(detail.reason) ? detail.reason.toLowerCase() : null;
  return { code: raison, message: ligne(e.message, 400) };
}


/** Construit ce qui PARTIRAIT vers Breizhcosystem (fonction pure : sert aussi à l'aperçu « voir ce qui part »). */
export function construirePartage(d: DonneesPartage, categories: readonly Categorie[]): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  const org = d.objets.find((o) => o.famille === 'organisation');
  const reels = d.objets.filter((o) => o.mode !== 'demo');
  if (categories.includes('profil') && org && org.mode !== 'demo') {
    const secteur = typeof org.champs.secteur === 'string' ? org.champs.secteur : null;
    if (secteur) sortie.profil = { activite: secteur };
  }
  if (categories.includes('besoins')) {
    const besoins: Record<string, unknown>[] = [];
    for (const a of reels.filter((o) => o.type === 'article')) {
      const q = num(a.champs.quantite);
      const s = num(a.champs.seuil_alerte);
      // quantité de réassort : de quoi remonter à 2 fois le seuil d'alerte (l'agent d'achat n'achète que ça)
      if (q !== null && s !== null && q < s) besoins.push({ cle: `rupture:${a.id}`, titre: `${a.nom} — réassort`, recherche: 'fournisseur', categorie: a.nom.slice(0, 60), quantite: Math.max(1, Math.ceil(2 * s - q)) });
    }
    for (const e of reels.filter((o) => o.type === 'equipement' && o.champs.disponible === false)) besoins.push({ cle: `location:${e.id}`, titre: `Location : ${e.nom} (le nôtre est indisponible)`, recherche: 'fournisseur', categorie: 'Location de matériel' });
    // Renfort : besoins d'effectif non couverts aujourd'hui. Titre générique : ni nom de personne, ni nom du projet
    // ou du lieu (« Salle de bains de Mme … — 12 rue … » partirait sinon vers tout le réseau)
    const jour = d.maintenant.toISOString().slice(0, 10);
    const secteurRenfort = org && org.mode !== 'demo' && typeof org.champs.secteur === 'string' ? org.champs.secteur.slice(0, 60) : null;
    for (const c of reels.filter((o) => (o.famille === 'lieu' || o.famille === 'projet') && (num(o.champs.besoin_effectif) ?? 0) > 0)) {
      const v = `${c.famille === 'lieu' ? 'lieu' : 'projet'}:${c.id}`;
      let n = 0;
      for (const j of d.planning.values()) if (j.get(jour) === v) n++;
      const manque = (num(c.champs.besoin_effectif) as number) - n;
      const genre = c.famille === 'projet' ? 'projet en cours' : 'site';
      if (manque > 0) besoins.push({ cle: `renfort:${c.id}`, titre: `Renfort : ${pluriel(manque, 'personne', 'personnes')} — ${secteurRenfort ? `${secteurRenfort}, ${genre}` : genre}`, recherche: 'sous_traitant', categorie: 'Renfort de personnel' });
    }
    sortie.besoins = besoins.slice(0, 50);
  }
  if (categories.includes('stocks')) {
    // Surstock : plus de 3 fois le seuil d'alerte → on propose le surplus (au-delà de 2 fois le seuil)
    sortie.stocks = reels.filter((o) => o.type === 'article').flatMap((a) => {
      const q = num(a.champs.quantite);
      const s = num(a.champs.seuil_alerte);
      if (q === null || s === null || s <= 0 || q <= 3 * s) return [];
      return [{ cle: `stock:${a.id}`, titre: a.nom, quantite: Math.floor(q - 2 * s), ...(typeof a.champs.unite === 'string' ? { unite: a.champs.unite.slice(0, 20) } : {}), categorie: a.nom.slice(0, 60) }];
    }).slice(0, 200);
  }
  if (categories.includes('capacites')) {
    // Personnes sans affectation dans les prochains jours : un NOMBRE par jour, jamais de nom
    const employes = new Set(reels.filter((o) => o.famille === 'personne').map((o) => o.id));
    const parJour = new Map<string, number>();
    const auj = d.maintenant.toISOString().slice(0, 10);
    for (const [id, jours] of d.planning) {
      if (!employes.has(id)) continue;
      for (const [j, v] of jours) if (j >= auj && v === '') parJour.set(j, (parJour.get(j) ?? 0) + 1);
    }
    const secteur = typeof org?.champs.secteur === 'string' ? org.champs.secteur.slice(0, 60) : 'Main-d’œuvre';
    sortie.capacites = [...parJour].sort(([a], [b]) => a.localeCompare(b)).slice(0, 10).map(([j, n]) => ({ cle: `capacite:${j}`, titre: `${pluriel(n, 'personne disponible', 'personnes disponibles')} en renfort`, categorie: secteur, du: j, au: j }));
  }
  // notes sur 100 ; sous 11 personnes EN POSTE (les fiches anonymisées d'anciens salariés ne comptent pas, constat
  // revue-jeu-1-11), rien du domaine social (absences maladie…) : elles désigneraient quelqu'un. Les notes tirées du
  // baromètre ne partent jamais (constat revue-jeu-1-10).
  if (categories.includes('indicateurs') && d.sante && d.sante.score !== null && org?.mode !== 'demo') {
    sortie.indicateurs = ratiosSante(d.sante, { effectif: personnesEnPoste(d.objets).length });
  }
  return sortie;
}

export interface OptionsLien {
  etat: EtatLienNexus | null;
  chiffreur: Chiffreur;
  fetch?: Recuperateur;
  changement: () => void;
  urlParDefaut: string | null;
}

export class LienNexus {
  #e: EtatLienNexus;
  #c: Chiffreur;
  #f: Recuperateur;
  #changement: () => void;
  #attente: { secret: string; code: string; url: string; expire: number } | null = null;
  #droits: ReturnType<typeof lireDroits> = null;
  #indisponibleDepuis: string | null = null;
  /** Entreprise suspendue par l'éditeur (403 entreprise_suspendue) : la clé est gardée, rien n'est effacé. */
  #suspendue: { depuis: string; message: string | null } | null = null;

  constructor(o: OptionsLien) {
    const accepte = Array.isArray(o.etat?.partageAccepte) ? o.etat.partageAccepte.filter((c): c is Categorie => (CATEGORIES as readonly unknown[]).includes(c)) : [];
    this.#e = { url: o.etat?.url ?? o.urlParDefaut, cle: o.etat?.cle ?? null, organisation: o.etat?.organisation ?? null, dernierEnvoi: o.etat?.dernierEnvoi ?? null, derniereErreur: o.etat?.derniereErreur ?? null, partageAccepte: [...new Set(accepte)] };
    this.#c = o.chiffreur;
    this.#f = o.fetch ?? recuperateurProtege;
    this.#changement = o.changement;
  }

  instantane(): EtatLienNexus {
    return { ...this.#e };
  }

  get relie(): boolean {
    return this.#e.cle !== null && this.#e.url !== null;
  }

  /** Vrai si l'administrateur a coché au moins une catégorie dans le jeu (sinon aucun envoi, même automatique). */
  get partageConsenti(): boolean {
    return this.relie && (this.#e.partageAccepte ?? []).length > 0;
  }

  #cle(): string | null {
    try { return this.#e.cle ? this.#c.dechiffrer(this.#e.cle) : null; } catch { return null; }
  }

  /** API de Breizhcosystem (`/v0`). */
  #appel(methode: string, chemin: string, corps?: unknown, avecCle = true, entetes: Record<string, string> = {}): Promise<unknown> {
    return this.#requete(methode, `/v0${chemin}`, corps, avecCle, entetes);
  }

  /**
   * L'agent de l'entreprise sur Breizhcosystem (`/a2a`, protocole A2A), joint avec la clé de liaison. Seules les opérations
   * que le réseau ouvre à une clé sont appelées ici : envoyer une demande de prix, lister et relire les tâches.
   */
  #appelAgent(methode: string, chemin: string, corps?: unknown): Promise<unknown> {
    return this.#requete(methode, `/a2a${chemin}`, corps, true, { 'a2a-version': VERSION_A2A }, true);
  }

  async #requete(methode: string, chemin: string, corps: unknown, avecCle: boolean, entetes: Record<string, string>, agent = false): Promise<unknown> {
    if (!this.#e.url) throw new ErreurApi(409, 'nexus_non_configure', 'Adresse de Breizhcosystem non renseignée (Réglages → Breizhcosystem).');
    const base = await verifierUrl(this.#e.url).catch((e: Error) => { throw new ErreurApi(400, 'nexus_adresse', e.message); });
    const cle = avecCle ? this.#cle() : null;
    if (avecCle && !cle) throw new ErreurApi(409, 'nexus_non_relie', 'Reliez d’abord votre entreprise à Breizhcosystem.');
    let r: Response;
    try {
      r = await this.#f(new URL(chemin, base), {
        method: methode, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { accept: 'application/json', ...entetes, ...(cle ? { authorization: `Bearer ${cle}` } : {}), ...(corps !== undefined ? { 'content-type': 'application/json', 'x-nx-requete': '1' } : {}) },
        body: corps === undefined ? null : JSON.stringify(corps),
      });
    } catch {
      throw new ErreurApi(502, 'nexus_injoignable', 'Breizhcosystem ne répond pas : Living Business continue de fonctionner, réessayez plus tard.');
    }
    const texte = await lireTexteBorne(r, 5_000_000, 'Réponse de Breizhcosystem trop volumineuse.').catch((e: unknown) => {
      throw new ErreurApi(502, 'nexus_injoignable', e instanceof ErreurSortante ? e.message : 'Breizhcosystem ne répond pas : réessayez plus tard.');
    });
    let d: unknown = null;
    try { d = texte ? JSON.parse(texte) : null; } catch { /* réponse non JSON */ }
    // refus : `{ erreur, message }` pour l'API ; pour l'agent, la forme du protocole A2A, ramenée aux mêmes codes
    const refusAgent = agent ? lireRefusAgent(d) : null;
    const code = refusAgent ? refusAgent.code : estObj(d) && typeof d.erreur === 'string' ? d.erreur : null;
    const message = refusAgent ? refusAgent.message : estObj(d) && typeof d.message === 'string' ? d.message : null;
    // Seule une clé révoquée ou inconnue (401 cle_invalide) efface la liaison. Une entreprise SUSPENDUE par l'éditeur
    // (403 entreprise_suspendue) garde sa clé : elle resservira telle quelle à la levée de la suspension.
    if (r.status === 401 && avecCle && code === 'cle_invalide') {
      this.#e.cle = null;
      this.#suspendue = null;
      this.#changement();
      throw new ErreurApi(409, 'nexus_non_relie', 'La liaison avec Breizhcosystem a été révoquée : reliez à nouveau.');
    }
    if (r.status === 403 && avecCle && code === 'entreprise_suspendue') {
      this.#suspendue ??= { depuis: new Date().toISOString(), message: null };
      this.#suspendue.message = message === null ? null : message.slice(0, 300);
      throw new ErreurApi(409, 'nexus_suspendu', 'Breizhcosystem a suspendu l’accès de votre entreprise. La liaison est conservée : tout reprendra dès la levée de la suspension. Living Business continue de fonctionner.');
    }
    // un autre refus de Breizhcosystem ne doit pas passer pour la fin de VOTRE session dans le jeu (401) : erreur de Breizhcosystem
    if (r.status === 401) throw new ErreurApi(502, code ?? 'nexus_refus', 'Breizhcosystem a refusé la demande : réessayez plus tard.');
    if (r.ok && avecCle) this.#suspendue = null;
    if (!r.ok && agent) {
      // un réseau d'avant les échanges entre agents ne connaît pas `/a2a` : il répond « introuvable », hors de la forme du protocole
      if (!refusAgent && (r.status === 404 || r.status === 405)) throw new ErreurApi(404, 'echanges_indisponibles', 'Ce réseau Breizhcosystem ne propose pas encore les échanges entre agents.');
      // le protocole n'a pas de 402 : l'offre payante requise y est un 403 nommé, redevenu ici le 402 de l'API
      if (code === 'offre_active_requise') throw new ErreurApi(402, 'nexus_active_requis', message ?? 'Fonction réservée à Breizhcosystem ACTIVE.');
      // le réseau ne parle plus cette version du protocole : son message s'adresse à un outil, pas à une personne
      if (code === 'version_not_supported') throw new ErreurApi(502, 'echanges_version', 'Breizhcosystem a changé sa façon d’échanger entre agents : mettez Living Business à jour pour continuer.');
    }
    if (!r.ok) throw new ErreurApi(r.status === 402 ? 402 : r.status >= 500 ? 502 : r.status, code ?? 'nexus_erreur', message ?? `Breizhcosystem : erreur ${r.status}.`);
    return d;
  }

  async reglerAdresse(url: unknown) {
    if (url === null || url === '') { this.#e.url = null; this.#e.cle = null; this.#changement(); return this.etat(); }
    const u = await verifierUrl(url).catch((e: Error) => { throw new ErreurApi(400, 'nexus_adresse', e.message); });
    const propre = `${u.protocol}//${u.host}`;
    if (propre !== this.#e.url) { this.#e.url = propre; this.#e.cle = null; this.#e.organisation = null; this.#e.partageAccepte = []; }
    this.#changement();
    return this.etat();
  }

  /** Démarre la liaison : renvoie le code et l'adresse à ouvrir pour confirmer sur Breizhcosystem. */
  async demarrerLiaison() {
    const d = (await this.#appel('POST', '/liaison', {}, false)) as { code: string; attente: string; url: string; expire: string };
    if (!/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(d.code) || !/^[A-Za-z0-9_-]{43}$/.test(d.attente)) throw new ErreurApi(502, 'nexus_reponse');
    const ouvrir = new URL(`/relier?code=${d.code}`, this.#e.url as string).toString();
    this.#attente = { secret: d.attente, code: d.code, url: ouvrir, expire: Date.parse(d.expire) };
    return { code: d.code, url: ouvrir, expire: d.expire };
  }

  /** Le jeu demande où en est la liaison (appelé par l'écran toutes les 3 s). */
  async suivreLiaison() {
    if (this.relie) return { statut: 'reliee', organisation: this.#e.organisation };
    if (!this.#attente || this.#attente.expire < Date.now()) return { statut: 'aucune' };
    const r = (await this.#appel('POST', '/liaison/retrait', { attente: this.#attente.secret }, false)) as { statut: string; cle?: string; organisation?: string };
    if (r.statut !== 'confirmee' || typeof r.cle !== 'string' || !/^nx_[A-Za-z0-9_-]{43}$/.test(r.cle)) return { statut: 'en_attente', code: this.#attente.code, url: this.#attente.url };
    this.#e.cle = this.#c.chiffrer(r.cle);
    this.#e.organisation = typeof r.organisation === 'string' ? r.organisation.slice(0, 200) : null;
    this.#e.partageAccepte = []; // nouvelle liaison : rien ne part avant que l'administrateur coche dans le jeu
    this.#attente = null;
    this.#changement();
    return { statut: 'reliee', organisation: this.#e.organisation };
  }

  delier() {
    this.#e.cle = null;
    this.#e.organisation = null;
    this.#e.partageAccepte = [];
    this.#droits = null;
    this.#changement();
    return this.etat();
  }

  etat() {
    return { url: this.#e.url, relie: this.relie, suspendue: this.relie ? this.#suspendue : null, organisation: this.#e.organisation, dernierEnvoi: this.#e.dernierEnvoi, derniereErreur: this.#e.derniereErreur, droits: this.#droits, liaisonEnCours: this.#attente ? { code: this.#attente.code, url: this.#attente.url } : null };
  }

  /** État pour le pavillon Breizhcosystem de la carte (droits confirmés par le serveur Breizhcosystem). */
  async etatPavillon(): Promise<EtatNexus> {
    if (!this.relie) return { statut: 'non_connecte' };
    try {
      const d = lireDroits(await this.#appel('GET', '/droits'));
      if (!d) throw new Error('droits illisibles');
      this.#droits = d;
      this.#indisponibleDepuis = null;
      return { statut: 'connecte', droits: d };
    } catch (e) {
      if (e instanceof ErreurApi && e.code === 'nexus_non_relie') return { statut: 'non_connecte' };
      if (e instanceof ErreurApi && e.code === 'nexus_suspendu' && this.#suspendue) return { statut: 'suspendu', depuis: this.#suspendue.depuis, message: this.#suspendue.message };
      this.#indisponibleDepuis ??= new Date().toISOString();
      return { statut: 'indisponible', dernierConnu: this.#droits, depuis: this.#indisponibleDepuis };
    }
  }

  /** Catégories cochées sur Breizhcosystem (réglage du compte Breizhcosystem, coché par défaut là-bas). */
  async partageNexus(): Promise<Categorie[]> {
    const d = (await this.#appel('GET', '/partage')) as { categories?: unknown };
    return Array.isArray(d.categories) ? (d.categories.filter((c) => (CATEGORIES as readonly unknown[]).includes(c)) as Categorie[]) : [];
  }

  /** Ce qui part vraiment : coché dans le jeu par l'administrateur ET sur Breizhcosystem. */
  async partage(): Promise<Categorie[]> {
    const accepte = this.#e.partageAccepte ?? [];
    if (!accepte.length) return [];
    const nexus = await this.partageNexus();
    return CATEGORIES.filter((c) => accepte.includes(c) && nexus.includes(c));
  }

  /** Réglage fait dans le jeu par l'administrateur : vaut accord pour ces catégories (ici et sur Breizhcosystem). */
  async reglerPartage(categories: unknown) {
    if (!Array.isArray(categories) || !categories.every((c) => (CATEGORIES as readonly unknown[]).includes(c))) throw new ErreurApi(400, 'categories_invalides');
    const r = await this.#appel('PUT', '/partage', { categories });
    this.#e.partageAccepte = CATEGORIES.filter((c) => categories.includes(c));
    this.#changement();
    return { ...(estObj(r) ? r : {}), categories: this.#e.partageAccepte };
  }

  /** Envoie ce qui est autorisé (accord dans le jeu, catégories relues sur Breizhcosystem à chaque envoi) ; sans accord, rien. */
  async envoyer(donnees: DonneesPartage) {
    const categories = await this.partage();
    if (!categories.length) return { envoye: {}, recu: null, rienAEnvoyer: true };
    const corps = construirePartage(donnees, categories);
    try {
      const r = await this.#appel('POST', '/partage/donnees', corps);
      this.#e.dernierEnvoi = new Date().toISOString();
      this.#e.derniereErreur = null;
      this.#changement();
      return { envoye: corps, recu: (r as { recu?: unknown }).recu ?? null };
    } catch (e) {
      this.#e.derniereErreur = e instanceof Error ? e.message : String(e);
      this.#changement();
      throw e;
    }
  }

  // ---------------------------------------------------------------- temps réel des outils (temps-reel.ts)
  // Les outils ne peuvent pas joindre Living Business : ils préviennent Breizhcosystem, qui prévient le jeu par un canal
  // que celui-ci garde ouvert, authentifié par la même clé de liaison. Seul le fait qu'un outil a changé passe par là ;
  // le jeu relit ensuite l'outil lui-même.

  /** Abonnements du temps réel (`/v0/relais/abonnements…`), avec la clé de liaison. */
  relais(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', chemin: string, corps?: unknown): Promise<unknown> {
    return this.#appel(methode, `/relais${chemin}`, corps);
  }

  /** Origine de Breizhcosystem réglée (protocole et hôte), sans appel réseau ; null si elle n'est pas réglée. */
  origine(): string | null {
    try { return this.#e.url ? new URL(this.#e.url).origin : null; } catch { return null; }
  }

  /**
   * Ouvre le canal du temps réel (`GET /v0/relais/flux`, flux d'événements), lu ensuite morceau par morceau par
   * temps-reel.ts. Mêmes sorties protégées que le reste ; une clé révoquée efface la liaison, comme ailleurs.
   */
  async fluxRelais(signal: AbortSignal): Promise<Response> {
    if (!this.#e.url) throw new ErreurApi(409, 'nexus_non_configure', 'Adresse de Breizhcosystem non renseignée.');
    const base = await verifierUrl(this.#e.url).catch((e: Error) => { throw new ErreurApi(400, 'nexus_adresse', e.message); });
    const cle = this.#cle();
    if (!cle) throw new ErreurApi(409, 'nexus_non_relie', 'Reliez d’abord votre entreprise à Breizhcosystem.');
    const r = await this.#f(new URL('/v0/relais/flux', base), {
      method: 'GET', redirect: 'error', signal,
      headers: { accept: 'text/event-stream', authorization: `Bearer ${cle}`, 'user-agent': 'LivingBusiness/0.1 (+auto-heberge)' },
    });
    if (r.status === 401) {
      const t = await lireTexteBorne(r, 10_000).catch(() => '');
      let code: unknown = null;
      try { code = (JSON.parse(t) as { erreur?: unknown }).erreur; } catch { /* réponse non JSON */ }
      if (code === 'cle_invalide') { this.#e.cle = null; this.#suspendue = null; this.#changement(); }
    }
    return r;
  }

  opportunites() { return this.#appel('GET', '/opportunites'); }
  comparaison() { return this.#appel('GET', '/comparaison'); }
  proposer(d: unknown) { return this.#appel('POST', '/proposer', d); }
  parrainages() { return this.#appel('GET', '/parrainages'); }
  // ---------------------------------------------------------------- agents d'achat
  // L'agent prépare, une personne valide TOUJOURS (statut « a_valider »), le vendeur confirme ensuite.
  // L'argent ne passe jamais par Breizhcosystem : paiement en ligne chez le vendeur (Stripe), virement ou lien du vendeur.

  async mandats(): Promise<Mandat[]> {
    const d = await this.#appel('GET', '/mandats');
    const liste = Array.isArray(d) ? d : estObj(d) && Array.isArray(d.mandats) ? d.mandats : [];
    return liste.slice(0, 100).map(lireMandat).filter((m): m is Mandat => m !== null);
  }

  /** Mandat : nom, budget du mois, catégories, remise visée (plus de montant « sans validation »). */
  async creerMandat(d: unknown) {
    const x = estObj(d) ? d : {};
    const budget = num(x.budgetMensuel);
    if (budget === null || budget < 0 || budget > 1_000_000) throw new ErreurApi(400, 'mandat_invalide', 'Budget du mois nécessaire (en euros, jusqu’à 1 000 000).');
    const corps: Record<string, unknown> = {
      nom: ligne(x.nom, 80) ?? 'Achats courants',
      budgetMensuel: budget,
      categories: Array.isArray(x.categories) ? x.categories.map((c) => ligne(c, 60)).filter((c): c is string => c !== null).slice(0, 20) : [],
    };
    if (x.remiseCible !== undefined && x.remiseCible !== null) {
      const r = num(x.remiseCible);
      if (r === null || r < 0 || r > 0.3) throw new ErreurApi(400, 'mandat_invalide', 'Remise visée : entre 0 et 30 %.');
      corps.remiseCible = r;
    }
    const r = await this.#appel('POST', '/mandats', corps);
    return { id: estObj(r) && estUuid(r.id) ? r.id : null };
  }

  basculerMandat(id: string, actif: boolean) {
    if (!estUuid(id)) throw new ErreurApi(400, 'identifiant_invalide');
    return this.#appel('POST', `/mandats/${id}/${actif ? 'activer' : 'desactiver'}`, {});
  }

  /** Passage de l'agent : il PRÉPARE des commandes (toutes « à valider »), il n'achète rien seul. */
  async lancerAgent() {
    const r = await this.#appel('POST', '/agent/lancer', {});
    return { preparees: (estObj(r) ? positifOuNul(r.preparees) : null) ?? 0 };
  }

  /** « Recherche-moi ça » : l'agent cherche dans les stocks, catalogues et capacités des membres. */
  async rechercher(d: unknown): Promise<{ propositions: Proposition[] }> {
    const r = await this.#appel('POST', '/agent/recherche', lireDemande(d, true));
    const liste = estObj(r) && Array.isArray(r.propositions) ? r.propositions : [];
    return { propositions: liste.slice(0, 50).map(lireProposition).filter((p): p is Proposition => p !== null) };
  }

  /** Commande d'un stock trouvé par l'agent : appelée après que la personne a vu le total (c'est SA validation). */
  async commanderRecherche(d: unknown) {
    const x = estObj(d) ? d : {};
    if (!estUuid(x.stockId)) throw new ErreurApi(400, 'identifiant_invalide');
    const quantite = positif(x.quantite);
    if (quantite === null) throw new ErreurApi(400, 'quantite_invalide', 'Quantité à commander : un nombre supérieur à 0.');
    // le prix que la personne a vu dans la boîte de validation : s'il n'est plus celui du stock, Breizhcosystem refuse
    // (409 prix_change, message montré tel quel : il demande de relancer la recherche) au lieu de commander à un
    // prix jamais vu (constat revue-jeu-1-7)
    let prixVu: number | null = null;
    if (x.prixUnitaire !== undefined && x.prixUnitaire !== null) {
      prixVu = positif(x.prixUnitaire);
      if (prixVu === null) throw new ErreurApi(400, 'prix_invalide', 'Prix vu : un nombre supérieur à 0.');
    }
    // même clé à chaque nouvel essai de la même validation (délai dépassé, réseau) : Breizhcosystem peut ne créer qu'une commande
    const idem = estUuid(x.cle) ? { 'idempotency-key': x.cle } : {};
    const r = await this.#appel('POST', '/agent/commander', { stockId: x.stockId, quantite, ...(prixVu !== null ? { prixUnitaire: prixVu } : {}) }, true, idem);
    const o = estObj(r) ? r : {};
    // « a_valider » : au-delà du plafond fixé sur Breizhcosystem pour Living Business (ou prix non présenté) — une personne valide là-bas
    return { id: estUuid(o.id) ? o.id : null, reference: typeof o.reference === 'string' && REFERENCE.test(o.reference) ? o.reference : null, statut: estStatut(o.statut) ? o.statut : 'validee',
      plafond: typeof o.plafond === 'number' && Number.isFinite(o.plafond) && o.plafond >= 0 ? o.plafond : null };
  }

  /** Rien ne convient : la demande est publiée sur le réseau, les membres peuvent y répondre. */
  async publierDemande(d: unknown) {
    const r = await this.#appel('POST', '/agent/publier', lireDemande(d, false));
    return { id: estObj(r) && estUuid(r.id) ? r.id : null };
  }

  /** Prise de contact avec un membre (catalogue, capacité, ou stock sans prix). */
  async contacter(d: unknown) {
    const x = estObj(d) ? d : {};
    if (!['catalogue', 'capacite', 'stock'].includes(x.objet as string) || !estUuid(x.ref)) throw new ErreurApi(400, 'contact_invalide');
    const message = typeof x.message === 'string' ? x.message.trim().slice(0, 2000) : '';
    const r = await this.#appel('POST', '/contacter', { objet: x.objet, ref: x.ref, message });
    const o = estObj(r) ? r : {};
    const c = estObj(o.contact) ? o.contact : null;
    const email = c && typeof c.email === 'string' && c.email.length <= 254 && EMAIL.test(c.email) ? c.email : null;
    return { organisation: ligne(o.organisation, 200), contact: c && (email || ligne(c.nom, 200)) ? { nom: ligne(c.nom, 200), email } : null };
  }

  // ---------------------------------------------------------------- échanges entre agents de deux entreprises
  // Le jeu DEMANDE un prix et SUIT les échanges. Valider une proposition (acheteur) ou répondre hors des règles (vendeur)
  // reste le geste d'une personne connectée à Breizhcosystem : le réseau le refuse à toute clé, celle de la liaison
  // comprise, et aucune méthode d'ici ne l'essaie.

  /**
   * Page de Breizhcosystem où une personne connectée valide une proposition ou répond à une demande. Construite ici, depuis
   * l'adresse réglée dans le jeu : une adresse écrite dans une réponse du réseau n'est jamais reprise.
   */
  #pageEchanges(): string | null {
    return this.#e.url ? new URL('/echanges', this.#e.url).toString() : null;
  }

  /**
   * Demande un prix et une disponibilité sur un stock trouvé par « Recherche-moi ça ». N'engage à rien : l'agent du vendeur
   * répond dans les règles de son entreprise, ou une personne de chez lui ; la réponse est une proposition à valider.
   */
  async demanderPrix(d: unknown): Promise<{ echange: Echange; page: string | null }> {
    const x = estObj(d) ? d : {};
    if (!estUuid(x.stockId)) throw new ErreurApi(400, 'identifiant_invalide');
    const quantite = positif(x.quantite, 1_000_000);
    if (quantite === null) throw new ErreurApi(400, 'quantite_invalide', 'Quantité : un nombre supérieur à 0 (1 000 000 au plus).');
    const donnees: Record<string, unknown> = { action: 'demander-prix', stockId: x.stockId, quantite };
    const vide = (v: unknown) => v === undefined || v === null || v === '';
    if (!vide(x.prixSouhaite)) {
      const p = positif(x.prixSouhaite, 10_000_000);
      if (p === null) throw new ErreurApi(400, 'prix_invalide', 'Prix souhaité : un montant supérieur à 0, ou rien.');
      donnees.prixSouhaite = p;
    }
    if (!vide(x.departement)) {
      const dep = typeof x.departement === 'string' ? x.departement.trim().toUpperCase() : '';
      if (!DEPARTEMENT.test(dep)) throw new ErreurApi(400, 'departement_invalide', 'Département : 2 ou 3 caractères (ex. 29, 2A, 974).');
      donnees.departement = dep;
    }
    // même identifiant de message à chaque nouvel essai de la même demande (délai dépassé, réseau) : le réseau rend le même échange
    const messageId = estUuid(x.cle) ? x.cle : randomUUID();
    const r = await this.#appelAgent('POST', '/message:send', { message: { messageId, role: 'ROLE_USER', parts: [{ data: donnees, mediaType: 'application/json' }] } });
    const echange = lireEchange(estObj(r) ? r.task : null);
    if (!echange) throw new ErreurApi(502, 'nexus_reponse', 'Réponse de Breizhcosystem illisible. La demande est peut-être partie : regardez « Échanges en cours » avant de la refaire.');
    return { echange, page: this.#pageEchanges() };
  }

  /**
   * Échanges de l'entreprise, achats et ventes : d'abord ceux qui attendent une personne de chez elle, puis les autres en
   * cours, puis les derniers terminés. Un échange d'un genre plus récent que le jeu est gardé, avec l'avancement de sa tâche.
   */
  async echanges(): Promise<{ echanges: Echange[]; page: string | null }> {
    const vus = new Map<string, Echange>();
    let jeton: string | null = null;
    for (let n = 0; n < PAGES_ECHANGES; n++) {
      const q = new URLSearchParams({ pageSize: '100', includeArtifacts: 'true' });
      if (jeton) q.set('pageToken', jeton);
      const r = await this.#appelAgent('GET', `/tasks?${q}`);
      const taches: unknown[] = estObj(r) && Array.isArray(r.tasks) ? r.tasks.slice(0, 100) : [];
      for (const t of taches) {
        const e = lireEchange(t);
        if (e && !vus.has(e.id)) vus.set(e.id, e);
      }
      jeton = estObj(r) && typeof r.nextPageToken === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(r.nextPageToken) ? r.nextPageToken : null;
      if (!jeton || !taches.length) break;
    }
    const tous = [...vus.values()];
    const ouverts = tous.filter(estOuvert);
    return {
      echanges: [...ouverts.filter((e) => e.attend === 'vous'), ...ouverts.filter((e) => e.attend !== 'vous'), ...tous.filter((e) => !estOuvert(e)).slice(0, ECHANGES_TERMINES)],
      page: this.#pageEchanges(),
    };
  }

  async commandes(): Promise<Commande[]> {
    const d = await this.#appel('GET', '/commandes');
    const liste = Array.isArray(d) ? d : estObj(d) && Array.isArray(d.commandes) ? d.commandes : [];
    return liste.slice(0, 200).map(lireCommande).filter((c): c is Commande => c !== null);
  }

  /** Valider, annuler (acheteur) ; confirmer, refuser, « paiement reçu » (vendeur) ; « j'ai payé », vérifier (acheteur). */
  async agirCommande(id: string, action: string, d: unknown = {}) {
    if (!estUuid(id) || !(ACTIONS_COMMANDE as readonly string[]).includes(action)) throw new ErreurApi(400, 'action_invalide');
    const corps = action === 'confirmer' ? { prix: estObj(d) && d.prix === 'affiche' ? 'affiche' : 'propose' } : {};
    const r = await this.#appel('POST', `/commandes/${id}/${action}`, corps);
    return { statut: estObj(r) && estStatut(r.statut) ? r.statut : null };
  }

  /**
   * Payer une commande confirmée, directement au vendeur :
   * - « stripe » : adresse d'une page Stripe Checkout (toute autre adresse est refusée) ;
   * - « virement » : IBAN (clé vérifiée), titulaire, montant, référence à mettre dans le libellé.
   */
  async payer(id: string, mode: unknown): Promise<{ mode: 'stripe'; url: string } | { mode: 'virement'; iban: string; titulaire: string; montant: number; reference: string }> {
    if (!estUuid(id)) throw new ErreurApi(400, 'identifiant_invalide');
    if (mode !== 'stripe' && mode !== 'virement') throw new ErreurApi(400, 'mode_invalide', 'Mode de paiement : en ligne (stripe) ou virement.');
    const r = await this.#appel('POST', `/commandes/${id}/payer`, { mode });
    const o = estObj(r) ? r : {};
    if (mode === 'stripe') {
      const url = lienStripe(o.url);
      if (!url) throw new ErreurApi(502, 'paiement_refuse', 'Lien de paiement refusé : seule une page Stripe Checkout (https://checkout.stripe.com/…) peut être ouverte. Contactez le vendeur.');
      return { mode, url };
    }
    const iban = ibanValide(o.iban);
    const titulaire = ligne(o.titulaire, 140);
    const montant = positif(o.montant);
    const reference = typeof o.reference === 'string' && REFERENCE.test(o.reference) ? o.reference : null;
    if (!iban || !titulaire || montant === null || !reference) throw new ErreurApi(502, 'nexus_reponse', 'Coordonnées de virement illisibles ou IBAN invalide : rien n’est affiché. Contactez le vendeur.');
    return { mode, iban, titulaire, montant, reference };
  }

  repondre(besoinId: string, d: unknown) {
    if (!estUuid(besoinId)) throw new ErreurApi(400, 'identifiant_invalide');
    return this.#appel('POST', `/besoins/${besoinId}/repondre`, d);
  }
}
