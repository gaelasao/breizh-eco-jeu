import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Source, Valeur } from './model.ts';
import { evaluerSeuil, type RegleSeuil } from './situation.ts';
import { calculerVitalite, type Indicateur } from './vitalite.ts';
import { RegistreActions, TransitionInterdite, type CommandeAction, type Executeur } from './actions.ts';

const maintenant = new Date('2026-11-09T10:00:00Z');
const ageMaxMs = 15 * 60_000;
const ctx = { maintenant, ageMaxMs };
const src: Source = { id: 'sheets:stock', libelle: 'Tableur stock', derniereSynchro: '2026-11-09T09:55:00Z' };
const v = (valeur: number | null, observeLe: string | null): Valeur<number> => ({ valeur, provenance: 'confirme', source: src, observeLe });
const FRAIS = '2026-11-09T09:55:00Z';
const VIEUX = '2026-11-09T08:00:00Z';

const stock: RegleSeuil = { id: 'stock_minimum', libelle: 'Stock', sens: 'min', seuilCritique: 0 };
const retard: RegleSeuil = { id: 'retard_paiement', libelle: 'Retard de paiement', sens: 'max', seuilCritique: 30, unite: 'jours' };

test('R02 seuil minimum franchi (frais) → situation ouverte avec preuve', () => {
  const s = evaluerSeuil('article-1', v(3, FRAIS), 10, stock, 'resp-stock', ctx);
  assert.equal(s?.statut, 'ouverte');
  assert.equal(s?.gravite, 'attention');
  assert.deepEqual([s?.preuve.valeur, s?.preuve.seuil, s?.preuve.fraicheur], [3, 10, 'fraiche']);
});

test('seuil maximum (retard client) + gravité critique', () => {
  const s = evaluerSeuil('facture-1', v(45, FRAIS), 0, retard, null, ctx);
  assert.equal(s?.gravite, 'critique');
  assert.equal(s?.description, 'Retard de paiement : 45\u00A0jours', 'un seuil maximum de 0 ne s’écrit pas, nombre et unité insécables');
  assert.equal(evaluerSeuil('facture-2', v(0, FRAIS), 0, retard, null, ctx), null);
});

test('R02 source périmée : dernière valeur datée et signalée', () => {
  const s = evaluerSeuil('article-1', v(3, VIEUX), 10, stock, null, ctx);
  assert.equal(s?.preuve.fraicheur, 'perimee');
  assert.match(s?.description ?? '', /périmée/);
});

test('source périmée dans les limites ne passe jamais au vert', () => {
  assert.equal(evaluerSeuil('article-1', v(50, VIEUX), 10, stock, null, ctx)?.statut, 'a_verifier');
});

test('valeur ou seuil inconnu ≠ 0', () => {
  assert.equal(evaluerSeuil('article-1', v(null, null), 10, stock, null, ctx)?.statut, 'a_verifier');
  assert.match(evaluerSeuil('article-1', v(5, FRAIS), null, stock, null, ctx)?.description ?? '', /seuil non renseigné/);
});

test('R14 score : manquants exclus, couverture visible, non calculable sous seuil', () => {
  const ind = (id: string, poids: number, val: number | null, obs: string | null): Indicateur => ({ id, libelle: id, poids, valeur: v(val, obs) });
  const frais = '2026-11-09T09:58:00Z';
  const r = calculerVitalite(
    [ind('marge', 2, 80, frais), ind('retards', 1, null, null), ind('tresorerie', 1, 40, '2026-11-01T00:00:00Z')],
    { seuilCouverture: 0.6, ageMaxMs, maintenant },
  );
  assert.equal(r.couverture, 0.5);
  assert.equal(r.calculable, false);
  assert.equal(r.score, null);
  assert.deepEqual(r.details.map((d) => d.raison), ['ok', 'manquant', 'perime']);

  const r2 = calculerVitalite([ind('marge', 2, 80, frais), ind('retards', 1, 50, frais)], { seuilCouverture: 0.6, ageMaxMs, maintenant });
  assert.equal(r2.score, 70); // (80*2 + 50*1) / 3
});

const cmd = (over: Partial<CommandeAction> = {}): CommandeAction => ({
  cleIdempotence: 'k1',
  orgId: 'org-a',
  acteur: 'u1',
  capacite: 'stock.sortie',
  cible: 'article-1',
  parametres: { quantite: 5 },
  approuvePar: 'dirigeant',
  etat: 'approuvee',
  mode: 'reel',
  ...over,
});

test('R03 double clic → un seul mouvement réel', async () => {
  let appels = 0;
  const reel: Executeur = async () => {
    appels++;
    return 'ok';
  };
  const reg = new RegistreActions();
  const [a, b] = await Promise.all([reg.executer(cmd(), reel, reel), reg.executer(cmd(), reel, reel)]);
  assert.equal(appels, 1);
  assert.equal(a.etat, 'reussie_technique');
  assert.equal(b.etat, 'reussie_technique');
});

test('timeout → résultat inconnu, pas de supposition', async () => {
  const reel: Executeur = async () => {
    throw new Error('timeout');
  };
  const r = await new RegistreActions().executer(cmd(), reel, reel);
  assert.equal(r.etat, 'resultat_inconnu');
});

test('R04 simulation : exécuteur réel jamais appelé', async () => {
  let reelAppele = false;
  const reel: Executeur = async () => {
    reelAppele = true;
    return 'ok';
  };
  const simule: Executeur = async () => 'ok';
  await new RegistreActions().executer(cmd({ mode: 'simulation' }), reel, simule);
  assert.equal(reelAppele, false);
});

test('action réelle sans approbation refusée', async () => {
  const ok: Executeur = async () => 'ok';
  await assert.rejects(new RegistreActions().executer(cmd({ approuvePar: null }), ok, ok), TransitionInterdite);
});
