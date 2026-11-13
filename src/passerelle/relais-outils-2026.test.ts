/**
 * Non-régression des trois écarts relevés le 11 novembre 2026 entre « Se connecter avec… » et la documentation des outils,
 * côté Living Business (le relais a ses propres essais) :
 * - HubSpot : la révocation passe par le relais (l'API OAuth v1, sans secret, s'arrête le 16 février 2027) ; l'ancien
 *   appel direct ne sert plus qu'en secours, avant cette date, face à un relais pas encore mis à jour ;
 * - Notion : une connexion récente a un jeton de renouvellement ; à « Débrancher », le jeton d'ACCÈS part quand même au
 *   relais (Notion ne révoque que par lui) ; un 401 de Notion déclenche le renouvellement ;
 * - Shopify : jetons hors ligne expirants — fins de validité enregistrées, boutique envoyée au renouvellement, un seul
 *   jeton par boutique partagé entre les branchements, désinstallation avec un jeton d'accès encore valable.
 * Relais et outils simulés (`fetch` injecté), aucun appel réseau ; faux jetons construits à l'exécution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';
import { compteConnecte, enveloppe, lireEnveloppe, lireJetons, type ConnexionOAuth } from './oauth-relais.ts';
import { FIN_HUBSPOT_V1 } from './synchro.ts';

process.env.LB_AUTORISER_LOCAL = '1'; // relais simulé sur http://127.0.0.1 (ce fichier tourne dans son propre processus)

const RELAIS = 'http://127.0.0.1:4181';
const ATTENTE = 'C'.repeat(20) + 'd'.repeat(23);
const BOUTIQUE = 'ma-boutique.myshopify.com';
const BASE_NOTION = '1f2e3d4c5b6a47898abcdef012345678';
const faux = (...parts: string[]) => parts.join('_');
/** Jeton de renouvellement Shopify tel que le relais le remet : lié à la boutique. */
const lie = (n: number, boutique = BOUTIQUE) => `${boutique}|${faux('shprt', 'essai', String(n))}`;
const dans = (s: number) => new Date(Date.now() + s * 1000).toISOString();
const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });

interface Appel { url: URL; methode: string; entetes: Headers; corps: any }
interface Jetons { acces: string; rafraichissement?: string | null; expire?: string | null; rafraichissementExpire?: string; extra?: Record<string, string> }

const PAGES: Record<string, (c: any) => string> = {
  hubspot: () => 'https://app.hubspot.com/oauth/authorize?client_id=hs&state=s1',
  notion: () => 'https://api.notion.com/v1/oauth/authorize?client_id=n&state=s1',
  shopify: (c) => `https://${c.boutique}/admin/oauth/authorize?client_id=sh&state=s1`,
};

/** Relais simulé + outils simulés. `journal` : ordre des appels qui comptent (relais et outils). */
function simulation(outil: (a: Appel, journal: string[]) => Response | null) {
  const journal: string[] = [];
  const relais = {
    /** Outils que le relais révoque lui-même avec le secret de l'application (relais à jour : HubSpot compris). */
    revoqueChezOutil: ['pipedrive', 'notion', 'hubspot'],
    rafraichissements: [] as any[],
    revocations: [] as any[],
    resultat: null as null | { statut: 'connecte'; fournisseur: string; jetons: Jetons },
    /** Réponse du relais à un renouvellement (par défaut : connexion expirée). */
    rafraichir: ((): Response => json({ erreur: 'connexion_expiree', message: 'Connexion expirée ou retirée : reconnectez-vous.' }, 401)) as (corps: any) => Response,
  };
  const f = (async (url: URL | string, init?: RequestInit) => {
    const brut = init?.body ? String(init.body) : null;
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: brut === null ? null : brut.startsWith('{') ? JSON.parse(brut) : brut };
    if (a.url.origin !== RELAIS) return outil(a, journal) ?? json({ erreur: 'introuvable' }, 404);
    switch (a.url.pathname) {
      case '/v0/oauth/fournisseurs': return json({ fournisseurs: Object.keys(PAGES).map((id) => ({ id, nom: id, parametre: null })) });
      case '/v0/oauth/demarrer': return json({ url: PAGES[a.corps.fournisseur]?.(a.corps), attente: ATTENTE, expire: dans(600) });
      case '/v0/oauth/retrait': { const r = relais.resultat; relais.resultat = null; return r ? json(r) : json({ statut: 'attente' }); }
      case '/v0/oauth/rafraichir': journal.push('relais:rafraichir'); relais.rafraichissements.push(a.corps); return relais.rafraichir(a.corps);
      case '/v0/oauth/revoquer':
        journal.push('relais:revoquer');
        relais.revocations.push(a.corps);
        return json({ ok: true, chezOutil: a.corps.chezOutil !== false && relais.revoqueChezOutil.includes(a.corps.fournisseur) ? 'revoque' : 'a_retirer' });
    }
    return json({ erreur: 'introuvable' }, 404);
  }) as typeof fetch;
  return { f, relais, journal };
}
type Sim = ReturnType<typeof simulation>;

async function monter(sim: Sim, maintenant?: () => Date) {
  const app = await Application.creer({ exemple: 'pme', fetch: sim.f, ...(maintenant ? { maintenant } : {}) });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  app.monde.viderDemo(p, 's', { nom: 'Test' });
  await app.nexus.reglerAdresse(RELAIS);
  return { app, p };
}
type Monte = Awaited<ReturnType<typeof monter>>;

const REGLAGES: Record<string, { fournisseur: string; config: Record<string, string>; mapping: Record<string, string> }> = {
  hubspot: { fournisseur: 'hubspot', config: { objet: 'companies' }, mapping: { name: '__nom' } },
  notion: { fournisseur: 'notion', config: { base: BASE_NOTION }, mapping: { Nom: '__nom' } },
  shopify: { fournisseur: 'shopify', config: { objet: 'customers', boutique: BOUTIQUE }, mapping: { displayName: '__nom' } },
};
/** « Se connecter avec… » (la personne a accepté), puis création du branchement, à l'arrêt (aucune synchro de fond). */
async function brancher({ app, p }: Monte, sim: Sim, source: string, jetons: Jetons) {
  const r = REGLAGES[source]!;
  const d = await app.synchro.demarrerOAuth(p, { source, config: source === 'shopify' ? { boutique: BOUTIQUE } : {} });
  sim.relais.resultat = { statut: 'connecte', fournisseur: r.fournisseur, jetons: { rafraichissement: null, expire: null, extra: {}, ...jetons } };
  const suivi = await app.synchro.suivreOAuth(p, d.id) as { statut: string; jeton: string; compte: string | null };
  assert.equal(suivi.statut, 'connecte');
  const c = app.synchro.creer(p, { source, config: { ...r.config, jeton: suivi.jeton }, typeObjet: 'entreprise', roles: [], mapping: r.mapping, sens: 'lecture', intervalleS: 300, actif: false });
  return { id: c.id, compte: suivi.compte };
}

// ---------------------------------------------------------------- HubSpot

test('HubSpot : débrancher fait révoquer par le relais ; l’ancien appel direct (v1) ne sert qu’en secours, jusqu’au 16 février 2027', async () => {
  const v1: Appel[] = [];
  const outil = (a: Appel) => {
    if (a.url.host === 'api.hubapi.com' && a.url.pathname.startsWith('/oauth/v1/')) { v1.push(a); return new Response(null, { status: 204 }); }
    return null;
  };
  // relais à jour : il révoque chez HubSpot avec le secret de l'application ; plus aucun appel à la v1
  const sim = simulation(outil);
  const m = await monter(sim);
  const hs = await brancher(m, sim, 'hubspot', { acces: faux('hs', 'acces'), rafraichissement: faux('hs', 'rafr', '1'), expire: dans(3600) });
  assert.deepEqual(await m.app.synchro.supprimer(m.p, hs.id), { ok: true, acces: 'revoque', outil: 'HubSpot' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'hubspot', rafraichissement: faux('hs', 'rafr', '1') });
  assert.equal(v1.length, 0, 'avant : DELETE /oauth/v1/refresh-tokens/…, en erreur à partir du 16 février 2027');

  // relais pas encore mis à jour (il répond « à retirer ») : secours par la v1 tant qu'elle existe…
  const veille = new Date(FIN_HUBSPOT_V1 - 86_400_000);
  const simAncien = simulation(outil);
  simAncien.relais.revoqueChezOutil = ['pipedrive', 'notion'];
  const avant = await monter(simAncien, () => veille);
  const hs2 = await brancher(avant, simAncien, 'hubspot', { acces: faux('hs', 'acces'), rafraichissement: faux('hs', 'rafr', '2'), expire: dans(3600) });
  assert.deepEqual(await avant.app.synchro.supprimer(avant.p, hs2.id), { ok: true, acces: 'revoque', outil: 'HubSpot' });
  assert.deepEqual(v1.map((a) => `${a.methode} ${a.url.pathname}`), [`DELETE /oauth/v1/refresh-tokens/${faux('hs', 'rafr', '2')}`]);
  // … et plus du tout ensuite : la personne est invitée à retirer l'accès chez HubSpot
  const apres = await monter(simAncien, () => new Date(FIN_HUBSPOT_V1));
  const hs3 = await brancher(apres, simAncien, 'hubspot', { acces: faux('hs', 'acces'), rafraichissement: faux('hs', 'rafr', '3'), expire: dans(3600) });
  assert.deepEqual(await apres.app.synchro.supprimer(apres.p, hs3.id), { ok: true, acces: 'a_retirer', outil: 'HubSpot' });
  assert.equal(v1.length, 1, 'aucun appel à une adresse arrêtée');
  assert.equal(FIN_HUBSPOT_V1, Date.parse('2027-02-16T00:00:00Z'));
});

test('HubSpot : le compte connecté est montré — domaine lu par le relais, à défaut numéro du compte', async () => {
  const c = (extra: Record<string, string>): ConnexionOAuth => ({ fournisseur: 'hubspot', acces: 'a', rafraichissement: null, expire: null, extra });
  assert.equal(compteConnecte(c({ hub_domain: 'kerlann.example', hub_id: '1234567' })), 'kerlann.example');
  assert.equal(compteConnecte(c({ hub_id: '1234567' })), 'compte HubSpot n° 1234567', 'avant : rien (la réponse du jeton ne donne pas le domaine)');
  assert.equal(compteConnecte(c({})), null);
  const sim = simulation(() => null);
  const m = await monter(sim);
  const hs = await brancher(m, sim, 'hubspot', { acces: faux('hs', 'acces'), rafraichissement: faux('hs', 'rafr'), expire: dans(3600), extra: { hub_domain: 'kerlann.example', hub_id: '1234567' } });
  assert.equal(hs.compte, 'kerlann.example');
});

// ---------------------------------------------------------------- Notion

test('Notion : à « Débrancher », le jeton d’accès part au relais AVEC le jeton de renouvellement d’une connexion récente', async () => {
  const sim = simulation(() => null);
  const m = await monter(sim);
  const recente = { acces: faux('no', 'acces', '1'), rafraichissement: faux('no', 'rafr', '1'), extra: { workspace_name: 'Kerlann', bot_id: 'b' } };
  const n1 = await brancher(m, sim, 'notion', recente);
  assert.equal(n1.compte, 'Kerlann');
  assert.deepEqual(await m.app.synchro.supprimer(m.p, n1.id), { ok: true, acces: 'revoque', outil: 'Notion' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'notion', rafraichissement: faux('no', 'rafr', '1'), acces: faux('no', 'acces', '1') }, 'avant : le jeton de renouvellement seul — Notion ne révoque qu’avec le jeton d’accès, l’accès restait ouvert');
  // connexion ancienne (jeton d'accès seul) : inchangé
  const n2 = await brancher(m, sim, 'notion', { acces: faux('no', 'acces', '2'), extra: { workspace_name: 'Kerlann' } });
  assert.deepEqual(await m.app.synchro.supprimer(m.p, n2.id), { ok: true, acces: 'revoque', outil: 'Notion' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'notion', acces: faux('no', 'acces', '2') });
  // un autre branchement Notion reste : le relais ne coupe que cette connexion-ci, le jeton d'accès ne lui est pas envoyé
  const n3 = await brancher(m, sim, 'notion', { ...recente, acces: faux('no', 'acces', '3'), rafraichissement: faux('no', 'rafr', '3') });
  await brancher(m, sim, 'notion', { ...recente, acces: faux('no', 'acces', '4'), rafraichissement: faux('no', 'rafr', '4') });
  assert.deepEqual(await m.app.synchro.supprimer(m.p, n3.id), { ok: true, acces: 'garde', outil: 'Notion' });
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'notion', rafraichissement: faux('no', 'rafr', '3'), chezOutil: false });
});

test('Notion : pas de date de fin connue → rien n’est renouvelé d’avance ; un 401 de Notion renouvelle une fois, la rotation est enregistrée', async () => {
  const valables = new Set([faux('no', 'acces', '1')]);
  const vus: string[] = [];
  const sim = simulation((a) => {
    if (a.url.host !== 'api.notion.com') return null;
    const jeton = (a.entetes.get('authorization') ?? '').replace(/^Bearer /, '');
    vus.push(jeton);
    return valables.has(jeton) ? json({ results: [], has_more: false }) : json({ object: 'error', status: 401, code: 'unauthorized' }, 401);
  });
  const m = await monter(sim);
  let n = 1;
  sim.relais.rafraichir = () => { n += 1; valables.add(faux('no', 'acces', String(n))); return json({ acces: faux('no', 'acces', String(n)), rafraichissement: faux('no', 'rafr', String(n)), expire: null, portee: null, extra: {} }); };
  const c = await brancher(m, sim, 'notion', { acces: faux('no', 'acces', '1'), rafraichissement: faux('no', 'rafr', '1'), extra: { workspace_name: 'Kerlann' } });
  const lister = () => m.app.synchro.choix(m.p, { id: c.id, source: 'notion', champ: 'base', config: {} });
  await lister();
  assert.equal(sim.relais.rafraichissements.length, 0, 'jeton accepté par Notion : aucun appel au relais');
  // Notion refuse le jeton d'accès (périmé) : renouvelé par le relais, puis l'appel repart avec le nouveau
  valables.clear();
  await lister();
  assert.deepEqual(sim.relais.rafraichissements, [{ fournisseur: 'notion', rafraichissement: faux('no', 'rafr', '1'), droits: 'lecture' }]);
  assert.equal(vus.at(-1), faux('no', 'acces', '2'));
  // rotation enregistrée : le renouvellement suivant part avec le NOUVEAU jeton de renouvellement
  valables.clear();
  await lister();
  assert.equal(sim.relais.rafraichissements.at(-1)?.rafraichissement, faux('no', 'rafr', '2'));
  // et « Débrancher » envoie le jeton d'accès et le jeton de renouvellement du moment
  await m.app.synchro.supprimer(m.p, c.id);
  assert.deepEqual(sim.relais.revocations.at(-1), { fournisseur: 'notion', rafraichissement: faux('no', 'rafr', '3'), acces: faux('no', 'acces', '3') });
});

// ---------------------------------------------------------------- Shopify

/** Shopify simulé (API Admin) : clients lus avec un jeton d'accès valable, 401 sinon ; désinstallation de l'application. */
function shopify() {
  const valables = new Set<string>();
  const lectures: string[] = [];
  const desinstallations: string[] = [];
  const outil = (a: Appel, journal: string[]) => {
    if (a.url.host !== BOUTIQUE) return null;
    assert.ok(!a.url.pathname.includes('/oauth/'), 'Living Business n’appelle jamais l’adresse de jeton de Shopify : le relais seul a le secret');
    const jeton = a.entetes.get('x-shopify-access-token') ?? '';
    if (!valables.has(jeton)) return json({ errors: '[API] Invalid API key or access token (unrecognized login or wrong password)' }, 401);
    if (/appUninstall/.test(String(a.corps?.query ?? ''))) { journal.push('shopify:appUninstall'); desinstallations.push(jeton); valables.clear(); return json({ data: { appUninstall: { userErrors: [] } } }); }
    lectures.push(jeton);
    return json({ data: { customers: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [{ id: 'gid://shopify/Customer/1', displayName: 'Anne Le Bihan' }] } } });
  };
  return { outil, valables, lectures, desinstallations };
}
/** Relais simulé : chaque renouvellement Shopify remet un nouveau couple (rotation), valable 1 h et 90 jours. */
function rotationShopify(sim: Sim, sh: ReturnType<typeof shopify>, depuis: number) {
  let n = depuis;
  sim.relais.rafraichir = () => {
    n += 1;
    sh.valables.add(faux('shpat', 'essai', String(n)));
    return json({ acces: faux('shpat', 'essai', String(n)), rafraichissement: lie(n), expire: dans(3600), rafraichissementExpire: dans(90 * 86_400), portee: 'read_customers', extra: { boutique: BOUTIQUE } });
  };
}
const couple = (n: number, expireDans = 3600): Jetons => ({ acces: faux('shpat', 'essai', String(n)), rafraichissement: lie(n), expire: dans(expireDans), rafraichissementExpire: dans(90 * 86_400), extra: { boutique: BOUTIQUE } });

test('Shopify : fins de validité enregistrées (accès et renouvellement) ; un relais d’avant, qui ne les donne pas, est toléré', () => {
  const fin = dans(90 * 86_400);
  const j = lireJetons('shopify', { ...couple(1), rafraichissementExpire: fin });
  assert.equal(j?.rafraichissementExpire, fin);
  assert.equal(j?.rafraichissement, lie(1), 'jeton de renouvellement lié à la boutique, gardé tel que le relais le remet');
  const c: ConnexionOAuth = { fournisseur: 'shopify', ...j!, relais: RELAIS, droits: 'lecture' };
  assert.deepEqual(lireEnveloppe(enveloppe(c)), c, 'enregistrées dans le secret chiffré du branchement');
  // relais d'avant : jeton sans fin, sans jeton de renouvellement → rien de plus dans l'enveloppe
  const ancien = lireJetons('shopify', { acces: faux('shpat', 'sans', 'fin'), extra: { boutique: BOUTIQUE } });
  assert.deepEqual(ancien, { acces: faux('shpat', 'sans', 'fin'), rafraichissement: null, expire: null, extra: { boutique: BOUTIQUE } });
  assert.ok(!enveloppe({ fournisseur: 'shopify', ...ancien! }).includes('rafraichissementExpire'));
  // valeur illisible, ou fin annoncée sans jeton de renouvellement : ignorée
  assert.equal(lireJetons('shopify', { ...couple(1), rafraichissementExpire: 'bientôt' })?.rafraichissementExpire, undefined);
  assert.equal(lireJetons('shopify', { acces: 'x', rafraichissementExpire: fin })?.rafraichissementExpire, undefined);
});

test('Shopify : jeton d’accès bientôt expiré → renouvelé par le relais avec la boutique, rotation enregistrée', async () => {
  const sh = shopify();
  const sim = simulation(sh.outil);
  const m = await monter(sim);
  rotationShopify(sim, sh, 1);
  sh.valables.add(faux('shpat', 'essai', '1'));
  const c = await brancher(m, sim, 'shopify', couple(1, 60)); // expire dans 1 minute
  assert.equal(c.compte, BOUTIQUE);
  let v = await m.app.synchro.synchroniser(c.id, m.p);
  assert.equal(v.statut, 'ok', v.message ?? '');
  assert.deepEqual(sim.relais.rafraichissements, [{ fournisseur: 'shopify', rafraichissement: lie(1), boutique: BOUTIQUE, droits: 'lecture' }], 'avant : pas de boutique, le relais ne pouvait pas bâtir l’adresse de jeton');
  assert.equal(sh.lectures.at(-1), faux('shpat', 'essai', '2'), 'lecture avec le nouveau jeton d’accès');
  // le nouveau jeton vaut une heure : pas de nouveau renouvellement
  v = await m.app.synchro.synchroniser(c.id, m.p);
  assert.equal(sim.relais.rafraichissements.length, 1);
  // Shopify le refuse plus tôt que prévu (401) : renouvelé une fois, avec le jeton de renouvellement tourné
  sh.valables.clear();
  v = await m.app.synchro.synchroniser(c.id, m.p);
  assert.equal(v.statut, 'ok', v.message ?? '');
  assert.equal(sim.relais.rafraichissements.at(-1)?.rafraichissement, lie(2), 'rotation enregistrée');
  assert.equal(sh.lectures.at(-1), faux('shpat', 'essai', '3'));
  const etat = JSON.stringify(m.app.synchro.instantane());
  for (const x of ['shprt', 'shpat', 'rafraichissementExpire']) assert.ok(!etat.includes(x), `${x} jamais en clair dans l’état enregistré`);
});

test('Shopify : jeton de renouvellement expiré (90 jours sans renouvellement) → « reconnectez-vous », rien ne part au relais', async () => {
  const sh = shopify();
  const sim = simulation(sh.outil);
  const m = await monter(sim);
  rotationShopify(sim, sh, 1);
  // branchement resté à l'arrêt plus de 90 jours : jeton d'accès et jeton de renouvellement tous deux expirés
  const c = await brancher(m, sim, 'shopify', { ...couple(1, -3600), rafraichissementExpire: dans(-60) });
  let v = await m.app.synchro.synchroniser(c.id, m.p);
  assert.equal(v.statut, 'erreur');
  assert.match(v.message ?? '', /Connexion Shopify expirée ou retirée : reconnectez-vous/);
  assert.equal(sim.relais.rafraichissements.length, 0, 'un jeton que Shopify refuserait ne quitte pas Living Business');
  // le relais (ou Shopify, par lui) dit la connexion expirée : même message, la personne se reconnecte
  sim.relais.rafraichir = () => json({ erreur: 'connexion_expiree', message: 'Connexion Shopify expirée ou retirée : reconnectez-vous.' }, 401);
  const c2 = await brancher(m, sim, 'shopify', couple(5, 60));
  v = await m.app.synchro.synchroniser(c2.id, m.p);
  assert.equal(v.statut, 'erreur');
  assert.match(v.message ?? '', /Connexion Shopify expirée ou retirée : reconnectez-vous/);
});

test('Shopify : un seul jeton par boutique — deux branchements le partagent, rotation comprise ; le dernier débranché désinstalle', async () => {
  const sh = shopify();
  const sim = simulation(sh.outil);
  const m = await monter(sim);
  rotationShopify(sim, sh, 2);
  sh.valables.add(faux('shpat', 'essai', '1'));
  const c1 = await brancher(m, sim, 'shopify', couple(1));
  // seconde connexion à la même boutique : Shopify retire aussitôt le couple du premier branchement
  sh.valables.clear();
  sh.valables.add(faux('shpat', 'essai', '2'));
  const c2 = await brancher(m, sim, 'shopify', couple(2));
  let v = await m.app.synchro.synchroniser(c1.id, m.p);
  assert.equal(v.statut, 'ok', v.message ?? '');
  assert.equal(sh.lectures.at(-1), faux('shpat', 'essai', '2'), 'le premier branchement a repris le nouveau couple');
  assert.equal(sim.relais.rafraichissements.length, 0, 'avant : il gardait un jeton retiré, puis « reconnectez-vous » à tour de rôle');
  // rotation : le renouvellement fait par l'un vaut pour l'autre (sinon l'ancien jeton reviendrait au relais, qui couperait tout)
  sh.valables.clear();
  v = await m.app.synchro.synchroniser(c1.id, m.p);
  assert.equal(v.statut, 'ok', v.message ?? '');
  assert.equal(sim.relais.rafraichissements.at(-1)?.rafraichissement, lie(2));
  v = await m.app.synchro.synchroniser(c2.id, m.p);
  assert.equal(v.statut, 'ok', v.message ?? '');
  assert.equal(sh.lectures.at(-1), faux('shpat', 'essai', '3'));
  assert.equal(sim.relais.rafraichissements.length, 1, 'un seul renouvellement pour les deux branchements');
  // débrancher l'un : la connexion, partagée, n'est ni coupée au relais ni désinstallée
  assert.deepEqual(await m.app.synchro.supprimer(m.p, c1.id), { ok: true, acces: 'garde', outil: 'Shopify' });
  assert.equal(sim.relais.revocations.length, 0);
  assert.equal(sh.desinstallations.length, 0);
  v = await m.app.synchro.synchroniser(c2.id, m.p);
  assert.equal(v.statut, 'ok', 'le second branchement continue');
  // débrancher le dernier : le relais cesse de renouveler, l'application se désinstalle de la boutique
  assert.deepEqual(await m.app.synchro.supprimer(m.p, c2.id), { ok: true, acces: 'revoque', outil: 'Shopify' });
  assert.deepEqual(sim.relais.revocations, [{ fournisseur: 'shopify', rafraichissement: lie(3) }]);
  assert.deepEqual(sh.desinstallations, [faux('shpat', 'essai', '3')]);
});

test('Shopify : débrancher avec un jeton d’accès expiré → renouvelé AVANT que le relais coupe, puis désinstallation', async () => {
  const sh = shopify();
  const sim = simulation(sh.outil);
  const m = await monter(sim);
  rotationShopify(sim, sh, 1);
  const c = await brancher(m, sim, 'shopify', couple(1, -600)); // jeton d'accès expiré depuis 10 minutes
  sim.journal.length = 0;
  assert.deepEqual(await m.app.synchro.supprimer(m.p, c.id), { ok: true, acces: 'revoque', outil: 'Shopify' }, 'avant (jetons expirants) : désinstallation tentée avec un jeton périmé');
  assert.deepEqual(sim.journal, ['relais:rafraichir', 'relais:revoquer', 'shopify:appUninstall']);
  assert.deepEqual(sim.relais.revocations, [{ fournisseur: 'shopify', rafraichissement: lie(2) }], 'le relais coupe la connexion avec le jeton du moment');
  assert.deepEqual(sh.desinstallations, [faux('shpat', 'essai', '2')]);

  // renouvellement impossible (connexion déjà expirée) : supprimé quand même, la personne désinstalle dans Shopify
  sim.relais.rafraichir = () => json({ erreur: 'connexion_expiree' }, 401);
  const c2 = await brancher(m, sim, 'shopify', couple(7, -600));
  assert.deepEqual(await m.app.synchro.supprimer(m.p, c2.id), { ok: true, acces: 'a_retirer', outil: 'Shopify' });
  assert.equal(m.app.synchro.lister(m.p).length, 0);
  // jeton d'accès encore valable : pas de renouvellement inutile
  sh.valables.add(faux('shpat', 'essai', '9'));
  const c3 = await brancher(m, sim, 'shopify', couple(9));
  sim.journal.length = 0;
  assert.deepEqual(await m.app.synchro.supprimer(m.p, c3.id), { ok: true, acces: 'revoque', outil: 'Shopify' });
  assert.deepEqual(sim.journal, ['relais:revoquer', 'shopify:appUninstall']);
});
