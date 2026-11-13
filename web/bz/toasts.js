// Breizhcosystem — toasts (direction de design §4.16).
// Un seul toast à la fois (les suivants attendent), 6 s au minimum, 10 s s'il porte une action ; pause au survol et au
// focus (WCAG 2.2.1), bouton Fermer. Posé en bas (au-dessus de la barre d'onglets sur téléphone), en couche supérieure
// (popover="manual") ; pendant un dialogue modal, l'hôte passe DANS le dialogue pour que « Annuler » reste utilisable.
// Le texte est aussi lu par la région d'annonces (un toast n'est jamais le seul porteur d'une erreur : voir §4.16).
import { annoncer, dialogueOuvert } from './dialogue.js';
import { el } from './dom.js';
import { icone } from './icone.js';
import { cacher, montrer } from './popover.js';

const ICONES = { info: 'info', ok: 'circle-check', attention: 'triangle-alert', critique: 'octagon-alert', celebration: 'party-popper' }; // célébration : fin de quête (§4.25)
const DUREE = 6000;
const DUREE_ACTION = 10000;
const file = [];
let actuel = null;
let hote = null;

function lHote() {
  if (!hote) {
    hote = el('div', { id: 'bz-toasts', class: 'bz-toasts', popover: 'manual' });
    document.body.append(hote);
  }
  const parent = dialogueOuvert() ?? document.body;
  if (hote.parentElement !== parent) {
    cacher(hote);
    parent.append(hote);
  }
  return hote;
}

// Un dialogue se ferme pendant un toast : l'hôte revient dans <body>
document.addEventListener('close', () => { if (actuel && hote && !hote.closest('dialog[open]')) { lHote(); montrer(hote); } }, true);

/**
 * toast({ texte, ton: 'info'|'ok'|'attention'|'critique', action: { libelle: 'Annuler', faire() }, duree })
 * surFin(raison, resteMs) : raison « delai », « action » ou « fermeture ». Retourne { fermer(), maj(texte) }.
 * ton « critique » : l'erreur doit aussi être écrite près de ce qui l'a causée.
 */
export function toast({ texte, ton = 'info', action = null, duree = null, surFin = null } = {}) {
  const t = { texte, ton: ICONES[ton] ? ton : 'info', action, duree: Math.max(duree ?? 0, action ? DUREE_ACTION : DUREE), surFin, ferme: false };
  file.push(t);
  if (!actuel) suivant();
  return { fermer: () => terminer(t, 'fermeture'), maj: (nouveau) => { t.texte = nouveau; if (t.noeudTexte) t.noeudTexte.textContent = nouveau; } };
}

function suivant() {
  actuel = file.shift() ?? null;
  const h = lHote();
  if (!actuel) { h.replaceChildren(); cacher(h); return; }
  const t = actuel;
  t.restant = t.duree;
  t.debut = Date.now();
  t.noeudTexte = el('p', { class: 'bz-toast__texte', texte: t.texte });
  const boutons = [];
  if (t.action) boutons.push(el('button', { type: 'button', class: 'bz-toast__action', texte: t.action.libelle, onclick: () => { try { t.action.faire(); } finally { terminer(t, 'action'); } } }));
  boutons.push(el('button', { type: 'button', class: 'bz-toast__fermer', 'aria-label': 'Fermer le message', onclick: () => terminer(t, 'fermeture') }, icone('x', { taille: 'sm' })));
  const n = el('div', { class: `bz-toast bz-toast--${t.ton}`, 'data-ton': t.ton }, icone(ICONES[t.ton]), t.noeudTexte, boutons);
  const pause = () => { if (t.minuterie) { clearTimeout(t.minuterie); t.minuterie = null; t.restant -= Date.now() - t.debut; } };
  const reprise = () => { if (!t.minuterie && !t.ferme && !n.matches(':hover') && !n.contains(document.activeElement)) { t.debut = Date.now(); t.minuterie = setTimeout(() => terminer(t, 'delai'), Math.max(1500, t.restant)); } };
  n.addEventListener('pointerenter', pause);
  n.addEventListener('pointerleave', reprise);
  n.addEventListener('focusin', pause);
  n.addEventListener('focusout', () => setTimeout(reprise, 0));
  h.replaceChildren(n);
  montrer(h);
  annoncer(t.texte);
  t.minuterie = setTimeout(() => terminer(t, 'delai'), t.duree);
}

function terminer(t, raison) {
  if (t.ferme) return;
  t.ferme = true;
  const reste = t.restant === undefined ? t.duree : Math.max(0, t.minuterie ? t.restant - (Date.now() - t.debut) : t.restant);
  clearTimeout(t.minuterie);
  t.minuterie = null;
  const i = file.indexOf(t);
  if (i >= 0) file.splice(i, 1);
  try { t.surFin?.(raison, reste); } catch { /* le toast se ferme quand même */ }
  if (t === actuel) suivant();
}

/** Ferme tous les toasts (changement d'écran de connexion, déconnexion). */
export function viderToasts() {
  file.length = 0;
  if (actuel) terminer(actuel, 'fermeture');
}
