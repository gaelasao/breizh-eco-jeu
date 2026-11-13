/**
 * Tâches répétitives déclarées : « est-ce que ça vaut le coup de l'automatiser ? » Calcul en temps de travail
 * (228 jours, 45,6 semaines, 11 mois par an), délai de rentabilité en semaines du calendrier (52,18 par an), verdict
 * toujours accompagné de sa raison et du calcul de chaque chiffre, contrôle des saisies, idées de départ universelles.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculerTache, CAS_PARTICULIERS, delai, duree, ErreurTache, GRAVITES, HORIZON_DEFAUT, IDEES, lireHorizon, lireSaisie, MEME_FACON, NOM_MAX, PERIODES, QUI_MAX,
  RANG_VERDICT, TACHES_MAX, UNITES_AUTOMATISER, UNITES_TEMPS, VALEUR_MAX, type SaisieTache, type Verdict,
} from './taches-repetitives.ts';

/** Espaces insécables et fines ramenées à l'espace simple, pour comparer les phrases. */
const simple = (t: string) => t.replace(/[\u00A0\u202F]/g, ' ');
const tache = (o: Partial<SaisieTache> = {}): SaisieTache => ({
  nom: 'Relancer les factures', qui: 'Anna', personne: null, tempsGagne: 5, uniteTemps: 'minutes', fois: 3, periode: 'jour',
  tempsAutomatiser: 4, uniteAutomatiser: 'heures', memeFacon: 'oui', casParticuliers: 'rarement', graviteErreur: 'sans_gravite', recette: null, ...o,
});
const REGLAGES = { tauxHoraire: 35, horizonAns: 5 };
const calcul = (o: Partial<SaisieTache> = {}, r: Partial<typeof REGLAGES> = {}) => calculerTache(tache(o), { ...REGLAGES, ...r });
const proche = (a: number, b: number, quoi: string) => assert.ok(Math.abs(a - b) < 1e-3, `${quoi} : ${a} au lieu de ${b}`);

test('calcul : 5 min, 3 fois par jour → 57 h par an, regagné en 4 semaines, 1 995 € ; chaque chiffre dit son calcul', () => {
  const c = calcul();
  assert.equal(c.foisParAn, 684, '3 × 228 jours travaillés');
  assert.equal(c.heuresAn, 57);
  proche(c.heuresSemaine, 57 / 52.18, 'heures par semaine du calendrier');
  assert.equal(c.heuresAutomatiser, 4);
  proche(c.rentabiliteSemaines, 4 / (57 / 52.18), 'délai de rentabilité');
  assert.equal(c.euroAn, 1995);
  assert.equal(c.heuresHorizon, 281, '5 × 57 h − 4 h');
  assert.equal(c.euroHorizon, 9835);
  assert.equal(c.verdict, 'a_automatiser');
  assert.equal(c.libelle, 'À automatiser');
  assert.equal(simple(c.raison), 'Vous gagnez 57 h par an, et le temps passé à l’automatiser est regagné en 4 semaines.');
  assert.deepEqual([c.tempsAn, c.delai, c.tempsHorizon].map(simple), ['57 h', '4 semaines', '281 h']);
  assert.equal(simple(c.explications.temps), '5 min × 3 fois par jour × 228 jours travaillés par an = 57 h par an.');
  assert.equal(simple(c.explications.rentabilite), 'Temps pour l’automatiser : 4 h. Temps gagné par semaine : 1,1 h (57 h par an ÷ 52,18 semaines). 4 h ÷ 1,1 h = 4 semaines.');
  assert.equal(simple(c.explications.euros), '57 h × 35 € de l’heure (votre coût horaire) = 1 995 € par an.');
  assert.equal(simple(c.explications.horizon), 'Sur 5 ans : 5 × 57 h − 4 h pour l’automatiser = 281 h, soit 9 835 €.');
  assert.equal(c.risquee, false);
  assert.deepEqual(c.risques, []);
  assert.equal(c.aVerifier, null);
  assert.ok(c.explications.euros.includes('35\u00A0€') && c.explications.temps.includes('57\u00A0h'), 'unités insécables');
});

test('temps de travail : 228 jours, 45,6 semaines, 11 mois par an ; secondes, minutes et heures', () => {
  assert.equal(calcul({ tempsGagne: 30, uniteTemps: 'secondes', fois: 10, periode: 'jour' }).heuresAn, 19, '30 s × 10 × 228 ÷ 3 600');
  const semaine = calcul({ tempsGagne: 10, uniteTemps: 'minutes', fois: 3, periode: 'semaine' });
  assert.equal(semaine.foisParAn, 136.8, '3 × 45,6 semaines');
  assert.equal(semaine.heuresAn, 22.8);
  assert.equal(simple(semaine.explications.temps), '10 min × 3 fois par semaine × 45,6 semaines travaillées par an = 22,8 h par an.');
  const mois = calcul({ tempsGagne: 2, uniteTemps: 'heures', fois: 1, periode: 'mois' });
  assert.equal(mois.foisParAn, 11);
  assert.equal(mois.heuresAn, 22);
  assert.equal(simple(mois.explications.temps), '2 h × 1 fois par mois × 11 mois travaillés par an = 22 h par an.');
  const an = calcul({ tempsGagne: 90, uniteTemps: 'minutes', fois: 12, periode: 'an' });
  assert.equal(an.heuresAn, 18);
  assert.equal(simple(an.explications.temps), '90 min × 12 fois par an = 18 h par an.');
  assert.equal(calcul({ tempsGagne: 4, fois: 5, periode: 'semaine' }).heuresAn, 15.2, '45,6 × 5 = 228 fois, sans erreur d’arrondi');
});

test('temps pour automatiser : minutes, heures, jours de 7 h ; euros au coût horaire réglé', () => {
  assert.equal(calcul({ tempsAutomatiser: 30, uniteAutomatiser: 'minutes' }).heuresAutomatiser, 0.5);
  assert.equal(calcul({ tempsAutomatiser: 1.5, uniteAutomatiser: 'heures' }).heuresAutomatiser, 1.5);
  const jours = calcul({ tempsAutomatiser: 2, uniteAutomatiser: 'jours' });
  assert.equal(jours.heuresAutomatiser, 14);
  assert.match(simple(jours.explications.rentabilite), /^Temps pour l’automatiser : 2 jours de 7 h, soit 14 h\. /);
  assert.equal(calcul({}, { tauxHoraire: 50 }).euroAn, 2850);
  assert.match(simple(calcul({}, { tauxHoraire: 50 }).explications.euros), /× 50 € de l’heure/);
  // délai : heures pour automatiser ÷ heures gagnées par semaine du calendrier
  proche(jours.rentabiliteSemaines, (14 * 52.18) / 57, '14 h ÷ (57 h ÷ 52,18)');
});

test('verdict « gain trop faible » : moins d’1 h par an, même si l’automatiser ne coûte rien', () => {
  const c = calcul({ tempsGagne: 59, uniteTemps: 'minutes', fois: 1, periode: 'an', tempsAutomatiser: 1, uniteAutomatiser: 'minutes' });
  assert.equal(c.verdict, 'gain_trop_faible');
  assert.equal(c.libelle, 'Gain trop faible');
  assert.equal(simple(c.raison), 'Cette tâche ne vous prend que 59 min par an : l’automatiser ne changerait presque rien.');
  // 1 h tout rond n'est plus « trop faible »
  const juste = calcul({ tempsGagne: 60, uniteTemps: 'minutes', fois: 1, periode: 'an', tempsAutomatiser: 1, uniteAutomatiser: 'minutes' });
  assert.equal(juste.heuresAn, 1);
  assert.equal(juste.verdict, 'petit_gain');
  // le gain trop faible passe avant « pas rentable »
  assert.equal(calcul({ tempsGagne: 10, uniteTemps: 'secondes', fois: 1, periode: 'mois', tempsAutomatiser: 10, uniteAutomatiser: 'jours' }).verdict, 'gain_trop_faible');
});

test('verdict « pas rentable sur N ans » : le temps d’automatisation n’est regagné qu’après la durée comptée (1 à 5 ans)', () => {
  const o: Partial<SaisieTache> = { tempsGagne: 60, uniteTemps: 'minutes', fois: 2, periode: 'an', tempsAutomatiser: 2, uniteAutomatiser: 'jours' };
  const c = calcul(o);
  assert.equal(c.heuresAn, 2);
  assert.equal(c.verdict, 'pas_rentable');
  assert.equal(simple(c.libelle), 'Pas rentable sur 5 ans');
  assert.equal(simple(c.raison), 'Il faudrait environ 7 ans pour regagner le temps passé à l’automatiser (14 h) : c’est plus que les 5 ans sur lesquels vous comptez.');
  assert.equal(c.heuresHorizon, -4);
  assert.equal(simple(c.tempsHorizon), '−4 h');
  assert.equal(simple(c.explications.horizon), 'Sur 5 ans : 5 × 2 h − 14 h pour l’automatiser : il manquerait 4 h pour regagner ce temps.');
  // regagné pile à la fin de la durée comptée : pas « au-delà »
  const pile = calcul({ ...o, tempsAutomatiser: 10, uniteAutomatiser: 'heures' });
  assert.equal(pile.rentabiliteSemaines, 260.9, '5 × 52,18 semaines');
  assert.equal(pile.verdict, 'petit_gain');
  assert.equal(calcul({ ...o, tempsAutomatiser: 10.01, uniteAutomatiser: 'heures' }).verdict, 'pas_rentable');
  // la durée comptée se règle : 20 h par an, 21 h pour automatiser
  const vingt: Partial<SaisieTache> = { tempsGagne: 60, uniteTemps: 'minutes', fois: 20, periode: 'an', tempsAutomatiser: 3, uniteAutomatiser: 'jours' };
  const unAn = calcul(vingt, { horizonAns: 1 });
  assert.equal(unAn.verdict, 'pas_rentable');
  assert.equal(simple(unAn.libelle), 'Pas rentable sur 1 an');
  assert.match(simple(unAn.raison), /c’est plus que l’année sur laquelle vous comptez\.$/);
  assert.equal(simple(unAn.explications.horizon), 'Sur 1 an : 20 h − 21 h pour l’automatiser : il manquerait 1 h pour regagner ce temps.');
  const deuxAns = calcul(vingt, { horizonAns: 2 });
  assert.equal(deuxAns.verdict, 'petit_gain', 'regagné en 55 semaines : dans les 2 ans, mais au-delà de 52 semaines');
  assert.equal(simple(deuxAns.raison), 'Il faut environ 1,1 an pour regagner le temps passé à l’automatiser : rentable à la longue, mais pas prioritaire.');
  assert.equal(calcul(vingt, { horizonAns: 9 }).horizonAns, HORIZON_DEFAUT, 'durée hors de 1 à 5 ans : 5 ans');
});

test('verdict « à automatiser » : au moins 15 h par an ET regagné en 26 semaines au plus', () => {
  const quinze: Partial<SaisieTache> = { tempsGagne: 15, uniteTemps: 'minutes', fois: 60, periode: 'an' };
  const c = calcul({ ...quinze, tempsAutomatiser: 7, uniteAutomatiser: 'heures' });
  assert.equal(c.heuresAn, 15);
  assert.ok(c.rentabiliteSemaines < 26);
  assert.equal(c.verdict, 'a_automatiser');
  // 15 h tout rond quelle que soit l'unité : les erreurs d'arrondi ne font pas basculer le seuil
  for (const o of [{ tempsGagne: 0.1, uniteTemps: 'heures', fois: 150 }, { tempsGagne: 54, uniteTemps: 'secondes', fois: 1000 }, { tempsGagne: 6, uniteTemps: 'minutes', fois: 150 }] as const) {
    const x = calcul({ ...o, periode: 'an', tempsAutomatiser: 1, uniteAutomatiser: 'heures' });
    assert.equal(x.heuresAn, 15, JSON.stringify(o));
    assert.equal(x.verdict, 'a_automatiser', JSON.stringify(o));
  }
  // 28 semaines : plus « à automatiser », mais « à planifier »
  const lent = calcul({ ...quinze, tempsAutomatiser: 8, uniteAutomatiser: 'heures' });
  assert.ok(lent.rentabiliteSemaines > 26 && lent.rentabiliteSemaines <= 52);
  assert.equal(lent.verdict, 'a_planifier');
  assert.equal(simple(lent.raison), 'Vous gagnez 15 h par an, mais il faut environ 6 mois pour regagner le temps passé à l’automatiser : à planifier, sans urgence.');
  // 14,9 h par an : sous le seuil, même vite regagné
  const sous = calcul({ tempsGagne: 6, uniteTemps: 'minutes', fois: 149, periode: 'an', tempsAutomatiser: 1, uniteAutomatiser: 'heures' });
  assert.equal(sous.heuresAn, 14.9);
  assert.equal(sous.verdict, 'a_planifier');
  assert.equal(simple(sous.raison), 'Le gain reste modeste (14,9 h par an), et l’automatisation est regagnée en 4 semaines : à planifier, sans urgence.');
});

test('verdict « à automatiser, vous validez chaque envoi » : erreur grave, cas particuliers fréquents ou façon de faire qui change', () => {
  const cas: [Partial<SaisieTache>, string[]][] = [
    [{ graviteErreur: 'grave' }, ['une erreur serait grave']],
    [{ casParticuliers: 'souvent' }, ['les cas particuliers sont fréquents']],
    [{ memeFacon: 'variable' }, ['la façon de faire change souvent']],
    [{ graviteErreur: 'grave', casParticuliers: 'souvent', memeFacon: 'variable' }, ['une erreur serait grave', 'les cas particuliers sont fréquents', 'la façon de faire change souvent']],
  ];
  for (const [o, risques] of cas) {
    const c = calcul(o);
    assert.equal(c.verdict, 'a_automatiser_en_validant', JSON.stringify(o));
    assert.equal(c.libelle, 'À automatiser, vous validez chaque envoi');
    assert.equal(c.risquee, true);
    assert.deepEqual(c.risques, risques);
  }
  assert.equal(simple(calcul({ graviteErreur: 'grave' }).raison), 'Le gain est là (57 h par an, automatisation regagnée en 4 semaines), mais une erreur serait grave : l’automatisation prépare, et vous validez chaque envoi.');
  assert.match(calcul({ graviteErreur: 'grave', casParticuliers: 'souvent', memeFacon: 'variable' }).raison, /mais une erreur serait grave, les cas particuliers sont fréquents et la façon de faire change souvent/);
  // réponses intermédiaires : pas de risque
  for (const o of [{ graviteErreur: 'genante' }, { casParticuliers: 'parfois' }, { memeFacon: 'souvent' }] as Partial<SaisieTache>[]) assert.equal(calcul(o).verdict, 'a_automatiser', JSON.stringify(o));
  // le risque ne change que « à automatiser » : ailleurs il est seulement signalé
  const planifier = calcul({ tempsGagne: 15, fois: 60, periode: 'an', tempsAutomatiser: 8, graviteErreur: 'grave' });
  assert.equal(planifier.verdict, 'a_planifier');
  assert.equal(planifier.risquee, true);
});

test('verdicts « intéressant, à planifier » (5 h par an, 52 semaines au plus) et « petit gain, pas prioritaire » (le reste)', () => {
  const cinq: Partial<SaisieTache> = { tempsGagne: 5, uniteTemps: 'minutes', fois: 60, periode: 'an' };
  const c = calcul({ ...cinq, tempsAutomatiser: 4, uniteAutomatiser: 'heures' });
  assert.equal(c.heuresAn, 5);
  assert.ok(c.rentabiliteSemaines <= 52);
  assert.equal(c.verdict, 'a_planifier');
  assert.equal(c.libelle, 'Intéressant, à planifier');
  // 5 h pour automatiser : 52,18 semaines, juste au-delà de 52
  const long = calcul({ ...cinq, tempsAutomatiser: 5, uniteAutomatiser: 'heures' });
  assert.equal(long.rentabiliteSemaines, 52.18);
  assert.equal(long.verdict, 'petit_gain');
  assert.equal(long.libelle, 'Petit gain, pas prioritaire');
  // 4,9 h par an : petit gain, même regagné tout de suite
  const petit = calcul({ tempsGagne: 6, uniteTemps: 'minutes', fois: 49, periode: 'an', tempsAutomatiser: 10, uniteAutomatiser: 'minutes' });
  assert.equal(petit.heuresAn, 4.9);
  assert.equal(petit.verdict, 'petit_gain');
  assert.equal(simple(petit.raison), 'Vous ne gagnez que 4,9 h par an : d’autres tâches rapporteront plus, commencez par elles.');
});

test('chaque verdict a un libellé, une raison en une phrase avec les chiffres de la personne, et un rang d’affichage', () => {
  const vus = new Map<Verdict, ReturnType<typeof calcul>>();
  for (const c of [calcul(), calcul({ graviteErreur: 'grave' }), calcul({ tempsGagne: 59, fois: 1, periode: 'an' }), calcul({ tempsGagne: 60, fois: 2, periode: 'an', tempsAutomatiser: 2, uniteAutomatiser: 'jours' }),
    calcul({ tempsGagne: 15, fois: 60, periode: 'an', tempsAutomatiser: 8 }), calcul({ tempsGagne: 6, fois: 49, periode: 'an', tempsAutomatiser: 1 })]) vus.set(c.verdict, c);
  assert.deepEqual([...vus.keys()].sort(), Object.keys(RANG_VERDICT).sort(), 'les six verdicts');
  for (const [v, c] of vus) {
    assert.ok(c.libelle.length > 5, v);
    assert.match(c.raison, /^\p{Lu}.*\d.*\.$/u, `${v} : une phrase, avec un chiffre`);
    assert.equal(c.raison.split(/\.\s/).length, 1, `${v} : une seule phrase`);
    for (const e of Object.values(c.explications)) assert.match(e, /\d.*\.$/, `${v} : explication chiffrée`);
  }
  assert.ok(RANG_VERDICT.a_automatiser < RANG_VERDICT.a_planifier && RANG_VERDICT.a_planifier < RANG_VERDICT.petit_gain && RANG_VERDICT.petit_gain < RANG_VERDICT.gain_trop_faible);
});

test('durées et délais en clair ; total invraisemblable signalé', () => {
  assert.deepEqual([duree(0.005), duree(0.75), duree(0.999), duree(5.54), duree(57), duree(99.94), duree(1234.4), duree(-4)].map(simple), ['moins d’une minute', '45 min', '1 h', '5,5 h', '57 h', '99,9 h', '1 234 h', '4 h']);
  assert.deepEqual([delai(0.4), delai(1), delai(1.4), delai(8.4), delai(9), delai(26.1), delai(50), delai(52.18), delai(140), delai(36526)].map(simple),
    ['moins d’une semaine', '1 semaine', '1 semaine', '8 semaines', 'environ 2 mois', 'environ 6 mois', 'environ 11 mois', 'environ 1 an', 'environ 2,7 ans', 'environ 700 ans']);
  const trop = calcul({ tempsGagne: 8, uniteTemps: 'heures', fois: 1, periode: 'jour' });
  assert.equal(trop.heuresAn, 1824);
  assert.equal(simple(trop.aVerifier ?? ''), '1 824 h par an, c’est plus qu’un temps plein (1 596 h) : vérifiez vos chiffres, ou comptez-vous plusieurs personnes ?');
  assert.equal(calcul({ tempsGagne: 7, uniteTemps: 'heures', fois: 1, periode: 'jour' }).aVerifier, null, '1 596 h : un temps plein, pas plus');
});

test('saisie : nom sur une ligne (120 caractères au plus), qui la fait (texte libre ou personne), champs en trop ignorés', () => {
  const recettes = new Set(['relance-factures']);
  const s = lireSaisie({ ...tache(), nom: '  Relancer\n les   factures\u0007 ', qui: '  Anna \t Le Gall ', recette: 'relance-factures', id: 'x', calcul: { verdict: 'a_automatiser' }, creeLe: 'hier' }, recettes);
  assert.deepEqual(s, { ...tache(), nom: 'Relancer les factures', qui: 'Anna Le Gall', recette: 'relance-factures' });
  assert.equal(lireSaisie({ ...tache(), nom: 'é'.repeat(NOM_MAX) }, recettes).nom.length, NOM_MAX);
  assert.equal(lireSaisie({ ...tache(), qui: 'x'.repeat(QUI_MAX) }, recettes).qui.length, QUI_MAX);
  // non précisé
  const sans = { ...tache() } as Record<string, unknown>;
  delete sans.qui;
  delete sans.personne;
  delete sans.recette;
  assert.deepEqual(lireSaisie(sans, recettes), { ...tache(), qui: '', personne: null, recette: null });
  assert.equal(lireSaisie({ ...tache(), recette: '' }, recettes).recette, null);
  // une personne de l'entreprise : le texte libre est écarté
  assert.deepEqual(lireSaisie({ ...tache(), qui: 'Anna', personne: 'p-anna' }, recettes), { ...tache(), qui: '', personne: 'p-anna' });
  // décimales : deux chiffres après la virgule
  assert.equal(lireSaisie({ ...tache(), tempsGagne: 1.256, tempsAutomatiser: 0.5 }, recettes).tempsGagne, 1.26);
  assert.equal(lireSaisie({ ...tache(), tempsGagne: VALEUR_MAX, fois: VALEUR_MAX, tempsAutomatiser: VALEUR_MAX }, recettes).fois, VALEUR_MAX);
});

test('saisie refusée : le champ fautif est nommé, le message dit quoi corriger', () => {
  const recettes = new Set(['relance-factures']);
  const refus: [Record<string, unknown>, string][] = [
    [{ nom: '' }, 'nom'], [{ nom: '   ' }, 'nom'], [{ nom: 'x'.repeat(NOM_MAX + 1) }, 'nom'], [{ nom: 12 }, 'nom'],
    [{ qui: 'x'.repeat(QUI_MAX + 1) }, 'qui'], [{ qui: 7 }, 'qui'], [{ personne: 'a b' }, 'qui'], [{ personne: 'x'.repeat(81) }, 'qui'], [{ personne: 4 }, 'qui'],
    [{ tempsGagne: 0 }, 'tempsGagne'], [{ tempsGagne: -5 }, 'tempsGagne'], [{ tempsGagne: Number.NaN }, 'tempsGagne'], [{ tempsGagne: Number.POSITIVE_INFINITY }, 'tempsGagne'],
    [{ tempsGagne: '5' }, 'tempsGagne'], [{ tempsGagne: VALEUR_MAX + 1 }, 'tempsGagne'], [{ tempsGagne: 0.004 }, 'tempsGagne'], [{ uniteTemps: 'jours' }, 'tempsGagne'],
    [{ fois: 0 }, 'fois'], [{ fois: 1.5 }, 'fois'], [{ fois: VALEUR_MAX + 1 }, 'fois'], [{ fois: '3' }, 'fois'], [{ periode: 'trimestre' }, 'fois'],
    [{ tempsAutomatiser: 0 }, 'tempsAutomatiser'], [{ tempsAutomatiser: VALEUR_MAX + 1 }, 'tempsAutomatiser'], [{ uniteAutomatiser: 'semaines' }, 'tempsAutomatiser'],
    [{ memeFacon: 'jamais' }, 'memeFacon'], [{ casParticuliers: null }, 'casParticuliers'], [{ graviteErreur: 'mortelle' }, 'graviteErreur'],
    [{ recette: 'inconnue' }, 'recette'], [{ recette: 3 }, 'recette'], [{ recette: '__proto__' }, 'recette'],
  ];
  for (const [o, champ] of refus) {
    assert.throws(() => lireSaisie({ ...tache(), ...o }, recettes), (e: unknown) => e instanceof ErreurTache && e.champ === champ && e.message.length > 10, `${JSON.stringify(o)} → ${champ}`);
  }
  for (const x of [null, undefined, 'tâche', 12, [tache()]]) assert.throws(() => lireSaisie(x, recettes), ErreurTache);
  assert.match(simple((() => { try { lireSaisie({ ...tache(), nom: '' }, recettes); return ''; } catch (e) { return (e as Error).message; } })()), /Donnez un nom à la tâche \(120 caractères au plus\)\./);
});

test('durée comptée : 1 à 5 ans, 5 par défaut', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(lireHorizon), [1, 2, 3, 4, 5]);
  assert.deepEqual([0, 6, 2.5, -1, '3', null, undefined, Number.NaN].map(lireHorizon), Array(8).fill(HORIZON_DEFAUT));
  assert.equal(HORIZON_DEFAUT, 5);
  assert.equal(TACHES_MAX, 100);
  assert.equal(NOM_MAX, 120);
});

test('idées de départ : universelles (aucun métier), saisies valides, chiffres d’exemple qui donnent un verdict', () => {
  assert.ok(IDEES.length >= 6 && IDEES.length <= 12, 'une liste courte');
  assert.equal(new Set(IDEES.map((i) => i.id)).size, IDEES.length, 'identifiants uniques');
  const recettes = new Set(IDEES.map((i) => i.recette).filter((r): r is string => r !== null));
  for (const i of IDEES) {
    const { id, ...saisie } = i;
    assert.match(id, /^[a-z-]{3,40}$/);
    assert.ok(i.nom.length <= 40, `${id} : un nom court, qui tient dans un bouton`);
    assert.deepEqual(lireSaisie(saisie, recettes), { ...saisie, qui: '', personne: null }, `${id} : une saisie valide, telle quelle`);
    assert.doesNotMatch(i.nom, /chantier|bâtiment|btp|menuis|artisan|restaurant|cuisine|boutique|magasin|caisse|garage|véhicule|patient|cabinet|ferme|usine|atelier|hôtel|salon/i, `${id} : aucun métier`);
    const c = calculerTache({ ...saisie, qui: '', personne: null }, REGLAGES);
    assert.ok(c.heuresAn >= 15 && c.aVerifier === null, `${id} : un exemple qui vaut la peine d’être regardé (${c.heuresAn} h par an)`);
  }
  for (const sujet of [/factures/, /devis/, /planning/, /clients/, /stock/, /courrier/]) assert.ok(IDEES.some((i) => sujet.test(i.nom)), `une idée sur ${sujet}`);
  assert.ok(IDEES.some((i) => i.recette === null) && IDEES.some((i) => i.recette !== null), 'avec et sans automatisation existante');
  // listes de réponses : celles du formulaire
  assert.deepEqual([UNITES_TEMPS, PERIODES, UNITES_AUTOMATISER, MEME_FACON, CAS_PARTICULIERS, GRAVITES].map((l) => l.length), [3, 4, 3, 3, 3, 3]);
});
