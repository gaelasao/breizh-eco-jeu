/**
 * Le partage entre ce qui est compris dans Living Business et ce qui demande Breizhcosystem ACTIVE.
 * Ce qui est essayé ici : la liste des six comprises ne bouge pas sans qu'on le voie, chaque automatisation existante
 * est rangée d'un côté ou de l'autre, l'état de l'offre se lit des seuls droits confirmés (et jamais d'autre chose),
 * et les phrases montrées restent courtes, au vouvoiement, sans reproche.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estGratuite, GRATUITES, lireOffre, motifVerrou, OFFRE, phraseOffre, verrouillee, type EtatOffre } from './offre.ts';
import { RECETTES } from '../passerelle/automatisations.ts';
import { vuePavillon } from '../nexus/pavillon.ts';
import type { Droits, EtatAbonnement } from '../nexus/droits.ts';

/**
 * Les six que l'entreprise garde quoi qu'il arrive, écrites ici une seconde fois, à la main : si quelqu'un en
 * verrouille une de plus un jour, cet essai tombe avant que l'entreprise ne s'en aperçoive.
 */
const LES_SIX = ['trous-planning', 'documents', 'vehicules', 'relance-devis', 'doublons', 'connecter'];

test('les six comprises : la liste ne change pas sans qu’on le décide', () => {
  assert.deepEqual([...GRATUITES].sort(), [...LES_SIX].sort());
  assert.equal(GRATUITES.length, 6);
  for (const id of LES_SIX) assert.equal(estGratuite(id), true, id);
  assert.equal(estGratuite('relance-factures'), false, 'celle qui envoie n’est pas comprise');
  assert.equal(estGratuite('inconnue'), false, 'un identifiant inconnu n’ouvre rien');
});

test('chaque automatisation existante est rangée : comprise, ou réservée parce qu’elle produit et envoie', () => {
  const comprises = RECETTES.filter((r) => estGratuite(r.id)).map((r) => r.id);
  const reservees = RECETTES.filter((r) => !estGratuite(r.id)).map((r) => r.id);
  assert.deepEqual(comprises, ['relance-devis', 'documents', 'vehicules', 'trous-planning'], 'les quatre qui ne font que signaler');
  assert.deepEqual(reservees, ['relance-factures', 'facturer-livraisons', 'reappro-stock', 'courrier-urgent', 'taches-retard', 'satisfaction-auto', 'avis-bas', 'barometre']);
  assert.equal(comprises.length + reservees.length, RECETTES.length, 'aucune automatisation sans décision');
  // les deux autres comprises ne sont pas des automatisations : ce sont des gestes à faire une fois
  for (const id of ['doublons', 'connecter']) assert.equal(RECETTES.some((r) => r.id === id), false, id);
});

test('le tri du courrier reste compris : seul le routage est réservé, et c’est ce qui est dit', () => {
  const motif = motifVerrou('courrier-urgent');
  assert.match(motif, /Trier votre courrier reste compris/);
  assert.match(motif, /écran Courrier/);
  assert.match(motif, /routage/);
  assert.notEqual(motif, motifVerrou('relance-factures'), 'le courrier a son propre motif');
});

const droits = (plan: 'gratuit' | 'active', etatAbonnement: EtatAbonnement): Droits => ({
  orgId: 'org-essai', plan, etatAbonnement, actifJusquau: null, capacites: [], verifieLe: '2026-11-16T09:00:00Z',
});
const lu = (d: Droits | null, relie = true) => lireOffre({ relie, plan: d?.plan ?? null, etatAbonnement: d?.etatAbonnement ?? null });

test('l’offre se lit des seuls droits confirmés ; sans liaison, l’entreprise garde ce qui est compris', () => {
  assert.equal(lireOffre({ relie: false, plan: null, etatAbonnement: null }), 'non_reliee');
  assert.equal(lireOffre({ relie: false, plan: 'active', etatAbonnement: 'actif' }), 'non_reliee', 'sans clé de liaison, des droits traînants n’ouvrent rien');
  assert.equal(lu(null), 'sans_offre', 'reliée, aucun droit encore confirmé : rien n’est ouvert, rien n’est cassé');
  assert.equal(lu(droits('gratuit', 'actif')), 'sans_offre');
  assert.equal(lu(droits('active', 'actif')), 'offre_active');
  assert.equal(lu(droits('active', 'grace')), 'offre_active', 'délai de grâce : l’entreprise garde ce qu’elle a payé');
  assert.equal(lu(droits('active', 'paiement_en_attente')), 'sans_offre');
  assert.equal(lu(droits('active', 'paiement_echoue')), 'sans_offre');
  assert.equal(lu(droits('gratuit', 'expire')), 'sans_offre');
});

test('même règle que le pavillon de la carte : les deux ne peuvent pas dériver l’un de l’autre', () => {
  const etats: EtatAbonnement[] = ['aucun', 'actif', 'paiement_en_attente', 'paiement_echoue', 'grace', 'resilie', 'expire'];
  for (const plan of ['gratuit', 'active'] as const) {
    for (const e of etats) {
      const d = droits(plan, e);
      assert.equal(lu(d) === 'offre_active', vuePavillon({ statut: 'connecte', droits: d }, { animations: false }).afficherFonctionsActives, `${plan} / ${e}`);
    }
  }
});

test('ce qui est verrouillé : les réservées, et seulement quand l’entreprise n’a pas l’offre', () => {
  const tous = [...RECETTES.map((r) => r.id), ...GRATUITES];
  for (const offre of ['non_reliee', 'sans_offre'] as EtatOffre[]) {
    for (const id of tous) assert.equal(verrouillee(id, offre), !estGratuite(id), `${id} / ${offre}`);
  }
  for (const id of tous) assert.equal(verrouillee(id, 'offre_active'), false, `${id} : avec l’offre, plus rien n’est réservé`);
});

test('les phrases montrées : courtes, au vouvoiement, sans reproche, et le réseau s’appelle Breizhcosystem', () => {
  const textes = [OFFRE, motifVerrou('relance-factures'), motifVerrou('courrier-urgent'), phraseOffre('non_reliee') ?? '', phraseOffre('sans_offre') ?? ''];
  assert.equal(phraseOffre('offre_active'), null, 'avec l’offre, il n’y a rien à dire');
  for (const t of textes) {
    assert.ok(t.length > 0 && t.length < 320, `longueur : ${t.length}`);
    assert.doesNotMatch(t, /nexus/i, 'le réseau s’appelle Breizhcosystem');
    assert.doesNotMatch(t, /perd(ez|re|u)|dommage|rat(ez|er)|manque à gagner|économisez|profitez|!/i, `aucun reproche ni promesse : « ${t} »`);
    assert.doesNotMatch(t, /\btu\b|\bton\b|\btes\b/i, 'les textes vouvoient');
  }
  for (const t of textes.slice(1)) {
    assert.match(t, /[.]$/, `une phrase finie : « ${t} »`);
    assert.match(t, /\b(votre|vous|vos|l’éditeur)\b/i, `on parle à l’entreprise : « ${t} »`);
  }
  assert.match(OFFRE, /^Breizhcosystem /);
});
