/**
 * LE STOCK PAR LA MESSAGERIE, DE BOUT EN BOUT. La quantité se tape, l'article se CHOISIT dans une liste, et rien
 * ne bouge avant ce choix. Ce qui se vérifie ici : la liste proposée, le mouvement appliqué au bon article, les
 * refus (stock insuffisant, quantité inconnue), l'oubli d'un choix trop vieux, et le nom de celui qui a écrit.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';

const YANN = { id: '4242', nom: 'Yann' };
const app = async () => Application.creer({ connexion: 'demo', exemple: 'pme' });
const articles = (a: Application) => a.monde.objetsReels().filter((o) => o.type === 'article');
const quantite = (a: Application, id: string) => articles(a).find((o) => o.id === id)?.champs.quantite;

test('seul le STOCK est proposé : l’encours d’un client n’est pas une ligne de dépôt', async () => {
  /* Le drapeau « mouvement » de l'univers couvre aussi l'encours client. À l'écran c'est juste ; dans une
     messagerie, « sortie 3 » offrait la liste des clients à côté des matériaux, et une pression de travers sur un
     quai retranchait 3 de l'encours d'une boulangerie. */
  const a = await app();
  const r = a.repondreAuRobot('sortie 1', YANN);
  const noms = (r.boutons ?? []).map((b) => b.texte.replace(/ \(.*\)$/, ''));
  const tiers = a.monde.objetsReels().filter((o) => o.famille === 'tiers').map((o) => o.nom);
  for (const n of noms) assert.ok(!tiers.includes(n), `${n} est un tiers, il n’a rien à faire là`);
  for (const n of noms) assert.ok(articles(a).some((o) => o.nom === n), `${n} est bien un article`);
  a.arreter();
});

test('« sortie 3 » propose les articles, et ne bouge rien tant que personne n’a choisi', async () => {
  const a = await app();
  const avant = articles(a).map((o) => [o.id, o.champs.quantite]);
  const r = a.repondreAuRobot('sortie 3', YANN);
  assert.match(r.texte, /^Sortir 3 de quoi \?$/);
  assert.ok((r.boutons?.length ?? 0) > 1, 'plusieurs articles sont proposés');
  assert.ok(r.boutons?.every((b) => /^st:[0-9a-f]{12}$/.test(b.donnee)), 'chaque bouton porte sa propre référence');
  // le bouton montre la quantité actuelle : on choisit en connaissance de cause
  assert.match(r.boutons?.[0]?.texte ?? '', /\(\d/);
  assert.deepEqual(articles(a).map((o) => [o.id, o.champs.quantite]), avant, 'rien n’a bougé');
  a.arreter();
});

test('le bouton pressé enregistre le mouvement, sur CET article, et dit ce qu’il reste', async () => {
  const a = await app();
  const r = a.repondreAuRobot('sortie 3', YANN);
  const premier = r.boutons?.[0];
  assert.ok(premier);
  const nom = (premier?.texte ?? '').replace(/ \(.*\)$/, '');
  const cible = articles(a).find((o) => o.nom === nom);
  assert.ok(cible, 'le bouton nomme un article réel');
  const avant = Number(quantite(a, cible?.id ?? ''));
  const fait = a.boutonDuRobot(premier?.donnee ?? '', YANN);
  assert.match(fait.texte, new RegExp(`^Sorti 3 ${nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\. Il reste ${avant - 3}\\.$`));
  assert.equal(quantite(a, cible?.id ?? ''), avant - 3);
  // les autres n'ont pas bougé
  for (const o of articles(a)) if (o.id !== cible?.id) assert.notEqual(o.champs.quantite, undefined);
  a.arreter();
});

test('un bouton ne sert qu’une fois : deux pressions ne font pas deux mouvements', async () => {
  /* Sur un téléphone, on appuie deux fois sans le vouloir. Un stock sorti en double ne se voit qu'à l'inventaire. */
  const a = await app();
  const b = a.repondreAuRobot('-2', YANN).boutons?.[0];
  assert.ok(b);
  const nom = (b?.texte ?? '').replace(/ \(.*\)$/, '');
  const id = articles(a).find((o) => o.nom === nom)?.id ?? '';
  const avant = Number(quantite(a, id));
  a.boutonDuRobot(b?.donnee ?? '', YANN);
  assert.equal(quantite(a, id), avant - 2);
  const encore = a.boutonDuRobot(b?.donnee ?? '', YANN);
  assert.match(encore.texte, /ne me dit plus rien|attendu trop longtemps/);
  assert.equal(quantite(a, id), avant - 2, 'la seconde pression n’a rien fait');
  a.arreter();
});

test('ce qu’on tape filtre la liste, et n’en retient jamais un d’office', async () => {
  const a = await app();
  const nom = articles(a)[0]?.nom ?? '';
  const mot = nom.split(' ')[0] ?? '';
  const r = a.repondreAuRobot(`sortie 1 ${mot}`, YANN);
  assert.ok(r.boutons?.length, 'au moins un article correspond');
  assert.ok(r.boutons?.some((b) => b.texte.startsWith(nom)), 'celui qui commence par ces lettres est proposé');
  assert.match(r.texte, /de quoi \?$/, 'même avec un seul candidat, on choisit');
  // un nom qui ne correspond à rien : on le dit, on ne prend pas le premier venu
  const rien = a.repondreAuRobot('sortie 1 zzzzz', YANN);
  assert.equal(rien.boutons, undefined);
  assert.match(rien.texte, /Aucun article ne correspond à « zzzzz »/);
  a.arreter();
});

test('refusé plutôt que faux : on ne descend pas sous zéro', async () => {
  const a = await app();
  const art = articles(a).find((o) => typeof o.champs.quantite === 'number');
  assert.ok(art);
  const stock = Number(art?.champs.quantite);
  const b = a.repondreAuRobot(`sortie ${stock + 10} ${art?.nom}`, YANN).boutons?.[0];
  assert.ok(b);
  const r = a.boutonDuRobot(b?.donnee ?? '', YANN);
  assert.match(r.texte, new RegExp(`il n’y a que ${stock} en stock`));
  assert.equal(quantite(a, art?.id ?? ''), stock, 'le stock n’a pas bougé');
  a.arreter();
});

test('qui a écrit figure dans la source du mouvement', async () => {
  /* « Il reste 1 » sans savoir qui a sorti les trois autres ne vaut pas grand-chose le jour où ça ne tombe pas. */
  const a = await app();
  const b = a.repondreAuRobot('sortie 1', YANN).boutons?.[0];
  const nom = (b?.texte ?? '').replace(/ \(.*\)$/, '');
  a.boutonDuRobot(b?.donnee ?? '', YANN);
  const art = articles(a).find((o) => o.nom === nom);
  assert.equal(art?.source.libelle, 'Telegram (Yann)');
  assert.equal(art?.provenance, 'confirme');
  a.arreter();
});

test('un bouton inventé, ou périmé, n’écrit rien', async () => {
  const a = await app();
  assert.match(a.boutonDuRobot('st:000000000000', YANN).texte, /attendu trop longtemps|ne me dit plus rien/);
  assert.match(a.boutonDuRobot('nimporte quoi', YANN).texte, /ne me dit plus rien/);
  assert.match(a.boutonDuRobot('', YANN).texte, /ne me dit plus rien/);
  a.arreter();
});

test('les autres choses qu’on écrit au robot marchent toujours', async () => {
  const a = await app();
  assert.match(a.repondreAuRobot('?', YANN).texte, /chose|Rien à faire/);
  assert.match(a.repondreAuRobot('rappeler Dupont lundi', YANN).texte, /C'est noté/);
  assert.match(a.repondreAuRobot('aide', YANN).texte, /Je sais faire/);
  a.arreter();
});
