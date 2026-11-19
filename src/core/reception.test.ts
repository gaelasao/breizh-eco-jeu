/**
 * Rapprocher le bon de livraison et la commande. Ce qui compte : l'écart de montant est calculé et dit, le bon
 * reçu deux fois est reconnu (et seulement chez le même fournisseur), « pas encore vérifié » n'est jamais un feu
 * vert, et un bon à payer coché malgré un problème est MONTRÉ plutôt que tu.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjetMetier, ValeurChamp } from './model.ts';
import { cleBl, doublonBl, ecartMontant, etatReception, phraseReception } from './reception.ts';

const obj = (id: string, type: string, famille: ObjetMetier['famille'], champs: Record<string, ValeurChamp>, nom = id): ObjetMetier => ({
  id, orgId: 'org', famille, type, roles: [], nom, champs,
  provenance: 'declare', source: { id: 't', libelle: 'T', derniereSynchro: '2026-11-19T09:00:00.000Z' },
  majLe: '2026-11-19T09:00:00.000Z', disponibilite: 'disponible', mode: 'reel',
});
const commande = (champs: Record<string, ValeurChamp> = {}, id = 'cf1') =>
  obj(id, 'commande_fournisseur', 'commande', { fournisseur: 't-negoce', montant: 2300, ...champs }, 'CF-104');
const reception = (champs: Record<string, ValeurChamp> = {}, id = 'r1') =>
  obj(id, 'reception', 'commande', { commande: 'cf1', ...champs }, 'Réception CF-104');
/** Tout vérifié et tout bon : la base sur laquelle on retire un élément à la fois. */
const nickel = { quantites: 'conformes', articles: 'conforme à la commande', montant_bl: 2300 };

test('tout concorde : rien ne s’oppose au paiement, et c’est dit en une phrase', () => {
  const e = etatReception(reception(nickel), commande());
  assert.deepEqual(e.manque, []);
  assert.deepEqual(e.problemes, []);
  assert.equal(e.rienNeBloque, true);
  assert.equal(e.payeQuandMeme, false);
  assert.match(phraseReception(e), /concordent/);
});

test('l’écart de montant est calculé, chiffré, et dit dans le bon sens', () => {
  const trop = etatReception(reception({ ...nickel, montant_bl: 2415 }), commande());
  assert.deepEqual(trop.ecartMontant, { commande: 2300, bl: 2415, ecart: 115, pourcent: 5 });
  assert.match(trop.problemes[0] ?? '', /dépasse la commande de 115,00 € \(5 %\)/);
  assert.equal(trop.rienNeBloque, false);
  const moins = etatReception(reception({ ...nickel, montant_bl: 2000 }), commande());
  assert.match(moins.problemes[0] ?? '', /inférieur à la commande de 300,00 €/);
  // un montant absent n'est pas un écart de 100 % : c'est une case à remplir
  const sansMontant = etatReception(reception({ quantites: 'conformes', articles: 'conforme à la commande' }), commande());
  assert.equal(sansMontant.ecartMontant, null);
  assert.deepEqual(sansMontant.problemes, []);
  assert.match(sansMontant.manque[0] ?? '', /montant du bon de livraison n’est pas saisi/);
  assert.equal(ecartMontant(reception({ montant_bl: 10 }), commande({ montant: 0 })), null, 'une commande à zéro ne divise rien');
});

test('le même bon reçu deux fois est reconnu, et seulement chez le même fournisseur', () => {
  /* C'est l'erreur qui se paie deux fois : le fournisseur renvoie son bon par mail, quelqu'un le ressaisit, et
     deux règlements partent. Le numéro se compare sans sa ponctuation — « BL-2026/114 » et « bl 2026 114 ». */
  assert.equal(cleBl('BL-2026/114'), cleBl('bl 2026 114'));
  const a = reception({ ...nickel, bl_numero: 'BL-2026/114' }, 'r1');
  const b = reception({ ...nickel, bl_numero: 'bl 2026 114' }, 'r2');
  const fournisseurs: Record<string, string> = { r1: 't-negoce', r2: 't-negoce', r3: 't-grossiste' };
  const de = (r: ObjetMetier) => fournisseurs[r.id] ?? null;
  assert.equal(doublonBl(a, [a, b], de), 'r2');
  const e = etatReception(a, commande(), [a, b], de);
  assert.match(e.problemes[0] ?? '', /payer deux fois/);
  assert.equal(e.rienNeBloque, false);
  // et il passe DEVANT l'écart de montant : la liste ne montre que la première ligne, et payer deux fois coûte
  // le montant entier là où un écart de 5 % coûte cinq pour cent
  const lesDeux = etatReception(reception({ ...nickel, bl_numero: 'BL-2026/114', montant_bl: 2415 }, 'r1'), commande(), [a, b], de);
  assert.match(lesDeux.problemes[0] ?? '', /payer deux fois/);
  assert.match(lesDeux.problemes[1] ?? '', /dépasse la commande/);
  // un autre fournisseur qui numérote pareil n'est pas un doublon : crier là-dessus apprend à ignorer l'alerte
  const c = reception({ ...nickel, bl_numero: '114' }, 'r3');
  assert.equal(doublonBl(reception({ ...nickel, bl_numero: '114' }, 'r1'), [c], de), null);
  assert.equal(doublonBl(reception({ ...nickel }, 'r1'), [b], de), null, 'sans numéro, aucun doublon');
});

test('« pas encore vérifié » n’est jamais un feu vert', () => {
  const rien = etatReception(reception({ montant_bl: 2300 }), commande());
  assert.equal(rien.rienNeBloque, false);
  assert.equal(rien.problemes.length, 0, 'ce n’est pas un problème : c’est une question sans réponse');
  assert.deepEqual(rien.manque, [
    'les quantités ne sont pas encore vérifiées',
    'personne n’a encore dit si c’est bien ce qui avait été commandé',
  ]);
  assert.match(phraseReception(rien), /^Avant de payer, il reste à vérifier/);
  const explicite = etatReception(reception({ ...nickel, quantites: 'pas encore vérifiées', articles: 'pas encore vérifié', montant_bl: 2300 }), commande());
  assert.equal(explicite.manque.length, 2, 'répondre « pas encore vérifié » revient à ne pas répondre');
});

test('les vrais problèmes sont nommés un par un', () => {
  const m = etatReception(reception({ ...nickel, quantites: 'manquantes' }), commande());
  assert.deepEqual(m.problemes, ['il manque des quantités']);
  assert.deepEqual(etatReception(reception({ ...nickel, quantites: 'en trop' }), commande()).problemes, ['il y a plus que commandé']);
  assert.deepEqual(etatReception(reception({ ...nickel, articles: 'pas ce qui était demandé' }), commande()).problemes, ['ce n’est pas ce qui avait été demandé']);
  assert.deepEqual(etatReception(reception({ ...nickel, articles: 'en partie seulement' }), commande()).problemes, ['la livraison est incomplète']);
});

test('rattachée à rien, ou rattachée à un devis : on le dit plutôt que de rapprocher n’importe quoi', () => {
  const orpheline = etatReception(reception(nickel), null);
  assert.match(orpheline.manque.join(' '), /rattachée à aucune commande/);
  const devis = obj('d1', 'devis', 'commande', { montant: 2300 }, 'Devis D-17');
  const e = etatReception(reception(nickel), devis);
  assert.match(e.problemes.join(' '), /Devis D-17, qui n’est pas une commande fournisseur/);
});

test('bon à payer coché malgré un problème : montré, jamais tu', () => {
  /* Le cas qui coûte de l'argent est celui-là, pas celui où tout va bien. Il a sa propre phrase, en premier. */
  const e = etatReception(reception({ ...nickel, montant_bl: 2415, bon_a_payer: true }), commande());
  assert.equal(e.payeQuandMeme, true);
  assert.match(phraseReception(e), /^Marquée bon à payer alors que le bon dépasse la commande/);
  // coché quand tout concorde : rien à signaler
  assert.equal(etatReception(reception({ ...nickel, bon_a_payer: true }), commande()).payeQuandMeme, false);
});
