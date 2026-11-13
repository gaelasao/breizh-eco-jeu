/* Living Business — Réglages › « Mon fichier de suivi ».
   Module PUR (aucun accès au DOM ni au réseau), testé par src/ds/suivi.test.ts ; app.js le dessine.
   Il décide QUOI montrer : la proposition de création en une phrase et un bouton, l'adresse du classeur,
   ce qui est suivi (chaque type peut être décoché), l'état du dernier envoi, et « Tout réécrire ».
   Promesse tenue par la page : ce qui se passe dans le jeu se passe dans la vraie vie, et inversement. */

export const TITRE = 'Mon fichier de suivi';
export const PROMESSE = 'Tout ce que vous créez ici s’écrit aussi dans votre fichier de suivi. Tout ce que vous ajoutez là-bas revient ici.';

/** Groupes de types, dans l'ordre de la page : un intitulé simple par famille d'objets. */
export const GROUPES = Object.freeze([
  { id: 'tiers', libelle: 'Clients, fournisseurs et partenaires' },
  { id: 'commande', libelle: 'Devis, commandes et factures' },
  { id: 'projet', libelle: 'Projets' },
  { id: 'tache', libelle: 'Tâches' },
  { id: 'ressource', libelle: 'Stock, matériel et véhicules' },
  { id: 'personne', libelle: 'Équipe' },
  { id: 'lieu', libelle: 'Lieux' },
  { id: 'departement', libelle: 'Départements' },
  { id: 'evenement', libelle: 'Courrier, documents et avis' },
  { id: 'indicateur', libelle: 'Indicateurs' },
].map((g) => Object.freeze(g)));

/** Types rangés par groupe (un groupe vide disparaît ; une famille inconnue finit dans « Autres »). */
export function groupesTypes(types) {
  const restants = [...(types ?? [])];
  const groupes = [];
  for (const g of GROUPES) {
    const siens = restants.filter((t) => t?.famille === g.id);
    if (siens.length) groupes.push({ id: g.id, libelle: g.libelle, types: siens });
  }
  const connus = new Set(GROUPES.map((g) => g.id));
  const autres = restants.filter((t) => !connus.has(t?.famille));
  if (autres.length) groupes.push({ id: 'autres', libelle: 'Autres', types: autres });
  return groupes;
}

/** « 24 types suivis sur 24 », ou « 22 sur 24 » quand l'entreprise en a décoché. */
export function resumeSuivis(types) {
  const l = types ?? [];
  const suivis = l.filter((t) => t?.suivi).length;
  if (!l.length) return 'Rien à suivre pour l’instant.';
  if (suivis === l.length) return `Tout est suivi : ${l.length} sortes de fiches.`;
  return `${suivis} sortes de fiches suivies sur ${l.length}.`;
}

/**
 * État du dernier envoi, dit simplement : rien n'est jamais « en erreur » sans dire ce que fait le jeu.
 * Renvoie { ton, texte } ; ton = 'ok' | 'attention' | 'info'.
 */
export function etatEnvoi(vue) {
  if (!vue?.classeur) return { ton: 'info', texte: 'Aucun fichier de suivi pour l’instant.' };
  const attente = Number(vue.attente ?? 0);
  if (attente > 0) {
    return { ton: 'attention', texte: `${attente === 1 ? 'Un envoi attend' : `${attente} envois attendent`} : Living Business réessaie tout seul. Rien n’est perdu, rien n’est bloqué.` };
  }
  const d = vue.dernier;
  if (d && d.ok === false) return { ton: 'attention', texte: `Dernier envoi : ${d.message || 'il n’a pas abouti'}. Living Business réessaie tout seul.` };
  if (d) return { ton: 'ok', texte: 'Tout est à jour dans votre fichier de suivi.' };
  return { ton: 'info', texte: 'Fichier de suivi prêt : la première écriture part au prochain changement.' };
}

/** Phrase et bouton de la proposition (une phrase, un bouton, un seul clic). */
export function propositionLisible(p) {
  if (!p) return null;
  return {
    compte: p.compte,
    outil: p.outil,
    phrase: p.phrase || `Tout ce que vous créez ici peut s’écrire aussi dans un fichier de suivi, chez vous, dans ${p.chez ?? 'votre espace'}.`,
    bouton: p.bouton || `Créer mon fichier de suivi dans ${p.chez ?? 'mon espace'}`,
  };
}

/** Autres outils proposés quand la personne préfère Notion ou Airtable (le compte retenu est à part). */
export function autresComptes(vue) {
  const retenu = vue?.proposition?.compte ?? null;
  return (vue?.comptes ?? []).filter((c) => c.id !== retenu);
}

/** Ce que l'adresse du classeur doit montrer : jamais une adresse qui n'est pas celle de l'outil. */
export function lienClasseur(classeur) {
  const url = String(classeur?.url ?? '');
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return null;
    const hotes = ['docs.google.com', 'www.notion.so', 'notion.so', 'airtable.com', 'www.airtable.com'];
    return hotes.includes(u.hostname) ? u.toString() : null;
  } catch { return null; }
}

/** Ce que « Tout réécrire » fait, dit avant de le faire (rien n'est effacé chez l'entreprise). */
export const TEXTE_REECRIRE = 'Toutes vos fiches repartent vers le fichier de suivi, une par une. Les lignes déjà présentes sont mises à jour, aucune n’est effacée.';
/** Ce que « Ne plus suivre » fait : le jeu oublie le classeur, l'entreprise garde son fichier. */
export const TEXTE_DETACHER = 'Living Business oublie ce fichier et n’y écrit plus. Le fichier reste chez vous, avec tout ce qu’il contient.';
/** Ce qu'il advient d'une fiche effacée dans le jeu. */
export const TEXTE_SUPPRESSION = 'Une fiche effacée dans Living Business n’efface pas sa ligne : elle est marquée « Supprimée ». Vos données restent les vôtres.';
