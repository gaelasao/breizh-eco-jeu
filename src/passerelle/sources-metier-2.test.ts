/**
 * Connecteurs natifs Axonaut, Stripe, WooCommerce, PrestaShop, Sellsy : `fetch` simulé, aucun appel réseau.
 * Pour chaque outil : requêtes vérifiées (méthode, adresse, en-têtes, corps), lecture paginée, écriture
 * (création + mise à jour) et erreur d'authentification lisible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axonaut, prestashop, sellsy, stripe, woocommerce } from './sources-metier-2.ts';
import { ADAPTATEURS } from './sources.ts';

interface Appel { url: URL; methode: string; entetes: Headers; corps: any; brut: string }

/** `fetch` simulé : note chaque appel (corps JSON, formulaire ou texte brut) et laisse le test répondre. */
function simuler(repondre: (a: Appel, n: number) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const entetes = new Headers(init?.headers);
    const brut = init?.body ? String(init.body) : '';
    const type = entetes.get('content-type') ?? '';
    const corps = !brut ? null : type.includes('json') ? JSON.parse(brut) : type.includes('form') ? Object.fromEntries(new URLSearchParams(brut)) : brut;
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes, corps, brut };
    appels.push(a);
    return repondre(a, appels.length - 1);
  }) as typeof fetch;
  return { f, appels };
}
const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json', ...entetes } });
const aucunSecretDansUrl = (appels: Appel[], secret: string) => { for (const a of appels) assert.equal(a.url.href.includes(secret), false, `secret dans l’adresse : ${a.url.href}`); };
const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;

// ---------------------------------------------------------------- catalogue

test('catalogue : les 5 nouveaux connecteurs natifs sont branchés, en français, avec un seul champ secret', () => {
  for (const [id, a] of [['axonaut', axonaut], ['stripe', stripe], ['woocommerce', woocommerce], ['prestashop', prestashop], ['sellsy', sellsy]] as const) {
    assert.equal(ADAPTATEURS[id], a);
    assert.equal(a.id, id);
    assert.equal(a.lecture, 'appel');
    assert.equal(a.ecriture, true);
    assert.ok(a.etapes.length >= 3 && a.etapes.every((e) => e.length > 20), `${id} : étapes`);
    assert.equal(a.champs.filter((c) => c.secret).length, 1, `${id} : un seul secret`);
    assert.equal(a.champs.find((c) => c.secret)?.id, 'jeton', `${id} : secret dans le champ « jeton »`);
    assert.ok(a.champs.some((c) => c.exemple), `${id} : exemple`);
  }
  assert.match(stripe.etapes.join(' '), /clé restreinte/);
});

// ---------------------------------------------------------------- Axonaut

const AXONAUT_CLE = 'axo0123456789abcdef';

test('Axonaut : entreprises lues page par page (en-tête « page »), clé dans userApiKey, coordonnées bancaires jamais importées', async () => {
  const { f, appels } = simuler((a) => a.entetes.get('page') === '1'
    ? json([
      { id: 11, name: 'Crêperie Ty Gwenn', address_city: 'Brest', address_zip_code: '29200', is_customer: true, iban: 'FR7612345', bic: 'AGRIFRPP', siret: '12345678900011', business_manager: { id: 3, name: 'Anna', email: 'anna@ex.test' }, employees: [{ id: 1, firstname: 'Yann' }], custom_fields: { secteur: 'Restauration' } },
      { id: 12, name: 'Hôtel des Embruns', address_city: 'Quiberon' },
    ])
    : json([{ id: 13, name: 'Camping Les Dunes', address_city: 'Crozon' }]));
  const r = await axonaut.lire({ objet: 'clients' }, AXONAUT_CLE, f);
  assert.equal(appels.length, 2, 'page plus courte que la première : dernière page');
  for (const a of appels) {
    assert.equal(a.methode, 'GET');
    assert.equal(a.url.href, 'https://axonaut.com/api/v2/companies?type=customer&sort=id');
    assert.equal(a.entetes.get('userapikey'), AXONAUT_CLE);
  }
  assert.deepEqual(appels.map((a) => a.entetes.get('page')), ['1', '2']);
  aucunSecretDansUrl(appels, AXONAUT_CLE);
  assert.deepEqual(r.map((x) => x.externeId), ['11', '12', '13']);
  const c = r[0]?.champs ?? {};
  assert.equal(c.name, 'Crêperie Ty Gwenn');
  assert.equal(c.address_city, 'Brest');
  assert.equal(c['business_manager.name'], 'Anna');
  assert.equal(c['custom_fields.secteur'], 'Restauration');
  for (const k of ['iban', 'bic', 'employees', 'id']) assert.equal(k in c, false, k);
  // fournisseurs : bon filtre ; serveur qui ignore la page → arrêt, pas de boucle
  const p = simuler(() => json([{ id: 7, name: 'Négoce Ar Vro' }]));
  const fournisseurs = await axonaut.lire({ objet: 'fournisseurs' }, AXONAUT_CLE, p.f);
  assert.equal(p.appels[0]?.url.searchParams.get('type'), 'supplier');
  assert.equal(p.appels.length, 2);
  assert.deepEqual(fournisseurs.map((x) => x.externeId), ['7']);
});

test('Axonaut : mise à jour (PATCH, champs connus non vides) et création de clients, prospects et fournisseurs', async () => {
  const { f, appels } = simuler((a) => json(a.url.pathname.endsWith('/suppliers') ? { id: 501, company_id: 77, name: 'Scierie du Léon' } : { id: a.methode === 'POST' ? 90 : 11 }));
  assert.equal(await axonaut.ecrire?.({ objet: 'clients' }, AXONAUT_CLE, '11', { name: 'Crêperie Ty Gwenn SARL', address_city: 'Quimper', iban: 'FR76', comments: '', is_customer: 'false', 'business_manager.name': 'Yann' }, f), '11');
  assert.equal(appels.length, 1);
  assert.equal(appels[0]?.methode, 'PATCH');
  assert.equal(appels[0]?.url.href, 'https://axonaut.com/api/v2/companies/11');
  assert.equal(appels[0]?.entetes.get('userapikey'), AXONAUT_CLE);
  assert.equal(appels[0]?.entetes.get('content-type'), 'application/json');
  assert.deepEqual(appels[0]?.corps, { name: 'Crêperie Ty Gwenn SARL', address_city: 'Quimper' });
  assert.equal(await axonaut.ecrire?.({ objet: 'clients' }, AXONAUT_CLE, null, { name: 'Hôtel des Embruns', address_zip_code: '56170', siret: '98765432100019' }, f), '90');
  assert.equal(appels[1]?.methode, 'POST');
  assert.equal(appels[1]?.url.href, 'https://axonaut.com/api/v2/companies');
  assert.deepEqual(appels[1]?.corps, { is_customer: true, name: 'Hôtel des Embruns', address_zip_code: '56170', siret: '98765432100019' });
  await axonaut.ecrire?.({ objet: 'prospects' }, AXONAUT_CLE, null, { name: 'Prospect Ar Mor' }, f);
  assert.deepEqual(appels[2]?.corps, { is_prospect: true, name: 'Prospect Ar Mor' });
  // un fournisseur se crée par /suppliers ; l'identifiant gardé est celui de son entreprise (lu et modifié ensuite)
  assert.equal(await axonaut.ecrire?.({ objet: 'fournisseurs' }, AXONAUT_CLE, null, { name: 'Scierie du Léon', address_city: 'Landivisiau', currency: 'EUR' }, f), '77');
  assert.equal(appels[3]?.url.href, 'https://axonaut.com/api/v2/suppliers');
  assert.deepEqual(appels[3]?.corps, { name: 'Scierie du Léon', address_city: 'Landivisiau' });
  appels.length = 0;
  assert.equal(await axonaut.ecrire?.({ objet: 'clients' }, AXONAUT_CLE, '11', { iban: 'FR76', comments: '  ' }, f), '11');
  assert.equal(appels.length, 0, 'rien à écrire : aucun appel');
  await assert.rejects(axonaut.ecrire?.({ objet: 'clients' }, AXONAUT_CLE, '../11', { name: 'x' }, f) ?? Promise.resolve(), /invalide/);
  await assert.rejects(axonaut.ecrire?.({ objet: 'clients' }, AXONAUT_CLE, null, { address_city: 'Brest' }, f) ?? Promise.resolve(), /nom de l’entreprise manquant/);
  assert.equal(appels.length, 0);
});

test('Axonaut : clé refusée → message lisible ; clé manquante ou objet inconnu refusés sans appel', async () => {
  await assert.rejects(axonaut.lire({ objet: 'clients' }, 'mauvaise-cle-axonaut', simuler(() => json({ error: 'Invalid API key' }, 401)).f), /^Error: Axonaut : clé d’API refusée/);
  await assert.rejects(axonaut.lire({ objet: 'clients' }, AXONAUT_CLE, simuler(() => json({}, 429)).f), /Axonaut : trop de requêtes/);
  const { f, appels } = simuler(() => json([]));
  await assert.rejects(axonaut.lire({ objet: 'clients' }, null, f), /jeton manquant/);
  await assert.rejects(axonaut.lire({ objet: 'factures' }, AXONAUT_CLE, f), /clients, prospects ou fournisseurs/);
  await assert.rejects(axonaut.lire({ objet: 'clients' }, 'cle avec espace', f), /clé d’API invalide/);
  assert.equal(appels.length, 0);
});

// ---------------------------------------------------------------- Stripe

const STRIPE_CLE = ['rk', 'test', '51AbCdEfGhIjKlMnOp'].join('_');
const client = (id: string, extra: Record<string, unknown> = {}) => ({
  id, object: 'customer', name: 'Ty Coz', email: 'contact@tycoz.test', phone: null, description: 'Restaurant', balance: -1050, currency: 'eur', created: 1767225600, delinquent: false,
  address: { line1: '1 quai', line2: null, postal_code: '56100', city: 'Lorient', state: null, country: 'FR' }, metadata: { siret: '12345678900011' }, invoice_settings: { footer: null }, preferred_locales: ['fr'], ...extra,
});

test('Stripe : clients lus par curseur (starting_after), clé en Bearer, montants et dates lisibles ; factures en lecture', async () => {
  const { f, appels } = simuler((a) => a.url.searchParams.get('starting_after')
    ? json({ object: 'list', data: [client('cus_B', { name: 'Hôtel des Embruns', address: null, metadata: {} })], has_more: false })
    : json({ object: 'list', data: [client('cus_A')], has_more: true }));
  const r = await stripe.lire({ objet: 'customers' }, STRIPE_CLE, f);
  assert.deepEqual(appels.map((a) => a.url.href), ['https://api.stripe.com/v1/customers?limit=100', 'https://api.stripe.com/v1/customers?limit=100&starting_after=cus_A']);
  for (const a of appels) { assert.equal(a.methode, 'GET'); assert.equal(a.entetes.get('authorization'), `Bearer ${STRIPE_CLE}`); }
  aucunSecretDansUrl(appels, STRIPE_CLE);
  assert.deepEqual(r.map((x) => x.externeId), ['cus_A', 'cus_B']);
  const c = r[0]?.champs ?? {};
  assert.equal(c.name, 'Ty Coz');
  assert.equal(c['address.city'], 'Lorient');
  assert.equal(c['address.line2'], '');
  assert.equal(c.balance, '-10.50');
  assert.equal(c.currency, 'EUR');
  assert.equal(c.created, '2026-01-01');
  assert.equal(c['metadata.siret'], '12345678900011');
  assert.equal('invoice_settings.footer' in c, false);
  assert.equal(r[1]?.champs['address.city'], '');
  const p = simuler(() => json({ data: [
    { id: 'in_1', number: 'F-2026-001', customer: 'cus_A', customer_name: 'Ty Coz', status: 'open', currency: 'eur', total: 12000, amount_due: 12000, amount_paid: 0, amount_remaining: 12000, created: 1767225600, due_date: null },
    { id: 'in_2', number: 'F-2026-002', customer: 'cus_B', status: 'paid', currency: 'jpy', total: 5000, amount_paid: 5000 },
    { id: 'in_3', number: 'F-2026-003', customer: 'cus_C', status: 'paid', currency: 'ugx', total: 500, amount_paid: 500 },
  ], has_more: false }));
  const factures = await stripe.lire({ objet: 'invoices' }, STRIPE_CLE, p.f);
  assert.equal(p.appels[0]?.url.href, 'https://api.stripe.com/v1/invoices?limit=100');
  assert.deepEqual([factures[0]?.champs.number, factures[0]?.champs.total, factures[0]?.champs.status, factures[0]?.champs.due_date], ['F-2026-001', '120.00', 'open', '']);
  assert.equal(factures[1]?.champs.total, '5000', 'devise sans décimale');
  // cas particulier documenté par Stripe : le shilling ougandais s'écrit sur deux décimales (5 UGX = 500) ; avant : 500
  assert.equal(factures[2]?.champs.total, '5.00');
});

test('Stripe : mise à jour (formulaire, adresse partielle complétée) et création ; factures en lecture seule', async () => {
  const { f, appels } = simuler((a) => (a.methode === 'GET' ? json(client('cus_A')) : json({ id: a.url.pathname.endsWith('/customers') ? 'cus_NEW' : 'cus_A', object: 'customer' })));
  assert.equal(await stripe.ecrire?.({ objet: 'customers' }, STRIPE_CLE, 'cus_A', { name: 'Ty Coz SARL', 'address.city': 'Vannes', 'metadata.siret': '12345678900029', balance: '0', created: '2026-01-01', phone: '' }, f), 'cus_A');
  assert.deepEqual(appels.map((a) => `${a.methode} ${a.url.href}`), ['GET https://api.stripe.com/v1/customers/cus_A', 'POST https://api.stripe.com/v1/customers/cus_A']);
  const maj = appels[1];
  assert.equal(maj?.entetes.get('content-type'), 'application/x-www-form-urlencoded');
  assert.equal(maj?.entetes.get('authorization'), `Bearer ${STRIPE_CLE}`);
  assert.deepEqual(maj?.corps, { name: 'Ty Coz SARL', 'address[line1]': '1 quai', 'address[postal_code]': '56100', 'address[city]': 'Vannes', 'address[country]': 'FR', 'metadata[siret]': '12345678900029' });
  appels.length = 0;
  assert.equal(await stripe.ecrire?.({ objet: 'customers' }, STRIPE_CLE, null, { name: 'Camping Les Dunes', email: 'dunes@ex.test', preferred_locales: 'fr, en' }, f), 'cus_NEW');
  assert.equal(appels.length, 1);
  assert.equal(appels[0]?.url.href, 'https://api.stripe.com/v1/customers');
  assert.equal(appels[0]?.brut, 'name=Camping+Les+Dunes&email=dunes%40ex.test&preferred_locales%5B0%5D=fr&preferred_locales%5B1%5D=en');
  appels.length = 0;
  assert.equal(await stripe.ecrire?.({ objet: 'customers' }, STRIPE_CLE, 'cus_A', { balance: '12' }, f), 'cus_A');
  assert.equal(appels.length, 0, 'rien à écrire : aucun appel');
  await assert.rejects(stripe.ecrire?.({ objet: 'invoices' }, STRIPE_CLE, 'in_1', { number: 'x' }, f) ?? Promise.resolve(), /lecture seule/);
  await assert.rejects(stripe.ecrire?.({ objet: 'customers' }, STRIPE_CLE, 'cus_A/../x', { name: 'x' }, f) ?? Promise.resolve(), /invalide/);
  await assert.rejects(stripe.ecrire?.({ objet: 'customers' }, STRIPE_CLE, null, { 'address.city': 'Brest' }, f) ?? Promise.resolve(), /nom ou e-mail/);
  assert.equal(appels.length, 0);
});

test('Stripe : clé refusée ou droits insuffisants → messages lisibles ; clé publiable refusée sans appel', async () => {
  await assert.rejects(stripe.lire({ objet: 'customers' }, ['sk', 'live', 'faussecle1234'].join('_'), simuler(() => json({ error: { type: 'invalid_request_error', message: 'Invalid API Key provided' } }, 401)).f), /^Error: Stripe : clé refusée/);
  await assert.rejects(stripe.lire({ objet: 'invoices' }, STRIPE_CLE, simuler(() => json({ error: { message: 'The provided key does not have the required permissions' } }, 403)).f), /Stripe : droits insuffisants/);
  const { f, appels } = simuler(() => json({ data: [] }));
  await assert.rejects(stripe.lire({ objet: 'customers' }, 'pk_live_abcdefghijkl', f), /clé publiable/);
  await assert.rejects(stripe.lire({ objet: 'customers' }, 'mauvais format', f), /clé invalide/);
  await assert.rejects(stripe.lire({ objet: 'charges' }, STRIPE_CLE, f), /customers .*ou invoices/);
  assert.equal(appels.length, 0);
});

// ---------------------------------------------------------------- WooCommerce

// IP publique littérale : `verifierUrl` s'applique sans résolution DNS (aucun réseau dans les tests).
const CK = 'ck_0123456789abcdef0123456789abcdef01234567';
const CS = 'cs_76543210fedcba9876543210fedcba9876543210';
const WOO = { boutique: 'https://203.0.114.20/boutique/wp-json/', objet: 'customers', cle: CK };
const WOO_API = 'https://203.0.114.20/boutique/wp-json/wc/v3';

test('WooCommerce : adresse de la boutique vérifiée (anti-SSRF) avant tout appel', async () => {
  const { f, appels } = simuler(() => json([]));
  for (const [boutique, motif] of [['http://203.0.114.20', /https/], ['https://10.0.0.5', /privée/], ['https://127.0.0.1', /privée/], ['https://[::1]', /privée/], ['https://admin:mdp@203.0.114.20', /identifiant/], ['', /manquante|invalide/]] as const) {
    await assert.rejects(woocommerce.lire({ ...WOO, boutique }, CS, f), motif, boutique);
  }
  assert.equal(appels.length, 0);
});

test('WooCommerce : clients lus page par page (X-WP-TotalPages), Basic clé:secret ; produits et commandes en lecture', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, email: `c${i + 1}@ex.test`, first_name: 'Anne', last_name: `Client ${i + 1}`, role: 'customer', billing: { company: 'Ty Coz', city: 'Lorient', phone: '0297000000' }, shipping: { city: 'Lorient' }, meta_data: [{ key: '_secret_plugin', value: 'x' }], avatar_url: 'https://x', _links: { self: [] } }));
  const { f, appels } = simuler((a) => (a.url.searchParams.get('page') === '1'
    ? json(page1, 200, { 'x-wp-total': '101', 'x-wp-totalpages': '2' })
    : json([{ id: 101, email: 'dernier@ex.test', first_name: 'Yann', last_name: 'Kervella', billing: { city: 'Brest' } }], 200, { 'x-wp-total': '101', 'x-wp-totalpages': '2' })));
  const r = await woocommerce.lire(WOO, CS, f);
  assert.deepEqual(appels.map((a) => a.url.href), [`${WOO_API}/customers?per_page=100&page=1&orderby=id&order=asc`, `${WOO_API}/customers?per_page=100&page=2&orderby=id&order=asc`]);
  for (const a of appels) { assert.equal(a.methode, 'GET'); assert.equal(a.entetes.get('authorization'), basic(CK, CS)); }
  aucunSecretDansUrl(appels, CS);
  aucunSecretDansUrl(appels, CK);
  assert.equal(r.length, 101);
  const c = r[0]?.champs ?? {};
  assert.equal(c.nom_complet, 'Anne Client 1');
  assert.equal(c['billing.city'], 'Lorient');
  assert.equal(c['billing.company'], 'Ty Coz');
  for (const k of ['meta_data', 'avatar_url', '_links', 'id']) assert.equal(k in c, false, k);
  assert.equal(r[100]?.externeId, '101');
  const p = simuler((a) => json(a.url.pathname.endsWith('/orders')
    ? [{ id: 9, number: '1009', status: 'processing', currency: 'EUR', total: '89.00', date_created: '2026-11-02T10:00:00', billing: { first_name: 'Anne', last_name: 'Le Goff', company: '', email: 'anne@ex.test' } }]
    : [{ id: 4, name: 'Kouign-amann', sku: 'KA-01', price: '4.50', stock_quantity: 12, status: 'publish', categories: [{ id: 1, name: 'Pâtisserie' }, { id: 2, name: 'Breton' }] }]));
  const produits = await woocommerce.lire({ ...WOO, objet: 'products' }, CS, p.f);
  assert.equal(p.appels[0]?.url.pathname, '/boutique/wp-json/wc/v3/products');
  assert.deepEqual([produits[0]?.champs.name, produits[0]?.champs.price, produits[0]?.champs.stock_quantity, produits[0]?.champs.categories], ['Kouign-amann', '4.50', '12', 'Pâtisserie, Breton']);
  const commandes = await woocommerce.lire({ ...WOO, objet: 'orders' }, CS, p.f);
  assert.deepEqual([commandes[0]?.externeId, commandes[0]?.champs.number, commandes[0]?.champs.total, commandes[0]?.champs.client], ['9', '1009', '89.00', 'Anne Le Goff']);
});

test('WooCommerce : client mis à jour (PUT, adresse partielle) et créé (POST, e-mail exigé) ; produits en lecture seule', async () => {
  const { f, appels } = simuler((a) => json({ id: a.methode === 'POST' ? 55 : 7 }, a.methode === 'POST' ? 201 : 200));
  assert.equal(await woocommerce.ecrire?.(WOO, CS, '7', { nom_complet: 'Anne-Marie Le Goff', 'billing.city': 'Brest', 'billing.phone': '', role: 'administrator', 'meta_data': 'x' }, f), '7');
  assert.equal(appels[0]?.methode, 'PUT');
  assert.equal(appels[0]?.url.href, `${WOO_API}/customers/7`);
  assert.equal(appels[0]?.entetes.get('authorization'), basic(CK, CS));
  assert.deepEqual(appels[0]?.corps, { first_name: 'Anne-Marie', last_name: 'Le Goff', billing: { city: 'Brest' } });
  assert.equal(await woocommerce.ecrire?.(WOO, CS, null, { email: 'nouveau@ex.test', first_name: 'Yann', 'billing.company': 'Camping Les Dunes' }, f), '55');
  assert.equal(appels[1]?.methode, 'POST');
  assert.equal(appels[1]?.url.href, `${WOO_API}/customers`);
  assert.deepEqual(appels[1]?.corps, { email: 'nouveau@ex.test', first_name: 'Yann', billing: { company: 'Camping Les Dunes' } });
  await assert.rejects(woocommerce.ecrire?.(WOO, CS, null, { first_name: 'Sans e-mail' }, f) ?? Promise.resolve(), /e-mail du client manquant/);
  await assert.rejects(woocommerce.ecrire?.({ ...WOO, objet: 'products' }, CS, '4', { name: 'x' }, f) ?? Promise.resolve(), /lecture seule/);
  await assert.rejects(woocommerce.ecrire?.(WOO, CS, '7/../1', { email: 'x@y.test' }, f) ?? Promise.resolve(), /invalide/);
  assert.equal(appels.length, 2);
});

test('WooCommerce : clé refusée ou redirection → messages lisibles ; clé mal formée refusée sans appel', async () => {
  await assert.rejects(woocommerce.lire(WOO, CS, simuler(() => json({ code: 'woocommerce_rest_authentication_error', message: 'Consumer key is invalid.' }, 401)).f), /^Error: WooCommerce : clé ou secret refusés/);
  await assert.rejects(woocommerce.lire(WOO, CS, simuler(() => new Response('', { status: 301, headers: { location: 'https://www.ailleurs.test/' } })).f), /WooCommerce : l’adresse redirige ailleurs/);
  const { f, appels } = simuler(() => json([]));
  await assert.rejects(woocommerce.lire({ ...WOO, cle: 'cle-sans-prefixe' }, CS, f), /Clé client WooCommerce invalide/);
  await assert.rejects(woocommerce.lire(WOO, 'secret-sans-prefixe', f), /secret client invalide/);
  await assert.rejects(woocommerce.lire(WOO, null, f), /jeton manquant/);
  assert.equal(appels.length, 0);
});

// ---------------------------------------------------------------- PrestaShop

const PS_CLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456';
const PS = { boutique: 'https://203.0.114.30', objet: 'customers' };

test('PrestaShop : clients lus par tranches (limit=début,nombre), clé en Basic, sortie JSON ; mot de passe et jetons jamais importés', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, firstname: 'Anne', lastname: `Client ${i + 1}`, email: `c${i + 1}@ex.test`, company: 'Ty Coz', passwd: '$2y$10$hache', secure_key: 'abc', reset_password_token: 'tok', last_passwd_gen: '2026-01-01', associations: { groups: [{ id: '3' }] }, active: '1' }));
  const { f, appels } = simuler((a) => json(a.url.searchParams.get('limit') === '0,100' ? { customers: page1 } : { customers: [{ id: 101, firstname: 'Yann', lastname: 'Kervella', email: 'y@ex.test' }] }));
  const r = await prestashop.lire(PS, PS_CLE, f);
  assert.equal(appels.length, 2);
  assert.equal(`${appels[0]?.url.origin}${appels[0]?.url.pathname}`, 'https://203.0.114.30/api/customers');
  assert.deepEqual(Object.fromEntries(appels[0]?.url.searchParams ?? []), { output_format: 'JSON', display: 'full', sort: '[id_ASC]', limit: '0,100' });
  assert.equal(appels[1]?.url.searchParams.get('limit'), '100,100');
  for (const a of appels) { assert.equal(a.methode, 'GET'); assert.equal(a.entetes.get('authorization'), basic(PS_CLE, '')); }
  aucunSecretDansUrl(appels, PS_CLE);
  assert.equal(r.length, 101);
  const c = r[0]?.champs ?? {};
  assert.equal(c.nom_complet, 'Anne Client 1');
  assert.equal(c.company, 'Ty Coz');
  for (const k of ['passwd', 'secure_key', 'reset_password_token', 'last_passwd_gen', 'associations', 'associations.groups', 'id']) assert.equal(k in c, false, k);
  // produits : champs choisis, nom multilingue → première traduction ; liste vide renvoyée en []
  const p = simuler((a) => json(a.url.searchParams.get('limit') === '0,100' ? { products: [{ id: 4, reference: 'KA-01', name: [{ id: '1', value: '' }, { id: '2', value: 'Kouign-amann' }], price: '4.500000', active: '1' }] } : []));
  const produits = await prestashop.lire({ ...PS, boutique: 'https://203.0.114.30/boutique/api/', objet: 'products' }, PS_CLE, p.f);
  assert.equal(p.appels[0]?.url.pathname, '/boutique/api/products');
  assert.match(p.appels[0]?.url.searchParams.get('display') ?? '', /^\[id,reference,.*name,price/);
  assert.deepEqual(produits, [{ externeId: '4', champs: { reference: 'KA-01', name: 'Kouign-amann', price: '4.500000', active: '1' } }]);
  assert.deepEqual(await prestashop.lire(PS, PS_CLE, simuler(() => json([])).f), []);
});

test('PrestaShop : client mis à jour (PATCH XML partiel, caractères échappés) et créé (POST, mot de passe aléatoire)', async () => {
  const { f, appels } = simuler((a) => json({ customer: { id: a.methode === 'POST' ? '88' : '5' } }, a.methode === 'POST' ? 201 : 200));
  assert.equal(await prestashop.ecrire?.(PS, PS_CLE, '5', { nom_complet: 'Anne Le Goff', company: 'Ty Coz & Fils <SARL>', passwd: 'pirate', secure_key: 'x', note: '' }, f), '5');
  assert.equal(appels[0]?.methode, 'PATCH');
  assert.equal(appels[0]?.url.href, 'https://203.0.114.30/api/customers/5?output_format=JSON');
  assert.equal(appels[0]?.entetes.get('authorization'), basic(PS_CLE, ''));
  assert.equal(appels[0]?.entetes.get('content-type'), 'application/xml');
  assert.equal(appels[0]?.brut, '<?xml version="1.0" encoding="UTF-8"?><prestashop xmlns:xlink="http://www.w3.org/1999/xlink"><customer><id>5</id><company>Ty Coz &amp; Fils &lt;SARL&gt;</company><firstname>Anne</firstname><lastname>Le Goff</lastname></customer></prestashop>');
  assert.equal(await prestashop.ecrire?.(PS, PS_CLE, null, { firstname: 'Yann', lastname: 'Kervella', email: 'yann@ex.test', siret: '12345678900011' }, f), '88');
  assert.equal(appels[1]?.methode, 'POST');
  assert.equal(appels[1]?.url.href, 'https://203.0.114.30/api/customers?output_format=JSON');
  const brut = appels[1]?.brut ?? '';
  assert.match(brut, /<customer><firstname>Yann<\/firstname><lastname>Kervella<\/lastname><email>yann@ex\.test<\/email><siret>12345678900011<\/siret><passwd>[A-Za-z0-9_-]{32}<\/passwd><\/customer>/);
  await prestashop.ecrire?.(PS, PS_CLE, null, { firstname: 'Yann', lastname: 'Kervella', email: 'yann@ex.test' }, f);
  assert.notEqual(/<passwd>(.*)<\/passwd>/.exec(appels[2]?.brut ?? '')?.[1], /<passwd>(.*)<\/passwd>/.exec(brut)?.[1], 'mot de passe différent à chaque création');
  appels.length = 0;
  assert.equal(await prestashop.ecrire?.(PS, PS_CLE, '5', { passwd: 'x', id_default_group: '1' }, f), '5');
  await assert.rejects(prestashop.ecrire?.(PS, PS_CLE, null, { firstname: 'Yann', lastname: 'Kervella' }, f) ?? Promise.resolve(), /prénom, nom et e-mail/);
  await assert.rejects(prestashop.ecrire?.({ ...PS, objet: 'products' }, PS_CLE, '4', { name: 'x' }, f) ?? Promise.resolve(), /lecture seule/);
  await assert.rejects(prestashop.ecrire?.(PS, PS_CLE, '5?x=1', { firstname: 'x' }, f) ?? Promise.resolve(), /invalide/);
  assert.equal(appels.length, 0);
});

test('PrestaShop : clé refusée, PrestaShop 1.7 ou webservice désactivé → messages lisibles ; clé et adresse vérifiées sans appel', async () => {
  await assert.rejects(prestashop.lire(PS, PS_CLE, simuler(() => json({ errors: [{ code: 17, message: 'Authentication key is not active' }] }, 401)).f), /^Error: PrestaShop : clé du webservice refusée/);
  await assert.rejects(prestashop.ecrire?.(PS, PS_CLE, '5', { firstname: 'Anne' }, simuler(() => json({}, 405)).f) ?? Promise.resolve(), /PrestaShop : méthode refusée : la mise à jour \(PATCH\) demande PrestaShop 8/);
  await assert.rejects(prestashop.lire(PS, PS_CLE, simuler(() => json({}, 503)).f), /PrestaShop : webservice désactivé/);
  const { f, appels } = simuler(() => json([]));
  await assert.rejects(prestashop.lire(PS, 'trop-courte', f), /clé du webservice invalide/);
  await assert.rejects(prestashop.lire({ ...PS, boutique: 'https://192.168.1.10' }, PS_CLE, f), /privée/);
  await assert.rejects(prestashop.lire({ ...PS, boutique: 'http://203.0.114.30' }, PS_CLE, f), /https/);
  assert.equal(appels.length, 0);
});

// ---------------------------------------------------------------- Sellsy

const JETON_SELLSY = 'https://login.sellsy.com/oauth2/access-tokens';
const societe = (id: number, extra: Record<string, unknown> = {}) => ({
  id, type: 'client', name: `Société ${id}`, email: `s${id}@ex.test`, phone_number: '+33298000000', legal_france: { siret: '12345678900011', siren: '123456789', vat: 'FR12123456789' },
  social: { linkedin: 'https://linkedin.test/ty' }, owner: { id: 3, type: 'staff' }, _embed: { invoicing_address: { id: 9, address_line_1: '1 quai', postal_code: '29200', city: 'Brest', country_code: 'FR' } }, ...extra,
});

test('Sellsy : jeton « client credentials » obtenu puis gardé en mémoire, sociétés lues par offset « seek »', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => societe(i + 1));
  const { f, appels } = simuler((a) => {
    if (a.url.href === JETON_SELLSY) return json({ token_type: 'Bearer', expires_in: 86400, access_token: 'jeton-sellsy-1' });
    return json(a.url.searchParams.get('offset') ? { data: [societe(101)], pagination: { limit: 100, count: 1, total: 101, offset: 'WyIxMDEiXQ==' } } : { data: page1, pagination: { limit: 100, count: 100, total: 101, offset: 'WyIxMDAiXQ==' } });
  });
  const cfg = { objet: 'clients', clientId: 'client-sellsy-lecture' };
  const r = await sellsy.lire(cfg, 'secret-sellsy', f);
  assert.equal(appels[0]?.url.href, JETON_SELLSY);
  assert.equal(appels[0]?.methode, 'POST');
  assert.equal(appels[0]?.entetes.get('content-type'), 'application/x-www-form-urlencoded');
  assert.deepEqual(appels[0]?.corps, { grant_type: 'client_credentials', client_id: 'client-sellsy-lecture', client_secret: 'secret-sellsy' });
  assert.deepEqual(appels.slice(1).map((a) => a.url.href), [
    'https://api.sellsy.com/v2/companies/search?limit=100&embed%5B%5D=invoicing_address',
    'https://api.sellsy.com/v2/companies/search?limit=100&offset=WyIxMDAiXQ%3D%3D&embed%5B%5D=invoicing_address',
  ]);
  for (const a of appels.slice(1)) {
    assert.equal(a.methode, 'POST');
    assert.equal(a.entetes.get('authorization'), 'Bearer jeton-sellsy-1');
    assert.deepEqual(a.corps, { filters: { type: 'client' } });
  }
  aucunSecretDansUrl(appels, 'secret-sellsy');
  assert.equal(r.length, 101);
  const c = r[0]?.champs ?? {};
  assert.equal(c.name, 'Société 1');
  assert.equal(c['legal_france.siret'], '12345678900011');
  assert.equal(c['social.linkedin'], 'https://linkedin.test/ty');
  assert.equal(c['invoicing_address.city'], 'Brest');
  assert.equal('invoicing_address.id' in c, false);
  assert.equal('_embed.invoicing_address' in c, false);
  // nouvelle lecture : jeton réutilisé, pas de nouvel échange ; fournisseurs : bon filtre
  const q = simuler(() => json({ data: [], pagination: {} }));
  await sellsy.lire({ ...cfg, objet: 'fournisseurs' }, 'secret-sellsy', q.f);
  assert.deepEqual(q.appels.map((a) => a.url.pathname), ['/v2/companies/search']);
  assert.equal(q.appels[0]?.entetes.get('authorization'), 'Bearer jeton-sellsy-1');
  assert.deepEqual(q.appels[0]?.corps, { filters: { type: 'supplier' } });
});

test('Sellsy : mise à jour (PUT, mentions légales partielles complétées) et création (POST, type selon l’objet)', async () => {
  const { f, appels } = simuler((a) => {
    if (a.url.href === JETON_SELLSY) return json({ access_token: 'jeton-sellsy-2', expires_in: 3600 });
    if (a.methode === 'GET') return json(societe(12, { legal_france: { siret: '12345678900011', siren: '123456789', vat: null, ape_naf_code: '5610A' }, social: null }));
    return json(societe(a.methode === 'POST' ? 300 : 12), a.methode === 'POST' ? 201 : 200);
  });
  const cfg = { objet: 'clients', clientId: 'client-sellsy-ecriture' };
  assert.equal(await sellsy.ecrire?.(cfg, 'secret-2', '12', { name: 'Ty Coz SARL', 'legal_france.siret': '12345678900029', 'invoicing_address.city': 'Vannes', type: 'supplier', note: '' }, f), '12');
  assert.deepEqual(appels.map((a) => `${a.methode} ${a.url.href}`), [`POST ${JETON_SELLSY}`, 'GET https://api.sellsy.com/v2/companies/12', 'PUT https://api.sellsy.com/v2/companies/12']);
  assert.equal(appels[2]?.entetes.get('authorization'), 'Bearer jeton-sellsy-2');
  assert.deepEqual(appels[2]?.corps, { name: 'Ty Coz SARL', legal_france: { siret: '12345678900029', siren: '123456789', ape_naf_code: '5610A' } });
  appels.length = 0;
  await sellsy.ecrire?.(cfg, 'secret-2', '12', { email: 'contact@tycoz.test' }, f);
  assert.deepEqual(appels.map((a) => `${a.methode} ${a.url.pathname}`), ['PUT /v2/companies/12'], 'champs simples : pas de relecture');
  assert.deepEqual(appels[0]?.corps, { email: 'contact@tycoz.test' });
  appels.length = 0;
  assert.equal(await sellsy.ecrire?.({ ...cfg, objet: 'fournisseurs' }, 'secret-2', null, { name: 'Scierie du Léon', 'legal_france.siret': '98765432100019' }, f), '300');
  assert.equal(appels[0]?.url.href, 'https://api.sellsy.com/v2/companies');
  assert.deepEqual(appels[0]?.corps, { type: 'supplier', name: 'Scierie du Léon', legal_france: { siret: '98765432100019' } });
  appels.length = 0;
  assert.equal(await sellsy.ecrire?.(cfg, 'secret-2', '12', { type: 'prospect', 'invoicing_address.city': 'Brest' }, f), '12');
  await assert.rejects(sellsy.ecrire?.(cfg, 'secret-2', null, { email: 'x@y.test' }, f) ?? Promise.resolve(), /nom de la société manquant/);
  await assert.rejects(sellsy.ecrire?.(cfg, 'secret-2', 'abc', { name: 'x' }, f) ?? Promise.resolve(), /invalide/);
  assert.equal(appels.length, 0);
});

test('Sellsy : identifiants refusés → message lisible ; jeton refusé par l’API oublié puis redemandé', async () => {
  await assert.rejects(sellsy.lire({ objet: 'clients', clientId: 'client-sellsy-faux' }, 'mauvais', simuler(() => json({ error: 'invalid_client' }, 401)).f), /^Error: Sellsy : identifiant ou secret client refusés/);
  let jetons = 0;
  const { f, appels } = simuler((a) => {
    if (a.url.href === JETON_SELLSY) return json({ access_token: `jeton-${++jetons}`, expires_in: 3600 });
    return a.entetes.get('authorization') === 'Bearer jeton-1' ? json({ error: { code: 401, message: 'Unauthorized' } }, 401) : json({ data: [], pagination: {} });
  });
  const cfg = { objet: 'prospects', clientId: 'client-sellsy-revoque' };
  await assert.rejects(sellsy.lire(cfg, 's', f), /Sellsy : accès refusé/);
  await sellsy.lire(cfg, 's', f);
  assert.equal(jetons, 2, 'jeton refusé : nouvel échange à la synchronisation suivante');
  assert.equal(appels.at(-1)?.entetes.get('authorization'), 'Bearer jeton-2');
  await assert.rejects(sellsy.lire({ objet: 'clients', clientId: 'client-sellsy-quota' }, 's', simuler((a) => json(a.url.href === JETON_SELLSY ? { access_token: 'j' } : {}, a.url.href === JETON_SELLSY ? 200 : 429)).f), /Sellsy : quota de requêtes/);
  const p = simuler(() => json({}));
  await assert.rejects(sellsy.lire({ objet: 'clients', clientId: 'x' }, 's', p.f), /Identifiant client Sellsy invalide/);
  await assert.rejects(sellsy.lire({ objet: 'clients', clientId: 'client-sellsy-ok' }, null, p.f), /jeton manquant/);
  assert.equal(p.appels.length, 0);
});
