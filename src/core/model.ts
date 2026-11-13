/**
 * Modèle commun du monde privé (LB-02, LB-03). UNIVERSEL : aucun secteur codé en dur.
 *
 * Deux niveaux :
 * - `Famille` : petit ensemble stable connu du noyau (règles, moteur, scène).
 * - `type` / `roles` : vocabulaire de l'entreprise, défini dans son UNIVERS (univers.ts),
 *   modifiable sans toucher au code. Ex. famille `projet` → type « Chantier », « Dossier », « Mission »…
 *
 * Règle : le jeu n'invente jamais une donnée. Une valeur inconnue est `null`, jamais 0.
 */

export const FAMILLES = [
  'organisation', // l'entreprise elle-même
  'departement', // services internes (commercial, production, logistique…) — pour sectoriser les entreprises plus grandes
  'personne', // employés
  'tiers', // clients, fournisseurs, partenaires, prospects, sous-traitants… (via rôles)
  'lieu', // siège, sites, entrepôts, magasins…
  'projet', // affaires, chantiers, dossiers, missions…
  'ressource', // stock, matériel, véhicules…
  'commande', // devis, commandes clients / fournisseurs, factures…
  'tache',
  'evenement',
  'indicateur',
] as const;

export type Famille = (typeof FAMILLES)[number];

/** D'où vient une valeur (LB-03). */
export type Provenance = 'confirme' | 'declare' | 'calcule' | 'infere' | 'inconnu';

/** État d'un objet ou d'une source. */
export type Disponibilite = 'disponible' | 'perime' | 'deconnecte' | 'indisponible';

/** Réel, simulation (LB-05) ou démonstration fictive (R01). Jamais mélangés. */
export type Mode = 'reel' | 'simulation' | 'demo';

export interface Source {
  id: string; // ex. "sheets:stock"
  libelle: string;
  derniereSynchro: string | null; // ISO 8601, null = jamais synchronisée
}

/** Valeur d'un champ personnalisé. Référence vers un autre objet = son id (string). */
export type ValeurChamp = string | number | boolean | null;

export interface ObjetMetier {
  id: string; // identifiant stable
  orgId: string;
  famille: Famille;
  type: string; // id de type défini par l'univers (ex. "entreprise", "chantier")
  /** Rôles d'un tiers : un même tiers peut être client ET fournisseur. Vide pour les autres familles. */
  roles: readonly string[];
  nom: string;
  champs: Readonly<Record<string, ValeurChamp>>; // validés par l'univers
  provenance: Provenance;
  source: Source;
  majLe: string;
  disponibilite: Disponibilite;
  mode: Mode;
}

export interface Valeur<T> {
  valeur: T | null; // null = inconnue
  provenance: Provenance;
  source: Source;
  observeLe: string | null;
}

export type Fraicheur = 'fraiche' | 'perimee' | 'inconnue';

/** Une valeur sans date est d'âge inconnu : elle n'est jamais considérée fraîche. */
export function fraicheur(observeLe: string | null, maintenant: Date, ageMaxMs: number): Fraicheur {
  if (observeLe === null) return 'inconnue';
  const t = Date.parse(observeLe);
  if (Number.isNaN(t)) return 'inconnue';
  return maintenant.getTime() - t <= ageMaxMs ? 'fraiche' : 'perimee';
}
