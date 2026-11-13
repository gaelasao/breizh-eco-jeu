// Breizhcosystem — [popover] avec repli (direction de design §4.15).
// Navigateurs sans l'API Popover (iOS 15.4 à 16.x) : base.css masque [popover] tant qu'il ne porte pas data-ouvert ;
// ici on l'ouvre par cet attribut, on le ferme par Échap et par un clic extérieur (sauf popover="manual").
export const POPOVER_NATIF = typeof HTMLElement !== 'undefined' && 'showPopover' in HTMLElement.prototype;

export function estOuvert(p) {
  if (!p) return false;
  if (POPOVER_NATIF) { try { return p.matches(':popover-open'); } catch { return false; } }
  return p.hasAttribute('data-ouvert');
}

/**
 * Un popover « auto » (détail, menu) est-il ouvert ? Il est alors la couche du dessus : Échap le ferme, lui seul (§4.4).
 * Les popovers « manual » (toasts) ne comptent pas.
 */
export function popoverOuvert() {
  if (typeof document === 'undefined') return false;
  const ouverts = POPOVER_NATIF ? (() => { try { return [...document.querySelectorAll(':popover-open')]; } catch { return []; } })() : [...document.querySelectorAll('[popover][data-ouvert]')];
  return ouverts.some((p) => p.getAttribute('popover') !== 'manual');
}

export function montrer(p) {
  if (!p || estOuvert(p)) return;
  if (POPOVER_NATIF) { try { p.showPopover(); } catch { /* pas encore dans le document */ } return; }
  p.setAttribute('data-ouvert', '');
  if (p.getAttribute('popover') === 'manual') return;
  const dehors = (e) => { if (!p.contains(e.target)) cacher(p); };
  const echap = (e) => { if (e.key === 'Escape') cacher(p); };
  p._bzFermeture = () => { document.removeEventListener('pointerdown', dehors, true); document.removeEventListener('keydown', echap, true); };
  setTimeout(() => { document.addEventListener('pointerdown', dehors, true); document.addEventListener('keydown', echap, true); }, 0);
}

export function cacher(p) {
  if (!p || !estOuvert(p)) return;
  if (POPOVER_NATIF) { try { p.hidePopover(); } catch { /* déjà fermé */ } return; }
  p.removeAttribute('data-ouvert');
  p._bzFermeture?.();
  p._bzFermeture = undefined;
}

/**
 * Positionne un popover sous son ancre (au-dessus si la place manque), par CSSOM (compatible CSP).
 * Utilisé quand le positionnement par ancre CSS (anchor-name) n'est pas disponible.
 */
export function placer(p, ancre, { ecart = 8 } = {}) {
  if (!p || !ancre) return;
  if (typeof CSS !== 'undefined' && CSS.supports?.('anchor-name: --a')) return;
  const a = ancre.getBoundingClientRect();
  const r = p.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let haut = a.bottom + ecart;
  if (haut + r.height > vh && a.top - ecart - r.height > 0) haut = a.top - ecart - r.height;
  let gauche = Math.min(Math.max(8, a.left), Math.max(8, vw - r.width - 8));
  if (Number.isNaN(gauche)) gauche = 8;
  p.style.position = 'fixed';
  p.style.margin = '0';
  p.style.inset = 'auto';
  p.style.translate = `${Math.round(gauche)}px ${Math.round(haut)}px`;
  p.style.top = '0';
  p.style.left = '0';
}
