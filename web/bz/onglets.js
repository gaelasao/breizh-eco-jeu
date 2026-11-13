// Breizhcosystem — débordement d'une barre d'onglets (direction de design §4.13). Défilement horizontal avec
// fondus de bord et boutons ‹ › visibles seulement quand il reste des onglets cachés de ce côté : jamais de barre
// tronquée sans indice. Les boutons servent à la souris et au toucher ; au clavier, les flèches du modèle « Tabs »
// font déjà défiler jusqu'à l'onglet choisi (ils sont donc hors de l'ordre de tabulation).
import { el, mouvementReduit } from './dom.js';
import { icone } from './icone.js';

/** Enveloppe un [role="tablist"].bz-onglets et renvoie le cadre à poser à sa place. */
export function cadreOnglets(liste) {
  const bouton = (sens) => el('button', {
    type: 'button', class: `bz-onglets__defiler bz-onglets__defiler--${sens}`, tabindex: '-1', 'aria-hidden': 'true', hidden: true,
    onclick: () => liste.scrollBy({ left: (sens === 'debut' ? -1 : 1) * Math.max(120, liste.clientWidth * 0.7), behavior: mouvementReduit() ? 'auto' : 'smooth' }),
  }, icone(sens === 'debut' ? 'chevron-left' : 'chevron-right'));
  const debut = bouton('debut');
  const fin = bouton('fin');
  const cadre = el('div', { class: 'bz-onglets-cadre' }, debut, liste, fin);
  const maj = () => {
    const reste = liste.scrollWidth - liste.clientWidth - liste.scrollLeft;
    const avant = liste.scrollLeft > 1;
    const apres = reste > 1;
    debut.hidden = !avant;
    fin.hidden = !apres;
    cadre.toggleAttribute('data-debord-debut', avant);
    cadre.toggleAttribute('data-debord-fin', apres);
  };
  liste.addEventListener('scroll', maj, { passive: true });
  if (typeof ResizeObserver === 'function') {
    // le cadre est construit avant d'être posé dans la page : on ne se désabonne qu'une fois qu'il l'a quittée.
    // L'observateur est rattaché au cadre : tant que la barre existe, il n'est jamais ramassé par le ramasse-miettes.
    let pose = false;
    const obs = new ResizeObserver(() => {
      if (liste.isConnected) { pose = true; maj(); } else if (pose) obs.disconnect();
    });
    obs.observe(liste);
    cadre.bzObservateur = obs;
  }
  // filet de sécurité : la page a pu être affichée après la construction (vue masquée pendant le rendu)
  for (const delai of [250, 1000]) setTimeout(() => { if (liste.isConnected) maj(); }, delai);
  // l'onglet courant reste visible (sans faire défiler la page à la verticale)
  requestAnimationFrame(() => {
    const courant = liste.querySelector('[aria-selected="true"]');
    if (courant) {
      const g = courant.offsetLeft; // .bz-onglets est positionnée : c'est le parent de décalage des onglets
      if (g < liste.scrollLeft || g + courant.offsetWidth > liste.scrollLeft + liste.clientWidth) liste.scrollLeft = Math.max(0, g - 48);
    }
    maj();
  });
  return cadre;
}
