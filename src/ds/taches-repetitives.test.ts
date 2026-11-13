/**
 * Écran Optimiser, tâches répétitives déclarées : garde-fous sur web/app.js (lu comme un texte, sans navigateur).
 * L'écran ne recalcule rien (verdict, raison et calculs viennent du serveur), pose une question à la fois, montre le
 * résultat avant d'enregistrer, et ne propose les écritures qu'aux administrateurs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CAS_PARTICULIERS, GRAVITES, MEME_FACON, PERIODES, UNITES_AUTOMATISER, UNITES_TEMPS } from '../core/taches-repetitives.ts';

const app = readFileSync(fileURLToPath(new URL('../../web/app.js', import.meta.url)), 'utf8');
const entre = (debut: string, fin: string) => app.slice(app.indexOf(debut), app.indexOf(fin));
const bloc = entre('// ---------------------------------------------------------------- optimiser : tâches répétitives déclarées', 'async function rendreOptimiser() {');

test('Optimiser : les tâches décrites par une personne ont leur onglet, « Mes tâches à moi »', () => {
  const ecran = entre('async function rendreOptimiser() {', '// ---------------------------------------------------------------- horloge');
  assert.match(ecran, /api\('GET', '\/automatisations\/taches'\)/);
  assert.match(ecran, /\{ id: 'taches', libelle: 'Mes tâches à moi'/);
  assert.match(ecran, /onglet === 'automatisations' \? \[/, 'un onglet ou l’autre, jamais les deux listes à la suite');
  assert.match(ecran, /\] : blocTachesRepetitives\(T, Pr, admin, \{ basculer, apres: \(\) => rendreOptimiser\(\) \}\)/);
  // le choix de l'onglet tient d'une visite à l'autre
  assert.match(ecran, /E\.optimiserOnglet \?\?= lireLocal\('lb-optimiser-onglet'\);/);
  assert.match(ecran, /ecrireLocal\('lb-optimiser-onglet', id\)/);
});

test('tâches décrites : l’écran ne recalcule rien, le verdict vient du serveur avec sa raison et ses calculs', () => {
  assert.ok(bloc.length > 5000);
  assert.doesNotMatch(bloc, /\b228\s*\*|\b45[.,]6\s*\*|52[.,]18|\*\s*11\b/, 'aucun calcul de temps de travail côté écran');
  for (const champ of ['c.libelle', 'c.raison', 'c.explications.temps', 'c.explications.rentabilite', 'c.explications.euros', 'c.explications.horizon', 'c.tempsAn', 'c.delai', 'c.tempsHorizon', 'c.aVerifier']) assert.ok(bloc.includes(champ), champ);
  assert.match(bloc, /api\('POST', '\/automatisations\/taches\/estimation', declaration\(\)\)/, 'résultat estimé avant d’enregistrer');
  assert.match(bloc, /api\('PUT', `\/automatisations\/taches\/\$\{tache\.id\}`, declaration\(\)\) : await api\('POST', '\/automatisations\/taches', declaration\(\)\)/);
  assert.match(bloc, /api\('DELETE', `\/automatisations\/taches\/\$\{t\.id\}`\)/);
  assert.match(bloc, /confirmerDialogue\(\{ titre: `Supprimer « \$\{t\.nom\} » \?`/, 'suppression confirmée dans un dialogue');
});

test('tâches décrites : une question à la fois, avec les réponses que le serveur accepte ; écritures réservées aux administrateurs', () => {
  const questions = /const QUESTIONS_TACHE = \[([^\]]+)\]/.exec(bloc)?.[1]?.match(/'[^']+'/g)?.map((q) => q.slice(1, -1));
  assert.deepEqual(questions, ['nom', 'qui', 'temps', 'fois', 'recette', 'automatiser', 'memeFacon', 'casParticuliers', 'graviteErreur']);
  assert.match(bloc, /`Question \$\{S\.etape \+ 1\} sur \$\{nb\}`/);
  const valeurs = (cle: string) => [...(new RegExp(`${cle}: \\[(.*)\\],?\\n`).exec(bloc)?.[1] ?? '').matchAll(/\['([a-z_]+)', '/g)].map((m) => m[1]);
  assert.deepEqual(valeurs('memeFacon'), [...MEME_FACON]);
  assert.deepEqual(valeurs('casParticuliers'), [...CAS_PARTICULIERS]);
  assert.deepEqual(valeurs('graviteErreur'), [...GRAVITES]);
  for (const u of [...UNITES_TEMPS, ...UNITES_AUTOMATISER, ...PERIODES]) assert.ok(bloc.includes(`['${u}', '`), `choix « ${u} » proposé`);
  // boutons d'écriture : seulement pour un administrateur
  assert.match(bloc, /const decrire = admin && !pleine \? h\('button'/);
  assert.match(bloc, /admin \? h\('div', \{ class: 'bz-groupe-boutons' \},\n\s+h\('button', \{ type: 'button', class: 'bz-bouton bz-bouton--secondaire', cle: `tache-modifier-/);
  assert.match(bloc, /\? h\('button', \{ type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: \(\) => basculer\(a\.id, true\) \}/, '« Mettre en marche » pour un administrateur');
  assert.match(bloc, /À mettre en marche par la direction\./);
  // une vue, un bouton principal : aucun de plus sur la page ; dans le dialogue, seulement la validation
  const principaux = bloc.split('\n').filter((l) => l.includes('bz-bouton--principal'));
  assert.equal(principaux.length, 2);
  for (const l of principaux) assert.ok(l.includes("type: 'submit'"), l.trim().slice(0, 80));
});

test('tâches décrites : ce qu’il reste à faire est dit, avec ou sans automatisation existante', () => {
  for (const phrase of ['fait déjà cette tâche : elle est en marche.', 'fait déjà cette tâche : elle est prête, il reste à la mettre en marche.', 'sait faire cette tâche, mais il lui manque des données.',
    'Aucune automatisation de Living Business ne fait cette tâche.', 'Cette tâche ne peut pas encore être automatisée d’ici.', 'Make, Zapier ou n8n', 'événements signés', 'Celle-ci le fait déjà']) assert.ok(bloc.includes(phrase), phrase);
  assert.match(bloc, /Aucune tâche décrite pour l’instant\./, 'état vide');
  assert.match(bloc, /Des idées pour commencer/);
});

test('Optimiser : une seule liste, trois états, un seul mot — et « Tout automatiser » enchaîne', () => {
  const ecran = entre('// ---------------------------------------------------------------- optimiser : ce qui peut être automatisé', '// ---------------------------------------------------------------- horloge');
  // les trois états, écrits une fois pour toutes
  const etats = ecran.slice(ecran.indexOf('const ETAT_AUTOMATISATION'), ecran.indexOf('automatisationsUnifiees'));
  assert.deepEqual(etats.match(/libelle: '[^']+'/g), ["libelle: 'En marche'", "libelle: 'Prête'", "libelle: 'Il manque des données'"]);
  assert.match(ecran, /const etat = x\.etat === 'a_brancher' && x\.manque \? `Il manque : \$\{x\.manque\}` : e\.libelle;/);
  // une seule liste : l'état vient de la préparation, le « pourquoi » de la piste, les déclenchements du compteur
  assert.match(ecran, /function automatisationsUnifiees\(O, A, Pr\)/);
  assert.match(ecran, /return Pr\.recettes\.map\(\(r\) => \{/, 'une ligne par automatisation, jamais une par piste');
  assert.match(ecran, /ETAT_AUTOMATISATION\[a\.etat\]\.rang - ETAT_AUTOMATISATION\[b\.etat\]\.rang \|\| b\.heuresMois - a\.heuresMois/, 'à mettre en marche d’abord, puis le plus gros gain');
  // le vocabulaire : plus de « piste » à l'écran, plus de tableau d'automatisations en double
  assert.doesNotMatch(ecran, /texte: 'Pistes/);
  assert.doesNotMatch(ecran, /'aria-labelledby': 'recettes-titre'/);
  assert.doesNotMatch(ecran, /pistes automatisable/, 'le compteur qui ne se recoupait pas a disparu');
  assert.doesNotMatch(ecran, /Pistes déjà automatisées/);
  // ce qui n'est pas une automatisation est dit à part, replié
  assert.match(ecran, /function autresGains\(O, admin\)/);
  assert.match(ecran, /const restes = O\.opportunites\.filter\(\(o\) => !o\.recette\);/);
  assert.match(ecran, /texte: 'À faire vous-même, une fois'/);
  // la page se lit sans se perdre : le « pourquoi » de chaque ligne et le réglage du calcul sont repliés
  assert.match(ecran, /h\('summary', \{\}, h\('span', \{ class: 'bz-repli__titre', texte: 'Pourquoi' \}\)/);
  assert.match(ecran, /texte: 'Régler le calcul'/);
  // « Tout automatiser » reboucle tant que de nouvelles automatisations deviennent prêtes
  assert.match(ecran, /for \(let tour = 0; tour < 5; tour\+\+\) \{/);
  assert.match(ecran, /if \(!\(await api\('GET', '\/automatisations\/preparation'\)\)\.recettes\.some\(\(x\) => x\.etat === 'prete'\)\) break;/);
});
