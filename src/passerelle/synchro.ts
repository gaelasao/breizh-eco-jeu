/**
 * Synchronisation dans les DEUX sens entre le monde et les outils de l'entreprise.
 * - Réel → jeu : lecture périodique (Airtable, Notion, HubSpot, Sheets, API, MCP) ou réception (webhook Make/Zapier/n8n).
 * - Jeu → réel : chaque objet lié dont le contenu a changé dans le jeu (empreinte différente) est renvoyé à l'outil ;
 *   les objets créés dans le jeu sont créés dans l'outil si la synchro est « dans les deux sens ».
 * - Anti-boucle : l'empreinte est mémorisée après chaque échange ; un objet n'est poussé que s'il a changé depuis.
 * - Sécurité : réservé aux administrateurs ; jetons chiffrés au repos et jamais renvoyés au navigateur ;
 *   l'entrée webhook exige un secret (Bearer) ou une signature HMAC ; anti-SSRF dans `sortant.ts`.
 * - Temps réel (`temps-reel.ts`) : un branchement abonné chez son outil est relu dès que l'outil prévient (avis regroupés
 *   sur 2 s), et seulement toutes les 30 minutes sinon, en filet de sécurité ; sans temps réel, à son intervalle.
 * - « Se connecter avec… » (relais de Breizhcosystem, `oauth-relais.ts`) : le secret d'attente reste ici, en mémoire ; le
 *   navigateur ne reçoit qu'une référence `oauth:<id>` à usage unique. Le secret enregistré est alors
 *   `{"oauth":{fournisseur, acces, rafraichissement, expire, extra}}`, chiffré comme les autres ; avant chaque appel à
 *   l'outil, le jeton d'accès est renouvelé par le relais s'il expire dans moins de 2 minutes (et une fois sur un 401),
 *   la rotation est enregistrée, et l'adaptateur reçoit le jeton d'accès comme s'il avait été collé.
 */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Profil } from '../demo/donnees.ts';
import { defType } from '../core/univers.ts';
import { NOM, normaliser, proposerMapping, ROLES } from './csv.ts';
import { ErreurApi, type LigneExterne, type Monde } from './monde.ts';
import { bientotExpire, BOUTIQUE_SHOPIFY, compteConnecte, configAvecConnexion, enveloppe, FOURNISSEUR_DE, lireEnveloppe, NOM_FOURNISSEUR, PARAMETRE_OAUTH, parRelais, RelaisOAuth, ressembleEnveloppe, type ConnexionOAuth, type DroitsOAuth, type FournisseurOAuth } from './oauth-relais.ts';
import { ADAPTATEURS, aplatir, aplatirObjet, appelMcp, cleEnvois, lireSignature, SCRIPT_SHEETS, signerEnvoi, TOLERANCE_SIGNATURE_S, type ContexteAdaptateur, type TypeSource, type ValeurSortante } from './sources.ts';
import { ORGANISATION_DYNAMICS } from './sources-dynamics.ts';
import { VERSION_SHOPIFY } from './sources-metier.ts';
import { demarrerConnexionMicrosoft, jetonAccesMicrosoft, suivreConnexionMicrosoft } from './sources-microsoft.ts';
import { concerne, FILET_TEMPS_REEL_S, OUTILS_TEMPS_REEL, REGROUPEMENT_MS, suiviDe, TEMPS_REEL_DE, type AbonnementOutil, type AdresseAvis, type AvisRecu, type FournisseurTempsReel } from './temps-reel.ts';
import { appeler, CorpsBrut, ErreurReglage, ErreurSortante, recuperateurProtege, verifierUrl, type Recuperateur } from './sortant.ts';
import type { Chiffreur } from './stockage.ts';
import { pluriel } from '../core/texte.ts';

export type Sens = 'lecture' | 'deux' | 'ecriture';

/**
 * Révocation directe chez l'outil quand on supprime le connecteur, là où l'outil publie une adresse de révocation
 * qui ne demande pas le secret de l'application (gardé par le relais de Breizhcosystem) : Google (RFC 7009), Shopify
 * (l'application se désinstalle elle-même de la boutique, avec son jeton d'accès). Pipedrive, Notion et HubSpot exigent
 * ce secret : c'est le relais qui les révoque (`RelaisOAuth.revoquer`). Ailleurs (Microsoft, Airtable, Sellsy, clés
 * collées…), la personne est invitée à retirer l'accès chez l'outil.
 * HubSpot : son ancienne révocation sans secret (API OAuth v1, jeton dans l'adresse) répond par des erreurs à partir du
 * 16 février 2027. Elle ne sert plus qu'en secours, jusqu'à cette date, quand le relais n'a pas révoqué (relais pas
 * encore mis à jour, ou injoignable) ; ensuite la personne retire l'accès chez HubSpot.
 */
interface AppelRevocation { url: URL; methode: string; corps?: unknown; entetes?: Record<string, string>; reussi?: (texte: string) => boolean }
export const FIN_HUBSPOT_V1 = Date.UTC(2027, 1, 16);
const REVOCATION: Partial<Record<FournisseurOAuth, (j: ConnexionOAuth, maintenant: number) => AppelRevocation | null>> = {
  google: (j) => ({ url: new URL('https://oauth2.googleapis.com/revoke'), methode: 'POST', corps: new CorpsBrut('application/x-www-form-urlencoded', new URLSearchParams({ token: j.rafraichissement ?? j.acces }).toString()) }),
  hubspot: (j, maintenant) => (j.rafraichissement && maintenant < FIN_HUBSPOT_V1 ? { url: new URL(`https://api.hubapi.com/oauth/v1/refresh-tokens/${encodeURIComponent(j.rafraichissement)}`), methode: 'DELETE' } : null),
  shopify: (j) => (BOUTIQUE_SHOPIFY.test(j.extra.boutique ?? '') ? {
    url: new URL(`https://${j.extra.boutique}/admin/api/${VERSION_SHOPIFY}/graphql.json`), methode: 'POST', entetes: { 'x-shopify-access-token': j.acces },
    corps: { query: 'mutation { appUninstall { userErrors { message } } }' },
    // GraphQL répond 200 même en cas de refus : la désinstallation n'est faite que sans erreur dans la réponse
    reussi: (t) => { try { const d = JSON.parse(t) as { data?: { appUninstall?: { userErrors?: unknown[] } | null }; errors?: unknown[] }; return !d.errors?.length && d.data?.appUninstall != null && !d.data.appUninstall.userErrors?.length; } catch { return false; } },
  } : null),
};
/** `garde` : un autre branchement se sert encore du même outil, l'accès n'est donc pas retiré chez lui. */
export type AccesApresSuppression = 'revoque' | 'a_retirer' | 'garde' | null;

export interface ConnecteurEnregistre {
  id: string;
  source: TypeSource;
  nom: string;
  typeObjet: string;
  roles: string[];
  mapping: Record<string, string>; // champ externe → cible (__nom, __roles, id de champ)
  config: Record<string, string>;
  secret: string | null; // chiffré
  secretEntrant: string | null; // chiffré (webhook)
  sens: Sens;
  intervalleS: number;
  actif: boolean;
  liens: Record<string, string>; // externeId → id objet
  /**
   * Liens posés par rapprochement automatique (fiche du jeu trouvée par son nom) : l'outil ne fait que COMPLÉTER
   * les champs vides de la fiche, sans rien écraser ni effacer ni la renommer.
   */
  liensFaibles?: string[];
  /**
   * Ce que l'outil dit des enregistrements reliés par homonymie (nom, e-mail, SIRET), montré à l'administrateur qui
   * confirme ou sépare. Tant qu'un lien est faible : rien ne part vers l'outil pour cette fiche, et l'outil n'y inscrit
   * ni e-mail, ni contact, ni SIRET, ni adresse (contre-revue de l'audit, constat revue-jeu-1-2).
   */
  rapprochements?: Record<string, { nom: string; email?: string; siret?: string }>;
  /** Enregistrements qu'un administrateur a refusé de relier par le nom : fiche à part, plus jamais rapprochés. */
  separes?: string[];
  /** Enregistrements de l'outil dont la fiche a été effacée dans le jeu : plus jamais réimportés (identifiants seulement). */
  exclus?: string[];
  empreintes: Record<string, string>; // id objet → empreinte au dernier échange
  derniereSynchro: string | null;
  statut: 'jamais' | 'ok' | 'erreur';
  message: string | null;
  historique: { le: string; sens: 'entrant' | 'sortant'; crees: number; maj: number; erreurs: number; detail: string }[];
  creeLe: string;
  /** Temps réel (temps-reel.ts) : abonnement chez l'outil et chez Breizhcosystem ; absent : relu à son intervalle. */
  tempsReel?: EtatTempsReel;
}

/**
 * Temps réel d'un branchement. `prive` : adresse des avis, secret de l'abonnement et ressource suivie chez l'outil,
 * chiffrés comme les secrets ; le reste n'est qu'identifiants et dates.
 */
export interface EtatTempsReel {
  fournisseur: FournisseurTempsReel;
  /** Abonnement chez Breizhcosystem ; null : pas (ou plus) abonné. */
  abonnement: string | null;
  prive: string | null;
  /** Identifiant chez l'outil (webhook, canal, abonnement), et fin de validité chez lui. */
  externe: string | null;
  expire: string | null;
  etat: 'actif' | 'indisponible' | 'erreur';
  message: string | null;
  /** Prochain essai après un refus ou une panne. */
  essai: string | null;
  /** Ce que suit l'abonnement (base, feuille, classeur…) : s'il change, l'abonnement est refait. */
  suivi: string;
  curseur?: number;
  repere?: string;
  /** Dernière vérification que l'abonnement existe chez l'outil (Pipedrive). */
  verifie?: string;
}
interface PriveTempsReel { adresse: string; secret: string | null; utilisateur: string | null; ressource: string | null }

/** Ce que la synchro demande à Breizhcosystem pour le temps réel (LienNexus et le canal, application.ts). */
export interface ReseauTempsReel {
  /** Relié à Breizhcosystem (clé de liaison) ? */
  relie(): boolean;
  /** Origine de Breizhcosystem réglée : les adresses d'avis remises doivent y être. */
  origine(): string | null;
  /** Abonnements du relais temps réel (`/v0/relais/abonnements…`). */
  appel(methode: 'GET' | 'POST' | 'PUT' | 'DELETE', chemin: string, corps?: unknown): Promise<unknown>;
  /** Canal ouvert et entendu récemment ? */
  enLigne(): boolean;
  /** Un abonnement vient d'être créé : le canal s'ouvre s'il ne l'était pas. */
  relancer?(): void;
}
const ETATS_TEMPS_REEL = ['actif', 'indisponible', 'erreur'];
const estEtatTempsReel = (x: unknown): x is EtatTempsReel => typeof x === 'object' && x !== null && FOURNISSEURS_DU_TEMPS_REEL.includes((x as EtatTempsReel).fournisseur)
  && ETATS_TEMPS_REEL.includes((x as EtatTempsReel).etat) && typeof (x as EtatTempsReel).suivi === 'string';
const FOURNISSEURS_DU_TEMPS_REEL: readonly unknown[] = Object.values(TEMPS_REEL_DE);

export interface EtatSynchro {
  connecteurs: ConnecteurEnregistre[];
}

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const ID = /^cx-[a-f0-9]{12}$/;
/** Connecteurs « avancés » : regroupés à part dans le catalogue (techniques, sans connexion en un clic). */
const AVANCES: readonly TypeSource[] = ['mcp', 'webhook', 'rest'];
type Config = Readonly<Record<string, string>>;
/**
 * Réglages qui décident OÙ part le secret (hôte, adresse) : s'ils changent, le secret enregistré n'est jamais réutilisé
 * (il faut le saisir de nouveau ou se reconnecter).
 */
export const CHAMPS_DESTINATION: readonly string[] = ['url', 'urlEcriture', 'urlSortante', 'boutique', 'organisation', 'domaine', 'script'];
/**
 * Réglages qui donnent accès à eux seuls (adresse d'un webhook Make ou Zapier : qui la connaît déclenche le scénario) :
 * chiffrés au repos comme les secrets (état, sauvegardes, exports), jamais renvoyés en entier au navigateur.
 */
export const CHAMPS_CHIFFRES: readonly string[] = ['urlSortante'];
/** Forme d'une valeur chiffrée par le chiffreur des secrets (`v1.<iv>.<étiquette>.<données>`). */
export const VALEUR_CHIFFREE = /^v1\.[\w-]+\.[\w-]+\.[\w-]*$/;
/** Adresse montrée au navigateur : protocole et hôte seulement (« https://hook.eu1.make.com/… »). */
export const masquerAdresse = (v: string): string => {
  if (!v) return '';
  try { const u = new URL(v); return `${u.protocol}//${u.host}/…`; } catch { return '…'; }
};
const memeDestination = (source: TypeSource, a: Config, b: Config) =>
  ADAPTATEURS[source].champs.every((ch) => !CHAMPS_DESTINATION.includes(ch.id) || (a[ch.id] ?? '') === (b[ch.id] ?? ''));
/** Connexion « Se connecter avec… » en cours : en mémoire seulement, 30 min au plus ; `attente` ne sort jamais d'ici. */
interface ConnexionEnCours {
  source: TypeSource;
  fournisseur: FournisseurOAuth;
  attente: string;
  config: Record<string, string>;
  /** Fin de validité de l'attente chez le relais, puis de la référence `oauth:<id>`. */
  finAttente: number;
  expire: number;
  prochain: number;
  secret: string | null;
  /** Droits demandés à l'outil (lecture seule par défaut). */
  droits: DroitsOAuth;
}

/**
 * Libellés français des valeurs techniques d'un choix (P4, annexe B : pas d'anglais ni de jargon dans le parcours
 * principal). La valeur envoyée à l'outil ne change pas ; seul l'affichage est traduit.
 */
export const LIBELLES_CHOIX: Readonly<Record<string, string>> = {
  companies: 'Entreprises', contacts: 'Contacts', deals: 'Affaires', clients: 'Clients', fournisseurs: 'Fournisseurs', prospects: 'Prospects',
  produits: 'Produits', accounts: 'Comptes (entreprises)', customers: 'Clients', vendors: 'Fournisseurs', items: 'Articles', invoices: 'Factures',
  products: 'Produits', orders: 'Commandes', organizations: 'Entreprises', persons: 'Contacts',
};

/** « Toutes les 5 minutes », « Toutes les minutes », « Toutes les 30 secondes ». */
export function frequence(intervalleS: number): string {
  if (intervalleS < 60) return `Toutes les ${intervalleS} secondes`;
  const h = intervalleS / 3600;
  if (Number.isInteger(h) && h >= 1) return h === 1 ? 'Toutes les heures' : `Toutes les ${h} heures`;
  const m = Math.round(intervalleS / 60);
  return m === 1 ? 'Toutes les minutes' : `Toutes les ${m} minutes`;
}

export class Synchro {
  #connecteurs = new Map<string, ConnecteurEnregistre>();
  /** Signatures d'entrée déjà acceptées (empreinte → fin de validité, ms) : une requête signée rejouée est refusée. */
  #signaturesVues = new Map<string, number>();
  #monde: Monde;
  #chiffreur: Chiffreur;
  #f: Recuperateur;
  #changement: () => void;
  #enCours = new Set<string>();
  /** Connexions Microsoft en cours (code d'appareil) : en mémoire seulement, 30 min au plus. */
  #appareils = new Map<string, { config: Record<string, string>; deviceCode: string; expire: number; prochain: number; intervalle: number; secret: string | null }>();
  /** Connexions « Se connecter avec… » en cours (relais de Breizhcosystem). */
  #oauth = new Map<string, ConnexionEnCours>();
  #relais: RelaisOAuth;
  /** Renouvellements en cours ou récents, par empreinte du jeton de rafraîchissement (une rotation à la fois). */
  #renouvellements = new Map<string, Promise<ConnexionOAuth>>();
  #attentePousse: NodeJS.Timeout | null = null;
  /** Temps réel : Breizhcosystem (branché par l'application), relectures regroupées, entretien en cours. */
  #reseau: ReseauTempsReel | null = null;
  #regroupes = new Map<string, NodeJS.Timeout>();
  #entretien: Promise<void> | null = null;
  /** Un entretien a été demandé pendant qu'un autre tournait : refait juste après (nouveau branchement, réglage changé). */
  #entretienEncore = false;

  constructor(monde: Monde, chiffreur: Chiffreur, o: { fetch?: Recuperateur; etat?: EtatSynchro | null; changement?: () => void; relais?: RelaisOAuth } = {}) {
    this.#monde = monde;
    this.#chiffreur = chiffreur;
    this.#f = o.fetch ?? recuperateurProtege;
    this.#relais = o.relais ?? new RelaisOAuth({ adresse: () => null, fetch: this.#f });
    this.#changement = o.changement ?? (() => {});
    for (const c of o.etat?.connecteurs ?? []) {
      if (!ID.test(c.id) || !ADAPTATEURS[c.source]) continue;
      // réglages chiffrés au repos : en clair en mémoire seulement (une adresse encore en clair, d'avant, est gardée
      // telle quelle et sera chiffrée au prochain enregistrement)
      for (const k of CHAMPS_CHIFFRES) {
        const v = c.config[k];
        if (!v || !VALEUR_CHIFFREE.test(v)) continue;
        try { c.config = { ...c.config, [k]: chiffreur.dechiffrer(v) }; } catch {
          c.config = { ...c.config, [k]: '' };
          c.statut = 'erreur';
          c.message = 'Adresse du webhook sortant illisible (clé des secrets différente) : supprimez ce branchement et recréez-le.';
        }
      }
      if (c.tempsReel && !estEtatTempsReel(c.tempsReel)) delete c.tempsReel;
      this.#connecteurs.set(c.id, c);
    }
  }

  /** État à enregistrer : les réglages de CHAMPS_CHIFFRES y sont chiffrés comme les secrets. */
  instantane(): EtatSynchro {
    return {
      connecteurs: [...this.#connecteurs.values()].map((c) => {
        const aChiffrer = CHAMPS_CHIFFRES.filter((k) => c.config[k]);
        if (!aChiffrer.length) return c;
        return { ...c, config: { ...c.config, ...Object.fromEntries(aChiffrer.map((k) => [k, this.#chiffreur.chiffrer(c.config[k] as string)])) } };
      }),
    };
  }

  #admin(p: Profil) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
  }

  #trouver(id: unknown): ConnecteurEnregistre {
    const c = typeof id === 'string' && ID.test(id) ? this.#connecteurs.get(id) : undefined;
    if (!c) throw new ErreurApi(404, 'introuvable');
    return c;
  }

  #secret(c: ConnecteurEnregistre): string | null {
    return c.secret ? this.#chiffreur.dechiffrer(c.secret) : null;
  }

  /**
   * Catalogue des connecteurs. `oauth` : « Se connecter avec… » proposé pour cet outil (null si l'adresse de Breizhcosystem
   * n'est pas réglée, ou si le relais a dit, lors d'un clic précédent, que l'outil n'est pas encore ouvert).
   * Aucun appel à Breizhcosystem ici : le relais n'est contacté qu'après un clic sur « Se connecter avec… » (rgpd-10).
   */
  async catalogue() {
    const regle = this.#relais.regle();
    const connus = this.#relais.fournisseursConnus();
    const ouvert = (f: FournisseurOAuth) => regle && (connus === null || connus.includes(f));
    return Object.values(ADAPTATEURS).map((a) => {
      const f = FOURNISSEUR_DE[a.id];
      return {
        id: a.id, nom: a.nom, categorie: a.categorie, description: a.description, couleur: a.couleur, etapes: a.etapes,
        champs: a.champs.map((c) => (c.choix ? { ...c, options: c.choix.map((v) => ({ valeur: v, libelle: LIBELLES_CHOIX[v] ?? v })) } : c)),
        lecture: a.lecture, ecriture: a.ecriture, script: a.id === 'sheets' ? SCRIPT_SHEETS : null,
        oauthPossible: Boolean(f),
        avance: AVANCES.includes(a.id),
        oauth: f && ouvert(f) ? { fournisseur: f, nom: NOM_FOURNISSEUR[f], champ: PARAMETRE_OAUTH[f]?.champ ?? null } : null,
      };
    });
  }

  #vue(c: ConnecteurEnregistre) {
    return {
      id: c.id, source: c.source, nom: c.nom, typeObjet: c.typeObjet, roles: c.roles, mapping: c.mapping,
      config: { ...c.config, ...Object.fromEntries(CHAMPS_CHIFFRES.filter((k) => c.config[k]).map((k) => [k, masquerAdresse(c.config[k] as string)])) },
      aSecret: c.secret !== null, oauth: this.#fournisseurConnecte(c), sens: c.sens, intervalleS: c.intervalleS, actif: c.actif, liens: Object.keys(c.liens).length,
      aConfirmer: (c.liensFaibles ?? []).filter((x) => c.liens[x]).length,
      derniereSynchro: c.derniereSynchro, statut: c.statut, message: c.message, historique: c.historique.slice(-10).reverse(),
      entree: ADAPTATEURS[c.source].lecture === 'reception' ? `/api/v1/entrant/${c.id}` : null,
      // « En temps réel » quand l'abonnement vit, sinon « Toutes les N minutes » (relecture à son intervalle)
      tempsReel: c.tempsReel ? { vivant: this.#tempsReelVivant(c), etat: c.tempsReel.etat, message: c.tempsReel.message } : null,
      frequence: ADAPTATEURS[c.source].lecture !== 'appel' ? null : this.#tempsReelVivant(c) ? 'En temps réel' : frequence(c.intervalleS),
    };
  }

  /** Fournisseur d'une connexion « Se connecter avec… » (pour « Se reconnecter »), jamais le jeton. */
  #fournisseurConnecte(c: ConnecteurEnregistre): FournisseurOAuth | null {
    if (!c.secret || !FOURNISSEUR_DE[c.source]) return null;
    try { return lireEnveloppe(this.#secret(c))?.fournisseur ?? null; } catch { return null; }
  }

  lister(p: Profil) {
    this.#admin(p);
    return [...this.#connecteurs.values()].map((c) => this.#vue(c));
  }

  /** Statut résumé pour la barre (sans détail sensible). */
  resume() {
    const liste = [...this.#connecteurs.values()].filter((c) => c.actif);
    return { actifs: liste.length, enErreur: liste.filter((c) => c.statut === 'erreur').length, derniere: liste.map((c) => c.derniereSynchro).filter(Boolean).sort().at(-1) ?? null };
  }

  #lireConfig(source: TypeSource, d: Record<string, unknown>, ancienne: Record<string, string> = {}) {
    const a = ADAPTATEURS[source];
    const config: Record<string, string> = { ...ancienne };
    let secret: string | null | undefined;
    for (const ch of a.champs) {
      const v = d[ch.id];
      if (v === undefined) continue;
      if (typeof v !== 'string' || v.length > 4000) throw new ErreurApi(400, 'config_invalide', ch.libelle);
      if (ch.choix && v && !ch.choix.includes(v)) throw new ErreurApi(400, 'config_invalide', ch.libelle);
      // adresse masquée renvoyée telle quelle par le navigateur : l'adresse enregistrée est gardée
      if (CHAMPS_CHIFFRES.includes(ch.id) && ancienne[ch.id] && v.trim() === masquerAdresse(ancienne[ch.id] as string)) continue;
      if (ch.secret) secret = v.trim() || null;
      else config[ch.id] = v.trim();
    }
    // secret obtenu par « Se connecter à Microsoft » : le navigateur ne connaît que la référence de la connexion
    let appareil: string | null = null;
    const ref = secret ? /^appareil:([A-Za-z0-9_-]{22})$/.exec(secret) : null;
    if (ref) {
      appareil = ref[1] as string;
      const a = this.#appareils.get(appareil);
      if (!a?.secret || a.expire < Date.now()) throw new ErreurApi(400, 'connexion_requise', 'Connectez-vous d’abord (bouton « Se connecter à Microsoft »).');
      secret = a.secret;
    }
    // secret obtenu par « Se connecter avec… » (relais de Breizhcosystem) : idem, une référence `oauth:<id>`
    let oauth: string | null = null;
    const refO = secret && !ref ? /^oauth:([A-Za-z0-9_-]{22})$/.exec(secret) : null;
    if (refO) {
      oauth = refO[1] as string;
      const o = this.#oauth.get(oauth);
      const f = FOURNISSEUR_DE[source];
      if (!o?.secret || o.expire < Date.now() || o.source !== source) throw new ErreurApi(400, 'connexion_requise', `Connectez-vous d’abord (bouton « Se connecter avec ${f ? NOM_FOURNISSEUR[f] : 'l’outil'} »).`);
      secret = o.secret;
    } else if (secret && !ref && ressembleEnveloppe(secret)) {
      throw new ErreurApi(400, 'config_invalide', 'Jeton invalide.');
    }
    return { config, secret, appareil, oauth };
  }

  /**
   * Appel d'un adaptateur avec le secret du connecteur. Connexion « Se connecter avec… » : jeton renouvelé par le relais
   * s'il expire dans moins de 2 minutes, ou une fois si l'outil répond 401 ; la rotation passe par `ctx.majSecret`.
   * Un jeton collé (mode avancé) est transmis tel quel, comme avant.
   */
  async #avecSecret<T>(config: Config, secret: string | null, ctx: ContexteAdaptateur, appel: (cfg: Config, secret: string | null, ctx: ContexteAdaptateur) => Promise<T>): Promise<T> {
    const c = lireEnveloppe(secret);
    if (!c) return appel(config, secret, ctx);
    let courante = c;
    let renouvele = false;
    const renouveler = async () => {
      courante = await this.#rafraichir(courante);
      renouvele = true;
      ctx.majSecret(enveloppe(courante));
    };
    if (bientotExpire(courante) && courante.rafraichissement) await renouveler();
    const sansRotation: ContexteAdaptateur = { ...ctx, majSecret: () => {} }; // l'adaptateur ne gère pas ces jetons
    try {
      return await appel(configAvecConnexion(config, courante), courante.acces, sansRotation);
    } catch (e) {
      if (!(e instanceof ErreurSortante) || e.statut !== 401 || renouvele || !courante.rafraichissement) throw e;
      await renouveler();
      return appel(configAvecConnexion(config, courante), courante.acces, sansRotation);
    }
  }

  /**
   * Renouvellement par le relais ; deux appels simultanés avec le même jeton n'en font qu'un (rotation sûre). Les
   * branchements qui partagent la connexion renouvelée (Shopify : un seul jeton par boutique) reçoivent les nouveaux
   * jetons en même temps : sinon l'un d'eux présenterait plus tard l'ancien, et le relais couperait la connexion.
   */
  #rafraichir(c: ConnexionOAuth): Promise<ConnexionOAuth> {
    const cle = createHash('sha256').update(`${c.fournisseur}\n${c.rafraichissement ?? ''}`).digest('base64url');
    const deja = this.#renouvellements.get(cle);
    if (deja) return deja;
    const p = this.#relais.rafraichir(c).then(
      (r) => {
        this.#remplacerJetons(r, (x) => x.rafraichissement !== null && x.rafraichissement === c.rafraichissement);
        setTimeout(() => this.#renouvellements.delete(cle), 120_000).unref?.();
        return r;
      },
      (e: unknown) => { this.#renouvellements.delete(cle); throw e; },
    );
    if (this.#renouvellements.size > 200) this.#renouvellements.clear();
    this.#renouvellements.set(cle, p);
    return p;
  }

  /**
   * Donne les jetons de `neuve` aux branchements du même outil dont la connexion répond à `lesquels` (chacun garde les
   * droits qu'il a demandés). Sert à la rotation d'une connexion partagée, et à Shopify, qui ne garde qu'UN jeton
   * expirant par boutique : une nouvelle connexion à la boutique retire aussitôt celui des autres branchements.
   */
  #remplacerJetons(neuve: ConnexionOAuth, lesquels: (c: ConnexionOAuth) => boolean) {
    const { droits: _droits, ...jetons } = neuve;
    /** Nouveau secret du branchement dont le secret actuel est `secret` ; null s'il n'est pas concerné. */
    const remplace = (secret: string | null): string | null => {
      const c = lireEnveloppe(secret);
      if (!c || c.fournisseur !== neuve.fournisseur || !lesquels(c) || (c.acces === neuve.acces && c.rafraichissement === neuve.rafraichissement)) return null;
      return enveloppe({ ...jetons, ...(c.droits ? { droits: c.droits } : {}) });
    };
    let change = false;
    for (const x of this.#connecteurs.values()) {
      const s = remplace(this.#secretDechiffre(x));
      if (s === null) continue;
      x.secret = this.#chiffreur.chiffrer(s);
      change = true;
    }
    // connexions tout juste obtenues, pas encore enregistrées dans un branchement (en mémoire seulement)
    for (const a of this.#oauth.values()) a.secret = remplace(a.secret) ?? a.secret;
    if (change) this.#changement();
  }

  /** Contexte d'un appel de réglage (test, listes) : un secret renouvelé va à la connexion en cours ou au connecteur. */
  #contexteReglage(appareil: string | null, oauth: string | null, existant: ConnecteurEnregistre | null, secretFourni: boolean): ContexteAdaptateur {
    return { majSecret: (s) => {
      const a = appareil ? this.#appareils.get(appareil) : oauth ? this.#oauth.get(oauth) : undefined;
      if (a) a.secret = s;
      else if (existant && !secretFourni) { existant.secret = this.#chiffreur.chiffrer(s); this.#changement(); }
    } };
  }

  /**
   * Secret à utiliser pour un essai (aperçu, listes) : celui fourni, sinon celui du connecteur enregistré, mais
   * SEULEMENT pour le même outil et la même destination (un secret enregistré ne part jamais vers une autre adresse).
   */
  #secretReutilisable(source: TypeSource, existant: ConnecteurEnregistre | null, config: Config, secret: string | null | undefined): string | null {
    if (existant && existant.source !== source) throw new ErreurApi(400, 'source_differente', 'Ce connecteur est branché sur un autre outil : créez-en un nouveau.');
    if (secret !== undefined) return secret;
    if (!existant) return null;
    if (!memeDestination(source, config, existant.config)) throw new ErreurApi(400, 'secret_a_ressaisir', 'L’adresse a changé : saisissez de nouveau la clé (ou reconnectez-vous). Une clé enregistrée ne part jamais vers une nouvelle adresse.');
    return this.#secret(existant);
  }

  /** Teste la connexion et propose la correspondance des champs. Rien n'est enregistré. */
  async apercu(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d) || typeof d.source !== 'string' || !(d.source in ADAPTATEURS)) throw new ErreurApi(400, 'source_inconnue');
    const source = d.source as TypeSource;
    const existant = typeof d.id === 'string' ? this.#trouver(d.id) : null;
    const { config, secret, appareil, oauth } = this.#lireConfig(source, estObj(d.config) ? d.config : {}, existant?.config);
    const t = typeof d.typeObjet === 'string' ? defType(this.#monde.univers, d.typeObjet) : undefined;
    if (!t || t.masque || t.famille === 'organisation') throw new ErreurApi(400, 'type_inconnu', 'Choisissez ce que contient l’outil (clients, fournisseurs, employés…).');
    const cle = this.#secretReutilisable(source, existant, config, secret);
    if (ADAPTATEURS[source].lecture === 'reception') {
      return { enregistrements: 0, champs: [], apercu: [], mapping: {}, cibles: this.#cibles(t), message: 'Ce connecteur reçoit les données : envoyez un premier enregistrement depuis votre scénario, ou importez le modèle.' };
    }
    try {
      // précision de l'adaptateur sur ce qui est lu (ex. lequel des tableaux d'une base Notion), montrée avec le résultat
      const precisions: string[] = [];
      const ctx: ContexteAdaptateur = { ...this.#contexteReglage(appareil, oauth, existant, secret !== undefined), avis: (texte) => { precisions.push(texte.slice(0, 300)); } };
      const lignes = await this.#avecSecret(config, cle, ctx, (cfg, s, x) => ADAPTATEURS[source].lire(cfg, s, this.#f, x));
      const champs = [...new Set(lignes.slice(0, 200).flatMap((l) => Object.keys(l.champs)))].slice(0, 80);
      return { enregistrements: lignes.length, champs, apercu: lignes.slice(0, 5).map((l) => l.champs), mapping: proposerMapping(champs, t), cibles: this.#cibles(t), message: null, precision: precisions.at(-1) ?? null };
    } catch (e) {
      if (e instanceof ErreurReglage) throw new ErreurApi(422, `reglage_invalide${e.champ ? `:${e.champ}` : ''}`, e.message);
      throw new ErreurApi(502, 'connexion_impossible', e instanceof ErreurSortante ? e.message : 'Connexion impossible.');
    }
  }

  /** Secret renouvelé par le service pendant un appel (ex. rotation Microsoft) : rechiffré et enregistré. */
  #contexte(c: ConnecteurEnregistre, aussi?: (s: string) => void): ContexteAdaptateur {
    return { majSecret: (s) => { c.secret = this.#chiffreur.chiffrer(s); aussi?.(s); this.#changement(); } };
  }

  /** « Se connecter à Microsoft » : demande un code d'appareil avec l'application inscrite PAR L'ENTREPRISE. */
  async connexionMicrosoft(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const { config } = this.#lireConfig('excel365', estObj(d.config) ? d.config : {});
    const maintenant = Date.now();
    for (const [k, a] of this.#appareils) if (a.expire < maintenant) this.#appareils.delete(k);
    if (this.#appareils.size >= 20) throw new ErreurApi(429, 'trop_de_connexions', 'Trop de connexions en cours : réessayez dans quelques minutes.');
    try {
      const dem = await demarrerConnexionMicrosoft(config, this.#f);
      const id = randomBytes(16).toString('base64url');
      this.#appareils.set(id, { config, deviceCode: dem.deviceCode, expire: maintenant + Math.max(dem.expireDans, 1800) * 1000, prochain: 0, intervalle: dem.intervalle * 1000, secret: null });
      return { id, code: dem.code, url: dem.url, expireDans: dem.expireDans, intervalle: dem.intervalle };
    } catch (e) {
      throw new ErreurApi(502, 'connexion_impossible', e instanceof ErreurSortante ? e.message : 'Connexion Microsoft impossible.');
    }
  }

  /** Suivi de la connexion : « attente » tant que la personne n'a pas validé sur la page Microsoft. */
  async suivreMicrosoft(p: Profil, id: unknown) {
    this.#admin(p);
    const a = typeof id === 'string' ? this.#appareils.get(id) : undefined;
    if (!a || a.expire < Date.now()) throw new ErreurApi(404, 'introuvable', 'Connexion expirée : relancez « Se connecter à Microsoft ».');
    if (a.secret) return { statut: 'connecte', jeton: `appareil:${id as string}` };
    if (Date.now() < a.prochain) return { statut: 'attente' };
    a.prochain = Date.now() + a.intervalle;
    try {
      const r = await suivreConnexionMicrosoft(a.config, a.deviceCode, this.#f);
      if (r.statut === 'connecte') { a.secret = r.secret; return { statut: 'connecte', jeton: `appareil:${id as string}` }; }
      if (r.statut === 'attente') return { statut: 'attente' };
      this.#appareils.delete(id as string);
      return { statut: r.statut, message: r.message };
    } catch (e) {
      throw new ErreurApi(502, 'connexion_impossible', e instanceof ErreurSortante ? e.message : 'Connexion Microsoft impossible.');
    }
  }

  // ---------------------------------------------------------------- « Se connecter avec… » (relais de Breizhcosystem)

  /**
   * Démarre une connexion : renvoie l'adresse de la page de connexion DE L'OUTIL (à ouvrir dans un nouvel onglet) et une
   * référence. Le secret d'attente du relais reste ici. Shopify : adresse en .myshopify.com ; WooCommerce : site https
   * vérifié par l'anti-SSRF. `retour` : adresse du jeu, pour le lien « Revenir à Living Business » de la page de fin.
   */
  async demarrerOAuth(p: Profil, d: unknown, retour: string | null = null) {
    this.#admin(p);
    if (!estObj(d) || typeof d.source !== 'string' || !(d.source in ADAPTATEURS)) throw new ErreurApi(400, 'source_inconnue');
    const source = d.source as TypeSource;
    const fournisseur = FOURNISSEUR_DE[source];
    if (!fournisseur || !(await this.#relais.fournisseurs()).includes(fournisseur)) throw new ErreurApi(409, 'oauth_indisponible', 'Connexion directe indisponible pour cet outil : utilisez une clé (mode avancé).');
    // réglages déjà saisis (boutique, objet…) ; aucun secret : il viendra de l'outil
    const brut: Record<string, unknown> = estObj(d.config) ? { ...d.config } : {};
    for (const ch of ADAPTATEURS[source].champs) if (ch.secret) delete brut[ch.id];
    const { config } = this.#lireConfig(source, brut);
    const param: { boutique?: string; site?: string; organisation?: string; retour?: string | null; droits?: DroitsOAuth } = {};
    if (fournisseur === 'dynamics') {
      const o = (config.organisation ?? '').trim().toLowerCase().replace(/\/+$/, '');
      if (!ORGANISATION_DYNAMICS.test(o)) throw new ErreurApi(400, 'organisation_invalide', 'Adresse de l’organisation Dynamics 365 : https://votre-organisation.crm4.dynamics.com');
      config.organisation = param.organisation = o;
    }
    if (retour && /^https?:\/\/[^/\s]{1,200}$/.test(retour)) param.retour = retour;
    if (fournisseur === 'shopify') {
      const b = (config.boutique ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const boutique = b && !b.includes('.') ? `${b}.myshopify.com` : b;
      if (!BOUTIQUE_SHOPIFY.test(boutique)) throw new ErreurApi(400, 'boutique_invalide', 'Adresse de la boutique : celle en .myshopify.com (Shopify → Paramètres → Domaines), ex. ma-boutique.myshopify.com.');
      config.boutique = param.boutique = boutique;
    }
    if (fournisseur === 'woocommerce') {
      const u = await verifierUrl(config.boutique).catch((e: Error) => { throw new ErreurApi(400, 'site_invalide', `Adresse du site WooCommerce : ${e.message}`); });
      config.boutique = param.site = `${u.origin}${u.pathname.replace(/\/(wp-json|wp-admin)(\/.*)?$/, '').replace(/\/+$/, '')}`;
    }
    // droits demandés à l'outil : lecture seule, sauf synchro qui écrit dans l'outil (et si l'outil sait écrire)
    const droits: DroitsOAuth = d.droits === 'ecriture' && ADAPTATEURS[source].ecriture ? 'ecriture' : 'lecture';
    param.droits = droits;
    const maintenant = Date.now();
    for (const [k, a] of this.#oauth) if (a.expire < maintenant) this.#oauth.delete(k);
    if (this.#oauth.size >= 20) throw new ErreurApi(429, 'trop_de_connexions', 'Trop de connexions en cours : réessayez dans quelques minutes.');
    try {
      const r = await this.#relais.demarrer(fournisseur, param);
      const id = randomBytes(16).toString('base64url');
      this.#oauth.set(id, { source, fournisseur, attente: r.attente, config, finAttente: r.expire, expire: maintenant + 30 * 60_000, prochain: 0, secret: null, droits });
      return { id, url: r.url, fournisseur, nom: NOM_FOURNISSEUR[fournisseur], verification: r.verification };
    } catch (e) {
      const statut = e instanceof ErreurSortante && e.statut === 400 ? 400 : 502;
      throw new ErreurApi(statut, 'connexion_impossible', e instanceof ErreurSortante ? e.message : 'Connexion impossible.');
    }
  }

  /** Suivi (toutes les 2 s) : « attente » tant que la personne n'a pas accepté ; puis la référence `oauth:<id>`. */
  async suivreOAuth(p: Profil, id: unknown) {
    this.#admin(p);
    const a = typeof id === 'string' ? this.#oauth.get(id) : undefined;
    const nom = a ? NOM_FOURNISSEUR[a.fournisseur] : '';
    if (!a || a.expire < Date.now()) throw new ErreurApi(404, 'introuvable', `Connexion expirée : relancez « Se connecter avec${nom ? ` ${nom}` : '…'} ».`);
    const connecte = () => ({ statut: 'connecte', jeton: `oauth:${id as string}`, nom, compte: (() => { const c = lireEnveloppe(a.secret); return c ? compteConnecte(c) : null; })() });
    if (a.secret) return connecte();
    if (a.finAttente < Date.now()) { this.#oauth.delete(id as string); return { statut: 'expire', message: `La connexion a expiré : relancez « Se connecter avec ${nom} ».` }; }
    if (Date.now() < a.prochain) return { statut: 'attente' };
    a.prochain = Date.now() + 1500;
    try {
      const r = await this.#relais.retrait(a.fournisseur, a.attente);
      if (r.statut === 'attente') return { statut: 'attente' };
      if (r.statut === 'connecte') {
        const connexion: ConnexionOAuth = { ...r.connexion, droits: a.droits };
        a.secret = enveloppe(connexion);
        // Shopify vient de retirer le jeton des autres branchements de cette boutique : ils reprennent celui-ci
        const boutique = connexion.fournisseur === 'shopify' ? connexion.extra.boutique : undefined;
        if (boutique && connexion.rafraichissement) this.#remplacerJetons(connexion, (x) => x.extra.boutique === boutique);
        return connecte();
      }
      this.#oauth.delete(id as string);
      return { statut: r.statut, message: r.message };
    } catch (e) {
      throw new ErreurApi(502, 'connexion_impossible', e instanceof ErreurSortante ? e.message : 'Relais de connexion injoignable.');
    }
  }

  /** « Annuler » : la connexion en cours est oubliée (le relais l'efface de lui-même au bout de 10 minutes). */
  annulerOAuth(p: Profil, id: unknown) {
    this.#admin(p);
    if (typeof id === 'string') this.#oauth.delete(id);
    return { ok: true };
  }

  /** Valeurs possibles d'un champ (bases et tables Airtable, bases de données Notion…), lues dans l'outil connecté. */
  async choix(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d) || typeof d.source !== 'string' || !(d.source in ADAPTATEURS)) throw new ErreurApi(400, 'source_inconnue');
    const source = d.source as TypeSource;
    const a = ADAPTATEURS[source];
    const champ = typeof d.champ === 'string' ? a.champs.find((c) => c.id === d.champ && c.liste) : undefined;
    const lister = a.choix;
    if (!champ || !lister) throw new ErreurApi(400, 'champ_invalide');
    const existant = typeof d.id === 'string' ? this.#trouver(d.id) : null;
    const { config, secret, appareil, oauth } = this.#lireConfig(source, estObj(d.config) ? d.config : {}, existant?.config);
    const cle = this.#secretReutilisable(source, existant, config, secret);
    try {
      const options = await this.#avecSecret(config, cle, this.#contexteReglage(appareil, oauth, existant, secret !== undefined), (cfg, s, x) => lister(champ.id, cfg, s, this.#f, x));
      return { options: options.slice(0, 500) };
    } catch (e) {
      throw new ErreurApi(502, 'connexion_impossible', e instanceof ErreurSortante ? e.message : 'Liste impossible à obtenir.');
    }
  }

  /** Outils exposés par un serveur MCP (aide au réglage). */
  async outilsMcp(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const { config, secret } = this.#lireConfig('mcp', estObj(d.config) ? d.config : {});
    try {
      const r = await appelMcp(config, secret ?? null, this.#f, 'tools/list', {});
      const outils = Array.isArray(r.tools) ? r.tools : [];
      return outils.slice(0, 200).map((o) => ({ nom: aplatir((o as Record<string, unknown>).name), description: aplatir((o as Record<string, unknown>).description).slice(0, 300) }));
    } catch (e) {
      throw new ErreurApi(502, 'connexion_impossible', e instanceof ErreurSortante ? e.message : 'Serveur MCP injoignable.');
    }
  }

  #cibles(t: NonNullable<ReturnType<typeof defType>>) {
    return [
      { id: NOM, libelle: 'Nom (obligatoire)' },
      ...(t.famille === 'tiers' ? [{ id: ROLES, libelle: 'Rôles (client, fournisseur…)' }] : []),
      ...t.champs.map((c) => ({ id: c.id, libelle: c.libelle })),
    ];
  }

  #lireReglages(d: Record<string, unknown>, base: Partial<ConnecteurEnregistre>) {
    const typeObjet = d.typeObjet === undefined ? base.typeObjet : d.typeObjet;
    const t = typeof typeObjet === 'string' ? defType(this.#monde.univers, typeObjet) : undefined;
    if (!t || t.masque || t.famille === 'organisation') throw new ErreurApi(400, 'type_inconnu');
    const cibles = new Set(this.#cibles(t).map((c) => c.id));
    let mapping = base.mapping ?? {};
    if (d.mapping !== undefined) {
      if (!estObj(d.mapping)) throw new ErreurApi(400, 'mapping_invalide');
      mapping = {};
      const vues = new Set<string>();
      for (const [ext, cible] of Object.entries(d.mapping)) {
        if (cible === null || cible === '') continue;
        if (typeof cible !== 'string' || !cibles.has(cible) || ext.length > 200) throw new ErreurApi(400, 'mapping_invalide', String(cible));
        if (vues.has(cible)) throw new ErreurApi(400, 'mapping_invalide', `Cible en double : ${cible}`);
        vues.add(cible);
        mapping[ext] = cible;
      }
    }
    if (!Object.values(mapping).includes(NOM) && ADAPTATEURS[(d.source ?? base.source) as TypeSource].lecture === 'appel') throw new ErreurApi(400, 'mapping_invalide', 'Choisissez le champ qui donne le nom.');
    const roles = d.roles === undefined ? (base.roles ?? []) : Array.isArray(d.roles) ? d.roles.filter((r): r is string => typeof r === 'string' && this.#monde.univers.roles.some((x) => x.id === r)) : [];
    const sens = d.sens === undefined ? (base.sens ?? 'lecture') : ['lecture', 'deux', 'ecriture'].includes(d.sens as string) ? (d.sens as Sens) : null;
    if (!sens) throw new ErreurApi(400, 'sens_invalide');
    const intervalle = d.intervalleS === undefined ? (base.intervalleS ?? 300) : Number(d.intervalleS);
    if (!Number.isInteger(intervalle) || intervalle < 15 || intervalle > 86_400) throw new ErreurApi(400, 'intervalle_invalide', 'Entre 15 secondes et 24 heures.');
    const nom = d.nom === undefined ? base.nom : typeof d.nom === 'string' && d.nom.trim() && d.nom.length <= 80 ? d.nom.trim() : null;
    if (!nom) throw new ErreurApi(400, 'nom_invalide');
    return { typeObjet: t.id, mapping, roles, sens, intervalleS: intervalle, nom, actif: d.actif === undefined ? (base.actif ?? true) : d.actif === true };
  }

  #secretDechiffre(c: ConnecteurEnregistre): string | null {
    try { return this.#secret(c); } catch { return null; }
  }

  /** Une connexion « Se connecter avec… » obtenue en lecture seule n'écrit pas dans l'outil : il faut se reconnecter. */
  #verifierDroits(sens: Sens, secret: string | null | undefined) {
    if (sens !== 'lecture' && lireEnveloppe(secret)?.droits === 'lecture') {
      throw new ErreurApi(409, 'droits_lecture', 'Connexion en lecture seule : pour écrire dans l’outil, reconnectez-vous en choisissant « Dans les deux sens » avant « Se connecter avec… ».');
    }
  }

  creer(p: Profil, d: unknown) {
    this.#admin(p);
    if (!estObj(d) || typeof d.source !== 'string' || !(d.source in ADAPTATEURS)) throw new ErreurApi(400, 'source_inconnue');
    if (this.#connecteurs.size >= 50) throw new ErreurApi(409, 'trop_de_connecteurs');
    const source = d.source as TypeSource;
    const { config, secret, appareil, oauth } = this.#lireConfig(source, estObj(d.config) ? d.config : {});
    // champs du mode avancé inutiles avec « Se connecter avec… », et inversement
    const ignore = lireEnveloppe(secret) ? 'cle' : 'oauth';
    for (const ch of ADAPTATEURS[source].champs) if (ch.obligatoire && !ch.secret && !config[ch.id] && ch.mode !== ignore) throw new ErreurApi(400, 'config_incomplete', ch.libelle);
    if (ADAPTATEURS[source].champs.some((ch) => ch.secret && ch.obligatoire) && !secret) throw new ErreurApi(400, 'config_incomplete', 'Jeton manquant.');
    const r = this.#lireReglages(d, { source, nom: ADAPTATEURS[source].nom });
    this.#verifierDroits(r.sens, secret);
    const entrant = ADAPTATEURS[source].lecture === 'reception' ? randomBytes(24).toString('base64url') : null;
    const c: ConnecteurEnregistre = {
      id: `cx-${randomUUID().replace(/-/g, '').slice(0, 12)}`, source, ...r, config,
      secret: secret ? this.#chiffreur.chiffrer(secret) : entrant ? this.#chiffreur.chiffrer(entrant) : null,
      secretEntrant: entrant ? this.#chiffreur.chiffrer(entrant) : null,
      liens: {}, empreintes: {}, derniereSynchro: null, statut: 'jamais', message: null, historique: [], creeLe: this.#monde.maintenant().toISOString(),
    };
    this.#connecteurs.set(c.id, c);
    if (appareil) this.#appareils.delete(appareil);
    if (oauth) this.#oauth.delete(oauth);
    this.#changement();
    // temps réel : l'abonnement se crée tout de suite chez l'outil (sinon au prochain entretien)
    if (this.#eligible(c) && this.#reseau?.relie()) void this.entretenirTempsReel();
    return { ...this.#vue(c), secretEntrant: entrant, ...(entrant ? { cleEnvois: cleEnvois(entrant) } : {}) };
  }

  modifier(p: Profil, id: unknown, d: unknown) {
    this.#admin(p);
    const c = this.#trouver(id);
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const { config, secret, appareil, oauth } = this.#lireConfig(c.source, estObj(d.config) ? d.config : {}, c.config);
    const r = this.#lireReglages(d, c);
    this.#verifierDroits(r.sens, secret !== undefined ? secret : this.#secretDechiffre(c));
    // nouvelle destination sans nouvelle clé : la clé enregistrée est effacée (jamais envoyée à la nouvelle adresse)
    const destinationChangee = !memeDestination(c.source, config, c.config);
    Object.assign(c, r, { config });
    if (secret !== undefined) c.secret = secret ? this.#chiffreur.chiffrer(secret) : null;
    else if (destinationChangee && c.secret) { c.secret = null; c.statut = 'erreur'; c.message = 'Adresse changée : saisissez de nouveau la clé (ou reconnectez-vous).'; }
    if (appareil) this.#appareils.delete(appareil);
    if (oauth) this.#oauth.delete(oauth);
    this.#changement();
    // temps réel : abonnement refait (autre base, autre feuille…) ou retiré (pause) sans attendre le prochain entretien
    if ((c.tempsReel || this.#eligible(c)) && this.#reseau?.relie()) void this.entretenirTempsReel();
    return this.#vue(c);
  }

  /**
   * Supprime le connecteur (son secret disparaît de l'état tout de suite), puis coupe l'accès : le relais de Breizhcosystem
   * cesse de renouveler la connexion et la révoque chez l'outil quand il faut le secret de l'application ; sinon le jeu
   * la révoque lui-même là où c'est possible sans ce secret (contre-revue de l'audit, constat revue-reseau-11).
   * `acces` : « revoque » ; « a_retirer » (à faire chez l'outil : clé collée, outil sans révocation, ou échec) ;
   * « garde » (un autre branchement utilise encore cet outil, ou la même connexion : rien n'est retiré chez lui) ; null
   * (rien à révoquer : clé d'entrée créée par le jeu).
   */
  async supprimer(p: Profil, id: unknown): Promise<{ ok: true; acces: AccesApresSuppression; outil: string }> {
    this.#admin(p);
    const c = this.#trouver(id);
    let secret: string | null = null;
    try { secret = c.secret ? this.#chiffreur.dechiffrer(c.secret) : null; } catch { secret = null; }
    this.#connecteurs.delete(c.id);
    this.#changement();
    // temps réel : l'abonnement est supprimé chez l'outil tant que le jeton vaut encore, puis chez Breizhcosystem
    const regroupe = this.#regroupes.get(c.id);
    if (regroupe) { clearTimeout(regroupe); this.#regroupes.delete(c.id); }
    await this.#arreterTempsReel(c, secret);
    const a = ADAPTATEURS[c.source];
    const connexion = lireEnveloppe(secret);
    const outil = connexion ? NOM_FOURNISSEUR[connexion.fournisseur] : a.nom;
    if (!secret || a.lecture === 'reception') return { ok: true, acces: null, outil };
    if (!connexion) return { ok: true, acces: 'a_retirer', outil };
    // un autre branchement relié au même outil : révoquer chez l'outil le couperait aussi (même autorisation)
    const memeOutil = [...this.#connecteurs.values()].map((x) => lireEnveloppe(this.#secretDechiffre(x))).filter((x) => x?.fournisseur === connexion.fournisseur);
    const autre = memeOutil.length > 0;
    // ... et s'il partage CETTE connexion (mêmes jetons : Shopify, un seul par boutique), le relais ne doit pas la couper
    if (connexion.rafraichissement && memeOutil.some((x) => x?.rafraichissement === connexion.rafraichissement)) return { ok: true, acces: 'garde', outil };
    // Shopify se désinstalle avec son jeton d'ACCÈS, qui ne vit qu'une heure : il est renouvelé AVANT que le relais
    // coupe la connexion (ensuite il ne pourrait plus l'être)
    let courante = connexion;
    if (!autre && connexion.fournisseur === 'shopify' && connexion.rafraichissement && bientotExpire(connexion)) {
      try { courante = await this.#rafraichir(connexion); } catch { /* jeton d'accès périmé : la désinstallation sera demandée à la personne */ }
    }
    let revoque = false;
    try { revoque = await this.#relais.revoquer(courante, !autre); } catch { /* relais injoignable ou changé : la révocation directe reste tentée */ }
    if (autre) return { ok: true, acces: 'garde', outil };
    if (revoque) return { ok: true, acces: 'revoque', outil };
    const appel = REVOCATION[courante.fournisseur]?.(courante, this.#monde.maintenant().getTime()) ?? null;
    if (!appel) return { ok: true, acces: 'a_retirer', outil };
    try {
      const r = await appeler(this.#f, appel.url, { methode: appel.methode, texte: true, delaiMs: 8000, ...(appel.corps !== undefined ? { corps: appel.corps } : {}), ...(appel.entetes ? { entetes: appel.entetes } : {}) });
      const ok = r.statut >= 200 && r.statut < 300 && (appel.reussi ? appel.reussi(String(r.donnees ?? '')) : true);
      return { ok: true, acces: ok ? 'revoque' : 'a_retirer', outil };
    } catch {
      return { ok: true, acces: 'a_retirer', outil };
    }
  }

  /**
   * Rapprochements à confirmer (administrateur) : fiches du jeu reliées à un enregistrement d'un outil seulement parce
   * qu'ils portent le même nom. Montre les deux côtés (nom, e-mail, SIRET) pour décider.
   */
  rapprochements(p: Profil) {
    this.#admin(p);
    const liste: { connecteur: string; outil: string; externeId: string; cote: { nom: string; email: string | null; siret: string | null }; fiche: { id: string; nom: string; email: string | null; siret: string | null } }[] = [];
    const texte = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);
    for (const c of this.#connecteurs.values()) {
      for (const ext of c.liensFaibles ?? []) {
        const o = c.liens[ext] ? this.#monde.objetReel(c.liens[ext] as string) : null;
        if (!o) continue;
        const vu = c.rapprochements?.[ext];
        liste.push({ connecteur: c.id, outil: c.nom, externeId: ext, cote: { nom: vu?.nom || o.nom, email: vu?.email ?? null, siret: vu?.siret ?? null },
          fiche: { id: o.id, nom: o.nom, email: texte(o.champs.email), siret: texte(o.champs.siret) } });
      }
    }
    return { rapprochements: liste.slice(0, 500) };
  }

  /**
   * L'administrateur tranche : « confirmer » (c'est la même entité : le lien devient un lien ordinaire, la fiche suit
   * l'outil et, dans les deux sens, lui est envoyée) ou « separer » (ce n'est pas elle : le lien est défait, l'outil
   * aura sa propre fiche à la prochaine lecture, et cet enregistrement ne sera plus jamais rapproché par le nom).
   */
  deciderRapprochement(p: Profil, id: unknown, d: unknown) {
    this.#admin(p);
    const c = this.#trouver(id);
    const x = typeof d === 'object' && d !== null ? d as Record<string, unknown> : {};
    const ext = typeof x.externeId === 'string' ? x.externeId : '';
    if (!ext || !(c.liensFaibles ?? []).includes(ext) || !c.liens[ext]) throw new ErreurApi(404, 'introuvable', 'Ce rapprochement n’est plus à confirmer.');
    if (x.decision !== 'confirmer' && x.decision !== 'separer') throw new ErreurApi(400, 'decision_invalide', 'Décision attendue : « confirmer » ou « separer ».');
    c.liensFaibles = (c.liensFaibles ?? []).filter((e) => e !== ext);
    if (c.rapprochements) delete c.rapprochements[ext];
    if (x.decision === 'separer') {
      const objId = c.liens[ext] as string;
      delete c.liens[ext];
      if (!Object.values(c.liens).includes(objId)) delete c.empreintes[objId];
      c.separes = [...new Set([...(c.separes ?? []), ext])].slice(-20_000);
    }
    this.#changement();
    return { ok: true as const, decision: x.decision, restants: (c.liensFaibles ?? []).length };
  }

  /**
   * Fiche effacée ou anonymisée dans le jeu : chaque connecteur oublie son lien, et l'enregistrement de l'outil n'est
   * plus réimporté (sinon la lecture suivante la recréerait) ; rien n'est renvoyé vers l'outil. Renvoie les outils
   * concernés (l'effacement chez eux reste à faire par l'entreprise).
   */
  oublierObjet(objId: string): string[] {
    const outils: string[] = [];
    for (const c of this.#connecteurs.values()) {
      const ext = Object.entries(c.liens).filter(([, o]) => o === objId).map(([e]) => e);
      if (!ext.length) continue;
      for (const e of ext) delete c.liens[e];
      delete c.empreintes[objId];
      c.liensFaibles = (c.liensFaibles ?? []).filter((e) => !ext.includes(e));
      c.exclus = [...new Set([...(c.exclus ?? []), ...ext])].slice(-20_000);
      outils.push(c.nom);
    }
    if (outils.length) this.#changement();
    return outils;
  }

  #noter(c: ConnecteurEnregistre, sens: 'entrant' | 'sortant', crees: number, maj: number, erreurs: number, detail: string) {
    c.historique.push({ le: this.#monde.maintenant().toISOString(), sens, crees, maj, erreurs, detail: detail.slice(0, 200) });
    if (c.historique.length > 50) c.historique.splice(0, c.historique.length - 50);
  }

  /** Applique des enregistrements bruts (lecture ou réception) au monde. */
  #appliquer(c: ConnecteurEnregistre, enregistrements: { externeId: string; champs: Record<string, string> }[]) {
    const lignes: LigneExterne[] = [];
    // Conflit : une fiche modifiée dans le jeu depuis le dernier échange n'est pas écrasée par la lecture ;
    // elle part vers l'outil juste après (la dernière modification gagne).
    const enAttente = new Set(Object.values(c.liens).filter((objId) => c.empreintes[objId] && this.#monde.empreinte(objId) !== c.empreintes[objId]));
    // Rapprochement par le nom (évite les doublons) : jamais avec une fiche déjà tenue par un AUTRE outil, jamais si
    // l'e-mail ou le SIRET diffèrent ; le lien reste « faible » : l'outil complète la fiche sans rien écraser.
    const tenues = new Set([...this.#connecteurs.values()].filter((x) => x.id !== c.id).flatMap((x) => Object.values(x.liens)));
    const faibles = new Set(c.liensFaibles ?? []);
    const exclus = new Set(c.exclus ?? []);
    const separes = new Set(c.separes ?? []);
    const vus: Record<string, { nom: string; email?: string; siret?: string }> = { ...(c.rapprochements ?? {}) };
    for (const e of enregistrements) {
      if (exclus.has(e.externeId)) continue; // fiche effacée dans le jeu (droit à l'effacement) : pas réimportée
      if (c.liens[e.externeId] && enAttente.has(c.liens[e.externeId] as string) && !faibles.has(e.externeId)) continue;
      const valeurs: Record<string, string> = {};
      for (const [ext, cible] of Object.entries(c.mapping)) if (ext in e.champs) valeurs[cible] = e.champs[ext] ?? '';
      if (!c.liens[e.externeId] && valeurs[NOM] && !separes.has(e.externeId)) {
        const existant = this.#monde.rapprocher(c.typeObjet, valeurs[NOM], { exclus: tenues, valeurs });
        if (existant && !Object.values(c.liens).includes(existant)) { c.liens[e.externeId] = existant; faibles.add(e.externeId); }
      }
      // même e-mail ou même SIRET des deux côtés : c'est bien la même entité, le lien n'a pas (ou plus) à être confirmé
      if (faibles.has(e.externeId) && c.liens[e.externeId] && this.#monde.memeIdentifiantFort(c.liens[e.externeId] as string, valeurs)) faibles.delete(e.externeId);
      if (faibles.has(e.externeId)) {
        const court = (x: string | undefined) => (x ? x.trim().slice(0, 200) : '');
        vus[e.externeId] = { nom: court(valeurs[NOM]), ...(court(valeurs.email) ? { email: court(valeurs.email) } : {}), ...(court(valeurs.siret) ? { siret: court(valeurs.siret) } : {}) };
      }
      lignes.push({ externeId: e.externeId, valeurs, ...(faibles.has(e.externeId) ? { completer: true } : {}) });
    }
    c.liensFaibles = [...faibles].filter((x) => c.liens[x]);
    c.rapprochements = Object.fromEntries(Object.entries(vus).filter(([x]) => c.liensFaibles?.includes(x)));
    const r = this.#monde.appliquerExterne({ id: `connecteur:${c.id}`, libelle: c.nom }, c.typeObjet, c.roles, lignes, c.liens);
    c.liens = r.liens;
    for (const objId of Object.values(c.liens)) { if (enAttente.has(objId)) continue; const e = this.#monde.empreinte(objId); if (e) c.empreintes[objId] = e; }
    return r;
  }

  /** Lit l'outil et met le monde à jour, puis renvoie les changements du jeu (si « dans les deux sens »). */
  async synchroniser(id: string, p?: Profil) {
    if (p) this.#admin(p);
    const c = this.#trouver(id);
    if (this.#enCours.has(c.id)) return this.#vue(c);
    this.#enCours.add(c.id);
    try {
      if (c.sens !== 'ecriture' && ADAPTATEURS[c.source].lecture === 'appel') {
        const a = ADAPTATEURS[c.source];
        // précision de l'adaptateur (ex. lequel des tableaux d'une base Notion est lu) : notée dans l'historique du branchement
        const avis: string[] = [];
        const enregistrements = await this.#avecSecret(c.config, this.#secret(c), { ...this.#contexte(c), avis: (texte) => { avis.push(texte); } }, (cfg, s, ctx) => a.lire(cfg, s, this.#f, ctx));
        const r = this.#appliquer(c, enregistrements);
        this.#noter(c, 'entrant', r.crees, r.maj, r.totalRejets, `${enregistrements.length} lu(s)${r.totalRejets ? ` · ${r.rejets[0]?.erreurs[0] ?? ''}` : ''}${avis.length ? ` · ${avis.at(-1)}` : ''}`);
      }
      if (c.sens !== 'lecture') await this.#pousser(c);
      c.statut = 'ok';
      c.message = null;
    } catch (e) {
      c.statut = 'erreur';
      c.message = e instanceof ErreurSortante || e instanceof ErreurApi ? e.message : 'Synchronisation impossible.';
      this.#noter(c, 'entrant', 0, 0, 1, c.message);
    } finally {
      c.derniereSynchro = this.#monde.maintenant().toISOString();
      this.#enCours.delete(c.id);
      this.#changement();
    }
    return this.#vue(c);
  }

  /** Jeu → réel : renvoie les objets liés modifiés et crée dans l'outil les objets créés dans le jeu. */
  async #pousser(c: ConnecteurEnregistre) {
    const ecrire = ADAPTATEURS[c.source].ecrire;
    if (!ecrire) return;
    const inverse = Object.entries(c.mapping);
    const cibles = inverse.map(([, cible]) => cible);
    const versExterne = (objId: string): Record<string, ValeurSortante> => {
      const v = this.#monde.valeursExport(objId, cibles);
      return Object.fromEntries(inverse.map(([ext, cible]) => [ext, v[cible] ?? null]));
    };
    const parObjet = new Map(Object.entries(c.liens).map(([ext, obj]) => [obj, ext]));
    // lien posé par simple homonymie, pas encore confirmé : rien de la fiche ne part vers l'outil (revue-jeu-1-2)
    const faibles = new Set(c.liensFaibles ?? []);
    let maj = 0;
    let crees = 0;
    let erreurs = 0;
    let derniere = '';
    let secret = this.#secret(c);
    const ctx = this.#contexte(c, (s) => { secret = s; });
    const envoyer = (externeId: string | null, valeurs: Record<string, ValeurSortante>) =>
      this.#avecSecret(c.config, secret, ctx, (cfg, s, x) => ecrire(cfg, s, externeId, valeurs, this.#f, x));
    for (const [objId, externeId] of parObjet) {
      const e = this.#monde.empreinte(objId);
      if (!e || e === c.empreintes[objId] || faibles.has(externeId)) continue;
      try {
        await envoyer(externeId, versExterne(objId));
        c.empreintes[objId] = e;
        maj++;
      } catch (err) { erreurs++; derniere = err instanceof Error ? err.message : 'erreur'; }
    }
    if (c.sens === 'deux' || c.sens === 'ecriture') {
      const autres = new Set([...this.#connecteurs.values()].filter((x) => x.id !== c.id).flatMap((x) => Object.values(x.liens)));
      for (const o of this.#monde.objetsReels()) {
        if (o.type !== c.typeObjet || o.mode !== 'reel' || parObjet.has(o.id) || autres.has(o.id) || o.source.id.startsWith('connecteur:') || o.source.id === 'effacement') continue;
        if (c.roles.length && !o.roles.some((r) => c.roles.includes(r))) continue;
        try {
          const ext = await envoyer(null, versExterne(o.id));
          if (ext) { c.liens[ext] = o.id; c.empreintes[o.id] = this.#monde.empreinte(o.id) ?? ''; }
          crees++;
        } catch (err) { erreurs++; derniere = err instanceof Error ? err.message : 'erreur'; }
        if (crees >= 100) break;
      }
    }
    if (maj || crees || erreurs) this.#noter(c, 'sortant', crees, maj, erreurs, erreurs ? derniere : `${maj} mis à jour, ${pluriel(crees, 'créé', 'créés')} dans ${c.nom}`);
    if (erreurs) throw new ErreurSortante(`Écriture vers ${c.nom} : ${derniere}`);
  }

  /** Appelée à chaque changement du monde : pousse vers les outils (regroupé). */
  surChangement(action: string) {
    if (action === 'synchro.entrante') return;
    if (this.#attentePousse) return;
    this.#attentePousse = setTimeout(() => {
      this.#attentePousse = null;
      for (const c of this.#connecteurs.values()) {
        if (!c.actif || c.sens === 'lecture' || this.#enCours.has(c.id)) continue;
        this.#enCours.add(c.id);
        this.#pousser(c)
          .then(() => { c.statut = 'ok'; c.message = null; })
          .catch((e) => { c.statut = 'erreur'; c.message = e instanceof Error ? e.message : 'erreur'; })
          .finally(() => { this.#enCours.delete(c.id); this.#changement(); });
      }
    }, 1200);
    this.#attentePousse.unref?.();
  }

  /**
   * Lecture périodique des outils dont l'intervalle est écoulé. En temps réel, ce n'est plus qu'un filet de sécurité :
   * toutes les 30 minutes (jamais plus souvent que l'intervalle choisi).
   */
  async tick() {
    const maintenant = this.#monde.maintenant().getTime();
    for (const c of this.#connecteurs.values()) {
      if (!c.actif || c.sens === 'ecriture' || ADAPTATEURS[c.source].lecture !== 'appel') continue;
      const derniere = c.derniereSynchro ? Date.parse(c.derniereSynchro) : 0;
      const intervalle = this.#tempsReelVivant(c) ? Math.max(c.intervalleS, FILET_TEMPS_REEL_S) : c.intervalleS;
      if (maintenant - derniere >= intervalle * 1000) await this.synchroniser(c.id);
    }
  }

  // ---------------------------------------------------------------- temps réel (temps-reel.ts)

  /** Branche Breizhcosystem (application.ts) : abonnements des outils et canal des avis. */
  brancherTempsReel(r: ReseauTempsReel) {
    this.#reseau = r;
  }

  /** Au moins un branchement abonné : le canal vers Breizhcosystem a lieu d'être ouvert. */
  aDesAbonnements(): boolean {
    return [...this.#connecteurs.values()].some((c) => c.actif && c.tempsReel?.etat === 'actif' && c.tempsReel.abonnement !== null);
  }

  /** L'abonnement vit : actif chez l'outil et chez Breizhcosystem, pas expiré, et le canal entend Breizhcosystem. */
  #tempsReelVivant(c: ConnecteurEnregistre): boolean {
    const t = c.tempsReel;
    if (!c.actif || !t || t.etat !== 'actif' || !t.abonnement || !this.#reseau?.enLigne()) return false;
    return !t.expire || Date.parse(t.expire) > this.#monde.maintenant().getTime();
  }

  /** Le branchement peut-il passer en temps réel (outil qui prévient, lecture par appel, actif, pas « vers l'outil » seul) ? */
  #eligible(c: ConnecteurEnregistre): FournisseurTempsReel | null {
    const f = TEMPS_REEL_DE[c.source];
    return f && c.actif && c.sens !== 'ecriture' && ADAPTATEURS[c.source].lecture === 'appel' ? f : null;
  }

  /**
   * Entretien des abonnements (application.ts, toutes les 5 minutes, et après un branchement) : création, renouvellement
   * avant expiration, vérification, arrêt d'un branchement en pause ou supprimé du temps réel. Un seul à la fois.
   */
  entretenirTempsReel(): Promise<void> {
    if (this.#entretien) { this.#entretienEncore = true; return this.#entretien; }
    this.#entretien = (async () => {
      try {
        do {
          this.#entretienEncore = false;
          for (const c of [...this.#connecteurs.values()]) {
            if (!this.#connecteurs.has(c.id)) continue; // supprimé entre-temps
            try { await this.#entretenir(c); } catch { /* noté dans l'état du branchement ; nouvel essai plus tard */ }
          }
        } while (this.#entretienEncore);
      } finally { this.#entretien = null; }
    })();
    return this.#entretien;
  }

  async #entretenir(c: ConnecteurEnregistre) {
    const f = this.#eligible(c);
    const reseau = this.#reseau;
    if (!f || !reseau?.relie()) {
      // plus éligible (pause, sens changé) ou délié : l'abonnement est retiré (délié : chez l'outil seulement)
      if (c.tempsReel?.abonnement) await this.#arreterTempsReel(c, this.#secretDechiffre(c));
      return;
    }
    const maintenant = this.#monde.maintenant().getTime();
    const t = c.tempsReel;
    if (t && t.etat !== 'actif' && t.essai && Date.parse(t.essai) > maintenant && t.suivi === suiviDe(c.source, c.config)) return;
    if (!t || !t.abonnement || t.etat !== 'actif' || t.suivi !== suiviDe(c.source, c.config) || t.fournisseur !== f) { await this.#creerTempsReel(c, f); return; }
    const outil = OUTILS_TEMPS_REEL[f];
    if (outil.dureeMs !== null && (!t.expire || Date.parse(t.expire) - maintenant < outil.margeMs)) { await this.#renouvelerTempsReel(c, f); return; }
    if (outil.verifier && outil.verificationMs && (!t.verifie || maintenant - Date.parse(t.verifie) >= outil.verificationMs)) {
      const present = await this.#avecJetonOutil(c, (cfg, jeton) => outil.verifier!(cfg, jeton, this.#f, this.#abonnementOutil(t))).catch(() => true);
      t.verifie = new Date(maintenant).toISOString();
      if (!present) await this.#creerTempsReel(c, f);
      else this.#changement();
    }
  }

  /** Jeton d'accès à l'outil du branchement (renouvelé par le relais au besoin), pour les appels du temps réel. */
  async #avecJetonOutil<T>(c: ConnecteurEnregistre, appel: (cfg: Config, jeton: string) => Promise<T>, secret: string | null = this.#secret(c)): Promise<T> {
    return this.#avecSecret(c.config, secret, this.#contexte(c), async (cfg, s, ctx) => {
      // Excel par code d'appareil (application de l'entreprise) : le secret est le jeton de renouvellement Microsoft
      const jeton = c.source === 'excel365' && !parRelais(cfg, 'microsoft') ? await jetonAccesMicrosoft(cfg, s, this.#f, ctx) : s;
      if (!jeton) throw new ErreurSortante('Connexion à l’outil manquante.');
      return appel(cfg, jeton);
    });
  }

  #abonnementOutil(t: EtatTempsReel): AbonnementOutil {
    const p = this.#prive(t);
    return { externe: t.externe, expire: t.expire, ressource: p?.ressource ?? null, ...(t.curseur !== undefined ? { curseur: t.curseur } : {}), ...(t.repere !== undefined ? { repere: t.repere } : {}) };
  }

  #prive(t: EtatTempsReel): PriveTempsReel | null {
    if (!t.prive) return null;
    try {
      const x = JSON.parse(this.#chiffreur.dechiffrer(t.prive)) as Partial<PriveTempsReel>;
      return typeof x.adresse === 'string' ? { adresse: x.adresse, secret: typeof x.secret === 'string' ? x.secret : null, utilisateur: typeof x.utilisateur === 'string' ? x.utilisateur : null, ressource: typeof x.ressource === 'string' ? x.ressource : null } : null;
    } catch { return null; }
  }

  /** Refus ou panne : le branchement reste relu à son intervalle ; nouvel essai plus tard (6 h pour un refus, 15 min sinon). */
  #indisponible(c: ConnecteurEnregistre, f: FournisseurTempsReel, e: unknown, suivi: string) {
    const refus = (e instanceof ErreurApi && [403, 404, 409].includes(e.statut)) || (e instanceof ErreurSortante && [400, 401, 403, 404, 409, 422].includes(e.statut ?? 0));
    const message = (e instanceof ErreurApi || e instanceof ErreurSortante ? e.message : 'Temps réel indisponible pour le moment.').slice(0, 300);
    const delai = refus ? 6 * 3600_000 : 15 * 60_000;
    c.tempsReel = { fournisseur: f, abonnement: null, prive: null, externe: null, expire: null, etat: refus ? 'indisponible' : 'erreur', message, essai: new Date(this.#monde.maintenant().getTime() + delai).toISOString(), suivi };
    this.#changement();
  }

  /** Nouvel abonnement : demandé à Breizhcosystem, créé chez l'outil avec le jeton de l'entreprise, puis activé. */
  async #creerTempsReel(c: ConnecteurEnregistre, f: FournisseurTempsReel) {
    const reseau = this.#reseau as ReseauTempsReel;
    const suivi = suiviDe(c.source, c.config);
    if (c.tempsReel?.abonnement) await this.#arreterTempsReel(c, this.#secretDechiffre(c));
    const outil = OUTILS_TEMPS_REEL[f];
    const secret = this.#secretDechiffre(c);
    let empreinte: string | null = null;
    if (outil.parApplication) {
      // Notion, HubSpot : Breizhcosystem reconnaît le compte noté à la connexion en un clic ; le jeu prouve qu'il tient
      // cette connexion par l'empreinte de son jeton de renouvellement (le jeton lui-même ne part pas)
      const connexion = lireEnveloppe(secret);
      if (!connexion?.rafraichissement) {
        this.#indisponible(c, f, new ErreurApi(409, 'temps_reel_cle', `Temps réel avec « Se connecter avec ${NOM_FOURNISSEUR[connexion?.fournisseur ?? (f as FournisseurOAuth)] ?? f} » seulement.`), suivi);
        return;
      }
      empreinte = createHash('sha256').update(connexion.rafraichissement).digest('base64url');
    }
    let id: string | null = null;
    try {
      const r = await reseau.appel('POST', '/abonnements', { fournisseur: f, connecteur: c.id, ...(empreinte ? { empreinte } : {}) });
      const x = estObj(r) ? r : {};
      id = typeof x.id === 'string' && /^[0-9a-f-]{36}$/.test(x.id) ? x.id : null;
      const p: AdresseAvis = {
        adresse: this.#adresseAvis(x.adresse, f),
        secret: typeof x.secret === 'string' && /^[A-Za-z0-9_-]{20,128}$/.test(x.secret) ? x.secret : null,
        utilisateur: typeof x.utilisateur === 'string' && /^[a-z0-9-]{1,40}$/.test(x.utilisateur) ? x.utilisateur : null,
      };
      if (!id) throw new ErreurSortante('Réponse de Breizhcosystem inattendue.');
      const a = await this.#avecJetonOutil(c, (cfg, jeton) => outil.creer(cfg, jeton, this.#f, p), secret);
      if (!outil.parApplication) await reseau.appel('PUT', `/abonnements/${id}`, { externe: a.externe, expire: a.expire, ...(a.secretOutil ? { secret: a.secretOutil } : {}) });
      c.tempsReel = {
        fournisseur: f, abonnement: id, prive: this.#chiffreur.chiffrer(JSON.stringify({ ...p, ressource: a.ressource } satisfies PriveTempsReel)), externe: a.externe, expire: a.expire,
        etat: 'actif', message: null, essai: null, suivi, ...(a.curseur !== undefined ? { curseur: a.curseur } : {}), ...(a.repere !== undefined ? { repere: a.repere } : {}),
        ...(outil.verificationMs ? { verifie: this.#monde.maintenant().toISOString() } : {}),
      };
      this.#changement();
      reseau.relancer?.();
    } catch (e) {
      if (id) await reseau.appel('DELETE', `/abonnements/${id}`).catch(() => undefined);
      this.#indisponible(c, f, e, suivi);
    }
  }

  /** Adresse d'avis remise par Breizhcosystem : sur son origine, et pour cet outil (sinon refusée : un avis d'outil peut porter des données). */
  #adresseAvis(x: unknown, f: FournisseurTempsReel): string {
    const origine = this.#reseau?.origine();
    if (typeof x !== 'string' || !origine || x.length > 300) throw new ErreurSortante('Adresse des avis inattendue : temps réel refusé par sécurité.');
    let u: URL;
    try { u = new URL(x); } catch { throw new ErreurSortante('Adresse des avis inattendue : temps réel refusé par sécurité.'); }
    const chemin = new RegExp(`^/v0/relais/evenements/${f}(/[A-Za-z0-9_-]{43})?$`);
    if (u.origin !== origine || !chemin.test(u.pathname) || u.search || u.hash || u.username || u.password) throw new ErreurSortante('Adresse des avis inattendue : temps réel refusé par sécurité.');
    return u.toString();
  }

  /** Renouvellement chez l'outil avant l'expiration, puis la nouvelle fin donnée à Breizhcosystem. */
  async #renouvelerTempsReel(c: ConnecteurEnregistre, f: FournisseurTempsReel) {
    const t = c.tempsReel as EtatTempsReel;
    const outil = OUTILS_TEMPS_REEL[f];
    const p = this.#prive(t);
    if (!outil.renouveler || !p) { await this.#creerTempsReel(c, f); return; }
    try {
      const a = await this.#avecJetonOutil(c, (cfg, jeton) => outil.renouveler!(cfg, jeton, this.#f, this.#abonnementOutil(t), p));
      await (this.#reseau as ReseauTempsReel).appel('PUT', `/abonnements/${t.abonnement}`, { externe: a.externe, expire: a.expire });
      c.tempsReel = { ...t, externe: a.externe, expire: a.expire, prive: this.#chiffreur.chiffrer(JSON.stringify({ ...p, ressource: a.ressource } satisfies PriveTempsReel)), message: null };
      this.#changement();
    } catch {
      // abonnement disparu chez l'outil ou chez Breizhcosystem : refait de zéro
      await this.#creerTempsReel(c, f);
    }
  }

  /** Arrêt : supprimé chez l'outil (avec le jeton, avant toute révocation) puis chez Breizhcosystem ; au mieux. */
  async #arreterTempsReel(c: ConnecteurEnregistre, secret: string | null) {
    const t = c.tempsReel;
    if (!t) return;
    delete c.tempsReel;
    this.#changement();
    if (!t.abonnement) return;
    const outil = OUTILS_TEMPS_REEL[t.fournisseur];
    if (!outil.parApplication && secret) await this.#avecJetonOutil(c, (cfg, jeton) => outil.supprimer(cfg, jeton, this.#f, this.#abonnementOutil(t)), secret).catch(() => undefined);
    if (this.#reseau?.relie()) await this.#reseau.appel('DELETE', `/abonnements/${t.abonnement}`).catch(() => undefined);
  }

  /**
   * Avis reçu sur le canal : le branchement est relu, une fois pour tous les avis des 2 secondes qui suivent. Un avis
   * pour un autre genre de fiches (HubSpot, Pipedrive) ou un autre tableau (Notion) ne relit rien.
   */
  signaler(a: AvisRecu) {
    const c = this.#connecteurs.get(a.connecteur);
    if (!c || !c.actif || !c.tempsReel || c.tempsReel.fournisseur !== a.fournisseur || TEMPS_REEL_DE[c.source] !== a.fournisseur) return;
    if (!a.enAttente && !concerne(c.source, c.config, a.objets)) return;
    if (this.#regroupes.has(c.id)) return;
    const relire = () => {
      if (this.#enCours.has(c.id)) { this.#regroupes.set(c.id, setTimeout(relire, REGROUPEMENT_MS)); return; }
      this.#regroupes.delete(c.id);
      void this.#relireApresAvis(c.id).catch(() => undefined);
    };
    const t = setTimeout(relire, REGROUPEMENT_MS);
    t.unref?.();
    this.#regroupes.set(c.id, t);
  }

  /** Avant de relire : Airtable lit ses charges (curseur, expiration repoussée), Microsoft compare l'étiquette du classeur. */
  async #relireApresAvis(id: string) {
    const c = this.#connecteurs.get(id);
    const t = c?.tempsReel;
    if (!c || !t) return;
    const outil = OUTILS_TEMPS_REEL[t.fournisseur];
    if (outil.avantRelecture) {
      try {
        const r = await this.#avecJetonOutil(c, (cfg, jeton) => outil.avantRelecture!(cfg, jeton, this.#f, this.#abonnementOutil(t)));
        if (c.tempsReel === t) {
          c.tempsReel = { ...t, expire: r.abonnement.expire, ...(r.abonnement.curseur !== undefined ? { curseur: r.abonnement.curseur } : {}), ...(r.abonnement.repere !== undefined ? { repere: r.abonnement.repere } : {}) };
          this.#changement();
        }
        if (!r.relire) return;
      } catch { /* relu quand même */ }
    }
    await this.synchroniser(id);
  }

  /**
   * Entrée webhook (Make, Zapier, n8n…), authentifiée par :
   * - le secret d'entrée en `Authorization: Bearer …` (secret au porteur, comme une clé d'API, protégé par HTTPS) ;
   * - ou une signature horodatée `X-LB-Signature: t=<secondes>,v1=<HMAC-SHA256(secret, « t.corps »)>` : refusée à plus
   *   de 5 minutes d'écart, et une seule fois (rejeu refusé). L'ancienne forme `sha256=…` sans horodatage, valable
   *   indéfiniment, est refusée. Les envois du jeu sont signés avec une autre clé (`cleEnvois`) : jamais acceptés ici.
   */
  recevoir(id: string, entetes: Record<string, string | string[] | undefined>, brut: string) {
    const c = typeof id === 'string' && ID.test(id) ? this.#connecteurs.get(id) : undefined;
    if (!c || !c.secretEntrant || !c.actif) throw new ErreurApi(404, 'introuvable');
    const secret = this.#chiffreur.dechiffrer(c.secretEntrant);
    const egal = (a: string, b: string) => { const x = createHash('sha256').update(a).digest(); const y = createHash('sha256').update(b).digest(); return timingSafeEqual(x, y); };
    const auth = String(entetes.authorization ?? '');
    const entete = String(entetes['x-lb-signature'] ?? '');
    if (!(auth.startsWith('Bearer ') && egal(auth.slice(7), secret))) {
      if (!entete) throw new ErreurApi(401, 'signature_invalide');
      const sig = lireSignature(entete);
      if (!sig) throw new ErreurApi(401, 'signature_sans_horodatage', 'Signature refusée : X-LB-Signature attendue sous la forme t=<secondes>,v1=<HMAC-SHA256 de « t.corps »>, ou Authorization: Bearer <secret>.');
      const maintenant = Date.now();
      if (Math.abs(maintenant / 1000 - sig.t) > TOLERANCE_SIGNATURE_S) throw new ErreurApi(401, 'signature_perimee', 'Signature trop ancienne (ou horloge décalée de plus de 5 minutes) : refusée.');
      const attendu = createHmac('sha256', secret).update(`${sig.t}.${brut}`).digest('hex');
      if (!egal(sig.v1, attendu)) throw new ErreurApi(401, 'signature_invalide');
      for (const [k, fin] of this.#signaturesVues) if (fin <= maintenant) this.#signaturesVues.delete(k);
      const empreinte = `${c.id}:${sig.v1}`;
      if (this.#signaturesVues.has(empreinte)) throw new ErreurApi(409, 'rejeu', 'Requête déjà reçue : une signature ne sert qu’une fois.');
      if (this.#signaturesVues.size >= 50_000) this.#signaturesVues.delete(this.#signaturesVues.keys().next().value as string);
      this.#signaturesVues.set(empreinte, maintenant + 2 * TOLERANCE_SIGNATURE_S * 1000);
    }
    let d: unknown;
    try { d = JSON.parse(brut); } catch { throw new ErreurApi(400, 'json_invalide'); }
    const liste = Array.isArray(d) ? d : estObj(d) && Array.isArray(d.enregistrements) ? d.enregistrements : estObj(d) ? [d] : [];
    const cle = c.config.champId || 'id';
    const enregistrements = liste.filter(estObj).slice(0, 1000).map((o, i) => {
      const champs = aplatirObjet(o);
      return { externeId: (champs[cle] || champs.id || normaliser(champs[Object.keys(c.mapping).find((k) => c.mapping[k] === NOM) ?? ''] ?? '') || `recu-${Date.now()}-${i}`).slice(0, 200), champs };
    });
    if (!Object.values(c.mapping).includes(NOM) && enregistrements[0]) {
      // 1re réception : correspondance proposée automatiquement à partir des champs reçus
      const t = defType(this.#monde.univers, c.typeObjet);
      if (t) c.mapping = Object.fromEntries(Object.entries(proposerMapping(Object.keys(enregistrements[0].champs), t)).filter(([, v]) => v)) as Record<string, string>;
    }
    const r = this.#appliquer(c, enregistrements);
    this.#noter(c, 'entrant', r.crees, r.maj, r.totalRejets, `${pluriel(enregistrements.length, 'reçu', 'reçus')}`);
    c.derniereSynchro = this.#monde.maintenant().toISOString();
    c.statut = r.totalRejets && !r.crees && !r.maj ? 'erreur' : 'ok';
    c.message = r.totalRejets ? `${pluriel(r.totalRejets, 'rejet', 'rejets')} : ${r.rejets[0]?.erreurs.join(', ') ?? ''}` : null;
    this.#changement();
    return { recus: enregistrements.length, crees: r.crees, maj: r.maj, rejets: r.totalRejets };
  }

  /** Événement métier envoyé aux webhooks sortants (Make, Zapier, n8n…). Renvoie true si au moins un l'a reçu. */
  /** Un outil d'automatisation (Make, Zapier, n8n) reçoit-il les événements du jeu ? */
  peutNotifier(): boolean {
    return [...this.#connecteurs.values()].some((c) => c.actif && c.source === 'webhook' && Boolean(c.config.urlSortante));
  }

  async notifier(evenement: string, donnees: Record<string, unknown>): Promise<boolean> {
    let ok = false;
    for (const c of this.#connecteurs.values()) {
      if (!c.actif || c.source !== 'webhook' || !c.config.urlSortante) continue;
      try {
        const u = await verifierUrl(c.config.urlSortante);
        const corps = { evenement, donnees, organisation: this.#monde.organisation.nom, le: this.#monde.maintenant().toISOString() };
        const secret = this.#secret(c);
        await appeler(this.#f, u, { methode: 'POST', texte: true, corps, entetes: secret ? { 'x-lb-signature': signerEnvoi(secret, JSON.stringify(corps)) } : {} });
        this.#noter(c, 'sortant', 0, 0, 0, `événement ${evenement}`);
        ok = true;
      } catch (e) {
        this.#noter(c, 'sortant', 0, 0, 1, e instanceof Error ? e.message : 'erreur');
      }
    }
    return ok;
  }

  /** Données d'exemple pour tester un scénario Make/Zapier (format attendu). */
  static exempleWebhook(): unknown {
    return { enregistrements: [{ id: 'CRM-001', Nom: 'Exemple SARL', Ville: 'Brest', Email: 'contact@exemple.fr' }] };
  }
}

