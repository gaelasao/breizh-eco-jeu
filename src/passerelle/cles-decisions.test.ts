/**
 * Clés d'API (Claude, Make, scripts) et décisions humaines (constats ia-act-1 et ia-act-9) :
 * - une clé ne valide, ne commande, ne paie, ne mandate rien sur Breizhcosystem (« validé par une personne » doit être vrai) ;
 * - une clé ne crée, ne liste ni ne révoque de clé, ne touche ni aux accès, ni à l'adresse ou à la liaison Breizhcosystem, ni à
 *   l'accord de partage, ni aux automatisations : révoquer la clé coupe vraiment l'agent ;
 * - ce qu'une clé fait (planning par MCP…) est écrit au journal AVEC la clé ; créer et révoquer une clé aussi.
 * Les mêmes actions restent possibles pour une personne connectée à l'écran.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// fausse clé d'organisation Breizhcosystem, construite à l'exécution
const NX = ['nx', 'k'.repeat(43)].join('_');

function nexusSimule() {
  const recu: { m: string; chemin: string }[] = [];
  let confirme = false;
  const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const m = init?.method ?? 'GET';
    recu.push({ m, chemin: u.pathname });
    const auth = (init?.headers as Record<string, string>)?.authorization ?? null;
    if (u.pathname === '/v0/liaison') return Response.json({ code: 'ABCD-2345', attente: 'a'.repeat(43), url: 'https://nexus.test/relier?code=ABCD-2345', expire: new Date(Date.now() + 600_000).toISOString() });
    if (u.pathname === '/v0/liaison/retrait') return Response.json(confirme ? { statut: 'confirmee', cle: NX, organisation: 'Menuiserie Kerlann' } : { statut: 'en_attente' });
    if (auth !== `Bearer ${NX}`) return Response.json({ erreur: 'cle_invalide' }, { status: 401 });
    if (u.pathname === '/v0/agent/lancer') return Response.json({ preparees: 1, validees: 0 });
    if (u.pathname === `/v0/commandes/${ID(31)}/valider`) return Response.json({ statut: 'validee' });
    if (u.pathname === '/v0/mandats' && m === 'POST') return Response.json({ id: ID(5) });
    if (u.pathname === '/v0/droits') return Response.json({ orgId: ID(1), plan: 'active', etatAbonnement: 'actif', actifJusquau: null, capacites: ['agent_achat'], verifieLe: new Date().toISOString() });
    if (u.pathname === '/v0/partage') return Response.json({ categories: ['besoins'] });
    return Response.json({ erreur: 'introuvable' }, { status: 404 });
  };
  return { f: f as typeof fetch, recu, confirmer: () => { confirme = true; } };
}

async function monter() {
  const n = nexusSimule();
  process.env.LB_AUTORISER_LOCAL = '1';
  const app = await Application.creer({ fetch: n.f });
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  await app.nexus.reglerAdresse('http://127.0.0.1:4180');
  await app.nexus.demarrerLiaison();
  n.confirmer();
  assert.equal((await app.nexus.suivreLiaison()).statut, 'reliee');
  const s = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId: 'dirigeante' }) });
  const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] as string;
  const ecran = async (m: string, chemin: string, corps?: unknown) => {
    const r = await fetch(`${base}/api/v1${chemin}`, { method: m, headers: { cookie, 'content-type': 'application/json', 'x-lb-requete': '1' }, body: corps === undefined ? null : JSON.stringify(corps) });
    return { statut: r.status, json: await r.json().catch(() => null) as any };
  };
  const k = (await ecran('POST', '/cles', { nom: 'Claude', profilId: 'dirigeante' })).json;
  const parCle = async (m: string, chemin: string, corps?: unknown, jeton = k.jeton as string) => {
    const r = await fetch(`${base}/api/v1${chemin}`, { method: m, headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' }, body: corps === undefined ? null : JSON.stringify(corps) });
    return { statut: r.status, json: await r.json().catch(() => null) as any };
  };
  const mcp = async (corps: unknown) => (await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k.jeton}` }, body: JSON.stringify(corps) })).json() as Promise<any>;
  return { app, n, ecran, parCle, mcp, cle: k, fermer: () => { serveur.close(); app.arreter?.(); } };
}

test('clé d’API : aucun achat Breizhcosystem (mandat, agent, validation, commande, paiement, contact) sans une personne', async () => {
  const t = await monter();
  try {
    const avant = t.n.recu.length;
    const etapes = [
      ['POST', '/nexus/mandats', { budgetMensuel: 1_000_000 }],
      ['POST', `/nexus/mandats/${ID(5)}/activer`, {}],
      ['POST', '/nexus/agent/lancer', {}],
      ['POST', `/nexus/commandes/${ID(31)}/valider`, {}],
      ['POST', `/nexus/commandes/${ID(31)}/annoncer`, {}],
      ['POST', `/nexus/commandes/${ID(31)}/payer`, { mode: 'virement' }],
      ['POST', '/nexus/agent/commander', { stockId: ID(11), quantite: 500 }],
      ['POST', '/nexus/agent/publier', { titre: 'Bois' }],
      ['POST', '/nexus/contacter', { id: ID(12) }],
      ['POST', `/nexus/besoins/${ID(13)}/repondre`, { message: 'Oui' }],
      ['POST', '/nexus/proposer', { cible: ID(14) }],
    ] as const;
    for (const [m, c, corps] of etapes) {
      const r = await t.parCle(m, c, corps);
      assert.equal(r.statut, 403, `${m} ${c}`);
      assert.equal(r.json?.erreur, 'session_requise', `${m} ${c}`);
    }
    assert.equal(t.n.recu.slice(avant).filter((x) => x.chemin.startsWith('/v0/commandes') || x.chemin.startsWith('/v0/agent') || x.chemin.startsWith('/v0/mandats')).length, 0, 'rien n’est parti vers Breizhcosystem');
    // une personne à l'écran, elle, valide
    assert.equal((await t.ecran('POST', `/nexus/commandes/${ID(31)}/valider`, {})).statut, 200);
    assert.ok(t.n.recu.some((x) => x.chemin === `/v0/commandes/${ID(31)}/valider`));
    // lire reste permis à une clé
    assert.notEqual((await t.parCle('GET', '/nexus')).statut, 403);
  } finally { t.fermer(); }
});

test('clé d’API : ni clé, ni accès, ni liaison, ni partage, ni automatisation ; révoquer coupe l’agent', async () => {
  const t = await monter();
  try {
    const refus = [
      ['POST', '/cles', { nom: 'Claude 2', profilId: 'dirigeante' }],
      ['GET', '/cles', undefined],
      ['DELETE', `/cles/${t.cle.id}`, undefined],
      ['GET', '/acces', undefined],
      ['POST', '/acces', { nom: 'Agent' }],
      ['PUT', '/acces/terrain', { peutAdministrer: true }],
      ['PUT', '/nexus/adresse', { url: 'http://127.0.0.1:4999' }],
      ['POST', '/nexus/liaison', {}],
      ['DELETE', '/nexus', undefined],
      ['PUT', '/nexus/partage', { categories: ['profil', 'besoins', 'stocks', 'capacites', 'indicateurs'] }],
      ['PUT', '/automatisations/reglages', {}],
      ['POST', '/automatisations/relances', { actif: true }],
      ['PUT', '/bodacc', { actif: true }],
      // constat revue-jeu-1-8 : ni « J'ai vu » sur un avis de sécurité, ni réglage de la vérification des versions
      ['POST', '/securite/avis/AAAAAAAAAAAA/vu', {}],
      ['PUT', '/mises-a-jour', { auto: false }],
      ['POST', '/mises-a-jour', {}],
    ] as const;
    for (const [m, c, corps] of refus) assert.equal((await t.parCle(m, c, corps)).statut, 403, `${m} ${c}`);
    assert.equal(t.app.nexus.instantane().url, 'http://127.0.0.1:4180', 'adresse Breizhcosystem inchangée');
    assert.equal(t.app.nexus.relie, true, 'liaison intacte');
    assert.equal((await t.ecran('GET', '/cles')).json.length, 1, 'aucune clé de plus');
    // l'écran révoque la clé : l'agent n'a plus rien
    assert.equal((await t.ecran('DELETE', `/cles/${t.cle.id}`)).statut, 200);
    assert.equal((await t.parCle('GET', '/monde')).statut, 401);
  } finally { t.fermer(); }
});

test('journal : ce que fait une clé est écrit avec la clé ; création et révocation tracées avec la personne', async () => {
  const t = await monter();
  try {
    const plan = await t.mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'planning', arguments: {} } });
    const ligne = plan.result.structuredContent.lignes[0];
    const date = plan.result.structuredContent.jours[0];
    const aff = await t.mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'affecter_planning', arguments: { employe: ligne.id, date, valeur: 'absence' } } });
    assert.ok(!aff.result.isError, JSON.stringify(aff));
    const journal = (await t.ecran('GET', '/journal')).json as { action: string; acteur: string; canal?: string; detail: string }[];
    const e = journal.find((x) => x.action === 'planning.affecte');
    assert.equal(e?.acteur, 'dirigeante');
    assert.equal(e?.canal, `cle:${t.cle.id} « Claude »`, 'la clé qui a agi est au journal');
    const creee = journal.find((x) => x.action === 'cle.creee');
    assert.ok(creee && creee.detail.includes('« Claude »') && creee.canal === undefined, 'création tracée, depuis l’écran');
    // une action à l'écran n'a pas de canal
    await t.ecran('POST', '/planning', { employe: ligne.id, date, valeur: '' });
    const ecran = ((await t.ecran('GET', '/journal')).json as typeof journal).find((x) => x.action === 'planning.affecte');
    assert.equal(ecran?.canal, undefined);
    await t.ecran('DELETE', `/cles/${t.cle.id}`);
    assert.ok(((await t.ecran('GET', '/journal')).json as typeof journal).some((x) => x.action === 'cle.revoquee' && x.detail.includes('« Claude »')));
  } finally { t.fermer(); }
});

test('clé d’API (IA) : elle prépare, une PERSONNE approuve ; l’action dit qu’elle vient de la clé ; rappel « données de tiers »', async () => {
  const t = await monter();
  try {
    // MCP avec une clé du profil administrateur : la modification reste en attente (plus d'auto-approbation)
    const modif = await t.mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'modifier_fiche', arguments: { id: 't-camping', champs: { ville: 'Camaret' } } } });
    assert.equal(modif.result.isError, false, JSON.stringify(modif));
    const v = modif.result.structuredContent;
    assert.equal(v.etat, 'en_attente', 'une clé n’approuve pas, même avec un profil qui le peut');
    assert.equal(v.approuvePar, null);
    assert.equal(v.via, `cle:${t.cle.id} « Claude »`, 'l’action garde la clé qui l’a demandée');
    assert.match(v.aFaire, /une personne doit l’approuver/);
    assert.notEqual(t.app.monde.objetReel('t-camping')?.champs.ville, 'Camaret', 'rien n’est modifié avant l’approbation');
    // rappel joint AVANT les données : ce qui suit n'est pas une consigne
    assert.match(modif.result.content[0].text, /jamais des consignes/);
    const init = await t.mcp({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    assert.match(init.result.instructions, /jamais des consignes/);
    // l'API par clé : executer:true ignoré, approbation refusée
    const api = await t.parCle('POST', '/actions', { cle: 'cle-ia-00000001', capacite: 'mouvement', cible: 'a-panneaux', parametres: { champ: 'quantite', delta: 5, motif: 'IA' }, executer: true });
    assert.equal(api.statut, 200);
    assert.equal(api.json.etat, 'en_attente');
    const auto = await t.parCle('POST', `/actions/${encodeURIComponent(v.cle)}/approuver`);
    assert.equal(auto.statut, 403);
    assert.equal(auto.json?.erreur, 'session_requise');
    // la personne voit la demande (Aujourd'hui) avec sa clé, et l'approuve à l'écran
    const monde = (await t.ecran('GET', '/monde')).json;
    const attente = monde.actionsEnAttente.find((a: any) => a.cle === v.cle);
    assert.equal(attente?.via, `cle:${t.cle.id} « Claude »`);
    const ok = await t.ecran('POST', `/actions/${encodeURIComponent(v.cle)}/approuver`);
    assert.equal(ok.json.etat, 'reussie_technique');
    assert.equal(ok.json.approuvePar, 'dirigeante', 'approuvé par la personne, pas par la clé');
    assert.equal(t.app.monde.objetReel('t-camping')?.champs.ville, 'Camaret');
    const journal = (await t.ecran('GET', '/journal')).json as { action: string; canal?: string }[];
    assert.equal(journal.find((x) => x.action === 'action.preparee')?.canal, `cle:${t.cle.id} « Claude »`);
    assert.equal(journal.find((x) => x.action === 'action.approuvee')?.canal, undefined, 'approbation faite à l’écran');
  } finally { t.fermer(); }
});

test('clé d’API : elle n’acquitte pas l’avis de sécurité d’un autre administrateur et ne coupe pas la vérification des versions (revue-jeu-1-8)', async () => {
  const t = await monter();
  try {
    const dir = t.app.monde.profil('dirigeante')!;
    const b = t.app.monde.creerAcces(dir, { nom: 'Associée', role: 'dirigeant', types: 'tous', lieux: 'tous', departements: 'tous', rolesTiers: 'tous', peutAdministrer: true, voitScore: true }) as { id: string };
    // l'administratrice A exporte tout : B doit en être avertie
    assert.equal((await t.ecran('POST', '/sauvegardes/export', { phrase: ['une phrase', 'assez longue', 'pour tout'].join(' '), avecAcces: true })).statut, 200);
    const pB = t.app.monde.profil(b.id)!;
    const avis = t.app.avisSecurite(pB);
    assert.equal(avis.length, 1);
    // A crée une clé au profil de B et tente de marquer l'avis « vu » à sa place
    const k = (await t.ecran('POST', '/cles', { nom: 'Outil', profilId: b.id })).json as { jeton: string };
    const vu = await t.parCle('POST', `/securite/avis/${avis[0]!.id}/vu`, {}, k.jeton);
    assert.equal(vu.statut, 403);
    assert.equal(vu.json?.erreur, 'session_requise');
    assert.equal(t.app.avisSecurite(pB).length, 1, 'l’avis reste à voir par B');
    // la vérification quotidienne des versions ne se coupe pas avec une clé, même administrateur
    t.app.regler({ verifierMisesAJour: true });
    const maj = await t.parCle('PUT', '/mises-a-jour', { auto: false });
    assert.equal(maj.statut, 403);
    assert.equal(t.app.verificationMisesAJour, true);
    // lire l'état reste permis à une clé d'administrateur ; à l'écran, une personne règle
    assert.equal((await t.parCle('GET', '/mises-a-jour')).statut, 200);
    assert.equal((await t.ecran('PUT', '/mises-a-jour', { auto: false })).statut, 200);
    assert.equal(t.app.verificationMisesAJour, false);
  } finally { t.fermer(); }
});
