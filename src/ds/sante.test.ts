/**
 * Page Santé (direction de design §6.1 P6, §4.10, §4.22) : web/sante.js (module pur) — 3 priorités avec leur action
 * directe, critères groupés par statut, tendance sur 90 jours (trou et jamais 0 pour un jour sans relevé), résumé en texte.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

type Critere = { id: string; domaine: string; libelle: string; poids: number; score: number | null; mesure: string | null; statut: string; source: string; conseil: string; aLancer?: true };
type Action = { libelle: string; cible: string } | null;
type Module = {
  DOMAINES: Record<string, { libelle: string; icone: string }>;
  STATUTS: ReadonlyArray<{ id: string; titre: string; ton: string | null }>;
  actionCritere: (c: Partial<Critere>, ctx?: { admin?: boolean; demo?: boolean }) => Action;
  prioritesSante: (S: unknown, ctx?: { admin?: boolean; demo?: boolean }) => Array<{ cle: string; titre: string; action: Action; ton: string | null }>;
  groupesCriteres: (d: unknown) => Array<{ id: string; titre: string; criteres: Critere[] }>;
  groupeDeCritere: (c: unknown) => string;
  resumeDomaine: (d: unknown) => { score: number | null; texte: string; aCorriger: number };
  enteteSante: (S: unknown) => { score: number | null; provisoire: boolean; titre: string; couverture: string };
  serieTendance: (t: unknown, auj: string) => { x: number[]; y: Array<number | null> };
  resumeTendance: (t: unknown) => { vide: boolean; variation: number | null; texte: string; variationTexte?: string };
  lignesTendance: (t: unknown) => Array<{ jour: string; score: number; couverture: number }>;
};
const M = (await import(new URL('../../web/sante.js', import.meta.url).href)) as Module;
const espaces = (t: string) => t.replace(/[  ]/g, ' ');

const c = (id: string, domaine: string, score: number | null, poids = 1, statut?: string): Critere => ({
  id, domaine, libelle: id, poids, score, mesure: score === null ? null : `${score} %`, source: 'Factures', conseil: `Conseil ${id}`,
  statut: statut ?? (score === null ? 'inconnu' : score >= 75 ? 'bon' : score >= 45 ? 'moyen' : 'faible'),
});
function sante(criteres: Critere[], score = 51, couverture = 0.8) {
  const domaines = Object.keys(M.DOMAINES).map((d) => ({ id: d, libelle: d, score: null, couverture: 0, criteres: criteres.filter((x) => x.domaine === d) }));
  return { score, couverture, fiabilite: 'bonne', domaines, forces: [], priorites: [], calculeLe: '2026-11-10T08:00:00.000Z' };
}

test('priorités : le bloc financier non renseigné passe d’abord avec « Importer le FEC », puis les critères les plus faibles', () => {
  const S = sante([
    c('tresorerie', 'finances', null, 2), c('marge_brute', 'finances', null, 2), c('rentabilite', 'finances', null, 2),
    c('retards_clients', 'finances', 10, 2), c('ruptures', 'operations', 30, 2), c('satisfaction', 'commercial', 60, 2), c('climat', 'social', 90, 2),
  ]);
  const p = M.prioritesSante(S, { admin: true, demo: false });
  assert.equal(p.length, 3, 'trois priorités, jamais plus');
  assert.equal(p[0]?.cle, 'bloc:finances');
  assert.deepEqual(p[0]?.action, { libelle: 'Importer le FEC', cible: 'fec' });
  assert.deepEqual(p.slice(1).map((x) => x.cle), ['critere:retards_clients', 'critere:ruptures']);
  assert.ok(p.every((x) => x.action), 'chacune a son action directe');
  // en exemple ou sans droit d'administration : pas d'import proposé, les critères faibles restent
  for (const ctx of [{ admin: true, demo: true }, { admin: false, demo: false }]) {
    const q = M.prioritesSante(S, ctx);
    assert.ok(!q.some((x) => x.action?.cible === 'fec' || x.action?.cible === 'connecter'), JSON.stringify(ctx));
    assert.equal(q[0]?.cle, 'critere:retards_clients');
  }
});

test('priorités : un bon critère n’en est jamais une ; aucun logiciel connecté → « Connecter mes données »', () => {
  const S = sante([c('climat', 'social', 95), c('outils_branches', 'automatisation', 0, 1), c('papiers_valides', 'gestion', null, 2)]);
  const p = M.prioritesSante(S, { admin: true });
  assert.ok(!p.some((x) => x.cle === 'critere:climat'));
  const outils = p.find((x) => x.cle === 'critere:outils_branches');
  assert.deepEqual(outils?.action, { libelle: 'Connecter mes données', cible: 'connecter' });
  assert.ok(p.some((x) => x.cle === 'critere:papiers_valides' && x.action?.cible === 'vue:type:document'), 'donnée manquante avec son action');
  assert.deepEqual(M.prioritesSante(sante([c('climat', 'social', 95)]), { admin: true }), [], 'rien de prioritaire');
});

test('actions des critères : un écran existant, ou une action réservée aux administrateurs hors exemple', () => {
  assert.equal(M.actionCritere(c('ruptures', 'operations', 20))?.cible, 'vue:famille:ressource');
  assert.equal(M.actionCritere(c('courrier_urgent', 'gestion', 20))?.cible, 'vue:courrier');
  assert.equal(M.actionCritere(c('affectation', 'social', 20))?.cible, 'vue:planning');
  assert.equal(M.actionCritere(c('tresorerie', 'finances', null), { admin: false }), null, 'import réservé à l’administrateur');
  assert.equal(M.actionCritere(c('tresorerie', 'finances', null), { admin: true, demo: true }), null, 'pas d’import en exemple');
  assert.equal(M.actionCritere(c('tresorerie', 'finances', 20), { admin: false })?.cible, 'vue:type:facture');
  assert.equal(M.actionCritere(c('fiche_entreprise', 'gestion', 20), { admin: true })?.cible, 'vue:accueil');
  assert.equal(M.actionCritere({ id: 'inconnu_du_module', score: 10, statut: 'faible' }), null);
});

test('domaine : critères groupés par statut (à corriger, à surveiller, bon, pas encore renseigné), groupes vides omis', () => {
  const d = { id: 'finances', score: 62, criteres: [c('a', 'finances', 90), c('b', 'finances', 20), c('c', 'finances', null), c('d', 'finances', 50), c('e', 'finances', 10)] };
  const g = M.groupesCriteres(d);
  assert.deepEqual(g.map((x) => x.titre), ['À corriger', 'À surveiller', 'Bon', 'Pas encore renseigné']);
  assert.deepEqual(g[0]?.criteres.map((x) => x.id), ['e', 'b'], 'le plus faible d’abord');
  assert.deepEqual(M.groupesCriteres({ criteres: [c('a', 'finances', 90)] }).map((x) => x.id), ['bon']);
  assert.equal(espaces(M.resumeDomaine(d).texte), '62 sur 100 · 4 critères sur 5 renseignés');
  assert.equal(M.resumeDomaine(d).aCorriger, 2);
  assert.match(M.resumeDomaine({ score: null, criteres: [c('x', 'social', null)] }).texte, /^Pas encore renseigné · 0 critère sur 1 renseigné$/);
  for (const [id, dom] of Object.entries(M.DOMAINES)) assert.ok(dom.icone && !/\p{Extended_Pictographic}/u.test(dom.libelle + dom.icone), `${id} : icône Lucide, pas d’emoji`);
});

test('en-tête : titre selon le palier, score provisoire sous 50 % des critères, « Pas encore assez de données »', () => {
  assert.equal(M.enteteSante({ score: 80, couverture: 0.9, domaines: [] }).titre, 'Votre entreprise est en bonne santé');
  assert.equal(M.enteteSante({ score: 51, couverture: 0.9, domaines: [] }).titre, 'Des points à surveiller');
  assert.equal(M.enteteSante({ score: 20, couverture: 0.9, domaines: [] }).titre, 'Des priorités à traiter');
  assert.equal(M.enteteSante({ score: 51, couverture: 0.3, domaines: [] }).provisoire, true);
  assert.equal(M.enteteSante({ score: null, couverture: 0.1, domaines: [] }).titre, 'Pas encore assez de données pour un score');
});

test('tendance : un x par jour sur 90 jours, null (jamais 0) pour un jour sans relevé, résumé en texte', () => {
  const t = { jours: 90, exemple: false, points: [{ jour: '2026-08-13', score: 40, couverture: 0.5 }, { jour: '2026-11-08', score: 47, couverture: 0.7 }, { jour: '2026-11-10', score: 51, couverture: 0.8 }] };
  const s = M.serieTendance(t, '2026-11-10');
  assert.equal(s.x.length, 90);
  assert.equal(s.x.at(-1), Date.parse('2026-11-10T00:00:00Z') / 1000);
  assert.equal(s.x[1]! - s.x[0]!, 86_400);
  assert.equal(s.y.at(-1), 51);
  assert.equal(s.y.at(-2), null, 'le 9 novembre n’a pas de relevé : un trou');
  assert.equal(s.y[0], 40);
  assert.ok(!s.y.includes(0), 'jamais 0 pour une donnée absente');
  const r = M.resumeTendance(t);
  assert.equal(r.vide, false);
  assert.equal(r.variation, 11);
  assert.equal(espaces(r.texte), 'Score : 51 sur 100 au dernier relevé, en hausse de 11 points sur 90 jours.');
  assert.equal(espaces(M.resumeTendance({ jours: 90, points: [{ jour: '2026-11-01', score: 60 }, { jour: '2026-11-10', score: 55 }] }).texte), 'Score : 55 sur 100 au dernier relevé, en baisse de 5 points depuis 9 jours.');
  assert.match(M.resumeTendance({ jours: 90, points: [{ jour: '2026-11-01', score: 60 }, { jour: '2026-11-10', score: 60 }] }).texte, /stable/);
  assert.equal(M.resumeTendance({ jours: 90, points: [{ jour: '2026-11-10', score: 60 }] }).vide, true);
  assert.equal(M.resumeTendance({ jours: 90, points: [] }).vide, true);
  assert.deepEqual(M.lignesTendance(t).map((l) => l.jour), ['2026-11-10', '2026-11-08', '2026-08-13'], 'tableau équivalent, du plus récent au plus ancien');
});

test('entreprise toute neuve : « À lancer », jamais « 0 sur 100 » pour une pratique pas encore commencée', async () => {
  const { evaluerSante, JOURS_AVANT_NOTE, joursDeDonnees } = await import('../core/sante.ts');
  const objet = (id: string, famille: string, type: string, nom: string, jours: number) => ({
    id, orgId: 'o', famille, type, roles: famille === 'tiers' ? ['client'] : [], nom, champs: {},
    provenance: 'declare', source: { id: 'saisie', libelle: 'Saisie', derniereSynchro: null },
    majLe: new Date(Date.parse('2026-11-10T09:00:00Z') - jours * 86_400_000).toISOString(), disponibilite: 'disponible', mode: 'reel',
  }) as never;
  const maintenant = new Date('2026-11-10T09:00:00Z');
  const evaluer = (jours: number) => evaluerSante({
    objets: [objet('org', 'organisation', 'mon_entreprise', 'Kerlann', jours), objet('c1', 'tiers', 'entreprise', 'Cave du Port', jours)],
    planning: new Map(), maintenant, ageMaxMs: 365 * 86_400_000, modules: { connecteursActifs: 0, connecteursEnErreur: 0, automatisationsActives: 0, heuresRecuperables: null },
  });
  const critere = (S: ReturnType<typeof evaluerSante>, id: string) => S.domaines.flatMap((d) => d.criteres).find((x) => x.id === id);
  // deux minutes après l'installation : aucun avis demandé, aucun outil branché — ce ne sont pas des notes de zéro
  const neuve = evaluer(0);
  assert.ok(joursDeDonnees([objet('org', 'organisation', 'mon_entreprise', 'K', 0)] as never, maintenant) < 1);
  for (const id of ['clients_ecoutes', 'outils_branches', 'automatisations']) {
    const c2 = critere(neuve, id);
    assert.deepEqual([c2?.score, c2?.statut, c2?.mesure, c2?.aLancer], [null, 'inconnu', 'À lancer', true], id);
  }
  assert.ok(!neuve.priorites.some((x) => x.id === 'clients_ecoutes'), 'aucune priorité rouge sur une pratique pas commencée');
  // passé le premier mois de données, le zéro redevient une note : la pratique aurait eu le temps d'être lancée
  const rodee = evaluer(JOURS_AVANT_NOTE + 1);
  assert.deepEqual([critere(rodee, 'clients_ecoutes')?.score, critere(rodee, 'clients_ecoutes')?.statut], [0, 'faible']);
  assert.equal(critere(rodee, 'clients_ecoutes')?.aLancer, undefined);
  // l'écran les range dans leur propre groupe, « À lancer », sans ton d'alerte
  assert.deepEqual(M.STATUTS.map((x) => x.id), ['faible', 'moyen', 'bon', 'a_lancer', 'inconnu']);
  assert.equal(M.STATUTS.find((x) => x.id === 'a_lancer')?.ton, null);
  assert.equal(M.groupeDeCritere({ statut: 'inconnu', aLancer: true }), 'a_lancer');
  assert.equal(M.groupeDeCritere({ statut: 'faible' }), 'faible');
  const groupes = M.groupesCriteres({ criteres: [{ ...c('clients_ecoutes', 'commercial', null), aLancer: true as const }, c('ruptures', 'operations', 10)] });
  assert.deepEqual(groupes.map((g) => [g.id, g.criteres.length]), [['faible', 1], ['a_lancer', 1]]);
  // et la priorité correspondante dit quoi commencer, pas quoi connecter
  const prio = M.prioritesSante(sante([{ ...c('clients_ecoutes', 'commercial', null), aLancer: true as const }]), { admin: true });
  assert.equal(prio[0]?.titre, 'clients_ecoutes : à lancer');
  assert.deepEqual(prio[0]?.action, { libelle: 'Envoyer les formulaires', cible: 'vue:satisfaction' });
});
