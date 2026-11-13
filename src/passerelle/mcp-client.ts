/**
 * Client MCP des connecteurs (transport Streamable HTTP) : parle aux serveurs des deux ères du protocole.
 * - La requête part d'abord sous sa forme moderne (2026-07-28) : version, identité et capacités dans `_meta`, en-têtes
 *   MCP-Protocol-Version, Mcp-Method, Mcp-Name et Mcp-Param-* recopiés du corps.
 * - Le serveur répond, ou refuse par une erreur que seule l'ère moderne connaît (−32020, −32021, −32022, ou 404 et
 *   −32601) : il est moderne. Sur −32022, nouvel essai avec une version que les deux parlent.
 * - Il refuse par 400, 404 ou 405 sans erreur JSON-RPC : il est ancien. Poignée de main `initialize`, puis la requête.
 * - Il répond par une autre erreur JSON-RPC (outil inconnu, « non initialisé »…), qui ne dit pas son ère :
 *   `server/discover` tranche, car un serveur moderne y répond toujours. Ancien : poignée de main, puis la requête.
 * L'ère est retenue en mémoire par adresse de serveur, et revue si elle ne tient plus. Tous les appels passent par
 * `appeler` (adresse vérifiée, redirections refusées, délai et taille bornés).
 */
import { createHash } from 'node:crypto';
import {
  annotationsEntetes, encoderValeurEntete, entetesParametres, ERREUR_ENTETES, ERREUR_VERSION, ErreurEntete, erreurModerne, estObjet, estReponseRpc, messagesDe,
  META_CAPACITES, META_CLIENT, META_VERSION, sourceNom, VERSIONS_ANCIENNES, VERSIONS_MODERNES, type ErreurRpc, type LectureAnnotations, type ReponseRpc,
} from './mcp-protocole.ts';
import { appeler, ErreurSortante, verifierUrl, type Recuperateur } from './sortant.ts';

const CLIENT = { name: 'living-business', version: '0.1.0' };
const ACCEPTE = 'application/json, text/event-stream';
/** Refus dont le corps dit l'ère du serveur. */
const STATUTS_LUS: readonly number[] = [400, 404, 405];
/** Liste d'outils suivie de page en page, dans ces limites. */
const PAGES_MAX = 20;
const OUTILS_MAX = 2000;
/** Définitions d'outils gardées en mémoire : la durée indiquée par le serveur (`ttlMs`), entre cinq minutes et une heure. */
const FRAICHEUR_MIN_MS = 5 * 60_000;
const FRAICHEUR_MAX_MS = 60 * 60_000;
const SERVEURS_MAX = 500;

export interface OptionsMcp {
  /** Versions modernes parlées, de la préférée à la moins récente. */
  versions?: readonly string[];
  /** Avertissements (outil écarté pour annotation invalide). Défaut : journal du serveur. */
  journal?: (message: string) => void;
}

const uneLigne = (t: string): string => t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);

/** Erreur JSON-RPC renvoyée par le serveur MCP. */
export class ErreurMcp extends ErreurSortante {
  readonly code: number;
  constructor(e: ErreurRpc, statut: number | null = null) {
    super(`MCP : ${uneLigne(e.message)}`, statut);
    this.code = e.code;
  }
}

const refusHttp = (statut: number): ErreurSortante => new ErreurSortante(
  statut === 404 ? 'Serveur MCP introuvable à cette adresse (404).' : statut === 405 ? 'Cette adresse n’accepte pas les requêtes MCP (405).' : `Erreur du service (${statut}).`,
  statut,
);

// ---------------------------------------------------------------- mémoire : ère et définitions d'outils par serveur

type EreConnue = { ere: 'moderne'; version: string } | { ere: 'ancienne' };
const eres = new Map<string, EreConnue>();
const definitions = new Map<string, { lectures: Map<string, LectureAnnotations>; expire: number }>();
const retenir = <V>(m: Map<string, V>, cle: string, v: V): void => {
  if (m.size >= SERVEURS_MAX && !m.has(cle)) m.clear();
  m.set(cle, v);
};

/** Oublie les ères et les définitions retenues (tests ; sans effet sur les réglages). */
export function oublierServeursMcp(): void {
  eres.clear();
  definitions.clear();
}

// ---------------------------------------------------------------- une liaison : les requêtes d'un même appel

interface Session {
  entetes: Record<string, string>;
  id: string | null;
}

type Etat =
  | { ere: 'inconnue' }
  /** `etablie` : une réponse du serveur l'a confirmée (ou elle vient de la mémoire). */
  | { ere: 'moderne'; version: string; etablie: boolean }
  /** `session` nulle : poignée de main à faire. `cause` : erreur de la requête moderne qui a mené ici. */
  | { ere: 'ancienne'; session: Session | null; deMemoire: boolean; version: string | null; cause: ErreurSortante | null };

type Issue =
  | { type: 'resultat'; resultat: Record<string, unknown> }
  | { type: 'moderne'; erreur: ErreurRpc; statut: number }
  /** Refus HTTP (400, 404, 405) sans erreur JSON-RPC : serveur ancien. */
  | { type: 'ancienne'; statut: number }
  /** Erreur JSON-RPC ordinaire : elle ne dit pas l'ère du serveur. */
  | { type: 'erreur'; erreur: ErreurRpc; statut: number };

/** Réponse à la requête `id` dans un corps JSON ou SSE ; une erreur sans identifiant (refus HTTP) vaut pour elle. */
function lire(texte: string, id: number, statut: number): ReponseRpc | null {
  const reponses = messagesDe(texte).filter(estReponseRpc);
  return reponses.find((m) => m.id === id)
    ?? reponses.find((m) => m.error !== undefined && (m.id === undefined || m.id === null || statut >= 400))
    ?? null;
}

/** `resultType` absent (serveur ancien) vaut « complete » ; tout autre type est refusé. */
function verifier(r: Record<string, unknown>): Record<string, unknown> {
  if (r.resultType === undefined || r.resultType === 'complete') return r;
  if (r.resultType === 'input_required') throw new ErreurSortante('Le serveur MCP demande une saisie en cours d’appel (question, confirmation) : Living Business ne sait pas y répondre.');
  throw new ErreurSortante('Réponse MCP d’un type inconnu.');
}

const versionsServies = (e: ErreurRpc | undefined): string[] =>
  (e && estObjet(e.data) && Array.isArray(e.data.supported) ? e.data.supported.filter((v): v is string => typeof v === 'string') : []);

class Liaison {
  readonly #u: URL;
  readonly #f: Recuperateur;
  readonly #base: Record<string, string>;
  readonly #versions: readonly string[];
  /** Adresse du serveur : clé de l'ère retenue. */
  readonly cle: string;
  /** Adresse et empreinte du jeton : les définitions d'outils ne se partagent pas d'un jeton à l'autre. */
  readonly cleOutils: string;
  #etat: Etat;
  #id = 0;

  constructor(u: URL, secret: string | null, f: Recuperateur, versions: readonly string[]) {
    this.#u = u;
    this.#f = f;
    this.#versions = versions;
    this.#base = { accept: ACCEPTE, ...(secret ? { authorization: `Bearer ${secret}` } : {}) };
    this.cle = `${u.origin}${u.pathname}`;
    this.cleOutils = `${this.cle}#${createHash('sha256').update(secret ?? '').digest('base64url').slice(0, 16)}`;
    const connue = eres.get(this.cle);
    if (connue?.ere === 'ancienne') this.#etat = { ere: 'ancienne', session: null, deMemoire: true, version: null, cause: null };
    else if (connue && versions.includes(connue.version)) this.#etat = { ere: 'moderne', version: connue.version, etablie: true };
    else this.#etat = { ere: 'inconnue' };
  }

  get ere(): Etat['ere'] { return this.#etat.ere; }

  async #poster(corps: unknown, entetes: Record<string, string>): Promise<{ statut: number; texte: string; entetes: Headers }> {
    const r = await appeler(this.#f, this.#u, { methode: 'POST', texte: true, entetes, corps, statutsLus: STATUTS_LUS });
    return { statut: r.statut, texte: r.donnees as string, entetes: r.entetes };
  }

  /** Requête de l'ère moderne : tout ce qu'il faut pour la traiter est dedans, et les en-têtes recopient le corps. */
  async #moderne(version: string, methode: string, params: Record<string, unknown>, entetesParam: Record<string, string>): Promise<Issue> {
    const id = ++this.#id;
    const meta = { ...(estObjet(params._meta) ? params._meta : {}), [META_VERSION]: version, [META_CLIENT]: CLIENT, [META_CAPACITES]: {} };
    const source = sourceNom(methode);
    const nom = source ? params[source] : undefined;
    const entetes = {
      ...this.#base, ...entetesParam, 'mcp-protocol-version': version, 'mcp-method': methode,
      ...(typeof nom === 'string' ? { 'mcp-name': encoderValeurEntete(nom) } : {}),
    };
    const r = await this.#poster({ jsonrpc: '2.0', id, method: methode, params: { ...params, _meta: meta } }, entetes);
    const reponse = lire(r.texte, id, r.statut);
    if (reponse?.error) return { type: erreurModerne(r.statut, reponse.error) ? 'moderne' : 'erreur', erreur: reponse.error, statut: r.statut };
    if (r.statut >= 400) return { type: 'ancienne', statut: r.statut };
    if (!reponse?.result) throw new ErreurSortante('Réponse MCP illisible.');
    return { type: 'resultat', resultat: reponse.result };
  }

  /** `server/discover` : un serveur moderne y répond toujours (résultat, ou erreur de l'ère moderne). */
  async #sonder(version: string): Promise<boolean> {
    const issue = await this.#moderne(version, 'server/discover', {}, {}).catch(() => null);
    return issue !== null && (issue.type === 'moderne' || (issue.type === 'resultat' && Array.isArray(issue.resultat.supportedVersions)));
  }

  #etablir(version: string): void {
    this.#etat = { ere: 'moderne', version, etablie: true };
    retenir(eres, this.cle, { ere: 'moderne', version });
  }

  /** Poignée de main de l'ère ancienne : version négociée, session éventuelle, puis `notifications/initialized`. */
  async #ouvrir(demandee: string | null): Promise<Session> {
    let version = demandee ?? VERSIONS_ANCIENNES[0] ?? '';
    for (let essai = 0; ; essai++) {
      const id = ++this.#id;
      const r = await this.#poster({ jsonrpc: '2.0', id, method: 'initialize', params: { protocolVersion: version, capabilities: {}, clientInfo: CLIENT } }, this.#base);
      const reponse = lire(r.texte, id, r.statut);
      if (reponse?.error || r.statut >= 400) {
        // version refusée par une erreur qui en nomme d'autres : un second essai avec la plus récente en commun
        const servies = versionsServies(reponse?.error);
        const autre = essai === 0 ? VERSIONS_ANCIENNES.find((v) => v !== version && servies.includes(v)) : undefined;
        if (autre) { version = autre; continue; }
        throw reponse?.error ? new ErreurMcp(reponse.error, r.statut >= 400 ? r.statut : null) : refusHttp(r.statut);
      }
      if (!reponse?.result) throw new ErreurSortante('Réponse MCP illisible.');
      const negociee = reponse.result.protocolVersion;
      if (typeof negociee !== 'string' || !VERSIONS_ANCIENNES.includes(negociee)) throw new ErreurSortante(`Ce serveur MCP propose une version que Living Business ne parle pas (${uneLigne(String(negociee))}).`);
      const session = r.entetes.get('mcp-session-id');
      const entetes = { ...this.#base, ...(session ? { 'mcp-session-id': session } : {}), 'mcp-protocol-version': negociee };
      await this.#poster({ jsonrpc: '2.0', method: 'notifications/initialized' }, entetes).catch(() => undefined);
      return { entetes, id: session };
    }
  }

  async #ancienne(s: Session, methode: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = ++this.#id;
    const r = await this.#poster({ jsonrpc: '2.0', id, method: methode, params }, s.entetes);
    const reponse = lire(r.texte, id, r.statut);
    if (reponse?.error) throw new ErreurMcp(reponse.error, r.statut >= 400 ? r.statut : null);
    if (r.statut >= 400) throw refusHttp(r.statut);
    if (!reponse?.result) throw new ErreurSortante('Réponse MCP illisible.');
    return verifier(reponse.result);
  }

  /** Envoie une requête et renvoie son résultat, en établissant l'ère du serveur au passage. */
  async envoyer(methode: string, params: Record<string, unknown> = {}, entetesParam: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const r = await this.#envoyer(methode, params, entetesParam, false);
    if (r === null) throw new ErreurSortante('Réponse MCP illisible.');
    return r;
  }

  /** Comme `envoyer`, pour une requête utile dans l'ère moderne seulement : null si le serveur se révèle ancien. */
  envoyerSiModerne(methode: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> {
    return this.#envoyer(methode, params, {}, true);
  }

  async #envoyer(methode: string, params: Record<string, unknown>, entetesParam: Record<string, string>, moderneSeulement: boolean): Promise<Record<string, unknown> | null> {
    const essayees = new Set<string>();
    // au plus quelques tours : version refusée, bascule vers l'ère ancienne, ère retenue qui ne tient plus
    for (let tour = 0; tour < 6; tour++) {
      const e = this.#etat;
      if (e.ere === 'ancienne') {
        if (e.session) return moderneSeulement ? null : this.#ancienne(e.session, methode, params);
        let session: Session;
        try {
          session = await this.#ouvrir(e.version);
        } catch (x) {
          // ère retenue lors d'un appel précédent, et `initialize` est maintenant refusé : le serveur a pu changer d'ère
          if (e.deMemoire && x instanceof ErreurSortante && x.statut !== null && STATUTS_LUS.includes(x.statut)) {
            eres.delete(this.cle);
            this.#etat = { ere: 'inconnue' };
            continue;
          }
          // `initialize` refusé lui aussi : l'erreur de la requête d'origine en dit plus ; sinon celle de la poignée de main
          throw e.cause && x instanceof ErreurSortante && x.statut !== null && STATUTS_LUS.includes(x.statut) ? e.cause : x;
        }
        this.#etat = { ...e, session, cause: null };
        retenir(eres, this.cle, { ere: 'ancienne' });
        continue;
      }
      const version = e.ere === 'moderne' ? e.version : this.#versions[0];
      if (version === undefined) { this.#etat = { ere: 'ancienne', session: null, deMemoire: false, version: null, cause: null }; continue; }
      const issue = await this.#moderne(version, methode, params, entetesParam);
      essayees.add(version);
      if (issue.type === 'resultat') {
        this.#etablir(version);
        return verifier(issue.resultat);
      }
      if (issue.type === 'moderne') {
        if (issue.erreur.code !== ERREUR_VERSION) {
          this.#etablir(version);
          throw new ErreurMcp(issue.erreur, issue.statut);
        }
        // version non servie : une autre que les deux parlent, moderne de préférence, sinon ancienne (poignée de main)
        const servies = versionsServies(issue.erreur);
        const autre = this.#versions.find((v) => servies.includes(v) && !essayees.has(v));
        if (autre !== undefined) { this.#etat = { ere: 'moderne', version: autre, etablie: true }; continue; }
        const ancienne = VERSIONS_ANCIENNES.find((v) => servies.includes(v));
        if (ancienne === undefined) throw new ErreurSortante(`Aucune version MCP commune avec ce serveur (il sert : ${uneLigne(servies.join(', ')) || 'non précisé'}).`, issue.statut);
        eres.delete(this.cle);
        this.#etat = { ere: 'ancienne', session: null, deMemoire: false, version: ancienne, cause: new ErreurMcp(issue.erreur, issue.statut) };
        continue;
      }
      if (issue.type === 'erreur') {
        // erreur ordinaire (outil inconnu, arguments refusés, « non initialisé »…) : elle ne dit pas l'ère. Sous un
        // statut de succès, un serveur déjà établi moderne le reste ; sinon `server/discover` tranche.
        const refus = issue.statut >= 400;
        const erreur = new ErreurMcp(issue.erreur, refus ? issue.statut : null);
        if ((!refus && e.ere === 'moderne' && e.etablie) || await this.#sonder(version)) {
          this.#etablir(version);
          throw erreur;
        }
        eres.delete(this.cle);
        this.#etat = { ere: 'ancienne', session: null, deMemoire: false, version: null, cause: erreur };
        continue;
      }
      // 400, 404 ou 405 sans erreur JSON-RPC : serveur ancien, la poignée de main le confirmera
      eres.delete(this.cle);
      this.#etat = { ere: 'ancienne', session: null, deMemoire: false, version: null, cause: null };
    }
    throw new ErreurSortante('Le serveur MCP ne répond dans aucune des versions du protocole.');
  }

  /** Rend au serveur la session ouverte pour cet appel (ère ancienne) ; il peut refuser (405), sans conséquence. */
  async fermer(): Promise<void> {
    const e = this.#etat;
    if (e.ere !== 'ancienne' || !e.session?.id) return;
    await appeler(this.#f, this.#u, { methode: 'DELETE', texte: true, entetes: e.session.entetes, delaiMs: 5000 }).catch(() => undefined);
  }
}

// ---------------------------------------------------------------- outils : liste suivie, en-têtes Mcp-Param-*

/**
 * `tools/list` de page en page (`nextCursor`), dans les limites PAGES_MAX et OUTILS_MAX.
 * `pourEntetes` : la liste ne sert qu'aux en-têtes `Mcp-Param-*` ; elle n'est pas demandée à un serveur qui se révèle ancien.
 */
async function listerOutils(l: Liaison, pourEntetes = false): Promise<{ outils: Record<string, unknown>[]; ttlMs: number }> {
  const outils: Record<string, unknown>[] = [];
  const curseurs = new Set<string>();
  let curseur: string | undefined;
  let ttlMs = Number.POSITIVE_INFINITY;
  for (let page = 0; page < PAGES_MAX; page++) {
    const params = curseur === undefined ? {} : { cursor: curseur };
    const r = pourEntetes ? await l.envoyerSiModerne('tools/list', params) : await l.envoyer('tools/list', params);
    if (r === null) break;
    if (Array.isArray(r.tools)) for (const o of r.tools) if (estObjet(o)) outils.push(o);
    ttlMs = Math.min(ttlMs, typeof r.ttlMs === 'number' && r.ttlMs > 0 ? r.ttlMs : 0);
    const suivant = r.nextCursor;
    // la fin, c'est l'absence de curseur : une chaîne vide en est un ; un curseur déjà vu arrête la boucle
    if (typeof suivant !== 'string' || curseurs.has(suivant) || outils.length >= OUTILS_MAX) break;
    curseurs.add(suivant);
    curseur = suivant;
  }
  return { outils: outils.slice(0, OUTILS_MAX), ttlMs: Number.isFinite(ttlMs) ? ttlMs : 0 };
}

/**
 * Liste des outils, sans ceux dont une annotation `x-mcp-header` est invalide (ère moderne : la spécification impose
 * de les écarter, avec un avertissement). Les annotations lues sont retenues pour les appels suivants.
 */
async function outilsVerifies(l: Liaison, journal: (message: string) => void, pourEntetes = false): Promise<{ outils: Record<string, unknown>[]; lectures: Map<string, LectureAnnotations> }> {
  const { outils, ttlMs } = await listerOutils(l, pourEntetes);
  const lectures = new Map<string, LectureAnnotations>();
  if (l.ere !== 'moderne') return { outils, lectures };
  const gardes: Record<string, unknown>[] = [];
  for (const o of outils) {
    const nom = typeof o.name === 'string' ? o.name : '';
    const lecture = annotationsEntetes(o.inputSchema);
    if (nom) lectures.set(nom, lecture);
    if (lecture.valide) gardes.push(o);
    else journal(`[mcp] outil « ${uneLigne(nom).slice(0, 80)} » écarté : ${lecture.raison}`);
  }
  retenir(definitions, l.cleOutils, { lectures, expire: Date.now() + Math.min(Math.max(ttlMs, FRAICHEUR_MIN_MS), FRAICHEUR_MAX_MS) });
  return { outils: gardes, lectures };
}

/** `tools/call` : dans l'ère moderne, les paramètres annotés `x-mcp-header` sont recopiés en en-têtes `Mcp-Param-*`. */
async function appelerOutil(l: Liaison, params: Record<string, unknown>, journal: (message: string) => void): Promise<Record<string, unknown>> {
  const nom = typeof params.name === 'string' ? params.name : '';
  const entetes = async (relire: boolean): Promise<Record<string, string>> => {
    if (l.ere === 'ancienne') return {};
    const memoire = definitions.get(l.cleOutils);
    let lectures = memoire?.lectures;
    if (relire || !memoire || memoire.expire <= Date.now()) {
      try {
        lectures = (await outilsVerifies(l, journal, true)).lectures;
      } catch (e) {
        // liste refusée par le serveur : l'appel part sans en-tête de paramètre, le serveur dira s'il en manque
        if (!(e instanceof ErreurMcp)) throw e;
        lectures = undefined;
      }
    }
    const lecture = l.ere === 'moderne' ? lectures?.get(nom) : undefined;
    if (!lecture) return {};
    if (!lecture.valide) throw new ErreurSortante(`L’outil MCP « ${uneLigne(nom).slice(0, 80)} » est écarté : ${lecture.raison}.`);
    try {
      return entetesParametres(lecture.annotations, params.arguments);
    } catch (e) {
      throw e instanceof ErreurEntete ? new ErreurSortante(e.message) : e;
    }
  };
  try {
    return await l.envoyer('tools/call', params, await entetes(false));
  } catch (e) {
    // en-têtes refusés : le schéma de l'outil a pu changer ; la liste est relue et l'appel refait une fois
    if (!(e instanceof ErreurMcp) || e.code !== ERREUR_ENTETES) throw e;
    return l.envoyer('tools/call', params, await entetes(true));
  }
}

/**
 * Une requête vers un serveur MCP distant, quelle que soit son ère.
 * `tools/list` (sans curseur) renvoie tous les outils, pages suivies ; `tools/call` porte les en-têtes `Mcp-Param-*`.
 */
export async function appelMcp(cfg: Readonly<Record<string, string>>, secret: string | null, f: Recuperateur, methode: string, params: unknown, options: OptionsMcp = {}): Promise<Record<string, unknown>> {
  const u = await verifierUrl(cfg.url);
  const journal = options.journal ?? ((message: string) => console.warn(message));
  const l = new Liaison(u, secret, f, options.versions ?? VERSIONS_MODERNES);
  const p = estObjet(params) ? params : {};
  try {
    if (methode === 'tools/list' && p.cursor === undefined) return { tools: (await outilsVerifies(l, journal)).outils };
    if (methode === 'tools/call') return await appelerOutil(l, p, journal);
    return await l.envoyer(methode, p);
  } finally {
    await l.fermer();
  }
}
