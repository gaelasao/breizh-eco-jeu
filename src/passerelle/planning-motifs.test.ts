/**
 * Motif d'absence (constat rgpd-8) : un arrêt maladie est une donnée de santé. Les collègues qui voient le planning
 * (profil « terrain », responsables) voient « Absence », sans motif ; seul un profil avec le droit RH
 * (« Voir et saisir les motifs d'absence », par défaut les administrateurs) voit et saisit congé, maladie, formation.
 * Le journal n'écrit jamais le motif.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';

async function monter() {
  const app = await Application.creer({ exemple: 'pme' });
  const dir = app.monde.profil('dirigeante')!;
  const terrain = app.monde.profil('terrain')!;
  const stock = app.monde.profil('responsable-stock')!;
  const pl = app.monde.planning(dir, 's', undefined, 7);
  // une personne que le profil « terrain » voit aussi
  const vueTerrain = app.monde.planning(terrain, 's', undefined, 7);
  const cible = vueTerrain.lignes[0]!;
  return { app, dir, terrain, stock, jour: pl.jours[1] as string, cible };
}

test('planning : une collègue sans droit RH voit « Absence », jamais « maladie »', async () => {
  const { app, dir, terrain, jour, cible } = await monter();
  app.monde.affecter(dir, 's', { employe: cible.id, date: jour, valeur: 'absence:maladie' });
  assert.equal(app.monde.planning(dir, 's', undefined, 7).lignes.find((l) => l.id === cible.id)?.cases[jour], 'absence:maladie', 'la dirigeante (RH) voit le motif');
  const vu = app.monde.planning(terrain, 's', undefined, 7);
  assert.equal(vu.lignes.find((l) => l.id === cible.id)?.cases[jour], 'absence');
  assert.ok(!JSON.stringify(vu).includes('maladie'), 'ni case, ni option « Maladie » pour le profil terrain');
  assert.equal(vu.motifsAbsence, false);
  assert.ok(vu.options.some((o) => o.valeur === 'absence' && o.libelle === 'Absence'));
  // les absences de la démonstration (maladie, congé, formation) sont toutes masquées
  assert.ok(vu.lignes.every((l) => Object.values(l.cases).every((v) => !String(v).startsWith('absence:'))));
});

test('planning : la fiche du jour d’un collègue ne montre pas le motif', async () => {
  const { app, dir, terrain, cible } = await monter();
  const auj = app.monde.planning(dir, 's', undefined, 7).aujourdhui;
  app.monde.affecter(dir, 's', { employe: cible.id, date: auj, valeur: 'absence:maladie' });
  const f = app.monde.fiche(terrain, 's', cible.id) as { objet: { jour: { valeur: string; libelle: string } | null } };
  assert.equal(f.objet.jour?.valeur, 'absence');
  assert.equal(f.objet.jour?.libelle, 'Absence');
});

test('planning : sans droit RH, saisir un motif est refusé ; « Absence » garde le motif déjà saisi par les RH', async () => {
  const { app, dir, stock } = await monter();
  const ligne = app.monde.planning(stock, 's', undefined, 7).lignes[0]!;
  const jour = app.monde.planning(stock, 's', undefined, 7).jours[2] as string;
  assert.throws(() => app.monde.affecter(stock, 's', { employe: ligne.id, date: jour, valeur: 'absence:maladie' }), (e: { code?: string; statut?: number }) => e.code === 'motif_reserve' && e.statut === 403);
  app.monde.affecter(dir, 's', { employe: ligne.id, date: jour, valeur: 'absence:maladie' });
  const r = app.monde.affecter(stock, 's', { employe: ligne.id, date: jour, valeur: 'absence' }) as { valeur: string };
  assert.equal(r.valeur, 'absence', 'la réponse ne révèle pas le motif');
  assert.equal(app.monde.planningReel().get(ligne.id)?.get(jour), 'absence:maladie', 'le motif saisi par les RH est gardé');
  // la dirigeante peut retirer le motif
  app.monde.affecter(dir, 's', { employe: ligne.id, date: jour, valeur: 'absence' });
  assert.equal(app.monde.planningReel().get(ligne.id)?.get(jour), 'absence');
});

test('planning : le journal n’écrit jamais le motif d’une absence', async () => {
  const { app, dir, jour, cible } = await monter();
  app.monde.affecter(dir, 's', { employe: cible.id, date: jour, valeur: 'absence:maladie' });
  const traces = app.monde.journalBrut().filter((l) => l.action === 'planning.affecte');
  assert.ok(traces.length > 0);
  assert.ok(traces.every((l) => !l.detail.includes('maladie')), JSON.stringify(traces));
  assert.ok(traces.some((l) => l.detail.endsWith('→ absence')));
});

test('accès : le droit RH se donne explicitement à un profil', async () => {
  const { app, dir, terrain, jour, cible } = await monter();
  app.monde.affecter(dir, 's', { employe: cible.id, date: jour, valeur: 'absence:maladie' });
  const liste = app.monde.listerAcces(dir).profils;
  assert.equal(liste.find((x) => x.id === 'terrain')?.voitMotifsAbsence, false);
  app.monde.modifierAcces(dir, 'terrain', { voitMotifsAbsence: true });
  assert.equal(app.monde.planning(app.monde.profil('terrain')!, 's', undefined, 7).lignes.find((l) => l.id === cible.id)?.cases[jour], 'absence:maladie');
  assert.equal(terrain.voitMotifsAbsence, false, 'profil d’origine non modifié en place');
});

test('score de santé : sans le droit RH, ni « absences maladie » ni « temps de formation » ne se lisent (revue-jeu-1-3)', async () => {
  // profil créé par l'écran des accès : il voit le score, pas les motifs d'absence (les deux cases sont indépendantes)
  const vueDuChef = async (valeur: string) => {
    const { app, dir, cible } = await monter();
    const cree = app.monde.creerAcces(dir, { nom: 'Chef d’équipe', role: 'responsable', types: 'tous', lieux: 'tous', departements: 'tous', rolesTiers: 'tous', voitScore: true, voitMotifsAbsence: false }) as { id: string };
    const chef = app.monde.profil(cree.id)!;
    const jours = app.monde.planning(dir, 's', undefined, 14).jours.slice(1, 3) as string[];
    for (const j of jours) app.monde.affecter(dir, 's', { employe: cible.id, date: j, valeur });
    return { app, dir, chef, sante: app.sante(chef, 's') };
  };
  const maladie = await vueDuChef('absence:maladie');
  const social = maladie.sante.domaines.find((d) => d.id === 'social')!;
  for (const id of ['absenteisme', 'formation']) {
    const c = social.criteres.find((x) => x.id === id)!;
    assert.deepEqual({ score: c.score, mesure: c.mesure, valeur: c.valeur, statut: c.statut, reserve: c.reserve }, { score: null, mesure: null, valeur: null, statut: 'inconnu', reserve: true }, id);
    assert.match(c.source, /motifs d’absence/);
  }
  assert.equal(JSON.stringify(maladie.sante).includes('des jours planifiés'), false, 'aucun taux d’absence ni de formation dans ce que lit ce profil');
  // ce que ce profil lit est le même que l'absence soit un arrêt maladie, un congé ou sans motif : rien à déduire
  const sansCalculeLe = (s: unknown) => JSON.stringify({ ...(s as object), calculeLe: null });
  assert.equal(sansCalculeLe(maladie.sante), sansCalculeLe((await vueDuChef('absence')).sante));
  assert.equal(sansCalculeLe(maladie.sante), sansCalculeLe((await vueDuChef('absence:congé')).sante));
  // la dirigeante (droit RH) lit toujours les deux critères, et l'arrêt maladie pèse dans SA note
  const rh = maladie.app.sante(maladie.dir, 's').domaines.find((d) => d.id === 'social')!;
  assert.equal(typeof rh.criteres.find((x) => x.id === 'absenteisme')?.score, 'number');
  assert.match(rh.criteres.find((x) => x.id === 'absenteisme')?.mesure ?? '', /des jours planifiés/);
  assert.equal(rh.criteres.find((x) => x.id === 'absenteisme')?.reserve, undefined);
});
