/**
 * Détection de ce qui peut être automatisé ou optimisé, à partir des données RÉELLES du monde
 * (objets, situations, journal, planning). Chaque piste donne son constat chiffré, son hypothèse de temps gagné
 * (toujours affichée : jamais un chiffre sans explication), sa difficulté et, quand c'est possible,
 * une automatisation prête à activer (`recette`).
 */
import type { ObjetMetier } from './model.ts';
import type { Situation } from './situation.ts';
import { pluriel } from './texte.ts';

export type Categorie = 'Relances et paiements' | 'Stock et achats' | 'Courrier' | 'Équipes' | 'Clients' | 'Données' | 'Administratif' | 'Ventes';

export interface Opportunite {
  id: string;
  titre: string;
  categorie: Categorie;
  constat: string;
  proposition: string;
  hypothese: string;
  heuresMois: number;
  euroMois: number;
  difficulte: 'facile' | 'moyenne' | 'avancée';
  objets: string[];
  recette: string | null;
  active: boolean;
}

export interface EntreeOptimisations {
  objets: readonly ObjetMetier[];
  situations: readonly Situation[];
  journal: readonly { le: string; acteur: string; action: string; cible: string | null; detail: string }[];
  trousPlanning: number;
  maintenant: Date;
  tauxHoraire: number;
  connecteurs: number;
  recettesActives: ReadonlySet<string>;
}

const JOUR = 86_400_000;
const arrondi = (h: number) => Math.round(h * 2) / 2;
const nom = (o: ObjetMetier) => o.nom.replace(/\s*\((démo|fictif|fictive)\)/gi, '');
const liste = (os: readonly ObjetMetier[], n = 3) => os.slice(0, n).map(nom).join(', ') + (os.length > n ? `… (+${os.length - n})` : '');

export function detecterOptimisations(e: EntreeOptimisations): { opportunites: Opportunite[]; heuresMois: number; euroMois: number; indice: number } {
  const res: Opportunite[] = [];
  const t = e.maintenant.getTime();
  const sit = (regle: string) => e.situations.filter((s) => s.regle === regle && s.statut !== 'a_verifier');
  const parId = new Map(e.objets.map((o) => [o.id, o]));
  const ajouter = (o: Omit<Opportunite, 'euroMois' | 'active' | 'heuresMois'> & { heuresMois: number }) => {
    const h = arrondi(o.heuresMois);
    if (h <= 0) return;
    res.push({ ...o, heuresMois: h, euroMois: Math.round(h * e.tauxHoraire), active: o.recette !== null && e.recettesActives.has(o.recette) });
  };

  // 1. Factures en retard → relances automatiques
  const factures = sit('retard_paiement').map((s) => parId.get(s.objetId)).filter((o): o is ObjetMetier => !!o);
  if (factures.length) {
    const montant = factures.reduce((s, f) => s + (typeof f.champs.montant === 'number' ? f.champs.montant : 0), 0);
    ajouter({
      id: 'relance-factures', titre: 'Relancer automatiquement les factures en retard', categorie: 'Relances et paiements',
      constat: `${pluriel(factures.length, 'facture en retard', 'factures en retard')} pour ${montant.toLocaleString('fr-FR')} € (${liste(factures)}).`,
      proposition: 'À J+3, J+15 et J+30 : tâche de relance pour la personne en charge, et message à votre outil (Make, Zapier…) pour envoyer le mail type.',
      hypothese: '3 relances par facture et par mois, 10 minutes chacune (retrouver la facture, écrire, suivre).',
      heuresMois: (factures.length * 3 * 10) / 60, difficulte: 'facile', objets: factures.map((f) => f.id), recette: 'relance-factures',
    });
  }

  // 2. Devis envoyés sans réponse → relance commerciale
  const devis = e.objets.filter((o) => o.type === 'devis' && o.champs.statut === 'envoyé' && t - Date.parse(o.majLe) > 7 * JOUR);
  const devisEnvoyes = e.objets.filter((o) => o.type === 'devis' && o.champs.statut === 'envoyé');
  if (devisEnvoyes.length) {
    ajouter({
      id: 'relance-devis', titre: 'Relancer les devis sans réponse', categorie: 'Ventes',
      constat: `${pluriel(devisEnvoyes.length, 'devis envoyé', 'devis envoyés')} en attente de réponse${devis.length ? `, dont ${devis.length} depuis plus de 7 jours` : ''} (${liste(devisEnvoyes)}).`,
      proposition: 'Tâche de relance automatique 7 jours après l’envoi, puis 15 jours ; le devis est marqué « à relancer » sur la carte.',
      hypothese: '15 minutes par devis à suivre (penser à relancer, retrouver le contact, appeler). Un devis relancé est signé plus souvent.',
      heuresMois: (devisEnvoyes.length * 15) / 60, difficulte: 'facile', objets: devisEnvoyes.map((o) => o.id), recette: 'relance-devis',
    });
  }

  // 3. Commandes livrées non facturées → facturation automatique
  const livrees = e.objets.filter((o) => o.type === 'commande_client' && o.champs.statut === 'livrée');
  if (livrees.length) {
    ajouter({
      id: 'facturer-livraisons', titre: 'Facturer dès la livraison', categorie: 'Relances et paiements',
      constat: `${pluriel(livrees.length, 'commande livrée pas encore facturée', 'commandes livrées pas encore facturées')} (${liste(livrees)}).`,
      proposition: 'À la livraison : tâche « facturer » immédiate et envoi des éléments à votre logiciel de facturation par webhook.',
      hypothese: '20 minutes par commande (préparer la facture) et autant de trésorerie récupérée plus tôt.',
      heuresMois: (livrees.length * 20) / 60, difficulte: 'moyenne', objets: livrees.map((o) => o.id), recette: 'facturer-livraisons',
    });
  }

  // 4. Stock sous le seuil → réapprovisionnement préparé
  const stock = sit('stock_minimum').map((s) => parId.get(s.objetId)).filter((o): o is ObjetMetier => !!o);
  if (stock.length) {
    ajouter({
      id: 'reappro-stock', titre: 'Préparer les réapprovisionnements automatiquement', categorie: 'Stock et achats',
      constat: `${pluriel(stock.length, 'article', 'articles')} sous le seuil d’alerte (${liste(stock)}).`,
      proposition: 'Sous le seuil : tâche « commander » assignée à la logistique avec le fournisseur habituel ; vous n’avez plus qu’à valider.',
      hypothese: '25 minutes par réapprovisionnement (vérifier le stock, chercher le fournisseur, préparer la commande), 2 fois par mois.',
      heuresMois: (stock.length * 2 * 25) / 60, difficulte: 'facile', objets: stock.map((o) => o.id), recette: 'reappro-stock',
    });
  }

  // 5. Courrier : volume à trier
  const courrier = e.objets.filter((o) => o.type === 'courrier');
  const recents = courrier.filter((o) => t - Date.parse(String(o.champs.recu_le ?? o.majLe)) < 30 * JOUR);
  if (courrier.length >= 3) {
    const urgents = courrier.filter((o) => o.champs.urgence === 'haute' && o.champs.statut !== 'traité');
    ajouter({
      id: 'tri-courrier', titre: 'Trier et router le courrier automatiquement', categorie: 'Courrier',
      constat: `${pluriel(recents.length || courrier.length, 'courrier reçu', 'courriers reçus')} ce mois-ci${urgents.length ? `, dont ${pluriel(urgents.length, 'urgent', 'urgents')} encore à traiter` : ''}.`,
      proposition: 'Chaque mail transféré (adresse dédiée via Make/Zapier) est classé, attribué à la bonne personne, et les urgents créent une tâche.',
      hypothese: '4 minutes de tri et de transfert par courrier.',
      heuresMois: ((recents.length || courrier.length) * 4) / 60 * (30 / 30), difficulte: 'moyenne', objets: urgents.map((o) => o.id), recette: 'courrier-urgent',
    });
  }

  // 6. Documents à renouveler
  const docs = sit('document_expire').map((s) => parId.get(s.objetId)).filter((o): o is ObjetMetier => !!o);
  if (docs.length) {
    ajouter({
      id: 'documents', titre: 'Anticiper les papiers à renouveler', categorie: 'Administratif',
      constat: `${pluriel(docs.length, 'document expiré', 'documents expirés')} ou à renouveler sous 30 jours (${liste(docs)}).`,
      proposition: 'Rappel automatique 30 jours avant l’échéance : tâche à l’administratif avec l’organisme et l’emplacement du document.',
      hypothese: '30 minutes par document (retrouver, demander, classer) et le risque évité d’un marché perdu faute d’attestation.',
      heuresMois: (docs.length * 30) / 60, difficulte: 'facile', objets: docs.map((o) => o.id), recette: 'documents',
    });
  }

  // 7. Véhicules : révisions et contrôles
  const vehicules = [...sit('revision_vehicule'), ...sit('controle_technique')].map((s) => parId.get(s.objetId)).filter((o): o is ObjetMetier => !!o);
  if (vehicules.length) {
    ajouter({
      id: 'vehicules', titre: 'Planifier révisions et contrôles techniques', categorie: 'Administratif',
      constat: `${pluriel(vehicules.length, 'échéance de véhicule à venir ou dépassée', 'échéances de véhicule à venir ou dépassées')} (${liste([...new Set(vehicules)])}).`,
      proposition: 'Tâche automatique 30 jours avant, et véhicule marqué indisponible le jour du rendez-vous dans le planning.',
      hypothese: '20 minutes par échéance (prendre rendez-vous, prévenir l’équipe).',
      heuresMois: (vehicules.length * 20) / 60, difficulte: 'facile', objets: vehicules.map((o) => o.id), recette: 'vehicules',
    });
  }

  // 8. Tâches en retard ou sans responsable
  const tachesRetard = sit('tache_en_retard').map((s) => parId.get(s.objetId)).filter((o): o is ObjetMetier => !!o);
  const sansResp = e.objets.filter((o) => o.famille === 'tache' && o.champs.statut !== 'terminée' && typeof o.champs.responsable !== 'string');
  if (tachesRetard.length || sansResp.length >= 3) {
    ajouter({
      id: 'taches', titre: 'Attribuer et suivre les tâches sans intervention', categorie: 'Équipes',
      constat: `${pluriel(tachesRetard.length, 'tâche en retard', 'tâches en retard')}, ${sansResp.length} sans responsable.`,
      proposition: 'Toute tâche sans responsable est attribuée au responsable du département concerné ; rappel automatique la veille de l’échéance.',
      hypothese: '5 minutes de suivi par tâche concernée, chaque semaine.',
      heuresMois: ((tachesRetard.length + sansResp.length) * 5 * 4) / 60, difficulte: 'facile', objets: [...tachesRetard, ...sansResp].map((o) => o.id), recette: 'taches-retard',
    });
  }

  // 9. Planning : trous
  if (e.trousPlanning > 0) {
    ajouter({
      id: 'planning', titre: 'Signaler les trous de planning dès qu’ils apparaissent', categorie: 'Équipes',
      constat: `${pluriel(e.trousPlanning, 'trou', 'trous')} dans le planning des 6 prochains jours ouvrés, aujourd’hui compris (sous-effectif ou personne sans affectation).`,
      proposition: 'Chaque matin, une tâche pour le responsable avec les trous du jour et les personnes disponibles pour les combler.',
      hypothese: '15 minutes par trou (s’en rendre compte, appeler, réorganiser).',
      heuresMois: (e.trousPlanning * 15 * 3) / 60, difficulte: 'facile', objets: [], recette: 'trous-planning',
    });
  }

  // 10. Satisfaction client inconnue
  const clients = e.objets.filter((o) => o.famille === 'tiers' && o.roles.includes('client'));
  const avis = e.objets.filter((o) => o.type === 'avis_client');
  const sansAvis = clients.filter((c) => !avis.some((a) => a.champs.concerne === c.id && t - Date.parse(String(a.champs.recu_le ?? a.majLe)) < 180 * JOUR));
  if (sansAvis.length) {
    ajouter({
      id: 'satisfaction', titre: 'Mesurer la satisfaction sans y penser', categorie: 'Clients',
      constat: `${pluriel(sansAvis.length, 'client', 'clients')} sur ${clients.length} sans avis depuis 6 mois (${liste(sansAvis)}).`,
      proposition: 'Formulaire envoyé automatiquement après une livraison ou une facture payée ; un avis bas crée une tâche « rappeler le client ».',
      hypothese: '10 minutes par client pour demander un avis à la main ; un client mécontent détecté tôt est souvent sauvé.',
      heuresMois: (sansAvis.length * 10) / 60 / 2, difficulte: 'facile', objets: sansAvis.map((o) => o.id), recette: 'satisfaction-auto',
    });
  }
  const avisBas = avis.filter((a) => typeof a.champs.note === 'number' && (a.champs.note as number) < 7 && t - Date.parse(String(a.champs.recu_le ?? a.majLe)) < 60 * JOUR);
  if (avisBas.length) {
    ajouter({
      id: 'avis-bas', titre: 'Rappeler chaque client mécontent sous 48 h', categorie: 'Clients',
      constat: `${avisBas.length} avis sous 7/10 ces deux derniers mois.`,
      proposition: 'Un avis bas crée immédiatement une tâche « rappeler » pour le commercial, avec le commentaire du client.',
      hypothese: 'Gain de temps faible ; l’enjeu est la fidélisation (un client rappelé reste plus souvent).',
      heuresMois: avisBas.length * 0.25, difficulte: 'facile', objets: avisBas.map((o) => o.id), recette: 'avis-bas',
    });
  }

  // 11. Baromètre collaborateurs jamais envoyé
  const barometre = e.objets.filter((o) => o.type === 'barometre' && t - Date.parse(String(o.champs.recu_le ?? o.majLe)) < 120 * JOUR);
  const employes = e.objets.filter((o) => o.famille === 'personne');
  if (employes.length >= 3 && barometre.length < 3) {
    ajouter({
      id: 'barometre', titre: 'Baromètre d’équipe trimestriel automatique', categorie: 'Équipes',
      constat: `Aucun retour récent de l’équipe (${employes.length} personnes).`,
      proposition: 'Chaque trimestre, un formulaire anonyme de 3 questions à chacun ; résultats regroupés, par service à partir de 5 réponses.',
      hypothese: '2 heures par trimestre pour organiser un sondage à la main.',
      heuresMois: 2 / 3, difficulte: 'facile', objets: [], recette: 'barometre',
    });
  }

  // 12. Saisie manuelle et imports → connecter l'outil source
  // l'entreprise elle-même n'est pas une fiche qu'on ressaisit : elle ne compte pas
  const manuels = e.objets.filter((o) => o.mode === 'reel' && o.famille !== 'organisation' && (o.source.id === 'saisie' || o.source.id.startsWith('import:')));
  // au moins une fiche tenue à la main : sans cela, la piste s'affichait avec « 0 fiche saisie… qui vieillissent »
  if (manuels.length >= 5 || (manuels.length > 0 && e.connecteurs === 0)) {
    ajouter({
      id: 'connecter', titre: 'Brancher vos outils au lieu de ressaisir', categorie: 'Données',
      constat: e.connecteurs === 0 ? `Aucun outil branché : ${pluriel(manuels.length, 'fiche saisie ou importée', 'fiches saisies ou importées')} à la main, ${manuels.length > 1 ? 'qui vieillissent' : 'qui vieillit'}.` : `${pluriel(manuels.length, 'fiche saisie ou importée', 'fiches saisies ou importées')} à la main.`,
      proposition: 'Reliez votre CRM, votre tableur ou votre base (Airtable, Notion, HubSpot, Google Sheets, Make…) : les changements passent dans les deux sens, en temps réel.',
      hypothese: '2 minutes par fiche à tenir à jour chaque mois en double saisie.',
      heuresMois: Math.max(1, (manuels.length * 2) / 60), difficulte: 'moyenne', objets: manuels.slice(0, 20).map((o) => o.id), recette: null,
    });
  }

  // 13. Doublons de tiers
  const vus = new Map<string, ObjetMetier[]>();
  for (const o of e.objets.filter((x) => x.famille === 'tiers')) {
    const cle = o.nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\b(sarl|sas|sasu|eurl|sa|sci|ets|societe|ste)\b/g, '').replace(/[^a-z0-9]/g, '');
    if (!vus.has(cle)) vus.set(cle, []);
    vus.get(cle)?.push(o);
  }
  const doublons = [...vus.values()].filter((l) => l.length > 1);
  if (doublons.length) {
    ajouter({
      id: 'doublons', titre: 'Fusionner les doublons de clients et fournisseurs', categorie: 'Données',
      constat: `${doublons.length} tiers en double (${doublons.slice(0, 3).map((l) => nom(l[0] as ObjetMetier)).join(', ')}).`,
      proposition: 'Fusion guidée et règle de rapprochement à l’import pour que cela ne se reproduise pas.',
      hypothese: '15 minutes perdues par doublon et par mois (mauvaise fiche, relance en double).',
      heuresMois: (doublons.length * 15) / 60, difficulte: 'facile', objets: doublons.flat().map((o) => o.id), recette: null,
    });
  }

  // 14. Actions répétées à la main (journal des 30 derniers jours)
  const repetitions = new Map<string, number>();
  for (const j of e.journal) {
    if (t - Date.parse(j.le) > 30 * JOUR || j.acteur === 'systeme' || j.acteur.startsWith('connecteur:') || j.acteur === 'formulaire') continue;
    const cle = j.action === 'action.preparee' ? `${j.action}:${j.detail.split(' ')[0]}` : j.action;
    repetitions.set(cle, (repetitions.get(cle) ?? 0) + 1);
  }
  const LIBELLES: Record<string, string> = { 'action.preparee:mouvement': 'mouvements de stock saisis à la main', 'action.preparee:tache.creer': 'tâches créées à la main', 'courrier.statut': 'courriers marqués traités', 'planning.affecte': 'changements de planning', 'objet.cree': 'fiches créées à la main', 'action.preparee:objet.modifier': 'fiches modifiées à la main' };
  for (const [cle, n] of repetitions) {
    if (n < 5 || !LIBELLES[cle]) continue;
    ajouter({
      id: `repetition-${cle}`, titre: `Automatiser : ${LIBELLES[cle]}`, categorie: 'Données',
      constat: `${n} ${LIBELLES[cle]} ces 30 derniers jours.`,
      proposition: cle.includes('mouvement') ? 'Les mouvements peuvent venir directement de votre caisse, de votre logiciel de stock ou d’un scan (webhook).' : 'Une règle ou un outil branché peut faire ce geste à votre place.',
      hypothese: '3 minutes par geste répété.',
      heuresMois: (n * 3) / 60, difficulte: 'moyenne', objets: [], recette: null,
    });
  }

  res.sort((a, b) => Number(a.active) - Number(b.active) || b.heuresMois - a.heuresMois);
  const restant = res.filter((o) => !o.active);
  const heures = arrondi(restant.reduce((s, o) => s + o.heuresMois, 0));
  const actives = res.filter((o) => o.active).length;
  const avecRecette = res.filter((o) => o.recette !== null).length;
  return { opportunites: res, heuresMois: heures, euroMois: Math.round(heures * e.tauxHoraire), indice: avecRecette ? Math.round((actives / avecRecette) * 100) : 0 };
}
