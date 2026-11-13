/** Dynamics 365 Sales (Dataverse) et Business Central : `fetch` simulé, aucun appel réseau. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configAvecConnexion } from './oauth-relais.ts';
import { annuaireDuJeton, businessCentral, dynamics365 } from './sources-dynamics.ts';
import { ADAPTATEURS } from './sources.ts';

interface Appel { url: URL; methode: string; entetes: Headers; corps: any }
function simuler(repondre: (a: Appel) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: init?.body ? JSON.parse(String(init.body)) : null };
    appels.push(a);
    return repondre(a);
  }) as typeof fetch;
  return { f, appels };
}
const json = (corps: unknown, statut = 200) => new Response(corps === null ? null : JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
const ORG = 'https://kerlann.crm4.dynamics.com';
const A1 = '11111111-1111-4111-8111-111111111111';
const A2 = '22222222-2222-4222-8222-222222222222';
const TID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CIE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const jwt = `x.${Buffer.from(JSON.stringify({ tid: TID })).toString('base64url')}.y`;

test('Dynamics 365 : lecture paginée (même hôte seulement), mise à jour et création', async () => {
  assert.equal(ADAPTATEURS.dynamics365, dynamics365);
  const { f, appels } = simuler((a) => {
    assert.equal(a.entetes.get('authorization'), 'Bearer jeton-dv');
    if (a.methode === 'GET' && !a.url.searchParams.has('$skiptoken')) return json({ value: [{ accountid: A1, name: 'Cave du Port', address1_city: 'Brest' }], '@odata.nextLink': `${ORG}/api/data/v9.2/accounts?$skiptoken=2` });
    if (a.methode === 'GET') return json({ value: [{ accountid: A2, name: 'Hôtel Ty Mad', address1_city: 'Douarnenez' }, { accountid: 'pas-un-guid', name: 'x' }], '@odata.nextLink': 'https://evil.example/suite' });
    if (a.methode === 'PATCH') return json(null, 204);
    return json({ accountid: '33333333-3333-4333-8333-333333333333', name: 'Nouveau' }, 201);
  });
  const cfg = { organisation: 'https://Kerlann.crm4.dynamics.com/', objet: 'accounts' };
  const lus = await dynamics365.lire(cfg, 'jeton-dv', f);
  assert.deepEqual(lus.map((l) => [l.externeId, l.champs.name, l.champs.address1_city]), [[A1, 'Cave du Port', 'Brest'], [A2, 'Hôtel Ty Mad', 'Douarnenez']]);
  assert.equal(appels.length, 2, 'lien de page vers un autre hôte ignoré');
  assert.match(appels[0]!.url.searchParams.get('$select') ?? '', /^accountid,name,/);
  await dynamics365.ecrire?.(cfg, 'jeton-dv', A1, { address1_city: 'Quimper', champ_inconnu: 'x', 'name; drop': 'y' }, f);
  const p = appels.find((a) => a.methode === 'PATCH')!;
  assert.equal(p.url.pathname, `/api/data/v9.2/accounts(${A1})`);
  assert.deepEqual(p.corps, { address1_city: 'Quimper' }, 'seuls les champs connus partent');
  assert.equal(p.entetes.get('if-match'), '*', 'pas de création silencieuse par PATCH');
  assert.equal(await dynamics365.ecrire?.(cfg, 'jeton-dv', null, { name: 'Nouveau' }, f), '33333333-3333-4333-8333-333333333333');
  await assert.rejects(dynamics365.lire({ organisation: 'https://evil.example', objet: 'accounts' }, 'j', f), /organisation Dynamics 365/);
});

test('Business Central : annuaire lu dans le jeton, liste des entreprises, lecture, modification avec ETag', async () => {
  assert.equal(annuaireDuJeton(jwt), TID);
  assert.throws(() => annuaireDuJeton('pas.un.jeton'), /illisible/);
  const { f, appels } = simuler((a) => {
    const p = decodeURIComponent(a.url.pathname);
    if (p.endsWith('/api/v2.0/companies')) return json({ value: [{ id: CIE, displayName: 'Menuiserie Kerlann SAS' }] });
    if (p.endsWith(`companies(${CIE})/customers`) && a.methode === 'GET') return json({ value: [{ id: A1, number: 'C0001', displayName: 'Cave du Port', city: 'Brest', balanceDue: 1200 }] });
    if (p.endsWith(`customers(${A1})`) && a.methode === 'GET') return json({ id: A1, '@odata.etag': 'W/"JzQ0OzE7Jw=="' });
    if (a.methode === 'PATCH') return json({ id: A1 });
    return json({ id: A2 }, 201);
  });
  const ent = await businessCentral.choix?.('entreprise', {}, jwt, f);
  assert.deepEqual(ent, [{ valeur: CIE, libelle: 'Menuiserie Kerlann SAS' }]);
  assert.equal(appels[0]!.url.pathname, `/v2.0/${TID}/production/api/v2.0/companies`);
  const cfg = { entreprise: CIE, objet: 'customers' };
  const lus = await businessCentral.lire(cfg, jwt, f);
  // le solde d'un client s'appelle « balanceDue » chez Business Central (API v2.0) : avant, la colonne restait vide
  assert.deepEqual([lus[0]!.externeId, lus[0]!.champs.displayName, lus[0]!.champs.balance], [A1, 'Cave du Port', '1200']);
  await businessCentral.ecrire?.(cfg, jwt, A1, { city: 'Quimper', balance: 0 }, f);
  const patch = appels.find((a) => a.methode === 'PATCH')!;
  assert.equal(patch.entetes.get('if-match'), 'W/"JzQ0OzE7Jw=="');
  assert.deepEqual(patch.corps, { city: 'Quimper' }, 'solde en lecture seule');
  assert.equal(await businessCentral.ecrire?.(cfg, jwt, null, { displayName: 'Nouveau client' }, f), A2);
  await assert.rejects(businessCentral.lire({ objet: 'customers' }, jwt, f), /Choisissez l’entreprise/);
});

test('connexion par le relais : l’organisation Dynamics vient du compte connecté', () => {
  const r = configAvecConnexion({ objet: 'accounts' }, { fournisseur: 'dynamics', acces: 'a', rafraichissement: 'r', expire: null, extra: { organisation: ORG } });
  assert.equal(r.organisation, ORG);
});
