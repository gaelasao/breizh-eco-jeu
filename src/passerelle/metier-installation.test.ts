/**
 * Le métier, demandé au premier lancement (écran d'installation).
 *
 * L'installation ne demandait que le nom, l'entreprise, l'identifiant et le mot de passe : elle partait donc
 * toujours sur l'univers « generique », qui montre tout à tout le monde — du stock à un consultant, des chantiers
 * à un commerçant. Le métier choisi décide maintenant du vocabulaire et de ce qui s'affiche, et il se change
 * ensuite dans Réglages (rien n'est définitif).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';
import { UNIVERS_DISPONIBLES } from './monde.ts';
import type { Profil } from '../demo/donnees.ts';

const vue = (app: Application, _p: Profil) => app.monde.vueUnivers();
const type = (u: ReturnType<typeof vue>, id: string) => u.types.find((t) => t.id === id) ?? null;
/** La vue rend les champs en liste (id, libellé, valeur), pas en objet : on y cherche celui qu'on veut. */
type Champ = { id: string; valeur: unknown };
type Objet = { famille: string; champs: Champ[] };
async function champOrganisation(app: Application, p: Profil, champ: string): Promise<unknown> {
  const org = (await app.monde.vue(p, 'sid')).objets.find((o: Objet) => o.famille === 'organisation') as Objet | undefined;
  return org?.champs.find((c) => c.id === champ)?.valeur ?? undefined;
}

test('le métier choisi à l’installation change le vocabulaire et cache ce qui ne sert pas', async () => {
  // services : des missions, un suivi client, et AUCUN stock à tenir
  const services = await Application.creer({ connexion: 'comptes' });
  const ps = services.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann Conseil', depart: 'vide', univers: 'services', effectif: 1 });
  const us = vue(services, ps);
  assert.equal(us.id, 'services');
  assert.equal(type(us, 'projet')?.libelle, 'Mission');
  assert.equal(type(us, 'article'), null, 'pas d’article en stock pour qui n’en tient pas');
  assert.equal(type(us, 'entrepot'), null, 'ni entrepôt');

  // bâtiment : des chantiers et des engins, là où le générique ne connaît que des projets
  const btp = await Application.creer({ connexion: 'comptes' });
  const pb = btp.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann TP', depart: 'vide', univers: 'btp' });
  const ub = vue(btp, pb);
  assert.equal(ub.id, 'btp');
  assert.match(type(ub, 'projet')?.libelle ?? '', /Chantier/);

  // commerce : des magasins et des produits, pas de projet
  const commerce = await Application.creer({ connexion: 'comptes' });
  const pc = commerce.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann Boutique', depart: 'vide', univers: 'commerce' });
  const uc = vue(commerce, pc);
  assert.equal(type(uc, 'site')?.libelle, 'Magasin');
  assert.equal(type(uc, 'projet'), null);

  // sans métier choisi : rien ne change pour les installations d'avant
  const sans = await Application.creer({ connexion: 'comptes' });
  const pn = sans.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann', depart: 'vide' });
  assert.equal(vue(sans, pn).id, 'generique');

  // les quatre métiers de l'écran existent bien en univers livré
  for (const id of ['btp', 'commerce', 'services', 'generique']) {
    assert.ok((UNIVERS_DISPONIBLES as readonly string[]).includes(id), id);
  }
});

test('l’effectif demandé à l’installation est gardé, et une valeur fantaisiste est ignorée', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const p = app.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann', depart: 'vide', effectif: 7 });
  assert.equal(await champOrganisation(app, p, 'effectif'), 7);

  // par l'API : un univers inconnu retombe sur « generique » plutôt que de refuser l'installation
  const api = await Application.creer({ connexion: 'comptes' });
  const r = await api.installer({ nom: 'Maël', entreprise: 'Kerlann', depart: 'vide', identifiant: 'mael@kerlann.bzh', motDePasse: 'un-mot-de-passe-assez-long-42', univers: '../../etc/passwd', effectif: 'beaucoup' });
  assert.ok(r.compte, 'installée quand même');
  assert.equal(api.monde.vueUnivers().id, 'generique');
  assert.equal(await champOrganisation(api, r.profil, 'effectif'), undefined, 'un effectif illisible n’est pas inventé');
});
