/**
 * Score de santé de l'entreprise : 6 domaines, 46 critères, chacun noté 0–100 et EXPLIQUÉ.
 * - Universel : seulement les familles et types du vocabulaire générique (factures, devis, stock, planning…).
 * - Donnée inconnue ≠ 0 : le critère est « à connecter » et la couverture baisse (jamais de note inventée).
 * - Chaque critère dit ce qu'il mesure, d'où vient la donnée et comment progresser.
 * - `ratios()` : valeurs normalisées SANS montant ni nom, seules partageables (comparaison Breizhcosystem : notes rattachées à l'entreprise chez Breizhcosystem, donc pseudonymes, pas anonymes).
 * Ce n'est ni une notation de crédit ni un audit : des repères généraux, à ajuster par secteur.
 */
import { fraicheur, type ObjetMetier } from './model.ts';

export type DomaineSante = 'finances' | 'commercial' | 'operations' | 'social' | 'gestion' | 'automatisation';

export const DOMAINES: readonly { id: DomaineSante; libelle: string; icone: string }[] = [
  { id: 'finances', libelle: 'Finances', icone: '€' },
  { id: 'commercial', libelle: 'Commercial & clients', icone: '🤝' },
  { id: 'operations', libelle: 'Opérations', icone: '⚙' },
  { id: 'social', libelle: 'Équipe & social', icone: '👥' },
  { id: 'gestion', libelle: 'Gestion & administratif', icone: '🗂' },
  { id: 'automatisation', libelle: 'Outils & automatisation', icone: '⚡' },
];

export interface CritereSante {
  id: string;
  domaine: DomaineSante;
  libelle: string;
  poids: number;
  /** Note 0–100, null si la donnée manque. */
  score: number | null;
  /** Mesure lisible (« 2,4 mois de charges »), null si inconnue. */
  mesure: string | null;
  /** Valeur brute normalisée (ratio, jours, note…), jamais un montant. */
  valeur: number | null;
  statut: 'bon' | 'moyen' | 'faible' | 'inconnu';
  /** D'où vient la donnée / quoi connecter si elle manque. */
  source: string;
  conseil: string;
  /**
   * Critère réservé, non calculé pour ce profil (il lit les motifs d'absence, dont « maladie », donnée de santé :
   * droit RH). Ni note ni mesure : il ne pèse ni dans son domaine ni dans la note globale.
   */
  reserve?: true;
  /** Pratique pas encore lancée sur une entreprise de moins d'un mois : « À lancer », jamais « 0 sur 100 ». */
  aLancer?: true;
}

export interface DomaineResultat {
  id: DomaineSante;
  libelle: string;
  icone: string;
  score: number | null;
  couverture: number;
  criteres: CritereSante[];
}

export interface ResultatSante {
  score: number | null;
  /** Part des critères (pondérés) réellement mesurés. */
  couverture: number;
  /** Fiabilité : « provisoire » sous 50 % de couverture. */
  fiabilite: 'bonne' | 'provisoire' | 'insuffisante';
  domaines: DomaineResultat[];
  forces: CritereSante[];
  priorites: CritereSante[];
  calculeLe: string;
}

export interface ModulesSante {
  connecteursActifs: number;
  connecteursEnErreur: number;
  automatisationsActives: number;
  /** Heures/mois encore récupérables (pistes non automatisées), null si inconnu. */
  heuresRecuperables: number | null;
}

export interface EntreeSante {
  objets: readonly ObjetMetier[];
  planning: ReadonlyMap<string, ReadonlyMap<string, string>>;
  maintenant: Date;
  ageMaxMs: number;
  modules: ModulesSante | null;
  /**
   * Faux : le profil qui lit le score n'a pas le droit de voir les motifs d'absence. Les critères qui les comptent
   * (absences maladie, temps de formation) ne sont alors pas calculés : leur taux, rapproché des cases « absence » de
   * son planning, lui apprendrait qu'une absence est un arrêt maladie. Défaut : vrai (vue de l'entreprise entière).
   */
  motifsAbsence?: boolean;
}

const JOUR = 86_400_000;
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const date = (x: unknown): number | null => (typeof x === 'string' && /^\d{4}-\d{2}-\d{2}/.test(x) ? Date.parse(`${x.slice(0, 10)}T00:00:00Z`) : null);
const pct = (x: number) => `${Math.round(x * 100)} %`;
/** Accord français : 0 et 1 au singulier (« 1 jour », « 0 courrier urgent »), au-delà au pluriel. */
const pl = (n: number, un: string, plusieurs: string) => (Math.abs(Math.round(n)) >= 2 ? plusieurs : un);
const fr = (x: number, d = 1) => x.toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const somme = (l: readonly number[]) => l.reduce((a, b) => a + b, 0);
const moyenne = (l: readonly number[]) => (l.length ? somme(l) / l.length : null);

/** 0 à `mauvais`, 100 à `bon`, linéaire entre les deux (dans les deux sens). */
export function echelle(v: number, mauvais: number, bon: number): number {
  if (mauvais === bon) return v >= bon ? 100 : 0;
  const t = (v - mauvais) / (bon - mauvais);
  return Math.round(Math.max(0, Math.min(1, t)) * 100);
}

interface Mesure {
  valeur: number | null;
  mesure: string | null;
}
const inconnu: Mesure = { valeur: null, mesure: null };

interface Definition {
  id: string;
  domaine: DomaineSante;
  libelle: string;
  poids?: number;
  mauvais: number;
  bon: number;
  source: string;
  conseil: string;
  /** Le critère lit les motifs d'absence du planning : réservé aux profils qui ont le droit de les voir. */
  motifs?: true;
  /**
   * Le critère mesure une pratique qu'il faut d'abord lancer (demander des avis, brancher un outil, mettre une
   * automatisation en marche). À zéro sur une entreprise qui vient d'être créée, ce n'est pas une mauvaise note :
   * c'est qu'on n'a pas commencé. Il est alors « À lancer », sans note, jusqu'au premier mois de données.
   */
  aLancer?: true;
  mesurer: (c: Contexte) => Mesure;
}

interface Contexte {
  objets: readonly ObjetMetier[];
  parType: (type: string) => ObjetMetier[];
  parId: Map<string, ObjetMetier>;
  org: ObjetMetier | undefined;
  auj: number;
  planning: ReadonlyMap<string, ReadonlyMap<string, string>>;
  modules: ModulesSante | null;
  ageMaxMs: number;
  maintenant: Date;
}

const aRole = (c: Contexte, id: unknown, role: string) => typeof id === 'string' && (c.parId.get(id)?.roles.includes(role) ?? false);
const clients = (c: Contexte) => c.objets.filter((o) => o.famille === 'tiers' && o.roles.includes('client'));
const facturesClients = (c: Contexte) => c.parType('facture').filter((f) => !aRole(c, f.champs.tiers, 'fournisseur'));
const facturesFournisseurs = (c: Contexte) => c.parType('facture').filter((f) => aRole(c, f.champs.tiers, 'fournisseur'));
/** Jours de retard d'une facture non payée (champ ou échéance dépassée). */
const retardJours = (c: Contexte, f: ObjetMetier): number => {
  const r = num(f.champs.retard_jours);
  if (r !== null) return Math.max(0, r);
  const e = date(f.champs.echeance);
  return e !== null && e < c.auj ? Math.floor((c.auj - e) / JOUR) : 0;
};
const impayee = (f: ObjetMetier) => f.champs.payee !== true;
const chargesMensuelles = (c: Contexte) => num(c.org?.champs.charges_mensuelles);
/** Cases de planning des employés (hors cases vides) sur la période connue. */
const casesPlanning = (c: Contexte) => {
  const employes = new Set(c.objets.filter((o) => o.famille === 'personne').map((o) => o.id));
  const cases: string[] = [];
  for (const [id, jours] of c.planning) if (employes.has(id)) for (const v of jours.values()) cases.push(v);
  return cases;
};

const DEFINITIONS: readonly Definition[] = [
  // ------------------------------------------------------------------ finances
  {
    id: 'tresorerie', domaine: 'finances', libelle: 'Trésorerie disponible', poids: 2, mauvais: 0.5, bon: 3,
    source: 'Fiche entreprise : trésorerie et charges mensuelles (ou banque branchée)', conseil: 'Visez au moins 3 mois de charges d’avance : relancez les impayés, échelonnez les gros achats.',
    mesurer: (c) => {
      const t = num(c.org?.champs.tresorerie);
      const ch = chargesMensuelles(c);
      return t === null || !ch ? inconnu : { valeur: t / ch, mesure: `${fr(t / ch)} mois de charges` };
    },
  },
  {
    id: 'marge_brute', domaine: 'finances', libelle: 'Marge brute', poids: 2, mauvais: 15, bon: 45,
    source: 'Fiche entreprise : marge brute en % (ou comptabilité branchée)', conseil: 'Revoyez les prix des prestations les moins rentables et renégociez les achats récurrents (achats groupés Breizhcosystem).',
    mesurer: (c) => {
      const m = num(c.org?.champs.marge_brute);
      return m === null ? inconnu : { valeur: m, mesure: `${fr(m)} %` };
    },
  },
  {
    id: 'rentabilite', domaine: 'finances', libelle: 'Rentabilité nette', poids: 2, mauvais: 0, bon: 8,
    source: 'Comptabilité (import FEC) ou fiche entreprise : résultat net et chiffre d’affaires', conseil: 'Sous 3 % : revoyez les prix, les achats récurrents et les charges fixes les plus lourdes (abonnements, locations).',
    mesurer: (c) => {
      const r = num(c.org?.champs.resultat_net);
      const ca = num(c.org?.champs.chiffre_affaires_annuel);
      return r === null || !ca || ca <= 0 ? inconnu : { valeur: (r / ca) * 100, mesure: `${fr((r / ca) * 100)} % du chiffre d’affaires` };
    },
  },
  {
    id: 'delai_clients', domaine: 'finances', libelle: 'Délai de paiement des clients (comptabilité)', mauvais: 90, bon: 30,
    source: 'Comptabilité (import FEC) : créances clients rapportées au chiffre d’affaires TTC', conseil: 'Au-delà de 60 jours, la loi est dépassée (LME) : facturez dès la livraison, relancez à l’échéance, proposez le prélèvement.',
    mesurer: (c) => {
      const cr = num(c.org?.champs.creances_clients);
      const ca = num(c.org?.champs.chiffre_affaires_annuel);
      if (cr === null || !ca || ca <= 0) return inconnu;
      const j = (cr / (ca * 1.2)) * 365; // TVA 20 % supposée
      return { valeur: j, mesure: `${fr(j, 0)} ${pl(j, 'jour', 'jours')} de chiffre d’affaires` };
    },
  },
  {
    id: 'endettement', domaine: 'finances', libelle: 'Endettement financier', mauvais: 2, bon: 0.5,
    source: 'Comptabilité (import FEC) : emprunts rapportés aux capitaux propres', conseil: 'Au-delà d’une fois les capitaux propres, la banque prêtera difficilement : étalez les investissements, renforcez les fonds propres.',
    mesurer: (c) => {
      const d = num(c.org?.champs.dettes_financieres);
      const k = num(c.org?.champs.capitaux_propres);
      if (d === null || k === null) return inconnu;
      if (d <= 0) return { valeur: 0, mesure: 'aucun emprunt' };
      if (k <= 0) return { valeur: 10, mesure: 'capitaux propres négatifs' };
      return { valeur: d / k, mesure: `emprunts = ${fr(d / k)} × les capitaux propres` };
    },
  },
  {
    id: 'retards_clients', domaine: 'finances', libelle: 'Factures clients en retard', poids: 2, mauvais: 0.5, bon: 0,
    source: 'Factures', conseil: 'Activez la relance automatique des factures (Optimiser) et demandez un acompte aux clients habituellement en retard.',
    mesurer: (c) => {
      const f = facturesClients(c);
      if (!f.length) return inconnu;
      const dues = f.filter(impayee);
      const du = somme(dues.map((x) => num(x.champs.montant) ?? 0));
      const enRetard = somme(dues.filter((x) => retardJours(c, x) > 0).map((x) => num(x.champs.montant) ?? 0));
      const r = du > 0 ? enRetard / du : 0;
      return { valeur: r, mesure: `${pct(r)} du montant dû est en retard` };
    },
  },
  {
    id: 'retard_moyen', domaine: 'finances', libelle: 'Retard moyen de paiement', mauvais: 60, bon: 0,
    source: 'Factures', conseil: 'Relancez dès J+1, proposez le prélèvement ou le paiement en ligne.',
    mesurer: (c) => {
      const f = facturesClients(c);
      if (!f.length) return inconnu;
      const r = moyenne(f.filter(impayee).map((x) => retardJours(c, x)).filter((j) => j > 0)) ?? 0;
      return { valeur: r, mesure: `${fr(r, 0)} ${pl(r, 'jour', 'jours')} en moyenne` };
    },
  },
  {
    id: 'impayes_anciens', domaine: 'finances', libelle: 'Impayés de plus de 90 jours', mauvais: 0.2, bon: 0,
    source: 'Factures', conseil: 'Au-delà de 90 jours : mise en demeure, puis injonction de payer. Vérifiez la santé du client (alerte Bodacc Breizhcosystem).',
    mesurer: (c) => {
      const dues = facturesClients(c).filter(impayee);
      if (!facturesClients(c).length) return inconnu;
      const r = dues.length ? dues.filter((x) => retardJours(c, x) > 90).length / dues.length : 0;
      return { valeur: r, mesure: `${pct(r)} des factures dues` };
    },
  },
  {
    id: 'encours_depasses', domaine: 'finances', libelle: 'Clients au-delà de leur encours autorisé', mauvais: 0.3, bon: 0,
    source: 'Fiches clients : encours et limite d’encours', conseil: 'Bloquez les nouvelles commandes au-delà de la limite ou demandez un paiement d’avance.',
    mesurer: (c) => {
      const l = c.objets.filter((o) => o.famille === 'tiers' && num(o.champs.encours) !== null && num(o.champs.limite_encours) !== null);
      if (!l.length) return inconnu;
      const r = l.filter((o) => (num(o.champs.encours) as number) > (num(o.champs.limite_encours) as number)).length / l.length;
      return { valeur: r, mesure: `${pct(r)} des clients suivis` };
    },
  },
  {
    id: 'tendance_ventes', domaine: 'finances', libelle: 'Tendance des ventes (90 jours)', mauvais: -0.2, bon: 0.1,
    source: 'Factures clients datées', conseil: 'Ventes en baisse : relancez les devis en attente et les anciens clients satisfaits.',
    mesurer: (c) => {
      const f = facturesClients(c);
      // échéance ≈ émission + 30 jours : la fenêtre récente inclut les échéances du mois à venir
      const periode = (debut: number, fin: number) => somme(f.filter((x) => { const e = date(x.champs.echeance); return e !== null && e > debut && e <= fin; }).map((x) => num(x.champs.montant) ?? 0));
      const recent = periode(c.auj - 60 * JOUR, c.auj + 30 * JOUR);
      const avant = periode(c.auj - 150 * JOUR, c.auj - 60 * JOUR);
      if (recent <= 0 || avant <= 0) return inconnu;
      const r = recent / avant - 1;
      return { valeur: r, mesure: `${r >= 0 ? '+' : ''}${pct(r)} sur 90 jours` };
    },
  },
  {
    id: 'fournisseurs_payes', domaine: 'finances', libelle: 'Fournisseurs payés à l’heure', mauvais: 0.3, bon: 0,
    source: 'Factures fournisseurs', conseil: 'Payer à l’heure améliore vos conditions d’achat et votre réputation sur Breizhcosystem.',
    mesurer: (c) => {
      const f = facturesFournisseurs(c);
      if (!f.length) return inconnu;
      const dues = f.filter(impayee);
      const du = somme(dues.map((x) => num(x.champs.montant) ?? 0));
      const r = du > 0 ? somme(dues.filter((x) => retardJours(c, x) > 0).map((x) => num(x.champs.montant) ?? 0)) / du : 0;
      return { valeur: r, mesure: `${pct(r)} du montant dû aux fournisseurs est en retard` };
    },
  },
  // ------------------------------------------------------------------ commercial
  {
    id: 'transformation_devis', domaine: 'commercial', libelle: 'Devis signés', poids: 2, mauvais: 0.2, bon: 0.6,
    source: 'Devis (statuts accepté / refusé)', conseil: 'Relancez chaque devis à J+7 et J+15 (automatisation « Relancer les devis »).',
    mesurer: (c) => {
      const d = c.parType('devis');
      const acc = d.filter((x) => x.champs.statut === 'accepté').length;
      const ref = d.filter((x) => x.champs.statut === 'refusé').length;
      if (acc + ref < 3) return inconnu;
      return { valeur: acc / (acc + ref), mesure: `${pct(acc / (acc + ref))} des devis décidés` };
    },
  },
  {
    id: 'devis_sans_reponse', domaine: 'commercial', libelle: 'Devis sans réponse', mauvais: 0.6, bon: 0.15,
    source: 'Devis envoyés', conseil: 'Un devis sans réponse se relance : un appel vaut trois e-mails.',
    mesurer: (c) => {
      const d = c.parType('devis').filter((x) => x.champs.statut !== 'brouillon');
      if (d.length < 3) return inconnu;
      const r = d.filter((x) => x.champs.statut === 'envoyé').length / d.length;
      return { valeur: r, mesure: `${pct(r)} des devis envoyés` };
    },
  },
  {
    id: 'satisfaction', domaine: 'commercial', libelle: 'Satisfaction clients', poids: 2, mauvais: 5, bon: 9,
    source: 'Avis clients (formulaires de satisfaction)', conseil: 'Appelez les clients sous 7/10 dans la semaine ; demandez un avis après chaque livraison.',
    mesurer: (c) => {
      const n = c.parType('avis_client').filter((a) => { const d = date(a.champs.recu_le); return d === null || c.auj - d < 365 * JOUR; }).map((a) => num(a.champs.note)).filter((x): x is number => x !== null);
      const m = moyenne(n);
      return m === null ? inconnu : { valeur: m, mesure: `${fr(m)}/10 sur ${n.length} avis` };
    },
  },
  {
    id: 'recommandation', domaine: 'commercial', libelle: 'Recommandation (NPS)', mauvais: -20, bon: 50,
    source: 'Avis clients : « nous recommanderiez-vous ? »', conseil: 'Transformez vos clients enthousiastes en ambassadeurs : bouton « Proposer à un ami » de Breizhcosystem.',
    mesurer: (c) => {
      const r = c.parType('avis_client').map((a) => num(a.champs.recommande)).filter((x): x is number => x !== null);
      if (r.length < 3) return inconnu;
      const nps = Math.round(100 * (r.filter((x) => x >= 9).length - r.filter((x) => x <= 6).length) / r.length);
      return { valeur: nps, mesure: `NPS ${nps >= 0 ? '+' : ''}${nps}` };
    },
  },
  {
    id: 'clients_ecoutes', domaine: 'commercial', libelle: 'Clients interrogés dans l’année', mauvais: 0.1, bon: 0.6,
    source: 'Avis clients', conseil: 'Envoyez le formulaire de satisfaction à tous les clients sans avis (un clic, page Satisfaction).', aLancer: true,
    mesurer: (c) => {
      const cl = clients(c);
      if (!cl.length) return inconnu;
      const avec = new Set(c.parType('avis_client').filter((a) => { const d = date(a.champs.recu_le); return d === null || c.auj - d < 365 * JOUR; }).map((a) => a.champs.concerne));
      const r = cl.filter((x) => avec.has(x.id)).length / cl.length;
      return { valeur: r, mesure: `${pct(r)} des clients` };
    },
  },
  {
    id: 'carnet_commandes', domaine: 'commercial', libelle: 'Carnet de commandes', poids: 2, mauvais: 0.5, bon: 3,
    source: 'Commandes clients en cours + charges mensuelles', conseil: 'Moins d’un mois de travail devant vous : lancez une action commerciale (anciens clients, appels d’offres Breizhcosystem).',
    mesurer: (c) => {
      const ch = chargesMensuelles(c);
      const enCours = c.parType('commande_client').filter((x) => x.champs.statut === 'en cours');
      if (!ch || !c.parType('commande_client').length) return inconnu;
      const r = somme(enCours.map((x) => num(x.champs.montant) ?? 0)) / ch;
      return { valeur: r, mesure: `${fr(r)} mois de charges couverts` };
    },
  },
  {
    id: 'dependance_client', domaine: 'commercial', libelle: 'Dépendance au premier client', mauvais: 0.5, bon: 0.15,
    source: 'Factures et commandes clients', conseil: 'Au-delà de 30 % sur un seul client, diversifiez : un départ mettrait l’entreprise en danger.',
    mesurer: (c) => {
      const parClient = new Map<string, number>();
      for (const x of [...facturesClients(c), ...c.parType('commande_client')]) {
        const id = String(x.champs.tiers ?? x.champs.client ?? '');
        if (id) parClient.set(id, (parClient.get(id) ?? 0) + (num(x.champs.montant) ?? 0));
      }
      const v = [...parClient.values()].filter((x) => x > 0);
      if (v.length < 3) return inconnu;
      const r = Math.max(...v) / somme(v);
      return { valeur: r, mesure: `${pct(r)} du chiffre d’affaires suivi` };
    },
  },
  {
    id: 'prospection', domaine: 'commercial', libelle: 'Prospects en cours', mauvais: 0.05, bon: 0.3,
    source: 'Tiers au rôle « prospect »', conseil: 'Gardez au moins un prospect pour trois clients : Breizhcosystem vous propose des entreprises qui ont besoin de vous.', aLancer: true,
    mesurer: (c) => {
      const cl = clients(c).length;
      if (!cl) return inconnu;
      const r = c.objets.filter((o) => o.famille === 'tiers' && o.roles.includes('prospect')).length / cl;
      return { valeur: r, mesure: `${fr(r, 2)} prospect par client` };
    },
  },
  // ------------------------------------------------------------------ opérations
  {
    id: 'ruptures', domaine: 'operations', libelle: 'Articles sous le seuil d’alerte', poids: 2, mauvais: 0.3, bon: 0,
    source: 'Stock (quantité et seuil d’alerte)', conseil: 'Activez le réapprovisionnement automatique ; Breizhcosystem propose des fournisseurs disponibles en cas de rupture.',
    mesurer: (c) => {
      const a = c.parType('article').filter((x) => num(x.champs.quantite) !== null && num(x.champs.seuil_alerte) !== null);
      if (!a.length) return inconnu;
      const r = a.filter((x) => (num(x.champs.quantite) as number) < (num(x.champs.seuil_alerte) as number)).length / a.length;
      return { valeur: r, mesure: `${pct(r)} des articles suivis` };
    },
  },
  {
    id: 'projets_retard', domaine: 'operations', libelle: 'Projets en retard', poids: 2, mauvais: 0.4, bon: 0,
    source: 'Projets (retard en jours)', conseil: 'Renforcez les projets en retard depuis le planning ; un sous-traitant Breizhcosystem peut absorber le surplus.',
    mesurer: (c) => {
      const p = c.parType('projet').filter((x) => num(x.champs.retard_jours) !== null);
      if (!p.length) return inconnu;
      const r = p.filter((x) => (num(x.champs.retard_jours) as number) > 0).length / p.length;
      return { valeur: r, mesure: `${pct(r)} des projets` };
    },
  },
  {
    id: 'livraisons_clients', domaine: 'operations', libelle: 'Livraisons clients en retard', mauvais: 0.3, bon: 0,
    source: 'Commandes clients (livraison prévue)', conseil: 'Prévenez le client avant la date : un retard annoncé coûte moins qu’un retard subi.',
    mesurer: (c) => {
      const l = c.parType('commande_client').filter((x) => x.champs.statut === 'en cours' && date(x.champs.livraison_prevue) !== null);
      if (!l.length) return inconnu;
      const r = l.filter((x) => (date(x.champs.livraison_prevue) as number) < c.auj).length / l.length;
      return { valeur: r, mesure: `${pct(r)} des commandes en cours` };
    },
  },
  {
    id: 'livraisons_fournisseurs', domaine: 'operations', libelle: 'Livraisons fournisseurs en retard', mauvais: 0.3, bon: 0,
    source: 'Commandes fournisseurs', conseil: 'Fournisseur souvent en retard : comparez avec les fournisseurs du réseau Breizhcosystem.',
    mesurer: (c) => {
      const l = c.parType('commande_fournisseur').filter((x) => x.champs.statut !== 'reçue' && date(x.champs.livraison_prevue) !== null);
      if (!c.parType('commande_fournisseur').length) return inconnu;
      const r = l.length ? l.filter((x) => (date(x.champs.livraison_prevue) as number) < c.auj).length / l.length : 0;
      return { valeur: r, mesure: `${pct(r)} des commandes attendues` };
    },
  },
  {
    id: 'dependance_fournisseur', domaine: 'operations', libelle: 'Dépendance au premier fournisseur', mauvais: 0.7, bon: 0.3,
    source: 'Commandes fournisseurs', conseil: 'Gardez un second fournisseur pour vos achats critiques.',
    mesurer: (c) => {
      const par = new Map<string, number>();
      for (const x of c.parType('commande_fournisseur')) { const id = String(x.champs.fournisseur ?? ''); if (id) par.set(id, (par.get(id) ?? 0) + (num(x.champs.montant) ?? 0)); }
      const v = [...par.values()].filter((x) => x > 0);
      if (v.length < 2) return inconnu;
      const r = Math.max(...v) / somme(v);
      return { valeur: r, mesure: `${pct(r)} des achats suivis` };
    },
  },
  {
    id: 'vehicules', domaine: 'operations', libelle: 'Véhicules en règle', mauvais: 0.5, bon: 1,
    source: 'Véhicules (révision, contrôle technique, pneus)', conseil: 'Planifiez révisions et contrôles techniques : l’automatisation « Véhicules » crée les tâches à temps.',
    mesurer: (c) => {
      const v = c.parType('vehicule');
      if (!v.length) return inconnu;
      const ok = v.filter((x) => {
        const r = date(x.champs.prochaine_revision);
        const ct = date(x.champs.controle_technique);
        return (r === null || r >= c.auj) && (ct === null || ct >= c.auj) && x.champs.etat_pneus !== 'à changer';
      }).length;
      return { valeur: ok / v.length, mesure: `${ok} ${pl(v.length, 'véhicule', 'véhicules')} sur ${v.length}` };
    },
  },
  {
    id: 'equipements', domaine: 'operations', libelle: 'Équipements disponibles', mauvais: 0.6, bon: 1,
    source: 'Équipements', conseil: 'Un équipement en panne immobilise une équipe : Breizhcosystem trouve un loueur proche.',
    mesurer: (c) => {
      const e = c.parType('equipement').filter((x) => typeof x.champs.disponible === 'boolean');
      if (!e.length) return inconnu;
      const r = e.filter((x) => x.champs.disponible === true).length / e.length;
      return { valeur: r, mesure: `${pct(r)} disponibles` };
    },
  },
  {
    id: 'taches_retard', domaine: 'operations', libelle: 'Tâches en retard', mauvais: 0.4, bon: 0,
    source: 'Tâches (échéance)', conseil: 'Faites le point chaque lundi sur les tâches dépassées ; replanifiez ou déléguez.',
    mesurer: (c) => {
      const t = c.parType('tache').filter((x) => x.champs.statut !== 'terminée' && date(x.champs.echeance) !== null);
      if (!c.parType('tache').length) return inconnu;
      const r = t.length ? t.filter((x) => (date(x.champs.echeance) as number) < c.auj).length / t.length : 0;
      return { valeur: r, mesure: `${pct(r)} des tâches ouvertes` };
    },
  },
  {
    id: 'taches_bloquees', domaine: 'operations', libelle: 'Tâches bloquées', mauvais: 0.3, bon: 0,
    source: 'Tâches (statut)', conseil: 'Une tâche bloquée attend souvent une décision : levez le blocage en premier.',
    mesurer: (c) => {
      const t = c.parType('tache').filter((x) => x.champs.statut !== 'terminée');
      if (!c.parType('tache').length) return inconnu;
      const r = t.length ? t.filter((x) => x.champs.statut === 'bloquée').length / t.length : 0;
      return { valeur: r, mesure: `${pct(r)} des tâches ouvertes` };
    },
  },
  // ------------------------------------------------------------------ social
  {
    id: 'climat', domaine: 'social', libelle: 'Climat d’équipe', poids: 2, mauvais: 5, bon: 8,
    source: 'Baromètre d’équipe anonyme (résultats publiés par lots d’au moins 5 réponses)', conseil: 'Partagez les résultats du baromètre et choisissez une action concrète avec l’équipe.',
    mesurer: (c) => {
      const n = c.parType('barometre').filter((b) => { const d = date(b.champs.recu_le); return d === null || c.auj - d < 180 * JOUR; }).map((b) => num(b.champs.note)).filter((x): x is number => x !== null);
      if (n.length < 3) return inconnu;
      const m = moyenne(n) as number;
      return { valeur: m, mesure: `${fr(m)}/10 (${n.length} réponses)` };
    },
  },
  {
    id: 'charge_tenable', domaine: 'social', libelle: 'Charge de travail tenable', mauvais: 4, bon: 8,
    source: 'Baromètre : « ta charge est-elle tenable ? »', conseil: 'Charge jugée intenable : redistribuez au planning, renforcez avec l’intérim ou un prêt de personnel Breizhcosystem.',
    mesurer: (c) => {
      const n = c.parType('barometre').map((b) => num(b.champs.charge)).filter((x): x is number => x !== null);
      if (n.length < 3) return inconnu;
      const m = moyenne(n) as number;
      return { valeur: m, mesure: `${fr(m)}/10` };
    },
  },
  {
    id: 'participation', domaine: 'social', libelle: 'Participation au baromètre', mauvais: 0.1, bon: 0.6,
    source: 'Baromètre (90 jours) et effectif', conseil: 'Envoyez le baromètre à toute l’équipe : il est anonyme et prend 30 secondes.', aLancer: true,
    mesurer: (c) => {
      const eff = personnesEnPoste(c.objets).length;
      if (!eff) return inconnu;
      const n = c.parType('barometre').filter((b) => { const d = date(b.champs.recu_le); return d !== null && c.auj - d < 90 * JOUR; }).length;
      const r = Math.min(1, n / eff);
      return { valeur: r, mesure: `${n} ${n > 1 ? 'réponses' : 'réponse'} pour ${eff} ${eff > 1 ? 'personnes' : 'personne'}` };
    },
  },
  {
    id: 'absenteisme', domaine: 'social', libelle: 'Absences maladie', mauvais: 0.08, bon: 0.02, motifs: true,
    source: 'Planning des équipes', conseil: 'Absentéisme élevé : écoutez le baromètre (charge, ambiance) avant tout.',
    mesurer: (c) => {
      const cases = casesPlanning(c).filter((v) => v !== '');
      if (cases.length < 10) return inconnu;
      const r = cases.filter((v) => v === 'absence:maladie').length / cases.length;
      return { valeur: r, mesure: `${pct(r)} des jours planifiés` };
    },
  },
  {
    id: 'formation', domaine: 'social', libelle: 'Temps de formation', mauvais: 0, bon: 0.03, motifs: true,
    source: 'Planning des équipes', conseil: 'Visez environ une journée de formation par personne et par mois (OPCO : souvent financée).',
    mesurer: (c) => {
      const cases = casesPlanning(c).filter((v) => v !== '');
      if (cases.length < 10) return inconnu;
      const r = cases.filter((v) => v === 'absence:formation').length / cases.length;
      return { valeur: r, mesure: `${pct(r)} des jours planifiés` };
    },
  },
  {
    id: 'affectation', domaine: 'social', libelle: 'Équipe affectée (sans trou de planning)', mauvais: 0.7, bon: 1,
    source: 'Planning des équipes', conseil: 'Remplissez les trous du planning ou proposez la capacité libre au réseau Breizhcosystem.',
    mesurer: (c) => {
      const cases = casesPlanning(c).filter((v) => v !== 'absence' && !v.startsWith('absence:'));
      if (cases.length < 10) return inconnu;
      const r = cases.filter((v) => v !== '').length / cases.length;
      return { valeur: r, mesure: `${pct(r)} des jours de présence affectés` };
    },
  },
  {
    id: 'effectif_besoins', domaine: 'social', libelle: 'Effectif face aux besoins du jour', mauvais: 0.7, bon: 1,
    source: 'Planning du jour et besoins des lieux / projets', conseil: 'Sous-effectif : réaffectez, ou faites appel à un renfort du réseau.',
    mesurer: (c) => {
      const jour = new Date(c.auj).toISOString().slice(0, 10);
      const cibles = c.objets.filter((o) => (o.famille === 'lieu' || o.famille === 'projet') && (num(o.champs.besoin_effectif) ?? 0) > 0);
      if (!cibles.length) return inconnu;
      const taux = cibles.map((o) => {
        const v = `${o.famille === 'lieu' ? 'lieu' : 'projet'}:${o.id}`;
        let n = 0;
        for (const jours of c.planning.values()) if (jours.get(jour) === v) n++;
        return Math.min(1, n / (num(o.champs.besoin_effectif) as number));
      });
      const r = moyenne(taux) as number;
      return { valeur: r, mesure: `${pct(r)} des besoins couverts aujourd’hui` };
    },
  },
  {
    id: 'disponibilite', domaine: 'social', libelle: 'Personnes disponibles', mauvais: 0.8, bon: 0.97,
    source: 'Fiches employés (disponibilité)', conseil: 'Anticipez les congés au planning pour garder l’équipe au complet.',
    mesurer: (c) => {
      const e = c.objets.filter((o) => o.famille === 'personne' && typeof o.champs.disponibilite === 'string');
      if (!e.length) return inconnu;
      const r = e.filter((x) => x.champs.disponibilite === 'disponible').length / e.length;
      return { valeur: r, mesure: `${pct(r)} de l’équipe` };
    },
  },
  // ------------------------------------------------------------------ gestion
  {
    id: 'papiers_valides', domaine: 'gestion', libelle: 'Papiers à jour', poids: 2, mauvais: 0.7, bon: 1,
    source: 'Documents (date de validité)', conseil: 'Attestations, assurances, Kbis : un papier expiré peut bloquer un paiement ou un appel d’offres.',
    mesurer: (c) => {
      const d = c.parType('document').filter((x) => date(x.champs.valide_jusqu_au) !== null);
      if (!d.length) return inconnu;
      const r = d.filter((x) => (date(x.champs.valide_jusqu_au) as number) >= c.auj).length / d.length;
      return { valeur: r, mesure: `${pct(r)} des documents suivis` };
    },
  },
  {
    id: 'papiers_echeance', domaine: 'gestion', libelle: 'Papiers qui expirent sous 30 jours', mauvais: 0.3, bon: 0,
    source: 'Documents', conseil: 'Renouvelez maintenant (automatisation « Documents » : tâche créée 30 jours avant).',
    mesurer: (c) => {
      const d = c.parType('document').filter((x) => date(x.champs.valide_jusqu_au) !== null);
      if (!d.length) return inconnu;
      const r = d.filter((x) => { const v = date(x.champs.valide_jusqu_au) as number; return v >= c.auj && v - c.auj < 30 * JOUR; }).length / d.length;
      return { valeur: r, mesure: `${pct(r)} des documents` };
    },
  },
  {
    id: 'courrier_traite', domaine: 'gestion', libelle: 'Courrier traité', mauvais: 0.5, bon: 0.95,
    source: 'Courrier (reçu depuis plus de 2 jours)', conseil: 'Triez le courrier chaque matin : le tri automatique propose bac, urgence et destinataire.',
    mesurer: (c) => {
      const l = c.parType('courrier').filter((x) => { const d = date(x.champs.recu_le); return d !== null && c.auj - d > 2 * JOUR; });
      if (!l.length) return inconnu;
      const r = l.filter((x) => x.champs.statut === 'traité').length / l.length;
      return { valeur: r, mesure: `${pct(r)} du courrier` };
    },
  },
  {
    id: 'courrier_urgent', domaine: 'gestion', libelle: 'Courrier urgent en attente', mauvais: 3, bon: 0,
    source: 'Courrier', conseil: 'Traitez l’urgent avant tout le reste ; l’automatisation « Courrier urgent » crée la tâche tout de suite.',
    mesurer: (c) => {
      const l = c.parType('courrier');
      if (!l.length) return inconnu;
      const n = l.filter((x) => x.champs.urgence === 'haute' && x.champs.statut !== 'traité').length;
      return { valeur: n, mesure: `${n} ${pl(n, 'courrier urgent', 'courriers urgents')}` };
    },
  },
  {
    id: 'taches_attribuees', domaine: 'gestion', libelle: 'Tâches attribuées à quelqu’un', mauvais: 0.5, bon: 1,
    source: 'Tâches (responsable)', conseil: 'Une tâche sans responsable n’est faite par personne.',
    mesurer: (c) => {
      const t = c.parType('tache').filter((x) => x.champs.statut !== 'terminée');
      if (!t.length) return inconnu;
      const r = t.filter((x) => typeof x.champs.responsable === 'string' && x.champs.responsable !== '').length / t.length;
      return { valeur: r, mesure: `${pct(r)} des tâches ouvertes` };
    },
  },
  {
    id: 'contacts', domaine: 'gestion', libelle: 'Fiches clients et fournisseurs joignables', mauvais: 0.3, bon: 0.9,
    source: 'Tiers (e-mail ou contact)', conseil: 'Complétez les e-mails : formulaires, relances et invitations Breizhcosystem en dépendent.',
    mesurer: (c) => {
      const t = c.objets.filter((o) => o.famille === 'tiers');
      if (!t.length) return inconnu;
      const r = t.filter((x) => (typeof x.champs.email === 'string' && x.champs.email) || (typeof x.champs.contact === 'string' && x.champs.contact)).length / t.length;
      return { valeur: r, mesure: `${pct(r)} des fiches` };
    },
  },
  {
    id: 'donnees_a_jour', domaine: 'gestion', libelle: 'Données à jour', mauvais: 0.5, bon: 0.95,
    source: 'Date de mise à jour de chaque fiche', conseil: 'Branchez vos outils : les données se mettent à jour toutes seules.',
    mesurer: (c) => {
      const l = c.objets.filter((o) => o.famille !== 'organisation');
      if (!l.length) return inconnu;
      const r = l.filter((o) => fraicheur(o.majLe, c.maintenant, c.ageMaxMs) === 'fraiche').length / l.length;
      return { valeur: r, mesure: `${pct(r)} des fiches` };
    },
  },
  {
    id: 'fiche_entreprise', domaine: 'gestion', libelle: 'Fiche entreprise complète', mauvais: 0.3, bon: 1,
    source: 'Fiche entreprise', conseil: 'Complétez SIRET, secteur, effectif et chiffres clés : ils débloquent le score financier et la comparaison Breizhcosystem.',
    mesurer: (c) => {
      if (!c.org) return inconnu;
      const champs = ['siret', 'secteur', 'ville', 'effectif', 'tresorerie', 'charges_mensuelles', 'chiffre_affaires_annuel', 'marge_brute'];
      const r = champs.filter((k) => c.org?.champs[k] !== undefined && c.org.champs[k] !== '').length / champs.length;
      return { valeur: r, mesure: `${Math.round(r * champs.length)}/${champs.length} informations` };
    },
  },
  // ------------------------------------------------------------------ outils & automatisation
  {
    id: 'outils_branches', domaine: 'automatisation', libelle: 'Outils branchés', mauvais: 0, bon: 3,
    source: 'Réglages → Outils branchés', conseil: 'Branchez au moins votre comptabilité, votre CRM et votre banque : plus de double saisie.', aLancer: true,
    mesurer: (c) => (c.modules ? { valeur: c.modules.connecteursActifs, mesure: `${c.modules.connecteursActifs} ${pl(c.modules.connecteursActifs, 'logiciel connecté', 'logiciels connectés')}` } : inconnu),
  },
  {
    id: 'synchro_ok', domaine: 'automatisation', libelle: 'Synchronisations sans erreur', mauvais: 0.5, bon: 1,
    source: 'Réglages → Outils branchés', conseil: 'Corrigez la connexion en erreur (jeton expiré le plus souvent).',
    mesurer: (c) => {
      if (!c.modules || !c.modules.connecteursActifs) return inconnu;
      const r = 1 - c.modules.connecteursEnErreur / c.modules.connecteursActifs;
      return { valeur: r, mesure: `${c.modules.connecteursActifs - c.modules.connecteursEnErreur}/${c.modules.connecteursActifs} sans erreur` };
    },
  },
  {
    id: 'automatisations', domaine: 'automatisation', libelle: 'Automatisations actives', mauvais: 0, bon: 5,
    source: 'Page Optimiser', conseil: 'Activez les automatisations proposées : relances, réapprovisionnement, papiers, satisfaction.', aLancer: true,
    mesurer: (c) => (c.modules ? { valeur: c.modules.automatisationsActives, mesure: `${c.modules.automatisationsActives} ${pl(c.modules.automatisationsActives, 'automatisation active', 'automatisations actives')}` } : inconnu),
  },
  {
    id: 'temps_recuperable', domaine: 'automatisation', libelle: 'Temps encore perdu en tâches répétitives', poids: 2, mauvais: 40, bon: 2,
    source: 'Page Optimiser (estimation)', conseil: 'Chaque heure récupérée chaque mois, c’est du temps pour vos clients : voir Optimiser.',
    mesurer: (c) => (c.modules?.heuresRecuperables === null || !c.modules ? inconnu : { valeur: c.modules.heuresRecuperables, mesure: `${fr(c.modules.heuresRecuperables, 0)} h/mois récupérables` }),
  },
];

export const NOMBRE_CRITERES = DEFINITIONS.length;

/** Texte montré à la place de la source d'un critère réservé. */
export const SOURCE_RESERVEE = 'Réservé aux profils qui voient les motifs d’absence';

const statutDe = (s: number | null): CritereSante['statut'] => (s === null ? 'inconnu' : s >= 75 ? 'bon' : s >= 45 ? 'moyen' : 'faible');

/** Au-delà de ce nombre de jours de données, un zéro redevient une note : la pratique aurait eu le temps d'être lancée. */
export const JOURS_AVANT_NOTE = 30;
/** Jours de données de l'entreprise : du plus ancien objet connu à aujourd'hui (0 le jour de l'installation). */
export function joursDeDonnees(objets: readonly ObjetMetier[], maintenant: Date): number {
  const dates = objets.map((o) => Date.parse(o.majLe)).filter((d) => Number.isFinite(d));
  return dates.length ? Math.max(0, (maintenant.getTime() - Math.min(...dates)) / JOUR) : 0;
}

export function evaluerSante(e: EntreeSante): ResultatSante {
  const auj = Date.parse(`${e.maintenant.toISOString().slice(0, 10)}T00:00:00Z`);
  const index = new Map<string, ObjetMetier[]>();
  for (const o of e.objets) {
    const l = index.get(o.type);
    if (l) l.push(o); else index.set(o.type, [o]);
  }
  const c: Contexte = {
    objets: e.objets, parType: (t) => index.get(t) ?? [], parId: new Map(e.objets.map((o) => [o.id, o])),
    org: e.objets.find((o) => o.famille === 'organisation'), auj, planning: e.planning, modules: e.modules, ageMaxMs: e.ageMaxMs, maintenant: e.maintenant,
  };
  const jeune = joursDeDonnees(e.objets, e.maintenant) < JOURS_AVANT_NOTE;
  const criteres: CritereSante[] = DEFINITIONS.map((d) => {
    // motifs d'absence réservés : critère « inconnu » pour ce profil (masquer les cases donnerait 0 %, une fausse bonne note)
    if (d.motifs && e.motifsAbsence === false) {
      return { id: d.id, domaine: d.domaine, libelle: d.libelle, poids: d.poids ?? 1, score: null, mesure: null, valeur: null, statut: 'inconnu', source: SOURCE_RESERVEE, conseil: d.conseil, reserve: true };
    }
    let m: Mesure;
    try { m = d.mesurer(c); } catch { m = inconnu; }
    const score = m.valeur === null || !Number.isFinite(m.valeur) ? null : echelle(m.valeur, d.mauvais, d.bon);
    // entreprise toute neuve : une pratique pas encore lancée est « À lancer », pas « 0 sur 100 » — et elle ne pèse pas
    if (d.aLancer && score === 0 && jeune) {
      return { id: d.id, domaine: d.domaine, libelle: d.libelle, poids: d.poids ?? 1, score: null, mesure: 'À lancer', valeur: null, statut: 'inconnu', source: d.source, conseil: d.conseil, aLancer: true };
    }
    return { id: d.id, domaine: d.domaine, libelle: d.libelle, poids: d.poids ?? 1, score, mesure: score === null ? null : m.mesure, valeur: score === null ? null : m.valeur, statut: statutDe(score), source: d.source, conseil: d.conseil };
  });
  const domaines: DomaineResultat[] = DOMAINES.map((d) => {
    const l = criteres.filter((x) => x.domaine === d.id);
    const total = somme(l.map((x) => x.poids));
    const connus = l.filter((x) => x.score !== null);
    const poidsConnus = somme(connus.map((x) => x.poids));
    return {
      ...d,
      score: poidsConnus ? Math.round(somme(connus.map((x) => (x.score as number) * x.poids)) / poidsConnus) : null,
      couverture: total ? poidsConnus / total : 0,
      criteres: l,
    };
  });
  const avecScore = domaines.filter((d) => d.score !== null);
  const couverture = somme(criteres.filter((x) => x.score !== null).map((x) => x.poids)) / somme(criteres.map((x) => x.poids));
  const score = avecScore.length ? Math.round(somme(avecScore.map((d) => (d.score as number) * d.couverture)) / somme(avecScore.map((d) => d.couverture))) : null;
  const connus = criteres.filter((x) => x.score !== null);
  const ordre = (a: CritereSante, b: CritereSante) => (a.score as number) - (b.score as number) || b.poids - a.poids;
  return {
    score: couverture >= 0.2 ? score : null,
    couverture,
    fiabilite: couverture >= 0.5 ? 'bonne' : couverture >= 0.2 ? 'provisoire' : 'insuffisante',
    domaines,
    forces: [...connus].sort((a, b) => ordre(b, a)).filter((x) => x.statut === 'bon').slice(0, 3),
    priorites: [...connus].sort(ordre).filter((x) => x.statut !== 'bon').slice(0, 3),
    calculeLe: e.maintenant.toISOString(),
  };
}

/**
 * Sous ce nombre de personnes (fiches « employé »), les notes du domaine social (absences maladie, baromètre,
 * formation, planning) désignent des individus : une note d'absentéisme de 0 dans une entreprise d'un salarié révèle
 * son arrêt maladie (donnée de santé, art. 9 RGPD). Elles ne sortent alors pas de l'entreprise.
 */
export const SEUIL_PARTAGE_SOCIAL = 11;

/**
 * Critères tirés du baromètre d'équipe. La notice remise aux salariés promet que rien de leurs réponses n'est envoyé à
 * l'éditeur du logiciel : ces notes ne sortent donc jamais de l'entreprise, quel que soit l'effectif, et la note du
 * domaine social et la note globale partent recalculées sans elles (contre-revue de l'audit, constat revue-jeu-1-10).
 */
export const CRITERES_BAROMETRE: ReadonlySet<string> = new Set(['climat', 'charge_tenable', 'participation']);

/** Fiches « personne » qui comptent dans l'effectif : pas celles d'anciens salariés, anonymisées (constat revue-jeu-1-11). */
export const personnesEnPoste = (objets: readonly ObjetMetier[]): ObjetMetier[] => objets.filter((o) => o.famille === 'personne' && o.source.id !== 'effacement');

/**
 * Valeurs partageables pour la comparaison Breizhcosystem (gardées par entreprise chez Breizhcosystem : pseudonymes) : ratios et notes uniquement,
 * jamais un montant, un nom ou un identifiant d'objet. `effectif` sous `SEUIL_PARTAGE_SOCIAL` : ni le domaine social
 * ni ses critères, et une note globale recalculée sans lui (sinon elle se déduirait des autres domaines). Les critères
 * du baromètre (`CRITERES_BAROMETRE`) ne partent jamais.
 */
export function ratiosSante(r: ResultatSante, o: { effectif: number }): Record<string, number> {
  const social = o.effectif >= SEUIL_PARTAGE_SOCIAL;
  let retire = !social;
  const domaines = r.domaines.filter((d) => social || d.id !== 'social').map((d) => {
    if (!d.criteres.some((x) => CRITERES_BAROMETRE.has(x.id) && x.score !== null)) return { ...d, criteres: d.criteres.filter((x) => !CRITERES_BAROMETRE.has(x.id)) };
    retire = true;
    const l = d.criteres.filter((x) => !CRITERES_BAROMETRE.has(x.id));
    const connus = l.filter((x) => x.score !== null);
    const poidsConnus = somme(connus.map((x) => x.poids));
    const total = somme(l.map((x) => x.poids));
    return { ...d, criteres: l, score: poidsConnus ? Math.round(somme(connus.map((x) => (x.score as number) * x.poids)) / poidsConnus) : null, couverture: total ? poidsConnus / total : 0 };
  });
  const sortie: Record<string, number> = {};
  if (r.score !== null) {
    const avecScore = domaines.filter((d) => d.score !== null && d.couverture > 0);
    const poids = somme(avecScore.map((d) => d.couverture));
    // rien de retiré : la note globale du jeu ; sinon recalculée sans ce qui ne part pas (elle ne doit pas le laisser deviner)
    const global = !retire ? r.score : poids ? Math.round(somme(avecScore.map((d) => (d.score as number) * d.couverture)) / poids) : null;
    if (global !== null) sortie.global = global;
  }
  for (const d of domaines) if (d.score !== null) sortie[`domaine.${d.id}`] = d.score;
  for (const d of domaines) for (const x of d.criteres) if (x.score !== null) sortie[`critere.${x.id}`] = x.score;
  return sortie;
}
