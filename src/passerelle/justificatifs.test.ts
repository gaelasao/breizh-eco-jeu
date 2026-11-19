/**
 * Saisie sur le terrain : la photo rangée et retrouvée, un fichier qui n'est pas une image refusé,
 * une photo trop lourde refusée en clair, la place rendue quand on retire, le périmètre d'un profil respecté, la
 * proposition d'un agent qui n'enregistre rien, et la ligne reprise dans ce qui part au comptable.
 *
 * Aucune photo réelle : des octets factices qui portent la bonne signature de format, construits à l'exécution.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import {
  CATEGORIES, categorieLue, DOSSIER_PHOTOS, ENTETES_COMPTABLES, exportComptable, fournisseurPropose, Justificatifs, PLACE_MAX, reconnaitreImage,
  poids, REFUS_TYPE, TAILLE_MAX, type VueJustificatif,
} from './justificatifs.ts';
import { AVERTISSEMENT_PHOTO, traiterMcp } from './mcp.ts';
import { tacheDejaFaite, tacheDeRendezVous, titreDeNote } from '../core/saisie-terrain.ts';
import { defType } from '../core/univers.ts';
import { NOM, proposerMapping } from './csv.ts';

const MDP = 'une phrase assez longue';
const installation = { nom: 'Maël Le Bihan', entreprise: 'Menuiserie Kerlann', identifiant: 'mael@kerlann.example', motDePasse: MDP, depart: 'exemple', exemple: 'pme' };

/** Octets qui portent la signature d'un format, sans être une vraie image : le serveur ne décode jamais une photo. */
const photo = (format: 'jpeg' | 'png' | 'webp' | 'heic', taille = 600): Buffer => {
  const tetes: Record<string, Buffer> = {
    jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    webp: Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.alloc(4), Buffer.from('WEBP', 'latin1')]),
    heic: Buffer.concat([Buffer.alloc(4), Buffer.from('ftypheic', 'latin1')]),
  };
  const tete = tetes[format] as Buffer;
  return Buffer.concat([tete, Buffer.alloc(Math.max(0, taille - tete.length), 0x5a)]);
};
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(200, 0x20)]);

async function demarrer(app: Application): Promise<{ serveur: Server; base: string }> {
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  return { serveur, base: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}` };
}
const fermer = (s: Server) => new Promise<void>((ok) => { s.closeAllConnections(); s.close(() => ok()); });

function client(base: string) {
  let cookie = '';
  const suivre = (r: Response) => { const c = r.headers.get('set-cookie'); if (c) cookie = c.split(';')[0] as string; };
  return {
    async appel(methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) {
      const r = await fetch(base + chemin, { method: methode, headers: { 'content-type': 'application/json', 'x-lb-requete': '1', ...(cookie ? { cookie } : {}), ...entetes }, body: corps === undefined ? null : JSON.stringify(corps) });
      suivre(r);
      return { statut: r.status, json: await r.json().catch(() => null) as any };
    },
    /** La photo part telle quelle, comme le fait le navigateur (jamais de JSON, jamais de base64). */
    async photo(octets: Buffer, { concerne = '', type = 'image/jpeg' } = {}) {
      const r = await fetch(`${base}/api/v1/justificatifs${concerne ? `?concerne=${encodeURIComponent(concerne)}` : ''}`, {
        method: 'POST', headers: { 'content-type': type, 'x-lb-requete': '1', ...(cookie ? { cookie } : {}) }, body: new Uint8Array(octets),
      });
      suivre(r);
      return { statut: r.status, json: await r.json().catch(() => null) as any };
    },
    /** Un corps brut d'un autre genre (un document annoncé comme tel) : refusé avant d'être lu. */
    async brut(type: string, corps: string) {
      const r = await fetch(`${base}/api/v1/justificatifs`, { method: 'POST', headers: { 'content-type': type, 'x-lb-requete': '1', ...(cookie ? { cookie } : {}) }, body: corps });
      return { statut: r.status, json: await r.json().catch(() => null) as any };
    },
    async octets(chemin: string) {
      const r = await fetch(base + chemin, { headers: cookie ? { cookie } : {} });
      return { statut: r.status, type: r.headers.get('content-type'), cache: r.headers.get('cache-control'), octets: Buffer.from(await r.arrayBuffer()) };
    },
  };
}

// ---------------------------------------------------------------- reconnaissance du format et messages

test('justificatif : le format est lu dans les octets, jamais cru sur parole', () => {
  assert.deepEqual(reconnaitreImage(photo('jpeg')), { mime: 'image/jpeg', ext: 'jpg' });
  assert.deepEqual(reconnaitreImage(photo('png')), { mime: 'image/png', ext: 'png' });
  assert.deepEqual(reconnaitreImage(photo('webp')), { mime: 'image/webp', ext: 'webp' });
  assert.deepEqual(reconnaitreImage(photo('heic')), { mime: 'image/heic', ext: 'heic' }, 'une photo d’iPhone');
  assert.equal(reconnaitreImage(PDF), null, 'un PDF n’est pas une photo');
  assert.equal(reconnaitreImage(Buffer.alloc(0)), null);
  assert.equal(reconnaitreImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', 'latin1')), null, 'un SVG est du code, pas une photo');
  // un fichier renommé « .jpg » qui n'en est pas un est refusé comme les autres
  assert.equal(reconnaitreImage(Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(50)])), null);
  assert.match(REFUS_TYPE, /JPEG, PNG, WebP, HEIC/);
  assert.match(REFUS_TYPE, /appareil du téléphone/, 'le refus dit quoi faire');
  assert.equal(poids(14_200_000), '14,2 Mo');
  assert.equal(poids(2_400_000), '2,4 Mo');
  assert.equal(poids(420_000), '420 ko');
  assert.equal(poids(PLACE_MAX), '2,0 Go', 'la place accordée se dit en gigaoctets');
  assert.equal(TAILLE_MAX, 12_000_000);
  assert.equal(PLACE_MAX, 2_000_000_000);
});

test('justificatif : le fournisseur proposé est le dernier saisi pour ce chantier, et rien n’est inventé', () => {
  const f = (id: string, concerne: string | null, fournisseur: string, le: string) => ({ id, concerne, fournisseur, le } as VueJustificatif);
  const liste = [f('a', 'ch-1', 'Point P', '2026-11-10T08:00:00Z'), f('b', 'ch-2', 'Leroy Merlin', '2026-11-12T08:00:00Z'), f('c', 'ch-1', 'Chausson', '2026-11-14T08:00:00Z')];
  assert.equal(fournisseurPropose(liste, 'ch-1'), 'Chausson', 'le dernier de CE chantier');
  assert.equal(fournisseurPropose(liste, 'ch-3'), 'Chausson', 'aucun ici : le dernier saisi tout court');
  assert.equal(fournisseurPropose([], 'ch-1'), '', 'rien à proposer : le champ reste vide');
  assert.equal(fournisseurPropose([f('a', 'ch-1', '', '2026-11-10T08:00:00Z')], 'ch-1'), '', 'un justificatif sans fournisseur ne propose rien');
});

// ---------------------------------------------------------------- la photo, rangée et retrouvée

test('justificatif : la photo est rangée sur le disque, retrouvée telle quelle, et absente de l’état enregistré', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-justificatifs-'));
  try {
    const app = await Application.creer({ connexion: 'comptes', dossier });
    const { serveur, base } = await demarrer(app);
    try {
      const c = client(base);
      await c.appel('POST', '/api/v1/installation', installation);
      const octets = photo('jpeg', 4096);
      const r = await c.photo(octets, { concerne: 'pr-hotel' });
      assert.equal(r.statut, 200);
      assert.match(r.json.id, /^jt-[0-9a-f]{18}$/);
      assert.equal(r.json.octets, octets.length);
      assert.equal(r.json.mime, 'image/jpeg');
      assert.equal(r.json.concerne, 'pr-hotel');
      assert.equal(r.json.complet, false, 'les trois champs restent à remplir');
      assert.equal(r.json.montant, null);

      // retrouvée : les mêmes octets, servis en « private » (jamais dans un cache partagé)
      const photoServie = await c.octets(`/api/v1/justificatifs/${r.json.id}/photo`);
      assert.equal(photoServie.statut, 200);
      assert.equal(photoServie.type, 'image/jpeg');
      assert.match(photoServie.cache ?? '', /^private, max-age=\d+$/);
      assert.deepEqual(photoServie.octets, octets, 'la photo revient à l’octet près');

      // un fichier par photo, à côté de monde.json, en 0600 — et RIEN de l'image dans l'état enregistré
      app.stockage?.ecrireMaintenant();
      const fichiers = readdirSync(join(dossier, DOSSIER_PHOTOS));
      assert.deepEqual(fichiers, [`${r.json.id}.jpg`]);
      assert.deepEqual(readFileSync(join(dossier, DOSSIER_PHOTOS, fichiers[0] as string)), octets);
      const monde = readFileSync(join(dossier, 'monde.json'), 'utf8');
      assert.ok(monde.includes(r.json.id), 'la fiche du justificatif, elle, est enregistrée');
      assert.ok(monde.length < 2_000_000 && !monde.includes(octets.toString('base64').slice(0, 64)), 'les octets de la photo ne sont jamais dans monde.json');

      // les trois champs, puis la ligne est complète
      const complet = await c.appel('PUT', `/api/v1/justificatifs/${r.json.id}`, { montant: '128,40', date: '2026-11-16', fournisseur: ' Point  P ' });
      assert.equal(complet.statut, 200);
      assert.equal(complet.json.montant, 128.4);
      assert.equal(complet.json.date, '2026-11-16');
      assert.equal(complet.json.fournisseur, 'Point P', 'texte ramené à une ligne');
      assert.equal(complet.json.complet, true);
      assert.equal(complet.json.concerneNom, 'Rénovation — Hôtel des Embruns');

      // la liste ne contient JAMAIS la photo : seulement sa fiche et son poids
      const liste = await c.appel('GET', '/api/v1/justificatifs');
      assert.equal(liste.json.liste.length, 1);
      assert.equal(liste.json.place.nombre, 1);
      assert.equal(liste.json.place.octets, octets.length);
      assert.equal(JSON.stringify(liste.json).includes('base64'), false);
      assert.equal((await (await fetch(`${base}/api/v1/justificatifs?concerne=pr-mairie`)).json().catch(() => null))?.erreur, 'non_authentifie', 'sans session : rien');

      // retiré : la photo quitte le disque et la place est rendue
      const retire = await c.appel('DELETE', `/api/v1/justificatifs/${r.json.id}`);
      assert.equal(retire.statut, 200);
      assert.deepEqual(readdirSync(join(dossier, DOSSIER_PHOTOS)), []);
      assert.equal((await c.appel('GET', '/api/v1/justificatifs')).json.place.octets, 0);
      assert.equal((await c.octets(`/api/v1/justificatifs/${r.json.id}/photo`)).statut, 404);
    } finally { await fermer(serveur); app.arreter(); }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test('justificatif : un fichier qui n’est pas une photo est refusé, et une photo trop lourde l’est en clair', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const c = client(base);
    await c.appel('POST', '/api/v1/installation', installation);
    // un PDF annoncé comme une image : refusé sur ses octets
    const pdf = await c.photo(PDF, { type: 'image/jpeg' });
    assert.equal(pdf.statut, 415);
    assert.equal(pdf.json.erreur, 'pas_une_photo');
    assert.equal(pdf.json.message, REFUS_TYPE);
    // un document qui s'annonce pour ce qu'il est : refusé avant même d'être lu
    const document = await c.brut('application/pdf', 'x');
    assert.equal(document.statut, 415);
    assert.equal(document.json.erreur, 'image_attendue');
    // trop lourde : le refus dit le poids et le maximum
    const lourde = await c.photo(photo('jpeg', 14_000_000));
    assert.equal(lourde.statut, 413);
    assert.match(lourde.json.message, /Photo trop lourde : 14,0 Mo, alors que le maximum est 12,0 Mo/);
    assert.match(lourde.json.message, /qualité normale/);
    // vide
    assert.equal((await c.photo(Buffer.alloc(0))).statut, 400);
    assert.equal((await c.appel('GET', '/api/v1/justificatifs')).json.liste.length, 0, 'rien n’a été rangé');
  } finally { await fermer(serveur); app.arreter(); }
});

test('justificatif : quand la place est prise, la photo suivante est refusée en clair (jamais une ancienne effacée)', async () => {
  const app = await Application.creer({ exemple: 'pme' });
  const p = app.monde.profil('dirigeante')!;
  const j = new Justificatifs(app.monde, { placeMax: 3_000_000 });
  const un = j.ajouter(p, 'essai', photo('jpeg', 1_500_000), 'pr-hotel');
  const deux = j.ajouter(p, 'essai', photo('png', 1_400_000), 'pr-hotel');
  assert.equal(j.place().octets, 2_900_000);
  assert.equal(j.place().presque, true, 'l’écran prévient avant d’être bloqué');
  assert.throws(() => j.ajouter(p, 'essai', photo('jpeg', 400_000), 'pr-hotel'), (e: { statut?: number; code?: string; message?: string }) => {
    assert.equal(e.statut, 507);
    assert.equal(e.code, 'place_insuffisante');
    assert.match(e.message ?? '', /occupent déjà 2,9 Mo sur 3,0 Mo/);
    assert.match(e.message ?? '', /Exportez-les pour votre comptable/);
    assert.match(e.message ?? '', /n’a pas été enregistrée/);
    return true;
  });
  assert.deepEqual(j.lister(p, 'essai').map((x) => x.id).sort(), [un.id, deux.id].sort(), 'les deux premières sont intactes');
  // de la place rendue : la suivante passe
  j.supprimer(p, 'essai', un.id);
  assert.equal(j.ajouter(p, 'essai', photo('jpeg', 400_000), 'pr-hotel').octets, 400_000);
});

test('justificatif : un profil ne voit pas la photo d’un chantier hors de son périmètre', async () => {
  const app = await Application.creer({ exemple: 'pme' });
  const anna = app.monde.profil('dirigeante')!;
  const yann = app.monde.profil('responsable-stock')!;
  const j = new Justificatifs(app.monde, {});
  const sur = j.ajouter(anna, 'sa', photo('jpeg', 900), 'pr-hotel');
  assert.equal(j.lister(anna, 'sa').length, 1);
  assert.deepEqual(j.lister(yann, 'sy'), [], 'un chantier qu’il ne voit pas : il ne voit pas la photo');
  assert.throws(() => j.photo(yann, 'sy', sur.id), /introuvable/);
  assert.throws(() => j.completer(yann, 'sy', sur.id, { montant: '10' }), /introuvable/);
  // rattacher une photo à une fiche hors périmètre est refusé (rien n'est révélé de son existence)
  assert.throws(() => j.ajouter(yann, 'sy', photo('jpeg', 100), 'pr-hotel'), /Fiche inconnue ou hors de votre périmètre/);
  // la fiche effacée : la photo reste (une pièce comptable ne se jette pas), sans rattachement
  assert.equal(j.oublierObjet('pr-hotel'), 1);
  assert.equal(j.lister(anna, 'sa')[0]?.concerne, null);
  assert.equal(j.lister(anna, 'sa')[0]?.concerneNom, null);
});

// ---------------------------------------------------------------- l'agent de l'entreprise : il propose, elle décide

test('justificatif : l’agent de l’entreprise lit la photo et PROPOSE ; une clé n’enregistre ni ne retire rien', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const c = client(base);
    await c.appel('POST', '/api/v1/installation', installation);
    const r = await c.photo(photo('jpeg', 2048), { concerne: 'pr-mairie' });
    const id = r.json.id as string;
    const p = app.monde.profils().find((x) => x.peutAdministrer)!;
    const { jeton } = app.cles.creer(p, { nom: 'Agent de l’atelier', profilId: p.id });
    const avecCle = (methode: string, chemin: string, corps?: unknown) => fetch(base + chemin, {
      method: methode, headers: { authorization: `Bearer ${jeton}`, 'content-type': 'application/json' }, body: corps === undefined ? null : JSON.stringify(corps),
    });

    // elle peut lire la photo (c'est son agent, sur son serveur)
    assert.equal((await avecCle('GET', `/api/v1/justificatifs/${id}/photo`)).status, 200);
    // elle peut PROPOSER les trois champs
    const propose = await (await avecCle('POST', `/api/v1/justificatifs/${id}`, { montant: '96,30', date: '2026-11-15', fournisseur: 'Chausson Matériaux' })).json();
    assert.equal(propose.propose.montant, 96.3);
    assert.equal(propose.propose.par, 'Agent de l’atelier', 'l’écran dit qui a proposé');
    assert.equal(propose.montant, null, 'RIEN n’est enregistré dans les champs');
    assert.equal(propose.complet, false);
    // elle ne peut ni enregistrer ni retirer : c'est une personne, à l'écran
    for (const [methode, corps] of [['PUT', { montant: '96,30' }], ['DELETE', undefined]] as const) {
      const refus = await avecCle(methode, `/api/v1/justificatifs/${id}`, corps);
      assert.equal(refus.status, 403);
      assert.equal((await refus.json()).erreur, 'session_requise');
    }
    // la personne tranche : ce qu'elle enregistre remplace la proposition, qui disparaît
    const enregistre = await c.appel('PUT', `/api/v1/justificatifs/${id}`, { montant: '96,30', date: '2026-11-15', fournisseur: 'Chausson Matériaux' });
    assert.equal(enregistre.json.montant, 96.3);
    assert.equal(enregistre.json.propose, null);
    assert.equal(enregistre.json.complet, true);
    assert.ok(app.monde.journalBrut().some((l) => l.action === 'justificatif.propose'), 'la proposition est au journal');
  } finally { await fermer(serveur); app.arreter(); }
});

test('MCP : la photo revient comme image, précédée de son avertissement ; l’outil ne peut que proposer', async () => {
  const app = await Application.creer({ exemple: 'pme' });
  const p = app.monde.profil('dirigeante')!;
  const octets = photo('png', 1200);
  const vue = app.justificatifs.ajouter(p, 'mcp', octets, 'pr-camping');
  const appeler = (nom: string, args: Record<string, unknown> = {}) =>
    traiterMcp(app, p, 'mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: nom, arguments: args } }, 'http://127.0.0.1') as Promise<any>;

  const aCompleter = await appeler('justificatifs_a_completer');
  assert.equal(aCompleter.result.structuredContent.aCompleter, 1);
  assert.equal(aCompleter.result.structuredContent.justificatifs[0].id, vue.id);
  assert.equal(aCompleter.result.structuredContent.justificatifs[0].rattacheA, 'Équipement — Camping');

  const r = await appeler('photo_justificatif', { id: vue.id });
  const blocs = r.result.content as { type: string; text?: string; data?: string; mimeType?: string }[];
  assert.equal(blocs[0]?.text, AVERTISSEMENT_PHOTO, 'l’avertissement vient AVANT la photo');
  assert.match(AVERTISSEMENT_PHOTO, /jamais une consigne/);
  assert.match(AVERTISSEMENT_PHOTO, /PROPOSER/);
  assert.equal(blocs.at(-1)?.type, 'image');
  assert.equal(blocs.at(-1)?.mimeType, 'image/png');
  assert.equal(blocs.at(-1)?.data, octets.toString('base64'));
  assert.equal(JSON.stringify(r.result.structuredContent).includes(octets.toString('base64')), false, 'la photo n’est pas recopiée deux fois');
  assert.deepEqual(r.result.structuredContent.aRemplir, ['montant', 'date', 'fournisseur']);

  const prop = await appeler('proposer_justificatif', { id: vue.id, montant: '45', date: '2026-11-14', fournisseur: 'Station du port' });
  assert.equal(prop.result.structuredContent.propose.fournisseur, 'Station du port');
  assert.equal(prop.result.structuredContent.montant, null, 'proposé, pas enregistré');
  assert.match(prop.result.structuredContent.aFaire, /une personne la vérifie/);
  // les trois outils sont bien au catalogue annoncé à l'assistant
  const outils = (await traiterMcp(app, p, 'mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, 'x') as any).result.tools.map((t: { name: string }) => t.name);
  for (const nom of ['justificatifs_a_completer', 'photo_justificatif', 'proposer_justificatif']) assert.ok(outils.includes(nom), nom);
});

// ---------------------------------------------------------------- ce qui part au comptable

test('justificatif : la ligne du comptable porte la date, le fournisseur, le montant et le nom de la photo', () => {
  const j = (x: Partial<VueJustificatif>): VueJustificatif => ({
    id: 'jt-000000000000000001', le: '2026-11-16T08:00:00Z', mime: 'image/jpeg', ext: 'jpg', octets: 1000, concerne: null,
    montant: null, date: null, fournisseur: '', categorie: '', propose: null, par: 'p', concerneNom: null, complet: false, ...x,
  });
  const complet = j({ id: 'jt-00000000000000000a', montant: 128.4, date: '2026-11-16', fournisseur: 'Point P', categorie: 'fourniture ou matériau', concerneNom: 'Chantier Kerlann', complet: true });
  const vieux = j({ id: 'jt-00000000000000000b', montant: 9.9, date: '2026-10-02', fournisseur: 'Station', categorie: 'carburant', complet: true });
  const incomplet = j({ id: 'jt-00000000000000000c', date: '2026-11-01' });
  const r = exportComptable([complet, vieux, incomplet]);
  // la catégorie entre dans le fichier : c'est elle que le comptable réclamait ligne par ligne
  assert.deepEqual(ENTETES_COMPTABLES, ['Date', 'Fournisseur', 'Montant TTC', 'Catégorie', 'Rattaché à', 'Photo', 'Référence']);
  assert.deepEqual(r.lignes, [
    ['2026-10-02', 'Station', '9,90', 'carburant', '', 'jt-00000000000000000b.jpg', 'jt-00000000000000000b'],
    ['2026-11-16', 'Point P', '128,40', 'fourniture ou matériau', 'Chantier Kerlann', 'jt-00000000000000000a.jpg', 'jt-00000000000000000a'],
  ], 'les plus anciens d’abord, montants à la française, photo nommée');
  assert.equal(r.aCompleter, 1, 'ce qui manque est dit, jamais tu');
  assert.equal(r.total, 138.3);
  // une période : seules ses lignes partent
  assert.deepEqual(exportComptable([complet, vieux], { debut: '2026-11-01', fin: '2026-11-30' }).lignes.map((l) => l[1]), ['Point P']);
  // une catégorie inventée n'entre pas dans un fichier comptable
  assert.equal(categorieLue('bricoles'), '');
  assert.equal(categorieLue('carburant'), 'carburant');
  assert.ok(CATEGORIES.includes('véhicule') && CATEGORIES.includes('note de frais'), 'les deux que le comptable réclame le plus');
});

// ---------------------------------------------------------------- la note, et la tâche d'un rendez-vous

test('note : une ligne tapée ou dictée devient un intitulé propre, et rien quand elle est vide', () => {
  assert.equal(titreDeNote('  reprendre   les joints\nde la salle de bain '), 'Reprendre les joints de la salle de bain');
  assert.equal(titreDeNote('éclairage à revoir'), 'Éclairage à revoir', 'majuscule accentuée');
  assert.equal(titreDeNote(''), '');
  assert.equal(titreDeNote('   '), '');
  assert.equal(titreDeNote(null), '');
  assert.equal(titreDeNote('x'.repeat(400)).length, 200);
  assert.equal(titreDeNote('a‮b'), 'A b', 'aucun caractère de direction dans un intitulé');
});

test('rendez-vous : « en faire une tâche » prend son intitulé et son jour, sans l’heure', () => {
  assert.deepEqual(tacheDeRendezVous({ nom: 'Visite Hôtel des Embruns', champs: { debut: '2026-11-20T09:00' } }), { titre: 'Visite Hôtel des Embruns', echeance: '2026-11-20' });
  assert.deepEqual(tacheDeRendezVous({ nom: 'Journée salon', champs: { debut: '2026-11-20' } }), { titre: 'Journée salon', echeance: '2026-11-20' });
  assert.deepEqual(tacheDeRendezVous({ nom: '', champs: {} }), { titre: 'Rendez-vous', echeance: null }, 'rien n’est inventé');
  const taches = [{ id: 't1', famille: 'tache', champs: { concerne: 'rdv-1' } }, { id: 't2', famille: 'tache', champs: { concerne: 'rdv-2' } }] as never[];
  assert.equal(tacheDejaFaite(taches, 'rdv-2')?.id, 't2');
  assert.equal(tacheDejaFaite(taches, 'rdv-9'), null);
});

test('rendez-vous : un clic fait une tâche, deux clics n’en font pas deux', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const c = client(base);
    await c.appel('POST', '/api/v1/installation', installation);
    const rdv = await c.appel('POST', '/api/v1/objets', { type: 'rendez_vous', nom: 'Visite Hôtel des Embruns', champs: { debut: '2026-11-20T09:00', fin: '2026-11-20T10:00', lieu: 'Lorient' } });
    assert.equal(rdv.statut, 200);
    const un = await c.appel('POST', '/api/v1/taches/depuis-rendez-vous', { evenement: rdv.json.id });
    assert.equal(un.statut, 200);
    assert.equal(un.json.deja, false);
    assert.equal(un.json.tache.nom, 'Visite Hôtel des Embruns');
    assert.equal(un.json.tache.echeance, '2026-11-20');
    const deux = await c.appel('POST', '/api/v1/taches/depuis-rendez-vous', { evenement: rdv.json.id });
    assert.equal(deux.json.deja, true, 'recliquer retombe sur la tâche déjà faite');
    assert.equal(deux.json.tache.id, un.json.tache.id);
    const taches = app.monde.objetsReels().filter((o) => o.famille === 'tache' && o.champs.concerne === rdv.json.id);
    assert.equal(taches.length, 1, 'une seule tâche, pas deux');
    // jamais automatiquement : un deuxième rendez-vous n'a aucune tâche tant que personne n'a cliqué
    const autre = await c.appel('POST', '/api/v1/objets', { type: 'rendez_vous', nom: 'Devis Camping', champs: { debut: '2026-11-21T14:00' } });
    assert.equal(app.monde.objetsReels().filter((o) => o.famille === 'tache' && o.champs.concerne === autre.json.id).length, 0);
    // une fiche qui n'est pas un rendez-vous est refusée
    assert.equal((await c.appel('POST', '/api/v1/taches/depuis-rendez-vous', { evenement: 'pr-hotel' })).json.erreur, 'pas_un_rendez_vous');
    assert.equal((await c.appel('POST', '/api/v1/taches/depuis-rendez-vous', { evenement: 'inconnu' })).statut, 404);
  } finally { await fermer(serveur); app.arreter(); }
});

// ---------------------------------------------------------------- les tâches qui viennent d'ailleurs : Notion

test('Notion : une base de notes alimente les tâches, avec la correspondance de colonnes habituelle', async () => {
  const app = await Application.creer({ exemple: 'pme', fetch: (async () => { throw new Error('aucun appel réseau attendu'); }) as typeof fetch });
  const p = app.monde.profil('dirigeante')!;
  const tache = defType(app.monde.univers, 'tache');
  assert.ok(tache, 'le type « Tâche » existe dans l’univers générique');
  assert.equal(tache.masque ?? false, false, 'il est donc proposé comme cible d’un connecteur');

  // les colonnes d'une base de notes Notion retombent toutes seules sur les champs d'une tâche
  const propose = proposerMapping(['Nom', 'Échéance', 'Statut', 'Note'], tache);
  assert.equal(propose.Nom, NOM, 'la colonne du titre devient le nom de la tâche');
  assert.equal(propose['Échéance'], 'echeance');
  assert.equal(propose.Statut, 'statut');
  assert.equal(propose.Note, null, 'une colonne sans équivalent reste à la personne : elle corrige avant d’importer');

  // le branchement s'enregistre comme les autres : lecture, correspondance, intervalle
  const c = app.synchro.creer(p, {
    source: 'notion', nom: 'Mes notes', config: { base: 'f'.repeat(32), jeton: ['ntn', 'essai', 'local'].join('_') },
    typeObjet: 'tache', roles: [], mapping: { Nom: NOM, 'Échéance': 'echeance', Statut: 'statut' }, sens: 'lecture', intervalleS: 300, actif: false,
  });
  assert.equal(c.typeObjet, 'tache');
  assert.deepEqual(app.synchro.lister(p).map((x) => [x.source, x.typeObjet]), [['notion', 'tache']]);
  // une cible inconnue du type est refusée (rien n'entre dans un champ qui n'existe pas)
  assert.throws(() => app.synchro.modifier(p, c.id, { mapping: { Nom: NOM, Prix: 'montant' } }), (e: { statut?: number; code?: string }) => e.statut === 400 && e.code === 'mapping_invalide');
});
