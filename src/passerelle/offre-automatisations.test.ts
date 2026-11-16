/**
 * Écran Optimiser, les trois cas d'une entreprise : non reliée, reliée sans l'offre, reliée avec Breizhcosystem ACTIVE.
 * Ce qui est essayé ici :
 * - une automatisation réservée reste DANS la liste, avec son gain chiffré sur les données réelles et son motif ;
 * - elle ne se met pas en marche (402 qui dit pourquoi) et elle n'agit pas, même si elle était en marche avant ;
 * - « Tout automatiser » n'allume que ce qui est à portée et rend ce qui reste, avec son gain ;
 * - une entreprise non reliée garde les six comprises, voit les autres présentées, et son écran ne dépend d'aucun
 *   appel réseau : un réseau en panne n'enlève rien et ne fait rien attendre ;
 * - l'offre revenue, l'automatisation reprend telle quelle : rien n'a été effacé entre-temps.
 * Le partage lui-même et ce que vaut ce verrou : ../core/offre.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estGratuite, GRATUITES } from '../core/offre.ts';
import { Application } from './application.ts';
import { RECETTES } from './automatisations.ts';
import { ErreurApi } from './monde.ts';

const ADRESSE = 'http://127.0.0.1:4180';
const CLE = ['nx', 'k'.repeat(43)].join('_');
const RESERVEES = RECETTES.filter((r) => !estGratuite(r.id)).map((r) => r.id);

/** Réseau simulé : la liaison, puis les droits que l'essai règle à sa guise (ou une panne). */
function reseau(plan: 'gratuit' | 'active' = 'active') {
  const s = {
    plan,
    etatAbonnement: 'actif',
    enPanne: false,
    appels: 0,
    f: (async (url: string | URL | Request): Promise<Response> => {
      const chemin = new URL(String(url)).pathname;
      s.appels++;
      if (chemin === '/v0/liaison') return Response.json({ code: 'ABCD-2345', attente: 'a'.repeat(43), url: 'https://reseau.test/relier?code=ABCD-2345', expire: new Date(Date.now() + 600_000).toISOString() });
      if (chemin === '/v0/liaison/retrait') return Response.json({ statut: 'confirmee', cle: CLE, organisation: 'Menuiserie Kerlann' });
      if (s.enPanne) throw new Error('ECONNREFUSED');
      if (chemin === '/v0/droits') return Response.json({ orgId: 'org-essai', plan: s.plan, etatAbonnement: s.etatAbonnement, actifJusquau: null, capacites: [], verifieLe: new Date().toISOString() });
      return Response.json({ erreur: 'introuvable' }, { status: 404 });
    }) as typeof fetch,
  };
  return s;
}

/** Une entreprise de démonstration, reliée ou non, avec les droits que le réseau simulé confirme. */
async function entreprise(o: { relier?: 'gratuit' | 'active' | false } = {}) {
  const n = reseau(o.relier === 'gratuit' ? 'gratuit' : 'active');
  const app = await Application.creer({ exemple: 'pme', fetch: n.f });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  if (o.relier) {
    await app.nexus.reglerAdresse(ADRESSE);
    await app.nexus.demarrerLiaison();
    assert.equal((await app.nexus.suivreLiaison()).statut, 'reliee');
    assert.equal((await app.nexus.etatPavillon()).statut, 'connecte');
  }
  return { app, p, n, prep: () => app.automatisations.preparation(p) };
}

const une = <T extends { id: string }>(prep: { recettes: readonly T[] }, id: string) => prep.recettes.find((r) => r.id === id);

test('entreprise NON RELIÉE : les six comprises marchent, les huit autres sont présentées avec leur gain chiffré', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { app, p, n, prep } = await entreprise();
    const avant = prep();
    assert.equal(avant.offre, 'non_reliee');
    assert.equal(n.appels, 0, 'aucun appel réseau : l’écran s’affiche sans rien attendre');

    // la liste entière reste visible : rien n'est caché, chaque ligne porte son état
    assert.equal(avant.recettes.length, RECETTES.length);
    assert.deepEqual(avant.recettes.filter((r) => r.verrouillee).map((r) => r.id), RESERVEES);
    assert.equal(avant.reservees, RESERVEES.length);
    assert.equal(avant.pretes, 4, 'les quatre comprises sont prêtes sur cet exemple');
    assert.ok(avant.heuresMoisReservees > 0 && avant.euroMoisReservees > 0, 'ce qui est réservé est chiffré, pas seulement nommé');
    assert.match(avant.phraseOffre ?? '', /n’est reliée à aucun réseau Breizhcosystem/);

    // chaque réservée garde son gain calculé sur les données réelles, et dit pourquoi elle est réservée
    const factures = une(avant, 'relance-factures');
    assert.equal(factures?.verrouillee, true);
    assert.equal(factures?.etat, 'prete', 'les données qu’elle regarde sont bien là : on ne prétend pas le contraire');
    assert.ok((factures?.heuresMois ?? 0) > 0 && (factures?.euroMois ?? 0) > 0, 'son gain est chiffré');
    assert.match(factures?.motif ?? '', /produit et elle envoie/);
    for (const r of avant.recettes.filter((x) => x.verrouillee)) assert.ok((r.motif ?? '').length > 40, `${r.id} dit pourquoi`);
    for (const r of avant.recettes.filter((x) => !x.verrouillee)) assert.equal(r.motif, null, `${r.id} n’a rien à justifier`);

    // la mettre en marche est refusé, et le refus dit pourquoi (402, jamais une erreur muette)
    assert.throws(() => app.automatisations.activer(p, 'relance-factures', { actif: true }),
      (e: unknown) => e instanceof ErreurApi && e.statut === 402 && /produit et elle envoie/.test(e.message));
    // les comprises se mettent en marche comme avant
    assert.equal(app.automatisations.activer(p, 'documents', { actif: true }).active, true);
    assert.ok((await app.automatisations.executer()) > 0);
    assert.equal(n.appels, 0, 'toujours aucun appel réseau');
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('« Tout automatiser », entreprise NON RELIÉE : seules les comprises s’allument, et ce qui reste est rendu avec son gain', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { app, p, prep } = await entreprise();
    const fait = app.automatisations.toutActiver(p);
    assert.deepEqual([...fait.activees].sort(), ['documents', 'relance-devis', 'trous-planning', 'vehicules']);
    for (const id of fait.activees) assert.equal(estGratuite(id), true, `${id} est compris dans Living Business`);
    assert.deepEqual(fait.reservees.map((r) => r.id), RESERVEES, 'ce qui n’a pas été allumé est dit, nommément');
    assert.ok(fait.reservees.some((r) => r.heuresMois > 0 && r.euroMois > 0), 'avec son gain, pas seulement son nom');
    assert.equal(fait.offre, 'non_reliee');

    const apres = prep();
    assert.equal(apres.pretes, 0, 'plus rien à portée à mettre en marche');
    assert.equal(apres.reservees, RESERVEES.length, 'les réservées restent dans la liste');
    assert.deepEqual(app.automatisations.toutActiver(p).activees, [], 'un second geste n’ajoute rien');
    // ce que les automatisations en marche ont préparé existe pour de vrai ; aucune réservée n’a agi
    assert.ok((await app.automatisations.executer()) > 0);
    const taches = app.monde.objetsReels().filter((o) => o.famille === 'tache');
    assert.ok(taches.length > 0);
    assert.equal(taches.some((t) => t.source.id.startsWith('automatisation:') && RESERVEES.includes(t.source.id.slice('automatisation:'.length))), false, 'aucune réservée n’a préparé de tâche');
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('entreprise RELIÉE SANS l’offre : exactement les mêmes six, et on dit que l’offre n’est pas ouverte', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { app, p, prep } = await entreprise({ relier: 'gratuit' });
    const avant = prep();
    assert.equal(avant.offre, 'sans_offre');
    assert.deepEqual(avant.recettes.filter((r) => r.verrouillee).map((r) => r.id), RESERVEES);
    assert.match(avant.phraseOffre ?? '', /reliée à Breizhcosystem ; l’offre Breizhcosystem ACTIVE n’y est pas ouverte/);
    assert.throws(() => app.automatisations.activer(p, 'satisfaction-auto', { actif: true }), (e: unknown) => e instanceof ErreurApi && e.statut === 402);
    assert.deepEqual([...app.automatisations.toutActiver(p).activees].sort(), ['documents', 'relance-devis', 'trous-planning', 'vehicules']);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('entreprise AVEC l’offre : plus rien n’est réservé, « Tout automatiser » allume tout, et les relances ne se répètent pas', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { app, p, prep } = await entreprise({ relier: 'active' });
    const avant = prep();
    assert.equal(avant.offre, 'offre_active');
    assert.equal(avant.reservees, 0);
    assert.equal(avant.heuresMoisReservees, 0);
    assert.equal(avant.phraseOffre, null);
    assert.equal(avant.recettes.every((r) => !r.verrouillee && r.motif === null), true);
    assert.equal(avant.pretes, RECETTES.length, 'sur cet exemple, les douze ont leurs données');

    const fait = app.automatisations.toutActiver(p);
    assert.equal(fait.activees.length, RECETTES.length);
    assert.deepEqual(fait.reservees, []);
    const n1 = await app.automatisations.executer();
    assert.ok(n1 > 0);
    assert.equal(await app.automatisations.executer(), 0, 'pas de doublon au passage suivant');
    assert.ok(app.monde.objetsReels().some((o) => o.famille === 'tache' && o.nom.startsWith('Relancer ')), 'la relance des factures a préparé sa tâche');
    assert.equal(prep().recettes.every((r) => r.etat === 'active'), true);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('l’offre s’en va puis revient : l’automatisation s’arrête d’agir, son réglage est gardé, et elle reprend telle quelle', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { app, p, n, prep } = await entreprise({ relier: 'active' });
    app.automatisations.activer(p, 'relance-factures', { actif: true });
    assert.equal(une(prep(), 'relance-factures')?.etat, 'active');

    // le réseau ne confirme plus l'offre : elle n'agit plus, et l'écran le dit au lieu de la montrer en marche
    n.plan = 'gratuit';
    await app.nexus.etatPavillon();
    const sans = une(prep(), 'relance-factures');
    assert.equal(sans?.verrouillee, true);
    assert.notEqual(sans?.etat, 'active', 'elle n’est pas montrée en marche alors qu’elle n’agit plus');
    assert.equal(app.automatisations.lister(p).recettes.find((r) => r.id === 'relance-factures')?.active, false);
    assert.equal(app.monde.objetsReels().some((o) => o.source.id === 'automatisation:relance-factures'), false);
    await app.automatisations.executer();
    assert.equal(app.monde.objetsReels().some((o) => o.source.id === 'automatisation:relance-factures'), false, 'réservée : elle n’a rien préparé');
    // rien n'a été effacé : l'enregistrement garde son réglage
    assert.ok(app.automatisations.instantane().actives.includes('relance-factures'));

    n.plan = 'active';
    await app.nexus.etatPavillon();
    assert.equal(une(prep(), 'relance-factures')?.etat, 'active', 'l’offre revenue, elle reprend sans rien redemander');
    assert.ok((await app.automatisations.executer()) > 0);
    assert.ok(app.monde.objetsReels().some((o) => o.source.id === 'automatisation:relance-factures'));
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('réseau en panne : l’écran s’affiche, les derniers droits confirmés tiennent, rien n’est coupé d’un coup', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const { app, p, n, prep } = await entreprise({ relier: 'active' });
    app.automatisations.activer(p, 'relance-factures', { actif: true });
    n.enPanne = true;
    assert.equal((await app.nexus.etatPavillon()).statut, 'indisponible');
    const pendant = prep();
    assert.equal(pendant.offre, 'offre_active', 'ce qui a été confirmé tient : une panne ne reprend pas ce qui est payé');
    assert.equal(une(pendant, 'relance-factures')?.etat, 'active');
    assert.ok((await app.automatisations.executer()) > 0, 'les automatisations continuent sans le réseau');
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('les six comprises tiennent dans les trois cas, et une entreprise sans rien de relié n’a jamais d’écran cassé', async () => {
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    for (const relier of [false, 'gratuit', 'active'] as const) {
      const { prep } = await entreprise({ relier });
      const comprises = prep().recettes.filter((r) => !r.verrouillee).map((r) => r.id);
      for (const id of GRATUITES) {
        if (!RECETTES.some((r) => r.id === id)) continue;
        assert.ok(comprises.includes(id), `${id} reste compris (liaison : ${String(relier)})`);
      }
    }
    // entreprise vide, jamais reliée, avec un réseau qui refuserait tout : la préparation répond quand même
    const app = await Application.creer({ connexion: 'comptes', fetch: (async () => { throw new Error('aucun appel réseau attendu'); }) as typeof fetch });
    const p = app.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann', depart: 'vide' });
    const vide = app.automatisations.preparation(p);
    assert.equal(vide.offre, 'non_reliee');
    assert.equal(vide.recettes.length, RECETTES.length);
    assert.equal(vide.pretes, 0);
    assert.equal(vide.reservees, RESERVEES.length);
    assert.deepEqual(app.automatisations.toutActiver(p).activees, []);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});
