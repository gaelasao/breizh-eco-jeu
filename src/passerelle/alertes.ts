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
 * LA RÈGLE DU TRI, EN TOUTES LETTRES. Une notification de trop et le canal est mort : l'entreprise coupe tout, et on
 * ne la prévient plus de rien. Donc on ne pousse pas tout.
 *   N'interrompt quelqu'un que ce que l'écran Aujourd'hui met en tête : une situation OUVERTE, que PERSONNE N'A
 *   ENCORE PRISE EN CHARGE, ni remise à plus tard — et seule une situation CRITIQUE sort des heures autorisées.
 *   Un message par décision réelle, jamais un flux.
 * Ce classement n'est pas inventé ici : c'est celui de `web/aujourdhui.js` (`planAujourdhui`, `suiviDe`), lui-même
 * nourri par `../core/situation.ts`. Repris point par point, et tenu par le code :
 *   · `statut` autre qu'« ouverte » (donnée manquante, source périmée) : jamais poussé — c'est à vérifier, pas à faire ;
 *   · une tâche ouverte porte déjà sur l'objet (le « en cours » de l'écran) : plus rien ne sonne, on a agi ;
 *   · `gravite` « critique » seule force le silence, le week-end et le plafond (et l'entreprise peut le refuser) ;
 *   · UN LOT PAR PASSAGE : ce que le jeu voit dans la même minute part en UN message, jamais en deux ;
 *   · deux urgences coup sur coup : la seconde attend `PAUSE_URGENCE_MS` ou la prochaine fenêtre, pas un second coup
 *     de téléphone ;
 *   · « C'est fait » et « Plus tard » faits depuis un message valent pour les messages suivants, résumé du matin
 *     compris : ce que la personne a tranché ne lui est pas resservi.
 *
 * LE GESTE DANS LE MESSAGE, ET SA LIMITE DITE AVANT. Chaque alerte seule porte deux liens à usage unique — « C'est
 * fait », « Plus tard » — qui reviennent dans le jeu (`/g/<jeton>`, seule l'empreinte du jeton est gardée, comme les
 * liens de formulaire). Ces liens ne sont mis dans les messages QUE si l'installation est en ligne (LB_EN_LIGNE=1, un
 * serveur joignable depuis le téléphone) : sur un ordinateur posé au bureau, le lien ne ramènerait nulle part, alors
 * il n'est pas écrit du tout — et l'écran de réglage dit pourquoi AVANT que la personne compte dessus. Un geste n'est
 * joué qu'une fois : rejouer le lien ne refait rien, il le dit et s'arrête.
 *
 * LE RAPPEL D'ENTRETIEN CHEZ LE CLIENT. Une échéance lointaine rattachée à un travail TERMINÉ : un toit posé en 2024,
 * et en 2026 l'entreprise reçoit « ce chantier a deux ans, un contrôle est peut-être à proposer ». Le message va à
 * L'ENTREPRISE, jamais au client : c'est elle qui décide d'écrire, le logiciel n'écrit à personne tout seul. Le
 * vocabulaire (type visé, champ de date, condition « terminé ») vient de l'univers de l'entreprise, jamais d'ici.
 * Prévenir l'entreprise est compris dans Living Business ; écrire au client à sa place relève de l'offre et passe par
 * ce qui existe déjà (`../core/offre.ts`, écran Optimiser) : rien de tel n'est refait ici.
 *
 * Documentation suivie pour chaque appel : voir `docs/CONNECTEURS.md`, section « Alertes ».
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ObjetMetier } from '../core/model.ts';
import { lireOffre, OFFRE, type EtatOffre, type LectureOffre } from '../core/offre.ts';
import type { Relance } from '../core/relances.ts';
import type { Situation } from '../core/situation.ts';
import { mesure, pluriel } from '../core/texte.ts';
import { defType, libelleType, typesVisibles, type Univers } from '../core/univers.ts';
import type { Profil } from '../demo/donnees.ts';
import { ErreurApi } from './monde.ts';
import { appeler, recuperateurProtege, verifierUrl, type Recuperateur } from './sortant.ts';
import type { Chiffreur } from './stockage.ts';

export type Canal = 'telegram' | 'whatsapp' | 'webhook';

/**
 * QUI A ÉCRIT. Telegram donne le prénom et parfois le pseudo de l'expéditeur. On le transmet pour que le journal
 * dise qui a sorti trois panneaux — pas pour lui donner des droits : la conversation branchée est la seule porte,
 * et tout ce qui y est écrit vaut pour l'entreprise. Autoriser les gens un par un est un autre sujet, et il
 * demandera son propre écran.
 */
export interface Expediteur {
  /** Identifiant Telegram, stable : utile au journal, jamais montré tel quel. */
  id: string;
  /** Prénom ou pseudo, tel que Telegram le donne. Vide si la personne n'en expose aucun. */
  nom: string;
}

/** Ce que le robot répond : un texte, et parfois des boutons à presser plutôt qu'un nom à retaper. */
export interface ReponseRobot {
  texte: string;
  /** `donnee` revient telle quelle quand le bouton est pressé ; Telegram la borne à 64 octets. */
  boutons?: ReadonlyArray<{ texte: string; donnee: string }>;
}

/** Version de l'API Graph utilisée pour WhatsApp (la plus récente servie par Meta au moment de l'écriture). */
export const VERSION_WHATSAPP = 'v27.0';
const TELEGRAM = 'https://api.telegram.org';
const GRAPH = 'https://graph.facebook.com';

// ---------------------------------------------------------------- ce qu'on peut recevoir

/** Un sujet d'alerte, dit en langage d'entrepreneur. `defaut` : coché à la première ouverture. */
export interface Sujet { id: string; libelle: string; aide: string; defaut: boolean }

export const SUJETS: readonly Sujet[] = Object.freeze([
  { id: 'facture_retard', libelle: 'Une facture en retard', aide: 'Un client n’a pas payé à l’échéance.', defaut: true },
  { id: 'demande_sans_suite', libelle: 'Une demande client à rappeler', aide: 'La date que vous aviez notée pour rappeler un prospect est arrivée.', defaut: false },
  { id: 'devis_sans_reponse', libelle: 'Un devis sans réponse', aide: 'Un devis envoyé reste sans réponse depuis plus d’une semaine.', defaut: false },
  { id: 'commande', libelle: 'Une commande client à traiter', aide: 'Livrée mais pas encore facturée, ou livraison en retard.', defaut: false },
  { id: 'reception_ecart', libelle: 'Une réception qui ne concorde pas', aide: 'Le bon de livraison ne colle pas à la commande, ou le même bon est enregistré deux fois.', defaut: true },
  { id: 'echeance', libelle: 'Une échéance qui approche', aide: 'Contrôle technique, révision, document qui expire, tâche en retard.', defaut: true },
  { id: 'stock_bas', libelle: 'Un stock bas', aide: 'Un article passe sous son seuil d’alerte.', defaut: false },
  { id: 'demande_reseau', libelle: 'Une demande du réseau', aide: 'Une entreprise de Breizhcosystem attend votre réponse.', defaut: false },
  { id: 'erreur_synchro', libelle: 'Une erreur de synchronisation', aide: 'Un logiciel connecté ne répond plus, ou refuse l’accès.', defaut: true },
  { id: 'autre_alerte', libelle: 'Une autre alerte importante', aide: 'Ce que Living Business signale et qui n’entre dans aucune case ci-dessus.', defaut: false },
  { id: 'entretien_client', libelle: 'Un entretien à proposer à un client', aide: 'Un travail terminé il y a longtemps : le client pourrait avoir besoin d’un contrôle. Vous seul décidez de lui écrire.', defaut: false },
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
  /** Telegram : identifiant du dernier message lu, pour ne pas relire deux fois ce qu'on a déjà traité. */
  luJusqua?: number;
  prochainEssai: string | null;
  creeLe: string;
  journal: { le: string; ok: boolean; detail: string }[];
}

/** Réglages privés d'un canal, tels qu'ils sont chiffrés. */
interface PriveTelegram { jeton: string; conversation: string }
interface PriveWhatsapp { jeton: string; numeroId: string; destinataire: string; modele: string; langue: string }
interface PriveWebhook { url: string; secret: string | null }

/** Ce qu'on peut faire d'une alerte depuis le message lui-même, dans les mots de l'écran Aujourd'hui. */
export type Geste = 'fait' | 'plus_tard';

/**
 * Un geste proposé dans un message. Seule l'EMPREINTE du jeton est gardée (même règle que les liens de formulaire) :
 * l'état enregistré ne contient jamais de lien utilisable. `faitLe` rempli : le geste a déjà été joué, et ne se
 * rejoue pas.
 */
export interface GesteOffert {
  empreinte: string;
  cle: string;
  geste: Geste;
  /** La phrase de l'alerte, pour que la page dise de quoi il s'agit avant d'agir. */
  quoi: string;
  expire: string;
  faitLe: string | null;
}

/**
 * Rappel d'entretien : une échéance LOINTAINE rattachée à un travail terminé (« ce chantier a deux ans »).
 * Rien de sectoriel ici : `type` et `champ` sont ceux de l'univers de l'entreprise, et la condition « terminé » est
 * celle que l'univers déclare déjà pour ce type (voir `../core/univers.ts`, `DefRegleEcheance.termine`).
 */
export interface RappelEntretien {
  id: string;
  /** Type d'objet visé, tel que l'univers le déclare (projet, commande client…). */
  type: string;
  /** Champ de date de ce type : la date du travail fait (fin de chantier, livraison…). */
  champ: string;
  /** Combien de mois après cette date le rappel tombe. */
  apresMois: number;
  creeLe: string;
}

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
  /** « C'est fait » (clé → date) : plus un mot là-dessus tant que le fait dure, résumé du matin compris. */
  traites: Record<string, string>;
  /** « Plus tard » (clé → jour de retour, AAAA-MM-JJ), comme le report de l'écran Aujourd'hui. */
  reportes: Record<string, string>;
  /** Gestes proposés dans les messages partis (empreintes seulement). */
  gestes: GesteOffert[];
  /** Rappels d'entretien déclarés par l'entreprise. */
  entretiens: RappelEntretien[];
  /** Dernière urgence poussée hors des heures autorisées : deux urgences coup sur coup ne font pas deux messages. */
  urgenceLe: string | null;
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
  /**
   * Installation en ligne (LB_EN_LIGNE=1 : un serveur joignable depuis l'extérieur, voir `en-ligne.ts`).
   * Absent ou faux : les liens « C'est fait » / « Plus tard » ne sont pas mis dans les messages, parce qu'ils ne
   * ramèneraient nulle part depuis un chantier.
   */
  enLigne?: () => boolean;
  /** Derniers droits confirmés par le réseau, lus tels quels (voir `../core/offre.ts`) : jamais un appel d'ici. */
  offre?: () => LectureOffre;
  /**
   * Les relances que le moteur de suivi a PRÉPARÉES (`../core/relances.ts`) : ce module les annonce, il ne les
   * calcule pas. C'est de là que vient « un devis sans réponse » — plus d'un compte de jours écrit ici.
   */
  relances?: () => readonly Relance[];
  /**
   * Le rapprochement d'une réception, déjà calculé par le monde (`core/reception.ts`) : ce module ne compare pas
   * deux montants de son côté. Un seul endroit rapproche, et l'alerte dit ce qu'il a trouvé.
   */
  reception?: (id: string) => { problemes: readonly string[]; doublon: string | null; payeQuandMeme: boolean } | null;
  /**
   * CE QU'ON ÉCRIT AU ROBOT. Ce module tient le canal ; il n'écrit JAMAIS dans le monde (c'est sa règle depuis le
   * premier jour). Quand un message arrive de la conversation branchée, il le passe ici et renvoie la réponse que
   * cette fonction rend. Les fiches créées, les droits, le journal : tout cela se passe de l'autre côté.
   */
  surMessage?: (texte: string, expediteur: Expediteur) => Promise<ReponseRobot>;
  /**
   * Un bouton pressé dans une réponse du robot (choisir l'article d'un mouvement de stock). Même règle : ce module
   * transmet, il n'interprète rien.
   */
  surBouton?: (donnee: string, expediteur: Expediteur) => Promise<ReponseRobot>;
}

const ID = /^al-[a-f0-9]{12}$/;
const ID_ENTRETIEN = /^ent-[a-f0-9]{12}$/;
const JOUR_MS = 86_400_000;
/** Deux urgences coup sur coup : la seconde attend, plutôt que de faire sonner le téléphone deux fois. */
const PAUSE_URGENCE_MS = 10 * 60_000;
/** Un geste proposé dans un message reste cliquable une semaine : au-delà, la situation a changé de toute façon. */
const GESTE_DUREE_MS = 7 * JOUR_MS;
const GESTES_MAX = 200;
const ENTRETIENS_MAX = 10;
const ENTRETIEN_MOIS_MAX = 120;
const JETON_GESTE = /^[A-Za-z0-9_-]{32}$/;
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
/** Comme les liens de formulaire : le jeton ne vit que dans le message, seule son empreinte est gardée. */
const empreinteJeton = (jeton: string) => createHash('sha256').update(jeton).digest('base64url');
/** Même date, N mois plus tard (un 31 qui n'existe pas retombe sur le mois suivant : c'est un rappel, pas un acte). */
const plusMois = (t: number, mois: number): number => {
  const d = new Date(t);
  d.setUTCMonth(d.getUTCMonth() + mois);
  return d.getTime();
};
/** Un DÉLAI réglé (« 2 ans après », « 18 mois après ») : en années quand elles tombent juste, sinon en mois. */
const delaiEnMots = (mois: number): string => (mois >= 12 && mois % 12 === 0 ? pluriel(mois / 12, 'an', 'ans') : pluriel(mois, 'mois', 'mois'));
/** Du temps ÉCOULÉ (« 2 ans déjà ») : en années entières dès la première, sinon en mois. Jamais arrondi vers le haut. */
const depuisEnMots = (mois: number): string => (mois >= 12 ? pluriel(Math.floor(mois / 12), 'an', 'ans') : pluriel(Math.max(mois, 0), 'mois', 'mois'));
/** Mois entiers écoulés entre deux dates (le mois en cours ne compte que si le jour est passé). */
const moisEcoules = (debut: number, maintenant: number): number => {
  const a = new Date(debut);
  const b = new Date(maintenant);
  const brut = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  return b.getUTCDate() < a.getUTCDate() ? brut - 1 : brut;
};
/** Une seule ligne, sans caractère de contrôle : ce qui part vers un service extérieur ne porte jamais de mise en forme. */
const uneLigne = (t: string) => t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/ {2,}/g, ' ').trim();

/** Quoi faire, selon le sujet et le type de l'objet. */
function quoiFaire(sujet: string, type: string): string {
  if (sujet === 'facture_retard') return 'À relancer.';
  if (sujet === 'devis_sans_reponse') return 'À relancer.';
  if (sujet === 'demande_sans_suite') return 'À rappeler.';
  if (sujet === 'stock_bas') return 'À commander.';
  if (sujet === 'commande') return 'À facturer.';
  if (sujet === 'reception_ecart') return 'À régler avec le fournisseur avant de payer.';
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
      traites: estObj(e?.traites) ? (e.traites as Record<string, string>) : {},
      reportes: estObj(e?.reportes) ? (e.reportes as Record<string, string>) : {},
      gestes: (Array.isArray(e?.gestes) ? e.gestes : []).filter((g): g is GesteOffert =>
        estObj(g) && typeof g.empreinte === 'string' && typeof g.cle === 'string' && (g.geste === 'fait' || g.geste === 'plus_tard')).slice(-GESTES_MAX),
      entretiens: (Array.isArray(e?.entretiens) ? e.entretiens : []).filter((r): r is RappelEntretien =>
        estObj(r) && ID_ENTRETIEN.test(String(r.id)) && typeof r.type === 'string' && typeof r.champ === 'string' && Number.isInteger(r.apresMois)).slice(0, ENTRETIENS_MAX),
      urgenceLe: typeof e?.urgenceLe === 'string' ? e.urgenceLe : null,
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
      // la limite du geste, dite AVANT que la personne compte dessus
      geste: this.#joignable(),
      entretiens: this.#etat.entretiens.map((r) => this.#vueEntretien(r)),
      entretiensMax: ENTRETIENS_MAX,
      // ce que l'entreprise peut viser : les types de son univers qui portent une date, et rien d'écrit en dur
      entretiensPossibles: this.#typesEntretien(),
      ecrireAuClient: this.#ecrireAuClient(),
    };
  }

  /**
   * Le geste dans le message ne vaut que si l'installation est joignable depuis le téléphone. Dit ici, sur l'écran de
   * réglage, pendant que la personne branche son canal — pas après, quand elle aura cliqué dans le vide.
   */
  #joignable(): { possible: boolean; etat: 'en_ligne' | 'hors_ligne' | 'adresse_locale' | 'sans_adresse'; phrase: string } {
    const base = this.#etat.adresseJeu;
    if (!base) {
      return { possible: false, etat: 'sans_adresse', phrase: 'Sans adresse, les messages partent sans lien : ni écran à ouvrir, ni « C’est fait » à cliquer. Le reste fonctionne.' };
    }
    const enLigne = this.#src.enLigne?.() === true;
    if (!enLigne) {
      return {
        possible: false, etat: 'hors_ligne',
        phrase: 'Living Business tourne sur cet ordinateur, pas sur un serveur joignable de l’extérieur : depuis un chantier, un lien « C’est fait » ne ramènerait nulle part. Il n’est donc pas écrit dans les messages — les alertes, elles, partent normalement. Pour l’avoir : « Mettre en ligne ».',
      };
    }
    if (!base.startsWith('https://')) {
      return { possible: false, etat: 'adresse_locale', phrase: 'Cette adresse ne vaut que sur cet ordinateur. Donnez l’adresse publique de votre Living Business pour que « C’est fait » et « Plus tard » fonctionnent depuis le téléphone.' };
    }
    return { possible: true, etat: 'en_ligne', phrase: 'Votre installation est en ligne : chaque alerte seule porte « C’est fait » et « Plus tard », cliquables depuis le téléphone. Chaque lien ne sert qu’une fois.' };
  }

  /** L'état de l'offre, lu tel quel. Jamais décidé ici, jamais appelé sur le réseau (voir `../core/offre.ts`). */
  #offre(): EtatOffre {
    return lireOffre(this.#src.offre?.() ?? { relie: false, plan: null, etatAbonnement: null });
  }

  /**
   * Prévenir l'entreprise est compris, toujours. Écrire au client à sa place, c'est produire et envoyer : cela relève
   * de l'offre, et cela se fait à l'écran Optimiser, pas ici. On le DIT, on ne le cache pas, et on ne le refait pas.
   */
  #ecrireAuClient(): { compris: boolean; offre: string; phrase: string } {
    const compris = this.#offre() === 'offre_active';
    return {
      compris, offre: OFFRE,
      phrase: compris
        ? `Vous prévenir reste compris, et ${OFFRE} est ouverte : l’envoi au client se règle à l’écran Optimiser. Même alors, Living Business n’écrit à personne sans que vous l’ayez activé.`
        : `Vous prévenir est compris dans Living Business, et le restera. Écrire au client à votre place, c’est produire et envoyer un message qui engage votre entreprise : ces envois partent par le service de l’éditeur, et sont compris dans ${OFFRE}. Rien ne vous empêche d’écrire vous-même, comme aujourd’hui.`,
    };
  }

  #vueEntretien(r: RappelEntretien) {
    const u = this.#src.univers();
    const def = defType(u, r.type);
    return {
      id: r.id, type: r.type, champ: r.champ, apresMois: r.apresMois, creeLe: r.creeLe,
      // les libellés viennent de l'univers : « Chantier », « Livraison prévue »… jamais du code
      libelleType: libelleType(u, r.type),
      libelleChamp: def?.champs.find((c) => c.id === r.champ)?.libelle ?? r.champ,
      apres: delaiEnMots(r.apresMois),
    };
  }

  /**
   * Ce sur quoi un rappel d'entretien peut se poser : les types de l'univers qui portent une date et qui sont un
   * TRAVAIL (famille `projet` : chantier, dossier, mission…) ou une AFFAIRE (famille `commande` : vente, commande,
   * facture…). Les familles sont celles du noyau (`../core/model.ts`) ; les libellés, eux, viennent de l'univers.
   */
  #typesEntretien() {
    const u = this.#src.univers();
    return typesVisibles(u)
      .filter((t) => t.famille === 'projet' || t.famille === 'commande')
      .sort((a, b) => (a.famille === b.famille ? 0 : a.famille === 'projet' ? -1 : 1))
      .map((t) => ({ type: t.id, libelle: t.libelle, champs: t.champs.filter((c) => c.type === 'date').map((c) => ({ id: c.id, libelle: c.libelle })) }))
      .filter((t) => t.champs.length > 0);
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

  // ---------------------------------------------------------------- rappels d'entretien chez le client

  /**
   * « Pour mes chantiers, préviens-moi deux ans après la fin. » Le type et le champ de date sont contrôlés contre
   * l'univers de l'entreprise : rien n'est accepté qui n'y soit déclaré, et rien n'est écrit en dur ici.
   */
  ajouterEntretien(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    if (this.#etat.entretiens.length >= ENTRETIENS_MAX) {
      throw new ErreurApi(409, 'trop_de_rappels', `Vous avez déjà ${ENTRETIENS_MAX} rappels d’entretien : retirez-en un avant d’en ajouter.`);
    }
    const u = this.#src.univers();
    const type = typeof d.type === 'string' ? d.type : '';
    const def = defType(u, type);
    if (!def) throw new ErreurApi(400, 'type_inconnu', 'Ce type n’existe pas dans votre univers.');
    const champ = typeof d.champ === 'string' ? d.champ : '';
    const dc = def.champs.find((c) => c.id === champ);
    if (!dc || dc.type !== 'date') throw new ErreurApi(400, 'champ_invalide', `Choisissez une date de « ${def.libelle} » : c’est elle qui dit quand le travail a été fait.`);
    const mois = Number(d.apresMois);
    if (!Number.isInteger(mois) || mois < 1 || mois > ENTRETIEN_MOIS_MAX) {
      throw new ErreurApi(400, 'delai_invalide', `Combien de mois après ? Entre 1 et ${ENTRETIEN_MOIS_MAX} (dix ans).`);
    }
    if (this.#etat.entretiens.some((r) => r.type === type && r.champ === champ && r.apresMois === mois)) {
      throw new ErreurApi(409, 'rappel_en_double', 'Ce rappel existe déjà.');
    }
    const r: RappelEntretien = { id: `ent-${randomUUID().replace(/-/g, '').slice(0, 12)}`, type, champ, apresMois: mois, creeLe: this.#src.maintenant().toISOString() };
    this.#etat.entretiens.push(r);
    this.#changement();
    return this.#vueEntretien(r);
  }

  supprimerEntretien(p: Profil, id: unknown) {
    this.#admin(p);
    const r = typeof id === 'string' && ID_ENTRETIEN.test(id) ? this.#etat.entretiens.find((x) => x.id === id) : undefined;
    if (!r) throw new ErreurApi(404, 'introuvable');
    this.#etat.entretiens = this.#etat.entretiens.filter((x) => x.id !== r.id);
    this.#changement();
    return { ok: true as const, id: r.id };
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

  // ---------------------------------------------------------------- le geste fait depuis le message

  /** Le geste retrouvé par son jeton, ou rien. Aucune écriture : un aperçu ne joue jamais le geste. */
  #geste(jeton: unknown): GesteOffert | null {
    if (typeof jeton !== 'string' || !JETON_GESTE.test(jeton)) return null;
    const e = empreinteJeton(jeton);
    const g = this.#etat.gestes.find((x) => x.empreinte === e);
    if (!g) return null;
    return Date.parse(g.expire) > this.#src.maintenant().getTime() ? g : null;
  }

  /**
   * Ce que le lien propose, DIT AVANT D'AGIR : un aperçu n'a aucun effet, pour qu'un service qui déplie les liens
   * (aperçu de message, antivirus, robot) ne puisse pas décider à la place de la personne.
   */
  apercuGeste(jeton: unknown): { trouve: boolean; geste: Geste | null; quoi: string; deja: boolean; titre: string; texte: string } {
    const g = this.#geste(jeton);
    if (!g) {
      return { trouve: false, geste: null, quoi: '', deja: false, titre: 'Ce lien n’est plus valable',
        texte: 'Il a déjà servi, ou il a plus d’une semaine. Ouvrez Living Business : ce qu’il reste à faire y est, à jour.' };
    }
    if (g.faitLe) return { trouve: true, geste: g.geste, quoi: g.quoi, deja: true, ...this.#ditGeste(g.geste, true) };
    return {
      trouve: true, geste: g.geste, quoi: g.quoi, deja: false,
      titre: g.geste === 'fait' ? 'C’est fait ?' : 'Plus tard ?',
      texte: g.geste === 'fait'
        ? 'Living Business arrête de vous le rappeler. La fiche, elle, ne bouge pas : c’est votre logiciel ou votre banque qui dira que c’est réglé.'
        : 'Living Business n’en reparle pas avant demain. Ce qu’il y a à faire reste à l’écran, comme d’habitude.',
    };
  }

  /** Ce qu'on répond quand c'est joué (ou déjà joué) : les mêmes mots, pour qu'un deuxième clic ne surprenne pas. */
  #ditGeste(geste: Geste, deja: boolean): { titre: string; texte: string } {
    if (geste === 'fait') {
      return { titre: deja ? 'C’était déjà noté' : 'C’est noté',
        texte: `Living Business ne vous le rappelle plus${deja ? ' — ce lien avait déjà servi' : ''}. La fiche n’a pas été modifiée : rien n’est écrit dans votre entreprise depuis un message.` };
    }
    return { titre: deja ? 'C’était déjà remis à demain' : 'Remis à demain',
      texte: `On vous en reparle demain${deja ? ' — ce lien avait déjà servi' : ''}. D’ici là, c’est à l’écran de Living Business comme d’habitude.` };
  }

  /**
   * Le geste, joué UNE SEULE FOIS. Rejouer le lien (deuxième clic, message transféré, lien gardé) ne refait rien :
   * on le dit, et on s'arrête. Aucun profil demandé : le jeton est la seule clé, et il ne vaut que pour ce geste-là.
   */
  faireGeste(jeton: unknown): { ok: boolean; deja: boolean; geste: Geste | null; quoi: string; titre: string; texte: string } {
    const g = this.#geste(jeton);
    if (!g) {
      const a = this.apercuGeste(jeton);
      return { ok: false, deja: false, geste: null, quoi: '', titre: a.titre, texte: a.texte };
    }
    if (g.faitLe) return { ok: true, deja: true, geste: g.geste, quoi: g.quoi, ...this.#ditGeste(g.geste, true) };
    const maintenant = this.#src.maintenant();
    g.faitLe = maintenant.toISOString();
    if (g.geste === 'fait') this.#etat.traites[g.cle] = maintenant.toISOString();
    else this.#etat.reportes[g.cle] = this.#lendemain(maintenant);
    // ce qui attendait encore son tour ne part plus : la personne a tranché
    this.#etat.attente = this.#etat.attente.filter((a) => a.cle !== g.cle);
    // les deux liens d'une même alerte vont ensemble : l'autre ne sert plus
    for (const autre of this.#etat.gestes) if (autre.cle === g.cle && autre !== g && !autre.faitLe) autre.faitLe = g.faitLe;
    this.#changement();
    return { ok: true, deja: false, geste: g.geste, quoi: g.quoi, ...this.#ditGeste(g.geste, false) };
  }

  #lendemain(d: Date): string {
    return this.#jour(new Date(d.getTime() + JOUR_MS));
  }

  /**
   * Les deux liens d'une alerte seule. Rien si l'installation n'est pas joignable : un lien mort dans un message vaut
   * moins que pas de lien du tout.
   */
  #gestesPour(f: FaitRetenu, maintenant: Date): string {
    const base = this.#etat.adresseJeu;
    if (!base || !this.#joignable().possible) return '';
    const expire = new Date(maintenant.getTime() + GESTE_DUREE_MS).toISOString();
    const lignes: string[] = [];
    for (const [geste, mot] of [['fait', 'C’est fait'], ['plus_tard', 'Plus tard']] as const) {
      const jeton = randomBytes(24).toString('base64url');
      this.#etat.gestes.push({ empreinte: empreinteJeton(jeton), cle: f.cle, geste, quoi: f.texte, expire, faitLe: null });
      lignes.push(`${mot} : ${base}/g/${jeton}`);
    }
    // les gestes périmés tombent ; un geste JOUÉ est gardé jusqu'à sa date, pour pouvoir répondre « c'était déjà noté »
    this.#etat.gestes = this.#etat.gestes.filter((g) => Date.parse(g.expire) > maintenant.getTime()).slice(-GESTES_MAX);
    return `\n${lignes.join('\n')}`;
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
    const r = await this.#envoyer(c, texte, false);
    this.#changement();
    return { ok: r.ok, message: r.ok ? `C’est parti : regardez ${c.canal === 'telegram' ? 'Telegram' : c.canal === 'whatsapp' ? 'WhatsApp' : 'votre service'}. Si rien n’arrive, c’est que le message a été accepté puis bloqué plus loin.` : r.detail, canal: this.#vue(c) };
  }

  // ---------------------------------------------------------------- passage périodique

  /**
   * Une passe : regarde ce qui est nouveau, décide si ça part maintenant, envoie. Ne fait rien sans canal en marche.
   * Renvoie le nombre de messages envoyés.
   */
  /**
   * CE QU'ON ÉCRIT AU ROBOT, relevé à chaque passage. `getUpdates` sans webhook : une installation posée sur un
   * ordinateur de bureau n'a pas d'adresse publique, et on ne va pas en exiger une pour lire trois phrases.
   *
   * CE QUI EST ÉCOUTÉ, ET RIEN D'AUTRE : les messages de LA conversation branchée. Un inconnu qui trouve le robot et
   * lui écrit n'obtient rien — pas même une réponse qui lui apprendrait que le robot existe pour quelqu'un.
   *
   * La position de lecture est gardée (`luJusqua`) : un message traité ne l'est pas deux fois, même si le jeu
   * redémarre entre-temps. Telegram efface de lui-même ce qu'on a confirmé avoir lu.
   */
  async #ecouter(): Promise<void> {
    if (!this.#src.surMessage && !this.#src.surBouton) return;
    for (const c of this.#etat.canaux) {
      if (c.canal !== 'telegram' || !c.actif) continue;
      let prive: PriveTelegram;
      try { prive = JSON.parse(this.#chiffreur.dechiffrer(c.prive)) as PriveTelegram; } catch { continue; }
      if (!prive?.jeton || !prive.conversation) continue;
      const r = await this.#telegramAppel(prive.jeton, 'getUpdates', {
        limit: 20, timeout: 0, allowed_updates: ['message', 'callback_query'], ...(c.luJusqua ? { offset: c.luJusqua + 1 } : {}),
      });
      if (!r.ok) return; // robot pris par un webhook, jeton révoqué… : l'envoi dira déjà pourquoi, on n'insiste pas
      const lots = Array.isArray(r.resultat) ? r.resultat : [];
      for (const u of lots) {
        if (!estObj(u) || typeof u.update_id !== 'number') continue;
        // `offset` dit déjà à Telegram de ne pas renvoyer ce qu'on a lu ; on le revérifie ici, parce qu'un message
        // traité deux fois créerait deux fiches — et qu'on ne confie pas cette garantie à l'autre bout du fil
        const deja = c.luJusqua !== undefined && u.update_id <= c.luJusqua;
        c.luJusqua = Math.max(c.luJusqua ?? 0, u.update_id);
        if (deja) continue;
        /*
         * DEUX SORTES DE NOUVELLES : un message écrit, et un bouton pressé. Le bouton sert à CHOISIR plutôt qu'à
         * retaper — l'article d'un mouvement de stock, sur un quai, à une main. Telegram veut qu'on accuse
         * réception d'un bouton (`answerCallbackQuery`), faute de quoi il tourne indéfiniment sur le téléphone.
         */
        const clic = estObj(u.callback_query) ? u.callback_query : null;
        const m = estObj(u.message) ? u.message : (clic && estObj(clic.message) ? clic.message : null);
        const chat = m && estObj(m.chat) ? m.chat : null;
        const brut = clic ? clic.data : u.message && estObj(u.message) ? u.message.text : null;
        const texte = typeof brut === 'string' ? brut : '';
        // la conversation branchée, et elle seule
        if (!chat || String(chat.id) !== String(prive.conversation) || !texte.trim()) continue;
        const de = estObj(clic?.from) ? clic.from : (m && estObj(m.from) ? m.from : null);
        const expediteur: Expediteur = {
          id: de && (typeof de.id === 'number' || typeof de.id === 'string') ? String(de.id) : '',
          nom: uneLigne(String(de?.first_name ?? de?.username ?? '')).slice(0, 60),
        };
        if (clic && typeof clic.id === 'string') {
          await this.#telegramAppel(prive.jeton, 'answerCallbackQuery', { callback_query_id: clic.id });
        }
        let reponse: ReponseRobot = { texte: '' };
        try {
          const f = clic ? this.#src.surBouton : this.#src.surMessage;
          reponse = f ? await f(texte, expediteur) : { texte: '' };
        } catch (e) { reponse = { texte: e instanceof Error ? e.message : 'Je n’ai pas pu le faire.' }; }
        if (reponse.texte) {
          const clavier = reponse.boutons?.length
            ? { reply_markup: { inline_keyboard: reponse.boutons.slice(0, 12).map((b) => [{ text: b.texte.slice(0, 64), callback_data: b.donnee.slice(0, 64) }]) } }
            : {};
          await this.#telegramAppel(prive.jeton, 'sendMessage', { chat_id: prive.conversation, text: reponse.texte.slice(0, 4096), link_preview_options: { is_disabled: true }, ...clavier });
        }
      }
      if (lots.length) this.#changement();
    }
  }

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
      await this.#ecouter();
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
    // ce qui a disparu du monde oublie aussi ce qu'on en avait tranché : s'il revient, il pourra reparler
    for (const cle of Object.keys(this.#etat.traites)) if (!vivants.has(cle)) delete this.#etat.traites[cle];
    const jour = this.#jour(maintenant);
    for (const [cle, revient] of Object.entries(this.#etat.reportes)) if (!vivants.has(cle) || revient <= jour) delete this.#etat.reportes[cle];
    const dejaEnAttente = new Set(this.#etat.attente.map((a) => a.cle));
    const le = maintenant.toISOString();
    let ajoutes = 0;
    for (const f of faits) {
      if (this.#etat.vus[f.cle] || dejaEnAttente.has(f.cle)) continue;
      // tranché depuis un message : « C'est fait » tant que le fait dure, « Plus tard » jusqu'au jour dit
      if (this.#tranche(f.cle, jour)) continue;
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

  /** Ce que la personne a déjà tranché depuis un message ne lui est pas resservi (résumé du matin compris). */
  #tranche(cle: string, jour: string): boolean {
    const revient = this.#etat.reportes[cle];
    return Boolean(this.#etat.traites[cle]) || (typeof revient === 'string' && revient > jour);
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

  /**
   * UN LOT PAR PASSAGE, jamais deux messages pour la même minute (voir la règle du tri, en tête de module).
   * - fenêtre ouverte : tout ce qui attend part ensemble, urgences comprises, en UN message ;
   * - fenêtre fermée (silence, week-end, plafond) : seules les urgences passent, et au plus une tous les dix
   *   minutes — deux urgences coup sur coup ne font pas sonner deux fois.
   */
  async #envoyerCeQuiEstDu(maintenant: Date, jour: string): Promise<number> {
    const q = this.#etat.quand;
    const attente = [...this.#etat.attente];
    const urgents = attente.filter((a) => a.urgent);
    let envoyes = 0;

    const fenetre = this.#fenetre(maintenant);
    const plafond = this.#etat.envoyes >= q.maxParJour;
    const groupe = q.mode === 'une_fois_par_jour';
    const ouvert = fenetre && !plafond && (!groupe || this.#heureDue(maintenant));
    if (attente.length && ouvert) {
      if (await this.#envoyerLot(attente, maintenant, urgents.length > 0)) envoyes++;
    } else if (urgents.length && q.urgencesPassent && this.#pauseUrgencePassee(maintenant)) {
      // une urgence vraie passe malgré le silence, le week-end et le plafond — sauf si l'entreprise l'a refusé
      if (await this.#envoyerLot(urgents, maintenant, true)) { this.#etat.urgenceLe = maintenant.toISOString(); envoyes++; }
    }

    // résumé du matin : une fois par jour, à l'heure choisie
    if (this.#etat.sujets.includes('resume_matin') && this.#etat.resumeLe !== jour && fenetre && this.#heureDue(maintenant)) {
      const texte = await this.#resumeDuMatin(maintenant);
      this.#etat.resumeLe = jour;
      if (texte && (await this.#diffuser(texte, false, maintenant)).length) { this.#etat.envoyes++; envoyes++; }
    }
    return envoyes;
  }

  /** Une urgence vient-elle de partir ? (anti-flux : au plus une interruption hors des heures tous les dix minutes) */
  #pauseUrgencePassee(maintenant: Date): boolean {
    const le = this.#etat.urgenceLe;
    return !le || Number.isNaN(Date.parse(le)) || maintenant.getTime() - Date.parse(le) >= PAUSE_URGENCE_MS;
  }

  /** Compose un message à partir des faits et l'envoie ; les faits ne quittent la file que si un canal l'a pris. */
  async #envoyerLot(faits: FaitRetenu[], maintenant: Date, urgent: boolean): Promise<boolean> {
    const texte = this.#composer(faits, urgent, maintenant);
    const partis = await this.#diffuser(texte, urgent, maintenant);
    if (!partis.length) return false;
    const envoyes = new Set(faits.map((f) => f.cle));
    this.#etat.attente = this.#etat.attente.filter((a) => !envoyes.has(a.cle));
    this.#etat.envoyes++;
    return true;
  }

  /**
   * Un fait : une phrase, et les deux gestes (« C'est fait », « Plus tard ») — une décision réelle, qu'on peut
   * trancher depuis le message. Plusieurs : une tête de message puis une ligne chacun, cinq au plus, et pas de geste,
   * parce qu'un geste ne vaut que pour UNE décision.
   */
  #composer(faits: readonly FaitRetenu[], urgent: boolean, maintenant: Date = this.#src.maintenant()): string {
    const vues = new Set(faits.map((f) => f.vue).filter((v): v is string => Boolean(v)));
    const lien = this.#lien(vues.size === 1 ? ([...vues][0] as string) : null);
    const premier = faits[0];
    if (faits.length === 1 && premier) return `${urgent ? 'Urgent — ' : ''}${premier.texte}${lien}${this.#gestesPour(premier, maintenant)}`.slice(0, TEXTE_MAX);
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
    const prisEnCharge = prisEnChargePar(objets);
    const aProbleme = new Set(this.#src.situations().filter((s) => s.statut === 'ouverte').map((s) => s.objetId));

    for (const s of this.#src.situations()) {
      if (s.statut !== 'ouverte') continue;
      const o = parId.get(s.objetId);
      if (!o) continue;
      // le classement de l'écran Aujourd'hui : une situation déjà prise en charge quitte « À faire maintenant »,
      // donc elle ne sonne pas non plus — on a agi, il reste à attendre que la donnée le prouve
      if (prisEnCharge.has(o.id)) continue;
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
      // LE DÉLAI N'EST PLUS COMPTÉ ICI. Il vient du moteur de suivi (`../core/relances.ts`), qui sait depuis combien
      // de jours le parcours du devis n'a pas bougé, et du rythme que l'entreprise a réglé. Ce module ne fait plus
      // que dire ce qu'il a reçu : un seul endroit décide, et il n'y a plus deux comptes de sept jours à tenir.
      for (const r of this.#src.relances?.() ?? []) {
        if (r.relance !== 'reponse' || prisEnCharge.has(r.suiviId)) continue;
        const o = parId.get(r.suiviId);
        const montant = o !== undefined && typeof o.champs.montant === 'number' ? ` de ${mesure(o.champs.montant, '€')}` : '';
        faits.push({
          cle: `devis_sans_reponse:${r.suiviId}`, sujet: 'devis_sans_reponse', urgent: false,
          vue: `type:${o?.type ?? 'devis'}`,
          texte: uneLigne(`${r.libelleSujet} ${sansMention(r.nom)}${montant} : sans réponse depuis ${pluriel(r.jours, 'jour', 'jours')}. À relancer.`),
        });
      }
    }

    /*
      * UNE DEMANDE QUI DORT. Même mécanisme que le devis sans réponse : le délai vient du moteur de relances, pas
      * d'un compte tenu ici. Ce qui change, c'est ce qu'on perd — un devis sans réponse a au moins été chiffré ;
      * une demande oubliée, personne ne sait qu'elle a existé.
      */
    if (choisis.has('demande_sans_suite')) {
      for (const r of this.#src.relances?.() ?? []) {
        if (r.relance !== 'suite' || prisEnCharge.has(r.suiviId)) continue;
        const o = parId.get(r.suiviId);
        const montant = o !== undefined && typeof o.champs.montant_estime === 'number' ? ` (environ ${mesure(o.champs.montant_estime, '€')})` : '';
        faits.push({
          cle: `demande_sans_suite:${r.suiviId}`, sujet: 'demande_sans_suite', urgent: false,
          vue: `type:${o?.type ?? 'demande'}`,
          texte: uneLigne(`${r.libelleSujet} ${sansMention(r.nom)}${montant} : ${r.jours <= 0 ? 'à rappeler aujourd’hui' : `à rappeler depuis ${pluriel(r.jours, 'jour', 'jours')}`}.`),
        });
      }
    }

    if (choisis.has('commande')) {
      for (const o of objets) {
        if (o.type !== 'commande_client' || o.champs.statut !== 'livrée' || prisEnCharge.has(o.id)) continue;
        const montant = typeof o.champs.montant === 'number' ? ` de ${mesure(o.champs.montant, '€')}` : '';
        faits.push({ cle: `commande:${o.id}`, sujet: 'commande', urgent: false, vue: 'type:commande_client',
          texte: uneLigne(`Commande ${sansMention(o.nom)}${montant} : livrée, pas encore facturée. À facturer.`) });
      }
    }

    /*
      * UNE RÉCEPTION QUI NE CONCORDE PAS. C'est l'argent qui part sans que personne ne s'en aperçoive : un bon
      * supérieur à la commande, ou le même bon enregistré deux fois. Les deux se paient, et les deux se repèrent
      * sans rien deviner. COCHÉE au départ : c'est la quatrième, là où la maison n'en promettait que trois (« on
      * ne noie personne dès le premier jour »). La règle a été rouverte exprès, parce qu'un bon payé deux fois ne
      * se rattrape pas, et parce que celle-ci ne sonne que sur des chiffres qui ne tombent pas — jamais sur une
      * livraison du jour qu'on n'a pas encore eu le temps de contrôler. Une cinquième demanderait la même
      * discussion : le nombre n'est pas la règle, c'est le fait qu'aucune ne sonne pour rien.
      *
      * Les questions sans réponse (« quantités pas encore vérifiées ») ne sonnent PAS : une réception de la veille
      * qu'on n'a pas eu le temps de contrôler n'est pas une anomalie, et une alerte qui se déclenche sur chaque
      * livraison cesse d'être lue au bout d'une semaine.
      */
    if (choisis.has('reception_ecart')) {
      for (const o of objets) {
        if (o.type !== 'reception' || prisEnCharge.has(o.id)) continue;
        const r = this.#src.reception?.(o.id) ?? null;
        if (!r || (!r.problemes.length && !r.payeQuandMeme)) continue;
        faits.push({
          cle: `reception_ecart:${o.id}`, sujet: 'reception_ecart', urgent: r.payeQuandMeme || r.doublon !== null,
          vue: 'type:reception',
          texte: uneLigne(`${sansMention(o.nom)} : ${r.payeQuandMeme ? `marquée bon à payer alors que ${r.problemes[0] ?? 'tout n’est pas vérifié'}` : (r.problemes[0] ?? '')}. ${quoiFaire('reception_ecart', o.type)}`),
        });
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
        // « reseau » : l'adresse publique de l'écran du réseau (le jeu ne montre jamais son nom interne)
        faits.push({ cle: `demande_reseau:${n}`, sujet: 'demande_reseau', urgent: false, vue: 'reseau',
          texte: uneLigne(`Réseau : ${pluriel(n, 'demande attend', 'demandes attendent')} votre réponse. À répondre.`) });
      }
    }

    if (choisis.has('entretien_client')) faits.push(...this.#entretiens(maintenant, u, objets, parId, prisEnCharge, aProbleme));
    return faits;
  }

  /**
   * Le rappel d'entretien : un travail terminé il y a longtemps, et l'entreprise qui décide. Jamais un mot au client.
   * Tout le vocabulaire vient de l'univers : le type visé, son libellé, le champ de date, et la condition « terminé »
   * que l'univers déclare déjà pour ce type (une commande « livrée » ou « facturée », par exemple).
   * Un travail sur lequel quelque chose est encore ouvert n'est pas un travail fini : il ne donne pas de rappel.
   */
  #entretiens(
    maintenant: Date,
    u: Univers,
    objets: readonly ObjetMetier[],
    parId: Map<string, ObjetMetier>,
    prisEnCharge: ReadonlySet<string>,
    aProbleme: ReadonlySet<string>,
  ): Fait[] {
    const faits: Fait[] = [];
    for (const r of this.#etat.entretiens) {
      const def = defType(u, r.type);
      if (!def || def.champs.find((c) => c.id === r.champ)?.type !== 'date') continue;
      // « terminé » tel que l'univers l'entend pour ce type (../core/univers.ts) ; sans règle, la date suffit
      const termine = u.echeances.find((e) => e.type === r.type && e.termine !== undefined)?.termine ?? null;
      const quoi = libelleType(u, r.type);
      for (const o of objets) {
        if (o.type !== r.type || prisEnCharge.has(o.id) || aProbleme.has(o.id)) continue;
        if (termine && !termine.valeurs.includes(String(o.champs[termine.champ] ?? ''))) continue;
        const brut = o.champs[r.champ];
        if (typeof brut !== 'string') continue;
        const fait = Date.parse(`${brut.slice(0, 10)}T00:00:00Z`);
        if (Number.isNaN(fait) || plusMois(fait, r.apresMois) > maintenant.getTime()) continue;
        const client = ['client', 'tiers', 'maitre_ouvrage'].map((k) => o.champs[k]).find((v) => typeof v === 'string');
        const nomClient = typeof client === 'string' ? parId.get(client)?.nom : undefined;
        // le temps dit est celui qui s'est VRAIMENT écoulé, pas le délai réglé : un chantier de 2019 n'a pas « deux ans »
        const depuis = depuisEnMots(moisEcoules(fait, maintenant.getTime()));
        faits.push({
          cle: `entretien:${r.id}:${o.id}`, sujet: 'entretien_client', urgent: false, vue: `type:${o.type}`,
          texte: uneLigne(`${quoi} ${sansMention(o.nom)}${nomClient ? ` (${sansMention(nomClient)})` : ''} — ${depuis} déjà. Un entretien est peut-être à proposer. À vous de voir : Living Business n’écrit rien au client.`),
        });
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
    let tous: Fait[];
    try { tous = await this.#faits(maintenant); } finally { this.#etat.sujets = choisis; }
    // … mais pas ce que la personne a déjà tranché depuis un message : « C'est fait » vaut aussi pour le résumé
    const jour = this.#jour(maintenant);
    const faits = tous.filter((f) => !this.#tranche(f.cle, jour));
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
    return { ok: false, detail: message, definitif };
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

/**
 * Les objets qu'une tâche ouverte prend déjà en charge — même règle que `suiviDe` dans `web/aujourdhui.js` : une
 * tâche (famille `tache`) non terminée dont le champ `concerne` pointe sur l'objet. C'est ce qui fait passer une
 * situation de « à faire » à « en cours » à l'écran : le canal d'alertes s'aligne, et se tait.
 */
function prisEnChargePar(objets: readonly ObjetMetier[]): ReadonlySet<string> {
  const pris = new Set<string>();
  for (const o of objets) {
    if (o.famille !== 'tache' || o.champs.statut === 'terminée') continue;
    const cible = o.champs.concerne;
    if (typeof cible === 'string' && cible && cible !== o.id) pris.add(cible);
  }
  return pris;
}

function texteObligatoire(x: unknown, champ: string, message: string): string {
  const v = typeof x === 'string' ? x.trim() : '';
  if (!v || v.length > 500) throw new ErreurApi(400, `${champ}_manquant`, message);
  return v;
}

/** Adresse du jeu pour les liens : origine seulement, https (ou un poste local). */
function lireAdresseJeu(x: unknown): string | null {
  if (x === null || x === '') return null;
  if (typeof x !== 'string' || x.length > 300) throw new ErreurApi(400, 'adresse_invalide', 'Adresse de Living Business invalide.');
  let u: URL;
  try { u = new URL(x.trim()); } catch { throw new ErreurApi(400, 'adresse_invalide', 'Adresse de Living Business invalide.'); }
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) throw new ErreurApi(400, 'adresse_invalide', 'L’adresse de Living Business doit commencer par https://');
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
