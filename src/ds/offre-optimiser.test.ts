/**
 * Écran Optimiser, le verrou à l'écran : garde-fous sur web/app.js (lu comme un texte, sans navigateur).
 * Une automatisation réservée reste DANS la liste, avec son gain chiffré et son motif ; elle ne propose pas de bouton
 * « Mettre en marche » ; « Tout automatiser » dit en une phrase ce qui reste. Le nom de l'offre est le même côté
 * serveur et côté écran. Le partage lui-même : ../core/offre.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { OFFRE } from '../core/offre.ts';

const app = readFileSync(fileURLToPath(new URL('../../web/app.js', import.meta.url)), 'utf8');
const entre = (debut: string, fin: string) => app.slice(app.indexOf(debut), app.indexOf(fin));
const ecran = entre('// ---------------------------------------------------------------- optimiser : ce qui peut être automatisé', '// ---------------------------------------------------------------- horloge');

test('le nom de l’offre est écrit une fois de chaque côté, et les deux disent la même chose', () => {
  assert.match(app, /^const OFFRE_ACTIVE = 'Breizhcosystem ACTIVE';$/m);
  assert.equal(/^const OFFRE_ACTIVE = '([^']+)';$/m.exec(app)?.[1], OFFRE, 'l’écran et le serveur nomment l’offre pareil');
  // « nexus » ne subsiste que comme identifiant technique (la vue du réseau, son icône) : jamais dans un texte lu
  const restes = [...ecran.matchAll(/.{0,14}nexus.{0,4}/gi)].map((m) => m[0]);
  assert.deepEqual(restes.filter((r) => !/changerVue\('nexus'\)|icone\('bz-nexus'/.test(r)), []);
  assert.ok(restes.length > 0, 'la ligne réservée mène bien au réseau');
});

test('une automatisation réservée reste dans la même liste, sous celles qui sont à portée', () => {
  // une seule liste : la réservée n'est pas sortie dans une section à part, elle est juste rangée après
  assert.match(ecran, /\.sort\(\(a, b\) => Number\(a\.verrouillee\) - Number\(b\.verrouillee\) \|\| ETAT_AUTOMATISATION\[a\.etat\]\.rang/);
  assert.match(ecran, /const v = x\.verrouillee \? VERROU : null;/);
  assert.match(ecran, /const VERROU = Object\.freeze\(\{ ton: 'info', icone: 'lock', texte: `Avec \$\{OFFRE_ACTIVE\}` \}\);/);
  // l'état des trois cas connus n'a pas changé : le verrou s'ajoute, il ne remplace rien
  const etats = ecran.slice(ecran.indexOf('const ETAT_AUTOMATISATION'), ecran.indexOf('automatisationsUnifiees'));
  assert.deepEqual(etats.match(/libelle: '[^']+'/g), ["libelle: 'En marche'", "libelle: 'Prête'", "libelle: 'Il manque des données'"]);
});

test('réservée : son gain chiffré sur les données de l’entreprise, et son motif sans dépli', () => {
  const ligne = entre('function ligneAutomatisation(', '/** Ce qu’aucune automatisation ne fait');
  // le gain se lit sur la même ligne que le verrou, dans les mêmes termes que partout ailleurs
  assert.match(ligne, /const gain = x\.heuresMois \? `\$\{nf\.format\(x\.heuresMois\)\} h par mois\$\{x\.euroMois \? ` · \$\{nfEuro\.format\(x\.euroMois\)\}` : ''\}, estimé` : null;/);
  assert.match(ligne, /const tete = v \? v\.texte : etat;/);
  assert.match(ligne, /h\('strong', \{ texte: tete \}\), gain \?/, 'le verrou d’abord, le gain juste après');
  // le motif est visible sans rien déplier — une fois par raison, pas huit fois de suite — et jamais perdu ensuite
  assert.match(ecran, /const motifUneFois = \(\) => \{/);
  assert.match(ecran, /const direMotif = x\.verrouillee && !!x\.motif && !dits\.has\(x\.motif\);/);
  assert.match(ligne, /v && x\.motif && x\.direMotif \? h\('p', \{ class: 'bz-action__preuve', texte: x\.motif \}\) : null,/);
  assert.match(ligne, /v && x\.motif && !x\.direMotif \? h\('p', \{ class: 'bz-t-petit', texte: x\.motif \}\) : null,/);
  assert.match(ligne, /Living Business ne voit pas encore \$\{x\.manque\}\.` : 'Les données qu’elle regarde sont déjà là\.'/);
  // aucun geste qui échouerait : pas de « Mettre en marche », un chemin vers le réseau pour en savoir plus
  assert.match(ligne, /admin && x\.etat === 'prete' && !v \? h\('button'/, '« Mettre en marche » jamais proposé sur une réservée');
  assert.match(ligne, /admin && v \? h\('button'[^\n]*'Voir Breizhcosystem'\) : null,/);
  assert.match(ligne, /x\.etat === 'prete' && !v \? 'À mettre en marche par la direction\.' : ''/);
});

test('« Tout automatiser » : ce qui reste est dit en une phrase, avec son gain, et chaque automatisation dans un seul groupe', () => {
  assert.match(ecran, /function phraseReservees\(Pr\) \{/);
  assert.match(ecran, /if \(!Pr\.reservees\) return null;/);
  assert.match(ecran, /automatisation reste comprise', 'automatisations restent comprises'\)\} dans \$\{OFFRE_ACTIVE\}/);
  assert.match(ecran, /nf\.format\(Pr\.heuresMoisReservees\)\} h par mois\$\{Pr\.euroMoisReservees/, 'la phrase porte le gain, calculé sur les données réelles');
  // le bloc de tête et le dialogue filtrent les réservées hors de « prêtes » et de « il manque des données »
  for (const bloc of ['function blocAutomatiser(', 'function ouvrirToutAutomatiser(']) {
    const t = app.slice(app.indexOf(bloc), app.indexOf(bloc) + 900);
    assert.match(t, /r\.etat === 'prete' && !r\.verrouillee/, bloc);
    assert.match(t, /r\.etat === 'a_brancher' && !r\.verrouillee/, bloc);
  }
  assert.match(ecran, /const reservees = Pr\.recettes\.filter\(\(r\) => r\.verrouillee\)\.map\(motifUneFois\(\)\);/);
  assert.match(ecran, /groupe\(`Comprises dans \$\{OFFRE_ACTIVE\}`, reservees,/);
  assert.match(ecran, /\$\{r\.direMotif \? ` \$\{r\.motif\}` : ''\}`\.trim\(\)\)/, 'le dialogue aussi dit le motif une fois par raison');
  // après le geste, le même message dit ce qui a été allumé et ce qui reste
  assert.match(ecran, /const reste = phraseReservees\(Pr\);/);
  assert.match(ecran, /\$\{reste \? ` \$\{reste\}` : ''\}`, 'ok',/);
  // le compteur de tête ne range pas une réservée parmi les prêtes
  const liste = entre('async function rendreOptimiser()', '// ---------------------------------------------------------------- horloge');
  assert.match(liste, /const compte = \(etat\) => liste\.filter\(\(x\) => x\.etat === etat && !x\.verrouillee\)\.length;/);
  assert.match(liste, /Pr\.reservees \? ` · \$\{pluriel\(Pr\.reservees, `comprise dans \$\{OFFRE_ACTIVE\}`/);
});

test('les tâches décrites : une automatisation réservée est annoncée comme telle, jamais promise puis refusée', () => {
  const bloc = entre('// ---------------------------------------------------------------- optimiser : tâches répétitives déclarées', 'async function rendreOptimiser() {');
  assert.match(bloc, /if \(a\.verrouillee\) return resultatAssistant\('info', `« \$\{a\.nom\} » fait cette tâche, avec \$\{OFFRE_ACTIVE\}\.`/);
  assert.match(bloc, /r\.verrouillee \? `Elle est comprise dans \$\{OFFRE_ACTIVE\}`/);
});

test('le verrou ne culpabilise pas : aucune perte annoncée, aucun point d’exclamation dans l’écran Optimiser', () => {
  const textes = [...ecran.matchAll(/texte: '((?:[^'\\]|\\.)*)'|texte: `((?:[^`\\]|\\.)*)`/g)].map((m) => m[1] ?? m[2] ?? '');
  assert.ok(textes.length > 10, `textes relus : ${textes.length}`);
  for (const t of textes) {
    assert.doesNotMatch(t, /vous perdez|perte|manque à gagner|dommage|profitez|dépêchez|offre spéciale|!/i, `« ${t} »`);
  }
});
