/**
 * Connecteurs natifs Pennylane, Qonto, Odoo, Pipedrive, Shopify : `fetch` simulé, aucun appel réseau.
 * Pour chaque outil : requêtes vérifiées (méthode, adresse, en-têtes, corps), lecture paginée, écriture
 * (création + mise à jour) et erreur d'authentification lisible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';
import { odoo, pennylane, pipedrive, qonto, shopify } from './sources-metier.ts';
import { ADAPTATEURS } from './sources.ts';

interface Appel { url: URL; methode: string; entetes: Headers; corps: any }

/** `fetch` simulé : note chaque appel et laisse le test répondre. */
function simuler(repondre: (a: Appel, n: number) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: init?.body ? JSON.parse(String(init.body)) : null };
    appels.push(a);
    return repondre(a, appels.length - 1);
  }) as typeof fetch;
  return { f, appels };
}
const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
const aucunSecretDansUrl = (appels: Appel[], secret: string) => { for (const a of appels) assert.equal(a.url.href.includes(secret), false, `secret dans l’adresse : ${a.url.href}`); };

// ---------------------------------------------------------------- catalogue

test('catalogue : les 5 connecteurs natifs sont branchés, en français, avec un champ secret', () => {
  for (const id of ['pennylane', 'qonto', 'odoo', 'pipedrive', 'shopify'] as const) {
    const a = ADAPTATEURS[id];
    assert.equal(a.id, id);
    assert.equal(a.lecture, 'appel');
    assert.equal(a.ecriture, true);
    assert.ok(a.etapes.length >= 3 && a.etapes.every((e) => e.length > 20), `${id} : étapes`);
    assert.equal(a.champs.filter((c) => c.secret).length, 1, `${id} : un seul secret`);
    assert.ok(a.champs.some((c) => c.exemple), `${id} : exemple`);
  }
  assert.equal(ADAPTATEURS.pennylane, pennylane);
});

// ---------------------------------------------------------------- Pennylane

test('Pennylane : clients lus page par page (curseur), jeton Bearer, IBAN et liens techniques jamais importés', async () => {
  const { f, appels } = simuler((a) => a.url.searchParams.get('cursor') === 'page-2'
    ? json({ items: [{ id: 102, name: 'Jean Dupont', customer_type: 'individual', first_name: 'Jean', last_name: 'Dupont', emails: [], billing_address: { address: '', postal_code: '', city: 'Quimper', country_alpha2: 'FR' } }], has_more: false, next_cursor: null })
    : json({ items: [{ id: 101, name: 'Crêperie Ty Gwenn', customer_type: 'company', emails: ['contact@tygwenn.test', 'compta@tygwenn.test'], phone: '0298000000', reg_no: '123456789', billing_iban: 'FR7612345', ledger_account: { id: 9 }, mandates: { url: 'https://x' }, billing_address: { address: '1 quai', postal_code: '29200', city: 'Brest', country_alpha2: 'FR' } }], has_more: true, next_cursor: 'page-2' }));
  const r = await pennylane.lire({ objet: 'clients' }, 'pl-secret', f);
  assert.equal(appels.length, 2);
  assert.equal(appels[0]?.url.href, 'https://app.pennylane.com/api/external/v2/customers?limit=100');
  assert.equal(appels[1]?.url.searchParams.get('cursor'), 'page-2');
  for (const a of appels) { assert.equal(a.methode, 'GET'); assert.equal(a.entetes.get('authorization'), 'Bearer pl-secret'); }
  aucunSecretDansUrl(appels, 'pl-secret');
  assert.deepEqual(r.map((x) => x.externeId), ['101', '102']);
  const c = r[0]?.champs ?? {};
  assert.equal(c.name, 'Crêperie Ty Gwenn');
  assert.equal(c.emails, 'contact@tygwenn.test, compta@tygwenn.test');
  assert.equal(c['billing_address.city'], 'Brest');
  assert.equal(c.reg_no, '123456789');
  for (const k of ['billing_iban', 'ledger_account.id', 'mandates.url', 'id']) assert.equal(k in c, false, k);
  const s = await pennylane.lire({ objet: 'fournisseurs' }, 'pl-secret', simuler(() => json({ items: [{ id: 7, name: 'Négoce Ar Vro', iban: 'FR76', postal_address: { city: 'Brest' } }], has_more: false })).f);
  assert.deepEqual(s, [{ externeId: '7', champs: { name: 'Négoce Ar Vro', 'postal_address.city': 'Brest' } }]);
});

test('Pennylane : mise à jour (bon point selon le type, adresse complétée) et création de clients et fournisseurs', async () => {
  const { f, appels } = simuler((a) => {
    if (a.methode === 'GET' && a.url.pathname.endsWith('/customers')) {
      const filtre = JSON.parse(a.url.searchParams.get('filter') ?? '[]');
      return filtre[0]?.value === '555'
        ? json({ items: [{ id: 555, customer_type: 'individual', billing_address: { address: '3 rue Neuve', postal_code: '56100', city: 'Lorient', country_alpha2: 'FR' } }], has_more: false })
        : json({ items: [], has_more: false });
    }
    if (a.methode === 'GET') return json({ items: [{ id: 8, name: 'Grossiste', postal_address: { address: 'ZA du Port', postal_code: '44600', city: 'Saint-Nazaire', country_alpha2: 'FR' } }], has_more: false });
    return json({ id: a.methode === 'POST' ? 900 : 1 }, a.methode === 'POST' ? 201 : 200);
  });
  // client particulier inconnu : type lu dans Pennylane, nom découpé, adresse partielle complétée par l'actuelle
  assert.equal(await pennylane.ecrire?.({ objet: 'clients' }, 'pl-secret', '555', { name: 'Anne Le Goff', 'billing_address.city': 'Vannes', emails: 'anne@ex.test; anne2@ex.test', customer_type: 'company', created_at: 'x', notes: '' }, f), '555');
  const put = appels.find((a) => a.methode === 'PUT');
  assert.equal(put?.url.href, 'https://app.pennylane.com/api/external/v2/individual_customers/555');
  assert.deepEqual(put?.corps, { first_name: 'Anne', last_name: 'Le Goff', emails: ['anne@ex.test', 'anne2@ex.test'], billing_address: { address: '3 rue Neuve', postal_code: '56100', city: 'Vannes', country_alpha2: 'FR' } });
  assert.equal(put?.entetes.get('content-type'), 'application/json');
  // création d'un client entreprise : adresse de facturation exigée, pays FR par défaut
  appels.length = 0;
  assert.equal(await pennylane.ecrire?.({ objet: 'clients' }, 'pl-secret', null, { name: 'Hôtel des Embruns', 'billing_address.city': 'Quiberon', reg_no: '987654321' }, f), '900');
  assert.equal(appels.length, 1);
  assert.equal(appels[0]?.methode, 'POST');
  assert.equal(appels[0]?.url.href, 'https://app.pennylane.com/api/external/v2/company_customers');
  assert.deepEqual(appels[0]?.corps, { name: 'Hôtel des Embruns', reg_no: '987654321', billing_address: { address: '', postal_code: '', city: 'Quiberon', country_alpha2: 'FR' } });
  // le client créé est une entreprise : sa mise à jour part sans relire le type
  appels.length = 0;
  await pennylane.ecrire?.({ objet: 'clients' }, 'pl-secret', '900', { name: 'Hôtel des Embruns SARL' }, f);
  assert.deepEqual(appels.map((a) => `${a.methode} ${a.url.pathname}`), ['PUT /api/external/v2/company_customers/900']);
  // fournisseurs
  appels.length = 0;
  await pennylane.ecrire?.({ objet: 'fournisseurs' }, 'pl-secret', '8', { name: 'Grossiste Atlantique', 'postal_address.city': 'Nantes' }, f);
  assert.equal(appels.at(-1)?.url.href, 'https://app.pennylane.com/api/external/v2/suppliers/8');
  assert.deepEqual(appels.at(-1)?.corps, { name: 'Grossiste Atlantique', postal_address: { address: 'ZA du Port', postal_code: '44600', city: 'Nantes', country_alpha2: 'FR' } });
  appels.length = 0;
  assert.equal(await pennylane.ecrire?.({ objet: 'fournisseurs' }, 'pl-secret', null, { name: 'Scierie du Léon', emails: 'scierie@ex.test' }, f), '900');
  assert.deepEqual(appels[0]?.corps, { name: 'Scierie du Léon', emails: ['scierie@ex.test'] });
  await assert.rejects(pennylane.ecrire?.({ objet: 'clients' }, 'pl-secret', '../me', { name: 'x' }, f) ?? Promise.resolve(), /invalide/);
});

test('Pennylane : jeton refusé ou limite de débit → messages lisibles', async () => {
  await assert.rejects(pennylane.lire({ objet: 'clients' }, 'perime', simuler(() => json({ error: 'unauthorized' }, 401)).f), /^Error: Pennylane : jeton refusé/);
  await assert.rejects(pennylane.lire({ objet: 'clients' }, 'x', simuler(() => json({}, 429)).f), /Pennylane : trop de requêtes/);
  await assert.rejects(pennylane.lire({ objet: 'clients' }, null, simuler(() => json({})).f), /jeton manquant/);
  await assert.rejects(pennylane.lire({ objet: 'factures' }, 'x', simuler(() => json({})).f), /clients ou fournisseurs/);
});

// ---------------------------------------------------------------- Qonto

const QONTO_A = '3f1c2b4a-1111-4222-8333-944455556666';
const QONTO_B = '3f1c2b4a-1111-4222-8333-944455557777';

test('Qonto : clients lus page par page, en-tête « identifiant:clé », particuliers et téléphone mis en forme', async () => {
  const { f, appels } = simuler((a) => a.url.searchParams.get('page') === '1'
    ? json({ clients: [{ id: QONTO_A, kind: 'company', name: 'Camping Les Dunes', email: 'dunes@ex.test', phone: { country_code: '+33', number: '612345678' }, billing_address: { street_address: '2 route de la plage', city: 'Crozon', zip_code: '29160', country_code: 'FR' }, city: 'obsolète', type: 'company', currency: 'EUR' }], meta: { current_page: 1, next_page: 2 } })
    : json({ clients: [{ id: QONTO_B, kind: 'individual', first_name: 'Yann', last_name: 'Kervella', email: null }], meta: { current_page: 2, next_page: null } }));
  const r = await qonto.lire({ identifiant: 'ma-societe-1234' }, 'cle-secrete', f);
  assert.deepEqual(appels.map((a) => a.url.href), ['https://thirdparty.qonto.com/v2/clients?per_page=100&page=1', 'https://thirdparty.qonto.com/v2/clients?per_page=100&page=2']);
  for (const a of appels) assert.equal(a.entetes.get('authorization'), 'ma-societe-1234:cle-secrete');
  aucunSecretDansUrl(appels, 'cle-secrete');
  assert.equal(r.length, 2);
  assert.equal(r[0]?.externeId, QONTO_A);
  assert.equal(r[0]?.champs.phone, '+33 612345678');
  assert.equal(r[0]?.champs['billing_address.city'], 'Crozon');
  assert.equal('city' in (r[0]?.champs ?? {}), false, 'champs d’adresse obsolètes ignorés');
  assert.equal(r[1]?.champs.name, 'Yann Kervella');
});

test('Qonto : mise à jour (PATCH, adresse complétée) et création (POST, devise et langue par défaut)', async () => {
  const { f, appels } = simuler((a) => {
    if (a.methode === 'GET' && a.url.pathname === '/v2/clients') return json({ clients: [{ id: QONTO_B, kind: 'individual', first_name: 'Yann', last_name: 'Kervella' }], meta: { next_page: null } });
    if (a.methode === 'GET') return json({ client: { id: QONTO_A, billing_address: { street_address: '2 route de la plage', city: 'Crozon', zip_code: '29160', country_code: 'FR' } } });
    return json({ client: { id: a.methode === 'POST' ? QONTO_B : QONTO_A } });
  });
  assert.equal(await qonto.ecrire?.({ identifiant: 'ma-societe-1234' }, 'cle-secrete', QONTO_A, { name: 'Camping Les Dunes SAS', 'billing_address.city': 'Camaret-sur-Mer', phone: '06', kind: 'individual' }, f), QONTO_A);
  const patch = appels.find((a) => a.methode === 'PATCH');
  assert.equal(patch?.url.href, `https://thirdparty.qonto.com/v2/clients/${QONTO_A}`);
  assert.equal(patch?.entetes.get('authorization'), 'ma-societe-1234:cle-secrete');
  assert.deepEqual(patch?.corps, { name: 'Camping Les Dunes SAS', billing_address: { street_address: '2 route de la plage', city: 'Camaret-sur-Mer', zip_code: '29160', country_code: 'FR' } });
  appels.length = 0;
  assert.equal(await qonto.ecrire?.({ identifiant: 'ma-societe-1234' }, 'cle-secrete', null, { name: 'Négoce Ar Vro', email: 'contact@arvro.test', vat_number: 'FR12345678901' }, f), QONTO_B);
  assert.equal(appels[0]?.methode, 'POST');
  assert.equal(appels[0]?.url.href, 'https://thirdparty.qonto.com/v2/clients');
  assert.deepEqual(appels[0]?.corps, { kind: 'company', currency: 'EUR', locale: 'fr', name: 'Négoce Ar Vro', email: 'contact@arvro.test', vat_number: 'FR12345678901' });
  // un particulier lu : son nom est envoyé en prénom / nom
  await qonto.lire({ identifiant: 'ma-societe-1234' }, 'cle-secrete', f);
  appels.length = 0;
  await qonto.ecrire?.({ identifiant: 'ma-societe-1234' }, 'cle-secrete', QONTO_B, { name: 'Yann Le Kervella' }, f);
  assert.deepEqual(appels[0]?.corps, { first_name: 'Yann', last_name: 'Le Kervella' });
});

test('Qonto : clé refusée → message lisible ; identifiant invalide refusé sans appel', async () => {
  await assert.rejects(qonto.lire({ identifiant: 'ma-societe-1234' }, 'mauvaise', simuler(() => json({ errors: [{ code: 'unauthorized' }] }, 401)).f), /Qonto : identifiant ou clé secrète refusés/);
  await assert.rejects(qonto.lire({ identifiant: 'ma-societe-1234' }, 'x', simuler(() => json({}, 403)).f), /Qonto : accès refusé/);
  const { f, appels } = simuler(() => json({}));
  await assert.rejects(qonto.lire({ identifiant: 'a:b' }, 'x', f), /Identifiant Qonto invalide/);
  await assert.rejects(qonto.lire({ identifiant: 'ma-societe' }, 'avec:deux-points', f), /clé secrète invalide/);
  assert.equal(appels.length, 0);
});

// ---------------------------------------------------------------- Odoo

// IP publique littérale : `verifierUrl` s'applique sans résolution DNS (aucun réseau dans les tests).
const ODOO = { url: 'https://203.0.114.10/odoo', base: 'maboite', identifiant: 'gerant@maboite.test', objet: 'clients' };

test('Odoo : adresse vérifiée (anti-SSRF) avant tout appel', async () => {
  const { f, appels } = simuler(() => json({ result: 2 }));
  for (const [url, motif] of [['http://203.0.114.10', /https/], ['https://10.0.0.5', /privée/], ['https://192.168.1.20:8069', /privée/], ['https://[::1]', /privée/], ['https://admin:mdp@203.0.114.10', /identifiant/], ['', /manquante|invalide/]] as const) {
    await assert.rejects(odoo.lire({ ...ODOO, url }, 'cle', f), motif, url);
  }
  assert.equal(appels.length, 0);
});

test('Odoo : connexion JSON-RPC puis search_read paginé, relations et champs vides lisibles', async () => {
  const page1 = Array.from({ length: 200 }, (_, i) => ({ id: i + 1, name: `Client ${i + 1}`, email: false, city: 'Brest', country_id: [75, 'France'], is_company: true }));
  const { f, appels } = simuler((a) => {
    if (a.corps.params.service === 'common') return json({ jsonrpc: '2.0', id: 1, result: 7 });
    const offset = a.corps.params.args[6].offset;
    return json({ jsonrpc: '2.0', id: 1, result: offset === 0 ? page1 : [{ id: 201, name: 'Dernier', email: 'x@y.test', country_id: false }] });
  });
  const r = await odoo.lire(ODOO, 'cle-api-odoo', f);
  assert.equal(appels.length, 3);
  for (const a of appels) { assert.equal(a.methode, 'POST'); assert.equal(a.url.href, 'https://203.0.114.10/jsonrpc'); assert.equal(a.corps.jsonrpc, '2.0'); assert.equal(a.corps.method, 'call'); }
  aucunSecretDansUrl(appels, 'cle-api-odoo');
  assert.deepEqual(appels[0]?.corps.params, { service: 'common', method: 'login', args: ['maboite', 'gerant@maboite.test', 'cle-api-odoo'] });
  const [base, uid, cle, modele, methode, args, kwargs] = appels[1]?.corps.params.args;
  assert.deepEqual([base, uid, cle, modele, methode], ['maboite', 7, 'cle-api-odoo', 'res.partner', 'search_read']);
  assert.deepEqual(args, [[['customer_rank', '>', 0]]]);
  assert.deepEqual(kwargs, { fields: ['name', 'is_company', 'email', 'phone', 'street', 'street2', 'zip', 'city', 'country_id', 'vat', 'website', 'ref'], limit: 200, offset: 0, order: 'id asc' });
  assert.equal(appels[2]?.corps.params.args[6].offset, 200);
  assert.equal(r.length, 201);
  assert.deepEqual(r[0], { externeId: '1', champs: { name: 'Client 1', email: '', city: 'Brest', country_id: 'France', is_company: 'true' } });
  assert.equal(r[200]?.champs.country_id, '');
  // fournisseurs et produits : bons modèle et domaine
  const p = simuler((a) => json({ result: a.corps.params.service === 'common' ? 7 : [] }));
  await odoo.lire({ ...ODOO, objet: 'produits' }, 'k', p.f);
  assert.deepEqual(p.appels[1]?.corps.params.args.slice(3, 6), ['product.template', 'search_read', [[]]]);
  await odoo.lire({ ...ODOO, objet: 'fournisseurs', proprietes: 'name, x_studio_code, bad-name' }, 'k', p.f);
  assert.deepEqual(p.appels[3]?.corps.params.args[5], [[['supplier_rank', '>', 0]]]);
  assert.deepEqual(p.appels[3]?.corps.params.args[6].fields, ['name', 'x_studio_code']);
});

test('Odoo : mise à jour (write) et création (create, rang client), relations jamais écrites', async () => {
  const { f, appels } = simuler((a) => {
    if (a.corps.params.service === 'common') return json({ result: 7 });
    return json({ result: a.corps.params.args[4] === 'create' ? 77 : true });
  });
  assert.equal(await odoo.ecrire?.(ODOO, 'k', '42', { name: 'Ty Coz', city: 'Quimper', country_id: 'France', is_company: 'oui', customer_rank: 0, email: '' }, f), '42');
  assert.equal(appels.length, 2);
  assert.deepEqual(appels[1]?.corps.params.args.slice(3), ['res.partner', 'write', [[42], { name: 'Ty Coz', city: 'Quimper', is_company: true }], {}]);
  appels.length = 0;
  assert.equal(await odoo.ecrire?.(ODOO, 'k', null, { name: 'Nouveau client', phone: '02 98 00 00 00' }, f), '77');
  assert.deepEqual(appels[1]?.corps.params.args.slice(3, 6), ['res.partner', 'create', [{ name: 'Nouveau client', phone: '02 98 00 00 00', customer_rank: 1 }]]);
  appels.length = 0;
  await odoo.ecrire?.({ ...ODOO, objet: 'produits' }, 'k', '5', { name: 'Bois de chêne', list_price: '12,50', categ_id: 'Bois' }, f);
  assert.deepEqual(appels[1]?.corps.params.args.slice(3, 6), ['product.template', 'write', [[5], { name: 'Bois de chêne', list_price: 12.5 }]]);
  appels.length = 0;
  assert.equal(await odoo.ecrire?.(ODOO, 'k', '42', { country_id: 'France' }, f), '42');
  assert.equal(appels.length, 0, 'rien à écrire : aucun appel');
});

test('Odoo : clé refusée ou droits insuffisants → messages lisibles', async () => {
  await assert.rejects(odoo.lire(ODOO, 'mauvaise', simuler(() => json({ jsonrpc: '2.0', id: 1, result: false })).f), /Odoo refuse l’identifiant ou la clé d’API/);
  const refus = { jsonrpc: '2.0', id: 1, error: { code: 200, message: 'Odoo Server Error', data: { name: 'odoo.exceptions.AccessDenied', message: 'Access Denied', debug: 'Traceback…' } } };
  await assert.rejects(odoo.lire(ODOO, 'mauvaise', simuler(() => json(refus)).f), (e: Error) => /Odoo refuse/.test(e.message) && !e.message.includes('Traceback'));
  const droits = { error: { message: 'Odoo Server Error', data: { name: 'odoo.exceptions.AccessError', message: 'You are not allowed to access Contact records.' } } };
  await assert.rejects(odoo.lire(ODOO, 'k', simuler((a) => json(a.corps.params.service === 'common' ? { result: 7 } : droits)).f), /Odoo : droits insuffisants/);
  await assert.rejects(odoo.lire(ODOO, 'k', simuler(() => json({}, 404)).f), /Odoo : adresse introuvable/);
});

// ---------------------------------------------------------------- Pipedrive

test('Pipedrive : organisations lues par curseur, en-tête x-api-token, adresse et champs personnalisés aplatis', async () => {
  const { f, appels } = simuler((a) => a.url.searchParams.get('cursor')
    ? json({ success: true, data: [{ id: 12, name: 'Hôtel des Embruns', address: null }], additional_data: { next_cursor: null } })
    : json({ success: true, data: [{ id: 11, name: 'Ty Coz', owner_id: 3, address: { value: '1 quai, 56100 Lorient', locality: 'Lorient', postal_code: '56100', country: 'France' }, label_ids: [1, 2], custom_fields: { a1b2: 'Restauration' } }], additional_data: { next_cursor: 'c-2' } }));
  const r = await pipedrive.lire({ objet: 'organizations', domaine: 'https://monentreprise.pipedrive.com/' }, 'pd-jeton', f);
  assert.deepEqual(appels.map((a) => a.url.href), ['https://monentreprise.pipedrive.com/api/v2/organizations?limit=500', 'https://monentreprise.pipedrive.com/api/v2/organizations?limit=500&cursor=c-2']);
  for (const a of appels) { assert.equal(a.methode, 'GET'); assert.equal(a.entetes.get('x-api-token'), 'pd-jeton'); }
  aucunSecretDansUrl(appels, 'pd-jeton');
  assert.deepEqual(r.map((x) => x.externeId), ['11', '12']);
  assert.deepEqual(r[0]?.champs, { name: 'Ty Coz', owner_id: '3', address: '1 quai, 56100 Lorient', 'address.locality': 'Lorient', 'address.postal_code': '56100', 'address.country': 'France', label_ids: '1, 2', 'custom_fields.a1b2': 'Restauration' });
  const p = simuler(() => json({ success: true, data: [{ id: 5, name: 'Anne', emails: [{ value: 'perso@ex.test', primary: false }, { value: 'pro@ex.test', primary: true }], phones: [] }], additional_data: {} }));
  const personnes = await pipedrive.lire({ objet: 'persons' }, 'pd-jeton', p.f);
  assert.equal(p.appels[0]?.url.href, 'https://api.pipedrive.com/api/v2/persons?limit=500');
  assert.equal(personnes[0]?.champs.email, 'pro@ex.test');
  assert.equal(personnes[0]?.champs.emails, 'perso@ex.test, pro@ex.test');
});

test('Pipedrive : mise à jour (PATCH) et création (POST) aux formats v2', async () => {
  const { f, appels } = simuler((a) => json({ success: true, data: { id: a.methode === 'POST' ? 99 : 7 } }));
  assert.equal(await pipedrive.ecrire?.({ objet: 'persons' }, 'pd-jeton', '7', { name: 'Anne Le Goff', email: 'anne@ex.test', phone: '0298000000', org_id: '3' }, f), '7');
  assert.equal(appels[0]?.methode, 'PATCH');
  assert.equal(appels[0]?.url.href, 'https://api.pipedrive.com/api/v2/persons/7');
  assert.equal(appels[0]?.entetes.get('x-api-token'), 'pd-jeton');
  assert.deepEqual(appels[0]?.corps, { name: 'Anne Le Goff', emails: [{ value: 'anne@ex.test', primary: true, label: 'work' }], phones: [{ value: '0298000000', primary: true, label: 'work' }] });
  assert.equal(await pipedrive.ecrire?.({ objet: 'organizations' }, 'pd-jeton', null, { name: 'Camping Les Dunes', address: 'Crozon', owner_id: '1' }, f), '99');
  assert.equal(appels[1]?.methode, 'POST');
  assert.equal(appels[1]?.url.href, 'https://api.pipedrive.com/api/v2/organizations');
  assert.deepEqual(appels[1]?.corps, { name: 'Camping Les Dunes', address: { value: 'Crozon' } });
  await pipedrive.ecrire?.({ objet: 'deals' }, 'pd-jeton', null, { title: 'Chantier Brest', value: '12 500', currency: 'EUR' }, f);
  assert.deepEqual(appels[2]?.corps, { title: 'Chantier Brest', value: 12500, currency: 'EUR' });
  await assert.rejects(pipedrive.ecrire?.({ objet: 'organizations' }, 'pd-jeton', null, { address: 'Brest' }, f) ?? Promise.resolve(), /nom manquant/);
});

test('Pipedrive : jeton refusé → message lisible ; domaine étranger refusé sans appel', async () => {
  await assert.rejects(pipedrive.lire({ objet: 'organizations' }, 'faux', simuler(() => json({ success: false, error: 'unauthorized access' }, 401)).f), /Pipedrive : jeton d’API refusé/);
  await assert.rejects(pipedrive.lire({ objet: 'deals' }, 'x', simuler(() => json({}, 429)).f), /Pipedrive : trop de requêtes/);
  const { f, appels } = simuler(() => json({}));
  for (const domaine of ['evil.com/x', 'a.b', 'monentreprise.pipedrive.com.evil.com', '-x']) await assert.rejects(pipedrive.lire({ objet: 'organizations', domaine }, 'x', f), /Domaine Pipedrive invalide/, domaine);
  assert.equal(appels.length, 0);
});

// ---------------------------------------------------------------- Shopify

const SHOP = { boutique: 'ma-boutique.myshopify.com', objet: 'customers' };
const GRAPHQL = 'https://ma-boutique.myshopify.com/admin/api/2026-10/graphql.json';
const client = (id: number, extra: Record<string, unknown> = {}) => ({
  id: `gid://shopify/Customer/${id}`, firstName: 'Anne', lastName: 'Le Goff', displayName: 'Anne Le Goff', note: null, tags: ['vip', 'b2b'], state: 'ENABLED', numberOfOrders: '3',
  defaultEmailAddress: { emailAddress: 'anne@ex.test' }, defaultPhoneNumber: null, amountSpent: { amount: '120.50', currencyCode: 'EUR' }, defaultAddress: { company: 'Ty Coz', city: 'Lorient', zip: '56100' }, ...extra,
});

test('Shopify : clients lus par curseur (GraphQL Admin), jeton dans X-Shopify-Access-Token', async () => {
  const { f, appels } = simuler((a) => a.corps.variables.apres
    ? json({ data: { customers: { nodes: [client(2, { firstName: 'Yann', displayName: 'Yann Le Goff' })], pageInfo: { hasNextPage: false, endCursor: null } } } })
    : json({ data: { customers: { nodes: [client(1)], pageInfo: { hasNextPage: true, endCursor: 'curseur-1' } } }, extensions: { cost: { requestedQueryCost: 300, throttleStatus: { currentlyAvailable: 1700, restoreRate: 100 } } } }));
  const r = await shopify.lire({ boutique: 'Ma-Boutique' }, 'shpat_abc', f).catch((e: Error) => e);
  assert.match(String(r), /customers, products ou orders/);
  const lus = await shopify.lire(SHOP, 'shpat_abc', f);
  assert.equal(appels.length, 2);
  for (const a of appels) {
    assert.equal(a.methode, 'POST');
    assert.equal(a.url.href, GRAPHQL);
    assert.equal(a.entetes.get('x-shopify-access-token'), 'shpat_abc');
    assert.match(a.corps.query, /customers\(first: \$n, after: \$apres/);
  }
  aucunSecretDansUrl(appels, 'shpat_abc');
  assert.deepEqual(appels.map((a) => a.corps.variables), [{ n: 100, apres: null }, { n: 100, apres: 'curseur-1' }]);
  assert.deepEqual(lus.map((x) => x.externeId), ['gid://shopify/Customer/1', 'gid://shopify/Customer/2']);
  const c = lus[0]?.champs ?? {};
  assert.equal(c.displayName, 'Anne Le Goff');
  assert.equal(c.email, 'anne@ex.test');
  assert.equal(c.phone, '');
  assert.equal(c.tags, 'vip, b2b');
  assert.equal(c.city, 'Lorient');
  assert.equal(c.amountSpent, '120.50');
  // produits et commandes en lecture
  const p = simuler((a) => json({ data: { [a.corps.query.includes('orders(') ? 'orders' : 'products']: { nodes: a.corps.query.includes('orders(')
    ? [{ id: 'gid://shopify/Order/9', name: '#1009', displayFinancialStatus: 'PAID', totalPriceSet: { shopMoney: { amount: '89.00', currencyCode: 'EUR' } }, customer: { displayName: 'Anne Le Goff' } }]
    : [{ id: 'gid://shopify/Product/4', title: 'Kouign-amann', status: 'ACTIVE', totalInventory: 12, priceRangeV2: { minVariantPrice: { amount: '4.50', currencyCode: 'EUR' } } }], pageInfo: { hasNextPage: false } } } }));
  const produits = await shopify.lire({ ...SHOP, objet: 'products' }, 'shpat_abc', p.f);
  assert.equal(produits[0]?.champs.title, 'Kouign-amann');
  assert.equal(produits[0]?.champs.price, '4.50');
  assert.equal(produits[0]?.champs.totalInventory, '12');
  const commandes = await shopify.lire({ ...SHOP, objet: 'orders' }, 'shpat_abc', p.f);
  assert.deepEqual([commandes[0]?.externeId, commandes[0]?.champs.name, commandes[0]?.champs.total, commandes[0]?.champs.customer], ['gid://shopify/Order/9', '#1009', '89.00', 'Anne Le Goff']);
});

test('Shopify : application du Dev Dashboard — secret client échangé contre un jeton (client credentials), gardé 24 h', async () => {
  const { f, appels } = simuler((a) => a.url.pathname === '/admin/oauth/access_token'
    ? json({ access_token: 'shpat_temporaire', scope: 'read_customers', expires_in: 86399 })
    : json({ data: { customers: { nodes: [], pageInfo: { hasNextPage: false } } } }));
  const cfg = { ...SHOP, boutique: 'https://boutique-cc.myshopify.com/admin', clientId: '0123456789abcdef0123456789abcdef' };
  await shopify.lire(cfg, 'shpss_secret', f);
  await shopify.lire(cfg, 'shpss_secret', f);
  assert.deepEqual(appels.map((a) => a.url.href), ['https://boutique-cc.myshopify.com/admin/oauth/access_token', 'https://boutique-cc.myshopify.com/admin/api/2026-10/graphql.json', 'https://boutique-cc.myshopify.com/admin/api/2026-10/graphql.json']);
  assert.equal(appels[0]?.methode, 'POST');
  assert.deepEqual(appels[0]?.corps, { grant_type: 'client_credentials', client_id: '0123456789abcdef0123456789abcdef', client_secret: 'shpss_secret' });
  assert.equal(appels[1]?.entetes.get('x-shopify-access-token'), 'shpat_temporaire');
  assert.equal(appels[2]?.entetes.get('x-shopify-access-token'), 'shpat_temporaire', 'jeton réutilisé, pas de nouvel échange');
  aucunSecretDansUrl(appels, 'shpss_secret');
  await assert.rejects(shopify.lire({ ...cfg, boutique: 'autre-boutique' }, 'shpss_secret', simuler(() => json({ error: 'app_not_installed' }, 400)).f), /Shopify : échange de jeton refusé/);
});

test('Shopify : clients mis à jour (customerUpdate) et créés (customerCreate) ; produits et commandes en lecture seule', async () => {
  const { f, appels } = simuler((a) => json({ data: a.corps.query.includes('customerCreate')
    ? { customerCreate: { customer: { id: 'gid://shopify/Customer/77' }, userErrors: [] } }
    : { customerUpdate: { customer: { id: a.corps.variables.input.id }, userErrors: [] } } }));
  assert.equal(await shopify.ecrire?.(SHOP, 'shpat_abc', 'gid://shopify/Customer/1', { displayName: 'Anne-Marie Le Goff', email: 'am@ex.test', tags: 'vip, fidèle', city: 'Brest', numberOfOrders: '9' }, f), 'gid://shopify/Customer/1');
  assert.equal(appels[0]?.url.href, GRAPHQL);
  assert.equal(appels[0]?.entetes.get('x-shopify-access-token'), 'shpat_abc');
  assert.match(appels[0]?.corps.query, /customerUpdate\(input: \$input\)/);
  assert.deepEqual(appels[0]?.corps.variables, { input: { id: 'gid://shopify/Customer/1', firstName: 'Anne-Marie', lastName: 'Le Goff', email: 'am@ex.test', tags: ['vip', 'fidèle'] } });
  assert.equal(await shopify.ecrire?.(SHOP, 'shpat_abc', null, { firstName: 'Yann', lastName: 'Kervella', phone: '+33612345678' }, f), 'gid://shopify/Customer/77');
  assert.match(appels[1]?.corps.query, /customerCreate\(input: \$input\)/);
  assert.deepEqual(appels[1]?.corps.variables, { input: { firstName: 'Yann', lastName: 'Kervella', phone: '+33612345678' } });
  const refus = simuler(() => json({ data: { customerCreate: { customer: null, userErrors: [{ field: ['email'], message: 'Email has already been taken' }] } } }));
  await assert.rejects(shopify.ecrire?.(SHOP, 'shpat_abc', null, { email: 'anne@ex.test' }, refus.f) ?? Promise.resolve(), /Shopify a refusé : Email has already been taken/);
  await assert.rejects(shopify.ecrire?.({ ...SHOP, objet: 'products' }, 'shpat_abc', null, { title: 'x' }, f) ?? Promise.resolve(), /lecture seule/);
  await assert.rejects(shopify.ecrire?.(SHOP, 'shpat_abc', 'gid://shopify/Order/1', { email: 'x@y.test' }, f) ?? Promise.resolve(), /invalide/);
  assert.equal(appels.length, 2);
});

test('Shopify : jeton refusé, droits ou débit → messages lisibles ; seule une boutique …myshopify.com est appelée', async () => {
  await assert.rejects(shopify.lire(SHOP, 'shpat_faux', simuler(() => json({ errors: '[API] Invalid API key or access token' }, 401)).f), /Shopify : jeton refusé/);
  await assert.rejects(shopify.lire(SHOP, 'shpat_abc', simuler(() => json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] })).f), (e: Error & { statut?: number }) => /Shopify : trop de requêtes/.test(e.message) && e.statut === 429);
  await assert.rejects(shopify.lire(SHOP, 'shpat_abc', simuler(() => json({ errors: [{ message: 'Access denied for customers field.', extensions: { code: 'ACCESS_DENIED' } }] })).f), /Shopify : droits insuffisants/);
  const { f, appels } = simuler(() => json({}));
  for (const boutique of ['evil.com', 'a.b.myshopify.com', 'ma-boutique.myshopify.com.evil.com', 'ma-boutique.fr', 'http://ma-boutique.myshopify.com', '']) {
    await assert.rejects(shopify.lire({ ...SHOP, boutique }, 'shpat_abc', f), /Boutique Shopify/, boutique);
  }
  assert.equal(appels.length, 0);
});

// ---------------------------------------------------------------- de bout en bout dans le jeu

test('synchro Pipedrive de bout en bout : lecture, rapprochement, modification du jeu renvoyée, jeton jamais exposé', async () => {
  const { f, appels } = simuler((a) => a.methode === 'GET'
    ? json({ success: true, data: [{ id: 11, name: 'Restaurant Ty Coz', address: { value: 'Lorient', locality: 'Lorient' } }, { id: 12, name: 'Nouvelle Organisation CRM', address: null }], additional_data: { next_cursor: null } })
    : json({ success: true, data: { id: 11 } }));
  const app = await Application.creer({ exemple: 'pme', fetch: f });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  app.monde.viderDemo(p, 's', { nom: 'Test' });
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Restaurant Ty Coz', roles: ['client'], champs: {} });
  const c = app.synchro.creer(p, { source: 'pipedrive', config: { objet: 'organizations', jeton: 'pd-SECRET' }, typeObjet: 'entreprise', roles: ['client'], mapping: { name: '__nom', 'address.locality': 'ville' }, sens: 'deux', intervalleS: 60 });
  assert.equal(JSON.stringify(app.synchro.lister(p)).includes('pd-SECRET'), false);
  await app.synchro.synchroniser(c.id, p);
  const tycoz = app.monde.objetsReels().filter((o) => o.nom === 'Restaurant Ty Coz');
  assert.equal(tycoz.length, 1, 'rapproché par le nom');
  assert.equal(tycoz[0]?.champs.ville, 'Lorient');
  assert.ok(app.monde.objetsReels().some((o) => o.nom === 'Nouvelle Organisation CRM'));
  // relié par le nom seulement : un administrateur confirme avant que la fiche parte vers l'outil (revue-jeu-1-2)
  assert.equal(app.synchro.deciderRapprochement(p, c.id, { externeId: '11', decision: 'confirmer' }).ok, true);
  const a = await app.monde.preparerAction(p, 's', { cle: 'cle-modif-pd01', cible: tycoz[0]?.id as string, capacite: 'objet.modifier', parametres: { nom: 'Restaurant Ty Coz SARL', champs: {} }, executer: true });
  assert.equal(a.etat, 'reussie_technique');
  appels.length = 0;
  await app.synchro.synchroniser(c.id, p);
  const patch = appels.find((x) => x.methode === 'PATCH');
  assert.equal(patch?.url.href, 'https://api.pipedrive.com/api/v2/organizations/11');
  assert.equal(patch?.corps.name, 'Restaurant Ty Coz SARL');
  assert.equal(patch?.entetes.get('x-api-token'), 'pd-SECRET');
  assert.equal('address.locality' in (patch?.corps ?? {}), false, 'sous-champ d’adresse en lecture seule');
});
