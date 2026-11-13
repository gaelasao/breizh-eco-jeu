/**
 * Adaptateurs vers les outils de l'entreprise : lecture (réel → jeu) et écriture (jeu → réel).
 * Chaque adaptateur ne connaît QUE son outil ; le rapprochement avec le monde est fait par `synchro.ts`.
 * Hôtes fixes pour Airtable, Notion, HubSpot ; adresses libres (webhook, API, MCP) vérifiées par `verifierUrl`.
 * Les identifiants fournis par l'utilisateur sont validés avant d'être placés dans un chemin d'URL.
 */
import { createHmac } from 'node:crypto';
import { telechargerSheets, validerLienSheets } from './connecteurs.ts';
import { parserCsv } from './csv.ts';
import { parRelais } from './oauth-relais.ts';
import { ecrireFeuilleGoogle, lireFeuilleGoogle } from './sources-google.ts';
import { businessCentral, dynamics365 } from './sources-dynamics.ts';
import { excel365 } from './sources-microsoft.ts';
import { agendagoogle, agendamicrosoft } from './sources-agenda.ts';
import { gmail, outlook } from './sources-courrier.ts';
import { lignesVersEnregistrements, sansFormule } from './tableau.ts';
import { odoo, pennylane, pipedrive, qonto, shopify } from './sources-metier.ts';
import { axonaut, prestashop, sellsy, stripe, woocommerce } from './sources-metier-2.ts';
import { appeler, ErreurReglage, ErreurSortante, lireTexteBorne, verifierUrl, type Recuperateur } from './sortant.ts';

export type TypeSource = 'airtable' | 'notion' | 'hubspot' | 'pennylane' | 'qonto' | 'odoo' | 'pipedrive' | 'shopify' | 'axonaut' | 'stripe' | 'woocommerce' | 'prestashop' | 'sellsy' | 'sheets' | 'excel365' | 'dynamics365' | 'businesscentral' | 'agendagoogle' | 'agendamicrosoft' | 'gmail' | 'outlook' | 'webhook' | 'rest' | 'mcp';

export interface Enregistrement {
  externeId: string;
  champs: Record<string, string>;
}

export type ValeurSortante = string | number | boolean | null;

export interface ChampConfig {
  id: string;
  libelle: string;
  aide: string;
  exemple?: string;
  obligatoire?: boolean;
  secret?: boolean;
  choix?: readonly string[];
  /** Secret obtenu par une connexion au compte de l'entreprise (bouton) plutôt que collé. */
  connexion?: 'microsoft';
  /**
   * `cle` : seulement quand l'outil est branché par une clé, un jeton ou un script (mode avancé) ;
   * `oauth` : seulement quand il est branché par « Se connecter avec… » (relais de Breizhcosystem). Sans mode : les deux.
   */
  mode?: 'cle' | 'oauth';
  /** Les valeurs possibles se lisent dans l'outil une fois connecté (`Adaptateur.choix`) : liste à choisir. */
  liste?: boolean;
  /** Réglage technique facultatif : rangé dans « Réglages pour votre informaticien », replié (P4, annexe B). */
  avance?: boolean;
}

/** Valeur proposée dans une liste lue dans l'outil (base Airtable, base de données Notion…). */
export interface Choix {
  valeur: string;
  libelle: string;
}

/** Ce qu'un adaptateur peut demander au jeu pendant un appel. */
export interface ContexteAdaptateur {
  /** Enregistre (chiffré) un secret renouvelé par le service, ex. jeton de rafraîchissement Microsoft. */
  majSecret(nouveau: string): void;
  /** Précision à montrer à la personne quand l'appel a réussi (ex. lequel des tableaux d'une base Notion est lu). */
  avis?(texte: string): void;
}

export interface Adaptateur {
  id: TypeSource;
  nom: string;
  categorie: string;
  description: string;
  couleur: string;
  etapes: readonly string[];
  champs: readonly ChampConfig[];
  lecture: 'appel' | 'reception';
  ecriture: boolean;
  lire(cfg: Readonly<Record<string, string>>, secret: string | null, f: Recuperateur, ctx?: ContexteAdaptateur): Promise<Enregistrement[]>;
  ecrire?(cfg: Readonly<Record<string, string>>, secret: string | null, externeId: string | null, valeurs: Record<string, ValeurSortante>, f: Recuperateur, ctx?: ContexteAdaptateur): Promise<string | null>;
  /** Valeurs possibles d'un champ marqué `liste`, lues dans l'outil avec le jeton (après connexion). */
  choix?(champ: string, cfg: Readonly<Record<string, string>>, secret: string | null, f: Recuperateur, ctx?: ContexteAdaptateur): Promise<Choix[]>;
}

// ---------------------------------------------------------------- outils communs

/** Ramène n'importe quelle valeur d'API à un texte lisible (listes jointes, objets nommés). */
export function aplatir(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(aplatir).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['name', 'title', 'plain_text', 'email', 'label', 'value', 'text', 'start', 'id']) if (k in o && o[k] !== null && typeof o[k] !== 'object') return String(o[k]);
    return JSON.stringify(o).slice(0, 500);
  }
  return '';
}

const exiger = (cfg: Readonly<Record<string, string>>, cle: string, re: RegExp, message: string): string => {
  const v = (cfg[cle] ?? '').trim();
  if (!re.test(v)) throw new ErreurReglage(message, cle);
  return v;
};

const jeton = (secret: string | null, nom: string): string => {
  if (!secret) throw new ErreurReglage(`Jeton ${nom} manquant.`, 'jeton');
  return secret;
};

function valeurChemin(x: unknown, chemin: string): unknown {
  if (!chemin) return x;
  let c: unknown = x;
  for (const k of chemin.split('.').filter(Boolean)) {
    if (c === null || typeof c !== 'object') return undefined;
    c = (c as Record<string, unknown>)[k];
  }
  return c;
}

/** Trouve le tableau d'enregistrements dans une réponse (racine, chemin donné, ou 1re propriété tableau). */
export function trouverListe(x: unknown, chemin = ''): Record<string, unknown>[] {
  const v = valeurChemin(x, chemin);
  if (Array.isArray(v)) return v.filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object');
  if (v && typeof v === 'object') {
    for (const val of Object.values(v as Record<string, unknown>)) if (Array.isArray(val)) return trouverListe(val);
  }
  return [];
}

/** Aplatit un objet sur un niveau : { adresse: { ville } } → « adresse.ville ». */
export function aplatirObjet(o: Record<string, unknown>): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const nomme = aplatir(v);
      if (!nomme.startsWith('{')) { r[k] = nomme; continue; }
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) r[`${k}.${k2}`] = aplatir(v2);
    } else r[k] = aplatir(v);
  }
  return r;
}

/** Nom lu dans un outil pour une liste de choix : une ligne, sans caractère de contrôle, 200 caractères au plus. */
const nomCourt = (x: unknown): string => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ' ').trim().slice(0, 200) : '');

// ---------------------------------------------------------------- signatures des webhooks (entrée et envois)
// En-tête X-LB-Signature : « t=<secondes>,v1=<HMAC-SHA256(clé, `${t}.${corps}`) en hexadécimal> » (forme de Stripe).
// Entrée : clé = secret d'entrée affiché à la création ; 5 minutes d'écart au plus, une signature ne sert qu'une fois.
// Envois du jeu : clé DÉRIVÉE du secret d'entrée (cleEnvois), distincte : une signature d'envoi ne vaut jamais en entrée,
// et qui ne détient que la clé des envois (le scénario qui les reçoit) ne peut rien faire entrer dans le jeu.

/** Écart toléré entre l'horodatage signé et l'horloge du serveur. */
export const TOLERANCE_SIGNATURE_S = 300;

/** Clé de signature des envois du jeu : HMAC-SHA256(secret d'entrée, « living-business:webhook:envois:v1 »), en hexadécimal. */
export const cleEnvois = (secretEntrant: string) => createHmac('sha256', secretEntrant).update('living-business:webhook:envois:v1').digest('hex');

/** Valeur de l'en-tête X-LB-Signature pour `corps` signé avec `cle` à l'instant `t` (secondes). */
export function signer(cle: string, corps: string, t: number = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac('sha256', cle).update(`${t}.${corps}`).digest('hex')}`;
}

/** Signature d'un envoi du jeu (jamais avec le secret d'entrée lui-même). */
export const signerEnvoi = (secretEntrant: string, corps: string, t?: number) => signer(cleEnvois(secretEntrant), corps, t);

/** Lit « t=…,v1=… » ; null si l'en-tête n'a pas cette forme (ancienne forme « sha256=… » comprise : sans horodatage). */
export function lireSignature(entete: string): { t: number; v1: string } | null {
  const champs = new Map(entete.split(',').map((x) => { const i = x.indexOf('='); return [x.slice(0, i).trim(), x.slice(i + 1).trim()] as const; }));
  const t = champs.get('t') ?? '';
  const v1 = champs.get('v1') ?? '';
  return /^\d{9,11}$/.test(t) && /^[0-9a-f]{64}$/.test(v1) ? { t: Number(t), v1 } : null;
}

// ---------------------------------------------------------------- Airtable

const AIRTABLE = 'https://api.airtable.com/v0';
const airtable: Adaptateur = {
  id: 'airtable', nom: 'Airtable', categorie: 'Base de données', couleur: '#18bfff',
  description: 'Une table Airtable (clients, fournisseurs, stock…) synchronisée dans les deux sens.',
  etapes: [
    'Sur airtable.com/create/tokens : « Create token », droits data.records:read (+ data.records:write pour écrire, + webhook:manage pour le temps réel), accès à votre base.',
    'Ouvrez la table : l’adresse contient l’identifiant de base « app… ».',
    'Indiquez le nom exact de la table (ou son identifiant « tbl… »).',
  ],
  champs: [
    { id: 'base', libelle: 'Base', aide: 'Identifiant app…, visible dans l’adresse de la base.', exemple: 'appXXXXXXXXXXXXXX', obligatoire: true, liste: true },
    { id: 'table', libelle: 'Table', aide: 'Nom exact ou identifiant tbl…', exemple: 'Clients', obligatoire: true, liste: true },
    { id: 'vue', libelle: 'Vue (facultatif)', aide: 'Pour ne lire qu’une vue filtrée.' },
    { id: 'jeton', libelle: 'Jeton d’accès personnel', aide: 'Commence par pat… Chiffré sur le serveur.', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const base = exiger(cfg, 'base', /^app[A-Za-z0-9]{14}$/, 'Identifiant de base Airtable invalide (app + 14 caractères).');
    const table = exiger(cfg, 'table', /^.{1,120}$/, 'Nom de table manquant.');
    const res: Enregistrement[] = [];
    let offset = '';
    for (let page = 0; page < 50; page++) {
      const u = new URL(`${AIRTABLE}/${base}/${encodeURIComponent(table)}`);
      u.searchParams.set('pageSize', '100');
      if (cfg.vue) u.searchParams.set('view', cfg.vue);
      if (offset) u.searchParams.set('offset', offset);
      const { donnees } = await appeler(f, u, { entetes: { authorization: `Bearer ${jeton(secret, 'Airtable')}` } });
      const d = donnees as { records?: { id: string; fields: Record<string, unknown> }[]; offset?: string };
      for (const r of d.records ?? []) res.push({ externeId: r.id, champs: aplatirObjet(r.fields ?? {}) });
      if (!d.offset) break;
      offset = d.offset;
    }
    return res;
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const base = exiger(cfg, 'base', /^app[A-Za-z0-9]{14}$/, 'Identifiant de base Airtable invalide.');
    const table = encodeURIComponent(exiger(cfg, 'table', /^.{1,120}$/, 'Nom de table manquant.'));
    const entetes = { authorization: `Bearer ${jeton(secret, 'Airtable')}` };
    if (externeId) {
      if (!/^rec[A-Za-z0-9]{14}$/.test(externeId)) throw new ErreurSortante('Identifiant d’enregistrement Airtable invalide.');
      await appeler(f, new URL(`${AIRTABLE}/${base}/${table}/${externeId}`), { methode: 'PATCH', entetes, corps: { fields: valeurs, typecast: true } });
      return externeId;
    }
    const { donnees } = await appeler(f, new URL(`${AIRTABLE}/${base}/${table}`), { methode: 'POST', entetes, corps: { records: [{ fields: valeurs }], typecast: true } });
    return (donnees as { records?: { id: string }[] }).records?.[0]?.id ?? null;
  },
  /** Bases accessibles au compte connecté, puis tables de la base choisie (API « meta », droit schema.bases:read). */
  async choix(champ, cfg, secret, f) {
    const entetes = { authorization: `Bearer ${jeton(secret, 'Airtable')}` };
    const res: Choix[] = [];
    if (champ === 'base') {
      let offset = '';
      for (let page = 0; page < 10; page++) {
        const u = new URL(`${AIRTABLE}/meta/bases`);
        if (offset) u.searchParams.set('offset', offset);
        const { donnees } = await appeler(f, u, { entetes });
        const d = donnees as { bases?: unknown; offset?: unknown } | null;
        for (const b of Array.isArray(d?.bases) ? d.bases : []) {
          const x = b as { id?: unknown; name?: unknown } | null;
          if (typeof x?.id === 'string' && /^app[A-Za-z0-9]{14}$/.test(x.id)) res.push({ valeur: x.id, libelle: nomCourt(x.name) || x.id });
        }
        if (typeof d?.offset !== 'string' || !d.offset || d.offset.length > 200) break;
        offset = d.offset;
      }
    } else if (champ === 'table') {
      const base = exiger(cfg, 'base', /^app[A-Za-z0-9]{14}$/, 'Choisissez d’abord la base.');
      const { donnees } = await appeler(f, new URL(`${AIRTABLE}/meta/bases/${base}/tables`), { entetes });
      const tables = (donnees as { tables?: unknown } | null)?.tables;
      for (const t of Array.isArray(tables) ? tables : []) {
        const x = t as { id?: unknown; name?: unknown } | null;
        if (typeof x?.id === 'string' && /^tbl[A-Za-z0-9]{14}$/.test(x.id)) res.push({ valeur: x.id, libelle: nomCourt(x.name) || x.id });
      }
    }
    return res.slice(0, 500);
  },
};

// ---------------------------------------------------------------- Notion
// API Notion, version 2026-03-11. Depuis la version 2025-09-03, une « base de données » Notion est un conteneur d'un ou
// plusieurs TABLEAUX (« sources de données », data sources) : les lignes se lisent, se créent et se décrivent dans un
// tableau (/v1/data_sources/…), plus dans la base. Avec l'ancienne version (2022-06-28), une base à plusieurs tableaux
// répondait 400 « Databases with multiple data sources are not supported in this API version. » et disparaissait de la
// recherche.
// Le réglage `base` désigne :
// - « source:<32 hexa> » : un tableau précis, comme le propose la liste de l'assistant (une ligne par tableau) ;
// - « <32 hexa> » : une base (branchement enregistré avant ce changement, ou identifiant saisi à la main) ; son tableau
//   est retrouvé à chaque lecture. Si la base en contient plusieurs, règle fixe : le plus ANCIEN tableau lisible (date
//   de création donnée par Notion, puis identifiant), en pratique celui que le branchement lisait avant qu'on en ajoute
//   d'autres. La personne en est prévenue (`ctx.avis` : historique du branchement, essai de l'assistant).

const NOTION = 'https://api.notion.com/v1';
const VERSION_NOTION = '2026-03-11';
const ID_NOTION = /^[0-9a-f-]{32,36}$/i;
/** Au-delà, les tableaux d'une même base ne sont plus comparés (un appel à Notion par tableau). */
const MAX_TABLEAUX_NOTION = 20;
/** Attente la plus longue acceptée avant un nouvel essai quand Notion limite le débit (Retry-After, en secondes). */
const ATTENTE_MAX_NOTION_S = 5;
/** Ce que le dernier appel a appris d'un réglage `base` : son tableau, et le type de chaque propriété (pour écrire). */
const memoNotion = new Map<string, { source: string; types: Record<string, string> | null }>();
const memoriserNotion = (cle: string, source: string, types: Record<string, string> | null) => {
  if (memoNotion.size >= 500) memoNotion.clear();
  memoNotion.set(cle, { source, types });
};

function lireProprieteNotion(p: Record<string, unknown>): string {
  const t = p.type as string;
  const v = p[t];
  switch (t) {
    case 'title':
    case 'rich_text':
      return Array.isArray(v) ? v.map((x) => (x as { plain_text?: string }).plain_text ?? '').join('') : '';
    case 'date':
      return (v as { start?: string } | null)?.start?.slice(0, 10) ?? '';
    case 'formula':
    case 'rollup': {
      const o = v as Record<string, unknown> | null;
      return o ? aplatir(o[o.type as string]) : '';
    }
    case 'people':
    case 'multi_select':
      return Array.isArray(v) ? v.map((x) => aplatir(x)).join(', ') : '';
    case 'relation':
      return Array.isArray(v) ? v.map((x) => (x as { id: string }).id).join(', ') : '';
    default:
      return aplatir(v);
  }
}

function ecrireProprieteNotion(type: string, v: ValeurSortante): unknown {
  const texte = v === null ? '' : String(v);
  switch (type) {
    case 'title': return { title: [{ text: { content: texte.slice(0, 2000) } }] };
    case 'rich_text': return { rich_text: texte ? [{ text: { content: texte.slice(0, 2000) } }] : [] };
    case 'number': return { number: v === null || v === '' ? null : Number(v) };
    case 'select': return { select: texte ? { name: texte.slice(0, 100) } : null };
    case 'status': return { status: texte ? { name: texte.slice(0, 100) } : null };
    case 'multi_select': return { multi_select: texte.split(',').map((x) => x.trim()).filter(Boolean).map((name) => ({ name })) };
    case 'date': return { date: texte ? { start: texte.slice(0, 10) } : null };
    case 'checkbox': return { checkbox: v === true || /^(oui|vrai|true|1)$/i.test(texte) };
    case 'email': return { email: texte || null };
    case 'phone_number': return { phone_number: texte || null };
    case 'url': return { url: texte || null };
    default: return undefined; // propriété en lecture seule (formule, relation…) : jamais écrite
  }
}

/** Réglage `base` vérifié, sans tiret : « source:<32 hexa> » (un tableau) ou « <32 hexa> » (une base). */
const cleNotion = (cfg: Readonly<Record<string, string>>) => {
  const brut = exiger(cfg, 'base', /^(source:)?[0-9a-fA-F-]{32,36}$/, 'Identifiant de base de données Notion invalide (32 caractères).').replace(/-/g, '');
  if (brut.replace(/^source:/, '').length !== 32) throw new ErreurSortante('Identifiant de base de données Notion invalide.');
  return brut;
};
const sansTiret = (id: string) => id.replace(/-/g, '');
/** Identifiant de tableau tel que Notion l'écrit (8-4-4-4-12) : seuls ceux des pages et des bases sont documentés comme acceptés sans tiret. */
const avecTirets = (id: string) => id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');
/** Titre Notion (texte riche) en une ligne. */
const titreNotion = (x: unknown): string => (Array.isArray(x) ? nomCourt(x.map((t) => { const p = (t as { plain_text?: unknown } | null)?.plain_text; return typeof p === 'string' ? p : ''; }).join('').slice(0, 1000)) : '');
/** Type de chaque propriété d'un tableau (son schéma `properties`). */
const typesNotion = (proprietes: unknown): Record<string, string> => {
  const types: Record<string, string> = {};
  for (const [nom, p] of Object.entries(proprietes && typeof proprietes === 'object' ? proprietes : {})) {
    const t = (p as { type?: unknown } | null)?.type;
    if (typeof t === 'string') types[nom] = t;
  }
  return types;
};
/** Tableaux d'une base (`data_sources` de sa réponse : identifiant et nom de chacun). */
const sourcesNotion = (base: unknown): { id: string; nom: string }[] => {
  const liste = (base as { data_sources?: unknown } | null)?.data_sources;
  const res: { id: string; nom: string }[] = [];
  for (const s of Array.isArray(liste) ? liste : []) {
    const x = s as { id?: unknown; name?: unknown } | null;
    if (typeof x?.id === 'string' && ID_NOTION.test(x.id)) res.push({ id: sansTiret(x.id), nom: nomCourt(x.name) || 'Sans titre' });
  }
  return res;
};

/** À quoi sert l'appel : choisit le message quand Notion refuse (base non partagée, capacité manquante…). */
interface PourNotion { objet: 'base' | 'tableau' | 'fiche'; action: 'lire' | 'modifier' | 'creer' }

/** Refus de Notion, traduit en français ; `code` et `donnees` (additional_data) viennent de sa réponse d'erreur. */
class RefusNotion extends ErreurSortante {
  readonly code: string;
  readonly donnees: Readonly<Record<string, unknown>>;
  /** Attente demandée par Notion avant un nouvel essai (secondes), quand il la donne. */
  readonly attenteS: number | null;
  constructor(message: string, statut: number, code: string, donnees: Readonly<Record<string, unknown>>, attenteS: number | null) {
    super(message, statut);
    this.code = code;
    this.donnees = donnees;
    this.attenteS = attenteS;
  }
}

const CORBEILLE_NOTION = {
  base: 'Cette base de données Notion est dans la corbeille : restaurez-la dans Notion, ou branchez une autre base.',
  tableau: 'Ce tableau Notion est dans la corbeille : restaurez-le dans Notion, ou refaites le branchement avec un autre tableau.',
  fiche: 'Cette fiche est dans la corbeille de Notion (ou archivée) : restaurez-la dans Notion pour qu’elle soit de nouveau synchronisée.',
} as const;
const INTROUVABLE_NOTION = {
  base: 'Notion ne trouve pas cette base de données : elle n’est pas partagée avec l’intégration, ou son identifiant est inexact. Dans Notion, ouvrez la base → ••• → Connexions → ajoutez l’intégration (ou reconnectez-vous à Notion en cochant cette base).',
  tableau: 'Notion ne trouve pas ce tableau : sa base de données n’est plus partagée avec l’intégration (dans Notion : ••• → Connexions → ajoutez l’intégration), ou le tableau a été supprimé.',
  fiche: 'Notion ne trouve pas cette fiche : elle a été supprimée dans Notion, ou sa base de données n’est plus partagée avec l’intégration (dans Notion : ••• → Connexions).',
} as const;
/** Capacité de l'intégration que chaque action demande : [ce qu'elle permet, son nom dans les réglages de l'intégration]. */
const CAPACITE_NOTION = {
  lire: ['lire le contenu', 'Lire le contenu'],
  modifier: ['modifier les fiches', 'Mettre à jour le contenu'],
  creer: ['créer des fiches', 'Insérer du contenu'],
} as const;

/** Message en français pour un refus de Notion (codes de sa référence « Status codes »). */
function messageNotion(statut: number, code: string, texte: string, donnees: Readonly<Record<string, unknown>>, attenteS: number | null, pour: PourNotion): string {
  const plusTard = 'nouvel essai à la prochaine synchronisation';
  switch (code) {
    case 'unauthorized':
      return 'Accès refusé par Notion : la connexion n’est plus valable. Reconnectez-vous à Notion, ou saisissez un nouveau secret d’intégration.';
    case 'restricted_resource': {
      // même code quand un espace gratuit a utilisé tous ses blocs : `additional_data.block_limit` le distingue
      if (donnees.block_limit !== undefined) return 'Notion refuse la création : cet espace de travail gratuit a utilisé tous ses blocs. Rien n’a été créé dans Notion ; la lecture et les modifications continuent.';
      const [verbe, capacite] = CAPACITE_NOTION[pour.action];
      return `Accès refusé par Notion : l’intégration n’a pas le droit de ${verbe}. Dans Notion, réglages de l’intégration → Capacités : cochez « ${capacite} » (ou demandez-le à la personne qui gère l’intégration).`;
    }
    case 'object_not_found':
      return INTROUVABLE_NOTION[pour.objet];
    case 'rate_limited':
      if (donnees.rate_limit_reason === 'public_api_request_blocked') return 'Notion a restreint l’accès de cette intégration : réessayer n’y change rien. Contactez l’assistance de Notion.';
      return `Trop de requêtes : Notion limite le débit${donnees.rate_limit_reason === 'public_api_space_request_rate_limit' ? ' de tout l’espace de travail (quota partagé entre ses intégrations)' : ''}, ${plusTard}${attenteS === null ? '' : ` (pas avant ${attenteS} s)`}.`;
    case 'validation_error':
      // réponse faite aux anciennes versions de l'API (et à un parent « base ») quand la base a plusieurs tableaux
      if (donnees.error_type === 'multiple_data_sources_for_database') return 'Cette base de données Notion contient plusieurs tableaux : refaites le branchement en choisissant le tableau dans la liste.';
      // le texte de Notion n'est pas un contrat : il sert seulement à reconnaître, au mieux, un élément archivé ou à la corbeille
      if (/archiv|trash/i.test(texte)) return CORBEILLE_NOTION[pour.objet];
      return `Notion refuse la requête${texte ? ` : « ${texte} »` : ''}.`;
    case 'conflict_error':
      return `Notion signale un conflit d’enregistrement (deux changements en même temps) : ${plusTard}.`;
    default:
      return statut >= 500 ? `Notion est momentanément indisponible (erreur ${statut}) : ${plusTard}.` : `Notion refuse la requête (erreur ${statut})${texte ? ` : « ${texte} »` : ''}.`;
  }
}

/** Réponse d'erreur de Notion ({ object: "error", code, message, additional_data }) → refus traduit ; null si ce n'en est pas une. */
function refusNotion(statut: number, corps: string, enteteAttente: string | null, pour: PourNotion): RefusNotion | null {
  let o: unknown;
  try { o = JSON.parse(corps); } catch { return null; }
  const e = o as { code?: unknown; message?: unknown; additional_data?: unknown } | null;
  if (!e || typeof e !== 'object' || typeof e.code !== 'string') return null;
  const donnees = e.additional_data && typeof e.additional_data === 'object' && !Array.isArray(e.additional_data) ? e.additional_data as Record<string, unknown> : {};
  // l'attente de l'en-tête Retry-After est répétée dans le corps (`additional_data.retry_after`, secondes entières)
  const brut = (enteteAttente ?? (typeof donnees.retry_after === 'string' ? donnees.retry_after : '')).trim();
  const attenteS = /^\d{1,5}$/.test(brut) ? Number(brut) : null;
  return new RefusNotion(messageNotion(statut, e.code, nomCourt(e.message), donnees, attenteS, pour), statut, e.code, donnees, attenteS);
}

/**
 * Appel à l'API Notion. Il passe par `appeler` (délai, taille bornée, redirections refusées), qui ne retient d'un refus
 * que son statut : la réponse d'erreur de Notion est notée au passage, puis traduite. Débit limité (429) ou surcharge
 * (529) avec une attente courte : nouvel essai après l'attente que Notion demande, deux fois au plus.
 */
async function appelNotion(f: Recuperateur, secret: string | null, pour: PourNotion, chemin: string, methode = 'GET', corps?: unknown): Promise<unknown> {
  const entetes = { authorization: `Bearer ${jeton(secret, 'Notion')}`, 'notion-version': VERSION_NOTION };
  for (let essai = 0; ; essai++) {
    const vu: { refus: RefusNotion | null } = { refus: null };
    const observe: Recuperateur = async (entree, init) => {
      const r = await f(entree, init);
      if (r.status < 400) return r;
      const texte = await lireTexteBorne(r, 100_000).catch(() => '');
      vu.refus = refusNotion(r.status, texte, r.headers.get('retry-after'), pour);
      return new Response(texte, { status: r.status, headers: r.headers });
    };
    try {
      return (await appeler(observe, new URL(`${NOTION}${chemin}`), { methode, entetes, corps })).donnees;
    } catch (e) {
      const refus = vu.refus;
      if (!refus) throw e;
      const patienter = (refus.statut === 429 || refus.statut === 529) && refus.donnees.rate_limit_reason !== 'public_api_request_blocked'
        && refus.attenteS !== null && refus.attenteS <= ATTENTE_MAX_NOTION_S && essai < 2;
      if (!patienter) throw refus;
      await new Promise((ok) => setTimeout(ok, (refus.attenteS ?? 0) * 1000));
    }
  }
}

/** Tableau que désigne le réglage : celui choisi (« source:… »), sinon celui de la base (règle en tête de section). */
async function tableauNotion(cle: string, secret: string | null, f: Recuperateur): Promise<{ id: string; avis: string | null; types: Record<string, string> | null }> {
  if (cle.startsWith('source:')) return { id: cle.slice(7), avis: null, types: null };
  const base = await appelNotion(f, secret, { objet: 'base', action: 'lire' }, `/databases/${cle}`) as { in_trash?: unknown } | null;
  if (base?.in_trash === true) throw new ErreurSortante(CORBEILLE_NOTION.base);
  const sources = sourcesNotion(base);
  const aucun = 'Notion n’indique aucun tableau lisible dans cette base de données : l’intégration doit avoir le droit de lire le contenu, et la base ne doit pas être une simple vue liée à une autre base.';
  const [seul] = sources;
  if (!seul) throw new ErreurSortante(aucun);
  if (sources.length === 1) return { id: seul.id, avis: null, types: null };
  // plusieurs tableaux et aucun choisi : le plus ancien que l'intégration peut lire (un appel par tableau)
  const lisibles: { id: string; nom: string; cree: number; types: Record<string, string> }[] = [];
  for (const s of sources.slice(0, MAX_TABLEAUX_NOTION)) {
    let t: { in_trash?: unknown; created_time?: unknown; properties?: unknown } | null;
    try {
      t = await appelNotion(f, secret, { objet: 'tableau', action: 'lire' }, `/data_sources/${avecTirets(s.id)}`) as typeof t;
    } catch (e) {
      if (e instanceof RefusNotion && e.statut === 404) continue; // tableau que l'intégration ne peut pas lire : écarté
      throw e;
    }
    if (t?.in_trash === true) continue;
    const cree = typeof t?.created_time === 'string' ? Date.parse(t.created_time) : NaN;
    lisibles.push({ ...s, cree: Number.isNaN(cree) ? Infinity : cree, types: typesNotion(t?.properties) });
  }
  lisibles.sort((a, b) => (a.cree === b.cree ? (a.id < b.id ? -1 : 1) : a.cree - b.cree));
  const [ancien] = lisibles;
  if (!ancien) throw new ErreurSortante(aucun);
  return { id: ancien.id, types: ancien.types, avis: `Base Notion à ${sources.length} tableaux : seul « ${ancien.nom.slice(0, 40)} » (le plus ancien) est synchronisé. Pour un autre, refaites le branchement en le choisissant dans la liste.` };
}

const notion: Adaptateur = {
  id: 'notion', nom: 'Notion', categorie: 'Base de données', couleur: '#191919',
  description: 'Une base de données Notion (CRM, projets, fournisseurs…) dans les deux sens.',
  etapes: [
    'Sur notion.so/profile/integrations : « Nouvelle intégration » interne, copiez le secret (ntn_… ou secret_…).',
    'Dans la base de données Notion : ••• → Connexions → ajoutez votre intégration.',
    'Copiez l’identifiant de la base (32 caractères dans son adresse, avant « ?v= »).',
    'Base à plusieurs tableaux (« sources de données ») : le plus ancien est lu. Pour un autre, copiez l’identifiant de sa source de données (menu de la base → Gérer les sources de données) et saisissez « source: » suivi de cet identifiant.',
  ],
  champs: [
    { id: 'base', libelle: 'Base de données', aide: '32 caractères dans l’adresse de la base. Absente de la liste ? Reconnectez-vous et cochez-la sur la page Notion. Une base à plusieurs tableaux y figure une fois par tableau.', exemple: '1f2e3d4c5b6a…', obligatoire: true, liste: true },
    { id: 'jeton', libelle: 'Secret d’intégration', aide: 'Chiffré sur le serveur.', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f, ctx) {
    const cle = cleNotion(cfg);
    const tableau = await tableauNotion(cle, secret, f);
    const res: Enregistrement[] = [];
    const types: Record<string, string> = {};
    let curseur: string | undefined;
    for (let page = 0; page < 50; page++) {
      // `result_type: page` : le tableau d'un wiki peut aussi contenir des bases, qui ne sont pas des lignes
      const d = await appelNotion(f, secret, { objet: 'tableau', action: 'lire' }, `/data_sources/${avecTirets(tableau.id)}/query`, 'POST', { page_size: 100, result_type: 'page', ...(curseur ? { start_cursor: curseur } : {}) }) as
        { results?: { object?: string; id: string; properties: Record<string, Record<string, unknown>> }[]; has_more?: boolean; next_cursor?: string | null } | null;
      for (const r of d?.results ?? []) {
        if (r.object !== undefined && r.object !== 'page') continue;
        const champs: Record<string, string> = {};
        for (const [nom, p] of Object.entries(r.properties ?? {})) { champs[nom] = lireProprieteNotion(p); types[nom] = String(p.type); }
        res.push({ externeId: r.id, champs });
      }
      if (!d?.has_more || !d.next_cursor) break;
      curseur = d.next_cursor; // curseur opaque : renvoyé tel quel
    }
    // tableau vide : aucun type lu dans les lignes, le schéma sera demandé à Notion avant d'écrire
    memoriserNotion(cle, tableau.id, res.length ? types : tableau.types);
    if (tableau.avis) ctx?.avis?.(tableau.avis);
    return res;
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const cle = cleNotion(cfg);
    const connu = memoNotion.get(cle);
    let source: string;
    let types: Record<string, string>;
    if (connu?.types) ({ source, types } = connu);
    else {
      const tableau = connu ? { id: connu.source, types: null } : await tableauNotion(cle, secret, f);
      source = tableau.id;
      if (tableau.types) types = tableau.types;
      else {
        const t = await appelNotion(f, secret, { objet: 'tableau', action: 'lire' }, `/data_sources/${avecTirets(source)}`) as { in_trash?: unknown; properties?: unknown } | null;
        if (t?.in_trash === true) throw new ErreurSortante(CORBEILLE_NOTION.tableau);
        types = typesNotion(t?.properties);
      }
      memoriserNotion(cle, source, types);
    }
    const properties: Record<string, unknown> = {};
    for (const [nom, v] of Object.entries(valeurs)) {
      const p = types[nom] ? ecrireProprieteNotion(types[nom] as string, v) : undefined;
      if (p !== undefined) properties[nom] = p;
    }
    if (externeId) {
      if (!ID_NOTION.test(externeId)) throw new ErreurSortante('Identifiant de page Notion invalide.');
      await appelNotion(f, secret, { objet: 'fiche', action: 'modifier' }, `/pages/${externeId}`, 'PATCH', { properties });
      return externeId;
    }
    try {
      const d = await appelNotion(f, secret, { objet: 'tableau', action: 'creer' }, '/pages', 'POST', { parent: { type: 'data_source_id', data_source_id: avecTirets(source) }, properties });
      return (d as { id?: string } | null)?.id ?? null;
    } catch (e) {
      if (!(e instanceof RefusNotion)) throw e;
      // 503 après enregistrement : Notion donne l'identifiant de la page créée (la recréer ferait un doublon)
      const creee = e.statut === 503 ? e.donnees.committed_resource_id : null;
      if (typeof creee === 'string' && ID_NOTION.test(creee)) return creee;
      if (e.statut === 404) memoNotion.delete(cle); // tableau supprimé ou déplacé : retrouvé au prochain appel
      throw e;
    }
  },
  /**
   * Tableaux que l'intégration peut lire : la recherche Notion renvoie un résultat par tableau, proposé chacun sur sa
   * ligne. Les tableaux d'une même base sont précédés du nom de leur base (« Base — tableau « Nom » »).
   */
  async choix(champ, _cfg, secret, f) {
    if (champ !== 'base') return [];
    const pour = { objet: 'base', action: 'lire' } as const;
    const trouves: { id: string; nom: string; base: string | null }[] = [];
    const vus = new Set<string>();
    let curseur: string | undefined;
    for (let page = 0; page < 5; page++) {
      const d = await appelNotion(f, secret, pour, '/search', 'POST', { filter: { property: 'object', value: 'data_source' }, page_size: 100, ...(curseur ? { start_cursor: curseur } : {}) }) as { results?: unknown; has_more?: unknown; next_cursor?: unknown } | null;
      for (const r of Array.isArray(d?.results) ? d.results : []) {
        const x = r as { object?: unknown; id?: unknown; title?: unknown; in_trash?: unknown; parent?: { database_id?: unknown } | null } | null;
        if (x?.object !== 'data_source' || typeof x.id !== 'string' || !ID_NOTION.test(x.id) || x.in_trash === true || vus.has(sansTiret(x.id))) continue;
        vus.add(sansTiret(x.id));
        const base = x.parent?.database_id;
        trouves.push({ id: sansTiret(x.id), nom: titreNotion(x.title) || 'Sans titre', base: typeof base === 'string' && ID_NOTION.test(base) ? sansTiret(base) : null });
      }
      if (d?.has_more !== true || typeof d.next_cursor !== 'string' || !d.next_cursor || d.next_cursor.length > 2000) break;
      curseur = d.next_cursor;
    }
    // bases dont plusieurs tableaux sont trouvés : leur nom et la liste de leurs tableaux se lisent dans la base elle-même
    const parBase = new Map<string, { id: string; nom: string }[]>();
    for (const t of trouves) if (t.base) parBase.set(t.base, [...(parBase.get(t.base) ?? []), t]);
    const bases = new Map<string, { titre: string; tableaux: { id: string; nom: string }[] }>();
    for (const [base, siens] of parBase) {
      if (siens.length < 2 || bases.size >= 10) continue;
      try {
        const d = await appelNotion(f, secret, pour, `/databases/${base}`) as { title?: unknown } | null;
        const tableaux = sourcesNotion(d);
        bases.set(base, { titre: titreNotion(d?.title) || 'Sans titre', tableaux: [...tableaux, ...siens.filter((t) => !tableaux.some((s) => s.id === t.id))] });
      } catch (e) {
        if (!(e instanceof ErreurSortante)) throw e; // base illisible : ses tableaux restent proposés sous leur seul nom
      }
    }
    const res: Choix[] = [];
    const faites = new Set<string>();
    for (const t of trouves) {
      const b = t.base ? bases.get(t.base) : undefined;
      if (!b || !t.base) { res.push({ valeur: `source:${t.id}`, libelle: t.nom }); continue; }
      if (faites.has(t.base)) continue;
      faites.add(t.base);
      for (const s of b.tableaux) res.push({ valeur: `source:${s.id}`, libelle: `${b.titre} — tableau « ${s.nom} »` });
    }
    return res.slice(0, 500);
  },
};

// ---------------------------------------------------------------- HubSpot

const HUBSPOT = 'https://api.hubapi.com/crm/v3/objects';
const PROPRIETES_HUBSPOT: Record<string, string> = {
  companies: 'name,domain,city,phone,industry,numberofemployees,annualrevenue,lifecyclestage',
  contacts: 'firstname,lastname,email,phone,company,city,jobtitle,lifecyclestage',
  deals: 'dealname,amount,dealstage,closedate,pipeline',
};
const hubspot: Adaptateur = {
  id: 'hubspot', nom: 'HubSpot', categorie: 'CRM', couleur: '#ff7a59',
  description: 'Entreprises, contacts ou affaires de votre CRM HubSpot, dans les deux sens.',
  etapes: [
    // HubSpot ne laisse plus créer d'application privée depuis le 26 octobre 2026 (28 septembre pour un compte récent) :
    // la clé de service la remplace, avec le même en-tête. Les applications privées déjà créées continuent de marcher.
    'HubSpot → Paramètres → Intégrations → Clés de service (Service Keys) → créez une clé. Une application privée déjà créée fonctionne toujours.',
    'Droits : crm.objects.companies (ou contacts / deals) en lecture, et en écriture pour la synchro dans les deux sens.',
    'Copiez la clé (ou le jeton pat-… d’une application privée existante) et collez-la ici.',
  ],
  champs: [
    { id: 'objet', libelle: 'Fiches HubSpot à lire', aide: 'Entreprises, contacts ou affaires.', choix: ['companies', 'contacts', 'deals'], obligatoire: true },
    { id: 'proprietes', libelle: 'Propriétés HubSpot (facultatif)', aide: 'Noms internes séparés par des virgules. Sans rien, les propriétés courantes sont lues.', exemple: PROPRIETES_HUBSPOT.companies ?? '', avance: true },
    { id: 'jeton', libelle: 'Clé d’accès HubSpot', aide: 'Fournie par votre informaticien (clé de service HubSpot, ou jeton d’une application privée existante). Chiffrée sur cet ordinateur.', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = exiger(cfg, 'objet', /^(companies|contacts|deals)$/, 'Choisissez les fiches HubSpot à lire : entreprises, contacts ou affaires.');
    const proprietes = (cfg.proprietes || PROPRIETES_HUBSPOT[objet] || '').split(',').map((x) => x.trim()).filter((x) => /^[a-z0-9_]{1,80}$/.test(x)).slice(0, 60);
    const res: Enregistrement[] = [];
    let apres = '';
    for (let page = 0; page < 50; page++) {
      const u = new URL(`${HUBSPOT}/${objet}`);
      u.searchParams.set('limit', '100');
      u.searchParams.set('properties', proprietes.join(','));
      if (apres) u.searchParams.set('after', apres);
      const { donnees } = await appeler(f, u, { entetes: { authorization: `Bearer ${jeton(secret, 'HubSpot')}` } });
      const d = donnees as { results?: { id: string; properties: Record<string, unknown> }[]; paging?: { next?: { after?: string } } };
      for (const r of d.results ?? []) {
        const champs = aplatirObjet(r.properties ?? {});
        if (objet === 'contacts') champs.nom_complet = [champs.firstname, champs.lastname].filter(Boolean).join(' ');
        delete champs.hs_object_id;
        res.push({ externeId: r.id, champs });
      }
      apres = d.paging?.next?.after ?? '';
      if (!apres) break;
    }
    return res;
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const objet = exiger(cfg, 'objet', /^(companies|contacts|deals)$/, 'Objet HubSpot invalide.');
    const properties = Object.fromEntries(Object.entries(valeurs).filter(([k]) => k !== 'nom_complet' && /^[a-z0-9_]{1,80}$/.test(k)).map(([k, v]) => [k, v === null ? '' : String(v)]));
    const entetes = { authorization: `Bearer ${jeton(secret, 'HubSpot')}` };
    if (externeId) {
      if (!/^\d{1,20}$/.test(externeId)) throw new ErreurSortante('Identifiant HubSpot invalide.');
      await appeler(f, new URL(`${HUBSPOT}/${objet}/${externeId}`), { methode: 'PATCH', entetes, corps: { properties } });
      return externeId;
    }
    const { donnees } = await appeler(f, new URL(`${HUBSPOT}/${objet}`), { methode: 'POST', entetes, corps: { properties } });
    return (donnees as { id?: string }).id ?? null;
  },
};

// ---------------------------------------------------------------- Google Sheets (script dans la feuille : lecture + écriture, rien de public)

/**
 * Script collé par l'entreprise dans SA feuille (Extensions → Apps Script) et déployé en Application Web.
 * Aucun compte développeur ni application OAuth côté éditeur : le script tourne avec le compte Google de l'entreprise,
 * et refuse toute requête sans le secret (généré par le jeu, chiffré au repos).
 */
export const SCRIPT_SHEETS = `// Living Business : à coller dans votre feuille Google → Extensions → Apps Script (remplacez tout).
// Puis « Déployer » → « Nouveau déploiement » → type « Application Web »
//   Exécuter en tant que : moi · Qui a accès : tout le monde → « Déployer » → autorisez avec votre compte.
// Copiez l'URL qui finit par /exec dans Living Business. Sans le secret ci-dessous, le script refuse tout :
// la feuille reste privée (rien n'est publié sur le Web).
const SECRET = 'COLLEZ_ICI_LE_SECRET_AFFICHE_DANS_LIVING_BUSINESS';

function doPost(e) {
  let d;
  try { d = JSON.parse(e.postData.contents); } catch (x) { return sortie({ erreur: 'requete' }); }
  if (!d || d.secret !== SECRET) return sortie({ erreur: 'secret' });
  const classeur = SpreadsheetApp.getActiveSpreadsheet();
  const feuille = d.feuille ? classeur.getSheetByName(String(d.feuille)) : classeur.getSheets()[0];
  if (!feuille) return sortie({ erreur: 'feuille' });
  const lignes = feuille.getDataRange().getDisplayValues();
  if (d.action === 'lire') return sortie({ lignes: lignes });
  const entetes = lignes[0] || [];
  const col = entetes.indexOf(String(d.colonneId || entetes[0] || ''));
  let n = -1;
  for (let i = 1; i < lignes.length; i++) if (col >= 0 && String(lignes[i][col]) === String(d.externeId)) n = i;
  const valeurs = d.valeurs || {};
  if (n >= 0) {
    // seules les cellules envoyées changent (les formules des autres colonnes sont conservées)
    Object.keys(valeurs).forEach(function (k) {
      const j = entetes.indexOf(k);
      if (j >= 0) feuille.getRange(n + 1, j + 1).setValue(valeurs[k] === null ? '' : valeurs[k]);
    });
  } else {
    feuille.appendRow(entetes.map(function (k) { return k in valeurs && valeurs[k] !== null ? valeurs[k] : ''; }));
  }
  return sortie({ ok: true });
}

function sortie(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}`;

const HOTE_SCRIPT = 'script.google.com';
const HOTE_REPONSE_SCRIPT = 'script.googleusercontent.com';

/**
 * Appelle le script de la feuille. Apps Script exécute doPost puis répond par une redirection vers
 * script.googleusercontent.com où se trouve la réponse : seule cette redirection-là est suivie.
 */
export async function appelerScriptGoogle(cfg: Readonly<Record<string, string>>, secret: string | null, f: Recuperateur, corps: Record<string, unknown>): Promise<Record<string, unknown>> {
  // hôte fixe (public) : pas de résolution DNS à vérifier, seulement la forme exacte de l'adresse
  let u: URL;
  try { u = new URL((cfg.script ?? '').trim()); } catch { throw new ErreurSortante('URL du script manquante : collez l’URL du déploiement (…/exec).'); }
  if (u.protocol !== 'https:' || u.hostname !== HOTE_SCRIPT || u.port !== '' || u.username || u.password || !/^\/macros\/s\/[A-Za-z0-9_-]{10,200}\/exec$/.test(u.pathname)) {
    throw new ErreurSortante('URL de script Google invalide : https://script.google.com/macros/s/…/exec (Déployer → Gérer les déploiements).');
  }
  u.search = '';
  u.hash = '';
  let r: Response;
  try {
    r = await f(u, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': 'LivingBusiness/0.1 (+auto-heberge)' },
      body: JSON.stringify({ ...corps, secret: jeton(secret, 'du script') }),
    });
  } catch (e) {
    throw new ErreurSortante(e instanceof Error && e.name === 'TimeoutError' ? 'Le script Google ne répond pas (délai dépassé).' : 'Script Google injoignable.');
  }
  let texte: string;
  if (r.status >= 300 && r.status < 400) {
    const loc = r.headers.get('location');
    let suite: URL | null = null;
    try { suite = loc ? new URL(loc, u) : null; } catch { suite = null; }
    if (!suite || suite.protocol !== 'https:' || suite.hostname !== HOTE_REPONSE_SCRIPT || suite.port !== '') throw new ErreurSortante('Redirection inattendue du script Google.');
    texte = (await appeler(f, suite, { texte: true, delaiMs: 30_000 })).donnees as string;
  } else {
    if (r.status === 401 || r.status === 403) throw new ErreurSortante('Le script refuse l’accès : déployez-le avec « Qui a accès : tout le monde ».', r.status);
    if (r.status === 404) throw new ErreurSortante('Script introuvable : vérifiez l’URL /exec du déploiement.', r.status);
    if (r.status >= 400) throw new ErreurSortante(`Erreur du script Google (${r.status}).`, r.status);
    texte = await lireTexteBorne(r, 5_000_000);
  }
  let o: unknown;
  try { o = JSON.parse(texte); } catch {
    throw new ErreurSortante(/<html|<!doctype/i.test(texte) ? 'Le script demande une connexion Google : redéployez-le avec « Qui a accès : tout le monde ».' : 'Réponse du script illisible.');
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new ErreurSortante('Réponse du script illisible.');
  const rep = o as Record<string, unknown>;
  if (rep.erreur === 'secret') throw new ErreurSortante('Secret refusé : le secret collé dans le script n’est pas celui de Living Business.');
  if (rep.erreur === 'feuille') throw new ErreurSortante(`Onglet « ${String(corps.feuille ?? '')} » introuvable dans la feuille.`);
  if (rep.erreur) throw new ErreurSortante('Le script a refusé la requête.');
  return rep;
}

const sheets: Adaptateur = {
  id: 'sheets', nom: 'Google Sheets', categorie: 'Tableur', couleur: '#188038',
  description: 'Votre feuille Google dans les deux sens, avec votre propre compte Google. Rien n’est rendu public.',
  // étapes du mode avancé (script dans la feuille) ; « Se connecter avec Google » n'en demande aucune
  etapes: [
    'Ouvrez votre feuille → Extensions → Apps Script → remplacez tout par le script ci-dessous (votre secret est déjà dedans).',
    '« Déployer » → « Nouveau déploiement » → Application Web · Exécuter en tant que : moi · Qui a accès : tout le monde → autorisez.',
    'Collez ici l’URL du déploiement (elle finit par /exec) et choisissez la colonne qui identifie chaque ligne.',
  ],
  champs: [
    { id: 'classeur', libelle: 'Lien de la feuille', aide: 'Copiez le lien de la feuille : la barre d’adresse de Google Sheets (https://docs.google.com/spreadsheets/d/…).', exemple: 'https://docs.google.com/spreadsheets/d/…/edit', obligatoire: true, mode: 'oauth' },
    { id: 'script', libelle: 'URL du script (déploiement)', aide: 'https://script.google.com/macros/s/…/exec', obligatoire: true, mode: 'cle' },
    { id: 'feuille', libelle: 'Onglet (facultatif)', aide: 'Nom exact de l’onglet ; par défaut le premier.' },
    { id: 'colonneId', libelle: 'Colonne identifiant', aide: 'Nom exact de la colonne (par défaut la 1re), ex. « Référence ».' },
    { id: 'jeton', libelle: 'Secret du script', aide: 'Généré pour vous et déjà placé dans le script. Chiffré sur votre ordinateur.', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    // « Se connecter avec Google » : API Sheets avec le jeton de la personne connectée
    if (parRelais(cfg, 'google')) return lireFeuilleGoogle(cfg, secret, f);
    if (!cfg.script && cfg.lien) {
      // ancien branchement par lien « Publier sur le Web » (lecture seule) : toujours lu
      const v = validerLienSheets(cfg.lien);
      if (!v.ok) throw new ErreurSortante(v.erreur);
      return lignesVersEnregistrements(parserCsv(await telechargerSheets(v.url, f)), cfg.colonneId || undefined);
    }
    const rep = await appelerScriptGoogle(cfg, secret, f, { action: 'lire', feuille: cfg.feuille || '' });
    if (!Array.isArray(rep.lignes)) throw new ErreurSortante('Réponse du script illisible.');
    return lignesVersEnregistrements(rep.lignes.filter(Array.isArray) as unknown[][], cfg.colonneId || undefined);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    if (parRelais(cfg, 'google')) return ecrireFeuilleGoogle(cfg, secret, externeId, valeurs, f);
    if (!cfg.script) return externeId; // ancien branchement par lien publié : lecture seule
    const colonneId = cfg.colonneId || '';
    const id = externeId ?? String(valeurs[colonneId] ?? '');
    // le script fait setValue / appendRow : un texte qui commencerait une formule part déjà forcé en texte
    const sures = Object.fromEntries(Object.entries(valeurs).map(([k, v]) => [k, sansFormule(v)]));
    await appelerScriptGoogle(cfg, secret, f, { action: 'ecrire', feuille: cfg.feuille || '', colonneId, externeId: id, valeurs: sures });
    return id || null;
  },
};

// ---------------------------------------------------------------- Webhook (Make, Zapier, n8n, Power Automate…)

const webhook: Adaptateur = {
  id: 'webhook', nom: 'Make · Zapier · n8n (webhook)', categorie: 'Automatisation', couleur: '#6d00cc',
  description: 'Vos scénarios poussent les changements ici ; le jeu leur envoie les siens, signés. Relie des milliers d’applications.',
  etapes: [
    'Entrant : dans Make/Zapier/n8n, un module HTTP « POST » vers l’adresse d’entrée affichée, en-tête Authorization: Bearer <secret>.',
    'Corps JSON : { "enregistrements": [ { "id": "…", "Nom": "…", … } ] } (ou un seul objet).',
    'Sortant (facultatif) : créez un webhook « Custom webhook » dans Make, « Catch Raw Hook » dans Zapier (le « Catch Hook » simple ne montre pas l’en-tête de signature), ou un nœud Webhook réglé sur la méthode POST dans n8n (il attend GET par défaut), puis collez son adresse ici.',
  ],
  champs: [
    { id: 'urlSortante', libelle: 'Adresse du webhook sortant (facultatif)', aide: 'https://hook.eu1.make.com/… — reçoit chaque changement fait dans le jeu.' },
    { id: 'champId', libelle: 'Champ identifiant', aide: 'Nom du champ qui identifie un enregistrement (défaut : id).', exemple: 'id' },
  ],
  lecture: 'reception',
  ecriture: true,
  async lire() {
    return [];
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    if (!cfg.urlSortante) return externeId;
    const u = await verifierUrl(cfg.urlSortante);
    const corps = JSON.stringify({ evenement: externeId ? 'enregistrement.modifie' : 'enregistrement.cree', id: externeId, valeurs, le: new Date().toISOString() });
    await appeler(f, u, { methode: 'POST', texte: true, entetes: secret ? { 'x-lb-signature': signerEnvoi(secret, corps), 'content-type': 'application/json' } : { 'content-type': 'application/json' }, corps: JSON.parse(corps) });
    return externeId;
  },
};

// ---------------------------------------------------------------- API REST (n'importe quel outil avec une API JSON)

const rest: Adaptateur = {
  id: 'rest', nom: 'API REST (tout autre outil)', categorie: 'Technique', couleur: '#1f2630',
  description: 'Pour tout logiciel qui expose une API JSON : ERP, CRM, logiciel métier, outil maison.',
  etapes: [
    'Adresse qui renvoie la liste (GET), ex. https://monoutil.fr/api/clients.',
    'Si la liste est dans une sous-propriété (ex. data.items), indiquez son chemin.',
    'Pour écrire : adresse d’un enregistrement avec {id}, ex. https://monoutil.fr/api/clients/{id}.',
  ],
  champs: [
    { id: 'url', libelle: 'Adresse de la liste (GET)', aide: 'HTTPS uniquement.', obligatoire: true },
    { id: 'chemin', libelle: 'Chemin de la liste (facultatif)', aide: 'ex. data.items' },
    { id: 'champId', libelle: 'Champ identifiant', aide: 'défaut : id' },
    { id: 'urlEcriture', libelle: 'Adresse d’écriture (facultatif)', aide: 'avec {id}, ex. …/clients/{id}' },
    { id: 'methode', libelle: 'Méthode d’écriture', aide: 'PATCH, PUT ou POST', choix: ['PATCH', 'PUT', 'POST'] },
    { id: 'jeton', libelle: 'Jeton (Bearer, facultatif)', aide: 'Chiffré sur le serveur.', secret: true },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const u = await verifierUrl(cfg.url);
    const { donnees } = await appeler(f, u, { entetes: secret ? { authorization: `Bearer ${secret}` } : {} });
    const cle = cfg.champId || 'id';
    return trouverListe(donnees, cfg.chemin ?? '').slice(0, 5000).map((o, i) => ({ externeId: aplatir(o[cle]) || `ligne-${i + 1}`, champs: aplatirObjet(o) }));
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    if (!cfg.urlEcriture) return externeId;
    const modele = externeId ? cfg.urlEcriture.replace('{id}', encodeURIComponent(externeId)) : cfg.urlEcriture.replace(/\/?\{id\}/, '');
    const u = await verifierUrl(modele);
    const methode = externeId ? (cfg.methode || 'PATCH') : 'POST';
    // Réponse lue comme du texte : beaucoup d'API répondent « OK », une page ou rien du tout à une écriture réussie.
    // Avant, un 2xx qui n'était pas du JSON passait pour un échec, et la création était retentée (doublons chez l'outil).
    const { donnees, entetes } = await appeler(f, u, { methode, corps: valeurs, texte: true, entetes: secret ? { authorization: `Bearer ${secret}` } : {} });
    if (externeId) return externeId;
    // identifiant du nouvel enregistrement : dans le corps JSON, sinon à la fin de l'en-tête Location (201 Created)
    let cree: unknown = null;
    try { cree = typeof donnees === 'string' && donnees.trim() ? JSON.parse(donnees) : null; } catch { /* 2xx non JSON : écrit quand même */ }
    const dansCorps = cree && typeof cree === 'object' && !Array.isArray(cree) ? aplatir((cree as Record<string, unknown>)[cfg.champId || 'id']) : '';
    if (dansCorps) return dansCorps;
    const fin = (entetes.get('location') ?? '').replace(/[?#].*$/, '').replace(/\/+$/, '').split('/').pop() ?? '';
    let dansLocation = '';
    try { dansLocation = decodeURIComponent(fin); } catch { /* fin d'adresse mal encodée : ignorée */ }
    return dansLocation && dansLocation.length <= 200 ? dansLocation : null;
  },
};

// ---------------------------------------------------------------- Serveur MCP distant (Streamable HTTP)

// Le client (ères moderne et ancienne du protocole, pages de `tools/list`, en-têtes `Mcp-Param-*`) est dans mcp-client.ts.
import { appelMcp } from './mcp-client.ts';
export { appelMcp };

function donneesOutil(result: Record<string, unknown>): unknown {
  if (result.isError) throw new ErreurSortante(`L’outil MCP a renvoyé une erreur : ${aplatir(result.content).slice(0, 200)}`);
  if (result.structuredContent !== undefined) return result.structuredContent;
  const texte = Array.isArray(result.content) ? result.content.map((c) => (c as { text?: string }).text ?? '').join('') : '';
  try {
    return JSON.parse(texte);
  } catch {
    throw new ErreurSortante('L’outil MCP doit renvoyer du JSON (liste d’enregistrements).');
  }
}

const argsJson = (brut: string | undefined, remplacements: Record<string, unknown> = {}): Record<string, unknown> => {
  if (!brut) return {};
  let t = brut;
  for (const [k, v] of Object.entries(remplacements)) t = t.replaceAll(`"{{${k}}}"`, JSON.stringify(v));
  try {
    const o = JSON.parse(t);
    if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown>;
  } catch { /* plus bas */ }
  throw new ErreurSortante('Arguments de l’outil : objet JSON attendu.');
};

const mcp: Adaptateur = {
  id: 'mcp', nom: 'Serveur MCP', categorie: 'IA et connecteurs', couleur: '#d97757',
  description: 'Tout outil qui expose un serveur MCP (CRM, ERP, bases…) : on appelle ses outils pour lire et écrire.',
  etapes: [
    'Adresse du serveur MCP en HTTP (Streamable HTTP), ex. https://mcp.monoutil.fr/mcp, et son jeton si besoin.',
    '« Tester » liste les outils disponibles : choisissez celui qui renvoie la liste (ex. list_customers).',
    'Pour écrire : l’outil de mise à jour et ses arguments, avec "{{id}}" et "{{valeurs}}".',
  ],
  champs: [
    { id: 'url', libelle: 'Adresse du serveur MCP', aide: 'HTTPS, transport Streamable HTTP.', obligatoire: true },
    { id: 'outilLecture', libelle: 'Outil de lecture', aide: 'Nom de l’outil qui renvoie les enregistrements.', obligatoire: true },
    { id: 'argsLecture', libelle: 'Arguments de lecture (JSON)', aide: 'ex. {"limit": 200}' },
    { id: 'champId', libelle: 'Champ identifiant', aide: 'défaut : id' },
    { id: 'outilEcriture', libelle: 'Outil d’écriture (facultatif)', aide: 'ex. update_customer' },
    { id: 'argsEcriture', libelle: 'Arguments d’écriture (JSON)', aide: 'ex. {"id": "{{id}}", "fields": "{{valeurs}}"}' },
    { id: 'jeton', libelle: 'Jeton (Bearer, facultatif)', aide: 'Chiffré sur le serveur.', secret: true },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(cfg.outilLecture ?? '')) throw new ErreurSortante('Choisissez l’outil de lecture.');
    const r = await appelMcp(cfg, secret, f, 'tools/call', { name: cfg.outilLecture, arguments: argsJson(cfg.argsLecture) });
    const cle = cfg.champId || 'id';
    return trouverListe(donneesOutil(r)).slice(0, 5000).map((o, i) => ({ externeId: aplatir(o[cle]) || `ligne-${i + 1}`, champs: aplatirObjet(o) }));
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    if (!cfg.outilEcriture) return externeId;
    if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(cfg.outilEcriture)) throw new ErreurSortante('Nom d’outil d’écriture invalide.');
    const args = cfg.argsEcriture ? argsJson(cfg.argsEcriture, { id: externeId, valeurs }) : { id: externeId, ...valeurs };
    const r = await appelMcp(cfg, secret, f, 'tools/call', { name: cfg.outilEcriture, arguments: args });
    if (r.isError) throw new ErreurSortante(`L’outil MCP a refusé l’écriture : ${aplatir(r.content).slice(0, 200)}`);
    return externeId;
  },
};

export const ADAPTATEURS: Readonly<Record<TypeSource, Adaptateur>> = {
  airtable, notion, hubspot, pennylane, qonto, odoo, pipedrive, shopify, axonaut, stripe, woocommerce, prestashop, sellsy,
  sheets, excel365, dynamics365, businesscentral: businessCentral, agendagoogle, agendamicrosoft, gmail, outlook, webhook, rest, mcp,
};
