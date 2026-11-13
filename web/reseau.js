/* Living Business — onglet Breizhcosystem (direction de design §6.1 P8 et P3 de Breizhcosystem). Module PUR, testé par
   src/ds/autres-ecrans.test.ts. Vitrine de ce que le réseau apporterait ; verrous visibles AVANT l'action (cadenas et
   badge ACTIVE), jamais un refus après la saisie. Le jeu n'accorde rien : il lit les droits que Breizhcosystem lui envoie.
   En fin de fichier : les échanges entre agents de deux entreprises, dits en clair (état, chiffres, suite pour la personne),
   testés par src/ds/echanges-agents.test.ts. */
import { euros, nombre } from './bz/typo.js';

/** Capacité Breizhcosystem requise par chaque action d'une opportunité (null : gratuite). */
export const CAPACITE_ACTION = Object.freeze({ repondre: 'repondre_demande_externe', contacter: 'contacter_membre', participer: 'participer_achat_groupe', voir: null, agent: 'agent_achat', commander: 'agent_achat' });

/**
 * État d'un verrou : 'libre' (gratuit, ou capacité accordée), 'verrouille' (droits connus, capacité absente),
 * 'inconnu' (droits pas encore lus : on laisse faire, le serveur Breizhcosystem décide et l'explication s'ouvre sur place).
 */
export function verrou(droits, action) {
  const cap = CAPACITE_ACTION[action] ?? null;
  if (!cap) return 'libre';
  if (!droits || !Array.isArray(droits.capacites)) return 'inconnu';
  return droits.capacites.includes(cap) ? 'libre' : 'verrouille';
}

/** Types d'opportunités : titre, icône Lucide (plus d'emoji), dans l'ordre d'affichage. */
export const TYPES_OPP = Object.freeze([
  { id: 'demande', titre: 'On cherche ce que vous proposez', icone: 'megaphone' },
  { id: 'solution', titre: 'Ce que vous cherchez existe', icone: 'search' },
  { id: 'stock', titre: 'Stocks disponibles', icone: 'package' },
  { id: 'capacite', titre: 'Renforts disponibles', icone: 'hard-hat' },
  { id: 'appel_offres', titre: 'Appels d’offres publics pour vous', icone: 'landmark' },
  { id: 'achat_groupe', titre: 'Achats groupés ouverts', icone: 'handshake' },
]);

/** Opportunités groupées par type, dans l'ordre de TYPES_OPP (les groupes vides sont omis). */
export function groupes(opportunites) {
  return TYPES_OPP.map((t) => ({ ...t, liste: (opportunites ?? []).filter((x) => x.type === t.id) })).filter((g) => g.liste.length);
}

/** Vitrine (entreprise pas encore reliée) : ce que le réseau apporterait, et ce qui demande Breizhcosystem ACTIVE. */
export const AVANTAGES = Object.freeze([
  { titre: 'Des entreprises qui cherchent ce que vous proposez', texte: 'Chaque jour, les besoins publiés près de chez vous.', icone: 'megaphone', capacite: 'repondre_demande_externe' },
  { titre: 'Une solution du réseau dès qu’un besoin apparaît', texte: 'Rupture de stock, renfort, panne : le réseau propose, vous choisissez.', icone: 'search', capacite: null },
  { titre: 'Les appels d’offres publics bretons qui vous correspondent', texte: 'Triés par activité et par distance.', icone: 'landmark', capacite: null },
  { titre: 'La bourse aux stocks et les achats groupés', texte: 'Achetez à plusieurs pour payer moins cher.', icone: 'handshake', capacite: 'participer_achat_groupe' },
  { titre: 'Un agent d’achat qui prépare, vous validez toujours', texte: 'Il ne paie jamais à votre place.', icone: 'bot', capacite: 'agent_achat' },
  { titre: 'Votre position face aux entreprises comparables', texte: 'Anonyme, à partir de vos notes de santé.', icone: 'gauge', capacite: null },
]);

/** Libellé de l'offre : « Gratuit » ou « Breizhcosystem ACTIVE » (droits lus sur Breizhcosystem ; inconnu tant qu'ils ne le sont pas). */
export const offre = (droits) => (!droits ? null : droits.plan === 'active' ? 'Breizhcosystem ACTIVE' : 'Gratuit');

// ---------------------------------------------------------------- échanges entre agents de deux entreprises
// Votre agent demande un prix à celui du vendeur ; la réponse est une proposition, qui n'engage personne. La valider (ou
// répondre à une demande, côté vendeur) est le geste d'une personne connectée à Breizhcosystem : Living Business ne le
// fait jamais à sa place, il dit où en est l'échange et quelle est la suite.

const nombreOuNul = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const jourLong = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' }).replace(/^1 /, '1er ');
};
const estOuvert = (e) => e?.avancement === 'attend_personne' || e?.avancement === 'en_cours';

/** « Achat », « Vente », ou « Échange » quand le réseau ne dit pas de quel côté est l'entreprise. */
export const sensEchange = (e) => (e?.cote === 'acheteur' ? 'Achat' : e?.cote === 'vendeur' ? 'Vente' : 'Échange');

/**
 * Les chiffres d'un échange : la proposition du vendeur (« 4 × 38,00 € HT = 152,00 € HT »), avec sa fin de validité tant
 * qu'elle est à valider, et la quantité demandée si le vendeur en propose moins ; sinon ce qui a été demandé ; null si le
 * réseau n'a rien donné de lisible.
 */
export function chiffresEchange(e) {
  const p = e?.proposition;
  const q = nombreOuNul(p?.quantite);
  const pu = nombreOuNul(p?.prixUnitaire);
  const demande = nombreOuNul(e?.quantite);
  if (q !== null && pu !== null) {
    const jour = e.statut === 'proposee' && p.valableJusquau ? jourLong(p.valableJusquau) : null;
    // le vendeur peut proposer moins que demandé (ce qui lui reste) : c'est cette quantité-là qui serait validée
    const moins = demande !== null && q < demande ? ` (${nombre(q)} sur les ${nombre(demande)} demandés)` : '';
    return `${nombre(q)} × ${euros(pu)} HT = ${euros(nombreOuNul(p.total) ?? q * pu)} HT${moins}${jour ? `, valable jusqu’au ${jour}` : ''}`;
  }
  if (demande === null) return null;
  const souhaite = nombreOuNul(e.prixSouhaite);
  return `Quantité demandée : ${nombre(demande)}${souhaite !== null ? `, prix souhaité : ${euros(souhaite)} HT l’unité` : ''}`;
}

const SANS_LE_JEU = 'Living Business ne le fait pas à sa place.';
/** État (badge) et suite pour la personne, par statut connu et par côté. `suite` et `etat` peuvent dépendre de l'échange. */
const ETATS_ECHANGE = Object.freeze({
  attente_vendeur: {
    acheteur: { ton: null, etat: 'En attente du vendeur', suite: 'Rien à faire pour l’instant : une personne de chez le vendeur doit répondre. Sa réponse arrivera ici.' },
    vendeur: { ton: 'attention', etat: 'Demande de prix reçue : à vous de répondre', action: 'repondre',
      suite: `Un acheteur vous demande un prix. Une personne de votre entreprise lui répond sur Breizhcosystem, connectée. ${SANS_LE_JEU}` },
  },
  proposee: {
    acheteur: { ton: 'attention', etat: 'Prix proposé : à vous de valider', action: 'valider',
      suite: `Cette proposition n’engage personne. Si elle vous convient, une personne de votre entreprise la valide sur Breizhcosystem, connectée. ${SANS_LE_JEU} Le vendeur confirmera ensuite.` },
    vendeur: { ton: null, etat: 'Proposition envoyée : en attente de l’acheteur', suite: 'Rien à faire pour l’instant : une personne de chez l’acheteur doit valider votre proposition.' },
  },
  acceptee: {
    acheteur: { ton: 'ok', etat: 'Validée : commande créée',
      suite: (e, commande) => (e.commande?.statut === 'validee' || !e.commande?.statut ? `Le vendeur doit encore confirmer ${commande}. Suivez-la dans « Commandes », plus bas.` : `Suivez ${commande} dans « Commandes », plus bas.`) },
    vendeur: { ton: (e) => (e.commande?.statut === 'validee' ? 'attention' : 'ok'), etat: (e) => (e.commande?.statut === 'validee' ? 'Validée par l’acheteur : commande à confirmer' : 'Validée par l’acheteur : commande créée'),
      suite: (e, commande) => (e.commande?.statut === 'validee' ? `Confirmez ou refusez ${commande} dans « Commandes », plus bas.` : `Suivez ${commande} dans « Commandes », plus bas.`) },
  },
  refusee_vendeur: {
    acheteur: { ton: null, etat: 'Sans suite du vendeur', suite: 'Le vendeur n’a pas donné suite. Vous pouvez chercher une autre offre, ou le contacter.' },
    vendeur: { ton: null, etat: 'Refusée par vous' },
  },
  refusee_acheteur: { acheteur: { ton: null, etat: 'Refusée par vous' }, vendeur: { ton: null, etat: 'Refusée par l’acheteur' } },
  annulee: { acheteur: { ton: null, etat: 'Annulée par vous' }, vendeur: { ton: null, etat: 'Annulée par l’acheteur' } },
  expiree: {
    acheteur: { ton: null, etat: 'Expirée',
      suite: (e) => (e.proposition ? 'La proposition n’a pas été validée à temps. Redemandez un prix si vous en avez encore besoin.' : 'La demande est restée sans réponse. Vous pouvez redemander un prix, ou contacter le vendeur.') },
    vendeur: { ton: null, etat: 'Expirée' },
  },
});
const LIBELLES_ACTION = Object.freeze({ valider: 'Valider sur Breizhcosystem', repondre: 'Répondre sur Breizhcosystem', voir: 'Voir sur Breizhcosystem' });
/** Échange d'un genre ou d'un statut plus récent que cette version : l'avancement de sa tâche suffit à le situer. */
const ETATS_GENERIQUES = Object.freeze({
  attend_personne: { vous: ['attention', 'À voir par vous sur Breizhcosystem'], autre: [null, 'En attente de l’autre entreprise'], personne: [null, 'En attente d’une décision'] },
  en_cours: [null, 'En cours'], conclu: ['ok', 'Conclu'], refuse: [null, 'Refusé'], arrete: [null, 'Arrêté'],
});

/**
 * Un échange dit en clair : `etat` (le badge) et son `ton`, `chiffres`, `detail` (la phrase du réseau, pour un échange que
 * cette version ne connaît pas), `suite` (ce que la personne a à faire, ou rien), et `action` avec son `libelleAction` :
 * 'valider' ou 'repondre' se font sur Breizhcosystem, connecté ; 'voir' ouvre la même page ; null : rien à y faire.
 */
export function presenterEchange(e) {
  const chiffres = chiffresEchange(e);
  const connu = ETATS_ECHANGE[e?.statut]?.[e?.cote] ?? null;
  if (connu) {
    const de = (x) => (typeof x === 'function' ? x(e, e.commande?.reference ? `la commande ${e.commande.reference}` : 'la commande') : x ?? null);
    const action = connu.action ?? null;
    return { ton: de(connu.ton), etat: de(connu.etat), chiffres, detail: null, suite: de(connu.suite), action, libelleAction: action ? LIBELLES_ACTION[action] : null };
  }
  const generique = ETATS_GENERIQUES[e?.avancement] ?? ETATS_GENERIQUES.en_cours;
  const [ton, etat] = Array.isArray(generique) ? generique : generique[e?.attend === 'vous' ? 'vous' : e?.attend === 'autre' ? 'autre' : 'personne'];
  const ouvert = estOuvert(e) || !ETATS_GENERIQUES[e?.avancement];
  return {
    ton, etat, chiffres, detail: typeof e?.message === 'string' && e.message ? e.message : null,
    suite: ouvert ? 'Ce genre d’échange est plus récent que votre Living Business : ouvrez-le sur Breizhcosystem pour voir où il en est et quoi faire.' : null,
    action: ouvert ? 'voir' : null, libelleAction: ouvert ? LIBELLES_ACTION.voir : null,
  };
}

/**
 * La liste courte de l'écran : ce qui attend une personne de l'entreprise, puis ce qui attend l'autre, puis les derniers
 * échanges terminés (`termines` au plus), dans l'ordre reçu (les plus récents d'abord).
 */
export function rangerEchanges(liste, { termines = 5 } = {}) {
  const l = (Array.isArray(liste) ? liste : []).filter((e) => e && typeof e.id === 'string');
  return {
    aFaire: l.filter((e) => estOuvert(e) && e.attend === 'vous'),
    enAttente: l.filter((e) => estOuvert(e) && e.attend !== 'vous'),
    termines: l.filter((e) => !estOuvert(e)).slice(0, termines),
  };
}

/** Ce que dit le jeu juste après une demande de prix : [texte, ton du message]. `vendeur` : le nom de l'entreprise interrogée. */
export function annonceDemandePrix(e, vendeur) {
  const a = vendeur ? `à ${vendeur}` : 'au vendeur';
  const chiffres = e?.statut === 'proposee' ? chiffresEchange(e) : null;
  if (chiffres) return [`${vendeur || 'Le vendeur'} a répondu aussitôt : ${chiffres}. Sa proposition n’engage personne : la suite est dans « Échanges en cours ».`, 'attention'];
  if (e?.statut === 'attente_vendeur') return [`Demande envoyée ${a}. Une personne de cette entreprise doit répondre : sa réponse arrivera dans « Échanges en cours ».`, 'ok'];
  return [`Demande envoyée ${a} : suivez-la dans « Échanges en cours ».`, 'ok'];
}
