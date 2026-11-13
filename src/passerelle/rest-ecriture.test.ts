/**
 * Connecteur « API REST (tout autre outil) » : une écriture réussie reste une réussite quelle que soit la forme de la
 * réponse (comparaison aux pratiques courantes des API, novembre 2026). Avant : un 2xx dont le corps n'était pas du JSON
 * (« OK », une page, du texte) passait pour un échec — la création était retentée et doublée chez l'outil — et
 * l'identifiant d'un enregistrement créé n'était lu que dans le corps, jamais dans l'en-tête Location.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ADAPTATEURS } from './sources.ts';
import type { Recuperateur } from './sortant.ts';

const CFG = { url: 'https://8.8.8.8/api/clients', urlEcriture: 'https://8.8.8.8/api/clients/{id}', methode: 'PATCH' };
function outil(reponse: () => Response) {
  const appels: { methode: string; url: string; corps: unknown }[] = [];
  const f = (async (u: string | URL | Request, init?: RequestInit) => {
    appels.push({ methode: init?.method ?? 'GET', url: String(u), corps: init?.body ? JSON.parse(String(init.body)) : null });
    return reponse();
  }) as Recuperateur;
  return { f, appels };
}

test('REST : une modification qui répond « OK », une page ou rien est une réussite', async () => {
  for (const reponse of [() => new Response('OK', { status: 200, headers: { 'content-type': 'text/plain' } }), () => new Response('<html>fait</html>', { status: 200 }), () => new Response(null, { status: 204 })]) {
    const o = outil(reponse);
    assert.equal(await ADAPTATEURS.rest.ecrire!(CFG, null, '42', { nom: 'Cave du Port' }, o.f), '42');
    assert.deepEqual(o.appels.map((a) => [a.methode, a.url]), [['PATCH', 'https://8.8.8.8/api/clients/42']]);
  }
});

test('REST : l’identifiant d’une création est lu dans le corps JSON, sinon dans l’en-tête Location', async () => {
  const corps = outil(() => Response.json({ id: 'c-7', nom: 'Cave du Port' }, { status: 201 }));
  assert.equal(await ADAPTATEURS.rest.ecrire!(CFG, null, null, { nom: 'Cave du Port' }, corps.f), 'c-7');
  assert.deepEqual(corps.appels.map((a) => [a.methode, a.url]), [['POST', 'https://8.8.8.8/api/clients']]);
  const location = outil(() => new Response(null, { status: 201, headers: { location: 'https://8.8.8.8/api/clients/c%2D8?vue=1' } }));
  assert.equal(await ADAPTATEURS.rest.ecrire!(CFG, null, null, { nom: 'Atelier Neuf' }, location.f), 'c-8');
  const autreChamp = outil(() => Response.json({ reference: 'R-9' }, { status: 201 }));
  assert.equal(await ADAPTATEURS.rest.ecrire!({ ...CFG, champId: 'reference' }, null, null, { nom: 'X' }, autreChamp.f), 'R-9');
  // rien pour l'identifier : créé, mais sans lien (la prochaine lecture le rapprochera)
  const muet = outil(() => new Response('créé', { status: 201 }));
  assert.equal(await ADAPTATEURS.rest.ecrire!(CFG, null, null, { nom: 'Y' }, muet.f), null);
});

test('REST : un refus de l’outil reste une erreur', async () => {
  const o = outil(() => new Response('non', { status: 422 }));
  await assert.rejects(ADAPTATEURS.rest.ecrire!(CFG, null, '42', { nom: 'Z' }, o.f), /Erreur du service \(422\)/);
});
