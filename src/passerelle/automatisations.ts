/**
 * Automatisations (« recettes ») : quand une situation se présente dans le réel, le jeu agit à votre place
 * — tâche attribuée, formulaire de satisfaction, message à votre outil (Make, Zapier…).
 * - Désactivées par défaut ; activées une à une par la direction, depuis « Optimiser ».
 * - Anti-doublon : chaque déclenchement est mémorisé (recette × objet × période) ; une tâche ouverte identique
 *   n'est jamais recréée. Rien ne s'exécute en simulation.
 * - Tâches répétitives DÉCLARÉES (« est-ce que ça vaut le coup de l'automatiser ? ») : une personne décrit une tâche,
 *   le jeu rend son verdict (calcul pur : ../core/taches-repetitives.ts) et, si une automatisation existante la fait
 *   déjà, son état. Enregistrées ici avec les automatisations ; rien n'est envoyé à l'extérieur.
 */
import { randomUUID } from 'node:crypto';
import type { Profil } from '../demo/donnees.ts';
import type { ObjetMetier, ValeurChamp } from '../core/model.ts';
import { ANONYMAT_MIN, detecterOptimisations } from '../core/optimisations.ts';
import { calculerTache, ErreurTache, HORIZON_MAX, IDEES, lireHorizon, lireSaisie, RANG_VERDICT, TACHES_MAX, type SaisieTache } from '../core/taches-repetitives.ts';
import type { Enquetes } from './enquetes.ts';
import { ErreurApi, type Monde } from './monde.ts';
import type { Synchro } from './synchro.ts';

interface Recette {
  id: string;
  nom: string;
  quand: string;
  alors: string;
  periodeJours: number; // un même objet ne redéclenche pas avant cette durée
}

export const RECETTES: readonly Recette[] = [
  { id: 'relance-factures', nom: 'Relance des factures en retard', quand: 'Une facture passe en retard de paiement', alors: 'Tâche « Relancer » pour la personne en charge, toutes les 2 semaines tant que ce n’est pas payé ; message à vos outils', periodeJours: 14 },
  { id: 'relance-devis', nom: 'Relance des devis', quand: 'Un devis envoyé reste sans réponse 7 jours', alors: 'Tâche « Relancer le devis » pour le commercial', periodeJours: 10 },
  { id: 'facturer-livraisons', nom: 'Facturer à la livraison', quand: 'Une commande client est livrée', alors: 'Tâche « Facturer » immédiate ; message à votre logiciel de facturation', periodeJours: 30 },
  { id: 'reappro-stock', nom: 'Réapprovisionnement', quand: 'Un article passe sous son seuil d’alerte', alors: 'Tâche « Commander » pour la logistique, avec le fournisseur habituel', periodeJours: 7 },
  { id: 'courrier-urgent', nom: 'Courrier urgent', quand: 'Un courrier urgent arrive', alors: 'Tâche pour son destinataire, échéance le jour même', periodeJours: 365 },
  { id: 'documents', nom: 'Papiers à renouveler', quand: 'Un document expire dans 30 jours', alors: 'Tâche « Renouveler » pour l’administratif', periodeJours: 30 },
  { id: 'vehicules', nom: 'Révisions et contrôles', quand: 'Une révision ou un contrôle technique approche', alors: 'Tâche « Prendre rendez-vous »', periodeJours: 30 },
  { id: 'taches-retard', nom: 'Tâches sans responsable', quand: 'Une tâche n’a pas de responsable', alors: 'Elle est attribuée au responsable du département concerné', periodeJours: 365 },
  { id: 'trous-planning', nom: 'Trous de planning', quand: 'Il manque du monde aujourd’hui sur un lieu ou un chantier', alors: 'Tâche du jour pour la direction, avec les trous à combler', periodeJours: 1 },
  { id: 'satisfaction-auto', nom: 'Satisfaction après livraison', quand: 'Un client livré ou facturé n’a pas donné d’avis depuis 6 mois', alors: 'Formulaire envoyé par vos outils (Make, Zapier…) ou tâche « envoyer le formulaire »', periodeJours: 90 },
  { id: 'avis-bas', nom: 'Client mécontent', quand: 'Un avis client arrive sous 7/10', alors: 'Tâche « Rappeler le client » sous 48 h, avec son commentaire', periodeJours: 365 },
  { id: 'barometre', nom: 'Baromètre trimestriel', quand: 'Chaque trimestre', alors: 'Tâche « Envoyer le baromètre » (ou envoi par vos outils)', periodeJours: 90 },
];

/**
 * Ce dont chaque automatisation a besoin pour agir (« J'automatise » en un clic) : les données qu'elle regarde, et si
 * elle prévient aussi l'outil d'automatisation de l'entreprise (Make, Zapier, n8n) pour que l'envoi parte tout seul.
 * `vues` : le jeu a-t-il ces données ? Sinon l'automatisation n'aurait rien à regarder : elle est dite « à brancher ».
 */
interface Besoin {
  /** Ce qu'il faut avoir relié ou saisi, dit simplement. */
  donnees: string;
  vues: (objets: readonly ObjetMetier[]) => boolean;
  /** L'automatisation envoie aussi un événement à l'outil branché (sinon elle crée seulement la tâche). */
  versOutil?: boolean;
}
const aDes = (test: (o: ObjetMetier) => boolean) => (objets: readonly ObjetMetier[]) => objets.some(test);
const client = (o: ObjetMetier) => o.famille === 'tiers' && o.roles.includes('client');
const BESOINS: Readonly<Record<string, Besoin>> = {
  'relance-factures': { donnees: 'vos factures clients et leur échéance (comptabilité ou logiciel de facturation)', vues: aDes((o) => o.type === 'facture'), versOutil: true },
  'relance-devis': { donnees: 'vos devis (logiciel commercial ou tableau)', vues: aDes((o) => o.type === 'devis') },
  'facturer-livraisons': { donnees: 'vos commandes clients', vues: aDes((o) => o.type === 'commande_client'), versOutil: true },
  'reappro-stock': { donnees: 'votre stock, avec un seuil d’alerte par article', vues: aDes((o) => o.type === 'article') },
  'courrier-urgent': { donnees: 'votre courrier', vues: aDes((o) => o.type === 'courrier') },
  documents: { donnees: 'vos documents et leur date d’échéance', vues: aDes((o) => o.type === 'document') },
  vehicules: { donnees: 'vos véhicules et leurs dates de révision ou de contrôle', vues: aDes((o) => /v[eé]hicule/.test(o.type)) },
  'taches-retard': { donnees: 'vos tâches', vues: aDes((o) => o.famille === 'tache') },
  'trous-planning': { donnees: 'vos collaborateurs et leur planning', vues: aDes((o) => o.famille === 'personne') },
  'satisfaction-auto': { donnees: 'vos clients et leurs commandes ou factures', vues: (os) => os.some(client) && os.some((o) => o.type === 'commande_client' || o.type === 'facture'), versOutil: true },
  'avis-bas': { donnees: 'vos clients (pour leur demander leur avis)', vues: aDes(client) },
  // en dessous du seuil d'anonymat, aucun résultat ne serait publié : l'automatisation attend l'équipe
  barometre: { donnees: `au moins ${ANONYMAT_MIN} collaborateurs (en dessous, rien n’est publié : l’anonymat ne tiendrait pas)`, vues: (os) => os.filter((o) => o.famille === 'personne').length >= ANONYMAT_MIN, versOutil: true },
};

export type EtatRecette = 'active' | 'prete' | 'a_brancher';

/** Une tâche répétitive déclarée, telle qu'elle est enregistrée. */
export interface TacheDeclaree extends SaisieTache {
  id: string;
  creeLe: string;
  majLe: string;
}

export interface EtatAutomatisations {
  actives: string[];
  faits: Record<string, string>;
  compteurs: Record<string, { n: number; dernier: string | null }>;
  tauxHoraire: number;
  /** Tâches répétitives déclarées (100 au plus) ; absentes des enregistrements plus anciens. */
  taches?: TacheDeclaree[];
  /** Durée sur laquelle on compte pour dire si automatiser est rentable : 1 à 5 ans (5 par défaut). */
  horizonAns?: number;
}

const JOUR = 86_400_000;
const IDS_RECETTES: ReadonlySet<string> = new Set(RECETTES.map((r) => r.id));
const ID_TACHE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sansMention = (nom: string) => nom.replace(/\s*\((démo|fictif|fictive)\)/gi, '');

/** Tâches relues d'un enregistrement : chaque déclaration est recontrôlée, ce qui est illisible est écarté. */
function lireTaches(x: unknown, maintenant: string): TacheDeclaree[] {
  if (!Array.isArray(x)) return [];
  const taches: TacheDeclaree[] = [];
  const vus = new Set<string>();
  for (const t of x as unknown[]) {
    if (taches.length >= TACHES_MAX) break;
    const b = (typeof t === 'object' && t !== null ? t : {}) as Record<string, unknown>;
    if (typeof b.id !== 'string' || !ID_TACHE.test(b.id) || vus.has(b.id)) continue;
    try {
      const date = (d: unknown) => (typeof d === 'string' && !Number.isNaN(Date.parse(d)) ? d : maintenant);
      taches.push({ ...lireSaisie(b, IDS_RECETTES), id: b.id, creeLe: date(b.creeLe), majLe: date(b.majLe) });
      vus.add(b.id);
    } catch { /* déclaration illisible : écartée */ }
  }
  return taches;
}

export class Automatisations {
  #monde: Monde;
  #enquetes: Enquetes;
  #synchro: Synchro;
  #etat: Required<EtatAutomatisations>;
  #changement: () => void;
  #enCours = false;
  #attente: NodeJS.Timeout | null = null;
  #trous: () => number;
  #trousProchains: () => number;

  /**
   * `trous` : trous du planning AUJOURD'HUI (tâche du jour) ; `trousProchains` : ceux des 6 prochains jours ouvrés,
   * aujourd'hui compris, comptés comme sur l'écran Planning (piste « Signaler les trous » : mêmes chiffres, P3).
   */
  constructor(monde: Monde, enquetes: Enquetes, synchro: Synchro, o: { etat?: EtatAutomatisations | null; changement?: () => void; trous?: () => number; trousProchains?: () => number } = {}) {
    this.#monde = monde;
    this.#enquetes = enquetes;
    this.#synchro = synchro;
    this.#changement = o.changement ?? (() => {});
    this.#trous = o.trous ?? (() => 0);
    this.#trousProchains = o.trousProchains ?? this.#trous;
    const e = o.etat;
    this.#etat = {
      actives: Array.isArray(e?.actives) ? e.actives.filter((x) => RECETTES.some((r) => r.id === x)) : [],
      faits: e?.faits && typeof e.faits === 'object' ? e.faits : {},
      compteurs: e?.compteurs && typeof e.compteurs === 'object' ? e.compteurs : {},
      tauxHoraire: typeof e?.tauxHoraire === 'number' && e.tauxHoraire > 0 && e.tauxHoraire < 1000 ? e.tauxHoraire : 35,
      taches: lireTaches(e?.taches, monde.maintenant().toISOString()),
      horizonAns: lireHorizon(e?.horizonAns),
    };
  }

  instantane(): EtatAutomatisations {
    const limite = this.#monde.maintenant().getTime() - 400 * JOUR;
    this.#etat.faits = Object.fromEntries(Object.entries(this.#etat.faits).filter(([, le]) => Date.parse(le) > limite));
    return this.#etat;
  }

  #autorise(p: Profil) {
    if (!p.peutAdministrer && !p.peutApprouver) throw new ErreurApi(403, 'interdit');
  }

  lister(p: Profil) {
    this.#autorise(p);
    return {
      tauxHoraire: this.#etat.tauxHoraire,
      recettes: RECETTES.map((r) => ({ ...r, active: this.#etat.actives.includes(r.id), declenchements: this.#etat.compteurs[r.id]?.n ?? 0, dernier: this.#etat.compteurs[r.id]?.dernier ?? null })),
    };
  }

  activer(p: Profil, id: unknown, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const r = RECETTES.find((x) => x.id === id);
    if (!r) throw new ErreurApi(404, 'introuvable');
    const actif = (d as { actif?: unknown })?.actif === true;
    this.#etat.actives = actif ? [...new Set([...this.#etat.actives, r.id])] : this.#etat.actives.filter((x) => x !== r.id);
    this.#changement();
    if (actif) this.planifier(200);
    return { id: r.id, active: actif };
  }

  /**
   * « J'automatise » : où en est chaque automatisation avant de tout activer d'un geste.
   * - « active » : elle tourne déjà ;
   * - « prête » : le jeu a les données qu'elle regarde (`heuresMois` : ce qu'elle ferait gagner dès maintenant, 0 si rien
   *   n'est à traiter aujourd'hui) ;
   * - « à brancher » : le jeu ne voit pas ces données ; `manque` dit quoi relier ou saisir.
   * `outilBranche` : un outil d'automatisation reçoit les événements du jeu (sinon les envois deviennent des tâches).
   */
  preparation(p: Profil) {
    this.#autorise(p);
    const objets = this.#monde.objetsReels();
    const pistes = new Map(this.#detecter().opportunites.filter((o) => o.recette).map((o) => [o.recette as string, o]));
    const recettes = RECETTES.map((r) => {
      const besoin = BESOINS[r.id];
      const active = this.#etat.actives.includes(r.id);
      const vues = besoin ? besoin.vues(objets) : true;
      const etat: EtatRecette = active ? 'active' : vues ? 'prete' : 'a_brancher';
      return { id: r.id, nom: r.nom, quand: r.quand, alors: r.alors, etat, manque: etat === 'a_brancher' ? (besoin?.donnees ?? null) : null,
        heuresMois: active ? 0 : (pistes.get(r.id)?.heuresMois ?? 0), versOutil: besoin?.versOutil === true };
    });
    const pretes = recettes.filter((r) => r.etat === 'prete');
    return { recettes, pretes: pretes.length, aBrancher: recettes.filter((r) => r.etat === 'a_brancher').length, heuresMois: Math.round(pretes.reduce((n, r) => n + r.heuresMois, 0) * 2) / 2,
      tauxHoraire: this.#etat.tauxHoraire, outilBranche: this.#synchro.peutNotifier() };
  }

  /** « J'automatise » : active d'un geste tout ce qui est prêt ; rien de ce qui reste à brancher. Administrateur seulement. */
  toutActiver(p: Profil) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const avant = this.preparation(p);
    const activees = avant.recettes.filter((r) => r.etat === 'prete').map((r) => r.id);
    if (activees.length) {
      this.#etat.actives = [...new Set([...this.#etat.actives, ...activees])];
      this.#changement();
      this.planifier(200);
    }
    return { activees, aBrancher: avant.recettes.filter((r) => r.etat === 'a_brancher').map((r) => ({ id: r.id, nom: r.nom, manque: r.manque })), outilBranche: avant.outilBranche };
  }

  /** Coût horaire (toutes les estimations en euros) et durée comptée pour les tâches déclarées : l'un, l'autre ou les deux. */
  regler(p: Profil, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const r = (d ?? {}) as { tauxHoraire?: unknown; horizonAns?: unknown };
    const avecHorizon = r.horizonAns !== undefined;
    const avecTaux = r.tauxHoraire !== undefined || !avecHorizon;
    const t = Number(r.tauxHoraire);
    if (avecTaux && (!Number.isFinite(t) || t <= 0 || t >= 1000)) throw new ErreurApi(400, 'taux_invalide', 'Coût horaire entre 1 et 999 €.');
    if (avecHorizon && lireHorizon(r.horizonAns) !== r.horizonAns) throw new ErreurApi(400, 'horizon_invalide', `Durée comptée : de 1 à ${HORIZON_MAX} ans.`);
    if (avecTaux) this.#etat.tauxHoraire = Math.round(t);
    if (avecHorizon) this.#etat.horizonAns = lireHorizon(r.horizonAns);
    this.#changement();
    return { tauxHoraire: this.#etat.tauxHoraire, horizonAns: this.#etat.horizonAns };
  }

  // ---------------------------------------------------------------- tâches répétitives déclarées

  /** La déclaration telle qu'on la montre à ce profil : verdict calculé, état de l'automatisation attachée, nom de la personne. */
  #vueTache<T extends SaisieTache>(p: Profil, t: T, recettes: ReturnType<Automatisations['preparation']>['recettes']) {
    // une personne de l'entreprise n'est nommée que si ce profil voit sa fiche
    const fiche = t.personne !== null && this.#monde.estVisible(p, t.personne) ? this.#monde.objetReel(t.personne) : null;
    const personne = fiche && fiche.famille === 'personne' ? fiche : null;
    const r = t.recette === null ? null : recettes.find((x) => x.id === t.recette) ?? null;
    return {
      ...t, personne: personne?.id ?? null, qui: personne ? sansMention(personne.nom) : t.qui,
      calcul: calculerTache(t, { tauxHoraire: this.#etat.tauxHoraire, horizonAns: this.#etat.horizonAns }),
      automatisation: r ? { id: r.id, nom: r.nom, quand: r.quand, alors: r.alors, etat: r.etat, manque: r.manque, versOutil: r.versOutil } : null,
    };
  }

  /** Contrôle une déclaration reçue ; une personne attachée doit être une fiche « personne » que ce profil voit. */
  #lireTache(p: Profil, d: unknown): SaisieTache {
    let s: SaisieTache;
    try {
      s = lireSaisie(d, IDS_RECETTES);
    } catch (e) {
      if (e instanceof ErreurTache) throw new ErreurApi(400, 'tache_invalide', e.message);
      throw e;
    }
    if (s.personne !== null && (!this.#monde.estVisible(p, s.personne) || this.#monde.objetReel(s.personne)?.famille !== 'personne')) {
      throw new ErreurApi(400, 'tache_invalide', 'Cette personne est introuvable dans votre entreprise.');
    }
    return s;
  }

  /**
   * Tâches répétitives déclarées, celles qui valent le plus le coup d'abord, chacune avec son verdict, sa raison, le
   * calcul de chaque chiffre et, si une automatisation existante la fait déjà, l'état de celle-ci (en marche, prête,
   * données manquantes). `idees` : idées de départ à choisir puis à ajuster.
   */
  taches(p: Profil) {
    this.#autorise(p);
    const prep = this.preparation(p);
    const taches = this.#etat.taches.map((t) => this.#vueTache(p, t, prep.recettes))
      .sort((a, b) => RANG_VERDICT[a.calcul.verdict] - RANG_VERDICT[b.calcul.verdict] || b.calcul.heuresAn - a.calcul.heuresAn || a.nom.localeCompare(b.nom, 'fr'));
    return { taches, max: TACHES_MAX, tauxHoraire: this.#etat.tauxHoraire, horizonAns: this.#etat.horizonAns, outilBranche: prep.outilBranche, idees: IDEES };
  }

  /** Le verdict d'une déclaration SANS l'enregistrer (dernière étape du formulaire : voir avant de garder). */
  estimerTache(p: Profil, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    return this.#vueTache(p, this.#lireTache(p, d), this.preparation(p).recettes);
  }

  ajouterTache(p: Profil, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const s = this.#lireTache(p, d);
    if (this.#etat.taches.length >= TACHES_MAX) throw new ErreurApi(409, 'trop_de_taches', `Vous avez déjà ${TACHES_MAX} tâches déclarées : supprimez-en une avant d’en ajouter.`);
    const le = this.#monde.maintenant().toISOString();
    const t: TacheDeclaree = { ...s, id: randomUUID(), creeLe: le, majLe: le };
    this.#etat.taches.push(t);
    this.#changement();
    return this.#vueTache(p, t, this.preparation(p).recettes);
  }

  modifierTache(p: Profil, id: unknown, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const i = this.#etat.taches.findIndex((t) => t.id === id);
    const avant = this.#etat.taches[i];
    if (!avant) throw new ErreurApi(404, 'introuvable');
    const t: TacheDeclaree = { ...this.#lireTache(p, d), id: avant.id, creeLe: avant.creeLe, majLe: this.#monde.maintenant().toISOString() };
    this.#etat.taches[i] = t;
    this.#changement();
    return this.#vueTache(p, t, this.preparation(p).recettes);
  }

  supprimerTache(p: Profil, id: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const reste = this.#etat.taches.filter((t) => t.id !== id);
    if (reste.length === this.#etat.taches.length) throw new ErreurApi(404, 'introuvable');
    this.#etat.taches = reste;
    this.#changement();
    return { ok: true as const, id: id as string };
  }

  optimisations(p: Profil) {
    this.#autorise(p);
    return this.#detecter();
  }

  /** Pour le score de santé (l'appelant vérifie que le profil voit le score). */
  resumeSante(): { actives: number; heuresRecuperables: number } {
    const r = this.#detecter();
    return { actives: this.#etat.actives.length, heuresRecuperables: Math.round(r.opportunites.filter((o) => !o.active).reduce((s, o) => s + o.heuresMois, 0)) };
  }

  #detecter() {
    return detecterOptimisations({
      objets: [...this.#monde.objetsReels(), ...this.#enquetes.objetsSante()],
      situations: this.#monde.situationsReelles(),
      journal: this.#monde.journalBrut(),
      trousPlanning: this.#trousProchains(),
      maintenant: this.#monde.maintenant(),
      tauxHoraire: this.#etat.tauxHoraire,
      connecteurs: this.#synchro.resume().actifs,
      recettesActives: new Set(this.#etat.actives),
    });
  }

  /** Relance le moteur peu après un changement (regroupé). */
  planifier(delaiMs = 1500) {
    if (this.#attente || !this.#etat.actives.length) return;
    this.#attente = setTimeout(() => { this.#attente = null; void this.executer(); }, delaiMs);
    this.#attente.unref?.();
  }

  #responsableDe(o: ObjetMetier): string | null {
    const dep = typeof o.champs.departement === 'string' ? this.#monde.objetReel(o.champs.departement) : null;
    if (dep && typeof dep.champs.responsable === 'string') return dep.champs.responsable;
    if (typeof o.champs.destinataire === 'string') return o.champs.destinataire;
    const conc = typeof o.champs.concerne === 'string' ? this.#monde.objetReel(o.champs.concerne) : null;
    if (conc && conc.famille !== 'tiers') return this.#responsableDe(conc);
    return null;
  }

  /**
   * Fiche effacée ou anonymisée : les traces « déjà fait » qui la désignent sont oubliées, et une tâche déclarée ne
   * dit plus que cette personne la fait (la tâche reste, sans nom).
   */
  oublierObjet(id: string): void {
    const avant = Object.keys(this.#etat.faits).length;
    this.#etat.faits = Object.fromEntries(Object.entries(this.#etat.faits).filter(([k]) => !k.includes(`:${id}:`)));
    const concernees = this.#etat.taches.filter((t) => t.personne === id);
    for (const t of concernees) t.personne = null;
    if (Object.keys(this.#etat.faits).length !== avant || concernees.length) this.#changement();
  }

  #dejaFait(recette: string, objet: string, periodeJours: number): boolean {
    const p = Math.floor(this.#monde.maintenant().getTime() / (periodeJours * JOUR));
    const cle = `${recette}:${objet}:${p}`;
    if (this.#etat.faits[cle]) return true;
    this.#etat.faits[cle] = this.#monde.maintenant().toISOString();
    return false;
  }

  #tache(recette: string, titre: string, concerne: ObjetMetier | null, delaiJours: number, responsable: string | null = null) {
    const ouvertes = this.#monde.objetsReels().filter((o) => o.famille === 'tache' && o.champs.statut !== 'terminée' && o.nom === titre);
    if (ouvertes.length) return false;
    const echeance = new Date(this.#monde.maintenant().getTime() + delaiJours * JOUR).toISOString().slice(0, 10);
    const champs: Record<string, ValeurChamp> = { statut: 'à faire', echeance };
    if (concerne) champs.concerne = concerne.id;
    const resp = responsable ?? (concerne ? this.#responsableDe(concerne) : null);
    if (resp) champs.responsable = resp;
    if (concerne && typeof concerne.champs.departement === 'string') champs.departement = concerne.champs.departement;
    this.#monde.creerObjetSysteme(`automatisation:${recette}`, 'tache', titre, champs, { id: `automatisation:${recette}`, libelle: `Automatisation — ${RECETTES.find((r) => r.id === recette)?.nom ?? recette}` });
    return true;
  }

  #compter(recette: string) {
    const c = (this.#etat.compteurs[recette] ??= { n: 0, dernier: null });
    c.n++;
    c.dernier = this.#monde.maintenant().toISOString();
  }

  /** Passe en revue les recettes actives sur le monde réel. Renvoie le nombre d'actions faites. */
  async executer(): Promise<number> {
    if (this.#enCours || !this.#etat.actives.length) return 0;
    this.#enCours = true;
    let n = 0;
    try {
      const actives = new Set(this.#etat.actives);
      const recette = (id: string) => RECETTES.find((r) => r.id === id) as Recette;
      const objets = this.#monde.objetsReels();
      const parId = new Map(objets.map((o) => [o.id, o]));
      const situations = this.#monde.situationsReelles().filter((s) => s.statut !== 'a_verifier');
      const nomCourt = (o: ObjetMetier) => o.nom.replace(/\s*\((démo|fictif|fictive)\)/gi, '');
      const faire = (id: string, objet: string, action: () => boolean | Promise<boolean>) => async () => {
        if (!actives.has(id) || this.#dejaFait(id, objet, recette(id).periodeJours)) return;
        if (await action()) { this.#compter(id); n++; }
      };
      const taches: (() => Promise<void>)[] = [];
      const parRegle = (regle: string) => situations.filter((s) => s.regle === regle).map((s) => parId.get(s.objetId)).filter((o): o is ObjetMetier => !!o);

      for (const f of parRegle('retard_paiement')) taches.push(faire('relance-factures', f.id, async () => {
        const tiers = typeof f.champs.tiers === 'string' ? parId.get(f.champs.tiers) : null;
        await this.#synchro.notifier('facture.retard', { facture: nomCourt(f), tiers: tiers ? nomCourt(tiers) : null, montant: f.champs.montant ?? null, email: tiers?.champs.email ?? null });
        return this.#tache('relance-factures', `Relancer ${nomCourt(f)}${tiers ? ` — ${nomCourt(tiers)}` : ''}`, f, 2);
      }));
      for (const d of objets.filter((o) => o.type === 'devis' && o.champs.statut === 'envoyé' && this.#monde.maintenant().getTime() - Date.parse(o.majLe) > 7 * JOUR)) {
        taches.push(faire('relance-devis', d.id, () => this.#tache('relance-devis', `Relancer le devis ${nomCourt(d)}`, d, 3)));
      }
      for (const c of objets.filter((o) => o.type === 'commande_client' && o.champs.statut === 'livrée')) taches.push(faire('facturer-livraisons', c.id, async () => {
        await this.#synchro.notifier('commande.a_facturer', { commande: nomCourt(c), montant: c.champs.montant ?? null });
        return this.#tache('facturer-livraisons', `Facturer ${nomCourt(c)}`, c, 1);
      }));
      for (const a of parRegle('stock_minimum')) taches.push(faire('reappro-stock', a.id, () => {
        const f = typeof a.champs.fournisseur === 'string' ? parId.get(a.champs.fournisseur) : null;
        return this.#tache('reappro-stock', `Commander ${nomCourt(a)}${f ? ` chez ${nomCourt(f)}` : ''}`, a, 2);
      }));
      for (const c of objets.filter((o) => o.type === 'courrier' && o.champs.urgence === 'haute' && o.champs.statut !== 'traité')) {
        taches.push(faire('courrier-urgent', c.id, () => this.#tache('courrier-urgent', `Courrier urgent : ${String(c.champs.objet ?? nomCourt(c)).slice(0, 120)}`, c, 0, typeof c.champs.destinataire === 'string' ? c.champs.destinataire : null)));
      }
      for (const d of parRegle('document_expire')) taches.push(faire('documents', d.id, () => this.#tache('documents', `Renouveler : ${nomCourt(d)}`, d, 10)));
      for (const v of [...parRegle('revision_vehicule'), ...parRegle('controle_technique')]) taches.push(faire('vehicules', v.id, () => this.#tache('vehicules', `Prendre rendez-vous : ${nomCourt(v)}`, v, 7)));
      for (const t of objets.filter((o) => o.famille === 'tache' && o.champs.statut !== 'terminée' && typeof o.champs.responsable !== 'string')) {
        taches.push(faire('taches-retard', t.id, () => {
          const r = this.#responsableDe(t);
          if (!r) return false;
          this.#monde.majObjetSysteme('automatisation:taches-retard', t.id, { responsable: r });
          return true;
        }));
      }
      if (this.#trous() > 0) {
        const jour = this.#monde.maintenant().toISOString().slice(0, 10);
        taches.push(faire('trous-planning', jour, () => this.#tache('trous-planning', `Combler les trous du planning du ${jour.split('-').reverse().join('/')}`, null, 0)));
      }
      const clientsSansAvis = new Set(this.#enquetes.clientsSansAvis({ id: 'systeme', nom: 'Automatisation', role: 'dirigeant', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous', peutPreparer: true, peutApprouver: true, voitScore: true, peutAdministrer: true }).map((o) => o.id));
      for (const c of objets.filter((o) => (o.type === 'commande_client' && ['livrée', 'facturée'].includes(String(o.champs.statut))) || (o.type === 'facture' && o.champs.payee === true))) {
        const client = parId.get(String(c.champs.client ?? c.champs.tiers ?? ''));
        if (!client || !clientsSansAvis.has(client.id)) continue;
        const derniere = this.#enquetes.derniereInvitation(client.id);
        if (derniere && this.#monde.maintenant().getTime() - Date.parse(derniere) < 90 * JOUR) continue;
        taches.push(faire('satisfaction-auto', client.id, async () => {
          const envoye = await this.#synchro.notifier('satisfaction.a_demander', { client: nomCourt(client), email: client.champs.email ?? null });
          if (envoye) return true;
          return this.#tache('satisfaction-auto', `Demander l’avis de ${nomCourt(client)} (bouton « Envoyer un formulaire »)`, client, 3);
        }));
      }
      for (const a of objets.filter((o) => o.type === 'avis_client' && typeof o.champs.note === 'number' && (o.champs.note as number) < 7)) {
        const client = typeof a.champs.concerne === 'string' ? parId.get(a.champs.concerne) : undefined;
        taches.push(faire('avis-bas', a.id, () => this.#tache('avis-bas', `Rappeler ${client ? nomCourt(client) : 'le client'} — avis ${a.champs.note}/10${a.champs.commentaire ? ` : « ${String(a.champs.commentaire).slice(0, 80)} »` : ''}`, client ?? a, 2)));
      }
      const trimestre = `${this.#monde.maintenant().getUTCFullYear()}-T${Math.floor(this.#monde.maintenant().getUTCMonth() / 3) + 1}`;
      taches.push(faire('barometre', trimestre, async () => {
        const envoye = await this.#synchro.notifier('barometre.a_envoyer', { trimestre });
        return envoye || this.#tache('barometre', `Envoyer le baromètre d’équipe ${trimestre} (page Satisfaction)`, null, 7);
      }));

      for (const t of taches) {
        try { await t(); } catch (e) { console.error('[automatisations]', e instanceof Error ? e.message : e); }
      }
    } finally {
      this.#enCours = false;
      if (n) this.#changement();
    }
    return n;
  }
}
