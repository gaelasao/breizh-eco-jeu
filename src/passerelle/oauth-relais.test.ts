/**
 * « Se connecter avec… » : relais de Breizhcosystem et outils simulés (`fetch` injecté), aucun appel réseau.
 * Vérifie le parcours complet (démarrer → attente → connecté → secret chiffré → lecture en Bearer → renouvellement
 * avec rotation → 401 → renouvelé une fois), les particularités de chaque outil, les refus, et que rien de secret
 * (jeton, secret d'attente) ne part vers le navigateur ni dans une adresse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { configAvecConnexion, enveloppe, lireEnveloppe, lireJetons } from './oauth-relais.ts';
import { ecrireFeuilleGoogle, idFeuilleGoogle, lireFeuilleGoogle, plageGoogle } from './sources-google.ts';
import { excel365 } from './sources-microsoft.ts';
import { sellsy } from './sources-metier-2.ts';
import { pipedrive } from './sources-metier.ts';

process.env.LB_AUTORISER_LOCAL = '1'; // Breizhcosystem simulé sur http://127.0.0.1 (ce fichier tourne dans son propre processus)

const RELAIS = 'http://127.0.0.1:4180';
const ATTENTE = 'A'.repeat(20) + 'b'.repeat(23);
const CK = `ck_${'a'.repeat(40)}`;
const CS = `cs_${'b'.repeat(40)}`;
const WOO = 'https://203.0.114.20/boutique';
const ID_FEUILLE = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
const dans = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const attendre = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json', ...entetes } });

interface Appel { url: URL; methode: string; entetes: Headers; corps: any }
interface Jetons { acces: string; rafraichissement?: string | null; expire?: string | null; portee?: string | null; extra?: Record<string, string> }

const PAGES: Record<string, (c: any) => string> = {
  hubspot: () => 'https://app.hubspot.com/oauth/authorize?client_id=hs&state=s1',
  google: () => 'https://accounts.google.com/o/oauth2/v2/auth?client_id=g&state=s1',
  microsoft: () => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=m&state=s1',
  notion: () => 'https://api.notion.com/v1/oauth/authorize?client_id=n&state=s1',
  airtable: () => 'https://airtable.com/oauth2/v1/authorize?client_id=a&state=s1',
  pipedrive: () => 'https://oauth.pipedrive.com/oauth/authorize?client_id=p&state=s1',
  sellsy: () => 'https://login.sellsy.com/oauth2/authorization?client_id=s&state=s1',
  shopify: (c) => `https://${c.boutique}/admin/oauth/authorize?client_id=sh&state=s1`,
  woocommerce: (c) => `${c.site}/wc-auth/v1/authorize?app_name=Living%20Business&user_id=s1`,
};

/** Breizhcosystem (relais) + outils simulés. `outil` répond aux appels vers les outils (null = 404). */
function simulation(outil: (a: Appel) => Response | null) {
  const appels: Appel[] = [];
  const relais = {
    fournisseurs: ['hubspot', 'google', 'microsoft', 'notion', 'airtable', 'pipedrive', 'sellsy', 'shopify', 'woocommerce'],
    demarrages: [] as any[],
    rafraichissements: [] as any[],
    revocations: [] as any[],
    /** Outils que le relais révoque lui-même, avec le secret de l'application. */
    revoqueChezOutil: ['pipedrive', 'notion', 'hubspot'],
    page: null as string | null,
    resultat: null as null | { statut: 'refuse'; message: string } | { statut: 'connecte'; fournisseur: string; jetons: Jetons } | 'expire',
    dureeSuivante: 3600,
    expiree: false,
    injoignable: false,
    accepter(fournisseur: string, jetons: Jetons) { this.resultat = { statut: 'connecte', fournisseur, jetons }; },
  };
  let n = 1;
  const f = (async (url: URL | string, init?: RequestInit) => {
    const brut = init?.body ? String(init.body) : null;
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: brut === null ? null : brut.startsWith('{') || brut.startsWith('[') ? JSON.parse(brut) : brut };
    appels.push(a);
    if (a.url.origin === RELAIS) {
      if (relais.injoignable) throw new TypeError('fetch failed');
      assert.ok(a.url.pathname.startsWith('/v0/oauth/'), 'seules les routes du relais sont appelées sur Breizhcosystem');
      assert.equal(a.entetes.get('authorization'), null, 'aucun compte Breizhcosystem');
      if (a.methode === 'POST') { assert.equal(a.entetes.get('x-nx-requete'), '1'); assert.equal(a.entetes.get('content-type'), 'application/json'); }
      switch (a.url.pathname) {
        case '/v0/oauth/fournisseurs': return json({ fournisseurs: relais.fournisseurs.map((id) => ({ id, nom: id, parametre: null })) });
        case '/v0/oauth/demarrer':
          relais.demarrages.push(a.corps);
          return json({ url: relais.page ?? PAGES[a.corps.fournisseur]?.(a.corps), attente: ATTENTE, expire: dans(600) });
        case '/v0/oauth/retrait': {
          if (a.corps.attente !== ATTENTE || relais.resultat === 'expire') return json({ erreur: 'introuvable', message: 'Connexion expirée.' }, 404);
          const r = relais.resultat;
          if (!r) return json({ statut: 'attente' });
          relais.resultat = 'expire'; // remis une seule fois
          return json(r);
        }
        case '/v0/oauth/revoquer':
          relais.revocations.push(a.corps);
          return json({ ok: true, chezOutil: a.corps.chezOutil !== false && relais.revoqueChezOutil.includes(a.corps.fournisseur) ? 'revoque' : 'a_retirer' });
        case '/v0/oauth/rafraichir':
          relais.rafraichissements.push(a.corps);
          if (relais.expiree) return json({ erreur: 'connexion_expiree', message: 'Connexion HubSpot expirée ou retirée : reconnectez-vous.' }, 401);
          n++;
          return json({ acces: `acces-${n}`, rafraichissement: `rafr-${n}`, expire: dans(relais.dureeSuivante), portee: null, extra: {} });
      }
      return json({ erreur: 'introuvable' }, 404);
    }
    return outil(a) ?? json({ erreur: 'introuvable' }, 404);
  }) as typeof fetch;
  return { f, appels, relais };
}

async function monter(f: typeof fetch, nexus: string | null = RELAIS) {
  const app = await Application.creer({ exemple: 'pme', fetch: f });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  app.monde.viderDemo(p, 's', { nom: 'Test' });
  if (nexus) await app.nexus.reglerAdresse(nexus);
  return { app, p };
}

/** Connexion complète, la personne ayant déjà accepté chez l'outil : renvoie la référence « oauth:… ». */
async function connecter(app: Application, p: NonNullable<ReturnType<Application['monde']['profil']>>, sim: ReturnType<typeof simulation>, source: string, fournisseur: string, jetons: Jetons, config: Record<string, string> = {}, droits: 'lecture' | 'ecriture' = 'lecture') {
  const d = await app.synchro.demarrerOAuth(p, { source, config, droits });
  sim.relais.accepter(fournisseur, { rafraichissement: null, expire: null, portee: null, extra: {}, ...jetons });
  const r = await app.synchro.suivreOAuth(p, d.id);
  assert.equal(r.statut, 'connecte');
  return (r as { jeton: string }).jeton;
}

const rienDeSecret = (appels: Appel[], secrets: string[]) => {
  for (const a of appels) for (const s of [ATTENTE, ...secrets]) assert.ok(!a.url.href.includes(s), `secret dans l’adresse : ${a.url.href}`);
};

// ---------------------------------------------------------------- parcours complet (HubSpot)

test('« Se connecter avec HubSpot » : attente → connecté → jeton chiffré côté serveur → Bearer → renouvellement avec rotation → 401 → renouvelé une fois', async () => {
  const lectures: string[] = [];
  let refuser: (auth: string) => boolean = () => false;
  const sim = simulation((a) => {
    if (a.url.host !== 'api.hubapi.com') return null;
    const auth = a.entetes.get('authorization') ?? '';
    if (refuser(auth)) return json({ status: 'error', category: 'EXPIRED_AUTHENTICATION' }, 401);
    lectures.push(auth);
    return json({ results: [{ id: '101', properties: { name: 'Cave du Port', city: 'Brest' } }] });
  });
  const { app, p } = await monter(sim.f);
  // catalogue : HubSpot en « 1 clic », Odoo garde sa clé, MCP rangé dans « Avancé »
  const cat = await app.synchro.catalogue();
  assert.deepEqual(cat.find((x) => x.id === 'hubspot')?.oauth, { fournisseur: 'hubspot', nom: 'HubSpot', champ: null });
  assert.deepEqual(cat.find((x) => x.id === 'shopify')?.oauth, { fournisseur: 'shopify', nom: 'Shopify', champ: 'boutique' });
  assert.equal(cat.find((x) => x.id === 'odoo')?.oauth, null);
  assert.deepEqual(cat.filter((x) => x.avance).map((x) => x.id).sort(), ['mcp', 'rest', 'webhook']);

  const d = await app.synchro.demarrerOAuth(p, { source: 'hubspot', config: { objet: 'companies', jeton: 'ignoré' } }, 'http://127.0.0.1:4173');
  assert.equal(new URL(d.url).host, 'app.hubspot.com', 'page de connexion DE L’OUTIL');
  assert.match(d.id, /^[A-Za-z0-9_-]{22}$/);
  assert.ok(!JSON.stringify(d).includes(ATTENTE), 'secret d’attente jamais renvoyé au navigateur');
  assert.deepEqual(sim.relais.demarrages.at(-1), { fournisseur: 'hubspot', retour: 'http://127.0.0.1:4173', codeAffiche: true, droits: 'lecture' }, 'le jeu déclare afficher le code de la demande, et ne demande que la lecture');
  assert.deepEqual(await app.synchro.suivreOAuth(p, d.id), { statut: 'attente' });
  await assert.rejects(app.synchro.apercu(p, { source: 'hubspot', config: { objet: 'companies', jeton: `oauth:${d.id}` }, typeObjet: 'entreprise' }), /Connectez-vous d’abord/);
  sim.relais.accepter('hubspot', { acces: 'acces-1', rafraichissement: 'rafr-1', expire: dans(3600), portee: 'crm', extra: { hub_domain: 'kerlann.hubspot.com', hub_id: '4242' } });
  await attendre(1600); // suivi espacé (1,5 s) pour ne pas solliciter le relais
  const r = await app.synchro.suivreOAuth(p, d.id);
  assert.deepEqual(r, { statut: 'connecte', jeton: `oauth:${d.id}`, nom: 'HubSpot', compte: 'kerlann.hubspot.com' }, 'le navigateur ne reçoit qu’une référence');
  await assert.rejects(app.synchro.apercu(p, { source: 'notion', config: { base: '0123456789abcdef0123456789abcdef', jeton: r.jeton }, typeObjet: 'entreprise' }), /Connectez-vous d’abord/, 'référence liée à son outil');

  const ap = await app.synchro.apercu(p, { source: 'hubspot', config: { objet: 'companies', jeton: r.jeton }, typeObjet: 'entreprise' });
  assert.equal(ap.enregistrements, 1);
  const c = app.synchro.creer(p, { source: 'hubspot', config: { objet: 'companies', jeton: r.jeton }, typeObjet: 'entreprise', roles: ['client'], mapping: { name: '__nom', city: 'ville' }, sens: 'lecture', intervalleS: 300 });
  assert.equal(c.oauth, 'hubspot');
  await assert.rejects(app.synchro.suivreOAuth(p, d.id), /expirée/, 'référence à usage unique');
  const etat = () => JSON.stringify(app.synchro.instantane());
  for (const x of ['acces-1', 'rafr-1', ATTENTE, 'oauth', 'kerlann.hubspot.com']) assert.ok(!etat().includes(x), `${x} jamais en clair dans l’état enregistré`);
  assert.ok(!JSON.stringify(app.synchro.lister(p)).includes('acces-1'));

  await app.synchro.synchroniser(c.id, p);
  assert.ok(app.monde.objetsReels().some((o) => o.nom === 'Cave du Port'));
  assert.equal(lectures.at(-1), 'Bearer acces-1');
  assert.equal(sim.relais.rafraichissements.length, 0, 'jeton encore valable : aucun renouvellement');

  // l'outil refuse le jeton (retiré plus tôt que prévu) : renouvelé UNE fois, puis l'appel réussit
  refuser = (auth) => auth === 'Bearer acces-1';
  sim.relais.dureeSuivante = 60; // le nouveau jeton expire dans 1 minute
  let v = await app.synchro.synchroniser(c.id, p);
  assert.equal(v.statut, 'ok', v.message ?? '');
  assert.deepEqual(sim.relais.rafraichissements, [{ fournisseur: 'hubspot', rafraichissement: 'rafr-1', droits: 'lecture' }], 'renouvelé avec les mêmes droits (lecture seule)');
  assert.equal(lectures.at(-1), 'Bearer acces-2');
  // expire dans moins de 2 minutes : renouvelé AVANT l'appel, avec le jeton de rafraîchissement enregistré (rotation)
  sim.relais.dureeSuivante = 3600;
  v = await app.synchro.synchroniser(c.id, p);
  assert.equal(v.statut, 'ok');
  assert.equal(sim.relais.rafraichissements.at(-1)?.rafraichissement, 'rafr-2', 'rotation enregistrée');
  assert.equal(lectures.at(-1), 'Bearer acces-3');
  for (const x of ['acces-2', 'rafr-2', 'acces-3', 'rafr-3']) assert.ok(!etat().includes(x), `${x} jamais en clair`);

  // refus persistant : un seul renouvellement, puis erreur lisible
  refuser = () => true;
  const avant = sim.relais.rafraichissements.length;
  v = await app.synchro.synchroniser(c.id, p);
  assert.equal(v.statut, 'erreur');
  assert.equal(sim.relais.rafraichissements.length, avant + 1, 'renouvelé une seule fois');
  // connexion retirée chez l'outil : le relais répond « connexion_expiree » → reconnecter
  sim.relais.expiree = true;
  v = await app.synchro.synchroniser(c.id, p);
  assert.equal(v.statut, 'erreur');
  assert.match(v.message ?? '', /expirée ou retirée : reconnectez-vous/);
  // « Se reconnecter » : nouvelle connexion reprise par le même connecteur (liens et correspondance gardés)
  sim.relais.expiree = false;
  refuser = (auth) => auth !== 'Bearer acces-neuf';
  const neuf = await connecter(app, p, sim, 'hubspot', 'hubspot', { acces: 'acces-neuf', rafraichissement: 'rafr-neuf', expire: dans(3600) });
  assert.equal(app.synchro.modifier(p, c.id, { config: { jeton: neuf } }).oauth, 'hubspot');
  v = await app.synchro.synchroniser(c.id, p);
  assert.equal(v.statut, 'ok', v.message ?? '');
  assert.equal(lectures.at(-1), 'Bearer acces-neuf');
  await assert.rejects(app.synchro.suivreOAuth(p, neuf.slice(6)), /expirée/, 'référence consommée');
  assert.ok(!etat().includes('acces-neuf'));
  rienDeSecret(sim.appels, ['acces-', 'rafr-']);
});

// ---------------------------------------------------------------- refus, expiration, réponses du relais relues

test('refus, expiration, page de connexion inattendue, jetons illisibles, Breizhcosystem absent ou injoignable', async () => {
  const sim = simulation(() => null);
  const { app, p } = await monter(sim.f);
  // refusé chez l'outil
  let d = await app.synchro.demarrerOAuth(p, { source: 'hubspot', config: {} });
  sim.relais.resultat = { statut: 'refuse', message: 'Connexion refusée dans HubSpot.' };
  assert.deepEqual(await app.synchro.suivreOAuth(p, d.id), { statut: 'refuse', message: 'Connexion refusée dans HubSpot.' });
  await assert.rejects(app.synchro.suivreOAuth(p, d.id), /expirée/);
  // expirée chez le relais (10 min)
  d = await app.synchro.demarrerOAuth(p, { source: 'hubspot', config: {} });
  sim.relais.resultat = 'expire';
  const e = await app.synchro.suivreOAuth(p, d.id);
  assert.equal(e.statut, 'expire');
  assert.match((e as { message: string }).message, /expiré.*Se connecter avec HubSpot/);
  // page de connexion sur un autre hôte que celui de l'outil : refusée (hameçonnage)
  sim.relais.page = 'https://app.hubspot.com.evil.example/oauth/authorize';
  await assert.rejects(app.synchro.demarrerOAuth(p, { source: 'hubspot', config: {} }), /inattendue/);
  sim.relais.page = 'http://app.hubspot.com/oauth/authorize';
  await assert.rejects(app.synchro.demarrerOAuth(p, { source: 'hubspot', config: {} }), /inattendue/);
  sim.relais.page = null;
  // jetons illisibles (caractères de contrôle, mauvais outil) : rien d'enregistré
  d = await app.synchro.demarrerOAuth(p, { source: 'hubspot', config: {} });
  sim.relais.accepter('hubspot', { acces: 'acces\r\nX-Injecte: 1' });
  await assert.rejects(app.synchro.suivreOAuth(p, d.id), /jeton utilisable/);
  d = await app.synchro.demarrerOAuth(p, { source: 'hubspot', config: {} });
  sim.relais.accepter('google', { acces: 'acces-google' });
  await assert.rejects(app.synchro.suivreOAuth(p, d.id), /inattendue/);
  // outil non ouvert par l'éditeur : le catalogue le sait d'avance, donc aucun bouton « 1 clic » ne mène à un refus
  sim.relais.fournisseurs = ['hubspot'];
  const autre = await monter(sim.f);
  assert.equal((await autre.app.synchro.catalogue()).find((x) => x.id === 'notion')?.oauth, null, 'pas ouvert : jamais proposé en un clic');
  assert.ok((await autre.app.synchro.catalogue()).find((x) => x.id === 'hubspot')?.oauth, 'ouvert : proposé');
  await assert.rejects(autre.app.synchro.demarrerOAuth(autre.p, { source: 'notion', config: {} }), /mode avancé/);
  await assert.rejects(autre.app.synchro.demarrerOAuth(autre.p, { source: 'odoo', config: {} }), /mode avancé/);
  // Breizhcosystem non réglé : catalogue sans « Se connecter avec… », la clé reste proposée
  const sans = await monter(sim.f, null);
  assert.ok((await sans.app.synchro.catalogue()).every((x) => x.oauth === null));
  await assert.rejects(sans.app.synchro.demarrerOAuth(sans.p, { source: 'hubspot', config: {} }), /mode avancé/);
  // panne passagère APRÈS une lecture réussie : les boutons déjà connus restent
  sim.relais.injoignable = true;
  assert.ok((await autre.app.synchro.catalogue()).find((x) => x.id === 'hubspot')?.oauth, 'une panne passagère ne retire pas les boutons');
  // relais jamais lu (panne dès le départ) : rien en un clic, donc rien qui mène à un refus
  const coupe = await monter(sim.f);
  await assert.rejects(coupe.app.synchro.demarrerOAuth(coupe.p, { source: 'hubspot', config: {} }), /mode avancé/);
  assert.ok((await coupe.app.synchro.catalogue()).every((x) => x.oauth === null), 'relais jamais lu : rien en un clic');
  sim.relais.injoignable = false;
  // un secret collé qui imite une connexion par le relais est refusé ; une clé collée marche comme avant (mode avancé)
  await assert.rejects(app.synchro.apercu(p, { source: 'hubspot', config: { objet: 'companies', jeton: '{"oauth":{"fournisseur":"hubspot","acces":"x"}}' }, typeObjet: 'entreprise' }), /Jeton invalide/);
  // droits : administrateur seulement
  const yann = { ...p, id: 'responsable-stock', peutAdministrer: false };
  await assert.rejects(app.synchro.demarrerOAuth(yann, { source: 'hubspot', config: {} }), (x: any) => x.statut === 403);
  await assert.rejects(app.synchro.suivreOAuth(yann, d.id), (x: any) => x.statut === 403);
  await assert.rejects(app.synchro.choix(yann, { source: 'airtable', champ: 'base', config: {} }), (x: any) => x.statut === 403);
});

test('clé collée (mode avancé) : inchangée, aucun appel au relais', async () => {
  const sim = simulation((a) => (a.url.host === 'api.hubapi.com' ? json({ results: [{ id: '7', properties: { name: 'Ty Coz' } }] }) : null));
  const { app, p } = await monter(sim.f);
  const ap = await app.synchro.apercu(p, { source: 'hubspot', config: { objet: 'companies', jeton: 'pat-eu1-collee' }, typeObjet: 'entreprise' });
  assert.equal(ap.enregistrements, 1);
  const hub = sim.appels.filter((a) => a.url.host === 'api.hubapi.com');
  assert.equal(hub[0]?.entetes.get('authorization'), 'Bearer pat-eu1-collee');
  assert.equal(sim.appels.filter((a) => a.url.pathname === '/v0/oauth/rafraichir').length, 0);
  const c = app.synchro.creer(p, { source: 'hubspot', config: { objet: 'companies', jeton: 'pat-eu1-collee' }, typeObjet: 'entreprise', roles: [], mapping: { name: '__nom' }, sens: 'lecture', intervalleS: 300 });
  assert.equal(c.oauth, null);
});

// ---------------------------------------------------------------- particularités de chaque outil

test('Pipedrive : adresse de l’API du compte (api_domain) et jeton en Bearer ; domaine étranger ignoré', async () => {
  const sim = simulation((a) => (a.url.host.endsWith('.pipedrive.com') ? json({ data: [{ id: 1, name: 'Kerlann SARL' }], additional_data: { next_cursor: null } }) : null));
  const { app, p } = await monter(sim.f);
  const jeton = await connecter(app, p, sim, 'pipedrive', 'pipedrive', { acces: 'pd-acces', rafraichissement: 'pd-rafr', expire: dans(3600), extra: { api_domain: 'https://kerlann.pipedrive.com' } }, {}, 'ecriture');
  const ap = await app.synchro.apercu(p, { source: 'pipedrive', config: { objet: 'organizations', jeton }, typeObjet: 'entreprise' });
  assert.equal(ap.enregistrements, 1);
  const a = sim.appels.find((x) => x.url.host.endsWith('.pipedrive.com'));
  assert.equal(a?.url.href, 'https://kerlann.pipedrive.com/api/v2/organizations?limit=500');
  assert.equal(a?.entetes.get('authorization'), 'Bearer pd-acces');
  assert.equal(a?.entetes.get('x-api-token'), null);
  // créé sans domaine ni jeton d'API (champs du mode avancé)
  const c = app.synchro.creer(p, { source: 'pipedrive', config: { objet: 'organizations', jeton }, typeObjet: 'entreprise', roles: [], mapping: { name: '__nom' }, sens: 'deux', intervalleS: 300 });
  assert.equal(c.oauth, 'pipedrive');
  // une adresse d'API hors pipedrive.com venue du relais n'est jamais utilisée
  assert.equal(lireJetons('pipedrive', { acces: 'x', extra: { api_domain: 'https://evil.example' } })?.extra.api_domain, undefined);
  // mode avancé : jeton d'API personnel en x-api-token, comme avant
  const cle = simulation(() => json({ data: [] }));
  await pipedrive.lire({ objet: 'persons' }, 'pd-perso', cle.f);
  assert.equal(cle.appels[0]?.entetes.get('x-api-token'), 'pd-perso');
});

test('Shopify : boutique en .myshopify.com exigée, jeton dans X-Shopify-Access-Token, sans échange de secret', async () => {
  const sim = simulation((a) => {
    if (!a.url.host.endsWith('.myshopify.com')) return null;
    assert.ok(!a.url.pathname.includes('/oauth/'), 'pas d’échange « client credentials »');
    return json({ data: { customers: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'gid://shopify/Customer/1', displayName: 'Anne Le Bihan' }] } } });
  });
  const { app, p } = await monter(sim.f);
  await assert.rejects(app.synchro.demarrerOAuth(p, { source: 'shopify', config: { boutique: 'evil.example' } }), /myshopify\.com/);
  await assert.rejects(app.synchro.demarrerOAuth(p, { source: 'shopify', config: {} }), /myshopify\.com/);
  const jeton = await connecter(app, p, sim, 'shopify', 'shopify', { acces: 'shpat_oauth123', extra: { boutique: 'ma-boutique.myshopify.com' } }, { boutique: 'https://Ma-Boutique.myshopify.com/admin' });
  assert.equal(sim.relais.demarrages.at(-1)?.boutique, 'ma-boutique.myshopify.com');
  const ap = await app.synchro.apercu(p, { source: 'shopify', config: { objet: 'customers', boutique: 'ma-boutique.myshopify.com', clientId: 'ignore-en-oauth', jeton }, typeObjet: 'entreprise' });
  assert.equal(ap.enregistrements, 1);
  const a = sim.appels.find((x) => x.url.host === 'ma-boutique.myshopify.com');
  assert.equal(a?.entetes.get('x-shopify-access-token'), 'shpat_oauth123');
  // la page de connexion doit être celle de la boutique demandée
  sim.relais.page = 'https://autre-boutique.myshopify.com/admin/oauth/authorize';
  await assert.rejects(app.synchro.demarrerOAuth(p, { source: 'shopify', config: { boutique: 'ma-boutique' } }), /inattendue/);
});

test('WooCommerce : site vérifié (anti-SSRF), clés ck_/cs_ remises par le relais, aucune clé à saisir', async () => {
  const sim = simulation((a) => (a.url.origin === 'https://203.0.114.20' ? json([{ id: 5, first_name: 'Anne', last_name: 'Le Bihan', email: 'anne@exemple.test' }]) : null));
  const { app, p } = await monter(sim.f);
  for (const site of ['http://203.0.114.20', 'https://10.0.0.5', 'https://192.168.1.10', '']) await assert.rejects(app.synchro.demarrerOAuth(p, { source: 'woocommerce', config: { boutique: site } }), /WooCommerce/, site);
  const jeton = await connecter(app, p, sim, 'woocommerce', 'woocommerce', { acces: CS, portee: 'read_write', extra: { cleClient: CK, site: WOO } }, { boutique: `${WOO}/wp-admin/` });
  assert.equal(sim.relais.demarrages.at(-1)?.site, WOO, 'adresse du site nettoyée');
  const ap = await app.synchro.apercu(p, { source: 'woocommerce', config: { objet: 'customers', boutique: WOO, jeton }, typeObjet: 'entreprise' });
  assert.equal(ap.enregistrements, 1);
  const a = sim.appels.find((x) => x.url.origin === 'https://203.0.114.20');
  assert.equal(a?.url.pathname, '/boutique/wp-json/wc/v3/customers');
  assert.equal(a?.entetes.get('authorization'), `Basic ${Buffer.from(`${CK}:${CS}`).toString('base64')}`);
  const c = app.synchro.creer(p, { source: 'woocommerce', config: { objet: 'customers', boutique: WOO, jeton }, typeObjet: 'entreprise', roles: [], mapping: { nom_complet: '__nom' }, sens: 'lecture', intervalleS: 300 });
  assert.equal(c.oauth, 'woocommerce');
  assert.ok(!JSON.stringify(app.synchro.instantane()).includes(CK.slice(3)), 'clés jamais en clair');
  // jetons WooCommerce incomplets (sans clé client) refusés
  assert.equal(lireJetons('woocommerce', { acces: CS, extra: { site: WOO } }), null);
});

test('Sellsy et Excel 365 : jeton du relais utilisé directement (ni « client credentials », ni annuaire Microsoft)', async () => {
  const s = simulation((a) => {
    assert.notEqual(a.url.host, 'login.sellsy.com');
    return json({ data: [{ id: 12, name: 'Ty Coz SARL' }], pagination: { offset: null } });
  });
  const lus = await sellsy.lire(configAvecConnexion({ objet: 'clients' }, { fournisseur: 'sellsy', acces: 'sellsy-oauth', rafraichissement: 'r', expire: null, extra: {} }), 'sellsy-oauth', s.f);
  assert.equal(lus.length, 1);
  assert.equal(s.appels[0]?.entetes.get('authorization'), 'Bearer sellsy-oauth');

  const LIEN = 'https://kerlann.sharepoint.com/:x:/s/compta/EabcDEF123?e=xyz';
  const graph = (a: Appel): Response | null => {
    if (a.url.host !== 'graph.microsoft.com') return null;
    assert.equal(a.entetes.get('authorization'), 'Bearer graph-acces');
    const chemin = decodeURIComponent(a.url.pathname);
    if (chemin.startsWith('/v1.0/shares/u!')) return json({ id: 'ITEM1', parentReference: { driveId: 'b!DRIVE' } });
    if (chemin.endsWith('/worksheets')) return json({ value: [{ name: 'Clients' }] });
    return json({ address: 'Clients!A1:B2', values: [['Nom', 'Ville'], ['Cave du Port', 'Brest']], text: [['Nom', 'Ville'], ['Cave du Port', 'Brest']] });
  };
  const g = simulation(graph);
  const cfg = configAvecConnexion({ fichier: LIEN }, { fournisseur: 'microsoft', acces: 'graph-acces', rafraichissement: 'r', expire: null, extra: {} });
  assert.deepEqual((await excel365.lire(cfg, 'graph-acces', g.f)).map((l) => l.champs.Nom), ['Cave du Port']);
  assert.ok(g.appels.every((a) => a.url.host === 'graph.microsoft.com'), 'aucun appel à login.microsoftonline.com');
  // par la synchro : branché sans annuaire ni application (champs du mode avancé)
  const sim = simulation(graph);
  const { app, p } = await monter(sim.f);
  const jeton = await connecter(app, p, sim, 'excel365', 'microsoft', { acces: 'graph-acces', rafraichissement: 'ms-rafr', expire: dans(3600) });
  assert.throws(() => app.synchro.creer(p, { source: 'excel365', config: { jeton }, typeObjet: 'entreprise', roles: [], mapping: { Nom: '__nom' }, sens: 'lecture', intervalleS: 300 }), /Classeur/);
  const c = app.synchro.creer(p, { source: 'excel365', config: { fichier: LIEN, jeton }, typeObjet: 'entreprise', roles: [], mapping: { Nom: '__nom' }, sens: 'lecture', intervalleS: 300 });
  const v = await app.synchro.synchroniser(c.id, p);
  assert.equal(v.statut, 'ok', v.message ?? '');
  assert.ok(app.monde.objetsReels().some((o) => o.nom === 'Cave du Port'));
  assert.ok(!sim.appels.some((a) => a.url.host === 'login.microsoftonline.com'));
});

// ---------------------------------------------------------------- Google Sheets par l'API Sheets

function sheetsSimule(feuille: string[][], onglet = 'Clients') {
  return simulation((a) => {
    if (a.url.host !== 'sheets.googleapis.com') return null;
    assert.equal(a.entetes.get('authorization'), 'Bearer g-acces');
    const chemin = decodeURIComponent(a.url.pathname);
    if (chemin === `/v4/spreadsheets/${ID_FEUILLE}`) return json({ sheets: [{ properties: { title: onglet } }, { properties: { title: 'Autre' } }] });
    if (a.methode === 'GET' && chemin === `/v4/spreadsheets/${ID_FEUILLE}/values/${plageGoogle(onglet)}`) return json({ range: `'${onglet}'!A1:Z1000`, majorDimension: 'ROWS', values: feuille });
    if (a.methode === 'PUT' || chemin.endsWith(':append')) return json({ updatedRows: 1 });
    return null;
  });
}

test('Google Sheets (API) : lien de la feuille, lecture, mise à jour des seules cellules synchronisées, ajout de ligne', async () => {
  assert.equal(idFeuilleGoogle(`https://docs.google.com/spreadsheets/d/${ID_FEUILLE}/edit#gid=0`), ID_FEUILLE);
  assert.equal(idFeuilleGoogle(ID_FEUILLE), ID_FEUILLE);
  for (const faux of ['https://evil.example/spreadsheets/d/' + ID_FEUILLE, `http://docs.google.com/spreadsheets/d/${ID_FEUILLE}`, 'https://docs.google.com/spreadsheets/d/e/2PACX-1vT/pubhtml', 'pas un lien']) assert.throws(() => idFeuilleGoogle(faux), /feuille/, faux);
  assert.equal(plageGoogle("L'atelier", 'A1:B2'), "'L''atelier'!A1:B2");

  const feuille = [['Référence', 'Nom', 'Ville', 'Total (formule)'], ['C-1', 'Cave du Port', 'Brest', '120'], ['C-2', 'Hôtel Ty Mad', 'Douarnenez', '80']];
  const { f, appels } = sheetsSimule(feuille);
  const cfg = configAvecConnexion({ classeur: `https://docs.google.com/spreadsheets/d/${ID_FEUILLE}/edit`, colonneId: 'Référence' }, { fournisseur: 'google', acces: 'g-acces', rafraichissement: 'g-r', expire: null, extra: {} });
  const lus = await lireFeuilleGoogle(cfg, 'g-acces', f);
  assert.deepEqual(lus.map((l) => [l.externeId, l.champs.Nom]), [['C-1', 'Cave du Port'], ['C-2', 'Hôtel Ty Mad']]);
  assert.equal(appels[0]?.url.searchParams.get('fields'), 'sheets.properties.title', 'premier onglet par défaut');

  // mise à jour : seule la plage Nom..Ville de la ligne 3, la formule (colonne D) n'est pas envoyée
  assert.equal(await ecrireFeuilleGoogle(cfg, 'g-acces', 'C-2', { Ville: 'Quimper', Nom: '=IMPORTXML("https://evil.example")' }, f), 'C-2');
  const put = appels.find((a) => a.methode === 'PUT');
  assert.equal(decodeURIComponent(put?.url.pathname ?? ''), `/v4/spreadsheets/${ID_FEUILLE}/values/'Clients'!B3:C3`);
  assert.equal(put?.url.searchParams.get('valueInputOption'), 'USER_ENTERED');
  assert.deepEqual(put?.corps.values, [['\'=IMPORTXML("https://evil.example")', 'Quimper']], 'texte « =… » écrit comme texte, jamais comme formule');
  // création : ajoutée après le tableau, colonnes non synchronisées vides
  assert.equal(await ecrireFeuilleGoogle(cfg, 'g-acces', null, { Référence: 'C-3', Nom: 'Ferme de Kerroc’h' }, f), 'C-3');
  const ajout = appels.find((a) => decodeURIComponent(a.url.pathname).endsWith(':append'));
  assert.equal(decodeURIComponent(ajout?.url.pathname ?? ''), `/v4/spreadsheets/${ID_FEUILLE}/values/'Clients':append`);
  assert.equal(ajout?.url.searchParams.get('insertDataOption'), 'INSERT_ROWS');
  assert.deepEqual(ajout?.corps.values, [['C-3', 'Ferme de Kerroc’h', '', '']]);
  for (const a of appels) assert.ok(!a.url.href.includes('g-acces'), 'jeton jamais dans une adresse');

  // par la synchro : « Se connecter avec Google », puis lien de la feuille ; le script n'est plus demandé
  const sim = sheetsSimule(feuille);
  const { app, p } = await monter(sim.f);
  const jeton = await connecter(app, p, sim, 'sheets', 'google', { acces: 'g-acces', rafraichissement: 'g-rafr', expire: dans(3600) });
  const ap = await app.synchro.apercu(p, { source: 'sheets', config: { classeur: `https://docs.google.com/spreadsheets/d/${ID_FEUILLE}/edit`, colonneId: 'Référence', jeton }, typeObjet: 'entreprise' });
  assert.deepEqual(ap.champs, ['Référence', 'Nom', 'Ville', 'Total (formule)']);
  assert.throws(() => app.synchro.creer(p, { source: 'sheets', config: { colonneId: 'Référence', jeton }, typeObjet: 'entreprise', roles: [], mapping: { Nom: '__nom' }, sens: 'lecture', intervalleS: 300 }), /Lien de la feuille/);
});

// ---------------------------------------------------------------- listes à choisir après connexion

test('Airtable et Notion : bases, tables et bases de données proposées en liste après la connexion', async () => {
  const sim = simulation((a) => {
    if (a.url.host === 'api.airtable.com') {
      assert.equal(a.entetes.get('authorization'), 'Bearer at-acces');
      if (a.url.pathname === '/v0/meta/bases') return json(a.url.searchParams.get('offset') ? { bases: [{ id: 'appBBBBBBBBBBBBBB', name: 'Stock' }] } : { bases: [{ id: 'appAAAAAAAAAAAAAA', name: 'CRM Kerlann' }, { id: '../../evil', name: 'X' }], offset: 'page2' });
      if (a.url.pathname === '/v0/meta/bases/appAAAAAAAAAAAAAA/tables') return json({ tables: [{ id: 'tblCCCCCCCCCCCCCC', name: 'Clients\u0000' }, { id: 'pas-une-table', name: 'Y' }] });
    }
    if (a.url.host === 'api.notion.com') {
      assert.equal(a.entetes.get('authorization'), 'Bearer nt-acces');
      // version 2026-03-11 : la recherche renvoie les tableaux (« sources de données »), plus les bases
      assert.equal(a.entetes.get('notion-version'), '2026-03-11');
      if (a.url.pathname === '/v1/search') {
        assert.deepEqual(a.corps.filter, { property: 'object', value: 'data_source' });
        return json({ results: [{ object: 'data_source', id: '1f2e3d4c-5b6a-4789-8abc-def012345678', title: [{ plain_text: 'Fournisseurs ' }, { plain_text: 'Bretagne' }] }, { object: 'page', id: 'x' }], has_more: false });
      }
    }
    return null;
  });
  const { app, p } = await monter(sim.f);
  const at = await connecter(app, p, sim, 'airtable', 'airtable', { acces: 'at-acces', rafraichissement: 'at-r', expire: dans(3600) });
  assert.deepEqual((await app.synchro.choix(p, { source: 'airtable', champ: 'base', config: { jeton: at } })).options, [{ valeur: 'appAAAAAAAAAAAAAA', libelle: 'CRM Kerlann' }, { valeur: 'appBBBBBBBBBBBBBB', libelle: 'Stock' }]);
  assert.deepEqual((await app.synchro.choix(p, { source: 'airtable', champ: 'table', config: { jeton: at, base: 'appAAAAAAAAAAAAAA' } })).options, [{ valeur: 'tblCCCCCCCCCCCCCC', libelle: 'Clients' }]);
  await assert.rejects(app.synchro.choix(p, { source: 'airtable', champ: 'table', config: { jeton: at } }), /base/);
  await assert.rejects(app.synchro.choix(p, { source: 'airtable', champ: 'vue', config: { jeton: at } }), /champ_invalide/);
  const nt = await connecter(app, p, sim, 'notion', 'notion', { acces: 'nt-acces', extra: { workspace_name: 'Kerlann', bot_id: 'b' } });
  assert.deepEqual((await app.synchro.choix(p, { source: 'notion', champ: 'base', config: { jeton: nt } })).options, [{ valeur: 'source:1f2e3d4c5b6a47898abcdef012345678', libelle: 'Fournisseurs Bretagne' }]);
  rienDeSecret(sim.appels, ['at-acces', 'nt-acces']);
});

// ---------------------------------------------------------------- secret enregistré, routes HTTP

test('secret enregistré : enveloppe relue avec ses seules informations connues ; routes HTTP réservées à l’administrateur', async () => {
  const s = enveloppe({ fournisseur: 'notion', acces: 'secret_x', rafraichissement: null, expire: null, extra: { workspace_name: 'Kerlann' } });
  assert.ok(s.startsWith('{"oauth":'));
  assert.deepEqual(lireEnveloppe(s)?.extra, { workspace_name: 'Kerlann' });
  assert.equal(lireEnveloppe('pat-colle'), null);
  assert.equal(lireEnveloppe('{"oauth":{"fournisseur":"inconnu","acces":"x"}}'), null);

  const sim = simulation(() => null);
  const app = await Application.creer({ exemple: 'pme', fetch: sim.f });
  await app.nexus.reglerAdresse(RELAIS);
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  try {
    const session = async (profilId: string) => {
      const r = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId }) });
      return (r.headers.get('set-cookie') ?? '').split(';')[0] as string;
    };
    const appel = async (cookie: string, methode: string, chemin: string, corps?: unknown) => {
      const r = await fetch(`${base}/api/v1${chemin}`, { method: methode, headers: { cookie, ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}) }, body: corps === undefined ? null : JSON.stringify(corps) });
      const texte = await r.text();
      return { statut: r.status, texte, json: JSON.parse(texte || 'null') };
    };
    const anna = await session('dirigeante');
    const sources = await appel(anna, 'GET', '/sources');
    assert.equal(sources.json.find((x: any) => x.id === 'sheets').oauth.nom, 'Google');
    const d = await appel(anna, 'POST', '/synchro/oauth/demarrer', { source: 'hubspot', config: {} });
    assert.equal(d.statut, 200);
    assert.deepEqual(Object.keys(d.json).sort(), ['fournisseur', 'id', 'nom', 'url', 'verification']);
    assert.ok(!d.texte.includes(ATTENTE));
    assert.equal(sim.relais.demarrages.at(-1)?.retour, base, 'retour vers le jeu, déduit par le serveur');
    assert.deepEqual((await appel(anna, 'POST', `/synchro/oauth/${d.json.id}`)).json, { statut: 'attente' });
    const yann = await session('responsable-stock');
    assert.equal((await appel(yann, 'POST', '/synchro/oauth/demarrer', { source: 'hubspot', config: {} })).statut, 403);
    assert.equal((await appel(yann, 'POST', `/synchro/oauth/${d.json.id}`)).statut, 403);
    assert.equal((await appel(yann, 'POST', '/synchro/choix', { source: 'airtable', champ: 'base', config: {} })).statut, 403);
    assert.equal((await appel(anna, 'DELETE', `/synchro/oauth/${d.json.id}`)).statut, 200);
    assert.equal((await appel(anna, 'POST', `/synchro/oauth/${d.json.id}`)).statut, 404, 'annulée');
  } finally {
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});

test('Excel 365 en « 1 clic » : sélecteur de classeurs OneDrive et SharePoint lus dans Graph (§6.1 P4)', async () => {
  const graph = (a: Appel) => {
    if (a.url.host !== 'graph.microsoft.com') return null;
    assert.equal(a.entetes.get('authorization'), 'Bearer graph-acces');
    if (a.url.pathname.endsWith("/search(q='xlsx')")) {
      return json({ value: [
        { name: 'Clients.xlsx', webUrl: 'https://kerlann-my.sharepoint.com/personal/anne/Documents/Clients.xlsx' },
        { name: 'Achats.xlsm', webUrl: 'https://kerlann.sharepoint.com/sites/compta/Achats.xlsm' },
        { name: 'Clients.xlsx', webUrl: 'https://kerlann-my.sharepoint.com/personal/anne/Documents/Clients.xlsx' },
        { name: 'Perso.xlsx', webUrl: 'https://onedrive.live.com/edit.aspx?resid=ABC' },
        { name: 'Notes.docx', webUrl: 'https://kerlann-my.sharepoint.com/personal/anne/Documents/Notes.docx' },
        { name: 'Piège.xlsx', webUrl: 'https://exemple.com/Piege.xlsx' },
      ] });
    }
    // « sharedWithMe » : API arrêtée par Microsoft (novembre 2026), plus jamais appelée
    assert.ok(!a.url.pathname.endsWith('/sharedWithMe'));
    return null;
  };
  const g = simulation(graph);
  const cfg = configAvecConnexion({}, { fournisseur: 'microsoft', acces: 'graph-acces', rafraichissement: 'r', expire: null, extra: {} });
  const choix = await excel365.choix?.('fichier', cfg, 'graph-acces', g.f);
  assert.deepEqual(choix?.map((c) => c.libelle), ['Achats.xlsm', 'Clients.xlsx'], 'classeurs Excel seulement, sans doublon, triés');
  assert.ok(choix?.every((c) => /^https:\/\/[a-z-]+\.sharepoint\.com\//.test(c.valeur)), 'hôtes OneDrive et SharePoint seulement');
  assert.deepEqual(await excel365.choix?.('feuille', cfg, 'graph-acces', g.f), []);
  assert.ok(excel365.champs.find((c) => c.id === 'fichier')?.liste, 'le classeur se choisit dans une liste');
  assert.ok(excel365.champs.filter((c) => ['tenant', 'client'].includes(c.id)).every((c) => c.mode === 'cle'), 'ID d’annuaire et ID d’application : mode avancé seulement');
});

// ---------------------------------------------------------------- suppression : révocation chez l'outil

test('suppression du connecteur : accès révoqué chez Google et HubSpot ; ailleurs, retrait demandé chez l’outil', async () => {
  const revocations: Appel[] = [];
  let googleRefuse = false;
  const sim = simulation((a) => {
    if (a.url.href === 'https://oauth2.googleapis.com/revoke' && a.methode === 'POST') { revocations.push(a); return googleRefuse ? json({ error: 'invalid_token' }, 400) : new Response('', { status: 200 }); }
    if (a.url.host === 'api.hubapi.com' && a.methode === 'DELETE') { revocations.push(a); return new Response(null, { status: 204 }); }
    return null;
  });
  const { app, p } = await monter(sim.f);
  const feuille = { classeur: `https://docs.google.com/spreadsheets/d/${ID_FEUILLE}/edit`, colonneId: 'Référence' };
  const brancher = async (source: string, fournisseur: string, rafr: string, config: Record<string, string>, mapping: Record<string, string>) => {
    const jeton = await connecter(app, p, sim, source, fournisseur, { acces: `acces-${source}`, rafraichissement: rafr, expire: dans(3600) });
    return app.synchro.creer(p, { source, config: { ...config, jeton }, typeObjet: 'entreprise', roles: [], mapping, sens: 'lecture', intervalleS: 300, actif: false });
  };
  const google = await brancher('sheets', 'google', 'rafr-google-faux', feuille, { Nom: '__nom' });
  assert.deepEqual(await app.synchro.supprimer(p, google.id), { ok: true, acces: 'revoque', outil: 'Google' });
  assert.equal(revocations[0]?.corps, 'token=rafr-google-faux', 'RFC 7009 : jeton de rafraîchissement dans le corps, jamais dans l’adresse');
  assert.equal(revocations[0]?.entetes.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(app.synchro.lister(p).some((c) => c.id === google.id), false, 'connecteur et secret effacés');

  const hubspot = await brancher('hubspot', 'hubspot', 'rafr-hubspot-faux', { objet: 'companies' }, { name: '__nom' });
  // HubSpot : révoqué par le relais (API datée, avec le secret de l'application) ; plus d'appel direct à la v1
  assert.deepEqual(await app.synchro.supprimer(p, hubspot.id), { ok: true, acces: 'revoque', outil: 'HubSpot' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'hubspot', rafraichissement: 'rafr-hubspot-faux' });

  // révocation refusée ou impossible : supprimé quand même, et la personne est prévenue
  googleRefuse = true;
  const google2 = await brancher('sheets', 'google', 'rafr-google-2', feuille, { Nom: '__nom' });
  assert.deepEqual(await app.synchro.supprimer(p, google2.id), { ok: true, acces: 'a_retirer', outil: 'Google' });
  assert.equal(app.synchro.lister(p).some((c) => c.id === google2.id), false);
  const LIEN = 'https://kerlann.sharepoint.com/:x:/s/compta/EabcDEF123?e=xyz';
  const excel = await brancher('excel365', 'microsoft', 'rafr-ms', { fichier: LIEN }, { Nom: '__nom' });
  assert.deepEqual(await app.synchro.supprimer(p, excel.id), { ok: true, acces: 'a_retirer', outil: 'Microsoft' }, 'pas de révocation publique sans le secret de l’application');
  const collee = app.synchro.creer(p, { source: 'hubspot', config: { objet: 'companies', jeton: 'pat-eu1-collee-fausse' }, typeObjet: 'entreprise', roles: [], mapping: { name: '__nom' }, sens: 'lecture', intervalleS: 300, actif: false });
  assert.deepEqual(await app.synchro.supprimer(p, collee.id), { ok: true, acces: 'a_retirer', outil: 'HubSpot' }, 'clé collée : à supprimer chez l’outil');
  const entree = app.synchro.creer(p, { source: 'webhook', nom: 'Make', typeObjet: 'entreprise', roles: [], sens: 'lecture', config: {} });
  assert.deepEqual(await app.synchro.supprimer(p, entree.id), { ok: true, acces: null, outil: 'Make · Zapier · n8n (webhook)' }, 'clé d’entrée créée par le jeu : rien à révoquer');
  assert.equal(revocations.length, 2, 'aucun autre appel de révocation directe (Google, deux fois)');
});

test('revue-reseau-11 : débrancher prévient le relais (plus de renouvellement, révocation avec le secret de l’application) ; Shopify se désinstalle ; un accès partagé est gardé', async () => {
  const directes: Appel[] = [];
  let shopifyRefuse = false;
  const sim = simulation((a) => {
    if (a.url.host === 'ma-boutique.myshopify.com' && /appUninstall/.test(String(a.corps?.query ?? ''))) { directes.push(a); return json(shopifyRefuse ? { data: { appUninstall: { userErrors: [{ message: 'refus' }] } } } : { data: { appUninstall: { userErrors: [] } } }); }
    if (a.url.host === 'api.hubapi.com' && a.methode === 'DELETE') { directes.push(a); return new Response(null, { status: 204 }); }
    if (a.url.href === 'https://oauth2.googleapis.com/revoke') { directes.push(a); return new Response('', { status: 200 }); }
    return null;
  });
  const { app, p } = await monter(sim.f);
  const brancher = async (source: string, fournisseur: string, jetons: Jetons, config: Record<string, string>, mapping: Record<string, string>) => {
    const jeton = await connecter(app, p, sim, source, fournisseur, jetons, source === 'shopify' ? { boutique: 'ma-boutique.myshopify.com' } : {});
    return app.synchro.creer(p, { source, config: { ...config, jeton }, typeObjet: 'entreprise', roles: [], mapping, sens: 'lecture', intervalleS: 300, actif: false });
  };
  // Pipedrive : seul le relais a le secret de l'application ; il reçoit le jeton de renouvellement, jamais le jeton d'accès
  const pd = await brancher('pipedrive', 'pipedrive', { acces: 'pd-acces', rafraichissement: 'pd-rafr', expire: dans(3600), extra: { api_domain: 'https://kerlann.pipedrive.com' } }, { objet: 'organizations' }, { name: '__nom' });
  assert.deepEqual(await app.synchro.supprimer(p, pd.id), { ok: true, acces: 'revoque', outil: 'Pipedrive' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'pipedrive', rafraichissement: 'pd-rafr' });
  // Notion : pas de jeton de renouvellement, accès sans fin — le relais le révoque avec le jeton d'accès
  const nt = await brancher('notion', 'notion', { acces: 'nt-acces', extra: { workspace_name: 'Kerlann', bot_id: 'b' } }, { base: '1f2e3d4c5b6a47898abcdef012345678' }, { Nom: '__nom' });
  assert.deepEqual(await app.synchro.supprimer(p, nt.id), { ok: true, acces: 'revoque', outil: 'Notion' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'notion', acces: 'nt-acces' });
  // Shopify : rien pour le relais (ni jeton de renouvellement, ni révocation avec secret) ; l'application se désinstalle elle-même
  let n = sim.relais.revocations.length;
  const sh = await brancher('shopify', 'shopify', { acces: 'shpat_oauth123', extra: { boutique: 'ma-boutique.myshopify.com' } }, { objet: 'customers', boutique: 'ma-boutique.myshopify.com' }, { displayName: '__nom' });
  assert.deepEqual(await app.synchro.supprimer(p, sh.id), { ok: true, acces: 'revoque', outil: 'Shopify' });
  assert.equal(sim.relais.revocations.length, n, 'le jeton d’accès Shopify ne part pas au relais');
  assert.equal(directes.at(-1)?.entetes.get('x-shopify-access-token'), 'shpat_oauth123');
  shopifyRefuse = true;
  const sh2 = await brancher('shopify', 'shopify', { acces: 'shpat_oauth456', extra: { boutique: 'ma-boutique.myshopify.com' } }, { objet: 'customers', boutique: 'ma-boutique.myshopify.com' }, { displayName: '__nom' });
  assert.deepEqual(await app.synchro.supprimer(p, sh2.id), { ok: true, acces: 'a_retirer', outil: 'Shopify' }, 'GraphQL répond 200 même en cas de refus : la réponse est lue');

  // deux branchements HubSpot : débrancher le premier ne retire pas l'accès dont le second se sert
  const h1 = await brancher('hubspot', 'hubspot', { acces: 'hs-a1', rafraichissement: 'hs-r1', expire: dans(3600) }, { objet: 'companies' }, { name: '__nom' });
  const h2 = await brancher('hubspot', 'hubspot', { acces: 'hs-a2', rafraichissement: 'hs-r2', expire: dans(3600) }, { objet: 'contacts' }, { email: '__nom' });
  n = directes.length;
  assert.deepEqual(await app.synchro.supprimer(p, h1.id), { ok: true, acces: 'garde', outil: 'HubSpot' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'hubspot', rafraichissement: 'hs-r1', chezOutil: false }, 'le relais ne renouvelle plus CETTE connexion');
  assert.equal(directes.length, n, 'rien n’est révoqué chez HubSpot');
  assert.deepEqual(await app.synchro.supprimer(p, h2.id), { ok: true, acces: 'revoque', outil: 'HubSpot' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'hubspot', rafraichissement: 'hs-r2' }, 'révoqué par le relais');
  assert.equal(directes.length, n, 'plus d’appel direct à l’API v1 de HubSpot');

  // relais injoignable : le connecteur est supprimé quand même, et la révocation directe reste tentée
  const feuille = { classeur: `https://docs.google.com/spreadsheets/d/${ID_FEUILLE}/edit`, colonneId: 'Référence' };
  const g = await brancher('sheets', 'google', { acces: 'g-a', rafraichissement: 'g-r', expire: dans(3600) }, feuille, { Nom: '__nom' });
  sim.relais.injoignable = true;
  assert.deepEqual(await app.synchro.supprimer(p, g.id), { ok: true, acces: 'revoque', outil: 'Google' });
  sim.relais.injoignable = false;
  rienDeSecret(sim.appels, ['pd-rafr', 'nt-acces', 'shpat_oauth123', 'hs-r1', 'g-r']);
});

test('relais et confidentialité (rgpd-10) : seule la liste des outils ouverts est demandée, et rien que si Breizhcosystem est réglé ; lecture seule par défaut', async () => {
  const sim = simulation((a) => (a.url.host.endsWith('hubapi.com') ? json({ results: [] }) : null));
  const sans = await monter(sim.f, null);
  const versNexus = () => sim.appels.filter((a) => a.url.origin === RELAIS).length;
  const zero = versNexus();
  assert.ok((await sans.app.synchro.catalogue()).every((x) => x.oauth === null));
  assert.equal(versNexus(), zero, 'adresse de Breizhcosystem non réglée : il n’est jamais contacté');

  const { app, p } = await monter(sim.f);
  const cat = await app.synchro.catalogue();
  assert.deepEqual(cat.find((x) => x.id === 'hubspot')?.oauth, { fournisseur: 'hubspot', nom: 'HubSpot', champ: null }, 'bouton proposé parce que le relais l’ouvre vraiment');
  const demandes = sim.appels.filter((a) => a.url.origin === RELAIS && a.url.pathname === '/v0/oauth/fournisseurs');
  assert.equal(demandes.length, 1, 'une seule demande : « quels outils sont ouverts ? »');
  assert.equal(demandes[0]?.methode, 'GET');
  assert.ok(!demandes[0]?.corps, 'rien n’est envoyé sur personne');
  const avant = versNexus();
  await app.synchro.catalogue();
  assert.equal(versNexus(), avant, 'la réponse est gardée quelques minutes : pas une demande par ouverture d’écran');

  // lecture seule par défaut : le relais ne demande que la lecture, et la synchro n'écrira pas dans l'outil
  const lecture = await connecter(app, p, sim, 'hubspot', 'hubspot', { acces: 'acces-l', rafraichissement: 'rafr-l', expire: dans(3600) });
  assert.ok(versNexus() > avant, 'Breizhcosystem contacté ensuite pour la connexion elle-même');
  assert.equal(sim.relais.demarrages.at(-1)?.droits, 'lecture');
  const reglages = { source: 'hubspot', typeObjet: 'entreprise', roles: ['client'], mapping: { name: '__nom' }, intervalleS: 300 };
  assert.throws(() => app.synchro.creer(p, { ...reglages, config: { objet: 'companies', jeton: lecture }, sens: 'deux' }), (e: any) => e.code === 'droits_lecture' && e.statut === 409);
  const c = app.synchro.creer(p, { ...reglages, config: { objet: 'companies', jeton: lecture }, sens: 'lecture' });
  assert.throws(() => app.synchro.modifier(p, c.id, { sens: 'deux' }), (e: any) => e.code === 'droits_lecture');
  assert.equal(app.synchro.modifier(p, c.id, { intervalleS: 600 }).sens, 'lecture', 'les autres réglages restent modifiables');

  // écriture : seulement si la personne a choisi une synchro qui écrit
  const ecriture = await connecter(app, p, sim, 'hubspot', 'hubspot', { acces: 'acces-e', rafraichissement: 'rafr-e', expire: dans(3600) }, {}, 'ecriture');
  assert.equal(sim.relais.demarrages.at(-1)?.droits, 'ecriture');
  assert.equal(app.synchro.creer(p, { ...reglages, config: { objet: 'companies', jeton: ecriture }, sens: 'deux' }).sens, 'deux');
  // une valeur inconnue vaut lecture
  await app.synchro.demarrerOAuth(p, { source: 'hubspot', config: {}, droits: 'tout' });
  assert.equal(sim.relais.demarrages.at(-1)?.droits, 'lecture');
});
