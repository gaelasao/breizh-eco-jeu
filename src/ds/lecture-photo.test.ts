/**
 * Lire les trois champs sur la photo d'un justificatif — l'analyseur PUR `web/lecture-photo.js`.
 * Il ne voit jamais d'image : il reçoit le texte qu'un moteur de lecture a trouvé, ligne par ligne, avec la confiance
 * de chaque ligne. Tout est donc vérifiable ici, sans navigateur et sans moteur.
 *
 * Ce que ces essais tiennent, et qui compte plus que le taux de réussite : **jamais faux en silence**. Un montant
 * ambigu, une date impossible, un en-tête illisible laissent le champ VIDE. Un champ vide se tape en trois secondes ;
 * un montant faux part chez le comptable.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');

interface Champ { valeur: unknown; confiance: number; indice: string; silence: string }
interface Lu {
  montant: number | null; date: string | null; fournisseur: string;
  confiance: { montant: number; date: number; fournisseur: number };
  indice: { montant: string; date: string; fournisseur: string };
  silence: { montant: string; date: string; fournisseur: string };
  rien: boolean; lignes: number;
}
type Ligne = { texte: string; confiance?: number };
const L = (await import(new URL('../../web/lecture-photo.js', import.meta.url).href)) as {
  CONFIANCE_LIGNE_MIN: number;
  SEUILS: { montant: number; date: number; fournisseur: number };
  MONTANT_MAX: number;
  ANS_MAX: number;
  LIGNES_ENTETE: number;
  lignesDuTexte: (e: unknown) => Array<{ texte: string; confiance: number; repare: boolean; rang: number }>;
  montantSurLaPhoto: (l: unknown[]) => Champ;
  dateSurLaPhoto: (l: unknown[], o?: { aujourdhui?: string }) => Champ;
  fournisseurSurLaPhoto: (l: unknown[], o?: { fournisseursConnus?: readonly string[] }) => Champ;
  jourValide: (a: number, m: number, j: number) => string | null;
  nomAplati: (t: string) => string;
  lireLaPhoto: (e: unknown, o?: { aujourdhui?: string; fournisseursConnus?: readonly string[] }) => Lu;
  direCeQuiEstLu: (lu: unknown) => string;
  RIEN_LU: string;
};

/** Le texte d'un ticket, toutes les lignes sûres (une photo nette). */
const net = (texte: string) => L.lireLaPhoto(texte, { aujourdhui: '2026-11-16' });
/** Le même, avec une confiance par ligne : c'est ce que donne le moteur sur une vraie photo. */
const avec = (lignes: Ligne[], o: { aujourdhui?: string; fournisseursConnus?: readonly string[] } = {}) =>
  L.lireLaPhoto({ lignes }, { aujourdhui: '2026-11-16', ...o });

const TICKET = [
  'BRICO KERLANN',
  '12 rue du Phare - 29000 Quimper',
  'Tel 02 98 00 00 00',
  'TICKET DE CAISSE',
  'Date 14/11/2026 15:42',
  'Vis inox 5x60 x200      18,40',
  'Silicone sanitaire        7,95',
  'TOTAL HT                 21,96',
  'TVA 20,00%                4,39',
  'TOTAL TTC                26,35',
  'CB                       26,35',
  'MERCI DE VOTRE VISITE',
].join('\n');

// ---------------------------------------------------------------- le montant

test('montant : trouvé près de « TOTAL TTC », jamais le total HT ni la TVA', () => {
  const lu = net(TICKET);
  assert.equal(lu.montant, 26.35, 'le TTC, pas le HT');
  assert.equal(lu.indice.montant, 'TOTAL TTC');
  assert.ok(lu.confiance.montant >= L.SEUILS.montant);
  assert.equal(lu.silence.montant, '');
});

test('montant : « NET À PAYER » passe devant « TOTAL », et les formats français sont lus', () => {
  assert.equal(net('TOTAL TTC 120,00\nREMISE 20,00\nNET A PAYER 100,00').montant, 100);
  assert.equal(net('NET À PAYER 1 234,56').montant, 1234.56, 'milliers séparés par une espace');
  assert.equal(net('TOTAL TTC 1.234,56 EUR').montant, 1234.56, 'milliers séparés par un point');
  assert.equal(net('TOTAL TTC 47,90 €').montant, 47.9);
  assert.equal(net('TOTAL TTC 47.90').montant, 47.9, 'certaines caisses impriment un point décimal');
  assert.equal(net('MONTANT TTC   8,05').montant, 8.05);
  assert.equal(net('Total à payer : 9,99').montant, 9.99);
});

test('montant : la ligne est alignée à droite, le dernier nombre est le total', () => {
  assert.equal(net('TOTAL TTC (TVA 20,00%)      59,88').montant, 59.88);
  // le total sur une ligne, sa valeur sur la suivante : le moteur coupe parfois une colonne
  assert.equal(net('TOTAL TTC\n26,35').montant, 26.35);
});

test('montant ambigu : deux totaux qui ne disent pas la même somme → champ VIDE, et on dit pourquoi', () => {
  const lu = net('TOTAL TTC 26,35\nTOTAL TTC 62,35');
  assert.equal(lu.montant, null);
  assert.match(lu.silence.montant, /Plusieurs totaux différents/);
  assert.doesNotMatch(lu.silence.montant, /confiance|score|OCR/i, 'dit sans jargon');
});

test('montant sans mot qui l’annonce : rien n’est proposé (un nombre pris au hasard serait une erreur de compta)', () => {
  const lu = net('BRICO KERLANN\nVis inox 18,40\nSilicone 7,95\nCB 26,35');
  assert.equal(lu.montant, null);
  assert.match(lu.silence.montant, /n’a pas été trouvé sur la photo/);
});

test('montant : ni le total HT seul, ni la TVA, ni les espèces rendues ne sont proposés', () => {
  assert.equal(net('TOTAL HT 21,96\nTVA 20,00% 4,39').montant, null, 'sans TTC on ne calcule rien');
  assert.equal(net('ESPECES 50,00\nRENDU 23,65').montant, null);
  assert.equal(net('SOUS-TOTAL 26,35').montant, null);
  assert.equal(net('ACOMPTE 500,00').montant, null);
});

test('montant : lettres confondues avec des chiffres réparées, confiance abaissée d’autant', () => {
  assert.equal(net('TOTAL TTC 47,9O').montant, 47.9, '« O » lu à la place d’un zéro');
  assert.equal(net('TOTAL TTC 1OO,OO').montant, 100);
  const net1 = net('TOTAL TTC 47,90');
  const repare = net('TOTAL TTC 47,9O');
  assert.ok(repare.confiance.montant < net1.confiance.montant, 'une lecture réparée est moins sûre');
});

test('montant : une somme démesurée n’est pas un justificatif (code-barres, référence)', () => {
  assert.equal(net(`TOTAL TTC ${L.MONTANT_MAX + 1000},00`).montant, null);
  assert.equal(net('TOTAL TTC 0,00').montant, null, 'un total nul ne sert à rien');
});

test('montant : ligne mal lue par le moteur → champ vide plutôt qu’un chiffre inventé', () => {
  assert.equal(avec([{ texte: 'TOTAL TTC 26,35', confiance: 40 }]).montant, null, 'sous le seuil de lisibilité');
  assert.equal(avec([{ texte: 'TOTAL TTC 26,35', confiance: 92 }]).montant, 26.35);
  // « TOTAL » seul, lu tout juste : pas assez pour proposer une somme
  assert.equal(avec([{ texte: 'TOTAL 26,35', confiance: 58 }]).montant, null);
  assert.equal(avec([{ texte: 'TOTAL 26,35', confiance: 95 }]).montant, 26.35);
});

// ---------------------------------------------------------------- la date

test('date : formats français, écrite en chiffres ou en lettres', () => {
  assert.equal(net('Date 14/11/2026').date, '2026-11-14');
  assert.equal(net('Date 14.11.26').date, '2026-11-14');
  assert.equal(net('Date 14-11-2026').date, '2026-11-14');
  assert.equal(net('Facture du 14 novembre 2026').date, '2026-11-14');
  assert.equal(net('Le 1er mars 2026').date, '2026-03-01');
  assert.equal(net('Émise le 3 déc. 25').date, '2025-12-03');
  assert.equal(net('Date 2026-11-14').date, '2026-11-14');
  assert.equal(net(TICKET).date, '2026-11-14');
});

test('date impossible : refusée, et le champ reste vide', () => {
  assert.equal(L.jourValide(2026, 2, 30), null, '30 février');
  assert.equal(L.jourValide(2026, 13, 1), null, 'treizième mois');
  assert.equal(L.jourValide(2024, 2, 29), '2024-02-29', 'année bissextile');
  assert.equal(net('Date 32/13/2026').date, null);
  assert.equal(net('Date 30/02/2026').date, null);
  assert.equal(net('Date 00/00/0000').date, null);
});

test('date invraisemblable : l’an prochain ou il y a quinze ans, ce n’est pas un justificatif du jour', () => {
  assert.equal(net('Date 14/11/2028').date, null, 'dans le futur');
  assert.equal(net('Date 14/11/2009').date, null, `plus de ${L.ANS_MAX} ans`);
  assert.equal(net('Date 17/11/2026').date, '2026-11-17', 'demain reste admis (décalage d’horloge)');
});

test('date : un numéro de téléphone breton n’est pas une date', () => {
  assert.equal(net('Tel 02.98.12.03.24').date, null);
  assert.equal(net('SIRET 123 456 789 00012').date, null);
  assert.equal(net('Ref 11/12/13/14').date, null);
});

test('date : l’échéance, la validité et la carte ne sont pas la date du justificatif', () => {
  assert.equal(net('Date 14/11/2026\nEcheance 14/12/2026').date, '2026-11-14');
  assert.equal(net('A consommer avant le 20/11/2026').date, null);
  assert.equal(net('Carte EXP 12/28').date, null, 'jj/mm sans année : ce n’est pas une date');
});

test('date ambiguë : deux dates aussi sûres l’une que l’autre → champ VIDE', () => {
  const lu = net('14/11/2026\n02/10/2026');
  assert.equal(lu.date, null);
  assert.match(lu.silence.date, /Plusieurs dates/);
  // la même date écrite deux fois (en-tête et pied de ticket) ne gêne pas
  assert.equal(net('14/11/2026\nmerci\n14/11/2026').date, '2026-11-14');
});

test('date : ligne mal lue → champ vide', () => {
  assert.equal(avec([{ texte: 'Date 14/11/2026', confiance: 42 }]).date, null);
  assert.equal(avec([{ texte: 'Date 14/11/2026', confiance: 90 }]).date, '2026-11-14');
  assert.equal(avec([{ texte: '14/11/2026', confiance: 56 }]).date, null, 'sans le mot « Date », il faut une lecture franche');
});

// ---------------------------------------------------------------- le fournisseur

test('fournisseur : l’en-tête, et pas les mentions du ticket', () => {
  const lu = net(TICKET);
  assert.equal(lu.fournisseur, 'BRICO KERLANN');
  assert.equal(lu.indice.fournisseur, 'en-tête de la photo');
  assert.equal(net('FACTURE\nMenuiserie Kerlann SARL\n12 rue du Phare').fournisseur, 'Menuiserie Kerlann SARL');
  assert.equal(net('TICKET DE CAISSE\nTVA 20%\nSIRET 123\nTel 02 98 00 00 00').fournisseur, '', 'rien que des mentions');
});

test('fournisseur déjà saisi ici : reconnu dans l’en-tête et proposé avec SON orthographe', () => {
  const lu = avec([{ texte: 'POINT P  QUIMPER', confiance: 86 }], { fournisseursConnus: ['Point P', 'Leroy Merlin'] });
  assert.equal(lu.fournisseur, 'Point P', 'l’orthographe déjà enregistrée, pas celle du ticket');
  assert.equal(lu.indice.fournisseur, 'fournisseur déjà saisi ici');
  assert.ok(lu.confiance.fournisseur > 0.9, 'c’est le cas le plus sûr : on revient au même dépôt');
  assert.equal(L.nomAplati('Point-P '), L.nomAplati('POINT P'), 'accents, tirets et espaces ignorés pour comparer');
});

test('fournisseur absent de la photo : champ vide, jamais un nom inventé', () => {
  const lu = net('\n\n   \n');
  assert.equal(lu.fournisseur, '');
  assert.match(lu.silence.fournisseur, /n’a pas été trouvé sur la photo/);
  assert.equal(net('26,35\n14/11/2026\n02 98 00 00 00').fournisseur, '', 'ni un montant, ni une date, ni un numéro');
});

test('fournisseur : un nom ne se vérifie pas d’un coup d’œil, il faut une lecture franche', () => {
  assert.equal(avec([{ texte: 'BRICO KERLANN', confiance: 64 }]).fournisseur, '', 'lecture moyenne : on laisse vide');
  assert.equal(avec([{ texte: 'BRICO KERLANN', confiance: 88 }]).fournisseur, 'BRICO KERLANN');
});

test('fournisseur : seules les premières lignes sont l’en-tête', () => {
  const lignes = Array.from({ length: L.LIGNES_ENTETE }, () => ({ texte: 'TVA 20,00%', confiance: 90 }));
  lignes.push({ texte: 'BRICO KERLANN', confiance: 95 });
  assert.equal(avec(lignes).fournisseur, '', 'un nom au milieu des articles n’est pas l’en-tête');
});

// ---------------------------------------------------------------- les trois ensemble

test('photo illisible : rien n’est proposé, et on le dit sans jargon', () => {
  const lu = avec([{ texte: '|/\\ ~~ ,,, ..', confiance: 12 }, { texte: 'nnn mmm', confiance: 20 }]);
  assert.equal(lu.montant, null);
  assert.equal(lu.date, null);
  assert.equal(lu.fournisseur, '');
  assert.equal(lu.rien, true);
  assert.equal(L.direCeQuiEstLu(lu), L.RIEN_LU);
  assert.match(L.RIEN_LU, /restent à remplir à la main/);
  for (const t of [L.RIEN_LU, L.direCeQuiEstLu(lu)]) assert.doesNotMatch(t, /OCR|tesseract|WASM|confiance|seuil/i);
});

test('photo vide ou absurde : l’analyseur ne jette rien', () => {
  for (const e of [null, undefined, '', '   ', 42, { lignes: null }, { lignes: [{ texte: null }] }, [], { texte: 'TOTAL TTC 9,99' }]) {
    const lu = L.lireLaPhoto(e, { aujourdhui: '2026-11-16' });
    assert.equal(typeof lu.rien, 'boolean', String(e));
  }
  assert.equal(L.lireLaPhoto({ texte: 'TOTAL TTC 9,99' }, { aujourdhui: '2026-11-16' }).montant, 9.99, 'le texte entier marche aussi');
  assert.equal(L.lignesDuTexte('a\n\n  \nb').length, 2, 'les lignes vides ne comptent pas');
});

test('ce qui est dit sous les champs : ce qui a été lu, ce qui reste vide, et qu’il faut vérifier', () => {
  const lu = net(TICKET);
  const phrase = L.direCeQuiEstLu(lu);
  assert.match(phrase, /^Lu sur la photo : le montant, la date et le fournisseur\. À vérifier avant d’enregistrer\./);
  const partiel = net('TOTAL TTC 26,35');
  assert.match(L.direCeQuiEstLu(partiel), /^Lu sur la photo : le montant\./);
  assert.match(L.direCeQuiEstLu(partiel), /La date n’a pas été trouvée sur la photo\./, 'ce qui manque est dit, pas tu');
});

test('facture imprimée : les trois champs, dans l’autre mise en page', () => {
  const lu = net([
    'MENUISERIE AR MEN',
    'SARL au capital de 10 000 €',
    'ZA de Kerloc’h - 29170 Pluguffan',
    'FACTURE N° F-2026-0481',
    'Date : 02/11/2026',
    'Echeance : 02/12/2026',
    'Désignation          Qté    PU HT    Total HT',
    'Plinthe chêne         24    12,50      300,00',
    'Total HT                               300,00',
    'TVA 20 %                                60,00',
    'Total TTC                              360,00',
  ].join('\n'));
  assert.equal(lu.montant, 360);
  assert.equal(lu.date, '2026-11-02', 'la date de facture, pas l’échéance');
  assert.equal(lu.fournisseur, 'MENUISERIE AR MEN');
  assert.equal(lu.rien, false);
});

// ---------------------------------------------------------------- le module reste pur

test('l’analyseur est pur : ni DOM, ni réseau, ni moteur, ni stockage', () => {
  const code = lire('web/lecture-photo.js');
  for (const interdit of [/\bdocument\b/, /\bwindow\b/, /\bfetch\(/, /localStorage/, /sessionStorage/, /createWorker/, /import\(/, /XMLHttpRequest/]) {
    assert.doesNotMatch(code, interdit, `l’analyseur ne touche pas à ${String(interdit)}`);
  }
  assert.doesNotMatch(code, /https?:\/\//, 'aucune adresse : rien ne sort de l’appareil');
});
