/**
 * « Connecter mes données » (direction de design §6.1 P4, §4.21, §4.23) : web/connecter.js (module pur) — question
 * d'entrée, 3 recommandations, regroupement par compte, trois sections, mode avancé, étapes de l'assistant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONNECTEURS } from '../passerelle/connecteurs.ts';
import { ADAPTATEURS } from '../passerelle/sources.ts';

type Contenu = { id: string; libelle: string; detail: string; source: string | null; disponible: boolean; unClic: boolean; cle: boolean };
type Entree = { cle: string; genre: string; id: string; nom: string; description: string; famille: string; icone: string; section: string; unClic: boolean; avance: boolean; bientot: boolean; contenus?: Contenu[] };
type Sections = { 'un-clic': Entree[]; cle: Entree[]; avance: Entree[]; fichier: Entree[]; total: number };
type Module = {
  QUESTION: string;
  REPONSES: ReadonlyArray<{ id: string; titre: string; detail: string; icone: string }>;
  FAMILLES: ReadonlyArray<{ id: string; libelle: string; icone: string }>;
  SECTIONS: ReadonlyArray<{ id: 'un-clic' | 'cle' | 'avance' | 'fichier'; titre: string; texte: string }>;
  COMPTES: ReadonlyArray<{ id: string; nom: string; icone: string; contenus: ReadonlyArray<{ id: string; libelle: string; source: string | null }> }>;
  CONSEILS: Readonly<Record<string, readonly string[]>>;
  PARCOURS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>>;
  catalogue: (s: readonly unknown[], c: readonly unknown[], o?: { pasAPas?: boolean }) => Entree[];
  compteDe: (id: string) => { id: string } | null;
  recommandations: (r: string, cat: Entree[], n?: number) => Entree[];
  filtrer: (cat: Entree[], o?: { famille?: string | null; recherche?: string }) => Sections;
  famillesPresentes: (cat: Entree[]) => Array<{ id: string }>;
  cibleProbable: (nom: string, cibles: ReadonlyArray<{ libelle: string }>) => { libelle: string } | null;
  cibleFixe: (id: string) => string | null;
  sensAvantConnexion: (id: string) => { lecture: string; deux: string } | null;
  parcoursDe: (x: Partial<Entree> | null) => string;
  progression: (p: string, e: string) => { index: number; total: number; libelle: string; texte: string };
  abandonAConfirmer: (o: { etape?: string; connexionEnCours?: boolean; saisie?: boolean }) => boolean;
};
const M = (await import(new URL('../../web/connecter.js', import.meta.url).href)) as Module;
const lire = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8');
const normaliser = (t: string) => t.replace(/[  ]/g, ' ');

/** Catalogue réel : celui que la passerelle publie (GET /sources et GET /connecteurs). */
function sourcesReelles(ouverts: string[] = []) {
  const AVANCES = ['mcp', 'webhook', 'rest'];
  return Object.values(ADAPTATEURS).map((a) => ({
    id: a.id, nom: a.nom, categorie: a.categorie, description: a.description, champs: a.champs, ecriture: a.ecriture,
    avance: AVANCES.includes(a.id), oauth: ouverts.includes(a.id) ? { nom: a.nom } : null,
  }));
}
const ids = (l: Entree[]) => l.map((x) => x.id).sort();

test('question d’entrée : 6 réponses illustrées, dans l’ordre du §6.1 P4', () => {
  assert.equal(normaliser(M.QUESTION), 'Où sont vos clients aujourd’hui ?');
  assert.deepEqual(M.REPONSES.map((r) => r.id), ['excel', 'google', 'facturation', 'crm', 'papier', 'nulle-part']);
  const sprite = lire('web/bz/icones.svg');
  for (const r of M.REPONSES) {
    assert.ok(sprite.includes(`id="i-${r.icone}"`), `${r.id} : icône ${r.icone} dans le sprite`);
    assert.match(r.titre, /^\p{Lu}/u, 'casse de phrase');
    assert.doesNotMatch(`${r.titre} ${r.detail}`, /\(s\)|[A-ZÉ]{4,}/, 'ni « (s) » ni capitales écrites');
  }
  for (const f of M.FAMILLES) assert.ok(sprite.includes(`id="i-${f.icone}"`), `famille ${f.id} : icône ${f.icone}`);
  for (const c of M.COMPTES) assert.ok(sprite.includes(`id="i-${c.icone}"`), `compte ${c.id} : icône ${c.icone}`);
});

test('un compte, pas un connecteur : Google et Microsoft n’ont qu’une entrée, leur contenu se choisit après', () => {
  const cat = M.catalogue(sourcesReelles(['sheets', 'excel365', 'dynamics365', 'businesscentral']), CONNECTEURS);
  const comptes = cat.filter((x) => x.genre === 'compte');
  assert.deepEqual(ids(comptes), ['google', 'microsoft'], 'deux comptes, pas quatre connecteurs');
  // les quatre entrées d'hier (deux comptes) ne figurent plus une par une
  for (const id of ['sheets', 'excel365', 'dynamics365', 'businesscentral']) {
    assert.ok(!cat.some((x) => x.genre === 'outil' && x.id === id), `${id} : plus d’entrée séparée`);
  }
  const microsoft = comptes.find((x) => x.id === 'microsoft');
  assert.deepEqual(microsoft?.contenus?.filter((c) => c.disponible).map((c) => c.source), ['excel365', 'dynamics365', 'businesscentral'],
    'un seul compte Microsoft couvre Excel, Dynamics 365 et Business Central');
  assert.ok(microsoft?.contenus?.every((c) => !c.disponible || c.unClic), 'ouverts : chacun en un clic');
  const google = comptes.find((x) => x.id === 'google');
  assert.deepEqual(google?.contenus?.map((c) => [c.id, c.disponible]), [['sheets', true], ['agenda', false], ['messagerie', false]],
    'la place de l’agenda et de la messagerie est prévue, sans être proposée');
  assert.equal(M.compteDe('excel365')?.id, 'microsoft');
  assert.equal(M.compteDe('hubspot'), null, 'les autres outils gardent une entrée chacun');
  assert.ok(cat.some((x) => x.genre === 'outil' && x.id === 'hubspot'));
  // un compte dont aucun outil n'est ouvert reste proposé par sa clé, jamais en un clic
  const sansRelais = M.catalogue(sourcesReelles(), CONNECTEURS).filter((x) => x.genre === 'compte');
  assert.ok(sansRelais.every((x) => !x.unClic && x.section === 'cle'));
});

test('agenda et courrier : proposés dans le compte dès que le relais les ouvre, absents sinon', () => {
  // l'éditeur a tout ouvert sauf Gmail (portée « restreinte » chez Google, pas encore vérifiée)
  const cat = M.catalogue(sourcesReelles(['sheets', 'agendagoogle', 'excel365', 'agendamicrosoft', 'outlook']), CONNECTEURS);
  const comptes = cat.filter((x) => x.genre === 'compte');
  const contenus = (id: string) => comptes.find((x) => x.id === id)?.contenus ?? [];
  assert.deepEqual(contenus('google').map((c) => [c.id, c.disponible]), [['sheets', true], ['agenda', true], ['messagerie', false]],
    'Gmail fermé chez l’éditeur : l’entrée n’est pas proposée');
  // Excel, Dynamics et Business Central restent branchables par une clé ; l'agenda et le courrier, eux, n'ont que le clic
  assert.deepEqual(contenus('microsoft').map((c) => [c.id, c.disponible, c.unClic]),
    [['excel365', true, true], ['agenda', true, true], ['messagerie', true, true], ['dynamics365', true, false], ['businesscentral', true, false]]);
  // rien dans « Que voulez-vous brancher ? » ne mène à un refus : tout ce qui est proposé s'ouvre vraiment
  for (const c of [...contenus('google'), ...contenus('microsoft')]) if (c.disponible) assert.ok(c.unClic || c.cle, `${c.id} : une voie qui marche`);
  // un agenda ou une boîte ne figure jamais à part : il appartient à son compte
  for (const id of ['agendagoogle', 'agendamicrosoft', 'gmail', 'outlook']) assert.ok(!cat.some((x) => x.genre === 'outil' && x.id === id), `${id} : pas d’entrée séparée`);
  assert.equal(M.compteDe('agendagoogle')?.id, 'google');
  assert.equal(M.compteDe('outlook')?.id, 'microsoft');
  // ce qui entre est connu d'avance : aucune cible à choisir, aucune colonne à associer, une étape de moins
  assert.equal(M.cibleFixe('agendagoogle'), 'rendez_vous');
  assert.equal(M.cibleFixe('gmail'), 'courrier');
  assert.equal(M.cibleFixe('sheets'), null, 'une feuille de calcul peut contenir n’importe quoi : on demande');
  assert.deepEqual(M.PARCOURS.outilDirect?.map(([k]) => k), ['choisir', 'connexion', 'recuperer', 'pret']);
  assert.equal(normaliser(M.progression('outilDirect', 'recuperer').texte), 'Étape 3 sur 4 · Que récupérer ?');
  // « dans les deux sens » se choisit AVANT la connexion : c'est lui qui décide des droits demandés
  for (const id of ['agendagoogle', 'agendamicrosoft', 'gmail', 'outlook']) {
    const s = M.sensAvantConnexion(id);
    assert.ok(s?.lecture && s.deux, `${id} : les deux choix sont dits`);
    assert.doesNotMatch(`${s.lecture} ${s.deux}`, /portée|scope|droit d’écriture/, `${id} : dit en français courant`);
  }
  assert.equal(M.sensAvantConnexion('sheets'), null);
});

test('trois sections : « En un clic » n’affiche que ce que le relais ouvre vraiment ; ce qui ne marche pas n’apparaît pas', () => {
  const cat = M.catalogue(sourcesReelles(['sheets', 'excel365', 'dynamics365', 'businesscentral', 'hubspot']), CONNECTEURS);
  assert.deepEqual(M.SECTIONS.map((s) => s.id), ['un-clic', 'cle', 'avance', 'fichier']);
  const r = M.filtrer(cat);
  assert.deepEqual(ids(r['un-clic']), ['google', 'hubspot', 'microsoft'], 'seulement les comptes ouverts par le relais');
  assert.ok(r['un-clic'].every((x) => x.unClic), 'rien qui mènerait à un refus');
  assert.ok(r.cle.length && r.cle.every((x) => !x.unClic && !x.avance), 'la clé, pour tout le reste');
  assert.deepEqual(ids(r.avance), ['mcp', 'rest', 'webhook'], 'webhook, API REST et serveur MCP, ensemble');
  assert.ok(r.fichier.some((x) => x.id === 'csv') && r.fichier.some((x) => x.id === 'fec') && r.fichier.some((x) => x.id === 'pas-a-pas'));
  // chaque entrée est dans une section et une seule
  const sections = new Set(M.SECTIONS.map((s) => s.id as string));
  for (const x of cat) assert.ok(sections.has(x.section), `${x.id} : section ${x.section}`);
  for (const s of M.SECTIONS) for (const x of M.filtrer(cat)[s.id]) assert.equal(x.section, s.id);
  // « on met pas ce qui marche pas » : plus rien n'est annoncé « bientôt »
  assert.ok(!cat.some((x) => x.bientot), 'aucune entrée « pas encore disponible »');
  for (const c of CONNECTEURS.filter((x) => x.statut !== 'disponible')) assert.ok(!cat.some((x) => x.id === c.id), `${c.id} ne marche pas : absent`);
  assert.ok(!cat.some((x) => x.cle === 'import:sheets'), 'plus de doublon « Google Sheets (lien publié) » à côté du compte Google');
  // chaque catégorie annoncée par la passerelle tombe dans une famille connue
  const familles = new Set([...M.FAMILLES.map((f) => f.id), 'avance']);
  for (const x of cat) assert.ok(familles.has(x.famille), `${x.id} : famille ${x.famille}`);
  const parFamille = (id: string) => cat.filter((x) => x.famille === id).map((x) => x.id);
  assert.ok(parFamille('facturation').includes('pennylane') && parFamille('facturation').includes('fec') && parFamille('facturation').includes('axonaut'));
  assert.ok(parFamille('crm').includes('hubspot') && parFamille('boutique').includes('shopify') && parFamille('tableurs').includes('microsoft'));
  assert.ok(M.famillesPresentes(cat).length >= 6);
});

test('connecter n’est pas importer : l’étape « Que récupérer ? » est entre la connexion et l’import', () => {
  assert.deepEqual(M.PARCOURS.outil?.map(([k]) => k), ['choisir', 'connexion', 'recuperer', 'colonnes', 'pret']);
  assert.equal(M.progression('outil', 'recuperer').texte, 'Étape 3 sur 5 · Que récupérer ?');
  const app = lire('web/app.js');
  // la connexion réussie le dit, et ne déclenche aucune lecture ni aucun enregistrement
  assert.match(app, /Rien n’a encore été importé\./);
  assert.match(app, /annoncer\(`Connecté à \$\{nomOutilDe\(C\)\}\. Rien n’a encore été importé\.`\)/);
  const connexion = app.slice(app.indexOf('function corpsConnexion(C)'), app.indexOf('function piedConnexion(C)'));
  assert.doesNotMatch(connexion, /selectCible\(/, 'on ne demande plus ce que contient l’outil AVANT de connecter');
  // le seul appel qui crée un branchement reste l'import, après la correspondance des colonnes
  assert.match(app, /boutonPrincipal\(`Importer \$\{pluriel\(A\.outil\?\.apercu\?\.enregistrements \?\? 0, 'fiche', 'fiches'\)\} dans le jeu`, \(\) => activerOutil\(A\.outil\)/);
  const avantImport = app.slice(app.indexOf('function versRecuperer(C)'), app.indexOf('/** La personne a tout vu et tout validé'));
  assert.ok(!/api\('POST', '\/synchro'[^/]/.test(avantImport), 'aucun branchement actif créé avant l’import');
  assert.match(avantImport, /api\('POST', '\/synchro\/apercu'/, 'seulement un aperçu, en lecture');
  // le compte connecté est tout de même enregistré, en pause : il figure dans la liste même si on s’arrête là
  assert.match(app, /C\.cree = await api\('POST', '\/synchro\/connexion', \{ source: C\.s\.id, nom: C\.nom, config: C\.config \}\)/);
  assert.match(app, /C\.cree = C\.cree\?\.id\s*\n\s*\? await api\('PUT', `\/synchro\/\$\{C\.cree\.id\}`, \{ \.\.\.reglages, actif: true \}\)/, 'on complète ce branchement, on n’en crée pas un second');
  assert.match(app, /c\.aChoisir \? resultatAssistant\('info', 'Connecté\. Rien n’a encore été importé\.'/, 'la liste le dit');
  // l'écran « Que récupérer ? » montre ce que le compte contient, ce que ça devient, et un aperçu
  const recuperer = app.slice(app.indexOf('function corpsRecuperer(C)'), app.indexOf('function blocSens(C)'));
  assert.match(recuperer, /tableauApercu\(a\)/, 'un aperçu de quelques lignes');
  assert.match(recuperer, /selectCible\(C/, 'à quoi ça correspond dans le jeu');
  assert.match(recuperer, /blocSens\(C\)/, 'le sens de la synchronisation');
  assert.match(app, /À quoi ça correspond dans le jeu \?/);
});

test('correspondance des colonnes : proposée, montrée, modifiable, et un champ inconnu ne fait rien échouer', () => {
  const app = lire('web/app.js');
  const colonnes = app.slice(app.indexOf('function corpsColonnesOutil(C)'), app.indexOf('async function activerOutil(C)'));
  assert.match(colonnes, /listeColonnes\(a\.champs, a\.cibles, C\.mapping/, 'la correspondance proposée est affichée et modifiable');
  assert.match(colonnes, /Une colonne non reconnue est simplement laissée de côté : elle ne fait rien échouer\./);
  assert.match(app, /h\('option', \{ value: '', texte: 'Ne pas importer' \}\)/, 'chaque colonne peut être écartée');
});

test('Microsoft : le compte professionnel est dit AVANT le clic, et les refus deviennent des conseils', () => {
  const app = lire('web/app.js');
  assert.match(app, /Il vous faut un compte Microsoft 365 professionnel\./);
  assert.match(app, /compte personnel \(Outlook\.com, Hotmail, Live\) est refusé par Microsoft dès la page de connexion/);
  // l'agenda et le courrier Outlook passent par le même point d'entrée « organizations » : le compte professionnel
  // est donc dit pour eux aussi, avant le clic
  assert.match(app, /votre agenda, votre courrier Outlook professionnel/, 'l’avertissement couvre tout ce que le compte ouvre');
  assert.match(app, /const microsoft = C\.compte\?\.id === 'microsoft' \|\| \['excel365', 'dynamics365', 'businesscentral'\]\.includes\(s\?\.id\)/);
  assert.match(app, /!connecte && microsoft \? AVERTISSEMENT_MICROSOFT : null/, 'montré avant le clic, pas après le refus');
  const relais = lire('src/passerelle/oauth-relais.ts');
  assert.match(relais, /export function conseilMicrosoft\(texte: string\): string \| null/);
  for (const code of ['AADSTS500208', 'AADSTS50020', 'AADSTS65001', 'AADSTS53003', 'AADSTS700016', 'AADSTS650057']) assert.ok(relais.includes(code), code);
  assert.match(relais, /learn\.microsoft\.com/, 'la documentation officielle est citée dans le code');
  assert.doesNotMatch(app, /AADSTS/, 'aucun code technique à l’écran');
});

test('recommandations : 3 par réponse, tirées du catalogue réel, disponibles, « 1 clic » d’abord', () => {
  const sans = M.catalogue(sourcesReelles(), CONNECTEURS);
  const avec = M.catalogue(sourcesReelles(['excel365', 'hubspot', 'sheets', 'pipedrive', 'sellsy']), CONNECTEURS);
  for (const r of M.REPONSES) {
    for (const cat of [sans, avec]) {
      const c = M.recommandations(r.id, cat);
      assert.equal(c.length, 3, `${r.id} : 3 conseils`);
      assert.ok(c.every((x) => !x.bientot && !x.avance), `${r.id} : jamais « bientôt » ni mode avancé`);
      assert.equal(new Set(c.map((x) => x.cle)).size, 3);
    }
    for (const cle of M.CONSEILS[r.id] ?? []) assert.ok(sans.some((x) => x.cle === cle), `${r.id} : ${cle} existe dans le catalogue`);
  }
  assert.equal(M.recommandations('excel', avec)[0]?.id, 'microsoft', 'le compte Microsoft en « 1 clic » passe en premier');
  assert.equal(M.recommandations('google', avec)[0]?.id, 'google');
  assert.deepEqual(M.recommandations('excel', sans).map((x) => x.id).slice(0, 2), ['coller', 'csv'], 'sans « 1 clic » : le copier-coller d’abord (aucune conversion), puis le fichier CSV');
  assert.deepEqual(M.recommandations('crm', avec).map((x) => x.id).slice(0, 2), ['hubspot', 'pipedrive']);
  assert.ok(M.recommandations('nulle-part', sans).some((x) => x.id === 'pas-a-pas'));
  assert.deepEqual(M.recommandations('inconnue', sans), []);
});

test('filtre : famille, recherche sans accents, contenu d’un compte, état vide', () => {
  const cat = M.catalogue(sourcesReelles(['excel365']), CONNECTEURS);
  const tout = M.filtrer(cat);
  assert.equal(tout.total, cat.filter((x) => !x.avance).length);
  assert.equal(tout.avance.length, 3);
  const factu = M.filtrer(cat, { famille: 'facturation' });
  assert.ok(factu.cle.length > 0 && factu.cle.every((x) => x.famille === 'facturation'));
  assert.equal(factu.avance.length, 3, 'le mode avancé reste proposé quelle que soit la famille');
  assert.deepEqual(M.filtrer(cat, { recherche: 'PENNYLANE' }).cle.map((x) => x.id), ['pennylane']);
  assert.ok(M.filtrer(cat, { recherche: 'comptabilite' }).fichier.some((x) => x.id === 'fec'), 'sans accent');
  assert.ok(M.filtrer(cat, { recherche: 'webhook' }).avance.some((x) => x.id === 'webhook'));
  // on cherche « Excel » ou « Dynamics » et on trouve le compte Microsoft, même si son nom ne les contient pas
  assert.ok(M.filtrer(cat, { recherche: 'excel' })['un-clic'].some((x) => x.id === 'microsoft'));
  assert.ok(M.filtrer(cat, { recherche: 'dynamics' })['un-clic'].some((x) => x.id === 'microsoft'));
  const rien = M.filtrer(cat, { recherche: 'zzzz introuvable' });
  assert.deepEqual([rien['un-clic'].length, rien.cle.length, rien.fichier.length, rien.total], [0, 0, 0, 0]);
});

test('ce qu’on trouve dans l’outil se devine : « Clients 2026 » propose la cible « Clients »', () => {
  const cibles = [{ libelle: 'Clients' }, { libelle: 'Fournisseurs' }, { libelle: 'Commandes' }, { libelle: 'Équipe' }];
  assert.equal(M.cibleProbable('Clients 2026', cibles)?.libelle, 'Clients');
  assert.equal(M.cibleProbable('Base — tableau « Fournisseurs »', cibles)?.libelle, 'Fournisseurs');
  assert.equal(M.cibleProbable('Suivi des commandes', cibles)?.libelle, 'Commandes');
  assert.equal(M.cibleProbable('Feuil1', cibles), null, 'rien de sûr : la personne choisit');
  assert.equal(M.cibleProbable('', cibles), null);
});

test('assistant : étapes du §4.21 (« Étape 2 sur 5 · … »), parcours, « Abandonner ? » seulement si commencé', () => {
  assert.deepEqual(M.PARCOURS.fichier?.map(([k]) => k), ['choisir', 'contenu', 'fichier', 'colonnes', 'pret']);
  assert.deepEqual(M.PARCOURS.fec?.map(([k]) => k), ['choisir', 'fec', 'pret']);
  assert.ok(Object.values(M.PARCOURS).every((p) => p[0]?.[0] === 'choisir'));
  assert.equal(M.progression('fichier', 'colonnes').texte, 'Étape 4 sur 5 · Associer les colonnes');
  assert.equal(M.progression('outil', 'connexion').texte, 'Étape 2 sur 5 · Se connecter');
  assert.equal(M.progression('inconnu', 'nulle').index, 0);
  assert.equal(M.parcoursDe({ genre: 'outil', id: 'hubspot' }), 'outil');
  assert.equal(M.parcoursDe({ genre: 'compte', id: 'microsoft' }), 'outil');
  assert.equal(M.parcoursDe({ genre: 'import', id: 'fec' }), 'fec');
  assert.equal(M.parcoursDe({ genre: 'import', id: 'manuel' }), 'manuel');
  assert.equal(M.parcoursDe({ genre: 'import', id: 'csv' }), 'fichier');
  assert.equal(M.abandonAConfirmer({ etape: 'choisir' }), false);
  assert.equal(M.abandonAConfirmer({ etape: 'pret' }), false);
  assert.equal(M.abandonAConfirmer({ etape: 'colonnes' }), true);
  assert.equal(M.abandonAConfirmer({ etape: 'choisir', connexionEnCours: true }), true, 'une connexion chez l’outil n’est jamais annulée par un clic malheureux');
  assert.equal(M.abandonAConfirmer({ etape: 'connexion', saisie: false }), false, 'rien de saisi : on ferme sans demander (P4)');
  assert.equal(M.abandonAConfirmer({ etape: 'connexion', saisie: true }), true);
});

test('interface : un seul assistant en <dialog> à étapes, voile qui ne ferme pas, mode avancé nommé pour l’informaticien', () => {
  const app = lire('web/app.js');
  assert.match(app, /h\('dialog', \{ class: 'bz-dialogue bz-dialogue--lg bz-assistant', 'data-parcours': ''/, 'dialogue lg, parcours à étapes (le voile ne le ferme pas)');
  assert.match(app, /addEventListener\('cancel', \(e\) => \{ e\.preventDefault\(\); demanderFermeture\(\); \}\)/, 'Échap demande « Abandonner ? »');
  assert.match(app, /Vos réglages ne seront pas gardés\./);
  assert.ok(app.includes('Mode avancé : pour votre informaticien'));
  assert.match(app, /aria-current': etat === 'courante' \? 'step'/, 'étape courante en aria-current="step"');
  assert.doesNotMatch(app, /grilleOutils|class: 'connecteur |class: 'monogramme'|background:\$\{(?:c|x|s\?)\.couleur/, 'plus de cartes colorées par marque ni de monogramme coloré (§4.23)');
  assert.doesNotMatch(app, /'BRANCHER UN OUTIL'|'SYNCHRONISÉS EN TEMPS RÉEL|'IMPORT PONCTUEL'|'COMPTABILITÉ · FICHIER FEC'/, 'plus de titres écrits en capitales');
  // l'import du FEC garde son écran de résultat (chiffres clés), restylé
  for (const l of ['Chiffre d’affaires annuel', 'Marge brute', 'Résultat net annuel', 'Trésorerie', 'Charges par mois', 'Créances clients', 'Emprunts', 'Capitaux propres']) assert.ok(app.includes(l), l);
  const css = lire('web/bz/composants.css');
  for (const c of ['.bz-assistant', '.bz-etapes', '.bz-assistant__progression', '.bz-logiciel', '.bz-choix--illustre', '.bz-depot', '.bz-colonnes', '.bz-chiffres']) assert.ok(css.includes(c), `${c} dans composants.css`);
});

test('fichiers acceptés : on dit vrai (CSV et copier-coller), aucune promesse de lire un classeur Excel', () => {
  const csv = CONNECTEURS.find((c) => c.id === 'csv');
  const coller = CONNECTEURS.find((c) => c.id === 'coller');
  assert.equal(csv?.nom, 'Fichier CSV', 'le nom ne promet plus « Excel »');
  assert.match(csv?.description ?? '', /\.xlsx n’est pas encore lu/);
  assert.match(coller?.description ?? '', /Depuis Excel[^.]*copiez, collez\. Aucun fichier à convertir\./);
  // « Dans un fichier Excel » reste une réponse (c'est là que sont les clients), mais le premier conseil marche sans conversion
  const cat = M.catalogue(sourcesReelles(), CONNECTEURS);
  assert.deepEqual(M.recommandations('excel', cat).map((x) => x.cle), ['import:coller', 'import:csv', 'compte:microsoft']);
  const app = lire('web/app.js');
  assert.doesNotMatch(app, /Fichier Excel ou CSV|CSV ou Excel|fichier Excel, Google Sheets/);
  assert.match(app, /accept: '\.csv,text\/csv'/, 'le sélecteur n’accepte que ce qui est lu');
  assert.match(app, /const estClasseur = \(nom\) => \/\\\.\(xlsx\?\|xlsm\|xlsb\|ods\|numbers\)\$\/i/);
  assert.match(app, /if \(estClasseur\(fichier\.name\)\) \{ A\.erreur = [^;]*; A\.source = 'coller';/, 'un classeur déposé : message clair, puis le copier-coller');
  assert.doesNotMatch(lire('web/aujourdhui.js'), /fichier Excel/);
});

test('depuis l’exemple : « Remplacer l’exemple par mon entreprise » d’abord, nom de l’installation prérempli', () => {
  const app = lire('web/app.js');
  // la première vue de l'assistant, dans l'exemple, n'est plus la question d'import
  assert.match(app, /const exempleAChoisir = \(A\) => Boolean\(E\.monde\?\.organisation\.demo && E\.monde\.profil\.peutAdministrer && !A\.dansExemple\);/);
  assert.match(app, /if \(exempleAChoisir\(A\)\) return corpsExemple\(A\);/);
  const exemple = app.slice(app.indexOf('function corpsExemple(A)'), app.indexOf('function corpsChoisir(A)'));
  const [remplacer, essayer] = [exemple.indexOf("carte('Remplacer l’exemple par mon entreprise'"), exemple.indexOf("carte('Essayer un import dans l’exemple'")];
  assert.ok(remplacer > 0 && essayer > remplacer, 'remplacer d’abord, essayer ensuite');
  assert.match(exemple, /class: 'bz-bouton bz-bouton--principal', cle: 'assistant-remplacer'/, 'une seule action principale : remplacer');
  assert.match(exemple, /class: 'bz-bouton bz-bouton--secondaire', cle: 'assistant-essayer', onclick: \(\) => \{ A\.dansExemple = true;/);
  assert.match(exemple, /s’ajoute aux données fictives/, 'le mélange est dit avant d’importer');
  assert.doesNotMatch(app, /Créer mon entreprise à la place/);
  // le nom saisi à l'installation (départ « exemple ») est gardé sur l'appareil, proposé, puis oublié une fois utilisé
  assert.match(app, /ecrireLocal\(NOM_SOUHAITE, S\.depart === 'exemple' \? S\.entreprise\.trim\(\)\.slice\(0, 120\) : ''\);/);
  assert.match(app, /nomEntreprise: lireLocal\(NOM_SOUHAITE\) \?\? '', dansExemple: false/);
  assert.match(app, /await api\('POST', '\/monde\/vider-demo', \{ nom: A\.nomEntreprise\.trim\(\) \}\);\s+ecrireLocal\(NOM_SOUHAITE, ''\);/);
  assert.match(app, /if \(A\.parcours === 'zero'\) return Boolean\(A\.nomEntreprise\.trim\(\)\) && A\.nomEntreprise !== \(lireLocal\(NOM_SOUHAITE\) \?\? ''\);/, 'un nom seulement prérempli ne demande pas « Abandonner ? »');
});

test('« Que contient ce fichier ? » : « Clients » déjà coché, six réponses courantes, le reste replié', () => {
  const app = lire('web/app.js');
  // on vient de répondre à « Où sont vos clients ? » : la cible est proposée, la question reste posée
  assert.match(app, /const cibleParDefaut = \(\) => ciblesCourantes\(ciblesImport\(\)\)\[0\] \?\? null;/);
  assert.match(app, /if \(!dejaChoisi\) A\.cible = cibleParDefaut\(\);\s+allerEtape\(dejaChoisi \? 'fichier' : 'contenu'\);/);
  const courantes = app.slice(app.indexOf('function ciblesCourantes('), app.indexOf('function corpsContenu('));
  assert.match(courantes, /toutes\.find\(\(c\) => c\.cle === 'role:client'\),/, '« Clients » en premier : c’est la cible par défaut');
  assert.deepEqual((courantes.match(/'role:client'|'role:fournisseur'|'employe'|'article'|'facture'|'devis'/g) ?? []).map((x) => x.replaceAll("'", '')), ['role:client', 'role:fournisseur', 'employe', 'article', 'facture', 'devis'], 'six réponses courantes, dans cet ordre');
  // les quatorze autres types ne disparaissent pas : ils sont repliés sous « Autre chose », ouvert si l'un est choisi
  const contenu = app.slice(app.indexOf('function corpsContenu(A)'), app.indexOf('const estClasseur ='));
  assert.match(contenu, /const autres = toutes\.filter\(\(c\) => !courantes\.includes\(c\)\);/);
  assert.match(contenu, /texte: 'Autre chose'/);
  assert.match(contenu, /open: autres\.some\(\(c\) => c\.cle === A\.cible\?\.cle\)/);
  assert.ok(contenu.indexOf('courantes.map(choix)') < contenu.indexOf('autres.map(choix)'), 'les courantes d’abord');
});
