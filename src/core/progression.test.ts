/**
 * Progression (direction de design §4.25, §5.9, §6.1 P10) : l'XP ne vient que d'une quête vue ouverte puis achevée
 * sur une donnée à jour ; une même quête une fois par jour ; jamais d'exemple compté pour une vraie entreprise ;
 * 10 niveaux du port ; trophées datés avec leur preuve.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireReussites, niveauPour, NIVEAUX, nouvellesReussites, progression, RECOMPENSE, trophees, type Reussite } from './progression.ts';
import type { Quete } from './quetes.ts';

const quete = (id: string, statut: 'ouverte' | 'achevee', o: Partial<Quete> = {}): Quete => ({
  id, titre: `Stock — ${id}`, objectif: '', origine: { regle: 'stock_minimum', objetId: id }, actionProposee: 'mouvement', statut,
  gravite: 'attention', creeLe: '2026-11-10T08:00:00.000Z', acheveeLe: statut === 'achevee' ? '2026-11-10T09:00:00.000Z' : null,
  preuve: statut === 'achevee' ? { valeur: 30, seuil: 20, observeLe: '2026-11-10T09:00:00.000Z' } : null, ...o,
});
const carte = (...q: Quete[]) => new Map(q.map((x) => [x.id, x]));
const reussite = (n: number, o: Partial<Reussite> = {}): Reussite => ({
  id: `q${n}@2026-11-${String(n % 28 + 1).padStart(2, '0')}`, quete: `q${n}`, regle: 'stock_minimum', objetId: `o${n}`, nom: `Article ${n}`, titre: '', gravite: 'attention',
  xp: 40, le: `2026-11-${String(n % 28 + 1).padStart(2, '0')}T10:00:00.000Z`, preuve: { valeur: 1, seuil: 0, observeLe: null }, exemple: false, ...o,
});

test('XP : seulement une quête vue ouverte puis achevée, avec sa preuve ; récompense selon la gravité', () => {
  const avant = carte(quete('a', 'ouverte'), quete('b', 'ouverte', { gravite: 'critique' }), quete('c', 'ouverte'));
  const apres = carte(quete('a', 'achevee'), quete('b', 'achevee', { gravite: 'critique' }), quete('c', 'ouverte'), quete('d', 'achevee'));
  const r = nouvellesReussites(avant, apres, [], () => false, (id) => `Objet ${id}`);
  assert.deepEqual(r.map((x) => [x.quete, x.xp]), [['a', RECOMPENSE.attention], ['b', RECOMPENSE.critique]], 'd jamais vue ouverte : aucun point');
  assert.equal(r[0]?.id, 'a@2026-11-10');
  assert.equal(r[0]?.nom, 'Objet a');
  assert.deepEqual(r[0]?.preuve, { valeur: 30, seuil: 20, observeLe: '2026-11-10T09:00:00.000Z' });
  assert.deepEqual(nouvellesReussites(carte(), apres, [], () => false, () => ''), [], 'redémarrage ou import : rien n’a été fait');
});

test('une même quête ne rapporte qu’une fois par jour ; les réussites d’exemple sont marquées', () => {
  const avant = carte(quete('a', 'ouverte'));
  const apres = carte(quete('a', 'achevee'));
  const premiere = nouvellesReussites(avant, apres, [], (id) => id === 'a', () => '');
  assert.equal(premiere.length, 1);
  assert.equal(premiere[0]?.exemple, true);
  assert.deepEqual(nouvellesReussites(avant, apres, premiere, () => false, () => ''), [], 'déjà comptée aujourd’hui');
  const lendemain = carte(quete('a', 'achevee', { acheveeLe: '2026-11-11T09:00:00.000Z' }));
  assert.equal(nouvellesReussites(avant, lendemain, premiere, () => false, () => '').length, 1, 'un autre jour, de nouveau');
});

test('niveaux du port : 10 paliers croissants, du « Cale » au « Port de commerce »', () => {
  assert.equal(NIVEAUX.length, 10);
  assert.deepEqual(NIVEAUX.map((n) => n.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (let i = 1; i < NIVEAUX.length; i++) assert.ok((NIVEAUX[i]?.xp ?? 0) > (NIVEAUX[i - 1]?.xp ?? 0));
  assert.equal(NIVEAUX[3]?.nom, 'Port de pêche');
  assert.equal(niveauPour(0).nom, 'Cale');
  assert.equal(niveauPour(449).n, 3);
  assert.equal(niveauPour(450).n, 4);
  assert.equal(niveauPour(1e9).nom, 'Port de commerce');
});

test('progression : total, niveau, reste avant le suivant ; jamais d’exemple compté pour une vraie entreprise', () => {
  const vraies = Array.from({ length: 12 }, (_, i) => reussite(i));
  const exemple = reussite(99, { exemple: true, xp: 60, gravite: 'critique' });
  const p = progression([...vraies, exemple]);
  assert.equal(p.xp, 12 * 40);
  assert.equal(p.niveau.nom, 'Port de pêche');
  assert.equal(p.suivant?.n, 5);
  assert.equal(p.suivant?.reste, 700 - 480);
  assert.ok(p.avancement > 0 && p.avancement < 1);
  assert.equal(p.reussites.length, 12, 'l’exemple ne compte pas');
  const ex = progression([...vraies, exemple], { exemple: true });
  assert.equal(ex.xp, 60);
  assert.equal(ex.exemple, true);
  assert.equal(progression([]).xp, 0);
  assert.equal(progression([]).niveau.n, 1);
  const max = progression(Array.from({ length: 100 }, (_, i) => reussite(i, { gravite: 'critique', xp: 60, id: `x${i}` })));
  assert.equal(max.suivant, null);
  assert.equal(max.avancement, 1);
});

test('trophées : datés par la réussite qui les débloque, avec leur preuve et leur avancement', () => {
  const r = [reussite(1), reussite(2, { regle: 'retard_paiement' }), reussite(3, { gravite: 'critique', xp: 60 }), reussite(4, { regle: 'avis_bas' })];
  const t = Object.fromEntries(trophees(r).map((x) => [x.id, x]));
  assert.equal(t['premiere-quete']?.le, r[0]?.le);
  assert.deepEqual(t['premiere-quete']?.preuves, [r[0]?.id]);
  assert.equal(t['cinq-quetes']?.le, null);
  assert.equal(t['cinq-quetes']?.avance, 4);
  assert.equal(t['urgence-reglee']?.le, r[2]?.le);
  assert.equal(t['tour-du-port']?.le, r[3]?.le, 'trois règles différentes');
  assert.ok(!trophees(r).some((x) => /connexion|jour/i.test(x.id)), 'aucun trophée de simple connexion');
});

test('lecture de l’état enregistré : tolérante, sans doublon, l’XP recalculée depuis la gravité', () => {
  const l = lireReussites([reussite(1, { xp: 9999 }), reussite(1), null, { id: 'x' }, { ...reussite(2), le: 'pas une date' }, reussite(3, { gravite: 'critique' })]);
  assert.deepEqual(l.map((x) => x.xp), [40, 60], 'XP jamais lue telle quelle');
  assert.deepEqual(lireReussites('rien'), []);
});
