/**
 * Journal et événements de sécurité (constat revue-jeu-1-4) :
 * - les événements de sécurité (export, restauration, clés, accès, comptes, effacements…) sont gardés à part, 12 mois :
 *   l'activité ordinaire (5 000 lignes tournantes) ne les chasse plus ;
 * - une clé d'API a un débit d'écriture borné (600 par 10 minutes, API et MCP confondus) ;
 * - la même case de planning modifiée à la suite ne fait qu'une ligne ;
 * - le journal se lit par pages ; une restauration ne fait pas disparaître le journal de sécurité.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur, ECRITURES_CLE_MAX } from './http.ts';
import type { LigneJournal } from './monde.ts';

const PHRASE = ['une phrase', 'bien assez', 'longue'].join(' ');

async function monter() {
  const app = await Application.creer({ exemple: 'pme' });
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const s = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId: 'dirigeante' }) });
  let cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] as string;
  const ecran = async (m: string, c: string, corps?: unknown) => {
    const r = await fetch(`${base}/api/v1${c}`, { method: m, headers: { cookie, 'content-type': 'application/json', 'x-lb-requete': '1' }, body: corps === undefined ? null : JSON.stringify(corps) });
    return { statut: r.status, json: await r.json().catch(() => null) as any, entetes: r.headers };
  };
  const reconnecter = async () => {
    const r = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId: 'dirigeante' }) });
    cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] as string;
  };
  const avecCle = (jeton: string) => async (m: string, c: string, corps?: unknown) => {
    const r = await fetch(`${base}/api/v1${c}`, { method: m, headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' }, body: corps === undefined ? null : JSON.stringify(corps) });
    return { statut: r.status, json: await r.json().catch(() => null) as any };
  };
  const fermer = () => new Promise<void>((ok) => { serveur.closeAllConnections(); serveur.close(() => ok()); });
  return { app: () => app, base, ecran, avecCle, reconnecter, fermer, appInitiale: app };
}

test('journal de sécurité : l’export et la création d’une clé restent lisibles quand l’activité a rempli le journal', async () => {
  const t = await monter();
  const app = t.appInitiale;
  try {
    assert.equal((await t.ecran('POST', '/sauvegardes/export', { phrase: PHRASE })).statut, 200);
    assert.equal((await t.ecran('POST', '/cles', { nom: 'Robot', profilId: 'responsable-stock' })).statut, 200);
    // 5 200 lignes d'activité ordinaire : le journal tournant (5 000 lignes) a tout chassé
    const yann = app.monde.profil('responsable-stock')!;
    for (let i = 0; i < 5200; i++) app.monde.tracer(yann, 'objet.modifie', 'a-panneaux', `quantite ${i}`);
    assert.equal(app.monde.journalBrut().length, 5000);
    assert.equal(app.monde.journalBrut().some((l) => l.action === 'sauvegarde.exportee' || l.action === 'cle.creee'), false, 'le journal ordinaire a tourné');
    // les événements de sécurité sont toujours là, lisibles par l'API
    const sec = await t.ecran('GET', '/journal?genre=securite');
    assert.equal(sec.statut, 200);
    const actions = (sec.json as LigneJournal[]).map((l) => l.action);
    assert.ok(actions.includes('sauvegarde.exportee'), 'export toujours tracé');
    assert.ok(actions.includes('cle.creee'), 'création de la clé toujours tracée');
    assert.equal((sec.json as LigneJournal[]).some((l) => l.action === 'objet.modifie'), false, 'seulement des événements de sécurité');
    // et ils survivent à un redémarrage (état enregistré)
    const relue = await Application.creer({ etat: app.instantane() });
    assert.ok(relue.monde.journalSecuriteBrut().some((l) => l.action === 'sauvegarde.exportee'));
    // réservé à l'administrateur, comme le journal
    const k = app.cles.creer(app.monde.profil('dirigeante')!, { nom: 'Lecture', profilId: 'responsable-stock' });
    assert.equal((await t.avecCle(k.jeton)('GET', '/journal?genre=securite')).statut, 403);
  } finally { await t.fermer(); }
});

test('journal de sécurité : un état enregistré avant sa création reprend les événements encore présents au journal', async () => {
  const app = await Application.creer({ exemple: 'pme' });
  const dir = app.monde.profil('dirigeante')!;
  app.cles.creer(dir, { nom: 'Ancienne', profilId: 'responsable-stock' });
  const etat = app.instantane();
  delete etat.monde.journalSecurite;
  const relue = await Application.creer({ etat });
  assert.deepEqual(relue.monde.journalSecuriteBrut().map((l) => l.action), ['cle.creee']);
});

test('journal de sécurité : une rafale d’un type d’événement ne chasse que ce type, et 12 mois bornent le reste', async () => {
  let maintenant = new Date('2026-01-10T08:00:00.000Z');
  const app = await Application.creer({ exemple: 'pme', maintenant: () => maintenant });
  const dir = app.monde.profil('dirigeante')!;
  app.monde.tracer(dir, 'sauvegarde.exportee', null, 'copie complète sans la clé des accès');
  maintenant = new Date('2026-06-01T08:00:00.000Z');
  for (let i = 0; i < 2100; i++) app.monde.tracer(dir, 'acces.modifie', null, `profil ${i}`);
  const sec = app.monde.journalSecuriteBrut();
  assert.equal(sec.filter((l) => l.action === 'acces.modifie').length, 2000, 'plafond par type d’événement');
  assert.ok(sec.some((l) => l.action === 'sauvegarde.exportee'), 'la rafale n’a pas chassé la trace de l’export');
  // 12 mois plus tard, la trace de janvier est effacée au premier événement suivant
  maintenant = new Date('2027-01-20T08:00:00.000Z');
  app.monde.tracer(dir, 'cle.revoquee', null, 'Clé d’API « Robot » révoquée');
  assert.equal(app.monde.journalSecuriteBrut().some((l) => l.action === 'sauvegarde.exportee'), false);
  assert.ok(app.monde.journalSecuriteBrut().some((l) => l.action === 'acces.modifie'), 'moins de 12 mois : gardé');
});

test('clé d’API : 600 écritures par 10 minutes au plus (429 ensuite), les lectures restent permises', async () => {
  const t = await monter();
  const app = t.appInitiale;
  try {
    const k = (await t.ecran('POST', '/cles', { nom: 'Robot', profilId: 'responsable-stock' })).json as { jeton: string };
    const cle = t.avecCle(k.jeton);
    const pl = (await cle('GET', '/planning')).json as { lignes: { id: string }[]; jours: string[]; options: { valeur: string }[] };
    const employe = pl.lignes[0]!.id;
    const jour = pl.jours[1]!;
    const lieu = pl.options.map((o) => o.valeur).find((v) => v.startsWith('lieu:'))!;
    let acceptees = 0;
    const refus = new Set<number>();
    for (let lot = 0; lot < 7; lot++) {
      const rs = await Promise.all(Array.from({ length: 100 }, (_, i) => cle('POST', '/planning', { employe, date: jour, valeur: (lot * 100 + i) % 2 ? lieu : '' })));
      for (const r of rs) { if (r.statut === 200) acceptees++; else refus.add(r.statut); }
    }
    assert.equal(acceptees, ECRITURES_CLE_MAX);
    assert.deepEqual([...refus], [429]);
    const dernier = await cle('POST', '/planning', { employe, date: jour, valeur: '' });
    assert.equal(dernier.statut, 429);
    assert.equal(dernier.json?.erreur, 'trop_d_ecritures');
    assert.equal((await cle('GET', '/planning')).statut, 200, 'les lectures ne comptent pas');
    // MCP : même compteur (une écriture de plus est refusée), les outils de lecture passent
    const mcp = (corps: unknown) => fetch(`${t.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k.jeton}` }, body: JSON.stringify(corps) });
    assert.equal((await mcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'affecter_planning', arguments: { employe, date: jour, valeur: '' } } })).status, 429);
    assert.equal((await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'planning', arguments: {} } })).status, 200);
    // une personne à l'écran n'est pas concernée
    assert.equal((await t.ecran('POST', '/planning', { employe, date: jour, valeur: '' })).statut, 200);
    // la même case modifiée 600 fois par la clé : une seule ligne au journal, avec le nombre
    const lignes = app.monde.journalBrut().filter((l) => l.action === 'planning.affecte' && l.cible === employe && l.detail.startsWith(jour));
    const deLaCle = lignes.filter((l) => (l as LigneJournal).canal?.startsWith('cle:'));
    assert.equal(deLaCle.length, 1, 'une ligne pour la rafale de la clé');
    assert.match(deLaCle[0]!.detail, /\(600 modifications à la suite\)$/);
    assert.equal(app.monde.journalBrut().some((l) => l.action === 'cle.creee'), true, 'la rafale n’a rien chassé');
  } finally { await t.fermer(); }
});

test('journal : lecture par pages de 200 lignes, en-têtes de total', async () => {
  const t = await monter();
  const app = t.appInitiale;
  try {
    const dir = app.monde.profil('dirigeante')!;
    const avant = app.monde.journalBrut().length;
    for (let i = 0; i < 450; i++) app.monde.tracer(dir, 'objet.modifie', 'a-panneaux', `ligne ${i}`);
    const p1 = await t.ecran('GET', '/journal');
    assert.equal(p1.json.length, 200);
    assert.equal(p1.json[0].detail, 'ligne 449', 'la plus récente d’abord');
    assert.equal(p1.entetes.get('x-lb-total'), String(avant + 450));
    assert.equal(p1.entetes.get('x-lb-pages'), String(Math.ceil((avant + 450) / 200)));
    const p2 = await t.ecran('GET', '/journal?page=2');
    assert.equal(p2.json[0].detail, 'ligne 249');
    const p3 = await t.ecran('GET', '/journal?page=3');
    assert.equal(p3.json[0].detail, 'ligne 49');
    assert.equal(p3.json.length, 50 + avant);
    assert.equal((await t.ecran('GET', '/journal?page=99')).entetes.get('x-lb-page'), '3', 'page hors limite : la dernière');
  } finally { await t.fermer(); }
});

test('restauration : tracée, et le journal de sécurité d’avant suit dans l’état restauré', async () => {
  const t = await monter();
  try {
    // copie faite AVANT la clé et l'accès : elle ne contient pas leurs traces
    const fichier = (await t.ecran('POST', '/sauvegardes/export', { phrase: PHRASE })).json;
    assert.equal((await t.ecran('POST', '/cles', { nom: 'Robot', profilId: 'dirigeante' })).statut, 200);
    assert.equal((await t.ecran('PUT', '/mises-a-jour', { auto: false })).statut, 200);
    const r = await t.ecran('POST', '/sauvegardes/restaurer', { fichier, phrase: PHRASE });
    assert.equal(r.statut, 200, JSON.stringify(r.json));
    await t.reconnecter();
    const sec = (await t.ecran('GET', '/journal?genre=securite')).json as LigneJournal[];
    const actions = sec.map((l) => l.action);
    assert.equal(actions[0], 'sauvegarde.restauree', 'la restauration est la dernière trace');
    assert.match(sec[0]!.detail, /copie exportée restaurée, par Anna/);
    assert.ok(actions.includes('cle.creee'), 'la trace de la clé créée après la copie n’a pas disparu');
    assert.ok(actions.includes('securite.versions'), 'ni celle du réglage des versions');
    assert.equal(actions.filter((a) => a === 'sauvegarde.exportee').length, 1, 'pas de doublon pour les traces communes');
  } finally { await t.fermer(); }
});

test('journal de sécurité : avis « vu » et changements de comptes y sont inscrits', async () => {
  const mdp = ['une phrase', 'assez longue'].join(' ');
  const app = await Application.creer({ connexion: 'comptes' });
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  try {
    let cookie = '';
    const appel = async (m: string, c: string, corps?: unknown) => {
      const r = await fetch(`${base}/api/v1${c}`, { method: m, headers: { 'content-type': 'application/json', 'x-lb-requete': '1', ...(cookie ? { cookie } : {}) }, body: corps === undefined ? null : JSON.stringify(corps) });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0] as string;
      return { statut: r.status, json: await r.json().catch(() => null) as any };
    };
    assert.equal((await appel('POST', '/installation', { nom: 'Maël', entreprise: 'Menuiserie Kerlann', identifiant: 'mael@kerlann.test', motDePasse: mdp, depart: 'vide' })).statut, 200);
    const moi = app.monde.profils().find((p) => p.peutAdministrer)!;
    const acces = (await appel('POST', '/acces', { nom: 'Nolwenn', role: 'collaborateur' })).json as { id: string };
    assert.equal((await appel('POST', `/acces/${acces.id}/invitation`, { identifiant: 'nolwenn' })).statut, 200);
    assert.equal((await appel('PUT', '/compte/mot-de-passe', { actuel: mdp, nouveau: ['un autre', 'mot de passe'].join(' ') })).statut, 200);
    assert.equal((await appel('POST', `/acces/${acces.id}/desactiver`, {})).statut, 200);
    const sec = app.monde.journalSecuriteBrut();
    const actions = sec.map((l) => l.action);
    for (const a of ['installation', 'acces.cree', 'compte.invite', 'compte.mot_de_passe', 'compte.desactive']) assert.ok(actions.includes(a), a);
    assert.equal(sec.find((l) => l.action === 'compte.invite')?.acteur, moi.id);
    assert.equal(JSON.stringify(sec).includes('mael@kerlann.test') || JSON.stringify(sec).includes(mdp), false, 'ni identifiant ni mot de passe dans les traces');
    // avis « vu » : qui l'a marqué est tracé
    const autre = app.monde.creerAcces(moi, { nom: 'Associée', role: 'dirigeant', peutAdministrer: true, types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous' });
    await app.exporter(moi, { phrase: PHRASE });
    const pAutre = app.monde.profil(autre.id)!;
    app.voirAvis(pAutre, app.avisSecurite(pAutre)[0]!.id);
    const vu = app.monde.journalSecuriteBrut().find((l) => l.action === 'securite.avis_vu');
    assert.equal(vu?.acteur, autre.id);
  } finally { serveur.closeAllConnections(); await new Promise<void>((ok) => serveur.close(() => ok())); }
});
