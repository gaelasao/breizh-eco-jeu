import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { Monde } from './monde.ts';

let serveur: Server;
let base: string;

before(async () => {
  serveur = creerServeur(await Application.creer());
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => serveur.close(() => ok())));

/** Petit client avec cookie de session. */
function client() {
  let cookie = '';
  const appel = async (methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) => {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { ...(cookie ? { cookie } : {}), ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}), ...entetes },
      body: corps === undefined ? null : JSON.stringify(corps),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0] as string;
    const texte = await r.text();
    let json: any = null;
    try { json = JSON.parse(texte); } catch { /* statique */ }
    return { statut: r.status, json, entetes: r.headers, texte };
  };
  return {
    appel,
    connecter: (profilId: string) => appel('POST', '/api/v1/session', { profilId }),
    monde: async () => (await appel('GET', '/api/v1/monde')).json,
  };
}

const valeur = (m: any, id: string, champ: string) => m.objets.find((o: any) => o.id === id)?.champs.find((c: any) => c.id === champ)?.valeur;
let n = 0;
const nouvelleCle = () => `test-cle-${Date.now()}-${n++}`;

test('en-têtes de sécurité et fichiers statiques en liste blanche', async () => {
  const c = client();
  const r = await c.appel('GET', '/');
  assert.equal(r.statut, 200);
  assert.match(r.entetes.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal(r.entetes.get('x-content-type-options'), 'nosniff');
  assert.equal((await c.appel('GET', '/../package.json')).statut, 404);
  assert.equal((await c.appel('GET', '/%2e%2e/package.json')).statut, 404);
  assert.equal((await c.appel('GET', '/vendor/three.module.js')).statut, 200);
});

test('sans session : 401 ; anti-CSRF sur les écritures', async () => {
  const c = client();
  assert.equal((await c.appel('GET', '/api/v1/monde')).statut, 401);
  assert.equal((await c.appel('POST', '/api/v1/session', { profilId: 'dirigeante' }, { 'x-lb-requete': '0' })).statut, 403);
  assert.equal((await c.appel('POST', '/api/v1/session', { profilId: 'dirigeante' }, { origin: 'https://pirate.example' })).statut, 403);
  const r = await c.appel('POST', '/api/v1/session', { profilId: 'dirigeante' });
  assert.match(r.entetes.get('set-cookie') ?? '', /HttpOnly; SameSite=Strict/);
});

test('R01 démo : monde fictif identifié, univers générique (clients, fournisseurs…)', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const m = await c.monde();
  assert.equal(m.organisation.demo, true);
  assert.ok(m.objets.every((o: any) => o.mode === 'demo'));
  assert.deepEqual(m.univers.roles.map((r: any) => r.pluriel).slice(0, 2), ['Clients', 'Fournisseurs']);
  const coop = m.objets.find((o: any) => o.id === 't-coop');
  assert.deepEqual(coop.roles.map((r: any) => r.id), ['client', 'fournisseur']);
  assert.ok(m.vitalite, 'la dirigeante voit le score privé');
  assert.equal(m.pavillon.apparence, 'endormi');
});

test('R05 périmètres : la technicienne ne voit que l’atelier, ni par liste ni par URL directe', async () => {
  const c = client();
  await c.connecter('terrain');
  const m = await c.monde();
  const ids = m.objets.map((o: any) => o.id).sort();
  // « ev-1 » et « ev-2 » : l'entretien du véhicule de l'atelier suit le véhicule (champ « concerne »)
  assert.deepEqual(ids, ['a-joints', 'a-peinture', 'e-loic', 'e-nacelle', 'e-nolwenn', 'ev-1', 'ev-2', 'l-atelier', 'pr-camping', 'pr-hotel', 'v-utilitaire']);
  assert.equal(m.vitalite, null);
  assert.equal((await c.appel('GET', '/api/v1/objets/a-panneaux')).statut, 404);
  assert.equal((await c.appel('GET', '/api/v1/objets/f-041')).statut, 404);
  assert.equal((await c.appel('GET', '/api/v1/objets/e-anna')).statut, 404);
  // la référence vers le client n'est pas révélée
  assert.equal(valeur(m, 'pr-hotel', 'client'), null);
  // lecture seule
  const r = await c.appel('POST', '/api/v1/actions', { cle: nouvelleCle(), capacite: 'tache.creer', cible: 'pr-hotel', parametres: { titre: 'x' } });
  assert.equal(r.statut, 403);
});

test('responsable stock : fournisseurs oui, clients non', async () => {
  const c = client();
  await c.connecter('responsable-stock');
  const m = await c.monde();
  const ids = new Set(m.objets.map((o: any) => o.id));
  assert.ok(ids.has('t-negoce') && ids.has('t-coop') && ids.has('t-grossiste') && ids.has('a-panneaux') && ids.has('e-yann'));
  assert.ok(!ids.has('t-tycoz') && !ids.has('t-boulangerie') && !ids.has('f-041') && !ids.has('l-atelier') && !ids.has('e-anna'));
  assert.equal((await c.appel('GET', '/api/v1/objets/t-boulangerie')).statut, 404);
});

test('préparer (responsable) → approuver (dirigeante) → mouvement unique → quête réussie', async () => {
  const resp = client();
  await resp.connecter('responsable-stock');
  const cle = nouvelleCle();
  const prep = await resp.appel('POST', '/api/v1/actions', { cle, capacite: 'mouvement', cible: 'a-panneaux', parametres: { champ: 'quantite', delta: 20, motif: 'livraison' }, executer: true });
  assert.equal(prep.json.etat, 'en_attente', 'pas d’exécution sans rôle habilité');
  assert.equal((await resp.appel('POST', `/api/v1/actions/${cle}/approuver`)).statut, 403);

  const dir = client();
  await dir.connecter('dirigeante');
  const avant = await dir.monde();
  assert.ok(avant.actionsEnAttente.some((a: any) => a.cle === cle));
  assert.ok(avant.quetes.some((q: any) => q.origine.objetId === 'a-panneaux' && q.statut === 'ouverte'));
  const [a, b] = await Promise.all([dir.appel('POST', `/api/v1/actions/${cle}/approuver`), dir.appel('POST', `/api/v1/actions/${cle}/approuver`)]);
  assert.equal(a.json.etat, 'reussie_technique');
  assert.equal(b.json.etat, 'reussie_technique');
  const apres = await dir.monde();
  assert.equal(valeur(apres, 'a-panneaux', 'quantite'), 26, 'un seul mouvement malgré deux approbations');
  assert.equal(apres.objets.find((o: any) => o.id === 'a-panneaux').simule, false, 'action réelle ≠ simulation');
  assert.ok(!apres.situations.some((s: any) => s.objetId === 'a-panneaux'));
  const q = apres.quetes.find((x: any) => x.origine.objetId === 'a-panneaux');
  assert.equal(q.statut, 'achevee');
  assert.equal(q.preuve.valeur, 26);
});

test('R03 double clic (même clé, en parallèle) ⇒ un seul mouvement ; clé réutilisée autrement ⇒ 409', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const avant = valeur(await c.monde(), 'a-visserie', 'quantite');
  const cle = nouvelleCle();
  const corps = { cle, capacite: 'mouvement', cible: 'a-visserie', parametres: { champ: 'quantite', delta: -10 }, executer: true };
  await Promise.all([c.appel('POST', '/api/v1/actions', corps), c.appel('POST', '/api/v1/actions', corps), c.appel('POST', '/api/v1/actions', corps)]);
  assert.equal(valeur(await c.monde(), 'a-visserie', 'quantite'), avant - 10);
  const conflit = await c.appel('POST', '/api/v1/actions', { ...corps, parametres: { champ: 'quantite', delta: -11 } });
  assert.equal(conflit.statut, 409);
});

test('sortie supérieure au stock refusée, rien n’est écrit', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const r = await c.appel('POST', '/api/v1/actions', { cle: nouvelleCle(), capacite: 'mouvement', cible: 'a-joints', parametres: { champ: 'quantite', delta: -999 }, executer: true });
  assert.equal(r.json.etat, 'echouee');
  assert.equal(valeur(await c.monde(), 'a-joints', 'quantite'), 15);
  const interdit = await c.appel('POST', '/api/v1/actions', { cle: nouvelleCle(), capacite: 'mouvement', cible: 'pr-mairie', parametres: { champ: 'retard_jours', delta: -5 }, executer: true });
  assert.equal(interdit.statut, 400, 'seules les jauges déclarées « mouvement » dans l’univers acceptent un mouvement');
});

test('R04 simulation : copie isolée, aucun effet sur le réel, sortie sans contamination', async () => {
  const sim = client();
  const autre = client();
  await sim.connecter('dirigeante');
  await autre.connecter('dirigeante');
  const reel = valeur(await autre.monde(), 'a-cable', 'quantite');
  await sim.appel('POST', '/api/v1/simulation', { actif: true });
  const r = await sim.appel('POST', '/api/v1/actions', { cle: nouvelleCle(), capacite: 'mouvement', cible: 'a-cable', parametres: { champ: 'quantite', delta: -25 }, executer: true });
  assert.equal(r.json.mode, 'simulation');
  const ms = await sim.monde();
  assert.equal(ms.mode, 'simulation');
  assert.equal(valeur(ms, 'a-cable', 'quantite'), reel - 25);
  assert.equal(ms.objets.find((o: any) => o.id === 'a-cable').simule, true);
  assert.equal(valeur(await autre.monde(), 'a-cable', 'quantite'), reel, 'le réel ne bouge pas');
  await sim.appel('POST', '/api/v1/simulation', { actif: false });
  const retour = await sim.monde();
  assert.equal(retour.mode, 'reel');
  assert.equal(valeur(retour, 'a-cable', 'quantite'), reel);
});

test('donnée périmée : signalée, jamais « verte »', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const m = await c.monde();
  const cable = m.objets.find((o: any) => o.id === 'a-cable');
  assert.equal(cable.fraicheur, 'perimee');
  assert.ok(m.situations.some((s: any) => s.objetId === 'a-cable' && s.statut === 'a_verifier'));
});

test('univers : la dirigeante passe en BTP (Projet → Chantier) ; le terrain ne peut pas', async () => {
  const t = client();
  await t.connecter('terrain');
  assert.equal((await t.appel('POST', '/api/v1/univers', { id: 'btp' })).statut, 403);
  const d = client();
  await d.connecter('dirigeante');
  assert.equal((await d.appel('POST', '/api/v1/univers', { id: 'btp' })).statut, 200);
  const m = await d.monde();
  assert.equal(m.objets.find((o: any) => o.id === 'pr-hotel').libelleType, 'Chantier');
  await d.appel('POST', '/api/v1/univers', { id: 'generique' });
  assert.equal((await d.appel('POST', '/api/v1/univers', { id: '../../etc' })).statut, 400);
});

test('import CSV : correspondance proposée, rôles multiples, lignes invalides rejetées, pas de double import', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const csv = 'Nom;Rôles;Ville;Département;Encours\n"Cave Exemple; Vannes";client, fournisseur;Vannes;56;1 200,50\nInconnu SA;martien;Brest;29;\n';
  const a = await c.appel('POST', '/api/v1/import/analyse', { type: 'entreprise', csv });
  assert.equal(a.statut, 200);
  assert.deepEqual(a.json.mapping, { Nom: '__nom', 'Rôles': '__roles', Ville: 'ville', 'Département': 'num_departement', Encours: 'encours' });
  const r = await c.appel('POST', '/api/v1/import/confirmer', { type: 'entreprise', csv, mapping: a.json.mapping, nomFichier: 'tiers.csv' });
  assert.equal(r.json.crees, 1);
  assert.equal(r.json.rejets[0].ligne, 3);
  const m = await c.monde();
  const cave = m.objets.find((o: any) => o.nom === 'Cave Exemple; Vannes');
  assert.deepEqual(cave.roles.map((x: any) => x.id), ['client', 'fournisseur']);
  assert.equal(cave.mode, 'reel');
  assert.equal(cave.provenance, 'declare');
  assert.equal(valeur(m, cave.id, 'encours'), 1200.5);
  assert.equal((await c.appel('POST', '/api/v1/import/confirmer', { type: 'entreprise', csv, mapping: a.json.mapping })).statut, 409);
});

test('corps non JSON refusé', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const r = await c.appel('POST', '/api/v1/simulation', undefined, { 'content-type': 'text/plain' });
  assert.equal(r.statut, 415);
});

test('employés : type de premier plan, disponibilité déclarée', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const m = await c.monde();
  const employes = m.objets.filter((o: any) => o.type === 'employe');
  assert.equal(employes.length, 9);
  assert.equal(employes[0].libelleType, 'Employé');
  assert.equal(employes.find((o: any) => o.id === 'e-loic').provenance, 'declare');
  assert.equal(valeur(m, 'e-loic', 'disponibilite'), 'absent');
});

test('connecteurs : catalogue honnête (disponible / bientôt), demande d’intégration tracée', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const cat = (await c.appel('GET', '/api/v1/connecteurs')).json;
  const dispo = cat.filter((x: any) => x.statut === 'disponible').map((x: any) => x.id).sort();
  assert.deepEqual(dispo, ['coller', 'csv', 'fec', 'manuel', 'sheets']);
  assert.equal(cat.find((x: any) => x.id === 'sage-api').statut, 'bientot');
  assert.equal(cat.find((x: any) => x.id === 'm365'), undefined, 'Excel 365 : branché dans Outils branchés');
  assert.equal(cat.find((x: any) => x.id === 'hubspot'), undefined, 'HubSpot : branché dans Outils branchés, plus « bientôt »');
  assert.equal((await c.appel('POST', '/api/v1/connecteurs/demande', { id: 'sage-api' })).statut, 200);
  const j = (await c.appel('GET', '/api/v1/journal')).json;
  assert.ok(j.some((e: any) => e.action === 'connecteur.demande' && e.detail === 'Sage (connexion directe)'));
});

test('Google Sheets : seuls les liens publiés docs.google.com sont acceptés', async () => {
  const c = client();
  await c.connecter('dirigeante');
  for (const url of ['http://docs.google.com/spreadsheets/d/e/x/pub?output=csv', 'https://evil.example/spreadsheets/d/e/x/pub?output=csv', 'https://docs.google.com/spreadsheets/d/abc/edit', 'https://169.254.169.254/latest']) {
    const r = await c.appel('POST', '/api/v1/import/sheets', { type: 'entreprise', url });
    assert.equal(r.statut, 400, url);
  }
});

test('saisie manuelle : un client ajouté en 3 champs, validé par l’univers', async () => {
  const c = client();
  await c.connecter('dirigeante');
  const r = await c.appel('POST', '/api/v1/objets', { type: 'entreprise', nom: 'Crêperie Manuelle', roles: ['client'], champs: { ville: 'Concarneau', encours: 300 } });
  assert.equal(r.statut, 200);
  assert.equal(r.json.mode, 'reel');
  assert.deepEqual(r.json.roles.map((x: any) => x.id), ['client']);
  assert.equal((await c.appel('POST', '/api/v1/objets', { type: 'entreprise', nom: 'X', champs: { couleur: 'rouge' } })).statut, 400);
  assert.equal((await c.appel('POST', '/api/v1/objets', { type: 'employe', nom: '', champs: {} })).statut, 400);
  const t = client();
  await t.connecter('terrain');
  assert.equal((await t.appel('POST', '/api/v1/objets', { type: 'entreprise', nom: 'Y', champs: {} })).statut, 403);
});

test('partir de zéro : données fictives retirées, monde au nom de l’entreprise', async () => {
  const { PROFILS_DEMO } = await import('../demo/donnees.ts');
  const m = await Monde.creer();
  const dir = PROFILS_DEMO[0]!;
  const terrain = PROFILS_DEMO[2]!;
  assert.throws(() => m.viderDemo(terrain, 's1', { nom: 'X' }));
  assert.throws(() => m.viderDemo(dir, 's1', { nom: '' }));
  m.viderDemo(dir, 's1', { nom: 'Ma PME' });
  assert.equal(m.organisation.nom, 'Ma PME');
  assert.equal(m.organisation.demo, false);
  assert.equal(m.organisation.vueParDefaut, 'entreprise');
  const v = await m.vue(dir, 's1');
  assert.deepEqual(v.objets.map((o) => o.famille), ['organisation']);
  assert.equal(v.situations.length, 0);
  m.creerObjet(dir, 's1', { type: 'atelier', nom: 'Atelier — Vannes', champs: {} });
  assert.equal((await m.vue(dir, 's1')).objets.filter((o) => o.famille === 'lieu').length, 1);
});

test('entreprise à départements : vue par département par défaut, échéances, périmètre par département', async () => {
  const { PROFILS_DEMO } = await import('../demo/donnees.ts');
  const m = await Monde.creer({ exemple: 'eti' });
  const [dir, logistique] = [PROFILS_DEMO[0]!, PROFILS_DEMO[1]!];
  assert.equal(m.organisation.vueParDefaut, 'departements');
  assert.equal(m.organisation.departements, 7);
  const v = await m.vue(dir, 's1');
  const regles = new Set(v.situations.map((s) => s.regle));
  for (const r of ['tache_en_retard', 'revision_vehicule', 'controle_technique', 'livraison_fournisseur', 'livraison_client', 'stock_minimum', 'retard_paiement', 'encours_client']) {
    assert.ok(regles.has(r), `règle ${r} attendue`);
  }
  assert.ok(v.objets.filter((o) => o.famille === 'personne').length >= 40);
  // le responsable logistique ne voit que son département
  const vl = await m.vue(logistique, 's2');
  assert.deepEqual(vl.objets.filter((o) => o.famille === 'departement').map((o) => o.id), ['d-logistique']);
  assert.ok(vl.objets.filter((o) => o.famille === 'tache').every((o) => o.champs.find((c) => c.id === 'departement')?.valeur === 'd-logistique'));
  // changer d'exemple ne touche qu'aux données fictives
  m.changerExemple(dir, 's1', 'pme');
  assert.equal(m.organisation.vueParDefaut, 'entreprise');
  assert.equal(m.organisation.departements, 0);
});

test('planning : grille de la semaine, trous détectés, modification selon les droits, simulation isolée', async () => {
  const d = client();
  await d.connecter('dirigeante');
  const p = (await d.appel('GET', '/api/v1/planning')).json;
  assert.equal(p.jours.length, 5);
  assert.ok(p.lignes.length >= 9);
  assert.ok(p.alertes.some((a: any) => a.type === 'sans_affectation'), 'trous de démonstration détectés');
  const jour = p.jours[4];
  const r = await d.appel('POST', '/api/v1/planning', { employe: 'e-gwen', date: jour, valeur: 'lieu:l-atelier' });
  assert.equal(r.statut, 200);
  assert.equal((await d.appel('GET', '/api/v1/planning')).json.lignes.find((l: any) => l.id === 'e-gwen').cases[jour], 'lieu:l-atelier');
  assert.equal((await d.appel('POST', '/api/v1/planning', { employe: 'e-gwen', date: jour, valeur: 'lieu:inconnu' })).statut, 400);
  assert.equal((await d.appel('POST', '/api/v1/planning', { employe: 'e-gwen', date: jour, valeur: 'absence:vacances-au-ski' })).statut, 400);
  // simulation : l'affectation n'atteint pas le planning réel
  const s = client();
  await s.connecter('dirigeante');
  await s.appel('POST', '/api/v1/simulation', { actif: true });
  await s.appel('POST', '/api/v1/planning', { employe: 'e-gwen', date: jour, valeur: 'absence:congé' });
  assert.equal((await d.appel('GET', '/api/v1/planning')).json.lignes.find((l: any) => l.id === 'e-gwen').cases[jour], 'lieu:l-atelier');
  await s.appel('POST', '/api/v1/simulation', { actif: false });
  const t = client();
  await t.connecter('terrain');
  assert.equal((await t.appel('POST', '/api/v1/planning', { employe: 'e-nolwenn', date: jour, valeur: '' })).statut, 403);
  const pt = (await t.appel('GET', '/api/v1/planning')).json;
  assert.ok(pt.lignes.every((l: any) => ['e-nolwenn', 'e-loic'].includes(l.id)), 'le terrain ne voit que son équipe');
});

test('courrier : chacun voit ce qui lui est adressé, statut traité, tri par mots-clés', async () => {
  const d = client();
  await d.connecter('dirigeante');
  const tous = (await d.monde()).objets.filter((o: any) => o.type === 'courrier');
  assert.equal(tous.length, 8);
  const r = client();
  await r.connecter('responsable-stock');
  const siens = (await r.monde()).objets.filter((o: any) => o.type === 'courrier');
  assert.deepEqual(siens.map((o: any) => valeur({ objets: siens }, o.id, 'destinataire')), ['e-yann']);
  const id = siens[0].id;
  assert.equal((await r.appel('POST', `/api/v1/courrier/${id}/statut`, { statut: 'traité' })).statut, 200);
  assert.equal(valeur(await r.monde(), id, 'statut'), 'traité');
  const t = client();
  await t.connecter('terrain');
  assert.equal((await t.monde()).objets.filter((o: any) => o.type === 'courrier').length, 0);
  assert.equal((await t.appel('POST', `/api/v1/courrier/${id}/statut`, { statut: 'à traiter' })).statut, 403);
  const tri = (await d.appel('POST', '/api/v1/courrier/trier', { texte: 'De : Négoce\nObjet : Retard de livraison urgent\nLa livraison de la commande est décalée.' })).json;
  assert.equal(tri.bac, 'fournisseurs');
  assert.equal(tri.urgence, 'haute');
  assert.equal(tri.destinataire.id, 'e-yann');
});

test('accès et visibilité : la direction règle les périmètres, effet immédiat, garde-fous', async () => {
  const d = client();
  await d.connecter('dirigeante');
  const t = client();
  await t.connecter('terrain');
  assert.equal((await t.appel('GET', '/api/v1/acces')).statut, 403);
  const acces = (await d.appel('GET', '/api/v1/acces')).json;
  const terrain = acces.profils.find((p: any) => p.id === 'terrain');
  assert.ok(terrain.apercu.personne.visibles < terrain.apercu.personne.total);
  assert.equal((await t.appel('GET', '/api/v1/objets/a-panneaux')).statut, 404);
  const m = await d.appel('PUT', '/api/v1/acces/terrain', { lieux: ['l-atelier', 'l-entrepot'] });
  assert.equal(m.statut, 200);
  assert.equal((await t.appel('GET', '/api/v1/objets/a-panneaux')).statut, 200, 'le nouveau périmètre s’applique sans reconnexion');
  assert.equal((await d.appel('PUT', '/api/v1/acces/terrain', { lieux: ['lieu-inexistant'] })).statut, 400);
  assert.equal((await d.appel('PUT', '/api/v1/acces/dirigeante', { peutAdministrer: false })).statut, 409, 'au moins un administrateur');
  assert.equal((await d.appel('DELETE', '/api/v1/acces/dirigeante')).statut, 409);
  const cree = (await d.appel('POST', '/api/v1/acces', { nom: 'Stagiaire', role: 'collaborateur', lieux: ['l-siege'], types: ['siege', 'employe'] })).json;
  assert.equal(cree.nom, 'Stagiaire');
  const st = client();
  await st.connecter(cree.id);
  assert.ok((await st.monde()).objets.every((o: any) => ['siege', 'employe'].includes(o.type)));
  assert.equal((await d.appel('DELETE', `/api/v1/acces/${cree.id}`)).statut, 200);
  assert.equal((await st.appel('GET', '/api/v1/monde')).statut, 401, 'accès retiré : session coupée');
  await d.appel('PUT', '/api/v1/acces/terrain', { lieux: ['l-atelier'] });
});
