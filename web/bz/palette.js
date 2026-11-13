// Breizhcosystem — palette de commandes ⌘K (direction de design §4.3), commune au jeu et aux autres interfaces Breizhcosystem.
// <dialog> modal ; champ role="combobox" + liste role="listbox" d'options groupées ; navigation par
// @github/combobox-nav 3.0.2 (aria-activedescendant : le focus reste dans le champ) ; recherche floue uFuzzy 1.0.19,
// chargée à la première ouverture, insensible aux accents et à la casse, avec synonymes français.
// Sur téléphone : feuille basse, champ en bas (près du pouce et du clavier). Ouverte par l'onglet « Plus », elle montre
// sous la poignée des places fixes, toujours dans le même ordre (Plein soleil, Activité récente, Aide, Réglages, §4.2).
import { annoncer, preparer } from './dialogue.js';
import { el, identifiant } from './dom.js';
import { icone } from './icone.js';
import { formater } from './raccourcis.js';
import { pluriel, typo } from './typo.js';

const CLE_FRECENCE = 'bz-palette-frecence';
const PAR_GROUPE = 8;
const MAX = 40;
// Synonymes : chaque mot cherché est aussi cherché sous ses autres formes
const SYNONYMES = [
  ['ao', 'appel d offres', 'appels d offres'], ['rdv', 'rendez-vous', 'rendez vous'], ['presta', 'prestataire', 'fournisseur'],
  ['ca', 'chiffre d affaires'], ['facture', 'fact', 'factures'], ['salarie', 'employe', 'equipe', 'personne'],
  ['reglages', 'parametres', 'preferences', 'options'], ['sombre', 'nuit'], ['aide', 'raccourcis', 'clavier'],
];

let fournisseur = () => [];
let uf = null;
let Combobox = null;
let dialogue = null;
let etat = null;

/** Normalise pour la recherche : minuscules, sans accents, œ → oe, apostrophes et tirets en espaces. */
export function normaliser(t) {
  return String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/œ/g, 'oe').replace(/æ/g, 'ae').replace(/Œ/g, 'oe')
    .toLowerCase().replace(/['’\-_./]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Formes d'une requête (synonymes et identifiants sans espaces : SIRET, numéros). */
export function variantes(q) {
  const n = normaliser(q);
  const formes = new Set([n]);
  for (const groupe of SYNONYMES) {
    for (const s of groupe) {
      const re = new RegExp(`(^| )${s}( |$)`);
      if (re.test(n)) for (const autre of groupe) if (autre !== s) formes.add(n.replace(re, `$1${autre}$2`).trim());
    }
  }
  const compact = n.replace(/\s+/g, '');
  if (/^[a-z]{0,3}\d[\d ]{3,}$/.test(n)) formes.add(compact);
  return [...formes].filter(Boolean);
}

function lireFrecence() { try { return JSON.parse(localStorage.getItem(CLE_FRECENCE) ?? '{}') ?? {}; } catch { return {}; } }
function noterUsage(id) {
  if (!id) return;
  const f = lireFrecence();
  const e = f[id] ?? { n: 0, t: 0 };
  f[id] = { n: Math.min(50, e.n + 1), t: Date.now() };
  const ids = Object.keys(f).sort((a, b) => f[b].t - f[a].t).slice(0, 200);
  try { localStorage.setItem(CLE_FRECENCE, JSON.stringify(Object.fromEntries(ids.map((k) => [k, f[k]])))); } catch { /* stockage indisponible */ }
}
const score = (f, id) => { const e = f[id]; if (!e) return 0; const jours = (Date.now() - e.t) / 86_400_000; return e.n / (1 + jours); };
/** Efface l'historique local de la palette (Réglages › Confidentialité). */
export function effacerHistoriquePalette() { try { localStorage.removeItem(CLE_FRECENCE); } catch { /* rien */ } }

/**
 * Déclare la source des commandes et des objets : une fonction (requête, { plus }) qui rend des groupes, dans l'ordre
 * d'affichage ; plus est vrai dans la feuille « Plus », dont les places fixes n'ont pas à être répétées.
 * [{ groupe: 'Actions', vide: true, elements: [{ id, titre, contexte, icone, raccourci, mots, faire(e) }] }]
 * « vide: true » : groupe montré quand la recherche est vide (Suggestions, Actions, Aller à) ; « seulementVide: true » :
 * groupe absent des résultats d'une recherche (des suggestions déjà présentes dans un autre groupe).
 */
export function sourcePalette(f) { fournisseur = f; }

async function charger() {
  if (!uf) {
    try {
      const m = await import('/vendor/ufuzzy@1.0.19.js');
      uf = new m.default({ intraMode: 1, interSplit: "[^a-z\\d']+", intraIns: 1 });
    } catch { uf = false; } // repli : recherche par sous-chaîne
  }
  if (!Combobox) {
    try { Combobox = (await import('/vendor/combobox-nav@3.0.2.js')).default; } catch { Combobox = false; }
  }
}

function filtrer(groupes, q) {
  const f = lireFrecence();
  if (!q.trim()) {
    return groupes.filter((g) => g.vide).map((g) => ({ ...g, elements: g.elements.slice().sort((a, b) => Number(Boolean(b.epingle)) - Number(Boolean(a.epingle)) || score(f, b.id) - score(f, a.id)).slice(0, g.max ?? PAR_GROUPE) }));
  }
  const tous = groupes.flatMap((g, gi) => (g.seulementVide ? [] : g.elements.map((e) => ({ e, gi }))));
  const botte = tous.map(({ e }) => normaliser(`${e.titre} ${e.contexte ?? ''} ${e.mots ?? ''}`));
  const compacts = botte.map((t) => t.replace(/\s+/g, ''));
  const trouves = new Map(); // index → rang
  for (const v of variantes(q)) {
    let idx = null;
    if (uf) {
      try {
        const [ids, info, ordre] = uf.search(botte, v, 0, 1000);
        if (ids) idx = info && ordre ? ordre.map((o) => info.idx[o]) : ids;
      } catch { idx = null; }
    }
    if (!idx) { const mots = v.split(' '); idx = botte.map((t, i) => (mots.every((m) => t.includes(m)) ? i : -1)).filter((i) => i >= 0); }
    if (/^\S+$/.test(v) && /\d/.test(v)) compacts.forEach((t, i) => { if (t.includes(v)) idx.push(i); });
    idx.forEach((i, rang) => { if (!trouves.has(i) || trouves.get(i) > rang) trouves.set(i, rang); });
  }
  const resultat = groupes.map((g) => ({ ...g, elements: [] }));
  [...trouves.entries()].sort((a, b) => a[1] - b[1] || score(f, tous[b[0]].e.id) - score(f, tous[a[0]].e.id))
    .forEach(([i]) => { const { e, gi } = tous[i]; if (resultat[gi].elements.length < PAR_GROUPE) resultat[gi].elements.push(e); });
  let reste = MAX;
  return resultat.filter((g) => g.elements.length).map((g) => { const el2 = g.elements.slice(0, Math.max(0, reste)); reste -= el2.length; return { ...g, elements: el2 }; }).filter((g) => g.elements.length);
}

const FEUILLE = '(max-width: 37.49em)';

/** Places fixes de la feuille « Plus » : boutons (pas des options de la liste), dans l'ordre reçu. */
function zonePlaces(places, fermer) {
  if (!places?.length) return null;
  return el('div', { class: 'bz-palette__places', role: 'group', 'aria-label': 'Accès rapides' },
    places.map((p) => {
      const b = el('button', { type: 'button', class: 'bz-palette__place', 'aria-pressed': p.presse === undefined ? null : String(Boolean(p.presse)) },
        icone(p.icone ?? 'chevron-right'), el('span', { texte: p.titre }));
      b.addEventListener('click', () => {
        if (p.basculer) {
          // bascule sur place (Plein soleil) : la feuille reste ouverte, l'état se lit dans aria-pressed
          const oui = p.basculer();
          b.setAttribute('aria-pressed', String(Boolean(oui)));
          return;
        }
        fermer();
        setTimeout(() => { try { p.faire?.(); } catch (err) { console.error('[palette]', err); } }, 0);
      });
      return b;
    }));
}

/** Glisser la poignée vers le bas ferme la feuille (doublé du bouton Fermer et d'Échap). */
function glisserPourFermer(zone, d) {
  let depart = null;
  zone.addEventListener('pointerdown', (e) => { if (e.target instanceof Element && e.target.closest('button')) return; depart = e.clientY; zone.setPointerCapture?.(e.pointerId); });
  zone.addEventListener('pointermove', (e) => { if (depart !== null && e.clientY - depart > 64) { depart = null; d.close('glisser'); } });
  const fin = () => { depart = null; };
  zone.addEventListener('pointerup', fin);
  zone.addEventListener('pointercancel', fin);
}

function construire({ feuille = false, places = null, titre = 'Rechercher ou faire une action' } = {}) {
  const idListe = identifiant('bz-palette-liste');
  const idTitre = identifiant('bz-palette-titre');
  const champ = el('input', {
    class: 'bz-palette__champ', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go',
    placeholder: 'Rechercher ou faire une action…', 'aria-labelledby': idTitre,
  });
  const liste = el('ul', { id: idListe, class: 'bz-palette__liste', role: 'listbox', 'aria-labelledby': idTitre });
  const vide = el('div', { class: 'bz-palette__vide', hidden: true });
  const entete = el('div', { class: 'bz-palette__entete' }, icone('search'), champ,
    el('kbd', { class: 'bz-raccourci', texte: 'Échap' }));
  const resultats = el('div', { class: 'bz-palette__resultats' }, liste, vide);
  const aide = el('p', { class: 'bz-palette__aide bz-t-micro' },
    el('kbd', { class: 'bz-raccourci', texte: '↑' }), el('kbd', { class: 'bz-raccourci', texte: '↓' }), ' pour choisir · ',
    el('kbd', { class: 'bz-raccourci', texte: 'Entrée' }), ' pour ouvrir');
  const d = el('dialog', { class: `bz-palette${feuille ? ' bz-palette--feuille' : ''}`, 'aria-labelledby': idTitre },
    el('h2', { id: idTitre, class: 'bz-visuellement-cache', texte: titre }));
  const fermer = () => d.close();
  const poignee = feuille ? el('div', { class: 'bz-palette__poignee' },
    el('span', { class: 'bz-t-surtitre', 'aria-hidden': 'true', texte: places?.length ? 'Plus' : 'Rechercher' }),
    el('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', 'aria-label': 'Fermer', onclick: fermer }, icone('x'))) : null;
  if (poignee) glisserPourFermer(poignee, d);
  // Feuille : poignée et places fixes en haut, résultats, champ en bas (au pouce, collé au clavier) ; l'ordre du DOM
  // suit l'ordre visuel. Ordinateur : champ en haut, résultats, aide clavier.
  if (feuille) d.append(poignee, zonePlaces(places, fermer) ?? '', resultats, entete);
  else d.append(entete, zonePlaces(places, fermer) ?? '', resultats, aide);
  preparer(d);
  d.classList.add('bz-dialogue--voile');
  champ.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && champ.value) { e.preventDefault(); e.stopPropagation(); champ.value = ''; etat.q = ''; rendre(); }
    // Sans combobox-nav (fichier indisponible) : flèches et Entrée gérées ici
    if (Combobox || e.isComposing) return;
    const options = [...liste.querySelectorAll('[role="option"]')];
    const i = options.findIndex((o) => o.getAttribute('aria-selected') === 'true');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const j = options.length ? (i + (e.key === 'ArrowDown' ? 1 : -1) + options.length + (i < 0 && e.key === 'ArrowUp' ? 1 : 0)) % options.length : -1;
      options.forEach((o, k) => { if (k === j) o.setAttribute('aria-selected', 'true'); else o.removeAttribute('aria-selected'); });
      if (options[j]) { champ.setAttribute('aria-activedescendant', options[j].id); options[j].scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Enter' && options.length) { e.preventDefault(); executer(options[Math.max(0, i)]); }
  });
  liste.addEventListener('click', (e) => { if (!Combobox) { const o = e.target instanceof Element ? e.target.closest('[role="option"]') : null; if (o) executer(o); } });
  liste.addEventListener('combobox-commit', (e) => executer(e.target));
  d.addEventListener('close', () => { etat?.combo?.stop?.(); etat = null; d.remove(); dialogue = null; });
  return { d, champ, liste, vide };
}

function executer(option) {
  const id = option?.getAttribute('data-id');
  const elt = etat?.index.get(id ?? '');
  if (!elt || etat.fait) return;
  etat.fait = true;
  noterUsage(elt.id);
  dialogue?.d.close('choix');
  // la fermeture rend le focus d'abord ; l'action peut ensuite déplacer le focus (vue, fiche)
  setTimeout(() => { try { elt.faire(); } catch (err) { console.error('[palette]', err); } }, 0);
}

function rendre() {
  if (!etat || !dialogue) return;
  const { liste, vide, champ } = dialogue;
  let groupes = [];
  try { groupes = fournisseur(etat.q, { plus: etat.plus }) ?? []; } catch (err) { console.error('[palette]', err); }
  const res = filtrer(groupes, etat.q);
  etat.index = new Map();
  let n = 0;
  const noeuds = res.map((g) => {
    const idG = identifiant('bz-palette-groupe');
    return el('li', { role: 'presentation', class: 'bz-palette__groupe' },
      el('div', { id: idG, class: 'bz-palette__intertitre bz-t-surtitre', role: 'presentation', texte: g.groupe }),
      el('ul', { role: 'group', 'aria-labelledby': idG },
        g.elements.map((e) => {
          const id = `${liste.id}-${n++}`;
          etat.index.set(id, e);
          return el('li', { id, role: 'option', class: 'bz-palette__option', 'data-id': id },
            icone(e.icone ?? 'chevron-right', { classe: 'bz-palette__icone' }),
            el('span', { class: 'bz-palette__libelle' }, el('span', { class: 'bz-palette__titre', texte: e.titre }),
              e.contexte ? el('span', { class: 'bz-palette__contexte', texte: e.contexte }) : null),
            e.raccourci ? el('kbd', { class: 'bz-raccourci', texte: formater(e.raccourci) }) : null);
        })));
  });
  liste.replaceChildren(...noeuds);
  champ.removeAttribute('aria-activedescendant');
  vide.hidden = n > 0;
  if (!n) vide.replaceChildren(el('p', { texte: etat.q.trim() ? `Aucun résultat pour « ${etat.q.trim()} ».` : 'Rien à proposer pour l’instant.' }));
  etat.combo?.resetSelection?.(); // active la première option (aria-activedescendant) : Entrée l'exécute
  clearTimeout(etat.annonce);
  etat.annonce = setTimeout(() => annoncer(n ? pluriel(n, 'résultat', 'résultats') : typo('Aucun résultat')), 300);
  champ.setAttribute('aria-expanded', n ? 'true' : 'false');
}

export function paletteOuverte() { return Boolean(dialogue?.d.open); }

/**
 * Ouvre la palette (⌘K, champ de l'en-tête, onglet « Plus »). Même raccourci pour la fermer.
 * places : [{ id, titre, icone, faire() } | { …, presse, basculer() → booléen }] montrées sous la poignée (« Plus »).
 */
export async function ouvrirPalette({ requete = '', places = null } = {}) {
  if (paletteOuverte()) { dialogue.d.close(); return; }
  await charger();
  const feuille = typeof matchMedia === 'function' && matchMedia(FEUILLE).matches;
  dialogue = construire({ feuille, places, titre: places?.length ? 'Plus : rechercher, aller à, faire une action' : 'Rechercher ou faire une action' });
  etat = { q: requete, index: new Map(), combo: null, plus: Boolean(places?.length) };
  document.body.append(dialogue.d);
  dialogue.champ.value = requete;
  dialogue.d.showModal();
  if (Combobox) {
    // « selected » : la première option est VRAIMENT active (aria-selected, aria-activedescendant, contour de 2 px) ;
    // ↓ passe à la suivante (avec « active », elle n'était que surlignée et ↓ la réactivait, §4.3)
    etat.combo = new Combobox(dialogue.champ, dialogue.liste, { tabInsertsSuggestions: false, firstOptionSelectionMode: 'selected', scrollIntoViewOptions: { block: 'nearest' } });
    etat.combo.start();
  } else {
    dialogue.champ.setAttribute('role', 'combobox');
    dialogue.champ.setAttribute('aria-controls', dialogue.liste.id);
    dialogue.champ.setAttribute('aria-autocomplete', 'list');
  }
  // écouté APRÈS combobox-nav (qui efface la sélection à chaque frappe) : la première option reste marquée
  dialogue.champ.addEventListener('input', () => { if (etat) { etat.q = dialogue.champ.value; rendre(); } });
  rendre();
  // Feuille « Plus » au toucher : pas de clavier d'office (il cacherait les places fixes) ; au clavier, le champ.
  if (!(feuille && places?.length && matchMedia('(pointer: coarse)').matches)) dialogue.champ.focus();
  else dialogue.d.querySelector('.bz-palette__place')?.focus({ preventScroll: true });
}

export function fermerPalette() { dialogue?.d.close(); }
