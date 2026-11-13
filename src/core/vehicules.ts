/**
 * Suivi des véhicules (LB-03, R02) : contrôle technique, révision, pneus, assurance, carte grise, et une échéance
 * que l'entreprise nomme elle-même. Rien n'est obligatoire : un véhicule sans aucune date ne produit rien.
 *
 * Tout tient sur la fiche du véhicule, en champs déclarés par l'univers : la DATE de la prochaine fois, le
 * KILOMÉTRAGE de la prochaine fois, et la répétition (tous les N mois, tous les N kilomètres). Les échéances par
 * DATE sont évaluées par le mécanisme d'échéance déjà en place (univers → `evaluerEcheance`) ; ce module ajoute ce
 * que ce mécanisme ne sait pas faire : les échéances au KILOMÉTRAGE, et le rappel d'un compteur trop vieux pour
 * qu'elles veuillent encore dire quelque chose.
 *
 * Les périodicités et les délais de prévenance écrits ici sont des VALEURS DE DÉPART INDICATIVES, modifiables
 * véhicule par véhicule. Le jeu n'énonce aucune obligation légale : ce qui s'applique à un véhicule se vérifie
 * auprès de son constructeur, de son assureur et des textes en vigueur.
 */
import type { ObjetMetier } from './model.ts';
import { fraicheur } from './model.ts';
import type { ContexteRegle, Situation } from './situation.ts';
import { pluriel } from './texte.ts';

/** Une nature d'échéance et les champs du véhicule qui la portent. */
export interface DefEcheanceVehicule {
  id: string;
  /** Intitulé par défaut (l'échéance libre prend celui que l'entreprise écrit dans `champLibelle`). */
  libelle: string;
  /** Ce qu'une ligne d'historique garde dans son champ « Nature » (valeur du choix, lisible telle quelle). */
  nature: string;
  /** Champ date : la prochaine fois. */
  champDate: string;
  /** Champ nombre : la prochaine fois, en kilomètres au compteur (absent = cette échéance n'est pas kilométrique). */
  champKm?: string;
  /** Champ nombre : répétition, en mois. */
  champMois: string;
  /** Champ nombre : répétition, en kilomètres. */
  champKmPeriode?: string;
  /** Champ texte : l'intitulé choisi par l'entreprise (échéance libre). */
  champLibelle?: string;
  /** Champ qui dit l'état d'usure du moment (pneus). */
  champEtat?: string;
  /** Répétition proposée tant que l'entreprise n'a pas donné la sienne — indicative. */
  moisSuggere: number | null;
  kmSuggere: number | null;
  /** Délai de prévenance habituel : on en parle N jours avant — indicatif, surchargé par `prevenir_jours`. */
  prevenirJours: number;
  /** On en parle N kilomètres avant — indicatif. */
  prevenirKm: number | null;
}

export const ECHEANCES_VEHICULE: readonly DefEcheanceVehicule[] = Object.freeze([
  {
    id: 'controle_technique', libelle: 'Contrôle technique', nature: 'contrôle technique',
    champDate: 'controle_technique', champMois: 'ct_tous_les_mois',
    moisSuggere: 24, kmSuggere: null, prevenirJours: 30, prevenirKm: null,
  },
  {
    id: 'revision', libelle: 'Révision ou entretien', nature: 'révision ou entretien',
    champDate: 'prochaine_revision', champKm: 'revision_km',
    champMois: 'revision_tous_les_mois', champKmPeriode: 'revision_tous_les_km',
    moisSuggere: 12, kmSuggere: 20_000, prevenirJours: 21, prevenirKm: 1_000,
  },
  {
    id: 'pneus', libelle: 'Pneus', nature: 'pneus',
    champDate: 'pneus_le', champKm: 'pneus_km',
    champMois: 'pneus_tous_les_mois', champKmPeriode: 'pneus_tous_les_km', champEtat: 'etat_pneus',
    moisSuggere: 6, kmSuggere: 30_000, prevenirJours: 21, prevenirKm: 1_500,
  },
  {
    id: 'assurance', libelle: 'Assurance', nature: 'assurance',
    champDate: 'assurance_le', champMois: 'assurance_tous_les_mois',
    moisSuggere: 12, kmSuggere: null, prevenirJours: 30, prevenirKm: null,
  },
  {
    id: 'carte_grise', libelle: 'Carte grise ou vignette', nature: 'carte grise ou vignette',
    champDate: 'carte_grise_le', champMois: 'carte_grise_tous_les_mois',
    moisSuggere: 12, kmSuggere: null, prevenirJours: 30, prevenirKm: null,
  },
  {
    id: 'libre', libelle: 'Autre échéance', nature: 'autre échéance',
    champDate: 'autre_le', champKm: 'autre_km',
    champMois: 'autre_tous_les_mois', champKmPeriode: 'autre_tous_les_km', champLibelle: 'autre_libelle',
    moisSuggere: null, kmSuggere: null, prevenirJours: 21, prevenirKm: 1_000,
  },
] as const satisfies readonly DefEcheanceVehicule[]);

export const defEcheance = (id: string): DefEcheanceVehicule | undefined => ECHEANCES_VEHICULE.find((d) => d.id === id);
export const defParNature = (nature: string): DefEcheanceVehicule | undefined => ECHEANCES_VEHICULE.find((d) => d.nature === nature);

/** Type d'objet qui garde ce qui a été fait sur un véhicule (famille « evenement »). */
export const TYPE_ENTRETIEN = 'entretien_vehicule';

/** Au-delà, un kilométrage saisi à la main ne dit plus grand-chose : on le redemande (indicatif). */
export const JOURS_KM_PERIME = 90;

const JOUR = 86_400_000;

const nombre = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const entierPositif = (x: unknown): number | null => { const n = nombre(x); return n !== null && n > 0 ? Math.round(n) : null; };
const jourDe = (x: unknown): string | null => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);

/** Un véhicule, quel que soit le nom que l'univers lui donne (« Véhicule », « Camion »…). */
export const estVehicule = (o: ObjetMetier): boolean => o.famille === 'ressource' && /v[eé]hicule/i.test(o.type);

/** Jour local au format AAAA-MM-JJ. */
export function jourIso(d: Date): string {
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
}

/** Nombre de jours entiers entre deux jours AAAA-MM-JJ (positif si `fin` est après `debut`). */
export function joursEntre(debut: string, fin: string): number | null {
  const a = Date.parse(`${debut}T00:00:00Z`);
  const b = Date.parse(`${fin}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / JOUR);
}

/**
 * Ajoute des mois à un jour AAAA-MM-JJ. Le 31 janvier + 1 mois donne le 28 (ou 29) février : on ne déborde jamais
 * sur le mois suivant, une échéance ne doit pas glisser.
 */
export function ajouterMois(jour: string, mois: number): string | null {
  const [a, m, j] = jour.split('-').map(Number);
  if (!a || !m || !j) return null;
  const cible = new Date(a, m - 1 + mois, 1);
  const dernier = new Date(cible.getFullYear(), cible.getMonth() + 1, 0).getDate();
  cible.setDate(Math.min(j, dernier));
  return jourIso(cible);
}

export type EtatEcheance = 'absente' | 'ok' | 'bientot' | 'aujourdhui' | 'depassee';
const RANG_ETAT: Readonly<Record<EtatEcheance, number>> = { depassee: 0, aujourdhui: 1, bientot: 2, ok: 3, absente: 4 };
/** Le plus pressant des deux états (date et kilométrage). */
export const pireEtat = (a: EtatEcheance, b: EtatEcheance): EtatEcheance => (RANG_ETAT[a] <= RANG_ETAT[b] ? a : b);

export interface EcheanceVehicule {
  id: string;
  /** Intitulé affiché : celui de l'entreprise pour l'échéance libre, sinon celui par défaut. */
  libelle: string;
  date: string | null;
  km: number | null;
  joursRestants: number | null;
  kmRestants: number | null;
  prevenirJours: number;
  prevenirKm: number | null;
  /** Répétition enregistrée sur la fiche (null : rien n'a été dit). */
  periodeMois: number | null;
  periodeKm: number | null;
  /** Répétition proposée à défaut, indicative. */
  moisSuggere: number | null;
  kmSuggere: number | null;
  /** État d'usure du moment, quand le champ existe (pneus). */
  etat: string | null;
  statut: EtatEcheance;
  /** Ce qui sera programmé par « C'est fait » aujourd'hui, au kilométrage connu. */
  suivante: { date: string | null; km: number | null };
  /** Champs du véhicule à écrire pour la renseigner : l'écran modifie la fiche sans connaître cette table. */
  champs: { date: string; km: string | null; mois: string; kmPeriode: string | null; libelle: string | null };
}

/** Kilométrage d'un véhicule, et depuis quand on le sait. */
export interface KilometrageVehicule {
  km: number | null;
  le: string | null;
  jours: number | null;
  /** Trop vieux pour qu'une échéance au kilométrage veuille dire quelque chose. */
  perime: boolean;
}

export function kilometrageDe(v: ObjetMetier, maintenant: Date): KilometrageVehicule {
  const km = nombre(v.champs.kilometrage);
  const le = jourDe(v.champs.kilometrage_le);
  const jours = le ? joursEntre(le, jourIso(maintenant)) : null;
  return { km, le, jours, perime: km === null || jours === null || jours > JOURS_KM_PERIME };
}

/** Délai de prévenance du véhicule (`prevenir_jours`), sinon celui de la nature d'échéance. */
export const prevenanceDe = (v: ObjetMetier, d: DefEcheanceVehicule): number => {
  const propre = entierPositif(v.champs.prevenir_jours);
  return propre !== null && propre <= 365 ? propre : d.prevenirJours;
};

function statutDate(date: string | null, jours: number | null, prevenir: number): EtatEcheance {
  if (date === null || jours === null) return 'absente';
  if (jours < 0) return 'depassee';
  if (jours === 0) return 'aujourdhui';
  return jours <= prevenir ? 'bientot' : 'ok';
}

function statutKm(km: number | null, restants: number | null, prevenir: number | null): EtatEcheance {
  if (km === null || restants === null) return 'absente';
  if (restants <= 0) return 'depassee';
  return prevenir !== null && restants <= prevenir ? 'bientot' : 'ok';
}

/**
 * Les échéances d'un véhicule, dans l'ordre de la table, avec leur état du jour. `toutes: true` garde aussi celles
 * qui n'ont ni date ni kilométrage (l'écran les propose à remplir) ; sinon on ne rend que ce qui est renseigné.
 */
export function echeancesDe(v: ObjetMetier, maintenant: Date, { toutes = false } = {}): EcheanceVehicule[] {
  const aujourdhui = jourIso(maintenant);
  const kmCourant = kilometrageDe(v, maintenant);
  const res: EcheanceVehicule[] = [];
  for (const d of ECHEANCES_VEHICULE) {
    const date = jourDe(v.champs[d.champDate]);
    const km = d.champKm ? nombre(v.champs[d.champKm]) : null;
    const nomLibre = d.champLibelle && typeof v.champs[d.champLibelle] === 'string' ? String(v.champs[d.champLibelle]).trim() : '';
    if (!toutes && date === null && km === null && !nomLibre) continue;
    const periodeMois = entierPositif(v.champs[d.champMois]);
    const periodeKm = d.champKmPeriode ? entierPositif(v.champs[d.champKmPeriode]) : null;
    const prevenirJours = prevenanceDe(v, d);
    const joursRestants = date ? joursEntre(aujourdhui, date) : null;
    const kmRestants = km !== null && kmCourant.km !== null ? km - kmCourant.km : null;
    const mois = periodeMois ?? d.moisSuggere;
    const pas = periodeKm ?? d.kmSuggere;
    res.push({
      id: d.id,
      libelle: nomLibre || d.libelle,
      date, km, joursRestants, kmRestants, prevenirJours, prevenirKm: d.prevenirKm,
      periodeMois, periodeKm, moisSuggere: d.moisSuggere, kmSuggere: d.kmSuggere,
      etat: d.champEtat && typeof v.champs[d.champEtat] === 'string' ? String(v.champs[d.champEtat]) : null,
      statut: pireEtat(statutDate(date, joursRestants, prevenirJours), statutKm(km, kmRestants, d.prevenirKm)),
      suivante: {
        date: mois !== null ? ajouterMois(aujourdhui, mois) : null,
        km: pas !== null && kmCourant.km !== null ? kmCourant.km + pas : null,
      },
      champs: { date: d.champDate, km: d.champKm ?? null, mois: d.champMois, kmPeriode: d.champKmPeriode ?? null, libelle: d.champLibelle ?? null },
    });
  }
  return res;
}

/** La prochaine fois, après une intervention faite le `faitLe` à `faitKm` au compteur. */
export function prochaineOccurrence(
  v: ObjetMetier,
  d: DefEcheanceVehicule,
  faitLe: string,
  faitKm: number | null,
): { date: string | null; km: number | null } {
  const mois = entierPositif(v.champs[d.champMois]) ?? d.moisSuggere;
  const pas = d.champKmPeriode ? entierPositif(v.champs[d.champKmPeriode]) ?? d.kmSuggere : null;
  return {
    date: mois !== null ? ajouterMois(faitLe, mois) : null,
    km: pas !== null && faitKm !== null ? Math.round(faitKm + pas) : null,
  };
}

/**
 * Ce que « C'est fait » écrit sur la fiche du véhicule : la prochaine fois (date et kilométrage), et le compteur
 * relevé à cette occasion. Rend les champs à changer ; `null` efface une date qu'on ne sait pas reprogrammer.
 */
export function champsApresFait(
  v: ObjetMetier,
  d: DefEcheanceVehicule,
  faitLe: string,
  faitKm: number | null,
): Record<string, string | number | null> {
  const suite = prochaineOccurrence(v, d, faitLe, faitKm);
  const champs: Record<string, string | number | null> = { [d.champDate]: suite.date };
  if (d.champKm) champs[d.champKm] = suite.km;
  if (faitKm !== null) {
    const actuel = nombre(v.champs.kilometrage);
    if (actuel === null || faitKm >= actuel) { champs.kilometrage = Math.round(faitKm); champs.kilometrage_le = faitLe; }
  }
  return champs;
}

/** Une ligne d'historique : ce qui a été fait sur ce véhicule. */
export interface LigneEntretien {
  id: string;
  nom: string;
  echeance: string | null;
  libelle: string;
  faitLe: string | null;
  km: number | null;
  cout: number | null;
}

/** L'historique d'un véhicule, le plus récent d'abord. */
export function historiqueDe(objets: readonly ObjetMetier[], vehiculeId: string): LigneEntretien[] {
  return objets
    .filter((o) => o.type === TYPE_ENTRETIEN && o.champs.concerne === vehiculeId)
    .map((o) => {
      const nature = typeof o.champs.echeance === 'string' ? o.champs.echeance : null;
      return {
        id: o.id, nom: o.nom, echeance: nature === null ? null : defParNature(nature)?.id ?? null,
        libelle: o.nom,
        faitLe: jourDe(o.champs.fait_le), km: nombre(o.champs.kilometrage), cout: nombre(o.champs.cout),
      };
    })
    .sort((a, b) => String(b.faitLe ?? '').localeCompare(String(a.faitLe ?? '')));
}

/** Total dépensé sur une année civile (null : aucun coût n'a été saisi cette année-là). */
export function totalAnnee(lignes: readonly LigneEntretien[], annee: number): number | null {
  const avecCout = lignes.filter((l) => l.cout !== null && String(l.faitLe ?? '').startsWith(`${annee}-`));
  if (!avecCout.length) return null;
  return Math.round(avecCout.reduce((n, l) => n + (l.cout as number), 0) * 100) / 100;
}

// ------------------------------------------------------------------ situations (ce qui remonte dans « Aujourd'hui »)

const kilometres = (n: number): string => `${pluriel(n, 'kilomètre', 'kilomètres')}`;

/**
 * Situations d'un véhicule que les règles d'échéance de l'univers ne couvrent pas :
 * - une échéance au KILOMÉTRAGE atteinte ou proche ;
 * - un compteur trop vieux alors que le véhicule a au moins une échéance au kilométrage.
 * Les échéances par DATE restent évaluées par `evaluerEcheance` (règles déclarées dans l'univers).
 */
export function situationsVehicule(v: ObjetMetier, responsable: string | null, ctx: ContexteRegle): Situation[] {
  if (!estVehicule(v)) return [];
  const res: Situation[] = [];
  const km = kilometrageDe(v, ctx.maintenant);
  const f = fraicheur(km.le, ctx.maintenant, ctx.ageMaxMs);
  const preuve = (valeur: number | null, seuil: number | null) => ({
    valeur, seuil, source: v.source, observeLe: km.le, provenance: v.provenance, fraicheur: f,
  });
  const echeances = echeancesDe(v, ctx.maintenant).filter((x) => x.km !== null);
  for (const x of echeances) {
    if (km.km === null || x.kmRestants === null) continue;
    const base = { objetId: v.id, regle: `vehicule_km_${x.id}`, responsable };
    if (x.kmRestants <= 0) {
      res.push({
        ...base, gravite: 'critique', statut: km.perime ? 'a_verifier' : 'ouverte',
        description: `${x.libelle} : seuil de kilométrage dépassé de ${kilometres(-x.kmRestants)}`,
        preuve: preuve(-x.kmRestants, 0),
      });
      continue;
    }
    if (x.prevenirKm !== null && x.kmRestants <= x.prevenirKm) {
      res.push({
        ...base, gravite: 'attention', statut: km.perime ? 'a_verifier' : 'ouverte',
        description: `${x.libelle} : dans ${kilometres(x.kmRestants)}`,
        preuve: preuve(-x.kmRestants, 0),
      });
    }
  }
  // un compteur trop vieux : les échéances au kilométrage ne veulent plus rien dire tant qu'il n'est pas relevé
  if (echeances.length && km.perime) {
    res.push({
      objetId: v.id, regle: 'vehicule_kilometrage', responsable, gravite: 'attention', statut: 'a_verifier',
      description: km.km === null
        ? 'Kilométrage : jamais relevé, les échéances au kilométrage ne peuvent pas être suivies'
        : `Kilométrage : relevé il y a ${pluriel(km.jours ?? 0, 'jour', 'jours')}, à mettre à jour`,
      preuve: preuve(km.jours, JOURS_KM_PERIME),
    });
  }
  return res;
}

/** Toutes les situations de kilométrage d'un ensemble d'objets. */
export function situationsVehicules(
  objets: readonly ObjetMetier[],
  responsableDe: (o: ObjetMetier) => string | null,
  ctx: ContexteRegle,
): Situation[] {
  return objets.filter(estVehicule).flatMap((v) => situationsVehicule(v, responsableDe(v), ctx));
}
