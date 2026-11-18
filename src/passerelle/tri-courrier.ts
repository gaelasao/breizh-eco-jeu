/**
 * Tri du courrier par MOTS-CLÉS, sans IA : le même, qu'un mail soit collé à la main (« Trier ce mail ») ou qu'il
 * arrive d'une boîte branchée (Gmail, Outlook). Un seul endroit pour les règles : elles se lisent, se discutent et se
 * corrigent, et rien ne part chez personne pour les appliquer.
 *
 * Ce que ça regarde : l'expéditeur, l'objet, et ce que le texte en dit quand on l'a (un mail collé). D'une boîte
 * branchée, le texte des messages N'ENTRE JAMAIS dans le jeu : le tri se fait alors sur l'expéditeur et l'objet seuls.
 */
import { normaliser } from './csv.ts';

/** Les bacs de l'écran Courrier, dans l'ordre où ils sont essayés. */
export const BACS = ['paiements', 'fournisseurs', 'clients', 'administratif', 'équipe', 'publicité', 'autre'] as const;
export type Bac = (typeof BACS)[number];

/**
 * Une règle par bac : le premier dont les mots-clés apparaissent l'emporte.
 * Les motifs s'écrivent SANS ESPACE : `normaliser` retire accents, espaces et ponctuation, si bien que « mise en
 * demeure » devient « miseendemeure ». Les motifs à espaces n'ont jamais pu correspondre à rien.
 */
const REGLES: readonly (readonly [Bac, RegExp])[] = [
  ['paiements', /facture|paiement|reglement|virement|rib|relance|impaye|avoir|echeance|miseendemeure/],
  ['fournisseurs', /livraison|commandefournisseur|retard|stock|approvision|tariffournisseur|expedition/],
  ['clients', /devis|commande|reclamation|client|rendezvous|projet|chantier|intervention|sav/],
  ['administratif', /urssaf|attestation|kbis|impots|assurance|mairie|prefecture|contrat|juridique/],
  ['équipe', /candidature|cv|conge|arret|planning|recrutement|salarie|formation/],
  ['publicité', /promotion|offrespeciale|newsletter|desinscri|salon|publicite/],
];

const URGENT = /urgent|immediat|aujourdhui|miseendemeure|dernierrappel|bloque|annul/;

/**
 * CE QUE L'OUTIL DIT LUI-MÊME DU MESSAGE. Gmail range déjà le courrier en catégories (`CATEGORY_PROMOTIONS`,
 * `CATEGORY_SOCIAL`, `CATEGORY_FORUMS`) et le dit dans les libellés de chaque message : c'est son jugement sur son
 * propre courrier, gratuit, et meilleur que n'importe quelle liste de mots-clés écrite ici. On le prend.
 *
 * Microsoft n'a pas d'équivalent : `inferenceClassification` ne dit que « prioritaire » ou « autre », ce qui n'est
 * pas la même chose — la réponse d'un client tombe régulièrement dans « autre ». L'utiliser pour éteindre une
 * urgence reviendrait à cacher un message qui compte. Pour Outlook, les mots-clés restent seuls.
 */
export type RangementOutil = 'publicite' | null;

/**
 * Bac proposé pour un texte (expéditeur + objet, et le corps quand on l'a). « autre » si rien ne ressort.
 * Ce que l'outil a déjà rangé en publicité l'emporte sur les mots-clés : une promotion qui parle de « facture »
 * reste une promotion, et n'a rien à faire dans le bac des paiements.
 */
export function bacDe(texte: string, rangeParLOutil: RangementOutil = null): Bac {
  if (rangeParLOutil === 'publicite') return 'publicité';
  const t = normaliser(texte ?? '');
  return REGLES.find(([, r]) => r.test(t))?.[0] ?? 'autre';
}

/**
 * Urgence proposée : basse pour la publicité, haute si le texte le dit, normale sinon.
 *
 * L'ORDRE EST TOUT. Il était inversé, et c'était visible à l'œil nu : « vous allez vouloir l'utiliser
 * IMMÉDIATEMENT » et « Black Week : AUJOURD'HUI en magasin » arrivaient en rouge, en haut de la liste. Les mots qui
 * déclenchent l'urgence sont exactement ceux du marketing : `immediat`, `aujourdhui`, `dernierrappel`. Une
 * publicité n'est donc jamais urgente, quoi qu'elle écrive — c'est même à ça qu'on la reconnaît.
 */
export function urgenceDe(texte: string, bac: Bac): 'haute' | 'normale' | 'basse' {
  if (bac === 'publicité') return 'basse';
  return URGENT.test(normaliser(texte ?? '')) ? 'haute' : 'normale';
}

/** Poste de la personne à qui ce bac revient d'ordinaire (cherché dans les postes des employés). */
export const POSTE_DU_BAC: Readonly<Partial<Record<Bac, RegExp>>> = {
  paiements: /compta|financ|factur/,
  fournisseurs: /logisti|stock|achet/,
  clients: /commercial|client/,
  administratif: /admin|direct|compta/,
  'équipe': /rh|ressources|recrut|direct/,
};

/** Ce qu'il y a à faire, par bac : une phrase, montrée telle quelle sur la ligne du courrier. */
export const ACTION_DU_BAC: Readonly<Record<Bac, string>> = {
  paiements: 'Vérifier le paiement et répondre',
  fournisseurs: 'Prévenir les équipes concernées et répondre',
  clients: 'Répondre au client',
  administratif: 'Fournir le document demandé',
  'équipe': 'Accuser réception',
  'publicité': 'Classer',
  autre: 'Lire et décider',
};

/** Ce que le jeu répond quand on lui demande comment il a trié : jamais « l'IA a décidé ». */
export const METHODE = 'mots-clés (sans IA)';
