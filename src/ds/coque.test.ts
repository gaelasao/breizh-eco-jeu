/**
 * Coque et navigation groupée (direction de design §4.1, §4.2, §6.1 P1) : web/navigation.js (module pur) et les
 * garde-fous de la coque dans web/app.js, web/bz/composants.css, web/style.css et web/index.html.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Entree = { id: string; vue?: string; vues?: string[]; prefixes?: string[]; libelle: string; icone: string; compte?: number; compteLibelle?: string; action?: string };
type Groupe = { id: string; libelle: string; entrees: Entree[] };
type Onglet = { id: string; libelle: string; vue?: string; courant: boolean; compte: number; compteLibelle: string; plus?: boolean };
type Nav = {
  groupesNavigation: (m: unknown, o?: { aFaire?: number; vueAujourdhui?: string }) => Groupe[];
  piedNavigation: (m: unknown) => Entree[];
  placeDeVue: (g: Groupe[], v: string) => { groupe: Groupe; entree: Entree } | null;
  estCourante: (e: Entree, v: string) => boolean;
  destinations: (g: Groupe[], p?: Entree[]) => Array<Entree & { groupe: string }>;
  ongletsTelephone: (g: Groupe[], v: string, o?: { dernieres?: Record<string, string> }) => Onglet[];
  texteCompteur: (n: number) => string;
  prenomDe: (n: string) => string;
  salutation: (n: string, d?: Date) => { texte: string; salue: boolean };
  titreDeVue: (g: Groupe[], v: string, o?: { nomProfil?: string; maintenant?: Date; departement?: string }) => string;
  sansDemo: (n: string) => string;
};
const N = (await import(new URL('../../web/navigation.js', import.meta.url).href)) as Nav;
const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const espaces = (t: string) => t.replace(/[  ]/g, ' ');

/** Un monde minimal, comme /api/v1/monde le renvoie. */
function monde({ admin = true, departements = 0, sante = true, satisfaction = true } = {}) {
  return {
    organisation: { nom: 'Kerlann Bois', demo: false, departements },
    profil: { id: 'p', nom: 'Maïwenn Le Goff — dirigeante', peutAdministrer: admin, peutPreparer: true, peutApprouver: true, voitScore: admin },
    univers: { roles: [{ id: 'client', pluriel: 'Clients' }, { id: 'fournisseur', pluriel: 'Fournisseurs' }], types: [{ id: 'employe', famille: 'personne', pluriel: 'Équipe' }] },
    objets: [
      { id: 'c1', famille: 'evenement', type: 'courrier', champs: [{ id: 'statut', valeur: 'à traiter' }, { id: 'urgence', valeur: 'haute' }] },
      { id: 'c2', famille: 'evenement', type: 'courrier', champs: [{ id: 'statut', valeur: 'traité' }, { id: 'urgence', valeur: 'haute' }] },
    ],
    situations: [],
    planning: { trousAujourdhui: 2, trous: 5 },
    sante: sante ? { score: 51, couverture: 0.8 } : null,
    optimisations: { pistes: 7 },
    satisfaction: satisfaction ? { clients: { a: { statut: 'mauvaise' }, b: { statut: 'bonne' } } } : null,
  };
}

test('rail : six groupes dans l’ordre du §6.1 (Aujourd’hui · Planning · Pilotage · Relations · Activité · Réseau)', () => {
  const g = N.groupesNavigation(monde({ departements: 4 }));
  assert.deepEqual(g.map((x) => x.id), ['aujourdhui', 'planning', 'pilotage', 'relations', 'activite', 'reseau']);
  assert.deepEqual(g.find((x) => x.id === 'pilotage')?.entrees.map((e) => e.id), ['sante', 'optimiser', 'departements']);
  assert.deepEqual(g.find((x) => x.id === 'relations')?.entrees.map((e) => e.id), ['clients', 'fournisseurs', 'courrier', 'satisfaction']);
  assert.deepEqual(g.find((x) => x.id === 'activite')?.entrees.map((e) => e.id), ['commandes', 'stock', 'vehicules', 'documents', 'lieux']);
  assert.deepEqual(g.find((x) => x.id === 'planning')?.entrees.map((e) => e.id), ['planning', 'taches', 'equipe'], 'les tâches et l’équipe se consultent dans Planning');
  // un groupe vide disparaît : sans droits d'administration ni score, pas de Réseau ; sans santé ni départements, Pilotage garde Optimiser
  const restreint = N.groupesNavigation(monde({ admin: false, sante: false }));
  assert.ok(!restreint.some((x) => x.id === 'reseau'));
  assert.deepEqual(restreint.find((x) => x.id === 'pilotage')?.entrees.map((e) => e.id), ['optimiser']);
  assert.deepEqual(N.piedNavigation(monde({ admin: false })), [], 'Connecter et Réglages : administrateurs seulement');
  assert.deepEqual(N.piedNavigation(monde()).map((e) => e.id), ['connecter', 'reglages']);
});

test('aucune route perdue : chaque vue de l’ancienne barre a sa place dans la navigation groupée', () => {
  const g = N.groupesNavigation(monde({ departements: 3 }));
  const pied = N.piedNavigation(monde());
  const anciennes = ['carte', 'matin', 'sante', 'departements', 'planning', 'courrier', 'satisfaction', 'optimiser', 'nexus',
    'role:client', 'role:fournisseur', 'famille:personne', 'famille:ressource', 'famille:commande', 'type:document', 'famille:lieu'];
  for (const v of anciennes) assert.ok(N.placeDeVue(g, v), `${v} : destination trouvée`);
  assert.equal(N.placeDeVue(g, 'dep:d-commercial')?.entree.id, 'departements', 'une fiche de département reste sous Pilotage');
  assert.ok(pied.some((e) => N.estCourante(e, 'reglages')) && pied.some((e) => N.estCourante(e, 'acces')) && pied.some((e) => N.estCourante(e, 'reglages:en-ligne')));
  const toutes = N.destinations(g, pied);
  assert.equal(new Set(toutes.map((d) => d.id)).size, toutes.length, 'chaque destination une seule fois (un seul chemin évident, P5)');
  for (const d of toutes) assert.ok(d.groupe && d.icone && d.libelle, `${d.id} : groupe, icône et libellé`);
  assert.equal(N.placeDeVue(g, 'compte'), null, 'compte et mise en route : hors des groupes (menu du compte)');
});

test('« Tâches » : une entrée du menu, avec les tâches dues pour seul compteur', () => {
  const N2 = N as unknown as {
    groupesNavigation: (m: unknown, o?: { maintenant?: Date }) => Array<{ id: string; entrees: Array<{ id: string; vue: string; libelle: string; icone: string; compte?: number; compteLibelle?: string }> }>;
    tachesOuvertes: (m: unknown) => unknown[]; tachesDues: (m: unknown, d?: Date) => number;
  };
  const jour = new Date(2026, 10, 12, 9, 0);
  const tache = (id: string, statut: string, echeance: string | null) => ({ id, famille: 'tache', type: 'tache', champs: [{ id: 'statut', valeur: statut }, { id: 'echeance', valeur: echeance }] });
  const m = monde();
  const avec = { ...m, univers: { ...m.univers, types: [...m.univers.types, { id: 'tache', famille: 'tache', pluriel: 'Tâches' }] },
    objets: [...m.objets, tache('t1', 'à faire', '2026-11-19'), tache('t2', 'en cours', '2026-11-12'), tache('t3', 'bloquée', '2026-11-08'), tache('t4', 'terminée', '2026-11-01'), tache('t5', 'à faire', null)] };
  const entree = (x: unknown) => N2.groupesNavigation(x, { maintenant: jour }).find((g) => g.id === 'planning')?.entrees.find((e) => e.id === 'taches');
  assert.deepEqual([entree(avec)?.vue, entree(avec)?.libelle, entree(avec)?.icone], ['famille:tache', 'Tâches', 'list-checks']);
  assert.equal(N2.tachesOuvertes(avec).length, 4, 'à faire, en cours, bloquée : tout sauf terminée');
  assert.equal(N2.tachesDues(avec, jour), 2, 'dues : échéance aujourd’hui ou passée');
  assert.equal(entree(avec)?.compte, 2, 'le compteur ne compte que les tâches dues, jamais le total');
  assert.match(entree(avec)?.compteLibelle ?? '', /^2\stâches à faire aujourd’hui ou en retard$/);
  // sans tâche : l'entrée existe (droits inchangés), sans compteur ; c'est la simplicité qui la retire du menu du premier jour
  assert.deepEqual([entree(m)?.libelle, entree(m)?.compte, entree(m)?.compteLibelle], ['Tâches', 0, '']);
  assert.equal(N.placeDeVue(N.groupesNavigation(m), 'famille:tache')?.entree.id, 'taches', 'l’écran des tâches a sa place dans le menu');
});

test('compteurs (§4.2) : seulement des actions dues, jamais un total, un score ni une promotion', () => {
  const g = N.groupesNavigation(monde({ departements: 2 }), { aFaire: 3 });
  const comptes = Object.fromEntries(g.flatMap((x) => x.entrees).filter((e) => e.compte).map((e) => [e.id, e.compte]));
  assert.deepEqual(comptes, { aujourdhui: 3, planning: 2, courrier: 1, satisfaction: 1 });
  const aujourdhui = g[0]?.entrees[0];
  assert.equal(espaces(aujourdhui?.compteLibelle ?? ''), '3 actions à faire', 'le nombre est lu avec son sens');
  assert.equal(espaces(N.groupesNavigation(monde(), { aFaire: 1 })[0]?.entrees[0]?.compteLibelle ?? ''), '1 action à faire', 'singulier');
  assert.equal(N.texteCompteur(7), '7');
  assert.equal(N.texteCompteur(140), '99+');
});

test('téléphone : 5 onglets de même rang, « Plus » en dernier, groupe courant et dernière vue visitée', () => {
  const g = N.groupesNavigation(monde({ departements: 2 }), { aFaire: 4, vueAujourdhui: 'carte' });
  const o = N.ongletsTelephone(g, 'carte');
  assert.deepEqual(o.map((x) => x.id), ['aujourdhui', 'planning', 'relations', 'activite', 'plus']);
  assert.deepEqual(o.map((x) => x.libelle), ['Aujourd’hui', 'Planning', 'Relations', 'Activité', 'Plus']);
  assert.ok(o[0]?.courant && !o[4]?.courant);
  assert.equal(o[0]?.compte, 4);
  assert.equal(o[2]?.compte, 2, 'Relations : courrier urgent + client mécontent');
  assert.ok(N.ongletsTelephone(g, 'courrier')[2]?.courant, 'Courrier est dans Relations');
  assert.ok(N.ongletsTelephone(g, 'sante')[4]?.courant, 'Pilotage et Réseau passent par « Plus »');
  assert.ok(N.ongletsTelephone(g, 'reglages')[4]?.courant);
  assert.equal(N.ongletsTelephone(g, 'carte', { dernieres: { relations: 'courrier' } })[2]?.vue, 'courrier', 'Relations rouvre la dernière vue du groupe');
  assert.equal(N.ongletsTelephone(g, 'carte', { dernieres: { relations: 'nexus' } })[2]?.vue, 'role:client', 'une vue étrangère au groupe est ignorée');
  assert.equal(N.ongletsTelephone(g, 'matin')[0]?.courant, true, 'Aujourd’hui en liste reste sous l’onglet Aujourd’hui');
});

test('salutation dans l’en-tête : « Bonjour Maïwenn » jusqu’à 11 h, « Aujourd’hui » ensuite ; titres des vues', () => {
  assert.equal(N.prenomDe('Maïwenn Le Goff — dirigeante'), 'Maïwenn');
  assert.equal(N.prenomDe('Anna — dirigeante'), 'Anna');
  assert.equal(N.prenomDe('compta@kerlann.example'), '');
  assert.deepEqual(N.salutation('Anna — dirigeante', new Date(2026, 10, 10, 8, 30)), { texte: 'Bonjour Anna', salue: true });
  assert.deepEqual(N.salutation('Anna — dirigeante', new Date(2026, 10, 10, 11, 0)), { texte: 'Aujourd’hui', salue: false });
  assert.equal(N.salutation('', new Date(2026, 10, 10, 7)).texte, 'Bonjour');
  const g = N.groupesNavigation(monde({ departements: 2 }));
  const apres = new Date(2026, 10, 10, 15);
  assert.equal(N.titreDeVue(g, 'carte', { maintenant: apres }), 'Aujourd’hui');
  assert.equal(N.titreDeVue(g, 'courrier', { maintenant: apres }), 'Courrier');
  assert.equal(N.titreDeVue(g, 'reglages:en-ligne'), 'Réglages');
  assert.equal(N.titreDeVue(g, 'dep:x', { departement: 'Commercial (démo)' }), 'Commercial');
  assert.equal(N.sansDemo('Boulangerie Exemple (fictive)'), 'Boulangerie Exemple');
});

test('coque : repères, en-tête, rail, onglets, zones sûres et clavier virtuel dans le CSS du système', () => {
  const css = lire('web/bz/composants.css');
  assert.match(css, /\.bz-rail__lien\[aria-current="page"\] \{[^}]*border-color: var\(--bz-etat-indicateur\)/, 'l’entrée courante du rail est bordée (la teinte seule ne suffit pas)');
  assert.match(css, /\.bz-onglets-bas__lien\[aria-current="page"\] \.bz-onglets-bas__pilule \{[^}]*border-color: var\(--bz-etat-indicateur\)/, 'pilule bordée');
  assert.match(css, /:root\[data-clavier="ouvert"\] \.bz-onglets-bas \{ display: none; \}/, 'barre masquée clavier ouvert');
  assert.match(css, /\.bz-onglets-bas \{[^}]*var\(--bz-sa-bas\)/, 'barre d’onglets au-dessus de la zone sûre basse');
  assert.match(css, /\.bz-entete \{[^}]*var\(--bz-sa-haut\)/, 'en-tête sous la zone sûre haute');
  assert.match(css, /\.bz-rail \{[^}]*var\(--bz-sa-gauche\)/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/, '5 onglets de même largeur');
  assert.match(css, /\.bz-coque \{[^}]*block-size: 100dvh/, 'hauteur en dvh, jamais 100vh');
  assert.match(css, /:root\[data-coque\]:not\(\[data-clavier="ouvert"\]\) \.bz-toasts \{ inset-block-end: calc\(var\(--bz-h-onglets\) \+ var\(--bz-pied-bas\)/, 'toasts au-dessus de la barre d’onglets');
  assert.match(lire('web/index.html'), /viewport-fit=cover, interactive-widget=resizes-content/);
  const app = lire('web/app.js');
  for (const r of [/h\('nav', \{ class: 'bz-rail', id: 'rail', 'aria-label': 'Navigation principale' \}\)/, /h\('header', \{ class: 'bz-entete'/, /h\('main', \{ class: 'zone', id: 'zone'/,
    /h\('aside', \{ class: 'bz-fiche', id: 'fiche'/, /h\('nav', \{ class: 'bz-onglets-bas', id: 'onglets', 'aria-label': 'Navigation principale' \}\)/]) assert.match(app, r);
  assert.match(app, /raccourci\('b', \(\) => basculerRail\(\)/, 'B replie le rail');
  assert.match(app, /ouvrirPalette\(\{ places: placesPlus\(\) \}\)/, '« Plus » ouvre la palette en feuille, avec ses places fixes');
  const places = app.slice(app.indexOf('function placesPlus()'), app.indexOf('const ouvrirPlus'));
  // d'abord les rubriques sans onglet en bas (Santé, Optimiser, Breizhcosystem, Connecter mes données, Réglages,
  // Mon compte) : sur téléphone, « Plus » est le seul chemin vers elles
  assert.match(places, /const avecOnglet = new Set\(ONGLETS_TELEPHONE\.filter\(\(o\) => !o\.plus\)\.map\(\(o\) => o\.id\)\);/);
  assert.match(places, /const ailleurs = menuMontre\(\)\.filter\(\(g\) => !avecOnglet\.has\(g\.id\)\)\.flatMap\(\(g\) => g\.entrees\);/);
  const ordre = ['...ailleurs.map(', '...piedMenu().map(', "id: 'compte'", "id: 'activite'", "id: 'aide'", "id: 'apparence'", "id: 'plein-soleil'", "id: 'tout-afficher'"].map((t) => places.indexOf(t));
  assert.ok(ordre.every((i, k) => i > 0 && (k === 0 || i > (ordre[k - 1] ?? 0))), 'destinations d’abord, puis les outils de l’appareil');
  // les réglages de thème ne sont plus répétés dans la liste des actions de la feuille
  for (const t of ["plus ? null : { id: `action:theme-", "plus ? null : { id: 'action:theme-systeme'", "plus ? null : { id: 'action:calme'", "plus ? null : { id: 'action:apparence'"]) assert.ok(app.includes(t), t);
});

test('rail : le pied (Tout afficher, Connecter mes données, Réglages) reste à l’écran, seuls les groupes défilent', () => {
  const css = lire('web/bz/composants.css');
  const regle = (selecteur: string) => css.match(new RegExp(`\\n  ${selecteur.replace(/[.]/g, '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
  // le rail ne défile plus d'un bloc : avec le menu complet à 1440 × 900, « Réglages » passait sous l'écran
  assert.match(regle('.bz-rail'), /overflow: hidden/);
  assert.doesNotMatch(regle('.bz-rail'), /overflow-y: auto/);
  assert.match(regle('.bz-rail__groupes'), /flex: 1 1 auto; min-block-size: 0; overflow-y: auto/, 'les groupes prennent la place restante et défilent');
  assert.match(regle('.bz-rail__groupes'), /padding: var\(--bz-e-2\); margin: calc\(-1 \* var\(--bz-e-2\)\)/, 'l’anneau de focus n’est pas rogné par la zone qui défile');
  assert.match(regle('.bz-rail__produit'), /flex: none/);
  assert.match(regle('.bz-rail__pied'), /flex: none/, 'le pied ne rétrécit pas et ne défile pas');
  // dans le dessin : produit, groupes, pied, dans cet ordre ; la liste redessinée retrouve sa position
  const rail = lire('web/app.js');
  const dessin = rail.slice(rail.indexOf('function rendreRail()'), rail.indexOf('function basculerRail()'));
  const ordre = ["class: 'bz-rail__produit'", "class: 'bz-rail__groupes'", "class: 'bz-rail__pied'"].map((c) => dessin.indexOf(c));
  assert.ok(ordre.every((i, k) => i > 0 && (k === 0 || i > (ordre[k - 1] ?? 0))), 'produit, groupes, pied');
  assert.ok(dessin.indexOf("class: 'bz-rail__pied'") < dessin.indexOf('piedMenu().map('), 'Connecter mes données et Réglages sont dans le pied');
  assert.match(dessin, /const defile = n\.querySelector\('\.bz-rail__groupes'\)\?\.scrollTop \?\? 0;/);
  assert.match(dessin, /liste\.scrollTop = defile;/);
});

test('coque : plus de mot « CE MATIN », de visite lancée d’office, ni de position magique dans le HUD', () => {
  const app = lire('web/app.js');
  assert.doesNotMatch(app, /'CE MATIN'|▾ CE MATIN/, '« Ce matin » remplacé par « Aujourd’hui »');
  assert.doesNotMatch(app, /setTimeout\(\(\) => demarrerVisite\(false\)/, 'la visite n’est plus lancée au bout de 900 ms (§4.20)');
  assert.doesNotMatch(app, /'＋ Connecter mes données'|texte: '⌕ Chercher'|'⚙ Réglages'/, 'plus de symboles servant d’icônes dans la coque');
  const style = lire('web/style.css');
  assert.doesNotMatch(style, /left: 330px|calc\(100% - 392px\)|top: 72px/, 'HUD en grille à zones (§5.6)');
  assert.doesNotMatch(style, /\.toast \{ position: fixed; top: 66px/, 'ancien toast en haut supprimé');
  assert.match(style, /grid-template-areas: "haut-gauche haut haut-droite" "haut-gauche \. haut-droite" "bas-gauche bas bas"/, 'HUD en zones nommées (§5.6)');
  // les règles d'éléments de l'ancien CSS ne passent plus devant les composants bz-*
  const horsCouche = style.replace(/@layer bz\.base \{[\s\S]*?\n\}\n/, '');
  assert.doesNotMatch(horsCouche, /^button, input, select, textarea \{/m, 'button { font: inherit } dans la couche bz.base');
  assert.doesNotMatch(horsCouche, /^h1, h2, h3 \{/m);
  assert.match(style, /@layer bz\.base \{\n\* \{ box-sizing: border-box; \}/);
});

test('fenêtre étroite (1 024 px) : la date s’efface avant que le titre ne soit coupé', () => {
  const css = lire('web/bz/composants.css');
  // la date ne prend plus la place du titre : elle ne grandit pas, et n'apparaît qu'à partir de 75 em
  assert.match(css, /\.bz-entete__date \{ display: none; flex: 0 1 auto;/);
  assert.match(css, /@media \(min-width: 75em\) \{ \.bz-entete__date \{ display: block; \} \}/);
  assert.match(css, /@media \(min-width: 48em\) and \(max-width: 74\.99em\) \{ \.bz-coque\[data-rail="replie"\] \.bz-entete__date \{ display: block; \} \}/, 'le menu replié rend la place : la date revient');
  // et la recherche se resserre avant le titre
  assert.match(css, /@media \(min-width: 48em\) and \(max-width: 74\.99em\) \{ \.bz-entete__recherche \{ flex: 0 1 14rem; \} \}/);
  assert.match(css, /\.bz-entete__titre \{ flex: 1 1 auto;/, 'le titre prend la place restante');
});

test('fenêtre étroite (1 024 px) : menu replié d’office, fiche par-dessus la liste, barre de carte dégagée (G11)', () => {
  const app = lire('web/app.js');
  const css = lire('web/bz/composants.css');
  // menu : tant que personne n'a choisi, il suit la largeur (replié de 960 à 1 200 px)
  assert.match(app, /railReplie: lireLocal\('lb-rail'\) === 'replie' \? true : lireLocal\('lb-rail'\) === 'ouvert' \? false : null,/);
  assert.match(app, /const ecranEtroit = \(\) => matchMedia\('\(min-width: 60em\) and \(max-width: 74\.99em\)'\)\.matches;/);
  assert.match(app, /const railEffectif = \(\) => !estOrdinateur\(\) \|\| \(E\.railReplie \?\? ecranEtroit\(\)\);/);
  assert.match(app, /E\.railReplie = !railEffectif\(\);/, 'le premier clic part de ce qui est à l’écran');
  assert.doesNotMatch(app, /texte: E\.railReplie \? 'Déplier le menu'/, 'le libellé du bouton dit l’état réel');
  assert.match(app, /for \(const q of \[[^\]]*'\(min-width: 75em\)'/, 'le menu suit un changement de largeur');
  // fiche : par-dessus la liste sous 1 100 px (68,75 em), côte à côte au-delà
  assert.match(css, /@media \(min-width: 68\.75em\) \{\s*\.bz-coque__contenu\[data-fiche\] \{ grid-template-columns:/);
  assert.doesNotMatch(css, /@media \(min-width: 60em\) \{\s*\.bz-coque__contenu\[data-fiche\]/);
  // barre de la carte : « Connecter mes données » et le plan du port s'effacent quand la carte est à l'étroit
  assert.match(app, /const carteEtroite = \(\) => !matchMedia\('\(min-width: 68\.75em\)'\)\.matches \|\| Boolean\(E\.selection\);/);
  assert.match(app, /const connecter = sansSourceReelle\(\) && !carteEtroite\(\) \?/);
  assert.match(app, /\(E\.miniCarte \?\? !carteEtroite\(\)\) \? miniCarte\(\{ repliable: true \}\)/);
  assert.match(app, /miniCarte: lireLocal\('lb-minicarte'\) === 'repliee' \? false : lireLocal\('lb-minicarte'\) === 'ouverte' \? true : null,/);
});
