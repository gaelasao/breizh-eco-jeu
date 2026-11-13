/**
 * Assemble le monde et ses modules (comptes, synchro, formulaires, automatisations, clés), les enregistre sur disque
 * à chaque changement et diffuse les changements en temps réel (Server-Sent Events côté HTTP).
 *
 * Une installation = UNE entreprise, qui se gère seule, en local : ses comptes, ses données, ses sauvegardes.
 * Rien n'est envoyé à l'éditeur ; seule la couche Breizhcosystem (optionnelle, payante) échange avec l'extérieur.
 */
import { randomBytes } from 'node:crypto';
import { Automatisations, type EtatAutomatisations } from './automatisations.ts';
import { adresseNexus } from './bureau.ts';
import { Cles, type EtatCles } from './cles.ts';
import { ErreurFec, lireFec, valeursFiche, type SyntheseFec } from '../core/fec.ts';
import { evaluerSante, type ResultatSante } from '../core/sante.ts';
import { derniersJours, JOURS_TENDANCE, lireHistorique, noter, serieExemple, type PointSante, type SerieSante } from '../core/historique-sante.ts';
import { voitMotifsAbsence, type Profil } from '../demo/donnees.ts';
import { clientsSurveilles, proceduresCollectives, type AlerteBodacc } from './bodacc.ts';
import { Comptes, normaliserIdentifiant, problemeMotDePasse, type EtatComptes } from './comptes.ts';
import { Enquetes, type EtatEnquetes } from './enquetes.ts';
import { LienNexus, type EtatLienNexus } from './lien-nexus.ts';
import { ErreurApi, Monde, SYSTEME, type EtatMonde, type Exemple, type OptionsMonde } from './monde.ts';
import { recuperateurProtege, type Recuperateur } from './sortant.ts';
import { chiffrerAvecPhrase, CONSERVATION_JOURS, creerChiffreur, dechiffrerAvecPhrase, Stockage, type Chiffreur, type SauvegardeAuto } from './stockage.ts';
import { RelaisOAuth } from './oauth-relais.ts';
import { ETAT_VIDE as MAJ_VIDE, lireDerniereVersion, lireEtat as lireEtatMaj, resume as resumeMaj, type EtatMisesAJour } from './mises-a-jour.ts';
import { CHAMPS_CHIFFRES, Synchro, VALEUR_CHIFFREE, type EtatSynchro } from './synchro.ts';

export type ModeConnexion = 'demo' | 'comptes';

export interface EtatApplication {
  version: 1;
  monde: EtatMonde;
  synchro: EtatSynchro;
  enquetes: EtatEnquetes;
  automatisations: EtatAutomatisations;
  cles: EtatCles;
  comptes?: EtatComptes;
  reglages?: ReglagesApplication;
  nexus?: EtatLienNexus;
  bodacc?: { verifieLe: string | null; alertes: AlerteBodacc[] };
  /** Relevés quotidiens du score de santé de l'entreprise entière (tendance sur 90 jours). */
  sante?: { historique: PointSante[] };
  /** Avis de sécurité montrés aux autres administrateurs (export complet des données…). */
  securite?: { avis: AvisSecurite[] };
  /** Dernière version publiée vue sur Breizhcosystem (alerte « nouvelle version »). */
  misesAJour?: EtatMisesAJour;
}

/** Avis montré aux AUTRES administrateurs jusqu'à ce qu'ils l'aient vu (90 jours au plus, 20 avis au plus). */
export interface AvisSecurite {
  id: string;
  le: string;
  quoi: 'export' | 'export_avec_acces';
  par: string;
  parNom: string;
  vusPar: string[];
}
const AVIS_MAX = 20;
const AVIS_DUREE_MS = 90 * 86_400_000;
/** Phrase de protection d'un export : plus longue quand le fichier contient la clé des accès aux logiciels connectés. */
export const PHRASE_MIN = 12;
export const PHRASE_MIN_AVEC_ACCES = 16;

export interface ReglagesApplication {
  /** Mode équipe : accessible depuis le réseau du bureau. */
  equipe: boolean;
  /** Surveillance des clients au Bodacc (procédures collectives) : choix de l'entreprise. */
  surveillanceBodacc: boolean;
  /** Suggestion « Utiliser le jeu partout ? » (Ce matin) refermée par un administrateur. */
  suggestionEnLigneMasquee: boolean;
  /** Vérification quotidienne des nouvelles versions sur Breizhcosystem ; null : par défaut (oui en ligne, non sur un poste). */
  verifierMisesAJour: boolean | null;
  /** Durées de conservation choisies par l'entreprise (jours ; null = pas d'effacement automatique). */
  conservation: DureesConservation;
}

export interface DureesConservation {
  /** Cases du planning (absences comprises) plus anciennes. */
  planning: number | null;
  /** Avis clients reçus. */
  avis: number | null;
  /** Courrier traité. */
  courrier: number | null;
}
/** Durées proposées (6 mois, 1, 2, 3 ans) : l'entreprise choisit, aucune n'est imposée par défaut. */
export const DUREES_PROPOSEES = [183, 365, 730, 1095] as const;
const lireDuree = (x: unknown): number | null => (typeof x === 'number' && (DUREES_PROPOSEES as readonly number[]).includes(x) ? x : null);

export interface SignalTempsReel {
  le: string;
  action: string;
}

export interface OptionsApplication extends Partial<Omit<OptionsMonde, 'etat'>> {
  /** Dossier d'enregistrement ; null = tout en mémoire (tests, démonstration jetable). */
  dossier?: string | null;
  fetch?: Recuperateur;
  /**
   * `comptes` : connexion par identifiant + mot de passe, installation au premier lancement (défaut avec un dossier).
   * `demo` : choix libre d'un profil fictif, sans mot de passe (démonstration, tests).
   */
  connexion?: ModeConnexion;
  /** État à charger à la place du fichier (restauration d'une sauvegarde). */
  etat?: EtatApplication;
  /** Heure réelle en ms (codes de validation en deux étapes) ; tests seulement. */
  horloge?: () => number;
}

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const texte = (x: unknown, max: number) => (typeof x === 'string' && x.trim().length >= 1 && x.length <= max ? x.trim() : null);

/** Contrôle minimal d'un état avant de le charger (le monde revalide chaque objet). */
function verifierEtat(x: unknown): EtatApplication {
  if (!estObj(x) || x.version !== 1 || !estObj(x.monde) || x.monde.version !== 1 || !Array.isArray(x.monde.objets)) {
    throw new ErreurApi(400, 'sauvegarde_invalide', 'Ce fichier n’est pas une sauvegarde Living Business lisible.');
  }
  return x as unknown as EtatApplication;
}

function lireAvis(x: unknown): AvisSecurite[] {
  if (!Array.isArray(x)) return [];
  return x.filter((a): a is AvisSecurite => estObj(a) && typeof a.id === 'string' && typeof a.le === 'string' && (a.quoi === 'export' || a.quoi === 'export_avec_acces')
    && typeof a.par === 'string' && typeof a.parNom === 'string' && Array.isArray(a.vusPar) && a.vusPar.every((v) => typeof v === 'string')).slice(-AVIS_MAX);
}

export class Application {
  readonly monde: Monde;
  readonly synchro: Synchro;
  readonly enquetes: Enquetes;
  readonly automatisations: Automatisations;
  readonly cles: Cles;
  readonly comptes: Comptes;
  readonly nexus: LienNexus;
  readonly stockage: Stockage | null;
  readonly connexion: ModeConnexion;
  readonly options: OptionsApplication;
  #cle: Buffer;
  #chiffreur: Chiffreur;
  #demarre = false;
  #ferme = false;
  #reglages: ReglagesApplication;
  #bodacc: { verifieLe: string | null; alertes: AlerteBodacc[] };
  #historiqueSante: PointSante[];
  #avis: AvisSecurite[];
  #majs: EtatMisesAJour;
  #santeAJour = false;
  #fetch: Recuperateur | undefined;
  #ecouteurs = new Set<(s: SignalTempsReel) => void>();
  #minuteries: NodeJS.Timeout[] = [];

  private constructor(monde: Monde, stockage: Stockage | null, etat: Partial<EtatApplication> | null, o: OptionsApplication, connexion: ModeConnexion, cle: Buffer) {
    this.monde = monde;
    this.stockage = stockage;
    this.options = o;
    this.connexion = connexion;
    this.#cle = stockage?.cle ?? cle;
    this.#chiffreur = stockage?.chiffreur ?? creerChiffreur(this.#cle);
    const changement = () => this.#signaler('module');
    const f = o.fetch;
    // « Se connecter avec… » : relais de connexion sur l'adresse de Breizhcosystem connue du jeu (lue à chaque appel)
    const relais = new RelaisOAuth({ adresse: () => this.nexus.instantane().url, ...(f ? { fetch: f } : {}) });
    this.synchro = new Synchro(monde, this.#chiffreur, { etat: etat?.synchro ?? null, changement, relais, ...(f ? { fetch: f } : {}) });
    this.enquetes = new Enquetes(monde, { etat: etat?.enquetes ?? null, changement });
    this.cles = new Cles(monde, { etat: etat?.cles ?? null, changement });
    this.comptes = new Comptes({ etat: etat?.comptes ?? null, changement, maintenant: () => monde.maintenant(), chiffreur: this.#chiffreur, ...(o.horloge ? { horloge: o.horloge } : {}) });
    const verifierMaj = etat?.reglages?.verifierMisesAJour;
    const cons = etat?.reglages?.conservation;
    this.#reglages = { equipe: etat?.reglages?.equipe === true, surveillanceBodacc: etat?.reglages?.surveillanceBodacc === true, suggestionEnLigneMasquee: etat?.reglages?.suggestionEnLigneMasquee === true, verifierMisesAJour: typeof verifierMaj === 'boolean' ? verifierMaj : null,
      conservation: { planning: lireDuree(cons?.planning), avis: lireDuree(cons?.avis), courrier: lireDuree(cons?.courrier) } };
    this.#bodacc = { verifieLe: etat?.bodacc?.verifieLe ?? null, alertes: Array.isArray(etat?.bodacc?.alertes) ? etat.bodacc.alertes : [] };
    this.#historiqueSante = lireHistorique(etat?.sante?.historique);
    this.#avis = lireAvis(etat?.securite?.avis);
    this.#majs = lireEtatMaj(etat?.misesAJour);
    this.#fetch = f;
    this.nexus = new LienNexus({ etat: etat?.nexus ?? null, chiffreur: this.#chiffreur, changement, urlParDefaut: process.env.LB_NEXUS_URL ?? null, ...(f ? { fetch: f } : {}) });
    monde.brancherNexus(() => this.nexus.etatPavillon());
    this.automatisations = new Automatisations(monde, this.enquetes, this.synchro, { etat: etat?.automatisations ?? null, changement, trous: () => monde.trousPlanningReel(), trousProchains: () => monde.trousPlanningReel('prochains') });
    monde.abonner((ev) => {
      this.synchro.surChangement(ev.action);
      this.#planifierNexus();
      if (!ev.acteur.startsWith('automatisation:')) this.automatisations.planifier();
      this.#signaler(ev.action);
    });
  }

  static async creer(o: OptionsApplication = {}, cleMemoire?: Buffer): Promise<Application> {
    const connexion: ModeConnexion = o.connexion ?? (o.dossier ? 'comptes' : 'demo');
    const stockage = o.dossier ? new Stockage(o.dossier) : null;
    const brut = o.etat ?? (stockage?.lire() as Partial<EtatApplication> | null | undefined);
    if (brut && brut.version !== 1) throw new Error('Fichier d’enregistrement d’une version inconnue.');
    const options: Partial<OptionsMonde> = { ...o, exemple: o.exemple !== undefined ? o.exemple : connexion === 'demo' ? 'pme' : null, etat: brut?.monde ?? null };
    for (const k of ['dossier', 'fetch', 'connexion', 'horloge'] as const) delete (options as Record<string, unknown>)[k];
    let monde: Monde;
    try {
      monde = await Monde.creer(options);
    } catch (e) {
      if (o.etat) throw new ErreurApi(400, 'sauvegarde_invalide', `Sauvegarde illisible : ${e instanceof Error ? e.message : e}`);
      throw e;
    }
    const sansEtat: OptionsApplication = { ...o };
    delete sansEtat.etat;
    const app = new Application(monde, stockage, brut ?? null, sansEtat, connexion, cleMemoire ?? randomBytes(32));
    // restauration : les effacements faits depuis la copie sont rejoués (registre gardé hors des sauvegardes)
    if (stockage && o.etat) app.#rejouerEffacements(stockage);
    if (stockage && (!brut || o.etat)) { // 1er démarrage ou restauration : enregistré tout de suite, tel quel
      app.#persister();
      stockage.ecrireMaintenant();
    }
    return app;
  }

  instantane(): EtatApplication {
    return {
      version: 1,
      monde: this.monde.instantane(),
      synchro: this.synchro.instantane(),
      enquetes: this.enquetes.instantane(),
      automatisations: this.automatisations.instantane(),
      cles: this.cles.instantane(),
      comptes: this.comptes.instantane(),
      reglages: { ...this.#reglages, conservation: { ...this.#reglages.conservation } },
      nexus: this.nexus.instantane(),
      bodacc: { verifieLe: this.#bodacc.verifieLe, alertes: this.#bodacc.alertes },
      sante: { historique: this.#historiqueSante.map((p) => ({ ...p })) },
      securite: { avis: this.#avis.map((a) => ({ ...a, vusPar: [...a.vusPar] })) },
      misesAJour: { ...this.#majs },
    };
  }

  get reglages(): Readonly<ReglagesApplication> {
    return this.#reglages;
  }

  regler(r: Partial<ReglagesApplication>): void {
    if (typeof r.equipe === 'boolean') this.#reglages.equipe = r.equipe;
    if (typeof r.surveillanceBodacc === 'boolean') {
      this.#reglages.surveillanceBodacc = r.surveillanceBodacc;
      if (!r.surveillanceBodacc) this.#bodacc = { verifieLe: null, alertes: [] };
    }
    if (typeof r.suggestionEnLigneMasquee === 'boolean') this.#reglages.suggestionEnLigneMasquee = r.suggestionEnLigneMasquee;
    if (typeof r.verifierMisesAJour === 'boolean') this.#reglages.verifierMisesAJour = r.verifierMisesAJour;
    if (r.conservation) this.#reglages.conservation = { planning: lireDuree(r.conservation.planning), avis: lireDuree(r.conservation.avis), courrier: lireDuree(r.conservation.courrier) };
    this.#signaler('reglages');
  }

  #persister() {
    if (this.#ferme) return; // application remplacée (restauration) ou arrêtée : plus aucune écriture
    this.stockage?.planifier(() => this.instantane());
  }

  #signaler(action: string) {
    this.#santeAJour = false; // données, connecteurs ou automatisations changés : le relevé du jour sera refait
    this.#persister();
    const s = { le: new Date().toISOString(), action };
    for (const f of this.#ecouteurs) {
      try { f(s); } catch { /* client parti */ }
    }
  }

  /** Abonnement temps réel (aucune donnée métier transmise : le client relit avec SES droits). */
  abonner(f: (s: SignalTempsReel) => void): () => void {
    this.#ecouteurs.add(f);
    return () => { this.#ecouteurs.delete(f); };
  }

  get abonnes(): number {
    return this.#ecouteurs.size;
  }

  // ---------------------------------------------------------------- score de santé

  /** Score de santé (6 domaines, 46 critères) sur ce que le profil voit. Réservé aux profils qui voient le score. */
  sante(p: Profil, sid: string): ResultatSante {
    if (!p.voitScore) throw new ErreurApi(403, 'interdit', 'Votre profil ne voit pas le score de l’entreprise.');
    this.#noterSante();
    return this.#evaluerSante(p, sid);
  }

  /**
   * Score de santé et sa tendance (page Santé). La tendance est celle de l'entreprise entière : elle n'est donnée
   * qu'aux profils qui voient tout (sinon `tendance` vaut null, leur score portant sur un périmètre réduit).
   */
  santeAvecTendance(p: Profil, sid: string): ResultatSante & { tendance: SerieSante | null } {
    const r = this.sante(p, sid);
    const toutVoir = p.types === 'tous' && p.lieux === 'tous' && p.rolesTiers === 'tous' && p.departements === 'tous';
    if (!toutVoir) return { ...r, tendance: null };
    const auj = this.monde.maintenant().toISOString().slice(0, 10);
    if (this.monde.organisation.demo) {
      const g = this.#evaluerSante(SYSTEME, 'systeme:historique');
      return { ...r, tendance: { points: serieExemple(auj, g.score, g.couverture), jours: JOURS_TENDANCE, exemple: true } };
    }
    return { ...r, tendance: { points: derniersJours(this.#historiqueSante, auj), jours: JOURS_TENDANCE, exemple: false } };
  }

  /** Relevé du jour (entreprise entière, espace réel), recalculé seulement si les données ont changé. Jamais en exemple. */
  #noterSante() {
    const jour = this.monde.maintenant().toISOString().slice(0, 10);
    if (this.#santeAJour && this.#historiqueSante.at(-1)?.jour === jour) return;
    this.#santeAJour = true;
    if (this.monde.organisation.demo) return;
    let g: ResultatSante;
    try { g = this.#evaluerSante(SYSTEME, 'systeme:historique'); } catch { return; }
    if (noter(this.#historiqueSante, { jour, score: g.score, couverture: g.couverture })) this.#persister();
  }

  #evaluerSante(p: Profil, sid: string): ResultatSante {
    const d = this.monde.donneesSante(p, sid);
    const s = this.synchro.resume();
    const a = this.automatisations.resumeSante();
    // baromètre : seulement les réponses publiées par lots (magasin anonyme), si ce profil voit le baromètre
    const barometre = p.peutAdministrer || p.types === 'tous' || p.types.includes('barometre') ? this.enquetes.objetsSante() : [];
    return evaluerSante({
      objets: [...d.objets, ...barometre], planning: d.planning, ageMaxMs: d.ageMaxMs, maintenant: this.monde.maintenant(),
      // sans le droit RH, ni « absences maladie » ni « temps de formation » : le taux désignerait l'arrêt d'un collègue
      motifsAbsence: voitMotifsAbsence(p),
      modules: { connecteursActifs: s.actifs, connecteursEnErreur: s.enErreur, automatisationsActives: a.actives, heuresRecuperables: a.heuresRecuperables },
    });
  }

  /**
   * Import du FEC exporté par le logiciel comptable (Sage, EBP, Cegid, Ciel, Quadra…) : seuls les totaux sont gardés,
   * dans la fiche entreprise. Le fichier lui-même n'est ni enregistré ni envoyé ailleurs.
   */
  importerFec(p: Profil, sid: string, d: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const texte = d && typeof d === 'object' && typeof (d as { texte?: unknown }).texte === 'string' ? (d as { texte: string }).texte : null;
    if (!texte) throw new ErreurApi(400, 'requete_invalide', 'Fichier FEC manquant.');
    let s: SyntheseFec;
    try {
      s = lireFec(texte);
    } catch (e) {
      if (e instanceof ErreurFec) throw new ErreurApi(400, 'fec_invalide', e.message);
      throw e;
    }
    const v = valeursFiche(s);
    this.monde.modifierOrganisation(p, sid, Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null).map(([k, x]) => [k, String(x)])));
    return { debut: s.debut, fin: s.fin, mois: s.mois, ecritures: s.lignes, valeurs: v, score: p.voitScore ? this.sante(p, sid).score : null };
  }

  // ---------------------------------------------------------------- clients en difficulté (Bodacc)

  get bodacc() {
    return { actif: this.#reglages.surveillanceBodacc, verifieLe: this.#bodacc.verifieLe, alertes: this.#bodacc.alertes, surveilles: clientsSurveilles(this.monde.objetsReels()).size };
  }

  /** Vérifie les clients (12 derniers mois). Ne fait rien si l'entreprise n'a pas activé la surveillance. */
  async verifierBodacc(): Promise<number> {
    if (!this.#reglages.surveillanceBodacc) return 0;
    const clients = clientsSurveilles(this.monde.objetsReels());
    const depuis = new Date(this.monde.maintenant().getTime() - 365 * 86_400_000);
    const alertes = clients.size ? await proceduresCollectives(clients, depuis, this.#fetch ?? recuperateurProtege) : [];
    this.#bodacc = { verifieLe: this.monde.maintenant().toISOString(), alertes };
    this.#signaler('bodacc');
    return alertes.length;
  }

  // ---------------------------------------------------------------- Breizhcosystem : partage ciblé automatique

  /** Ce que le jeu partagerait avec Breizhcosystem (données réelles, vue système ; seules les catégories cochées partent). */
  donneesPartage() {
    const d = this.monde.donneesSante(SYSTEME, 'systeme:nexus');
    let sante: ResultatSante | null = null;
    try { sante = this.sante({ ...SYSTEME, voitScore: true }, 'systeme:nexus'); } catch { sante = null; }
    return { objets: d.objets, planning: d.planning, sante, maintenant: this.monde.maintenant() };
  }

  #attenteNexus: NodeJS.Timeout | null = null;
  /** Après un changement : envoi regroupé (1 min) si l'entreprise est reliée. */
  #planifierNexus() {
    if (!this.nexus.partageConsenti || this.#attenteNexus || !this.#demarre) return;
    this.#attenteNexus = setTimeout(() => { this.#attenteNexus = null; void this.nexus.envoyer(this.donneesPartage()).catch(() => undefined); }, 60_000);
    this.#attenteNexus.unref?.();
  }

  // ---------------------------------------------------------------- effacement et droit d'accès (RGPD)

  /**
   * Efface ou anonymise une fiche (monde, en cascade), puis les modules l'oublient : connecteurs (lien retiré,
   * enregistrement de l'outil plus réimporté), invitations aux formulaires, automatisations. Noté dans le registre
   * des effacements (hors sauvegardes) pour être rejoué après une restauration.
   */
  effacerObjet(p: Profil, sid: string, id: unknown, d: unknown) {
    const r = this.monde.effacerObjet(p, sid, id, d);
    const outils = this.synchro.oublierObjet(r.id);
    this.enquetes.oublierObjet(r.id);
    this.automatisations.oublierObjet(r.id);
    this.stockage?.noterEffacement(r.id, r.mode);
    return { ...r, outils, sauvegardesJours: this.stockage ? CONSERVATION_JOURS : 0 };
  }

  /** Droit d'accès : la fiche et tout ce qui s'y rattache, plus les formulaires envoyés (dates seulement). */
  donneesObjet(p: Profil, sid: string, id: unknown) {
    const d = this.monde.donneesObjet(p, sid, id);
    return { ...d, formulaires: this.enquetes.invitationsDe(id as string) };
  }

  /**
   * Durées de conservation de l'entreprise appliquées (une fois par jour, et tout de suite après un réglage) :
   * planning, avis clients et courrier traité plus anciens effacés, en cascade comme un effacement à la main.
   */
  purgerDonneesAnciennes(): { cases: number; fiches: number } {
    const c = this.#reglages.conservation;
    const avant = (jours: number | null) => (jours ? new Date(this.monde.maintenant().getTime() - jours * 86_400_000).toISOString().slice(0, 10) : null);
    const r = this.monde.purgerAnciennes({ planningAvant: avant(c.planning), avisAvant: avant(c.avis), courrierAvant: avant(c.courrier) });
    for (const id of r.ids) { this.synchro.oublierObjet(id); this.enquetes.oublierObjet(id); this.automatisations.oublierObjet(id); }
    this.#purgeeLe = Date.now();
    return { cases: r.cases, fiches: r.ids.length };
  }
  #purgeeLe = 0;

  /**
   * Restauration sur un autre serveur (constat revue-jeu-1-6) : le registre des effacements repris avec la copie
   * (`registre-effacements.jsonl`) rejoint le registre local AVANT que l'état soit remplacé, pour être rejoué avec lui.
   */
  importerEffacements(texte: unknown): number {
    if (texte === undefined || texte === null || texte === '') return 0;
    if (!this.stockage) throw new ErreurApi(409, 'sans_stockage', 'Pas de dossier de données : rien à restaurer ici.');
    try { return this.stockage.importerEffacements(texte); } catch (e) {
      throw new ErreurApi(400, 'registre_invalide', e instanceof Error ? e.message : 'Registre des effacements illisible.');
    }
  }

  #rejouerEffacements(stockage: Stockage) {
    for (const e of stockage.lireEffacements()) {
      if (!this.monde.rejouerEffacement(e.id, e.mode)) continue;
      this.synchro.oublierObjet(e.id);
      this.enquetes.oublierObjet(e.id);
      this.automatisations.oublierObjet(e.id);
    }
  }

  // ---------------------------------------------------------------- nouvelles versions (alerte, rien n'est envoyé)

  /** Vérification quotidienne : réglage de l'entreprise, sinon oui pour un jeu en ligne (exposé sur Internet). */
  get verificationMisesAJour(): boolean {
    return this.#reglages.verifierMisesAJour ?? process.env.LB_EN_LIGNE === '1';
  }

  misesAJour() {
    // seule source des nouvelles versions à montrer : la page de téléchargement du Breizhcosystem réglé ici (https seulement),
    // jamais un lien reçu par e-mail
    const nexus = adresseNexus(this.nexus.instantane().url ?? process.env.LB_NEXUS_URL ?? null);
    return { ...resumeMaj(this.#majs, this.verificationMisesAJour), telechargement: nexus ? `${nexus}/telecharger` : null };
  }

  /** Lit la liste publique des versions sur Breizhcosystem (adresse de Réglages › Breizhcosystem, ou celle préréglée). */
  async verifierMisesAJour() {
    const nexus = this.nexus.instantane().url ?? process.env.LB_NEXUS_URL ?? null;
    const maintenant = this.monde.maintenant().toISOString();
    if (!nexus) {
      this.#majs = { ...this.#majs, verifieLe: maintenant, erreur: 'Adresse de Breizhcosystem inconnue (Réglages › Breizhcosystem) : vérification impossible.' };
    } else {
      try {
        const r = await lireDerniereVersion(nexus, this.#fetch ?? recuperateurProtege);
        this.#majs = { verifieLe: maintenant, derniere: r.version, securite: r.securite, erreur: null };
      } catch (e) {
        this.#majs = { ...this.#majs, verifieLe: maintenant, erreur: `Breizhcosystem injoignable : ${e instanceof Error ? e.message : 'erreur'}`.slice(0, 200) };
      }
    }
    this.#signaler('mises-a-jour');
    return this.misesAJour();
  }

  // ---------------------------------------------------------------- installation (premier lancement)

  /** Crée l'entreprise et le compte du propriétaire. Renvoie le code de secours (à montrer une seule fois). */
  async installer(d: unknown) {
    if (this.connexion !== 'comptes') throw new ErreurApi(409, 'mode_demo', 'Démonstration : pas d’installation.');
    if (this.comptes.installe) throw new ErreurApi(409, 'deja_installe', 'Living Business est déjà installé : connectez-vous.');
    const x = estObj(d) ? d : {};
    const nom = texte(x.nom, 80);
    if (!nom) throw new ErreurApi(400, 'nom_invalide', 'Indiquez votre nom (il apparaîtra dans le journal).');
    const depart = x.depart === 'vide' || x.depart === 'exemple' || x.depart === 'garder' ? x.depart : null;
    if (!depart) throw new ErreurApi(400, 'depart_invalide');
    const entreprise = texte(x.entreprise, 120) ?? '';
    if (depart === 'vide' && !entreprise) throw new ErreurApi(400, 'entreprise_invalide', 'Indiquez le nom de votre entreprise.');
    if (depart === 'garder' && this.monde.contenuExistant().reels === 0 && !entreprise) throw new ErreurApi(400, 'entreprise_invalide', 'Indiquez le nom de votre entreprise.');
    const identifiant = normaliserIdentifiant(x.identifiant);
    if (!identifiant) throw new ErreurApi(400, 'identifiant_invalide', 'Identifiant : votre e-mail ou un prénom (lettres, chiffres, . _ - @).');
    const pb = problemeMotDePasse(x.motDePasse, identifiant);
    if (pb) throw new ErreurApi(400, 'mot_de_passe_faible', pb);
    const profil = this.monde.initialiser({ nom, entreprise, depart, exemple: x.exemple === 'eti' ? 'eti' : 'pme' });
    const r = await this.comptes.installer(identifiant, x.motDePasse, profil.id);
    return { compte: r.compte, profil, codeSecours: r.codeSecours };
  }

  // ---------------------------------------------------------------- sauvegardes

  sauvegardesAuto(): SauvegardeAuto[] {
    return this.stockage?.listerSauvegardes() ?? [];
  }

  /**
   * Export portable (copie hors site, changement d'ordinateur, mise en ligne) : chiffré par une phrase choisie par
   * l'entreprise. L'identité est revérifiée AVANT par l'appelant (mot de passe et code, jamais avec une clé d'API).
   * Par défaut SANS la clé des secrets : les jetons des logiciels connectés et les secrets de validation en deux
   * étapes y restent chiffrés par la clé de CETTE installation (illisibles ailleurs, retrouvés si on restaure ici).
   * `avecAcces` (autre ordinateur, serveur) : la clé est incluse, la phrase doit être plus longue. Journalisé, et
   * les autres administrateurs en sont avertis.
   */
  async exporter(p: Profil, d: unknown): Promise<Record<string, unknown>> {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const x = estObj(d) ? d : {};
    const avecAcces = x.avecAcces === true;
    const min = avecAcces ? PHRASE_MIN_AVEC_ACCES : PHRASE_MIN;
    const phrase = x.phrase;
    if (typeof phrase !== 'string' || phrase.length < min || phrase.length > 200) {
      throw new ErreurApi(400, 'phrase_courte', `La phrase de protection doit faire au moins ${min} caractères${avecAcces ? ' quand la copie contient les accès aux logiciels connectés' : ''}.`);
    }
    const contenu = JSON.stringify(avecAcces ? { etat: this.instantane(), cleSecrets: this.#cle.toString('base64') } : { etat: this.instantane() });
    const fichier = await chiffrerAvecPhrase(contenu, phrase);
    this.monde.tracer(p, 'sauvegarde.exportee', null, avecAcces ? 'copie complète avec la clé des accès aux logiciels connectés' : 'copie complète sans la clé des accès');
    this.#ajouterAvis(p, avecAcces ? 'export_avec_acces' : 'export');
    return fichier;
  }

  #ajouterAvis(p: Profil, quoi: AvisSecurite['quoi']) {
    const maintenant = this.monde.maintenant();
    this.#avis = [...this.#avis.filter((a) => maintenant.getTime() - Date.parse(a.le) < AVIS_DUREE_MS), { id: randomBytes(9).toString('base64url'), le: maintenant.toISOString(), quoi, par: p.id, parNom: p.nom.slice(0, 80), vusPar: [p.id] }].slice(-AVIS_MAX);
    this.#signaler('securite');
  }

  /** Avis de sécurité que cet administrateur n'a pas encore vus (jamais les siens). */
  avisSecurite(p: Profil): { id: string; le: string; quoi: AvisSecurite['quoi']; par: string }[] {
    if (!p.peutAdministrer) return [];
    const maintenant = this.monde.maintenant().getTime();
    return this.#avis.filter((a) => !a.vusPar.includes(p.id) && maintenant - Date.parse(a.le) < AVIS_DUREE_MS).map((a) => ({ id: a.id, le: a.le, quoi: a.quoi, par: a.parNom })).reverse();
  }

  voirAvis(p: Profil, id: unknown): { ok: true } {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const a = this.#avis.find((x) => x.id === id);
    if (!a) throw new ErreurApi(404, 'introuvable');
    if (!a.vusPar.includes(p.id)) {
      a.vusPar.push(p.id);
      this.monde.tracer(p, 'securite.avis_vu', null, `avis du ${a.le.slice(0, 10)} (${a.quoi === 'export_avec_acces' ? 'export complet avec les accès' : 'export complet'} par ${a.parNom}) marqué « vu »`);
      this.#signaler('securite');
    }
    return { ok: true };
  }

  /**
   * Lit un export : vérifie la phrase et ré-chiffre les secrets pour CETTE installation. Export sans la clé : les
   * secrets lisibles avec la clé d'ici (même installation) sont gardés ; les autres sont effacés (connecteurs à
   * reconnecter, validation en deux étapes à réactiver), jamais laissés illisibles.
   */
  async lireExport(fichier: unknown, phrase: unknown): Promise<EtatApplication> {
    let clair: string;
    try {
      clair = await dechiffrerAvecPhrase(fichier, typeof phrase === 'string' ? phrase : '');
    } catch {
      throw new ErreurApi(400, 'sauvegarde_illisible', 'Fichier de sauvegarde illisible ou phrase incorrecte.');
    }
    const d = JSON.parse(clair) as { etat?: unknown; cleSecrets?: unknown };
    const etat = verifierEtat(d.etat);
    const ancien = typeof d.cleSecrets === 'string' ? creerChiffreur(Buffer.from(d.cleSecrets, 'base64')) : this.#chiffreur;
    for (const c of etat.synchro?.connecteurs ?? []) {
      for (const k of ['secret', 'secretEntrant'] as const) {
        if (!c[k]) continue;
        try { c[k] = this.#chiffreur.chiffrer(ancien.dechiffrer(c[k] as string)); } catch { c[k] = null; }
      }
      // réglages chiffrés (adresse du webhook sortant) : même traitement, effacés s'ils sont illisibles
      for (const k of CHAMPS_CHIFFRES) {
        const v = c.config?.[k];
        if (!v || !VALEUR_CHIFFREE.test(v)) continue;
        try { c.config = { ...c.config, [k]: this.#chiffreur.chiffrer(ancien.dechiffrer(v)) }; } catch { c.config = { ...c.config, [k]: '' }; }
      }
    }
    // validation en deux étapes : secret ré-chiffré pour cette installation (illisible : désactivée, à refaire)
    for (const c of etat.comptes?.comptes ?? []) {
      if (!c.deuxEtapes) continue;
      try { c.deuxEtapes = { ...c.deuxEtapes, secret: this.#chiffreur.chiffrer(ancien.dechiffrer(c.deuxEtapes.secret)) }; } catch { c.deuxEtapes = null; }
    }
    return etat;
  }

  /** Sauvegarde automatique du jour choisi (même installation : mêmes clés). */
  lireSauvegardeAuto(nom: unknown): EtatApplication {
    let brut: unknown;
    try { brut = this.stockage?.lireSauvegarde(nom) ?? null; } catch { brut = null; }
    if (!brut) throw new ErreurApi(404, 'introuvable', 'Sauvegarde introuvable.');
    return verifierEtat(brut);
  }

  /**
   * Remplace tout l'état par celui d'une sauvegarde. Une copie de l'état actuel est gardée avant. Le journal de
   * sécurité d'ici suit dans le nouvel état, avec la trace de la restauration : remplacer l'état n'efface pas la
   * trace d'un export, d'une clé ou d'un accès (constats revue-jeu-1-4 et 1-9).
   */
  async remplacer(etat: EtatApplication, o: { par?: Profil | null; quoi?: string } = {}): Promise<Application> {
    this.stockage?.sauvegarderMaintenant('avant-restauration');
    const etaitDemarre = this.#demarre;
    const securite = [...this.monde.journalSecuriteBrut()];
    this.arreter();
    const nouvelle = await Application.creer({ ...this.options, etat }, this.#cle);
    nouvelle.monde.reprendreJournalSecurite(securite);
    const par = o.par ?? null;
    nouvelle.monde.tracer(par ?? { ...SYSTEME, id: 'systeme:installation' }, 'sauvegarde.restauree', null, `${o.quoi ?? 'sauvegarde restaurée'}${par ? `, par ${par.nom.slice(0, 80)}` : ''} : tout l’état a été remplacé`);
    if (etaitDemarre) nouvelle.demarrer();
    return nouvelle;
  }

  // ---------------------------------------------------------------- tâches de fond

  /** Lectures périodiques des outils et passage des automatisations. */
  demarrer(): void {
    this.#demarre = true;
    this.#ferme = false;
    const t1 = setInterval(() => { void this.synchro.tick().catch(() => undefined); }, 15_000);
    const t2 = setInterval(() => { void this.automatisations.executer().catch(() => undefined); }, 60_000);
    const t3 = setTimeout(() => { void this.automatisations.executer().catch(() => undefined); void this.synchro.tick().catch(() => undefined); }, 3000);
    // Breizhcosystem : envoi du partage ciblé toutes les 30 min (et après les changements)
    const t4 = setInterval(() => { if (this.nexus.partageConsenti) void this.nexus.envoyer(this.donneesPartage()).catch(() => undefined); }, 30 * 60_000);
    // Bodacc : une vérification par jour (si l'entreprise l'a activée)
    const bodaccDu = () => { const v = this.#bodacc.verifieLe; if (!v || Date.now() - Date.parse(v) > 20 * 3600_000) void this.verifierBodacc().catch(() => undefined); };
    const t5 = setInterval(bodaccDu, 3600_000);
    const t6 = setTimeout(bodaccDu, 15_000);
    // nouvelles versions : une lecture par jour au plus, si la vérification est active
    const majDue = () => { const v = this.#majs.verifieLe; if (this.verificationMisesAJour && (!v || Date.now() - Date.parse(v) > 20 * 3600_000)) void this.verifierMisesAJour().catch(() => undefined); };
    const t7 = setInterval(majDue, 3600_000);
    const t8 = setTimeout(majDue, 20_000);
    // durées de conservation choisies par l'entreprise : une passe par jour
    const purgeDue = () => { const c = this.#reglages.conservation; if ((c.planning || c.avis || c.courrier) && Date.now() - this.#purgeeLe > 20 * 3600_000) { try { this.purgerDonneesAnciennes(); } catch { /* nouvel essai dans une heure */ } } };
    const t9 = setInterval(purgeDue, 3600_000);
    const t10 = setTimeout(purgeDue, 25_000);
    for (const t of [t1, t2, t3, t4, t5, t6, t7, t8, t9, t10]) t.unref?.();
    this.#minuteries.push(t1, t2, t3, t4, t5, t6, t7, t8, t9, t10);
  }

  arreter(): void {
    if (this.#ferme) return; // déjà arrêtée ou remplacée : surtout ne pas réécrire un ancien état sur le disque
    this.#demarre = false;
    for (const t of this.#minuteries) clearInterval(t);
    this.#minuteries = [];
    if (this.#attenteNexus) { clearTimeout(this.#attenteNexus); this.#attenteNexus = null; }
    this.stockage?.ecrireMaintenant();
    this.#ferme = true;
  }
}

export type { Exemple };
