// Breizhcosystem — infobulles (direction de design §4.15) : un complément seulement, jamais une information
// indispensable, jamais au toucher. Après 500 ms de survol, tout de suite au focus clavier ; reste affichée tant que le
// pointeur est sur l'élément ; Échap la ferme (1.4.13). Une seule bulle partagée, en couche supérieure
// (popover="manual"), placée par CSSOM (compatible CSP). Déclencheur : [data-infobulle="Texte"] ;
// [data-infobulle-place="droite"] la pose à droite (rail replié), sinon dessous (au-dessus si la place manque).
import { el } from './dom.js';
import { cacher, montrer } from './popover.js';
import { typo } from './typo.js';

const DELAI = 500;
const ECART = 8;
let bulle = null;
let cible = null;
let minuterie = null;

function laBulle() {
  if (!bulle) {
    bulle = el('div', { id: 'bz-infobulle', class: 'bz-infobulle', popover: 'manual', role: 'tooltip' });
    document.body.append(bulle);
  }
  return bulle;
}

function placer(b, ancre) {
  const a = ancre.getBoundingClientRect();
  const r = b.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let x;
  let y;
  if (ancre.getAttribute('data-infobulle-place') === 'droite' && a.right + ECART + r.width < vw) {
    x = a.right + ECART;
    y = a.top + (a.height - r.height) / 2;
  } else {
    x = a.left + (a.width - r.width) / 2;
    y = a.bottom + ECART;
    if (y + r.height > vh - ECART) y = a.top - ECART - r.height;
  }
  x = Math.min(Math.max(ECART, x), Math.max(ECART, vw - r.width - ECART));
  y = Math.min(Math.max(ECART, y), Math.max(ECART, vh - r.height - ECART));
  b.style.translate = `${Math.round(x)}px ${Math.round(y)}px`;
}

function afficher(ancre) {
  clearTimeout(minuterie);
  const texte = ancre.getAttribute('data-infobulle');
  if (!texte || !ancre.isConnected) return;
  const b = laBulle();
  // pendant un dialogue modal, la bulle passe dans le dialogue (le reste de la page est inerte)
  const parent = ancre.closest('dialog[open]') ?? document.body;
  if (b.parentElement !== parent) { cacher(b); parent.append(b); }
  b.textContent = typo(texte);
  cible = ancre;
  montrer(b);
  placer(b, ancre);
}

export function masquerInfobulle() {
  clearTimeout(minuterie);
  cible = null;
  if (bulle) cacher(bulle);
}

const declencheur = (e) => (e.target instanceof Element ? e.target.closest('[data-infobulle]') : null);

document.addEventListener('pointerover', (e) => {
  if (e.pointerType === 'touch') return;
  const d = declencheur(e);
  if (!d || d === cible) return;
  clearTimeout(minuterie);
  minuterie = setTimeout(() => afficher(d), DELAI);
});
document.addEventListener('pointerout', (e) => {
  const d = declencheur(e);
  if (!d) return;
  if (e.relatedTarget instanceof Node && d.contains(e.relatedTarget)) return;
  if (d === cible || !cible) masquerInfobulle();
});
document.addEventListener('focusin', (e) => {
  const d = declencheur(e);
  if (!d) return;
  let clavier = true;
  try { clavier = d.matches(':focus-visible'); } catch { /* navigateur ancien */ }
  if (clavier) afficher(d);
});
document.addEventListener('focusout', (e) => { if (declencheur(e) === cible) masquerInfobulle(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cible) masquerInfobulle(); }, true);
document.addEventListener('pointerdown', () => { if (cible) masquerInfobulle(); }, true);
window.addEventListener('scroll', () => { if (cible) masquerInfobulle(); }, true);
