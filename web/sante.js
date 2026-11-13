/* Living Business — page Santé (direction de design §6.1 P6, §4.10, §4.22).
   Module PUR (aucun accès au DOM ni au stockage), testé par src/ds/sante.test.ts. Il décide QUOI montrer :
   (1) la vue d'ensemble : anneau de 160 px, palier, « Pas une notation de crédit » ;
   (2) la tendance sur 90 jours (série pour uPlot, résumé en texte, tableau équivalent) ;
   (3) 3 priorités, chacune avec son action directe (« Importer le FEC », « Connecter mes données »…) ;
   (4) une page par domaine : critères groupés par statut, barres à étiquettes directes et tableau équivalent.
   Une donnée absente ne vaut jamais zéro : le critère est « Pas encore renseigné », la courbe a un trou. */
import { nombre, pluriel } from './bz/typo.js';
import { palierSante } from './aujourdhui.js';

/** Domaines : icône Lucide (plus d'emoji, §2.5) et libellé en casse de phrase. */
export const DOMAINES = Object.freeze({
  finances: { libelle: 'Finances', icone: 'euro' },
  commercial: { libelle: 'Commercial et clients', icone: 'handshake' },
  operations: { libelle: 'Opérations', icone: 'cog' },
  social: { libelle: 'Équipe', icone: 'users' },
  gestion: { libelle: 'Gestion', icone: 'folder' },
  automatisation: { libelle: 'Outils et automatisation', icone: 'zap' },
});
export const libelleDomaine = (d) => DOMAINES[d?.id ?? d]?.libelle ?? String(d?.libelle ?? d ?? '');

/** Groupes de critères, dans l'ordre de lecture : ce qui demande d'agir d'abord. */
export const STATUTS = Object.freeze([
  { id: 'faible', titre: 'À corriger', ton: 'critique', icone: 'octagon-alert' },
  { id: 'moyen', titre: 'À surveiller', ton: 'attention', icone: 'triangle-alert' },
  { id: 'bon', titre: 'Bon', ton: 'ok', icone: 'circle-check' },
  // une pratique pas encore lancée sur une entreprise toute neuve : ni note, ni reproche
  { id: 'a_lancer', titre: 'À lancer', ton: null, icone: 'flag' },
  { id: 'inconnu', titre: 'Pas encore renseigné', ton: null, icone: 'circle-dashed' },
]);
export const statutDe = (id) => STATUTS.find((s) => s.id === id) ?? STATUTS.at(-1);
/** Groupe d'un critère : « À lancer » pour une pratique que l'entreprise n'a pas encore commencée. */
export const groupeDeCritere = (c) => (c?.aLancer ? 'a_lancer' : c?.statut ?? 'inconnu');

const FINANCES_COMPTA = new Set(['tresorerie', 'marge_brute', 'rentabilite', 'delai_clients', 'endettement']);

/**
 * Action directe d'un critère. cible : 'fec' (import de la comptabilité), 'connecter' (assistant « Connecter mes
 * données »), 'chiffres' (chiffres clés de la page), ou 'vue:<vue>' (écran existant). null si rien d'utile à proposer.
 * ctx : { admin, demo }. Les actions d'administration ne sont proposées qu'aux administrateurs, hors exemple.
 */
export function actionCritere(c, { admin = false, demo = false } = {}) {
  const gerer = admin && !demo;
  const inconnu = c?.statut === 'inconnu' || c?.score === null || c?.score === undefined;
  const vue = (v, libelle) => ({ libelle, cible: `vue:${v}` });
  if (FINANCES_COMPTA.has(c?.id)) {
    if (inconnu) return gerer ? { libelle: 'Importer le FEC', cible: 'fec' } : null;
    if (c.id === 'tresorerie' || c.id === 'delai_clients') return vue('type:facture', 'Voir les factures');
    if (c.id === 'endettement') return gerer ? { libelle: 'Mettre à jour mes chiffres', cible: 'chiffres' } : null;
    return vue('optimiser', 'Voir les pistes d’économie');
  }
  switch (c?.id) {
    case 'retards_clients': return vue('optimiser', 'Activer les relances');
    case 'retard_moyen': case 'impayes_anciens': return vue('type:facture', 'Voir les factures en retard');
    case 'encours_depasses': case 'contacts': return vue('role:client', 'Voir les clients');
    case 'fournisseurs_payes': return vue('type:facture', 'Voir les factures');
    case 'tendance_ventes': case 'transformation_devis': case 'devis_sans_reponse': return vue('type:devis', 'Voir les devis');
    case 'satisfaction': case 'recommandation': case 'clients_ecoutes': return vue('satisfaction', 'Envoyer les formulaires');
    case 'carnet_commandes': case 'livraisons_clients': case 'livraisons_fournisseurs': case 'dependance_fournisseur': return vue('famille:commande', 'Voir les commandes');
    case 'dependance_client': return vue('role:client', 'Voir les clients');
    case 'prospection': return vue('role:prospect', 'Voir les prospects');
    case 'ruptures': return vue('famille:ressource', 'Voir le stock');
    case 'vehicules': case 'equipements': return vue('famille:ressource', 'Voir le matériel');
    case 'taches_retard': case 'taches_bloquees': case 'taches_attribuees': return vue('famille:tache', 'Voir les tâches');
    case 'climat': case 'charge_tenable': case 'participation': return vue('satisfaction', 'Envoyer le baromètre');
    case 'projets_retard': case 'absenteisme': case 'formation': case 'affectation': case 'effectif_besoins': case 'disponibilite': return vue('planning', 'Ouvrir le planning');
    case 'papiers_valides': case 'papiers_echeance': return vue('type:document', 'Voir les documents');
    case 'courrier_traite': case 'courrier_urgent': return vue('courrier', 'Ouvrir le courrier');
    case 'donnees_a_jour': case 'outils_branches': return gerer ? { libelle: 'Connecter mes données', cible: 'connecter' } : null;
    case 'synchro_ok': return gerer ? vue('reglages:outils', 'Voir les logiciels connectés') : null;
    case 'fiche_entreprise': return gerer ? vue('accueil', 'Compléter mon entreprise') : null;
    case 'automatisations': case 'temps_recuperable': return vue('optimiser', 'Voir les pistes');
    default: return null;
  }
}

const tousLesCriteres = (S) => (S?.domaines ?? []).flatMap((d) => d.criteres ?? []);
const poidsInconnu = (l) => l.filter((c) => c.score === null || c.score === undefined).reduce((n, c) => n + (c.poids ?? 1), 0);

/**
 * Les 3 priorités, chacune avec son action directe (§6.1 P6). Ordre : d'abord le bloc financier s'il n'est pas
 * renseigné (il pèse le plus et un import suffit), puis les critères les plus faibles (score, puis poids), puis les
 * autres données manquantes qui ont une action. Une priorité sans action reste listée, avec son conseil.
 */
export function prioritesSante(S, ctx = {}) {
  const tous = tousLesCriteres(S);
  const sortie = [];
  const vus = new Set();
  const ajouter = (p) => { if (sortie.length < 3 && !vus.has(p.cle)) { vus.add(p.cle); sortie.push(p); } };
  const compta = tous.filter((c) => FINANCES_COMPTA.has(c.id));
  if (poidsInconnu(compta) >= 3 && ctx.admin && !ctx.demo) {
    ajouter({ cle: 'bloc:finances', titre: 'Vos chiffres financiers ne sont pas encore renseignés', raison: 'Trésorerie, marge et rentabilité comptent pour un tiers du domaine Finances.', ton: null, mesure: null, action: { libelle: 'Importer le FEC', cible: 'fec' } });
    for (const c of compta) vus.add(`critere:${c.id}`);
  }
  const faibles = tous.filter((c) => typeof c.score === 'number' && c.statut !== 'bon')
    .sort((a, b) => a.score - b.score || (b.poids ?? 1) - (a.poids ?? 1));
  for (const c of faibles) ajouter({ cle: `critere:${c.id}`, titre: c.libelle, raison: c.conseil, mesure: c.mesure, ton: statutDe(c.statut).ton, critere: c.id, action: actionCritere(c, ctx) });
  const outils = tous.find((c) => c.id === 'outils_branches');
  if (outils && (outils.score ?? 0) === 0 && ctx.admin && !ctx.demo) ajouter({ cle: 'critere:outils_branches', titre: 'Aucun logiciel connecté', raison: outils.conseil, mesure: outils.mesure, ton: null, critere: 'outils_branches', action: { libelle: 'Connecter mes données', cible: 'connecter' } });
  // un critère réservé (motifs d'absence, droit RH) n'est pas « à connecter » : jamais proposé à ce profil
  const manquants = tous.filter((c) => (c.score === null || c.score === undefined) && !c.reserve).sort((a, b) => (b.poids ?? 1) - (a.poids ?? 1));
  for (const c of manquants) {
    const action = actionCritere(c, ctx);
    // une pratique pas encore lancée n'est pas une donnée manquante : on dit quoi commencer, pas quoi connecter
    if (action) ajouter({ cle: `critere:${c.id}`, titre: `${c.libelle} : ${c.aLancer ? 'à lancer' : 'pas encore renseigné'}`, raison: c.aLancer ? c.conseil : `À connecter : ${c.source}.`, mesure: null, ton: null, critere: c.id, action });
  }
  return sortie;
}

/** Critères d'un domaine groupés par statut (à corriger, à surveiller, bon, pas encore renseigné), groupes vides omis. */
export function groupesCriteres(domaine) {
  const l = domaine?.criteres ?? [];
  return STATUTS.map((s) => ({
    ...s,
    criteres: l.filter((c) => groupeDeCritere(c) === s.id).sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || (b.poids ?? 1) - (a.poids ?? 1)),
  })).filter((g) => g.criteres.length);
}

/** Résumé d'un domaine pour son onglet : « 62 sur 100 · 5 critères sur 8 renseignés ». */
export function resumeDomaine(d) {
  const l = d?.criteres ?? [];
  const connus = l.filter((c) => typeof c.score === 'number').length;
  const part = `${connus} ${connus > 1 ? 'critères' : 'critère'} sur ${l.length} ${connus > 1 ? 'renseignés' : 'renseigné'}`;
  return {
    score: typeof d?.score === 'number' ? d.score : null,
    palier: palierSante(d?.score ?? null),
    texte: typeof d?.score === 'number' ? `${nombre(d.score)} sur 100 · ${part}` : `Pas encore renseigné · ${part}`,
    aCorriger: l.filter((c) => c.statut === 'faible').length,
  };
}

/** Couverture en clair : « 38 critères sur 46 renseignés ». */
export function texteCouverture(S) {
  const l = tousLesCriteres(S);
  const connus = l.filter((c) => typeof c.score === 'number').length;
  return `${connus} ${connus > 1 ? 'critères' : 'critère'} sur ${l.length} ${connus > 1 ? 'renseignés' : 'renseigné'}`;
}

/** En-tête de la page : titre selon le palier, score provisoire sous 50 % des critères pondérés. */
export function enteteSante(S) {
  const score = typeof S?.score === 'number' ? S.score : null;
  const palier = palierSante(score);
  const provisoire = score !== null && (S?.couverture ?? 0) < 0.5;
  const titre = score === null ? 'Pas encore assez de données pour un score' : palier.ton === 'ok' ? 'Votre entreprise est en bonne santé' : palier.ton === 'attention' ? 'Des points à surveiller' : 'Des priorités à traiter';
  return { score, palier, provisoire, titre, couverture: texteCouverture(S) };
}

const JOUR_MS = 86_400_000;
const isoJour = (t) => new Date(t).toISOString().slice(0, 10);

/**
 * Série de la tendance pour uPlot : un x par jour sur `jours` jours (secondes Unix, minuit UTC), y = score ou null
 * (jour sans relevé : un trou, jamais 0). aujourdhui : 'AAAA-MM-JJ' (jour du serveur, le dernier point).
 */
export function serieTendance(tendance, aujourdhui) {
  const jours = tendance?.jours ?? 90;
  const fin = Date.parse(`${aujourdhui}T00:00:00Z`);
  const parJour = new Map((tendance?.points ?? []).map((p) => [p.jour, p]));
  const x = [];
  const y = [];
  for (let i = jours - 1; i >= 0; i--) {
    const t = fin - i * JOUR_MS;
    const p = parJour.get(isoJour(t));
    x.push(Math.round(t / 1000));
    y.push(typeof p?.score === 'number' ? p.score : null);
  }
  return { x, y };
}

/**
 * Résumé en texte de la tendance (au-dessus du graphique, §4.22) : « Score : 51 aujourd'hui, en hausse de 3 points
 * sur 90 jours. » vide : moins de 2 relevés (la courbe n'a pas encore de sens).
 */
export function resumeTendance(tendance) {
  const points = (tendance?.points ?? []).filter((p) => typeof p.score === 'number');
  const jours = tendance?.jours ?? 90;
  if (points.length < 2) {
    return { vide: true, variation: null, ton: null, texte: points.length === 1 ? `Premier relevé : ${nombre(points[0].score)} sur 100. La tendance apparaîtra au fil des jours.` : 'Le score est relevé chaque jour : la tendance apparaîtra au fil des jours.' };
  }
  const premier = points[0];
  const dernier = points.at(-1);
  const v = dernier.score - premier.score;
  const depuis = Math.round((Date.parse(`${dernier.jour}T00:00:00Z`) - Date.parse(`${premier.jour}T00:00:00Z`)) / JOUR_MS);
  const periode = depuis >= jours - 1 ? `sur ${jours} jours` : `depuis ${pluriel(depuis, 'jour', 'jours')}`;
  const sens = v > 0 ? `en hausse de ${pluriel(v, 'point', 'points')}` : v < 0 ? `en baisse de ${pluriel(-v, 'point', 'points')}` : 'stable';
  return {
    vide: false, variation: v, ton: v > 0 ? 'ok' : v < 0 ? 'critique' : null,
    fleche: v > 0 ? 'arrow-up' : v < 0 ? 'arrow-down' : 'arrow-right',
    texte: `Score : ${nombre(dernier.score)} sur 100 au dernier relevé, ${sens} ${periode}.`,
    variationTexte: v === 0 ? 'Stable' : `${v > 0 ? '+' : '−'}${pluriel(Math.abs(v), 'point', 'points')} ${periode}`,
    min: Math.min(...points.map((p) => p.score)),
    max: Math.max(...points.map((p) => p.score)),
  };
}

/** Lignes du tableau équivalent à la courbe (« Voir le tableau ») : les jours relevés seulement, du plus récent au plus ancien. */
export function lignesTendance(tendance) {
  return [...(tendance?.points ?? [])].filter((p) => typeof p.score === 'number').reverse()
    .map((p) => ({ jour: p.jour, score: p.score, couverture: Math.round((p.couverture ?? 0) * 100) }));
}
