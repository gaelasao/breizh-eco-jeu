/**
 * Miroir de suivi : tout ce qui vit dans le jeu vit aussi dans UN fichier de suivi, chez l'entreprise.
 *
 * - Le classeur est créé tout seul la première fois, dans l'espace de l'entreprise (Google Sheets par défaut, sinon
 *   Notion ou Airtable), avec un onglet par type d'objet et une ligne d'en-têtes en français.
 * - Chaque création ou modification dans le jeu ajoute ou met à jour une ligne, tout de suite.
 * - Une suppression MARQUE la ligne « Supprimée » : rien n'est jamais effacé chez l'entreprise.
 * - Dans l'autre sens, les lignes ajoutées à la main reviennent par la synchronisation déjà en place : le miroir
 *   crée, pour chaque onglet, un branchement de LECTURE ordinaire (relu à son intervalle, et en temps réel quand
 *   l'outil prévient). Dans un tableur, une ligne écrite à la main n'a pas encore de référence : le miroir lui en
 *   pose une (passe « adopter »), et la synchronisation la fait entrer au passage suivant.
 * - Anti-boucle : l'empreinte du contenu métier (`Monde.empreinte`) est mémorisée après chaque envoi réussi ; une
 *   fiche n'est renvoyée que si elle a changé depuis. Un aller-retour s'arrête donc tout seul.
 * - Si l'envoi échoue (hors ligne, droits retirés, quota) : l'envoi reste en attente, il est réessayé plus tard,
 *   et Réglages le dit. Rien n'est perdu, rien ne bloque le jeu.
 *
 * Le miroir n'écrit QUE dans le classeur du jeu, avec la connexion d'un branchement existant (« Se connecter
 * avec… ») : il ne touche à aucune autre donnée de l'entreprise.
 */
import { randomBytes } from 'node:crypto';
import type { Profil } from '../demo/donnees.ts';
import { defType, typesVisibles, type DefType, type Univers } from '../core/univers.ts';
import { NOM, ROLES } from './csv.ts';
import { ErreurApi, type Monde } from './monde.ts';
import { NOM_FOURNISSEUR, type FournisseurOAuth } from './oauth-relais.ts';
import { ADAPTATEURS, type TypeSource, type ValeurSortante } from './sources.ts';
import { idFeuilleGoogle } from './sources-google.ts';
import { appeler, ErreurSortante, type Recuperateur } from './sortant.ts';
import type { Synchro } from './synchro.ts';

/** Outils capables de porter un fichier de suivi. L'ordre est celui des préférences : Google d'abord. */
export const OUTILS_SUIVI = ['sheets', 'notion', 'airtable'] as const;
export type OutilSuivi = (typeof OUTILS_SUIVI)[number];
const EST_OUTIL = (x: unknown): x is OutilSuivi => typeof x === 'string' && (OUTILS_SUIVI as readonly string[]).includes(x);

/** Nom de l'outil et de l'endroit où le classeur est créé, dit simplement. */
export const ENDROIT: Readonly<Record<OutilSuivi, { outil: string; chez: string; quoi: string }>> = {
  sheets: { outil: 'Google Sheets', chez: 'mon Google Drive', quoi: 'classeur' },
  notion: { outil: 'Notion', chez: 'mon espace Notion', quoi: 'base de données' },
  airtable: { outil: 'Airtable', chez: 'mon espace Airtable', quoi: 'base' },
};

/** Colonnes ajoutées par le jeu, en plus du nom, des rôles et des champs du type. */
export const COL_REFERENCE = 'Référence';
export const COL_STATUT = 'Statut';
export const COL_MAJ = 'Mis à jour le';
export const STATUT_ACTIVE = 'Active';
export const STATUT_SUPPRIMEE = 'Supprimée';
export const COL_NOM = 'Nom';
export const COL_ROLES = 'Rôles';

/** Référence que le jeu pose sur une ligne écrite à la main dans un tableur : « lb- » et dix caractères. */
const nouvelleReference = () => `lb-${randomBytes(5).toString('hex')}`;

/** Onglets au plus dans un classeur de suivi (un par type d'objet). */
const ONGLETS_MAX = 30;
/** Envois gardés en attente au plus (rien n'est perdu en deçà ; au-delà, les plus anciens repartent au prochain « Tout réécrire »). */
const ATTENTE_MAX = 5000;
/** Envois faits en un seul passage : le jeu ne reste jamais bloqué sur une longue file. */
const PAR_PASSAGE = 25;
/** Attente avant un nouvel essai, selon le nombre d'échecs (secondes). */
const REESSAIS_S = [30, 120, 600, 1800, 3600] as const;

export interface TableSuivi {
  /** Identifiant de la table chez l'outil : nom de l'onglet (Sheets), source de données (Notion), table (Airtable). */
  cle: string;
  /** Nom lisible de l'onglet. */
  nom: string;
  /** En-têtes de la table, dans l'ordre. */
  entetes: string[];
  /** Nom de la colonne qui identifie une ligne (elle porte la référence de la fiche). */
  reference: string;
  /** Branchement de lecture créé pour faire revenir les lignes ajoutées à la main. */
  connecteur: string | null;
}

export interface ClasseurSuivi {
  outil: OutilSuivi;
  /** Identifiant chez l'outil : classeur (Sheets), base de données (Notion), base (Airtable). */
  id: string;
  nom: string;
  url: string;
  /** Compte (branchement) dont la connexion sert à écrire. */
  compte: string;
  /** typeId → table. */
  tables: Record<string, TableSuivi>;
  creeLe: string;
}

export interface EnvoiEnAttente {
  objet: string;
  type: string;
  quoi: 'ligne' | 'suppression';
  /** Valeurs figées (suppression : la fiche n'existe plus au moment de l'envoi). */
  valeurs?: Record<string, ValeurSortante>;
  essais: number;
  /** Date du prochain essai (ISO). */
  prochain: string;
  erreur: string | null;
}

export interface EtatMiroir {
  classeur: ClasseurSuivi | null;
  /** Types que l'entreprise a décochés (par défaut, tout est suivi). */
  exclus: string[];
  /** objId → empreinte du contenu au dernier envoi réussi (anti-boucle). */
  empreintes: Record<string, string>;
  /** objId → type suivi et identifiant de sa ligne chez l'outil. */
  lignes: Record<string, { type: string; ext: string }>;
  attente: EnvoiEnAttente[];
  dernier: { le: string; ok: boolean; envoyees: number; message: string | null } | null;
}

export const ETAT_MIROIR_VIDE: EtatMiroir = { classeur: null, exclus: [], empreintes: {}, lignes: {}, attente: [], dernier: null };

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const texteCourt = (x: unknown, max: number): string => (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, max) : '');

/** Types d'objets suivis : tout ce que l'univers montre, sauf la fiche de l'entreprise elle-même. */
export function typesSuivis(u: Univers): DefType[] {
  return typesVisibles(u).filter((t) => t.famille !== 'organisation').slice(0, ONGLETS_MAX);
}

/**
 * Colonnes d'un onglet : le nom, les rôles d'un tiers, les champs du type, puis les trois colonnes du jeu.
 * Deux colonnes ne portent jamais le même nom : un champ qui s'appellerait déjà « Statut » garde son nom, et
 * c'est la colonne du jeu qui devient « Statut (2) ». Les noms retenus sont renvoyés avec la correspondance.
 */
export function colonnesDe(t: DefType): { entetes: string[]; mapping: Record<string, string>; reference: string; statut: string; maj: string } {
  const vus = new Set<string>();
  const unique = (base: string) => {
    let nom = base;
    for (let n = 2; vus.has(nom); n++) nom = `${base} (${n})`;
    vus.add(nom);
    return nom;
  };
  const entetes: string[] = [];
  const mapping: Record<string, string> = {};
  const ajouter = (libelle: string, cible: string | null) => { const e = unique(libelle); entetes.push(e); if (cible) mapping[e] = cible; return e; };
  ajouter(COL_NOM, NOM);
  if (t.famille === 'tiers') ajouter(COL_ROLES, ROLES);
  for (const c of t.champs) ajouter(c.libelle, c.id);
  const reference = ajouter(COL_REFERENCE, null);
  const statut = ajouter(COL_STATUT, null);
  const maj = ajouter(COL_MAJ, null);
  return { entetes, mapping, reference, statut, maj };
}

/** En-têtes et colonne d'identification d'une table, pour `TableCreee`. */
const parColonnes = (t: DefType) => { const c = colonnesDe(t); return { entetes: c.entetes, reference: c.reference }; };

/** En-têtes d'un onglet : lisibles par un humain, la référence et l'état du jeu à la fin. */
export const entetesDe = (t: DefType): string[] => colonnesDe(t).entetes;

/** Correspondance en-tête → cible du jeu (les colonnes du jeu, elles, ne sont rattachées à rien). */
export const mappingDe = (t: DefType): Record<string, string> => colonnesDe(t).mapping;

/** Nom d'onglet unique et accepté partout (ni apostrophe courbe à rallonge, ni doublon). */
function nomsOnglets(types: readonly DefType[]): Map<string, string> {
  const vus = new Set<string>();
  const noms = new Map<string, string>();
  for (const t of types) {
    const base = texteCourt(t.pluriel || t.libelle || t.id, 50) || t.id;
    let nom = base;
    for (let n = 2; vus.has(nom.toLowerCase()); n++) nom = `${base} ${n}`;
    vus.add(nom.toLowerCase());
    noms.set(t.id, nom);
  }
  return noms;
}

// ---------------------------------------------------------------- création du classeur chez l'outil

type Config = Readonly<Record<string, string>>;
/** Appel à l'outil avec la connexion du compte choisi (jeton renouvelé au besoin par la synchro). */
export type AppelOutil = <T>(config: Record<string, string>, appel: (cfg: Config, secret: string | null, f: Recuperateur) => Promise<T>) => Promise<T>;

export interface TableCreee { typeId: string; cle: string; nom: string; entetes: string[]; reference: string }
export interface ClasseurCree { id: string; url: string; tables: TableCreee[] }

interface OutilMiroir {
  source: TypeSource;
  fournisseur: FournisseurOAuth;
  /** Crée le classeur et ses tables. `precision` : page parente (Notion) ou espace de travail (Airtable). */
  creer(appel: AppelOutil, nom: string, types: readonly DefType[], noms: Map<string, string>, precision: string): Promise<ClasseurCree>;
  /** Classeur déjà existant désigné par l'entreprise : ses tables sont créées dedans si elles manquent. */
  designer(appel: AppelOutil, lien: string, nom: string, types: readonly DefType[], noms: Map<string, string>): Promise<ClasseurCree>;
  /** Réglages du branchement (lecture) et de l'écriture pour une table. */
  config(classeur: ClasseurSuivi, table: TableSuivi): Record<string, string>;
}

// ----- Google Sheets (API Sheets v4 : POST /v4/spreadsheets crée le classeur et ses onglets en un appel)

const API_SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
const ID_CLASSEUR = /^[A-Za-z0-9_-]{20,100}$/;

function lireClasseurGoogle(donnees: unknown): { id: string; url: string; onglets: Map<string, string> } {
  const d = estObj(donnees) ? donnees : {};
  const id = typeof d.spreadsheetId === 'string' ? d.spreadsheetId : '';
  if (!ID_CLASSEUR.test(id)) throw new ErreurSortante('Google n’a pas renvoyé l’identifiant du classeur.');
  const onglets = new Map<string, string>();
  for (const s of Array.isArray(d.sheets) ? d.sheets : []) {
    const titre = (s as { properties?: { title?: unknown } } | null)?.properties?.title;
    if (typeof titre === 'string' && titre) onglets.set(titre.toLowerCase(), titre);
  }
  const url = typeof d.spreadsheetUrl === 'string' && d.spreadsheetUrl.startsWith('https://docs.google.com/')
    ? d.spreadsheetUrl : `https://docs.google.com/spreadsheets/d/${id}/edit`;
  return { id, url, onglets };
}

/** Écrit la ligne d'en-têtes d'un onglet (A1), en une seule requête par onglet. */
async function entetesGoogle(appel: AppelOutil, id: string, onglet: string, entetes: readonly string[]): Promise<void> {
  const plage = `'${onglet.replace(/'/g, "''")}'!A1`;
  await appel({}, (_cfg, secret, f) => {
    const u = new URL(`${API_SHEETS}/${id}/values/${encodeURIComponent(plage)}`);
    u.searchParams.set('valueInputOption', 'RAW');
    return appeler(f, u, { methode: 'PUT', entetes: { authorization: `Bearer ${secret ?? ''}` }, corps: { range: plage, majorDimension: 'ROWS', values: [entetes] } });
  });
}

const outilSheets: OutilMiroir = {
  source: 'sheets',
  fournisseur: 'google',
  async creer(appel, nom, types, noms) {
    const titres = types.map((t) => noms.get(t.id) as string);
    const { donnees } = await appel({}, (_cfg, secret, f) => appeler(f, new URL(API_SHEETS), {
      methode: 'POST', delaiMs: 30_000, entetes: { authorization: `Bearer ${secret ?? ''}` },
      corps: { properties: { title: nom }, sheets: titres.map((titre) => ({ properties: { title: titre } })) },
    }));
    const c = lireClasseurGoogle(donnees);
    const tables: TableCreee[] = [];
    for (const t of types) {
      const titre = noms.get(t.id) as string;
      const col = colonnesDe(t);
      await entetesGoogle(appel, c.id, titre, col.entetes);
      tables.push({ typeId: t.id, cle: titre, nom: titre, entetes: col.entetes, reference: col.reference });
    }
    return { id: c.id, url: c.url, tables };
  },
  async designer(appel, lien, _nom, types, noms) {
    const id = idFeuilleGoogle(lien);
    const { donnees } = await appel({}, (_cfg, secret, f) => {
      const u = new URL(`${API_SHEETS}/${id}`);
      u.searchParams.set('fields', 'spreadsheetId,spreadsheetUrl,sheets.properties.title');
      return appeler(f, u, { entetes: { authorization: `Bearer ${secret ?? ''}` } });
    });
    const c = lireClasseurGoogle(donnees);
    const manquants = types.filter((t) => !c.onglets.has((noms.get(t.id) as string).toLowerCase()));
    if (manquants.length) {
      await appel({}, (_cfg, secret, f) => appeler(f, new URL(`${API_SHEETS}/${c.id}:batchUpdate`), {
        methode: 'POST', delaiMs: 30_000, entetes: { authorization: `Bearer ${secret ?? ''}` },
        corps: { requests: manquants.map((t) => ({ addSheet: { properties: { title: noms.get(t.id) as string } } })) },
      }));
    }
    const tables: TableCreee[] = [];
    for (const t of types) {
      const titre = c.onglets.get((noms.get(t.id) as string).toLowerCase()) ?? (noms.get(t.id) as string);
      const col = colonnesDe(t);
      if (manquants.includes(t)) await entetesGoogle(appel, c.id, titre, col.entetes);
      tables.push({ typeId: t.id, cle: titre, nom: titre, entetes: col.entetes, reference: col.reference });
    }
    return { id: c.id, url: c.url, tables };
  },
  config: (classeur, table) => ({ classeur: `https://docs.google.com/spreadsheets/d/${classeur.id}/edit`, feuille: table.cle, colonneId: table.reference }),
};

// ----- Notion (une base de données, une source de données par type : POST /v1/databases puis POST /v1/data_sources)

const API_NOTION = 'https://api.notion.com/v1';
/**
 * Version de l'API Notion utilisée par le jeu pour écrire. Depuis 2025-09-03, une base est un conteneur de sources
 * de données : les lignes se créent dans une source (`data_source_id`), plus dans la base.
 */
const VERSION_NOTION = '2026-03-11';
const ID_NOTION = /^[0-9a-f]{32}$/i;
const sansTiret = (x: string) => x.replace(/-/g, '');
const avecTirets = (x: string) => x.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

/** Schéma d'une source de données Notion : exactement une propriété `title` (le nom), le reste selon le type du champ. */
function proprietesNotion(t: DefType): Record<string, unknown> {
  const col = colonnesDe(t);
  const p: Record<string, unknown> = {};
  for (const e of col.entetes) {
    if (e === col.entetes[0]) { p[e] = { title: {} }; continue; } // le nom : la seule propriété « title » d'un tableau
    if (e === col.statut) { p[e] = { select: { options: [{ name: STATUT_ACTIVE, color: 'green' }, { name: STATUT_SUPPRIMEE, color: 'red' }] } }; continue; }
    const champ = t.champs.find((c) => c.id === col.mapping[e]);
    switch (champ?.type) {
      case 'nombre': p[e] = { number: { format: 'number' } }; break;
      case 'montant': p[e] = { number: { format: 'euro' } }; break;
      case 'date': p[e] = { date: {} }; break;
      case 'booleen': p[e] = { checkbox: {} }; break;
      default: p[e] = { rich_text: {} };
    }
  }
  return p;
}

async function appelNotion(appel: AppelOutil, chemin: string, methode: string, corps?: unknown): Promise<unknown> {
  return appel({}, async (_cfg, secret, f) => (await appeler(f, new URL(`${API_NOTION}${chemin}`), {
    methode, delaiMs: 30_000, entetes: { authorization: `Bearer ${secret ?? ''}`, 'notion-version': VERSION_NOTION },
    ...(corps !== undefined ? { corps } : {}),
  })).donnees);
}

const titreNotion = (nom: string) => [{ text: { content: nom.slice(0, 2000) } }];

function sourcesNotion(d: unknown): { id: string; nom: string }[] {
  const liste = estObj(d) && Array.isArray(d.data_sources) ? d.data_sources : [];
  const r: { id: string; nom: string }[] = [];
  for (const s of liste) {
    const x = s as { id?: unknown; name?: unknown } | null;
    if (typeof x?.id === 'string' && ID_NOTION.test(sansTiret(x.id))) r.push({ id: sansTiret(x.id), nom: texteCourt(x.name, 100) });
  }
  return r;
}

const outilNotion: OutilMiroir = {
  source: 'notion',
  fournisseur: 'notion',
  async creer(appel, nom, types, noms, precision) {
    const [premier, ...suite] = types;
    if (!premier) throw new ErreurSortante('Aucun type d’objet à suivre.');
    // page parente : Notion n'autorise la création à la racine de l'espace que pour une connexion publique
    const page = precision ? sansTiret(pageNotion(precision)) : '';
    const parent = page ? { type: 'page_id', page_id: avecTirets(page) } : { type: 'workspace', workspace: true };
    let base: unknown;
    try {
      base = await appelNotion(appel, '/databases', 'POST', {
        parent, title: titreNotion(nom),
        initial_data_source: { name: titreNotion(noms.get(premier.id) as string), properties: proprietesNotion(premier) },
      });
    } catch (e) {
      if (!page && e instanceof ErreurSortante && (e.statut === 400 || e.statut === 404)) {
        throw new ErreurSortante('Notion n’autorise pas la création à la racine de votre espace : collez le lien d’une page Notion où ranger le fichier de suivi, et partagez-la avec la connexion (••• → Connexions).');
      }
      throw e;
    }
    const id = estObj(base) && typeof base.id === 'string' ? sansTiret(base.id) : '';
    if (!ID_NOTION.test(id)) throw new ErreurSortante('Notion n’a pas renvoyé l’identifiant de la base de données.');
    const premiere = sourcesNotion(base)[0];
    if (!premiere) throw new ErreurSortante('Notion n’a pas renvoyé le tableau de la base de données.');
    const tables: TableCreee[] = [{ typeId: premier.id, cle: premiere.id, nom: noms.get(premier.id) as string, ...parColonnes(premier) }];
    for (const t of suite) {
      const r = await appelNotion(appel, '/data_sources', 'POST', {
        parent: { type: 'database_id', database_id: avecTirets(id) }, title: titreNotion(noms.get(t.id) as string), properties: proprietesNotion(t),
      });
      const sid = estObj(r) && typeof r.id === 'string' ? sansTiret(r.id) : '';
      if (!ID_NOTION.test(sid)) throw new ErreurSortante(`Notion n’a pas créé le tableau « ${noms.get(t.id) as string} ».`);
      tables.push({ typeId: t.id, cle: sid, nom: noms.get(t.id) as string, ...parColonnes(t) });
    }
    return { id, url: `https://www.notion.so/${id}`, tables };
  },
  async designer(appel, lien, _nom, types, noms) {
    const id = sansTiret(pageNotion(lien));
    const base = await appelNotion(appel, `/databases/${avecTirets(id)}`, 'GET');
    const existantes = new Map(sourcesNotion(base).map((s) => [s.nom.toLowerCase(), s.id]));
    const tables: TableCreee[] = [];
    for (const t of types) {
      const nomTable = noms.get(t.id) as string;
      let cle = existantes.get(nomTable.toLowerCase()) ?? '';
      if (!cle) {
        const r = await appelNotion(appel, '/data_sources', 'POST', {
          parent: { type: 'database_id', database_id: avecTirets(id) }, title: titreNotion(nomTable), properties: proprietesNotion(t),
        });
        cle = estObj(r) && typeof r.id === 'string' ? sansTiret(r.id) : '';
      }
      if (!ID_NOTION.test(cle)) throw new ErreurSortante(`Notion n’a pas créé le tableau « ${nomTable} ».`);
      tables.push({ typeId: t.id, cle, nom: nomTable, ...parColonnes(t) });
    }
    return { id, url: `https://www.notion.so/${id}`, tables };
  },
  config: (_classeur, table) => ({ base: `source:${table.cle}` }),
};

/** Identifiant Notion (32 hexadécimaux) tiré d'un lien collé ou saisi tel quel. */
export function pageNotion(brut: string): string {
  const t = (brut ?? '').trim();
  const direct = sansTiret(t);
  if (ID_NOTION.test(direct)) return direct;
  const m = /([0-9a-f]{32})(?:[?#].*)?$/i.exec(sansTiret(t.replace(/[?#].*$/, '')));
  if (!m) throw new ErreurSortante('Lien Notion non reconnu : collez le lien de la page (il finit par 32 caractères).');
  return (m[1] as string).toLowerCase();
}

// ----- Airtable (POST /v0/meta/bases crée la base et ses tables ; POST /v0/meta/bases/{id}/tables en ajoute une)

const API_AIRTABLE = 'https://api.airtable.com/v0';
const ID_BASE = /^app[A-Za-z0-9]{14}$/;
const ID_TABLE = /^tbl[A-Za-z0-9]{14}$/;
const ID_ESPACE = /^wsp[A-Za-z0-9]{14}$/;

/** Champs d'une table Airtable : le premier (le nom) devient le champ principal. */
function champsAirtable(t: DefType): { name: string; type: string; options?: Record<string, unknown> }[] {
  const col = colonnesDe(t);
  return col.entetes.map((e) => {
    if (e === col.statut) return { name: e, type: 'singleSelect', options: { choices: [{ name: STATUT_ACTIVE, color: 'greenBright' }, { name: STATUT_SUPPRIMEE, color: 'redBright' }] } };
    const champ = t.champs.find((c) => c.id === col.mapping[e]);
    switch (champ?.type) {
      case 'nombre': case 'montant': return { name: e, type: 'number', options: { precision: 2 } };
      case 'date': return { name: e, type: 'date', options: { dateFormat: { name: 'iso' } } };
      case 'booleen': return { name: e, type: 'checkbox', options: { color: 'greenBright', icon: 'check' } };
      default: return { name: e, type: 'singleLineText' };
    }
  });
}

const outilAirtable: OutilMiroir = {
  source: 'airtable',
  fournisseur: 'airtable',
  async creer(appel, nom, types, noms, precision) {
    const espace = (precision ?? '').trim();
    if (!ID_ESPACE.test(espace)) {
      throw new ErreurSortante('Airtable ne donne pas la liste de vos espaces de travail : collez l’identifiant de l’espace (il commence par wsp…, visible dans l’adresse airtable.com/wsp…), ou désignez une base existante.');
    }
    const { donnees } = await appel({}, (_cfg, secret, f) => appeler(f, new URL(`${API_AIRTABLE}/meta/bases`), {
      methode: 'POST', delaiMs: 30_000, entetes: { authorization: `Bearer ${secret ?? ''}` },
      corps: { name: nom, workspaceId: espace, tables: types.map((t) => ({ name: noms.get(t.id) as string, fields: champsAirtable(t) })) },
    }));
    const d = estObj(donnees) ? donnees : {};
    const id = typeof d.id === 'string' ? d.id : '';
    if (!ID_BASE.test(id)) throw new ErreurSortante('Airtable n’a pas renvoyé l’identifiant de la base.');
    const creees = new Map<string, string>();
    for (const x of Array.isArray(d.tables) ? d.tables : []) {
      const t = x as { id?: unknown; name?: unknown } | null;
      if (typeof t?.id === 'string' && ID_TABLE.test(t.id) && typeof t.name === 'string') creees.set(t.name.toLowerCase(), t.id);
    }
    const tables = types.map((t) => {
      const nomTable = noms.get(t.id) as string;
      const cle = creees.get(nomTable.toLowerCase());
      if (!cle) throw new ErreurSortante(`Airtable n’a pas créé la table « ${nomTable} ».`);
      return { typeId: t.id, cle, nom: nomTable, ...parColonnes(t) };
    });
    return { id, url: `https://airtable.com/${id}`, tables };
  },
  async designer(appel, lien, _nom, types, noms) {
    const m = /(app[A-Za-z0-9]{14})/.exec(lien ?? '');
    const id = m?.[1] ?? '';
    if (!ID_BASE.test(id)) throw new ErreurSortante('Lien Airtable non reconnu : collez le lien de la base (il contient app… suivi de 14 caractères).');
    const { donnees } = await appel({}, (_cfg, secret, f) => appeler(f, new URL(`${API_AIRTABLE}/meta/bases/${id}/tables`), { entetes: { authorization: `Bearer ${secret ?? ''}` } }));
    const existantes = new Map<string, string>();
    for (const x of Array.isArray((donnees as { tables?: unknown } | null)?.tables) ? ((donnees as { tables: unknown[] }).tables) : []) {
      const t = x as { id?: unknown; name?: unknown } | null;
      if (typeof t?.id === 'string' && ID_TABLE.test(t.id) && typeof t.name === 'string') existantes.set(t.name.toLowerCase(), t.id);
    }
    const tables: TableCreee[] = [];
    for (const t of types) {
      const nomTable = noms.get(t.id) as string;
      let cle = existantes.get(nomTable.toLowerCase()) ?? '';
      if (!cle) {
        const { donnees: r } = await appel({}, (_cfg, secret, f) => appeler(f, new URL(`${API_AIRTABLE}/meta/bases/${id}/tables`), {
          methode: 'POST', delaiMs: 30_000, entetes: { authorization: `Bearer ${secret ?? ''}` }, corps: { name: nomTable, fields: champsAirtable(t) },
        }));
        cle = typeof (r as { id?: unknown } | null)?.id === 'string' ? (r as { id: string }).id : '';
      }
      if (!ID_TABLE.test(cle)) throw new ErreurSortante(`Airtable n’a pas créé la table « ${nomTable} ».`);
      tables.push({ typeId: t.id, cle, nom: nomTable, ...parColonnes(t) });
    }
    return { id, url: `https://airtable.com/${id}`, tables };
  },
  config: (classeur, table) => ({ base: classeur.id, table: table.cle }),
};

const OUTILS: Readonly<Record<OutilSuivi, OutilMiroir>> = { sheets: outilSheets, notion: outilNotion, airtable: outilAirtable };

/** Outil d'un branchement, quand il peut porter un fichier de suivi. */
export const outilDe = (source: TypeSource): OutilSuivi | null => (EST_OUTIL(source) ? source : null);

// ---------------------------------------------------------------- le miroir

export interface OptionsMiroir {
  etat?: EtatMiroir | null;
  changement?: () => void;
  /** Horloge des essais (tests). */
  maintenant?: () => Date;
}

export class Miroir {
  #monde: Monde;
  #synchro: Synchro;
  #etat: EtatMiroir;
  #changement: () => void;
  #attente: NodeJS.Timeout | null = null;
  #enCours = false;
  /** Un changement est arrivé pendant un envoi : un passage de plus suit. */
  #encore = false;

  constructor(monde: Monde, synchro: Synchro, o: OptionsMiroir = {}) {
    this.#monde = monde;
    this.#synchro = synchro;
    this.#changement = o.changement ?? (() => {});
    this.#etat = lireEtat(o.etat);
  }

  instantane(): EtatMiroir {
    return {
      classeur: this.#etat.classeur ? { ...this.#etat.classeur, tables: { ...this.#etat.classeur.tables } } : null,
      exclus: [...this.#etat.exclus], empreintes: { ...this.#etat.empreintes }, lignes: { ...this.#etat.lignes },
      attente: this.#etat.attente.map((a) => ({ ...a })), dernier: this.#etat.dernier ? { ...this.#etat.dernier } : null,
    };
  }

  #admin(p: Profil) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
  }

  #maintenant(): Date {
    return this.#monde.maintenant();
  }

  get classeur(): ClasseurSuivi | null {
    return this.#etat.classeur;
  }

  /** Un type est suivi tant que l'entreprise ne l'a pas décoché (par défaut, tout est suivi). */
  suivi(typeId: string): boolean {
    return !this.#etat.exclus.includes(typeId);
  }

  // ----- ce que voit la personne (Réglages → « Mon fichier de suivi »)

  /**
   * Proposition montrée tant qu'aucun fichier de suivi n'existe : le premier compte capable d'écrire, Google
   * d'abord. null : aucun compte branché qui sache écrire.
   */
  proposition(): { compte: string; outil: OutilSuivi; nomOutil: string; chez: string; phrase: string; bouton: string } | null {
    if (this.#etat.classeur) return null;
    const comptes = this.#comptes();
    const choisi = comptes.find((c) => c.outil === 'sheets') ?? comptes[0];
    if (!choisi) return null;
    const e = ENDROIT[choisi.outil];
    return {
      compte: choisi.id, outil: choisi.outil, nomOutil: e.outil, chez: e.chez,
      phrase: `Tout ce que vous créez ici peut s’écrire aussi dans un fichier de suivi, chez vous, dans ${e.chez}.`,
      bouton: `Créer mon fichier de suivi dans ${e.chez}`,
    };
  }

  /** Comptes branchés capables d'écrire un fichier de suivi (connexion « Se connecter avec… »). */
  #comptes(): { id: string; outil: OutilSuivi; nom: string; fournisseur: FournisseurOAuth }[] {
    const r: { id: string; outil: OutilSuivi; nom: string; fournisseur: FournisseurOAuth }[] = [];
    for (const c of this.#synchro.comptesEcriture()) {
      const outil = outilDe(c.source);
      if (outil && OUTILS[outil].fournisseur === c.fournisseur) r.push({ id: c.id, outil, nom: c.nom, fournisseur: c.fournisseur });
    }
    // Google d'abord, puis Notion, puis Airtable
    return r.sort((a, b) => OUTILS_SUIVI.indexOf(a.outil) - OUTILS_SUIVI.indexOf(b.outil));
  }

  vue(p: Profil) {
    this.#admin(p);
    const c = this.#etat.classeur;
    const types = typesSuivis(this.#monde.univers);
    const attente = this.#etat.attente.length;
    return {
      classeur: c ? { outil: c.outil, nomOutil: ENDROIT[c.outil].outil, nom: c.nom, url: c.url, creeLe: c.creeLe } : null,
      proposition: this.proposition(),
      comptes: this.#comptes().map((x) => ({ id: x.id, outil: x.outil, nomOutil: ENDROIT[x.outil].outil, nom: x.nom })),
      types: types.map((t) => ({ id: t.id, libelle: t.pluriel, famille: t.famille, suivi: this.suivi(t.id), onglet: c?.tables[t.id]?.nom ?? null, lignes: this.#comptees(t.id) })),
      attente,
      dernier: this.#etat.dernier,
      // message simple, sans jargon : l'état du dernier envoi
      message: !c ? null
        : !this.#compteVivant() ? `Le compte ${ENDROIT[c.outil].outil} qui porte ce fichier n’est plus branché : rebranchez-le dans Connecteurs, rien n’est perdu en attendant.`
          : attente ? `${attente === 1 ? 'Un envoi est' : `${attente} envois sont`} en attente : Living Business réessaie tout seul. Rien n’est perdu.`
            : this.#etat.dernier?.ok === false ? `Dernier envoi : ${this.#etat.dernier.message ?? 'échec'}`
              : this.#etat.dernier ? 'Tout est à jour dans votre fichier de suivi.' : 'Fichier de suivi prêt.',
    };
  }

  #comptees(typeId: string): number {
    return Object.values(this.#etat.lignes).filter((l) => l.type === typeId).length;
  }

  // ----- création

  /** Appel à l'outil avec la connexion du compte choisi. */
  #appel(compte: string): AppelOutil {
    return (config, appel) => this.#synchro.avecCompte(compte, config, appel);
  }

  /**
   * Crée le classeur : un onglet par type, une ligne d'en-têtes lisible, puis un branchement de LECTURE par onglet
   * (les lignes ajoutées à la main reviennent par la synchronisation déjà en place). Tout est ensuite réécrit.
   */
  async creer(p: Profil, d: unknown): Promise<ReturnType<Miroir['vue']>> {
    this.#admin(p);
    if (this.#etat.classeur) throw new ErreurApi(409, 'deja_cree', 'Vous avez déjà un fichier de suivi.');
    const x = estObj(d) ? d : {};
    const choix = this.#choisirCompte(x.compte, x.outil);
    const nom = texteCourt(x.nom, 90) || `Suivi — ${texteCourt(this.#monde.organisation.nom, 60) || 'mon entreprise'}`;
    const types = typesSuivis(this.#monde.univers);
    const noms = nomsOnglets(types);
    const precision = texteCourt(x.precision, 300);
    const lien = texteCourt(x.lien, 500);
    const outil = OUTILS[choix.outil];
    let cree: ClasseurCree;
    try {
      cree = lien ? await outil.designer(this.#appel(choix.id), lien, nom, types, noms) : await outil.creer(this.#appel(choix.id), nom, types, noms, precision);
    } catch (e) {
      throw new ErreurApi(502, 'creation_impossible', e instanceof ErreurSortante ? e.message : 'Création du fichier de suivi impossible.');
    }
    const classeur: ClasseurSuivi = {
      outil: choix.outil, id: cree.id, nom, url: cree.url, compte: choix.id, creeLe: this.#maintenant().toISOString(),
      tables: Object.fromEntries(cree.tables.map((t) => [t.typeId, { cle: t.cle, nom: t.nom, entetes: t.entetes, reference: t.reference, connecteur: null }])),
    };
    this.#etat = { ...this.#etat, classeur, empreintes: {}, lignes: {}, attente: [] };
    this.#brancherLectures();
    this.#changement();
    this.planifier();
    return this.vue(p);
  }

  /** Classeur déjà existant désigné par l'entreprise : mêmes onglets, créés s'ils manquent. */
  async designer(p: Profil, d: unknown): Promise<ReturnType<Miroir['vue']>> {
    const x = estObj(d) ? d : {};
    if (!texteCourt(x.lien, 500)) throw new ErreurApi(400, 'lien_manquant', 'Collez le lien de votre classeur.');
    return this.creer(p, x);
  }

  #choisirCompte(compte: unknown, outilVoulu: unknown): { id: string; outil: OutilSuivi } {
    const comptes = this.#comptes();
    if (!comptes.length) throw new ErreurApi(409, 'aucun_compte', 'Connectez d’abord un compte Google, Notion ou Airtable capable d’écrire.');
    const choisi = typeof compte === 'string' ? comptes.find((c) => c.id === compte)
      : EST_OUTIL(outilVoulu) ? comptes.find((c) => c.outil === outilVoulu)
        : (comptes.find((c) => c.outil === 'sheets') ?? comptes[0]);
    if (!choisi) throw new ErreurApi(404, 'compte_introuvable', 'Ce compte n’est plus branché : choisissez-en un autre.');
    return { id: choisi.id, outil: choisi.outil };
  }

  /** Un branchement de lecture par onglet suivi, pour que les lignes ajoutées à la main entrent dans le jeu. */
  #brancherLectures() {
    const c = this.#etat.classeur;
    if (!c) return;
    const outil = OUTILS[c.outil];
    for (const [typeId, table] of Object.entries(c.tables)) {
      const suivi = this.suivi(typeId);
      if (!suivi) { if (table.connecteur) { this.#synchro.supprimerMiroir(table.connecteur); table.connecteur = null; } continue; }
      if (table.connecteur && this.#synchro.existeMiroir(table.connecteur)) continue;
      const t = defType(this.#monde.univers, typeId);
      if (!t) continue;
      // compte débranché entre-temps : le miroir reste en place et le dit ; les branchements repartent à son retour
      try {
        table.connecteur = this.#synchro.creerMiroir({
          compte: c.compte, source: outil.source, nom: `Suivi — ${table.nom}`, typeObjet: typeId,
          config: outil.config(c, table), mapping: mappingDe(t),
        });
      } catch { table.connecteur = null; }
    }
  }

  /** Le compte qui porte le classeur est-il encore branché ? */
  #compteVivant(): boolean {
    const c = this.#etat.classeur;
    return Boolean(c) && this.#synchro.comptesEcriture().some((x) => x.id === c?.compte);
  }

  // ----- réglages

  regler(p: Profil, d: unknown): ReturnType<Miroir['vue']> {
    this.#admin(p);
    const x = estObj(d) ? d : {};
    const types = typesSuivis(this.#monde.univers).map((t) => t.id);
    if (Array.isArray(x.suivis)) {
      const voulus = new Set(x.suivis.filter((v): v is string => typeof v === 'string'));
      this.#etat.exclus = types.filter((t) => !voulus.has(t));
    } else if (typeof x.type === 'string' && types.includes(x.type)) {
      const exclus = new Set(this.#etat.exclus);
      if (x.suivi === false) exclus.add(x.type);
      else exclus.delete(x.type);
      this.#etat.exclus = [...exclus];
    } else {
      throw new ErreurApi(400, 'requete_invalide', 'Indiquez le type à suivre ou non.');
    }
    this.#brancherLectures();
    this.#changement();
    this.planifier();
    return this.vue(p);
  }

  /** « Tout réécrire » : le jeu repart d'un classeur propre, toutes les fiches sont renvoyées. */
  toutReecrire(p: Profil): ReturnType<Miroir['vue']> {
    this.#admin(p);
    if (!this.#etat.classeur) throw new ErreurApi(409, 'pas_de_classeur', 'Créez d’abord votre fichier de suivi.');
    this.#etat.empreintes = {};
    this.#etat.attente = [];
    this.#etat.dernier = null;
    this.#brancherLectures();
    this.#changement();
    this.planifier();
    return this.vue(p);
  }

  /** « Ne plus suivre » : le jeu oublie le classeur. Rien n'est effacé chez l'entreprise, le fichier lui reste. */
  detacher(p: Profil): ReturnType<Miroir['vue']> {
    this.#admin(p);
    const c = this.#etat.classeur;
    for (const t of Object.values(c?.tables ?? {})) if (t.connecteur) this.#synchro.supprimerMiroir(t.connecteur);
    this.#etat = { ...ETAT_MIROIR_VIDE, exclus: [...this.#etat.exclus] };
    this.#changement();
    return this.vue(p);
  }

  // ----- envois

  /** Un changement du monde : les fiches modifiées partent tout de suite (regroupées sur un court instant). */
  planifier(): void {
    if (!this.#etat.classeur) return;
    if (this.#enCours) { this.#encore = true; return; }
    if (this.#attente) return;
    this.#attente = setTimeout(() => { this.#attente = null; void this.passer().catch(() => undefined); }, 250);
    this.#attente.unref?.();
  }

  surChangement(action: string): void {
    // une lecture entrante ne déclenche rien par elle-même : la fiche changée est vue à l'empreinte
    if (action === 'synchro.entrante') return;
    this.planifier();
  }

  /**
   * Fiche effacée ou anonymisée : sa ligne est MARQUÉE supprimée, jamais retirée du classeur (les données de
   * l'entreprise sont à elle). À appeler avant que la synchro oublie ses liens.
   */
  surEffacement(objId: string): void {
    const c = this.#etat.classeur;
    const ligne = this.#etat.lignes[objId];
    delete this.#etat.empreintes[objId];
    if (!c || !ligne || !c.tables[ligne.type]) { delete this.#etat.lignes[objId]; return; }
    const t = defType(this.#monde.univers, ligne.type);
    const col = t ? colonnesDe(t) : null;
    if (!col) { delete this.#etat.lignes[objId]; return; }
    this.#empiler({
      objet: objId, type: ligne.type, quoi: 'suppression', essais: 0, prochain: this.#maintenant().toISOString(), erreur: null,
      valeurs: { [col.statut]: STATUT_SUPPRIMEE, [col.maj]: this.#maintenant().toISOString().slice(0, 10) },
    });
    this.#changement();
    this.planifier();
  }

  #empiler(e: EnvoiEnAttente) {
    const i = this.#etat.attente.findIndex((a) => a.objet === e.objet && a.quoi === e.quoi);
    if (i >= 0) this.#etat.attente[i] = e;
    else this.#etat.attente.push(e);
    if (this.#etat.attente.length > ATTENTE_MAX) this.#etat.attente.splice(0, this.#etat.attente.length - ATTENTE_MAX);
  }

  /** Fiches dont le contenu a changé depuis le dernier envoi (anti-boucle par empreinte). */
  #aEnvoyer(): EnvoiEnAttente[] {
    const c = this.#etat.classeur;
    if (!c) return [];
    const maintenant = this.#maintenant().toISOString();
    const neufs: EnvoiEnAttente[] = [];
    for (const o of this.#monde.objetsReels()) {
      if (o.mode !== 'reel' || !c.tables[o.type] || !this.suivi(o.type)) continue;
      const e = this.#monde.empreinte(o.id);
      if (!e || e === this.#etat.empreintes[o.id]) continue;
      if (this.#etat.attente.some((a) => a.objet === o.id)) continue;
      neufs.push({ objet: o.id, type: o.type, quoi: 'ligne', essais: 0, prochain: maintenant, erreur: null });
    }
    return neufs;
  }

  /**
   * Valeurs d'une fiche pour sa ligne du classeur (colonnes du jeu comprises). `ext` : référence déjà portée par la
   * ligne — elle est gardée telle quelle, sinon la synchronisation ne retrouverait plus la ligne qu'elle a reliée.
   */
  #valeurs(objId: string, typeId: string, ext: string | null): Record<string, ValeurSortante> | null {
    const t = defType(this.#monde.univers, typeId);
    const c = this.#etat.classeur;
    if (!t || !c?.tables[typeId]) return null;
    const col = colonnesDe(t);
    const v = this.#monde.valeursExport(objId, Object.values(col.mapping));
    const r: Record<string, ValeurSortante> = {};
    for (const [entete, cible] of Object.entries(col.mapping)) r[entete] = v[cible] ?? null;
    r[col.reference] = ext ?? objId;
    r[col.statut] = STATUT_ACTIVE;
    r[col.maj] = this.#maintenant().toISOString().slice(0, 10);
    return r;
  }

  /** Tous les envois en attente redeviennent dus : « Envoyer maintenant » n'attend pas le prochain essai. */
  relancer(): void {
    const maintenant = this.#maintenant().toISOString();
    for (const a of this.#etat.attente) a.prochain = maintenant;
  }

  /**
   * Un passage : les fiches changées et les envois en attente partent vers le classeur. Un échec n'arrête rien :
   * l'envoi reste en attente et sera réessayé.
   */
  async passer(): Promise<{ envoyees: number; restants: number }> {
    const c = this.#etat.classeur;
    if (!c || this.#enCours) return { envoyees: 0, restants: this.#etat.attente.length };
    this.#enCours = true;
    let envoyees = 0;
    let erreur: string | null = null;
    try {
      for (const n of this.#aEnvoyer()) this.#empiler(n);
      // compte débranché : les envois restent en attente, aucun appel inutile n'est tenté
      if (!this.#compteVivant()) return { envoyees: 0, restants: this.#etat.attente.length };
      const maintenant = this.#maintenant().getTime();
      const prets = this.#etat.attente.filter((a) => Date.parse(a.prochain) <= maintenant).slice(0, PAR_PASSAGE);
      for (const a of prets) {
        const table = c.tables[a.type];
        const connue = table ? this.#ligneDe(table, a.objet) : null;
        const valeurs = a.quoi === 'suppression' ? (a.valeurs ?? null) : this.#valeurs(a.objet, a.type, connue);
        if (!table || !valeurs) { this.#retirer(a); continue; }
        try {
          const ext = await this.#ecrire(c, table, a, valeurs);
          if (a.quoi === 'ligne') {
            if (ext) this.#etat.lignes[a.objet] = { type: a.type, ext };
            const e = this.#monde.empreinte(a.objet);
            if (e) this.#etat.empreintes[a.objet] = e;
            if (table.connecteur && ext) this.#synchro.lierMiroir(table.connecteur, ext, a.objet);
          } else {
            delete this.#etat.lignes[a.objet];
          }
          this.#retirer(a);
          envoyees++;
        } catch (e) {
          a.essais++;
          a.erreur = (e instanceof Error ? e.message : 'erreur').slice(0, 200);
          a.prochain = new Date(maintenant + (REESSAIS_S[Math.min(a.essais - 1, REESSAIS_S.length - 1)] as number) * 1000).toISOString();
          erreur = a.erreur;
        }
      }
      this.#etat.dernier = { le: this.#maintenant().toISOString(), ok: erreur === null, envoyees, message: erreur };
    } finally {
      this.#enCours = false;
      this.#changement();
    }
    if (this.#encore) { this.#encore = false; this.planifier(); }
    return { envoyees, restants: this.#etat.attente.length };
  }

  #retirer(a: EnvoiEnAttente) {
    const i = this.#etat.attente.indexOf(a);
    if (i >= 0) this.#etat.attente.splice(i, 1);
  }

  /** Écrit (ou met à jour) la ligne d'une fiche, avec l'adaptateur de l'outil et la connexion du compte. */
  async #ecrire(c: ClasseurSuivi, table: TableSuivi, a: EnvoiEnAttente, valeurs: Record<string, ValeurSortante>): Promise<string | null> {
    const outil = OUTILS[c.outil];
    const ecrire = ADAPTATEURS[outil.source].ecrire;
    if (!ecrire) throw new ErreurSortante(`${ENDROIT[c.outil].outil} ne sait pas écrire.`);
    const config = outil.config(c, table);
    return this.#synchro.avecCompte(c.compte, config, (cfg, secret, f) => ecrire(cfg, secret, this.#ligneDe(table, a.objet), valeurs, f));
  }

  /** Ligne déjà connue du jeu, sinon celle que le branchement de lecture a reliée (ligne ajoutée à la main). */
  #ligneDe(table: TableSuivi, objId: string): string | null {
    return this.#etat.lignes[objId]?.ext ?? (table.connecteur ? this.#synchro.externeIdMiroir(table.connecteur, objId) : null) ?? null;
  }

  /**
   * Lignes ajoutées à la main dans un tableur : sans référence, la synchronisation ne les voit pas (la colonne qui
   * identifie une ligne y est vide). Le jeu leur pose une référence ; elles entrent au passage suivant.
   * Notion et Airtable donnent eux-mêmes un identifiant à chaque ligne : rien à faire.
   */
  async adopter(): Promise<number> {
    const c = this.#etat.classeur;
    if (!c || c.outil !== 'sheets') return 0;
    const outil = OUTILS[c.outil];
    const lire = ADAPTATEURS[outil.source].lire;
    const ecrire = ADAPTATEURS[outil.source].ecrire;
    if (!ecrire) return 0;
    let posees = 0;
    for (const [typeId, table] of Object.entries(c.tables)) {
      const t = defType(this.#monde.univers, typeId);
      if (!this.suivi(typeId) || !t) continue;
      // lues par le NOM : une ligne écrite à la main en a un, mais pas encore de référence
      const col = colonnesDe(t);
      const config = { ...outil.config(c, table), colonneId: col.entetes[0] as string };
      let lignes;
      try {
        lignes = await this.#synchro.avecCompte(c.compte, config, (cfg, secret, f) => lire(cfg, secret, f));
      } catch { continue; } // onglet illisible pour l'instant : repris au passage suivant
      for (const l of lignes) {
        if ((l.champs[col.reference] ?? '').trim()) continue;
        try {
          await this.#synchro.avecCompte(c.compte, config, (cfg, secret, f) => ecrire(cfg, secret, l.externeId, { [col.reference]: nouvelleReference() }, f));
          posees++;
        } catch { break; } // outil indisponible : les lignes suivantes attendent le prochain passage
      }
    }
    if (posees) this.#changement();
    return posees;
  }
}

function lireEtat(x: EtatMiroir | null | undefined): EtatMiroir {
  if (!estObj(x)) return { ...ETAT_MIROIR_VIDE };
  const c = estObj(x.classeur) ? x.classeur as unknown as ClasseurSuivi : null;
  const classeur = c && EST_OUTIL(c.outil) && typeof c.id === 'string' && typeof c.url === 'string' && typeof c.compte === 'string' && estObj(c.tables)
    ? { outil: c.outil, id: c.id, nom: texteCourt(c.nom, 90), url: c.url, compte: c.compte, creeLe: typeof c.creeLe === 'string' ? c.creeLe : '',
      tables: Object.fromEntries(Object.entries(c.tables).filter(([, t]) => estObj(t) && typeof (t as TableSuivi).cle === 'string').map(([k, t]) => {
        const v = t as TableSuivi;
        return [k, { cle: v.cle, nom: typeof v.nom === 'string' ? v.nom : v.cle, entetes: Array.isArray(v.entetes) ? v.entetes.filter((e): e is string => typeof e === 'string') : [], reference: typeof v.reference === 'string' ? v.reference : COL_REFERENCE, connecteur: typeof v.connecteur === 'string' ? v.connecteur : null }];
      })) }
    : null;
  const texteDe = (o: unknown): Record<string, string> => Object.fromEntries(Object.entries(estObj(o) ? o : {}).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  const lignesDe = (o: unknown): Record<string, { type: string; ext: string }> => Object.fromEntries(Object.entries(estObj(o) ? o : {})
    .filter((e): e is [string, { type: string; ext: string }] => estObj(e[1]) && typeof (e[1] as { type?: unknown }).type === 'string' && typeof (e[1] as { ext?: unknown }).ext === 'string')
    .map(([k, v]) => [k, { type: v.type, ext: v.ext }]));
  return {
    classeur,
    exclus: Array.isArray(x.exclus) ? x.exclus.filter((t): t is string => typeof t === 'string') : [],
    empreintes: texteDe(x.empreintes),
    lignes: lignesDe(x.lignes),
    attente: (Array.isArray(x.attente) ? x.attente : []).filter((a): a is EnvoiEnAttente => estObj(a) && typeof a.objet === 'string' && typeof a.type === 'string' && (a.quoi === 'ligne' || a.quoi === 'suppression')).slice(-ATTENTE_MAX),
    dernier: estObj(x.dernier) && typeof x.dernier.le === 'string' ? { le: x.dernier.le, ok: x.dernier.ok === true, envoyees: typeof x.dernier.envoyees === 'number' ? x.dernier.envoyees : 0, message: typeof x.dernier.message === 'string' ? x.dernier.message : null } : null,
  };
}
