/**
 * MCP, deux ères du protocole (2026-07-28 « moderne », sans poignée de main ; 2025-11-25 et avant, « ancienne »).
 * - Le serveur /mcp sert les deux : client ancien (initialize), client moderne (_meta et en-têtes), en-têtes
 *   contradictoires, version non servie, méthode inconnue, server/discover, sécurité inchangée.
 * - Le client des connecteurs parle aux deux : serveur moderne seul, ancien seul, serveur des deux ères (le nôtre),
 *   version renégociée, pages de tools/list, en-têtes Mcp-Param-* (x-mcp-header).
 * Aucun appel vers Internet : serveur local sur 127.0.0.1 et serveurs distants simulés.
 */
import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { appelMcp, ErreurMcp, oublierServeursMcp } from './mcp-client.ts';
import { annotationsEntetes, decoderValeurEntete, encoderValeurEntete, entetesParametres, META_CAPACITES, META_CLIENT, META_SERVEUR, META_VERSION, messagesDe } from './mcp-protocole.ts';
import { ErreurSortante, recuperateurProtege } from './sortant.ts';
import { ADAPTATEURS } from './sources.ts';

const MODERNE = '2026-07-28';
const base64 = (t: string) => Buffer.from(t, 'utf8').toString('base64');

// ================================================================ serveur /mcp

let serveur: Server;
let base: string;
let app: Application;
let jeton: string;
const localAvant = process.env.LB_AUTORISER_LOCAL;

before(async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  app = await Application.creer({ exemple: 'pme' });
  serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const s = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId: 'dirigeante' }) });
  const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] as string;
  const k = await fetch(`${base}/api/v1/cles`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ nom: 'Assistant', profilId: 'dirigeante' }) });
  jeton = ((await k.json()) as { jeton: string }).jeton;
});
after(async () => {
  if (localAvant === undefined) delete process.env.LB_AUTORISER_LOCAL; else process.env.LB_AUTORISER_LOCAL = localAvant;
  await new Promise<void>((ok) => serveur.close(() => ok()));
});
beforeEach(() => oublierServeursMcp());

interface Rep { statut: number; json: any }
const poster = async (corps: unknown, entetes: Record<string, string> = {}, cle: string | null = jeton): Promise<Rep> => {
  const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...(cle ? { authorization: `Bearer ${cle}` } : {}), ...entetes }, body: JSON.stringify(corps) });
  return { statut: r.status, json: await r.json().catch(() => null) };
};
const meta = (version = MODERNE) => ({ [META_VERSION]: version, [META_CLIENT]: { name: 'essai', version: '1' }, [META_CAPACITES]: {} });
/** Requête de l'ère moderne, bien formée sauf ce que le test change (`entetes` : undefined retire un en-tête). */
const moderne = (methode: string, params: Record<string, unknown> = {}, entetes: Record<string, string | undefined> = {}, version = MODERNE): Promise<Rep> => {
  const nom = typeof params.name === 'string' ? { 'mcp-name': params.name } : {};
  const e: Record<string, string | undefined> = { 'mcp-protocol-version': version, 'mcp-method': methode, ...nom, ...entetes };
  return poster({ jsonrpc: '2.0', id: 7, method: methode, params: { ...params, _meta: meta(version) } }, Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)) as Record<string, string>);
};

test('serveur, client ancien : initialize négocie 2025-11-25, 2025-06-18 et 2025-03-26 ; la suite marche avec la version négociée', async () => {
  for (const v of ['2025-11-25', '2025-06-18', '2025-03-26']) {
    const init = await poster({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 'ancien', version: '1' } } });
    assert.equal(init.statut, 200);
    assert.equal(init.json.result.protocolVersion, v);
    assert.equal(init.json.result.serverInfo.name, 'living-business');
    assert.equal('resultType' in init.json.result, false, 'résultat de l’ère ancienne inchangé');
    const outils = await poster({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-protocol-version': v });
    assert.equal(outils.statut, 200);
    assert.ok(outils.json.result.tools.some((t: any) => t.name === 'resume_du_jour'));
    assert.equal('resultType' in outils.json.result, false);
  }
  // version inconnue du serveur, ou version moderne demandée par poignée de main : la plus récente des anciennes
  for (const v of ['2031-01-01', MODERNE]) {
    const init = await poster({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: v, capabilities: {}, clientInfo: { name: 'ancien', version: '1' } } });
    assert.equal(init.json.result.protocolVersion, '2025-11-25');
  }
  assert.equal((await poster({ jsonrpc: '2.0', method: 'notifications/initialized' })).statut, 202);
  assert.deepEqual((await poster({ jsonrpc: '2.0', id: 3, method: 'ping' })).json.result, {});
  const appel = await poster({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'resume_du_jour', arguments: {} } }, { 'mcp-protocol-version': '2025-11-25' });
  assert.equal(appel.json.result.isError, false);
  // sans en-tête de version (clients d'avant 2025-06-18) : toujours servi ; lot JSON-RPC (2025-03-26) aussi
  assert.equal((await poster({ jsonrpc: '2.0', id: 5, method: 'tools/list' })).statut, 200);
  const lot = await poster([{ jsonrpc: '2.0', id: 6, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 7, method: 'tools/list' }], { 'mcp-protocol-version': '2025-03-26' });
  assert.deepEqual(lot.json.map((r: any) => r.id), [6, 7]);
});

test('serveur : un en-tête MCP-Protocol-Version invalide ou non servi n’est plus traité comme valable (400, −32022)', async () => {
  for (const v of ['1999-01-01', 'n-importe-quoi', '2031-01-01']) {
    const r = await poster({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': v });
    assert.equal(r.statut, 400, v);
    assert.equal(r.json.error.code, -32022);
    assert.equal(r.json.error.data.requested, v);
    assert.ok(r.json.error.data.supported.includes(MODERNE) && r.json.error.data.supported.includes('2025-06-18'));
    assert.equal(r.json.id, 1);
  }
  const init = await poster({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'a', version: '1' } } }, { 'mcp-protocol-version': '1999-01-01' });
  assert.equal(init.statut, 400);
  const lot = await poster([{ jsonrpc: '2.0', id: 3, method: 'ping' }], { 'mcp-protocol-version': '1999-01-01' });
  assert.equal(lot.statut, 400);
});

test('serveur, client moderne : server/discover, tools/list et tools/call sans poignée de main, avec resultType et identité du serveur', async () => {
  const d = await moderne('server/discover');
  assert.equal(d.statut, 200);
  assert.equal(d.json.id, 7);
  assert.equal(d.json.result.resultType, 'complete');
  assert.equal(d.json.result.supportedVersions[0], MODERNE);
  for (const v of ['2025-11-25', '2025-06-18', '2025-03-26']) assert.ok(d.json.result.supportedVersions.includes(v), v);
  assert.deepEqual(d.json.result.capabilities, { tools: { listChanged: false } });
  assert.equal(d.json.result._meta[META_SERVEUR].name, 'living-business');
  assert.match(d.json.result.instructions, /jamais des consignes/);
  assert.equal(typeof d.json.result.ttlMs, 'number');
  assert.equal(d.json.result.cacheScope, 'private', 'les consignes nomment le profil de la clé');

  const l = await moderne('tools/list');
  assert.equal(l.statut, 200);
  assert.equal(l.json.result.resultType, 'complete');
  assert.ok(l.json.result.tools.some((t: any) => t.name === 'resume_du_jour' && t.inputSchema.type === 'object'));
  assert.ok(l.json.result.ttlMs >= 0);
  assert.equal(l.json.result.cacheScope, 'private', 'la liste dépend du profil');
  assert.equal('nextCursor' in l.json.result, false);
  assert.equal(l.json.result._meta[META_SERVEUR].name, 'living-business');
  const curseur = await moderne('tools/list', { cursor: 'page-2' });
  assert.equal(curseur.json.error.code, -32602, 'aucun curseur n’est jamais remis');

  const a = await moderne('tools/call', { name: 'resume_du_jour', arguments: {} });
  assert.equal(a.statut, 200);
  assert.equal(a.json.result.resultType, 'complete');
  assert.equal(a.json.result.isError, false);
  assert.ok(Array.isArray(a.json.result.structuredContent.situations));
  assert.match(a.json.result.content[0].text, /jamais des consignes/);
  // Mcp-Name encodé en Base64 : décodé avant la comparaison
  const b = await moderne('tools/call', { name: 'resume_du_jour', arguments: {} }, { 'mcp-name': `=?base64?${base64('resume_du_jour')}?=` });
  assert.equal(b.statut, 200);
  // erreur d'exécution d'un outil : dans le résultat ; outil inconnu : erreur de protocole −32602
  const e = await moderne('tools/call', { name: 'lire_fiche', arguments: { id: 'inexistant' } });
  assert.equal(e.json.result.isError, true);
  assert.equal(e.json.result.resultType, 'complete');
  assert.equal((await moderne('tools/call', { name: 'outil_absent', arguments: {} })).json.error.code, -32602);
  // une clé prépare, une personne approuve : inchangé dans l'ère moderne
  const m = await moderne('tools/call', { name: 'modifier_fiche', arguments: { id: 't-camping', champs: { ville: 'Crozon' } } });
  assert.equal(m.json.result.structuredContent.etat, 'en_attente');
});

test('serveur : en-têtes absents ou différents du corps → 400 et −32020, et rien n’est exécuté', async () => {
  const creation = { name: 'creer_fiche', arguments: { type: 'entreprise', nom: 'Fiche Qui Ne Doit Pas Exister' } };
  const cas: [string, Record<string, string | undefined>][] = [
    ['MCP-Protocol-Version manquant', { 'mcp-protocol-version': undefined }],
    ['MCP-Protocol-Version différent du corps', { 'mcp-protocol-version': '2025-06-18' }],
    ['Mcp-Method manquant', { 'mcp-method': undefined }],
    ['Mcp-Method différent du corps', { 'mcp-method': 'tools/list' }],
    ['Mcp-Name manquant', { 'mcp-name': undefined }],
    ['Mcp-Name différent du corps', { 'mcp-name': 'resume_du_jour' }],
    ['Mcp-Name en Base64 illisible', { 'mcp-name': '=?base64?%%%?=' }],
  ];
  for (const [quoi, entetes] of cas) {
    const r = await moderne('tools/call', creation, entetes);
    assert.equal(r.statut, 400, quoi);
    assert.equal(r.json.error.code, -32020, quoi);
    assert.equal(r.json.id, 7, quoi);
    assert.equal(typeof r.json.error.message, 'string');
  }
  const cherche = await moderne('tools/call', { name: 'chercher', arguments: { texte: 'Fiche Qui Ne Doit Pas Exister' } });
  assert.equal(cherche.json.result.structuredContent.total, 0, 'aucune requête refusée n’a créé la fiche');
});

test('serveur : version non servie → 400 et −32022 avec les versions servies ; _meta incomplet → 400 et −32602', async () => {
  for (const v of ['2099-01-01', '2025-06-18']) {
    const r = await moderne('tools/list', {}, {}, v);
    assert.equal(r.statut, 400, v);
    assert.equal(r.json.error.code, -32022);
    assert.equal(r.json.error.data.requested, v);
    assert.equal(r.json.error.data.supported[0], MODERNE);
    assert.equal(r.json.id, 7);
  }
  // capacités du client absentes de _meta
  const sansCapacites = await poster({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [META_VERSION]: MODERNE } } }, { 'mcp-protocol-version': MODERNE, 'mcp-method': 'tools/list' });
  assert.equal(sansCapacites.statut, 400);
  assert.equal(sansCapacites.json.error.code, -32602);
  // en-têtes modernes mais corps sans _meta : requête moderne mal formée, jamais servie « à l'ancienne »
  const sansMeta = await poster({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-protocol-version': MODERNE, 'mcp-method': 'tools/list' });
  assert.equal(sansMeta.statut, 400);
  assert.equal(sansMeta.json.error.code, -32602);
  const lot = await poster([{ jsonrpc: '2.0', id: 3, method: 'tools/list', params: { _meta: meta() } }], { 'mcp-protocol-version': MODERNE });
  assert.equal(lot.statut, 400, 'pas de lot dans l’ère moderne');
});

test('serveur : méthode inconnue d’une requête moderne → 404 et −32601 (initialize et ping compris)', async () => {
  for (const methode of ['ping', 'initialize', 'resources/list', 'subscriptions/listen', 'inventee/methode']) {
    const r = await moderne(methode);
    assert.equal(r.statut, 404, methode);
    assert.equal(r.json.error.code, -32601, methode);
    assert.equal(r.json.id, 7);
  }
  // ère ancienne : une méthode inconnue reste une erreur JSON-RPC sous 200
  const ancienne = await poster({ jsonrpc: '2.0', id: 1, method: 'inventee/methode' });
  assert.equal(ancienne.statut, 200);
  assert.equal(ancienne.json.error.code, -32601);
});

test('serveur : clé, origine et méthode HTTP contrôlées avant tout, dans les deux ères', async () => {
  const corps = { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: meta() } };
  const entetes = { 'mcp-protocol-version': MODERNE, 'mcp-method': 'server/discover' };
  assert.equal((await poster(corps, entetes, null)).statut, 401);
  const fausse = `lb_${'x'.repeat(43)}`;
  assert.equal((await poster(corps, entetes, fausse)).statut, 401);
  assert.equal((await poster(corps, { ...entetes, origin: 'https://ailleurs.example' })).statut, 403);
  const lecture = await fetch(`${base}/mcp`, { headers: { authorization: `Bearer ${jeton}` } });
  assert.equal(lecture.status, 405, 'pas de flux GET');
  assert.equal(lecture.headers.get('allow'), 'POST');
});

// ================================================================ outils du protocole

test('en-têtes miroirs : ASCII tel quel, Base64 pour le reste, décodage, valeurs illisibles', () => {
  assert.equal(encoderValeurEntete('us-west1'), 'us-west1');
  assert.equal(encoderValeurEntete('Hello, 世界'), `=?base64?${base64('Hello, 世界')}?=`);
  assert.equal(encoderValeurEntete(' bords '), `=?base64?${base64(' bords ')}?=`);
  assert.equal(encoderValeurEntete('ligne1\nligne2'), `=?base64?${base64('ligne1\nligne2')}?=`);
  assert.equal(encoderValeurEntete('=?base64?texte?='), `=?base64?${base64('=?base64?texte?=')}?=`, 'une valeur qui ressemble à l’encodage est encodée');
  assert.equal(encoderValeurEntete(''), '=?base64??=');
  for (const v of ['us-west1', 'Hello, 世界', ' bords ', 'ligne1\nligne2', '=?base64?texte?=', '', 'a b\tc']) assert.equal(decoderValeurEntete(encoderValeurEntete(v)), v);
  assert.equal(decoderValeurEntete('=?base64?***?='), null);
  assert.equal(decoderValeurEntete(`=?base64?${Buffer.from([0xff, 0xfe]).toString('base64')}?=`), null, 'UTF-8 invalide');
  assert.equal(decoderValeurEntete('café'), null, 'hors ASCII sans encodage');
});

test('x-mcp-header : contraintes de la spécification sur le schéma d’un outil', () => {
  const ok = annotationsEntetes({ type: 'object', properties: {
    region: { type: 'string', 'x-mcp-header': 'Region' },
    filtre: { type: 'object', properties: { pays: { type: ['string', 'null'], 'x-mcp-header': 'Pays' }, actif: { type: 'boolean', 'x-mcp-header': 'Actif' } } },
    limite: { type: 'integer', 'x-mcp-header': 'Limite' },
    requete: { type: 'string' },
  } });
  assert.ok(ok.valide);
  assert.deepEqual(ok.annotations.map((a) => `${a.chemin.join('.')}=${a.nom}`), ['region=Region', 'filtre.pays=Pays', 'filtre.actif=Actif', 'limite=Limite']);
  const invalides: [string, unknown][] = [
    ['vide', { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': '' } } }],
    ['espace', { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': 'Ma Region' } } }],
    ['saut de ligne', { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': 'A\r\nX-Autre: 1' } } }],
    ['pas une chaîne', { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': 3 } } }],
    ['doublon sans la casse', { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': 'Region' }, b: { type: 'string', 'x-mcp-header': 'REGION' } } }],
    ['type number', { type: 'object', properties: { a: { type: 'number', 'x-mcp-header': 'A' } } }],
    ['type objet', { type: 'object', properties: { a: { type: 'object', 'x-mcp-header': 'A' } } }],
    ['sous items', { type: 'object', properties: { l: { type: 'array', items: { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': 'A' } } } } } }],
    ['sous anyOf', { type: 'object', anyOf: [{ properties: { a: { type: 'string', 'x-mcp-header': 'A' } } }] }],
    ['sous if/then', { type: 'object', if: {}, then: { properties: { a: { type: 'string', 'x-mcp-header': 'A' } } } }],
    ['sous $defs', { type: 'object', properties: { a: { $ref: '#/$defs/a' } }, $defs: { a: { type: 'string', 'x-mcp-header': 'A' } } }],
    ['à la racine', { type: 'string', 'x-mcp-header': 'A' }],
  ];
  for (const [quoi, schema] of invalides) assert.equal(annotationsEntetes(schema).valide, false, quoi);
  // une propriété NOMMÉE x-mcp-header n'est pas une annotation
  assert.ok(annotationsEntetes({ type: 'object', properties: { 'x-mcp-header': { type: 'object' } } }).valide);

  const e = entetesParametres(ok.annotations, { region: 'Bretagne ouest', filtre: { pays: null, actif: false }, limite: 42, requete: 'x' });
  assert.deepEqual(e, { 'Mcp-Param-Region': 'Bretagne ouest', 'Mcp-Param-Actif': 'false', 'Mcp-Param-Limite': '42' }, 'null et absent : pas d’en-tête');
  assert.throws(() => entetesParametres(ok.annotations, { limite: 1.5 }), /Mcp-Param-Limite/);
  assert.throws(() => entetesParametres(ok.annotations, { limite: 2 ** 60 }), /Mcp-Param-Limite/);
});

test('corps de réponse : JSON direct, ou flux SSE avec un message par événement', () => {
  assert.deepEqual(messagesDe('{"a":1}'), [{ a: 1 }]);
  assert.deepEqual(messagesDe(': amorce\r\n\r\nevent: message\r\ndata: {"a":\r\ndata: 1}\r\n\r\nevent: message\ndata: {"b":2}\n\n'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(messagesDe('<html>502</html>'), []);
});

// ================================================================ client des connecteurs

interface Appel { methode: string; entetes: Headers; corps: any }
const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json', ...entetes } });
const ok = (id: unknown, result: unknown) => json({ jsonrpc: '2.0', id, result });
const ko = (id: unknown, code: number, message: string, statut = 200, data?: unknown) => json({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }, statut);

function simuler(repondre: (a: Appel) => Response) {
  const appels: Appel[] = [];
  const f = (async (_url: URL | string, init?: RequestInit) => {
    const a: Appel = { methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: init?.body ? JSON.parse(String(init.body)) : null };
    appels.push(a);
    return repondre(a);
  }) as typeof fetch;
  /** Méthodes JSON-RPC reçues, dans l'ordre (« DELETE » pour une fin de session). */
  const methodes = () => appels.map((a) => (a.methode === 'POST' ? String(a.corps.method) : a.methode));
  return { f, appels, methodes };
}

interface OutilSimule { name: string; description?: string; inputSchema: Record<string, unknown> }
const OUTIL_CLIENTS: OutilSimule = { name: 'liste_clients', description: 'Clients', inputSchema: { type: 'object', properties: { limite: { type: 'integer' } } } };

/** Serveur de l'ère moderne seulement : refuse tout ce qui n'a pas ses en-têtes et son _meta, initialize compris. */
function serveurModerne(o: { versions?: string[]; pages?: OutilSimule[][] | (() => OutilSimule[][]); curseurs?: string[]; appeler?: (nom: string, args: any, a: Appel) => Response | unknown } = {}) {
  const versions = o.versions ?? [MODERNE];
  const lesPages = () => (typeof o.pages === 'function' ? o.pages() : o.pages ?? [[OUTIL_CLIENTS]]);
  const curseurs = o.curseurs ?? lesPages().slice(1).map((_, i) => `page-${i + 2}`);
  return simuler((a) => {
    if (a.methode !== 'POST') return new Response(null, { status: 405 });
    const m = a.corps;
    const v = m.params?._meta?.[META_VERSION];
    if (a.entetes.get('mcp-protocol-version') === null || a.entetes.get('mcp-method') === null) return ko(m.id, -32020, 'En-têtes requis manquants', 400);
    if (a.entetes.get('mcp-protocol-version') !== v || a.entetes.get('mcp-method') !== m.method) return ko(m.id, -32020, 'En-têtes différents du corps', 400);
    if (!versions.includes(v)) return ko(m.id, -32022, 'Unsupported protocol version', 400, { supported: versions, requested: v });
    if (m.method === 'server/discover') return ok(m.id, { resultType: 'complete', supportedVersions: versions, capabilities: { tools: {} }, ttlMs: 0, cacheScope: 'public' });
    if (m.method === 'tools/list') {
      const i = m.params.cursor === undefined ? 0 : curseurs.indexOf(m.params.cursor) + 1;
      if (i < 0 || (m.params.cursor !== undefined && i === 0)) return ko(m.id, -32602, 'Curseur inconnu');
      return ok(m.id, { resultType: 'complete', tools: lesPages()[i] ?? [], ...(i < curseurs.length ? { nextCursor: curseurs[i] } : {}), ttlMs: 60_000, cacheScope: 'public' });
    }
    if (m.method === 'tools/call') {
      if (decoderValeurEntete(a.entetes.get('mcp-name') ?? '') !== m.params.name) return ko(m.id, -32020, 'Mcp-Name différent du corps', 400);
      const r = o.appeler ? o.appeler(m.params.name, m.params.arguments, a) : [{ id: 'c1', nom: 'Crêperie' }];
      return r instanceof Response ? r : ok(m.id, { resultType: 'complete', content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r, isError: false });
    }
    return ko(m.id, -32601, 'Method not found', 404);
  });
}

/** Serveur de l'ère ancienne seulement, à session : toute requête hors session est refusée (400), comme les serveurs d'avant 2026. */
function serveurAncien(o: { refus?: () => Response; version?: string; pages?: OutilSimule[][]; sse?: boolean } = {}) {
  const session = ['session', 'de', 'test'].join('-');
  const etat = { fermees: 0 };
  const pages = o.pages ?? [[OUTIL_CLIENTS]];
  const refus = o.refus ?? (() => json({ jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Bad Request: Server not initialized' } }, 400));
  const repondre = (id: unknown, result: unknown) => (o.sse
    ? new Response(`: amorce\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id, result })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    : ok(id, result));
  const s = simuler((a) => {
    if (a.methode === 'DELETE') { etat.fermees++; return new Response(null, { status: 200 }); }
    const m = a.corps;
    if (m.method === 'initialize') {
      const v = o.version ?? (['2025-11-25', '2025-06-18'].includes(m.params.protocolVersion) ? m.params.protocolVersion : '2025-06-18');
      return json({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: v, capabilities: { tools: {} }, serverInfo: { name: 'ancien', version: '1' } } }, 200, { 'mcp-session-id': session });
    }
    if (a.entetes.get('mcp-session-id') !== session) return refus();
    if (m.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (m.method === 'tools/list') {
      const i = m.params?.cursor === undefined ? 0 : Number(String(m.params.cursor).replace('p', ''));
      return repondre(m.id, { tools: pages[i] ?? [], ...(i + 1 < pages.length ? { nextCursor: `p${i + 1}` } : {}) });
    }
    if (m.method === 'tools/call') return repondre(m.id, { content: [{ type: 'text', text: JSON.stringify([{ id: 'c1', nom: 'Crêperie' }]) }] });
    return ko(m.id, -32601, 'Method not found');
  });
  return { ...s, etat, session };
}

const secret = ['jeton', 'du', 'serveur', 'distant'].join('-');
const cfg = (chemin: string) => ({ url: `http://localhost:9${chemin}`, outilLecture: 'liste_clients' });

test('client ↔ serveur moderne seul : aucune poignée de main, _meta et en-têtes exigés, ère retenue pour les appels suivants', async () => {
  const s = serveurModerne();
  const r = await appelMcp(cfg('/moderne'), secret, s.f, 'tools/call', { name: 'liste_clients', arguments: { limite: 5 } });
  assert.deepEqual(r.structuredContent, [{ id: 'c1', nom: 'Crêperie' }]);
  assert.deepEqual(s.methodes(), ['tools/list', 'tools/call'], 'la liste donne les annotations d’en-têtes ; pas d’initialize');
  for (const a of s.appels) {
    assert.equal(a.entetes.get('mcp-protocol-version'), MODERNE);
    assert.equal(a.entetes.get('mcp-method'), a.corps.method);
    assert.equal(a.entetes.get('authorization'), `Bearer ${secret}`);
    assert.match(a.entetes.get('accept') ?? '', /application\/json.*text\/event-stream/);
    assert.equal(a.corps.params._meta[META_VERSION], MODERNE);
    assert.equal(a.corps.params._meta[META_CLIENT].name, 'living-business');
    assert.deepEqual(a.corps.params._meta[META_CAPACITES], {});
    assert.equal(a.entetes.get('mcp-session-id'), null);
  }
  assert.equal(s.appels[1]?.entetes.get('mcp-name'), 'liste_clients');
  await appelMcp(cfg('/moderne'), secret, s.f, 'tools/call', { name: 'liste_clients', arguments: {} });
  assert.deepEqual(s.methodes().slice(2), ['tools/call'], 'définitions et ère en mémoire : une seule requête');
  // l'adaptateur des connecteurs passe par le même client
  const lignes = await ADAPTATEURS.mcp.lire(cfg('/moderne'), secret, s.f);
  assert.deepEqual(lignes.map((l) => l.externeId), ['c1']);
});

test('client ↔ serveur ancien seul : la requête moderne est refusée (400), repli sur initialize, puis l’ère ancienne est retenue', async () => {
  const s = serveurAncien();
  const r = await appelMcp(cfg('/ancien'), secret, s.f, 'tools/call', { name: 'liste_clients', arguments: {} });
  assert.match(String((r.content as any[])[0].text), /Crêperie/);
  // essai moderne, sonde (le refus est une erreur JSON-RPC ordinaire), poignée de main, puis la requête et la fin de session
  assert.deepEqual(s.methodes(), ['tools/list', 'server/discover', 'initialize', 'notifications/initialized', 'tools/call', 'DELETE']);
  assert.equal(s.appels[2]?.corps.params.protocolVersion, '2025-11-25', 'la plus récente des versions anciennes');
  assert.equal(s.appels[2]?.entetes.get('mcp-protocol-version'), null);
  assert.equal(s.appels[2]?.entetes.get('mcp-method'), null);
  for (const a of s.appels.slice(3)) {
    assert.equal(a.entetes.get('mcp-session-id'), s.session);
    assert.equal(a.entetes.get('mcp-protocol-version'), '2025-11-25', 'version négociée sur chaque requête suivante');
    if (a.corps) assert.equal(a.corps.params?._meta, undefined);
  }
  assert.equal(s.etat.fermees, 1);
  // appel suivant : directement l'ère ancienne
  const lignes = await ADAPTATEURS.mcp.lire(cfg('/ancien'), secret, s.f);
  assert.deepEqual(lignes.map((l) => l.externeId), ['c1']);
  assert.deepEqual(s.methodes().slice(6), ['initialize', 'notifications/initialized', 'tools/call', 'DELETE']);
});

test('client ↔ serveur ancien : refus sans corps JSON-RPC (repli direct), réponses en flux SSE, version 2025-06-18 négociée', async () => {
  const s = serveurAncien({ refus: () => new Response('Bad Request', { status: 400 }), version: '2025-06-18', sse: true, pages: [[OUTIL_CLIENTS], [{ ...OUTIL_CLIENTS, name: 'maj_client' }]] });
  const r = await appelMcp(cfg('/ancien-sse'), null, s.f, 'tools/list', {});
  assert.deepEqual((r.tools as any[]).map((t) => t.name), ['liste_clients', 'maj_client'], 'pages suivies dans la même session');
  assert.deepEqual(s.methodes(), ['tools/list', 'initialize', 'notifications/initialized', 'tools/list', 'tools/list', 'DELETE']);
  assert.equal(s.appels[3]?.entetes.get('mcp-protocol-version'), '2025-06-18');
  assert.equal(s.appels[0]?.entetes.get('authorization'), null, 'pas de jeton : pas d’en-tête Authorization');
  // 404 et 405 sans erreur de l'ère moderne : même repli
  for (const statut of [404, 405]) {
    oublierServeursMcp();
    const t = serveurAncien({ refus: () => new Response(null, { status: statut }) });
    await appelMcp(cfg(`/ancien-${statut}`), null, t.f, 'tools/list', {});
    assert.equal(t.methodes()[1], 'initialize', String(statut));
  }
  // une version que le client ne parle pas est refusée
  const inconnue = serveurAncien({ version: '2019-01-01' });
  await assert.rejects(appelMcp(cfg('/ancien-inconnu'), null, inconnue.f, 'tools/list', {}), /version que Living Business ne parle pas/);
});

test('client ↔ notre serveur (deux ères) : il reste moderne, sans poignée de main, par le récupérateur protégé', async () => {
  const appels: string[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    appels.push(String(JSON.parse(String(init?.body ?? '{}')).method ?? init?.method));
    return recuperateurProtege(url, init);
  }) as typeof fetch;
  const adresse = { url: `${base}/mcp` };
  const liste = await appelMcp(adresse, jeton, f, 'tools/list', {});
  assert.ok((liste.tools as any[]).some((t) => t.name === 'resume_du_jour'));
  const r = await appelMcp(adresse, jeton, f, 'tools/call', { name: 'resume_du_jour', arguments: {} });
  assert.equal(r.isError, false);
  assert.equal(r.resultType, 'complete');
  assert.deepEqual(appels, ['tools/list', 'tools/call']);
  await assert.rejects(appelMcp(adresse, jeton, f, 'tools/call', { name: 'outil_absent', arguments: {} }), (e) => e instanceof ErreurMcp && e.code === -32602);
  await assert.rejects(appelMcp(adresse, 'lb_mauvaise', f, 'tools/list', {}), (e) => e instanceof ErreurSortante && e.statut === 401, 'clé refusée : pas de repli sur une autre ère');
  assert.equal(appels.includes('initialize'), false);
});

test('client : −32022 → nouvel essai avec une version commune ; aucune en commun → erreur claire ; version ancienne proposée → poignée de main', async () => {
  const s = serveurModerne();
  const r = await appelMcp(cfg('/versions'), secret, s.f, 'tools/list', {}, { versions: ['2099-01-01', MODERNE] });
  assert.equal((r.tools as any[]).length, 1);
  assert.deepEqual(s.appels.map((a) => a.entetes.get('mcp-protocol-version')), ['2099-01-01', MODERNE]);
  assert.deepEqual(s.methodes(), ['tools/list', 'tools/list'], 'pas de repli sur initialize : le serveur est moderne');
  await appelMcp(cfg('/versions'), secret, s.f, 'tools/list', {}, { versions: ['2099-01-01', MODERNE] });
  assert.equal(s.appels[2]?.entetes.get('mcp-protocol-version'), MODERNE, 'la version commune est retenue');

  const futur = serveurModerne({ versions: ['2099-01-01'] });
  await assert.rejects(appelMcp(cfg('/futur'), secret, futur.f, 'tools/list', {}), /Aucune version MCP commune.*2099-01-01/);
  assert.deepEqual(futur.methodes(), ['tools/list']);

  // serveur qui refuse la version moderne par −32022 en nommant une version ancienne : poignée de main avec celle-ci
  const ancien = serveurAncien({ refus: () => ko(1, -32022, 'Unsupported protocol version', 400, { supported: ['2025-06-18'], requested: MODERNE }) });
  await appelMcp(cfg('/ancien-annonce'), secret, ancien.f, 'tools/list', {});
  assert.deepEqual(ancien.methodes().slice(0, 2), ['tools/list', 'initialize']);
  assert.equal(ancien.appels[1]?.corps.params.protocolVersion, '2025-06-18');
});

test('client : tools/list suit nextCursor (chaîne vide comprise), s’arrête sur un curseur répété et reste borné', async () => {
  const outil = (n: number): OutilSimule => ({ ...OUTIL_CLIENTS, name: `outil_${n}` });
  const s = serveurModerne({ pages: [[outil(1), outil(2)], [outil(3)], [outil(4)]], curseurs: ['', 'page-3'] });
  const r = await appelMcp(cfg('/pages'), secret, s.f, 'tools/list', {});
  assert.deepEqual((r.tools as any[]).map((t) => t.name), ['outil_1', 'outil_2', 'outil_3', 'outil_4']);
  assert.deepEqual(s.appels.map((a) => a.corps.params.cursor), [undefined, '', 'page-3']);
  // l'aide au réglage (liste des outils d'un serveur) passe par le même client
  const profil = app.monde.profil('dirigeante');
  assert.ok(profil);
  const hote = await Application.creer({ exemple: 'pme', fetch: s.f });
  const vus = await hote.synchro.outilsMcp(profil, { config: cfg('/pages') });
  assert.deepEqual(vus.map((x) => x.nom), ['outil_1', 'outil_2', 'outil_3', 'outil_4']);
  hote.arreter();

  // serveur qui renvoie toujours le même curseur, puis serveur aux curseurs sans fin : la boucle s'arrête
  const boucle = simuler((a) => ok(a.corps.id, { resultType: 'complete', tools: [outil(1)], nextCursor: 'encore', ttlMs: 0, cacheScope: 'public' }));
  assert.equal(((await appelMcp(cfg('/boucle'), secret, boucle.f, 'tools/list', {})).tools as any[]).length, 2);
  assert.equal(boucle.appels.length, 2);
  let n = 0;
  const infini = simuler((a) => ok(a.corps.id, { resultType: 'complete', tools: [outil(++n)], nextCursor: `c${n}`, ttlMs: 0, cacheScope: 'public' }));
  await appelMcp(cfg('/infini'), secret, infini.f, 'tools/list', {});
  assert.equal(infini.appels.length, 20, 'au plus 20 pages');
  // curseur donné par l'appelant : une seule page, telle quelle
  const page = await appelMcp(cfg('/pages'), secret, s.f, 'tools/list', { cursor: 'page-3' });
  assert.deepEqual((page.tools as any[]).map((t) => t.name), ['outil_4']);
});

test('client : x-mcp-header → en-têtes Mcp-Param-* ; outil à l’annotation invalide écarté de la liste et refusé à l’appel', async () => {
  const sql: OutilSimule = { name: 'executer_sql', inputSchema: { type: 'object', properties: {
    region: { type: 'string', 'x-mcp-header': 'Region' }, limite: { type: 'integer', 'x-mcp-header': 'Limite' }, brouillon: { type: 'boolean', 'x-mcp-header': 'Brouillon' },
    portee: { type: 'object', properties: { pays: { type: 'string', 'x-mcp-header': 'Pays' } } }, requete: { type: 'string' },
  } } };
  const fautif: OutilSimule = { name: 'outil_fautif', inputSchema: { type: 'object', properties: { lignes: { type: 'array', items: { type: 'object', properties: { a: { type: 'string', 'x-mcp-header': 'A' } } } } } } };
  const s = serveurModerne({ pages: [[sql, fautif, OUTIL_CLIENTS]], appeler: (_nom, args) => args });
  const avertissements: string[] = [];
  const journal = (m: string) => { avertissements.push(m); };

  const liste = await appelMcp(cfg('/entetes'), secret, s.f, 'tools/list', {}, { journal });
  assert.deepEqual((liste.tools as any[]).map((t) => t.name), ['executer_sql', 'liste_clients'], 'l’outil fautif est écarté, les autres restent');
  assert.equal(avertissements.length, 1);
  assert.match(avertissements[0] ?? '', /outil_fautif.*écarté.*x-mcp-header/);

  await appelMcp(cfg('/entetes'), secret, s.f, 'tools/call', { name: 'executer_sql', arguments: { region: 'us-west1', limite: 42, brouillon: true, portee: { pays: 'Pérou' }, requete: 'SELECT 1' } }, { journal });
  const a = s.appels.at(-1) as Appel;
  assert.equal(a.entetes.get('mcp-param-region'), 'us-west1');
  assert.equal(a.entetes.get('mcp-param-limite'), '42');
  assert.equal(a.entetes.get('mcp-param-brouillon'), 'true');
  assert.equal(a.entetes.get('mcp-param-pays'), `=?base64?${base64('Pérou')}?=`, 'hors ASCII : Base64');
  assert.equal(a.entetes.get('mcp-name'), 'executer_sql');
  // valeur nulle ou absente : pas d'en-tête
  await appelMcp(cfg('/entetes'), secret, s.f, 'tools/call', { name: 'executer_sql', arguments: { region: null, requete: 'SELECT 1' } }, { journal });
  const b = s.appels.at(-1) as Appel;
  for (const nom of ['mcp-param-region', 'mcp-param-limite', 'mcp-param-brouillon', 'mcp-param-pays']) assert.equal(b.entetes.get(nom), null, nom);

  const avant = s.appels.length;
  await assert.rejects(appelMcp(cfg('/entetes'), secret, s.f, 'tools/call', { name: 'outil_fautif', arguments: {} }, { journal }), /outil_fautif.*écarté/);
  assert.equal(s.appels.length, avant, 'l’outil écarté n’est jamais appelé');
  await assert.rejects(appelMcp(cfg('/entetes'), secret, s.f, 'tools/call', { name: 'executer_sql', arguments: { limite: 1.5 } }, { journal }), /Mcp-Param-Limite/);
});

test('client : −32020 sur un appel → la liste des outils est relue, puis l’appel refait avec les bons en-têtes', async () => {
  const sansAnnotation = { type: 'object', properties: { region: { type: 'string' } } };
  const annote = { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'Region' } } };
  let schema: Record<string, unknown> = sansAnnotation;
  // le serveur exige l'en-tête Mcp-Param-Region ; sa liste d'outils ne l'annonce qu'une fois le schéma changé
  const s = serveurModerne({
    pages: () => [[{ name: 'liste_clients', inputSchema: schema }]],
    appeler: (_nom, args, a) => (a.entetes.get('mcp-param-region') === args.region ? args : ko(a.corps.id, -32020, 'Mcp-Param-Region manquant', 400)),
  });
  const appel = () => appelMcp(cfg('/schema-change'), secret, s.f, 'tools/call', { name: 'liste_clients', arguments: { region: 'ouest' } });
  await assert.rejects(appel(), (e) => e instanceof ErreurMcp && e.code === -32020, 'schéma inchangé après relecture : l’erreur remonte, sans boucle');
  assert.deepEqual(s.methodes(), ['tools/list', 'tools/call', 'tools/list', 'tools/call']);
  s.appels.length = 0;
  schema = annote;
  assert.deepEqual((await appel()).structuredContent, { region: 'ouest' });
  assert.deepEqual(s.methodes(), ['tools/call', 'tools/list', 'tools/call'], 'définitions en mémoire dépassées : relues après le refus');
  assert.equal(s.appels.at(-1)?.entetes.get('mcp-param-region'), 'ouest');
});

test('client : erreur ordinaire avant que l’ère soit connue → server/discover tranche ; ère retenue revue si elle ne tient plus', async () => {
  // serveur moderne : l'erreur d'origine remonte, sans poignée de main
  const m = serveurModerne();
  await assert.rejects(appelMcp(cfg('/tranche'), secret, m.f, 'tools/list', { cursor: 'inconnu' }), (e) => e instanceof ErreurMcp && e.code === -32602);
  assert.deepEqual(m.methodes(), ['tools/list', 'server/discover']);
  // serveur ancien sans session, qui répond 200 et −32601 à ce qu'il ne connaît pas (comme notre serveur d'avant) : repli
  const sansSession = simuler((a) => {
    const x = a.corps;
    if (x.method === 'initialize') return ok(x.id, { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'a', version: '1' } });
    if (x.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (x.method === 'tools/call') return ko(x.id, -32602, 'Outil inconnu');
    return ko(x.id, -32601, 'Méthode non prise en charge');
  });
  await assert.rejects(appelMcp(cfg('/sans-session'), secret, sansSession.f, 'tools/call', { name: 'x', arguments: {} }), /MCP : Outil inconnu/);
  assert.deepEqual(sansSession.methodes(), ['tools/list', 'server/discover', 'initialize', 'notifications/initialized', 'tools/call'], 'pas de session : pas de DELETE');

  // serveur retenu ancien, remplacé par un serveur moderne seul : initialize refusé, le client revient au moderne
  const ancien = serveurAncien();
  await appelMcp(cfg('/migre'), secret, ancien.f, 'tools/list', {});
  const migre = serveurModerne();
  const r = await appelMcp(cfg('/migre'), secret, migre.f, 'tools/list', {});
  assert.equal((r.tools as any[]).length, 1);
  assert.deepEqual(migre.methodes(), ['initialize', 'tools/list']);
  // et l'inverse : retenu moderne, redevenu ancien
  const retour = serveurAncien();
  await appelMcp(cfg('/migre'), secret, retour.f, 'tools/list', {});
  assert.deepEqual(retour.methodes().slice(0, 3), ['tools/list', 'server/discover', 'initialize']);
});

test('client : résultat « input_required » ou d’un type inconnu refusé ; resultType absent accepté ; redirection toujours refusée', async () => {
  const saisie = simuler((a) => ok(a.corps.id, { resultType: 'input_required', inputRequests: {} }));
  await assert.rejects(appelMcp(cfg('/saisie'), secret, saisie.f, 'prompts/list', {}), /saisie en cours d’appel/);
  const inconnu = simuler((a) => ok(a.corps.id, { resultType: 'autre' }));
  await assert.rejects(appelMcp(cfg('/type'), secret, inconnu.f, 'prompts/list', {}), /type inconnu/);
  const sans = simuler((a) => ok(a.corps.id, { prompts: [] }));
  assert.deepEqual(await appelMcp(cfg('/sans-type'), secret, sans.f, 'prompts/list', {}), { prompts: [] });
  const redirige = simuler(() => new Response(null, { status: 307, headers: { location: 'http://169.254.169.254/' } }));
  await assert.rejects(appelMcp(cfg('/redirige'), secret, redirige.f, 'tools/list', {}), /Redirection refusée/);
  assert.equal(redirige.appels.length, 1);
  await assert.rejects(appelMcp({ url: 'http://10.0.0.1/mcp' }, secret, redirige.f, 'tools/list', {}), /https/);
});
