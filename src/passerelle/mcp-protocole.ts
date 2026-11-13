/**
 * Model Context Protocol : ce que le serveur (/mcp), le client des connecteurs et le pont stdio partagent pour
 * parler aux deux ères du protocole.
 * - Ère « moderne » (révision 2026-07-28 et suivantes) : ni poignée de main ni session. Chaque requête porte sa version,
 *   l'identité et les capacités du client dans `_meta` ; en HTTP, les en-têtes MCP-Protocol-Version, Mcp-Method,
 *   Mcp-Name et Mcp-Param-* recopient le corps, et le serveur refuse tout écart (400, erreur −32020).
 * - Ère « ancienne » (2025-11-25 et avant) : poignée de main `initialize`, version négociée une fois.
 * Référence : https://modelcontextprotocol.io/specification/2026-07-28 (basic/versioning, basic/transports/*).
 * Aucune dépendance : ce fichier est aussi chargé par le pont stdio, hors du serveur.
 */

/** Versions servies sans poignée de main, de la préférée à la moins récente. */
export const VERSIONS_MODERNES: readonly string[] = ['2026-07-28'];
/** Versions négociées par `initialize`, de la plus récente à la plus ancienne. */
export const VERSIONS_ANCIENNES: readonly string[] = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

export const META_VERSION = 'io.modelcontextprotocol/protocolVersion';
export const META_CLIENT = 'io.modelcontextprotocol/clientInfo';
export const META_CAPACITES = 'io.modelcontextprotocol/clientCapabilities';
export const META_SERVEUR = 'io.modelcontextprotocol/serverInfo';

export const ERREUR_REQUETE = -32600;
export const ERREUR_METHODE = -32601;
export const ERREUR_PARAMETRES = -32602;
export const ERREUR_INTERNE = -32603;
/** En-têtes HTTP absents, illisibles ou différents du corps (HeaderMismatch). */
export const ERREUR_ENTETES = -32020;
/** Capacité du client exigée mais non déclarée (MissingRequiredClientCapability). */
export const ERREUR_CAPACITE = -32021;
/** Version de protocole non servie (UnsupportedProtocolVersion) : `data.supported` liste celles qui le sont. */
export const ERREUR_VERSION = -32022;

export interface ErreurRpc {
  code: number;
  message: string;
  data?: unknown;
}

export interface ReponseRpc {
  jsonrpc: '2.0';
  id?: string | number | null;
  result?: Record<string, unknown>;
  error?: ErreurRpc;
}

export const estObjet = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Réponse JSON-RPC bien formée : un résultat (objet) avec son identifiant, ou une erreur avec code entier et message. */
export function estReponseRpc(m: unknown): m is ReponseRpc {
  if (!estObjet(m) || m.jsonrpc !== '2.0' || 'method' in m) return false;
  if ('error' in m) return estObjet(m.error) && Number.isInteger(m.error.code) && typeof m.error.message === 'string';
  return estObjet(m.result) && (typeof m.id === 'string' || typeof m.id === 'number');
}

/**
 * Erreur que seul un serveur de l'ère moderne renvoie : en-têtes, capacité, version (codes réservés à la
 * spécification), ou méthode inconnue signalée par un 404. Tout autre refus (400, 404, 405) désigne un serveur ancien.
 */
export const erreurModerne = (statut: number, e: ErreurRpc): boolean =>
  e.code === ERREUR_ENTETES || e.code === ERREUR_CAPACITE || e.code === ERREUR_VERSION || (statut === 404 && e.code === ERREUR_METHODE);

/** Messages JSON d'un corps de réponse : JSON direct, ou flux SSE (un message par événement, lignes « data: »). */
export function messagesDe(texte: string): unknown[] {
  const t = texte.trim();
  if (!t) return [];
  if (t.startsWith('{') || t.startsWith('[')) {
    try { return [JSON.parse(t)]; } catch { /* pas du JSON direct : lu comme un flux */ }
  }
  const messages: unknown[] = [];
  let donnees: string[] = [];
  const clore = () => {
    if (!donnees.length) return;
    try { messages.push(JSON.parse(donnees.join('\n'))); } catch { /* événement sans JSON (amorce, battement) */ }
    donnees = [];
  };
  for (const ligne of texte.split(/\r\n|\r|\n/)) {
    if (ligne === '') clore();
    else if (ligne.startsWith('data:')) donnees.push(ligne.slice(5).replace(/^ /, ''));
  }
  clore();
  return messages;
}

// ---------------------------------------------------------------- en-têtes miroirs (Mcp-Name, Mcp-Param-*)

const PREFIXE_BASE64 = '=?base64?';
const SUFFIXE_BASE64 = '?=';
/** ASCII visible, espaces et tabulations permis au milieu seulement. */
const ASCII_SUR = /^[\x21-\x7e](?:[\x20-\x7e\t]*[\x21-\x7e])?$/;

/** Valeur placée dans un en-tête : telle quelle si elle est en ASCII sûr, sinon « =?base64?…?= » (UTF-8). */
export function encoderValeurEntete(v: string): string {
  if (ASCII_SUR.test(v) && !(v.startsWith(PREFIXE_BASE64) && v.endsWith(SUFFIXE_BASE64))) return v;
  return `${PREFIXE_BASE64}${Buffer.from(v, 'utf8').toString('base64')}${SUFFIXE_BASE64}`;
}

/** Valeur lue dans un en-tête, décodée si elle est en Base64 ; null si elle est illisible. */
export function decoderValeurEntete(v: string): string | null {
  const longueur = PREFIXE_BASE64.length + SUFFIXE_BASE64.length;
  if (!(v.length >= longueur && v.startsWith(PREFIXE_BASE64) && v.endsWith(SUFFIXE_BASE64))) return /^[\x20-\x7e\t]*$/.test(v) ? v : null;
  const b = v.slice(PREFIXE_BASE64.length, -SUFFIXE_BASE64.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(b, 'base64'));
  } catch {
    return null;
  }
}

/** Champ de `params` recopié dans l'en-tête Mcp-Name, pour les méthodes qui l'exigent. */
export function sourceNom(methode: string): 'name' | 'uri' | null {
  if (methode === 'tools/call' || methode === 'prompts/get') return 'name';
  return methode === 'resources/read' ? 'uri' : null;
}

/** Paramètre d'outil recopié dans l'en-tête `Mcp-Param-{nom}` (annotation `x-mcp-header` de son schéma). */
export interface AnnotationEntete {
  /** Suite des clés de `properties` qui mène au paramètre depuis la racine du schéma. */
  chemin: string[];
  nom: string;
}

export type LectureAnnotations = { valide: true; annotations: AnnotationEntete[] } | { valide: false; raison: string };

const ANNOTATION = 'x-mcp-header';
/** Nom de champ HTTP (RFC 9110, « token ») : aucun espace ni caractère de contrôle. */
const JETON_HTTP = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const TYPES_MIROIR: readonly unknown[] = ['string', 'integer', 'boolean'];
const SCHEMAS = ['items', 'additionalItems', 'additionalProperties', 'unevaluatedItems', 'unevaluatedProperties', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema'];
const LISTES_DE_SCHEMAS = ['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items'];
const TABLES_DE_SCHEMAS = ['$defs', 'definitions', 'patternProperties', 'dependentSchemas', 'dependencies'];
const NOEUDS_MAX = 5000;
const PROFONDEUR_MAX = 40;

const typePrimitif = (t: unknown): boolean =>
  Array.isArray(t) ? t.some((x) => x !== 'null') && t.every((x) => x === 'null' || TYPES_MIROIR.includes(x)) : TYPES_MIROIR.includes(t);

/**
 * Lit les annotations `x-mcp-header` du schéma d'entrée d'un outil et vérifie les contraintes de la spécification :
 * nom non vide, au format d'un nom d'en-tête, unique sans tenir compte de la casse ; paramètre de type chaîne, entier
 * ou booléen ; atteint depuis la racine par des clés de `properties` seulement (jamais sous `items`, `oneOf`, `anyOf`,
 * `allOf`, `not`, `if`/`then`/`else`, `$defs`…). Une seule annotation fautive rend l'outil invalide : le client l'écarte.
 */
export function annotationsEntetes(schema: unknown): LectureAnnotations {
  const annotations: AnnotationEntete[] = [];
  const noms = new Set<string>();
  let noeuds = 0;
  let raison: string | null = null;
  const visiter = (s: unknown, chemin: string[] | null, profondeur: number): void => {
    if (raison !== null || !estObjet(s)) return;
    if (++noeuds > NOEUDS_MAX || profondeur > PROFONDEUR_MAX) { raison = 'schéma trop grand pour être vérifié'; return; }
    if (ANNOTATION in s) {
      const nom = s[ANNOTATION];
      if (typeof nom !== 'string' || !JETON_HTTP.test(nom)) raison = 'valeur de x-mcp-header vide ou hors du format d’un nom d’en-tête';
      else if (chemin === null || chemin.length === 0) raison = `x-mcp-header « ${nom} » placé ailleurs que sur un paramètre atteint par « properties »`;
      else if (!typePrimitif(s.type)) raison = `x-mcp-header « ${nom} » sur un paramètre qui n’est ni une chaîne, ni un entier, ni un booléen`;
      else if (noms.has(nom.toLowerCase())) raison = `x-mcp-header « ${nom} » en double`;
      else { noms.add(nom.toLowerCase()); annotations.push({ chemin, nom }); }
      if (raison !== null) return;
    }
    if (estObjet(s.properties)) for (const [cle, v] of Object.entries(s.properties)) visiter(v, chemin ? [...chemin, cle] : null, profondeur + 1);
    for (const k of SCHEMAS) visiter(s[k], null, profondeur + 1);
    for (const k of LISTES_DE_SCHEMAS) { const l = s[k]; if (Array.isArray(l)) for (const v of l) visiter(v, null, profondeur + 1); }
    for (const k of TABLES_DE_SCHEMAS) { const t = s[k]; if (estObjet(t)) for (const v of Object.values(t)) visiter(v, null, profondeur + 1); }
  };
  visiter(schema, [], 0);
  return raison === null ? { valide: true, annotations } : { valide: false, raison };
}

/** Argument impossible à recopier dans un en-tête (objet, liste, nombre non entier ou hors de la plage sûre). */
export class ErreurEntete extends Error {}

/**
 * En-têtes `Mcp-Param-*` d'un appel d'outil : valeur lue au chemin exact de chaque paramètre annoté ; absente ou
 * nulle, l'en-tête est omis. Chaîne telle quelle, entier en décimal, booléen « true » ou « false », puis encodage.
 */
export function entetesParametres(annotations: readonly AnnotationEntete[], args: unknown): Record<string, string> {
  const entetes: Record<string, string> = {};
  for (const a of annotations) {
    let v: unknown = args;
    for (const cle of a.chemin) v = estObjet(v) && Object.hasOwn(v, cle) ? v[cle] : undefined;
    if (v === undefined || v === null) continue;
    let texte: string;
    if (typeof v === 'string') texte = v;
    else if (typeof v === 'boolean') texte = v ? 'true' : 'false';
    else if (typeof v === 'number' && Number.isSafeInteger(v)) texte = String(v);
    else throw new ErreurEntete(`Argument « ${a.chemin.join('.')} » : seuls une chaîne, un entier ou un booléen vont dans l’en-tête Mcp-Param-${a.nom}.`);
    entetes[`Mcp-Param-${a.nom}`] = encoderValeurEntete(texte);
  }
  return entetes;
}
