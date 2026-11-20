/**
 * LE COOKIE ENTRE INSTANCES VOISINES. Deux entreprises hébergées sont deux sous-domaines du même domaine, et
 * n'importe quel sous-domaine peut poser un cookie pour le domaine parent — lequel est ensuite envoyé à tous les
 * autres. Le préfixe `__Host-` est la seule parade : le navigateur refuse qu'un voisin pose un cookie qui le porte.
 *
 * Ce que ces essais tiennent : le nom posé en HTTPS, l'ancien nom encore relu (une mise à jour ne déconnecte
 * personne), le nouveau préféré quand les deux sont là, et la déconnexion qui efface les DEUX.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';

/** Deux serveurs : l'un comme en production (HTTPS derrière le proxy), l'autre comme en développement. */
const serveurs: Server[] = [];
let sur = '';
let clair = '';

before(async () => {
  for (const [secure, mettre] of [[true, (u: string) => { sur = u; }], [false, (u: string) => { clair = u; }]] as const) {
    const s = creerServeur(await Application.creer(), { cookieSecure: secure });
    await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
    serveurs.push(s);
    mettre(`http://127.0.0.1:${(s.address() as AddressInfo).port}`);
  }
});
after(async () => { for (const s of serveurs) await new Promise<void>((ok) => s.close(() => ok())); });

const connecter = async (base: string, cookie = '') => {
  const r = await fetch(`${base}/api/v1/session`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1', ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ profilId: 'dirigeante' }),
  });
  return { statut: r.status, cookies: r.headers.getSetCookie() };
};

test('en HTTPS, le cookie porte le préfixe qu’un voisin ne peut pas poser', async () => {
  const r = await connecter(sur);
  assert.equal(r.statut, 200);
  const pose = r.cookies.join(' ; ');
  assert.match(pose, /__Host-lb_session=/);
  // les trois conditions du préfixe, sans lesquelles le navigateur le refuserait
  assert.match(pose, /Secure/);
  assert.match(pose, /Path=\//);
  assert.doesNotMatch(pose, /Domain=/, 'un cookie avec Domain serait justement celui qu’un voisin peut poser');
});

test('en clair (développement), l’ancien nom : le navigateur refuserait le préfixe sans HTTPS', async () => {
  const r = await connecter(clair);
  assert.match(r.cookies.join(' ; '), /(?:^|[^-])lb_session=/);
  assert.doesNotMatch(r.cookies.join(' ; '), /__Host-/);
});

test('une session ouverte sous l’ancien nom marche encore : la mise à jour ne déconnecte personne', async () => {
  /* Sinon tout le monde serait mis dehors le jour du déploiement, ce qui est le meilleur moyen de faire croire à
     une panne. L'ancien nom s'éteint tout seul quand les sessions expirent. */
  const r = await connecter(sur);
  const valeur = /__Host-lb_session=([A-Za-z0-9_-]{43})/.exec(r.cookies.join(' ; '))?.[1];
  assert.ok(valeur);
  const ancien = await fetch(`${sur}/api/v1/monde`, { headers: { cookie: `lb_session=${valeur}` } });
  assert.equal(ancien.status, 200, 'relu sous l’ancien nom');
});

test('les deux noms présents : c’est le préfixé qui vaut, jamais celui qu’un voisin aurait pu poser', async () => {
  const vrai = /__Host-lb_session=([A-Za-z0-9_-]{43})/.exec((await connecter(sur)).cookies.join(' ; '))?.[1];
  assert.ok(vrai);
  // un faux cookie, comme un voisin le poserait, placé EN PREMIER pour qu'il soit lu d'abord s'il était cru
  const r = await fetch(`${sur}/api/v1/monde`, { headers: { cookie: `lb_session=${'z'.repeat(43)}; __Host-lb_session=${vrai}` } });
  assert.equal(r.status, 200, 'le cookie du voisin ne masque pas le vrai');
});

test('se déconnecter efface les deux noms', async () => {
  const r = await connecter(sur);
  const cookie = r.cookies.map((c) => c.split(';')[0]).join('; ');
  const d = await fetch(`${sur}/api/v1/session`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json', 'x-lb-requete': '1' } });
  const effaces = d.headers.getSetCookie().join(' ; ');
  assert.match(effaces, /__Host-lb_session=;/);
  assert.match(effaces, /(?:^|[^-])lb_session=;/, 'l’ancien aussi : une déconnexion qui laisse un cookie n’en est pas une');
});
