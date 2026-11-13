/**
 * Suivi des véhicules, vu de l'écran (web/vehicules.js, module pur) et de bout en bout par la passerelle :
 * - ce qu'on lit sous une échéance, sans adjectif accordé (l'intitulé peut être masculin ou féminin) ;
 * - la liste, le plus pressant en haut, et le compteur de la rubrique : ce qui est à prévoir, jamais la flotte ;
 * - une entreprise sans véhicule ne voit ni l'entrée du menu, ni l'écran, ni le moindre réglage ;
 * - ajouter un véhicule demande un nom et un type, et rien d'autre ;
 * - « C'est fait » enregistre et programme la suivante ; l'historique et le total de l'année suivent ;
 * - ce qui approche et ce qui est dépassé remontent dans « Aujourd'hui ».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Application } from '../passerelle/application.ts';
import { creerServeur } from '../passerelle/http.ts';

type Quelconque = any;
const V = (await import(new URL('../../web/vehicules.js', import.meta.url).href)) as Quelconque;
const N = (await import(new URL('../../web/navigation.js', import.meta.url).href)) as Quelconque;
const S = (await import(new URL('../../web/simplicite.js', import.meta.url).href)) as Quelconque;
const A = (await import(new URL('../../web/aujourdhui.js', import.meta.url).href)) as Quelconque;
const FI = (await import(new URL('../../web/fiches.js', import.meta.url).href)) as Quelconque;

const jour = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** Client HTTP avec cookie de session, pour lire /api/v1/monde comme le navigateur. */
async function avecServeur<T>(app: Application, profilId: string, f: (appel: (methode: string, chemin: string, corps?: unknown) => Promise<Quelconque>) => Promise<T>): Promise<T> {
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/v1`;
  let cookie = '';
  const appel = async (methode: string, chemin: string, corps?: unknown) => {
    const r = await fetch(base + chemin, { method: methode, headers: { ...(cookie ? { cookie } : {}), ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}) }, body: corps === undefined ? null : JSON.stringify(corps) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0] as string;
    assert.ok(r.ok, `${methode} ${chemin} : ${r.status}`);
    return r.json();
  };
  try {
    await appel('POST', '/session', { profilId });
    return await f(appel);
  } finally {
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
}

/** Une entreprise neuve, sans aucune donnée, et son propriétaire. */
async function entrepriseVide() {
  const app = await Application.creer({ connexion: 'demo', exemple: null });
  const proprietaire = app.monde.initialiser({ nom: 'Maïwenn Le Goff', entreprise: 'Kerlann Bois', depart: 'vide' });
  return { app, proprietaire };
}

const vehiculesDuMonde = (m: Quelconque) => m.objets.filter((o: Quelconque) => o.vehicule);
const echeance = (m: Quelconque, id: string, ech: string) => vehiculesDuMonde(m).find((o: Quelconque) => o.id === id).vehicule.echeances.find((e: Quelconque) => e.id === ech);

test('le délai se lit sans accord : l’intitulé qui précède peut être masculin comme féminin', () => {
  const e = (x: Record<string, unknown>) => ({ joursRestants: null, compteurRestant: null, compteur: null, ...x });
  assert.equal(V.delaiEcheance(e({ joursRestants: -12 })), 'en retard de 12 jours');
  assert.equal(V.delaiEcheance(e({ joursRestants: 0 })), 'aujourd’hui');
  assert.equal(V.delaiEcheance(e({ joursRestants: 1 })), 'demain');
  assert.equal(V.delaiEcheance(e({ joursRestants: 9 })), 'dans 9 jours');
  assert.equal(V.delaiEcheance(e({ compteurRestant: 500 })), 'dans 500 km');
  assert.equal(V.delaiEcheance(e({ compteurRestant: -1400 })), 'compteur dépassé de 1 400 km');
  assert.equal(V.delaiEcheance(e({ joursRestants: -2, compteurRestant: -50 })), 'en retard de 2 jours · compteur dépassé de 50 km');
  // aucun texte n'accorde d'adjectif sur l'intitulé : ni « dépassée », ni « prévue »
  for (const t of [V.delaiEcheance(e({ joursRestants: -1 })), V.delaiEcheance(e({ joursRestants: 30 }))]) {
    assert.doesNotMatch(t, /dépassée|prévue|prévu\b/, t);
  }
});

test('la répétition et la fois suivante se disent en clair, et le proposé est annoncé comme indicatif', () => {
  assert.equal(V.texteRepetition({ periodeMois: 12, periodeCompteur: 20_000 }), 'Tous les 12 mois ou 20 000 km.');
  assert.equal(V.texteRepetition({ periodeMois: 24, periodeCompteur: null }), 'Tous les 24 mois.');
  assert.equal(V.texteRepetition({ periodeMois: null, periodeCompteur: null }), '', 'rien tant que l’entreprise n’a rien dit');
  assert.match(V.texteSuivante({ periodeMois: 12, periodeCompteur: null, suivante: { date: '2027-11-13', compteur: null } }), /^La suivante sera programmée le /);
  assert.match(V.texteSuivante({ periodeMois: null, periodeCompteur: null, suivante: { date: '2028-11-13', compteur: null } }), /indicative|proposée/);
  assert.equal(V.texteSuivante({ periodeMois: null, periodeCompteur: null, suivante: { date: null, compteur: null } }), 'La suivante sera à programmer à la main.');
});

test('le compteur se lit avec son âge, et son relevé n’est réclamé que s’il sert à quelque chose', () => {
  const kmv = (x: Record<string, unknown>) => ({ unite: 'km', libelle: 'Kilométrage', ...x });
  assert.equal(V.texteCompteur(kmv({ valeur: null, jours: null })), 'Kilométrage : aucun relevé.');
  assert.equal(V.texteCompteur(kmv({ valeur: 128_400, jours: 0 })), '128 400 km, dernier relevé aujourd’hui.');
  assert.equal(V.texteCompteur(kmv({ valeur: 128_400, jours: 1 })), '128 400 km, dernier relevé hier.');
  // un engin dit ses heures de service, et rien ne s’accorde sur un intitulé féminin pluriel
  const heures = (x: Record<string, unknown>) => ({ unite: 'h', libelle: 'Heures de service', ...x });
  assert.equal(V.texteCompteur(heures({ valeur: 1_180, jours: 2 })), '1 180 h, dernier relevé il y a 2 jours.');
  assert.equal(V.texteCompteur(heures({ valeur: null, jours: null })), 'Heures de service : aucun relevé.');
  assert.equal(V.delaiEcheance({ joursRestants: null, compteurRestant: 20, compteur: 1_200 }, 'h'), 'dans 20 h');
  assert.equal(V.texteRepetition({ periodeMois: 12, periodeCompteur: 500 }, 'h'), 'Tous les 12 mois ou 500 h.');
  assert.equal(V.texteCompteur(kmv({ valeur: 128_400, jours: 10 })), '128 400 km, dernier relevé il y a 10 jours.');
  const v = (perime: boolean, compteur: number | null) => ({ vehicule: { compteur: { perime }, echeances: [{ compteur }] } });
  assert.equal(V.compteurARelever(v(true, 90_000)), true);
  assert.equal(V.compteurARelever(v(true, null)), false, 'aucune échéance au compteur : on ne réclame rien');
  assert.equal(V.compteurARelever(v(false, 90_000)), false);
});

test('ajouter un véhicule : un nom, un type, et c’est tout', () => {
  assert.deepEqual(V.nouveauMateriel('  Le Kangoo ', 'camionnette'), { ok: true, valeur: { type: 'vehicule', nom: 'Le Kangoo', champs: { genre: 'camionnette' } } });
  assert.deepEqual(V.nouveauMateriel('Le Kangoo', ''), { ok: true, valeur: { type: 'vehicule', nom: 'Le Kangoo', champs: {} } }, 'le type est facultatif');
  assert.equal(V.nouveauMateriel('   ', 'camion').ok, false);
  assert.equal(V.nouveauMateriel(null, null).ok, false);
});

test('« C’est fait » : le coût et le kilométrage sont facultatifs, une saisie abîmée est refusée en clair', () => {
  const e = { id: 'revision' };
  assert.deepEqual(V.faitPour(e, { compteur: 101_000, cout: '248,50' }).valeur, { echeance: 'revision', date: null, compteur: 101_000, cout: 248.5, note: null });
  assert.deepEqual(V.faitPour(e, {}).valeur, { echeance: 'revision', date: null, compteur: null, cout: null, note: null });
  assert.deepEqual(V.faitPour(e, { compteur: '128 400' }).valeur.compteur, 128_400, 'un relevé écrit avec ses espaces reste lisible');
  assert.equal(V.faitPour(e, { cout: 'cher' }).ok, false);
  assert.match(V.faitPour(e, { compteur: 'beaucoup' }).erreur, /compteur/);
  assert.equal(V.faitPour(null, {}).ok, false);
});

test('une entreprise sans véhicule ne voit ni rubrique, ni écran, ni réglage', async () => {
  const { app, proprietaire } = await entrepriseVide();
  await avecServeur(app, proprietaire.id, async (appel) => {
    const m = await appel('GET', '/monde');
    assert.equal(vehiculesDuMonde(m).length, 0);
    assert.equal(S.faits(m).vehicules, 0);
    assert.equal(S.deblocages(m).vehicules, false, 'la rubrique reste fermée');
    const montre = S.menuAffiche(N.groupesNavigation(m), S.deblocages(m)).flatMap((g: Quelconque) => g.entrees.map((e: Quelconque) => e.id));
    assert.ok(!montre.includes('vehicules'), `menu montré : ${montre.join(', ')}`);
    assert.equal(N.echeancesVehicules(m), 0, 'aucun compteur sur l’entrée');
    assert.equal(V.planListe(m).total, 0);
    assert.equal(V.planListe(m).resume, 'Aucun véhicule pour le moment.');
    // l'écran vide dit ce qui manque et ce que la rubrique montrera (§4.18)
    assert.deepEqual(S.texteVide('vehicules'), { titre: 'Aucun véhicule pour le moment.', texte: 'Ici : vos véhicules, leur kilométrage et ce qui arrive : contrôle, révision, pneus, assurance.' });
    // aucune situation, aucune action : rien ne remonte dans « Aujourd'hui »
    assert.deepEqual(m.situations, []);
    assert.equal(A.planAujourdhui(m).aFaire, 0);

    // un premier véhicule, avec son seul nom : la rubrique apparaît, et rien n'est réclamé
    const ajout = V.nouveauMateriel('Le Kangoo', 'camionnette');
    const o = await appel('POST', '/objets', { ...ajout.valeur, roles: [] });
    const m2 = await appel('GET', '/monde');
    assert.equal(S.deblocages(m2).vehicules, true);
    assert.equal(S.faits(m2).vehicules, 1);
    assert.equal(N.echeancesVehicules(m2), 0, 'aucune échéance : aucun compteur, et surtout pas « 1 véhicule »');
    assert.deepEqual(m2.situations, [], 'un véhicule sans date ne produit aucune alerte');
    const f = V.planFiche(vehiculesDuMonde(m2)[0], m2);
    assert.equal(f.nom, 'Le Kangoo');
    assert.equal(f.identite, 'Camionnette');
    assert.deepEqual(f.echeances, [], 'rien n’est renseigné');
    assert.equal(f.aRemplir.length, 6, 'les six natures restent proposées, sans rien imposer');
    assert.equal(f.texteTotal, `Aucun coût saisi en ${new Date().getFullYear()}.`);
    assert.equal(f.aRelever, false, 'aucune échéance au kilométrage : le compteur n’est pas réclamé');
    return o;
  });
});

test('une échéance renseignée remonte dans « Aujourd’hui », et le compteur de la rubrique la compte', async () => {
  const { app, proprietaire } = await entrepriseVide();
  await avecServeur(app, proprietaire.id, async (appel) => {
    const o = await appel('POST', '/objets', { type: 'vehicule', nom: 'Le Kangoo', roles: [], champs: { genre: 'camionnette' } });
    const modifier = (champs: Record<string, unknown>) => appel('POST', '/actions', { cle: `k-${Math.random().toString(36).slice(2, 12)}-x`, capacite: 'objet.modifier', cible: o.id, parametres: { champs }, executer: true });

    // loin devant : rien ne remonte
    await modifier({ controle_technique: jour(120), ct_tous_les_mois: 24 });
    let m = await appel('GET', '/monde');
    assert.deepEqual(m.situations, [], 'au-delà du délai de prévenance, silence');
    assert.equal(echeance(m, o.id, 'controle_technique').statut, 'ok');
    assert.equal(N.echeancesVehicules(m), 0);

    // dans le délai de prévenance : l'alerte paraît
    await modifier({ controle_technique: jour(9) });
    m = await appel('GET', '/monde');
    assert.equal(m.situations.length, 1);
    assert.equal(m.situations[0].regle, 'controle_technique');
    assert.equal(m.situations[0].gravite, 'attention');
    assert.match(m.situations[0].description, /^Contrôle technique : échéance dans 9/);
    assert.equal(echeance(m, o.id, 'controle_technique').statut, 'bientot');
    assert.equal(N.echeancesVehicules(m), 1);
    const plan = A.planAujourdhui(m);
    assert.equal(plan.aFaire, 1);
    assert.equal(plan.heros.titre, 'Le Kangoo', 'la chose à faire maintenant porte le nom du véhicule');
    assert.match(plan.heros.texte, /Contrôle technique/);

    // dépassée : urgente, jamais silencieuse
    await modifier({ controle_technique: jour(-3) });
    m = await appel('GET', '/monde');
    assert.equal(m.situations[0].gravite, 'critique');
    assert.match(m.situations[0].description, /échéance dépassée de 3/);
    assert.equal(echeance(m, o.id, 'controle_technique').statut, 'depassee');
    assert.equal(A.planAujourdhui(m).heros.ton, 'critique');

    // le véhicule peut demander à être prévenu plus tôt : la règle de l'univers n'a pas le dernier mot
    await modifier({ controle_technique: jour(120), prevenir_jours: 150 });
    m = await appel('GET', '/monde');
    assert.equal(m.situations.length, 1, 'prévenue 150 jours avant');
    assert.equal(echeance(m, o.id, 'controle_technique').prevenirJours, 150);
  });
});

test('échéance au kilométrage : prévenue avant, urgente après, et le compteur réclamé quand il est trop vieux', async () => {
  const { app, proprietaire } = await entrepriseVide();
  await avecServeur(app, proprietaire.id, async (appel) => {
    const o = await appel('POST', '/objets', { type: 'vehicule', nom: 'Le Kangoo', roles: [], champs: {} });
    const modifier = (champs: Record<string, unknown>) => appel('POST', '/actions', { cle: `k-${Math.random().toString(36).slice(2, 12)}-x`, capacite: 'objet.modifier', cible: o.id, parametres: { champs }, executer: true });

    await modifier({ kilometrage: 100_000, kilometrage_le: jour(-2), revision_km: 120_000, revision_tous_les_km: 20_000 });
    let m = await appel('GET', '/monde');
    assert.deepEqual(m.situations, [], 'encore 20 000 km : rien à dire');

    await modifier({ revision_km: 100_500 });
    m = await appel('GET', '/monde');
    assert.equal(m.situations[0].regle, 'materiel_compteur_revision');
    assert.equal(m.situations[0].gravite, 'attention');
    assert.match(m.situations[0].description, /dans 500 kilomètres/);
    assert.equal(echeance(m, o.id, 'revision').compteurRestant, 500);
    assert.equal(A.planAujourdhui(m).aFaire, 1, 'une échéance au kilométrage est une action comme une autre');

    await modifier({ kilometrage: 101_900 });
    m = await appel('GET', '/monde');
    assert.equal(m.situations[0].gravite, 'critique');
    assert.match(m.situations[0].description, /dépassé de 1 400 kilomètres/);

    // compteur trop vieux : on le redemande, en « à vérifier » — pas en urgence
    await modifier({ kilometrage_le: jour(-120), revision_km: 150_000 });
    m = await appel('GET', '/monde');
    const rappel = m.situations.find((s: Quelconque) => s.regle === 'materiel_compteur');
    assert.ok(rappel, JSON.stringify(m.situations));
    assert.equal(rappel.statut, 'a_verifier');
    assert.match(rappel.description, /^Kilométrage : dernier relevé il y a 120/);
    assert.equal(V.compteurARelever(vehiculesDuMonde(m)[0]), true);
    assert.equal(V.planListe(m).aRelever, 1);
  });
});

test('« C’est fait » : la date, le kilométrage, le coût, et la suivante programmée toute seule', async () => {
  const { app, proprietaire } = await entrepriseVide();
  await avecServeur(app, proprietaire.id, async (appel) => {
    const o = await appel('POST', '/objets', {
      type: 'vehicule', nom: 'Le Kangoo', roles: [],
      champs: { kilometrage: 100_000, kilometrage_le: jour(-30), prochaine_revision: jour(-2), revision_km: 100_500, revision_tous_les_mois: 12, revision_tous_les_km: 25_000 },
    });
    const auj = new Date().toISOString().slice(0, 10);
    const r = await appel('POST', '/actions', { cle: 'fait-revision-1', capacite: 'vehicule.fait', cible: o.id, parametres: { echeance: 'revision', compteur: 100_600, cout: 248.5 }, executer: true });
    assert.equal(r.etat, 'reussie_technique', r.message);
    assert.match(r.message, /Révision ou entretien : fait le /);

    const m = await appel('GET', '/monde');
    const v = vehiculesDuMonde(m)[0];
    // la suivante est programmée, le compteur relevé à cette occasion
    const suite = v.vehicule.echeances.find((e: Quelconque) => e.id === 'revision');
    assert.equal(suite.statut, 'ok', 'plus rien d’urgent');
    assert.equal(suite.compteur, 125_600);
    assert.equal(suite.date.slice(0, 4), String(new Date().getFullYear() + 1));
    assert.equal(v.vehicule.compteur.valeur, 100_600);
    assert.equal(v.vehicule.compteur.le, auj);
    assert.deepEqual(m.situations, [], 'l’alerte a disparu, sans rien faire de plus');

    // l'historique garde ce qui a été fait, avec son coût, et le total de l'année suit
    assert.equal(v.vehicule.historique.length, 1);
    const l = v.vehicule.historique[0];
    assert.equal(l.libelle, 'Révision ou entretien — Le Kangoo');
    assert.equal(l.echeance, 'revision');
    assert.equal(l.faitLe, auj);
    assert.deepEqual([l.compteur, l.cout], [100_600, 248.5]);
    assert.equal(v.vehicule.totalAnnee, 248.5);
    assert.equal(V.planFiche(v, m).texteTotal, `248,50 € en ${new Date().getFullYear()}, sur 1 ligne.`);

    // une même clé rejouée (double clic) ne fait pas deux fois l'opération
    await appel('POST', '/actions', { cle: 'fait-revision-1', capacite: 'vehicule.fait', cible: o.id, parametres: { echeance: 'revision', compteur: 100_600, cout: 248.5 }, executer: true });
    const m2 = await appel('GET', '/monde');
    assert.equal(vehiculesDuMonde(m2)[0].vehicule.historique.length, 1);

    // le coût se complète après coup, sans rien bloquer
    await appel('POST', '/actions', { cle: 'cout-revision-1', capacite: 'objet.modifier', cible: l.id, parametres: { champs: { cout: 300 } }, executer: true });
    const m3 = await appel('GET', '/monde');
    assert.equal(vehiculesDuMonde(m3)[0].vehicule.totalAnnee, 300);
  });
});

test('la liste met le plus pressant en haut, et le compteur de la rubrique ne compte que ce qui est à prévoir', async () => {
  const { app, proprietaire } = await entrepriseVide();
  await avecServeur(app, proprietaire.id, async (appel) => {
    await appel('POST', '/objets', { type: 'vehicule', nom: 'Tranquille', roles: [], champs: { genre: 'voiture', controle_technique: jour(300) } });
    await appel('POST', '/objets', { type: 'vehicule', nom: 'Bientôt', roles: [], champs: { genre: 'camion', assurance_le: jour(10) } });
    await appel('POST', '/objets', { type: 'vehicule', nom: 'En retard', roles: [], champs: { genre: 'camionnette', controle_technique: jour(-4) } });
    await appel('POST', '/objets', { type: 'vehicule', nom: 'Vierge', roles: [], champs: {} });
    const m = await appel('GET', '/monde');
    const plan = V.planListe(m);
    assert.deepEqual(plan.lignes.map((l: Quelconque) => l.nom), ['En retard', 'Bientôt', 'Tranquille', 'Vierge']);
    assert.deepEqual(plan.lignes.map((l: Quelconque) => l.statut), ['depassee', 'bientot', 'ok', 'absente']);
    assert.deepEqual(plan.lignes.map((l: Quelconque) => l.ton), ['critique', 'attention', 'ok', null]);
    assert.equal(plan.total, 4);
    assert.equal(plan.aRegler, 2, 'deux échéances à prévoir, pas quatre véhicules');
    assert.equal(plan.resume, '4 véhicules, 2 échéances à prévoir.');
    assert.equal(N.echeancesVehicules(m), 2);
    // l'entrée du menu porte ce compteur, et le dit au lecteur d'écran
    const entree = N.groupesNavigation(m).flatMap((g: Quelconque) => g.entrees).find((e: Quelconque) => e.id === 'vehicules');
    assert.equal(entree.compte, 2);
    assert.match(entree.compteLibelle, /^2 échéances de véhicule à prévoir$/);
    // et le titre de l'écran d'un véhicule porte son nom
    assert.equal(N.titreDeVue(N.groupesNavigation(m), 'vehicules'), 'Véhicules');
    assert.equal(N.titreDeVue(N.groupesNavigation(m), 'vehicule:x', { vehicule: 'Le Kangoo (démo)' }), 'Le Kangoo');
  });
});

test('la démonstration montre une flotte renseignée : des échéances proches, dépassées, et un historique à lire', async () => {
  const app = await Application.creer({ connexion: 'demo', exemple: 'eti' });
  await avecServeur(app, 'dirigeante', async (appel) => {
    const m = await appel('GET', '/monde');
    const plan = V.planListe(m);
    assert.ok(plan.total >= 5, `${plan.total} véhicules`);
    assert.ok(plan.aRegler >= 3, `${plan.aRegler} échéances à prévoir`);
    const statuts = new Set(plan.lignes.map((l: Quelconque) => l.statut));
    assert.ok(statuts.has('depassee') && statuts.has('bientot'), `états montrés : ${[...statuts].join(', ')}`);
    assert.ok(plan.lignes.every((l: Quelconque) => l.identite), 'chaque ligne dit son type, son immatriculation et son lieu');
    const avecHistorique = vehiculesDuMonde(m).filter((o: Quelconque) => o.vehicule.historique.length);
    assert.ok(avecHistorique.length >= 2, 'de quoi lire un historique en démonstration');
    assert.ok(avecHistorique.some((o: Quelconque) => o.vehicule.totalAnnee !== null), 'et un total de l’année');
    // les échéances des véhicules arrivent bien dans « Aujourd'hui »
    const actions = [A.planAujourdhui(m).heros, ...A.planAujourdhui(m).pile, ...A.planAujourdhui(m).autres];
    assert.ok(actions.some((a: Quelconque) => /Contrôle technique|Révision|Assurance|Pneus/.test(a.texte ?? '')), 'une échéance de véhicule dans la pile du jour');
  });
});

test('le préavis au compteur se change sur la fiche, comme le préavis en jours', async () => {
  const { app, proprietaire } = await entrepriseVide();
  await avecServeur(app, proprietaire.id, async (appel) => {
    const o = await appel('POST', '/objets', { type: 'vehicule', nom: 'Le Kangoo', roles: [], champs: { kilometrage: 119_500, kilometrage_le: jour(-2), revision_km: 120_000 } });
    const modifier = (champs: Record<string, unknown>) => appel('POST', '/actions', { cle: `k-${Math.random().toString(36).slice(2, 12)}-x`, capacite: 'objet.modifier', cible: o.id, parametres: { champs }, executer: true });

    // valeur de départ : 1 000 km avant une révision
    let m = await appel('GET', '/monde');
    assert.equal(m.situations.length, 1);
    assert.match(m.situations[0].description, /dans 500 kilomètres/);
    assert.equal(echeance(m, o.id, 'revision').prevenirCompteur, 1_000);

    // prévenir plus tard : le chiffre de la fiche l'emporte, et l'alerte se tait
    await modifier({ prevenir_km: 200 });
    m = await appel('GET', '/monde');
    assert.deepEqual(m.situations, [], 'prévenue 200 km avant seulement');
    assert.equal(echeance(m, o.id, 'revision').prevenirCompteur, 200);
    assert.equal(echeance(m, o.id, 'revision').statut, 'ok');

    // prévenir plus tôt : l'alerte revient, sans toucher à l'échéance elle-même
    await modifier({ prevenir_km: 5_000 });
    m = await appel('GET', '/monde');
    assert.equal(m.situations.length, 1, 'prévenue 5 000 km avant');
    assert.equal(echeance(m, o.id, 'revision').statut, 'bientot');

    // valeur abîmée : la valeur de départ reprend la main, l'alerte ne disparaît jamais
    await modifier({ prevenir_km: -3 });
    m = await appel('GET', '/monde');
    assert.equal(echeance(m, o.id, 'revision').prevenirCompteur, 1_000);

    // il se saisit là où se saisit le préavis en jours : dans les chiffres de la fiche
    await modifier({ prevenir_jours: 30, prevenir_km: 800 });
    m = await appel('GET', '/monde');
    const chiffres = FI.groupesFiche(vehiculesDuMonde(m)[0]).find((g: Quelconque) => g.id === 'chiffres');
    const ids = chiffres.champs.map((c: Quelconque) => c.id);
    assert.ok(ids.includes('prevenir_jours') && ids.includes('prevenir_km'), ids.join(', '));
  });
});

test('un engin de chantier se suit comme un véhicule, mais en heures de service', async () => {
  const { app, proprietaire } = await entrepriseVide();
  await avecServeur(app, proprietaire.id, async (appel) => {
    await appel('POST', '/univers', { id: 'btp' });
    const o = await appel('POST', '/objets', { type: 'engin', nom: 'La mini-pelle', roles: [], champs: { genre: 'mini-pelle', numero_parc: 'P-12' } });
    const modifier = (champs: Record<string, unknown>) => appel('POST', '/actions', { cle: `k-${Math.random().toString(36).slice(2, 12)}-x`, capacite: 'objet.modifier', cible: o.id, parametres: { champs }, executer: true });
    let m = await appel('GET', '/monde');
    const engin = () => vehiculesDuMonde(m).find((x: Quelconque) => x.id === o.id);
    const suivi = () => engin().vehicule;

    // la rubrique s'ouvre pour un engin comme pour un véhicule, et le compteur se compte en heures
    assert.equal(S.deblocages(m).vehicules, true);
    assert.equal(suivi().sorte, 'engin');
    assert.equal(suivi().unite, 'h');
    assert.equal(suivi().compteur.libelle, 'Heures de service');
    assert.equal(suivi().compteur.releve, 'Relever les heures de service', 'l’article et l’accord sont écrits d’avance');
    assert.deepEqual(suivi().echeances.map((e: Quelconque) => e.id), ['revision', 'controle_periodique', 'verification_generale', 'libre'], 'des échéances qui lui ressemblent');
    assert.equal(V.planListe(m).resume, '1 engin, rien à prévoir pour l’instant.');
    assert.equal(V.planFiche(engin(), m).identite, 'Mini-pelle · P-12');
    assert.deepEqual(m.situations, [], 'un engin sans rien ne produit aucune alerte');
    // le menu ne peut pas dire « Véhicules » quand ce qu'il ouvre est une mini-pelle
    assert.equal(N.titreDeVue(N.groupesNavigation(m), 'vehicules'), 'Matériel');

    // échéance au compteur : prévenue en heures, jamais en kilomètres
    await modifier({ heures: 1_180, heures_le: jour(-2), revision_heures: 1_200, revision_toutes_les_heures: 500 });
    m = await appel('GET', '/monde');
    assert.equal(m.situations[0].regle, 'materiel_compteur_revision');
    assert.match(m.situations[0].description, /^Révision ou entretien : dans 20 heures$/);
    const f = V.planFiche(engin(), m);
    assert.equal(f.texteCompteur, '1 180 h, dernier relevé il y a 2 jours.');
    assert.equal(V.delaiEcheance(f.echeances[0], f.unite), 'dans 20 h');
    assert.equal(V.texteRepetition(f.echeances[0], f.unite), 'Tous les 500 h.');

    // une échéance par date, annoncée par l'univers BTP
    await modifier({ verification_generale_le: jour(-3) });
    m = await appel('GET', '/monde');
    assert.ok(m.situations.some((x: Quelconque) => x.regle === 'verification_generale_engin' && /échéance dépassée de 3/.test(x.description)), JSON.stringify(m.situations));

    // « C'est fait » : les heures relevées, la suivante programmée au compteur, l'historique en heures
    const r = await appel('POST', '/actions', { cle: 'fait-engin-1', capacite: 'vehicule.fait', cible: o.id, parametres: { echeance: 'revision', compteur: 1_200, cout: 540 }, executer: true });
    assert.equal(r.etat, 'reussie_technique', r.message);
    m = await appel('GET', '/monde');
    assert.equal(suivi().compteur.valeur, 1_200);
    assert.equal(suivi().echeances.find((e: Quelconque) => e.id === 'revision').compteur, 1_700);
    assert.equal(suivi().historique[0].compteur, 1_200);
    assert.equal(suivi().totalAnnee, 540);

    // le préavis au compteur se change aussi, en heures
    await modifier({ heures: 1_650, heures_le: jour(-1) });
    m = await appel('GET', '/monde');
    assert.equal(echeance(m, o.id, 'revision').statut, 'bientot', 'préavis de départ : 50 h');
    await modifier({ prevenir_heures: 10 });
    m = await appel('GET', '/monde');
    assert.equal(echeance(m, o.id, 'revision').statut, 'ok');
    assert.equal(echeance(m, o.id, 'revision').prevenirCompteur, 10);
  });
});
