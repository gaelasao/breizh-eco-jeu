/* Living Business — navigation groupée (direction de design §4.1, §4.2, §6.1 P1).
   Module PUR : aucun accès au DOM ni au stockage, testé par src/ds/coque.test.ts. Il décrit les destinations
   (rail groupé sur ordinateur, barre à 5 onglets sur téléphone, « Aller à » de la palette) ; app.js les dessine.
   Chaque vue existante garde son identifiant (« planning », « role:client », « dep:… ») : aucune route ne disparaît. */
import { pluriel } from './bz/typo.js';

/** Noms sans la mention de démonstration : « Boulangerie Exemple (fictive) » → « Boulangerie Exemple ». */
export const sansDemo = (nom) => String(nom ?? '').replace(/\s*\((?:entreprise )?(fictifs?|fictives?|démo)\)/gi, '');

const valeurDe = (o, id) => o.champs?.find((c) => c.id === id)?.valeur ?? null;

/** Courriers à traiter en urgence (le seul compteur de Relations : une chose due, jamais un total). */
export const courriersUrgents = (m) => (m.objets ?? []).filter((o) => o.type === 'courrier' && valeurDe(o, 'statut') !== 'traité' && valeurDe(o, 'urgence') === 'haute').length;

const deux = (n) => String(n).padStart(2, '0');
const jourDe = (d) => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;
/** Tâches encore à faire : tout ce qui n'est pas terminé (à faire, en cours, bloquée). */
export const tachesOuvertes = (m) => (m.objets ?? []).filter((o) => o.famille === 'tache' && valeurDe(o, 'statut') !== 'terminée');
/** Une tâche ouverte est due si son échéance est aujourd'hui ou passée. */
export const tacheDue = (o, maintenant = new Date()) => { const e = valeurDe(o, 'echeance'); return typeof e === 'string' && e.slice(0, 10) <= jourDe(maintenant); };
/** Tâches dues (le compteur de « Tâches » : une chose due, jamais un total). */
export const tachesDues = (m, maintenant = new Date()) => tachesOuvertes(m).filter((o) => tacheDue(o, maintenant)).length;

const APRESENT = new Set(['depassee', 'aujourdhui', 'bientot']);
/** Échéances de véhicule à prévoir (le compteur de « Véhicules » : une chose due, jamais la taille de la flotte). */
export const echeancesVehicules = (m) => (m.objets ?? [])
  .reduce((n, o) => n + (o.vehicule?.echeances ?? []).filter((e) => APRESENT.has(e.statut)).length, 0);

/**
 * Groupes du rail, dans l'ordre (§6.1 P1) : Aujourd'hui · Planning · Pilotage · Relations · Activité · Réseau.
 * Entrée : { id, vue (vue ouverte au clic), vues (autres vues dont elle est la destination), prefixes, libelle, icone,
 * compte (actions dues seulement, §4.2), compteLibelle (lu par le lecteur d'écran), raccourci }.
 * Options : aFaire (actions d'« Aujourd'hui »), vueAujourdhui ('carte' ou 'matin'), maintenant (pour les tâches dues).
 */
export function groupesNavigation(m, { aFaire = 0, vueAujourdhui = 'carte', maintenant = new Date() } = {}) {
  const u = m.univers ?? { roles: [], types: [] };
  const role = (id, defaut) => u.roles?.find((r) => r.id === id)?.pluriel ?? defaut;
  const famille = (f, defaut) => u.types?.find((t) => t.famille === f)?.pluriel ?? defaut;
  const urgents = courriersUrgents(m);
  const mecontents = m.satisfaction ? Object.values(m.satisfaction.clients ?? {}).filter((c) => c?.statut === 'mauvaise').length : 0;
  const trous = m.planning?.trousAujourdhui || 0;
  const dues = tachesDues(m, maintenant);
  const vehicules = echeancesVehicules(m);
  const p = m.profil ?? {};
  const groupes = [
    { id: 'aujourdhui', libelle: 'Aujourd’hui', entrees: [
      { id: 'aujourdhui', vue: vueAujourdhui, vues: ['carte', 'matin', 'tableau', 'pipeline'], libelle: 'Aujourd’hui', icone: 'house', raccourci: 'g a',
        compte: aFaire, compteLibelle: aFaire ? pluriel(aFaire, 'action à faire', 'actions à faire') : '' },
    ] },
    { id: 'planning', libelle: 'Planning', entrees: [
      { id: 'planning', vue: 'planning', libelle: 'Planning', icone: 'calendar-days', raccourci: 'g p',
        compte: trous, compteLibelle: trous ? pluriel(trous, 'trou au planning aujourd’hui', 'trous au planning aujourd’hui') : '' },
      // les tâches, y compris celles que les automatisations préparent : sans cette entrée, on ne les trouvait que par la recherche
      { id: 'taches', vue: 'famille:tache', libelle: famille('tache', 'Tâches'), icone: 'list-checks',
        compte: dues, compteLibelle: dues ? pluriel(dues, 'tâche à faire aujourd’hui ou en retard', 'tâches à faire aujourd’hui ou en retard') : '' },
      { id: 'equipe', vue: 'famille:personne', libelle: famille('personne', 'Équipe'), icone: 'users' },
    ] },
    { id: 'pilotage', libelle: 'Pilotage', entrees: [
      m.sante ? { id: 'sante', vue: 'sante', libelle: 'Santé', icone: 'heart-pulse' } : null,
      m.optimisations ? { id: 'optimiser', vue: 'optimiser', libelle: 'Optimiser', icone: 'trending-up' } : null,
      m.organisation?.departements ? { id: 'departements', vue: 'departements', prefixes: ['dep:'], libelle: famille('departement', 'Départements'), icone: 'building-2' } : null,
    ] },
    { id: 'relations', libelle: 'Relations', entrees: [
      { id: 'clients', vue: 'role:client', libelle: role('client', 'Clients'), icone: 'handshake' },
      { id: 'fournisseurs', vue: 'role:fournisseur', libelle: role('fournisseur', 'Fournisseurs'), icone: 'truck', raccourci: 'g f' },
      { id: 'courrier', vue: 'courrier', libelle: 'Courrier', icone: 'mail', raccourci: 'g m',
        compte: urgents, compteLibelle: urgents ? pluriel(urgents, 'courrier urgent', 'courriers urgents') : '' },
      m.satisfaction ? { id: 'satisfaction', vue: 'satisfaction', libelle: 'Satisfaction', icone: 'star',
        compte: mecontents, compteLibelle: mecontents ? pluriel(mecontents, 'client mécontent', 'clients mécontents') : '' } : null,
    ] },
    { id: 'activite', libelle: 'Activité', entrees: [
      { id: 'commandes', vue: 'famille:commande', libelle: 'Commandes', icone: 'receipt' },
      { id: 'stock', vue: 'famille:ressource', libelle: 'Stock', icone: 'package', raccourci: 'g s' },
      { id: 'vehicules', vue: 'vehicules', prefixes: ['vehicule:'], libelle: 'Véhicules', icone: 'truck',
        compte: vehicules, compteLibelle: vehicules ? pluriel(vehicules, 'échéance de véhicule à prévoir', 'échéances de véhicule à prévoir') : '' },
      { id: 'documents', vue: 'type:document', libelle: 'Documents', icone: 'file-text' },
      { id: 'lieux', vue: 'famille:lieu', libelle: 'Lieux', icone: 'map-pin' },
    ] },
    p.peutAdministrer || p.voitScore ? { id: 'reseau', libelle: 'Réseau', entrees: [
      { id: 'nexus', vue: 'nexus', libelle: 'Breizhcosystem', icone: 'bz-nexus', raccourci: 'g n' },
    ] } : null,
  ];
  return groupes.filter(Boolean).map((g) => ({ ...g, entrees: g.entrees.filter(Boolean) })).filter((g) => g.entrees.length);
}

/** Entrées du pied du rail (toujours en bas, au même endroit) : Connecter mes données et Réglages. */
export function piedNavigation(m) {
  const admin = Boolean(m.profil?.peutAdministrer);
  return [
    admin ? { id: 'connecter', action: 'connecter', libelle: 'Connecter mes données', icone: 'plug' } : null,
    admin ? { id: 'reglages', vue: 'reglages', vues: ['acces'], prefixes: ['reglages:'], libelle: 'Réglages', icone: 'settings', raccourci: 'g r' } : null,
  ].filter(Boolean);
}

/** L'entrée correspond-elle à la vue courante ? */
export function estCourante(entree, vue) {
  if (!entree.vue && !entree.vues) return false;
  return entree.vue === vue || (entree.vues ?? []).includes(vue) || (entree.prefixes ?? []).some((p) => String(vue).startsWith(p));
}

/** Groupe et entrée d'une vue (null si elle n'est dans aucun groupe : compte, mise en route, réglages). */
export function placeDeVue(groupes, vue) {
  for (const g of groupes) for (const e of g.entrees) if (estCourante(e, vue)) return { groupe: g, entree: e };
  return null;
}

/** Toutes les destinations, à plat, avec leur groupe (« Aller à » de la palette, tests de non-régression). */
export function destinations(groupes, pied = []) {
  return [...groupes.flatMap((g) => g.entrees.map((e) => ({ ...e, groupe: g.libelle, groupeId: g.id }))), ...pied.filter((e) => e.vue).map((e) => ({ ...e, groupe: 'Réglages', groupeId: 'pied' }))];
}

/** Onglets du téléphone (§4.2) : 5 entrées de même largeur, « Plus » ouvre la palette en feuille basse. */
export const ONGLETS_TELEPHONE = Object.freeze([
  { id: 'aujourdhui', libelle: 'Aujourd’hui', icone: 'house' },
  { id: 'planning', libelle: 'Planning', icone: 'calendar-days' },
  { id: 'relations', libelle: 'Relations', icone: 'handshake' },
  { id: 'activite', libelle: 'Activité', icone: 'package' },
  { id: 'plus', libelle: 'Plus', icone: 'ellipsis', plus: true },
]);

/**
 * Onglets du téléphone, prêts à dessiner : destination (dernière vue visitée du groupe, sinon sa première entrée),
 * état courant (« Plus » est courant pour les vues hors des quatre groupes : Pilotage, Réseau, Réglages, compte)
 * et compteur (somme des actions dues du groupe).
 */
export function ongletsTelephone(groupes, vue, { dernieres = {} } = {}) {
  const ici = placeDeVue(groupes, vue);
  return ONGLETS_TELEPHONE.map((o) => {
    if (o.plus) return { ...o, courant: !ici || !ONGLETS_TELEPHONE.some((x) => x.id === ici.groupe.id && !x.plus), compte: 0, compteLibelle: '' };
    const g = groupes.find((x) => x.id === o.id);
    if (!g) return null;
    const derniere = dernieres[g.id];
    const cible = g.entrees.find((e) => estCourante(e, derniere)) ? derniere : g.entrees[0].vue;
    const compte = g.entrees.reduce((n, e) => n + (e.compte || 0), 0);
    const libelles = g.entrees.map((e) => e.compteLibelle).filter(Boolean);
    return { ...o, vue: cible, courant: ici?.groupe.id === g.id, compte, compteLibelle: libelles.join(', ') };
  }).filter(Boolean);
}

/** Compteur affiché (§4.2) : au-delà de 99, « 99+ ». */
export const texteCompteur = (n) => (n > 99 ? '99+' : String(n));

/** Prénom tiré du nom du profil : « Anna — dirigeante » → « Anna » ; rien si ce n'est pas un nom. */
export function prenomDe(nom) {
  const tete = String(nom ?? '').split(/\s+[—–-]\s+/)[0].trim();
  const premier = tete.split(/\s+/)[0] ?? '';
  if (!premier || /[\d@]/.test(premier) || premier.length < 2) return '';
  return premier;
}

/** Titre de l'en-tête sur « Aujourd'hui » (§6.1 P2) : « Bonjour Anna » jusqu'à 11 h, « Aujourd'hui » ensuite. */
export function salutation(nomProfil, maintenant = new Date()) {
  const prenom = prenomDe(nomProfil);
  if (maintenant.getHours() < 11) return { texte: prenom ? `Bonjour ${prenom}` : 'Bonjour', salue: true };
  return { texte: 'Aujourd’hui', salue: false };
}

/** Titre de l'en-tête pour une vue. */
export function titreDeVue(groupes, vue, { nomProfil = '', maintenant = new Date(), departement = '', vehicule = '' } = {}) {
  if (vue === 'carte' || vue === 'matin') return salutation(nomProfil, maintenant).texte;
  if (vue === 'tableau') return 'Liste des lieux';
  if (vue === 'pipeline') return 'Pipeline';
  if (vue === 'reglages' || vue === 'acces' || String(vue).startsWith('reglages:')) return 'Réglages';
  if (vue === 'compte') return 'Mon compte';
  if (vue === 'progression') return 'Progression';
  if (vue === 'accueil') return 'Compléter mon entreprise';
  if (String(vue).startsWith('dep:') && departement) return sansDemo(departement);
  if (String(vue).startsWith('vehicule:') && vehicule) return sansDemo(vehicule);
  return placeDeVue(groupes, vue)?.entree.libelle ?? 'Living Business';
}
