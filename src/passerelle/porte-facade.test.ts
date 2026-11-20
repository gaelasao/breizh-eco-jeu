/**
 * LA PORTE DE LA FAÇADE. Ce qui se vérifie ici, dans l'ordre de ce que ça coûterait : un jeton émis pour une AUTRE
 * entreprise n'ouvre rien, un jeton fabriqué ailleurs non plus, un lien retrouvé dans un historique est périmé, et
 * le même lien ne sert pas deux fois. Et, tout aussi important : sans réglage, la porte n'existe pas.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  cleFacade, DUREE_MAX_S, JetonsServis, PREFIXE, porteOuverte, reglagePorte, verifierPorte, type ChargePorte,
} from './porte-facade.ts';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const { privateKey: autreCle } = generateKeyPairSync('ed25519');
const CLE = publicKey.export({ format: 'pem', type: 'spki' }).toString();
const MAINTENANT = new Date('2026-11-20T09:00:00Z');
const seconde = (d: Date) => Math.floor(d.getTime() / 1000);

const charge = (x: Partial<ChargePorte> = {}): ChargePorte => ({
  entreprise: 'ent-kerlann', personne: 'p-gael', nom: 'Gaël', role: 'administrateur',
  expire: seconde(MAINTENANT) + 60, jeton: 'jt-0001', ...x,
});
/** Fabrique un jeton comme la façade le fera : charge en base64url, signature sur « bz1.<charge> ». */
const fabriquer = (c: ChargePorte = charge(), cle = privateKey): string => {
  const b = Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
  return `${PREFIXE}.${b}.${sign(null, Buffer.from(`${PREFIXE}.${b}`, 'utf8'), cle).toString('base64url')}`;
};
const reglage = { clePublique: CLE, entreprise: 'ent-kerlann' };
const verifier = (jeton: unknown, o: Partial<Parameters<typeof verifierPorte>[1]> = {}) =>
  verifierPorte(jeton, { reglage, maintenant: MAINTENANT, ...o });

test('un jeton de la façade ouvre, et rend qui entre', () => {
  const r = verifier(fabriquer());
  assert.equal(r.ok, true);
  assert.equal(r.refus, null);
  assert.equal(r.charge?.personne, 'p-gael');
  assert.equal(r.charge?.nom, 'Gaël');
  assert.equal(r.charge?.role, 'administrateur');
});

test('LE REFUS QUI COMPTE : un jeton émis pour une autre entreprise n’ouvre rien', () => {
  /* C'est le seul défaut qui mettrait les données d'un client sous les yeux d'un autre, et il ne se rattrape pas.
     Le jeton est authentique, frais, signé par la bonne façade — et il est refusé quand même. */
  const r = verifier(fabriquer(charge({ entreprise: 'ent-voisine' })));
  assert.equal(r.ok, false);
  assert.equal(r.refus, 'entreprise');
  assert.equal(r.charge, null, 'rien n’est rendu, pas même le nom de la personne');
});

test('un jeton signé ailleurs, ou bricolé, est refusé', () => {
  assert.equal(verifier(fabriquer(charge(), autreCle)).refus, 'signature');
  // la charge modifiée après coup : la signature ne tient plus
  const bon = fabriquer();
  const [, b, s] = bon.split('.');
  const truque = Buffer.from(JSON.stringify(charge({ role: 'administrateur', personne: 'p-intrus' })), 'utf8').toString('base64url');
  assert.equal(verifier(`${PREFIXE}.${truque}.${s}`).refus, 'signature');
  // le préfixe est signé lui aussi : on ne relit pas un jeton d'une autre version comme celui-ci
  assert.equal(verifier(`bz2.${b}.${s}`).refus, 'forme');
});

test('le temps : un lien retrouvé dans un historique est mort, et la façade ne signe pas l’éternité', () => {
  assert.equal(verifier(fabriquer(charge({ expire: seconde(MAINTENANT) - 120 }))).refus, 'expire');
  // la dérive d'horloge entre deux machines est tolérée : elles ne sont jamais à la seconde près
  assert.equal(verifier(fabriquer(charge({ expire: seconde(MAINTENANT) - 10 }))).ok, true);
  // au-delà du plafond, refusé même authentique : une façade abusée ne peut pas ouvrir pour un an
  assert.equal(verifier(fabriquer(charge({ expire: seconde(MAINTENANT) + DUREE_MAX_S + 600 }))).refus, 'expire');
});

test('usage unique : le même lien ne sert pas deux fois', () => {
  const servis = new JetonsServis();
  const dejaVu = (j: string, e: number) => servis.servi(j, e, MAINTENANT);
  const jeton = fabriquer();
  assert.equal(verifier(jeton, { dejaVu }).ok, true);
  assert.equal(verifier(jeton, { dejaVu }).refus, 'rejoue');
  // un autre jeton passe toujours
  assert.equal(verifier(fabriquer(charge({ jeton: 'jt-0002' })), { dejaVu }).ok, true);
});

test('le registre ne retient pas un jeton inventé : la signature est vérifiée AVANT', () => {
  /* Sinon n'importe qui le remplirait de jetons fabriqués, et finirait par faire refuser les vrais. */
  const servis = new JetonsServis(2);
  const dejaVu = (j: string, e: number) => servis.servi(j, e, MAINTENANT);
  for (let i = 0; i < 20; i++) verifier(fabriquer(charge({ jeton: `faux-${i}` }), autreCle), { dejaVu });
  assert.equal(verifier(fabriquer(), { dejaVu }).ok, true, 'un vrai jeton passe encore');
});

test('les jetons périmés laissent la place, mais un registre plein refuse plutôt que d’oublier', () => {
  const servis = new JetonsServis(2);
  assert.equal(servis.servi('a', seconde(MAINTENANT) + 60, MAINTENANT), false);
  assert.equal(servis.servi('b', seconde(MAINTENANT) + 60, MAINTENANT), false);
  assert.equal(servis.servi('c', seconde(MAINTENANT) + 60, MAINTENANT), true, 'plein : on refuse, on n’oublie pas');
  // plus tard, les deux premiers ont expiré : la place se libère d'elle-même
  const plusTard = new Date(MAINTENANT.getTime() + 120_000);
  assert.equal(servis.servi('c', seconde(plusTard) + 60, plusTard), false);
});

test('sans réglage, la porte n’existe pas : une installation auto-hébergée ne dépend de personne', () => {
  /* C'est la promesse du produit : « l'entreprise gère seule ses accès, sans éditeur ni service extérieur ».
     La porte est un MODE, allumé par l'éditeur sur ses propres instances, et nulle part ailleurs. */
  assert.equal(porteOuverte({ clePublique: null, entreprise: 'ent-kerlann' }), false);
  assert.equal(porteOuverte({ clePublique: CLE, entreprise: null }), false);
  assert.equal(porteOuverte({ clePublique: '  ', entreprise: '  ' }), false);
  assert.equal(porteOuverte(reglage), true);
  for (const r of [{ clePublique: null, entreprise: null }, { clePublique: CLE, entreprise: null }]) {
    assert.equal(verifierPorte(fabriquer(), { reglage: r, maintenant: MAINTENANT }).refus, 'desactivee');
  }
  assert.deepEqual(reglagePorte({} as NodeJS.ProcessEnv), { clePublique: null, entreprise: null });
  assert.deepEqual(reglagePorte({ LB_FACADE_CLE: ' k ', LB_FACADE_ENTREPRISE: ' e ' } as NodeJS.ProcessEnv), { clePublique: 'k', entreprise: 'e' });
});

test('une clé qui n’est pas Ed25519 ne sert pas par accident', () => {
  const { publicKey: rsa } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  assert.equal(cleFacade(rsa.export({ format: 'pem', type: 'spki' }).toString()), null);
  assert.equal(cleFacade('pas une clé'), null);
  assert.equal(cleFacade(null), null);
  // la forme brute (32 octets en base64url) est acceptée : c'est ce qu'une façade donne le plus simplement
  const brute = publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
  assert.ok(cleFacade(brute), 'une clé brute de 32 octets est lue');
  assert.equal(verifierPorte(fabriquer(), { reglage: { clePublique: brute, entreprise: 'ent-kerlann' }, maintenant: MAINTENANT }).ok, true);
});

test('des formes abîmées sont refusées sans être lues', () => {
  for (const faux of ['', 'bz1', 'bz1.a', 'bz1..', 'bz1.@@@.@@@', `${PREFIXE}.${'a'.repeat(5000)}.x`, null, 42, {}]) {
    const r = verifier(faux);
    assert.equal(r.ok, false, String(faux).slice(0, 20));
    assert.equal(r.charge, null);
  }
  // une charge incomplète (sans rôle) ne passe pas, même bien signée
  const sansRole = Buffer.from(JSON.stringify({ entreprise: 'ent-kerlann', personne: 'p', jeton: 'j', expire: seconde(MAINTENANT) + 60 }), 'utf8').toString('base64url');
  assert.equal(verifier(`${PREFIXE}.${sansRole}.${sign(null, Buffer.from(`${PREFIXE}.${sansRole}`, 'utf8'), privateKey).toString('base64url')}`).refus, 'forme');
});
