/**
 * Ce qu'on écrit au robot : module pur, aucune connaissance de Telegram ni du monde.
 * Ce qui compte ici : une phrase qu'on ne comprend pas n'écrit RIEN, et une date qu'on ne lit pas n'est pas inventée.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AIDE_TEXTE, comprendre, MAX, quandDuTexte } from './telegram-commandes.ts';

// un mercredi, pour que « lundi » et « vendredi » tombent de part et d'autre
const MERCREDI = new Date(2026, 10, 18, 10, 0, 0);

test('demander : les formes courtes qu’on tape vraiment', () => {
  for (const q of ['?', '??', 'quoi de neuf', 'Aujourd’hui ?', 'alors', 'où en suis-je', 'ça donne quoi', 'résumé', 'point']) {
    assert.equal(comprendre(q, MERCREDI).genre, 'resume', q);
  }
});

test('aide : au premier contact, et quand on ne comprend pas', () => {
  for (const q of ['/start', 'aide', 'help', 'comment', 'tu sais faire quoi']) assert.equal(comprendre(q, MERCREDI).genre, 'aide', q);
  assert.equal(comprendre('', MERCREDI).genre, 'aide');
  assert.equal(comprendre(null, MERCREDI).genre, 'aide');
  assert.equal(comprendre('ok', MERCREDI).genre, 'aide', 'un mot seul n’est pas une consigne');
  assert.equal(comprendre('👍', MERCREDI).genre, 'aide');
  assert.match(AIDE_TEXTE, /rappeler Dupont lundi/);
});

test('tâche : annoncée ou nue, avec sa date si elle est écrite', () => {
  const a = comprendre('tâche : rappeler Dupont', MERCREDI);
  assert.deepEqual(a, { genre: 'tache', titre: 'rappeler Dupont', quand: null });
  assert.deepEqual(comprendre('tache rappeler Dupont', MERCREDI), a, 'sans accent et sans deux-points');
  assert.deepEqual(comprendre('à faire : rappeler Dupont', MERCREDI), a);
  assert.deepEqual(comprendre('penser à rappeler Dupont', MERCREDI), a);
  // une phrase nue est une tâche : neuf fois sur dix, écrire à son robot c'est se noter quelque chose
  assert.deepEqual(comprendre('rappeler Dupont', MERCREDI), a);
  // la date écrite dans la phrase devient l'échéance, et reste dans le titre (on ne charcute pas ce qui est écrit)
  const b = comprendre('rappeler Dupont lundi', MERCREDI);
  assert.equal(b.genre, 'tache');
  assert.equal(b.genre === 'tache' && b.quand, '2026-11-23');
  assert.equal(b.genre === 'tache' && b.titre, 'rappeler Dupont lundi');
});

test('note : le client avant les deux points, ce qui s’est dit après', () => {
  assert.deepEqual(comprendre('note Boulangerie Exemple : ils veulent un devis', MERCREDI),
    { genre: 'note', qui: 'Boulangerie Exemple', texte: 'ils veulent un devis' });
  assert.deepEqual(comprendre('cr Ty Coz: relance la semaine prochaine', MERCREDI),
    { genre: 'note', qui: 'Ty Coz', texte: 'relance la semaine prochaine' });
  // sans nom, la note existe quand même : elle sera rattachée à la main
  assert.deepEqual(comprendre('note rien de neuf côté chantier', MERCREDI),
    { genre: 'note', qui: null, texte: 'rien de neuf côté chantier' });
  assert.equal(comprendre('note', MERCREDI).genre, 'aide', 'un mot-clé seul ne crée rien');
});

test('les dates qu’on écrit, et seulement celles-là', () => {
  assert.equal(quandDuTexte('rappeler demain', MERCREDI), '2026-11-19');
  assert.equal(quandDuTexte('rappeler aujourd’hui', MERCREDI), '2026-11-18');
  assert.equal(quandDuTexte('après-demain', MERCREDI), '2026-11-20');
  assert.equal(quandDuTexte('vendredi', MERCREDI), '2026-11-20', 'le vendredi qui vient');
  assert.equal(quandDuTexte('lundi', MERCREDI), '2026-11-23', 'le lundi prochain, pas celui qui est passé');
  assert.equal(quandDuTexte('mercredi', MERCREDI), '2026-11-25', 'un mercredi, « mercredi » c’est le suivant');
  assert.equal(quandDuTexte('le 24/12', MERCREDI), '2026-12-24');
  assert.equal(quandDuTexte('le 3/1', MERCREDI), '2027-01-03', 'une date déjà passée désigne l’an prochain');
  assert.equal(quandDuTexte('le 24/12/2027', MERCREDI), '2027-12-24');
  // rien d'écrit : rien d'inventé. Une tâche sans échéance ne sonnera pas pour rien
  assert.equal(quandDuTexte('rappeler Dupont', MERCREDI), null);
  assert.equal(quandDuTexte('le 32/13', MERCREDI), null);
});

test('un pavé collé n’est pas une consigne : il est borné, jamais refusé', () => {
  const r = comprendre(`tâche : ${'a'.repeat(5000)}`, MERCREDI);
  assert.equal(r.genre, 'tache');
  assert.ok(r.genre === 'tache' && r.titre.length <= MAX);
});
