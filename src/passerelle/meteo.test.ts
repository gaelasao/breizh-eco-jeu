/**
 * Le vrai temps qu'il fait : `fetch` simulé, aucun appel réseau.
 * Vérifie ce qui sort (deux nombres arrondis, rien d'autre), ce qui entre (les quatre ciels de la carte), et que le
 * relevé est gardé un quart d'heure — ouvrir la carte dix fois n'interroge pas le service dix fois.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adresseMeteo, cielDe, coordonnee, FRAICHEUR_MS, HOTE, Meteo, releveDe, texteDuCode } from './meteo.ts';

interface Appel { url: URL; methode: string; entetes: Headers }
function simuler(repondre: (a: Appel, n: number) => Response) {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    const a: Appel = { url: new URL(String(url)), methode: init?.method ?? 'GET', entetes: new Headers(init?.headers) };
    appels.push(a);
    return repondre(a, appels.length - 1);
  }) as typeof fetch;
  return { f, appels };
}
const json = (corps: unknown, statut = 200) => new Response(JSON.stringify(corps), { status: statut, headers: { 'content-type': 'application/json' } });
const REPONSE = (code: number, couverture: number, pluie: number) => ({
  latitude: 47.65, longitude: -2.76,
  current: { time: '2026-11-18T10:00', weather_code: code, temperature_2m: 11.4, cloud_cover: couverture, precipitation: pluie },
});

test('coordonnées : arrondies au centième, bornées, et rien d’autre n’est accepté', () => {
  assert.equal(coordonnee(47.654321, 90), 47.65, 'deux décimales ≈ 1,1 km : une commune, pas une adresse');
  assert.equal(coordonnee('-2.768901', 180), -2.77);
  assert.equal(coordonnee(90, 90), 90);
  assert.equal(coordonnee(90.1, 90), null);
  assert.equal(coordonnee('abc', 90), null);
  assert.equal(coordonnee(null, 90), null);
  assert.equal(coordonnee(Number.NaN, 90), null);
});

test('adresse interrogée : un seul hôte, les coordonnées, et pas un identifiant', () => {
  const u = adresseMeteo(47.65, -2.77);
  assert.equal(u.hostname, HOTE);
  assert.equal(u.protocol, 'https:');
  assert.equal(u.pathname, '/v1/forecast');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['current', 'latitude', 'longitude', 'timezone']);
  assert.equal(u.searchParams.get('latitude'), '47.65');
  // aucune trace de qui demande : ni clé, ni compte, ni nom d'entreprise
  assert.doesNotMatch(u.toString(), /key|token|client|user|nom|siret/i);
});

test('les quatre ciels de la carte : la pluie l’emporte, puis la couverture', () => {
  assert.equal(cielDe(0, 0, 0), 'clair');
  assert.equal(cielDe(1, 10, 0), 'clair');
  assert.equal(cielDe(2, 40, 0), 'eclaircie');
  assert.equal(cielDe(0, 30, 0), 'eclaircie', 'un tiers de ciel couvert, ce n’est plus un ciel clair');
  assert.equal(cielDe(3, 100, 0), 'nuages');
  assert.equal(cielDe(45, 90, 0), 'nuages', 'brouillard');
  assert.equal(cielDe(61, 80, 0.4), 'averse');
  assert.equal(cielDe(95, 100, 0), 'averse', 'orage annoncé, même sans millimètre tombé dans l’heure');
  // s'il tombe quelque chose, c'est une averse — quelle que soit la couverture annoncée
  assert.equal(cielDe(0, 5, 0.2), 'averse');
  assert.equal(texteDuCode(0), 'Ciel clair');
  assert.equal(texteDuCode(61), 'Pluie');
  assert.equal(texteDuCode(95), 'Orage');
  assert.equal(texteDuCode(77), 'Neige');
});

test('relevé : ce que le service répond, lu et borné ; illisible, rien', () => {
  const r = releveDe(REPONSE(61, 85, 0.6));
  assert.equal(r?.ciel, 'averse');
  assert.equal(r?.couverture, 85);
  assert.equal(r?.pluie, 0.6);
  assert.equal(r?.temperature, 11.4);
  assert.equal(r?.texte, 'Pluie');
  assert.equal(r?.releveLe, '2026-11-18T10:00');
  assert.equal(releveDe({ current: { weather_code: 200 } }), null, 'code hors norme WMO');
  assert.equal(releveDe({}), null);
  assert.equal(releveDe(null), null);
  // une couverture absurde est ramenée dans ses bornes plutôt que de faire échouer la lecture
  assert.equal(releveDe({ current: { weather_code: 0, cloud_cover: 500 } })?.couverture, 100);
});

test('un relevé par quart d’heure : la carte ouverte dix fois n’interroge pas dix fois', async () => {
  let t = 1_000_000;
  const { f, appels } = simuler(() => json(REPONSE(3, 90, 0)));
  const m = new Meteo({ fetch: f, maintenant: () => t });
  assert.equal((await m.lire(47.6543, -2.7689)).ciel, 'nuages');
  assert.equal((await m.lire('47.65', '-2.77')).ciel, 'nuages', 'mêmes coordonnées une fois arrondies');
  assert.equal(appels.length, 1, 'un seul appel');
  t += FRAICHEUR_MS - 1;
  await m.lire(47.65, -2.77);
  assert.equal(appels.length, 1);
  t += 2;
  await m.lire(47.65, -2.77);
  assert.equal(appels.length, 2, 'le quart d’heure passé, on redemande');
  // un autre endroit n'hérite pas du relevé du premier
  await m.lire(48.39, -4.49);
  assert.equal(appels.length, 3);
  assert.equal(appels[2]?.url.searchParams.get('latitude'), '48.39');
});

test('sans coordonnées, on le dit en français et on n’appelle personne', async () => {
  const { f, appels } = simuler(() => json(REPONSE(0, 0, 0)));
  const m = new Meteo({ fetch: f });
  await assert.rejects(m.lire(null, null), /adresse de votre siège/);
  await assert.rejects(m.lire(200, 0), /adresse de votre siège/);
  assert.equal(appels.length, 0);
  // réponse illisible : message clair, et rien de gardé
  const { f: f2 } = simuler(() => json({ bidule: 1 }));
  const m2 = new Meteo({ fetch: f2 });
  await assert.rejects(m2.lire(47.65, -2.77), /illisible/);
  assert.equal(m2.gardee(47.65, -2.77), null);
});
