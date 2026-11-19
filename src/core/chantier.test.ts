/**
 * Le suivi de chantier. Ce qui compte ici : la comparaison budget / avancement dit juste, les deux postes restent
 * séparés, rien n'est inventé quand le devis n'a pas été renseigné, et un dépassement se dit en toutes lettres.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjetMetier, ValeurChamp } from './model.ts';
import { etatChantier, MARGE_POINTS, phraseChantier } from './chantier.ts';

const chantier = (champs: Record<string, ValeurChamp>): ObjetMetier => ({
  id: 'ch1', orgId: 'org', famille: 'projet', type: 'projet', roles: [], nom: 'Hôtel des Embruns', champs,
  provenance: 'declare', source: { id: 'test', libelle: 'Essai', derniereSynchro: '2026-11-19T09:00:00.000Z' },
  majLe: '2026-11-19T09:00:00.000Z', disponibilite: 'disponible', mode: 'reel',
});

test('25 % des heures pour 30 % d’avancement : en avance, et on le dit', () => {
  const e = etatChantier(chantier({ avancement: 30, budget_heures: 400, heures_faites: 100 }));
  assert.equal(e.heures?.part, 25);
  assert.equal(e.heures?.reste, 300);
  assert.equal(e.heures?.ecart, -5);
  assert.equal(e.achats, null, 'aucun achat renseigné : rien n’est supposé');
  assert.equal(e.ecart, -5);
  assert.equal(e.sens, 'tenu', 'cinq points, c’est la marge : un chantier ne se pilote pas au point près');
  const net = etatChantier(chantier({ avancement: 40, budget_heures: 400, heures_faites: 100 }));
  assert.equal(net.sens, 'avance');
  assert.match(phraseChantier(net), /en avance/);
});

test('40 % des heures pour 30 % d’avancement : ça dérive, de dix points', () => {
  const e = etatChantier(chantier({ avancement: 30, budget_heures: 400, heures_faites: 160, cause_ecart: 'intempéries' }));
  assert.equal(e.heures?.ecart, 10);
  assert.equal(e.sens, 'retard');
  assert.equal(e.cause, 'intempéries');
  const p = phraseChantier(e);
  assert.match(p, /30 % fait/);
  assert.match(p, /les heures consomment 10 points de plus/);
  assert.match(p, /\(intempéries\)/, 'la cause est celle que le terrain a déclarée');
});

test('les deux postes restent côte à côte : aucune moyenne entre heures et achats', () => {
  /* Un chantier qui tient ses heures et explose ses achats n'est pas « à moitié bien ». C'est le pire des deux qui
     décide, sinon un bon poste masque le mauvais — et c'est le mauvais qui coûte. */
  const e = etatChantier(chantier({ avancement: 50, budget_heures: 100, heures_faites: 40, budget_achats: 10_000, achats_engages: 9000 }));
  assert.equal(e.heures?.ecart, -10, 'les heures vont bien');
  assert.equal(e.achats?.ecart, 40, 'les achats vont mal');
  assert.equal(e.ecart, 40, 'c’est le pire qui compte');
  assert.equal(e.sens, 'retard');
  assert.match(phraseChantier(e), /les achats consomment 40 points de plus/);
});

test('le dépassement se dit en négatif, il ne se borne pas à zéro', () => {
  const e = etatChantier(chantier({ avancement: 80, budget_achats: 5000, achats_engages: 6500 }));
  assert.equal(e.achats?.reste, -1500, 'il reste moins que rien : c’est l’information');
  assert.equal(e.achats?.part, 130);
  assert.equal(e.sens, 'retard');
});

test('sans devis chiffré ni avancement, on ne rend pas un écart de zéro', () => {
  /* Un zéro se lit « tout va bien ». Un écran vide se lit « il manque quelque chose », ce qui est vrai. */
  const rien = etatChantier(chantier({}));
  assert.equal(rien.heures, null);
  assert.equal(rien.achats, null);
  assert.equal(rien.ecart, null);
  assert.equal(rien.sens, null);
  assert.equal(phraseChantier(rien), '');
  assert.equal(etatChantier(chantier({ avancement: 20, budget_heures: 0, heures_faites: 50 })).heures, null, 'un budget à zéro ne divise rien');
  assert.equal(etatChantier(chantier({ budget_heures: 100, heures_faites: 50 })).heures, null, 'sans avancement, aucune comparaison n’a de sens');
  assert.equal(etatChantier(chantier({ avancement: 20, budget_heures: 100, heures_faites: -3 })).heures, null, 'des heures négatives ne sont pas une donnée');
});

test('un avancement abîmé est ramené dans ses bornes, jamais rejeté', () => {
  assert.equal(etatChantier(chantier({ avancement: 140 })).avancement, 100);
  assert.equal(etatChantier(chantier({ avancement: -20 })).avancement, 0);
  assert.equal(etatChantier(chantier({ avancement: 'beaucoup' })).avancement, 0);
  assert.equal(MARGE_POINTS, 5);
});
