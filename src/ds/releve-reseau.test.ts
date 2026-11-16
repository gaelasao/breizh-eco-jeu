/**
 * Écran « Ce que vos agents ont fait » : le relevé du réseau, lu dans Living Business.
 * - src/passerelle/lien-nexus.ts (`lireReleve`) : rien n'est montré sans avoir été relu ; une estimation sans son
 *   hypothèse est écartée, un relevé illisible donne null plutôt qu'un chiffre inventé ;
 * - web/releve-reseau.js (module pur) : les comptes s'affichent (zéro compris), les estimations seulement si elles
 *   portent leur hypothèse, et les quatre états de l'écran sont décidés en un seul endroit ;
 * - web/app.js (lu comme un texte, sans navigateur) : l'écran affiche, il ne recompte rien.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lireReleve } from '../passerelle/lien-nexus.ts';

const R = (await import(new URL('../../web/releve-reseau.js', import.meta.url).href)) as Record<string, never> & {
  duree: (n: unknown) => string | null;
  titreMois: (x: unknown) => string | null;
  voisins: (mois: string, courant: string) => { avant: string | null; apres: string | null };
  lignes: (m: unknown, o?: { agents?: boolean }) => { cle: string; valeur: string; mot: string; hypothese: string | null }[];
  phrase: (r: unknown) => string;
  etat: (o: { relie: boolean; releve: unknown }) => string;
  TEXTES: Record<string, { titre: string; texte: string }>;
};
const lire = (f: string) => readFileSync(fileURLToPath(new URL(`../../${f}`, import.meta.url)), 'utf8');
const esp = (t: string) => t.replace(/[  ]/g, ' ');

const HYP = 'écart entre le prix affiché et le prix obtenu, sur les commandes confirmées.';
const RELEVE = {
  mois: '2026-06', moisCourant: '2026-06',
  aLaMain: { occasions: 2, gestes: 1, abouties: 0, rapprochements: 0, temps: null, euros: null },
  parLesAgents: { occasions: 2, gestes: 0, abouties: 1, rapprochements: 4, temps: { valeur: 60, hypothese: '15 minutes par rapprochement évité.', sur: 4 }, euros: { valeur: 72, hypothese: HYP, sur: 1 } },
  nonChiffre: [],
};

// ---------------------------------------------------------------- ce que la passerelle relit

test('le relevé du réseau est relu avant d’être montré ; illisible, il ne donne rien', () => {
  const r = lireReleve(RELEVE);
  assert.ok(r);
  assert.equal(r.mois, '2026-06');
  assert.equal(r.parLesAgents?.euros?.valeur, 72);
  assert.equal(r.parLesAgents?.euros?.hypothese, HYP);
  assert.equal(r.aLaMain.occasions, 2);
  // un mois illisible, ou une réponse qui n'est pas un relevé : rien, jamais un chiffre de remplacement
  for (const x of [null, undefined, 'bien', 42, [], {}, { mois: '2026-13' }, { mois: 'juin' }]) assert.equal(lireReleve(x), null);
});

test('une estimation sans son hypothèse est écartée par la passerelle, pas rattrapée', () => {
  const sans = lireReleve({ ...RELEVE, parLesAgents: { ...RELEVE.parLesAgents, temps: { valeur: 60, sur: 4 }, euros: { valeur: 72, hypothese: '   ', sur: 1 } } });
  assert.equal(sans?.parLesAgents?.temps, null, 'pas d’hypothèse, pas de chiffre');
  assert.equal(sans?.parLesAgents?.euros, null);
  // zéro ou négatif n'est pas un gain : on ne l'affiche pas comme tel
  const zero = lireReleve({ ...RELEVE, parLesAgents: { ...RELEVE.parLesAgents, temps: { valeur: 0, hypothese: 'x' }, euros: { valeur: -5, hypothese: 'x' } } });
  assert.equal(zero?.parLesAgents?.temps, null);
  assert.equal(zero?.parLesAgents?.euros, null);
});

test('un compte abîmé vaut zéro, et « aucun agent » reste « aucun agent »', () => {
  const abime = lireReleve({ ...RELEVE, aLaMain: { occasions: -3, gestes: 2.7, abouties: 'beaucoup', rapprochements: null } });
  assert.deepEqual({ o: abime?.aLaMain.occasions, g: abime?.aLaMain.gestes, a: abime?.aLaMain.abouties }, { o: 0, g: 2, a: 0 });
  assert.equal(lireReleve({ ...RELEVE, parLesAgents: null })?.parLesAgents, null, 'sans abonnement : le travail de l’entreprise, pas celui d’un agent');
  assert.equal(lireReleve({ mois: '2026-06' })?.parLesAgents, null);
  // le mois courant manquant retombe sur le mois lu : on ne propose pas de feuilleter vers un mois inventé
  assert.equal(lireReleve({ mois: '2026-06' })?.moisCourant, '2026-06');
});

// ---------------------------------------------------------------- ce que l'écran met en forme

test('les quatre états de l’écran sont décidés en un seul endroit, et chacun a son texte', () => {
  assert.equal(R.etat({ relie: false, releve: RELEVE }), 'non_relie');
  assert.equal(R.etat({ relie: true, releve: null }), 'illisible');
  assert.equal(R.etat({ relie: true, releve: { mois: 'juin' } }), 'illisible');
  assert.equal(R.etat({ relie: true, releve: { ...RELEVE, parLesAgents: null } }), 'sans_agent');
  assert.equal(R.etat({ relie: true, releve: RELEVE }), 'complet');
  for (const [cle, t] of Object.entries(R.TEXTES)) {
    assert.match(t.titre, /\.$/u, `${cle} : un titre en une phrase`);
    assert.ok(t.texte.length > 40, `${cle} : on explique`);
    for (const x of [t.titre, t.texte]) {
      assert.doesNotMatch(x, /ratez|manquez|perdez|dommage|passez à côté/i, `${cle} : aucune culpabilisation`);
      assert.doesNotMatch(x, /\benviron\b|à peu près/i, `${cle} : aucun « environ » pour combler un trou`);
      assert.doesNotMatch(x, /NEXUS/, `${cle} : le réseau s’appelle Breizhcosystem`);
      assert.doesNotMatch(x, /'/, `${cle} : apostrophe française`);
    }
  }
});

test('les comptes s’affichent, zéro compris ; les estimations seulement avec leur hypothèse', () => {
  const main = R.lignes(RELEVE.aLaMain);
  assert.deepEqual(main.map((l) => l.cle), ['occasions', 'gestes', 'abouties']);
  assert.deepEqual(main.map((l) => l.valeur), ['2', '1', '0'], 'le zéro de « abouties » s’affiche : c’est un résultat');
  assert.equal(main[2]?.mot, 'mise en relation aboutie', 'singulier au zéro, comme en français');
  assert.ok(main.every((l) => l.hypothese === null));

  const agents = R.lignes(RELEVE.parLesAgents, { agents: true });
  // les occasions ne sont pas répétées du côté des agents : une occasion vue est une occasion, pas deux
  assert.deepEqual(agents.map((l) => l.cle), ['rapprochements', 'abouties', 'temps', 'euros']);
  assert.equal(agents[0]?.mot, 'rapprochements préparés');
  assert.equal(esp(agents[2]?.valeur ?? ''), '1 h');
  assert.equal(agents[2]?.hypothese, '15 minutes par rapprochement évité.');
  assert.equal(esp(agents[3]?.valeur ?? ''), '72,00 €');

  // une estimation mal formée disparaît : ni tiret, ni « environ »
  const abime = R.lignes({ occasions: 1, gestes: 0, abouties: 0, temps: { valeur: 30 }, euros: { hypothese: 'x' } });
  assert.deepEqual(abime.map((l) => l.cle), ['occasions', 'gestes', 'abouties']);
  assert.ok(!JSON.stringify(abime).includes('—'));
  assert.deepEqual(R.lignes(null), []);
});

test('une durée se lit en minutes puis en heures, jamais en journées', () => {
  assert.equal(esp(R.duree(45) ?? ''), '45 min');
  assert.equal(esp(R.duree(195) ?? ''), '3 h 15');
  assert.equal(esp(R.duree(1500) ?? ''), '25 h');
  for (const x of [0, -1, null, 'longtemps', Number.NaN]) assert.equal(R.duree(x), null);
});

test('on feuillette vers le passé, jamais vers un mois à venir', () => {
  assert.equal(R.titreMois('2026-06'), 'juin 2026');
  assert.equal(R.titreMois('2026-13'), null);
  assert.deepEqual(R.voisins('2026-06', '2026-06'), { avant: '2026-05', apres: null });
  assert.deepEqual(R.voisins('2026-01', '2026-06'), { avant: '2025-12', apres: '2026-02' });
  assert.deepEqual(R.voisins('2026-12', '2027-02'), { avant: '2026-11', apres: '2027-01' });
});

test('la phrase d’en-tête dit la vérité, y compris quand il n’y a rien', () => {
  assert.equal(esp(R.phrase({ aLaMain: { occasions: 0, gestes: 0 }, parLesAgents: null })),
    'Rien ne s’est passé ce mois-ci sur le réseau : ni occasion vue, ni geste de votre part.');
  assert.equal(esp(R.phrase({ aLaMain: { occasions: 0, gestes: 0 }, parLesAgents: { occasions: 0, rapprochements: 0, abouties: 0 } })),
    'Vos agents n’ont rien eu à faire ce mois-ci : aucune occasion ne s’est présentée.');
  assert.equal(esp(R.phrase(RELEVE)), 'Ce mois-ci : 4 rapprochements préparés par vos agents, 1 mise en relation aboutie.');
  assert.equal(esp(R.phrase({ ...RELEVE, parLesAgents: null })), 'Ce mois-ci : 2 occasions vues et 1 geste de votre part.');
  assert.equal(R.phrase(null), '');
});

// ---------------------------------------------------------------- ce que l'écran ne fait pas

test('l’écran affiche, il ne recompte rien : aucun calcul de chiffre dans le module ni dans l’écran', () => {
  const module = lire('web/releve-reseau.js');
  // aucune règle d'estimation côté jeu : les minutes par rapprochement et les écarts de prix sont au réseau
  assert.doesNotMatch(module, /\* *15|15 *\*|0\.15|minutes *\*|\* *minutes/, 'aucune estimation recalculée ici');
  assert.doesNotMatch(module, /prix_affiche|prixAffiche|prixPropose/, 'aucun écart de prix recalculé ici');
  const ecran = lire('web/app.js');
  const debut = ecran.indexOf('function tuileReleve');
  // jusqu'au séparateur de section suivant : on ne lit que l'écran du relevé, pas le code d'à côté
  const fin = ecran.indexOf('\n// ----', ecran.indexOf('async function rendreReleve'));
  assert.ok(debut > 0 && fin > debut, 'les bornes de l’écran du relevé sont bien trouvées');
  const bloc = ecran.slice(debut, fin);
  assert.ok(bloc.length > 500 && bloc.length < 10_000, `l’écran du relevé a bien été lu (${bloc.length} caractères)`);
  assert.doesNotMatch(bloc, /toFixed|Math\.round|\bMath\.floor\b/, 'l’écran n’arrondit rien : il montre ce que le réseau a compté');
  assert.doesNotMatch(bloc, /environ/i, 'aucun « environ »');
  assert.doesNotMatch(bloc, /NEXUS/, 'le réseau s’appelle Breizhcosystem');
  assert.match(bloc, /RELEVE\.etat/, 'un seul endroit décide de l’état de l’écran');
  assert.match(bloc, /nonChiffre/, 'ce qui n’est pas chiffré est dit en clair');
});
