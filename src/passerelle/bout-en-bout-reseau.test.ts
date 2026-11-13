/**
 * Bout en bout entre le jeu et le réseau : le VRAI lien réseau du jeu (LienNexus, avec ses sorties protégées) parle au VRAI
 * serveur de Breizhcosystem (service séparé, dépôt non public ; base en mémoire, annuaire des entreprises simulé).
 * Partout ailleurs, chaque dépôt simule l'autre : un contrat qui dérive entre les deux passerait inaperçu.
 *
 * Sauté quand les sources du réseau (ou leurs dépendances) ne sont pas à côté : c'est le cas dans la CI de ce dépôt et
 * pour toute personne qui n'a que ce dépôt. L'éditeur le lance avant une publication : `npm test` suffit si les deux
 * dossiers sont voisins ; LB_SOURCES_RESEAU=/chemin/vers/les-sources pour un autre emplacement. L'essai du temps réel
 * est sauté aussi face à des sources du réseau qui n'ont pas encore le relais des avis (src/serveur/relais.ts).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ObjetMetier } from '../core/model.ts';
import { Application } from './application.ts';
import { LienNexus } from './lien-nexus.ts';
import { ErreurApi } from './monde.ts';
import { compteConnecte, RelaisOAuth, type ConnexionOAuth, type FournisseurOAuth } from './oauth-relais.ts';
import { ErreurSortante, recuperateurProtege } from './sortant.ts';
import { chiffreurEphemere } from './stockage.ts';

process.env.LB_AUTORISER_LOCAL = '1'; // le réseau d'essai écoute sur 127.0.0.1, refusé sinon par les sorties protégées

const RACINE = process.env.LB_SOURCES_RESEAU ?? fileURLToPath(new URL('../../../breizh-eco-nexus/', import.meta.url));
const PRESENT = existsSync(join(RACINE, 'src/serveur/http.ts')) && existsSync(join(RACINE, 'node_modules'));
const saut = PRESENT ? false : 'dépôt du réseau absent à côté (ou sans ses dépendances)';
const sautTempsReel = saut || (existsSync(join(RACINE, 'src/serveur/relais.ts')) ? false : 'réseau voisin sans relais des avis des outils (temps réel)');
// modules du dépôt voisin : chargés par leur chemin, donc non typés ici
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Voisin = any;
const voisin = (fichier: string): Promise<Voisin> => import(pathToFileURL(join(RACINE, fichier)).href);

const ANNUAIRE: Record<string, string> = {};
const annuaire = async (u: string | URL): Promise<Response> => {
  const s = (new URL(String(u)).searchParams.get('q') ?? '').slice(0, 9);
  return Response.json({ results: ANNUAIRE[s] ? [{ siren: s, nom_complet: ANNUAIRE[s], activite_principale: '16.23Z', section_activite_principale: 'C', tranche_effectif_salarie: '11', etat_administratif: 'A',
    siege: { siret: `${s}00011`, code_postal: '29000', libelle_commune: 'QUIMPER', departement: '29', adresse: '12 RUE DU PORT 29000 QUIMPER' } }] : [] });
};

let base: Voisin;
let serveur: Server;
let consoleEditeur: Server;
let url = '';
let urlConsole = '';
let marquerVerifiee: Voisin;
let luhn: (s: string) => boolean;

/** Pipedrive simulé, vu du relais : échange du code, renouvellement (le jeton de renouvellement tourne), révocation. */
const chezOutil: { url: string; autorisation: string | null; corps: URLSearchParams }[] = [];
const revoques = new Set<string>();
let tour = 0;
const outil = async (u: string | URL, init?: RequestInit): Promise<Response> => {
  const corps = new URLSearchParams(String(init?.body ?? ''));
  chezOutil.push({ url: String(u), autorisation: new Headers(init?.headers).get('authorization'), corps });
  if (String(u) === 'https://oauth.pipedrive.com/oauth/revoke') { revoques.add(corps.get('token') ?? ''); return Response.json({}); }
  if (String(u) !== 'https://oauth.pipedrive.com/oauth/token') return Response.json({ error: 'inconnu' }, { status: 404 });
  if (corps.get('grant_type') === 'refresh_token' && revoques.has(corps.get('refresh_token') ?? '')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
  tour++;
  return Response.json({ access_token: `acces-essai-${tour}`, refresh_token: `renouvellement-essai-${tour}`, expires_in: 3600, token_type: 'Bearer', scope: 'base', api_domain: 'https://societe-essai.pipedrive.com' });
};
const APPLICATION = { id: 'application-essai', secret: ['secret', 'application', 'essai'].join('-') };

before(async () => {
  if (!PRESENT) return;
  const [{ Base }, { Reseau }, { creerServeurNexus }, verification, publics, { creerConsoleEditeur }, { RelaisOAuth: RelaisReseau }, { Coffre }] = await Promise.all(
    ['base.ts', 'reseau.ts', 'http.ts', 'verification.ts', 'public.ts', 'editeur.ts', 'oauth.ts', 'coffre.ts'].map((f) => voisin(`src/serveur/${f}`)));
  marquerVerifiee = verification.marquerVerifiee;
  luhn = publics.luhn;
  base = await Base.ouvrir(null);
  const relais = new RelaisReseau({ coffre: new Coffre(), origine: 'https://reseau.test', applications: { pipedrive: APPLICATION }, fetch: outil, base });
  serveur = creerServeurNexus(new Reseau({ base, origine: 'https://reseau.test', fetch: annuaire }), { facteurEssais: 100, oauth: relais });
  consoleEditeur = creerConsoleEditeur(base);
  await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok));
  await new Promise<void>((ok) => consoleEditeur.listen(0, '127.0.0.1', ok));
  url = `http://127.0.0.1:${(serveur.address() as AddressInfo).port}`;
  urlConsole = `http://localhost:${(consoleEditeur.address() as AddressInfo).port}`;
});
after(async () => {
  if (!PRESENT) return;
  serveur.close();
  consoleEditeur.close();
  await base.fermer();
});

const sql = <T = Record<string, unknown>>(texte: string, p: unknown[] = []): Promise<T[]> => base.systeme(async (tx: Voisin) => (await tx.query(texte, p)).rows);
const siren = (debut: string) => { for (let d = 0; d <= 9; d++) if (luhn(`${debut}${d}`)) return `${debut}${d}`; throw new Error('luhn'); };
const MDP = 'une phrase assez longue';
const IBAN_TEST = 'FR76 3000 6000 0112 3456 7890 189'; // IBAN d'exemple (clé valide), aucun compte réel

/** Une personne sur le site de Breizhcosystem (session par cookie), comme dans son navigateur. */
function personne() {
  let cookie = '';
  return async (m: string, c: string, corps?: unknown) => {
    const h: Record<string, string> = {};
    if (cookie) h.cookie = cookie;
    if (m !== 'GET') { h['content-type'] = 'application/json'; h['x-nx-requete'] = '1'; }
    const r = await fetch(url + c, { method: m, headers: h, body: corps === undefined ? null : JSON.stringify(corps) });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0] as string;
    const texte = await r.text();
    let json: Voisin = null;
    try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
    return { statut: r.status, json };
  };
}
const consoleApi = async (c: string, corps: unknown) => (await fetch(urlConsole + c, { method: 'POST', headers: { 'content-type': 'application/json', 'x-nx-console': '1' }, body: JSON.stringify(corps) })).status;

let n = 0;
/** Entreprise inscrite sur le réseau par son administratrice, vérifiée par l'éditeur, offre payante ouverte. */
async function membre(nom: string) {
  const s = siren(String(61_000_000 + n++));
  ANNUAIRE[s] = nom;
  const appel = personne();
  const email = `personne${n}@exemple.test`;
  const r = await appel('POST', '/v0/inscription', { siret: `${s}00011`, nom: `Personne ${n}`, email, motDePasse: MDP });
  assert.equal(r.statut, 200, JSON.stringify(r.json));
  const orgId = (await sql<{ id: string }>('SELECT id FROM organisations WHERE siren = $1', [s]))[0]!.id;
  await base.systeme((tx: Voisin) => marquerVerifiee(tx, orgId, 'editeur'));
  await sql(`UPDATE organisations SET active_offert_jusqu = now() + interval '1 month' WHERE id = $1`, [orgId]);
  return { appel, orgId, email };
}

/** Le Living Business d'une entreprise : son vrai lien réseau, sorties protégées comprises. */
const jeu = () => new LienNexus({ etat: null, chiffreur: chiffreurEphemere(), changement: () => { /* rien à enregistrer ici */ }, urlParDefaut: url });
/** Liaison en un clic : le jeu demande un code, l'administratrice le confirme sur le site, le jeu retire sa clé. */
async function relier(lien: LienNexus, admin: Awaited<ReturnType<typeof membre>>) {
  const d = await lien.demarrerLiaison();
  assert.equal(new URL(d.url).searchParams.get('code'), d.code);
  assert.equal((await lien.suivreLiaison()).statut, 'en_attente');
  const c = await admin.appel('POST', '/v0/liaison/confirmer', { code: d.code });
  assert.equal(c.statut, 200, JSON.stringify(c.json));
  const s = await lien.suivreLiaison();
  assert.equal(s.statut, 'reliee');
  return s;
}
const refus = async (f: () => Promise<unknown>) => {
  try { await f(); } catch (e) { if (e instanceof ErreurApi) return [e.statut, e.code]; throw e; }
  return [200, null];
};

const maintenant = new Date();
const jour = (n: number) => new Date(maintenant.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const o = (id: string, famille: string, type: string, nom: string, champs: Record<string, unknown>): ObjetMetier => ({
  id, orgId: 'o', famille, type, roles: [], nom, champs: champs as ObjetMetier['champs'], provenance: 'declare',
  source: { id: 's', libelle: 's', derniereSynchro: null }, majLe: maintenant.toISOString(), disponibilite: 'disponible', mode: 'reel',
} as ObjetMetier);

test('bout en bout : liaison en un clic, droits lus, partage seulement sur accord, reçu par le vrai réseau', { skip: saut }, async () => {
  const e = await membre('MENUISERIE KERLANN');
  const lien = jeu();
  const s = await relier(lien, e);
  assert.match(String(s.organisation), /KERLANN/i);
  const pavillon = await lien.etatPavillon();
  assert.equal(pavillon.statut, 'connecte', 'les droits rendus par le réseau sont lisibles par le jeu');

  const donnees = {
    objets: [
      o('org', 'organisation', 'mon_entreprise', 'Menuiserie Kerlann', { secteur: 'Menuiserie' }),
      o('a1', 'ressource', 'article', 'Contreplaqué 18 mm', { quantite: 2, seuil_alerte: 10, unite: 'plaque' }),
      o('a2', 'ressource', 'article', 'Vis inox', { quantite: 500, seuil_alerte: 100, unite: 'boîte' }),
      o('e1', 'personne', 'employe', 'Nolwenn Le Goff', {}),
      o('e2', 'personne', 'employe', 'Yann Morvan', {}),
      o('e3', 'personne', 'employe', 'Soazig Kervella', {}),
    ],
    // demain : trois personnes libres ; après-demain : une seule (elle serait reconnaissable)
    planning: new Map([['e1', new Map([[jour(1), ''], [jour(2), '']])], ['e2', new Map([[jour(1), ''], [jour(2), 'lieu:l1']])], ['e3', new Map([[jour(1), ''], [jour(2), 'lieu:l1']])]]),
    sante: null, maintenant,
  };
  // rien de coché dans le jeu : rien ne part
  assert.deepEqual(await lien.partage(), []);
  assert.equal((await lien.envoyer(donnees)).rienAEnvoyer, true);
  assert.equal((await sql('SELECT 1 FROM stocks WHERE org_id = $1', [e.orgId])).length, 0);

  const regle = await lien.reglerPartage(['profil', 'besoins', 'stocks', 'capacites']);
  assert.deepEqual(regle.categories, ['profil', 'besoins', 'stocks', 'capacites']);
  assert.deepEqual(await lien.partage(), ['profil', 'besoins', 'stocks', 'capacites']);
  const envoi = await lien.envoyer(donnees);
  assert.deepEqual(Object.keys(envoi.envoye).sort(), ['besoins', 'capacites', 'profil', 'stocks']);
  assert.ok(envoi.recu, 'le réseau accuse réception');
  // ce que le réseau a vraiment gardé
  assert.deepEqual((await sql<{ titre: string; quantite: number }>('SELECT titre, quantite::float AS quantite FROM stocks WHERE org_id = $1', [e.orgId])), [{ titre: 'Vis inox', quantite: 300 }]);
  assert.deepEqual((await sql<{ titre: string }>('SELECT titre FROM besoins WHERE org_id = $1', [e.orgId])).map((b) => b.titre), ['Contreplaqué 18 mm — réassort']);
  // le jeu envoie les deux jours ; le réseau ne garde pas « 1 personne disponible » (elle serait reconnaissable)
  assert.equal((envoi.envoye.capacites as unknown[]).length, 2);
  const capacites = await sql<{ titre: string }>('SELECT titre FROM capacites WHERE org_id = $1', [e.orgId]);
  assert.deepEqual(capacites.map((c) => c.titre.replace(/\u00A0/g, ' ')), ['3 personnes disponibles en renfort']);
  assert.ok(!/Nolwenn|Yann|Soazig/.test(JSON.stringify(capacites)), 'un nombre de personnes, jamais un nom');

  // lectures que l'écran du jeu fait à l'ouverture de l'onglet du réseau
  for (const lecture of [() => lien.opportunites(), () => lien.comparaison(), () => lien.parrainages(), () => lien.mandats(), () => lien.commandes()]) assert.ok(await lecture());
});

test('bout en bout : recherche, commande au prix vu, nouvel essai sans double commande, plafond, vente confirmée, virement', { skip: saut }, async () => {
  const vendeur = await membre('SCIERIE DU TRÉGOR');
  const acheteur = await membre('ATELIER DU GOËLO');
  const publier = async (prix: number) => {
    assert.equal((await vendeur.appel('PUT', '/v0/partage', { categories: ['stocks'] })).statut, 200);
    assert.equal((await vendeur.appel('POST', '/v0/partage/donnees', { stocks: [{ cle: 'ctp', titre: 'Contreplaqué marine 18 mm', categorie: 'Bois', quantite: 50, unite: 'plaque', prixUnitaire: prix }] })).statut, 200);
  };
  await publier(40);
  const lienA = jeu();
  await relier(lienA, acheteur);

  const { propositions } = await lienA.rechercher({ texte: 'Contreplaqué marine', quantite: 4 });
  const p = propositions.find((x) => x.type === 'stock' && /Contreplaqué marine/.test(x.titre));
  assert.ok(p, `le stock du vendeur est proposé : ${JSON.stringify(propositions)}`);
  assert.deepEqual([p.prixUnitaire, p.total, p.verifie], [40, 160, true]);

  // la personne a vu 4 × 40 € et valide : commande « validée » ; le délai dépassé rejoue la même clé → même commande
  const cle = randomUUID();
  const c1 = await lienA.commanderRecherche({ stockId: p.id, quantite: 4, prixUnitaire: 40, cle });
  assert.equal(c1.statut, 'validee');
  assert.match(String(c1.reference), /^NX-/);
  const rejoue = await lienA.commanderRecherche({ stockId: p.id, quantite: 4, prixUnitaire: 40, cle });
  assert.deepEqual([rejoue.id, rejoue.reference], [c1.id, c1.reference]);
  const vues = await lienA.commandes();
  assert.deepEqual(vues.map((c) => [c.id, c.statut, c.achat, c.quantite, c.prixUnitaire]), [[c1.id, 'validee', true, 4, 40]]);

  // sans prix présenté : jamais validée d'office
  assert.equal((await lienA.commanderRecherche({ stockId: p.id, quantite: 1, cle: randomUUID() })).statut, 'a_valider');
  // le vendeur change son prix : le prix vu ne vaut plus, le réseau refuse au lieu de commander à un prix jamais vu
  // (et, dans l'heure qui suit, il refuse aussi une commande qui ne dit pas quel prix a été vu)
  await publier(45);
  assert.deepEqual(await refus(() => lienA.commanderRecherche({ stockId: p.id, quantite: 1, prixUnitaire: 40, cle: randomUUID() })), [409, 'prix_change']);
  assert.deepEqual(await refus(() => lienA.commanderRecherche({ stockId: p.id, quantite: 1, cle: randomUUID() })), [409, 'prix_change']);
  // plafond fixé par l'administratrice pour ce que Living Business engage : au-delà, « à valider » sur le réseau
  assert.equal((await acheteur.appel('PUT', '/v0/cles/plafond', { plafond: 100 })).statut, 200);
  const gros = await lienA.commanderRecherche({ stockId: p.id, quantite: 3, prixUnitaire: 45, cle: randomUUID() });
  assert.deepEqual([gros.statut, gros.plafond], ['a_valider', 100]);

  // côté vendeur, depuis SON Living Business : il voit la vente et la confirme au prix affiché
  const lienV = jeu();
  await relier(lienV, vendeur);
  const vente = (await lienV.commandes()).find((c) => c.id === c1.id);
  assert.deepEqual([vente?.statut, vente?.achat], ['validee', false]);
  assert.equal((await lienV.agirCommande(c1.id as string, 'confirmer', { prix: 'affiche' })).statut, 'confirmee');

  // paiement direct au vendeur : coordonnées de virement relues par le jeu (IBAN à clé valide, référence, montant)
  const iban = await vendeur.appel('PUT', '/v0/paiement', { iban: IBAN_TEST, titulaire: 'Scierie du Trégor', motDePasse: MDP });
  assert.equal(iban.statut, 200, JSON.stringify(iban.json));
  const confirmee = (await lienA.commandes()).find((c) => c.id === c1.id);
  assert.deepEqual([confirmee?.statut, confirmee?.paiement?.virement], ['confirmee', true]);
  const virement = await lienA.payer(c1.id as string, 'virement');
  assert.deepEqual([virement.mode, 'montant' in virement && virement.montant, 'reference' in virement && virement.reference], ['virement', 160, c1.reference]);
  assert.equal((await lienA.agirCommande(c1.id as string, 'annoncer')).statut, 'paiement_annonce');
  assert.equal((await lienV.agirCommande(c1.id as string, 'recu')).statut, 'payee');
});

test('bout en bout : entreprise suspendue (liaison gardée) puis rétablie ; clé révoquée (liaison effacée)', { skip: saut }, async () => {
  const e = await membre('CHARPENTES DE CORNOUAILLE');
  const lien = jeu();
  await relier(lien, e);
  assert.equal(await consoleApi(`/api/entreprises/${e.orgId}/suspendre`, { motif: 'contrôle en cours' }), 200);
  assert.deepEqual(await refus(() => lien.opportunites()), [409, 'nexus_suspendu']);
  assert.equal((await lien.etatPavillon()).statut, 'suspendu');
  assert.equal(lien.relie, true, 'la clé est gardée pendant la suspension');
  assert.equal(await consoleApi(`/api/entreprises/${e.orgId}/retablir`, { motif: 'contrôle terminé' }), 200);
  assert.equal((await lien.etatPavillon()).statut, 'connecte');
  assert.equal(lien.etat().suspendue, null);

  // la suspension a fermé les sessions de l'entreprise : l'administratrice se reconnecte
  assert.equal((await e.appel('POST', '/v0/session', { email: e.email, motDePasse: MDP })).statut, 200);
  const cles = (await e.appel('GET', '/v0/cles')).json as { id: string }[];
  assert.equal(cles.length, 1, JSON.stringify(cles));
  const r = await e.appel('POST', `/v0/cles/${cles[0]!.id}/revoquer`, { motDePasse: MDP });
  assert.equal(r.statut, 200, JSON.stringify(r.json));
  assert.deepEqual(await refus(() => lien.opportunites()), [409, 'nexus_non_relie']);
  assert.equal(lien.relie, false, 'clé révoquée sur le réseau : le jeu oublie sa liaison');
});

test('bout en bout : mandat d’achat, passage de l’agent, demande publiée, prise de contact', { skip: saut }, async () => {
  const vendeur = await membre('QUINCAILLERIE DE L’ODET');
  const acheteur = await membre('MENUISERIE DU PORT');
  assert.equal((await vendeur.appel('PUT', '/v0/partage', { categories: ['stocks'] })).statut, 200);
  assert.equal((await vendeur.appel('POST', '/v0/partage/donnees', { stocks: [{ cle: 'vis', titre: 'Vis inox A4 5×50', categorie: 'Vis inox', quantite: 80, unite: 'boîte', prixUnitaire: 12 }] })).statut, 200);
  const lien = jeu();
  await relier(lien, acheteur);

  const cree = await lien.creerMandat({ nom: 'Quincaillerie', budgetMensuel: 500, categories: ['Vis inox'], remiseCible: 0.05 });
  assert.match(String(cree.id), /^[0-9a-f-]{36}$/);
  const mandats = await lien.mandats();
  assert.deepEqual(mandats.map((m) => [m.id, m.nom, m.budgetMensuel]), [[cree.id, 'Quincaillerie', 500]]);
  await lien.basculerMandat(cree.id as string, false);
  await lien.basculerMandat(cree.id as string, true);
  assert.equal(typeof (await lien.lancerAgent()).preparees, 'number');

  const demande = await lien.publierDemande({ texte: 'Location nacelle 12 m', quantite: 1, departement: '29' });
  assert.match(String(demande.id), /^[0-9a-f-]{36}$/);
  const stockId = (await sql<{ id: string }>('SELECT id FROM stocks WHERE org_id = $1', [vendeur.orgId]))[0]!.id;
  const contact = await lien.contacter({ objet: 'stock', ref: stockId, message: 'Bonjour, le lot est-il encore disponible ?' });
  assert.match(String(contact.organisation), /ODET/i);
});

test('bout en bout : échanges entre agents — prix demandé depuis le jeu, réponse de la règle du vendeur ou d’une personne, validation par une personne sur le réseau seulement', { skip: saut }, async () => {
  const scierie = await membre('SCIERIE DE L’AULNE');
  const negoce = await membre('NÉGOCE BOIS DU PORZAY');
  const acheteur = await membre('ÉBÉNISTERIE DU CAP');
  const publier = async (vendeur: Awaited<ReturnType<typeof membre>>, stock: Record<string, unknown>) => {
    assert.equal((await vendeur.appel('PUT', '/v0/partage', { categories: ['stocks'] })).statut, 200);
    assert.equal((await vendeur.appel('POST', '/v0/partage/donnees', { stocks: [stock] })).statut, 200);
  };
  await publier(scierie, { cle: 'chene', titre: 'Plateaux de chêne 27 mm', categorie: 'Bois', quantite: 50, unite: 'plateau', prixUnitaire: 40 });
  await publier(negoce, { cle: 'hetre', titre: 'Plateaux de hêtre 27 mm', categorie: 'Bois', quantite: 30, unite: 'plateau', prixUnitaire: 30 });
  // la scierie laisse son agent répondre seul jusqu'à 10 % sous le prix affiché, propositions valables 5 jours ;
  // le négoce n'a rien réglé : chez lui, toute demande attend une personne (réponse automatique coupée par défaut)
  const regles = await scierie.appel('PUT', '/v0/echanges/regles', { reponseAuto: true, remiseMax: 0.1, validiteJours: 5 });
  assert.equal(regles.statut, 200, JSON.stringify(regles.json));

  // le jeu de l'acheteur ; son chiffreur est gardé pour lire la clé de liaison plus bas (contrôle du contrat, voir 4)
  const chiffreur = chiffreurEphemere();
  const lienA = new LienNexus({ etat: null, chiffreur, changement: () => { /* rien à enregistrer ici */ }, urlParDefaut: url });
  await relier(lienA, acheteur);
  assert.deepEqual(await lienA.echanges(), { echanges: [], page: `${url}/echanges` });
  const { propositions } = await lienA.rechercher({ texte: 'Plateaux chêne hêtre', quantite: 4 });
  const chene = propositions.find((x) => x.type === 'stock' && /chêne/.test(x.titre));
  const hetre = propositions.find((x) => x.type === 'stock' && /hêtre/.test(x.titre));
  assert.ok(chene && hetre, `les stocks des deux vendeurs sont proposés : ${JSON.stringify(propositions)}`);

  // 1. prix demandé dans les règles du vendeur : son agent répond aussitôt ; la proposition attend une personne de l'acheteur
  const cle = randomUUID();
  const d1 = await lienA.demanderPrix({ stockId: chene.id, quantite: 4, prixSouhaite: 38, cle });
  assert.deepEqual([d1.echange.statut, d1.echange.cote, d1.echange.attend, d1.echange.avancement], ['proposee', 'acheteur', 'vous', 'attend_personne']);
  assert.deepEqual([d1.echange.titre, d1.echange.stockId, d1.echange.quantite, d1.echange.prixSouhaite], ['Plateaux de chêne 27 mm', chene.id, 4, 38]);
  assert.deepEqual([d1.echange.proposition?.quantite, d1.echange.proposition?.prixUnitaire, d1.echange.proposition?.total, d1.echange.proposition?.par], [4, 38, 152, 'regle']);
  assert.ok(Date.parse(d1.echange.proposition?.valableJusquau ?? '') > Date.now() + 4 * 86_400_000, 'valable 5 jours');
  // où valider : la page du réseau à l'adresse réglée dans le jeu (pas celle qu'écrit le réseau dans sa réponse), et elle existe
  assert.equal(d1.page, `${url}/echanges`);
  const page = await fetch(String(d1.page));
  assert.deepEqual([page.status, (page.headers.get('content-type') ?? '').split(';')[0]], [200, 'text/html']);
  // délai dépassé : la même demande rejouée avec la même clé rend le même échange, sans en créer un second
  assert.equal((await lienA.demanderPrix({ stockId: chene.id, quantite: 4, prixSouhaite: 38, cle })).echange.id, d1.echange.id);
  // une autre demande sur le même stock : refusée tant que la première est en cours, le message du réseau arrive tel quel
  await assert.rejects(lienA.demanderPrix({ stockId: chene.id, quantite: 2 }), (e: unknown) => e instanceof ErreurApi && e.statut === 409 && e.code === 'deja_en_cours' && /déjà en cours/.test(e.message));

  // 2. vendeur sans réponse automatique : la demande attend une personne de chez lui, rien à faire côté acheteur
  const d2 = await lienA.demanderPrix({ stockId: hetre.id, quantite: 10 });
  assert.deepEqual([d2.echange.statut, d2.echange.attend, d2.echange.proposition, d2.echange.prixSouhaite], ['attente_vendeur', 'autre', null, null]);
  // ce qui attend l'entreprise vient en premier
  assert.deepEqual((await lienA.echanges()).echanges.map((e) => [e.id, e.attend]), [[d1.echange.id, 'vous'], [d2.echange.id, 'autre']]);

  // 3. chaque vendeur, depuis SON jeu, voit ce qui le concerne ; une personne du négoce répond sur le réseau
  const lienS = jeu();
  await relier(lienS, scierie);
  assert.deepEqual((await lienS.echanges()).echanges.map((e) => [e.id, e.cote, e.statut, e.attend]), [[d1.echange.id, 'vendeur', 'proposee', 'autre']]);
  const lienN = jeu();
  await relier(lienN, negoce);
  assert.deepEqual((await lienN.echanges()).echanges.map((e) => [e.id, e.cote, e.statut, e.attend]), [[d2.echange.id, 'vendeur', 'attente_vendeur', 'vous']]);
  const reponse = await negoce.appel('POST', `/v0/echanges/${d2.echange.id}/repondre`, { prixUnitaire: 27, quantite: 10 });
  assert.equal(reponse.statut, 200, JSON.stringify(reponse.json));
  const repondu = (await lienA.echanges()).echanges.find((e) => e.id === d2.echange.id);
  assert.deepEqual([repondu?.statut, repondu?.attend, repondu?.proposition?.prixUnitaire, repondu?.proposition?.total, repondu?.proposition?.par], ['proposee', 'vous', 27, 270, 'personne']);

  // 4. contrat suivi par le jeu : le réseau refuse à la clé de liaison de valider une proposition (comme à toute clé), par
  //    son API comme par son agent. Si l'un de ces refus tombe, le réseau a changé de règle : revoir alors le jeu.
  const cleLiaison = chiffreur.dechiffrer(String(lienA.instantane().cle));
  const parCle = async (chemin: string, corps: unknown, entetes: Record<string, string> = {}) => {
    const r = await fetch(url + chemin, { method: 'POST', headers: { authorization: `Bearer ${cleLiaison}`, 'content-type': 'application/json', ...entetes }, body: JSON.stringify(corps) });
    return [r.status, JSON.stringify(await r.json())] as const;
  };
  const refusApi = await parCle(`/v0/echanges/${d1.echange.id}/valider`, {});
  assert.equal(refusApi[0], 403, `le réseau ne refuse plus à la clé de liaison de valider un échange par son API : ${refusApi[1]}`);
  assert.match(refusApi[1], /session_requise/);
  const refusAgent = await parCle('/a2a/message:send', { message: { messageId: randomUUID(), role: 'ROLE_USER', taskId: d1.echange.id, parts: [{ data: { action: 'valider' } }] } }, { 'a2a-version': '1.0' });
  assert.equal(refusAgent[0], 403, `l’agent du réseau ne refuse plus de valider pour une clé : ${refusAgent[1]}`);
  assert.match(refusAgent[1], /PERSONNE_REQUISE/);
  assert.equal((await lienA.echanges()).echanges.find((e) => e.id === d1.echange.id)?.statut, 'proposee', 'rien n’a été validé par une clé');

  // 5. une personne de l'acheteur valide sur le réseau, connectée : l'échange est conclu, la commande suit le parcours existant
  const validation = await acheteur.appel('POST', `/v0/echanges/${d1.echange.id}/valider`, {});
  assert.equal(validation.statut, 200, JSON.stringify(validation.json));
  const conclu = (await lienA.echanges()).echanges.find((e) => e.id === d1.echange.id);
  assert.deepEqual([conclu?.statut, conclu?.avancement, conclu?.attend, conclu?.commande?.statut], ['acceptee', 'conclu', null, 'validee']);
  assert.match(String(conclu?.commande?.reference), /^NX-/);
  const commande = (await lienA.commandes()).find((c) => c.reference === conclu?.commande?.reference);
  assert.deepEqual([commande?.statut, commande?.achat, commande?.quantite], ['validee', true, 4]);
  // le vendeur confirme la vente depuis son jeu, comme pour toute commande
  assert.equal((await lienS.agirCommande(String(commande?.id), 'confirmer')).statut, 'confirmee');
  assert.equal((await lienS.echanges()).echanges.find((e) => e.id === d1.echange.id)?.commande?.statut, 'confirmee');
});

test('bout en bout : « Se connecter avec… » par le vrai relais — consentement, jetons, renouvellement, révocation chez l’outil', { skip: saut }, async () => {
  const relais = new RelaisOAuth({ adresse: () => url });
  // WooCommerce n'a pas d'application à déclarer (la boutique remet ses propres clés) : toujours ouvert
  assert.deepEqual(await relais.fournisseurs(), ['pipedrive', 'woocommerce'], 'seuls les outils dont l’éditeur a déclaré l’application');

  // 1. le jeu demande la page de connexion ; il affiche le code court de la demande
  const d = await relais.demarrer('pipedrive', { droits: 'ecriture' });
  const page = new URL(d.url);
  assert.deepEqual([page.origin + page.pathname, page.searchParams.get('client_id')], ['https://oauth.pipedrive.com/oauth/authorize', APPLICATION.id]);
  assert.match(String(d.verification), /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.deepEqual(await relais.retrait('pipedrive', d.attente), { statut: 'attente' });

  // 2. dans son navigateur, la personne consent chez l'outil, revient sur le réseau et recopie le code affiché par SON jeu
  let cookie = '';
  const navigateur = async (methode: 'GET' | 'POST', chemin: string, formulaire?: Record<string, string>) => {
    const r = await fetch(url + chemin, {
      method: methode, redirect: 'manual',
      headers: { ...(cookie ? { cookie } : {}), ...(formulaire ? { 'content-type': 'application/x-www-form-urlencoded', origin: url, 'sec-fetch-site': 'same-origin' } : {}) },
      body: formulaire ? new URLSearchParams(formulaire).toString() : null,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0] as string;
    return { statut: r.status, html: await r.text() };
  };
  const retour = await navigateur('GET', `/oauth/retour?code=code-du-consentement&state=${encodeURIComponent(page.searchParams.get('state') ?? '')}`);
  assert.equal(retour.statut, 200);
  const champ = (nom: string) => new RegExp(`name="${nom}" value="([^"]+)"`).exec(retour.html)?.[1] ?? '';
  assert.ok(champ('etat') && champ('jeton'), 'page de confirmation du réseau');
  assert.ok(!retour.html.includes(String(d.verification)), 'le code n’est pas écrit sur la page : il se recopie depuis le jeu');
  const fin = await navigateur('POST', '/oauth/retour', { etat: champ('etat'), jeton: champ('jeton'), decision: 'accepter', code: String(d.verification) });
  assert.equal(fin.statut, 200);

  // 3. le jeu retire ses jetons, une seule fois
  const x = await relais.retrait('pipedrive', d.attente);
  assert.equal(x.statut, 'connecte', JSON.stringify(x));
  if (x.statut !== 'connecte') return;
  const c = x.connexion;
  assert.deepEqual([c.acces, c.rafraichissement, c.extra.api_domain, c.relais], ['acces-essai-1', 'renouvellement-essai-1', 'https://societe-essai.pipedrive.com', url]);
  assert.equal((await relais.retrait('pipedrive', d.attente)).statut, 'expire', 'les jetons ne se retirent qu’une fois');
  const echange = chezOutil.find((e) => e.corps.get('grant_type') === 'authorization_code');
  assert.equal(echange?.autorisation, `Basic ${Buffer.from(`${APPLICATION.id}:${APPLICATION.secret}`).toString('base64')}`, 'le secret de l’application ne quitte pas le relais');
  assert.ok(!JSON.stringify(x).includes(APPLICATION.secret));

  // 4. renouvellement par le relais : le jeton de renouvellement tourne, le jeu garde le nouveau
  const c2 = await relais.rafraichir(c);
  assert.deepEqual([c2.acces, c2.rafraichissement], ['acces-essai-2', 'renouvellement-essai-2']);

  // 5. « Débrancher » : révoqué chez l'outil avec le secret de l'application, puis plus jamais renouvelé
  assert.equal(await relais.revoquer(c2, true), true);
  const revocation = chezOutil.find((e) => e.url.endsWith('/oauth/revoke'));
  assert.deepEqual([revocation?.corps.get('token'), revocation?.corps.get('token_type_hint')], ['renouvellement-essai-2', 'refresh_token']);
  await assert.rejects(() => relais.rafraichir(c2), (e: unknown) => e instanceof ErreurSortante && e.statut === 401);
});

/**
 * HubSpot, Notion et Shopify simulés, vus du relais, tels que leur documentation les décrit en novembre 2026 (API OAuth
 * datée de HubSpot, jeton de renouvellement de Notion, jetons expirants de Shopify). Ils acceptent aussi les appels d'un
 * relais d'avant ces changements : le même essai vérifie alors que le jeu à jour le tolère.
 */
const BOUTIQUE = 'boutique-essai.myshopify.com';
/** HubSpot garde le même jeton de renouvellement d'un renouvellement à l'autre (faux jeton, fabriqué à l'exécution). */
const RENOUVELLEMENT_HUBSPOT = ['hs', 'renouvellement', 'essai'].join('-');
const outils2026 = { appels: [] as { url: string; corps: Record<string, string> }[], revoques: [] as string[], n: 0 };
const outil2026 = async (u: string | URL, init?: RequestInit): Promise<Response> => {
  const url = String(u);
  const brut = String(init?.body ?? '');
  const corps: Record<string, string> = brut.startsWith('{') ? JSON.parse(brut) : Object.fromEntries(new URLSearchParams(brut));
  outils2026.appels.push({ url, corps });
  const n = ++outils2026.n;
  if (url.startsWith('https://api.hubapi.com/oauth/')) {
    if (url.endsWith('/token/introspect')) return Response.json({ active: true, hub_id: 4242, hub_domain: 'societe-essai.example', user: 'personne@exemple.test' });
    if (url.endsWith('/token/revoke')) { outils2026.revoques.push(corps.token ?? ''); return new Response(null, { status: 204 }); }
    return Response.json({ token_type: 'bearer', access_token: `hs-acces-${n}`, refresh_token: RENOUVELLEMENT_HUBSPOT, hub_id: 4242, expires_in: 1800 });
  }
  if (url === 'https://api.notion.com/v1/oauth/revoke') { outils2026.revoques.push(corps.token ?? ''); return Response.json({}); }
  if (url === 'https://api.notion.com/v1/oauth/token') return Response.json({ access_token: `no-acces-${n}`, token_type: 'bearer', refresh_token: `no-renouvellement-${n}`, bot_id: 'b', workspace_id: 'w', workspace_name: 'Société Essai' });
  if (url === `https://${BOUTIQUE}/admin/oauth/access_token`) {
    // sans `expiring=1` (relais d'avant) : jeton sans fin, sans jeton de renouvellement
    if (corps.grant_type !== 'refresh_token' && corps.expiring !== '1') return Response.json({ access_token: `shpat-sans-fin-${n}`, scope: 'read_customers' });
    return Response.json({ access_token: `shpat-essai-${n}`, scope: 'read_customers', expires_in: 3600, refresh_token: `shprt-essai-${n}`, refresh_token_expires_in: 7_776_000 });
  }
  return Response.json({ error: 'inconnu' }, { status: 404 });
};

test('bout en bout : HubSpot, Notion et Shopify (formats de 2026) par le vrai relais — et un relais pas encore à jour reste toléré', { skip: saut }, async () => {
  const [{ Reseau }, { creerServeurNexus }, { RelaisOAuth: RelaisReseau }, { Coffre }] = await Promise.all(['reseau.ts', 'http.ts', 'oauth.ts', 'coffre.ts'].map((f) => voisin(`src/serveur/${f}`)));
  const applications = { hubspot: APPLICATION, notion: APPLICATION, shopify: APPLICATION };
  const serveur2 = creerServeurNexus(new Reseau({ base, origine: 'https://reseau.test', fetch: annuaire }), { facteurEssais: 100, oauth: new RelaisReseau({ coffre: new Coffre(), origine: 'https://reseau.test', applications, fetch: outil2026, base }) }) as Server;
  await new Promise<void>((ok) => serveur2.listen(0, '127.0.0.1', ok));
  const url2 = `http://127.0.0.1:${(serveur2.address() as AddressInfo).port}`;
  try {
    const relais = new RelaisOAuth({ adresse: () => url2 });
    /** Connexion complète : le jeu lance, la personne consent chez l'outil, recopie le code sur le réseau, le jeu retire ses jetons. */
    const connecter = async (f: FournisseurOAuth, p: { boutique?: string } = {}): Promise<ConnexionOAuth> => {
      const d = await relais.demarrer(f, { ...p, droits: 'lecture' });
      const q = new URLSearchParams({ code: 'code-du-consentement', state: new URL(d.url).searchParams.get('state') ?? '' });
      if (f === 'shopify') {
        // retour signé par Shopify avec le secret de l'application
        q.set('shop', BOUTIQUE);
        q.set('timestamp', '1');
        q.set('hmac', createHmac('sha256', APPLICATION.secret).update([...q.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&')).digest('hex'));
      }
      const page = await (await fetch(`${url2}/oauth/retour?${q}`)).text();
      const champ = (nom: string) => new RegExp(`name="${nom}" value="([^"]+)"`).exec(page)?.[1] ?? '';
      const fin = await fetch(`${url2}/oauth/retour`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: url2, 'sec-fetch-site': 'same-origin' }, body: new URLSearchParams({ etat: champ('etat'), jeton: champ('jeton'), decision: 'accepter', code: String(d.verification) }).toString() });
      assert.equal(fin.status, 200);
      const x = await relais.retrait(f, d.attente);
      assert.equal(x.statut, 'connecte', JSON.stringify(x));
      if (x.statut !== 'connecte') throw new Error('connexion attendue');
      return x.connexion;
    };
    const expiree = (e: unknown) => e instanceof ErreurSortante && e.statut === 401;
    const dernier = () => outils2026.appels.at(-1)!;

    // Shopify d'abord : un relais à jour remet un jeton expirant et son jeton de renouvellement
    const sh = await connecter('shopify', { boutique: BOUTIQUE });
    const aJour = sh.rafraichissement !== null;
    assert.equal(sh.extra.boutique, BOUTIQUE);
    if (aJour) {
      assert.ok(Date.parse(sh.expire ?? '') > Date.now() && Date.parse(sh.rafraichissementExpire ?? '') > Date.now() + 80 * 86_400_000, 'fins de validité du jeton d’accès (1 h) et du jeton de renouvellement (90 jours)');
      assert.equal(dernier().corps.expiring, '1');
      const sh2 = await relais.rafraichir(sh);
      assert.deepEqual([dernier().url, dernier().corps.grant_type], [`https://${BOUTIQUE}/admin/oauth/access_token`, 'refresh_token'], 'renouvelé sur la boutique de la connexion');
      assert.ok(sh.rafraichissement?.endsWith(`|${dernier().corps.refresh_token}`), 'Shopify reçoit son propre jeton ; le jeu garde celui du relais, lié à la boutique');
      assert.ok(sh2.acces !== sh.acces && sh2.rafraichissement !== sh.rafraichissement && sh2.rafraichissementExpire, 'rotation');
      // le relais ne révoque pas chez Shopify (le jeu désinstalle l'application lui-même) mais cesse de renouveler
      assert.equal(await relais.revoquer(sh2, true), false);
      await assert.rejects(() => relais.rafraichir(sh2), expiree);
    } else {
      // relais d'avant : jeton sans fin, rien à renouveler — le jeu à jour s'en accommode
      assert.deepEqual([sh.expire, sh.rafraichissementExpire], [null, undefined]);
      await assert.rejects(() => relais.rafraichir(sh), expiree);
    }

    // HubSpot : API datée, compte connecté nommé, révocation par le relais (un relais d'avant laisse le jeu s'en charger)
    const hs = await connecter('hubspot');
    assert.equal((await relais.rafraichir(hs)).rafraichissement, RENOUVELLEMENT_HUBSPOT);
    assert.equal(await relais.revoquer(hs, true), aJour);
    if (aJour) {
      assert.equal(compteConnecte(hs), 'societe-essai.example');
      assert.ok(!JSON.stringify(hs).includes('personne@exemple.test'), 'l’adresse e-mail lue chez HubSpot ne quitte pas le relais');
      assert.deepEqual([dernier().url.replace(/\d{4}-\d{2}/, 'AAAA-MM'), dernier().corps.token, dernier().corps.client_secret], ['https://api.hubapi.com/oauth/AAAA-MM/token/revoke', RENOUVELLEMENT_HUBSPOT, APPLICATION.secret]);
      assert.ok(outils2026.appels.every((a) => !a.url.includes('/oauth/v1/')), 'plus aucune adresse v1 de HubSpot');
      await assert.rejects(() => relais.rafraichir(hs), expiree);
    }

    // Notion (connexion récente) : renouvelée avec rotation ; révoquée avec le jeton d'accès, que le relais soit à jour ou non
    const no = await connecter('notion');
    assert.equal(compteConnecte(no), 'Société Essai');
    assert.ok(no.rafraichissement && no.expire === null, 'jeton de renouvellement, sans date de fin annoncée');
    const no2 = await relais.rafraichir(no);
    assert.ok(no2.acces !== no.acces && no2.rafraichissement !== no.rafraichissement, 'rotation');
    assert.equal(await relais.revoquer(no2, true), true);
    assert.equal(outils2026.revoques.at(-1), no2.acces, 'Notion révoque par le jeton d’ACCÈS');
    await assert.rejects(() => relais.rafraichir(no2), expiree);
  } finally {
    serveur2.close();
  }
});

/**
 * Airtable simulé : côté relais, l'échange du code de connexion ; côté jeu, son API (webhook, charges, enregistrements).
 * Et, comme Airtable, il envoie ses « ping » signés à l'adresse du réseau quand une table change.
 */
const airtableEssai = { mac: Buffer.from(`mac-${randomUUID()}`).toString('base64'), adresse: '', enregistrements: [{ id: 'recAAAAAAAAAAAAAA', fields: { Nom: 'Scierie du Trégor' } }], charges: 0, lectures: 0, webhooks: [] as unknown[] };
const airtableRelais = async (u: string | URL): Promise<Response> => (String(u) === 'https://airtable.com/oauth2/v1/token'
  ? Response.json({ access_token: 'at-acces-essai', refresh_token: 'at-renouvellement-essai', expires_in: 3600, refresh_expires_in: 5_184_000, token_type: 'Bearer', scope: 'data.records:read schema.bases:read webhook:manage' })
  : Response.json({ error: 'inconnu' }, { status: 404 }));
const airtableApi = async (u: URL, init?: RequestInit): Promise<Response> => {
  const corps = init?.body ? JSON.parse(String(init.body)) : null;
  if (u.pathname === '/v0/bases/appAAAAAAAAAAAAAA/webhooks' && init?.method === 'POST') {
    airtableEssai.webhooks.push(corps);
    airtableEssai.adresse = corps.notificationUrl;
    return Response.json({ id: 'achWWWWWWWWWWWWWW', macSecretBase64: airtableEssai.mac, expirationTime: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  }
  if (u.pathname === '/v0/bases/appAAAAAAAAAAAAAA/webhooks/achWWWWWWWWWWWWWW/payloads') {
    const n = airtableEssai.charges;
    airtableEssai.charges = 0;
    return Response.json({ payloads: Array.from({ length: n }, (_, i) => ({ baseTransactionNumber: i + 1 })), cursor: 1 + n, mightHaveMore: false });
  }
  if (u.pathname === '/v0/appAAAAAAAAAAAAAA/tblTTTTTTTTTTTTTT') { airtableEssai.lectures++; return Response.json({ records: airtableEssai.enregistrements }); }
  return Response.json({ error: 'inconnu' }, { status: 404 });
};

test('bout en bout : temps réel — un avis d’Airtable passe par le vrai réseau, le jeu relit l’outil en quelques secondes', { skip: sautTempsReel }, async (t) => {
  const [{ Reseau }, { creerServeurNexus }, { RelaisOAuth: RelaisReseau }, { Coffre }, { RelaisTempsReel }] = await Promise.all(['reseau.ts', 'http.ts', 'oauth.ts', 'coffre.ts', 'relais.ts'].map((f) => voisin(`src/serveur/${f}`)));
  // port choisi d'abord : l'adresse publique du réseau d'essai est celle où il écoute (le jeu n'accepte une adresse
  // d'avis que sur l'origine de Breizhcosystem qu'il connaît)
  const libre = createServer();
  await new Promise<void>((ok) => libre.listen(0, '127.0.0.1', ok));
  const port = (libre.address() as AddressInfo).port;
  await new Promise<void>((ok) => libre.close(() => ok()));
  const url3 = `http://127.0.0.1:${port}`;
  const coffre = new Coffre();
  const oauth = new RelaisReseau({ coffre, origine: url3, applications: { airtable: APPLICATION }, fetch: airtableRelais, base });
  const tempsReel = new RelaisTempsReel({ base, coffre, origine: url3, comptes: oauth });
  const serveur3 = creerServeurNexus(new Reseau({ base, origine: url3, fetch: annuaire }), { facteurEssais: 100, oauth, tempsReel }) as Server;
  await new Promise<void>((ok) => serveur3.listen(port, '127.0.0.1', ok));
  // le Living Business de l'entreprise : Airtable simulé, et le VRAI réseau par les sorties protégées
  const app = await Application.creer({ exemple: 'pme', fetch: (async (u: string | URL, init?: RequestInit) => {
    const x = new URL(String(u));
    return x.host === 'api.airtable.com' ? airtableApi(x, init) : recuperateurProtege(u, init);
  }) as typeof fetch });
  try {
    const p = app.monde.profil('dirigeante');
    assert.ok(p);
    app.monde.viderDemo(p, 's', { nom: 'Test' });
    // 1. liaison en un clic avec le réseau (l'administratrice confirme sur le site)
    const e = await membre('SCIERIE DU TRÉGOR');
    await app.nexus.reglerAdresse(url3);
    const d = await app.nexus.demarrerLiaison();
    assert.equal((await e.appel('POST', '/v0/liaison/confirmer', { code: d.code })).statut, 200);
    assert.equal((await app.nexus.suivreLiaison()).statut, 'reliee');

    // 2. « Se connecter avec Airtable » par le vrai relais (consentement, code recopié), puis branchement
    const o = await app.synchro.demarrerOAuth(p, { source: 'airtable', config: {} });
    const etat = new URL(o.url).searchParams.get('state') ?? '';
    const page = await (await fetch(`${url3}/oauth/retour?code=code-essai&state=${encodeURIComponent(etat)}`)).text();
    const champ = (nom: string) => new RegExp(`name="${nom}" value="([^"]+)"`).exec(page)?.[1] ?? '';
    const fin = await fetch(`${url3}/oauth/retour`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: url3, 'sec-fetch-site': 'same-origin' }, body: new URLSearchParams({ etat: champ('etat'), jeton: champ('jeton'), decision: 'accepter', code: String(o.verification) }).toString() });
    assert.equal(fin.status, 200);
    const s = await app.synchro.suivreOAuth(p, o.id) as { statut: string; jeton: string };
    assert.equal(s.statut, 'connecte', JSON.stringify(s));
    const c = app.synchro.creer(p, { source: 'airtable', config: { base: 'appAAAAAAAAAAAAAA', table: 'tblTTTTTTTTTTTTTT', jeton: s.jeton }, typeObjet: 'entreprise', roles: [], mapping: { Nom: '__nom' }, sens: 'lecture', intervalleS: 300, actif: true });
    await app.synchro.synchroniser(c.id);
    assert.equal(airtableEssai.lectures, 1);

    // 3. abonnement : demandé au réseau, webhook créé chez Airtable avec le jeton de l'entreprise, secret MAC remis au réseau
    await app.synchro.entretenirTempsReel();
    assert.match(airtableEssai.adresse, new RegExp(`^${url3}/v0/relais/evenements/airtable/[A-Za-z0-9_-]{43}$`));
    const ligne = (await sql<{ actif: boolean; externe: string; connecteur: string }>('SELECT actif, externe, connecteur FROM relais_abonnements WHERE connecteur = $1', [c.id]))[0];
    assert.deepEqual(ligne, { actif: true, externe: 'achWWWWWWWWWWWWWW', connecteur: c.id });

    // 4. canal ouvert par le jeu : le branchement passe « En temps réel »
    app.tempsReel.demarrer();
    for (let i = 0; i < 200 && !app.tempsReel.enLigne; i++) await new Promise((ok) => setTimeout(ok, 25));
    assert.equal(app.tempsReel.enLigne, true, 'canal ouvert');
    assert.equal(app.synchro.lister(p).find((x) => x.id === c.id)?.frequence, 'En temps réel');

    // 5. une table change chez Airtable : Airtable prévient le réseau (ping signé), le jeu relit l'outil lui-même
    airtableEssai.enregistrements.push({ id: 'recBBBBBBBBBBBBBB', fields: { Nom: 'Charpentes de l’Aulne' } });
    airtableEssai.charges = 1;
    const ping = JSON.stringify({ base: { id: 'appAAAAAAAAAAAAAA' }, webhook: { id: 'achWWWWWWWWWWWWWW' }, timestamp: new Date().toISOString() });
    const debut = Date.now();
    const r = await fetch(airtableEssai.adresse, { method: 'POST', headers: { 'content-type': 'application/json', 'x-airtable-content-mac': `hmac-sha256=${createHmac('sha256', Buffer.from(airtableEssai.mac, 'base64')).update(ping).digest('hex')}` }, body: ping });
    assert.equal(r.status, 204);
    const relu = () => app.monde.objetsReels().some((x) => x.nom === 'Charpentes de l’Aulne');
    for (let i = 0; i < 400 && !relu(); i++) await new Promise((ok) => setTimeout(ok, 25));
    const delai = Date.now() - debut;
    assert.equal(relu(), true, 'la nouvelle fiche est arrivée');
    assert.ok(delai < 6000, `relu en ${delai} ms`);
    assert.equal(airtableEssai.lectures, 2, 'une relecture, regroupée');
    // un ping faux (signé avec un autre secret) n'arrive jamais au jeu
    const faux = await fetch(airtableEssai.adresse, { method: 'POST', headers: { 'content-type': 'application/json', 'x-airtable-content-mac': `hmac-sha256=${createHmac('sha256', 'autre').update(ping).digest('hex')}` }, body: ping });
    assert.equal(faux.status, 401);
    t.diagnostic(`ping Airtable reçu par le réseau → fiche dans le jeu en ${delai} ms (dont 2 s de regroupement)`);
  } finally {
    app.tempsReel.arreter();
    tempsReel.fermer();
    serveur3.closeAllConnections();
    serveur3.close();
  }
});
