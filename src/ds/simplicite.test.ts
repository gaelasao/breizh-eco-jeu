/**
 * Simplicité : le menu grandit avec l'entreprise (web/simplicite.js, module pur, et ses garde-fous dans web/app.js).
 * - règles de déblocage, une par une, sur ce que l'entreprise a réellement (jamais sur des points) ;
 * - rien n'est pris en otage : « Tout afficher », rubrique courante, rubrique où quelque chose est dû, droits inchangés ;
 * - « Tout afficher » et les notes lues sont gardés par personne ;
 * - la démonstration et une entreprise déjà en place retrouvent tout ce que leurs données débloquent ;
 * - garde-fou : chaque entrée du menu a sa règle et sa note.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { Application } from '../passerelle/application.ts';
import { creerServeur } from '../passerelle/http.ts';

type Entree = { id: string; vue?: string; vues?: string[]; prefixes?: string[]; libelle: string; icone: string; compte?: number; action?: string };
type Groupe = { id: string; libelle: string; entrees: Entree[] };
type Deblocages = Record<string, boolean>;
type Preferences = { tout: boolean; vues: string[] | null };
type Rubrique = { id: string; regle: string; debloque: (f: Record<string, number | boolean>) => boolean; sert: string; premier: string; manque: string };
type Stockage = { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void };
type Simple = {
  RUBRIQUES: Record<string, Rubrique>;
  faits: (m: unknown) => Record<string, number | boolean>;
  deblocages: (m: unknown) => Deblocages;
  menuAffiche: (g: Groupe[], d: Deblocages, o?: { tout?: boolean; vue?: string | null }) => Groupe[];
  entreesAffichees: (e: Entree[], d: Deblocages, o?: { tout?: boolean; vue?: string | null }) => Entree[];
  entreesEnAttente: (g: Groupe[], p: Entree[], d: Deblocages) => Entree[];
  vientDeSOuvrir: (avant: Deblocages | null, apres: Deblocages) => string[];
  cleSimplicite: (profilId: unknown) => string;
  lirePreferences: (s: Stockage | null, profilId: unknown) => Preferences;
  ecrirePreferences: (s: Stockage, profilId: unknown, p: Partial<Preferences>) => boolean;
  repereDeDepart: (d: Deblocages) => string[];
  nouvelles: (d: Deblocages, p: Preferences | null) => string[];
  texteNote: (id: string) => string;
  texteVide: (id: string | null) => { titre: string; texte: string } | null;
  enumerer: (noms: string[]) => string;
};
type Nav = { groupesNavigation: (m: unknown, o?: { aFaire?: number }) => Groupe[]; piedNavigation: (m: unknown) => Entree[]; placeDeVue: (g: Groupe[], v: string) => { entree: Entree } | null };

const S = (await import(new URL('../../web/simplicite.js', import.meta.url).href)) as Simple;
const N = (await import(new URL('../../web/navigation.js', import.meta.url).href)) as Nav;
const { typo } = (await import(new URL('../../web/bz/typo.js', import.meta.url).href)) as { typo: (t: string) => string };
const lire = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');

const TOUJOURS = ['aujourdhui', 'connecter', 'reglages'];
const ouvertes = (d: Deblocages) => Object.keys(d).filter((id) => d[id]).sort();
const ids = (g: Groupe[]) => g.flatMap((x) => x.entrees.map((e) => e.id));

/** Une entreprise qui vient d'être créée, comme /api/v1/monde la renvoie : son nom, et rien d'autre. */
function monde(plus: Record<string, unknown> = {}, objets: unknown[] = []) {
  return {
    organisation: { nom: 'Kerlann Bois', demo: false, departements: 0 },
    profil: { id: 'proprietaire', nom: 'Maïwenn Le Goff', peutAdministrer: true, peutPreparer: true, peutApprouver: true },
    univers: { roles: [{ id: 'client', pluriel: 'Clients' }, { id: 'fournisseur', pluriel: 'Fournisseurs' }], types: [{ id: 'employe', famille: 'personne', pluriel: 'Équipe' }] },
    objets: [{ id: 'org', famille: 'organisation', type: 'mon_entreprise', roles: [], champs: [] }, ...objets],
    situations: [], quetes: [], actionsEnAttente: [],
    progression: { xp: 0, niveau: { n: 1 }, reussites: [] },
    planning: { trousAujourdhui: 0, trous: 0 },
    // comme la passerelle : sans donnée, quelques critères (sauvegardes…) sont mesurés, mais aucun score n'est donné
    sante: { score: null, couverture: 0.08 },
    optimisations: { heuresMois: 1, euroMois: 35, pistes: 1 },
    satisfaction: { clients: {}, global: { moyenne: null }, barometre: { reponses: 0, invites: 0 } },
    synchro: { actifs: 0 },
    pavillon: { apparence: 'endormi' },
    ...plus,
  };
}
const tiers = (id: string, role: string) => ({ id, famille: 'tiers', type: 'entreprise', roles: [{ id: role, libelle: role }], champs: [] });
const objet = (id: string, famille: string, type: string) => ({ id, famille, type, roles: [], champs: [] });

test('premier jour : une entreprise vide ne montre qu’Aujourd’hui, Connecter mes données et Réglages', () => {
  const m = monde();
  const d = S.deblocages(m);
  assert.deepEqual(ouvertes(d), [...TOUJOURS].sort());
  const groupes = N.groupesNavigation(m);
  assert.ok(ids(groupes).length >= 13, 'la navigation complète (les droits) reste entière');
  const menu = S.menuAffiche(groupes, d);
  assert.deepEqual(menu.map((g) => g.id), ['aujourdhui'], 'un groupe sans rubrique à montrer disparaît');
  assert.deepEqual(ids(menu), ['aujourdhui']);
  assert.deepEqual(S.entreesAffichees(N.piedNavigation(m), d).map((e) => e.id), ['connecter', 'reglages']);
  assert.equal(S.entreesEnAttente(groupes, N.piedNavigation(m), d).length, ids(groupes).length - 1, '« Tout afficher » a de quoi montrer');
});

test('règles de déblocage, une par une : chaque donnée ouvre ses rubriques, et seulement celles-là', () => {
  const cas: Array<[string, unknown, string[]]> = [
    ['un client', monde({ satisfaction: { clients: { c1: { statut: 'inconnue' } } } }, [tiers('c1', 'client')]), ['clients', 'satisfaction', 'nexus']],
    ['un fournisseur', monde({}, [tiers('f1', 'fournisseur')]), ['fournisseurs', 'nexus']],
    ['un prospect', monde({}, [tiers('p1', 'prospect')]), ['pipeline']],
    ['un partenaire', monde({}, [tiers('x1', 'partenaire')]), []],
    ['une personne de l’équipe', monde({}, [objet('e1', 'personne', 'employe')]), ['planning', 'equipe', 'optimiser', 'satisfaction']],
    ['un lieu', monde({}, [objet('l1', 'lieu', 'atelier')]), ['lieux']],
    ['une facture', monde({}, [objet('fa1', 'commande', 'facture')]), ['commandes', 'optimiser', 'pipeline', 'nexus']],
    ['une commande à un fournisseur', monde({}, [objet('cf1', 'commande', 'commande_fournisseur')]), ['commandes', 'optimiser', 'nexus']],
    ['un article en stock', monde({}, [objet('a1', 'ressource', 'article')]), ['stock', 'optimiser', 'nexus']],
    ['un document', monde({}, [objet('d1', 'evenement', 'document')]), ['documents', 'optimiser']],
    ['un courrier', monde({}, [objet('m1', 'evenement', 'courrier')]), ['courrier', 'optimiser']],
    ['une tâche', monde({}, [objet('t1', 'tache', 'tache')]), ['optimiser', 'taches']],
    ['un département', monde({ organisation: { nom: 'K', demo: false, departements: 1 } }, [objet('dep1', 'departement', 'departement')]), ['departements']],
    ['un score de santé calculable', monde({ sante: { score: 47, couverture: 0.22 } }), ['sante']],
    ['un logiciel connecté qui n’a encore rien apporté', monde({ synchro: { actifs: 1 } }), []],
    ['l’entreprise reliée au réseau', monde({ pavillon: { apparence: 'gratuit' } }), ['nexus']],
    ['un baromètre d’équipe lancé', monde({ satisfaction: { clients: {}, barometre: { reponses: 0, invites: 4 } } }), ['satisfaction']],
    ['une première quête', monde({ quetes: [{ id: 'q', statut: 'ouverte', origine: { regle: 'stock_minimum', objetId: 'a1' } }] }), ['progression']],
  ];
  for (const [nom, m, attendu] of cas) {
    assert.deepEqual(ouvertes(S.deblocages(m)), [...TOUJOURS, ...attendu].sort(), nom);
  }
  // sans le résumé de satisfaction (profil restreint) : le premier client visible suffit
  assert.equal(S.deblocages(monde({ satisfaction: null }, [tiers('c1', 'client')])).satisfaction, true);
  // un score à zéro est un score ; une couverture sans score n'en est pas un
  assert.equal(S.deblocages(monde({ sante: { score: 0, couverture: 0.3 } })).sante, true);
  assert.equal(S.deblocages(monde({ sante: { score: null, couverture: 0.19 } })).sante, false);
  assert.equal(S.deblocages(monde({ sante: null })).sante, false);
  // monde abîmé ou absent : le menu du premier jour, jamais une erreur
  assert.deepEqual(ouvertes(S.deblocages(null)), [...TOUJOURS].sort());
  assert.deepEqual(ouvertes(S.deblocages({})), [...TOUJOURS].sort());
});

test('ce sont les faits qui ouvrent le menu, jamais des points : l’XP et le niveau du port n’ouvrent aucune fonction', () => {
  const riche = monde({ progression: { xp: 3200, niveau: { n: 10 }, reussites: [{ id: 'r1' }] } });
  assert.deepEqual(ouvertes(S.deblocages(riche)), [...TOUJOURS, 'progression'].sort(), 'seule la page du jeu suit les réussites');
  for (const r of Object.values(S.RUBRIQUES)) assert.doesNotMatch(String(r.debloque), /xp|niveau|trophee/i, `${r.id} : aucune règle ne lit les points`);
  // même monde, même réponse ; les données ne sont pas modifiées
  const m = monde({}, [tiers('c1', 'client')]);
  const copie = JSON.stringify(m);
  assert.deepEqual(S.deblocages(m), S.deblocages(m));
  assert.equal(JSON.stringify(m), copie);
});

test('rien n’est pris en otage : « Tout afficher », rubrique courante, action due, entrée sans règle', () => {
  const m = monde();
  const d = S.deblocages(m);
  const groupes = N.groupesNavigation(m);
  const pied = N.piedNavigation(m);
  assert.equal(S.menuAffiche(groupes, d, { tout: true }), groupes, '« Tout afficher » : le menu complet, tel que les droits le donnent');
  assert.equal(S.entreesAffichees(pied, d, { tout: true }), pied);
  // lien direct, recherche, raccourci : la rubrique où l'on se trouve est dans le menu, à sa place
  assert.deepEqual(ids(S.menuAffiche(groupes, d, { vue: 'famille:ressource' })), ['aujourdhui', 'stock']);
  assert.deepEqual(ids(S.menuAffiche(groupes, d, { vue: 'courrier' })), ['aujourdhui', 'courrier']);
  assert.deepEqual(ids(S.menuAffiche(groupes, d, { vue: 'compte' })), ['aujourdhui'], 'une vue hors menu ne débloque rien');
  // une rubrique où quelque chose est dû s'affiche toujours (compteur d'actions)
  const avecDu = N.groupesNavigation(monde({ planning: { trousAujourdhui: 2, trous: 2 } }));
  assert.deepEqual(ids(S.menuAffiche(avecDu, d)), ['aujourdhui', 'planning']);
  // une entrée qui n'aurait pas de règle n'est jamais retirée (le garde-fou plus bas interdit ce cas)
  const inconnue: Groupe[] = [{ id: 'x', libelle: 'X', entrees: [{ id: 'nouvelle-entree', vue: 'x', libelle: 'X', icone: 'circle' }] }];
  assert.deepEqual(ids(S.menuAffiche(inconnue, d)), ['nouvelle-entree']);
  assert.deepEqual(S.entreesEnAttente(inconnue, [], d), []);
});

test('droits et profils inchangés : la simplicité ne rend jamais ce que les droits retirent', () => {
  const tout = monde({ sante: { score: 60, couverture: 0.8 }, organisation: { nom: 'K', demo: false, departements: 3 } },
    [tiers('c1', 'client'), tiers('f1', 'fournisseur'), objet('e1', 'personne', 'employe'), objet('l1', 'lieu', 'siege'), objet('fa1', 'commande', 'facture'), objet('a1', 'ressource', 'article'), objet('d1', 'evenement', 'document'), objet('m1', 'evenement', 'courrier'), objet('t1', 'tache', 'tache')]);
  const terrain = { ...tout, profil: { id: 'terrain', nom: 'Yann', peutAdministrer: false, peutPreparer: false, peutApprouver: false }, sante: null, optimisations: null };
  const d = S.deblocages(terrain);
  const droits = N.groupesNavigation(terrain);
  for (const o of [{}, { tout: true }, { vue: 'sante' }, { vue: 'optimiser' }, { vue: 'reglages' }, { vue: 'nexus' }]) {
    const montre = ids(S.menuAffiche(droits, d, o));
    assert.ok(montre.every((id) => ids(droits).includes(id)), 'le menu montré est toujours une partie de la navigation permise');
    for (const interdit of ['sante', 'optimiser', 'nexus']) assert.ok(!montre.includes(interdit), `${interdit} reste interdit (${JSON.stringify(o)})`);
  }
  assert.deepEqual(S.entreesAffichees(N.piedNavigation(terrain), d, { tout: true }), [], 'Connecter et Réglages : administrateurs seulement, même avec « Tout afficher »');
  // un administrateur dont toutes les rubriques ont des données retrouve la navigation entière, sans « Tout afficher »
  const dTout = S.deblocages(tout);
  assert.deepEqual(ids(S.menuAffiche(N.groupesNavigation(tout), dTout)), ids(N.groupesNavigation(tout)), 'aucune régression pour une entreprise en place');
  assert.deepEqual(S.entreesEnAttente(N.groupesNavigation(tout), N.piedNavigation(tout), dTout), [], 'plus rien en attente : l’interrupteur n’a plus lieu d’être');
  // web/navigation.js (les droits d'affichage) ne lit pas les règles de simplicité
  assert.doesNotMatch(lire('web/navigation.js'), /simplicite|deblo/i);
});

test('« Tout afficher » : choix gardé par personne, sur l’appareil ; valeurs abîmées et stockage refusé tolérés', () => {
  const boite = new Map<string, string>();
  const stockage: Stockage = { getItem: (k) => boite.get(k) ?? null, setItem: (k, v) => { boite.set(k, v); } };
  assert.deepEqual(S.lirePreferences(stockage, 'proprietaire'), { tout: false, vues: null }, 'par défaut : le menu simple');
  assert.equal(S.ecrirePreferences(stockage, 'proprietaire', { tout: true, vues: ['aujourdhui', 'clients'] }), true);
  assert.deepEqual(S.lirePreferences(stockage, 'proprietaire'), { tout: true, vues: ['aujourdhui', 'clients'] }, 'relu tel quel à l’ouverture suivante');
  assert.deepEqual(S.lirePreferences(stockage, 'yann'), { tout: false, vues: null }, 'une autre personne sur le même poste garde son menu');
  S.ecrirePreferences(stockage, 'yann', { tout: false, vues: [] });
  assert.equal(S.lirePreferences(stockage, 'proprietaire').tout, true);
  assert.deepEqual([...boite.keys()].sort(), ['lb-simplicite:proprietaire', 'lb-simplicite:yann']);
  S.ecrirePreferences(stockage, 'proprietaire', { tout: false, vues: ['aujourdhui'] });
  assert.equal(S.lirePreferences(stockage, 'proprietaire').tout, false, 'revenir au menu simple se garde aussi');
  // clé sûre quel que soit l'identifiant
  assert.equal(S.cleSimplicite('p-1a2b3c4d'), 'lb-simplicite:p-1a2b3c4d');
  assert.equal(S.cleSimplicite('a b/../c'), 'lb-simplicite:abc');
  assert.equal(S.cleSimplicite(null), 'lb-simplicite:defaut');
  // valeurs abîmées : menu simple, rubriques inconnues ou en double écartées
  for (const brut of ['', 'null', '[]', '{"tout":"oui"}', '{pas du json', '42']) {
    boite.set('lb-simplicite:x', brut);
    assert.deepEqual(S.lirePreferences(stockage, 'x'), { tout: false, vues: null }, brut);
  }
  boite.set('lb-simplicite:x', JSON.stringify({ tout: true, vues: ['clients', 'clients', 'inconnue', 7, 'stock'] }));
  assert.deepEqual(S.lirePreferences(stockage, 'x'), { tout: true, vues: ['clients', 'stock'] });
  // navigation privée : lecture et écriture refusées, sans erreur
  const refus: Stockage = { getItem: () => { throw new Error('refusé'); }, setItem: () => { throw new Error('refusé'); } };
  assert.deepEqual(S.lirePreferences(refus, 'x'), { tout: false, vues: null });
  assert.equal(S.ecrirePreferences(refus, 'x', { tout: true }), false);
  assert.deepEqual(S.lirePreferences(null, 'x'), { tout: false, vues: null });
});

test('notes : ce qui est déjà là au départ est connu ; une rubrique qui apparaît est nouvelle jusqu’à « J’ai compris »', () => {
  const jour1 = S.deblocages(monde());
  const repere = S.repereDeDepart(jour1);
  assert.deepEqual([...repere].sort(), [...TOUJOURS].sort());
  let prefs: Preferences = { tout: false, vues: repere };
  assert.deepEqual(S.nouvelles(jour1, prefs), [], 'jamais de note au démarrage');
  const avecClient = S.deblocages(monde({ satisfaction: { clients: { c1: {} } } }, [tiers('c1', 'client')]));
  assert.deepEqual(S.vientDeSOuvrir(jour1, avecClient), ['clients', 'satisfaction', 'nexus']);
  assert.deepEqual(S.vientDeSOuvrir(null, avecClient), [], 'première lecture : rien n’est annoncé');
  assert.deepEqual(S.vientDeSOuvrir(avecClient, avecClient), []);
  assert.deepEqual(S.vientDeSOuvrir(avecClient, jour1), [], 'une rubrique qui se referme ne s’annonce pas');
  assert.deepEqual(S.nouvelles(avecClient, prefs), ['clients', 'satisfaction', 'nexus']);
  prefs = { ...prefs, vues: [...(prefs.vues ?? []), 'clients'] };
  assert.deepEqual(S.nouvelles(avecClient, prefs), ['satisfaction', 'nexus'], 'une note rangée ne revient pas');
  assert.deepEqual(S.nouvelles(avecClient, { tout: false, vues: null }), [], 'sans repère de départ : aucune note');
  assert.deepEqual(S.nouvelles(avecClient, null), []);
  // une entreprise déjà en place : tout ce qu'elle a est connu d'emblée, aucune note sur ce qu'elle utilise
  assert.deepEqual(S.nouvelles(avecClient, { tout: false, vues: S.repereDeDepart(avecClient) }), []);
  // textes
  assert.equal(S.texteNote('clients'), 'Vos clients, avec ce qu’ils vous doivent, leurs retards et leur avis. Pour commencer, ouvrez une fiche : tout ce qui concerne ce client y est réuni.');
  assert.deepEqual(S.texteVide('clients'), { titre: 'Aucun client pour le moment.', texte: 'Ici : vos clients, avec ce qu’ils vous doivent, leurs retards et leur avis.' });
  assert.equal(S.texteVide('inconnue'), null);
  assert.equal(S.texteVide(null), null);
  assert.equal(S.texteNote('inconnue'), '');
  assert.equal(S.enumerer(['Clients']), 'Clients');
  assert.equal(S.enumerer(['Clients', 'Stock']), 'Clients et Stock');
  assert.equal(S.enumerer(['Clients', 'Stock', 'Commandes']), 'Clients, Stock et Commandes');
  assert.equal(S.enumerer([]), '');
});

test('garde-fou : chaque entrée du menu a sa règle de déblocage et sa note, écrites en clair', () => {
  // toutes les entrées déclarées dans web/navigation.js, y compris celles qui dépendent d'une condition
  const source = lire('web/navigation.js');
  const declarees = [...source.matchAll(/\{ id: '([a-z-]+)', (?:vue|action): /g)].map((x) => x[1] as string);
  assert.ok(declarees.length >= 17, `entrées lues dans la source : ${declarees.join(', ')}`);
  const complet = monde({ sante: { score: 50, couverture: 0.8 }, organisation: { nom: 'K', demo: false, departements: 2 } });
  const rendues = [...ids(N.groupesNavigation(complet)), ...N.piedNavigation(complet).map((e) => e.id)];
  assert.deepEqual([...new Set(declarees)].sort(), [...rendues].sort(), 'la source et le menu rendu donnent les mêmes entrées');
  for (const id of new Set([...declarees, ...rendues, 'pipeline', 'progression'])) {
    const r = S.RUBRIQUES[id];
    assert.ok(r, `${id} : une rubrique du menu sans règle de déblocage (web/simplicite.js)`);
    assert.equal(r.id, id);
    assert.equal(typeof r.debloque, 'function', `${id} : règle calculable`);
    assert.equal(typeof r.debloque(S.faits(monde())), 'boolean');
    assert.match(r.regle, /^(Apparaît dès|Toujours affichée)[^.]*\.$/u, `${id} : règle en une phrase`);
    assert.match(r.sert, /^\p{Lu}.{20,}\.$/u, `${id} : à quoi sert la rubrique`);
    assert.match(r.premier, /^\p{Ll}.{15,}\.$/u, `${id} : par quoi commencer (suit « Pour commencer, »)`);
    assert.match(r.manque, /^\p{Lu}.{8,}\.$/u, `${id} : ce qui manque, avec un point`);
    assert.ok(S.texteNote(id).includes(' Pour commencer, '), id);
    assert.match(S.texteVide(id)?.texte ?? '', /^Ici : \p{Ll}/u, id);
    for (const t of [r.regle, r.sert, r.premier, r.manque]) {
      assert.ok(t.length <= 150, `${id} : texte court (${t.length} caractères)`);
      assert.doesNotMatch(t, /\(s\)|'|\.\.\./, `${id} : typographie française (apostrophe ’, pas de « (s) »)`);
      assert.doesNotMatch(t, /nexus|OAuth|\bAPI\b|webhook|\bMCP\b|mapping|pipeline|scoring|dashboard|workflow|\bKPI\b|\bCRM\b|\bERP\b|\bNPS\b|synchronis|débloqu|verrou/i, `${id} : sans jargon ni nom interdit`);
      assert.equal(typo(typo(t)), typo(t), `${id} : typographie stable`);
    }
  }
  assert.ok(Object.isFrozen(S.RUBRIQUES) && Object.values(S.RUBRIQUES).every((r) => Object.isFrozen(r)));
  // aucune rubrique en trop : chaque règle correspond à une entrée du menu, ou à une vue annoncée
  assert.deepEqual(Object.keys(S.RUBRIQUES).sort(), [...new Set([...declarees, 'pipeline', 'progression'])].sort());
  // les rubriques toujours affichées sont celles du premier jour, pas une de plus
  assert.deepEqual(Object.values(S.RUBRIQUES).filter((r) => r.regle.startsWith('Toujours')).map((r) => r.id).sort(), [...TOUJOURS].sort());
});

test('garde-fou de l’interface : une seule source de règles, droits inchangés, « Tout afficher » au même endroit', () => {
  const app = lire('web/app.js');
  assert.match(app, /import \* as SIMPLE from '\/simplicite\.js';/);
  assert.doesNotMatch(app, /debloque\s*[:(]/, 'aucune règle de déblocage écrite dans app.js : elles sont dans web/simplicite.js');
  // le rail, les onglets du téléphone et la sous-navigation dessinent le menu simple…
  assert.match(app, /h\('ul', \{ class: 'bz-rail__groupes', role: 'list' \}, menuMontre\(\)\.map/);
  assert.match(app, /ongletsTelephone\(menuMontre\(\), E\.vue/);
  assert.match(app, /const ici = placeDeVue\(menuMontre\(\), E\.vue\);/);
  // … mais ce qui décide des droits lit toujours la navigation complète : liens directs, raccourcis, recherche
  const autorisee = app.slice(app.indexOf('function vueAutorisee(v)'), app.indexOf('function objetsDeVue'));
  assert.match(autorisee, /return Boolean\(placeDeVue\(navigation\(\), v\)\);/);
  assert.doesNotMatch(autorisee, /menuMontre\(\)|SIMPLE|deblocages|toutAffiche/, 'une rubrique masquée par simplicité reste autorisée');
  const toutes = app.slice(app.indexOf('function onglets()'), app.indexOf('function vueAutorisee(v)'));
  assert.match(toutes, /destinations\(navigation\(\), piedNavigation\(E\.monde\)\)/, 'la palette cherche dans toutes les destinations');
  assert.match(app, /\{ groupe: 'Pas encore dans votre menu', elements: /, 'les rubriques en attente restent trouvées par la recherche');
  assert.match(app, /quand: \(\) => dansMonde\(\) && Boolean\(\$\('#coque'\)\) && \(vue === null \|\| \(vue === 'carte' \? !E\.sceneEchec : vueAutorisee\(vue\)\)\)/, 'raccourcis « G puis lettre » inchangés');
  // l'interrupteur : dans le pied du rail (ordinateur), dans « Plus » (téléphone), dans l'aide ; gardé par personne
  assert.match(app, /h\('input', \{ type: 'checkbox', role: 'switch', cle: 'rail-tout-afficher', checked: toutAffiche\(\), 'aria-describedby': 'rail-tout-afficher-aide'/);
  assert.match(app, /id: 'tout-afficher', titre: 'Tout afficher', icone: 'menu', presse: toutAffiche\(\)/);
  assert.match(app, /SIMPLE\.ecrirePreferences\(STOCKAGE_LOCAL, E\.monde\.profil\.id, E\.simplicite\)/);
  assert.match(app, /SIMPLE\.lirePreferences\(STOCKAGE_LOCAL, m\.profil\.id\)/);
  assert.match(app, /\['list', 'Les rubriques du menu', ouvrirRubriques\]/, 'les notes se relisent depuis l’Aide');
  // la note : une seule à la fois, jamais sous un bandeau de mode (exemple, simulation, aperçu), refermable
  const banniere = app.slice(app.indexOf('function rendreBanniere()'), app.indexOf('function informer('));
  assert.match(banniere, /\} else \{\n[^]*const note = noteDeVue\(\);/);
  assert.match(banniere, /onclick: \(\) => rangerNote\(note\.id\) \},\n\s*h\('span', \{ class: 'bz-bandeau__long', texte: 'J’ai compris' \}\)/, 'la note se range d’un geste');
  assert.match(app, /if \(!affichee \|\| !notesActives\(\) \|\| rubriqueDeVue\(\) === affichee \|\| E\.simplicite\.vues\.includes\(affichee\)\) return;/, 'lue une fois : la note se range quand on quitte la rubrique');
  assert.match(app, /const notesActives = \(\) => Boolean\(E\.monde\) && !E\.monde\.organisation\.demo && E\.monde\.mode !== 'simulation' && !E\.apercu/);
  // icônes utilisées : présentes dans le sprite
  const sprite = lire('web/bz/icones.txt');
  for (const ic of ['menu', 'lightbulb', 'list', 'clock', 'check', 'plug', 'user-plus']) assert.match(sprite, new RegExp(`^${ic}$`, 'm'), ic);
});

test('écrans vides : deux lignes (ce qui manque, ce que l’écran montrera) et une seule action principale', () => {
  const app = lire('web/app.js');
  const aide = app.slice(app.indexOf('function videRubrique('), app.indexOf('/** Erreur de chargement d'));
  assert.match(aide, /const t = SIMPLE\.texteVide\(id\);/, 'les deux lignes viennent de la table des rubriques');
  assert.match(aide, /actions: E\.monde\.profil\.peutAdministrer \? \[action, secondaire\] : \[\]/, 'sans droit d’administrer : pas de bouton, le texte dit qui s’en charge');
  assert.match(aide, /La personne qui administre Living Business connecte les données\./);
  // listes : l'écran vide passe avant la recherche, les vues enregistrées et le bouton « Ajouter »
  const liste = app.slice(app.indexOf('async function rendreListe(vue)'), app.indexOf('function clavierBarre(e)'));
  const vide = liste.indexOf('if (!objetsDeVue(vue).length) {');
  assert.ok(vide > 0 && vide < liste.indexOf("class: 'bz-liste__outils'") && vide < liste.indexOf("icone('plus'), 'Ajouter'"), 'liste vide : ni outils ni deuxième bouton principal');
  assert.doesNotMatch(liste, /!tous\.length \? h\('div', \{ class: 'bz-vide' \}/, 'un seul écran vide initial');
  assert.match(liste, /videRubrique\(rubriqueDeVue\(vue\), \{/);
  // planning, courrier, satisfaction, pipeline, liste des lieux : même écran vide
  assert.match(app, /if \(!P\.lignes\.length\) \{\n\s+remplir\(page, h\('div', \{ class: 'bz-ecran bz-planning' \}, videRubrique\('planning', \{/);
  assert.match(app, /!toutes\.length \? videRubrique\('courrier', \{/);
  assert.match(app, /peut && toutes\.length \? h\('div', \{ class: 'bz-groupe-boutons' \}, boutonAjouter\('bz-bouton--secondaire'\)\) : null\)/, 'courrier vide : le bouton n’est pas écrit deux fois');
  assert.match(app, /videRubrique\('satisfaction', \{/);
  assert.match(app, /colonnes\.every\(\(\[, , l\]\) => !l\.length\) \? videRubrique\('pipeline', \{ action: boutonConnecter\(\) \}\)/);
  assert.match(app, /videRubrique\(null, \{ titre: 'Votre carte est vide pour le moment\.'/);
  // la satisfaction garde son écran complet dès qu'il y a quelqu'un à interroger (le baromètre d'équipe reste lançable)
  assert.match(app, /if \(!Object\.keys\(S\.clients\)\.length && !m\.objets\.some\(\(o\) => o\.famille === 'personne'\) && !S\.barometre\?\.invites && !S\.barometre\?\.reponses\) \{/);
  // jamais plus d'un bouton principal dans un écran vide
  for (const appel of app.split('videRubrique(').slice(2)) {
    const corps = appel.slice(0, appel.indexOf('\n    return;') > 0 ? appel.indexOf('\n    return;') : 600);
    assert.ok((corps.match(/bz-bouton--principal|boutonConnecter\(/g) ?? []).length <= 1, corps.slice(0, 90));
  }
  // Optimiser : « Tout automatiser » ou la première piste, jamais deux boutons principaux
  assert.match(app, /const premiere = toutPret \? null : pistes\.find\(\(o\) => !o\.active\);/);
  // textes des écrans vides : un titre qui dit ce qui manque, une phrase qui dit ce qu'on verra
  for (const id of ['clients', 'fournisseurs', 'equipe', 'commandes', 'stock', 'documents', 'lieux', 'planning', 'courrier', 'satisfaction', 'pipeline']) {
    const t = S.texteVide(id);
    assert.ok(t && /pour le moment\.$/.test(t.titre), `${id} : « ${t?.titre} »`);
    assert.ok(t.texte.split(/[.!?] /).length <= 2, `${id} : une seule phrase`);
  }
});

/** Client HTTP avec cookie de session, pour lire /api/v1/monde comme le navigateur. */
async function avecServeur<T>(app: Application, profilId: string, f: (appel: (methode: string, chemin: string, corps?: unknown) => Promise<any>) => Promise<T>): Promise<T> {
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

test('passerelle réelle : entreprise créée vide → menu du premier jour ; un premier client ouvre Clients, Satisfaction et le réseau', async () => {
  const app = await Application.creer({ connexion: 'demo', exemple: null });
  const proprietaire = app.monde.initialiser({ nom: 'Maïwenn Le Goff', entreprise: 'Kerlann Bois', depart: 'vide' });
  await avecServeur(app, proprietaire.id, async (appel) => {
    const vide = await appel('GET', '/monde');
    assert.equal(vide.organisation.demo, false);
    const d0 = S.deblocages(vide);
    assert.deepEqual(ouvertes(d0), [...TOUJOURS].sort(), 'premier jour, sur la vraie réponse de la passerelle');
    assert.deepEqual(ids(S.menuAffiche(N.groupesNavigation(vide), d0)), ['aujourdhui']);
    assert.deepEqual(S.entreesAffichees(N.piedNavigation(vide), d0).map((e) => e.id), ['connecter', 'reglages']);

    await appel('POST', '/objets', { type: 'entreprise', nom: 'Scierie du Faou', roles: ['client'], champs: {} });
    const d1 = S.deblocages(await appel('GET', '/monde'));
    assert.deepEqual(S.vientDeSOuvrir(d0, d1), ['clients', 'satisfaction', 'nexus']);

    await appel('POST', '/objets', { type: 'employe', nom: 'Erwan Kermarrec', champs: {} });
    const avecEquipe = await appel('GET', '/monde');
    const d2 = S.deblocages(avecEquipe);
    assert.deepEqual(S.vientDeSOuvrir(d1, d2), ['planning', 'equipe', 'optimiser']);
    assert.deepEqual(ids(S.menuAffiche(N.groupesNavigation(avecEquipe), d2)), ['aujourdhui', 'planning', 'equipe', 'optimiser', 'clients', 'satisfaction', 'nexus']);
  });
});

test('démonstration (npm run demo) et entreprise déjà en place : tout ce que les données débloquent, dès la première lecture', async () => {
  for (const exemple of ['eti', 'pme'] as const) {
    const app = await Application.creer({ connexion: 'demo', exemple });
    await avecServeur(app, 'dirigeante', async (appel) => {
      const m = await appel('GET', '/monde');
      const d = S.deblocages(m);
      const fermees = Object.keys(d).filter((id) => !d[id]);
      assert.deepEqual(fermees, exemple === 'eti' ? [] : ['departements'], `exemple ${exemple} : rubriques sans données`);
      const groupes = N.groupesNavigation(m);
      assert.deepEqual(ids(S.menuAffiche(groupes, d)), ids(groupes), `exemple ${exemple} : le menu montré est le menu complet`);
      assert.deepEqual(S.entreesEnAttente(groupes, N.piedNavigation(m), d), [], 'rien en attente : pas d’interrupteur, rien à débloquer');
      assert.deepEqual(S.nouvelles(d, { tout: false, vues: S.repereDeDepart(d) }), [], 'aucune note pour une entreprise déjà en place');
      // un profil de terrain garde ses droits, avec ou sans « Tout afficher » : ni Pilotage, ni réseau, ni réglages
      await appel('POST', '/session', { profilId: 'terrain' });
      const mt = await appel('GET', '/monde');
      assert.equal(mt.profil.peutAdministrer, false);
      const droits = N.groupesNavigation(mt);
      const dt = S.deblocages(mt);
      for (const tout of [false, true]) {
        const montre = ids(S.menuAffiche(droits, dt, { tout }));
        assert.ok(montre.every((id) => ids(droits).includes(id)));
        for (const interdit of ['sante', 'optimiser', 'nexus']) assert.ok(!montre.includes(interdit), `terrain, tout=${tout} : ${interdit} reste interdit`);
        assert.deepEqual(S.entreesAffichees(N.piedNavigation(mt), dt, { tout }), []);
      }
    });
  }
});
