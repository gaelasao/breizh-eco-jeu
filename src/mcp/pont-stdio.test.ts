/**
 * Pont MCP « stdio » : chaque requête lue reçoit exactement une réponse JSON-RPC, quoi que réponde le serveur HTTP
 * (clé refusée, débit dépassé, page d'un proxy, panne de réseau) ; rien d'autre que du JSON-RPC sur la sortie standard ;
 * les deux ères du protocole (en-têtes de l'ère moderne ajoutés, version de l'ère ancienne reportée).
 * `fetch` simulé pour le cœur du pont, puis le vrai script lancé contre le vrai serveur sur 127.0.0.1.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Application } from '../passerelle/application.ts';
import { creerServeur } from '../passerelle/http.ts';
import { META_CAPACITES, META_CLIENT, META_VERSION } from '../passerelle/mcp-protocole.ts';
import { creerPont } from './pont.ts';

const MODERNE = '2026-07-28';
const meta = (version = MODERNE) => ({ [META_VERSION]: version, [META_CLIENT]: { name: 'assistant', version: '1' }, [META_CAPACITES]: {} });
/** Clé au bon format, fabriquée à chaque lancement : aucun serveur ne la connaît. */
const cleInconnue = () => `lb_${randomBytes(32).toString('base64url')}`;

interface Appel { entetes: Headers; corps: any; signal: AbortSignal | null }
const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json', ...entetes } });

function monter(repondre: (a: Appel) => Response | Promise<Response>) {
  const sorties: any[] = [];
  const diagnostics: string[] = [];
  const appels: Appel[] = [];
  const cle = cleInconnue();
  const f = (async (_url: URL | string, init?: RequestInit) => {
    const a: Appel = { entetes: new Headers(init?.headers), corps: JSON.parse(String(init?.body)), signal: init?.signal ?? null };
    appels.push(a);
    return repondre(a);
  }) as typeof fetch;
  const pont = creerPont({
    url: 'http://127.0.0.1:1/mcp', cle, f,
    ecrire: (ligne) => { assert.equal(/[\r\n]/.test(ligne), false, 'un message par ligne'); sorties.push(JSON.parse(ligne)); },
    journal: (t) => { diagnostics.push(t); },
  });
  const envoyer = (m: unknown) => pont.ligne(typeof m === 'string' ? m : JSON.stringify(m));
  return { pont, envoyer, sorties, diagnostics, appels, cle };
}

test('pont, ère ancienne : la ligne part telle quelle, sans en-tête moderne ; la version négociée et la session suivent', async () => {
  const p = monter((a) => {
    if (a.corps.method === 'initialize') return json({ jsonrpc: '2.0', id: a.corps.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 's', version: '1' } } }, 200, { 'mcp-session-id': 'session-1' });
    if (a.corps.id === undefined) return new Response(null, { status: 202 });
    return json({ jsonrpc: '2.0', id: a.corps.id, result: { tools: [] } });
  });
  await p.envoyer({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'a', version: '1' } } });
  await p.envoyer({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await p.envoyer({ jsonrpc: '2.0', id: 'liste-1', method: 'tools/list' });
  assert.deepEqual(p.sorties.map((s) => s.id), [0, 'liste-1'], 'une réponse par requête, aucune pour la notification');
  assert.equal(p.sorties[0].result.protocolVersion, '2025-06-18');
  const [init, notif, liste] = p.appels as [Appel, Appel, Appel];
  assert.equal(init.entetes.get('authorization'), `Bearer ${p.cle}`);
  assert.equal(init.entetes.get('mcp-protocol-version'), null);
  assert.equal(init.entetes.get('mcp-method'), null);
  for (const a of [notif, liste]) {
    assert.equal(a.entetes.get('mcp-protocol-version'), '2025-06-18');
    assert.equal(a.entetes.get('mcp-session-id'), 'session-1');
    assert.equal(a.entetes.get('mcp-method'), null);
  }
});

test('pont, ère moderne : en-têtes MCP-Protocol-Version, Mcp-Method et Mcp-Name tirés du corps ; erreurs modernes remises telles quelles', async () => {
  const p = monter((a) => {
    if (a.corps.params._meta[META_VERSION] !== MODERNE) return json({ jsonrpc: '2.0', id: a.corps.id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: [MODERNE], requested: a.corps.params._meta[META_VERSION] } } }, 400);
    if (a.corps.method === 'ping') return json({ jsonrpc: '2.0', id: a.corps.id, error: { code: -32601, message: 'Method not found' } }, 404);
    return json({ jsonrpc: '2.0', id: a.corps.id, result: { resultType: 'complete', supportedVersions: [MODERNE], capabilities: {} } });
  });
  await p.envoyer({ jsonrpc: '2.0', id: 'd1', method: 'server/discover', params: { _meta: meta() } });
  await p.envoyer({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'résumé du jour', arguments: {}, _meta: meta() } });
  await p.envoyer({ jsonrpc: '2.0', id: 3, method: 'resources/read', params: { uri: 'fiche://t-camping', _meta: meta() } });
  await p.envoyer({ jsonrpc: '2.0', id: 4, method: 'server/discover', params: { _meta: meta('2099-01-01') } });
  await p.envoyer({ jsonrpc: '2.0', id: 5, method: 'ping', params: { _meta: meta() } });
  const [d, appel, lecture, futur] = p.appels as [Appel, Appel, Appel, Appel];
  assert.equal(d.entetes.get('mcp-protocol-version'), MODERNE);
  assert.equal(d.entetes.get('mcp-method'), 'server/discover');
  assert.equal(d.entetes.get('mcp-name'), null);
  assert.match(d.entetes.get('accept') ?? '', /application\/json.*text\/event-stream/);
  assert.equal(appel.entetes.get('mcp-method'), 'tools/call');
  assert.equal(appel.entetes.get('mcp-name'), `=?base64?${Buffer.from('résumé du jour').toString('base64')}?=`);
  assert.equal(lecture.entetes.get('mcp-name'), 'fiche://t-camping');
  assert.equal(futur.entetes.get('mcp-protocol-version'), '2099-01-01', 'la version de la requête, pas celle du pont');
  assert.deepEqual(p.sorties.map((s) => s.id), ['d1', 2, 3, 4, 5]);
  assert.equal(p.sorties[0].result.resultType, 'complete');
  assert.equal(p.sorties[3].error.code, -32022, 'l’assistant voit l’erreur moderne et peut choisir une autre version');
  assert.deepEqual(p.sorties[3].error.data.supported, [MODERNE]);
  assert.equal(p.sorties[4].error.code, -32601);
});

test('pont : réponse HTTP qui n’est pas du JSON-RPC, ou panne de réseau → une erreur JSON-RPC avec l’identifiant de la requête', async () => {
  const cas: [string, () => Response | Promise<Response>, RegExp][] = [
    ['clé refusée', () => json({ erreur: 'cle_invalide' }, 401), /Clé d’API refusée.*HTTP 401, cle_invalide/],
    ['clé absente', () => json({ erreur: 'cle_requise', message: 'Ajoutez l’en-tête Authorization.' }, 401), /HTTP 401.*Ajoutez l’en-tête/],
    ['origine', () => json({ erreur: 'origine' }, 403), /Accès refusé.*HTTP 403/],
    ['débit', () => json({ erreur: 'trop_d_ecritures', message: 'Trop d’écritures avec cette clé.' }, 429), /HTTP 429.*Trop d’écritures/],
    ['corps trop gros', () => json({ erreur: 'trop_volumineux' }, 413), /HTTP 413, trop_volumineux/],
    ['page d’un proxy', () => new Response('<html><body>Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } }), /HTTP 502/],
    ['réponse vide', () => new Response('', { status: 200 }), /illisible.*HTTP 200/],
    ['202 pour une requête', () => new Response(null, { status: 202 }), /HTTP 202/],
    ['JSON sans JSON-RPC', () => json({ ok: true }), /illisible/],
    ['réponse à une autre requête', () => json({ jsonrpc: '2.0', id: 'autre', result: {} }), /illisible/],
    ['réseau', () => { throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:1') }); }, /injoignable.*ECONNREFUSED/],
    ['délai', () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }, /délai dépassé/],
  ];
  for (const ere of ['ancienne', 'moderne']) {
    for (const [quoi, repondre, attendu] of cas) {
      const p = monter(repondre);
      await p.envoyer({ jsonrpc: '2.0', id: `q-${quoi}`, method: 'tools/list', params: ere === 'moderne' ? { _meta: meta() } : {} });
      assert.equal(p.sorties.length, 1, `${quoi} (${ere}) : exactement une réponse`);
      const r = p.sorties[0];
      assert.equal(r.jsonrpc, '2.0');
      assert.equal(r.id, `q-${quoi}`);
      assert.equal('result' in r, false);
      assert.equal(Number.isInteger(r.error.code), true);
      assert.match(r.error.message, attendu, quoi);
      assert.equal(JSON.stringify(p.sorties).includes(p.cle) || p.diagnostics.join(' ').includes(p.cle), false, 'la clé n’est jamais écrite');
      assert.equal(p.diagnostics.length, 1, 'diagnostic sur la sortie d’erreur');
    }
  }
  // erreur JSON-RPC sans identifiant (refus de toute la requête) : remise avec l'identifiant de la requête
  const p = monter(() => json({ jsonrpc: '2.0', error: { code: -32600, message: 'Requête refusée' } }, 400));
  await p.envoyer({ jsonrpc: '2.0', id: 9, method: 'tools/list' });
  assert.deepEqual(p.sorties, [{ jsonrpc: '2.0', id: 9, error: { code: -32600, message: 'Requête refusée' } }]);
});

test('pont : notification, ligne illisible ou message sans méthode → jamais rien sur la sortie standard', async () => {
  const p = monter(() => json({ erreur: 'cle_invalide' }, 401));
  await p.envoyer({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await p.envoyer('ceci n’est pas du JSON');
  await p.envoyer('   ');
  await p.envoyer({ jsonrpc: '2.0', id: 1, result: {} });
  await p.envoyer('"texte"');
  assert.deepEqual(p.sorties, []);
  assert.equal(p.appels.length, 1, 'seule la notification part vers le serveur');
  assert.equal(p.diagnostics.length, 4);
  const panne = monter(() => { throw new TypeError('fetch failed'); });
  await panne.envoyer({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.deepEqual(panne.sorties, []);
  assert.equal(panne.diagnostics.length, 1);
});

test('pont : notifications/cancelled ferme la requête en cours (ère moderne) et aucune réponse n’est écrite pour elle', async () => {
  let recue: (() => void) | null = null;
  const arrivee = new Promise<void>((ok) => { recue = ok; });
  const p = monter((a) => new Promise<Response>((_ok, ko) => {
    a.signal?.addEventListener('abort', () => ko(a.signal?.reason));
    recue?.();
  }));
  const enCours = p.envoyer({ jsonrpc: '2.0', id: 'lent', method: 'tools/call', params: { name: 'planning', arguments: {}, _meta: meta() } });
  await arrivee;
  await p.envoyer({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 'lent', reason: 'abandon' } });
  await enCours;
  assert.equal(p.appels[0]?.signal?.aborted, true);
  assert.equal(p.appels.length, 1, 'en HTTP moderne, fermer la requête est l’annulation : aucune notification envoyée');
  assert.deepEqual(p.sorties, []);
});

test('pont : x-mcp-header → Mcp-Param-* sur tools/call ; outil à l’annotation invalide retiré de tools/list et refusé', async () => {
  const outils = [
    { name: 'executer_sql', inputSchema: { type: 'object', properties: { region: { type: 'string', 'x-mcp-header': 'Region' }, requete: { type: 'string' } } } },
    { name: 'outil_fautif', inputSchema: { type: 'object', properties: { a: { type: 'number', 'x-mcp-header': 'A' } } } },
  ];
  const p = monter((a) => json({ jsonrpc: '2.0', id: a.corps.id, result: a.corps.method === 'tools/list' ? { resultType: 'complete', tools: outils, ttlMs: 0, cacheScope: 'private' } : { resultType: 'complete', content: [], isError: false } }));
  await p.envoyer({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: meta() } });
  assert.deepEqual(p.sorties[0].result.tools.map((t: any) => t.name), ['executer_sql']);
  assert.match(p.diagnostics[0] ?? '', /outil_fautif.*écarté/);
  await p.envoyer({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'executer_sql', arguments: { region: 'us-west1', requete: 'SELECT 1' }, _meta: meta() } });
  assert.equal(p.appels[1]?.entetes.get('mcp-param-region'), 'us-west1');
  await p.envoyer({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'outil_fautif', arguments: { a: 1 }, _meta: meta() } });
  assert.equal(p.appels.length, 2, 'l’outil écarté n’est pas appelé');
  assert.equal(p.sorties[2].id, 3);
  assert.equal(p.sorties[2].error.code, -32602);
});

test('pont : lot JSON-RPC (2025-03-26) → une réponse par requête ; flux SSE → notifications puis réponse', async () => {
  const lot = monter((a) => json(a.corps.filter((m: any) => m.id !== undefined && m.id !== 2).map((m: any) => ({ jsonrpc: '2.0', id: m.id, result: {} }))));
  await lot.envoyer([{ jsonrpc: '2.0', id: 1, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/initialized' }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  assert.deepEqual(lot.sorties.map((s) => s.id), [1, 2]);
  assert.deepEqual(lot.sorties[0].result, {});
  assert.equal(typeof lot.sorties[1].error.message, 'string', 'requête du lot restée sans réponse : erreur fabriquée');

  const progression = { jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: 't', progress: 1 } };
  const flux = monter((a) => new Response(`: amorce\n\nevent: message\ndata: ${JSON.stringify(progression)}\n\nevent: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: a.corps.id, result: { resultType: 'complete', tools: [] } })}\n\n`, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
  await flux.envoyer({ jsonrpc: '2.0', id: 'f', method: 'tools/list', params: { _meta: meta() } });
  assert.deepEqual(flux.sorties.map((s) => s.method ?? s.id), ['notifications/progress', 'f']);
});

// ---------------------------------------------------------------- le vrai script contre le vrai serveur

const SCRIPT = fileURLToPath(new URL('./pont-stdio.ts', import.meta.url));

async function lancer(env: Record<string, string>, lignes: unknown[]): Promise<{ code: number | null; sorties: any[]; brut: string; erreurs: string }> {
  const { LB_URL: _u, LB_CLE: _c, ...reste } = process.env;
  const enfant = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SCRIPT], { env: { ...reste, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let brut = '';
  let erreurs = '';
  enfant.stdout.on('data', (d: Buffer) => { brut += d.toString('utf8'); });
  enfant.stderr.on('data', (d: Buffer) => { erreurs += d.toString('utf8'); });
  enfant.stdin.on('error', () => undefined);
  enfant.stdin.end(lignes.map((l) => `${JSON.stringify(l)}\n`).join(''));
  const [code] = (await once(enfant, 'close')) as [number | null];
  const sorties = brut.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  return { code, sorties, brut, erreurs };
}

test('pont lancé pour de bon : un assistant de chaque ère traverse le pont jusqu’au serveur ; clé inconnue → erreurs JSON-RPC', async () => {
  const app = await Application.creer({ exemple: 'pme' });
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  try {
    const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    const s = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId: 'dirigeante' }) });
    const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] as string;
    const k = await fetch(`${base}/api/v1/cles`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ nom: 'Pont', profilId: 'dirigeante' }) });
    const { jeton } = (await k.json()) as { jeton: string };
    const lignes = [
      // assistant des deux ères : sonde server/discover, puis reste moderne
      { jsonrpc: '2.0', id: 'sonde', method: 'server/discover', params: { _meta: meta() } },
      { jsonrpc: '2.0', id: 'outils', method: 'tools/list', params: { _meta: meta() } },
      { jsonrpc: '2.0', id: 'appel', method: 'tools/call', params: { name: 'resume_du_jour', arguments: {}, _meta: meta() } },
      { jsonrpc: '2.0', id: 'futur', method: 'server/discover', params: { _meta: meta('2099-01-01') } },
      { jsonrpc: '2.0', id: 'ping-moderne', method: 'ping', params: { _meta: meta() } },
      // assistant ancien : poignée de main
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'ancien', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'resume_du_jour', arguments: {} } },
    ];
    const r = await lancer({ LB_URL: base, LB_CLE: jeton }, lignes);
    assert.equal(r.code, 0, r.erreurs);
    const par = new Map(r.sorties.map((x) => [x.id, x]));
    assert.equal(r.sorties.length, 7, 'une réponse par requête, aucune pour la notification');
    assert.equal(par.get('sonde').result.supportedVersions[0], MODERNE);
    assert.ok(par.get('outils').result.tools.some((t: any) => t.name === 'resume_du_jour'));
    assert.equal(par.get('appel').result.resultType, 'complete');
    assert.equal(par.get('appel').result.isError, false);
    assert.equal(par.get('futur').error.code, -32022);
    assert.equal(par.get('ping-moderne').error.code, -32601);
    assert.equal(par.get(1).result.protocolVersion, '2025-06-18');
    assert.equal(par.get(2).result.isError, false);
    assert.equal('resultType' in par.get(2).result, false);
    assert.equal(r.brut.includes(jeton), false);

    // clé au bon format mais inconnue du serveur : 401 sans JSON-RPC, que le pont transforme pour chaque requête
    const refuse = await lancer({ LB_URL: base, LB_CLE: cleInconnue() }, [lignes[0], lignes[5], lignes[6]]);
    assert.equal(refuse.code, 0);
    assert.deepEqual(new Set(refuse.sorties.map((x) => x.id)), new Set(['sonde', 1]));
    for (const x of refuse.sorties) assert.match(x.error.message, /Clé d’API refusée.*HTTP 401/);
    assert.match(refuse.erreurs, /\[pont MCP\]/);

    // serveur arrêté : erreur JSON-RPC, pas de silence
    const port = (serveur.address() as AddressInfo).port;
    await new Promise<void>((ok) => { serveur.closeAllConnections(); serveur.close(() => ok()); });
    const panne = await lancer({ LB_URL: `http://127.0.0.1:${port}`, LB_CLE: cleInconnue() }, [lignes[0]]);
    assert.equal(panne.sorties.length, 1);
    assert.equal(panne.sorties[0].id, 'sonde');
    assert.match(panne.sorties[0].error.message, /injoignable/);
  } finally {
    if (serveur.listening) await new Promise<void>((ok) => { serveur.closeAllConnections(); serveur.close(() => ok()); });
    app.arreter();
  }
});

test('pont lancé sans clé : il s’arrête avec une explication sur la sortie d’erreur, rien sur la sortie standard', async () => {
  const r = await lancer({ LB_URL: 'http://127.0.0.1:1', LB_CLE: 'pas-une-cle' }, []);
  assert.equal(r.code, 1);
  assert.equal(r.brut, '');
  assert.match(r.erreurs, /LB_CLE manquante ou invalide/);
});
