/**
 * Alerte « nouvelle version » (constat jeu-installation-3) : lecture de la liste publique des versions sur Breizhcosystem,
 * sans rien envoyer, montrée aux seuls administrateurs. Breizhcosystem simulé (fetch injecté), aucun appel réseau.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { comparerVersions, lireDerniereVersion, resume, VERSION_JEU } from './mises-a-jour.ts';

const RESEAU = 'https://9.9.9.9';
interface Appel { url: URL; methode: string; entetes: Headers; corps: unknown }
function nexusSimule(reponse: () => unknown) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    appels.push({ url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers), corps: init?.body ?? null });
    return new Response(JSON.stringify(reponse()), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { f, appels };
}

test('versions : comparaison X.Y.Z, version installée lue dans package.json', () => {
  assert.match(VERSION_JEU, /^\d+\.\d+\.\d+$/);
  assert.ok(comparerVersions('0.10.0', '0.9.9') > 0);
  assert.ok(comparerVersions('1.2.3', '1.2.3') === 0);
  assert.ok(comparerVersions('1.2.3', '1.10.0') < 0);
  assert.deepEqual(resume({ verifieLe: 'x', derniere: '0.2.0', securite: true, erreur: null }, true, '0.1.0'), { actuelle: '0.1.0', derniere: '0.2.0', disponible: true, securite: true, verifieLe: 'x', erreur: null, auto: true });
  assert.equal(resume({ verifieLe: 'x', derniere: '0.1.0', securite: true, erreur: null }, true, '0.1.0').disponible, false, 'même version : rien à faire');
});

test('lecture sur Breizhcosystem : un GET de /v0/telechargements, sans corps ni identifiant ni version installée', async () => {
  const sim = nexusSimule(() => ({ version: '99.0.0', gravite: 'securite', paquets: [], installeur: { signature: null } }));
  assert.deepEqual(await lireDerniereVersion(`${RESEAU}/chemin/ignore?x=1`, sim.f), { version: '99.0.0', securite: true });
  assert.equal(sim.appels.length, 1);
  const a = sim.appels[0] as Appel;
  assert.equal(a.methode, 'GET');
  assert.equal(a.url.href, `${RESEAU}/v0/telechargements`, 'chemin fixe, aucun paramètre');
  assert.equal(a.corps, null);
  assert.equal(a.entetes.get('authorization'), null);
  assert.equal(a.entetes.get('cookie'), null);
  assert.ok(![...a.entetes.values()].some((v) => v.includes(VERSION_JEU)), 'la version installée ne part pas');
  // réponse inattendue : rien d'affiché
  for (const r of [{ version: '<img src=x>' }, { version: '1.2' }, { version: 3 }, null]) {
    assert.deepEqual(await lireDerniereVersion(RESEAU, nexusSimule(() => r).f), { version: null, securite: false });
  }
  await assert.rejects(lireDerniereVersion('http://9.9.9.9', sim.f), /https/, 'jamais en clair');
  await assert.rejects(lireDerniereVersion('https://127.0.0.1', sim.f), /interne|https/);
});

test('application : vérification quotidienne en ligne par défaut, désactivable ; alerte aux seuls administrateurs', async () => {
  const avant = process.env.LB_EN_LIGNE;
  const sim = nexusSimule(() => ({ version: '99.0.0', gravite: 'securite' }));
  const app = await Application.creer({ exemple: 'pme', fetch: sim.f });
  try {
    // un correctif de sécurité doit atteindre AUSSI un Living Business téléchargé : sinon il faut y penser soi-même
    delete process.env.LB_EN_LIGNE;
    assert.equal(app.verificationMisesAJour, true, 'sur un poste aussi : oui par défaut');
    process.env.LB_EN_LIGNE = '1';
    assert.equal(app.verificationMisesAJour, true, 'jeu en ligne (exposé sur Internet) : oui par défaut');
    app.regler({ verifierMisesAJour: false });
    assert.equal(app.verificationMisesAJour, false, 'choix de l’entreprise respecté');
    delete process.env.LB_EN_LIGNE;
    assert.equal(app.verificationMisesAJour, false, 'et respecté sur un poste comme en ligne');
    app.regler({ verifierMisesAJour: true });
    // Breizhcosystem inconnu : rien n'est lu, l'écran le dit
    delete process.env.LB_NEXUS_URL;
    const sans = await app.verifierMisesAJour();
    assert.match(sans.erreur ?? '', /Adresse de Breizhcosystem inconnue/);
    assert.equal(sim.appels.length, 0);
    await app.nexus.reglerAdresse(RESEAU);
    const r = await app.verifierMisesAJour();
    assert.equal(r.disponible, true);
    assert.equal(r.securite, true);
    assert.equal(app.instantane().misesAJour?.derniere, '99.0.0', 'retenu (pas de nouvelle lecture à chaque démarrage)');

    const serveur = creerServeur(app);
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
    const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
    try {
      const monde = async (profilId: string) => {
        const s = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId }) });
        const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] as string;
        return (await (await fetch(`${base}/api/v1/monde`, { headers: { cookie } })).json()) as { miseAJour: unknown };
      };
      assert.deepEqual((await monde('dirigeante')).miseAJour, { version: '99.0.0', securite: true });
      assert.equal((await monde('terrain')).miseAJour, null, 'pas pour les autres profils');
      const s = await fetch(`${base}/api/v1/session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: JSON.stringify({ profilId: 'terrain' }) });
      const cookie = (s.headers.get('set-cookie') ?? '').split(';')[0] as string;
      assert.equal((await fetch(`${base}/api/v1/mises-a-jour`, { headers: { cookie } })).status, 403);
    } finally { serveur.closeAllConnections(); await new Promise<void>((ok) => serveur.close(() => ok())); }
  } finally {
    if (avant === undefined) delete process.env.LB_EN_LIGNE; else process.env.LB_EN_LIGNE = avant;
  }
});

test('mise à jour d’un poste : seul lien donné, la page de téléchargement du réseau réglé ici, en https (jeu-installation-8)', async () => {
  const avant = process.env.LB_NEXUS_URL;
  delete process.env.LB_NEXUS_URL;
  const app = await Application.creer({ exemple: 'pme', fetch: nexusSimule(() => ({ version: '99.0.0' })).f });
  try {
    assert.equal(app.misesAJour().telechargement, null, 'Breizhcosystem inconnu : aucun lien');
    process.env.LB_NEXUS_URL = 'http://reseau.example';
    assert.equal(app.misesAJour().telechargement, null, 'jamais un lien en clair');
    process.env.LB_NEXUS_URL = 'https://reseau.example/chemin?x=1';
    assert.equal(app.misesAJour().telechargement, 'https://reseau.example/telecharger', 'adresse préréglée réduite à l’origine');
    await app.nexus.reglerAdresse(RESEAU);
    assert.equal(app.misesAJour().telechargement, `${RESEAU}/telecharger`, 'adresse de Réglages › Breizhcosystem d’abord');
    assert.equal((await app.verifierMisesAJour()).telechargement, `${RESEAU}/telecharger`, 'aussi après « Vérifier maintenant »');
  } finally {
    if (avant === undefined) delete process.env.LB_NEXUS_URL; else process.env.LB_NEXUS_URL = avant;
  }
});

test('interface : le lien de téléchargement vient du serveur, avec la mise en garde contre un fichier reçu (jeu-installation-8)', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../../web/app.js', import.meta.url), 'utf8');
  const debut = app.indexOf('async function rendreMisesAJour(');
  const corps = app.slice(debut, app.indexOf('\n}\n', debut));
  assert.ok(debut > 0);
  assert.match(corps, /lienExterne\(M\.telechargement, 'Page de téléchargement de Breizhcosystem'\)/);
  assert.match(corps, /reçu par e-mail ou par message, ou trouvé sur un autre site, peut être piégé/);
});
