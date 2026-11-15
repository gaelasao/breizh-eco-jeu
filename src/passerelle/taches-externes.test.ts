/**
 * Tâches (Google Tasks, Microsoft To Do) : `fetch` simulé, aucun appel réseau.
 * Pour chacun : listes du compte, lecture, écriture, anti-boucle, droits refusés, outil fermé chez le relais.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  avecTerminees, corpsGoogle, corpsMicrosoft, ficheGoogle, ficheMicrosoft, jourSortant, jourTache, tachesgoogle, tachesmicrosoft,
} from './sources-taches.ts';
import { ADAPTATEURS } from './sources.ts';
import { enveloppe, FOURNISSEUR_DE, lireEnveloppe, NOM_FOURNISSEUR } from './oauth-relais.ts';
import { LIBELLES_CHOIX } from './synchro.ts';
import { TEMPS_REEL_DE } from './temps-reel.ts';
import { Application } from './application.ts';

interface Appel { url: URL; methode: string; entetes: Headers; corps: any }

/** `fetch` simulé : note chaque appel et laisse l'essai répondre. Aucun réseau n'est touché. */
function simuler(repondre: (a: Appel, n: number) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const brut = init?.body ? String(init.body) : '';
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: brut ? JSON.parse(brut) : null };
    appels.push(a);
    return repondre(a, appels.length - 1);
  }) as typeof fetch;
  return { f, appels };
}
const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
const JETON = 'jeton-de-la-personne-connectee';

// ---------------------------------------------------------------- catalogue et portées

test('catalogue : les deux listes de tâches sont branchées, en français, sans aucune clé à coller', () => {
  for (const [id, a] of [['tachesgoogle', tachesgoogle], ['tachesmicrosoft', tachesmicrosoft]] as const) {
    assert.equal(ADAPTATEURS[id], a, `${id} : au catalogue`);
    assert.equal(a.lecture, 'appel');
    assert.equal(a.ecriture, true);
    assert.equal(a.categorie, 'Tâches');
    assert.ok(a.etapes.length === 3 && a.etapes.every((e) => e.length > 20), `${id} : trois étapes dites en entier`);
    // un seul secret, et il ne vient que de « Se connecter avec… » : rien à créer ni à coller soi-même
    const secrets = a.champs.filter((c) => c.secret);
    assert.equal(secrets.length, 1, `${id} : un seul secret`);
    assert.equal(secrets[0]?.mode, 'oauth', `${id} : aucune clé à coller`);
    assert.doesNotMatch(`${a.description} ${a.etapes.join(' ')}`, /\b(scope|token|API|OAuth|webhook)\b/, `${id} : pas de jargon`);
    // les deux réglages demandés après la connexion, et pas un de plus : quelle liste, et les tâches terminées
    assert.deepEqual(a.champs.map((c) => c.id), ['liste', 'terminees', 'jeton'], `${id} : trois clics au plus`);
  }
  // chaque outil a SA portée : brancher une feuille ou un agenda ne demande jamais les tâches
  assert.deepEqual((['sheets', 'agendagoogle', 'tachesgoogle', 'excel365', 'agendamicrosoft', 'tachesmicrosoft'] as const).map((s) => FOURNISSEUR_DE[s]),
    ['google', 'googleagenda', 'googletaches', 'microsoft', 'microsoftagenda', 'microsofttaches']);
  // le bouton dit le nom du compte, jamais celui du produit
  assert.equal(NOM_FOURNISSEUR.googletaches, 'Google');
  assert.equal(NOM_FOURNISSEUR.microsofttaches, 'Microsoft');
  // les valeurs techniques du choix sont dites en français à l'écran
  assert.equal(LIBELLES_CHOIX.aFaire, 'Seulement ce qu’il reste à faire');
  assert.equal(LIBELLES_CHOIX.tout, 'Aussi les tâches déjà terminées');
  // pas de temps réel : ni Google ni Microsoft ne préviennent des changements d'une liste de tâches
  assert.equal(TEMPS_REEL_DE.tachesgoogle, undefined);
  assert.equal(TEMPS_REEL_DE.tachesmicrosoft, undefined);
});

test('relais fermé chez l’éditeur : les tâches n’apparaissent nulle part dans le jeu', async () => {
  const app = await Application.creer({ exemple: 'pme', fetch: (async () => { throw new Error('aucun appel réseau attendu'); }) as typeof fetch });
  const cat = await app.synchro.catalogue();
  for (const id of ['tachesgoogle', 'tachesmicrosoft']) {
    const s = cat.find((x) => x.id === id);
    assert.ok(s, `${id} : décrit au catalogue`);
    assert.equal(s.oauth, null, `${id} : non ouvert`);
    assert.equal(s.oauthPossible, true, `${id} : « Se connecter avec… » est bien sa seule voie`);
    assert.equal(s.champs.some((c) => c.secret && c.mode !== 'oauth'), false, `${id} : aucune clé de repli`);
  }
});

// ---------------------------------------------------------------- Google Tasks

test('Google Tasks : les listes du compte, puis la lecture de celle qu’on a choisie', async () => {
  const { f, appels } = simuler((a) => {
    if (a.url.pathname.endsWith('/users/@me/lists')) {
      return json({ items: [{ id: 'LST1', title: 'Mes tâches' }, { id: 'LST2', title: 'Chantier Lorient' }] });
    }
    return json({ items: [
      { id: 'TA1', title: 'Relancer le devis', due: '2026-11-20T00:00:00.000Z', status: 'needsAction', webViewLink: 'https://tasks.google.com/task/TA1' },
      { id: 'TA2', title: 'Commander le bardage', status: 'completed', due: '2026-11-10T00:00:00.000Z' },
      { id: 'TA3', title: 'Effacée', status: 'needsAction', deleted: true },
    ] });
  });
  const choix = await tachesgoogle.choix?.('liste', {}, JETON, f);
  assert.deepEqual(choix?.map((c) => [c.valeur, c.libelle]), [['LST1', 'Mes tâches'], ['LST2', 'Chantier Lorient']]);

  const lues = await tachesgoogle.lire({ liste: 'LST2', terminees: 'aFaire' }, JETON, f);
  const lecture = appels.at(-1) as Appel;
  assert.equal(lecture.url.origin, 'https://tasks.googleapis.com');
  assert.equal(lecture.url.pathname, '/tasks/v1/lists/LST2/tasks');
  assert.equal(lecture.url.searchParams.get('showCompleted'), 'false');
  assert.equal(lecture.url.searchParams.get('showDeleted'), 'false');
  assert.equal(lecture.entetes.get('authorization'), `Bearer ${JETON}`);
  // les notes d'une tâche ne sont même pas demandées
  assert.equal(lecture.url.searchParams.get('fields')?.includes('notes'), false, 'les notes restent chez Google');
  for (const a of appels) assert.equal(a.url.href.includes(JETON), false, 'jamais de jeton dans une adresse');

  // une tâche effacée n'entre pas ; l'échéance est ramenée au jour
  assert.deepEqual(lues.map((e) => e.externeId), ['TA1', 'TA2']);
  assert.deepEqual(lues[0]?.champs, {
    titre: 'Relancer le devis', echeance: '2026-11-20', statut: 'à faire', lien: 'https://tasks.google.com/task/TA1',
  });
  assert.equal(lues[1]?.champs.statut, 'terminée');
  assert.equal(lues[1]?.champs.lien, '', 'sans adresse chez l’outil, pas de bouton « Ouvrir dans… »');

  // « aussi les tâches terminées » : Google cache celles cochées dans ses propres applications sans showHidden
  const { f: f2, appels: a2 } = simuler(() => json({ items: [] }));
  await tachesgoogle.lire({ liste: 'LST2', terminees: 'tout' }, JETON, f2);
  assert.equal((a2[0] as Appel).url.searchParams.get('showCompleted'), 'true');
  assert.equal((a2[0] as Appel).url.searchParams.get('showHidden'), 'true');
});

test('Google Tasks : une tâche créée ici part dans la liste choisie, puis est modifiée sans doublon', async () => {
  const { f, appels } = simuler((a) => (a.methode === 'POST' ? json({ id: 'TANEUF' }) : json({})));
  const cree = await tachesgoogle.ecrire?.({ liste: 'LST2', terminees: 'aFaire' }, JETON, null,
    { titre: 'Relancer Kerlann', echeance: '2026-12-02', statut: 'à faire' }, f);
  assert.equal(cree, 'TANEUF');
  const envoi = appels[0] as Appel;
  assert.equal(envoi.methode, 'POST');
  assert.equal(envoi.url.pathname, '/tasks/v1/lists/LST2/tasks');
  assert.equal(envoi.corps.title, 'Relancer Kerlann');
  // Google ne garde que le jour d'une échéance : minuit UTC le dit sans ambiguïté de fuseau
  assert.equal(envoi.corps.due, '2026-12-02T00:00:00.000Z');
  assert.equal(envoi.corps.status, 'needsAction');
  assert.equal('notes' in envoi.corps, false, 'le jeu n’écrit jamais de note chez l’outil');

  await tachesgoogle.ecrire?.({ liste: 'LST2' }, JETON, 'TANEUF', { titre: 'Relancer Kerlann', statut: 'terminée' }, f);
  assert.equal((appels[1] as Appel).methode, 'PATCH', 'une tâche déjà liée est modifiée, jamais recréée');
  assert.equal((appels[1] as Appel).url.pathname, '/tasks/v1/lists/LST2/tasks/TANEUF');
  assert.equal((appels[1] as Appel).corps.status, 'completed');
  // identifiant qui n'est pas de la forme attendue : refusé avant tout appel
  await assert.rejects(tachesgoogle.ecrire?.({ liste: 'LST2' }, JETON, '../autre', { titre: 'x' }, f) as Promise<unknown>, /invalide/);
  await assert.rejects(tachesgoogle.lire({ liste: '../../autre' }, JETON, f), /Choisissez la liste/);
});

// ---------------------------------------------------------------- Microsoft To Do

test('Microsoft To Do : les listes du compte, puis les tâches de celle qu’on a choisie', async () => {
  const { f, appels } = simuler((a) => {
    if (a.url.pathname.endsWith('/me/todo/lists')) {
      return json({ value: [{ id: 'AAA=', displayName: 'Tâches', wellknownListName: 'defaultList' }, { id: 'BBB=', displayName: 'Chantier', wellknownListName: 'none' }] });
    }
    return json({ value: [
      { id: 'MT1', title: 'Appeler le couvreur', status: 'inProgress', dueDateTime: { dateTime: '2026-11-20T00:00:00.0000000', timeZone: 'UTC' } },
      { id: 'MT2', title: 'Commander le bardage', status: 'completed', dueDateTime: { dateTime: '2026-11-10T00:00:00.0000000', timeZone: 'UTC' } },
      { id: 'MT3', title: 'Attendre le devis', status: 'waitingOnOthers' },
    ] });
  });
  const choix = await tachesmicrosoft.choix?.('liste', {}, JETON, f);
  assert.deepEqual(choix?.map((c) => c.libelle), ['Tâches (votre liste principale)', 'Chantier']);

  const lues = await tachesmicrosoft.lire({ liste: 'BBB=', terminees: 'aFaire' }, JETON, f);
  const lecture = appels.at(-1) as Appel;
  assert.equal(lecture.url.pathname, '/v1.0/me/todo/lists/BBB%3D/tasks');
  const select = lecture.url.searchParams.get('$select') ?? '';
  assert.equal(select.includes('body'), false, 'le texte d’une tâche n’est jamais demandé à Microsoft');
  assert.equal(lecture.entetes.get('authorization'), `Bearer ${JETON}`);
  // les cinq états de Microsoft ramenés aux quatre du jeu ; une tâche terminée n'entre pas dans ce réglage
  assert.deepEqual(lues.map((e) => [e.externeId, e.champs.statut]), [['MT1', 'en cours'], ['MT3', 'bloquée']]);
  assert.equal(lues[0]?.champs.echeance, '2026-11-20');
  assert.equal(lues[0]?.champs.lien, '', 'Microsoft ne publie aucune adresse web pour une tâche');
  assert.equal(lues[1]?.champs.echeance, '', 'sans échéance, le jeu n’en invente pas');

  const { f: f2 } = simuler(() => json({ value: [{ id: 'MT2', title: 'Faite', status: 'completed' }] }));
  const tout = await tachesmicrosoft.lire({ liste: 'BBB=', terminees: 'tout' }, JETON, f2);
  assert.deepEqual(tout.map((e) => e.champs.statut), ['terminée']);
});

test('Microsoft To Do : création puis modification, et une échéance qui ne glisse pas d’un jour', async () => {
  const { f, appels } = simuler((a) => (a.methode === 'POST' ? json({ id: 'MTNEUF' }) : json({})));
  const cree = await tachesmicrosoft.ecrire?.({ liste: 'BBB=' }, JETON, null, { titre: 'Visite de chantier', echeance: '2026-12-02', statut: 'bloquée' }, f);
  assert.equal(cree, 'MTNEUF');
  const envoi = appels[0] as Appel;
  assert.equal(envoi.url.pathname, '/v1.0/me/todo/lists/BBB%3D/tasks');
  assert.deepEqual(envoi.corps.dueDateTime, { dateTime: '2026-12-02T00:00:00', timeZone: 'UTC' });
  assert.equal(envoi.corps.status, 'waitingOnOthers', '« bloquée » : le plus proche chez Microsoft');
  assert.equal('body' in envoi.corps, false);

  await tachesmicrosoft.ecrire?.({ liste: 'BBB=' }, JETON, 'MTNEUF', { titre: 'Visite de chantier', statut: 'terminée' }, f);
  assert.equal((appels[1] as Appel).methode, 'PATCH');
  assert.equal((appels[1] as Appel).url.pathname, '/v1.0/me/todo/lists/BBB%3D/tasks/MTNEUF');
  assert.equal((appels[1] as Appel).corps.status, 'completed');
  await assert.rejects(tachesmicrosoft.ecrire?.({ liste: 'BBB=' }, JETON, 'ailleurs?/..', { titre: 'x' }, f) as Promise<unknown>, /invalide/);
});

// ---------------------------------------------------------------- lecture des dates et des réglages

test('échéances, statuts et réglages : ce qui est lisible l’est, le reste ne casse rien', () => {
  assert.equal(jourTache('2026-11-20T00:00:00.000Z'), '2026-11-20');
  assert.equal(jourTache('2026-11-20'), '2026-11-20');
  assert.equal(jourTache('pas une date'), '', 'le jeu n’invente jamais une date');
  assert.equal(jourTache(42), '');
  assert.equal(jourSortant('2026-11-20T09:30'), '2026-11-20', 'une tâche n’a pas d’heure : seul le jour part');
  assert.equal(jourSortant(''), null);
  assert.equal(jourSortant('n’importe quoi'), null);
  assert.equal(avecTerminees({ terminees: 'tout' }), true);
  assert.equal(avecTerminees({}), false, 'par défaut : seulement ce qu’il reste à faire');
  assert.equal(ficheGoogle({ id: 'x', status: 'needsAction' })?.champs.echeance, '', 'une tâche sans échéance entre quand même');
  assert.equal(ficheGoogle({ title: 'sans identifiant' }), null);
  assert.equal(ficheMicrosoft(null), null);
  assert.equal(ficheMicrosoft({ id: 'MT9', status: 'inconnu' })?.champs.statut, 'à faire', 'un état inconnu ne bloque rien');
  // vider une échéance dans le jeu la vide chez l'outil ; ne pas y toucher ne l'envoie pas
  assert.equal(corpsGoogle({ titre: 'x', echeance: '' }).due, null);
  assert.equal('due' in corpsGoogle({ titre: 'x' }), false);
  assert.equal(corpsMicrosoft({ titre: 'x', echeance: null }).dueDateTime, null);
  assert.equal('status' in corpsMicrosoft({ titre: 'x' }), false);
});

// ---------------------------------------------------------------- anti-boucle et droits refusés, par la vraie synchro

/** Une liste de tâches simulée qui garde ses tâches : on peut y lire, y écrire, et compter les appels. */
function listeSimulee() {
  const taches = new Map<string, { id: string; title: string; status: string }>();
  taches.set('TA1', { id: 'TA1', title: 'Relancer le devis', status: 'needsAction' });
  const compte = { lectures: 0, ecritures: 0 };
  const f = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    const methode = init?.method ?? 'GET';
    if (u.pathname.endsWith('/users/@me/lists')) return json({ items: [{ id: 'LST1', title: 'Mes tâches' }] });
    if (u.pathname.endsWith('/tasks') && methode === 'GET') { compte.lectures++; return json({ items: [...taches.values()] }); }
    if (methode === 'POST') { compte.ecritures++; const id = `TA${taches.size + 1}`; taches.set(id, { ...(JSON.parse(String(init?.body)) as any), id }); return json({ id }); }
    if (methode === 'PATCH') { compte.ecritures++; return json({ id: u.pathname.split('/').pop() }); }
    return json({});
  }) as typeof fetch;
  return { f, compte, taches };
}

test('anti-boucle : ce qui vient de la liste n’y retourne pas ; ce que le jeu change, si', async () => {
  const { f, compte } = listeSimulee();
  const app = await Application.creer({ exemple: 'pme', fetch: f });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  const c = app.synchro.creer(p, {
    source: 'tachesgoogle', config: { liste: 'LST1', terminees: 'aFaire', jeton: JETON }, typeObjet: 'tache', roles: [],
    mapping: { titre: '__nom', echeance: 'echeance', statut: 'statut', lien: 'lien' },
    sens: 'deux', intervalleS: 300, actif: true,
  });
  await app.synchro.synchroniser(c.id);
  assert.equal(compte.lectures, 1);
  // la tâche lue est entrée dans le jeu, et n'est PAS repartie chez Google : son empreinte n'a pas changé
  assert.equal(compte.ecritures, 0, 'rien n’est renvoyé à la liste après une simple lecture');
  const entree = app.monde.objetsReels().find((o) => o.type === 'tache' && o.nom === 'Relancer le devis');
  assert.ok(entree, 'la tâche de la liste est dans le jeu');
  // une deuxième synchronisation, rien n'ayant bougé : toujours aucune écriture
  await app.synchro.synchroniser(c.id);
  assert.equal(compte.ecritures, 0, 'relire ne déclenche pas d’écriture : pas de boucle');
  // la personne termine la tâche DANS LE JEU : là, elle repart
  await app.monde.preparerAction(p, 'reel', { cle: 'cle-taches-000001', cible: entree.id, capacite: 'objet.modifier', parametres: { champs: { statut: 'terminée' } }, executer: true });
  await app.synchro.synchroniser(c.id);
  assert.equal(compte.ecritures, 1, 'un changement fait ici repart une fois, et une seule');
  await app.synchro.synchroniser(c.id);
  assert.equal(compte.ecritures, 1);
});

test('droits refusés : connexion absente, ou refusée par l’outil — la personne lit une phrase utilisable', async () => {
  // aucune connexion : l'adaptateur le dit, et ne tente aucun appel
  const jamais = (async () => { throw new Error('aucun appel attendu'); }) as typeof fetch;
  await assert.rejects(tachesgoogle.lire({ liste: 'LST1' }, null, jamais), /Connexion Google manquante/);
  await assert.rejects(tachesmicrosoft.lire({ liste: 'AAA=' }, null, jamais), /Connexion Microsoft manquante/);

  // l'outil refuse (droit non accordé, jeton révoqué) : message lisible, jamais une trace technique
  const { f } = simuler(() => json({ error: { code: 403, message: 'insufficient permission' } }, 403));
  await assert.rejects(tachesgoogle.lire({ liste: 'LST1' }, JETON, f), /Accès refusé/);
  await assert.rejects(tachesmicrosoft.ecrire?.({ liste: 'AAA=' }, JETON, 'MT1', { statut: 'terminée' }, f) as Promise<unknown>, /Accès refusé/);

  // le droit accordé à la connexion voyage avec elle : c'est lui que la synchro relit avant d'autoriser une écriture
  const lectureSeule = enveloppe({ fournisseur: 'googletaches', acces: 'jeton-lecture', rafraichissement: null, expire: null, extra: {}, droits: 'lecture' });
  assert.equal(lireEnveloppe(lectureSeule)?.droits, 'lecture');
  assert.equal(lireEnveloppe(enveloppe({ fournisseur: 'microsofttaches', acces: 'j', rafraichissement: null, expire: null, extra: {}, droits: 'ecriture' }))?.droits, 'ecriture');
});

// ---------------------------------------------------------------- de bout en bout : la tâche entre dans l'écran Tâches

test('de bout en bout : une tâche branchée est une tâche du jeu, avec son lien vers l’outil', async () => {
  const app = await Application.creer({ exemple: 'pme', fetch: (async () => { throw new Error('aucun appel réseau attendu'); }) as typeof fetch });
  const tache = app.monde.univers.types.find((t) => t.id === 'tache');
  assert.ok(tache, 'le type « tâche » existe');
  assert.equal(tache.famille, 'tache');
  // les champs que les deux outils remplissent portent déjà les noms du jeu : rien à associer
  for (const champ of ['echeance', 'statut', 'lien']) assert.ok(tache.champs.some((c) => c.id === champ), `le type « tâche » a « ${champ} »`);
  const statut = tache.champs.find((c) => c.id === 'statut');
  assert.deepEqual(statut?.choix, ['à faire', 'en cours', 'bloquée', 'terminée']);
  // les états rendus par les deux adaptateurs sont tous dans cette liste : jamais une valeur hors choix
  const rendus = new Set([
    ficheGoogle({ id: 'a', status: 'needsAction' })?.champs.statut, ficheGoogle({ id: 'b', status: 'completed' })?.champs.statut,
    ...['notStarted', 'inProgress', 'completed', 'waitingOnOthers', 'deferred'].map((s) => ficheMicrosoft({ id: 'c', status: s })?.champs.statut),
  ]);
  for (const s of rendus) assert.ok(statut?.choix?.includes(s as string), `« ${s} » est l’un des états du jeu`);
});
