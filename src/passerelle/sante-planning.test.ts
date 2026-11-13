/**
 * Passerelle pour la page Santé et le planning (direction de design §6.1 P6, P7) : relevé quotidien du score
 * (tendance sur 90 jours, jamais pour un périmètre réduit, série d'exemple marquée comme telle), jours configurables du
 * planning (samedi et dimanche compris) et affectation par lots, tout ou rien ; fichiers servis en liste blanche.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { SYSTEME } from './monde.ts';
import { fichiersStatiques } from './statiques.ts';
import { derniersJours, lireHistorique, noter, serieExemple, type PointSante } from '../core/historique-sante.ts';
import { contrasteJetons, lireJetons, type Theme } from '../../scripts/jetons.ts';

let serveur: Server;
let base: string;
before(async () => {
  serveur = creerServeur(await Application.creer());
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((ok) => serveur.close(() => ok())));

function client() {
  let cookie = '';
  const appel = async (methode: string, chemin: string, corps?: unknown) => {
    const r = await fetch(base + chemin, {
      method: methode,
      headers: { ...(cookie ? { cookie } : {}), ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}) },
      body: corps === undefined ? null : JSON.stringify(corps),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0] as string;
    const texte = await r.text();
    let json: any = null;
    try { json = JSON.parse(texte); } catch { /* statique */ }
    return { statut: r.status, json, entetes: r.headers, texte };
  };
  return { appel, connecter: (profilId: string) => appel('POST', '/api/v1/session', { profilId }) };
}

test('historique du score : un relevé par jour (le dernier l’emporte), jamais de réécriture du passé, 90 jours', () => {
  const h: PointSante[] = [];
  assert.equal(noter(h, { jour: '2026-11-09', score: 50, couverture: 0.6 }), true);
  assert.equal(noter(h, { jour: '2026-11-10', score: 51, couverture: 0.6 }), true);
  assert.equal(noter(h, { jour: '2026-11-10', score: 51, couverture: 0.6 }), false, 'rien de neuf');
  assert.equal(noter(h, { jour: '2026-11-10', score: 53, couverture: 0.7 }), true);
  assert.equal(noter(h, { jour: '2026-11-08', score: 10, couverture: 0.1 }), false, 'horloge revenue en arrière');
  assert.deepEqual(h.map((p) => [p.jour, p.score]), [['2026-11-09', 50], ['2026-11-10', 53]]);
  assert.deepEqual(lireHistorique([{ jour: '2026-11-10', score: 140, couverture: 2 }, { jour: 'hier', score: 3 }, null, { jour: '2026-11-09', score: 'x' }]),
    [{ jour: '2026-11-09', score: null, couverture: 0 }, { jour: '2026-11-10', score: 100, couverture: 1 }]);
  const long = Array.from({ length: 120 }, (_, i) => ({ jour: new Date(Date.UTC(2026, 6, 1) + i * 86_400_000).toISOString().slice(0, 10), score: 50, couverture: 0.5 }));
  assert.equal(derniersJours(long, '2026-10-28').length, 90);
  const ex = serieExemple('2026-11-10', 51, 0.8);
  assert.equal(ex.at(-1)?.jour, '2026-11-10');
  assert.equal(ex.at(-1)?.score, 51, 'la série d’exemple finit sur le score du jour');
  assert.ok(ex.length < 90 && ex.length > 80, 'quelques jours sans relevé');
  assert.ok(ex.every((p) => typeof p.score === 'number' && p.score > 0));
  assert.deepEqual(serieExemple('2026-11-10', null, 0), []);
});

test('GET /sante : tendance d’exemple pour l’entreprise exemple, relevés réels sinon, rien pour un périmètre réduit', async () => {
  const d = client();
  await d.connecter('dirigeante');
  const s = (await d.appel('GET', '/api/v1/sante')).json;
  assert.equal(s.tendance.exemple, true, 'entreprise exemple : série marquée « Exemple »');
  assert.equal(s.tendance.jours, 90);
  assert.equal(s.tendance.points.at(-1).score, s.score);
  const t = client();
  await t.connecter('terrain');
  assert.equal((await t.appel('GET', '/api/v1/sante')).statut, 403, 'le terrain ne voit pas le score');

  const app = await Application.creer({ exemple: null });
  assert.equal(app.monde.organisation.demo, false);
  const r = app.santeAvecTendance(SYSTEME, 's1');
  assert.equal(r.tendance?.exemple, false);
  assert.equal(r.tendance?.points.length, 1, 'premier relevé du jour');
  assert.equal(r.tendance?.points[0]?.jour, app.monde.maintenant().toISOString().slice(0, 10));
  assert.equal(app.instantane().sante?.historique.length, 1, 'relevé enregistré avec l’état');
  assert.equal(app.santeAvecTendance({ ...SYSTEME, lieux: ['l-atelier'] }, 's1').tendance, null, 'périmètre réduit : pas de tendance de l’entreprise');
  const restaure = await Application.creer({ exemple: null, etat: app.instantane() });
  assert.equal(restaure.santeAvecTendance(SYSTEME, 's2').tendance?.points.length, 1, 'l’historique survit à l’enregistrement');
});

test('planning : 5, 6 ou 7 jours ; samedi accepté ; lot tout ou rien ; texte des trous sans « (s) »', async () => {
  const d = client();
  await d.connecter('dirigeante');
  const p7 = (await d.appel('GET', '/api/v1/planning?jours=7')).json;
  assert.equal(p7.jours.length, 7);
  assert.equal(new Date(`${p7.jours[5]}T00:00:00Z`).getUTCDay(), 6, 'samedi');
  assert.equal((await d.appel('GET', '/api/v1/planning?jours=6')).json.jours.length, 6);
  assert.equal((await d.appel('GET', '/api/v1/planning?jours=12')).json.jours.length, 5, 'valeur inconnue : du lundi au vendredi');
  const samedi = p7.jours[5];
  const r = await d.appel('POST', '/api/v1/planning', { employe: 'e-gwen', date: samedi, valeur: 'lieu:l-atelier' });
  assert.equal(r.statut, 200, 'le samedi se planifie');
  // lot : une case invalide fait tout refuser
  const avant = (await d.appel('GET', '/api/v1/planning?jours=7')).json.lignes.find((l: any) => l.id === 'e-gwen').cases;
  const refus = await d.appel('POST', '/api/v1/planning', { affectations: [{ employe: 'e-gwen', date: p7.jours[0], valeur: 'absence:congé' }, { employe: 'e-gwen', date: p7.jours[1], valeur: 'lieu:inconnu' }] });
  assert.equal(refus.statut, 400);
  assert.deepEqual((await d.appel('GET', '/api/v1/planning?jours=7')).json.lignes.find((l: any) => l.id === 'e-gwen').cases, avant, 'rien n’a été écrit');
  const lot = await d.appel('POST', '/api/v1/planning', { affectations: p7.jours.slice(0, 3).map((j: string) => ({ employe: 'e-gwen', date: j, valeur: 'absence:formation' })) });
  assert.equal(lot.statut, 200);
  assert.equal(lot.json.affectations.length, 3);
  const apres = (await d.appel('GET', '/api/v1/planning?jours=7')).json.lignes.find((l: any) => l.id === 'e-gwen').cases;
  assert.deepEqual(p7.jours.slice(0, 3).map((j: string) => apres[j]), ['absence:formation', 'absence:formation', 'absence:formation']);
  assert.equal((await d.appel('POST', '/api/v1/planning', { affectations: [] })).statut, 400);
  const t = client();
  await t.connecter('terrain');
  assert.equal((await t.appel('POST', '/api/v1/planning', { affectations: [{ employe: 'e-nolwenn', date: p7.jours[0], valeur: '' }] })).statut, 403);
  const alertes = (await d.appel('GET', '/api/v1/planning')).json.alertes as Array<{ texte: string }>;
  assert.ok(alertes.every((a) => !/\(s\)/.test(a.texte)), 'pluriels accordés');
});

test('liste blanche : modules Santé, fiches, planning, terrain et uPlot épinglé servis ; rien d’autre', () => {
  const s = fichiersStatiques();
  for (const c of ['/sante.js', '/fiches.js', '/planning.js', '/courbe.js', '/bz/terrain.js']) assert.equal(s.get(c)?.type, 'text/javascript; charset=utf-8', c);
  const js = s.get('/vendor/uplot@1.6.32.js');
  assert.equal(js?.type, 'text/javascript; charset=utf-8');
  assert.match(js?.cache ?? '', /immutable/, 'chemin versionné : cache immuable');
  assert.equal(s.get('/vendor/uplot@1.6.32.css')?.type, 'text/css; charset=utf-8');
  for (const c of ['/vendor/uplot.js', '/vendor/uplot@1.6.31.js', '/node_modules/uplot/dist/uPlot.iife.min.js', '/vendor/../package.json']) assert.equal(s.get(c), undefined, c);
  for (const f of ['/sante.js', '/fiches.js', '/planning.js', '/courbe.js']) {
    const code = s.get(f)?.contenu.toString('utf8') ?? '';
    for (const i of code.matchAll(/from '(\.\/[^']+)'/g)) assert.ok(s.get(new URL(i[1] as string, `http://x${f}`).pathname), `${f} importe ${i[1]}`);
    assert.doesNotMatch(code, /innerHTML|createElement\(['"]style['"]\)|setAttribute\(['"]style['"]/, `${f} : ni HTML injecté ni style en ligne (CSP)`);
  }
  // uPlot ne pose ses tailles que par CSSOM : compatible avec style-src 'self'
  assert.doesNotMatch(js?.contenu.toString('utf8') ?? '', /createElement\("style"\)|innerHTML/);
  const courbe = readFileSync(new URL('../../web/courbe.js', import.meta.url), 'utf8');
  assert.match(courbe, /\/vendor\/uplot@\$\{VERSION\}\.js/);
  assert.match(courbe, /const VERSION = '1\.6\.32'/);
});

test('contrastes des nouveaux composants (santé, fiche, listes, planning), clair et sombre', () => {
  const j = lireJetons(readFileSync(new URL('../../web/bz/tokens.css', import.meta.url), 'utf8'));
  const paires: Array<[string, string, number, string]> = [
    ['--bz-critique-trait', '--bz-composant', 3, 'barre d’un critère à corriger sur sa piste'],
    ['--bz-attention-trait', '--bz-composant', 3, 'barre d’un critère à surveiller'],
    ['--bz-ok-trait', '--bz-composant', 3, 'barre d’un bon critère'],
    ['--bz-dv-1', '--bz-surface', 3, 'courbe de la tendance'],
    ['--bz-texte-3', '--bz-surface', 3, 'seuils en pointillés de la courbe'],
    ['--bz-dv-texte', '--bz-surface', 4.5, 'graduations de la courbe'],
    ['--bz-texte-2', '--bz-fond-2', 4.5, 'jour d’aujourd’hui et week-end dans la grille'],
    ['--bz-texte', '--bz-marque-doux', 7, 'ligne courante, case sélectionnée'],
    ['--bz-etat-indicateur', '--bz-marque-doux', 3, 'bordure d’une case sélectionnée'],
    ['--bz-texte', '--bz-selection', 7, 'ligne cochée'],
    ['--bz-marque-texte', '--bz-surface', 4.5, 'nom de la fiche en lien'],
    ['--bz-ok-texte', '--bz-surface-elevee', 4.5, '« Enregistré » dans la fiche'],
    ['--bz-info-texte', '--bz-surface', 4.5, 'icône « En attente d’envoi »'],
    ['--bz-bordure-champ', '--bz-surface', 3, 'case non affectée (bord pointillé)'],
    ['--bz-texte-2', '--bz-composant', 4.5, 'pastille d’absence'],
    ['--bz-texte-2', '--bz-surface-elevee', 4.5, 'libellés des champs de la fiche'],
  ];
  const echecs: string[] = [];
  for (const theme of ['clair', 'sombre'] as Theme[]) {
    for (const [a, f, seuil, usage] of paires) {
      const r = contrasteJetons(j, theme, a, f);
      if (r < seuil) echecs.push(`${theme} : ${a} sur ${f} (${usage}) = ${r.toFixed(2)} < ${seuil}`);
    }
  }
  assert.deepEqual(echecs, []);
});
