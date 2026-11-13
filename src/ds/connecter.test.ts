/**
 * « Connecter mes données » (direction de design §6.1 P4, §4.21, §4.23) : web/connecter.js (module pur) — question
 * d'entrée, 3 recommandations, catalogue filtrable, « 1 clic » seule pastille, mode avancé, étapes de l'assistant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CONNECTEURS } from '../passerelle/connecteurs.ts';
import { ADAPTATEURS } from '../passerelle/sources.ts';

type Entree = { cle: string; genre: string; id: string; nom: string; description: string; famille: string; icone: string; unClic: boolean; avance: boolean; bientot: boolean };
type Module = {
  QUESTION: string;
  REPONSES: ReadonlyArray<{ id: string; titre: string; detail: string; icone: string }>;
  FAMILLES: ReadonlyArray<{ id: string; libelle: string; icone: string }>;
  CONSEILS: Readonly<Record<string, readonly string[]>>;
  PARCOURS: Readonly<Record<string, ReadonlyArray<readonly [string, string]>>>;
  catalogue: (s: readonly unknown[], c: readonly unknown[], o?: { pasAPas?: boolean }) => Entree[];
  recommandations: (r: string, cat: Entree[], n?: number) => Entree[];
  filtrer: (cat: Entree[], o?: { famille?: string | null; recherche?: string }) => { simples: Entree[]; bientot: Entree[]; avances: Entree[]; total: number };
  famillesPresentes: (cat: Entree[]) => Array<{ id: string }>;
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
  return Object.values(ADAPTATEURS).map((a) => ({ id: a.id, nom: a.nom, categorie: a.categorie, description: a.description, ecriture: a.ecriture, avance: AVANCES.includes(a.id), oauth: ouverts.includes(a.id) ? { nom: a.nom } : null }));
}

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
});

test('catalogue : outils synchronisés et imports réunis, « 1 clic » en tête, mode avancé à part, « bientôt » honnête', () => {
  const cat = M.catalogue(sourcesReelles(['hubspot', 'sheets']), CONNECTEURS);
  assert.ok(cat.length >= Object.keys(ADAPTATEURS).length + CONNECTEURS.length, 'rien n’est perdu');
  assert.deepEqual(cat.slice(0, 2).map((x) => x.id).sort(), ['hubspot', 'sheets'], 'les logiciels en « 1 clic » d’abord');
  assert.deepEqual(cat.filter((x) => x.avance).map((x) => x.id).sort(), ['mcp', 'rest', 'webhook'], 'MCP, webhook et API : mode avancé');
  assert.deepEqual(cat.filter((x) => x.bientot).map((x) => x.id).sort(), CONNECTEURS.filter((c) => c.statut !== 'disponible').map((c) => c.id).sort());
  assert.ok(cat.every((x) => x.unClic === (x.genre === 'outil' && ['hubspot', 'sheets'].includes(x.id))), '« 1 clic » vient seulement du relais');
  assert.ok(cat.some((x) => x.cle === 'action:pas-a-pas'), 'le parcours pas à pas est proposé');
  assert.ok(!M.catalogue([], [], { pasAPas: false }).length);
  // chaque catégorie annoncée par la passerelle tombe dans une famille connue (aucune catégorie oubliée)
  const familles = new Set([...M.FAMILLES.map((f) => f.id), 'avance']);
  for (const x of cat) assert.ok(familles.has(x.famille), `${x.id} : famille ${x.famille}`);
  const parFamille = (id: string) => cat.filter((x) => x.famille === id).map((x) => x.id);
  assert.ok(parFamille('facturation').includes('pennylane') && parFamille('facturation').includes('fec') && parFamille('facturation').includes('axonaut'));
  assert.ok(parFamille('crm').includes('hubspot') && parFamille('boutique').includes('shopify') && parFamille('tableurs').includes('excel365'));
  assert.ok(M.famillesPresentes(cat).length >= 6);
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
  assert.equal(M.recommandations('excel', avec)[0]?.id, 'excel365', 'Excel 365 en « 1 clic » passe en premier');
  assert.deepEqual(M.recommandations('excel', sans).map((x) => x.id).slice(0, 2), ['coller', 'csv'], 'sans « 1 clic » : le copier-coller d’abord (aucune conversion), puis le fichier CSV');
  assert.deepEqual(M.recommandations('crm', avec).map((x) => x.id).slice(0, 2), ['hubspot', 'pipedrive']);
  assert.ok(M.recommandations('nulle-part', sans).some((x) => x.id === 'pas-a-pas'));
  assert.deepEqual(M.recommandations('inconnue', sans), []);
});

test('filtre : famille, recherche sans accents, état vide, mode avancé toujours à part', () => {
  const cat = M.catalogue(sourcesReelles(), CONNECTEURS);
  const tout = M.filtrer(cat);
  assert.equal(tout.total, cat.filter((x) => !x.avance).length);
  assert.ok(tout.simples.every((x) => !x.bientot && !x.avance) && tout.avances.length === 3);
  const factu = M.filtrer(cat, { famille: 'facturation' });
  assert.ok(factu.simples.length > 0 && factu.simples.every((x) => x.famille === 'facturation'));
  assert.equal(factu.avances.length, 3, 'le mode avancé reste proposé quelle que soit la famille');
  assert.deepEqual(M.filtrer(cat, { recherche: 'PENNYLANE' }).simples.map((x) => x.id), ['pennylane']);
  assert.ok(M.filtrer(cat, { recherche: 'comptabilite' }).simples.some((x) => x.id === 'fec'), 'sans accent');
  assert.ok(M.filtrer(cat, { recherche: 'webhook' }).avances.some((x) => x.id === 'webhook'));
  const rien = M.filtrer(cat, { recherche: 'zzzz introuvable' });
  assert.deepEqual([rien.simples.length, rien.bientot.length, rien.total], [0, 0, 0]);
});

test('assistant : étapes du §4.21 (« Étape 2 sur 5 · … »), parcours, « Abandonner ? » seulement si commencé', () => {
  assert.deepEqual(M.PARCOURS.fichier?.map(([k]) => k), ['choisir', 'contenu', 'fichier', 'colonnes', 'pret']);
  assert.deepEqual(M.PARCOURS.outil?.map(([k]) => k), ['choisir', 'connexion', 'colonnes', 'pret']);
  assert.deepEqual(M.PARCOURS.fec?.map(([k]) => k), ['choisir', 'fec', 'pret']);
  assert.ok(Object.values(M.PARCOURS).every((p) => p[0]?.[0] === 'choisir'));
  assert.equal(M.progression('fichier', 'colonnes').texte, 'Étape 4 sur 5 · Associer les colonnes');
  assert.equal(M.progression('outil', 'connexion').texte, 'Étape 2 sur 4 · Se connecter');
  assert.equal(M.progression('inconnu', 'nulle').index, 0);
  assert.equal(M.parcoursDe({ genre: 'outil', id: 'hubspot' }), 'outil');
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
  assert.deepEqual(M.recommandations('excel', cat).map((x) => x.cle), ['import:coller', 'import:csv', 'outil:excel365']);
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
