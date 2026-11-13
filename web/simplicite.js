/* Living Business — le menu grandit avec l'entreprise (direction de design §1.2 P1, §4.18, §4.20, §4.25).
   Module PUR : aucun accès au DOM, le stockage est reçu en paramètre. Testé par src/ds/simplicite.test.ts.

   UNE seule table, RUBRIQUES, dit pour chaque entrée du menu : quand elle apparaît (regle, debloque), à quoi elle sert
   (sert), par quoi commencer (premier) et ce qu'on lit tant qu'elle est vide (manque). La règle se décide sur ce que
   l'entreprise a réellement fait — ses données, telles que /api/v1/monde les montre à ce profil — jamais sur des
   points : un niveau du port n'ouvre aucune fonction (§4.25).

   Rien n'est pris en otage : « Tout afficher » montre tout d'un coup, la recherche et les liens directs ouvrent tout,
   la rubrique où l'on se trouve et celle où quelque chose est dû s'affichent toujours. Ce n'est pas un droit : les
   droits restent décidés par la passerelle et par web/navigation.js. Ici, on retire seulement de la vue ce qui n'a
   encore rien à montrer ; une entrée interdite par les droits n'arrive jamais jusqu'à ce module. */
import { estCourante } from './navigation.js';

const aRole = (o, id) => o.famille === 'tiers' && (o.roles ?? []).some((r) => (r?.id ?? r) === id);
/** Familles qui ne sont pas de l'activité : l'entreprise elle-même, ses murs, son organisation et ses relations. */
const HORS_ACTIVITE = new Set(['organisation', 'lieu', 'departement', 'tiers']);
const VENTES = new Set(['devis', 'commande_client', 'facture']);

/** Ce que l'entreprise a déjà, compté en un passage sur ce que le profil voit (réponse de /api/v1/monde). */
export function faits(m) {
  const f = { personnes: 0, lieux: 0, departements: 0, clients: 0, fournisseurs: 0, prospects: 0, commandes: 0, ventes: 0, ressources: 0, documents: 0, courriers: 0, taches: 0, activite: 0 };
  for (const o of m?.objets ?? []) {
    if (o.famille === 'personne') f.personnes++;
    else if (o.famille === 'lieu') f.lieux++;
    else if (o.famille === 'departement') f.departements++;
    else if (o.famille === 'commande') f.commandes++;
    else if (o.famille === 'ressource') f.ressources++;
    else if (o.famille === 'tache') f.taches++;
    if (aRole(o, 'client')) f.clients++;
    if (aRole(o, 'fournisseur')) f.fournisseurs++;
    if (aRole(o, 'prospect')) f.prospects++;
    if (VENTES.has(o.type)) f.ventes++;
    if (o.type === 'document') f.documents++;
    if (o.type === 'courrier') f.courriers++;
    if (!HORS_ACTIVITE.has(o.famille)) f.activite++;
  }
  const sat = m?.satisfaction ?? null;
  return {
    ...f,
    departements: Math.max(f.departements, Number(m?.organisation?.departements) || 0),
    /** Un score de santé existe : la passerelle n'en donne un qu'à partir de 20 % des critères renseignés. */
    scoreSante: typeof m?.sante?.score === 'number',
    /** Clients à qui un formulaire d'avis peut partir (ou qui ont déjà répondu). */
    clientsSuivis: sat ? Object.keys(sat.clients ?? {}).length : f.clients,
    /** Baromètre d'équipe : invitations envoyées ou réponses publiées. */
    barometre: (Number(sat?.barometre?.invites) || 0) + (Number(sat?.barometre?.reponses) || 0),
    /** Entreprise reliée au réseau Breizhcosystem (pavillon éveillé). */
    relie: Boolean(m?.pavillon) && m.pavillon.apparence !== 'endormi',
    /** Quêtes nées d'une situation réelle, et réussites déjà acquises. */
    quetes: (m?.quetes ?? []).length + (m?.progression?.reussites ?? []).length + (Number(m?.progression?.xp) > 0 ? 1 : 0),
  };
}

const TOUJOURS_ADMIN = 'Toujours affichée pour la personne qui administre.';

/**
 * Les rubriques, par identifiant d'entrée du menu (web/navigation.js) ; « pipeline » (vue de la carte) et « progression »
 * (couche de jeu) n'ont pas d'entrée dans le rail mais suivent la même règle du jeu.
 * - regle    : la règle de déblocage, en une phrase, telle qu'on la lit à l'écran (Aide › Les rubriques du menu) ;
 * - debloque : la même règle, calculée sur faits(monde) ;
 * - sert     : à quoi sert la rubrique (une ou deux phrases, qui commencent par un nom commun) ;
 * - premier  : par quoi commencer, écrit pour suivre « Pour commencer, » ;
 * - manque   : le titre de l'écran tant qu'il est vide (ce qui manque, avec un point).
 */
export const RUBRIQUES = Object.freeze(Object.fromEntries(Object.entries({
  aujourdhui: {
    regle: 'Toujours affichée : c’est l’écran d’arrivée.',
    debloque: () => true,
    sert: 'Votre carte, et la chose à faire maintenant.',
    premier: 'lisez l’encadré du haut : il dit par quoi commencer.',
    manque: 'Rien à faire pour le moment.',
  },
  planning: {
    regle: 'Apparaît dès qu’une première personne est à planifier.',
    debloque: (f) => f.personnes > 0,
    sert: 'Qui travaille où, jour par jour, et les jours où il manque du monde.',
    premier: 'choisissez une case pour dire où quelqu’un travaille ce jour-là.',
    manque: 'Personne à planifier pour le moment.',
  },
  taches: {
    regle: 'Apparaît dès la première tâche, créée par vous ou préparée par une automatisation.',
    debloque: (f) => f.taches > 0,
    sert: 'Ce qui reste à faire, par qui et pour quand. Les tâches que les automatisations préparent arrivent ici.',
    premier: 'ouvrez une tâche pour lui donner un responsable et une date.',
    manque: 'Aucune tâche pour le moment.',
  },
  equipe: {
    regle: 'Apparaît dès la première personne de l’équipe.',
    debloque: (f) => f.personnes > 0,
    sert: 'Les personnes de l’entreprise, leur poste et leur lieu de travail.',
    premier: 'ouvrez une fiche pour vérifier le poste et le lieu.',
    manque: 'Personne dans l’équipe pour le moment.',
  },
  sante: {
    regle: 'Apparaît dès qu’un score peut être calculé : au moins un critère sur cinq est renseigné.',
    debloque: (f) => f.scoreSante,
    sert: 'Un score sur 100 et vos priorités, calculés sur vos données. Ce n’est pas une notation de crédit.',
    premier: 'regardez vos priorités : la première a son bouton.',
    manque: 'Pas encore assez de données pour un score.',
  },
  optimiser: {
    regle: 'Apparaît dès qu’il y a de l’activité à alléger : commande, facture, stock, courrier, document, tâche ou équipe.',
    debloque: (f) => f.activite > 0,
    sert: 'Les tâches répétées que Living Business peut faire à votre place, avec le temps gagné.',
    premier: 'lisez la première piste : elle dit ce qui serait fait. Rien ne démarre sans votre accord.',
    manque: 'Rien à alléger pour le moment.',
  },
  departements: {
    regle: 'Apparaît dès qu’un département existe.',
    debloque: (f) => f.departements > 0,
    sert: 'Chaque département, avec son équipe, ses tâches et ses dossiers.',
    premier: 'ouvrez un département pour voir ses tâches.',
    manque: 'Aucun département pour le moment.',
  },
  clients: {
    regle: 'Apparaît dès le premier client.',
    debloque: (f) => f.clients > 0,
    sert: 'Vos clients, avec ce qu’ils vous doivent, leurs retards et leur avis.',
    premier: 'ouvrez une fiche : tout ce qui concerne ce client y est réuni.',
    manque: 'Aucun client pour le moment.',
  },
  fournisseurs: {
    regle: 'Apparaît dès le premier fournisseur.',
    debloque: (f) => f.fournisseurs > 0,
    sert: 'Vos fournisseurs, leurs coordonnées et leurs commandes.',
    premier: 'ouvrez une fiche pour retrouver ses commandes.',
    manque: 'Aucun fournisseur pour le moment.',
  },
  courrier: {
    regle: 'Apparaît dès le premier courrier reçu.',
    debloque: (f) => f.courriers > 0,
    sert: 'Vos mails triés par urgence, avec la personne à qui les confier.',
    premier: 'traitez d’abord ceux marqués « Urgent ».',
    manque: 'Aucun courrier pour le moment.',
  },
  satisfaction: {
    regle: 'Apparaît dès qu’il y a quelqu’un à interroger : un client, ou une personne de l’équipe.',
    debloque: (f) => f.clientsSuivis > 0 || f.personnes > 0 || f.barometre > 0,
    sert: 'L’avis de vos clients et celui de l’équipe, mois après mois.',
    premier: 'envoyez un premier formulaire d’avis à un client.',
    manque: 'Personne à interroger pour le moment.',
  },
  commandes: {
    regle: 'Apparaît dès la première commande, le premier devis ou la première facture.',
    debloque: (f) => f.commandes > 0,
    sert: 'Vos commandes, vos devis et vos factures, avec les retards.',
    premier: 'triez par état : ce qui est en retard passe en premier.',
    manque: 'Aucune commande pour le moment.',
  },
  stock: {
    regle: 'Apparaît dès le premier article, véhicule ou équipement.',
    debloque: (f) => f.ressources > 0,
    sert: 'Vos articles, vos véhicules et votre matériel, avec les seuils d’alerte.',
    premier: 'vérifiez le minimum de vos articles : l’alerte part de là.',
    manque: 'Rien en stock pour le moment.',
  },
  documents: {
    regle: 'Apparaît dès le premier document.',
    debloque: (f) => f.documents > 0,
    sert: 'Vos documents à échéance : assurances, contrôles, contrats.',
    premier: 'vérifiez les dates de fin : vous êtes prévenu avant l’échéance.',
    manque: 'Aucun document pour le moment.',
  },
  lieux: {
    regle: 'Apparaît dès le premier lieu : siège, atelier, boutique ou entrepôt.',
    debloque: (f) => f.lieux > 0,
    sert: 'Vos lieux de travail, ceux que montre la carte.',
    premier: 'ouvrez un lieu pour voir qui y travaille.',
    manque: 'Aucun lieu pour le moment.',
  },
  nexus: {
    regle: 'Apparaît dès que l’entreprise est reliée au réseau, ou qu’elle a ses premières données : client, fournisseur, stock ou commande.',
    debloque: (f) => f.relie || f.clients + f.fournisseurs + f.ressources + f.commandes > 0,
    sert: 'Le réseau des entreprises bretonnes : besoins près de chez vous, appels d’offres, achats groupés.',
    premier: 'reliez votre entreprise : c’est gratuit, avec votre SIRET.',
    manque: 'Pas encore relié à Breizhcosystem.',
  },
  connecter: {
    regle: TOUJOURS_ADMIN,
    debloque: () => true,
    sert: 'Vos clients, vos factures ou votre stock, repris d’un fichier ou d’un logiciel que vous utilisez déjà.',
    premier: 'dites où sont vos clients aujourd’hui : la suite est proposée.',
    manque: 'Aucune donnée connectée pour le moment.',
  },
  reglages: {
    regle: TOUJOURS_ADMIN,
    debloque: () => true,
    sert: 'Le nom de l’entreprise, les accès de l’équipe, l’apparence et les sauvegardes.',
    premier: 'vérifiez le nom et la ville de votre entreprise.',
    manque: 'Aucun réglage à faire pour le moment.',
  },
  pipeline: {
    regle: 'Apparaît dès le premier prospect, devis, commande de client ou facture.',
    debloque: (f) => f.prospects > 0 || f.ventes > 0,
    sert: 'Vos affaires en cours, du premier contact à la facture payée.',
    premier: 'lisez de gauche à droite : chaque colonne est une étape.',
    manque: 'Aucune affaire en cours pour le moment.',
  },
  progression: {
    regle: 'Apparaît dès la première quête : une situation à régler, prouvée par vos données.',
    debloque: (f) => f.quetes > 0,
    sert: 'Vos quêtes du jour, le niveau de votre port et vos trophées. Seul le travail réel compte.',
    premier: 'réglez une première quête : la preuve arrive avec la prochaine donnée à jour.',
    manque: 'Aucune quête pour le moment.',
  },
}).map(([id, r]) => [id, Object.freeze({ id, ...r })])));

/** Rubriques débloquées : { clients: true, stock: false… }. Pure : mêmes données, même réponse. */
export function deblocages(m) {
  const f = faits(m);
  return Object.fromEntries(Object.values(RUBRIQUES).map((r) => [r.id, Boolean(r.debloque(f))]));
}

/**
 * Une entrée est montrée si sa rubrique est débloquée, si l'on s'y trouve (lien direct, recherche), ou si quelque chose
 * y est dû (compteur d'actions). Une entrée sans règle n'est jamais retirée.
 */
const montree = (e, d, vue) => d[e.id] !== false || (e.compte ?? 0) > 0 || (vue !== null && estCourante(e, vue));

/** Entrées montrées d'une liste à plat (pied du rail). d : deblocages(monde) ; tout : « Tout afficher ». */
export function entreesAffichees(entrees, d, { tout = false, vue = null } = {}) {
  return tout ? entrees : entrees.filter((e) => montree(e, d, vue));
}

/** Groupes du menu tels qu'on les montre : un groupe sans entrée montrée disparaît. */
export function menuAffiche(groupes, d, { tout = false, vue = null } = {}) {
  if (tout) return groupes;
  return groupes.map((g) => ({ ...g, entrees: g.entrees.filter((e) => montree(e, d, vue)) })).filter((g) => g.entrees.length);
}

/** Entrées que la simplicité retire aujourd'hui du menu : s'il n'y en a pas, « Tout afficher » n'a pas lieu d'être. */
export function entreesEnAttente(groupes, pied, d) {
  return [...groupes.flatMap((g) => g.entrees), ...pied].filter((e) => d[e.id] === false);
}

/** Rubriques qui viennent de se débloquer entre deux lectures du monde (jamais à la première). */
export function vientDeSOuvrir(avant, apres) {
  if (!avant) return [];
  return Object.keys(RUBRIQUES).filter((id) => apres[id] === true && avant[id] === false);
}

// ---------------------------------------------------------------- choix de la personne, gardés sur son appareil
/** Clé de stockage, par personne (profil) : « Tout afficher » et les notes déjà lues ne se mélangent pas sur un poste partagé. */
export const cleSimplicite = (profilId) => `lb-simplicite:${String(profilId ?? '').replace(/[^\w-]/g, '').slice(0, 80) || 'defaut'}`;

/**
 * { tout, vues } : tout = « Tout afficher » ; vues = rubriques dont la note a été lue (null : aucun repère de départ
 * n'a encore été pris). Tolérant : une valeur abîmée ou un stockage indisponible donnent le menu simple.
 */
export function lirePreferences(stockage, profilId) {
  try {
    const x = JSON.parse(stockage?.getItem(cleSimplicite(profilId)) ?? 'null');
    if (!x || typeof x !== 'object') return { tout: false, vues: null };
    return { tout: x.tout === true, vues: Array.isArray(x.vues) ? [...new Set(x.vues.filter((id) => typeof id === 'string' && Object.hasOwn(RUBRIQUES, id)))] : null };
  } catch { return { tout: false, vues: null }; }
}

/** Enregistre les choix ; false si le stockage refuse (navigation privée) : le choix vaut alors pour la session. */
export function ecrirePreferences(stockage, profilId, { tout = false, vues = null } = {}) {
  try {
    stockage.setItem(cleSimplicite(profilId), JSON.stringify({ tout: Boolean(tout), vues: Array.isArray(vues) ? vues : null }));
    return true;
  } catch { return false; }
}

/**
 * Repère de départ : ce qui est déjà débloqué à la première ouverture est tenu pour connu. Une entreprise déjà en
 * place ne reçoit aucune note sur ce qu'elle utilise ; une entreprise neuve part du menu du premier jour.
 */
export const repereDeDepart = (d) => Object.keys(RUBRIQUES).filter((id) => d[id] === true);

/** Rubriques débloquées dont la note n'a pas encore été lue (mention « Nouveau », note à l'ouverture). */
export function nouvelles(d, preferences) {
  if (!Array.isArray(preferences?.vues)) return [];
  return Object.keys(RUBRIQUES).filter((id) => d[id] === true && !preferences.vues.includes(id));
}

// ---------------------------------------------------------------- textes
const minuscule = (t) => `${t.charAt(0).toLocaleLowerCase('fr-FR')}${t.slice(1)}`;

/** Note d'une rubrique, lue une fois : à quoi elle sert, puis par quoi commencer. */
export function texteNote(id) {
  const r = RUBRIQUES[id];
  return r ? `${r.sert} Pour commencer, ${r.premier}` : '';
}

/** Écran vide (§4.18) : deux lignes — ce qui manque (titre), puis ce que l'écran montrera. */
export function texteVide(id) {
  const r = RUBRIQUES[id];
  return r ? { titre: r.manque, texte: `Ici : ${minuscule(r.sert)}` } : null;
}

/** « Clients », « Clients et Stock », « Clients, Stock et Commandes » : pour annoncer ce qui rejoint le menu. */
export function enumerer(noms) {
  const l = noms.filter(Boolean);
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} et ${l.at(-1)}`;
}
