/**
 * « Aujourd'hui » (direction de design §6.1 P2, §4.8, §4.9, §4.10, §4.20) : web/aujourdhui.js (module pur) —
 * la chose à faire maintenant, la pile de 3 à 5 actions, « Plus tard », les tuiles homogènes et l'anneau de santé.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Suivi = { tacheId: string; titre: string; echeance: string | null; responsable: string | null; nombre: number; texte: string };
type Action = { cle: string; type: string; ton: string; titre: string; texte?: string; bouton?: string | null; direct?: string | null; objetId?: string | null; revient?: string; verifier?: boolean; suivi?: Suivi };
type Etape = { id: string; titre: string; sert: string; minutes: number; bouton: string; action: string; faites: number; total: number };
type Plan = { heros: Action; pile: Action[]; autres: Action[]; enCours: Action[]; reportees: Action[]; aVerifier: Action[]; aFaire: number; actionsReelles: boolean; vide: boolean; sansSource: boolean; etape: Etape | null };
type Vus = { carte?: boolean; sante?: boolean; planning?: boolean; invitee?: boolean; sauvegarde?: boolean; passees?: string[] };
type Tuile = { cle: string; libelle: string; valeur: number | null; ton: string | null; vue: string };
type Anneau = { score: number | null; arc: number; tour: number; provisoire: boolean; palier: { libelle: string; ton: string } | null; libelle: string; aria: string; part: number; arcCouverture: number; tourCouverture: number };
type Module = {
  planAujourdhui: (m: unknown, o?: { reports?: Record<string, string>; maintenant?: Date; filtre?: (o: unknown) => boolean; vus?: Vus }) => Plan;
  prochaineEtape: (m: unknown, vus?: Vus) => Etape | null;
  ETAPES_MISE_EN_ROUTE: ReadonlyArray<{ id: string; titre: string; sert: string; minutes: number; bouton: string; action: string }>;
  tuilesARegler: (m: unknown, o?: { maintenant?: Date }) => Tuile[];
  suiviDe: (objetId: string | null, m: unknown) => Suivi | null;
  anneauSante: (s: unknown) => Anneau;
  palierSante: (s: number | null) => { libelle: string; ton: string } | null;
  cheminArc: (p: number, r: number, c?: number) => string;
  premiersPas: (m: unknown, v?: { carte?: boolean; sante?: boolean }) => null | { etapes: Array<{ id: string; fait: boolean; statut: string }>; faites: number; total: number; fini: boolean; resume: string; reste: string };
  jourLocal: (d?: Date) => string;
  lendemain: (j: string) => string;
  reportsValides: (r: Record<string, string>, j: string) => Record<string, string>;
  estReportee: (r: Record<string, string>, c: string, j: string) => boolean;
  lisible: (t: string) => string;
  cleSituation: (s: unknown) => string;
  ACTIONS_MAX: number;
  RAYON_ANNEAU: number;
};
const A = (await import(new URL('../../web/aujourdhui.js', import.meta.url).href)) as Module;
const espaces = (t: string) => t.replace(/[  ]/g, ' ');
const RACINE = fileURLToPath(new URL('../../', import.meta.url));

const preuve = { source: { libelle: 'Pennylane' }, observeLe: '2026-11-10T07:00:00.000Z', fraicheur: 'fraiche' };
const sit = (objetId: string, regle: string, gravite: string, statut = 'ouverte', description = 'Retard : 18 jours') => ({ objetId, regle, gravite, statut, description, preuve });
function monde({ demo = false, admin = true, situations = [] as unknown[], objets = null as unknown[] | null, attente = [] as unknown[], sante = { score: 51, couverture: 0.8 } as unknown } = {}) {
  return {
    organisation: { nom: 'Kerlann Bois', demo },
    profil: { nom: 'Maïwenn — dirigeante', peutAdministrer: admin, peutPreparer: true, peutApprouver: true },
    synchro: { actifs: 0 },
    objets: objets ?? [
      { id: 'org', famille: 'organisation', type: 'mon_entreprise', champs: [] },
      { id: 'f1', famille: 'commande', type: 'facture', nom: 'Facture F-041', libelleType: 'Facture', champs: [] },
      { id: 'f2', famille: 'commande', type: 'facture', nom: 'Facture F-042', libelleType: 'Facture', champs: [] },
      { id: 'a1', famille: 'ressource', type: 'article', nom: 'Panneaux', libelleType: 'Article', champs: [] },
      { id: 't1', famille: 'tiers', type: 'entreprise', nom: 'Boulangerie Exemple (fictive)', libelleType: 'Entreprise', champs: [] },
      { id: 'e1', famille: 'personne', type: 'employe', nom: 'Erwan', libelleType: 'Employé', champs: [] },
    ],
    situations,
    quetes: [{ origine: { objetId: 'a1' }, statut: 'ouverte', actionProposee: 'mouvement' }],
    actionsEnAttente: attente,
    planning: { trousAujourdhui: 1 },
    sante,
  };
}
const MATIN = new Date(2026, 10, 10, 9, 0);
/** Mise en route terminée ou entièrement mise de côté : plus aucune étape n'est proposée. */
const TOUT_VU: Vus = { passees: A.ETAPES_MISE_EN_ROUTE.map((e) => e.id) };

test('héros : la chose la plus urgente d’abord (critique, puis à approuver, puis attention), une seule', () => {
  const m = monde({
    situations: [sit('a1', 'stock_minimum', 'attention', 'ouverte', 'Stock : 6 (minimum 20)'), sit('f1', 'retard_paiement', 'critique', 'ouverte', 'Retard de paiement : 6800 € depuis 18 jours'), sit('t1', 'encours_client', 'info')],
    attente: [{ cle: 'k1', capacite: 'mouvement', cible: 'a1', cibleNom: 'Panneaux' }],
  });
  const p = A.planAujourdhui(m, { maintenant: MATIN });
  assert.equal(p.heros.objetId, 'f1', 'critique d’abord, même listée après');
  assert.equal(p.heros.titre, 'Facture F-041');
  assert.equal(espaces(p.heros.texte ?? ''), 'Retard de paiement : 6 800 € depuis 18 jours', 'montants mis en forme');
  assert.deepEqual(p.pile.map((a) => a.type), ['attente', 'situation', 'situation'], 'puis l’approbation, puis l’attention, puis l’information');
  assert.equal(p.pile[1]?.bouton, 'Enregistrer un mouvement', 'quête ouverte sur l’objet : action directe');
  assert.equal(p.pile[2]?.titre, 'Boulangerie Exemple', 'sans la mention de démonstration');
  assert.equal(p.aFaire, 4);
  assert.ok(p.actionsReelles);
});

test('pile : 3 à 5 actions, le reste replié ; « à vérifier » à part, jamais reportable', () => {
  const situations = Array.from({ length: 9 }, (_, i) => sit(`x${i}`, `r${i}`, 'attention'));
  situations.push(sit('a1', 'stock_minimum', 'info', 'a_verifier'));
  const p = A.planAujourdhui(monde({ situations }), { maintenant: MATIN });
  assert.equal(A.ACTIONS_MAX, 5);
  assert.equal(p.pile.length, 5);
  assert.equal(p.autres.length, 3, '9 actions : 1 héros, 5 dans la pile, 3 repliées');
  assert.equal(p.aVerifier.length, 1);
  assert.ok(p.aVerifier[0]?.verifier);
  assert.equal(new Set([p.heros, ...p.pile, ...p.autres].map((a) => a.cle)).size, 9, 'chaque action une seule fois');
});

test('« Plus tard » : l’action revient le lendemain ; les reports échus sont oubliés', () => {
  assert.equal(A.jourLocal(MATIN), '2026-11-10');
  assert.equal(A.lendemain('2026-11-10'), '2026-11-11');
  assert.equal(A.lendemain('2026-12-31'), '2027-01-01');
  assert.equal(A.lendemain('2027-02-28'), '2027-03-01');
  const s1 = sit('f1', 'retard_paiement', 'critique');
  const s2 = sit('a1', 'stock_minimum', 'attention');
  const m = monde({ situations: [s1, s2] });
  const reports = { [A.cleSituation(s1)]: '2026-11-11' };
  const auj = A.planAujourdhui(m, { reports, maintenant: MATIN });
  assert.equal(auj.heros.objetId, 'a1', 'la critique reportée laisse la place');
  assert.equal(auj.reportees.length, 1);
  assert.equal(auj.reportees[0]?.revient, '2026-11-11');
  assert.equal(auj.aFaire, 1, 'le compteur ne compte que ce qui reste à faire aujourd’hui');
  const demain = A.planAujourdhui(m, { reports, maintenant: new Date(2026, 10, 11, 8) });
  assert.equal(demain.heros.objetId, 'f1', 'le lendemain, elle revient en tête');
  assert.deepEqual(A.reportsValides({ a: '2026-11-11', b: '2026-11-10', c: 42 as unknown as string }, '2026-11-10'), { a: '2026-11-11' });
  assert.ok(A.estReportee(reports, A.cleSituation(s1), '2026-11-10') && !A.estReportee(reports, A.cleSituation(s1), '2026-11-11'));
});

test('« Connecter mes données » : héros d’un monde vide, première action d’un exemple, jamais sans droits', () => {
  const vide = A.planAujourdhui(monde({ objets: [{ id: 'org', famille: 'organisation', champs: [] }] }), { maintenant: MATIN });
  assert.equal(vide.heros.type, 'connecter');
  assert.ok(vide.vide);
  const exemple = A.planAujourdhui(monde({ demo: true, situations: [sit('f1', 'retard_paiement', 'critique')] }), { maintenant: MATIN });
  assert.equal(exemple.heros.objetId, 'f1', 'la chose à faire maintenant reste en tête');
  assert.equal(exemple.pile[0]?.type, 'connecter', 'tant qu’aucune source réelle n’est connectée');
  const lecteur = A.planAujourdhui(monde({ demo: true, admin: false }), { maintenant: MATIN });
  assert.ok(![lecteur.heros, ...lecteur.pile].some((a) => a.type === 'connecter'));
  // plus rien d'urgent ET plus aucune étape à proposer (toutes mises de côté) : l'écran le dit, sans rien inventer
  const rien = A.planAujourdhui(monde(), { maintenant: MATIN, vus: TOUT_VU });
  assert.equal(rien.heros.type, 'rien');
  assert.equal(rien.heros.titre, 'Rien d’urgent aujourd’hui.');
  assert.equal(rien.heros.bouton, 'Voir ma santé');
  assert.equal(rien.pile.length, 0);
  assert.ok(!rien.actionsReelles);
});

test('tuiles (§4.9) : une seule nature de chiffre (des choses à régler) ; inconnu = null, jamais 0', () => {
  const t = A.tuilesARegler(monde({ situations: [sit('f1', 'retard_paiement', 'critique'), sit('f2', 'retard_paiement', 'attention'), sit('a1', 'stock_minimum', 'attention', 'a_verifier')] }));
  const v = Object.fromEntries(t.map((x) => [x.cle, x.valeur]));
  assert.deepEqual(v, { factures: 2, stock: 0, clients: 0, documents: null, courrier: null, planning: 1, taches: null });
  assert.equal(t.find((x) => x.cle === 'factures')?.ton, 'critique');
  assert.equal(t.find((x) => x.cle === 'stock')?.ton, null, 'rien d’ouvert : pas d’icône d’état');
  for (const x of t) {
    assert.match(x.libelle, /retard|traiter|surveiller|renouveler|urgents|planning|à faire/, `${x.cle} : une chose à régler`);
    assert.ok(x.vue, `${x.cle} : la tuile mène au détail`);
  }
  assert.ok(!t.some((x) => /^(Clients|Fournisseurs|Équipes)$/.test(x.libelle)), 'aucun total dans la rangée');
});

test('« Aujourd’hui » prend acte : une situation prise en charge par une tâche passe « en cours », elle n’est plus redemandée', () => {
  const tache = (id: string, nom: string, concerne: string | null, statut = 'à faire', echeance: string | null = '2026-11-15', responsable: string | null = null) =>
    ({ id, famille: 'tache', type: 'tache', nom, champs: [{ id: 'concerne', valeur: concerne }, { id: 'statut', valeur: statut }, { id: 'echeance', valeur: echeance }, { id: 'responsable', valeur: responsable }] });
  const situations = [sit('f1', 'retard_paiement', 'critique', 'ouverte', 'Retard de paiement : 42 jours'), sit('a1', 'stock_minimum', 'attention', 'ouverte', 'Stock : 6 (minimum 20)')];
  const base = monde().objets;
  const plan = (objets: unknown[]) => A.planAujourdhui(monde({ situations, objets }), { maintenant: MATIN, vus: TOUT_VU });

  // avant : la facture en retard est « À faire maintenant », avec « Créer une tâche »
  const avant = plan(base);
  assert.deepEqual([avant.heros.objetId, avant.aFaire, avant.enCours.length], ['f1', 2, 0]);

  // la tâche existe (créée à la main ou préparée par une automatisation) : l'écran en prend acte
  const apres = plan([...base, tache('tx', 'Relancer Facture F-041 (fictive)', 'f1', 'à faire', '2026-11-15', 'e1')]);
  assert.equal(apres.heros.objetId, 'a1', 'le héros passe à la chose suivante');
  assert.ok(![apres.heros, ...apres.pile, ...apres.autres].some((a) => a.objetId === 'f1'), 'la facture n’est plus redemandée');
  assert.equal(apres.aFaire, 1, 'le compteur du menu baisse : une chose de moins à faire');
  assert.deepEqual(apres.enCours.map((a) => a.objetId), ['f1']);
  const f = apres.enCours[0];
  assert.deepEqual([f?.bouton, f?.direct, f?.suivi?.tacheId, f?.suivi?.nombre], ['Voir la tâche', null, 'tx', 1], 'on ouvre la tâche, on n’en crée pas une seconde');
  assert.equal(espaces(f?.suivi?.texte ?? ''), 'Tâche en cours : Relancer Facture F-041, pour le 15 nov., confiée à Erwan.');
  assert.equal(f?.texte, 'Retard de paiement : 42 jours', 'le constat reste dit');

  // plusieurs tâches : la plus proche d'abord ; sans date ni responsable : rien d'inventé
  const deux = A.suiviDe('f1', monde({ objets: [...base, tache('t2', 'Appeler le client', 'f1', 'en cours', null), tache('t1', 'Relancer par courrier', 'f1', 'à faire', '2026-11-12')] }));
  assert.deepEqual([deux?.tacheId, deux?.nombre], ['t1', 2]);
  assert.match(espaces(deux?.texte ?? ''), /^2 tâches en cours, dont : Relancer par courrier, pour le 12 nov\.\.$/);
  assert.equal(espaces(A.suiviDe('f1', monde({ objets: [...base, tache('t3', 'Appeler le client', 'f1', 'bloquée', null)] }))?.texte ?? ''), 'Tâche en cours : Appeler le client.');

  // une tâche terminée, ou qui porte sur autre chose, ne prend rien en charge : la situation redevient « à faire »
  for (const autre of [tache('tx', 'Relancer', 'f1', 'terminée'), tache('tx', 'Inventaire', 'a9'), tache('tx', 'Sans lien', null)]) {
    assert.equal(plan([...base, autre]).heros.objetId, 'f1');
    assert.equal(plan([...base, autre]).enCours.length, 0);
  }
  // une situation qui porte sur la tâche elle-même (tâche en retard) reste une chose à faire
  const enRetard = A.planAujourdhui(monde({ situations: [sit('tx', 'echeance', 'attention', 'ouverte', 'Tâche : échéance dépassée de 3 jours')], objets: [...base, tache('tx', 'Relancer', 'tx')] }), { maintenant: MATIN });
  assert.deepEqual([enRetard.heros.objetId, enRetard.enCours.length], ['tx', 0]);

  // tout est pris en charge : on le dit, sans rien inventer d'urgent
  const tout = plan([...base, tache('t1', 'Relancer', 'f1'), tache('t2', 'Commander des panneaux', 'a1')]);
  assert.deepEqual([tout.heros.type, tout.heros.titre, tout.aFaire, tout.actionsReelles, tout.enCours.length], ['rien', 'Tout est pris en charge.', 0, false, 2]);
  assert.match(espaces(tout.heros.texte ?? ''), /^2 actions sont en cours : il reste à attendre le résultat\./);
  assert.deepEqual(tout.enCours.map((a) => a.objetId), ['f1', 'a1'], 'le plus grave d’abord');

  // dessin : section « En cours », bouton qui ouvre la tâche, pas de « Plus tard » sur ce qui est déjà lancé
  const app = readFileSync(`${RACINE}web/app.js`, 'utf8');
  assert.match(app, /if \(a\.suivi\) return selectionner\(a\.suivi\.tacheId\);/);
  assert.match(app, /texte: 'En cours, en attente du résultat'/);
  assert.match(app, /&& !a\.revient && !a\.suivi;/);
});

test('tuile « Tâches à faire » : ce que « J’automatise » prépare se voit dans « Aujourd’hui »', () => {
  const tache = (id: string, statut: string, echeance: string | null) => ({ id, famille: 'tache', type: 'tache', nom: id, champs: [{ id: 'statut', valeur: statut }, { id: 'echeance', valeur: echeance }] });
  const base = monde().objets;
  const tuile = (objets: unknown[]) => A.tuilesARegler(monde({ objets }), { maintenant: MATIN }).find((x) => x.cle === 'taches');
  // aucune tâche : inconnu (« — »), jamais 0
  assert.deepEqual([tuile(base)?.valeur, tuile(base)?.ton], [null, null]);
  // tâches à venir : comptées, sans signal
  const aVenir = [...base, tache('Envoyer le baromètre', 'à faire', '2026-11-19'), tache('Relancer F-041', 'en cours', null), tache('Classée', 'terminée', '2026-11-01')];
  assert.deepEqual([tuile(aVenir)?.valeur, tuile(aVenir)?.ton, tuile(aVenir)?.vue], [2, null, 'famille:tache'], 'les tâches terminées ne comptent plus');
  // une tâche pour aujourd'hui ou en retard : signalée
  assert.equal(tuile([...aVenir, tache('Commander des panneaux', 'à faire', '2026-11-10')])?.ton, 'attention');
  assert.equal(tuile([...base, tache('Révision du camion', 'bloquée', '2026-11-06')])?.ton, 'attention');
  // toutes terminées : 0 (on sait qu'il n'y a plus rien à faire)
  assert.deepEqual([tuile([...base, tache('Classée', 'terminée', '2026-11-01')])?.valeur, tuile([...base, tache('Classée', 'terminée', '2026-11-01')])?.ton], [0, null]);
});

test('anneau de santé (§4.10) : arc = score × 2π × 52 / 100, paliers, score provisoire sous 50 % de critères', () => {
  const a = A.anneauSante({ score: 51, couverture: 0.8 });
  assert.equal(A.RAYON_ANNEAU, 52);
  assert.ok(Math.abs(a.arc - (51 * 2 * Math.PI * 52) / 100) < 1e-9);
  assert.ok(Math.abs(a.arcCouverture - 0.8 * a.tourCouverture) < 1e-9);
  assert.equal(a.palier?.libelle, 'À surveiller');
  assert.equal(a.aria, 'Santé : 51 sur 100, à surveiller, 80 % des critères renseignés');
  assert.deepEqual([0, 39, 40, 69, 70, 100].map((s) => A.palierSante(s)?.ton), ['critique', 'critique', 'attention', 'attention', 'ok', 'ok']);
  const p = A.anneauSante({ score: 72, couverture: 0.38 });
  assert.ok(p.provisoire);
  assert.equal(p.libelle, 'Score provisoire · 38 % des critères renseignés');
  assert.match(p.aria, /score provisoire/);
  const inconnu = A.anneauSante({ score: null, couverture: 0.1 });
  assert.equal(inconnu.score, null);
  assert.equal(inconnu.arc, 0, 'inconnu ne vaut jamais 0 sur 100 : pas d’arc');
  assert.match(inconnu.aria, /pas encore assez de données/);
  assert.equal(A.cheminArc(0, 52), '');
  assert.equal(A.cheminArc(0.25, 52), 'M 60 8 A 52 52 0 0 1 112.00 60.00', 'part du haut, sens horaire');
  assert.match(A.cheminArc(0.75, 52), / 0 1 1 8\.00 60\.00$/, 'grand arc au-delà de la moitié');
  assert.equal((A.cheminArc(1, 52).match(/A /g) ?? []).length, 2, 'tour complet en deux demi-arcs');
});

test('montants lisibles, jamais les années ni les numéros', () => {
  assert.equal(espaces(A.lisible('Encours : 6800 € (maximum 5000 €)')), 'Encours : 6 800 € (maximum 5 000 €)');
  assert.equal(A.lisible('Contrôle technique : 12/03/2026'), 'Contrôle technique : 12/03/2026');
  assert.equal(A.lisible('Facture F-2026-0412'), 'Facture F-2026-0412');
});

test('prochaine étape (§4.20) : une seule à la fois, celle qui fait le plus avancer, et plus rien quand tout est fait', () => {
  const lieu = { id: 'l1', famille: 'lieu', type: 'siege', nom: 'Atelier', libelleType: 'Siège', champs: [] };
  const vus = { carte: true, sante: true };
  // le monde d'essai, avec un client en bonne et due forme (rôles tels que la passerelle les donne)
  const objets = (monde().objets as { id: string }[]).map((o) => (o.id === 't1' ? { ...o, roles: [{ id: 'client', libelle: 'Client' }] } : o));
  const monde2 = (ajouts: unknown[] = [], o = {}) => monde({ objets: [...objets, ...ajouts], ...o });
  // après les cinq premiers pas, il reste des lieux à poser
  const e1 = A.prochaineEtape(monde2(), vus);
  assert.deepEqual([e1?.id, e1?.bouton, e1?.minutes], ['lieu', 'Ajouter un lieu', 2], 'une étape, avec son geste et sa durée');
  assert.equal(e1?.total, 11, 'les étapes impossibles aujourd’hui ne sont pas comptées (pas de planning sans lieu)');
  assert.ok((e1?.sert ?? '').length > 20 && e1?.sert.endsWith('.'), 'elle dit à quoi ça sert');

  // le lieu posé, la suivante prend sa place ; une étape n'est jamais proposée avant d'avoir un sens
  assert.equal(A.prochaineEtape(monde2([lieu]), vus)?.id, 'planning', 'des personnes et un lieu : on peut dire qui travaille où');
  assert.equal(A.prochaineEtape(monde2([lieu]), { ...vus, planning: true })?.id, 'avis', 'puis le premier avis client');
  // « Pas maintenant » met de côté : la suivante prend sa place, une par une, puis plus rien
  assert.equal(A.prochaineEtape(monde2(), { ...vus, passees: ['lieu'] })?.id, 'avis');
  assert.equal(A.prochaineEtape(monde2(), { ...vus, passees: ['lieu', 'avis'] })?.id, 'invitee');
  assert.equal(A.prochaineEtape(monde2(), TOUT_VU), null, 'tout mis de côté : l’écran se tait');

  // les cinq premiers pas sont les cinq premières étapes : jamais deux fils à la fois
  assert.deepEqual(A.ETAPES_MISE_EN_ROUTE.slice(0, 5).map((e) => e.id), ['nom', 'carte', 'donnees', 'equipe', 'sante']);
  assert.equal(A.prochaineEtape(monde2(), {})?.id, 'carte', 'tant qu’ils ne sont pas faits, c’est le premier pas qui est proposé');
  // ni en démonstration, ni pour qui n'administre pas
  assert.equal(A.prochaineEtape(monde({ demo: true }), vus), null);
  assert.equal(A.prochaineEtape(monde({ admin: false }), vus), null);

  // l'écran : héros quand rien n'est urgent, ligne « Pour aller plus loin » quand une urgence occupe la tête
  const calme = A.planAujourdhui(monde2(), { maintenant: MATIN, vus });
  assert.deepEqual([calme.heros.type, calme.heros.titre, calme.heros.bouton, calme.etape], ['etape', 'Ajouter un lieu de travail', 'Ajouter un lieu', null]);
  assert.match(espaces(calme.heros.texte ?? ''), /Environ 2 minutes\.$/);
  const urgent = A.planAujourdhui(monde2([], { situations: [sit('f1', 'retard_paiement', 'critique')] }), { maintenant: MATIN, vus });
  assert.equal(urgent.heros.objetId, 'f1', 'une urgence passe toujours avant');
  assert.equal(urgent.etape?.id, 'lieu', 'l’étape reste proposée, en seconde ligne');
  // monde vide : « Connecter mes données » porte déjà l'étape, elle n'est pas dite deux fois
  const vide = A.planAujourdhui(monde({ objets: [{ id: 'org', famille: 'organisation', champs: [] }] }), { maintenant: MATIN, vus });
  assert.deepEqual([vide.heros.type, vide.etape], ['connecter', null]);

  // l'écran dessine bien la carte et la ligne, avec « Pas maintenant »
  const app = readFileSync(`${RACINE}web/app.js`, 'utf8');
  assert.match(app, /if \(a\.type === 'etape'\) return faireEtape\(a\.etape\);/);
  assert.match(app, /plan\.etape \? ligneEtape\(plan\.etape, mode\) : null/);
  assert.match(app, /onclick: \(\) => passerEtape\(a\.etape\) \}, 'Pas maintenant'\)/);
});

test('« Premiers pas » (§4.20) : 5 objectifs réels, aucun en démonstration, durée restante accordée', () => {
  assert.equal(A.premiersPas(monde({ demo: true })), null);
  assert.equal(A.premiersPas(monde({ admin: false })), null);
  const p = A.premiersPas(monde(), { carte: true });
  assert.ok(p);
  assert.deepEqual(p.etapes.map((e) => e.id), ['nom', 'carte', 'donnees', 'equipe', 'sante']);
  assert.deepEqual(p.etapes.map((e) => e.fait), [true, true, true, true, false]);
  assert.equal(p.resume, 'Premiers pas · 4 sur 5');
  assert.equal(espaces(p.reste), 'Encore 1 étape, environ 1 minute.');
  const vide = A.premiersPas(monde({ objets: [{ id: 'org', famille: 'organisation', champs: [] }], sante: null }));
  assert.equal(vide?.etapes.find((e) => e.id === 'sante')?.statut, 'Impossible pour l’instant');
  assert.equal(espaces(vide?.reste ?? ''), 'Encore 3 étapes, environ 6 minutes.');
});

test('écran « Aujourd’hui » : héros en premier, « Plus tard » annulable, reste replié dans des <details name>', () => {
  const app = readFileSync(`${RACINE}web/app.js`, 'utf8');
  const contenu = app.slice(app.indexOf('function contenuAujourdhui('), app.indexOf('function rendreMatin()'));
  assert.ok(contenu.indexOf('carteHeros(') < contenu.indexOf('cartePremiersPas(') && contenu.indexOf('carteHeros(') < contenu.indexOf("'À faire ensuite'"), 'la carte héros est le premier élément');
  assert.match(app, /actionAnnulable\(\{ texte: `Reporté à demain/, '« Plus tard » se défait par « Annuler »');
  assert.match(app, /h\('details', \{\s*class: 'bz-repli', name: nom/, '<details name> exclusifs');
  assert.match(app, /ontoggle: \(e\) => \{ if \(e\.currentTarget\.open\) E\.replisOuverts\.add/, 'une section ouverte le reste après une mise à jour en direct');
  assert.match(app, /'bz-bouton bz-bouton--principal', cle: `\$\{id\}-principal`/, 'une seule action principale : celle du héros');
  assert.doesNotMatch(contenu, /bz-bouton--principal/, 'pas d’autre bouton principal dans l’écran');
});

test('créer une tâche en un geste : titre et échéance déjà écrits, aucun écran de contrôle pour qui approuve (G6)', () => {
  const app = readFileSync(`${RACINE}web/app.js`, 'utf8');
  // ce qu'on propose : le titre de la quête ouverte (« Relancer F-041 ») et une échéance à huit jours
  assert.match(app, /function tacheProposee\(objetId\) \{/);
  assert.match(app, /titre: q \? JEU\.titreQuete\(q\.origine\.regle, \[o\.nom\]\) : '',/);
  assert.match(app, /echeance: jourLocal\(new Date\(Date\.now\(\) \+ 7 \* 86_400_000\)\),/);
  assert.match(app, /if \(a\.capacite === 'tache\.creer' && E\.fiche\) Object\.assign\(f\.valeurs, tacheProposee\(E\.fiche\.objet\.id\)\);/, 'le formulaire de la fiche arrive rempli');
  // depuis « Aujourd'hui » : un clic, sans changer d'écran ni ouvrir la fiche
  assert.match(app, /if \(a\.direct === 'tache\.creer' && E\.monde\.profil\.peutApprouver && tacheProposee\(a\.objetId\)\.titre\) return creerTacheDirecte\(a\.objetId\);/);
  const direct = app.slice(app.indexOf('async function creerTacheDirecte('), app.indexOf('const sauverReports ='));
  assert.match(direct, /executer: true/);
  assert.doesNotMatch(direct, /ouvrirSurCarte|changerVue/, 'on reste là où l’on est');
  assert.match(direct, /libelle: 'Voir la tâche'/, 'le toast mène à ce qui vient d’être créé');
  // la liste des priorités passe par le même chemin : un seul comportement pour un même bouton
  assert.match(app, /onclick: \(\) => faireAction\(\{ objetId: o\.id, direct: quete\.actionProposee \}\)/);
  // dans la fiche : un seul bouton pour qui approuve, « Vérifier » gardé pour qui prépare sans approuver
  assert.match(app, /const unGeste = F\.capacite === 'tache\.creer' && E\.monde\.profil\.peutApprouver && !sim;/);
  assert.match(app, /if \(unGeste\) \{ if \(!F\.envoi\) envoyerAction\(f, 0\); return; \}/);
  assert.match(app, /unGeste \? \(F\.envoi \? 'Création…' : 'Créer la tâche'\) : 'Vérifier'/);
  assert.match(app, /if \(titreTache && a\.etat === 'reussie_technique'\) toast\(\{ texte: typo\(`Tâche créée : \$\{titreTache\}\.`\)/);
});
