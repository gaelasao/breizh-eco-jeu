import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { request, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Application } from './application.ts';
import { ipClient } from './en-ligne.ts';
import { creerServeur, type OptionsServeur } from './http.ts';
import { Stockage } from './stockage.ts';
import { depuisBase32, totp } from './totp.ts';

async function demarrer(app: Application, o: Partial<OptionsServeur> = {}) {
  const serveur = creerServeur(app, { enLigne: false, proxy: false, ...o });
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  return { serveur, base: `http://127.0.0.1:${(serveur.address() as AddressInfo).port}` };
}
const fermer = (s: Server) => new Promise<void>((ok) => s.close(() => ok()));

function client(base: string, defaut: Record<string, string> = {}) {
  let cookie = '';
  const appel = async (methode: string, chemin: string, corps?: unknown, entetes: Record<string, string> = {}) => {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { ...defaut, ...(cookie ? { cookie } : {}), ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}), ...entetes },
      body: corps === undefined ? null : JSON.stringify(corps),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0] as string;
    const texte = await r.text();
    let json: any = null;
    try { json = JSON.parse(texte); } catch { /* statique */ }
    return { statut: r.status, json, texte, entetes: r.headers };
  };
  return { appel };
}

const MDP = 'une phrase assez longue';
const installation = { nom: 'Maël Le Bihan', entreprise: 'Menuiserie Kerlann', identifiant: 'mael@kerlann.example', motDePasse: MDP, depart: 'vide' };
const connexion = { identifiant: installation.identifiant, motDePasse: MDP };
/** Requête « depuis Internet », relayée par Caddy (qui ajoute l'adresse du client en dernier). */
const DISTANT = { 'x-forwarded-for': '203.0.113.9' };
/** Un code à 6 chiffres sûrement faux à l'instant t (hors de la fenêtre ±1 pas). */
const codeFaux = (secret: Buffer, t: number) => {
  const bons = new Set([-1, 0, 1].map((d) => totp(secret, t + d * 30_000)));
  for (let i = 0; ; i++) { const c = String(i).padStart(6, '0'); if (!bons.has(c)) return c; }
};
/** Active la validation en deux étapes pour la session de `c` ; renvoie le secret et les codes de récupération. */
async function activerDeuxEtapes(c: ReturnType<typeof client>, t: number) {
  const d = (await c.appel('POST', '/api/v1/compte/deux-etapes', {})).json;
  const secret = depuisBase32(d.secret);
  const r = await c.appel('POST', '/api/v1/compte/deux-etapes/confirmer', { code: totp(secret, t) });
  assert.equal(r.statut, 200);
  return { secret, codes: r.json.codes as string[], brut: d };
}

test('mode en ligne : code d’installation à usage unique (fichier 0600, refus sans ou avec un faux code, effacé après)', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-en-ligne-'));
  try {
    const app = await Application.creer({ dossier });
    const { serveur, base } = await demarrer(app, { enLigne: true, proxy: true, origine: 'https://jeu.exemple.fr' });
    try {
      const f = join(dossier, 'installation.txt');
      assert.equal(statSync(f).mode & 0o777, 0o600);
      const contenu = readFileSync(f, 'utf8');
      assert.match(contenu, /^[A-Za-z0-9_-]{43}\n$/, 'le code seul, puis un saut de ligne');
      const code = contenu.trim();
      // redémarrage avant l'installation (mise à jour du serveur) : même code, le lien affiché reste valable
      const relance = await demarrer(await Application.creer({ dossier }), { enLigne: true, proxy: true });
      await fermer(relance.serveur);
      assert.equal(readFileSync(f, 'utf8'), contenu, 'code repris au redémarrage');
      const c = client(base, DISTANT);
      const s0 = (await c.appel('GET', '/api/v1/session')).json;
      assert.equal(s0.surPlace, false);
      assert.equal(s0.enLigne, true);
      assert.equal(s0.installationADistance, true);
      assert.match(s0.aideInstallation, /installation\.txt/);
      assert.equal(s0.existant, null, 'rien de l’état à distance');
      // sans code, faux code : refusé
      assert.equal((await c.appel('POST', '/api/v1/installation', installation)).statut, 403);
      assert.equal((await c.appel('POST', '/api/v1/installation', installation, { 'x-lb-installation': 'A'.repeat(43) })).statut, 403);
      assert.equal((await c.appel('POST', '/api/v1/installation/restaurer', { fichier: {}, phrase: 'x' })).statut, 403);
      assert.equal((await c.appel('POST', '/api/v1/installation/verifier', {}, { 'x-lb-installation': code })).statut, 200, 'le bon code est reconnu');
      // le code ne doit jamais apparaître ailleurs que dans le fichier
      assert.ok(!JSON.stringify(s0).includes(code));
      const r = await c.appel('POST', '/api/v1/installation', installation, { 'x-lb-installation': code });
      assert.equal(r.statut, 200);
      assert.match(r.json.codeSecours, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){4}$/);
      assert.ok(!existsSync(f), 'fichier effacé dès l’installation');
      assert.equal((await client(base, DISTANT).appel('POST', '/api/v1/installation', { ...installation, identifiant: 'pirate' }, { 'x-lb-installation': code })).statut, 409);
      assert.equal((await client(base, DISTANT).appel('POST', '/api/v1/installation/verifier', {}, { 'x-lb-installation': code })).statut, 409);
      // page /installation servie (le code est dans le fragment, lu par la page)
      const page = await client(base, DISTANT).appel('GET', '/installation');
      assert.equal(page.statut, 200);
      assert.match(page.entetes.get('content-type') ?? '', /text\/html/);
    } finally { await fermer(serveur); app.arreter(); }
    // redémarrage une fois installé : pas de nouveau code
    const app2 = await Application.creer({ dossier });
    const s2 = await demarrer(app2, { enLigne: true, proxy: true });
    try { assert.ok(!existsSync(join(dossier, 'installation.txt'))); } finally { await fermer(s2.serveur); app2.arreter(); }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test('mode en ligne : sur place, l’installation reste possible sans code ; hors ligne, jamais à distance', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-en-ligne-sp-'));
  const local = mkdtempSync(join(tmpdir(), 'lb-local-'));
  try {
    const app = await Application.creer({ dossier });
    const { serveur, base } = await demarrer(app, { enLigne: true, proxy: true });
    try {
      assert.ok(existsSync(join(dossier, 'installation.txt')));
      assert.equal((await client(base).appel('POST', '/api/v1/installation', installation)).statut, 200, 'depuis le serveur lui-même (tunnel SSH)');
      assert.ok(!existsSync(join(dossier, 'installation.txt')));
    } finally { await fermer(serveur); }
    // jeu local (pas en ligne) : aucun fichier, installation à distance impossible même avec un code
    const app2 = await Application.creer({ dossier: local });
    const s2 = await demarrer(app2, { enLigne: false });
    try {
      assert.ok(!existsSync(join(local, 'installation.txt')));
      const r = await client(s2.base, DISTANT).appel('POST', '/api/v1/installation', installation, { 'x-lb-installation': 'A'.repeat(43) });
      assert.equal(r.statut, 403);
      assert.equal(r.json.erreur, 'sur_place');
      assert.equal((await client(s2.base, DISTANT).appel('GET', '/api/v1/session')).json.installationADistance, false);
    } finally { await fermer(s2.serveur); }
  } finally {
    rmSync(dossier, { recursive: true, force: true });
    rmSync(local, { recursive: true, force: true });
  }
});

test('proxy : blocage après 5 codes faux par adresse = DERNIÈRE valeur de X-Forwarded-For ; sans LB_PROXY, en-tête ignoré', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-proxy-'));
  try {
    const app = await Application.creer({ dossier });
    const { serveur, base } = await demarrer(app, { enLigne: true, proxy: true });
    try {
      const code = readFileSync(join(dossier, 'installation.txt'), 'utf8').trim();
      const c = client(base);
      const essai = (xff: string, k: string) => c.appel('POST', '/api/v1/installation/verifier', {}, { 'x-forwarded-for': xff, 'x-lb-installation': k });
      // le client invente la première valeur ; Caddy ajoute la vraie adresse (203.0.113.5) en dernier
      for (let i = 0; i < 5; i++) assert.equal((await essai(`198.51.100.${i}, 203.0.113.5`, 'B'.repeat(43))).statut, 403);
      assert.equal((await essai('10.0.0.1, 203.0.113.5', code)).statut, 429, 'adresse bloquée, même avec le bon code');
      assert.equal((await essai('203.0.113.5, 198.51.100.7', code)).statut, 200, 'autre adresse réelle : pas bloquée (la première valeur ne compte pas)');
    } finally { await fermer(serveur); }
  } finally { rmSync(dossier, { recursive: true, force: true }); }

  const d2 = mkdtempSync(join(tmpdir(), 'lb-proxy2-'));
  try {
    const app = await Application.creer({ dossier: d2 });
    const { serveur, base } = await demarrer(app, { enLigne: true, proxy: false });
    try {
      const code = readFileSync(join(d2, 'installation.txt'), 'utf8').trim();
      const c = client(base);
      for (let i = 0; i < 5; i++) await c.appel('POST', '/api/v1/installation/verifier', {}, { 'x-forwarded-for': `198.51.100.${i}`, 'x-lb-installation': 'B'.repeat(43) });
      assert.equal((await c.appel('POST', '/api/v1/installation/verifier', {}, { 'x-forwarded-for': '192.0.2.200', 'x-lb-installation': code })).statut, 429, 'sans LB_PROXY : adresse de la connexion, X-Forwarded-For ignoré');
    } finally { await fermer(serveur); }
  } finally { rmSync(d2, { recursive: true, force: true }); }

  const req = (adresse: string, xff?: string | string[]) => ({ socket: { remoteAddress: adresse }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } }) as unknown as IncomingMessage;
  assert.equal(ipClient(req('127.0.0.1', '1.2.3.4, 5.6.7.8'), true), '5.6.7.8');
  assert.equal(ipClient(req('127.0.0.1', '1.2.3.4, 5.6.7.8'), false), '127.0.0.1');
  assert.equal(ipClient(req('127.0.0.1', ['1.1.1.1', '2001:db8::1']), true), '2001:db8::1');
  assert.equal(ipClient(req('127.0.0.1', 'pas-une-adresse'), true), '127.0.0.1', 'valeur illisible : adresse de la connexion');
  assert.equal(ipClient(req('::1'), true), '::1');
});

test('mode en ligne : restaurer la sauvegarde de l’ordinateur à distance (avec le code), validation en deux étapes reprise', async () => {
  let t = Date.UTC(2026, 10, 10, 9, 0, 0);
  const local = await Application.creer({ connexion: 'comptes', horloge: () => t });
  const sl = await demarrer(local);
  let fichier: unknown;
  let secret: Buffer;
  try {
    const a = client(sl.base);
    await a.appel('POST', '/api/v1/installation', installation);
    await a.appel('POST', '/api/v1/objets', { type: 'entreprise', nom: 'Client A', roles: ['client'], champs: {} });
    ({ secret } = await activerDeuxEtapes(a, t));
    t += 30_000;
    // emporter sur le serveur : la copie contient la clé des accès (phrase de 16 caractères, mot de passe ET code)
    fichier = (await a.appel('POST', '/api/v1/sauvegardes/export', { phrase: 'phrase de protection 2026', avecAcces: true, motDePasse: MDP, code: totp(secret, t) })).json;
  } finally { await fermer(sl.serveur); }

  const dossier = mkdtempSync(join(tmpdir(), 'lb-migration-'));
  try {
    const srv = await Application.creer({ dossier, horloge: () => t });
    const { serveur, base } = await demarrer(srv, { enLigne: true, proxy: true });
    try {
      const code = readFileSync(join(dossier, 'installation.txt'), 'utf8').trim();
      const c = client(base, DISTANT);
      assert.equal((await c.appel('POST', '/api/v1/installation/restaurer', { fichier, phrase: 'phrase de protection 2026' })).statut, 403, 'sans code');
      assert.equal((await c.appel('POST', '/api/v1/installation/restaurer', { fichier, phrase: 'mauvaise phrase !!' }, { 'x-lb-installation': code })).statut, 400);
      assert.ok(existsSync(join(dossier, 'installation.txt')), 'échec : le code reste valable');
      const r = await c.appel('POST', '/api/v1/installation/restaurer', { fichier, phrase: 'phrase de protection 2026' }, { 'x-lb-installation': code });
      assert.equal(r.statut, 200);
      assert.equal(r.json.installe, true);
      assert.ok(!existsSync(join(dossier, 'installation.txt')));
      // connexion habituelle : mot de passe, puis le code du même téléphone (secret ré-chiffré pour le serveur)
      const s = await c.appel('POST', '/api/v1/session', connexion);
      assert.equal(s.json.deuxEtapes, true);
      t += 30_000;
      assert.equal((await c.appel('POST', '/api/v1/session/code', { code: totp(secret!, t) })).statut, 200);
      const m = (await c.appel('GET', '/api/v1/monde')).json;
      assert.ok(m.objets.some((o: any) => o.nom === 'Client A'));
      assert.equal(m.enLigne, true);
      assert.equal(m.suggestionEnLigne, false, 'déjà en ligne : pas de suggestion');
    } finally { await fermer(serveur); }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test('mode en ligne : secours depuis le serveur (lien LB_ORIGINE, à distance, une fois) ; remet à zéro les deux étapes', async () => {
  let t = Date.UTC(2026, 10, 10, 9, 0, 0);
  const dossier = mkdtempSync(join(tmpdir(), 'lb-secours-en-ligne-'));
  try {
    const app = await Application.creer({ dossier, horloge: () => t });
    const { serveur, base } = await demarrer(app, { enLigne: true, proxy: true });
    try {
      const a = client(base);
      await a.appel('POST', '/api/v1/installation', installation);
      await activerDeuxEtapes(a, t);
      app.stockage?.ecrireMaintenant();
      const c = client(base, DISTANT);
      assert.equal((await c.appel('GET', `/api/v1/secours-local/${'x'.repeat(43)}`)).statut, 404);
      // la commande de secours, lancée sur le serveur, affiche le lien public
      const sortie = execFileSync(process.execPath, [fileURLToPath(new URL('./secours.ts', import.meta.url))], {
        env: { ...process.env, LB_DONNEES: dossier, LB_EN_LIGNE: '1', LB_ORIGINE: 'https://jeu.exemple.fr' }, encoding: 'utf8',
      });
      const m = /https:\/\/jeu\.exemple\.fr\/secours\/([A-Za-z0-9_-]{43})/.exec(sortie);
      assert.ok(m, sortie);
      const jeton = m[1] as string;
      assert.deepEqual((await c.appel('GET', `/api/v1/secours-local/${jeton}`)).json.comptes, [{ identifiant: 'mael@kerlann.example' }], 'à distance, avec le lien du serveur');
      assert.equal((await c.appel('POST', `/api/v1/secours-local/${jeton}`, { identifiant: 'mael@kerlann.example', motDePasse: 'phrase de secours en ligne' })).statut, 200);
      const s = (await c.appel('GET', '/api/v1/session')).json;
      assert.equal(s.deuxEtapesRequise, true, 'deux étapes remises à zéro : à refaire tout de suite (administrateur en ligne)');
      assert.equal((await c.appel('GET', '/api/v1/compte')).json.erreur, 'deux_etapes_requise');
      assert.equal(app.comptes.resumeDeuxEtapes(app.comptes.parId(app.comptes.instantane().comptes[0]!.id)!).active, false);
      assert.equal((await client(base, DISTANT).appel('GET', `/api/v1/secours-local/${jeton}`)).statut, 404, 'une seule fois');
      // sans lien valable : 5 essais par adresse, puis blocage
      const p = client(base, { 'x-forwarded-for': '198.51.100.66' });
      for (let i = 0; i < 5; i++) assert.equal((await p.appel('GET', `/api/v1/secours-local/${String(i).repeat(43)}`)).statut, 404);
      assert.equal((await p.appel('GET', `/api/v1/secours-local/${'z'.repeat(43)}`)).statut, 429);
    } finally { await fermer(serveur); }
  } finally { rmSync(dossier, { recursive: true, force: true }); }
});

test('validation en deux étapes : activation (QR, secret jamais renvoyé), connexion avec code, codes de récupération à usage unique, désactivation', async () => {
  let t = Date.UTC(2026, 10, 10, 9, 0, 0);
  const app = await Application.creer({ connexion: 'comptes', horloge: () => t });
  const { serveur, base } = await demarrer(app);
  try {
    const a = client(base);
    await a.appel('POST', '/api/v1/installation', installation);
    let compte = (await a.appel('GET', '/api/v1/compte')).json;
    assert.deepEqual(compte.deuxEtapes, { active: false, activeLe: null, codesRestants: 0, obligatoire: false }, 'jeu local : recommandée, pas obligatoire');
    assert.equal((await a.appel('GET', '/api/v1/monde')).statut, 200);
    const d = (await a.appel('POST', '/api/v1/compte/deux-etapes', {})).json;
    assert.match(d.secret, /^[A-Z2-7]{32}$/, '160 bits en base32');
    assert.match(d.uri, /^otpauth:\/\/totp\/Living%20Business%20\(Menuiserie%20Kerlann\):mael%40kerlann\.example\?secret=[A-Z2-7]{32}&issuer=/);
    assert.match(Buffer.from(d.qr.split(',')[1], 'base64').toString('utf8'), /^<svg /);
    const secret = depuisBase32(d.secret);
    assert.equal((await a.appel('POST', '/api/v1/compte/deux-etapes/confirmer', { code: codeFaux(secret, t) })).statut, 401);
    const conf = await a.appel('POST', '/api/v1/compte/deux-etapes/confirmer', { code: totp(secret, t) });
    assert.equal(conf.statut, 200);
    const codes = conf.json.codes as string[];
    assert.equal(codes.length, 8);
    for (const x of codes) assert.match(x, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal((await a.appel('GET', '/api/v1/monde')).statut, 200, 'la session qui active reste ouverte');
    compte = (await a.appel('GET', '/api/v1/compte')).json;
    assert.equal(compte.deuxEtapes.active, true);
    assert.equal(compte.deuxEtapes.codesRestants, 8);
    assert.equal((await a.appel('POST', '/api/v1/compte/deux-etapes', {})).statut, 409, 'pas de second secret sans désactiver');
    const etat = JSON.stringify(app.instantane());
    assert.ok(!etat.includes(d.secret) && !codes.some((x) => etat.includes(x)), 'ni le secret ni les codes en clair dans l’enregistrement');

    // connexion : mot de passe, puis code ; rien n'est accessible entre les deux
    const b = client(base);
    const r1 = await b.appel('POST', '/api/v1/session', connexion);
    assert.equal(r1.json.deuxEtapes, true);
    assert.equal(r1.json.profil, undefined);
    assert.equal((await b.appel('GET', '/api/v1/monde')).statut, 401);
    assert.equal((await b.appel('GET', '/api/v1/session')).json.attenteCode, true);
    assert.equal((await b.appel('GET', '/api/v1/session')).json.profil, null);
    assert.equal((await b.appel('POST', '/api/v1/session/code', { code: totp(secret, t) })).statut, 401, 'code déjà utilisé (activation) : refusé');
    t += 30_000;
    const r2 = await b.appel('POST', '/api/v1/session/code', { code: totp(secret, t) });
    assert.equal(r2.statut, 200);
    assert.equal(r2.json.profil.nom, 'Maël Le Bihan');
    assert.equal((await b.appel('GET', '/api/v1/monde')).statut, 200);
    // sans mot de passe vérifié : pas de deuxième étape
    assert.equal((await client(base).appel('POST', '/api/v1/session/code', { code: '123456' })).statut, 401);

    // code de récupération : une seule fois
    const c = client(base);
    await c.appel('POST', '/api/v1/session', connexion);
    const r3 = await c.appel('POST', '/api/v1/session/code', { code: (codes[0] as string).toLowerCase().replace('-', ' ') });
    assert.equal(r3.statut, 200);
    assert.equal(r3.json.recuperation, true);
    assert.equal(r3.json.codesRestants, 7);
    const c2 = client(base);
    await c2.appel('POST', '/api/v1/session', connexion);
    assert.equal((await c2.appel('POST', '/api/v1/session/code', { code: codes[0] })).statut, 401, 'déjà utilisé');
    t += 30_000;
    assert.equal((await c2.appel('POST', '/api/v1/session/code', { code: totp(secret, t) })).statut, 200);

    // nouveaux codes : mot de passe exigé, les anciens ne marchent plus
    assert.equal((await b.appel('POST', '/api/v1/compte/deux-etapes/codes', { motDePasse: 'pas le bon mot' })).statut, 401);
    const nouveaux = (await b.appel('POST', '/api/v1/compte/deux-etapes/codes', { motDePasse: MDP })).json.codes as string[];
    assert.equal(nouveaux.length, 8);
    const c3 = client(base);
    await c3.appel('POST', '/api/v1/session', connexion);
    assert.equal((await c3.appel('POST', '/api/v1/session/code', { code: codes[1] })).statut, 401);
    assert.equal((await c3.appel('POST', '/api/v1/session/code', { code: nouveaux[0] })).statut, 200);

    // désactivation : mot de passe ET code valable
    t += 30_000;
    assert.equal((await b.appel('POST', '/api/v1/compte/deux-etapes/desactiver', { motDePasse: 'pas le bon mot', code: totp(secret, t) })).statut, 401);
    assert.equal((await b.appel('POST', '/api/v1/compte/deux-etapes/desactiver', { motDePasse: MDP, code: codeFaux(secret, t) })).statut, 401);
    const off = await b.appel('POST', '/api/v1/compte/deux-etapes/desactiver', { motDePasse: MDP, code: totp(secret, t) });
    assert.equal(off.statut, 200);
    assert.equal(off.json.obligatoire, false);
    const r4 = await client(base).appel('POST', '/api/v1/session', connexion);
    assert.equal(r4.json.profil.nom, 'Maël Le Bihan', 'de nouveau le mot de passe seul');
  } finally { await fermer(serveur); }
});

test('validation en deux étapes : 5 codes faux → compte bloqué 15 min ; le code de secours la remet à zéro', async () => {
  let t = Date.UTC(2026, 10, 10, 9, 0, 0);
  const app = await Application.creer({ connexion: 'comptes', horloge: () => t });
  const { serveur, base } = await demarrer(app);
  try {
    const a = client(base);
    const codeSecours = (await a.appel('POST', '/api/v1/installation', installation)).json.codeSecours;
    const { secret } = await activerDeuxEtapes(a, t);
    const b = client(base);
    await b.appel('POST', '/api/v1/session', connexion);
    for (let i = 0; i < 5; i++) assert.equal((await b.appel('POST', '/api/v1/session/code', { code: codeFaux(secret, t) })).statut, 401);
    t += 30_000;
    assert.equal((await b.appel('POST', '/api/v1/session/code', { code: totp(secret, t) })).statut, 429, 'bloqué, même avec le bon code');
    // téléphone perdu : le code de secours change le mot de passe et retire la validation en deux étapes
    const c = client(base);
    assert.equal((await c.appel('POST', '/api/v1/secours', { identifiant: installation.identifiant, code: codeSecours, motDePasse: 'nouvelle phrase secrète' })).statut, 200);
    assert.equal((await c.appel('GET', '/api/v1/compte')).json.deuxEtapes.active, false);
    assert.ok((await client(base).appel('POST', '/api/v1/session', { identifiant: installation.identifiant, motDePasse: 'nouvelle phrase secrète' })).json.profil);
  } finally { await fermer(serveur); }
});

test('mode en ligne : validation en deux étapes obligatoire pour les administrateurs (rien d’autre avant), facultative pour les autres', async () => {
  let t = Date.UTC(2026, 10, 10, 9, 0, 0);
  const app = await Application.creer({ connexion: 'comptes', horloge: () => t });
  const { serveur, base } = await demarrer(app, { enLigne: true, proxy: true });
  try {
    const a = client(base);
    const r = await a.appel('POST', '/api/v1/installation', installation);
    assert.equal(r.json.deuxEtapesRequise, true);
    assert.equal((await a.appel('GET', '/api/v1/session')).json.deuxEtapesRequise, true);
    for (const [m, ch] of [['GET', '/api/v1/monde'], ['GET', '/api/v1/acces'], ['GET', '/api/v1/sauvegardes'], ['GET', '/api/v1/compte'], ['POST', '/api/v1/cles']] as const) {
      const x = await a.appel(m, ch, m === 'GET' ? undefined : {});
      assert.equal(x.statut, 403, ch);
      assert.equal(x.json.erreur, 'deux_etapes_requise');
    }
    const { secret } = await activerDeuxEtapes(a, t);
    assert.equal((await a.appel('GET', '/api/v1/session')).json.deuxEtapesRequise, false);
    assert.equal((await a.appel('GET', '/api/v1/monde')).statut, 200);
    assert.equal((await a.appel('GET', '/api/v1/compte')).json.deuxEtapes.obligatoire, true);
    // un collègue sans droits d'administration : pas obligé
    const p = (await a.appel('POST', '/api/v1/acces', { nom: 'Morgane — accueil', role: 'collaborateur', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous' })).json;
    const jeton = (await a.appel('POST', `/api/v1/acces/${p.id}/invitation`, { identifiant: 'morgane@kerlann.example' })).json.lien.split('/').pop();
    const m = client(base, DISTANT);
    assert.equal((await m.appel('POST', `/api/v1/invitation/${jeton}`, { motDePasse: 'le café du matin à 8h' })).statut, 200);
    assert.equal((await m.appel('GET', '/api/v1/session')).json.deuxEtapesRequise, false);
    assert.equal((await m.appel('GET', '/api/v1/monde')).statut, 200);
    assert.equal((await m.appel('GET', '/api/v1/compte')).json.deuxEtapes.obligatoire, false);
    // l'administrateur désactive (changement de téléphone) : bloqué de nouveau jusqu'à la nouvelle activation
    t += 30_000;
    const off = await a.appel('POST', '/api/v1/compte/deux-etapes/desactiver', { motDePasse: MDP, code: totp(secret, t) });
    assert.equal(off.json.obligatoire, true);
    assert.equal((await a.appel('GET', '/api/v1/monde')).statut, 403);
    t += 30_000;
    await activerDeuxEtapes(a, t);
    assert.equal((await a.appel('GET', '/api/v1/monde')).statut, 200);
    // les droits d'administration donnés au collègue : il doit activer à son tour
    assert.equal((await a.appel('PUT', `/api/v1/acces/${p.id}`, { peutAdministrer: true })).statut, 200);
    assert.equal((await m.appel('GET', '/api/v1/monde')).statut, 403);
    // équipe et réseau : en ligne, pas de mode équipe ; pas de page « Mettre en ligne »
    const reseau = (await a.appel('GET', '/api/v1/reseau')).json;
    assert.equal(reseau.enLigne, true);
    assert.equal(reseau.disponible, false);
    assert.equal((await a.appel('GET', '/api/v1/en-ligne')).json.enLigne, true);
  } finally { await fermer(serveur); }
});

test('« Mettre en ligne » : adresse de Breizhcosystem, nom de la machine, suggestion refermée côté serveur', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app);
  try {
    const a = client(base);
    await a.appel('POST', '/api/v1/installation', installation);
    const i = (await a.appel('GET', '/api/v1/en-ligne')).json;
    assert.equal(i.enLigne, false);
    assert.ok('nexus' in i && 'nomMachine' in i);
    assert.ok(Array.isArray(i.signataires), 'clé de signature de l’éditeur (vide tant qu’elle n’est pas publiée)');
    assert.equal(typeof i.port, 'number');
    assert.equal(i.entreprise, 'Menuiserie Kerlann');
    assert.equal(i.suggestionMasquee, false);
    assert.equal((await a.appel('GET', '/api/v1/monde')).json.suggestionEnLigne, true);
    assert.equal((await a.appel('PUT', '/api/v1/en-ligne/suggestion', { masquee: true })).json.suggestionMasquee, true);
    assert.equal((await a.appel('GET', '/api/v1/monde')).json.suggestionEnLigne, false);
    assert.equal(app.instantane().reglages?.suggestionEnLigneMasquee, true, 'retenu (enregistré)');
  } finally { await fermer(serveur); }
});

test('application installable : manifeste, icônes PNG, service worker, page hors ligne (types et CSP)', async () => {
  const app = await Application.creer();
  const { serveur, base } = await demarrer(app);
  try {
    const c = client(base);
    const index = await c.appel('GET', '/');
    assert.match(index.texte, /<link rel="manifest" href="\/manifest\.webmanifest">/);
    assert.match(index.texte, /<link rel="apple-touch-icon" href="\/apple-touch-icon\.png">/);
    assert.match(index.texte, /<meta name="theme-color" content="#f9f6f2" media="\(prefers-color-scheme: light\)">/, 'theme-color clair (§2.3)');
    assert.match(index.texte, /<meta name="theme-color" content="#091115" media="\(prefers-color-scheme: dark\)">/, 'theme-color sombre (§2.3)');
    const csp = index.entetes.get('content-security-policy') ?? '';
    assert.match(csp, /default-src 'self'/, 'manifeste (manifest-src) autorisé');
    assert.match(csp, /script-src 'self'/, 'service worker (worker-src) autorisé');
    assert.match(csp, /img-src 'self' data:/, 'QR code en adresse data:');
    const man = await c.appel('GET', '/manifest.webmanifest');
    assert.equal(man.statut, 200);
    assert.match(man.entetes.get('content-type') ?? '', /^application\/manifest\+json/);
    assert.equal(man.json.name, 'Living Business');
    assert.equal(man.json.start_url, '/');
    assert.equal(man.json.display, 'standalone');
    assert.match(man.json.theme_color, /^#[0-9a-f]{6}$/);
    const icones = [...man.json.icons, { src: '/apple-touch-icon.png', sizes: '180x180' }];
    assert.ok(man.json.icons.some((x: any) => x.purpose === 'maskable' && x.sizes === '512x512'));
    assert.ok(man.json.icons.some((x: any) => x.purpose === 'any' && x.sizes === '192x192'));
    for (const ic of icones) {
      const r = await fetch(base + ic.src);
      assert.equal(r.status, 200, ic.src);
      assert.equal(r.headers.get('content-type'), 'image/png');
      const b = Buffer.from(await r.arrayBuffer());
      assert.deepEqual([...b.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'signature PNG');
      assert.equal(`${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`, ic.sizes, ic.src);
    }
    const sw = await c.appel('GET', '/sw.js');
    assert.equal(sw.statut, 200);
    assert.match(sw.entetes.get('content-type') ?? '', /^text\/javascript/);
    assert.match(sw.texte, /startsWith\('\/api\/'\)/, 'l’API n’est jamais mise en cache');
    assert.match(sw.texte, /'\/hors-ligne\.html'/);
    const hl = await c.appel('GET', '/hors-ligne.html');
    assert.equal(hl.statut, 200);
    assert.match(hl.texte, /Pas de connexion/);
    assert.ok(!/<script(?![^>]*\bsrc="\/bz\/theme\.js")|style=|<style/.test(hl.texte), 'compatible CSP : ni script ni style en ligne (seul /bz/theme.js, fichier en cache)');
    assert.equal((await c.appel('GET', '/hors-ligne.css')).statut, 200);
    for (const f of ['/bz/bz.css', '/bz/theme.js']) assert.ok(sw.texte.includes(`'${f}'`), `${f} gardé pour la page hors ligne`);
  } finally { await fermer(serveur); }
});

test('GET /api/v1/vivant : public, sans donnée, quel que soit le nom d’hôte (ce chemin seulement)', async () => {
  const app = await Application.creer({ connexion: 'comptes' });
  const { serveur, base } = await demarrer(app, { enLigne: true, proxy: true });
  const port = new URL(base).port;
  const appel = (methode: string, chemin: string, host: string) => new Promise<{ statut: number; corps: string; type: string }>((ok, ko) => {
    const r = request({ host: '127.0.0.1', port, path: chemin, method: methode, headers: { host } }, (res) => {
      let corps = '';
      res.on('data', (x: Buffer) => { corps += x.toString(); });
      res.on('end', () => ok({ statut: res.statusCode ?? 0, corps, type: String(res.headers['content-type']) }));
    });
    r.on('error', ko);
    r.end();
  });
  try {
    const v = await appel('GET', '/api/v1/vivant', `127.0.0.1:${port}`);
    assert.equal(v.statut, 200);
    assert.deepEqual(JSON.parse(v.corps), { ok: true });
    assert.match(v.type, /application\/json/);
    assert.equal((await appel('GET', '/api/v1/vivant', 'pirate.example')).statut, 200);
    assert.equal((await appel('HEAD', '/api/v1/vivant', 'pirate.example')).statut, 200);
    assert.equal((await appel('GET', '/api/v1/session', 'pirate.example')).statut, 421, 'les autres chemins restent protégés');
    assert.equal((await appel('POST', '/api/v1/vivant', 'pirate.example')).statut, 421);
  } finally { await fermer(serveur); }
});
