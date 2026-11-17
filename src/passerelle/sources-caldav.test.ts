/**
 * Agenda Apple (iCloud) et serveurs CalDAV : `fetch` simulé, aucun appel réseau.
 * Vérifie le dépliage et l'échappement iCalendar, les trois formes de date, la découverte en trois PROPFIND, la
 * lecture d'un REPORT, l'écriture d'un .ics — et qu'un serveur bavard n'emmène jamais le mot de passe ailleurs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adresse, agendaapple, agendas, balises, cheminEvenement, dateIcal, deplier, dureeIcal, echapperIcal, evenements,
  ficheCalDAV, plier, proprieteIcal, requeteCalendrier, serveur, texteCalendrier, texteIcal, vcalendar, versIcal,
} from './sources-caldav.ts';

interface Appel { url: URL; methode: string; entetes: Headers; corps: string }
function simuler(repondre: (a: Appel, n: number) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: init?.body ? String(init.body) : '' };
    appels.push(a);
    return repondre(a, appels.length - 1);
  }) as typeof fetch;
  return { f, appels };
}
const xml = (corps: string, statut = 207) => new Response(corps, { status: statut, headers: { 'content-type': 'application/xml; charset=utf-8' } });
const CFG = { identifiant: 'anna@icloud.com', agenda: '/123456/calendars/travail/', periode: 'periode90' };
const SECRET = 'abcd-efgh-ijkl-mnop';

// ---------------------------------------------------------------- iCalendar, sans réseau

test('iCalendar : dépliage, échappement et propriétés', () => {
  // RFC 5545 : une ligne coupée reprend à la suivante, précédée d'une espace — et le dépliage précède tout le reste
  assert.deepEqual(deplier('SUMMARY:Point\r\n  mensuel\r\nEND:VEVENT'), ['SUMMARY:Point mensuel', 'END:VEVENT']);
  assert.equal(texteIcal('Point\\nmensuel\\, salle 2'), 'Point mensuel, salle 2');
  assert.equal(texteIcal('a\\\\b'), 'a\\b');
  assert.equal(echapperIcal('Point; salle 2, 1er\nétage'), 'Point\\; salle 2\\, 1er\\nétage');
  const p = proprieteIcal('DTSTART;TZID=Europe/Paris;VALUE=DATE-TIME:20261117T150000');
  assert.equal(p?.nom, 'DTSTART');
  assert.deepEqual(p?.params, { TZID: 'Europe/Paris', VALUE: 'DATE-TIME' });
  assert.equal(p?.valeur, '20261117T150000');
  assert.equal(proprieteIcal('sans-deux-points'), null);
  // le pliage ne coupe jamais au milieu d'un caractère multi-octets
  const long = plier(`SUMMARY:${'é'.repeat(60)}`);
  assert.ok(long.split('\r\n').every((l) => Buffer.byteLength(l, 'utf8') <= 76), long);
  assert.equal(long.replace(/\r\n /g, ''), `SUMMARY:${'é'.repeat(60)}`, 'déplié, on retrouve la ligne');
});

test('dates iCalendar : journée entière, UTC, fuseau nommé, heure flottante', () => {
  assert.deepEqual(dateIcal(proprieteIcal('DTSTART;VALUE=DATE:20261117')), { valeur: '2026-11-17', journee: true });
  // 14 h UTC le 17 novembre : heure d'hiver à Paris, donc 15 h — converti dans le fuseau de cet ordinateur
  const utc = dateIcal(proprieteIcal('DTSTART:20261117T140000Z'));
  assert.equal(utc.journee, false);
  assert.match(utc.valeur, /^2026-11-17T\d{2}:\d{2}$/);
  assert.equal(new Date(Date.parse(`${utc.valeur}:00`)).toISOString().slice(11, 16), '14:00');
  // fuseau nommé : 15 h à Paris = 14 h UTC (heure d'hiver), et 15 h à Paris en juillet = 13 h UTC (heure d'été)
  const hiver = dateIcal(proprieteIcal('DTSTART;TZID=Europe/Paris:20261117T150000'));
  const ete = dateIcal(proprieteIcal('DTSTART;TZID=Europe/Paris:20260717T150000'));
  const enUtc = (v: string) => new Date(Date.parse(`${v}:00`)).toISOString().slice(11, 16);
  assert.equal(enUtc(hiver.valeur), '14:00');
  assert.equal(enUtc(ete.valeur), '13:00');
  // sans fuseau : l'heure est prise telle quelle, elle n'est convertie nulle part
  assert.deepEqual(dateIcal(proprieteIcal('DTSTART:20261117T150000')), { valeur: '2026-11-17T15:00', journee: false });
  assert.deepEqual(dateIcal(proprieteIcal('DTSTART:pas une date')), { valeur: '', journee: false });
  assert.deepEqual(dateIcal(null), { valeur: '', journee: false });
  assert.equal(dureeIcal('PT1H30M'), 5_400_000);
  assert.equal(dureeIcal('P1DT2H'), 93_600_000);
  assert.equal(dureeIcal('n’importe quoi'), 0);
});

const ICS = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:aaa-111', 'SUMMARY:Point mensuel\\, Anna', 'DTSTART:20261117T140000Z', 'DTEND:20261117T150000Z',
  'LOCATION:Visio', 'STATUS:TENTATIVE', 'DESCRIPTION:ne doit pas entrer', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:bbb-222', 'SUMMARY:Congés', 'DTSTART;VALUE=DATE:20261224', 'DTEND;VALUE=DATE:20261226', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:ccc-333', 'SUMMARY:Annulé', 'DTSTART:20261118T090000Z', 'STATUS:CANCELLED', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:ddd-444', 'SUMMARY:Sans début', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:eee-555', 'SUMMARY:Atelier', 'DTSTART:20261119T080000Z', 'DURATION:PT90M', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('VEVENT → fiche : titre, bornes, lieu, état ; ni description, ni annulé, ni sans date', () => {
  const evs = evenements(ICS);
  assert.equal(evs.length, 5);
  const fiches = evs.map((e) => ficheCalDAV(e)).filter(Boolean);
  assert.deepEqual(fiches.map((x) => x?.externeId), ['aaa-111', 'bbb-222', 'eee-555'], 'annulé et sans début : écartés');
  const [point, conges, atelier] = fiches;
  assert.equal(point?.champs.titre, 'Point mensuel, Anna');
  assert.equal(point?.champs.lieu, 'Visio');
  assert.equal(point?.champs.etat, 'à confirmer');
  assert.ok(!('description' in (point?.champs ?? {})), 'la description n’entre jamais dans le jeu');
  assert.deepEqual([conges?.champs.debut, conges?.champs.fin], ['2026-12-24', '2026-12-26']);
  assert.equal(conges?.champs.etat, 'confirmé');
  // DURATION remplace un DTEND absent : 8 h + 1 h 30
  const h = (v: unknown) => new Date(Date.parse(`${String(v)}:00`)).toISOString().slice(11, 16);
  assert.equal(h(atelier?.champs.fin), '09:30');
  // une occurrence d'une série ne doit pas écraser sa maîtresse : la date la distingue
  const occurrence = evenements(['BEGIN:VEVENT', 'UID:aaa-111', 'RECURRENCE-ID:20261124T140000Z', 'SUMMARY:Point', 'DTSTART:20261124T140000Z', 'END:VEVENT'].join('\r\n'));
  assert.match(String(ficheCalDAV(occurrence[0] ?? [])?.externeId), /^aaa-111#2026-11-24T/);
});

test('écriture : un VCALENDAR valide, en UTC ou en date nue, échappé et plié', () => {
  const ics = vcalendar('uid-1@living-business', { titre: 'Point; mensuel', debut: '2026-11-17T15:00', fin: '2026-11-17T16:00', lieu: 'Salle 2', etat: 'à confirmer' }, Date.parse('2026-11-17T09:00:00Z'));
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /\r\nEND:VCALENDAR\r\n$/);
  assert.match(ics, /\r\nUID:uid-1@living-business\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261117T090000Z\r\n/);
  assert.match(ics, /\r\nSUMMARY:Point\\; mensuel\r\n/);
  assert.match(ics, /\r\nSTATUS:TENTATIVE\r\n/);
  assert.match(ics, /\r\nDTSTART:\d{8}T\d{6}Z\r\n/, 'heure écrite en UTC : aucune table de fuseaux à emporter');
  // journée entière : date nue des deux côtés, VALUE=DATE
  const jour = vcalendar('uid-2', { titre: 'Congés', debut: '2026-12-24', fin: '2026-12-26' });
  assert.match(jour, /\r\nDTSTART;VALUE=DATE:20261224\r\n/);
  assert.match(jour, /\r\nDTEND;VALUE=DATE:20261226\r\n/);
  assert.match(jour, /\r\nSTATUS:CONFIRMED\r\n/);
  assert.throws(() => vcalendar('uid-3', { titre: 'Sans date' }), /date de début/);
  assert.deepEqual(versIcal({ valeur: '2026-12-24', journee: true }), { param: ';VALUE=DATE', valeur: '20261224' });
  assert.equal(cheminEvenement('/123456/calendars/travail/', 'uid-1@living-business'), '/123456/calendars/travail/uid-1%40living-business.ics');
  // un UID ne remonte jamais dans les dossiers : les barres disparaissent, il ne reste qu'un nom de fichier
  assert.equal(cheminEvenement('/c/', 'a/../../etc'), '/c/a-..-..-etc.ics');
  assert.equal(cheminEvenement('/c/', 'a/../../etc').split('/').length, 3);
});

// ---------------------------------------------------------------- XML et adresses

test('XML : balises quel que soit le préfixe, calendar-data gardé tel quel', () => {
  assert.deepEqual(balises('<D:href>/a/</D:href><x1:href>/b/</x1:href>', 'href'), ['/a/', '/b/']);
  assert.equal(texteCalendrier('<cal:calendar-data>BEGIN:VCALENDAR\r\nX:1\r\nEND:VCALENDAR</cal:calendar-data>'), 'BEGIN:VCALENDAR\r\nX:1\r\nEND:VCALENDAR');
  assert.equal(texteCalendrier('<c:calendar-data><![CDATA[BEGIN:VEVENT\nSUMMARY:a & b\nEND:VEVENT]]></c:calendar-data>'), 'BEGIN:VEVENT\nSUMMARY:a & b\nEND:VEVENT');
  assert.equal(texteCalendrier('<c:calendar-data>SUMMARY:a &amp; b</c:calendar-data>'), 'SUMMARY:a & b');
  assert.equal(texteCalendrier('<d:href>/a/</d:href>'), '');
});

test('adresses : HTTPS, le domaine choisi et ses partitions, rien d’autre', () => {
  assert.equal(serveur({}), 'caldav.icloud.com');
  assert.equal(serveur({ serveur: 'Caldav.Fastmail.COM' }), 'caldav.fastmail.com');
  assert.throws(() => serveur({ serveur: 'https://caldav.icloud.com/' }), /nom de domaine/);
  assert.throws(() => serveur({ serveur: '127.0.0.1' }), /nom de domaine/);
  assert.equal(adresse({}, '/123/calendars/').toString(), 'https://caldav.icloud.com/123/calendars/');
  // iCloud répond avec ses serveurs de partition : même domaine, machine différente — accepté
  assert.equal(adresse({}, 'https://p42-caldav.icloud.com/123/').hostname, 'p42-caldav.icloud.com');
  assert.throws(() => adresse({}, 'https://ailleurs.example/123/'), /autre domaine/);
  assert.throws(() => adresse({}, 'http://caldav.icloud.com/123/'), /HTTPS/);
  assert.throws(() => adresse({}, 'https://voleur:mdp@caldav.icloud.com/'), /HTTPS/);
});

// ---------------------------------------------------------------- les appels

const PRINCIPAL = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"><d:response><d:href>/</d:href><d:propstat><d:prop><d:current-user-principal><d:href>/123456/principal/</d:href></d:current-user-principal></d:prop></d:propstat></d:response></d:multistatus>';
const MAISON = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:response><d:href>/123456/principal/</d:href><d:propstat><d:prop><c:calendar-home-set><d:href>/123456/calendars/</d:href></c:calendar-home-set></d:prop></d:propstat></d:response></d:multistatus>';
const LISTE = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:response><d:href>/123456/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>
  <d:response><d:href>/123456/calendars/travail/</d:href><d:propstat><d:prop><d:displayname>Travail</d:displayname>
    <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
    <c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
  <d:response><d:href>/123456/calendars/rappels/</d:href><d:propstat><d:prop><d:displayname>Rappels</d:displayname>
    <d:resourcetype><d:collection/><c:calendar/></d:resourcetype>
    <c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set></d:prop></d:propstat></d:response>
</d:multistatus>`;

test('découverte : trois PROPFIND, le mot de passe en Basic, les listes de tâches écartées', async () => {
  const { f, appels } = simuler((a) => xml(a.corps.includes('current-user-principal') ? PRINCIPAL : a.corps.includes('calendar-home-set') ? MAISON : LISTE));
  const choix = await agendas(f, CFG, SECRET);
  assert.deepEqual(choix, [{ valeur: '/123456/calendars/travail/', libelle: 'Travail' }]);
  assert.deepEqual(appels.map((a) => [a.methode, a.url.pathname, a.entetes.get('depth')]), [
    ['PROPFIND', '/', '0'], ['PROPFIND', '/123456/principal/', '0'], ['PROPFIND', '/123456/calendars/', '1'],
  ]);
  const auth = appels[0]?.entetes.get('authorization') ?? '';
  assert.equal(auth, `Basic ${Buffer.from(`anna@icloud.com:${SECRET}`).toString('base64')}`);
  // le secret ne part jamais dans une adresse
  for (const a of appels) assert.ok(!a.url.toString().includes(SECRET) && !a.url.toString().includes('anna@'), a.url.toString());
});

test('découverte : un serveur qui renvoie ailleurs n’emporte pas le mot de passe', async () => {
  const ailleurs = PRINCIPAL.replace('/123456/principal/', 'https://pirate.example/vol/');
  const { f, appels } = simuler(() => xml(ailleurs));
  await assert.rejects(agendas(f, CFG, SECRET), /autre domaine/);
  assert.equal(appels.length, 1, 'rien n’est parti vers l’autre domaine');
});

test('découverte : messages en français quand le compte ou l’agenda manque', async () => {
  const vide = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:"></d:multistatus>';
  const { f } = simuler(() => xml(vide));
  await assert.rejects(agendas(f, CFG, SECRET), /vérifiez l’identifiant et le mot de passe/);
  const { f: f2 } = simuler((a) => xml(a.corps.includes('current-user-principal') ? PRINCIPAL : vide));
  await assert.rejects(agendas(f2, CFG, SECRET), /calendar-home-set/);
  await assert.rejects(agendas(simuler(() => xml(PRINCIPAL)).f, { ...CFG, identifiant: '' }, SECRET), /identifiant du compte/);
  await assert.rejects(agendas(simuler(() => xml(PRINCIPAL)).f, CFG, null), /[Mm]ot de passe d’application manquant/);
});

test('lecture : un REPORT borné à la période, les doublons d’une série écartés', async () => {
  const reponse = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
    <d:response><d:href>/123456/calendars/travail/a.ics</d:href><d:propstat><d:prop><c:calendar-data>${ICS.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</c:calendar-data></d:prop></d:propstat></d:response>
    <d:response><d:href>/123456/calendars/travail/b.ics</d:href><d:propstat><d:prop><c:calendar-data>${ICS.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</c:calendar-data></d:prop></d:propstat></d:response>
  </d:multistatus>`;
  const { f, appels } = simuler(() => xml(reponse));
  const fiches = await agendaapple.lire(CFG, SECRET, f);
  assert.deepEqual(fiches.map((x) => x.externeId), ['aaa-111', 'bbb-222', 'eee-555'], 'le même UID n’entre qu’une fois');
  assert.equal(appels[0]?.methode, 'REPORT');
  assert.equal(appels[0]?.url.pathname, '/123456/calendars/travail/');
  assert.match(appels[0]?.corps ?? '', /<c:time-range start="\d{8}T\d{6}Z" end="\d{8}T\d{6}Z"\/>/);
  assert.match(requeteCalendrier('2026-11-17T09:00:00.000Z', '2027-02-15T09:00:00.000Z'), /start="20261117T090000Z" end="20270215T090000Z"/);
  await assert.rejects(agendaapple.lire({ ...CFG, agenda: '' }, SECRET, f), /Choisissez l’agenda/);
});

test('écriture : PUT d’un .ics dans l’agenda choisi, mise à jour sur le même UID', async () => {
  const { f, appels } = simuler(() => new Response('', { status: 201 }));
  const uid = await agendaapple.ecrire?.(CFG, SECRET, null, { titre: 'Visite', debut: '2026-11-20T10:00', fin: '2026-11-20T11:00' }, f);
  assert.match(String(uid), /@living-business$/);
  assert.equal(appels[0]?.methode, 'PUT');
  assert.match(appels[0]?.url.pathname ?? '', /^\/123456\/calendars\/travail\/.+\.ics$/);
  assert.match(appels[0]?.entetes.get('content-type') ?? '', /^text\/calendar/);
  assert.match(appels[0]?.corps ?? '', /SUMMARY:Visite/);
  // une mise à jour réécrit le même fichier, et une occurrence de série repart sur l'UID de sa maîtresse
  const { f: f2, appels: a2 } = simuler(() => new Response(null, { status: 204 }));
  assert.equal(await agendaapple.ecrire?.(CFG, SECRET, 'aaa-111#2026-11-24T14:00', { titre: 'Point', debut: '2026-11-24T14:00' }, f2), 'aaa-111');
  assert.equal(a2[0]?.url.pathname, '/123456/calendars/travail/aaa-111.ics');
});

test('l’adaptateur se déclare comme les autres agendas : liste, période, secret collé', () => {
  assert.equal(agendaapple.id, 'agendaapple');
  assert.equal(agendaapple.categorie, 'Agenda');
  assert.equal(agendaapple.ecriture, true);
  const champs = Object.fromEntries(agendaapple.champs.map((c) => [c.id, c]));
  assert.equal(champs.motdepasse?.secret, true);
  assert.equal(champs.agenda?.liste, true);
  assert.deepEqual(champs.periode?.choix, ['periode30', 'periode90', 'periode180', 'periode365']);
  // aucun champ `mode: 'oauth'` : Apple n'a pas de bouton « Se connecter avec », et on ne fait pas semblant
  assert.ok(agendaapple.champs.every((c) => c.mode !== 'oauth'));
  assert.ok(agendaapple.etapes.some((e) => /mot de passe pour app/i.test(e)), 'la marche à suivre est écrite');
});
