import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from './application.ts';
import { ATTENTE_MAX_MS, Comptes, ESSAIS_GLOBAUX, origineEssai } from './comptes.ts';
import { creerServeur } from './http.ts';
import { Stockage } from './stockage.ts';

async function demarrer(app: Application) {
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  return { serveur, base: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}` };
}
const fermer = (s: Server) => new Promise<void>((ok) => s.close(() => ok()));

function client(base: string) {
  let cookie = '';
  const appel = async (methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) => {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { ...(cookie ? { cookie } : {}), ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}), ...entetes },
      body: corps === undefined ? null : JSON.stringify(corps),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0] as string;
    let json: any = null;
    try { json = await r.json(); } catch { /* vide */ }
    return { statut: r.status, json };
  };
  return { appel };
}

const MDP = 'une phrase assez longue';
const installation = { nom: 'Maël Le Bihan', entreprise: 'Menuiserie Kerlann', identifiant: 'mael@kerlann.example', motDePasse: MDP, depart: 'vide' };

test('installation : seulement sur place, une seule fois, monde vide au nom de l’entreprise, code de secours', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const c = client(base);
    const s0 = (await c.appel('GET', '/api/v1/session')).json;
    assert.equal(s0.connexion, 'comptes');
    assert.equal(s0.installe, false);
    assert.equal(s0.surPlace, true);
    assert.deepEqual(s0.profilsDemo, [], 'aucun profil fictif à choisir en mode comptes');
    // sans mot de passe : refusé ; profil démo : refusé
    assert.equal((await c.appel('POST', '/api/v1/session', { profilId: 'dirigeante' })).statut, 409);
    // depuis un proxy (pas sur place) : refusé
    assert.equal((await c.appel('POST', '/api/v1/installation', installation, { 'x-forwarded-for': '203.0.113.9' })).statut, 403);
    // mot de passe trop court / courant
    assert.equal((await c.appel('POST', '/api/v1/installation', { ...installation, motDePasse: 'court' })).statut, 400);
    assert.equal((await c.appel('POST', '/api/v1/installation', { ...installation, motDePasse: 'motdepasse' })).statut, 400);
    const r = await c.appel('POST', '/api/v1/installation', installation);
    assert.equal(r.statut, 200);
    assert.match(r.json.codeSecours, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
    const m = (await c.appel('GET', '/api/v1/monde')).json;
    assert.equal(m.organisation.nom, 'Menuiserie Kerlann');
    assert.equal(m.organisation.demo, false);
    assert.equal(m.objets.filter((o: any) => o.mode === 'demo').length, 0, 'aucune donnée fictive');
    // deuxième installation : refusée
    assert.equal((await client(base).appel('POST', '/api/v1/installation', { ...installation, identifiant: 'pirate' })).statut, 409);
    // le mot de passe n'est jamais enregistré en clair
    const etat = JSON.stringify(app.instantane());
    assert.ok(!etat.includes(MDP) && !etat.includes(r.json.codeSecours));
  } finally { await fermer(serveur); }
});

test('connexion : bon mot de passe, erreur identique sinon, blocage après 5 échecs', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    await client(base).appel('POST', '/api/v1/installation', installation);
    const c = client(base);
    assert.equal((await c.appel('GET', '/api/v1/monde')).statut, 401);
    const inconnu = await c.appel('POST', '/api/v1/session', { identifiant: 'personne@x.example', motDePasse: MDP });
    const mauvais = await c.appel('POST', '/api/v1/session', { identifiant: installation.identifiant, motDePasse: 'pas le bon mot' });
    assert.equal(inconnu.statut, 401);
    assert.equal(mauvais.statut, 401);
    assert.equal(inconnu.json.message, mauvais.json.message, 'pas d’indice sur l’existence du compte');
    const ok = await c.appel('POST', '/api/v1/session', { identifiant: ' MAEL@kerlann.example ', motDePasse: MDP });
    assert.equal(ok.statut, 200);
    assert.equal((await c.appel('GET', '/api/v1/monde')).statut, 200);
    for (let i = 0; i < 5; i++) await client(base).appel('POST', '/api/v1/session', { identifiant: 'mael@kerlann.example', motDePasse: `faux-${i}-xxxxxxx` });
    const bloque = await client(base).appel('POST', '/api/v1/session', { identifiant: 'mael@kerlann.example', motDePasse: MDP });
    assert.equal(bloque.statut, 429, 'bloqué même avec le bon mot de passe');
  } finally { await fermer(serveur); }
});

test('collègue : lien d’invitation unique, mot de passe choisi par la personne, désactivation qui coupe la session', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const admin = client(base);
    await admin.appel('POST', '/api/v1/installation', installation);
    const p = (await admin.appel('POST', '/api/v1/acces', { nom: 'Morgane — accueil', role: 'collaborateur', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous' })).json;
    const inv = await admin.appel('POST', `/api/v1/acces/${p.id}/invitation`, { identifiant: 'morgane@kerlann.example' });
    assert.equal(inv.statut, 200);
    assert.match(inv.json.lien, /\/invitation\/[A-Za-z0-9_-]{43}$/);
    assert.match(inv.json.mailto, /^mailto:morgane%40kerlann\.example\?subject=/);
    const jeton = inv.json.lien.split('/').pop();
    const m = client(base);
    const info = await m.appel('GET', `/api/v1/invitation/${jeton}`);
    assert.equal(info.json.identifiant, 'morgane@kerlann.example');
    assert.equal(info.json.entreprise, 'Menuiserie Kerlann');
    assert.equal((await m.appel('POST', `/api/v1/invitation/${jeton}`, { motDePasse: 'morgane' })).statut, 400, 'mot de passe faible refusé');
    assert.equal((await m.appel('POST', `/api/v1/invitation/${jeton}`, { motDePasse: 'le café du matin à 8h' })).statut, 200);
    assert.equal((await m.appel('GET', '/api/v1/monde')).json.profil.id, p.id);
    assert.equal((await client(base).appel('GET', `/api/v1/invitation/${jeton}`)).statut, 404, 'lien à usage unique');
    // la personne n'administre pas
    assert.equal((await m.appel('GET', '/api/v1/acces')).statut, 403);
    const liste = (await admin.appel('GET', '/api/v1/acces')).json;
    assert.equal(liste.profils.find((x: any) => x.id === p.id).connexion.statut, 'actif');
    // désactivation : la session ouverte tombe aussitôt
    assert.equal((await admin.appel('POST', `/api/v1/acces/${p.id}/desactiver`, {})).statut, 200);
    assert.equal((await m.appel('GET', '/api/v1/monde')).statut, 401);
    assert.equal((await client(base).appel('POST', '/api/v1/session', { identifiant: 'morgane@kerlann.example', motDePasse: 'le café du matin à 8h' })).statut, 403);
    // l'administrateur ne peut ni se désactiver, ni retirer le dernier administrateur
    const moi = liste.profils.find((x: any) => x.peutAdministrer).id;
    assert.equal((await admin.appel('POST', `/api/v1/acces/${moi}/desactiver`, {})).statut, 409);
    assert.equal((await admin.appel('PUT', `/api/v1/acces/${moi}`, { peutAdministrer: false })).statut, 409);
    // retrait du profil : le compte disparaît
    assert.equal((await admin.appel('DELETE', `/api/v1/acces/${p.id}`)).statut, 200);
    assert.equal((await admin.appel('GET', '/api/v1/acces')).json.profils.some((x: any) => x.id === p.id), false);
  } finally { await fermer(serveur); }
});

test('voir comme : aperçu en lecture seule, retour à sa vue', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const admin = client(base);
    await admin.appel('POST', '/api/v1/installation', { ...installation, depart: 'exemple', exemple: 'pme' });
    const s = (await admin.appel('GET', '/api/v1/session')).json;
    assert.equal(s.profil.nom, 'Maël Le Bihan');
    const a = await admin.appel('POST', '/api/v1/session/apercu', { profilId: 'terrain' });
    assert.equal(a.json.apercu, true);
    const vue = (await admin.appel('GET', '/api/v1/monde')).json;
    assert.equal(vue.profil.id, 'terrain');
    assert.equal((await admin.appel('POST', '/api/v1/simulation', { actif: true })).statut, 409, 'aucune écriture pendant l’aperçu');
    assert.equal((await admin.appel('POST', '/api/v1/session/apercu', { profilId: null })).json.apercu, false);
    assert.equal((await admin.appel('GET', '/api/v1/monde')).json.profil.nom, 'Maël Le Bihan');
  } finally { await fermer(serveur); }
});

test('oubli : code de secours (consommé et remplacé), mot de passe changé = autres sessions coupées', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const a = client(base);
    const code = (await a.appel('POST', '/api/v1/installation', installation)).json.codeSecours;
    assert.equal((await client(base).appel('POST', '/api/v1/secours', { identifiant: installation.identifiant, code: 'AAAA-BBBB-CCCC-DDDD-EEEE', motDePasse: 'nouvelle phrase secrète' })).statut, 401);
    const b = client(base);
    const r = await b.appel('POST', '/api/v1/secours', { identifiant: installation.identifiant, code: code.toLowerCase().replace(/-/g, ' '), motDePasse: 'nouvelle phrase secrète' });
    assert.equal(r.statut, 200);
    assert.notEqual(r.json.codeSecours, code);
    assert.equal((await a.appel('GET', '/api/v1/monde')).statut, 401, 'ancienne session coupée');
    assert.equal((await client(base).appel('POST', '/api/v1/secours', { identifiant: installation.identifiant, code, motDePasse: 'encore une autre phrase' })).statut, 401, 'code déjà utilisé');
    // changement depuis « Mon compte »
    assert.equal((await b.appel('PUT', '/api/v1/compte/mot-de-passe', { actuel: 'faux mot de passe', nouveau: 'troisième phrase longue' })).statut, 401);
    assert.equal((await b.appel('PUT', '/api/v1/compte/mot-de-passe', { actuel: 'nouvelle phrase secrète', nouveau: 'troisième phrase longue' })).statut, 200);
    assert.equal((await b.appel('GET', '/api/v1/monde')).statut, 200, 'la session qui change le mot de passe reste ouverte');
    assert.equal((await client(base).appel('POST', '/api/v1/session', { identifiant: installation.identifiant, motDePasse: 'troisième phrase longue' })).statut, 200);
  } finally { await fermer(serveur); }
});

test('secours sur place (npm run secours) : lien prouvé par le dossier des données, 15 min, une fois', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-secours-'));
  try {
    const app = await Application.creer({ dossier });
    const { serveur, base } = await demarrer(app);
    try {
      await client(base).appel('POST', '/api/v1/installation', installation);
      app.stockage?.ecrireMaintenant();
      assert.equal((await client(base).appel('GET', `/api/v1/secours-local/${'x'.repeat(43)}`)).statut, 404);
      const jeton = Stockage.creerDemandeSecours(dossier);
      assert.equal(statSync(join(dossier, 'secours.json')).mode & 0o777, 0o600);
      const c = client(base);
      assert.equal((await c.appel('GET', `/api/v1/secours-local/${jeton}`, undefined, { 'x-forwarded-for': '203.0.113.9' })).statut, 403, 'pas à distance');
      assert.deepEqual((await c.appel('GET', `/api/v1/secours-local/${jeton}`)).json.comptes, [{ identifiant: 'mael@kerlann.example' }]);
      assert.equal((await c.appel('POST', `/api/v1/secours-local/${jeton}`, { identifiant: 'mael@kerlann.example', motDePasse: 'phrase de secours locale' })).statut, 200);
      assert.equal((await c.appel('GET', '/api/v1/monde')).statut, 200);
      assert.equal((await client(base).appel('GET', `/api/v1/secours-local/${jeton}`)).statut, 404, 'une seule fois');
    } finally { await fermer(serveur); }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test('nom d’hôte inconnu refusé (anti DNS rebinding), IP et localhost acceptés', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  const port = new URL(base).port;
  const statut = (host: string) => new Promise<number>((ok, ko) => {
    const r = request({ host: '127.0.0.1', port, path: '/api/v1/session', headers: { host } }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
    r.on('error', ko);
    r.end();
  });
  try {
    assert.equal(await statut('pirate.example:80'), 421);
    assert.equal(await statut(`localhost:${port}`), 200);
    assert.equal(await statut(`127.0.0.1:${port}`), 200);
    assert.equal(await statut(`[::1]:${port}`), 200);
  } finally { await fermer(serveur); }
});

test('sauvegardes : copie du jour, export chiffré par phrase, restauration (jetons ré-chiffrés)', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-sauv-'));
  const autre = mkdtempSync(join(tmpdir(), 'lb-sauv2-'));
  try {
    const app = await Application.creer({ dossier });
    const { serveur, base } = await demarrer(app);
    let fichier: any;
    let webhook: { secretEntrant: string; entree: string };
    try {
      const a = client(base);
      await a.appel('POST', '/api/v1/installation', installation);
      // un outil branché avec un jeton (chiffré au repos)
      const cx = await a.appel('POST', '/api/v1/synchro', { source: 'webhook', nom: 'Make', typeObjet: 'entreprise', roles: ['client'], sens: 'lecture', config: {} });
      assert.equal(cx.statut, 200);
      webhook = cx.json;
      app.stockage?.ecrireMaintenant();
      await a.appel('POST', '/api/v1/objets', { type: 'entreprise', nom: 'Client A', roles: ['client'], champs: {} });
      app.stockage?.ecrireMaintenant();
      const liste = (await a.appel('GET', '/api/v1/sauvegardes')).json;
      assert.equal(liste.auto.length, 1, 'une copie par jour');
      assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: 'court', motDePasse: MDP })).statut, 400);
      assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: 'phrase de protection 2026', avecAcces: true })).statut, 401, 'mot de passe redemandé');
      fichier = (await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: 'phrase de protection 2026', avecAcces: true, motDePasse: MDP })).json;
      assert.equal(fichier.format, 'living-business-sauvegarde');
      assert.ok(!JSON.stringify(fichier).includes('Client A'), 'rien de lisible sans la phrase');
    } finally { await fermer(serveur); }

    // nouvel ordinateur : restauration à l'installation
    const app2 = await Application.creer({ dossier: autre });
    app2.stockage?.ecrireMaintenant(); // le serveur tourne depuis un moment : son état est sur le disque
    const s2 = await demarrer(app2);
    try {
      const b = client(s2.base);
      assert.equal((await b.appel('POST', '/api/v1/installation/restaurer', { fichier, phrase: 'mauvaise phrase !!' })).statut, 400);
      const r = await b.appel('POST', '/api/v1/installation/restaurer', { fichier, phrase: 'phrase de protection 2026' });
      assert.equal(r.statut, 200);
      assert.equal(r.json.installe, true);
      assert.equal((await b.appel('POST', '/api/v1/session', { identifiant: installation.identifiant, motDePasse: MDP })).statut, 200);
      const m = (await b.appel('GET', '/api/v1/monde')).json;
      assert.ok(m.objets.some((o: any) => o.nom === 'Client A'));
      const cx = (await b.appel('GET', '/api/v1/synchro')).json;
      assert.equal(cx.length, 1, 'outil branché restauré');
      // le secret d'entrée du webhook reste valable (ré-chiffré avec la clé du nouvel ordinateur)
      const w = await fetch(s2.base + webhook!.entree, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${webhook!.secretEntrant}` }, body: JSON.stringify({ id: 'W1', Nom: 'Client B' }) });
      assert.equal(w.status, 200);
      // l'ancienne application (remplacée) ne doit plus rien écrire : sinon l'arrêt écraserait la restauration
      app2.arreter();
      assert.match(readFileSync(join(autre, 'monde.json'), 'utf8'), /Client A/);
      assert.ok(readdirSync(join(autre, 'sauvegardes')).some((f) => f.startsWith('avant-restauration-')), 'copie de l’état d’avant gardée');
    } finally { await fermer(s2.serveur); }
  } finally {
    rmSync(dossier, { recursive: true, force: true });
    rmSync(autre, { recursive: true, force: true });
  }
});

test('connexion : 5 échecs depuis une adresse ne bloquent pas le titulaire qui se connecte d’ailleurs (revue-jeu-1-5)', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  await app.installer(installation);
  // derrière le proxy : l'adresse du client est la dernière valeur de X-Forwarded-For
  const serveur = creerServeur(app, { proxy: true });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  try {
    const depuis = (adresse: string, motDePasse: string) => client(base).appel('POST', '/api/v1/session', { identifiant: installation.identifiant, motDePasse }, { 'x-forwarded-for': adresse });
    // quelqu'un qui ne connaît que l'identifiant (visible dans les invitations) : 5 mauvais mots de passe
    for (let i = 0; i < 5; i++) assert.equal((await depuis('203.0.113.9', `faux-${i}-xxxxxxx`)).statut, 401);
    assert.equal((await depuis('203.0.113.9', MDP)).statut, 429, 'cette adresse est bloquée pour cet identifiant');
    // le titulaire, depuis son adresse, se connecte avec son mot de passe
    assert.equal((await depuis('198.51.100.7', MDP)).statut, 200, 'le titulaire n’est pas bloqué');
    // même règle pour le code de secours
    const secours = (adresse: string, code: string) => client(base).appel('POST', '/api/v1/secours', { identifiant: installation.identifiant, code, motDePasse: ['un nouveau', 'mot de passe'].join(' ') }, { 'x-forwarded-for': adresse });
    for (let i = 0; i < 5; i++) assert.equal((await secours('203.0.113.9', `AAAA-BBBB-CCCC-DDDD-EEE${i}`)).statut, 401);
    assert.equal((await secours('203.0.113.9', 'AAAA-BBBB-CCCC-DDDD-EEEE')).statut, 429);
    assert.equal((await secours('198.51.100.7', 'AAAA-BBBB-CCCC-DDDD-EEEE')).statut, 401, 'ailleurs : le code est vérifié, pas refusé d’office');
  } finally { await fermer(serveur); }
});

test('connexion : au-delà de 30 échecs par heure sur un identifiant, chaque essai attend de plus en plus, le bon mot de passe passe', async () => {
  const attentes: number[] = [];
  const comptes = new Comptes({ attendre: async (ms) => { attentes.push(ms); } });
  await comptes.installer('mael@kerlann.test', MDP, 'proprietaire');
  // force brute répartie : une adresse différente à chaque essai, le verrou par adresse ne joue jamais
  for (let i = 0; i < ESSAIS_GLOBAUX; i++) {
    await assert.rejects(comptes.connecter('mael@kerlann.test', `faux-${i}-xxxxxxx`, `203.0.113.${i + 1}`), (e: { statut?: number }) => e.statut === 401);
  }
  assert.deepEqual(attentes, [], 'sous le plafond : aucun délai');
  for (let i = 0; i < 3; i++) await assert.rejects(comptes.connecter('mael@kerlann.test', 'encore-faux-xxxx', `198.51.100.${i + 1}`), (e: { statut?: number }) => e.statut === 401);
  assert.deepEqual(attentes, [500, 1000, 1500], 'délai croissant');
  // le titulaire attend, mais n'est pas refusé
  const c = await comptes.connecter('mael@kerlann.test', MDP, '192.0.2.50');
  assert.equal(c.identifiant, 'mael@kerlann.test');
  assert.equal(attentes.at(-1), 2000);
  assert.ok(Math.max(...attentes) <= ATTENTE_MAX_MS);
  // un autre identifiant n'est pas ralenti
  const avant = attentes.length;
  await assert.rejects(comptes.connecter('autre@kerlann.test', 'faux-mot-de-passe', '192.0.2.51'));
  assert.equal(attentes.length, avant);
});

test('origine d’un essai : adresse en IPv4, préfixe /64 en IPv6', () => {
  assert.equal(origineEssai('203.0.113.9'), '203.0.113.9');
  assert.equal(origineEssai('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(origineEssai('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), origineEssai('2001:0db8:0001:0002::1'));
  assert.notEqual(origineEssai('2001:db8:1:2::1'), origineEssai('2001:db8:1:3::1'));
  assert.equal(origineEssai('::1'), '0:0:0:0::/64');
  assert.equal(origineEssai(null), 'inconnue');
});
