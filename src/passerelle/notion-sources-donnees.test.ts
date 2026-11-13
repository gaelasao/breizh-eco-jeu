/**
 * Connecteur Notion, API version 2026-03-11 : une « base de données » contient un ou plusieurs tableaux (« sources de
 * données »). Notion est simulé d'après sa documentation (`fetch` injecté, aucun appel réseau) : recherche qui renvoie
 * les tableaux, base qui liste ses tableaux, lecture paginée et création dans un tableau, erreurs documentées, et le
 * 400 que recevait l'ancienne version (2022-06-28) dès qu'une base avait plusieurs tableaux.
 * Rien ici ne prouve le comportement du vrai Notion : seulement que le connecteur suit ce que sa documentation décrit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';
import { ErreurReglage, ErreurSortante } from './sortant.ts';
import { ADAPTATEURS, type ContexteAdaptateur } from './sources.ts';

process.env.LB_AUTORISER_LOCAL = '1'; // relais simulé sur http://127.0.0.1 (ce fichier tourne dans son propre processus)

const notion = ADAPTATEURS.notion;
const VERSION = '2026-03-11';
const ANCIENNE = '2022-06-28';
/** Jeton d'essai construit à l'exécution (aucune forme de vrai secret dans le dépôt). */
const JETON = ['ntn', 'essai', 'local'].join('_');
/** Identifiants d'essai à la forme des UUID de Notion, visiblement faux, jamais réutilisés d'un test à l'autre. */
let serie = 0x100;
const uuid = () => { const h = (++serie).toString(16).padStart(32, '0'); return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-'); };
const court = (id: string) => id.replace(/-/g, '');
const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json', ...entetes } });
/** Erreur de Notion : { object: "error", status, code, message, additional_data }. */
const erreur = (statut: number, code: string, message: string, donnees?: Record<string, unknown>, entetes: Record<string, string> = {}) =>
  json({ object: 'error', status: statut, code, message, ...(donnees ? { additional_data: donnees } : {}) }, statut, entetes);

interface Appel { url: URL; methode: string; entetes: Headers; corps: any }
interface Tableau { id: string; nom: string; base: string; cree: string; corbeille: boolean; lisible: boolean; schema: Record<string, string>; pages: string[] }
interface Base { id: string; titre: string; corbeille: boolean; partagee: boolean; tableaux: string[] }
interface Page { id: string; tableau: string; valeurs: Record<string, unknown> }
interface DefTableau { nom: string; cree?: string; schema?: Record<string, string>; lignes?: Record<string, unknown>[] }
interface Simulation {
  appels: Appel[];
  bases: Map<string, Base>;
  tableaux: Map<string, Tableau>;
  pages: Map<string, Page>;
  /** Capacités de l'intégration (réglages de l'intégration dans Notion). */
  capacites: { lire: boolean; modifier: boolean; inserer: boolean };
  /** Réponses imposées aux prochains appels (débit limité, panne…), dans l'ordre. */
  imposees: Response[];
  /** Ajoute un tableau à une base (ce que fait une personne dans Notion). */
  tableau(base: Base, d: DefTableau): Tableau;
  base(titre: string, defs: DefTableau[]): Base;
  f: typeof fetch;
}

const SCHEMA: Record<string, string> = { Nom: 'title', Ville: 'rich_text', Effectif: 'number', Statut: 'select', Suivi: 'status', Tags: 'multi_select', Depuis: 'date', Actif: 'checkbox', Courriel: 'email', Site: 'url', Score: 'formula', Liens: 'relation' };
const riche = (s: string) => (s ? [{ type: 'text', text: { content: s, link: null }, plain_text: s, href: null }] : []);

/** Valeur d'une propriété telle que Notion la renvoie dans une page. */
function propriete(type: string, v: unknown): Record<string, unknown> {
  switch (type) {
    case 'title': return { id: 'title', type, title: riche(String(v ?? '')) };
    case 'rich_text': return { id: 'rt', type, rich_text: riche(String(v ?? '')) };
    case 'number': return { id: 'nb', type, number: v ?? null };
    case 'select': case 'status': return { id: type, type, [type]: v ? { id: 'opt', name: v, color: 'default' } : null };
    case 'multi_select': return { id: 'ms', type, multi_select: ((v as string[] | undefined) ?? []).map((name) => ({ id: 'opt', name, color: 'default' })) };
    case 'date': return { id: 'dt', type, date: v ? { start: v, end: null, time_zone: null } : null };
    case 'checkbox': return { id: 'cb', type, checkbox: v === true };
    case 'formula': return { id: 'fx', type, formula: { type: 'string', string: v ?? null } };
    case 'relation': return { id: 'rel', type, relation: ((v as string[] | undefined) ?? []).map((id) => ({ id })), has_more: false };
    default: return { id: type, type, [type]: v ?? null }; // email, url, phone_number
  }
}

/** Notion simulé (version 2026-03-11, et ce que l'ancienne version répondait aux mêmes bases). */
function notionSimule(): Simulation {
  const appels: Appel[] = [];
  const bases = new Map<string, Base>();
  const tableaux = new Map<string, Tableau>();
  const pages = new Map<string, Page>();
  const curseurs = new Map<string, number>();
  const sim: Simulation = {
    appels, bases, tableaux, pages,
    capacites: { lire: true, modifier: true, inserer: true },
    imposees: [],
    tableau(base: Base, d: DefTableau): Tableau {
      const t: Tableau = { id: uuid(), nom: d.nom, base: base.id, cree: d.cree ?? '2024-01-10T09:00:00.000Z', corbeille: false, lisible: true, schema: d.schema ?? SCHEMA, pages: [] };
      tableaux.set(t.id, t);
      base.tableaux.push(t.id);
      for (const valeurs of d.lignes ?? []) { const p: Page = { id: uuid(), tableau: t.id, valeurs }; pages.set(p.id, p); t.pages.push(p.id); }
      return t;
    },
    base(titre: string, defs: DefTableau[]): Base {
      const b: Base = { id: uuid(), titre, corbeille: false, partagee: true, tableaux: [] };
      bases.set(b.id, b);
      for (const d of defs) sim.tableau(b, d);
      return b;
    },
    f: (async (url: URL | string, init?: RequestInit) => {
      const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: init?.body ? JSON.parse(String(init.body)) : null };
      appels.push(a);
      assert.equal(a.url.origin, 'https://api.notion.com', 'seul Notion est appelé');
      if (a.entetes.get('authorization') !== `Bearer ${JETON}`) return erreur(401, 'unauthorized', 'API token is invalid.');
      const version = a.entetes.get('notion-version');
      if (!version) return erreur(400, 'missing_version', 'Notion-Version header failed validation: Notion-Version header should be defined, instead was undefined.');
      const imposee = sim.imposees.shift();
      if (imposee) return imposee;
      return version < '2025-09-03' ? ancienne(a) : actuelle(a);
    }) as typeof fetch,
  };

  const trouver = <T extends { id: string }>(m: Map<string, T>, id: string | undefined) => [...m.values()].find((x) => court(x.id) === court(id ?? ''));
  const introuvable = (quoi: string, id: string) => erreur(404, 'object_not_found', `Could not find ${quoi} with ID: ${id}. Make sure the relevant pages and databases are shared with your connection "Living Business".`);
  const interdit = () => erreur(403, 'restricted_resource', 'API token does not have access to this resource.');
  const invalide = (message: string) => erreur(400, 'validation_error', message);
  const cles = (o: unknown, permises: string[]) => Object.keys((o ?? {}) as object).find((k) => !permises.includes(k));
  const schemaObjet = (t: Tableau) => Object.fromEntries(Object.entries(t.schema).map(([nom, type]) => [nom, { id: type, name: nom, description: null, type, [type]: {} }]));
  const pageObjet = (p: Page) => {
    const t = tableaux.get(p.tableau) as Tableau;
    return {
      object: 'page', id: p.id, created_time: t.cree, last_edited_time: t.cree, in_trash: false, is_archived: false, is_locked: false, url: `https://app.notion.com/p/${court(p.id)}`, public_url: null,
      parent: { type: 'data_source_id', data_source_id: t.id, database_id: t.base }, icon: null, cover: null,
      properties: Object.fromEntries(Object.entries(t.schema).map(([nom, type]) => [nom, propriete(type, p.valeurs[nom])])),
    };
  };
  const tableauObjet = (t: Tableau) => ({
    object: 'data_source', id: t.id, title: riche(t.nom), description: [], parent: { type: 'database_id', database_id: t.base }, database_parent: { type: 'workspace', workspace: true },
    is_inline: false, database_type: null, in_trash: t.corbeille, created_time: t.cree, last_edited_time: t.cree, properties: schemaObjet(t), icon: null, cover: null, url: `https://app.notion.com/p/${court(t.id)}`, public_url: null,
  });
  const liste = (results: unknown[], suite: string | null = null) => ({ object: 'list', type: 'page_or_data_source', page_or_data_source: {}, results, next_cursor: suite, has_more: suite !== null });
  /** Tableau joignable par l'intégration : sa base est partagée, et il est lisible. */
  const tableauJoignable = (id: string | undefined) => { const t = trouver(tableaux, id); return t && t.lisible && bases.get(t.base)?.partagee ? t : undefined; };

  /** Écrit les valeurs envoyées (forme « Page write » de la référence) ; une propriété inconnue ou mal typée est refusée. */
  function ecrireValeurs(t: Tableau, p: Page, properties: Record<string, any> | undefined): Response | null {
    for (const [nom, val] of Object.entries(properties ?? {})) {
      const type = t.schema[nom];
      if (!type) return invalide(`${nom} is not a property that exists.`);
      if (type === 'formula' || !val || !(type in val)) return invalide(`body failed validation: body.properties.${nom}.${type} should be defined, instead was \`undefined\`.`);
      const v = val[type];
      p.valeurs[nom] = type === 'title' || type === 'rich_text' ? v.map((x: any) => x.text.content).join('')
        : type === 'select' || type === 'status' ? v?.name ?? null
        : type === 'multi_select' ? v.map((x: any) => x.name)
        : type === 'date' ? v?.start ?? null : v;
    }
    return null;
  }

  /** Version 2026-03-11 (formes de la référence : recherche, base, tableau, requête, pages). */
  function actuelle(a: Appel): Response {
    const chemin = a.url.pathname;
    let m: RegExpExecArray | null;
    if (chemin === '/v1/search' && a.methode === 'POST') {
      if (!sim.capacites.lire) return interdit();
      const filtre = a.corps?.filter;
      if (cles(a.corps, ['sort', 'query', 'start_cursor', 'page_size', 'filter']) || (filtre && !['page', 'data_source'].includes(filtre.value))) return invalide('body failed validation: body.filter.value should be `"page"` or `"data_source"`.');
      const tous = [...bases.values()].filter((b) => b.partagee && !b.corbeille).flatMap((b) => b.tableaux.map((id) => tableaux.get(id) as Tableau)).filter((t) => !t.corbeille && t.lisible);
      const debut = a.corps.start_cursor ? curseurs.get(a.corps.start_cursor) : 0;
      if (debut === undefined) return invalide('The start_cursor provided is invalid');
      const taille = Math.min(a.corps.page_size ?? 100, 100);
      let suite: string | null = null;
      if (debut + taille < tous.length) { suite = uuid(); curseurs.set(suite, debut + taille); } // la recherche documente un curseur de forme UUID
      return json(liste(tous.slice(debut, debut + taille).map(tableauObjet), suite));
    }
    if ((m = /^\/v1\/databases\/([0-9a-f-]+)$/i.exec(chemin)) && a.methode === 'GET') {
      const b = trouver(bases, m[1]);
      if (!b || !b.partagee) return introuvable('database', m[1] as string);
      if (!sim.capacites.lire) return interdit();
      return json({
        object: 'database', id: b.id, title: riche(b.titre), description: [], parent: { type: 'workspace', workspace: true }, is_inline: false, database_type: null, in_trash: b.corbeille, is_locked: false,
        show_data_source_title: true, created_time: '2024-01-10T09:00:00.000Z', last_edited_time: '2026-10-01T09:00:00.000Z', icon: null, cover: null, url: `https://app.notion.com/p/${court(b.id)}`, public_url: null,
        data_sources: b.tableaux.map((id) => ({ id, name: (tableaux.get(id) as Tableau).nom })),
      });
    }
    // les lignes ne se lisent plus dans la base : le chemin de l'ancienne version n'existe plus
    if (/^\/v1\/databases\/[0-9a-f-]+\/query$/i.test(chemin)) return erreur(400, 'invalid_request_url', 'Invalid request URL');
    if ((m = /^\/v1\/data_sources\/([0-9a-f-]+)$/i.exec(chemin)) && a.methode === 'GET') {
      const t = tableauJoignable(m[1]);
      if (!t) return introuvable('data_source', m[1] as string);
      if (!sim.capacites.lire) return interdit();
      return json(tableauObjet(t));
    }
    if ((m = /^\/v1\/data_sources\/([0-9a-f-]+)\/query$/i.exec(chemin)) && a.methode === 'POST') {
      const t = tableauJoignable(m[1]);
      if (!t) return introuvable('data_source', m[1] as string);
      if (!sim.capacites.lire) return interdit();
      const inconnue = cles(a.corps, ['sorts', 'filter', 'start_cursor', 'page_size', 'is_archived', 'result_type']);
      if (inconnue) return invalide(`body failed validation: body.${inconnue} should be not present, instead was defined.`);
      if (a.corps.result_type !== undefined && !['page', 'data_source'].includes(a.corps.result_type)) return invalide('body failed validation: body.result_type should be `"page"` or `"data_source"`.');
      const taille = a.corps.page_size ?? 100;
      if (!Number.isInteger(taille) || taille < 1 || taille > 100) return invalide('body failed validation: body.page_size should be between 1 and 100.');
      const debut = a.corps.start_cursor ? curseurs.get(a.corps.start_cursor) : 0;
      if (debut === undefined) return invalide('The start_cursor provided is invalid');
      let suite: string | null = null;
      // curseur opaque (ni UUID, ni court) : à renvoyer tel quel
      if (debut + taille < t.pages.length) { suite = `sess.${Buffer.from(JSON.stringify({ t: t.id, o: debut + taille })).toString('base64url')}.${'z'.repeat(80)}`; curseurs.set(suite, debut + taille); }
      return json(liste(t.pages.slice(debut, debut + taille).map((id) => pageObjet(pages.get(id) as Page)), suite));
    }
    if (chemin === '/v1/pages' && a.methode === 'POST') {
      const parent = a.corps?.parent ?? {};
      if ('archived' in a.corps) return invalide('body failed validation: body.archived should be not present, instead was `false`.');
      let t: Tableau | undefined;
      if (parent.data_source_id) t = tableauJoignable(parent.data_source_id);
      else if (parent.database_id) {
        const b = trouver(bases, parent.database_id);
        if (b?.partagee && b.tableaux.length > 1) return erreur(400, 'validation_error', 'Databases with multiple data sources are not supported in this API version.', { error_type: 'multiple_data_sources_for_database', database_id: b.id, child_data_source_ids: b.tableaux, minimum_api_version: '2025-09-03' });
        t = b?.partagee ? tableaux.get(b.tableaux[0] ?? '') : undefined;
      } else return invalide('body failed validation: body.parent should be defined.');
      if (!t) return introuvable('data_source', String(parent.data_source_id ?? parent.database_id));
      if (!sim.capacites.inserer) return interdit();
      const p: Page = { id: uuid(), tableau: t.id, valeurs: {} };
      const refus = ecrireValeurs(t, p, a.corps.properties);
      if (refus) return refus;
      pages.set(p.id, p);
      t.pages.push(p.id);
      return json(pageObjet(p));
    }
    if ((m = /^\/v1\/pages\/([0-9a-f-]+)$/i.exec(chemin)) && a.methode === 'PATCH') {
      const p = trouver(pages, m[1]);
      const t = p ? tableauJoignable(p.tableau) : undefined;
      if (!p || !t) return introuvable('page', m[1] as string);
      if (!sim.capacites.modifier) return interdit();
      // `archived` a été retiré en 2026-03-11 (seul `in_trash` est accepté)
      if ('archived' in a.corps) return invalide('body failed validation: body.archived should be not present, instead was `false`.');
      return ecrireValeurs(t, p, a.corps.properties) ?? json(pageObjet(p));
    }
    return erreur(400, 'invalid_request_url', 'Invalid request URL');
  }

  /** Version 2022-06-28 : ce que le connecteur appelait avant, et ce que Notion y répond depuis septembre 2025. */
  function ancienne(a: Appel): Response {
    const m = /^\/v1\/databases\/([0-9a-f-]+)(\/query)?$/i.exec(a.url.pathname);
    if (m) {
      const b = trouver(bases, m[1]);
      if (!b || !b.partagee) return introuvable('database', m[1] as string);
      if (b.tableaux.length > 1) return erreur(400, 'validation_error', 'Databases with multiple data sources are not supported in this API version.', { error_type: 'multiple_data_sources_for_database', database_id: b.id, child_data_source_ids: b.tableaux, minimum_api_version: '2025-09-03' });
      const t = tableaux.get(b.tableaux[0] ?? '') as Tableau;
      return m[2] ? json({ object: 'list', results: t.pages.map((id) => pageObjet(pages.get(id) as Page)), next_cursor: null, has_more: false }) : json({ object: 'database', id: b.id, title: riche(b.titre), properties: schemaObjet(t) });
    }
    // une base à plusieurs tableaux disparaît de la recherche des anciennes versions
    if (a.url.pathname === '/v1/search') return json({ object: 'list', results: [...bases.values()].filter((b) => b.partagee && b.tableaux.length === 1).map((b) => ({ object: 'database', id: b.id, title: riche(b.titre) })), next_cursor: null, has_more: false });
    return erreur(400, 'invalid_request_url', 'Invalid request URL');
  }
  return sim;
}

/** Contexte d'adaptateur qui garde les précisions données à la personne. */
function contexte() {
  const avis: string[] = [];
  const ctx: ContexteAdaptateur = { majSecret: () => {}, avis: (t) => { avis.push(t); } };
  return { ctx, avis };
}
const chemins = (appels: Appel[]) => appels.map((a) => `${a.methode} ${a.url.pathname}`);
const versionPartout = (appels: Appel[]) => { for (const a of appels) assert.equal(a.entetes.get('notion-version'), VERSION, `${a.methode} ${a.url.pathname}`); };
const refus = (re: RegExp, statut: number | null) => (e: unknown) => { assert.ok(e instanceof ErreurSortante, 'erreur du connecteur'); assert.match(e.message, re); assert.equal(e.statut, statut); return true; };
const FICHE = { Nom: 'Cave du Port', Ville: 'Brest', Effectif: 12, Statut: 'Client', Suivi: 'En cours', Tags: ['vin', 'local'], Depuis: '2021-03-04', Actif: true, Courriel: 'contact@caveduport.test', Site: 'https://caveduport.test', Score: 'A', Liens: ['r1', 'r2'] };

// ---------------------------------------------------------------- base à un seul tableau

test('Notion : base à un seul tableau, branchement enregistré avec l’identifiant de la base → son tableau est retrouvé, lignes lues comme avant', async () => {
  const sim = notionSimule();
  const base = sim.base('Clients', [{ nom: 'Clients', lignes: [FICHE, { Nom: 'Ty Gwenn' }] }]);
  const tableau = base.tableaux[0] as string;
  const { ctx, avis } = contexte();
  const r = await notion.lire({ base: court(base.id) }, JETON, sim.f, ctx);
  assert.deepEqual(chemins(sim.appels), [`GET /v1/databases/${court(base.id)}`, `POST /v1/data_sources/${tableau}/query`]);
  versionPartout(sim.appels);
  assert.deepEqual(sim.appels[1]?.corps, { page_size: 100, result_type: 'page' });
  assert.equal(r.length, 2);
  assert.equal(r[0]?.externeId, sim.tableaux.get(tableau)?.pages[0]);
  // même lecture des propriétés qu'avant le changement de version
  assert.deepEqual(r[0]?.champs, { Nom: 'Cave du Port', Ville: 'Brest', Effectif: '12', Statut: 'Client', Suivi: 'En cours', Tags: 'vin, local', Depuis: '2021-03-04', Actif: 'true', Courriel: 'contact@caveduport.test', Site: 'https://caveduport.test', Score: 'A', Liens: 'r1, r2' });
  assert.deepEqual(r[1]?.champs, { Nom: 'Ty Gwenn', Ville: '', Effectif: '', Statut: '', Suivi: '', Tags: '', Depuis: '', Actif: 'false', Courriel: '', Site: '', Score: '', Liens: '' });
  assert.deepEqual(avis, [], 'un seul tableau : rien à préciser');
  // l'identifiant avec ses tirets (copié tel quel) désigne la même base
  assert.equal((await notion.lire({ base: base.id }, JETON, sim.f)).length, 2);
  assert.equal(sim.appels.some((a) => /\/v1\/databases\/[^/]+\/query/.test(a.url.pathname)), false, 'plus aucune lecture par l’ancien chemin');
});

test('Notion : lecture paginée d’un tableau, curseur opaque renvoyé tel quel', async () => {
  const sim = notionSimule();
  const base = sim.base('Stock', [{ nom: 'Stock', schema: { Nom: 'title' }, lignes: Array.from({ length: 230 }, (_, i) => ({ Nom: `Article ${i + 1}` })) }]);
  const r = await notion.lire({ base: court(base.id) }, JETON, sim.f);
  assert.deepEqual(r.map((x) => x.champs.Nom), Array.from({ length: 230 }, (_, i) => `Article ${i + 1}`));
  assert.equal(new Set(r.map((x) => x.externeId)).size, 230);
  const requetes = sim.appels.filter((a) => a.url.pathname.endsWith('/query'));
  assert.equal(requetes.length, 3);
  assert.equal(requetes[0]?.corps.start_cursor, undefined);
  for (const [i, a] of requetes.entries()) {
    assert.equal(a.methode, 'POST');
    assert.equal(a.corps.page_size, 100);
    if (i > 0) { assert.match(a.corps.start_cursor, /^sess\./, 'curseur de la réponse précédente'); assert.ok(a.corps.start_cursor.length > 100); }
  }
  versionPartout(sim.appels);
});

test('Notion : création sous le tableau (parent data_source_id) et mise à jour d’une page, mêmes valeurs qu’avant', async () => {
  const sim = notionSimule();
  const base = sim.base('Fournisseurs', [{ nom: 'Fournisseurs' }]);
  const tableau = base.tableaux[0] as string;
  const cfg = { base: court(base.id) };
  // aucune lecture avant : le tableau est retrouvé dans la base, puis son schéma donne le type de chaque colonne
  const id = await notion.ecrire?.(cfg, JETON, null, { Nom: 'Négoce Ar Vro', Ville: 'Lorient', Effectif: 8, Statut: 'Prospect', Suivi: 'À faire', Tags: 'bois, local', Depuis: '2026-01-15', Actif: 'oui', Courriel: 'a@arvro.test', Site: null, Score: 'ignoré', Inconnue: 'x' }, sim.f);
  assert.deepEqual(chemins(sim.appels), [`GET /v1/databases/${court(base.id)}`, `GET /v1/data_sources/${tableau}`, 'POST /v1/pages']);
  const creation = sim.appels[2]?.corps;
  assert.deepEqual(creation.parent, { type: 'data_source_id', data_source_id: tableau });
  assert.deepEqual(creation.properties, {
    Nom: { title: [{ text: { content: 'Négoce Ar Vro' } }] }, Ville: { rich_text: [{ text: { content: 'Lorient' } }] }, Effectif: { number: 8 }, Statut: { select: { name: 'Prospect' } }, Suivi: { status: { name: 'À faire' } },
    Tags: { multi_select: [{ name: 'bois' }, { name: 'local' }] }, Depuis: { date: { start: '2026-01-15' } }, Actif: { checkbox: true }, Courriel: { email: 'a@arvro.test' }, Site: { url: null },
  }, 'formule et colonne inconnue jamais écrites');
  assert.ok(id && sim.pages.has(id), 'identifiant de la page créée');
  assert.equal(sim.pages.get(id)?.tableau, tableau);
  // mise à jour : seules les propriétés partent (ni parent, ni « archived », retiré en 2026-03-11) ; le schéma n'est pas redemandé
  sim.appels.length = 0;
  assert.equal(await notion.ecrire?.(cfg, JETON, id, { Ville: 'Quimper', Actif: false }, sim.f), id);
  assert.deepEqual(chemins(sim.appels), [`PATCH /v1/pages/${id}`]);
  assert.deepEqual(sim.appels[0]?.corps, { properties: { Ville: { rich_text: [{ text: { content: 'Quimper' } }] }, Actif: { checkbox: false } } });
  assert.equal(sim.pages.get(id)?.valeurs.Ville, 'Quimper');
  versionPartout(sim.appels);
  await assert.rejects(async () => notion.ecrire?.(cfg, JETON, '../autre', { Ville: 'x' }, sim.f), /Identifiant de page Notion invalide/);
});

test('Notion : tableau vide → le schéma est demandé avant d’écrire (aucune page créée sans ses valeurs)', async () => {
  const sim = notionSimule();
  const base = sim.base('Nouveaux', [{ nom: 'Nouveaux', schema: { Nom: 'title', Ville: 'rich_text' } }]);
  const cfg = { base: court(base.id) };
  assert.deepEqual(await notion.lire(cfg, JETON, sim.f), []);
  const id = await notion.ecrire?.(cfg, JETON, null, { Nom: 'Première', Ville: 'Vannes' }, sim.f);
  assert.deepEqual(sim.pages.get(id ?? '')?.valeurs, { Nom: 'Première', Ville: 'Vannes' });
  assert.deepEqual((await notion.lire(cfg, JETON, sim.f)).map((x) => x.champs), [{ Nom: 'Première', Ville: 'Vannes' }]);
});

// ---------------------------------------------------------------- base à plusieurs tableaux

test('Notion : base à plusieurs tableaux → la liste propose chaque tableau sur sa ligne, nommé avec sa base ; le tableau choisi est lu et écrit', async () => {
  const sim = notionSimule();
  const simple = sim.base('Fournisseurs Bretagne', [{ nom: 'Fournisseurs Bretagne', lignes: [{ Nom: 'Seul' }] }]);
  const double = sim.base('Suivi commercial', [{ nom: 'Commandes', schema: { Nom: 'title', Montant: 'number' }, lignes: [{ Nom: 'C-1', Montant: 120 }] }, { nom: 'Contacts\u0000', cree: '2026-09-20T08:00:00.000Z', lignes: [{ Nom: 'Anna' }, { Nom: 'Erwan' }] }]);
  const cachee = sim.base('Non partagée', [{ nom: 'Secret' }]);
  cachee.partagee = false;
  sim.base('À la corbeille', [{ nom: 'Vieux' }]).corbeille = true;
  const [commandes, contacts] = double.tableaux as [string, string];
  const options = await notion.choix?.('base', {}, JETON, sim.f) ?? [];
  assert.deepEqual(options, [
    { valeur: `source:${court(simple.tableaux[0] as string)}`, libelle: 'Fournisseurs Bretagne' },
    { valeur: `source:${court(commandes)}`, libelle: 'Suivi commercial — tableau « Commandes »' },
    { valeur: `source:${court(contacts)}`, libelle: 'Suivi commercial — tableau « Contacts »' },
  ]);
  assert.deepEqual(sim.appels[0]?.corps, { filter: { property: 'object', value: 'data_source' }, page_size: 100 });
  // seule la base à plusieurs tableaux est relue (son nom) : un appel de plus, pas un par base
  assert.deepEqual(chemins(sim.appels), ['POST /v1/search', `GET /v1/databases/${court(double.id)}`]);
  versionPartout(sim.appels);
  assert.deepEqual(await notion.choix?.('jeton', {}, JETON, sim.f), []);

  // le tableau choisi : lu directement (la base n'est plus interrogée), et les créations y vont
  sim.appels.length = 0;
  const cfg = { base: options[2]?.valeur ?? '' };
  const { ctx, avis } = contexte();
  assert.deepEqual((await notion.lire(cfg, JETON, sim.f, ctx)).map((x) => x.champs.Nom), ['Anna', 'Erwan']);
  assert.deepEqual(chemins(sim.appels), [`POST /v1/data_sources/${contacts}/query`]);
  assert.deepEqual(avis, [], 'tableau choisi : rien à préciser');
  const id = await notion.ecrire?.(cfg, JETON, null, { Nom: 'Maël' }, sim.f);
  assert.equal(sim.pages.get(id ?? '')?.tableau, contacts);
  assert.equal(sim.tableaux.get(commandes)?.pages.length, 1, 'rien dans l’autre tableau');
  assert.deepEqual((await notion.lire({ base: options[1]?.valeur ?? '' }, JETON, sim.f)).map((x) => x.champs), [{ Nom: 'C-1', Montant: '120' }]);
});

test('Notion : la liste suit la pagination de la recherche et garde chaque tableau une seule fois', async () => {
  const sim = notionSimule();
  for (let i = 1; i <= 130; i++) sim.base(`Base ${i}`, [{ nom: `Base ${i}`, schema: { Nom: 'title' } }]);
  const options = await notion.choix?.('base', {}, JETON, sim.f) ?? [];
  assert.equal(options.length, 130);
  assert.equal(new Set(options.map((o) => o.valeur)).size, 130);
  assert.ok(options.every((o) => /^source:[0-9a-f]{32}$/.test(o.valeur)));
  assert.deepEqual(chemins(sim.appels), ['POST /v1/search', 'POST /v1/search']);
  assert.match(sim.appels[1]?.corps.start_cursor, /^[0-9a-f-]{36}$/);
});

// ---------------------------------------------------------------- branchement enregistré avant, base devenue multiple

test('Notion : branchement enregistré avec l’identifiant d’une base qui a maintenant plusieurs tableaux → le plus ancien, et la personne est prévenue', async () => {
  const sim = notionSimule();
  const base = sim.base('Clients', [{ nom: 'Clients', cree: '2023-05-02T10:00:00.000Z', lignes: [{ Nom: 'Cave du Port' }] }]);
  const origine = base.tableaux[0] as string;
  const cfg = { base: court(base.id) };
  let c = contexte();
  assert.deepEqual((await notion.lire(cfg, JETON, sim.f, c.ctx)).map((x) => x.champs.Nom), ['Cave du Port']);
  assert.deepEqual(c.avis, []);

  // quelqu'un ajoute un tableau dans Notion (plus récent, et placé en tête de la liste de la base)
  const ajoute = sim.tableau(base, { nom: 'Prospects', cree: '2026-10-30T10:00:00.000Z', lignes: [{ Nom: 'Nouveau prospect' }] });
  base.tableaux.reverse();
  sim.appels.length = 0;
  c = contexte();
  assert.deepEqual((await notion.lire(cfg, JETON, sim.f, c.ctx)).map((x) => x.champs.Nom), ['Cave du Port'], 'le branchement lit toujours le même tableau');
  assert.deepEqual(c.avis, ['Base Notion à 2 tableaux : seul « Clients » (le plus ancien) est synchronisé. Pour un autre, refaites le branchement en le choisissant dans la liste.']);
  assert.deepEqual(chemins(sim.appels), [`GET /v1/databases/${court(base.id)}`, `GET /v1/data_sources/${ajoute.id}`, `GET /v1/data_sources/${origine}`, `POST /v1/data_sources/${origine}/query`]);
  versionPartout(sim.appels);
  // les créations vont dans ce même tableau
  const id = await notion.ecrire?.(cfg, JETON, null, { Nom: 'Créée dans le jeu' }, sim.f);
  assert.equal(sim.pages.get(id ?? '')?.tableau, origine);
  assert.equal(ajoute.pages.length, 1);

  // tableau le plus ancien mis à la corbeille, ou que l'intégration ne peut pas lire : le suivant
  (sim.tableaux.get(origine) as Tableau).corbeille = true;
  c = contexte();
  assert.deepEqual((await notion.lire(cfg, JETON, sim.f, c.ctx)).map((x) => x.champs.Nom), ['Nouveau prospect']);
  assert.match(c.avis[0] ?? '', /seul « Prospects » \(le plus ancien\)/);
  (sim.tableaux.get(origine) as Tableau).corbeille = false;
  (sim.tableaux.get(origine) as Tableau).lisible = false;
  assert.deepEqual((await notion.lire(cfg, JETON, sim.f)).map((x) => x.champs.Nom), ['Nouveau prospect']);
  ajoute.lisible = false;
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/aucun tableau lisible/, null));
});

test('Notion : même date de création → l’identifiant départage, quel que soit l’ordre donné par Notion', async () => {
  const sim = notionSimule();
  const base = sim.base('Jumeaux', [{ nom: 'A', lignes: [{ Nom: 'a' }] }, { nom: 'B', lignes: [{ Nom: 'b' }] }]);
  const cfg = { base: court(base.id) };
  assert.deepEqual((await notion.lire(cfg, JETON, sim.f)).map((x) => x.champs.Nom), ['a']);
  base.tableaux.reverse();
  assert.deepEqual((await notion.lire(cfg, JETON, sim.f)).map((x) => x.champs.Nom), ['a']);
});

// ---------------------------------------------------------------- ce que recevait l'ancienne version

test('Notion : l’ancienne version (2022-06-28) recevait 400 sur une base à plusieurs tableaux ; le connecteur ne l’envoie plus et lit la base', async () => {
  const sim = notionSimule();
  const base = sim.base('Suivi', [{ nom: 'Commandes', cree: '2024-02-01T00:00:00.000Z', lignes: [{ Nom: 'C-1' }] }, { nom: 'Contacts', cree: '2026-09-01T00:00:00.000Z' }]);
  const seule = sim.base('Seule', [{ nom: 'Seule', lignes: [{ Nom: 'x' }] }]);
  const ancien = (chemin: string, methode: string, corps?: unknown) => sim.f(`https://api.notion.com/v1${chemin}`, { method: methode, headers: { authorization: `Bearer ${JETON}`, 'notion-version': ANCIENNE, 'content-type': 'application/json' }, ...(corps ? { body: JSON.stringify(corps) } : {}) });
  // les appels que faisait le connecteur avant ce changement
  for (const [chemin, methode, corps] of [[`/databases/${court(base.id)}/query`, 'POST', { page_size: 100 }], [`/databases/${court(base.id)}`, 'GET', undefined]] as const) {
    const r = await ancien(chemin, methode, corps);
    assert.equal(r.status, 400);
    assert.deepEqual(await r.json(), {
      object: 'error', status: 400, code: 'validation_error', message: 'Databases with multiple data sources are not supported in this API version.',
      additional_data: { error_type: 'multiple_data_sources_for_database', database_id: base.id, child_data_source_ids: base.tableaux, minimum_api_version: '2025-09-03' },
    });
  }
  // … et la base disparaissait de la recherche ; une base à un seul tableau continuait de répondre
  const recherche = await (await ancien('/search', 'POST', { filter: { property: 'object', value: 'database' } })).json() as { results: { id: string }[] };
  assert.deepEqual(recherche.results.map((x) => x.id), [seule.id]);
  assert.equal((await ancien(`/databases/${court(seule.id)}/query`, 'POST', { page_size: 100 })).status, 200);

  // le connecteur : version 2026-03-11 partout, la même base se lit
  sim.appels.length = 0;
  assert.deepEqual((await notion.lire({ base: court(base.id) }, JETON, sim.f)).map((x) => x.champs.Nom), ['C-1']);
  assert.deepEqual((await notion.choix?.('base', {}, JETON, sim.f) ?? []).map((o) => o.libelle), ['Suivi — tableau « Commandes »', 'Suivi — tableau « Contacts »', 'Seule']);
  versionPartout(sim.appels);
  // si Notion faisait encore cette réponse, elle serait dite en français
  sim.imposees.push(erreur(400, 'validation_error', 'Databases with multiple data sources are not supported in this API version.', { error_type: 'multiple_data_sources_for_database', database_id: base.id, child_data_source_ids: base.tableaux, minimum_api_version: '2025-09-03' }));
  await assert.rejects(notion.lire({ base: court(base.id) }, JETON, sim.f), refus(/contient plusieurs tableaux : refaites le branchement en choisissant le tableau/, 400));
});

// ---------------------------------------------------------------- dans le jeu : branchement, historique, assistant

async function monter(f: typeof fetch) {
  const app = await Application.creer({ exemple: 'pme', fetch: f });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  app.monde.viderDemo(p, 's', { nom: 'Test' });
  return { app, p };
}

test('Notion dans le jeu : un branchement enregistré avec l’identifiant de la base continue de se synchroniser ; le tableau lu est dit dans l’historique et à l’essai', async () => {
  const sim = notionSimule();
  const base = sim.base('Clients', [{ nom: 'Clients', cree: '2023-05-02T10:00:00.000Z', schema: { Nom: 'title', Ville: 'rich_text' }, lignes: [{ Nom: 'Cave du Port', Ville: 'Brest' }, { Nom: 'Ty Gwenn', Ville: 'Quimper' }] }]);
  const { app, p } = await monter(sim.f);
  // réglage tel qu'il était enregistré avant ce changement : l'identifiant de la base, rien d'autre
  const c = app.synchro.creer(p, { source: 'notion', config: { base: court(base.id), jeton: JETON }, typeObjet: 'entreprise', roles: [], mapping: { Nom: '__nom' }, sens: 'lecture', intervalleS: 300, actif: false });
  let vue = await app.synchro.synchroniser(c.id, p);
  assert.equal(vue.statut, 'ok');
  assert.equal(vue.message, null);
  assert.equal(vue.liens, 2);
  assert.equal(vue.historique[0]?.detail, '2 lu(s)');
  // un deuxième tableau apparaît dans la base : même tableau lu, et c'est écrit dans l'historique du branchement
  sim.tableau(base, { nom: 'Prospects', cree: '2026-10-30T10:00:00.000Z', schema: { Nom: 'title' }, lignes: [{ Nom: 'Prospect' }] });
  vue = await app.synchro.synchroniser(c.id, p);
  assert.equal(vue.statut, 'ok');
  assert.equal(vue.liens, 2, 'aucune fiche de l’autre tableau');
  assert.equal(vue.historique[0]?.detail, '2 lu(s) · Base Notion à 2 tableaux : seul « Clients » (le plus ancien) est synchronisé. Pour un autre, refaites le branchement en le choisissant dans la liste.');
  assert.ok((vue.historique[0]?.detail.length ?? 0) <= 200);
  // l'essai de l'assistant (identifiant saisi à la main) le dit aussi ; rien à préciser pour un tableau choisi
  const essai = await app.synchro.apercu(p, { source: 'notion', config: { base: base.id, jeton: JETON }, typeObjet: 'entreprise' });
  assert.equal(essai.enregistrements, 2);
  assert.match(String(essai.precision), /seul « Clients » \(le plus ancien\) est synchronisé/);
  const choisi = await app.synchro.apercu(p, { source: 'notion', config: { base: `source:${court(base.tableaux[1] as string)}`, jeton: JETON }, typeObjet: 'entreprise' });
  assert.deepEqual([choisi.enregistrements, choisi.precision], [1, null]);
  versionPartout(sim.appels);
});

test('Notion dans le jeu, « Se connecter avec Notion » : tableau choisi dans la liste, puis synchronisé ; un ancien réglage reste lu et précisé', async () => {
  const RELAIS = 'http://127.0.0.1:4180';
  const attente = 'A'.repeat(20) + 'b'.repeat(23);
  const sim = notionSimule();
  const base = sim.base('Suivi commercial', [{ nom: 'Commandes', cree: '2024-02-01T00:00:00.000Z', schema: { Nom: 'title' }, lignes: [{ Nom: 'C-1' }] }, { nom: 'Contacts', cree: '2026-09-01T00:00:00.000Z', schema: { Nom: 'title' }, lignes: [{ Nom: 'Anna' }, { Nom: 'Erwan' }] }]);
  const f = (async (url: URL | string, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.origin !== RELAIS) return sim.f(url, init);
    switch (u.pathname) {
      case '/v0/oauth/fournisseurs': return json({ fournisseurs: [{ id: 'notion', nom: 'notion', parametre: null }] });
      case '/v0/oauth/demarrer': return json({ url: 'https://api.notion.com/v1/oauth/authorize?client_id=n&state=s1', attente, expire: new Date(Date.now() + 600_000).toISOString() });
      case '/v0/oauth/retrait': return json({ statut: 'connecte', fournisseur: 'notion', jetons: { acces: JETON, rafraichissement: null, expire: null, portee: null, extra: { workspace_name: 'Kerlann', bot_id: 'b' } } });
    }
    return json({ erreur: 'introuvable' }, 404);
  }) as typeof fetch;
  const { app, p } = await monter(f);
  await app.nexus.reglerAdresse(RELAIS);
  const connecter = async () => {
    const d = await app.synchro.demarrerOAuth(p, { source: 'notion', config: {}, droits: 'lecture' });
    const r = await app.synchro.suivreOAuth(p, d.id);
    assert.equal(r.statut, 'connecte');
    return (r as { jeton: string }).jeton;
  };
  let jeton = await connecter();
  const { options } = await app.synchro.choix(p, { source: 'notion', champ: 'base', config: { jeton } });
  assert.deepEqual(options.map((o) => o.libelle), ['Suivi commercial — tableau « Commandes »', 'Suivi commercial — tableau « Contacts »']);
  const c = app.synchro.creer(p, { source: 'notion', config: { base: options[1]?.valeur, jeton }, typeObjet: 'entreprise', roles: [], mapping: { Nom: '__nom' }, sens: 'lecture', intervalleS: 300, actif: false });
  assert.equal(c.config.base, `source:${court(base.tableaux[1] as string)}`);
  const vue = await app.synchro.synchroniser(c.id, p);
  assert.deepEqual([vue.statut, vue.liens, vue.historique[0]?.detail], ['ok', 2, '2 lu(s)']);
  // connexion par le relais et réglage d'avant (identifiant de la base) : lu, et le tableau retenu est dit
  jeton = await connecter();
  const ancien = app.synchro.creer(p, { source: 'notion', config: { base: court(base.id), jeton }, typeObjet: 'entreprise', roles: [], mapping: { Nom: '__nom' }, sens: 'lecture', intervalleS: 300, actif: false });
  const vueAncien = await app.synchro.synchroniser(ancien.id, p);
  assert.equal(vueAncien.statut, 'ok');
  assert.match(vueAncien.historique[0]?.detail ?? '', /^1 lu\(s\) · Base Notion à 2 tableaux : seul « Commandes » \(le plus ancien\)/);
  versionPartout(sim.appels);
});

// ---------------------------------------------------------------- refus de Notion, dits en français

test('Notion : base non partagée avec l’intégration, tableau ou fiche disparus → 404 expliqué', async () => {
  const sim = notionSimule();
  const base = sim.base('Clients', [{ nom: 'Clients', lignes: [{ Nom: 'Cave du Port' }] }]);
  const tableau = sim.tableaux.get(base.tableaux[0] as string) as Tableau;
  const page = tableau.pages[0] as string;
  const choisi = { base: `source:${court(tableau.id)}` };
  await notion.lire(choisi, JETON, sim.f); // types connus : la mise à jour ci-dessous ne relit rien
  base.partagee = false;
  await assert.rejects(notion.lire({ base: court(base.id) }, JETON, sim.f), refus(/ne trouve pas cette base de données : elle n’est pas partagée avec l’intégration.*Connexions → ajoutez l’intégration/, 404));
  await assert.rejects(notion.lire(choisi, JETON, sim.f), refus(/ne trouve pas ce tableau : sa base de données n’est plus partagée/, 404));
  await assert.rejects(async () => notion.ecrire?.(choisi, JETON, page, { Nom: 'x' }, sim.f), refus(/ne trouve pas cette fiche : elle a été supprimée dans Notion, ou sa base de données n’est plus partagée/, 404));
  await assert.rejects(notion.lire({ base: court(uuid()) }, JETON, sim.f), refus(/ne trouve pas cette base de données/, 404));
  // dans le jeu : le branchement passe en erreur avec ce message
  const { app, p } = await monter(sim.f);
  const c = app.synchro.creer(p, { source: 'notion', config: { base: court(base.id), jeton: JETON }, typeObjet: 'entreprise', roles: [], mapping: { Nom: '__nom' }, sens: 'lecture', intervalleS: 300, actif: false });
  const vue = await app.synchro.synchroniser(c.id, p);
  assert.equal(vue.statut, 'erreur');
  assert.match(vue.message ?? '', /n’est pas partagée avec l’intégration/);
});

test('Notion : capacité manquante (lire, mettre à jour, insérer) → 403 qui nomme la capacité', async () => {
  const sim = notionSimule();
  const base = sim.base('Clients', [{ nom: 'Clients', lignes: [{ Nom: 'Cave du Port' }] }]);
  const tableau = sim.tableaux.get(base.tableaux[0] as string) as Tableau;
  const cfg = { base: `source:${court(tableau.id)}` };
  await notion.lire(cfg, JETON, sim.f);
  sim.capacites = { lire: false, modifier: false, inserer: false };
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/Accès refusé par Notion : l’intégration n’a pas le droit de lire le contenu.*Capacités : cochez « Lire le contenu »/, 403));
  await assert.rejects(notion.lire({ base: court(base.id) }, JETON, sim.f), refus(/« Lire le contenu »/, 403));
  await assert.rejects(async () => notion.choix?.('base', {}, JETON, sim.f), refus(/« Lire le contenu »/, 403));
  await assert.rejects(async () => notion.ecrire?.(cfg, JETON, tableau.pages[0] as string, { Nom: 'x' }, sim.f), refus(/n’a pas le droit de modifier les fiches.*« Mettre à jour le contenu »/, 403));
  await assert.rejects(async () => notion.ecrire?.(cfg, JETON, null, { Nom: 'x' }, sim.f), refus(/n’a pas le droit de créer des fiches.*« Insérer du contenu »/, 403));
  // même code 403 quand un espace gratuit n'a plus de blocs : distingué par additional_data.block_limit
  sim.capacites = { lire: true, modifier: true, inserer: true };
  sim.imposees.push(erreur(403, 'restricted_resource', 'This workspace has used all of its free blocks. Upgrade its plan in Notion to create more content.', { block_limit: 'block_creation' }));
  await assert.rejects(async () => notion.ecrire?.(cfg, JETON, null, { Nom: 'x' }, sim.f), refus(/espace de travail gratuit a utilisé tous ses blocs/, 403));
});

test('Notion : base ou tableau à la corbeille (in_trash) → dit, rien n’est lu ni écrit', async () => {
  const sim = notionSimule();
  const base = sim.base('Archives', [{ nom: 'Archives', lignes: [{ Nom: 'x' }] }]);
  const tableau = sim.tableaux.get(base.tableaux[0] as string) as Tableau;
  base.corbeille = true;
  await assert.rejects(notion.lire({ base: court(base.id) }, JETON, sim.f), refus(/Cette base de données Notion est dans la corbeille : restaurez-la/, null));
  assert.equal(sim.appels.some((a) => a.url.pathname.endsWith('/query')), false);
  base.corbeille = false;
  tableau.corbeille = true;
  await assert.rejects(async () => notion.ecrire?.({ base: `source:${court(tableau.id)}` }, JETON, null, { Nom: 'y' }, sim.f), refus(/Ce tableau Notion est dans la corbeille : restaurez-le/, null));
  assert.equal(sim.appels.some((a) => a.url.pathname === '/v1/pages'), false);
  // refus d'écrire dans une fiche archivée ou à la corbeille : texte de Notion non documenté, reconnu au mieux
  tableau.corbeille = false;
  const cfg = { base: `source:${court(tableau.id)}` };
  await notion.lire(cfg, JETON, sim.f);
  sim.imposees.push(erreur(400, 'validation_error', 'Can\'t edit block that is archived. You must unarchive the block before editing.'));
  await assert.rejects(async () => notion.ecrire?.(cfg, JETON, tableau.pages[0] as string, { Nom: 'z' }, sim.f), refus(/Cette fiche est dans la corbeille de Notion \(ou archivée\)/, 400));
});

test('Notion : débit limité (429) → attente courte respectée puis nouvel essai ; attente longue ou accès restreint → message, sans insister', async () => {
  const sim = notionSimule();
  const base = sim.base('Clients', [{ nom: 'Clients', lignes: [{ Nom: 'Cave du Port' }] }]);
  const cfg = { base: `source:${court(base.tableaux[0] as string)}` };
  const limite = (attente: string | null, raison = 'public_api_endpoint_rate_limit') => erreur(429, 'rate_limited', 'You have been rate limited. Please try again later.', { rate_limit_reason: raison, ...(attente === null ? {} : { retry_after: attente }) }, attente === null ? {} : { 'retry-after': attente });
  // attente courte donnée par Retry-After : la requête repart, la lecture aboutit
  sim.imposees.push(limite('0'), limite('0'));
  assert.equal((await notion.lire(cfg, JETON, sim.f)).length, 1);
  assert.equal(sim.appels.length, 3, 'deux refus puis la lecture');
  // … deux nouveaux essais au plus
  sim.appels.length = 0;
  sim.imposees.push(limite('0'), limite('0'), limite('0'));
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/Trop de requêtes : Notion limite le débit, nouvel essai à la prochaine synchronisation \(pas avant 0 s\)/, 429));
  assert.equal(sim.appels.length, 3);
  // attente longue : pas d'attente ici, le message dit quand réessayer
  sim.appels.length = 0;
  sim.imposees.push(limite('42', 'public_api_space_request_rate_limit'));
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/limite le débit de tout l’espace de travail \(quota partagé entre ses intégrations\), nouvel essai à la prochaine synchronisation \(pas avant 42 s\)/, 429));
  assert.equal(sim.appels.length, 1);
  // l'attente n'est lue que dans le corps quand l'en-tête manque
  sim.imposees.push(new Response(JSON.stringify({ object: 'error', status: 429, code: 'rate_limited', message: 'x', additional_data: { retry_after: '17' } }), { status: 429 }));
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/pas avant 17 s/, 429));
  // accès restreint par Notion : réessayer ne sert à rien
  sim.appels.length = 0;
  sim.imposees.push(limite('0', 'public_api_request_blocked'));
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/Notion a restreint l’accès de cette intégration/, 429));
  assert.equal(sim.appels.length, 1);
});

test('Notion : jeton refusé, valeurs refusées, panne, création enregistrée malgré un 503, identifiant mal saisi', async () => {
  const sim = notionSimule();
  const base = sim.base('Clients', [{ nom: 'Clients', schema: { Nom: 'title', Statut: 'select' }, lignes: [{ Nom: 'Cave du Port' }] }]);
  const tableau = sim.tableaux.get(base.tableaux[0] as string) as Tableau;
  const cfg = { base: `source:${court(tableau.id)}` };
  // 401 : le statut est gardé (le jeu s'en sert pour renouveler une connexion), le message reste « Accès refusé »
  await assert.rejects(notion.lire(cfg, 'autre-jeton', sim.f), refus(/Accès refusé par Notion : la connexion n’est plus valable/, 401));
  await assert.rejects(notion.lire(cfg, null, sim.f), (e: unknown) => e instanceof ErreurReglage && e.champ === 'jeton');
  // valeurs refusées : ce que dit Notion est montré
  await notion.lire(cfg, JETON, sim.f);
  sim.imposees.push(erreur(400, 'validation_error', 'Statut is expected to be select.\u0007'));
  await assert.rejects(async () => notion.ecrire?.(cfg, JETON, null, { Nom: 'x', Statut: 'Client' }, sim.f), refus(/^Notion refuse la requête : « Statut is expected to be select\. »\.$/, 400));
  // panne : nouvel essai plus tard ; conflit : idem ; réponse qui n'est pas une erreur de Notion : message générique du jeu
  sim.imposees.push(erreur(500, 'internal_server_error', 'Unexpected error occurred.'), erreur(409, 'conflict_error', 'Conflict occurred while saving. Please try again.'), new Response('<html>502</html>', { status: 502 }));
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/Notion est momentanément indisponible \(erreur 500\) : nouvel essai à la prochaine synchronisation/, 500));
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/conflit d’enregistrement/, 409));
  await assert.rejects(notion.lire(cfg, JETON, sim.f), refus(/^Erreur du service \(502\)\.$/, 502));
  // 503 alors que la page a été créée : Notion donne son identifiant, pris tel quel (la recréer ferait un doublon)
  const creee = uuid();
  sim.imposees.push(erreur(503, 'service_unavailable', 'The change was saved, but the response could not be built in time.', { committed_resource_id: creee, retry_guidance: ['Read the object again to confirm the saved change.', 'Do not repeat the write.'] }));
  assert.equal(await notion.ecrire?.(cfg, JETON, null, { Nom: 'Déjà créée' }, sim.f), creee);
  sim.imposees.push(erreur(503, 'service_unavailable', 'Notion is unavailable, please try again later.'));
  await assert.rejects(async () => notion.ecrire?.(cfg, JETON, null, { Nom: 'Pas créée' }, sim.f), refus(/momentanément indisponible \(erreur 503\)/, 503));
  // réglage mal saisi : refusé avant tout appel, et le champ est nommé
  sim.appels.length = 0;
  for (const mauvais of ['', 'clients', 'source:1234', `source:${'g'.repeat(32)}`, `${court(base.id)}0000`]) {
    await assert.rejects(notion.lire({ base: mauvais }, JETON, sim.f), (e: unknown) => e instanceof ErreurSortante && /Identifiant de base de données Notion invalide/.test(e.message), mauvais);
  }
  await assert.rejects(notion.lire({ base: 'clients' }, JETON, sim.f), (e: unknown) => e instanceof ErreurReglage && e.champ === 'base');
  assert.equal(sim.appels.length, 0);
});

test('Notion : textes de l’assistant (français, base à plusieurs tableaux expliquée)', () => {
  assert.equal(notion.etapes.length, 4);
  assert.match(notion.etapes[3] ?? '', /plusieurs tableaux .*le plus ancien est lu.*« source: »/);
  const base = notion.champs.find((ch) => ch.id === 'base');
  assert.ok(base?.liste && base.obligatoire);
  assert.match(base.aide, /Une base à plusieurs tableaux y figure une fois par tableau/);
});
