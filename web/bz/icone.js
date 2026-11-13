// Breizhcosystem — icônes du sprite /bz/icones.svg (Lucide 1.71.0 + icônes maison « bz-* »), §4.24.
// Toujours en currentColor, trait posé par .bz-icone (visible en forced-colors). Décorative par défaut (aria-hidden) ;
// une icône seule qui porte un sens reçoit un libellé (role="img" + aria-label).
import { typo } from './typo.js';

const NS = 'http://www.w3.org/2000/svg';
export const SPRITE = '/bz/icones.svg';

/** icone('search') ; icone('triangle-alert', { taille: 'sm', libelle: 'Attention' }). Tailles : sm 16, md 20, lg 24 px. */
export function icone(nom, { taille = 'md', libelle = '', classe = '' } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', `bz-icone bz-icone--${taille}${classe ? ` ${classe}` : ''}`);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('focusable', 'false');
  if (libelle) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', typo(libelle));
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const use = document.createElementNS(NS, 'use');
  use.setAttribute('href', `${SPRITE}#i-${nom}`);
  svg.append(use);
  return svg;
}
