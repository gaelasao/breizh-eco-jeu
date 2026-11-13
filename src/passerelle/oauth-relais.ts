/**
 * « Se connecter avec… » : client du relais de connexion de Breizhcosystem (aucun compte Breizhcosystem nécessaire).
 *
 * Chaque outil (HubSpot, Google, Microsoft…) exige une application déclarée avec un secret et une adresse de retour
 * https : le jeu, installé chez l'entreprise, ne peut ni garder ce secret ni recevoir ce retour. Le relais le fait :
 *   1. `demarrer` : adresse de la page de connexion DE L'OUTIL + secret d'attente, gardé ICI (jamais envoyé au navigateur) ;
 *   2. la personne se connecte chez l'outil avec SON compte et accepte ;
 *   3. `retrait` (toutes les 2 s) : les jetons, remis une seule fois ;
 *   4. `rafraichir` : nouveau jeton d'accès quand il expire (le secret de l'application reste sur Breizhcosystem).
 * Les jetons ne transitent par Breizhcosystem qu'à la connexion et au renouvellement, sans y être gardés ; les DONNÉES de
 * l'entreprise ne passent jamais par Breizhcosystem : le jeu appelle l'outil directement avec ses jetons. Breizhcosystem n'est contacté
 * qu'après un clic sur « Se connecter avec… » (jamais à l'ouverture de « Connecter mes données »), puis aux
 * renouvellements. Droits demandés : lecture seule par défaut, écriture seulement pour une synchro qui écrit.
 * Tout ce que renvoie le relais est relu ici : page de connexion sur l'hôte attendu de l'outil, jetons bornés et sans
 * caractère de contrôle, informations complémentaires connues seulement (domaine Pipedrive, boutique Shopify…).
 * Chemins fixes sur l'origine de Breizhcosystem (`etat().url`), vérifiée par `verifierUrl` à chaque appel.
 */
import { ORGANISATION_DYNAMICS } from './sources-dynamics.ts';
import { ErreurSortante, lireTexteBorne, recuperateurProtege, verifierUrl, type Recuperateur } from './sortant.ts';
import type { TypeSource } from './sources.ts';

export const FOURNISSEURS_OAUTH = ['hubspot', 'google', 'microsoft', 'dynamics', 'businesscentral', 'notion', 'airtable', 'pipedrive', 'sellsy', 'shopify', 'woocommerce'] as const;
export type FournisseurOAuth = (typeof FOURNISSEURS_OAUTH)[number];
export const estFournisseur = (x: unknown): x is FournisseurOAuth => (FOURNISSEURS_OAUTH as readonly unknown[]).includes(x);

/** Connecteur du jeu → fournisseur du relais. */
export const FOURNISSEUR_DE: Readonly<Partial<Record<TypeSource, FournisseurOAuth>>> = {
  hubspot: 'hubspot', sheets: 'google', excel365: 'microsoft', dynamics365: 'dynamics', businesscentral: 'businesscentral', notion: 'notion', airtable: 'airtable',
  pipedrive: 'pipedrive', sellsy: 'sellsy', shopify: 'shopify', woocommerce: 'woocommerce',
};

/** Nom affiché sur le bouton « Se connecter avec … » (fixé ici : aucun texte du relais sur le bouton). */
export const NOM_FOURNISSEUR: Readonly<Record<FournisseurOAuth, string>> = {
  hubspot: 'HubSpot', google: 'Google', microsoft: 'Microsoft', dynamics: 'Microsoft', businesscentral: 'Microsoft', notion: 'Notion', airtable: 'Airtable',
  pipedrive: 'Pipedrive', sellsy: 'Sellsy', shopify: 'Shopify', woocommerce: 'WooCommerce',
};

/** Réglage demandé AVANT la connexion (adresse de la boutique) : champ du connecteur qui le porte. */
export const PARAMETRE_OAUTH: Readonly<Partial<Record<FournisseurOAuth, { champ: string; nom: 'boutique' | 'site' | 'organisation' }>>> = {
  shopify: { champ: 'boutique', nom: 'boutique' },
  dynamics: { champ: 'organisation', nom: 'organisation' },
  woocommerce: { champ: 'boutique', nom: 'site' },
};

/** Hôte attendu de la page de connexion de chaque outil (Shopify, WooCommerce : l'adresse de la boutique). */
const HOTES_CONNEXION: Readonly<Partial<Record<FournisseurOAuth, readonly string[]>>> = {
  hubspot: ['app.hubspot.com', 'app-eu1.hubspot.com'],
  google: ['accounts.google.com'],
  microsoft: ['login.microsoftonline.com'],
  dynamics: ['login.microsoftonline.com'],
  businesscentral: ['login.microsoftonline.com'],
  notion: ['api.notion.com'],
  airtable: ['airtable.com'],
  pipedrive: ['oauth.pipedrive.com'],
  sellsy: ['login.sellsy.com'],
};

/**
 * Clé de réglage ajoutée par le jeu au moment de l'appel (jamais saisie ni enregistrée) quand la connexion vient
 * de « Se connecter avec… » : les adaptateurs y lisent le fournisseur (ex. Bearer au lieu de x-api-token).
 */
export const CLE_OAUTH = '__oauth';
export const parRelais = (cfg: Readonly<Record<string, string>>, f: FournisseurOAuth): boolean => cfg[CLE_OAUTH] === f;

export interface JetonsOAuth {
  acces: string;
  rafraichissement: string | null;
  expire: string | null;
  /**
   * Fin de validité du jeton de RENOUVELLEMENT, quand l'outil la donne (Shopify : 90 jours, repoussés à chaque
   * renouvellement). Passé cette date, il faut se reconnecter. Absente : inconnue, ou sans limite.
   */
  rafraichissementExpire?: string;
  extra: Record<string, string>;
}

/**
 * Droits demandés à l'outil à la connexion : « lecture » (synchro de l'outil vers le jeu, par défaut) ou « ecriture »
 * (synchro dans les deux sens, ou du jeu vers l'outil). Le relais en déduit la portée minimale à demander.
 */
export type DroitsOAuth = 'lecture' | 'ecriture';
export const estDroits = (x: unknown): x is DroitsOAuth => x === 'lecture' || x === 'ecriture';

export interface ConnexionOAuth extends JetonsOAuth {
  fournisseur: FournisseurOAuth;
  /** Droits demandés à la connexion (absent : connexion d'avant ce choix, droits complets). */
  droits?: DroitsOAuth;
  /**
   * Origine du relais (Breizhcosystem) qui a remis ces jetons : le jeton de rafraîchissement n'est jamais envoyé à un autre
   * relais (adresse de Breizhcosystem changée depuis la connexion → il faut se reconnecter).
   */
  relais?: string;
}

export type RetraitOAuth = { statut: 'attente' } | { statut: 'connecte'; connexion: ConnexionOAuth } | { statut: 'refuse' | 'expire'; message: string };

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Jeton : caractères visibles uniquement (aucun espace, retour à la ligne ou caractère de contrôle), 8000 au plus. */
const JETON = /^[\x21-\x7e]{1,8000}$/;
const ATTENTE = /^[A-Za-z0-9_-]{43}$/;
export const BOUTIQUE_SHOPIFY = /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/;
const DOMAINE_PIPEDRIVE = /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.pipedrive\.com$/;
const CLE_WOO = /^ck_[A-Za-z0-9]{20,64}$/;
const localAutorise = () => process.env.LB_AUTORISER_LOCAL === '1';

/**
 * Outils dont la connexion passe par un compte Microsoft 365 professionnel (Entra ID) : leur refus se traduit par
 * `conseilMicrosoft`.
 */
const MICROSOFT: ReadonlySet<FournisseurOAuth> = new Set<FournisseurOAuth>(['microsoft', 'dynamics', 'businesscentral']);

/**
 * Refus d'une connexion Microsoft, traduit en conseil utilisable. Les codes AADSTS ne servent qu'à reconnaître la
 * situation : Microsoft prévient que ses codes et ses messages peuvent changer, donc rien ici n'en dépend pour
 * fonctionner — sans code reconnu, le message d'origine est gardé.
 *
 * Le cas le plus courant est le COMPTE PERSONNEL (outlook.com, hotmail.fr, live.fr). La connexion passe par le point
 * d'entrée « organizations » de Microsoft, réservé aux comptes professionnels ou scolaires : un compte personnel est
 * refusé dès la page de connexion. C'est voulu — l'API Excel de Microsoft ne lit pas les classeurs d'un OneDrive
 * personnel (« Support for workbooks stored in OneDrive Consumer platform is still not available. »), et Dynamics 365
 * comme Business Central n'existent que pour un compte professionnel : être refusé tout de suite vaut mieux que de se
 * connecter pour rien.
 * https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols — points d'entrée common / organizations / consumers
 * https://learn.microsoft.com/en-us/entra/identity-platform/reference-error-codes — AADSTS500208, 500207, 50020, 65001, 700016, 53003
 * https://learn.microsoft.com/en-us/graph/api/resources/excel — OneDrive personnel non pris en charge
 */
export function conseilMicrosoft(texte: string): string | null {
  const t = texte ?? '';
  const code = (...codes: string[]) => codes.some((c) => t.includes(c));
  if (code('AADSTS500208', 'AADSTS500207', 'AADSTS50020', 'AADSTS16000') || /compte (personnel|microsoft personnel)|personal microsoft account|n’existe pas dans|does not exist in tenant/i.test(t)) {
    return 'Ce compte Microsoft n’est pas un compte professionnel : Living Business se connecte à Microsoft 365 (OneDrive Entreprise, SharePoint, Dynamics 365, Business Central), pas à un compte personnel Outlook, Hotmail ou Live. Reconnectez-vous avec l’adresse de votre entreprise. Vos fichiers sont sur un compte personnel ? Importez-les en fichier : « Connecter mes données » → « Sans rien connecter ».';
  }
  if (code('AADSTS65001', 'AADSTS90094') || /consent_required/i.test(t)) {
    return 'Microsoft attend une autorisation : reconnectez-vous et acceptez l’accès à vos fichiers. Si Microsoft répond que seul un administrateur peut accepter, demandez-le à la personne qui gère Microsoft 365 chez vous.';
  }
  if (code('AADSTS53003', 'AADSTS530035', 'AADSTS530036', 'AADSTS50158', 'AADSTS50076', 'AADSTS50079')) {
    return 'Microsoft a bloqué la connexion au nom d’une règle de sécurité de votre entreprise (accès conditionnel, double authentification, appareil géré). Demandez à la personne qui gère Microsoft 365 d’autoriser cette connexion, ou connectez-vous depuis un appareil et un réseau autorisés.';
  }
  if (code('AADSTS700016', 'AADSTS50194', 'AADSTS900382')) {
    return 'Microsoft ne reconnaît pas Living Business dans votre annuaire : la connexion doit être acceptée une première fois par la personne qui gère Microsoft 365 chez vous. Elle peut aussi la bloquer volontairement (« applications approuvées seulement »).';
  }
  if (code('AADSTS50105', 'AADSTS501051')) {
    return 'Votre compte Microsoft n’est pas autorisé pour cette application : la personne qui gère Microsoft 365 doit vous y affecter (Applications d’entreprise → Utilisateurs et groupes).';
  }
  if (code('AADSTS650057')) {
    return 'Microsoft refuse l’accès demandé : l’autorisation correspondante manque côté Living Business. Signalez-le, et en attendant branchez le classeur par fichier ou avec une clé.';
  }
  if (code('AADSTS90002')) return 'Microsoft ne trouve pas l’annuaire de votre entreprise : vérifiez que vous vous connectez bien avec l’adresse de votre entreprise.';
  return null;
}

/** Texte d'une ligne, sans caractère de contrôle ni de direction, tronqué. */
function ligne(x: unknown, max: number): string | null {
  if (typeof x !== 'string' && typeof x !== 'number') return null;
  const t = String(x).replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

/** Adresse https d'un site (WooCommerce) : origine + chemin, sans barre finale ; null sinon. */
export function siteHttps(x: unknown): string | null {
  if (typeof x !== 'string' || x.length > 500) return null;
  try {
    const u = new URL(x.trim());
    const local = localAutorise() && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname);
    if ((u.protocol !== 'https:' && !local) || u.username || u.password) return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  } catch { return null; }
}

/** Informations complémentaires remises avec les jetons : seulement celles connues, relues une par une. */
function lireExtra(x: unknown): Record<string, string> {
  const o = estObj(x) ? x : {};
  const r: Record<string, string> = {};
  for (const k of ['workspace_name', 'workspace_id', 'bot_id', 'hub_domain', 'hub_id']) {
    const v = ligne(o[k], 200);
    if (v) r[k] = v;
  }
  const api = ligne(o.api_domain, 200)?.toLowerCase().replace(/\/+$/, '');
  if (api && DOMAINE_PIPEDRIVE.test(api)) r.api_domain = api;
  const b = ligne(o.boutique, 200)?.toLowerCase();
  if (b && BOUTIQUE_SHOPIFY.test(b)) r.boutique = b;
  const ck = ligne(o.cleClient, 100);
  if (ck && CLE_WOO.test(ck)) r.cleClient = ck;
  const site = siteHttps(o.site);
  if (site) r.site = site;
  const org = ligne(o.organisation, 200)?.toLowerCase().replace(/\/+$/, '');
  if (org && ORGANISATION_DYNAMICS.test(org)) r.organisation = org;
  return r;
}

/** Jetons remis par le relais : null s'ils sont inutilisables. */
export function lireJetons(fournisseur: FournisseurOAuth, x: unknown): JetonsOAuth | null {
  if (!estObj(x)) return null;
  const acces = typeof x.acces === 'string' && JETON.test(x.acces) ? x.acces : null;
  if (!acces) return null;
  const rafraichissement = typeof x.rafraichissement === 'string' && JETON.test(x.rafraichissement) ? x.rafraichissement : null;
  const date = (v: unknown) => (typeof v === 'string' && v.length <= 40 ? Date.parse(v) : Number.NaN);
  const t = date(x.expire);
  const tr = rafraichissement ? date(x.rafraichissementExpire) : Number.NaN;
  const extra = lireExtra(x.extra);
  if (fournisseur === 'woocommerce' && (!extra.cleClient || !extra.site || !/^cs_[A-Za-z0-9]{20,64}$/.test(acces))) return null;
  return { acces, rafraichissement, expire: Number.isFinite(t) ? new Date(t).toISOString() : null, ...(Number.isFinite(tr) ? { rafraichissementExpire: new Date(tr).toISOString() } : {}), extra };
}

// ---------------------------------------------------------------- secret enregistré (chiffré) d'une connexion par le relais

/** Secret du connecteur pour une connexion par le relais : `{"oauth":{…}}`, chiffré au repos comme les autres. */
export function enveloppe(c: ConnexionOAuth): string {
  return JSON.stringify({ oauth: { fournisseur: c.fournisseur, acces: c.acces, rafraichissement: c.rafraichissement, expire: c.expire, ...(c.rafraichissementExpire ? { rafraichissementExpire: c.rafraichissementExpire } : {}), extra: c.extra, ...(c.relais ? { relais: c.relais } : {}), ...(c.droits ? { droits: c.droits } : {}) } });
}
const ORIGINE = /^https?:\/\/[a-z0-9.-]{1,253}(?::\d{1,5})?$/;

export function lireEnveloppe(secret: string | null | undefined): ConnexionOAuth | null {
  if (typeof secret !== 'string' || !secret.startsWith('{"oauth":') || secret.length > 40_000) return null;
  try {
    const o = (JSON.parse(secret) as { oauth?: unknown }).oauth;
    if (!estObj(o) || !estFournisseur(o.fournisseur)) return null;
    const j = lireJetons(o.fournisseur, o);
    return j ? { fournisseur: o.fournisseur, ...j, ...(typeof o.relais === 'string' && ORIGINE.test(o.relais) ? { relais: o.relais } : {}), ...(estDroits(o.droits) ? { droits: o.droits } : {}) } : null;
  } catch { return null; }
}

/** Un secret collé qui imiterait une connexion par le relais est refusé (seul le jeu en fabrique). */
export const ressembleEnveloppe = (s: string): boolean => /^\s*\{\s*"oauth"/.test(s);

/** Jeton d'accès bientôt expiré (moins de 2 minutes) : à renouveler avant l'appel. */
export function bientotExpire(c: ConnexionOAuth, maintenant = Date.now()): boolean {
  if (!c.expire) return false;
  const t = Date.parse(c.expire);
  return Number.isFinite(t) && t - maintenant < 120_000;
}

/** Réglages vus par l'adaptateur : fournisseur (clé réservée) + informations du compte connecté. */
export function configAvecConnexion(cfg: Readonly<Record<string, string>>, c: ConnexionOAuth): Record<string, string> {
  const r: Record<string, string> = { ...cfg, [CLE_OAUTH]: c.fournisseur };
  if (c.fournisseur === 'pipedrive' && c.extra.api_domain) r.domaine = c.extra.api_domain;
  if (c.fournisseur === 'shopify') {
    if (c.extra.boutique) r.boutique = c.extra.boutique;
    r.clientId = ''; // jeton hors ligne de l'application : aucun échange « client credentials »
  }
  if (c.fournisseur === 'dynamics' && c.extra.organisation) r.organisation = c.extra.organisation;
  if (c.fournisseur === 'woocommerce') {
    r.boutique = c.extra.site ?? r.boutique ?? '';
    r.cle = c.extra.cleClient ?? '';
  }
  return r;
}

/**
 * Ce qu'on peut montrer du compte connecté (jamais un jeton) : espace Notion, compte HubSpot (son domaine, lu par le
 * relais ; à défaut son numéro, que HubSpot donne avec le jeton), boutique…
 */
export function compteConnecte(c: ConnexionOAuth): string | null {
  const e = c.extra;
  return e.workspace_name ?? e.hub_domain ?? (e.hub_id ? `compte HubSpot n° ${e.hub_id}` : undefined) ?? e.boutique ?? e.site ?? (e.organisation ?? e.api_domain)?.replace(/^https:\/\//, '') ?? null;
}

// ---------------------------------------------------------------- page de connexion de l'outil

/** Page de connexion renvoyée par le relais : https, sur l'hôte attendu de l'outil (ou de la boutique) ; null sinon. */
function pageConnexion(f: FournisseurOAuth, x: unknown, p: { boutique?: string; site?: string }): string | null {
  if (typeof x !== 'string' || x.length > 4000) return null;
  let u: URL;
  try { u = new URL(x); } catch { return null; }
  if (u.username || u.password) return null;
  if (localAutorise() && u.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(u.hostname)) return u.toString();
  if (u.protocol !== 'https:') return null;
  if (f === 'woocommerce') {
    const site = p.site ? new URL(p.site) : null;
    return site && u.origin === site.origin && u.pathname.endsWith('/wc-auth/v1/authorize') ? u.toString() : null;
  }
  if (u.port !== '') return null;
  if (f === 'shopify') return p.boutique && u.hostname === p.boutique ? u.toString() : null;
  return HOTES_CONNEXION[f]?.includes(u.hostname) ? u.toString() : null;
}

// ---------------------------------------------------------------- client du relais

export interface OptionsRelais {
  /** Adresse de Breizhcosystem connue du jeu (Réglages → Breizhcosystem, ou LB_NEXUS_URL) ; null = pas de connexion directe. */
  adresse: () => string | null;
  fetch?: Recuperateur;
}

/**
 * Outils que le relais révoque avec le jeton d'ACCÈS (Notion : `/v1/oauth/revoke` ne prend que lui). Une connexion
 * Notion ancienne n'a que ce jeton ; une récente a aussi un jeton de renouvellement : les deux partent alors au relais.
 */
const REVOCATION_PAR_ACCES: ReadonlySet<FournisseurOAuth> = new Set<FournisseurOAuth>(['notion']);

export class RelaisOAuth {
  readonly #adresse: () => string | null;
  readonly #f: Recuperateur;
  #liste: { adresse: string; jusqua: number; fournisseurs: FournisseurOAuth[]; lue: boolean } | null = null;

  constructor(o: OptionsRelais) {
    this.#adresse = o.adresse;
    this.#f = o.fetch ?? recuperateurProtege;
  }

  /** Origine actuelle du relais (adresse de Breizhcosystem vérifiée). */
  async origine(): Promise<string> {
    const brut = this.#adresse();
    if (!brut) throw new ErreurSortante('Connexion directe indisponible : adresse de Breizhcosystem non réglée. Utilisez une clé (mode avancé).');
    const base = await verifierUrl(brut);
    return `${base.protocol}//${base.host}`;
  }

  async #appel(methode: 'GET' | 'POST', chemin: string, corps?: unknown, delaiMs = 15_000, attendue: string | null = null): Promise<{ statut: number; json: Record<string, unknown> }> {
    const origine = await this.origine();
    if (attendue && attendue !== origine) throw new ErreurSortante('L’adresse de Breizhcosystem a changé depuis la connexion : reconnectez-vous (Réglages → Outils branchés → « Se reconnecter »). Le jeton n’a pas été envoyé.', 401);
    const u = new URL(chemin, origine);
    let r: Response;
    try {
      r = await this.#f(u, {
        method: methode, redirect: 'manual', signal: AbortSignal.timeout(delaiMs),
        headers: { accept: 'application/json', 'user-agent': 'LivingBusiness/0.1 (+auto-heberge)', ...(corps !== undefined ? { 'content-type': 'application/json', 'x-nx-requete': '1' } : {}) },
        body: corps === undefined ? null : JSON.stringify(corps),
      });
    } catch (e) {
      throw new ErreurSortante(e instanceof Error && e.name === 'TimeoutError' ? 'Le relais de connexion (Breizhcosystem) ne répond pas : réessayez.' : 'Relais de connexion (Breizhcosystem) injoignable : réessayez, ou utilisez une clé (mode avancé).');
    }
    if (r.status >= 300 && r.status < 400) throw new ErreurSortante('Redirection refusée par sécurité.', r.status);
    const texte = await lireTexteBorne(r, 100_000, 'Réponse du relais de connexion trop volumineuse.');
    let json: Record<string, unknown> = {};
    try { const v = JSON.parse(texte) as unknown; if (estObj(v)) json = v; } catch { /* réponse non JSON : statut seul */ }
    return { statut: r.status, json };
  }

  /** Outils ouverts en « Se connecter avec… » ; liste vide si Breizhcosystem n'est pas réglé ou injoignable (jamais d'erreur). */
  async fournisseurs(): Promise<FournisseurOAuth[]> {
    const adresse = this.#adresse();
    if (!adresse) return [];
    if (this.#liste && this.#liste.adresse === adresse && this.#liste.jusqua > Date.now()) return this.#liste.fournisseurs;
    let fournisseurs: FournisseurOAuth[] = [];
    let ok = false;
    try {
      const { statut, json } = await this.#appel('GET', '/v0/oauth/fournisseurs', undefined, 4000);
      if (statut === 200 && Array.isArray(json.fournisseurs)) {
        ok = true;
        fournisseurs = [...new Set(json.fournisseurs.slice(0, 50).map((x) => (estObj(x) ? x.id : null)).filter(estFournisseur))];
      }
    } catch { /* relais injoignable : les clés restent proposées */ }
    this.#liste = { adresse, fournisseurs, jusqua: Date.now() + (ok ? 5 * 60_000 : 60_000), lue: ok };
    return fournisseurs;
  }

  /** Adresse de Breizhcosystem réglée (aucun appel réseau). */
  regle(): boolean {
    return Boolean(this.#adresse());
  }

  /**
   * Outils ouverts d'après la DERNIÈRE liste lue (après un clic sur « Se connecter avec… »), sans appel réseau ;
   * null si elle n'a jamais été lue pour l'adresse actuelle (ou si Breizhcosystem était injoignable : les boutons restent
   * proposés, le prochain clic redemandera). Ouvrir « Connecter mes données » ne contacte pas Breizhcosystem.
   */
  fournisseursConnus(): FournisseurOAuth[] | null {
    const adresse = this.#adresse();
    return adresse && this.#liste?.lue && this.#liste.adresse === adresse ? this.#liste.fournisseurs : null;
  }

  /** Oublie la liste en cache (tests, changement d'adresse de Breizhcosystem). */
  oublier() {
    this.#liste = null;
  }

  /** Étape 1 : page de connexion de l'outil + secret d'attente (à garder côté serveur). */
  async demarrer(fournisseur: FournisseurOAuth, p: { boutique?: string; site?: string; organisation?: string; retour?: string | null; droits?: DroitsOAuth }): Promise<{ url: string; attente: string; verification: string | null; expire: number }> {
    const nom = NOM_FOURNISSEUR[fournisseur];
    const corps: Record<string, string> = { fournisseur };
    // portée minimale : lecture seule sauf synchro qui écrit dans l'outil
    if (p.droits) corps.droits = p.droits;
    if (p.boutique) corps.boutique = p.boutique;
    if (p.organisation) corps.organisation = p.organisation;
    if (p.site) corps.site = p.site;
    if (p.retour) corps.retour = p.retour;
    const { statut, json } = await this.#appel('POST', '/v0/oauth/demarrer', { ...corps, codeAffiche: true });
    if (statut !== 200) {
      const brut = ligne(json.message, 300) ?? `Connexion à ${nom} impossible pour le moment (${statut}) : utilisez une clé (mode avancé).`;
      throw new ErreurSortante((MICROSOFT.has(fournisseur) ? conseilMicrosoft(brut) : null) ?? brut, statut);
    }
    const url = pageConnexion(fournisseur, json.url, p);
    const attente = typeof json.attente === 'string' && ATTENTE.test(json.attente) ? json.attente : null;
    if (!url || !attente) throw new ErreurSortante(`Page de connexion ${nom} inattendue : connexion annulée par sécurité.`);
    const t = typeof json.expire === 'string' ? Date.parse(json.expire) : Number.NaN;
    const maintenant = Date.now();
    // code court de la demande : le jeu l'affiche, Breizhcosystem le montre sur sa page de confirmation (même personne, même demande)
    const verification = typeof json.verification === 'string' && /^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(json.verification) ? json.verification : null;
    return { url, attente, verification, expire: Number.isFinite(t) ? Math.min(t, maintenant + 15 * 60_000) : maintenant + 10 * 60_000 };
  }

  /** Étape 4 : jetons remis UNE fois quand la personne a accepté ; « expire » si le relais ne connaît plus l'attente. */
  async retrait(fournisseur: FournisseurOAuth, attente: string): Promise<RetraitOAuth> {
    const nom = NOM_FOURNISSEUR[fournisseur];
    const { statut, json } = await this.#appel('POST', '/v0/oauth/retrait', { attente });
    if (statut === 404) return { statut: 'expire', message: `La connexion a expiré : relancez « Se connecter avec ${nom} ».` };
    if (statut !== 200) throw new ErreurSortante(ligne(json.message, 300) ?? `Relais de connexion : erreur ${statut}.`, statut);
    if (json.statut === 'attente') return { statut: 'attente' };
    if (json.statut === 'refuse') {
      const brut = ligne(json.message, 300) ?? `Connexion refusée dans ${nom}.`;
      return { statut: 'refuse', message: (MICROSOFT.has(fournisseur) ? conseilMicrosoft(brut) : null) ?? brut };
    }
    if (json.statut === 'connecte') {
      if (json.fournisseur !== fournisseur) throw new ErreurSortante('Réponse du relais de connexion inattendue : connexion annulée.');
      const j = lireJetons(fournisseur, json.jetons);
      if (!j) throw new ErreurSortante(`${nom} n’a pas remis de jeton utilisable : relancez la connexion.`);
      return { statut: 'connecte', connexion: { fournisseur, ...j, relais: await this.origine() } };
    }
    throw new ErreurSortante('Réponse du relais de connexion illisible.');
  }

  /**
   * « Débrancher » un outil relié par « Se connecter avec… » (contre-revue de l'audit, constat revue-reseau-11) : le relais
   * cesse de renouveler cette connexion (une copie du jeton, dans une sauvegarde ou chez un ancien salarié, ne sert plus),
   * et la révoque chez l'outil quand celui-ci l'exige avec le secret de l'application (Pipedrive, Notion, HubSpot).
   * `chezOutil` faux : un autre branchement se sert encore du même accès, le relais ne coupe que cette connexion-ci.
   * Le jeton ne part que vers le relais qui l'a remis. Vrai si l'outil a confirmé la révocation.
   */
  async revoquer(c: ConnexionOAuth, chezOutil: boolean): Promise<boolean> {
    // jeton de renouvellement : le relais y reconnaît la connexion et cesse de la renouveler. Jeton d'accès : il ne part
    // au relais que si celui-ci s'en sert pour révoquer chez l'outil (Notion), en plus du jeton de renouvellement s'il y
    // en a un — avant, une connexion Notion récente n'envoyait que ce dernier et restait ouverte chez Notion.
    const jeton: { rafraichissement?: string; acces?: string } = {
      ...(c.rafraichissement ? { rafraichissement: c.rafraichissement } : {}),
      ...(chezOutil && REVOCATION_PAR_ACCES.has(c.fournisseur) ? { acces: c.acces } : {}),
    };
    if (!jeton.rafraichissement && !jeton.acces) return false;
    const { statut, json } = await this.#appel('POST', '/v0/oauth/revoquer', { fournisseur: c.fournisseur, ...jeton, ...(chezOutil ? {} : { chezOutil: false }) }, 10_000, c.relais ?? null);
    return statut === 200 && json.chezOutil === 'revoque';
  }

  /** Nouveau jeton d'accès ; garde l'ancien jeton de rafraîchissement si l'outil n'en donne pas de nouveau. */
  async rafraichir(c: ConnexionOAuth): Promise<ConnexionOAuth> {
    const nom = NOM_FOURNISSEUR[c.fournisseur];
    const expiree = new ErreurSortante(`Connexion ${nom} expirée ou retirée : reconnectez-vous (Réglages → Outils branchés → « Se reconnecter »).`, 401);
    if (!c.rafraichissement) throw expiree;
    // jeton de renouvellement lui-même expiré (Shopify : 90 jours sans renouvellement) : l'outil le refuserait, il ne part pas
    if (c.rafraichissementExpire && Date.parse(c.rafraichissementExpire) <= Date.now()) throw expiree;
    // le jeton de rafraîchissement ne part que vers le relais qui l'a remis (connexion ancienne : liée au relais actuel)
    const relais = c.relais ?? (await this.origine());
    // boutique Shopify, organisation Dynamics : le relais y bâtit l'adresse de jeton et vérifie que c'est celle de la connexion
    const ou = { ...(c.extra.organisation ? { organisation: c.extra.organisation } : {}), ...(c.fournisseur === 'shopify' && c.extra.boutique ? { boutique: c.extra.boutique } : {}) };
    const { statut, json } = await this.#appel('POST', '/v0/oauth/rafraichir', { fournisseur: c.fournisseur, rafraichissement: c.rafraichissement, ...ou, ...(c.droits ? { droits: c.droits } : {}) }, 15_000, relais);
    if (statut === 401 || json.erreur === 'connexion_expiree') throw expiree;
    if (statut !== 200) throw new ErreurSortante(ligne(json.message, 300) ?? `Renouvellement de la connexion ${nom} impossible (${statut}) : nouvel essai à la prochaine synchronisation.`, statut);
    const j = lireJetons(c.fournisseur, json);
    if (!j) throw new ErreurSortante(`${nom} n’a pas remis de jeton utilisable au renouvellement.`);
    // fin du jeton de renouvellement : celle du nouveau jeton ; un relais d'avant ne la donne pas (inconnue, donc absente)
    return { fournisseur: c.fournisseur, acces: j.acces, rafraichissement: j.rafraichissement ?? c.rafraichissement, expire: j.expire, ...(j.rafraichissementExpire ? { rafraichissementExpire: j.rafraichissementExpire } : {}), extra: { ...c.extra, ...j.extra }, relais, ...(c.droits ? { droits: c.droits } : {}) };
  }
}
