/**
 * Fiches, listes et planning (direction de design §6.1 P7, §4.11, §4.30, §4.31) : web/fiches.js, web/planning.js et
 * web/bz/terrain.js (modules purs) — colonnes par type, tri, en-tête de fiche, édition en place, vues enregistrées,
 * vues du planning, sélection, lots optimistes et leur annulation, liens tel:, sms: et « Y aller ».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Champ = { id: string; libelle: string; type: string; valeur: unknown; lien?: { id: string; nom: string } | null; unite?: string | null; choix?: string[] };
type Objet = { id: string; nom: string; type: string; famille: string; champs: Champ[] };
type F = {
  COLONNES: Record<string, string[]>;
  colonnesDe: (o: Objet[]) => Array<{ id: string; type: string }>;
  trier: (o: Objet[], t: { colonne: string; sens: string }, x?: { etatDe?: (o: Objet) => number }) => Objet[];
  triSuivant: (t: { colonne: string; sens: string }, c: string) => { colonne: string; sens: string };
  ariaSort: (t: { colonne: string; sens: string }, c: string) => string;
  groupesFiche: (o: Objet) => Array<{ id: string; champs: Champ[] }>;
  coordonnees: (o: Objet) => { tel: { lien: string } | null; courriel: { lien: string } | null; adresse: string | null };
  actionsEntete: (o: Objet, x?: { actionsPossibles?: unknown[]; peutEntrer?: boolean }) => Array<{ id: string; libelle: string; genre: string }>;
  valeurEdition: (c: Champ) => string;
  lireSaisie: (c: Partial<Champ>, brut: string) => { ok: boolean; valeur?: unknown; erreur?: string };
  change: (c: Champ, v: unknown) => boolean;
  lireVues: (t: string | null) => Array<{ nom: string; recherche: string; tri: { colonne: string; sens: string }; filtre: string }>;
  enregistrerVue: (v: unknown[], x: unknown) => Array<{ nom: string }>;
};
type P = {
  nbJoursValide: (n: unknown) => number;
  semaineIso: (j: string) => number;
  decalerSemaine: (j: string, p: number) => string;
  estWeekEnd: (j: string) => boolean;
  parLieu: (P: unknown, j?: string) => { jour: string; lieux: Array<{ valeur: string; nb: number; sous: boolean }>; hors: Array<{ ligne: { id: string }; libelle: string }> };
  parPersonne: (P: unknown) => Array<{ groupe: string; personnes: Array<{ id: string; jours: Array<{ jour: string; libelle: string }> }> }>;
  rectangle: (l: string[], j: string[], a: unknown, b: unknown) => Array<{ employe: string; date: string }>;
  caseVoisine: (l: string[], j: string[], c: unknown, t: string) => { employe: string; date: string } | null;
  lotPour: (P: unknown, c: unknown[], v: string) => Array<{ employe: string; date: string; valeur: string }>;
  lotRemplir: (P: unknown, a: unknown, c: unknown[]) => Array<{ employe: string; date: string; valeur: string }>;
  lotInverse: (P: unknown, l: unknown[]) => Array<{ employe: string; date: string; valeur: string }>;
  appliquer: (P: Plan, l: unknown[]) => Plan;
  texteLot: (P: unknown, l: unknown[]) => string;
};
type T = {
  telephoneDe: (t: unknown) => { affiche: string; international: string; lien: string } | null;
  courrielDe: (t: unknown) => { lien: string } | null;
  lienItineraire: (a: string, o?: { appli?: string; ios?: boolean }) => string | null;
  lienRetard: (t: string, m?: number, o?: { ios?: boolean }) => string | null;
};
type Plan = { debut: string; aujourdhui: string; jours: string[]; lignes: Array<{ id: string; nom: string; groupe: string; cases: Record<string, string> }>; options: Array<{ valeur: string; libelle: string; groupe: string }>; cibles: Array<{ valeur: string; id: string; libelle: string; famille: string; besoin: number | null }>; totaux: Record<string, Record<string, number>> };

const Fi = (await import(new URL('../../web/fiches.js', import.meta.url).href)) as F;
const Pl = (await import(new URL('../../web/planning.js', import.meta.url).href)) as P;
const Te = (await import(new URL('../../web/bz/terrain.js', import.meta.url).href)) as T;
const espaces = (t: string) => t.replace(/[  ]/g, ' ');

const ch = (id: string, valeur: unknown, type = 'texte', extra: Partial<Champ> = {}): Champ => ({ id, libelle: id, type, valeur, lien: null, unite: null, ...extra });
const o = (id: string, nom: string, type: string, famille: string, champs: Champ[]): Objet => ({ id, nom, type, famille, champs });

test('listes : colonnes déclarées par type, union des types présents, seulement les colonnes renseignées', () => {
  const kerlann = o('t1', 'Kerlann Bois', 'entreprise', 'tiers', [ch('ville', 'Quimper'), ch('contact', null), ch('encours', 1240, 'montant'), ch('activite', 'Menuiserie'), ch('siret', '123')]);
  const famille = o('t2', 'Famille Le Goff', 'particulier', 'tiers', [ch('ville', 'Brest'), ch('contact', null), ch('email', 'goff@exemple.test')]);
  assert.deepEqual(Fi.colonnesDe([kerlann, famille]).map((c) => c.id), ['ville', 'encours', 'activite', 'email'], 'contact vide partout : omis ; siret non déclaré');
  assert.ok(Fi.colonnesDe([kerlann]).length <= 4);
  const perso = o('x', 'Machine', 'type_maison', 'ressource', [ch('a', null), ch('b', 'oui'), ch('c', 3, 'nombre')]);
  assert.deepEqual(Fi.colonnesDe([perso]).map((c) => c.id), ['b', 'c'], 'type personnalisé : ses champs renseignés');
  for (const [t, cols] of Object.entries(Fi.COLONNES)) assert.ok(cols.length >= 1 && cols.length <= 4, t);
});

test('listes : tri à la française, nombres, valeur absente toujours en dernier ; cycle croissant → décroissant → nom', () => {
  const l = [
    o('a', 'Élodie', 'entreprise', 'tiers', [ch('encours', 50, 'montant')]),
    o('b', 'arthur', 'entreprise', 'tiers', [ch('encours', null, 'montant')]),
    o('c', 'Zoé', 'entreprise', 'tiers', [ch('encours', 1200, 'montant')]),
    o('d', 'Bruno', 'entreprise', 'tiers', [ch('encours', 9, 'montant')]),
  ];
  assert.deepEqual(Fi.trier(l, { colonne: 'nom', sens: 'asc' }).map((x) => x.id), ['b', 'd', 'a', 'c'], 'É se range avec E');
  assert.deepEqual(Fi.trier(l, { colonne: 'encours', sens: 'asc' }).map((x) => x.id), ['d', 'a', 'c', 'b']);
  assert.deepEqual(Fi.trier(l, { colonne: 'encours', sens: 'desc' }).map((x) => x.id), ['c', 'a', 'd', 'b'], 'l’absent reste en dernier');
  assert.deepEqual(Fi.trier(l, { colonne: 'etat', sens: 'asc' }, { etatDe: (x) => (x.id === 'c' ? 0 : 4) }).map((x) => x.id)[0], 'c');
  let t = { colonne: 'nom', sens: 'asc' };
  t = Fi.triSuivant(t, 'encours'); assert.deepEqual(t, { colonne: 'encours', sens: 'asc' }); assert.equal(Fi.ariaSort(t, 'encours'), 'ascending');
  t = Fi.triSuivant(t, 'encours'); assert.equal(Fi.ariaSort(t, 'encours'), 'descending');
  t = Fi.triSuivant(t, 'encours'); assert.deepEqual(t, { colonne: 'nom', sens: 'asc' }); assert.equal(Fi.ariaSort(t, 'encours'), 'none');
});

test('fiche : 2 actions principales toujours au même endroit (Appeler, Écrire, Y aller), édition en place hors des boutons', () => {
  const client = o('t1', 'Kerlann Bois', 'entreprise', 'tiers', [ch('contact', 'Maïwenn, 02 98 12 34 56'), ch('email', 'compta@kerlann.test'), ch('ville', 'Quimper')]);
  const actions = [{ capacite: 'objet.modifier', libelle: 'Modifier la fiche' }, { capacite: 'tache.creer', libelle: 'Créer une tâche liée' }];
  assert.deepEqual(Fi.actionsEntete(client, { actionsPossibles: actions }).map((a) => a.id), ['appeler', 'ecrire']);
  const lieu = o('l1', 'Atelier', 'atelier', 'lieu', [ch('adresse', '3 quai de l’Odet, Quimper')]);
  assert.deepEqual(Fi.actionsEntete(lieu, { peutEntrer: true }).map((a) => a.id), ['y-aller', 'entrer']);
  const article = o('a1', 'Vis', 'article', 'ressource', [ch('quantite', 3, 'nombre')]);
  const lib = Fi.actionsEntete(article, { actionsPossibles: [{ capacite: 'mouvement', champ: 'quantite', libelle: 'Enregistrer un mouvement — Quantité' }, ...actions] });
  assert.deepEqual(lib.map((a) => a.libelle), ['Mouvement : Quantité', 'Créer une tâche']);
  assert.ok(!lib.some((a) => /Modifier/.test(a.libelle)), 'la modification se fait champ par champ');
  assert.equal(Fi.coordonnees(client).tel?.lien, 'tel:+33298123456');
  assert.equal(Fi.coordonnees(client).courriel?.lien, 'mailto:compta@kerlann.test');
  // groupes repliables
  const g = Fi.groupesFiche(o('p1', 'Chantier', 'projet', 'projet', [ch('client', 't1', 'reference', { lien: { id: 't1', nom: 'Kerlann' } }), ch('echeance', '2026-12-01', 'date'), ch('montant', 9000, 'montant'), ch('avancement', 40, 'nombre'), ch('note_libre', 'x')]));
  assert.deepEqual(g.map((x) => x.id), ['suivi', 'dates', 'chiffres', 'liens', 'autres']);
});

test('édition en place : saisie lue à la française, erreurs en clair, rien n’est envoyé si rien ne change', () => {
  assert.deepEqual(Fi.lireSaisie({ type: 'montant' }, '1 240,5'), { ok: true, valeur: 1240.5 });
  assert.deepEqual(Fi.lireSaisie({ type: 'nombre' }, ''), { ok: true, valeur: null }, 'vide : effacer');
  assert.equal(Fi.lireSaisie({ type: 'nombre' }, 'douze').ok, false);
  assert.match(Fi.lireSaisie({ type: 'nombre' }, 'douze').erreur ?? '', /nombre/);
  assert.deepEqual(Fi.lireSaisie({ type: 'date' }, '2026-11-12'), { ok: true, valeur: '2026-11-12' });
  assert.equal(Fi.lireSaisie({ type: 'date' }, '12/11/2026').ok, false);
  assert.equal(Fi.lireSaisie({ type: 'choix', choix: ['ouvert', 'fermé'] }, 'peut-être').ok, false);
  assert.deepEqual(Fi.lireSaisie({ type: 'booleen' }, 'oui'), { ok: true, valeur: true });
  assert.equal(Fi.valeurEdition(ch('echeance', '2026-11-12T00:00:00Z', 'date')), '2026-11-12');
  assert.equal(Fi.valeurEdition(ch('client', 't1', 'reference', { lien: { id: 't1', nom: 'K' } })), 't1');
  assert.equal(Fi.change(ch('ville', 'Quimper'), 'Quimper'), false);
  assert.equal(Fi.change(ch('ville', null), null), false);
  assert.equal(Fi.change(ch('ville', 'Quimper'), 'Brest'), true);
});

test('vues enregistrées : préférence de l’appareil relue prudemment, 12 au plus, même nom remplacé', () => {
  assert.deepEqual(Fi.lireVues('pas du json'), []);
  assert.deepEqual(Fi.lireVues('{"nom":"x"}'), []);
  const v = Fi.lireVues(JSON.stringify([{ nom: 'En retard', recherche: 'quimper', tri: { colonne: 'encours', sens: 'desc' }, filtre: 'tous' }, { nom: '<script>', tri: {} }, { nom: 'Tri', tri: { colonne: 'a b' } }]));
  assert.deepEqual(v.map((x) => x.nom), ['En retard', 'Tri']);
  assert.deepEqual(v[1]?.tri, { colonne: 'nom', sens: 'asc' }, 'colonne invalide : tri par défaut');
  let liste = v as unknown[];
  for (let i = 0; i < 15; i++) liste = Fi.enregistrerVue(liste, { nom: `Vue ${i}`, recherche: '', tri: { colonne: 'nom', sens: 'asc' }, filtre: 'tous' });
  assert.equal(liste.length, 12);
  liste = Fi.enregistrerVue(liste, { nom: 'vue 14', recherche: 'x', tri: { colonne: 'nom', sens: 'asc' }, filtre: 'tous' });
  assert.equal((liste as Array<{ nom: string }>).filter((x) => x.nom.toLowerCase() === 'vue 14').length, 1);
});

test('terrain : numéro en tel: (format international dans le lien, français à l’écran), SMS de retard, « Y aller »', () => {
  const t = Te.telephoneDe('Marie, +33 6 12 34 56 78');
  assert.equal(t?.lien, 'tel:+33612345678');
  assert.equal(espaces(t?.affiche ?? ''), '06 12 34 56 78');
  assert.equal(Te.telephoneDe('02.98.12.34.56')?.international, '+33298123456');
  assert.equal(Te.telephoneDe('SIRET 123 456 789 00012'), null);
  assert.equal(Te.telephoneDe(null), null);
  assert.equal(Te.courrielDe('écrire à compta@kerlann.test svp')?.lien, 'mailto:compta@kerlann.test');
  const a = '3 quai de l’Odet, Quimper';
  assert.equal(Te.lienItineraire(a, { appli: 'systeme', ios: true }), `https://maps.apple.com/?daddr=${encodeURIComponent(a)}`);
  assert.equal(Te.lienItineraire(a, { appli: 'systeme', ios: false }), `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(a)}`);
  assert.equal(Te.lienItineraire(a, { appli: 'waze' }), `https://waze.com/ul?q=${encodeURIComponent(a)}&navigate=yes`);
  assert.equal(Te.lienItineraire('  '), null);
  assert.match(Te.lienRetard('06 12 34 56 78', 15, { ios: true }) ?? '', /^sms:\+33612345678&body=Bonjour/);
  assert.match(Te.lienRetard('06 12 34 56 78', 5, { ios: false }) ?? '', /^sms:\+33612345678\?body=.*5%C2%A0min/);
});

const plan = (): Plan => ({
  debut: '2026-11-09', aujourdhui: '2026-11-10', jours: ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'],
  lignes: [
    { id: 'e1', nom: 'Gwen (démo)', groupe: 'Atelier', cases: { '2026-11-09': 'lieu:l1', '2026-11-10': 'lieu:l1', '2026-11-11': '', '2026-11-12': 'absence:congé', '2026-11-13': 'lieu:l1', '2026-11-14': '', '2026-11-15': '' } },
    { id: 'e2', nom: 'Loïc', groupe: 'Atelier', cases: { '2026-11-09': 'projet:p1', '2026-11-10': 'projet:p1', '2026-11-11': 'projet:p1', '2026-11-12': '', '2026-11-13': '', '2026-11-14': '', '2026-11-15': '' } },
    { id: 'e3', nom: 'Anna', groupe: 'Direction', cases: { '2026-11-09': 'lieu:l1', '2026-11-10': 'absence:maladie', '2026-11-11': '', '2026-11-12': '', '2026-11-13': '', '2026-11-14': '', '2026-11-15': '' } },
  ],
  options: [{ valeur: 'lieu:l1', libelle: 'Atelier', groupe: 'Lieux' }, { valeur: 'projet:p1', libelle: 'Chantier Le Goff', groupe: 'Projets' }, { valeur: 'absence:congé', libelle: 'Congé', groupe: 'Absences' }, { valeur: 'absence:maladie', libelle: 'Maladie', groupe: 'Absences' }, { valeur: '', libelle: 'Non affecté', groupe: 'Autre' }],
  cibles: [{ valeur: 'lieu:l1', id: 'l1', libelle: 'Atelier', famille: 'lieu', besoin: 2 }, { valeur: 'projet:p1', id: 'p1', libelle: 'Chantier Le Goff', famille: 'projet', besoin: null }],
  totaux: { 'lieu:l1': { '2026-11-09': 2, '2026-11-10': 1, '2026-11-11': 0, '2026-11-12': 0, '2026-11-13': 1, '2026-11-14': 0, '2026-11-15': 0 }, 'projet:p1': { '2026-11-09': 1, '2026-11-10': 1, '2026-11-11': 1, '2026-11-12': 0, '2026-11-13': 0, '2026-11-14': 0, '2026-11-15': 0 } },
});

test('planning : jours configurables (samedi et dimanche compris), semaine ISO, vues par lieu et par personne', () => {
  assert.deepEqual([5, 6, 7, '7', 4, 'x', null].map(Pl.nbJoursValide), [5, 6, 7, 7, 5, 5, 5]);
  assert.equal(Pl.semaineIso('2026-11-09'), 46);
  assert.equal(Pl.semaineIso('2026-01-01'), 1);
  assert.equal(Pl.semaineIso('2027-01-01'), 53);
  assert.equal(Pl.decalerSemaine('2026-11-09', -1), '2026-11-02');
  assert.deepEqual(['2026-11-13', '2026-11-14', '2026-11-15'].map(Pl.estWeekEnd), [false, true, true]);
  const L = Pl.parLieu(plan());
  assert.equal(L.jour, '2026-11-10', 'aujourd’hui par défaut');
  assert.deepEqual(L.lieux.map((c) => [c.valeur, c.nb, c.sous]), [['lieu:l1', 1, true], ['projet:p1', 1, false]], 'sous-effectif d’abord');
  assert.deepEqual(L.hors.map((h) => [h.ligne.id, h.libelle]), [['e3', 'Maladie']]);
  const parP = Pl.parPersonne(plan());
  assert.deepEqual(parP.map((g) => g.groupe), ['Atelier', 'Direction']);
  assert.equal(parP[0]?.personnes[0]?.jours.length, 7);
  assert.equal(parP[0]?.personnes[0]?.jours[2]?.libelle, 'Non affecté');
});

test('planning : sélection en rectangle, déplacement au clavier, glisser pour remplir, lot optimiste et son annulation', () => {
  const P = plan();
  const lignes = P.lignes.map((l) => l.id);
  const r = Pl.rectangle(lignes, P.jours, { employe: 'e3', date: '2026-11-11' }, { employe: 'e1', date: '2026-11-09' });
  assert.equal(r.length, 9, '3 personnes × 3 jours, dans n’importe quel sens');
  assert.deepEqual(Pl.caseVoisine(lignes, P.jours, { employe: 'e1', date: '2026-11-09' }, 'ArrowDown'), { employe: 'e2', date: '2026-11-09' });
  assert.deepEqual(Pl.caseVoisine(lignes, P.jours, { employe: 'e1', date: '2026-11-09' }, 'ArrowUp'), { employe: 'e1', date: '2026-11-09' }, 'bord : on reste');
  assert.deepEqual(Pl.caseVoisine(lignes, P.jours, { employe: 'e1', date: '2026-11-09' }, 'End'), { employe: 'e1', date: '2026-11-15' });
  assert.equal(Pl.caseVoisine(lignes, P.jours, { employe: 'e1', date: '2026-11-09' }, 'a'), null);
  // glisser depuis la case de Gwen lundi (Atelier) sur la semaine : seules les cases différentes changent
  const remplir = Pl.lotRemplir(P, { employe: 'e1', date: '2026-11-09' }, Pl.rectangle(lignes, P.jours, { employe: 'e1', date: '2026-11-09' }, { employe: 'e1', date: '2026-11-15' }));
  assert.deepEqual(remplir.map((c) => c.date), ['2026-11-11', '2026-11-12', '2026-11-14', '2026-11-15']);
  assert.ok(remplir.every((c) => c.valeur === 'lieu:l1'));
  const inverse = Pl.lotInverse(P, remplir);
  const Q = Pl.appliquer(P, remplir);
  assert.equal(Q.lignes[0]?.cases['2026-11-12'], 'lieu:l1');
  assert.equal(Q.totaux['lieu:l1']?.['2026-11-11'], 1, 'totaux mis à jour tout de suite');
  assert.equal(P.lignes[0]?.cases['2026-11-12'], 'absence:congé', 'le planning d’origine n’est pas modifié');
  const R = Pl.appliquer(Q, inverse);
  assert.deepEqual(R.lignes[0]?.cases, P.lignes[0]?.cases, 'le lot inverse annule exactement');
  assert.deepEqual(R.totaux, P.totaux);
  assert.deepEqual(Pl.lotPour(P, [{ employe: 'e2', date: '2026-11-09' }, { employe: 'e2', date: '2026-11-12' }], 'projet:p1').map((c) => c.date), ['2026-11-12']);
  assert.equal(espaces(Pl.texteLot(P, [{ employe: 'e1', date: '2026-11-14', valeur: 'lieu:l1' }])), 'Gwen : Atelier, samedi 14 novembre');
  assert.equal(espaces(Pl.texteLot(P, remplir)), '4 cases modifiées');
});
