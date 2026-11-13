/**
 * Droit à l'effacement et droit d'accès (constat rgpd-7) : une fiche réelle s'efface ou s'anonymise en cascade
 * (planning, références, journal, connecteurs, formulaires), ne revient ni par la synchro ni par une restauration,
 * et ce que le jeu garde sur elle se télécharge. Durées de conservation choisies par l'entreprise.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';

const jour = (decalage: number) => new Date(Date.now() + decalage * 86_400_000).toISOString().slice(0, 10);

async function monter(o: Parameters<typeof Application.creer>[0] = {}) {
  const app = await Application.creer({ exemple: 'pme', ...o });
  const p = app.monde.profil('dirigeante')!;
  app.monde.viderDemo(p, 's', { nom: 'Menuiserie Kerlann' });
  return { app, p };
}

test('effacer un client particulier : fiche, références, titres et journal nettoyés ; trace sans nom', async () => {
  const { app, p } = await monter();
  const client = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Jeanne Le Goff', roles: ['client'], champs: { email: 'jeanne.legoff@legoff.example', ville: 'Quimper' } });
  const facture = app.monde.creerObjet(p, 's', { type: 'facture', nom: 'Facture F-12', champs: { tiers: client.id, montant: 120 } });
  const tache = app.monde.creerObjet(p, 's', { type: 'tache', nom: 'Rappeler Jeanne Le Goff', champs: { concerne: client.id, statut: 'à faire' } });
  assert.ok(app.monde.journalBrut().some((l) => l.detail.includes('Jeanne Le Goff')), 'départ : le nom est au journal');

  const r = app.effacerObjet(p, 's', client.id, {});
  assert.equal(r.mode, 'supprimer');
  assert.equal(r.references, 2);
  assert.equal(app.monde.objetReel(client.id), null);
  assert.equal(app.monde.objetReel(facture.id)?.champs.tiers, undefined, 'référence vidée');
  assert.equal(app.monde.objetReel(facture.id)?.champs.montant, 120, 'le reste de la facture est gardé');
  assert.equal(app.monde.objetReel(tache.id)?.nom, 'Rappeler [effacé]', 'nom retiré du titre de la tâche');
  const journal = JSON.stringify(app.monde.journalBrut());
  assert.ok(!journal.includes('Jeanne Le Goff') && !journal.includes('jeanne.legoff'), 'plus de nom ni d’e-mail au journal');
  assert.ok(app.monde.journalBrut().some((l) => l.action === 'objet.efface' && l.cible === null && l.detail === 'Particulier : fiche effacée'));
  assert.throws(() => app.monde.fiche(p, 's', client.id), /introuvable/);
});

test('effacer un salarié : planning effacé (absence pour maladie comprise) ; anonymiser un avis : chiffres gardés', async () => {
  const { app, p } = await monter();
  const salarie = app.monde.creerObjet(p, 's', { type: 'employe', nom: 'Yannick Corre', champs: { poste: 'Menuisier' } });
  app.monde.affecter(p, 's', { employe: salarie.id, date: jour(1), valeur: 'absence:maladie' });
  assert.ok(app.monde.planningReel().has(salarie.id));
  app.effacerObjet(p, 's', salarie.id, { mode: 'supprimer' });
  assert.equal(app.monde.planningReel().has(salarie.id), false);

  const client = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Loïc Tanguy', roles: ['client'], champs: {} });
  const avis = app.monde.creerObjetSysteme('formulaire:avis', 'avis_client', 'Avis de Loïc Tanguy', { concerne: client.id, note: 9, commentaire: 'Loïc très content, appelez-moi au 06…', recu_le: jour(-2) }, { id: 'formulaire', libelle: 'Formulaire' });
  const r = app.effacerObjet(p, 's', avis, { mode: 'anonymiser' });
  assert.equal(r.mode, 'anonymiser');
  const o = app.monde.objetReel(avis)!;
  assert.equal(o.nom, 'Fiche anonymisée');
  assert.equal(o.champs.note, 9, 'la note compte toujours');
  assert.equal(o.champs.commentaire, undefined, 'texte libre retiré');
  assert.equal(o.source.id, 'effacement', 'jamais renvoyée vers un outil comme une nouvelle fiche');
  assert.ok(!JSON.stringify(app.monde.journalBrut()).includes('Avis de Loïc Tanguy'));
});

test('effacement : administrateur, depuis l’écran seulement, hors simulation ; la fiche de l’entreprise reste', async () => {
  const { app, p } = await monter();
  const client = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Gwen Morvan', roles: ['client'], champs: {} });
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  try {
    const session = async (profilId: string) => {
      const s = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId }) });
      return (s.headers.get('set-cookie') ?? '').split(';')[0] as string;
    };
    const effacer = (entetes: Record<string, string>) => fetch(`${base}/api/v1/objets/${client.id}`, { method: 'DELETE', headers: { 'content-type': 'application/json', 'x-lb-requete': '1', ...entetes }, body: '{}' });
    const { jeton } = app.cles.creer(p, { nom: 'Make', profilId: p.id });
    assert.equal((await effacer({ authorization: `Bearer ${jeton}` })).status, 403, 'clé d’API refusée');
    const collegue = app.monde.creerAcces(p, { nom: 'Nolwenn', role: 'collaborateur', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous' });
    assert.equal((await effacer({ cookie: await session(collegue.id) })).status, 403, 'pas administrateur');
    const admin = await session('dirigeante');
    // droit d'accès d'abord : ce que le jeu garde sur la fiche
    const acces = await (await fetch(`${base}/api/v1/objets/${client.id}/donnees`, { headers: { cookie: admin } })).json() as any;
    assert.equal(acces.fiche.nom, 'Gwen Morvan');
    assert.ok(Array.isArray(acces.journal) && acces.journal.length >= 1);
    assert.equal((await effacer({ cookie: admin })).status, 200);
    assert.equal((await fetch(`${base}/api/v1/objets/${client.id}`, { headers: { cookie: admin } })).status, 404);
  } finally { serveur.closeAllConnections(); await new Promise<void>((ok) => serveur.close(() => ok())); }
  const org = app.monde.objetsReels().find((o) => o.famille === 'organisation')!;
  assert.throws(() => app.effacerObjet(p, 's', org.id, {}), /ne s’efface pas/);
  app.monde.definirSimulation('sim', true);
  const autre = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Erwan Quéré', roles: ['client'], champs: {} });
  assert.throws(() => app.effacerObjet(p, 'sim', autre.id, {}), /simulation/);
});

test('connecteur : la fiche effacée n’est plus réimportée par la lecture suivante', async () => {
  const lignes = [{ id: 'C-1', name: 'Anne Kervella' }, { id: 'C-2', name: 'Paul Riou' }];
  const f = (async () => new Response(JSON.stringify(lignes), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
  const { app, p } = await monter({ fetch: f });
  const c = app.synchro.creer(p, { source: 'rest', config: { url: 'https://9.9.9.9/clients', jeton: 'jeton-rest-faux' }, typeObjet: 'particulier', roles: ['client'], mapping: { name: '__nom' }, sens: 'lecture', intervalleS: 3600, actif: false });
  await app.synchro.synchroniser(c.id, p);
  const anne = app.monde.objetsReels().find((o) => o.nom === 'Anne Kervella')!;
  assert.ok(anne);
  const r = app.effacerObjet(p, 's', anne.id, {});
  assert.deepEqual(r.outils, [c.nom], 'l’écran dit où effacer aussi');
  await app.synchro.synchroniser(c.id, p);
  assert.equal(app.monde.objetsReels().some((o) => o.nom === 'Anne Kervella'), false, 'pas recréée');
  assert.ok(app.monde.objetsReels().some((o) => o.nom === 'Paul Riou'), 'les autres continuent');
});

test('restauration d’une copie d’avant l’effacement : la personne effacée ne revient pas', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-effacement-'));
  try {
    const { app, p } = await monter({ dossier, connexion: 'demo' });
    const client = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Soizic Le Bras', roles: ['client'], champs: {} });
    const garde = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Alan Guéguen', roles: ['client'], champs: {} });
    app.stockage!.ecrireMaintenant();
    app.stockage!.sauvegarderMaintenant('essai'); // copie qui contient encore Soizic
    const copie = app.sauvegardesAuto().find((x) => x.nom.startsWith('essai-'))!;
    app.effacerObjet(p, 's', client.id, {});
    app.stockage!.ecrireMaintenant();
    const restauree = await app.remplacer(app.lireSauvegardeAuto(copie.nom));
    try {
      assert.equal(restauree.monde.objetReel(client.id), null, 'effacement rejoué');
      assert.ok(restauree.monde.objetReel(garde.id), 'le reste de la copie revient');
    } finally { restauree.arreter(); }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test('revue-jeu-1-6 : restauration sur un AUTRE serveur — le registre des effacements suit les sauvegardes, la personne effacée ne revient pas', async () => {
  const ancien = mkdtempSync(join(tmpdir(), 'lb-ancien-'));
  const neuf = mkdtempSync(join(tmpdir(), 'lb-neuf-'));
  const neuf2 = mkdtempSync(join(tmpdir(), 'lb-neuf2-'));
  try {
    const { app, p } = await monter({ dossier: ancien, connexion: 'demo' });
    const client = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Soizic Le Bras', roles: ['client'], champs: {} });
    const garde = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Alan Guéguen', roles: ['client'], champs: {} });
    app.stockage!.ecrireMaintenant();
    app.stockage!.sauvegarderMaintenant('essai'); // copie qui contient encore Soizic
    const copie = app.sauvegardesAuto().find((x) => x.nom.startsWith('essai-'))!;
    app.effacerObjet(p, 's', client.id, {});
    // le registre est recopié dans le dossier des sauvegardes (celui qui part hors du serveur), sous un nom qui n'est pas une sauvegarde
    const registre = readFileSync(join(ancien, 'sauvegardes', 'registre-effacements.jsonl'), 'utf8');
    assert.match(registre, new RegExp(`"id":"${client.id}"`));
    assert.equal(registre.includes('Soizic'), false, 'identifiants seulement, jamais un nom');
    assert.equal(app.sauvegardesAuto().some((x) => x.nom.includes('registre')), false, 'ni listé ni restaurable comme une sauvegarde');
    app.arreter();

    // serveur perdu : sur un serveur neuf, le dossier des sauvegardes revient de la copie hors serveur (registre compris)
    mkdirSync(join(neuf, 'sauvegardes'), { recursive: true });
    for (const f of [copie.nom, 'registre-effacements.jsonl']) copyFileSync(join(ancien, 'sauvegardes', f), join(neuf, 'sauvegardes', f));
    const b = await monter({ dossier: neuf, connexion: 'demo' });
    const restauree = await b.app.remplacer(b.app.lireSauvegardeAuto(copie.nom));
    try {
      assert.equal(restauree.monde.objetReel(client.id), null, 'avant : la personne effacée revenait (registre resté sur l’ancien serveur)');
      assert.ok(restauree.monde.objetReel(garde.id), 'le reste de la copie revient');
      // une première sauvegarde du jour sur le serveur neuf ne vide pas le registre repris
      restauree.stockage!.ecrireMaintenant();
      assert.match(readFileSync(join(neuf, 'sauvegardes', 'registre-effacements.jsonl'), 'utf8'), new RegExp(`"id":"${client.id}"`));
    } finally { restauree.arreter(); }

    // copie exportée restaurée sur un autre serveur : le registre joint à la main est réuni puis rejoué
    const c = await monter({ dossier: neuf2, connexion: 'demo' });
    assert.throws(() => c.app.importerEffacements('pas un registre'), (e: any) => e.statut === 400 && e.code === 'registre_invalide');
    assert.equal(c.app.importerEffacements(registre), 1);
    assert.equal(c.app.importerEffacements(registre), 0, 'idempotent');
    const etat = JSON.parse(readFileSync(join(ancien, 'sauvegardes', copie.nom), 'utf8'));
    const restauree2 = await c.app.remplacer(etat);
    try { assert.equal(restauree2.monde.objetReel(client.id), null, 'effacement rejoué sur l’autre serveur'); } finally { restauree2.arreter(); }
  } finally { for (const d of [ancien, neuf, neuf2]) rmSync(d, { recursive: true, force: true }); }
});

test('durées de conservation choisies par l’entreprise : avis, courrier traité et planning anciens effacés', async () => {
  const { app, p } = await monter();
  const client = app.monde.creerObjet(p, 's', { type: 'particulier', nom: 'Morgane Riou', roles: ['client'], champs: {} });
  const vieil = app.monde.creerObjetSysteme('formulaire:avis', 'avis_client', 'Avis ancien', { concerne: client.id, note: 7, recu_le: jour(-800) }, { id: 'formulaire', libelle: 'Formulaire' });
  const recent = app.monde.creerObjetSysteme('formulaire:avis', 'avis_client', 'Avis récent', { concerne: client.id, note: 8, recu_le: jour(-30) }, { id: 'formulaire', libelle: 'Formulaire' });
  const salarie = app.monde.creerObjet(p, 's', { type: 'employe', nom: 'Tanguy Le Roux', champs: {} });
  app.monde.affecter(p, 's', { employe: salarie.id, date: jour(-60), valeur: 'absence:congé' });
  app.monde.affecter(p, 's', { employe: salarie.id, date: jour(2), valeur: 'mission:déplacement' });
  const courrierTraite = app.monde.creerObjetSysteme('courrier', 'courrier', 'Lettre ancienne', { expediteur: 'Mairie', statut: 'traité', recu_le: jour(-500) }, { id: 'saisie', libelle: 'Saisie' });
  const courrierOuvert = app.monde.creerObjetSysteme('courrier', 'courrier', 'Lettre à traiter', { expediteur: 'Mairie', statut: 'à traiter', recu_le: jour(-500) }, { id: 'saisie', libelle: 'Saisie' });
  assert.deepEqual(app.reglages.conservation, { planning: null, avis: null, courrier: null }, 'aucune durée imposée par défaut');
  assert.deepEqual(app.purgerDonneesAnciennes(), { cases: 0, fiches: 0 });
  app.regler({ conservation: { planning: 183, avis: 730, courrier: 365 } });
  let r = app.purgerDonneesAnciennes();
  assert.equal(r.fiches, 2);
  assert.equal(r.cases, 0, 'planning récent (60 jours) gardé avec 6 mois');
  assert.equal(app.monde.objetReel(vieil), null);
  assert.ok(app.monde.objetReel(recent));
  assert.equal(app.monde.objetReel(courrierTraite), null);
  assert.ok(app.monde.objetReel(courrierOuvert), 'courrier pas encore traité : gardé');
  assert.ok(app.monde.journalBrut().some((l) => l.action === 'conservation.purge'));
  assert.equal(app.instantane().reglages?.conservation.avis, 730, 'réglage enregistré');
  // planning : 6 mois → une case de 60 jours reste ; durée plus courte impossible (6 mois au moins) mais on vérifie la coupe
  app.regler({ conservation: { planning: 183, avis: 730, courrier: 365 } });
  const avant = app.monde.planningReel().get(salarie.id)?.size ?? 0;
  assert.equal(avant, 2);
  app.monde.purgerAnciennes({ planningAvant: jour(0), avisAvant: null, courrierAvant: null });
  assert.deepEqual([...(app.monde.planningReel().get(salarie.id)?.keys() ?? [])], [jour(2)], 'cases passées effacées, à venir gardées');
  r = app.purgerDonneesAnciennes();
  assert.equal(r.fiches, 0);
});
