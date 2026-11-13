/**
 * Jeu de données de DÉMONSTRATION (R01) — entièrement fictif, univers générique.
 * Noms inventés, aucune personne ni entreprise réelle. Tout objet est en mode `demo`.
 * Horodatages relatifs au démarrage pour illustrer frais / périmé.
 */
import type { ObjetMetier, Provenance, Source, ValeurChamp } from '../core/model.ts';

export const ORG_DEMO = 'org-demo';
export const NOM_ORG_DEMO = 'Démo Breizh (entreprise fictive)';

const SOURCES: Record<string, Source> = {
  demo: { id: 'demo:jeu-v1', libelle: 'Jeu de données de démonstration', derniereSynchro: null },
  tableur: { id: 'demo:tableur-stock', libelle: 'Tableur de stock (fictif)', derniereSynchro: null },
  compta: { id: 'demo:compta', libelle: 'Export comptable (fictif)', derniereSynchro: null },
  rh: { id: 'demo:planning', libelle: 'Planning des équipes (fictif)', derniereSynchro: null },
  courrier: { id: 'demo:boite-mail', libelle: 'Boîte mail (fictive)', derniereSynchro: null },
};

/** Fabrique de courrier fictif : [expéditeur, tiers, objet, résumé, bac, urgence, destinataire, action]. */
function fabriqueCourrier(o: (id: string, f: ObjetMetier['famille'], t: string, n: string, c: Record<string, ValeurChamp>, opts?: { source?: keyof typeof SOURCES; age?: number }) => ObjetMetier, maintenant: Date) {
  return (lignes: [string, string | null, string, string, string, string, string | null, string][], statutAnciens = 'traité', anciens = 0) =>
    lignes.map(([expediteur, tiers, objet, resume, bac, urgence, destinataire, action], i) => o(`m-${i}`, 'evenement', 'courrier', objet, {
      expediteur, ...(tiers ? { tiers } : {}), objet, resume, bac, urgence, ...(destinataire ? { destinataire } : {}), action,
      recu_le: new Date(maintenant.getTime() - (i * 47 + 20) * 60_000).toISOString(), statut: i >= lignes.length - anciens ? statutAnciens : 'à traiter',
    }, { source: 'courrier', age: i * 47 + 20 }));
}

export function donneesDemo(maintenant: Date): ObjetMetier[] {
  const il_y_a = (minutes: number) => new Date(maintenant.getTime() - minutes * 60_000).toISOString();
  const dans = (jours: number) => new Date(maintenant.getTime() + jours * 86_400_000).toISOString().slice(0, 10);
  const o = (
    id: string,
    famille: ObjetMetier['famille'],
    type: string,
    nom: string,
    champs: Record<string, ValeurChamp>,
    opts: { roles?: string[]; source?: keyof typeof SOURCES; age?: number; provenance?: Provenance } = {},
  ): ObjetMetier => {
    const source = SOURCES[opts.source ?? 'demo'] as Source;
    const majLe = il_y_a(opts.age ?? 5);
    return {
      id, orgId: ORG_DEMO, famille, type, roles: opts.roles ?? [], nom, champs,
      provenance: opts.provenance ?? 'confirme',
      source: { ...source, derniereSynchro: majLe },
      majLe, disponibilite: 'disponible', mode: 'demo',
    };
  };
  const courrier = fabriqueCourrier(o, maintenant);
  const employe = (id: string, nom: string, lieu: string, poste: string, equipe: string, dispo = 'disponible') =>
    o(id, 'personne', 'employe', `${nom} (démo)`, { lieu, poste, equipe, disponibilite: dispo }, { source: 'rh', provenance: 'declare' });
  const tiers = (id: string, type: string, nom: string, roles: string[], champs: Record<string, ValeurChamp>, source: keyof typeof SOURCES = 'demo') =>
    o(id, 'tiers', type, nom, champs, { roles, source });

  return [
    o('org', 'organisation', 'mon_entreprise', NOM_ORG_DEMO, { secteur: 'Services et distribution (démo)', taille: 'TPE (moins de 10 personnes)', effectif: 9, tresorerie: 61000, charges_mensuelles: 38000, chiffre_affaires_annuel: 620000, marge_brute: 34 }),

    // ---- Mes lieux
    o('l-siege', 'lieu', 'siege', 'Siège — Quimper', { adresse: 'Adresse fictive', besoin_effectif: 2 }),
    o('l-atelier', 'lieu', 'atelier', 'Atelier — Lorient', { adresse: 'Adresse fictive' }),
    o('l-agence', 'lieu', 'site', 'Agence — Rennes', { adresse: 'Adresse fictive', besoin_effectif: 1 }),
    o('l-entrepot', 'lieu', 'entrepot', 'Entrepôt — Brest', { adresse: 'Adresse fictive', besoin_effectif: 2 }),

    // ---- Mes employés (prénoms fictifs ; lieu = rattachement, pas une présence constatée)
    employe('e-anna', 'Anna', 'l-siege', 'Dirigeante', 'Direction'),
    employe('e-maelle', 'Maëlle', 'l-siege', 'Comptable', 'Administration'),
    employe('e-erwan', 'Erwan', 'l-agence', 'Commercial', 'Commerce'),
    employe('e-soizic', 'Soizic', 'l-agence', 'Chargée de clientèle', 'Commerce'),
    employe('e-nolwenn', 'Nolwenn', 'l-atelier', 'Technicienne', 'Atelier'),
    employe('e-loic', 'Loïc', 'l-atelier', 'Technicien', 'Atelier', 'absent'),
    employe('e-yann', 'Yann', 'l-entrepot', 'Responsable stock', 'Logistique'),
    employe('e-gwen', 'Gwen', 'l-entrepot', 'Préparatrice', 'Logistique'),
    employe('e-tanguy', 'Tanguy', 'l-entrepot', 'Livreur', 'Logistique', 'en congé'),

    // ---- Mes clients
    tiers('t-tycoz', 'entreprise', 'Restaurant Ty Coz (fictif)', ['client'], { email: 'contact@tycoz.test', activite: 'Restaurant', ville: 'Lorient', num_departement: '56', encours: 4200, limite_encours: 5000 }, 'compta'),
    tiers('t-boulangerie', 'entreprise', 'Boulangerie Exemple (fictive)', ['client'], { email: 'bonjour@boulangerie-exemple.test', activite: 'Boulangerie', ville: 'Rennes', num_departement: '35', encours: 6800, limite_encours: 5000 }, 'compta'),
    tiers('t-hotel', 'entreprise', 'Hôtel des Embruns (fictif)', ['client'], { email: 'direction@hotel-embruns.test', activite: 'Hôtellerie', ville: 'Quiberon', num_departement: '56', encours: 2100, limite_encours: 6000 }, 'compta'),
    tiers('t-camping', 'entreprise', 'Camping Les Dunes (fictif)', ['client'], { activite: 'Camping', ville: 'Crozon', num_departement: '29', encours: 0, limite_encours: 3000 }, 'compta'),
    tiers('t-mairie', 'organisme_public', 'Mairie de Démoville (fictive)', ['client'], { ville: 'Démoville' }),
    tiers('t-famille', 'particulier', 'Famille Exemple (fictive)', ['client'], { ville: 'Douarnenez' }),

    // ---- Mes fournisseurs (un tiers peut être client ET fournisseur)
    tiers('t-negoce', 'entreprise', 'Négoce Ar Vro (fictif)', ['fournisseur'], { activite: 'Négoce de matériaux', ville: 'Brest', num_departement: '29' }),
    tiers('t-grossiste', 'entreprise', 'Grossiste Atlantique (fictif)', ['fournisseur'], { activite: 'Grossiste', ville: 'Saint-Nazaire', num_departement: '44' }),
    tiers('t-imprimerie', 'entreprise', 'Imprimerie Démo (fictive)', ['fournisseur'], { activite: 'Imprimerie', ville: 'Vannes', num_departement: '56' }),
    tiers('t-transports', 'entreprise', 'Transports Exemple (fictifs)', ['fournisseur', 'partenaire'], { activite: 'Transport', ville: 'Vannes', num_departement: '56' }),
    tiers('t-coop', 'entreprise', 'Coopérative Démo (fictive)', ['client', 'fournisseur'], { activite: 'Coopérative', ville: 'Saint-Brieuc', num_departement: '22', encours: 1500, limite_encours: 8000 }, 'compta'),

    // ---- Partenaires et prospects
    tiers('t-bet', 'entreprise', 'Bureau d’études Démo (fictif)', ['partenaire'], { activite: 'Ingénierie', ville: 'Rennes', num_departement: '35' }),
    tiers('t-prospect', 'entreprise', 'Brasserie Prospect (fictive)', ['prospect'], { activite: 'Brasserie', ville: 'Morlaix', num_departement: '29' }),
    tiers('t-prospect2', 'entreprise', 'Atelier Prospect (fictif)', ['prospect'], { activite: 'Artisanat', ville: 'Quimperlé', num_departement: '29' }),

    // ---- Projets
    o('pr-hotel', 'projet', 'projet', 'Rénovation — Hôtel des Embruns', { lieu: 'l-atelier', client: 't-hotel', montant: 18500, avancement: 60, retard_jours: 0, echeance: dans(20), besoin_effectif: 1 }),
    o('pr-mairie', 'projet', 'projet', 'Installation — Mairie', { lieu: 'l-agence', client: 't-mairie', montant: 42000, avancement: 35, retard_jours: 5, echeance: dans(9), besoin_effectif: 1 }),
    o('pr-camping', 'projet', 'projet', 'Équipement — Camping', { lieu: 'l-atelier', client: 't-camping', montant: 9600, avancement: 10, retard_jours: 0, echeance: dans(40) }),

    // ---- Stock
    o('a-panneaux', 'ressource', 'article', 'Panneaux', { lieu: 'l-entrepot', quantite: 6, seuil_alerte: 20, unite: 'unités', fournisseur: 't-negoce' }, { source: 'tableur' }),
    o('a-visserie', 'ressource', 'article', 'Visserie', { lieu: 'l-entrepot', quantite: 120, seuil_alerte: 50, unite: 'boîtes', fournisseur: 't-negoce' }, { source: 'tableur' }),
    o('a-cable', 'ressource', 'article', 'Câble', { lieu: 'l-entrepot', quantite: 40, seuil_alerte: 30, unite: 'mètres', fournisseur: 't-coop' }, { source: 'tableur', age: 3 * 24 * 60 }),
    o('a-cartons', 'ressource', 'article', 'Cartons d’expédition', { lieu: 'l-entrepot', quantite: 220, seuil_alerte: 100, unite: 'unités', fournisseur: 't-grossiste' }, { source: 'tableur' }),
    o('a-peinture', 'ressource', 'article', 'Peinture', { lieu: 'l-atelier', quantite: 3, seuil_alerte: 8, unite: 'pots', fournisseur: 't-grossiste' }, { source: 'tableur' }),
    o('a-joints', 'ressource', 'article', 'Joints', { lieu: 'l-atelier', quantite: 15, seuil_alerte: 10, unite: 'unités' }, { source: 'tableur' }),

    // ---- Véhicules et équipements
    o('v-utilitaire', 'ressource', 'vehicule', 'Utilitaire 1', { lieu: 'l-atelier', immatriculation: 'DEMO-001', disponible: false }, { provenance: 'declare' }),
    o('v-camion', 'ressource', 'vehicule', 'Camion de livraison', { lieu: 'l-entrepot', immatriculation: 'DEMO-002', disponible: true }),
    o('v-voiture', 'ressource', 'vehicule', 'Voiture commerciale', { lieu: 'l-agence', immatriculation: 'DEMO-003', disponible: true }),
    o('e-chariot', 'ressource', 'equipement', 'Chariot élévateur', { lieu: 'l-entrepot', disponible: true }),
    o('e-nacelle', 'ressource', 'equipement', 'Nacelle', { lieu: 'l-atelier', disponible: true }),

    // ---- Commandes, devis, factures
    o('c-negoce', 'commande', 'commande_fournisseur', 'Commande fournisseur CF-104', { fournisseur: 't-negoce', montant: 2300, livraison_prevue: dans(3), statut: 'confirmée' }),
    o('c-grossiste', 'commande', 'commande_fournisseur', 'Commande fournisseur CF-105', { fournisseur: 't-grossiste', montant: 860, livraison_prevue: dans(6), statut: 'envoyée' }),
    o('c-boulangerie', 'commande', 'commande_client', 'Commande client CC-221', { client: 't-boulangerie', montant: 3100, statut: 'en cours' }),
    o('c-hotel', 'commande', 'commande_client', 'Commande client CC-230', { client: 't-hotel', montant: 5400, statut: 'en cours' }),
    o('d-camping', 'commande', 'devis', 'Devis D-17', { client: 't-camping', montant: 9600, statut: 'accepté' }),
    o('f-041', 'commande', 'facture', 'Facture F-041', { tiers: 't-boulangerie', montant: 2900, payee: false, retard_jours: 42 }, { source: 'compta' }),
    o('f-044', 'commande', 'facture', 'Facture F-044', { tiers: 't-tycoz', montant: 1200, payee: true, retard_jours: 0 }, { source: 'compta' }),
    o('f-047', 'commande', 'facture', 'Facture F-047', { tiers: 't-hotel', montant: 2100, payee: false, retard_jours: 12 }, { source: 'compta' }),

    o('ta-point', 'tache', 'tache', 'Préparer le point mensuel', { echeance: dans(2), responsable: 'e-anna', statut: 'à faire', concerne: 'org' }),
    o('ta-inventaire', 'tache', 'tache', 'Inventaire du rayon câble', { echeance: dans(1), responsable: 'e-yann', statut: 'en cours', concerne: 'a-cable' }),

    // ---- courrier du matin (fictif)
    ...courrier([
      ['Boulangerie Exemple', 't-boulangerie', 'Re: facture F-041', 'Le client conteste le montant de la facture F-041 et demande le détail des prestations.', 'paiements', 'haute', 'e-maelle', 'Envoyer le détail et proposer un échéancier'],
      ['Hôtel des Embruns', 't-hotel', 'Date de fin des travaux ?', 'Le client souhaite confirmer la fin des travaux avant le début de saison.', 'clients', 'normale', 'e-erwan', 'Répondre avec la date prévue du projet'],
      ['Négoce Ar Vro', 't-negoce', 'Livraison CF-104 décalée', 'Le fournisseur annonce un décalage de 2 jours pour les panneaux.', 'fournisseurs', 'haute', 'e-yann', 'Prévenir l’atelier et ajuster le planning'],
      ['Mairie de Démoville', 't-mairie', 'Pièces du dossier d’installation', 'Demande de l’attestation d’assurance et du planning d’intervention.', 'administratif', 'normale', 'e-anna', 'Joindre l’attestation et le planning'],
      ['URSSAF (fictif)', null, 'Attestation de vigilance disponible', 'Votre nouvelle attestation est disponible sur votre espace.', 'administratif', 'normale', 'e-maelle', 'Télécharger et classer l’attestation'],
      ['Candidat (fictif)', null, 'Candidature spontanée — technicien', 'CV et lettre pour un poste de technicien à l’atelier.', 'équipe', 'basse', 'e-anna', 'Accuser réception'],
      ['Camping Les Dunes', 't-camping', 'Devis D-17 accepté', 'Le client confirme le devis et demande une date de démarrage.', 'clients', 'haute', 'e-erwan', 'Proposer une date et créer le projet'],
      ['Imprimerie Démo', 't-imprimerie', 'Promotion sur les flyers', 'Offre commerciale sur l’impression de flyers.', 'publicité', 'basse', null, 'Classer'],
    ], 'traité', 2),
    // ---- papiers de l'entreprise
    o('doc-urssaf', 'evenement', 'document', 'Attestation de vigilance URSSAF', { categorie: 'attestation', organisme: 'URSSAF', valide_jusqu_au: dans(12), emplacement: 'Drive › Administratif › Attestations' }, { source: 'compta' }),
    o('doc-rc', 'evenement', 'document', 'Assurance responsabilité civile pro', { categorie: 'assurance', organisme: 'Assureur (fictif)', valide_jusqu_au: dans(210), emplacement: 'Drive › Assurances' }),
    o('doc-decennale', 'evenement', 'document', 'Assurance décennale', { categorie: 'assurance', organisme: 'Assureur (fictif)', valide_jusqu_au: dans(140), emplacement: 'Drive › Assurances' }),
    o('doc-kbis', 'evenement', 'document', 'Extrait Kbis', { categorie: 'immatriculation', organisme: 'Greffe', valide_jusqu_au: dans(-6), emplacement: 'Drive › Administratif', note: 'Moins de 3 mois exigé par la Mairie' }),
    o('doc-fiscal', 'evenement', 'document', 'Attestation de régularité fiscale', { categorie: 'fiscal', organisme: 'Impôts', valide_jusqu_au: dans(45), emplacement: 'Drive › Administratif' }),
    // ---- satisfaction : avis clients datés, baromètre d'équipe anonyme
    o('av-1', 'evenement', 'avis_client', 'Avis — Ty Coz', { concerne: 't-tycoz', note: 8, recommande: 9, recu_le: dans(-60), canal: 'formulaire' }),
    o('av-2', 'evenement', 'avis_client', 'Avis — Hôtel des Embruns', { concerne: 't-hotel', note: 9, recommande: 9, recu_le: dans(-200), canal: 'formulaire' }),
    o('av-3', 'evenement', 'avis_client', 'Avis — Hôtel des Embruns', { concerne: 't-hotel', note: 9, recommande: 10, commentaire: 'Chantier propre et dans les temps.', recu_le: dans(-30), canal: 'formulaire' }),
    o('av-4', 'evenement', 'avis_client', 'Avis — Mairie', { concerne: 't-mairie', note: 6, recommande: 6, commentaire: 'Délais à préciser sur les devis.', recu_le: dans(-15), canal: 'formulaire' }),
    o('av-5', 'evenement', 'avis_client', 'Avis — Famille Exemple', { concerne: 't-famille', note: 10, recommande: 10, recu_le: dans(-90), canal: 'formulaire' }),
    o('ba-1', 'evenement', 'barometre', 'Baromètre', { note: 7, charge: 6, recu_le: dans(-20) }),
    o('ba-2', 'evenement', 'barometre', 'Baromètre', { note: 8, charge: 7, recu_le: dans(-20) }),
    o('ba-3', 'evenement', 'barometre', 'Baromètre', { note: 6, charge: 4, commentaire: 'Trop de déplacements entre Lorient et Rennes.', recu_le: dans(-19) }),
    o('ba-4', 'evenement', 'barometre', 'Baromètre', { note: 7, charge: 6, recu_le: dans(-18) }),
    o('ba-5', 'evenement', 'barometre', 'Baromètre', { note: 8, charge: 7, recu_le: dans(-18) }),
  ];
}

/** Profils de démonstration : rôles et périmètres contrôlés côté serveur. */
export interface Profil {
  id: string;
  nom: string;
  role: 'dirigeant' | 'responsable' | 'collaborateur';
  /** Types d'objets visibles (`'tous'` = tout l'univers). */
  types: readonly string[] | 'tous';
  /** Lieux visibles pour les objets rattachés à un lieu. */
  lieux: readonly string[] | 'tous';
  /** Rôles de tiers visibles (ex. un responsable stock voit les fournisseurs, pas l'encours des clients). */
  rolesTiers: readonly string[] | 'tous';
  /** Départements visibles (objets rattachés à un département). */
  departements: readonly string[] | 'tous';
  peutPreparer: boolean;
  peutApprouver: boolean;
  voitScore: boolean;
  peutAdministrer: boolean;
  /**
   * Droit RH : voir et saisir le MOTIF d'une absence (congé, maladie, formation). Sans lui, une absence s'affiche
   * « Absence », sans motif (un arrêt maladie est une donnée de santé : art. 9 RGPD). Absent des profils enregistrés
   * avant ce droit : vaut `peutAdministrer` (voir `voitMotifsAbsence`).
   */
  voitMotifsAbsence?: boolean;
}

/** Le profil voit-il le motif des absences ? Droit explicite, sinon celui des administrateurs. */
export const voitMotifsAbsence = (p: Profil): boolean => p.voitMotifsAbsence ?? p.peutAdministrer;

export const PROFILS_DEMO: readonly Profil[] = [
  { id: 'dirigeante', nom: 'Anna — dirigeante', role: 'dirigeant', types: 'tous', lieux: 'tous', rolesTiers: 'tous', departements: 'tous', peutPreparer: true, peutApprouver: true, voitScore: true, peutAdministrer: true, voitMotifsAbsence: true },
  {
    id: 'responsable-stock', nom: 'Yann — responsable stock', role: 'responsable',
    types: ['entrepot', 'article', 'equipement', 'vehicule', 'commande_fournisseur', 'entreprise', 'tache', 'employe', 'departement', 'courrier'], lieux: ['l-entrepot'], rolesTiers: ['fournisseur'], departements: ['d-logistique'],
    peutPreparer: true, peutApprouver: false, voitScore: false, peutAdministrer: false, voitMotifsAbsence: false,
  },
  {
    id: 'terrain', nom: 'Nolwenn — technicienne', role: 'collaborateur',
    types: ['atelier', 'projet', 'article', 'tache', 'employe', 'equipement', 'vehicule', 'departement', 'courrier'], lieux: ['l-atelier'], rolesTiers: [], departements: ['d-production'],
    peutPreparer: false, peutApprouver: false, voitScore: false, peutAdministrer: false, voitMotifsAbsence: false,
  },
];
