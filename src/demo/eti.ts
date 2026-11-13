/**
 * Second exemple de DÉMONSTRATION — entreprise organisée en DÉPARTEMENTS, entièrement fictive.
 * « Armor Distribution » : 7 départements, 40 employés modélisés (effectif déclaré 280), tâches,
 * commandes, stock, véhicules et engins rattachés à leur département. Tout objet est en mode `demo`.
 */
import type { ObjetMetier, Provenance, Source, ValeurChamp } from '../core/model.ts';
import { ORG_DEMO } from './donnees.ts';

export const NOM_ORG_ETI = 'Armor Distribution (entreprise fictive)';

const SOURCES: Record<string, Source> = {
  demo: { id: 'demo:eti-v1', libelle: 'Jeu de données de démonstration', derniereSynchro: null },
  erp: { id: 'demo:erp', libelle: 'Export ERP (fictif)', derniereSynchro: null },
  compta: { id: 'demo:compta', libelle: 'Export comptable (fictif)', derniereSynchro: null },
  rh: { id: 'demo:sirh', libelle: 'Planning RH (fictif)', derniereSynchro: null },
  courrier: { id: 'demo:boite-mail', libelle: 'Boîte mail (fictive)', derniereSynchro: null },
  flotte: { id: 'demo:flotte', libelle: 'Suivi de flotte (fictif)', derniereSynchro: null },
};

const DEPARTEMENTS = [
  { id: 'd-direction', nom: 'Direction', couleur: 'ardoise', lieu: 'l-siege', mission: 'Cap, arbitrages, pilotage' },
  { id: 'd-commercial', nom: 'Commercial', couleur: 'bleu', lieu: 'l-siege', mission: 'Ventes, devis, grands comptes' },
  { id: 'd-service-client', nom: 'Service client', couleur: 'jaune', lieu: 'l-agence', mission: 'Commandes, réclamations, SAV' },
  { id: 'd-production', nom: 'Production', couleur: 'orange', lieu: 'l-atelier', mission: 'Fabrication, conditionnement, projets' },
  { id: 'd-logistique', nom: 'Logistique', couleur: 'vert', lieu: 'l-entrepot', mission: 'Stock, préparation, livraisons' },
  { id: 'd-admin', nom: 'Administration & finance', couleur: 'violet', lieu: 'l-siege', mission: 'Facturation, encaissements, achats' },
  { id: 'd-rh', nom: 'Ressources humaines', couleur: 'turquoise', lieu: 'l-siege', mission: 'Recrutement, planning, formation' },
] as const;

const EQUIPES: Record<string, { postes: string[]; prenoms: string[] }> = {
  'd-direction': { postes: ['Directrice générale', 'Assistante de direction', 'Contrôleur de gestion'], prenoms: ['Anna', 'Rozenn', 'Corentin'] },
  'd-commercial': { postes: ['Directeur commercial', 'Commercial grands comptes', 'Commerciale', 'Commercial', 'Commerciale sédentaire', 'Commercial terrain', 'Chargée d’affaires', 'Assistant commercial'], prenoms: ['Erwan', 'Ronan', 'Klervi', 'Goulven', 'Enora', 'Brieuc', 'Morgane', 'Tristan'] },
  'd-service-client': { postes: ['Responsable service client', 'Conseillère clientèle', 'Conseiller clientèle', 'Technicienne SAV', 'Conseillère clientèle'], prenoms: ['Soizic', 'Malo', 'Gwenaëlle', 'Ewen', 'Annaig'] },
  'd-production': { postes: ['Responsable de production', 'Technicienne', 'Technicien', 'Opérateur', 'Opératrice', 'Opérateur', 'Régleur', 'Opératrice', 'Technicien maintenance'], prenoms: ['Nolwenn', 'Loïc', 'Solenn', 'Mathurin', 'Azilis', 'Paol', 'Bleuenn', 'Alan', 'Katell'] },
  'd-logistique': { postes: ['Responsable logistique', 'Préparatrice', 'Préparateur', 'Cariste', 'Livreur', 'Livreur', 'Réceptionnaire', 'Gestionnaire de stock'], prenoms: ['Yann', 'Gwen', 'Riwal', 'Typhaine', 'Tanguy', 'Glenn', 'Lénaïg', 'Iwan'] },
  'd-admin': { postes: ['Responsable administrative et financière', 'Comptable', 'Assistante facturation', 'Acheteur'], prenoms: ['Maëlle', 'Awen', 'Jakez', 'Elouan'] },
  'd-rh': { postes: ['Responsable RH', 'Chargée de recrutement', 'Gestionnaire paie'], prenoms: ['Maïwenn', 'Kilian', 'Loeiza'] },
};
const INDISPONIBLES: Record<string, string> = { 'Loïc': 'absent', 'Tanguy': 'en congé', 'Enora': 'en congé', 'Paol': 'absent', 'Kilian': 'en congé' };

export function donneesDemoEti(maintenant: Date): ObjetMetier[] {
  const il_y_a = (minutes: number) => new Date(maintenant.getTime() - minutes * 60_000).toISOString();
  const jour = (j: number) => new Date(maintenant.getTime() + j * 86_400_000).toISOString().slice(0, 10);
  const o = (
    id: string, famille: ObjetMetier['famille'], type: string, nom: string, champs: Record<string, ValeurChamp>,
    opts: { roles?: string[]; source?: keyof typeof SOURCES; age?: number; provenance?: Provenance } = {},
  ): ObjetMetier => {
    const source = SOURCES[opts.source ?? 'demo'] as Source;
    const majLe = il_y_a(opts.age ?? 8);
    return { id, orgId: ORG_DEMO, famille, type, roles: opts.roles ?? [], nom, champs, provenance: opts.provenance ?? 'confirme', source: { ...source, derniereSynchro: majLe }, majLe, disponibilite: 'disponible', mode: 'demo' };
  };
  const res: ObjetMetier[] = [];
  const ajouter = (...x: ObjetMetier[]) => res.push(...x);

  ajouter(o('org', 'organisation', 'mon_entreprise', NOM_ORG_ETI, { secteur: 'Distribution et transformation (démo)', taille: 'ETI ou grande (250 et plus)', effectif: 280, tresorerie: 2350000, charges_mensuelles: 1450000, chiffre_affaires_annuel: 21500000, marge_brute: 29 }));
  ajouter(
    o('l-siege', 'lieu', 'siege', 'Siège — Vannes', { adresse: 'Adresse fictive', besoin_effectif: 11 }),
    o('l-agence', 'lieu', 'site', 'Agence — Rennes', { adresse: 'Adresse fictive', departement: 'd-service-client', besoin_effectif: 7 }),
    o('l-atelier', 'lieu', 'atelier', 'Usine — Lorient', { adresse: 'Adresse fictive', departement: 'd-production', besoin_effectif: 2 }),
    o('l-entrepot', 'lieu', 'entrepot', 'Plateforme — Brest', { adresse: 'Adresse fictive', departement: 'd-logistique', besoin_effectif: 6 }),
  );

  // ---- départements et employés
  for (const d of DEPARTEMENTS) {
    const eq = EQUIPES[d.id] as { postes: string[]; prenoms: string[] };
    eq.prenoms.forEach((prenom, i) => {
      const id = `e-${d.id.slice(2)}-${i}`;
      ajouter(o(id, 'personne', 'employe', `${prenom} (démo)`, {
        lieu: d.id === 'd-commercial' && i >= 5 ? 'l-agence' : d.lieu, departement: d.id, poste: eq.postes[i] ?? 'Collaborateur', equipe: d.nom,
        disponibilite: INDISPONIBLES[prenom] ?? 'disponible',
      }, { source: 'rh', provenance: 'declare' }));
    });
    ajouter(o(d.id, 'departement', 'departement', d.nom, { responsable: `e-${d.id.slice(2)}-0`, couleur: d.couleur, mission: d.mission }));
  }

  // ---- tiers
  const tiers = (id: string, type: string, nom: string, roles: string[], champs: Record<string, ValeurChamp>, source: keyof typeof SOURCES = 'erp') =>
    o(id, 'tiers', type, nom, champs, { roles, source });
  ajouter(
    tiers('t-super', 'entreprise', 'Supermarché Exemple (fictif)', ['client'], { email: 'achats@supermarche-exemple.test', activite: 'Grande distribution', ville: 'Quimper', num_departement: '29', encours: 18400, limite_encours: 25000 }, 'compta'),
    tiers('t-hotel', 'entreprise', 'Hôtel des Embruns (fictif)', ['client'], { email: 'direction@hotel-embruns.test', activite: 'Hôtellerie', ville: 'Quiberon', num_departement: '56', encours: 7200, limite_encours: 6000 }, 'compta'),
    tiers('t-tycoz', 'entreprise', 'Restaurant Ty Coz (fictif)', ['client'], { email: 'contact@tycoz.test', activite: 'Restaurant', ville: 'Lorient', num_departement: '56', encours: 1900, limite_encours: 4000 }, 'compta'),
    tiers('t-boulangerie', 'entreprise', 'Boulangerie Exemple (fictive)', ['client'], { email: 'bonjour@boulangerie-exemple.test', activite: 'Boulangerie', ville: 'Rennes', num_departement: '35', encours: 2600, limite_encours: 2500 }, 'compta'),
    tiers('t-camping', 'entreprise', 'Camping Les Dunes (fictif)', ['client'], { activite: 'Camping', ville: 'Crozon', num_departement: '29', encours: 0, limite_encours: 3000 }, 'compta'),
    tiers('t-cave', 'entreprise', 'Cave des Remparts (fictive)', ['client'], { activite: 'Caviste', ville: 'Vannes', num_departement: '56', encours: 800, limite_encours: 2000 }, 'compta'),
    tiers('t-mairie', 'organisme_public', 'Mairie de Démoville (fictive)', ['client'], { ville: 'Démoville' }),
    tiers('t-college', 'organisme_public', 'Collège Exemple (fictif)', ['client'], { ville: 'Pontivy' }),
    tiers('t-negoce', 'entreprise', 'Négoce Ar Vro (fictif)', ['fournisseur'], { activite: 'Négoce', ville: 'Brest', num_departement: '29' }),
    tiers('t-grossiste', 'entreprise', 'Grossiste Atlantique (fictif)', ['fournisseur'], { activite: 'Grossiste', ville: 'Saint-Nazaire', num_departement: '44' }),
    tiers('t-emballage', 'entreprise', 'Emballages de l’Ouest (fictifs)', ['fournisseur'], { activite: 'Usine d’emballages', ville: 'Loudéac', num_departement: '22' }),
    tiers('t-imprimerie', 'entreprise', 'Imprimerie Démo (fictive)', ['fournisseur'], { activite: 'Imprimerie', ville: 'Vannes', num_departement: '56' }),
    tiers('t-energie', 'entreprise', 'Énergie Bretagne Démo (fictive)', ['fournisseur'], { activite: 'Énergie', ville: 'Rennes', num_departement: '35' }),
    tiers('t-transports', 'entreprise', 'Transports Exemple (fictifs)', ['fournisseur', 'partenaire'], { activite: 'Transport', ville: 'Vannes', num_departement: '56' }),
    tiers('t-coop', 'entreprise', 'Coopérative Démo (fictive)', ['client', 'fournisseur'], { activite: 'Coopérative', ville: 'Saint-Brieuc', num_departement: '22', encours: 4300, limite_encours: 9000 }, 'compta'),
    tiers('t-bet', 'entreprise', 'Bureau d’études Démo (fictif)', ['partenaire'], { activite: 'Ingénierie', ville: 'Rennes', num_departement: '35' }),
    tiers('t-prospect', 'entreprise', 'Brasserie Prospect (fictive)', ['prospect'], { activite: 'Brasserie', ville: 'Morlaix', num_departement: '29' }),
    tiers('t-prospect2', 'entreprise', 'Atelier Prospect (fictif)', ['prospect'], { activite: 'Artisanat', ville: 'Quimperlé', num_departement: '29' }),
    tiers('t-prospect3', 'entreprise', 'Épicerie Prospect (fictive)', ['prospect'], { activite: 'Épicerie fine', ville: 'Dinan', num_departement: '22' }),
  );

  // ---- production : projets, stock atelier, machines
  ajouter(
    o('pr-hotel', 'projet', 'projet', 'Aménagement — Hôtel des Embruns', { lieu: 'l-atelier', departement: 'd-production', client: 't-hotel', montant: 48500, avancement: 70, retard_jours: 0, echeance: jour(18), besoin_effectif: 2 }),
    o('pr-mairie', 'projet', 'projet', 'Équipement — Mairie', { lieu: 'l-atelier', departement: 'd-production', client: 't-mairie', montant: 62000, avancement: 40, retard_jours: 6, echeance: jour(10), besoin_effectif: 3 }),
    o('pr-college', 'projet', 'projet', 'Mobilier — Collège', { lieu: 'l-atelier', departement: 'd-production', client: 't-college', montant: 23800, avancement: 15, retard_jours: 0, echeance: jour(45) }),
    o('a-matiere', 'ressource', 'article', 'Matière première A', { lieu: 'l-atelier', departement: 'd-production', quantite: 140, seuil_alerte: 100, unite: 'kg', fournisseur: 't-negoce' }, { source: 'erp' }),
    o('a-vernis', 'ressource', 'article', 'Vernis', { lieu: 'l-atelier', departement: 'd-production', quantite: 4, seuil_alerte: 10, unite: 'bidons', fournisseur: 't-grossiste' }, { source: 'erp' }),
    o('a-quincaillerie', 'ressource', 'article', 'Quincaillerie', { lieu: 'l-atelier', departement: 'd-production', quantite: 36, seuil_alerte: 20, unite: 'boîtes', fournisseur: 't-negoce' }, { source: 'erp' }),
    o('m-presse', 'ressource', 'equipement', 'Presse', { lieu: 'l-atelier', departement: 'd-production', disponible: true }),
    o('m-scie', 'ressource', 'equipement', 'Centre d’usinage', { lieu: 'l-atelier', departement: 'd-production', disponible: false }, { provenance: 'declare' }),
    o('v-utilitaire', 'ressource', 'vehicule', 'Utilitaire atelier', { lieu: 'l-atelier', departement: 'd-production', immatriculation: 'DEMO-101', disponible: false, genre: 'camionnette', prochaine_revision: jour(-12), controle_technique: jour(120), etat_pneus: 'à changer', kilometrage: 96_400, kilometrage_le: jour(-6), revision_km: 95_000, revision_tous_les_mois: 12, revision_tous_les_km: 20_000, ct_tous_les_mois: 24, assurance_le: jour(55), assurance_tous_les_mois: 12, pneus_le: jour(10), pneus_saison: 'hiver' }, { source: 'flotte' }),
  );

  // ---- logistique : stock plateforme, camions, chariots
  const stock: [string, string, number, number, string, string][] = [
    ['a-cartons', 'Cartons d’expédition', 420, 300, 'unités', 't-emballage'], ['a-palettes', 'Palettes', 38, 60, 'unités', 't-emballage'],
    ['a-film', 'Film étirable', 22, 15, 'rouleaux', 't-emballage'], ['a-panneaux', 'Panneaux', 6, 20, 'unités', 't-negoce'],
    ['a-visserie', 'Visserie', 150, 60, 'boîtes', 't-negoce'], ['a-etiquettes', 'Étiquettes', 9000, 5000, 'unités', 't-imprimerie'],
    ['a-cable', 'Câble', 40, 30, 'mètres', 't-coop'], ['a-colis', 'Colis prêts à partir', 64, 0, 'colis', 't-transports'],
  ];
  for (const [id, nom, q, s, unite, f] of stock) {
    ajouter(o(id, 'ressource', 'article', nom, { lieu: 'l-entrepot', departement: 'd-logistique', quantite: q, seuil_alerte: s, unite, fournisseur: f }, { source: 'erp', age: id === 'a-cable' ? 3 * 24 * 60 : 8 }));
  }
  ajouter(
    o('v-camion1', 'ressource', 'vehicule', 'Camion porteur 1', { lieu: 'l-entrepot', departement: 'd-logistique', immatriculation: 'DEMO-201', disponible: true, genre: 'camion', conducteur: 'e-logistique-4', prochaine_revision: jour(25), controle_technique: jour(-3), etat_pneus: 'bons', kilometrage: 248_700, kilometrage_le: jour(-2), revision_km: 260_000, revision_tous_les_mois: 12, revision_tous_les_km: 30_000, ct_tous_les_mois: 12, assurance_le: jour(18), assurance_tous_les_mois: 12, carte_grise_le: jour(220), pneus_saison: '4 saisons' }, { source: 'flotte' }),
    o('v-camion2', 'ressource', 'vehicule', 'Camion porteur 2', { lieu: 'l-entrepot', departement: 'd-logistique', immatriculation: 'DEMO-202', disponible: true, genre: 'camion', conducteur: 'e-logistique-5', prochaine_revision: jour(-4), controle_technique: jour(200), etat_pneus: 'à surveiller', kilometrage: 189_950, kilometrage_le: jour(-1), revision_km: 190_000, revision_tous_les_mois: 12, revision_tous_les_km: 30_000, ct_tous_les_mois: 12, assurance_le: jour(140), pneus_le: jour(40), pneus_saison: '4 saisons' }, { source: 'flotte' }),
    o('v-camion3', 'ressource', 'vehicule', 'Camion porteur 3', { lieu: 'l-entrepot', departement: 'd-logistique', immatriculation: 'DEMO-203', disponible: true, genre: 'camion', prochaine_revision: jour(60), controle_technique: jour(300), etat_pneus: 'bons', kilometrage: 74_300, kilometrage_le: jour(-4), revision_km: 90_000, revision_tous_les_mois: 12, revision_tous_les_km: 30_000, ct_tous_les_mois: 12, assurance_le: jour(175), pneus_saison: '4 saisons' }, { source: 'flotte' }),
    o('v-voiture1', 'ressource', 'vehicule', 'Voiture commerciale 1', { lieu: 'l-siege', departement: 'd-commercial', immatriculation: 'DEMO-301', disponible: true, genre: 'voiture', prochaine_revision: jour(40), controle_technique: jour(400), etat_pneus: 'bons', kilometrage: 31_800, kilometrage_le: jour(-150), revision_km: 45_000, revision_tous_les_mois: 12, revision_tous_les_km: 15_000, ct_tous_les_mois: 24, assurance_le: jour(95), pneus_saison: 'été' }, { source: 'flotte' }),
    o('v-voiture2', 'ressource', 'vehicule', 'Voiture commerciale 2', { lieu: 'l-agence', departement: 'd-commercial', immatriculation: 'DEMO-302', disponible: true, genre: 'voiture', prochaine_revision: jour(8), controle_technique: jour(90), etat_pneus: 'bons', kilometrage: 88_600, kilometrage_le: jour(-5), revision_km: 90_000, revision_tous_les_mois: 12, revision_tous_les_km: 15_000, ct_tous_les_mois: 24, assurance_le: jour(60), autre_libelle: 'Changement des plaquettes', autre_le: jour(12), autre_tous_les_mois: 18, pneus_saison: 'été' }, { source: 'flotte' }),
    o('m-chariot1', 'ressource', 'equipement', 'Chariot élévateur 1', { lieu: 'l-entrepot', departement: 'd-logistique', disponible: true }),
    o('m-chariot2', 'ressource', 'equipement', 'Chariot élévateur 2', { lieu: 'l-entrepot', departement: 'd-logistique', disponible: true }),
    // ce qui a déjà été fait sur la flotte (montants fictifs)
    o('ev-c1-rev', 'evenement', 'entretien_vehicule', 'Révision ou entretien — Camion porteur 1', { concerne: 'v-camion1', departement: 'd-logistique', echeance: 'révision ou entretien', fait_le: jour(-150), kilometrage: 230_000, cout: 1_340 }, { source: 'flotte', provenance: 'declare' }),
    o('ev-c1-pneus', 'evenement', 'entretien_vehicule', 'Pneus — Camion porteur 1', { concerne: 'v-camion1', departement: 'd-logistique', echeance: 'pneus', fait_le: jour(-80), kilometrage: 241_200, cout: 2_150 }, { source: 'flotte', provenance: 'declare' }),
    o('ev-c2-ct', 'evenement', 'entretien_vehicule', 'Contrôle technique — Camion porteur 2', { concerne: 'v-camion2', departement: 'd-logistique', echeance: 'contrôle technique', fait_le: jour(-165), kilometrage: 176_400, cout: 118 }, { source: 'flotte', provenance: 'declare' }),
    o('ev-v2-rev', 'evenement', 'entretien_vehicule', 'Révision ou entretien — Voiture commerciale 2', { concerne: 'v-voiture2', departement: 'd-commercial', echeance: 'révision ou entretien', fait_le: jour(-330), kilometrage: 75_100, cout: 380 }, { source: 'flotte', provenance: 'declare' }),
  );

  // ---- commercial / service client : devis et commandes ; logistique : achats ; admin : factures
  const cc: [string, string, number, number, string][] = [
    ['t-super', 'CC-501', 12400, -2, 'en cours'], ['t-hotel', 'CC-502', 5400, 3, 'en cours'], ['t-tycoz', 'CC-503', 980, 1, 'en cours'],
    ['t-boulangerie', 'CC-504', 1350, -6, 'en cours'], ['t-camping', 'CC-505', 2200, 9, 'en cours'], ['t-cave', 'CC-506', 640, -1, 'livrée'], ['t-coop', 'CC-507', 3900, 5, 'en cours'],
  ];
  cc.forEach(([client, ref, montant, j, statut], i) => ajouter(o(`cc-${i}`, 'commande', 'commande_client', `Commande client ${ref}`, { departement: i % 3 === 2 ? 'd-service-client' : 'd-commercial', client, montant, livraison_prevue: jour(j), statut }, { source: 'erp' })));
  ajouter(
    o('dv-1', 'commande', 'devis', 'Devis D-71', { departement: 'd-commercial', client: 't-mairie', montant: 31000, statut: 'envoyé' }, { source: 'erp' }),
    o('dv-2', 'commande', 'devis', 'Devis D-72', { departement: 'd-commercial', client: 't-college', montant: 8700, statut: 'envoyé' }, { source: 'erp' }),
    o('dv-3', 'commande', 'devis', 'Devis D-73', { departement: 'd-commercial', client: 't-super', montant: 15200, statut: 'brouillon' }, { source: 'erp' }),
  );
  const cf: [string, string, number, number, string][] = [
    ['t-emballage', 'CF-801', 4200, -3, 'confirmée'], ['t-negoce', 'CF-802', 2300, 2, 'confirmée'], ['t-grossiste', 'CF-803', 860, 6, 'envoyée'], ['t-imprimerie', 'CF-804', 540, -1, 'reçue'], ['t-energie', 'CF-805', 3100, 12, 'confirmée'],
  ];
  cf.forEach(([fournisseur, ref, montant, j, statut], i) => ajouter(o(`cf-${i}`, 'commande', 'commande_fournisseur', `Commande fournisseur ${ref}`, { departement: i === 4 ? 'd-admin' : 'd-logistique', fournisseur, montant, livraison_prevue: jour(j), statut }, { source: 'erp' })));
  const fa: [string, string, number, boolean, number][] = [
    ['t-hotel', 'F-1041', 4300, false, 38], ['t-boulangerie', 'F-1044', 1200, false, 12], ['t-super', 'F-1047', 9800, false, 0], ['t-tycoz', 'F-1048', 640, true, 0], ['t-coop', 'F-1050', 2100, false, 4], ['t-mairie', 'F-1051', 5600, false, 0],
  ];
  fa.forEach(([t, ref, montant, payee, retard], i) => ajouter(o(`fa-${i}`, 'commande', 'facture', `Facture ${ref}`, { departement: 'd-admin', tiers: t, montant, payee, retard_jours: retard }, { source: 'compta' })));

  // ---- tâches : la vie de chaque département
  const taches: [string, string, number, string][] = [
    ['d-direction', 'Préparer le comité de direction', 2, 'en cours'], ['d-direction', 'Valider le budget investissements', -3, 'à faire'], ['d-direction', 'Point mensuel avec les responsables', 6, 'à faire'],
    ['d-commercial', 'Relancer le devis D-71 (Mairie)', -1, 'à faire'], ['d-commercial', 'Préparer le salon professionnel', 12, 'en cours'], ['d-commercial', 'Rendez-vous Supermarché Exemple', 1, 'à faire'], ['d-commercial', 'Mettre à jour les tarifs', 20, 'terminée'], ['d-commercial', 'Prospecter la Brasserie Prospect', 4, 'en cours'],
    ['d-service-client', 'Traiter la réclamation CC-504', -2, 'en cours'], ['d-service-client', 'Rappeler l’Hôtel des Embruns', 0, 'à faire'], ['d-service-client', 'Enquête de satisfaction', 9, 'bloquée'],
    ['d-production', 'Maintenance du centre d’usinage', -5, 'bloquée'], ['d-production', 'Lancer la série Mairie', 1, 'en cours'], ['d-production', 'Contrôle qualité lot 12', 0, 'à faire'], ['d-production', 'Former un opérateur sur la presse', 15, 'à faire'],
    ['d-logistique', 'Inventaire du rayon câble', 1, 'en cours'], ['d-logistique', 'Réception CF-801 en retard', -3, 'bloquée'], ['d-logistique', 'Tournée Quimper', 0, 'en cours'], ['d-logistique', 'Révision camion porteur 2', -4, 'à faire'], ['d-logistique', 'Commander des palettes', 2, 'à faire'],
    ['d-admin', 'Relancer la facture F-1041', -8, 'à faire'], ['d-admin', 'Clôture mensuelle', 5, 'en cours'], ['d-admin', 'Payer CF-804', 3, 'terminée'],
    ['d-rh', 'Recruter un cariste', 14, 'en cours'], ['d-rh', 'Planning des congés d’été', -1, 'à faire'], ['d-rh', 'Entretiens annuels', 30, 'à faire'],
  ];
  taches.forEach(([d, titre, j, statut], i) => ajouter(o(`tk-${i}`, 'tache', 'tache', titre, { departement: d, echeance: jour(j), statut, responsable: `e-${d.slice(2)}-0` }, { source: 'demo' })));

  // ---- courrier du matin (fictif), rattaché aux départements
  const mails: [string, string | null, string, string, string, string, string, string, string][] = [
    ['Supermarché Exemple', 't-super', 'Commande CC-501 : livraison ?', 'Le client relance sur la livraison prévue avant-hier.', 'clients', 'haute', 'd-service-client', 'e-service-client-0', 'Vérifier avec la logistique et répondre'],
    ['Hôtel des Embruns', 't-hotel', 'Relance facture F-1041', 'Le client indique un paiement en cours, demande un RIB.', 'paiements', 'normale', 'd-admin', 'e-admin-1', 'Envoyer le RIB et suivre l’encaissement'],
    ['Emballages de l’Ouest', 't-emballage', 'Retard CF-801', 'Le fournisseur annonce une livraison décalée de 3 jours.', 'fournisseurs', 'haute', 'd-logistique', 'e-logistique-0', 'Prévenir la production, chercher une solution'],
    ['Mairie de Démoville', 't-mairie', 'Devis D-71 : questions', 'Questions techniques sur le devis avant le conseil municipal.', 'clients', 'haute', 'd-commercial', 'e-commercial-0', 'Répondre et proposer un rendez-vous'],
    ['Boulangerie Exemple', 't-boulangerie', 'Réclamation CC-504', 'Produits reçus abîmés, demande d’avoir.', 'clients', 'haute', 'd-service-client', 'e-service-client-1', 'Ouvrir la réclamation et proposer un avoir'],
    ['Énergie Bretagne Démo', 't-energie', 'Contrat d’énergie à renouveler', 'Proposition de renouvellement avant la fin du mois.', 'fournisseurs', 'normale', 'd-admin', 'e-admin-3', 'Comparer et décider'],
    ['Collège Exemple', 't-college', 'Visite du showroom', 'Demande de visite pour choisir le mobilier.', 'clients', 'normale', 'd-commercial', 'e-commercial-2', 'Proposer deux créneaux'],
    ['France Travail (fictif)', null, 'Candidatures cariste', '3 candidatures reçues pour le poste de cariste.', 'équipe', 'normale', 'd-rh', 'e-rh-1', 'Planifier les entretiens'],
    ['Inspection du travail (fictif)', null, 'Affichage obligatoire', 'Rappel des affichages obligatoires à jour.', 'administratif', 'basse', 'd-rh', 'e-rh-0', 'Vérifier les panneaux d’affichage'],
    ['Transports Exemple', 't-transports', 'Tournée de vendredi', 'Proposition d’ajouter une tournée vendredi vers Quimper.', 'fournisseurs', 'basse', 'd-logistique', 'e-logistique-7', 'Confirmer si besoin'],
    ['Bureau d’études Démo', 't-bet', 'Plans du projet Mairie', 'Envoi des plans révisés pour validation.', 'clients', 'normale', 'd-production', 'e-production-0', 'Valider les plans'],
    ['Agence de pub (fictive)', null, 'Offre salon professionnel', 'Proposition de stand au salon de printemps.', 'publicité', 'basse', 'd-commercial', 'e-commercial-0', 'Classer'],
    ['Banque (fictive)', null, 'Relevé mensuel disponible', 'Votre relevé du mois est disponible.', 'paiements', 'basse', 'd-admin', 'e-admin-0', 'Rapprocher les paiements'],
    ['Coopérative Démo', 't-coop', 'Commande CC-507 confirmée', 'La coopérative confirme sa commande et la date.', 'clients', 'normale', 'd-commercial', 'e-commercial-1', 'Rien à faire'],
  ];
  mails.forEach(([expediteur, tiers, objet, resume, bac, urgence, departement, destinataire, action], i) => res.push(o(`m-${i}`, 'evenement', 'courrier', objet, {
    expediteur, ...(tiers ? { tiers } : {}), objet, resume, bac, urgence, departement, destinataire, action,
    recu_le: new Date(maintenant.getTime() - (i * 31 + 15) * 60_000).toISOString(), statut: i >= 12 ? 'traité' : 'à traiter',
  }, { source: 'courrier', age: i * 31 + 15 })));

  // ---- papiers de l'entreprise
  const docs: [string, string, string, string, number, string][] = [
    ['doc-urssaf', 'Attestation de vigilance URSSAF', 'attestation', 'URSSAF', 9, 'd-admin'], ['doc-rc', 'Assurance responsabilité civile', 'assurance', 'Assureur (fictif)', 160, 'd-admin'],
    ['doc-flotte', 'Assurance de la flotte', 'assurance', 'Assureur (fictif)', 22, 'd-logistique'], ['doc-kbis', 'Extrait Kbis', 'immatriculation', 'Greffe', -4, 'd-admin'],
    ['doc-fiscal', 'Attestation de régularité fiscale', 'fiscal', 'Impôts', 70, 'd-admin'], ['doc-iso', 'Certificat qualité', 'certificat', 'Organisme certificateur (fictif)', 28, 'd-production'],
    ['doc-bail', 'Bail de la plateforme de Brest', 'contrat', 'Bailleur (fictif)', 300, 'd-direction'], ['doc-caces', 'CACES des caristes', 'certificat', 'Organisme de formation (fictif)', 35, 'd-rh'],
  ];
  docs.forEach(([id, nom, categorie, organisme, j, departement]) => res.push(o(id, 'evenement', 'document', nom, { categorie, organisme, valide_jusqu_au: jour(j), departement, emplacement: 'Drive › Administratif' }, { source: 'compta' })));

  // ---- satisfaction : avis clients datés (formulaires) et baromètre d'équipe anonyme (par service)
  const avis: [string, number, number, number | null, string | null][] = [
    ['t-super', -150, 8, 8, null], ['t-super', -40, 9, 9, 'Livraisons à l’heure, interlocuteur réactif.'],
    ['t-hotel', -200, 7, 7, null], ['t-hotel', -12, 5, 4, 'Livraison en retard et personne ne nous a prévenus.'],
    ['t-tycoz', -20, 9, 10, 'Très bon suivi, merci à l’équipe.'], ['t-coop', -300, 7, 7, null],
  ];
  avis.forEach(([client, j, note, recommande, commentaire], i) => res.push(o(`av-${i}`, 'evenement', 'avis_client', `Avis — ${client} — ${jour(j)}`, {
    concerne: client, note, ...(recommande !== null ? { recommande } : {}), ...(commentaire ? { commentaire } : {}), recu_le: jour(j), canal: 'formulaire',
  }, { age: -j * 24 })));
  const barometre: [string, number, number, string | null][] = [
    ['d-commercial', 7, 6, null], ['d-commercial', 6, 5, 'Beaucoup de déplacements ce trimestre.'], ['d-commercial', 8, 7, null], ['d-commercial', 5, 4, null], ['d-commercial', 7, 5, null],
    ['d-logistique', 5, 3, 'Le quai est saturé le lundi matin.'], ['d-logistique', 4, 3, null], ['d-logistique', 6, 4, 'Il manque un cariste.'], ['d-logistique', 5, 4, null], ['d-logistique', 6, 5, null],
    ['d-production', 8, 7, null], ['d-production', 7, 6, null],
    ['d-admin', 8, 7, null], ['d-admin', 7, 7, 'Les relances clients prennent trop de temps.'], ['d-admin', 8, 8, null],
  ];
  barometre.forEach(([departement, note, charge, commentaire], i) => res.push(o(`ba-${i}`, 'evenement', 'barometre', `Baromètre — ${jour(-25 - i)}`, {
    departement, note, charge, ...(commentaire ? { commentaire } : {}), recu_le: jour(-25 - i),
  }, { age: (25 + i) * 24 })));

  return res;
}
