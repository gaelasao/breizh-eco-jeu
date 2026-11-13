// Formulaire public de satisfaction (client) ou baromètre (collaborateur). Aucune session : le jeton est dans l'adresse.
// Typographie française (Breizhcosystem) appliquée aux textes et aux attributs lus par les lecteurs d'écran.
import { typo } from '/bz/typo.js';
import { icone } from '/bz/icone.js';
const jeton = location.pathname.split('/').pop() ?? '';
const racine = document.getElementById('formulaire');

function h(tag, attrs = {}, ...enfants) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'texte') el.textContent = typo(String(v));
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'aria-label' || k === 'title' || k === 'placeholder' || k === 'alt') el.setAttribute(k, typo(String(v)));
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const e of enfants.flat()) if (e !== null && e !== undefined) el.append(e instanceof Node ? e : typo(String(e)));
  return el;
}

function message(titre, texte, ok = false) {
  racine.replaceChildren(h('div', { class: 'merci' }, ok ? h('div', { class: 'rond' }, icone('check', { taille: 'lg' })) : null, h('h1', { texte: titre }), h('p', { class: 'intro', texte })));
}

async function charger() {
  let f;
  try {
    const r = await fetch(`/api/public/formulaire/${encodeURIComponent(jeton)}`, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(r.status === 429 ? 'Trop de tentatives, réessayez dans quelques minutes.' : 'Ce lien n’est pas valide.');
    f = await r.json();
  } catch (e) {
    return message('Lien invalide', e.message);
  }
  document.title = typo(`${f.organisation} — votre avis`);
  if (f.dejaRepondu) return message('Merci !', 'Votre réponse a bien été enregistrée.', true);
  if (f.expire) return message('Lien expiré', 'Ce formulaire n’est plus disponible. Contactez l’entreprise si vous souhaitez donner votre avis.');
  const client = f.genre === 'client';
  const form = h('form', { onsubmit: envoyer, novalidate: true },
    f.questions.map((q) => q.type === 'echelle'
      ? h('fieldset', {}, h('legend', { texte: q.libelle + (q.obligatoire ? ' *' : '') }),
          h('div', { class: 'echelle' }, Array.from({ length: q.max - q.min + 1 }, (_, i) => h('label', {}, h('input', { type: 'radio', name: q.id, value: String(q.min + i), required: q.obligatoire, 'aria-label': `${q.min + i} sur ${q.max}` }), h('span', { texte: String(q.min + i) })))),
          h('div', { class: 'bornes' }, h('span', { texte: client ? 'Pas du tout' : 'Très mal' }), h('span', { texte: client ? 'Tout à fait' : 'Très bien' })))
      : h('fieldset', {}, h('legend', { texte: q.libelle }), h('textarea', { name: q.id, maxlength: '1500' }))),
    h('button', { type: 'submit', texte: 'Envoyer ma réponse' }));
  const zoneErreur = h('div');
  racine.replaceChildren(
    h('span', { class: 'surtitre', texte: f.organisation }),
    h('h1', { texte: client ? 'Votre avis compte' : 'Baromètre de l’équipe' }),
    h('p', { class: 'intro', texte: client ? 'Une minute pour nous dire comment s’est passée votre expérience.' : `Une minute, et c’est anonyme : ton nom n’est jamais enregistré avec ta réponse, et la direction ne voit que des résultats regroupés d’au moins ${f.anonymat ?? 5}\u00A0réponses.` }),
    client ? noticeClient(f) : noticeBarometre(f),
    zoneErreur, form);

  async function envoyer(ev) {
    ev.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    if (d.note === undefined) {
      zoneErreur.replaceChildren(h('div', { class: 'erreur', texte: 'Choisissez une note de 0 à 10 pour la première question.' }));
      return;
    }
    const bouton = form.querySelector('button');
    bouton.disabled = true;
    try {
      const r = await fetch(`/api/public/formulaire/${encodeURIComponent(jeton)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(d) });
      const corps = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(corps.message ?? 'Envoi impossible, réessayez.');
      message('Merci !', client ? 'Votre avis a bien été transmis. Bonne journée !' : 'C’est envoyé, anonymement. Une seule réponse par lien est comptée. Merci !', true);
    } catch (e) {
      bouton.disabled = false;
      zoneErreur.replaceChildren(h('div', { class: 'erreur', texte: e.message }));
    }
  }
}

/** Durée de conservation choisie par l'entreprise (jours), dite en mois ou en années. */
const DUREES = { 183: '6\u00A0mois', 365: '1\u00A0an', 730: '2\u00A0ans', 1095: '3\u00A0ans' };

/**
 * Information du client (RGPD art. 13) avant qu'il réponde : qui traite, pourquoi, ce qui est gardé et rattaché à sa
 * fiche, qui le voit, combien de temps (durée réglée par l'entreprise), ses droits. Modèle : docs/conformite/.
 */
function noticeClient(f) {
  const ligne = (titre, texte) => h('li', {}, h('strong', { texte: `${titre} : ` }), texte);
  const duree = DUREES[f.conservationJours];
  return h('details', { class: 'notice' },
    h('summary', { texte: 'Vos données : ce que devient votre réponse' }),
    h('ul', {},
      ligne('Responsable', `${f.organisation}, pour connaître votre avis sur son travail et l’améliorer.`),
      ligne('Ce qui est gardé', 'votre note, votre réponse sur la recommandation et votre commentaire s’il y en a un, avec la date, rattachés à votre fiche client.'),
      ligne('Qui le voit', `les personnes de ${f.organisation} qui suivent la relation avec ses clients. Il peut être repris dans ses outils de suivi des clients.`),
      ligne('Où', `dans le logiciel de gestion de ${f.organisation}, sur son ordinateur ou son serveur : l’éditeur du logiciel n’y a pas accès.`),
      ligne('Combien de temps', duree ? `${duree}, puis effacement automatique.` : `la durée fixée par ${f.organisation} : vous pouvez lui demander d’effacer votre avis à tout moment.`),
      ligne('Facultatif', 'vous pouvez ne pas répondre. Dans le commentaire, n’écrivez ni information sur votre santé ni donnée bancaire.'),
      ligne('Vos droits', `accès, rectification, effacement et opposition, auprès de ${f.organisation}. Vous pouvez aussi adresser une réclamation à la CNIL (cnil.fr).`)));
}

/** Information des salariés (RGPD art. 13) : qui traite, pourquoi, ce qui est gardé, qui voit quoi, combien de temps. */
function noticeBarometre(f) {
  const seuil = f.anonymat ?? 5;
  const ligne = (titre, texte) => h('li', {}, h('strong', { texte: `${titre} : ` }), texte);
  return h('details', { class: 'notice' },
    h('summary', { texte: 'Qui voit quoi ? (tes données)' }),
    h('ul', {},
      ligne('Responsable', `${f.organisation}, ton employeur, pour mesurer le climat de l’équipe et la charge de travail.`),
      ligne('Ce qui est gardé', 'ta note, ta charge de travail, ton commentaire s’il y en a un, ton service et le mois. Jamais ton nom, ni l’heure, ni le lien qui t’a été envoyé.'),
      ligne('Qui voit quoi', `la direction ne voit que des moyennes regroupées par lots d’au moins ${seuil}\u00A0réponses (toute l’équipe, ou un service), datées au mois ; les commentaires seulement à partir de ${f.commentairesMin ?? 10}\u00A0réponses. Le lien ne dit à personne si tu as répondu.`),
      ligne('Limite à connaître', 'c’est ta direction qui crée ce lien et te le transmet (un seul par personne et par mois). Le logiciel ne lui montre ni qui a répondu ni ta réponse ; il ne peut pas empêcher quelqu’un qui détient un lien de répondre à la place de son destinataire. Garde ce lien pour toi.'),
      ligne('Où', `sur le serveur de ${f.organisation} seulement : rien n’est envoyé à l’éditeur du logiciel.`),
      ligne('Combien de temps', `${f.conservationMois ?? 13}\u00A0mois, puis effacement automatique.`),
      ligne('Facultatif', 'tu peux ne pas répondre, sans aucune conséquence. Dans le commentaire, n’écris rien qui permette de te reconnaître ou de reconnaître un collègue.'),
      ligne('Tes droits', `comme ta réponse n’est jamais reliée à ton nom, elle ne peut pas être retrouvée ensuite pour te la montrer ou l’effacer. Pour toute question : ${f.organisation}. Tu peux aussi adresser une réclamation à la CNIL.`)));
}

charger();
