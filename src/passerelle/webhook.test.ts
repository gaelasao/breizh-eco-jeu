/**
 * Webhook entrant (constat jeu-connecteurs-9) : signature horodatée (5 minutes), rejeu refusé, ancienne forme sans
 * horodatage refusée, et clé des envois du jeu distincte du secret d'entrée (un envoi signé n'entre jamais). Réponses
 * simulées, aucun appel réseau.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Application } from './application.ts';
import { ADAPTATEURS, cleEnvois } from './sources.ts';
import { ErreurApi } from './monde.ts';

interface Appel { url: URL; entetes: Headers; corps: string | null }
function simuler() {
  const appels: Appel[] = [];
  const f = (async (url: URL | string, init?: RequestInit) => {
    appels.push({ url: new URL(String(url)), entetes: new Headers(init?.headers), corps: init?.body ? String(init.body) : null });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  return { f, appels };
}
const signe = (secret: string, corps: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${corps}`).digest('hex')}`;
const code = (f: () => unknown) => { try { f(); return null; } catch (e) { return e instanceof ErreurApi ? `${e.statut} ${e.code}` : String(e); } };

async function connecteur() {
  const { f, appels } = simuler();
  const app = await Application.creer({ exemple: 'pme', fetch: f });
  const p = app.monde.profil('dirigeante');
  assert.ok(p);
  const c = app.synchro.creer(p, { source: 'webhook', config: { urlSortante: 'https://8.8.8.8/hook' }, typeObjet: 'entreprise', roles: ['client'], mapping: { Nom: '__nom' }, sens: 'deux', intervalleS: 3600 }) as { id: string; secretEntrant: string; cleEnvois: string };
  return { app, c, appels, f };
}

test('signature horodatée acceptée une fois ; rejouée, trop ancienne ou sans horodatage : refusée', async () => {
  const { app, c } = await connecteur();
  const corps = JSON.stringify({ enregistrements: [{ id: 'A1', Nom: 'Nouveau nom' }] });
  const sig = signe(c.secretEntrant, corps);
  assert.equal(app.synchro.recevoir(c.id, { 'x-lb-signature': sig }, corps).recus, 1);
  assert.equal(code(() => app.synchro.recevoir(c.id, { 'x-lb-signature': sig }, corps)), '409 rejeu', 'même requête rejouée');
  const vieille = signe(c.secretEntrant, corps, Math.floor(Date.now() / 1000) - 10 * 60);
  assert.equal(code(() => app.synchro.recevoir(c.id, { 'x-lb-signature': vieille }, corps)), '401 signature_perimee');
  const sansHeure = `sha256=${createHmac('sha256', c.secretEntrant).update(corps).digest('hex')}`;
  assert.equal(code(() => app.synchro.recevoir(c.id, { 'x-lb-signature': sansHeure }, corps)), '401 signature_sans_horodatage');
  const t = Math.floor(Date.now() / 1000);
  assert.equal(code(() => app.synchro.recevoir(c.id, { 'x-lb-signature': `t=${t + 1},${signe(c.secretEntrant, corps, t).split(',')[1]}` }, corps)), '401 signature_invalide', 'horodatage changé');
  // le secret au porteur (Make, Zapier) reste accepté
  assert.equal(app.synchro.recevoir(c.id, { authorization: `Bearer ${c.secretEntrant}` }, corps).recus, 1);
});

test('les envois du jeu sont signés avec une clé distincte : leur signature ne vaut jamais en entrée', async () => {
  const { app, c, appels, f } = await connecteur();
  assert.match(c.cleEnvois, /^[0-9a-f]{64}$/);
  assert.notEqual(c.cleEnvois, c.secretEntrant);
  assert.equal(c.cleEnvois, cleEnvois(c.secretEntrant), 'clé affichée à la création = clé de signature des envois');
  // envoi d'un enregistrement (adaptateur) et d'un événement métier (notifier)
  await ADAPTATEURS.webhook.ecrire!({ urlSortante: 'https://8.8.8.8/hook' }, c.secretEntrant, 'CRM-001', { Nom: 'X' }, f);
  await app.synchro.notifier('commande.validee', { id: 'C-1' });
  assert.equal(appels.length, 2);
  for (const envoi of appels) {
    const entete = envoi.entetes.get('x-lb-signature') ?? '';
    const [, t, v1] = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(entete) ?? [];
    assert.ok(t && v1, entete);
    assert.equal(v1, createHmac('sha256', c.cleEnvois).update(`${t}.${envoi.corps}`).digest('hex'), 'vérifiable avec la clé des envois');
    assert.equal(code(() => app.synchro.recevoir(c.id, { 'x-lb-signature': entete }, envoi.corps ?? '')), '401 signature_invalide', 'réflexion refusée');
  }
  // qui ne détient que la clé des envois ne fait rien entrer
  const corps = JSON.stringify({ id: 'Z9', Nom: 'Forgé' });
  assert.equal(code(() => app.synchro.recevoir(c.id, { 'x-lb-signature': signe(c.cleEnvois, corps) }, corps)), '401 signature_invalide');
  assert.equal(code(() => app.synchro.recevoir(c.id, { authorization: `Bearer ${c.cleEnvois}` }, corps)), '401 signature_invalide');
});
