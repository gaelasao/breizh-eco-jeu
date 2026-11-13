import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lireDroits, type Droits } from './droits.ts';
import { vuePavillon } from './pavillon.ts';
import { LienNexus } from '../passerelle/lien-nexus.ts';
import { chiffreurEphemere } from '../passerelle/stockage.ts';

const droitsActifs: Droits = {
  orgId: 'org-a',
  plan: 'active',
  etatAbonnement: 'actif',
  actifJusquau: '2026-12-09T00:00:00Z',
  capacites: ['decouvrir', 'publier_besoin', 'repondre_demande_externe'],
  verifieLe: '2026-11-09T10:00:00Z',
};

const fauxFetch = (reponse: () => Response): typeof fetch => (async () => reponse()) as typeof fetch;

test('pavillon actif seulement sur droits serveur confirmés', () => {
  const v = vuePavillon({ statut: 'connecte', droits: droitsActifs }, { animations: true });
  assert.equal(v.apparence, 'actif');
  assert.equal(v.animer, true);
});

test('accessibilité : animations désactivables', () => {
  assert.equal(vuePavillon({ statut: 'connecte', droits: droitsActifs }, { animations: false }).animer, false);
});

test('paiement en attente : pas de fonctions actives', () => {
  const v = vuePavillon({ statut: 'connecte', droits: { ...droitsActifs, plan: 'gratuit', etatAbonnement: 'paiement_en_attente' } }, { animations: true });
  assert.equal(v.apparence, 'en_attente');
  assert.equal(v.afficherFonctionsActives, false);
});

test('droits : capacité future inconnue ignorée (compatibilité), structure invalide rejetée', () => {
  assert.deepEqual(lireDroits({ ...droitsActifs, capacites: [...droitsActifs.capacites, 'capacite_future'] }), droitsActifs);
  assert.equal(lireDroits({ ...droitsActifs, capacites: [42] }), null);
  assert.equal(lireDroits({ ...droitsActifs, plan: 'illimite' }), null);
});

// R10 sur le vrai client du jeu (LienNexus) : l'ancien ClientNexus, jamais branché, a été retiré (constat coherence-7)
const CLE = `nx_${'k'.repeat(43)}`;
async function lienRelie(f: typeof fetch) {
  const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), fetch: f, changement: () => {}, urlParDefaut: null });
  await lien.reglerAdresse('http://127.0.0.1:4180');
  await lien.demarrerLiaison();
  assert.equal((await lien.suivreLiaison()).statut, 'reliee');
  return lien;
}

test('R10 panne Breizhcosystem ⇒ indisponible, dernier état conservé', async () => {
  let enPanne = false;
  const f = (async (url: string | URL | Request) => {
    const chemin = new URL(String(url)).pathname;
    if (chemin === '/v0/liaison') return Response.json({ code: 'ABCD-2345', attente: 'a'.repeat(43), url: 'https://reseau.example/relier', expire: new Date(Date.now() + 600_000).toISOString() });
    if (chemin === '/v0/liaison/retrait') return Response.json({ statut: 'confirmee', cle: CLE, organisation: 'Kerlann' });
    if (enPanne) throw new Error('ECONNREFUSED');
    return Response.json(droitsActifs);
  }) as typeof fetch;
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const lien = await lienRelie(f);
    assert.equal((await lien.etatPavillon()).statut, 'connecte');
    enPanne = true;
    const e = await lien.etatPavillon();
    assert.equal(e.statut, 'indisponible');
    if (e.statut === 'indisponible') assert.equal(e.dernierConnu?.plan, 'active');
    assert.equal(vuePavillon(e, { animations: true }).afficherFonctionsActives, false);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('HTTP refusé hors poste local', async () => {
  const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), changement: () => {}, urlParDefaut: null });
  await assert.rejects(lien.reglerAdresse('http://reseau.example'), /https/);
});

test('sans liaison : non connecté, aucun appel réseau', async () => {
  let appels = 0;
  const f = (async () => { appels++; return Response.json({}); }) as typeof fetch;
  const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), fetch: f, changement: () => {}, urlParDefaut: 'https://reseau.example' });
  assert.equal((await lien.etatPavillon()).statut, 'non_connecte');
  assert.equal(appels, 0);
});

test('suspendu par l’éditeur : pavillon hors ligne, sans fonctions actives', () => {
  const v = vuePavillon({ statut: 'suspendu', depuis: '2026-11-11T08:00:00Z', message: null }, { animations: true });
  assert.equal(v.apparence, 'hors_ligne');
  assert.equal(v.afficherFonctionsActives, false);
  assert.match(v.message, /suspendu/);
});
