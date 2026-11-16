/* Living Business — Réglages › « Suivi et relances », et le bouton « Partager » d'une fiche.
   Module PUR (aucun accès au DOM ni au réseau), testé par src/ds/relances.test.ts ; app.js le dessine.
   Il décide QUOI montrer et COMMENT le dire : le rythme d'une relance en une phrase, ce qu'une relance propose,
   les étapes d'un modèle, et ce que le client verra du retard.

   Promesse tenue par la page : une entreprise qui ne règle rien n'y vient jamais, et tout marche pareil. */

export const TITRE = 'Suivi et relances';

/** Ce que la page promet, en une phrase, avant tout réglage. */
export const PROMESSE = 'Living Business suit vos chantiers, vos commandes et vos factures tout seul. Ces réglages ne servent qu’à ceux qui veulent changer quelque chose.';

/** Ce que « Partager » fait, dit avant de le faire. */
export const TEXTE_PARTAGE = 'Un lien de suivi est créé, et le message est préparé. C’est vous qui l’envoyez : rien ne part tout seul.';
/** Et ce qu'il ne montre jamais, dit en toutes lettres. */
export const TEXTE_GARDE_FOUS = 'La page ne montre que ce suivi : aucun prix, aucune marge, rien d’une autre fiche. Vous pouvez retirer le lien à tout moment.';
/** La ligne gratuit / payant, dite une fois, sans détour. */
export const TEXTE_COMPRIS = 'Partager un suivi et préparer une relance sont compris dans Living Business. C’est l’envoi automatique — le message qui part à chaque étape, sans personne — qui demande l’offre.';

/** Ton d'une relance, selon son sujet : le paiement presse, le reste attend. */
export const TONS_RELANCE = Object.freeze({ paiement: 'critique', reponse: 'attention', avancement: 'attention' });
export const tonRelance = (id) => TONS_RELANCE[id] ?? 'info';

/** Icône d'une relance. Jamais alarmante pour un état qu'on ne connaît pas. */
export const ICONES_RELANCE = Object.freeze({ paiement: 'octagon-alert', reponse: 'clock', avancement: 'triangle-alert' });
export const iconeRelance = (id) => ICONES_RELANCE[id] ?? 'circle';

const jours = (n) => `${n} ${Number(n) < 2 ? 'jour' : 'jours'}`;
const fois = (n) => `${n} ${Number(n) < 2 ? 'fois' : 'fois'}`;

/**
 * Le rythme d'une relance, dit en une phrase d'entrepreneur : « Au bout de 3 jours, puis tous les 14 jours,
 * 3 fois au plus. » Jamais « apresJours: 3 ».
 */
export function phraseRythme(r) {
  if (!r) return '';
  const debut = Number(r.apresJours) > 0 ? `Au bout de ${jours(r.apresJours)}` : 'Dès le premier jour';
  const suite = Number(r.maxFois) > 1 ? `, puis tous les ${jours(r.tousLesJours)}, ${fois(r.maxFois)} au plus.` : ', une seule fois.';
  return `${debut}${suite}`;
}

/** Vrai : ce rythme est celui que le jeu propose (l'entreprise n'a rien changé). */
export function rythmeParDefaut(r, defaut) {
  if (!r || !defaut) return true;
  return ['apresJours', 'tousLesJours', 'maxFois'].every((k) => Number(r[k]) === Number(defaut[k]));
}

/** Les trois réglages d'un rythme, avec leurs bornes : ce que l'écran dessine, et rien d'écrit deux fois. */
export const CURSEURS = Object.freeze([
  { cle: 'apresJours', libelle: 'Première relance au bout de', unite: 'jours', min: 0, max: 90 },
  { cle: 'tousLesJours', libelle: 'Puis tous les', unite: 'jours', min: 2, max: 90 },
  { cle: 'maxFois', libelle: 'Au plus', unite: 'fois', min: 1, max: 10 },
].map((c) => Object.freeze(c)));

/** Ce qu'on écrit en tête de la liste des relances : rien d'alarmant quand il n'y a rien. */
export function resumeRelances(liste) {
  const n = (liste ?? []).length;
  if (n === 0) return 'Rien à relancer aujourd’hui.';
  return `${n} ${n < 2 ? 'relance préparée' : 'relances préparées'}, à relire avant d’envoyer.`;
}

/** « 3 étapes », « 1 étape », et le nom du modèle devant. */
export function resumeModele(m) {
  if (!m) return '';
  const n = Number(m.etapes ?? 0);
  const quoi = Array.isArray(m.etapes) ? m.etapes.length : n;
  return `${m.nom} — ${quoi} ${quoi < 2 ? 'étape' : 'étapes'}`;
}

/** D'où vient un modèle, dit simplement : proposé par le métier, ou écrit par l'entreprise. */
export const origineModele = (m) => (m?.origine === 'univers' ? 'Proposé par votre métier' : 'Écrit par vous');

/**
 * Ce que le client verra, selon le réglage du retard : la phrase même, pour que l'entreprise décide en voyant,
 * pas en lisant une option. « Charpente » est un exemple, remplacé par l'étape réelle quand il y en a une.
 */
export function apercuRetard(montrer, etape = 'Charpente') {
  return montrer ? `${etape} : dépassée de 2 jours` : `${etape} : en cours`;
}

/** Les deux positions du réglage, avec ce qu'elles disent vraiment. « Montrer » d'abord : c'est le défaut. */
export const POSITIONS_RETARD = Object.freeze([
  Object.freeze({ montrer: true, libelle: 'Montrer le retard', aide: 'Votre client voit qu’une étape est dépassée, et de combien. C’est le réglage par défaut.' }),
  Object.freeze({ montrer: false, libelle: 'Dire seulement l’étape en cours', aide: 'Votre client voit où en est le travail, sans le retard. Les étapes et l’avancement restent affichés.' }),
]);

/**
 * Les étapes d'un modèle en cours d'écriture : on ne garde que ce qui a un nom, et l'ordre est celui de la liste.
 * Rendre un tableau neuf à chaque fois (jamais celui qu'on a reçu) : l'écran le réécrit à chaque frappe.
 */
export function etapesPropres(liste) {
  return (liste ?? [])
    .map((e) => (typeof e === 'string' ? { libelle: e } : { ...e }))
    .map((e) => ({ ...e, libelle: String(e.libelle ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) }))
    .filter((e) => e.libelle.length > 0);
}

/** Vrai : ce modèle est prêt à être enregistré (un nom, au moins une étape). */
export const modelePret = (nom, etapes) => String(nom ?? '').trim().length > 0 && etapesPropres(etapes).length > 0;

/** Ce que dit l'écran quand un modèle n'est pas prêt : une phrase, jamais un code. */
export function pourquoiPasPret(nom, etapes) {
  if (String(nom ?? '').trim().length === 0) return 'Donnez un nom à ce modèle (par exemple : « Toiture », « Pose de fenêtres »).';
  if (etapesPropres(etapes).length === 0) return 'Ajoutez au moins une étape.';
  return null;
}

/** Ce qu'une relance propose : le destinataire, en un mot, et ce qui se passe au clic. */
export function versQui(r) {
  return r?.vers === 'dedans' ? 'À la personne qui tient l’étape' : 'À votre client';
}
