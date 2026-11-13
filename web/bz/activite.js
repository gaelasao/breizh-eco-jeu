// Breizhcosystem — « Activité récente » (direction de design §4.16) : la cloche de l'en-tête sur ordinateur, une
// place fixe de la feuille « Plus » sur téléphone. On y retrouve ce qui s'est passé (groupé par jour) et chaque action
// réversible encore annulable (30 minutes), pour qu'un toast ne soit jamais le seul porteur d'un retour.
import { historique, journal, surHistorique } from './annuler.js';
import { fenetre } from './dialogue.js';
import { el } from './dom.js';
import { icone } from './icone.js';

const ICONES = { info: 'info', ok: 'circle-check', attention: 'triangle-alert', critique: 'octagon-alert' };
const heure = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
const jour = (t) => new Date(t).toDateString();
function libelleJour(t) {
  const d = new Date(t);
  const auj = new Date();
  if (d.toDateString() === auj.toDateString()) return 'Aujourd’hui';
  const hier = new Date(auj.getFullYear(), auj.getMonth(), auj.getDate() - 1);
  if (d.toDateString() === hier.toDateString()) return 'Hier';
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
}

function temps(t) {
  return el('time', { datetime: new Date(t).toISOString(), texte: heure(t) });
}

function contenu() {
  const annulables = historique();
  const notes = journal();
  const blocs = [];
  if (annulables.length) {
    blocs.push(el('section', { 'aria-labelledby': 'bz-activite-annulables' },
      el('h3', { id: 'bz-activite-annulables', class: 'bz-t-surtitre', texte: 'Encore annulable' }),
      el('ul', { role: 'list' }, annulables.map((a) => el('li', {},
        temps(a.le),
        el('span', { texte: a.libelle }),
        el('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', 'aria-label': `Annuler : ${a.libelle}`, onclick: () => { void a.annuler(); } },
          icone('undo-2', { taille: 'sm' }), 'Annuler'))))));
  }
  const parJour = new Map();
  for (const n of notes) {
    const k = jour(n.le);
    if (!parJour.has(k)) parJour.set(k, []);
    parJour.get(k).push(n);
  }
  let i = 0;
  for (const liste of parJour.values()) {
    const id = `bz-activite-jour-${i++}`;
    blocs.push(el('section', { 'aria-labelledby': id },
      el('h3', { id, class: 'bz-t-surtitre', texte: libelleJour(liste[0].le) }),
      el('ul', { role: 'list' }, liste.map((n) => el('li', {}, temps(n.le), el('span', { texte: n.texte }), icone(ICONES[n.ton] ?? 'info', { taille: 'sm' }))))));
  }
  if (!blocs.length) {
    blocs.push(el('div', { class: 'bz-vide' },
      el('p', { class: 'bz-vide__titre', texte: 'Rien pour l’instant.' }),
      el('p', { class: 'bz-vide__texte', texte: 'Ce que vous faites ici s’affichera dans cette liste, avec « Annuler » pendant 30 minutes.' })));
  }
  return blocs;
}

/** Ouvre « Activité récente » ; la liste suit en direct les annulations et les nouvelles entrées. */
export function ouvrirActivite() {
  const corps = el('div', { class: 'bz-activite' }, contenu());
  const d = fenetre({ titre: 'Activité récente', taille: 'md', corps: [corps],
    pied: [el('button', { type: 'submit', value: '', class: 'bz-bouton bz-bouton--secondaire', texte: 'Fermer' })] });
  const arreter = surHistorique(() => { if (d.open) corps.replaceChildren(...contenu()); });
  d.addEventListener('close', () => arreter(), { once: true });
  return d;
}
