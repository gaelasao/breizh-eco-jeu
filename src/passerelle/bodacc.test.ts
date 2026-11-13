import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Application } from './application.ts';
import { sirenValide } from './bodacc.ts';

test('Bodacc : opt-in, seulement les SIREN des clients envoyés, alerte rattachée à la fiche', async () => {
  const requetes: string[] = [];
  const f = (async (url: string | URL) => {
    const u = new URL(String(url));
    requetes.push(u.toString());
    assert.equal(u.hostname, 'bodacc-datadila.opendatasoft.com');
    return Response.json({ total_count: 1, results: [{ registre: ['732829320', '732 829 320'], dateparution: '2026-10-02', jugement: JSON.stringify({ nature: 'Jugement d’ouverture d’une procédure de redressement judiciaire' }), tribunal: 'Tribunal de commerce de Brest', url_complete: 'https://www.bodacc.fr/pages/annonces-commerciales-detail/?q.id=id:A1' }] });
  }) as typeof fetch;
  const app = await Application.creer({ connexion: 'comptes', fetch: f });
  const p = app.monde.initialiser({ nom: 'Maël', entreprise: 'Kerlann', depart: 'vide' });
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Client en difficulté', roles: ['client'], champs: { siret: '73282932000074' } });
  app.monde.creerObjet(p, 's', { type: 'entreprise', nom: 'Fournisseur', roles: ['fournisseur'], champs: { siret: '35600000000048' } });
  assert.equal(await app.verifierBodacc(), 0, 'rien sans accord de l’entreprise');
  assert.equal(requetes.length, 0);
  app.regler({ surveillanceBodacc: true });
  assert.equal(await app.verifierBodacc(), 1);
  assert.equal(requetes.length, 1);
  assert.match(decodeURIComponent(requetes[0] as string), /registre="732829320"/);
  assert.doesNotMatch(decodeURIComponent(requetes[0] as string), /356000000|Client en difficulté/, 'ni fournisseur ni nom envoyés');
  const b = app.bodacc;
  assert.equal(b.alertes[0]?.nom, 'Client en difficulté');
  assert.match(b.alertes[0]?.nature ?? '', /redressement/);
  app.regler({ surveillanceBodacc: false });
  assert.equal(app.bodacc.alertes.length, 0, 'désactiver efface les alertes');
  assert.equal(sirenValide('732829320'), true);
  assert.equal(sirenValide('123456789'), false);
});

test('Bodacc : au-delà de 100 annonces pour un lot, les pages suivantes sont lues (un client bavard ne masque pas les autres)', async () => {
  const { proceduresCollectives } = await import('./bodacc.ts');
  const decalages: string[] = [];
  // 120 annonces récentes pour le premier client, puis une seule, plus ancienne, pour le second
  const toutes = [...Array.from({ length: 120 }, () => ({ registre: ['732829320'], dateparution: '2026-10-02', jugement: JSON.stringify({ nature: 'Dépôt de l’état des créances' }) })),
    { registre: ['356000000'], dateparution: '2026-09-01', jugement: JSON.stringify({ nature: 'Jugement d’ouverture de liquidation judiciaire' }) }];
  const f = (async (url: string | URL) => {
    const u = new URL(String(url));
    decalages.push(u.searchParams.get('offset') ?? '');
    const debut = Number(u.searchParams.get('offset'));
    return Response.json({ total_count: toutes.length, results: toutes.slice(debut, debut + 100) });
  }) as typeof fetch;
  const fiche = (id: string, nom: string) => ({ id, nom }) as never;
  const alertes = await proceduresCollectives(new Map([['732829320', fiche('a', 'Client bavard')], ['356000000', fiche('b', 'Client en liquidation')]]), new Date('2026-08-01'), f);
  assert.deepEqual(decalages, ['0', '100']);
  assert.deepEqual(alertes.map((a) => a.nom).sort(), ['Client bavard', 'Client en liquidation'], 'avant : la liquidation du second client n’était pas vue');
});
