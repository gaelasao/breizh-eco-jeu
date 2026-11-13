// Breizhcosystem — liste déroulante filtrable (direction de design §4.6 : au-delà de 15 options, un combobox
// filtrable remplace le <select>). Champ role="combobox" (aria-expanded, aria-controls, aria-autocomplete="list",
// aria-activedescendant : le focus reste dans le champ) et liste role="listbox" posée sous le champ, dans le flux du
// formulaire (jamais coupée par un dialogue). Recherche insensible aux accents et à la casse.
// Clavier : ↓ ouvre et descend, ↑ remonte (circulaire), Entrée choisit, Échap referme la liste sans fermer le dialogue,
// Tab quitte en gardant le dernier choix. Option active : fond et contour de 2 px (§4.3), comme la palette.
import { el, identifiant } from './dom.js';
import { icone } from './icone.js';
import { pluriel } from './typo.js';

/** Recherche : minuscules, sans accents (« Équipe » ↔ « equipe »). */
export const pourRecherche = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Options qui contiennent chaque mot cherché, dans le libellé ou le détail ; la requête vide les garde toutes. */
export function filtrerOptions(options, requete) {
  const mots = pourRecherche(requete).split(/\s+/).filter(Boolean);
  if (!mots.length) return options;
  return options.filter((o) => { const t = pourRecherche(`${o.libelle} ${o.detail ?? ''}`); return mots.every((m) => t.includes(m)); });
}

/**
 * comboFiltrable({ id, options: [{ valeur, libelle, detail? }], valeur, onchange(valeur), annoncer?(texte) })
 * Renvoie l'élément à poser dans le .bz-champ, sous son <label for={id}>.
 */
export function comboFiltrable({ id, options, valeur = '', onchange = () => {}, annoncer = null, decrit = null }) {
  const idListe = identifiant(`${id}-liste`);
  let choisie = options.find((o) => String(o.valeur) === String(valeur)) ?? null;
  let visibles = options;
  let active = -1;
  const champ = el('input', {
    id, class: 'bz-champ__saisie bz-combo__champ', type: 'text', role: 'combobox', autocomplete: 'off', spellcheck: 'false',
    'aria-expanded': 'false', 'aria-controls': idListe, 'aria-autocomplete': 'list', 'aria-describedby': decrit,
    placeholder: 'Tapez pour filtrer…', value: choisie?.libelle ?? '',
  });
  const liste = el('ul', { id: idListe, class: 'bz-combo__liste', role: 'listbox', hidden: true });
  const ouvrir = () => el('span', { class: 'bz-combo__bouton', 'aria-hidden': 'true' }, icone('chevron-down'));
  const cadre = el('div', { class: 'bz-combo' }, champ, ouvrir(), liste);

  const marquer = (i) => {
    const items = [...liste.children];
    active = items.length ? (i + items.length) % items.length : -1;
    items.forEach((li, k) => { if (k === active) li.setAttribute('aria-selected', 'true'); else li.removeAttribute('aria-selected'); });
    if (active >= 0) { champ.setAttribute('aria-activedescendant', items[active].id); items[active].scrollIntoView({ block: 'nearest' }); }
    else champ.removeAttribute('aria-activedescendant');
  };
  const dessiner = (requete) => {
    visibles = filtrerOptions(options, requete);
    liste.replaceChildren(...(visibles.length ? visibles.map((o, i) => el('li', { id: `${idListe}-${i}`, role: 'option', class: 'bz-combo__option', 'data-valeur': String(o.valeur), 'aria-checked': choisie === o ? 'true' : null },
      el('span', { class: 'bz-combo__libelle', texte: o.libelle }), o.detail ? el('span', { class: 'bz-combo__detail', texte: o.detail }) : null,
      choisie === o ? icone('check', { taille: 'sm', classe: 'bz-combo__coche' }) : null))
      : [el('li', { class: 'bz-combo__vide', role: 'presentation', texte: `Aucun choix ne contient « ${requete.trim()} ».` })]));
    if (!visibles.length) liste.firstElementChild.removeAttribute('role');
  };
  const montrer = (requete = '') => {
    dessiner(requete);
    liste.hidden = false;
    champ.setAttribute('aria-expanded', 'true');
    const i = visibles.indexOf(choisie);
    marquer(visibles.length ? (requete ? 0 : Math.max(0, i)) : -1);
  };
  const fermer = ({ retablir = true } = {}) => {
    liste.hidden = true;
    champ.setAttribute('aria-expanded', 'false');
    champ.removeAttribute('aria-activedescendant');
    active = -1;
    if (retablir) champ.value = choisie?.libelle ?? '';
  };
  const choisir = (o) => {
    if (!o) return;
    choisie = o;
    champ.value = o.libelle;
    fermer();
    onchange(o.valeur);
  };
  let annonce = null;
  champ.addEventListener('input', () => {
    montrer(champ.value);
    if (annoncer) { clearTimeout(annonce); annonce = setTimeout(() => annoncer(visibles.length ? pluriel(visibles.length, 'choix', 'choix') : 'Aucun choix'), 300); }
  });
  champ.addEventListener('click', () => { if (liste.hidden) { champ.select(); montrer(); } });
  champ.addEventListener('keydown', (e) => {
    if (e.isComposing) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (liste.hidden) { montrer(); return; }
      marquer(active + (e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      if (!liste.hidden) { e.preventDefault(); choisir(visibles[active]); }
    } else if (e.key === 'Escape') {
      // la liste ouverte est la couche du dessus : Échap la referme, le dialogue reste ouvert (§4.4)
      if (!liste.hidden) { e.preventDefault(); e.stopPropagation(); fermer(); }
    } else if (e.key === 'Tab') fermer();
  });
  champ.addEventListener('blur', () => setTimeout(() => { if (!cadre.contains(document.activeElement)) fermer(); }, 120));
  liste.addEventListener('pointerdown', (e) => e.preventDefault()); // le champ garde le focus
  liste.addEventListener('click', (e) => {
    const li = e.target instanceof Element ? e.target.closest('[role="option"]') : null;
    if (li) choisir(visibles[[...liste.children].indexOf(li)]);
  });
  return cadre;
}
