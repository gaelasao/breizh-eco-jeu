/**
 * LE MOTEUR DE SUIVI. Ce que ces essais vérifient, dans l'ordre : les quatre mécaniques d'avant entrent bien dans un
 * seul moteur (matériel, papiers, factures, devis), les étapes et le vocabulaire viennent de l'UNIVERS et jamais du
 * code, les quatre portes sortent ce qu'il faut et rien de plus, et une échéance qui n'est plus due ne sort plus.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerUnivers } from '../config/univers.ts';
import type { ObjetMetier, ValeurChamp } from './model.ts';
import { situationsPour } from './situation.ts';
import { personnaliser, type Univers } from './univers.ts';
import {
  cleSortie, contexteDe, defSujet, libelleSujet, lirePortes, PORTES, PORTES_DEFAUT, phraseEcheance, portesAlerte,
  portesDe, situationsRetenues, sorties, sortiesDe, suiviDe, suivis, sujetDe, sujetsDeLUnivers, SUJETS,
  SUJETS_HORS_MOTEUR, typeNommant, champDestinataire, champResponsable, lignes,
} from './suivi.ts';
import { situationsMateriels } from './vehicules.ts';

const U = await chargerUnivers('generique');
const BTP = await chargerUnivers('btp');
const COMMERCE = await chargerUnivers('commerce');
const MAINTENANT = new Date('2026-11-16T09:00:00Z');
const ctx = contexteDe(MAINTENANT);
const JOUR = 86_400_000;

/** Un jour AAAA-MM-JJ à N jours d'aujourd'hui (négatif = passé). */
const jour = (n: number) => new Date(MAINTENANT.getTime() + n * JOUR).toISOString().slice(0, 10);

const objet = (
  id: string, type: string, champs: Record<string, ValeurChamp>,
  famille: ObjetMetier['famille'], nom = id, orgId = 'org',
): ObjetMetier => ({
  id, orgId, famille, type, roles: famille === 'tiers' ? ['client'] : [], nom, champs,
  provenance: 'declare', source: { id: 'test', libelle: 'Essai', derniereSynchro: MAINTENANT.toISOString() },
  majLe: MAINTENANT.toISOString(), disponibilite: 'disponible', mode: 'reel',
});
const projet = (champs: Record<string, ValeurChamp> = {}, id = 'p1', nom = 'Le Goff') => objet(id, 'projet', champs, 'projet', nom);
const devis = (champs: Record<string, ValeurChamp> = {}, id = 'd1') => objet(id, 'devis', champs, 'commande', 'DEV-12');
const facture = (champs: Record<string, ValeurChamp> = {}, id = 'f1') => objet(id, 'facture', champs, 'commande', 'FA-7');
const commande = (champs: Record<string, ValeurChamp> = {}, id = 'c1') => objet(id, 'commande_client', champs, 'commande', 'CMD-3');
const vehicule = (champs: Record<string, ValeurChamp> = {}, id = 'v1') => objet(id, 'vehicule', champs, 'ressource', 'Camion');
const document = (champs: Record<string, ValeurChamp> = {}, id = 'doc1') => objet(id, 'document', champs, 'evenement', 'Attestation URSSAF');
const tache = (champs: Record<string, ValeurChamp> = {}, id = 't1', nom = 'Couler la dalle') => objet(id, 'tache', champs, 'tache', nom);

// ------------------------------------------------------------------ les quatre mécaniques dans un seul moteur

test('les quatre mécaniques d’avant entrent dans le moteur : matériel, papiers, factures, devis', () => {
  const quatre = [
    vehicule({ controle_technique: jour(10), prevenir_jours: 30 }),
    document({ valide_jusqu_au: jour(12), categorie: 'attestation' }),
    facture({ echeance: jour(-6), payee: false, retard_jours: 6 }),
    devis({ statut: 'envoyé' }),
  ];
  const vus = suivis(U, quatre, ctx).map((s) => s.sujet);
  assert.deepEqual(vus, ['devis', 'facture', 'materiel', 'papiers'], 'les quatre sujets sortent du même calcul');
  // et chacun porte au moins une étape : le moteur ne range pas une fiche vide
  for (const s of suivis(U, quatre, ctx)) assert.ok(s.etapes.length > 0, `${s.sujet} sans étape`);
});

test('le moteur ne refait aucune situation : il n’y a toujours qu’une seule source de vérité', () => {
  const v = vehicule({ controle_technique: jour(5), prevenir_jours: 30, kilometrage: 100_000, kilometrage_le: jour(-2), revision_km: 100_200, prevenir_km: 1_000 });
  // les règles de l'univers et vehicules.ts décident ; le moteur range la MÊME échéance sous une étape
  const parLesRegles = [...situationsPour(U, v, null, { maintenant: MAINTENANT, ageMaxMs: 7 * JOUR }), ...situationsMateriels([v], () => null, { maintenant: MAINTENANT, ageMaxMs: 7 * JOUR })];
  const s = suiviDe(U, v, ctx);
  assert.ok(s);
  const regles = new Set(s.etapes.map((e) => e.regle).filter((r): r is string => r !== null));
  for (const sit of parLesRegles) assert.ok(regles.has(sit.regle), `la règle ${sit.regle} n’a pas d’étape dans le moteur`);
  assert.ok(s.etapes.some((e) => e.compteur !== null), 'l’échéance au compteur est une étape comme les autres');
});

test('« garantie et entretien » n’est pas rentré, et le moteur le dit au lieu de faire semblant', () => {
  assert.ok(SUJETS_HORS_MOTEUR.includes('garantie'));
  assert.equal(SUJETS.some((s) => s.id === 'garantie'), false, 'aucun sujet « garantie » déclaré : rien ne mentirait là-dessus');
  // le type qui enregistre un entretien dit ce qui a été FAIT, pas ce qui est DÛ : il n’est donc pas un suivi
  assert.equal(sujetDe(objet('e1', 'entretien_vehicule', { fait_le: jour(-30) }, 'evenement')), null);
});

// ------------------------------------------------------------------ les étapes et les mots viennent de l'univers

test('le vocabulaire vient de l’univers : « Projet », « Chantier », « Vente »', () => {
  const chantier = defSujet('chantier');
  assert.ok(chantier);
  assert.equal(libelleSujet(U, chantier), 'Projet');
  assert.equal(libelleSujet(BTP, chantier), 'Chantier', 'BTP renomme, le moteur suit');
  assert.equal(libelleSujet(BTP, chantier, 2), 'Chantiers');
  const livraison = defSujet('livraison');
  assert.ok(livraison);
  assert.equal(libelleSujet(COMMERCE, livraison), 'Vente');
  // Commerce masque le projet : son sujet « chantier » disparaît de ses écrans au lieu de s'appeler « Projet »
  assert.equal(typeNommant(COMMERCE, chantier), null);
  assert.equal(sujetsDeLUnivers(COMMERCE).some((s) => s.id === 'chantier'), false);
  assert.ok(sujetsDeLUnivers(BTP).some((s) => s.id === 'chantier'));
});

test('les étapes d’un parcours sont les choix déclarés dans l’univers, dans leur ordre', () => {
  const s = suiviDe(U, devis({ statut: 'envoyé' }), ctx);
  assert.ok(s);
  const parcours = s.etapes.filter((e) => e.id.startsWith('parcours:'));
  assert.deepEqual(parcours.map((e) => e.libelle), ['Brouillon', 'Envoyé', 'Accepté', 'Refusé'], 'les mots sont ceux de l’univers');
  assert.deepEqual(parcours.map((e) => e.faite), [true, false, false, false], 'ce qui précède l’étape en cours est fait');
  assert.equal(s.termine, false);
  assert.equal(suiviDe(U, devis({ statut: 'accepté' }), ctx)?.termine, true, '« accepté » ferme le suivi');
  // un univers qui renomme ses étapes renomme celles du moteur : rien n'est écrit en dur ici
  const autre: Univers = personnaliser(U, {
    id: 'autre', nom: 'Autre', version: 1, herite: 'generique',
    types: [{ id: 'devis', champs: [{ id: 'statut', libelle: 'Statut', type: 'choix', choix: ['à chiffrer', 'remis', 'signé'] }] }],
  });
  assert.deepEqual(suiviDe(autre, devis({ statut: 'remis' }), ctx)?.etapes.filter((e) => e.id.startsWith('parcours:')).map((e) => e.libelle),
    ['À chiffrer', 'Remis', 'Signé']);
});

test('l’échéance d’une étape porte le libellé du champ ou de la règle de l’univers', () => {
  // un champ date du suivi : son libellé, tel que l'univers l'écrit
  assert.equal(suiviDe(U, projet({ echeance: jour(3) }), ctx)?.etapes[0]?.libelle, 'Échéance');
  // une règle d'échéance de l'univers : son libellé, et son préavis
  const liv = suiviDe(U, commande({ livraison_prevue: jour(2), statut: 'en cours' }), ctx);
  const etape = liv?.etapes.find((e) => e.regle === 'livraison_client');
  assert.equal(etape?.libelle, 'Livraison client');
  assert.equal(etape?.etat, 'bientot');
  // un intitulé écrit par l'entreprise l'emporte sur celui de la règle (champLibelle)
  const v = suiviDe(U, vehicule({ autre_le: jour(4), autre_libelle: 'Vidange hydraulique', prevenir_jours: 10 }), ctx);
  assert.equal(v?.etapes.find((e) => e.regle === 'echeance_vehicule')?.libelle, 'Vidange hydraulique');
});

test('les étapes d’un chantier sont les tâches que l’entreprise a écrites, avec leur responsable', () => {
  const objets = [
    projet({ echeance: jour(40), client: 'cl1', departement: 'dep1' }),
    tache({ concerne: 'p1', echeance: jour(2), statut: 'à faire', responsable: 'emp1' }, 't1', 'Couler la dalle'),
    tache({ concerne: 'p1', echeance: jour(-1), statut: 'terminée' }, 't2', 'Terrassement'),
    tache({ concerne: 'autre', echeance: jour(1), statut: 'à faire' }, 't3', 'Rien à voir'),
  ];
  const s = suivis(BTP, objets, ctx).find((x) => x.sujet === 'chantier');
  assert.ok(s);
  const etapes = s.etapes.filter((e) => e.id.startsWith('tache:'));
  assert.deepEqual(etapes.map((e) => e.libelle), ['Couler la dalle', 'Terrassement']);
  assert.equal(etapes.find((e) => e.libelle === 'Terrassement')?.faite, true, 'une tâche terminée est une étape faite');
  assert.equal(etapes.find((e) => e.libelle === 'Couler la dalle')?.responsable, 'emp1');
  assert.equal(s.prochaine?.libelle, 'Couler la dalle', 'la plus pressante des étapes ouvertes');
});

test('responsable et destinataire sont trouvés par leur forme déclarée, jamais par leur nom', () => {
  // un champ « référence vers une personne » : responsable (tâche), conducteur (véhicule)
  assert.equal(champResponsable(U, 'tache'), 'responsable');
  assert.equal(champResponsable(U, 'vehicule'), 'conducteur');
  // un champ « référence vers un tiers client » : client (projet, devis), tiers (facture)
  assert.equal(champDestinataire(U, 'projet'), 'client');
  assert.equal(champDestinataire(U, 'facture'), 'tiers');
  const s = suiviDe(U, projet({ echeance: jour(5), client: 'cl1' }), ctx);
  assert.equal(s?.destinataire, 'cl1');
  // à défaut, le responsable du département du suivi
  const dep = objet('dep1', 'departement', { responsable: 'emp9' }, 'departement', 'Travaux');
  assert.equal(suiviDe(U, projet({ echeance: jour(5), departement: 'dep1' }), ctx, { objets: [dep] })?.responsable, 'emp9');
  // une facture ne se partage pas : le sujet n'est pas « pour le client », donc aucun destinataire n'en sort
  assert.equal(suiviDe(U, facture({ echeance: jour(2), tiers: 'cl1', payee: false }), ctx)?.destinataire, null);
});

test('un drapeau ferme un suivi : une facture payée n’attend plus rien', () => {
  const due = suiviDe(U, facture({ echeance: jour(-4), payee: false, retard_jours: 4 }), ctx);
  assert.equal(due?.termine, false);
  assert.equal(due?.etat, 'depassee');
  const payee = suiviDe(U, facture({ echeance: jour(-4), payee: true }), ctx);
  assert.equal(payee?.termine, true);
  assert.equal(payee?.etat, 'faite');
  assert.equal(payee?.prochaine, null);
});

test('les états : à venir, bientôt, aujourd’hui, dépassée — et le préavis de la fiche l’emporte', () => {
  const etat = (o: ObjetMetier) => suiviDe(U, o, ctx)?.etapes.find((e) => e.regle === 'document_expire')?.etat;
  assert.equal(etat(document({ valide_jusqu_au: jour(90) })), 'a_venir');
  assert.equal(etat(document({ valide_jusqu_au: jour(10) })), 'bientot', 'la règle prévient 30 jours avant');
  assert.equal(etat(document({ valide_jusqu_au: jour(0) })), 'aujourdhui');
  assert.equal(etat(document({ valide_jusqu_au: jour(-1) })), 'depassee');
  // préavis propre à la fiche (champAvantJours) : 60 jours au lieu de 21 sur le véhicule
  const avecPreavis = suiviDe(U, vehicule({ prochaine_revision: jour(40), prevenir_jours: 60 }), ctx);
  assert.equal(avecPreavis?.etapes.find((e) => e.regle === 'revision_vehicule')?.etat, 'bientot');
  assert.equal(suiviDe(U, vehicule({ prochaine_revision: jour(40) }), ctx)?.etapes.find((e) => e.regle === 'revision_vehicule')?.etat, 'a_venir');
});

test('les phrases se lisent : jours, demain, aujourd’hui, et le compteur en kilomètres', () => {
  const p = (o: ObjetMetier, regle: string) => {
    const e = suiviDe(U, o, ctx)?.etapes.find((x) => x.regle === regle);
    return e === undefined ? '' : phraseEcheance(e);
  };
  assert.match(p(document({ valide_jusqu_au: jour(1) }), 'document_expire'), /demain$/);
  assert.match(p(document({ valide_jusqu_au: jour(0) }), 'document_expire'), /aujourd’hui$/);
  assert.match(p(document({ valide_jusqu_au: jour(-3) }), 'document_expire'), /dépassée de 3 jours$/);
  assert.match(p(document({ valide_jusqu_au: jour(5) }), 'document_expire'), /dans 5 jours$/);
  assert.match(p(document({ valide_jusqu_au: jour(-1) }), 'document_expire'), /dépassée de 1 jour$/, 'jamais « 1 jours »');
  const v = vehicule({ kilometrage: 100_000, kilometrage_le: jour(-1), revision_km: 100_800, prevenir_km: 1_000 });
  // `quantiteCompteur` colle le nombre à son unité par une espace insécable : on ne la cherche pas au caractère près
  assert.match(p(v, 'materiel_compteur_revision'), /dans 800\s?kilomètres$/u);
});

// ------------------------------------------------------------------ les quatre portes

test('quatre portes, et rien ne sort tant que l’entreprise n’a pas choisi', () => {
  assert.deepEqual(PORTES.map((p) => p.id), ['agenda', 'tache', 'alerte', 'aujourdhui']);
  assert.deepEqual(PORTES_DEFAUT, ['aujourdhui'], 'par défaut : une ligne dans le jeu, et rien qui sorte');
  assert.deepEqual(portesDe(undefined, 'chantier'), ['aujourdhui']);
  assert.deepEqual(portesDe({ chantier: [] }, 'chantier'), [], 'tout décocher est un choix, pas une erreur');
  assert.deepEqual(portesDe({ chantier: ['agenda', 'agenda', 'inventee'] as never }, 'chantier'), ['agenda'], 'une porte inconnue est ignorée');
  assert.deepEqual(lirePortes(['tache', 'rien']), ['tache']);
  assert.deepEqual(lirePortes('pas une liste'), []);
});

test('une échéance qui approche devient un rendez-vous ET une tâche, sans doublon', () => {
  const s = suiviDe(U, document({ valide_jusqu_au: jour(10) }), ctx);
  assert.ok(s);
  const sorties1 = sortiesDe(s, ['agenda', 'tache']);
  assert.deepEqual(sorties1.map((x) => x.porte), ['agenda', 'tache']);
  assert.equal(sorties1[0]?.jour, jour(10));
  assert.match(String(sorties1[0]?.titre), /^Document Attestation URSSAF — Document$/);
  // la clé ne tient qu'à des identifiants : elle est la même d'un passage à l'autre
  assert.deepEqual(sortiesDe(s, ['agenda', 'tache']).map((x) => x.cle), sorties1.map((x) => x.cle));
  assert.equal(sorties1[0]?.cle, cleSortie('agenda', 'doc1', 'valide_jusqu_au'));
  // et elle ne bouge pas quand le libellé change (seul le titre affiché change)
  const renomme = personnaliser(U, { id: 'r', nom: 'R', version: 1, herite: 'generique', types: [{ id: 'document', libelle: 'Papier', pluriel: 'Papiers' }] });
  const s2 = suiviDe(renomme, document({ valide_jusqu_au: jour(10) }), ctx);
  assert.ok(s2);
  assert.deepEqual(sortiesDe(s2, ['agenda']).map((x) => x.cle), [cleSortie('agenda', 'doc1', 'valide_jusqu_au')]);
  assert.match(String(sortiesDe(s2, ['agenda'])[0]?.titre), /^Papier /);
});

test('ce qui ne sort pas : une étape faite, sans date, encore loin, ou dont le suivi est terminé', () => {
  const loin = suiviDe(U, document({ valide_jusqu_au: jour(200) }), ctx);
  assert.ok(loin);
  assert.deepEqual(sortiesDe(loin, ['agenda', 'tache']), [], 'une échéance dans 200 jours n’encombre pas l’agenda');
  const payee = suiviDe(U, facture({ echeance: jour(-2), payee: true }), ctx);
  assert.ok(payee);
  assert.deepEqual(sortiesDe(payee, ['agenda', 'tache']), [], 'un suivi terminé ne sort plus rien');
  const sansDate = suiviDe(U, devis({ statut: 'envoyé' }), ctx);
  assert.ok(sansDate);
  assert.deepEqual(sortiesDe(sansDate, ['agenda', 'tache']), [], 'une étape de parcours n’est pas une date');
  // et une échéance au compteur non plus : un agenda ne sait pas écrire « dans 800 kilomètres »
  const v = suiviDe(U, vehicule({ kilometrage: 100_000, kilometrage_le: jour(-1), revision_km: 100_100, prevenir_km: 1_000 }), ctx);
  assert.ok(v);
  assert.deepEqual(sortiesDe(v, ['agenda']), []);
});

test('les portes « alerte » et « Aujourd’hui » ne sont pas doublées : le moteur dit seulement où cocher', () => {
  const choix = { papiers: ['alerte'] as const, facture: ['alerte'] as const, chantier: ['aujourdhui'] as const };
  const a = portesAlerte(U, choix, ['echeance', 'facture_retard', 'devis_sans_reponse'], ['echeance']);
  assert.deepEqual(a, [
    { sujet: 'facture', sujetAlerte: 'facture_retard', coche: false },
    { sujet: 'papiers', sujetAlerte: 'echeance', coche: true },
  ], 'chaque sujet renvoie au sujet d’alerte qui existe déjà, et dit s’il est coché');
  // un sujet d'alerte inconnu de alertes.ts ne serait pas inventé ici
  assert.deepEqual(portesAlerte(U, { papiers: ['alerte'] }, [], []), []);
});

test('la porte « Aujourd’hui » filtre les situations déjà calculées, et ne touche à rien d’autre', () => {
  const d = document({ valide_jusqu_au: jour(-5) });
  const a = objet('a1', 'article', { quantite: 0, seuil_alerte: 5 }, 'ressource', 'Vis');
  const objets = [d, a];
  const toutes = objets.flatMap((o) => situationsPour(U, o, null, { maintenant: MAINTENANT, ageMaxMs: 7 * JOUR }));
  assert.ok(toutes.length >= 2);
  // papiers sans la porte « Aujourd'hui » : sa situation est mise de côté
  const gardees = situationsRetenues(toutes, objets, { papiers: [] });
  assert.equal(gardees.some((s) => s.objetId === 'doc1'), false);
  assert.ok(gardees.some((s) => s.objetId === 'a1'), 'le stock ne relève d’aucun sujet de suivi : il passe, intact');
  assert.deepEqual(situationsRetenues(toutes, objets, undefined).length, toutes.length, 'par défaut tout reste dans « Aujourd’hui »');
});

test('les sorties de toute l’entreprise sont stables et triées : deux passages donnent la même liste', () => {
  const objets = [
    document({ valide_jusqu_au: jour(10) }, 'doc1'),
    document({ valide_jusqu_au: jour(-2) }, 'doc2'),
    facture({ echeance: jour(3), payee: false }),
    vehicule({ controle_technique: jour(8), prevenir_jours: 30 }),
  ];
  const choix = { papiers: ['agenda', 'tache'] as const, facture: ['tache'] as const, materiel: ['agenda'] as const };
  const a = sorties(suivis(U, objets, ctx), choix);
  const b = sorties(suivis(U, objets, ctx), choix);
  assert.deepEqual(a, b);
  assert.deepEqual(a.map((x) => x.cle), [...a.map((x) => x.cle)].sort(), 'ordre stable');
  assert.equal(a.filter((x) => x.porte === 'agenda').length, 3, 'deux papiers et un contrôle technique');
  assert.equal(a.filter((x) => x.porte === 'tache').length, 3, 'deux papiers et une facture');
  // la facture n'a pas la porte « agenda » : rien d'elle n'arrive dans l'agenda
  assert.equal(a.some((x) => x.porte === 'agenda' && x.suiviId === 'f1'), false);
});

test('l’écran de l’entreprise : une ligne par suivi, ce qui vient, et combien d’étapes sont faites', () => {
  const objets = [
    projet({ echeance: jour(30), client: 'cl1' }),
    tache({ concerne: 'p1', echeance: jour(-2), statut: 'à faire' }, 't1', 'Couler la dalle'),
    tache({ concerne: 'p1', echeance: jour(-9), statut: 'terminée' }, 't2', 'Terrassement'),
  ];
  const l = lignes(suivis(BTP, objets, ctx), { chantier: ['agenda'] });
  assert.equal(l.length, 1);
  assert.equal(l[0]?.libelleSujet, 'Chantier');
  assert.equal(l[0]?.etat, 'depassee');
  assert.match(String(l[0]?.phrase), /^Couler la dalle : dépassée de 2 jours$/);
  assert.deepEqual(l[0]?.avancement, { faites: 1, total: 3 });
  assert.deepEqual(l[0]?.portes, ['agenda']);
  assert.equal(l[0]?.destinataire, 'cl1');
});
