/**
 * Autres écrans (direction de design §6.1 P8, P9, P10) et nettoyage du §6.4 :
 * - modules purs web/courrier.js, web/satisfaction.js, web/departements.js, web/reseau.js, web/reglages.js, web/jeu.js ;
 * - plus aucune couleur, taille, rayon ni espacement en dur hors jetons, plus d'ancien CSS, plus de symbole Unicode
 *   servant d'icône, plus de « (s) », de capitales d'affichage, de confirm()/prompt()/alert() ;
 * - contrastes des nouveaux composants, en clair et en sombre ; fichiers servis en liste blanche.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrasteJetons, lireJetons, type Theme } from '../../scripts/jetons.ts';
import { fichiersStatiques } from '../passerelle/statiques.ts';
import { NIVEAUX as NIVEAUX_SERVEUR, RECOMPENSE as RECOMPENSE_SERVEUR } from '../core/progression.ts';

const RACINE = fileURLToPath(new URL('../../', import.meta.url));
const lire = (f: string) => readFileSync(RACINE + f, 'utf8');
const charger = async (f: string) => import(new URL(`../../web/${f}`, import.meta.url).href);
const espaces = (t: string) => t.replace(/[  ]/g, ' ');

type Ligne = { id: string; expediteur: string; initiales: string; objet: string; apercu: string; bac: string; urgent: boolean; traite: boolean; recuLe: string | null; destinataire: { id: string; nom: string } | null };
const K = (await charger('courrier.js')) as {
  initiales: (n: string) => string; apercu: (t: string, max?: number) => string; ligne: (o: unknown) => Ligne; lignes: (m: unknown) => Ligne[];
  boite: (l: Ligne[], f?: Record<string, unknown>) => Ligne[]; bacs: (l: Ligne[]) => Array<{ id: string; nb: number; urgents: number; libelle: string }>;
  destinataires: (l: Ligne[]) => Array<{ id: string; nom: string }>; issueBalayage: (dx: number, l: number, o?: { traite?: boolean }) => string | null;
  dateCourte: (iso: string | null, m?: Date) => string; libelleBac: (b: string) => string;
};
const Q = (await charger('satisfaction.js')) as {
  serieMensuelle: (c: unknown, m?: Date, n?: number) => { x: number[]; y: Array<number | null>; n: number[] };
  resumeSerie: (s: unknown) => { vide: boolean; texte: string; variation: number | null; variationTexte?: string };
  lignesSerie: (s: unknown) => Array<{ mois: string; moyenne: number; reponses: number }>;
  tonNote: (n: number | null) => string | null; trierClients: (l: Array<{ id: string; statut: string }>, nomDe: (id: string) => string) => Array<{ id: string }>;
};
const D = (await charger('departements.js')) as {
  STATUTS: string[]; colonnes: (t: unknown[], r?: Set<string>) => Array<{ statut: string; taches: Array<{ id: string }> }>;
  destinations: (t: unknown) => Array<{ statut: string }>; voisine: (s: string, sens: string) => string | null;
  deplacer: (t: unknown[], id: string, s: string) => Array<{ id: string; champs: Array<{ id: string; valeur: unknown }> }>; statutDe: (t: unknown) => string; texteDeplacement: (s: string) => string;
};
const R = (await charger('reseau.js')) as {
  verrou: (d: unknown, a: string) => string; groupes: (o: unknown[]) => Array<{ id: string; liste: unknown[] }>; TYPES_OPP: Array<{ id: string; icone: string }>;
  AVANTAGES: Array<{ capacite: string | null }>; offre: (d: unknown) => string | null;
};
const G = (await charger('reglages.js')) as {
  SECTIONS: Array<{ id: string; libelle: string }>; sectionDe: (p: string) => string | null; pageDemandee: (p: string | null, o?: { enLigne?: boolean }) => string | null;
  sectionsVisibles: (o?: { enLigne?: boolean }) => Array<{ id: string }>; sousPages: (s: string) => Array<{ id: string }>; etapesEnLigne: (f: string) => Array<{ id: string; titre: string }>;
  adressesPour: (f: string, a: Array<{ genre: string }>) => Array<{ genre: string }>; domaine: (s: string) => string | null; FACONS: Array<{ id: string }>;
};
const J = (await charger('jeu.js')) as {
  titreQuete: (r: string, n: string[]) => string; quetesDuJour: (m: unknown, o?: { maintenant?: Date; max?: number }) => Array<{ regle: string; titre: string; faites: number; total: number; xp: number; objets: string[]; preuve: { valeur: number | null; seuil: number | null; source: string | null } }>;
  texteNiveau: (p: unknown) => string; barreXp: (p: unknown) => { pourcentage: number; texte: string; libelle: string } | null;
  aCelebrer: (a: unknown, b: unknown, o?: { maintenant?: Date; fenetreMs?: number }) => { reussites: Array<{ id: string }>; niveau: { n: number } | null };
  texteCelebration: (r: unknown) => string; NIVEAUX: Array<{ n: number; nom: string; xp: number; element: string }>; RECOMPENSE: { critique: number; attention: number };
};

// ---------------------------------------------------------------- courrier
const mail = (id: string, champs: Record<string, unknown>, lien: Record<string, { id: string; nom: string }> = {}) => ({
  id, nom: String(champs.objet ?? id), type: 'courrier', mode: 'demo',
  champs: [...Object.entries(champs).map(([k, v]) => ({ id: k, valeur: v })), ...Object.entries(lien).map(([k, l]) => ({ id: k, valeur: l.id, lien: l }))],
});

test('courrier : boîte classique, urgence montrée seulement si haute, à traiter et urgents d’abord, filtres', () => {
  const m = { objets: [
    mail('a', { expediteur: 'Kerlann Bois', objet: 'Facture 12', resume: 'Relance de la facture', bac: 'paiements', urgence: 'normale', statut: 'à traiter', recu_le: '2026-11-10T08:00:00Z' }, { destinataire: { id: 'p1', nom: 'Anna' } }),
    mail('b', { expediteur: 'Mairie de Quimper', objet: 'Arrêté', bac: 'administratif', urgence: 'haute', statut: 'à traiter', recu_le: '2026-11-09T08:00:00Z' }),
    mail('c', { expediteur: 'compta@negoce.example', objet: 'Avoir', bac: 'paiements', urgence: 'basse', statut: 'traité', recu_le: '2026-11-10T09:00:00Z' }),
    { id: 'x', type: 'article', champs: [] },
  ] };
  const l = K.lignes(m);
  assert.equal(l.length, 3, 'seulement le courrier');
  assert.equal(l.find((x) => x.id === 'a')?.urgent, false, 'urgence normale : pas mise en avant (P2)');
  assert.equal(l.find((x) => x.id === 'b')?.urgent, true);
  assert.deepEqual(K.boite(l).map((x) => x.id), ['b', 'a'], 'traités masqués, urgents d’abord');
  assert.deepEqual(K.boite(l, { traites: true }).map((x) => x.id), ['b', 'a', 'c'], 'traités à la fin');
  assert.deepEqual(K.boite(l, { bac: 'paiements', traites: true }).map((x) => x.id), ['a', 'c']);
  assert.deepEqual(K.boite(l, { pour: 'p1' }).map((x) => x.id), ['a']);
  assert.deepEqual(K.boite(l, { recherche: 'mairie' }).map((x) => x.id), ['b']);
  assert.deepEqual(K.bacs(l).map((b) => [b.id, b.nb, b.urgents]), [['paiements', 1, 0], ['administratif', 1, 1]], 'compteurs : à traiter seulement');
  assert.deepEqual(K.destinataires(l), [{ id: 'p1', nom: 'Anna' }]);
  assert.equal(K.initiales('Kerlann Bois'), 'KB');
  assert.equal(K.initiales('compta@negoce.example'), 'C');
  assert.equal(K.initiales(''), '?');
  assert.equal(K.libelleBac('publicité'), 'Publicité');
  const long = 'mot '.repeat(60);
  assert.ok(K.apercu(long).length <= 141 && K.apercu(long).endsWith('…'), 'aperçu coupé sur un mot');
});

test('courrier : balayage au-delà du seuil seulement, doublé du menu ; dates courtes', () => {
  assert.equal(K.issueBalayage(50, 400), null, 'sous le seuil : rien ne se passe');
  assert.equal(K.issueBalayage(200, 400), 'traiter');
  assert.equal(K.issueBalayage(200, 400, { traite: true }), 'remettre');
  assert.equal(K.issueBalayage(-200, 400), 'deleguer');
  assert.equal(K.issueBalayage(200, 0), null);
  const m = new Date(2026, 10, 10, 15, 0);
  assert.equal(espaces(K.dateCourte(new Date(2026, 10, 10, 9, 5).toISOString(), m)), '9 h 05');
  assert.equal(K.dateCourte(new Date(2026, 10, 9, 9, 5).toISOString(), m), 'hier');
  assert.match(K.dateCourte(new Date(2026, 10, 3, 9, 5).toISOString(), m), /^3 nov/);
  const app = lire('web/app.js');
  assert.match(app, /balayageCourrier\(li, contenu, o, l\)/);
  assert.match(app, /libelle: 'Déléguer à…'/, 'le balayage est doublé du menu « ⋯ » (2.5.7)');
  // le bouton de la rubrique dit ce qu'il fait : aucune boîte mail ne se connecte encore, on colle un mail
  assert.doesNotMatch(app, /Connecter ma boîte mail/, 'plus de bouton qui promet de connecter une boîte mail');
  const courrier = app.slice(app.indexOf('async function rendreCourrier()'), app.indexOf('// ---------------------------------------------------------------- temps réel'));
  assert.doesNotMatch(courrier, /ouvrirAssistant\(/, 'le courrier n’ouvre plus « Où sont vos clients ? »');
  assert.match(courrier, /icone\('clipboard-paste'\), 'Ajouter un courrier'\)/);
  assert.match(courrier, /texte: 'Ajouter un courrier : coller un mail'/, 'le collage n’est plus rangé sous « Mode avancé »');
  assert.match(courrier, /C\.tri\.ouvert = true;\s+await rendreCourrier\(\);\s+const champ = \$\('#courrier-colle'\);[\s\S]{0,80}champ\?\.focus\(\);/, 'le bouton ouvre le collage et y place le curseur (une fois la page redessinée)');
  assert.match(courrier, /Votre boîte mail ne se connecte pas encore directement\./, 'la limite est dite en clair');
  assert.match(courrier, /!toutes\.length \? videRubrique\('courrier', \{ action: peut \? boutonAjouter\('bz-bouton--principal'\) : null \}\)/);
});

// ---------------------------------------------------------------- satisfaction
test('satisfaction : moyenne mensuelle sur 12 mois, un mois sans réponse est un trou (jamais 0), résumé et tableau', () => {
  const clients = {
    c1: { historique: [{ le: '2026-09-04', note: 8 }, { le: '2026-11-02', note: 6 }] },
    c2: { historique: [{ le: '2026-09-20', note: 10 }, { le: '2025-01-01', note: 2 }] },
    c3: { historique: [] },
  };
  const s = Q.serieMensuelle(clients, new Date(Date.UTC(2026, 10, 10)));
  assert.equal(s.x.length, 12);
  assert.equal(s.y.at(-1), 6, 'novembre');
  assert.equal(s.y.at(-2), null, 'octobre : aucune réponse, un trou');
  assert.equal(s.y.at(-3), 9, 'septembre : (8 + 10) / 2');
  assert.ok(!s.y.includes(0), 'jamais 0 pour une absence');
  assert.deepEqual(s.n.slice(-3), [2, 0, 1]);
  const r = Q.resumeSerie(s);
  assert.equal(r.vide, false);
  assert.equal(r.variation, -3);
  assert.match(espaces(r.texte), /6 sur 10 en novembre 2026, sur 3 réponses en 12 mois/);
  assert.equal(Q.lignesSerie(s).length, 2, 'le tableau ne liste que les mois relevés');
  assert.equal(Q.resumeSerie(Q.serieMensuelle({}, new Date())).vide, true);
  assert.equal(Q.tonNote(null), null, 'pas d’avis : aucune couleur');
  assert.deepEqual([Q.tonNote(9), Q.tonNote(7), Q.tonNote(3)], ['ok', 'attention', 'critique']);
  assert.deepEqual(Q.trierClients([{ id: 'b', statut: 'bonne' }, { id: 'a', statut: 'mauvaise' }, { id: 'c', statut: 'inconnue' }], (id) => id).map((c) => c.id), ['a', 'c', 'b'], 'mécontents d’abord');
});

// ---------------------------------------------------------------- départements
test('départements : kanban par statut, « Déplacer vers… », Alt + flèche, déplacement optimiste sans muter l’original', () => {
  const t = (id: string, statut: string | null, echeance: string | null = null) => ({ id, nom: id, champs: [...(statut ? [{ id: 'statut', valeur: statut }] : []), ...(echeance ? [{ id: 'echeance', valeur: echeance }] : [])] });
  const taches = [t('t1', 'en cours'), t('t2', null), t('t3', 'à faire', '2026-11-20'), t('t4', 'à faire', '2026-11-12'), t('t5', 'inconnu')];
  const c = D.colonnes(taches, new Set(['t3']));
  assert.deepEqual(c.map((x) => x.statut), ['à faire', 'en cours', 'bloquée', 'terminée']);
  assert.deepEqual(c[0]?.taches.map((x) => x.id), ['t3', 't4', 't2', 't5'], 'en retard d’abord, puis par échéance ; sans statut ou inconnu : à faire');
  assert.deepEqual(D.destinations(taches[0]).map((x) => x.statut), ['à faire', 'bloquée', 'terminée']);
  assert.equal(D.voisine('à faire', 'gauche'), null);
  assert.equal(D.voisine('à faire', 'droite'), 'en cours');
  assert.equal(D.voisine('terminée', 'droite'), null);
  const apres = D.deplacer(taches, 't2', 'bloquée');
  assert.equal(D.statutDe(apres.find((x) => x.id === 't2')), 'bloquée');
  assert.equal(D.statutDe(taches[1]), 'à faire', 'original intact');
  assert.match(D.texteDeplacement('en cours'), /vers En cours/);
  const app = lire('web/app.js');
  assert.match(app, /ondrop: \(e\) =>/, 'glisser-déposer');
  assert.match(app, /texte: 'Déplacer vers…'/, 'toujours doublé d’un menu');
  assert.doesNotMatch(app, /COULEURS_DEP_CSS|border-top-color:\$\{couleur/, 'plus de liseré de couleur par département');
});

// ---------------------------------------------------------------- Breizhcosystem
test('onglet Breizhcosystem : verrous visibles avant l’action, vitrine, opportunités groupées avec des icônes (plus d’emoji)', () => {
  assert.equal(R.verrou(null, 'repondre'), 'inconnu', 'droits pas encore lus : Breizhcosystem décide');
  assert.equal(R.verrou({ capacites: ['decouvrir'] }, 'repondre'), 'verrouille');
  assert.equal(R.verrou({ capacites: ['repondre_demande_externe'] }, 'repondre'), 'libre');
  assert.equal(R.verrou({ capacites: [] }, 'voir'), 'libre', 'voir un appel d’offres est gratuit');
  assert.equal(R.verrou({ capacites: [] }, 'agent'), 'verrouille');
  assert.deepEqual(R.groupes([{ type: 'stock' }, { type: 'demande' }, { type: 'inconnu' }]).map((g) => g.id), ['demande', 'stock']);
  for (const t of R.TYPES_OPP) assert.match(t.icone, /^[a-z-]+$/, 'icône Lucide');
  assert.ok(R.AVANTAGES.some((a) => a.capacite) && R.AVANTAGES.some((a) => !a.capacite), 'la vitrine dit ce qui est gratuit et ce qui demande ACTIVE');
  assert.equal(R.offre({ plan: 'active' }), 'Breizhcosystem ACTIVE');
  assert.equal(R.offre(null), null);
  assert.doesNotMatch(lire('web/app.js'), /ICONES_OPP = \{ demande: '📣'/);
});

// ---------------------------------------------------------------- Réglages et « Mettre en ligne »
test('réglages : les 12 sections du §6.1 P9 dans l’ordre, anciennes adresses rangées, aucune route perdue', () => {
  assert.deepEqual(G.SECTIONS.map((s) => s.libelle), ['Entreprise', 'Accès et équipe', 'Apparence et accessibilité', 'Clavier', 'Carte', 'Notifications', 'Connecteurs', 'Sauvegardes', 'Mettre en ligne', 'Breizhcosystem', 'Confidentialité', 'À propos']);
  for (const ancienne of ['acces', 'apparence', 'carte', 'reseau', 'en-ligne', 'nexus', 'outils', 'cles', 'sauvegardes', 'alertes']) assert.equal(G.pageDemandee(ancienne), ancienne, `#/reglages:${ancienne} marche toujours`);
  assert.equal(G.sectionDe('cles'), 'outils', 'clés d’API dans Connecteurs (mode avancé)');
  assert.equal(G.sectionDe('reseau'), 'acces');
  assert.equal(G.sectionDe('alertes'), 'notifications', 'Telegram et WhatsApp dans Notifications');
  assert.equal(G.pageDemandee('en-ligne', { enLigne: true }), 'reseau', 'déjà en ligne : réseau');
  assert.equal(G.pageDemandee('inconnue'), null);
  assert.equal(G.pageDemandee(null), null);
  assert.ok(!G.sectionsVisibles({ enLigne: true }).some((s) => s.id === 'en-ligne'));
  assert.deepEqual(G.sousPages('outils').map((p) => p.id), ['outils', 'cles']);
  assert.deepEqual(G.sousPages('notifications').map((p) => p.id), ['notifications', 'alertes']);
  const app = lire('web/app.js');
  const carte = app.slice(app.indexOf('  const R = {\n    entreprise:'), app.indexOf('return (R[page] ?? rendreEntreprise)();'));
  for (const s of [...G.SECTIONS.map((x) => x.id), 'cles', 'reseau', 'alertes']) assert.ok(carte.includes(`${s.includes('-') ? `'${s}'` : s}:`), `page de réglages ${s}`);
});

test('mettre en ligne : assistant en 3 étapes, « Faire installer par Claude » en tête, vérification sur le téléphone', () => {
  assert.equal(G.FACONS[0]?.id, 'claude', 'option « Faire installer par Claude » mise en avant');
  assert.deepEqual(G.etapesEnLigne('tailscale').map((e) => e.id), ['facon', 'installer', 'verifier']);
  assert.equal(G.etapesEnLigne('serveur')[1]?.titre, 'Installer le serveur');
  assert.deepEqual(G.adressesPour('tailscale', [{ genre: 'equipe' }, { genre: 'tailscale' }]).map((a) => a.genre), ['tailscale', 'equipe']);
  assert.deepEqual(G.adressesPour('serveur', [{ genre: 'tailscale' }, { genre: 'equipe' }, { genre: 'en-ligne' }]).map((a) => a.genre), ['en-ligne', 'equipe', 'tailscale']);
  assert.equal(G.domaine('https://Jeu.Kerlann.example/installation'), 'jeu.kerlann.example');
  assert.equal(G.domaine('pas un domaine'), null);
  const app = lire('web/app.js');
  assert.match(app, /Votre Living Business répond bien sur votre/);
  assert.match(app, /'Pour la personne qui installe'/, 'commandes repliées');
  assert.match(app, /api\('POST', '\/en-ligne\/verification'/);
});

// ---------------------------------------------------------------- couche de jeu
const monde = {
  objets: [{ id: 'a1', nom: 'Panneaux (fictifs)' }, { id: 'a2', nom: 'Peinture' }, { id: 'f1', nom: 'Facture 12' }],
  situations: [{ objetId: 'a1', regle: 'stock_minimum', description: 'Stock bas', preuve: { valeur: 6, seuil: 20, source: { libelle: 'Tableur' }, observeLe: '2026-11-10T08:00:00Z' } }],
  quetes: [
    { origine: { regle: 'stock_minimum', objetId: 'a1' }, statut: 'ouverte', gravite: 'attention', objectif: '≥ 20', actionProposee: 'mouvement' },
    { origine: { regle: 'stock_minimum', objetId: 'a2' }, statut: 'ouverte', gravite: 'attention' },
    { origine: { regle: 'stock_minimum', objetId: 'a3' }, statut: 'achevee', gravite: 'attention', acheveeLe: '2026-11-10T07:00:00Z' },
    { origine: { regle: 'stock_minimum', objetId: 'a4' }, statut: 'achevee', gravite: 'attention', acheveeLe: '2026-11-01T07:00:00Z' },
    { origine: { regle: 'retard_paiement', objetId: 'f1' }, statut: 'ouverte', gravite: 'critique' },
  ],
};

test('quêtes du jour : tirées des vraies quêtes ouvertes, titre en verbe, « 1 sur 3 », récompense et preuve', () => {
  const q = J.quetesDuJour(monde, { maintenant: new Date('2026-11-10T12:00:00Z') });
  assert.deepEqual(q.map((x) => x.regle), ['retard_paiement', 'stock_minimum'], 'la plus grave d’abord');
  const stock = q[1];
  assert.equal(espaces(stock?.titre ?? ''), 'Réapprovisionner 2 articles');
  assert.equal(stock?.faites, 1, 'achevée aujourd’hui');
  assert.equal(stock?.total, 3, '1 sur 3');
  assert.equal(stock?.xp, 2 * J.RECOMPENSE.attention);
  assert.deepEqual(stock?.preuve, { description: 'Stock bas', valeur: 6, seuil: 20, source: 'Tableur', observeLe: '2026-11-10T08:00:00Z', objectif: '≥ 20' });
  assert.equal(q[0]?.titre, 'Relancer la facture Facture 12');
  assert.equal(J.titreQuete('stock_minimum', ['Panneaux (fictifs)']), 'Réapprovisionner Panneaux', 'sans la mention de démonstration');
  assert.equal(J.quetesDuJour({ ...monde, quetes: monde.quetes.filter((x) => x.statut !== 'ouverte') }).length, 0, 'rien d’ouvert : aucune quête inventée');
  assert.equal(J.quetesDuJour(monde, { max: 1 }).length, 1);
});

test('XP et niveaux : barème identique au serveur, texte « Niveau 4 · Port de pêche · 320 XP avant le niveau 5 »', () => {
  assert.deepEqual(J.NIVEAUX, NIVEAUX_SERVEUR, 'mêmes niveaux que core/progression.ts');
  assert.deepEqual(J.RECOMPENSE, RECOMPENSE_SERVEUR);
  const p = { xp: 380, niveau: { n: 4, nom: 'Port de pêche' }, suivant: { n: 5, reste: 320 }, avancement: 0.4 };
  assert.equal(espaces(J.texteNiveau(p)), 'Niveau 4 · Port de pêche · 320 XP avant le niveau 5');
  assert.equal(J.barreXp(p)?.pourcentage, 40);
  assert.match(J.barreXp(p)?.libelle ?? '', /niveau 4 sur 10/);
  assert.equal(J.texteNiveau({ ...p, niveau: { n: 10, nom: 'Port de commerce' }, suivant: null }), 'Niveau 10 · Port de commerce · niveau maximal');
});

test('célébration : seulement une réussite récente et nouvelle ; jamais en mode Calme ni pendant une saisie', () => {
  const r = (id: string, le: string) => ({ id, le, regle: 'stock_minimum', nom: 'Panneaux', xp: 40 });
  const avant = { niveau: { n: 1 }, exemple: true, reussites: [r('a', '2026-11-10T09:00:00Z')] };
  const apres = { niveau: { n: 2, nom: 'Quai' }, exemple: true, reussites: [r('a', '2026-11-10T09:00:00Z'), r('b', '2026-11-10T11:58:00Z'), r('c', '2026-11-09T11:58:00Z')] };
  const c = J.aCelebrer(avant, apres, { maintenant: new Date('2026-11-10T12:00:00Z') });
  assert.deepEqual(c.reussites.map((x) => x.id), ['b'], 'une réussite d’hier ne se fête pas au rechargement');
  assert.equal(c.niveau?.n, 2);
  assert.deepEqual(J.aCelebrer(null, apres).reussites, [], 'premier chargement : rien');
  assert.equal(J.texteCelebration(r('b', '')), 'Quête terminée : Réapprovisionner Panneaux · +40 XP');
  const app = lire('web/app.js');
  assert.match(app, /if \(modeCalme\(\) \|\| !avant \|\| !apres\) return;/, 'jamais en mode Calme');
  assert.match(app, /const saisie = Boolean\(E\.edition\)/, 'jamais pendant une saisie');
  assert.match(app, /ton: 'celebration'/);
  assert.match(lire('web/bz/toasts.js'), /celebration: 'party-popper'/);
  const scene = lire('web/scene.js');
  assert.match(scene, /celebrer\(\{ niveau \} = \{\}\)/);
  assert.match(scene, /if \(mouvementReduit\(\) \|\| !animations\)/, 'mouvement réduit : l’état final, sans animation');
  assert.match(scene, /function elementNiveau\(n\)/, 'chaque niveau pose un élément du décor (§5.9)');
});

// ---------------------------------------------------------------- §6.4 : à supprimer
function valeursEnDur(texte: string, css: boolean): string[] {
  const sansCommentaires = texte.replace(/\/\*[\s\S]*?\*\//g, '').replace(css ? /$^/ : /(^|[^:'"`])\/\/.*$/gm, '$1');
  const fautes: string[] = [];
  for (const m of sansCommentaires.matchAll(/#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color)\(/g)) fautes.push(m[0]);
  for (const m of sansCommentaires.matchAll(/(?<![\w.$-])(\d*\.?\d+)px\b/g)) if (!['0', '1', '2'].includes(m[1] as string)) fautes.push(m[0]);
  return fautes;
}
const fichiersWeb = () => [
  ...readdirSync(RACINE + 'web').filter((f) => /\.(js|css)$/.test(f)).map((f) => `web/${f}`),
  ...readdirSync(RACINE + 'web/carte').filter((f) => f.endsWith('.js')).map((f) => `web/carte/${f}`),
];

test('§6.4 : plus aucune couleur ni taille codée en dur hors des jetons, dans tout le CSS et le JS du jeu', () => {
  const fautes = fichiersWeb().flatMap((f) => valeursEnDur(lire(f), f.endsWith('.css')).map((v) => `${f} : ${v}`));
  assert.deepEqual(fautes, []);
  for (const f of readdirSync(RACINE + 'web').filter((x) => x.endsWith('.html'))) {
    const t = lire(`web/${f}`).replace(/<meta name="theme-color" content="#[0-9a-f]{6}"[^>]*>/g, ''); // la barre du navigateur ne lit pas les variables CSS
    assert.deepEqual(valeursEnDur(t, true), [], f);
    assert.doesNotMatch(t, /<style|style=/, `${f} : aucun style en ligne`);
  }
});

test('§6.4 : plus d’ancien CSS (une seule feuille de coque, sans classe héritée), plus de liseré décoratif', () => {
  const style = lire('web/style.css');
  for (const ancien of ['.bouton-cta', '.bouton-noir', '.btn-jaune', '.titre-section', '.modale-tete', '.entete-matin', '.conteneur-page', '.mini-badge', '.calques', '.interrupteur', '.carte-choix', '.jauge', '.note', '.bouton.danger', '.tuile', '.kanban', '.mail', '.voile']) {
    assert.ok(!style.includes(`${ancien} `) && !style.includes(`${ancien}{`) && !style.includes(`${ancien},`), `ancienne règle ${ancien}`);
  }
  assert.doesNotMatch(style, /border-(left|top): [3-6]px/, 'plus de liseré coloré');
  assert.ok(style.length < 9000, 'feuille de coque réduite à la structure');
  const classes = new Set();
  for (const f of fichiersWeb().filter((x) => x.endsWith('.js') && !/formulaire|telephone/.test(x))) {
    for (const m of lire(f).matchAll(/class: '([^']+)'/g)) for (const c of (m[1] as string).split(/\s+/)) if (!c.startsWith('bz-')) classes.add(c);
  }
  const coque = ['zone', 'scene', 'page', 'infobulle', 'hud', 'carte-instantanee', 'hud-reseau', 'bascule-vue', 'hud-afficher', 'camera-feuille', 'hud-haut', 'commandes-carte', 'hud-droite', 'hud-minicarte-ouvrir', 'hud-bas', 'hud-aujourdhui'];
  assert.deepEqual([...classes].filter((c) => !coque.includes(c as string)), [], 'toute autre classe est un composant bz-*');
  for (const c of coque) assert.ok(style.includes(`.${c}`) || ['bascule-vue'].includes(c), `.${c} reste stylée par la coque`);
});

test('§6.4 : plus de symbole Unicode ni d’emoji servant d’icône, plus de « (s) », de capitales d’affichage, de confirm()', () => {
  const ICONES_TEXTE = /[✓✕✗✉＋↗⬇⤓⚠▲▼■▾▸⇅⌕⟲⟳⌂⚙▣❚✦🎉🤖📣🔎📦👷🏛🤝🏁📱👤]/u;
  for (const f of fichiersWeb().filter((x) => x.endsWith('.js'))) {
    const code = lire(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const m = ICONES_TEXTE.exec(code);
    assert.equal(m, null, `${f} : symbole « ${m?.[0]} » servant d’icône`);
    assert.doesNotMatch(code, /\p{L}\(s\)(?: \p{L}|['`»])/u, `${f} : pluriel « (s) » dans un texte`);
    assert.doesNotMatch(code, /(?<![.\w])(window\.)?(confirm|prompt|alert)\(/, `${f} : confirm(), prompt() ou alert()`);
  }
  const app = lire('web/app.js');
  const capitales = [...app.matchAll(/toUpperCase\(\)/g)].length;
  assert.ok(capitales <= 4, `toUpperCase() réservé aux initiales et au département saisi (${capitales})`);
  assert.doesNotMatch(app, /texte: '(COURRIER|SATISFACTION|OPTIMISER|DÉPARTEMENTS|SAUVEGARDES|METTRE EN LIGNE|RÉGLAGES|MON COMPTE)'/, 'plus de titres en capitales');
  assert.doesNotMatch(app, /Réglages → /, 'chemin de menu écrit avec ›');
});

// ---------------------------------------------------------------- contrastes et liste blanche
test('contrastes des nouveaux composants (XP, quêtes, propositions, kanban, balayage), en clair et en sombre', () => {
  const j = lireJetons(lire('web/bz/tokens.css'));
  const paires: Array<[string, string, number, string]> = [
    ['--bz-xp-remplissage', '--bz-xp-piste', 3, 'or de la barre d’XP sur sa piste'],
    ['--bz-sur-accent', '--bz-accent', 4.5, 'icône de célébration, marque des niveaux et trophées obtenus'],
    ['--bz-texte', '--bz-accent-doux', 4.5, 'badge « +40 XP »'],
    ['--bz-proposition-bord', '--bz-surface', 3, 'pointillés d’une proposition à valider'],
    ['--bz-etat-indicateur', '--bz-marque-doux', 3, 'colonne survolée, section courante des réglages'],
    ['--bz-ok-texte', '--bz-ok-fond', 4.5, 'balayage « Traité »'],
    ['--bz-texte-2', '--bz-fond-2', 4.5, 'texte des colonnes du kanban et des trophées à venir'],
    ['--bz-critique-trait', '--bz-surface', 3, 'segment « bloquée »'],
    ['--bz-ok-trait', '--bz-surface', 3, 'segment « terminée »'],
    ['--bz-info-trait', '--bz-surface', 3, 'segment « en cours »'],
  ];
  const echecs: string[] = [];
  for (const theme of ['clair', 'sombre'] as Theme[]) {
    for (const [a, f, seuil, quoi] of paires) {
      const r = contrasteJetons(j, theme, a, f);
      if (r < seuil) echecs.push(`${theme} : ${quoi} (${a} sur ${f}) = ${r.toFixed(2)} < ${seuil}`);
    }
  }
  assert.deepEqual(echecs, []);
});

test('liste blanche : les nouveaux modules sont servis, aucun chemin construit depuis l’URL', () => {
  const s = fichiersStatiques();
  for (const c of ['/jeu.js', '/courrier.js', '/reglages.js', '/reseau.js', '/satisfaction.js', '/departements.js', '/telephone.html', '/telephone.js', '/style.css']) {
    const f = s.get(c);
    assert.ok(f, `${c} servi`);
    assert.match(f.type, c.endsWith('.js') ? /text\/javascript/ : c.endsWith('.css') ? /text\/css/ : /text\/html/);
  }
  for (const c of ['/jeu.ts', '/../web/jeu.js', '/%2e%2e/package.json', '/JEU.js', '/web/jeu.js']) assert.equal(s.get(c), undefined, c);
});
