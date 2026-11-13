import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjetMetier } from './model.ts';
import { echelle, evaluerSante, NOMBRE_CRITERES, ratiosSante } from './sante.ts';
import { Application } from '../passerelle/application.ts';

const maintenant = new Date('2026-11-09T10:00:00Z');
const o = (id: string, famille: string, type: string, champs: Record<string, unknown>, roles: string[] = []): ObjetMetier => ({
  id, orgId: 'o', famille, type, roles, nom: id, champs: champs as ObjetMetier['champs'],
  provenance: 'declare', source: { id: 's', libelle: 's', derniereSynchro: null }, majLe: maintenant.toISOString(), disponibilite: 'disponible', mode: 'reel',
} as ObjetMetier);

test('échelle : 0 au seuil mauvais, 100 au seuil bon, dans les deux sens', () => {
  assert.equal(echelle(3, 0.5, 3), 100);
  assert.equal(echelle(0.5, 0.5, 3), 0);
  assert.equal(echelle(1.75, 0.5, 3), 50);
  assert.equal(echelle(0, 0.5, 0), 100);
  assert.equal(echelle(0.6, 0.5, 0), 0);
});

test('donnée inconnue ≠ 0 : monde vide = « à connecter », pas de note inventée', () => {
  const r = evaluerSante({ objets: [], planning: new Map(), maintenant, ageMaxMs: 86_400_000, modules: null });
  assert.equal(r.score, null);
  assert.equal(r.fiabilite, 'insuffisante');
  assert.equal(r.domaines.length, 6);
  assert.equal(r.domaines.flatMap((d) => d.criteres).length, NOMBRE_CRITERES);
  assert.ok(r.domaines.flatMap((d) => d.criteres).every((c) => c.score === null && c.statut === 'inconnu' && c.source));
});

test('critères financiers : trésorerie, retards clients, encours ; ratios partageables sans montant', () => {
  const objets = [
    o('org', 'organisation', 'mon_entreprise', { tresorerie: 90_000, charges_mensuelles: 30_000, marge_brute: 45 }),
    o('c1', 'tiers', 'entreprise', { encours: 5000, limite_encours: 4000 }, ['client']),
    o('c2', 'tiers', 'entreprise', { encours: 1000, limite_encours: 4000 }, ['client']),
    o('f1', 'commande', 'facture', { tiers: 'c1', montant: 1000, payee: false, echeance: '2026-10-01' }),
    o('f2', 'commande', 'facture', { tiers: 'c2', montant: 3000, payee: false, echeance: '2026-12-01' }),
  ];
  const r = evaluerSante({ objets, planning: new Map(), maintenant, ageMaxMs: 86_400_000 * 30, modules: null });
  const c = (id: string) => r.domaines.flatMap((d) => d.criteres).find((x) => x.id === id);
  assert.equal(c('tresorerie')?.score, 100);
  assert.equal(c('tresorerie')?.mesure, '3 mois de charges');
  assert.equal(c('marge_brute')?.score, 100);
  assert.equal(c('retards_clients')?.mesure, '25 % du montant dû est en retard');
  assert.equal(c('encours_depasses')?.valeur, 0.5);
  const ratios = ratiosSante(r, { effectif: 20 });
  assert.ok(Object.values(ratios).every((v) => v >= 0 && v <= 100), 'notes 0–100 uniquement');
  assert.ok(!JSON.stringify(ratios).includes('90000') && !Object.keys(ratios).some((k) => k.includes('c1')));
});

test('exemples : score calculé avec une bonne couverture ; réservé aux profils qui voient le score', async () => {
  for (const exemple of ['pme', 'eti'] as const) {
    const app = await Application.creer({ exemple });
    const r = app.sante(app.monde.profil('dirigeante')!, 'x');
    assert.ok(r.score !== null && r.score > 0 && r.score < 100, `${exemple} : ${r.score}`);
    assert.ok(r.couverture > 0.7, `${exemple} : couverture ${r.couverture}`);
    assert.equal(r.priorites.length, 3);
    assert.throws(() => app.sante(app.monde.profil('responsable-stock')!, 'x'), /ne voit pas le score/);
  }
});
