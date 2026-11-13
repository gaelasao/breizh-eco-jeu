/**
 * « J'automatise » : d'un geste, tout ce qui est prêt se met en marche ; ce qui ne peut pas l'être dit ce qu'il manque.
 * Prêt = le jeu a les données que l'automatisation regarde. Réservé à la direction (jamais une clé d'API).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';

test('« J’automatise » : tout ce qui est prêt s’active d’un geste, le reste dit ce qui manque, puis agit sur le réel', async () => {
  const a = await Application.creer({ exemple: 'pme' });
  const p = a.monde.profil('dirigeante');
  const terrain = a.monde.profil('terrain');
  assert.ok(p && terrain);
  const avant = a.automatisations.preparation(p);
  assert.equal(avant.recettes.length, 12);
  assert.ok(avant.pretes >= 4, `prêtes : ${avant.pretes}`);
  assert.ok(avant.recettes.every((r) => r.etat !== 'active'), 'rien n’est actif au départ');
  assert.ok(avant.heuresMois > 0, 'le gain estimé des pistes prêtes est affiché');
  assert.equal(avant.outilBranche, false, 'aucun outil d’automatisation branché : les envois deviennent des tâches');
  for (const r of avant.recettes.filter((x) => x.etat === 'a_brancher')) assert.ok((r.manque ?? '').length > 5, `${r.id} dit ce qui manque`);

  assert.throws(() => a.automatisations.preparation(terrain), /interdit/);
  assert.throws(() => a.automatisations.toutActiver(terrain), /interdit/);

  const fait = a.automatisations.toutActiver(p);
  assert.equal(fait.activees.length, avant.pretes);
  const apres = a.automatisations.preparation(p);
  assert.equal(apres.pretes, 0);
  assert.deepEqual(apres.recettes.filter((x) => x.etat === 'active').map((x) => x.id), fait.activees);
  assert.deepEqual(apres.recettes.filter((x) => x.etat === 'a_brancher').map((x) => x.id), avant.recettes.filter((x) => x.etat === 'a_brancher').map((x) => x.id), 'ce qui reste à brancher n’est pas activé');
  assert.deepEqual(a.automatisations.toutActiver(p).activees, [], 'un second geste n’ajoute rien');
  assert.ok((await a.automatisations.executer()) > 0, 'les automatisations activées agissent');
});

test('« J’automatise » : entreprise vide — rien à regarder, chaque automatisation dit quoi relier ; elle devient prête dès que la donnée arrive', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const p = app.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann', depart: 'vide' });
  const etat = (id: string) => app.automatisations.preparation(p).recettes.find((r) => r.id === id);
  assert.equal(etat('relance-factures')?.etat, 'a_brancher');
  assert.match(etat('relance-factures')?.manque ?? '', /factures/);
  assert.equal(etat('avis-bas')?.etat, 'a_brancher');
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Cave du Port', roles: ['client'], champs: {} });
  assert.equal(etat('avis-bas')?.etat, 'prete', 'un client suffit pour demander des avis');
  assert.equal(etat('relance-factures')?.etat, 'a_brancher', 'toujours aucune facture');
  const fait = app.automatisations.toutActiver(p);
  assert.ok(fait.activees.includes('avis-bas') && !fait.activees.includes('relance-factures'));
  assert.ok(fait.aBrancher.some((r) => r.id === 'relance-factures' && /factures/.test(r.manque ?? '')));
});

test('aucune piste à zéro : « brancher vos outils » n’est proposé qu’avec au moins une fiche tenue à la main', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const p = app.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann', depart: 'vide' });
  const piste = () => app.automatisations.optimisations(p).opportunites.find((o) => o.id === 'connecter') ?? null;
  const constat = () => (piste()?.constat ?? '').replace(/[\u00a0\u202f]/gu, ' ');
  assert.equal(piste(), null, 'entreprise vide : rien à ressaisir, donc rien à proposer');
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Cave du Port', roles: ['client'], champs: {} });
  assert.ok(piste(), 'une fiche saisie à la main : la piste a un sens');
  assert.doesNotMatch(constat(), /: 0 /, 'jamais « 0 fiche saisie… qui vieillissent »');
  assert.equal(constat(), 'Aucun outil branché : 1 fiche saisie ou importée à la main, qui vieillit.', 'et les accords suivent le nombre');
});
