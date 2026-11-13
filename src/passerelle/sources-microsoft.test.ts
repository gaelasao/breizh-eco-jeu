/**
 * Excel Microsoft 365 et Google Sheets (script) : `fetch` simulé, aucun appel réseau.
 * Vérifie que tout passe par les identifiants de l'ENTREPRISE (application de son annuaire, script de sa feuille),
 * que les secrets ne sortent jamais dans une adresse et que la rotation du jeton Microsoft est enregistrée.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellule, debutPlage, demarrerConnexionMicrosoft, excel365, idPartage, indexColonne, lettreColonne, oublierJetonsMicrosoft, suivreConnexionMicrosoft } from './sources-microsoft.ts';
import { ADAPTATEURS, SCRIPT_SHEETS } from './sources.ts';

interface Appel { url: URL; methode: string; entetes: Headers; corps: any; brut: string }
function simuler(repondre: (a: Appel, n: number) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const entetes = new Headers(init?.headers);
    const brut = init?.body ? String(init.body) : '';
    const type = entetes.get('content-type') ?? '';
    const corps = !brut ? null : type.includes('json') ? JSON.parse(brut) : type.includes('form') ? Object.fromEntries(new URLSearchParams(brut)) : brut;
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes, corps, brut };
    appels.push(a);
    return repondre(a, appels.length - 1);
  }) as typeof fetch;
  return { f, appels };
}
const json = (corps: unknown, statut = 200, entetes: Record<string, string> = {}) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json', ...entetes } });

const TENANT = '11111111-2222-4333-8444-555555555555';
const CLIENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const LIEN = 'https://kerlann.sharepoint.com/:x:/s/compta/EabcDEF123?e=xyz';
const CFG = { tenant: TENANT, client: CLIENT, fichier: LIEN, colonneId: 'Référence' };

test('Excel 365 : utilitaires (colonnes, plage, cellules, lien de partage)', () => {
  assert.equal(lettreColonne(0), 'A');
  assert.equal(lettreColonne(25), 'Z');
  assert.equal(lettreColonne(26), 'AA');
  assert.equal(lettreColonne(701), 'ZZ');
  assert.equal(indexColonne('AA'), 26);
  assert.deepEqual(debutPlage("'Mes clients'!B3:F40"), { ligne0: 3, col0: 1 });
  assert.equal(cellule(45966, '05/11/2025'), '05/11/2025', 'date affichée');
  assert.equal(cellule(1234.5, '1 234,50 €'), '1234.5', 'nombre brut');
  assert.equal(cellule(true, 'VRAI'), 'oui');
  assert.equal(idPartage(LIEN), `u!${Buffer.from(LIEN).toString('base64url')}`);
  assert.throws(() => idPartage('https://evil.example/x'), /OneDrive ou SharePoint/);
  assert.throws(() => idPartage('http://kerlann.sharepoint.com/x'), /OneDrive ou SharePoint/);
  // OneDrive personnel : Microsoft n'y ouvre pas l'API Excel — refus immédiat, avec la marche à suivre (avant : accepté, puis échec obscur)
  for (const perso of ['https://onedrive.live.com/edit.aspx?resid=ABC', 'https://1drv.ms/x/s!Abc']) assert.throws(() => idPartage(perso), /OneDrive personnel.*professionnel/);
  assert.equal(ADAPTATEURS.excel365, excel365);
  assert.equal(excel365.champs.find((c) => c.secret)?.connexion, 'microsoft', 'secret obtenu par connexion, jamais collé');
});

test('Excel 365 : connexion par code d’appareil avec l’application inscrite par l’entreprise (aucun secret d’application)', async () => {
  let valide = false;
  const { f, appels } = simuler((a) => {
    assert.equal(a.url.host, 'login.microsoftonline.com');
    assert.equal(a.url.pathname.split('/')[1], TENANT);
    if (a.url.pathname.endsWith('/devicecode')) return json({ device_code: 'DC-123', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 });
    if (!valide) return json({ error: 'authorization_pending' }, 400);
    return json({ access_token: 'AT-1', refresh_token: 'RT-1-xxxxxxxx', expires_in: 3600 });
  });
  const d = await demarrerConnexionMicrosoft(CFG, f);
  assert.deepEqual({ code: d.code, url: d.url, intervalle: d.intervalle }, { code: 'ABCD-EFGH', url: 'https://microsoft.com/devicelogin', intervalle: 5 });
  assert.equal(appels[0]?.corps.client_id, CLIENT);
  assert.match(appels[0]?.corps.scope, /offline_access .*Files\.ReadWrite\.All/);
  assert.equal(appels[0]?.corps.client_secret, undefined, 'aucun secret d’application');
  assert.deepEqual(await suivreConnexionMicrosoft(CFG, d.deviceCode, f), { statut: 'attente' });
  valide = true;
  const r = await suivreConnexionMicrosoft(CFG, d.deviceCode, f);
  assert.equal(r.statut, 'connecte');
  assert.deepEqual(JSON.parse((r as { secret: string }).secret), { r: 'RT-1-xxxxxxxx' });
  assert.equal(appels[1]?.corps.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
});

test('Excel 365 : messages utiles quand l’application est mal réglée, page de connexion inattendue refusée', async () => {
  const { f } = simuler(() => json({ error: 'invalid_client', error_description: 'AADSTS7000218: The request body must contain client_assertion or client_secret.' }, 401));
  await assert.rejects(demarrerConnexionMicrosoft(CFG, f), /Autoriser les flux de clients publics/);
  const piege = simuler(() => json({ device_code: 'x', user_code: 'ABCD-EFGH', verification_uri: 'https://evil.example/devicelogin', expires_in: 900, interval: 5 }));
  await assert.rejects(demarrerConnexionMicrosoft(CFG, piege.f), /inattendue/);
  await assert.rejects(demarrerConnexionMicrosoft({ ...CFG, client: 'pas-un-guid' }, piege.f), /ID d’application invalide/);
});

function graphSimule(etat: { feuille: unknown[][] }) {
  return simuler((a) => {
    if (a.url.host === 'login.microsoftonline.com') {
      assert.equal(a.corps.grant_type, 'refresh_token');
      return json({ access_token: `AT-${a.corps.refresh_token}`, refresh_token: `${a.corps.refresh_token}-suivant`, expires_in: 3600 });
    }
    assert.equal(a.url.host, 'graph.microsoft.com');
    assert.match(a.entetes.get('authorization') ?? '', /^Bearer AT-/);
    const p = decodeURIComponent(a.url.pathname);
    if (p.startsWith('/v1.0/shares/u!')) return json({ id: 'ITEM1', parentReference: { driveId: 'b!DRIVE' } });
    if (p.endsWith('/workbook/worksheets')) return json({ value: [{ name: 'Clients' }] });
    if (p.endsWith('/worksheets/Clients/usedRange(valuesOnly=true)')) return json({ address: 'Clients!A1:C3', values: etat.feuille, text: etat.feuille.map((l) => l.map(String)) });
    if (a.methode === 'PATCH' && /\/worksheets\/Clients\/range\(address='A\d+:C\d+'\)$/.test(p)) return json({});
    return json({ error: { code: 'itemNotFound' } }, 404);
  });
}

test('Excel 365 : lecture et écriture via Graph, cellules non synchronisées laissées intactes, rotation du jeton enregistrée', async () => {
  oublierJetonsMicrosoft();
  const etat = { feuille: [['Référence', 'Nom', 'Ville'], ['C-1', 'Cave du Port', 'Brest'], ['C-2', 'Hôtel Ty Mad', 'Douarnenez']] as unknown[][] };
  const { f, appels } = graphSimule(etat);
  const nouveaux: string[] = [];
  const ctx = { majSecret: (s: string) => nouveaux.push(s) };
  const lus = await excel365.lire(CFG, JSON.stringify({ r: 'RT-0-initial' }), f, ctx);
  assert.deepEqual(lus.map((l) => [l.externeId, l.champs.Nom]), [['C-1', 'Cave du Port'], ['C-2', 'Hôtel Ty Mad']]);
  assert.deepEqual(nouveaux.map((s) => JSON.parse(s).r), ['RT-0-initial-suivant'], 'nouveau jeton de rafraîchissement enregistré');
  // mise à jour : seule la colonne Ville est envoyée, les autres restent null (inchangées)
  await excel365.ecrire?.(CFG, nouveaux[0] as string, 'C-2', { Ville: 'Quimper' }, f, ctx);
  const maj = appels.find((a) => a.methode === 'PATCH');
  assert.match(decodeURIComponent(maj?.url.pathname ?? ''), /range\(address='A3:C3'\)$/);
  assert.deepEqual(maj?.corps, { values: [[null, null, 'Quimper']] });
  // création : ligne suivante, identifiant renseigné
  await excel365.ecrire?.(CFG, nouveaux[0] as string, null, { Référence: 'C-3', Nom: 'Ferme de Kerroc’h' }, f, ctx);
  const cree = appels.filter((a) => a.methode === 'PATCH').at(-1);
  assert.match(decodeURIComponent(cree?.url.pathname ?? ''), /range\(address='A4:C4'\)$/);
  assert.deepEqual(cree?.corps, { values: [['C-3', 'Ferme de Kerroc’h', null]] });
  for (const a of appels) assert.ok(!a.url.href.includes('RT-'), 'jeton jamais dans une adresse');
});

// ---------------------------------------------------------------- Google Sheets par script

const SCRIPT = 'https://script.google.com/macros/s/AKfycbx1234567890abcdef/exec';
function scriptSimule(feuille: string[][], secretAttendu: string) {
  return simuler((a) => {
    if (a.url.host === 'script.google.com') {
      if (a.corps.secret !== secretAttendu) return new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/macros/echo?user_content_key=REFUS' } });
      return new Response(null, { status: 302, headers: { location: `https://script.googleusercontent.com/macros/echo?user_content_key=${a.corps.action === 'lire' ? 'LIRE' : 'OK'}` } });
    }
    assert.equal(a.url.host, 'script.googleusercontent.com');
    const k = a.url.searchParams.get('user_content_key');
    return json(k === 'REFUS' ? { erreur: 'secret' } : k === 'LIRE' ? { lignes: feuille } : { ok: true });
  });
}

test('Google Sheets : lecture et écriture par le script de la feuille, sans publication sur le Web', async () => {
  const secret = 'b'.repeat(48);
  const { f, appels } = scriptSimule([['Référence', 'Nom'], ['C-1', 'Cave du Port'], ['', 'ligne vide ignorée']], secret);
  const lus = await ADAPTATEURS.sheets.lire({ script: SCRIPT, colonneId: 'Référence' }, secret, f);
  assert.deepEqual(lus, [{ externeId: 'C-1', champs: { Référence: 'C-1', Nom: 'Cave du Port' } }]);
  assert.equal(await ADAPTATEURS.sheets.ecrire?.({ script: SCRIPT, colonneId: 'Référence' }, secret, 'C-1', { Nom: 'Cave du Port SARL' }, f), 'C-1');
  const ecrit = appels.filter((a) => a.url.host === 'script.google.com').at(-1);
  assert.deepEqual({ ...ecrit?.corps, secret: '…' }, { action: 'ecrire', feuille: '', colonneId: 'Référence', externeId: 'C-1', valeurs: { Nom: 'Cave du Port SARL' }, secret: '…' });
  for (const a of appels) assert.ok(!a.url.href.includes(secret), 'secret jamais dans une adresse');
  await assert.rejects(ADAPTATEURS.sheets.lire({ script: SCRIPT }, 'mauvais-secret', f), /Secret refusé/);
});

test('Google Sheets : adresses refusées (autre hôte, redirection détournée) et secret pré-rempli dans le script', async () => {
  const { f } = scriptSimule([], 's');
  await assert.rejects(ADAPTATEURS.sheets.lire({ script: 'https://evil.example/macros/s/AKfycbx1234567890abcdef/exec' }, 's', f), /script Google invalide/);
  await assert.rejects(ADAPTATEURS.sheets.lire({ script: 'https://script.google.com/a/autre' }, 's', f), /script Google invalide/);
  const detourne = simuler(() => new Response(null, { status: 302, headers: { location: 'https://evil.example/vol' } }));
  await assert.rejects(ADAPTATEURS.sheets.lire({ script: SCRIPT }, 's', detourne.f), /Redirection inattendue/);
  assert.ok(SCRIPT_SHEETS.includes("const SECRET = 'COLLEZ_ICI_LE_SECRET_AFFICHE_DANS_LIVING_BUSINESS';"), 'emplacement remplacé par le jeu');
  assert.ok(SCRIPT_SHEETS.includes('d.secret !== SECRET'));
});
