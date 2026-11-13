// Breizhcosystem — dialogues natifs <dialog> (direction de design §4.14), à la place de confirm(), prompt() et alert().
// - Ouverture par un écouteur délégué sur [data-ouvre="id"] (pas de polyfill d'invocateurs).
// - Chaque dialogue modal ouvert reçoit sa propre région role="status" : le reste de la page y est inerte, donc muet.
// - annoncer() écrit dans la région du dialogue modal ouvert, sinon dans #bz-annonces (la seule région de la page).
// - Retour du focus à l'élément qui avait ouvert le dialogue.
import { el, identifiant } from './dom.js';
import { icone } from './icone.js';
import { typo } from './typo.js';

const ouvreurs = new WeakMap();

/** Dialogue modal ouvert au premier plan (ou null). */
export function dialogueOuvert() {
  const ouverts = [...document.querySelectorAll('dialog[open]')].filter((d) => { try { return d.matches(':modal'); } catch { return true; } });
  return ouverts.at(-1) ?? null;
}

function regionDe(d) {
  let r = d.querySelector(':scope > .bz-annonces-dialogue');
  if (!r) {
    r = el('div', { class: 'bz-annonces-dialogue bz-visuellement-cache', role: 'status', 'aria-live': 'polite' });
    d.append(r);
  }
  return r;
}

/** Message d'état pour les lecteurs d'écran (WCAG 4.1.3). Vide puis réécrit : un message répété est relu. */
export function annoncer(texte) {
  const d = dialogueOuvert();
  const r = d ? regionDe(d) : document.getElementById('bz-annonces');
  if (!r) return;
  r.textContent = '';
  setTimeout(() => { r.textContent = typo(String(texte)); }, 60);
}

/** Ouvre un <dialog> en modal ; focus sur [autofocus], le premier champ, ou le titre (tabindex=-1) si le dialogue n'a que du texte. */
export function ouvrir(d, { declencheur = document.activeElement } = {}) {
  if (!d || d.open) return d;
  ouvreurs.set(d, declencheur instanceof HTMLElement ? declencheur : null);
  regionDe(d);
  d.showModal();
  const cible = d.querySelector('[autofocus]') ?? d.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
  if (cible) cible.focus();
  else {
    const titre = d.querySelector('h1, h2, [data-titre]');
    if (titre) { if (!titre.hasAttribute('tabindex')) titre.setAttribute('tabindex', '-1'); titre.focus(); }
  }
  return d;
}

/** Ferme un dialogue et rend le focus à son déclencheur s'il est encore dans la page. */
export function fermer(d, valeur = '') {
  if (!d?.open) return;
  d.close(valeur);
}

function suivreFermeture(d) {
  if (d.dataset.bzSuivi) return;
  d.dataset.bzSuivi = '1';
  d.addEventListener('close', () => {
    const o = ouvreurs.get(d);
    ouvreurs.delete(d);
    // le navigateur rend déjà le focus ; filet de sécurité si le focus est tombé sur <body>. Si l'ouvreur a été
    // redessiné pendant que le dialogue était ouvert (en-tête rendu de nouveau), on retrouve son remplaçant par sa clé.
    let cible = o;
    if (o && !o.isConnected) {
      const k = o.getAttribute('data-cle');
      cible = (k && document.querySelector(`[data-cle="${CSS.escape(k)}"]`)) || (o.id && document.getElementById(o.id)) || null;
    }
    if (cible && (document.activeElement === document.body || !document.activeElement)) cible.focus({ preventScroll: true });
  });
  // Clic sur le voile : ferme un dialogue simple, jamais un parcours à étapes (data-parcours)
  d.addEventListener('click', (e) => {
    if (e.target !== d || d.hasAttribute('data-parcours') || d.getAttribute('data-voile') === 'garde') return;
    const r = d.getBoundingClientRect();
    const dedans = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (!dedans || d.classList.contains('bz-dialogue--voile')) d.close('voile');
  });
}

// [data-ouvre="id"] ouvre le dialogue #id ; [data-ferme] ferme le dialogue qui le contient
document.addEventListener('click', (e) => {
  const t = e.target instanceof Element ? e.target : null;
  const ouvre = t?.closest('[data-ouvre]');
  if (ouvre) {
    const d = document.getElementById(ouvre.getAttribute('data-ouvre') ?? '');
    if (d instanceof HTMLDialogElement) { e.preventDefault(); suivreFermeture(d); ouvrir(d, { declencheur: ouvre }); }
    return;
  }
  const ferme = t?.closest('[data-ferme]');
  if (ferme) { const d = ferme.closest('dialog'); if (d) { e.preventDefault(); fermer(d, ferme.getAttribute('data-ferme') || ''); } }
});

function construire({ titre, texte, taille = 'sm', alerte = false, corps = [], pied = [] }) {
  const idTitre = identifiant('bz-dlg-titre');
  const idTexte = identifiant('bz-dlg-texte');
  const d = el('dialog', {
    class: `bz-dialogue bz-dialogue--${taille}`, role: alerte ? 'alertdialog' : null,
    'aria-labelledby': idTitre, 'aria-describedby': texte ? idTexte : null,
  },
  el('form', { method: 'dialog', class: 'bz-dialogue__cadre' },
    el('header', { class: 'bz-dialogue__tete' },
      el('h2', { id: idTitre, class: 'bz-dialogue__titre bz-t-titre-3', texte: titre }),
      // type="button" : la touche Entrée dans un champ valide le dialogue (bouton par défaut = premier bouton submit)
      el('button', { type: 'button', 'data-ferme': '', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', 'aria-label': 'Fermer' }, icone('x'))),
    el('div', { class: 'bz-dialogue__corps' }, texte ? el('p', { id: idTexte, texte }) : null, corps),
    el('footer', { class: 'bz-dialogue__pied' }, pied)));
  suivreFermeture(d);
  return d;
}

function attendre(d, lire) {
  return new Promise((resolve) => {
    d.addEventListener('close', () => {
      const v = lire(d.returnValue);
      setTimeout(() => d.remove(), 0);
      resolve(v);
    }, { once: true });
  });
}

/**
 * Confirmation (role="alertdialog") — réservée à l'argent qui sort, à l'irréversible et à la résiliation.
 * Le titre reformule l'action, le texte dit la conséquence, les boutons sont nommés ; focus initial sur le bouton sûr.
 * confirmer({ titre: 'Débrancher HubSpot ?', texte: '…', confirmer: 'Débrancher', annuler: 'Garder', danger: true }) → Promise<boolean>
 */
export function confirmer({ titre, texte = '', confirmer: oui = 'Confirmer', annuler: non = 'Annuler', danger = false } = {}) {
  const sur = el('button', { type: 'submit', value: 'non', class: 'bz-bouton bz-bouton--secondaire', autofocus: true, texte: non });
  const action = el('button', { type: 'submit', value: 'oui', class: `bz-bouton ${danger ? 'bz-bouton--danger' : 'bz-bouton--principal'}`, texte: oui });
  const d = construire({ titre, texte, alerte: true, pied: [sur, action] });
  d.setAttribute('data-voile', 'garde');
  document.body.append(d);
  const p = attendre(d, (v) => v === 'oui');
  ouvrir(d);
  return p;
}

/**
 * Saisie d'une valeur (remplace prompt()). Le libellé est toujours visible ; Entrée valide, Échap annule.
 * demander({ titre, texte, libelle, valeur, valider: 'Enregistrer', type: 'text', autocomplete: 'off' }) → Promise<string|null>
 */
export function demander({ titre, texte = '', libelle, valeur = '', valider = 'Valider', annuler: non = 'Annuler', type = 'text', autocomplete = 'off', inputmode = null, obligatoire = true } = {}) {
  const idChamp = identifiant('bz-champ');
  const champ = el('input', { id: idChamp, class: 'bz-champ__saisie', type, value: valeur, autocomplete, inputmode, required: obligatoire, enterkeyhint: 'done' });
  const corps = el('div', { class: 'bz-champ' }, el('label', { class: 'bz-champ__libelle', for: idChamp, texte: libelle ?? titre }), champ);
  const d = construire({
    titre, texte, taille: 'md', corps: [corps],
    // « Annuler » en type="button" lui aussi : sinon il deviendrait le bouton par défaut et Entrée annulerait
    pied: [el('button', { type: 'button', 'data-ferme': 'non', class: 'bz-bouton bz-bouton--secondaire', texte: non }),
      el('button', { type: 'submit', value: 'oui', class: 'bz-bouton bz-bouton--principal', texte: valider })],
  });
  document.body.append(d);
  const p = attendre(d, (v) => (v === 'oui' ? champ.value : null));
  ouvrir(d);
  return p;
}

/** Message à lire, avec un seul bouton (remplace alert()). informer({ titre, texte, fermer: 'Fermer' }) → Promise<void> */
export function informer({ titre, texte = '', fermer: libelle = 'Fermer' } = {}) {
  const d = construire({ titre, texte, pied: [el('button', { type: 'submit', value: 'ok', class: 'bz-bouton bz-bouton--principal', autofocus: true, texte: libelle })] });
  document.body.append(d);
  const p = attendre(d, () => undefined);
  ouvrir(d);
  return p;
}

/**
 * Fenêtre simple, retirée du document à sa fermeture : fenetre({ titre, taille: 'sm'|'md'|'lg', corps: [nœuds], pied: [boutons] }).
 * Retourne le <dialog> ouvert (focus sur [autofocus], le premier champ ou le titre).
 */
export function fenetre({ titre, texte = '', taille = 'md', corps = [], pied = [] } = {}) {
  const d = construire({ titre, texte, taille, corps, pied });
  if (!pied.length) d.querySelector('.bz-dialogue__pied')?.remove();
  document.body.append(d);
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0), { once: true });
  ouvrir(d);
  return d;
}

/** Suivi d'un <dialog> construit ailleurs (voile, retour du focus, région d'annonces). */
export function preparer(d) {
  suivreFermeture(d);
  regionDe(d);
  return d;
}
