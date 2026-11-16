/* Living Business — la page de suivi qu'un CLIENT ouvre avec le lien que l'entreprise lui a donné.
   Module PUR (aucun accès au DOM ni au réseau), testé par src/ds/suivi-client.test.ts ; suivi-client-page.js dessine.
   Il décide QUOI montrer : le ton et l'icône de chaque étape, les dates à la française, l'avancement, et lequel des
   deux états dessiner — le suivi, ou la phrase d'un lien retiré.
   Tout ce qu'il reçoit vient de /api/public/suivi/<jeton>, qui ne sert qu'une liste blanche de champs (voir
   src/core/suivi-client.ts) : aucun montant, aucune marge, aucun coût, rien d'une autre entreprise. */

/** Ton d'une étape, dans l'échelle des états du jeu. */
export const TONS = Object.freeze({
  faite: 'ok', depassee: 'critique', aujourdhui: 'attention', bientot: 'attention', a_venir: 'info', sans_date: 'info',
});
/** Un état qu'on ne connaît pas ne devient jamais alarmant. */
export const tonEtape = (etat) => TONS[etat] ?? 'info';

/** Icône d'une étape : faite, en retard, qui presse, ou à venir. */
export const ICONES = Object.freeze({
  faite: 'circle-check', depassee: 'octagon-alert', aujourdhui: 'triangle-alert', bientot: 'clock', a_venir: 'circle', sans_date: 'circle',
});
export const iconeEtape = (etat) => ICONES[etat] ?? 'circle';

/**
 * Ton de la phrase d'en-tête : celui de l'étape la plus pressante encore ouverte. Une étape dépassée de deux jours
 * ne s'annonce pas sur le même fond qu'un chantier qui avance — le client doit voir tout de suite ce qui coince.
 */
export function tonPhrase(page) {
  if (page?.termine) return 'ok';
  const ordre = ['critique', 'attention', 'info'];
  const tons = (page?.etapes ?? []).filter((e) => !e.faite).map((e) => tonEtape(e.etat));
  return ordre.find((t) => tons.includes(t)) ?? 'info';
}

/** « 28/11/2026 » ; rien quand l'entreprise n'a pas annoncé de date (le jeu n'en invente jamais). */
export function jourLisible(jour) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(jour ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Part d'avancement, en pourcentage entier. Aucune étape : 0, jamais « NaN ». */
export function pourcentage({ faites = 0, total = 0 } = {}) {
  return total > 0 ? Math.round((faites / total) * 100) : 0;
}

/** « 1 étape sur 5 », « 2 étapes sur 5 », « Rien d’annoncé pour l’instant. » */
export function resumeAvancement(a) {
  const { faites = 0, total = 0 } = a ?? {};
  if (total === 0) return 'Rien d’annoncé pour l’instant.';
  return `${faites} ${faites < 2 ? 'étape' : 'étapes'} sur ${total}`;
}

/**
 * Ce qu'il faut dessiner : le suivi, ou le message d'un lien retiré, ou une phrase utile quand la réponse n'arrive
 * pas. Jamais un code d'erreur : le client n'a pas à savoir ce qu'est un 404.
 */
export function etat(page) {
  if (!page || typeof page !== 'object') return { quoi: 'erreur', message: 'Cette page n’a pas pu être chargée. Réessayez dans un instant.' };
  if (page.etat === 'ouverte') return { quoi: 'suivi', page };
  return { quoi: 'ferme', message: String(page.message ?? 'Ce lien de suivi n’existe pas, ou plus.') };
}
