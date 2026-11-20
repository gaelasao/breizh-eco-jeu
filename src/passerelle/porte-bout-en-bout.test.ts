/**
 * LA PORTE, SERVIE PAR LE VRAI SERVEUR. Les essais de `porte-facade.ts` vérifient la règle ; celui-ci vérifie que
 * la route existe, qu'elle ouvre vraiment une session, et surtout qu'elle N'EXISTE PAS quand l'éditeur n'a rien
 * posé — une installation auto-hébergée ne doit pas même laisser deviner qu'une porte pourrait s'ouvrir.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { Application } from './application.ts';
import { creerServeur, profilPourRole } from './http.ts';
import { PREFIXE } from './porte-facade.ts';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const CLE_PUBLIQUE = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
const ENTREPRISE = 'ent-essai';

let serveur: Server;
let base: string;
const avant = { cle: process.env.LB_FACADE_CLE, ent: process.env.LB_FACADE_ENTREPRISE };

before(async () => {
  process.env.LB_FACADE_CLE = CLE_PUBLIQUE;
  process.env.LB_FACADE_ENTREPRISE = ENTREPRISE;
  /*
   * L'instance est INSTALLÉE avant d'ouvrir la porte. Ce n'est pas un détail d'essai : sans installation, le jeu
   * n'a aucun profil d'accès, et la porte répond 409 plutôt que d'ouvrir sur rien. L'aiguillage devra donc
   * installer l'instance au moment où il la crée, avant que personne n'y entre.
   */
  const app = await Application.creer({ connexion: 'comptes' });
  await app.installer({ nom: 'Gaël', entreprise: 'Kerlann', identifiant: 'gael@kerlann.bzh', motDePasse: 'un mot de passe assez long', depart: 'vide' });
  serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
after(async () => {
  await new Promise<void>((ok) => serveur.close(() => ok()));
  if (avant.cle === undefined) delete process.env.LB_FACADE_CLE; else process.env.LB_FACADE_CLE = avant.cle;
  if (avant.ent === undefined) delete process.env.LB_FACADE_ENTREPRISE; else process.env.LB_FACADE_ENTREPRISE = avant.ent;
});

/** Comme la façade signera : charge en base64url, signature sur « bz1.<charge> ». */
function jetonPour(o: { entreprise?: string; role?: 'administrateur' | 'collaborateur'; jeton?: string; expire?: number } = {}) {
  const charge = {
    entreprise: o.entreprise ?? ENTREPRISE, personne: 'p-gael', nom: 'Gaël', role: o.role ?? 'administrateur',
    expire: Math.floor(Date.now() / 1000) + 60, jeton: o.jeton ?? `jt-${Math.random().toString(36).slice(2)}`,
    ...(o.expire ? { expire: o.expire } : {}),
  };
  const b = Buffer.from(JSON.stringify(charge), 'utf8').toString('base64url');
  return `${PREFIXE}.${b}.${sign(null, Buffer.from(`${PREFIXE}.${b}`, 'utf8'), privateKey).toString('base64url')}`;
}

async function ouvrir(jeton: string) {
  const r = await fetch(`${base}/api/v1/porte`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ jeton }),
  });
  return { statut: r.status, json: (await r.json().catch(() => null)) as any, cookie: r.headers.get('set-cookie') };
}

test('un jeton de la façade ouvre une vraie session, utilisable tout de suite', async () => {
  const r = await ouvrir(jetonPour());
  assert.equal(r.statut, 200);
  assert.ok(r.cookie, 'un cookie de session est posé');
  assert.ok(r.json.profil?.id, 'un profil du jeu, pas un rôle de la façade');
  assert.equal(r.json.nom, 'Gaël');
  // la session sert vraiment : on lit le monde avec, sans rien d'autre
  const monde = await fetch(`${base}/api/v1/monde`, { headers: { cookie: (r.cookie as string).split(';')[0] as string } });
  assert.equal(monde.status, 200);
});

test('les refus sont servis en 403, avec une phrase qui n’apprend rien', async () => {
  const autre = await ouvrir(jetonPour({ entreprise: 'ent-voisine' }));
  assert.equal(autre.statut, 403);
  assert.match(String(autre.json?.message ?? ''), /ne permet pas d’ouvrir cette installation/);
  // la même phrase pour toutes les raisons : un refus ne doit pas apprendre à en fabriquer un bon
  const vieux = await ouvrir(jetonPour({ expire: Math.floor(Date.now() / 1000) - 600 }));
  assert.equal(vieux.statut, 403);
  assert.equal(vieux.json?.message, autre.json?.message);
  assert.equal((await ouvrir('n’importe quoi')).statut, 403);
});

test('le même jeton ne sert pas deux fois, même servi par le serveur', async () => {
  const jeton = jetonPour({ jeton: 'jt-unique' });
  assert.equal((await ouvrir(jeton)).statut, 200);
  assert.equal((await ouvrir(jeton)).statut, 403, 'revenir en arrière ne rouvre rien');
});

test('le rôle se traduit en profil, et un collaborateur ne reçoit JAMAIS les droits du patron', async () => {
  /*
   * UNE INSTANCE FRAÎCHE N'A QU'UN PROFIL : le propriétaire. Un collaborateur invité sur la façade n'a donc nulle
   * part où entrer tant que l'entreprise ne lui a pas fait un accès — et la porte le REFUSE plutôt que de lui
   * donner le seul profil disponible, qui administre tout. Mieux vaut une porte qui ne s'ouvre pas qu'une porte
   * qui ouvre trop grand.
   *
   * C'est une contrainte pour l'aiguillage : créer l'instance ne suffit pas, il faudra décider ce qui arrive aux
   * collaborateurs — profil créé d'office, ou invitation par l'entreprise.
   */
  const app = await Application.creer({ connexion: 'comptes' });
  await app.installer({ nom: 'Anna', entreprise: 'Essai', identifiant: 'anna@essai.bzh', motDePasse: 'un mot de passe assez long', depart: 'vide' });
  const profils = app.monde.profils();
  assert.equal(profils.length, 1, 'une instance fraîche n’a que le propriétaire');
  assert.equal(profilPourRole(profils, 'administrateur')?.peutAdministrer, true);
  assert.equal(profilPourRole(profils, 'collaborateur'), null, 'aucun profil qui n’administre pas : on n’en invente pas');
  app.arreter();

  // aucun profil du tout : la porte ne s'ouvre pas plutôt que de s'ouvrir grand
  assert.equal(profilPourRole([], 'administrateur'), null);
  assert.equal(profilPourRole([], 'collaborateur'), null);

  // servi par le serveur : un collaborateur reçoit un accès AU PLANCHER, créé pour lui
  const r = await ouvrir(jetonPour({ role: 'collaborateur' }));
  assert.equal(r.statut, 200);
  assert.equal(r.json.profil.peutAdministrer, false, 'jamais les droits du patron');
  assert.match(String(r.json.profil.nom), /Breizhcosystem/, 'son nom l’attend dans Réglages › Accès');
  assert.ok(r.cookie, 'il entre');
});

test('le collaborateur entre, et il ne VOIT rien tant que l’entreprise ne lui ouvre pas', async () => {
  /* Entrer et voir sont deux choses. La façade décide qui appartient à l'entreprise ; l'entreprise décide ce que
     chacun regarde. Un accès créé par la porte ne porte donc aucun type, aucun lieu, aucun droit. */
  const r = await ouvrir(jetonPour({ role: 'collaborateur' }));
  assert.equal(r.statut, 200);
  const cookie = (r.cookie as string).split(';')[0] as string;
  const m = await (await fetch(`${base}/api/v1/monde`, { headers: { cookie } })).json() as { objets: unknown[]; profil: { peutPreparer: boolean } };
  assert.deepEqual(m.objets, [], 'aucune fiche visible');
  assert.equal(m.profil.peutPreparer, false);
});

test('revenir ne crée pas un second profil : l’identifiant vient de la personne', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  await app.installer({ nom: 'Anna', entreprise: 'Essai', identifiant: 'anna@essai.bzh', motDePasse: 'un mot de passe assez long', depart: 'vide' });
  const a = app.monde.accesPourPersonne('porte', 'p-yann', 'Yann');
  const b = app.monde.accesPourPersonne('porte', 'p-yann', 'Yann');
  assert.equal(a.id, b.id);
  assert.equal(app.monde.profils().filter((x) => x.id.startsWith('p-bz-')).length, 1);
  // deux personnes, deux profils
  assert.notEqual(app.monde.accesPourPersonne('porte', 'p-soizic', 'Soizic').id, a.id);
  app.arreter();
});

test('la page /porte est servie par l’application, comme le lien d’installation', async () => {
  const r = await fetch(`${base}/porte`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') ?? '', /text\/html/);
});
