/**
 * Export complet des données (constat jeu-connecteurs-3) : jamais avec une clé d'API, identité revérifiée (mot de
 * passe, et code si la validation en deux étapes est active), sans la clé des secrets par défaut, phrase plus longue
 * avec elle, journal et avis aux autres administrateurs. Valeurs factices construites à l'exécution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { chiffrerAvecPhrase, creerChiffreur, dechiffrerAvecPhrase } from './stockage.ts';
import { depuisBase32, totp } from './totp.ts';

const MDP = 'une phrase assez longue';
const PHRASE = 'phrase de protection 2026';
const installation = { nom: 'Maël Le Bihan', entreprise: 'Menuiserie Kerlann', identifiant: 'mael@kerlann.example', motDePasse: MDP, depart: 'vide' };
const faux = (prefixe: string) => `${prefixe}${'FAUX'.repeat(5)}0123`;

async function demarrer(app: Application): Promise<{ serveur: Server; base: string }> {
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  return { serveur, base: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}` };
}
const fermer = (s: Server) => new Promise<void>((ok) => { s.closeAllConnections(); s.close(() => ok()); });
function client(base: string) {
  let cookie = '';
  return {
    async appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
      const r = await fetch(base + chemin, { method: methode, headers: { 'content-type': 'application/json', 'x-lb-requete': '1', ...(cookie ? { cookie } : {}), ...entetes }, body: corps === undefined ? null : JSON.stringify(corps) });
      const c = r.headers.get('set-cookie');
      if (c) cookie = c.split(';')[0] as string;
      return { statut: r.status, json: await r.json().catch(() => null) as any };
    },
  };
}

test('export : refusé avec une clé d’API administrateur (la clé contourne la validation en deux étapes)', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const a = client(base);
    await a.appel('POST', '/api/v1/installation', installation);
    const p = app.monde.profils().find((x) => x.peutAdministrer)!;
    const { jeton } = app.cles.creer(p, { nom: 'Make', profilId: p.id });
    const r = await fetch(`${base}/api/v1/sauvegardes/export`, { method: 'POST', headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' }, body: JSON.stringify({ phrase: PHRASE, avecAcces: true, motDePasse: MDP }) });
    assert.equal(r.status, 403);
    assert.equal(app.monde.journalBrut().some((l) => l.action === 'sauvegarde.exportee'), false);
  } finally { await fermer(serveur); }
});

test('export : mot de passe redemandé, puis le code de validation en deux étapes quand elle est active', async () => {
  let t = Date.UTC(2026, 10, 11, 9, 0, 0);
  const app = await Application.creer({ connexion: 'comptes', horloge: () => t });
  const { serveur, base } = await demarrer(app);
  try {
    const a = client(base);
    await a.appel('POST', '/api/v1/installation', installation);
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE })).statut, 401, 'sans mot de passe');
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE, motDePasse: 'mauvais mot de passe' })).statut, 401);
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE, motDePasse: MDP })).statut, 200);
    // validation en deux étapes active : le code est exigé en plus
    const d = (await a.appel('POST', '/api/v1/compte/deux-etapes', {})).json;
    const secret = depuisBase32(d.secret);
    assert.equal((await a.appel('POST', '/api/v1/compte/deux-etapes/confirmer', { code: totp(secret, t) })).statut, 200);
    t += 30_000;
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE, motDePasse: MDP })).statut, 401, 'sans code');
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE, motDePasse: MDP, code: '000000' })).statut, 401, 'faux code');
    const bon = totp(secret, t);
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE, motDePasse: MDP, code: bon })).statut, 200);
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE, motDePasse: MDP, code: bon })).statut, 401, 'code rejoué refusé');
  } finally { await fermer(serveur); }
});

test('export : sans la clé des secrets par défaut ; avec elle, phrase de 16 caractères ; restauration ailleurs sans secret illisible', async () => {
  const jetonOutil = faux('rk_test_');
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  let defaut: any;
  let complet: any;
  try {
    const a = client(base);
    await a.appel('POST', '/api/v1/installation', installation);
    const p = app.monde.profils().find((x) => x.peutAdministrer)!;
    app.synchro.creer(p, { source: 'stripe', config: { objet: 'customers', jeton: jetonOutil }, typeObjet: 'entreprise', roles: ['client'], mapping: { name: '__nom' }, sens: 'lecture', intervalleS: 3600, actif: false });
    defaut = (await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: 'douze carac.', motDePasse: MDP })).json;
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: 'onze carac.', motDePasse: MDP })).statut, 400, '12 caractères au moins');
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: 'quinze caractè.', avecAcces: true, motDePasse: MDP })).statut, 400, 'avec les accès : 16 au moins');
    complet = (await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE, avecAcces: true, motDePasse: MDP })).json;
  } finally { await fermer(serveur); }

  const clair = JSON.parse(await dechiffrerAvecPhrase(defaut, 'douze carac.'));
  assert.equal('cleSecrets' in clair, false, 'la clé des secrets ne part pas par défaut');
  assert.equal(JSON.stringify(clair).includes(jetonOutil), false);
  const avec = JSON.parse(await dechiffrerAvecPhrase(complet, PHRASE));
  assert.equal(creerChiffreur(Buffer.from(avec.cleSecrets, 'base64')).dechiffrer(avec.etat.synchro.connecteurs[0].secret), jetonOutil, 'export voulu pour migrer : la clé est là');

  // même installation : le jeton est retrouvé ; autre installation : effacé (à reconnecter), jamais laissé illisible
  const ici = await app.lireExport(defaut, 'douze carac.');
  assert.ok(ici.synchro.connecteurs[0]?.secret);
  const ailleurs = await (await Application.creer({ connexion: 'comptes' })).lireExport(defaut, 'douze carac.');
  assert.equal(ailleurs.synchro.connecteurs[0]?.secret, null);
});

test('export : inscrit au journal et signalé aux autres administrateurs jusqu’à « J’ai vu »', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const a = client(base);
    await a.appel('POST', '/api/v1/installation', installation);
    const moi = app.monde.profils().find((x) => x.peutAdministrer)!;
    const autre = app.monde.creerAcces(moi, { nom: 'Nolwenn', role: 'dirigeant', peutAdministrer: true, types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous' });
    const collegue = app.monde.creerAcces(moi, { nom: 'Yann', role: 'collaborateur' });
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: PHRASE, avecAcces: true, motDePasse: MDP })).statut, 200);
    const ligne = app.monde.journalBrut().find((l) => l.action === 'sauvegarde.exportee');
    assert.ok(ligne && ligne.acteur === moi.id && /avec la clé des accès/.test(ligne.detail));
    assert.deepEqual(app.avisSecurite(moi), [], 'pas d’avis pour soi-même');
    assert.deepEqual(app.avisSecurite(app.monde.profil(collegue.id)!), [], 'seulement les administrateurs');
    const [avis] = app.avisSecurite(app.monde.profil(autre.id)!);
    assert.equal(avis?.quoi, 'export_avec_acces');
    assert.equal(avis?.par, installation.nom);
    assert.equal((await a.appel('GET', '/api/v1/monde')).json.avisSecurite.length, 0);
    app.voirAvis(app.monde.profil(autre.id)!, avis!.id);
    assert.deepEqual(app.avisSecurite(app.monde.profil(autre.id)!), []);
    // l'avis survit au redémarrage (état enregistré)
    const relue = await Application.creer({ connexion: 'comptes', etat: app.instantane() });
    assert.equal(relue.instantane().securite?.avis.length, 1);
  } finally { await fermer(serveur); }
});

test('restauration : mot de passe (et code) redemandés comme pour l’export ; une session prise ne remplace pas les comptes (revue-jeu-1-9)', async () => {
  // fichier fabriqué sur une autre installation : il contient le compte administrateur de l'attaquant
  const mdpPirate = ['trois', 'petits', 'chats', 'gris'].join(' ');
  const ailleurs = await Application.creer({ connexion: 'comptes' });
  await ailleurs.installer({ nom: 'Autre', entreprise: 'Fausse entreprise', identifiant: 'autre@exemple.test', motDePasse: mdpPirate, depart: 'vide' });
  const fichier = await chiffrerAvecPhrase(JSON.stringify({ etat: ailleurs.instantane() }), PHRASE);

  let t = Date.UTC(2026, 10, 11, 9, 0, 0);
  const app = await Application.creer({ connexion: 'comptes', horloge: () => t });
  const { serveur, base } = await demarrer(app);
  try {
    const a = client(base);
    await a.appel('POST', '/api/v1/installation', installation);
    // la seule session (poste resté ouvert, cookie dérobé) ne suffit plus
    const sans = await a.appel('POST', '/api/v1/sauvegardes/restaurer', { fichier, phrase: PHRASE });
    assert.equal(sans.statut, 401);
    assert.equal(sans.json?.erreur, 'mot_de_passe_actuel');
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/restaurer', { fichier, phrase: PHRASE, motDePasse: 'mauvais mot de passe' })).statut, 401);
    assert.equal((await a.appel('POST', '/api/v1/sauvegardes/restaurer', { nom: 'monde-2026-11-10.json' })).statut, 401, 'copie automatique : même preuve');
    assert.equal(app.monde.organisation.nom, installation.entreprise, 'rien n’a été remplacé');
    assert.equal((await client(base).appel('POST', '/api/v1/session', { identifiant: 'autre@exemple.test', motDePasse: mdpPirate })).statut, 401, 'le compte du fichier n’existe pas ici');
    // validation en deux étapes active : le code est exigé en plus du mot de passe
    const d = (await a.appel('POST', '/api/v1/compte/deux-etapes', {})).json;
    const secret = depuisBase32(d.secret);
    assert.equal((await a.appel('POST', '/api/v1/compte/deux-etapes/confirmer', { code: totp(secret, t) })).statut, 200);
    t += 30_000;
    const sansCode = await a.appel('POST', '/api/v1/sauvegardes/restaurer', { fichier, phrase: PHRASE, motDePasse: MDP });
    assert.equal(sansCode.statut, 401);
    assert.equal(sansCode.json?.erreur, 'code_invalide');
    assert.equal(app.monde.organisation.nom, installation.entreprise);
    // la personne elle-même, avec son mot de passe et son code, restaure
    const ok = await a.appel('POST', '/api/v1/sauvegardes/restaurer', { fichier, phrase: PHRASE, motDePasse: MDP, code: totp(secret, t) });
    assert.equal(ok.statut, 200, JSON.stringify(ok.json));
    assert.equal((await client(base).appel('POST', '/api/v1/session', { identifiant: 'autre@exemple.test', motDePasse: mdpPirate })).statut, 200, 'l’état restauré est en place');
  } finally { await fermer(serveur); }
});
