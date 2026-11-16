/**
 * UN SEUL MOTEUR DE SUIVI (LB-03, R02). Les échéances de l'entreprise étaient éparpillées dans quatre mécaniques qui
 * faisaient le même travail : le matériel roulant (`vehicules.ts`), les papiers à renouveler, les factures en retard,
 * les devis sans réponse. Quatre calculs, quatre préavis, quatre façons de remonter dans « Aujourd'hui », et quatre
 * occasions de diverger. Ce module les regarde d'un seul endroit.
 *
 * CE QU'IL NE REFAIT PAS. Il ne recalcule aucune situation : les règles d'échéance et de seuil de l'univers
 * (`situation.ts`) et les échéances au compteur (`vehicules.ts`) restent les seules à décider ce qui va mal. Le moteur
 * les LIT, les range par sujet et par étape, et donne à chacune une identité stable. Une cinquième mécanique à côté
 * des quatre autres n'aurait rien unifié.
 *
 * UN SUIVI porte : des ÉTAPES nommées par l'univers, une ÉCHÉANCE par étape, un RESPONSABLE, et parfois un
 * DESTINATAIRE — le client, quand le sujet le concerne. Les étapes viennent de trois endroits, tous déclarés dans
 * l'univers de l'entreprise, jamais écrits en dur ici : les valeurs d'un champ « choix » (le parcours d'un devis),
 * les règles d'échéance qui visent le type (un papier qui expire, une livraison attendue), et les tâches rattachées
 * au suivi (les étapes d'un chantier, telles que l'entreprise les a écrites).
 *
 * QUATRE PORTES, AU CHOIX DE L'ENTREPRISE. Une échéance peut sortir par un rendez-vous dans l'agenda branché, par une
 * tâche dans la liste branchée, par une alerte sur le canal de l'entreprise, ou par une ligne dans « Aujourd'hui ».
 * Les deux dernières portes existent déjà : « Aujourd'hui » lit les situations, et `passerelle/alertes.ts` lit les
 * mêmes situations sous ses propres sujets. Le moteur ne les double pas — il dit laquelle est tenue, et sous quel
 * sujet d'alerte. Les deux premières sont son apport : une échéance du jeu devient un VRAI rendez-vous et une VRAIE
 * tâche dans l'outil que la personne regarde déjà le matin.
 *
 * TOUT EST PUR ICI : aucune lecture de disque, aucun appel, aucune horloge cachée. Ce module décrit ce qui DEVRAIT
 * exister ; `passerelle/suivi.ts` s'occupe de le faire exister sans doublon, et de le retirer quand ce n'est plus dû.
 */
import type { ObjetMetier, ValeurChamp } from './model.ts';
import type { Gravite, Situation } from './situation.ts';
import { casseDePhrase } from './texte.ts';
import { defType, libelleType, type DefChamp, type Univers } from './univers.ts';
import { echeancesDe, estMaterielSuivi, joursEntre, jourIso, quantiteCompteur, type UniteCompteur } from './vehicules.ts';

// ------------------------------------------------------------------ les quatre portes

/** Par où une échéance sort du jeu. L'entreprise choisit, sujet par sujet ; aucune n'est imposée. */
export type Porte = 'agenda' | 'tache' | 'alerte' | 'aujourdhui';

export interface DefPorte {
  id: Porte;
  libelle: string;
  aide: string;
  /** Vrai : cette porte écrit une fiche dans le jeu, qui repart ensuite vers l'outil branché. */
  ecrit: boolean;
}

export const PORTES: readonly DefPorte[] = Object.freeze([
  {
    id: 'agenda', libelle: 'Un rendez-vous dans mon agenda', ecrit: true,
    aide: 'L’échéance devient un rendez-vous. S’il y a un agenda branché, il y part ; sinon il reste dans le planning.',
  },
  {
    id: 'tache', libelle: 'Une tâche dans ma liste', ecrit: true,
    aide: 'L’échéance devient une tâche attribuée au responsable. S’il y a une liste de tâches branchée, elle y part.',
  },
  {
    id: 'alerte', libelle: 'Une alerte sur mon canal', ecrit: false,
    aide: 'Telegram, WhatsApp ou votre service, si un canal est branché et le sujet coché dans Réglages, Alertes.',
  },
  {
    id: 'aujourdhui', libelle: 'Une ligne dans « Aujourd’hui »', ecrit: false,
    aide: 'Dans le jeu, sur l’écran que vous ouvrez en arrivant. Rien ne sort de chez vous.',
  },
].map((p) => Object.freeze(p)) as DefPorte[]);

const IDS_PORTES: ReadonlySet<string> = new Set(PORTES.map((p) => p.id));
/** Tant que l'entreprise n'a rien choisi : la ligne dans « Aujourd'hui », et rien d'autre. Rien ne sort tout seul. */
export const PORTES_DEFAUT: readonly Porte[] = Object.freeze(['aujourdhui']) as readonly Porte[];

/** Portes choisies par l'entreprise, sujet par sujet. Une valeur abîmée revient au défaut, jamais une erreur. */
export type ChoixPortes = Readonly<Record<string, readonly Porte[]>>;

export function portesDe(choix: ChoixPortes | undefined, sujet: string): readonly Porte[] {
  const brut = choix?.[sujet];
  if (!Array.isArray(brut)) return PORTES_DEFAUT;
  const propres = [...new Set(brut.filter((p): p is Porte => IDS_PORTES.has(p)))];
  return propres.length ? Object.freeze(propres) : [];
}

/** Lit des portes reçues du navigateur (ou relues du disque) : on ne garde que ce qui existe. */
export function lirePortes(x: unknown): readonly Porte[] {
  if (!Array.isArray(x)) return [];
  return Object.freeze([...new Set(x.filter((p): p is Porte => typeof p === 'string' && IDS_PORTES.has(p)))]);
}

// ------------------------------------------------------------------ les sujets de suivi

/**
 * Comment les étapes d'un sujet se lisent. Les trois lectures sont déclaratives : ce sont des identifiants de CHAMP
 * (structure), jamais des libellés (vocabulaire). Les mots affichés viennent tous de l'univers.
 */
export type LectureEtapes =
  /** Le parcours est la liste de choix d'un champ (devis : brouillon → envoyé → accepté). */
  | { de: 'parcours'; champ: string; finies: readonly string[] }
  /** Un champ « oui / non » ferme le suivi (facture : payée). */
  | { de: 'drapeau'; champ: string }
  /** Pas de parcours : le suivi est fait d'échéances, chacune une étape (papiers, matériel). */
  | { de: 'echeances' };

export interface DefSujetSuivi {
  /** Identifiant stable, jamais affiché. */
  id: string;
  /** Types de l'univers qui portent ce sujet ; le premier présent le nomme (BTP : « Chantier »). */
  types: readonly string[];
  etapes: LectureEtapes;
  /** Champ date que porte le suivi lui-même, quand l'univers n'en fait pas une règle (chantier, facture). */
  champEcheance?: string;
  /** Préavis de cette échéance-là, en jours, quand aucune règle de l'univers n'en donne un. */
  prevenirJours: number;
  /** Les échéances au compteur de `vehicules.ts` entrent dans ce sujet (matériel roulant). */
  compteur?: boolean;
  /** Les tâches rattachées au suivi (`concerne`) sont ses étapes (un chantier et ses étapes). */
  tachesEtapes?: boolean;
  /**
   * Sujet sous lequel `passerelle/alertes.ts` annonce déjà ces échéances. Il n'est PAS redéfini ici : la porte
   * « alerte » dit seulement où l'entreprise doit cocher, dans Réglages, Alertes.
   */
  alerte: string;
  /** Le client final a le droit de suivre ce sujet-là (son chantier, sa commande, son dossier). */
  pourLeClient?: boolean;
}

/**
 * Les sujets de suivi. L'ordre est celui des écrans : ce que le client attend d'abord, puis ce qui tient l'entreprise.
 * Un sujet dont aucun type n'existe dans l'univers d'une entreprise disparaît simplement de ses écrans.
 *
 * « Garantie et entretien » n'y est pas : voir `SUJETS_HORS_MOTEUR`.
 */
export const SUJETS: readonly DefSujetSuivi[] = Object.freeze([
  {
    id: 'chantier', types: ['projet'], etapes: { de: 'echeances' }, champEcheance: 'echeance',
    prevenirJours: 7, tachesEtapes: true, alerte: 'echeance', pourLeClient: true,
  },
  {
    id: 'devis', types: ['devis'], etapes: { de: 'parcours', champ: 'statut', finies: ['accepté', 'refusé'] },
    prevenirJours: 7, alerte: 'devis_sans_reponse', pourLeClient: true,
  },
  {
    id: 'facture', types: ['facture'], etapes: { de: 'drapeau', champ: 'payee' }, champEcheance: 'echeance',
    prevenirJours: 7, alerte: 'facture_retard',
  },
  {
    id: 'livraison', types: ['commande_client', 'commande_fournisseur'],
    etapes: { de: 'parcours', champ: 'statut', finies: ['livrée', 'facturée', 'reçue'] },
    prevenirJours: 3, alerte: 'commande', pourLeClient: true,
  },
  {
    id: 'materiel', types: ['vehicule', 'engin'], etapes: { de: 'echeances' },
    prevenirJours: 21, compteur: true, alerte: 'echeance',
  },
  {
    id: 'papiers', types: ['document'], etapes: { de: 'echeances' },
    prevenirJours: 30, alerte: 'echeance',
  },
] as const satisfies readonly DefSujetSuivi[]);

/**
 * Ce que le moteur NE couvre pas, dit franchement plutôt que fait à moitié. « Garantie et entretien » demanderait une
 * date de fin de garantie, qu'aucun univers ne déclare aujourd'hui : l'entretien du matériel est déjà le sujet
 * « matériel », et le type « Entretien de matériel » enregistre ce qui a été FAIT, pas ce qui est DÛ. Mieux vaut trois
 * sujets unifiés qu'un moteur qui mentirait sur ce qu'il couvre.
 */
export const SUJETS_HORS_MOTEUR: readonly string[] = Object.freeze(['garantie']);

const PAR_ID: ReadonlyMap<string, DefSujetSuivi> = new Map(SUJETS.map((s) => [s.id, s]));
export const defSujet = (id: string): DefSujetSuivi | undefined => PAR_ID.get(id);

/** Le sujet de suivi d'un objet, d'après son type ; null s'il n'est pas suivi. */
export function sujetDe(o: ObjetMetier): DefSujetSuivi | null {
  return SUJETS.find((s) => s.types.includes(o.type)) ?? null;
}

/** Les sujets qu'une entreprise voit vraiment : ceux dont au moins un type existe dans son univers. */
export function sujetsDeLUnivers(u: Univers): DefSujetSuivi[] {
  return SUJETS.filter((s) => s.types.some((t) => {
    const d = defType(u, t);
    return d !== undefined && d.masque !== true;
  }));
}

/** Le type de l'univers qui nomme ce sujet chez cette entreprise (le premier présent et non masqué). */
export function typeNommant(u: Univers, s: DefSujetSuivi): string | null {
  return s.types.find((t) => { const d = defType(u, t); return d !== undefined && d.masque !== true; }) ?? null;
}

/** Le nom du sujet dans le vocabulaire de l'entreprise : « Chantier », « Vente », « Dossier »… */
export function libelleSujet(u: Univers, s: DefSujetSuivi, nombre = 1): string {
  const t = typeNommant(u, s);
  return t === null ? libelleType(u, s.types[0] ?? s.id, nombre) : libelleType(u, t, nombre);
}

// ------------------------------------------------------------------ lire l'univers plutôt que coder en dur

const champsDu = (u: Univers, typeId: string): readonly DefChamp[] => defType(u, typeId)?.champs ?? [];

/**
 * Le champ qui désigne le CLIENT, trouvé par sa forme déclarée (référence vers un tiers), jamais par son nom :
 * on préfère celui qui porte le rôle « client », sinon n'importe quelle référence vers un tiers.
 */
export function champDestinataire(u: Univers, typeId: string): string | null {
  const refs = champsDu(u, typeId).filter((c) => c.type === 'reference' && c.cible?.famille === 'tiers');
  return (refs.find((c) => c.cible?.role === 'client') ?? refs[0])?.id ?? null;
}

/** Le champ qui désigne une PERSONNE de l'entreprise (responsable, conducteur…), trouvé de la même façon. */
export function champResponsable(u: Univers, typeId: string): string | null {
  return champsDu(u, typeId).find((c) => c.type === 'reference' && c.cible?.famille === 'personne')?.id ?? null;
}

/** Le champ qui rattache le suivi à un département (pour retrouver un responsable à défaut). */
const champDepartement = (u: Univers, typeId: string): string | null =>
  champsDu(u, typeId).find((c) => c.type === 'reference' && c.cible?.famille === 'departement')?.id ?? null;

const texteDe = (v: ValeurChamp | undefined): string => (typeof v === 'string' ? v.trim() : '');
const refDe = (v: ValeurChamp | undefined): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const jourDe = (v: ValeurChamp | undefined): string | null =>
  (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

/** Libellé d'un champ tel que l'univers l'écrit (« Livraison prévue »), ou son identifiant à défaut. */
export function libelleChamp(u: Univers, typeId: string, champ: string): string {
  return champsDu(u, typeId).find((c) => c.id === champ)?.libelle ?? champ;
}

// ------------------------------------------------------------------ étapes et échéances

export type EtatEtape = 'faite' | 'a_venir' | 'bientot' | 'aujourdhui' | 'depassee' | 'sans_date';

const RANG: Readonly<Record<EtatEtape, number>> = { depassee: 0, aujourdhui: 1, bientot: 2, a_venir: 3, sans_date: 4, faite: 5 };
/** Le plus pressant de deux états. */
export const pirePresse = (a: EtatEtape, b: EtatEtape): EtatEtape => (RANG[a] <= RANG[b] ? a : b);

export interface Etape {
  /** Identité stable de l'étape DANS son suivi (`livraison_prevue`, `tache:obj-…`, `materiel:revision`). */
  id: string;
  /** Intitulé tel que l'univers — ou l'entreprise — le nomme. Jamais écrit en dur. */
  libelle: string;
  /** Jour de l'échéance, AAAA-MM-JJ ; null : cette étape n'a pas de date. */
  jour: string | null;
  joursRestants: number | null;
  prevenirJours: number;
  etat: EtatEtape;
  /** Id de la personne qui la tient ; à défaut celui du suivi. */
  responsable: string | null;
  /** Ce qui reste au compteur quand l'échéance n'est pas une date (matériel). */
  compteur: { reste: number; unite: UniteCompteur } | null;
  /** Vrai : l'étape est passée (parcours déjà franchi, ou tâche terminée). */
  faite: boolean;
  /** La règle de l'univers (ou de `vehicules.ts`) qui a produit cette échéance ; null : le champ du suivi. */
  regle: string | null;
}

export interface Suivi {
  /** L'objet suivi. */
  id: string;
  sujet: string;
  /** Nom de la fiche (« Chantier Le Goff »). */
  nom: string;
  /** Nom du sujet dans le vocabulaire de l'entreprise (« Chantier »). */
  libelleSujet: string;
  etapes: Etape[];
  responsable: string | null;
  /** Le client que ce suivi concerne, quand le sujet s'y prête ; null sinon. */
  destinataire: string | null;
  /** Rien ne reste à faire : le parcours est au bout, ou le drapeau est levé. */
  termine: boolean;
  /** L'étape la plus pressante encore ouverte ; null quand tout est fait. */
  prochaine: Etape | null;
  /** Le plus pressant de toutes ses étapes ouvertes. */
  etat: EtatEtape;
}

export interface ContexteSuivi {
  /** Jour de référence, AAAA-MM-JJ (jamais une horloge lue ici). */
  aujourdhui: string;
}

export const contexteDe = (maintenant: Date): ContexteSuivi => ({ aujourdhui: jourIso(maintenant) });

function etatDe(jour: string | null, restants: number | null, prevenir: number): EtatEtape {
  if (jour === null || restants === null) return 'sans_date';
  if (restants < 0) return 'depassee';
  if (restants === 0) return 'aujourdhui';
  return restants <= prevenir ? 'bientot' : 'a_venir';
}

/** Préavis retenu : celui que la fiche porte, sinon celui de la règle de l'univers, sinon celui du sujet. */
function prevenirDe(o: ObjetMetier, s: DefSujetSuivi, champAvantJours?: string, avantJours?: number): number {
  if (champAvantJours !== undefined) {
    const n = o.champs[champAvantJours];
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 365) return Math.round(n);
  }
  return avantJours ?? s.prevenirJours;
}

function etape(
  id: string, libelle: string, jour: string | null, prevenir: number, ctx: ContexteSuivi,
  o: { responsable?: string | null; faite?: boolean; regle?: string | null; compteur?: { reste: number; unite: UniteCompteur } | null } = {},
): Etape {
  const restants = jour === null ? null : joursEntre(ctx.aujourdhui, jour);
  const faite = o.faite === true;
  return {
    id, libelle: libelle.slice(0, 120), jour, joursRestants: restants, prevenirJours: prevenir,
    etat: faite ? 'faite' : etatDe(jour, restants, prevenir),
    responsable: o.responsable ?? null, compteur: o.compteur ?? null, faite, regle: o.regle ?? null,
  };
}

/**
 * Le suivi d'un objet : ses étapes, dans l'ordre où l'entreprise les lit. `tachesLiees` sont les tâches dont le champ
 * `concerne` pointe sur lui — ce sont les étapes qu'elle a écrites elle-même.
 */
export function suiviDe(
  u: Univers,
  o: ObjetMetier,
  ctx: ContexteSuivi,
  { tachesLiees = [], objets = [] }: { tachesLiees?: readonly ObjetMetier[]; objets?: readonly ObjetMetier[] } = {},
): Suivi | null {
  const s = sujetDe(o);
  if (s === null) return null;
  const etapes: Etape[] = [];
  let termine = false;

  // 1) le parcours, quand l'univers en déclare un : les valeurs de son champ « choix », dans leur ordre
  if (s.etapes.de === 'parcours') {
    const champ = s.etapes.champ;
    const choix = champsDu(u, o.type).find((c) => c.id === champ)?.choix ?? [];
    const actuel = texteDe(o.champs[champ]);
    const rang = choix.indexOf(actuel);
    termine = s.etapes.finies.includes(actuel);
    for (const [i, valeur] of choix.entries()) {
      // l'échéance d'une étape de parcours n'est pas une date en soi : c'est l'étape en cours qui en porte une
      etapes.push(etape(`parcours:${valeur}`, casseDePhrase(valeur), null, s.prevenirJours, ctx, { faite: rang >= 0 && i < rang }));
    }
  }
  if (s.etapes.de === 'drapeau') termine = o.champs[s.etapes.champ] === true;

  // 2) le champ date que porte le suivi lui-même (chantier : « Échéance » ; facture : « Échéance »)
  if (s.champEcheance !== undefined) {
    const jour = jourDe(o.champs[s.champEcheance]);
    if (jour !== null) {
      etapes.push(etape(s.champEcheance, libelleChamp(u, o.type, s.champEcheance), jour, s.prevenirJours, ctx, { faite: termine }));
    }
  }

  // 3) les règles d'échéance de l'univers qui visent ce type (papiers, livraisons, matériel par date)
  for (const r of u.echeances) {
    if (r.type !== o.type) continue;
    const jour = jourDe(o.champs[r.champ]);
    if (jour === null) continue;
    const fini = r.termine !== undefined && r.termine.valeurs.includes(String(o.champs[r.termine.champ] ?? ''));
    const propre = r.champLibelle === undefined ? '' : texteDe(o.champs[r.champLibelle]);
    etapes.push(etape(
      r.champ, propre || r.libelle, jour,
      prevenirDe(o, s, r.champAvantJours, r.avantJours), ctx,
      { faite: fini || termine, regle: r.id },
    ));
  }

  // 4) les échéances au COMPTEUR du matériel roulant : `vehicules.ts` les calcule déjà, le moteur les range
  if (s.compteur === true && estMaterielSuivi(o)) {
    for (const x of echeancesDe(o, jourEnDate(ctx.aujourdhui))) {
      if (x.compteur === null || x.compteurRestant === null) continue;
      const unite: UniteCompteur = o.type === 'engin' || /engin/i.test(o.type) ? 'h' : 'km';
      etapes.push(etape(
        `compteur:${x.id}`, x.libelle, null, x.prevenirJours, ctx,
        {
          regle: `materiel_compteur_${x.id}`,
          compteur: { reste: x.compteurRestant, unite },
        },
      ));
      // l'état d'une échéance au compteur ne se lit pas en jours : il se lit sur ce qu'il reste à rouler
      const derniere = etapes[etapes.length - 1] as Etape;
      derniere.etat = x.compteurRestant <= 0 ? 'depassee'
        : x.prevenirCompteur !== null && x.compteurRestant <= x.prevenirCompteur ? 'bientot' : 'a_venir';
    }
  }

  // 5) les tâches rattachées : les étapes que l'entreprise a écrites (un chantier et ses étapes)
  if (s.tachesEtapes === true) {
    for (const t of tachesLiees) {
      const faite = texteDe(t.champs.statut).startsWith('termin');
      etapes.push(etape(
        `tache:${t.id}`, t.nom, jourDe(t.champs.echeance), s.prevenirJours, ctx,
        { faite, responsable: refDe(t.champs.responsable), regle: 'tache_en_retard' },
      ));
    }
  }

  const champResp = champResponsable(u, o.type);
  let responsable = champResp === null ? null : refDe(o.champs[champResp]);
  if (responsable === null) {
    const champDep = champDepartement(u, o.type);
    const dep = champDep === null ? null : refDe(o.champs[champDep]);
    const fiche = dep === null ? undefined : objets.find((x) => x.id === dep);
    responsable = fiche === undefined ? null : refDe(fiche.champs.responsable);
  }
  const champDest = s.pourLeClient === true ? champDestinataire(u, o.type) : null;
  const ouvertes = etapes.filter((e) => !e.faite && e.etat !== 'sans_date');
  const prochaine = [...ouvertes].sort((a, b) => RANG[a.etat] - RANG[b.etat] || String(a.jour ?? '').localeCompare(String(b.jour ?? '')))[0] ?? null;
  return {
    id: o.id, sujet: s.id, nom: o.nom, libelleSujet: libelleSujet(u, s),
    etapes: etapes.map((e) => ({ ...e, responsable: e.responsable ?? responsable })),
    responsable, destinataire: champDest === null ? null : refDe(o.champs[champDest]),
    termine, prochaine, etat: ouvertes.reduce<EtatEtape>((acc, e) => pirePresse(acc, e.etat), 'faite'),
  };
}

/** Un jour AAAA-MM-JJ relu en date locale (pour les fonctions de `vehicules.ts`, qui travaillent sur des dates). */
function jourEnDate(jour: string): Date {
  const [a, m, j] = jour.split('-').map(Number);
  return new Date(a ?? 1970, (m ?? 1) - 1, j ?? 1);
}

/** Tous les suivis d'un ensemble d'objets, dans l'ordre des sujets puis du plus pressant. */
export function suivis(u: Univers, objets: readonly ObjetMetier[], ctx: ContexteSuivi): Suivi[] {
  const taches = objets.filter((o) => o.famille === 'tache');
  const parConcerne = new Map<string, ObjetMetier[]>();
  for (const t of taches) {
    const c = refDe(t.champs.concerne);
    if (c === null) continue;
    const liste = parConcerne.get(c) ?? [];
    liste.push(t);
    parConcerne.set(c, liste);
  }
  const ordre = new Map(SUJETS.map((s, i) => [s.id, i]));
  const res: Suivi[] = [];
  for (const o of objets) {
    const s = suiviDe(u, o, ctx, { tachesLiees: parConcerne.get(o.id) ?? [], objets });
    if (s !== null && s.etapes.length > 0) res.push(s);
  }
  return res.sort((a, b) => (ordre.get(a.sujet) ?? 99) - (ordre.get(b.sujet) ?? 99) || RANG[a.etat] - RANG[b.etat] || a.nom.localeCompare(b.nom, 'fr'));
}

// ------------------------------------------------------------------ ce qui doit sortir, et par quelle porte

/** Une sortie à faire exister dehors : un rendez-vous ou une tâche. Sa clé est son identité, pour toujours. */
export interface Sortie {
  /**
   * Identité stable d'une sortie : même suivi, même étape, même porte ⇒ même clé. C'est elle qui garantit qu'un
   * second passage met à jour au lieu de créer un deuxième rendez-vous.
   */
  cle: string;
  porte: 'agenda' | 'tache';
  sujet: string;
  /** L'objet suivi (le rendez-vous et la tâche s'y rattachent). */
  suiviId: string;
  etapeId: string;
  /** Ce qui s'écrit dans l'agenda ou la liste : jamais un montant, jamais un prix. */
  titre: string;
  jour: string;
  responsable: string | null;
}

/** La clé d'une sortie. Elle ne contient que des identifiants, jamais un libellé (qui pourrait changer). */
export const cleSortie = (porte: 'agenda' | 'tache', suiviId: string, etapeId: string): string => `${porte}:${suiviId}:${etapeId}`;

/** Les états pour lesquels une échéance mérite qu'on l'inscrive dehors : ce qui arrive, ou ce qui est déjà passé. */
const A_SORTIR: ReadonlySet<EtatEtape> = new Set<EtatEtape>(['bientot', 'aujourdhui', 'depassee']);

/**
 * Ce qui doit exister dans l'agenda et la liste de tâches, pour un suivi donné et les portes choisies. Une étape
 * faite, sans date, ou encore loin n'y est pas : c'est ce qui la fait DISPARAÎTRE quand elle est annulée ou réglée.
 */
export function sortiesDe(s: Suivi, portes: readonly Porte[]): Sortie[] {
  const res: Sortie[] = [];
  if (s.termine) return res;
  for (const e of s.etapes) {
    if (e.faite || e.jour === null || !A_SORTIR.has(e.etat)) continue;
    const titre = `${s.libelleSujet} ${s.nom} — ${e.libelle}`.slice(0, 160);
    for (const porte of ['agenda', 'tache'] as const) {
      if (!portes.includes(porte)) continue;
      res.push({
        cle: cleSortie(porte, s.id, e.id), porte, sujet: s.sujet, suiviId: s.id, etapeId: e.id,
        titre, jour: e.jour, responsable: e.responsable,
      });
    }
  }
  return res;
}

/** Toutes les sorties dues, tous suivis confondus. L'ordre est stable : deux passages donnent la même liste. */
export function sorties(liste: readonly Suivi[], choix: ChoixPortes | undefined): Sortie[] {
  return liste.flatMap((s) => sortiesDe(s, portesDe(choix, s.sujet))).sort((a, b) => a.cle.localeCompare(b.cle));
}

// ------------------------------------------------------------------ les deux portes qui existaient déjà

/** Ce que la porte « alerte » demande à l'entreprise : le sujet à cocher dans Réglages, Alertes. */
export interface PorteAlerte {
  sujet: string;
  /** Identifiant du sujet d'alerte, tel que `passerelle/alertes.ts` l'expose. */
  sujetAlerte: string;
  /** Vrai : l'entreprise a bien coché ce sujet là-bas, l'échéance partira. */
  coche: boolean;
}

/**
 * Pour chaque sujet de suivi dont la porte « alerte » est ouverte, le sujet d'alerte correspondant et s'il est coché.
 * Rien n'est décidé ici : `alertes.ts` garde ses sujets et son anti-doublon, le moteur ne fait que dire où regarder.
 * `sujetsAlerte` est la liste exposée par `alertes.ts` (ses identifiants), `coches` ce que l'entreprise y a coché.
 */
export function portesAlerte(
  u: Univers,
  choix: ChoixPortes | undefined,
  sujetsAlerte: readonly string[],
  coches: readonly string[],
): PorteAlerte[] {
  const connus = new Set(sujetsAlerte);
  const cochesSet = new Set(coches);
  return sujetsDeLUnivers(u)
    .filter((s) => portesDe(choix, s.id).includes('alerte') && connus.has(s.alerte))
    .map((s) => ({ sujet: s.id, sujetAlerte: s.alerte, coche: cochesSet.has(s.alerte) }));
}

/**
 * Les situations que « Aujourd'hui » garde, selon les portes. Le moteur ne fabrique AUCUNE situation : il filtre
 * celles que les règles de l'univers et `vehicules.ts` ont déjà produites. Une situation dont le sujet de suivi n'a
 * pas la porte « Aujourd'hui » est mise de côté — et tout ce qui ne relève d'aucun sujet passe, intact.
 */
export function situationsRetenues(
  liste: readonly Situation[],
  objets: readonly ObjetMetier[],
  choix: ChoixPortes | undefined,
): Situation[] {
  const parId = new Map(objets.map((o) => [o.id, o]));
  return liste.filter((s) => {
    const o = parId.get(s.objetId);
    const sujet = o === undefined ? null : sujetDe(o);
    return sujet === null || portesDe(choix, sujet.id).includes('aujourdhui');
  });
}

// ------------------------------------------------------------------ ce que l'entreprise lit à l'écran

/** Une ligne de l'écran de suivi, côté entreprise. */
export interface LigneSuivi {
  id: string;
  sujet: string;
  libelleSujet: string;
  nom: string;
  etat: EtatEtape;
  /** Ce qui vient, dit en une phrase (« Livraison prévue : dans 3 jours »). */
  phrase: string;
  /** Combien d'étapes sont faites, sur combien. */
  avancement: { faites: number; total: number };
  destinataire: string | null;
  portes: readonly Porte[];
}

/** « dans 3 jours », « aujourd'hui », « dépassée de 6 jours », « dans 800 kilomètres ». */
export function phraseEcheance(e: Etape): string {
  if (e.compteur !== null) {
    return e.compteur.reste <= 0
      ? `${e.libelle} : dépassé de ${quantiteCompteur(-e.compteur.reste, e.compteur.unite)}`
      : `${e.libelle} : dans ${quantiteCompteur(e.compteur.reste, e.compteur.unite)}`;
  }
  const n = e.joursRestants;
  if (n === null) return `${e.libelle} : sans date`;
  if (n < 0) return `${e.libelle} : dépassée de ${jours(-n)}`;
  if (n === 0) return `${e.libelle} : aujourd’hui`;
  if (n === 1) return `${e.libelle} : demain`;
  return `${e.libelle} : dans ${jours(n)}`;
}

const jours = (n: number): string => `${n} ${n < 2 ? 'jour' : 'jours'}`;

export function lignes(liste: readonly Suivi[], choix: ChoixPortes | undefined): LigneSuivi[] {
  return liste.map((s) => ({
    id: s.id, sujet: s.sujet, libelleSujet: s.libelleSujet, nom: s.nom, etat: s.etat,
    phrase: s.prochaine === null ? (s.termine ? 'Terminé.' : 'Rien d’attendu pour l’instant.') : phraseEcheance(s.prochaine),
    avancement: { faites: s.etapes.filter((e) => e.faite).length, total: s.etapes.length },
    destinataire: s.destinataire,
    portes: portesDe(choix, s.sujet),
  }));
}

/** Gravité d'un état, pour les écrans qui en ont besoin (même échelle que les situations). */
export const graviteDe = (e: EtatEtape): Gravite => (e === 'depassee' ? 'critique' : e === 'aujourdhui' || e === 'bientot' ? 'attention' : 'info');
