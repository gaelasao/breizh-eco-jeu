/**
 * Suivi du matériel roulant (LB-03, R02) : les VÉHICULES, comptés en kilomètres, et les ENGINS de chantier, comptés
 * en heures de service. Contrôle technique, révision, pneus, assurance, carte grise pour les uns ; révision, contrôle
 * périodique, vérification générale pour les autres ; et, pour tous, une échéance que l'entreprise nomme elle-même.
 * Rien n'est obligatoire : un matériel sans aucune date ne produit rien.
 *
 * Tout tient sur sa fiche, en champs déclarés par l'univers : la DATE de la prochaine fois, le COMPTEUR de la
 * prochaine fois, et la répétition (tous les N mois, tous les N kilomètres ou heures). Les échéances par DATE sont
 * évaluées par le mécanisme d'échéance déjà en place (univers → `evaluerEcheance`) ; ce module ajoute ce que ce
 * mécanisme ne sait pas faire : les échéances au COMPTEUR, et le rappel d'un compteur trop vieux pour qu'elles
 * veuillent encore dire quelque chose.
 *
 * Les périodicités et les délais de prévenance écrits ici sont des VALEURS DE DÉPART INDICATIVES, modifiables fiche
 * par fiche — en jours comme au compteur. Le jeu n'énonce aucune obligation légale : ce qui s'applique à un matériel
 * se vérifie auprès de son constructeur, de son assureur et des textes en vigueur.
 */
import type { ObjetMetier } from './model.ts';
import { fraicheur } from './model.ts';
import type { ContexteRegle, Situation } from './situation.ts';
import { pluriel } from './texte.ts';

/** Ce que compte le compteur : des kilomètres (véhicule) ou des heures de service (engin). */
export type UniteCompteur = 'km' | 'h';
/** Sorte de matériel suivi : les deux se suivent pareil, seule l'unité du compteur change. */
export type SorteMateriel = 'vehicule' | 'engin';

/** Une nature d'échéance et les champs du matériel qui la portent. */
export interface DefEcheanceMateriel {
  id: string;
  /** Intitulé par défaut (l'échéance libre prend celui que l'entreprise écrit dans `champLibelle`). */
  libelle: string;
  /** Ce qu'une ligne d'historique garde dans son champ « Nature » (valeur du choix, lisible telle quelle). */
  nature: string;
  /** Champ date : la prochaine fois. */
  champDate: string;
  /** Champ nombre : la prochaine fois, au compteur (absent = cette échéance n'est pas au compteur). */
  champCompteur?: string;
  /** Champ nombre : répétition, en mois. */
  champMois: string;
  /** Champ nombre : répétition, au compteur. */
  champCompteurPeriode?: string;
  /** Champ texte : l'intitulé choisi par l'entreprise (échéance libre). */
  champLibelle?: string;
  /** Champ qui dit l'état d'usure du moment (pneus). */
  champEtat?: string;
  /** Répétition proposée tant que l'entreprise n'a pas donné la sienne — indicative. */
  moisSuggere: number | null;
  compteurSuggere: number | null;
  /** Délai de prévenance habituel : on en parle N jours avant — indicatif, surchargé sur la fiche. */
  prevenirJours: number;
  /** On en parle N kilomètres (ou heures) avant — indicatif, surchargé sur la fiche. */
  prevenirCompteur: number | null;
}

/** Une sorte de matériel : son compteur, ses préavis, ses échéances. */
export interface DefMateriel {
  sorte: SorteMateriel;
  unite: UniteCompteur;
  /** Le compteur : son intitulé, l'action qui le relève (écrite d'avance : l'article et l'accord changent), ses champs. */
  libelleCompteur: string;
  libelleReleve: string;
  champCompteur: string;
  champCompteurLe: string;
  /** Ce qui identifie l'exemplaire sur sa fiche (immatriculation, numéro de parc). */
  champIdentifiant: string;
  /** Préavis choisis par l'entreprise ; au-delà de la borne, la valeur de départ reprend la main. */
  champPrevenirJours: string;
  champPrevenirCompteur: string;
  prevenirJoursMax: number;
  prevenirCompteurMax: number;
  /** Au-delà, ce n'est plus un relevé de compteur mais une faute de frappe. */
  compteurMax: number;
  echeances: readonly DefEcheanceMateriel[];
}

const ECHEANCES_VEHICULE: readonly DefEcheanceMateriel[] = Object.freeze([
  {
    id: 'controle_technique', libelle: 'Contrôle technique', nature: 'contrôle technique',
    champDate: 'controle_technique', champMois: 'ct_tous_les_mois',
    moisSuggere: 24, compteurSuggere: null, prevenirJours: 30, prevenirCompteur: null,
  },
  {
    id: 'revision', libelle: 'Révision ou entretien', nature: 'révision ou entretien',
    champDate: 'prochaine_revision', champCompteur: 'revision_km',
    champMois: 'revision_tous_les_mois', champCompteurPeriode: 'revision_tous_les_km',
    moisSuggere: 12, compteurSuggere: 20_000, prevenirJours: 21, prevenirCompteur: 1_000,
  },
  {
    id: 'pneus', libelle: 'Pneus', nature: 'pneus',
    champDate: 'pneus_le', champCompteur: 'pneus_km',
    champMois: 'pneus_tous_les_mois', champCompteurPeriode: 'pneus_tous_les_km', champEtat: 'etat_pneus',
    moisSuggere: 6, compteurSuggere: 30_000, prevenirJours: 21, prevenirCompteur: 1_500,
  },
  {
    id: 'assurance', libelle: 'Assurance', nature: 'assurance',
    champDate: 'assurance_le', champMois: 'assurance_tous_les_mois',
    moisSuggere: 12, compteurSuggere: null, prevenirJours: 30, prevenirCompteur: null,
  },
  {
    id: 'carte_grise', libelle: 'Carte grise ou vignette', nature: 'carte grise ou vignette',
    champDate: 'carte_grise_le', champMois: 'carte_grise_tous_les_mois',
    moisSuggere: 12, compteurSuggere: null, prevenirJours: 30, prevenirCompteur: null,
  },
  {
    id: 'libre', libelle: 'Autre échéance', nature: 'autre échéance',
    champDate: 'autre_le', champCompteur: 'autre_km',
    champMois: 'autre_tous_les_mois', champCompteurPeriode: 'autre_tous_les_km', champLibelle: 'autre_libelle',
    moisSuggere: null, compteurSuggere: null, prevenirJours: 21, prevenirCompteur: 1_000,
  },
] as const satisfies readonly DefEcheanceMateriel[]);

/* Engins : ce qui revient dans leur vie d'atelier, compté en heures de service. Aucune de ces échéances n'affirme
   une obligation : ce sont des repères de départ, à vérifier pour chaque engin et à changer sur sa fiche. */
const ECHEANCES_ENGIN: readonly DefEcheanceMateriel[] = Object.freeze([
  {
    id: 'revision', libelle: 'Révision ou entretien', nature: 'révision ou entretien',
    champDate: 'prochaine_revision', champCompteur: 'revision_heures',
    champMois: 'revision_tous_les_mois', champCompteurPeriode: 'revision_toutes_les_heures',
    moisSuggere: 12, compteurSuggere: 500, prevenirJours: 21, prevenirCompteur: 50,
  },
  {
    id: 'controle_periodique', libelle: 'Contrôle périodique', nature: 'contrôle périodique',
    champDate: 'controle_periodique_le', champCompteur: 'controle_periodique_heures',
    champMois: 'controle_periodique_tous_les_mois', champCompteurPeriode: 'controle_periodique_toutes_les_heures',
    moisSuggere: 6, compteurSuggere: 1_000, prevenirJours: 30, prevenirCompteur: 100,
  },
  {
    id: 'verification_generale', libelle: 'Vérification générale', nature: 'vérification générale',
    champDate: 'verification_generale_le', champMois: 'verification_generale_tous_les_mois',
    moisSuggere: 12, compteurSuggere: null, prevenirJours: 30, prevenirCompteur: null,
  },
  {
    id: 'libre', libelle: 'Autre échéance', nature: 'autre échéance',
    champDate: 'autre_le', champCompteur: 'autre_heures',
    champMois: 'autre_tous_les_mois', champCompteurPeriode: 'autre_toutes_les_heures', champLibelle: 'autre_libelle',
    moisSuggere: null, compteurSuggere: null, prevenirJours: 21, prevenirCompteur: 50,
  },
] as const satisfies readonly DefEcheanceMateriel[]);

export const MATERIELS: readonly DefMateriel[] = Object.freeze([
  {
    sorte: 'vehicule', unite: 'km',
    libelleCompteur: 'Kilométrage', libelleReleve: 'Relever le kilométrage', champCompteur: 'kilometrage', champCompteurLe: 'kilometrage_le',
    champIdentifiant: 'immatriculation',
    champPrevenirJours: 'prevenir_jours', champPrevenirCompteur: 'prevenir_km',
    prevenirJoursMax: 365, prevenirCompteurMax: 50_000, compteurMax: 5_000_000,
    echeances: ECHEANCES_VEHICULE,
  },
  {
    sorte: 'engin', unite: 'h',
    libelleCompteur: 'Heures de service', libelleReleve: 'Relever les heures de service', champCompteur: 'heures', champCompteurLe: 'heures_le',
    champIdentifiant: 'numero_parc',
    champPrevenirJours: 'prevenir_jours', champPrevenirCompteur: 'prevenir_heures',
    prevenirJoursMax: 365, prevenirCompteurMax: 5_000, compteurMax: 200_000,
    echeances: ECHEANCES_ENGIN,
  },
] as const satisfies readonly DefMateriel[]);

export const defSorte = (sorte: SorteMateriel): DefMateriel => MATERIELS.find((m) => m.sorte === sorte) as DefMateriel;

/**
 * La sorte d'un objet, lue sur l'IDENTIFIANT de son type : un type qui parle d'engin se compte en heures de service,
 * un type qui parle de véhicule se compte en kilomètres. Le libellé, lui, reste libre (« Camion », « Mini-pelle »…).
 */
export function sorteMateriel(o: ObjetMetier): SorteMateriel | null {
  if (o.famille !== 'ressource') return null;
  if (/engin/i.test(o.type)) return 'engin';
  return /v[eé]hicule/i.test(o.type) ? 'vehicule' : null;
}

/** La sorte de matériel d'un objet, avec son compteur et ses échéances ; null s'il n'est pas suivi. */
export function defMateriel(o: ObjetMetier): DefMateriel | null {
  const sorte = sorteMateriel(o);
  return sorte === null ? null : defSorte(sorte);
}

/** Vrai pour un matériel que ce module suit : un véhicule ou un engin. */
export const estMaterielSuivi = (o: ObjetMetier): boolean => sorteMateriel(o) !== null;

export const defEcheance = (m: DefMateriel, id: string): DefEcheanceMateriel | undefined => m.echeances.find((d) => d.id === id);
export const defParNature = (m: DefMateriel, nature: string): DefEcheanceMateriel | undefined => m.echeances.find((d) => d.nature === nature);

/** Toutes les natures d'échéance, toutes sortes confondues : ce que le champ « Nature » d'un historique accepte. */
export const NATURES = Object.freeze([...new Set(MATERIELS.flatMap((m) => m.echeances.map((d) => d.nature)))]);

/** Type d'objet qui garde ce qui a été fait sur un matériel (famille « evenement »). */
export const TYPE_ENTRETIEN = 'entretien_vehicule';

/** Au-delà, un compteur saisi à la main ne dit plus grand-chose : on le redemande (indicatif). */
export const JOURS_COMPTEUR_PERIME = 90;

const JOUR = 86_400_000;

const nombre = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const entierPositif = (x: unknown): number | null => { const n = nombre(x); return n !== null && n > 0 ? Math.round(n) : null; };
const jourDe = (x: unknown): string | null => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? x.slice(0, 10) : null);

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
/** Le plus pressant des deux états (date et compteur). */
export const pireEtat = (a: EtatEcheance, b: EtatEcheance): EtatEcheance => (RANG_ETAT[a] <= RANG_ETAT[b] ? a : b);

export interface EcheanceMateriel {
  id: string;
  /** Intitulé affiché : celui de l'entreprise pour l'échéance libre, sinon celui par défaut. */
  libelle: string;
  date: string | null;
  /** La prochaine fois, au compteur (dans l'unité du matériel). */
  compteur: number | null;
  joursRestants: number | null;
  compteurRestant: number | null;
  prevenirJours: number;
  prevenirCompteur: number | null;
  /** Répétition enregistrée sur la fiche (null : rien n'a été dit). */
  periodeMois: number | null;
  periodeCompteur: number | null;
  /** Répétition proposée à défaut, indicative. */
  moisSuggere: number | null;
  compteurSuggere: number | null;
  /** État d'usure du moment, quand le champ existe (pneus). */
  etat: string | null;
  statut: EtatEcheance;
  /** Ce qui sera programmé par « C'est fait » aujourd'hui, au compteur connu. */
  suivante: { date: string | null; compteur: number | null };
  /** Champs du matériel à écrire pour la renseigner : l'écran modifie la fiche sans connaître cette table. */
  champs: { date: string; compteur: string | null; mois: string; compteurPeriode: string | null; libelle: string | null };
}

/** Compteur d'un matériel, son unité, et depuis quand on le sait. */
export interface CompteurMateriel {
  valeur: number | null;
  unite: UniteCompteur;
  /** Intitulé du compteur sur cette sorte de matériel (« Kilométrage », « Heures de service »). */
  libelle: string;
  /** L'action qui le relève, écrite d'avance : « Relever le kilométrage », « Relever les heures de service ». */
  releve: string;
  le: string | null;
  jours: number | null;
  /** Trop vieux pour qu'une échéance au compteur veuille dire quelque chose. */
  perime: boolean;
}

export function compteurDe(v: ObjetMetier, maintenant: Date, m = defMateriel(v) ?? defSorte('vehicule')): CompteurMateriel {
  const valeur = nombre(v.champs[m.champCompteur]);
  const le = jourDe(v.champs[m.champCompteurLe]);
  const jours = le ? joursEntre(le, jourIso(maintenant)) : null;
  return { valeur, unite: m.unite, libelle: m.libelleCompteur, releve: m.libelleReleve, le, jours, perime: valeur === null || jours === null || jours > JOURS_COMPTEUR_PERIME };
}

/** Préavis en jours choisi sur la fiche, sinon celui de la nature d'échéance. */
export const prevenanceDe = (v: ObjetMetier, m: DefMateriel, d: DefEcheanceMateriel): number => {
  const propre = entierPositif(v.champs[m.champPrevenirJours]);
  return propre !== null && propre <= m.prevenirJoursMax ? propre : d.prevenirJours;
};

/**
 * Préavis au compteur choisi sur la fiche, sinon celui de la nature d'échéance — du même geste que le préavis en
 * jours : un seul nombre sur la fiche vaut pour toutes ses échéances au compteur.
 */
export const prevenanceCompteurDe = (v: ObjetMetier, m: DefMateriel, d: DefEcheanceMateriel): number | null => {
  const propre = entierPositif(v.champs[m.champPrevenirCompteur]);
  return propre !== null && propre <= m.prevenirCompteurMax ? propre : d.prevenirCompteur;
};

function statutDate(date: string | null, jours: number | null, prevenir: number): EtatEcheance {
  if (date === null || jours === null) return 'absente';
  if (jours < 0) return 'depassee';
  if (jours === 0) return 'aujourdhui';
  return jours <= prevenir ? 'bientot' : 'ok';
}

function statutCompteur(compteur: number | null, restant: number | null, prevenir: number | null): EtatEcheance {
  if (compteur === null || restant === null) return 'absente';
  if (restant <= 0) return 'depassee';
  return prevenir !== null && restant <= prevenir ? 'bientot' : 'ok';
}

/**
 * Les échéances d'un matériel, dans l'ordre de sa table, avec leur état du jour. `toutes: true` garde aussi celles
 * qui n'ont ni date ni compteur (l'écran les propose à remplir) ; sinon on ne rend que ce qui est renseigné.
 */
export function echeancesDe(v: ObjetMetier, maintenant: Date, { toutes = false } = {}): EcheanceMateriel[] {
  const m = defMateriel(v);
  if (!m) return [];
  const aujourdhui = jourIso(maintenant);
  const courant = compteurDe(v, maintenant, m);
  const res: EcheanceMateriel[] = [];
  for (const d of m.echeances) {
    const date = jourDe(v.champs[d.champDate]);
    const compteur = d.champCompteur ? nombre(v.champs[d.champCompteur]) : null;
    const nomLibre = d.champLibelle && typeof v.champs[d.champLibelle] === 'string' ? String(v.champs[d.champLibelle]).trim() : '';
    if (!toutes && date === null && compteur === null && !nomLibre) continue;
    const periodeMois = entierPositif(v.champs[d.champMois]);
    const periodeCompteur = d.champCompteurPeriode ? entierPositif(v.champs[d.champCompteurPeriode]) : null;
    const prevenirJours = prevenanceDe(v, m, d);
    const prevenirCompteur = prevenanceCompteurDe(v, m, d);
    const joursRestants = date ? joursEntre(aujourdhui, date) : null;
    const compteurRestant = compteur !== null && courant.valeur !== null ? compteur - courant.valeur : null;
    const mois = periodeMois ?? d.moisSuggere;
    const pas = periodeCompteur ?? d.compteurSuggere;
    res.push({
      id: d.id,
      libelle: nomLibre || d.libelle,
      date, compteur, joursRestants, compteurRestant, prevenirJours, prevenirCompteur,
      periodeMois, periodeCompteur, moisSuggere: d.moisSuggere, compteurSuggere: d.compteurSuggere,
      etat: d.champEtat && typeof v.champs[d.champEtat] === 'string' ? String(v.champs[d.champEtat]) : null,
      statut: pireEtat(statutDate(date, joursRestants, prevenirJours), statutCompteur(compteur, compteurRestant, prevenirCompteur)),
      suivante: {
        date: mois !== null ? ajouterMois(aujourdhui, mois) : null,
        compteur: pas !== null && courant.valeur !== null ? courant.valeur + pas : null,
      },
      champs: { date: d.champDate, compteur: d.champCompteur ?? null, mois: d.champMois, compteurPeriode: d.champCompteurPeriode ?? null, libelle: d.champLibelle ?? null },
    });
  }
  return res;
}

/** La prochaine fois, après une intervention faite le `faitLe` à `faitCompteur` au compteur. */
export function prochaineOccurrence(
  v: ObjetMetier,
  m: DefMateriel,
  d: DefEcheanceMateriel,
  faitLe: string,
  faitCompteur: number | null,
): { date: string | null; compteur: number | null } {
  const mois = entierPositif(v.champs[d.champMois]) ?? d.moisSuggere;
  const pas = d.champCompteurPeriode ? entierPositif(v.champs[d.champCompteurPeriode]) ?? d.compteurSuggere : null;
  return {
    date: mois !== null ? ajouterMois(faitLe, mois) : null,
    compteur: pas !== null && faitCompteur !== null ? Math.round(faitCompteur + pas) : null,
  };
}

/**
 * Ce que « C'est fait » écrit sur la fiche du matériel : la prochaine fois (date et compteur), et le compteur relevé
 * à cette occasion. Rend les champs à changer ; `null` efface une date qu'on ne sait pas reprogrammer.
 */
export function champsApresFait(
  v: ObjetMetier,
  m: DefMateriel,
  d: DefEcheanceMateriel,
  faitLe: string,
  faitCompteur: number | null,
): Record<string, string | number | null> {
  const suite = prochaineOccurrence(v, m, d, faitLe, faitCompteur);
  const champs: Record<string, string | number | null> = { [d.champDate]: suite.date };
  if (d.champCompteur) champs[d.champCompteur] = suite.compteur;
  if (faitCompteur !== null) {
    const actuel = nombre(v.champs[m.champCompteur]);
    if (actuel === null || faitCompteur >= actuel) { champs[m.champCompteur] = Math.round(faitCompteur); champs[m.champCompteurLe] = faitLe; }
  }
  return champs;
}

/** Une ligne d'historique : ce qui a été fait sur ce matériel. */
export interface LigneEntretien {
  id: string;
  nom: string;
  echeance: string | null;
  libelle: string;
  faitLe: string | null;
  /** Le compteur relevé ce jour-là, dans l'unité du matériel. */
  compteur: number | null;
  cout: number | null;
}

/** L'historique d'un matériel, le plus récent d'abord. */
export function historiqueDe(objets: readonly ObjetMetier[], materiel: ObjetMetier): LigneEntretien[] {
  const m = defMateriel(materiel);
  if (!m) return [];
  return objets
    .filter((o) => o.type === TYPE_ENTRETIEN && o.champs.concerne === materiel.id)
    .map((o) => {
      const nature = typeof o.champs.echeance === 'string' ? o.champs.echeance : null;
      return {
        id: o.id, nom: o.nom, echeance: nature === null ? null : defParNature(m, nature)?.id ?? null,
        libelle: o.nom,
        faitLe: jourDe(o.champs.fait_le), compteur: nombre(o.champs[m.champCompteur]), cout: nombre(o.champs.cout),
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

/** « 1 200 kilomètres », « 50 heures » : jamais un chiffre tout seul, jamais une unité abrégée dans une phrase. */
export const quantiteCompteur = (n: number, unite: UniteCompteur): string => (unite === 'h' ? pluriel(n, 'heure', 'heures') : pluriel(n, 'kilomètre', 'kilomètres'));

/**
 * Situations d'un matériel que les règles d'échéance de l'univers ne couvrent pas :
 * - une échéance au COMPTEUR atteinte ou proche ;
 * - un compteur trop vieux alors que le matériel a au moins une échéance au compteur.
 * Les échéances par DATE restent évaluées par `evaluerEcheance` (règles déclarées dans l'univers).
 */
export function situationsMateriel(v: ObjetMetier, responsable: string | null, ctx: ContexteRegle): Situation[] {
  const m = defMateriel(v);
  if (!m) return [];
  const res: Situation[] = [];
  const compteur = compteurDe(v, ctx.maintenant, m);
  const f = fraicheur(compteur.le, ctx.maintenant, ctx.ageMaxMs);
  const preuve = (valeur: number | null, seuil: number | null) => ({
    valeur, seuil, source: v.source, observeLe: compteur.le, provenance: v.provenance, fraicheur: f,
  });
  const echeances = echeancesDe(v, ctx.maintenant).filter((x) => x.compteur !== null);
  for (const x of echeances) {
    if (compteur.valeur === null || x.compteurRestant === null) continue;
    const base = { objetId: v.id, regle: `materiel_compteur_${x.id}`, responsable };
    if (x.compteurRestant <= 0) {
      res.push({
        ...base, gravite: 'critique', statut: compteur.perime ? 'a_verifier' : 'ouverte',
        description: `${x.libelle} : seuil du compteur dépassé de ${quantiteCompteur(-x.compteurRestant, m.unite)}`,
        preuve: preuve(-x.compteurRestant, 0),
      });
      continue;
    }
    if (x.prevenirCompteur !== null && x.compteurRestant <= x.prevenirCompteur) {
      res.push({
        ...base, gravite: 'attention', statut: compteur.perime ? 'a_verifier' : 'ouverte',
        description: `${x.libelle} : dans ${quantiteCompteur(x.compteurRestant, m.unite)}`,
        preuve: preuve(-x.compteurRestant, 0),
      });
    }
  }
  // un compteur trop vieux : les échéances au compteur ne veulent plus rien dire tant qu'il n'est pas relevé
  if (echeances.length && compteur.perime) {
    res.push({
      objetId: v.id, regle: 'materiel_compteur', responsable, gravite: 'attention', statut: 'a_verifier',
      // tourné avec des noms : « Kilométrage » est masculin, « Heures de service » féminin pluriel, rien ne s'accorde
      description: compteur.valeur === null
        ? `${m.libelleCompteur} : aucun relevé, les échéances au compteur ne peuvent pas être suivies`
        : `${m.libelleCompteur} : dernier relevé il y a ${pluriel(compteur.jours ?? 0, 'jour', 'jours')}, à mettre à jour`,
      preuve: preuve(compteur.jours, JOURS_COMPTEUR_PERIME),
    });
  }
  return res;
}

/** Toutes les situations de compteur d'un ensemble d'objets. */
export function situationsMateriels(
  objets: readonly ObjetMetier[],
  responsableDe: (o: ObjetMetier) => string | null,
  ctx: ContexteRegle,
): Situation[] {
  return objets.filter(estMaterielSuivi).flatMap((v) => situationsMateriel(v, responsableDe(v), ctx));
}
