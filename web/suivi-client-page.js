// Page de suivi d'un client : elle dessine ce que suivi-client.js décide. Aucune session, le jeton est dans l'adresse.
// Typographie française (Breizhcosystem) appliquée aux textes et aux attributs lus par les lecteurs d'écran.
import { typo } from '/bz/typo.js';
import { icone } from '/bz/icone.js';
import { etat, iconeEtape, jourLisible, pourcentage, resumeAvancement, tonEtape, tonPhrase } from '/suivi-client.js';

const jeton = location.pathname.split('/').pop() ?? '';
const racine = document.getElementById('suivi');

function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'texte') el.textContent = typo(String(v));
    else if (k === 'aria-label' || k === 'title' || k === 'alt') el.setAttribute(k, typo(String(v)));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const e of enfants.flat()) if (e !== null && e !== undefined) el.append(e instanceof Node ? e : typo(String(e)));
  return el;
}

/** Un lien retiré, inconnu, ou une réponse qui n'arrive pas : une phrase, et rien d'autre à l'écran. */
function dessinerFerme(message) {
  racine.replaceChildren(h('div', { class: 'ferme' },
    h('div', { class: 'rond' }, icone('unlink', { taille: 'lg' })),
    h('h1', { texte: 'Lien de suivi' }),
    h('p', { class: 'intro', texte: message })));
}

function dessinerSuivi(p) {
  // `data-courante` : là où en est le travail. C'est tout ce que la page dit quand l'entreprise garde son retard
  // pour elle (réglage « Dire seulement l'étape en cours »), et un repère utile quand elle le montre.
  const etapes = h('ol', { class: 'etapes' }, p.etapes.map((e) => h('li', { class: `etape ton-${tonEtape(e.etat)}`, 'data-etat': e.etat, 'data-courante': e.courante ? '' : null },
    h('span', { class: 'puce' }, icone(iconeEtape(e.etat))),
    h('span', { class: 'nom', texte: e.libelle }),
    e.courante ? h('span', { class: 'courante', texte: 'en cours' }) : null,
    jourLisible(e.jour) ? h('span', { class: 'quand', texte: jourLisible(e.jour) }) : null)));
  const photos = p.photos.length
    ? h('section', { class: 'photos' }, h('h2', { texte: 'Photos' }),
        h('div', { class: 'grille' }, p.photos.map((ph) => h('img', { src: ph.lien, loading: 'lazy', decoding: 'async', alt: 'Photo du suivi' }))))
    : null;
  const avis = p.avis
    ? h('section', { class: 'avis' }, h('h2', { texte: 'Votre avis' }),
        h('p', { class: 'intro', texte: 'C’est terminé. Un mot sur la façon dont cela s’est passé nous aiderait beaucoup.' }),
        h('a', { class: 'bouton', href: p.avis.lien, texte: 'Donner mon avis' }))
    : null;
  // `replaceChildren` n'écarte pas les absents comme `h` le fait : une section absente écrirait « null » dans la page
  racine.replaceChildren(...[
    h('p', { class: 'surtitre', texte: p.entreprise }),
    h('h1', { texte: p.titre }),
    h('p', { class: 'reference', texte: p.reference }),
    h('p', { class: `phrase ton-${tonPhrase(p)}`, texte: p.phrase }),
    h('p', { class: 'avancement', texte: resumeAvancement(p.avancement) }),
    h('div', { class: 'jauge', role: 'img', 'aria-label': `${pourcentage(p.avancement)} %` },
      h('span', { style: `inline-size:${pourcentage(p.avancement)}%` })),
    etapes, photos, avis,
  ].filter((x) => x !== null));
}

async function charger() {
  let page;
  try {
    const r = await fetch(`/api/public/suivi/${encodeURIComponent(jeton)}`, { headers: { accept: 'application/json' } });
    page = await r.json();
  } catch {
    page = null;
  }
  const e = etat(page);
  if (e.quoi === 'suivi') {
    document.title = typo(`${e.page.titre} — ${e.page.entreprise}`);
    dessinerSuivi(e.page);
    return;
  }
  dessinerFerme(e.message);
}

void charger();
