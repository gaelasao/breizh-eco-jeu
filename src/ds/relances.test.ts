/**
 * Réglages › « Suivi et relances » : module pur `web/relances.js` (que montrer, et comment le dire simplement), sa
 * page dans `web/app.js`, et le bouton « Partager » d'une fiche.
 *
 * Ce que ces essais tiennent : aucun jargon à l'écran, un rythme dit en une phrase d'entrepreneur, les deux
 * positions du réglage du retard avec ce qu'elles montrent vraiment, et la ligne gratuit / payant dite une fois —
 * partager et préparer sont compris, l'envoi automatique demande l'offre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const R = (await import(new URL('../../web/relances.js', import.meta.url).href)) as {
  TITRE: string; PROMESSE: string; TEXTE_PARTAGE: string; TEXTE_GARDE_FOUS: string; TEXTE_COMPRIS: string;
  TONS_RELANCE: Record<string, string>; ICONES_RELANCE: Record<string, string>;
  tonRelance: (id: string) => string; iconeRelance: (id: string) => string;
  phraseRythme: (r: unknown) => string;
  rythmeParDefaut: (r: unknown, d: unknown) => boolean;
  CURSEURS: Array<{ cle: string; libelle: string; unite: string; min: number; max: number }>;
  resumeRelances: (l: unknown[]) => string;
  resumeModele: (m: unknown) => string;
  origineModele: (m: unknown) => string;
  apercuRetard: (montrer: boolean, etape?: string) => string;
  POSITIONS_RETARD: Array<{ montrer: boolean; libelle: string; aide: string }>;
  etapesPropres: (l: unknown) => Array<{ libelle: string }>;
  modelePret: (nom: unknown, etapes: unknown) => boolean;
  pourquoiPasPret: (nom: unknown, etapes: unknown) => string | null;
  versQui: (r: unknown) => string;
};

test('le rythme d’une relance se dit en une phrase, jamais en « apresJours »', () => {
  assert.equal(R.phraseRythme({ apresJours: 3, tousLesJours: 14, maxFois: 3 }), 'Au bout de 3 jours, puis tous les 14 jours, 3 fois au plus.');
  assert.equal(R.phraseRythme({ apresJours: 1, tousLesJours: 2, maxFois: 2 }), 'Au bout de 1 jour, puis tous les 2 jours, 2 fois au plus.');
  assert.equal(R.phraseRythme({ apresJours: 0, tousLesJours: 7, maxFois: 1 }), 'Dès le premier jour, une seule fois.');
  assert.equal(R.phraseRythme(null), '');
  assert.ok(!/apres|maxFois|tousLes/.test(R.phraseRythme({ apresJours: 3, tousLesJours: 14, maxFois: 3 })), 'aucun nom de champ ne s’affiche');
  // et l'écran dit quand l'entreprise a changé quelque chose, pour qu'elle sache ce qui vient d'elle
  assert.equal(R.rythmeParDefaut({ apresJours: 3, tousLesJours: 14, maxFois: 3 }, { apresJours: 3, tousLesJours: 14, maxFois: 3 }), true);
  assert.equal(R.rythmeParDefaut({ apresJours: 30, tousLesJours: 14, maxFois: 3 }, { apresJours: 3, tousLesJours: 14, maxFois: 3 }), false);
  assert.equal(R.rythmeParDefaut(null, null), true, 'rien à comparer : rien n’a été réglé');
  // les trois curseurs sont bornés comme le noyau les borne (voir src/core/relances.ts, lireRythme)
  assert.deepEqual(R.CURSEURS.map((c) => c.cle), ['apresJours', 'tousLesJours', 'maxFois']);
  assert.equal(R.CURSEURS.find((c) => c.cle === 'tousLesJours')?.min, 2, 'jamais une relance par jour');
  assert.equal(R.CURSEURS.find((c) => c.cle === 'maxFois')?.max, 10);
});

test('la liste des relances ne fait jamais peur quand il n’y a rien', () => {
  assert.equal(R.resumeRelances([]), 'Rien à relancer aujourd’hui.');
  assert.equal(R.resumeRelances([{}]), '1 relance préparée, à relire avant d’envoyer.');
  assert.equal(R.resumeRelances([{}, {}]), '2 relances préparées, à relire avant d’envoyer.');
  assert.equal(R.resumeRelances(undefined as never), 'Rien à relancer aujourd’hui.');
  // un sujet inconnu ne devient jamais alarmant
  assert.equal(R.tonRelance('inventé'), 'info');
  assert.equal(R.iconeRelance('inventé'), 'circle');
  assert.equal(R.tonRelance('paiement'), 'critique');
  assert.equal(R.versQui({ vers: 'dedans' }), 'À la personne qui tient l’étape');
  assert.equal(R.versQui({ vers: 'dehors' }), 'À votre client');
  // les icônes utilisées existent dans le sprite embarqué
  const sprite = lire('web/bz/icones.svg');
  for (const nom of [...new Set(Object.values(R.ICONES_RELANCE)), 'route', 'link', 'unlink', 'list-checks', 'eye']) {
    assert.match(sprite, new RegExp(`id="i-${nom}"`), `l’icône « ${nom} » n’est pas dans le sprite`);
  }
});

test('le réglage du retard se décide en VOYANT la phrase, pas en lisant une option', () => {
  assert.deepEqual(R.POSITIONS_RETARD.map((p) => p.montrer), [true, false], 'montrer d’abord : c’est le défaut');
  assert.equal(R.POSITIONS_RETARD[0]?.libelle, 'Montrer le retard');
  assert.match(String(R.POSITIONS_RETARD[0]?.aide), /par défaut/);
  assert.equal(R.POSITIONS_RETARD[1]?.libelle, 'Dire seulement l’étape en cours');
  assert.match(String(R.POSITIONS_RETARD[1]?.aide), /restent affichés/, 'le réglage ne cache rien d’autre, et c’est dit');
  assert.equal(R.apercuRetard(true), 'Charpente : dépassée de 2 jours');
  assert.equal(R.apercuRetard(false), 'Charpente : en cours');
  assert.equal(R.apercuRetard(false, 'Pose des fenêtres'), 'Pose des fenêtres : en cours');
});

test('un modèle d’étapes se garde propre, et l’écran dit pourquoi il ne peut pas l’enregistrer', () => {
  assert.deepEqual(R.etapesPropres(['  Charpente ', '', 'Couverture']).map((e) => e.libelle), ['Charpente', 'Couverture']);
  assert.deepEqual(R.etapesPropres([{ libelle: 'Pose   des   fenêtres' }]).map((e) => e.libelle), ['Pose des fenêtres']);
  assert.deepEqual(R.etapesPropres(null), []);
  assert.equal(R.etapesPropres([{ libelle: 'x'.repeat(200) }])[0]?.libelle.length, 80, 'un nom trop long est coupé, pas refusé');
  assert.equal(R.modelePret('Toiture', ['Charpente']), true);
  assert.equal(R.modelePret('', ['Charpente']), false);
  assert.equal(R.modelePret('Toiture', ['  ']), false);
  assert.match(String(R.pourquoiPasPret('', [])), /Donnez un nom/);
  assert.match(String(R.pourquoiPasPret('Toiture', [''])), /au moins une étape/);
  assert.equal(R.pourquoiPasPret('Toiture', ['Charpente']), null);
  assert.equal(R.resumeModele({ nom: 'Toiture', etapes: 3 }), 'Toiture — 3 étapes');
  assert.equal(R.resumeModele({ nom: 'Toiture', etapes: 1 }), 'Toiture — 1 étape');
  assert.equal(R.resumeModele({ nom: 'Toiture', etapes: [{}, {}] }), 'Toiture — 2 étapes');
  assert.equal(R.origineModele({ origine: 'univers' }), 'Proposé par votre métier');
  assert.equal(R.origineModele({}), 'Écrit par vous');
});

test('la page dit ce qu’elle fait, et la ligne gratuit / payant est dite une seule fois', () => {
  assert.match(R.PROMESSE, /ne servent qu’à ceux qui veulent changer/, 'personne n’est obligé de régler quoi que ce soit');
  assert.match(R.TEXTE_PARTAGE, /C’est vous qui l’envoyez/);
  assert.match(R.TEXTE_GARDE_FOUS, /aucun prix, aucune marge/);
  assert.match(R.TEXTE_GARDE_FOUS, /retirer le lien à tout moment/);
  assert.match(R.TEXTE_COMPRIS, /compris dans Living Business/);
  assert.match(R.TEXTE_COMPRIS, /l’envoi automatique/);
  for (const t of [R.PROMESSE, R.TEXTE_PARTAGE, R.TEXTE_GARDE_FOUS, R.TEXTE_COMPRIS]) {
    assert.ok(!/API|jeton|webhook|JSON|modele:|sujetSuivi/i.test(t), `aucun mot technique : ${t}`);
    assert.ok(!/\btu\b|\bton\b|\btes\b/.test(t), 'les textes se vouvoient');
    assert.ok(t.length < 320, 'les textes restent courts');
  }
});

test('la page existe, elle est rangée dans les réglages, et elle appelle les bonnes routes', () => {
  const app = lire('web/app.js');
  assert.match(app, /async function rendreRelances\(\)/, 'une page de réglages à elle');
  assert.match(app, /relances: rendreRelances/, 'et elle est branchée dans la carte des pages');
  for (const route of ['/suivis', '/suivis/relances', '/suivis/affichage', '/suivis/modeles']) {
    assert.ok(app.includes(`'${route}'`) || app.includes(`${route}/`), `la page appelle ${route}`);
  }
  // « Partager » est sur la fiche, avec les trois destinataires et le retrait du lien
  assert.match(app, /function blocSuivi\(o\)/);
  assert.match(app, /\/partager`/);
  assert.match(app, /suivis\/liens\//, 'le lien se retire depuis la fiche');
  // la section est dans Réglages, à sa place
  const reglages = lire('web/reglages.js');
  assert.match(reglages, /id: 'relances', libelle: 'Suivi et relances'/);
  assert.equal(R.TITRE, 'Suivi et relances');
});

test('la page du client marque l’étape courante, sans couleur pour seul indice', () => {
  const page = lire('web/suivi-client-page.js');
  assert.match(page, /data-courante/);
  assert.match(page, /texte: 'en cours'/, 'deux mots lisibles, pas seulement un liseré');
  // « courante » et non « en cours » : « encours » est un mot d'argent, et la page du client n'en porte aucun
  assert.equal(/\bencours/i.test(page.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')), false);
  const css = lire('web/suivi-client.css');
  assert.match(css, /\.etape\[data-courante\]/);
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, 'aucune couleur en dur : la page suit le thème');
});
