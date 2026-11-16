/**
 * La page de suivi qu'un CLIENT ouvre : module pur `web/suivi-client.js` (que montrer, et comment le dire), sa page
 * `web/suivi-client.html`, et son habillage `web/suivi-client.css`. Rien de technique, aucun jargon, et surtout rien
 * d'autre que SON dossier : une page retirée ne montre qu'une phrase.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const S = (await import(new URL('../../web/suivi-client.js', import.meta.url).href)) as {
  TONS: Record<string, string>;
  ICONES: Record<string, string>;
  tonEtape: (e: string) => string;
  iconeEtape: (e: string) => string;
  jourLisible: (j: unknown) => string;
  pourcentage: (a: unknown) => number;
  resumeAvancement: (a: unknown) => string;
  tonPhrase: (p: unknown) => string;
  etat: (p: unknown) => { quoi: string; message?: string; page?: unknown };
};

test('la phrase d’en-tête prend le ton de ce qui presse le plus, et le vert quand c’est fini', () => {
  const etapes = [
    { libelle: 'Terrassement', etat: 'faite', faite: true },
    { libelle: 'Charpente', etat: 'depassee', faite: false },
    { libelle: 'Couverture', etat: 'bientot', faite: false },
  ];
  assert.equal(S.tonPhrase({ termine: false, etapes }), 'critique', 'une étape dépassée ne s’annonce pas sur un fond calme');
  assert.equal(S.tonPhrase({ termine: false, etapes: etapes.slice(0, 1).concat(etapes[2] as never) }), 'attention');
  assert.equal(S.tonPhrase({ termine: false, etapes: [{ libelle: 'Pose', etat: 'a_venir', faite: false }] }), 'info');
  assert.equal(S.tonPhrase({ termine: true, etapes }), 'ok', 'terminé : vert, quoi qu’il se soit passé avant');
  assert.equal(S.tonPhrase({ termine: false, etapes: [] }), 'info');
  assert.equal(S.tonPhrase(null), 'info');
  // une étape déjà faite ne pèse plus sur le ton
  assert.equal(S.tonPhrase({ termine: false, etapes: [{ libelle: 'Charpente', etat: 'depassee', faite: true }] }), 'info');
});

test('chaque état d’étape a un ton et une icône, et un état inconnu ne casse rien', () => {
  for (const e of ['faite', 'depassee', 'aujourdhui', 'bientot', 'a_venir', 'sans_date']) {
    assert.ok(S.TONS[e], `ton manquant pour ${e}`);
    assert.ok(S.ICONES[e], `icône manquante pour ${e}`);
  }
  assert.equal(S.tonEtape('faite'), 'ok');
  assert.equal(S.tonEtape('depassee'), 'critique');
  assert.equal(S.tonEtape('inventé'), 'info', 'un état qu’on ne connaît pas ne devient jamais alarmant');
  assert.equal(S.iconeEtape('inventé'), 'circle');
  // les icônes utilisées existent bien dans le sprite embarqué
  const sprite = lire('web/bz/icones.svg');
  for (const nom of [...new Set(Object.values(S.ICONES)), 'unlink']) {
    assert.match(sprite, new RegExp(`id="i-${nom}"`), `l’icône « ${nom} » n’est pas dans le sprite`);
  }
});

test('une date se lit à la française, et une date absente ne s’invente pas', () => {
  assert.equal(S.jourLisible('2026-11-28'), '28/11/2026');
  assert.equal(S.jourLisible(null), '');
  assert.equal(S.jourLisible(''), '');
  assert.equal(S.jourLisible('bientôt'), '', 'le jeu n’affiche jamais une date qu’il n’a pas');
});

test('l’avancement se dit en étapes, jamais en « NaN » ni en « 1 étapes »', () => {
  assert.equal(S.pourcentage({ faites: 1, total: 4 }), 25);
  assert.equal(S.pourcentage({ faites: 0, total: 0 }), 0, 'aucune étape : 0, pas une division par zéro');
  assert.equal(S.pourcentage(undefined), 0);
  assert.equal(S.resumeAvancement({ faites: 1, total: 5 }), '1 étape sur 5');
  assert.equal(S.resumeAvancement({ faites: 2, total: 5 }), '2 étapes sur 5');
  assert.equal(S.resumeAvancement({ faites: 0, total: 0 }), 'Rien d’annoncé pour l’instant.');
  assert.equal(S.resumeAvancement(null), 'Rien d’annoncé pour l’instant.');
});

test('la page ne dessine que deux choses : le suivi, ou la phrase d’un lien retiré', () => {
  const ouverte = S.etat({ etat: 'ouverte', titre: 'Suivre mon chantier' });
  assert.equal(ouverte.quoi, 'suivi');
  const fermee = S.etat({ etat: 'fermee', message: 'Ce lien de suivi a été retiré par l’entreprise.' });
  assert.equal(fermee.quoi, 'ferme');
  assert.match(String(fermee.message), /retiré par l’entreprise/);
  // réponse illisible (coupure réseau) : une phrase utile, jamais un code d'erreur
  assert.equal(S.etat(null).quoi, 'erreur');
  assert.match(String(S.etat(null).message), /Réessayez/);
  assert.ok(!/\b(404|500|fetch|API)\b/.test(String(S.etat(null).message)), 'aucun jargon pour le client');
});

test('la page est servie sur /s/<jeton>, sans session, et son adresse publique est la seule entrée', () => {
  const http = lire('src/passerelle/http.ts');
  assert.match(http, /\/\^\\\/s\\\/\[A-Za-z0-9_-\]\{1,64\}\$\/\.test\(chemin\)/, 'l’adresse /s/<jeton> sert la page');
  assert.match(http, /statiques\.get\('\/suivi-client\.html'\)/);
  assert.match(http, /api\\\/public\\\/suivi\\\//, 'et son contenu vient d’une route publique');
  // la page ne fait qu'une lecture : aucune écriture n'est possible depuis un lien de suivi
  assert.match(http, /if \(sv\) \{\n\s+if \(req\.method !== 'GET'\) return envoyer\(res, 405/);
});

test('la page se tient : thème clair et sombre, largeur du téléphone, aucun pisteur', () => {
  const html = lire('web/suivi-client.html');
  assert.match(html, /<html lang="fr"/);
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/, 'une page de suivi ne s’indexe pas');
  assert.match(html, /name="color-scheme" content="light dark"/);
  assert.match(html, /\/bz\/bz\.css/, 'les jetons de design, et rien d’autre');
  assert.equal(/https?:\/\/(?!localhost)/.test(html), false, 'aucune adresse extérieure : ni police, ni pisteur, ni mesure d’audience');
  const css = lire('web/suivi-client.css');
  // chaque couleur est un jeton : la page suit le thème sans une seule valeur écrite à la main
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'aucune couleur en dur');
  assert.match(css, /@media \(max-width: 26\.25em\)/, 'la mise en page tient sur un téléphone');
  assert.match(css, /min-block-size: var\(--bz-cible\)/, 'les lignes font la taille d’une cible tactile');
});

test('la page ne parle jamais d’argent : elle n’a pas même de quoi en afficher', () => {
  const js = lire('web/suivi-client.js') + lire('web/suivi-client-page.js');
  // hors commentaires : l'en-tête des deux fichiers EXPLIQUE justement qu'aucun montant n'y passe
  const code = js.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  for (const mot of ['montant', 'marge', 'prix', 'cout', 'coût', 'remise', 'encours']) {
    assert.equal(new RegExp(`\\b${mot}`, 'i').test(code), false, `« ${mot} » n’a rien à faire dans la page du client`);
  }
  assert.match(js, /\/api\/public\/suivi\//, 'une seule source de données');
  assert.equal(js.includes('localStorage'), false, 'rien n’est gardé dans le navigateur du client');
});
