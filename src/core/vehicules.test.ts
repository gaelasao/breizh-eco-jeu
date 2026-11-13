/**
 * Suivi du matériel roulant : calcul des échéances (date et compteur), répétition, délais de prévenance,
 * « C'est fait », historique et total de l'année. Véhicules comptés en kilomètres, engins en heures de service.
 * Rien n'apparaît tant qu'il n'y a ni véhicule ni engin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ObjetMetier, ValeurChamp } from './model.ts';
import { situationsPour } from './situation.ts';
import { chargerUnivers } from '../config/univers.ts';
import {
  ajouterMois, champsApresFait, compteurDe, defEcheance, defMateriel, defSorte, echeancesDe, estMaterielSuivi,
  defParNature, historiqueDe, JOURS_COMPTEUR_PERIME, NATURES, prochaineOccurrence, situationsMateriel, situationsMateriels,
  sorteMateriel, totalAnnee, TYPE_ENTRETIEN,
} from './vehicules.ts';

const U = await chargerUnivers('generique');
const BTP = await chargerUnivers('btp');
const MAINTENANT = new Date('2026-11-13T09:00:00Z');
const ctx = { maintenant: MAINTENANT, ageMaxMs: 7 * 86_400_000 };
const jour = (n: number) => new Date(MAINTENANT.getTime() + n * 86_400_000).toISOString().slice(0, 10);

const objet = (id: string, type: string, champs: Record<string, ValeurChamp>, famille: ObjetMetier['famille'] = 'ressource'): ObjetMetier => ({
  id, orgId: 'org', famille, type, roles: [], nom: id, champs,
  provenance: 'declare', source: { id: 'test', libelle: 'Essai', derniereSynchro: MAINTENANT.toISOString() },
  majLe: MAINTENANT.toISOString(), disponibilite: 'disponible', mode: 'reel',
});
const vehicule = (champs: Record<string, ValeurChamp> = {}, id = 'v1') => objet(id, 'vehicule', champs);
const engin = (champs: Record<string, ValeurChamp> = {}, id = 'g1') => objet(id, 'engin', champs);
const entretien = (id: string, champs: Record<string, ValeurChamp>) => objet(id, TYPE_ENTRETIEN, champs, 'evenement');
const par = (v: ObjetMetier, idEcheance: string) => echeancesDe(v, MAINTENANT, { toutes: true }).find((x) => x.id === idEcheance);
const regles = (v: ObjetMetier) => situationsPour(U, v, null, ctx).map((s) => `${s.regle}|${s.gravite}|${s.description}`);
const reglesBtp = (v: ObjetMetier) => situationsPour(BTP, v, null, ctx).map((s) => `${s.regle}|${s.gravite}|${s.description}`);

test('un véhicule sans rien ne produit aucune échéance et aucune alerte', () => {
  const v = vehicule();
  assert.deepEqual(echeancesDe(v, MAINTENANT), [], 'rien n’est renseigné : rien à montrer');
  assert.deepEqual(situationsMateriel(v, null, ctx), []);
  assert.deepEqual(regles(v), []);
  // « toutes » sert à l'écran : les six natures sont proposées, vides et sans état
  const toutes = echeancesDe(v, MAINTENANT, { toutes: true });
  assert.deepEqual(toutes.map((x) => x.id), ['controle_technique', 'revision', 'pneus', 'assurance', 'carte_grise', 'libre']);
  assert.ok(toutes.every((x) => x.statut === 'absente' && x.date === null && x.compteur === null));
});

test('aucun matériel roulant : pas la moindre situation à produire', () => {
  const objets = [objet('a1', 'article', { quantite: 5 }), objet('d1', 'document', { valide_jusqu_au: jour(-3) }, 'evenement')];
  assert.deepEqual(situationsMateriels(objets, () => null, ctx), []);
  assert.equal(objets.filter(estMaterielSuivi).length, 0);
  // un équipement n'est pas suivi ; véhicules et engins le sont, quel que soit le nom donné par l'univers
  assert.equal(estMaterielSuivi(objet('e1', 'equipement', {})), false);
  assert.equal(sorteMateriel(objet('e1', 'equipement', {})), null);
  assert.equal(sorteMateriel(vehicule()), 'vehicule');
  assert.equal(sorteMateriel(engin()), 'engin');
  assert.equal(sorteMateriel(objet('c1', 'vehicule_utilitaire', {})), 'vehicule', 'le libellé est libre, l’identifiant du type dit la sorte');
  assert.equal(sorteMateriel(objet('p1', 'engin_de_levage', {})), 'engin');
  // la famille compte : un document nommé « véhicule » n'est pas un véhicule
  assert.equal(sorteMateriel(objet('d2', 'vehicule', {}, 'evenement')), null);
});

test('échéance par date : le délai de prévenance ouvre l’alerte, le dépassement la rend urgente', () => {
  // au-delà du préavis (30 jours pour le contrôle technique) : silence
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
  assert.deepEqual(regles(vehicule({ controle_technique: jour(45) })), [], 'préavis de la règle : 30 jours');
  const tot = vehicule({ controle_technique: jour(45), prevenir_jours: 60 });
  assert.equal(regles(tot).length, 1, 'prévenue 60 jours avant');
  assert.equal(par(tot, 'controle_technique')?.prevenirJours, 60);
  assert.deepEqual(regles(vehicule({ controle_technique: jour(20), prevenir_jours: 7 })), [], 'prévenue 7 jours avant seulement');
  // valeur abîmée ou démesurée : le préavis de la règle reprend la main, l'alerte ne disparaît jamais
  assert.equal(regles(vehicule({ controle_technique: jour(10), prevenir_jours: -5 })).length, 1);
  assert.equal(regles(vehicule({ controle_technique: jour(10), prevenir_jours: 9_000 })).length, 1);
});

test('échéance au compteur : prévenue avant, urgente une fois dépassée', () => {
  const base = { kilometrage_le: jour(-2), revision_tous_les_km: 20_000 };
  const loin = vehicule({ ...base, kilometrage: 100_000, revision_km: 120_000 });
  assert.deepEqual(situationsMateriel(loin, null, ctx), [], 'encore 20 000 km : rien à dire');
  assert.equal(par(loin, 'revision')?.compteurRestant, 20_000);

  const proche = situationsMateriel(vehicule({ ...base, kilometrage: 119_500, revision_km: 120_000 }), null, ctx);
  assert.equal(proche.length, 1);
  assert.equal(proche[0]?.gravite, 'attention');
  assert.equal(proche[0]?.statut, 'ouverte');
  assert.equal(proche[0]?.regle, 'materiel_compteur_revision');
  assert.equal(proche[0]?.description, 'Révision ou entretien : dans 500 kilomètres');

  const passe = situationsMateriel(vehicule({ ...base, kilometrage: 121_200, revision_km: 120_000 }), null, ctx);
  assert.equal(passe[0]?.gravite, 'critique');
  assert.equal(passe[0]?.description, 'Révision ou entretien : seuil du compteur dépassé de 1 200 kilomètres');
  assert.equal(par(vehicule({ ...base, kilometrage: 121_200, revision_km: 120_000 }), 'revision')?.statut, 'depassee');
});

test('le préavis au compteur se change comme le préavis en jours, et vaut pour toutes les échéances', () => {
  const base = { kilometrage_le: jour(-2), kilometrage: 119_500, revision_km: 120_000, pneus_km: 121_000 };
  // valeurs de départ : 1 000 km pour la révision, 1 500 pour les pneus — les deux préviennent déjà
  assert.deepEqual(situationsMateriel(vehicule(base), null, ctx).map((s) => s.regle), ['materiel_compteur_revision', 'materiel_compteur_pneus']);
  assert.equal(par(vehicule(base), 'revision')?.prevenirCompteur, 1_000);
  assert.equal(par(vehicule(base), 'pneus')?.prevenirCompteur, 1_500);

  // prévenir plus tard : un seul nombre sur la fiche, et les deux échéances se taisent
  const tard = vehicule({ ...base, prevenir_km: 200 });
  assert.deepEqual(situationsMateriel(tard, null, ctx), []);
  assert.equal(par(tard, 'revision')?.prevenirCompteur, 200);
  assert.equal(par(tard, 'pneus')?.prevenirCompteur, 200);
  assert.equal(par(tard, 'revision')?.statut, 'ok');

  // prévenir plus tôt, sur une échéance qui ne disait encore rien
  const tot = vehicule({ kilometrage_le: jour(-2), kilometrage: 100_000, revision_km: 105_000, prevenir_km: 6_000 });
  assert.equal(par(tot, 'revision')?.statut, 'bientot');
  assert.equal(situationsMateriel(tot, null, ctx).length, 1);

  // valeur abîmée ou démesurée : la valeur de départ reprend la main
  for (const mauvais of [-5, 0, 500_000]) {
    assert.equal(par(vehicule({ ...base, prevenir_km: mauvais }), 'revision')?.prevenirCompteur, 1_000, `prevenir_km = ${mauvais}`);
  }
});

test('l’état montré est le plus pressant des deux : la date et le compteur comptent autant', () => {
  const v = vehicule({ kilometrage: 99_000, kilometrage_le: jour(-1), prochaine_revision: jour(300), revision_km: 99_500 });
  assert.equal(par(v, 'revision')?.statut, 'bientot', 'la date est loin, le compteur est proche');
});

test('un compteur trop vieux est rappelé, mais seulement si une échéance en dépend', () => {
  const vieux = vehicule({ kilometrage: 80_000, kilometrage_le: jour(-(JOURS_COMPTEUR_PERIME + 1)), revision_km: 90_000 });
  const s = situationsMateriel(vieux, null, ctx);
  assert.equal(s.at(-1)?.regle, 'materiel_compteur');
  assert.equal(s.at(-1)?.statut, 'a_verifier', 'une donnée trop vieille se vérifie, elle ne se décrète pas urgente');
  assert.match(s.at(-1)?.description ?? '', /^Kilométrage : dernier relevé il y a 91 jours/);
  assert.equal(compteurDe(vieux, MAINTENANT).perime, true);

  const jamais = vehicule({ revision_km: 90_000 });
  assert.match(situationsMateriel(jamais, null, ctx)[0]?.description ?? '', /^Kilométrage : aucun relevé/);

  // aucune échéance au compteur : on ne réclame pas un relevé dont personne n'a besoin
  assert.deepEqual(situationsMateriel(vehicule({ controle_technique: jour(400) }), null, ctx), []);
  const frais = vehicule({ kilometrage: 80_000, kilometrage_le: jour(-3), revision_km: 90_000 });
  assert.deepEqual(situationsMateriel(frais, null, ctx), []);
  assert.equal(compteurDe(frais, MAINTENANT).jours, 3);
});

test('un engin se suit comme un véhicule, mais son compteur compte des heures de service', () => {
  const m = defMateriel(engin());
  assert.equal(m?.unite, 'h');
  assert.equal(m?.libelleCompteur, 'Heures de service');
  assert.equal(defMateriel(vehicule())?.unite, 'km');

  // ses échéances lui ressemblent : révision, contrôle périodique, vérification générale, et la sienne
  const toutes = echeancesDe(engin(), MAINTENANT, { toutes: true });
  assert.deepEqual(toutes.map((x) => x.id), ['revision', 'controle_periodique', 'verification_generale', 'libre']);
  assert.ok(toutes.every((x) => x.statut === 'absente'), 'un engin sans rien ne produit rien');
  assert.deepEqual(situationsMateriel(engin(), null, ctx), []);

  // compteur en heures : le relevé, son âge, et la phrase qui l'accompagne
  const g = engin({ heures: 1_180, heures_le: jour(-2), revision_heures: 1_200, revision_toutes_les_heures: 500 });
  const c = compteurDe(g, MAINTENANT);
  assert.deepEqual([c.valeur, c.unite, c.libelle, c.jours, c.perime], [1_180, 'h', 'Heures de service', 2, false]);
  assert.equal(par(g, 'revision')?.compteurRestant, 20);
  const s = situationsMateriel(g, null, ctx);
  assert.equal(s[0]?.description, 'Révision ou entretien : dans 20 heures', 'des heures, jamais des kilomètres');
  assert.equal(s[0]?.gravite, 'attention');
  const passe = situationsMateriel(engin({ heures: 1_260, heures_le: jour(-1), revision_heures: 1_200 }), null, ctx);
  assert.equal(passe[0]?.description, 'Révision ou entretien : seuil du compteur dépassé de 60 heures');
  assert.match(situationsMateriel(engin({ revision_heures: 400 }), null, ctx)[0]?.description ?? '', /^Heures de service : aucun relevé/);

  // préavis au compteur modifiable, en heures aussi
  assert.equal(par(engin({ heures: 1_180, heures_le: jour(-2), revision_heures: 1_200, prevenir_heures: 10 }), 'revision')?.statut, 'ok');
  assert.equal(par(engin({ heures: 1_100, heures_le: jour(-2), revision_heures: 1_200, prevenir_heures: 150 }), 'revision')?.statut, 'bientot');
});

test('les échéances par date d’un engin sont annoncées par l’univers BTP', () => {
  const g = engin({ prochaine_revision: jour(5), controle_periodique_le: jour(10), verification_generale_le: jour(-3), autre_le: jour(5), autre_libelle: 'Flexibles hydrauliques' });
  const vues = reglesBtp(g);
  assert.deepEqual(vues.map((x) => x.split('|')[0]).sort(), ['controle_periodique_engin', 'echeance_engin', 'revision_engin', 'verification_generale_engin']);
  assert.ok(vues.some((x) => x.includes('Vérification générale : échéance dépassée de 3 jours')));
  assert.ok(vues.some((x) => x.includes('Flexibles hydrauliques : échéance dans 5 jours')));
  // le préavis en jours d'un engin se change comme celui d'un véhicule
  assert.deepEqual(reglesBtp(engin({ controle_periodique_le: jour(45) })), []);
  assert.equal(reglesBtp(engin({ controle_periodique_le: jour(45), prevenir_jours: 60 })).length, 1);
});

test('répétition : la fois suivante se calcule en mois et au compteur', () => {
  const v = vehicule({ kilometrage: 100_000, kilometrage_le: jour(0), revision_tous_les_mois: 12, revision_tous_les_km: 25_000 });
  const auto = defSorte('vehicule');
  const d = defEcheance(auto, 'revision');
  assert.ok(d);
  assert.deepEqual(prochaineOccurrence(v, auto, d, '2026-11-13', 101_000), { date: '2027-11-13', compteur: 126_000 });
  // sans répétition enregistrée, la valeur proposée est indicative et sert de repli
  assert.deepEqual(prochaineOccurrence(vehicule(), auto, d, '2026-11-13', 50_000), { date: '2027-11-13', compteur: 70_000 });
  // l'échéance libre n'a rien à proposer tant que l'entreprise n'a pas dit sa périodicité
  assert.deepEqual(prochaineOccurrence(vehicule(), auto, defEcheance(auto, 'libre')!, '2026-11-13', 50_000), { date: null, compteur: null });
  assert.deepEqual(prochaineOccurrence(vehicule({ autre_tous_les_mois: 18 }), auto, defEcheance(auto, 'libre')!, '2026-11-13', null), { date: '2028-05-13', compteur: null });
  // un engin compte ses heures de la même façon
  const pelle = defSorte('engin');
  assert.deepEqual(prochaineOccurrence(engin({ revision_toutes_les_heures: 250 }), pelle, defEcheance(pelle, 'revision')!, '2026-11-13', 1_200), { date: '2027-11-13', compteur: 1_450 });
  // le 31 ne déborde jamais sur le mois suivant
  assert.equal(ajouterMois('2026-01-31', 1), '2026-02-28');
  assert.equal(ajouterMois('2028-01-31', 1), '2028-02-29');
  assert.equal(ajouterMois('2026-11-13', 24), '2028-11-13');
});

test('« C’est fait » écrit la suite sur la fiche : prochaine date, prochain compteur, relevé du jour', () => {
  const auto = defSorte('vehicule');
  const v = vehicule({ kilometrage: 100_000, kilometrage_le: jour(-30), prochaine_revision: jour(-2), revision_km: 100_500, revision_tous_les_mois: 12, revision_tous_les_km: 25_000 });
  const champs = champsApresFait(v, auto, defEcheance(auto, 'revision')!, '2026-11-13', 100_600);
  assert.deepEqual(champs, { prochaine_revision: '2027-11-13', revision_km: 125_600, kilometrage: 100_600, kilometrage_le: '2026-11-13' });

  // un compteur plus bas que celui qu'on connaît déjà n'écrase rien (saisie à l'envers)
  const sansRecul = champsApresFait(v, auto, defEcheance(auto, 'revision')!, '2026-11-13', 90_000);
  assert.equal(sansRecul.kilometrage, undefined);
  assert.equal(sansRecul.revision_km, 115_000);

  // sans répétition connue, la date est effacée plutôt que reconduite au hasard : à reprogrammer à la main
  const libre = champsApresFait(vehicule({ autre_le: jour(-1) }), auto, defEcheance(auto, 'libre')!, '2026-11-13', null);
  assert.deepEqual(libre, { autre_le: null, autre_km: null });

  // un engin écrit ses heures, jamais un kilométrage
  const pelle = defSorte('engin');
  const g = champsApresFait(engin({ heures: 1_180, heures_le: jour(-20), revision_toutes_les_heures: 500 }), pelle, defEcheance(pelle, 'revision')!, '2026-11-13', 1_200);
  assert.deepEqual(g, { prochaine_revision: '2027-11-13', revision_heures: 1_700, heures: 1_200, heures_le: '2026-11-13' });
});

test('historique par matériel : ce qui a été fait, et le total de l’année', () => {
  const objets = [
    vehicule({}, 'v1'), vehicule({}, 'v2'),
    entretien('e1', { concerne: 'v1', echeance: 'révision ou entretien', fait_le: '2026-03-04', kilometrage: 90_000, cout: 420 }),
    entretien('e2', { concerne: 'v1', echeance: 'pneus', fait_le: '2026-09-21', kilometrage: 99_000, cout: 560 }),
    entretien('e3', { concerne: 'v1', echeance: 'contrôle technique', fait_le: '2025-07-02', cout: 92 }),
    entretien('e4', { concerne: 'v1', echeance: 'assurance', fait_le: '2026-01-10' }),
    entretien('e5', { concerne: 'v2', echeance: 'pneus', fait_le: '2026-05-05', cout: 1_000 }),
  ];
  const h = historiqueDe(objets, vehicule({}, 'v1'));
  assert.deepEqual(h.map((l) => l.id), ['e2', 'e1', 'e4', 'e3'], 'le plus récent d’abord');
  assert.deepEqual(h.map((l) => l.echeance), ['pneus', 'revision', 'assurance', 'controle_technique']);
  assert.deepEqual(h.map((l) => l.compteur), [99_000, 90_000, null, null]);
  assert.equal(totalAnnee(h, 2026), 980, 'seuls les coûts saisis cette année-là');
  assert.equal(totalAnnee(h, 2025), 92);
  assert.equal(totalAnnee(h, 2024), null, 'aucun coût : inconnu, jamais zéro');
  assert.equal(totalAnnee(historiqueDe(objets, vehicule({}, 'v2')), 2026), 1_000, 'chaque matériel a son propre historique');
  assert.deepEqual(historiqueDe(objets, vehicule({}, 'inconnu')), []);

  // l'historique d'un engin lit ses heures, et ses natures à lui
  const chantier = [
    engin({}, 'g1'),
    entretien('g-e1', { concerne: 'g1', echeance: 'contrôle périodique', fait_le: '2026-04-02', heures: 900, cout: 310 }),
    entretien('g-e2', { concerne: 'g1', echeance: 'révision ou entretien', fait_le: '2026-10-08', heures: 1_150, cout: 780 }),
  ];
  const hg = historiqueDe(chantier, engin({}, 'g1'));
  assert.deepEqual(hg.map((l) => [l.echeance, l.compteur]), [['revision', 1_150], ['controle_periodique', 900]]);
  assert.equal(totalAnnee(hg, 2026), 1_090);
});

test('chaque nature d’échéance est un choix du type « entretien », sinon l’historique serait refusé', () => {
  const choix = U.types.find((t) => t.id === TYPE_ENTRETIEN)?.champs.find((c) => c.id === 'echeance')?.choix ?? [];
  for (const n of NATURES) assert.ok(choix.includes(n), `nature « ${n} » absente des choix de l’univers`);
  // et chaque sorte sait relire la nature qu'elle a écrite
  for (const sorte of ['vehicule', 'engin'] as const) {
    const m = defSorte(sorte);
    for (const d of m.echeances) assert.equal(defParNature(m, d.nature)?.id, d.id, `${sorte} / ${d.nature}`);
  }
});
