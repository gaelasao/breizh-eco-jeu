/** Typographie française (direction de design §8.3) : web/bz/typo.js, appliqué par h() à tous les textes. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Typo = {
  typo: (t: unknown) => unknown;
  pluriel: (n: number, un: string, plusieurs: string, o?: { zero?: string }) => string;
  accord: (n: number, un: string, plusieurs: string) => string;
  nombre: (n: number) => string;
  euros: (n: number, o?: { arrondi?: boolean }) => string;
  pourcentage: (n: number, o?: { signe?: boolean }) => string;
  dateRelative: (d: Date | string, maintenant?: Date) => string;
  casseTitre: (n: string) => string;
  FINE: string;
  INSECABLE: string;
};
const m = (await import(new URL('../../web/bz/typo.js', import.meta.url).href)) as Typo;
const { typo, pluriel, accord, nombre, euros, pourcentage, dateRelative, casseTitre } = m;
const F = ' ';
const N = ' ';
// Les sorties d'Intl peuvent changer d'espace (U+00A0 / U+202F) selon la version d'ICU : on normalise pour comparer.
const esp = (t: string) => t.replace(/[  ]/g, ' ');

test('typo() : ponctuation haute, deux-points, guillemets, apostrophe, points de suspension', () => {
  assert.equal(typo('Kenavo !'), `Kenavo${F}!`);
  assert.equal(typo('Vraiment ?'), `Vraiment${F}?`);
  assert.equal(typo('un ; deux'), `un${F}; deux`);
  assert.equal(typo('Note : texte'), `Note${N}: texte`);
  assert.equal(typo('Adresse :'), `Adresse${N}:`);
  assert.equal(typo('« Ouvrir au bureau »'), `«${F}Ouvrir au bureau${F}»`);
  assert.equal(typo('l\'entreprise d\'Armor'), 'l’entreprise d’Armor');
  assert.equal(typo('Chargement...'), 'Chargement…');
});

test('typo() : ne touche ni aux adresses, ni aux heures en grille, ni au code', () => {
  assert.equal(typo('https://exemple.fr/?a=1'), 'https://exemple.fr/?a=1');
  assert.equal(typo('14:30'), '14:30');
  assert.equal(typo('Rendez-vous à 14:30.'), 'Rendez-vous à 14:30.');
  assert.equal(typo('mael@kerlann.example'), 'mael@kerlann.example');
  assert.equal(typo('x'), 'x');
  assert.equal(typo(''), '');
  assert.equal(typo(42), 42);
  assert.equal(typo(null), null);
});

test('typo() : nombres, unités, heures et milliers insécables', () => {
  assert.equal(typo('14 h 30'), `14${N}h${N}30`);
  assert.equal(typo('29 € HT'), `29${N}€${N}HT`);
  assert.equal(typo('12 km et 3 h'), `12${N}km et 3${N}h`);
  assert.equal(typo('1 000 à 1 999 salariés'), `1${F}000 à 1${F}999${N}salariés`);
  assert.equal(typo('2 000 clients'), `2${F}000 clients`);
  assert.equal(typo('3 heures'), '3 heures', 'pas « h » au milieu d’un mot');
  assert.equal(typo('02 98 12 34 56'), '02 98 12 34 56', 'numéro de téléphone : paires intactes');
});

test('typo() est idempotente', () => {
  for (const t of ['Kenavo !', 'Note : texte', '« Ouvrir au bureau »', '14 h 30', '29 € HT', '1 000 à 1 999 salariés', 'l\'équipe...', 'https://exemple.fr', 'Pas de connexion : réessayez ?']) {
    const une = typo(t);
    assert.equal(typo(une), une, t);
  }
});

test('pluriel() et accord() : 0 et 1 au singulier, nombre formaté, variante « zéro »', () => {
  assert.equal(pluriel(0, 'chose à régler', 'choses à régler'), `0${N}chose à régler`);
  assert.equal(pluriel(1, 'chose à régler', 'choses à régler'), `1${N}chose à régler`);
  assert.equal(pluriel(3, 'chose à régler', 'choses à régler'), `3${N}choses à régler`);
  assert.equal(esp(pluriel(1240, 'client', 'clients')), '1 240 clients');
  assert.equal(pluriel(0, 'chose', 'choses', { zero: 'Rien à régler' }), 'Rien à régler');
  assert.equal(pluriel(2, 'chose', 'choses', { zero: 'Rien à régler' }), `2${N}choses`);
  assert.equal(accord(1, 'la', 'les'), 'la');
  assert.equal(accord(4, 'la', 'les'), 'les');
});

test('nombres, montants et pourcentages à la française (Intl)', () => {
  assert.equal(esp(nombre(18420)), '18 420');
  assert.equal(esp(nombre(1240.5)), '1 240,5');
  assert.equal(esp(euros(1240.5)), '1 240,50 €');
  assert.equal(esp(euros(18420, { arrondi: true })), '18 420 €');
  assert.equal(esp(pourcentage(0.12)), '12 %');
  assert.equal(esp(pourcentage(0.12, { signe: true })), '+12 %');
});

test('dateRelative() : relative jusqu’à 7 jours, absolue ensuite', () => {
  const maintenant = new Date('2026-11-10T10:00:00');
  assert.equal(dateRelative(new Date('2026-11-10T09:59:40'), maintenant), 'à l’instant');
  assert.equal(dateRelative(new Date('2026-11-10T08:00:00'), maintenant), 'il y a 2 heures');
  assert.equal(dateRelative(new Date('2026-11-09T10:00:00'), maintenant), 'hier');
  assert.equal(dateRelative(new Date('2026-11-07T10:00:00'), maintenant), 'il y a 3 jours');
  assert.equal(dateRelative(new Date('2026-11-11T10:00:00'), maintenant), 'demain');
  assert.equal(dateRelative(new Date('2026-10-12T10:00:00'), maintenant), '12 octobre');
  assert.equal(dateRelative(new Date('2025-10-12T10:00:00'), maintenant), '12 octobre 2025');
  assert.equal(dateRelative('pas une date', maintenant), '—');
});

test('casseTitre() : raisons sociales SIRENE en casse de titre, formes juridiques en capitales', () => {
  assert.equal(casseTitre('KERLANN BOIS SARL'), 'Kerlann Bois SARL');
  assert.equal(casseTitre('BOULANGERIE D\'ARMOR SAS'), 'Boulangerie d\'Armor SAS');
  assert.equal(casseTitre('LES ATELIERS DE LA RANCE'), 'Les Ateliers de la Rance');
  assert.equal(casseTitre('Déjà en Casse Mixte'), 'Déjà en Casse Mixte');
});
