/**
 * État du monde privé côté passerelle (lot 1, une organisation).
 * - Périmètres contrôlés ICI, sur chaque objet, chaque référence, chaque action (LB-01, R05).
 * - Espace réel + un espace de simulation par session (copie isolée, R04).
 * - Actions : préparation → approbation → exécution idempotente (LB-04, R03).
 * État sérialisable (`instantane`) : enregistré sur disque par la passerelle, restauré au démarrage.
 * Chaque changement du réel émet un événement (temps réel, synchronisation, automatisations).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash, randomUUID } from 'node:crypto';
import { RegistreActions, transition, type CommandeAction, type Executeur } from '../core/actions.ts';
import { indicateursDepuisRegles, type DetailCouverture } from '../core/indicateurs.ts';
import { fraicheur, type Fraicheur, type ObjetMetier, type ValeurChamp } from '../core/model.ts';
import { majQuetes, type Quete } from '../core/quetes.ts';
import { lireReussites, nouvellesReussites, progression, type Progression, type Reussite } from '../core/progression.ts';
import { situationsPour, type Situation } from '../core/situation.ts';
import { defType, libelleRole, validerObjet, type Univers } from '../core/univers.ts';
import { calculerVitalite, type ResultatVitalite } from '../core/vitalite.ts';
import { chargerUnivers } from '../config/univers.ts';
import { donneesDemo, NOM_ORG_DEMO, ORG_DEMO, PROFILS_DEMO, voitMotifsAbsence, type Profil } from '../demo/donnees.ts';
import { donneesDemoEti } from '../demo/eti.ts';
import { isoJour, joursOuvres, lundi, planningDemo, type Planning } from '../demo/planning.ts';

export const EXEMPLES = { pme: 'Petite entreprise (sans départements)', eti: 'Entreprise organisée en départements' } as const;
export type Exemple = keyof typeof EXEMPLES;
import { vuePavillon, type EtatNexus, type VuePavillon } from '../nexus/pavillon.ts';
import { CONNECTEURS, telechargerSheets, validerLienSheets } from './connecteurs.ts';
import { recuperateurProtege } from './sortant.ts';
import { convertir, NOM, normaliser, parserCsv, proposerMapping, ROLES } from './csv.ts';
import { pluriel } from '../core/texte.ts';

export class ErreurApi extends Error {
  readonly statut: number;
  readonly code: string;
  constructor(statut: number, code: string, message: string = code) {
    super(message);
    this.statut = statut;
    this.code = code;
  }
}

export const UNIVERS_DISPONIBLES = ['generique', 'btp', 'commerce'] as const;

interface ActionEnregistree {
  cmd: CommandeAction;
  creeLe: string;
  majLe: string;
  message: string | null;
  /** Canal de la préparation : `cle:<id> « <nom> »` si une clé d'API (agent IA, script) l'a demandée ; absent à l'écran. */
  via?: string | null;
}

/** Acteur technique des connecteurs, formulaires et automatisations (jamais connectable). */
export const SYSTEME: Profil = {
  id: 'systeme', nom: 'Automatisation', role: 'dirigeant', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous',
  peutPreparer: true, peutApprouver: true, voitScore: true, peutAdministrer: true, voitMotifsAbsence: true,
};

/** Motifs d'absence du planning : visibles et saisissables seulement avec le droit RH (`voitMotifsAbsence`). */
const MOTIFS_ABSENCE = ['congé', 'maladie', 'formation'] as const;
/** Absence sans motif : ce que voit tout profil sans le droit RH, et ce qu'écrit le journal. */
export const ABSENCE = 'absence';
const estAbsence = (v: string) => v === ABSENCE || v.startsWith('absence:');
/** Case telle que ce profil peut la voir : le motif d'une absence n'apparaît qu'avec le droit RH. */
export const caseVisible = (p: Profil, v: string): string => (estAbsence(v) && !voitMotifsAbsence(p) ? ABSENCE : v);

/**
 * Canal de la requête en cours, écrit au journal à côté du profil : `cle:<id> « <nom> »` pour une clé d'API (Claude,
 * Make, script…), absent pour une personne à l'écran. Posé par la passerelle autour de chaque requête par clé.
 */
export const CANAL = new AsyncLocalStorage<string>();
/**
 * Nom d'entreprise sur une seule ligne : ni retour à la ligne ni caractère de contrôle (il est repris dans des textes
 * destinés à une IA et dans des en-têtes ; constat ia-act-11).
 */
export const uneLigne = (t: string): string => t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Requête en cours faite avec une clé d'API (agent IA, Make, script) : son canal, sinon null (personne à l'écran). */
const canalCle = (): string | null => CANAL.getStore()?.slice(0, 120) ?? null;

/** Champs qui identifient ou permettent de joindre une personne ou une entreprise (jamais complétés par un lien non confirmé). */
const CHAMP_IDENTITE = /^(e-?mail|courriel|contact|siret|siren|adresse|t[eé]l|telephone|mobile|portable|iban|tva)/i;

export interface LigneJournal {
  le: string;
  acteur: string;
  /** Absent : une personne, depuis l'écran. Sinon la clé d'API qui a agi avec les droits de `acteur`. */
  canal?: string;
  action: string;
  cible: string | null;
  detail: string;
}

/**
 * Événements de sécurité (constat revue-jeu-1-4) : gardés À PART pendant 12 mois, jamais chassés par l'activité
 * ordinaire du journal (5 000 lignes tournantes). Exports et restaurations, clés d'API, accès et profils, comptes,
 * liaison et partage avec le réseau, avis de sécurité, effacements, purges, installation.
 */
const ACTIONS_SECURITE = /^(?:sauvegarde\.|cle\.|acces\.|compte\.|reseau\.|securite\.|objet\.(?:efface|anonymise)$|conservation\.purge$|installation$|monde\.vide$)/;
export const estActionSecurite = (action: string): boolean => ACTIONS_SECURITE.test(action);
const JOURNAL_MAX = 5000;
const JOURNAL_SECURITE_DUREE_MS = 365 * 86_400_000;
/** Plafond par type d'événement : une rafale d'un type ne chasse que les plus anciens de CE type, jamais les autres. */
const JOURNAL_SECURITE_MAX_PAR_ACTION = 2000;
export const PAGE_JOURNAL = 200;
/** Cases de planning modifiées à la suite par le même acteur : une seule ligne, tenue à jour pendant une heure. */
const REGROUPEMENT_PLANNING_MS = 3600_000;

function lireJournal(x: unknown, max: number): LigneJournal[] {
  if (!Array.isArray(x)) return [];
  return x.filter((l): l is LigneJournal => estObj(l) && typeof l.le === 'string' && typeof l.acteur === 'string' && typeof l.action === 'string'
    && typeof l.detail === 'string' && (l.cible === null || typeof l.cible === 'string')).slice(-max);
}

export interface EvenementMonde {
  le: string;
  acteur: string;
  action: string;
  cible: string | null;
}

/** Ligne venue d'un outil externe : valeurs déjà rangées par cible (`__nom`, `__roles`, id de champ). */
export interface LigneExterne {
  externeId: string;
  valeurs: Record<string, string>;
  /** Lien posé par rapprochement automatique : compléter les champs vides seulement (rien d'écrasé ni d'effacé). */
  completer?: boolean;
}

export interface EtatMonde {
  version: 1;
  univers: string;
  exemple: Exemple | null;
  objets: ObjetMetier[];
  planning: Record<string, Record<string, string>>;
  profils: Profil[];
  journal: LigneJournal[];
  /** Événements de sécurité gardés à part (12 mois) ; absent d'un état plus ancien : repris du journal au chargement. */
  journalSecurite?: LigneJournal[];
  importsFaits: string[];
  actions: ActionEnregistree[];
  /** Quêtes achevées (preuve comprise) : la seule source d'XP (core/progression.ts). */
  reussites?: Reussite[];
}

interface Espace {
  objets: Map<string, ObjetMetier>;
  actions: Map<string, ActionEnregistree>;
  registre: RegistreActions;
  modifies: Set<string>;
  simulation: boolean;
  planning: Planning;
}

export interface OptionsMonde {
  maintenant: () => Date;
  ageMaxMs: number;
  seuilCouverture: number;
  etatNexus: () => Promise<EtatNexus>;
  /** Exemple fictif chargé au démarrage (null : monde vide, en attente d'installation). */
  exemple: Exemple | null;
  /** État enregistré à restaurer (remplace l'exemple). */
  etat?: EtatMonde | null;
}

export interface ChampVue {
  id: string;
  libelle: string;
  type: string;
  unite: string | null;
  valeur: ValeurChamp;
  lien: { id: string; nom: string } | null;
}

export interface ObjetVue {
  id: string;
  famille: string;
  type: string;
  libelleType: string;
  icone: string | null;
  nom: string;
  roles: { id: string; libelle: string }[];
  lieu: string | null;
  champs: ChampVue[];
  provenance: string;
  source: { id: string; libelle: string };
  majLe: string;
  fraicheur: Fraicheur;
  mode: string;
  simule: boolean;
  /** Activité du jour d'un employé selon le planning (null si non planifié). */
  jour: { valeur: string; type: string; libelle: string; cible: string | null } | null;
}

const ID_SUR = /^[A-Za-z0-9_-]{1,80}$/;
const CLE_SURE = /^[A-Za-z0-9_-]{8,128}$/;
const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

function copierEspace(e: Espace, simulation: boolean): Espace {
  return {
    objets: new Map([...e.objets].map(([k, o]) => [k, { ...o, champs: { ...o.champs }, roles: [...o.roles] }])),
    actions: new Map(),
    registre: new RegistreActions(),
    modifies: new Set(),
    simulation,
    planning: new Map([...e.planning].map(([k, v]) => [k, new Map(v)])),
  };
}

export class Monde {
  #univers: Univers;
  #catalogue: ReadonlyMap<string, Univers>;
  #reel: Espace;
  #sims = new Map<string, Espace>();
  #quetes = new Map<string, Quete>();
  #reussites: Reussite[] = [];
  #importsFaits = new Set<string>();
  #journal: LigneJournal[] = [];
  #journalSecurite: LigneJournal[] = [];
  /** Dernière ligne « planning.affecte » par acteur, canal et case : les répétitions la tiennent à jour (voir #tracer). */
  #affectationsRecentes = new Map<string, { ligne: LigneJournal; n: number; debut: number }>();
  #o: OptionsMonde;

  private constructor(catalogue: ReadonlyMap<string, Univers>, o: OptionsMonde) {
    this.#catalogue = catalogue;
    this.#univers = catalogue.get('generique') as Univers;
    this.#o = o;
    this.#reel = { objets: new Map(), actions: new Map(), registre: new RegistreActions(), modifies: new Set(), simulation: false, planning: new Map() };
    this.#profils = structuredClone(PROFILS_DEMO) as Profil[];
    if (o.etat) this.#restaurer(o.etat);
    else if (o.exemple) this.#chargerExemple(o.exemple);
    else this.#profils = [];
  }

  #restaurer(etat: EtatMonde): void {
    if (etat.version !== 1 || !Array.isArray(etat.objets)) throw new Error('état enregistré illisible (version inconnue)');
    this.#univers = this.#catalogue.get(etat.univers) ?? this.#univers;
    for (const o of etat.objets) {
      const pb = validerObjet(this.#univers, o);
      if (pb.length) { console.warn(`[monde] objet ignoré à la restauration ${o.id} : ${pb.join(', ')}`); continue; }
      this.#reel.objets.set(o.id, o);
    }
    for (const [id, cases] of Object.entries(etat.planning ?? {})) this.#reel.planning.set(id, new Map(Object.entries(cases)));
    if (Array.isArray(etat.profils) && (etat.profils.length === 0 || etat.profils.some((x) => x.peutAdministrer))) this.#profils = etat.profils;
    this.#journal = Array.isArray(etat.journal) ? etat.journal.slice(-JOURNAL_MAX) : [];
    // état d'avant le journal de sécurité : ses événements de sécurité encore présents sont repris tels quels
    this.#journalSecurite = Array.isArray(etat.journalSecurite)
      ? lireJournal(etat.journalSecurite, 100_000)
      : lireJournal(this.#journal, JOURNAL_MAX).filter((l) => estActionSecurite(l.action)).map((l) => ({ ...l }));
    this.#importsFaits = new Set(etat.importsFaits ?? []);
    for (const a of etat.actions ?? []) this.#reel.actions.set(a.cmd.cleIdempotence, a);
    this.#exemple = etat.exemple === 'eti' || etat.exemple === 'pme' ? etat.exemple : null;
    this.#reussites = lireReussites(etat.reussites);
    this.#recalculerQuetes();
  }

  /** Copie sérialisable de l'état réel (jamais les simulations). */
  instantane(): EtatMonde {
    return {
      version: 1,
      univers: this.#univers.id,
      exemple: this.#exemple,
      objets: [...this.#reel.objets.values()],
      planning: Object.fromEntries([...this.#reel.planning].map(([k, v]) => [k, Object.fromEntries(v)])),
      profils: this.#profils,
      journal: this.#journal,
      journalSecurite: this.#journalSecurite,
      importsFaits: [...this.#importsFaits],
      actions: [...this.#reel.actions.values()].filter((a) => a.cmd.mode !== 'simulation'),
      reussites: this.#reussites.map((r) => ({ ...r, preuve: { ...r.preuve } })),
    };
  }

  // ---------------------------------------------------------------- événements (temps réel)

  #ecouteurs = new Set<(e: EvenementMonde) => void>();

  /** S'abonne aux changements du monde réel. Renvoie la fonction de désabonnement. */
  abonner(f: (e: EvenementMonde) => void): () => void {
    this.#ecouteurs.add(f);
    return () => { this.#ecouteurs.delete(f); };
  }

  #emettre(ev: EvenementMonde): void {
    for (const f of this.#ecouteurs) {
      try { f(ev); } catch (e) { console.error('[monde] écouteur en erreur', e instanceof Error ? e.message : e); }
    }
  }

  #exemple: Exemple | null = null;

  #chargerExemple(jeu: Exemple): void {
    const objets = jeu === 'eti' ? donneesDemoEti(this.#o.maintenant()) : donneesDemo(this.#o.maintenant());
    for (const x of objets) {
      const p = validerObjet(this.#univers, x);
      if (p.length) throw new Error(`donnée démo invalide ${x.id} : ${p.join(', ')}`);
    }
    for (const [id, o] of this.#reel.objets) if (o.mode === 'demo') this.#reel.objets.delete(id);
    for (const x of objets) if (!this.#reel.objets.has(x.id)) this.#reel.objets.set(x.id, x);
    for (const [cle, a] of this.#reel.actions) if (!this.#reel.objets.has(a.cmd.cible)) this.#reel.actions.delete(cle);
    for (const id of [...this.#reel.planning.keys()]) if (!this.#reel.objets.has(id)) this.#reel.planning.delete(id);
    for (const [id, cases] of planningDemo(objets, this.#o.maintenant())) this.#reel.planning.set(id, cases);
    this.#exemple = jeu;
    this.#reussites = this.#reussites.filter((r) => !r.exemple); // nouvel exemple : ses réussites repartent de zéro
    this.#quetes = new Map();
    this.#recalculerQuetes();
  }

  /** Change l'exemple fictif affiché (seules les données fictives sont remplacées). */
  changerExemple(p: Profil, sid: string, jeu: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (this.#sims.has(sid)) throw new ErreurApi(409, 'simulation_active', 'Quittez la simulation pour changer d’exemple.');
    if (jeu !== 'pme' && jeu !== 'eti') throw new ErreurApi(400, 'exemple_inconnu');
    if (![...this.#reel.objets.values()].some((o) => o.mode === 'demo')) throw new ErreurApi(409, 'monde_reel', 'Votre monde ne contient plus de données fictives.');
    this.#chargerExemple(jeu);
    this.#tracer(p, this.#reel, 'exemple.change', null, jeu);
    return { ok: true, organisation: this.organisation };
  }

  static async creer(o: Partial<OptionsMonde> = {}): Promise<Monde> {
    const cat = new Map<string, Univers>();
    for (const id of UNIVERS_DISPONIBLES) cat.set(id, await chargerUnivers(id));
    return new Monde(cat, {
      maintenant: o.maintenant ?? (() => new Date()),
      ageMaxMs: o.ageMaxMs ?? 24 * 3600_000,
      seuilCouverture: o.seuilCouverture ?? 0.6,
      etatNexus: o.etatNexus ?? (async () => ({ statut: 'non_connecte' })),
      exemple: o.exemple === undefined ? 'pme' : o.exemple,
      etat: o.etat ?? null,
    });
  }

  /** Organisation courante : nom réel une fois le monde créé, « démo » tant que des données fictives existent. */
  get organisation() {
    const org = [...this.#reel.objets.values()].find((o) => o.famille === 'organisation');
    const objets = [...this.#reel.objets.values()];
    const demo = objets.some((o) => o.mode === 'demo');
    const departements = objets.filter((o) => o.famille === 'departement').length;
    const employes = objets.filter((o) => o.famille === 'personne').length;
    const taille = typeof org?.champs.taille === 'string' ? org.champs.taille : null;
    const effectif = typeof org?.champs.effectif === 'number' ? org.champs.effectif : employes;
    // Petite ou moyenne : l'entreprise d'un seul tenant. Plus grande et structurée : par département.
    const grande = (taille?.startsWith('ETI') ?? false) || effectif >= 250;
    const choix = org?.champs.mode_organisation;
    const parDep = choix === 'par départements' ? departements >= 1 : choix === 'd’un seul tenant' ? false : departements >= 2 && grande;
    return {
      id: ORG_DEMO, nom: org?.nom ?? NOM_ORG_DEMO, demo, exemple: demo ? this.#exemple : null, exemples: EXEMPLES,
      taille, effectif, departements, vueParDefaut: parDep ? 'departements' : 'entreprise',
      ville: typeof org?.champs.ville === 'string' ? org.champs.ville : null,
      secteur: typeof org?.champs.secteur === 'string' ? org.champs.secteur : null,
      siret: typeof org?.champs.siret === 'string' ? org.champs.siret : null,
      modeOrganisation: typeof choix === 'string' ? choix : null,
      etapeAccueil: typeof org?.champs.etape_accueil === 'number' ? org.champs.etape_accueil : 0,
      univers: this.#univers.id,
    } as const;
  }

  // ---------------------------------------------------------------- périmètre

  #ctx() {
    return { maintenant: this.#o.maintenant(), ageMaxMs: this.#o.ageMaxMs };
  }

  #espace(sid: string): Espace {
    return this.#sims.get(sid) ?? this.#reel;
  }

  /** Branche l'état Breizhcosystem réel (lien géré par l'application). */
  brancherNexus(f: () => Promise<EtatNexus>): void {
    this.#o.etatNexus = f;
  }

  /** Données du score de santé : ce que le profil voit, dans l'espace de sa session (réel ou simulation). */
  donneesSante(p: Profil, sid: string): { objets: ObjetMetier[]; planning: ReadonlyMap<string, ReadonlyMap<string, string>>; ageMaxMs: number } {
    const e = this.#espace(sid);
    return { objets: [...e.objets.values()].filter((o) => this.#visible(p, o, e.objets)), planning: e.planning, ageMaxMs: this.#o.ageMaxMs };
  }

  #lieuDe(o: ObjetMetier): string | null {
    if (o.famille === 'lieu') return o.id;
    return typeof o.champs.lieu === 'string' ? o.champs.lieu : null;
  }

  #visible(p: Profil, o: ObjetMetier, objets: ReadonlyMap<string, ObjetMetier>, profondeur = 0): boolean {
    if (defType(this.#univers, o.type)?.masque) return false;
    if (p.types !== 'tous' && !p.types.includes(o.type)) return false;
    if (o.famille === 'tiers' && p.rolesTiers !== 'tous' && !o.roles.some((r) => (p.rolesTiers as readonly string[]).includes(r))) return false;
    if (p.departements !== 'tous') {
      if (o.famille === 'departement' && !p.departements.includes(o.id)) return false;
      const d = o.champs.departement;
      if (typeof d === 'string' && !p.departements.includes(d)) return false;
    }
    if (p.lieux === 'tous') return true;
    // courrier : visible si son destinataire l'est (chacun voit le courrier qui le concerne)
    const dest = o.champs.destinataire;
    if (o.type === 'courrier' && typeof dest !== 'string') return false; // courrier sans destinataire : direction seulement
    if (typeof dest === 'string' && o.type === 'courrier') {
      const d = objets.get(dest);
      if (!d || profondeur >= 3 || !this.#visible(p, d, objets, profondeur + 1)) return false;
    }
    const concerne = o.champs.concerne;
    if (typeof concerne === 'string') {
      const c = objets.get(concerne);
      return profondeur < 3 && c !== undefined && this.#visible(p, c, objets, profondeur + 1);
    }
    const lieu = this.#lieuDe(o);
    return lieu === null || p.lieux.includes(lieu);
  }

  #objetVisible(p: Profil, e: Espace, id: unknown): ObjetMetier {
    if (typeof id !== 'string' || !ID_SUR.test(id)) throw new ErreurApi(404, 'introuvable');
    const o = e.objets.get(id);
    if (!o || !this.#visible(p, o, e.objets)) throw new ErreurApi(404, 'introuvable'); // indifférencié
    return o;
  }

  // ---------------------------------------------------------------- vues

  #vueObjet(o: ObjetMetier, e: Espace, p: Profil): ObjetVue {
    const t = defType(this.#univers, o.type);
    const champs: ChampVue[] = (t?.champs ?? []).map((c) => {
      let valeur = o.champs[c.id] ?? null;
      let lien: ChampVue['lien'] = null;
      if (c.type === 'reference' && typeof valeur === 'string') {
        const cible = e.objets.get(valeur);
        if (cible && this.#visible(p, cible, e.objets)) lien = { id: cible.id, nom: cible.nom };
        else valeur = null; // ne rien révéler d'un objet hors périmètre
      }
      return { id: c.id, libelle: c.libelle, type: c.type, unite: c.unite ?? null, valeur, lien };
    });
    return {
      id: o.id,
      famille: o.famille,
      type: o.type,
      libelleType: t?.libelle ?? o.type,
      icone: t?.icone ?? null,
      nom: o.nom,
      roles: o.roles.map((r) => ({ id: r, libelle: libelleRole(this.#univers, r) })),
      lieu: this.#lieuDe(o),
      champs,
      provenance: o.provenance,
      source: { id: o.source.id, libelle: o.source.libelle },
      majLe: o.majLe,
      fraicheur: fraicheur(o.majLe, this.#o.maintenant(), this.#o.ageMaxMs),
      mode: o.mode,
      simule: e.simulation && e.modifies.has(o.id),
      jour: o.famille === 'personne' ? this.#jourDe(p, e, o.id, isoJour(this.#o.maintenant())) : null,
    };
  }

  // ---------------------------------------------------------------- planning des équipes

  #libelleCase(v: string, objets: ReadonlyMap<string, ObjetMetier>): { valeur: string; type: string; libelle: string; cible: string | null } {
    if (!v) return { valeur: '', type: 'vide', libelle: 'Non affecté', cible: null };
    const [type, reste = ''] = v.split(':');
    if (type === 'lieu' || type === 'projet') return { valeur: v, type, libelle: objets.get(reste)?.nom ?? 'Inconnu', cible: reste };
    if (v === ABSENCE) return { valeur: v, type: 'absence', libelle: 'Absence', cible: null };
    return { valeur: v, type: type ?? 'autre', libelle: reste.charAt(0).toUpperCase() + reste.slice(1), cible: null };
  }

  #jourDe(p: Profil, e: Espace, employe: string, date: string) {
    const cases = e.planning.get(employe);
    if (!cases || !cases.has(date)) return null;
    return this.#libelleCase(caseVisible(p, cases.get(date) as string), e.objets);
  }

  #alertesPlanning(e: Espace, p: Profil) {
    const ctx = this.#o.maintenant();
    const jours = joursOuvres(lundi(ctx), 3).filter((j) => j >= isoJour(ctx)).slice(0, 6);
    const visibles = [...e.objets.values()].filter((o) => this.#visible(p, o, e.objets));
    const employes = visibles.filter((o) => o.famille === 'personne' && e.planning.has(o.id));
    const cibles = visibles.filter((o) => (o.famille === 'lieu' || o.famille === 'projet') && typeof o.champs.besoin_effectif === 'number');
    const alertes: { date: string; type: string; texte: string; cible: string | null; employe: string | null; gravite: 'critique' | 'attention' }[] = [];
    for (const j of jours) {
      for (const c of cibles) {
        const besoin = c.champs.besoin_effectif as number;
        const v = `${c.famille === 'lieu' ? 'lieu' : 'projet'}:${c.id}`;
        const n = employes.filter((x) => e.planning.get(x.id)?.get(j) === v).length;
        if (n < besoin) alertes.push({ date: j, type: 'sous_effectif', texte: `${c.nom} : ${n} sur ${besoin} ${besoin > 1 ? 'personnes' : 'personne'}`, cible: c.id, employe: null, gravite: n === 0 ? 'critique' : 'attention' });
      }
      for (const x of employes) {
        if (e.planning.get(x.id)?.get(j) === '') alertes.push({ date: j, type: 'sans_affectation', texte: `${x.nom} : sans affectation`, cible: null, employe: x.id, gravite: 'attention' });
      }
    }
    return alertes;
  }

  /**
   * Trous de planning dans le réel : AUJOURD'HUI (tâche du jour des automatisations) ou sur les 6 prochains jours ouvrés,
   * aujourd'hui compris (`prochains` : le même compte que l'écran Planning et que la piste d'Optimiser).
   */
  trousPlanningReel(periode: 'jour' | 'prochains' = 'jour'): number {
    const alertes = this.#alertesPlanning(this.#reel, SYSTEME);
    if (periode === 'prochains') return alertes.length;
    const auj = isoJour(this.#o.maintenant());
    return alertes.filter((a) => a.date === auj).length;
  }

  /**
   * Planning d'une semaine. `nbJours` : 5 (du lundi au vendredi, par défaut), 6 (samedi compris) ou 7 (dimanche
   * compris) : les jours affichés se règlent dans le planning (§6.1 P7).
   */
  planning(p: Profil, sid: string, debut: unknown, nbJours: unknown = 5) {
    const e = this.#espace(sid);
    const base = typeof debut === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(debut) ? lundi(new Date(`${debut}T00:00:00Z`)) : lundi(this.#o.maintenant());
    const n = nbJours === 6 || nbJours === '6' ? 6 : nbJours === 7 || nbJours === '7' ? 7 : 5;
    const jours = Array.from({ length: n }, (_, i) => isoJour(new Date(base.getTime() + i * 86_400_000)));
    const visibles = [...e.objets.values()].filter((o) => this.#visible(p, o, e.objets));
    const employes = visibles.filter((o) => o.famille === 'personne');
    const groupe = (o: ObjetMetier) => {
      const d = o.champs.departement;
      if (typeof d === 'string') return e.objets.get(d)?.nom ?? 'Autres';
      return typeof o.champs.equipe === 'string' ? o.champs.equipe : 'Équipe';
    };
    employes.sort((a, b) => groupe(a).localeCompare(groupe(b)) || a.nom.localeCompare(b.nom));
    const options = [
      ...visibles.filter((o) => o.famille === 'lieu').map((o) => ({ valeur: `lieu:${o.id}`, libelle: o.nom, groupe: 'Lieux' })),
      ...visibles.filter((o) => o.famille === 'projet').map((o) => ({ valeur: `projet:${o.id}`, libelle: o.nom, groupe: 'Projets' })),
      ...['déplacement', 'rendez-vous'].map((m) => ({ valeur: `mission:${m}`, libelle: m.charAt(0).toUpperCase() + m.slice(1), groupe: 'Missions' })),
      // « Absence » sans motif d'abord ; les motifs (dont « maladie », donnée de santé) seulement avec le droit RH
      { valeur: ABSENCE, libelle: 'Absence', groupe: 'Absences' },
      ...(voitMotifsAbsence(p) ? MOTIFS_ABSENCE.map((m) => ({ valeur: `absence:${m}`, libelle: m.charAt(0).toUpperCase() + m.slice(1), groupe: 'Absences' })) : []),
      { valeur: '', libelle: 'Non affecté', groupe: 'Autre' },
    ];
    const cibles = visibles.filter((o) => o.famille === 'lieu' || o.famille === 'projet').map((o) => ({
      valeur: `${o.famille === 'lieu' ? 'lieu' : 'projet'}:${o.id}`, id: o.id, libelle: o.nom, famille: o.famille,
      besoin: typeof o.champs.besoin_effectif === 'number' ? o.champs.besoin_effectif : null,
      avancement: typeof o.champs.avancement === 'number' ? o.champs.avancement : null,
      echeance: typeof o.champs.echeance === 'string' ? o.champs.echeance : null,
      retard: typeof o.champs.retard_jours === 'number' ? o.champs.retard_jours : null,
    }));
    const totaux: Record<string, Record<string, number>> = {};
    for (const c of cibles) totaux[c.valeur] = Object.fromEntries(jours.map((j) => [j, employes.filter((x) => e.planning.get(x.id)?.get(j) === c.valeur).length]));
    return {
      debut: jours[0],
      aujourdhui: isoJour(this.#o.maintenant()),
      jours,
      lignes: employes.map((x) => ({
        id: x.id, nom: x.nom, groupe: groupe(x), poste: typeof x.champs.poste === 'string' ? x.champs.poste : null,
        planifie: e.planning.has(x.id),
        cases: Object.fromEntries(jours.map((j) => [j, caseVisible(p, e.planning.get(x.id)?.get(j) ?? '')])),
      })),
      options,
      cibles,
      totaux,
      modifiable: p.peutPreparer,
      motifsAbsence: voitMotifsAbsence(p),
      alertes: this.#alertesPlanning(e, p),
      simulation: e.simulation,
    };
  }

  /**
   * Affecte une case du planning, ou plusieurs d'un coup (`{ affectations: [{ employe, date, valeur }, …] }` : sélection
   * multiple, glisser pour remplir, annulation). Tout est vérifié avant d'écrire : soit tout passe, soit rien.
   * Samedi et dimanche sont acceptés (jours configurables) ; la date reste à 90 jours au plus d'aujourd'hui.
   */
  affecter(p: Profil, sid: string, d: unknown) {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit', 'Votre rôle ne permet pas de modifier le planning.');
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const e = this.#espace(sid);
    const lot = Array.isArray(d.affectations);
    const demandes: unknown[] = lot ? d.affectations as unknown[] : [d];
    if (!demandes.length || demandes.length > 500) throw new ErreurApi(400, 'requete_invalide', 'Entre 1 et 500 cases à la fois.');
    const verifiees = demandes.map((x) => this.#verifierAffectation(p, e, x));
    for (const a of verifiees) {
      if (!e.planning.has(a.employe)) e.planning.set(a.employe, new Map());
      (e.planning.get(a.employe) as Map<string, string>).set(a.date, a.valeur);
    }
    if (verifiees.length === 1) {
      const a = verifiees[0] as { employe: string; date: string; valeur: string };
      // jamais le motif d'une absence dans le journal (lisible par d'autres que les RH, et gardé longtemps)
      this.#tracer(p, e, 'planning.affecte', a.employe, `${a.date} → ${estAbsence(a.valeur) ? ABSENCE : a.valeur || 'non affecté'}`);
    } else {
      this.#tracer(p, e, 'planning.affecte', (verifiees[0] as { employe: string }).employe, `${verifiees.length} cases modifiées`);
    }
    // la réponse ne montre que ce que ce profil peut voir (une absence gardée garde son motif, sans le révéler)
    const vues = verifiees.map((a) => ({ ...a, valeur: caseVisible(p, a.valeur) }));
    if (!lot) return { ok: true, ...(vues[0] as { employe: string; date: string; valeur: string }) };
    return { ok: true, affectations: vues };
  }

  #verifierAffectation(p: Profil, e: Espace, d: unknown): { employe: string; date: string; valeur: string } {
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const x = this.#objetVisible(p, e, d.employe);
    if (x.famille !== 'personne') throw new ErreurApi(400, 'employe_attendu');
    const date = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : null;
    if (!date) throw new ErreurApi(400, 'date_invalide');
    const jour = new Date(`${date}T00:00:00Z`);
    if (Number.isNaN(jour.getTime()) || Math.abs(jour.getTime() - this.#o.maintenant().getTime()) > 90 * 86_400_000) throw new ErreurApi(400, 'date_hors_planning');
    let v = typeof d.valeur === 'string' ? d.valeur : '';
    if (/^absence:/.test(v) && !voitMotifsAbsence(p)) throw new ErreurApi(403, 'motif_reserve', 'Le motif d’une absence est réservé aux personnes chargées des RH : choisissez « Absence ».');
    // « Absence » sur une absence déjà notée : le motif saisi par les RH est gardé (copier, annuler, remplir)
    const avant = e.planning.get(x.id)?.get(date) ?? '';
    if (v === ABSENCE && avant.startsWith('absence:') && !voitMotifsAbsence(p)) v = avant;
    const ok = v === '' || v === ABSENCE || /^(absence:(congé|maladie|formation)|mission:(déplacement|rendez-vous))$/.test(v) ||
      (/^(lieu|projet):[A-Za-z0-9_-]{1,80}$/.test(v) && (() => { const c = e.objets.get(v.split(':')[1] as string); return c !== undefined && this.#visible(p, c, e.objets) && (c.famille === (v.startsWith('lieu') ? 'lieu' : 'projet')); })());
    if (!ok) throw new ErreurApi(400, 'affectation_invalide');
    return { employe: x.id, date, valeur: v };
  }

  // ---------------------------------------------------------------- courrier

  statutCourrier(p: Profil, sid: string, id: unknown, d: unknown) {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit');
    const e = this.#espace(sid);
    const o = this.#objetVisible(p, e, id);
    if (o.type !== 'courrier') throw new ErreurApi(400, 'courrier_attendu');
    const statut = estObj(d) ? d.statut : null;
    if (statut !== 'traité' && statut !== 'à traiter') throw new ErreurApi(400, 'statut_invalide');
    const maintenant = this.#o.maintenant().toISOString();
    e.objets.set(o.id, { ...o, champs: { ...o.champs, statut }, majLe: maintenant });
    e.modifies.add(o.id);
    this.#tracer(p, e, 'courrier.statut', o.id, statut);
    return { ok: true, statut };
  }

  /** Tri local par mots-clés (sans IA) : propose bac, urgence, destinataire, résumé et action. */
  trierCourrier(p: Profil, sid: string, d: unknown) {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit');
    const texte = estObj(d) && typeof d.texte === 'string' ? d.texte.slice(0, 8000) : '';
    if (texte.trim().length < 10) throw new ErreurApi(400, 'texte_trop_court', 'Collez un mail un peu plus long.');
    const t = normaliser(texte);
    const regles: [string, RegExp][] = [
      ['paiements', /facture|paiement|reglement|virement|rib|relance|impaye|avoir|echeance/],
      ['fournisseurs', /livraison|commande fournisseur|retard|stock|approvision|tarif fournisseur|expedition/],
      ['clients', /devis|commande|reclamation|client|rendezvous|projet|chantier|intervention|sav/],
      ['administratif', /urssaf|attestation|kbis|impots|assurance|mairie|prefecture|contrat|juridique/],
      ['équipe', /candidature|cv|conge|arret|planning|recrutement|salarie|formation/],
      ['publicité', /promotion|offre speciale|newsletter|desinscri|salon|publicite/],
    ];
    const bac = regles.find(([, r]) => r.test(t))?.[0] ?? 'autre';
    const urgence = /urgent|immediat|aujourdhui|mise en demeure|dernier rappel|bloque|annul/.test(t) ? 'haute' : bac === 'publicité' ? 'basse' : 'normale';
    const e = this.#espace(sid);
    const employes = [...e.objets.values()].filter((o) => o.famille === 'personne' && this.#visible(p, o, e.objets));
    const poste = (re: RegExp) => employes.find((o) => re.test(normaliser(String(o.champs.poste ?? ''))));
    const destinataire = ({ paiements: poste(/compta|financ|factur/), fournisseurs: poste(/logisti|stock|achet/), clients: poste(/commercial|client/), administratif: poste(/admin|direct|compta/), 'équipe': poste(/rh|ressources|recrut|direct/) } as Record<string, ObjetMetier | undefined>)[bac] ?? null;
    const lignes = texte.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const objet = (lignes.find((l) => /^(objet|subject)\s*:/i.test(l)) ?? lignes[0] ?? '').replace(/^(objet|subject)\s*:\s*/i, '').slice(0, 160);
    const expediteur = (lignes.find((l) => /^(de|from)\s*:/i.test(l)) ?? '').replace(/^(de|from)\s*:\s*/i, '').slice(0, 120) || 'Expéditeur inconnu';
    const resume = lignes.filter((l) => !/^(de|from|objet|subject|à|to|date)\s*:/i.test(l)).join(' ').slice(0, 220);
    const action = { paiements: 'Vérifier le paiement et répondre', fournisseurs: 'Prévenir les équipes concernées et répondre', clients: 'Répondre au client', administratif: 'Fournir le document demandé', 'équipe': 'Accuser réception', 'publicité': 'Classer', autre: 'Lire et décider' }[bac];
    return { expediteur, objet, resume, bac, urgence, destinataire: destinataire ? { id: destinataire.id, nom: destinataire.nom } : null, action, methode: 'mots-clés (sans IA)' };
  }

  // ---------------------------------------------------------------- accès et visibilité

  #profils: Profil[] = [];

  profils(): readonly Profil[] {
    return this.#profils;
  }

  profil(id: unknown): Profil | null {
    return this.#profils.find((x) => x.id === id) ?? null;
  }

  #optionsAcces() {
    const objets = [...this.#reel.objets.values()];
    return {
      lieux: objets.filter((o) => o.famille === 'lieu').map((o) => ({ id: o.id, nom: o.nom })),
      departements: objets.filter((o) => o.famille === 'departement').map((o) => ({ id: o.id, nom: o.nom })),
      types: this.#univers.types.filter((t) => !t.masque).map((t) => ({ id: t.id, libelle: t.pluriel, famille: t.famille })),
      roles: this.#univers.roles.map((r) => ({ id: r.id, libelle: r.pluriel })),
    };
  }

  #apercu(cible: Profil) {
    const objets = [...this.#reel.objets.values()];
    const parFamille: Record<string, { visibles: number; total: number }> = {};
    for (const o of objets) {
      const f = (parFamille[o.famille] ??= { visibles: 0, total: 0 });
      f.total++;
      if (this.#visible(cible, o, this.#reel.objets)) f.visibles++;
    }
    return parFamille;
  }

  listerAcces(p: Profil) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    return { profils: this.#profils.map((x) => ({ ...x, voitMotifsAbsence: voitMotifsAbsence(x), apercu: this.#apercu(x) })), options: this.#optionsAcces() };
  }

  #lireAcces(d: Record<string, unknown>, base: Profil): Profil {
    const opts = this.#optionsAcces();
    const liste = (v: unknown, valides: string[], ancien: readonly string[] | 'tous') => {
      if (v === undefined) return ancien;
      if (v === 'tous') return 'tous' as const;
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && valides.includes(x))) throw new ErreurApi(400, 'perimetre_invalide');
      return [...new Set(v as string[])];
    };
    const bool = (v: unknown, ancien: boolean) => (v === undefined ? ancien : v === true);
    const nom = d.nom === undefined ? base.nom : typeof d.nom === 'string' && d.nom.trim().length >= 1 && d.nom.length <= 80 ? d.nom.trim() : null;
    if (nom === null) throw new ErreurApi(400, 'nom_invalide');
    const role = d.role === undefined ? base.role : ['dirigeant', 'responsable', 'collaborateur'].includes(d.role as string) ? (d.role as Profil['role']) : null;
    if (role === null) throw new ErreurApi(400, 'role_invalide');
    return {
      ...base, nom, role,
      lieux: liste(d.lieux, opts.lieux.map((x) => x.id), base.lieux),
      departements: liste(d.departements, opts.departements.map((x) => x.id), base.departements),
      types: liste(d.types, opts.types.map((x) => x.id), base.types),
      rolesTiers: liste(d.rolesTiers, opts.roles.map((x) => x.id), base.rolesTiers),
      peutPreparer: bool(d.peutPreparer, base.peutPreparer),
      peutApprouver: bool(d.peutApprouver, base.peutApprouver),
      voitScore: bool(d.voitScore, base.voitScore),
      peutAdministrer: bool(d.peutAdministrer, base.peutAdministrer),
      voitMotifsAbsence: bool(d.voitMotifsAbsence, voitMotifsAbsence(base)),
    };
  }

  modifierAcces(p: Profil, id: unknown, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const i = this.#profils.findIndex((x) => x.id === id);
    if (i === -1) throw new ErreurApi(404, 'introuvable');
    const nouveau = this.#lireAcces(d, this.#profils[i] as Profil);
    if (!nouveau.peutAdministrer && this.#profils.filter((x) => x.peutAdministrer && x.id !== nouveau.id).length === 0) {
      throw new ErreurApi(409, 'dernier_administrateur', 'Il faut garder au moins un profil qui administre les accès.');
    }
    this.#profils[i] = nouveau;
    this.#tracer(p, this.#reel, 'acces.modifie', null, nouveau.nom);
    return { ...nouveau, apercu: this.#apercu(nouveau) };
  }

  creerAcces(p: Profil, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    if (this.#profils.length >= 1000) throw new ErreurApi(409, 'trop_de_profils');
    const base: Profil = { id: `p-${randomUUID().slice(0, 8)}`, nom: 'Nouveau profil', role: 'collaborateur', types: [], lieux: [], rolesTiers: [], departements: [], peutPreparer: false, peutApprouver: false, voitScore: false, peutAdministrer: false, voitMotifsAbsence: false };
    const nouveau = this.#lireAcces(d, base);
    this.#profils.push(nouveau);
    this.#tracer(p, this.#reel, 'acces.cree', null, nouveau.nom);
    return { ...nouveau, apercu: this.#apercu(nouveau) };
  }

  supprimerAcces(p: Profil, id: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (id === p.id) throw new ErreurApi(409, 'soi_meme', 'Vous ne pouvez pas retirer votre propre accès.');
    const i = this.#profils.findIndex((x) => x.id === id);
    if (i === -1) throw new ErreurApi(404, 'introuvable');
    const retire = this.#profils[i] as Profil;
    if (retire.peutAdministrer && this.#profils.filter((x) => x.peutAdministrer).length <= 1) throw new ErreurApi(409, 'dernier_administrateur');
    this.#profils.splice(i, 1);
    this.#tracer(p, this.#reel, 'acces.retire', null, retire.nom);
    return { ok: true };
  }

  #responsable(o: ObjetMetier, objets: ReadonlyMap<string, ObjetMetier>): string | null {
    const lieu = this.#lieuDe(o);
    if (!lieu) return null;
    for (const x of objets.values()) if (x.famille === 'personne' && x.champs.lieu === lieu) return x.id;
    return null;
  }

  #situations(e: Espace): Situation[] {
    const ctx = this.#ctx();
    return [...e.objets.values()].flatMap((o) => situationsPour(this.#univers, o, this.#responsable(o, e.objets), ctx));
  }

  #recalculerQuetes(): void {
    const avant = this.#quetes;
    this.#quetes = majQuetes(this.#univers, this.#quetes, this.#situations(this.#reel), this.#reel.objets, this.#ctx());
    // XP : seulement une quête vue ouverte puis achevée sur une donnée à jour (jamais en simulation : espace réel seul)
    const neuves = nouvellesReussites(avant, this.#quetes, this.#reussites,
      (id) => this.#reel.objets.get(id)?.mode === 'demo', (id) => this.#reel.objets.get(id)?.nom ?? '');
    if (neuves.length) this.#reussites = lireReussites([...this.#reussites, ...neuves]);
  }

  /**
   * Progression de l'entreprise (XP, niveau du port, trophées). Le total est celui de l'entreprise entière ; la liste
   * des réussites ne montre que celles dont l'objet est visible par ce profil (aucun nom hors de son périmètre).
   */
  progression(p: Profil, sid: string): Progression {
    const e = this.#espace(sid);
    const prog = progression(this.#reussites, { exemple: this.organisation.demo });
    const preuves = new Set(prog.trophees.flatMap((t) => t.preuves));
    const n = prog.reussites.length;
    // les 50 dernières, et celles qui prouvent un trophée ; jamais un objet hors du périmètre du profil
    const reussites = prog.reussites.filter((r, i) => (i >= n - 50 || preuves.has(r.id)) && (() => { const o = e.objets.get(r.objetId); return Boolean(o && this.#visible(p, o, e.objets)); })());
    return { ...prog, reussites };
  }

  vueUnivers() {
    const u = this.#univers;
    return {
      id: u.id,
      nom: u.nom,
      disponibles: [...this.#catalogue.values()].map((x) => ({ id: x.id, nom: x.nom })),
      roles: u.roles.filter((r) => !r.masque).map((r) => ({ id: r.id, libelle: r.libelle, pluriel: r.pluriel })),
      types: u.types
        .filter((t) => !t.masque)
        .map((t) => ({
          id: t.id, famille: t.famille, libelle: t.libelle, pluriel: t.pluriel, icone: t.icone ?? null,
          champs: t.champs.map((c) => ({ id: c.id, libelle: c.libelle, type: c.type, unite: c.unite ?? null, choix: c.choix ?? null })),
        })),
    };
  }

  async vue(p: Profil, sid: string) {
    const e = this.#espace(sid);
    const ctx = this.#ctx();
    const visibles = [...e.objets.values()].filter((o) => this.#visible(p, o, e.objets));
    const idsVisibles = new Set(visibles.map((o) => o.id));
    const toutes = this.#situations(e);
    const quetes = e.simulation ? majQuetes(this.#univers, this.#quetes, toutes, e.objets, ctx) : this.#quetes;

    let vitalite: (ResultatVitalite & { couverture_objets: DetailCouverture[] }) | null = null;
    if (p.voitScore) {
      const { indicateurs, couverture } = indicateursDepuisRegles(this.#univers, [...e.objets.values()], ctx);
      vitalite = { ...calculerVitalite(indicateurs, { seuilCouverture: this.#o.seuilCouverture, ageMaxMs: this.#o.ageMaxMs, maintenant: ctx.maintenant }), couverture_objets: couverture };
    }
    const pavillon: VuePavillon = vuePavillon(await this.#o.etatNexus(), { animations: true });

    return {
      organisation: this.organisation,
      mode: e.simulation ? 'simulation' : 'reel',
      maintenant: ctx.maintenant.toISOString(),
      univers: this.vueUnivers(),
      profil: { id: p.id, nom: p.nom, role: p.role, peutPreparer: p.peutPreparer, peutApprouver: p.peutApprouver, peutAdministrer: p.peutAdministrer },
      objets: visibles.map((o) => this.#vueObjet(o, e, p)),
      situations: toutes.filter((s) => idsVisibles.has(s.objetId)).map((s) => ({ ...s, responsable: s.responsable && idsVisibles.has(s.responsable) ? s.responsable : null })),
      quetes: [...quetes.values()].filter((q) => idsVisibles.has(q.origine.objetId)),
      progression: this.progression(p, sid),
      vitalite,
      pavillon,
      planning: (() => {
        const al = this.#alertesPlanning(e, p);
        const auj = isoJour(this.#o.maintenant());
        return { trousAujourdhui: al.filter((a) => a.date === auj).length, trous: al.length };
      })(),
      actionsEnAttente: [...e.actions.values()].filter((a) => a.cmd.etat === 'en_attente' && idsVisibles.has(a.cmd.cible)).map((a) => this.#vueAction(a, e, p)),
    };
  }

  fiche(p: Profil, sid: string, id: unknown) {
    const e = this.#espace(sid);
    const o = this.#objetVisible(p, e, id);
    const ctx = this.#ctx();
    const mouvements = this.#univers.regles.filter((r) => r.type === o.type && r.mouvement);
    const t = defType(this.#univers, o.type);
    return {
      objet: this.#vueObjet(o, e, p),
      situations: situationsPour(this.#univers, o, null, ctx),
      quetes: [...this.#quetes.values()].filter((q) => q.origine.objetId === o.id),
      actionsPossibles: !p.peutPreparer
        ? []
        : [
            ...mouvements.map((r) => {
              const c = t?.champs.find((x) => x.id === r.champ);
              return { capacite: 'mouvement', champ: r.champ, libelle: `Enregistrer un mouvement — ${c?.libelle ?? r.champ}`, unite: c?.unite ?? null };
            }),
            { capacite: 'tache.creer', champ: null, libelle: 'Créer une tâche liée', unite: null },
            ...(o.famille === 'organisation' ? [] : [{ capacite: 'objet.modifier', champ: null, libelle: 'Modifier la fiche', unite: null }]),
          ],
      peutApprouver: p.peutApprouver,
      historique: [...e.actions.values()].filter((a) => a.cmd.cible === o.id).map((a) => this.#vueAction(a, e, p)).reverse(),
    };
  }

  #vueAction(a: ActionEnregistree, e: Espace, p: Profil) {
    const cible = e.objets.get(a.cmd.cible);
    return {
      cle: a.cmd.cleIdempotence,
      capacite: a.cmd.capacite,
      cible: a.cmd.cible,
      cibleNom: cible && this.#visible(p, cible, e.objets) ? cible.nom : null,
      parametres: a.cmd.parametres,
      etat: a.cmd.etat,
      acteur: a.cmd.acteur,
      approuvePar: a.cmd.approuvePar,
      approuveParNom: a.cmd.approuvePar ? (this.profil(a.cmd.approuvePar)?.nom ?? a.cmd.approuvePar) : null,
      via: a.via ?? null,
      mode: a.cmd.mode,
      creeLe: a.creeLe,
      majLe: a.majLe,
      message: a.message,
    };
  }

  // ---------------------------------------------------------------- actions

  #lireParametres(o: ObjetMetier, capacite: unknown, x: unknown): Record<string, ValeurChamp> {
    if (!estObj(x)) throw new ErreurApi(400, 'parametres_invalides');
    if (capacite === 'mouvement') {
      const regle = this.#univers.regles.find((r) => r.type === o.type && r.mouvement && r.champ === x.champ);
      if (!regle) throw new ErreurApi(400, 'mouvement_non_autorise', 'Ce champ n’accepte pas de mouvement.');
      const d = x.delta;
      if (typeof d !== 'number' || !Number.isFinite(d) || d === 0 || Math.abs(d) > 1e6) throw new ErreurApi(400, 'delta_invalide');
      const motif = typeof x.motif === 'string' ? x.motif.trim().slice(0, 200) : '';
      return { champ: regle.champ, delta: d, motif };
    }
    if (capacite === 'tache.creer') {
      const titre = typeof x.titre === 'string' ? x.titre.trim() : '';
      if (titre.length < 1 || titre.length > 200) throw new ErreurApi(400, 'titre_invalide');
      const ech = x.echeance;
      if (ech !== undefined && ech !== null && (typeof ech !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(ech))) throw new ErreurApi(400, 'echeance_invalide');
      return { titre, echeance: (ech as string | null | undefined) ?? null };
    }
    if (capacite === 'objet.modifier') {
      const t = defType(this.#univers, o.type);
      if (!t || !estObj(x.champs)) throw new ErreurApi(400, 'parametres_invalides');
      const champs: Record<string, ValeurChamp> = {};
      for (const [k, v] of Object.entries(x.champs)) {
        const c = t.champs.find((y) => y.id === k);
        if (!c) throw new ErreurApi(400, 'champ_inconnu', k);
        if (v === null || v === '') { champs[k] = null; continue; }
        if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new ErreurApi(400, 'champ_invalide', k);
        if (c.type === 'reference') {
          if (typeof v !== 'string' || !ID_SUR.test(v)) throw new ErreurApi(400, 'reference_invalide', c.libelle);
          champs[k] = v;
          continue;
        }
        const r = c.type === 'booleen' && typeof v === 'boolean' ? { ok: true as const, valeur: v } : convertir(String(v), c);
        if (!r.ok) throw new ErreurApi(400, 'champ_invalide', `${c.libelle} : ${r.erreur}`);
        champs[k] = r.valeur;
      }
      const nom = x.nom === undefined ? null : typeof x.nom === 'string' && x.nom.trim().length >= 1 && x.nom.length <= 200 ? x.nom.trim() : undefined;
      if (nom === undefined) throw new ErreurApi(400, 'nom_invalide');
      if (!Object.keys(champs).length && nom === null) throw new ErreurApi(400, 'rien_a_modifier');
      return { modif: JSON.stringify({ nom, champs }) };
    }
    throw new ErreurApi(400, 'capacite_inconnue');
  }

  #executeur(e: Espace, cle: string): Executeur {
    return async (cmd) => {
      const a = e.actions.get(cle);
      const o = e.objets.get(cmd.cible);
      const maintenant = this.#o.maintenant().toISOString();
      if (!o || !a) return 'echec';
      if (cmd.capacite === 'mouvement') {
        const champ = cmd.parametres.champ as string;
        const delta = cmd.parametres.delta as number;
        const actuel = o.champs[champ];
        if (typeof actuel !== 'number') { a.message = 'Valeur actuelle inconnue : mouvement refusé.'; return 'echec'; }
        const nouveau = Math.round((actuel + delta) * 1e6) / 1e6;
        if (nouveau < 0) { a.message = `Refusé : le résultat serait négatif (${nouveau}).`; return 'echec'; }
        e.objets.set(o.id, {
          ...o,
          champs: { ...o.champs, [champ]: nouveau },
          majLe: maintenant,
          provenance: 'confirme',
          source: { id: 'passerelle:mouvements', libelle: 'Mouvement enregistré dans le jeu', derniereSynchro: maintenant },
        });
        e.modifies.add(o.id);
        a.message = `${actuel} → ${nouveau}`;
        return 'ok';
      }
      if (cmd.capacite === 'tache.creer') {
        const id = `ta-${randomUUID().slice(0, 12)}`;
        const tache: ObjetMetier = {
          id, orgId: o.orgId, famille: 'tache', type: 'tache', roles: [], nom: cmd.parametres.titre as string,
          champs: { concerne: o.id, statut: 'à faire', ...(cmd.parametres.echeance ? { echeance: cmd.parametres.echeance as string } : {}) },
          provenance: 'declare', source: { id: 'passerelle:taches', libelle: 'Créée dans le jeu', derniereSynchro: maintenant },
          majLe: maintenant, disponibilite: 'disponible', mode: o.mode,
        };
        if (validerObjet(this.#univers, tache).length) { a.message = 'Tâche invalide pour cet univers.'; return 'echec'; }
        e.objets.set(id, tache);
        e.modifies.add(id);
        a.message = `Tâche créée : ${tache.nom}`;
        return 'ok';
      }
      if (cmd.capacite === 'objet.modifier') {
        const { nom, champs } = JSON.parse(cmd.parametres.modif as string) as { nom: string | null; champs: Record<string, ValeurChamp> };
        const t = defType(this.#univers, o.type);
        for (const [k, v] of Object.entries(champs)) {
          const c = t?.champs.find((y) => y.id === k);
          if (c?.type === 'reference' && typeof v === 'string') {
            const ref = e.objets.get(v);
            if (!ref || (c.cible && ref.famille !== c.cible.famille)) { a.message = `${c.libelle} : référence introuvable.`; return 'echec'; }
          }
        }
        const nouveaux: Record<string, ValeurChamp> = { ...o.champs };
        for (const [k, v] of Object.entries(champs)) { if (v === null) delete nouveaux[k]; else nouveaux[k] = v; }
        const modifie: ObjetMetier = { ...o, nom: nom ?? o.nom, champs: nouveaux, majLe: maintenant, provenance: 'declare' };
        const pb = validerObjet(this.#univers, modifie);
        if (pb.length) { a.message = pb.join(' ; '); return 'echec'; }
        e.objets.set(o.id, modifie);
        e.modifies.add(o.id);
        const liste = [...(nom ? ['nom'] : []), ...Object.keys(champs)];
        a.message = `Modifié : ${liste.join(', ')}`;
        return 'ok';
      }
      return 'echec';
    };
  }

  async preparerAction(p: Profil, sid: string, d: unknown) {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit', 'Votre rôle ne permet pas de préparer une action.');
    if (!estObj(d) || typeof d.cle !== 'string' || !CLE_SURE.test(d.cle)) throw new ErreurApi(400, 'cle_idempotence_invalide');
    const e = this.#espace(sid);
    const o = this.#objetVisible(p, e, d.cible);
    const parametres = this.#lireParametres(o, d.capacite, d.parametres);
    const existante = e.actions.get(d.cle);
    if (existante) {
      const meme = existante.cmd.acteur === p.id && existante.cmd.cible === o.id && existante.cmd.capacite === d.capacite &&
        JSON.stringify(existante.cmd.parametres) === JSON.stringify(parametres);
      if (!meme) throw new ErreurApi(409, 'conflit_idempotence');
      return d.executer === true && p.peutApprouver && !canalCle() ? this.approuver(p, sid, d.cle) : this.#vueAction(existante, e, p);
    }
    const maintenant = this.#o.maintenant().toISOString();
    const cmd: CommandeAction = transition(
      {
        cleIdempotence: d.cle, orgId: ORG_DEMO, acteur: p.id, capacite: d.capacite as string, cible: o.id, parametres,
        approuvePar: null, etat: 'brouillon', mode: e.simulation ? 'simulation' : 'demo',
      },
      'en_attente',
    );
    // une clé d'API (agent IA, script) prépare seulement : une PERSONNE approuve, à l'écran (surveillance humaine),
    // même si le profil de la clé peut approuver ; « approuvé par » désigne donc toujours quelqu'un
    const via = canalCle();
    e.actions.set(d.cle, { cmd, creeLe: maintenant, majLe: maintenant, message: null, ...(via ? { via } : {}) });
    this.#tracer(p, e, 'action.preparee', o.id, `${cmd.capacite} ${JSON.stringify(parametres)}`);
    if (d.executer === true && p.peutApprouver && !via) return this.approuver(p, sid, d.cle);
    return this.#vueAction(e.actions.get(d.cle) as ActionEnregistree, e, p);
  }

  async approuver(p: Profil, sid: string, cle: unknown) {
    if (!p.peutApprouver) throw new ErreurApi(403, 'interdit', 'Seul un rôle habilité peut approuver.');
    if (canalCle()) throw new ErreurApi(403, 'session_requise', 'Approbation réservée à une personne, depuis l’écran de Living Business : une clé d’API (agent IA, script) ne peut pas approuver.');
    if (typeof cle !== 'string' || !CLE_SURE.test(cle)) throw new ErreurApi(404, 'introuvable');
    const e = this.#espace(sid);
    const a = e.actions.get(cle);
    if (!a) throw new ErreurApi(404, 'introuvable');
    this.#objetVisible(p, e, a.cmd.cible);
    if (a.cmd.etat === 'en_attente') {
      a.cmd = { ...transition(a.cmd, 'approuvee'), approuvePar: p.id };
      this.#tracer(p, e, 'action.approuvee', a.cmd.cible, cle);
    }
    if (a.cmd.etat === 'approuvee') {
      const fin = await e.registre.executer(a.cmd, this.#executeur(e, cle), this.#executeur(e, cle));
      if (a.cmd.etat === 'approuvee') {
        a.cmd = fin;
        a.majLe = this.#o.maintenant().toISOString();
        this.#tracer(p, e, `action.${fin.etat}`, fin.cible, a.message ?? '');
        if (!e.simulation) this.#recalculerQuetes();
      }
    }
    return this.#vueAction(a, e, p);
  }

  // ---------------------------------------------------------------- simulation

  definirSimulation(sid: string, actif: boolean): void {
    if (actif && !this.#sims.has(sid)) this.#sims.set(sid, copierEspace(this.#reel, true));
    if (!actif) this.#sims.delete(sid); // sortie : l'état réel est restauré tel quel
  }

  oublierSession(sid: string): void {
    this.#sims.delete(sid);
  }

  // ---------------------------------------------------------------- univers

  changerUnivers(p: Profil, sid: string, id: unknown): void {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (this.#sims.has(sid)) throw new ErreurApi(409, 'simulation_active', 'Quittez la simulation pour changer d’univers.');
    const u = typeof id === 'string' ? this.#catalogue.get(id) : undefined;
    if (!u) throw new ErreurApi(400, 'univers_inconnu');
    const invalides = [...this.#reel.objets.values()].filter((o) => validerObjet(u, o).length > 0);
    if (invalides.length) throw new ErreurApi(409, 'univers_incompatible', `${pluriel(invalides.length, 'objet incompatible', 'objets incompatibles')} avec cet univers.`);
    this.#univers = u;
    this.#tracer(p, this.#reel, 'univers.change', null, u.id);
    this.#recalculerQuetes();
  }

  // ---------------------------------------------------------------- import CSV

  #typeImportable(p: Profil, sid: string, typeId: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (this.#sims.has(sid)) throw new ErreurApi(409, 'simulation_active', 'Quittez la simulation pour importer.');
    const t = typeof typeId === 'string' ? defType(this.#univers, typeId) : undefined;
    if (!t || t.masque || t.famille === 'organisation') throw new ErreurApi(400, 'type_inconnu');
    return t;
  }

  analyserImport(p: Profil, sid: string, d: unknown) {
    if (!estObj(d) || typeof d.csv !== 'string') throw new ErreurApi(400, 'csv_attendu');
    const t = this.#typeImportable(p, sid, d.type);
    const lignes = this.#parser(d.csv);
    const [entetes = [], ...corps] = lignes;
    return {
      type: t.id,
      entetes,
      apercu: corps.slice(0, 5),
      lignes: corps.length,
      mapping: proposerMapping(entetes, t),
      cibles: [
        { id: NOM, libelle: 'Nom (obligatoire)' },
        ...(t.famille === 'tiers' ? [{ id: ROLES, libelle: 'Rôles (client, fournisseur…)' }] : []),
        ...t.champs.map((c) => ({ id: c.id, libelle: c.libelle })),
      ],
    };
  }

  #parser(csv: string): string[][] {
    try {
      return parserCsv(csv);
    } catch (e) {
      throw new ErreurApi(400, 'csv_invalide', e instanceof Error ? e.message : 'CSV invalide');
    }
  }

  confirmerImport(p: Profil, sid: string, d: unknown) {
    if (!estObj(d) || typeof d.csv !== 'string' || !estObj(d.mapping)) throw new ErreurApi(400, 'requete_invalide');
    const t = this.#typeImportable(p, sid, d.type);
    const nomFichier = typeof d.nomFichier === 'string' ? d.nomFichier.replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 80) || 'fichier.csv' : 'fichier.csv';
    const empreinte = createHash('sha256').update(`${t.id}\n${d.csv}`).digest('hex');
    if (this.#importsFaits.has(empreinte)) throw new ErreurApi(409, 'deja_importe', 'Ce fichier a déjà été importé.');

    const [entetes = [], ...corps] = this.#parser(d.csv);
    const ciblesValides = new Set([NOM, ...(t.famille === 'tiers' ? [ROLES] : []), ...t.champs.map((c) => c.id)]);
    const colonne = new Map<string, number>();
    for (const [entete, cible] of Object.entries(d.mapping)) {
      if (cible === null || cible === '') continue;
      if (typeof cible !== 'string' || !ciblesValides.has(cible)) throw new ErreurApi(400, 'mapping_invalide', `Cible inconnue : ${String(cible)}`);
      const i = entetes.indexOf(entete);
      if (i === -1) throw new ErreurApi(400, 'mapping_invalide', `Colonne absente : ${entete}`);
      if (colonne.has(cible)) throw new ErreurApi(400, 'mapping_invalide', `Cible en double : ${cible}`);
      colonne.set(cible, i);
    }
    if (!colonne.has(NOM)) throw new ErreurApi(400, 'mapping_invalide', 'Choisissez la colonne du nom.');

    const rolesParDefaut = Array.isArray(d.rolesParDefaut)
      ? d.rolesParDefaut.filter((r): r is string => typeof r === 'string' && this.#univers.roles.some((x) => x.id === r))
      : [];
    const maintenant = this.#o.maintenant().toISOString();
    const source = { id: `import:${nomFichier}`, libelle: `Import ${nomFichier}`, derniereSynchro: maintenant };
    const parNom = (famille: string, role?: string) => {
      const m = new Map<string, string>();
      for (const o of this.#reel.objets.values()) if (o.famille === famille && (!role || o.roles.includes(role))) m.set(normaliser(o.nom), o.id);
      return m;
    };
    const rejets: { ligne: number; erreurs: string[] }[] = [];
    const nouveaux: ObjetMetier[] = [];
    corps.forEach((ligne, i) => {
      const erreurs: string[] = [];
      const cell = (cible: string) => (colonne.has(cible) ? (ligne[colonne.get(cible) as number] ?? '') : '');
      const nom = cell(NOM).trim();
      if (nom.length < 1 || nom.length > 200) erreurs.push('nom manquant ou trop long');
      const champs: Record<string, ValeurChamp> = {};
      for (const c of t.champs) {
        if (!colonne.has(c.id)) continue;
        const r = convertir(cell(c.id), c);
        if (!r.ok) { erreurs.push(`${c.libelle} : ${r.erreur}`); continue; }
        if (c.type === 'reference' && typeof r.valeur === 'string') {
          const id = c.cible ? parNom(c.cible.famille, c.cible.role).get(normaliser(r.valeur)) : undefined;
          if (!id) { erreurs.push(`${c.libelle} : « ${r.valeur} » introuvable`); continue; }
          champs[c.id] = id;
        } else if (r.valeur !== null) champs[c.id] = r.valeur;
      }
      const roles: string[] = [];
      if (t.famille === 'tiers' && !colonne.has(ROLES)) roles.push(...rolesParDefaut);
      if (colonne.has(ROLES)) {
        for (const brut of cell(ROLES).split(/[,;/|]/).map((x) => x.trim()).filter(Boolean)) {
          const n = normaliser(brut);
          const r = this.#univers.roles.find((x) => normaliser(x.id) === n || normaliser(x.libelle) === n || normaliser(x.pluriel) === n);
          if (r) roles.push(r.id);
          else erreurs.push(`rôle « ${brut} » inconnu`);
        }
      }
      const o: ObjetMetier = {
        id: `imp-${randomUUID()}`, orgId: ORG_DEMO, famille: t.famille, type: t.id, roles: [...new Set(roles)], nom, champs,
        provenance: 'declare', source, majLe: maintenant, disponibilite: 'disponible', mode: 'reel',
      };
      erreurs.push(...validerObjet(this.#univers, o));
      if (erreurs.length) rejets.push({ ligne: i + 2, erreurs });
      else nouveaux.push(o);
    });
    for (const o of nouveaux) this.#reel.objets.set(o.id, o);
    if (nouveaux.length) this.#importsFaits.add(empreinte);
    this.#tracer(p, this.#reel, 'import', null, `${t.id} : ${nouveaux.length} créés, ${rejets.length} rejetés`);
    this.#recalculerQuetes();
    return { crees: nouveaux.length, rejets: rejets.slice(0, 100), totalRejets: rejets.length };
  }

  // ---------------------------------------------------------------- connecter mes données

  connecteurs() {
    return CONNECTEURS;
  }

  demanderConnecteur(p: Profil, id: unknown): { ok: true } {
    const c = CONNECTEURS.find((x) => x.id === id);
    if (!c) throw new ErreurApi(400, 'connecteur_inconnu');
    this.#tracer(p, this.#reel, 'connecteur.demande', null, c.nom);
    return { ok: true };
  }

  /** Google Sheets publié en CSV : télécharge puis analyse comme un import CSV. */
  async analyserSheets(p: Profil, sid: string, d: unknown, f: typeof fetch = recuperateurProtege) {
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    this.#typeImportable(p, sid, d.type);
    const v = validerLienSheets(d.url);
    if (!v.ok) throw new ErreurApi(400, 'lien_invalide', v.erreur);
    let csv: string;
    try {
      csv = await telechargerSheets(v.url, f);
    } catch (e) {
      throw new ErreurApi(502, 'sheets_indisponible', e instanceof Error ? e.message : 'Google Sheets injoignable.');
    }
    this.#tracer(p, this.#reel, 'connecteur.sheets.lecture', null, v.url.pathname.slice(0, 80));
    return { csv, nomFichier: 'google-sheets.csv', ...this.analyserImport(p, sid, { type: d.type, csv }) };
  }

  /** Saisie manuelle d'un objet (client, fournisseur, employé…), validée par l'univers. */
  creerObjet(p: Profil, sid: string, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (this.#sims.has(sid)) throw new ErreurApi(409, 'simulation_active', 'Quittez la simulation pour ajouter des données.');
    if (!estObj(d) || !estObj(d.champs)) throw new ErreurApi(400, 'requete_invalide');
    const t = this.#typeImportable(p, sid, d.type);
    const nom = typeof d.nom === 'string' ? d.nom.trim() : '';
    if (nom.length < 1 || nom.length > 200) throw new ErreurApi(400, 'nom_invalide', 'Indiquez un nom (200 caractères max).');
    const champs: Record<string, ValeurChamp> = {};
    for (const [k, v] of Object.entries(d.champs)) {
      if (v === null || v === '' || v === undefined) continue;
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new ErreurApi(400, 'champ_invalide', k);
      champs[k] = v;
    }
    const roles = Array.isArray(d.roles) ? [...new Set(d.roles.filter((r): r is string => typeof r === 'string'))] : [];
    const maintenant = this.#o.maintenant().toISOString();
    const o: ObjetMetier = {
      id: `obj-${randomUUID()}`, orgId: ORG_DEMO, famille: t.famille, type: t.id, roles: t.famille === 'tiers' ? roles : [], nom, champs,
      provenance: 'declare', source: { id: 'saisie', libelle: 'Saisie manuelle', derniereSynchro: maintenant },
      majLe: maintenant, disponibilite: 'disponible', mode: 'reel',
    };
    const problemes = validerObjet(this.#univers, o);
    if (problemes.length) throw new ErreurApi(400, 'objet_invalide', problemes.join(' ; '));
    this.#reel.objets.set(o.id, o);
    this.#tracer(p, this.#reel, 'objet.cree', o.id, `${t.id} ${nom}`);
    this.#recalculerQuetes();
    return this.#vueObjet(o, this.#reel, p);
  }

  /** Données présentes avant l'installation (pour proposer de les garder). */
  contenuExistant(): { objets: number; reels: number; organisation: string | null } {
    const objets = [...this.#reel.objets.values()];
    const reels = objets.filter((o) => o.mode !== 'demo');
    return { objets: objets.length, reels: reels.length, organisation: reels.find((o) => o.famille === 'organisation')?.nom ?? null };
  }

  /**
   * Installation (appelée une seule fois, par l'application, avant la création du compte propriétaire).
   * - `vide` : on part de zéro avec le nom de l'entreprise (les données fictives éventuelles sont retirées, jamais les vôtres) ;
   * - `exemple` : on découvre d'abord avec un exemple fictif (à vider ensuite avec « Créer mon entreprise ») ;
   * - `garder` : on garde les données déjà présentes.
   * Renvoie le profil du propriétaire (tous les droits).
   */
  initialiser(d: { nom: string; entreprise: string; depart: 'vide' | 'exemple' | 'garder'; exemple?: Exemple | undefined }): Profil {
    const tout = { types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous', peutPreparer: true, peutApprouver: true, voitScore: true, peutAdministrer: true } as const;
    let proprietaire: Profil;
    if (d.depart === 'exemple') {
      this.#chargerExemple(d.exemple === 'eti' ? 'eti' : 'pme');
      this.#profils = structuredClone(PROFILS_DEMO) as Profil[];
      proprietaire = this.#profils.find((x) => x.peutAdministrer) as Profil;
      proprietaire.nom = d.nom;
    } else {
      if (d.depart === 'vide') {
        for (const [id, o] of this.#reel.objets) if (o.mode === 'demo') this.#reel.objets.delete(id);
        for (const [cle, a] of this.#reel.actions) if (!this.#reel.objets.has(a.cmd.cible)) this.#reel.actions.delete(cle);
        for (const id of [...this.#reel.planning.keys()]) if (!this.#reel.objets.has(id)) this.#reel.planning.delete(id);
        this.#profils = [];
        this.#exemple = null;
      }
      const existant = this.#profils.find((x) => x.peutAdministrer);
      proprietaire = existant ?? { id: 'proprietaire', nom: d.nom, role: 'dirigeant', ...tout };
      proprietaire.nom = d.nom;
      if (!existant) this.#profils.unshift(proprietaire);
      if (![...this.#reel.objets.values()].some((o) => o.famille === 'organisation')) {
        const maintenant = this.#o.maintenant().toISOString();
        this.#reel.objets.set('org', {
          id: 'org', orgId: ORG_DEMO, famille: 'organisation', type: 'mon_entreprise', roles: [], nom: uneLigne(d.entreprise), champs: {},
          provenance: 'declare', source: { id: 'saisie', libelle: 'Saisie manuelle', derniereSynchro: maintenant },
          majLe: maintenant, disponibilite: 'disponible', mode: 'reel',
        });
      }
    }
    this.#quetes = new Map();
    this.#recalculerQuetes();
    this.#tracer(proprietaire, this.#reel, 'installation', null, `${d.depart} — ${d.entreprise}`);
    return proprietaire;
  }

  /** Retire toutes les données fictives et nomme l'entreprise : le monde devient le vôtre. */
  viderDemo(p: Profil, sid: string, d: unknown, garder: ReadonlySet<string> = new Set()) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (this.#sims.has(sid)) throw new ErreurApi(409, 'simulation_active');
    const nom = estObj(d) && typeof d.nom === 'string' ? uneLigne(d.nom) : '';
    if (nom.length < 1 || nom.length > 120) throw new ErreurApi(400, 'nom_invalide', 'Indiquez le nom de votre entreprise.');
    for (const [id, o] of this.#reel.objets) if (o.mode === 'demo') this.#reel.objets.delete(id);
    for (const [cle, a] of this.#reel.actions) if (!this.#reel.objets.has(a.cmd.cible)) this.#reel.actions.delete(cle);
    for (const id of [...this.#reel.planning.keys()]) if (!this.#reel.objets.has(id)) this.#reel.planning.delete(id);
    const maintenant = this.#o.maintenant().toISOString();
    if (![...this.#reel.objets.values()].some((o) => o.famille === 'organisation')) {
      this.#reel.objets.set('org', {
        id: 'org', orgId: ORG_DEMO, famille: 'organisation', type: 'mon_entreprise', roles: [], nom, champs: {},
        provenance: 'declare', source: { id: 'saisie', libelle: 'Saisie manuelle', derniereSynchro: maintenant },
        majLe: maintenant, disponibilite: 'disponible', mode: 'reel',
      });
    }
    // les profils d'exemple (Yann, Nolwenn…) visent des lieux fictifs : retirés, sauf s'ils ont un compte
    const demo = new Set(PROFILS_DEMO.map((x) => x.id));
    this.#profils = this.#profils.filter((x) => !demo.has(x.id) || x.id === p.id || garder.has(x.id));
    this.#quetes = new Map();
    this.#reussites = this.#reussites.filter((r) => !r.exemple); // les réussites d'exemple ne suivent jamais
    this.#tracer(p, this.#reel, 'monde.vide', null, nom);
    this.#recalculerQuetes();
    return { ok: true, organisation: this.organisation };
  }

  // ---------------------------------------------------------------- accès des modules (synchro, formulaires, automatisations)

  /** Visibilité d'un objet RÉEL pour un profil (contrôle des modules). */
  estVisible(p: Profil, id: unknown): boolean {
    if (typeof id !== 'string') return false;
    const o = this.#reel.objets.get(id);
    return o !== undefined && this.#visible(p, o, this.#reel.objets);
  }

  objetReel(id: string): ObjetMetier | null {
    return this.#reel.objets.get(id) ?? null;
  }

  objetsReels(): readonly ObjetMetier[] {
    return [...this.#reel.objets.values()];
  }

  situationsReelles(): Situation[] {
    return this.#situations(this.#reel);
  }

  journalBrut(): readonly { le: string; acteur: string; action: string; cible: string | null; detail: string }[] {
    return this.#journal;
  }

  /** Événements de sécurité gardés à part (12 mois), du plus ancien au plus récent. */
  journalSecuriteBrut(): readonly LigneJournal[] {
    return this.#journalSecurite;
  }

  planningReel(): ReadonlyMap<string, ReadonlyMap<string, string>> {
    return this.#reel.planning;
  }

  get univers(): Univers {
    return this.#univers;
  }

  maintenant(): Date {
    return this.#o.maintenant();
  }

  /** Empreinte du contenu métier d'un objet (détection des changements à pousser vers l'extérieur). */
  empreinte(id: string): string | null {
    const o = this.#reel.objets.get(id);
    if (!o) return null;
    const champs = Object.keys(o.champs).sort().map((k) => [k, o.champs[k]]);
    return createHash('sha256').update(JSON.stringify([o.nom, [...o.roles].sort(), champs])).digest('base64url').slice(0, 22);
  }

  /** Valeurs d'un objet pour l'export vers un outil (références → nom, rôles → libellés). */
  valeursExport(id: string, cibles: readonly string[]): Record<string, ValeurChamp> {
    const o = this.#reel.objets.get(id);
    if (!o) return {};
    const t = defType(this.#univers, o.type);
    const res: Record<string, ValeurChamp> = {};
    for (const cible of cibles) {
      if (cible === NOM) res[cible] = o.nom;
      else if (cible === ROLES) res[cible] = o.roles.map((r) => libelleRole(this.#univers, r)).join(', ');
      else {
        const c = t?.champs.find((x) => x.id === cible);
        const v = o.champs[cible] ?? null;
        res[cible] = c?.type === 'reference' && typeof v === 'string' ? (this.#reel.objets.get(v)?.nom ?? null) : v;
      }
    }
    return res;
  }

  /** Crée un objet réel au nom d'un acteur technique (formulaire, automatisation). */
  creerObjetSysteme(acteur: string, typeId: string, nom: string, champs: Record<string, ValeurChamp>, source: { id: string; libelle: string }, roles: string[] = []): string {
    const t = defType(this.#univers, typeId);
    if (!t) throw new ErreurApi(400, 'type_inconnu');
    const maintenant = this.#o.maintenant().toISOString();
    // rattaché à une fiche fictive → fictif aussi (disparaît avec la démo, jamais mêlé au réel)
    const lie = [champs.concerne, champs.departement].map((x) => (typeof x === 'string' ? this.#reel.objets.get(x) : undefined)).find(Boolean);
    const mode = lie?.mode === 'demo' ? 'demo' : 'reel';
    const o: ObjetMetier = {
      id: `obj-${randomUUID()}`, orgId: ORG_DEMO, famille: t.famille, type: t.id, roles: t.famille === 'tiers' ? roles : [], nom: nom.slice(0, 200), champs,
      provenance: 'declare', source: { ...source, derniereSynchro: maintenant }, majLe: maintenant, disponibilite: 'disponible', mode,
    };
    const pb = validerObjet(this.#univers, o);
    if (pb.length) throw new ErreurApi(400, 'objet_invalide', pb.join(' ; '));
    this.#reel.objets.set(o.id, o);
    this.#tracer({ ...SYSTEME, id: acteur }, this.#reel, 'objet.cree', o.id, `${t.id} ${o.nom}`);
    this.#recalculerQuetes();
    return o.id;
  }

  /** Retire des objets réels au nom d'un acteur technique (données rendues anonymes) : le journal ne garde que le nombre. */
  retirerObjetsSysteme(acteur: string, ids: readonly string[], motif: string): number {
    let n = 0;
    for (const id of ids) if (this.#reel.objets.delete(id)) n++;
    if (n) {
      this.#tracer({ ...SYSTEME, id: acteur }, this.#reel, 'objets.retires', null, `${n} ${motif}`);
      this.#recalculerQuetes();
    }
    return n;
  }

  /** Modifie des champs d'un objet réel au nom d'un acteur technique (statut, réponse…). */
  majObjetSysteme(acteur: string, id: string, champs: Record<string, ValeurChamp>): void {
    const o = this.#reel.objets.get(id);
    if (!o) throw new ErreurApi(404, 'introuvable');
    const modifie: ObjetMetier = { ...o, champs: { ...o.champs, ...champs }, majLe: this.#o.maintenant().toISOString() };
    const pb = validerObjet(this.#univers, modifie);
    if (pb.length) throw new ErreurApi(400, 'objet_invalide', pb.join(' ; '));
    this.#reel.objets.set(id, modifie);
    this.#tracer({ ...SYSTEME, id: acteur }, this.#reel, 'objet.modifie', id, Object.keys(champs).join(', '));
    this.#recalculerQuetes();
  }

  #construire(t: ReturnType<typeof defType> & object, valeurs: Record<string, string>, rolesParDefaut: readonly string[]) {
    const erreurs: string[] = [];
    const nom = (valeurs[NOM] ?? '').trim();
    if (nom.length < 1 || nom.length > 200) erreurs.push('nom manquant ou trop long');
    const champs: Record<string, ValeurChamp> = {};
    for (const c of t.champs) {
      if (!(c.id in valeurs)) continue;
      const r = convertir(valeurs[c.id] ?? '', c);
      if (!r.ok) { erreurs.push(`${c.libelle} : ${r.erreur}`); continue; }
      if (c.type === 'reference' && typeof r.valeur === 'string') {
        const n = normaliser(r.valeur);
        const ref = [...this.#reel.objets.values()].find((x) => (!c.cible || (x.famille === c.cible.famille && (!c.cible.role || x.roles.includes(c.cible.role)))) && (normaliser(x.nom) === n || x.id === r.valeur));
        if (!ref) { erreurs.push(`${c.libelle} : « ${r.valeur} » introuvable`); continue; }
        champs[c.id] = ref.id;
      } else champs[c.id] = r.valeur;
    }
    const roles: string[] = [];
    if (t.famille === 'tiers') {
      if (ROLES in valeurs) {
        for (const brut of (valeurs[ROLES] ?? '').split(/[,;/|]/).map((x) => x.trim()).filter(Boolean)) {
          const n = normaliser(brut);
          const r = this.#univers.roles.find((x) => normaliser(x.id) === n || normaliser(x.libelle) === n || normaliser(x.pluriel) === n);
          if (r) roles.push(r.id);
        }
      }
      if (!roles.length) roles.push(...rolesParDefaut);
    }
    return { nom, champs, roles: [...new Set(roles)], erreurs };
  }

  /**
   * Applique des lignes venues d'un outil externe (réel → jeu). Mise à jour des objets liés,
   * création des nouveaux ; seuls les champs fournis sont modifiés. Renvoie les liens externeId → objet.
   */
  appliquerExterne(source: { id: string; libelle: string }, typeId: string, rolesParDefaut: readonly string[], lignes: readonly LigneExterne[], liens: Readonly<Record<string, string>>) {
    const t = defType(this.#univers, typeId);
    if (!t || t.masque || t.famille === 'organisation') throw new ErreurApi(400, 'type_inconnu');
    const maintenant = this.#o.maintenant().toISOString();
    const nouveauxLiens: Record<string, string> = { ...liens };
    let crees = 0;
    let maj = 0;
    const rejets: { externeId: string; erreurs: string[] }[] = [];
    for (const l of lignes.slice(0, 5000)) {
      const b = this.#construire(t, l.valeurs, rolesParDefaut);
      const existant = nouveauxLiens[l.externeId] ? this.#reel.objets.get(nouveauxLiens[l.externeId] as string) : undefined;
      if (existant) {
        const champs: Record<string, ValeurChamp> = { ...existant.champs };
        const vide = (v: unknown) => v === undefined || v === null || v === '';
        for (const c of t.champs) {
          if (!(c.id in l.valeurs)) continue;
          const v = b.champs[c.id];
          // lien posé par simple homonymie, pas encore confirmé : l'outil complète les champs vides, sauf ce qui
          // identifie ou permet de joindre (e-mail, contact, SIRET, adresse) — sinon l'inconnu homonyme d'un outil
          // inscrirait ses coordonnées sur la vraie fiche (contre-revue de l'audit, constat revue-jeu-1-2)
          if (l.completer) { if (!CHAMP_IDENTITE.test(c.id) && vide(champs[c.id]) && !vide(v)) champs[c.id] = v as ValeurChamp; continue; }
          if (v === undefined || v === null) delete champs[c.id]; else champs[c.id] = v as ValeurChamp;
        }
        const candidat: ObjetMetier = l.completer
          ? { ...existant, champs, roles: existant.roles.length || !(ROLES in l.valeurs) ? existant.roles : b.roles }
          : { ...existant, nom: b.nom || existant.nom, champs, roles: ROLES in l.valeurs && b.roles.length ? b.roles : existant.roles };
        const avant = this.empreinte(existant.id);
        if (validerObjet(this.#univers, candidat).length) { rejets.push({ externeId: l.externeId, erreurs: validerObjet(this.#univers, candidat) }); continue; }
        this.#reel.objets.set(existant.id, candidat);
        if (this.empreinte(existant.id) !== avant) {
          this.#reel.objets.set(existant.id, { ...candidat, majLe: maintenant, provenance: 'confirme', source: { ...source, derniereSynchro: maintenant } });
          maj++;
        }
        continue;
      }
      if (b.erreurs.length) { rejets.push({ externeId: l.externeId, erreurs: b.erreurs }); continue; }
      const o: ObjetMetier = {
        id: `ext-${randomUUID()}`, orgId: ORG_DEMO, famille: t.famille, type: t.id, roles: b.roles, nom: b.nom, champs: b.champs,
        provenance: 'confirme', source: { ...source, derniereSynchro: maintenant }, majLe: maintenant, disponibilite: 'disponible', mode: 'reel',
      };
      const pb = validerObjet(this.#univers, o);
      if (pb.length) { rejets.push({ externeId: l.externeId, erreurs: pb }); continue; }
      this.#reel.objets.set(o.id, o);
      nouveauxLiens[l.externeId] = o.id;
      crees++;
    }
    if (crees || maj) {
      this.#tracer({ ...SYSTEME, id: source.id }, this.#reel, 'synchro.entrante', null, `${source.libelle} : ${pluriel(crees, 'créé', 'créés')}, ${maj} mis à jour`);
      this.#recalculerQuetes();
    }
    return { crees, maj, rejets: rejets.slice(0, 50), totalRejets: rejets.length, liens: nouveauxLiens };
  }

  /**
   * Le même identifiant fort des deux côtés (e-mail ou SIRET renseigné ET égal, pas seulement « non contradictoire ») :
   * la fiche et l'enregistrement de l'outil désignent bien la même entité, le rapprochement n'a pas à être confirmé.
   */
  memeIdentifiantFort(objId: string, valeurs: Readonly<Record<string, string>>): boolean {
    const x = this.#reel.objets.get(objId);
    if (!x) return false;
    const fort = (champ: string, v: unknown) => {
      const t = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
      return champ === 'siret' ? t.replace(/\D/g, '') : t.toLowerCase();
    };
    return ['siret', 'email'].some((champ) => { const a = fort(champ, x.champs[champ]); return a !== '' && a === fort(champ, valeurs[champ]); });
  }

  /**
   * Fiche existante à relier à un enregistrement d'un outil (même nom) — évite les doublons. Jamais une fiche de
   * `exclus` (tenue par un autre outil), jamais si l'e-mail ou le SIRET connus des deux côtés diffèrent, jamais en
   * cas d'homonymes.
   */
  rapprocher(typeId: string, nom: string, o: { exclus?: ReadonlySet<string>; valeurs?: Readonly<Record<string, string>> } = {}): string | null {
    const n = normaliser(nom);
    const fort = (champ: string, v: unknown) => {
      const t = typeof v === 'string' || typeof v === 'number' ? String(v).trim() : '';
      return champ === 'siret' ? t.replace(/\D/g, '') : t.toLowerCase();
    };
    const candidats = [...this.#reel.objets.values()].filter((x) => x.type === typeId && x.mode === 'reel' && normaliser(x.nom) === n);
    if (candidats.length !== 1) return null;
    const x = candidats[0] as ObjetMetier;
    if (o.exclus?.has(x.id)) return null;
    for (const champ of ['siret', 'email']) {
      const a = fort(champ, x.champs[champ]);
      const b = fort(champ, o.valeurs?.[champ]);
      if (a && b && a !== b) return null;
    }
    return x.id;
  }

  // ---------------------------------------------------------------- effacement et droit d'accès (RGPD)

  /**
   * Efface une fiche réelle (droit à l'effacement d'un client particulier, départ d'un salarié…) ou l'anonymise
   * (les chiffres restent, ce qui identifie part). En cascade : planning de la personne et cases qui visent la fiche,
   * références des autres fiches, actions, et dans le journal le nom et les textes de la fiche (la trace de
   * l'effacement ne garde que le type). Administrateur, hors simulation. Les modules (connecteurs, formulaires,
   * automatisations) oublient la fiche ensuite (Application.effacerObjet).
   */
  effacerObjet(p: Profil, sid: string, id: unknown, d: unknown = {}): { ok: true; id: string; mode: 'supprimer' | 'anonymiser'; references: number } {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (this.#sims.has(sid)) throw new ErreurApi(409, 'simulation_active', 'Quittez la simulation pour effacer une fiche.');
    const o = this.#objetVisible(p, this.#reel, id);
    if (o.famille === 'organisation') throw new ErreurApi(409, 'organisation', 'La fiche de votre entreprise ne s’efface pas.');
    const mode = estObj(d) && d.mode === 'anonymiser' ? 'anonymiser' : 'supprimer';
    return this.#effacer(p, o, mode);
  }

  /**
   * Durées de conservation choisies par l'entreprise : planning d'avant `planningAvant` (AAAA-MM-JJ) effacé, avis
   * clients reçus avant `avisAvant` et courrier TRAITÉ reçu avant `courrierAvant` effacés (en cascade, sans nom au
   * journal : une seule trace avec les nombres). Renvoie les ids effacés (les modules les oublient ensuite).
   */
  purgerAnciennes(l: { planningAvant: string | null; avisAvant: string | null; courrierAvant: string | null }): { cases: number; ids: string[] } {
    let cases = 0;
    if (l.planningAvant) {
      for (const jours of this.#reel.planning.values()) for (const j of [...jours.keys()]) if (j < l.planningAvant) { jours.delete(j); cases++; }
    }
    const recu = (o: ObjetMetier) => (typeof o.champs.recu_le === 'string' ? o.champs.recu_le.slice(0, 10) : o.majLe.slice(0, 10));
    const vieux = [...this.#reel.objets.values()].filter((o) => o.mode === 'reel' && (
      (l.avisAvant && o.type === 'avis_client' && recu(o) < l.avisAvant) ||
      (l.courrierAvant && o.type === 'courrier' && o.champs.statut === 'traité' && recu(o) < l.courrierAvant)));
    const acteur = { ...SYSTEME, id: 'systeme:conservation' };
    for (const o of vieux) this.#effacer(acteur, o, 'supprimer', false);
    if (cases || vieux.length) {
      this.#tracer(acteur, this.#reel, 'conservation.purge', null, `${pluriel(cases, 'case de planning', 'cases de planning')}, ${pluriel(vieux.length, 'fiche', 'fiches')} (avis, courrier traité) effacées`);
      this.#recalculerQuetes();
    }
    return { cases, ids: vieux.map((o) => o.id) };
  }

  /** Rejoue un effacement après une restauration (registre gardé hors des sauvegardes) ; sans effet si la fiche n'est plus là. */
  rejouerEffacement(id: string, mode: 'supprimer' | 'anonymiser'): boolean {
    const o = this.#reel.objets.get(id);
    if (!o || o.famille === 'organisation' || (mode === 'anonymiser' && o.source.id === 'effacement')) return false;
    this.#effacer({ ...SYSTEME, id: 'systeme:effacements' }, o, mode);
    return true;
  }

  #effacer(p: Profil, o: ObjetMetier, mode: 'supprimer' | 'anonymiser', trace = true) {
    const t = defType(this.#univers, o.type);
    const textes = (t?.champs ?? []).filter((c) => c.type === 'texte').map((c) => o.champs[c.id]).filter((v): v is string => typeof v === 'string' && v.trim().length >= 3);
    const aRetirer = [o.nom, ...textes].filter((x) => x.trim().length >= 2).sort((a, b) => b.length - a.length);
    const maintenant = this.#o.maintenant().toISOString();
    let references = 0;
    for (const e of [this.#reel, ...this.#sims.values()]) {
      if (mode === 'supprimer') {
        e.objets.delete(o.id);
        e.modifies.delete(o.id);
        for (const [cle, a] of e.actions) if (a.cmd.cible === o.id) e.actions.delete(cle);
        // références des autres fiches (client d'une facture, responsable d'une tâche…) : vidées, et le nom de la
        // fiche effacée retiré de leur titre et de leurs textes (« Relancer Cave du Port » → « Relancer [effacé] »)
        const ailleurs = aRetirer.filter((x) => x.length >= 4);
        const nettoyer = (v: string) => ailleurs.reduce((acc, x) => acc.split(x).join('[effacé]'), v);
        for (const [k, x] of e.objets) {
          const tx = defType(this.#univers, x.type);
          const refs = (tx?.champs ?? []).filter((c) => c.type === 'reference' && x.champs[c.id] === o.id).map((c) => c.id);
          if (!refs.length) continue;
          const champs = { ...x.champs };
          for (const c of refs) delete champs[c];
          for (const c of tx?.champs ?? []) if (c.type === 'texte' && typeof champs[c.id] === 'string') champs[c.id] = nettoyer(champs[c.id] as string);
          e.objets.set(k, { ...x, nom: nettoyer(x.nom) || x.nom, champs, majLe: maintenant });
          if (e === this.#reel) references += refs.length;
        }
        // cases de planning qui visaient ce lieu ou ce projet : « non affecté »
        for (const cases of e.planning.values()) for (const [jour, v] of cases) if (v === `lieu:${o.id}` || v === `projet:${o.id}`) cases.set(jour, '');
      } else if (e.objets.has(o.id)) {
        // anonymisée : ni nom ni texte libre (e-mail, contact, commentaire…) ; chiffres, dates et listes gardés
        const champs: Record<string, ValeurChamp> = {};
        for (const c of t?.champs ?? []) if (c.type !== 'texte' && o.champs[c.id] !== undefined) champs[c.id] = o.champs[c.id] as ValeurChamp;
        e.objets.set(o.id, { ...o, nom: 'Fiche anonymisée', champs, majLe: maintenant, source: { id: 'effacement', libelle: 'Fiche anonymisée', derniereSynchro: maintenant } });
      }
      // planning d'une personne (absences comprises) : effacé dans les deux cas
      if (o.famille === 'personne') e.planning.delete(o.id);
    }
    // journal : plus de nom ni de texte de la fiche, et ses traces ne la désignent plus
    // (ailleurs que dans ses propres traces, seulement les textes d'au moins 4 caractères : pas de mot mutilé)
    const remplacer = (texte: string, liste: readonly string[]) => liste.reduce((acc, x) => acc.split(x).join('[effacé]'), texte);
    const ailleurs = aRetirer.filter((x) => x.length >= 4);
    const sansLaFiche = (l: LigneJournal): LigneJournal => (l.cible === o.id ? { ...l, cible: mode === 'supprimer' ? null : l.cible, detail: remplacer(l.detail, aRetirer) }
      : ailleurs.some((x) => l.detail.includes(x)) ? { ...l, detail: remplacer(l.detail, ailleurs) } : l);
    this.#journal = this.#journal.map(sansLaFiche);
    this.#journalSecurite = this.#journalSecurite.map(sansLaFiche);
    this.#affectationsRecentes.clear(); // les lignes ont été recopiées : plus de regroupement sur les anciennes
    if (trace) {
      this.#tracer(p, this.#reel, mode === 'supprimer' ? 'objet.efface' : 'objet.anonymise', mode === 'supprimer' ? null : o.id, `${t?.libelle ?? o.type} : ${mode === 'supprimer' ? 'fiche effacée' : 'fiche anonymisée'}`);
      this.#recalculerQuetes();
    }
    return { ok: true as const, id: o.id, mode, references };
  }

  /**
   * Droit d'accès (art. 15) : tout ce que le jeu garde sur une fiche (champs, planning, actions, traces du journal,
   * fiches qui y renvoient), lisible, pour la remettre à la personne. Administrateur.
   */
  donneesObjet(p: Profil, sid: string, id: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const e = this.#espace(sid);
    const o = this.#objetVisible(p, e, id);
    const t = defType(this.#univers, o.type);
    const champs = (t?.champs ?? []).filter((c) => o.champs[c.id] !== undefined).map((c) => {
      const v = o.champs[c.id] as ValeurChamp;
      return { champ: c.libelle, valeur: c.type === 'reference' && typeof v === 'string' ? (e.objets.get(v)?.nom ?? null) : v };
    });
    const planning = [...(e.planning.get(o.id) ?? new Map<string, string>())].filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b))
      .map(([jour, brut]) => { const v = caseVisible(p, brut); return { jour, activite: this.#libelleCase(v, e.objets).libelle, valeur: v }; });
    const renvois = [...e.objets.values()].flatMap((x) => (defType(this.#univers, x.type)?.champs ?? []).filter((c) => c.type === 'reference' && x.champs[c.id] === o.id)
      .map((c) => ({ fiche: x.nom, type: defType(this.#univers, x.type)?.libelle ?? x.type, champ: c.libelle })));
    return {
      genere: this.#o.maintenant().toISOString(),
      fiche: { type: t?.libelle ?? o.type, nom: o.nom, roles: o.roles.map((r) => libelleRole(this.#univers, r)), champs, source: o.source.libelle, creeOuMaj: o.majLe },
      planning,
      actions: [...e.actions.values()].filter((a) => a.cmd.cible === o.id).map((a) => ({ capacite: a.cmd.capacite, etat: a.cmd.etat, parametres: a.cmd.parametres, le: a.majLe })),
      journal: this.#journal.filter((l) => l.cible === o.id || (o.nom.length >= 3 && l.detail.includes(o.nom))).map((l) => ({ le: l.le, action: l.action, detail: l.detail })),
      renvois,
    };
  }

  // ---------------------------------------------------------------- mon entreprise (accueil)

  modifierOrganisation(p: Profil, sid: string, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (this.#sims.has(sid)) throw new ErreurApi(409, 'simulation_active');
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const org = [...this.#reel.objets.values()].find((o) => o.famille === 'organisation');
    if (!org) throw new ErreurApi(409, 'pas_d_organisation', 'Créez d’abord votre entreprise.');
    if (org.mode === 'demo') throw new ErreurApi(409, 'monde_demo', 'Commencez par créer votre entreprise (les données fictives seront retirées).');
    const t = defType(this.#univers, org.type);
    const champs: Record<string, ValeurChamp> = { ...org.champs };
    for (const [k, v] of Object.entries(d)) {
      if (k === 'nom') continue;
      const c = t?.champs.find((x) => x.id === k);
      if (!c) throw new ErreurApi(400, 'champ_inconnu', k);
      if (v === null || v === '') { delete champs[k]; continue; }
      const r = convertir(String(v), c);
      if (!r.ok) throw new ErreurApi(400, 'champ_invalide', `${c.libelle} : ${r.erreur}`);
      champs[k] = r.valeur;
    }
    if (typeof champs.effectif === 'number' && !('taille' in d)) {
      const n = champs.effectif;
      champs.taille = n < 10 ? 'TPE (moins de 10 personnes)' : n < 250 ? 'PME (10 à 249)' : 'ETI ou grande (250 et plus)';
    }
    const nom = typeof d.nom === 'string' && uneLigne(d.nom).length >= 1 && d.nom.length <= 120 ? uneLigne(d.nom) : org.nom;
    const modifie: ObjetMetier = { ...org, nom, champs, majLe: this.#o.maintenant().toISOString() };
    const pb = validerObjet(this.#univers, modifie);
    if (pb.length) throw new ErreurApi(400, 'objet_invalide', pb.join(' ; '));
    this.#reel.objets.set(org.id, modifie);
    this.#tracer(p, this.#reel, 'organisation.modifiee', org.id, Object.keys(d).join(', '));
    return { ok: true, organisation: this.organisation };
  }

  /** Saisie de plusieurs objets d'un coup (accueil) : chacun validé, rapport par ligne. */
  creerObjets(p: Profil, sid: string, d: unknown) {
    if (!estObj(d) || !Array.isArray(d.objets) || d.objets.length > 500) throw new ErreurApi(400, 'requete_invalide');
    const crees: { index: number; id: string; nom: string }[] = [];
    const erreurs: { index: number; message: string }[] = [];
    d.objets.forEach((x, index) => {
      try {
        const v = this.creerObjet(p, sid, x);
        crees.push({ index, id: v.id, nom: v.nom });
      } catch (e) {
        erreurs.push({ index, message: e instanceof ErreurApi ? e.message : 'erreur' });
      }
    });
    return { crees, erreurs };
  }

  // ---------------------------------------------------------------- journal privé

  #tracer(p: Profil, e: Espace, action: string, cible: string | null, detail: string): void {
    if (e.simulation) return; // la simulation ne laisse pas de trace dans le journal réel
    const maintenant = this.#o.maintenant();
    const le = maintenant.toISOString();
    const canal = CANAL.getStore()?.slice(0, 120);
    // la même case de planning modifiée à la suite par le même acteur : la ligne existante est tenue à jour (dernier
    // état, nombre de modifications) au lieu d'en ajouter une — une rafale ne vide pas le journal de ses autres traces
    const fleche = action === 'planning.affecte' && cible ? detail.indexOf(' → ') : -1;
    if (fleche > 0) {
      const cle = `${p.id}\n${canal ?? ''}\n${cible}\n${detail.slice(0, fleche)}`;
      const r = this.#affectationsRecentes.get(cle);
      if (r && maintenant.getTime() - r.debut < REGROUPEMENT_PLANNING_MS && this.#journal.includes(r.ligne)) {
        r.n++;
        r.ligne.le = le;
        r.ligne.detail = `${detail} (${r.n} modifications à la suite)`.slice(0, 300);
        if (this.#journal.at(-1) !== r.ligne) { this.#journal.splice(this.#journal.indexOf(r.ligne), 1); this.#journal.push(r.ligne); }
        this.#emettre({ le, acteur: p.id, action, cible });
        return;
      }
    }
    const ligne: LigneJournal = { le, acteur: p.id, ...(canal ? { canal } : {}), action, cible, detail: detail.slice(0, 300) };
    this.#journal.push(ligne);
    if (this.#journal.length > JOURNAL_MAX) this.#journal.shift();
    if (fleche > 0) {
      if (this.#affectationsRecentes.size > 2000) this.#affectationsRecentes.clear();
      this.#affectationsRecentes.set(`${p.id}\n${canal ?? ''}\n${cible}\n${detail.slice(0, fleche)}`, { ligne, n: 1, debut: maintenant.getTime() });
    }
    if (estActionSecurite(action)) this.#noterSecurite({ ...ligne }, maintenant);
    this.#emettre({ le, acteur: p.id, action, cible });
  }

  /** Journal de sécurité : borné par la durée (12 mois) et, par type d'événement, par un plafond large. */
  #noterSecurite(ligne: LigneJournal, maintenant: Date): void {
    const limite = new Date(maintenant.getTime() - JOURNAL_SECURITE_DUREE_MS).toISOString();
    let perimees = 0;
    while (perimees < this.#journalSecurite.length && (this.#journalSecurite[perimees] as LigneJournal).le < limite) perimees++;
    if (perimees) this.#journalSecurite.splice(0, perimees);
    this.#journalSecurite.push(ligne);
    let memeAction = 0;
    for (const l of this.#journalSecurite) if (l.action === ligne.action) memeAction++;
    if (memeAction > JOURNAL_SECURITE_MAX_PAR_ACTION) this.#journalSecurite.splice(this.#journalSecurite.findIndex((l) => l.action === ligne.action), 1);
  }

  /** Les 200 dernières lignes du journal d'activité (première page), de la plus récente à la plus ancienne. */
  journal(p: Profil): LigneJournal[] {
    return this.journalPage(p).lignes;
  }

  /**
   * Journal par pages de 200 lignes, de la plus récente à la plus ancienne. `securite` : les événements de sécurité
   * gardés à part pendant 12 mois (exports, restaurations, clés, accès, comptes, effacements…).
   */
  journalPage(p: Profil, o: { securite?: boolean; page?: number } = {}): { lignes: LigneJournal[]; total: number; page: number; pages: number } {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const source = o.securite ? this.#journalSecurite : this.#journal;
    const total = source.length;
    const pages = Math.max(1, Math.ceil(total / PAGE_JOURNAL));
    const page = Number.isInteger(o.page) ? Math.min(pages, Math.max(1, o.page as number)) : 1;
    const fin = total - (page - 1) * PAGE_JOURNAL;
    return { lignes: source.slice(Math.max(0, fin - PAGE_JOURNAL), fin).reverse(), total, page, pages };
  }

  /**
   * Journal de sécurité d'avant une restauration : repris dans l'état restauré (une restauration ne fait pas
   * disparaître la trace d'un export, d'une clé ou d'un accès). Lignes déjà présentes ignorées, ordre chronologique.
   */
  reprendreJournalSecurite(lignes: readonly LigneJournal[]): void {
    const cle = (l: LigneJournal) => `${l.le}\n${l.acteur}\n${l.action}\n${l.detail}`;
    const connues = new Set(this.#journalSecurite.map(cle));
    const ajout = lireJournal(lignes, 100_000).filter((l) => estActionSecurite(l.action) && !connues.has(cle(l))).map((l) => ({ ...l }));
    if (!ajout.length) return;
    this.#journalSecurite = [...this.#journalSecurite, ...ajout].sort((a, b) => (a.le < b.le ? -1 : a.le > b.le ? 1 : 0));
  }

  /** Trace d'un module (export des données, effacement…) dans le journal réel, au nom d'un profil. */
  tracer(p: Profil, action: string, cible: string | null, detail: string): void {
    this.#tracer(p, this.#reel, action, cible, detail);
  }
}
