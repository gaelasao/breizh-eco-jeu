/**
 * Temps réel des outils (temps-reel.ts, synchro.ts), Breizhcosystem et outils SIMULÉS (`fetch` injecté), aucun appel
 * réseau ; faux jetons construits à l'exécution :
 * - canal : ouvert seulement relié et abonné, « pret » puis avis, silence → rouvert avec attente croissante, clé refusée
 *   → nouvel essai bien plus tard, avis illisibles ignorés ;
 * - abonnements chez chaque outil, avec le jeton de l'entreprise : création, adresse d'avis vérifiée, renouvellement
 *   avant expiration, suppression au débranchement AVANT la révocation ;
 * - à un avis : relecture regroupée sur 2 s (Airtable : charges lues avec le curseur ; Microsoft : classeur inchangé,
 *   rien relu) ; filet de sécurité de 30 minutes quand le temps réel vit ;
 * - « En temps réel » / « Toutes les N minutes ».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Application } from './application.ts';
import { frequence } from './synchro.ts';
import { CanalTempsReel, concerne, lireAvis, REGROUPEMENT_MS } from './temps-reel.ts';

process.env.LB_AUTORISER_LOCAL = '1'; // Breizhcosystem simulé sur http://127.0.0.1 (ce fichier tourne dans son propre processus)

const RESEAU = 'http://127.0.0.1:4182';
const faux = (...parts: string[]) => parts.join('_');
const ATTENTE = 'A'.repeat(43);
const CLE = `nx_${'K'.repeat(43)}`;
const BASE = 'appAAAAAAAAAAAAAA';
const TABLE = 'tblTTTTTTTTTTTTTT';
const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
const pause = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

interface Appel { url: URL; methode: string; entetes: Headers; corps: any }

/** Breizhcosystem simulé (liaison, relais OAuth, abonnements, canal) et outils simulés. */
function simulation(outil: (a: Appel) => Response | null) {
  const appels: Appel[] = [];
  const abonnements = new Map<string, { fournisseur: string; connecteur: string; empreinte?: string; jeton: string; secret: string | null; maj: any[] }>();
  const reseau = {
    resultat: null as null | Record<string, unknown>,
    /** Origine des adresses d'avis rendues (une autre : le jeu doit refuser). */
    origineAvis: RESEAU,
    refusAbonnement: null as null | Response,
    canaux: [] as { envoyer: (e: string, d: unknown) => void; fermer: () => void; ouvert: () => boolean }[],
    statutFlux: 200,
  };
  const enc = new TextEncoder();
  const f = (async (url: URL | string, init?: RequestInit) => {
    const brut = init?.body ? String(init.body) : null;
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: brut === null ? null : brut.startsWith('{') || brut.startsWith('[') ? JSON.parse(brut) : brut };
    appels.push(a);
    if (a.url.origin !== RESEAU) return outil(a) ?? json({ error: 'inconnu' }, 404);
    const p = a.url.pathname;
    if (p === '/v0/liaison') return json({ code: 'ABCD-EF23', attente: ATTENTE, url: `${RESEAU}/relier`, expire: new Date(Date.now() + 600_000).toISOString() });
    if (p === '/v0/liaison/retrait') return json({ statut: 'confirmee', cle: CLE, organisation: 'Menuiserie Kerlann' });
    if (p === '/v0/oauth/fournisseurs') return json({ fournisseurs: ['airtable', 'microsoft', 'notion', 'google', 'pipedrive', 'hubspot'].map((id) => ({ id, nom: id, parametre: null })) });
    if (p === '/v0/oauth/demarrer') return json({ url: { airtable: 'https://airtable.com/oauth2/v1/authorize?state=s', microsoft: 'https://login.microsoftonline.com/organizations/oauth2/v2.0/authorize?state=s', notion: 'https://api.notion.com/v1/oauth/authorize?state=s', google: 'https://accounts.google.com/o/oauth2/v2/auth?state=s', pipedrive: 'https://oauth.pipedrive.com/oauth/authorize?state=s', hubspot: 'https://app.hubspot.com/oauth/authorize?state=s' }[a.corps.fournisseur as string], attente: ATTENTE, expire: new Date(Date.now() + 600_000).toISOString() });
    if (p === '/v0/oauth/retrait') { const r = reseau.resultat; reseau.resultat = null; return r ? json(r) : json({ statut: 'attente' }); }
    if (p === '/v0/oauth/revoquer') return json({ ok: true, chezOutil: 'a_retirer' });
    if (p === '/v0/relais/flux') {
      if (a.entetes.get('authorization') !== `Bearer ${CLE}`) return json({ erreur: 'cle_invalide' }, 401);
      if (reseau.statutFlux !== 200) return json({ erreur: 'refus' }, reseau.statutFlux);
      let ctrl!: ReadableStreamDefaultController<Uint8Array>;
      let ouvert = true;
      const flux = new ReadableStream<Uint8Array>({ start(c) { ctrl = c; } });
      const fermer = () => { if (ouvert) { ouvert = false; try { ctrl.close(); } catch { /* déjà fermé */ } } };
      init?.signal?.addEventListener('abort', () => { if (ouvert) { ouvert = false; try { ctrl.error(new Error('abandon')); } catch { /* déjà fermé */ } } });
      const canal = { envoyer: (e: string, d: unknown) => { if (ouvert) ctrl.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)); }, fermer, ouvert: () => ouvert };
      reseau.canaux.push(canal);
      queueMicrotask(() => canal.envoyer('pret', { battementS: 25 }));
      return new Response(flux, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    if (p === '/v0/relais/abonnements' && a.methode === 'POST') {
      if (reseau.refusAbonnement) return reseau.refusAbonnement;
      const id = randomUUID();
      const jeton = 'J'.repeat(20) + id.replace(/-/g, '').slice(0, 23);
      const secret = ['google', 'microsoft', 'pipedrive'].includes(a.corps.fournisseur) ? faux('secret', 'reseau', id.slice(0, 8)) + 'x'.repeat(12) : null;
      abonnements.set(id, { fournisseur: a.corps.fournisseur, connecteur: a.corps.connecteur, empreinte: a.corps.empreinte, jeton, secret, maj: [] });
      const parApplication = ['notion', 'hubspot'].includes(a.corps.fournisseur);
      return json({ id, fournisseur: a.corps.fournisseur, connecteur: a.corps.connecteur, adresse: `${reseau.origineAvis}/v0/relais/evenements/${a.corps.fournisseur}${parApplication ? '' : `/${jeton}`}`, secret, ...(a.corps.fournisseur === 'pipedrive' ? { utilisateur: 'living-business' } : {}), actif: parApplication });
    }
    const m = /^\/v0\/relais\/abonnements\/([0-9a-f-]{36})$/.exec(p);
    if (m) {
      const ab = abonnements.get(m[1] as string);
      if (a.methode === 'DELETE') { const ok = abonnements.delete(m[1] as string); return json({ ok: true, supprime: ok }); }
      if (!ab) return json({ erreur: 'introuvable' }, 404);
      ab.maj.push(a.corps);
      return json({ ok: true, actif: true });
    }
    return json({ erreur: 'introuvable' }, 404);
  }) as typeof fetch;
  return { f, appels, abonnements, reseau };
}
type Sim = ReturnType<typeof simulation>;

async function monter(sim: Sim, maintenant?: () => Date) {
  const app = await Application.creer({ exemple: 'pme', fetch: sim.f, ...(maintenant ? { maintenant } : {}) });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  app.monde.viderDemo(p, 's', { nom: 'Test' });
  await app.nexus.reglerAdresse(RESEAU);
  await app.nexus.demarrerLiaison();
  assert.equal((await app.nexus.suivreLiaison()).statut, 'reliee');
  return { app, p };
}

/** « Se connecter avec… » réussi (outil simulé), puis branchement ACTIF. */
async function brancher(m: Awaited<ReturnType<typeof monter>>, sim: Sim, source: string, fournisseur: string, config: Record<string, string>, mapping: Record<string, string>, jetons: Record<string, unknown>) {
  const d = await m.app.synchro.demarrerOAuth(m.p, { source, config: {} });
  sim.reseau.resultat = { statut: 'connecte', fournisseur, jetons: { rafraichissement: null, expire: new Date(Date.now() + 3600_000).toISOString(), extra: {}, ...jetons } };
  const suivi = await m.app.synchro.suivreOAuth(m.p, d.id) as { statut: string; jeton: string };
  assert.equal(suivi.statut, 'connecte');
  return m.app.synchro.creer(m.p, { source, config: { ...config, jeton: suivi.jeton }, typeObjet: 'entreprise', roles: [], mapping, sens: 'lecture', intervalleS: 300, actif: true });
}
const vue = (app: Application, p: NonNullable<ReturnType<Application['monde']['profil']>>, id: string) => app.synchro.lister(p).find((c) => c.id === id)!;
const attendre = async (cond: () => boolean, ms = 4000) => { const d = Date.now(); while (!cond()) { if (Date.now() - d > ms) throw new Error('délai dépassé'); await pause(20); } };

test('avis du canal relus avant usage ; « Toutes les N minutes » ; filtre par genre de fiche et par tableau Notion', () => {
  assert.deepEqual(lireAvis({ connecteur: 'cx-0123456789ab', fournisseur: 'airtable', objets: ['contact:1', 'a b', 'x'.repeat(101)], enAttente: true }), { connecteur: 'cx-0123456789ab', fournisseur: 'airtable', objets: ['contact:1'], enAttente: true });
  assert.equal(lireAvis({ connecteur: '../x', fournisseur: 'airtable' }), null);
  assert.equal(lireAvis({ connecteur: 'cx-0123456789ab', fournisseur: 'shopify' }), null);
  assert.equal(frequence(300), 'Toutes les 5 minutes');
  assert.equal(frequence(60), 'Toutes les minutes');
  assert.equal(frequence(3600), 'Toutes les heures');
  assert.equal(frequence(30), 'Toutes les 30 secondes');
  assert.equal(concerne('hubspot', { objet: 'contacts' }, ['company:1']), false);
  assert.equal(concerne('hubspot', { objet: 'contacts' }, ['company:1', 'contact:2']), true);
  assert.equal(concerne('pipedrive', { objet: 'deals' }, ['deal:7']), true);
  assert.equal(concerne('notion', { base: 'source:33333333444445558666777777777777' }, ['22222222-3333-4444-8555-666666666666', '33333333-4444-4555-8666-777777777777']), true);
  assert.equal(concerne('notion', { base: 'source:33333333444445558666777777777777' }, ['99999999-3333-4444-8555-666666666666']), false);
  assert.equal(concerne('airtable', {}, []), true);
});

test('canal : fermé tant qu’inutile, « pret » puis avis, silence → rouvert, attente croissante, clé refusée → bien plus tard', async () => {
  const avis: unknown[] = [];
  let utile = false;
  let ouvertures = 0;
  const statuts: number[] = [];
  const enc = new TextEncoder();
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const c = new CanalTempsReel({
    utile: () => utile, silenceMs: 300, attenteMinMs: 50, attenteMaxMs: 400,
    surAvis: (a) => avis.push(a),
    ouvrir: async (signal) => {
      ouvertures++;
      const s = statuts.shift() ?? 200;
      if (s !== 200) return new Response('{}', { status: s });
      const flux = new ReadableStream<Uint8Array>({ start(k) { ctrl = k; } });
      signal.addEventListener('abort', () => { try { ctrl?.error(new Error('abandon')); } catch { /* fermé */ } });
      return new Response(flux, { status: 200 });
    },
  });
  c.demarrer();
  await pause(100);
  assert.equal(ouvertures, 0, 'rien à suivre : aucun canal');
  utile = true;
  c.relancer();
  await attendre(() => ouvertures === 1 && ctrl !== null);
  ctrl!.enqueue(enc.encode('event: pret\ndata: {"battementS":25}\n\n'));
  await attendre(() => c.enLigne);
  ctrl!.enqueue(enc.encode('event: avis\ndata: {"connecteur":"cx-0123456789ab","fournisseur":"notion","objets":["x"]}\n\nevent: avis\ndata: pas du json\n\nevent: avis\ndata: {"connecteur":"<script>","fournisseur":"notion"}\n\n'));
  await attendre(() => avis.length === 1);
  await pause(50);
  assert.equal(avis.length, 1, 'avis illisibles ignorés');
  // plus rien n'arrive (ni battement ni avis) : le canal est tenu pour perdu, puis rouvert
  await attendre(() => ouvertures === 2, 3000);
  assert.equal(c.enLigne, false);
  // clé refusée : nouvel essai bien plus tard (30 min), pas en boucle
  statuts.push(401);
  ctrl!.error(new Error('coupure'));
  await attendre(() => ouvertures === 3, 3000);
  await pause(600);
  assert.equal(ouvertures, 3, 'pas de nouvel essai rapproché après un refus');
  c.arreter();
});

test('Airtable : abonnement créé avec le jeton de l’entreprise, avis → charges lues puis relecture regroupée, renouvellement, suppression avant révocation', async () => {
  let horloge = Date.now();
  const webhooks: Appel[] = [];
  const lectures: string[] = [];
  let charges = 2;
  const sim = simulation((a) => {
    if (a.url.host !== 'api.airtable.com') return null;
    if (a.url.pathname === `/v0/bases/${BASE}/webhooks` && a.methode === 'POST') { webhooks.push(a); return json({ id: 'achWWWWWWWWWWWWWW', macSecretBase64: Buffer.from('mac-secret-essai-0123456789').toString('base64'), expirationTime: new Date(horloge + 7 * 86_400_000).toISOString() }); }
    if (a.url.pathname === `/v0/bases/${BASE}/webhooks/achWWWWWWWWWWWWWW/payloads`) { lectures.push(`charges:${a.url.searchParams.get('cursor')}`); const n = charges; charges = 0; return json({ payloads: Array.from({ length: n }, (_, i) => ({ baseTransactionNumber: i + 1 })), cursor: 1 + n + (n ? 0 : 0), mightHaveMore: false }); }
    if (a.url.pathname === `/v0/bases/${BASE}/webhooks/achWWWWWWWWWWWWWW/refresh`) { lectures.push('rafraichir'); return json({ expirationTime: new Date(horloge + 7 * 86_400_000).toISOString() }); }
    if (a.url.pathname === `/v0/bases/${BASE}/webhooks/achWWWWWWWWWWWWWW` && a.methode === 'DELETE') { lectures.push('supprimer'); return new Response(null, { status: 200 }); }
    if (a.url.pathname === `/v0/${BASE}/${TABLE}`) { lectures.push('lecture'); return json({ records: [{ id: 'recAAAAAAAAAAAAAA', fields: { Nom: 'Scierie du Trégor' } }] }); }
    return null;
  });
  const m = await monter(sim, () => new Date(horloge));
  const c = await brancher(m, sim, 'airtable', 'airtable', { base: BASE, table: TABLE }, { Nom: '__nom' }, { acces: faux('at', 'acces'), rafraichissement: faux('at', 'rafr') });
  await m.app.synchro.entretenirTempsReel();
  // abonnement chez Breizhcosystem, puis webhook chez Airtable avec le jeton de l'entreprise et l'adresse du réseau
  const [id, ab] = [...sim.abonnements.entries()][0]!;
  assert.deepEqual({ fournisseur: ab.fournisseur, connecteur: ab.connecteur }, { fournisseur: 'airtable', connecteur: c.id });
  assert.equal(webhooks.length, 1);
  assert.equal(webhooks[0]!.entetes.get('authorization'), `Bearer ${faux('at', 'acces')}`);
  assert.deepEqual(webhooks[0]!.corps, { notificationUrl: `${RESEAU}/v0/relais/evenements/airtable/${ab.jeton}`, specification: { options: { filters: { dataTypes: ['tableData'], recordChangeScope: TABLE } } } });
  assert.deepEqual(ab.maj[0], { externe: 'achWWWWWWWWWWWWWW', expire: new Date(horloge + 7 * 86_400_000).toISOString(), secret: Buffer.from('mac-secret-essai-0123456789').toString('base64') }, 'le secret MAC part au réseau, qui vérifie les avis');
  assert.equal(JSON.stringify(m.app.synchro.instantane()).includes(Buffer.from('mac-secret-essai-0123456789').toString('base64')), false, 'jamais gardé par le jeu');
  assert.equal(JSON.stringify(m.app.synchro.instantane()).includes(ab.jeton), false, 'adresse des avis chiffrée dans l’état');
  // canal ouvert : « En temps réel » ; fermé : « Toutes les 5 minutes »
  assert.equal(vue(m.app, m.p, c.id).frequence, 'Toutes les 5 minutes');
  m.app.tempsReel.demarrer();
  await attendre(() => m.app.tempsReel.enLigne);
  assert.equal(vue(m.app, m.p, c.id).frequence, 'En temps réel');
  // trois avis en moins de 2 s : une seule relecture, après lecture des charges (curseur)
  const t0 = Date.now();
  for (let i = 0; i < 3; i++) sim.reseau.canaux.at(-1)!.envoyer('avis', { connecteur: c.id, fournisseur: 'airtable' });
  await attendre(() => lectures.includes('lecture'), 5000);
  assert.ok(Date.now() - t0 >= REGROUPEMENT_MS - 50, 'regroupés sur 2 s');
  await pause(200);
  assert.deepEqual(lectures, ['charges:1', 'lecture']);
  assert.equal(vue(m.app, m.p, c.id).liens, 1);
  // un avis sans nouvelle charge (déjà lue) : rien n'est relu
  sim.reseau.canaux.at(-1)!.envoyer('avis', { connecteur: c.id, fournisseur: 'airtable' });
  await attendre(() => lectures.length === 3, 5000);
  await pause(200);
  assert.deepEqual(lectures.slice(2), ['charges:3']);
  // filet de sécurité : 30 minutes quand le temps réel vit (au lieu de 5)
  horloge += 10 * 60_000;
  await m.app.synchro.tick();
  assert.equal(lectures.filter((x) => x === 'lecture').length, 1, 'pas de relecture à 10 minutes');
  horloge += 25 * 60_000;
  await m.app.synchro.tick();
  assert.equal(lectures.filter((x) => x === 'lecture').length, 2, 'relu à 35 minutes');
  // renouvellement : moins de 2 jours avant l'expiration (repoussée de 7 jours par la lecture des charges)
  horloge += 6 * 86_400_000;
  await m.app.synchro.entretenirTempsReel();
  assert.ok(lectures.includes('rafraichir'));
  assert.equal(sim.abonnements.get(id)!.maj.at(-1).expire, new Date(horloge + 7 * 86_400_000).toISOString(), 'nouvelle fin donnée au réseau');
  // débranchement : webhook supprimé chez Airtable (jeton encore valable), puis abonnement du réseau, puis révocation
  const r = await m.app.synchro.supprimer(m.p, c.id);
  assert.equal(r.ok, true);
  const ordre = sim.appels.map((a) => `${a.methode} ${a.url.pathname}`).filter((x) => /webhooks\/achW|relais\/abonnements\/|oauth\/revoquer/.test(x)).filter((x) => !x.includes('payloads') && !x.includes('refresh') && !x.startsWith('PUT'));
  assert.deepEqual(ordre, [`DELETE /v0/bases/${BASE}/webhooks/achWWWWWWWWWWWWWW`, `DELETE /v0/relais/abonnements/${id}`, 'POST /v0/oauth/revoquer']);
  assert.equal(sim.abonnements.size, 0);
  m.app.tempsReel.arreter();
});

test('Microsoft : abonnement Graph au lecteur du classeur (clientState du réseau), avis sans changement du classeur → rien relu', async () => {
  const lien = 'https://kerlann.sharepoint.com/:x:/s/compta/classeur';
  let ctag = '"c:{AAA},1"';
  const graph: Appel[] = [];
  const sim = simulation((a) => {
    if (a.url.host !== 'graph.microsoft.com') return null;
    graph.push(a);
    if (a.url.pathname.startsWith('/v1.0/shares/')) return json({ id: 'ELEMENT1', parentReference: { driveId: 'b!LECTEUR' }, cTag: ctag, name: 'classeur.xlsx' });
    if (a.url.pathname === '/v1.0/subscriptions' && a.methode === 'POST') return json({ id: '7f105c7d-2dc5-4530-97cd-4e7ae6534c07', expirationDateTime: a.corps.expirationDateTime }, 201);
    if (a.url.pathname === '/v1.0/drives/b!LECTEUR/items/ELEMENT1') return json({ cTag: ctag });
    if (a.url.pathname.includes('/workbook/worksheets')) return a.url.pathname.endsWith('/worksheets') ? json({ value: [{ name: 'Feuil1' }] }) : json({ address: 'Feuil1!A1:A2', values: [['Nom'], ['Scierie']], text: [['Nom'], ['Scierie']] });
    return null;
  });
  const m = await monter(sim);
  const c = await brancher(m, sim, 'excel365', 'microsoft', { fichier: lien }, { Nom: '__nom' }, { acces: faux('ms', 'acces'), rafraichissement: faux('ms', 'rafr') });
  await m.app.synchro.entretenirTempsReel();
  const [, ab] = [...sim.abonnements.entries()][0]!;
  const sub = graph.find((a) => a.url.pathname === '/v1.0/subscriptions')!;
  assert.equal(sub.corps.resource, 'drives/b!LECTEUR/root', 'OneDrive professionnel : le dossier racine seulement');
  assert.equal(sub.corps.changeType, 'updated');
  assert.equal(sub.corps.clientState, ab.secret);
  assert.equal(sub.corps.notificationUrl, `${RESEAU}/v0/relais/evenements/microsoft/${ab.jeton}`);
  assert.ok(Date.parse(sub.corps.expirationDateTime) - Date.now() <= 42_300 * 60_000, 'sous la durée maximale de Microsoft');
  m.app.tempsReel.demarrer();
  await attendre(() => m.app.tempsReel.enLigne);
  const lus = () => graph.filter((a) => a.url.pathname.includes('usedRange')).length;
  sim.reseau.canaux.at(-1)!.envoyer('avis', { connecteur: c.id, fournisseur: 'microsoft' });
  await pause(REGROUPEMENT_MS + 300);
  assert.equal(lus(), 0, 'autre fichier du lecteur : le classeur n’a pas changé, rien n’est relu');
  ctag = '"c:{AAA},2"';
  sim.reseau.canaux.at(-1)!.envoyer('avis', { connecteur: c.id, fournisseur: 'microsoft' });
  await attendre(() => lus() === 1, 5000);
  m.app.tempsReel.arreter();
});

test('Notion et HubSpot : rien à créer chez l’outil, le jeu prouve la connexion par l’empreinte de son jeton de renouvellement', async () => {
  const sim = simulation(() => null);
  const m = await monter(sim);
  await brancher(m, sim, 'notion', 'notion', { base: '1f2e3d4c5b6a47898abcdef012345678' }, { Nom: '__nom' }, { acces: faux('nt', 'acces'), rafraichissement: faux('nt', 'rafr') });
  await m.app.synchro.entretenirTempsReel();
  const ab = [...sim.abonnements.values()][0]!;
  assert.equal(ab.empreinte, createHash('sha256').update(faux('nt', 'rafr')).digest('base64url'));
  assert.equal(JSON.stringify(sim.appels.filter((a) => a.url.pathname === '/v0/relais/abonnements').map((a) => a.corps)).includes(faux('nt', 'rafr')), false, 'le jeton lui-même ne part pas');
  assert.equal(ab.maj.length, 0);
  assert.equal(sim.appels.filter((a) => a.url.origin !== RESEAU).length, 0, 'aucun appel à Notion pour s’abonner');
  // connexion par clé (mode avancé) : relue à son intervalle, sans appel au réseau
  const avant = sim.abonnements.size;
  m.app.synchro.creer(m.p, { source: 'hubspot', config: { objet: 'companies', jeton: faux('pat', 'cle', 'hubspot') }, typeObjet: 'entreprise', roles: [], mapping: { name: '__nom' }, sens: 'lecture', intervalleS: 600, actif: true });
  await m.app.synchro.entretenirTempsReel();
  assert.equal(sim.abonnements.size, avant);
  const h = m.app.synchro.lister(m.p).find((x) => x.source === 'hubspot')!;
  assert.equal(h.frequence, 'Toutes les 10 minutes');
  assert.equal(h.tempsReel?.etat, 'indisponible');
});

test('sécurité : une adresse d’avis hors de Breizhcosystem est refusée (un avis d’outil peut porter des données)', async () => {
  const sim = simulation((a) => (a.url.host === 'api.airtable.com' ? json({ id: 'achWWWWWWWWWWWWWW', macSecretBase64: 'bWFjLXNlY3JldC1lc3NhaS0wMTIzNDU2Nzg5', expirationTime: null }) : null));
  sim.reseau.origineAvis = 'https://ailleurs.example';
  const m = await monter(sim);
  const c = await brancher(m, sim, 'airtable', 'airtable', { base: BASE, table: TABLE }, { Nom: '__nom' }, { acces: faux('at', 'acces') });
  await m.app.synchro.entretenirTempsReel();
  assert.equal(sim.appels.filter((a) => a.url.host === 'api.airtable.com').length, 0, 'rien n’est créé chez Airtable');
  assert.equal(sim.abonnements.size, 0, 'l’abonnement demandé est retiré');
  assert.equal(vue(m.app, m.p, c.id).tempsReel?.etat, 'erreur');
  assert.match(String(vue(m.app, m.p, c.id).tempsReel?.message), /refusé par sécurité/);
});

test('Google : canal d’un jour avec le jeton du réseau, rouvert avant la fin (nouveau canal, puis l’ancien arrêté) ; Pipedrive : webhook vérifié chaque jour', async () => {
  let horloge = Date.now();
  const drive: Appel[] = [];
  let webhooksPipedrive: string[] = [];
  const sim = simulation((a) => {
    if (a.url.host === 'www.googleapis.com') {
      drive.push(a);
      if (a.url.pathname.endsWith('/watch')) return json({ kind: 'api#channel', id: a.corps.id, resourceId: `ressource-${drive.length}`, expiration: a.corps.expiration });
      if (a.url.pathname === '/drive/v3/channels/stop') return new Response(null, { status: 204 });
    }
    if (a.url.host === 'societe.pipedrive.com') {
      if (a.methode === 'POST' && a.url.pathname === '/api/v1/webhooks') { const id = String(100 + webhooksPipedrive.length); webhooksPipedrive.push(id); return json({ success: true, data: { id: Number(id) } }); }
      if (a.methode === 'GET' && a.url.pathname === '/api/v1/webhooks') return json({ success: true, data: webhooksPipedrive.map((id) => ({ id: Number(id) })) });
    }
    return null;
  });
  const m = await monter(sim, () => new Date(horloge));
  await brancher(m, sim, 'sheets', 'google', { classeur: 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit' }, { Nom: '__nom' }, { acces: faux('g', 'acces'), rafraichissement: faux('g', 'rafr') });
  await m.app.synchro.entretenirTempsReel();
  const g = [...sim.abonnements.values()].find((x) => x.fournisseur === 'google')!;
  const w1 = drive[0]!;
  assert.equal(w1.url.pathname, '/drive/v3/files/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/watch');
  assert.deepEqual({ type: w1.corps.type, address: w1.corps.address, token: w1.corps.token }, { type: 'web_hook', address: `${RESEAU}/v0/relais/evenements/google/${g.jeton}`, token: g.secret });
  assert.ok(Number(w1.corps.expiration) - horloge <= 86_400_000, 'un jour au plus');
  horloge += 22 * 3600_000;
  await m.app.synchro.entretenirTempsReel();
  assert.deepEqual(drive.slice(1).map((a) => a.url.pathname.split('/').at(-1)), ['watch', 'stop']);
  assert.deepEqual(drive[2]!.corps, { id: w1.corps.id, resourceId: 'ressource-1' }, 'l’ancien canal est arrêté');
  assert.equal(g.maj.at(-1).externe, drive[1]!.corps.id, 'le réseau connaît le nouveau canal');

  // Pipedrive : authentification de base du réseau, objet du branchement ; disparu chez Pipedrive → recréé
  await brancher(m, sim, 'pipedrive', 'pipedrive', { objet: 'deals' }, { title: '__nom' }, { acces: faux('pd', 'acces'), rafraichissement: faux('pd', 'rafr'), extra: { api_domain: 'https://societe.pipedrive.com' } });
  await m.app.synchro.entretenirTempsReel();
  const pd = [...sim.abonnements.values()].find((x) => x.fournisseur === 'pipedrive')!;
  const creation = sim.appels.find((a) => a.url.host === 'societe.pipedrive.com' && a.methode === 'POST')!;
  assert.deepEqual(creation.corps, { subscription_url: `${RESEAU}/v0/relais/evenements/pipedrive/${pd.jeton}`, event_action: '*', event_object: 'deal', version: '2.0', http_auth_user: 'living-business', http_auth_password: pd.secret, name: 'Living Business' });
  assert.equal(creation.entetes.get('authorization'), `Bearer ${faux('pd', 'acces')}`);
  webhooksPipedrive = [];
  horloge += 25 * 3600_000;
  await m.app.synchro.entretenirTempsReel();
  assert.equal(sim.appels.filter((a) => a.url.host === 'societe.pipedrive.com' && a.methode === 'POST').length, 2, 'recréé après sa disparition');
});
