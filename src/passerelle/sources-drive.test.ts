/**
 * Google Drive : `fetch` simulé, aucun appel réseau.
 * Ce qui compte ici : on ne rend que des champs que le type « Document » du jeu sait recevoir, le dépôt n'écrase
 * jamais un fichier pour rien, et le jeton ne part jamais dans une adresse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combien, contenuDepot, ficheFichier, googledrive, nomFichier, tailleLisible } from './sources-drive.ts';

interface Appel { url: URL; methode: string; corps: string | null; entetes: Record<string, string> }
function simuler(repondre: (a: Appel) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const a: Appel = {
      url: new URL(String(url)), methode: init?.method ?? 'GET',
      corps: init?.body ? String(init.body) : null,
      entetes: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])),
    };
    appels.push(a);
    return repondre(a);
  }) as typeof fetch;
  return { f, appels };
}
const json = (c: unknown, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'content-type': 'application/json' } });
const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz';

test('les champs rendus sont ceux que le jeu sait recevoir, et rien de plus', () => {
  /* Un connecteur qui rend `taille` ou `modifie_le` oblige à inventer des champs dans l'univers, ou laisse la
     personne devant une correspondance impossible. Trois champs qui tombent juste valent mieux que six qui attendent. */
  const e = ficheFichier({ id: ID, name: 'Attestation URSSAF', size: '20480', modifiedTime: '2026-11-19T08:30:00.000Z', webViewLink: `https://drive.google.com/file/d/${ID}/view` });
  assert.deepEqual(Object.keys(e.champs).sort(), ['emplacement', 'nom', 'note']);
  assert.equal(e.externeId, ID);
  assert.equal(e.champs.nom, 'Attestation URSSAF');
  assert.equal(e.champs.emplacement, `https://drive.google.com/file/d/${ID}/view`);
  assert.match(String(e.champs.note), /20 ko/);
  assert.match(String(e.champs.note), /modifié le 2026-11-19/);
  // la date de modification ne doit JAMAIS ressembler à une date de validité : elle reste dans la note
  assert.doesNotMatch(String(e.champs.note), /valide/i);
});

test('un lien de visualisation douteux est remplacé par celui qu’on sait construire', () => {
  assert.equal(ficheFichier({ id: ID, webViewLink: 'javascript:alert(1)' }).champs.emplacement, `https://drive.google.com/file/d/${ID}/view`);
  assert.equal(ficheFichier({ id: ID }).champs.emplacement, `https://drive.google.com/file/d/${ID}/view`);
  assert.equal(ficheFichier({}).externeId, '', 'sans identifiant, la fiche est écartée par `lire`');
  assert.equal(ficheFichier({ id: ID }).champs.nom, 'Document sans nom');
});

test('la taille se lit en français, et un chiffre absent ne donne pas « NaN »', () => {
  assert.equal(tailleLisible('512'), '512 o');
  assert.equal(tailleLisible('20480'), '20 ko');
  assert.equal(tailleLisible('2097152'), '2,0 Mo');
  for (const rien of [undefined, null, '', 'beaucoup', -3]) assert.equal(tailleLisible(rien), '', String(rien));
});

test('le nom du fichier ne peut pas devenir un chemin', () => {
  assert.equal(nomFichier('Attestation 2026'), 'Attestation 2026');
  assert.equal(nomFichier('../../etc/passwd'), '..-..-etc-passwd');
  assert.equal(nomFichier('dossier\\sous-dossier'), 'dossier-sous-dossier');
  assert.match(nomFichier(''), /^Living Business — \d{4}-\d{2}-\d{2}$/);
  assert.match(nomFichier(null), /^Living Business — \d{4}-\d{2}-\d{2}$/);
});

test('lire : les fichiers déposés, les plus récents d’abord, jeton dans l’en-tête', async () => {
  const { f, appels } = simuler(() => json({ files: [
    { id: ID, name: 'Attestation URSSAF', modifiedTime: '2026-11-19T08:30:00.000Z', size: '20480' },
    { id: 'ZyXwVuTsRqPoNmLkJiHgFe', name: 'Contrat Kerlann', modifiedTime: '2026-11-02T10:00:00.000Z' },
    { name: 'sans identifiant' },
  ] }));
  const r = await googledrive.lire({ combien: 'fichiers25' }, 'jeton', f);
  assert.equal(r.length, 2, 'un fichier sans identifiant n’entre pas');
  assert.equal(r[0]?.champs.nom, 'Attestation URSSAF');
  const u = appels[0]?.url;
  assert.equal(u?.hostname, 'www.googleapis.com');
  assert.equal(u?.searchParams.get('orderBy'), 'modifiedTime desc');
  assert.equal(u?.searchParams.get('pageSize'), '25');
  assert.equal(u?.searchParams.get('q'), 'trashed = false');
  assert.doesNotMatch(u?.toString() ?? '', /jeton/, 'aucun jeton dans l’adresse');
  assert.equal(appels[0]?.entetes.authorization, 'Bearer jeton');
  // sans connexion, on le dit en français plutôt que de laisser Google répondre 401
  await assert.rejects(googledrive.lire({}, null, f), /Se connecter avec Google/);
});

test('combien : une valeur inattendue retombe sur 50, jamais sur zéro', () => {
  assert.equal(combien({ combien: 'fichiers100' }), 100);
  assert.equal(combien({ combien: 'fichiers25' }), 25);
  assert.equal(combien({}), 50);
  assert.equal(combien({ combien: 'fichiers0' }), 50);
  assert.equal(combien({ combien: 'tout' }), 50);
});

test('écrire : création puis contenu, en deux appels', async () => {
  const { f, appels } = simuler((a) => (a.methode === 'POST' ? json({ id: ID }) : json({ id: ID })));
  const r = await googledrive.ecrire!({}, 'jeton', null, { nom: 'Attestation URSSAF', note: 'À renouveler', categorie: 'attestation', emplacement: 'https://exemple/ancien' }, f);
  assert.equal(r, ID);
  assert.equal(appels.length, 2);
  assert.equal(appels[0]?.methode, 'POST');
  assert.equal(JSON.parse(appels[0]?.corps ?? '{}').name, 'Attestation URSSAF.txt');
  assert.equal(appels[1]?.methode, 'PATCH');
  assert.equal(appels[1]?.url.searchParams.get('uploadType'), 'media');
  assert.match(appels[1]?.entetes['content-type'] ?? '', /^text\/plain/);
  const depose = appels[1]?.corps ?? '';
  assert.match(depose, /Nom : Attestation URSSAF/);
  assert.match(depose, /Catégorie : attestation/);
  // le lien du fichier lui-même n'a rien à faire dedans : il ne renseignerait personne
  assert.doesNotMatch(depose, /ancien/);
});

test('écrire : un fichier déjà déposé est mis à jour, pas recréé', async () => {
  const { f, appels } = simuler(() => json({ id: ID }));
  const r = await googledrive.ecrire!({}, 'jeton', ID, { nom: 'Attestation URSSAF' }, f);
  assert.equal(r, ID);
  assert.equal(appels.length, 1, 'aucune création : on remplace le contenu');
  assert.equal(appels[0]?.methode, 'PATCH');
  assert.ok(appels[0]?.url.pathname.endsWith(`/${ID}`));
});

test('écrire : rien à déposer, rien n’est touché', async () => {
  /* Garantie qui compte : une fiche vide ne doit pas aller écraser le fichier d'une fiche remplie, ni semer des
     fichiers vides dans le Drive de quelqu'un. */
  const { f, appels } = simuler(() => json({ id: ID }));
  assert.equal(await googledrive.ecrire!({}, 'jeton', ID, { nom: '   ', note: null, emplacement: 'https://exemple' }, f), ID);
  assert.equal(appels.length, 0);
  assert.equal(contenuDepot({ emplacement: 'https://exemple' }), '');
});

test('écrire : identifiant inattendu de Google, on le dit plutôt que de téléverser au hasard', async () => {
  const { f, appels } = simuler(() => json({ id: 'court' }));
  await assert.rejects(googledrive.ecrire!({}, 'jeton', null, { nom: 'Devis' }, f), /identifiant/);
  assert.equal(appels.length, 1, 'aucun téléversement sans identifiant valable');
  // un identifiant fantaisiste venu de l'ancien lien ne sert pas d'adresse : on recrée
  const b = simuler((a) => (a.methode === 'POST' ? json({ id: ID }) : json({ id: ID })));
  assert.equal(await googledrive.ecrire!({}, 'jeton', '../../fichier', { nom: 'Devis' }, b.f), ID);
  assert.equal(b.appels[0]?.methode, 'POST');
});
