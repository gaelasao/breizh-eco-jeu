/**
 * Passerelle pour la couche de jeu et « Mettre en ligne » (direction de design §6.1 P9, P10) :
 * - une quête achevée par une vraie action (mouvement de stock) rapporte de l'XP, une seule fois, gardée à la
 *   restauration ; rien en simulation ; jamais pour un profil qui ne voit pas l'objet ;
 * - la vérification « répond bien sur votre téléphone » : jeton de 10 minutes, page publique sans aucune donnée,
 *   liste blanche des fichiers servis (telephone.html, telephone.js).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { fichiersStatiques } from './statiques.ts';
import { adressesTailscale, genreAppareil, VerificationsTelephone } from './verification-telephone.ts';

let serveur: Server;
let base: string;
let app: Application;
before(async () => {
  app = await Application.creer();
  serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => serveur.close(() => ok())));

function client() {
  let cookie = '';
  const appel = async (methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) => {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { ...(cookie ? { cookie } : {}), ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}), ...entetes },
      body: corps === undefined ? null : JSON.stringify(corps),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0] as string;
    const texte = await r.text();
    let json: any = null;
    try { json = JSON.parse(texte); } catch { /* statique */ }
    return { statut: r.status, json, entetes: r.headers, texte };
  };
  return { appel, connecter: (profilId: string) => appel('POST', '/api/v1/session', { profilId }) };
}

test('XP : une quête de stock achevée par un vrai mouvement rapporte une fois, avec sa preuve', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const avant = (await c.appel('GET', '/api/v1/monde')).json;
  assert.equal(avant.progression.xp, 0, 'aucun point au départ : rien n’a été fait');
  assert.equal(avant.progression.niveau.nom, 'Cale');
  assert.equal(avant.progression.exemple, true, 'entreprise exemple : marquée');
  const q = avant.quetes.find((x: any) => x.origine.objetId === 'a-panneaux' && x.statut === 'ouverte');
  assert.ok(q, 'quête ouverte sur le stock de panneaux');
  assert.ok(['critique', 'attention'].includes(q.gravite));
  // en simulation : rien n'est gagné
  await c.appel('POST', '/api/v1/simulation', { actif: true });
  await c.appel('POST', '/api/v1/actions', { cle: 'sim-00000001', capacite: 'mouvement', cible: 'a-panneaux', parametres: { champ: 'quantite', delta: 40, motif: 'simulation' }, executer: true });
  await c.appel('POST', '/api/v1/simulation', { actif: false });
  assert.equal((await c.appel('GET', '/api/v1/monde')).json.progression.xp, 0, 'simulation : aucun point');
  const a = await c.appel('POST', '/api/v1/actions', { cle: 'xp-000000001', capacite: 'mouvement', cible: 'a-panneaux', parametres: { champ: 'quantite', delta: 40, motif: 'livraison reçue' }, executer: true });
  assert.equal(a.statut, 200, JSON.stringify(a.json));
  const apres = (await c.appel('GET', '/api/v1/monde')).json;
  const attendu = q.gravite === 'critique' ? 60 : 40;
  assert.equal(apres.progression.xp, attendu);
  const r = apres.progression.reussites.at(-1);
  assert.equal(r.objetId, 'a-panneaux');
  assert.equal(r.preuve.valeur, 46);
  assert.equal(r.exemple, true);
  assert.equal(apres.progression.trophees.find((t: any) => t.id === 'premiere-quete').le, r.le, 'trophée daté, prouvé');
  // la même quête, le même jour : plus rien
  await c.appel('POST', '/api/v1/actions', { cle: 'xp-000000002', capacite: 'mouvement', cible: 'a-panneaux', parametres: { champ: 'quantite', delta: -40, motif: 'erreur' }, executer: true });
  await c.appel('POST', '/api/v1/actions', { cle: 'xp-000000003', capacite: 'mouvement', cible: 'a-panneaux', parametres: { champ: 'quantite', delta: 40, motif: 'corrigé' }, executer: true });
  assert.equal((await c.appel('GET', '/api/v1/monde')).json.progression.xp, attendu, 'pas de points à faire entrer et sortir un stock');
  // gardée dans l'état enregistré, l'XP n'y est jamais lue telle quelle
  const etat = app.instantane();
  assert.equal(etat.monde.reussites?.length, 1);
  const copie = await Application.creer({ etat: structuredClone(etat) });
  assert.equal(copie.monde.progression({ id: 'dirigeante', peutAdministrer: true, peutPreparer: true, peutApprouver: true, voitScore: true, role: 'dirigeant', nom: 'Anna', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous' } as any, 'x').xp, attendu);
  // un profil qui ne voit pas l'entrepôt : le total de l'entreprise, jamais le nom de l'article
  const atelier = client();
  await atelier.connecter('terrain');
  const vu = (await atelier.appel('GET', '/api/v1/monde')).json;
  if (vu?.progression) {
    assert.equal(vu.progression.xp, attendu);
    assert.ok(!vu.progression.reussites.some((x: any) => x.objetId === 'a-panneaux'), 'hors périmètre : pas de nom');
  }
});

test('vérification du téléphone : jeton de 10 minutes, page publique sans donnée, réservé aux administrateurs', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const v = await c.appel('POST', '/api/v1/en-ligne/verification', {});
  assert.equal(v.statut, 200);
  assert.match(v.json.jeton, /^[A-Za-z0-9_-]{22}$/);
  for (const a of v.json.adresses) {
    assert.ok(a.lien.endsWith(`/telephone#${v.json.jeton}`), 'jeton dans le fragment, jamais dans le chemin');
    assert.match(a.qr, /^data:image\/svg\+xml/);
  }
  assert.equal((await c.appel('GET', `/api/v1/en-ligne/verification/${v.json.jeton}`)).json.vu, false);
  const page = await fetch(`${base}/telephone`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /telephone\.js/);
  // le téléphone (sans session) répond
  const sansEntete = await fetch(`${base}/api/public/telephone/${v.json.jeton}`, { method: 'POST' });
  assert.equal(sansEntete.status, 403, 'en-tête anti-falsification exigé');
  const tel = await fetch(`${base}/api/public/telephone/${v.json.jeton}`, { method: 'POST', headers: { 'x-lb-requete': '1', 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148' } });
  assert.equal(tel.status, 200);
  assert.deepEqual(await tel.json(), { ok: true }, 'aucune donnée de l’entreprise');
  const e = (await c.appel('GET', `/api/v1/en-ligne/verification/${v.json.jeton}`)).json;
  assert.equal(e.vu, true);
  assert.equal(e.appareil, 'téléphone');
  assert.equal((await fetch(`${base}/api/public/telephone/${'x'.repeat(22)}`, { method: 'POST', headers: { 'x-lb-requete': '1' } })).status, 404);
  const collaborateur = client();
  await collaborateur.connecter('terrain');
  assert.equal((await collaborateur.appel('POST', '/api/v1/en-ligne/verification', {})).statut, 403);
});

test('vérifications : expiration, appareil, adresses Tailscale (100.64/10 seulement)', () => {
  let t = 0;
  const v = new VerificationsTelephone(() => t);
  const { jeton } = v.creer();
  assert.equal(v.marquer(jeton, 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile'), true);
  assert.equal(v.etat(jeton)?.appareil, 'téléphone');
  t += 11 * 60_000;
  assert.equal(v.etat(jeton), null, 'expirée après 10 minutes');
  assert.equal(v.marquer(jeton, ''), false);
  assert.equal(genreAppareil('Mozilla/5.0 (iPad; CPU OS 17_0)'), 'tablette');
  assert.equal(genreAppareil('Mozilla/5.0 (Macintosh)'), 'ordinateur');
  const ifs = { utun4: [{ address: '100.101.12.7', family: 'IPv4', internal: false }], en0: [{ address: '192.168.1.20', family: 'IPv4', internal: false }, { address: '100.20.0.1', family: 'IPv4', internal: false }] } as any;
  assert.deepEqual(adressesTailscale(ifs), ['100.101.12.7']);
});

test('liste blanche : la page du téléphone et son script sont servis, aucun autre chemin construit depuis l’URL', () => {
  const s = fichiersStatiques();
  assert.ok(s.get('/telephone.html'));
  assert.ok(s.get('/telephone.js'));
  assert.equal(s.get('/../package.json'), undefined);
  assert.equal(s.get('/telephone'), undefined, 'la route /telephone est posée par la passerelle, pas par le disque');
});
