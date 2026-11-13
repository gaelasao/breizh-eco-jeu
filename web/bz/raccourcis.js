// Breizhcosystem — raccourcis clavier communs (direction de design §4.4, WCAG 2.1.4). Sans dépendance.
// - « $mod » = ⌘ sur Apple, Ctrl ailleurs. Séquences « g a » avec 1 s de délai. Ignorés pendant une composition IME.
// - On compare event.key en minuscules, jamais event.code (claviers AZERTY) ; aucune touche qui demande AltGr.
// - Touches simples et séquences : hors champ de saisie seulement, et désactivables (Réglages › Clavier,
//   data-raccourcis="non" posé par theme.js). Portée « partout » : aussi dans un champ (⌘K, Échap…).
// - Pendant un dialogue modal, seuls les raccourcis « dialogue: true » restent actifs (Échap appartient au dialogue).

export const APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const DELAI_SEQUENCE = 1000;
const liste = [];
let prefixe = null;
let minuterie = null;

const champ = (t) => t instanceof Element && (t.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, select, [contenteditable]:not([contenteditable="false"])') || t.closest('[contenteditable]:not([contenteditable="false"])') !== null);
const toucheSimpleActive = () => document.documentElement.getAttribute('data-raccourcis') !== 'non';
const dialogueModal = () => { try { return document.querySelector('dialog:modal') !== null; } catch { return document.querySelector('dialog[open]') !== null; } };

function analyser(combo) {
  return combo.trim().toLowerCase().split(/\s+/).map((pas) => {
    const parts = pas === '+' ? ['+'] : pas.split('+').filter(Boolean);
    const touche = parts.pop() ?? '';
    return { touche, mod: parts.includes('$mod'), maj: parts.includes('shift') || parts.includes('maj'), alt: parts.includes('alt'), ctrl: parts.includes('ctrl') };
  });
}

function correspond(pas, e) {
  const mod = APPLE ? e.metaKey : e.ctrlKey;
  const autreMod = APPLE ? e.ctrlKey : e.metaKey;
  const touche = (e.key ?? '').toLowerCase();
  if (touche !== pas.touche && !(pas.touche === 'espace' && touche === ' ')) return false;
  if (pas.mod !== mod || (autreMod && !pas.ctrl) || pas.alt !== e.altKey) return false;
  // Maj : exigée si déclarée ; ignorée pour les signes qui la demandent sur certains claviers (? / + sur AZERTY)
  if (pas.maj && !e.shiftKey) return false;
  if (!pas.maj && e.shiftKey && /^[a-z0-9]$/.test(pas.touche)) return false;
  return true;
}

/**
 * raccourci('$mod+k', ouvrirPalette, { portee: 'partout', description: 'Palette de commandes', groupe: 'Général' })
 * raccourci('g a', allerAujourdhui, { description: 'Aujourd’hui', groupe: 'Aller à' })
 * Retourne une fonction qui retire le raccourci.
 */
export function raccourci(combo, faire, { portee = 'hors-champ', description = '', groupe = 'Général', dialogue = false, quand = null } = {}) {
  const r = { combo, pas: analyser(combo), faire, portee, description, groupe, dialogue, quand };
  liste.push(r);
  return () => { const i = liste.indexOf(r); if (i >= 0) liste.splice(i, 1); };
}

/** Texte affiché d'un raccourci : « ⌘K » sur Apple, « Ctrl+K » ailleurs ; « G puis A » ; « − » pour le zoom arrière. */
export function formater(combo) {
  return analyser(combo).map((p) => {
    const t = p.touche === 'escape' ? 'Échap' : p.touche === 'enter' ? 'Entrée' : p.touche === 'espace' ? 'Espace' : p.touche === '-' ? '−' : p.touche === 'arrowup' ? '↑' : p.touche === 'arrowdown' ? '↓' : p.touche.length === 1 ? p.touche.toUpperCase() : p.touche;
    if (APPLE) return `${p.ctrl ? '⌃' : ''}${p.alt ? '⌥' : ''}${p.maj ? '⇧' : ''}${p.mod ? '⌘' : ''}${t}`;
    return [p.mod || p.ctrl ? 'Ctrl' : '', p.alt ? 'Alt' : '', p.maj ? 'Maj' : '', t].filter(Boolean).join('+');
  }).join(' puis ');
}

/** Raccourcis déclarés, groupés (pour la feuille « ? »). */
export function raccourcisParGroupe() {
  const g = new Map();
  for (const r of liste) {
    if (!r.description) continue;
    if (!g.has(r.groupe)) g.set(r.groupe, []);
    g.get(r.groupe).push({ touches: formater(r.combo), description: r.description, simple: r.portee !== 'partout' });
  }
  return g;
}

function executer(r, e) {
  e.preventDefault();
  try { r.faire(e); } catch (err) { console.error('[raccourcis]', err); }
}

document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
  if (['shift', 'control', 'alt', 'meta', 'altgraph'].includes((e.key ?? '').toLowerCase())) return;
  const dansChamp = champ(e.target);
  const modal = dialogueModal();
  const admis = (r) => (r.portee === 'partout' || (!dansChamp && toucheSimpleActive())) && (!modal || r.dialogue) && (!r.quand || r.quand(e));
  // Deuxième touche d'une séquence (« g » puis « a »)
  if (prefixe) {
    const p = prefixe;
    prefixe = null;
    clearTimeout(minuterie);
    const r = liste.find((x) => x.pas.length === 2 && correspond(x.pas[0], p) && correspond(x.pas[1], e) && admis(x));
    if (r) { executer(r, e); return; }
  }
  const simple = liste.filter((x) => x.pas.length === 1 && correspond(x.pas[0], e) && admis(x));
  const r = simple.at(-1); // le dernier déclaré l'emporte (un écran peut surcharger un raccourci global)
  if (r) { executer(r, e); return; }
  if (liste.some((x) => x.pas.length === 2 && correspond(x.pas[0], e) && admis(x))) {
    prefixe = { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey };
    minuterie = setTimeout(() => { prefixe = null; }, DELAI_SEQUENCE);
  }
});
