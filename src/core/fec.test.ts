import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ErreurFec, lireFec, valeursFiche } from './fec.ts';

const ENTETE = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib', 'PieceRef', 'PieceDate', 'EcritureLib', 'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate', 'Montantdevise', 'Idevise'];
const ligne = (j: string, d: string, compte: string, debit: string, credit: string) => [j, j, '1', d, compte, 'x', '', '', 'P1', d, 'libellé', debit, credit, '', '', d, '', ''];

/** Petit exercice complet : 12 mois, CA 120 000, achats 48 000, salaires 36 000, loyer 12 000, dotations 6 000. */
function exercice(sep = '\t') {
  const l = [
    ligne('AN', '20250101', '512000', '20000,00', ''), // à-nouveau : banque
    ligne('AN', '20250101', '101300', '', '10000,00'), // capital
    ligne('AN', '20250101', '110000', '', '5000,00'), // report à nouveau
    ligne('AN', '20250101', '164000', '', '5000,00'), // emprunt
    ligne('VT', '20250115', '411CLI', '144000,00', ''), // ventes TTC
    ligne('VT', '20250115', '706000', '', '120000,00'),
    ligne('VT', '20250115', '445710', '', '24000,00'),
    ligne('BQ', '20251120', '512000', '120000,00', ''), // encaissement partiel
    ligne('BQ', '20251120', '411CLI', '', '120000,00'),
    ligne('AC', '20250210', '607000', '48000,00', ''),
    ligne('AC', '20250210', '401FOU', '', '48000,00'),
    ligne('BQ', '20250310', '401FOU', '40000,00', ''),
    ligne('BQ', '20250310', '512000', '', '40000,00'),
    ligne('OD', '20251231', '641000', '36000,00', ''),
    ligne('OD', '20251231', '512000', '', '36000,00'),
    ligne('OD', '20251231', '613200', '12000,00', ''),
    ligne('OD', '20251231', '512000', '', '12000,00'),
    ligne('OD', '20251231', '681100', '6000,00', ''),
    ligne('OD', '20251231', '281500', '', '6000,00'),
  ];
  return [ENTETE, ...l].map((x) => x.join(sep)).join('\r\n');
}

test('FEC : totaux du plan comptable, période donnée par les à-nouveaux et les écritures', () => {
  const s = lireFec(exercice());
  assert.equal(s.debut, '2025-01-01', 'début d’exercice donné par les à-nouveaux');
  assert.equal(s.fin, '2025-12-31');
  assert.equal(s.mois, 12);
  assert.equal(s.lignes, 19);
  assert.equal(s.chiffreAffaires, 120_000);
  assert.equal(s.achatsConsommes, 48_000);
  assert.equal(s.chargesDecaissables, 96_000, 'classe 6 hors dotations');
  assert.equal(s.masseSalariale, 36_000);
  assert.equal(s.resultat, 120_000 - 48_000 - 36_000 - 12_000 - 6_000);
  assert.equal(s.tresorerie, 20_000 + 120_000 - 40_000 - 36_000 - 12_000);
  assert.equal(s.creancesClients, 24_000);
  assert.equal(s.dettesFournisseurs, 8_000);
  assert.equal(s.dettesFinancieres, 5_000);
  assert.equal(s.capitauxPropres, 15_000 + 18_000);
  const v = valeursFiche(s);
  assert.equal(v.marge_brute, 60);
  assert.equal(v.charges_mensuelles, 8_000);
  assert.equal(v.chiffre_affaires_annuel, 120_000);
  assert.equal(v.resultat_net, 18_000);
  assert.equal(v.comptabilite_au, '2025-12-31');
});

test('FEC : séparateur « | », variante Montant/Sens, encodage BOM, en-têtes en casse libre', () => {
  const pipe = `﻿${exercice('|')}`;
  assert.equal(lireFec(pipe).chiffreAffaires, 120_000);
  const sens = [
    'journalcode\tecrituredate\tcomptenum\tmontant\tsens',
    'VT\t20260101\t706000\t1 500,50\tC',
    'VT\t20260101\t411000\t1500,50\tD',
    'AC\t20260331\t607000\t400\tD',
    'AC\t20260331\t401000\t400\tC',
  ].join('\n');
  const s = lireFec(sens);
  assert.equal(s.chiffreAffaires, 1500.5);
  assert.equal(s.mois, 3, 'janvier à mars');
  assert.equal(valeursFiche(s).chiffre_affaires_annuel, Math.round(1500.5 * 4), 'ramené à l’année');
});

test('FEC : fichiers refusés avec un message clair', () => {
  assert.throws(() => lireFec(''), ErreurFec);
  assert.throws(() => lireFec('Nom,Ville\nA,B'), /pas un FEC/);
  assert.throws(() => lireFec('Nom\tVille\nA\tB'), /Colonnes du FEC introuvables/);
  assert.throws(() => lireFec(`${ENTETE.join('\t')}\n${ligne('VT', '20250101', '706000', 'abc', '').join('\t')}`), /Montant illisible/);
});
