/**
 * Agenda (Google, Microsoft) et courrier (Gmail, Outlook) : `fetch` simulé, aucun appel réseau.
 * Pour chacun : lecture, écriture, anti-boucle, temps réel, portée fermée, droits refusés, message rattaché à un client.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agendagoogle, agendamicrosoft, bornes, corpsGoogle, corpsMicrosoft, dateJeu, ficheMicrosoft, fichierGoogle, joursPeriode, pageSuivante } from './sources-agenda.ts';
import { combien, enteteGmail, ficheCourrier, gmail, lienGmail, nomExpediteur, outlook } from './sources-courrier.ts';
import { bacDe, urgenceDe } from './tri-courrier.ts';
import { ADAPTATEURS } from './sources.ts';
import { FOURNISSEUR_DE, NOM_FOURNISSEUR } from './oauth-relais.ts';
import { OUTILS_TEMPS_REEL, suiviDe, TEMPS_REEL_DE } from './temps-reel.ts';
import { Application } from './application.ts';

interface Appel { url: URL; methode: string; entetes: Headers; corps: any; brut: string }

/** `fetch` simulé : note chaque appel et laisse le test répondre. Aucun réseau n'est touché. */
function simuler(repondre: (a: Appel, n: number) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const entetes = new Headers(init?.headers);
    const brut = init?.body ? String(init.body) : '';
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes, corps: brut ? JSON.parse(brut) : null, brut };
    appels.push(a);
    return repondre(a, appels.length - 1);
  }) as typeof fetch;
  return { f, appels };
}
const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
const JETON = 'jeton-de-la-personne-connectee';
const aucunJetonDansUrl = (appels: Appel[]) => { for (const a of appels) assert.equal(a.url.href.includes(JETON), false, `jeton dans l’adresse : ${a.url.href}`); };

// ---------------------------------------------------------------- catalogue et portées

test('catalogue : agenda et courrier sont branchés, en français, sans aucune clé à coller', () => {
  for (const [id, a] of [['agendagoogle', agendagoogle], ['agendamicrosoft', agendamicrosoft], ['gmail', gmail], ['outlook', outlook]] as const) {
    assert.equal(ADAPTATEURS[id], a, `${id} : au catalogue`);
    assert.equal(a.lecture, 'appel');
    assert.equal(a.ecriture, true);
    assert.ok(a.etapes.length === 3 && a.etapes.every((e) => e.length > 20), `${id} : trois étapes dites en entier`);
    assert.equal(a.champs.filter((c) => c.secret).length, 0, `${id} : aucune clé à créer ni à coller`);
    assert.doesNotMatch(`${a.description} ${a.etapes.join(' ')}`, /\b(scope|token|API|OAuth|webhook)\b/, `${id} : pas de jargon`);
  }
  // chaque outil a SA portée : brancher une feuille ne demande jamais l'agenda, ni l'agenda le courrier
  assert.deepEqual(
    (['sheets', 'agendagoogle', 'gmail', 'excel365', 'agendamicrosoft', 'outlook'] as const).map((s) => FOURNISSEUR_DE[s]),
    ['google', 'googleagenda', 'googlecourrier', 'microsoft', 'microsoftagenda', 'microsoftcourrier'],
  );
  // le bouton dit le nom du compte, jamais celui de la portée
  assert.equal(NOM_FOURNISSEUR.googleagenda, 'Google');
  assert.equal(NOM_FOURNISSEUR.microsoftcourrier, 'Microsoft');
});

test('portée fermée chez l’éditeur : l’outil n’apparaît nulle part dans le jeu', async () => {
  const app = await Application.creer({ exemple: 'pme', fetch: (async () => { throw new Error('aucun appel réseau attendu'); }) as typeof fetch });
  const cat = await app.synchro.catalogue();
  // sans relais réglé, aucun de ces outils n'est ouvert : `oauth` est null, et il n'y a pas de clé de repli
  for (const id of ['agendagoogle', 'gmail', 'agendamicrosoft', 'outlook']) {
    const s = cat.find((x) => x.id === id);
    assert.ok(s, `${id} : décrit au catalogue`);
    assert.equal(s.oauth, null, `${id} : non ouvert`);
    assert.equal(s.oauthPossible, true, `${id} : « Se connecter avec… » est bien sa seule voie`);
    assert.equal(s.champs.some((c) => c.secret && c.mode !== 'oauth'), false, `${id} : aucune clé de repli`);
  }
});

// ---------------------------------------------------------------- agenda Google

test('Google Agenda : la liste des agendas, puis la lecture de celui qu’on a choisi', async () => {
  const { f, appels } = simuler((a) => {
    if (a.url.pathname.endsWith('/users/me/calendarList')) {
      return json({ items: [
        { id: 'moi@exemple.fr', summary: 'Mon agenda', primary: true, accessRole: 'owner' },
        { id: 'chantiers@exemple.fr', summary: 'Chantiers', accessRole: 'writer' },
        { id: 'libre@exemple.fr', summary: 'Occupations', accessRole: 'freeBusyReader' },
      ] });
    }
    return json({ items: [
      { id: 'abc12', summary: 'Visite de chantier', location: 'Lorient', status: 'confirmed', start: { dateTime: '2026-11-20T09:00:00+01:00' }, end: { dateTime: '2026-11-20T10:30:00+01:00' }, htmlLink: 'https://www.google.com/calendar/event?eid=abc12' },
      { id: 'def34', summary: 'Congés', status: 'confirmed', start: { date: '2026-11-25' }, end: { date: '2026-11-26' } },
      { id: 'ghi56', summary: 'Annulé', status: 'cancelled', start: { dateTime: '2026-11-21T09:00:00+01:00' }, end: { dateTime: '2026-11-21T10:00:00+01:00' } },
    ] });
  });
  const choix = await agendagoogle.choix?.('agenda', {}, JETON, f);
  // un agenda où l'on ne voit que « occupé » n'a aucun titre à faire entrer : il n'est pas proposé
  assert.deepEqual(choix?.map((c) => c.valeur), ['moi@exemple.fr', 'chantiers@exemple.fr']);
  assert.equal(choix?.[0]?.libelle, 'Mon agenda (votre agenda principal)');

  const lues = await agendagoogle.lire({ agenda: 'chantiers@exemple.fr', periode: 'periode90' }, JETON, f);
  const lecture = appels.at(-1) as Appel;
  assert.equal(lecture.url.pathname, '/calendar/v3/calendars/chantiers%40exemple.fr/events');
  assert.equal(lecture.url.searchParams.get('singleEvents'), 'true', 'les séries répétées sont développées, une date par rendez-vous');
  assert.equal(lecture.url.searchParams.get('orderBy'), 'startTime');
  assert.equal(lecture.entetes.get('authorization'), `Bearer ${JETON}`);
  aucunJetonDansUrl(appels);
  // un rendez-vous annulé n'entre pas ; une journée entière garde sa date nue
  assert.deepEqual(lues.map((e) => e.externeId), ['abc12', 'def34']);
  assert.equal(lues[0]?.champs.titre, 'Visite de chantier');
  assert.equal(lues[0]?.champs.lieu, 'Lorient');
  assert.match(lues[0]?.champs.debut ?? '', /^2026-11-20T\d{2}:\d{2}$/);
  assert.equal(lues[0]?.champs.lien, 'https://www.google.com/calendar/event?eid=abc12');
  assert.equal(lues[1]?.champs.debut, '2026-11-25');
});

test('Google Agenda : un rendez-vous créé dans le jeu part dans l’agenda choisi, puis est modifié sans doublon', async () => {
  const { f, appels } = simuler((a) => (a.methode === 'POST' ? json({ id: 'nouveau1' }) : json({})));
  const cree = await agendagoogle.ecrire?.({ agenda: 'primary', periode: 'periode90' }, JETON, null,
    { titre: 'Devis chez Kerlann', debut: '2026-12-02T14:30', fin: '2026-12-02T15:30', lieu: 'Quimper', etat: 'à confirmer' }, f);
  assert.equal(cree, 'nouveau1');
  const envoi = appels[0] as Appel;
  assert.equal(envoi.methode, 'POST');
  assert.equal(envoi.corps.summary, 'Devis chez Kerlann');
  assert.equal(envoi.corps.location, 'Quimper');
  assert.equal(envoi.corps.status, 'tentative');
  assert.equal(envoi.corps.start.dateTime, '2026-12-02T14:30:00');
  assert.ok(envoi.corps.start.timeZone, 'le fuseau de l’entreprise accompagne l’heure');

  await agendagoogle.ecrire?.({ agenda: 'primary' }, JETON, 'nouveau1', { titre: 'Devis chez Kerlann (reporté)', debut: '2026-12-03T14:30' }, f);
  assert.equal((appels[1] as Appel).methode, 'PATCH', 'un rendez-vous déjà lié est modifié, jamais recréé');
  assert.equal((appels[1] as Appel).url.pathname, '/calendar/v3/calendars/primary/events/nouveau1');
  // identifiant qui n'est pas de la forme de Google : refusé avant tout appel
  await assert.rejects(agendagoogle.ecrire?.({ agenda: 'primary' }, JETON, '../autre', { debut: '2026-12-03T14:30' }, f) as Promise<unknown>, /invalide/);
});

// ---------------------------------------------------------------- agenda Microsoft

test('Microsoft : les agendas du compte, puis la période lue par calendarView', async () => {
  const { f, appels } = simuler((a) => {
    if (a.url.pathname.endsWith('/me/calendars')) return json({ value: [{ id: 'AAA=', name: 'Calendrier', isDefaultCalendar: true }, { id: 'BBB=', name: 'Interventions' }] });
    return json({ value: [
      { id: 'EV1', subject: 'Entretien annuel', start: { dateTime: '2026-11-20T09:00:00.0000000', timeZone: 'Europe/Paris' }, end: { dateTime: '2026-11-20T10:00:00.0000000' }, location: { displayName: 'Siège' }, isAllDay: false, showAs: 'busy', isCancelled: false, webLink: 'https://outlook.office365.com/calendar/item/EV1' },
      { id: 'EV2', subject: 'Reporté', isCancelled: true, start: { dateTime: '2026-11-21T09:00:00' }, end: { dateTime: '2026-11-21T10:00:00' } },
    ] });
  });
  const choix = await agendamicrosoft.choix?.('agenda', {}, JETON, f);
  assert.deepEqual(choix?.map((c) => c.libelle), ['Calendrier (votre agenda principal)', 'Interventions']);

  const lues = await agendamicrosoft.lire({ agenda: 'BBB=', periode: 'periode30' }, JETON, f);
  const lecture = appels.at(-1) as Appel;
  assert.match(lecture.url.pathname, /\/me\/calendars\/BBB%3D\/calendarView$/, 'calendarView : les séries répétées sont développées');
  assert.ok(lecture.url.searchParams.get('startDateTime') && lecture.url.searchParams.get('endDateTime'));
  assert.match(lecture.entetes.get('prefer') ?? '', /^outlook\.timezone="/, 'sans cet en-tête, Microsoft rend tout en UTC');
  assert.equal(lecture.url.searchParams.get('$select')?.includes('body'), false, 'le texte des rendez-vous n’est pas demandé');
  assert.deepEqual(lues.map((e) => e.externeId), ['EV1']);
  assert.equal(lues[0]?.champs.lieu, 'Siège');
  assert.equal(lues[0]?.champs.lien, 'https://outlook.office365.com/calendar/item/EV1');

  const { f: f2, appels: a2 } = simuler(() => json({ id: 'EVNEUF' }));
  const cree = await agendamicrosoft.ecrire?.({ agenda: 'BBB=' }, JETON, null, { titre: 'Visite', debut: '2026-12-02', fin: '2026-12-02' }, f2);
  assert.equal(cree, 'EVNEUF');
  assert.equal((a2[0] as Appel).corps.isAllDay, true);
  assert.equal((a2[0] as Appel).corps.start.dateTime, '2026-12-02T00:00:00', 'une journée entière commence à minuit');
});

test('page suivante de Microsoft : seule une adresse chez Graph est suivie', () => {
  assert.equal(pageSuivante('https://graph.microsoft.com/v1.0/me/events?$skip=10')?.hostname, 'graph.microsoft.com');
  assert.equal(pageSuivante('https://ailleurs.example/vol'), null, 'le jeton ne part jamais ailleurs');
  assert.equal(pageSuivante('http://graph.microsoft.com/v1.0/me'), null);
  assert.equal(pageSuivante(42), null);
});

// ---------------------------------------------------------------- lecture des dates et des périodes

test('période choisie, dates ramenées à la minute, et bornes de lecture', () => {
  assert.equal(joursPeriode({ periode: 'periode90' }), 90);
  assert.equal(joursPeriode({ periode: 'periode365' }), 365);
  assert.equal(joursPeriode({}), 90, 'sans choix : 90 jours');
  assert.equal(joursPeriode({ periode: 'bidon' }), 90);
  const b = bornes({ periode: 'periode30' }, new Date('2026-11-13T12:00:00Z'));
  assert.equal(b.debut, '2026-10-14T12:00:00.000Z', 'les 30 derniers jours sont toujours lus');
  assert.equal(b.fin, '2026-12-13T12:00:00.000Z');
  assert.equal(dateJeu('2026-11-20', true), '2026-11-20');
  assert.equal(dateJeu('pas une date'), '', 'le jeu n’invente jamais une date');
  assert.equal(fichierGoogle({ id: 'x' }), null, 'un événement sans date ni forme connue n’entre pas');
  assert.equal(ficheMicrosoft(null), null);
  assert.throws(() => corpsGoogle({ titre: 'Sans date' }), /date de début/);
  assert.throws(() => corpsMicrosoft({ titre: 'Sans date' }), /date de début/);
});

// ---------------------------------------------------------------- courrier : le corps ne descend jamais

test('Gmail : lu en métadonnées seules — le texte des messages n’entre pas dans le jeu', async () => {
  const { f, appels } = simuler((a) => {
    if (a.url.pathname.endsWith('/messages')) return json({ messages: [{ id: 'aa11' }, { id: 'bb22' }] });
    const id = a.url.pathname.split('/').pop();
    return json({
      id, labelIds: id === 'aa11' ? ['INBOX', 'UNREAD'] : ['INBOX'], internalDate: '1763635200000',
      payload: { headers: [
        { name: 'From', value: id === 'aa11' ? 'Kerlann Bois <kerlann@exemple.fr>' : 'promo@exemple.fr' },
        { name: 'Subject', value: id === 'aa11' ? 'Relance facture 2026-114 : URGENT' : 'Notre newsletter du mois' },
        { name: 'Message-ID', value: '<msg-1@exemple.fr>' },
      ] },
    });
  });
  const lus = await gmail.lire({ combien: 'messages50' }, JETON, f);
  const liste = appels[0] as Appel;
  assert.equal(liste.url.searchParams.get('labelIds'), 'INBOX');
  assert.equal(liste.url.searchParams.get('q'), null, 'la portée de lecture seule de Google interdit le paramètre q');
  const detail = appels[1] as Appel;
  assert.equal(detail.url.searchParams.get('format'), 'metadata', 'Google ne renvoie alors ni corps ni pièce jointe');
  assert.deepEqual(detail.url.searchParams.getAll('metadataHeaders'), ['From', 'Subject', 'Date', 'Message-ID']);
  aucunJetonDansUrl(appels);

  assert.deepEqual(lus.map((e) => e.externeId), ['aa11', 'bb22']);
  assert.equal(lus[0]?.champs.expediteur, 'Kerlann Bois');
  assert.equal(lus[0]?.champs.resume, '', 'aucun résumé : le texte du message n’a jamais été lu');
  // trié par les mots-clés déjà en place, les mêmes que pour un mail collé à la main
  assert.equal(lus[0]?.champs.bac, 'paiements');
  assert.equal(lus[0]?.champs.urgence, 'haute');
  assert.equal(lus[0]?.champs.statut, 'à traiter');
  assert.equal(lus[1]?.champs.bac, 'publicité');
  assert.equal(lus[1]?.champs.urgence, 'basse');
  assert.equal(lus[1]?.champs.statut, 'traité', 'un message déjà lu chez Gmail n’est pas « à traiter »');
  assert.match(lus[0]?.champs.lien ?? '', /^https:\/\/mail\.google\.com\/mail\/u\/0\/#search\/rfc822msgid/);
});

test('Outlook : ni body ni bodyPreview ne sont demandés ; marquer comme lu, puis archiver', async () => {
  const { f, appels } = simuler(() => json({ value: [
    { id: 'MSG1', subject: 'Devis pour la véranda', from: { emailAddress: { name: 'Annaig Le Goff', address: 'annaig@exemple.fr' } }, receivedDateTime: '2026-11-12T08:30:00Z', isRead: false, webLink: 'https://outlook.office365.com/mail/id/MSG1' },
  ] }));
  const lus = await outlook.lire({ combien: 'messages25' }, JETON, f);
  const select = (appels[0] as Appel).url.searchParams.get('$select') ?? '';
  assert.equal(select.includes('body'), false, 'le texte des messages n’est jamais demandé à Microsoft');
  assert.equal(select.includes('bodyPreview'), false);
  assert.match((appels[0] as Appel).url.pathname, /mailFolders\('inbox'\)\/messages$/);
  assert.equal(lus[0]?.champs.expediteur, 'Annaig Le Goff');
  assert.equal(lus[0]?.champs.bac, 'clients');
  assert.equal(lus[0]?.champs.lien, 'https://outlook.office365.com/mail/id/MSG1');

  const { f: f2, appels: a2 } = simuler(() => json({ id: 'MSG1' }));
  await outlook.ecrire?.({ quandTraite: 'archiver' }, JETON, 'MSG1', { statut: 'traité' }, f2);
  assert.deepEqual(a2.map((a) => [a.methode, a.url.pathname.split('/').pop()]), [['PATCH', 'MSG1'], ['POST', 'move']]);
  assert.equal((a2[0] as Appel).corps.isRead, true);
  assert.equal((a2[1] as Appel).corps.destinationId, 'archive');
});

test('courrier : le jeu n’envoie ni ne supprime aucun message, et ne touche la boîte que si on le lui a demandé', async () => {
  const { f, appels } = simuler(() => json({}));
  // un courrier créé dans le jeu ne part PAS chez la messagerie : on n'écrit jamais de mail d'ici
  assert.equal(await gmail.ecrire?.({ quandTraite: 'archiver' }, JETON, null, { statut: 'traité' }, f), null);
  assert.equal(await outlook.ecrire?.({ quandTraite: 'archiver' }, JETON, null, { statut: 'traité' }, f), null);
  // un courrier encore « à traiter » ne déclenche rien non plus
  await gmail.ecrire?.({ quandTraite: 'archiver' }, JETON, 'aa11', { statut: 'à traiter' }, f);
  // « ne rien faire dans la boîte » : la messagerie n'est pas touchée du tout
  await gmail.ecrire?.({ quandTraite: 'rien' }, JETON, 'aa11', { statut: 'traité' }, f);
  assert.deepEqual(appels, [], 'aucun appel n’a été fait');

  const { f: f2, appels: a2 } = simuler(() => json({ id: 'aa11' }));
  await gmail.ecrire?.({ quandTraite: 'lu' }, JETON, 'aa11', { statut: 'traité' }, f2);
  assert.deepEqual((a2[0] as Appel).corps, { removeLabelIds: ['UNREAD'] }, 'marquer comme lu : le libellé UNREAD est retiré');
  const { f: f3, appels: a3 } = simuler(() => json({ id: 'aa11' }));
  await gmail.ecrire?.({ quandTraite: 'archiver' }, JETON, 'aa11', { statut: 'traité' }, f3);
  assert.deepEqual((a3[0] as Appel).corps, { removeLabelIds: ['UNREAD', 'INBOX'] }, 'archiver : le message quitte la boîte de réception');
});

test('expéditeur, en-têtes et lien : ce qui est lisible l’est, le reste ne casse rien', () => {
  assert.equal(nomExpediteur('Kerlann Bois <kerlann@exemple.fr>'), 'Kerlann Bois');
  assert.equal(nomExpediteur('"Le Goff, Annaig" <a@exemple.fr>'), 'Le Goff, Annaig');
  assert.equal(nomExpediteur('<compta@exemple.fr>'), 'compta@exemple.fr');
  assert.equal(nomExpediteur('<script>x</script>'), 'scriptx/script', 'aucun chevron ne ressort d’un expéditeur');
  assert.equal(enteteGmail({ headers: [{ name: 'subject', value: 'Bonjour' }] }, 'Subject'), 'Bonjour');
  assert.equal(enteteGmail(null, 'Subject'), '');
  assert.equal(lienGmail(''), '', 'sans identifiant de message, pas de bouton');
  assert.equal(combien({ combien: 'messages100' }), 100);
  assert.equal(combien({}), 50);
  const f = ficheCourrier({ id: 'x', expediteur: '', objet: '', recuLe: '', lu: false, lien: '' });
  assert.equal(f.champs.expediteur, 'Expéditeur inconnu');
  assert.equal(f.champs.objet, '(sans objet)');
  assert.equal(f.champs.bac, 'autre');
});

test('le tri est le même pour un mail collé et pour une boîte branchée', () => {
  for (const t of ['Relance de votre facture', 'Virement reçu', 'Mise en demeure']) assert.equal(bacDe(t), 'paiements', t);
  assert.equal(bacDe('Votre devis signé'), 'clients');
  assert.equal(bacDe('Attestation URSSAF'), 'administratif');
  assert.equal(urgenceDe('Dernier rappel avant mise en demeure', 'paiements'), 'haute');
  assert.equal(urgenceDe('Newsletter', 'publicité'), 'basse');
  assert.equal(urgenceDe('Bonjour', 'clients'), 'normale');
});

// ---------------------------------------------------------------- temps réel

test('temps réel de l’agenda : canal chez Google, abonnement chez Microsoft, et rien pour le courrier', async () => {
  assert.equal(TEMPS_REEL_DE.agendagoogle, 'googleagenda');
  assert.equal(TEMPS_REEL_DE.agendamicrosoft, 'microsoftagenda');
  assert.equal(TEMPS_REEL_DE.gmail, undefined, 'Gmail n’envoie ses avis que par Cloud Pub/Sub : la boîte est relue, pas abonnée');
  assert.equal(TEMPS_REEL_DE.outlook, undefined);
  // changer d'agenda change ce qui est suivi : l'abonnement est refait
  assert.notEqual(suiviDe('agendagoogle', { agenda: 'a@x.fr' }), suiviDe('agendagoogle', { agenda: 'b@x.fr' }));

  const avis = { adresse: 'https://reseau.example/v0/relais/evenements/googleagenda/x', secret: 'secret-du-reseau', utilisateur: null };
  const { f, appels } = simuler((a) => (a.url.pathname.endsWith('/watch') ? json({ resourceId: 'RES1', expiration: String(Date.now() + 86_400_000) }) : json({})));
  const ab = await OUTILS_TEMPS_REEL.googleagenda.creer({ agenda: 'chantiers@exemple.fr' }, JETON, f, avis);
  assert.match((appels[0] as Appel).url.pathname, /\/calendars\/chantiers%40exemple\.fr\/events\/watch$/);
  assert.equal((appels[0] as Appel).corps.type, 'web_hook');
  assert.equal((appels[0] as Appel).corps.token, 'secret-du-reseau', 'c’est ce jeton qui prouvera l’origine de l’avis');
  assert.equal(ab.ressource, 'RES1');
  await OUTILS_TEMPS_REEL.googleagenda.supprimer({}, JETON, f, ab);
  assert.match((appels.at(-1) as Appel).url.pathname, /\/channels\/stop$/);

  const { f: f2, appels: a2 } = simuler(() => json({ id: '11111111-2222-3333-4444-555555555555', expirationDateTime: '2026-11-20T00:00:00Z' }));
  const ab2 = await OUTILS_TEMPS_REEL.microsoftagenda.creer({ agenda: 'AAA=' }, JETON, f2, { ...avis, adresse: 'https://reseau.example/v0/relais/evenements/microsoftagenda/x' });
  assert.equal((a2[0] as Appel).corps.resource, 'me/events');
  assert.equal((a2[0] as Appel).corps.clientState, 'secret-du-reseau');
  const duree = Date.parse((a2[0] as Appel).corps.expirationDateTime) - Date.now();
  assert.ok(duree <= 10_080 * 60_000, 'Microsoft n’accepte pas plus de 10 080 minutes pour un événement');
  await OUTILS_TEMPS_REEL.microsoftagenda.renouveler?.({}, JETON, f2, ab2, avis);
  assert.equal((a2.at(-1) as Appel).methode, 'PATCH');
});

// ---------------------------------------------------------------- de bout en bout : lire, rattacher, anti-boucle

test('de bout en bout : les rendez-vous entrent dans le Planning, un courrier se rattache à un client', async () => {
  const app = await Application.creer({ exemple: 'pme', fetch: (async () => { throw new Error('aucun appel réseau attendu'); }) as typeof fetch });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  const univers = app.monde.univers;
  const rdv = univers.types.find((t) => t.id === 'rendez_vous');
  assert.ok(rdv, 'le type « rendez-vous » existe');
  assert.equal(rdv.famille, 'evenement');
  const courrier = univers.types.find((t) => t.id === 'courrier');
  // rattacher un message : à un client (« tiers ») ou à une commande (« concerne »)
  assert.ok(courrier?.champs.some((c) => c.id === 'tiers'));
  assert.ok(courrier?.champs.some((c) => c.id === 'concerne'));
  assert.ok(courrier?.champs.some((c) => c.id === 'lien'), 'de quoi rouvrir le message chez sa messagerie');

  const sid = 'reel';
  const semaine = app.monde.planning(p, sid, undefined, 5) as { jours: string[]; rendezVous: unknown[] };
  assert.ok(Array.isArray(semaine.rendezVous), 'le planning porte les rendez-vous de la semaine');
  const jour = semaine.jours[1] as string;
  const client = app.monde.donneesSante(p, sid).objets.find((o) => o.famille === 'tiers');
  assert.ok(client);
  app.monde.creerObjet(p, sid, { type: 'rendez_vous', nom: 'Visite de chantier', champs: { debut: `${jour}T09:00`, fin: `${jour}T10:30`, lieu: 'Lorient', avec: client.id, etat: 'confirmé' } });
  const apres = app.monde.planning(p, sid, undefined, 5) as { rendezVous: { titre: string; jour: string; heure: string | null; avec: { nom: string } | null }[] };
  const vu = apres.rendezVous.find((r) => r.titre === 'Visite de chantier');
  assert.ok(vu, 'il apparaît dans le planning de la semaine');
  assert.equal(vu.jour, jour);
  assert.equal(vu.heure, '9 h 00');
  assert.equal(vu.avec?.nom, client.nom);
});
