import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import type { NetworkInterfaceInfo } from 'node:os';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { contenuDemarrage, demarrageActif, fichierDemarrage, regleDemarrage, reparerDemarrage } from './demarrage.ts';
import { lancer } from './lancement.ts';
import { adressesBureau, nomsMachine } from './reseau.ts';

const carte = (address: string, internal = false): NetworkInterfaceInfo => ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null });

test('adresses du bureau : cartes réelles, adresses privées, Wi-Fi/Ethernet d’abord', () => {
  const ips = adressesBureau({
    lo0: [carte('127.0.0.1', true)],
    docker0: [carte('172.17.0.1')],
    utun3: [carte('10.8.0.2')],
    en1: [carte('10.0.0.12')],
    en0: [carte('192.168.1.95'), { ...carte('fe80::1'), family: 'IPv6', scopeid: 0 } as NetworkInterfaceInfo],
    ppp0: [carte('203.0.113.20')],
  });
  assert.deepEqual(ips, ['192.168.1.95', '10.0.0.12']);
  assert.deepEqual(nomsMachine('Poste-Atelier.local'), ['poste-atelier.local', 'poste-atelier']);
  assert.deepEqual(nomsMachine('BUREAU-PC'), ['bureau-pc', 'bureau-pc.local']);
  assert.deepEqual(nomsMachine('pas un nom;rm'), []);
});

const cible = { node: '/Applications/Living Business/app/node', lanceur: '/Applications/Living Business/app/src/lanceur.ts', donnees: '/Users/anna/Library/Application Support/Living Business' };

test('lancement automatique : fichiers Mac / Windows / Linux, chemins échappés, sans navigateur', () => {
  const mac = contenuDemarrage('darwin', { ...cible, donnees: '/Users/a&b/<données>' });
  assert.match(mac, /<string>--arriere-plan<\/string>/);
  assert.match(mac, /a&amp;b\/&lt;données&gt;/);
  assert.match(mac, /<key>RunAtLoad<\/key><true\/>/);
  const win = contenuDemarrage('win32', { node: 'C:\\LB\\app\\node.exe', lanceur: 'C:\\LB\\app\\src\\lanceur.ts', donnees: 'C:\\Users\\anna\\AppData\\Roaming\\Living Business' });
  assert.match(win, /\r\n/);
  assert.match(win, /start "Living Business" \/min "C:\\LB\\app\\node\.exe" .* --arriere-plan/);
  const lin = contenuDemarrage('linux', { ...cible, donnees: '/home/a/$HOME"x' });
  assert.match(lin, /^Exec=env LB_DONNEES="\/home\/a\/\\\$HOME\\"x" "\/Applications\/Living Business\/app\/node"/m);
  assert.equal(fichierDemarrage({ plateforme: 'darwin', maison: '/Users/anna' }), '/Users/anna/Library/LaunchAgents/bzh.breizh-eco.living-business.plist');
  assert.equal(fichierDemarrage({ plateforme: 'win32', maison: 'C:\\Users\\anna', appdata: 'C:\\Users\\anna\\AppData\\Roaming' }), join('C:\\Users\\anna\\AppData\\Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Living Business.cmd'));
  assert.throws(() => regleDemarrage({ plateforme: 'win32', maison: tmpdir(), appdata: join(tmpdir(), 'x') }, true, { ...cible, donnees: 'C:\\100%' }), /incompatible/);
});

test('lancement automatique, application Mac : l’agent lance le Node.js de Living Business.app, jamais depuis une copie provisoire', () => {
  const maison = mkdtempSync(join(tmpdir(), 'lb-maison-mac-'));
  try {
    const s = { plateforme: 'darwin' as const, maison };
    const appli = '/Applications/Living Business.app';
    const installee = { node: `${appli}/Contents/MacOS/node`, lanceur: `${appli}/Contents/Resources/app/src/lanceur.ts`, donnees: '/Users/anna/Library/Application Support/Living Business' };
    regleDemarrage(s, true, installee);
    const agent = readFileSync(fichierDemarrage(s) as string, 'utf8');
    assert.match(agent, /<key>Label<\/key><string>bzh\.breizh-eco\.living-business<\/string>/);
    assert.match(agent, /<array>\n {4}<string>\/Applications\/Living Business\.app\/Contents\/MacOS\/node<\/string>\n {4}<string>--disable-warning=ExperimentalWarning<\/string>\n {4}<string>\/Applications\/Living Business\.app\/Contents\/Resources\/app\/src\/lanceur\.ts<\/string>\n {4}<string>--arriere-plan<\/string>/);
    assert.match(agent, /<key>WorkingDirectory<\/key><string>\/Applications\/Living Business\.app\/Contents\/Resources\/app<\/string>/);
    // ouverte sans avoir été déplacée (Téléchargements) : macOS la lance d'un emplacement provisoire, refusé avec la raison
    const provisoire = '/private/var/folders/xy/T/AppTranslocation/0A1B2C3D/d/Living Business.app';
    const copie = { ...installee, node: `${provisoire}/Contents/MacOS/node`, lanceur: `${provisoire}/Contents/Resources/app/src/lanceur.ts` };
    assert.throws(() => regleDemarrage(s, true, copie), /emplacement provisoire de macOS[\s\S]*dossier Applications/);
    assert.equal(reparerDemarrage(s, copie), false, 'la copie provisoire ne remplace pas le chemin de l’application rangée');
    assert.equal(readFileSync(fichierDemarrage(s) as string, 'utf8'), agent);
    regleDemarrage(s, false, copie);
    assert.equal(demarrageActif(s), false, 'retirer reste possible');
    assert.throws(() => regleDemarrage(s, true, copie), /emplacement provisoire/);
    assert.equal(demarrageActif(s), false, 'rien d’inscrit');
  } finally { rmSync(maison, { recursive: true, force: true }); }
});

test('lancement automatique : activer, retirer, remettre à jour seulement pour la même entreprise', () => {
  const maison = mkdtempSync(join(tmpdir(), 'lb-maison-'));
  try {
    const s = { plateforme: 'linux' as const, maison };
    assert.equal(demarrageActif(s), false);
    regleDemarrage(s, true, cible);
    assert.equal(demarrageActif(s), true);
    // jeu déplacé : mis à jour
    const deplace = { ...cible, node: '/opt/lb2/app/node', lanceur: '/opt/lb2/app/src/lanceur.ts' };
    assert.equal(reparerDemarrage(s, deplace), true);
    assert.match(readFileSync(fichierDemarrage(s) as string, 'utf8'), /\/opt\/lb2\/app\/node/);
    // autre installation (autre dossier de données) : on n'y touche pas
    assert.equal(reparerDemarrage(s, { ...deplace, donnees: '/autre/entreprise' }), false);
    regleDemarrage(s, false, cible);
    assert.equal(demarrageActif(s), false);
  } finally { rmSync(maison, { recursive: true, force: true }); }
});

/** Requête avec un en-tête Host choisi. */
const statut = (port: number, host: string, chemin = '/api/v1/session') => new Promise<number>((ok, ko) => {
  const r = request({ host: '127.0.0.1', port, path: chemin, headers: { host }, agent: false }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
  r.on('error', ko);
  r.end();
});

test('mode équipe : ouverture au réseau sans redémarrer, liens à l’adresse du bureau, réglé sur place, retenu au redémarrage', async () => {
  const dossier = mkdtempSync(join(tmpdir(), 'lb-equipe-'));
  const maison = mkdtempSync(join(tmpdir(), 'lb-maison-'));
  const opts = { port: 0, hote: '127.0.0.1', dossier, demo: false, exemple: 'pme' as const, cookieSecure: false, systeme: { plateforme: 'linux' as const, maison }, veille: false };
  try {
    const l = await lancer(opts);
    const base = `http://127.0.0.1:${l.port}`;
    let cookie = '';
    const appel = async (m: string, c: string, corps?: unknown, ent: Record<string, string> = {}) => {
      const r = await fetch(base + c, { method: m, headers: { ...(cookie ? { cookie } : {}), ...(m !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}), ...ent }, body: corps === undefined ? null : JSON.stringify(corps) });
      const sc = r.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0] as string;
      return { statut: r.status, json: await r.json().catch(() => null) as any };
    };
    await appel('POST', '/api/v1/installation', { nom: 'Maël', entreprise: 'Kerlann', identifiant: 'mael@kerlann.example', motDePasse: 'une phrase assez longue', depart: 'vide' });
    const r0 = (await appel('GET', '/api/v1/reseau')).json;
    assert.equal(r0.disponible, true);
    assert.equal(r0.equipe, false);
    const nom = nomsMachine()[0] as string;
    assert.equal(await statut(l.port, `${nom}:${l.port}`), 421, 'nom de la machine refusé tant que le mode équipe est fermé');
    // pas depuis un autre poste
    assert.equal((await appel('PUT', '/api/v1/reseau', { equipe: true }, { 'x-forwarded-for': '192.168.1.50' })).statut, 403);
    const r1 = await appel('PUT', '/api/v1/reseau', { equipe: true });
    assert.equal(r1.statut, 200);
    assert.equal(r1.json.equipe, true);
    assert.equal((l.serveur.address() as { address: string }).address, '0.0.0.0');
    assert.equal(l.port, (l.serveur.address() as { port: number }).port, 'même port');
    assert.equal(await statut(l.port, `${nom}:${l.port}`), 200, 'nom de la machine accepté');
    assert.equal(await statut(l.port, 'pirate.example'), 421);
    // les liens envoyés utilisent l'adresse du bureau
    const p = (await appel('POST', '/api/v1/acces', { nom: 'Morgane', role: 'collaborateur', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous' })).json;
    const inv = (await appel('POST', `/api/v1/acces/${p.id}/invitation`, { identifiant: 'morgane' })).json;
    const ips = adressesBureau();
    if (ips.length) assert.ok(inv.lien.startsWith(`http://${ips[0]}:${l.port}/invitation/`), inv.lien);
    else assert.ok(inv.lien.startsWith(`http://127.0.0.1:${l.port}/`));
    // lancement automatique
    assert.equal((await appel('PUT', '/api/v1/reseau', { demarrage: true })).json.demarrage.actif, true);
    assert.ok(existsSync(join(maison, '.config', 'autostart', 'living-business.desktop')));
    assert.equal(l.app().reglages.equipe, true);
    await l.arreter();

    // redémarrage : le mode équipe est retenu
    const l2 = await lancer(opts);
    assert.equal((l2.serveur.address() as { address: string }).address, '0.0.0.0');
    await l2.arreter();
  } finally {
    rmSync(dossier, { recursive: true, force: true });
    rmSync(maison, { recursive: true, force: true });
  }
});
