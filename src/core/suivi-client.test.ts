/**
 * LA PAGE DE SUIVI DU CLIENT FINAL, et ses TROIS GARDE-FOUS : aucune donnée d'une autre entreprise, aucun prix
 * d'achat ni marge ni coût interne, et un lien révocable dont la page ne montre plus rien.
 *
 * Ces trois-là ne sont pas des précautions d'écran : ce sont des essais, ici, sur la fonction qui compose la page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerUnivers } from '../config/univers.ts';
import type { ObjetMetier, ValeurChamp } from './model.ts';
import { contexteDe, suiviDe, type Suivi } from './suivi.ts';
import { fuite, lireAffichage, pageClient, pageFermee, pageSure, titrePage, vueLien, type LienSuivi } from './suivi-client.ts';
import { personnaliser, type Univers } from './univers.ts';

const U = await chargerUnivers('generique');
const BTP = await chargerUnivers('btp');
const COMMERCE = await chargerUnivers('commerce');
const MAINTENANT = new Date('2026-11-16T09:00:00Z');
const ctx = contexteDe(MAINTENANT);
const jour = (n: number) => new Date(MAINTENANT.getTime() + n * 86_400_000).toISOString().slice(0, 10);

const objet = (
  id: string, type: string, champs: Record<string, ValeurChamp>, famille: ObjetMetier['famille'], nom = id, orgId = 'org',
): ObjetMetier => ({
  id, orgId, famille, type, roles: [], nom, champs,
  provenance: 'declare', source: { id: 'test', libelle: 'Essai', derniereSynchro: MAINTENANT.toISOString() },
  majLe: MAINTENANT.toISOString(), disponibilite: 'disponible', mode: 'reel',
});
const projet = (champs: Record<string, ValeurChamp> = {}, nom = 'Maison Le Goff', orgId = 'org') => objet('p1', 'projet', champs, 'projet', nom, orgId);
const tache = (id: string, nom: string, champs: Record<string, ValeurChamp>) => objet(id, 'tache', champs, 'tache', nom);

const lien = (x: Partial<LienSuivi> = {}): LienSuivi => ({
  id: 'sv-0123456789ab', empreinte: 'e', orgId: 'org', suiviId: 'p1',
  creeLe: MAINTENANT.toISOString(), creePar: 'emp1', revoqueLe: null, ouvertLe: null, dernierLe: null, ouvertures: 0,
  ...x,
});

/** Le suivi d'un chantier avec deux étapes, l'une faite, l'autre à venir. */
function chantier(u: Univers = BTP, o: ObjetMetier = projet({ echeance: jour(20), client: 'cl1' })): { objet: ObjetMetier; suivi: Suivi } {
  const taches = [
    tache('t1', 'Terrassement', { concerne: 'p1', echeance: jour(-10), statut: 'terminée' }),
    tache('t2', 'Couler la dalle', { concerne: 'p1', echeance: jour(3), statut: 'à faire' }),
  ];
  const suivi = suiviDe(u, o, ctx, { tachesLiees: taches });
  assert.ok(suivi);
  return { objet: o, suivi };
}

// ------------------------------------------------------------------ le titre, nommé par l'univers

test('« Suivre mon chantier », « Suivre ma commande », « Suivre mon dossier » : le nom vient de l’univers', () => {
  assert.equal(titrePage(BTP, projet()), 'Suivre mon chantier', 'BTP nomme son projet « Chantier »');
  assert.equal(titrePage(U, projet()), 'Suivre mon projet', 'l’univers générique dit « Projet »');
  // une entreprise qui appelle ses affaires des « dossiers » lit « Suivre mon dossier » : rien n'est écrit en dur
  const cabinet = personnaliser(U, { id: 'cabinet', nom: 'Cabinet', version: 1, herite: 'generique', types: [{ id: 'projet', libelle: 'Dossier', pluriel: 'Dossiers' }] });
  assert.equal(titrePage(cabinet, projet()), 'Suivre mon dossier');
  // le genre est déclaré dans l'univers : « Commande » est féminin, et la phrase s'accorde
  const boutique = personnaliser(U, { id: 'boutique', nom: 'Boutique', version: 1, herite: 'generique', types: [{ id: 'commande_client', libelle: 'Commande', pluriel: 'Commandes', genre: 'f' }] });
  assert.equal(titrePage(boutique, objet('c1', 'commande_client', {}, 'commande', 'CMD-3')), 'Suivre ma commande');
  assert.equal(titrePage(COMMERCE, objet('c1', 'commande_client', {}, 'commande', 'CMD-3')), 'Suivre ma vente', 'Commerce dit « Vente », au féminin');
});

// ------------------------------------------------------------------ ce que le client voit

test('le client voit où ça en est, la prochaine étape, les photos, et l’avis à la fin', () => {
  const { objet: o, suivi } = chantier();
  const p = pageClient(BTP, lien(), o, suivi, 'SARL Le Goff Bâtiment', {
    photos: [{ lien: 'https://photos.exemple.fr/dalle.jpg', le: '2026-11-10' }, { lien: 'http://pas-sur.example/x.jpg', le: null }],
  });
  assert.equal(p.etat, 'ouverte');
  assert.ok(p.etat === 'ouverte');
  assert.equal(p.titre, 'Suivre mon chantier');
  assert.equal(p.entreprise, 'SARL Le Goff Bâtiment');
  assert.equal(p.reference, 'Maison Le Goff');
  assert.equal(p.prochaine, 'Couler la dalle');
  assert.match(p.phrase, /Couler la dalle : dans 3 jours/);
  assert.deepEqual(p.etapes.map((e) => e.libelle), ['Échéance', 'Terrassement', 'Couler la dalle']);
  assert.deepEqual(p.avancement, { faites: 1, total: 3 });
  assert.equal(p.termine, false);
  assert.deepEqual(p.photos, [{ lien: 'https://photos.exemple.fr/dalle.jpg', le: '2026-11-10' }], 'seule une adresse https entre');
  assert.equal(p.avis, null, 'la demande d’avis attend la fin du chantier');
});

test('la demande d’avis n’arrive qu’à la fin, et seulement si l’entreprise en a préparé une', () => {
  const o = objet('p1', 'commande_client', { statut: 'livrée', livraison_prevue: jour(-2), client: 'cl1' }, 'commande', 'CMD-3');
  const suivi = suiviDe(U, o, ctx);
  assert.ok(suivi);
  assert.equal(suivi.termine, true);
  const avec = pageClient(U, lien(), o, suivi, 'Boulangerie', { lienAvis: 'https://chez-moi.exemple.fr/f/abc' });
  assert.ok(avec.etat === 'ouverte');
  assert.deepEqual(avec.avis, { lien: 'https://chez-moi.exemple.fr/f/abc' });
  assert.equal(avec.phrase, 'C’est terminé.');
  const sans = pageClient(U, lien(), o, suivi, 'Boulangerie');
  assert.ok(sans.etat === 'ouverte');
  assert.equal(sans.avis, null);
  // une adresse qui n'est pas en https ne devient jamais un bouton
  const douteux = pageClient(U, lien(), o, suivi, 'Boulangerie', { lienAvis: 'javascript:alert(1)' });
  assert.ok(douteux.etat === 'ouverte');
  assert.equal(douteux.avis, null);
});

// ------------------------------------------------------------------ montrer le retard, ou dire l'étape en cours

/** Un chantier dont la charpente est dépassée de deux jours : exactement le cas qui a posé la question. */
function enRetard(): { objet: ObjetMetier; suivi: Suivi } {
  const o = projet({ echeance: jour(20), client: 'cl1' });
  const taches = [
    tache('t1', 'Terrassement', { concerne: 'p1', echeance: jour(-20), statut: 'terminée' }),
    tache('t2', 'Charpente', { concerne: 'p1', echeance: jour(-2), statut: 'à faire' }),
  ];
  const suivi = suiviDe(BTP, o, ctx, { tachesLiees: taches });
  assert.ok(suivi);
  return { objet: o, suivi };
}

test('par défaut la page dit le retard : « Charpente : dépassée de 2 jours »', () => {
  const { objet: o, suivi } = enRetard();
  assert.deepEqual(lireAffichage(undefined), { montrerRetard: true }, 'montrer est le défaut, et un réglage absent ne le change pas');
  const p = pageClient(BTP, lien(), o, suivi, 'Charpente Kerlann');
  assert.ok(p.etat === 'ouverte');
  assert.match(p.phrase, /Charpente : dépassée de 2 jours/);
  const charpente = p.etapes.find((e) => e.libelle === 'Charpente');
  assert.equal(charpente?.etat, 'depassee', 'le client voit que ça coince');
  assert.equal(charpente?.jour, jour(-2));
});

test('réglage fermé : la page dit l’étape en cours, et ne laisse plus deviner le retard', () => {
  const { objet: o, suivi } = enRetard();
  const p = pageClient(BTP, lien(), o, suivi, 'Charpente Kerlann', {}, { montrerRetard: false });
  assert.ok(p.etat === 'ouverte');
  assert.equal(p.phrase, 'Charpente : en cours', 'ni « dépassée », ni un nombre de jours');
  assert.equal(p.prochaine, 'Charpente');
  assert.equal(/dépass|retard|\d+ jours?/i.test(JSON.stringify(p)), false, 'rien dans la page ne dit le retard');
  // les étapes RESTENT : seul le retard sort de la page, et ce qui est fait garde sa date
  assert.deepEqual(p.etapes.map((e) => e.libelle), ['Échéance', 'Terrassement', 'Charpente']);
  const faite = p.etapes.find((e) => e.libelle === 'Terrassement');
  assert.equal(faite?.etat, 'faite');
  assert.equal(faite?.jour, jour(-20), 'une étape terminée garde sa date : c’est de l’histoire, pas un retard');
  const charpente = p.etapes.find((e) => e.libelle === 'Charpente');
  assert.equal(charpente?.etat, 'a_venir', 'jamais alarmant, jamais mensonger : elle vient');
  assert.equal(charpente?.jour, null);
  // aucun nom de champ de la page du client ne ressemble à un mot d'argent (« encours »)
  assert.equal(Object.keys(charpente ?? {}).some((k) => /encours/i.test(k)), false);
  assert.deepEqual(p.avancement, { faites: 1, total: 3 }, 'l’avancement, lui, ne change pas');
  // le réglage ne cache rien d'autre, et une valeur abîmée revient à « montrer »
  assert.deepEqual(lireAffichage({ montrerRetard: 'peut-être' }), { montrerRetard: true });
  assert.deepEqual(lireAffichage({ montrerRetard: false }), { montrerRetard: false });
});

// ------------------------------------------------------------------ garde-fou 1 : aucune donnée d'une autre entreprise

test('garde-fou : aucune donnée d’une autre entreprise, et un lien ne montre que SON suivi', () => {
  const { objet: o, suivi } = chantier();
  // le suivi appartient à une autre organisation que le lien : la page se ferme, et ne dit même pas pourquoi au client
  const autre = pageClient(BTP, lien({ orgId: 'une-autre-entreprise' }), o, suivi, 'SARL Le Goff Bâtiment');
  assert.equal(autre.etat, 'fermee');
  assert.ok(autre.etat === 'fermee');
  assert.equal(autre.refus, 'autre_entreprise');
  assert.equal(JSON.stringify(autre).includes('Le Goff'), false, 'rien du suivi ne sort, pas même un nom');
  // le lien porte un autre suivi que celui qu'on lui présente : refusé aussi
  const ailleurs = pageClient(BTP, lien({ suiviId: 'p2' }), o, suivi, 'SARL Le Goff Bâtiment');
  assert.ok(ailleurs.etat === 'fermee');
  assert.equal(ailleurs.refus, 'introuvable');
  // et un suivi qui n'existe pas (fiche effacée entre-temps) ne laisse rien filtrer
  assert.ok(pageClient(BTP, lien(), null, null, 'SARL Le Goff Bâtiment').etat === 'fermee');
});

// ------------------------------------------------------------------ garde-fou 2 : aucun prix, aucune marge, aucun coût

test('garde-fou : aucun montant, aucune marge, aucun coût interne ne sort — la page est une liste blanche', () => {
  const o = projet({ echeance: jour(20), client: 'cl1', montant: 48_000, retard_jours: 3, avancement: 40 });
  const { suivi } = chantier(BTP, o);
  const p = pageClient(BTP, lien(), o, suivi, 'SARL Le Goff Bâtiment');
  assert.ok(p.etat === 'ouverte');
  const texte = JSON.stringify(p);
  assert.equal(texte.includes('48000'), false, 'le montant du chantier reste chez l’entreprise');
  assert.equal(texte.includes('montant'), false);
  assert.equal(texte.includes('retard_jours'), false);
  assert.deepEqual(fuite(p), [], 'le deuxième verrou ne trouve rien');
  assert.equal(pageSure(p), true);
  // un champ ajouté demain à l'univers n'apparaît pas tout seul : la page ne recopie aucun champ
  const enrichi = personnaliser(U, {
    id: 'enrichi', nom: 'Enrichi', version: 1, herite: 'generique',
    types: [{ id: 'projet', champs: [{ id: 'cout_achat', libelle: 'Coût d’achat', type: 'montant', unite: '€' }] }],
  });
  const o2 = objet('p1', 'projet', { echeance: jour(20), cout_achat: 31_500 }, 'projet', 'Maison Le Goff');
  const s2 = suiviDe(enrichi, o2, ctx);
  assert.ok(s2);
  const p2 = pageClient(enrichi, lien(), o2, s2, 'SARL Le Goff Bâtiment');
  assert.ok(p2.etat === 'ouverte');
  assert.equal(JSON.stringify(p2).includes('31500'), false);
  assert.equal(JSON.stringify(p2).includes('cout_achat'), false);
});

test('garde-fou : le deuxième verrou relit la page et refuse un montant arrivé par une autre route', () => {
  // un montant glissé dans le NOM d'une étape (l'entreprise écrit ce qu'elle veut dans ses tâches)
  const taches = [tache('t1', 'Acompte de 6 800 € à demander', { concerne: 'p1', echeance: jour(2), statut: 'à faire' })];
  const o = projet({ echeance: jour(20) });
  const suivi = suiviDe(BTP, o, ctx, { tachesLiees: taches });
  assert.ok(suivi);
  const p = pageClient(BTP, lien(), o, suivi, 'SARL Le Goff Bâtiment');
  assert.ok(p.etat === 'ouverte');
  assert.ok(fuite(p).length > 0, 'un montant chiffré est vu');
  assert.equal(pageSure(p), false, 'cette page-là ne part pas chez le client');
  // les mots qui désignent un coût interne sont vus eux aussi
  const marge = suiviDe(BTP, o, ctx, { tachesLiees: [tache('t2', 'Revoir la marge du lot 2', { concerne: 'p1', echeance: jour(2), statut: 'à faire' })] });
  assert.ok(marge);
  const pm = pageClient(BTP, lien(), o, marge, 'SARL Le Goff Bâtiment');
  assert.ok(pm.etat === 'ouverte');
  assert.deepEqual(fuite(pm), ['marge']);
  // une page fermée est sûre par construction : il n'y a rien dedans
  assert.equal(pageSure(pageFermee('revoque')), true);
});

// ------------------------------------------------------------------ garde-fou 3 : le lien est révocable

test('garde-fou : un lien révoqué ne montre plus RIEN — ni nom, ni étape, ni entreprise', () => {
  const { objet: o, suivi } = chantier();
  const ouvert = pageClient(BTP, lien(), o, suivi, 'SARL Le Goff Bâtiment');
  assert.ok(ouvert.etat === 'ouverte', 'avant la révocation, la page s’ouvre');
  const ferme = pageClient(BTP, lien({ revoqueLe: MAINTENANT.toISOString() }), o, suivi, 'SARL Le Goff Bâtiment');
  assert.equal(ferme.etat, 'fermee');
  assert.ok(ferme.etat === 'fermee');
  assert.equal(ferme.refus, 'revoque');
  const texte = JSON.stringify(ferme);
  for (const secret of ['Le Goff', 'Couler la dalle', 'Terrassement', 'Suivre mon chantier', jour(3)]) {
    assert.equal(texte.includes(secret), false, `« ${secret} » ne doit plus sortir d’un lien retiré`);
  }
  assert.match(ferme.message, /retiré par l’entreprise/, 'et le client comprend ce qui s’est passé');
});

// ------------------------------------------------------------------ ce que l'entreprise voit du lien

test('l’entreprise voit quand son client a ouvert la page, et jamais le jeton', () => {
  const jamais = vueLien(lien());
  assert.equal(jamais.ouvertLe, null);
  assert.match(jamais.phrase, /pas encore ouvert/);
  const une = vueLien(lien({ ouvertLe: '2026-11-14T10:00:00.000Z', dernierLe: '2026-11-14T10:00:00.000Z', ouvertures: 1 }));
  assert.match(une.phrase, /ouvert une fois, le 14\/11\/2026/);
  const trois = vueLien(lien({ ouvertLe: '2026-11-12T10:00:00.000Z', dernierLe: '2026-11-15T18:00:00.000Z', ouvertures: 3 }));
  assert.match(trois.phrase, /ouvert 3 fois, la dernière le 15\/11\/2026/);
  const retire = vueLien(lien({ revoqueLe: MAINTENANT.toISOString(), ouvertures: 2, ouvertLe: '2026-11-12T10:00:00.000Z' }));
  assert.equal(retire.revoque, true);
  assert.match(retire.phrase, /ne montre plus rien/);
  // le jeton et son empreinte ne sortent jamais de la passerelle
  assert.equal(JSON.stringify(une).includes('empreinte'), false);
  assert.equal('empreinte' in une, false);
});
