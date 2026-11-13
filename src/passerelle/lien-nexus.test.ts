import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { ObjetMetier } from '../core/model.ts';
import { Application } from './application.ts';
import { creerServeur } from './http.ts';
import { construirePartage, ibanValide, LienNexus, lienHttps, lienStripe } from './lien-nexus.ts';
import { chiffreurEphemere } from './stockage.ts';

const maintenant = new Date('2026-11-09T09:00:00Z');
const o = (id: string, famille: string, type: string, nom: string, champs: Record<string, unknown>, mode = 'reel'): ObjetMetier => ({
  id, orgId: 'o', famille, type, roles: [], nom, champs: champs as ObjetMetier['champs'], provenance: 'declare',
  source: { id: 's', libelle: 's', derniereSynchro: null }, majLe: maintenant.toISOString(), disponibilite: 'disponible', mode,
} as ObjetMetier);

test('partage ciblé : seulement les catégories cochées, rien de fictif, jamais de nom de personne ni de montant', () => {
  const objets = [
    o('org', 'organisation', 'mon_entreprise', 'Menuiserie Kerlann', { secteur: 'Menuiserie', tresorerie: 50000 }),
    o('a1', 'ressource', 'article', 'Contreplaqué 18 mm', { quantite: 2, seuil_alerte: 10, unite: 'plaque' }),
    o('a2', 'ressource', 'article', 'Vis inox', { quantite: 500, seuil_alerte: 100, unite: 'boîte' }),
    o('a3', 'ressource', 'article', 'Article fictif', { quantite: 0, seuil_alerte: 10 }, 'demo'),
    o('e1', 'personne', 'employe', 'Nolwenn Le Goff', {}),
    o('e2', 'personne', 'employe', 'Yann Morvan', {}),
    o('l1', 'lieu', 'atelier', 'Atelier de Quimper', { besoin_effectif: 3 }),
    o('p1', 'projet', 'projet', 'Salle de bains de Mme Annick Le Bihan — 12 rue de Siam, Brest', { besoin_effectif: 2 }),
  ];
  const planning = new Map([['e1', new Map([['2026-11-09', 'lieu:l1'], ['2026-11-10', '']])], ['e2', new Map([['2026-11-09', ''], ['2026-11-10', '']])]]);
  const tout = construirePartage({ objets, planning, sante: null, maintenant }, ['profil', 'besoins', 'stocks', 'capacites', 'indicateurs']);
  assert.deepEqual(tout.profil, { activite: 'Menuiserie' });
  const besoins = tout.besoins as { cle: string; titre: string }[];
  assert.ok(besoins.some((b) => b.cle === 'rupture:a1' && (b as { quantite?: number }).quantite === 18), 'réassort jusqu’à 2× le seuil : 2×10 − 2');
  assert.ok(besoins.some((b) => b.cle === 'renfort:l1' && b.titre.replace(/\u00A0/g, ' ').startsWith('Renfort : 2 personnes')));
  assert.ok(!besoins.some((b) => b.cle === 'rupture:a3'), 'pas de donnée fictive');
  assert.deepEqual(tout.stocks, [{ cle: 'stock:a2', titre: 'Vis inox', quantite: 300, unite: 'boîte', categorie: 'Vis inox' }]);
  assert.deepEqual((tout.capacites as { titre: string }[]).map((c) => c.titre), ['1\u00A0personne disponible en renfort', '2\u00A0personnes disponibles en renfort'], 'nombre et nom insécables (§8.3)');
  const json = JSON.stringify(tout);
  assert.ok(!json.includes('Nolwenn') && !json.includes('Yann') && !json.includes('50000'), 'ni nom de personne ni montant');
  // nom libre d'un projet ou d'un lieu (client particulier, adresse) : jamais envoyé au réseau
  assert.ok(!/Bihan|Siam|Quimper|Atelier de/.test(json), 'ni nom de projet ou de lieu, ni adresse');
  const renfort = besoins.find((b) => b.cle === 'renfort:p1');
  assert.equal(renfort?.titre.replace(/\u00A0/g, ' '), 'Renfort : 2 personnes — Menuiserie, projet en cours');
  assert.deepEqual(Object.keys(construirePartage({ objets, planning, sante: null, maintenant }, ['stocks'])), ['stocks']);
});

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const IBAN_TEST = 'FR76 3000 6000 0112 3456 7890 189'; // IBAN d'exemple (clé valide), aucun compte réel

/** Breizhcosystem simulé : liaison, partage, droits, agents d'achat (recherche, commandes, paiement). */
function nexusSimule() {
  const recu: { chemin: string; corps: unknown; auth: string | null; url: string; idem?: string | null }[] = [];
  let confirme = false;
  let categories = ['besoins'];
  const paiement = { stripe: 'https://checkout.stripe.com/c/pay/session-de-test#fragment', iban: IBAN_TEST };
  const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    const corps = init?.body ? JSON.parse(String(init.body)) : null;
    const auth = (init?.headers as Record<string, string>)?.authorization ?? null;
    recu.push({ chemin: u.pathname, corps, auth, url: u.toString(), idem: (init?.headers as Record<string, string>)?.['idempotency-key'] ?? null });
    const reponseAgent = agentSimule(u.pathname, init?.method ?? 'GET', corps, auth, paiement);
    if (reponseAgent) return reponseAgent;
    if (u.pathname === '/v0/liaison') return Response.json({ code: 'ABCD-2345', attente: 'a'.repeat(43), url: 'https://nexus.test/relier?code=ABCD-2345', expire: new Date(Date.now() + 600_000).toISOString() });
    if (u.pathname === '/v0/liaison/retrait') return Response.json(confirme ? { statut: 'confirmee', cle: `nx_${'k'.repeat(43)}`, organisation: 'Menuiserie Kerlann' } : { statut: 'en_attente' });
    if (auth !== `Bearer nx_${'k'.repeat(43)}`) return Response.json({ erreur: 'cle_invalide' }, { status: 401 });
    if (u.pathname === '/v0/partage' && init?.method === 'PUT') { categories = corps.categories; return Response.json({ categories }); }
    if (u.pathname === '/v0/partage') return Response.json({ categories });
    if (u.pathname === '/v0/partage/donnees') return Response.json({ recu: Object.fromEntries(Object.keys(corps).map((k) => [k, 1])) });
    if (u.pathname === '/v0/comparaison') return Response.json({ erreur: 'nexus_active_requis', message: 'Fonction réservée à Breizhcosystem ACTIVE.' }, { status: 402 });
    if (u.pathname === '/v0/droits') return Response.json({ orgId: '00000000-0000-4000-8000-000000000001', plan: 'gratuit', etatAbonnement: 'aucun', actifJusquau: null, capacites: ['decouvrir', 'publier_besoin', 'une_capacite_future'], verifieLe: new Date().toISOString() });
    return Response.json({ erreur: 'introuvable' }, { status: 404 });
  };
  return { f: f as typeof fetch, recu, paiement, confirmer: () => { confirme = true; } };
}

/** Routes des agents d'achat du Breizhcosystem simulé (contrat : toujours une validation humaine, paiement hors Breizhcosystem). */
function agentSimule(chemin: string, methode: string, corps: any, auth: string | null, paiement: { stripe: string; iban: string }): Response | null {
  if (!chemin.startsWith('/v0/agent/') && !chemin.startsWith('/v0/commandes') && !chemin.startsWith('/v0/mandats') && chemin !== '/v0/contacter') return null;
  if (auth !== `Bearer nx_${'k'.repeat(43)}`) return Response.json({ erreur: 'cle_invalide' }, { status: 401 });
  if (chemin === '/v0/agent/recherche') {
    if (String(corps.texte).includes('introuvable')) return Response.json({ propositions: [] });
    return Response.json({ propositions: [
      { type: 'stock', id: ID(11), titre: 'Palettes Europe EPAL', organisation: 'Scierie du Faou', organisationId: ID(21), departement: '29', verifie: true, quantite: 200, unite: 'palette', prixUnitaire: 9.5, total: 1900 },
      { type: 'catalogue', id: ID(12), titre: 'Palettes sur mesure', organisation: 'Bois d’Armor', organisationId: ID(22), departement: '22', verifie: false, quantite: null, unite: null, prixUnitaire: null, total: null },
      { type: 'capacite', id: ID(13), titre: `Manutention ${'x'.repeat(400)}`, organisation: 'Renfort Breizh‮', organisationId: 'pas-un-uuid', departement: 'Finistère', verifie: 'oui', quantite: -3, unite: 'personne', prixUnitaire: null, total: null },
      { type: 'stock', id: 'pas-un-uuid', titre: 'Proposition illisible', organisation: 'X' },
      { type: 'autre', id: ID(14), titre: 'Type inconnu', organisation: 'X' },
    ] });
  }
  if (chemin === '/v0/agent/commander') {
    // comme le réseau : le prix vu par la personne doit être celui du stock (ici 9,50 €), sinon 409
    const vu = (corps as { prixUnitaire?: number } | null)?.prixUnitaire;
    if (vu !== undefined && Math.abs(vu - 9.5) > 0.005) return Response.json({ erreur: 'prix_change', message: 'Le prix de ce stock vient de changer (9,50 € l’unité) : relancez la recherche pour voir le nouveau total avant de commander.' }, { status: 409 });
    return Response.json({ id: ID(31), reference: 'NX-7K2Q9A', statut: 'validee', plafond: null });
  }
  if (chemin === '/v0/agent/publier') return Response.json({ id: ID(41) });
  if (chemin === '/v0/contacter') return Response.json({ organisation: 'Bois d’Armor', contact: { nom: 'Anne Le Bihan', email: 'anne@bois-armor.test' } });
  if (chemin === '/v0/mandats' && methode === 'POST') return Response.json({ id: ID(51) });
  if (chemin === '/v0/mandats') return Response.json([{ id: ID(51), nom: 'Achats courants', budgetMensuel: 2000, plafondSansValidation: 300, categories: ['Bois', 42], remiseCible: 0.05, actif: true }, { id: 'x', nom: 'illisible' }]);
  if (chemin === '/v0/agent/lancer') return Response.json({ preparees: 2, validees: 0 });
  if (chemin === '/v0/commandes') {
    return Response.json([
      { id: ID(31), reference: 'NX-7K2Q9A', titre: 'Palettes Europe EPAL', quantite: 200, prixUnitaire: 9.5, prixPropose: 9, statut: 'confirmee', parAgent: true, achat: true, autre: 'Scierie du Faou', paiement: { stripe: true, virement: true, lien: 'https://pay.scierie.test/nx' }, journal: [{ secret: 1 }] },
      { id: ID(32), reference: 'NX-8B3R0C', titre: 'Planches', quantite: 10, prixUnitaire: 20, prixPropose: null, statut: 'a_valider', parAgent: true, achat: true, autre: 'Bois d’Armor', paiement: { stripe: true, virement: true, lien: null } },
      { id: ID(33), reference: 'mauvaise ref', titre: 'Vente de vis', quantite: 5, prixUnitaire: 3, prixPropose: null, statut: 'paiement_annonce', parAgent: false, achat: false, autre: 'Atelier Kerlann' },
      { id: ID(34), reference: 'NX-9C4S1D', titre: 'Lien piégé', quantite: 1, prixUnitaire: 1, prixPropose: null, statut: 'confirmee', achat: true, autre: 'X', paiement: { stripe: false, virement: false, lien: 'javascript:alert(1)' } },
      { id: ID(35), titre: 'Statut inconnu', quantite: 1, prixUnitaire: 1, statut: 'payee_par_nexus', achat: true },
      { id: ID(36), titre: 'Ancien Breizhcosystem', quantite: 1, prixUnitaire: 1, statut: 'confirmee', achat: true, autre: 'Y', lienPaiement: 'https://pay.ancien.test/' },
    ]);
  }
  const m = /^\/v0\/commandes\/([0-9a-f-]{36})\/([a-z]+)$/.exec(chemin);
  if (m && m[2] === 'payer') {
    if (corps.mode === 'stripe') return Response.json({ url: paiement.stripe });
    if (corps.mode === 'virement') return Response.json({ iban: paiement.iban, titulaire: 'Scierie du Faou', montant: 1800, reference: 'NX-7K2Q9A' });
    return Response.json({ erreur: 'mode_invalide' }, { status: 400 });
  }
  if (m) {
    const statut = { valider: 'validee', annuler: 'annulee', confirmer: 'confirmee', refuser: 'refusee', annoncer: 'paiement_annonce', recu: 'payee', verifier: 'payee' }[m[2] as string];
    return statut ? Response.json({ statut }) : Response.json({ erreur: 'introuvable' }, { status: 404 });
  }
  return null;
}

/** Relie un LienNexus au Breizhcosystem simulé (adresse locale autorisée pour le test). */
async function relier(lien: LienNexus, n: ReturnType<typeof nexusSimule>) {
  await lien.reglerAdresse('http://127.0.0.1:4180');
  await lien.demarrerLiaison();
  n.confirmer();
  assert.equal((await lien.suivreLiaison()).statut, 'reliee');
}

test('liaison en un clic, clé chiffrée au repos, envoi limité aux catégories cochées sur Breizhcosystem, révocation', async () => {
  const n = nexusSimule();
  let changements = 0;
  const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), fetch: n.f, changement: () => changements++, urlParDefaut: null });
  await assert.rejects(lien.demarrerLiaison(), /Adresse de Breizhcosystem/);
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    await lien.reglerAdresse('http://127.0.0.1:4180/chemin/ignoré');
    assert.equal(lien.etat().url, 'http://127.0.0.1:4180');
    const d = await lien.demarrerLiaison();
    assert.equal(d.code, 'ABCD-2345');
    assert.equal(d.url, 'http://127.0.0.1:4180/relier?code=ABCD-2345');
    assert.equal((await lien.suivreLiaison()).statut, 'en_attente');
    n.confirmer();
    assert.deepEqual(await lien.suivreLiaison(), { statut: 'reliee', organisation: 'Menuiserie Kerlann' });
    assert.ok(!JSON.stringify(lien.instantane()).includes('kkkk'), 'clé jamais en clair dans l’état enregistré');
    // protection par défaut : relié, mais rien n'est coché dans le jeu → rien ne part, même si Breizhcosystem a coché
    const app = await Application.creer({ exemple: 'pme' });
    assert.equal(lien.partageConsenti, false);
    assert.deepEqual(await lien.partage(), []);
    const avant = n.recu.length;
    assert.equal((await lien.envoyer(app.donneesPartage())).rienAEnvoyer, true);
    assert.equal(n.recu.slice(avant).some((x) => x.chemin === '/v0/partage/donnees'), false, 'aucun envoi sans accord dans le jeu');
    // l'administrateur coche dans le jeu : seules ces catégories, et seulement si Breizhcosystem les a aussi
    assert.deepEqual((await lien.reglerPartage(['besoins'])).categories, ['besoins']);
    assert.equal(lien.partageConsenti, true);
    assert.deepEqual(lien.instantane().partageAccepte, ['besoins'], 'accord retenu avec l’état');
    const r = await lien.envoyer(app.donneesPartage());
    assert.deepEqual(Object.keys(r.envoye), ['besoins']);
    const pav = await lien.etatPavillon();
    assert.equal(pav.statut, 'connecte');
    // fonction payante : le message de Breizhcosystem remonte tel quel
    await assert.rejects(lien.comparaison(), /réservée à Breizhcosystem ACTIVE/);
    // délier
    lien.delier();
    assert.equal(lien.relie, false);
    assert.equal(lien.partageConsenti, false);
    assert.deepEqual(lien.instantane().partageAccepte, [], 'déliaison : tout est décoché');
    assert.ok(changements >= 3);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('adresse de Breizhcosystem : https obligatoire, adresses internes refusées', async () => {
  const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), changement: () => {}, urlParDefaut: null });
  await assert.rejects(lien.reglerAdresse('http://reseau.example'), /https/);
  await assert.rejects(lien.reglerAdresse('https://127.0.0.1'), /interne|privée/);
});

test('agent « Recherche-moi ça » : critères relus avant envoi, propositions relues avant affichage, commander, publier, contacter', async () => {
  const n = nexusSimule();
  const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), fetch: n.f, changement: () => {}, urlParDefaut: null });
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    await relier(lien, n);
    // critères invalides : refusés AVANT tout appel à Breizhcosystem
    const avant = n.recu.length;
    await assert.rejects(lien.rechercher({ texte: 'ab' }), /3 à 200 caractères/);
    await assert.rejects(lien.rechercher({ texte: 'x'.repeat(201) }), /3 à 200 caractères/);
    await assert.rejects(lien.rechercher({ texte: 'palettes', departement: 'Finistère' }), /Département/);
    await assert.rejects(lien.rechercher({ texte: 'palettes', quantite: -2 }), /Quantité/);
    await assert.rejects(lien.rechercher({ texte: 'palettes', prixMax: 'cher' }), /Prix maximum/);
    assert.equal(n.recu.length, avant, 'rien n’est parti vers Breizhcosystem');

    const r = await lien.rechercher({ texte: '  palettes   Europe ', quantite: 200, departement: '29', prixMax: 12, intrus: 'non' });
    const envoi = n.recu.at(-1);
    assert.equal(envoi?.chemin, '/v0/agent/recherche');
    assert.deepEqual(envoi?.corps, { texte: 'palettes Europe', quantite: 200, departement: '29', prixMax: 12 });
    assert.equal(envoi?.auth, `Bearer nx_${'k'.repeat(43)}`);
    assert.ok(!n.recu.some((x) => x.url.includes('nx_')), 'la clé n’est jamais dans une adresse');
    // propositions illisibles écartées, textes bornés et nettoyés, valeurs douteuses neutralisées
    assert.deepEqual(r.propositions.map((p) => p.type), ['stock', 'catalogue', 'capacite']);
    assert.deepEqual(r.propositions[0], { type: 'stock', id: ID(11), titre: 'Palettes Europe EPAL', organisation: 'Scierie du Faou', organisationId: ID(21), departement: '29', verifie: true, quantite: 200, unite: 'palette', prixUnitaire: 9.5, total: 1900 });
    const cap = r.propositions[2];
    assert.equal(cap?.titre.length, 200);
    assert.equal(cap?.organisation, 'Renfort Breizh', 'caractère de contrôle (inversion de sens) retiré');
    assert.equal(cap?.organisationId, null);
    assert.equal(cap?.departement, null);
    assert.equal(cap?.verifie, false);
    assert.equal(cap?.quantite, null);
    assert.deepEqual((await lien.rechercher({ texte: 'chose introuvable' })).propositions, []);

    // commander un stock (après la confirmation de la personne) : identifiant et quantité vérifiés
    await assert.rejects(lien.commanderRecherche({ stockId: '../../admin', quantite: 1 }), (e: Error & { code?: string }) => e.code === 'identifiant_invalide');
    await assert.rejects(lien.commanderRecherche({ stockId: ID(11), quantite: 0 }), /Quantité/);
    assert.deepEqual(await lien.commanderRecherche({ stockId: ID(11), quantite: 150, prix: 0 }), { id: ID(31), reference: 'NX-7K2Q9A', statut: 'validee', plafond: null });
    assert.deepEqual(n.recu.at(-1)?.corps, { stockId: ID(11), quantite: 150 }, 'seuls le stock et la quantité partent');
    // même validation réessayée (délai dépassé) : la même clé d'idempotence part, Breizhcosystem peut ne créer qu'une commande
    for (let i = 0; i < 2; i++) await lien.commanderRecherche({ stockId: ID(11), quantite: 150, cle: ID(77) });
    assert.deepEqual(n.recu.slice(-2).map((x) => x.idem), [ID(77), ID(77)]);
    await lien.commanderRecherche({ stockId: ID(11), quantite: 150, cle: 'pas une clé' });
    assert.equal(n.recu.at(-1)?.idem, null, 'clé illisible : pas d’en-tête');
    // le prix vu par la personne part avec la commande (constat revue-jeu-1-7) ; un prix illisible ne part pas
    await lien.commanderRecherche({ stockId: ID(11), quantite: 150, prixUnitaire: 9.5, cle: ID(78) });
    assert.deepEqual(n.recu.at(-1)?.corps, { stockId: ID(11), quantite: 150, prixUnitaire: 9.5 });
    const envois = n.recu.length;
    for (const prix of [0, -3, '9,5', Number.NaN]) await assert.rejects(lien.commanderRecherche({ stockId: ID(11), quantite: 150, prixUnitaire: prix }), (e: Error & { code?: string }) => e.code === 'prix_invalide');
    assert.equal(n.recu.length, envois, 'rien n’est parti avec un prix illisible');
    // le vendeur a changé son prix depuis la recherche : refus du réseau, son message arrive tel quel (relancer la recherche)
    await assert.rejects(lien.commanderRecherche({ stockId: ID(11), quantite: 150, prixUnitaire: 1 }), (e: Error & { code?: string; statut?: number }) => e.statut === 409 && e.code === 'prix_change' && /relancez la recherche/.test(e.message));

    // rien ne convient : publier la demande sur le réseau (sans prix maximum)
    assert.deepEqual(await lien.publierDemande({ texte: 'palettes Europe', quantite: 200, departement: '2a', prixMax: 12 }), { id: ID(41) });
    assert.equal(n.recu.at(-1)?.chemin, '/v0/agent/publier');
    assert.deepEqual(n.recu.at(-1)?.corps, { texte: 'palettes Europe', quantite: 200, departement: '2A' });

    // contacter le membre d'un catalogue ou d'une capacité
    await assert.rejects(lien.contacter({ objet: 'organisation', ref: ID(22), message: 'x' }), (e: Error & { code?: string }) => e.code === 'contact_invalide');
    assert.deepEqual(await lien.contacter({ objet: 'catalogue', ref: ID(12), message: ' Bonjour ' }), { organisation: 'Bois d’Armor', contact: { nom: 'Anne Le Bihan', email: 'anne@bois-armor.test' } });
    assert.deepEqual(n.recu.at(-1)?.corps, { objet: 'catalogue', ref: ID(12), message: 'Bonjour' });
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('agents d’achat : mandat sans « montant sans validation », commandes relues, paiement direct au vendeur (Stripe Checkout seulement, virement vérifié)', async () => {
  const n = nexusSimule();
  const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), fetch: n.f, changement: () => {}, urlParDefaut: null });
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    await relier(lien, n);
    // mandat : nom, budget, catégories, remise visée — plus jamais de plafond « sans validation »
    assert.deepEqual(await lien.creerMandat({ nom: 'Bois', budgetMensuel: 2000, plafondSansValidation: 500, categories: ['Bois', ' ', 7], remiseCible: 0.05 }), { id: ID(51) });
    assert.deepEqual(n.recu.at(-1)?.corps, { nom: 'Bois', budgetMensuel: 2000, categories: ['Bois'], remiseCible: 0.05 });
    await assert.rejects(lien.creerMandat({ budgetMensuel: 'beaucoup' }), /Budget/);
    await assert.rejects(lien.creerMandat({ budgetMensuel: 100, remiseCible: 0.9 }), /Remise/);
    const mandats = await lien.mandats();
    assert.deepEqual(mandats, [{ id: ID(51), nom: 'Achats courants', budgetMensuel: 2000, categories: ['Bois'], remiseCible: 0.05, actif: true }]);
    assert.ok(!JSON.stringify(mandats).includes('plafond'));
    assert.deepEqual(await lien.lancerAgent(), { preparees: 2 });

    // commandes : statuts connus seulement, référence vérifiée, moyens de paiement pour l'acheteur d'une commande confirmée
    const cmd = await lien.commandes();
    assert.deepEqual(cmd.map((c) => c.id), [ID(31), ID(32), ID(33), ID(34), ID(36)], 'statut inconnu écarté');
    assert.deepEqual(cmd[0]?.paiement, { stripe: true, virement: true, lien: 'https://pay.scierie.test/nx' });
    assert.equal(cmd[0]?.reference, 'NX-7K2Q9A');
    assert.ok(!('journal' in (cmd[0] as object)), 'le journal interne de Breizhcosystem ne remonte pas');
    assert.equal(cmd[1]?.paiement, null, 'pas de paiement avant la confirmation du vendeur');
    assert.equal(cmd[2]?.reference, null);
    assert.equal(cmd[2]?.paiement, null, 'pas de moyens de paiement côté vendeur');
    assert.equal(cmd[3]?.paiement?.lien, null, 'lien non https refusé');
    assert.deepEqual(cmd[4]?.paiement, { stripe: false, virement: false, lien: 'https://pay.ancien.test/' }, 'ancien Breizhcosystem : lien du vendeur repris');

    // actions : l'ancienne action « payée » n'existe plus
    await assert.rejects(lien.agirCommande(ID(31), 'payee'), (e: Error & { code?: string }) => e.code === 'action_invalide');
    await assert.rejects(lien.agirCommande('../x', 'valider'), (e: Error & { code?: string }) => e.code === 'action_invalide');
    assert.deepEqual(await lien.agirCommande(ID(32), 'valider'), { statut: 'validee' });
    assert.deepEqual(await lien.agirCommande(ID(33), 'confirmer', { prix: 'affiche', autre: 1 }), { statut: 'confirmee' });
    assert.deepEqual(n.recu.at(-1)?.corps, { prix: 'affiche' });
    assert.deepEqual(await lien.agirCommande(ID(31), 'annoncer'), { statut: 'paiement_annonce' });
    assert.equal(n.recu.at(-1)?.chemin, `/v0/commandes/${ID(31)}/annoncer`);
    assert.deepEqual(await lien.agirCommande(ID(33), 'recu'), { statut: 'payee' });
    assert.equal(n.recu.at(-1)?.chemin, `/v0/commandes/${ID(33)}/recu`);
    assert.deepEqual(await lien.agirCommande(ID(31), 'verifier'), { statut: 'payee' });

    // payer en ligne : une page Stripe Checkout, rien d'autre
    assert.deepEqual(await lien.payer(ID(31), 'stripe'), { mode: 'stripe', url: 'https://checkout.stripe.com/c/pay/session-de-test#fragment' });
    assert.deepEqual(n.recu.at(-1)?.corps, { mode: 'stripe' });
    for (const piege of ['https://pirate.test/checkout.stripe.com/', 'https://checkout.stripe.com.pirate.test/c/pay', 'http://checkout.stripe.com/c/pay', 'https://checkout.stripe.com@pirate.test/', 'https://user:mdp@checkout.stripe.com/c', 'javascript:alert(1)//https://checkout.stripe.com/', '']) {
      n.paiement.stripe = piege;
      await assert.rejects(lien.payer(ID(31), 'stripe'), /Stripe Checkout/, piege);
    }
    await assert.rejects(lien.payer(ID(31), 'especes'), /Mode de paiement/);

    // payer par virement : IBAN (clé vérifiée), titulaire, montant, référence pour le libellé
    assert.deepEqual(await lien.payer(ID(31), 'virement'), { mode: 'virement', iban: 'FR7630006000011234567890189', titulaire: 'Scierie du Faou', montant: 1800, reference: 'NX-7K2Q9A' });
    n.paiement.iban = 'FR7630006000011234567890188'; // clé de contrôle fausse
    await assert.rejects(lien.payer(ID(31), 'virement'), /IBAN invalide/);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});

test('liens venant de Breizhcosystem : https seulement ; paiement en ligne seulement vers Stripe Checkout ; IBAN avec clé valide', () => {
  assert.equal(lienStripe('https://checkout.stripe.com/c/pay/cs_x'), 'https://checkout.stripe.com/c/pay/cs_x');
  assert.equal(lienStripe('https://checkout.stripe.com.pirate.test/'), null);
  assert.equal(lienStripe('https://pirate.test/?r=https://checkout.stripe.com/'), null);
  assert.equal(lienStripe(`https://checkout.stripe.com/${'a'.repeat(2000)}`), null);
  assert.equal(lienHttps('https://pay.vendeur.test/x'), 'https://pay.vendeur.test/x');
  assert.equal(lienHttps('http://pay.vendeur.test/x'), null);
  assert.equal(lienHttps('data:text/html,<script>'), null);
  assert.equal(ibanValide(IBAN_TEST), 'FR7630006000011234567890189');
  assert.equal(ibanValide('FR7630006000011234567890180'), null);
  assert.equal(ibanValide('pas un iban'), null);
});

test('routes du jeu /nexus/agent/* et /nexus/commandes/:id/payer : administrateur seulement, réponses relues', async () => {
  const n = nexusSimule();
  process.env.LB_AUTORISER_LOCAL = '1';
  const app = await Application.creer({ fetch: n.f });
  const serveur = creerServeur(app);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}/api/v1`;
  try {
    await relier(app.nexus, n);
    const client = () => {
      let cookie = '';
      return async (methode: string, chemin: string, corps?: unknown) => {
        const r = await fetch(base + chemin, { method: methode, headers: { ...(cookie ? { cookie } : {}), ...(methode !== 'GET' ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}) }, body: corps === undefined ? null : JSON.stringify(corps) });
        const sc = r.headers.get('set-cookie');
        if (sc) cookie = sc.split(';')[0] as string;
        return { statut: r.status, json: (await r.json().catch(() => null)) as any };
      };
    };
    const admin = client();
    assert.equal((await admin('POST', '/session', { profilId: 'dirigeante' })).statut, 200);
    const r = await admin('POST', '/nexus/agent/recherche', { texte: 'palettes Europe', quantite: 200 });
    assert.equal(r.statut, 200);
    assert.equal(r.json.propositions.length, 3);
    assert.equal((await admin('POST', '/nexus/agent/recherche', { texte: 'a' })).statut, 400);
    assert.equal((await admin('POST', '/nexus/agent/commander', { stockId: ID(11), quantite: 200 })).json.reference, 'NX-7K2Q9A');
    assert.equal((await admin('POST', '/nexus/agent/publier', { texte: 'palettes Europe' })).json.id, ID(41));
    assert.equal((await admin('POST', '/nexus/contacter', { objet: 'capacite', ref: ID(13), message: 'Bonjour' })).json.organisation, 'Bois d’Armor');
    assert.equal((await admin('POST', `/nexus/commandes/${ID(31)}/payer`, { mode: 'stripe' })).json.url, n.paiement.stripe);
    assert.equal((await admin('POST', `/nexus/commandes/${ID(31)}/payer`, { mode: 'virement' })).json.reference, 'NX-7K2Q9A');
    assert.equal((await admin('POST', `/nexus/commandes/${ID(31)}/annoncer`, {})).json.statut, 'paiement_annonce');
    assert.equal((await admin('POST', `/nexus/commandes/${ID(31)}/payee`, {})).statut, 400, 'ancienne action supprimée');
    n.paiement.stripe = 'https://pirate.test/payer';
    const refus = await admin('POST', `/nexus/commandes/${ID(31)}/payer`, { mode: 'stripe' });
    assert.equal(refus.statut, 502);
    assert.ok(!JSON.stringify(refus.json).includes('pirate.test'), 'l’adresse refusée n’est pas renvoyée à l’écran');
    // un profil qui n'administre pas : rien
    const terrain = client();
    await terrain('POST', '/session', { profilId: 'terrain' });
    for (const [chemin, corps] of [['/nexus/agent/recherche', { texte: 'palettes' }], ['/nexus/agent/commander', { stockId: ID(11), quantite: 1 }], ['/nexus/agent/publier', { texte: 'palettes' }], ['/nexus/contacter', { objet: 'catalogue', ref: ID(12) }], [`/nexus/commandes/${ID(31)}/payer`, { mode: 'stripe' }]] as const) {
      assert.equal((await terrain('POST', chemin, corps)).statut, 403, chemin);
    }
  } finally {
    delete process.env.LB_AUTORISER_LOCAL;
    await new Promise<void>((ok) => serveur.close(() => ok()));
  }
});

test('suspension par l’éditeur (403 entreprise_suspendue) : la clé est gardée et resservira ; seule une clé révoquée (401 cle_invalide) délie', async () => {
  const CLE = `nx_${'k'.repeat(43)}`;
  let reponse: 'ok' | 'suspendue' | 'revoquee' | 'autre401' = 'ok';
  const f = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const u = new URL(String(url));
    if (u.pathname === '/v0/liaison') return Response.json({ code: 'ABCD-2345', attente: 'a'.repeat(43), url: 'https://nexus.test/relier?code=ABCD-2345', expire: new Date(Date.now() + 600_000).toISOString() });
    if (u.pathname === '/v0/liaison/retrait') return Response.json({ statut: 'confirmee', cle: CLE, organisation: 'Menuiserie Kerlann' });
    assert.equal((init?.headers as Record<string, string>)?.authorization, `Bearer ${CLE}`, 'toujours la même clé, jamais effacée par la suspension');
    if (reponse === 'suspendue') return Response.json({ erreur: 'entreprise_suspendue', message: 'Contrôle en cours.' }, { status: 403 });
    if (reponse === 'revoquee') return Response.json({ erreur: 'cle_invalide' }, { status: 401 });
    if (reponse === 'autre401') return Response.json({ erreur: 'non_authentifie' }, { status: 401 });
    if (u.pathname === '/v0/droits') return Response.json({ orgId: ID(1), plan: 'gratuit', etatAbonnement: 'aucun', actifJusquau: null, capacites: ['decouvrir'], verifieLe: new Date().toISOString() });
    return Response.json({ categories: [] });
  };
  process.env.LB_AUTORISER_LOCAL = '1';
  try {
    const lien = new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), fetch: f as typeof fetch, changement: () => {}, urlParDefaut: null });
    await lien.reglerAdresse('http://127.0.0.1:4180');
    await lien.demarrerLiaison();
    assert.equal((await lien.suivreLiaison()).statut, 'reliee');
    reponse = 'suspendue';
    await assert.rejects(lien.partageNexus(), (e: any) => e.code === 'nexus_suspendu' && /conservée/.test(e.message));
    assert.equal(lien.relie, true, 'suspendue : toujours reliée');
    const pav = await lien.etatPavillon();
    assert.equal(pav.statut, 'suspendu');
    assert.deepEqual(lien.etat().suspendue && { message: lien.etat().suspendue?.message }, { message: 'Contrôle en cours.' });
    // un autre 401 de Breizhcosystem ne délie pas non plus (et ne passe pas pour la fin de la session du jeu)
    reponse = 'autre401';
    await assert.rejects(lien.partageNexus(), (e: any) => e.statut === 502 && e.code === 'non_authentifie');
    assert.equal(lien.relie, true);
    // levée de la suspension : la même clé resservit, sans nouvelle liaison
    reponse = 'ok';
    assert.equal((await lien.etatPavillon()).statut, 'connecte');
    assert.equal(lien.etat().suspendue, null);
    // clé révoquée : là, et là seulement, la liaison est effacée
    reponse = 'revoquee';
    await assert.rejects(lien.partageNexus(), /révoquée/);
    assert.equal(lien.relie, false);
  } finally { delete process.env.LB_AUTORISER_LOCAL; }
});
