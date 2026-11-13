/**
 * Alertes en temps réel sur un canal de l'entreprise : Telegram, WhatsApp Business, ou un webhook à soi.
 *
 * - Rien d'obligatoire : sans canal branché, ce module ne fait rien et le jeu ne change pas d'un pouce.
 * - Ce qu'on reçoit : une liste à cocher en langage d'entrepreneur (`SUJETS`), presque tout décoché au départ.
 * - Quand : tout de suite, ou regroupé une fois par jour à l'heure choisie ; heures de silence, week-end, et un
 *   maximum de messages par jour. Une urgence vraie (situation critique) passe quand même, et on peut le refuser.
 * - Le message dit quoi, combien, et quoi faire, avec un lien qui ouvre le bon écran du jeu. Jamais d'e-mail, de
 *   téléphone, d'adresse, de SIRET ni de commentaire : le détail se lit dans le jeu.
 * - Anti-doublon : chaque fait n'est annoncé qu'une fois, tant qu'il dure.
 * - Échec d'envoi : nouvel essai espacé (1 min, 5, 15, 1 h, 3 h, 6 h) ; après 8 échecs de suite le canal se met en
 *   pause et la raison est écrite dans les réglages. Une erreur définitive (jeton refusé, conversation introuvable)
 *   met en pause tout de suite : réessayer n'y changerait rien.
 * - Secrets : jetons et adresses chiffrés au repos par le coffre de l'installation, jamais renvoyés au navigateur,
 *   jamais écrits dans un journal (ce qui pourrait contenir un jeton est remplacé par « … » avant d'être noté).
 * - Appels sortants : toujours par `sortant.ts` (HTTPS, anti-SSRF, pas de redirection, taille et délai bornés).
 *
 * Documentation suivie pour chaque appel : voir `docs/CONNECTEURS.md`, section « Alertes ».
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ObjetMetier } from '../core/model.ts';
import type { Situation } from '../core/situation.ts';
import { mesure, pluriel } from '../core/texte.ts';
import type { Univers } from '../core/univers.ts';
import type { Profil } from '../demo/donnees.ts';
import { ErreurApi } from './monde.ts';
import { appeler, recuperateurProtege, verifierUrl, type Recuperateur } from './sortant.ts';
import type { Chiffreur } from './stockage.ts';

export type Canal = 'telegram' | 'whatsapp' | 'webhook';

/** Version de l'API Graph utilisée pour WhatsApp (la plus récente servie par Meta au moment de l'écriture). */
export const VERSION_WHATSAPP = 'v27.0';
const TELEGRAM = 'https://api.telegram.org';
const GRAPH = 'https://graph.facebook.com';

// ---------------------------------------------------------------- ce qu'on peut recevoir

/** Un sujet d'alerte, dit en langage d'entrepreneur. `defaut` : coché à la première ouverture. */
export interface Sujet { id: string; libelle: string; aide: string; defaut: boolean }

export const SUJETS: readonly Sujet[] = Object.freeze([
  { id: 'facture_retard', libelle: 'Une facture en retard', aide: 'Un client n’a pas payé à l’échéance.', defaut: true },
  { id: 'devis_sans_reponse', libelle: 'Un devis sans réponse', aide: 'Un devis envoyé reste sans réponse depuis plus d’une semaine.', defaut: false },
  { id: 'commande', libelle: 'Une commande client à traiter', aide: 'Livrée mais pas encore facturée, ou livraison en retard.', defaut: false },
  { id: 'echeance', libelle: 'Une échéance qui approche', aide: 'Contrôle technique, révision, document qui expire, tâche en retard.', defaut: true },
  { id: 'stock_bas', libelle: 'Un stock bas', aide: 'Un article passe sous son seuil d’alerte.', defaut: false },
  { id: 'demande_reseau', libelle: 'Une demande du réseau', aide: 'Une entreprise de Breizhcosystem attend votre réponse.', defaut: false },
  { id: 'erreur_synchro', libelle: 'Une erreur de synchronisation', aide: 'Un logiciel connecté ne répond plus, ou refuse l’accès.', defaut: true },
  { id: 'autre_alerte', libelle: 'Une autre alerte importante', aide: 'Ce que le jeu signale et qui n’entre dans aucune case ci-dessus.', defaut: false },
  { id: 'resume_matin', libelle: 'Le résumé du matin', aide: 'Une fois par jour : ce qu’il y a à régler aujourd’hui, en une phrase.', defaut: false },
].map((s) => Object.freeze(s)));

const IDS_SUJETS: ReadonlySet<string> = new Set(SUJETS.map((s) => s.id));
export const SUJETS_DEFAUT: readonly string[] = SUJETS.filter((s) => s.defaut).map((s) => s.id);

// ---------------------------------------------------------------- quand

export interface Quand {
  /** `tout_de_suite` : dès que c'est vu. `une_fois_par_jour` : tout regroupé en un message, à `heure`. */
  mode: 'tout_de_suite' | 'une_fois_par_jour';
  /** Heure du regroupement et du résumé du matin (HH:MM, heure de cet ordinateur). */
  heure: string;
  /** Rien avant cette heure, rien à partir de celle-là. */
  silenceAvant: string;
  silenceApres: string;
  /** Faux : rien le samedi ni le dimanche. */
  weekEnd: boolean;
  /** Au plus tant de messages par jour (un message peut porter plusieurs lignes). */
  maxParJour: number;
  /** Une urgence vraie (situation critique) passe malgré le silence, le week-end et le plafond. */
  urgencesPassent: boolean;
}

export const QUAND_DEFAUT: Quand = Object.freeze({
  mode: 'tout_de_suite', heure: '08:30', silenceAvant: '08:00', silenceApres: '19:00',
  weekEnd: false, maxParJour: 10, urgencesPassent: true,
});

const HEURE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const enMinutes = (h: string): number => { const m = HEURE.exec(h); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

// ---------------------------------------------------------------- canaux

export interface CanalEnregistre {
  id: string;
  canal: Canal;
  nom: string;
  /** Réglages du canal (jeton, conversation, adresse…) en JSON, chiffrés au repos. Jamais renvoyés au navigateur. */
  prive: string;
  /** Ce qu'on montre à l'écran à la place : « @robot-du-port → Gaël », « https://hook.exemple.fr/… ». */
  resume: string;
  actif: boolean;
  statut: 'jamais' | 'ok' | 'erreur';
  message: string | null;
  dernierEnvoi: string | null;
  /** Échecs d'affilée (remis à zéro dès qu'un envoi passe). */
  echecs: number;
  prochainEssai: string | null;
  creeLe: string;
  journal: { le: string; ok: boolean; detail: string }[];
}

/** Réglages privés d'un canal, tels qu'ils sont chiffrés. */
interface PriveTelegram { jeton: string; conversation: string }
interface PriveWhatsapp { jeton: string; numeroId: string; destinataire: string; modele: string; langue: string }
interface PriveWebhook { url: string; secret: string | null }

export interface EtatAlertes {
  canaux: CanalEnregistre[];
  sujets: string[];
  quand: Quand;
  /** Adresse du jeu, pour le lien à la fin du message (origine seulement). */
  adresseJeu: string | null;
  /** Faits déjà annoncés (clé → date) : on ne redit pas deux fois la même chose tant qu'elle dure. */
  vus: Record<string, string>;
  /** Faits vus mais pas encore envoyés (regroupement, silence, plafond, nouvel essai). */
  attente: FaitRetenu[];
  /** Compteur du jour. */
  jour: string;
  envoyes: number;
  /** Jour du dernier résumé du matin. */
  resumeLe: string | null;
}

interface Fait {
  /** Identité stable d'un fait : il n'est annoncé qu'une fois tant qu'il dure. */
  cle: string;
  sujet: string;
  urgent: boolean;
  /** Une phrase : quoi, combien, quoi faire. */
  texte: string;
  /** Écran du jeu à ouvrir (« #/type:facture ») ; null : l'écran d'accueil. */
  vue: string | null;
}
type FaitRetenu = Fait & { depuis: string };

/** Ce que le module a besoin de savoir du reste du jeu (branché par `application.ts`). */
export interface SourcesAlertes {
  maintenant(): Date;
  objets(): readonly ObjetMetier[];
  situations(): readonly Situation[];
  univers(): Univers;
  /** Logiciels connectés en panne : leur nom et la raison, pour une phrase utile. */
  connecteursEnErreur(): { nom: string; message: string | null }[];
  /** Demandes du réseau qui attendent une réponse ; null quand l'entreprise n'y est pas reliée. */
  reseau?: () => Promise<number | null>;
}

const ID = /^al-[a-f0-9]{12}$/;
const JOUR_MS = 86_400_000;
/** Nouvel essai après un échec, par nombre d'échecs d'affilée (minutes). */
const ESSAIS_MIN = [1, 5, 15, 60, 180, 360] as const;
const ECHECS_AVANT_PAUSE = 8;
const ATTENTE_MAX = 200;
/** Un fait qui n'a pas pu partir en 48 h est abandonné (il sera de toute façon encore à l'écran). */
const ATTENTE_DUREE_MS = 2 * JOUR_MS;
const LIGNES_MAX = 5;
const TEXTE_MAX = 3500;
const CANAUX_MAX = 5;

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const sansMention = (nom: string) => nom.replace(/\s*\((démo|fictif|fictive)\)/gi, '');
/** Une seule ligne, sans caractère de contrôle : ce qui part vers un service extérieur ne porte jamais de mise en forme. */
const uneLigne = (t: string) => t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();

/** Quoi faire, selon le sujet et le type de l'objet. */
function quoiFaire(sujet: string, type: string): string {
  if (sujet === 'facture_retard') return 'À relancer.';
  if (sujet === 'devis_sans_reponse') return 'À relancer.';
  if (sujet === 'stock_bas') return 'À commander.';
  if (sujet === 'commande') return 'À facturer.';
  if (sujet === 'erreur_synchro') return 'À vérifier dans Réglages, Connecteurs.';
  if (sujet === 'demande_reseau') return 'À répondre.';
  if (type === 'vehicule') return 'Prendre rendez-vous.';
  if (type === 'document') return 'À renouveler.';
  return 'À traiter.';
}

export class Alertes {
  #src: SourcesAlertes;
  #chiffreur: Chiffreur;
  #f: Recuperateur;
  #changement: () => void;
  #etat: EtatAlertes;
  #enCours = false;
  /** Branchements Telegram en cours (jeton pas encore enregistré) : en mémoire seulement, 30 min au plus. */
  #telegram = new Map<string, { jeton: string; robot: string; conversation: string | null; conversationNom: string | null; expire: number }>();
  /** Dernière consultation du réseau (au plus une fois par quart d'heure). */
  #reseauLe = 0;
  #reseauN: number | null = null;

  constructor(src: SourcesAlertes, chiffreur: Chiffreur, o: { etat?: EtatAlertes | null; changement?: () => void; fetch?: Recuperateur } = {}) {
    this.#src = src;
    this.#chiffreur = chiffreur;
    this.#f = o.fetch ?? recuperateurProtege;
    this.#changement = o.changement ?? (() => {});
    const e = o.etat;
    this.#etat = {
      canaux: (Array.isArray(e?.canaux) ? e.canaux : []).filter((c) => estObj(c) && ID.test(String(c.id)) && typeof c.prive === 'string').slice(0, CANAUX_MAX),
      sujets: Array.isArray(e?.sujets) ? e.sujets.filter((s) => IDS_SUJETS.has(s)) : [...SUJETS_DEFAUT],
      quand: lireQuand(e?.quand),
      adresseJeu: typeof e?.adresseJeu === 'string' ? e.adresseJeu : null,
      vus: estObj(e?.vus) ? (e.vus as Record<string, string>) : {},
      attente: Array.isArray(e?.attente) ? e.attente.filter((a) => estObj(a) && typeof a.cle === 'string' && typeof a.texte === 'string').slice(-ATTENTE_MAX) : [],
      jour: typeof e?.jour === 'string' ? e.jour : '',
      envoyes: typeof e?.envoyes === 'number' && e.envoyes >= 0 ? e.envoyes : 0,
      resumeLe: typeof e?.resumeLe === 'string' ? e.resumeLe : null,
    };
  }

  instantane(): EtatAlertes {
    return this.#etat;
  }

  /** Au moins un canal branché et en marche : sinon le module ne fait rien du tout. */
  actif(): boolean {
    return this.#etat.canaux.some((c) => c.actif);
  }

  #admin(p: Profil) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
  }

  #trouver(id: unknown): CanalEnregistre {
    const c = typeof id === 'string' && ID.test(id) ? this.#etat.canaux.find((x) => x.id === id) : undefined;
    if (!c) throw new ErreurApi(404, 'introuvable');
    return c;
  }

  #lirePrive<T>(c: CanalEnregistre): T {
    return JSON.parse(this.#chiffreur.dechiffrer(c.prive)) as T;
  }

  // ---------------------------------------------------------------- réglages

  #vue(c: CanalEnregistre) {
    return {
      id: c.id, canal: c.canal, nom: c.nom, resume: c.resume, actif: c.actif, statut: c.statut, message: c.message,
      dernierEnvoi: c.dernierEnvoi, echecs: c.echecs, prochainEssai: c.prochainEssai, creeLe: c.creeLe,
      journal: c.journal.slice(-5).reverse(),
    };
  }

  /** Tout ce que l'écran de réglages montre. Aucun jeton, aucune adresse complète n'en sort. */
  reglages(p: Profil) {
    this.#admin(p);
    return {
      canaux: this.#etat.canaux.map((c) => this.#vue(c)),
      canauxMax: CANAUX_MAX,
      sujets: SUJETS.map((s) => ({ ...s, choisi: this.#etat.sujets.includes(s.id) })),
      quand: { ...this.#etat.quand },
      adresseJeu: this.#etat.adresseJeu,
      enAttente: this.#etat.attente.length,
      envoyesAujourdhui: this.#jour() === this.#etat.jour ? this.#etat.envoyes : 0,
      versionWhatsapp: VERSION_WHATSAPP,
    };
  }

  /** Sujets cochés, moment des envois, adresse du jeu pour les liens. Chacun est facultatif. */
  regler(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    if (d.sujets !== undefined) {
      if (!Array.isArray(d.sujets)) throw new ErreurApi(400, 'sujets_invalides');
      for (const s of d.sujets) if (typeof s !== 'string' || !IDS_SUJETS.has(s)) throw new ErreurApi(400, 'sujets_invalides', 'Sujet inconnu.');
      this.#etat.sujets = [...new Set(d.sujets as string[])];
    }
    if (d.quand !== undefined) {
      if (!estObj(d.quand)) throw new ErreurApi(400, 'quand_invalide');
      this.#etat.quand = lireQuand({ ...this.#etat.quand, ...d.quand }, true);
    }
    if (d.adresseJeu !== undefined) this.#etat.adresseJeu = lireAdresseJeu(d.adresseJeu);
    this.#changement();
    return this.reglages(p);
  }

  // ---------------------------------------------------------------- Telegram, en trois étapes

  /**
   * Étape 1 : le jeton collé est essayé tout de suite (`getMe`). Le jeton reste ici ; le navigateur ne reçoit
   * qu'une référence `telegram:<id>` à usage unique et le nom du robot, pour pouvoir lui écrire.
   * Documentation : https://core.telegram.org/bots/api#getme
   */
  async robotTelegram(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d) || typeof d.jeton !== 'string') throw new ErreurApi(400, 'jeton_manquant', 'Collez le jeton donné par BotFather.');
    const jeton = d.jeton.trim();
    if (!/^\d{3,20}:[A-Za-z0-9_-]{20,80}$/.test(jeton)) {
      throw new ErreurApi(400, 'jeton_invalide', 'Ce n’est pas un jeton Telegram : BotFather en donne un de la forme 123456789:AAE… Recopiez-le en entier.');
    }
    const maintenant = Date.now();
    for (const [k, t] of this.#telegram) if (t.expire < maintenant) this.#telegram.delete(k);
    if (this.#telegram.size >= 10) throw new ErreurApi(429, 'trop_de_branchements', 'Trop de branchements en cours : réessayez dans quelques minutes.');
    const r = await this.#telegramAppel(jeton, 'getMe', {});
    if (!r.ok) throw new ErreurApi(422, 'robot_refuse', r.message);
    const res = estObj(r.resultat) ? r.resultat : {};
    const robot = typeof res.username === 'string' ? res.username : '';
    if (!robot) throw new ErreurApi(422, 'robot_refuse', 'Telegram n’a pas reconnu ce robot : vérifiez le jeton auprès de BotFather.');
    const id = randomBytes(16).toString('base64url');
    this.#telegram.set(id, { jeton, robot, conversation: null, conversationNom: null, expire: maintenant + 30 * 60_000 });
    return { ref: `telegram:${id}`, robot, nom: typeof res.first_name === 'string' ? res.first_name : robot, lien: `https://t.me/${robot}` };
  }

  /**
   * Étape 2 : la personne a écrit au robot ; on retrouve la conversation (`getUpdates`, sans confirmer les messages,
   * pour qu'un deuxième essai les revoie). Telegram garde les messages non récupérés 24 h au plus.
   * Documentation : https://core.telegram.org/bots/api#getupdates
   */
  async conversationTelegram(p: Profil, d: unknown) {
    this.#admin(p);
    const t = this.#enAttenteTelegram(estObj(d) ? d.ref : null);
    const r = await this.#telegramAppel(t.jeton, 'getUpdates', { limit: 100, timeout: 0, allowed_updates: ['message'] });
    if (!r.ok) {
      // un robot qui envoie déjà ses messages ailleurs (webhook) ne peut pas être relu ici : il en faut un autre
      const webhook = /webhook/i.test(r.message);
      throw new ErreurApi(422, webhook ? 'robot_deja_pris' : 'telegram_refuse', webhook
        ? 'Ce robot est déjà relié à un autre logiciel (webhook). Créez-en un deuxième avec BotFather, rien que pour Living Business.'
        : r.message);
    }
    const majs = Array.isArray(r.resultat) ? r.resultat : [];
    let trouve: { id: string; nom: string } | null = null;
    for (const m of majs) {
      const chat = estObj(m) && estObj(m.message) ? m.message.chat : null;
      if (!estObj(chat) || (typeof chat.id !== 'number' && typeof chat.id !== 'string')) continue;
      const nom = [chat.title, chat.first_name, chat.username].find((x) => typeof x === 'string' && x) as string | undefined;
      trouve = { id: String(chat.id), nom: nom ? sansMention(nom).slice(0, 60) : 'votre conversation' };
    }
    if (!trouve) {
      return { trouve: false as const, message: `Rien reçu pour l’instant. Ouvrez Telegram, écrivez n’importe quel message à @${t.robot} (par exemple « bonjour »), puis réessayez.` };
    }
    t.conversation = trouve.id;
    t.conversationNom = trouve.nom;
    return { trouve: true as const, robot: t.robot, conversation: trouve.nom };
  }

  #enAttenteTelegram(ref: unknown) {
    const m = typeof ref === 'string' ? /^telegram:([A-Za-z0-9_-]{22})$/.exec(ref) : null;
    const t = m ? this.#telegram.get(m[1] as string) : undefined;
    if (!t || t.expire < Date.now()) throw new ErreurApi(400, 'branchement_expire', 'Le branchement a expiré : recollez le jeton du robot.');
    return t;
  }

  // ---------------------------------------------------------------- canaux : créer, modifier, supprimer

  /** Branche un canal. Telegram : avec la référence des étapes 1 et 2. WhatsApp et webhook : avec leurs réglages. */
  ajouterCanal(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d) || (d.canal !== 'telegram' && d.canal !== 'whatsapp' && d.canal !== 'webhook')) throw new ErreurApi(400, 'canal_inconnu');
    if (this.#etat.canaux.length >= CANAUX_MAX) throw new ErreurApi(409, 'trop_de_canaux', `Vous avez déjà ${CANAUX_MAX} canaux : supprimez-en un avant d’en ajouter.`);
    const canal = d.canal;
    const { prive, resume, nom } = this.#lireCanal(canal, d);
    const c: CanalEnregistre = {
      id: `al-${randomUUID().replace(/-/g, '').slice(0, 12)}`, canal, nom, resume,
      prive: this.#chiffreur.chiffrer(JSON.stringify(prive)), actif: true, statut: 'jamais', message: null,
      dernierEnvoi: null, echecs: 0, prochainEssai: null, creeLe: this.#src.maintenant().toISOString(), journal: [],
    };
    this.#etat.canaux.push(c);
    if (typeof d.ref === 'string') { const m = /^telegram:([A-Za-z0-9_-]{22})$/.exec(d.ref); if (m) this.#telegram.delete(m[1] as string); }
    // premier branchement : les sujets cochés par défaut, pour ne noyer personne dès le premier jour
    if (this.#etat.canaux.length === 1 && !this.#etat.sujets.length) this.#etat.sujets = [...SUJETS_DEFAUT];
    this.#changement();
    return this.#vue(c);
  }

  /** Renommer, mettre en pause ou relancer un canal. Les réglages privés ne se modifient pas : on rebranche. */
  modifierCanal(p: Profil, id: unknown, d: unknown) {
    this.#admin(p);
    const c = this.#trouver(id);
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    if (d.nom !== undefined) {
      const n = typeof d.nom === 'string' ? d.nom.trim() : '';
      if (!n || n.length > 60) throw new ErreurApi(400, 'nom_invalide', 'Donnez un nom court à ce canal (60 caractères au plus).');
      c.nom = n;
    }
    if (d.actif !== undefined) {
      c.actif = d.actif === true;
      if (c.actif) { c.echecs = 0; c.prochainEssai = null; if (c.statut === 'erreur') { c.statut = 'jamais'; c.message = null; } }
    }
    this.#changement();
    return this.#vue(c);
  }

  supprimerCanal(p: Profil, id: unknown) {
    this.#admin(p);
    const c = this.#trouver(id);
    this.#etat.canaux = this.#etat.canaux.filter((x) => x.id !== c.id);
    if (!this.actif()) this.#etat.attente = [];
    this.#changement();
    return { ok: true as const, id: c.id };
  }

  /** Contrôle les réglages d'un canal et compose ce qu'on en montre. */
  #lireCanal(canal: Canal, d: Record<string, unknown>): { prive: PriveTelegram | PriveWhatsapp | PriveWebhook; resume: string; nom: string } {
    const nomDonne = typeof d.nom === 'string' && d.nom.trim() ? d.nom.trim().slice(0, 60) : null;
    if (canal === 'telegram') {
      const t = this.#enAttenteTelegram(d.ref);
      if (!t.conversation) throw new ErreurApi(400, 'conversation_manquante', `Écrivez d’abord un message à @${t.robot}, puis cliquez sur « Retrouver ma conversation ».`);
      return {
        prive: { jeton: t.jeton, conversation: t.conversation } satisfies PriveTelegram,
        resume: `@${t.robot} → ${t.conversationNom ?? 'votre conversation'}`,
        nom: nomDonne ?? 'Telegram',
      };
    }
    if (canal === 'whatsapp') {
      const jeton = texteObligatoire(d.jeton, 'jeton', 'Collez le jeton d’accès permanent de votre utilisateur système Meta.');
      const numeroId = texteObligatoire(d.numeroId, 'numeroId', 'Indiquez l’identifiant du numéro (Phone number ID), donné par Meta.');
      if (!/^\d{5,25}$/.test(numeroId)) throw new ErreurApi(400, 'numeroId_invalide', 'L’identifiant du numéro n’est fait que de chiffres (ce n’est pas le numéro de téléphone).');
      const brut = texteObligatoire(d.destinataire, 'destinataire', 'Indiquez le numéro qui recevra les alertes, avec l’indicatif du pays.');
      const destinataire = brut.replace(/[\s.()-]/g, '');
      if (!/^\+?\d{6,20}$/.test(destinataire)) throw new ErreurApi(400, 'destinataire_invalide', 'Numéro attendu avec l’indicatif du pays, par exemple +33612345678.');
      const modele = texteObligatoire(d.modele, 'modele', 'Indiquez le nom du modèle de message approuvé par Meta.').toLowerCase();
      if (!/^[a-z0-9_]{1,512}$/.test(modele)) throw new ErreurApi(400, 'modele_invalide', 'Un nom de modèle ne contient que des lettres sans accent, des chiffres et des tirets bas.');
      const langue = typeof d.langue === 'string' && d.langue.trim() ? d.langue.trim() : 'fr';
      if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(langue)) throw new ErreurApi(400, 'langue_invalide', 'Langue du modèle, par exemple fr ou fr_FR.');
      const fin = destinataire.slice(-2);
      return {
        prive: { jeton, numeroId, destinataire: destinataire.startsWith('+') ? destinataire : `+${destinataire}`, modele, langue } satisfies PriveWhatsapp,
        resume: `WhatsApp Business → numéro finissant par ${fin} (modèle « ${modele} »)`,
        nom: nomDonne ?? 'WhatsApp',
      };
    }
    const url = typeof d.url === 'string' ? d.url.trim() : '';
    if (!url) throw new ErreurApi(400, 'url_manquante', 'Indiquez l’adresse qui recevra les alertes.');
    if (url.length > 2000) throw new ErreurApi(400, 'url_invalide', 'Adresse trop longue.');
    let u: URL;
    try { u = new URL(url); } catch { throw new ErreurApi(400, 'url_invalide', 'Adresse invalide : elle doit commencer par https://'); }
    if (u.username || u.password) throw new ErreurApi(400, 'url_invalide', 'Pas d’identifiant dans l’adresse : utilisez le champ « secret ».');
    const secret = typeof d.secret === 'string' && d.secret.trim() ? d.secret.trim().slice(0, 200) : null;
    return {
      prive: { url, secret } satisfies PriveWebhook,
      resume: `${u.protocol}//${u.host}/…`,
      nom: nomDonne ?? 'Mon service',
    };
  }

  // ---------------------------------------------------------------- essai

  /** « M'envoyer un message d'essai » : dit franchement si c'est passé, et pourquoi si ça rate. */
  async essai(p: Profil, id: unknown) {
    this.#admin(p);
    const c = this.#trouver(id);
    const texte = uneLigne(`Message d’essai de Living Business : si vous lisez ceci, les alertes arrivent bien.${this.#lien(null)}`);
    const r = await this.#envoyer(c, texte, true);
    this.#changement();
    return { ok: r.ok, message: r.ok ? `C’est parti : regardez ${c.canal === 'telegram' ? 'Telegram' : c.canal === 'whatsapp' ? 'WhatsApp' : 'votre service'}. Si rien n’arrive, c’est que le message a été accepté puis bloqué plus loin.` : r.detail, canal: this.#vue(c) };
  }

  // ---------------------------------------------------------------- passage périodique

  /**
   * Une passe : regarde ce qui est nouveau, décide si ça part maintenant, envoie. Ne fait rien sans canal en marche.
   * Renvoie le nombre de messages envoyés.
   */
  async passer(): Promise<number> {
    if (this.#enCours || !this.actif()) return 0;
    this.#enCours = true;
    let envoyes = 0;
    try {
      const maintenant = this.#src.maintenant();
      const jour = this.#jour(maintenant);
      if (this.#etat.jour !== jour) { this.#etat.jour = jour; this.#etat.envoyes = 0; }
      await this.#releverFaits(maintenant);
      envoyes = await this.#envoyerCeQuiEstDu(maintenant, jour);
    } catch (e) {
      console.error('[alertes]', e instanceof Error ? e.message : e);
    } finally {
      this.#enCours = false;
    }
    if (envoyes) this.#changement();
    return envoyes;
  }

  /** Nouveaux faits mis en attente ; faits disparus oubliés (ils pourront être annoncés s'ils reviennent). */
  async #releverFaits(maintenant: Date) {
    const faits = await this.#faits(maintenant);
    const vivants = new Set(faits.map((f) => f.cle));
    for (const cle of Object.keys(this.#etat.vus)) if (!vivants.has(cle)) delete this.#etat.vus[cle];
    const dejaEnAttente = new Set(this.#etat.attente.map((a) => a.cle));
    const le = maintenant.toISOString();
    let ajoutes = 0;
    for (const f of faits) {
      if (this.#etat.vus[f.cle] || dejaEnAttente.has(f.cle)) continue;
      this.#etat.vus[f.cle] = le;
      this.#etat.attente.push({ ...f, depuis: le });
      ajoutes++;
    }
    // trop de retard : on garde les plus récents plutôt que d'inonder plus tard
    const limite = maintenant.getTime() - ATTENTE_DUREE_MS;
    this.#etat.attente = this.#etat.attente.filter((a) => Date.parse(a.depuis) > limite).slice(-ATTENTE_MAX);
    if (ajoutes) this.#changement();
  }

  #jour(d: Date = this.#src.maintenant()): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** A-t-on le droit d'envoyer maintenant ? (heures de silence, week-end) */
  #fenetre(d: Date): boolean {
    const q = this.#etat.quand;
    const jour = d.getDay();
    if (!q.weekEnd && (jour === 0 || jour === 6)) return false;
    const m = d.getHours() * 60 + d.getMinutes();
    return m >= enMinutes(q.silenceAvant) && m < enMinutes(q.silenceApres);
  }

  /** L'heure choisie est-elle passée aujourd'hui ? */
  #heureDue(d: Date): boolean {
    return d.getHours() * 60 + d.getMinutes() >= enMinutes(this.#etat.quand.heure);
  }

  async #envoyerCeQuiEstDu(maintenant: Date, jour: string): Promise<number> {
    const q = this.#etat.quand;
    const urgents = this.#etat.attente.filter((a) => a.urgent);
    const ordinaires = this.#etat.attente.filter((a) => !a.urgent);
    let envoyes = 0;

    // une urgence vraie passe malgré le silence, le week-end et le plafond — sauf si l'entreprise l'a refusé
    if (urgents.length && q.urgencesPassent) {
      if (await this.#envoyerLot(urgents, maintenant, true)) envoyes++;
    }
    const resteUrgents = q.urgencesPassent ? [] : urgents;

    const fenetre = this.#fenetre(maintenant);
    const plafond = this.#etat.envoyes >= q.maxParJour;
    const groupe = q.mode === 'une_fois_par_jour';
    const aEnvoyer = [...resteUrgents, ...ordinaires];
    if (aEnvoyer.length && fenetre && !plafond && (!groupe || this.#heureDue(maintenant))) {
      if (await this.#envoyerLot(aEnvoyer, maintenant, false)) envoyes++;
    }

    // résumé du matin : une fois par jour, à l'heure choisie
    if (this.#etat.sujets.includes('resume_matin') && this.#etat.resumeLe !== jour && fenetre && this.#heureDue(maintenant)) {
      const texte = await this.#resumeDuMatin(maintenant);
      this.#etat.resumeLe = jour;
      if (texte && (await this.#diffuser(texte, false, maintenant)).length) { this.#etat.envoyes++; envoyes++; }
    }
    return envoyes;
  }

  /** Compose un message à partir des faits et l'envoie ; les faits ne quittent la file que si un canal l'a pris. */
  async #envoyerLot(faits: FaitRetenu[], maintenant: Date, urgent: boolean): Promise<boolean> {
    const texte = this.#composer(faits, urgent);
    const partis = await this.#diffuser(texte, urgent, maintenant);
    if (!partis.length) return false;
    const envoyes = new Set(faits.map((f) => f.cle));
    this.#etat.attente = this.#etat.attente.filter((a) => !envoyes.has(a.cle));
    this.#etat.envoyes++;
    return true;
  }

  /** Un fait : une phrase. Plusieurs : une tête de message puis une ligne chacun, cinq au plus. */
  #composer(faits: readonly FaitRetenu[], urgent: boolean): string {
    const vues = new Set(faits.map((f) => f.vue).filter((v): v is string => Boolean(v)));
    const lien = this.#lien(vues.size === 1 ? ([...vues][0] as string) : null);
    const premier = faits[0];
    if (faits.length === 1 && premier) return `${urgent ? 'Urgent — ' : ''}${premier.texte}${lien}`.slice(0, TEXTE_MAX);
    const lignes = faits.slice(0, LIGNES_MAX).map((f) => `• ${f.texte}`);
    const reste = faits.length - lignes.length;
    if (reste > 0) lignes.push(`• et ${pluriel(reste, 'autre chose à voir', 'autres choses à voir')}.`);
    const tete = urgent ? `Urgent : ${pluriel(faits.length, 'chose à regarder', 'choses à regarder')}.` : `${pluriel(faits.length, 'chose à regarder', 'choses à regarder')} dans Living Business.`;
    return `${tete}\n${lignes.join('\n')}${lien}`.slice(0, TEXTE_MAX);
  }

  /** Le lien qui ouvre le bon écran du jeu ; rien si l'adresse du jeu n'est pas connue. */
  #lien(vue: string | null): string {
    const base = this.#etat.adresseJeu;
    if (!base) return '';
    return `\n${base}/${vue ? `#/${vue}` : ''}`;
  }

  /** Envoie à tous les canaux en marche dont l'heure du nouvel essai est passée. Renvoie ceux qui ont pris. */
  async #diffuser(texte: string, urgent: boolean, maintenant: Date): Promise<string[]> {
    const partis: string[] = [];
    for (const c of this.#etat.canaux) {
      if (!c.actif) continue;
      if (c.prochainEssai && Date.parse(c.prochainEssai) > maintenant.getTime()) continue;
      const r = await this.#envoyer(c, texte, urgent);
      if (r.ok) partis.push(c.id);
    }
    return partis;
  }

  // ---------------------------------------------------------------- ce qu'il y a à dire

  async #faits(maintenant: Date): Promise<Fait[]> {
    const choisis = new Set(this.#etat.sujets);
    const faits: Fait[] = [];
    const u = this.#src.univers();
    const objets = this.#src.objets();
    const parId = new Map(objets.map((o) => [o.id, o]));
    const seuils = new Map(u.regles.map((r) => [r.id, r]));
    const echeances = new Map(u.echeances.map((r) => [r.id, r]));

    for (const s of this.#src.situations()) {
      if (s.statut !== 'ouverte') continue;
      const o = parId.get(s.objetId);
      if (!o) continue;
      const sujet = sujetDe(s.regle, o.type, seuils.has(s.regle), echeances.has(s.regle));
      if (!choisis.has(sujet)) continue;
      const tiers = ['tiers', 'client', 'fournisseur'].map((k) => o.champs[k]).find((v) => typeof v === 'string');
      const nomTiers = typeof tiers === 'string' ? parId.get(tiers)?.nom : undefined;
      const montant = typeof o.champs.montant === 'number' ? `, ${mesure(o.champs.montant, '€')}` : '';
      faits.push({
        cle: `${s.regle}:${o.id}`,
        sujet,
        urgent: s.gravite === 'critique',
        texte: uneLigne(`${sansMention(o.nom)}${nomTiers ? ` (${sansMention(nomTiers)})` : ''} — ${s.description}${montant}. ${quoiFaire(sujet, o.type)}`),
        vue: `type:${o.type}`,
      });
    }

    if (choisis.has('devis_sans_reponse')) {
      const limite = maintenant.getTime() - 7 * JOUR_MS;
      for (const o of objets) {
        if (o.type !== 'devis' || o.champs.statut !== 'envoyé' || Date.parse(o.majLe) > limite) continue;
        const jours = Math.max(1, Math.round((maintenant.getTime() - Date.parse(o.majLe)) / JOUR_MS));
        const montant = typeof o.champs.montant === 'number' ? ` de ${mesure(o.champs.montant, '€')}` : '';
        faits.push({ cle: `devis_sans_reponse:${o.id}`, sujet: 'devis_sans_reponse', urgent: false, vue: 'type:devis',
          texte: uneLigne(`Devis ${sansMention(o.nom)}${montant} : envoyé depuis ${pluriel(jours, 'jour', 'jours')}, sans réponse. À relancer.`) });
      }
    }

    if (choisis.has('commande')) {
      for (const o of objets) {
        if (o.type !== 'commande_client' || o.champs.statut !== 'livrée') continue;
        const montant = typeof o.champs.montant === 'number' ? ` de ${mesure(o.champs.montant, '€')}` : '';
        faits.push({ cle: `commande:${o.id}`, sujet: 'commande', urgent: false, vue: 'type:commande_client',
          texte: uneLigne(`Commande ${sansMention(o.nom)}${montant} : livrée, pas encore facturée. À facturer.`) });
      }
    }

    if (choisis.has('erreur_synchro')) {
      for (const c of this.#src.connecteursEnErreur()) {
        faits.push({ cle: `erreur_synchro:${c.nom}`, sujet: 'erreur_synchro', urgent: false, vue: 'reglages:outils',
          texte: uneLigne(`Synchronisation : ${c.nom} ne répond plus${c.message ? ` (${c.message})` : ''}. À vérifier dans Réglages, Connecteurs.`) });
      }
    }

    if (choisis.has('demande_reseau')) {
      const n = await this.#demandesReseau(maintenant);
      if (n && n > 0) {
        faits.push({ cle: `demande_reseau:${n}`, sujet: 'demande_reseau', urgent: false, vue: 'nexus',
          texte: uneLigne(`Réseau : ${pluriel(n, 'demande attend', 'demandes attendent')} votre réponse. À répondre.`) });
      }
    }
    return faits;
  }

  /** Le réseau n'est consulté qu'au quart d'heure, et seulement si le sujet est coché. */
  async #demandesReseau(maintenant: Date): Promise<number | null> {
    const lire = this.#src.reseau;
    if (!lire) return null;
    if (maintenant.getTime() - this.#reseauLe < 15 * 60_000) return this.#reseauN;
    this.#reseauLe = maintenant.getTime();
    try { this.#reseauN = await lire(); } catch { this.#reseauN = null; }
    return this.#reseauN;
  }

  /** « Ce matin : 3 choses à régler — 2 factures en retard, 1 contrôle technique. » */
  async #resumeDuMatin(maintenant: Date): Promise<string | null> {
    const choisis = this.#etat.sujets;
    // le résumé compte TOUT ce que le jeu signale, pas seulement les sujets cochés : c'est son rôle
    this.#etat.sujets = SUJETS.map((s) => s.id);
    let faits: Fait[];
    try { faits = await this.#faits(maintenant); } finally { this.#etat.sujets = choisis; }
    if (!faits.length) return uneLigne(`Ce matin : rien à régler. Bonne journée.${this.#lien('matin')}`);
    const urgents = faits.filter((f) => f.urgent).length;
    const lignes = faits.slice(0, LIGNES_MAX).map((f) => `• ${f.texte}`);
    const reste = faits.length - lignes.length;
    if (reste > 0) lignes.push(`• et ${pluriel(reste, 'autre', 'autres')}.`);
    return `Ce matin : ${pluriel(faits.length, 'chose à régler', 'choses à régler')}${urgents ? `, dont ${pluriel(urgents, 'urgente', 'urgentes')}` : ''}.\n${lignes.join('\n')}${this.#lien('matin')}`.slice(0, TEXTE_MAX);
  }

  // ---------------------------------------------------------------- envoi, et ce qu'on fait quand ça rate

  async #envoyer(c: CanalEnregistre, texte: string, urgent: boolean): Promise<{ ok: boolean; detail: string }> {
    const maintenant = this.#src.maintenant();
    let r: { ok: boolean; detail: string; definitif?: boolean; attendreS?: number };
    try {
      const prive = this.#lirePrive<PriveTelegram & PriveWhatsapp & PriveWebhook>(c);
      r = c.canal === 'telegram' ? await this.#versTelegram(prive, texte)
        : c.canal === 'whatsapp' ? await this.#versWhatsapp(prive, texte)
        : await this.#versWebhook(prive, texte, urgent, maintenant);
    } catch (e) {
      r = e instanceof ErreurApi || e instanceof Error
        ? { ok: false, detail: e.message.includes('secret illisible') ? 'Réglages illisibles (la clé des secrets a changé) : rebranchez ce canal.' : e.message, definitif: e.message.includes('secret illisible') }
        : { ok: false, detail: 'Erreur inconnue.' };
    }
    const detail = this.#sansSecret(c, r.detail).slice(0, 200);
    c.journal = [...c.journal, { le: maintenant.toISOString(), ok: r.ok, detail }].slice(-20);
    if (r.ok) {
      c.statut = 'ok'; c.message = null; c.echecs = 0; c.prochainEssai = null; c.dernierEnvoi = maintenant.toISOString();
      return { ok: true, detail };
    }
    c.echecs++;
    c.statut = 'erreur';
    c.message = detail;
    if (r.definitif) {
      c.actif = false;
      c.prochainEssai = null;
      c.message = `${detail} Ce canal est en pause : corrigez puis rebranchez-le.`;
    } else if (c.echecs >= ECHECS_AVANT_PAUSE) {
      c.actif = false;
      c.prochainEssai = null;
      c.message = `${detail} Après ${ECHECS_AVANT_PAUSE} essais, ce canal est en pause : relancez-le quand ce sera réparé.`;
    } else {
      const minutes = r.attendreS !== undefined ? Math.max(1, Math.ceil(r.attendreS / 60)) : (ESSAIS_MIN[Math.min(c.echecs - 1, ESSAIS_MIN.length - 1)] as number);
      c.prochainEssai = new Date(maintenant.getTime() + minutes * 60_000).toISOString();
    }
    return { ok: false, detail: c.message };
  }

  /** Un jeton ne doit jamais finir dans un journal, même par accident. */
  #sansSecret(c: CanalEnregistre, texte: string): string {
    let t = texte;
    try {
      const p = this.#lirePrive<Record<string, unknown>>(c);
      for (const v of Object.values(p)) if (typeof v === 'string' && v.length >= 8) t = t.split(v).join('…');
    } catch { /* réglages illisibles : rien à masquer */ }
    return t;
  }

  // ---------------------------------------------------------------- les trois canaux

  /**
   * Telegram, `sendMessage` en texte brut (aucune mise en forme : rien à échapper, donc rien à casser).
   * Documentation : https://core.telegram.org/bots/api#sendmessage
   */
  async #versTelegram(p: PriveTelegram, texte: string) {
    const r = await this.#telegramAppel(p.jeton, 'sendMessage', { chat_id: p.conversation, text: texte.slice(0, 4096), link_preview_options: { is_disabled: true } });
    if (r.ok) return { ok: true, detail: 'envoyé' };
    // 401 : jeton refusé ; 403 : robot bloqué ou retiré de la conversation ; « chat not found » : conversation perdue
    const definitif = r.statut === 401 || r.statut === 403 || /chat not found|bot was blocked|user is deactivated/i.test(r.message);
    return { ok: false, detail: messageTelegram(r.statut, r.message), definitif, ...(r.attendreS !== undefined ? { attendreS: r.attendreS } : {}) };
  }

  async #telegramAppel(jeton: string, methode: string, corps: Record<string, unknown>): Promise<{ ok: boolean; resultat: unknown; statut: number; message: string; attendreS?: number }> {
    const url = new URL(`${TELEGRAM}/bot${jeton}/${methode}`);
    let statut = 0;
    let brut = '';
    try {
      const r = await appeler(this.#f, url, { methode: 'POST', corps, texte: true, delaiMs: 15_000, statutsLus: [400, 401, 403, 404, 409, 429, 500, 502, 503] });
      statut = r.statut;
      brut = typeof r.donnees === 'string' ? r.donnees : '';
    } catch (e) {
      // le jeton est dans l'adresse : on ne remonte jamais le message brut d'une erreur réseau sans le nettoyer
      return { ok: false, resultat: null, statut: 0, message: e instanceof Error ? e.message : 'Telegram injoignable.' };
    }
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(brut) as Record<string, unknown>; } catch { /* réponse illisible */ }
    if (d.ok === true) return { ok: true, resultat: d.result, statut, message: '' };
    const params = estObj(d.parameters) ? d.parameters : {};
    const attendre = typeof params.retry_after === 'number' ? params.retry_after : undefined;
    return {
      ok: false, resultat: null, statut,
      message: typeof d.description === 'string' ? d.description : `Telegram a refusé (${statut || 'pas de réponse'}).`,
      ...(attendre !== undefined ? { attendreS: attendre } : {}),
    };
  }

  /**
   * WhatsApp Business (Cloud API de Meta) : un message de MODÈLE approuvé, seul envoi qui marche hors de la fenêtre
   * de 24 h ouverte par un message de la personne. Le modèle doit contenir une seule variable dans son corps ; notre
   * phrase y est glissée, sur une seule ligne et sans espaces multiples (Meta refuse les paramètres mis en forme).
   * Documentation : https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages
   */
  async #versWhatsapp(p: PriveWhatsapp, texte: string) {
    const parametre = uneLigne(texte.replace(/\n/g, ' — ')).slice(0, 900);
    const url = new URL(`${GRAPH}/${VERSION_WHATSAPP}/${p.numeroId}/messages`);
    const corps = {
      messaging_product: 'whatsapp', recipient_type: 'individual', to: p.destinataire, type: 'template',
      template: { name: p.modele, language: { code: p.langue }, components: [{ type: 'body', parameters: [{ type: 'text', text: parametre }] }] },
    };
    let statut = 0;
    let brut = '';
    try {
      const r = await appeler(this.#f, url, { methode: 'POST', corps, texte: true, delaiMs: 20_000, entetes: { authorization: `Bearer ${p.jeton}` }, statutsLus: [400, 401, 403, 404, 429, 500] });
      statut = r.statut;
      brut = typeof r.donnees === 'string' ? r.donnees : '';
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'WhatsApp injoignable.' };
    }
    let d: Record<string, unknown> = {};
    try { d = JSON.parse(brut) as Record<string, unknown>; } catch { /* réponse illisible */ }
    if (statut < 400 && Array.isArray(d.messages)) return { ok: true, detail: 'accepté par Meta' };
    const err = estObj(d.error) ? d.error : {};
    const message = typeof err.message === 'string' ? err.message : `Meta a refusé (${statut || 'pas de réponse'}).`;
    const code = typeof err.code === 'number' ? err.code : 0;
    // 190 : jeton expiré ou révoqué ; 132xxx : modèle inconnu, non approuvé ou mal rempli ; 401/403 : accès refusé
    const definitif = statut === 401 || statut === 403 || code === 190 || (code >= 132_000 && code < 133_000);
    return { ok: false, detail: `${message}${definitif ? '' : ''}`, definitif };
  }

  /** Webhook à soi : le corps est signé comme les envois entrants (`t=<secondes>,v1=<HMAC-SHA256 de « t.corps »>`). */
  async #versWebhook(p: PriveWebhook, texte: string, urgent: boolean, maintenant: Date) {
    let u: URL;
    try { u = await verifierUrl(p.url); } catch (e) { return { ok: false, detail: e instanceof Error ? e.message : 'Adresse refusée.', definitif: true }; }
    const corps = { evenement: 'alerte', le: maintenant.toISOString(), urgent, texte, lignes: texte.split('\n').slice(1).map((l) => l.replace(/^• /, '')).filter(Boolean) };
    const brut = JSON.stringify(corps);
    const t = Math.floor(maintenant.getTime() / 1000);
    const entetes = p.secret ? { 'x-lb-signature': `t=${t},v1=${createHmac('sha256', p.secret).update(`${t}.${brut}`).digest('hex')}` } : {};
    try {
      await appeler(this.#f, u, { methode: 'POST', corps, texte: true, delaiMs: 15_000, entetes });
      return { ok: true, detail: 'envoyé' };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'Service injoignable.' };
    }
  }
}

// ---------------------------------------------------------------- lectures contrôlées

function texteObligatoire(x: unknown, champ: string, message: string): string {
  const v = typeof x === 'string' ? x.trim() : '';
  if (!v || v.length > 500) throw new ErreurApi(400, `${champ}_manquant`, message);
  return v;
}

/** Adresse du jeu pour les liens : origine seulement, https (ou un poste local). */
function lireAdresseJeu(x: unknown): string | null {
  if (x === null || x === '') return null;
  if (typeof x !== 'string' || x.length > 300) throw new ErreurApi(400, 'adresse_invalide', 'Adresse du jeu invalide.');
  let u: URL;
  try { u = new URL(x.trim()); } catch { throw new ErreurApi(400, 'adresse_invalide', 'Adresse du jeu invalide.'); }
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new ErreurApi(400, 'adresse_invalide', 'L’adresse du jeu doit commencer par https://');
  if (u.username || u.password) throw new ErreurApi(400, 'adresse_invalide', 'Pas d’identifiant dans l’adresse.');
  return u.origin;
}

/**
 * Lit le « quand ». `strict` (réglage reçu du navigateur) : une valeur fautive est refusée en nommant le champ.
 * Sans `strict` (état relu du disque) : une valeur fautive reprend la valeur par défaut, sans empêcher le démarrage.
 */
function lireQuand(x: unknown, strict = false): Quand {
  const q = estObj(x) ? x : {};
  const refus = (code: string, message: string) => { if (strict) throw new ErreurApi(400, code, message); };
  const heure = (k: 'heure' | 'silenceAvant' | 'silenceApres', defaut: string): string => {
    const v = q[k];
    if (v === undefined) return defaut;
    if (typeof v !== 'string' || !HEURE.test(v)) { refus('heure_invalide', 'Heure attendue sous la forme 08:30.'); return defaut; }
    return v;
  };
  let mode = QUAND_DEFAUT.mode;
  if (q.mode === 'une_fois_par_jour' || q.mode === 'tout_de_suite') mode = q.mode;
  else if (q.mode !== undefined) refus('mode_invalide', 'Choisissez « tout de suite » ou « une fois par jour ».');
  const brut = q.maxParJour === undefined ? QUAND_DEFAUT.maxParJour : Number(q.maxParJour);
  const maxBon = Number.isInteger(brut) && brut >= 1 && brut <= 50;
  if (!maxBon) refus('max_invalide', 'Au plus : entre 1 et 50 messages par jour.');
  const avant = heure('silenceAvant', QUAND_DEFAUT.silenceAvant);
  let apres = heure('silenceApres', QUAND_DEFAUT.silenceApres);
  if (enMinutes(avant) >= enMinutes(apres)) {
    refus('silence_invalide', 'L’heure de début du silence doit précéder celle de fin (par exemple : rien avant 8:00, rien après 19:00).');
    apres = QUAND_DEFAUT.silenceApres;
  }
  return {
    mode,
    heure: heure('heure', QUAND_DEFAUT.heure),
    silenceAvant: enMinutes(avant) < enMinutes(apres) ? avant : QUAND_DEFAUT.silenceAvant,
    silenceApres: apres,
    weekEnd: q.weekEnd === undefined ? QUAND_DEFAUT.weekEnd : q.weekEnd === true,
    maxParJour: maxBon ? brut : QUAND_DEFAUT.maxParJour,
    urgencesPassent: q.urgencesPassent === undefined ? QUAND_DEFAUT.urgencesPassent : q.urgencesPassent === true,
  };
}

/**
 * Sujet d'une situation. Les règles ne sont pas codées en dur ici : elles viennent de l'univers de l'entreprise.
 * On regarde d'abord le type visé (facture, article…), puis la nature de la règle (échéance ou seuil).
 */
function sujetDe(regle: string, type: string, estSeuil: boolean, estEcheance: boolean): string {
  if (estSeuil && type === 'facture') return 'facture_retard';
  if (estSeuil && type === 'article') return 'stock_bas';
  if (estEcheance && (type === 'commande_client' || type === 'commande_fournisseur')) return 'commande';
  if (estEcheance) return 'echeance';
  return 'autre_alerte';
}

/** Message d'erreur Telegram dit simplement, avec la description d'origine quand elle aide. */
function messageTelegram(statut: number, description: string): string {
  if (statut === 401) return 'Telegram a refusé le jeton du robot : il a peut-être été régénéré dans BotFather.';
  if (/chat not found/i.test(description)) return 'Conversation introuvable : écrivez de nouveau au robot, puis rebranchez le canal.';
  if (/bot was blocked/i.test(description)) return 'Le robot a été bloqué dans Telegram : débloquez-le, puis relancez le canal.';
  if (statut === 429) return 'Telegram demande d’attendre (trop de messages d’un coup) : nouvel essai plus tard.';
  if (!statut) return `Telegram injoignable : ${description}`;
  return `Telegram a refusé : ${description}`;
}
