/**
 * Tâches répétitives déclarées (« est-ce que ça vaut le coup de l'automatiser ? ») : enregistrées avec les
 * automatisations, lues par la direction et les approbateurs, écrites par les seuls administrateurs — jamais par une
 * clé d'API. Lien avec les 12 automatisations existantes (en marche, prête, données manquantes), limites de taille et
 * de nombre, personne attachée oubliée à l'effacement de sa fiche, rien d'envoyé à l'extérieur.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { TACHES_MAX } from '../core/taches-repetitives.ts';
import { Application } from './application.ts';
import { RECETTES } from './automatisations.ts';
import { creerServeur } from './http.ts';

const simple = (t: string) => t.replace(/[\u00A0\u202F]/g, ' ');
const tache = (o: Record<string, unknown> = {}) => ({
  nom: 'Relancer les factures', qui: 'Anna', tempsGagne: 5, uniteTemps: 'minutes', fois: 3, periode: 'jour',
  tempsAutomatiser: 4, uniteAutomatiser: 'heures', memeFacon: 'oui', casParticuliers: 'rarement', graviteErreur: 'sans_gravite', recette: null, ...o,
});
/** Récupérateur qui note tout appel vers l'extérieur (il ne doit y en avoir aucun). */
function sorties() {
  const appels: string[] = [];
  const f = (async (url: string | URL | Request) => { appels.push(String(url)); return Response.json({}); }) as typeof fetch;
  return { f, appels };
}

test('tâches déclarées : vide au départ avec des idées ; ajout, verdict expliqué, tri, modification, suppression', async () => {
  const s = sorties();
  const a = await Application.creer({ exemple: 'pme', fetch: s.f });
  const p = a.monde.profil('dirigeante');
  assert.ok(p);
  const vide = a.automatisations.taches(p);
  assert.deepEqual(vide.taches, []);
  assert.deepEqual([vide.max, vide.tauxHoraire, vide.horizonAns, vide.outilBranche], [TACHES_MAX, 35, 5, false]);
  assert.ok(vide.idees.length >= 6);
  for (const i of vide.idees) assert.ok(i.recette === null || RECETTES.some((r) => r.id === i.recette), `${i.id} : automatisation existante`);

  // estimer ne garde rien
  const essai = a.automatisations.estimerTache(p, tache());
  assert.equal(essai.calcul.verdict, 'a_automatiser');
  assert.equal(simple(essai.calcul.explications.temps), '5 min × 3 fois par jour × 228 jours travaillés par an = 57 h par an.');
  assert.equal(a.automatisations.taches(p).taches.length, 0);
  assert.equal(a.instantane().automatisations.taches?.length, 0);

  const petite = a.automatisations.ajouterTache(p, tache({ nom: 'Archiver un contrat', tempsGagne: 59, fois: 1, periode: 'an' }));
  const grande = a.automatisations.ajouterTache(p, tache());
  const moyenne = a.automatisations.ajouterTache(p, tache({ nom: 'Préparer le point de la semaine', tempsGagne: 6, fois: 60, periode: 'an' }));
  assert.match(grande.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(grande.id, petite.id);
  assert.equal(grande.calcul.euroAn, 1995);
  assert.equal(grande.automatisation, null);
  assert.equal(grande.qui, 'Anna');
  const liste = a.automatisations.taches(p).taches;
  assert.deepEqual(liste.map((t) => t.id), [grande.id, moyenne.id, petite.id], 'ce qui vaut le plus le coup d’abord');
  assert.deepEqual(liste.map((t) => t.calcul.verdict), ['a_automatiser', 'a_planifier', 'gain_trop_faible']);
  for (const t of liste) assert.ok(t.calcul.raison.length > 20 && t.calcul.libelle.length > 5);

  const modifiee = a.automatisations.modifierTache(p, petite.id, tache({ nom: 'Archiver les contrats', tempsGagne: 30, fois: 10, periode: 'semaine', graviteErreur: 'grave' }));
  assert.equal(modifiee.id, petite.id);
  assert.equal(modifiee.creeLe, petite.creeLe);
  assert.equal(modifiee.calcul.heuresAn, 228);
  assert.equal(modifiee.calcul.verdict, 'a_automatiser_en_validant');
  assert.equal(a.automatisations.taches(p).taches[0]?.nom, 'Archiver les contrats', '228 h par an passent devant 57 h, même s’il faut valider chaque envoi');

  assert.deepEqual(a.automatisations.supprimerTache(p, moyenne.id), { ok: true, id: moyenne.id });
  assert.equal(a.automatisations.taches(p).taches.length, 2);
  assert.throws(() => a.automatisations.supprimerTache(p, moyenne.id), /introuvable/);
  assert.throws(() => a.automatisations.modifierTache(p, 'inconnue', tache()), /introuvable/);
  assert.equal(s.appels.length, 0, 'rien n’est envoyé à l’extérieur');
});

test('tâches déclarées : lues par la direction et les approbateurs, écrites par les seuls administrateurs', async () => {
  const a = await Application.creer({ exemple: 'pme' });
  const dir = a.monde.profil('dirigeante');
  const terrain = a.monde.profil('terrain');
  const stock = a.monde.profil('responsable-stock');
  assert.ok(dir && terrain && stock);
  const t = a.automatisations.ajouterTache(dir, tache());
  for (const p of [terrain, stock]) {
    assert.throws(() => a.automatisations.taches(p), /interdit/);
    assert.throws(() => a.automatisations.ajouterTache(p, tache()), /interdit/);
  }
  const approbatrice = a.monde.profil((a.monde.creerAcces(dir, { nom: 'Approbatrice', role: 'responsable', peutApprouver: true }) as { id: string }).id);
  assert.ok(approbatrice && approbatrice.peutApprouver && !approbatrice.peutAdministrer);
  assert.equal(a.automatisations.taches(approbatrice).taches.length, 1, 'un approbateur lit');
  assert.throws(() => a.automatisations.ajouterTache(approbatrice, tache()), /interdit/);
  assert.throws(() => a.automatisations.estimerTache(approbatrice, tache()), /interdit/);
  assert.throws(() => a.automatisations.modifierTache(approbatrice, t.id, tache({ nom: 'Autre' })), /interdit/);
  assert.throws(() => a.automatisations.supprimerTache(approbatrice, t.id), /interdit/);
  assert.throws(() => a.automatisations.regler(approbatrice, { horizonAns: 2 }), /interdit/);
  assert.deepEqual(a.automatisations.taches(dir).taches.map((x) => x.nom), ['Relancer les factures'], 'rien n’a changé');
});

test('tâches déclarées : saisies refusées (400, message clair), 100 tâches au plus', async () => {
  const a = await Application.creer({ exemple: 'pme' });
  const p = a.monde.profil('dirigeante');
  assert.ok(p);
  const refus = (d: unknown, message: RegExp) => assert.throws(() => a.automatisations.ajouterTache(p, d), (e: unknown) => {
    const x = e as { statut?: number; code?: string; message: string };
    return x.statut === 400 && x.code === 'tache_invalide' && message.test(simple(x.message));
  }, JSON.stringify(d));
  refus(tache({ nom: 'x'.repeat(121) }), /120 caractères au plus/);
  refus(tache({ nom: '  ' }), /Donnez un nom/);
  refus(tache({ qui: 'x'.repeat(81) }), /80 caractères au plus/);
  refus(tache({ tempsGagne: 0 }), /Temps gagné à chaque fois : un nombre plus grand que 0, 1 000 au plus/);
  refus(tache({ fois: 2.5 }), /nombre entier entre 1 et 1 000/);
  refus(tache({ tempsAutomatiser: 1e9 }), /Temps pour l’automatiser/);
  refus(tache({ uniteAutomatiser: 'siècles' }), /réponses proposées/);
  refus(tache({ recette: 'inconnue' }), /n’existe pas/);
  refus(null, /illisible/);
  refus('tâche', /illisible/);
  assert.equal(a.automatisations.taches(p).taches.length, 0);
  assert.throws(() => a.automatisations.estimerTache(p, tache({ fois: 0 })), /nombre entier/);

  for (let i = 0; i < TACHES_MAX; i++) a.automatisations.ajouterTache(p, tache({ nom: `Tâche ${i + 1}` }));
  assert.throws(() => a.automatisations.ajouterTache(p, tache({ nom: 'Une de trop' })), (e: unknown) => (e as { statut?: number; code?: string }).statut === 409 && (e as { code?: string }).code === 'trop_de_taches');
  assert.equal(a.automatisations.taches(p).taches.length, TACHES_MAX);
  // au plafond, on peut encore modifier et supprimer
  const premiere = a.automatisations.taches(p).taches[0];
  assert.ok(premiere);
  assert.equal(a.automatisations.modifierTache(p, premiere.id, tache({ nom: 'Renommée' })).nom, 'Renommée');
  a.automatisations.supprimerTache(p, premiere.id);
  assert.equal(a.automatisations.ajouterTache(p, tache({ nom: 'La centième' })).nom, 'La centième');
});

test('« celle-ci le fait déjà » : la tâche montre l’état de l’automatisation attachée (données manquantes, prête, en marche)', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const p = app.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann', depart: 'vide' });
  const t = app.automatisations.ajouterTache(p, tache({ nom: 'Rappeler les clients mécontents', recette: 'avis-bas' }));
  assert.equal(t.automatisation?.id, 'avis-bas');
  assert.equal(t.automatisation?.nom, 'Client mécontent');
  assert.equal(t.automatisation?.etat, 'a_brancher');
  assert.match(t.automatisation?.manque ?? '', /clients/);
  const etat = () => app.automatisations.taches(p).taches.find((x) => x.id === t.id)?.automatisation;
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Cave du Port', roles: ['client'], champs: {} });
  assert.equal(etat()?.etat, 'prete', 'un client suffit : l’automatisation peut être mise en marche');
  assert.equal(etat()?.manque, null);
  app.automatisations.activer(p, 'avis-bas', { actif: true });
  assert.equal(etat()?.etat, 'active');
  app.automatisations.activer(p, 'avis-bas', { actif: false });
  assert.equal(etat()?.etat, 'prete');
  // sans automatisation attachée : rien à montrer ; l'écran dit ce qu'il reste à faire selon `outilBranche`
  const seule = app.automatisations.ajouterTache(p, tache({ nom: 'Recopier les commandes' }));
  assert.equal(seule.automatisation, null);
  assert.equal(app.automatisations.taches(p).outilBranche, false);
  // détacher l'automatisation
  assert.equal(app.automatisations.modifierTache(p, t.id, tache({ recette: '' })).automatisation, null);
});

test('qui la fait : texte libre, ou une personne de l’entreprise — nommée seulement à qui voit sa fiche, oubliée si sa fiche est effacée', async () => {
  const a = await Application.creer({ exemple: 'pme' });
  const p = a.monde.profil('dirigeante');
  assert.ok(p);
  const personnes = a.monde.objetsReels().filter((o) => o.famille === 'personne');
  const client = a.monde.objetsReels().find((o) => o.famille === 'tiers');
  const [une, autre] = personnes;
  assert.ok(une && autre && client);
  const t = a.automatisations.ajouterTache(p, tache({ qui: 'peu importe', personne: une.id }));
  assert.equal(t.personne, une.id);
  assert.equal(t.qui, une.nom.replace(/\s*\((démo|fictif|fictive)\)/gi, ''), 'le nom de la fiche, sans la mention d’exemple');
  assert.equal(a.instantane().automatisations.taches?.[0]?.qui, '', 'le nom n’est pas recopié : il suit la fiche');
  assert.throws(() => a.automatisations.ajouterTache(p, tache({ personne: client.id })), /introuvable dans votre entreprise/);
  assert.throws(() => a.automatisations.ajouterTache(p, tache({ personne: 'personne-inconnue' })), /introuvable dans votre entreprise/);
  // un approbateur qui ne voit pas cette fiche ne lit pas le nom
  const etroit = a.monde.profil((a.monde.creerAcces(p, { nom: 'Approbateur', role: 'responsable', peutApprouver: true }) as { id: string }).id);
  assert.ok(etroit);
  const vue = a.automatisations.taches(etroit).taches[0];
  assert.deepEqual([vue?.personne, vue?.qui], [null, '']);
  // fiche effacée : la tâche reste, sans la personne
  const u = a.automatisations.ajouterTache(p, tache({ nom: 'Saisir les heures', personne: autre.id }));
  a.effacerObjet(p, 's', autre.id, { mode: 'supprimer' });
  const apres = a.automatisations.taches(p).taches.find((x) => x.id === u.id);
  assert.deepEqual([apres?.personne, apres?.qui], [null, '']);
  assert.equal(a.instantane().automatisations.taches?.find((x) => x.id === u.id)?.personne, null);
  assert.equal(a.automatisations.taches(p).taches.find((x) => x.id === t.id)?.personne, une.id, 'les autres tâches gardent leur personne');
});

test('réglages : durée comptée de 1 à 5 ans à côté du coût horaire ; les verdicts suivent', async () => {
  const a = await Application.creer({ exemple: 'pme' });
  const p = a.monde.profil('dirigeante');
  assert.ok(p);
  const t = a.automatisations.ajouterTache(p, tache({ tempsGagne: 60, fois: 20, periode: 'an', tempsAutomatiser: 3, uniteAutomatiser: 'jours' }));
  assert.equal(t.calcul.verdict, 'petit_gain');
  assert.deepEqual(a.automatisations.regler(p, { horizonAns: 1 }), { tauxHoraire: 35, horizonAns: 1 });
  const unAn = a.automatisations.taches(p);
  assert.equal(unAn.horizonAns, 1);
  assert.equal(unAn.taches[0]?.calcul.verdict, 'pas_rentable');
  assert.equal(simple(unAn.taches[0]?.calcul.libelle ?? ''), 'Pas rentable sur 1 an');
  assert.deepEqual(a.automatisations.regler(p, { tauxHoraire: 50 }), { tauxHoraire: 50, horizonAns: 1 }, 'le coût horaire seul ne touche pas la durée');
  assert.equal(a.automatisations.taches(p).taches[0]?.calcul.euroAn, 1000);
  assert.deepEqual(a.automatisations.regler(p, { tauxHoraire: 40, horizonAns: 3 }), { tauxHoraire: 40, horizonAns: 3 });
  for (const h of [0, 6, 2.5, '3', null]) assert.throws(() => a.automatisations.regler(p, { horizonAns: h }), /Durée comptée/, String(h));
  assert.throws(() => a.automatisations.regler(p, { tauxHoraire: 0, horizonAns: 2 }), /Coût horaire/);
  assert.throws(() => a.automatisations.regler(p, {}), /Coût horaire/, 'comme avant : un réglage vide est refusé');
  assert.deepEqual([a.automatisations.taches(p).tauxHoraire, a.automatisations.taches(p).horizonAns], [40, 3], 'un réglage refusé ne change rien');
});

test('enregistrement : les tâches et la durée comptée survivent à un redémarrage ; un enregistrement abîmé ou ancien est relu sans erreur', async () => {
  const a = await Application.creer({ exemple: 'pme' });
  const p = a.monde.profil('dirigeante');
  assert.ok(p);
  const t = a.automatisations.ajouterTache(p, tache({ recette: 'relance-factures' }));
  a.automatisations.regler(p, { horizonAns: 2 });
  const etat = structuredClone(a.instantane());
  const relue = await Application.creer({ exemple: null, etat });
  const pr = relue.monde.profil('dirigeante');
  assert.ok(pr);
  const vue = relue.automatisations.taches(pr);
  assert.equal(vue.horizonAns, 2);
  assert.deepEqual(vue.taches.map((x) => [x.id, x.nom, x.recette, x.creeLe]), [[t.id, 'Relancer les factures', 'relance-factures', t.creeLe]]);

  // enregistrement abîmé : seules les déclarations lisibles sont gardées (une seule fois chacune)
  const abime = structuredClone(etat);
  const bonne = abime.automatisations.taches?.[0];
  assert.ok(bonne);
  (abime.automatisations as { taches: unknown }).taches = [bonne, { ...bonne }, { ...bonne, id: 'pas-un-identifiant' }, { ...bonne, id: '00000000-0000-4000-8000-000000000001', fois: -3 },
    { ...bonne, id: '00000000-0000-4000-8000-000000000002', recette: 'automatisation-disparue' }, null, 'texte', { ...bonne, id: '00000000-0000-4000-8000-000000000003', nom: 'Autre tâche', creeLe: 'jamais' }];
  (abime.automatisations as { horizonAns: unknown }).horizonAns = 40;
  const reprise = await Application.creer({ exemple: null, etat: abime });
  const pa = reprise.monde.profil('dirigeante');
  assert.ok(pa);
  const reprises = reprise.automatisations.taches(pa);
  assert.deepEqual(reprises.taches.map((x) => x.nom).sort(), ['Autre tâche', 'Relancer les factures']);
  assert.equal(reprises.horizonAns, 5);
  assert.ok(!Number.isNaN(Date.parse(reprises.taches.find((x) => x.nom === 'Autre tâche')?.creeLe ?? '')), 'date illisible remplacée');

  // enregistrement d'avant cette fonction : ni tâches ni durée
  const ancien = structuredClone(etat);
  delete ancien.automatisations.taches;
  delete ancien.automatisations.horizonAns;
  const vieille = await Application.creer({ exemple: null, etat: ancien });
  const pv = vieille.monde.profil('dirigeante');
  assert.ok(pv);
  assert.deepEqual([vieille.automatisations.taches(pv).taches.length, vieille.automatisations.taches(pv).horizonAns], [0, 5]);

  // plus de 100 déclarations dans un fichier : 100 gardées
  const plein = structuredClone(etat);
  plein.automatisations.taches = Array.from({ length: TACHES_MAX + 20 }, (_, i) => ({ ...bonne, id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
  const pleine = await Application.creer({ exemple: null, etat: plein });
  assert.equal(pleine.instantane().automatisations.taches?.length, TACHES_MAX);
});

async function monter() {
  const s = sorties();
  const app = await Application.creer({ fetch: s.f });
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  const session = async (profilId: string) => {
    const r = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId }) });
    const cookie = (r.headers.get('set-cookie') ?? '').split(';')[0] as string;
    return async (m: string, chemin: string, corps?: unknown) => {
      const x = await fetch(`${base}/api/v1${chemin}`, { method: m, headers: { cookie, 'content-type': 'application/json', 'x-lb-requete': '1' }, body: corps === undefined ? null : JSON.stringify(corps) });
      return { statut: x.status, json: await x.json().catch(() => null) as any };
    };
  };
  const ecran = await session('dirigeante');
  const k = (await ecran('POST', '/cles', { nom: 'Outil', profilId: 'dirigeante' })).json as { jeton: string };
  const parCle = async (m: string, chemin: string, corps?: unknown) => {
    const x = await fetch(`${base}/api/v1${chemin}`, { method: m, headers: { authorization: `Bearer ${k.jeton}`, 'content-type': 'application/json' }, body: corps === undefined ? null : JSON.stringify(corps) });
    return { statut: x.status, json: await x.json().catch(() => null) as any };
  };
  return { app, s, ecran, session, parCle, fermer: () => { serveur.close(); app.arreter(); } };
}

test('API : lister, estimer, ajouter, modifier, supprimer à l’écran ; une clé d’API lit mais ne change rien', async () => {
  const t = await monter();
  try {
    const vide = await t.ecran('GET', '/automatisations/taches');
    assert.equal(vide.statut, 200);
    assert.deepEqual(vide.json.taches, []);
    assert.ok(vide.json.idees.length >= 6);

    const essai = await t.ecran('POST', '/automatisations/taches/estimation', tache());
    assert.equal(essai.statut, 200);
    assert.equal(essai.json.calcul.verdict, 'a_automatiser');
    assert.equal(essai.json.id, undefined);

    const cree = await t.ecran('POST', '/automatisations/taches', tache({ recette: 'relance-factures' }));
    assert.equal(cree.statut, 200, 'la route d’ajout n’est pas prise pour la mise en marche d’une automatisation');
    assert.equal(cree.json.automatisation.id, 'relance-factures');
    const id = cree.json.id as string;
    const modif = await t.ecran('PUT', `/automatisations/taches/${id}`, tache({ nom: 'Relancer les impayés' }));
    assert.deepEqual([modif.statut, modif.json.nom, modif.json.recette], [200, 'Relancer les impayés', null]);

    const refus = await t.ecran('POST', '/automatisations/taches', tache({ nom: '' }));
    assert.deepEqual([refus.statut, refus.json.erreur], [400, 'tache_invalide']);
    assert.match(refus.json.message, /Donnez un nom/);
    // corps de plus de 8 ko : refusé avant d'être lu en entier (413, ou connexion coupée par le serveur)
    const lourd = await t.ecran('POST', '/automatisations/taches', tache({ nom: 'x'.repeat(9000) })).catch(() => null);
    assert.ok(lourd === null || lourd.statut === 413, `corps limité à 8 ko (${lourd?.statut})`);
    assert.equal((await t.ecran('GET', '/automatisations/taches')).json.taches.length, 1);
    assert.equal((await t.ecran('PUT', '/automatisations/taches/00000000-0000-4000-8000-000000000000', tache())).statut, 404);
    assert.equal((await t.ecran('DELETE', '/automatisations/taches/pas-un-identifiant')).statut, 404);
    assert.equal((await t.ecran('PUT', '/automatisations/reglages', { horizonAns: 3 })).json.horizonAns, 3);

    // une clé d'API au profil administrateur : lecture seule
    const lue = await t.parCle('GET', '/automatisations/taches');
    assert.equal(lue.statut, 200);
    assert.equal(lue.json.taches.length, 1);
    const interdites = [
      ['POST', '/automatisations/taches', tache({ nom: 'Par une clé' })],
      ['POST', '/automatisations/taches/estimation', tache()],
      ['PUT', `/automatisations/taches/${id}`, tache({ nom: 'Par une clé' })],
      ['DELETE', `/automatisations/taches/${id}`, undefined],
      ['PUT', '/automatisations/reglages', { horizonAns: 1 }],
    ] as const;
    for (const [m, c, corps] of interdites) {
      const r = await t.parCle(m, c, corps);
      assert.deepEqual([r.statut, r.json?.erreur], [403, 'session_requise'], `${m} ${c}`);
    }
    const apres = (await t.ecran('GET', '/automatisations/taches')).json;
    assert.deepEqual([apres.taches.length, apres.taches[0].nom, apres.horizonAns], [1, 'Relancer les impayés', 3], 'la clé n’a rien changé');

    // un profil sans droit d'administration ni d'approbation ne lit pas ; il n'écrit pas non plus
    const terrain = await t.session('terrain');
    assert.equal((await terrain('GET', '/automatisations/taches')).statut, 403);
    assert.equal((await terrain('POST', '/automatisations/taches', tache())).statut, 403);
    assert.equal((await terrain('DELETE', `/automatisations/taches/${id}`)).statut, 403);

    const suppr = await t.ecran('DELETE', `/automatisations/taches/${id}`);
    assert.deepEqual([suppr.statut, suppr.json.ok], [200, true]);
    assert.equal((await t.ecran('GET', '/automatisations/taches')).json.taches.length, 0);
    // la mise en marche d'une automatisation passe toujours par sa propre route
    assert.equal((await t.ecran('POST', '/automatisations/relance-factures', { actif: true })).json.active, true);
    assert.equal(t.s.appels.length, 0, 'rien n’est parti vers l’extérieur');
  } finally { t.fermer(); }
});
