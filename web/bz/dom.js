// Breizhcosystem — petit constructeur DOM partagé par les modules bz (dialogues, toasts, palette).
// Texte uniquement par textContent (jamais d'HTML inséré), typographie française appliquée, aucun style en ligne.
import { typo } from './typo.js';

const SANS_TYPO = new Set(['CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA']);
const ATTRIBUTS_TYPO = new Set(['aria-label', 'title', 'placeholder', 'alt']);

/** el('button', { class: 'bz-bouton', onclick }, 'Libellé', autreNoeud) */
export function el(balise, attributs = {}, ...enfants) {
  const n = document.createElement(balise);
  const brut = SANS_TYPO.has(n.tagName) || attributs?.['data-brut'] !== undefined;
  for (const [k, v] of Object.entries(attributs ?? {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'texte') n.textContent = brut ? String(v) : typo(String(v));
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : ATTRIBUTS_TYPO.has(k) && !attributs['data-brut'] ? typo(String(v)) : String(v));
  }
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    n.append(e instanceof Node ? e : document.createTextNode(brut ? String(e) : typo(String(e))));
  }
  return n;
}

let compteur = 0;
/** Identifiant unique pour relier un libellé (aria-labelledby, aria-describedby). */
export const identifiant = (prefixe = 'bz') => `${prefixe}-${Date.now().toString(36)}-${(compteur++).toString(36)}`;

/** Mouvement réduit (préférence du système ou choix explicite dans Réglages). */
export function mouvementReduit() {
  const r = document.documentElement.getAttribute('data-mouvement');
  if (r === 'reduit') return true;
  if (r === 'normal') return false;
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}
