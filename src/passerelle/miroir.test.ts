/**
 * Miroir de suivi : outils SIMULÉS (`fetch` injecté), aucun appel réseau, aucun vrai compte.
 * Vérifie le parcours complet : création du classeur et de ses onglets → une ligne par fiche créée → mise à jour →
 * suppression marquée (jamais effacée) → aller-retour sans doublon → échec puis reprise → types décochés →
 * « Tout réécrire ». La forme des appels d'écriture est comparée à la documentation officielle de chaque outil
 * (adresses citées dans docs/CONNECTEURS.md).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';
import { entetesDe, mappingDe, typesSuivis, COL_MAJ, COL_NOM, COL_REFERENCE, COL_ROLES, COL_STATUT, STATUT_ACTIVE, STATUT_SUPPRIMEE } from './miroir.ts';
import { defType } from '../core/univers.ts';

process.env.LB_AUTORISER_LOCAL = '1'; // Breizhcosystem simulé sur http://127.0.0.1 (ce fichier tourne dans son propre processus)

const RELAIS = 'http://127.0.0.1:4181';
const ATTENTE = 'A'.repeat(20) + 'b'.repeat(23);
const ID_CLASSEUR = '1MiRoIrSuIvI0123456789abcdefghijklmn';
const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
const dans = (s: number) => new Date(Date.now() + s * 1000).toISOString();

interface Appel { url: URL; methode: string; corps: any }

/** Tableur Google simulé : un classeur, ses onglets, leurs lignes. */
class Tableur {
  id = ID_CLASSEUR;
  titre = '';
  onglets = new Map<string, string[][]>();
  /** Prochaine réponse en échec (une fois), pour l'essai « hors ligne ». */
  panne: number | null = null;

  /** « 'Mes clients'!B3:D3 » → { onglet, ligne, col } ; sans cellules : tout l'onglet. */
  static plage(brut: string) {
    const t = decodeURIComponent(brut);
    const m = /^'((?:[^']|'')*)'(?:!(.*))?$/.exec(t) ?? /^([^!]*)(?:!(.*))?$/.exec(t);
    const onglet = (m?.[1] ?? '').replace(/''/g, "'");
    const cellules = m?.[2] ?? '';
    const c = /^([A-Z]{1,3})(\d{1,7})/.exec(cellules.toUpperCase());
    let col = 0;
    for (const ch of c?.[1] ?? '') col = col * 26 + (ch.charCodeAt(0) - 64);
    return { onglet, ligne: c ? Number(c[2]) : 1, col: c ? col - 1 : 0, cellules };
  }

  lignes(onglet: string): string[][] {
    const l = this.onglets.get(onglet);
    if (!l) throw new Error(`onglet inconnu : ${onglet}`);
    return l;
  }
}

/** Notion et Airtable simulés : on retient les corps envoyés pour vérifier leur forme. */
interface Trace { sheets: Appel[]; notion: Appel[]; airtable: Appel[] }

function simulation() {
  const tableur = new Tableur();
  const trace: Trace = { sheets: [], notion: [], airtable: [] };
  const relais = { resultat: null as any, accepter(fournisseur: string, acces: string) { this.resultat = { statut: 'connecte', fournisseur, jetons: { acces, rafraichissement: `rafr-${fournisseur}`, expire: dans(3600), portee: null, extra: {} } }; } };
  /** Page de connexion de chaque outil : le jeu en vérifie l'hôte avant d'ouvrir l'onglet. */
  const PAGES: Record<string, string> = {
    google: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=g&state=s1',
    notion: 'https://api.notion.com/v1/oauth/authorize?client_id=n&state=s1',
    airtable: 'https://airtable.com/oauth2/v1/authorize?client_id=a&state=s1',
  };
  const notion = { bases: 0, sources: 0, pages: new Map<string, Record<string, unknown>>(), schemas: new Map<string, Record<string, unknown>>() };
  const airtable = { bases: 0, enregistrements: new Map<string, Record<string, unknown>>() };

  const f = (async (url: URL | string, init?: RequestInit) => {
    const brut = init?.body ? String(init.body) : null;
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', corps: brut === null ? null : brut.startsWith('{') ? JSON.parse(brut) : brut };
    // ----- Breizhcosystem (relais « Se connecter avec… »)
    if (a.url.origin === RELAIS) {
      switch (a.url.pathname) {
        case '/v0/oauth/fournisseurs': return json({ fournisseurs: ['google', 'notion', 'airtable'].map((id) => ({ id, nom: id, parametre: null })) });
        case '/v0/oauth/demarrer': return json({ url: PAGES[String(a.corps?.fournisseur)] ?? PAGES.google, attente: ATTENTE, expire: dans(600) });
        case '/v0/oauth/retrait': { const r = relais.resultat; if (!r) return json({ statut: 'attente' }); relais.resultat = null; return json(r); }
        case '/v0/oauth/rafraichir': return json({ acces: 'acces-2', rafraichissement: 'rafr-2', expire: dans(3600), portee: null, extra: {} });
        case '/v0/oauth/revoquer': return json({ ok: true, chezOutil: 'revoque' });
      }
      return json({ erreur: 'introuvable' }, 404);
    }
    // ----- Google Sheets
    if (a.url.hostname === 'sheets.googleapis.com') {
      trace.sheets.push(a);
      if (tableur.panne !== null) { const s = tableur.panne; tableur.panne = null; return json({ error: { message: 'panne simulée' } }, s); }
      const chemin = a.url.pathname.replace('/v4/spreadsheets', '');
      if (a.methode === 'POST' && chemin === '') {
        tableur.titre = String(a.corps?.properties?.title ?? '');
        for (const s of a.corps?.sheets ?? []) tableur.onglets.set(String(s.properties.title), []);
        return json({ spreadsheetId: tableur.id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${tableur.id}/edit`, sheets: [...tableur.onglets.keys()].map((t, i) => ({ properties: { sheetId: i, title: t } })) });
      }
      const reste = /^\/[A-Za-z0-9_-]+(.*)$/.exec(chemin)?.[1] ?? '';
      if (a.methode === 'POST' && reste === ':batchUpdate') {
        for (const r of a.corps?.requests ?? []) if (r.addSheet) tableur.onglets.set(String(r.addSheet.properties.title), []);
        return json({ spreadsheetId: tableur.id });
      }
      if (a.methode === 'GET' && reste === '') {
        return json({ spreadsheetId: tableur.id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${tableur.id}/edit`, sheets: [...tableur.onglets.keys()].map((t) => ({ properties: { title: t } })) });
      }
      if (reste.startsWith('/values/')) {
        const ajout = reste.endsWith(':append');
        const p = Tableur.plage(reste.slice(8, ajout ? -7 : undefined));
        const lignes = tableur.lignes(p.onglet);
        const valeurs: unknown[] = a.corps?.values?.[0] ?? [];
        if (ajout) {
          lignes.push(valeurs.map((v) => (v === null || v === undefined ? '' : String(v))));
          return json({ spreadsheetId: tableur.id, updates: { updatedRange: `'${p.onglet}'!A${lignes.length}` } });
        }
        if (a.methode === 'PUT') {
          while (lignes.length < p.ligne) lignes.push([]);
          const l = lignes[p.ligne - 1] as string[];
          // null = cellule laissée telle quelle (les formules des colonnes non synchronisées sont conservées)
          valeurs.forEach((v, i) => { if (v !== null && v !== undefined) l[p.col + i] = String(v); else if (l[p.col + i] === undefined) l[p.col + i] = ''; });
          return json({ spreadsheetId: tableur.id, updatedRange: `'${p.onglet}'!A${p.ligne}` });
        }
        return json({ range: `'${p.onglet}'!A1:Z${Math.max(lignes.length, 1)}`, majorDimension: 'ROWS', values: lignes });
      }
      return json({ erreur: 'introuvable' }, 404);
    }
    // ----- Notion
    if (a.url.hostname === 'api.notion.com') {
      trace.notion.push(a);
      const id32 = (n: number, c: string) => `${n.toString(16).padStart(2, '0')}${c.repeat(30)}`;
      if (a.methode === 'POST' && a.url.pathname === '/v1/databases') {
        notion.bases++;
        const sid = id32(++notion.sources, 'a');
        notion.schemas.set(sid, a.corps?.initial_data_source?.properties ?? {});
        return json({ object: 'database', id: 'b'.repeat(32), data_sources: [{ id: sid, name: 'Clients' }] });
      }
      if (a.methode === 'POST' && a.url.pathname === '/v1/data_sources') {
        const sid = id32(++notion.sources, 'a');
        notion.schemas.set(sid, a.corps?.properties ?? {});
        return json({ object: 'data_source', id: sid });
      }
      if (a.methode === 'POST' && a.url.pathname === '/v1/pages') {
        const id = id32(notion.pages.size + 1, 'd');
        notion.pages.set(id, a.corps?.properties ?? {});
        return json({ object: 'page', id });
      }
      if (a.methode === 'PATCH' && a.url.pathname.startsWith('/v1/pages/')) {
        const id = a.url.pathname.slice(10).replace(/-/g, '');
        notion.pages.set(id, { ...(notion.pages.get(id) ?? {}), ...(a.corps?.properties ?? {}) });
        return json({ object: 'page', id });
      }
      if (a.url.pathname.startsWith('/v1/data_sources/')) {
        const schema = notion.schemas.get(a.url.pathname.slice(17).replace(/-/g, '')) ?? {};
        // Notion décrit le type de chaque propriété : { "Nom": { "type": "title", … } }
        return json({ object: 'data_source', properties: Object.fromEntries(Object.entries(schema).map(([k, v]) => [k, { type: Object.keys(v as object)[0] }])) });
      }
      return json({ object: 'error', code: 'object_not_found', message: 'inconnu' }, 404);
    }
    // ----- Airtable
    if (a.url.hostname === 'api.airtable.com') {
      trace.airtable.push(a);
      if (a.methode === 'POST' && a.url.pathname === '/v0/meta/bases') {
        airtable.bases++;
        const tables = (a.corps?.tables ?? []).map((t: any, i: number) => ({ id: `tbl${String(i).padStart(14, '0')}`, name: t.name }));
        return json({ id: `app${'0'.repeat(14)}`, tables });
      }
      if (a.methode === 'POST' && /\/v0\/app[^/]+\/tbl/.test(a.url.pathname)) {
        const id = `rec${String(airtable.enregistrements.size).padStart(14, '0')}`;
        airtable.enregistrements.set(id, a.corps?.records?.[0]?.fields ?? {});
        return json({ records: [{ id, fields: a.corps?.records?.[0]?.fields ?? {} }] });
      }
      if (a.methode === 'PATCH') return json({ id: a.url.pathname.split('/').pop(), fields: a.corps?.fields ?? {} });
      return json({ erreur: 'introuvable' }, 404);
    }
    return json({ erreur: 'introuvable' }, 404);
  }) as typeof fetch;
  return { f, tableur, trace, relais, notion, airtable };
}

async function monter(sim: ReturnType<typeof simulation>, source: 'sheets' | 'notion' | 'airtable' = 'sheets', config: Record<string, string> = {}) {
  const app = await Application.creer({ exemple: 'pme', fetch: sim.f });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  app.monde.viderDemo(p, 's', { nom: 'Kerlann' });
  await app.nexus.reglerAdresse(RELAIS);
  // un compte branché « Se connecter avec… », capable d'écrire : c'est lui qui portera le fichier de suivi
  const d = await app.synchro.demarrerOAuth(p, { source, config, droits: 'ecriture' });
  sim.relais.accepter(source === 'sheets' ? 'google' : source, `acces-${source}`);
  const r = await app.synchro.suivreOAuth(p, d.id) as { statut: string; jeton: string };
  assert.equal(r.statut, 'connecte');
  const base = source === 'sheets' ? { classeur: `https://docs.google.com/spreadsheets/d/${'9'.repeat(30)}/edit`, colonneId: 'Nom' } : source === 'notion' ? { base: `source:${'e'.repeat(32)}` } : { base: `app${'1'.repeat(14)}`, table: 'Clients' };
  app.synchro.creer(p, { source, nom: 'Mon outil', typeObjet: 'entreprise', sens: 'lecture', mapping: { Nom: '__nom' }, config: { ...base, jeton: r.jeton } });
  return { app, p };
}

/** Index d'une colonne dans l'onglet (les en-têtes sont en 1re ligne). */
const colonne = (lignes: string[][], nom: string) => (lignes[0] ?? []).indexOf(nom);
const ligneDe = (lignes: string[][], reference: string) => lignes.slice(1).find((l) => (l[colonne(lignes, COL_REFERENCE)] ?? '') === reference);

// ---------------------------------------------------------------- en-têtes et correspondance

test('en-têtes d’un onglet : lisibles par un humain, les colonnes du jeu à la fin, une correspondance par champ', async () => {
  const app = await Application.creer({ exemple: 'pme' });
  const t = defType(app.monde.univers, 'entreprise');
  assert.ok(t);
  const e = entetesDe(t);
  assert.equal(e[0], COL_NOM, 'le nom en premier : un classeur se lit comme un tableau, pas comme une table technique');
  assert.equal(e[1], COL_ROLES, 'un tiers porte ses rôles');
  assert.deepEqual(e.slice(-3), [COL_REFERENCE, COL_STATUT, COL_MAJ], 'les colonnes du jeu passent après');
  for (const c of t.champs) assert.ok(e.includes(c.libelle), `colonne « ${c.libelle} »`);
  const m = mappingDe(t);
  assert.equal(m[COL_NOM], '__nom');
  assert.equal(m[COL_ROLES], '__roles');
  assert.equal(m.Ville, 'ville');
  assert.ok(!(COL_REFERENCE in m) && !(COL_STATUT in m), 'les colonnes du jeu ne sont rattachées à aucun champ');
  assert.ok(typesSuivis(app.monde.univers).every((x) => x.famille !== 'organisation'), 'la fiche de l’entreprise n’a pas d’onglet');
  app.arreter();
});

// ---------------------------------------------------------------- création du classeur (Google Sheets)

test('Google : un seul clic crée le classeur, un onglet par type, les en-têtes, et l’adresse est affichée', async () => {
  const sim = simulation();
  const { app, p } = await monter(sim);
  const prop = app.miroir.proposition();
  assert.ok(prop, 'une proposition dès qu’un compte sait écrire');
  assert.equal(prop.outil, 'sheets', 'Google par défaut');
  assert.match(prop.bouton, /Créer mon fichier de suivi dans mon Google Drive/);
  const v = await app.miroir.creer(p, {});
  assert.ok(v.classeur);
  assert.equal(v.classeur.nom, 'Suivi — Kerlann');
  assert.equal(v.classeur.url, `https://docs.google.com/spreadsheets/d/${ID_CLASSEUR}/edit`, 'adresse cliquable');
  assert.equal(app.miroir.proposition(), null, 'la proposition disparaît une fois le fichier créé');
  // documentation Google : POST https://sheets.googleapis.com/v4/spreadsheets, corps { properties.title, sheets[].properties.title }
  const creation = sim.trace.sheets.find((a) => a.methode === 'POST' && a.url.pathname === '/v4/spreadsheets');
  assert.ok(creation, 'création par POST /v4/spreadsheets');
  assert.equal(creation.corps.properties.title, 'Suivi — Kerlann');
  const types = typesSuivis(app.monde.univers);
  assert.equal(creation.corps.sheets.length, types.length, 'un onglet par type, en un seul appel');
  for (const t of types) assert.ok(sim.tableur.onglets.has(t.pluriel), `onglet « ${t.pluriel} »`);
  assert.deepEqual(sim.tableur.lignes('Entreprises')[0], entetesDe(defType(app.monde.univers, 'entreprise')!), 'ligne d’en-têtes en français');
  // un branchement de LECTURE par onglet : les lignes ajoutées à la main reviennent par la synchronisation
  assert.equal(app.synchro.lister(p).length, 1, 'les branchements du miroir ne salissent pas la liste des logiciels connectés');
  assert.equal(app.synchro.resume().actifs, 1);
  app.arreter();
});

// ---------------------------------------------------------------- une ligne par création, mise à jour, suppression

test('chaque création, chaque modification et chaque suppression touche la bonne ligne, tout de suite', async () => {
  const sim = simulation();
  const { app, p } = await monter(sim);
  await app.miroir.creer(p, {});
  const o = app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Boulangerie Le Gall', roles: ['client'], champs: { ville: 'Brest' } }) as { id: string };
  await app.miroir.passer();
  const lignes = sim.tableur.lignes('Entreprises');
  assert.equal(lignes.length, 2, 'une ligne d’en-têtes, une ligne de fiche');
  const l = ligneDe(lignes, o.id);
  assert.ok(l, 'la ligne porte la référence de la fiche');
  assert.equal(l[colonne(lignes, COL_NOM)], 'Boulangerie Le Gall');
  assert.equal(l[colonne(lignes, 'Ville')], 'Brest');
  assert.equal(l[colonne(lignes, COL_ROLES)], 'Client');
  assert.equal(l[colonne(lignes, COL_STATUT)], STATUT_ACTIVE);
  // rien ne repart tant que rien ne change (anti-boucle par empreinte)
  const avant = sim.trace.sheets.length;
  assert.equal((await app.miroir.passer()).envoyees, 0, 'une fiche inchangée n’est jamais renvoyée');
  assert.equal(sim.trace.sheets.length, avant, 'aucun appel inutile');
  // modification : la MÊME ligne change
  await app.monde.preparerAction(p, 's', { cle: 'cle-miroir-00001', cible: o.id, capacite: 'objet.modifier', parametres: { champs: { ville: 'Quimper' } }, executer: true });
  assert.equal((await app.miroir.passer()).envoyees, 1);
  assert.equal(sim.tableur.lignes('Entreprises').length, 2, 'pas de ligne en double');
  assert.equal(ligneDe(sim.tableur.lignes('Entreprises'), o.id)?.[colonne(lignes, 'Ville')], 'Quimper');
  // suppression : la ligne est MARQUÉE, jamais retirée
  app.effacerObjet(p, 's', o.id, {});
  await app.miroir.passer();
  const apres = sim.tableur.lignes('Entreprises');
  assert.equal(apres.length, 2, 'la ligne reste : les données de l’entreprise sont à elle');
  assert.equal(ligneDe(apres, o.id)?.[colonne(apres, COL_STATUT)], STATUT_SUPPRIMEE);
  assert.equal(ligneDe(apres, o.id)?.[colonne(apres, COL_NOM)], 'Boulangerie Le Gall', 'le contenu de la ligne n’est pas effacé');
  app.arreter();
});

// ---------------------------------------------------------------- aller-retour sans doublon

test('aller-retour : une ligne écrite à la main entre dans le jeu, et un aller-retour ne fait jamais de doublon', async () => {
  const sim = simulation();
  const { app, p } = await monter(sim);
  const v = await app.miroir.creer(p, {});
  const entreprises = sim.tableur.lignes('Entreprises');
  const entetes = entreprises[0] as string[];
  // la personne ajoute une ligne à la main dans son classeur : un nom, rien d'autre
  const ajoutee = entetes.map(() => '');
  ajoutee[entetes.indexOf(COL_NOM)] = 'Scierie du Ponant';
  ajoutee[entetes.indexOf('Ville')] = 'Lorient';
  entreprises.push(ajoutee);
  // le jeu lui pose une référence, puis la synchronisation la fait entrer
  assert.ok((await app.miroir.adopter()) >= 1, 'une référence est posée sur la ligne écrite à la main');
  const reference = ajoutee[entetes.indexOf(COL_REFERENCE)] as string;
  assert.match(reference, /^lb-[0-9a-f]{10}$/);
  const cx = app.synchro.externeIdMiroir.bind(app.synchro);
  const branchement = brancherDe(app, 'entreprise');
  await app.synchro.synchroniser(branchement);
  const fiche = app.monde.objetsReels().find((x) => x.nom === 'Scierie du Ponant');
  assert.ok(fiche, 'la ligne écrite à la main est devenue une fiche du jeu');
  assert.equal(cx(branchement, fiche.id), reference, 'la fiche est reliée à SA ligne');
  assert.equal(fiche.champs.ville, 'Lorient');
  // le miroir complète la ligne existante (statut, date) : jamais une nouvelle
  await app.miroir.passer();
  assert.equal(sim.tableur.lignes('Entreprises').length, 2, 'aucun doublon après un aller-retour');
  assert.equal(ajoutee[entetes.indexOf(COL_STATUT)], STATUT_ACTIVE);
  // les allers-retours suivants s'arrêtent d'eux-mêmes : au bout de quelques tours, plus rien ne part
  let tours = 0;
  for (; tours < 5; tours++) {
    await app.synchro.synchroniser(branchement);
    if ((await app.miroir.passer()).envoyees === 0) break;
  }
  assert.ok(tours < 4, `l’aller-retour se stabilise (il a fallu ${tours} tours)`);
  // et plus rien ne bouge ensuite : ni appel, ni ligne, ni fiche en double
  await app.synchro.synchroniser(branchement);
  const appels = sim.trace.sheets.length;
  assert.equal((await app.miroir.passer()).envoyees, 0, 'pas de réécriture sans fin');
  assert.equal(sim.trace.sheets.length, appels, 'aucun appel inutile vers le classeur');
  assert.equal(sim.tableur.lignes('Entreprises').length, 2, 'toujours une seule ligne');
  assert.equal(app.monde.objetsReels().filter((x) => x.nom === 'Scierie du Ponant').length, 1, 'une seule fiche');
  assert.equal(ajoutee[entetes.indexOf(COL_REFERENCE)], reference, 'la référence de la ligne ne change jamais');
  assert.ok(v.types.length > 1);
  app.arreter();
});

/** Branchement de lecture posé par le miroir sur l'onglet d'un type. */
function brancherDe(app: Application, typeId: string): string {
  const c = app.miroir.classeur;
  assert.ok(c);
  const id = c.tables[typeId]?.connecteur;
  assert.ok(id, `branchement de lecture pour ${typeId}`);
  return id;
}

// ---------------------------------------------------------------- échec puis reprise

test('envoi impossible : rien n’est perdu, rien ne bloque, Réglages le dit, et l’envoi repart tout seul', async () => {
  const sim = simulation();
  const { app, p } = await monter(sim);
  await app.miroir.creer(p, {});
  sim.tableur.panne = 503;
  const o = app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Chantier Naval Guilvinec', roles: ['client'], champs: {} }) as { id: string };
  await app.miroir.passer();
  let v = app.miroir.vue(p);
  assert.equal(v.attente, 1, 'l’envoi reste en attente');
  assert.match(v.message ?? '', /en attente.*réessaie/s);
  assert.equal(v.dernier?.ok, false);
  assert.equal(sim.tableur.lignes('Entreprises').length, 1, 'rien n’a été écrit');
  // le jeu n'est pas bloqué : d'autres fiches continuent d'être créées
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Menuiserie Kerveur', roles: ['client'], champs: {} });
  // l'outil revient : « Envoyer maintenant » relance la file sans attendre le prochain essai
  app.miroir.relancer();
  const r = await app.miroir.passer();
  assert.equal(r.envoyees, 2, 'l’envoi en attente et le nouveau partent ensemble');
  v = app.miroir.vue(p);
  assert.equal(v.attente, 0);
  assert.equal(v.dernier?.ok, true);
  assert.match(v.message ?? '', /à jour/);
  assert.ok(ligneDe(sim.tableur.lignes('Entreprises'), o.id), 'la fiche a fini par arriver');
  app.arreter();
});

// ---------------------------------------------------------------- types décochés et « Tout réécrire »

test('types décochés : plus rien ne part pour eux ; « Tout réécrire » renvoie tout', async () => {
  const sim = simulation();
  const { app, p } = await monter(sim);
  await app.miroir.creer(p, {});
  const o = app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Transports Ar Mor', roles: ['fournisseur'], champs: {} }) as { id: string };
  app.monde.creerObjet(p, 's', { type: 'tache', nom: 'Relancer la commande', champs: {} });
  await app.miroir.passer();
  assert.equal(sim.tableur.lignes('Entreprises').length, 2);
  assert.equal(sim.tableur.lignes('Tâches').length, 2);
  // la personne décoche « Tâches »
  const v = app.miroir.regler(p, { type: 'tache', suivi: false });
  assert.equal(v.types.find((t) => t.id === 'tache')?.suivi, false);
  assert.equal(app.miroir.classeur?.tables.tache?.connecteur, null, 'le branchement de lecture de cet onglet est retiré');
  app.monde.creerObjet(p, 's', { type: 'tache', nom: 'Ne doit pas partir', champs: {} });
  await app.miroir.passer();
  assert.equal(sim.tableur.lignes('Tâches').length, 2, 'rien de neuf dans un onglet décoché');
  // « Tout réécrire » : les fiches repartent, les lignes existantes sont mises à jour et non doublées
  app.miroir.toutReecrire(p);
  assert.equal(app.miroir.vue(p).dernier, null);
  const r = await app.miroir.passer();
  assert.ok(r.envoyees >= 1);
  assert.equal(sim.tableur.lignes('Entreprises').length, 2, 'la ligne est mise à jour, pas ajoutée une deuxième fois');
  assert.ok(ligneDe(sim.tableur.lignes('Entreprises'), o.id));
  assert.equal(sim.tableur.lignes('Tâches').length, 2, 'un onglet décoché reste décoché');
  app.arreter();
});

// ---------------------------------------------------------------- « Ne plus suivre »

test('« Ne plus suivre » : le jeu oublie le classeur, l’entreprise garde son fichier intact', async () => {
  const sim = simulation();
  const { app, p } = await monter(sim);
  await app.miroir.creer(p, {});
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Verrerie de Pont-Aven', roles: ['client'], champs: {} });
  await app.miroir.passer();
  const avant = sim.tableur.lignes('Entreprises').length;
  const v = app.miroir.detacher(p);
  assert.equal(v.classeur, null);
  assert.equal(sim.tableur.lignes('Entreprises').length, avant, 'rien n’est effacé chez l’entreprise');
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Après le détachement', roles: ['client'], champs: {} });
  assert.equal((await app.miroir.passer()).envoyees, 0, 'plus aucune écriture');
  assert.equal(sim.tableur.lignes('Entreprises').length, avant);
  app.arreter();
});

// ---------------------------------------------------------------- Notion et Airtable

test('Notion : une base, un tableau par type, les lignes créées dans le tableau (API 2025-09-03 et après)', async () => {
  const sim = simulation();
  const { app, p } = await monter(sim, 'notion');
  const prop = app.miroir.proposition();
  assert.equal(prop?.outil, 'notion', 'sans compte Google, Notion fait l’affaire');
  const v = await app.miroir.creer(p, { precision: 'https://www.notion.so/kerlann/Suivi-' + 'f'.repeat(32) });
  assert.ok(v.classeur);
  // documentation Notion : POST /v1/databases avec parent + initial_data_source, puis POST /v1/data_sources
  const base = sim.trace.notion.find((a) => a.url.pathname === '/v1/databases');
  assert.ok(base);
  assert.equal(base.corps.parent.type, 'page_id', 'une page parente quand elle est donnée');
  assert.ok(base.corps.initial_data_source.properties[COL_NOM].title, 'exactement une propriété « title » : le nom');
  assert.deepEqual(base.corps.initial_data_source.properties[COL_STATUT].select.options.map((o: any) => o.name), [STATUT_ACTIVE, STATUT_SUPPRIMEE]);
  const types = typesSuivis(app.monde.univers);
  assert.equal(sim.notion.sources, types.length, 'un tableau par type');
  assert.equal(sim.trace.notion.filter((a) => a.url.pathname === '/v1/data_sources' && a.methode === 'POST').length, types.length - 1);
  // une fiche créée dans le jeu devient une ligne du tableau
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Cidrerie de Fouesnant', roles: ['client'], champs: {} });
  await app.miroir.passer();
  const page = sim.trace.notion.find((a) => a.url.pathname === '/v1/pages' && a.methode === 'POST');
  assert.ok(page, 'POST /v1/pages');
  assert.equal(page.corps.parent.type, 'data_source_id', 'une ligne naît dans un tableau, plus dans la base');
  app.arreter();
});

test('Airtable : une base, une table par type ; sans espace de travail, le jeu le dit simplement', async () => {
  const sim = simulation();
  const { app, p } = await monter(sim, 'airtable');
  // Airtable ne publie pas la liste des espaces de travail : le jeu demande l'identifiant plutôt que d'échouer
  await assert.rejects(app.miroir.creer(p, {}), /espaces de travail|wsp/i);
  const v = await app.miroir.creer(p, { precision: `wsp${'2'.repeat(14)}` });
  assert.ok(v.classeur);
  // documentation Airtable : POST /v0/meta/bases avec name, workspaceId, tables[]
  const base = sim.trace.airtable.find((a) => a.url.pathname === '/v0/meta/bases');
  assert.ok(base);
  assert.match(base.corps.workspaceId, /^wsp/);
  assert.equal(base.corps.tables.length, typesSuivis(app.monde.univers).length, 'toutes les tables en un appel');
  const clients = base.corps.tables.find((t: any) => t.name === 'Entreprises');
  assert.equal(clients.fields[0].name, COL_NOM, 'le premier champ devient le champ principal');
  assert.equal(clients.fields[0].type, 'singleLineText');
  const encours = clients.fields.find((x: any) => x.name === 'Encours');
  assert.equal(encours.type, 'number');
  assert.equal(encours.options.precision, 2, 'un champ nombre exige ses options');
  const statut = clients.fields.find((x: any) => x.name === COL_STATUT);
  assert.deepEqual(statut.options.choices.map((c: any) => c.name), [STATUT_ACTIVE, STATUT_SUPPRIMEE]);
  app.arreter();
});
