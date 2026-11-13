/**
 * Connecteurs : rapprochement par le nom sans détournement de fiche, secrets enregistrés qui ne partent jamais vers une
 * autre destination, relais OAuth lié à la connexion. `fetch` simulé, valeurs factices construites ici, aucun réseau.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { RelaisOAuth, type ConnexionOAuth } from './oauth-relais.ts';

process.env.LB_AUTORISER_LOCAL = '1'; // outils simulés sur http://127.0.0.1 (ce fichier tourne dans son propre processus)

const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const faux = (prefixe: string) => `${prefixe}-${'x'.repeat(24)}`; // faux secret, fabriqué à l'exécution
interface Appel { url: URL; methode: string; corps: any; auth: string | null }

function outils() {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    const methode = init?.method ?? 'GET';
    const h = new Headers(init?.headers);
    appels.push({ url: u, methode, corps: init?.body ? JSON.parse(String(init.body)) : null, auth: h.get('authorization') });
    if (u.hostname === 'app.pennylane.com' && methode === 'GET') return json({ items: [{ id: 101, name: 'Restaurant Ty Coz', customer_type: 'company', emails: ['compta@tycoz.test'], billing_address: { address: '', postal_code: '', city: 'Lorient', country_alpha2: 'FR' } }], has_more: false, next_cursor: null });
    if (u.hostname === 'app.pennylane.com') return json({ id: 101 });
    // boutique WooCommerce publique : un inconnu s'est inscrit avec la raison sociale du vrai client
    if (u.pathname.startsWith('/boutique/')) return json([{ id: 7, email: 'pirate@exfil.example', first_name: 'A', last_name: 'B', billing: { company: 'RESTAURANT TY-COZ', email: 'pirate@exfil.example' } }]);
    if (u.port === '4190') return json([{ id: 'r1', nom: 'Menuiserie du Port', email: 'contact@port.test', ville: 'Brest' }]);
    return json([]);
  }) as typeof fetch;
  return { appels, f };
}

async function preparer() {
  const o = outils();
  const app = await Application.creer({ exemple: 'pme', fetch: o.f });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  app.monde.viderDemo(p, 's', { nom: 'Test' });
  return { app, p, ...o };
}

test('rapprochement : une fiche tenue par un autre outil n’est jamais détournée par un homonyme', async () => {
  const { app, p, appels } = await preparer();
  const pl = app.synchro.creer(p, { source: 'pennylane', config: { objet: 'clients', jeton: faux('pl') }, typeObjet: 'entreprise', roles: ['client'], mapping: { name: '__nom', emails: 'email' }, sens: 'deux', intervalleS: 3600, actif: false });
  await app.synchro.synchroniser(pl.id, p);
  const woo = app.synchro.creer(p, { source: 'woocommerce', config: { boutique: 'http://127.0.0.1:4191/boutique', objet: 'customers', cle: `ck_${'0'.repeat(20)}`, jeton: `cs_${'0'.repeat(20)}` }, typeObjet: 'entreprise', roles: ['client'], mapping: { 'billing.company': '__nom', email: 'email' }, sens: 'lecture', intervalleS: 3600, actif: false });
  await app.synchro.synchroniser(woo.id, p);
  const entreprises = app.monde.objetsReels().filter((o) => o.type === 'entreprise');
  const vrai = entreprises.find((o) => o.nom === 'Restaurant Ty Coz');
  assert.equal(vrai?.champs.email, 'compta@tycoz.test', 'e-mail du vrai client intact');
  assert.equal(entreprises.length, 2, 'fiche à part pour l’homonyme de la boutique');
  appels.length = 0;
  await app.synchro.synchroniser(pl.id, p);
  assert.equal(JSON.stringify(appels.map((a) => a.corps)).includes('pirate@exfil.example'), false, 'rien de l’inconnu ne repart vers Pennylane');
});

test('rapprochement : une fiche saisie dans le jeu est complétée, jamais écrasée ; e-mails différents = pas de lien', async () => {
  const { app, p } = await preparer();
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Menuiserie du Port', roles: ['client'], champs: { email: 'compta@port.test' } });
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Menuiserie du Port bis', roles: ['client'], champs: {} });
  const rest = app.synchro.creer(p, { source: 'rest', config: { url: 'http://127.0.0.1:4190/clients' }, typeObjet: 'entreprise', roles: ['client'], mapping: { nom: '__nom', ville: 'ville' }, sens: 'lecture', intervalleS: 3600, actif: false });
  await app.synchro.synchroniser(rest.id, p);
  const fiche = app.monde.objetsReels().filter((o) => o.nom === 'Menuiserie du Port');
  assert.equal(fiche.length, 1, 'rattachée (pas de doublon)');
  assert.equal(fiche[0]?.champs.email, 'compta@port.test', 'rien d’écrasé');
  assert.equal(fiche[0]?.champs.ville, 'Brest', 'champ vide complété');
  // e-mail connu des deux côtés et différent : aucun lien, une fiche à part
  const avecEmail = app.synchro.creer(p, { source: 'rest', config: { url: 'http://127.0.0.1:4190/autre' }, typeObjet: 'entreprise', roles: ['client'], mapping: { nom: '__nom', email: 'email' }, sens: 'lecture', intervalleS: 3600, actif: false });
  await app.synchro.synchroniser(avecEmail.id, p);
  const toutes = app.monde.objetsReels().filter((o) => o.nom === 'Menuiserie du Port');
  assert.equal(toutes.length, 2);
  assert.ok(toutes.some((o) => o.champs.email === 'compta@port.test'), 'la fiche d’origine garde son e-mail');
});

test('secret enregistré : jamais vers un autre outil ni une autre adresse ; effacé si l’adresse change', async () => {
  const { app, p, appels } = await preparer();
  const secret = faux('jeton-rest');
  const c = app.synchro.creer(p, { source: 'rest', config: { url: 'http://127.0.0.1:4190/clients', jeton: secret }, typeObjet: 'entreprise', roles: ['client'], mapping: { nom: '__nom' }, sens: 'lecture', intervalleS: 3600, actif: false });
  appels.length = 0;
  await assert.rejects(app.synchro.apercu(p, { id: c.id, source: 'rest', config: { url: 'http://127.0.0.1:4199/vol' }, typeObjet: 'entreprise' }), (e: any) => e.code === 'secret_a_ressaisir');
  await assert.rejects(app.synchro.apercu(p, { id: c.id, source: 'hubspot', config: { objet: 'companies' }, typeObjet: 'entreprise' }), (e: any) => e.code === 'source_differente');
  await assert.rejects(app.synchro.choix(p, { id: c.id, source: 'airtable', champ: 'base', config: {} }), (e: any) => e.code === 'source_differente');
  assert.equal(appels.length, 0, 'aucun appel : le secret n’est parti nulle part');
  // même adresse : le secret enregistré sert à l'essai
  await app.synchro.apercu(p, { id: c.id, source: 'rest', config: {}, typeObjet: 'entreprise' });
  assert.equal(appels.at(-1)?.auth, `Bearer ${secret}`);
  assert.equal(appels.at(-1)?.url.port, '4190');
  // modification de l'adresse sans nouvelle clé : la clé enregistrée est effacée
  const v = app.synchro.modifier(p, c.id, { config: { url: 'http://127.0.0.1:4199/vol' } });
  assert.equal(v.aSecret, false);
  appels.length = 0;
  await app.synchro.synchroniser(c.id, p).catch(() => undefined);
  assert.equal(appels.some((a) => a.auth?.includes(secret)), false, 'jamais envoyé à la nouvelle adresse');
});

test('clé d’API : les réglages des connecteurs sont refusés (écran seulement), la liste reste lisible', async () => {
  const { app } = await preparer();
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  try {
    const s = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId: 'dirigeante' }) });
    const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] as string;
    const k = await (await fetch(`${base}/api/v1/cles`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ nom: 'Robot', profilId: 'dirigeante' }) })).json() as { jeton: string };
    const avecCle = (m: string, c: string, corps?: unknown) => fetch(`${base}/api/v1${c}`, { method: m, headers: { authorization: `Bearer ${k.jeton}`, 'content-type': 'application/json' }, body: corps === undefined ? null : JSON.stringify(corps) });
    assert.equal((await avecCle('GET', '/synchro')).status, 200);
    assert.equal((await avecCle('POST', '/synchro/apercu', { source: 'rest', config: { url: 'http://127.0.0.1:4199/' }, typeObjet: 'entreprise' })).status, 403);
    assert.equal((await avecCle('POST', '/synchro/choix', { source: 'airtable', champ: 'base' })).status, 403);
    assert.equal((await avecCle('PUT', '/synchro/cx-000000000000', { config: {} })).status, 403);
  } finally {
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});

test('relais OAuth : code de la demande affiché, jeton de rafraîchissement jamais envoyé à un autre relais', async () => {
  const appels: Appel[] = [];
  let adresse = 'http://127.0.0.1:4180';
  const f = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    appels.push({ url: u, methode: init?.method ?? 'GET', corps: init?.body ? JSON.parse(String(init.body)) : null, auth: null });
    if (u.pathname === '/v0/oauth/demarrer') return json({ url: 'https://app.hubspot.com/oauth/authorize?client_id=hs&state=s1', attente: 'A'.repeat(43), expire: new Date(Date.now() + 600_000).toISOString(), verification: 'ABCD-2345' });
    if (u.pathname === '/v0/oauth/retrait') return json({ statut: 'connecte', fournisseur: 'hubspot', jetons: { acces: faux('acces'), rafraichissement: faux('rafr'), expire: null } });
    if (u.pathname === '/v0/oauth/rafraichir') return json({ acces: faux('acces2'), expire: null });
    return json({}, 404);
  }) as typeof fetch;
  const relais = new RelaisOAuth({ adresse: () => adresse, fetch: f });
  const d = await relais.demarrer('hubspot', {});
  assert.equal(d.verification, 'ABCD-2345');
  assert.equal(appels.at(-1)?.corps.codeAffiche, true, 'le jeu déclare afficher le code');
  const r = await relais.retrait('hubspot', d.attente);
  assert.equal(r.statut, 'connecte');
  const c = (r as { connexion: ConnexionOAuth }).connexion;
  assert.equal(c.relais, 'http://127.0.0.1:4180', 'connexion liée au relais qui l’a remise');
  // l'adresse de Breizhcosystem change (réglage modifié) : le jeton de rafraîchissement ne part pas
  adresse = 'http://127.0.0.1:4181';
  const n = appels.length;
  await assert.rejects(relais.rafraichir(c), /adresse de Breizhcosystem a changé/);
  assert.equal(appels.length, n, 'aucun envoi au nouveau relais');
  adresse = 'http://127.0.0.1:4180';
  const nouveau = await relais.rafraichir(c);
  assert.equal(appels.at(-1)?.url.port, '4180');
  assert.equal(nouveau.relais, 'http://127.0.0.1:4180');
});

test('revue-jeu-1-2 : lien par homonymie — l’inconnu n’inscrit rien sur la vraie fiche et ne reçoit rien tant qu’un administrateur n’a pas confirmé', async () => {
  const { app, p, appels } = await preparer();
  // la vraie fiche, saisie dans le jeu, sans e-mail ; la boutique publique contient un inconnu inscrit sous la même raison sociale
  const vraie = app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Restaurant Ty Coz', roles: ['client'], champs: { ville: 'Lorient' } }) as { id: string };
  const woo = app.synchro.creer(p, { source: 'woocommerce', config: { boutique: 'http://127.0.0.1:4191/boutique', objet: 'customers', cle: `ck_${'0'.repeat(20)}`, jeton: `cs_${'0'.repeat(20)}` }, typeObjet: 'entreprise', roles: ['client'], mapping: { 'billing.company': '__nom', email: 'email' }, sens: 'deux', intervalleS: 3600, actif: false });
  await app.synchro.synchroniser(woo.id, p);
  const fiche = () => app.monde.objetReel(vraie.id)!;
  assert.equal(app.monde.objetsReels().filter((o) => o.type === 'entreprise').length, 1, 'rattachée par le nom (pas de doublon)');
  assert.equal(fiche().champs.email, undefined, 'avant : l’e-mail de l’inconnu venait remplir le champ vide de la vraie fiche');

  // la vraie fiche change dans le jeu (un e-mail, une adresse) : rien ne part vers la boutique
  const a = await app.monde.preparerAction(p, 's', { cle: 'cle-modif-tycoz1', cible: vraie.id, capacite: 'objet.modifier', parametres: { champs: { email: 'compta@tycoz.test' } }, executer: true });
  assert.equal(a.etat, 'reussie_technique');
  appels.length = 0;
  await app.synchro.synchroniser(woo.id, p);
  assert.deepEqual(appels.filter((x) => x.methode !== 'GET'), [], 'avant : les données de la vraie fiche partaient chez l’inconnu');
  assert.equal(fiche().champs.email, 'compta@tycoz.test');

  // l'administrateur voit les deux côtés et tranche
  assert.equal(app.synchro.lister(p).find((c) => c.id === woo.id)?.aConfirmer, 1);
  const [r] = app.synchro.rapprochements(p).rapprochements;
  assert.deepEqual([r?.connecteur, r?.externeId, r?.fiche.id, r?.fiche.email, r?.cote.email], [woo.id, '7', vraie.id, 'compta@tycoz.test', 'pirate@exfil.example']);
  const collegue = app.monde.profil('commerciale') ?? app.monde.profil('chef_chantier');
  if (collegue && !collegue.peutAdministrer) assert.throws(() => app.synchro.rapprochements(collegue), (e: any) => e.statut === 403);
  assert.deepEqual(app.synchro.deciderRapprochement(p, woo.id, { externeId: '7', decision: 'separer' }), { ok: true, decision: 'separer', restants: 0 });
  assert.throws(() => app.synchro.deciderRapprochement(p, woo.id, { externeId: '7', decision: 'separer' }), (e: any) => e.statut === 404);
  appels.length = 0;
  await app.synchro.synchroniser(woo.id, p);
  const entreprises = app.monde.objetsReels().filter((o) => o.type === 'entreprise');
  assert.equal(entreprises.length, 2, 'l’inconnu a désormais sa propre fiche, et n’est plus jamais rapproché par le nom');
  assert.equal(fiche().champs.email, 'compta@tycoz.test', 'la vraie fiche est intacte');
  // dans les deux sens, la vraie fiche est créée À PART dans la boutique, comme toute fiche du jeu : jamais écrite sur le compte de l'inconnu
  const ecritures = appels.filter((x) => x.methode !== 'GET');
  assert.equal(ecritures.some((x) => /\/customers\/7(\D|$)/.test(x.url.pathname)), false, 'aucune écriture sur l’enregistrement de l’inconnu');
  assert.ok(ecritures.every((x) => x.methode === 'POST'), 'seulement des créations');
});

test('revue-jeu-1-2 : même e-mail des deux côtés = lien sûr d’emblée ; un lien confirmé par l’administrateur devient un lien ordinaire', async () => {
  const { app, p, appels } = await preparer();
  // même nom ET même e-mail que dans l'outil : c'est la même entreprise, rien à confirmer
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Restaurant Ty Coz', roles: ['client'], champs: { email: 'pirate@exfil.example' } });
  const woo = app.synchro.creer(p, { source: 'woocommerce', config: { boutique: 'http://127.0.0.1:4191/boutique', objet: 'customers', cle: `ck_${'0'.repeat(20)}`, jeton: `cs_${'0'.repeat(20)}` }, typeObjet: 'entreprise', roles: ['client'], mapping: { 'billing.company': '__nom', email: 'email' }, sens: 'lecture', intervalleS: 3600, actif: false });
  await app.synchro.synchroniser(woo.id, p);
  assert.equal(app.monde.objetsReels().filter((o) => o.type === 'entreprise').length, 1);
  assert.equal(app.synchro.lister(p).find((c) => c.id === woo.id)?.aConfirmer, 0);

  // homonyme sans identifiant commun, confirmé par l'administrateur : la fiche part ensuite vers l'outil comme les autres
  const fiche = app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Menuiserie du Port', roles: ['client'], champs: {} }) as { id: string };
  const rest = app.synchro.creer(p, { source: 'rest', config: { url: 'http://127.0.0.1:4190/clients', urlEcriture: 'http://127.0.0.1:4190/clients' }, typeObjet: 'entreprise', roles: ['client'], mapping: { nom: '__nom', ville: 'ville', email: 'email' }, sens: 'lecture', intervalleS: 3600, actif: false });
  await app.synchro.synchroniser(rest.id, p);
  assert.equal(app.monde.objetReel(fiche.id)?.champs.ville, 'Brest', 'un champ sans risque (la ville) est complété');
  assert.equal(app.monde.objetReel(fiche.id)?.champs.email, undefined, 'pas l’e-mail, tant que le lien n’est pas confirmé');
  assert.equal(app.synchro.deciderRapprochement(p, rest.id, { externeId: 'r1', decision: 'confirmer' }).decision, 'confirmer');
  appels.length = 0;
  await app.synchro.synchroniser(rest.id, p);
  assert.equal(app.monde.objetReel(fiche.id)?.champs.email, 'contact@port.test', 'lien confirmé : la fiche suit l’outil');
  assert.equal(app.synchro.lister(p).find((c) => c.id === rest.id)?.aConfirmer, 0);
});
