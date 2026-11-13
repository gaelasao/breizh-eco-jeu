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

test('Optimiser : la section des tâches décrites est chargée et affichée entre les pistes et les automatisations', () => {
  const ecran = entre('async function rendreOptimiser() {', '// ---------------------------------------------------------------- horloge');
  assert.match(ecran, /api\('GET', '\/automatisations\/taches'\)/);
  const pistes = ecran.indexOf("'aria-labelledby': 'pistes-titre'");
  const taches = ecran.indexOf('blocTachesRepetitives(T, Pr, admin');
  const recettes = ecran.indexOf("'aria-labelledby': 'recettes-titre'");
  assert.ok(pistes > 0 && pistes < taches && taches < recettes, 'pistes détectées, puis tâches décrites, puis automatisations');
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
