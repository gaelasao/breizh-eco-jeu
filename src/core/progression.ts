/**
 * Progression (direction de design §4.25, §5.9, §6.1 P10) : XP, niveaux du port et trophées.
 *
 * Règle d'or (§1.2 P1, « un jeu qui récompense le travail réel ») : AUCUN point inventé. L'XP ne vient que des quêtes
 * achevées, et une quête n'est achevée que si une donnée FRAÎCHE prouve le retour dans les limites (core/quetes.ts).
 * Pas de point pour une connexion, un clic ou une journée d'utilisation. Une même quête ne rapporte qu'une fois par
 * jour (on ne gagne rien à faire sortir puis rentrer un stock de ses limites). Les réussites sur des données d'exemple
 * sont marquées comme telles et ne comptent jamais pour une vraie entreprise.
 *
 * Les niveaux ajoutent un élément au décor de la carte, jamais une fonction (§5.9), aux mêmes emplacements pour tous.
 * Module PUR : aucune entrée-sortie, testé par src/core/progression.test.ts.
 */
import type { Quete } from './quetes.ts';

export type GraviteQuete = 'critique' | 'attention';

/** XP d'une quête achevée, selon la gravité de la situation qui l'a fait naître. */
export const RECOMPENSE: Readonly<Record<GraviteQuete, number>> = Object.freeze({ critique: 60, attention: 40 });

/** Les 10 niveaux du port (§5.9) : seuil d'XP cumulé, nom et élément du décor débloqué. */
export const NIVEAUX: ReadonlyArray<{ n: number; nom: string; xp: number; element: string }> = Object.freeze([
  { n: 1, nom: 'Cale', xp: 0, element: 'une cale de mise à l’eau' },
  { n: 2, nom: 'Quai', xp: 100, element: 'un quai en granit' },
  { n: 3, nom: 'Grue', xp: 250, element: 'une grue sur le quai' },
  { n: 4, nom: 'Port de pêche', xp: 450, element: 'des bateaux de pêche' },
  { n: 5, nom: 'Marché couvert', xp: 700, element: 'un marché couvert' },
  { n: 6, nom: 'Chantier naval', xp: 1000, element: 'un chantier naval' },
  { n: 7, nom: 'Criée', xp: 1400, element: 'une criée' },
  { n: 8, nom: 'Phare restauré', xp: 1900, element: 'le phare repeint' },
  { n: 9, nom: 'Ferry', xp: 2500, element: 'un ferry à quai' },
  { n: 10, nom: 'Port de commerce', xp: 3200, element: 'des conteneurs et un cargo' },
].map((x) => Object.freeze(x)));

export interface PreuveReussite {
  valeur: number | null;
  seuil: number | null;
  observeLe: string | null;
}

/** Une quête achevée, gardée dans l'état enregistré (les quêtes, elles, sont recalculées). */
export interface Reussite {
  /** `<id de la quête>@<jour>` : une même quête ne rapporte qu'une fois par jour. */
  id: string;
  quete: string;
  regle: string;
  objetId: string;
  nom: string;
  titre: string;
  gravite: GraviteQuete;
  xp: number;
  le: string;
  preuve: PreuveReussite;
  /** Réussite sur une donnée d'exemple : ne compte jamais pour une vraie entreprise. */
  exemple: boolean;
}

export interface Trophee {
  id: string;
  titre: string;
  texte: string;
  icone: string;
  /** Date de la réussite qui l'a débloqué, ou null tant qu'il ne l'est pas. */
  le: string | null;
  /** Réussites qui le prouvent (identifiants), dans l'ordre. */
  preuves: string[];
  /** Avancement « 2 sur 5 » tant qu'il n'est pas obtenu. */
  avance: number;
  objectif: number;
}

export interface Progression {
  xp: number;
  niveau: { n: number; nom: string; element: string; xp: number };
  suivant: { n: number; nom: string; element: string; xp: number; reste: number } | null;
  /** Part de l'écart entre le niveau atteint et le suivant (0 à 1) ; 1 au dernier niveau. */
  avancement: number;
  reussites: Reussite[];
  trophees: Trophee[];
  exemple: boolean;
}

const MAX_REUSSITES = 2000;
const jourDe = (iso: string) => iso.slice(0, 10);

/** Lit une liste de réussites enregistrée (tolérante : une entrée abîmée est ignorée, jamais inventée). */
export function lireReussites(brut: unknown): Reussite[] {
  if (!Array.isArray(brut)) return [];
  const vues = new Set<string>();
  const res: Reussite[] = [];
  for (const x of brut) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.quete !== 'string' || typeof r.le !== 'string' || Number.isNaN(Date.parse(r.le))) continue;
    if (vues.has(r.id)) continue;
    const gravite: GraviteQuete = r.gravite === 'critique' ? 'critique' : 'attention';
    const p = (r.preuve && typeof r.preuve === 'object' ? r.preuve : {}) as Record<string, unknown>;
    vues.add(r.id);
    res.push({
      id: r.id, quete: r.quete, regle: typeof r.regle === 'string' ? r.regle : '', objetId: typeof r.objetId === 'string' ? r.objetId : '',
      nom: typeof r.nom === 'string' ? r.nom : '', titre: typeof r.titre === 'string' ? r.titre : '', gravite,
      xp: RECOMPENSE[gravite], le: r.le,
      preuve: { valeur: typeof p.valeur === 'number' ? p.valeur : null, seuil: typeof p.seuil === 'number' ? p.seuil : null, observeLe: typeof p.observeLe === 'string' ? p.observeLe : null },
      exemple: r.exemple === true,
    });
  }
  return res.sort((a, b) => a.le.localeCompare(b.le)).slice(-MAX_REUSSITES);
}

/**
 * Réussites nouvelles entre deux états des quêtes : une quête qui passe de « ouverte » à « achevée », avec sa preuve.
 * `dejaVues` : réussites déjà enregistrées (une même quête ne rapporte qu'une fois par jour).
 * `exempleDe(objetId)` : vrai si l'objet est une donnée d'exemple.
 */
export function nouvellesReussites(
  avant: ReadonlyMap<string, Quete>,
  apres: ReadonlyMap<string, Quete>,
  dejaVues: readonly Reussite[],
  exempleDe: (objetId: string) => boolean,
  nomDe: (objetId: string) => string,
): Reussite[] {
  const ids = new Set(dejaVues.map((r) => r.id));
  const res: Reussite[] = [];
  for (const [id, q] of apres) {
    if (q.statut !== 'achevee' || !q.acheveeLe) continue;
    const a = avant.get(id);
    if (!a || a.statut !== 'ouverte') continue; // jamais vue ouverte : rien n'a été fait (redémarrage, import)
    const cle = `${id}@${jourDe(q.acheveeLe)}`;
    if (ids.has(cle)) continue;
    const gravite: GraviteQuete = q.gravite === 'critique' ? 'critique' : 'attention';
    ids.add(cle);
    res.push({
      id: cle, quete: id, regle: q.origine.regle, objetId: q.origine.objetId, nom: nomDe(q.origine.objetId), titre: q.titre,
      gravite, xp: RECOMPENSE[gravite], le: q.acheveeLe,
      preuve: { valeur: q.preuve?.valeur ?? null, seuil: q.preuve?.seuil ?? null, observeLe: q.preuve?.observeLe ?? null },
      exemple: exempleDe(q.origine.objetId),
    });
  }
  return res;
}

/** Niveau atteint pour un total d'XP. */
export function niveauPour(xp: number) {
  let i = 0;
  for (let k = 0; k < NIVEAUX.length; k++) if (xp >= (NIVEAUX[k] as { xp: number }).xp) i = k;
  return NIVEAUX[i] as (typeof NIVEAUX)[number];
}

interface DefTrophee {
  id: string;
  titre: string;
  texte: string;
  icone: string;
  objectif: number;
  /** Réussites qui comptent pour ce trophée. */
  compte: (r: Reussite) => boolean;
  /** Compter des règles différentes plutôt que des réussites. */
  distinctes?: boolean;
}

/** Trophées : chacun a sa date et sa preuve. Aucun pour une simple connexion quotidienne (§4.25). */
const DEFS_TROPHEES: DefTrophee[] = [
  { id: 'premiere-quete', titre: 'Première quête', texte: 'Une première situation réglée, prouvée par une donnée à jour.', icone: 'flag', objectif: 1, compte: () => true },
  { id: 'cinq-quetes', titre: 'Cinq quêtes', texte: 'Cinq situations réglées.', icone: 'anchor', objectif: 5, compte: () => true },
  { id: 'vingt-quetes', titre: 'Vingt quêtes', texte: 'Vingt situations réglées : le port tourne.', icone: 'ship', objectif: 20, compte: () => true },
  { id: 'stock-tenu', titre: 'Stock tenu', texte: 'Trois stocks remontés au-dessus de leur minimum.', icone: 'boxes', objectif: 3, compte: (r) => r.regle === 'stock_minimum' },
  { id: 'factures-encaissees', titre: 'Factures encaissées', texte: 'Trois retards de paiement résorbés.', icone: 'receipt', objectif: 3, compte: (r) => r.regle === 'retard_paiement' },
  { id: 'urgence-reglee', titre: 'Urgence réglée', texte: 'Une situation critique réglée.', icone: 'life-buoy', objectif: 1, compte: (r) => r.gravite === 'critique' },
  { id: 'tour-du-port', titre: 'Tour du port', texte: 'Des situations réglées dans trois domaines différents.', icone: 'compass', objectif: 3, compte: () => true, distinctes: true },
];
export const TROPHEES: readonly DefTrophee[] = Object.freeze(DEFS_TROPHEES.map((t) => Object.freeze(t)));

/** Trophées obtenus et en cours, avec leur preuve. `reussites` dans l'ordre chronologique. */
export function trophees(reussites: readonly Reussite[]): Trophee[] {
  return TROPHEES.map((t) => {
    const preuves: string[] = [];
    const regles = new Set<string>();
    let le: string | null = null;
    for (const r of reussites) {
      if (!t.compte(r)) continue;
      if (t.distinctes) {
        if (regles.has(r.regle)) continue;
        regles.add(r.regle);
      }
      if (preuves.length < t.objectif) preuves.push(r.id);
      if (!le && preuves.length >= t.objectif) le = r.le;
    }
    return { id: t.id, titre: t.titre, texte: t.texte, icone: t.icone, le, preuves, avance: Math.min(preuves.length, t.objectif), objectif: t.objectif };
  });
}

/**
 * Progression affichée. `exemple` : l'entreprise est l'exemple fictif (on compte alors ses réussites d'exemple,
 * marquées comme telles) ; sinon seules les réussites sur de vraies données comptent.
 */
export function progression(toutes: readonly Reussite[], { exemple = false }: { exemple?: boolean } = {}): Progression {
  const reussites = toutes.filter((r) => r.exemple === exemple).sort((a, b) => a.le.localeCompare(b.le));
  const xp = reussites.reduce((n, r) => n + r.xp, 0);
  const niveau = niveauPour(xp);
  const s = NIVEAUX.find((x) => x.n === niveau.n + 1) ?? null;
  return {
    xp,
    niveau: { n: niveau.n, nom: niveau.nom, element: niveau.element, xp: niveau.xp },
    suivant: s ? { n: s.n, nom: s.nom, element: s.element, xp: s.xp, reste: s.xp - xp } : null,
    avancement: s ? Math.max(0, Math.min(1, (xp - niveau.xp) / (s.xp - niveau.xp))) : 1,
    reussites,
    trophees: trophees(reussites),
    exemple,
  };
}
