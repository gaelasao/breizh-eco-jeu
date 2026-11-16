// Geste fait depuis un message d'alerte : « C'est fait », « Plus tard ». Aucune session, le jeton est dans l'adresse.
// Rien n'est joué à l'ouverture de la page : on dit d'abord ce que le geste va faire, et c'est le bouton qui agit
// (un service qui déplie les liens d'un message ne doit pas décider à la place de la personne).
// Le même geste rejoué ne refait rien : la passerelle le dit, et la page le répète sans drame.
import { typo } from '/bz/typo.js';
import { icone } from '/bz/icone.js';

const jeton = location.pathname.split('/').pop() ?? '';
const racine = document.getElementById('geste');
const adresse = `/api/public/alertes/geste/${encodeURIComponent(jeton)}`;

function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'texte') el.textContent = typo(String(v));
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'aria-label' || k === 'title') el.setAttribute(k, typo(String(v)));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const e of enfants.flat()) if (e !== null && e !== undefined) el.append(e instanceof Node ? e : typo(String(e)));
  return el;
}

const retour = () => h('p', { class: 'bz-t-petit' }, h('a', { class: 'bz-lien bz-lien-fleche', href: '/', texte: 'Ouvrir Living Business' }));

/** Ce que l'alerte disait, repris mot pour mot : la personne sait sur quoi elle agit. */
const rappel = (quoi) => (quoi ? h('p', { class: 'bz-carte__texte bz-texte-2', texte: quoi }) : null);

function montrer({ titre, texte, quoi, ton = 'info', bouton = null, action = null }) {
  // `replaceChildren` écrirait « null » tel quel : ce qui n'existe pas est retiré avant d'être posé dans la page
  racine.replaceChildren(...[
    h('p', { class: 'bz-carte__surtitre', texte: 'Living Business' }),
    h('h1', { class: 'bz-carte__titre bz-t-titre-3', texte: titre }),
    rappel(quoi),
    h('p', { class: 'bz-carte__texte', texte }),
    bouton ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: action }, icone(ton === 'ok' ? 'check' : 'clock', { taille: 'sm' }), bouton)) : null,
    retour(),
  ].filter((e) => e !== null));
}

function panne(message) {
  montrer({ titre: 'Living Business n’a pas répondu', texte: message, ton: 'info' });
}

async function charger() {
  let a;
  try {
    const r = await fetch(adresse, { headers: { accept: 'application/json' } });
    a = await r.json();
    if (!r.ok) throw new Error(a.message ?? 'Réessayez dans un instant.');
  } catch (e) {
    return panne(e.message);
  }
  if (!a.trouve || a.deja) return montrer({ titre: a.titre, texte: a.texte, quoi: a.quoi });
  montrer({
    titre: a.titre, texte: a.texte, quoi: a.quoi,
    ton: a.geste === 'fait' ? 'ok' : 'info',
    bouton: a.geste === 'fait' ? 'Oui, c’est fait' : 'Oui, plus tard',
    action: (ev) => agir(ev.currentTarget),
  });
}

async function agir(bouton) {
  bouton.disabled = true;
  bouton.setAttribute('aria-busy', 'true');
  try {
    const r = await fetch(adresse, { method: 'POST', headers: { 'content-type': 'application/json', 'x-lb-requete': '1' }, body: '{}' });
    const g = await r.json();
    if (!r.ok) throw new Error(g.message ?? 'Réessayez dans un instant.');
    montrer({ titre: g.titre, texte: g.texte, quoi: g.quoi });
  } catch (e) {
    bouton.disabled = false;
    bouton.removeAttribute('aria-busy');
    racine.prepend(h('p', { class: 'bz-resultat', 'data-ton': 'critique', role: 'alert', texte: e.message }));
  }
}

charger();
