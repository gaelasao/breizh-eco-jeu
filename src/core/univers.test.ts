import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerUnivers } from '../config/univers.ts';
import type { ObjetMetier } from './model.ts';
import { situationsPour } from './situation.ts';
import {
  ErreurUnivers,
  libelleRole,
  libelleType,
  personnaliser,
  roleReseau,
  tiersParRole,
  typesVisibles,
  validerObjet,
  validerUnivers,
} from './univers.ts';

const generique = await chargerUnivers('generique');
const btp = await chargerUnivers('btp');
const commerce = await chargerUnivers('commerce');

const objet = (o: Partial<ObjetMetier> & Pick<ObjetMetier, 'id' | 'famille' | 'type'>): ObjetMetier => ({
  orgId: 'org-a',
  roles: [],
  nom: o.id,
  champs: {},
  provenance: 'confirme',
  source: { id: 'demo', libelle: 'Démo', derniereSynchro: null },
  majLe: '2026-11-09T09:58:00Z',
  disponibilite: 'disponible',
  mode: 'demo',
  ...o,
});

test('univers générique : clients, fournisseurs, partenaires… sans secteur', () => {
  assert.equal(libelleRole(generique, 'client', 2), 'Clients');
  assert.equal(libelleRole(generique, 'fournisseur', 2), 'Fournisseurs');
  assert.equal(libelleType(generique, 'projet'), 'Projet');
  assert.equal(libelleType(generique, 'commande_fournisseur', 2), 'Commandes fournisseurs');
});

test('personnalisation par JSON : BTP et commerce sans toucher au code', () => {
  assert.equal(libelleType(btp, 'projet', 2), 'Chantiers');
  assert.equal(libelleType(btp, 'entrepot'), 'Dépôt');
  assert.equal(libelleRole(btp, 'maitre_ouvrage'), "Maître d'ouvrage");
  assert.ok(btp.types.find((t) => t.id === 'projet')?.champs.some((c) => c.id === 'lot'));
  assert.ok(btp.types.find((t) => t.id === 'projet')?.champs.some((c) => c.id === 'client'), 'champs de base conservés');

  assert.equal(libelleType(commerce, 'site'), 'Magasin');
  assert.ok(!typesVisibles(commerce, 'projet').length, 'projet masqué');
  assert.ok(commerce.types.some((t) => t.id === 'projet'), 'masqué ≠ supprimé');
});

test('données d’un univers restent valides après personnalisation', () => {
  const chantier = objet({ id: 'p1', famille: 'projet', type: 'projet', champs: { montant: 12000, retard_jours: 2 } });
  assert.deepEqual(validerObjet(generique, chantier), []);
  assert.deepEqual(validerObjet(btp, chantier), []);
  assert.deepEqual(validerObjet(commerce, chantier), []);
});

test('rôles personnalisés traduits vers le vocabulaire réseau commun', () => {
  assert.equal(roleReseau(btp, 'maitre_ouvrage'), 'client');
  assert.equal(roleReseau(generique, 'fournisseur'), 'fournisseur');
  assert.equal(roleReseau(generique, 'prospect'), 'autre');
});

test('un tiers peut être client ET fournisseur', () => {
  const tiers = [
    objet({ id: 't1', famille: 'tiers', type: 'entreprise', roles: ['client', 'fournisseur'] }),
    objet({ id: 't2', famille: 'tiers', type: 'entreprise', roles: ['fournisseur'] }),
    objet({ id: 't3', famille: 'tiers', type: 'particulier', roles: ['client'] }),
  ];
  for (const t of tiers) assert.deepEqual(validerObjet(generique, t), []);
  assert.deepEqual(tiersParRole(tiers, 'client').map((t) => t.id), ['t1', 't3']);
  assert.deepEqual(tiersParRole(tiers, 'fournisseur').map((t) => t.id), ['t1', 't2']);
});

test('validation des objets : rôle, champ, type, obligatoire', () => {
  const p = validerObjet(
    generique,
    objet({ id: 'a1', famille: 'ressource', type: 'article', roles: ['client'], champs: { couleur: 'rouge', seuil_alerte: 'dix' } }),
  );
  assert.ok(p.some((x) => x.includes('seuls les tiers')));
  assert.ok(p.some((x) => x.includes('« couleur » non déclaré')));
  assert.ok(p.some((x) => x.includes('seuil_alerte')));
  assert.ok(p.some((x) => x.includes('« quantite » obligatoire')));
  assert.deepEqual(validerObjet(generique, objet({ id: 'x', famille: 'tiers', type: 'inconnu' })).length, 1);
});

test('règles déclarées dans l’univers → situations (stock, retard, encours client)', () => {
  const ctx = { maintenant: new Date('2026-11-09T10:00:00Z'), ageMaxMs: 15 * 60_000 };
  const article = objet({ id: 'a1', famille: 'ressource', type: 'article', champs: { quantite: 3, seuil_alerte: 10 } });
  const facture = objet({ id: 'f1', famille: 'commande', type: 'facture', champs: { retard_jours: 40 } });
  const client = objet({ id: 'c1', famille: 'tiers', type: 'entreprise', roles: ['client'], champs: { encours: 9000, limite_encours: 5000 } });

  assert.equal(situationsPour(generique, article, null, ctx)[0]?.regle, 'stock_minimum');
  assert.equal(situationsPour(generique, facture, null, ctx)[0]?.gravite, 'critique');
  assert.equal(situationsPour(generique, client, null, ctx)[0]?.description, 'Encours : 9\u202F000\u00A0€ (maximum 5\u202F000\u00A0€)', 'milliers à l’espace fine (§8.3)');
  // la règle d'encours ne vise que les clients : un fournisseur sans encours n'est pas « donnée manquante »
  const fournisseur = objet({ id: 'f1', famille: 'tiers', type: 'entreprise', roles: ['fournisseur'] });
  assert.deepEqual(situationsPour(generique, fournisseur, null, ctx), []);
  // un client qui ne suit pas l'encours n'est pas signalé ; un client qui le suit sans valeur l'est
  assert.deepEqual(situationsPour(generique, objet({ id: 'c2', famille: 'tiers', type: 'entreprise', roles: ['client'] }), null, ctx), []);
  const suivi = objet({ id: 'c3', famille: 'tiers', type: 'entreprise', roles: ['client'], champs: { limite_encours: 5000 } });
  assert.equal(situationsPour(generique, suivi, null, ctx)[0]?.statut, 'a_verifier');

  // BTP a redéfini la règle de retard : libellé et seuil critique propres.
  const chantier = objet({ id: 'p1', famille: 'projet', type: 'projet', champs: { retard_jours: 12 } });
  const s = situationsPour(btp, chantier, null, ctx)[0];
  assert.equal(s?.gravite, 'critique');
  assert.match(s?.description ?? '', /Retard du chantier/);
});

test('surcharge interdite : changer une famille ou le type d’un champ', () => {
  assert.throws(
    () => personnaliser(generique, { id: 'x', nom: 'X', version: 1, herite: 'generique', types: [{ id: 'projet', famille: 'tiers' }] }),
    ErreurUnivers,
  );
  assert.throws(
    () =>
      personnaliser(generique, {
        id: 'x', nom: 'X', version: 1, herite: 'generique',
        types: [{ id: 'article', champs: [{ id: 'quantite', type: 'texte' }] }],
      }),
    ErreurUnivers,
  );
  assert.throws(() => personnaliser(generique, { id: 'x', nom: 'X', version: 1, herite: 'btp' }), ErreurUnivers);
});

test('univers invalide : toutes les erreurs listées, rien d’exécutable', () => {
  try {
    validerUnivers({
      id: 'Mauvais Id', nom: '', version: 0, roles: [{ id: 'client', libelle: 'C', pluriel: 'C' }, { id: 'client', libelle: 'C', pluriel: 'C' }],
      types: [{ id: 't', famille: 'secret', libelle: 'T', pluriel: 'T', champs: [{ id: 'c', libelle: 'C', type: 'script' }] }],
      regles: [{ id: 'r', libelle: 'R', type: 'absent', champ: 'c', sens: 'min', seuil: 1 }],
    });
    assert.fail('aurait dû échouer');
  } catch (e) {
    assert.ok(e instanceof ErreurUnivers);
    assert.ok(e.problemes.length >= 6, e.problemes.join('\n'));
  }
});

test('chargement : identifiant d’univers non sûr refusé', async () => {
  await assert.rejects(chargerUnivers('../../etc/passwd'), ErreurUnivers);
  await assert.rejects(chargerUnivers('GENERIQUE'), ErreurUnivers);
});
