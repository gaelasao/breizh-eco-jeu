/**
 * Cœur du pont MCP « stdio » (lancé par pont-stdio.ts) : chaque message JSON-RPC lu sur l'entrée standard part vers
 * le point d'entrée HTTP de Living Business, et la réponse revient sur la sortie standard.
 * - Chaque requête reçoit exactement une réponse JSON-RPC, avec son identifiant : celle du serveur, ou une erreur
 *   fabriquée ici quand le serveur répond autre chose (clé refusée, débit dépassé, page d'un proxy) ou ne répond pas.
 * - Rien d'autre que des messages JSON-RPC sur la sortie standard ; les diagnostics vont sur la sortie d'erreur.
 * - L'assistant parle l'ère qu'il veut. Moderne (2026-07-28, version dans `_meta`) : le pont ajoute les en-têtes que
 *   le transport HTTP exige (MCP-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Param-*). Ancienne (`initialize`) : il
 *   reporte la version négociée, et la session s'il y en a une, sur les requêtes suivantes.
 * - `notifications/cancelled` : en HTTP moderne, annuler c'est fermer la requête ; le pont l'abandonne et n'y répond pas.
 */
import {
  annotationsEntetes, encoderValeurEntete, entetesParametres, ERREUR_INTERNE, ERREUR_PARAMETRES, ERREUR_REQUETE, ErreurEntete, estObjet, estReponseRpc,
  messagesDe, META_VERSION, sourceNom, type LectureAnnotations, type ReponseRpc,
} from '../passerelle/mcp-protocole.ts';

export interface OptionsPont {
  /** Point d'entrée MCP de Living Business (…/mcp). */
  url: string;
  /** Clé d'API (lb_…) : jamais écrite, ni sur la sortie standard ni dans les diagnostics. */
  cle: string;
  /** Écrit un message JSON-RPC (une ligne) sur la sortie standard. */
  ecrire: (ligne: string) => void;
  /** Écrit un diagnostic sur la sortie d'erreur. */
  journal: (texte: string) => void;
  f?: typeof fetch;
  delaiMs?: number;
}

type Id = string | number;
interface Requete { id: Id; method: string; params: Record<string, unknown>; moderne: boolean }
/** Requête en attente de sa réponse ; `groupe` : celles parties dans le même envoi HTTP (un lot). */
interface Suivi { abandon: AbortController; moderne: boolean; annulee: boolean; groupe: Suivi[] }

const ENTETE_SUR = /^[\x21-\x7e]+$/;
const uneLigne = (t: string): string => t.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
const estId = (x: unknown): x is Id => typeof x === 'string' || typeof x === 'number';

/** Ce que le serveur a dit sans le dire en JSON-RPC : `{ erreur, message }` de l'API, ou rien de lisible. */
function refusHttp(statut: number, texte: string): { message: string; data: Record<string, unknown> } {
  let code: string | null = null;
  let detail = '';
  try {
    const o: unknown = JSON.parse(texte);
    if (estObjet(o)) {
      if (typeof o.erreur === 'string') code = uneLigne(o.erreur).slice(0, 60);
      if (typeof o.message === 'string') detail = uneLigne(o.message);
    }
  } catch { /* corps sans JSON (page d'un proxy, réponse vide) */ }
  const quoi = statut === 401 ? 'Clé d’API refusée par Living Business : vérifiez LB_CLE, ou créez une clé dans Réglages → Clés d’API'
    : statut === 403 ? 'Accès refusé par Living Business'
    : statut === 429 ? 'Trop de requêtes pour cette clé d’API : réessayez dans quelques minutes'
    : statut >= 200 && statut < 300 ? 'Réponse de Living Business illisible'
    : 'Living Business a refusé la requête';
  return { message: `${quoi} (HTTP ${statut}${code ? `, ${code}` : ''}).${detail ? ` ${detail}` : ''}`, data: { http: statut, ...(code ? { erreur: code } : {}) } };
}

export function creerPont(o: OptionsPont): { ligne(texte: string): Promise<void> } {
  const f = o.f ?? fetch;
  const delaiMs = o.delaiMs ?? 60_000;
  const enCours = new Map<Id, Suivi>();
  /** Ère ancienne : version négociée par `initialize` et session éventuelle, reportées sur les requêtes suivantes. */
  const ancienne: { vue: boolean; version: string | null; session: string | null } = { vue: false, version: null, session: null };
  /** Ère moderne : annotations `x-mcp-header` des outils, lues au passage de `tools/list`. */
  const outils = new Map<string, LectureAnnotations>();

  const repondre = (m: Record<string, unknown>) => o.ecrire(JSON.stringify(m));
  const erreur = (id: Id, code: number, message: string, data?: unknown) => repondre({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } });

  /** En-têtes d'une requête : ceux que l'ère moderne exige, ou la version et la session de l'ère ancienne. */
  function entetes(r: Requete | null): Record<string, string> {
    const e: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${o.cle}` };
    if (!r?.moderne) {
      if (r?.method !== 'initialize') {
        if (ancienne.version) e['mcp-protocol-version'] = ancienne.version;
        if (ancienne.session) e['mcp-session-id'] = ancienne.session;
      }
      return e;
    }
    e['mcp-protocol-version'] = String((r.params._meta as Record<string, unknown>)[META_VERSION]);
    e['mcp-method'] = r.method;
    const source = sourceNom(r.method);
    const nom = source ? r.params[source] : undefined;
    if (typeof nom === 'string') e['mcp-name'] = encoderValeurEntete(nom);
    const lecture = r.method === 'tools/call' && typeof nom === 'string' ? outils.get(nom) : undefined;
    if (lecture && !lecture.valide) throw new ErreurEntete(`Outil « ${uneLigne(String(nom)).slice(0, 80)} » écarté : ${lecture.raison}.`);
    if (lecture) Object.assign(e, entetesParametres(lecture.annotations, r.params.arguments));
    return e;
  }

  /** Résultat à remettre à l'assistant, après ce que le pont doit en retenir ou en retirer. */
  function resultat(r: Requete, reponse: ReponseRpc, recues: Headers): Record<string, unknown> {
    const res = reponse.result;
    if (res && r.method === 'initialize' && !r.moderne) {
      ancienne.vue = true;
      ancienne.version = typeof res.protocolVersion === 'string' && ENTETE_SUR.test(res.protocolVersion) ? res.protocolVersion : null;
      ancienne.session = recues.get('mcp-session-id');
    }
    if (res && r.moderne && r.method === 'tools/list' && Array.isArray(res.tools)) {
      // un outil dont une annotation x-mcp-header est invalide est retiré de la liste (exigence du transport HTTP)
      if (r.params.cursor === undefined) outils.clear();
      const gardes = res.tools.filter((t) => {
        if (!estObjet(t) || typeof t.name !== 'string') return true;
        const lecture = annotationsEntetes(t.inputSchema);
        outils.set(t.name, lecture);
        if (!lecture.valide) o.journal(`Outil « ${uneLigne(t.name).slice(0, 80)} » écarté : ${lecture.raison}.`);
        return lecture.valide;
      });
      return { ...reponse, id: r.id, result: { ...res, tools: gardes } };
    }
    return { ...reponse, id: r.id };
  }

  /** Envoie une ligne (un message ou un lot) et répond une fois à chacune de ses requêtes. */
  async function relayer(corps: string, requetes: Requete[]): Promise<void> {
    const seule = requetes.length === 1 ? requetes[0] as Requete : null;
    const abandon = new AbortController();
    const groupe: Suivi[] = [];
    const suivis = new Map<Requete, Suivi>();
    for (const r of requetes) {
      const suivi: Suivi = { abandon, moderne: r.moderne, annulee: false, groupe };
      groupe.push(suivi);
      suivis.set(r, suivi);
      enCours.set(r.id, suivi);
    }
    // une requête annulée par l'assistant ne reçoit plus de réponse
    const attendues = () => requetes.filter((r) => !suivis.get(r)?.annulee);
    try {
      let e: Record<string, string>;
      try {
        e = entetes(seule);
      } catch (x) {
        if (!(x instanceof ErreurEntete) || !seule) throw x;
        erreur(seule.id, ERREUR_PARAMETRES, x.message);
        return;
      }
      const r = await f(o.url, { method: 'POST', headers: e, body: corps, signal: AbortSignal.any([abandon.signal, AbortSignal.timeout(delaiMs)]) });
      const texte = await r.text();
      const messages = messagesDe(texte).flatMap((m) => (Array.isArray(m) ? m : [m]));
      // notifications jointes à la réponse (flux SSE) : remises telles quelles ; une requête du serveur n'a pas de voie de retour
      for (const m of messages) {
        if (!estObjet(m) || typeof m.method !== 'string' || !attendues().length) continue;
        if (m.id === undefined) repondre(m);
        else o.journal(`Requête du serveur ignorée (${uneLigne(m.method).slice(0, 80)}) : le pont ne relaie que les réponses.`);
      }
      const reponses = messages.filter(estReponseRpc);
      // une erreur sans identifiant (refus de toute la requête HTTP) vaut pour chaque requête restée sans réponse
      const commune = reponses.find((m) => m.error !== undefined && !estId(m.id));
      for (const q of attendues()) {
        const reponse = reponses.find((m) => m.id === q.id) ?? commune;
        if (reponse) { repondre(resultat(q, reponse, r.headers)); continue; }
        const refus = refusHttp(r.status, texte);
        o.journal(refus.message);
        erreur(q.id, ERREUR_INTERNE, refus.message, refus.data);
      }
    } catch (x) {
      const delai = x instanceof Error && x.name === 'TimeoutError';
      const cause = x instanceof Error && x.cause instanceof Error ? x.cause.message : x instanceof Error ? x.message : String(x);
      const message = delai ? `Living Business ne répond pas (${o.url}) : délai dépassé.` : `Living Business injoignable (${o.url}) : ${uneLigne(cause)}`;
      if (attendues().length) o.journal(message);
      for (const q of attendues()) erreur(q.id, ERREUR_INTERNE, message);
    } finally {
      for (const r of requetes) if (enCours.get(r.id) === suivis.get(r)) enCours.delete(r.id);
    }
  }

  /** Notification : jamais de réponse sur la sortie standard, même si l'envoi échoue. */
  async function notifier(corps: string, m: Record<string, unknown>): Promise<void> {
    if (m.method === 'notifications/cancelled') {
      const cible = estObjet(m.params) && estId(m.params.requestId) ? enCours.get(m.params.requestId) : undefined;
      if (cible) {
        cible.annulee = true;
        if (cible.groupe.every((x) => x.annulee)) cible.abandon.abort();
      }
      // ère moderne : fermer la requête HTTP est l'annulation ; rien à envoyer
      if (cible ? cible.moderne : !ancienne.vue) return;
    }
    try {
      const r = await f(o.url, { method: 'POST', headers: entetes(null), body: corps, signal: AbortSignal.timeout(delaiMs) });
      await r.text();
      if (r.status >= 400) o.journal(`Notification refusée par Living Business (HTTP ${r.status}).`);
    } catch (x) {
      o.journal(`Notification non remise : ${uneLigne(x instanceof Error ? x.message : String(x))}`);
    }
  }

  /** Requête (méthode et identifiant), ou null ; moderne si `_meta` porte une version de protocole. */
  function requete(m: unknown): Requete | null {
    if (!estObjet(m) || typeof m.method !== 'string' || !estId(m.id)) return null;
    const params = estObjet(m.params) ? m.params : {};
    const version = estObjet(params._meta) ? params._meta[META_VERSION] : undefined;
    return { id: m.id, method: m.method, params, moderne: typeof version === 'string' };
  }

  return {
    async ligne(texte: string): Promise<void> {
      const t = texte.trim();
      if (!t) return;
      let m: unknown;
      try {
        m = JSON.parse(t);
      } catch {
        o.journal('Ligne ignorée : ce n’est pas du JSON.');
        return;
      }
      if (Array.isArray(m)) {
        // lot JSON-RPC (permis par 2025-03-26) : envoyé tel quel, une réponse par requête du lot
        const requetes = m.map(requete).filter((r): r is Requete => r !== null);
        if (requetes.length) await relayer(t, requetes);
        else await notifier(t, {});
        return;
      }
      const r = requete(m);
      if (!r) {
        if (estObjet(m) && typeof m.method === 'string' && m.id === undefined) await notifier(t, m);
        else o.journal('Message ignoré : ni requête ni notification JSON-RPC.');
        return;
      }
      if (r.moderne && !(ENTETE_SUR.test(r.method) && ENTETE_SUR.test(String((r.params._meta as Record<string, unknown>)[META_VERSION])))) {
        erreur(r.id, ERREUR_REQUETE, 'Méthode ou version de protocole illisible.');
        return;
      }
      await relayer(t, [r]);
    },
  };
}
