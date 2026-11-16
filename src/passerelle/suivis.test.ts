/**
 * LE MOTEUR DE SUIVI BRANCHÉ AU MONDE. Ce que ces essais vérifient, et qui ne se vérifie qu'ici :
 * - une échéance crée un VRAI rendez-vous et une VRAIE tâche, et repasser dix fois n'en crée pas un onzième ;
 * - une échéance annulée (ou réglée, ou dont la porte est décochée) RETIRE ce qu'elle avait créé ;
 * - une entreprise SANS agenda branché voit tout fonctionner : les fiches sont écrites, elles ne partent nulle part ;
 * - le moteur ne se relit jamais lui-même : la tâche qu'il écrit ne devient pas l'étape d'un nouveau cycle ;
 * - la page de suivi d'un client relève de l'offre, les quatre portes restent comprises ;
 * - un lien révoqué ne montre plus rien, et l'entreprise voit quand son client a ouvert la page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estGratuite } from '../core/offre.ts';
import { PORTES } from '../core/suivi.ts';
import { Application } from './application.ts';
import { ErreurApi, SYSTEME } from './monde.ts';
import { AUTOMATISATION_PAGE, ecriteParLeMoteur, JETON } from './suivis.ts';

const ADRESSE = 'http://127.0.0.1:4180';
const CLE = ['nx', 'k'.repeat(43)].join('_');
const JOUR = 86_400_000;

/** Réseau simulé : la liaison, puis les droits que l'essai règle à sa guise. */
function reseau(plan: 'gratuit' | 'active') {
  return (async (url: string | URL | Request): Promise<Response> => {
    const chemin = new URL(String(url)).pathname;
    if (chemin === '/v0/liaison') return Response.json({ code: 'ABCD-2345', attente: 'a'.repeat(43), url: 'https://reseau.test/relier?code=ABCD-2345', expire: new Date(Date.now() + 600_000).toISOString() });
    if (chemin === '/v0/liaison/retrait') return Response.json({ statut: 'confirmee', cle: CLE, organisation: 'Menuiserie Kerlann' });
    if (chemin === '/v0/droits') return Response.json({ orgId: 'org-essai', plan, etatAbonnement: 'actif', actifJusquau: null, capacites: [], verifieLe: new Date().toISOString() });
    return Response.json({ erreur: 'introuvable' }, { status: 404 });
  }) as typeof fetch;
}

/** Une entreprise vide, avec un chantier, son client, une attestation et un camion. Reliée ou non. */
async function entreprise(o: { offre?: 'active' | 'gratuit' | false } = {}) {
  process.env.LB_AUTORISER_LOCAL = '1';
  const app = await Application.creer({ exemple: null, fetch: reseau(o.offre === 'gratuit' ? 'gratuit' : 'active') });
  // une entreprise VIDE : ses échéances sont celles que l'essai écrit, et rien d'autre ne vient brouiller les comptes
  const dirigeante = app.monde.initialiser({ nom: 'Essai', entreprise: 'Menuiserie Kerlann', depart: 'vide' });
  if (o.offre) {
    await app.nexus.reglerAdresse(ADRESSE);
    await app.nexus.demarrerLiaison();
    assert.equal((await app.nexus.suivreLiaison()).statut, 'reliee');
    assert.equal((await app.nexus.etatPavillon()).statut, 'connecte');
  }
  const auj = app.monde.maintenant();
  const jour = (n: number) => new Date(auj.getTime() + n * JOUR).toISOString().slice(0, 10);
  const client = app.monde.creerObjetSysteme('essai', 'entreprise', 'Mairie de Kerlann', { email: 'contact@exemple.fr' }, { id: 'essai', libelle: 'Essai' }, ['client']);
  const chantier = app.monde.creerObjetSysteme('essai', 'projet', 'Toiture Kerlann', { client, echeance: jour(5) }, { id: 'essai', libelle: 'Essai' });
  const papier = app.monde.creerObjetSysteme('essai', 'document', 'Attestation URSSAF', { categorie: 'attestation', valide_jusqu_au: jour(12) }, { id: 'essai', libelle: 'Essai' });
  return { app, p: dirigeante, jour, client, chantier, papier };
}

const fiches = (app: Application) => app.monde.objetsReels().filter((o) => ecriteParLeMoteur(o));
const parType = (app: Application, type: string) => fiches(app).filter((o) => o.type === type);

// ------------------------------------------------------------------ sans doublon

test('une échéance crée un rendez-vous ET une tâche ; repasser n’en crée pas un deuxième', async () => {
  const { app, p, chantier } = await entreprise();
  app.suivis.regler(p, 'chantier', { portes: ['agenda', 'tache'] });

  const premier = app.suivis.passer();
  assert.deepEqual(premier, { crees: 2, majs: 0, retires: 0 });
  assert.equal(parType(app, 'rendez_vous').length, 1);
  assert.equal(parType(app, 'tache').length, 1);
  const rdv = parType(app, 'rendez_vous')[0];
  const tache = parType(app, 'tache')[0];
  assert.ok(rdv && tache);
  assert.match(rdv.nom, /^Projet Toiture Kerlann — Échéance$/);
  assert.equal(rdv.champs.concerne, chantier, 'le rendez-vous est rattaché au chantier');
  assert.equal(tache.champs.statut, 'à faire');
  assert.equal(tache.champs.concerne, chantier);

  // dix passages de plus : rien ne bouge, et surtout rien ne se duplique
  for (let i = 0; i < 10; i++) assert.deepEqual(app.suivis.passer(), { crees: 0, majs: 0, retires: 0 });
  assert.equal(parType(app, 'rendez_vous').length, 1);
  assert.equal(parType(app, 'tache').length, 1);
  assert.equal(parType(app, 'rendez_vous')[0]?.id, rdv.id, 'la même fiche, pas une nouvelle');
  app.arreter();
});

test('l’échéance déplacée met à jour la fiche existante ; le moteur ne se relit jamais lui-même', async () => {
  const { app, p, chantier, jour } = await entreprise();
  app.suivis.regler(p, 'chantier', { portes: ['agenda', 'tache'] });
  app.suivis.passer();
  const rdv = parType(app, 'rendez_vous')[0];
  assert.ok(rdv);
  assert.equal(rdv.champs.debut, jour(5));

  app.monde.majObjetSysteme('essai', chantier, { echeance: jour(2) });
  const apres = app.suivis.passer();
  assert.deepEqual(apres, { crees: 0, majs: 2, retires: 0 }, 'deux fiches mises à jour, aucune créée');
  assert.equal(parType(app, 'rendez_vous').length, 1);
  assert.equal(parType(app, 'rendez_vous')[0]?.champs.debut, jour(2));

  // la tâche que le moteur a écrite est rattachée au chantier : si elle était relue comme une étape, elle en
  // engendrerait une autre, puis une autre. Dix passages plus tard, il n'y a toujours qu'une tâche.
  for (let i = 0; i < 10; i++) app.suivis.passer();
  assert.equal(parType(app, 'tache').length, 1, 'aucun cycle : le moteur ignore ce qu’il a écrit');
  const suivis = app.suivis.suivis();
  assert.equal(suivis.some((s) => s.etapes.some((e) => e.id === `tache:${parType(app, 'tache')[0]?.id}`)), false);
  app.arreter();
});

// ------------------------------------------------------------------ défaire

test('une échéance annulée retire le rendez-vous et la tâche qu’elle avait créés', async () => {
  const { app, p, chantier } = await entreprise();
  app.suivis.regler(p, 'chantier', { portes: ['agenda', 'tache'] });
  app.suivis.passer();
  assert.equal(fiches(app).length, 2);

  // l'entreprise efface la date : l'échéance n'existe plus, donc ce qu'elle avait créé non plus
  app.monde.majObjetSysteme('essai', chantier, { echeance: null });
  assert.deepEqual(app.suivis.passer(), { crees: 0, majs: 0, retires: 2 });
  assert.equal(fiches(app).length, 0, 'rien ne traîne dans l’agenda ni dans la liste');
  assert.deepEqual(app.suivis.passer(), { crees: 0, majs: 0, retires: 0 }, 'et on ne retire pas deux fois');
  app.arreter();
});

test('une échéance réglée, ou une porte décochée, retire aussi ce qui avait été écrit', async () => {
  const { app, p, jour } = await entreprise();
  app.suivis.regler(p, 'papiers', { portes: ['agenda', 'tache'] });
  app.suivis.passer();
  assert.equal(fiches(app).length, 2);

  // la porte « tâche » est décochée : la tâche disparaît, le rendez-vous reste
  app.suivis.regler(p, 'papiers', { portes: ['agenda'] });
  assert.deepEqual(app.suivis.passer(), { crees: 0, majs: 0, retires: 1 });
  assert.equal(parType(app, 'tache').length, 0);
  assert.equal(parType(app, 'rendez_vous').length, 1);

  // tout décocher : plus rien ne sort pour ce sujet
  app.suivis.regler(p, 'papiers', { portes: [] });
  assert.deepEqual(app.suivis.passer(), { crees: 0, majs: 0, retires: 1 });
  assert.equal(fiches(app).length, 0);

  // et une échéance repoussée loin devant n'encombre plus l'agenda
  app.suivis.regler(p, 'papiers', { portes: ['agenda'] });
  app.suivis.passer();
  assert.equal(fiches(app).length, 1);
  const papier = app.monde.objetsReels().find((o) => o.type === 'document');
  assert.ok(papier);
  app.monde.majObjetSysteme('essai', papier.id, { valide_jusqu_au: jour(300) });
  assert.deepEqual(app.suivis.passer(), { crees: 0, majs: 0, retires: 1 });
  app.arreter();
});

test('une fiche effacée : le moteur oublie ce qu’il avait écrit pour elle, et retire son lien', async () => {
  const { app, p, chantier } = await entreprise({ offre: 'active' });
  app.suivis.regler(p, 'chantier', { portes: ['agenda', 'tache'] });
  app.suivis.passer();
  const cree = app.suivis.creerLien(p, chantier);
  assert.equal(app.suivis.liensDe(chantier).length, 1);
  assert.ok(JETON.test(cree.jeton));

  app.effacerObjet(p, 'sid-essai', chantier, { mode: 'anonymiser' });
  assert.deepEqual(app.suivis.liensDe(chantier), [], 'le lien partagé ne survit pas à la fiche');
  assert.equal(app.suivis.page(cree.jeton).etat, 'fermee');
  app.arreter();
});

// ------------------------------------------------------------------ sans agenda branché, tout marche

test('entreprise SANS agenda ni liste branchés : tout fonctionne, les fiches restent simplement chez elle', async () => {
  const { app, p } = await entreprise({ offre: false });
  assert.deepEqual(app.synchro.lister(SYSTEME), [], 'aucun connecteur : ni agenda, ni liste de tâches');
  app.suivis.regler(p, 'chantier', { portes: ['agenda', 'tache'] });
  app.suivis.regler(p, 'papiers', { portes: ['agenda', 'tache'] });
  const r = app.suivis.passer();
  assert.equal(r.crees, 4, 'deux échéances, deux portes : quatre fiches, sans se plaindre de rien');
  assert.equal(parType(app, 'rendez_vous').length, 2);
  assert.equal(parType(app, 'tache').length, 2);
  // les rendez-vous entrent dans le planning du jeu comme ceux écrits à la main : c'est là qu'ils servent déjà
  const planning = app.monde.planning(p, 'sid-essai', app.monde.maintenant().toISOString().slice(0, 10), 15);
  assert.ok(planning, 'le planning se lit sans erreur avec ces rendez-vous');
  // et les écrans de réglage ne réclament rien : les quatre portes restent comprises, reliée ou non
  const reglages = app.suivis.reglages(p);
  assert.deepEqual(reglages.portes.map((x) => x.id), PORTES.map((x) => x.id));
  assert.match(reglages.pageClient.phraseOffre ?? '', /n’est reliée à aucun réseau Breizhcosystem/);
  app.arreter();
});

test('les quatre portes sont comprises : détecter et prévenir ne demandent rien à personne', async () => {
  const { app, p } = await entreprise({ offre: false });
  // aucune porte n'est une automatisation réservée : ce sont les quatre façons de PRÉVENIR, et c'est compris
  for (const porte of PORTES) {
    app.suivis.regler(p, 'papiers', { portes: [porte.id] });
    assert.deepEqual(app.suivis.reglages(p).sujets.find((s) => s.id === 'papiers')?.portes, [porte.id]);
  }
  // ce qui est réservé, c'est la page qu'on PUBLIE pour un client : elle n'est pas dans les automatisations comprises
  assert.equal(estGratuite(AUTOMATISATION_PAGE), false);
  assert.equal(app.suivis.reglages(p).pageClient.verrouillee, true);
  app.arreter();
});

// ------------------------------------------------------------------ la page du client, et l'offre

test('la page de suivi d’un client relève de l’offre : sans elle, rien n’est publié, et on dit pourquoi', async () => {
  const { app, p, chantier } = await entreprise({ offre: 'gratuit' });
  const r = app.suivis.reglages(p);
  assert.equal(r.pageClient.verrouillee, true);
  assert.match(r.pageClient.motif ?? '', /produit et elle envoie/, 'le motif vient de core/offre.ts, pas d’un texte à part');
  assert.match(r.pageClient.phraseOffre ?? '', /l’offre Breizhcosystem ACTIVE n’y est pas ouverte/);
  assert.throws(() => app.suivis.creerLien(p, chantier), (e: unknown) => e instanceof ErreurApi && e.statut === 402 && e.code === 'offre_requise');
  assert.deepEqual(app.suivis.liensDe(chantier), [], 'rien n’a été créé en douce');
  app.arreter();
});

test('avec l’offre : un lien, la page que le client ouvre, et l’entreprise qui voit qu’il l’a ouverte', async () => {
  const { app, p, chantier, client } = await entreprise({ offre: 'active' });
  assert.equal(app.suivis.reglages(p).pageClient.verrouillee, false);
  const cree = app.suivis.creerLien(p, chantier, { avis: true });
  assert.ok(JETON.test(cree.jeton));
  assert.equal(cree.lien.ouvertures, 0);
  assert.match(cree.lien.phrase, /pas encore ouvert/);

  const page = app.suivis.page(cree.jeton);
  assert.ok(page.etat === 'ouverte');
  assert.equal(page.titre, 'Suivre mon projet', 'nommé par l’univers de l’entreprise');
  assert.equal(page.entreprise, 'Menuiserie Kerlann');
  assert.equal(page.reference, 'Toiture Kerlann');
  assert.match(page.phrase, /Échéance : dans 5 jours/);
  // le client final ne voit rien d'une autre fiche : ni son client, ni les autres chantiers
  assert.equal(JSON.stringify(page).includes('Mairie de Kerlann'), false);
  assert.equal(JSON.stringify(page).includes(client), false);
  assert.equal(JSON.stringify(page).includes('Attestation URSSAF'), false);

  // l'entreprise le voit : une ouverture, puis deux
  assert.equal(app.suivis.liensDe(chantier)[0]?.ouvertures, 1);
  app.suivis.page(cree.jeton);
  const vue = app.suivis.liensDe(chantier)[0];
  assert.equal(vue?.ouvertures, 2);
  assert.match(String(vue?.phrase), /ouvert 2 fois/);
  // une prévisualisation côté entreprise ne compte pas pour une visite du client
  app.suivis.page(cree.jeton, { noter: false });
  assert.equal(app.suivis.liensDe(chantier)[0]?.ouvertures, 2);
  app.arreter();
});

test('un lien révoqué ne montre plus rien, et l’entreprise le constate', async () => {
  const { app, p, chantier } = await entreprise({ offre: 'active' });
  const cree = app.suivis.creerLien(p, chantier);
  assert.ok(app.suivis.page(cree.jeton).etat === 'ouverte');

  const retire = app.suivis.revoquerLien(p, cree.lien.id);
  assert.equal(retire.revoque, true);
  const page = app.suivis.page(cree.jeton);
  assert.ok(page.etat === 'fermee');
  assert.equal(page.refus, 'revoque');
  assert.equal(JSON.stringify(page).includes('Toiture Kerlann'), false, 'plus un mot du chantier');
  assert.equal(JSON.stringify(page).includes('Menuiserie'), false, 'plus un mot de l’entreprise');
  // le lien reste dans la liste, marqué retiré : l'entreprise doit pouvoir constater qu'elle l'a bien repris
  assert.match(String(app.suivis.liensDe(chantier)[0]?.phrase), /ne montre plus rien/);
  // et un jeton inventé n'ouvre rien non plus
  assert.ok(app.suivis.page('z'.repeat(43)).etat === 'fermee');
  assert.ok(app.suivis.page('trop court').etat === 'fermee');
  app.arreter();
});

test('recréer un lien retire le précédent : il n’en traîne jamais deux pour le même suivi', async () => {
  const { app, p, chantier } = await entreprise({ offre: 'active' });
  const a = app.suivis.creerLien(p, chantier);
  const b = app.suivis.creerLien(p, chantier);
  assert.notEqual(a.jeton, b.jeton);
  assert.ok(app.suivis.page(a.jeton).etat === 'fermee', 'l’ancien lien ne sert plus');
  assert.ok(app.suivis.page(b.jeton).etat === 'ouverte');
  assert.equal(app.suivis.liensDe(chantier).filter((l) => !l.revoque).length, 1);
  app.arreter();
});

test('un sujet qui ne regarde que l’entreprise ne se partage pas, et un sujet inventé est refusé', async () => {
  const { app, p, papier } = await entreprise({ offre: 'active' });
  assert.throws(() => app.suivis.creerLien(p, papier), (e: unknown) => e instanceof ErreurApi && e.code === 'sans_page_client');
  assert.throws(() => app.suivis.regler(p, 'inventé', { portes: ['agenda'] }), (e: unknown) => e instanceof ErreurApi && e.statut === 404);
  assert.throws(() => app.suivis.creerLien(p, 'obj-inexistant'), (e: unknown) => e instanceof ErreurApi && e.statut === 404);
  app.arreter();
});

// ------------------------------------------------------------------ l'état relu du disque

test('les portes, les fiches écrites et les liens survivent à un redémarrage', async () => {
  const { app, p, chantier } = await entreprise({ offre: 'active' });
  app.suivis.regler(p, 'chantier', { portes: ['agenda'] });
  app.suivis.passer();
  const cree = app.suivis.creerLien(p, chantier);
  const etat = app.instantane();
  assert.ok(etat.suivis);
  assert.deepEqual(etat.suivis.portes.chantier, ['agenda']);
  assert.equal(Object.keys(etat.suivis.inscrits).length, 1);
  assert.equal(etat.suivis.liens.length, 1);
  assert.equal(JSON.stringify(etat.suivis).includes(cree.jeton), false, 'le jeton n’est jamais enregistré en clair');
  app.arreter();

  const repris = await Application.creer({ exemple: null, etat, fetch: reseau('active') });
  assert.deepEqual(repris.suivis.instantane().portes.chantier, ['agenda']);
  // rien à refaire : la fiche écrite avant est retrouvée par sa clé, pas recréée
  assert.deepEqual(repris.suivis.passer(), { crees: 0, majs: 0, retires: 0 });
  assert.equal(parType(repris, 'rendez_vous').length, 1);
  assert.ok(repris.suivis.page(cree.jeton).etat === 'ouverte', 'le lien du client marche encore');
  repris.arreter();
});
