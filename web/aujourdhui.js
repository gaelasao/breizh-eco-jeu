/* Living Business — « Aujourd'hui », qui remplace « Ce matin » (direction de design §6.1 P2, §4.8, §4.9, §4.10, §4.20).
   Module PUR (aucun accès au DOM ni au stockage), testé par src/ds/aujourdhui.test.ts. Il décide QUOI montrer :
   (1) la chose à faire maintenant (carte héros), (2) une pile de 3 à 5 actions, (3) une rangée de tuiles homogènes
   (des choses à régler, jamais un total) et l'anneau de santé ; le reste est replié par app.js.
   « Plus tard » renvoie une action au lendemain : reports = { clé: 'AAAA-MM-JJ' (jour où elle revient) }. */
import { nombre, pluriel } from './bz/typo.js';
import { sansDemo, tacheDue, tachesOuvertes } from './navigation.js';
import { viaEnClair } from './reglages.js';

export const ACTIONS_MAX = 5;      // pile de 3 à 5 actions (§6.1 P2)
export const ACTIONS_PANNEAU = 3;  // panneau posé sur la carte, sur ordinateur (§5.6)

const deux = (n) => String(n).padStart(2, '0');
/** Jour local au format AAAA-MM-JJ (comparable comme une chaîne). */
export const jourLocal = (d = new Date()) => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
/** Lendemain d'un jour AAAA-MM-JJ. */
export function lendemain(jour) {
  const [a, m, j] = jour.split('-').map(Number);
  return jourLocal(new Date(a, m - 1, j + 1));
}

export const cleSituation = (s) => `situation:${s.objetId}:${s.regle ?? ''}`;
export const cleAttente = (a) => `attente:${a.cle}`;
/** Une action reportée revient le jour noté : elle est cachée tant qu'on n'y est pas. */
export const estReportee = (reports, cle, aujourdhui) => typeof reports?.[cle] === 'string' && reports[cle] > aujourdhui;
/** Reports encore utiles (les échus sont oubliés). */
export const reportsValides = (reports, aujourdhui) => Object.fromEntries(Object.entries(reports ?? {}).filter(([, j]) => typeof j === 'string' && j > aujourdhui));

/** Montants bruts des descriptions mis en forme : « 6800 € » → « 6 800 € » (jamais une année ni un numéro). */
export const lisible = (texte) => String(texte ?? '').replace(/\d{4,}(?:[.,]\d+)?(?=\s?€)/g, (n) => nombre(Number(n.replace(',', '.'))));

export const ICONE_TON = Object.freeze({ critique: 'octagon-alert', attention: 'triangle-alert', info: 'info', ok: 'circle-check' });
const RANG = { critique: 0, attente: 1, attention: 2, info: 3 };
const tonDe = (g) => (g === 'critique' ? 'critique' : g === 'attention' ? 'attention' : 'info');

const champ = (o, id) => o?.champs?.find((c) => c.id === id)?.valeur ?? null;
/** « 15 nov. » pour une date AAAA-MM-JJ. */
const jourCourt = (iso) => { const [a, m, j] = String(iso).slice(0, 10).split('-').map(Number); return new Date(a, m - 1, j).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }); };

/**
 * Ce qui est déjà lancé pour un objet : ses tâches ouvertes (champ « concerne »), la plus proche d'abord.
 * → { tacheId, titre, echeance, responsable, nombre, texte } ou null. C'est ce qui fait passer une situation de
 * « à faire » à « en cours » : on a agi, il reste à attendre que la donnée le prouve (facture payée, stock remonté…).
 */
export function suiviDe(objetId, m) {
  if (!objetId) return null;
  const taches = tachesOuvertes(m).filter((t) => champ(t, 'concerne') === objetId && t.id !== objetId)
    .sort((x, y) => String(champ(x, 'echeance') ?? '9999').localeCompare(String(champ(y, 'echeance') ?? '9999')));
  const t = taches[0];
  if (!t) return null;
  const echeance = typeof champ(t, 'echeance') === 'string' ? champ(t, 'echeance').slice(0, 10) : null;
  const personne = (m.objets ?? []).find((o) => o.id === champ(t, 'responsable'));
  const responsable = personne ? sansDemo(personne.nom) : null;
  const titre = sansDemo(t.nom);
  const texte = `${taches.length > 1 ? `${pluriel(taches.length, 'tâche', 'tâches')} en cours, dont : ` : 'Tâche en cours : '}${titre}${echeance ? `, pour le ${jourCourt(echeance)}` : ''}${responsable ? `, confiée à ${responsable}` : ''}.`;
  return { tacheId: t.id, titre, echeance, responsable, nombre: taches.length, texte };
}

function actionDeSituation(s, o, m) {
  const ton = tonDe(s.gravite);
  const quete = o && m.profil?.peutPreparer ? (m.quetes ?? []).find((q) => q.origine?.objetId === o.id && q.statut === 'ouverte') : null;
  const base = {
    cle: cleSituation(s), type: 'situation', ton, icone: ICONE_TON[ton], rang: RANG[ton],
    objetId: s.objetId, titre: o ? sansDemo(o.nom) : 'Situation à régler', texte: lisible(s.description),
    contexte: o?.libelleType ?? '',
    preuve: { source: s.preuve?.source?.libelle ?? '', le: s.preuve?.observeLe ?? null, fraicheur: s.preuve?.fraicheur ?? 'inconnue' },
  };
  // déjà prise en charge : on ne redemande pas « Créer une tâche », on montre la tâche et on attend le résultat
  const suivi = s.statut === 'ouverte' ? suiviDe(s.objetId, m) : null;
  if (suivi) return { ...base, suivi, direct: null, bouton: 'Voir la tâche' };
  return {
    ...base,
    direct: quete?.actionProposee ?? null,
    bouton: quete ? (quete.actionProposee === 'mouvement' ? 'Enregistrer un mouvement' : 'Créer une tâche') : 'Ouvrir la fiche',
  };
}

function actionDAttente(a, m) {
  return {
    cle: cleAttente(a), type: 'attente', ton: 'attention', icone: 'circle-check', rang: RANG.attente,
    objetId: a.cibleNom ? (a.cible ?? null) : null, titre: `${{ mouvement: 'Mouvement', 'objet.modifier': 'Modification' }[a.capacite] ?? 'Tâche'} à approuver`, texte: sansDemo(a.cibleNom ?? ''),
    // demande d'un agent d'IA ou d'un script (clé d'API) : dit en clair, la personne sait qui propose avant d'approuver
    contexte: a.via ? `Demandée par ${viaEnClair(a.via)}, en attente d’approbation` : 'En attente d’approbation', attente: a.cle, demande: a,
    bouton: m.profil?.peutApprouver ? 'Approuver et exécuter' : null,
  };
}

/**
 * Plan de l'écran : planAujourdhui(monde, { reports, maintenant, filtre }) →
 * { heros, pile (≤ 5), autres, enCours, reportees, aVerifier, aFaire, vide, sansSource, actionsReelles }.
 * Ordre : critique, puis à approuver, puis attention, puis information ; à gravité égale, l'ordre du serveur.
 * enCours : situations ouvertes déjà prises en charge par une tâche. Elles quittent « À faire maintenant », la pile
 * et le compteur (aFaire) : l'écran prend acte de ce qui a été fait, et ne le redemande pas.
 */
export function planAujourdhui(m, { reports = {}, maintenant = new Date(), filtre = () => true } = {}) {
  const jour = jourLocal(maintenant);
  const objets = m.objets ?? [];
  const objet = (id) => objets.find((o) => o.id === id);
  const demo = Boolean(m.organisation?.demo);
  const admin = Boolean(m.profil?.peutAdministrer);
  const vide = !objets.some((o) => o.famille !== 'organisation');
  const sansSource = demo || vide;
  const sits = (m.situations ?? []).filter((s) => { const o = objet(s.objetId); return !o || filtre(o); });
  const parRang = (liste) => liste.map((a, i) => ({ ...a, i })).sort((a, b) => a.rang - b.rang || a.i - b.i);
  const ouvertes = sits.filter((s) => s.statut === 'ouverte').map((s) => actionDeSituation(s, objet(s.objetId), m));
  const enCours = parRang(ouvertes.filter((a) => a.suivi));
  const candidates = parRang([
    ...ouvertes.filter((a) => !a.suivi),
    ...(m.actionsEnAttente ?? []).map((a) => actionDAttente(a, m)),
  ]);
  const visibles = candidates.filter((a) => !estReportee(reports, a.cle, jour));
  const reportees = candidates.filter((a) => estReportee(reports, a.cle, jour)).map((a) => ({ ...a, revient: reports[a.cle] }));
  // « Connecter mes données » : première action tant qu'aucune source réelle n'est connectée (§4.1, §5.6)
  const connecter = admin && sansSource ? {
    cle: 'connecter', type: 'connecter', ton: 'info', icone: 'plug', titre: 'Connecter mes données',
    texte: vide ? 'Votre carte est vide. Connectez un fichier ou un logiciel : elle se remplit toute seule.' : 'Remplacez l’exemple par votre entreprise : un tableau copié-collé, un fichier CSV, Google Sheets ou un logiciel.',
    bouton: 'Connecter mes données',
  } : null;
  let heros;
  if (vide && connecter) heros = connecter;
  else if (visibles.length) heros = visibles[0];
  else {
    heros = {
      cle: 'rien', type: 'rien', ton: 'ok', icone: ICONE_TON.ok, titre: enCours.length ? 'Tout est pris en charge.' : 'Rien d’urgent aujourd’hui.',
      texte: enCours.length
        ? `${pluriel(enCours.length, 'action est en cours', 'actions sont en cours')} : il reste à attendre le résultat.${m.sante ? ' Profitez-en pour compléter votre santé.' : ''}`
        : m.sante ? 'Profitez-en pour compléter votre santé.' : 'Tout suit son cours.',
      bouton: m.sante ? 'Voir ma santé' : null,
    };
  }
  const suite = [...(connecter && heros !== connecter ? [connecter] : []), ...visibles.filter((a) => a !== heros)];
  return {
    heros,
    pile: suite.slice(0, ACTIONS_MAX),
    autres: suite.slice(ACTIONS_MAX),
    enCours,
    reportees,
    aVerifier: sits.filter((s) => s.statut !== 'ouverte').map((s) => ({ ...actionDeSituation(s, objet(s.objetId), m), ton: 'info', icone: ICONE_TON.info, verifier: true })),
    aFaire: visibles.length,
    actionsReelles: visibles.length > 0,
    vide, sansSource,
  };
}

/**
 * Tuiles d'« Aujourd'hui » (§4.9) : une seule nature de chiffre, des choses à régler. Valeur inconnue (aucune donnée
 * de ce type) : null, affichée « — » avec « Pas encore renseigné », jamais 0.
 */
export function tuilesARegler(m, { filtre = () => true, maintenant = new Date() } = {}) {
  const objets = m.objets ?? [];
  const objet = (id) => objets.find((o) => o.id === id);
  const valeurDe = (o, id) => o.champs?.find((c) => c.id === id)?.valeur ?? null;
  const ouvertes = (m.situations ?? []).filter((s) => s.statut === 'ouverte' && (!objet(s.objetId) || filtre(objet(s.objetId))));
  const par = (pred) => ouvertes.filter((s) => { const o = objet(s.objetId); return o && pred(o, s); });
  const existe = (pred) => objets.some(pred);
  const ton = (liste) => (liste.some((s) => s.gravite === 'critique') ? 'critique' : liste.length ? 'attention' : null);
  const tuile = (cle, libelle, connu, liste, vue) => ({ cle, libelle, valeur: connu ? liste.length : null, ton: connu ? ton(liste) : null, vue });
  const urgents = objets.filter((o) => o.type === 'courrier' && valeurDe(o, 'statut') !== 'traité' && valeurDe(o, 'urgence') === 'haute' && filtre(o));
  const trous = m.planning ? (m.planning.trousAujourdhui ?? 0) : null;
  // tâches encore à faire (les vôtres et celles que les automatisations préparent) ; signalées dès qu'une est due
  const taches = tachesOuvertes(m).filter(filtre);
  return [
    tuile('factures', 'Factures et commandes en retard', existe((o) => o.famille === 'commande'), par((o) => o.famille === 'commande'), 'famille:commande'),
    tuile('stock', 'Stock et matériel à traiter', existe((o) => o.famille === 'ressource'), par((o) => o.famille === 'ressource'), 'famille:ressource'),
    tuile('clients', 'Clients à surveiller', existe((o) => o.famille === 'tiers'), par((o) => o.famille === 'tiers'), 'role:client'),
    tuile('documents', 'Documents à renouveler', existe((o) => o.type === 'document'), par((_, s) => s.regle === 'document_expire'), 'type:document'),
    { cle: 'courrier', libelle: 'Courriers urgents', valeur: existe((o) => o.type === 'courrier') ? urgents.length : null, ton: urgents.length ? 'critique' : null, vue: 'courrier' },
    { cle: 'planning', libelle: 'Trous au planning aujourd’hui', valeur: trous, ton: trous ? 'attention' : null, vue: 'planning' },
    { cle: 'taches', libelle: 'Tâches à faire', valeur: existe((o) => o.famille === 'tache') ? taches.length : null, ton: taches.some((o) => tacheDue(o, maintenant)) ? 'attention' : null, vue: 'famille:tache' },
  ];
}

/** Paliers de l'anneau de santé (§4.10, à valider avec le produit). */
export const PALIERS_SANTE = Object.freeze([
  { min: 0, max: 39, libelle: 'Fragile', ton: 'critique', icone: 'octagon-alert' },
  { min: 40, max: 69, libelle: 'À surveiller', ton: 'attention', icone: 'triangle-alert' },
  { min: 70, max: 100, libelle: 'Solide', ton: 'ok', icone: 'circle-check' },
]);
export const palierSante = (score) => (typeof score === 'number' ? PALIERS_SANTE.find((p) => Math.round(score) <= p.max) ?? PALIERS_SANTE[2] : null);

export const RAYON_ANNEAU = 52;      // arc du score, trait 10, dans un viewBox de 120
export const RAYON_COUVERTURE = 58;  // anneau fin de la couverture, trait 3

/**
 * Chemin SVG d'un arc qui part du haut (−90°) et tourne dans le sens horaire, pour une part de 0 à 1 du tour.
 * Un chemin plutôt qu'un cercle à stroke-dasharray : le score provisoire se dessine en pointillés (§4.10).
 */
export function cheminArc(part, rayon, centre = 60) {
  const p = Math.max(0, Math.min(1, Number(part) || 0));
  if (p <= 0) return '';
  const haut = `M ${centre} ${centre - rayon}`;
  if (p >= 1) return `${haut} A ${rayon} ${rayon} 0 1 1 ${centre} ${centre + rayon} A ${rayon} ${rayon} 0 1 1 ${centre} ${centre - rayon}`;
  const angle = p * 2 * Math.PI;
  const x = (centre + rayon * Math.sin(angle)).toFixed(2);
  const y = (centre - rayon * Math.cos(angle)).toFixed(2);
  return `${haut} A ${rayon} ${rayon} 0 ${p > 0.5 ? 1 : 0} 1 ${x} ${y}`;
}

/**
 * Géométrie et textes de l'anneau de santé (§4.10). Le score est toujours écrit en clair ; sous 50 % de critères
 * renseignés, il est provisoire (arc en pointillés). Couverture : part pondérée des critères mesurés (0 à 1).
 */
export function anneauSante(sante) {
  const score = typeof sante?.score === 'number' ? Math.max(0, Math.min(100, Math.round(sante.score))) : null;
  const couverture = Math.max(0, Math.min(1, Number(sante?.couverture) || 0));
  const tour = 2 * Math.PI * RAYON_ANNEAU;
  const tourCouverture = 2 * Math.PI * RAYON_COUVERTURE;
  const palier = palierSante(score);
  const part = Math.round(couverture * 100);
  const provisoire = score !== null && couverture < 0.5;
  const libelle = score === null ? 'Pas encore assez de données' : provisoire ? `Score provisoire · ${part} % des critères renseignés` : palier.libelle;
  const aria = score === null
    ? `Santé : pas encore assez de données, ${part} % des critères renseignés`
    : `Santé : ${score} sur 100, ${palier.libelle.toLowerCase()}${provisoire ? ', score provisoire' : ''}, ${part} % des critères renseignés`;
  return {
    score, couverture, part, provisoire, palier, ton: palier?.ton ?? null, libelle, aria,
    arc: score === null ? 0 : (score * tour) / 100, tour,
    arcCouverture: couverture * tourCouverture, tourCouverture,
  };
}

/** Durées estimées des « Premiers pas », en minutes. */
const DUREES = { nom: 1, carte: 1, donnees: 3, equipe: 2, sante: 1 };

/**
 * « Premiers pas » (§4.20) : 5 objectifs réels, faisables dans n'importe quel ordre. null en démonstration et pour
 * les profils qui n'administrent pas. vus : { carte, sante } (gardés sur cet appareil par app.js).
 */
export function premiersPas(m, { carte = false, sante = false } = {}) {
  if (m.organisation?.demo || !m.profil?.peutAdministrer) return null;
  const reelles = (m.objets ?? []).filter((o) => o.famille !== 'organisation');
  const etapes = [
    { id: 'nom', titre: 'Nommer mon entreprise', fait: Boolean(m.organisation?.nom) },
    { id: 'carte', titre: 'Découvrir ma carte', fait: Boolean(carte) },
    { id: 'donnees', titre: 'Connecter mes données', fait: (m.synchro?.actifs ?? 0) > 0 || reelles.some((o) => ['tiers', 'ressource', 'commande'].includes(o.famille)) },
    { id: 'equipe', titre: 'Ajouter mon équipe', fait: reelles.some((o) => o.famille === 'personne') },
    { id: 'sante', titre: 'Voir ma santé', fait: Boolean(sante) && Boolean(m.sante), impossible: !m.sante },
  ].map((e) => ({ ...e, minutes: DUREES[e.id], statut: e.fait ? 'Terminé' : e.impossible ? 'Impossible pour l’instant' : 'À faire' }));
  const faites = etapes.filter((e) => e.fait).length;
  const reste = etapes.filter((e) => !e.fait && !e.impossible);
  const minutes = reste.reduce((n, e) => n + e.minutes, 0);
  return {
    etapes, faites, total: etapes.length, fini: faites === etapes.length || !reste.length,
    resume: `Premiers pas · ${faites} sur ${etapes.length}`,
    reste: reste.length ? `Encore ${pluriel(reste.length, 'étape', 'étapes')}, environ ${pluriel(minutes, 'minute', 'minutes')}.` : '',
  };
}
