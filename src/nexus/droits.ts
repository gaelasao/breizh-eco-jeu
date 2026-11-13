/**
 * Miroir en lecture seule de la réponse Breizhcosystem `GET /v0/droits`. Le contrat qui fait foi est celui du serveur
 * Breizhcosystem (service séparé) ; côté jeu, les réponses attendues sont décrites par les Breizhcosystem simulés des essais (lien-nexus.test.ts).
 * Le jeu n'a AUCUN pouvoir sur ces droits : il les affiche. Seul le serveur Breizhcosystem décide.
 */

export const CAPACITES = [
  // Gratuit
  'decouvrir',
  'publier_besoin',
  'publier_catalogue',
  'gerer_ses_besoins',
  'lire_reponses',
  'repondre_invitation',
  // Breizhcosystem ACTIVE
  'repondre_demande_externe',
  'solliciter_partenaire',
  'activer_mise_en_relation',
  'contacter_membre',
  'participer_achat_groupe',
  'comparaison_detaillee',
  'agent_achat',
] as const;

export type Capacite = (typeof CAPACITES)[number];

export type EtatAbonnement =
  | 'aucun'
  | 'actif'
  | 'paiement_en_attente'
  | 'paiement_echoue'
  | 'grace'
  | 'resilie'
  | 'expire';

export interface Droits {
  orgId: string;
  plan: 'gratuit' | 'active';
  etatAbonnement: EtatAbonnement;
  actifJusquau: string | null;
  capacites: Capacite[];
  verifieLe: string; // horodatage serveur Breizhcosystem
}

const ETATS: readonly EtatAbonnement[] = ['aucun', 'actif', 'paiement_en_attente', 'paiement_echoue', 'grace', 'resilie', 'expire'];

/**
 * Validation stricte de la structure. Les capacités inconnues (ajoutées plus tard côté Breizhcosystem)
 * sont IGNORÉES, pas rejetées : Breizhcosystem peut évoluer sans casser les jeux déjà installés.
 * Sans risque : le jeu n'accorde rien, il affiche.
 */
export function lireDroits(x: unknown): Droits | null {
  if (typeof x !== 'object' || x === null) return null;
  const o = x as Record<string, unknown>;
  if (typeof o.orgId !== 'string' || o.orgId.length === 0) return null;
  if (o.plan !== 'gratuit' && o.plan !== 'active') return null;
  if (typeof o.etatAbonnement !== 'string' || !ETATS.includes(o.etatAbonnement as EtatAbonnement)) return null;
  if (o.actifJusquau !== null && typeof o.actifJusquau !== 'string') return null;
  if (typeof o.verifieLe !== 'string') return null;
  if (!Array.isArray(o.capacites)) return null;
  if (!o.capacites.every((c) => typeof c === 'string')) return null;
  const caps = o.capacites.filter((c): c is Capacite => (CAPACITES as readonly string[]).includes(c as string));
  return {
    orgId: o.orgId,
    plan: o.plan,
    etatAbonnement: o.etatAbonnement as EtatAbonnement,
    actifJusquau: o.actifJusquau,
    capacites: caps,
    verifieLe: o.verifieLe,
  };
}
