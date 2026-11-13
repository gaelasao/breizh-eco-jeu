/**
 * Réglages › « Mon fichier de suivi » : module pur `web/suivi.js` (que montrer, et comment le dire simplement),
 * et sa page dans `web/app.js`. Rien de technique n'est montré à la personne : une phrase, un bouton, une adresse
 * cliquable, ce qui est suivi, l'état du dernier envoi.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const S = (await import(new URL('../../web/suivi.js', import.meta.url).href)) as {
  TITRE: string; PROMESSE: string; TEXTE_REECRIRE: string; TEXTE_DETACHER: string; TEXTE_SUPPRESSION: string;
  GROUPES: Array<{ id: string; libelle: string }>;
  groupesTypes: (t: unknown[]) => Array<{ id: string; libelle: string; types: Array<{ id: string }> }>;
  resumeSuivis: (t: unknown[]) => string;
  etatEnvoi: (v: unknown) => { ton: string; texte: string };
  propositionLisible: (p: unknown) => { phrase: string; bouton: string } | null;
  autresComptes: (v: unknown) => Array<{ id: string }>;
  lienClasseur: (c: unknown) => string | null;
};

const types = [
  { id: 'entreprise', libelle: 'Entreprises', famille: 'tiers', suivi: true, onglet: 'Entreprises', lignes: 3 },
  { id: 'tache', libelle: 'Tâches', famille: 'tache', suivi: false, onglet: 'Tâches', lignes: 0 },
  { id: 'employe', libelle: 'Employés', famille: 'personne', suivi: true, onglet: 'Équipe', lignes: 2 },
  { id: 'bizarre', libelle: 'Bizarres', famille: 'inconnue', suivi: true, onglet: null, lignes: 0 },
];

test('types rangés par groupes lisibles, dans l’ordre de la page, sans groupe vide', () => {
  const g = S.groupesTypes(types);
  assert.deepEqual(g.map((x) => x.id), ['tiers', 'tache', 'personne', 'autres'], 'l’ordre est celui de GROUPES, puis « Autres »');
  assert.equal(g[0]?.libelle, 'Clients, fournisseurs et partenaires', 'pas de jargon : « tiers » ne s’affiche jamais');
  assert.deepEqual(g[1]?.types.map((t) => t.id), ['tache']);
  assert.deepEqual(S.groupesTypes([]), [], 'aucun groupe vide');
  for (const x of S.GROUPES) assert.ok(x.libelle && x.libelle[0] === x.libelle[0]?.toUpperCase(), 'casse de phrase');
});

test('résumé de ce qui est suivi : par défaut tout l’est, la personne n’a rien à régler', () => {
  assert.match(S.resumeSuivis(types.map((t) => ({ ...t, suivi: true }))), /Tout est suivi/);
  assert.match(S.resumeSuivis(types), /3 sortes de fiches suivies sur 4/);
  assert.match(S.resumeSuivis([]), /Rien à suivre/);
});

test('état du dernier envoi : jamais « erreur » seule, toujours ce que le jeu fait ensuite', () => {
  assert.equal(S.etatEnvoi({}).ton, 'info');
  const classeur = { outil: 'sheets', url: 'https://docs.google.com/spreadsheets/d/x/edit' };
  assert.match(S.etatEnvoi({ classeur, attente: 0, dernier: null }).texte, /prêt/);
  assert.deepEqual(S.etatEnvoi({ classeur, attente: 0, dernier: { ok: true } }), { ton: 'ok', texte: 'Tout est à jour dans votre fichier de suivi.' });
  const enAttente = S.etatEnvoi({ classeur, attente: 3, dernier: { ok: false, message: 'Service injoignable.' } });
  assert.equal(enAttente.ton, 'attention');
  assert.match(enAttente.texte, /3 envois attendent/);
  assert.match(enAttente.texte, /Rien n’est perdu, rien n’est bloqué/);
  assert.match(S.etatEnvoi({ classeur, attente: 1, dernier: null }).texte, /Un envoi attend/, 'pas de « 1 envois »');
  assert.match(S.etatEnvoi({ classeur, attente: 0, dernier: { ok: false, message: 'Droits retirés.' } }).texte, /réessaie tout seul/);
});

test('proposition : une phrase, un bouton, et les autres comptes à part', () => {
  const p = S.propositionLisible({ compte: 'cx-1', outil: 'sheets', chez: 'mon Google Drive', phrase: 'Tout ce que vous créez ici peut s’écrire aussi dans un fichier de suivi, chez vous, dans mon Google Drive.', bouton: 'Créer mon fichier de suivi dans mon Google Drive' });
  assert.ok(p);
  assert.match(p.bouton, /^Créer mon fichier de suivi/);
  assert.ok(!/API|OAuth|jeton|synchro/i.test(`${p.phrase} ${p.bouton}`), 'aucun mot technique');
  assert.equal(S.propositionLisible(null), null);
  const v = { proposition: { compte: 'cx-1' }, comptes: [{ id: 'cx-1' }, { id: 'cx-2' }] };
  assert.deepEqual(S.autresComptes(v).map((c) => c.id), ['cx-2'], 'le compte retenu n’est pas proposé deux fois');
  assert.deepEqual(S.autresComptes({}), []);
});

test('adresse du classeur : seulement celle de l’outil, en https', () => {
  assert.equal(S.lienClasseur({ url: 'https://docs.google.com/spreadsheets/d/abc/edit' }), 'https://docs.google.com/spreadsheets/d/abc/edit');
  assert.equal(S.lienClasseur({ url: 'https://www.notion.so/' + 'a'.repeat(32) }), 'https://www.notion.so/' + 'a'.repeat(32));
  assert.equal(S.lienClasseur({ url: 'https://airtable.com/app00000000000000' }), 'https://airtable.com/app00000000000000');
  assert.equal(S.lienClasseur({ url: 'http://docs.google.com/x' }), null, 'jamais en clair');
  assert.equal(S.lienClasseur({ url: 'https://ailleurs.example/x' }), null, 'jamais une autre adresse');
  assert.equal(S.lienClasseur({ url: 'pas une adresse' }), null);
});

test('la page dit ce qu’elle fait : promesse, suppression marquée, « Tout réécrire », « Ne plus suivre »', () => {
  const app = lire('web/app.js');
  assert.match(app, /function rendreSuivi\(\)/, 'une page de réglages à elle');
  assert.match(app, /api\('POST', '\/suivi'/);
  assert.match(app, /api\('POST', '\/suivi\/reecrire'/);
  assert.match(app, /api\('PUT', '\/suivi'/);
  assert.match(app, /Envoyer maintenant/);
  assert.match(S.PROMESSE, /Tout ce que vous créez ici/);
  assert.match(S.TEXTE_SUPPRESSION, /marquée « Supprimée »/);
  assert.match(S.TEXTE_REECRIRE, /aucune n’est effacée/);
  assert.match(S.TEXTE_DETACHER, /reste chez vous/);
  assert.equal(S.TITRE, 'Mon fichier de suivi');
  // « Mon fichier de suivi » est une section de Réglages à part entière
  const reglages = lire('web/reglages.js');
  assert.match(reglages, /id: 'suivi', libelle: 'Mon fichier de suivi'/);
});
