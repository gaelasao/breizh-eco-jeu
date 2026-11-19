/**
 * LA DEMANDE CLIENT, AVANT LE DEVIS. Ce qui se vérifie ici : une demande entrée est suivie comme un parcours, la
 * date de rappel que l'entreprise a écrite déclenche le rappel (et pas une déduction sur l'étape), le rappel va à
 * l'intérieur, et une demande gagnée ou perdue ne rappelle plus rien.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerUnivers } from '../config/univers.ts';
import type { ObjetMetier, ValeurChamp } from './model.ts';
import { contexteDe, defSujet, suiviDe, sujetDe } from './suivi.ts';
import { defRelance, relancesDues, RELANCES } from './relances.ts';

const U = await chargerUnivers('generique');
const MAINTENANT = new Date('2026-11-19T09:00:00Z');
const ctx = contexteDe(MAINTENANT);
const jour = (n: number) => new Date(MAINTENANT.getTime() + n * 86_400_000).toISOString().slice(0, 10);

const demande = (champs: Record<string, ValeurChamp>, id = 'dm1'): ObjetMetier => ({
  id, orgId: 'org', famille: 'commande', type: 'demande', roles: [], nom: 'Remplacement de la ligne d’air', champs,
  provenance: 'declare', source: { id: 'test', libelle: 'Essai', derniereSynchro: MAINTENANT.toISOString() },
  majLe: MAINTENANT.toISOString(), disponibilite: 'disponible', mode: 'reel',
});
const suivre = (champs: Record<string, ValeurChamp>) => suiviDe(U, demande(champs), ctx);
const rappels = (champs: Record<string, ValeurChamp>) => {
  const s = suivre(champs);
  return s === null ? [] : relancesDues([s], undefined, {}, ctx);
};

test('une demande entrée est suivie, et son parcours vient de l’univers', () => {
  assert.equal(sujetDe(demande({}))?.id, 'prospection');
  const s = suivre({ statut: 'visite faite' });
  assert.ok(s, 'une demande est suivie');
  assert.equal(s?.termine, false);
  const parcours = s?.etapes.filter((e) => e.id.startsWith('parcours:')).map((e) => e.libelle) ?? [];
  // les étapes ne sont écrites nulle part dans le code : ce sont les choix du champ « Où ça en est »
  assert.deepEqual(parcours, ['Reçue', 'Rendez-vous calé', 'Visite faite', 'Devis à faire', 'Devis remis', 'Gagnée', 'Perdue']);
  assert.equal(defSujet('prospection')?.champEcheance, 'relance_le');
});

test('gagnée ou perdue, la demande sort du suivi : plus un rappel', () => {
  for (const statut of ['gagnée', 'perdue']) {
    assert.equal(suivre({ statut, relance_le: jour(-10) })?.termine, true, statut);
    assert.deepEqual(rappels({ statut, relance_le: jour(-10) }), [], `${statut} : aucun rappel`);
  }
});

test('le rappel suit la DATE écrite, pas l’étape : un appel qu’on vient de prendre se rappelle aussi', () => {
  /* C'est le choix qui compte. Le parcours ne sait dire qui attend que par sa structure : « reçue » est ce que
     l'entreprise prépare, donc l'attente y est nulle — l'appel du matin n'aurait jamais été rappelé. La date notée
     par l'entreprise, elle, vaut pour toutes les étapes. */
  // LE JOUR DIT APPARTIENT À L'ENTREPRISE. Le rappel ne sonne que le lendemain : tant que la journée notée n'est
  // pas passée, l'appel peut encore être fait, et un logiciel qui réclame le matin même de la date qu'on lui a
  // donnée finit par être éteint. Le compteur du menu, lui, compte bien le jour même — c'est la liste du jour.
  assert.equal(rappels({ statut: 'reçue', relance_le: jour(0) }).length, 0, 'le jour dit, la journée est à vous');
  const enRetard = rappels({ statut: 'reçue', relance_le: jour(-1) });
  assert.equal(enRetard.length, 1, 'le lendemain, le rappel est là');
  assert.equal(enRetard[0]?.relance, 'suite');
  assert.equal(enRetard[0]?.jours, 1);
  assert.equal(rappels({ statut: 'reçue', relance_le: jour(2) }).length, 0, 'calé pour jeudi : rien aujourd’hui');
  assert.equal(rappels({ statut: 'devis à faire', relance_le: jour(-4) }).length, 1, 'une étape qui nous revient se rappelle aussi');
  assert.equal(rappels({ statut: 'reçue' }).length, 0, 'sans date notée, rien n’est inventé');
});

test('le rappel va à l’INTÉRIEUR : on appelle un prospect, on ne lui écrit pas qu’il est sans suite', () => {
  /* Un message automatique « votre demande est sans suite » envoyé à quelqu'un qui attend notre devis, c'est
     l'affaire perdue. C'est la seule relance du moteur dont la destination soit dedans sur une échéance. */
  assert.equal(defRelance('suite')?.vers, 'dedans');
  assert.equal(rappels({ statut: 'devis remis', relance_le: jour(-1) })[0]?.vers, 'dedans');
  for (const r of RELANCES) assert.ok(r.sujets.length > 0, `${r.id} : une relance sans sujet ne se déclenche jamais`);
  assert.deepEqual(RELANCES.filter((r) => r.sujets.includes('prospection')).map((r) => r.id), ['suite']);
});

test('le rythme se tait : quatre fois, puis c’est à l’entreprise de décider', () => {
  const s = suivre({ statut: 'devis remis', relance_le: jour(-30) });
  assert.ok(s);
  const cle = relancesDues([s], undefined, {}, ctx)[0]?.cle ?? '';
  assert.ok(cle, 'un premier rappel');
  const epuise = { [cle]: { fois: 4, dernierJour: jour(-20) } };
  assert.deepEqual(relancesDues([s], undefined, epuise, ctx), [], 'au-delà de quatre fois, le logiciel se tait');
  const hier = { [cle]: { fois: 1, dernierJour: jour(-1) } };
  assert.deepEqual(relancesDues([s], undefined, hier, ctx), [], 'rappelé hier : pas deux fois de suite');
});
