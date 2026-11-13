/**
 * Notes de santé partagées avec Breizhcosystem (constat ia-act-13) : dans une petite équipe, la note « Absences maladie » (ou
 * celle du baromètre, de la formation…) désigne une personne. Sous 11 personnes, aucune note du domaine social ne part,
 * et la note globale envoyée est recalculée sans lui (sinon elle s'en déduirait).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjetMetier } from '../core/model.ts';
import { evaluerSante } from '../core/sante.ts';
import { construirePartage } from './lien-nexus.ts';

/** Seuil fixé par la correction (`SEUIL_PARTAGE_SOCIAL` dans sante.ts). */
const SEUIL_PARTAGE_SOCIAL = 11;

const maintenant = new Date('2026-11-09T09:00:00Z');
const o = (id: string, famille: string, type: string, nom: string, champs: Record<string, unknown>) => ({
  id, orgId: 'o', famille, type, roles: [], nom, champs, provenance: 'declare', source: { id: 's', libelle: 's', derniereSynchro: null },
  majLe: maintenant.toISOString(), disponibilite: 'disponible', mode: 'reel',
}) as unknown as ObjetMetier;

/** Entreprise de `n` salariés ; le premier a 4 jours d'arrêt maladie sur 20. */
function entreprise(n: number) {
  const objets = [o('org', 'organisation', 'mon_entreprise', 'Boulangerie Le Goff', { secteur: 'Boulangerie' })];
  const planning = new Map<string, Map<string, string>>();
  for (let k = 1; k <= n; k++) {
    objets.push(o(`e${k}`, 'personne', 'employe', `Salarié ${k}`, {}));
    const jours = new Map<string, string>();
    for (let i = 1; i <= 20; i++) jours.set(`2026-10-${String(i).padStart(2, '0')}`, k === 1 && i <= 4 ? 'absence:maladie' : 'lieu:org');
    planning.set(`e${k}`, jours);
  }
  const brut = evaluerSante({ objets, planning, maintenant, ageMaxMs: 365 * 86_400_000, modules: null });
  // une vraie entreprise atteint vite la couverture qui rend le score publiable (factures, devis, stock…)
  const sante = { ...brut, score: 55 };
  const envoi = construirePartage({ objets, planning, sante, maintenant }, ['indicateurs']) as { indicateurs?: Record<string, number> };
  return { sante, indicateurs: envoi.indicateurs ?? {} };
}

const criteresSociaux = (s: ReturnType<typeof entreprise>['sante']) => (s.domaines.find((d) => d.id === 'social')?.criteres ?? []).map((c) => c.id);

test(`indicateurs Breizhcosystem : sous ${SEUIL_PARTAGE_SOCIAL} personnes, aucune note sociale (absences maladie comprises)`, () => {
  const { sante, indicateurs } = entreprise(1);
  assert.ok(sante.domaines.find((d) => d.id === 'social')?.criteres.find((c) => c.id === 'absenteisme')?.score !== null, 'la note existe dans le jeu');
  assert.equal(indicateurs['critere.absenteisme'], undefined, JSON.stringify(indicateurs));
  assert.equal(indicateurs['domaine.social'], undefined);
  for (const id of criteresSociaux(sante)) assert.equal(indicateurs[`critere.${id}`], undefined, id);
  // la note globale ne contient plus le domaine social : elle vaut la moyenne des autres domaines
  const autres = sante.domaines.filter((d) => d.id !== 'social' && d.score !== null && d.couverture > 0);
  const attendu = Math.round(autres.reduce((a, d) => a + (d.score as number) * d.couverture, 0) / autres.reduce((a, d) => a + d.couverture, 0));
  assert.equal(indicateurs.global, attendu);
  assert.ok(Object.keys(indicateurs).some((k) => k.startsWith('domaine.')), 'les autres notes partent toujours');
});

test(`indicateurs Breizhcosystem : à partir de ${SEUIL_PARTAGE_SOCIAL} personnes, les notes sociales partent (taux d’équipe)`, () => {
  const { sante, indicateurs } = entreprise(SEUIL_PARTAGE_SOCIAL);
  assert.equal(typeof indicateurs['critere.absenteisme'], 'number');
  assert.equal(typeof indicateurs['domaine.social'], 'number');
  // la note globale part recalculée sans les critères du baromètre (ici « participation », à 0 : personne n'a répondu)
  const BAROMETRE = ['climat', 'charge_tenable', 'participation'];
  const somme = (l: number[]) => l.reduce((a, b) => a + b, 0);
  const domaines = sante.domaines.map((d) => {
    const l = d.criteres.filter((c) => !BAROMETRE.includes(c.id));
    const connus = l.filter((c) => c.score !== null);
    const poids = somme(connus.map((c) => c.poids));
    return { score: poids ? Math.round(somme(connus.map((c) => (c.score as number) * c.poids)) / poids) : null, couverture: poids / (somme(l.map((c) => c.poids)) || 1) };
  }).filter((d) => d.score !== null && d.couverture > 0);
  assert.equal(indicateurs.global, Math.round(somme(domaines.map((d) => (d.score as number) * d.couverture)) / somme(domaines.map((d) => d.couverture))));
  assert.equal(indicateurs['critere.participation'], undefined);
});

test('revue-jeu-1-11 : les fiches anonymisées d’anciens salariés ne comptent pas dans le seuil de 11 personnes', () => {
  // 6 personnes en poste + 5 fiches anonymisées (droit à l'effacement) : 11 fiches, mais une équipe de 6
  const objets = [o('org', 'organisation', 'mon_entreprise', 'Boulangerie Le Goff', { secteur: 'Boulangerie' })];
  const planning = new Map<string, Map<string, string>>();
  for (let k = 1; k <= 6; k++) {
    objets.push(o(`e${k}`, 'personne', 'employe', `Salarié ${k}`, {}));
    const jours = new Map<string, string>();
    for (let i = 1; i <= 20; i++) jours.set(`2026-10-${String(i).padStart(2, '0')}`, k === 1 && i <= 4 ? 'absence:maladie' : 'lieu:org');
    planning.set(`e${k}`, jours);
  }
  for (let k = 1; k <= 5; k++) objets.push({ ...o(`a${k}`, 'personne', 'employe', 'Fiche anonymisée', {}), source: { id: 'effacement', libelle: 'Fiche anonymisée', derniereSynchro: null } } as ObjetMetier);
  const sante = { ...evaluerSante({ objets, planning, maintenant, ageMaxMs: 365 * 86_400_000, modules: null }), score: 55 };
  const { indicateurs = {} } = construirePartage({ objets, planning, sante, maintenant }, ['indicateurs']) as { indicateurs?: Record<string, number> };
  assert.equal(indicateurs['critere.absenteisme'], undefined, 'avant : l’arrêt d’une personne sur 6 partait comme un « taux d’équipe »');
  assert.equal(indicateurs['domaine.social'], undefined);
  assert.ok(Object.keys(indicateurs).some((k) => k.startsWith('domaine.')), 'les autres notes partent toujours');
});

test('revue-jeu-1-10 : les notes tirées du baromètre ne partent jamais ; domaine social et note globale recalculés sans elles', () => {
  const objets = [o('org', 'organisation', 'mon_entreprise', 'Menuiserie Kerlann', { secteur: 'Menuiserie' })];
  const planning = new Map<string, Map<string, string>>();
  for (let k = 1; k <= 12; k++) {
    objets.push(o(`e${k}`, 'personne', 'employe', `Salarié ${k}`, {}));
    const jours = new Map<string, string>();
    for (let i = 1; i <= 20; i++) jours.set(`2026-10-${String(i).padStart(2, '0')}`, k === 1 && i <= 4 ? 'absence:maladie' : 'lieu:org');
    planning.set(`e${k}`, jours);
  }
  // résultats publiés du baromètre (objets éphémères, comme Enquetes.objetsSante) : un climat très bas
  for (let k = 1; k <= 6; k++) objets.push(o(`b${k}`, 'evenement', 'barometre', 'Baromètre (résultat anonyme)', { note: 2, charge: 1, recu_le: '2026-10-01' }));
  const sante = evaluerSante({ objets, planning, maintenant, ageMaxMs: 365 * 86_400_000, modules: null });
  const social = sante.domaines.find((d) => d.id === 'social')!;
  for (const id of ['climat', 'charge_tenable', 'participation']) assert.notEqual(social.criteres.find((c) => c.id === id)?.score, null, `${id} : la note existe dans le jeu`);
  const { indicateurs = {} } = construirePartage({ objets, planning, sante: { ...sante, score: sante.score ?? 50 }, maintenant }, ['indicateurs']) as { indicateurs?: Record<string, number> };
  for (const id of ['climat', 'charge_tenable', 'participation']) assert.equal(indicateurs[`critere.${id}`], undefined, `${id} ne sort pas de l’entreprise`);
  assert.equal(typeof indicateurs['critere.absenteisme'], 'number', 'les autres notes sociales partent (12 personnes)');
  // la note du domaine social envoyée est celle des critères restants : elle ne laisse pas deviner le baromètre
  const restants = social.criteres.filter((c) => !['climat', 'charge_tenable', 'participation'].includes(c.id) && c.score !== null);
  const attendu = Math.round(restants.reduce((a, c) => a + (c.score as number) * c.poids, 0) / restants.reduce((a, c) => a + c.poids, 0));
  assert.equal(indicateurs['domaine.social'], attendu);
  assert.notEqual(indicateurs['domaine.social'], social.score, 'la note du jeu, tirée vers le bas par le baromètre, n’est pas celle qui part');
  // un autre climat ne change rien à ce qui part
  const autres = objets.map((x) => (x.type === 'barometre' ? { ...x, champs: { ...x.champs, note: 9, charge: 9 } } : x)) as ObjetMetier[];
  const sante2 = evaluerSante({ objets: autres, planning, maintenant, ageMaxMs: 365 * 86_400_000, modules: null });
  const envoi2 = construirePartage({ objets: autres, planning, sante: { ...sante2, score: sante2.score ?? 50 }, maintenant }, ['indicateurs']) as { indicateurs?: Record<string, number> };
  assert.deepEqual(envoi2.indicateurs, indicateurs, 'même envoi, que l’équipe aille bien ou mal');
});

test('notes de santé envoyées à Breizhcosystem : dites pseudonymes (rattachées à l’entreprise), jamais « anonymes » (rgpd-9)', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8');
  // ce qui part est gardé par entreprise chez Breizhcosystem : seule la comparaison vue des autres membres est agrégée
  for (const ancien of ['comparaison anonyme', 'anonymement (des notes sur 100', 'Notes anonymes, groupes']) {
    assert.ok(!app.includes(ancien), `plus de « ${ancien} » dans l’interface`);
  }
  const categorie = app.split('\n').find((l) => l.includes("['indicateurs', 'Notes de santé'")) ?? '';
  assert.match(categorie, /rattachées à votre entreprise chez Breizhcosystem/, 'interrupteur : notes rattachées à l’entreprise');
  assert.match(categorie, /Sous 11 personnes, aucune note de l’équipe/);
  const confidentialite = app.slice(app.indexOf('async function rendreConfidentialite('), app.indexOf('async function rendreConfidentialite(') + 6000);
  assert.match(confidentialite, /includes\('indicateurs'\) \? 'Les notes de santé restent rattachées à votre entreprise chez Breizhcosystem \(données pseudonymes, pas anonymes\)/,
    'Réglages › Confidentialité le dit dès que la catégorie est cochée');
});
