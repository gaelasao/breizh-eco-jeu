/**
 * Google Docs : `fetch` simulé, aucun appel réseau.
 * Ce qui compte ici : le lien qu'on colle est vérifié avant d'entrer dans une adresse, le texte du document est lu
 * dans l'ordre où il se lit, et l'écriture AJOUTE à la fin — elle ne réécrit jamais le document de quelqu'un.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finDuDocument, googledocs, idDocumentGoogle, texteDuDocument } from './sources-docs.ts';

interface Appel { url: URL; methode: string; corps: unknown }
function simuler(repondre: (a: Appel) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', corps: init?.body ? JSON.parse(String(init.body)) : null };
    appels.push(a);
    return repondre(a);
  }) as typeof fetch;
  return { f, appels };
}
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345678';

test('le lien collé est vérifié avant d’entrer dans une adresse', () => {
  assert.equal(idDocumentGoogle(`https://docs.google.com/document/d/${ID}/edit`), ID);
  assert.equal(idDocumentGoogle(`https://docs.google.com/document/d/${ID}`), ID);
  assert.equal(idDocumentGoogle(ID), ID, 'l’identifiant seul est accepté');
  assert.equal(idDocumentGoogle(`  https://docs.google.com/document/d/${ID}/edit?usp=sharing  `), ID);
  // un lien de FEUILLE n'est pas un document : on ne devine pas, on le dit
  assert.throws(() => idDocumentGoogle(`https://docs.google.com/spreadsheets/d/${ID}/edit`), /non reconnu/);
  for (const faux of ['', 'bonjour', 'http://docs.google.com/document/d/' + ID, 'https://evil.example/document/d/' + ID,
    'https://docs.google.com:8443/document/d/' + ID, 'https://user@docs.google.com/document/d/' + ID]) {
    assert.throws(() => idDocumentGoogle(faux), /lien du document|non reconnu/i, faux);
  }
});

test('le texte du document est lu dans l’ordre, mise en forme écartée', () => {
  const corps = { content: [
    { paragraph: { elements: [{ textRun: { content: 'Compte rendu\n' } }] } },
    { paragraph: { elements: [{ textRun: { content: 'Le client ' } }, { textRun: { content: 'veut un devis.\n' } }] } },
    { table: { tableRows: [{ tableCells: [{ content: [{ paragraph: { elements: [{ textRun: { content: 'Ligne de tableau\n' } }] } }] }] }] } },
  ] };
  const t = texteDuDocument(corps);
  assert.match(t, /^Compte rendu/);
  assert.match(t, /Le client veut un devis\./, 'deux morceaux d’un même paragraphe se recollent');
  assert.match(t, /Ligne de tableau/, 'le texte d’un tableau compte aussi');
  // borné : un document de roman ne remplit pas une fiche
  assert.ok(texteDuDocument({ content: [{ paragraph: { elements: [{ textRun: { content: 'a'.repeat(50_000) } }] } }] }).length <= 20_000);
  assert.equal(texteDuDocument(null), '');
});

test('lire : un document donne une fiche, avec son titre et son lien', async () => {
  const { f, appels } = simuler(() => json({ title: 'Réunion Kerlann', body: { content: [{ paragraph: { elements: [{ textRun: { content: 'Relancer lundi.\n' } }] } }] } }));
  const r = await googledocs.lire({ document: `https://docs.google.com/document/d/${ID}/edit` }, 'jeton', f);
  assert.equal(r.length, 1);
  assert.equal(r[0]?.externeId, ID);
  assert.equal(r[0]?.champs.titre, 'Réunion Kerlann');
  assert.match(String(r[0]?.champs.texte), /Relancer lundi\./);
  assert.equal(r[0]?.champs.emplacement, `https://docs.google.com/document/d/${ID}/edit`);
  assert.equal(appels[0]?.url.hostname, 'docs.googleapis.com', 'un seul hôte');
  assert.doesNotMatch(appels[0]?.url.toString() ?? '', /jeton/, 'aucun jeton dans l’adresse');
  // sans connexion, on le dit en français plutôt que de laisser Google répondre 401
  await assert.rejects(googledocs.lire({ document: ID }, null, f), /Se connecter avec Google/);
});

test('écrire : on AJOUTE un bloc daté à la fin, on ne réécrit jamais', async () => {
  /* C'est la garantie qui compte : le document appartient à quelqu'un. Une erreur de notre côté ne doit pas pouvoir
     lui faire perdre une ligne. On n'envoie donc qu'un `insertText`, jamais un `replaceAllText` ni un `deleteRange`. */
  const { f, appels } = simuler((a) => (a.methode === 'POST' ? json({}) : json({ title: 'Réunion', body: { content: [{ endIndex: 1 }, { endIndex: 42 }] } })));
  const r = await googledocs.ecrire!({ document: ID }, 'jeton', ID, { texte: 'Devis envoyé le 19.' }, f);
  assert.equal(r, ID);
  const maj = appels.find((a) => a.methode === 'POST');
  assert.ok(maj, 'une modification est envoyée');
  const requetes = (maj?.corps as { requests: { insertText?: { location: { index: number }; text: string } }[] }).requests;
  assert.equal(requetes.length, 1);
  assert.ok(requetes[0]?.insertText, 'uniquement une insertion');
  assert.equal(requetes[0]?.insertText?.location.index, 41, 'juste avant le saut de ligne final');
  assert.match(requetes[0]?.insertText?.text ?? '', /Living Business — \d{4}-\d{2}-\d{2}/, 'le bloc est daté et signé');
  assert.match(requetes[0]?.insertText?.text ?? '', /Devis envoyé le 19\./);
  const brut = JSON.stringify(maj?.corps);
  for (const destructeur of ['replaceAllText', 'deleteContentRange', 'deleteParagraphBullets']) {
    assert.ok(!brut.includes(destructeur), `jamais de ${destructeur}`);
  }
});

test('écrire : rien à dire, rien d’envoyé', async () => {
  const { f, appels } = simuler(() => json({}));
  assert.equal(await googledocs.ecrire!({ document: ID }, 'jeton', ID, { texte: '   ' }, f), ID);
  assert.equal(appels.length, 0, 'un texte vide ne touche pas au document');
});

test('la fin du document se calcule sur le plus grand indice, jamais en dessous de 1', () => {
  assert.equal(finDuDocument({ body: { content: [{ endIndex: 1 }, { endIndex: 120 }, { endIndex: 60 }] } }), 119);
  assert.equal(finDuDocument({}), 1, 'document vide : on insère au début');
  assert.equal(finDuDocument(null), 1);
});
