/**
 * Tâches répétitives DÉCLARÉES par une personne : « est-ce que ça vaut le coup de l'automatiser ? »
 * À côté de ce que le jeu détecte dans les données (optimisations.ts), ce que quelqu'un sait de son travail : une
 * tâche, le temps gagné à chaque fois, sa fréquence, le temps qu'il faudrait pour l'automatiser, et trois réponses sur
 * le risque. Calcul pur : rien n'est lu dans les données de l'entreprise, rien n'est envoyé.
 *
 * Tout est compté en temps de TRAVAIL : une année = 228 jours, 45,6 semaines et 11 mois travaillés. Le temps passé à
 * automatiser, lui, se regagne semaine après semaine du calendrier (52,18 par an). Chaque chiffre rendu porte son
 * explication, écrite avec les chiffres de la personne (jamais un nombre sans son calcul).
 */
import { mesure, nombreFr, pluriel } from './texte.ts';

export const JOURS_TRAVAILLES = 228;
export const SEMAINES_TRAVAILLEES = 45.6;
export const MOIS_TRAVAILLES = 11;
/** Semaines du calendrier dans une année (délai de rentabilité). */
export const SEMAINES_CALENDRIER = 52.18;
/** Une journée de travail passée à automatiser. */
export const HEURES_PAR_JOUR = 7;
/** Durée sur laquelle on compte, en années (réglable de 1 à 5). */
export const HORIZON_DEFAUT = 5;
export const HORIZON_MAX = 5;
export const TACHES_MAX = 100;
export const NOM_MAX = 120;
export const QUI_MAX = 80;
/** Plus grande valeur acceptée pour un temps ou un nombre de fois (dans son unité). */
export const VALEUR_MAX = 1000;

export const UNITES_TEMPS = ['secondes', 'minutes', 'heures'] as const;
export const PERIODES = ['jour', 'semaine', 'mois', 'an'] as const;
export const UNITES_AUTOMATISER = ['minutes', 'heures', 'jours'] as const;
/** « Est-elle toujours faite de la même façon ? » : oui · le plus souvent · ça change souvent. */
export const MEME_FACON = ['oui', 'souvent', 'variable'] as const;
/** « Y a-t-il des cas particuliers ? » */
export const CAS_PARTICULIERS = ['rarement', 'parfois', 'souvent'] as const;
/** « Si l'automatisation se trompe, est-ce grave ? » : sans gravité · gênant · grave (argent, client, sécurité). */
export const GRAVITES = ['sans_gravite', 'genante', 'grave'] as const;

export type UniteTemps = (typeof UNITES_TEMPS)[number];
export type Periode = (typeof PERIODES)[number];
export type UniteAutomatiser = (typeof UNITES_AUTOMATISER)[number];
export type MemeFacon = (typeof MEME_FACON)[number];
export type CasParticuliers = (typeof CAS_PARTICULIERS)[number];
export type Gravite = (typeof GRAVITES)[number];

/** Ce que la personne déclare. */
export interface SaisieTache {
  nom: string;
  /** Qui la fait, en texte libre ; vide si non précisé ou si `personne` est renseignée. */
  qui: string;
  /** Ou une personne de l'entreprise (identifiant de sa fiche ; son existence est vérifiée par l'appelant). */
  personne: string | null;
  /** Temps gagné à chaque fois, dans `uniteTemps`. */
  tempsGagne: number;
  uniteTemps: UniteTemps;
  /** Nombre de fois par `periode`. */
  fois: number;
  periode: Periode;
  /** Temps qu'il faudrait pour l'automatiser, dans `uniteAutomatiser` (un jour = 7 h). */
  tempsAutomatiser: number;
  uniteAutomatiser: UniteAutomatiser;
  memeFacon: MemeFacon;
  casParticuliers: CasParticuliers;
  graviteErreur: Gravite;
  /** Automatisation existante qui fait déjà cette tâche (« celle-ci le fait déjà »), ou null. */
  recette: string | null;
}

export type Verdict = 'gain_trop_faible' | 'pas_rentable' | 'a_automatiser' | 'a_automatiser_en_validant' | 'a_planifier' | 'petit_gain';

export interface CalculTache {
  /** Nombre de fois par an, en temps de travail. */
  foisParAn: number;
  /** Heures gagnées par an. */
  heuresAn: number;
  /** Heures gagnées par semaine du calendrier (heuresAn ÷ 52,18). */
  heuresSemaine: number;
  /** Temps pour automatiser, en heures. */
  heuresAutomatiser: number;
  /** Délai de rentabilité : semaines du calendrier pour regagner le temps passé à automatiser. */
  rentabiliteSemaines: number;
  horizonAns: number;
  /** Heures gagnées sur la durée comptée, temps d'automatisation déduit (négatif : on y perd). */
  heuresHorizon: number;
  euroAn: number;
  euroHorizon: number;
  /** Erreur grave, cas particuliers fréquents ou façon de faire qui change souvent. */
  risquee: boolean;
  /** Les raisons du risque, en clair (vide si la tâche n'est pas risquée). */
  risques: string[];
  verdict: Verdict;
  /** Le verdict en clair : « À automatiser », « Pas rentable sur 5 ans »… */
  libelle: string;
  /** Sa raison, en une phrase, avec les chiffres de la personne. */
  raison: string;
  /** Le temps gagné par an en clair : « 57 h », « 45 min ». */
  tempsAn: string;
  /** Le délai de rentabilité en clair : « environ 3 mois ». */
  delai: string;
  /** Le bilan sur la durée comptée en clair, temps d'automatisation déduit : « 281 h », « −4 h ». */
  tempsHorizon: string;
  /** Comment chaque chiffre a été calculé. */
  explications: { temps: string; rentabilite: string; euros: string; horizon: string };
  /** Total invraisemblable (plus qu'un temps plein) : invite à vérifier les chiffres saisis ; null sinon. */
  aVerifier: string | null;
}

/** Saisie refusée : `champ` dit lequel, le message dit quoi corriger. */
export class ErreurTache extends Error {
  readonly champ: string;
  constructor(champ: string, message: string) {
    super(message);
    this.champ = champ;
  }
}

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Texte libre sur une ligne : caractères de contrôle retirés, espaces regroupés. */
const uneLigne = (t: string): string => t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
const parmi = <T extends string>(liste: readonly T[], x: unknown, champ: string): T => {
  if (typeof x !== 'string' || !(liste as readonly string[]).includes(x)) throw new ErreurTache(champ, 'Choisissez une des réponses proposées.');
  return x as T;
};
/** Identifiant facultatif : null si absent ou vide, `undefined` si ce n'est pas un texte. */
const identifiant = (x: unknown): string | null | undefined => (x === null || x === undefined || x === '' ? null : typeof x === 'string' ? x : undefined);
const positif = (x: unknown, champ: string, libelle: string): number => {
  const v = typeof x === 'number' && Number.isFinite(x) ? Math.round(x * 100) / 100 : Number.NaN;
  if (!(v > 0) || v > VALEUR_MAX) throw new ErreurTache(champ, `${libelle} : un nombre plus grand que 0, ${nombreFr(VALEUR_MAX)} au plus.`);
  return v;
};

/**
 * Lit et contrôle une déclaration (tailles, nombres, réponses). `recettes` : identifiants des automatisations
 * existantes qu'on a le droit d'attacher. Lève `ErreurTache` au premier champ refusé.
 */
export function lireSaisie(x: unknown, recettes: ReadonlySet<string>): SaisieTache {
  if (!estObj(x)) throw new ErreurTache('nom', 'Déclaration illisible.');
  const nom = typeof x.nom === 'string' ? uneLigne(x.nom) : '';
  if (!nom || nom.length > NOM_MAX) throw new ErreurTache('nom', `Donnez un nom à la tâche (${NOM_MAX} caractères au plus).`);
  const personne = identifiant(x.personne);
  if (personne === undefined || (personne !== null && !/^[\w:.-]{1,80}$/.test(personne))) throw new ErreurTache('qui', 'Cette personne est introuvable.');
  if (x.qui !== undefined && x.qui !== null && typeof x.qui !== 'string') throw new ErreurTache('qui', 'Qui la fait : écrivez un nom ou un rôle.');
  const qui = personne === null && typeof x.qui === 'string' ? uneLigne(x.qui) : '';
  if (qui.length > QUI_MAX) throw new ErreurTache('qui', `Qui la fait : ${QUI_MAX} caractères au plus.`);
  const tempsGagne = positif(x.tempsGagne, 'tempsGagne', 'Temps gagné à chaque fois');
  const uniteTemps = parmi(UNITES_TEMPS, x.uniteTemps, 'tempsGagne');
  if (typeof x.fois !== 'number' || !Number.isInteger(x.fois) || x.fois < 1 || x.fois > VALEUR_MAX) throw new ErreurTache('fois', `Nombre de fois : un nombre entier entre 1 et ${nombreFr(VALEUR_MAX)}.`);
  const periode = parmi(PERIODES, x.periode, 'fois');
  const tempsAutomatiser = positif(x.tempsAutomatiser, 'tempsAutomatiser', 'Temps pour l’automatiser');
  const uniteAutomatiser = parmi(UNITES_AUTOMATISER, x.uniteAutomatiser, 'tempsAutomatiser');
  const recette = identifiant(x.recette);
  if (recette === undefined || (recette !== null && !recettes.has(recette))) throw new ErreurTache('recette', 'Cette automatisation n’existe pas.');
  return {
    nom, qui, personne, tempsGagne, uniteTemps, fois: x.fois, periode, tempsAutomatiser, uniteAutomatiser,
    memeFacon: parmi(MEME_FACON, x.memeFacon, 'memeFacon'),
    casParticuliers: parmi(CAS_PARTICULIERS, x.casParticuliers, 'casParticuliers'),
    graviteErreur: parmi(GRAVITES, x.graviteErreur, 'graviteErreur'),
    recette,
  };
}

/** Durée sur laquelle on compte : entier de 1 à 5 ans, sinon la valeur par défaut (5). */
export const lireHorizon = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && x >= 1 && x <= HORIZON_MAX ? x : HORIZON_DEFAUT);

const SECONDES: Readonly<Record<UniteTemps, number>> = { secondes: 1, minutes: 60, heures: 3600 };
const ABREGE: Readonly<Record<UniteTemps, string>> = { secondes: 's', minutes: 'min', heures: 'h' };
const FOIS_PAR_AN: Readonly<Record<Periode, number>> = { jour: JOURS_TRAVAILLES, semaine: SEMAINES_TRAVAILLEES, mois: MOIS_TRAVAILLES, an: 1 };
const HEURES: Readonly<Record<UniteAutomatiser, number>> = { minutes: 1 / 60, heures: 1, jours: HEURES_PAR_JOUR };
/** Les erreurs d'arrondi des nombres à virgule ne doivent jamais faire basculer un seuil (15 h tout rond reste 15 h). */
const net = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Une durée en clair : « 45 min », « 5,5 h », « 120 h » (une décimale sous 100 h, pour que les calculs se recoupent). */
export function duree(heures: number): string {
  const h = Math.abs(heures);
  const minutes = Math.round(h * 60);
  if (h * 60 < 1) return 'moins d’une minute';
  if (minutes < 60) return mesure(minutes, 'min');
  return mesure(h < 100 ? Math.round(h * 10) / 10 : Math.round(h), 'h');
}

/** Un délai de rentabilité en clair : « moins d'une semaine », « 6 semaines », « environ 7 mois », « environ 2,5 ans ». */
export function delai(semaines: number): string {
  if (semaines < 1) return 'moins d’une semaine';
  if (semaines < 8.5) return pluriel(Math.round(semaines), 'semaine', 'semaines');
  const mois = Math.round(semaines / (SEMAINES_CALENDRIER / 12));
  if (mois < 12) return `environ ${mesure(mois, 'mois')}`;
  return `environ ${mesure(Math.round((semaines / SEMAINES_CALENDRIER) * 10) / 10, 'ans')}`;
}

const enumerer = (l: readonly string[]): string => (l.length < 2 ? l.join('') : `${l.slice(0, -1).join(', ')} et ${l.at(-1)}`);

/**
 * Le verdict d'une tâche déclarée, avec sa raison et le calcul de chaque chiffre.
 * - moins d'1 h par an → gain trop faible ;
 * - temps d'automatisation regagné après la durée comptée → pas rentable sur N ans ;
 * - au moins 15 h par an, regagné en 26 semaines au plus → à automatiser (« vous validez chaque envoi » si risquée) ;
 * - au moins 5 h par an, regagné en 52 semaines au plus → intéressant, à planifier ;
 * - sinon → petit gain, pas prioritaire.
 */
export function calculerTache(s: SaisieTache, o: { tauxHoraire: number; horizonAns: number }): CalculTache {
  const horizonAns = lireHorizon(o.horizonAns);
  const foisParAn = net(s.fois * FOIS_PAR_AN[s.periode]);
  const heuresAn = net(((s.tempsGagne * SECONDES[s.uniteTemps]) / 3600) * foisParAn);
  const heuresSemaine = heuresAn / SEMAINES_CALENDRIER;
  const heuresAutomatiser = net(s.tempsAutomatiser * HEURES[s.uniteAutomatiser]);
  const rentabiliteSemaines = net(heuresAutomatiser / heuresSemaine);
  const heuresHorizon = net(heuresAn * horizonAns - heuresAutomatiser);

  const risques = [
    s.graviteErreur === 'grave' ? 'une erreur serait grave' : null,
    s.casParticuliers === 'souvent' ? 'les cas particuliers sont fréquents' : null,
    s.memeFacon === 'variable' ? 'la façon de faire change souvent' : null,
  ].filter((r): r is string => r !== null);
  const risquee = risques.length > 0;

  const verdict: Verdict = heuresAn < 1 ? 'gain_trop_faible'
    : rentabiliteSemaines > net(horizonAns * SEMAINES_CALENDRIER) ? 'pas_rentable'
    : heuresAn >= 15 && rentabiliteSemaines <= 26 ? (risquee ? 'a_automatiser_en_validant' : 'a_automatiser')
    : heuresAn >= 5 && rentabiliteSemaines <= 52 ? 'a_planifier'
    : 'petit_gain';

  const parAn = `${duree(heuresAn)} par an`;
  const enDelai = delai(rentabiliteSemaines);
  const surHorizon = pluriel(horizonAns, 'an', 'ans');
  const libelle = {
    gain_trop_faible: 'Gain trop faible',
    pas_rentable: `Pas rentable sur ${surHorizon}`,
    a_automatiser: 'À automatiser',
    a_automatiser_en_validant: 'À automatiser, vous validez chaque envoi',
    a_planifier: 'Intéressant, à planifier',
    petit_gain: 'Petit gain, pas prioritaire',
  }[verdict];
  const raison = {
    gain_trop_faible: `Cette tâche ne vous prend que ${parAn} : l’automatiser ne changerait presque rien.`,
    pas_rentable: `Il faudrait ${enDelai} pour regagner le temps passé à l’automatiser (${duree(heuresAutomatiser)}) : c’est plus que ${horizonAns > 1 ? `les ${surHorizon} sur lesquels` : 'l’année sur laquelle'} vous comptez.`,
    a_automatiser: `Vous gagnez ${parAn}, et le temps passé à l’automatiser est regagné en ${enDelai}.`,
    a_automatiser_en_validant: `Le gain est là (${parAn}, automatisation regagnée en ${enDelai}), mais ${enumerer(risques)} : l’automatisation prépare, et vous validez chaque envoi.`,
    a_planifier: heuresAn >= 15
      ? `Vous gagnez ${parAn}, mais il faut ${enDelai} pour regagner le temps passé à l’automatiser : à planifier, sans urgence.`
      : `Le gain reste modeste (${parAn}), et l’automatisation est regagnée en ${enDelai} : à planifier, sans urgence.`,
    petit_gain: heuresAn < 5
      ? `Vous ne gagnez que ${parAn} : d’autres tâches rapporteront plus, commencez par elles.`
      : `Il faut ${enDelai} pour regagner le temps passé à l’automatiser : rentable à la longue, mais pas prioritaire.`,
  }[verdict];

  const euroAn = Math.round(heuresAn * o.tauxHoraire);
  const euroHorizon = Math.round(heuresHorizon * o.tauxHoraire);
  const aChaqueFois = mesure(s.tempsGagne, ABREGE[s.uniteTemps]);
  const combienDeFois = `${pluriel(s.fois, 'fois', 'fois')} par ${s.periode}`;
  const annee = {
    jour: ` × ${JOURS_TRAVAILLES} jours travaillés par an`,
    semaine: ` × ${nombreFr(SEMAINES_TRAVAILLEES)} semaines travaillées par an`,
    mois: ` × ${MOIS_TRAVAILLES} mois travaillés par an`,
    an: '',
  }[s.periode];
  const saisiAutomatiser = s.uniteAutomatiser === 'jours'
    ? `${pluriel(s.tempsAutomatiser, 'jour', 'jours')} de ${HEURES_PAR_JOUR} h, soit ${duree(heuresAutomatiser)}`
    : duree(heuresAutomatiser);
  const produit = horizonAns > 1 ? `${horizonAns} × ${duree(heuresAn)}` : duree(heuresAn);
  const explications = {
    temps: `${aChaqueFois} × ${combienDeFois}${annee} = ${parAn}.`,
    rentabilite: `Temps pour l’automatiser : ${saisiAutomatiser}. Temps gagné par semaine : ${duree(heuresSemaine)} (${parAn} ÷ ${nombreFr(SEMAINES_CALENDRIER)} semaines). ${duree(heuresAutomatiser)} ÷ ${duree(heuresSemaine)} = ${enDelai}.`,
    euros: `${duree(heuresAn)} × ${mesure(o.tauxHoraire, '€')} de l’heure (votre coût horaire) = ${mesure(euroAn, '€')} par an.`,
    horizon: heuresHorizon >= 0
      ? `Sur ${surHorizon} : ${produit} − ${duree(heuresAutomatiser)} pour l’automatiser = ${duree(heuresHorizon)}, soit ${mesure(euroHorizon, '€')}.`
      : `Sur ${surHorizon} : ${produit} − ${duree(heuresAutomatiser)} pour l’automatiser : il manquerait ${duree(heuresHorizon)} pour regagner ce temps.`,
  };
  const tempsPlein = JOURS_TRAVAILLES * HEURES_PAR_JOUR;
  const aVerifier = heuresAn > tempsPlein
    ? `${duree(heuresAn)} par an, c’est plus qu’un temps plein (${duree(tempsPlein)}) : vérifiez vos chiffres, ou comptez-vous plusieurs personnes ?`
    : null;

  return { foisParAn, heuresAn, heuresSemaine, heuresAutomatiser, rentabiliteSemaines, horizonAns, heuresHorizon, euroAn, euroHorizon, risquee, risques, verdict, libelle, raison,
    tempsAn: duree(heuresAn), delai: enDelai, tempsHorizon: `${heuresHorizon < 0 ? '−' : ''}${duree(heuresHorizon)}`, explications, aVerifier };
}

/** Rang d'affichage : ce qui vaut le plus le coup d'abord (« à automatiser », avec ou sans validation, au même rang). */
export const RANG_VERDICT: Readonly<Record<Verdict, number>> = { a_automatiser: 0, a_automatiser_en_validant: 0, a_planifier: 1, petit_gain: 2, pas_rentable: 3, gain_trop_faible: 4 };

/** Une idée de départ : une déclaration à choisir puis à ajuster (les chiffres sont des exemples, jamais une mesure). */
export type IdeeTache = Omit<SaisieTache, 'qui' | 'personne'> & { id: string };

/**
 * Idées de départ UNIVERSELLES (factures, devis, planning, suivi des clients, stock, courrier…) : valables dans tout
 * secteur, jamais liées à un métier. `recette` : l'automatisation existante qui fait déjà la tâche, quand il y en a
 * une — le temps « pour l'automatiser » est alors celui de la mettre en marche et de vérifier. Noms courts : ils
 * tiennent dans un bouton, même sur un téléphone.
 */
export const IDEES: readonly IdeeTache[] = [
  { id: 'relancer-factures', nom: 'Relancer les factures en retard', tempsGagne: 10, uniteTemps: 'minutes', fois: 3, periode: 'semaine', tempsAutomatiser: 30, uniteAutomatiser: 'minutes', memeFacon: 'oui', casParticuliers: 'parfois', graviteErreur: 'genante', recette: 'relance-factures' },
  { id: 'relancer-devis', nom: 'Relancer les devis sans réponse', tempsGagne: 10, uniteTemps: 'minutes', fois: 3, periode: 'semaine', tempsAutomatiser: 30, uniteAutomatiser: 'minutes', memeFacon: 'souvent', casParticuliers: 'parfois', graviteErreur: 'genante', recette: 'relance-devis' },
  { id: 'preparer-factures', nom: 'Préparer les factures à la livraison', tempsGagne: 15, uniteTemps: 'minutes', fois: 5, periode: 'semaine', tempsAutomatiser: 1, uniteAutomatiser: 'heures', memeFacon: 'oui', casParticuliers: 'parfois', graviteErreur: 'grave', recette: 'facturer-livraisons' },
  { id: 'reapprovisionner', nom: 'Commander ce qui manque en stock', tempsGagne: 25, uniteTemps: 'minutes', fois: 2, periode: 'semaine', tempsAutomatiser: 1, uniteAutomatiser: 'heures', memeFacon: 'souvent', casParticuliers: 'parfois', graviteErreur: 'genante', recette: 'reappro-stock' },
  { id: 'demander-avis', nom: 'Demander leur avis aux clients', tempsGagne: 5, uniteTemps: 'minutes', fois: 4, periode: 'semaine', tempsAutomatiser: 30, uniteAutomatiser: 'minutes', memeFacon: 'oui', casParticuliers: 'rarement', graviteErreur: 'sans_gravite', recette: 'satisfaction-auto' },
  { id: 'recopier', nom: 'Recopier d’un logiciel à l’autre', tempsGagne: 5, uniteTemps: 'minutes', fois: 6, periode: 'jour', tempsAutomatiser: 1, uniteAutomatiser: 'jours', memeFacon: 'oui', casParticuliers: 'rarement', graviteErreur: 'genante', recette: null },
  { id: 'trier-courrier', nom: 'Trier le courrier et les e-mails', tempsGagne: 4, uniteTemps: 'minutes', fois: 10, periode: 'jour', tempsAutomatiser: 1, uniteAutomatiser: 'jours', memeFacon: 'souvent', casParticuliers: 'parfois', graviteErreur: 'genante', recette: null },
  { id: 'tenir-planning', nom: 'Mettre à jour le planning', tempsGagne: 20, uniteTemps: 'minutes', fois: 3, periode: 'semaine', tempsAutomatiser: 2, uniteAutomatiser: 'jours', memeFacon: 'variable', casParticuliers: 'souvent', graviteErreur: 'genante', recette: null },
];
