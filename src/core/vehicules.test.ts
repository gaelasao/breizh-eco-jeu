/**
 * Suivi des véhicules : calcul des échéances (date et kilométrage), répétition, délai de prévenance,
 * « C'est fait », historique et total de l'année. Rien n'apparaît tant qu'il n'y a pas de véhicule.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjetMetier, ValeurChamp } from './model.ts';
import { situationsPour } from './situation.ts';
import { chargerUnivers } from '../config/univers.ts';
import {
  ajouterMois, champsApresFait, defEcheance, echeancesDe, estVehicule, historiqueDe, JOURS_KM_PERIME, kilometrageDe,
  prochaineOccurrence, situationsVehicule, situationsVehicules, totalAnnee, TYPE_ENTRETIEN,
} from './vehicules.ts';

const U = await chargerUnivers('generique');
const MAINTENANT = new Date('2026-11-13T09:00:00Z');
const ctx = { maintenant: MAINTENANT, ageMaxMs: 7 * 86_400_000 };
const jour = (n: number) => new Date(MAINTENANT.getTime() + n * 86_400_000).toISOString().slice(0, 10);

const objet = (id: string, type: string, champs: Record<string, ValeurChamp>, famille: ObjetMetier['famille'] = 'ressource'): ObjetMetier => ({
  id, orgId: 'org', famille, type, roles: [], nom: id, champs,
  provenance: 'declare', source: { id: 'test', libelle: 'Essai', derniereSynchro: MAINTENANT.toISOString() },
  majLe: MAINTENANT.toISOString(), disponibilite: 'disponible', mode: 'reel',
});
const vehicule = (champs: Record<string, ValeurChamp> = {}, id = 'v1') => objet(id, 'vehicule', champs);
const entretien = (id: string, champs: Record<string, ValeurChamp>) => objet(id, TYPE_ENTRETIEN, champs, 'evenement');
const par = (v: ObjetMetier, idEcheance: string) => echeancesDe(v, MAINTENANT, { toutes: true }).find((x) => x.id === idEcheance);
const regles = (v: ObjetMetier) => situationsPour(U, v, null, ctx).map((s) => `${s.regle}|${s.gravite}|${s.description}`);

test('un véhicule sans rien ne produit aucune échéance et aucune alerte', () => {
  const v = vehicule();
  assert.deepEqual(echeancesDe(v, MAINTENANT), [], 'rien n’est renseigné : rien à montrer');
  assert.deepEqual(situationsVehicule(v, null, ctx), []);
  assert.deepEqual(regles(v), []);
  // « toutes » sert à l'écran : les six natures sont proposées, vides et sans état
  const toutes = echeancesDe(v, MAINTENANT, { toutes: true });
  assert.deepEqual(toutes.map((x) => x.id), ['controle_technique', 'revision', 'pneus', 'assurance', 'carte_grise', 'libre']);
  assert.ok(toutes.every((x) => x.statut === 'absente' && x.date === null && x.km === null));
});

test('aucun véhicule : pas la moindre situation à produire', () => {
  const objets = [objet('a1', 'article', { quantite: 5 }), objet('d1', 'document', { valide_jusqu_au: jour(-3) }, 'evenement')];
  assert.deepEqual(situationsVehicules(objets, () => null, ctx), []);
  assert.equal(objets.filter(estVehicule).length, 0);
  // un équipement n'est pas un véhicule ; le type « vehicule » en est un, quel que soit le nom donné par l'univers
  assert.equal(estVehicule(objet('e1', 'equipement', {})), false);
  assert.equal(estVehicule(vehicule()), true);
});

test('échéance par date : le délai de prévenance ouvre l’alerte, le dépassement la rend urgente', () => {
  // au-delà du préavis (30 jours pour le contrôle technique) : silence
  assert.deepEqual(regles(vehicule({ controle_technique: jour(45) })), []);
  assert.equal(par(vehicule({ controle_technique: jour(45) }), 'controle_technique')?.statut, 'ok');

  const proche = vehicule({ controle_technique: jour(30) });
  assert.deepEqual(regles(proche), ['controle_technique|attention|Contrôle technique : échéance dans 30 jours']);
  assert.equal(par(proche, 'controle_technique')?.statut, 'bientot');

  assert.equal(par(vehicule({ controle_technique: jour(0) }), 'controle_technique')?.statut, 'aujourdhui');

  const passe = vehicule({ controle_technique: jour(-2) });
  assert.deepEqual(regles(passe), ['controle_technique|critique|Contrôle technique : échéance dépassée de 2 jours']);
  assert.equal(par(passe, 'controle_technique')?.statut, 'depassee', 'passée, jamais silencieuse');
});

test('les six natures d’échéance sont suivies, y compris celle que l’entreprise nomme elle-même', () => {
  const v = vehicule({
    controle_technique: jour(5), prochaine_revision: jour(5), pneus_le: jour(5),
    assurance_le: jour(5), carte_grise_le: jour(5), autre_le: jour(5), autre_libelle: 'Vidange hydraulique',
  });
  assert.deepEqual(regles(v).map((x) => x.split('|')[0]).sort(), [
    'assurance_vehicule', 'carte_grise_vehicule', 'controle_technique', 'echeance_vehicule', 'pneus_vehicule', 'revision_vehicule',
  ]);
  // l'échéance libre s'annonce sous son nom, à l'écran comme dans l'alerte
  assert.ok(regles(v).some((x) => x.includes('Vidange hydraulique : échéance dans 5 jours')));
  assert.equal(par(v, 'libre')?.libelle, 'Vidange hydraulique');
  // sans nom donné, elle garde un intitulé neutre
  assert.ok(regles(vehicule({ autre_le: jour(5) })).some((x) => x.includes('Échéance du véhicule : échéance dans 5 jours')));
});

test('le véhicule peut demander à être prévenu plus tôt, ou plus tard', () => {
  assert.deepEqual(regles(vehicule({ controle_technique: jour(45) })), [], 'préavis de la règle : 30 jours');
  const tot = vehicule({ controle_technique: jour(45), prevenir_jours: 60 });
  assert.equal(regles(tot).length, 1, 'prévenue 60 jours avant');
  assert.equal(par(tot, 'controle_technique')?.prevenirJours, 60);
  assert.deepEqual(regles(vehicule({ controle_technique: jour(20), prevenir_jours: 7 })), [], 'prévenue 7 jours avant seulement');
  // valeur abîmée ou démesurée : le préavis de la règle reprend la main, l'alerte ne disparaît jamais
  assert.equal(regles(vehicule({ controle_technique: jour(10), prevenir_jours: -5 })).length, 1);
  assert.equal(regles(vehicule({ controle_technique: jour(10), prevenir_jours: 9_000 })).length, 1);
});

test('échéance au kilométrage : prévenue avant, urgente une fois dépassée', () => {
  const base = { kilometrage_le: jour(-2), revision_tous_les_km: 20_000 };
  const loin = vehicule({ ...base, kilometrage: 100_000, revision_km: 120_000 });
  assert.deepEqual(situationsVehicule(loin, null, ctx), [], 'encore 20 000 km : rien à dire');
  assert.equal(par(loin, 'revision')?.kmRestants, 20_000);

  const proche = situationsVehicule(vehicule({ ...base, kilometrage: 119_500, revision_km: 120_000 }), null, ctx);
  assert.equal(proche.length, 1);
  assert.equal(proche[0]?.gravite, 'attention');
  assert.equal(proche[0]?.statut, 'ouverte');
  assert.equal(proche[0]?.regle, 'vehicule_km_revision');
  assert.equal(proche[0]?.description, 'Révision ou entretien : dans 500 kilomètres');

  const passe = situationsVehicule(vehicule({ ...base, kilometrage: 121_200, revision_km: 120_000 }), null, ctx);
  assert.equal(passe[0]?.gravite, 'critique');
  assert.equal(passe[0]?.description, 'Révision ou entretien : seuil de kilométrage dépassé de 1 200 kilomètres');
  assert.equal(par(vehicule({ ...base, kilometrage: 121_200, revision_km: 120_000 }), 'revision')?.statut, 'depassee');
});

test('l’état montré est le plus pressant des deux : la date et le compteur comptent autant', () => {
  const v = vehicule({ kilometrage: 99_000, kilometrage_le: jour(-1), prochaine_revision: jour(300), revision_km: 99_500 });
  assert.equal(par(v, 'revision')?.statut, 'bientot', 'la date est loin, le compteur est proche');
});

test('un kilométrage trop vieux est rappelé, mais seulement si une échéance en dépend', () => {
  const vieux = vehicule({ kilometrage: 80_000, kilometrage_le: jour(-(JOURS_KM_PERIME + 1)), revision_km: 90_000 });
  const s = situationsVehicule(vieux, null, ctx);
  assert.equal(s.at(-1)?.regle, 'vehicule_kilometrage');
  assert.equal(s.at(-1)?.statut, 'a_verifier', 'une donnée trop vieille se vérifie, elle ne se décrète pas urgente');
  assert.match(s.at(-1)?.description ?? '', /^Kilométrage : relevé il y a 91 jours/);
  assert.equal(kilometrageDe(vieux, MAINTENANT).perime, true);

  const jamais = vehicule({ revision_km: 90_000 });
  assert.match(situationsVehicule(jamais, null, ctx)[0]?.description ?? '', /^Kilométrage : jamais relevé/);

  // aucune échéance au kilométrage : on ne réclame pas un compteur dont personne n'a besoin
  assert.deepEqual(situationsVehicule(vehicule({ controle_technique: jour(400) }), null, ctx), []);
  const frais = vehicule({ kilometrage: 80_000, kilometrage_le: jour(-3), revision_km: 90_000 });
  assert.deepEqual(situationsVehicule(frais, null, ctx), []);
  assert.equal(kilometrageDe(frais, MAINTENANT).jours, 3);
});

test('répétition : la fois suivante se calcule en mois et en kilomètres', () => {
  const v = vehicule({ kilometrage: 100_000, kilometrage_le: jour(0), revision_tous_les_mois: 12, revision_tous_les_km: 25_000 });
  const d = defEcheance('revision');
  assert.ok(d);
  assert.deepEqual(prochaineOccurrence(v, d, '2026-11-13', 101_000), { date: '2027-11-13', km: 126_000 });
  // sans répétition enregistrée, la valeur proposée est indicative et sert de repli
  assert.deepEqual(prochaineOccurrence(vehicule(), d, '2026-11-13', 50_000), { date: '2027-11-13', km: 70_000 });
  // l'échéance libre n'a rien à proposer tant que l'entreprise n'a pas dit sa périodicité
  assert.deepEqual(prochaineOccurrence(vehicule(), defEcheance('libre')!, '2026-11-13', 50_000), { date: null, km: null });
  assert.deepEqual(prochaineOccurrence(vehicule({ autre_tous_les_mois: 18 }), defEcheance('libre')!, '2026-11-13', null), { date: '2028-05-13', km: null });
  // le 31 ne déborde jamais sur le mois suivant
  assert.equal(ajouterMois('2026-01-31', 1), '2026-02-28');
  assert.equal(ajouterMois('2028-01-31', 1), '2028-02-29');
  assert.equal(ajouterMois('2026-11-13', 24), '2028-11-13');
});

test('« C’est fait » écrit la suite sur la fiche : prochaine date, prochain compteur, relevé du jour', () => {
  const v = vehicule({ kilometrage: 100_000, kilometrage_le: jour(-30), prochaine_revision: jour(-2), revision_km: 100_500, revision_tous_les_mois: 12, revision_tous_les_km: 25_000 });
  const champs = champsApresFait(v, defEcheance('revision')!, '2026-11-13', 100_600);
  assert.deepEqual(champs, { prochaine_revision: '2027-11-13', revision_km: 125_600, kilometrage: 100_600, kilometrage_le: '2026-11-13' });

  // un compteur plus bas que celui qu'on connaît déjà n'écrase rien (saisie à l'envers)
  const sansRecul = champsApresFait(v, defEcheance('revision')!, '2026-11-13', 90_000);
  assert.equal(sansRecul.kilometrage, undefined);
  assert.equal(sansRecul.revision_km, 115_000);

  // sans répétition connue, la date est effacée plutôt que reconduite au hasard : à reprogrammer à la main
  const libre = champsApresFait(vehicule({ autre_le: jour(-1) }), defEcheance('libre')!, '2026-11-13', null);
  assert.deepEqual(libre, { autre_le: null, autre_km: null });
});

test('historique par véhicule : ce qui a été fait, et le total de l’année', () => {
  const objets = [
    vehicule({}, 'v1'), vehicule({}, 'v2'),
    entretien('e1', { concerne: 'v1', echeance: 'révision ou entretien', fait_le: '2026-03-04', kilometrage: 90_000, cout: 420 }),
    entretien('e2', { concerne: 'v1', echeance: 'pneus', fait_le: '2026-09-21', kilometrage: 99_000, cout: 560 }),
    entretien('e3', { concerne: 'v1', echeance: 'contrôle technique', fait_le: '2025-07-02', cout: 92 }),
    entretien('e4', { concerne: 'v1', echeance: 'assurance', fait_le: '2026-01-10' }),
    entretien('e5', { concerne: 'v2', echeance: 'pneus', fait_le: '2026-05-05', cout: 1_000 }),
  ];
  const h = historiqueDe(objets, 'v1');
  assert.deepEqual(h.map((l) => l.id), ['e2', 'e1', 'e4', 'e3'], 'le plus récent d’abord');
  assert.deepEqual(h.map((l) => l.echeance), ['pneus', 'revision', 'assurance', 'controle_technique']);
  assert.equal(totalAnnee(h, 2026), 980, 'seuls les coûts saisis cette année-là');
  assert.equal(totalAnnee(h, 2025), 92);
  assert.equal(totalAnnee(h, 2024), null, 'aucun coût : inconnu, jamais zéro');
  assert.equal(totalAnnee(historiqueDe(objets, 'v2'), 2026), 1_000, 'chaque véhicule a son propre historique');
  assert.deepEqual(historiqueDe(objets, 'inconnu'), []);
});
