/**
 * Compte rendu de rendez-vous : ce qui est lu dans un texte collé, et ce qui ne l'est pas.
 * Module pur, aucun appel réseau, aucun modèle de langage — un texte qu'on ne comprend pas reste un compte rendu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type CompteRendu = { titre: string; date: string; heure: string; minutes: number; participants: string[]; actions: string[]; texte: string };
type Module = {
  dateDuTexte: (ligne: string, aujourdhui?: Date) => string;
  heureDuTexte: (ligne: string) => string;
  dureeDuTexte: (ligne: string) => number;
  noms: (liste: string) => string[];
  lireCompteRendu: (brut: unknown, aujourdhui?: Date) => CompteRendu;
  rendezVousDuCompteRendu: (cr: CompteRendu, aujourdhui?: Date) => { nom: string; champs: Record<string, string> };
  clientProbable: <T extends { id: string; nom: string }>(cr: CompteRendu, clients: readonly T[]) => T | null;
};
const { clientProbable, dateDuTexte, dureeDuTexte, heureDuTexte, lireCompteRendu, noms, rendezVousDuCompteRendu } =
  (await import(new URL('../../web/compte-rendu.js', import.meta.url).href)) as Module;

const LE_17 = new Date('2026-11-17T09:00:00Z');

test('dates : les formes que les gens et les outils écrivent', () => {
  assert.equal(dateDuTexte('2026-11-17', LE_17), '2026-11-17');
  assert.equal(dateDuTexte('17 novembre 2026', LE_17), '2026-11-17');
  assert.equal(dateDuTexte('17 nov. 2026 · 45 min', LE_17), '2026-11-17');
  assert.equal(dateDuTexte('1er décembre 2026', LE_17), '2026-12-01');
  assert.equal(dateDuTexte('November 17, 2026', LE_17), '2026-11-17');
  assert.equal(dateDuTexte('17/11/2026', LE_17), '2026-11-17');
  assert.equal(dateDuTexte('17.11.26', LE_17), '2026-11-17');
  // jour d'abord : on écrit en français, 03/04 est le 3 avril
  assert.equal(dateDuTexte('03/04/2026', LE_17), '2026-04-03');
  // sans année : celle d'aujourd'hui
  assert.equal(dateDuTexte('17 novembre', LE_17), '2026-11-17');
  // rien de sûr : rien. Jamais de date inventée
  assert.equal(dateDuTexte('réunion de suivi', LE_17), '');
  assert.equal(dateDuTexte('', LE_17), '');
  assert.equal(dateDuTexte('32/13/2026', LE_17), '');
});

test('heures et durées', () => {
  assert.equal(heureDuTexte('14:00 - 14:45'), '14:00');
  assert.equal(heureDuTexte('14 h 30'), '14:30');
  assert.equal(heureDuTexte('2:00 PM'), '14:00');
  assert.equal(heureDuTexte('9 AM'), '09:00');
  assert.equal(heureDuTexte('pas d’heure'), '');
  assert.equal(dureeDuTexte('45 min'), 45);
  assert.equal(dureeDuTexte('1 h 30'), 90);
  assert.equal(dureeDuTexte('Durée : 1h'), 60);
  assert.equal(dureeDuTexte('rien'), 0);
});

test('participants : virgules, « et », parenthèses et adresses retirées', () => {
  assert.deepEqual(noms('Anna Le Goff, Gaël Gérard et Yann Tanguy'), ['Anna Le Goff', 'Gaël Gérard', 'Yann Tanguy']);
  assert.deepEqual(noms('Anna Le Goff (Kerlann) · Gaël <gael@exemple.fr>'), ['Anna Le Goff', 'Gaël']);
  assert.deepEqual(noms('Anna, Anna, Anna'), ['Anna'], 'une personne n’est comptée qu’une fois');
});

const FATHOM = `Point mensuel — Boulangerie Exemple
17 novembre 2026 · 14:00 · 45 min
Participants : Anna Le Goff, Gaël Gérard

OBJECTIF DE LA RÉUNION
Faire le point sur les livraisons du trimestre.

POINTS CLÉS
- Les retards de novembre viennent du fournisseur de farine.
- Le volume de commandes augmente de 12 %.

PROCHAINES ÉTAPES
- Gaël : envoyer la proposition révisée avant vendredi
- Anna : valider le budget avec son associé
- [ ] Reprogrammer un point dans trois semaines

NOTES
Rien d’autre à signaler.`;

test('Fathom : titre, date, heure, durée, participants et prochaines étapes', () => {
  const cr = lireCompteRendu(FATHOM, LE_17);
  assert.equal(cr.titre, 'Point mensuel — Boulangerie Exemple');
  assert.equal(cr.date, '2026-11-17');
  assert.equal(cr.heure, '14:00');
  assert.equal(cr.minutes, 45);
  assert.deepEqual(cr.participants, ['Anna Le Goff', 'Gaël Gérard']);
  assert.deepEqual(cr.actions, [
    'Gaël : envoyer la proposition révisée avant vendredi',
    'Anna : valider le budget avec son associé',
    'Reprogrammer un point dans trois semaines',
  ]);
  // la section s'arrête à l'intertitre suivant : « Rien d'autre à signaler » n'est pas une action
  assert.ok(!cr.actions.some((a) => /signaler/.test(a)));
  // le texte collé reste le compte rendu, mot pour mot
  assert.ok(cr.texte.includes('OBJECTIF DE LA RÉUNION'));
  assert.ok(cr.texte.includes('Les retards de novembre'));
});

test('anglais : Next steps / Action items lus aussi', () => {
  const cr = lireCompteRendu(['Quarterly review with Ty Coz', 'November 17, 2026', 'Attendees: Anna Le Goff, Gael', '', 'Action items', '* Send the revised quote', '1. Book the next call', '', 'Recap', 'Nothing else.'].join('\n'), LE_17);
  assert.equal(cr.date, '2026-11-17');
  assert.deepEqual(cr.participants, ['Anna Le Goff', 'Gael']);
  assert.deepEqual(cr.actions, ['Send the revised quote', 'Book the next call']);
});

test('notes écrites à la main : ça reste un compte rendu, sans rien inventer', () => {
  const cr = lireCompteRendu('Café avec Yann, il veut un devis pour la rénovation.', LE_17);
  assert.equal(cr.titre, 'Café avec Yann, il veut un devis pour la rénovation.');
  assert.equal(cr.date, '', 'aucune date dans le texte : aucune date rendue');
  assert.deepEqual(cr.actions, []);
  assert.deepEqual(cr.participants, []);
  assert.equal(lireCompteRendu('', LE_17).texte, '');
  assert.equal(lireCompteRendu(null, LE_17).titre, '');
  // un texte énorme est borné, jamais refusé
  assert.equal(lireCompteRendu('a'.repeat(50_000), LE_17).texte.length, 20_000);
});

test('une ligne qui n’est QUE la date ne devient pas le titre', () => {
  const cr = lireCompteRendu(['17 novembre 2026', 'Atelier de cadrage', 'Participants : Anna'].join('\n'), LE_17);
  assert.equal(cr.titre, 'Atelier de cadrage');
  assert.equal(cr.date, '2026-11-17');
});

test('le rendez-vous qui en sort : début, fin, suite, et le texte entier', () => {
  const rv = rendezVousDuCompteRendu(lireCompteRendu(FATHOM, LE_17), LE_17);
  assert.equal(rv.nom, 'Point mensuel — Boulangerie Exemple');
  assert.equal(rv.champs.debut, '2026-11-17T14:00');
  assert.equal(rv.champs.fin, '2026-11-17T14:45');
  assert.equal(rv.champs.etat, 'confirmé');
  assert.ok(String(rv.champs.compte_rendu).includes('POINTS CLÉS'));
  assert.match(String(rv.champs.suite), /^Gaël : envoyer la proposition révisée avant vendredi · /);
  // sans date écrite, c'est aujourd'hui — et c'est montré avant d'enregistrer
  const sansDate = rendezVousDuCompteRendu(lireCompteRendu('Café avec Yann', LE_17), LE_17);
  assert.equal(sansDate.champs.debut, '2026-11-17');
  assert.equal(sansDate.champs.fin, undefined);
  assert.equal(sansDate.champs.suite, undefined);
});

test('client probable : un seul candidat, sinon aucun', () => {
  const clients = [{ id: 'c1', nom: 'Boulangerie Exemple' }, { id: 'c2', nom: 'Restaurant Ty Coz' }, { id: 'c3', nom: 'Camping Les Dunes' }];
  assert.equal(clientProbable(lireCompteRendu(FATHOM, LE_17), clients)?.id, 'c1');
  // la forme juridique ne gêne pas : « Ty Coz SARL » se reconnaît dans « Point avec Ty Coz »
  assert.equal(clientProbable(lireCompteRendu('Point avec Ty Coz', LE_17), [{ id: 'c9', nom: 'Ty Coz SARL' }])?.id, 'c9');
  // deux candidats cités : on ne tranche pas à la place de la personne
  assert.equal(clientProbable(lireCompteRendu('Boulangerie Exemple et Camping Les Dunes', LE_17), clients), null);
  assert.equal(clientProbable(lireCompteRendu('Réunion interne', LE_17), clients), null);
  assert.equal(clientProbable(lireCompteRendu('Point', LE_17), []), null);
});
