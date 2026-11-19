/**
 * Les indemnités kilométriques. Ce qui compte : les quinze valeurs du barème officiel sont celles de la table, les
 * tranches basculent au bon kilomètre, l'électrique est majoré, et rien n'est rendu quand rien n'est renseigné.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANNEE_BAREME, BAREME, indemniteKilometrique, ligneBareme, MAJORATION_ELECTRIQUE, PUISSANCES } from './kilometres.ts';

/* Le français met une espace FINE insécable entre les milliers (U+202F). On la ramène à une espace ordinaire pour
   comparer : on vérifie le chiffre, pas la typographie du navigateur. */
const esp = (t: string) => t.replace(/[\u202f\u00a0]/g, ' ');

test('l’exemple de l’administration tombe juste', () => {
  // economie.gouv.fr : « 4 000 km x 0,665 = 2 660 € » pour un véhicule thermique de 6 CV
  const r = indemniteKilometrique(4000, 6);
  assert.equal(r?.montant, 2660);
  assert.equal(esp(r?.formule ?? ''), '4 000 km × 0,665');
  assert.equal(r?.annee, ANNEE_BAREME);
  assert.equal(r?.electrique, false);
});

test('les quinze valeurs du barème voitures sont celles qui sont publiées', () => {
  /* Recopiées une à une depuis la table officielle. Si l'administration les change, c'est ici que ça casse — et
     c'est exactement l'endroit où l'on veut que ça casse. */
  const attendu: Record<number, [number, number, number, number]> = {
    3: [0.529, 0.316, 1065, 0.370],
    4: [0.606, 0.340, 1330, 0.407],
    5: [0.636, 0.357, 1395, 0.427],
    6: [0.665, 0.374, 1457, 0.447],
    7: [0.697, 0.394, 1515, 0.470],
  };
  assert.deepEqual([...PUISSANCES], [3, 4, 5, 6, 7]);
  for (const cv of PUISSANCES) {
    const [a, b, fixe, c] = attendu[cv] as [number, number, number, number];
    const l = BAREME[cv] as ReadonlyArray<{ jusqua: number; parKm: number; fixe: number }>;
    assert.deepEqual(l.map((x) => x.jusqua), [5000, 20_000, Infinity], `${cv} CV : les tranches`);
    assert.deepEqual(l.map((x) => x.parKm), [a, b, c], `${cv} CV : les coefficients`);
    assert.deepEqual(l.map((x) => x.fixe), [0, fixe, 0], `${cv} CV : la part fixe`);
  }
});

test('la tranche bascule au bon kilomètre, et la part fixe entre avec elle', () => {
  assert.equal(indemniteKilometrique(5000, 5)?.montant, Math.round(5000 * 0.636));
  const juste = indemniteKilometrique(5001, 5);
  assert.equal(juste?.montant, Math.round(5001 * 0.357 + 1395));
  assert.match(esp(juste?.formule ?? ''), /\(5 001 km × 0,357\) \+ 1 395/);
  assert.equal(indemniteKilometrique(20_000, 5)?.montant, Math.round(20_000 * 0.357 + 1395));
  assert.equal(indemniteKilometrique(20_001, 5)?.montant, Math.round(20_001 * 0.427));
  /* Les tranches se RACCORDENT : un kilomètre de plus ne fait jamais baisser l'indemnité. C'est voulu par
     l'administration (la part fixe compense exactement le coefficient plus bas), et c'est la propriété qu'on veut
     voir casser si un chiffre de la table est mal recopié — un barème avec une marche se repère tout de suite. */
  for (const cv of [3, 4, 5, 6, 7]) {
    for (const borne of [5000, 20_000]) {
      const avant = indemniteKilometrique(borne, cv)?.montant ?? 0;
      const apres = indemniteKilometrique(borne + 1, cv)?.montant ?? 0;
      assert.ok(apres >= avant, `${cv} CV à ${borne} km : ${apres} € après, ${avant} € avant`);
      // le raccord n'est pas parfaitement lisse (3 CV saute de 15 € à 20 000 km) mais il reste sous le pour cent :
      // une table mal recopiée, elle, produit une marche d'un tout autre ordre
      assert.ok((apres - avant) / avant < 0.01, `${cv} CV à ${borne} km : saut de ${apres - avant} € sur ${avant} €`);
    }
  }
});

test('une puissance hors barème est ramenée dedans, jamais refusée', () => {
  assert.equal(ligneBareme(1), BAREME[3]);
  assert.equal(ligneBareme(12), BAREME[7]);
  assert.equal(indemniteKilometrique(1000, 15)?.cv, 7, 'au-delà de 7 CV, c’est la ligne « 7 CV et plus »');
  assert.equal(indemniteKilometrique(1000, 2)?.cv, 3);
  assert.equal(indemniteKilometrique(1000, 4.4)?.cv, 4, 'une puissance décimale est arrondie');
});

test('électrique : le barème est majoré de 20 %, et la majoration est dite', () => {
  const t = indemniteKilometrique(10_000, 4);
  const e = indemniteKilometrique(10_000, 4, true);
  assert.equal(MAJORATION_ELECTRIQUE, 1.2);
  assert.equal(e?.montant, Math.round((10_000 * 0.340 + 1330) * 1.2));
  assert.ok((e?.montant ?? 0) > (t?.montant ?? 0));
  assert.match(e?.formule ?? '', /majoré de 20 % \(électrique\)/);
});

test('sans kilomètres ni puissance, on ne rend pas zéro euro', () => {
  /* Zéro se lirait comme une réponse (« vous n'avez droit à rien »). L'absence se lit comme ce qu'elle est :
     il manque la puissance fiscale, qui est sur la carte grise. */
  for (const [km, cv] of [[0, 5], [null, 5], ['beaucoup', 5], [1000, 0], [1000, null], [-500, 5]] as const) {
    assert.equal(indemniteKilometrique(km, cv), null, `${String(km)} / ${String(cv)}`);
  }
});

test('l’univers des prestataires de service déclare bien de quoi calculer', async () => {
  /* Le calcul ne sert à rien si les trois champs n'existent pas dans l'univers : la puissance fiscale est sur la
     carte grise, l'énergie décide de la majoration, et les kilomètres professionnels sont la seule chose que la
     personne a à tenir. Sans eux, l'écran reste muet — ce qui est le comportement voulu, mais pas celui qu'on veut
     ici. */
  const { chargerUnivers } = await import('../config/univers.ts');
  const u = await chargerUnivers('services');
  const champs = u.types.find((t) => t.id === 'vehicule')?.champs.map((c) => c.id) ?? [];
  for (const id of ['puissance_cv', 'energie', 'km_professionnels']) assert.ok(champs.includes(id), id);
  const energie = u.types.find((t) => t.id === 'vehicule')?.champs.find((c) => c.id === 'energie');
  assert.ok(energie?.choix?.includes('électrique'), 'c’est « électrique » qui déclenche la majoration de 20 %');
  // et le générique ne les porte PAS : on n'impose pas trois champs de plus à tous les métiers
  const g = await chargerUnivers('generique');
  const gc = g.types.find((t) => t.id === 'vehicule')?.champs.map((c) => c.id) ?? [];
  assert.ok(!gc.includes('km_professionnels'));
});
