/* Living Business par Breizhcosystem — client web (sans build ; dépendances servies par la passerelle : three.js pour la
   maquette, et le système de design Breizhcosystem dans /bz/).
   Sécurité : aucune donnée insérée en HTML (textContent uniquement), aucun secret côté navigateur,
   toutes les décisions de droits sont prises par la passerelle. */
import { MARQUE } from '/bz/marque.js';
import { typo, pluriel, accord, nombre, dateRelative, euros, casseTitre } from '/bz/typo.js';
import { annoncer, confirmer as confirmerDialogue, demander, fenetre, ouvrir as ouvrirDialogue, preparer as preparerDialogue } from '/bz/dialogue.js';
import { toast } from '/bz/toasts.js';
import { raccourci, raccourcisParGroupe, formater } from '/bz/raccourcis.js';
import { annulerDerniere, retablirDerniere, actionAnnulable, noter } from '/bz/annuler.js';
import { ouvrirPalette, fermerPalette, paletteOuverte, sourcePalette } from '/bz/palette.js';
import { icone } from '/bz/icone.js';
import { comboFiltrable } from '/bz/combobox.js';
import { cadreOnglets } from '/bz/onglets.js';
import { cacher, estOuvert, montrer, popoverOuvert, POPOVER_NATIF } from '/bz/popover.js';
import { masquerInfobulle } from '/bz/infobulle.js';
import { ouvrirActivite } from '/bz/activite.js';
import { courriersUrgents, destinations, estCourante, groupesNavigation, ongletsTelephone, piedNavigation, placeDeVue, prenomDe, tachesOuvertes, texteCompteur, titreDeVue } from '/navigation.js';
import { GESTES, TITRES_GESTES } from '/carte/gestes.js';
import { QUALITES, reseauFaible } from '/carte/qualite.js';
import { REGLAGES_HEURE } from '/carte/heure.js';
import { categorieDe, LIBELLES_CATEGORIE, peintureDe, quartierDe } from '/carte/categories.js';
import { ACTIONS_PANNEAU, ICONE_TON, RAYON_ANNEAU, RAYON_COUVERTURE, anneauSante, cheminArc, jourLocal, lendemain, lisible, planAujourdhui, premiersPas, reportsValides, tuilesARegler } from '/aujourdhui.js';
import * as JEU from '/jeu.js';
import { texteCsv } from '/csv.js';
import * as REG from '/reglages.js';
import * as RESEAU from '/reseau.js';
import * as SIMPLE from '/simplicite.js';

// Logiciel libre (GNU AGPL version 3) : où trouver le code source de cette version (article 13 de la licence), offert à
// toute personne qui utilise le jeu : écrans d'entrée, Aide, Réglages › À propos, palette, « Licences et crédits ».
// Même adresse dans src/passerelle/licence.ts et web/licences.html ; une version modifiée y met celle de SON code source.
const CODE_SOURCE = 'https://github.com/gaelasao/breizh-eco-jeu';
const LIBELLE_CODE_SOURCE = 'Code source (AGPL v3)';
const ouvrirCodeSource = () => window.open(CODE_SOURCE, '_blank', 'noopener,noreferrer');

// ---------------------------------------------------------------- outils
const $ = (sel) => document.querySelector(sel);

/* h() : typographie française automatique (direction de design §4.0, §8.3) sur les textes et sur aria-label, title,
   placeholder et alt — sauf dans code, pre, kbd, samp, textarea (valeur saisie) et si data-brut est présent.
   Clé « cle » : posée en data-cle, elle permet à remplir() de rendre le focus au même élément après un rendu. */
const SANS_TYPO = new Set(['CODE', 'PRE', 'KBD', 'SAMP', 'TEXTAREA', 'SCRIPT', 'STYLE']);
const ATTRIBUTS_TYPO = new Set(['aria-label', 'title', 'placeholder', 'alt']);
function h(tag, props = {}, ...enfants) {
  const el = document.createElement(tag);
  const brutAttributs = props?.['data-brut'] !== undefined && props['data-brut'] !== false;
  const brut = SANS_TYPO.has(el.tagName) || brutAttributs || Boolean(props?.contenteditable);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (k.startsWith('aria-') && typeof v === 'boolean') { el.setAttribute(k, String(v)); continue; }
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'cle') el.dataset.cle = String(v);
    else if (k === 'texte') el.textContent = brut ? String(v) : typo(String(v));
    else if (k === 'style') el.style.cssText = v; // CSSOM : compatible CSP sans 'unsafe-inline'
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (ATTRIBUTS_TYPO.has(k) && !brutAttributs) el.setAttribute(k, typo(String(v))); // même sur <textarea> (texte indicatif)
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const e of enfants.flat(Infinity)) {
    if (e === null || e === undefined || e === false) continue;
    el.append(e instanceof Node ? e : document.createTextNode(brut ? String(e) : typo(String(e))));
  }
  return el;
}

/* remplir() : remplace le contenu sans perdre le focus. L'élément qui avait le focus (data-cle, id, ou à défaut même
   balise, même nom et même rang) le retrouve après le rendu, avec sa sélection de texte. Un rendu ne déplace jamais
   le focus de lui-même. */
const signature = (n) => `${n.tagName}|${n.getAttribute('name') ?? ''}|${n.getAttribute('aria-label') ?? ''}|${n.getAttribute('type') ?? ''}|${(n.textContent ?? '').trim().slice(0, 60)}`;
function reperer(el, actif) {
  if (actif.dataset?.cle) return { selecteur: `[data-cle="${CSS.escape(actif.dataset.cle)}"]` };
  if (actif.id) return { selecteur: `#${CSS.escape(actif.id)}` };
  const sig = signature(actif);
  const memes = [...el.querySelectorAll(actif.tagName)].filter((n) => signature(n) === sig);
  return { sig, tag: actif.tagName, rang: memes.indexOf(actif) };
}
function retrouver(el, r) {
  if (r.selecteur) return el.querySelector(r.selecteur);
  const memes = [...el.querySelectorAll(r.tag)].filter((n) => signature(n) === r.sig);
  return memes[r.rang] ?? (memes.length === 1 ? memes[0] : null);
}
function remplir(el, ...enfants) {
  if (!el) return;
  const actif = document.activeElement;
  let r = null;
  let sel = null;
  if (actif && actif !== document.body && actif !== el && el.contains(actif)) {
    r = reperer(el, actif);
    try { if (typeof actif.selectionStart === 'number') sel = [actif.selectionStart, actif.selectionEnd, actif.selectionDirection ?? 'none']; } catch { /* pas de sélection */ }
  }
  el.replaceChildren(...enfants.flat(Infinity).filter((e) => e !== null && e !== undefined && e !== false));
  if (r && !el.contains(document.activeElement)) {
    const n = retrouver(el, r);
    if (n && typeof n.focus === 'function') {
      n.focus({ preventScroll: true });
      if (sel && typeof n.setSelectionRange === 'function') { try { n.setSelectionRange(...sel); } catch { /* type sans sélection */ } }
    }
  }
}

async function api(methode, chemin, corps, entetes = {}) {
  const ecriture = methode !== 'GET';
  const r = await fetch(`/api/v1${chemin}`, {
    method: methode,
    credentials: 'same-origin',
    headers: { ...(ecriture ? { 'content-type': 'application/json', 'x-lb-requete': '1' } : {}), ...entetes },
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && d.erreur === 'non_authentifie') { await demarrer(); throw Object.assign(new Error('Session expirée : reconnectez-vous.'), { session: true }); }
  // administrateur d'un jeu en ligne : la validation en deux étapes passe avant tout le reste
  if (r.status === 403 && d.erreur === 'deux_etapes_requise') { await demarrer(); throw Object.assign(new Error(d.message), { session: true }); }
  if (!r.ok) throw Object.assign(new Error(d.message && d.message !== d.erreur ? d.message : messageErreur(d.erreur, r.status)), { statut: r.status, code: d.erreur ?? null });
  return d;
}
function messageErreur(code, statut) {
  return {
    introuvable: 'Objet introuvable ou hors de votre périmètre.',
    interdit: 'Votre rôle ne permet pas cette action.',
    conflit_idempotence: 'Cette demande a déjà été envoyée avec d’autres valeurs.',
    csrf: 'Requête refusée (protection anti-falsification).',
    deja_importe: 'Ce fichier a déjà été importé.',
  }[code] ?? `Erreur ${statut}${code ? ` (${code})` : ''}`;
}

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });
const nfEuro = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
/* Dates du texte (§8.3) : « 7 nov. », « 1er déc. 2025 » (l'année seulement si ce n'est pas l'année en cours), et
   « 10 nov. 2026 à 23 h 47 » ; jamais « 07/11/2026 » ni « 23:47 » dans une phrase ou un popover. */
const MOIS_COURT = new Intl.DateTimeFormat('fr-FR', { month: 'short' });
const date = (iso, { annee = null } = {}) => {
  if (!iso) return '—';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '—';
  const j = d.getDate();
  const avecAn = annee ?? d.getFullYear() !== new Date().getFullYear();
  return `${j === 1 ? '1er' : j}\u00A0${MOIS_COURT.format(d)}${avecAn ? `\u00A0${d.getFullYear()}` : ''}`;
};
const dateHeure = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${date(iso.length > 10 ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : iso, { annee: true })} à ${d.getHours()}\u00A0h\u00A0${String(d.getMinutes()).padStart(2, '0')}`;
};
const cle = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
const petitEcran = () => matchMedia('(max-width: 47.49em)').matches;
/** Préférences de CET appareil (jamais de données de l'entreprise) ; navigation privée : sans effet. */
const lireLocal = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
/** Nom d'entreprise saisi à l'installation quand on est parti de l'exemple (prérempli plus tard, voir corpsZero). */
const NOM_SOUHAITE = 'lb-entreprise-souhaitee';
const ecrireLocal = (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } };
/** « Ouvrir sur » (Réglages › Apparence) : la carte avec « Aujourd'hui » posé dessus, ou « Aujourd'hui » en liste. */
const ouvrirSurListe = () => lireLocal('lb-ouvrir-sur') === 'liste';
const vueAujourdhui = () => (E.sceneEchec || ouvrirSurListe() ? 'matin' : 'carte');
/** Vue demandée par l'adresse (#/planning, #/role:client…) ; rien si elle n'a pas la forme d'une vue. */
const VUE_VALIDE = /^(carte|tableau|pipeline|matin|sante|departements|planning|courrier|reglages|compte|accueil|satisfaction|optimiser|nexus|progression)$|^(dep|role|famille|type|reglages):[\w-]+$/;
/** Dans la barre d'adresse, l'écran du réseau s'appelle « reseau » (#/reseau, #/reglages:reseau) ; la clé interne de la
    vue reste « nexus », et les anciennes adresses (#/nexus) sont toujours comprises. */
const adresseDepuisVue = (v) => (v === 'nexus' ? 'reseau' : v === 'reglages:nexus' ? 'reglages:reseau' : v);
const vueDepuisNomAdresse = (v) => (v === 'reseau' ? 'nexus' : v === 'reglages:reseau' ? 'reglages:nexus' : v);
function vueDepuisAdresse() {
  let v = '';
  try { v = vueDepuisNomAdresse(decodeURIComponent(location.hash.replace(/^#\/?/, ''))); } catch { return null; }
  return VUE_VALIDE.test(v) ? v : null;
}
function lireReports() {
  try { return reportsValides(JSON.parse(lireLocal('lb-plus-tard') ?? '{}') ?? {}, jourLocal()); } catch { return {}; }
}

/* Lien d'installation d'un jeu en ligne (https://…/installation#<code>) : le code est lu dans le fragment (jamais
   envoyé au serveur dans l'adresse ni gardé dans l'historique), puis retiré tout de suite de la barre d'adresse. */
let CODE_INSTALLATION = null;
if (location.pathname === '/installation') {
  const m = /^#([A-Za-z0-9_-]{43})$/.exec(location.hash);
  if (m) CODE_INSTALLATION = m[1];
  if (location.hash) history.replaceState(null, '', '/installation');
}
const sansDemo = (nom) => nom.replace(/\s*\((?:entreprise )?(fictifs?|fictives?|démo)\)/gi, '');

const LIBELLES = {
  provenance: { confirme: 'Confirmé', declare: 'Déclaré', calcule: 'Calculé', infere: 'Inféré', inconnu: 'Inconnu' },
  fraicheur: { fraiche: 'À jour', perimee: 'Donnée périmée', inconnue: 'Âge inconnu' },
  mode: { demo: 'Fictif (démo)', reel: 'Vos données', simulation: 'Simulation' },
  gravite: { critique: 'Critique', attention: 'Attention', info: 'Information' },
  statut: { ouverte: 'Ouverte', a_verifier: 'À vérifier', resolue: 'Résolue' },
  etat: {
    brouillon: 'Brouillon', en_attente: 'En attente d’approbation', approuvee: 'Approuvée', en_cours: 'En cours',
    reussie_technique: 'Enregistrée', echouee: 'Échouée', resultat_inconnu: 'Résultat inconnu — à vérifier', resultat_metier_confirme: 'Résultat confirmé',
  },
};
const niveau = (s) => (s.statut === 'a_verifier' ? 'a_verifier' : s.gravite);
const rang = { critique: 0, attention: 1, info: 2, a_verifier: 2 };
const trierSituations = (l) => [...l].sort((a, b) => rang[niveau(a)] - rang[niveau(b)]);

// ---------------------------------------------------------------- état
const E = {
  session: null,
  connexion: null,
  apercu: false,
  profilsDemo: [],
  monde: null,
  vue: 'carte',
  selection: null,
  fiche: null,
  formulaire: null,
  scene: null,
  sceneEchec: null,
  recherche: '',
  message: null,
  assistant: null,
  calquesOuverts: false,
  matinReduit: lireLocal('lb-panneau-aujourdhui') === 'replie',
  bandeauDemo: true,
  vueCarte: null,
  filtreDep: 'tous',
  palette: null,
  visite: null,
  flux: null,
  direct: false,
  majEnAttente: false,
  accueil: null,
  sousReglages: null,       // page de Réglages ouverte (null : la liste des sections sur téléphone)
  sources: null,
  dernieres: {},            // dernière vue visitée de chaque groupe (onglets du téléphone)
  railReplie: lireLocal('lb-rail') === 'replie',
  reports: lireReports(),   // « Plus tard » : actions renvoyées au lendemain, sur cet appareil
  cranFeuille: 'mi',        // feuille de la carte sur téléphone : poignee, mi (40 %), plein (90 %)
  replisOuverts: new Set(), // sections repliées d'« Aujourd'hui » que la personne a ouvertes (gardées au rendu)
  ongletFeuille: 'aujourdhui',
  hudMasque: false,         // « Masquer l'interface » (H) : la carte seule
  boussole: false,          // la boussole n'apparaît qu'après une rotation (§5.5)
  miniCarte: lireLocal('lb-minicarte') !== 'repliee',
  charger3D: false,         // réseau faible : la 3D ne se charge que sur demande (§5.10)
  simplicite: { tout: false, vues: null }, // choix de la personne : « Tout afficher », notes déjà lues (web/simplicite.js)
  simpliciteDe: null,       // profil dont les choix sont chargés
  deblocages: {},           // rubriques débloquées par ce que l'entreprise a déjà
  deblocagesReels: null,    // les mêmes, hors exemple et hors simulation : pour annoncer ce qui vient d'apparaître
};
{
  const v = vueDepuisAdresse();
  if (v?.startsWith('reglages:')) { E.sousReglages = v.slice(9); E.vue = 'reglages'; } else if (v) E.vue = v; else if (ouvrirSurListe()) E.vue = 'matin';
}
const estVueListe = (v) => /^(role|famille|type):/.test(v);

// ---------------------------------------------------------------- démarrage : installation, connexion, puis directement la carte
async function demarrer() {
  const s = await api('GET', '/session');
  E.connexion = s;
  E.profilsDemo = s.profilsDemo;
  const mi = /^\/invitation\/([A-Za-z0-9_-]{43})$/.exec(location.pathname);
  const ms = /^\/secours\/([A-Za-z0-9_-]{43})$/.exec(location.pathname);
  if (mi) return rendreInvitation(mi[1]);
  if (ms) return rendreSecoursLocal(ms[1]);
  if (location.pathname === '/installation' && s.installe) history.replaceState(null, '', '/');
  if (s.connexion === 'comptes') {
    if (!s.installe) return rendreInstallation(s);
    if (s.attenteCode) { fermerTempsReel(); return rendreConnexion(s, null, true); }
    if (!s.profil) { fermerTempsReel(); return rendreConnexion(s); }
    if (s.deuxEtapesRequise) { fermerTempsReel(); return rendreDeuxEtapesObligatoire(s); }
  }
  E.session = s.profil ?? (await api('POST', '/session', { profilId: 'dirigeante' })).profil;
  E.apercu = Boolean(s.apercu);
  await rendreApplication();
  ecouterTempsReel();
  etapeDemandee();
  if (E.premiereArrivee) {
    // première arrivée (§2.6) : « Degemer mat » (bienvenue), une seule fois
    E.premiereArrivee = false;
    const prenom = prenomDe(E.session?.nom ?? '');
    informer(`Degemer mat${prenom ? `, ${prenom}` : ''}. Votre port est prêt. Commençons par vos clients.`, 'ok');
  }
}

async function voirComme(profilId) {
  const avant = E.apercu;
  if (E.connexion?.connexion === 'comptes') {
    const r = await api('POST', '/session/apercu', { profilId });
    E.session = r.profil;
    E.apercu = r.apercu;
  } else {
    E.session = (await api('POST', '/session', { profilId })).profil;
  }
  // l'aperçu s'ouvre sur la carte (ce que la personne voit) ; en sortant, retour à la page des accès
  if (E.apercu || (!E.session.peutAdministrer && ['reglages', 'accueil'].includes(E.vue))) E.vue = vueAujourdhui();
  else if (avant && !E.apercu) { E.vue = 'reglages'; E.sousReglages = 'acces'; }
  E.selection = null;
  E.fiche = null;
  await charger();
  informer(E.apercu ? `Aperçu : vous voyez le monde comme ${E.session.nom} (lecture seule).` : `Vous voyez maintenant le monde comme : ${E.session.nom}.`, 'ok');
}

async function seDeconnecter() {
  await api('DELETE', '/session').catch(() => undefined);
  try { sessionStorage.setItem('lb-kenavo', '1'); } catch { /* stockage indisponible : pas de « Kenavo » */ }
  fermerTempsReel();
  E.scene?.detruire();
  E.scene = null;
  location.href = '/';
}

// ---------------------------------------------------------------- entrée : installation, connexion, invitation, secours
/* Écrans d'entrée (§6.1 P5, §2.3) : symbole Moucheture et « Living Business par Breizhcosystem », titre en Fraunces,
   formulaire au centre ; panneau de marque avec l'illustration du port (tirée de la maquette, §2.5) et les 3 promesses
   complètes, à gauche sur ordinateur et sous le formulaire sur téléphone. web/entree.js (module pur) fournit les
   promesses, les choix de départ et l'indicateur de robustesse du mot de passe. */
let ENTREE = null;
const chargerEntree = async () => (ENTREE ??= await import('/entree.js'));

function marqueProduit() {
  return h('div', { class: 'bz-marque-produit' },
    h('img', { src: '/symbole-living-business.svg', alt: '', width: '28', height: '28' }),
    h('span', { class: 'bz-marque-produit__nom' }, h('strong', { texte: MARQUE.jeu }), h('small', { texte: `par ${MARQUE.mere}` })));
}
/** Illustration de marque (le port à l'aube, la nuit en thème sombre) : AVIF, repli WebP ; ne porte aucune information. */
const nomIllustration = () => (document.documentElement.getAttribute('data-theme') === 'sombre' ? 'port-nuit' : 'port-aube');
function illustrationPort() {
  const n = nomIllustration();
  return h('picture', { 'data-illustration': '' },
    h('source', { type: 'image/avif', srcset: `/illustrations/${n}.avif` }),
    h('img', { class: 'bz-entree__illustration', src: `/illustrations/${n}.webp`, alt: '', width: '960', height: '600', decoding: 'async' }));
}
// thème forcé (Réglages) ou changé par le système : l'illustration suit
new MutationObserver(() => {
  const n = nomIllustration();
  for (const p of document.querySelectorAll('picture[data-illustration]')) {
    const s = p.querySelector('source');
    const i = p.querySelector('img');
    if (s && s.getAttribute('srcset') !== `/illustrations/${n}.avif`) s.setAttribute('srcset', `/illustrations/${n}.avif`);
    if (i && i.getAttribute('src') !== `/illustrations/${n}.webp`) i.setAttribute('src', `/illustrations/${n}.webp`);
  }
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

function ecranEntree(titre, surtitre, ...contenu) {
  E.scene?.detruire();
  E.scene = null;
  E.monde = null;
  document.documentElement.removeAttribute('data-coque');
  // titre de l'onglet : nom de l'écran et endossement (« Installation · Living Business par Breizhcosystem », §6.4)
  document.title = typo(`${titre} · ${MARQUE.endossement(MARQUE.jeu)}`);
  const promesses = ENTREE?.promesses({ enLigne: Boolean(E.connexion?.enLigne) }) ?? [];
  remplir($('#app'), h('div', { class: 'bz-entree' },
    h('header', { class: 'bz-entree__tete' }, marqueProduit()),
    h('main', { class: 'bz-entree__formulaire', id: 'contenu', tabindex: '-1', 'aria-labelledby': 'titre-entree' },
      h('div', { class: 'bz-entree__titres' },
        surtitre ? h('p', { class: 'bz-t-surtitre', texte: surtitre }) : null,
        h('h1', { class: 'bz-t-titre-1', id: 'titre-entree', tabindex: '-1', texte: titre })),
      ...contenu),
    h('aside', { class: 'bz-entree__marque', 'aria-label': MARQUE.endossement(MARQUE.jeu) },
      marqueProduit(),
      illustrationPort(),
      h('ul', { class: 'bz-promesses', role: 'list' }, promesses.map((p) => h('li', {}, icone(p.icone), h('strong', { texte: p.titre }), h('span', { texte: p.texte })))),
      h('p', { class: 'bz-entree__pied' }, `${MARQUE.endossement(MARQUE.jeu)} · logiciel libre et gratuit, installé chez vous · `,
        h('a', { href: '/licence.html', target: '_blank', rel: 'noopener', texte: 'Licence' }), ' · ',
        h('a', { href: CODE_SOURCE, target: '_blank', rel: 'noopener noreferrer', texte: LIBELLE_CODE_SOURCE }), ' · ',
        h('a', { href: '/licences.html', target: '_blank', rel: 'noopener', texte: 'Licences et crédits' })))));
  const resume = document.querySelector('#resume-erreurs');
  if (resume) { resume.focus(); return; }
  const champs = [...document.querySelectorAll('.bz-entree__formulaire input:not([hidden]):not([type=file]):not([type=radio]):not([type=checkbox]):not([readonly]):not(.bz-visuellement-cache)')];
  const champ = champs.find((i) => !i.value) ?? champs[0];
  // jamais de focus perdu : le premier champ, sinon le titre de l'écran (§4.14) ; l'écran s'ouvre en haut, marque
  // visible (le focus ne fait pas défiler la page jusqu'au champ)
  if (champ) champ.focus({ preventScroll: true }); else document.getElementById('titre-entree')?.focus({ preventScroll: true });
  if (document.scrollingElement) document.scrollingElement.scrollTop = 0;
}

const memeMdp = (S, a = 'motDePasse', b = 'confirmation') => (S[a] === S[b] ? null : 'Les deux mots de passe ne sont pas identiques.');

/** Champ des écrans d'entrée (§4.6) : libellé → aide → champ → erreur, reliés par aria-describedby. */
function champEntree({ id, libelle, aide = null, erreur = null, valeur = '', oninput, type = 'text', ...attributs }) {
  const decrit = [aide ? `${id}-aide` : null, erreur ? `${id}-erreur` : null].filter(Boolean).join(' ') || null;
  return h('div', { class: 'bz-champ' },
    h('label', { class: 'bz-champ__libelle', for: id, id: `${id}-libelle`, texte: libelle }),
    aide ? h('span', { class: 'bz-champ__aide', id: `${id}-aide`, texte: aide }) : null,
    h('input', { id, class: 'bz-champ__saisie', type, value: valeur, 'aria-describedby': decrit, 'aria-invalid': erreur ? 'true' : null, oninput: (e) => oninput(e.target.value), ...attributs }),
    erreur ? h('p', { class: 'bz-champ__erreur', id: `${id}-erreur` }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: erreur })) : null);
}
/** Mot de passe : bouton « Afficher » dans le champ (aria-pressed), robustesse écrite en texte pour un nouveau mot de passe. */
function champMotDePasse(S, cle, { id, libelle, nouveau = false, identifiant = () => '', erreur = null, autocomplete = null, aide = null, minimum = 10, afficher: libelleAfficher = 'Afficher le mot de passe', ...attributs }) {
  const robuste = (v) => ENTREE?.robustesse(v, identifiant(), minimum) ?? { niveau: 'vide', libelle: '', conseil: '' };
  const r0 = robuste(S[cle] ?? '');
  const decrit = [aide ? `${id}-aide` : null, nouveau ? `${id}-robustesse` : null, erreur ? `${id}-erreur` : null].filter(Boolean).join(' ') || null;
  let dernier = r0.niveau;
  // « Faible : encore 4 caractères au moins. » : après le deux-points, le conseil reprend en minuscule
  const conseil = (r) => (r.libelle && r.conseil ? `${r.conseil.charAt(0).toLocaleLowerCase('fr-FR')}${r.conseil.slice(1)}` : r.conseil);
  const indicateur = nouveau ? h('div', { class: 'bz-pile', 'data-robustesse': '' },
    h('div', { class: 'bz-robustesse', 'data-niveau': r0.niveau, 'aria-hidden': 'true' }, h('span'), h('span'), h('span')),
    h('p', { class: 'bz-robustesse__texte', id: `${id}-robustesse` }, r0.libelle ? h('strong', { texte: `${r0.libelle} :` }) : null, h('span', { texte: conseil(r0) }))) : null;
  const majIndicateur = (v) => {
    if (!indicateur) return;
    const r = robuste(v);
    indicateur.querySelector('.bz-robustesse').setAttribute('data-niveau', r.niveau);
    remplir(indicateur.querySelector('.bz-robustesse__texte'), r.libelle ? h('strong', { texte: `${r.libelle} :` }) : null, h('span', { texte: conseil(r) }));
    if (r.niveau !== dernier && r.libelle) { clearTimeout(majIndicateur.t); majIndicateur.t = setTimeout(() => annoncer(`Mot de passe ${r.libelle.toLowerCase()}`), 700); }
    dernier = r.niveau;
  };
  const saisie = h('input', { id, class: 'bz-champ__saisie', type: 'password', maxlength: '200', autocomplete: autocomplete ?? (nouveau ? 'new-password' : 'current-password'), spellcheck: 'false', autocapitalize: 'none',
    value: S[cle] ?? '', 'aria-describedby': decrit, 'aria-invalid': erreur ? 'true' : null, oninput: (e) => { S[cle] = e.target.value; majIndicateur(e.target.value); }, ...attributs });
  const afficher = h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', 'aria-pressed': 'false', 'aria-label': libelleAfficher, 'data-infobulle': libelleAfficher, 'aria-controls': id,
    onclick: (e) => { const b = e.currentTarget; const voir = saisie.type === 'password'; saisie.type = voir ? 'text' : 'password'; b.setAttribute('aria-pressed', String(voir)); b.replaceChildren(icone(voir ? 'eye-off' : 'eye')); } }, icone('eye'));
  return h('div', { class: 'bz-champ' },
    h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }),
    aide ? h('span', { class: 'bz-champ__aide', id: `${id}-aide`, texte: aide }) : null,
    h('div', { class: 'bz-mdp' }, saisie, afficher),
    indicateur,
    erreur ? h('p', { class: 'bz-champ__erreur', id: `${id}-erreur` }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: erreur })) : null);
}
/** Résumé des erreurs à l'envoi (§4.6) : « 2 points à corriger », liens vers chaque champ ; il reçoit le focus. */
function resumeErreurs(erreurs, { idDe = (k) => `champ-${k}`, id = 'resume-erreurs' } = {}) {
  const cles = Object.keys(erreurs).filter((k) => erreurs[k]);
  if (!cles.length) return null;
  return h('div', { class: 'bz-resultat', 'data-ton': 'critique', role: 'alert', tabindex: '-1', id },
    iconeEtat('critique', { decoratif: true }),
    h('div', {}, h('strong', { texte: cles.length === 1 ? 'Un point à corriger' : pluriel(cles.length, 'point à corriger', 'points à corriger') }),
      h('ul', { class: 'bz-liste-simple' }, cles.map((k) => h('li', {}, h('a', { href: `#${idDe(k)}`, onclick: (e) => { e.preventDefault(); document.getElementById(idDe(k))?.focus(); }, texte: erreurs[k] }))))));
}
const encadre = (ton, texte, detail = null) => h('div', { class: 'bz-resultat', 'data-ton': ton, role: ton === 'critique' ? 'alert' : null },
  iconeEtat(ton, { decoratif: true }), h('div', {}, h('strong', { texte }), detail ? h('span', { texte: detail }) : null));
const boutonEntree = (libelle, { type = 'submit', principal = true, occupe = false, enCours = libelle, icone: ic = null, onclick = null, desactive = false } = {}) =>
  h('button', { type, class: `bz-bouton ${principal ? 'bz-bouton--principal' : 'bz-bouton--secondaire'} bz-bouton--lg`, 'aria-busy': occupe ? 'true' : null, 'aria-disabled': desactive ? 'true' : null,
    onclick: (e) => { if (occupe || desactive) { e.preventDefault(); return; } onclick?.(e); } },
  occupe ? icone('loader-circle') : ic && !principal ? icone(ic) : null, occupe ? enCours : libelle, ic && principal && !occupe ? icone(ic) : null);
const tempsInstallation = (temps) => {
  const i = ENTREE.TEMPS_INSTALLATION.findIndex(([k]) => k === temps);
  return h('div', { class: 'bz-temps' }, h('progress', { class: 'bz-assistant__barre', max: String(ENTREE.TEMPS_INSTALLATION.length), value: String(i + 1), 'aria-hidden': 'true' }),
    h('span', { texte: `Étape ${i + 1} sur ${ENTREE.TEMPS_INSTALLATION.length} · ${ENTREE.TEMPS_INSTALLATION[i][1]}` }));
};

async function rendreInstallation(s) {
  await chargerEntree();
  const S = { temps: 'vous', mode: 'installer', nom: '', entreprise: '', identifiant: '', motDePasse: '', confirmation: '', depart: s.existant?.reels ? 'garder' : 'vide', exemple: 'pme', erreurs: {}, erreur: null, envoi: false };
  const R = { fichier: null, registre: null, phrase: '', erreur: null, envoi: false };
  // en ligne : le lien d'installation (code à usage unique du serveur) est vérifié avant d'afficher le formulaire
  let lienInvalide = null;
  if (!s.surPlace && s.installationADistance && CODE_INSTALLATION) {
    try { await api('POST', '/installation/verifier', {}, { 'x-lb-installation': CODE_INSTALLATION }); } catch (e) { CODE_INSTALLATION = null; lienInvalide = e.message; }
  }
  const peut = s.surPlace || (s.installationADistance && CODE_INSTALLATION !== null);
  const code = () => (CODE_INSTALLATION && !s.surPlace ? { 'x-lb-installation': CODE_INSTALLATION } : {});
  const departs = ENTREE.departs(s.existant);
  const libelleEntreprise = () => (S.depart === 'vide' ? 'Nom de l’entreprise' : 'Nom de l’entreprise (facultatif)');
  const continuer = (e) => {
    e.preventDefault();
    S.erreurs = {
      nom: S.nom.trim() ? null : 'Indiquez votre nom.',
      entreprise: S.depart !== 'vide' || S.entreprise.trim() ? null : 'Indiquez le nom de l’entreprise.',
      identifiant: S.identifiant.trim() ? null : 'Choisissez un identifiant : votre e-mail convient très bien.',
    };
    if (Object.values(S.erreurs).some(Boolean)) return rendre();
    S.erreurs = {};
    S.temps = 'securite';
    rendre();
    annoncer('Étape 2 sur 2 · Sécurité');
  };
  const envoyer = async (e) => {
    e.preventDefault();
    const r = ENTREE.robustesse(S.motDePasse, S.identifiant);
    S.erreurs = {
      motDePasse: r.valide ? null : r.conseil,
      confirmation: S.motDePasse === S.confirmation ? null : 'Les deux mots de passe ne sont pas identiques.',
    };
    if (Object.values(S.erreurs).some(Boolean)) return rendre();
    S.erreurs = {};
    S.envoi = true;
    S.erreur = null;
    rendre();
    try {
      const res = await api('POST', '/installation', { nom: S.nom, entreprise: S.entreprise, identifiant: S.identifiant, motDePasse: S.motDePasse, depart: S.depart, exemple: S.exemple }, code());
      // parti de l'exemple : le nom saisi ici n'est pas encore celui de la carte ; on le garde pour le proposer au
      // moment de « Remplacer l'exemple par mon entreprise » (sur cet appareil, comme les autres préférences)
      ecrireLocal(NOM_SOUHAITE, S.depart === 'exemple' ? S.entreprise.trim().slice(0, 120) : '');
      CODE_INSTALLATION = null;
      history.replaceState(null, '', '/');
      // le seul parcours d'accueil est « Premiers pas », posé sur la carte (§4.20)
      rendreCodeSecours(res.codeSecours, async () => { E.vue = vueAujourdhui(); E.premiereArrivee = true; await demarrer(); });
    } catch (err) {
      S.envoi = false;
      // l'erreur du serveur s'affiche sous le champ concerné, jamais seulement dans un message général (3.3.1)
      if (/^Identifiant/.test(err.message)) { S.temps = 'vous'; S.erreurs = { identifiant: err.message }; } else if (/mot de passe/i.test(err.message)) S.erreurs = { motDePasse: err.message }; else S.erreur = err.message;
      rendre();
    }
  };
  const restaurer = async (e) => {
    e.preventDefault();
    if (!R.fichier) { R.erreur = 'Choisissez le fichier de sauvegarde (.lbsauv).'; return rendre(); }
    R.envoi = true;
    R.erreur = null;
    rendre();
    try {
      const fichier = JSON.parse(await R.fichier.text());
      const registre = R.registre ? await R.registre.text() : undefined;
      await api('POST', '/installation/restaurer', { fichier, phrase: R.phrase, registre }, code());
      CODE_INSTALLATION = null;
      location.href = '/';
    } catch (err) { R.envoi = false; R.erreur = err instanceof SyntaxError ? 'Ce fichier n’est pas une sauvegarde Living Business.' : err.message; rendre(); }
  };
  const blocage = lienInvalide ? encadre('critique', lienInvalide)
    : !peut ? encadre('critique', 'L’installation se fait sur l’ordinateur où Living Business est lancé.', s.aideInstallation ?? 'Ouvrez http://127.0.0.1:4173 sur cet ordinateur-là.') : null;
  const formulaireVous = () => h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: continuer },
    champEntree({ id: 'champ-nom', libelle: 'Votre nom', autocomplete: 'name', maxlength: '80', enterkeyhint: 'next', valeur: S.nom, erreur: S.erreurs.nom, oninput: (v) => (S.nom = v) }),
    champEntree({ id: 'champ-entreprise', libelle: libelleEntreprise(), autocomplete: 'organization', maxlength: '120', enterkeyhint: 'next', valeur: S.entreprise, erreur: S.erreurs.entreprise, oninput: (v) => (S.entreprise = v) }),
    champEntree({ id: 'champ-identifiant', libelle: 'Identifiant de connexion', aide: 'Il sert à vous connecter. Votre e-mail convient très bien.', autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', maxlength: '120', enterkeyhint: 'next', valeur: S.identifiant, erreur: S.erreurs.identifiant, oninput: (v) => (S.identifiant = v) }),
    h('fieldset', {}, h('legend', { texte: 'Pour commencer' }),
      h('div', { class: 'bz-grille-choix bz-grille-choix--grand' }, departs.map((d) => h('label', { class: 'bz-choix bz-choix--illustre' },
        h('input', { type: 'radio', name: 'depart', value: d.id, checked: S.depart === d.id, onchange: () => {
          // choisir ne redessine pas l'écran et ne déplace pas le focus (§4.7)
          S.depart = d.id;
          const l = document.getElementById('champ-entreprise-libelle');
          if (l) l.textContent = typo(libelleEntreprise());
          const ex = document.getElementById('bloc-exemple');
          if (ex) ex.hidden = d.id !== 'exemple';
        } }),
        h('span', { class: 'bz-choix__illustration', 'aria-hidden': 'true' }, icone(d.icone)),
        h('span', { class: 'bz-choix__texte' }, h('span', { class: 'bz-choix__titre', texte: d.titre }), h('span', { class: 'bz-choix__detail', texte: d.texte }))))),
      h('div', { class: 'bz-champ', id: 'bloc-exemple', hidden: S.depart !== 'exemple' },
        h('label', { class: 'bz-champ__libelle', for: 'champ-exemple', texte: 'Exemple' }),
        h('div', { class: 'bz-select' }, h('select', { id: 'champ-exemple', onchange: (e) => (S.exemple = e.target.value) },
          [['pme', 'Petite entreprise (d’un seul tenant)'], ['eti', 'Entreprise organisée en départements']].map(([k, l]) => h('option', { value: k, selected: S.exemple === k, texte: l }))), icone('chevron-down')))),
    h('div', { class: 'bz-groupe-boutons' }, boutonEntree('Continuer', { icone: 'arrow-right', desactive: !peut })));
  const formulaireSecurite = () => h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: envoyer },
    h('input', { type: 'text', class: 'bz-visuellement-cache', autocomplete: 'username', value: S.identifiant, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }),
    h('p', { texte: s.enLigne
      ? 'Votre mot de passe protège l’accès à votre entreprise. Juste après, vous activerez la validation en deux étapes, obligatoire pour les administrateurs en ligne.'
      : 'Votre mot de passe protège l’accès à votre entreprise. Vous seul le connaissez : personne, pas même l’éditeur, ne peut le retrouver.' }),
    champMotDePasse(S, 'motDePasse', { id: 'champ-motDePasse', libelle: 'Mot de passe', nouveau: true, identifiant: () => S.identifiant, erreur: S.erreurs.motDePasse }),
    champMotDePasse(S, 'confirmation', { id: 'champ-confirmation', libelle: 'Confirmez le mot de passe', autocomplete: 'new-password', erreur: S.erreurs.confirmation }),
    // logiciel libre (GNU AGPL version 3) : une information, pas une acceptation — utiliser le logiciel n'en demande
    // aucune (article 9 de la licence) ; rien n'est enregistré à ce sujet, ni ici ni sur le serveur
    h('p', { class: 'bz-t-petit bz-texte-2', id: 'mention-licence' }, 'Living Business est un ',
      h('a', { href: '/licence.html', target: '_blank', rel: 'noopener' }, 'logiciel libre', h('span', { class: 'bz-visuellement-cache', texte: ' (nouvel onglet)' })),
      ' (licence GNU AGPL version 3), gratuit et fourni sans garantie.'),
    h('div', { class: 'bz-groupe-boutons' },
      boutonEntree('Retour', { type: 'button', principal: false, icone: 'arrow-left', onclick: () => { S.temps = 'vous'; S.erreurs = {}; rendre(); } }),
      boutonEntree('Créer mon entreprise', { occupe: S.envoi, enCours: 'Création…', desactive: !peut })));
  const rendre = () => {
    if (S.mode === 'restaurer') {
      return ecranEntree('Restaurer une sauvegarde', s.enLigne ? 'Première utilisation · en ligne' : 'Première utilisation',
        blocage,
        h('p', { class: 'bz-t-chapeau', texte: s.enLigne
          ? 'Sur l’ordinateur : Réglages, Mettre en ligne, « Exporter mes données pour le serveur ». Comptes, données et logiciels connectés sont repris ; reconnectez-vous ensuite avec votre identifiant habituel.'
          : 'Choisissez le fichier exporté depuis votre ancien ordinateur, puis la phrase qui le protège.' }),
        R.erreur ? encadre('critique', R.erreur) : null,
        h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: restaurer },
          h('label', { class: 'bz-depot' },
            h('input', { type: 'file', accept: '.lbsauv,.json,application/json', onchange: (e) => { R.fichier = e.target.files?.[0] ?? null; R.erreur = null; rendre(); } }),
            icone(R.fichier ? 'archive' : 'upload'),
            h('span', { class: 'bz-depot__titre', 'data-brut': R.fichier ? '' : null, texte: R.fichier ? R.fichier.name : 'Choisir le fichier de sauvegarde' }),
            h('span', { class: 'bz-t-petit', texte: R.fichier ? 'Choisissez-en un autre pour le remplacer.' : 'Fichier .lbsauv exporté par Living Business.' })),
          champMotDePasse(R, 'phrase', { id: 'champ-phrase', libelle: 'Phrase de protection', autocomplete: 'off' }),
          h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'champ-registre', texte: 'Registre des effacements (facultatif)' }),
            h('p', { class: 'bz-champ__aide', id: 'champ-registre-aide', texte: 'Si vous reprenez les données d’un autre serveur : joignez le fichier registre-effacements.jsonl rangé avec ses sauvegardes. Les fiches effacées depuis la copie ne reviendront pas.' }),
            h('input', { id: 'champ-registre', class: 'bz-champ__saisie', type: 'file', accept: '.jsonl,text/plain', 'aria-describedby': 'champ-registre-aide', onchange: (e) => { R.registre = e.target.files?.[0] ?? null; } })),
          h('div', { class: 'bz-groupe-boutons' },
            boutonEntree('Retour à l’installation', { type: 'button', principal: false, icone: 'arrow-left', onclick: () => { S.mode = 'installer'; R.erreur = null; rendre(); } }),
            boutonEntree('Restaurer', { occupe: R.envoi, enCours: 'Restauration…', desactive: !peut }))));
    }
    return ecranEntree('Bienvenue', s.enLigne ? 'Degemer mat · en ligne' : 'Degemer mat',
      blocage,
      h('p', { class: 'bz-t-chapeau', texte: S.temps === 'vous'
        ? 'Créez votre entreprise et votre accès. Vous en êtes le propriétaire : c’est vous qui inviterez ensuite votre équipe, chacun avec ses droits.'
        : 'Dernière étape : choisissez votre mot de passe.' }),
      tempsInstallation(S.temps),
      resumeErreurs(S.erreurs),
      S.erreur ? encadre('critique', S.erreur) : null,
      S.temps === 'vous' ? formulaireVous() : formulaireSecurite(),
      h('p', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => { S.mode = 'restaurer'; rendre(); } },
        s.enLigne ? 'Vous utilisiez déjà Living Business sur un ordinateur ? Restaurer la sauvegarde exportée' : 'Vous changez d’ordinateur ? Restaurer une sauvegarde')));
  };
  rendre();
}

function rendreCodeSecours(code, suite, titre = 'Votre code de secours') {
  let note = false;
  const erreur = h('p', { class: 'bz-champ__erreur', id: 'secours-erreur', hidden: true }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: 'Cochez d’abord « Je l’ai noté en lieu sûr ».' }));
  const bouton = h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--lg', 'aria-disabled': 'true', 'aria-describedby': 'secours-erreur',
    onclick: () => { if (!note) { erreur.hidden = false; annoncer('Cochez d’abord « Je l’ai noté en lieu sûr ».'); return; } suite(); } }, 'Continuer', icone('arrow-right'));
  ecranEntree(titre, 'À garder en lieu sûr',
    h('p', { class: 'bz-t-chapeau', texte: 'Si vous oubliez votre mot de passe, ce code vous permet d’en choisir un nouveau. Personne d’autre, pas même l’éditeur de Living Business, ne peut le faire à votre place.' }),
    h('p', { class: 'bz-code-secours', 'data-brut': '', texte: code }),
    h('div', { class: 'bz-groupe-boutons' },
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => copier(code, 'Code copié') }, icone('copy'), 'Copier'),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => window.print() }, icone('file-text'), 'Imprimer')),
    h('p', { class: 'bz-t-petit', texte: 'Notez-le sur papier ou dans votre gestionnaire de mots de passe. Il ne sera plus affiché ; vous pourrez en créer un nouveau dans « Mon compte ».' }),
    h('label', { class: 'bz-case' }, h('input', { type: 'checkbox', onchange: (e) => { note = e.target.checked; bouton.setAttribute('aria-disabled', String(!note)); if (note) erreur.hidden = true; } }), 'Je l’ai noté en lieu sûr'),
    erreur,
    h('div', { class: 'bz-groupe-boutons' }, bouton));
}

async function rendreConnexion(s, message = null, attenteCode = false) {
  await chargerEntree();
  const S = { identifiant: '', motDePasse: '', code: '', nouveau: '', confirmation: '', erreur: null, erreurs: {}, oubli: false, envoi: false, etape: attenteCode ? 'code' : 'mdp', code2: '', recuperation: false };
  // déconnexion : « Kenavo » (au revoir), une seule fois
  let kenavo = false;
  try { kenavo = sessionStorage.getItem('lb-kenavo') === '1'; sessionStorage.removeItem('lb-kenavo'); } catch { /* stockage indisponible */ }
  if (!message && kenavo) message = 'Kenavo. À demain.';
  const connecter = async (e) => {
    e.preventDefault();
    S.erreurs = { identifiant: S.identifiant.trim() ? null : 'Indiquez votre identifiant.', motDePasse: S.motDePasse ? null : 'Indiquez votre mot de passe.' };
    if (Object.values(S.erreurs).some(Boolean)) return rendre();
    S.erreurs = {};
    S.envoi = true;
    rendre();
    try {
      const r = await api('POST', '/session', { identifiant: S.identifiant, motDePasse: S.motDePasse });
      S.motDePasse = '';
      if (r.deuxEtapes) { Object.assign(S, { etape: 'code', envoi: false, erreur: null }); return rendre(); }
      await demarrer();
    } catch (err) { S.envoi = false; S.motDePasse = ''; S.erreur = err.message; rendre(); }
  };
  const verifierCode = async (e) => {
    e.preventDefault();
    S.envoi = true;
    rendre();
    try {
      const r = await api('POST', '/session/code', { code: S.code2 });
      await demarrer();
      if (r.recuperation) informer(`Code de récupération utilisé : il vous en reste ${r.codesRestants}. Mon compte, Validation en deux étapes pour en créer de nouveaux.`, r.codesRestants < 3 ? 'erreur' : 'ok');
    } catch (err) { if (err.session) return; S.envoi = false; S.code2 = ''; S.erreur = err.message; rendre(); }
  };
  const annulerCode = async () => {
    await api('DELETE', '/session').catch(() => undefined);
    Object.assign(S, { etape: 'mdp', code2: '', erreur: null, envoi: false });
    rendre();
  };
  const formulaireCode = () => [
    h('p', { class: 'bz-t-chapeau', texte: S.recuperation
      ? 'Saisissez un de vos codes de récupération (8 caractères, chacun ne sert qu’une fois).'
      : 'Ouvrez l’application d’authentification de votre téléphone et saisissez le code à 6 chiffres de Living Business.' }),
    h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: verifierCode },
      S.recuperation
        ? champEntree({ id: 'champ-code', libelle: 'Code de récupération', maxlength: '12', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters', placeholder: 'XXXX-XXXX', valeur: S.code2, oninput: (v) => (S.code2 = v) })
        : champEntree({ id: 'champ-code', libelle: 'Code de validation', inputmode: 'numeric', pattern: '[0-9 ]{6,7}', maxlength: '7', autocomplete: 'one-time-code', enterkeyhint: 'done', placeholder: '123456', valeur: S.code2, oninput: (v) => (S.code2 = v) }),
      h('div', { class: 'bz-groupe-boutons' }, boutonEntree('Valider le code', { occupe: S.envoi, enCours: 'Vérification…' }))),
    h('div', { class: 'bz-pile' },
      h('div', {}, h('button', { class: 'bz-bouton bz-bouton--lien', type: 'button', onclick: () => { S.recuperation = !S.recuperation; S.code2 = ''; S.erreur = null; rendre(); } }, S.recuperation ? 'Utiliser le code du téléphone' : 'Téléphone perdu ? Utiliser un code de récupération')),
      h('div', {}, h('button', { class: 'bz-bouton bz-bouton--lien', type: 'button', onclick: annulerCode }, 'Revenir à la connexion'))),
  ];
  const parCode = async (e) => {
    e.preventDefault();
    const r = ENTREE.robustesse(S.nouveau, S.identifiant);
    S.erreurs = {
      identifiant: S.identifiant.trim() ? null : 'Indiquez votre identifiant.',
      code: S.code.trim() ? null : 'Saisissez votre code de secours.',
      nouveau: r.valide ? null : r.conseil,
      confirmation: S.nouveau === S.confirmation ? null : 'Les deux mots de passe ne sont pas identiques.',
    };
    if (Object.values(S.erreurs).some(Boolean)) return rendre();
    S.erreurs = {};
    S.envoi = true;
    rendre();
    try {
      const res = await api('POST', '/secours', { identifiant: S.identifiant, code: S.code, motDePasse: S.nouveau });
      rendreCodeSecours(res.codeSecours, () => demarrer(), 'Mot de passe changé : votre nouveau code de secours');
    } catch (err) { S.envoi = false; S.erreur = err.message; rendre(); }
  };
  const identifiant = () => champEntree({ id: 'champ-identifiant', libelle: 'Identifiant', autocomplete: 'username', inputmode: 'email', autocapitalize: 'none', spellcheck: 'false', maxlength: '120', enterkeyhint: 'next', valeur: S.identifiant, erreur: S.erreurs.identifiant, oninput: (v) => (S.identifiant = v) });
  const rendre = () => ecranEntree(s.entreprise ? casseTitre(sansDemo(s.entreprise)) : 'Connexion', S.etape === 'code' ? 'Validation en deux étapes' : S.oubli ? 'Mot de passe oublié' : 'Connexion',
    message && !S.erreur ? encadre(kenavo && message === 'Kenavo. À demain.' ? 'info' : 'ok', message) : null,
    resumeErreurs(S.erreurs),
    S.erreur ? encadre('critique', S.erreur) : null,
    S.etape === 'code' ? formulaireCode()
    : !S.oubli
      ? [h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: connecter },
        identifiant(),
        champMotDePasse(S, 'motDePasse', { id: 'champ-motDePasse', libelle: 'Mot de passe', erreur: S.erreurs.motDePasse }),
        h('div', { class: 'bz-groupe-boutons' }, boutonEntree('Se connecter', { occupe: S.envoi, enCours: 'Connexion…', icone: 'log-in' }))),
      h('div', {}, h('button', { class: 'bz-bouton bz-bouton--lien', type: 'button', onclick: () => { S.oubli = true; S.erreur = null; S.erreurs = {}; rendre(); } }, 'Mot de passe oublié ?')),
      astuceInstallation(s)]
      : [
        h('ul', { class: 'bz-consignes' },
          h('li', {}, h('strong', { texte: 'Vous êtes un collègue : ' }), 'demandez un nouveau lien à un administrateur de l’entreprise (Réglages, Accès et visibilité).'),
          h('li', {}, h('strong', { texte: 'Vous avez votre code de secours : ' }), 'saisissez-le ci-dessous (il remet aussi à zéro la validation en deux étapes si vous avez perdu votre téléphone).'),
          h('li', {}, h('strong', { texte: 'Plus de code ? ' }), s.enLigne ? `Administrateur du serveur : ${s.aideSecours}.` : `Sur l’ordinateur où tourne Living Business, ${s.aideSecours ?? 'lancez la commande de secours'} : la page de réinitialisation s’ouvre.`)),
        h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: parCode },
          identifiant(),
          champEntree({ id: 'champ-code', libelle: 'Code de secours', maxlength: '40', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'characters', placeholder: 'XXXX-XXXX-XXXX-XXXX-XXXX', valeur: S.code, erreur: S.erreurs.code, oninput: (v) => (S.code = v) }),
          champMotDePasse(S, 'nouveau', { id: 'champ-nouveau', libelle: 'Nouveau mot de passe', nouveau: true, identifiant: () => S.identifiant, erreur: S.erreurs.nouveau }),
          champMotDePasse(S, 'confirmation', { id: 'champ-confirmation', libelle: 'Confirmez le mot de passe', autocomplete: 'new-password', erreur: S.erreurs.confirmation }),
          h('div', { class: 'bz-groupe-boutons' }, boutonEntree('Changer mon mot de passe', { occupe: S.envoi, enCours: 'Un instant…' }))),
        h('div', {}, h('button', { class: 'bz-bouton bz-bouton--lien', type: 'button', onclick: () => { S.oubli = false; S.erreur = null; S.erreurs = {}; rendre(); } }, 'Revenir à la connexion')),
      ]);
  rendre();
}

async function rendreInvitation(jeton) {
  await chargerEntree();
  let info;
  try { info = await api('GET', `/invitation/${jeton}`); } catch (e) {
    return ecranEntree('Lien d’invitation', 'Invitation', encadre('critique', e.message), h('div', {}, h('a', { class: 'bz-bouton bz-bouton--secondaire bz-bouton--lg', href: '/', texte: 'Aller à la connexion' })));
  }
  const S = { motDePasse: '', confirmation: '', erreur: null, erreurs: {}, envoi: false };
  const rendre = () => ecranEntree(`Bienvenue${info.nom ? `, ${info.nom.split(' — ')[0]}` : ''}`, `Invitation · ${casseTitre(sansDemo(info.entreprise))}`,
    h('p', { class: 'bz-t-chapeau' }, 'Votre identifiant : ', h('strong', { 'data-brut': '', texte: info.identifiant }), '. Choisissez votre mot de passe : vous seul le connaîtrez.'),
    resumeErreurs(S.erreurs),
    S.erreur ? encadre('critique', S.erreur) : null,
    h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const r = ENTREE.robustesse(S.motDePasse, info.identifiant);
      S.erreurs = { motDePasse: r.valide ? null : r.conseil, confirmation: S.motDePasse === S.confirmation ? null : 'Les deux mots de passe ne sont pas identiques.' };
      if (Object.values(S.erreurs).some(Boolean)) return rendre();
      S.erreurs = {};
      S.envoi = true;
      rendre();
      try {
        await api('POST', `/invitation/${jeton}`, { motDePasse: S.motDePasse });
        history.replaceState(null, '', '/');
        E.premiereArrivee = true;
        await demarrer();
      } catch (err) { S.envoi = false; S.erreur = err.message; rendre(); }
    } },
      h('input', { type: 'text', class: 'bz-visuellement-cache', autocomplete: 'username', value: info.identifiant, readonly: true, tabindex: '-1', 'aria-hidden': 'true' }),
      champMotDePasse(S, 'motDePasse', { id: 'champ-motDePasse', libelle: 'Mot de passe', nouveau: true, identifiant: () => info.identifiant, erreur: S.erreurs.motDePasse }),
      champMotDePasse(S, 'confirmation', { id: 'champ-confirmation', libelle: 'Confirmez le mot de passe', autocomplete: 'new-password', erreur: S.erreurs.confirmation }),
      h('div', { class: 'bz-groupe-boutons' }, boutonEntree('Entrer dans l’entreprise', { occupe: S.envoi, enCours: 'Un instant…', icone: 'arrow-right' }))));
  rendre();
}

async function rendreSecoursLocal(jeton) {
  await chargerEntree();
  let info;
  try { info = await api('GET', `/secours-local/${jeton}`); } catch (e) {
    return ecranEntree('Réinitialisation', 'Secours', encadre('critique', e.message), h('div', {}, h('a', { class: 'bz-bouton bz-bouton--secondaire bz-bouton--lg', href: '/', texte: 'Aller à la connexion' })));
  }
  const S = { identifiant: info.comptes[0]?.identifiant ?? '', motDePasse: '', confirmation: '', erreur: null, erreurs: {}, envoi: false };
  const rendre = () => ecranEntree('Nouveau mot de passe', `Secours · ${casseTitre(sansDemo(info.entreprise))}`,
    h('p', { class: 'bz-t-chapeau', texte: E.connexion?.enLigne
      ? 'Ce lien a été créé sur le serveur (commande de secours). Choisissez le compte et un nouveau mot de passe ; sa validation en deux étapes sera à refaire juste après.'
      : 'Ce lien a été créé sur cet ordinateur (secours). Choisissez le compte et un nouveau mot de passe.' }),
    resumeErreurs(S.erreurs),
    S.erreur ? encadre('critique', S.erreur) : null,
    h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      const r = ENTREE.robustesse(S.motDePasse, S.identifiant);
      S.erreurs = { motDePasse: r.valide ? null : r.conseil, confirmation: S.motDePasse === S.confirmation ? null : 'Les deux mots de passe ne sont pas identiques.' };
      if (Object.values(S.erreurs).some(Boolean)) return rendre();
      S.erreurs = {};
      S.envoi = true;
      rendre();
      try {
        await api('POST', `/secours-local/${jeton}`, { identifiant: S.identifiant, motDePasse: S.motDePasse });
        history.replaceState(null, '', '/');
        await demarrer();
      } catch (err) { S.envoi = false; S.erreur = err.message; rendre(); }
    } },
      h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'champ-compte', texte: 'Compte' }),
        h('div', { class: 'bz-select' }, h('select', { id: 'champ-compte', autocomplete: 'username', onchange: (e) => (S.identifiant = e.target.value) },
          info.comptes.map((c) => h('option', { value: c.identifiant, selected: c.identifiant === S.identifiant, 'data-brut': '', texte: c.identifiant }))), icone('chevron-down'))),
      champMotDePasse(S, 'motDePasse', { id: 'champ-motDePasse', libelle: 'Nouveau mot de passe', nouveau: true, identifiant: () => S.identifiant, erreur: S.erreurs.motDePasse }),
      champMotDePasse(S, 'confirmation', { id: 'champ-confirmation', libelle: 'Confirmez le mot de passe', autocomplete: 'new-password', erreur: S.erreurs.confirmation }),
      h('div', { class: 'bz-groupe-boutons' }, boutonEntree('Enregistrer et entrer', { occupe: S.envoi, enCours: 'Un instant…', icone: 'arrow-right' }))));
  rendre();
}

// ---------------------------------------------------------------- validation en deux étapes (code du téléphone, TOTP)
const APPLIS_AUTH = 'Google Authenticator, Microsoft Authenticator, 1Password, Bitwarden, FreeOTP…';

/**
 * Activation pas à pas : QR code (ou clé à saisir, ou lien direct sur le téléphone), puis un premier code pour
 * confirmer, puis les 8 codes de récupération à noter (montrés une seule fois). `apres` : une fois terminé.
 */
function blocActivationDeuxEtapes(apres, { bouton = 'Activer la validation en deux étapes' } = {}) {
  const A = { etape: 'debut', secret: null, uri: null, qr: null, code: '', codes: null, note: false, erreur: null, envoi: false };
  const racine = h('div', { class: 'bz-pile' });
  const demarrerActivation = async () => {
    A.envoi = true;
    rendre();
    try { Object.assign(A, await api('POST', '/compte/deux-etapes', {}), { etape: 'scan', erreur: null }); } catch (e) { if (!e.session) A.erreur = e.message; }
    A.envoi = false;
    rendre();
  };
  const confirmer = async (e) => {
    e.preventDefault();
    A.envoi = true;
    rendre();
    try {
      const r = await api('POST', '/compte/deux-etapes/confirmer', { code: A.code });
      Object.assign(A, { codes: r.codes, etape: 'codes', erreur: null, secret: null, uri: null, qr: null });
    } catch (err) {
      if (err.session) return;
      A.erreur = err.message;
      A.code = '';
      if (/expir/i.test(err.message)) A.etape = 'debut';
    }
    A.envoi = false;
    rendre();
  };
  const texteCodes = () => `Living Business — codes de récupération (validation en deux étapes)\n${E.connexion?.compte?.identifiant ?? ''}\nChaque code ne sert qu’une fois, si le téléphone n’est pas disponible.\n\n${A.codes.join('\n')}\n`;
  const contenu = () => {
    if (A.etape === 'debut') return [
      h('p', { class: 'bz-t-petit', texte: `En plus du mot de passe, un code à 6 chiffres donné par une application de votre téléphone (${APPLIS_AUTH}). Même si quelqu’un découvre votre mot de passe, il ne peut pas entrer.` }),
      A.erreur ? encadre('critique', A.erreur) : null,
      h('div', { class: 'bz-groupe-boutons' }, boutonEntree(bouton, { type: 'button', occupe: A.envoi, enCours: 'Un instant…', onclick: demarrerActivation })),
    ];
    if (A.etape === 'scan') return [
      h('ol', { class: 'bz-consignes' },
        h('li', { texte: `Sur votre téléphone, ouvrez une application d’authentification (${APPLIS_AUTH}) et ajoutez un compte.` }),
        h('li', {}, 'Scannez ce QR code avec l’application.',
          h('div', { class: 'bz-qr' }, h('img', { src: A.qr, alt: 'QR code à scanner avec l’application d’authentification', width: '220', height: '220' })),
          h('div', { class: 'bz-groupe-boutons' }, h('a', { class: 'bz-bouton bz-bouton--secondaire', href: A.uri, texte: 'Vous êtes sur le téléphone ? Ouvrir dans l’application' })),
          h('details', { class: 'bz-repli' }, h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Impossible de scanner ? Saisir la clé à la main' }), icone('chevron-down', { taille: 'sm' })),
            h('p', { class: 'bz-t-petit', texte: 'Type : basé sur le temps (TOTP) · 6 chiffres · 30 secondes.' }),
            blocCode((A.secret.match(/.{1,4}/g) ?? []).join(' '), 'Copier la clé'))),
        h('li', {}, 'Saisissez le code à 6 chiffres affiché par l’application.',
          A.erreur ? encadre('critique', A.erreur) : null,
          h('form', { class: 'bz-formulaire bz-formulaire--code', novalidate: true, onsubmit: confirmer },
            champEntree({ id: 'champ-code-activation', libelle: 'Code de validation', inputmode: 'numeric', pattern: '[0-9 ]{6,7}', maxlength: '7', autocomplete: 'one-time-code', enterkeyhint: 'done', placeholder: '123456', valeur: A.code, oninput: (v) => (A.code = v) }),
            h('div', { class: 'bz-groupe-boutons' }, boutonEntree('Confirmer le code', { occupe: A.envoi, enCours: 'Vérification…' }))))),
    ];
    return [
      encadre('ok', 'Validation en deux étapes activée.', 'Vos autres sessions ouvertes ont été fermées.'),
      h('p', { class: 'bz-t-petit', texte: 'Codes de récupération : si vous perdez votre téléphone, chacun remplace une seule fois le code de l’application. Notez-les maintenant, ils ne seront plus affichés.' }),
      h('ol', { class: 'bz-code-secours bz-codes-recuperation', 'data-brut': '' }, A.codes.map((c) => h('li', { texte: c }))),
      h('div', { class: 'bz-groupe-boutons' },
        h('button', { class: 'bz-bouton bz-bouton--secondaire', type: 'button', onclick: () => copier(A.codes.join('\n'), 'Codes copiés') }, icone('copy'), 'Copier'),
        h('button', { class: 'bz-bouton bz-bouton--secondaire', type: 'button', onclick: () => telecharger('living-business-codes-de-recuperation.txt', texteCodes(), 'text/plain;charset=utf-8') }, icone('download'), 'Télécharger (.txt)'),
        h('button', { class: 'bz-bouton bz-bouton--secondaire', type: 'button', onclick: () => window.print() }, icone('file-text'), 'Imprimer')),
      h('label', { class: 'bz-case' }, h('input', { type: 'checkbox', checked: A.note, onchange: (e) => { A.note = e.target.checked; const b = racine.querySelector('[data-cle="deux-etapes-terminer"]'); if (b) b.setAttribute('aria-disabled', String(!A.note)); } }), 'Je les ai notés en lieu sûr'),
      h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--principal bz-bouton--lg', type: 'button', cle: 'deux-etapes-terminer', 'aria-disabled': A.note ? null : 'true', onclick: () => { if (A.note) apres(); else annoncer('Cochez d’abord « Je les ai notés en lieu sûr ».'); } }, 'Terminer')),
    ];
  };
  const rendre = () => {
    remplir(racine, contenu());
    if (A.etape === 'scan') racine.querySelector('.bz-formulaire--code input')?.focus();
  };
  rendre();
  return racine;
}

/** Administrateur d'un jeu en ligne : la validation en deux étapes d'abord, rien d'autre avant. */
function rendreDeuxEtapesObligatoire(s) {
  ecranEntree('Validation en deux étapes', `Sécurité · ${s.entreprise ? casseTitre(sansDemo(s.entreprise)) : 'en ligne'}`,
    h('p', { class: 'bz-t-chapeau', texte: 'Votre Living Business est en ligne, joignable depuis Internet : chaque administrateur confirme donc sa connexion avec un code donné par son téléphone. Deux minutes, une seule fois.' }),
    blocActivationDeuxEtapes(() => demarrer(), { bouton: 'Commencer' }),
    h('div', {}, h('button', { class: 'bz-bouton bz-bouton--lien', type: 'button', onclick: seDeconnecter }, 'Se déconnecter')));
}

// ---------------------------------------------------------------- application installable (téléphone, ordinateur)
let INVITE_INSTALLATION = null;
const estIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const estInstallee = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // le bouton « Installer l'application » propose l'installation au bon moment
  INVITE_INSTALLATION = e;
  if (E.monde) rendreBarre();
});
window.addEventListener('appinstalled', () => {
  INVITE_INSTALLATION = null;
  if (E.monde) { rendreBarre(); informer('Application installée : retrouvez Living Business sur votre écran d’accueil.', 'ok'); }
});
async function installerApplication() {
  const e = INVITE_INSTALLATION;
  if (!e) return;
  INVITE_INSTALLATION = null;
  try { e.prompt(); await e.userChoice; } catch { /* refusé ou indisponible */ }
  if (E.monde) rendreBarre();
}
if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(() => undefined);

/** Comment installer l'application sur CET appareil (bouton, ou consigne iPhone). */
function blocApplication() {
  if (estInstallee()) return h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Vous utilisez déjà l’application installée sur cet appareil.' });
  if (INVITE_INSTALLATION) return h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--principal', type: 'button', onclick: async () => { await installerApplication(); rendreVue(); } }, icone('download'), 'Installer l’application'));
  if (estIos()) return h('p', { class: 'bz-t-petit' }, 'Sur iPhone ou iPad (Safari) : touchez ', h('strong', { texte: 'Partager' }), ' (carré avec une flèche), puis ', h('strong', { texte: 'Sur l’écran d’accueil' }), '.');
  if (!window.isSecureContext) return h('p', { class: 'bz-t-petit bz-texte-2', texte: 'L’installation demande une adresse https (Living Business mis en ligne sur votre serveur) ou l’ordinateur lui-même (http://127.0.0.1).' });
  return h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Dans le navigateur : menu (trois points) › « Installer Living Business » (Chrome, Edge) ; sur Mac avec Safari : Fichier › « Ajouter au Dock ».' });
}
/** Petite astuce sous le formulaire de connexion d'un jeu en ligne, sur iPhone. */
const astuceInstallation = (s) => (s.enLigne && estIos() && !estInstallee()
  ? h('p', { class: 'bz-t-petit' }, 'Astuce : touchez ', h('strong', { texte: 'Partager' }), ' puis ', h('strong', { texte: 'Sur l’écran d’accueil' }), ' pour avoir Living Business comme une application.')
  : null);

// ---------------------------------------------------------------- coque
/* Hôte des fenêtres de l'application (#modale) : un <dialog> natif, ouvert en modal dès qu'une fenêtre y est rendue et
   fermé quand on la vide. On obtient la couche supérieure, l'inertie du reste de la page (focus piégé, lecteur
   d'écran), Échap et le retour du focus à l'élément qui l'avait ouverte. Le <dialog> porte le rôle et le nom. */
function fermerModale() {
  remplir($('#modale'));
}
function hoteModale(d) {
  if (!d) return;
  const synchroniser = () => {
    const plein = d.childElementCount > 0;
    if (plein) {
      const interne = d.querySelector('[role="dialog"], [role="alertdialog"]');
      if (interne) {
        const par = interne.getAttribute('aria-labelledby');
        const nom = interne.getAttribute('aria-label');
        const titre = interne.querySelector('h2, h1, h3');
        if (par) { d.setAttribute('aria-labelledby', par); d.removeAttribute('aria-label'); }
        else if (nom) { d.setAttribute('aria-label', typo(nom)); d.removeAttribute('aria-labelledby'); }
        else if (titre) { if (!titre.id) titre.id = 'titre-modale'; d.setAttribute('aria-labelledby', titre.id); d.removeAttribute('aria-label'); }
        if (interne.getAttribute('role') === 'alertdialog') d.setAttribute('role', 'alertdialog'); else d.removeAttribute('role');
        interne.removeAttribute('role');
        interne.removeAttribute('aria-modal');
      }
      if (!d.open) {
        try { d.showModal(); } catch { d.setAttribute('open', ''); }
        const champ = d.querySelector('input:not([type="hidden"]):not([type="file"]):not([disabled]), select:not([disabled]), textarea:not([disabled])');
        if (champ && !petitEcran()) champ.focus();
      }
    } else if (d.open) {
      d.close();
    }
  };
  new MutationObserver(synchroniser).observe(d, { childList: true });
  // Échap : le <dialog> se vide (même effet que « Fermer ») ; jamais un dialogue ouvert sans contenu
  d.addEventListener('cancel', (e) => { e.preventDefault(); fermerModale(); });
  d.addEventListener('close', () => { if (d.childElementCount) fermerModale(); });
}

// ---------------------------------------------------------------- fenêtres et menus communs (§4.14, §4.15)
/**
 * Dialogue natif (§4.14) redessiné sans perdre le focus : contenu() → { corps: [nœuds], pied: [boutons] }.
 * Le pied porte les actions (principale à droite sur ordinateur ; en pleine largeur et à portée du pouce sur
 * téléphone). onsubmit : le cadre est un <form> (Entrée valide). Le <dialog> est retiré à sa fermeture.
 * Renvoie { d, rendre, fermer }.
 */
function dialogueVivant({ titre, surtitre = null, taille = 'md', contenu, onsubmit = null, alerte = false }) {
  const idTitre = `dlg-${cle().slice(0, 8)}`;
  const corps = h('div', { class: 'bz-dialogue__corps' });
  const pied = h('footer', { class: 'bz-dialogue__pied' });
  let d = null;
  const cadre = h(onsubmit ? 'form' : 'div', { class: 'bz-dialogue__cadre', novalidate: onsubmit ? true : null, onsubmit: onsubmit ? (e) => { e.preventDefault(); onsubmit(e); } : null },
    h('header', { class: 'bz-dialogue__tete' },
      h('div', { class: 'bz-dialogue__titres' },
        surtitre ? h('p', { class: 'bz-t-surtitre', texte: surtitre }) : null,
        h('h2', { class: 'bz-dialogue__titre bz-t-titre-3', id: idTitre, texte: titre })),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', 'aria-label': 'Fermer', 'data-infobulle': 'Fermer', onclick: () => d?.close() }, icone('x'))),
    corps, pied);
  d = h('dialog', { class: `bz-dialogue bz-dialogue--${taille}`, role: alerte ? 'alertdialog' : null, 'aria-labelledby': idTitre }, cadre);
  const rendre = () => {
    const r = contenu();
    remplir(corps, r.corps ?? []);
    const boutons = [r.pied ?? []].flat(Infinity).filter(Boolean);
    remplir(pied, boutons);
    pied.hidden = !boutons.length;
  };
  d.addEventListener('close', () => setTimeout(() => d.remove(), 0), { once: true });
  document.body.append(d);
  preparerDialogue(d);
  rendre();
  ouvrirDialogue(d);
  return { d, rendre, fermer: () => d.close() };
}

/**
 * Menu « ⋯ » (§4.15) : bouton + [popover] role="menu". Flèches, Début, Fin, première lettre ; Échap et clic dehors
 * ferment (popover). items : [{ libelle, icone, faire, danger }] (null ignoré). Renvoie [bouton, menu].
 */
function menuActions({ id, libelle, items, icone: ic = 'ellipsis', texte = null, classe = 'bz-bouton bz-bouton--fantome bz-bouton--icone' }) {
  const liste = items.filter(Boolean);
  const boutons = [];
  const menu = h('div', { class: 'bz-menu', id, popover: 'auto', role: 'menu', 'aria-label': libelle,
    onkeydown: (e) => {
      const i = boutons.indexOf(document.activeElement);
      const pas = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (pas) { e.preventDefault(); boutons[(i + pas + boutons.length) % boutons.length]?.focus(); return; }
      if (e.key === 'Home') { e.preventDefault(); boutons[0]?.focus(); return; }
      if (e.key === 'End') { e.preventDefault(); boutons.at(-1)?.focus(); return; }
      if (e.key.length === 1 && /\p{L}/u.test(e.key)) {
        const k = e.key.toLowerCase();
        const suivant = [...boutons.slice(i + 1), ...boutons.slice(0, i + 1)].find((b) => b.textContent.trim().toLowerCase().startsWith(k));
        if (suivant) { e.preventDefault(); suivant.focus(); }
      }
    } },
  liste.map((x) => { const b = h('button', { type: 'button', role: 'menuitem', class: `bz-menu__option${x.danger ? ' bz-menu__option--danger' : ''}`, onclick: () => { cacher(menu); x.faire(); } }, x.icone ? icone(x.icone, { taille: 'sm' }) : null, h('span', { texte: x.libelle })); boutons.push(b); return b; }));
  const bouton = h('button', { type: 'button', class: classe, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': id, 'aria-label': texte ? null : libelle, 'data-infobulle': texte ? null : libelle, cle: `bouton-${id}`,
    popovertarget: POPOVER_NATIF ? id : null,
    onclick: POPOVER_NATIF ? (e) => { const b = e.currentTarget; requestAnimationFrame(() => placerPres(menu, b)); } : (e) => { if (estOuvert(menu)) cacher(menu); else { montrer(menu); placerPres(menu, e.currentTarget); boutons[0]?.focus(); } } },
  icone(ic, { taille: texte ? 'sm' : 'md' }), texte ? h('span', { texte }) : null);
  menu.addEventListener('toggle', (e) => {
    bouton.setAttribute('aria-expanded', String(e.newState === 'open'));
    if (e.newState === 'open') setTimeout(() => boutons[0]?.focus(), 0);
  });
  return [bouton, menu];
}

/** Bloc vide (§4.18) : titre qui dit ce qui manque, phrase courte, action principale, lien secondaire. */
function blocVide({ titre, texte = null, actions = [], compact = false, role = null }) {
  return h('div', { class: `bz-vide${compact ? ' bz-vide--compact' : ''}`, role },
    h(compact ? 'p' : 'h2', { class: compact ? 'bz-t-petit' : 'bz-vide__titre', texte: titre }),
    texte ? h('p', { class: 'bz-vide__texte', texte }) : null,
    [actions].flat().filter(Boolean).length ? h('div', { class: 'bz-groupe-boutons' }, actions) : null);
}

/**
 * Écran vide d'une rubrique (§4.18) : deux lignes — ce qui manque, puis ce que l'écran montrera (web/simplicite.js) —
 * et UNE action principale, avec au plus un lien secondaire. Sans droit d'administrer : le texte dit qui s'en charge.
 */
function videRubrique(id, { action = null, secondaire = null, titre = null, texte = null } = {}) {
  const t = SIMPLE.texteVide(id);
  const phrase = texte ?? t?.texte ?? 'Les fiches apparaîtront ici dès que vous connecterez vos données.';
  return blocVide({
    titre: titre ?? t?.titre ?? 'Rien ici pour le moment.',
    texte: E.monde.profil.peutAdministrer ? phrase : `${phrase} La personne qui administre Living Business connecte les données.`,
    actions: E.monde.profil.peutAdministrer ? [action, secondaire] : [],
  });
}
/** L'action d'un écran vide : « Connecter mes données » (pour un type de fiche : l'import de ce type, directement). */
const boutonConnecter = (cible = null) => h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => (cible?.type ? ouvrirAssistant('fichier', cible) : ouvrirAssistant()) }, icone('plug'), 'Connecter mes données');

/** Erreur de chargement d'un écran (§4.18) : titre, raison, « Réessayer ». */
const erreurEcran = (titre, e, reessayer) => h('div', { class: 'bz-ecran' }, blocVide({ titre, texte: e?.message || 'Vérifiez la connexion.', role: 'alert',
  actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: reessayer }, icone('refresh-cw'), 'Réessayer') }));

/** Message en ligne, près de ce qu'il concerne (jamais un toast seul pour une erreur, §4.16). */
const messageEnLigne = (ton, texte, detail = null) => (texte ? encadre(ton, texte, detail) : null);

/** Mention « Exemple », une seule fois par vue (§4.12). */
const badgeExemple = () => h('span', { class: 'bz-badge' }, icone('flask-conical', { taille: 'sm' }), 'Exemple');

/** Lien externe (nouvel onglet) avec son icône : jamais la flèche Unicode « ↗ ». */
const lienExterne = (href, texte, classe = 'bz-bouton bz-bouton--secondaire') => h('a', { class: classe, href, target: '_blank', rel: 'noopener noreferrer' }, h('span', { texte }), icone('external-link', { taille: 'sm' }), h('span', { class: 'bz-visuellement-cache', texte: ' (nouvel onglet)' }));

async function rendreApplication() {
  E.scene?.detruire();
  E.scene = null;
  // Coque (§4.1) : rail (≥ 600 px), en-tête, bandeau de mode, sous-navigation (téléphone), contenu et fiche,
  // barre d'onglets (téléphone). Repères : <nav>, <header>, <main>, <aside>.
  remplir($('#app'),
    h('div', { class: 'bz-coque', id: 'coque', 'data-rail': railEffectif() ? 'replie' : 'ouvert' },
      h('nav', { class: 'bz-rail', id: 'rail', 'aria-label': 'Navigation principale' }),
      h('header', { class: 'bz-entete', id: 'barre' }),
      h('div', { class: 'bz-coque__bandeau', id: 'banniere' }),
      h('nav', { class: 'bz-sous-nav', id: 'sous-nav', 'aria-label': 'Dans cette rubrique' }),
      h('div', { class: 'bz-coque__contenu', id: 'corps' },
        h('main', { class: 'zone', id: 'zone', tabindex: '-1', 'aria-labelledby': 'titre-vue' },
          h('div', { class: 'scene', id: 'scene' }),
          h('div', { class: 'page', id: 'page', hidden: true }),
          h('div', { class: 'infobulle', id: 'infobulle', hidden: true }),
          h('div', { class: 'hud bz-hud', id: 'hud' }),
        ),
        h('aside', { class: 'bz-fiche', id: 'fiche', hidden: true, 'aria-label': 'Fiche' }),
      ),
      h('nav', { class: 'bz-onglets-bas', id: 'onglets', 'aria-label': 'Navigation principale' }),
    ),
    h('div', { class: 'bz-menu bz-menu-compte', id: 'menu-compte', popover: 'auto', role: 'dialog', 'aria-label': 'Compte et écosystème' }),
    h('dialog', { id: 'modale', class: 'bz-hote-modale' }),
  );
  document.documentElement.setAttribute('data-coque', '');
  preparerMenuCompte($('#menu-compte'));
  hoteModale($('#modale'));
  // une fenêtre se ferme : on applique les nouveautés reçues en direct pendant qu'elle était ouverte
  new MutationObserver(() => { if (E.majEnAttente && !occupe()) rafraichirEnDirect(); }).observe($('#modale'), { childList: true });
  await charger();
}

async function charger() {
  const avant = E.monde?.progression ?? null;
  E.monde = await api('GET', '/monde');
  const neuves = majSimplicite();
  celebrer(avant, E.monde.progression);
  E.scene?.niveauPort?.(modeCalme() ? 0 : E.monde.progression?.niveau?.n ?? 1); // niveau du port sur la carte (§5.9)
  // la vue suit le choix de l'entreprise (d'un seul tenant / par départements) quand il change
  if (E.vueCarte === null || E.dernierDefaut !== E.monde.organisation.vueParDefaut || (E.vueCarte === 'departements' && !E.monde.organisation.departements)) E.vueCarte = E.monde.organisation.vueParDefaut;
  E.dernierDefaut = E.monde.organisation.vueParDefaut;
  if (E.filtreDep !== 'tous' && !E.monde.objets.some((o) => o.id === E.filtreDep)) E.filtreDep = 'tous';
  rendreTout();
  celebrerPremiersPas();
  annoncerRubriques(neuves);
  if (E.selection && E.selection !== '__pavillon') {
    try {
      E.fiche = await lireFiche(E.selection);
    } catch {
      E.selection = null;
      E.fiche = null;
    }
    rendreFiche();
  }
}

function rendreTout() {
  rendreBarre();
  rendreBanniere();
  rendreVue();
  rendreFiche();
}

// ---------------------------------------------------------------- coque : rail groupé, en-tête, onglets du téléphone (§4.1, §4.2)
/* Une seule description des destinations (web/navigation.js) sert au rail (ordinateur et tablette), à la barre à
   5 onglets (téléphone), à la sous-navigation d'un groupe (téléphone), à « Aller à » de la palette et aux raccourcis
   « G puis une lettre ». Les entrées sont de vrais liens (#/vue) : ouvrir dans un nouvel onglet et Retour marchent. */
const estTelephone = () => matchMedia('(max-width: 37.49em)').matches;
const estOrdinateur = () => matchMedia('(min-width: 60em)').matches;
const railEffectif = () => !estOrdinateur() || E.railReplie;
const VUES_AVEC_TITRE = new Set(['carte', 'matin', 'tableau', 'pipeline', 'sante', 'planning', 'courrier', 'satisfaction', 'optimiser', 'departements', 'nexus', 'reglages', 'compte', 'progression']); // le titre (h1) est dans l'en-tête
const vueAvecTitre = (v) => VUES_AVEC_TITRE.has(v) || estVueListe(v) || String(v).startsWith('dep:');
const LIBELLE_TON = { critique: 'Critique', attention: 'À traiter', info: 'Information', ok: 'En ordre' };

function planCourant() {
  return planAujourdhui(E.monde, { reports: E.reports, filtre: dansFiltre });
}
function navigation() {
  return groupesNavigation(E.monde, { aFaire: planCourant().aFaire, vueAujourdhui: vueAujourdhui() });
}
/** Toutes les vues accessibles, à plat (palette, raccourcis) : les destinations groupées et le pied du rail. */
function onglets() {
  return destinations(navigation(), piedNavigation(E.monde)).map((d) => ({ id: d.vue, cle: d.id, libelle: d.libelle, groupe: d.groupe, icone: d.icone, raccourci: d.raccourci }));
}
function vueAutorisee(v) {
  if (!E.monde) return false;
  if (v === 'carte' || v === 'matin' || v === 'compte' || v === 'tableau' || v === 'pipeline' || v === 'progression') return true;
  if (v === 'reglages' || v === 'accueil') return Boolean(E.monde.profil.peutAdministrer);
  if (/^(role|famille|type):/.test(v)) return true;
  if (v.startsWith('dep:')) return E.monde.objets.some((o) => o.id === v.slice(4));
  return Boolean(placeDeVue(navigation(), v));
}
function objetsDeVue(vue) {
  const [genre, cle] = vue.split(':');
  const m = E.monde;
  if (genre === 'role') return m.objets.filter((o) => o.famille === 'tiers' && o.roles.some((r) => r.id === cle));
  if (genre === 'famille') return m.objets.filter((o) => o.famille === cle);
  if (genre === 'type') return m.objets.filter((o) => o.type === cle);
  return [];
}

// ---------------------------------------------------------------- simplicité : le menu grandit avec l'entreprise
/* web/simplicite.js (module pur) dit quelle rubrique est débloquée par ce que l'entreprise a déjà, jamais par des
   points. Ici : le menu montré (rail, onglets du téléphone, sous-navigation), l'interrupteur « Tout afficher » (par
   personne, gardé sur l'appareil) et la note lue une fois à l'ouverture d'une rubrique qui vient d'apparaître.
   Les droits ne changent pas : navigation() et vueAutorisee() restent complets, si bien que la recherche, les
   raccourcis, les liens directs et les messages ouvrent toujours tout. */
const STOCKAGE_LOCAL = { getItem: lireLocal, setItem: ecrireLocal };
const toutAffiche = () => Boolean(E.simplicite.tout);
/** Une rubrique est-elle à montrer ? Débloquée par les données, ou « Tout afficher ». */
const rubriqueMontree = (id) => toutAffiche() || E.deblocages[id] !== false;
/** Le menu tel qu'on le montre : rubriques débloquées, celle où l'on est, celles où quelque chose est dû. */
function menuMontre() {
  return SIMPLE.menuAffiche(navigation(), E.deblocages, { tout: toutAffiche(), vue: E.vue });
}
function piedMenu() {
  return SIMPLE.entreesAffichees(piedNavigation(E.monde), E.deblocages, { tout: toutAffiche(), vue: E.vue });
}
/** Entrées du menu qui attendent encore leurs données (sans elles, « Tout afficher » n'aurait rien à montrer de plus). */
const rubriquesEnAttente = () => SIMPLE.entreesEnAttente(navigation(), piedNavigation(E.monde), E.deblocages);
/** Rubrique de la vue courante : l'entrée du menu, ou la vue elle-même (« pipeline », « progression »). */
function rubriqueDeVue(vue = E.vue) {
  if (vue === 'pipeline' || vue === 'progression') return vue;
  return destinations(navigation(), piedNavigation(E.monde)).find((e) => estCourante(e, vue))?.id ?? null;
}
const sauverSimplicite = () => SIMPLE.ecrirePreferences(STOCKAGE_LOCAL, E.monde.profil.id, E.simplicite);
/** Notes et mentions « Nouveau » : jamais sur l'exemple fictif, ni en simulation, ni en aperçu d'une autre personne. */
const notesActives = () => Boolean(E.monde) && !E.monde.organisation.demo && E.monde.mode !== 'simulation' && !E.apercu && Array.isArray(E.simplicite.vues);
const rubriquesNouvelles = () => (notesActives() ? SIMPLE.nouvelles(E.deblocages, E.simplicite) : []);

/**
 * À chaque lecture du monde : les choix de la personne, les rubriques débloquées, et celles qui viennent d'apparaître
 * (rendues pour être annoncées une fois l'écran à jour). À la première ouverture, ce qui est déjà débloqué est tenu
 * pour connu : une entreprise en place retrouve son menu, sans note sur ce qu'elle utilise déjà.
 */
function majSimplicite() {
  const m = E.monde;
  if (E.simpliciteDe !== m.profil.id) {
    E.simplicite = SIMPLE.lirePreferences(STOCKAGE_LOCAL, m.profil.id);
    E.simpliciteDe = m.profil.id;
    E.deblocagesReels = null;
  }
  E.deblocages = SIMPLE.deblocages(m);
  if (m.organisation.demo) E.deblocagesReels = null;
  if (m.organisation.demo || m.mode === 'simulation' || E.apercu) return [];
  const avant = E.deblocagesReels;
  E.deblocagesReels = E.deblocages;
  if (!Array.isArray(E.simplicite.vues)) {
    E.simplicite = { ...E.simplicite, vues: SIMPLE.repereDeDepart(E.deblocages) };
    sauverSimplicite();
    return [];
  }
  return SIMPLE.vientDeSOuvrir(avant, E.deblocages).filter((id) => !E.simplicite.vues.includes(id));
}
/** Rubriques qu'un autre message montre déjà (« 1 tâche préparée · Voir la tâche ») : pas de second message pour elles. */
const rubriquesDejaDites = new Set();
/** « Nouvelle rubrique dans votre menu : Clients. » — dit une fois, avec « Voir » ; rien si tout est déjà affiché. */
function annoncerRubriques(ids) {
  if (!ids?.length || toutAffiche()) return;
  const entrees = destinations(navigation(), piedNavigation(E.monde)).filter((e) => ids.includes(e.id) && !rubriquesDejaDites.has(e.id));
  if (!entrees.length) return;
  informer(`${entrees.length > 1 ? 'Nouvelles rubriques dans votre menu' : 'Nouvelle rubrique dans votre menu'} : ${SIMPLE.enumerer(entrees.map((e) => e.libelle))}.`, 'ok',
    { libelle: 'Voir', faire: () => changerVue(entrees[0].vue) });
}
/** « Tout afficher » : tout d'un geste, pour cette personne, sur cet appareil. Aucun droit ne change. */
function reglerToutAfficher(oui) {
  E.simplicite = { ...E.simplicite, tout: Boolean(oui) };
  sauverSimplicite();
  annoncer(oui ? 'Tout est affiché : le menu complet.' : 'Menu simple : seules les rubriques qui ont déjà des données sont affichées.');
  if (!$('#coque')) return;
  rendreBarre();
  rendreBanniere();
  if (E.vue === 'matin') rendreMatin();
  else if (E.vue === 'carte') rendreHud();
  else if (E.vue === 'tableau' || E.vue === 'pipeline') rendreVue();
}
/** Note d'une rubrique qui vient d'apparaître (§4.20) : à quoi elle sert, par quoi commencer. Lue une fois. */
function noteDeVue() {
  if (!notesActives()) return null;
  const id = rubriqueDeVue();
  if (!id || E.deblocages[id] !== true || E.simplicite.vues.includes(id)) return null;
  return { id, texte: SIMPLE.texteNote(id) };
}
function rangerNote(id) {
  if (!E.simplicite.vues.includes(id)) E.simplicite = { ...E.simplicite, vues: [...E.simplicite.vues, id] };
  sauverSimplicite();
  rendreBarre();
  annoncer('Note rangée. Elle reste dans Aide, « Les rubriques du menu ».');
  $('#zone')?.focus({ preventScroll: true }); // le bouton vient de disparaître : le focus va au contenu, jamais sur <body>
}
/** La note suit la vue, quel que soit le chemin pris (lien, raccourci, bouton d'une fiche) : rubrique quittée, note
    retirée ; rubrique nouvelle ouverte, note posée — sauf sous un bandeau de mode, qui garde la place. */
function suivreNote() {
  const affichee = $('#note-rubrique')?.getAttribute('data-rubrique') ?? null;
  const voulue = noteDeVue()?.id ?? null;
  if (affichee !== voulue && (affichee || !$('#banniere')?.childElementCount)) rendreBanniere();
}
/** La note se lit à la première ouverture (§4.20) : quand on quitte la rubrique, elle est rangée d'elle-même, sans
    geste. Un bandeau de mode qui prend sa place (simulation) ne la range pas : on n'a pas quitté la rubrique. */
function rangerNoteQuittee() {
  const affichee = $('#note-rubrique')?.getAttribute('data-rubrique') ?? null;
  if (!affichee || !notesActives() || rubriqueDeVue() === affichee || E.simplicite.vues.includes(affichee)) return;
  E.simplicite = { ...E.simplicite, vues: [...E.simplicite.vues, affichee] };
  sauverSimplicite();
}
/** Aide › Les rubriques du menu : ce que fait chaque rubrique, et quand elle rejoint le menu. Tout s'ouvre d'ici. */
function ouvrirRubriques() {
  const entrees = destinations(navigation(), piedNavigation(E.monde));
  const etat = h('span', { class: 'bz-interrupteur__etat', 'aria-hidden': 'true', texte: toutAffiche() ? 'Activé' : 'Désactivé' });
  const d = fenetre({ titre: 'Les rubriques du menu', taille: 'md', corps: [
    h('p', { texte: 'Votre menu grandit avec votre entreprise : une rubrique y entre quand elle a quelque chose à montrer. Rien n’est fermé : tout s’ouvre d’ici, ou par la recherche.' }),
    rubriquesEnAttente().length ? h('label', { class: 'bz-interrupteur' },
      h('input', { type: 'checkbox', role: 'switch', checked: toutAffiche(), onchange: (e) => { reglerToutAfficher(e.target.checked); etat.textContent = e.target.checked ? 'Activé' : 'Désactivé'; } }),
      h('span', { texte: 'Tout afficher' }), etat) : null,
    h('ul', { class: 'bz-liste-lieux', role: 'list' }, entrees.map((e) => {
      const r = SIMPLE.RUBRIQUES[e.id];
      const la = E.deblocages[e.id] !== false;
      return h('li', { class: 'bz-ligne-lieu' },
        h('span', { class: 'bz-cat bz-cat--carre', 'aria-hidden': 'true' }, icone(e.icone)),
        h('span', { class: 'bz-ligne-lieu__texte' },
          h('button', { type: 'button', class: 'bz-ligne-lieu__nom', onclick: () => { d.close(); setTimeout(() => changerVue(e.vue), 0); } }, e.libelle),
          r ? h('span', { class: 'bz-ligne-lieu__meta', texte: la ? r.sert : `${r.sert} ${r.regle}` }) : null),
        la ? h('span', { class: 'bz-badge bz-badge--ok' }, icone('check', { taille: 'sm' }), 'Dans votre menu') : h('span', { class: 'bz-badge' }, icone('clock', { taille: 'sm' }), 'Attend vos données'));
    })),
  ] });
}

/** Clic sur un lien de navigation : la vue change sans recharger ; ⌘ ou Ctrl + clic l'ouvre dans un nouvel onglet. */
function allerA(vue, e) {
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || (typeof e.button === 'number' && e.button !== 0))) return;
  e?.preventDefault();
  changerVue(vue);
}
function lienNav(e, { classe, infobulle = false, libelleClasse = 'bz-rail__libelle' }) {
  // « nouveau » : rubrique qui vient d'entrer dans le menu, tant que sa note n'est pas rangée (lu avec le nom).
  // Un nom long (« Breizhcosystem ») n'est jamais tronqué par la mention : elle se réduit alors à son icône, avec l'infobulle
  const precisions = [e.compte ? e.compteLibelle : null, e.nouveau ? 'nouveau' : null].filter(Boolean);
  const long = e.libelle.length > 12;
  const bulle = infobulle || (e.nouveau && long);
  return h('a', {
    class: classe, href: `#/${e.vue}`, cle: `${classe}-${e.id}`, 'aria-current': estCourante(e, E.vue) ? 'page' : false,
    'aria-label': precisions.length ? `${e.libelle}, ${precisions.join(', ')}` : null,
    'data-infobulle': bulle ? (e.nouveau ? `${e.libelle} (nouveau)` : e.libelle) : null, 'data-infobulle-place': bulle ? 'droite' : null,
    onclick: (ev) => allerA(e.vue, ev),
  }, icone(e.icone), h('span', { class: libelleClasse, texte: e.libelle }),
  e.nouveau && !infobulle ? h('span', { class: 'bz-badge', 'aria-hidden': 'true' }, long ? icone('sparkles', { taille: 'sm' }) : 'Nouveau') : null,
  e.compte ? h('span', { class: 'bz-compteur', 'aria-hidden': 'true', texte: texteCompteur(e.compte) }) : null);
}

function rendreRail() {
  const n = $('#rail');
  if (!n || !E.monde) return;
  const m = E.monde;
  const replie = railEffectif();
  $('#coque')?.setAttribute('data-rail', replie ? 'replie' : 'ouvert');
  const nouvelles = rubriquesNouvelles();
  const marquer = (e) => (nouvelles.includes(e.id) ? { ...e, nouveau: true } : e);
  const attente = rubriquesEnAttente().length;
  // seuls les groupes défilent (le pied reste à l'écran) : la liste est redessinée, sa position de défilement est gardée
  const defile = n.querySelector('.bz-rail__groupes')?.scrollTop ?? 0;
  remplir(n,
    h('div', { class: 'bz-rail__produit' },
      h('img', { src: '/symbole-living-business.svg', alt: replie ? MARQUE.jeu : '', width: '28', height: '28' }),
      h('span', { class: 'bz-rail__nom' }, h('strong', { texte: MARQUE.jeu }), h('span', { texte: sansDemo(m.organisation.nom) }))),
    h('ul', { class: 'bz-rail__groupes', role: 'list' }, menuMontre().map((g) => h('li', {},
      h('span', { class: 'bz-rail__intertitre bz-t-surtitre', 'aria-hidden': 'true', texte: g.libelle }),
      h('ul', { class: 'bz-rail__groupe', role: 'list', 'aria-label': g.libelle }, g.entrees.map((e) => h('li', {}, lienNav(marquer(e), { classe: 'bz-rail__lien', infobulle: replie }))))))),
    h('div', { class: 'bz-rail__pied' },
      // « Tout afficher » : toujours au même endroit, seulement s'il reste des rubriques qui attendent leurs données
      attente ? [
        h('label', { class: 'bz-rail__lien bz-interrupteur', 'data-infobulle': replie ? 'Tout afficher : aussi les rubriques qui attendent vos données' : 'Aussi les rubriques qui attendent vos données', 'data-infobulle-place': 'droite' },
          h('input', { type: 'checkbox', role: 'switch', cle: 'rail-tout-afficher', checked: toutAffiche(), 'aria-describedby': 'rail-tout-afficher-aide', onchange: (e) => reglerToutAfficher(e.target.checked) }),
          h('span', { class: 'bz-rail__libelle', texte: 'Tout afficher' })),
        h('span', { class: 'bz-visuellement-cache', id: 'rail-tout-afficher-aide', texte: `Montre aussi ${pluriel(attente, 'rubrique qui attend', 'rubriques qui attendent')} encore vos données. Sans cela, le menu ne montre que ce qui sert déjà.` }),
      ] : null,
      piedMenu().map((e) => (e.action === 'connecter'
        ? h('button', { type: 'button', class: 'bz-rail__lien', cle: 'rail-connecter', 'data-infobulle': replie ? e.libelle : null, 'data-infobulle-place': 'droite', onclick: () => ouvrirAssistant() },
          icone(e.icone), h('span', { class: 'bz-rail__libelle', texte: e.libelle }))
        : lienNav(e, { classe: 'bz-rail__lien', infobulle: replie }))),
      h('button', {
        type: 'button', class: 'bz-rail__lien bz-rail__replier', cle: 'rail-replier', 'aria-expanded': !E.railReplie, 'aria-controls': 'rail', 'aria-keyshortcuts': 'B',
        'data-infobulle': replie ? 'Déplier le menu (B)' : null, 'data-infobulle-place': 'droite', onclick: basculerRail,
      }, icone(E.railReplie ? 'panel-left' : 'panel-left-close'), h('span', { class: 'bz-rail__libelle', texte: E.railReplie ? 'Déplier le menu' : 'Replier le menu' }),
      h('kbd', { class: 'bz-raccourci', 'aria-hidden': 'true', texte: 'B' }))));
  const liste = n.querySelector('.bz-rail__groupes');
  if (liste) {
    liste.scrollTop = defile;
    // la rubrique ouverte reste visible dans la liste (sans faire défiler autre chose qu'elle)
    const ici = liste.querySelector('[aria-current="page"]');
    if (ici) {
      const a = ici.getBoundingClientRect();
      const b = liste.getBoundingClientRect();
      if (a.top < b.top) liste.scrollTop -= b.top - a.top;
      else if (a.bottom > b.bottom) liste.scrollTop += a.bottom - b.bottom;
    }
  }
}
function basculerRail() {
  if (!estOrdinateur()) return;
  E.railReplie = !E.railReplie;
  ecrireLocal('lb-rail', E.railReplie ? 'replie' : 'ouvert');
  masquerInfobulle();
  rendreRail();
  annoncer(E.railReplie ? 'Menu replié.' : 'Menu déplié.');
}

function titreCourant() {
  const dep = E.vue.startsWith('dep:') ? E.monde.objets.find((o) => o.id === E.vue.slice(4))?.nom ?? '' : '';
  const t = titreDeVue(navigation(), E.vue, { nomProfil: E.monde.profil.nom, departement: dep });
  if (t === MARQUE.jeu && estVueListe(E.vue)) { // liste hors du rail (prospects, tâches…) : le nom de la liste
    const [g, k] = E.vue.split(':');
    const u = E.monde.univers;
    return (g === 'role' ? u.roles.find((r) => r.id === k)?.pluriel : u.types.find((x) => (g === 'type' ? x.id === k : x.famille === k))?.pluriel) ?? t;
  }
  return t;
}
const initialeProfil = () => (prenomDe(E.monde.profil.nom) || sansDemo(E.monde.profil.nom) || '?').trim().slice(0, 1).toUpperCase();

/** En-tête : titre de la vue (« Bonjour Anna » sur Aujourd'hui), recherche ⌘K, Aide et Activité récente toujours au
    même endroit, avatar. Sur téléphone : symbole, titre et avatar seulement (le reste est dans « Plus »). */
function rendreEntete() {
  const n = $('#barre');
  if (!n || !E.monde) return;
  const titre = titreCourant();
  const salue = E.vue === 'carte' || E.vue === 'matin';
  remplir(n,
    h('img', { class: 'bz-entete__symbole', src: '/symbole-living-business.svg', alt: MARQUE.jeu, width: '28', height: '28' }),
    h(vueAvecTitre(E.vue) ? 'h1' : 'p', { class: `bz-entete__titre${salue ? ' bz-t-salutation' : ''}`, id: 'titre-vue', texte: titre }),
    salue ? h('span', { class: 'bz-entete__date', id: 'horloge', texte: horloge() }) : null,
    h('button', { type: 'button', class: 'bz-entete__recherche', cle: 'entete-recherche', 'aria-label': 'Rechercher ou faire une action', 'aria-keyshortcuts': 'Meta+K Control+K', onclick: () => ouvrirPalette() },
      icone('search'), h('span', { 'aria-hidden': 'true', texte: 'Rechercher ou faire une action…' }), h('kbd', { class: 'bz-raccourci', 'aria-hidden': 'true', texte: formater('$mod+k') })),
    h('div', { class: 'bz-entete__actions' },
      indicateurDirect(),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone bz-entete__outil', cle: 'entete-aide', 'aria-label': 'Aide', 'data-infobulle': 'Aide', onclick: ouvrirAide }, icone('circle-help')),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone bz-entete__outil', cle: 'entete-activite', 'aria-label': 'Activité récente', 'data-infobulle': 'Activité récente', onclick: () => ouvrirActivite() }, icone('bell')),
      h('button', {
        type: 'button', class: 'bz-bouton bz-bouton--fantome bz-entete__avatar', id: 'bouton-compte', 'aria-label': `Compte : ${sansDemo(E.monde.profil.nom)}`,
        'aria-expanded': estOuvert($('#menu-compte')), 'aria-controls': 'menu-compte', popovertarget: POPOVER_NATIF ? 'menu-compte' : null,
        onclick: POPOVER_NATIF ? null : () => (estOuvert($('#menu-compte')) ? cacher($('#menu-compte')) : ouvrirMenuCompte()),
      }, h('span', { class: 'bz-avatar', 'aria-hidden': 'true', texte: initialeProfil() }))));
  document.title = typo(titre === MARQUE.jeu ? MARQUE.jeu : `${titre} · ${MARQUE.jeu}`);
}

/** Menu du compte (popover) : identité, « Voir comme » en démonstration, simulation, apparence, réglages, et le
    commutateur d'écosystème Breizhcosystem (Living Business ↔ Breizhcosystem), toujours au même endroit (§4.1). */
function contenuMenuCompte() {
  const m = E.monde;
  const p = m.profil;
  const fermerPuis = (f) => () => { cacher($('#menu-compte')); setTimeout(f, 0); };
  const bouton = (ic, texte, f, extra = {}) => h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: fermerPuis(f), ...extra }, icone(ic), h('span', { texte }));
  const simu = m.mode === 'simulation';
  return [
    h('div', { class: 'bz-menu-compte__identite' },
      h('span', { class: 'bz-avatar', 'aria-hidden': 'true', texte: initialeProfil() }),
      h('div', {}, h('strong', { texte: sansDemo(p.nom) }), h('span', { texte: sansDemo(m.organisation.nom) }))),
    m.progression && !modeCalme() && rubriqueMontree('progression') ? h('div', { class: 'bz-menu-compte__section' }, barreProgression()) : null,
    E.connexion?.connexion !== 'comptes' && E.profilsDemo?.length ? h('div', { class: 'bz-menu-compte__section' },
      h('div', { class: 'bz-champ' },
        h('label', { class: 'bz-champ__libelle', for: 'voir-comme', texte: 'Voir comme (démonstration)' }),
        h('div', { class: 'bz-select' },
          h('select', { id: 'voir-comme', onchange: (e) => { cacher($('#menu-compte')); voirComme(e.target.value); } },
            E.profilsDemo.map((x) => h('option', { value: x.id, selected: x.id === p.id, texte: x.nom }))),
          icone('chevron-down')))) : null,
    h('div', { class: 'bz-menu-compte__section' },
      E.connexion?.connexion === 'comptes' ? bouton('user', 'Mon compte', () => changerVue('compte')) : null,
      p.peutAdministrer && (m.organisation.demo || (m.organisation.etapeAccueil ?? 0) < 6)
        ? bouton('list-checks', m.organisation.demo ? 'Créer mon entreprise' : 'Compléter mon entreprise', () => changerVue('accueil')) : null,
      h('label', { class: 'bz-interrupteur' },
        h('input', { type: 'checkbox', role: 'switch', checked: simu, 'aria-describedby': 'simu-aide', onchange: (e) => { cacher($('#menu-compte')); basculerSimulation(e.target.checked); } }),
        h('span', { texte: 'Mode simulation' }), h('span', { class: 'bz-interrupteur__etat', 'aria-hidden': 'true', texte: simu ? 'Activé' : 'Désactivé' })),
      h('span', { class: 'bz-champ__aide', id: 'simu-aide' }, 'Copie isolée : rien n’est écrit dans vos outils. ', h('kbd', { class: 'bz-raccourci', texte: formater('$mod+shift+s') })),
      bouton('sliders-horizontal', 'Apparence et accessibilité', ouvrirApparence),
      p.peutAdministrer ? bouton('settings', 'Réglages', () => changerVue('reglages')) : null,
      INVITE_INSTALLATION ? bouton('download', 'Installer l’application', installerApplication) : null),
    h('div', { class: 'bz-menu-compte__section', role: 'group', 'aria-labelledby': 'menu-compte-eco' },
      h('span', { class: 'bz-t-surtitre', id: 'menu-compte-eco', texte: MARQUE.mere }),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', 'aria-current': 'true', onclick: fermerPuis(() => undefined) },
        h('img', { src: '/symbole-living-business.svg', alt: '', width: '20', height: '20' }), h('span', { texte: `${MARQUE.jeu} · cette installation` })),
      p.peutAdministrer || p.voitScore ? bouton('bz-nexus', MARQUE.reseau, () => changerVue('nexus')) : null),
    E.connexion?.connexion === 'comptes' ? h('div', { class: 'bz-menu-compte__section' }, bouton('log-out', 'Se déconnecter', seDeconnecter)) : null,
  ];
}
function placerMenuCompte() {
  const menu = $('#menu-compte');
  const ancre = $('#bouton-compte');
  if (!menu || !ancre) return;
  const a = ancre.getBoundingClientRect();
  const r = menu.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  menu.style.top = `${Math.round(a.bottom + 4)}px`;
  menu.style.left = `${Math.round(Math.max(8, Math.min(a.right - r.width, vw - r.width - 8)))}px`;
}
function ouvrirMenuCompte() {
  const menu = $('#menu-compte');
  if (!menu || !E.monde) return;
  remplir(menu, contenuMenuCompte());
  montrer(menu);
  placerMenuCompte();
  $('#bouton-compte')?.setAttribute('aria-expanded', 'true');
}
function preparerMenuCompte(menu) {
  // ouverture native (popovertarget) : le contenu est construit juste avant l'affichage
  menu.addEventListener('beforetoggle', (e) => { if (e.newState === 'open' && E.monde) remplir(menu, contenuMenuCompte()); });
  menu.addEventListener('toggle', (e) => {
    const ouvert = e.newState === 'open';
    $('#bouton-compte')?.setAttribute('aria-expanded', String(ouvert));
    if (ouvert) { placerMenuCompte(); menu.querySelector('select, input, button')?.focus({ preventScroll: true }); }
  });
}

/** Barre à 5 onglets du téléphone : Aujourd'hui · Planning · Relations · Activité · Plus (§6.1 P1). */
function rendreOnglets() {
  const n = $('#onglets');
  if (!n || !E.monde) return;
  // le menu simple peut compter moins de 5 onglets (Aujourd'hui et Plus le premier jour) : ils se partagent la largeur
  const liste = ongletsTelephone(menuMontre(), E.vue, { dernieres: E.dernieres });
  n.style.gridTemplateColumns = liste.length < 5 ? `repeat(${liste.length}, minmax(0, 1fr))` : '';
  remplir(n, liste.map((o) => {
    const contenu = [
      h('span', { class: 'bz-onglets-bas__pilule', 'aria-hidden': 'true' }, icone(o.icone)),
      h('span', { class: 'bz-onglets-bas__libelle', texte: o.libelle }),
      o.compte ? h('span', { class: 'bz-compteur', 'aria-hidden': 'true', texte: texteCompteur(o.compte) }) : null,
    ];
    if (o.plus) return h('button', { type: 'button', class: 'bz-onglets-bas__lien', cle: 'onglet-plus', 'aria-current': o.courant ? 'page' : false, 'aria-haspopup': 'dialog', onclick: ouvrirPlus }, contenu);
    const vue = o.id === 'aujourdhui' ? vueAujourdhui() : o.vue;
    return h('a', { class: 'bz-onglets-bas__lien', href: `#/${vue}`, cle: `onglet-${o.id}`, 'aria-current': o.courant ? 'page' : false, 'aria-label': o.compte ? `${o.libelle}, ${o.compteLibelle}` : null, onclick: (e) => allerA(vue, e) }, contenu);
  }));
}
/** Téléphone : les destinations sœurs du groupe courant (Clients · Fournisseurs · Courrier · Satisfaction…). */
function rendreSousNav() {
  const n = $('#sous-nav');
  if (!n || !E.monde) return;
  const ici = placeDeVue(menuMontre(), E.vue);
  const g = ici && ici.groupe.entrees.length > 1 ? ici.groupe : null;
  remplir(n, g ? g.entrees.map((e) => h('a', { class: 'bz-puce', href: `#/${e.vue}`, cle: `sous-${e.id}`, 'aria-current': estCourante(e, E.vue) ? 'page' : false, onclick: (ev) => allerA(e.vue, ev) },
    icone(e.icone, { taille: 'sm' }), e.libelle, e.compte ? h('span', { class: 'bz-compteur', 'aria-label': e.compteLibelle, texte: texteCompteur(e.compte) }) : null)) : []);
}
/** « Plus » : la palette en feuille basse, avec ses places fixes, dans cet ordre (§4.2). */
function placesPlus() {
  const T = window.bzTheme;
  return [
    T ? { id: 'plein-soleil', titre: 'Plein soleil', icone: 'sun', presse: T.lire().pleinSoleil, basculer: () => { const oui = T.pleinSoleil(); annoncer(oui ? 'Plein soleil activé.' : 'Plein soleil désactivé.'); return oui; } } : null,
    { id: 'activite', titre: 'Activité récente', icone: 'bell', faire: () => ouvrirActivite() },
    { id: 'aide', titre: 'Aide', icone: 'circle-help', faire: ouvrirAide },
    E.monde.profil.peutAdministrer ? { id: 'reglages', titre: 'Réglages', icone: 'settings', faire: () => changerVue('reglages') } : { id: 'apparence', titre: 'Apparence', icone: 'sliders-horizontal', faire: ouvrirApparence },
    // après les quatre places fixes : la bascule du menu complet, s'il reste des rubriques qui attendent leurs données
    rubriquesEnAttente().length ? { id: 'tout-afficher', titre: 'Tout afficher', icone: 'menu', presse: toutAffiche(), basculer: () => { reglerToutAfficher(!toutAffiche()); document.querySelector('.bz-palette__champ')?.dispatchEvent(new Event('input')); return toutAffiche(); } } : null,
  ].filter(Boolean);
}
const ouvrirPlus = () => ouvrirPalette({ places: placesPlus() });

function rendreBarre() {
  if (!E.monde || !$('#coque')) return;
  rangerNoteQuittee();
  rendreRail();
  rendreEntete();
  rendreSousNav();
  rendreOnglets();
  suivreNote();
}

/** Aide : toujours au même endroit (en-tête sur ordinateur, place fixe de « Plus » sur téléphone, WCAG 3.2.6). */
function ouvrirAide() {
  const entrees = [
    ['list', 'Les rubriques du menu', ouvrirRubriques],
    ['keyboard', 'Raccourcis clavier', aideClavier, '?'],
    E.sceneEchec ? null : ['map', 'Visite guidée de la carte', () => demarrerVisite(true)],
    E.monde?.profil.peutAdministrer && !E.monde.organisation.demo ? ['list-checks', 'Premiers pas', ouvrirPremiersPas] : null,
    E.monde?.profil.peutAdministrer ? ['building-2', E.monde.organisation.demo ? 'Créer mon entreprise' : 'Compléter mon entreprise pas à pas', () => changerVue('accueil')] : null,
    ['sliders-horizontal', 'Apparence et accessibilité', ouvrirApparence],
    ['file-text', 'Licences et crédits', () => window.open('/licences.html', '_blank', 'noopener')],
    ['code-xml', LIBELLE_CODE_SOURCE, ouvrirCodeSource],
  ].filter(Boolean);
  const d = fenetre({ titre: 'Aide', taille: 'sm', corps: [h('ul', { class: 'bz-aide', role: 'list' }, entrees.map(([ic, texte, faire, touche]) => h('li', {},
    h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: () => { d.close(); setTimeout(faire, 0); } },
      icone(ic), h('span', { texte }), touche ? h('kbd', { class: 'bz-raccourci', 'aria-hidden': 'true', texte: touche }) : null))))] });
}

/** Bandeau de mode (§4.26) : un seul, celui de plus haute priorité ; les autres états s'y ajoutent en puces. */
function rendreBanniere() {
  const m = E.monde;
  if (!$('#banniere') || !m) return;
  // avis de sécurité pour les administrateurs (export complet fait par un autre administrateur) : jusqu'à « J'ai vu »
  const avis = !E.apercu ? (m.avisSecurite ?? [])[0] ?? null : null;
  // nouvelle version publiée (administrateurs) : « Plus tard » la masque jusqu'à la version suivante (cette session)
  const maj = !E.apercu && m.miseAJour && E.majMasquee !== m.miseAJour.version ? m.miseAJour : null;
  const etats = [
    m.mode === 'simulation' ? 'simulation' : null,
    E.apercu && E.session ? 'apercu' : null,
    avis ? 'securite' : null,
    maj ? 'maj' : null,
    m.organisation.demo && E.bandeauDemo ? 'exemple' : null,
  ].filter(Boolean);
  const PUCES = { simulation: 'Mode simulation', apercu: 'Aperçu', securite: 'Avis de sécurité', maj: 'Nouvelle version', exemple: 'Exemple' };
  const puces = etats.slice(1).map((e) => h('span', { class: 'bz-badge', texte: PUCES[e] }));
  const admin = m.profil.peutAdministrer;
  let bandeau = null;
  if (etats[0] === 'simulation') {
    bandeau = h('div', { class: 'bz-bandeau bz-bandeau--simulation' }, icone('flask-conical'),
      h('p', { class: 'bz-bandeau__texte' }, h('strong', { texte: 'Mode simulation : rien n’est enregistré.' }), ' Rien n’est écrit dans vos outils ni publié sur Breizhcosystem. Quitter restaure l’état réel.'),
      puces, h('div', { class: 'bz-bandeau__actions' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => basculerSimulation(false), texte: 'Quitter la simulation' })));
  } else if (etats[0] === 'apercu') {
    bandeau = h('div', { class: 'bz-bandeau bz-bandeau--attention' }, icone('eye'),
      h('p', { class: 'bz-bandeau__texte' }, h('strong', { texte: 'Aperçu.' }), ` Vous voyez exactement ce que voit « ${E.session.nom} ». Lecture seule : rien ne peut être modifié.`),
      puces, h('div', { class: 'bz-bandeau__actions' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => voirComme(null), texte: 'Revenir à ma vue' })));
  } else if (etats[0] === 'securite') {
    const quoi = avis.quoi === 'export_avec_acces' ? 'avec les accès aux logiciels connectés' : 'sans les accès aux logiciels connectés';
    bandeau = h('div', { class: 'bz-bandeau bz-bandeau--attention', role: 'status' }, icone('shield'),
      h('p', { class: 'bz-bandeau__texte' }, h('strong', { texte: 'Copie complète des données exportée.' }),
        ` Par ${avis.par}, le ${dateHeure(avis.le)}, ${quoi}. Pas prévu ? Changez les mots de passe${avis.quoi === 'export_avec_acces' ? ' et les clés des logiciels connectés' : ''}.`),
      puces, h('div', { class: 'bz-bandeau__actions' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: async () => {
        try { await api('POST', `/securite/avis/${avis.id}/vu`, {}); m.avisSecurite = (m.avisSecurite ?? []).filter((x) => x.id !== avis.id); rendreBanniere(); } catch (err) { if (!err.session) informer(err.message, 'erreur'); }
      }, texte: 'J’ai vu' })));
  } else if (etats[0] === 'maj') {
    bandeau = h('div', { class: `bz-bandeau ${maj.securite ? 'bz-bandeau--attention' : 'bz-bandeau--exemple'}`, role: 'status' }, icone(maj.securite ? 'shield' : 'sparkles'),
      h('p', { class: 'bz-bandeau__texte' }, h('strong', { texte: maj.securite ? `Correctif de sécurité : version ${maj.version} disponible.` : `Nouvelle version ${maj.version} disponible.` }), ` Vous avez la ${m.version}.`),
      puces, h('div', { class: 'bz-bandeau__actions' },
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => changerVue('reglages:a-propos'), texte: 'Comment mettre à jour' }),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone bz-bouton--sm', 'aria-label': 'Plus tard (masquer jusqu’à la version suivante)', 'data-infobulle': 'Plus tard', onclick: () => { E.majMasquee = maj.version; rendreBanniere(); } }, icone('x'))));
  } else if (etats[0] === 'exemple') {
    bandeau = h('div', { class: 'bz-bandeau bz-bandeau--exemple' }, icone('flask-conical'),
      // sur téléphone, une seule ligne (« Entreprise exemple. ») : l'en-tête et le bandeau ne mangent pas l'écran
      h('p', { class: 'bz-bandeau__texte' }, h('span', { class: 'bz-bandeau__long', texte: 'Vous explorez une entreprise ' }), h('span', { class: 'bz-bandeau__court', texte: 'Entreprise ' }), 'exemple.'),
      h('div', { class: 'bz-bandeau__actions' },
        // sur téléphone, ces deux-là sont ailleurs (première action d'« Aujourd'hui », palette) : le bandeau reste fin
        admin ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm bz-bandeau__secondaire', onclick: () => ouvrirAssistant(), texte: 'Utiliser mes données' }) : null,
        admin && m.organisation.exemples ? h('label', { class: 'bz-select bz-bandeau__secondaire' },
          h('span', { class: 'bz-visuellement-cache', texte: 'Changer d’exemple' }),
          h('select', { class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onchange: (e) => changerExemple(e.target.value) },
            Object.entries(m.organisation.exemples).map(([k, l]) => h('option', { value: k, selected: m.organisation.exemple === k, texte: l }))),
          icone('chevron-down', { taille: 'sm' })) : null,
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone bz-bouton--sm', 'aria-label': 'Masquer le bandeau d’exemple', 'data-infobulle': 'Masquer', onclick: () => { E.bandeauDemo = false; rendreBanniere(); } }, icone('x'))));
  } else {
    // aucun bandeau de mode : la note d'une rubrique qui vient d'entrer dans le menu, lue une fois (§4.20 ; jamais
    // pendant le bandeau d'exemple ni au démarrage, puisque le menu du premier jour est tenu pour connu)
    const note = noteDeVue();
    if (note) {
      bandeau = h('div', { class: 'bz-bandeau', id: 'note-rubrique', 'data-rubrique': note.id }, icone('lightbulb'),
        h('p', { class: 'bz-bandeau__texte' }, h('strong', { texte: `Nouveau : ${titreCourant()}.` }), ` ${note.texte}`),
        // sur téléphone, le bandeau ne passe pas à la ligne : le bouton se dit en un mot
        h('div', { class: 'bz-bandeau__actions' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', cle: 'note-rangee', onclick: () => rangerNote(note.id) },
          h('span', { class: 'bz-bandeau__long', texte: 'J’ai compris' }), h('span', { class: 'bz-bandeau__court', texte: 'Compris' }))));
    }
  }
  remplir($('#banniere'), bandeau);
}
/* Message bref en bas de l'écran (toast Breizhcosystem, §4.16) : 6 s au moins, pause au survol et au focus, lu par
   la région d'annonces, et noté dans « Activité récente ». Une erreur reste aussi écrite près de ce qui l'a causée. */
function informer(texte, type = '', action = null) {
  E.message = null;
  const ton = type === 'erreur' ? 'critique' : type === 'ok' ? 'ok' : type === 'attention' ? 'attention' : 'info';
  if (type) noter({ texte, ton });
  return toast({ texte, ton, action });
}

// ---------------------------------------------------------------- vues
/** Adresse d'une vue (#/planning, #/role:client, #/reglages:en-ligne) : lien partageable, Retour du navigateur. */
const adresseDeVue = () => `#/${adresseDepuisVue(E.vue === 'reglages' && E.sousReglages ? `reglages:${E.sousReglages}` : E.vue)}`;
function changerVue(v, { historique = true } = {}) {
  if (v.startsWith('reglages:')) { E.sousReglages = v.slice(9); v = 'reglages'; } else if (v === 'reglages') E.sousReglages = null;
  if (v === 'acces') { E.sousReglages = 'acces'; v = 'reglages'; }
  if (v === 'carte' && E.sceneEchec) v = 'matin';
  const avant = E.vue;
  E.vue = v;
  E.recherche = '';
  if (E.monde) {
    const ici = placeDeVue(navigation(), v);
    if (ici && ici.groupe.id !== 'aujourdhui') E.dernieres[ici.groupe.id] = v;
  }
  if (historique && $('#coque')) { const adresse = adresseDeVue(); if (location.hash !== adresse) history.pushState(null, '', adresse); }
  if ($('#page') && (avant !== v || v === 'reglages')) $('#page').scrollTop = 0; // une nouvelle vue s'ouvre en haut
  if (v === 'sante') ecrireLocal('lb-sante-vue', '1');
  rendreBarre();
  if (avant !== v && E.monde) {
    // le titre de la vue, suivi de la note quand elle est affichée (le lien d'évitement mène au contenu, après elle)
    const note = $('#note-rubrique') ? noteDeVue() : null;
    annoncer(note ? `${titreCourant()}. ${note.texte}` : titreCourant());
  }
  // venue de la palette ou d'un raccourci, la navigation ne laisse jamais le focus sur <body> : il va au contenu
  setTimeout(() => { if (document.activeElement === document.body && !document.querySelector('dialog[open]')) $('#zone')?.focus({ preventScroll: true }); }, 0);
  return rendreVue();
}
window.addEventListener('popstate', () => {
  if (!E.monde || !$('#coque')) return;
  const v = vueDepuisAdresse() ?? vueAujourdhui();
  if (v !== E.vue && `#/${adresseDepuisVue(v)}` !== adresseDeVue()) changerVue(v, { historique: false });
});
// Le rail (ordinateur ou tablette) et la feuille de la carte (téléphone) suivent la largeur de la fenêtre
for (const q of ['(min-width: 60em)', '(max-width: 37.49em)']) {
  matchMedia(q).addEventListener?.('change', () => { if (!E.monde || !$('#coque')) return; masquerInfobulle(); rendreBarre(); if (E.vue === 'carte') rendreHud(); });
}

async function rendreVue() {
  if (!vueAutorisee(E.vue)) {
    // adresse directe d'une vue absente ici (#/departements dans une petite entreprise, rôle sans accès) : on le dit,
    // et l'adresse, le titre et le rail suivent la vue réellement montrée
    const demandee = E.vue;
    E.vue = vueAujourdhui();
    if (E.monde && $('#coque')) {
      history.replaceState(history.state, '', adresseDeVue());
      rendreBarre();
      informer(demandee === 'departements' || demandee.startsWith('dep:')
        ? (E.monde.organisation.departements ? 'Ce département n’existe plus : voici Aujourd’hui.' : 'Votre entreprise n’est pas organisée en départements : voici Aujourd’hui. Vous pouvez la sectoriser dans Réglages › Entreprise.')
        : 'Cette page n’est pas disponible pour votre rôle : voici Aujourd’hui.', 'attention');
    }
  }
  const carte = E.vue === 'carte' && !E.sceneEchec;
  document.documentElement.toggleAttribute('data-vue-carte', carte); // les toasts passent au-dessus de la barre de la carte
  $('#scene').hidden = !carte;
  $('#hud').hidden = !carte;
  $('#page').hidden = carte;
  if (!carte) {
    if (E.vue === 'carte') E.vue = 'matin';
    if (E.vue === 'matin') return rendreMatin();
    if (E.vue === 'tableau') return rendreTableau();
    if (E.vue === 'pipeline') return rendrePipeline();
    if (E.vue === 'departements') return rendreDepartements();
    if (E.vue === 'planning') return rendrePlanning();
    if (E.vue === 'courrier') return rendreCourrier();
    if (E.vue === 'reglages') return rendreReglages();
    if (E.vue === 'compte') return rendreCompte();
    if (E.vue === 'accueil') return rendreAccueil();
    if (E.vue === 'satisfaction') return rendreSatisfaction();
    if (E.vue === 'optimiser') return rendreOptimiser();
    if (E.vue === 'sante') return rendreSante();
    if (E.vue === 'nexus') return rendreNexus();
    if (E.vue === 'progression') return rendreProgression();
    if (E.vue.startsWith('dep:')) return rendreDepartement(E.vue.slice(4));
    return rendreListe(E.vue);
  }
  rendreHud();
  if (!E.scene) {
    // image instantanée de la dernière visite (≤ 300 ms), puis la 3D prend le relais par un fondu (§5.10)
    const instantane = await afficherInstantane();
    // réseau faible : jamais les modèles 3D sur des données mobiles faibles ; bouton « Charger la carte 3D (4 Mo) »
    if (!E.charger3D && reseauFaible(navigator.connection)) { proposerChargement3D(instantane); return undefined; }
    try {
      const { creerScene } = await import('/scene.js');
      const chargement = instantane ? null : informer('Chargement de la maquette 3D…');
      const ouverture = lireLocal('lb-ouverture-carte') !== jourLocal();
      try {
        E.scene = await creerScene($('#scene'), {
          surSelection: (id) => (id ? selectionner(id) : fermerFiche()), surSurvol: survoler, annoncer, surCamera, zoneLibre,
          surPremiereImage: () => { fondreInstantane(); },
          qualite: lireLocal('lb-carte-qualite') ?? 'auto', heure: lireLocal('lb-carte-heure') ?? 'reelle',
          animations: lireLocal('lb-carte-animations') !== 'non' && !modeCalme(), ouverture, niveau: modeCalme() ? 0 : E.monde.progression?.niveau?.n ?? 1,
        });
      } finally { chargement?.fermer(); }
      if (ouverture) ecrireLocal('lb-ouverture-carte', jourLocal());
      rendreBanniere();
      rendreHud();
    } catch {
      fondreInstantane();
      E.sceneEchec = 'La 3D n’est pas disponible sur cet appareil : affichage en liste.';
      informer(E.sceneEchec);
      E.vue = 'matin';
      rendreBarre();
      return rendreVue();
    }
  }
  E.scene.maj(E.monde, { vue: E.vueCarte });
  ecrireLocal('lb-carte-vue', '1'); // « Premiers pas » : découvrir ma carte (plus de visite lancée d'office, §4.20)
  E.scene.selectionner(E.selection, false);
}

/** Survol d'un bâtiment (§5.6) : infobulle après 300 ms (nom, état en une ligne) ; l'action liée d'« Aujourd'hui » est surlignée. */
let survolTempo = 0;
function survoler(d) {
  for (const n of document.querySelectorAll('.bz-action[data-surligne]')) n.removeAttribute('data-surligne');
  if (d?.id) for (const n of document.querySelectorAll(`.bz-action[data-objet="${CSS.escape(d.id)}"]`)) n.setAttribute('data-surligne', '');
  const b = $('#infobulle');
  if (!b) return;
  clearTimeout(survolTempo);
  if (!d) { b.hidden = true; return; }
  const o = d.id === '__pavillon' ? null : E.monde.objets.find((x) => x.id === d.id);
  const s = trierSituations(E.monde.situations.filter((x) => x.objetId === d.id))[0];
  const p = o ? peintureDe(o) : null;
  const nom = d.id === '__pavillon' ? 'Phare Breizhcosystem' : sansDemo(d.nom);
  const etat = s ? s.description : d.id === '__pavillon' ? 'Votre accès au réseau des entreprises bretonnes' : p === 'platre' ? 'Pas encore renseigné' : p === 'perime' ? `${d.libelle} · mis à jour ${dateRelative(o.majLe)}` : d.libelle;
  const montrerBulle = () => {
    remplir(b, h('strong', { texte: nom }), h('span', { texte: etat }));
    b.hidden = false;
    b.style.left = `${d.x}px`;
    b.style.top = `${d.y}px`;
  };
  if (b.hidden) survolTempo = setTimeout(montrerBulle, 300); else montrerBulle();
}


// ---------------------------------------------------------------- image instantanée et réseau faible (§5.10)
/** Affiche l'image de la dernière visite, rangée sur l'appareil (Cache Storage) ; true si elle a été trouvée. */
async function afficherInstantane() {
  const scene = $('#scene');
  if (!scene || scene.querySelector('canvas') || typeof caches === 'undefined') return false;
  try {
    const r = await (await caches.open('lb-carte-instantanee')).match('/carte-instantanee');
    if (!r) return false;
    // adresse data: (la CSP admet img-src 'self' data:, pas blob:)
    const blob = await r.blob();
    const url = await new Promise((ok, ko) => { const f = new FileReader(); f.onload = () => ok(String(f.result)); f.onerror = ko; f.readAsDataURL(blob); });
    if (E.scene || scene.querySelector('canvas')) return false;
    scene.querySelector('.carte-instantanee')?.remove();
    scene.prepend(h('img', { class: 'carte-instantanee', src: url, alt: '', 'aria-hidden': 'true' }));
    return true;
  } catch {
    return false;
  }
}
/** Première image 3D : l'image instantanée s'efface par un fondu (--bz-d-3), puis disparaît. */
function fondreInstantane() {
  const img = $('#scene .carte-instantanee');
  if (!img) return;
  img.setAttribute('data-fondu', '');
  setTimeout(() => img.remove(), 400);
}
/** Réseau faible : l'image de la dernière visite reste sous « Aujourd'hui » (panneau ou feuille), avec le choix de charger la 3D. */
function proposerChargement3D(instantane) {
  E.avisReseau = { instantane };
  rendreHud();
}
function avisReseau() {
  return h('div', { class: 'hud-reseau bz-verre bz-pile', cle: 'hud-reseau', role: 'status' },
    h('p', { texte: E.avisReseau.instantane ? 'Connexion lente : voici la carte de votre dernière visite.' : 'Connexion lente : la carte 3D n’est pas chargée pour économiser vos données.' }),
    h('div', { class: 'bz-groupe-boutons' },
      // secondaire : l'action principale de la vue reste celle de la carte héros d'« Aujourd'hui » (P1)
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', cle: 'charger-3d', onclick: () => { E.charger3D = true; E.avisReseau = null; rendreVue(); } }, icone('download'), 'Charger la carte 3D (4 Mo)'),
      h('a', { href: '#/tableau', class: 'bz-bouton bz-bouton--fantome', onclick: (e) => allerA('tableau', e) }, icone('table'), 'Voir en liste')));
}

// ---------------------------------------------------------------- Tableau et Pipeline : la carte en liste (§5.1, §5.6)
const QUARTIERS_LISTE = [['entreprise', 'Mon entreprise'], ['clients', null], ['fournisseurs', null], ['nord', 'Clients et fournisseurs, partenaires'], ['prospects', null], ['autres', 'Autres relations']];
function enteteVueCarte(titre, texte) {
  return h('div', { class: 'bz-pile bz-vue-carte__tete' },
    segmentsVueCarte(),
    h('p', { class: 'bz-t-petit bz-texte-2', texte }),
    E.monde.organisation.demo ? h('span', { class: 'bz-badge' }, icone('flask-conical', { taille: 'sm' }), 'Exemple') : null);
}
function ligneLieu(o, sits) {
  const c = categorieDe(o);
  const s = trierSituations(sits)[0];
  const p = peintureDe(o);
  const etat = s ? s.description : p === 'platre' ? 'Pas encore renseigné' : p === 'perime' ? `mis à jour ${dateRelative(o.majLe)}` : 'Rien à signaler';
  const ton = s ? niveau(s) : null;
  return h('li', { class: 'bz-ligne-lieu', 'aria-current': E.selection === o.id ? 'true' : null },
    h('span', { class: `bz-cat bz-cat--${c.forme}`, 'aria-hidden': 'true' }, icone(c.icone)),
    h('span', { class: 'bz-ligne-lieu__texte' },
      h('button', { type: 'button', class: 'bz-ligne-lieu__nom', cle: `lieu-${o.id}`, onclick: () => selectionner(o.id) }, sansCoupure(sansDemo(o.nom))),
      h('span', { class: 'bz-ligne-lieu__meta', texte: `${o.libelleType ?? LIBELLES_CATEGORIE[c.categorie]} · ${etat}` })),
    ton ? h('span', { class: `bz-badge bz-badge--${ton === 'a_verifier' ? 'info' : ton}` }, icone(ICONE_TON[ton === 'a_verifier' ? 'info' : ton] ?? 'info', { taille: 'sm' }), ton === 'critique' ? 'À régler' : ton === 'attention' ? 'À traiter' : 'À vérifier') : null);
}
function rendreTableau() {
  const m = E.monde;
  const sitsPar = new Map();
  for (const s of m.situations) { if (!sitsPar.has(s.objetId)) sitsPar.set(s.objetId, []); sitsPar.get(s.objetId).push(s); }
  const visibles = m.objets.filter((o) => ['lieu', 'departement', 'personne', 'ressource', 'tiers', 'projet'].includes(o.famille)).filter(dansFiltre);
  const role = (id, d) => m.univers.roles.find((r) => r.id === id)?.pluriel ?? d;
  const titres = { clients: role('client', 'Clients'), fournisseurs: role('fournisseur', 'Fournisseurs'), prospects: role('prospect', 'Prospects') };
  const sections = QUARTIERS_LISTE.map(([q, t]) => [q, t ?? titres[q], visibles.filter((o) => (quartierDe(o) ?? 'autres') === q)]).filter(([, , l]) => l.length);
  remplir($('#page'), h('div', { class: 'bz-ecran bz-vue-carte' },
    enteteVueCarte('Liste des lieux', 'Tout ce que montre la carte, quartier par quartier. Choisissez un nom pour ouvrir sa fiche.'),
    filtreDepartements(),
    // carte encore vide (premier jour) : ce que la liste montrera, et une seule action
    !sections.length && E.filtreDep === 'tous' ? videRubrique(null, { titre: 'Votre carte est vide pour le moment.', texte: 'Ici : vos lieux, votre équipe, vos clients et vos fournisseurs, quartier par quartier.', action: boutonConnecter() }) : null,
    sections.map(([q, t, liste]) => h('section', { class: 'bz-pile', 'aria-labelledby': `quartier-${q}` },
      h('h2', { class: 'bz-t-titre-4', id: `quartier-${q}` }, t, h('span', { class: 'bz-texte-2 bz-t-petit', texte: ` · ${liste.length}` })),
      h('ul', { class: 'bz-liste-lieux', role: 'list' }, liste.sort((a, b) => (trierSituations(sitsPar.get(a.id) ?? []).length ? 0 : 1) - (trierSituations(sitsPar.get(b.id) ?? []).length ? 0 : 1) || a.nom.localeCompare(b.nom)).map((o) => ligneLieu(o, sitsPar.get(o.id) ?? []))))),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'quartier-nexus' },
      h('h2', { class: 'bz-t-titre-4', id: 'quartier-nexus', texte: 'Le phare Breizhcosystem' }),
      h('p', { class: 'bz-texte-2', texte: m.pavillon.message }))));
}
const valeurNum = (o, id) => { const v = o.champs.find((c) => c.id === id)?.valeur; return typeof v === 'number' ? v : null; };
const valeurTexte = (o, id) => { const c = o.champs.find((x) => x.id === id); return c ? (c.lien ? sansDemo(c.lien.nom) : c.valeur) : null; };
function rendrePipeline() {
  const m = E.monde;
  const FINAUX = ['livrée', 'facturée', 'refusé', 'annulée'];
  const statut = (o) => String(valeurTexte(o, 'statut') ?? '');
  const colonnes = [
    ['prospects', 'Prospects', m.objets.filter((o) => o.famille === 'tiers' && o.roles.some((r) => r.id === 'prospect'))],
    ['devis', 'Devis', m.objets.filter((o) => o.type === 'devis' && statut(o) !== 'refusé')],
    ['commandes', 'Commandes en cours', m.objets.filter((o) => o.type === 'commande_client' && !FINAUX.includes(statut(o)))],
    ['encaisser', 'À encaisser', m.objets.filter((o) => o.type === 'facture' && valeurTexte(o, 'payee') !== true)],
  ];
  const carte = (o) => {
    const montant = valeurNum(o, 'montant') ?? valeurNum(o, 'montant_ttc') ?? valeurNum(o, 'montant_ht');
    const client = valeurTexte(o, 'client');
    return h('li', { class: 'bz-carte-pipeline' },
      h('button', { type: 'button', class: 'bz-ligne-lieu__nom', cle: `pipeline-${o.id}`, onclick: () => selectionner(o.id) }, sansCoupure(sansDemo(o.nom))),
      h('span', { class: 'bz-ligne-lieu__meta', texte: [client, statut(o) || null].filter(Boolean).join(' · ') || o.libelleType }),
      montant !== null ? h('span', { class: 'bz-t-chiffre', texte: euros(montant) }) : null);
  };
  remplir($('#page'), h('div', { class: 'bz-ecran bz-vue-carte' },
    enteteVueCarte('Pipeline', 'Vos affaires en cours, du premier contact à la facture payée.'),
    // aucune affaire encore : un seul écran vide, plutôt que quatre colonnes « Rien pour le moment »
    colonnes.every(([, , l]) => !l.length) ? videRubrique('pipeline', { action: boutonConnecter() })
      : h('div', { class: 'bz-pipeline' }, colonnes.map(([k, t, l]) => h('section', { class: 'bz-pipeline__colonne', 'aria-labelledby': `pipeline-${k}` },
        h('h2', { class: 'bz-t-titre-4', id: `pipeline-${k}` }, t, h('span', { class: 'bz-texte-2 bz-t-petit', texte: ` · ${l.length}` })),
        l.length ? h('ul', { class: 'bz-pile', role: 'list' }, l.map(carte)) : h('p', { class: 'bz-texte-2 bz-t-petit', texte: 'Rien pour le moment.' }))))));
}
// ---------------------------------------------------------------- HUD de la carte (§5.6) : grille à zones, sans position magique
const PRESETS_CALQUES = {
  essentiel: { entreprise: true, clients: true, fournisseurs: true, partenaires: true, employes: true, presence: false, prenoms: true, stock: true, vehicules: true, alertes: true, noms: true, trafic: false, flux: false, toits: false },
  travail: { entreprise: true, clients: true, fournisseurs: true, partenaires: false, employes: true, presence: true, prenoms: true, stock: true, vehicules: true, alertes: true, noms: true, trafic: false, flux: true, toits: false },
  tout: { entreprise: true, clients: true, fournisseurs: true, partenaires: true, employes: true, presence: true, prenoms: true, stock: true, vehicules: true, alertes: true, noms: true, trafic: true, flux: true, toits: false },
};
/** Vue de la carte : Carte, Tableau (la même information en liste, §5.1 règle 3) ou Pipeline (relations commerciales). */
const VUES_CARTE = [['carte', 'Carte'], ['tableau', 'Tableau'], ['pipeline', 'Pipeline']];
const estVueCarte = (v) => v === 'carte' || v === 'tableau' || v === 'pipeline';
/** Aucune source réelle connectée (exemple ou carte vide) : « Connecter mes données » reste le bouton principal (§5.6). */
const sansSourceReelle = () => Boolean(E.monde?.profil.peutAdministrer) && (Boolean(E.monde.organisation.demo) || !E.monde.objets.some((o) => o.famille !== 'organisation'));

/** Un identifiant (« CC-221 », « F-041 ») n'est jamais coupé au trait d'union : posé dans une portion insécable. */
function sansCoupure(texte) {
  const t = String(texte ?? '');
  const parts = [];
  let i = 0;
  for (const m of t.matchAll(/[\p{L}\d]+(?:-[\p{L}\d]+)+/gu)) {
    if (!/\d/.test(m[0])) continue;
    parts.push(t.slice(i, m.index), h('span', { class: 'bz-insecable', texte: m[0] }));
    i = m.index + m[0].length;
  }
  parts.push(t.slice(i));
  return parts.filter((x) => x !== '');
}

function boutonCarte(ic, libelle, infobulle, faire, extra = {}) {
  return h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', 'aria-label': libelle, 'data-infobulle': infobulle, onclick: faire, ...extra }, icone(ic));
}
function segmentsVueCarte() {
  // menu simple : « Pipeline » rejoint la bascule avec la première affaire (web/simplicite.js) ; on y reste si l'on y est
  return h('div', { class: 'bz-segments', role: 'group', 'aria-label': 'Afficher' },
    VUES_CARTE.filter(([v]) => v !== 'pipeline' || E.vue === v || rubriqueMontree('pipeline'))
      .map(([v, t]) => h('button', { type: 'button', cle: `vue-carte-${v}`, 'aria-pressed': E.vue === v, onclick: () => { if (E.vue !== v) changerVue(v); } }, t)));
}
/** Calques, préréglages, légende et gestes : le même contenu dans le menu (ordinateur) et la feuille (téléphone). */
function contenuCalques() {
  const m = E.monde;
  const cal = E.scene?.etatCalques() ?? {};
  const u = m.univers;
  const calques = [
    ['clients', u.roles.find((r) => r.id === 'client')?.pluriel ?? 'Clients'], ['fournisseurs', u.roles.find((r) => r.id === 'fournisseur')?.pluriel ?? 'Fournisseurs'],
    ['partenaires', 'Partenaires et prospects'], ['employes', u.types.find((t) => t.famille === 'personne')?.pluriel ?? 'Équipe'], ['prenoms', 'Noms à l’intérieur'],
    ['presence', 'Présence'], ['stock', 'Stock'], ['vehicules', 'Véhicules'], ['flux', 'Commandes en cours'], ['alertes', 'Alertes'], ['noms', 'Noms des lieux'],
    ['trafic', 'Circulation'], ['toits', 'Toits fermés'],
  ];
  const appliquer = (etat) => { E.scene?.calques(etat); rendreHud(); };
  const actif = (k) => (k === 'toits' ? cal[k] === true : cal[k] !== false);
  const cat = (forme, ic) => h('span', { class: `bz-cat bz-cat--${forme} bz-cat--carte`, 'aria-hidden': 'true' }, icone(ic, { taille: 'sm' }));
  return [
    h('section', { class: 'bz-pile', 'aria-labelledby': 'titre-prereglages' },
      h('h3', { id: 'titre-prereglages', texte: 'Préréglages' }),
      h('div', { class: 'bz-calques' },
        h('button', { type: 'button', cle: 'preset-essentiel', onclick: () => appliquer(PRESETS_CALQUES.essentiel) }, 'L’essentiel'),
        h('button', { type: 'button', cle: 'preset-travail', onclick: () => appliquer(PRESETS_CALQUES.travail) }, 'Le travail en cours'),
        h('button', { type: 'button', cle: 'preset-tout', onclick: () => appliquer(PRESETS_CALQUES.tout) }, 'Tout'),
        h('button', { type: 'button', cle: 'preset-dessus', onclick: () => { E.scene?.vueDessus(); } }, 'Vue de dessus'))),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'titre-calques' },
      h('h3', { id: 'titre-calques', texte: 'Ce que la carte affiche' }),
      h('div', { class: 'bz-calques' }, calques.map(([k, titre]) => h('button', { type: 'button', cle: `calque-${k}`, 'aria-pressed': actif(k), onclick: () => appliquer({ [k]: !actif(k) }) }, icone('check'), titre)))),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'titre-legende' },
      h('h3', { id: 'titre-legende', texte: 'Légende' }),
      h('dl', { class: 'bz-legende-carte' },
        h('dt', {}, cat('goutte', 'building-2')), h('dd', { texte: 'Vos lieux' }),
        h('dt', {}, cat('hexagone', 'users')), h('dd', { texte: 'Équipe' }),
        h('dt', {}, cat('rond', 'handshake')), h('dd', { texte: 'Client' }),
        h('dt', {}, cat('carre', 'truck')), h('dd', { texte: 'Fournisseur' }),
        h('dt', {}, cat('losange', 'link')), h('dd', { texte: 'Partenaire' }),
        h('dt', {}, cat('rond-pointille', 'user-plus')), h('dd', { texte: 'Prospect (pas encore client)' }),
        h('dt', {}, cat('carre-pointille', 'package')), h('dd', { texte: 'Stock, véhicule, courrier, chantier' }),
        h('dt', {}, h('span', { class: 'bz-etiquette__alerte bz-etiquette__alerte--critique' }, icone('octagon-alert', { taille: 'sm' }))), h('dd', { texte: 'À régler' }),
        h('dt', {}, h('span', { class: 'bz-etiquette__alerte bz-etiquette__alerte--attention' }, icone('triangle-alert', { taille: 'sm' }))), h('dd', { texte: 'À traiter' }),
        h('dt', {}, h('span', { class: 'bz-etiquette__alerte' }, icone('circle-help', { taille: 'sm' }))), h('dd', { texte: 'À vérifier (donnée manquante ou ancienne)' })),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Ce qui ne repose sur aucune donnée réelle reste en plâtre blanc. Positions : mise en page ; circulation et flux : illustratifs.' })),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'titre-gestes' },
      h('h3', { id: 'titre-gestes', texte: matchMedia('(pointer: coarse)').matches ? TITRES_GESTES.tactile : TITRES_GESTES.souris }),
      h('ul', { class: 'bz-gestes' }, (matchMedia('(pointer: coarse)').matches ? GESTES.tactile : GESTES.souris).map((g) => h('li', { texte: g })))),
  ];
}
/** Mini-carte (§5.5) : plan 2D des quartiers en SVG, cadre de la vue courante ; un clic y emmène la caméra. */
const NS_SVG = 'http://www.w3.org/2000/svg';
function basculerMiniCarte(ouvrir) {
  E.miniCarte = ouvrir;
  ecrireLocal('lb-minicarte', ouvrir ? 'ouverte' : 'repliee');
  rendreHud();
  $(ouvrir ? '[data-cle="minicarte-replier"]' : '[data-cle="minicarte-ouvrir"]')?.focus();
}
function miniCarte({ repliable = false } = {}) {
  const plan = E.scene?.plan?.();
  if (!plan) return null;
  const { plateau: p, zones, centre } = plan;
  const w = p.x1 - p.x0;
  const hh = p.z1 - p.z0;
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('class', 'bz-minicarte__plan');
  svg.setAttribute('viewBox', `${p.x0} ${p.z0} ${w} ${hh}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', typo('Plan du port : touchez un quartier pour vous y rendre.'));
  const rect = (x0, z0, x1, z1, classe, zone) => { const r = document.createElementNS(NS_SVG, 'rect'); r.setAttribute('x', x0); r.setAttribute('y', z0); r.setAttribute('width', x1 - x0); r.setAttribute('height', z1 - z0); r.setAttribute('class', classe); if (zone) r.setAttribute('data-zone', zone); svg.append(r); };
  rect(p.x0, p.z0, p.x1, p.zCote, 'bz-minicarte__terre');
  rect(p.x0, p.zCote, p.x1, p.z1, 'bz-minicarte__mer');
  for (const [k, z] of Object.entries(zones)) rect(z.x0, z.z0, z.x1, z.z1, 'bz-minicarte__zone', k);
  rect(centre.x0, centre.z0, centre.x1, centre.z1, 'bz-minicarte__zone', 'centre');
  const vue = document.createElementNS(NS_SVG, 'path');
  vue.setAttribute('class', 'bz-minicarte__vue');
  vue.id = 'minicarte-vue';
  svg.append(vue);
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    E.scene?.allerA(p.x0 + ((e.clientX - r.left) / r.width) * w, p.z0 + ((e.clientY - r.top) / r.height) * hh);
  });
  majCadreMiniCarte(svg, E.scene.cadre());
  return h('div', { class: 'bz-minicarte bz-verre', cle: 'minicarte' },
    repliable ? h('div', { class: 'bz-minicarte__tete' }, h('span', { class: 'bz-t-label', texte: 'Plan du port' }),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone bz-bouton--sm', cle: 'minicarte-replier', 'aria-label': 'Replier la mini-carte', 'data-infobulle': 'Replier', onclick: () => basculerMiniCarte(false) }, icone('minimize-2'))) : null,
    svg);
}
function majCadreMiniCarte(svg, cadre) {
  const vue = svg?.querySelector?.('.bz-minicarte__vue') ?? $('#minicarte-vue');
  if (!vue || !cadre?.length) return;
  vue.setAttribute('d', `M${cadre.map(([x, z]) => `${x.toFixed(1)} ${z.toFixed(1)}`).join(' L')} Z`);
}
/** Zone de la carte laissée libre par le HUD (px) : le centre de la vue y est placé (scene.js). */
function zoneLibre() {
  const scene = $('#scene')?.getBoundingClientRect();
  if (!scene?.width) return { gauche: 0, bas: 0 };
  const panneau = $('#panneau-aujourdhui')?.getBoundingClientRect();
  const feuille = $('#feuille-carte')?.getBoundingClientRect();
  // rectangles du HUD, dans le repère du canvas : une étiquette qui passerait dessous est masquée
  const obstacles = [...document.querySelectorAll('#hud .hud-aujourdhui, #hud .commandes-carte, #hud .bz-boussole, #hud .bz-barre-carte, #hud .bz-minicarte, #hud .hud-minicarte-ouvrir, #hud .hud-haut > *, #hud .bz-feuille, #hud .hud-afficher')]
    .map((n) => n.getBoundingClientRect()).filter((r) => r.width && r.height)
    .map((r) => ({ x0: r.left - scene.left - 4, y0: r.top - scene.top - 4, x1: r.right - scene.left + 4, y1: r.bottom - scene.top + 4 }));
  return { gauche: panneau && !estTelephone() ? Math.max(0, panneau.right - scene.left) : 0, bas: feuille && estTelephone() ? Math.max(0, scene.bottom - feuille.top) : 0, obstacles };
}
/** Mouvement de caméra (scene.js) : boussole après une rotation, cadre de la mini-carte. */
let attenteCamera = 0;
function surCamera({ azimut, cadre }) {
  if (attenteCamera) return;
  attenteCamera = setTimeout(() => { attenteCamera = 0; }, 100);
  majCadreMiniCarte(null, cadre);
  const tourne = Math.abs(((azimut - Math.PI / 4 + Math.PI) % (2 * Math.PI)) - Math.PI) > 0.05;
  if (tourne && !E.boussole) { E.boussole = true; rendreHud(); }
  const aiguille = $('#boussole-aiguille');
  if (aiguille) aiguille.style.transform = `rotate(${(-azimut * 180) / Math.PI}deg)`;
}
function boussole() {
  if (!E.boussole) return null;
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.id = 'boussole-aiguille';
  for (const [d, rempli] of [['M12 3 15 12H9Z', true], ['M12 21 9 12h6Z', false]]) {
    const p = document.createElementNS(NS_SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', rempli ? 'currentColor' : 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('stroke-linejoin', 'round');
    svg.append(p);
  }
  return h('button', { type: 'button', class: 'bz-boussole bz-verre', cle: 'boussole', 'aria-label': 'Remettre le nord en haut', 'data-infobulle': 'Remettre le nord en haut', onclick: () => E.scene?.nord() }, svg);
}
function pleinEcran() {
  const z = $('#zone');
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  else z?.requestFullscreen?.().catch(() => informer('Le plein écran n’est pas disponible ici.'));
}
document.addEventListener('fullscreenchange', () => { if (E.vue === 'carte') rendreHud(); });
function basculerInterface() {
  E.hudMasque = !E.hudMasque;
  rendreHud();
  annoncer(E.hudMasque ? 'Interface de la carte masquée. H pour l’afficher.' : 'Interface de la carte affichée.');
  $(E.hudMasque ? '[data-cle="hud-afficher"]' : '[data-cle="hud-masquer"]')?.focus();
}
function menuCalques() {
  const id = 'menu-calques';
  const menu = h('div', { class: 'bz-menu-carte', id, popover: 'auto', role: 'dialog', 'aria-label': 'Calques et légende' }, contenuCalques());
  const bouton = h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', cle: 'hud-calques', popovertarget: POPOVER_NATIF ? id : null, 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-keyshortcuts': 'L',
    onclick: (e) => { if (POPOVER_NATIF) return; e.preventDefault(); estOuvert(menu) ? cacher(menu) : montrer(menu); } }, icone('layers'), 'Calques');
  // posé au-dessus du bouton, aligné sur lui et gardé dans la fenêtre (position écrite ici, par CSSOM)
  const poser = () => {
    const a = bouton.getBoundingClientRect();
    const r = menu.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    menu.style.left = `${Math.round(Math.max(8, Math.min(a.left, vw - r.width - 8)))}px`;
    menu.style.top = `${Math.round(Math.max(8, a.top - r.height - 8))}px`;
  };
  menu.addEventListener('toggle', (e) => { const ouvert = e.newState === 'open'; bouton.setAttribute('aria-expanded', String(ouvert)); E.calquesOuverts = ouvert; if (ouvert) poser(); });
  new MutationObserver(() => { if (menu.hasAttribute('data-ouvert')) poser(); }).observe(menu, { attributes: true, attributeFilter: ['data-ouvert'] });
  return [bouton, menu];
}

/** Ordinateur et tablette : « Aujourd'hui » en panneau de 360 px à gauche, la caméra en haut à droite, la barre d'outils
    en bas au centre. Téléphone : une seule feuille basse (Aujourd'hui · Calques · Légende) ouverte à 40 %. */
function rendreHud() {
  rendreHudInterne();
  E.scene?.recadrer?.();
}
function rendreHudInterne() {
  const hud = $('#hud');
  if (!hud || !E.monde) return;
  if (!E.scene && E.avisReseau) {
    // pas de 3D (réseau faible) : ni caméra ni outils de carte, seulement « Aujourd'hui » et l'avis
    if (estTelephone()) { E.ongletFeuille = 'aujourdhui'; remplir(hud, avisReseau(), feuilleCarte({ basculeVue: null, visite: null, camera: null })); }
    else remplir(hud, panneauAujourdhui(), avisReseau());
    return;
  }
  const m = E.monde;
  const basculeVue = m.organisation.departements ? h('div', { class: 'bascule-vue bz-segments bz-verre', role: 'group', 'aria-label': 'Organisation affichée' },
    h('button', { type: 'button', 'aria-pressed': E.vueCarte === 'entreprise', 'data-infobulle': 'Les lieux physiques : siège, sites, ateliers, entrepôts', onclick: () => changerVueCarte('entreprise'), texte: 'Par lieux' }),
    h('button', { type: 'button', 'aria-pressed': E.vueCarte === 'departements', 'data-infobulle': 'L’organisation : un bâtiment par département', onclick: () => changerVueCarte('departements') }, 'Par départements', h('span', { class: 'bz-texte-2', texte: ` · ${m.organisation.departements}` }))) : null;
  const sortirBatiment = E.scene?.estDedans() ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-verre', cle: 'hud-sortir', 'aria-keyshortcuts': 'Escape', onclick: () => { E.scene?.sortir(); rendreHud(); } }, icone('log-out'), 'Sortir') : null;
  const exemple = m.organisation.demo ? h('span', { class: 'bz-badge bz-verre', title: 'Données d’exemple' }, icone('flask-conical', { taille: 'sm' }), 'Exemple') : null;
  // Chaque geste a son bouton (WCAG 2.5.7) : zoom, pivoter, recentrer ; plein écran sur ordinateur
  const zoomAvant = () => boutonCarte('zoom-in', 'Zoom avant', 'Zoom avant (+)', () => E.scene?.zoomer(0.8));
  const zoomArriere = () => boutonCarte('zoom-out', 'Zoom arrière', 'Zoom arrière (−)', () => E.scene?.zoomer(1.25));
  const recentrer = () => boutonCarte('locate-fixed', 'Recentrer', 'Recentrer (0)', () => E.scene?.recentrer());
  const pivoter = () => [
    boutonCarte('rotate-ccw', 'Pivoter à gauche', 'Pivoter à gauche (Q)', () => E.scene?.tourner45(1)),
    boutonCarte('rotate-cw', 'Pivoter à droite', 'Pivoter à droite (E)', () => E.scene?.tourner45(-1)),
  ];
  const enPause = E.scene?.enPause() ?? false;
  const pause = () => boutonCarte(enPause ? 'play' : 'pause', enPause ? 'Reprendre les animations' : 'Mettre les animations en pause', enPause ? 'Reprendre les animations (Espace)' : 'Pause des animations (Espace)', () => { E.scene?.pause(); rendreHud(); }, { 'aria-pressed': enPause, cle: 'hud-pause' });
  const visite = E.visite !== null ? rendreVisite() : null;
  // « Connecter mes données » reste visible tant qu'aucune source n'est connectée (§5.6), mais une vue n'a qu'un bouton
  // principal (P1, §4.5) : s'il y a déjà celui de la carte héros d'« Aujourd'hui » (panneau ouvert), il passe en secondaire
  const herosPrincipal = !estTelephone() && !E.matinReduit && !(Boolean(E.selection) && !E.panneauMalgreFiche && !matchMedia('(min-width: 100em)').matches) && Boolean(planCourant().heros?.bouton);
  const connecter = sansSourceReelle() ? h('button', { type: 'button', class: `bz-bouton ${herosPrincipal ? 'bz-bouton--secondaire' : 'bz-bouton--principal'}`, cle: 'hud-connecter', onclick: () => ouvrirAssistant() }, icone('plug'), 'Connecter mes données') : null;
  // un nouveau rendu (calques, mise à jour en direct) garde la position de lecture de la feuille ou du panneau
  const defile = $('#feuille-corps')?.scrollTop ?? $('#panneau-aujourdhui')?.scrollTop ?? 0;
  const garderDefilement = () => { const n = $('#feuille-corps') ?? $('#panneau-aujourdhui'); if (n && defile) n.scrollTop = defile; };
  hud.toggleAttribute('data-masque', Boolean(E.hudMasque));
  if (E.hudMasque) {
    remplir(hud, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-verre hud-afficher', cle: 'hud-afficher', 'aria-keyshortcuts': 'H', onclick: basculerInterface }, icone('eye'), 'Afficher l’interface'));
    return;
  }
  if (estTelephone()) {
    const camera = h('div', { class: 'camera-feuille', role: 'group', 'aria-label': 'Caméra' }, pivoter(), boutonCarte('layout-grid', 'Vue de dessus', 'Vue de dessus (P)', () => E.scene?.vueDessus()), pause());
    const calquesOuverts = E.ongletFeuille !== 'aujourdhui';
    const basculerCalques = () => { E.ongletFeuille = calquesOuverts ? 'aujourdhui' : 'calques'; if (E.cranFeuille === 'poignee') E.cranFeuille = 'mi'; rendreHud(); };
    remplir(hud,
      h('div', { class: 'hud-haut' }, sortirBatiment, boussole()),
      h('div', { class: 'commandes-carte bz-verre', role: 'group', 'aria-label': 'Carte' }, zoomAvant(), zoomArriere(), recentrer(),
        boutonCarte('layers', 'Calques et légende', 'Calques et légende (L)', basculerCalques, { 'aria-pressed': calquesOuverts })),
      feuilleCarte({ basculeVue, visite, camera }));
    garderDefilement();
    return;
  }
  const [boutonCalques, menu] = menuCalques();
  remplir(hud,
    panneauAujourdhui(),
    h('div', { class: 'hud-haut' }, sortirBatiment, basculeVue, exemple),
    h('div', { class: 'hud-droite' },
      h('div', { class: 'commandes-carte bz-verre', role: 'group', 'aria-label': 'Caméra' }, zoomAvant(), zoomArriere(), pivoter(), recentrer(),
        boutonCarte(document.fullscreenElement ? 'minimize' : 'maximize', document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran', document.fullscreenElement ? 'Quitter le plein écran' : 'Plein écran', pleinEcran)),
      boussole()),
    E.miniCarte !== false ? miniCarte({ repliable: true }) : h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-verre hud-minicarte-ouvrir', cle: 'minicarte-ouvrir', onclick: () => basculerMiniCarte(true) }, icone('map'), 'Mini-carte'),
    h('div', { class: 'hud-bas' },
      visite,
      h('div', { class: 'bz-barre-carte bz-verre', role: 'toolbar', 'aria-label': 'Outils de la carte' },
          boutonCalques,
          h('span', { class: 'bz-barre-carte__sep', 'aria-hidden': 'true' }),
          segmentsVueCarte(),
          connecter ? [h('span', { class: 'bz-barre-carte__sep', 'aria-hidden': 'true' }), connecter] : null,
          h('span', { class: 'bz-barre-carte__sep', 'aria-hidden': 'true' }),
          pause(),
          boutonCarte('eye-off', 'Masquer l’interface', 'Masquer l’interface (H)', basculerInterface, { cle: 'hud-masquer', 'aria-keyshortcuts': 'H' })),
      menu));
  garderDefilement();
}

/** Panneau « Aujourd'hui » posé sur la carte (ordinateur) : carte héros, 3 actions, anneau de 40 px, « Tout voir ». */
function panneauAujourdhui() {
  // une fiche ouverte à côté de la carte (moins de 1 600 px de large) : le panneau se replie de lui-même, sans changer
  // la préférence ; « Aujourd'hui » le rouvre
  const parFiche = Boolean(E.selection) && !E.panneauMalgreFiche && !matchMedia('(min-width: 100em)').matches;
  if (E.matinReduit || parFiche) {
    const n = planCourant().aFaire;
    return h('button', { type: 'button', class: 'bz-pastille-carte bz-verre hud-aujourdhui', cle: 'panneau-deplier', 'aria-expanded': 'false', onclick: () => reduirePanneau(false) },
      icone('house'), 'Aujourd’hui', n ? h('span', { class: 'bz-compteur', 'aria-hidden': 'true', texte: texteCompteur(n) }) : null,
      n ? h('span', { class: 'bz-visuellement-cache', texte: `, ${pluriel(n, 'action à faire', 'actions à faire')}` }) : null);
  }
  return h('section', { class: 'bz-panneau-carte bz-verre hud-aujourdhui', id: 'panneau-aujourdhui', 'aria-labelledby': 'titre-panneau-aujourdhui' },
    h('div', { class: 'bz-panneau-carte__tete' },
      h('h2', { class: 'bz-t-surtitre', id: 'titre-panneau-aujourdhui', texte: 'Aujourd’hui' }),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone bz-bouton--sm', cle: 'panneau-replier', 'aria-label': 'Replier « Aujourd’hui »', 'aria-expanded': 'true', 'aria-controls': 'panneau-aujourdhui', 'data-infobulle': 'Replier', onclick: () => reduirePanneau(true) }, icone('minimize-2'))),
    contenuAujourdhui('panneau'));
}
function reduirePanneau(oui) {
  E.matinReduit = oui;
  E.panneauMalgreFiche = !oui && Boolean(E.selection);
  ecrireLocal('lb-panneau-aujourdhui', oui ? 'replie' : 'ouvert');
  rendreHud();
  $(oui ? '[data-cle="panneau-deplier"]' : '[data-cle="panneau-replier"]')?.focus();
}

/** Feuille basse du téléphone (§5.6) : 3 crans (poignée seule, 40 %, 90 %), glisser doublé de boutons. */
const TITRES_FEUILLE = { aujourdhui: 'Aujourd’hui', calques: 'Calques', legende: 'Légende' };
const LIBELLE_POIGNEE = { poignee: 'Ouvrir le panneau', mi: 'Agrandir le panneau', plein: 'Réduire le panneau à la poignée' };
const CRAN_SUIVANT = { poignee: 'mi', mi: 'plein', plein: 'poignee' }; // toucher la poignée fait le tour des 3 crans
function feuilleCarte({ basculeVue, visite, camera }) {
  if (E.visite !== null && E.cranFeuille === 'poignee') E.cranFeuille = 'mi';
  const cran = E.cranFeuille;
  const onglet = E.ongletFeuille;
  const sections = onglet === 'aujourdhui' ? [] : contenuCalques();
  const corps = onglet === 'calques' ? [h('div', { class: 'bz-pile' }, segmentsVueCarte(), camera, basculeVue, miniCarte()), sections[0], sections[1]]
    : onglet === 'legende' ? [sections[2], sections[3]] : [visite, contenuAujourdhui('feuille')];
  const f = h('section', { class: 'bz-feuille', id: 'feuille-carte', 'data-cran': cran, 'aria-label': `Panneau : ${TITRES_FEUILLE[onglet]}` },
    h('button', { type: 'button', class: 'bz-feuille__poignee', cle: 'feuille-poignee', 'aria-label': LIBELLE_POIGNEE[cran], 'aria-expanded': cran !== 'poignee', 'aria-controls': 'feuille-corps' }),
    // « Aujourd'hui » prend toute la feuille (héros et actions au pouce) ; le choix Calques · Légende n'apparaît
    // qu'une fois ouvert par le bouton Calques du groupe flottant
    onglet !== 'aujourdhui' ? h('div', { class: 'bz-feuille__barre' },
      h('div', { class: 'bz-segments', role: 'group', 'aria-label': 'Contenu du panneau' },
        Object.entries(TITRES_FEUILLE).map(([k, t]) => h('button', { type: 'button', cle: `feuille-${k}`, 'aria-pressed': onglet === k, onclick: () => { E.ongletFeuille = k; if (E.cranFeuille === 'poignee') E.cranFeuille = 'mi'; rendreHud(); }, texte: t })))) : null,
    h('div', { class: 'bz-feuille__corps', id: 'feuille-corps' }, corps));
  glisserFeuille(f);
  return f;
}
function changerCran(c) {
  E.cranFeuille = c;
  const f = $('#feuille-carte');
  if (!f) return;
  f.setAttribute('data-cran', c);
  const p = f.querySelector('.bz-feuille__poignee');
  p?.setAttribute('aria-label', typo(LIBELLE_POIGNEE[c]));
  p?.setAttribute('aria-expanded', String(c !== 'poignee'));
  setTimeout(() => E.scene?.recadrer?.(), 400); // après la transition de la feuille
  if (c === 'poignee' && f.contains(document.activeElement) && document.activeElement !== p) p?.focus();
}
function glisserFeuille(f) {
  const p = f.querySelector('.bz-feuille__poignee');
  let depart = null;
  let glisse = false;
  p.addEventListener('click', () => {
    if (glisse) { glisse = false; return; }
    changerCran(CRAN_SUIVANT[E.cranFeuille] ?? 'mi');
  });
  p.addEventListener('pointerdown', (e) => { depart = { y: e.clientY, h: f.getBoundingClientRect().height, bouge: false }; glisse = false; try { p.setPointerCapture(e.pointerId); } catch { /* rien */ } });
  p.addEventListener('pointermove', (e) => {
    if (!depart) return;
    const dy = e.clientY - depart.y;
    if (!depart.bouge && Math.abs(dy) < 6) return;
    depart.bouge = true;
    f.setAttribute('data-glisse', '');
    const zone = f.parentElement?.getBoundingClientRect().height ?? 600;
    f.style.blockSize = `${Math.round(Math.max(48, Math.min(zone * 0.9, depart.h - dy)))}px`;
  });
  const fin = () => {
    if (!depart) return;
    const bouge = depart.bouge;
    depart = null;
    if (!bouge) return;
    glisse = true;
    const zone = f.parentElement?.getBoundingClientRect().height || 1;
    const part = f.getBoundingClientRect().height / zone;
    f.removeAttribute('data-glisse');
    f.style.blockSize = '';
    changerCran(part < 0.25 ? 'poignee' : part < 0.65 ? 'mi' : 'plein');
  };
  p.addEventListener('pointerup', fin);
  p.addEventListener('pointercancel', fin);
}

async function changerVueCarte(v) {
  E.vueCarte = v;
  rendreHud();
  E.scene?.maj(E.monde, { vue: v });
  E.scene?.recentrer();
  informer(v === 'departements' ? 'Vue par départements : un bâtiment par service, avec son équipe, ses tâches, ses dossiers.' : 'Vue entreprise : les lieux physiques.', 'ok');
}

async function changerExemple(jeu) {
  try {
    await api('POST', '/monde/exemple', { jeu });
    E.vueCarte = null;
    E.selection = null;
    E.fiche = null;
    await charger();
    informer(jeu === 'eti' ? 'Exemple : entreprise organisée en départements.' : 'Exemple : petite entreprise, d’un seul tenant.', 'ok');
  } catch (e) {
    informer(e.message, 'erreur');
  }
}

// ---------------------------------------------------------------- « Aujourd'hui » (ex-« Ce matin », §6.1 P2)
/* Trois étages, le même contenu partout (page en liste, feuille du téléphone, panneau de l'ordinateur) :
   (1) la carte héros « La chose à faire maintenant », premier élément ; (2) 3 à 5 actions, chacune traitable ou
   reportable (« Plus tard » la renvoie à demain, annulable) et repérée sur la carte ; (3) des tuiles homogènes (choses
   à régler) et l'anneau de santé, puis le reste replié. Le choix de ce qui s'affiche est fait par web/aujourdhui.js. */
const idDom = (t) => String(t).replace(/[^A-Za-z0-9_-]/g, '_');
function iconeEtat(ton, { taille = 'md', classe = '', decoratif = false } = {}) {
  const i = icone(ICONE_TON[ton] ?? 'info', { taille, classe: `bz-icone--etat ${classe}`.trim(), libelle: decoratif ? '' : LIBELLE_TON[ton] });
  i.setAttribute('data-ton', ton);
  return i;
}
function texteProvenance(p) {
  if (!p) return '';
  return [p.source, p.le ? dateRelative(p.le) : null, p.fraicheur === 'perimee' ? 'donnée périmée' : null].filter(Boolean).join(' · ');
}
function lienVers(vue, texte) {
  return h('a', { href: `#/${vue}`, class: 'bz-t-petit bz-lien-fleche', onclick: (e) => allerA(vue, e) }, texte, icone('arrow-right', { taille: 'sm' }));
}
function surligner(id) {
  E.scene?.surligner?.(id ?? null);
}
function premiersPasCourant() {
  return premiersPas(E.monde, { carte: lireLocal('lb-carte-vue') === '1', sante: lireLocal('lb-sante-vue') === '1' });
}

function faireAction(a) {
  if (a.type === 'connecter') return ouvrirAssistant();
  if (a.type === 'rien') return changerVue('sante');
  if (a.type === 'attente') return approuver(a.attente);
  // déjà prise en charge : on ouvre la tâche en cours, là où l'on est (ni nouvelle tâche, ni changement d'écran)
  if (a.suivi) return selectionner(a.suivi.tacheId);
  return ouvrirSurCarte(a.objetId, Boolean(a.direct));
}

const sauverReports = () => ecrireLocal('lb-plus-tard', JSON.stringify(E.reports));
function rafraichirAujourdhui() {
  rendreBarre();
  if (E.vue === 'matin') rendreMatin();
  else if (E.vue === 'carte') rendreHud();
}
/** « Plus tard » : l'action revient demain ; « Annuler » la remet tout de suite (toast et Activité récente). */
function reporter(a, mode, depuisHeros = false) {
  const jour = jourLocal();
  const liste = [...document.querySelectorAll(`[data-mode="${mode}"] .bz-action[data-cle-action]`)].map((n) => n.getAttribute('data-cle-action'));
  const suivante = liste[liste.indexOf(a.cle) + 1] ?? null;
  E.reports = { ...reportsValides(E.reports, jour), [a.cle]: lendemain(jour) };
  sauverReports();
  rafraichirAujourdhui();
  // le focus ne se perd pas : action suivante, sinon le titre de la pile, sinon l'action principale du héros
  const zone = document.querySelector(`[data-mode="${mode}"]`);
  const cible = depuisHeros ? zone?.querySelector('.bz-carte--heros .bz-bouton') : (suivante && zone?.querySelector(`[data-cle="${CSS.escape(`tard-${mode}-${suivante}`)}"]`)) ?? zone?.querySelector(`#pile-${mode}`) ?? zone?.querySelector('.bz-carte--heros .bz-bouton');
  cible?.focus();
  actionAnnulable({ texte: `Reporté à demain : ${a.titre}.`, libelle: `report de « ${a.titre} »`, annuler: () => remettre(a), refaire: () => reporter(a, mode) });
}
function remettre(a) {
  const reste = { ...E.reports };
  delete reste[a.cle];
  E.reports = reste;
  sauverReports();
  rafraichirAujourdhui();
}

function carteHeros(a, { mode, niv }) {
  const id = `heros-${mode}`;
  const probleme = a.ton === 'critique' || a.ton === 'attention';
  const surtitre = a.type === 'connecter' ? 'Pour commencer' : a.type === 'rien' ? 'Aujourd’hui' : 'À faire maintenant';
  const reportable = a.type === 'situation' || a.type === 'attente';
  return h('article', {
    class: 'bz-carte bz-carte--heros', 'aria-labelledby': id, 'data-objet': a.objetId ?? null,
    onpointerenter: a.objetId ? () => surligner(a.objetId) : null, onpointerleave: a.objetId ? () => surligner(null) : null,
  },
  h('p', { class: 'bz-carte__surtitre' }, probleme ? iconeEtat(a.ton, { taille: 'lg', decoratif: true }) : null, h('span', { texte: probleme ? `${surtitre} · ${LIBELLE_TON[a.ton]}` : surtitre })),
  h(niv, { class: 'bz-carte__titre', id, texte: a.titre }),
  a.texte ? h('p', { class: 'bz-carte__texte', texte: a.texte }) : null,
  a.preuve ? h('p', { class: 'bz-carte__preuve', texte: texteProvenance(a.preuve) }) : null,
  a.bouton || reportable || a.type === 'connecter' ? h('div', { class: 'bz-groupe-boutons' },
    a.bouton ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', cle: `${id}-principal`, 'aria-describedby': id, onclick: () => faireAction(a) },
      a.type === 'connecter' ? icone('plug') : null, a.bouton) : null,
    reportable ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', cle: `${id}-tard`, 'aria-describedby': id, onclick: () => reporter(a, mode, true) }, icone('clock'), 'Plus tard') : null,
    a.type === 'connecter' ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', cle: `${id}-pas-a-pas`, onclick: () => changerVue('accueil') }, E.monde.organisation.demo ? 'Créer mon entreprise' : 'Compléter mon entreprise pas à pas') : null) : null);
}

function ligneAction(a, mode) {
  const id = `action-${mode}-${idDom(a.cle)}`;
  const reportable = (a.type === 'situation' || a.type === 'attente') && !a.verifier && !a.revient && !a.suivi;
  // en cours : d'abord ce qui a été lancé (la tâche), puis le constat et sa source
  const detail = a.suivi ? a.suivi.texte : a.texte;
  const preuve = a.suivi ? [a.texte, a.preuve ? texteProvenance(a.preuve) : ''].filter(Boolean).join(' · ') : a.preuve ? texteProvenance(a.preuve) : a.contexte || '';
  return h('li', {
    class: 'bz-action', 'data-ton': a.ton, 'data-objet': a.objetId ?? null, 'data-cle-action': a.cle,
    onpointerenter: a.objetId ? () => surligner(a.objetId) : null, onpointerleave: a.objetId ? () => surligner(null) : null,
    onfocusin: a.objetId ? () => surligner(a.objetId) : null, onfocusout: a.objetId ? () => surligner(null) : null,
  },
  a.suivi ? icone('hourglass', { classe: 'bz-action__icone', libelle: 'En cours' }) : iconeEtat(a.ton, { classe: 'bz-action__icone' }),
  h('div', { class: 'bz-action__texte' },
    h('p', { class: 'bz-action__titre', id, texte: a.titre }),
    detail ? h('p', { class: 'bz-action__detail', texte: detail }) : null,
    preuve ? h('p', { class: 'bz-action__preuve', texte: preuve }) : null),
  h('div', { class: 'bz-action__boutons' },
    a.bouton ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', cle: `faire-${mode}-${a.cle}`, 'aria-describedby': id, onclick: () => faireAction(a) }, a.bouton) : null,
    reportable ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', cle: `tard-${mode}-${a.cle}`, 'aria-describedby': id, onclick: () => reporter(a, mode) }, icone('clock', { taille: 'sm' }), 'Plus tard') : null,
    a.revient ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', cle: `remettre-${mode}-${a.cle}`, 'aria-describedby': id, onclick: () => remettre(a) }, icone('undo-2', { taille: 'sm' }), 'Remettre aujourd’hui') : null));
}

/** Rubrique du menu que résume chaque tuile d'« Aujourd'hui » (clé de web/aujourdhui.js → clé de web/simplicite.js). */
const RUBRIQUE_TUILE = { factures: 'commandes', stock: 'stock', clients: 'clients', documents: 'documents', courrier: 'courrier', planning: 'planning' };
/** Tuiles (§4.9) : <dl>, toute la tuile est un lien ; valeur inconnue « — » et « Pas encore renseigné », jamais 0.
    Menu simple : seulement les tuiles des rubriques déjà dans le menu ; aucune : pas de bloc (rien à résumer encore). */
function blocTuiles(mode) {
  const tuiles = tuilesARegler(E.monde, { filtre: dansFiltre }).filter((t) => rubriqueMontree(RUBRIQUE_TUILE[t.cle] ?? t.cle));
  if (!tuiles.length) return null;
  return h('div', { class: `bz-tuiles${mode === 'page' ? '' : ' bz-tuiles--compactes'}` }, tuiles.map((t) => {
    const id = `tuile-${mode}-${t.cle}`;
    const inconnu = t.valeur === null;
    return h('dl', { class: 'bz-tuile' },
      h('dt', {}, h('a', { class: 'bz-tuile__lien', href: `#/${t.vue}`, 'aria-describedby': id, onclick: (e) => allerA(t.vue, e), texte: t.libelle }),
        t.ton ? iconeEtat(t.ton, { taille: 'sm', classe: 'bz-tuile__etat' }) : null),
      h('dd', { class: 'bz-tuile__valeur bz-t-chiffre', id, 'data-inconnu': inconnu ? '' : null, 'data-certitude': inconnu ? 'absent' : null, texte: inconnu ? '—' : nombre(t.valeur) }),
      inconnu ? h('dd', { class: 'bz-tuile__note', texte: 'Pas encore renseigné' }) : null);
  }));
}

/** Anneau de santé (§4.10) en SVG : piste, arc du score (pointillés s'il est provisoire), anneau fin de la couverture. */
const SVG = 'http://www.w3.org/2000/svg';
function svg(balise, attributs = {}) {
  const n = document.createElementNS(SVG, balise);
  for (const [k, v] of Object.entries(attributs)) if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : String(v));
  return n;
}
function anneau(sante, { taille = 120 } = {}) {
  const A = anneauSante(sante);
  const tracer = !A.provisoire && A.score !== null && lireLocal('lb-anneau-jour') !== jourLocal(); // une fois par jour
  if (tracer) ecrireLocal('lb-anneau-jour', jourLocal());
  const dessin = svg('svg', { class: 'bz-anneau__svg', viewBox: '0 0 120 120', role: 'img', 'aria-label': typo(A.aria), focusable: 'false' });
  dessin.append(svg('circle', { class: 'bz-anneau__piste', cx: 60, cy: 60, r: RAYON_ANNEAU, 'stroke-width': 10 }));
  if (A.score) dessin.append(svg('path', { class: 'bz-anneau__arc', d: cheminArc(A.score / 100, RAYON_ANNEAU), 'stroke-width': 10, pathLength: 100, 'data-ton': A.ton, 'data-provisoire': A.provisoire, 'data-trace': tracer }));
  if (A.couverture > 0) dessin.append(svg('path', { class: 'bz-anneau__couverture', d: cheminArc(A.couverture, RAYON_COUVERTURE), 'stroke-width': 3 }));
  if (taille >= 72) {
    const score = svg('text', { class: 'bz-anneau__score', x: 60, y: 66, 'text-anchor': 'middle', 'font-size': 36 });
    score.textContent = A.score === null ? '—' : nombre(A.score);
    const sur = svg('text', { class: 'bz-anneau__sur', x: 60, y: 84, 'text-anchor': 'middle', 'font-size': 12 });
    sur.textContent = typo('sur 100');
    dessin.append(score, sur);
  }
  const petit = taille < 72;
  return h('a', { class: `bz-anneau${petit ? ' bz-anneau--40' : ''}`, href: '#/sante', 'data-infobulle': petit ? A.aria : null, onclick: (e) => allerA('sante', e) },
    dessin,
    petit ? null : h('span', { class: 'bz-anneau__texte', 'aria-hidden': 'true' },
      h('span', { class: 'bz-t-surtitre', texte: 'Santé de l’entreprise' }),
      h('span', { class: 'bz-anneau__palier' }, A.palier ? iconeEtat(A.palier.ton, { taille: 'sm', decoratif: true }) : null, A.libelle),
      h('span', { class: 'bz-anneau__note', texte: `${A.part} % des critères renseignés · Pas une notation de crédit` })));
}

/** Ce que fait chaque objectif des « Premiers pas » ; chacun a son lien profond (?etape=donnees, §4.20). */
const ETAPES_PREMIERS_PAS = ['nom', 'carte', 'donnees', 'equipe', 'sante'];
function allerEtapePremiersPas(id) {
  const actions = {
    nom: () => { if (E.accueil) E.accueil.etape = 0; changerVue('accueil'); },
    carte: () => changerVue('carte'),
    donnees: () => ouvrirAssistant(),
    equipe: () => { E.accueil ??= { etape: null, lignes: {}, envoi: false, erreur: null, nom: '', creation: { nom: '' } }; E.accueil.etape = ETAPES_ACCUEIL.findIndex(([k]) => k === 'equipe'); changerVue('accueil'); },
    sante: () => changerVue('sante'),
  };
  actions[id]?.();
}
/** Lien profond à l'arrivée (/?etape=donnees) : l'étape s'ouvre, puis l'adresse redevient propre. */
function etapeDemandee() {
  let id = null;
  try { id = new URLSearchParams(location.search).get('etape'); } catch { return; }
  if (!id || !ETAPES_PREMIERS_PAS.includes(id) || !E.monde?.profil.peutAdministrer) return;
  history.replaceState(null, '', `/${location.hash}`);
  setTimeout(() => allerEtapePremiersPas(id), 0);
}
function listePremiersPas(pp) {
  return h('ul', { class: 'bz-premiers-pas', role: 'list' }, pp.etapes.map((e) => h('li', { 'data-fait': e.fait ? '' : null },
    e.fait ? iconeEtat('ok', { decoratif: true }) : icone('circle'),
    e.impossible ? h('span', { class: 'bz-premiers-pas__titre', id: `pp-${e.id}`, texte: e.titre })
      : h('a', { href: `/?etape=${e.id}`, class: 'bz-bouton bz-bouton--lien bz-premiers-pas__titre', id: `pp-${e.id}`, 'aria-describedby': `pp-${e.id}-statut`, onclick: (ev) => { ev.preventDefault(); document.querySelector('dialog.bz-premiers-pas-dialogue')?.close(); allerEtapePremiersPas(e.id); } }, e.titre),
    h('span', { class: 'bz-premiers-pas__statut', id: `pp-${e.id}-statut`, texte: e.fait ? e.statut : `${e.statut} · ${pluriel(e.minutes, 'minute', 'minutes')}` }))));
}
/** « Premiers pas » depuis l'Aide (toujours accessible, même terminé). */
function ouvrirPremiersPas() {
  const pp = premiersPasCourant();
  if (!pp) return;
  const d = fenetre({ titre: 'Premiers pas', taille: 'md', corps: [h('p', { texte: pp.fini ? 'Tout est fait. Vous pouvez revenir sur chaque étape quand vous voulez.' : `${pp.faites} sur ${pp.total}. ${pp.reste}` }), listePremiersPas(pp)] });
  d.classList.add('bz-premiers-pas-dialogue');
}
/** Fin des « Premiers pas » : une petite célébration, une seule fois, puis la carte disparaît d'« Aujourd'hui » (§4.20, §4.25). */
function celebrerPremiersPas() {
  const pp = premiersPasCourant();
  if (!pp) return;
  // on ne fête que ce qu'on a vu commencer sur cet appareil (pas une installation déjà en place)
  if (!pp.fini) { ecrireLocal('lb-premiers-pas-encours', '1'); return; }
  if (lireLocal('lb-premiers-pas-fini') === '1') return;
  ecrireLocal('lb-premiers-pas-fini', '1');
  if (lireLocal('lb-premiers-pas-encours') !== '1') return;
  informer('Premiers pas terminés ! Votre port est prêt. Trugarez.', 'ok');
  E.scene?.celebrer?.();
}
function cartePremiersPas(pp, { mode, niv }) {
  return h('section', { class: 'bz-carte', 'aria-labelledby': `pp-titre-${mode}` },
    h('div', { class: 'bz-carte__tete' },
      h('div', {}, h(niv, { class: 'bz-carte__titre', id: `pp-titre-${mode}`, texte: 'Premiers pas' }),
        h('p', { class: 'bz-carte__sous-titre', texte: `${pp.faites} sur ${pp.total}. ${pp.reste}` }))),
    listePremiersPas(pp));
}

function blocVitalite() {
  const v = E.monde.vitalite;
  return h('div', { class: 'bz-pile' },
    h('p', { class: 'bz-t-titre-3 bz-t-chiffre', 'data-certitude': v.calculable ? null : 'absent', texte: v.calculable ? `${v.score} sur 100` : '—' }),
    h('p', { class: 'bz-t-petit bz-texte-2', texte: v.calculable ? `Données couvertes : ${Math.round(v.couverture * 100)} %` : 'Pas encore calculable : données insuffisantes.' }),
    h('ul', { class: 'bz-liste-simple bz-t-petit', role: 'list' }, v.details.map((d) => h('li', { texte: `${d.libelle} : ${d.pris ? `${d.valeur} %` : { manquant: 'pas de donnée à jour (exclu, ne vaut pas 0)', perime: 'donnée périmée (exclue)', hors_bornes: 'hors bornes (exclu)' }[d.raison]}` }))),
    h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Part des objets dans les limites de chaque règle, sur données à jour. Ni notation de crédit, ni audit.' }));
}

/** Le reste, replié dans des <details name> exclusifs : on ouvre l'application pour savoir quoi faire. */
function replisAujourdhui(plan, pp, ppEnTete, mode) {
  const m = E.monde;
  const nom = `aujourdhui-${mode}`;
  const repli = (cle, titre, note, contenu, { ouvert = false } = {}) => h('details', {
    class: 'bz-repli', name: nom, id: `repli-${cle}-${mode}`, open: ouvert || E.replisOuverts.has(`${cle}-${mode}`),
    // une mise à jour en direct redessine l'écran : la section ouverte le reste
    ontoggle: (e) => { if (e.currentTarget.open) E.replisOuverts.add(`${cle}-${mode}`); else E.replisOuverts.delete(`${cle}-${mode}`); },
  },
    h('summary', {}, h('span', { class: 'bz-repli__titre', texte: titre }), note ? h('span', { class: 'bz-repli__note', texte: note }) : null, icone('chevron-down', { taille: 'sm' })),
    h('div', { class: 'bz-repli__corps' }, contenu));
  const bodacc = blocBodacc();
  const urgents = courriersUrgents(m);
  const quetes = m.quetes.filter((q) => q.statut === 'ouverte').length;
  return h('div', { class: 'bz-replis' },
    pp && !pp.fini && !ppEnTete ? repli('premiers-pas', 'Premiers pas', `${pp.faites} sur ${pp.total}`, listePremiersPas(pp)) : null,
    // menu simple : replié le premier jour (l'action principale est « Connecter mes données ») ; ouvert d'office avec « Tout afficher »
    plan.vide ? repli('construire', 'Ajouter mes données type par type', null, demarrage(), { ouvert: toutAffiche() }) : null,
    plan.autres.length ? repli('autres', 'Autres choses à régler', pluriel(plan.autres.length, 'action', 'actions'),
      h('ul', { class: 'bz-actions', role: 'list', 'data-mode': `${mode}-autres` }, plan.autres.map((a) => ligneAction(a, `${mode}-autres`)))) : null,
    plan.reportees.length ? repli('reportees', 'Reportées à demain', pluriel(plan.reportees.length, 'action', 'actions'),
      h('ul', { class: 'bz-actions', role: 'list' }, plan.reportees.map((a) => ligneAction(a, `${mode}-reportees`)))) : null,
    bodacc && (rubriqueMontree('clients') || m.bodacc?.actif) ? repli('annonces', 'Annonces légales', m.bodacc?.alertes?.length ? pluriel(m.bodacc.alertes.length, 'client en difficulté', 'clients en difficulté') : null, bodacc) : null,
    // menu simple : un repli n'apparaît qu'avec sa rubrique (pas de « Qui est où » sans équipe, ni de courrier sans courrier)
    rubriqueMontree('planning') ? repli('qui', 'Qui est où', null, [quiEstOu(), lienVers('planning', 'Ouvrir le planning')]) : null,
    rubriqueMontree('courrier') ? repli('courrier', 'Courrier', urgents ? pluriel(urgents, 'urgent', 'urgents') : null, [courrierDuMatin(), lienVers('courrier', 'Tout le courrier')]) : null,
    plan.aVerifier.length ? repli('verifier', 'À vérifier', 'données manquantes ou anciennes',
      h('ul', { class: 'bz-actions', role: 'list' }, plan.aVerifier.map((a) => ligneAction(a, `${mode}-verifier`)))) : null,
    modeCalme() || !rubriqueMontree('progression') ? null : repli('quetes', 'Quêtes du jour', quetes ? pluriel(Math.min(quetes, 3), 'quête', 'quêtes') : null, [blocQuetes({ niv: 'h3' }), lienVers('progression', 'Ma progression')]),
    !m.sante && m.vitalite ? repli('vitalite', 'Vitalité (privée)', m.vitalite.calculable ? `${m.vitalite.score} sur 100` : null, blocVitalite()) : null);
}

function contenuAujourdhui(mode) {
  const m = E.monde;
  const plan = planCourant();
  const pp = premiersPasCourant();
  const panneau = mode === 'panneau';
  const niv = panneau ? 'h3' : 'h2';
  const pile = panneau ? plan.pile.slice(0, ACTIONS_PANNEAU) : plan.pile;
  const reste = plan.pile.length - pile.length + plan.autres.length;
  const ppEnTete = Boolean(pp && !pp.fini && !plan.actionsReelles);
  // menu simple : le bilan ne montre que ce qui a déjà des données (tuiles et anneau) ; rien à résumer : pas de bilan
  const santeMontree = Boolean(m.sante) && rubriqueMontree('sante');
  const tuiles = panneau ? null : blocTuiles(mode);
  const voirReste = (e) => {
    if (panneau) return allerA('matin', e);
    e.preventDefault();
    const d = document.querySelector(`#repli-autres-${mode}`);
    if (d) { d.open = true; d.querySelector('summary')?.focus(); d.scrollIntoView({ block: 'nearest' }); }
  };
  return h('div', { class: 'bz-aujourdhui', 'data-mode': mode },
    carteHeros(plan.heros, { mode, niv }),
    ppEnTete && !panneau ? cartePremiersPas(pp, { mode, niv }) : null,
    !panneau ? filtreDepartements() : null,
    pile.length ? h('section', { class: 'bz-aujourdhui__section', 'aria-labelledby': `pile-${mode}` },
      h('div', { class: 'bz-aujourdhui__tete' },
        h(niv, { class: panneau ? 'bz-t-label' : 'bz-t-titre-4', id: `pile-${mode}`, tabindex: '-1', texte: 'À faire ensuite' }),
        reste > 0 ? h('a', { href: panneau ? '#/matin' : `#repli-autres-${mode}`, class: 'bz-t-petit bz-lien-cible', onclick: voirReste, texte: reste > 1 ? `Voir les ${reste} autres` : 'Voir l’autre' }) : null),
      h('ul', { class: 'bz-actions', role: 'list' }, pile.map((a) => ligneAction(a, mode)))) : null,
    // ce qui est déjà pris en charge : on en prend acte ici, on ne le redemande plus au-dessus
    plan.enCours.length ? (panneau
      ? h('p', { class: 'bz-aujourdhui__encours bz-t-petit' }, icone('hourglass', { taille: 'sm' }),
        h('a', { href: '#/matin', class: 'bz-lien-cible', onclick: (e) => allerA('matin', e), texte: `${pluriel(plan.enCours.length, 'action en cours', 'actions en cours')}, en attente du résultat` }))
      : h('section', { class: 'bz-aujourdhui__section', 'aria-labelledby': `encours-${mode}` },
        h('div', { class: 'bz-aujourdhui__tete' }, h('h2', { class: 'bz-t-titre-4', id: `encours-${mode}`, tabindex: '-1', texte: 'En cours, en attente du résultat' })),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Vous avez agi. Chaque ligne disparaîtra quand vos données montreront que c’est réglé.' }),
        h('ul', { class: 'bz-actions', role: 'list', 'data-mode': `${mode}-encours` }, plan.enCours.map((a) => ligneAction(a, `${mode}-encours`))))) : null,
    // « Premiers pas » aussi sur la carte (§4.20) : ouvert tant qu'aucune vraie action n'existe, replié en une ligne ensuite
    panneau && pp && !pp.fini ? h('details', { class: 'bz-repli', id: `repli-premiers-pas-${mode}`, open: (ppEnTete && !(E.replisFermes ??= new Set()).has(`premiers-pas-${mode}`)) || E.replisOuverts.has(`premiers-pas-${mode}`),
      ontoggle: (e) => { const k = `premiers-pas-${mode}`; E.replisFermes ??= new Set(); if (e.currentTarget.open) { E.replisOuverts.add(k); E.replisFermes.delete(k); } else { E.replisOuverts.delete(k); E.replisFermes.add(k); } } },
      h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Premiers pas' }), h('span', { class: 'bz-repli__note', texte: `${pp.faites} sur ${pp.total}` }), icone('chevron-down', { taille: 'sm' })),
      h('div', { class: 'bz-repli__corps' }, h('p', { class: 'bz-t-petit', texte: pp.reste }), listePremiersPas(pp))) : null,
    panneau
      ? h('div', { class: 'bz-panneau-carte__pied' },
        santeMontree ? anneau(m.sante, { taille: 40 }) : null,
        barreProgression({ compacte: true }),
        h('a', { href: '#/matin', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: (e) => allerA('matin', e) }, 'Tout voir', icone('arrow-right', { taille: 'sm' })))
      : [
        tuiles || santeMontree ? h('section', { class: 'bz-aujourdhui__section', 'aria-labelledby': `bilan-${mode}` },
          h('h2', { class: 'bz-t-titre-4', id: `bilan-${mode}`, texte: 'En un coup d’œil' }),
          h('div', { class: 'bz-aujourdhui__bilan' }, tuiles, santeMontree ? anneau(m.sante, { taille: 120 }) : null)) : null,
        replisAujourdhui(plan, pp, ppEnTete, mode),
        suggestionEnLigne(),
        mode === 'page' && !E.sceneEchec ? h('p', {}, lienVers('carte', 'Voir sur la carte')) : null,
      ]);
}

function rendreMatin() {
  remplir($('#page'), contenuAujourdhui('page'));
}

/** Suggestion unique (refermable) une fois l'entreprise en place : utiliser Living Business partout. */
function suggestionEnLigne() {
  const m = E.monde;
  if (!m.suggestionEnLigne || m.organisation.demo || lireLocal('lb-suggestion-en-ligne') === 'vue') return null;
  const enPlace = (m.organisation.etapeAccueil ?? 0) >= 6 || m.objets.filter((o) => o.famille !== 'organisation').length >= 15;
  if (!enPlace) return null;
  const masquer = async (ouvrir) => {
    ecrireLocal('lb-suggestion-en-ligne', 'vue');
    m.suggestionEnLigne = false;
    api('PUT', '/en-ligne/suggestion', { masquee: true }).catch(() => undefined);
    if (ouvrir) changerVue('reglages:en-ligne');
    else rendreVue();
  };
  return h('section', { class: 'bz-carte', 'aria-labelledby': 'titre-suggestion-en-ligne' },
    h('div', { class: 'bz-carte__tete' },
      h('h2', { class: 'bz-carte__titre', id: 'titre-suggestion-en-ligne' }, icone('smartphone'), ' Utiliser Living Business partout ?'),
      h('button', { class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', type: 'button', 'aria-label': 'Ne plus proposer', 'data-infobulle': 'Ne plus proposer', onclick: () => masquer(false) }, icone('x'))),
    h('p', { class: 'bz-carte__sous-titre', texte: 'Sur le téléphone, au chantier, à la maison : sans rien louer, ou sur un site à votre nom. Vos données restent chez vous.' }),
    h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--secondaire', type: 'button', onclick: () => masquer(true), texte: 'Mettre en ligne' })));
}

function quiEstOu() {
  const m = E.monde;
  const parLieu = new Map();
  for (const e of m.objets.filter((o) => o.famille === 'personne' && dansFiltre(o))) {
    const cle = e.jour ? (e.jour.type === 'lieu' || e.jour.type === 'projet' ? e.jour.libelle : e.jour.type === 'mission' ? 'En mission' : e.jour.type === 'absence' ? 'Absents' : 'Non affectés') : (m.objets.find((x) => x.id === e.lieu)?.nom ?? 'Sans lieu');
    if (!parLieu.has(cle)) parLieu.set(cle, []);
    parLieu.get(cle).push(e);
  }
  if (!parLieu.size) return blocVide({ titre: 'Aucune personne dans l’équipe.', compact: true });
  return h('ul', { class: 'bz-liste-simple', role: 'list' }, [...parLieu].map(([lieu, gens]) => h('li', { class: 'bz-qui-ou', 'data-hors': ['Absents', 'Non affectés'].includes(lieu) ? '' : null },
    h('p', { class: 'bz-t-label' }, sansDemo(lieu), h('span', { class: 'bz-t-micro bz-texte-2', texte: ` · ${pluriel(gens.length, 'personne', 'personnes')}` })),
    h('p', { class: 'bz-qui-ou__noms' }, gens.map((e) => h('button', { type: 'button', class: 'bz-lien', onclick: () => ouvrirSurCarte(e.id), texte: sansDemo(e.nom) }))))));
}

function courrierDuMatin() {
  const mails = E.monde.objets.filter((o) => o.type === 'courrier' && valeurDe(o, 'statut') !== 'traité' && dansFiltre(o))
    .sort((a, b) => (RANG_URGENCE[valeurDe(a, 'urgence')] ?? 1) - (RANG_URGENCE[valeurDe(b, 'urgence')] ?? 1)).slice(0, 5);
  if (!mails.length) return blocVide({ titre: 'Rien à traiter.', compact: true });
  return h('ul', { class: 'bz-liste-simple', role: 'list' }, mails.map((o) => h('li', { class: 'bz-qui-ou' },
    h('p', { class: 'bz-t-label' }, valeurDe(o, 'expediteur') ?? '', valeurDe(o, 'urgence') === 'haute' ? h('span', { class: 'bz-badge bz-badge--critique' }, icone('octagon-alert', { taille: 'sm' }), 'Urgent') : null),
    h('p', { class: 'bz-t-petit', texte: valeurDe(o, 'objet') ?? o.nom }),
    valeurDe(o, 'action') ? h('p', { class: 'bz-t-micro bz-texte-2', texte: `Proposé : ${valeurDe(o, 'action')}` }) : null)));
}

function demarrage() {
  const u = E.monde.univers;
  const etapes = [
    ['Vos lieux', 'siège, ateliers, boutiques, entrepôts', { type: u.types.find((t) => t.famille === 'lieu')?.id }],
    [u.types.find((t) => t.famille === 'personne')?.pluriel ?? 'Vos employés', 'qui travaille où', { type: u.types.find((t) => t.famille === 'personne')?.id }],
    [u.roles.find((r) => r.id === 'client')?.pluriel ?? 'Vos clients', 'entreprises, particuliers, collectivités', { type: 'entreprise', roles: ['client'] }],
    [u.roles.find((r) => r.id === 'fournisseur')?.pluriel ?? 'Vos fournisseurs', 'qui vous livre quoi', { type: 'entreprise', roles: ['fournisseur'] }],
    ['Votre stock', 'articles, seuils d’alerte', { type: 'article' }],
  ];
  // raccourcis type par type (sans rang ni parcours concurrent : « Premiers pas » est le seul, §4.20)
  return h('ul', { class: 'bz-liste-simple', role: 'list' }, etapes.map(([titre, sous, cible]) => h('li', { class: 'bz-ligne-lieu' },
    h('span', { class: 'bz-ligne-lieu__texte' }, h('span', { class: 'bz-t-label', texte: titre }), h('span', { class: 'bz-ligne-lieu__meta', texte: sous })),
    h('span', { class: 'bz-groupe-boutons' },
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => ouvrirAssistant('fichier', cible) }, icone('upload', { taille: 'sm' }), 'Importer'),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => ouvrirSaisie(cible) }, 'Ajouter à la main')))));
}

async function ouvrirSurCarte(id, agir = false) {
  if (!E.sceneEchec && !petitEcran() && E.vue !== 'carte') await changerVue('carte');
  await selectionner(id);
  if (agir && E.fiche?.actionsPossibles?.length) {
    const a = E.fiche.actionsPossibles[0];
    E.formulaire = nouveauFormulaire(a);
    rendreFiche();
  }
  // le bouton qui a ouvert la fiche a pu disparaître (panneau replié) : le focus va dans la fiche, jamais sur <body>
  const actif = document.activeElement;
  if (!actif || actif === document.body || !actif.isConnected) {
    const f = $('#fiche');
    const champ = agir ? f?.querySelector('form input:not([type="hidden"]), form select, form textarea, .formulaire input, .formulaire select') : null;
    (champ ?? f?.querySelector('button'))?.focus();
  }
}

// ---------------------------------------------------------------- couche de jeu (§4.25, §4.27, §5.9, §6.1 P10)
/* Le jeu récompense le travail réel : l'XP ne vient que des quêtes achevées sur une donnée à jour (serveur,
   core/progression.ts). Quêtes du jour, barre d'XP et niveau du port (menu du compte, panneau de la carte), page
   Progression (niveaux, trophées datés et prouvés, journal), célébration de fin de quête. Le mode « Calme » masque
   XP, quêtes et célébrations sur cet appareil. Choix de ce qui s'affiche : web/jeu.js (module pur). */
const modeCalme = () => lireLocal('lb-calme') === 'oui';
function reglerCalme(oui) {
  ecrireLocal('lb-calme', oui ? 'oui' : 'non');
  document.documentElement.toggleAttribute('data-calme', oui);
  E.scene?.regler({ animations: lireLocal('lb-carte-animations') !== 'non' && !oui });
  E.scene?.niveauPort?.(oui ? 0 : E.monde?.progression?.niveau?.n ?? 1);
  annoncer(oui ? 'Mode Calme activé : XP, quêtes et célébrations masquées.' : 'Mode Calme désactivé.');
  if (E.monde && $('#coque')) { rendreBarre(); if (E.vue !== 'reglages') rendreVue(); }
}
document.documentElement.toggleAttribute('data-calme', modeCalme());

/** Barre d'XP de 6 px (§4.25) : piste ardoise, or ; « Niveau 4 · Port de pêche · 320 XP avant le niveau 5 ». */
function barreProgression({ lien = true, compacte = false, toujours = false } = {}) {
  const p = E.monde?.progression;
  // menu simple : la barre d'XP n'arrive qu'avec la première quête (un « Niveau 1 » sans rien à faire n'apprend rien) ;
  // la page Progression, elle, la montre toujours
  if (!p || modeCalme() || (!toujours && !rubriqueMontree('progression'))) return null;
  const B = JEU.barreXp(p);
  const barre = svg('svg', { class: 'bz-xp__barre', viewBox: '0 0 100 6', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  barre.append(svg('rect', { class: 'bz-xp__piste', x: 0, y: 0, width: 100, height: 6, rx: 3 }));
  if (B.pourcentage > 0) barre.append(svg('rect', { class: 'bz-xp__remplissage', x: 0, y: 0, width: Math.max(3, B.pourcentage), height: 6, rx: 3 }));
  const contenu = [
    h('span', { class: 'bz-xp__tete' }, icone('anchor', { taille: 'sm' }), h('span', { class: 'bz-xp__niveau', texte: `Niveau ${p.niveau.n} · ${p.niveau.nom}` }), compacte ? null : h('span', { class: 'bz-t-chiffre bz-xp__total', texte: `${nombre(p.xp)} XP` })),
    barre,
    compacte ? null : h('span', { class: 'bz-t-micro bz-texte-2', texte: p.suivant ? `${nombre(p.suivant.reste)} XP avant le niveau ${p.suivant.n}` : 'Niveau maximal atteint' }),
    h('span', { class: 'bz-visuellement-cache', texte: B.libelle }),
  ];
  return lien
    ? h('a', { href: '#/progression', class: `bz-xp${compacte ? ' bz-xp--compacte' : ''}`, cle: `xp-${compacte ? 'compacte' : 'menu'}`, onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); cacher($('#menu-compte')); changerVue('progression'); } }, contenu)
    : h('div', { class: `bz-xp${compacte ? ' bz-xp--compacte' : ''}` }, contenu);
}

/** « Pourquoi cette quête ? » (§4.25) : la preuve de la situation (valeur, seuil, source, date), au clic. */
function pourquoiQuete(q, k) {
  const p = q.preuve;
  return popoverProvenance(`pourquoi-${k}`, [
    ['Constat', p.description], ['Valeur', p.valeur], ['Seuil', p.seuil], ['Source', p.source],
    ['Mesuré', p.observeLe ? dateRelative(p.observeLe) : null], ['Objectif', p.objectif],
  ], 'Pourquoi cette quête ?');
}

/** Carte d'une quête du jour : titre-verbe, progression « 1 sur 3 », récompense, action, preuve. */
function carteQuete(q, k, { niv = 'h3' } = {}) {
  const [pourquoi, pop] = pourquoiQuete(q, k);
  const idT = `quete-${k}`;
  return h('article', { class: 'bz-quete', 'aria-labelledby': idT },
    h('span', { class: 'bz-quete__icone', 'aria-hidden': 'true' }, icone(q.icone)),
    h('div', { class: 'bz-quete__texte' },
      h(niv, { class: 'bz-quete__titre', id: idT, texte: q.titre }),
      h('p', { class: 'bz-quete__meta bz-t-petit' },
        h('span', { class: 'bz-t-chiffre', texte: `${q.faites} sur ${q.total}` }),
        h('span', { class: 'bz-badge bz-badge--xp', texte: `+${q.xp} XP` }),
        q.gravite === 'critique' ? h('span', { class: 'bz-badge bz-badge--critique' }, icone('octagon-alert', { taille: 'sm' }), 'Urgent') : null),
      h('div', { class: 'bz-groupe-boutons' },
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => ouvrirSurCarte(q.objets[0], Boolean(q.action) && E.monde.profil.peutPreparer) },
          icone(q.action === 'mouvement' ? 'boxes' : 'arrow-right', { taille: 'sm' }), q.action === 'mouvement' && E.monde.profil.peutPreparer ? 'Enregistrer un mouvement' : 'Commencer'),
        pourquoi, pop)));
}

/** Quêtes du jour (1 à 3) : rien en mode Calme ; une ligne de « Progression » en dessous. */
function blocQuetes({ niv = 'h3' } = {}) {
  if (modeCalme()) return null;
  const quetes = JEU.quetesDuJour(E.monde, { maintenant: new Date(E.monde.maintenant ?? Date.now()) });
  return h('div', { class: 'bz-pile' },
    quetes.length ? h('ul', { class: 'bz-liste-simple', role: 'list' }, quetes.map((q, k) => h('li', {}, carteQuete(q, `auj-${k}`, { niv }))))
      : blocVide({ titre: 'Aucune quête aujourd’hui.', texte: 'Une quête naît d’une situation à régler, prouvée par vos données.', compact: true }),
    barreProgression({ compacte: false }));
}

/** Célébration de fin de quête (§4.25, §4.27) : toast et moment « Fin de quête » sur la carte ; jamais pendant une
    saisie (attend la fin), jamais en mode Calme ; en mouvement réduit, le toast seul (la carte le sait). */
function celebrer(avant, apres) {
  if (modeCalme() || !avant || !apres) return;
  const c = JEU.aCelebrer(avant, apres, { maintenant: new Date() });
  if (!c.reussites.length && !c.niveau) return;
  let essais = 0;
  const jouer = () => {
    const a = document.activeElement;
    const saisie = Boolean(E.edition) || (a && (a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || (a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(a.type))));
    if (saisie && essais++ < 30) { setTimeout(jouer, 2000); return; }
    const r = c.reussites.at(-1);
    if (r) toast({ texte: typo(c.reussites.length > 1 ? `${pluriel(c.reussites.length, 'quête terminée', 'quêtes terminées')} · +${c.reussites.reduce((n, x) => n + x.xp, 0)} XP` : JEU.texteCelebration(r)), ton: 'celebration', action: { libelle: 'Voir', faire: () => changerVue('progression') } });
    if (c.niveau) toast({ texte: typo(`Niveau ${c.niveau.n} · ${c.niveau.nom} : ${c.niveau.element} rejoint le port.`), ton: 'celebration', action: { libelle: 'Voir', faire: () => changerVue('progression') } });
    E.scene?.celebrer?.({ niveau: apres.niveau.n });
  };
  jouer();
}

/** Page Progression (« Mon port ») : niveau, quêtes du jour, les 10 niveaux, trophées datés et prouvés, journal. */
function rendreProgression() {
  const m = E.monde;
  const p = m.progression;
  const P = $('#page');
  if (modeCalme()) {
    remplir(P, h('div', { class: 'bz-ecran' }, blocVide({ titre: 'Le mode Calme est activé.', texte: 'L’XP, les quêtes et les célébrations sont masquées sur cet appareil. Le travail reste compté.',
      actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => reglerCalme(false) }, icone('sparkles'), 'Désactiver le mode Calme') })));
    return;
  }
  if (!p) { remplir(P, erreurEcran('La progression n’est pas disponible.', null, () => charger())); return; }
  const parId = new Map(p.reussites.map((r) => [r.id, r]));
  const quetes = JEU.quetesDuJour(m, { maintenant: new Date(m.maintenant ?? Date.now()) });
  const niveaux = JEU.etapesNiveaux(p, JEU.NIVEAUX);
  const preuveReussite = (r) => [r.preuve.valeur !== null ? `valeur ${nombre(r.preuve.valeur)}` : null, r.preuve.seuil !== null ? `seuil ${nombre(r.preuve.seuil)}` : null, r.preuve.observeLe ? `mesurée ${dateRelative(r.preuve.observeLe)}` : null].filter(Boolean).join(' · ');
  remplir(P, h('div', { class: 'bz-ecran bz-progression' },
    h('section', { class: 'bz-carte bz-carte--heros bz-progression__niveau', 'aria-labelledby': 'progression-niveau' },
      h('div', { class: 'bz-carte__tete' },
        h('p', { class: 'bz-t-surtitre', texte: `Le port de ${sansDemo(m.organisation.nom)}` }),
        p.exemple ? badgeExemple() : null),
      h('h2', { class: 'bz-t-titre-1 bz-progression__titre', id: 'progression-niveau', texte: `Niveau ${p.niveau.n} · ${p.niveau.nom}` }),
      barreProgression({ lien: false, toujours: true }),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: 'L’XP ne vient que des situations réglées, prouvées par une donnée à jour. Pas de points pour une connexion ou un clic.' }),
      !E.sceneEchec ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => changerVue('carte') }, icone('map'), 'Voir mon port sur la carte')) : null),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'progression-quetes' },
      h('h2', { class: 'bz-t-titre-4', id: 'progression-quetes', texte: 'Quêtes du jour' }),
      quetes.length ? h('ul', { class: 'bz-liste-simple', role: 'list' }, quetes.map((q, k) => h('li', {}, carteQuete(q, `page-${k}`))))
        : blocVide({ titre: 'Aucune quête aujourd’hui.', texte: 'Rien n’est hors limites : profitez-en pour compléter votre santé.', compact: true })),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'progression-niveaux' },
      h('h2', { class: 'bz-t-titre-4', id: 'progression-niveaux', texte: 'Les niveaux du port' }),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Chaque niveau ajoute un élément au décor de la carte, au même endroit pour tout le monde. Jamais une fonction.' }),
      h('ol', { class: 'bz-niveaux', role: 'list' }, niveaux.map((n) => h('li', { class: 'bz-niveaux__etape', 'data-atteint': n.atteint ? '' : null, 'aria-current': n.courant ? 'step' : null },
        h('span', { class: 'bz-niveaux__marque', 'aria-hidden': 'true' }, n.atteint ? icone('check', { taille: 'sm' }) : h('span', { class: 'bz-t-chiffre', texte: String(n.n) })),
        h('span', { class: 'bz-pile bz-pile--serre' },
          h('span', { class: 'bz-t-label', texte: `${n.n}. ${n.nom}` }),
          h('span', { class: 'bz-t-micro bz-texte-2', texte: `${n.element} · dès ${nombre(n.xp)} XP${n.courant ? ' · vous êtes ici' : n.atteint ? ' · atteint' : ''}` })))))),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'progression-trophees' },
      h('h2', { class: 'bz-t-titre-4', id: 'progression-trophees', texte: 'Trophées' }),
      h('ul', { class: 'bz-trophees', role: 'list' }, p.trophees.map((t) => h('li', {}, h('article', { class: 'bz-trophee', 'data-obtenu': t.le ? '' : null, 'aria-labelledby': `trophee-${t.id}` },
        h('span', { class: 'bz-trophee__medaille', 'aria-hidden': 'true' }, icone(t.le ? t.icone : 'lock', { taille: 'lg' })),
        h('h3', { class: 'bz-trophee__titre', id: `trophee-${t.id}`, texte: t.titre }),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: t.texte }),
        t.le ? h('p', { class: 'bz-t-micro', texte: `Obtenu ${dateRelative(t.le)}` }) : h('p', { class: 'bz-t-micro bz-texte-2', texte: `${t.avance} sur ${t.objectif}` }),
        t.le ? h('details', { class: 'bz-repli bz-trophee__preuve' }, h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Preuve' }), icone('chevron-down', { taille: 'sm' })),
          h('ul', { class: 'bz-repli__corps bz-liste-simple bz-t-petit', role: 'list' }, t.preuves.map((id) => { const r = parId.get(id); return h('li', { texte: r ? `${JEU.titreQuete(r.regle, [r.nom])}, ${dateRelative(r.le)}${preuveReussite(r) ? ` (${preuveReussite(r)})` : ''}` : 'Une réussite hors de votre périmètre' }); }))) : null))))),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'progression-journal' },
      h('h2', { class: 'bz-t-titre-4', id: 'progression-journal', texte: 'Journal des réussites' }),
      p.reussites.length ? h('ol', { class: 'bz-historique', reversed: true }, [...p.reussites].reverse().slice(0, 30).map((r) => h('li', {},
        h('p', { class: 'bz-t-label' }, JEU.titreQuete(r.regle, [r.nom]), ' ', h('span', { class: 'bz-badge bz-badge--xp', texte: `+${r.xp} XP` })),
        h('p', { class: 'bz-t-micro bz-texte-2', texte: [dateHeure(r.le), preuveReussite(r)].filter(Boolean).join(' · ') }))))
        : blocVide({ titre: 'Pas encore de réussite.', texte: 'Réglez une situation : la preuve arrive avec la prochaine donnée à jour.', compact: true }))));
}

// ---------------------------------------------------------------- listes (clients, fournisseurs, équipe, stock…) : §6.1 P7, §4.11
/* Tableau sur ordinateur (en-têtes collants, tri par bouton et aria-sort, chiffres à droite, nom en vrai lien vers la
   fiche, sélection multiple avec barre d'actions groupées), liste sur téléphone (le même tableau, présenté en lignes de
   64 px : forme de catégorie, titre, raison, valeur à droite). Colonnes déclarées par type (web/fiches.js), vues
   enregistrées (préférence de cet appareil), mention « Exemple » une seule fois. */
const etatListe = (vue) => (E.listes ??= {})[vue] ??= { tri: { colonne: 'nom', sens: 'asc' }, coches: new Set(), limite: 2000 };
const cleVues = (vue) => `lb-vues:${vue}`;
const RANG_ETAT = { critique: 0, attention: 1, info: 2, a_verifier: 2 };

async function rendreListe(vue) {
  const M = await chargerFiches();
  if (E.vue !== vue) return;
  const m = E.monde;
  const L = etatListe(vue);
  const o = onglets().find((x) => x.id === vue);
  const [genre, cleVue] = vue.split(':');
  const libelleListe = o?.libelle ?? (genre === 'role' ? m.univers.roles.find((r) => r.id === cleVue)?.pluriel : m.univers.types.find((t) => t.id === cleVue || t.famille === cleVue)?.pluriel) ?? 'Liste';
  const q = E.recherche.trim().toLowerCase();
  const tous = objetsDeVue(vue).filter(dansFiltre);
  const filtres = tous.filter((x) => !q || x.nom.toLowerCase().includes(q) || x.libelleType.toLowerCase().includes(q) || x.champs.some((c) => String(c.valeur ?? c.lien?.nom ?? '').toLowerCase().includes(q)));
  const sitsPar = new Map();
  for (const s of m.situations) { if (!sitsPar.has(s.objetId)) sitsPar.set(s.objetId, []); sitsPar.get(s.objetId).push(s); }
  const situationDe = (x) => trierSituations(sitsPar.get(x.id) ?? [])[0] ?? null;
  const liste = M.trier(filtres, L.tri, { etatDe: (x) => { const s = situationDe(x); return s ? RANG_ETAT[niveau(s)] ?? 3 : x.fraicheur === 'fraiche' ? 4 : 3; } });
  const cible = genre === 'role' ? { type: m.univers.types.find((t) => t.famille === 'tiers')?.id, roles: [cleVue] } : genre === 'type' ? { type: cleVue } : { type: m.univers.types.find((t) => t.famille === cleVue)?.id };
  // liste encore vide (§4.18) : ni recherche, ni vues enregistrées, ni deuxième bouton principal — ce qui manque, ce que
  // la rubrique montrera, et une seule action (une liste vidée par un filtre garde ses outils : voir plus bas)
  if (!objetsDeVue(vue).length) {
    remplir($('#page'), h('div', { class: 'bz-ecran bz-liste' }, videRubrique(rubriqueDeVue(vue), {
      titre: o ? null : `Aucune fiche dans ${libelleListe.toLowerCase()} pour le moment.`,
      action: boutonConnecter(cible),
      secondaire: cible.type ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => ouvrirSaisie(cible) }, 'Ajouter à la main (enregistré sur cet appareil)') : null,
    })));
    return;
  }
  const colonnes = M.colonnesDe(tous);
  const exemple = tous.some((x) => x.mode === 'demo');
  for (const id of [...L.coches]) if (!tous.some((x) => x.id === id)) L.coches.delete(id);
  const coches = liste.filter((x) => L.coches.has(x.id));
  const vues = M.lireVues(lireLocal(cleVues(vue)));
  const etatCourant = { recherche: E.recherche, tri: L.tri, filtre: E.filtreDep };
  const vueActive = vues.find((v) => M.memeVue(v, etatCourant));
  const rerendre = () => rendreListe(vue);
  const nomLigne = (x) => sansDemo(x.nom);

  const etatCellule = (x) => {
    const s = situationDe(x);
    if (s) { const n = niveau(s); const ton = n === 'a_verifier' ? 'info' : n; return h('span', { class: `bz-badge bz-badge--${ton}` }, icone(ICONE_TON[ton] ?? 'info', { taille: 'sm' }), s.description); }
    if (x.fraicheur !== 'fraiche') return h('span', { class: 'bz-badge bz-badge--info' }, icone('clock', { taille: 'sm' }), x.fraicheur === 'perimee' ? 'À vérifier' : 'Date inconnue');
    return h('span', { class: 'bz-t-petit bz-texte-2', texte: 'En ordre' });
  };
  const cellule = (x, col) => {
    const c = x.champs.find((y) => y.id === col.id);
    const num = M.estNumerique(col);
    const vide = !c || c.valeur === null || c.valeur === undefined || c.valeur === '';
    return h('td', { class: num ? 'bz-num' : null, 'data-colonne': col.libelle },
      vide ? h('span', { class: 'bz-texte-2' }, '—', h('span', { class: 'bz-visuellement-cache', texte: ' Pas encore renseigné' })) : num ? h('span', { class: 'bz-t-chiffre', texte: formatValeur(c) }) : formatValeur(c));
  };
  const enTete = (id, libelle, num = false) => h('th', { scope: 'col', class: num ? 'bz-num' : null, 'aria-sort': M.ariaSort(L.tri, id) },
    h('button', { type: 'button', class: 'bz-tableau__tri', cle: `tri-${id}`, onclick: () => { L.tri = M.triSuivant(L.tri, id); rerendre(); annoncer(`Tri : ${libelle}${L.tri.colonne === id ? (L.tri.sens === 'asc' ? ', croissant' : ', décroissant') : ' annulé'}`); } },
      h('span', { texte: libelle }), icone(L.tri.colonne === id ? (L.tri.sens === 'asc' ? 'arrow-up' : 'arrow-down') : 'arrow-up-down', { taille: 'sm' })));
  const meta = (x) => {
    const s = situationDe(x);
    const premier = colonnes.map((col) => x.champs.find((y) => y.id === col.id)).find((c) => c && c.valeur !== null && c.valeur !== '' && !M.estNumerique(c));
    return [premier ? formatValeur(premier) : x.libelleType, s ? s.description : null].filter(Boolean).join(' · ');
  };
  const valeurDroite = (x) => {
    const col = colonnes.find((cc) => M.estNumerique(cc));
    const c = col ? x.champs.find((y) => y.id === col.id) : null;
    return c && c.valeur !== null ? h('span', { class: 'bz-liste__valeur bz-t-chiffre', 'aria-hidden': 'true', texte: formatValeur(c) }) : null;
  };
  const ligne = (x) => {
    const cat = categorieDe(x);
    const coche = L.coches.has(x.id);
    return h('tr', { 'data-courant': E.selection === x.id ? '' : null, 'data-coche': coche ? '' : null, cle: `ligne-${x.id}` },
      h('td', { class: 'bz-tableau__case' }, h('label', { class: 'bz-tableau__cible' }, h('input', { type: 'checkbox', checked: coche, cle: `coche-${x.id}`, 'aria-label': `Sélectionner ${nomLigne(x)}`,
        onchange: (e) => { if (e.target.checked) L.coches.add(x.id); else L.coches.delete(x.id); rerendre(); } }))),
      h('td', { class: 'bz-tableau__nom' }, h('div', { class: 'bz-liste__ligne' },
        h('span', { class: `bz-cat bz-cat--${cat.forme}`, 'aria-hidden': 'true' }, icone(cat.icone, { taille: 'sm' })),
        h('span', { class: 'bz-liste__texte' },
          h('a', { href: `#/${vue}`, class: 'bz-liste__lien', cle: `lien-${x.id}`, 'aria-current': E.selection === x.id ? 'true' : null, onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); selectionner(x.id); }, texte: nomLigne(x) }),
          h('span', { class: 'bz-liste__meta bz-t-petit', texte: meta(x) })),
        valeurDroite(x))),
      colonnes.map((col) => cellule(x, col)),
      h('td', { class: 'bz-tableau__etat' }, etatCellule(x)));
  };
  const toutCoche = liste.length > 0 && liste.every((x) => L.coches.has(x.id));
  const caseTout = h('input', { type: 'checkbox', checked: toutCoche, cle: 'coche-tout', 'aria-label': 'Tout sélectionner', onchange: (e) => { for (const x of liste) { if (e.target.checked) L.coches.add(x.id); else L.coches.delete(x.id); } rerendre(); } });
  if (!toutCoche && coches.length) caseTout.indeterminate = true;

  const enregistrerVueCourante = async () => {
    const nom = await demander({ titre: 'Enregistrer cette vue', texte: 'La recherche, le tri et le filtre actuels seront gardés sur cet appareil.', libelle: 'Nom de la vue', valeur: q ? E.recherche.trim().slice(0, 40) : '', valider: 'Enregistrer la vue' });
    if (!nom || !String(nom).trim()) return;
    ecrireLocal(cleVues(vue), JSON.stringify(M.enregistrerVue(vues, { nom: String(nom).trim().slice(0, 40), ...etatCourant })));
    annoncer(`Vue « ${String(nom).trim()} » enregistrée.`);
    rerendre();
  };
  const choisirVue = (nom) => {
    if (!nom) { E.recherche = ''; L.tri = { colonne: 'nom', sens: 'asc' }; E.filtreDep = 'tous'; rerendre(); return; }
    const v = vues.find((x) => x.nom === nom);
    if (!v) return;
    E.recherche = v.recherche; L.tri = v.tri; if (E.monde.objets.some((x) => x.id === v.filtre) || v.filtre === 'tous') E.filtreDep = v.filtre;
    rerendre();
  };
  const exporter = (objets) => {
    const entetes = ['Nom', 'Type', ...colonnes.map((c) => c.libelle), 'État'];
    const lignes = objets.map((x) => [nomLigne(x), x.libelleType, ...colonnes.map((col) => { const c = x.champs.find((y) => y.id === col.id); return c && c.valeur !== null ? (c.lien ? sansDemo(c.lien.nom) : c.valeur) : ''; }), situationDe(x)?.description ?? '']);
    telecharger(`${libelleListe.toLowerCase().replace(/[^\p{L}\d]+/gu, '-')}.csv`, texteCsv([entetes, ...lignes]));
    annoncer(`${pluriel(objets.length, 'ligne exportée', 'lignes exportées')}.`);
  };

  const visibles = liste.slice(0, L.limite);
  const champRecherche = h('label', { class: 'bz-recherche bz-liste__recherche' },
    icone('search'),
    h('span', { class: 'bz-visuellement-cache', texte: `Rechercher dans ${libelleListe.toLowerCase()}` }),
    h('input', { class: 'bz-champ__saisie', type: 'search', id: 'recherche-liste', enterkeyhint: 'search', autocomplete: 'off', placeholder: `Rechercher dans ${libelleListe.toLowerCase()}…`, value: E.recherche,
      oninput: (e) => { E.recherche = e.target.value; rerendre(); } }));
  remplir($('#page'),
    h('div', { class: 'bz-ecran bz-liste', 'data-selection': coches.length ? '' : null },
      h('div', { class: 'bz-liste__tete' },
        h('p', { class: 'bz-liste__compte bz-t-petit bz-texte-2' },
          q || E.filtreDep !== 'tous' ? `${pluriel(liste.length, 'résultat', 'résultats')} sur ${nombre(tous.length)}` : pluriel(tous.length, 'fiche', 'fiches'),
          exemple ? h('span', { class: 'bz-badge' }, icone('flask-conical', { taille: 'sm' }), 'Exemple') : null),
        h('div', { class: 'bz-groupe-boutons' },
          m.profil.peutAdministrer && cible.type ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => ouvrirSaisie(cible) }, icone('plus'), 'Ajouter') : null,
          m.profil.peutAdministrer && cible.type ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => ouvrirAssistant('fichier', cible) }, icone('upload'), 'Importer un fichier') : null)),
      h('div', { class: 'bz-liste__outils' },
        champRecherche,
        h('div', { class: 'bz-liste__vues' },
          h('label', { class: 'bz-visuellement-cache', for: 'vue-enregistree', texte: 'Vue enregistrée' }),
          h('div', { class: 'bz-select' },
            h('select', { id: 'vue-enregistree', class: 'bz-champ__saisie', onchange: (e) => choisirVue(e.target.value) },
              h('option', { value: '', selected: !vueActive, texte: vueActive || (!q && L.tri.colonne === 'nom' && E.filtreDep === 'tous') ? 'Toutes les fiches' : 'Vue non enregistrée' }),
              vues.map((v) => h('option', { value: v.nom, selected: vueActive?.nom === v.nom, texte: v.nom }))),
            icone('chevron-down', { taille: 'sm' })),
          !vueActive && (q || L.tri.colonne !== 'nom' || L.tri.sens !== 'asc' || E.filtreDep !== 'tous') ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: enregistrerVueCourante }, icone('bookmark-plus'), 'Enregistrer cette vue') : null,
          vueActive ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: () => { ecrireLocal(cleVues(vue), JSON.stringify(vues.filter((v) => v.nom !== vueActive.nom))); annoncer(`Vue « ${vueActive.nom} » retirée.`); rerendre(); } }, icone('x'), 'Retirer cette vue') : null)),
      filtreDepartements(),
      // ordre strict : vide filtré → contenu (le vide initial a son écran, plus haut)
      !liste.length ? h('div', { class: 'bz-vide' },
        h('h2', { class: 'bz-vide__titre', texte: 'Aucune fiche pour ces filtres.' }),
        h('p', { class: 'bz-vide__texte', texte: 'Essayez d’élargir la recherche.' }),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { E.recherche = ''; E.filtreDep = 'tous'; rerendre(); } }, icone('x'), 'Effacer les filtres'))
      : h('div', { class: 'bz-tableau-cadre bz-liste__cadre' }, h('table', { class: 'bz-tableau bz-tableau--liste', 'aria-label': libelleListe },
        h('thead', {}, h('tr', {},
          h('th', { scope: 'col', class: 'bz-tableau__case' }, h('label', { class: 'bz-tableau__cible' }, caseTout)),
          enTete('nom', 'Nom'),
          colonnes.map((c) => enTete(c.id, c.unite && M.estNumerique(c) ? `${c.libelle} (${c.unite})` : c.libelle, M.estNumerique(c))),
          enTete('etat', 'État'))),
        h('tbody', { class: liste.length > 200 ? 'bz-tableau__long' : null }, visibles.map(ligne)))),
      liste.length > visibles.length ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { L.limite += 200; rerendre(); } }, `Afficher 200 de plus (${nombre(liste.length - visibles.length)} restantes)`) : null,
      coches.length ? h('div', { class: 'bz-barre-action', role: 'toolbar', 'aria-label': `Actions pour ${pluriel(coches.length, 'fiche sélectionnée', 'fiches sélectionnées')}`, onkeydown: clavierBarre },
        h('span', { class: 'bz-barre-action__titre bz-t-label', texte: pluriel(coches.length, 'fiche sélectionnée', 'fiches sélectionnées') }),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => exporter(coches) }, icone('download'), 'Exporter'),
        coches.length === 1 ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => selectionner(coches[0].id) }, icone('panel-left'), 'Ouvrir la fiche') : null,
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: () => { L.coches.clear(); rerendre(); setTimeout(() => $('[data-cle="coche-tout"]')?.focus(), 0); } }, icone('x'), 'Désélectionner')) : null,
    ),
  );
}
/** Barre d'action (§4.17) : flèches gauche et droite entre les boutons, Échap désélectionne. */
function clavierBarre(e) {
  const boutons = [...e.currentTarget.querySelectorAll('button')];
  const i = boutons.indexOf(document.activeElement);
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); boutons[(i + (e.key === 'ArrowRight' ? 1 : -1) + boutons.length) % boutons.length]?.focus(); }
  if (e.key === 'Escape') { e.preventDefault(); boutons.at(-1)?.click(); }
}

function formatValeur(c) {
  if (c.valeur === null || c.valeur === undefined) return '—';
  if (c.lien) return sansDemo(c.lien.nom);
  if (c.type === 'booleen') return c.valeur ? 'Oui' : 'Non';
  if (c.type === 'date') return date(c.valeur);
  if (c.type === 'montant' && (c.unite === '€' || !c.unite)) return nfEuro.format(c.valeur);
  if (c.type === 'nombre' || c.type === 'montant') return `${nf.format(c.valeur)}${c.unite ? ` ${c.unite}` : ''}`;
  // valeur d'une liste de choix (« à traiter », « haute ») : en casse de phrase, jamais le mot brut en minuscules
  if (c.type === 'choix' && typeof c.valeur === 'string') return casseDePhrase(c.valeur);
  return String(c.valeur);
}
const casseDePhrase = (t) => (t ? `${t.charAt(0).toLocaleUpperCase('fr-FR')}${t.slice(1)}` : t);

// ---------------------------------------------------------------- fiche (§6.1 P7, §4.1, §4.14, §4.29, §4.30)
/* Panneau latéral non modal de 420 px sur ordinateur (redimensionnable de 360 à 560 px, poignée au clavier : flèches
   par pas de 24 px), panneau superposé sur tablette, feuille basse sur téléphone (mi-hauteur puis pleine, liée à
   l'historique : Retour la ferme). En-tête : identité, état et 2 actions principales toujours au même endroit ; puis
   les champs groupés et repliables, modifiables en place (Entrée enregistre, Échap annule, « Enregistré » discret,
   Annuler dans le toast) ; la provenance est dans le popover « D'où vient ce chiffre ? ».
   Ce qu'on montre est décidé par web/fiches.js (module pur). */
let FICHES = null;
const chargerFiches = async () => (FICHES ??= await import('/fiches.js'));
let TERRAIN = null;
const chargerTerrain = async () => (TERRAIN ??= await import('/bz/terrain.js'));
const LARGEUR_FICHE = { min: 360, max: 560, pas: 24, defaut: 420 };
const largeurFiche = () => { const n = Number(lireLocal('lb-fiche-largeur')); return Number.isFinite(n) && n >= LARGEUR_FICHE.min && n <= LARGEUR_FICHE.max ? n : LARGEUR_FICHE.defaut; };
const NATURE = { confirme: 'Confirmé par la source', declare: 'Saisi à la main', calcule: 'Calculé', infere: 'Estimé', inconnu: 'On ne sait pas encore' };
const FRAICHEUR = { fraiche: 'À jour', perimee: 'Plus de 7 jours : à vérifier', inconnue: 'Date inconnue' };

/** Lecture d'une fiche : deux demandes simultanées de la même fiche (sélection, mise à jour en direct) n'en font qu'une. */
const fichesEnVol = new Map();
function lireFiche(id) {
  if (!fichesEnVol.has(id)) fichesEnVol.set(id, api('GET', `/objets/${encodeURIComponent(id)}`).finally(() => fichesEnVol.delete(id)));
  return fichesEnVol.get(id);
}

async function selectionner(id) {
  const avant = E.selection;
  if (!avant && id) E.ficheOuvreur = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  E.selection = id;
  E.formulaire = null;
  E.edition = null;
  if (id === '__pavillon') E.fiche = null;
  else {
    try {
      [E.fiche] = await Promise.all([lireFiche(id), chargerFiches(), chargerTerrain()]);
    } catch (e) {
      informer(e.message, 'erreur');
      E.selection = null;
      E.fiche = null;
    }
  }
  if (E.selection && estTelephone()) {
    E.cranFiche = avant ? E.cranFiche ?? 'mi' : 'mi';
    // la feuille ajoute une entrée d'historique : le bouton Retour du téléphone la ferme (§4.14)
    if (history.state?.bzFiche) history.replaceState({ bzFiche: id }, '', location.href);
    else history.pushState({ bzFiche: id }, '', location.href);
  }
  E.scene?.selectionner(E.selection);
  rendreFiche();
  if (estVueListe(E.vue)) rendreListe(E.vue);
  if (E.vue === 'carte' && !estTelephone()) rendreHud();
  if (E.selection && E.selection !== avant) setTimeout(() => $('#fiche-titre')?.focus({ preventScroll: true }), 0);
}
function fermerFiche({ depuisHistorique = false } = {}) {
  if (!E.selection) return;
  if (!depuisHistorique && history.state?.bzFiche) { history.back(); return; } // popstate rappelle fermerFiche
  const ouvreur = E.ficheOuvreur;
  E.selection = null;
  E.fiche = null;
  E.formulaire = null;
  E.edition = null;
  E.ficheOuvreur = null;
  E.panneauMalgreFiche = false;
  E.scene?.selectionner(null);
  rendreFiche();
  if (estVueListe(E.vue)) rendreListe(E.vue);
  if (E.vue === 'carte' && !estTelephone()) rendreHud();
  // le focus revient à ce qui avait ouvert la fiche, jamais sur <body>
  const retour = ouvreur?.isConnected ? ouvreur : ouvreur?.dataset?.cle ? document.querySelector(`[data-cle="${CSS.escape(ouvreur.dataset.cle)}"]`) : null;
  if (retour) retour.focus({ preventScroll: true });
  else if (!$('#fiche')?.contains(document.activeElement) || document.activeElement === document.body) $('#zone')?.focus({ preventScroll: true });
}
window.addEventListener('popstate', () => { if (E.selection && !history.state?.bzFiche) fermerFiche({ depuisHistorique: true }); });

/** Cran de la feuille du téléphone : mi-hauteur ou pleine hauteur ; « fermer » sous le cran le plus bas. */
function changerCranFiche(cran) {
  if (cran === 'ferme') { fermerFiche(); return; }
  E.cranFiche = cran;
  $('#fiche')?.setAttribute('data-cran', cran);
  const b = $('#fiche-agrandir');
  if (b) { b.setAttribute('aria-label', typo(cran === 'plein' ? 'Réduire la fiche' : 'Agrandir la fiche')); b.setAttribute('aria-expanded', String(cran === 'plein')); }
  annoncer(cran === 'plein' ? 'Fiche agrandie.' : 'Fiche réduite.');
}
function glisserFiche(poignee) {
  let depart = null;
  poignee.addEventListener('pointerdown', (e) => { depart = e.clientY; try { poignee.setPointerCapture?.(e.pointerId); } catch { /* pointeur déjà relâché */ } });
  poignee.addEventListener('pointerup', (e) => {
    if (depart === null) return;
    const dy = e.clientY - depart;
    depart = null;
    if (Math.abs(dy) < 24) { changerCranFiche(E.cranFiche === 'plein' ? 'mi' : 'plein'); return; } // un tap : bascule
    if (dy < 0) changerCranFiche('plein');
    else changerCranFiche(E.cranFiche === 'plein' ? 'mi' : 'ferme');
  });
  poignee.addEventListener('pointercancel', () => { depart = null; });
}
/** Poignée de largeur (ordinateur) : glisser, ou flèches gauche et droite par pas de 24 px (§4.1). */
function poigneeLargeur() {
  const appliquer = (w) => {
    const l = Math.max(LARGEUR_FICHE.min, Math.min(LARGEUR_FICHE.max, Math.round(w)));
    $('#corps')?.style.setProperty('--fiche-largeur', `${l}px`);
    const p = $('#fiche-largeur');
    p?.setAttribute('aria-valuenow', String(l));
    p?.setAttribute('aria-valuetext', `${l} pixels`);
    ecrireLocal('lb-fiche-largeur', String(l));
    return l;
  };
  let depart = null;
  return h('div', { class: 'bz-fiche__largeur', id: 'fiche-largeur', role: 'separator', tabindex: '0', 'aria-orientation': 'vertical', 'aria-label': 'Largeur de la fiche',
    'aria-controls': 'fiche', 'aria-valuemin': String(LARGEUR_FICHE.min), 'aria-valuemax': String(LARGEUR_FICHE.max), 'aria-valuenow': String(largeurFiche()),
    onkeydown: (e) => {
      const pas = { ArrowLeft: LARGEUR_FICHE.pas, ArrowRight: -LARGEUR_FICHE.pas }[e.key];
      if (pas) { e.preventDefault(); appliquer(largeurFiche() + pas); }
      if (e.key === 'Home') { e.preventDefault(); appliquer(LARGEUR_FICHE.min); }
      if (e.key === 'End') { e.preventDefault(); appliquer(LARGEUR_FICHE.max); }
    },
    onpointerdown: (e) => { depart = { x: e.clientX, w: largeurFiche() }; try { e.currentTarget.setPointerCapture?.(e.pointerId); } catch { /* pointeur déjà relâché */ } },
    onpointermove: (e) => { if (depart) appliquer(depart.w + (depart.x - e.clientX)); },
    onpointerup: () => { depart = null; },
  });
}

/** Place un popover sous son ancre (au-dessus si la place manque), dans la fenêtre, par CSSOM (compatible CSP). */
function placerPres(pop, ancre, ecart = 6) {
  if (!pop || !ancre?.isConnected) return;
  const a = ancre.getBoundingClientRect();
  pop.style.inset = 'auto';
  pop.style.margin = '0';
  pop.style.position = 'fixed';
  const r = pop.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  let haut = a.bottom + ecart;
  if (haut + r.height > vh - 8 && a.top - ecart - r.height > 8) haut = a.top - ecart - r.height;
  haut = Math.max(8, Math.min(haut, vh - r.height - 8));
  pop.style.top = `${Math.round(haut)}px`;
  pop.style.left = `${Math.round(Math.max(8, Math.min(a.left, vw - r.width - 8)))}px`;
}

/** Popover « D'où vient ce chiffre ? » (§4.15) : source, date, méthode ; ouvert au clic, fermé par Échap. */
function popoverProvenance(id, lignes, titre = 'D’où vient ce chiffre ?') {
  const pop = h('div', { class: 'bz-popover bz-provenance', id, popover: 'auto', role: 'dialog', 'aria-label': titre },
    h('p', { class: 'bz-t-label', texte: titre }),
    h('dl', { class: 'bz-provenance__liste' }, lignes.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => [h('dt', { texte: k }), h('dd', { texte: String(v) })])));
  const bouton = h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien bz-t-petit', 'aria-haspopup': 'dialog', 'aria-controls': id, popovertarget: POPOVER_NATIF ? id : null,
    onclick: POPOVER_NATIF ? (e) => { const b = e.currentTarget; requestAnimationFrame(() => placerPres(pop, b)); } : (e) => { if (estOuvert(pop)) cacher(pop); else { montrer(pop); placerPres(pop, e.currentTarget); } } },
  icone('info', { taille: 'sm' }), titre);
  return [bouton, pop];
}

function etatFiche(o, situations) {
  // un courrier a son propre état : « Urgent · à traiter », « À traiter » (neutre), « Traité » ; jamais « En ordre »
  if (o.type === 'courrier') {
    const v = (id) => o.champs.find((c) => c.id === id)?.valeur ?? null;
    if (v('statut') === 'traité') return { ton: 'ok', texte: 'Traité' };
    return v('urgence') === 'haute' ? { ton: 'attention', texte: 'Urgent · à traiter' } : { ton: null, texte: 'À traiter' };
  }
  const s = trierSituations(situations ?? [])[0];
  if (s) { const n = niveau(s); const ton = n === 'a_verifier' ? 'info' : n; return { ton, texte: s.description }; }
  if (o.fraicheur === 'perimee') return { ton: 'info', texte: 'À vérifier : plus de 7 jours sans mise à jour' };
  return { ton: 'ok', texte: 'En ordre' };
}

/** Valeur affichée d'un champ dans la fiche : lien vers une autre fiche, numéro en tel:, adresse avec « Y aller ». */
function valeurFiche(c, o) {
  if (c.valeur === null || c.valeur === undefined || c.valeur === '') {
    return h('span', { class: 'bz-t-chiffre bz-texte-2', 'data-certitude': 'absent' }, '—', h('span', { class: 'bz-t-petit', texte: ' Pas encore renseigné' }));
  }
  if (c.lien) return h('button', { type: 'button', class: 'bz-lien', onclick: () => selectionner(c.lien.id), texte: sansDemo(c.lien.nom) });
  const T = TERRAIN;
  if (T && typeof c.valeur === 'string' && (c.id === 'contact' || c.id === 'telephone')) {
    const t = T.telephoneDe(c.valeur);
    if (t) {
      const avant = c.valeur.slice(0, c.valeur.search(/(?:\+33|0033|\b0)[1-9]/)).replace(/[\s,;:–-]+$/, '');
      return h('span', {}, avant ? `${avant} · ` : null, h('a', { href: t.lien, class: 'bz-t-chiffre', texte: t.affiche }));
    }
  }
  if (T && typeof c.valeur === 'string' && c.id === 'email') { const m = T.courrielDe(c.valeur); if (m) return h('a', { href: m.lien, texte: m.adresse }); }
  if (T && typeof c.valeur === 'string' && (c.id === 'adresse' || (c.id === 'ville' && o.famille === 'tiers'))) {
    const url = T.lienItineraire(c.id === 'ville' ? c.valeur : [c.valeur, o.champs.find((x) => x.id === 'ville')?.valeur].filter(Boolean).join(', '), { appli: lireLocal('lb-itineraire') ?? 'systeme', ios: estIos() });
    return h('span', { class: 'bz-fiche__adresse' }, h('span', { texte: c.valeur }), url ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm' }, icone('navigation', { taille: 'sm' }), 'Y aller') : null);
  }
  if (o.type === 'courrier' && c.id === 'bac') return h('span', { class: 'bz-badge', texte: formatValeur(c) });
  const num = c.type === 'nombre' || c.type === 'montant';
  return h('span', { class: num ? 'bz-t-chiffre' : null, 'data-certitude': num ? (o.provenance === 'infere' ? 'estime' : o.fraicheur === 'perimee' ? 'perime' : null) : null, texte: formatValeur(c) },
    num && o.provenance === 'infere' ? h('span', { class: 'bz-visuellement-cache', texte: ', estimé' }) : null);
}

const peutModifier = (f) => f.actionsPossibles.some((a) => a.capacite === 'objet.modifier');
const defChamp = (o, id) => E.monde.univers.types.find((t) => t.id === o.type)?.champs.find((c) => c.id === id) ?? null;

/** Champ en cours d'édition en place : le bon contrôle selon le type ; Entrée enregistre, Échap annule. */
function saisieEnPlace(o, c, ed) {
  const def = defChamp(o, c.id) ?? c;
  const idSaisie = `edition-${idDom(c.id)}`;
  const clavier = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); annulerEdition(); }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); enregistrerEdition(); }
  };
  const lier = (e) => { ed.brut = e.target.value; ed.erreur = null; };
  const commun = { id: idSaisie, class: 'bz-champ__saisie', cle: idSaisie, 'aria-describedby': `${idSaisie}-aide${ed.erreur ? ` ${idSaisie}-erreur` : ''}`, 'aria-invalid': ed.erreur ? 'true' : null, onkeydown: clavier };
  let saisie;
  if (c.id === '__nom') saisie = h('input', { ...commun, type: 'text', maxlength: '200', autocomplete: 'off', value: ed.brut, oninput: lier });
  else if (def.type === 'choix') saisie = h('select', { ...commun, onchange: lier }, h('option', { value: '', texte: '—' }), (def.choix ?? []).map((x) => h('option', { value: x, selected: x === ed.brut, texte: casseDePhrase(x) })));
  else if (def.type === 'reference') {
    const opts = E.monde.objets.filter((x) => x.id !== o.id && (!def.cible || x.famille === def.cible.famille) && (!def.cible?.role || x.roles.some((r) => r.id === def.cible.role)));
    saisie = h('select', { ...commun, onchange: lier }, h('option', { value: '', texte: '—' }), opts.map((x) => h('option', { value: x.id, selected: x.id === ed.brut, texte: sansDemo(x.nom) })));
  } else if (def.type === 'booleen') saisie = h('select', { ...commun, onchange: lier }, h('option', { value: '', texte: '—' }), h('option', { value: 'oui', selected: ed.brut === 'oui', texte: 'Oui' }), h('option', { value: 'non', selected: ed.brut === 'non', texte: 'Non' }));
  else if (def.type === 'date') saisie = h('input', { ...commun, type: 'date', value: ed.brut, oninput: lier });
  else if (def.type === 'nombre' || def.type === 'montant') saisie = h('input', { ...commun, type: 'text', inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off', value: ed.brut, oninput: lier });
  else saisie = h('input', { ...commun, type: 'text', maxlength: '2000', enterkeyhint: 'done', autocomplete: 'off', value: ed.brut, oninput: lier });
  return h('div', { class: 'bz-edition' },
    h('div', { class: 'bz-edition__ligne' },
      def.unite && (def.type === 'nombre' || def.type === 'montant') ? h('div', { class: 'bz-champ__suffixe' }, saisie, h('span', { class: 'bz-champ__unite', 'aria-hidden': 'true', texte: def.unite })) : saisie,
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--icone bz-bouton--sm', 'aria-label': 'Enregistrer', 'data-infobulle': 'Enregistrer (Entrée)', 'aria-busy': ed.envoi ? 'true' : null, onclick: enregistrerEdition }, icone(ed.envoi ? 'loader-circle' : 'check', { taille: 'sm' })),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone bz-bouton--sm', 'aria-label': 'Annuler la modification', 'data-infobulle': 'Annuler (Échap)', onclick: annulerEdition }, icone('x', { taille: 'sm' }))),
    h('p', { class: 'bz-t-micro bz-texte-2', id: `${idSaisie}-aide`, texte: 'Entrée pour enregistrer, Échap pour annuler.' }),
    ed.erreur ? h('p', { class: 'bz-champ__erreur', id: `${idSaisie}-erreur`, role: 'alert' }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: ed.erreur })) : null);
}

function commencerEdition(c) {
  const o = E.fiche?.objet;
  if (!o || !FICHES) return;
  E.edition = { objetId: o.id, champ: c.id, libelle: c.libelle, brut: c.id === '__nom' ? o.nom : FICHES.valeurEdition(c), erreur: null, envoi: false };
  rendreFiche();
  setTimeout(() => { const s = $(`#edition-${idDom(c.id)}`); s?.focus(); if (typeof s?.select === 'function' && s.tagName === 'INPUT' && s.type === 'text') s.select(); }, 0);
}
function annulerEdition() {
  const ed = E.edition;
  if (!ed) return;
  E.edition = null;
  rendreFiche();
  setTimeout(() => $(`[data-cle="modifier-${idDom(ed.champ)}"]`)?.focus(), 0);
}

/** Écrit une modification de champ (ou du nom) par l'action « objet.modifier » ; renvoie l'état de l'action. */
async function ecrireChamp(o, champ, valeur) {
  const parametres = champ === '__nom' ? { champs: {}, nom: valeur } : { champs: { [champ]: valeur } };
  return api('POST', '/actions', { cle: cle(), capacite: 'objet.modifier', cible: o.id, parametres, executer: E.monde.profil.peutApprouver });
}

/** Enregistrement optimiste : la valeur s'affiche tout de suite, « Enregistré » discret, « Annuler » dans le toast. */
async function enregistrerEdition() {
  const ed = E.edition;
  const f = E.fiche;
  if (!ed || !f || ed.envoi || !FICHES) return;
  const o = f.objet;
  const c = ed.champ === '__nom' ? { id: '__nom', type: 'texte', valeur: o.nom } : o.champs.find((x) => x.id === ed.champ);
  if (!c) return;
  const def = ed.champ === '__nom' ? c : defChamp(o, c.id) ?? c;
  const lu = ed.champ === '__nom' ? (ed.brut.trim() ? { ok: true, valeur: ed.brut.trim() } : { ok: false, erreur: 'Indiquez un nom.' }) : FICHES.lireSaisie(def, ed.brut);
  if (!lu.ok) { ed.erreur = lu.erreur; rendreFiche(); setTimeout(() => $(`#edition-${idDom(ed.champ)}`)?.focus(), 0); return; }
  if (!FICHES.change(c, lu.valeur)) { annulerEdition(); return; }
  const avant = ed.champ === '__nom' ? o.nom : c.lien ? c.lien.id : c.valeur;
  const avantAffiche = { ...c };
  // optimiste : la fiche montre la nouvelle valeur pendant l'envoi
  if (ed.champ === '__nom') o.nom = lu.valeur;
  else if (def.type === 'reference') { const x = E.monde.objets.find((y) => y.id === lu.valeur); c.valeur = lu.valeur; c.lien = x ? { id: x.id, nom: x.nom } : null; } else c.valeur = lu.valeur;
  ed.envoi = true;
  E.edition = null;
  E.enregistrement = { champ: ed.champ, texte: 'Enregistrement…' };
  rendreFiche();
  setTimeout(() => $(`[data-cle="modifier-${idDom(ed.champ)}"]`)?.focus(), 0);
  const nomObjet = sansDemo(o.nom);
  try {
    const a = await ecrireChamp(o, ed.champ, lu.valeur);
    if (a.etat === 'echouee' || a.etat === 'resultat_inconnu') throw Object.assign(new Error(a.message ?? 'La modification n’a pas été enregistrée.'), { statut: 409 });
    const enAttente = a.etat === 'en_attente';
    E.enregistrement = { champ: ed.champ, texte: enAttente ? 'Envoyé pour approbation' : 'Enregistré' };
    annoncer(enAttente ? `${ed.libelle ?? 'Nom'} : envoyé pour approbation.` : `${ed.libelle ?? 'Nom'} enregistré.`);
    if (!enAttente) {
      actionAnnulable({
        texte: `${ed.champ === '__nom' ? 'Nom' : ed.libelle} : modification enregistrée.`,
        libelle: `modification de ${ed.champ === '__nom' ? 'nom' : (ed.libelle ?? '').toLowerCase()} de ${nomObjet}`,
        annuler: async () => { await ecrireChamp(o, ed.champ, avant ?? null); await charger(); },
      });
    } else informer('Modification envoyée pour approbation.', '');
    setTimeout(() => { if (E.enregistrement?.champ === ed.champ) { E.enregistrement = null; rendreFiche(); } }, 2500);
    await charger();
  } catch (e) {
    // refus : la valeur d'avant revient, avec la raison, sous le champ (jamais seulement un toast)
    if (ed.champ === '__nom') o.nom = avant; else Object.assign(c, avantAffiche);
    E.enregistrement = null;
    E.edition = { ...ed, envoi: false, erreur: e.statut ? `Pas enregistré : ${e.message}` : 'Pas enregistré : la connexion a été perdue. Réessayez.' };
    rendreFiche();
    setTimeout(() => $(`#edition-${idDom(ed.champ)}`)?.focus(), 0);
  }
}

function ligneChampFiche(o, c, modifiable) {
  const ed = E.edition?.champ === c.id && E.edition.objetId === o.id ? E.edition : null;
  const enreg = E.enregistrement?.champ === c.id ? E.enregistrement : null;
  return h('div', { class: 'bz-champ-fiche', 'data-edition': ed ? '' : null },
    h('dt', { class: 'bz-champ-fiche__libelle' }, ed ? h('label', { for: `edition-${idDom(c.id)}`, texte: `${c.libelle}${c.unite && !ed ? ` (${c.unite})` : ''}` }) : c.libelle),
    h('dd', { class: 'bz-champ-fiche__valeur' },
      ed ? saisieEnPlace(o, c, ed) : [
        c.id === '__nom' ? h('span', { texte: sansDemo(o.nom) }) : valeurFiche(c, o),
        modifiable ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone bz-bouton--sm bz-champ-fiche__modifier', cle: `modifier-${idDom(c.id)}`,
          'aria-label': `Modifier ${c.libelle.toLowerCase()}`, 'data-infobulle': `Modifier ${c.libelle.toLowerCase()}`, onclick: () => commencerEdition(c) }, icone('pencil', { taille: 'sm' })) : null,
        enreg ? h('span', { class: 'bz-champ-fiche__enregistre bz-t-micro' }, icone(enreg.texte === 'Enregistrement…' ? 'loader-circle' : 'check', { taille: 'sm' }), enreg.texte) : null,
      ]));
}

function rendreFiche() {
  const el = $('#fiche');
  if (!el) return;
  const corps = $('#corps');
  if (!E.selection) { el.hidden = true; corps?.removeAttribute('data-fiche'); remplir(el); return; }
  el.hidden = false;
  corps?.setAttribute('data-fiche', '');
  corps?.style.setProperty('--fiche-largeur', `${largeurFiche()}px`);
  el.setAttribute('data-cran', E.cranFiche ?? 'mi');
  // Échap ne ferme que la couche du dessus (§4.4) : un popover ouvert (« D'où vient ce chiffre ? ») se ferme seul
  el.onkeydown = (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !E.edition && !document.querySelector('dialog[open]') && !popoverOuvert()) { e.preventDefault(); fermerFiche(); } };
  const fermer = h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', cle: 'fiche-fermer', 'aria-label': 'Fermer la fiche', 'data-infobulle': 'Fermer (Échap)', onclick: () => fermerFiche() }, icone('x'));
  const poignee = h('button', { type: 'button', class: 'bz-feuille__poignee bz-fiche__poignee', id: 'fiche-agrandir', cle: 'fiche-poignee',
    'aria-label': E.cranFiche === 'plein' ? 'Réduire la fiche' : 'Agrandir la fiche', 'aria-expanded': E.cranFiche === 'plein', 'aria-controls': 'fiche' });
  glisserFiche(poignee);
  const cadre = (...contenu) => remplir(el, poignee, poigneeLargeur(), ...contenu);

  if (E.selection === '__pavillon') {
    const p = E.monde.pavillon;
    cadre(
      h('header', { class: 'bz-fiche__tete' },
        h('span', { class: 'bz-cat bz-cat--goutte', 'aria-hidden': 'true' }, icone('bz-phare-allume')),
        h('div', { class: 'bz-fiche__identite' }, h('p', { class: 'bz-t-surtitre', texte: 'À la frontière de votre port' }), h('h2', { class: 'bz-t-titre-3', id: 'fiche-titre', tabindex: '-1', texte: 'Phare Breizhcosystem' })),
        fermer),
      h('div', { class: 'bz-fiche__corps' },
        h('p', { texte: p.message }),
        h('section', { class: 'bz-fiche__section' }, h('h3', { class: 'bz-t-titre-4', texte: 'Gratuit' }),
          h('ul', { class: 'bz-liste-simple' }, ['Découvrir le réseau des entreprises bretonnes', 'Publier un besoin : un fournisseur, un sous-traitant, un partenaire, des clients', 'Publier mon catalogue, lire et gérer mes réponses', 'Répondre gratuitement à une invitation ciblée'].map((t) => h('li', { texte: t })))),
        h('section', { class: 'bz-fiche__section' }, h('h3', { class: 'bz-t-titre-4' }, 'Abonnement ', h('span', { class: 'bz-badge bz-badge--active', texte: 'ACTIVE' })),
          h('ul', { class: 'bz-liste-simple' }, ['Répondre aux demandes des autres entreprises', 'Solliciter de nouveaux partenaires', 'Activer les mises en relation'].map((t) => h('li', { texte: t }))),
          h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Le phare s’allume sur votre port quand l’abonnement est confirmé par le serveur.' })),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Votre port reste gratuit et fonctionne sans Breizhcosystem. Seuls les champs que vous choisissez et confirmez sont publiés.' })));
    el.setAttribute('aria-labelledby', 'fiche-titre');
    return;
  }
  if (!E.fiche || !FICHES) { cadre(h('header', { class: 'bz-fiche__tete' }, h('h2', { class: 'bz-t-titre-3', id: 'fiche-titre', tabindex: '-1', texte: 'Chargement de la fiche…' }), fermer), h('div', { class: 'bz-fiche__corps', 'aria-busy': 'true' }, h('span', { class: 'bz-squelette bz-squelette--texte' }))); return; }
  const f = E.fiche;
  const o = f.objet;
  const cat = categorieDe(o);
  const etat = etatFiche(o, f.situations);
  const modifiable = peutModifier(f);
  const peutEntrer = ['lieu', 'departement'].includes(o.famille) && Boolean(E.scene);
  const entete = FICHES.actionsEntete(o, { actionsPossibles: f.actionsPossibles, peutEntrer });
  const coord = FICHES.coordonnees(o);
  const T = TERRAIN;
  const boutonEntete = (a, i) => {
    const classe = `bz-bouton ${i === 0 ? 'bz-bouton--principal' : 'bz-bouton--secondaire'}`;
    if (a.genre === 'tel') return h('a', { class: classe, href: coord.tel.lien }, icone(a.icone), a.libelle, h('span', { class: 'bz-visuellement-cache', texte: ` ${coord.tel.affiche}` }));
    if (a.genre === 'mail') return h('a', { class: classe, href: coord.courriel.lien }, icone(a.icone), a.libelle);
    if (a.genre === 'itineraire') { const url = T?.lienItineraire(coord.adresse, { appli: lireLocal('lb-itineraire') ?? 'systeme', ios: estIos() }); return url ? h('a', { class: classe, href: url, target: '_blank', rel: 'noopener noreferrer' }, icone(a.icone), a.libelle) : null; }
    if (a.genre === 'entrer') return h('button', { type: 'button', class: classe, onclick: () => entrerDans(o) }, icone(a.icone), a.libelle);
    return h('button', { type: 'button', class: classe, onclick: () => { E.formulaire = nouveauFormulaire(a.action); rendreFiche(); setTimeout(() => $('#fiche form input, #fiche form select')?.focus(), 0); } }, icone(a.icone), a.libelle);
  };
  const objMonde = E.monde.objets.find((x) => x.id === o.id);
  const resumeDep = o.famille === 'departement' && objMonde ? (() => {
    const st = statsDepartement(objMonde);
    return h('section', { class: 'bz-fiche__section' },
      h('dl', { class: 'bz-fiche__chiffres' },
        h('div', {}, h('dt', { texte: 'Présents' }), h('dd', { class: 'bz-t-chiffre', texte: `${st.dispo.length} sur ${st.employes.length}` })),
        h('div', {}, h('dt', { texte: 'Tâches en cours' }), h('dd', { class: 'bz-t-chiffre', texte: nombre(st.taches.length - st.parStatut['terminée'].length) })),
        h('div', {}, h('dt', { texte: 'Alertes' }), h('dd', { class: 'bz-t-chiffre', texte: nombre(st.situations.length) }))),
      barreTaches(st),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => changerVue(`dep:${o.id}`) }, icone('layout-grid'), 'Ouvrir le tableau de bord du département'));
  })() : null;
  const groupes = FICHES.groupesFiche(o);
  const ouverts = E.groupesFiche ??= new Set(['coordonnees', 'suivi', 'chiffres', 'dates']);
  const nomPersonne = (id) => E.monde.objets.find((x) => x.id === id)?.nom ?? null;
  const traite = o.type === 'courrier' && o.champs.find((c) => c.id === 'statut')?.valeur === 'traité';
  cadre(
    h('header', { class: 'bz-fiche__tete' },
      h('span', { class: `bz-cat bz-cat--${cat.forme}`, 'aria-hidden': 'true' }, icone(cat.icone)),
      h('div', { class: 'bz-fiche__identite' },
        h('p', { class: 'bz-t-surtitre', texte: [o.libelleType, ...o.roles.map((r) => r.libelle)].filter((x, i, l) => l.indexOf(x) === i).join(' · ') }),
        h('h2', { class: 'bz-t-titre-3', id: 'fiche-titre', tabindex: '-1', texte: sansDemo(o.nom) }),
        h('p', { class: 'bz-fiche__etat' },
          etat.ton ? h('span', { class: `bz-badge bz-badge--${etat.ton}` }, icone(ICONE_TON[etat.ton] ?? 'info', { taille: 'sm' }), etat.texte) : h('span', { class: 'bz-badge', texte: etat.texte }),
          o.mode === 'demo' ? h('span', { class: 'bz-badge' }, icone('flask-conical', { taille: 'sm' }), 'Exemple') : null,
          o.simule ? h('span', { class: 'bz-badge' }, icone('flask-conical', { taille: 'sm' }), 'Modifié en simulation') : null)),
      fermer,
      entete.length ? h('div', { class: 'bz-fiche__actions' }, entete.map(boutonEntete)) : null),
    h('div', { class: 'bz-fiche__corps' },
      f.situations.map((s, i) => {
        const n = niveau(s);
        const ton = n === 'a_verifier' ? 'info' : n;
        return h('section', { class: 'bz-resultat', 'data-ton': ton },
          iconeEtat(ton, { decoratif: true }),
          h('div', { class: 'bz-pile' },
            h('strong', { texte: s.description }),
            h('span', { class: 'bz-t-petit bz-texte-2', texte: texteProvenance({ source: s.preuve.source.libelle, le: s.preuve.observeLe, fraicheur: s.preuve.fraicheur }) }),
            popoverProvenance(`preuve-${i}`, [
              ['Valeur', s.preuve.valeur === null ? 'Pas encore renseignée' : nf.format(s.preuve.valeur)],
              ['Seuil', s.preuve.seuil === null ? 'Pas encore renseigné' : nf.format(s.preuve.seuil)],
              ['Source', s.preuve.source.libelle],
              ['Observé', dateHeure(s.preuve.observeLe)],
              ['Fraîcheur', FRAICHEUR[s.preuve.fraicheur] ?? s.preuve.fraicheur],
              ['Méthode', NATURE[s.preuve.provenance] ?? s.preuve.provenance],
              ['Responsable', s.responsable && nomPersonne(s.responsable) ? sansDemo(nomPersonne(s.responsable)) : null],
            ], 'Pourquoi cette alerte ?')));
      }),
      resumeDep,
      o.type === 'courrier' && E.monde.profil.peutPreparer ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => basculerCourrierTraite(o, traite) }, icone(traite ? 'undo-2' : 'check'), traite ? 'Remettre à traiter' : 'Marquer comme traité') : null,
      alerteBodaccFiche(o),
      blocSatisfaction(o),
      h('div', { class: 'bz-fiche__groupes' },
        modifiable && o.famille !== 'organisation' ? h('dl', { class: 'bz-champs-fiche' }, ligneChampFiche(o, { id: '__nom', libelle: o.type === 'courrier' ? 'Objet' : 'Nom', type: 'texte', valeur: o.nom }, true)) : null,
        groupes.map((g) => h('details', { class: 'bz-fiche__groupe', open: ouverts.has(g.id), ontoggle: (e) => { if (e.target.open) ouverts.add(g.id); else ouverts.delete(g.id); } },
          h('summary', { class: 'bz-fiche__groupe-titre' }, icone('chevron-down', { taille: 'sm', classe: 'bz-repli__chevron' }), h('span', { texte: g.titre }), h('span', { class: 'bz-t-micro bz-texte-2', texte: ` ${g.champs.length}` })),
          h('dl', { class: 'bz-champs-fiche' }, g.champs.map((c) => ligneChampFiche(o, c, modifiable)))))),
      h('p', { class: 'bz-fiche__source bz-t-petit bz-texte-2' },
        h('span', { texte: `${o.source.libelle} · mis à jour ${dateRelative(o.majLe)}` }),
        popoverProvenance('provenance-fiche', [
          ['Source', o.source.libelle],
          ['Mis à jour', dateHeure(o.majLe)],
          ['Fraîcheur', FRAICHEUR[o.fraicheur] ?? o.fraicheur],
          ['Méthode', NATURE[o.provenance] ?? o.provenance],
          ['Données', LIBELLES.mode[o.mode] === 'Fictif (démo)' ? 'Exemple' : o.mode === 'simulation' ? 'Simulation' : 'Vos données'],
        ])),
      modifiable && f.objet.source.id.startsWith('connecteur:') ? h('p', { class: 'bz-t-micro bz-texte-2', texte: `Une modification est reportée dans « ${f.objet.source.libelle} ».` }) : null,
      blocProposer(o),
      blocDonneesPersonnelles(o),
      f.quetes.length && !modeCalme() ? h('section', { class: 'bz-fiche__section' }, h('h3', { class: 'bz-t-titre-4', texte: 'Quêtes' }), h('ul', { class: 'bz-liste-simple' }, f.quetes.map((q) => h('li', { class: 'bz-quete-fiche' },
        icone(q.statut === 'achevee' ? 'circle-check' : JEU.iconeQuete(q.origine.regle), { taille: 'sm' }),
        h('span', {}, h('strong', { texte: JEU.titreQuete(q.origine.regle, [o.nom]) }),
          q.statut === 'achevee' ? null : h('span', { class: 'bz-badge bz-badge--xp', texte: `+${JEU.RECOMPENSE[q.gravite] ?? JEU.RECOMPENSE.attention} XP` }),
          h('span', { class: 'bz-t-petit bz-texte-2', texte: q.statut === 'achevee' ? ` · Terminée ${dateRelative(q.acheveeLe)}, preuve : ${q.preuve?.valeur ?? '—'} pour un seuil de ${q.preuve?.seuil ?? '—'}` : ` · ${q.objectif}` })))))) : null,
      rendreActions(f, entete),
      f.historique.length ? h('details', { class: 'bz-fiche__groupe' },
        h('summary', { class: 'bz-fiche__groupe-titre' }, icone('chevron-down', { taille: 'sm', classe: 'bz-repli__chevron' }), h('span', { texte: 'Historique' }), h('span', { class: 'bz-t-micro bz-texte-2', texte: ` ${f.historique.length}` })),
        h('ol', { class: 'bz-historique', role: 'list' }, f.historique.map((a) => h('li', {},
          h('strong', { texte: LIBELLES.etat[a.etat] ?? a.etat }), h('span', { texte: ` · ${resumeParametres(a)}` }), a.message ? h('p', { class: 'bz-t-petit', texte: a.message }) : null,
          h('p', { class: 'bz-t-micro bz-texte-2', texte: `${dateHeure(a.majLe)}${a.via ? ` · demandé par ${REG.viaEnClair(a.via)}` : ''}${a.approuvePar ? ` · approuvé par ${sansDemo(a.approuveParNom ?? a.approuvePar)}` : ''}${a.mode === 'simulation' ? ' · simulation' : ''}` }))))) : null),
  );
  el.setAttribute('aria-labelledby', 'fiche-titre');
}

/**
 * Droits des personnes (administrateurs) : télécharger ce que le jeu garde sur la fiche (droit d'accès), l'anonymiser
 * ou l'effacer (droit à l'effacement, départ d'un salarié), en cascade côté serveur.
 */
function blocDonneesPersonnelles(o) {
  const m = E.monde;
  if (!m.profil.peutAdministrer || o.famille === 'organisation' || m.mode === 'simulation' || E.apercu || o.source?.id === 'effacement') return null;
  const nom = sansDemo(o.nom);
  const telechargerDonnees = async () => {
    try {
      const d = await api('GET', `/objets/${encodeURIComponent(o.id)}/donnees`);
      telecharger(`donnees-${nom.normalize('NFD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'fiche'}.json`, JSON.stringify(d, null, 2), 'application/json');
      informer('Données téléchargées : remettez ce fichier à la personne qui les demande.', 'ok');
    } catch (err) { if (!err.session) informer(err.message, 'erreur'); }
  };
  const effacer = async (mode) => {
    const anonymiser = mode === 'anonymiser';
    if (!(await confirmerDialogue({
      titre: anonymiser ? `Anonymiser « ${nom} » ?` : `Effacer « ${nom} » ?`,
      texte: anonymiser
        ? 'Le nom et les textes libres (e-mail, contact, commentaire…) sont effacés, ainsi que son planning et son nom dans le journal ; les chiffres et les dates restent pour vos statistiques. C’est définitif.'
        : 'La fiche disparaît, ainsi que son nom dans les autres fiches et dans le journal (et son planning, pour un salarié). C’est définitif. Les sauvegardes l’oublient au bout de 30 jours, et une restauration ne la fait pas revenir.',
      confirmer: anonymiser ? 'Anonymiser' : 'Effacer définitivement', annuler: 'Garder', danger: true,
    }))) return;
    try {
      const r = await api('DELETE', `/objets/${encodeURIComponent(o.id)}`, { mode });
      informer(anonymiser ? 'Fiche anonymisée.' : 'Fiche effacée.', 'ok');
      if (r.outils?.length) informer(`Effacez-la aussi dans ${r.outils.join(', ')} : elle n’en sera plus réimportée, mais elle y est toujours.`, 'attention');
      if (!anonymiser) fermerFiche();
      await charger();
      if (anonymiser) await selectionner(o.id);
    } catch (err) { if (!err.session) informer(err.message, 'erreur'); }
  };
  const ouverts = E.groupesFiche ??= new Set(['coordonnees', 'suivi', 'chiffres', 'dates']);
  return h('details', { class: 'bz-fiche__groupe', open: ouverts.has('donnees-personnelles'), ontoggle: (e) => { if (e.target.open) ouverts.add('donnees-personnelles'); else ouverts.delete('donnees-personnelles'); } },
    h('summary', { class: 'bz-fiche__groupe-titre' }, icone('chevron-down', { taille: 'sm', classe: 'bz-repli__chevron' }), h('span', { texte: 'Données personnelles' })),
    h('div', { class: 'bz-pile' },
      h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Une personne demande ses données ou leur effacement (client, salarié parti…) : téléchargez-les pour les lui remettre, anonymisez la fiche pour garder les chiffres, ou effacez-la.' }),
      h('div', { class: 'bz-groupe-boutons' },
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: telechargerDonnees }, icone('download', { taille: 'sm' }), 'Télécharger ses données'),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => effacer('anonymiser') }, icone('eye-off', { taille: 'sm' }), 'Anonymiser'),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--critique bz-bouton--sm', onclick: () => effacer('supprimer') }, icone('trash-2', { taille: 'sm' }), 'Effacer la fiche'))));
}

async function entrerDans(o) {
  if (E.vue !== 'carte') { E.vue = 'carte'; rendreBarre(); await rendreVue(); }
  if (o.famille === 'departement' && E.vueCarte !== 'departements') await changerVueCarte('departements');
  if (o.famille === 'lieu' && E.vueCarte !== 'entreprise') await changerVueCarte('entreprise');
  E.scene?.entrer(o.id);
}

function alerteBodaccFiche(o) {
  const a = E.monde.bodacc?.alertes?.find((x) => x.objetId === o.id);
  if (!a) return null;
  return h('section', { class: 'bz-resultat', 'data-ton': 'critique' }, iconeEtat('critique', { decoratif: true }),
    h('div', { class: 'bz-pile' },
      h('strong', { texte: `Annonces légales (BODACC) : ${a.nature}` }),
      h('span', { class: 'bz-t-petit', texte: `Publiée ${dateRelative(a.le)}${a.tribunal ? `, ${a.tribunal}` : ''}.` }),
      a.url ? h('a', { href: a.url, target: '_blank', rel: 'noopener noreferrer', class: 'bz-t-petit' }, 'Voir l’annonce', icone('external-link', { taille: 'sm' })) : null));
}
function blocProposer(o) {
  if (o.famille !== 'tiers' || o.mode === 'demo' || !(E.monde.profil.peutAdministrer || E.monde.profil.peutPreparer)) return null;
  return h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, icone('bz-nexus', { taille: 'sm' }),
    h('span', {}, `Invitez ${sansDemo(o.nom)} sur Breizhcosystem : un mois offert à chacun, et vous êtes reliés directement. `,
      h('button', { type: 'button', class: 'bz-lien', onclick: () => proposerNexus(o), texte: 'Proposer Breizhcosystem' })));
}

function blocSatisfaction(o) {
  const m = E.monde;
  if (o.famille === 'tiers') {
    const c = m.satisfaction?.clients?.[o.id];
    if (!c && !o.roles.some((r) => r.id === 'client')) return null;
    const note = c?.note;
    return h('section', { class: 'bz-fiche__section' },
      h('div', { class: 'bz-fiche__section-tete' }, h('h3', { class: 'bz-t-titre-4', texte: 'Satisfaction' }),
        note !== null && note !== undefined ? h('span', { class: 'bz-t-chiffre bz-fiche__note', texte: `${note} sur 10` }) : h('span', { class: 'bz-t-chiffre bz-texte-2', 'data-certitude': 'absent' }, '—', h('span', { class: 'bz-t-petit', texte: ' Pas encore d’avis' }))),
      c?.historique?.length ? h('div', { class: 'bz-fiche__notes' }, courbeNotes(c.historique), h('span', { class: 'bz-t-petit bz-texte-2', texte: `${pluriel(c.nb, 'réponse', 'réponses')} · dernière ${dateRelative(c.le)}${c.statut === 'ancienne' ? ', il y a plus de 6 mois' : ''}` }))
        : h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Pas encore d’avis : envoyez-lui un formulaire, la réponse s’affichera ici, datée.' }),
      c?.envoyeLe ? h('p', { class: 'bz-t-petit bz-texte-2', texte: `Formulaire envoyé ${dateRelative(c.envoyeLe)}, en attente de réponse.` }) : null,
      m.profil.peutPreparer ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => envoyerFormulaire(o.id) }, icone('send', { taille: 'sm' }), c?.envoyeLe ? 'Renvoyer un formulaire' : 'Envoyer un formulaire de satisfaction') : null);
  }
  if (o.famille === 'personne' && m.profil.peutAdministrer) {
    return h('section', { class: 'bz-fiche__section' }, h('h3', { class: 'bz-t-titre-4', texte: 'Baromètre d’équipe (anonyme)' }),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: 'La réponse ne porte que le service, jamais le nom. Résultats par service à partir de 3 réponses.' }),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => envoyerFormulaire(o.id) }, icone('send', { taille: 'sm' }), 'Envoyer le baromètre à cette personne'));
  }
  return null;
}

function resumeParametres(a) {
  const p = a.parametres;
  if (a.capacite === 'objet.modifier') { try { const x = JSON.parse(p.modif); return `modifié : ${[...(x.nom ? ['nom'] : []), ...Object.keys(x.champs)].join(', ')} · par ${a.acteur}`; } catch { return `modification · par ${a.acteur}`; } }
  if (a.capacite === 'mouvement') return `${p.delta > 0 ? '+' : ''}${nf.format(p.delta)}${p.motif ? ` · ${p.motif}` : ''} · par ${a.acteur}`;
  return `${p.titre}${p.echeance ? ` · échéance ${date(p.echeance)}` : ''} · par ${a.acteur}`;
}

// ---------------------------------------------------------------- actions (préparer → vérifier → confirmer)
const nouveauFormulaire = (a) => {
  const f = { ...a, cle: cle(), etape: 'saisie', valeurs: { sens: 'entree', quantite: '', motif: '', titre: '', echeance: '' }, erreur: null, envoi: false };
  if (a.capacite === 'objet.modifier' && E.fiche) {
    f.valeurs.nom = E.fiche.objet.nom;
    f.valeurs.champs = Object.fromEntries(E.fiche.objet.champs.map((c) => [c.id, c.lien ? c.lien.id : c.valeur]));
    f.initial = structuredClone(f.valeurs);
  }
  return f;
};
function changementsFiche(F) {
  const ch = {};
  for (const [k, v] of Object.entries(F.valeurs.champs)) {
    const avant = F.initial.champs[k] ?? null;
    const apres = v === '' ? null : v;
    if (String(avant ?? '') !== String(apres ?? '')) ch[k] = apres;
  }
  const nom = F.valeurs.nom.trim() !== F.initial.nom ? F.valeurs.nom.trim() : null;
  return { champs: ch, nom };
}
const LIBELLE_ACTION = { mouvement: 'Enregistrer un mouvement', 'tache.creer': 'Créer une tâche liée' };
const champAction = (id, libelle, controle, aide = null) => h('div', { class: 'bz-champ' },
  h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }), aide ? h('span', { class: 'bz-champ__aide', id: `${id}-aide`, texte: aide }) : null, controle);

/** Autres actions de la fiche (mouvement de stock, tâche liée) : saisie, puis « Vérifiez avant de confirmer ». */
function rendreActions(f, entete = []) {
  if (!f.actionsPossibles.length) return h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, icone('lock', { taille: 'sm' }), h('span', { texte: 'Lecture seule pour votre rôle.' }));
  const F = E.formulaire && E.formulaire.capacite !== 'objet.modifier' ? E.formulaire : null;
  if (!F) {
    const enTete = new Set(entete.filter((a) => a.genre === 'action').map((a) => `${a.capacite}|${a.action?.champ ?? ''}`));
    const autres = f.actionsPossibles.filter((a) => a.capacite !== 'objet.modifier' && !enTete.has(`${a.capacite}|${a.champ ?? ''}`));
    if (!autres.length) return null;
    return h('section', { class: 'bz-fiche__section', 'aria-labelledby': 'fiche-agir' }, h('h3', { class: 'bz-t-titre-4', id: 'fiche-agir', texte: 'Autres actions' }),
      h('div', { class: 'bz-groupe-boutons' }, autres.map((a) => h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { E.formulaire = nouveauFormulaire(a); rendreFiche(); setTimeout(() => $('#fiche form input, #fiche form select')?.focus(), 0); } },
        icone(a.capacite === 'mouvement' ? 'arrow-up-down' : 'list-checks'), a.capacite === 'mouvement' ? a.libelle.replace(/^Enregistrer un mouvement — /, 'Mouvement : ') : LIBELLE_ACTION[a.capacite] ?? a.libelle))));
  }
  const v = F.valeurs;
  const sim = E.monde.mode === 'simulation';
  const champActuel = f.objet.champs.find((c) => c.id === F.champ);
  const fermerForm = () => { E.formulaire = null; rendreFiche(); };
  const titre = F.capacite === 'mouvement' ? `Mouvement : ${champActuel?.libelle ?? F.champ}` : LIBELLE_ACTION[F.capacite] ?? F.libelle;
  if (F.etape === 'saisie') {
    const champs = F.capacite === 'mouvement'
      ? [
          h('div', { class: 'bz-segments', role: 'radiogroup', 'aria-label': 'Sens du mouvement' },
            [['entree', 'Entrée (+)'], ['sortie', 'Sortie (−)']].map(([k, l]) => h('button', { type: 'button', role: 'radio', 'aria-checked': v.sens === k, onclick: () => { v.sens = k; rendreFiche(); }, texte: l }))),
          champAction('action-quantite', `Quantité${F.unite ? ` (${F.unite})` : ''}`, h('input', { id: 'action-quantite', class: 'bz-champ__saisie', type: 'text', inputmode: 'decimal', required: true, value: v.quantite, 'aria-invalid': F.erreur ? 'true' : null, oninput: (e) => (v.quantite = e.target.value) })),
          champAction('action-motif', 'Motif (facultatif)', h('input', { id: 'action-motif', class: 'bz-champ__saisie', type: 'text', maxlength: '200', value: v.motif, oninput: (e) => (v.motif = e.target.value) })),
        ]
      : [
          champAction('action-titre', 'Titre de la tâche', h('input', { id: 'action-titre', class: 'bz-champ__saisie', type: 'text', maxlength: '200', required: true, value: v.titre, 'aria-invalid': F.erreur ? 'true' : null, oninput: (e) => (v.titre = e.target.value) })),
          champAction('action-echeance', 'Échéance (facultatif)', h('input', { id: 'action-echeance', class: 'bz-champ__saisie', type: 'date', value: v.echeance, oninput: (e) => (v.echeance = e.target.value) })),
        ];
    return h('form', { class: 'bz-fiche__section bz-formulaire', 'aria-labelledby': 'fiche-action-titre', onsubmit: (e) => {
        e.preventDefault();
        const q = Number(String(v.quantite).replace(',', '.'));
        if (F.capacite === 'mouvement' && !(q > 0)) { F.erreur = 'Indiquez une quantité positive.'; rendreFiche(); return; }
        if (F.capacite === 'mouvement') v.quantite = String(q);
        if (F.capacite === 'tache.creer' && !v.titre.trim()) { F.erreur = 'Indiquez un titre.'; rendreFiche(); return; }
        F.erreur = null;
        F.etape = 'confirmation';
        rendreFiche();
        setTimeout(() => $('#fiche-confirmation')?.focus(), 0);
      } },
      h('h3', { class: 'bz-t-titre-4', id: 'fiche-action-titre', texte: titre }), champs,
      F.erreur ? h('p', { class: 'bz-champ__erreur', role: 'alert' }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: F.erreur })) : null,
      h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--principal', type: 'submit' }, 'Vérifier'), h('button', { class: 'bz-bouton bz-bouton--fantome', type: 'button', onclick: fermerForm }, 'Annuler')));
  }
  const delta = (v.sens === 'sortie' ? -1 : 1) * Number(v.quantite);
  const effet = F.capacite === 'mouvement'
    ? `${champActuel?.libelle ?? F.champ} : ${typeof champActuel?.valeur === 'number' ? nf.format(champActuel.valeur) : '?'} → ${typeof champActuel?.valeur === 'number' ? nf.format(champActuel.valeur + delta) : '?'} (${delta > 0 ? '+' : ''}${nf.format(delta)}${F.unite ? ` ${F.unite}` : ''})`
    : `Nouvelle tâche « ${v.titre.trim()} »${v.echeance ? `, échéance ${date(v.echeance)}` : ''}`;
  return h('section', { class: 'bz-fiche__section bz-confirmation', 'data-simulation': sim ? '' : null, 'aria-labelledby': 'fiche-confirmation', role: 'group' },
    h('h3', { class: 'bz-t-titre-4', id: 'fiche-confirmation', tabindex: '-1', texte: 'Vérifiez avant de confirmer' }),
    h('dl', { class: 'bz-champs-fiche' },
      [['Effet', effet], ['Fiche', `${f.objet.libelleType} · ${sansDemo(f.objet.nom)}`], ['Auteur', sansDemo(E.monde.profil.nom)],
        ['Mode', sim ? 'Simulation : rien n’est écrit' : f.objet.mode === 'demo' ? 'Exemple : données fictives' : 'Vos données'],
        ['Validation', E.monde.profil.peutApprouver ? 'Exécution immédiate : votre rôle permet d’approuver.' : 'Envoyée pour approbation à une personne habilitée.']]
        .map(([k, x]) => h('div', { class: 'bz-champ-fiche' }, h('dt', { class: 'bz-champ-fiche__libelle', texte: k }), h('dd', { class: 'bz-champ-fiche__valeur', texte: x })))),
    F.erreur ? h('p', { class: 'bz-champ__erreur', role: 'alert' }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: F.erreur })) : null,
    h('div', { class: 'bz-groupe-boutons' },
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', 'aria-busy': F.envoi ? 'true' : null, onclick: () => { if (!F.envoi) envoyerAction(f, delta); } }, F.envoi ? icone('loader-circle') : null, F.envoi ? 'Envoi…' : 'Confirmer'),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', 'aria-disabled': F.envoi ? 'true' : null, onclick: () => { if (F.envoi) return; F.etape = 'saisie'; rendreFiche(); } }, 'Modifier')),
    h('p', { class: 'bz-t-micro bz-texte-2', texte: 'Un double clic ou une nouvelle tentative n’enregistre qu’une seule fois cette action.' }));
}

async function envoyerAction(f, delta) {
  const F = E.formulaire;
  if (!F || F.envoi) return;
  F.envoi = true;
  rendreFiche();
  const parametres = F.capacite === 'objet.modifier'
    ? (() => { const d = changementsFiche(F); return { champs: d.champs, ...(d.nom ? { nom: d.nom } : {}) }; })()
    : F.capacite === 'mouvement' ? { champ: F.champ, delta, motif: F.valeurs.motif.trim() } : { titre: F.valeurs.titre.trim(), ...(F.valeurs.echeance ? { echeance: F.valeurs.echeance } : {}) };
  try {
    const a = await api('POST', '/actions', { cle: F.cle, capacite: F.capacite, cible: f.objet.id, parametres, executer: E.monde.profil.peutApprouver });
    E.formulaire = null;
    const t = { reussie_technique: ['ok', `Action enregistrée${a.message ? ` : ${a.message}` : ''}.`], en_attente: ['', 'Action envoyée pour approbation.'], echouee: ['erreur', `Action refusée : ${a.message ?? 'échec'}`], resultat_inconnu: ['erreur', 'Résultat inconnu : vérifiez avant de relancer.'] }[a.etat] ?? ['', LIBELLES.etat[a.etat]];
    informer(t[1], t[0]);
    await charger();
    // la confirmation a disparu : le focus revient au titre de la fiche, jamais sur <body>
    if (!$('#fiche')?.contains(document.activeElement)) $('#fiche-titre')?.focus({ preventScroll: true });
  } catch (e) {
    F.envoi = false; // même clé conservée : une nouvelle tentative ne crée pas de doublon
    F.erreur = e.message;
    rendreFiche();
  }
}

async function approuver(cleAction) {
  try {
    const a = await api('POST', `/actions/${encodeURIComponent(cleAction)}/approuver`);
    informer(a.etat === 'reussie_technique' ? `Approuvée et enregistrée${a.message ? ` : ${a.message}` : ''}.` : `${LIBELLES.etat[a.etat]}${a.message ? ` : ${a.message}` : ''}`, a.etat === 'reussie_technique' ? 'ok' : 'erreur');
    await charger();
  } catch (e) {
    informer(e.message, 'erreur');
  }
}

async function basculerSimulation(actif) {
  await api('POST', '/simulation', { actif });
  informer(actif ? 'Simulation activée : copie isolée de votre monde.' : 'Simulation quittée : état réel restauré.', actif ? 'attention' : 'ok');
  await charger();
}

// ---------------------------------------------------------------- assistant « Connecter mes données »
// ---------------------------------------------------------------- « Connecter mes données » : un seul assistant (§6.1 P4, §4.21, §4.14)
/* Une question d'entrée (« Où sont vos clients aujourd'hui ? »), 3 recommandations, puis le catalogue filtrable :
   web/connecter.js (module pur) décide quoi proposer. Chaque parcours (fichier, logiciel synchronisé, comptabilité,
   saisie, création) est un assistant à étapes dans un <dialog> lg, en feuille plein écran sur téléphone : liste
   d'étapes à gauche (ordinateur) ou barre de 4 px et « Étape 2 sur 5 · … » (téléphone), pied collant avec « Retour » et
   une seule action principale, titre de l'étape annoncé et focalisé. Le voile ne ferme pas le parcours ; Échap et
   « Fermer » demandent « Abandonner ? » dès qu'un réglage est commencé. Les valeurs saisies sont gardées d'une étape à
   l'autre (Retour, Continuer) ; rien n'est écrit dans le navigateur, sauf la réponse à la question (préférence). */
let CONNECTER = null;
const chargerConnecter = async () => (CONNECTER ??= await import('/connecter.js'));
const REPONSE_LOCALE = 'lb-connecter-reponse';

function ciblesImport() {
  const u = E.monde.univers;
  const typeTiers = u.types.find((t) => t.famille === 'tiers')?.id;
  const tiers = ['client', 'fournisseur', 'partenaire', 'prospect'].map((r) => u.roles.find((x) => x.id === r)).filter(Boolean)
    .map((r) => ({ cle: `role:${r.id}`, libelle: r.pluriel, sous: 'entreprises, particuliers, collectivités', type: typeTiers, roles: [r.id] }));
  const autres = u.types.filter((t) => !['tiers', 'organisation', 'evenement', 'indicateur'].includes(t.famille))
    .map((t) => ({ cle: `type:${t.id}`, libelle: t.pluriel, sous: { personne: 'équipe', lieu: 'vos sites', ressource: 'stock et matériel', commande: 'ventes et achats', projet: 'affaires en cours', tache: 'à faire' }[t.famille] ?? '', type: t.id, roles: [] }));
  return [...tiers, ...autres];
}
/** Cible complète (libellé, clé) depuis { type, roles } passé par une liste ou par « Compléter mon entreprise ». */
function cibleDe(cible) {
  if (!cible) return null;
  const c = ciblesImport().find((x) => x.type === cible.type && (x.roles?.[0] ?? null) === (cible.roles?.[0] ?? null));
  return c ?? { cle: `type:${cible.type}`, libelle: E.monde.univers.types.find((t) => t.id === cible.type)?.pluriel ?? 'Données', sous: '', type: cible.type, roles: cible.roles ?? [] };
}

function nouvelAssistant(etape = 'choisir', cible = null) {
  const r = lireLocal(REPONSE_LOCALE);
  const e = etape === 'source' ? 'choisir' : etape;
  return {
    parcours: 'fichier', etape: e, entree: null, etapeAffichee: null,
    reponse: CONNECTER?.REPONSES.some((x) => x.id === r) ? r : null, toutVoir: false, famille: null, recherche: '', choixBientot: null,
    connecteurs: null, erreurCatalogue: null,
    source: e === 'fichier' ? 'csv' : null, cible: cibleDe(cible), csv: '', nomFichier: 'fichier.csv', url: '', analyse: null, mapping: {}, resultat: null,
    outil: null, fec: null, nomEntreprise: lireLocal(NOM_SOUHAITE) ?? '', dansExemple: false, erreur: null, envoi: false, confirmation: false,
  };
}

/** Ouvre l'assistant (au choix, ou directement à l'étape « fichier » pour une cible donnée). */
async function ouvrirAssistant(etape = 'choisir', cible = null) {
  await chargerConnecter();
  const reprise = (etape === 'choisir' || etape === 'source') && !cible ? E.brouillonAssistant : null;
  E.brouillonAssistant = null;
  E.assistant = reprise ?? nouvelAssistant(etape, cible);
  E.assistant.etapeAffichee = null;
  monterAssistant();
  rendreAssistant();
  chargerCatalogue();
}
/** Import du fichier des écritures comptables (FEC), dans le même assistant. */
async function ouvrirFec() {
  await chargerConnecter();
  E.assistant = nouvelAssistant('choisir');
  Object.assign(E.assistant, { parcours: 'fec', etape: 'fec', fec: { envoi: false, resultat: null, nom: '' } });
  monterAssistant();
  rendreAssistant();
  chargerCatalogue();
}
/** Un logiciel précis (Réglages, « Compléter mon entreprise ») : l'assistant s'ouvre à l'étape « Se connecter ». */
async function ouvrirConnecteur(sourceId) {
  await chargerConnecter();
  try { if (!E.sources) E.sources = await api('GET', '/sources'); } catch (e) { informer(e.message, 'erreur'); return; }
  const s = E.sources.find((x) => x.id === sourceId);
  if (!s) return;
  E.assistant = nouvelAssistant('choisir');
  monterAssistant();
  demarrerOutil(E.assistant, s);
  chargerCatalogue();
}

async function chargerCatalogue() {
  const A = E.assistant;
  if (!A) return;
  A.erreurCatalogue = null;
  try {
    const [sources, connecteurs] = await Promise.all([E.sources ? Promise.resolve(E.sources) : api('GET', '/sources'), api('GET', '/connecteurs')]);
    E.sources = sources;
    A.connecteurs = connecteurs;
  } catch (e) {
    if (e.session) return;
    A.erreurCatalogue = e.message;
  }
  if (E.assistant === A && A.etape === 'choisir') majConseils(A);
}

/** Le <dialog> de l'assistant : créé une fois par ouverture, ses zones sont redessinées par remplir() (focus gardé). */
function monterAssistant() {
  if (E.assistantDlg?.isConnected && E.assistantDlg.open) return E.assistantDlg;
  const d = h('dialog', { class: 'bz-dialogue bz-dialogue--lg bz-assistant', 'data-parcours': '', 'aria-labelledby': 'assistant-titre' },
    h('div', { class: 'bz-dialogue__cadre' },
      h('header', { class: 'bz-dialogue__tete' },
        h('div', { class: 'bz-assistant__entete' },
          h('p', { class: 'bz-t-surtitre', id: 'assistant-surtitre' }),
          h('h2', { class: 'bz-dialogue__titre bz-t-titre-3', id: 'assistant-titre' })),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', 'aria-label': 'Fermer', 'data-infobulle': 'Fermer', onclick: demanderFermeture }, icone('x'))),
      h('div', { class: 'bz-assistant__progression', id: 'assistant-progression' }),
      h('div', { class: 'bz-assistant__grille', id: 'assistant-grille' },
        h('nav', { class: 'bz-etapes', id: 'assistant-etapes', 'aria-label': 'Étapes' }),
        h('div', { class: 'bz-dialogue__corps bz-assistant__corps', id: 'assistant-corps' })),
      h('footer', { class: 'bz-dialogue__pied', id: 'assistant-pied' })));
  d.addEventListener('cancel', (e) => { e.preventDefault(); demanderFermeture(); });
  d.addEventListener('close', () => {
    if (E.assistantDlg !== d) { setTimeout(() => d.remove(), 0); return; } // un nouvel assistant a déjà pris la place
    const A = E.assistant;
    // Échap imposé par le navigateur (deux Échap de suite sans autre geste) : un parcours commencé n'est jamais perdu
    // sans confirmation ; on le rouvre et on pose la question.
    if (A && aConfirmer(A)) {
      try { d.showModal(); } catch { /* déjà ouvert */ }
      demanderFermeture();
      return;
    }
    setTimeout(() => d.remove(), 0);
    E.assistantDlg = null;
    if (A) { if (A.outil) nettoyerOutil(A.outil); E.assistant = null; }
    if (E.majEnAttente && !occupe()) rafraichirEnDirect();
  });
  document.body.append(d);
  preparerDialogue(d);
  E.assistantDlg = d;
  ouvrirDialogue(d);
  return d;
}

/** Ferme l'assistant. `garder` : on part ailleurs (pas à pas, saisie) et l'assistant reprendra à la même étape. */
function fermerAssistant({ garder = false } = {}) {
  const A = E.assistant;
  if (A) {
    if (A.outil) nettoyerOutil(A.outil);
    E.brouillonAssistant = garder && A.etape !== 'pret' ? A : null;
  }
  E.assistant = null;
  // nettoyage tout de suite, sans attendre l'événement « close » (différé quand l'onglet est en arrière-plan)
  const d = E.assistantDlg;
  E.assistantDlg = null;
  if (d?.open) d.close();
  if (d) setTimeout(() => d.remove(), 0);
  if (E.majEnAttente) setTimeout(() => { if (!occupe()) rafraichirEnDirect(); }, 0);
}
function nomParcours(A) {
  if (A.parcours === 'outil' && A.outil) return `la connexion à ${A.outil.s.oauth?.nom ?? A.outil.s.nom}`;
  return { fec: 'l’import de la comptabilité', zero: 'la création de votre entreprise', manuel: 'l’ajout à la main' }[A.parcours] ?? 'l’import du fichier';
}
const connexionEnCours = (A) => A.parcours === 'outil' && (Boolean(A.outil?.oauth && A.outil.oauth.statut !== 'connecte') || A.outil?.connexion?.statut === 'attente');
/** Quelque chose a-t-il été saisi ou obtenu ? Sans rien, on ferme sans demander (P4 : pas de confirmation inutile). */
function saisieCommencee(A) {
  if (A.etape === 'colonnes') return true;
  if (A.parcours === 'outil' && A.outil) {
    const C = A.outil;
    return Boolean(C.cree || C.apercu || C.oauth?.statut === 'connecte' || C.connexion?.statut === 'connecte'
      || Object.entries(C.config).some(([k, v]) => String(v ?? '').trim() && !(C.s.id === 'sheets' && k === 'jeton')));
  }
  // un nom seulement prérempli (celui de l'installation) n'est pas une saisie : on ferme sans demander
  if (A.parcours === 'zero') return Boolean(A.nomEntreprise.trim()) && A.nomEntreprise !== (lireLocal(NOM_SOUHAITE) ?? '');
  if (A.parcours === 'fec') return Boolean(A.fec?.nom || A.fec?.envoi);
  return Boolean(A.csv || A.url || A.analyse);
}
const aConfirmer = (A) => CONNECTER?.abandonAConfirmer({ etape: A.etape, connexionEnCours: connexionEnCours(A), saisie: saisieCommencee(A) });
/** Échap, « Fermer » : « Abandonner ? » dès qu'un réglage est commencé ou qu'une connexion est en cours (§4.14). */
async function demanderFermeture() {
  const A = E.assistant;
  if (!A) { E.assistantDlg?.close(); return; }
  if (aConfirmer(A)) {
    if (A.confirmation) return;
    A.confirmation = true;
    const ok = await confirmerDialogue({ titre: `Abandonner ${nomParcours(A)} ?`, texte: 'Vos réglages ne seront pas gardés.', confirmer: 'Abandonner', annuler: 'Continuer' });
    A.confirmation = false;
    if (!ok || E.assistant !== A) return;
  }
  fermerAssistant();
}
function allerEtape(etape) {
  const A = E.assistant;
  if (!A) return;
  A.erreur = null;
  A.etape = etape;
  rendreAssistant();
}

const TITRES_PARCOURS = { fichier: 'Importer un fichier', manuel: 'Ajouter à la main', fec: 'Importer ma comptabilité', zero: 'Créer mon entreprise' };
function titreEtape(A) {
  const nom = A.outil ? (A.outil.s.oauth?.nom ?? A.outil.s.nom) : '';
  if (A.etape === 'choisir') return exempleAChoisir(A) ? 'Votre entreprise, ou un essai dans l’exemple ?' : CONNECTER.QUESTION;
  if (A.etape === 'contenu') return A.parcours === 'manuel' ? 'Que voulez-vous ajouter ?' : 'Que contient ce fichier ?';
  if (A.etape === 'fichier') return { csv: 'Choisissez le fichier', sheets: 'Collez le lien de la feuille', coller: 'Collez vos lignes' }[A.source ?? 'csv'];
  if (A.etape === 'colonnes') return 'Associer les colonnes';
  if (A.etape === 'connexion') return `Se connecter à ${nom}`;
  if (A.etape === 'fec') return 'Déposez le fichier des écritures comptables';
  if (A.etape === 'zero') return 'Le nom de votre entreprise';
  return A.parcours === 'fec' ? 'Vos chiffres clés' : 'C’est prêt';
}

function rendreAssistant() {
  const A = E.assistant;
  const d = E.assistantDlg;
  if (!A || !d || !CONNECTER) return;
  const { PARCOURS, progression } = CONNECTER;
  const p = progression(A.parcours, A.etape);
  const avecEtapes = A.etape !== 'choisir';
  const titre = A.etape === 'choisir' ? 'Connecter mes données'
    : A.parcours === 'outil' && A.outil ? `Connecter ${A.outil.s.nom}`
    : A.parcours === 'fichier' && A.source === 'sheets' ? 'Importer depuis Google Sheets'
    : A.parcours === 'fichier' && A.source === 'coller' ? 'Copier-coller un tableau'
    : TITRES_PARCOURS[A.parcours] ?? 'Connecter mes données';
  remplir($('#assistant-surtitre'), A.etape === 'choisir' ? null : 'Connecter mes données');
  $('#assistant-surtitre').hidden = A.etape === 'choisir';
  remplir($('#assistant-titre'), typo(titre));
  const prog = $('#assistant-progression');
  prog.hidden = !avecEtapes;
  remplir(prog, avecEtapes ? [h('progress', { class: 'bz-assistant__barre', max: String(p.total), value: String(p.index + 1), 'aria-hidden': 'true' }), h('span', { texte: p.texte })] : null);
  const grille = $('#assistant-grille');
  if (avecEtapes) grille.setAttribute('data-etapes', ''); else grille.removeAttribute('data-etapes');
  const etapes = PARCOURS[A.parcours] ?? PARCOURS.fichier;
  remplir($('#assistant-etapes'), avecEtapes ? h('ol', {}, etapes.map(([k, l], i) => {
    const etat = i < p.index ? 'faite' : i === p.index ? 'courante' : 'future';
    const contenu = [etat === 'faite' ? icone('check', { taille: 'sm' }) : h('span', { class: 'bz-etapes__numero', 'aria-hidden': 'true', texte: String(i + 1) }), h('span', { texte: l })];
    return h('li', { 'aria-current': etat === 'courante' ? 'step' : null, 'data-faite': etat === 'faite' ? '' : null },
      etat === 'faite' && A.etape !== 'pret' ? h('button', { type: 'button', onclick: () => allerEtape(k) }, contenu, h('span', { class: 'bz-visuellement-cache', texte: ', terminée' })) : contenu);
  })) : null);
  const [corps, pied] = contenuAssistant(A);
  const erreursChamps = A.parcours === 'outil' && A.etape === 'connexion' ? A.outil?.erreurs ?? null : null;
  remplir($('#assistant-corps'),
    h('h3', { class: 'bz-t-titre-4 bz-assistant__titre-etape', id: 'assistant-etape', tabindex: '-1', texte: titreEtape(A) }),
    erreursChamps ? resumeErreurs(erreursChamps, { idDe: (k) => `outil-${k}`, id: 'assistant-resume-erreurs' }) : null,
    A.erreur ? resultatAssistant('critique', A.erreur, { alerte: true }) : null,
    corps);
  // erreur à l'envoi (§4.6) : le focus va sur le résumé, jamais sur <body>
  if (A.focusErreur) {
    A.focusErreur = false;
    requestAnimationFrame(() => ($('#assistant-resume-erreurs') ?? $('#assistant-corps .bz-resultat[role="alert"]'))?.focus());
  }
  const zonePied = $('#assistant-pied');
  remplir(zonePied, pied);
  zonePied.hidden = !pied.filter(Boolean).length;
  if (A.etapeAffichee !== A.etape) {
    const premiere = A.etapeAffichee === null;
    A.etapeAffichee = A.etape;
    $('#assistant-corps').scrollTop = 0;
    requestAnimationFrame(() => $('#assistant-etape')?.focus({ preventScroll: true }));
    if (!premiere) annoncer(avecEtapes ? `${p.texte}. ${titreEtape(A)}` : titreEtape(A));
  }
}

/** Encadré d'état (résultat, erreur, attente) : icône + texte, jamais la couleur seule. */
function resultatAssistant(ton, texte, { alerte = false, detail = null, actions = null } = {}) {
  return h('div', { class: 'bz-resultat', 'data-ton': ton === 'attente' ? 'info' : ton, role: alerte ? 'alert' : null, tabindex: alerte ? '-1' : null },
    ton === 'attente' ? icone('clock') : iconeEtat(ton, { decoratif: true }),
    h('div', {}, h('strong', { texte }), detail ? h('span', { texte: detail }) : null, actions));
}
const boutonRetour = (vers, libelle = 'Retour') => h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => allerEtape(vers) }, icone('arrow-left'), libelle);
const boutonPrincipal = (libelle, faire, { occupe = false, enCours = libelle } = {}) => h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', cle: 'assistant-principal', 'aria-busy': occupe ? 'true' : null, onclick: () => { if (!occupe) faire(); } },
  occupe ? icone('loader-circle') : null, occupe ? enCours : libelle);

function contenuAssistant(A) {
  if (A.etape === 'choisir') return [corpsChoisir(A), []];
  if (A.etape === 'contenu') return [corpsContenu(A), [boutonRetour('choisir'), boutonPrincipal('Continuer', () => {
    if (!A.cible) { A.erreur = A.parcours === 'manuel' ? 'Choisissez ce que vous voulez ajouter.' : 'Choisissez ce que contient le fichier.'; return rendreAssistant(); }
    if (A.parcours === 'manuel') { const c = A.cible; fermerAssistant(); ouvrirSaisie(c); return undefined; }
    return allerEtape('fichier');
  })]];
  if (A.etape === 'fichier') return [corpsFichier(A), [boutonRetour('contenu'), boutonPrincipal(A.source === 'coller' ? 'Lire ces lignes' : A.source === 'sheets' ? 'Lire la feuille' : 'Lire le fichier', analyser, { occupe: A.envoi, enCours: 'Lecture…' })]];
  if (A.etape === 'colonnes' && A.parcours === 'outil') return [corpsColonnesOutil(A.outil), [boutonRetour('connexion'), boutonPrincipal('Activer la synchronisation', () => activerOutil(A.outil), { occupe: A.envoi, enCours: 'Activation…' })]];
  if (A.etape === 'colonnes') return [corpsColonnes(A), [boutonRetour('fichier'), boutonPrincipal(`Importer ${pluriel(A.analyse?.lignes ?? 0, 'ligne', 'lignes')}`, confirmer, { occupe: A.envoi, enCours: 'Import…' })]];
  if (A.etape === 'connexion') return [corpsConnexion(A.outil), [boutonRetour('choisir'), piedConnexion(A.outil)]];
  if (A.etape === 'fec') return [corpsFec(A), [boutonRetour('choisir')]];
  if (A.etape === 'zero') return [corpsZero(A), [boutonRetour('choisir'), boutonPrincipal('Créer mon entreprise', partirDeZero, { occupe: A.envoi, enCours: 'Création…' })]];
  if (A.parcours === 'fec') return [corpsPretFec(A), [
    h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => fermerAssistant() }, 'Fermer'),
    boutonPrincipal('Voir ma santé financière', () => { fermerAssistant(); changerVue('sante'); })]];
  if (A.parcours === 'outil') return [corpsPretOutil(A.outil), [
    h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { fermerAssistant(); changerVue('reglages:outils'); } }, 'Voir mes logiciels connectés'),
    boutonPrincipal('Voir sur la carte', () => { fermerAssistant(); changerVue('carte'); })]];
  return [corpsPret(A), [
    h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { const r = A.reponse; E.assistant = nouvelAssistant('choisir'); E.assistant.reponse = r; rendreAssistant(); chargerCatalogue(); } }, 'Importer autre chose'),
    boutonPrincipal('Voir sur la carte', () => { fermerAssistant(); changerVue('carte'); })]];
}

// ---- étape 1 : la question, 3 conseils, puis tout le catalogue
/* Dans l'exemple, la première question n'est pas « Où sont vos clients ? » mais « chez vous, ou dans l'exemple ? » :
   importer de vraies données au milieu des données fictives ne doit jamais être le chemin par défaut. */
const exempleAChoisir = (A) => Boolean(E.monde?.organisation.demo && E.monde.profil.peutAdministrer && !A.dansExemple);
const versMonEntreprise = (A) => { A.parcours = 'zero'; allerEtape('zero'); };
function corpsExemple(A) {
  const carte = (titre, texte, bouton) => h('section', { class: 'bz-carte bz-pile bz-pile--serre' }, h('h3', { class: 'bz-carte__titre', texte: titre }), h('p', { class: 'bz-t-petit', texte }), h('div', { class: 'bz-groupe-boutons' }, bouton));
  return [
    h('p', { texte: 'Vous explorez une entreprise exemple : tout y est fictif.' }),
    carte('Remplacer l’exemple par mon entreprise', 'Conseillé. L’exemple est retiré : vous repartez d’une carte vide, à votre nom, prête à recevoir vos clients, votre équipe et vos lieux.',
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', cle: 'assistant-remplacer', onclick: () => versMonEntreprise(A) }, 'Remplacer l’exemple par mon entreprise', icone('arrow-right'))),
    carte('Essayer un import dans l’exemple', 'Pour voir comment ça marche. Ce que vous importez s’ajoute aux données fictives : à éviter avec des données que vous comptez garder.',
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', cle: 'assistant-essayer', onclick: () => { A.dansExemple = true; rendreAssistant(); } }, 'Essayer dans l’exemple')),
  ];
}
function corpsChoisir(A) {
  const demo = E.monde.organisation.demo;
  if (exempleAChoisir(A)) return corpsExemple(A);
  return [
    demo ? resultatAssistant('info', 'Vous essayez dans l’exemple : ce que vous importez s’ajoute aux données fictives.', {
      actions: h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => versMonEntreprise(A) }, 'Remplacer l’exemple par mon entreprise')),
    }) : null,
    h('fieldset', { class: 'bz-grille-choix bz-grille-choix--reponses', 'aria-labelledby': 'assistant-etape' }, CONNECTER.REPONSES.map((r) => h('label', { class: 'bz-choix bz-choix--illustre' },
      h('input', { type: 'radio', name: 'assistant-reponse', value: r.id, checked: A.reponse === r.id, onchange: () => choisirReponse(A, r.id) }),
      h('span', { class: 'bz-choix__illustration', 'aria-hidden': 'true' }, icone(r.icone)),
      h('span', { class: 'bz-choix__texte' }, h('span', { class: 'bz-choix__titre', texte: r.titre }), h('span', { class: 'bz-choix__detail', texte: r.detail }))))),
    h('div', { class: 'bz-pile', id: 'assistant-conseils' }, conseilsEtCatalogue(A)),
  ];
}
/** Choisir une réponse ne redessine pas la question et ne déplace pas le focus (§4.7) : seuls les conseils changent. */
function choisirReponse(A, id) {
  A.reponse = id;
  A.choixBientot = null;
  ecrireLocal(REPONSE_LOCALE, id);
  majConseils(A);
  const n = CONNECTER.recommandations(id, catalogueDe(A) ?? []).length;
  if (n) annoncer(`${pluriel(n, 'conseil', 'conseils')} pour commencer, puis tout le catalogue.`);
}
function majConseils(A) { const z = $('#assistant-conseils'); if (z && E.assistant === A) remplir(z, conseilsEtCatalogue(A)); }
function majCatalogue(A) { const z = $('#assistant-catalogue'); if (z && E.assistant === A) remplir(z, contenuCatalogue(A)); }
const catalogueDe = (A) => (A.connecteurs && E.sources ? CONNECTER.catalogue(E.sources, A.connecteurs, { pasAPas: Boolean(E.monde?.profil.peutAdministrer) }) : null);

function conseilsEtCatalogue(A) {
  if (A.erreurCatalogue) {
    return resultatAssistant('critique', 'Le catalogue n’a pas pu être chargé.', { detail: A.erreurCatalogue,
      actions: h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => { A.erreurCatalogue = null; majConseils(A); chargerCatalogue(); } }, icone('refresh-cw', { taille: 'sm' }), 'Réessayer')) });
  }
  const cat = catalogueDe(A);
  if (!cat) return h('div', { class: 'bz-pile', 'aria-busy': 'true' }, h('span', { class: 'bz-visuellement-cache', texte: 'Chargement du catalogue' }), h('div', { class: 'bz-squelette bz-squelette--logiciels' }));
  const rep = CONNECTER.REPONSES.find((r) => r.id === A.reponse);
  const conseils = rep ? CONNECTER.recommandations(rep.id, cat) : [];
  return [
    rep && conseils.length ? h('section', { class: 'bz-catalogue', 'aria-labelledby': 'assistant-conseils-titre' },
      h('h4', { class: 'bz-catalogue__intertitre', id: 'assistant-conseils-titre', texte: 'Nos conseils pour commencer' }),
      h('ul', { class: 'bz-logiciels bz-logiciels--conseils', role: 'list' }, conseils.map((x) => h('li', {}, carteLogiciel(x, { conseil: true }))))) : null,
    rep || A.toutVoir
      ? h('section', { class: 'bz-catalogue', id: 'assistant-catalogue', 'aria-labelledby': 'assistant-catalogue-titre' }, contenuCatalogue(A))
      : h('p', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => { A.toutVoir = true; majConseils(A); $('#assistant-recherche')?.focus(); } }, 'Voir tout le catalogue sans répondre')),
  ];
}
function contenuCatalogue(A) {
  const cat = catalogueDe(A) ?? [];
  const familles = CONNECTER.famillesPresentes(cat);
  return [
    h('h4', { class: 'bz-catalogue__intertitre', id: 'assistant-catalogue-titre', texte: 'Tout le catalogue' }),
    h('div', { class: 'bz-champ bz-champ--large' },
      h('label', { class: 'bz-champ__libelle', for: 'assistant-recherche', texte: 'Rechercher un logiciel' }),
      h('div', { class: 'bz-recherche' }, icone('search'),
        h('input', { id: 'assistant-recherche', class: 'bz-champ__saisie', type: 'search', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'search', placeholder: 'Excel, HubSpot, Pennylane…', value: A.recherche,
          oninput: (e) => { A.recherche = e.target.value; const z = $('#assistant-resultats'); if (z) remplir(z, resultatsCatalogue(A)); clearTimeout(majCatalogue.t); majCatalogue.t = setTimeout(() => annoncerResultats(A), 600); } }))),
    h('ul', { class: 'bz-puces', role: 'list', 'aria-label': 'Familles de logiciels' }, [null, ...familles].map((f) => {
      const choisie = (A.famille ?? null) === (f?.id ?? null);
      return h('li', {}, h('button', { type: 'button', class: 'bz-puce', 'aria-pressed': choisie, onclick: () => { A.famille = f?.id ?? null; majCatalogue(A); annoncerResultats(A); } },
        choisie ? icone('check', { taille: 'sm' }) : null, f?.libelle ?? 'Tout'));
    })),
    h('div', { class: 'bz-pile', id: 'assistant-resultats' }, resultatsCatalogue(A)),
  ];
}
function annoncerResultats(A) {
  const r = CONNECTER.filtrer(catalogueDe(A) ?? [], { famille: A.famille, recherche: A.recherche });
  annoncer(r.total ? pluriel(r.total, 'logiciel', 'logiciels') : 'Aucun logiciel pour cette recherche.');
}
function resultatsCatalogue(A) {
  const r = CONNECTER.filtrer(catalogueDe(A) ?? [], { famille: A.famille, recherche: A.recherche });
  return [
    r.simples.length ? h('ul', { class: 'bz-logiciels', role: 'list' }, r.simples.map((x) => h('li', {}, carteLogiciel(x))))
      : h('div', { class: 'bz-vide bz-vide--compact' }, h('p', { texte: 'Aucun logiciel pour ces filtres.' }),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => { A.recherche = ''; A.famille = null; majCatalogue(A); $('#assistant-recherche')?.focus(); } }, 'Effacer les filtres')),
    r.bientot.length ? h('section', { class: 'bz-catalogue', 'aria-labelledby': 'assistant-bientot-titre' },
      h('div', {}, h('h5', { class: 'bz-catalogue__intertitre', id: 'assistant-bientot-titre', texte: 'Pas encore disponibles' }),
        h('p', { class: 'bz-t-petit', texte: 'Demandez-les : en attendant, l’export en fichier CSV fonctionne déjà.' })),
      h('ul', { class: 'bz-logiciels', role: 'list' }, r.bientot.map((x) => h('li', {}, carteLogiciel(x)))),
      A.choixBientot ? resultatAssistant('info', `${A.choixBientot.nom} n’est pas encore disponible.`, { detail: 'En attendant : exportez vos données en CSV depuis ce logiciel.',
        actions: h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', id: 'assistant-demander', onclick: () => demanderIntegration(A.choixBientot) }, 'Demander ce logiciel')) }) : null) : null,
    r.avances.length ? h('details', { class: 'bz-repli', open: A.recherche.trim() !== '' || Boolean(A.avanceOuvert), ontoggle: (e) => { A.avanceOuvert = e.currentTarget.open; } },
      h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Mode avancé : pour votre informaticien' }), h('span', { class: 'bz-repli__note', texte: 'serveur MCP, webhook, API' }), icone('chevron-down', { taille: 'sm' })),
      h('div', { class: 'bz-repli__corps' },
        h('p', { class: 'bz-t-petit', texte: 'Un logiciel absent de la liste ? S’il a une API ou un serveur MCP, il se connecte ici. Sinon, Make, Zapier ou n8n font le pont avec plus de 2 000 applications.' }),
        h('ul', { class: 'bz-logiciels', role: 'list' }, r.avances.map((x) => h('li', {}, carteLogiciel(x)))),
        E.monde.profil.peutAdministrer ? h('p', {}, h('a', { href: '#/reglages:cles', class: 'bz-t-petit bz-lien-fleche', onclick: (e) => { e.preventDefault(); fermerAssistant({ garder: true }); changerVue('reglages:cles'); } }, 'Clés d’API, Claude et MCP', icone('arrow-right', { taille: 'sm' }))) : null)) : null,
  ];
}
/** Carte d'un logiciel (§4.23) : pictogramme de sa famille et nom en entier ; « 1 clic » est la seule pastille. */
function carteLogiciel(x, { conseil = false, faire = null } = {}) {
  return h('button', { type: 'button', class: `bz-logiciel${conseil ? ' bz-logiciel--conseil' : ''}`, cle: `${conseil ? 'conseil' : 'logiciel'}-${x.cle}`, onclick: () => (faire ? faire(x) : choisirEntree(x)) },
    h('span', { class: 'bz-logiciel__icone', 'aria-hidden': 'true' }, icone(x.icone)),
    h('span', { class: 'bz-logiciel__texte' },
      h('span', { class: 'bz-logiciel__nom' }, h('span', { texte: x.nom }), x.unClic ? h('span', { class: 'bz-badge' }, icone('mouse-pointer-click'), '1 clic') : null),
      x.description ? h('span', { class: 'bz-logiciel__description', texte: x.description }) : null));
}
function choisirEntree(x) {
  const A = E.assistant;
  if (!A) return;
  A.erreur = null;
  A.entree = x;
  if (x.genre === 'action') { fermerAssistant({ garder: true }); changerVue('accueil'); return; }
  if (x.bientot) { A.choixBientot = x; majCatalogue(A); setTimeout(() => $('#assistant-demander')?.focus(), 0); return; }
  A.choixBientot = null;
  if (x.genre === 'outil') { const s = (E.sources ?? []).find((y) => y.id === x.id); if (s) demarrerOutil(A, s); return; }
  if (x.id === 'fec') { A.parcours = 'fec'; A.fec ??= { envoi: false, resultat: null, nom: '' }; allerEtape('fec'); return; }
  if (x.id === 'manuel') { A.parcours = 'manuel'; A.source = 'manuel'; allerEtape('contenu'); return; }
  A.parcours = 'fichier';
  A.source = x.id === 'coller' ? 'coller' : x.id === 'sheets' ? 'sheets' : 'csv';
  allerEtape(A.cible ? 'fichier' : 'contenu');
}
async function demanderIntegration(c) {
  try {
    await api('POST', '/connecteurs/demande', { id: c.id });
    informer(`Demande enregistrée pour ${c.nom}. En attendant, l’export CSV fonctionne déjà.`, 'ok');
  } catch (e) {
    if (!e.session) informer(e.message, 'erreur');
  }
}

// ---- import d'un fichier : contenu, fichier, colonnes, résultat
function corpsContenu(A) {
  return [
    h('fieldset', { class: 'bz-grille-choix', 'aria-labelledby': 'assistant-etape' }, ciblesImport().map((c) => h('label', { class: 'bz-choix' },
      h('input', { type: 'radio', name: 'assistant-cible', value: c.cle, checked: A.cible?.cle === c.cle, onchange: () => { A.cible = c; if (A.erreur) { A.erreur = null; rendreAssistant(); } } }),
      h('span', { class: 'bz-choix__texte' }, h('span', { class: 'bz-choix__titre', texte: c.libelle }), c.sous ? h('span', { class: 'bz-choix__detail', texte: c.sous }) : null)))),
    A.parcours !== 'manuel' ? h('p', { class: 'bz-t-petit' }, 'Une feuille de votre fichier = un type d’informations. Pas encore de fichier ? ',
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => { if (A.cible) modeleCsv(A.cible.type); else { A.erreur = 'Choisissez d’abord ce que contiendra le fichier.'; rendreAssistant(); } } }, 'Télécharger un modèle')) : null,
  ];
}
/** Classeurs de tableur, pas encore lus : on le dit plutôt que d'afficher un fichier illisible. */
const estClasseur = (nom) => /\.(xlsx?|xlsm|xlsb|ods|numbers)$/i.test(String(nom ?? ''));
function corpsFichier(A) {
  const src = A.source ?? 'csv';
  const champ = (id, libelle, aide, saisie) => h('div', { class: 'bz-champ bz-champ--large' }, h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }), aide ? h('span', { class: 'bz-champ__aide', id: `${id}-aide`, texte: aide }) : null, saisie);
  return [
    h('p', {}, 'Vous importez : ', h('strong', { texte: A.cible?.libelle ?? 'des données' }), A.cible?.roles?.length ? ` (rôle « ${A.cible.libelle} » appliqué si le fichier n’a pas de colonne « Rôles »)` : '', '. ',
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => allerEtape('contenu') }, 'Changer')),
    h('div', { class: 'bz-segments', role: 'group', 'aria-label': 'D’où viennent les lignes ?' }, [['csv', 'Fichier CSV'], ['sheets', 'Google Sheets'], ['coller', 'Copier-coller']].map(([k, l]) =>
      h('button', { type: 'button', 'aria-pressed': src === k, onclick: () => { A.source = k; A.erreur = null; rendreAssistant(); } }, l))),
    src === 'csv' ? h('label', { class: 'bz-depot' },
      h('input', { type: 'file', accept: '.csv,text/csv', onchange: async (e) => {
        const fichier = e.target.files?.[0];
        if (!fichier) return;
        // un classeur déposé malgré tout (le glisser-déposer ne suit pas « accept ») : on le dit, et on propose ce qui marche
        if (estClasseur(fichier.name)) { A.erreur = `« ${fichier.name} » est un classeur : Living Business ne lit pas encore ce format. Le plus simple : ouvrez-le, sélectionnez vos lignes avec la ligne des titres, copiez, puis collez-les ci-dessous.`; A.source = 'coller'; return rendreAssistant(); }
        if (fichier.size > 1_000_000) { A.erreur = 'Ce fichier dépasse 1 Mo. Enregistrez une seule feuille en CSV, puis réessayez.'; return rendreAssistant(); }
        A.csv = await fichier.text();
        A.nomFichier = fichier.name;
        A.erreur = null;
        rendreAssistant();
        annoncer(`Fichier choisi : ${fichier.name}`);
      } }),
      icone(A.csv && A.nomFichier !== 'collage.csv' ? 'file-spreadsheet' : 'upload'),
      h('span', { class: 'bz-depot__titre', 'data-brut': A.csv && A.nomFichier !== 'collage.csv' ? '' : null, texte: A.csv && A.nomFichier !== 'collage.csv' ? A.nomFichier : 'Choisir ou déposer un fichier CSV' }),
      h('span', { class: 'bz-t-petit', texte: A.csv && A.nomFichier !== 'collage.csv' ? 'Fichier prêt : choisissez-en un autre pour le remplacer.' : 'Un classeur Excel (.xlsx) n’est pas encore lu. Depuis Excel : Fichier, Enregistrer sous, format CSV (le séparateur « ; » est accepté) ; ou « Copier-coller », sans rien convertir. 1 Mo au plus.' })) : null,
    src === 'sheets' ? [
      h('ol', { class: 'bz-consignes' }, h('li', { texte: 'Dans Google Sheets : Fichier, Partager, Publier sur le Web.' }), h('li', { texte: 'Choisissez la feuille et le format « Valeurs séparées par des virgules (.csv) ».' }), h('li', { texte: 'Collez le lien ci-dessous. Lecture seule : rien n’est modifié dans votre feuille.' })),
      champ('assistant-url', 'Lien de publication', null, h('input', { id: 'assistant-url', class: 'bz-champ__saisie', type: 'url', inputmode: 'url', autocomplete: 'off', spellcheck: 'false', placeholder: 'https://docs.google.com/spreadsheets/d/e/…/pub?output=csv', value: A.url, oninput: (e) => (A.url = e.target.value) })),
    ] : null,
    src === 'coller' ? champ('assistant-collage', 'Collez vos lignes, avec la ligne des titres', 'Dans Excel ou un autre tableur : sélectionnez les cellules, copiez, puis collez-les ici.',
      h('textarea', { id: 'assistant-collage', rows: '8', 'aria-describedby': 'assistant-collage-aide', spellcheck: 'false', placeholder: 'Nom;Ville;Département\nCave Exemple;Vannes;56', oninput: (e) => { A.csv = e.target.value; A.nomFichier = 'collage.csv'; } }, A.nomFichier === 'collage.csv' ? A.csv : '')) : null,
  ];
}
function listeColonnes(colonnes, cibles, mapping, exemples) {
  return h('ul', { class: 'bz-colonnes', role: 'list' }, colonnes.map((col, i) => {
    const id = `assistant-colonne-${i}`;
    const ex = exemples(col, i);
    return h('li', {},
      h('div', {}, h('label', { class: 'bz-colonnes__nom', for: id }, 'Colonne « ', h('span', { 'data-brut': '', texte: col }), ' »'),
        ex ? h('span', { class: 'bz-colonnes__exemples', id: `${id}-ex` }, 'Exemples : ', h('span', { 'data-brut': '', texte: ex })) : null),
      h('div', { class: 'bz-select' },
        h('select', { id, class: 'bz-champ__saisie', 'aria-describedby': ex ? `${id}-ex` : null, onchange: (e) => { mapping[col] = e.target.value || null; } },
          h('option', { value: '', texte: 'Ne pas importer' }), cibles.map((c) => h('option', { value: c.id, selected: mapping[col] === c.id, texte: c.libelle }))),
        icone('chevron-down')));
  }));
}
function corpsColonnes(A) {
  const a = A.analyse;
  return [
    h('p', { texte: `${pluriel(a.lignes, 'ligne trouvée', 'lignes trouvées')}. Nous avons associé les colonnes : vérifiez, corrigez si besoin, puis importez.` }),
    listeColonnes(a.entetes, a.cibles, A.mapping, (_, i) => a.apercu.map((l) => l[i] ?? '').filter(Boolean).slice(0, 3).join(' · ')),
  ];
}
function corpsPret(A) {
  const r = A.resultat;
  return [
    resultatAssistant(r.crees ? 'ok' : 'attention', `${pluriel(r.crees, 'élément ajouté', 'éléments ajoutés')} à votre carte.`, {
      detail: r.totalRejets ? `${pluriel(r.totalRejets, 'ligne écartée', 'lignes écartées')} : voici pourquoi.` : 'Toutes les lignes ont été reprises.' }),
    r.rejets.length ? h('ul', { class: 'bz-liste-simple' }, r.rejets.map((x) => h('li', { class: 'bz-t-petit' }, h('strong', { texte: `Ligne ${x.ligne} : ` }), x.erreurs.join(' ; ')))) : null,
  ];
}
async function analyser() {
  const A = E.assistant;
  if (!A || A.envoi) return;
  A.envoi = true;
  A.erreur = null;
  rendreAssistant();
  try {
    if (A.source === 'sheets') {
      const r = await api('POST', '/import/sheets', { type: A.cible.type, url: A.url });
      A.csv = r.csv;
      A.nomFichier = r.nomFichier;
      A.analyse = r;
    } else {
      if (!A.csv.trim()) throw new Error(A.source === 'coller' ? 'Collez d’abord vos lignes, avec la ligne des titres.' : 'Choisissez d’abord un fichier CSV.');
      A.analyse = await api('POST', '/import/analyse', { type: A.cible.type, csv: A.csv });
    }
    A.mapping = { ...A.analyse.mapping };
    A.etape = 'colonnes';
  } catch (e) {
    if (!e.session) A.erreur = e.message;
  }
  A.envoi = false;
  if (E.assistant === A) rendreAssistant();
}
async function confirmer() {
  const A = E.assistant;
  if (!A || A.envoi) return;
  A.envoi = true;
  rendreAssistant();
  try {
    A.resultat = await api('POST', '/import/confirmer', { type: A.cible.type, csv: A.csv, mapping: A.mapping, nomFichier: A.nomFichier, rolesParDefaut: A.cible.roles ?? [] });
    A.etape = 'pret';
    A.erreur = null;
    await charger();
  } catch (e) {
    if (!e.session) A.erreur = e.message;
  }
  A.envoi = false;
  if (E.assistant === A) rendreAssistant();
}

// ---- comptabilité : fichier des écritures comptables (FEC)
function corpsFec(A) {
  const F = A.fec;
  return [
    h('p', { texte: 'Tous les logiciels comptables français exportent ce fichier, c’est une obligation légale : Sage, EBP, Cegid, Ciel, Quadra, ACD, Pennylane, Tiime… Aucun accès ni mot de passe à donner.' }),
    h('ol', { class: 'bz-consignes' },
      h('li', { texte: 'Dans votre logiciel : menu « Fichier des écritures comptables » ou « Export FEC » (souvent dans Clôture, Outils ou Déclarations), exercice en cours ou dernier exercice clos.' }),
      h('li', { texte: 'Ou demandez-le à votre expert-comptable : il le produit en une minute.' }),
      h('li', { texte: 'Déposez le fichier ci-dessous (.txt ou .csv).' })),
    h('label', { class: 'bz-depot', 'aria-busy': F.envoi ? 'true' : null },
      h('input', { type: 'file', accept: '.txt,.csv,.tsv,text/plain', disabled: F.envoi, onchange: (e) => { const f = e.target.files?.[0]; if (f) lireFec(A, f); } }),
      icone(F.envoi ? 'clock' : 'upload'),
      h('span', { class: 'bz-depot__titre', texte: F.envoi ? `Lecture de ${F.nom}…` : 'Choisir le fichier des écritures comptables' }),
      h('span', { class: 'bz-t-petit', texte: 'Seuls les totaux sont gardés (chiffre d’affaires, marge, trésorerie…). Le fichier n’est ni conservé ni envoyé ailleurs.' })),
  ];
}
async function lireFec(A, fichier) {
  const F = A.fec;
  F.nom = fichier.name; A.erreur = null; F.resultat = null;
  if (fichier.size > 75_000_000) { A.erreur = 'Ce fichier dépasse 75 Mo. Exportez un seul exercice, puis réessayez.'; rendreAssistant(); return; }
  F.envoi = true; rendreAssistant();
  annoncer(`Lecture de ${fichier.name}`);
  try {
    const octets = new Uint8Array(await fichier.arrayBuffer());
    let texte;
    try { texte = new TextDecoder('utf-8', { fatal: true }).decode(octets); } catch { texte = new TextDecoder('windows-1252').decode(octets); }
    F.resultat = await api('POST', '/comptabilite/fec', { texte });
    A.etape = 'pret';
    await charger();
  } catch (e) { if (!e.session) A.erreur = e.message; }
  F.envoi = false;
  if (E.assistant === A) rendreAssistant();
}
function corpsPretFec(A) {
  const r = A.fec.resultat;
  const v = r.valeurs;
  const montant = (x) => (x === null || x === undefined ? '—' : euros(x, { arrondi: true }));
  const ligne = (dt, dd, note = null) => h('div', {}, h('dt', { texte: dt }), h('dd', {}, dd, note ? h('small', { texte: note }) : null));
  return [
    resultatAssistant('ok', `${pluriel(r.ecritures, 'écriture lue', 'écritures lues')}, du ${date(r.debut)} au ${date(r.fin)}.`, { detail: `Vos chiffres clés sont à jour${r.score !== null ? ` : score de santé ${r.score} sur 100` : ''}.` }),
    h('dl', { class: 'bz-chiffres' },
      ligne('Chiffre d’affaires annuel', montant(v.chiffre_affaires_annuel), r.mois < 12 ? `sur ${pluriel(r.mois, 'mois', 'mois')}, ramené à l’année` : null),
      ligne('Marge brute', v.marge_brute === null ? '—' : `${nombre(v.marge_brute)} %`),
      ligne('Résultat net annuel', montant(v.resultat_net)),
      ligne('Trésorerie', montant(v.tresorerie)),
      ligne('Charges par mois', montant(v.charges_mensuelles)),
      ligne('Créances clients', montant(v.creances_clients)),
      ligne('Emprunts', montant(v.dettes_financieres)),
      ligne('Capitaux propres', montant(v.capitaux_propres))),
    h('p', { class: 'bz-t-petit', texte: 'Repères calculés selon le plan comptable général ; ils restent modifiables dans « Vos chiffres clés ». Réimportez le fichier chaque mois pour suivre l’évolution.' }),
  ];
}

// ---- démonstration : partir de zéro avec son entreprise
function corpsZero(A) {
  return [
    h('p', { texte: 'Les données de l’exemple seront retirées. Votre carte vide sera prête à recevoir vos lieux, votre équipe, vos clients et vos fournisseurs.' }),
    h('div', { class: 'bz-champ' },
      h('label', { class: 'bz-champ__libelle', for: 'assistant-nom', texte: 'Nom de votre entreprise' }),
      A.nomEntreprise && A.nomEntreprise === (lireLocal(NOM_SOUHAITE) ?? '') ? h('span', { class: 'bz-champ__aide', id: 'assistant-nom-aide', texte: 'C’est le nom saisi à l’installation : corrigez-le si besoin.' }) : null,
      h('input', { id: 'assistant-nom', class: 'bz-champ__saisie', type: 'text', maxlength: '120', autocomplete: 'organization', enterkeyhint: 'done', value: A.nomEntreprise,
        oninput: (e) => (A.nomEntreprise = e.target.value), onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); partirDeZero(); } } })),
  ];
}
async function partirDeZero() {
  const A = E.assistant;
  if (!A || A.envoi) return;
  if (!A.nomEntreprise.trim()) { A.erreur = 'Indiquez le nom de votre entreprise.'; rendreAssistant(); $('#assistant-nom')?.focus(); return; }
  A.envoi = true;
  rendreAssistant();
  try {
    await api('POST', '/monde/vider-demo', { nom: A.nomEntreprise.trim() });
    ecrireLocal(NOM_SOUHAITE, '');
    fermerAssistant();
    E.selection = null;
    E.fiche = null;
    E.vue = vueAujourdhui();
    await charger();
    informer('Votre carte est prête. Ajoutez vos lieux, votre équipe, vos clients et vos fournisseurs.', 'ok');
  } catch (e) {
    A.envoi = false;
    if (!e.session) A.erreur = e.message;
    if (E.assistant === A) rendreAssistant();
  }
}

// ---------------------------------------------------------------- saisie manuelle
function ouvrirSaisie(cible) {
  const u = E.monde.univers;
  let t = u.types.find((x) => x.id === cible.type);
  if (!t) return;
  const S = { nom: '', roles: new Set(cible.roles ?? []), champs: {}, erreur: null, envoi: false };
  const titre = () => (S.roles.size && t.famille === 'tiers' ? u.roles.find((r) => r.id === [...S.roles][0])?.libelle ?? t.libelle : t.libelle);
  const optionsRef = (c) => E.monde.objets.filter((o) => (!c.cible || o.famille === c.cible.famille) && (!c.cible?.role || o.roles.some((r) => r.id === c.cible.role)));
  const champ = (c) => {
    const id = `saisie-${idDom(c.id)}`;
    const lier = (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; S.champs[c.id] = (c.type === 'nombre' || c.type === 'montant') && v !== '' ? Number(v) : v; };
    const v = S.champs[c.id];
    if (c.type === 'booleen') return h('label', { class: 'bz-case' }, h('input', { type: 'checkbox', id, checked: v === true, onchange: lier }), c.libelle);
    const select = (options) => h('div', { class: 'bz-select' }, h('select', { id, class: 'bz-champ__saisie', onchange: lier }, h('option', { value: '', texte: '—' }), options), icone('chevron-down', { taille: 'sm' }));
    const entree = c.type === 'choix' ? select((c.choix ?? []).map((x) => h('option', { value: x, selected: v === x, texte: x })))
      : c.type === 'reference' ? select(optionsRef(c).map((o) => h('option', { value: o.id, selected: v === o.id, texte: sansDemo(o.nom) })))
      : h('input', { id, class: 'bz-champ__saisie', type: c.type === 'date' ? 'date' : 'text', inputmode: c.type === 'nombre' || c.type === 'montant' ? 'decimal' : null, autocomplete: 'off', value: v === undefined || v === null ? '' : String(v), oninput: lier });
    return h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: id, texte: `${c.libelle}${c.unite ? ` (${c.unite})` : ''}` }), entree);
  };
  const D = dialogueVivant({
    titre: titre(), surtitre: 'Ajouter à la main', taille: 'md',
    onsubmit: async () => {
      if (!S.nom.trim()) { S.erreur = 'Indiquez un nom.'; D.rendre(); $('#saisie-nom')?.focus(); return; }
      S.envoi = true; D.rendre();
      try {
        const o = await api('POST', '/objets', { type: t.id, nom: S.nom, roles: [...S.roles], champs: S.champs });
        D.fermer();
        await charger();
        informer(`${t.libelle} ajouté : ${o.nom}.`, 'ok');
        await selectionner(o.id);
      } catch (err) { S.erreur = err.message; S.envoi = false; D.rendre(); }
    },
    contenu: () => {
      const variantes = t.famille === 'tiers' ? [] : u.types.filter((x) => x.famille === t.famille);
      return {
        corps: [
          messageEnLigne('critique', S.erreur),
          h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Enregistré sur cet appareil, sans passer par un logiciel connecté.' }),
          variantes.length > 1 ? h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'saisie-type', texte: 'Type' }),
            h('div', { class: 'bz-select' }, h('select', { id: 'saisie-type', class: 'bz-champ__saisie', onchange: (e) => { t = u.types.find((x) => x.id === e.target.value) ?? t; S.champs = {}; D.rendre(); } }, variantes.map((x) => h('option', { value: x.id, selected: x.id === t.id, texte: x.libelle }))), icone('chevron-down', { taille: 'sm' }))) : null,
          h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'saisie-nom', texte: 'Nom' }),
            h('input', { id: 'saisie-nom', class: 'bz-champ__saisie', type: 'text', required: true, maxlength: '200', autocomplete: 'off', value: S.nom, 'aria-invalid': S.erreur && !S.nom.trim() ? 'true' : null, oninput: (e) => (S.nom = e.target.value) })),
          t.famille === 'tiers' ? h('fieldset', { class: 'bz-champ' }, h('legend', { class: 'bz-champ__libelle', texte: 'Rôles (un même tiers peut en avoir plusieurs)' }),
            h('div', { class: 'bz-cases' }, u.roles.map((r) => h('label', { class: 'bz-case' }, h('input', { type: 'checkbox', checked: S.roles.has(r.id), onchange: (e) => { if (e.target.checked) S.roles.add(r.id); else S.roles.delete(r.id); } }), r.libelle)))) : null,
          h('div', { class: 'bz-grille-champs' }, t.champs.map(champ)),
        ],
        pied: [h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler'), h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, icone('plus'), 'Ajouter')],
      };
    },
  });
}

const initiale = (nom) => sansDemo(nom).trim().slice(0, 1).toUpperCase();

// ---------------------------------------------------------------- planning des équipes (§6.1 P7, §4.30, §4.31)
/* Téléphone : « Aujourd'hui » par lieu (cartes avec avatars) et vue par personne. Ordinateur : la semaine en grille de
   cases-pastilles. Chaque case ouvre un popover de choix ; Maj + clic ou Maj + flèches sélectionnent plusieurs cases,
   glisser depuis une case recopie sa valeur (toujours doublé du menu « Copier sur toute la semaine » et de la barre
   d'action). Les jours affichés se règlent (samedi et dimanche compris). Enregistrement optimiste avec « Annuler » ;
   sans réseau, la modification reste affichée, marquée « En attente d'envoi », et part au retour du réseau ; elle ne
   revient en arrière que si le serveur la refuse, avec la raison et « Réessayer ». Logique : web/planning.js (pur). */
let PLAN = null;
const chargerPlan = async () => (PLAN ??= await import('/planning.js'));
const nbJoursPlanning = () => (PLAN ? PLAN.nbJoursValide(lireLocal('lb-planning-jours')) : 5);
const VUES_PLANNING = [['lieu', 'Par lieu', 'map-pin'], ['personne', 'Par personne', 'users'], ['semaine', 'Semaine', 'calendar-range']];
const attentePlanning = new Map(); // file d'attente hors ligne (en mémoire) : clé de case → { employe, date, valeur }
let renvoiPlanning = null;
let rafraichirPlanningTempo = 0;

async function rendrePlanning() {
  const [M] = await Promise.all([chargerPlan(), chargerFiches(), chargerTerrain()]);
  const page = $('#page');
  let P;
  try {
    P = await api('GET', `/planning?jours=${nbJoursPlanning()}${E.planningDebut ? `&debut=${E.planningDebut}` : ''}`);
  } catch (e) {
    if (E.vue !== 'planning') return;
    if (!e.statut && !e.session && E.planning) { E.planningHorsLigne = true; dessinerPlanning(); return; } // hors ligne : la dernière version reste affichée
    remplir(page, h('div', { class: 'bz-ecran' }, h('div', { class: 'bz-vide', role: 'alert' },
      h('h2', { class: 'bz-vide__titre', texte: 'Le planning n’a pas pu être chargé.' }),
      h('p', { class: 'bz-vide__texte', texte: e.message || 'Vérifiez la connexion.' }),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => rendrePlanning() }, icone('refresh-cw'), 'Réessayer'))));
    return;
  }
  if (E.vue !== 'planning') return;
  E.planningHorsLigne = false;
  // les cases encore en attente d'envoi restent affichées avec leur nouvelle valeur
  E.planning = attentePlanning.size ? M.appliquer(P, [...attentePlanning.values()]) : P;
  E.planningSel ??= { ancre: null, cases: new Set() };
  dessinerPlanning();
}

const personnePlanning = (id) => E.planning?.lignes.find((l) => l.id === id);
/** Coordonnées de terrain d'un lieu ou d'un projet du planning : adresse (« Y aller ») et numéro du client (tel:). */
function terrainCible(c) {
  const o = E.monde.objets.find((x) => x.id === c.id);
  if (!o || !FICHES) return { adresse: null, tel: null, client: null };
  const lien = (id) => { const v = o.champs.find((x) => x.id === id); return v?.lien ? E.monde.objets.find((x) => x.id === v.lien.id) : null; };
  const lieu = o.famille === 'lieu' ? o : lien('lieu');
  const client = lien('client');
  const adresse = (lieu ? FICHES.coordonnees(lieu).adresse : null) ?? (client ? FICHES.coordonnees(client).adresse : null);
  return { adresse, tel: client ? FICHES.coordonnees(client).tel : null, client };
}

function dessinerPlanning() {
  const M = PLAN;
  const P = E.planning;
  if (!M || !P || E.vue !== 'planning') return;
  const page = $('#page');
  // personne à planifier (§4.18) : ni grille ni outils vides — ce que le planning montrera, et une seule action
  if (!P.lignes.length) {
    remplir(page, h('div', { class: 'bz-ecran bz-planning' }, videRubrique('planning', {
      action: h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => allerEtapePremiersPas('equipe') }, icone('user-plus'), 'Ajouter mon équipe') })));
    return;
  }
  const tel = estTelephone();
  let vue = E.planningVue ?? (tel ? 'lieu' : 'semaine');
  if (tel && vue === 'semaine') vue = 'personne';
  E.planningVue = vue;
  const sel = E.planningSel ??= { ancre: null, cases: new Set() };
  const nb = P.jours.length;
  const fin = P.jours[nb - 1];
  const decaler = (pas) => { E.planningDebut = M.decalerSemaine(P.debut, pas); viderSelection(); rendrePlanning(); };
  const attente = attentePlanning.size;

  const barre = h('div', { class: 'bz-planning__outils' },
    h('div', { class: 'bz-planning__semaine', role: 'group', 'aria-label': 'Semaine affichée' },
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', cle: 'semaine-prec', 'aria-label': 'Semaine précédente', 'data-infobulle': 'Semaine précédente', onclick: () => decaler(-1) }, icone('chevron-left')),
      h('p', { class: 'bz-planning__periode' }, h('strong', { texte: `Semaine ${M.semaineIso(P.debut)}` }), h('span', { class: 'bz-texte-2', texte: ` · ${M.jourMois(P.debut)} – ${M.jourMois(fin)}` })),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--icone', cle: 'semaine-suiv', 'aria-label': 'Semaine suivante', 'data-infobulle': 'Semaine suivante', onclick: () => decaler(1) }, icone('chevron-right')),
      E.planningDebut ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => { E.planningDebut = null; viderSelection(); rendrePlanning(); } }, 'Cette semaine') : null),
    h('div', { class: 'bz-segments', role: 'group', 'aria-label': 'Présentation' },
      VUES_PLANNING.filter(([id]) => !(tel && id === 'semaine')).map(([id, l, ic]) => h('button', { type: 'button', cle: `vue-planning-${id}`, 'aria-pressed': vue === id, onclick: () => { E.planningVue = id; dessinerPlanning(); } }, icone(ic, { taille: 'sm' }), l))),
    h('div', { class: 'bz-planning__jours' },
      h('label', { class: 'bz-t-petit bz-texte-2', for: 'planning-jours', texte: 'Jours' }),
      h('div', { class: 'bz-select' },
        h('select', { id: 'planning-jours', class: 'bz-champ__saisie', onchange: (e) => { ecrireLocal('lb-planning-jours', e.target.value); viderSelection(); rendrePlanning(); } },
          M.JOURS_POSSIBLES.map((j) => h('option', { value: String(j.n), selected: j.n === nb, texte: j.libelle }))),
        icone('chevron-down', { taille: 'sm' }))));

  const statut = E.planningRefus
    ? h('div', { class: 'bz-resultat', 'data-ton': 'critique', role: 'alert' }, iconeEtat('critique', { decoratif: true }),
      h('div', { class: 'bz-pile' }, h('strong', { texte: E.planningRefus.texte }),
        h('div', { class: 'bz-groupe-boutons' },
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => { const lot = E.planningRefus.lot; E.planningRefus = null; affecterLot(lot); } }, icone('refresh-cw', { taille: 'sm' }), 'Réessayer'),
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => { E.planningRefus = null; dessinerPlanning(); } }, 'Fermer'))))
    : attente || E.planningHorsLigne ? h('div', { class: 'bz-bandeau bz-planning__attente', role: 'status' }, icone(attente ? 'cloud-upload' : 'wifi-off'),
      h('span', { texte: attente ? `${E.planningHorsLigne || !navigator.onLine ? 'Hors ligne · ' : ''}${pluriel(attente, 'modification en attente d’envoi', 'modifications en attente d’envoi')}. ${attente > 1 ? 'Elles partiront' : 'Elle partira'} au retour du réseau.` : 'Hors ligne · dernière version du planning. Rien en attente.' }),
      attente ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => renvoyerPlanning() }, icone('refresh-cw', { taille: 'sm' }), 'Réessayer maintenant') : null)
    : null;

  const alertesParJour = new Map();
  for (const a of P.alertes) { if (!alertesParJour.has(a.date)) alertesParJour.set(a.date, []); alertesParJour.get(a.date).push(a); }
  const alertes = P.alertes.length
    ? h('details', { class: 'bz-repli bz-planning__trous', open: E.planningTrousOuverts ?? !tel, ontoggle: (e) => { E.planningTrousOuverts = e.target.open; } },
      h('summary', {}, iconeEtat('attention', { taille: 'sm', decoratif: true }), h('span', { class: 'bz-repli__titre', texte: `${pluriel(P.alertes.length, 'trou', 'trous')} dans le planning des 6 prochains jours ouvrés, aujourd’hui compris` }), icone('chevron-down', { taille: 'sm' })),
      h('ul', { class: 'bz-repli__corps bz-liste-simple' }, [...alertesParJour].map(([j, l]) => h('li', {}, h('strong', { texte: `${j === P.aujourdhui ? 'Aujourd’hui' : M.jourLong(j)} : ` }), l.map((a) => sansDemo(a.texte)).join(' · ')))))
    : h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, iconeEtat('ok', { taille: 'sm', decoratif: true }), h('span', { texte: 'Aucun trou dans le planning des 6 prochains jours ouvrés, aujourd’hui compris.' }));

  remplir(page, h('div', { class: 'bz-ecran bz-planning', 'data-vue': vue },
    P.simulation ? h('p', { class: 'bz-badge' }, icone('flask-conical', { taille: 'sm' }), 'Simulation : rien n’est enregistré') : null,
    barre, statut, alertes,
    vue === 'lieu' ? vueParLieu(P) : vue === 'personne' ? vueParPersonne(P) : vueSemaine(P),
    sel.cases.size > 1 && P.modifiable ? h('div', { class: 'bz-barre-action', role: 'toolbar', 'aria-label': `Actions pour ${pluriel(sel.cases.size, 'case sélectionnée', 'cases sélectionnées')}`, onkeydown: clavierBarre },
      h('span', { class: 'bz-barre-action__titre bz-t-label', texte: pluriel(sel.cases.size, 'case sélectionnée', 'cases sélectionnées') }),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', cle: 'affecter-selection', onclick: (e) => ouvrirChoixCase(e.currentTarget, [...sel.cases].map(caseDeCle)) }, icone('square-pen'), 'Affecter…'),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: () => { viderSelection(); dessinerPlanning(); } }, icone('x'), 'Désélectionner')) : null,
    projetsPlanning(P),
    h('div', { class: 'bz-menu bz-planning__choix', id: 'planning-choix', popover: 'auto', role: 'dialog', 'aria-labelledby': 'planning-choix-titre' })));
}

const caseDeCle = (k) => { const [employe, date] = k.split('|'); return { employe, date }; };
function viderSelection() { if (E.planningSel) { E.planningSel.cases.clear(); E.planningSel.ancre = null; } }

/** Pastille d'affectation (lecture) : type par une icône et un libellé, jamais une couleur seule. */
const ICONE_CASE = { lieu: 'map-pin', projet: 'flag', mission: 'route', absence: 'circle-off', vide: 'circle-dashed' };
function pastilleCase(P, v, { attente = false } = {}) {
  const t = PLAN.typeCase(v);
  return h('span', { class: 'bz-pastille-case', 'data-type': t, 'data-attente': attente ? '' : null },
    icone(attente ? 'cloud-upload' : ICONE_CASE[t] ?? 'circle', { taille: 'sm' }),
    h('span', { class: 'bz-pastille-case__texte', texte: sansDemo(PLAN.libelleCase(P, v)) }),
    attente ? h('span', { class: 'bz-visuellement-cache', texte: ', en attente d’envoi' }) : null);
}

/** Case modifiable : un bouton qui ouvre le choix ; sélection multiple, glisser pour remplir, flèches. */
function boutonCase(P, l, j, { long = false } = {}) {
  const v = l.cases[j] ?? '';
  const k = PLAN.cleCase({ employe: l.id, date: j });
  const enAttente = attentePlanning.has(k);
  if (!P.modifiable) return pastilleCase(P, v, { attente: enAttente });
  const choisi = E.planningSel?.cases.has(k);
  return h('button', {
    type: 'button', class: 'bz-case-planning', cle: `case-${k}`, 'data-employe': l.id, 'data-date': j, 'data-choisie': choisi ? '' : null, 'data-aujourdhui': j === P.aujourdhui ? '' : null,
    'aria-label': `${sansDemo(l.nom)}, ${PLAN.jourLong(j)} : ${sansDemo(PLAN.libelleCase(P, v))}${enAttente ? ', en attente d’envoi' : ''}${choisi ? ', sélectionnée' : ''}. Changer l’affectation`,
    onclick: (e) => cliquerCase(e, { employe: l.id, date: j }),
    onkeydown: (e) => clavierCase(e, { employe: l.id, date: j }),
  }, long ? h('span', { class: 'bz-case-planning__jour', 'aria-hidden': 'true', texte: PLAN.jourCourt(j) }) : null, pastilleCase(P, v, { attente: enAttente }));
}

function cliquerCase(e, c) {
  if (E.planningGlisse?.fini) { E.planningGlisse = null; return; } // fin d'un glisser : pas de clic
  const sel = E.planningSel;
  const k = PLAN.cleCase(c);
  if (e.shiftKey && sel.ancre) {
    const lignes = E.planning.lignes.map((l) => l.id);
    sel.cases = new Set(PLAN.rectangle(lignes, E.planning.jours, sel.ancre, c).map(PLAN.cleCase));
    dessinerPlanning();
    annoncer(`${pluriel(sel.cases.size, 'case sélectionnée', 'cases sélectionnées')}.`);
    return;
  }
  if (e.metaKey || e.ctrlKey) {
    if (sel.cases.has(k)) sel.cases.delete(k); else sel.cases.add(k);
    sel.ancre = c;
    dessinerPlanning();
    annoncer(`${pluriel(sel.cases.size, 'case sélectionnée', 'cases sélectionnées')}.`);
    return;
  }
  sel.cases = new Set([k]);
  sel.ancre = c;
  ouvrirChoixCase(e.currentTarget, [c]);
}

function clavierCase(e, c) {
  const P = E.planning;
  const lignes = P.lignes.map((l) => l.id);
  if (e.key === 'Escape' && E.planningSel.cases.size) { e.preventDefault(); viderSelection(); dessinerPlanning(); annoncer('Sélection effacée.'); return; }
  const v = PLAN.caseVoisine(lignes, P.jours, c, e.key);
  if (!v) return;
  e.preventDefault();
  const sel = E.planningSel;
  if (e.shiftKey) {
    sel.ancre ??= c;
    sel.cases = new Set(PLAN.rectangle(lignes, P.jours, sel.ancre, v).map(PLAN.cleCase));
    dessinerPlanning();
    annoncer(`${pluriel(sel.cases.size, 'case sélectionnée', 'cases sélectionnées')}.`);
  }
  else if (!sel.cases.size || sel.cases.size === 1) { sel.ancre = v; }
  $(`[data-cle="case-${CSS.escape(PLAN.cleCase(v))}"]`)?.focus();
}

/** Glisser pour remplir (souris ou stylet) : la valeur de la case de départ est recopiée sur les cases survolées. */
function glisserPlanning(grille) {
  const caseSous = (e) => document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.bz-case-planning');
  grille.addEventListener('pointerdown', (e) => {
    const b = e.target.closest?.('.bz-case-planning');
    if (!b || e.button !== 0 || e.pointerType === 'touch' || e.shiftKey || e.metaKey || e.ctrlKey) return;
    E.planningGlisse = { depart: { employe: b.dataset.employe, date: b.dataset.date }, cases: [], fini: false };
  });
  grille.addEventListener('pointermove', (e) => {
    const g = E.planningGlisse;
    if (!g || g.fini || !(e.buttons & 1)) return;
    const b = caseSous(e);
    if (!b) return;
    const c = { employe: b.dataset.employe, date: b.dataset.date };
    const rect = PLAN.rectangle(E.planning.lignes.map((l) => l.id), E.planning.jours, g.depart, c);
    if (rect.length < 2 && !g.cases.length) return;
    g.cases = rect;
    const cles = new Set(rect.map(PLAN.cleCase));
    for (const x of grille.querySelectorAll('.bz-case-planning')) x.toggleAttribute('data-remplir', cles.has(`${x.dataset.employe}|${x.dataset.date}`));
  });
  const finir = () => {
    const g = E.planningGlisse;
    if (!g || g.fini) return;
    if (g.cases.length < 2) { E.planningGlisse = null; return; }
    g.fini = true;
    setTimeout(() => { if (E.planningGlisse === g) E.planningGlisse = null; }, 400);
    const lot = PLAN.lotRemplir(E.planning, g.depart, g.cases);
    for (const x of grille.querySelectorAll('[data-remplir]')) x.removeAttribute('data-remplir');
    if (lot.length) affecterLot(lot); else annoncer('Rien à recopier : ces cases ont déjà cette affectation.');
  };
  grille.addEventListener('pointerup', finir);
  grille.addEventListener('pointercancel', () => { E.planningGlisse = null; for (const x of grille.querySelectorAll('[data-remplir]')) x.removeAttribute('data-remplir'); });
}

/** Popover de choix d'une ou plusieurs cases : options groupées, flèches, Entrée, Échap ; le focus revient à la case. */
function ouvrirChoixCase(ancre, cases) {
  const P = E.planning;
  const pop = $('#planning-choix');
  if (!pop || !P?.modifiable) return;
  const valeurs = new Set(cases.map((c) => personnePlanning(c.employe)?.cases[c.date] ?? ''));
  const actuelle = valeurs.size === 1 ? [...valeurs][0] : null;
  const un = cases.length === 1 ? cases[0] : null;
  const titre = un ? `${sansDemo(personnePlanning(un.employe)?.nom ?? '')}, ${PLAN.jourLong(un.date)}` : `Affecter ${pluriel(cases.length, 'case', 'cases')}`;
  const choisir = (v) => { cacher(pop); affecterLot(PLAN.lotPour(P, cases, v)); };
  const items = [];
  const option = (o) => { const b = h('button', { type: 'button', role: 'menuitemradio', class: 'bz-menu__option', 'aria-checked': o.valeur === actuelle, onclick: () => choisir(o.valeur) }, icone(ICONE_CASE[PLAN.typeCase(o.valeur)] ?? 'circle', { taille: 'sm' }), h('span', { texte: sansDemo(o.libelle) }), o.valeur === actuelle ? icone('check', { taille: 'sm' }) : null); items.push(b); return b; };
  remplir(pop,
    h('p', { class: 'bz-t-label bz-planning__choix-titre', id: 'planning-choix-titre', texte: titre }),
    h('div', { class: 'bz-planning__choix-liste', role: 'menu', 'aria-labelledby': 'planning-choix-titre',
      onkeydown: (e) => {
        const i = items.indexOf(document.activeElement);
        const pas = { ArrowDown: 1, ArrowUp: -1 }[e.key];
        if (pas) { e.preventDefault(); items[(i + pas + items.length) % items.length]?.focus(); }
        if (e.key === 'Home') { e.preventDefault(); items[0]?.focus(); }
        if (e.key === 'End') { e.preventDefault(); items.at(-1)?.focus(); }
      } },
    PLAN.optionsGroupees(P).map((g) => h('div', { role: 'group', 'aria-label': g.groupe, class: 'bz-planning__choix-groupe' },
      h('p', { class: 'bz-t-surtitre bz-texte-2', 'aria-hidden': 'true', texte: g.groupe }), g.options.map(option))),
    un ? h('div', { role: 'group', 'aria-label': 'Recopier', class: 'bz-planning__choix-groupe' }, (() => {
      const b = h('button', { type: 'button', role: 'menuitem', class: 'bz-menu__option', onclick: () => { cacher(pop); const v = personnePlanning(un.employe)?.cases[un.date] ?? ''; affecterLot(PLAN.lotPour(P, P.jours.map((j) => ({ employe: un.employe, date: j })), v)); } },
        icone('copy', { taille: 'sm' }), h('span', { texte: 'Copier sur toute la semaine' }));
      items.push(b);
      return b;
    })()) : null));
  const retour = ancre;
  pop.onToggleRetour?.();
  const surFermeture = (e) => { if (e.newState === 'closed') { pop.removeEventListener('toggle', surFermeture); if (retour?.isConnected && !document.activeElement?.closest?.('dialog')) setTimeout(() => (retour.isConnected ? retour : $(`[data-cle="${retour.dataset?.cle}"]`))?.focus(), 0); } };
  pop.addEventListener('toggle', surFermeture);
  pop.onToggleRetour = () => pop.removeEventListener('toggle', surFermeture);
  montrer(pop);
  placerPres(pop, ancre);
  setTimeout(() => (items.find((b) => b.getAttribute('aria-checked') === 'true') ?? items[0])?.focus(), 0);
}

/** Envoi optimiste d'un lot de cases, annulable ; hors ligne : en file d'attente ; refus du serveur : retour en arrière. */
async function affecterLot(lot, { annulable = true } = {}) {
  if (!lot.length || !E.planning) return;
  const P0 = E.planning;
  const inverse = PLAN.lotInverse(P0, lot);
  const texte = PLAN.texteLot(P0, lot);
  E.planning = PLAN.appliquer(P0, lot);
  E.planningRefus = null;
  if (lot.length > 1) viderSelection();
  dessinerPlanning();
  try {
    await api('POST', '/planning', { affectations: lot });
    for (const c of lot) attentePlanning.delete(PLAN.cleCase(c));
    if (annulable) actionAnnulable({ texte: `${texte.charAt(0).toUpperCase()}${texte.slice(1)}.`, libelle: `planning : ${texte}`, annuler: () => affecterLot(inverse, { annulable: false }) });
    else annoncer(`Annulé : ${texte}.`);
    clearTimeout(rafraichirPlanningTempo);
    rafraichirPlanningTempo = setTimeout(() => { if (!occupe()) charger(); }, 800);
  } catch (e) {
    if (!e.statut && !e.session) {
      // pas de réseau : la modification n'est jamais annulée, elle attend (§4.31)
      for (const c of lot) attentePlanning.set(PLAN.cleCase(c), c);
      E.planningHorsLigne = true;
      surveillerRenvoi();
      dessinerPlanning();
      annoncer(`Hors ligne : ${pluriel(attentePlanning.size, 'modification en attente d’envoi', 'modifications en attente d’envoi')}.`);
      return;
    }
    // refus du serveur (droits, date, valeur) : la case revient, avec la raison
    E.planning = PLAN.appliquer(E.planning, inverse);
    E.planningRefus = { texte: `Le planning n’a pas été enregistré : ${String(e.message).replace(/\.?$/, '.')}`, lot };
    dessinerPlanning();
  }
}
function surveillerRenvoi() {
  if (renvoiPlanning) return;
  const relancer = () => renvoyerPlanning();
  window.addEventListener('online', relancer);
  const minuterie = setInterval(relancer, 15_000);
  renvoiPlanning = () => { window.removeEventListener('online', relancer); clearInterval(minuterie); renvoiPlanning = null; };
}
async function renvoyerPlanning() {
  const lot = [...attentePlanning.values()];
  if (!lot.length) { renvoiPlanning?.(); return; }
  try {
    await api('POST', '/planning', { affectations: lot });
    for (const c of lot) attentePlanning.delete(PLAN.cleCase(c));
    renvoiPlanning?.();
    E.planningHorsLigne = false;
    annoncer(`${pluriel(lot.length, 'modification envoyée', 'modifications envoyées')}.`);
    if (E.vue === 'planning') rendrePlanning();
  } catch (e) {
    if (!e.statut && !e.session) return; // toujours hors ligne : on réessaiera
    for (const c of lot) attentePlanning.delete(PLAN.cleCase(c));
    renvoiPlanning?.();
    E.planningRefus = { texte: `Le planning n’a pas été enregistré : ${String(e.message).replace(/\.?$/, '.')}`, lot };
    if (E.vue === 'planning') rendrePlanning();
  }
}

/** « Aujourd'hui » par lieu : une carte par lieu ou projet, avec avatars, effectif et actions de terrain. */
function vueParLieu(P) {
  const jour = E.planningJour && P.jours.includes(E.planningJour) ? E.planningJour : undefined;
  const L = PLAN.parLieu(P, jour);
  const avatar = (l) => h('button', { type: 'button', class: 'bz-planning__personne', onclick: () => selectionner(l.id), 'data-infobulle': l.poste ? `${sansDemo(l.nom)} · ${l.poste}` : null },
    h('span', { class: 'bz-avatar', 'aria-hidden': 'true', texte: initiale(l.nom) }), h('span', { texte: sansDemo(l.nom) }));
  return h('section', { class: 'bz-planning__section', 'aria-labelledby': 'planning-lieux-titre' },
    h('div', { class: 'bz-planning__section-tete' },
      h('h2', { class: 'bz-t-titre-4', id: 'planning-lieux-titre', texte: L.jour === P.aujourdhui ? 'Qui est où aujourd’hui' : `Qui est où, ${PLAN.jourLong(L.jour)}` }),
      h('div', { class: 'bz-puces', role: 'group', 'aria-label': 'Jour affiché' }, P.jours.map((j) => h('button', { type: 'button', class: 'bz-puce', 'aria-pressed': j === L.jour, onclick: () => { E.planningJour = j; dessinerPlanning(); } },
        j === P.aujourdhui ? 'Aujourd’hui' : PLAN.jourCourt(j))))),
    h('ul', { class: 'bz-planning__lieux', role: 'list' },
      L.lieux.map((c) => {
        const T = terrainCible(c);
        const url = T.adresse && TERRAIN ? TERRAIN.lienItineraire(T.adresse, { appli: lireLocal('lb-itineraire') ?? 'systeme', ios: estIos() }) : null;
        return h('li', { class: 'bz-carte bz-planning__lieu', 'data-sous': c.sous ? '' : null },
          h('div', { class: 'bz-carte__tete' },
            h('span', { class: `bz-cat bz-cat--${c.famille === 'projet' ? 'carre-pointille' : 'goutte'} bz-cat--sm`, 'aria-hidden': 'true' }, icone(c.famille === 'projet' ? 'flag' : 'map-pin', { taille: 'sm' })),
            h('div', { class: 'bz-pile' },
              h('h3', { class: 'bz-carte__titre' }, h('button', { type: 'button', class: 'bz-lien', onclick: () => selectionner(c.id), texte: sansDemo(c.libelle) })),
              h('p', { class: 'bz-t-petit bz-texte-2', texte: c.famille === 'projet' ? `Chez le client${T.client ? ` · ${sansDemo(T.client.nom)}` : ''}` : 'Lieu' })),
            typeof c.besoin === 'number' ? h('span', { class: `bz-badge bz-badge--${c.sous ? (c.nb === 0 ? 'critique' : 'attention') : 'ok'}` }, icone(c.sous ? 'triangle-alert' : 'circle-check', { taille: 'sm' }), `${c.nb} sur ${c.besoin}`)
              : h('span', { class: 'bz-badge', texte: pluriel(c.nb, 'personne', 'personnes') })),
          c.personnes.length ? h('div', { class: 'bz-planning__avatars' }, c.personnes.map(avatar)) : h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Personne n’est prévu.' }),
          url || T.tel ? h('div', { class: 'bz-groupe-boutons' },
            url ? h('a', { class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', href: url, target: '_blank', rel: 'noopener noreferrer' }, icone('navigation', { taille: 'sm' }), 'Y aller') : null,
            T.tel ? h('a', { class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', href: T.tel.lien }, icone('phone', { taille: 'sm' }), h('span', { class: 'bz-t-chiffre', texte: T.tel.affiche }), h('span', { class: 'bz-visuellement-cache', texte: ` (${sansDemo(T.client?.nom ?? 'client')})` })) : null) : null);
      }),
      L.hors.length ? h('li', { class: 'bz-carte bz-planning__lieu' },
        h('div', { class: 'bz-carte__tete' }, h('h3', { class: 'bz-carte__titre', texte: 'Absents, en mission, non affectés' }), h('span', { class: 'bz-badge', texte: nombre(L.hors.length) })),
        h('ul', { class: 'bz-planning__hors', role: 'list' }, L.hors.map(({ ligne: l, valeur }) => h('li', {},
          h('button', { type: 'button', class: 'bz-planning__personne', onclick: () => selectionner(l.id) }, h('span', { class: 'bz-avatar', 'aria-hidden': 'true', texte: initiale(l.nom) }), h('span', { texte: sansDemo(l.nom) })),
          boutonCase(P, l, L.jour))))) : null));
}

/** Vue par personne (téléphone d'abord) : chaque personne et ses jours, chaque jour modifiable par son menu. */
function vueParPersonne(P) {
  return h('section', { class: 'bz-planning__section', 'aria-labelledby': 'planning-personnes-titre' },
    h('h2', { class: 'bz-t-titre-4', id: 'planning-personnes-titre', texte: 'Par personne' }),
    PLAN.parPersonne(P).map((g) => h('section', { class: 'bz-planning__groupe', 'aria-label': g.groupe },
      h('h3', { class: 'bz-t-surtitre bz-texte-2', texte: g.groupe }),
      h('ul', { class: 'bz-planning__personnes', role: 'list' }, g.personnes.map((l) => h('li', { class: 'bz-carte bz-planning__fiche-personne' },
        h('div', { class: 'bz-carte__tete' },
          h('span', { class: 'bz-avatar', 'aria-hidden': 'true', texte: initiale(l.nom) }),
          h('div', { class: 'bz-pile' }, h('h4', { class: 'bz-carte__titre' }, h('button', { type: 'button', class: 'bz-lien', onclick: () => selectionner(l.id), texte: sansDemo(l.nom) })), l.poste ? h('p', { class: 'bz-t-petit bz-texte-2', texte: l.poste }) : null)),
        h('ol', { class: 'bz-planning__jours-personne', role: 'list' }, P.jours.map((j) => h('li', { 'data-aujourdhui': j === P.aujourdhui ? '' : null, 'data-weekend': PLAN.estWeekEnd(j) ? '' : null },
          h('span', { class: 'bz-planning__nom-jour bz-t-petit', texte: j === P.aujourdhui ? 'Aujourd’hui' : PLAN.jourCourt(j) }),
          boutonCase(P, l, j))))))))));
}

/** La semaine en grille (ordinateur) : cases-pastilles, effectifs prévus face aux besoins. */
function vueSemaine(P) {
  const groupes = [...new Set(P.lignes.map((l) => l.groupe))];
  const besoins = P.cibles.filter((c) => c.besoin !== null);
  const table = h('table', { class: 'bz-tableau bz-planning__grille', style: `--nb-jours: ${P.jours.length}`, 'aria-label': `Planning de la semaine ${PLAN.semaineIso(P.debut)}`, 'aria-describedby': 'planning-aide' },
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', texte: 'Personne' }), P.jours.map((j) => h('th', { scope: 'col', 'data-aujourdhui': j === P.aujourdhui ? '' : null, 'data-weekend': PLAN.estWeekEnd(j) ? '' : null },
      h('span', { 'aria-hidden': 'true', texte: PLAN.jourCourt(j) }), h('span', { class: 'bz-visuellement-cache', texte: PLAN.jourLong(j) }), j === P.aujourdhui ? h('span', { class: 'bz-t-micro bz-planning__auj', texte: 'aujourd’hui' }) : null)))),
    h('tbody', {},
      groupes.map((g) => [
        h('tr', { class: 'bz-planning__intertitre' }, h('th', { scope: 'rowgroup', colspan: String(P.jours.length + 1), texte: g })),
        P.lignes.filter((l) => l.groupe === g).map((l) => h('tr', {},
          h('th', { scope: 'row', class: 'bz-planning__qui' }, h('button', { type: 'button', class: 'bz-lien', onclick: () => selectionner(l.id), texte: sansDemo(l.nom) }), l.poste ? h('span', { class: 'bz-t-micro bz-texte-2', texte: l.poste }) : null),
          P.jours.map((j) => h('td', { 'data-aujourdhui': j === P.aujourdhui ? '' : null }, boutonCase(P, l, j))))),
      ]),
      besoins.length ? [h('tr', { class: 'bz-planning__intertitre' }, h('th', { scope: 'rowgroup', colspan: String(P.jours.length + 1), texte: 'Effectifs prévus face aux besoins' })),
        besoins.map((c) => h('tr', { class: 'bz-planning__total' }, h('th', { scope: 'row', texte: sansDemo(c.libelle) }), P.jours.map((j) => {
          const n = P.totaux[c.valeur]?.[j] ?? 0;
          const ton = n < c.besoin ? (n === 0 ? 'critique' : 'attention') : 'ok';
          return h('td', { class: 'bz-num', 'data-aujourdhui': j === P.aujourdhui ? '' : null }, h('span', { class: `bz-badge bz-badge--${ton}` }, icone(ICONE_TON[ton], { taille: 'sm' }), `${n} sur ${c.besoin}`));
        })))] : null));
  if (P.modifiable) glisserPlanning(table);
  return h('section', { class: 'bz-planning__section', 'aria-labelledby': 'planning-semaine-titre' },
    h('h2', { class: 'bz-t-titre-4', id: 'planning-semaine-titre', texte: 'La semaine' }),
    h('p', { class: 'bz-t-petit bz-texte-2', id: 'planning-aide', texte: P.modifiable ? 'Choisissez une case pour changer l’affectation. Maj + clic ou Maj + flèches pour en sélectionner plusieurs ; glissez depuis une case pour recopier sa valeur.' : 'Lecture seule pour votre rôle.' }),
    h('div', { class: 'bz-tableau-cadre bz-planning__cadre' }, table));
}

/** Projets en cours : avancement et échéance en barres (SVG fait main, §4.22), avec le texte équivalent. */
function projetsPlanning(P) {
  const projets = P.cibles.filter((c) => c.famille === 'projet');
  if (!projets.length) return null;
  return h('section', { class: 'bz-planning__section', 'aria-labelledby': 'planning-projets-titre' },
    h('h2', { class: 'bz-t-titre-4', id: 'planning-projets-titre', texte: 'Projets en cours' }),
    h('ul', { class: 'bz-criteres__liste', role: 'list' }, projets.map((c) => {
      const jours = c.echeance ? Math.max(0, Math.round((new Date(`${c.echeance}T00:00:00Z`) - new Date(`${P.aujourdhui}T00:00:00Z`)) / 86400000)) : null;
      const nb = P.lignes.filter((l) => l.cases[P.aujourdhui] === c.valeur).length;
      const ton = c.retard ? 'critique' : null;
      return h('li', { class: 'bz-critere' },
        h('div', { class: 'bz-critere__tete' }, h('button', { type: 'button', class: 'bz-lien bz-critere__nom', onclick: () => selectionner(c.id), texte: sansDemo(c.libelle) }),
          h('span', { class: 'bz-critere__note bz-t-chiffre', texte: c.avancement === null ? '—' : `${nombre(c.avancement)} %` })),
        barreScore(c.avancement ?? 0, ton),
        h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, c.retard ? iconeEtat('critique', { taille: 'sm', decoratif: true }) : null,
          [c.avancement === null ? 'Avancement pas encore renseigné' : `${nombre(c.avancement)} % fait`, `${pluriel(nb, 'personne', 'personnes')} sur place aujourd’hui`, c.echeance ? `échéance ${dateRelative(c.echeance)}${jours !== null && jours > 7 ? ` (dans ${pluriel(jours, 'jour', 'jours')})` : ''}` : null, c.retard ? `${pluriel(c.retard, 'jour', 'jours')} de retard` : null].filter(Boolean).join(' · ')));
    })));
}

// ---------------------------------------------------------------- courrier : boîte de réception classique (§6.1 P8)
/* Expéditeur, avatar, objet, aperçu, bac en puce neutre, urgence montrée seulement si elle est haute. « Traité » et
   « Déléguer » d'un balayage (toucher), toujours doublés du menu « ⋯ » ; annulation par le toast. Le tri d'un mail
   collé passe dans « Mode avancé ». Choix de ce qui s'affiche : web/courrier.js (module pur). */
let COURRIER = null;
const chargerCourrier = async () => (COURRIER ??= await import('/courrier.js'));
const RANG_URGENCE = { haute: 0, normale: 1, basse: 2 };

/** Écrit le statut d'un courrier, optimiste et annulable ; un refus revient en arrière avec sa raison sous la ligne. */
async function statutCourrier(o, traite) {
  const c = o.champs.find((x) => x.id === 'statut');
  const avant = c?.valeur ?? 'à traiter';
  const apres = traite ? 'traité' : 'à traiter';
  if (c) c.valeur = apres; else o.champs.push({ id: 'statut', libelle: 'Statut', type: 'choix', valeur: apres });
  (E.courrierErreurs ??= new Map()).delete(o.id);
  // la ligne traitée peut quitter la liste : le focus passe à la suivante, jamais sur <body>
  const ici = document.querySelector(`[data-cle="courrier-${CSS.escape(o.id)}"]`)?.closest('li');
  const voisine = (ici?.nextElementSibling ?? ici?.previousElementSibling)?.querySelector('.bz-courrier__objet')?.dataset.cle ?? null;
  if (E.vue === 'courrier') {
    await rendreCourrier();
    if (document.activeElement === document.body && voisine) $(`[data-cle="${CSS.escape(voisine)}"]`)?.focus({ preventScroll: true });
  }
  try {
    await api('POST', `/courrier/${encodeURIComponent(o.id)}/statut`, { statut: apres });
    actionAnnulable({ texte: traite ? 'Courrier traité.' : 'Courrier remis à traiter.', libelle: `courrier de ${sansDemo(valeurDe(o, 'expediteur') ?? o.nom)}`,
      annuler: async () => { await api('POST', `/courrier/${encodeURIComponent(o.id)}/statut`, { statut: avant }); await charger(); } });
    await charger();
  } catch (e) {
    if (c) c.valeur = avant;
    E.courrierErreurs.set(o.id, e.statut ? `Pas enregistré : ${e.message}` : 'Pas enregistré : la connexion a été perdue. Réessayez.');
    if (E.vue === 'courrier') rendreCourrier();
  }
}
async function basculerCourrierTraite(o, traite) { return statutCourrier(o, !traite); }

/** « Déléguer à… » : choix de la personne (feuille sur téléphone), écrit par « objet.modifier », annulable. */
function deleguerCourrier(o) {
  const personnes = E.monde.objets.filter((x) => x.famille === 'personne').sort((a, b) => sansDemo(a.nom).localeCompare(sansDemo(b.nom), 'fr'));
  const actuel = o.champs.find((x) => x.id === 'destinataire')?.lien?.id ?? '';
  const S = { choix: actuel, erreur: null, envoi: false };
  const D = dialogueVivant({
    titre: 'Déléguer ce courrier', surtitre: 'Courrier', taille: 'sm',
    onsubmit: async () => {
      if (!S.choix) { S.erreur = 'Choisissez une personne.'; D.rendre(); return; }
      S.envoi = true; D.rendre();
      try {
        const a = await ecrireChamp(o, 'destinataire', S.choix);
        if (a.etat === 'echouee' || a.etat === 'resultat_inconnu') throw Object.assign(new Error(a.message ?? 'Délégation refusée.'), { statut: 409 });
        D.fermer();
        const nom = sansDemo(personnes.find((p) => p.id === S.choix)?.nom ?? '');
        if (a.etat === 'en_attente') informer('Délégation envoyée pour approbation.', '');
        else actionAnnulable({ texte: `Courrier délégué à ${nom}.`, libelle: `délégation du courrier à ${nom}`, annuler: async () => { await ecrireChamp(o, 'destinataire', actuel || null); await charger(); } });
        await charger();
      } catch (e) { S.envoi = false; S.erreur = e.message; D.rendre(); }
    },
    contenu: () => ({
      corps: [
        h('div', { class: 'bz-champ' },
          h('label', { class: 'bz-champ__libelle', for: 'deleguer-a', texte: 'À qui le confier ?' }),
          h('div', { class: 'bz-select' },
            h('select', { id: 'deleguer-a', class: 'bz-champ__saisie', 'aria-invalid': S.erreur ? 'true' : null, 'aria-describedby': S.erreur ? 'deleguer-erreur' : null, onchange: (e) => { S.choix = e.target.value; S.erreur = null; } },
              h('option', { value: '', texte: 'Choisir une personne' }),
              personnes.map((p) => h('option', { value: p.id, selected: p.id === S.choix, texte: `${sansDemo(p.nom)}${valeurDe(p, 'poste') ? ` · ${valeurDe(p, 'poste')}` : ''}` }))),
            icone('chevron-down', { taille: 'sm' })),
          S.erreur ? h('p', { class: 'bz-champ__erreur', id: 'deleguer-erreur', role: 'alert' }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: S.erreur })) : null),
        h('p', { class: 'bz-t-petit', texte: `« ${sansDemo(valeurDe(o, 'objet') ?? o.nom)} » apparaîtra dans son courrier. Vous pourrez annuler.` }),
      ],
      pied: [
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler'),
        h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, icone('forward'), 'Déléguer'),
      ],
    }),
  });
}

/** Crée une tâche liée au courrier, avec l'action proposée comme titre (formulaire de la fiche). */
async function tacheDepuisCourrier(o) {
  await selectionner(o.id);
  const a = E.fiche?.actionsPossibles?.find((x) => x.capacite === 'tache.creer');
  if (!a) return;
  const f = nouveauFormulaire(a);
  f.valeurs.titre = valeurDe(o, 'action') ?? '';
  E.formulaire = f;
  rendreFiche();
}

/** Balayage d'une ligne au toucher (2.5.7 : toujours doublé du menu « ⋯ ») : « Traité » à droite, « Déléguer » à gauche. */
function balayageCourrier(ligneEl, contenu, o, l) {
  let x0 = null;
  let y0 = 0;
  let dx = 0;
  let suivi = false;
  const remettre = () => { contenu.style.translate = ''; ligneEl.removeAttribute('data-balayage'); };
  contenu.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch' || e.target.closest('button, a, select, input')) return;
    x0 = e.clientX; y0 = e.clientY; dx = 0; suivi = false;
  });
  contenu.addEventListener('pointermove', (e) => {
    if (x0 === null) return;
    dx = e.clientX - x0;
    if (!suivi && Math.abs(e.clientY - y0) > Math.abs(dx)) { x0 = null; return; } // défilement vertical : on laisse faire
    if (!suivi && Math.abs(dx) > 8) { suivi = true; contenu.setPointerCapture?.(e.pointerId); }
    if (!suivi) return;
    contenu.style.translate = `${Math.round(dx)}px 0`;
    ligneEl.setAttribute('data-balayage', dx > 0 ? 'traiter' : 'deleguer');
  });
  const fin = () => {
    if (x0 === null) return;
    const issue = suivi ? COURRIER.issueBalayage(dx, ligneEl.clientWidth, { traite: l.traite }) : null;
    x0 = null;
    remettre();
    if (issue === 'traiter') statutCourrier(o, true);
    else if (issue === 'remettre') statutCourrier(o, false);
    else if (issue === 'deleguer') deleguerCourrier(o);
  };
  contenu.addEventListener('pointerup', fin);
  contenu.addEventListener('pointercancel', () => { x0 = null; remettre(); });
}

async function rendreCourrier() {
  const K = await chargerCourrier();
  if (E.vue !== 'courrier') return;
  const m = E.monde;
  const C = (E.courrier ??= { bac: 'tous', pour: 'tous', traites: false, recherche: '', tri: { texte: '', resultat: null, erreur: null } });
  const objets = new Map(m.objets.filter((o) => o.type === 'courrier' && dansFiltre(o)).map((o) => [o.id, o]));
  const toutes = K.lignes({ objets: [...objets.values()] });
  const liste = K.boite(toutes, C);
  const ouverts = toutes.filter((l) => !l.traite);
  const bacs = K.bacs(toutes);
  const dests = K.destinataires(toutes);
  const peut = Boolean(m.profil.peutPreparer);
  const erreurs = E.courrierErreurs ?? new Map();
  const changer = (k, v) => { C[k] = v; rendreCourrier(); };
  const maintenant = new Date();

  const ligne = (l) => {
    const o = objets.get(l.id);
    const idObjet = `courrier-objet-${idDom(l.id)}`;
    const contenu = h('div', { class: 'bz-courrier__contenu' },
      h('span', { class: 'bz-avatar bz-courrier__avatar', 'aria-hidden': 'true', texte: l.initiales }),
      h('div', { class: 'bz-courrier__texte' },
        h('p', { class: 'bz-courrier__tete' },
          h('span', { class: 'bz-courrier__expediteur', texte: l.expediteur }),
          l.recuLe ? h('time', { class: 'bz-courrier__date bz-t-micro', datetime: l.recuLe, texte: K.dateCourte(l.recuLe, maintenant) }) : null),
        h('a', { href: '#/courrier', class: 'bz-courrier__objet', id: idObjet, cle: `courrier-${l.id}`, 'aria-current': E.selection === l.id ? 'true' : null,
          onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); selectionner(l.id); }, texte: l.objet }),
        l.apercu ? h('p', { class: 'bz-courrier__apercu', texte: l.apercu }) : null,
        h('p', { class: 'bz-courrier__meta' },
          l.urgent && !l.traite ? h('span', { class: 'bz-badge bz-badge--critique' }, icone('octagon-alert', { taille: 'sm' }), 'Urgent') : null,
          h('span', { class: 'bz-badge' }, icone('inbox', { taille: 'sm' }), K.libelleBac(l.bac)),
          l.traite ? h('span', { class: 'bz-badge bz-badge--ok' }, icone('circle-check', { taille: 'sm' }), 'Traité') : null,
          l.destinataire ? h('span', { class: 'bz-t-micro bz-texte-2', texte: `Pour ${l.destinataire.nom}` }) : null),
        l.action && !l.traite ? h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, icone('lightbulb', { taille: 'sm' }), h('span', { texte: `Proposé : ${l.action}` })) : null,
        erreurs.has(l.id) ? h('p', { class: 'bz-champ__erreur', role: 'alert' }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: erreurs.get(l.id) }),
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => statutCourrier(o, !l.traite) }, 'Réessayer')) : null),
      h('div', { class: 'bz-courrier__actions' },
        peut ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', cle: `traiter-${l.id}`, 'aria-describedby': idObjet, onclick: () => statutCourrier(o, !l.traite) },
          icone(l.traite ? 'rotate-ccw' : 'check', { taille: 'sm' }), h('span', { class: 'bz-courrier__libelle-action', texte: l.traite ? 'À traiter' : 'Traité' })) : null,
        menuActions({ id: `menu-courrier-${idDom(l.id)}`, libelle: `Actions pour le courrier de ${l.expediteur}`, items: [
          peut ? { libelle: l.traite ? 'Remettre à traiter' : 'Marquer comme traité', icone: l.traite ? 'rotate-ccw' : 'check', faire: () => statutCourrier(o, !l.traite) } : null,
          peut ? { libelle: 'Déléguer à…', icone: 'forward', faire: () => deleguerCourrier(o) } : null,
          peut ? { libelle: 'Créer une tâche', icone: 'list-checks', faire: () => tacheDepuisCourrier(o) } : null,
          l.tiers ? { libelle: `Voir ${l.tiers.nom}`, icone: 'contact', faire: () => selectionner(l.tiers.id) } : null,
          { libelle: 'Ouvrir la fiche', icone: 'panel-left', faire: () => selectionner(l.id) },
        ] })));
    const li = h('li', { class: 'bz-courrier__ligne', 'data-traite': l.traite ? '' : null, 'data-urgent': l.urgent && !l.traite ? '' : null, 'data-courant': E.selection === l.id ? '' : null },
      h('div', { class: 'bz-courrier__fond', 'aria-hidden': 'true' },
        h('span', { class: 'bz-courrier__fond-traiter' }, icone(l.traite ? 'rotate-ccw' : 'check'), l.traite ? 'À traiter' : 'Traité'),
        h('span', { class: 'bz-courrier__fond-deleguer' }, 'Déléguer', icone('forward'))),
      contenu);
    if (peut) balayageCourrier(li, contenu, o, l);
    return li;
  };

  const trier = async () => { try { C.tri.resultat = await api('POST', '/courrier/trier', { texte: C.tri.texte }); C.tri.erreur = null; } catch (e) { C.tri.erreur = e.message; } rendreCourrier(); };
  const ajouter = async () => {
    const r = C.tri.resultat;
    try {
      await api('POST', '/objets', { type: 'courrier', nom: r.objet || 'Courrier', champs: { expediteur: r.expediteur, objet: r.objet, resume: r.resume, bac: r.bac, urgence: r.urgence, action: r.action, statut: 'à traiter', recu_le: new Date().toISOString(), ...(r.destinataire ? { destinataire: r.destinataire.id } : {}) } });
      C.tri = { texte: '', resultat: null, erreur: null };
      await charger();
      informer('Courrier ajouté et trié.', 'ok');
    } catch (e) { C.tri.erreur = e.message; rendreCourrier(); }
  };
  // « Ajouter un courrier » : aucune boîte mail ne se connecte encore directement ; on le dit, et on ouvre ce qui marche
  const ajouterCourrier = async () => {
    C.tri.ouvert = true;
    await rendreCourrier();
    const champ = $('#courrier-colle');
    champ?.scrollIntoView({ block: 'center' });
    champ?.focus();
  };
  const boutonAjouter = (classe) => h('button', { type: 'button', class: `bz-bouton ${classe}`, cle: 'courrier-ajouter', 'aria-controls': 'courrier-avance', onclick: ajouterCourrier }, icone('clipboard-paste'), 'Ajouter un courrier');
  const avance = peut ? h('details', { class: 'bz-repli', id: 'courrier-avance', open: Boolean(C.tri.ouvert || C.tri.texte || C.tri.resultat || C.tri.erreur) || null,
    ontoggle: (e) => { C.tri.ouvert = e.currentTarget.open; } },
    h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Ajouter un courrier : coller un mail' }), h('span', { class: 'bz-repli__note', texte: 'tri par mots-clés, sans IA' }), icone('chevron-down', { taille: 'sm' })),
    h('div', { class: 'bz-repli__corps bz-pile' },
      h('p', { class: 'bz-t-petit', texte: 'Collez un mail : Living Business propose le bac, l’urgence, la personne et l’action.' }),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Votre boîte mail ne se connecte pas encore directement. Pour recevoir vos mails tout seuls, il faut aujourd’hui un outil d’automatisation (Make, Zapier ou n8n) : Connecter mes données, puis « Mode avancé ».' }),
      h('div', { class: 'bz-champ' },
        h('label', { class: 'bz-champ__libelle', for: 'courrier-colle', texte: 'Texte du mail' }),
        h('textarea', { id: 'courrier-colle', class: 'bz-champ__saisie', rows: '6', placeholder: 'De : …\nObjet : …\nTexte du mail', oninput: (e) => (C.tri.texte = e.target.value) }, C.tri.texte)),
      h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: trier }, icone('sparkles'), 'Trier')),
      messageEnLigne('critique', C.tri.erreur),
      C.tri.resultat ? h('section', { class: 'bz-carte', 'aria-label': 'Tri proposé' },
        h('dl', { class: 'bz-champs-fiche' }, [['Expéditeur', C.tri.resultat.expediteur], ['Objet', C.tri.resultat.objet], ['Bac', K.libelleBac(C.tri.resultat.bac)], ['Urgence', C.tri.resultat.urgence],
          ['Pour', C.tri.resultat.destinataire ? sansDemo(C.tri.resultat.destinataire.nom) : 'À choisir'], ['Action proposée', C.tri.resultat.action]].map(([k, v]) => h('div', { class: 'bz-champ-fiche' }, h('dt', { class: 'bz-champ-fiche__libelle', texte: k }), h('dd', { class: 'bz-champ-fiche__valeur', texte: v ?? '—' })))),
        m.profil.peutAdministrer ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: ajouter }, icone('plus'), 'Ajouter au courrier')) : null) : null)) : null;

  const filtre = C.bac !== 'tous' || C.pour !== 'tous' || C.recherche.trim();
  remplir($('#page'), h('div', { class: 'bz-ecran bz-courrier' },
    h('div', { class: 'bz-liste__tete' },
      h('p', { class: 'bz-liste__compte bz-t-petit bz-texte-2' }, ouverts.length ? pluriel(ouverts.length, 'courrier à traiter', 'courriers à traiter') : 'Rien à traiter', toutes.some((l) => l.exemple) ? badgeExemple() : null),
      // boîte vide : le bouton est dans l'écran vide, plus bas (une seule action principale, jamais deux fois la même)
      peut && toutes.length ? h('div', { class: 'bz-groupe-boutons' }, boutonAjouter('bz-bouton--secondaire')) : null),
    toutes.length ? h('div', { class: 'bz-liste__outils' },
      h('label', { class: 'bz-recherche bz-liste__recherche' }, icone('search'), h('span', { class: 'bz-visuellement-cache', texte: 'Rechercher dans le courrier' }),
        h('input', { class: 'bz-champ__saisie', type: 'search', id: 'recherche-courrier', enterkeyhint: 'search', autocomplete: 'off', placeholder: 'Rechercher un expéditeur, un objet…', value: C.recherche, oninput: (e) => changer('recherche', e.target.value) })),
      dests.length ? h('div', { class: 'bz-liste__vues' },
        h('label', { class: 'bz-visuellement-cache', for: 'courrier-pour', texte: 'Pour qui' }),
        h('div', { class: 'bz-select' },
          h('select', { id: 'courrier-pour', class: 'bz-champ__saisie', onchange: (e) => changer('pour', e.target.value) },
            h('option', { value: 'tous', texte: `Pour tout le monde (${ouverts.length})` }),
            dests.map((d) => h('option', { value: d.id, selected: C.pour === d.id, texte: `Pour ${d.nom} (${ouverts.filter((l) => l.destinataire?.id === d.id).length})` }))),
          icone('chevron-down', { taille: 'sm' }))) : null) : null,
    toutes.length ? h('ul', { class: 'bz-puces bz-puces--rangee', 'aria-label': 'Bacs' },
      h('li', {}, h('button', { type: 'button', class: 'bz-puce', 'aria-pressed': C.bac === 'tous', onclick: () => changer('bac', 'tous') }, C.bac === 'tous' ? icone('check', { taille: 'sm' }) : null, `Tous · ${ouverts.length}`)),
      bacs.map((b) => h('li', {}, h('button', { type: 'button', class: 'bz-puce', 'aria-pressed': C.bac === b.id, onclick: () => changer('bac', b.id), 'aria-label': `${b.libelle} : ${pluriel(b.nb, 'à traiter', 'à traiter')}${b.urgents ? `, dont ${pluriel(b.urgents, 'urgent', 'urgents')}` : ''}` },
        C.bac === b.id ? icone('check', { taille: 'sm' }) : null, `${b.libelle} · ${b.nb}`, b.urgents ? icone('octagon-alert', { taille: 'sm', classe: 'bz-courrier__urgent' }) : null))),
      h('li', {}, h('button', { type: 'button', class: 'bz-puce', 'aria-pressed': C.traites, onclick: () => changer('traites', !C.traites) }, icone(C.traites ? 'eye' : 'eye-off', { taille: 'sm' }), 'Afficher les traités'))) : null,
    filtreDepartements(),
    !toutes.length ? videRubrique('courrier', { action: peut ? boutonAjouter('bz-bouton--principal') : null })
      : !liste.length ? (filtre
        ? blocVide({ titre: 'Aucun courrier pour ces filtres.', texte: 'Essayez d’élargir la recherche.', actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { Object.assign(C, { bac: 'tous', pour: 'tous', recherche: '' }); rendreCourrier(); } }, icone('x'), 'Effacer les filtres') })
        : blocVide({ titre: 'Rien à traiter.', texte: 'Tout le courrier est traité.', actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => changer('traites', true) }, icone('eye'), 'Afficher les traités') }))
      : h('ul', { class: 'bz-courrier__liste', role: 'list', 'aria-label': 'Courrier' }, liste.map(ligne)),
    peut && toutes.length ? h('p', { class: 'bz-t-micro bz-texte-2 bz-courrier__aide', texte: 'Au doigt : balayez une ligne vers la droite pour « Traité », vers la gauche pour « Déléguer ». Le menu « ⋯ » fait la même chose.' }) : null,
    avance));
}

// ---------------------------------------------------------------- temps réel (Server-Sent Events)
function fermerTempsReel() {
  E.flux?.close();
  E.flux = null;
  E.direct = false;
}
function ecouterTempsReel() {
  if (E.flux || typeof EventSource === 'undefined') return;
  const es = new EventSource('/api/v1/flux');
  E.flux = es;
  es.addEventListener('open', () => { E.direct = true; majIndicateurDirect(); });
  es.addEventListener('error', () => { E.direct = false; majIndicateurDirect(); });
  es.addEventListener('maj', () => {
    clearTimeout(ecouterTempsReel.t);
    ecouterTempsReel.t = setTimeout(rafraichirEnDirect, 300);
  });
}
function occupe() {
  const a = document.activeElement;
  return Boolean($('#modale')?.childElementCount) || Boolean(E.assistantDlg?.open) || (a && ['INPUT', 'TEXTAREA', 'SELECT'].includes(a.tagName) && !a.closest('#barre, #menu-compte, .bz-palette'));
}
async function rafraichirEnDirect() {
  if (!E.monde || E.monde.mode === 'simulation') return;
  if (occupe()) { E.majEnAttente = true; majIndicateurDirect(); return; }
  E.majEnAttente = false;
  try {
    await charger();
  } catch { /* hors ligne : nouvel essai au prochain signal */ }
}
/** Temps réel (en-tête) : « En direct » ; des nouveautés arrivées pendant une saisie s'appliquent d'un clic. */
function indicateurDirect() {
  if (E.majEnAttente) {
    return h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm bz-direct', id: 'direct', 'data-etat': 'attente', 'data-infobulle': 'Des changements sont arrivés pendant votre saisie : cliquez pour les afficher.', onclick: () => { E.majEnAttente = false; charger(); } },
      icone('refresh-cw', { taille: 'sm' }), 'Nouveautés');
  }
  return h('span', { class: 'bz-direct', id: 'direct', 'data-etat': E.direct ? 'actif' : 'reconnexion',
    'data-infobulle': E.direct ? 'Temps réel : les changements faits par vos collègues, vos outils branchés ou vos formulaires s’affichent tout seuls.' : 'Connexion temps réel en cours…' },
  h('span', { class: 'bz-direct__point', 'aria-hidden': 'true' }), E.direct ? 'En direct' : 'Reconnexion…');
}
function majIndicateurDirect() {
  const el = $('#direct');
  if (el) el.replaceWith(indicateurDirect());
}
document.addEventListener('focusout', () => { if (E.majEnAttente) setTimeout(() => { if (!occupe()) rafraichirEnDirect(); }, 400); });

// ---------------------------------------------------------------- outils communs
function telecharger(nom, contenu, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(type.startsWith('text/csv') ? ['﻿', contenu] : [contenu], { type }));
  const a = h('a', { href: url, download: nom });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function copier(texte, quoi = 'Copié') {
  try {
    await navigator.clipboard.writeText(texte);
    informer(`${quoi} dans le presse-papiers.`, 'ok');
  } catch {
    informer('Copie impossible : sélectionnez le texte à la main.', 'erreur');
  }
}
const blocCode = (texte, libelle = 'Copier') => h('div', { class: 'bz-code' }, h('pre', { texte }), h('button', { class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', type: 'button', onclick: () => copier(texte) }, icone('copy', { taille: 'sm' }), libelle));
function modeleCsv(typeId) {
  const t = E.monde.univers.types.find((x) => x.id === typeId);
  if (!t) return;
  const entetes = ['Nom', ...(t.famille === 'tiers' ? ['Rôles'] : []), ...t.champs.map((c) => c.libelle)];
  const exemple = ['Exemple', ...(t.famille === 'tiers' ? ['client'] : []), ...t.champs.map((c) => (c.type === 'date' ? '31/12/2026' : c.type === 'booleen' ? 'oui' : c.type === 'choix' ? (c.choix?.[0] ?? '') : c.type === 'nombre' || c.type === 'montant' ? '0' : ''))];
  telecharger(`modele-${t.id}.csv`, texteCsv([entetes, exemple]));
}

// ---------------------------------------------------------------- compléter mon entreprise, pas à pas
const ETAPES_ACCUEIL = [
  ['entreprise', 'Votre entreprise'],
  ['lieux', 'Vos lieux'],
  ['departements', 'Vos services'],
  ['equipe', 'Votre équipe'],
  ['tiers', 'Clients et fournisseurs'],
  ['outils', 'Vos outils'],
  ['fin', 'C’est prêt'],
];
const SERVICES_COURANTS = [['Direction', 'ardoise'], ['Commercial', 'bleu'], ['Production', 'orange'], ['Logistique', 'vert'], ['Administration & finance', 'violet'], ['Ressources humaines', 'rouge'], ['Service client', 'turquoise'], ['Achats', 'jaune'], ['Marketing', 'bleu'], ['Informatique', 'ardoise']];

function etapeAccueilCourante() {
  const o = E.monde.organisation;
  if (o.demo) return -1;
  return Math.min(ETAPES_ACCUEIL.length - 1, Math.max(0, o.etapeAccueil ?? 0));
}

async function sauverEtapeAccueil(n) {
  if ((E.monde.organisation.etapeAccueil ?? 0) >= n) return;
  await api('PUT', '/organisation', { etape_accueil: n });
}

/* « Compléter mon entreprise » (ex-« Mise en route ») : plus un parcours d'accueil (« Premiers pas » est le seul, §4.20),
   mais l'outil pas à pas qui y mène (« Nommer mon entreprise », « Ajouter mon équipe ») : étapes du §4.21, chaque réponse
   enregistrée aussitôt, saisie rapide en lignes qui s'empilent sur téléphone, import possible à chaque étape. */
function rendreAccueil() {
  const m = E.monde;
  const A = (E.accueil ??= { etape: null, lignes: {}, envoi: false, erreur: null, nom: '', creation: { nom: '' } });
  const page = $('#page');
  if (!m.profil.peutAdministrer) {
    remplir(page, h('div', { class: 'bz-ecran' }, blocVide({ titre: 'Les informations de l’entreprise sont complétées par la direction.', compact: true })));
    return;
  }
  const pourquoi = (texte) => h('aside', { class: 'bz-pourquoi', 'aria-label': 'Pourquoi on vous le demande' }, icone('info'), h('div', {}, h('strong', { texte: 'Pourquoi on vous le demande' }), h('p', { texte })));
  const etapeCourante = A.etape ?? etapeAccueilCourante();
  const champ = (id, libelle, saisie, { aide = null, large = false } = {}) => h('div', { class: `bz-champ${large ? ' bz-champ--large' : ''}` },
    h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }), aide ? h('span', { class: 'bz-champ__aide', id: `${id}-aide`, texte: aide }) : null, saisie);
  const liste = (id, options, valeur, onchange) => h('div', { class: 'bz-select' }, h('select', { id, onchange }, options.map(([v, l]) => h('option', { value: v, selected: v === valeur, texte: l }))), icone('chevron-down'));

  // 0. entreprise exemple : on commence par créer l'entreprise
  if (m.organisation.demo) {
    remplir(page, h('div', { class: 'bz-ecran bz-completer' },
      h('header', { class: 'bz-pile' },
        h('p', { class: 'bz-t-surtitre', texte: `${pluriel(ETAPES_ACCUEIL.length, 'étape', 'étapes')} · environ 10 minutes` }),
        h('h1', { class: 'bz-t-titre-2', id: 'titre-vue', tabindex: '-1', texte: 'Créer mon entreprise' }),
        h('p', { class: 'bz-t-chapeau', texte: 'Quelques questions simples : votre entreprise, vos lieux, vos services, votre équipe, vos clients et fournisseurs. Chaque réponse est enregistrée aussitôt : vous pouvez vous arrêter et reprendre plus tard, ou importer un fichier à tout moment.' })),
      h('section', { class: 'bz-carte', 'aria-labelledby': 'titre-creer' },
        h('h2', { class: 'bz-carte__titre', id: 'titre-creer', texte: 'Le nom de votre entreprise' }),
        A.erreur ? resultatAssistant('critique', A.erreur, { alerte: true }) : null,
        champ('accueil-nom', 'Nom de votre entreprise', h('input', { id: 'accueil-nom', class: 'bz-champ__saisie', type: 'text', maxlength: '120', autocomplete: 'organization', placeholder: 'ex. Menuiserie Le Goff', 'aria-describedby': 'accueil-nom-aide', value: A.creation.nom, oninput: (e) => (A.creation.nom = e.target.value) }),
          { aide: 'Les données de l’exemple seront retirées. Rien n’est envoyé à l’extérieur.' }),
        h('div', { class: 'bz-groupe-boutons' },
          boutonPrincipal('Commencer', async () => {
            if (!A.creation.nom.trim()) { A.erreur = 'Indiquez le nom de votre entreprise.'; rendreAccueil(); $('#accueil-nom')?.focus(); return; }
            A.envoi = true;
            rendreAccueil();
            try {
              await api('POST', '/monde/vider-demo', { nom: A.creation.nom.trim() });
              await api('PUT', '/organisation', { etape_accueil: 0 });
              A.erreur = null; A.etape = 0; E.vueCarte = null;
              await charger();
            } catch (e) { if (!e.session) A.erreur = e.message; }
            A.envoi = false;
            rendreAccueil();
          }, { occupe: A.envoi, enCours: 'Création…' }),
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => changerVue('carte') }, 'Continuer à explorer l’exemple')))));
    return;
  }

  const o = m.organisation;
  const plusLoin = Math.max(etapeCourante, o.etapeAccueil ?? 0);
  const suivant = async (n) => { A.erreur = null; A.etape = n; try { await sauverEtapeAccueil(n); } catch { /* sans effet */ } await charger(); annoncer(`Étape ${n + 1} sur ${ETAPES_ACCUEIL.length} · ${ETAPES_ACCUEIL[n]?.[1] ?? ''}`); $('#titre-vue')?.focus({ preventScroll: true }); };
  const nav = h('nav', { class: 'bz-etapes', 'aria-label': 'Étapes' }, h('ol', {}, ETAPES_ACCUEIL.map(([, l], i) => {
    const faite = i < (o.etapeAccueil ?? 0) && i !== etapeCourante; // vraiment enregistrée, pas seulement dépassée par un lien profond
    const contenu = [faite ? icone('check', { taille: 'sm' }) : h('span', { class: 'bz-etapes__numero', 'aria-hidden': 'true', texte: String(i + 1) }), h('span', { texte: l })];
    return h('li', { 'aria-current': i === etapeCourante ? 'step' : null, 'data-faite': faite ? '' : null },
      i !== etapeCourante && i <= plusLoin ? h('button', { type: 'button', onclick: () => { A.etape = i; A.erreur = null; rendreAccueil(); $('#titre-vue')?.focus({ preventScroll: true }); } }, contenu) : contenu);
  })));
  const objets = (famille) => m.objets.filter((x) => x.famille === famille);
  const lignes = (cle, vide) => (A.lignes[cle] ??= [structuredClone(vide), structuredClone(vide), structuredClone(vide)]);
  /** Saisie rapide : une ligne par élément, chaque champ avec son libellé ; les lignes s'empilent sur téléphone. */
  const tableSaisie = (cle, vide, colonnes) => {
    const L = lignes(cle, vide);
    return h('div', { class: 'bz-pile' },
      h('ol', { class: 'bz-saisie-rapide', role: 'list' }, L.map((ligne, n) => h('li', {},
        h('fieldset', {}, h('legend', { class: 'bz-visuellement-cache', texte: `Ligne ${n + 1}` }),
          colonnes.map((c) => {
            const id = `saisie-${cle}-${n}-${c.id}`;
            return champ(id, c.libelle, c.options
              ? liste(id, [...(c.vide === false ? [] : [['', '—']]), ...c.options], ligne[c.id] ?? '', (e) => (ligne[c.id] = e.target.value))
              : h('input', { id, class: 'bz-champ__saisie', type: c.type ?? 'text', placeholder: c.exemple ?? '', value: ligne[c.id] ?? '', autocomplete: c.autocomplete ?? 'off', inputmode: c.type === 'number' ? 'numeric' : c.type === 'email' ? 'email' : null, oninput: (e) => (ligne[c.id] = e.target.value) }));
          }))))),
      h('div', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { L.push(structuredClone(vide)); rendreAccueil(); document.getElementById(`saisie-${cle}-${L.length - 1}-${colonnes[0].id}`)?.focus(); } }, icone('plus'), 'Ajouter une ligne')));
  };
  const enregistrerLignes = async (cle, versObjet, n) => {
    const objs = (A.lignes[cle] ?? []).map(versObjet).filter(Boolean);
    if (objs.length) {
      A.envoi = true;
      rendreAccueil();
      const r = await api('POST', '/objets/lot', { objets: objs });
      A.envoi = false;
      if (r.erreurs.length) { A.erreur = `${pluriel(r.crees.length, 'ajouté', 'ajoutés')}, ${pluriel(r.erreurs.length, 'refusé', 'refusés')} : ${r.erreurs[0].message}`; await charger(); return; }
      A.lignes[cle] = null;
      informer(`${pluriel(r.crees.length, 'élément ajouté', 'éléments ajoutés')} à votre carte.`, 'ok');
    }
    await suivant(n);
  };
  const importer = (typeId, roles = []) => h('div', { class: 'bz-groupe-boutons' },
    h('span', { class: 'bz-t-petit', texte: 'Vous avez déjà une liste ?' }),
    h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => ouvrirAssistant('fichier', { type: typeId, roles }) }, icone('upload', { taille: 'sm' }), 'Importer un fichier CSV'),
    h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => modeleCsv(typeId) }, 'Télécharger le modèle'),
    h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => changerVue('reglages:outils') }, 'Connecter un logiciel (Airtable, Notion, HubSpot…)'));
  const deja = (liste) => (liste.length ? h('div', { class: 'bz-pile' }, h('p', { class: 'bz-t-label', texte: `Déjà sur votre carte : ${pluriel(liste.length, 'élément', 'éléments')}` }),
    h('ul', { class: 'bz-puces', role: 'list' }, liste.slice(0, 12).map((x) => h('li', {}, h('span', { class: 'bz-badge', texte: sansDemo(x.nom) }))), liste.length > 12 ? h('li', {}, h('span', { class: 'bz-badge', texte: `et ${liste.length - 12} de plus` })) : null)) : null);
  const boutons = (enregistrer, n, libelle = 'Enregistrer et continuer') => h('div', { class: 'bz-groupe-boutons bz-completer__pied' },
    etapeCourante > 0 ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { A.etape = etapeCourante - 1; A.erreur = null; rendreAccueil(); $('#titre-vue')?.focus({ preventScroll: true }); } }, icone('arrow-left'), 'Retour') : null,
    h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: () => suivant(n) }, 'Passer cette étape'),
    boutonPrincipal(libelle, async () => { try { await enregistrer(); } catch (e) { A.envoi = false; if (!e.session) A.erreur = e.message; rendreAccueil(); } }, { occupe: A.envoi, enCours: 'Enregistrement…' }));

  let corps;
  const etape = ETAPES_ACCUEIL[etapeCourante]?.[0];
  if (etape === 'entreprise') {
    const F = (A.entreprise ??= { nom: o.nom, secteur: o.secteur ?? '', ville: o.ville ?? '', siret: o.siret ?? '', effectif: o.effectif || '', mode: o.modeOrganisation ?? '', univers: o.univers });
    const conseil = Number(F.effectif) >= 50 ? 'par départements' : 'd’un seul tenant';
    corps = [
      h('div', { class: 'bz-grille-champs' },
        champ('accueil-entreprise', 'Nom de l’entreprise', h('input', { id: 'accueil-entreprise', class: 'bz-champ__saisie', type: 'text', maxlength: '120', autocomplete: 'organization', value: F.nom, oninput: (e) => (F.nom = e.target.value) }), { large: true }),
        champ('accueil-secteur', 'Activité', h('input', { id: 'accueil-secteur', class: 'bz-champ__saisie', type: 'text', maxlength: '120', placeholder: 'ex. menuiserie, négoce, conseil', value: F.secteur, oninput: (e) => (F.secteur = e.target.value) })),
        champ('accueil-ville', 'Ville', h('input', { id: 'accueil-ville', class: 'bz-champ__saisie', type: 'text', maxlength: '80', autocomplete: 'address-level2', value: F.ville, oninput: (e) => (F.ville = e.target.value) })),
        champ('accueil-effectif', 'Nombre de personnes', h('input', { id: 'accueil-effectif', class: 'bz-champ__saisie', type: 'number', inputmode: 'numeric', min: '1', max: '100000', value: F.effectif,
          oninput: (e) => { F.effectif = e.target.value; const c = Number(F.effectif) >= 50 ? 'par départements' : 'd’un seul tenant'; for (const b of document.querySelectorAll('[data-conseil]')) b.hidden = !F.effectif || b.dataset.conseil !== c; } })),
        champ('accueil-siret', 'SIRET (facultatif)', h('input', { id: 'accueil-siret', class: 'bz-champ__saisie bz-t-identifiant', type: 'text', inputmode: 'numeric', maxlength: '20', autocomplete: 'off', value: F.siret, oninput: (e) => (F.siret = e.target.value) })),
        champ('accueil-univers', 'Vocabulaire du métier', liste('accueil-univers', m.univers.disponibles.map((u) => [u.id, u.nom]), F.univers, (e) => (F.univers = e.target.value)), { large: true, aide: 'Il adapte les mots : chantier, dossier, affaire…' })),
      h('fieldset', { class: 'bz-pile bz-completer__choix' }, h('legend', { class: 'bz-t-label', texte: 'Comment voulez-vous voir votre entreprise ?' }),
        h('div', { class: 'bz-grille-choix' }, [['d’un seul tenant', 'D’un seul tenant', 'Petite ou moyenne entreprise : tout le monde dans un même ensemble, lieu par lieu.'], ['par départements', 'Par départements', 'Plus grande structure : chaque service a son plateau dans le bâtiment, avec son équipe, ses tâches, ses dossiers.']].map(([v, t, d]) =>
          h('label', { class: 'bz-choix' }, h('input', { type: 'radio', name: 'accueil-mode', value: v, checked: F.mode === v, onchange: () => { F.mode = v; } }),
            h('span', { class: 'bz-choix__texte' }, h('span', { class: 'bz-choix__titre' }, t, ' ', h('span', { class: 'bz-badge bz-badge--ok', 'data-conseil': v, hidden: !F.effectif || conseil !== v, texte: 'Conseillé' })), h('span', { class: 'bz-choix__detail', texte: d })))))),
      pourquoi('Le nom et la ville personnalisent votre carte. Le nombre de personnes et le mode d’organisation décident du dessin : une petite entreprise est montrée d’un seul tenant, une plus grande est organisée par services, dans un même bâtiment. Tout reste modifiable.'),
      boutons(async () => {
        if (!F.nom.trim()) throw new Error('Indiquez le nom de l’entreprise.');
        A.envoi = true;
        if (F.univers !== o.univers) await api('POST', '/univers', { id: F.univers });
        await api('PUT', '/organisation', { nom: F.nom.trim(), secteur: F.secteur, ville: F.ville, siret: F.siret, effectif: F.effectif === '' ? null : Number(F.effectif), mode_organisation: F.mode || conseil, etape_accueil: 1 });
        A.envoi = false;
        E.vueCarte = null;
        await suivant(1);
      }, 1),
    ];
  } else if (etape === 'lieux') {
    const types = m.univers.types.filter((t) => t.famille === 'lieu').map((t) => [t.id, t.libelle]);
    corps = [
      deja(objets('lieu')),
      tableSaisie('lieux', { nom: '', type: types[0]?.[0] ?? 'siege', adresse: '', besoin: '' }, [
        { id: 'nom', libelle: 'Nom du lieu', exemple: 'Siège, Quimper' }, { id: 'type', libelle: 'Type', options: types, vide: false }, { id: 'adresse', libelle: 'Adresse', exemple: '12 rue…', autocomplete: 'street-address' }, { id: 'besoin', libelle: 'Personnes nécessaires par jour', type: 'number' }]),
      importer(types[0]?.[0] ?? 'siege'),
      pourquoi('Chaque lieu devient un bâtiment ouvert sur la carte. Le nombre de personnes nécessaires par jour sert au planning : Living Business signale les trous quand il manque du monde.'),
      boutons(() => enregistrerLignes('lieux', (l) => (l.nom.trim() ? { type: l.type, nom: l.nom.trim(), champs: { ...(l.adresse ? { adresse: l.adresse } : {}), ...(l.besoin ? { besoin_effectif: Number(l.besoin) } : {}) } } : null), 2), 2),
    ];
  } else if (etape === 'departements') {
    const existants = objets('departement').map((d) => sansDemo(d.nom).toLowerCase());
    const S = (A.services ??= new Set());
    corps = [
      o.modeOrganisation !== 'par départements' ? resultatAssistant('info', 'Vous avez choisi « d’un seul tenant » : les services sont facultatifs.', { detail: 'Ajoutez-les si vous voulez quand même ranger équipe, tâches et dossiers par service.' }) : null,
      deja(objets('departement')),
      h('fieldset', { class: 'bz-pile bz-completer__choix' }, h('legend', { class: 'bz-t-label', texte: 'Services courants' }),
        h('div', { class: 'bz-grille-choix' }, SERVICES_COURANTS.filter(([n]) => !existants.includes(n.toLowerCase())).map(([n]) => h('label', { class: 'bz-choix' },
          h('input', { type: 'checkbox', checked: S.has(n), onchange: (e) => { if (e.target.checked) S.add(n); else S.delete(n); } }), h('span', { class: 'bz-choix__texte' }, h('span', { class: 'bz-choix__titre', texte: n })))))),
      champ('accueil-autres-services', 'Autres services (séparés par des virgules)', h('input', { id: 'accueil-autres-services', class: 'bz-champ__saisie', type: 'text', value: A.autresServices ?? '', placeholder: 'ex. Bureau d’études, SAV', oninput: (e) => (A.autresServices = e.target.value) })),
      pourquoi('Dans une entreprise structurée, chaque service a son plateau dans le même bâtiment : son équipe, ses tâches, son courrier, ses dossiers. Les accès peuvent ensuite être limités par service.'),
      boutons(async () => {
        const noms = [...S, ...(A.autresServices ?? '').split(',').map((x) => x.trim()).filter(Boolean)];
        const couleurs = ['bleu', 'orange', 'vert', 'violet', 'turquoise', 'jaune', 'rouge', 'ardoise'];
        A.lignes.services = noms.map((n, i) => ({ nom: n, couleur: SERVICES_COURANTS.find(([x]) => x === n)?.[1] ?? couleurs[i % couleurs.length] }));
        A.services = null;
        A.autresServices = '';
        await enregistrerLignes('services', (l) => ({ type: 'departement', nom: l.nom, champs: { couleur: l.couleur } }), 3);
      }, 3),
    ];
  } else if (etape === 'equipe') {
    const deps = objets('departement').map((d) => [d.id, sansDemo(d.nom)]);
    const lieux = objets('lieu').map((d) => [d.id, sansDemo(d.nom)]);
    corps = [
      deja(objets('personne')),
      tableSaisie('equipe', { nom: '', poste: '', departement: '', lieu: lieux[0]?.[0] ?? '', email: '' }, [
        { id: 'nom', libelle: 'Prénom et nom', exemple: 'Anne Le Bris', autocomplete: 'off' }, { id: 'poste', libelle: 'Poste', exemple: 'Technicienne' },
        ...(deps.length ? [{ id: 'departement', libelle: 'Service', options: deps }] : []), ...(lieux.length ? [{ id: 'lieu', libelle: 'Lieu', options: lieux }] : []),
        { id: 'email', libelle: 'E-mail (facultatif)', type: 'email', exemple: 'anne@…' }]),
      importer('employe'),
      pourquoi('Chaque personne apparaît à son poste sur la carte, puis là où le planning la place chaque jour. L’e-mail sert seulement à envoyer le baromètre d’équipe (anonyme).'),
      boutons(() => enregistrerLignes('equipe', (l) => (l.nom.trim() ? { type: 'employe', nom: l.nom.trim(), champs: { ...(l.poste ? { poste: l.poste } : {}), ...(l.departement ? { departement: l.departement } : {}), ...(l.lieu ? { lieu: l.lieu } : {}), ...(l.email ? { email: l.email } : {}), disponibilite: 'disponible' } } : null), 4), 4),
    ];
  } else if (etape === 'tiers') {
    const typeTiers = m.univers.types.filter((t) => t.famille === 'tiers').map((t) => [t.id, t.libelle]);
    const roles = m.univers.roles.map((r) => [r.id, r.libelle]);
    corps = [
      deja(objets('tiers')),
      tableSaisie('tiers', { nom: '', role: 'client', type: typeTiers[0]?.[0] ?? 'entreprise', ville: '', email: '' }, [
        { id: 'nom', libelle: 'Nom', exemple: 'Boulangerie Kerlann' }, { id: 'role', libelle: 'Rôle', options: roles, vide: false }, { id: 'type', libelle: 'Type', options: typeTiers, vide: false },
        { id: 'ville', libelle: 'Ville' }, { id: 'email', libelle: 'E-mail', type: 'email' }]),
      importer(typeTiers[0]?.[0] ?? 'entreprise', ['client']),
      pourquoi('Clients, fournisseurs et partenaires deviennent les bâtiments autour du vôtre : tout ce qui est dehors est extérieur à l’entreprise. Un même tiers peut être client et fournisseur. L’e-mail sert à envoyer le formulaire de satisfaction.'),
      boutons(() => enregistrerLignes('tiers', (l) => (l.nom.trim() ? { type: l.type, nom: l.nom.trim(), roles: [l.role], champs: { ...(l.ville ? { ville: l.ville } : {}), ...(l.email ? { email: l.email } : {}) } } : null), 5), 5),
    ];
  } else if (etape === 'outils') {
    corps = [
      h('p', { class: 'bz-t-chapeau', texte: 'Vos données vivent déjà dans un logiciel ? Connectez-le : les changements passent dans les deux sens, tout seuls. Ce que vous modifiez ici est modifié dans le logiciel, et inversement.' }),
      listeOutils(E.sources ?? []),
      pourquoi('Connecter un logiciel évite la double saisie : c’est le premier gain de temps. Les connexions sont chiffrées sur votre serveur et ne repartent jamais vers le navigateur.'),
      h('div', { class: 'bz-groupe-boutons bz-completer__pied' },
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { A.etape = etapeCourante - 1; rendreAccueil(); } }, icone('arrow-left'), 'Retour'),
        boutonPrincipal('Continuer', () => suivant(6))),
    ];
    if (!E.sources) api('GET', '/sources').then((s) => { E.sources = s; if (E.vue === 'accueil') rendreAccueil(); }).catch(() => {});
    if (!CONNECTER) chargerConnecter().then(() => { if (E.vue === 'accueil') rendreAccueil(); }).catch(() => {});
  } else {
    const n = (f) => objets(f).length;
    corps = [
      h('section', { class: 'bz-vide', 'aria-labelledby': 'titre-fin-accueil' },
        h('span', { class: 'bz-choix__illustration', 'aria-hidden': 'true' }, iconeEtat('ok', { taille: 'lg', decoratif: true })),
        h('h2', { class: 'bz-vide__titre', id: 'titre-fin-accueil', texte: `${sansDemo(o.nom)} est en place.` }),
        h('ul', { class: 'bz-liste-simple' }, [['lieu', 'lieu', 'lieux'], ['departement', 'service', 'services'], ['personne', 'personne', 'personnes'], ['tiers', 'client, fournisseur ou partenaire', 'clients, fournisseurs et partenaires']].map(([f, un, plusieurs]) => h('li', { texte: pluriel(n(f), un, plusieurs) }))),
        h('p', { class: 'bz-vide__texte', texte: 'Tout est enregistré. Revenez ici quand vous voulez pour compléter, ou importez un fichier à tout moment.' }),
        h('div', { class: 'bz-groupe-boutons' },
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => changerVue('optimiser') }, 'Ce que je peux automatiser'),
          boutonPrincipal('Voir ma carte', () => changerVue('carte')))),
    ];
    if ((o.etapeAccueil ?? 0) < 6) sauverEtapeAccueil(6).catch(() => {});
  }
  const p = { index: etapeCourante, total: ETAPES_ACCUEIL.length, libelle: ETAPES_ACCUEIL[etapeCourante]?.[1] ?? '' };
  remplir(page, h('div', { class: 'bz-ecran bz-completer' },
    h('header', { class: 'bz-pile' },
      h('p', { class: 'bz-t-surtitre', texte: `Compléter mon entreprise · ${sansDemo(o.nom)}` }),
      h('h1', { class: 'bz-t-titre-2', id: 'titre-vue', tabindex: '-1', texte: p.libelle })),
    h('div', { class: 'bz-assistant__progression bz-completer__progression' },
      h('progress', { class: 'bz-assistant__barre', max: String(p.total), value: String(p.index + 1), 'aria-hidden': 'true' }),
      h('span', { texte: `Étape ${p.index + 1} sur ${p.total} · ${p.libelle}` })),
    h('div', { class: 'bz-assistant__grille bz-completer__grille', 'data-etapes': '' },
      nav,
      h('div', { class: 'bz-pile bz-completer__corps' },
        A.erreur ? resultatAssistant('critique', A.erreur, { alerte: true }) : null,
        corps))));
}

// ---------------------------------------------------------------- réglages : accès, logiciels connectés, clés d'API et IA
// ---------------------------------------------------------------- Réglages en sections (§6.1 P9)
/* Liste des sections à gauche (ordinateur), liste puis page (téléphone) : Entreprise, Accès et équipe, Apparence et
   accessibilité, Clavier, Carte, Notifications, Connecteurs, Sauvegardes, Mettre en ligne, Breizhcosystem, Confidentialité,
   À propos. Les anciennes adresses (#/reglages:outils, :cles, :reseau…) ouvrent toujours la même page. */
const zoneReglages = () => $('#reglages-page');
/** Une section de page de réglages : titre h3, texte d'aide, contenu. */
const sectionReglage = (id, titre, aide, ...contenu) => h('section', { class: 'bz-reglages__bloc', 'aria-labelledby': id },
  h('h3', { class: 'bz-t-titre-4', id, texte: titre }), aide ? h('p', { class: 'bz-t-petit bz-texte-2', texte: aide }) : null, contenu);
/** Interrupteur de réglage (§4.7) : libellé, état écrit, aide reliée. */
function interrupteurReglage({ cle: k, titre, aide = null, actif, desactive = false, regler }) {
  return h('div', { class: 'bz-champ' },
    h('label', { class: 'bz-interrupteur' },
      h('input', { type: 'checkbox', role: 'switch', cle: k, checked: actif, disabled: desactive || null, 'aria-describedby': aide ? `${k}-aide` : null, onchange: (e) => regler(e.target.checked) }),
      h('span', { texte: titre }), h('span', { class: 'bz-interrupteur__etat', 'aria-hidden': 'true', texte: desactive ? 'Indisponible' : actif ? 'Activé' : 'Désactivé' })),
    aide ? h('span', { class: 'bz-champ__aide', id: `${k}-aide`, texte: aide }) : null);
}

function rendreReglages(sous = E.sousReglages) {
  const enLigne = Boolean(E.monde.enLigne);
  const tel = estTelephone();
  const page = REG.pageDemandee(sous, { enLigne }) ?? (tel ? null : 'entreprise');
  E.sousReglages = REG.pageDemandee(sous, { enLigne });
  const courant = page ? REG.sectionDe(page) : null;
  const nav = h('nav', { class: 'bz-reglages__nav', 'aria-label': 'Sections des réglages' },
    h('ul', { class: 'bz-reglages__sections', role: 'list' }, REG.sectionsVisibles({ enLigne }).map((s) => h('li', {},
      h('a', { href: `#/reglages:${s.id}`, class: 'bz-reglages__section', cle: `section-${s.id}`, 'aria-current': s.id === courant ? 'page' : null,
        onclick: (e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); changerVue(`reglages:${s.id}`); } },
      h('span', { class: 'bz-reglages__icone', 'aria-hidden': 'true' }, icone(s.icone)),
      h('span', { class: 'bz-reglages__section-texte' }, h('span', { class: 'bz-t-label', texte: s.libelle }), h('span', { class: 'bz-t-micro bz-texte-2', texte: s.description })),
      icone('chevron-right', { taille: 'sm', classe: 'bz-reglages__chevron' }))))));
  if (!page) { remplir($('#page'), h('div', { class: 'bz-ecran bz-reglages', 'data-liste': '' }, nav)); return undefined; }
  const section = REG.SECTIONS.find((s) => s.id === courant) ?? REG.SECTIONS[0];
  const pages = REG.sousPages(courant);
  remplir($('#page'), h('div', { class: 'bz-ecran bz-reglages' },
    h('div', { class: 'bz-reglages__grille' },
      tel ? null : nav,
      h('div', { class: 'bz-reglages__contenu' },
        h('div', { class: 'bz-reglages__tete' },
          tel ? h('a', { href: '#/reglages', class: 'bz-lien-fleche', onclick: (e) => { e.preventDefault(); changerVue('reglages'); } }, icone('arrow-left', { taille: 'sm' }), 'Tous les réglages') : null,
          h('h2', { class: 'bz-t-titre-3', id: 'reglages-titre', tabindex: '-1', texte: section.libelle }),
          pages.length ? h('div', { class: 'bz-segments', role: 'group', 'aria-label': `Pages de ${section.libelle}` },
            pages.map((p) => h('button', { type: 'button', cle: `page-${p.id}`, 'aria-pressed': p.id === page, onclick: () => changerVue(`reglages:${p.id}`) }, p.libelle))) : null),
        h('div', { class: 'bz-reglages__page', id: 'reglages-page', 'aria-labelledby': 'reglages-titre' })))));
  const R = {
    entreprise: rendreEntreprise, acces: rendreAcces, reseau: rendreReseau, apparence: () => remplir(zoneReglages(), blocApparence({ titre: false })),
    clavier: rendreClavier, carte: () => remplir(zoneReglages(), blocCarte()), notifications: rendreNotifications, outils: rendreOutils, cles: rendreCles,
    sauvegardes: rendreSauvegardes, 'en-ligne': rendreEnLigne, nexus: rendreReglagesNexus, confidentialite: rendreConfidentialite, 'a-propos': rendreAPropos,
  };
  return (R[page] ?? rendreEntreprise)();
}

// ----- Entreprise
let ETAT_ENTREPRISE = { erreur: null, ok: false };
function rendreEntreprise() {
  const Z = zoneReglages();
  if (!Z) return;
  const m = E.monde;
  const org = m.objets.find((o) => o.famille === 'organisation');
  const demo = Boolean(m.organisation.demo);
  const S = { ...ETAT_ENTREPRISE }; // message du dernier enregistrement, montré une fois
  ETAT_ENTREPRISE = { erreur: null, ok: false };
  const C = { nom: sansDemo(m.organisation.nom), ville: m.organisation.ville ?? '', secteur: m.organisation.secteur ?? '', siret: m.organisation.siret ?? '', effectif: org ? valeurDe(org, 'effectif') ?? '' : '', mode_organisation: m.organisation.modeOrganisation ?? '' };
  const champ = (k, libelle, attrs = {}, aide = null) => h('div', { class: 'bz-champ' },
    h('label', { class: 'bz-champ__libelle', for: `entreprise-${k}`, texte: libelle }),
    h('input', { id: `entreprise-${k}`, class: 'bz-champ__saisie', value: C[k], readonly: demo || null, 'aria-describedby': aide ? `entreprise-${k}-aide` : null, oninput: (e) => { C[k] = e.target.value; }, ...attrs }),
    aide ? h('p', { class: 'bz-champ__aide', id: `entreprise-${k}-aide`, texte: aide }) : null);
  remplir(Z,
    demo ? encadre('info', 'Vous explorez une entreprise exemple.', 'Créez votre entreprise : les données fictives seront retirées, vos réglages commencent ici.') : null,
    demo ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => changerVue('accueil') }, icone('building-2'), 'Créer mon entreprise')) : null,
    sectionReglage('entreprise-identite', 'Identité', 'Ces informations restent sur votre ordinateur ou votre serveur.',
      h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        if (demo) return;
        if (!C.nom.trim()) { ETAT_ENTREPRISE = { erreur: 'Indiquez le nom de votre entreprise.', ok: false }; rendreEntreprise(); $('#entreprise-nom')?.focus(); return; }
        e.submitter?.setAttribute('aria-busy', 'true');
        try {
          await api('PUT', '/organisation', { nom: C.nom.trim(), ville: C.ville, secteur: C.secteur, siret: C.siret.replace(/\s/g, ''), effectif: C.effectif === '' ? null : C.effectif, mode_organisation: C.mode_organisation || null });
          ETAT_ENTREPRISE = { erreur: null, ok: true };
          await charger();
        } catch (err) { ETAT_ENTREPRISE = { erreur: err.message, ok: false }; }
        if (E.vue === 'reglages' && E.sousReglages === 'entreprise') rendreEntreprise();
      } },
        messageEnLigne('critique', S.erreur),
        S.ok ? messageEnLigne('ok', 'Informations enregistrées.') : null,
        h('div', { class: 'bz-grille-champs' },
          champ('nom', 'Nom de l’entreprise', { type: 'text', maxlength: '120', autocomplete: 'organization', required: true }),
          champ('ville', 'Ville', { type: 'text', maxlength: '80', autocomplete: 'address-level2' }),
          champ('secteur', 'Secteur', { type: 'text', maxlength: '120' }),
          champ('siret', 'SIRET', { type: 'text', inputmode: 'numeric', maxlength: '17', autocomplete: 'off', class: 'bz-champ__saisie bz-t-identifiant' }, '14 chiffres. Il sert à Breizhcosystem et à la surveillance Bodacc.'),
          champ('effectif', 'Effectif', { type: 'number', min: '0', step: '1', inputmode: 'numeric' })),
        h('fieldset', { class: 'bz-champ' },
          h('legend', { class: 'bz-champ__libelle', texte: 'Organisation de la carte' }),
          h('div', { class: 'bz-grille-choix' }, [['d’un seul tenant', 'D’un seul tenant', 'La carte montre l’entreprise par lieux.'], ['par départements', 'Par départements', 'Un bâtiment par service, avec son équipe et ses tâches.']].map(([v, t, d]) =>
            h('label', { class: 'bz-choix' }, h('input', { type: 'radio', name: 'mode-organisation', value: v, checked: C.mode_organisation === v, disabled: demo || null, onchange: () => { C.mode_organisation = v; } }),
              h('span', { class: 'bz-choix__texte' }, h('span', { class: 'bz-choix__titre', texte: t }), h('span', { class: 'bz-choix__detail', texte: d })))))),
        demo ? null : h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal' }, icone('check'), 'Enregistrer')))),
    sectionReglage('entreprise-suite', 'Aller plus loin', null,
      h('ul', { class: 'bz-liste-simple', role: 'list' },
        h('li', {}, h('a', { href: '#/accueil', class: 'bz-lien-fleche', onclick: (e) => allerA('accueil', e) }, icone('list-checks', { taille: 'sm' }), 'Compléter mon entreprise pas à pas (lieux, équipe, services)')),
        m.sante ? h('li', {}, h('a', { href: '#/sante', class: 'bz-lien-fleche', onclick: (e) => allerA('sante', e) }, icone('heart-pulse', { taille: 'sm' }), 'Chiffres clés et santé de l’entreprise')) : null)));
}

// ----- Clavier
function rendreClavier() {
  const Z = zoneReglages();
  if (!Z) return;
  const T = window.bzTheme;
  const p = T?.lire() ?? {};
  const groupes = raccourcisParGroupe();
  remplir(Z,
    T ? sectionReglage('clavier-touches', 'Touches seules', 'Une seule touche (/, ?, G puis une lettre, touches de la carte) agit hors des champs de saisie. ⌘K et Échap restent toujours actifs.',
      interrupteurReglage({ cle: 'clavier-raccourcis', titre: 'Raccourcis à une touche', actif: p.raccourcis !== false, regler: (v) => { T.regler('raccourcis', v); rendreClavier(); } })) : null,
    sectionReglage('clavier-liste', 'Raccourcis', 'Les mêmes dans Living Business et Breizhcosystem.',
      h('div', { class: 'bz-raccourcis' }, [...groupes.entries()].map(([g, l]) => h('section', {}, h('h4', { class: 'bz-t-surtitre', texte: g }),
        h('dl', {}, l.map((r) => [h('dt', {}, h('kbd', { texte: r.touches })), h('dd', { texte: r.description })])))))));
}

// ----- Notifications
let ERREUR_NOTIF = null;
function rendreNotifications() {
  const Z = zoneReglages();
  if (!Z) return;
  const m = E.monde;
  const b = m.bodacc;
  const S = { erreur: ERREUR_NOTIF };
  ERREUR_NOTIF = null;
  const apres = () => { if (E.vue === 'reglages' && E.sousReglages === 'notifications') rendreNotifications(); };
  const reglerBodacc = async (actif) => {
    try { await api('PUT', '/bodacc', { actif }); informer(actif ? 'Surveillance activée : vérification chaque jour au Bodacc.' : 'Surveillance désactivée.', 'ok'); await charger(); } catch (e) { ERREUR_NOTIF = e.message; }
    apres();
  };
  const reglerSuggestion = async (montrer) => {
    try { await api('PUT', '/en-ligne/suggestion', { masquee: !montrer }); if (montrer) ecrireLocal('lb-suggestion-en-ligne', ''); await charger(); } catch (e) { ERREUR_NOTIF = e.message; }
    apres();
  };
  remplir(Z,
    messageEnLigne('critique', S.erreur),
    b ? sectionReglage('notif-bodacc', 'Clients en difficulté', `Chaque jour, Living Business vérifie au Bodacc (données publiques) si l’un de vos clients avec SIRET fait l’objet d’une procédure collective. Seuls leurs numéros SIREN sont envoyés au service public.`,
      interrupteurReglage({ cle: 'notif-bodacc-actif', titre: 'Être prévenu si un client est en difficulté', actif: Boolean(b.actif), desactive: m.organisation.demo, aide: m.organisation.demo ? 'Indisponible sur l’entreprise exemple.' : b.verifieLe ? `Dernière vérification ${dateRelative(b.verifieLe)}.` : null, regler: reglerBodacc })) : null,
    !m.enLigne ? sectionReglage('notif-suggestion', 'Suggestions', null,
      interrupteurReglage({ cle: 'notif-en-ligne', titre: 'Proposer d’utiliser Living Business partout', aide: 'Une carte dans « Aujourd’hui », une seule fois, quand l’entreprise est en place.', actif: Boolean(m.suggestionEnLigne), regler: reglerSuggestion })) : null,
    // une seule manière de régler le mode Calme (P5) : dans Apparence et accessibilité ; ici, l'état et le chemin
    sectionReglage('notif-calme', 'Quêtes et célébrations', `Mode Calme ${modeCalme() ? 'activé : XP, quêtes et célébrations masquées' : 'désactivé : XP, quêtes et célébrations affichées'}.`,
      h('div', {}, h('a', { href: '#/reglages:apparence', class: 'bz-lien-fleche bz-lien-cible', onclick: (e) => { e.preventDefault(); changerVue('reglages:apparence'); } }, 'Régler le mode Calme dans Apparence et accessibilité', icone('arrow-right', { taille: 'sm' })))),
    sectionReglage('notif-activite', 'Activité récente', 'Chaque action annulable, la file d’attente hors ligne et les envois différés sont dans Activité récente (la cloche de l’en-tête).',
      h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => ouvrirActivite() }, icone('bell'), 'Ouvrir Activité récente'))));
}

// ----- Confidentialité : ce qui sort, et vers qui (P3 : la vérité des données)
async function rendreConfidentialite() {
  const Z = zoneReglages();
  if (!Z) return;
  remplir(Z, h('p', { class: 'bz-t-petit bz-texte-2', 'aria-busy': 'true', texte: 'Lecture des réglages…' }));
  const admin = E.monde.profil.peutAdministrer;
  const [N, syn, cles, C, M] = await Promise.all([api('GET', '/nexus').catch(() => null), api('GET', '/synchro').catch(() => []), api('GET', '/cles').catch(() => []),
    admin ? api('GET', '/conservation').catch(() => null) : null, admin ? api('GET', '/mises-a-jour').catch(() => null) : null]);
  if (E.vue !== 'reglages' || E.sousReglages !== 'confidentialite' || !zoneReglages()) return;
  const m = E.monde;
  const ligne = (ic, titre, etat, texte, vers) => h('li', { class: 'bz-confidentialite__ligne' },
    h('span', { class: 'bz-cat bz-cat--carre', 'aria-hidden': 'true' }, icone(ic, { taille: 'sm' })),
    h('div', { class: 'bz-pile bz-pile--serre' },
      h('p', { class: 'bz-t-label' }, titre, ' ', etat),
      h('p', { class: 'bz-t-petit bz-texte-2', texte }),
      vers ? h('a', { href: `#/${vers}`, class: 'bz-lien bz-t-petit', onclick: (e) => allerA(vers, e), texte: 'Régler' }) : null));
  const actif = (oui, texteOui = 'Activé', texteNon = 'Désactivé') => h('span', { class: oui ? 'bz-badge bz-badge--info' : 'bz-badge' }, icone(oui ? 'arrow-up-right' : 'circle-off', { taille: 'sm' }), oui ? texteOui : texteNon);
  remplir(Z,
    encadre('ok', 'Vos données restent chez vous.', 'L’éditeur ne reçoit pas vos données. Voici, une par une, les seules sorties possibles, et leur état ; aucune ne s’ouvre sans votre accord.'),
    sectionReglage('conf-sorties', 'Ce qui peut sortir de Living Business', null,
      h('ul', { class: 'bz-liste-simple', role: 'list' },
        ligne('bz-nexus', 'Breizhcosystem', actif(Boolean(N?.relie), 'Relié', 'Pas relié'), N?.relie ? `Seulement ce que vous avez coché : ${(N.partage ?? []).length ? (N.partage ?? []).map((c) => (CATEGORIES_NEXUS.find(([id]) => id === c)?.[1] ?? c).toLowerCase()).join(', ') : 'rien pour l’instant'}. ${(N.partage ?? []).includes('indicateurs') ? 'Les notes de santé restent rattachées à votre entreprise chez Breizhcosystem (données pseudonymes, pas anonymes) ; les autres membres n’en voient que des moyennes de groupes d’au moins 10. ' : ''}« Voir exactement ce qui part » montre l’envoi mot pour mot.` : 'Rien n’est envoyé tant que vous ne reliez pas l’entreprise.', 'reglages:nexus'),
        ligne('plug', 'Logiciels connectés', actif(syn.length > 0, pluriel(syn.length, 'connecté', 'connectés'), 'Aucun'), 'Chaque logiciel échange avec votre serveur, chiffré ; seulement dans le sens que vous avez choisi.', 'reglages:outils'),
        ligne('log-in', '« Se connecter avec… » (relais de l’éditeur)', actif(syn.some((c) => c.oauth), pluriel(syn.filter((c) => c.oauth).length, 'connexion', 'connexions'), 'Non utilisé'), 'Seulement si vous cliquez « Se connecter avec… » : les jetons d’accès que l’outil remet passent par le serveur de l’éditeur (Breizhcosystem), avec votre adresse IP et l’adresse de ce Living Business, 10 minutes au plus et en mémoire, puis à chaque renouvellement. Rien n’y est enregistré, vos données n’y passent pas. Avec une clé (mode avancé), rien ne passe par l’éditeur.', 'reglages:outils'),
        ligne('key-round', 'Clés d’API (Claude, Make, Zapier, scripts)', actif(cles.length > 0, pluriel(cles.length, 'clé active', 'clés actives'), 'Aucune'), 'Une clé agit avec les droits du profil choisi, sans jamais acheter, ni créer de clé, ni changer les accès ; ce qu’elle fait est au journal. Elle se révoque à tout moment.', 'reglages:cles'),
        m.bodacc ? ligne('landmark', 'Bodacc (service public)', actif(Boolean(m.bodacc.actif)), 'Seuls les numéros SIREN de vos clients sont envoyés, pour une vérification quotidienne.', 'reglages:notifications') : null,
        ligne('navigation', 'Itinéraires « Y aller »', h('span', { class: 'bz-badge', texte: 'Au geste' }), 'Une adresse ne quitte l’appareil qu’au toucher de « Y aller », vers l’application de navigation choisie.', 'reglages:carte'),
        M ? ligne('refresh-cw', 'Vérification des mises à jour (Breizhcosystem)', actif(Boolean(M.auto), 'Chaque jour', 'À la demande'), 'Lecture de la liste publique des versions : rien n’est envoyé, Breizhcosystem voit seulement l’adresse IP.', 'reglages:a-propos') : null)),
    C ? sectionReglage('conf-conservation', 'Durées de conservation', 'Au-delà, Living Business efface tout seul, chaque jour (les sauvegardes suivent en 30 jours). Le planning compte aussi les absences. À vous de choisir, selon vos obligations : sans limite par défaut.',
      h('div', { class: 'bz-grille-champs' }, [['planning', 'Planning passé'], ['avis', 'Avis clients'], ['courrier', 'Courrier traité']].map(([k, libelle]) => h('div', { class: 'bz-champ' },
        h('label', { class: 'bz-champ__libelle', for: `conservation-${k}`, texte: libelle }),
        h('select', { id: `conservation-${k}`, class: 'bz-champ__saisie', onchange: async (e) => {
          const v = e.target.value === '' ? null : Number(e.target.value);
          const duree = e.target.selectedOptions[0]?.textContent ?? '';
          if (v !== null && !(await confirmerDialogue({ titre: `${libelle} : garder ${duree} ?`, texte: `Ce qui est plus ancien est effacé tout de suite, puis chaque jour. C’est définitif.`, confirmer: 'Appliquer', annuler: 'Annuler', danger: true }))) return rendreConfidentialite();
          try {
            const r = await api('PUT', '/conservation', { [k]: v });
            const n = (r.efface?.fiches ?? 0) + (r.efface?.cases ?? 0);
            informer(n ? `Durée enregistrée : ${pluriel(r.efface.fiches, 'fiche effacée', 'fiches effacées')}, ${pluriel(r.efface.cases, 'case de planning effacée', 'cases de planning effacées')}.` : 'Durée enregistrée.', 'ok');
          } catch (err) { if (!err.session) informer(err.message, 'erreur'); }
          rendreConfidentialite();
        } },
          [['', 'Sans limite'], ['183', '6 mois'], ['365', '1 an'], ['730', '2 ans'], ['1095', '3 ans']].map(([v, t]) => h('option', { value: v, selected: String(C[k] ?? '') === v, texte: t }))))))) : null,
    sectionReglage('conf-donnees', 'Vos données', 'Exportez une copie chiffrée de tout (données et comptes, et sur demande les accès aux logiciels connectés) quand vous voulez. Sur chaque fiche, « Données personnelles » permet de remettre ses données à une personne, ou de les effacer.',
      h('div', { class: 'bz-groupe-boutons' }, h('a', { href: '#/reglages:sauvegardes', class: 'bz-bouton bz-bouton--secondaire', onclick: (e) => allerA('reglages:sauvegardes', e) }, icone('archive'), 'Sauvegardes et export'))));
}

/**
 * Encart de l'éditeur : « Envie de structurer votre entreprise ? ». N'apparaît que si l'éditeur a rempli son numéro
 * (src/config/editeur.ts) ; discret, en bas de page, jamais au milieu d'une tâche.
 */
function encartEditeur() {
  const c = E.monde?.contactEditeur;
  if (!c?.telephone || !c.lien?.startsWith('tel:')) return null;
  return h('aside', { class: 'bz-carte bz-carte--plate bz-pile bz-pile--serre bz-encart-editeur', 'aria-labelledby': 'encart-editeur-titre' },
    h('h2', { class: 'bz-t-titre-4', id: 'encart-editeur-titre', texte: 'Envie de structurer votre entreprise ?' }),
    h('p', { class: 'bz-t-petit', texte: `L’équipe de ${MARQUE.mere} vous accompagne : organisation, outils, automatisations.` }),
    h('p', {}, h('a', { class: 'bz-bouton bz-bouton--secondaire', href: c.lien }, icone('phone'), `Appelez le ${c.telephone}`)));
}

// ----- À propos
function rendreAPropos() {
  const Z = zoneReglages();
  if (!Z) return;
  const m = E.monde;
  remplir(Z,
    h('div', { class: 'bz-a-propos' },
      h('img', { src: '/symbole-living-business.svg', alt: '', width: '56', height: '56' }),
      h('div', { class: 'bz-pile bz-pile--serre' },
        h('p', { class: 'bz-t-titre-4', texte: MARQUE.endossement(MARQUE.jeu) }),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: `Version ${m.version ?? '—'} · ${m.enregistre ? 'données enregistrées sur ce serveur' : 'démonstration en mémoire, rien n’est enregistré'}` }),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Logiciel libre sous licence GNU AGPL version 3, fourni sans garantie.' }))),
    m.profil.peutAdministrer ? h('div', { id: 'apropos-maj' }) : null,
    sectionReglage('apropos-promesse', 'Notre promesse', null,
      h('ul', { class: 'bz-liste-simple', role: 'list' },
        h('li', { class: 'bz-ligne-icone' }, icone('shield-check', { taille: 'sm' }), h('span', { texte: 'Installé chez vous : vos données restent sur votre ordinateur ou votre serveur.' })),
        h('li', { class: 'bz-ligne-icone' }, icone('eye', { taille: 'sm' }), h('span', { texte: 'On dit d’où vient chaque chiffre, et ce qu’on ne sait pas encore.' })),
        h('li', { class: 'bz-ligne-icone' }, icone('handshake', { taille: 'sm' }), h('span', { texte: 'Le réseau Breizhcosystem ne reçoit que ce que vous cochez.' })))),
    sectionReglage('apropos-liens', 'Aide et licences', null,
      h('div', { class: 'bz-groupe-boutons' },
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: ouvrirAide }, icone('circle-help'), 'Aide'),
        lienExterne('/licence.html', 'Licence de Living Business'),
        lienExterne(CODE_SOURCE, LIBELLE_CODE_SOURCE),
        lienExterne('/licences.html', 'Licences et crédits'))),
    encartEditeur());
  if (m.profil.peutAdministrer) rendreMisesAJour();
}

/** Mises à jour (administrateurs) : version installée, dernière publiée sur Breizhcosystem, quoi faire. Rien n'est envoyé. */
async function rendreMisesAJour(M = null) {
  const zone = () => document.getElementById('apropos-maj');
  if (!zone()) return;
  if (!M) {
    try { M = await api('GET', '/mises-a-jour'); } catch (e) { if (zone()) remplir(zone(), messageEnLigne('critique', e.message)); return; }
  }
  if (!zone()) return;
  const enLigne = Boolean(E.monde.enLigne);
  const comment = enLigne
    ? 'Sur le serveur : sudo living-business-mise-a-jour (la signature de l’éditeur est vérifiée avant tout). Si les mises à jour automatiques ont été activées à l’installation, c’est fait chaque nuit.'
    : 'Téléchargez la nouvelle version sur la page de téléchargement de Breizhcosystem, et nulle part ailleurs, puis remplacez l’ancien dossier de Living Business : vos données restent dans leur dossier.';
  // paquets de bureau pas encore signés par Apple ni Microsoft : la seule source sûre est la page du Breizhcosystem réglé ici
  const source = !enLigne ? h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Un fichier « nouvelle version » reçu par e-mail ou par message, ou trouvé sur un autre site, peut être piégé : ne l’ouvrez pas, même s’il semble venir de l’éditeur.' }) : null;
  const agir = async (faire) => {
    try {
      const r = await faire();
      E.monde.miseAJour = r.disponible ? { version: r.derniere, securite: r.securite } : null;
      rendreBanniere();
      await rendreMisesAJour(r);
    } catch (e) { if (!e.session) informer(e.message, 'erreur'); }
  };
  remplir(zone(), sectionReglage('apropos-maj-titre', 'Mises à jour', 'Living Business lit la liste publique des versions sur Breizhcosystem, sans rien envoyer : ni donnée, ni identifiant, ni la version installée. Breizhcosystem voit seulement l’adresse IP, comme pour toute visite.',
    M.disponible ? encadre(M.securite ? 'attention' : 'info', M.securite ? `Correctif de sécurité : la version ${M.derniere} corrige une faille. Installez-la sans attendre.` : `La version ${M.derniere} est disponible.`, comment)
      : M.verifieLe && !M.erreur ? encadre('ok', 'Living Business est à jour.') : null,
    messageEnLigne('critique', M.erreur),
    h('dl', { class: 'bz-champs-fiche' }, [['Version installée', M.actuelle || '—'], ['Dernière version publiée', M.derniere ?? 'inconnue'], ['Dernière vérification', M.verifieLe ? dateHeure(M.verifieLe) : 'jamais']]
      .map(([k, v]) => h('div', { class: 'bz-champ-fiche' }, h('dt', { class: 'bz-champ-fiche__libelle', texte: k }), h('dd', { class: 'bz-champ-fiche__valeur', texte: v })))),
    interrupteurReglage({ cle: 'maj-auto', titre: 'Vérifier chaque jour', actif: Boolean(M.auto), aide: enLigne ? 'Recommandé pour un jeu en ligne, exposé sur Internet.' : 'Sinon, vérifiez de temps en temps avec le bouton ci-dessous.', regler: (auto) => agir(() => api('PUT', '/mises-a-jour', { auto })) }),
    source,
    h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => agir(() => api('POST', '/mises-a-jour', {})) }, icone('refresh-cw'), 'Vérifier maintenant'),
      !enLigne && M.telechargement ? lienExterne(M.telechargement, 'Page de téléchargement de Breizhcosystem') : null)));
}

// ----- Accès et équipe
async function rendreAcces() {
  const Z = zoneReglages();
  if (!Z) return;
  let A;
  try { A = await api('GET', '/acces'); } catch (e) { if (zoneReglages()) remplir(zoneReglages(), blocVide({ titre: 'Les accès n’ont pas pu être chargés.', texte: e.message, role: 'alert', actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => rendreAcces() }, icone('refresh-cw'), 'Réessayer') })); return; }
  if (!zoneReglages() || E.sousReglages === 'reseau') return;
  const { profils, options } = A;
  const comptes = A.connexion === 'comptes';
  const moi = E.connexion?.compte?.profilId ?? E.monde.profil.id;
  const STATUT = { actif: ['Actif', 'ok'], invite: ['Invitation envoyée', 'info'], desactive: ['Désactivé', null] };
  const actionCompte = async (p, action) => {
    try { await api('POST', `/acces/${encodeURIComponent(p.id)}/${action}`, {}); informer(action === 'desactiver' ? 'Compte désactivé : ses sessions sont coupées.' : 'Compte réactivé.', 'ok'); rendreAcces(); } catch (e) { informer(e.message, 'erreur'); }
  };
  const nomsDe = (ids, liste) => (ids === 'tous' ? 'Tous' : ids.length ? ids.map((i) => sansDemo(liste.find((x) => x.id === i)?.nom ?? liste.find((x) => x.id === i)?.libelle ?? i)).join(', ') : 'Aucun');
  const pct = (a) => (a && a.total ? `${Math.round((100 * a.visibles) / a.total)} %` : '—');
  const FAM = [['personne', 'Employés'], ['tiers', 'Clients et fournisseurs'], ['commande', 'Commandes et factures'], ['ressource', 'Stock et matériel'], ['evenement', 'Courrier et documents'], ['departement', 'Départements']];
  const DROITS = [['peutPreparer', 'Préparer'], ['peutApprouver', 'Approuver'], ['voitScore', 'Voir le score'], ['peutAdministrer', 'Administrer'], ['voitMotifsAbsence', 'Voir les motifs d’absence']];
  remplir(Z,
    h('div', { class: 'bz-liste__tete' },
      h('p', { class: 'bz-t-petit bz-texte-2 bz-reglages__intro', texte: comptes
        ? 'Une ligne par personne. Vous l’invitez par un lien personnel (elle choisit son mot de passe, vous ne le connaissez jamais) et vous réglez ce qu’elle voit. Les droits sont vérifiés à chaque requête.'
        : 'Chacun ne voit que son périmètre : lieux, départements, types d’informations et rôles des tiers. Les droits sont vérifiés côté serveur à chaque requête.' }),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => editerAcces(null, options) }, icone('user-plus'), comptes ? 'Ajouter une personne' : 'Ajouter un accès')),
    h('ul', { class: 'bz-liste-simple bz-acces', role: 'list' }, profils.map((p) => h('li', {}, h('article', { class: 'bz-carte bz-acces__personne', 'aria-labelledby': `acces-${idDom(p.id)}` },
      h('div', { class: 'bz-carte__tete' },
        h('span', { class: 'bz-avatar', 'aria-hidden': 'true', texte: initiale(p.nom) }),
        h('div', { class: 'bz-pile bz-pile--serre bz-acces__identite' },
          h('h4', { class: 'bz-carte__titre', id: `acces-${idDom(p.id)}` }, sansDemo(p.nom), p.id === moi ? h('span', { class: 'bz-badge', texte: 'Vous' }) : null),
          h('p', { class: 'bz-t-petit bz-texte-2', texte: { dirigeant: 'Dirigeant', responsable: 'Responsable', collaborateur: 'Collaborateur' }[p.role] ?? p.role })),
        comptes ? (p.connexion ? h('span', { class: `bz-badge${STATUT[p.connexion.statut]?.[1] ? ` bz-badge--${STATUT[p.connexion.statut][1]}` : ''}` }, STATUT[p.connexion.statut]?.[0] ?? p.connexion.statut) : h('span', { class: 'bz-badge', texte: 'Pas d’accès' })) : null),
      comptes && p.connexion ? h('p', { class: 'bz-t-petit bz-texte-2' }, h('span', { class: 'bz-t-identifiant', 'data-brut': '', texte: p.connexion.identifiant }),
        p.connexion.deuxEtapes ? h('span', { class: 'bz-badge bz-badge--ok' }, icone('shield-check', { taille: 'sm' }), 'Deux étapes') : null,
        p.connexion.derniereConnexion ? ` · vu ${dateRelative(p.connexion.derniereConnexion)}` : p.connexion.invitationExpire ? ` · lien valable jusqu’au ${date(p.connexion.invitationExpire)}` : '') : null,
      h('dl', { class: 'bz-champs-fiche bz-acces__perimetre' },
        [['Lieux', nomsDe(p.lieux, options.lieux)], options.departements.length ? ['Départements', nomsDe(p.departements, options.departements)] : null, ['Tiers', nomsDe(p.rolesTiers, options.roles)], ['Informations', p.types === 'tous' ? 'Toutes' : pluriel(p.types.length, 'type', 'types')],
          ['Peut', DROITS.filter(([k]) => p[k]).map(([, l]) => l).join(', ') || 'Consulter']].filter(Boolean).map(([k, v]) => h('div', { class: 'bz-champ-fiche' }, h('dt', { class: 'bz-champ-fiche__libelle', texte: k }), h('dd', { class: 'bz-champ-fiche__valeur', texte: v })))),
      FAM.some(([f]) => p.apercu[f]) ? h('details', { class: 'bz-repli' }, h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Ce que cette personne voit' }), icone('chevron-down', { taille: 'sm' })),
        h('div', { class: 'bz-repli__corps' }, h('dl', { class: 'bz-champs-fiche' }, FAM.filter(([f]) => p.apercu[f]).map(([f, l]) => h('div', { class: 'bz-champ-fiche' }, h('dt', { class: 'bz-champ-fiche__libelle', texte: l }), h('dd', { class: 'bz-champ-fiche__valeur bz-t-chiffre', texte: pct(p.apercu[f]) })))))) : null,
      h('div', { class: 'bz-groupe-boutons' },
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => editerAcces(p, options) }, icone('pencil', { taille: 'sm' }), 'Droits'),
        comptes && p.id !== moi ? h('button', { type: 'button', class: `bz-bouton ${p.connexion ? 'bz-bouton--secondaire' : 'bz-bouton--principal'} bz-bouton--sm`, onclick: () => inviterPersonne(p) }, icone('send', { taille: 'sm' }), !p.connexion ? 'Inviter' : p.connexion.statut === 'actif' ? 'Nouveau lien' : 'Renvoyer un lien') : null,
        comptes && p.id !== moi && p.connexion?.statut === 'actif' ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => actionCompte(p, 'desactiver') }, icone('lock', { taille: 'sm' }), 'Désactiver') : null,
        comptes && p.connexion?.statut === 'desactive' ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => actionCompte(p, 'reactiver') }, icone('lock-open', { taille: 'sm' }), 'Réactiver') : null,
        p.id !== moi ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => voirComme(p.id) }, icone('eye', { taille: 'sm' }), 'Voir comme') : null))))));
}

function editerAcces(p, options) {
  const S = p ? structuredClone(p) : { nom: '', role: 'collaborateur', lieux: [], departements: [], types: [], rolesTiers: [], peutPreparer: false, peutApprouver: false, voitScore: false, peutAdministrer: false, voitMotifsAbsence: false };
  const E2 = { erreur: null, envoi: false };
  const famillesTypes = [...new Set(options.types.map((t) => t.famille))];
  const LIB_FAM = { organisation: 'Entreprise', departement: 'Départements', personne: 'Employés', tiers: 'Clients, fournisseurs…', lieu: 'Lieux', projet: 'Projets', ressource: 'Stock et matériel', commande: 'Commandes et factures', tache: 'Tâches', evenement: 'Courrier et documents', indicateur: 'Indicateurs' };
  const caseAcces = (libelle, coche, changer, fort = false) => h('label', { class: 'bz-case' }, h('input', { type: 'checkbox', checked: coche, onchange: (e) => changer(e.target.checked) }), fort ? h('strong', { texte: libelle }) : libelle);
  const choix = (k, liste, libelle) => h('fieldset', { class: 'bz-champ bz-champ--large' },
    h('legend', { class: 'bz-champ__libelle', texte: libelle }),
    caseAcces('Tout', S[k] === 'tous', (v) => { S[k] = v ? 'tous' : []; D.rendre(); }, true),
    S[k] !== 'tous' ? h('div', { class: 'bz-cases' }, liste.map((x) => caseAcces(sansDemo(x.nom ?? x.libelle), S[k].includes(x.id), (v) => { S[k] = v ? [...S[k], x.id] : S[k].filter((y) => y !== x.id); }))) : null);
  const D = dialogueVivant({
    titre: p ? sansDemo(S.nom) : 'Nouvel accès', surtitre: p ? 'Modifier l’accès' : 'Ajouter une personne', taille: 'lg',
    onsubmit: async () => {
      if (!S.nom.trim()) { E2.erreur = 'Indiquez un nom.'; D.rendre(); $('#acces-nom')?.focus(); return; }
      const corps = { nom: S.nom, role: S.role, lieux: S.lieux, departements: S.departements, types: S.types, rolesTiers: S.rolesTiers, peutPreparer: S.peutPreparer, peutApprouver: S.peutApprouver, voitScore: S.voitScore, peutAdministrer: S.peutAdministrer, voitMotifsAbsence: S.voitMotifsAbsence === true };
      E2.envoi = true; D.rendre();
      try {
        const r = p ? await api('PUT', `/acces/${encodeURIComponent(p.id)}`, corps) : await api('POST', '/acces', corps);
        D.fermer();
        informer('Accès enregistré : il s’applique immédiatement.', 'ok');
        await charger();
        if (E.vue === 'reglages') rendreReglages('acces');
        if (!p && E.connexion?.connexion === 'comptes') inviterPersonne(r);
      } catch (err) { E2.erreur = err.message; E2.envoi = false; D.rendre(); }
    },
    contenu: () => ({
      corps: [
        messageEnLigne('critique', E2.erreur),
        h('div', { class: 'bz-grille-champs' },
          h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'acces-nom', texte: 'Nom' }),
            h('input', { id: 'acces-nom', class: 'bz-champ__saisie', type: 'text', required: true, maxlength: '80', autocomplete: 'off', value: S.nom, 'aria-invalid': E2.erreur && !S.nom.trim() ? 'true' : null, oninput: (e) => (S.nom = e.target.value) })),
          h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'acces-role', texte: 'Rôle' }),
            h('div', { class: 'bz-select' }, h('select', { id: 'acces-role', class: 'bz-champ__saisie', onchange: (e) => (S.role = e.target.value) }, [['dirigeant', 'Dirigeant'], ['responsable', 'Responsable'], ['collaborateur', 'Collaborateur']].map(([k, l]) => h('option', { value: k, selected: S.role === k, texte: l }))), icone('chevron-down', { taille: 'sm' })))),
        choix('lieux', options.lieux, 'Lieux visibles'),
        options.departements.length ? choix('departements', options.departements, 'Départements visibles') : null,
        choix('rolesTiers', options.roles, 'Tiers visibles (par rôle)'),
        h('fieldset', { class: 'bz-champ bz-champ--large' }, h('legend', { class: 'bz-champ__libelle', texte: 'Informations visibles' }),
          caseAcces('Toutes', S.types === 'tous', (v) => { S.types = v ? 'tous' : []; D.rendre(); }, true),
          S.types !== 'tous' ? famillesTypes.map((f) => h('div', { class: 'bz-pile bz-pile--serre' }, h('p', { class: 'bz-t-surtitre bz-texte-2', texte: LIB_FAM[f] ?? f }),
            h('div', { class: 'bz-cases' }, options.types.filter((t) => t.famille === f).map((t) => caseAcces(t.libelle, S.types.includes(t.id), (v) => { S.types = v ? [...S.types, t.id] : S.types.filter((y) => y !== t.id); }))))) : null),
        h('fieldset', { class: 'bz-champ bz-champ--large' }, h('legend', { class: 'bz-champ__libelle', texte: 'Droits' }),
          h('div', { class: 'bz-cases' }, [['peutPreparer', 'Préparer des actions'], ['peutApprouver', 'Approuver et exécuter'], ['voitScore', 'Voir le score de santé'], ['peutAdministrer', 'Administrer (données, accès)'], ['voitMotifsAbsence', 'Voir et saisir les motifs d’absence (RH)']].map(([k, l]) => caseAcces(l, S[k], (v) => (S[k] = v)))),
          h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Sans ce droit, une absence s’affiche « Absence », sans motif : un arrêt maladie est une donnée de santé, que seules les personnes chargées des RH ont à connaître.' })),
        p ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--critique', onclick: async () => {
          if (!(await confirmerDialogue({ titre: `Retirer l’accès de ${sansDemo(p.nom)} ?`, texte: 'Sa session est coupée tout de suite. Ses actions passées restent dans le journal.', confirmer: 'Retirer l’accès', annuler: 'Garder', danger: true }))) return;
          try { await api('DELETE', `/acces/${encodeURIComponent(p.id)}`); D.fermer(); informer('Accès retiré : la session de ce profil est coupée.', 'ok'); rendreReglages('acces'); } catch (err) { E2.erreur = err.message; D.rendre(); }
        } }, icone('trash-2'), 'Retirer cet accès')) : null,
      ],
      pied: [h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler'), h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': E2.envoi ? 'true' : null }, icone('check'), 'Enregistrer')],
    }),
  });
}

function inviterPersonne(p) {
  const S = { identifiant: p.connexion?.identifiant ?? '', resultat: null, erreur: null, envoi: false };
  const D = dialogueVivant({
    titre: sansDemo(p.nom), surtitre: p.connexion ? 'Nouveau lien' : 'Inviter', taille: 'md',
    onsubmit: async () => {
      if (S.resultat) { D.fermer(); return; }
      if (!S.identifiant.trim()) { S.erreur = 'Indiquez son identifiant de connexion.'; D.rendre(); $('#invitation-identifiant')?.focus(); return; }
      S.envoi = true; D.rendre();
      try { S.resultat = await api('POST', `/acces/${encodeURIComponent(p.id)}/invitation`, { identifiant: S.identifiant }); S.erreur = null; if (E.vue === 'reglages') rendreReglages('acces'); } catch (err) { S.erreur = err.message; }
      S.envoi = false; D.rendre();
    },
    contenu: () => ({
      corps: !S.resultat ? [
        messageEnLigne('critique', S.erreur),
        h('p', { class: 'bz-t-petit', texte: p.connexion?.statut === 'actif'
          ? 'Un nouveau lien permet à cette personne de choisir un nouveau mot de passe (oubli, téléphone perdu : sa validation en deux étapes repart de zéro). Son mot de passe actuel reste valable tant que le lien n’est pas utilisé.'
          : 'Un lien personnel, valable 7 jours et utilisable une fois. La personne y choisit son mot de passe : vous ne le connaîtrez jamais.' }),
        champEntree({ id: 'invitation-identifiant', libelle: 'Identifiant de connexion', aide: 'Son e-mail ou son prénom. Avec un e-mail, le message est prérempli à son adresse.', valeur: S.identifiant, maxlength: '120', autocomplete: 'off', placeholder: 'son e-mail ou son prénom', oninput: (v) => (S.identifiant = v) }),
      ] : [
        encadre('ok', `Lien créé pour ${S.resultat.identifiant}, valable jusqu’au ${date(S.resultat.expire)}.`),
        /\/\/(127\.0\.0\.1|localhost)[:/]/.test(S.resultat.lien) ? h('div', { class: 'bz-resultat', 'data-ton': 'attention' }, iconeEtat('attention', { decoratif: true }),
          h('div', {}, h('p', { texte: 'Ce lien ne s’ouvre que sur cet ordinateur : le réseau du bureau est fermé.' }),
            h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => { D.fermer(); changerVue('reglages:reseau'); } }, 'Ouvrir à mon équipe, puis créer un nouveau lien'))) : null,
        blocCode(S.resultat.lien, 'Copier le lien'),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Le lien n’est plus affiché après fermeture.' }),
      ],
      pied: S.resultat
        ? [h('a', { class: 'bz-bouton bz-bouton--secondaire', href: S.resultat.mailto }, icone('mail'), 'Préparer l’e-mail'), h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal' }, 'Terminé')]
        : [h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler'), h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, icone('link'), 'Créer le lien')],
    }),
  });
}

// ----- Connecteurs › Clés d'API, Claude et MCP (mode avancé)
async function rendreCles() {
  const Z = zoneReglages();
  if (!Z) return;
  let cles;
  let profils;
  try { [cles, { profils }] = await Promise.all([api('GET', '/cles'), api('GET', '/acces')]); } catch (e) { if (zoneReglages()) remplir(zoneReglages(), blocVide({ titre: 'Les clés n’ont pas pu être chargées.', texte: e.message, role: 'alert', actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => rendreCles() }, icone('refresh-cw'), 'Réessayer') })); return; }
  if (!zoneReglages()) return;
  // moindre privilège : jamais le profil administrateur par défaut ; un profil limité s'il existe, sinon à choisir
  const N = (E.nouvelleCle ??= { nom: 'Claude', profilId: REG.profilConseillePourCle(profils) ?? '', jeton: null, erreur: null });
  const aideProfil = (id) => (profils.find((p) => p.id === id)?.peutAdministrer
    ? 'Profil administrateur : la clé lit tout (planning et motifs d’absence compris). Pour un assistant d’IA, préférez un accès limité (Accès et équipe).'
    : 'La clé voit et prépare exactement ce que ce profil voit. Donnez-lui un accès limité au strict nécessaire (Accès et équipe).');
  const url = `${location.origin}/mcp`;
  const jeton = N.jeton ?? 'lb_VOTRE_CLE';
  const configDesktop = JSON.stringify({ mcpServers: { 'living-business': { command: 'node', args: ['/chemin/vers/Living Business/app/src/mcp/pont-stdio.ts'], env: { LB_URL: location.origin, LB_CLE: jeton } } } }, null, 2);
  remplir(zoneReglages(),
    h('p', { class: 'bz-t-petit bz-texte-2 bz-reglages__intro', texte: 'Mode avancé, pour votre informaticien. Une clé permet à Claude (ou à un autre assistant), à Make, Zapier, n8n ou à un script de lire et d’agir sur votre entreprise, avec les droits du profil choisi. Elle n’est montrée qu’une fois ; vous la révoquez à tout moment.' }),
    encadre('info', 'Ce qu’une clé ne fait jamais, même avec un profil administrateur.', 'Les décisions restent à une personne, depuis cet écran : achats et commandes Breizhcosystem (mandat, agent, validation, paiement, contact, réponse), liaison et partage Breizhcosystem, clés et accès, automatisations, exports et restaurations, et l’approbation de ce que la clé prépare. Ce qu’une clé fait est écrit au journal avec son nom.'),
    sectionReglage('cles-nouvelle', 'Nouvelle clé', null,
      h('form', { class: 'bz-formulaire', onsubmit: async (e) => {
        e.preventDefault();
        if (!N.profilId) { N.erreur = 'Choisissez avec quels droits la clé agit.'; rendreCles(); return; }
        try { const r = await api('POST', '/cles', { nom: N.nom, profilId: N.profilId }); N.jeton = r.jeton; N.erreur = null; } catch (err) { N.erreur = err.message; }
        rendreCles();
      } },
        messageEnLigne('critique', N.erreur),
        h('div', { class: 'bz-grille-champs' },
          h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'cle-nom', texte: 'Nom' }), h('input', { id: 'cle-nom', class: 'bz-champ__saisie', type: 'text', maxlength: '80', autocomplete: 'off', value: N.nom, oninput: (e) => (N.nom = e.target.value) })),
          h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'cle-profil', texte: 'Agit avec les droits de' }),
            h('div', { class: 'bz-select' }, h('select', { id: 'cle-profil', class: 'bz-champ__saisie', required: true, 'aria-describedby': 'cle-profil-aide', onchange: (e) => {
              // aide mise à jour sur place : le focus reste sur la liste (pas de nouveau rendu de la page)
              N.profilId = e.target.value;
              const aide = $('#cle-profil-aide');
              if (aide) aide.textContent = typo(aideProfil(N.profilId));
            } },
              N.profilId ? null : h('option', { value: '', selected: true, texte: 'Choisir…' }),
              profils.map((p) => h('option', { value: p.id, selected: p.id === N.profilId, texte: `${sansDemo(p.nom)}${p.peutAdministrer ? ' (administrateur)' : ''}` }))), icone('chevron-down', { taille: 'sm' })),
            h('p', { class: 'bz-champ__aide', id: 'cle-profil-aide', texte: aideProfil(N.profilId) }))),
        h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal' }, icone('key-round'), 'Créer la clé')),
        N.jeton ? [encadre('attention', 'Copiez cette clé maintenant : elle ne sera plus affichée.'), blocCode(N.jeton, 'Copier la clé')] : null)),
    sectionReglage('cles-claude', 'Brancher Claude', 'Outils proposés à l’IA : résumé du jour, recherche, fiche, planning, courrier, satisfaction, optimisations. Elle prépare les modifications de fiche, les tâches et les mouvements de stock : une personne les approuve dans Aujourd’hui ou la fiche, jamais la clé. Elle peut aussi créer une fiche, affecter le planning, marquer un courrier et créer un lien de formulaire. La même clé ouvre l’API (/api/v1) avec les mêmes droits. Chaque action est au journal, avec le nom de la clé.',
      h('p', { class: 'bz-t-label', texte: 'Claude Code (une commande)' }),
      blocCode(`claude mcp add --transport http living-business ${url} --header "Authorization: Bearer ${jeton}"`, 'Copier la commande'),
      h('p', { class: 'bz-t-label', texte: 'Claude Desktop (claude_desktop_config.json)' }),
      blocCode(configDesktop, 'Copier la configuration'),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Remplacez « /chemin/vers/Living Business » par le dossier de Living Business sur cet ordinateur (celui qui contient LISEZMOI.txt). Sans Node.js installé, remplacez aussi « node » par ce dossier suivi de /app/node (\\app\\node.exe sous Windows).' })),
    sectionReglage('cles-api', 'API pour Make, Zapier, n8n et les scripts', null, blocCode(`curl ${location.origin}/api/v1/monde -H "Authorization: Bearer ${jeton}"`, 'Copier')),
    sectionReglage('cles-actives', `Clés actives · ${cles.length}`, null,
      cles.length ? h('div', { class: 'bz-tableau-cadre' }, h('table', { class: 'bz-tableau bz-tableau--empile' },
        h('thead', {}, h('tr', {}, ['Nom', 'Droits de', 'Créée', 'Dernière utilisation', 'Action'].map((t) => h('th', { scope: 'col', texte: t })))),
        h('tbody', {}, cles.map((c) => h('tr', {},
          h('th', { scope: 'row' }, h('span', { texte: c.nom }), h('span', { class: 'bz-t-code bz-texte-2', 'data-brut': '', texte: ` ${c.prefixe}…` })),
          h('td', { 'data-colonne': 'Droits de', texte: sansDemo(c.profil) }), h('td', { 'data-colonne': 'Créée', texte: dateRelative(c.creeLe) }),
          h('td', { 'data-colonne': 'Dernière utilisation', texte: c.derniereUtilisation ? dateRelative(c.derniereUtilisation) : 'Jamais' }),
          h('td', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--critique bz-bouton--sm', onclick: async () => {
            if (!(await confirmerDialogue({ titre: `Révoquer la clé « ${c.nom} » ?`, texte: 'Ce qui l’utilise (Claude, Make, un script) ne pourra plus rien lire ni faire. C’est définitif : il faudra une nouvelle clé.', confirmer: 'Révoquer la clé', annuler: 'Garder', danger: true }))) return;
            try { await api('DELETE', `/cles/${encodeURIComponent(c.id)}`); informer('Clé révoquée : elle ne fonctionne plus.', 'ok'); } catch (err) { informer(err.message, 'erreur'); }
            rendreCles();
          } }, icone('trash-2', { taille: 'sm' }), 'Révoquer'))))))) : blocVide({ titre: 'Aucune clé.', compact: true })));
}

// ----- Accès et équipe › Réseau du bureau
async function rendreReseau() {
  const Z = zoneReglages();
  if (!Z) return;
  let R;
  try { R = await api('GET', '/reseau'); } catch (e) { if (zoneReglages()) remplir(zoneReglages(), blocVide({ titre: 'Le réseau n’a pas pu être lu.', texte: e.message, role: 'alert' })); return; }
  let erreur = null;
  let envoi = false;
  const regler = async (corps) => {
    envoi = true;
    rendre();
    try { R = await api('PUT', '/reseau', corps); erreur = R.erreur; } catch (err) { erreur = err.message; }
    envoi = false;
    rendre();
  };
  const rendre = () => { if (!zoneReglages()) return; remplir(zoneReglages(),
    R.enLigne ? [
      encadre('ok', `Votre Living Business est en ligne${R.origine ? ` à ${R.origine}` : ''}.`, 'Votre équipe s’y connecte de partout (bureau, téléphone, chantier), chacun avec son propre accès.'),
      h('ul', { class: 'bz-liste-simple bz-t-petit', role: 'list' },
        h('li', { class: 'bz-ligne-icone' }, icone('users', { taille: 'sm' }), h('span', { texte: 'Invitez vos collègues dans « Personnes et droits » : le lien d’invitation utilise l’adresse du site.' })),
        h('li', { class: 'bz-ligne-icone' }, icone('shield-check', { taille: 'sm' }), h('span', { texte: 'HTTPS automatique, sauvegarde chaque jour sur votre serveur. Mise à jour : relancez la commande d’installation.' })),
        h('li', { class: 'bz-ligne-icone' }, icone('key-round', { taille: 'sm' }), h('span', { texte: 'Validation en deux étapes obligatoire pour les administrateurs, recommandée pour tous (Mon compte).' }))),
    ] : h('p', { class: 'bz-t-petit bz-texte-2 bz-reglages__intro', texte: 'Living Business tourne sur un seul ordinateur de l’entreprise. Ouvrez-le à votre équipe : vos collègues s’y connectent depuis leur poste, sur le réseau du bureau, avec leur propre accès. Rien ne passe par Internet ni par l’éditeur.' }),
    R.enLigne ? null : !R.disponible ? encadre('info', 'Indisponible en démonstration (données en mémoire).') : [
      !R.surPlace ? encadre('info', 'Ces réglages se font sur l’ordinateur qui fait tourner Living Business.') : null,
      messageEnLigne('critique', erreur),
      sectionReglage('reseau-equipe', 'Réseau du bureau', null,
        interrupteurReglage({ cle: 'reseau-ouvrir', titre: 'Ouvrir à mon équipe', actif: R.equipe, desactive: !R.surPlace || envoi, aide: R.equipe ? 'Ouvert : vos collègues du même réseau peuvent se connecter.' : 'Fermé : seul cet ordinateur peut ouvrir Living Business.', regler: (v) => regler({ equipe: v }) }),
        R.equipe ? h('div', { class: 'bz-pile' },
          h('p', { class: 'bz-t-surtitre', texte: 'Adresse à donner à vos collègues' }),
          R.adresses.length ? [h('p', { class: 'bz-grande-adresse bz-t-identifiant', 'data-brut': '', texte: R.adresses[0] }),
            h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => copier(R.adresses[0], 'Adresse copiée') }, icone('copy'), 'Copier l’adresse'),
              R.nomMachine ? h('span', { class: 'bz-t-petit bz-texte-2', texte: `ou http://${R.nomMachine}:${R.port}` }) : null)]
            : encadre('attention', 'Aucun réseau détecté : branchez cet ordinateur au Wi-Fi ou au câble du bureau.'),
          h('ul', { class: 'bz-liste-simple bz-t-petit', role: 'list' },
            h('li', { class: 'bz-ligne-icone' }, icone('shield', { taille: 'sm' }), h('span', { texte: 'Si l’ordinateur demande d’autoriser les connexions entrantes (pare-feu) : acceptez, sur le réseau privé uniquement.' })),
            h('li', { class: 'bz-ligne-icone' }, icone('laptop', { taille: 'sm' }), h('span', { texte: `Laissez cet ordinateur allumé pendant les heures de travail. ${R.veilleEmpechee ? 'Sa mise en veille est empêchée tant que le réseau est ouvert.' : 'Désactivez sa mise en veille automatique.'}` })),
            h('li', { class: 'bz-ligne-icone' }, icone('wifi-off', { taille: 'sm' }), h('span', { texte: 'N’ouvrez pas sur un Wi-Fi public (café, coworking) : sur le réseau du bureau, la connexion n’est pas chiffrée (http).' })))) : null),
      sectionReglage('reseau-demarrage', 'Démarrage', null,
        interrupteurReglage({ cle: 'reseau-demarrage-actif', titre: 'Lancer au démarrage de l’ordinateur', actif: R.demarrage.actif, desactive: !R.surPlace || envoi || !R.demarrage.possible,
          aide: R.demarrage.possible ? (R.demarrage.actif ? 'Living Business démarre tout seul à l’ouverture de session, sans ouvrir le navigateur.' : 'À activer si cet ordinateur sert de « serveur » à l’équipe.') : 'Non disponible sur ce système.', regler: (v) => regler({ demarrage: v }) })),
    ]); };
  rendre();
}

// ----- Mettre en ligne : assistant illustré (ordinateur → téléphone), vérification automatique
const domaineValide = (d) => REG.domaine(d) !== null;

/** Schéma illustré « ordinateur → téléphone » (SVG fait main, couleurs des jetons par classes). */
function schemaEnLigne(facon) {
  const s = svg('svg', { class: 'bz-schema-en-ligne', viewBox: '0 0 320 96', role: 'img', 'aria-label': facon === 'tailscale' ? 'Votre ordinateur, relié à votre téléphone par le réseau privé Tailscale.' : 'Votre serveur à votre nom, joint par votre téléphone en https.' });
  s.append(svg('rect', { class: 'bz-schema__appareil', x: 8, y: 20, width: 104, height: 64, rx: 8 }));
  s.append(svg('rect', { class: 'bz-schema__ecran', x: 16, y: 28, width: 88, height: 44, rx: 4 }));
  s.append(svg('path', { class: 'bz-schema__lien', d: 'M 124 52 C 160 28, 196 28, 232 52' }));
  s.append(svg('circle', { class: 'bz-schema__point', cx: 178, cy: 34, r: 6 }));
  s.append(svg('rect', { class: 'bz-schema__appareil', x: 244, y: 12, width: 56, height: 80, rx: 10 }));
  s.append(svg('rect', { class: 'bz-schema__ecran', x: 251, y: 22, width: 42, height: 58, rx: 4 }));
  return s;
}

async function rendreEnLigne() {
  const Z = zoneReglages();
  if (!Z) return;
  let I;
  try { I = await api('GET', '/en-ligne'); } catch (e) { if (zoneReglages()) remplir(zoneReglages(), blocVide({ titre: 'Cette page n’a pas pu être chargée.', texte: e.message, role: 'alert' })); return; }
  if (I.enLigne) return rendreReglages('reseau');
  const D = (E.miseEnLigne ??= { facon: 'claude', etape: 'facon', domaine: '', verif: null, suivi: null });
  const X = { phrase: '', confirmation: '', erreur: null, fait: false, envoi: false };
  // adresse réduite à son origine https : rien d'autre ne peut finir dans la commande lancée en root
  const nexus = REG.origineNexus(I.nexus);
  const entreprise = sansDemo(I.entreprise ?? E.monde.organisation.nom);
  const domaine = () => REG.domaine(D.domaine) ?? 'jeu.mondomaine.fr';
  // clé publique de l'éditeur connue du jeu : la signature du script est vérifiée AVANT de le lancer en root
  const signataires = Array.isArray(I.signataires) ? I.signataires.filter((l) => typeof l === 'string' && /^editeur-living-business [^']+$/.test(l)) : [];
  const commande = () => REG.commandeInstallation({ nexus, domaine: domaine(), signataires });
  const signatureInconnue = () => (signataires.length ? null : encadre('info', 'Ce Living Business ne connaît pas encore la clé de signature de l’éditeur.', 'La commande lance le script sans vérifier sa signature au préalable. Ensuite, chaque mise à jour est vérifiée par le serveur avec la clé enregistrée à l’installation.'));
  const adresseTailscale = `http://${I.nomMachine ?? 'nom-de-cet-ordinateur'}:${I.port}`;
  const vivants = [];
  const blocVivant = (f, libelle) => {
    const pre = h('pre', { texte: f() });
    vivants.push(() => { pre.textContent = f(); });
    return h('div', { class: 'bz-code' }, pre, h('button', { class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', type: 'button', onclick: () => copier(f(), 'Copié') }, icone('copy', { taille: 'sm' }), libelle));
  };
  const champDomaine = () => champEntree({ id: 'en-ligne-domaine', libelle: 'Adresse de Living Business (votre nom de domaine)', aide: 'Par exemple jeu.menuiserie-kerlann.fr : le sous-domaine « jeu » de votre nom de domaine.', valeur: D.domaine, inputmode: 'url', autocomplete: 'off', spellcheck: 'false', maxlength: '253', placeholder: 'jeu.mondomaine.fr', oninput: (v) => { D.domaine = v; for (const f of vivants) f(); } });
  const sansNexus = () => (nexus ? null : encadre('info', 'Living Business ne connaît pas encore l’adresse de Breizhcosystem (Réglages › Breizhcosystem).', 'Remplacez « https://ADRESSE-DU-RESEAU » par l’adresse de téléchargement de Living Business. Le script installer-jeu.sh est aussi dans le paquet téléchargé : copiez-le sur le serveur et lancez « sudo bash installer-jeu.sh votre.domaine.fr ».'));
  const exporter = () => sectionReglage('en-ligne-export', 'Emporter mes données sur le serveur', 'Exportez une copie chiffrée, puis, sur la page du lien d’installation, choisissez « Restaurer la sauvegarde exportée ». Sans la phrase, le fichier est illisible. Pour garder les logiciels connectés, cochez « Inclure les accès ».',
    messageEnLigne('critique', X.erreur),
    X.fait ? messageEnLigne('ok', 'Copie téléchargée. Gardez la phrase : elle sera demandée sur le serveur.') : null,
    formulaireExport(X, `living-business-pour-serveur-${new Date().toISOString().slice(0, 10)}.lbsauv`, rendre, { principal: false }));
  const pourInstalleur = (...contenu) => h('details', { class: 'bz-repli', open: D.ouvrirCommandes || null, ontoggle: (e) => { D.ouvrirCommandes = e.currentTarget.open; } },
    h('summary', {}, icone('wrench', { taille: 'sm' }), h('span', { class: 'bz-repli__titre', texte: 'Pour la personne qui installe' }), h('span', { class: 'bz-repli__note', texte: 'commandes et détails techniques' }), icone('chevron-down', { taille: 'sm' })),
    h('div', { class: 'bz-repli__corps bz-pile' }, contenu));
  const etapeInstaller = () => {
    if (D.facon === 'tailscale') return [
      h('ol', { class: 'bz-consignes' },
        h('li', {}, h('strong', { texte: 'Sur cet ordinateur : ' }), 'installez Tailscale (tailscale.com/download) et créez votre compte (offre gratuite).'),
        h('li', {}, h('strong', { texte: 'Sur vos téléphones : ' }), 'installez l’application Tailscale (App Store, Google Play) et connectez-vous avec le même compte.'),
        h('li', {}, h('strong', { texte: 'Ici : ' }), 'ouvrez Living Business à votre équipe. ',
          I.equipe ? h('span', { class: 'bz-badge bz-badge--ok' }, icone('circle-check', { taille: 'sm' }), 'Déjà ouvert') : h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => changerVue('reglages:reseau') }, 'Ouvrir le réseau du bureau'))),
      h('ul', { class: 'bz-liste-simple bz-t-petit', role: 'list' },
        h('li', { class: 'bz-ligne-icone' }, icone('laptop', { taille: 'sm' }), h('span', { texte: 'Cet ordinateur doit rester allumé, Living Business lancé (« Lancer au démarrage » dans Réseau du bureau).' })),
        h('li', { class: 'bz-ligne-icone' }, icone('shield-check', { taille: 'sm' }), h('span', { texte: 'Les échanges passent chiffrés entre vos appareils : rien n’est ouvert sur Internet, vos données restent sur cet ordinateur.' }))),
      pourInstalleur(h('p', { class: 'bz-t-petit', texte: 'Adresse à ouvrir sur le téléphone, Tailscale allumé (ou l’adresse 100.x.y.z que Tailscale indique pour cet ordinateur) :' }), blocCode(adresseTailscale, 'Copier l’adresse')),
    ];
    if (D.facon === 'serveur') return [
      h('ol', { class: 'bz-consignes' },
        h('li', {}, h('strong', { texte: 'Louez un petit serveur Linux : ' }), 'Ubuntu 24.04, 2 Go de mémoire, chez OVHcloud, Scaleway, IONOS… environ 5 à 7 € par mois.'),
        h('li', {}, h('strong', { texte: 'Une adresse à votre nom : ' }), 'chez votre registraire, ajoutez un enregistrement DNS de type A : nom « jeu », valeur = l’adresse IP du serveur.'),
        h('li', {}, h('strong', { texte: 'Lancez l’installation, ' }), 'puis ouvrez le lien affiché à la fin pour créer le compte administrateur, ou restaurer vos données d’aujourd’hui.')),
      champDomaine(),
      pourInstalleur(h('p', { class: 'bz-t-petit', texte: signataires.length ? 'Sur le serveur (SSH, avec votre clé), lancez exactement la commande : elle vérifie la signature de l’éditeur, puis lance l’installation.' : 'Sur le serveur (SSH, avec votre clé), lancez exactement :' }), blocVivant(commande, 'Copier la commande'), sansNexus(), signatureInconnue(),
        h('ul', { class: 'bz-liste-simple bz-t-petit', role: 'list' },
          h('li', { texte: 'HTTPS automatique (certificat renouvelé tout seul), pare-feu, mises à jour de sécurité du système.' }),
          h('li', { texte: 'Sauvegarde chaque jour sur le serveur (30 jours gardés).' }),
          h('li', { texte: 'Mises à jour : « sudo living-business-mise-a-jour ». Le serveur vérifie la signature de l’éditeur avant d’exécuter quoi que ce soit, et refuse une version plus ancienne. Vos données sont conservées.' }))),
      exporter(),
    ];
    return [
      encadre('info', 'Le plus simple : Claude installe votre serveur à votre place.', 'Louez d’abord le serveur et faites pointer votre nom de domaine vers lui. Collez ensuite ce texte dans Claude Code (dans un terminal) ou dans l’application Claude avec accès au terminal : Claude fait l’installation sur VOTRE serveur, en vous montrant chaque commande.'),
      champDomaine(),
      blocVivant(() => REG.promptClaude(entreprise, domaine(), commande()), 'Copier le texte pour Claude'),
      sansNexus(),
      h('ul', { class: 'bz-liste-simple bz-t-petit', role: 'list' },
        h('li', { class: 'bz-ligne-icone' }, icone('key-round', { taille: 'sm' }), h('span', { texte: 'Vous gardez la main : vous vous connectez vous-même au serveur ; les mots de passe éventuels, vous les tapez dans le terminal, jamais dans la conversation.' })),
        h('li', { class: 'bz-ligne-icone' }, icone('shield-check', { taille: 'sm' }), h('span', { texte: 'Claude n’a pas besoin de vos données : vous restaurerez vous-même la sauvegarde exportée.' })),
        h('li', { class: 'bz-ligne-icone' }, icone('eye', { taille: 'sm' }), h('span', { texte: 'Relisez toujours ce que Claude propose avant d’accepter une commande.' }))),
      pourInstalleur(h('p', { class: 'bz-t-petit', texte: 'La commande que Claude lancera sur le serveur :' }), blocVivant(commande, 'Copier la commande')),
      exporter(),
    ];
  };
  const suivreVerif = () => {
    clearTimeout(D.suivi);
    D.suivi = setTimeout(async () => {
      if (!D.verif || D.verif.vu || E.vue !== 'reglages' || E.sousReglages !== 'en-ligne') return;
      try { const r = await api('GET', `/en-ligne/verification/${D.verif.jeton}`); if (r.vu) { D.verif = { ...D.verif, ...r }; annoncer(`Votre Living Business répond bien sur votre ${r.appareil ?? 'téléphone'}.`); rendre(); return; } }
      catch (e) { D.verif = { ...D.verif, erreur: e.message }; rendre(); return; }
      suivreVerif();
    }, 2000);
  };
  const lancerVerif = async () => {
    try { D.verif = { ...(await api('POST', '/en-ligne/verification', {})), vu: false }; } catch (e) { D.verif = { erreur: e.message, adresses: [] }; }
    rendre();
    if (D.verif?.jeton) suivreVerif();
  };
  const etapeVerifier = () => {
    const V = D.verif;
    if (!V) return [
      h('p', { texte: 'Vérifions que votre téléphone joint bien Living Business : un QR code à scanner, la réponse arrive ici toute seule.' }),
      h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: lancerVerif }, icone('qr-code'), 'Afficher le QR code')),
    ];
    if (V.erreur && !V.jeton) return [messageEnLigne('critique', 'La vérification n’a pas pu démarrer.', V.erreur), h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: lancerVerif }, icone('refresh-cw'), 'Réessayer')];
    if (V.vu) return [h('div', { class: 'bz-resultat', 'data-ton': 'ok', role: 'status' }, iconeEtat('ok', { decoratif: true }),
      h('div', {}, h('p', { class: 'bz-t-titre-4', texte: `Votre Living Business répond bien sur votre ${V.appareil ?? 'téléphone'}.` }), h('p', { class: 'bz-t-petit', texte: `Vérifié ${dateRelative(V.le)}. Ajoutez-le à l’écran d’accueil du téléphone pour l’ouvrir comme une application.` }))),
      h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { D.verif = null; rendre(); } }, icone('rotate-ccw'), 'Vérifier un autre appareil'))];
    const adresses = REG.adressesPour(D.facon, V.adresses);
    if (!adresses.length) return [
      encadre('attention', 'Aucune adresse joignable depuis un téléphone pour l’instant.', D.facon === 'tailscale' ? 'Allumez Tailscale sur cet ordinateur, puis ouvrez le réseau du bureau.' : 'Ouvrez le réseau du bureau, ou terminez l’installation du serveur et vérifiez depuis son adresse.'),
      h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => changerVue('reglages:reseau') }, icone('wifi'), 'Réseau du bureau'), h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: lancerVerif }, icone('refresh-cw'), 'Réessayer'))];
    const a = adresses[0];
    return [
      h('div', { class: 'bz-verification' },
        h('div', { class: 'bz-qr' }, h('img', { src: a.qr, alt: `QR code de l’adresse ${a.url}`, width: '200', height: '200' })),
        h('div', { class: 'bz-pile' },
          h('ol', { class: 'bz-consignes' }, h('li', { texte: 'Sur le téléphone, ouvrez l’appareil photo.' }), h('li', { texte: 'Visez ce QR code et touchez le lien qui apparaît.' }), h('li', { texte: 'La réponse arrive ici, en quelques secondes.' })),
          h('p', { class: 'bz-t-petit bz-ligne-icone', 'aria-live': 'polite' }, icone('loader-circle', { taille: 'sm', classe: 'bz-tourne' }), h('span', { texte: `En attente du téléphone… (valable jusqu’à ${new Date(V.expire).toLocaleTimeString('fr-FR', { hour: 'numeric', minute: '2-digit' })})` })),
          h('p', { class: 'bz-t-micro bz-texte-2' }, 'Adresse : ', h('span', { class: 'bz-t-identifiant', 'data-brut': '', texte: a.url }), a.genre === 'tailscale' ? ' (Tailscale)' : a.genre === 'equipe' ? ' (réseau du bureau)' : ''))),
    ];
  };
  const aller = (id) => { D.etape = id; rendre(); annoncer(`Étape ${REG.etapesEnLigne(D.facon).findIndex((x) => x.id === id) + 1} sur 3`); setTimeout(() => $('#en-ligne-etape')?.focus(), 0); };
  function rendre() {
    const etapes = REG.etapesEnLigne(D.facon);
    const i = Math.max(0, etapes.findIndex((x) => x.id === D.etape));
    vivants.length = 0;
    if (!zoneReglages()) return;
    remplir(zoneReglages(), h('div', { class: 'bz-en-ligne' },
      h('p', { class: 'bz-t-chapeau', texte: 'Utiliser Living Business partout (téléphone, chantier, maison) sans confier vos données à personne.' }),
      h('nav', { class: 'bz-en-ligne__etapes', 'aria-label': 'Étapes' }, h('ol', {}, etapes.map((x, k) => h('li', { 'aria-current': x.id === D.etape ? 'step' : null, 'data-faite': k < i ? '' : null },
        k < i ? h('button', { type: 'button', onclick: () => aller(x.id) }, icone('check', { taille: 'sm' }), h('span', { texte: `${k + 1}. ${x.titre}` })) : h('span', { texte: `${k + 1}. ${x.titre}` }))))),
      h('p', { class: 'bz-t-micro bz-texte-2 bz-en-ligne__progression', texte: `Étape ${i + 1} sur ${etapes.length} · ${etapes[i].titre}` }),
      h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'en-ligne-etape' },
        h('h3', { class: 'bz-t-titre-4', id: 'en-ligne-etape', tabindex: '-1', texte: etapes[i].titre }),
        D.etape === 'facon' ? [
          schemaEnLigne(D.facon),
          h('fieldset', { class: 'bz-grille-choix bz-grille-choix--grand' }, h('legend', { class: 'bz-visuellement-cache', texte: 'Façon de mettre en ligne' }),
            REG.FACONS.map((f) => h('label', { class: 'bz-choix bz-choix--illustre' },
              h('input', { type: 'radio', name: 'facon-en-ligne', value: f.id, checked: D.facon === f.id, onchange: () => { D.facon = f.id; D.verif = null; rendre(); } }),
              // schéma illustré (§6.1 P9) : là où tourne Living Business → le lien → le téléphone
              h('span', { class: 'bz-choix__illustration bz-choix__schema', 'aria-hidden': 'true' },
                (f.schema ?? [f.icone]).flatMap((ic, k) => [k ? h('span', { class: 'bz-choix__schema-lien' }) : null, h('span', { class: `bz-choix__schema-etape${k === 1 ? ' bz-choix__schema-etape--lien' : ''}` }, icone(ic, { taille: 'lg' }))])),
              h('span', { class: 'bz-choix__texte' }, h('span', { class: 'bz-badge', texte: f.badge }), h('span', { class: 'bz-choix__titre', texte: f.titre }), h('span', { class: 'bz-choix__detail', texte: f.texte }))))),
        ] : D.etape === 'installer' ? etapeInstaller() : etapeVerifier()),
      h('div', { class: 'bz-groupe-boutons bz-en-ligne__pied' },
        i > 0 ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => aller(etapes[i - 1].id) }, icone('arrow-left'), 'Retour') : null,
        i < etapes.length - 1 ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => aller(etapes[i + 1].id) }, 'Continuer', icone('arrow-right')) : null)));
  }
  rendre();
  if (D.verif?.jeton && !D.verif.vu) suivreVerif();
}

/**
 * Formulaire d'export chiffré, partagé par « Sauvegardes » et « Mettre en ligne ». Phrase : bouton « Afficher » et
 * robustesse écrite (§4.6). La copie contient tout : identité revérifiée (mot de passe, code si la validation en deux
 * étapes est active). Par défaut SANS la clé des accès aux logiciels connectés ; avec, la phrase est plus longue.
 * `principal` : faux quand la vue a déjà son action principale (P1).
 */
const PHRASE_MIN = 12;
const PHRASE_MIN_AVEC_ACCES = 16;
function formulaireExport(X, nomFichier, rendre, { principal = true } = {}) {
  if (!ENTREE) chargerEntree().then(() => rendre()).catch(() => {});
  const comptes = E.connexion?.connexion === 'comptes';
  X.codeDemande ??= Boolean(E.connexion?.compte?.deuxEtapes);
  const min = X.avecAcces ? PHRASE_MIN_AVEC_ACCES : PHRASE_MIN;
  return h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    X.erreur = X.phrase.length < min ? `La phrase de protection fait ${min} caractères au moins${X.avecAcces ? ' quand la copie contient les accès' : ''}.`
      : memeMdp(X, 'phrase', 'confirmation') ?? (comptes && !X.motDePasse ? 'Saisissez votre mot de passe.' : null);
    if (!X.erreur) {
      X.envoi = true;
      rendre();
      try {
        const f = await api('POST', '/sauvegardes/export', { phrase: X.phrase, avecAcces: Boolean(X.avecAcces), ...(comptes ? { motDePasse: X.motDePasse, code: X.code || undefined } : {}) });
        telecharger(nomFichier, JSON.stringify(f), 'application/json');
        Object.assign(X, { phrase: '', confirmation: '', motDePasse: '', code: '', fait: true });
      } catch (err) {
        if (err.session) return undefined;
        X.erreur = err.message;
        if (err.code === 'code_invalide') X.codeDemande = true;
        X.code = '';
      }
      X.envoi = false;
    }
    return rendre();
  } },
  comptes ? h('input', { type: 'text', hidden: true, autocomplete: 'username', value: E.connexion?.compte?.identifiant ?? '', readonly: true }) : null,
  h('div', { class: 'bz-grille-champs' },
    champMotDePasse(X, 'phrase', { id: 'export-phrase', libelle: 'Phrase de protection', nouveau: true, minimum: min, aide: 'Personne ne pourra la retrouver pour vous.', afficher: 'Afficher la phrase', required: true, minlength: String(min) }),
    champMotDePasse(X, 'confirmation', { id: 'export-confirmation', libelle: 'Confirmez la phrase', aide: 'Retapez-la à l’identique.', autocomplete: 'new-password', afficher: 'Afficher la confirmation', required: true })),
  h('div', { class: 'bz-pile bz-pile--serre' },
    h('label', { class: 'bz-case' }, h('input', { type: 'checkbox', checked: Boolean(X.avecAcces), 'aria-describedby': 'export-acces-aide', onchange: (e) => { X.avecAcces = e.target.checked; rendre(); } }), 'Inclure les accès aux logiciels connectés'),
    h('p', { class: 'bz-champ__aide', id: 'export-acces-aide', texte: `Pour un autre ordinateur ou le serveur : les logiciels connectés et la validation en deux étapes y marcheront sans être refaits. Sans cette case, ils restent illisibles hors de cet ordinateur. Avec, la phrase fait ${PHRASE_MIN_AVEC_ACCES} caractères au moins.` })),
  comptes ? h('div', { class: 'bz-grille-champs' },
    champMotDePasse(X, 'motDePasse', { id: 'export-mdp', libelle: 'Votre mot de passe', aide: 'Redemandé : la copie contient toutes les données.', identifiant: () => E.connexion?.compte?.identifiant ?? '', required: true }),
    X.codeDemande ? champEntree({ id: 'export-code', libelle: 'Code de validation', aide: 'Les 6 chiffres de l’application, ou un code de récupération.', valeur: X.code ?? '', required: true, maxlength: '12', autocomplete: 'one-time-code', inputmode: 'numeric', oninput: (v) => (X.code = v) }) : null) : null,
  h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'submit', class: `bz-bouton ${principal ? 'bz-bouton--principal' : 'bz-bouton--secondaire'}`, cle: 'export-envoyer', 'aria-busy': X.envoi ? 'true' : null }, icone(X.envoi ? 'loader-circle' : 'download'), X.envoi ? 'Chiffrement…' : 'Exporter une copie chiffrée')));
}

/**
 * Restauration avec des comptes : tout l'état est remplacé (comptes, mots de passe, clés d'API). Comme l'export, la
 * boîte redemande le mot de passe, puis le code quand la validation en deux étapes est active. Une erreur s'affiche
 * dans la boîte, qui reste ouverte ; focus initial sur le mot de passe, « Garder l'état actuel » ferme sans rien faire.
 */
function dialogueRestauration(corps, quoi) {
  const R = { motDePasse: '', code: '', erreur: null, champ: null, envoi: false, codeDemande: Boolean(E.connexion?.compte?.deuxEtapes) };
  const zone = h('div', { class: 'bz-pile' });
  const bouton = h('button', { type: 'submit', class: 'bz-bouton bz-bouton--danger' });
  const dessiner = () => {
    remplir(zone,
      messageEnLigne('critique', R.champ ? null : R.erreur),
      h('input', { type: 'text', hidden: true, autocomplete: 'username', value: E.connexion?.compte?.identifiant ?? '', readonly: true }),
      champMotDePasse(R, 'motDePasse', { id: 'restaurer-mdp', libelle: 'Votre mot de passe', aide: 'Redemandé : la restauration remplace aussi les comptes et les mots de passe.', erreur: R.champ === 'motDePasse' ? R.erreur : null, required: true }),
      R.codeDemande ? champEntree({ id: 'restaurer-code', libelle: 'Code de validation', aide: 'Les 6 chiffres de l’application, ou un code de récupération.', erreur: R.champ === 'code' ? R.erreur : null, valeur: R.code, required: true, maxlength: '12', autocomplete: 'one-time-code', inputmode: 'numeric', oninput: (v) => (R.code = v) }) : null);
    remplir(bouton, R.envoi ? icone('loader-circle') : null, R.envoi ? 'Restauration…' : 'Restaurer');
    bouton.setAttribute('aria-busy', R.envoi ? 'true' : 'false');
  };
  dessiner();
  const d = fenetre({
    titre: `Revenir à ${quoi} ?`, taille: 'md',
    texte: 'Tout l’état actuel est remplacé (une copie en est gardée juste avant). Tout le monde devra se reconnecter.',
    corps: [zone],
    pied: [h('button', { type: 'button', 'data-ferme': 'non', class: 'bz-bouton bz-bouton--secondaire', texte: 'Garder l’état actuel' }), bouton],
  });
  d.setAttribute('data-voile', 'garde');
  d.querySelector('form')?.addEventListener('submit', async (e) => {
    e.preventDefault(); // la boîte ne se ferme pas à l'envoi : elle attend la réponse
    if (R.envoi) return;
    R.erreur = !R.motDePasse ? 'Saisissez votre mot de passe.' : R.codeDemande && !R.code.trim() ? 'Saisissez le code de validation.' : null;
    R.champ = R.erreur ? (!R.motDePasse ? 'motDePasse' : 'code') : null;
    if (!R.erreur) {
      R.envoi = true;
      dessiner();
      try {
        await api('POST', '/sauvegardes/restaurer', { ...corps, motDePasse: R.motDePasse, code: R.code.trim() || undefined });
        location.href = '/';
        return;
      } catch (err) {
        if (err.session) { d.close(); return; }
        R.erreur = err.message;
        if (err.code === 'code_invalide') { R.codeDemande = true; R.code = ''; R.champ = 'code'; }
        else R.champ = err.code === 'mot_de_passe_actuel' ? 'motDePasse' : null;
        R.envoi = false;
      }
    }
    dessiner();
    if (R.erreur) annoncer(R.erreur);
    document.getElementById(R.champ === 'code' ? 'restaurer-code' : 'restaurer-mdp')?.focus();
  });
}

// ----- Sauvegardes
const octets = (n) => (n > 1e6 ? `${nf.format(n / 1e6)} Mo` : `${Math.max(1, Math.round(n / 1e3))} Ko`);
async function rendreSauvegardes() {
  const Z = zoneReglages();
  if (!Z) return;
  let S;
  try { S = await api('GET', '/sauvegardes'); } catch (e) { if (zoneReglages()) remplir(zoneReglages(), blocVide({ titre: 'Les sauvegardes n’ont pas pu être lues.', texte: e.message, role: 'alert', actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => rendreSauvegardes() }, icone('refresh-cw'), 'Réessayer') })); return; }
  const X = { phrase: '', confirmation: '', erreur: null, fait: false, envoi: false };
  const I = { fichier: null, registre: null, phrase: '', erreur: null, envoi: false };
  const restaurer = async (corps, quoi) => {
    // comptes : la boîte redemande le mot de passe (et le code), l'envoi se fait depuis elle
    if (E.connexion?.connexion === 'comptes') return dialogueRestauration(corps, quoi);
    if (!(await confirmerDialogue({ titre: `Revenir à ${quoi} ?`, texte: 'Tout l’état actuel est remplacé (une copie en est gardée juste avant). Tout le monde devra se reconnecter.', confirmer: 'Restaurer', annuler: 'Garder l’état actuel', danger: true }))) return;
    I.envoi = true;
    rendre();
    try { await api('POST', '/sauvegardes/restaurer', corps); location.href = '/'; } catch (err) { I.erreur = err.message; I.envoi = false; rendre(); }
  };
  const rendre = () => { if (!zoneReglages()) return; remplir(zoneReglages(),
    h('p', { class: 'bz-t-petit bz-texte-2 bz-reglages__intro', texte: 'Vos données restent sur cet ordinateur : l’éditeur ne les reçoit pas. Une copie est faite chaque jour et gardée 30 jours. Contre une panne ou un vol, exportez de temps en temps une copie chiffrée sur une clé USB ou un autre disque.' }),
    !S.enregistre ? encadre('info', 'Démonstration en mémoire : rien n’est enregistré sur le disque.') : null,
    h('div', { class: 'bz-tuiles' },
      h('dl', { class: 'bz-tuile' }, h('dt', {}, h('span', { texte: 'Dernière copie automatique' }), S.auto.length ? null : iconeEtat('attention', { taille: 'sm', classe: 'bz-tuile__etat' })),
        h('dd', { class: 'bz-tuile__valeur bz-t-chiffre', 'data-certitude': S.auto.length ? null : 'absent', texte: S.auto.length ? dateRelative(S.auto[0].le) : '—' }),
        h('dd', { class: 'bz-tuile__note', texte: S.auto.length ? pluriel(S.auto.length, 'copie gardée', 'copies gardées') : 'La première est faite au premier changement du jour' }))),
    sectionReglage('sauv-export', 'Exporter une copie chiffrée', 'Le fichier contient tout (données et comptes), chiffré par une phrase que vous choisissez. Sans la phrase, il est illisible. Chaque export est inscrit au journal et signalé aux autres administrateurs.',
      messageEnLigne('critique', X.erreur),
      X.fait ? messageEnLigne('ok', 'Copie téléchargée. Rangez-la hors de cet ordinateur et gardez la phrase.') : null,
      formulaireExport(X, `living-business-${new Date().toISOString().slice(0, 10)}.lbsauv`, rendre)),
    sectionReglage('sauv-auto', `Copies automatiques · ${S.auto.length}`, null,
      S.auto.length ? h('div', { class: 'bz-tableau-cadre' }, h('table', { class: 'bz-tableau bz-tableau--empile' },
        h('thead', {}, h('tr', {}, ['Copie', 'Date', 'Taille', 'Action'].map((t, k) => h('th', { scope: 'col', class: k === 2 ? 'bz-num' : null, texte: t })))),
        h('tbody', {}, S.auto.map((x) => { const quoi = x.nom.startsWith('avant-restauration') ? 'la copie d’avant restauration' : `la copie du ${date(x.nom.slice(6, 16))}`; return h('tr', {},
          h('th', { scope: 'row', texte: x.nom.startsWith('avant-restauration') ? 'Avant restauration' : `Copie du ${date(x.nom.slice(6, 16))}` }),
          h('td', { 'data-colonne': 'Date', texte: dateHeure(x.le) }), h('td', { class: 'bz-num', 'data-colonne': 'Taille', texte: octets(x.taille) }),
          h('td', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', disabled: I.envoi || null, onclick: () => restaurer({ nom: x.nom }, quoi) }, icone('history', { taille: 'sm' }), 'Revenir à cette copie'))); })))) : blocVide({ titre: 'Pas encore de copie.', texte: 'La première est faite dès le premier changement du jour.', compact: true })),
    sectionReglage('sauv-restaurer', 'Restaurer une copie exportée', 'Remplace tout l’état actuel (une copie de l’état actuel est gardée avant). Tout le monde devra se reconnecter.',
      messageEnLigne('critique', I.erreur),
      h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: async (e) => {
        e.preventDefault();
        if (!I.fichier) { I.erreur = 'Choisissez un fichier .lbsauv.'; return rendre(); }
        let fichier;
        try { fichier = JSON.parse(await I.fichier.text()); } catch { I.erreur = 'Ce fichier n’est pas une sauvegarde Living Business.'; return rendre(); }
        await restaurer({ fichier, phrase: I.phrase, registre: I.registre ? await I.registre.text() : undefined }, 'la copie exportée');
      } },
        h('div', { class: 'bz-grille-champs' },
          h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'restaurer-fichier', texte: 'Fichier (.lbsauv)' }), h('input', { id: 'restaurer-fichier', class: 'bz-champ__saisie', type: 'file', accept: '.lbsauv,.json,application/json', onchange: (e) => (I.fichier = e.target.files?.[0] ?? null) })),
          h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'restaurer-phrase', texte: 'Phrase de protection' }), h('input', { id: 'restaurer-phrase', class: 'bz-champ__saisie', type: 'password', autocomplete: 'off', value: I.phrase, oninput: (e) => (I.phrase = e.target.value) }))),
        h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'restaurer-registre', texte: 'Registre des effacements (facultatif)' }),
          h('p', { class: 'bz-champ__aide', id: 'restaurer-registre-aide', texte: 'Si la copie vient d’un autre serveur : joignez le fichier registre-effacements.jsonl rangé avec ses sauvegardes. Les fiches effacées depuis ne reviendront pas.' }),
          h('input', { id: 'restaurer-registre', class: 'bz-champ__saisie', type: 'file', accept: '.jsonl,text/plain', 'aria-describedby': 'restaurer-registre-aide', onchange: (e) => (I.registre = e.target.files?.[0] ?? null) })),
        h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'submit', class: 'bz-bouton bz-bouton--secondaire', 'aria-busy': I.envoi ? 'true' : null }, icone('upload'), I.envoi ? 'Restauration…' : 'Restaurer'))))); };
  rendre();
}

// ----- Breizhcosystem
const CATEGORIES_NEXUS = [
  ['profil', 'Profil', 'Votre activité (secteur) sur votre fiche Breizhcosystem.'],
  ['besoins', 'Besoins détectés', 'Ruptures de stock, renfort de personnel, location de matériel : le réseau vous propose des solutions.'],
  ['stocks', 'Stocks à céder', 'Le surplus des articles en surstock (au-delà de 2 fois le seuil d’alerte), proposé aux membres.'],
  ['capacites', 'Capacité disponible', 'Le nombre de personnes sans affectation dans les prochains jours, jamais leurs noms.'],
  ['indicateurs', 'Notes de santé', 'Vos notes sur 100, rattachées à votre entreprise chez Breizhcosystem, pour vous comparer par groupes d’au moins 10 entreprises (les autres membres ne voient que ces moyennes). Jamais de montant. Sous 11 personnes, aucune note de l’équipe (absences, formation, planning) ne part. Les notes tirées du baromètre ne partent jamais.'],
];
async function rendreReglagesNexus() {
  const Z = zoneReglages();
  if (!Z) return;
  let N;
  try { N = await api('GET', '/nexus'); } catch (e) { if (zoneReglages()) remplir(zoneReglages(), blocVide({ titre: 'Breizhcosystem n’a pas pu être joint.', texte: e.message, role: 'alert', actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => rendreReglagesNexus() }, icone('refresh-cw'), 'Réessayer') })); return; }
  const S = { url: N.url ?? '', liaison: N.liaisonEnCours, erreur: null, apercu: null };
  let suivi = null;
  const suivre = () => {
    clearTimeout(suivi);
    suivi = setTimeout(async () => {
      if (E.vue !== 'reglages' || E.sousReglages !== 'nexus') return;
      try { const r = await api('GET', '/nexus/liaison'); if (r.statut === 'reliee') { informer(`Relié à Breizhcosystem : ${r.organisation ?? 'votre entreprise'}.`, 'ok'); rendreReglagesNexus(); return; } } catch { /* nouvel essai */ }
      suivre();
    }, 3000);
  };
  const offre = RESEAU.offre(N.droits);
  const rendre = () => { if (!zoneReglages()) return; remplir(zoneReglages(),
    h('p', { class: 'bz-t-petit bz-texte-2 bz-reglages__intro', texte: 'Breizhcosystem relie les entreprises : besoins, stocks à céder, appels d’offres publics, achats groupés, comparaison entre entreprises comparables. Living Business reste chez vous : il n’envoie que ce que vous cochez, et vous pouvez le voir avant.' }),
    messageEnLigne('critique', S.erreur),
    !N.relie ? sectionReglage('nexus-relier', 'Relier mon entreprise', null,
      h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: async (e) => { e.preventDefault(); try { N = { ...N, ...(await api('PUT', '/nexus/adresse', { url: S.url })) }; S.erreur = null; } catch (err) { S.erreur = err.message; } rendre(); } },
        h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'nexus-adresse', texte: 'Adresse de Breizhcosystem' }),
          h('div', { class: 'bz-edition__ligne' }, h('input', { id: 'nexus-adresse', class: 'bz-champ__saisie', type: 'url', inputmode: 'url', autocomplete: 'off', placeholder: 'https://nexus…', value: S.url, oninput: (e) => (S.url = e.target.value) }),
            h('button', { type: 'submit', class: 'bz-bouton bz-bouton--secondaire' }, 'Enregistrer')),
          h('p', { class: 'bz-champ__aide', texte: `Fournie par ${MARQUE.mere}.` }))),
      N.url ? (S.liaison
        ? h('div', { class: 'bz-pile' },
          h('ol', { class: 'bz-consignes' }, h('li', { texte: 'Ouvrez Breizhcosystem et connectez-vous (ou inscrivez-vous avec votre SIRET, une minute).' }), h('li', { texte: 'Vérifiez que ce code est bien affiché, puis confirmez :' })),
          h('p', { class: 'bz-code-secours bz-t-identifiant', 'data-brut': '', texte: S.liaison.code }),
          h('div', { class: 'bz-groupe-boutons' }, lienExterne(S.liaison.url, 'Ouvrir Breizhcosystem pour confirmer', 'bz-bouton bz-bouton--principal')),
          h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, icone('loader-circle', { taille: 'sm', classe: 'bz-tourne' }), h('span', { texte: 'Cette page se met à jour toute seule dès que vous avez confirmé.' })))
        : h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--lg', onclick: async () => { try { S.liaison = await api('POST', '/nexus/liaison', {}); S.erreur = null; suivre(); } catch (err) { S.erreur = err.message; } rendre(); } }, icone('link'), 'Relier mon entreprise à Breizhcosystem'))) : null)
      : [
        sectionReglage('nexus-lien', 'Entreprise reliée', null,
          h('p', { class: 'bz-t-label' }, N.organisation ?? 'Entreprise reliée', ' ', offre ? h('span', { class: offre === 'Breizhcosystem ACTIVE' ? 'bz-badge bz-badge--active' : 'bz-badge', texte: offre === 'Breizhcosystem ACTIVE' ? 'ACTIVE' : 'Gratuit' }) : null),
          h('p', { class: 'bz-t-petit bz-texte-2' }, h('span', { class: 'bz-t-identifiant', 'data-brut': '', texte: N.url }), N.dernierEnvoi ? ` · dernier envoi ${dateRelative(N.dernierEnvoi)}` : ' · pas encore d’envoi'),
          N.suspendue ? encadre('attention', 'Accès à Breizhcosystem suspendu par l’éditeur.', `${N.suspendue.message ? `${N.suspendue.message} ` : ''}La liaison est conservée : inutile de relier de nouveau, tout reprendra dès la levée de la suspension. Votre jeu continue de fonctionner.`) : null,
          N.derniereErreur ? messageEnLigne('critique', 'Le dernier envoi a échoué.', N.derniereErreur) : null,
          h('div', { class: 'bz-groupe-boutons' },
            lienExterne(N.url, 'Ouvrir Breizhcosystem'),
            h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: async () => { try { const r = await api('POST', '/nexus/envoyer', {}); informer(`Envoyé : ${Object.entries(r.recu ?? {}).map(([k, v]) => `${k} ${v}`).join(', ') || 'rien à envoyer'}.`, 'ok'); rendreReglagesNexus(); } catch (err) { S.erreur = err.message; rendre(); } } }, icone('send'), 'Envoyer maintenant'),
            h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--critique', onclick: async () => {
              if (!(await confirmerDialogue({ titre: 'Délier l’entreprise de Breizhcosystem ?', texte: 'Plus rien n’est envoyé. Votre fiche reste sur Breizhcosystem ; vous pourrez la relier de nouveau.', confirmer: 'Délier', annuler: 'Garder le lien', danger: true }))) return;
              try { await api('DELETE', '/nexus'); informer('Breizhcosystem délié : plus rien n’est envoyé.', 'ok'); } catch (err) { S.erreur = err.message; }
              rendreReglagesNexus();
            } }, icone('unlink'), 'Délier'))),
        sectionReglage('nexus-partage', 'Ce que vous partagez', 'Rien ne part tant que vous n’avez rien coché ici, même si c’est coché sur Breizhcosystem. Regardez d’abord ce que chaque catégorie enverrait.',
          CATEGORIES_NEXUS.map(([k, l, aide]) => interrupteurReglage({ cle: `partage-${k}`, titre: l, aide, actif: (N.partage ?? []).includes(k), regler: async (v) => {
            const cats = new Set(N.partage ?? []);
            if (v) cats.add(k); else cats.delete(k);
            try { N.partage = (await api('PUT', '/nexus/partage', { categories: [...cats] })).categories; informer(v ? `${l} : partagé.` : `${l} : retiré de Breizhcosystem.`, 'ok'); S.erreur = null; } catch (err) { S.erreur = err.message; }
            rendre();
          } })),
          h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: async () => { try { S.apercu = await api('GET', '/nexus/apercu'); } catch (err) { S.erreur = err.message; } rendre(); } }, icone('eye'), 'Voir ce qui partirait')),
          S.apercu ? apercuPartage(S.apercu) : null),
      ]); };
  if (S.liaison) suivre();
  rendre();
}
/** Aperçu mot pour mot de chaque catégorie, avec ce qui part vraiment (coché ici et sur Breizhcosystem) et ce qui ne part pas. */
function apercuPartage(A) {
  const partent = new Set(A.categories ?? []);
  const d = A.possibles ?? A.donnees ?? {};
  const lignes = [];
  if (d.profil) lignes.push(['profil', 'Profil', d.profil.activite ?? '—']);
  for (const b of d.besoins ?? []) lignes.push(['besoins', 'Besoin', b.titre]);
  for (const st of d.stocks ?? []) lignes.push(['stocks', 'Stock à céder', `${st.titre} : ${st.quantite} ${st.unite ?? ''}`.trim()]);
  for (const c of d.capacites ?? []) lignes.push(['capacites', 'Capacité', `${c.titre} (${date(c.du)})`]);
  if (d.indicateurs) lignes.push(['indicateurs', 'Notes de santé', `${pluriel(Object.keys(d.indicateurs).length, 'note sur 100', 'notes sur 100')} (score global ${d.indicateurs.global ?? '—'})`]);
  return h('div', { class: 'bz-carte bz-carte--plate bz-pile' }, h('p', { class: 'bz-t-petit', texte: partent.size ? 'Voici, mot pour mot, ce que chaque catégorie enverrait (données d’exemple exclues). Seules les lignes « Part » quittent Living Business.' : 'Voici, mot pour mot, ce que chaque catégorie enverrait (données d’exemple exclues). Rien n’est coché : rien ne part.' }),
    lignes.length ? h('dl', { class: 'bz-champs-fiche' }, lignes.map(([cat, k, v]) => h('div', { class: 'bz-champ-fiche' }, h('dt', { class: 'bz-champ-fiche__libelle', texte: k }),
      h('dd', { class: 'bz-champ-fiche__valeur' }, h('span', { texte: v }), ' ', h('span', { class: partent.has(cat) ? 'bz-badge bz-badge--ok' : 'bz-badge', texte: partent.has(cat) ? 'Part' : 'Ne part pas' }))))) : blocVide({ titre: 'Rien à envoyer pour l’instant.', compact: true }));
}

const LIBELLE_SENS = { lecture: 'De l’outil vers le jeu', deux: 'Dans les deux sens', ecriture: 'Du jeu vers l’outil' };

/**
 * « Se connecter avec… » : l'onglet est ouvert PENDANT le clic (sinon le navigateur le bloque), vide et sans lien vers
 * le jeu, puis dirigé vers la page de connexion de l'outil ; la connexion est ensuite suivie toutes les 2 s.
 * `suivi` reçoit { statut: 'attente', url, ouvert } puis { statut: 'connecte', jeton, compte } ou { statut: 'erreur', message, code }.
 * `droits` : « lecture » (par défaut) ou « ecriture » (synchro qui écrit dans l'outil) ; le relais demande le minimum.
 * Le navigateur ne reçoit jamais de jeton : seulement une référence « oauth:… » à renvoyer au jeu. Renvoie « annuler ».
 */
function connecterOAuth(source, config, suivi, droits = 'lecture') {
  let fini = false;
  let id = null;
  let onglet = null;
  try { onglet = window.open('', '_blank'); if (onglet) onglet.opener = null; } catch { onglet = null; }
  const fermerOnglet = () => { try { if (onglet && !onglet.closed && onglet.location.href === 'about:blank') onglet.close(); } catch { /* onglet déjà sur la page de l'outil */ } };
  const annuler = () => {
    if (fini) return;
    fini = true;
    fermerOnglet();
    if (id) api('DELETE', `/synchro/oauth/${id}`).catch(() => {});
  };
  (async () => {
    try {
      const d = await api('POST', '/synchro/oauth/demarrer', { source, config, droits });
      id = d.id;
      if (fini) { api('DELETE', `/synchro/oauth/${id}`).catch(() => {}); return; }
      let ouvert = false;
      try { if (onglet && !onglet.closed) { onglet.location.replace(d.url); ouvert = true; } } catch { ouvert = false; }
      suivi({ statut: 'attente', url: d.url, ouvert, verification: d.verification ?? null });
      const fin = Date.now() + 10 * 60_000;
      while (!fini && Date.now() < fin) {
        await new Promise((ok) => setTimeout(ok, 2000));
        if (fini) return;
        let r;
        try { r = await api('POST', `/synchro/oauth/${d.id}`); } catch (e) {
          if (e.statut && e.statut < 500) { fini = true; suivi({ statut: 'erreur', message: e.message }); return; }
          continue; // relais momentanément injoignable : on réessaie
        }
        if (r.statut === 'attente') continue;
        fini = true;
        suivi(r.statut === 'connecte' ? { statut: 'connecte', jeton: r.jeton, compte: r.compte } : { statut: 'erreur', message: r.message });
        return;
      }
      if (!fini) { fini = true; suivi({ statut: 'erreur', message: 'La connexion a expiré : relancez-la.' }); }
    } catch (e) {
      fini = true;
      fermerOnglet();
      suivi({ statut: 'erreur', message: e.message, code: e.code ?? null });
    }
  })();
  return annuler;
}

/** « Se reconnecter » (connexion expirée, autre compte) : nouvelle connexion, puis le connecteur la reprend. */
function seReconnecter(c, s, apres) {
  const config = s.oauth.champ && c.config[s.oauth.champ] ? { [s.oauth.champ]: c.config[s.oauth.champ] } : {};
  connecterOAuth(c.source, config, async (r) => {
    if (r.statut === 'attente') { informer(`Connectez-vous à ${s.oauth.nom} dans l’onglet qui vient de s’ouvrir…${r.verification ? ` Breizhcosystem vous montrera le code ${r.verification} : acceptez seulement s’il est identique.` : ''}`); return; }
    if (r.statut === 'erreur') { informer(r.message, 'erreur'); return; }
    try {
      await api('PUT', `/synchro/${c.id}`, { config: { jeton: r.jeton } });
      await api('POST', `/synchro/${c.id}/maintenant`).catch(() => {});
      informer(`Reconnecté à ${s.oauth.nom}.`, 'ok');
    } catch (e) { informer(e.message, 'erreur'); }
    apres();
  }, c.sens === 'lecture' ? 'lecture' : 'ecriture');
}
async function rendreOutils() {
  if (!zoneReglages()) return;
  let liste;
  let sources;
  try { [liste, sources] = await Promise.all([api('GET', '/synchro'), api('GET', '/sources'), chargerConnecter()]); } catch (e) { if (zoneReglages()) remplir(zoneReglages(), resultatAssistant('critique', 'Les logiciels connectés n’ont pas pu être chargés.', { detail: e.message, alerte: true })); return; }
  if (!zoneReglages()) return;
  E.sources = sources;
  const types = E.monde.univers.types;
  const ETAT = { ok: ['ok', 'Synchronisé'], erreur: ['critique', 'Erreur'] };
  remplir(zoneReglages(), h('div', { class: 'bz-pile' },
    h('p', { class: 'bz-t-petit bz-texte-2 bz-reglages__intro' }, liste.length ? h('span', { class: 'bz-compteur', texte: String(liste.length) }) : null, ' Chaque logiciel connecté se synchronise tout seul : ce qui change chez lui apparaît sur votre carte, et ce que vous changez ici repart chez lui si vous l’avez choisi. Les connexions sont chiffrées sur votre serveur.'),
    liste.length ? h('ul', { class: 'bz-liste-simple', role: 'list' }, liste.map((c) => {
      const s = sources.find((x) => x.id === c.source);
      const famille = s ? CONNECTER.catalogue([s], [], { pasAPas: false })[0] : null;
      const [ton, etat] = ETAT[c.statut] ?? ['info', 'Jamais synchronisé'];
      const idTitre = `outil-${c.id}`;
      return h('li', {}, h('section', { class: 'bz-carte', 'aria-labelledby': idTitre },
        h('div', { class: 'bz-carte__tete' },
          h('div', { class: 'bz-logiciel bz-logiciel--statique' },
            h('span', { class: 'bz-logiciel__icone', 'aria-hidden': 'true' }, icone(famille?.icone ?? 'plug')),
            h('span', { class: 'bz-logiciel__texte' },
              h('h3', { class: 'bz-logiciel__nom', id: idTitre, texte: c.nom }),
              h('span', { class: 'bz-logiciel__description', texte: `${s?.nom ?? c.source} · ${types.find((t) => t.id === c.typeObjet)?.pluriel ?? c.typeObjet}${c.roles.length ? ` (${c.roles.join(', ')})` : ''} · ${LIBELLE_SENS[c.sens]}` }))),
          h('span', { class: `bz-badge bz-badge--${ton}` }, iconeEtat(ton, { taille: 'sm', decoratif: true }), etat)),
        c.message ? resultatAssistant('critique', c.message) : null,
        // fiches reliées à l'outil seulement parce qu'elles portent le même nom : un administrateur tranche (rien ne part avant)
        c.aConfirmer ? resultatAssistant('attention', `${pluriel(c.aConfirmer, 'fiche reliée', 'fiches reliées')} par le nom seulement : rien ne part vers ${c.nom} pour ${c.aConfirmer > 1 ? 'elles' : 'elle'} tant que vous n’avez pas confirmé.`, {
          actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => confirmerRapprochements(c, () => rendreOutils()) }, icone('link'), 'Vérifier') }) : null,
        // « En temps réel » quand l'outil prévient le jeu de ses changements (par Breizhcosystem), sinon sa fréquence de relecture
        h('p', { class: 'bz-t-petit', texte: `${pluriel(c.liens, 'fiche liée', 'fiches liées')} · ${c.derniereSynchro ? `synchronisé ${dateRelative(c.derniereSynchro)}` : 'pas encore synchronisé'}${s?.lecture === 'appel' ? ` · ${c.frequence ?? `Toutes les ${c.intervalleS >= 60 ? `${Math.round(c.intervalleS / 60)} minutes` : `${c.intervalleS} secondes`}`}` : ' · reçoit en direct'}` }),
        c.entree ? h('div', { class: 'bz-pile' }, h('p', { class: 'bz-t-petit', texte: 'Adresse d’entrée (Make, Zapier, n8n) :' }), blocCode(`${location.origin}${c.entree}`, 'Copier l’adresse')) : null,
        c.historique.length ? h('ul', { class: 'bz-liste-simple bz-t-petit', 'aria-label': 'Derniers échanges' }, c.historique.slice(0, 4).map((x) => h('li', {}, icone(x.sens === 'entrant' ? 'arrow-down' : 'arrow-up', { taille: 'sm', libelle: x.sens === 'entrant' ? 'Reçu' : 'Envoyé' }), ` ${dateHeure(x.le)} · ${x.detail}`))) : null,
        h('div', { class: 'bz-groupe-boutons' },
          s?.lecture === 'appel' || c.sens !== 'lecture' ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: async (e) => { e.currentTarget.setAttribute('aria-busy', 'true'); try { await api('POST', `/synchro/${c.id}/maintenant`); informer('Synchronisation faite.', 'ok'); } catch (err) { informer(err.message, 'erreur'); } rendreOutils(); } }, icone('refresh-cw'), 'Synchroniser maintenant') : null,
          c.oauth && s?.oauth ? h('button', { type: 'button', class: `bz-bouton ${c.statut === 'erreur' ? 'bz-bouton--principal' : 'bz-bouton--secondaire'}`, onclick: () => seReconnecter(c, s, () => rendreOutils()) }, icone('log-in'), 'Se reconnecter') : null,
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: async () => { await api('PUT', `/synchro/${c.id}`, { actif: !c.actif }); rendreOutils(); } }, icone(c.actif ? 'pause' : 'play'), c.actif ? 'Mettre en pause' : 'Réactiver'),
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--critique', onclick: async () => {
            if (!(await confirmerDialogue({ titre: `Débrancher ${c.nom} ?`, texte: 'La synchronisation s’arrête et la clé enregistrée est effacée ; l’accès est révoqué chez l’outil quand c’est possible. Les fiches déjà importées restent sur votre carte.', confirmer: 'Déconnecter', annuler: 'Garder', danger: true }))) return;
            try {
              const r = await api('DELETE', `/synchro/${c.id}`);
              if (r.acces === 'revoque') informer(`${c.nom} débranché : accès révoqué chez ${r.outil}.`, 'ok');
              else if (r.acces === 'garde') informer(`${c.nom} débranché. L’accès de Living Business chez ${r.outil} est gardé : un autre branchement s’en sert encore.`, 'ok');
              else if (r.acces === 'a_retirer') informer(`${c.nom} débranché. Retirez aussi l’accès de Living Business chez ${r.outil} (applications connectées ou clés d’API) : il n’a pas pu être révoqué d’ici.`, 'attention');
              else informer(`${c.nom} débranché.`, 'ok');
            } catch (err) { if (!err.session) informer(err.message, 'erreur'); }
            rendreOutils();
          } }, icone('unlink'), 'Déconnecter'))));
    })) : blocVide({ titre: 'Aucun logiciel connecté pour le moment.', compact: true, actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => ouvrirAssistant() }, 'Connecter mes données') }),
    h('section', { class: 'bz-catalogue', 'aria-labelledby': 'titre-connecter-logiciel' },
      h('h3', { class: 'bz-t-titre-4', id: 'titre-connecter-logiciel', texte: 'Connecter un logiciel' }),
      listeOutils(sources)),
  ));
}

// ---- logiciel synchronisé : se connecter, associer les colonnes, activer (même assistant)
/* « Se connecter avec… » d'abord (la personne se connecte chez le logiciel avec son compte ; aucune clé à copier), puis
   les derniers choix lus dans le logiciel (base, table, classeur…). Clés, jetons, script, identifiants d'annuaire et
   d'application : « Mode avancé : pour votre informaticien ». Le navigateur ne reçoit jamais de jeton. */
const secretScript = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
const nomOutilDe = (C) => C.s.oauth?.nom ?? C.s.nom;
/** Redessine l'assistant seulement s'il montre encore ce logiciel. */
const majOutil = (C) => { if (!C.ferme && E.assistant?.outil === C) rendreAssistant(); };

function demarrerOutil(A, s) {
  if (A.outil && A.outil.s.id !== s.id) nettoyerOutil(A.outil);
  if (!A.outil || A.outil.s.id !== s.id) {
    const cibles = ciblesImport();
    A.outil = { s, mode: s.oauth ? 'oauth' : 'cle', oauth: null, annulerOAuth: null, choix: {}, config: {}, cible: A.cible ?? cibles[0], sens: 'lecture',
      intervalle: ['sheets', 'excel365'].includes(s.id) ? 300 : 120, nom: s.nom, apercu: null, mapping: {}, cree: null, outils: null, connexion: null, ferme: false };
    if (s.id === 'sheets' && A.outil.mode === 'cle') A.outil.config.jeton = secretScript();
  }
  A.outil.ferme = false;
  A.parcours = 'outil';
  allerEtape('connexion');
}
function arreterOAuth(C) { C.annulerOAuth?.(); C.annulerOAuth = null; }
/** Connexion obtenue mais pas (encore) utilisée : le serveur l'oublie tout de suite. */
function oublierConnexion(C) {
  const ref = /^oauth:([A-Za-z0-9_-]{22})$/.exec(C.config.jeton ?? '');
  if (ref && !C.cree) api('DELETE', `/synchro/oauth/${ref[1]}`).catch(() => {});
}
function nettoyerOutil(C) { C.ferme = true; arreterOAuth(C); oublierConnexion(C); C.connexion = null; }
/** Champs dont les valeurs se lisent dans le logiciel connecté (base puis table Airtable, base de données Notion…). */
const listesOutil = (C) => C.s.champs.filter((ch) => ch.liste && ch.mode !== 'cle');
async function chargerChoix(C, ch) {
  C.choix[ch.id] = { chargement: true, options: [], erreur: null };
  majOutil(C);
  try {
    const r = await api('POST', '/synchro/choix', { source: C.s.id, champ: ch.id, config: C.config });
    if (C.ferme) return;
    C.choix[ch.id] = { chargement: false, options: r.options, erreur: null };
    if (r.options.length === 1 && !C.config[ch.id]) { C.config[ch.id] = r.options[0].valeur; suiteChoix(C, ch); }
  } catch (e) { C.choix[ch.id] = { chargement: false, options: [], erreur: e.message }; }
  majOutil(C);
}
/** Après un choix, la liste qui en dépend (tables de la base choisie) est relue. */
function suiteChoix(C, ch) {
  const l = listesOutil(C);
  const suivante = l[l.findIndex((x) => x.id === ch.id) + 1];
  if (!suivante) return;
  delete C.config[suivante.id];
  delete C.choix[suivante.id];
  if (C.config[ch.id]) chargerChoix(C, suivante);
}
/** « Se connecter avec X » : appelé directement par le clic (l'onglet du logiciel s'ouvre sans être bloqué). */
function seConnecterOutil(C) {
  const A = E.assistant;
  const s = C.s;
  A.erreur = null;
  arreterOAuth(C);
  const config = {};
  if (s.oauth.champ) {
    const v = (C.config[s.oauth.champ] ?? '').trim();
    if (!v) { A.erreur = s.id === 'shopify' ? 'Indiquez d’abord l’adresse de la boutique (….myshopify.com).' : 'Indiquez d’abord l’adresse du site (https://…).'; majOutil(C); $(`#outil-${s.oauth.champ}`)?.focus(); return; }
    config[s.oauth.champ] = v;
  }
  oublierConnexion(C);
  delete C.config.jeton;
  C.droits = C.sens === 'lecture' ? 'lecture' : 'ecriture';
  C.annulerOAuth = connecterOAuth(s.id, config, (r) => {
    if (C.ferme) return;
    if (r.statut === 'attente') C.oauth = { statut: 'attente', url: r.url, ouvert: r.ouvert, verification: r.verification };
    else if (r.statut === 'connecte') {
      C.annulerOAuth = null;
      C.oauth = { statut: 'connecte', compte: r.compte };
      C.config.jeton = r.jeton; // référence « oauth:… » : le jeton reste sur le serveur
      C.choix = {};
      const premiere = listesOutil(C)[0];
      if (premiere) chargerChoix(C, premiere);
      annoncer(`Connecté à ${nomOutilDe(C)}.`);
    } else if (r.code === 'oauth_indisponible') {
      // outil pas encore ouvert sur le relais : la clé (mode avancé) reste possible, sans l'éditeur
      C.annulerOAuth = null; s.oauth = null;
      modeCle(C);
      informer(`« Se connecter avec ${s.nom} » n’est pas disponible pour le moment : branchez-le avec une clé créée dans ${s.nom}, sans passer par l’éditeur.`);
      return;
    } else { C.annulerOAuth = null; C.oauth = null; if (E.assistant) E.assistant.erreur = r.message; }
    majOutil(C);
  }, C.droits);
  C.oauth = { statut: 'ouverture' };
  majOutil(C);
}
function modeCle(C) {
  arreterOAuth(C); oublierConnexion(C);
  Object.assign(C, { mode: 'cle', oauth: null, choix: {} });
  delete C.config.jeton;
  if (C.s.id === 'sheets') C.config.jeton = secretScript();
  if (E.assistant) E.assistant.erreur = null;
  majOutil(C);
  annoncer('Mode avancé : connexion avec une clé.');
}
function modeOAuth(C) {
  Object.assign(C, { mode: 'oauth', connexion: null });
  delete C.config.jeton;
  if (E.assistant) E.assistant.erreur = null;
  majOutil(C);
}
/** Mode avancé de Microsoft 365 : code d'appareil, la personne se connecte sur la page Microsoft avec son compte. */
async function connecterMicrosoft(C) {
  const A = E.assistant;
  A.erreur = null; C.envoi = true; majOutil(C);
  try {
    const d = await api('POST', '/synchro/microsoft/connexion', { config: C.config });
    C.connexion = { ...d, statut: 'attente' };
    C.envoi = false; majOutil(C);
    const fin = Date.now() + d.expireDans * 1000;
    while (!C.ferme && C.connexion?.id === d.id && Date.now() < fin) {
      await new Promise((ok) => setTimeout(ok, Math.max(2, d.intervalle) * 1000));
      if (C.ferme || C.connexion?.id !== d.id) return;
      const r = await api('POST', `/synchro/microsoft/connexion/${d.id}`);
      if (r.statut === 'attente') continue;
      if (r.statut === 'connecte') { C.config.jeton = r.jeton; C.connexion = { ...C.connexion, statut: 'connecte' }; annoncer('Connecté à Microsoft.'); }
      else { C.connexion = null; if (E.assistant) E.assistant.erreur = r.message; }
      majOutil(C);
      return;
    }
    if (!C.ferme && C.connexion?.statut === 'attente') { C.connexion = null; if (E.assistant) E.assistant.erreur = 'Le code a expiré : relancez la connexion.'; majOutil(C); }
  } catch (e) { C.envoi = false; C.connexion = null; if (!e.session && E.assistant) E.assistant.erreur = e.message; majOutil(C); }
}

function champOutil(C, ch) {
  const nomOutil = nomOutilDe(C);
  const id = `outil-${ch.id}`;
  const choix = C.mode === 'oauth' && ch.liste ? C.choix[ch.id] : null;
  const large = ch.secret || ['url', 'lien', 'script', 'fichier', 'classeur'].includes(ch.id);
  const aide = choix?.erreur ? `Liste indisponible (${choix.erreur}) : saisissez-le.`
    : choix && !choix.chargement && !choix.options.length ? `Rien trouvé dans ${nomOutil} : saisissez-le, ou reconnectez-vous en l’autorisant.` : ch.aide;
  const erreur = C.erreurs?.[ch.id] ?? null;
  const decrit = [aide ? `${id}-aide` : null, erreur ? `${id}-erreur` : null].filter(Boolean).join(' ') || null;
  const invalide = erreur ? 'true' : null;
  const liste = (options, attrs = {}) => h('div', { class: 'bz-select' }, h('select', { id, 'aria-describedby': decrit, 'aria-required': ch.obligatoire ? 'true' : null, 'aria-invalid': invalide, ...attrs }, options), icone('chevron-down'));
  let saisie;
  // valeurs techniques (« companies ») affichées en français (« Entreprises ») ; la valeur envoyée ne change pas
  if (ch.choix) saisie = liste([h('option', { value: '', texte: 'Choisir…' }), ...(ch.options ?? ch.choix.map((x) => ({ valeur: x, libelle: x }))).map((x) => h('option', { value: x.valeur, selected: C.config[ch.id] === x.valeur, texte: x.libelle }))], { onchange: (e) => (C.config[ch.id] = e.target.value) });
  else if (choix?.chargement) saisie = liste([h('option', { texte: `Lecture dans ${nomOutil}…` })], { disabled: true });
  else if (choix?.options.length) saisie = liste([h('option', { value: '', texte: 'Choisir…' }), ...choix.options.map((o) => h('option', { value: o.valeur, selected: C.config[ch.id] === o.valeur, texte: o.libelle }))], { onchange: (e) => { C.config[ch.id] = e.target.value; suiteChoix(C, ch); majOutil(C); } });
  else if (ch.id === 'outilLecture' && C.outils) saisie = liste([h('option', { value: '', texte: 'Choisir…' }), ...C.outils.map((o) => h('option', { value: o.nom, selected: C.config[ch.id] === o.nom, texte: `${o.nom}${o.description ? ` · ${o.description.slice(0, 60)}` : ''}` }))], { onchange: (e) => (C.config[ch.id] = e.target.value) });
  else saisie = h('input', { id, class: 'bz-champ__saisie', type: ch.secret ? 'password' : 'text', autocomplete: 'off', spellcheck: 'false', placeholder: ch.exemple ?? '', value: C.config[ch.id] ?? '',
    'data-brut': ch.exemple ? '' : null, 'aria-describedby': decrit, 'aria-required': ch.obligatoire ? 'true' : null, 'aria-invalid': invalide, oninput: (e) => (C.config[ch.id] = e.target.value) });
  return h('div', { class: `bz-champ${large ? ' bz-champ--large' : ''}` },
    h('label', { class: 'bz-champ__libelle', for: id, texte: ch.libelle }), aide ? h('span', { class: 'bz-champ__aide', id: `${id}-aide`, texte: aide }) : null, saisie,
    erreur ? h('p', { class: 'bz-champ__erreur', id: `${id}-erreur` }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: erreur })) : null);
}
/** Champs obligatoires de l'étape « Se connecter » encore vides : vérifiés AVANT tout appel au serveur (§4.6). */
function erreursOutil(C) {
  const s = C.s;
  const visibles = C.mode === 'oauth' && s.oauth
    ? s.champs.filter((ch) => !ch.secret && ch.mode !== 'cle' && ch.id !== s.oauth.champ)
    : s.champs.filter((ch) => ch.mode !== 'oauth' && !ch.connexion && !(s.id === 'sheets' && ch.id === 'jeton'));
  const erreurs = {};
  for (const ch of visibles) {
    if (!ch.obligatoire || String(C.config[ch.id] ?? '').trim()) continue;
    erreurs[ch.id] = ch.choix || ch.liste ? `${ch.libelle} : choisissez une valeur.` : `${ch.libelle} : à renseigner.`;
  }
  return Object.keys(erreurs).length ? erreurs : null;
}
function champListe(id, libelle, valeur, options, onchange, { large = false } = {}) {
  return h('div', { class: `bz-champ${large ? ' bz-champ--large' : ''}` }, h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }),
    h('div', { class: 'bz-select' }, h('select', { id, onchange }, options.map(([v, l]) => h('option', { value: String(v), selected: String(valeur) === String(v), texte: l }))), icone('chevron-down')));
}
/** « Ce que contient l'outil » : au-delà de 15 choix, une liste filtrable remplace le <select> (§4.6). */
function selectCible(C) {
  const cibles = ciblesImport();
  const choisir = (cle) => { C.cible = cibles.find((x) => x.cle === cle) ?? C.cible; };
  if (cibles.length <= 15) return champListe('outil-cible', `Ce que contient ${C.s.nom}`, C.cible.cle, cibles.map((c) => [c.cle, c.libelle]), (e) => choisir(e.target.value));
  return h('div', { class: 'bz-champ' },
    h('label', { class: 'bz-champ__libelle', for: 'outil-cible', texte: `Ce que contient ${C.s.nom}` }),
    h('span', { class: 'bz-champ__aide', id: 'outil-cible-aide', texte: 'Tapez quelques lettres pour trouver le bon choix.' }),
    comboFiltrable({ id: 'outil-cible', decrit: 'outil-cible-aide', valeur: C.cible.cle, options: cibles.map((c) => ({ valeur: c.cle, libelle: c.libelle, detail: c.sous || null })), onchange: choisir, annoncer }));
}
function reglagesSynchro(C, { sens = true } = {}) {
  return [
    sens && C.s.ecriture ? champListe('outil-sens', 'Sens de la synchronisation', C.sens, Object.entries(LIBELLE_SENS), (e) => (C.sens = e.target.value)) : null,
    C.s.lecture === 'appel' ? champListe('outil-intervalle', 'Vérifier les changements toutes les', C.intervalle, [[30, '30 secondes'], [60, '1 minute'], [120, '2 minutes'], [300, '5 minutes'], [900, '15 minutes'], [3600, '1 heure']], (e) => (C.intervalle = Number(e.target.value))) : null,
  ];
}
function blocConnexionMicrosoft(C, ch) {
  const x = C.connexion;
  return h('div', { class: 'bz-champ bz-champ--large' },
    h('span', { class: 'bz-champ__libelle', texte: ch.libelle }),
    x?.statut === 'connecte' ? resultatAssistant('ok', 'Connecté à Microsoft.', { detail: 'Testez la connexion pour continuer.' })
      : x ? resultatAssistant('attente', 'Connectez-vous sur la page Microsoft.', { actions: h('ol', { class: 'bz-liste-simple' },
        h('li', {}, 'Ouvrez ', h('a', { href: x.url, target: '_blank', rel: 'noopener noreferrer', 'data-brut': '', texte: x.url.replace(/^https:\/\//, '') }), ' (sur n’importe quel appareil).'),
        h('li', {}, 'Saisissez ce code : ', h('strong', { class: 'bz-t-code', 'data-brut': '', texte: x.code }), ' ', h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => copier(x.code) }, icone('copy', { taille: 'sm' }), 'Copier')),
        h('li', { texte: 'Connectez-vous avec votre compte Microsoft et acceptez. Cette fenêtre se met à jour toute seule.' })) })
      : h('div', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', 'aria-busy': C.envoi ? 'true' : null, onclick: () => { if (!C.envoi) connecterMicrosoft(C); } }, C.envoi ? icone('loader-circle') : icone('log-in'), C.envoi ? 'Connexion…' : 'Se connecter à Microsoft')),
    ch.aide ? h('span', { class: 'bz-champ__aide', texte: ch.aide }) : null);
}
async function listerOutilsMcp(C) {
  const A = E.assistant;
  if (C.envoi) return;
  C.envoi = true; A.erreur = null; majOutil(C);
  try { C.outils = await api('POST', '/synchro/outils-mcp', { config: C.config }); annoncer(pluriel(C.outils.length, 'outil trouvé', 'outils trouvés')); } catch (e) { if (!e.session) A.erreur = e.message; }
  C.envoi = false; majOutil(C);
}
/**
 * Information avant « Se connecter avec… » (art. 13 RGPD) : ce qui passe par le serveur de l'éditeur, combien de
 * temps, et l'autre voie (clé, sans l'éditeur). Même texte que Réglages › Confidentialité.
 */
function infoRelais(nomOutil) {
  return h('details', { class: 'bz-repli' },
    h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Ce qui passe par le serveur de l’éditeur' }), icone('chevron-down', { taille: 'sm' })),
    h('div', { class: 'bz-repli__corps bz-pile bz-pile--serre' },
      h('p', { class: 'bz-t-petit', texte: `${nomOutil} n’accepte que des logiciels déclarés chez lui : la connexion passe donc par le relais de l’éditeur de Living Business (Breizhcosystem), sans compte Breizhcosystem.` }),
      h('ul', { class: 'bz-liste-simple bz-t-petit', role: 'list' },
        h('li', { texte: `Ce qui y passe : les jetons d’accès que ${nomOutil} remet (et l’adresse de la boutique ou de l’organisation s’il y en a une), l’adresse de ce Living Business et votre adresse IP.` }),
        h('li', { texte: 'Combien de temps : 10 minutes au plus, en mémoire, le temps de vous les remettre ; puis à chaque renouvellement du jeton (environ toutes les heures pendant les synchronisations). Rien n’y est enregistré.' }),
        h('li', { texte: `Vos données (fiches, contacts, fichiers) ne passent jamais par l’éditeur : elles vont directement de ${nomOutil} à Living Business.` }),
        h('li', { texte: `Sans le relais : « Mode avancé », avec une clé créée dans ${nomOutil}.` }))));
}
function corpsConnexion(C) {
  const s = C.s;
  const nomOutil = nomOutilDe(C);
  if (C.mode === 'oauth' && s.oauth) {
    const connecte = C.oauth?.statut === 'connecte';
    const param = s.oauth.champ ? s.champs.find((ch) => ch.id === s.oauth.champ) : null;
    return [
      h('div', { class: 'bz-grille-champs' }, selectCible(C), !connecte && param ? champOutil(C, param) : null),
      !C.oauth ? h('div', { class: 'bz-pile' },
        // le sens se choisit AVANT : Living Business ne demande à l'outil que le droit de lire, sauf synchro qui écrit
        s.ecriture ? h('div', { class: 'bz-grille-champs' }, champListe('outil-sens', 'Sens de la synchronisation', C.sens, Object.entries(LIBELLE_SENS), (e) => { C.sens = e.target.value; majOutil(C); })) : null,
        s.ecriture ? h('p', { class: 'bz-t-petit bz-texte-2', texte: C.sens === 'lecture' ? `${nomOutil} ne donnera que le droit de lire : rien ne sera modifié chez ${nomOutil}.` : `${nomOutil} donnera aussi le droit d’écrire : les fiches créées ou modifiées dans Living Business y seront reportées.` }) : null,
        h('div', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--lg', cle: 'outil-oauth', onclick: () => seConnecterOutil(C) }, icone('log-in'), `Se connecter avec ${nomOutil}`)),
        h('p', { class: 'bz-t-petit', texte: `Une page ${nomOutil} s’ouvre dans un nouvel onglet : connectez-vous avec votre compte et acceptez. Votre mot de passe reste chez ${nomOutil}, aucune clé à copier.` }),
        infoRelais(nomOutil))
        : !connecte ? h('div', { role: 'status' }, resultatAssistant('attente', C.oauth.statut === 'ouverture' ? `Ouverture de la page ${nomOutil}…` : 'Connectez-vous dans l’onglet qui vient de s’ouvrir.', {
          detail: C.oauth.verification ? 'Avant d’accepter, Breizhcosystem vous montre le code de la demande : il doit être identique à celui-ci. Sinon, refusez : quelqu’un d’autre a lancé cette connexion. Cette fenêtre se met à jour toute seule ensuite.' : 'Cette fenêtre se met à jour toute seule dès que vous avez accepté.',
          actions: h('div', { class: 'bz-pile' }, C.oauth.verification ? h('p', { class: 'bz-code-secours bz-t-identifiant', 'data-brut': '', 'aria-label': `Code de la demande : ${C.oauth.verification.split('').join(' ')}`, texte: C.oauth.verification }) : null, h('div', { class: 'bz-groupe-boutons' },
            C.oauth.url ? h('a', { class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', href: C.oauth.url, target: '_blank', rel: 'noopener noreferrer' }, C.oauth.ouvert ? 'Rouvrir la page' : `Ouvrir la page ${nomOutil}`, icone('external-link', { taille: 'sm' })) : null,
            h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: () => { arreterOAuth(C); C.oauth = null; majOutil(C); } }, 'Annuler la connexion'))) }))
        : resultatAssistant('ok', `Connecté à ${nomOutil}${C.oauth.compte ? ` · ${C.oauth.compte}` : ''}.`, {
          actions: h('div', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => seConnecterOutil(C) }, 'Changer de compte')) }),
      connecte ? h('div', { class: 'bz-grille-champs' }, s.champs.filter((ch) => !ch.secret && ch.mode !== 'cle' && ch.id !== s.oauth.champ).map((ch) => champOutil(C, ch)), reglagesSynchro(C, { sens: false })) : null,
      connecte && s.ecriture ? h('p', { class: 'bz-t-petit' }, `Sens : ${LIBELLE_SENS[C.sens] ?? C.sens}, choisi avant la connexion. `,
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => { arreterOAuth(C); oublierConnexion(C); delete C.config.jeton; C.oauth = null; majOutil(C); } }, 'Changer de sens (nouvelle connexion)')) : null,
      connecte ? h('p', { class: 'bz-t-petit', texte: `La connexion est chiffrée sur cet ordinateur et n’est jamais affichée. Vos données vont directement de ${nomOutil} à Living Business, sans passer par Breizhcosystem ; seuls les jetons de connexion y passent, à la connexion et à chaque renouvellement.` }) : null,
      h('div', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: () => modeCle(C) }, icone('code-xml'), 'Mode avancé : pour votre informaticien')),
    ];
  }
  // Parcours par clé : le jargon de l'outil (droits, noms internes, « API V2 ») reste dans les replis « pour votre
  // informaticien » ; l'écran principal ne demande que le choix des fiches et la clé (P4, annexe B).
  const champsCle = s.champs.filter((ch) => ch.mode !== 'oauth' && !(s.id === 'sheets' && ch.id === 'jeton'));
  const champ = (ch) => (ch.connexion ? blocConnexionMicrosoft(C, ch) : champOutil(C, ch));
  const avances = champsCle.filter((ch) => ch.avance);
  return [
    s.oauth
      ? h('div', { class: 'bz-pile' }, h('p', { class: 'bz-t-surtitre', texte: 'Mode avancé : pour votre informaticien' }),
        h('div', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien', onclick: () => modeOAuth(C) }, `Revenir à « Se connecter avec ${nomOutil} », plus simple`)))
      : s.avance ? h('p', { class: 'bz-t-surtitre', texte: 'Mode avancé : pour votre informaticien' })
      : h('p', { texte: `${s.nom} se branche avec une clé d’accès créée dans ${s.nom}. Votre informaticien peut s’en charger : la marche à suivre est juste en dessous.` }),
    !s.oauth && s.oauthPossible ? resultatAssistant('info', `Bientôt en un clic : « Se connecter avec ${s.nom} »`, { detail: `Ce bouton apparaîtra quand l’éditeur l’aura ouvert pour ${s.nom}, l’adresse de Breizhcosystem étant réglée (Réglages › Breizhcosystem, sans compte Breizhcosystem) : vous vous connecterez avec votre compte ${s.nom}, sans clé à copier.` }) : null,
    s.avance ? h('ol', { class: 'bz-consignes' }, s.etapes.map((e) => h('li', { texte: e })))
      : h('details', { class: 'bz-repli' },
        h('summary', {}, h('span', { class: 'bz-repli__titre', texte: `Où trouver la clé d’accès ${s.nom} ? (pour votre informaticien)` }), icone('chevron-down', { taille: 'sm' })),
        h('ol', { class: 'bz-repli__corps bz-consignes' }, s.etapes.map((e) => h('li', { texte: e })))),
    h('div', { class: 'bz-grille-champs' },
      selectCible(C),
      champsCle.filter((ch) => !ch.avance).map(champ),
      reglagesSynchro(C)),
    avances.length ? h('details', { class: 'bz-repli' },
      h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Réglages facultatifs (pour votre informaticien)' }), icone('chevron-down', { taille: 'sm' })),
      h('div', { class: 'bz-repli__corps bz-grille-champs' }, avances.map(champ))) : null,
    s.script ? h('details', { class: 'bz-repli', open: true },
      h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Script à coller dans votre feuille (votre secret est déjà dedans)' }), icone('chevron-down', { taille: 'sm' })),
      h('div', { class: 'bz-repli__corps' }, blocCode(s.script.replace('COLLEZ_ICI_LE_SECRET_AFFICHE_DANS_LIVING_BUSINESS', C.config.jeton ?? ''), 'Copier le script'))) : null,
    h('p', { class: 'bz-t-petit', texte: s.id === 'excel365' ? 'Aucun mot de passe ne passe par Living Business : la connexion se fait sur la page Microsoft, et elle est chiffrée sur cet ordinateur.' : 'La clé est chiffrée sur cet ordinateur et ne sera plus jamais affichée.' }),
    s.id === 'mcp' ? h('div', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', 'aria-busy': C.envoi ? 'true' : null, onclick: () => listerOutilsMcp(C) }, C.envoi ? icone('loader-circle') : icone('list'), 'Lister les outils du serveur')) : null,
  ];
}
/** Action principale de l'étape « Se connecter » : tester (mode avancé), ou continuer une fois connecté. */
function piedConnexion(C) {
  const A = E.assistant;
  const pret = C.mode === 'cle' || !C.s.oauth || C.oauth?.statut === 'connecte';
  if (!pret) return null;
  return boutonPrincipal(C.s.lecture === 'reception' ? 'Continuer' : C.mode === 'cle' ? 'Tester la connexion' : 'Continuer', () => testerOutil(C), { occupe: A.envoi, enCours: 'Connexion…' });
}
async function testerOutil(C) {
  const A = E.assistant;
  if (!A || A.envoi) return;
  A.erreur = null;
  C.erreurs = erreursOutil(C);
  if (C.erreurs) { A.focusErreur = true; majOutil(C); return; } // rien ne part au serveur : l'erreur se corrige ici
  A.envoi = true; majOutil(C);
  try {
    C.apercu = await api('POST', '/synchro/apercu', { source: C.s.id, config: C.config, typeObjet: C.cible.type });
    C.mapping = { ...C.apercu.mapping };
    A.etape = 'colonnes';
  } catch (e) {
    if (!e.session) {
      const champ = /^reglage_invalide:(.+)$/.exec(e.code ?? '')?.[1];
      if (champ && C.s.champs.some((ch) => ch.id === champ)) C.erreurs = { [champ]: e.message };
      else A.erreur = e.message;
      A.focusErreur = true;
    }
  }
  A.envoi = false; majOutil(C);
}
function corpsColonnesOutil(C) {
  const a = C.apercu;
  return [
    a.message ? resultatAssistant('info', a.message) : resultatAssistant('ok', `Connexion réussie : ${pluriel(a.enregistrements, 'fiche trouvée', 'fiches trouvées')}.`, { detail: 'Vérifiez les colonnes associées, puis activez la synchronisation.' }),
    // ce que l'outil précise sur ce qui est lu (ex. lequel des tableaux d'une base Notion qui en contient plusieurs)
    a.precision ? resultatAssistant('info', a.precision) : null,
    a.champs.length ? listeColonnes(a.champs, a.cibles, C.mapping, (ch) => a.apercu.map((l) => l[ch]).filter(Boolean).slice(0, 3).join(' · ').slice(0, 120))
      : h('p', { class: 'bz-t-petit', texte: 'Les colonnes seront associées automatiquement à la première réception.' }),
    h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'outil-nom', texte: 'Nom de cette connexion' }),
      h('input', { id: 'outil-nom', class: 'bz-champ__saisie', type: 'text', maxlength: '80', autocomplete: 'off', value: C.nom, oninput: (e) => (C.nom = e.target.value) })),
  ];
}
async function activerOutil(C) {
  const A = E.assistant;
  if (!A || A.envoi) return;
  A.envoi = true; A.erreur = null; majOutil(C);
  try {
    C.cree = await api('POST', '/synchro', { source: C.s.id, nom: C.nom, config: C.config, typeObjet: C.cible.type, roles: C.cible.roles ?? [], mapping: C.mapping, sens: C.sens, intervalleS: C.intervalle });
    if (C.s.lecture === 'appel') await api('POST', `/synchro/${C.cree.id}/maintenant`).catch(() => {});
    A.etape = 'pret';
    await charger();
  } catch (e) { if (!e.session) A.erreur = e.message; }
  A.envoi = false; majOutil(C);
}
function corpsPretOutil(C) {
  const c = C.cree;
  const exemple = JSON.stringify({ enregistrements: [{ id: 'CRM-001', Nom: 'Exemple SARL', Ville: 'Brest', Email: 'contact@exemple.fr' }] }, null, 2);
  return [
    resultatAssistant('ok', `${c.nom} est connecté.`, { detail: C.s.lecture === 'appel' ? 'Première synchronisation lancée : vos fiches arrivent sur la carte.' : 'Il attend vos envois.' }),
    c.entree ? [
      h('h4', { class: 'bz-catalogue__intertitre', texte: 'À coller dans Make, Zapier ou n8n' }),
      h('p', { class: 'bz-t-petit', texte: 'Adresse (méthode POST)' }), blocCode(`${location.origin}${c.entree}`, 'Copier l’adresse'),
      resultatAssistant('attention', 'Ces secrets ne seront plus affichés : copiez-les maintenant.', { detail: 'L’en-tête ci-dessous autorise vos envois vers Living Business. Signature possible à la place : X-LB-Signature: t=<secondes>,v1=<HMAC-SHA256 de « t.corps » avec ce secret>, valable 5 minutes et une seule fois.' }),
      blocCode(`Authorization: Bearer ${c.secretEntrant}`, 'Copier l’en-tête'),
      c.cleEnvois ? [
        h('p', { class: 'bz-t-petit', texte: 'Clé de vérification des envois de Living Business (facultatif) : ils portent l’en-tête X-LB-Signature, signé avec cette autre clé. Elle ne permet pas d’envoyer au jeu.' }),
        blocCode(c.cleEnvois, 'Copier la clé de vérification'),
      ] : null,
      h('h4', { class: 'bz-catalogue__intertitre', texte: 'Corps JSON attendu' }), blocCode(exemple, 'Copier l’exemple'),
      blocCode(`curl -X POST ${location.origin}${c.entree} \\\n  -H "Authorization: Bearer ${c.secretEntrant}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(JSON.parse(exemple))}'`, 'Copier la commande de test'),
    ] : null,
  ];
}

/** Liste des logiciels synchronisés (Réglages, « Compléter mon entreprise ») : mêmes cartes que l'assistant. */
function listeOutils(sources) {
  const cat = CONNECTER_PRET() ? CONNECTER.catalogue(sources, [], { pasAPas: false }) : sources.map((s) => ({ cle: `outil:${s.id}`, genre: 'outil', id: s.id, nom: s.nom, description: s.description, icone: 'plug', unClic: Boolean(s.oauth), avance: Boolean(s.avance), bientot: false }));
  const ouvrir = (x) => ouvrirConnecteur(x.id);
  const simples = cat.filter((x) => !x.avance);
  const avances = cat.filter((x) => x.avance);
  return [
    simples.length ? h('ul', { class: 'bz-logiciels', role: 'list' }, simples.map((x) => h('li', {}, carteLogiciel(x, { faire: ouvrir })))) : null,
    avances.length ? h('details', { class: 'bz-repli' },
      h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Mode avancé : pour votre informaticien' }), h('span', { class: 'bz-repli__note', texte: 'serveur MCP, webhook, API' }), icone('chevron-down', { taille: 'sm' })),
      h('div', { class: 'bz-repli__corps' }, h('ul', { class: 'bz-logiciels', role: 'list' }, avances.map((x) => h('li', {}, carteLogiciel(x, { faire: ouvrir })))))) : null,
  ];
}
const CONNECTER_PRET = () => Boolean(CONNECTER);

/* Apparence et accessibilité (direction de design §3.1) : préférences de CET appareil, effet immédiat, sans bouton
   « Enregistrer ». Posées sur <html> par /bz/theme.js (data-theme, data-contraste, data-texte, data-mouvement…) ;
   le mode Calme (§4.25) par app.js (data-calme). */
function contenuApparence({ titre = true } = {}) {
  const T = window.bzTheme;
  if (!T) return [h('p', { class: 'bz-t-petit', texte: 'Réglages d’apparence indisponibles sur ce navigateur.' })];
  const p = T.lire();
  const maj = () => { const n = $('#bloc-apparence'); if (n) remplir(n, contenuApparence({ titre })); };
  const groupe = (id, libelle, choix, actuel, regler) => h('div', { class: 'bz-champ' },
    h('span', { class: 'bz-champ__libelle', id, texte: libelle }),
    h('div', { class: 'bz-segments', role: 'group', 'aria-labelledby': id },
      choix.map(([v, l]) => h('button', { type: 'button', cle: `${id}-${v ?? 'defaut'}`, 'aria-pressed': actuel === v, onclick: () => { regler(v); maj(); }, texte: l }))));
  const bascule = (k, libelle, aide, actif, regler) => interrupteurReglage({ cle: k, titre: libelle, aide, actif, regler: (v) => { regler(v); maj(); } });
  return [
    titre ? h('h2', { class: 'bz-t-titre-4', texte: 'Apparence et accessibilité' }) : null,
    h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Réglages de cet appareil seulement. Ils s’appliquent tout de suite.' }),
    groupe('apparence-theme', 'Thème', [['systeme', 'Système'], ['clair', 'Clair'], ['sombre', 'Sombre']], p.theme, (v) => T.regler('theme', v)),
    groupe('apparence-ouvrir', 'Ouvrir sur', [['carte', 'La carte'], ['liste', 'Aujourd’hui en liste']], ouvrirSurListe() ? 'liste' : 'carte', (v) => {
      ecrireLocal('lb-ouvrir-sur', v);
      if (E.monde && $('#coque') && (E.vue === 'carte' || E.vue === 'matin')) changerVue(vueAujourdhui());
    }),
    bascule('apparence-soleil', 'Plein soleil', 'Contraste élevé et panneaux opaques, pour lire dehors à pleine luminosité.', p.pleinSoleil, (v) => T.pleinSoleil(v)),
    bascule('apparence-contraste', 'Contraste élevé', null, p.contraste === 'eleve', (v) => T.regler('contraste', v ? 'eleve' : null)),
    groupe('apparence-texte', 'Taille du texte', [[undefined, 'Normale'], ['grand', 'Grande'], ['tres-grand', 'Très grande']], p.texte, (v) => T.regler('texte', v ?? null)),
    bascule('apparence-mouvement', 'Réduire les animations', null, p.mouvement === 'reduit', (v) => T.regler('mouvement', v ? 'reduit' : null)),
    bascule('apparence-police', 'Police haute lisibilité', 'Atkinson Hyperlegible Next : lettres plus faciles à distinguer.', p.police === 'lisible', (v) => T.regler('police', v ? 'lisible' : null)),
    bascule('apparence-calme', 'Mode Calme', 'Masque l’XP, les quêtes et les célébrations, pour un outil sobre. Le travail reste compté.', modeCalme(), (v) => reglerCalme(v)),
    bascule('apparence-raccourcis', 'Raccourcis à une touche', 'Touches seules (/, ?, G puis une lettre, touches de la carte). ⌘K et Échap restent actifs.', p.raccourcis !== false, (v) => T.regler('raccourcis', v)),
  ];
}
/** Réglages › Carte (§5.3, §5.8, §5.10) : qualité, heure de la carte, animations. Réglages de cet appareil. */
function blocCarte() {
  const maj = () => { const n = $('#bloc-carte'); if (n) remplir(n, contenuCarte(maj)); };
  return h('div', { class: 'bz-pile', id: 'bloc-carte' }, contenuCarte(maj));
}
function contenuCarte(maj = () => { const n = $('#bloc-carte'); if (n) remplir(n, contenuCarte()); }) {
  const groupe = (id, titre, aide, choix, actuel, regler) => h('div', { class: 'bz-champ' },
    h('span', { class: 'bz-champ__libelle', id, texte: titre }),
    h('div', { class: 'bz-segments', role: 'group', 'aria-labelledby': id, 'aria-describedby': aide ? `${id}-aide` : null },
      choix.map(([v, l]) => h('button', { type: 'button', cle: `${id}-${v}`, 'aria-pressed': actuel === v, onclick: () => { regler(v); maj(); }, texte: l }))),
    aide ? h('span', { class: 'bz-champ__aide', id: `${id}-aide`, texte: aide }) : null);
  const qualite = lireLocal('lb-carte-qualite') ?? 'auto';
  const heure = lireLocal('lb-carte-heure') ?? 'reelle';
  const anim = lireLocal('lb-carte-animations') !== 'non';
  const actuelle = E.scene?.qualite?.();
  return [
    h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Réglages de cet appareil seulement.' }),
    groupe('carte-qualite', 'Qualité de la carte', actuelle ? `Qualité utilisée en ce moment : ${QUALITES[actuelle]}. Automatique choisit selon l’appareil et baisse d’un cran si la carte ralentit.` : 'Automatique choisit selon l’appareil et baisse d’un cran si la carte ralentit.',
      [['auto', 'Automatique'], ...Object.entries(QUALITES)], qualite, (v) => {
        ecrireLocal('lb-carte-qualite', v);
        if (E.scene) { E.scene.detruire(); E.scene = null; }
      }),
    groupe('carte-heure', 'Heure de la carte', 'Réelle : la lumière suit l’heure (aube, jour, crépuscule, nuit), quel que soit le thème.', Object.entries(REGLAGES_HEURE), heure, (v) => { ecrireLocal('lb-carte-heure', v); E.scene?.regler({ heure: v }); }),
    interrupteurReglage({ cle: 'carte-animations', titre: 'Animations de la carte', aide: 'Bateaux, camions, mouettes et phare. Toujours arrêtées si vous réduisez les animations ou en mode Calme.', actif: anim,
      regler: (v) => { ecrireLocal('lb-carte-animations', v ? 'oui' : 'non'); E.scene?.regler({ animations: v && !modeCalme() }); maj(); } }),
  ];
}
function blocApparence({ titre = true } = {}) {
  return h('div', { class: 'bz-pile', id: 'bloc-apparence' }, contenuApparence({ titre }));
}
document.documentElement.addEventListener('bz:preferences', () => { const n = $('#bloc-apparence'); if (n && !n.contains(document.activeElement)) remplir(n, contenuApparence({ titre: !n.closest('#reglages-page') })); });
/** Apparence pour qui n'a pas accès aux Réglages (menu du compte, « Plus ») : la même page, en dialogue. */
function ouvrirApparence() {
  dialogueVivant({ titre: 'Apparence et accessibilité', surtitre: 'Réglages de cet appareil', taille: 'md', contenu: () => ({ corps: [blocApparence({ titre: false })] }) });
}

async function rendreCompte() {
  const P = $('#page');
  if (E.connexion?.connexion !== 'comptes') {
    remplir(P, h('div', { class: 'bz-ecran bz-compte' },
      encadre('info', 'Démonstration : il n’y a pas de compte.', 'La version de l’entreprise (npm start) demande un identifiant et un mot de passe.'),
      h('section', { class: 'bz-carte bz-pile' }, blocApparence())));
    return;
  }
  let c;
  try { c = await api('GET', '/compte'); } catch (e) { remplir(P, erreurEcran('Votre compte n’a pas pu être chargé.', e, () => rendreCompte())); return; }
  const M = { actuel: '', nouveau: '', confirmation: '', erreur: null, ok: false };
  const C = { motDePasse: '', code: null, erreur: null };
  const D = { motDePasse: '', code: '', erreur: null, envoi: false };
  const N = { motDePasse: '', codes: null, erreur: null };
  const activation = c.deuxEtapes.active ? null : blocActivationDeuxEtapes(() => { informer('Validation en deux étapes activée.', 'ok'); rendreCompte(); });
  const repli = (titre, ouvert, ...contenu) => h('details', { class: 'bz-repli', open: ouvert || null }, h('summary', {}, h('span', { class: 'bz-repli__titre', texte: titre }), icone('chevron-down', { taille: 'sm' })), h('div', { class: 'bz-repli__corps bz-pile' }, contenu));
  const deuxEtapes = () => h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'compte-deux-etapes' },
    h('div', { class: 'bz-carte__tete' }, h('h2', { class: 'bz-carte__titre', id: 'compte-deux-etapes', texte: 'Validation en deux étapes' }),
      c.deuxEtapes.active ? h('span', { class: 'bz-badge bz-badge--ok' }, icone('shield-check', { taille: 'sm' }), 'Active')
        : h('span', { class: `bz-badge bz-badge--${c.deuxEtapes.obligatoire ? 'critique' : 'attention'}` }, icone(c.deuxEtapes.obligatoire ? 'octagon-alert' : 'triangle-alert', { taille: 'sm' }), c.deuxEtapes.obligatoire ? 'Obligatoire' : 'Recommandée')),
    !c.deuxEtapes.active ? activation : [
      h('p', { class: 'bz-t-petit', texte: `Active depuis le ${dateHeure(c.deuxEtapes.activeLe)}. À chaque connexion, le code de votre application d’authentification est demandé après le mot de passe. Codes de récupération restants : ${c.deuxEtapes.codesRestants} sur 8.` }),
      c.deuxEtapes.codesRestants < 3 ? encadre('attention', 'Il vous reste peu de codes de récupération : créez-en de nouveaux.') : null,
      repli('Nouveaux codes de récupération', Boolean(N.erreur || N.codes),
        messageEnLigne('critique', N.erreur),
        N.codes ? [h('ol', { class: 'bz-code-secours bz-codes-recuperation', 'data-brut': '' }, N.codes.map((x) => h('li', { texte: x }))), encadre('attention', 'Notez-les maintenant : ils ne seront plus affichés. Les anciens ne marchent plus.'),
          h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--secondaire', type: 'button', onclick: () => copier(N.codes.join('\n'), 'Codes copiés') }, icone('copy'), 'Copier'))]
          : h('form', { class: 'bz-formulaire', onsubmit: async (e) => {
            e.preventDefault();
            try { N.codes = (await api('POST', '/compte/deux-etapes/codes', { motDePasse: N.motDePasse })).codes; N.erreur = null; N.motDePasse = ''; c.deuxEtapes.codesRestants = N.codes.length; } catch (err) { N.erreur = err.message; }
            rendre();
          } },
            champMotDePasse(N, 'motDePasse', { id: 'compte-mdp-codes', libelle: 'Votre mot de passe (pour confirmer)', identifiant: () => c.identifiant }),
            h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--secondaire', type: 'submit' }, icone('key-round'), 'Créer 8 nouveaux codes')))),
      repli(c.deuxEtapes.obligatoire ? 'Changer de téléphone' : 'Désactiver (ou changer de téléphone)', Boolean(D.erreur),
        h('p', { class: 'bz-t-petit', texte: c.deuxEtapes.obligatoire
          ? 'Obligatoire pour les administrateurs d’un Living Business en ligne : après la désactivation, vous la réactiverez aussitôt avec le nouveau téléphone.'
          : 'Pour changer de téléphone : désactivez, puis réactivez avec le nouveau.' }),
        messageEnLigne('critique', D.erreur),
        h('form', { class: 'bz-formulaire', onsubmit: async (e) => {
          e.preventDefault();
          D.envoi = true;
          rendre();
          try {
            const r = await api('POST', '/compte/deux-etapes/desactiver', { motDePasse: D.motDePasse, code: D.code });
            if (r.obligatoire) return demarrer();
            informer('Validation en deux étapes désactivée.', 'ok');
            return rendreCompte();
          } catch (err) { if (err.session) return undefined; D.erreur = err.message; D.code = ''; }
          D.envoi = false;
          return rendre();
        } },
          h('input', { type: 'text', hidden: true, autocomplete: 'username', value: c.identifiant, readonly: true }),
          champMotDePasse(D, 'motDePasse', { id: 'compte-mdp-desactiver', libelle: 'Votre mot de passe', identifiant: () => c.identifiant }),
          champEntree({ id: 'compte-code-desactiver', libelle: 'Code de l’application (ou code de récupération)', valeur: D.code, required: true, maxlength: '12', autocomplete: 'one-time-code', inputmode: 'numeric', oninput: (v) => (D.code = v) }),
          h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--danger', type: 'submit', 'aria-busy': D.envoi ? 'true' : null }, c.deuxEtapes.obligatoire ? 'Désactiver et réactiver avec un autre téléphone' : 'Désactiver')))),
    ]);
  const rendre = () => remplir(P, h('div', { class: 'bz-ecran bz-compte' },
    h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'compte-identite' },
      h('div', { class: 'bz-carte__tete' },
        h('span', { class: 'bz-avatar', 'aria-hidden': 'true', texte: initialeProfil() }),
        h('h2', { class: 'bz-carte__titre', id: 'compte-identite', texte: c.identifiant }),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: seDeconnecter }, icone('log-out'), 'Se déconnecter')),
      h('dl', { class: 'bz-champs-fiche' }, [['Profil', c.profil ?? '—'], ['Entreprise', sansDemo(E.monde.organisation.nom)], ['Compte créé', dateHeure(c.creeLe)], ['Code de secours', c.aSecours ? 'Oui' : 'Aucun : créez-en un ci-dessous'], ['Deux étapes', c.deuxEtapes.active ? 'Active' : 'Non : recommandée ci-dessous']]
        .map(([k, v]) => h('div', { class: 'bz-champ-fiche' }, h('dt', { class: 'bz-champ-fiche__libelle', texte: k }), h('dd', { class: 'bz-champ-fiche__valeur', texte: v }))))),
    h('div', { class: 'bz-deux-colonnes' },
      deuxEtapes(),
      h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'compte-appli' }, h('h2', { class: 'bz-carte__titre', id: 'compte-appli', texte: 'Application sur cet appareil' }),
        h('p', { class: 'bz-t-petit', texte: 'Installez Living Business sur votre téléphone ou votre ordinateur : une icône sur l’écran d’accueil, il s’ouvre comme une application. Vos données restent sur l’ordinateur ou le serveur de l’entreprise.' }),
        blocApplication())),
    h('div', { class: 'bz-deux-colonnes' },
      h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'compte-mdp' }, h('h2', { class: 'bz-carte__titre', id: 'compte-mdp', texte: 'Changer mon mot de passe' }),
        messageEnLigne('critique', M.erreur),
        M.ok ? messageEnLigne('ok', 'Mot de passe changé.', 'Vos autres sessions ouvertes sont fermées.') : null,
        h('form', { class: 'bz-formulaire', onsubmit: async (e) => {
          e.preventDefault();
          M.ok = false;
          M.erreur = memeMdp(M, 'nouveau', 'confirmation');
          if (!M.erreur) {
            try { await api('PUT', '/compte/mot-de-passe', { actuel: M.actuel, nouveau: M.nouveau }); Object.assign(M, { actuel: '', nouveau: '', confirmation: '', ok: true }); } catch (err) { M.erreur = err.message; }
          }
          rendre();
        } },
          h('input', { type: 'text', hidden: true, autocomplete: 'username', value: c.identifiant, readonly: true }),
          champMotDePasse(M, 'actuel', { id: 'compte-mdp-actuel', libelle: 'Mot de passe actuel', identifiant: () => c.identifiant }),
          champMotDePasse(M, 'nouveau', { id: 'compte-mdp-nouveau', libelle: 'Nouveau mot de passe', nouveau: true, identifiant: () => c.identifiant }),
          champMotDePasse(M, 'confirmation', { id: 'compte-mdp-confirmation', libelle: 'Confirmez le nouveau mot de passe', autocomplete: 'new-password', identifiant: () => c.identifiant }),
          h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--principal', type: 'submit' }, icone('check'), 'Changer le mot de passe')))),
      h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'compte-secours' }, h('h2', { class: 'bz-carte__titre', id: 'compte-secours', texte: 'Code de secours' }),
        h('p', { class: 'bz-t-petit', texte: 'Il remplace votre mot de passe si vous l’oubliez. Un nouveau code annule l’ancien. Personne, pas même l’éditeur, ne peut le retrouver pour vous.' }),
        messageEnLigne('critique', C.erreur),
        C.code ? [h('p', { class: 'bz-code-secours', 'data-brut': '', texte: C.code }), encadre('attention', 'Notez-le maintenant : il ne sera plus affiché.')]
          : h('form', { class: 'bz-formulaire', onsubmit: async (e) => {
            e.preventDefault();
            try { C.code = (await api('POST', '/compte/secours', { motDePasse: C.motDePasse })).codeSecours; c.aSecours = true; C.erreur = null; } catch (err) { C.erreur = err.message; }
            rendre();
          } },
            champMotDePasse(C, 'motDePasse', { id: 'compte-mdp-secours', libelle: 'Votre mot de passe (pour confirmer)', identifiant: () => c.identifiant }),
            h('div', { class: 'bz-groupe-boutons' }, h('button', { class: 'bz-bouton bz-bouton--secondaire', type: 'submit' }, icone('key-round'), 'Créer un nouveau code'))))),
    h('section', { class: 'bz-carte bz-pile' }, blocApparence())));
  rendre();
}

// ---------------------------------------------------------------- santé de l'entreprise
// ---------------------------------------------------------------- Santé (§6.1 P6, §4.10, §4.22)
/* Vue d'ensemble (anneau de 160 px, palier, « Pas une notation de crédit »), tendance sur 90 jours (uPlot, résumé en
   texte et tableau équivalent), 3 priorités avec leur action directe, puis une page par domaine (onglets) : critères
   groupés par statut, barres à étiquettes directes et tableau équivalent. Les chiffres clés restent modifiables ici ;
   Breizhcosystem n'est plus qu'une ligne en bas de page. Le choix de ce qui s'affiche est fait par web/sante.js (module pur). */
let SANTE = null;
const chargerSante = async () => (SANTE ??= await import('/sante.js'));
const SEUILS_COURBE = [{ valeur: 40, libelle: 'À surveiller' }, { valeur: 70, libelle: 'Solide' }];
const DATE_TABLEAU = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Barre horizontale d'un critère (SVG fait main, §4.22) : piste et valeur, l'étiquette est écrite à côté. */
function barreScore(score, ton) {
  const s = svg('svg', { class: 'bz-barre', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  s.append(svg('rect', { class: 'bz-barre__piste', x: 0, y: 0, width: 100, height: 8 }));
  if (typeof score === 'number' && score > 0) s.append(svg('rect', { class: 'bz-barre__valeur', x: 0, y: 0, width: Math.max(2, Math.min(100, score)), height: 8, 'data-ton': ton ?? null }));
  return s;
}

/** Exécute l'action d'une priorité ou d'un critère (cible décidée par web/sante.js). */
function faireActionSante(a) {
  if (!a) return;
  if (a.cible === 'fec') return ouvrirFec();
  if (a.cible === 'connecter') return ouvrirAssistant();
  if (a.cible === 'chiffres') { const z = $('#chiffres-cles'); z?.scrollIntoView({ behavior: mouvementReduit() ? 'auto' : 'smooth', block: 'start' }); z?.querySelector('input')?.focus({ preventScroll: true }); return undefined; }
  if (a.cible.startsWith('vue:')) return changerVue(a.cible.slice(4));
  return undefined;
}
const mouvementReduit = () => document.documentElement.getAttribute('data-mouvement') === 'reduit' || (document.documentElement.getAttribute('data-mouvement') !== 'normal' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const actionPermise = (a) => Boolean(a) && (!a.cible.startsWith('vue:') || vueAutorisee(a.cible.slice(4).startsWith('reglages:') ? 'reglages' : a.cible.slice(4)));

/** Onglets (APG « Tabs ») : flèches gauche et droite, Début et Fin, activation automatique. */
function clavierOnglets(e, ids, actif, choisir) {
  const i = ids.indexOf(actif);
  const cible = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
  if (cible === undefined) return;
  e.preventDefault();
  const id = ids[(cible + ids.length) % ids.length];
  choisir(id);
  setTimeout(() => document.querySelector(`[data-cle="onglet-${id}"]`)?.focus(), 0);
}

async function rendreSante() {
  const P = $('#page');
  const attente = setTimeout(() => remplir(P, h('div', { class: 'bz-ecran', 'aria-busy': 'true' },
    h('span', { class: 'bz-visuellement-cache', texte: 'Chargement de la santé de l’entreprise' }),
    h('div', { class: 'bz-sante__ensemble' }, h('span', { class: 'bz-squelette bz-squelette--anneau' }), h('span', { class: 'bz-squelette bz-squelette--texte' })),
    h('span', { class: 'bz-squelette bz-squelette--courbe' }))), 150);
  let S;
  let M;
  try {
    [M, S] = await Promise.all([chargerSante(), api('GET', '/sante')]);
  } catch (e) {
    clearTimeout(attente);
    if (E.vue !== 'sante') return;
    remplir(P, h('div', { class: 'bz-ecran' }, h('div', { class: 'bz-vide', role: 'alert' },
      h('h2', { class: 'bz-vide__titre', texte: 'La santé de l’entreprise n’a pas pu être chargée.' }),
      h('p', { class: 'bz-vide__texte', texte: e.message || 'Vérifiez la connexion.' }),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => rendreSante() }, icone('refresh-cw'), 'Réessayer'))));
    return;
  }
  clearTimeout(attente);
  if (E.vue !== 'sante') return;
  ecrireLocal('lb-sante-vue', '1');
  const m = E.monde;
  const ctx = { admin: Boolean(m.profil.peutAdministrer), demo: Boolean(m.organisation.demo) };
  const tete = M.enteteSante(S);
  const priorites = M.prioritesSante(S, ctx).map((p) => ({ ...p, action: actionPermise(p.action) ? p.action : null }));
  const domaines = S.domaines;
  if (!domaines.some((d) => d.id === E.santeDomaine)) {
    E.santeDomaine = lireLocal('lb-sante-domaine');
    if (!domaines.some((d) => d.id === E.santeDomaine)) E.santeDomaine = [...domaines].sort((a, b) => M.resumeDomaine(b).aCorriger - M.resumeDomaine(a).aCorriger)[0]?.id ?? 'finances';
  }
  let courbeActive = null;

  const ensemble = () => {
    const A = anneauSante(S);
    return h('section', { class: 'bz-sante__ensemble', 'aria-labelledby': 'sante-titre' },
      anneauGrand(S),
      h('div', { class: 'bz-sante__resume' },
        h('p', { class: 'bz-t-surtitre', texte: `Santé de ${sansDemo(m.organisation.nom)}` }),
        h('h2', { class: 'bz-t-titre-3', id: 'sante-titre', texte: tete.titre }),
        h('p', { class: 'bz-anneau__palier' }, A.palier ? iconeEtat(A.palier.ton, { taille: 'sm', decoratif: true }) : icone('circle-dashed', { taille: 'sm' }), A.libelle),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: `${tete.couverture}. Une donnée absente ne compte jamais pour zéro.` }),
        h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, icone('info', { taille: 'sm' }), h('span', { texte: 'Pas une notation de crédit : des repères généraux, à ajuster selon votre métier.' })),
        tete.provisoire || tete.score === null ? h('div', { class: 'bz-groupe-boutons' },
          ctx.admin && !ctx.demo ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => ouvrirAssistant() }, icone('plug'), 'Compléter avec mes données') : null) : null));
  };

  const tendance = () => {
    if (!S.tendance) return null;
    const R = M.resumeTendance(S.tendance);
    const lignes = M.lignesTendance(S.tendance);
    const ouvert = Boolean(E.santeTableauTendance);
    return h('section', { class: 'bz-carte bz-courbe', 'aria-labelledby': 'tendance-titre' },
      h('div', { class: 'bz-carte__tete' },
        h('h2', { class: 'bz-carte__titre', id: 'tendance-titre', texte: `Tendance sur ${S.tendance.jours} jours` }),
        S.tendance.exemple ? h('span', { class: 'bz-badge' }, icone('flask-conical', { taille: 'sm' }), 'Exemple') : null),
      h('p', { class: 'bz-courbe__resume' },
        R.vide ? null : h('span', { class: 'bz-tuile__variation', 'data-sens': R.variation > 0 ? 'bon' : R.variation < 0 ? 'mauvais' : null }, icone(R.fleche, { taille: 'sm' }), R.variationTexte),
        h('span', { texte: R.texte })),
      R.vide ? h('div', { class: 'bz-vide bz-vide--compact', texte: 'Revenez demain : chaque jour ajoute un point à la courbe.' }) : [
        h('div', { class: 'bz-courbe__cadre', tabindex: '0', role: 'group', 'aria-label': 'Courbe du score. Flèches gauche et droite pour lire chaque jour.', 'aria-describedby': 'tendance-lecture', cle: 'courbe-sante' },
          h('div', { class: 'bz-courbe__trace', id: 'courbe-sante', 'aria-hidden': 'true' })),
        h('p', { class: 'bz-courbe__lecture bz-t-micro', id: 'tendance-lecture', texte: 'Survolez ou parcourez la courbe pour lire un jour.' }),
      ],
      lignes.length ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', 'aria-expanded': ouvert, 'aria-controls': 'tableau-tendance', cle: 'voir-tableau-tendance',
        onclick: () => { E.santeTableauTendance = !ouvert; rendre(); } }, icone('table'), ouvert ? 'Masquer le tableau' : 'Voir le tableau') : null,
      lignes.length ? h('div', { class: 'bz-tableau-cadre', id: 'tableau-tendance', hidden: !ouvert },
        h('table', { class: 'bz-tableau' },
          h('caption', { class: 'bz-visuellement-cache', texte: 'Score de santé par jour relevé' }),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', texte: 'Jour' }), h('th', { scope: 'col', class: 'bz-num', texte: 'Score sur 100' }), h('th', { scope: 'col', class: 'bz-num', texte: 'Critères renseignés' }))),
          h('tbody', {}, lignes.map((l) => h('tr', {}, h('td', { texte: DATE_TABLEAU.format(new Date(`${l.jour}T00:00:00Z`)) }), h('td', { class: 'bz-num', texte: nombre(l.score) }), h('td', { class: 'bz-num', texte: `${l.couverture} %` })))))) : null);
  };

  const blocPriorites = () => h('section', { class: 'bz-sante__section', 'aria-labelledby': 'priorites-titre' },
    h('h2', { class: 'bz-t-titre-4', id: 'priorites-titre', texte: priorites.length > 1 ? `Vos ${priorites.length} priorités` : 'Votre priorité' }),
    priorites.length ? h('ol', { class: 'bz-priorites', role: 'list' }, priorites.map((p, i) => h('li', { class: 'bz-priorite' },
      p.ton ? iconeEtat(p.ton, { classe: 'bz-priorite__icone' }) : icone('circle-dashed', { classe: 'bz-priorite__icone', libelle: 'Pas encore renseigné' }),
      h('div', { class: 'bz-priorite__texte' },
        h('h3', { class: 'bz-priorite__titre', texte: p.titre }),
        p.mesure ? h('p', { class: 'bz-t-petit', texte: p.mesure }) : null,
        h('p', { class: 'bz-t-petit bz-texte-2', texte: p.raison })),
      p.action ? h('button', { type: 'button', class: `bz-bouton ${i === 0 ? 'bz-bouton--principal' : 'bz-bouton--secondaire'} bz-priorite__action`, cle: `priorite-${p.cle}`, onclick: () => faireActionSante(p.action) }, p.action.libelle) : null)))
      : h('div', { class: 'bz-vide bz-vide--compact', texte: 'Rien de prioritaire : tous vos critères renseignés sont bons.' }),
    S.forces?.length ? h('p', { class: 'bz-t-petit bz-texte-2' }, h('strong', { texte: 'Vos points forts : ' }), S.forces.map((c) => c.libelle).join(', '), '.') : null);

  const ligneCritere = (c) => {
    const st = M.statutDe(c.statut);
    // critère réservé (motifs d'absence, droit RH) : ni mesure, ni action, la raison est dite
    const action = c.statut !== 'bon' && !c.reserve ? M.actionCritere(c, ctx) : null;
    return h('li', { class: 'bz-critere', 'data-statut': c.statut },
      h('div', { class: 'bz-critere__tete' },
        h('span', { class: 'bz-critere__nom', texte: c.libelle }),
        h('span', { class: 'bz-critere__note bz-t-chiffre', 'data-certitude': c.score === null ? 'absent' : null, texte: c.score === null ? '—' : nombre(c.score) },
          c.score === null ? h('span', { class: 'bz-visuellement-cache', texte: ' Pas encore renseigné' }) : h('span', { class: 'bz-visuellement-cache', texte: ' sur 100' }))),
      c.score === null ? null : barreScore(c.score, st.ton),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: c.mesure ?? (c.reserve ? `${c.source}.` : `À connecter : ${c.source}`) }),
      c.statut === 'faible' || c.statut === 'moyen' ? h('p', { class: 'bz-t-petit', texte: c.conseil }) : null,
      action && actionPermise(action) ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--lien bz-critere__action', onclick: () => faireActionSante(action) }, action.libelle, icone('arrow-right', { taille: 'sm' })) : null);
  };

  const blocDomaines = () => {
    const ids = domaines.map((d) => d.id);
    const choisir = (id) => { E.santeDomaine = id; ecrireLocal('lb-sante-domaine', id); rendre(); };
    const d = domaines.find((x) => x.id === E.santeDomaine) ?? domaines[0];
    const R = M.resumeDomaine(d);
    const ouvert = E.santeTableauDomaine === d.id;
    return h('section', { class: 'bz-sante__section', 'aria-labelledby': 'domaines-titre' },
      h('h2', { class: 'bz-t-titre-4', id: 'domaines-titre', texte: 'Par domaine' }),
      // nom accessible « Finances, 45 sur 100 » porté par l'onglet (la note visible est décorative) ; débordement
      // signalé par fondus et boutons ‹ › (§4.13)
      cadreOnglets(h('div', { class: 'bz-onglets', role: 'tablist', 'aria-labelledby': 'domaines-titre' }, domaines.map((x) => {
        const r = M.resumeDomaine(x);
        return h('button', { type: 'button', role: 'tab', id: `onglet-${x.id}`, cle: `onglet-${x.id}`, 'aria-selected': x.id === d.id, 'aria-controls': 'panneau-domaine', tabindex: x.id === d.id ? '0' : '-1',
          'aria-label': `${M.libelleDomaine(x)}, ${r.score === null ? 'pas encore renseigné' : `${nombre(r.score)} sur 100`}`,
          onclick: () => choisir(x.id), onkeydown: (e) => clavierOnglets(e, ids, d.id, choisir) },
        icone(M.DOMAINES[x.id]?.icone ?? 'circle', { taille: 'sm' }), h('span', { texte: M.libelleDomaine(x) }),
        h('span', { class: 'bz-onglets__note bz-t-chiffre', 'aria-hidden': 'true', texte: r.score === null ? '—' : nombre(r.score) }));
      }))),
      h('div', { class: 'bz-domaine', role: 'tabpanel', id: 'panneau-domaine', 'aria-labelledby': `onglet-${d.id}`, tabindex: '0' },
        h('div', { class: 'bz-domaine__tete' },
          h('h3', { class: 'bz-t-titre-4', texte: M.libelleDomaine(d) }),
          h('p', { class: 'bz-anneau__palier' }, R.palier ? iconeEtat(R.palier.ton, { taille: 'sm', decoratif: true }) : icone('circle-dashed', { taille: 'sm' }), R.texte)),
        M.groupesCriteres(d).map((g) => h('section', { class: 'bz-criteres', 'aria-labelledby': `groupe-${d.id}-${g.id}` },
          h('h4', { class: 'bz-criteres__titre', id: `groupe-${d.id}-${g.id}` }, g.ton ? iconeEtat(g.ton, { taille: 'sm', decoratif: true }) : icone('circle-dashed', { taille: 'sm' }), `${g.titre} · ${g.criteres.length}`),
          h('ul', { class: 'bz-criteres__liste', role: 'list' }, g.criteres.map(ligneCritere)))),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', 'aria-expanded': ouvert, 'aria-controls': 'tableau-domaine', cle: 'voir-tableau-domaine',
          onclick: () => { E.santeTableauDomaine = ouvert ? null : d.id; rendre(); } }, icone('table'), ouvert ? 'Masquer le tableau' : 'Voir le tableau'),
        h('div', { class: 'bz-tableau-cadre', id: 'tableau-domaine', hidden: !ouvert },
          h('table', { class: 'bz-tableau' },
            h('caption', { class: 'bz-visuellement-cache', texte: `Critères du domaine ${M.libelleDomaine(d)}` }),
            h('thead', {}, h('tr', {}, ['Critère', 'Mesure', 'Note sur 100', 'Statut', 'D’où vient ce chiffre ?'].map((t, i) => h('th', { scope: 'col', class: i === 2 ? 'bz-num' : null, texte: t })))),
            h('tbody', {}, d.criteres.map((c) => h('tr', {},
              h('th', { scope: 'row', texte: c.libelle }), h('td', { texte: c.mesure ?? '—' }), h('td', { class: 'bz-num', texte: c.score === null ? '—' : nombre(c.score) }),
              h('td', { texte: M.statutDe(c.statut).titre }), h('td', { texte: c.source }))))))));
  };

  const blocChiffres = () => {
    if (!m.profil.peutAdministrer) return null;
    const org = m.objets.find((o) => o.famille === 'organisation');
    const v = (k) => (org ? valeurDe(org, k) ?? '' : '');
    const C = { tresorerie: v('tresorerie'), charges_mensuelles: v('charges_mensuelles'), chiffre_affaires_annuel: v('chiffre_affaires_annuel'), marge_brute: v('marge_brute') };
    const champs = [['tresorerie', 'Trésorerie disponible', '€'], ['charges_mensuelles', 'Charges par mois', '€'], ['chiffre_affaires_annuel', 'Chiffre d’affaires annuel', '€'], ['marge_brute', 'Marge brute', '%']];
    return h('section', { class: 'bz-carte bz-sante__chiffres', id: 'chiffres-cles', 'aria-labelledby': 'chiffres-titre' },
      h('div', { class: 'bz-carte__tete' }, h('h2', { class: 'bz-carte__titre', id: 'chiffres-titre', texte: 'Vos chiffres clés' })),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: m.organisation.demo ? 'Entreprise exemple : créez votre entreprise pour saisir vos propres chiffres.' : 'Ils débloquent le domaine Finances. Le plus simple : importez le fichier des écritures comptables (FEC) de votre logiciel (Sage, EBP, Cegid, Ciel, Quadra…). Ils restent sur cet ordinateur.' }),
      h('form', { class: 'bz-formulaire', onsubmit: async (e) => {
        e.preventDefault();
        const b = e.submitter ?? e.target.querySelector('[type="submit"]');
        b?.setAttribute('aria-busy', 'true');
        try { await api('PUT', '/organisation', C); informer('Chiffres clés enregistrés : score recalculé.', 'ok'); await charger(); } catch (err) { b?.removeAttribute('aria-busy'); informer(err.message, 'erreur'); }
      } },
        h('div', { class: 'bz-grille-champs' }, champs.map(([k, l, u]) => h('div', { class: 'bz-champ' },
          h('label', { class: 'bz-champ__libelle', for: `chiffre-${k}`, texte: l }),
          h('div', { class: 'bz-champ__suffixe' },
            h('input', { id: `chiffre-${k}`, class: 'bz-champ__saisie', type: 'number', min: '0', step: 'any', inputmode: 'decimal', enterkeyhint: 'done', autocomplete: 'off', readonly: m.organisation.demo ? true : null, value: C[k], oninput: (e) => (C[k] = e.target.value) }),
            h('span', { class: 'bz-champ__unite', 'aria-hidden': 'true', texte: u === '€' ? '€' : '%' }))))),
        m.organisation.demo ? null : h('div', { class: 'bz-groupe-boutons' },
          h('button', { type: 'submit', class: 'bz-bouton bz-bouton--secondaire' }, icone('check'), 'Enregistrer les chiffres'),
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: () => ouvrirFec() }, icone('upload'), 'Importer le FEC'))));
  };

  const rendre = () => {
    courbeActive?.detruire();
    courbeActive = null;
    remplir(P, h('div', { class: 'bz-ecran bz-sante' },
      ensemble(), tendance(), blocPriorites(), blocDomaines(), blocChiffres(),
      h('section', { class: 'bz-sante__nexus', id: 'comparaison', 'aria-label': 'Comparaison avec le réseau' }, h('div', { id: 'comparaison-nexus' }))));
    const trace = $('#courbe-sante');
    if (trace && S.tendance) {
      import('/courbe.js').then(({ courbe }) => {
        if (!trace.isConnected) return null;
        return courbe(trace, M.serieTendance(S.tendance, S.calculeLe.slice(0, 10)), { seuils: SEUILS_COURBE, lecture: $('#tendance-lecture'), cadre: trace.parentElement });
      }).then((c) => { courbeActive = c; }).catch(() => {
        if (trace.isConnected) remplir(trace.parentElement, h('p', { class: 'bz-t-petit bz-texte-2', texte: 'La courbe n’a pas pu s’afficher. Le tableau ci-dessous donne les mêmes chiffres.' }));
      });
    }
    chargerComparaison();
  };
  rendre();
}

/** Anneau de santé de 160 px (page Santé) : même dessin que l'anneau d'« Aujourd'hui », sans lien (on y est déjà). */
function anneauGrand(sante) {
  const A = anneauSante(sante);
  const dessin = svg('svg', { class: 'bz-anneau__svg', viewBox: '0 0 120 120', role: 'img', 'aria-label': typo(A.aria), focusable: 'false' });
  dessin.append(svg('circle', { class: 'bz-anneau__piste', cx: 60, cy: 60, r: RAYON_ANNEAU, 'stroke-width': 10 }));
  if (A.score) dessin.append(svg('path', { class: 'bz-anneau__arc', d: cheminArc(A.score / 100, RAYON_ANNEAU), 'stroke-width': 10, pathLength: 100, 'data-ton': A.ton, 'data-provisoire': A.provisoire }));
  if (A.couverture > 0) dessin.append(svg('path', { class: 'bz-anneau__couverture', d: cheminArc(A.couverture, RAYON_COUVERTURE), 'stroke-width': 3 }));
  const score = svg('text', { class: 'bz-anneau__score', x: 60, y: 66, 'text-anchor': 'middle', 'font-size': 36 });
  score.textContent = A.score === null ? '—' : nombre(A.score);
  const sur = svg('text', { class: 'bz-anneau__sur', x: 60, y: 84, 'text-anchor': 'middle', 'font-size': 12 });
  sur.textContent = typo('sur 100');
  dessin.append(score, sur);
  return h('div', { class: 'bz-anneau bz-anneau--160' }, dessin);
}

const LIB_NOTES = (cle) => {
  if (cle === 'global') return 'Score global';
  const [genre, id] = cle.split('.');
  if (genre === 'domaine') return SANTE?.libelleDomaine(id) ?? id;
  return id;
};
/** Breizhcosystem en une ligne en bas de page (§6.1 P6) ; la comparaison par groupes s'affiche ici quand l'entreprise est reliée. */
async function chargerComparaison() {
  const zone = $('#comparaison-nexus');
  if (!zone) return;
  let n;
  try { n = await api('GET', '/nexus'); } catch { return; }
  if (!zone.isConnected) return;
  if (!n.relie) {
    remplir(zone, h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, icone('bz-nexus', { taille: 'sm' }),
      h('span', {}, 'Comparez-vous aux entreprises comparables avec Breizhcosystem : des notes sur 100, jamais vos montants ; les autres membres ne voient que des moyennes. ',
        E.monde.profil.peutAdministrer ? h('a', { href: '#/reglages:reseau', class: 'bz-lien', onclick: (e) => allerA('reglages:nexus', e), texte: n.url ? 'Relier mon entreprise' : 'Découvrir Breizhcosystem' }) : null)));
    return;
  }
  try {
    const c = await api('GET', '/nexus/comparaison');
    if (!zone.isConnected) return;
    if (!c.disponible) { remplir(zone, h('p', { class: 'bz-t-petit bz-texte-2 bz-ligne-icone' }, icone('bz-nexus', { taille: 'sm' }), h('span', { texte: c.raison }))); return; }
    remplir(zone,
      h('h2', { class: 'bz-t-titre-4', texte: 'Par rapport aux entreprises comparables' }),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: `${c.position.global ? `Mieux que ${c.position.global.mieuxQue} % ` : ''}des ${c.taille} entreprises du groupe « ${c.groupe} ». Moyennes de groupes d’au moins 10 entreprises : les autres membres ne voient jamais vos notes une à une.` }),
      h('ul', { class: 'bz-criteres__liste', role: 'list' }, Object.entries(c.position).map(([k, v]) => h('li', { class: 'bz-critere' },
        h('div', { class: 'bz-critere__tete' }, h('span', { class: 'bz-critere__nom', texte: LIB_NOTES(k) }), h('span', { class: 'bz-critere__note bz-t-chiffre', texte: `${v.mieuxQue} %` })),
        barreScore(v.mieuxQue, null),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: `Médiane du groupe : ${v.mediane} sur 100` })))),
      c.detail ? null : h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Détail par domaine et par critère avec Breizhcosystem ACTIVE.' }));
  } catch (e) { if (zone.isConnected) remplir(zone, h('p', { class: 'bz-t-petit bz-texte-2', texte: e.message })); }
}

// ---------------------------------------------------------------- Breizhcosystem : onglet, agents d'achat, « Proposer à… »
/**
 * Explication d'un verrou Breizhcosystem ACTIVE, sur place (jamais un saut de défilement, jamais un refus après la saisie).
 * `capacite` : ce que l'action demande. Le lien ouvre Breizhcosystem (commutateur d'écosystème) pour souscrire.
 */
function expliquerVerrou(titre, texte, url) {
  const D = dialogueVivant({
    titre, surtitre: 'Breizhcosystem ACTIVE', taille: 'sm',
    contenu: () => ({
      corps: [
        h('p', { class: 'bz-ligne-icone' }, icone('lock', { taille: 'sm' }), h('span', { texte })),
        h('p', { class: 'bz-t-petit', texte: 'Vous gardez tout ce qui est gratuit : publier vos besoins et votre catalogue, lire les réponses, comparer votre santé.' }),
      ],
      pied: [
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Plus tard'),
        url ? lienExterne(url, 'Découvrir Breizhcosystem ACTIVE', 'bz-bouton bz-bouton--principal') : null,
      ],
    }),
  });
}
/** Bouton d'une action Breizhcosystem : cadenas et badge ACTIVE visibles AVANT le clic si la capacité manque. */
function boutonNexus(N, action, libelle, faire, { principal = false, ic = null } = {}) {
  const etat = RESEAU.verrou(N.droits, action);
  if (etat === 'verrouille') {
    return h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', 'aria-describedby': 'nexus-verrou-aide',
      onclick: () => expliquerVerrou(`${libelle} avec Breizhcosystem ACTIVE`, `« ${libelle} » fait partie de Breizhcosystem ACTIVE. Vous verrez d’abord ce que vous obtenez, puis vous choisissez.`, N.url) },
    icone('lock', { taille: 'sm' }), libelle, h('span', { class: 'bz-badge bz-badge--active', texte: 'ACTIVE' }));
  }
  return h('button', { type: 'button', class: `bz-bouton ${principal ? 'bz-bouton--principal' : 'bz-bouton--secondaire'} bz-bouton--sm`, onclick: faire }, ic ? icone(ic, { taille: 'sm' }) : null, libelle);
}

/** Onglet Breizhcosystem (§6.1 P8) : vitrine de ce que le réseau apporterait, verrous visibles avant l'action, lien vers Breizhcosystem. */
async function rendreNexus() {
  const P = $('#page');
  let N;
  try { N = await api('GET', '/nexus'); } catch (e) { if (E.vue === 'nexus') remplir(P, erreurEcran('Breizhcosystem n’a pas pu être joint.', e, () => rendreNexus())); return; }
  if (E.vue !== 'nexus') return;
  const admin = Boolean(E.monde.profil.peutAdministrer);
  const offre = RESEAU.offre(N.droits);
  const entete = h('div', { class: 'bz-liste__tete' },
    h('p', { class: 'bz-liste__compte bz-t-petit bz-texte-2' }, icone('bz-nexus', { taille: 'sm' }), N.relie ? `Relié à Breizhcosystem${N.organisation ? ` · ${N.organisation}` : ''}` : 'Pas encore relié à Breizhcosystem',
      offre ? h('span', { class: offre === 'Breizhcosystem ACTIVE' ? 'bz-badge bz-badge--active' : 'bz-badge', texte: offre === 'Breizhcosystem ACTIVE' ? 'ACTIVE' : 'Gratuit' }) : null),
    h('div', { class: 'bz-groupe-boutons' },
      N.relie && admin ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => { const z = $('#demande-agent'); z?.scrollIntoView({ behavior: mouvementReduit() ? 'auto' : 'smooth', block: 'start' }); $('#agent-je-cherche')?.focus({ preventScroll: true }); } }, icone('bot'), 'Demander à l’agent') : null,
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => proposerNexus(null) }, icone('user-plus'), 'Inviter une entreprise'),
      N.url ? lienExterne(N.url, 'Ouvrir Breizhcosystem') : null));
  if (!N.relie) {
    Object.assign(EA, { reponse: null, erreur: null });
    remplir(P, h('div', { class: 'bz-ecran bz-nexus' }, entete,
      h('section', { class: 'bz-carte bz-carte--heros bz-nexus__vitrine', 'aria-labelledby': 'nexus-vitrine' },
        h('p', { class: 'bz-t-surtitre', texte: 'Le réseau des entreprises bretonnes' }),
        h('h2', { class: 'bz-t-titre-3', id: 'nexus-vitrine', texte: `Ce que Breizhcosystem apporterait à ${sansDemo(E.monde.organisation.nom)}` }),
        h('p', { class: 'bz-t-chapeau', texte: 'Des entreprises réelles et vérifiées, proches, qui se rendent service. Votre Living Business reste chez vous : il n’envoie que ce que vous cochez.' }),
        h('ul', { class: 'bz-liste-simple bz-nexus__avantages', role: 'list' }, RESEAU.AVANTAGES.map((a) => h('li', { class: 'bz-ligne-icone' },
          h('span', { class: 'bz-cat bz-cat--carre', 'aria-hidden': 'true' }, icone(a.icone, { taille: 'sm' })),
          h('span', { class: 'bz-pile bz-pile--serre' }, h('span', { class: 'bz-t-label', texte: a.titre }), h('span', { class: 'bz-t-petit bz-texte-2', texte: a.texte })),
          a.capacite ? h('span', { class: 'bz-badge bz-badge--active' }, icone('lock', { taille: 'sm' }), 'ACTIVE') : h('span', { class: 'bz-badge', texte: 'Gratuit' })))),
        h('p', { class: 'bz-t-petit bz-texte-2', id: 'nexus-verrou-aide', texte: 'Inscription gratuite avec votre SIRET. Le cadenas signale ce qui demande Breizhcosystem ACTIVE, avant toute saisie.' }),
        admin ? h('div', { class: 'bz-groupe-boutons' },
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--lg', onclick: () => changerVue('reglages:nexus') }, icone('link'), 'Relier mon entreprise à Breizhcosystem'))
          : h('p', { class: 'bz-t-petit', texte: 'La direction relie l’entreprise depuis Réglages › Breizhcosystem.' }))));
    return;
  }
  remplir(P, h('div', { class: 'bz-ecran bz-nexus', 'aria-busy': 'true' }, entete, h('span', { class: 'bz-squelette bz-squelette--logiciels' })));
  let O;
  try { O = await api('GET', '/nexus/opportunites'); } catch (e) { if (E.vue === 'nexus') remplir(P, h('div', { class: 'bz-ecran bz-nexus' }, entete, blocVide({ titre: 'Les opportunités n’ont pas pu être chargées.', texte: e.message, role: 'alert', actions: h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => rendreNexus() }, icone('refresh-cw'), 'Réessayer') }))); return; }
  if (E.vue !== 'nexus') return;
  E.nexusOpp = O.total;
  const groupes = RESEAU.groupes(O.opportunites);
  const actions = (x) => [
    x.action === 'repondre' && admin ? boutonNexus(N, 'repondre', 'Répondre', () => repondreBesoin(x, N), { principal: true, ic: 'reply' }) : null,
    x.action === 'voir' && x.lien ? lienExterne(x.lien, 'Voir l’avis', 'bz-bouton bz-bouton--secondaire bz-bouton--sm') : null,
    x.action === 'contacter' ? boutonNexus(N, 'contacter', 'Contacter', () => window.open(`${N.url}/opportunites`, '_blank', 'noopener'), { ic: 'message-square' }) : null,
    x.action === 'participer' ? boutonNexus(N, 'participer', 'Participer', () => window.open(`${N.url}/opportunites`, '_blank', 'noopener'), { ic: 'handshake' }) : null,
  ];
  remplir(P, h('div', { class: 'bz-ecran bz-nexus' }, entete,
    h('p', { class: 'bz-visuellement-cache', id: 'nexus-verrou-aide', texte: 'Cadenas : demande Breizhcosystem ACTIVE. L’explication s’ouvre sur place.' }),
    !O.profilComplet ? encadre('info', 'Complétez votre activité et votre catalogue sur Breizhcosystem pour des propositions plus justes.') : null,
    groupes.length ? groupes.map((g) => h('section', { class: 'bz-pile', 'aria-labelledby': `opp-${g.id}` },
      h('h2', { class: 'bz-t-titre-4 bz-ligne-icone', id: `opp-${g.id}` }, icone(g.icone), h('span', { texte: g.titre }), h('span', { class: 'bz-compteur', texte: String(g.liste.length) })),
      h('ul', { class: 'bz-nexus__grille', role: 'list' }, g.liste.map((x) => h('li', {}, h('article', { class: 'bz-carte', 'aria-label': x.titre },
        h('h3', { class: 'bz-carte__titre', texte: x.titre }),
        x.detail ? h('p', { class: 'bz-t-petit bz-texte-2', texte: x.detail }) : null,
        h('div', { class: 'bz-groupe-boutons' }, actions(x))))))))
      : blocVide({ titre: 'Aucune opportunité aujourd’hui.', texte: 'Cochez « Besoins détectés » et complétez votre catalogue sur Breizhcosystem.', actions: admin ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => changerVue('reglages:nexus') }, icone('settings'), 'Réglages de Breizhcosystem') : null }),
    admin ? h('section', { id: 'agents-nexus', class: 'bz-pile' }) : null));
  rendreBarre();
  if (admin) rendreAgents(N);
}

// ---------------------------------------------------------------- agents d'achat : l'agent prépare, vous validez toujours
const LIB_CMD = { a_valider: 'À valider', validee: 'Validée, en attente du vendeur', confirmee: 'Confirmée, à payer', paiement_annonce: 'Paiement annoncé', refusee: 'Refusée', payee: 'Payée', annulee: 'Annulée' };
/** Côté vendeur, les mêmes étapes vues de l'autre côté. */
const LIB_CMD_VENTE = { validee: 'Validée, à vous de confirmer', confirmee: 'Confirmée, paiement attendu' };
/** Badge : à faire de votre côté (acheteur : valider, payer ; vendeur : confirmer, constater le paiement), payée. */
const tonCommande = (c) => (c.statut === 'payee' ? 'ok' : (c.achat ? ['a_valider', 'confirmee'] : ['validee', 'paiement_annonce']).includes(c.statut) ? 'attention' : null);
const TYPES_PROPOSITION = { stock: 'Stock', catalogue: 'Catalogue', capacite: 'Renfort' };
const REGLE_AGENT = 'L’agent prépare, vous validez toujours. Le vendeur confirme ensuite.';
const SANS_NEXUS = 'Vous payez directement le vendeur (en ligne, par virement ou par son lien) : l’argent ne passe jamais par Breizhcosystem.';
const REGLE_ECHANGES = 'Votre agent demande un prix à celui du vendeur, et la réponse arrive ici. Elle n’engage personne : pour l’accepter, une personne de votre entreprise la valide sur Breizhcosystem, connectée.';
/** Derniers échanges entre agents lus : la section se redessine sans se vider pendant qu'elle se remet à jour. */
const EA = { reponse: null, erreur: null };
const nfEuroCts = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
/** Demande en cours à l'agent : les résultats restent affichés quand la section se redessine. */
const RA = { texte: '', quantite: '', departement: '', prixMax: '', criteres: null, propositions: null, enCours: false, erreur: null, publiee: false };
/** Paiements préparés pendant la session : id de commande → { stripe: adresse } ou { virement: coordonnées }. */
const PAIEMENTS_NEXUS = new Map();
/** Seule page de paiement en ligne acceptée : Stripe Checkout (déjà vérifié par la passerelle, revérifié ici). */
const estPageStripe = (url) => {
  try { const u = new URL(url); return typeof url === 'string' && url.startsWith('https://checkout.stripe.com/') && u.hostname === 'checkout.stripe.com' && !u.username && !u.password; } catch { return false; }
};
const estLienHttps = (url) => {
  try { return typeof url === 'string' && new URL(url).protocol === 'https:'; } catch { return false; }
};

let NEXUS_ETAT = null;
async function rendreAgents(N = NEXUS_ETAT) {
  NEXUS_ETAT = N;
  const Z = $('#agents-nexus');
  if (!Z) return;
  if (RESEAU.verrou(N?.droits, 'agent') === 'verrouille') {
    remplir(Z,
      h('h2', { class: 'bz-t-titre-4 bz-ligne-icone' }, icone('bot'), h('span', { texte: 'Agents d’achat' }), h('span', { class: 'bz-badge bz-badge--active' }, icone('lock', { taille: 'sm' }), 'ACTIVE')),
      blocVide({ titre: 'Les agents d’achat font partie de Breizhcosystem ACTIVE.', texte: `Un agent cherche pour vous chez les membres vérifiés, dans votre budget. ${REGLE_AGENT}`,
        actions: N?.url ? lienExterne(N.url, 'Découvrir Breizhcosystem ACTIVE', 'bz-bouton bz-bouton--principal') : null }));
    return;
  }
  let mandats = [];
  let commandes = [];
  let erreur = null;
  try { [mandats, commandes] = await Promise.all([api('GET', '/nexus/mandats'), api('GET', '/nexus/commandes')]); } catch (e) { erreur = e; }
  if (!Z.isConnected) return;
  remplir(Z,
    h('div', {}, h('h2', { class: 'bz-t-titre-4 bz-ligne-icone' }, icone('bot'), h('span', { texte: 'Agents d’achat' })),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: `${REGLE_AGENT} L’argent ne passe jamais par Breizhcosystem.` })),
    h('section', { class: 'bz-carte bz-pile', id: 'demande-agent', 'aria-labelledby': 'agent-titre' }),
    erreur?.statut === 402 ? null : h('section', { class: 'bz-carte bz-pile', id: 'echanges-agents', 'aria-labelledby': 'echanges-titre' }),
    erreur ? (erreur.statut === 402
      ? blocVide({ titre: 'Les agents d’achat font partie de Breizhcosystem ACTIVE.', texte: `Vous fixez le budget du mois, il prépare les commandes et négocie. ${REGLE_AGENT} Il ne paie jamais à votre place.`, actions: N?.url ? lienExterne(N.url, 'Découvrir Breizhcosystem ACTIVE', 'bz-bouton bz-bouton--principal') : null })
      : messageEnLigne('critique', 'Les mandats et les commandes n’ont pas pu être chargés.', erreur.message))
      : h('div', { class: 'bz-deux-colonnes' }, blocMandats(mandats), blocCommandes(commandes)));
  rendreDemandeAgent();
  rendreEchangesAgents();
}

// ----- « Demander à l'agent » (recherche-moi ça)
function rendreDemandeAgent() {
  const Z = $('#demande-agent');
  if (!Z) return;
  const chercher = async (e) => {
    e.preventDefault();
    if (RA.texte.trim().length < 3) { RA.erreur = 'Dites en au moins 3 lettres ce qu’il vous faut.'; rendreDemandeAgent(); $('#agent-je-cherche')?.focus(); return; }
    const criteres = {
      texte: RA.texte.trim(),
      ...(RA.quantite !== '' ? { quantite: Number(RA.quantite) } : {}),
      ...(RA.departement.trim() ? { departement: RA.departement.trim().toUpperCase() } : {}),
      ...(RA.prixMax !== '' ? { prixMax: Number(RA.prixMax) } : {}),
    };
    Object.assign(RA, { enCours: true, erreur: null, publiee: false });
    rendreDemandeAgent();
    try {
      RA.propositions = (await api('POST', '/nexus/agent/recherche', criteres)).propositions;
      RA.criteres = criteres;
    } catch (err) { RA.erreur = err.message; RA.propositions = null; }
    RA.enCours = false;
    rendreDemandeAgent();
  };
  const champ = (id, libelle, attrs, cle) => h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }),
    h('input', { id, class: 'bz-champ__saisie', value: RA[cle], oninput: (e) => (RA[cle] = e.target.value), ...attrs }));
  remplir(Z,
    h('h3', { class: 'bz-carte__titre', id: 'agent-titre', texte: 'Demander à l’agent' }),
    h('p', { class: 'bz-t-petit', texte: 'Dites ce qu’il vous faut : l’agent cherche dans les stocks, catalogues et renforts des membres de Breizhcosystem. Rien n’est commandé sans votre clic.' }),
    h('form', { class: 'bz-formulaire', novalidate: true, onsubmit: chercher },
      champ('agent-je-cherche', 'Je cherche…', { type: 'text', maxlength: '200', autocomplete: 'off', placeholder: 'ex. 200 palettes Europe, un électricien jeudi', 'aria-invalid': RA.erreur && RA.texte.trim().length < 3 ? 'true' : null }, 'texte'),
      h('div', { class: 'bz-grille-champs' },
        champ('agent-quantite', 'Quantité (facultatif)', { type: 'number', min: '0', step: 'any', inputmode: 'decimal' }, 'quantite'),
        champ('agent-departement', 'Département', { type: 'text', maxlength: '3', inputmode: 'numeric', placeholder: '29', autocomplete: 'off' }, 'departement'),
        champ('agent-prix', 'Prix maximal (€ par unité)', { type: 'number', min: '0', step: 'any', inputmode: 'decimal' }, 'prixMax')),
      h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': RA.enCours ? 'true' : null }, icone(RA.enCours ? 'loader-circle' : 'search'), RA.enCours ? 'Recherche…' : 'Chercher'))),
    messageEnLigne('critique', RA.erreur),
    RA.propositions ? resultatsAgent(RA.propositions) : null);
}

async function publierDemandeAgent() {
  const c = RA.criteres;
  if (!c) return;
  try {
    await api('POST', '/nexus/agent/publier', { texte: c.texte, ...(c.quantite !== undefined ? { quantite: c.quantite } : {}), ...(c.departement ? { departement: c.departement } : {}) });
    RA.publiee = true;
    RA.erreur = null;
  } catch (err) { RA.erreur = err.message; }
  rendreDemandeAgent();
}

const commandable = (p) => p.type === 'stock' && typeof p.prixUnitaire === 'number' && p.prixUnitaire > 0;
const lignePrix = (p) => [
  p.quantite !== null ? `${nf.format(p.quantite)} ${p.unite ?? ''}`.trim() : null,
  p.prixUnitaire !== null ? `${nfEuroCts.format(p.prixUnitaire)} par ${p.unite ?? 'unité'}` : null,
  p.total !== null ? `total ${nfEuroCts.format(p.total)}` : null,
].filter(Boolean).join(' · ');

/** Résultats de l'agent : chacun est une « proposition à valider » (§4.28), en pointillés tant qu'elle n'est pas validée. */
function resultatsAgent(P) {
  const publier = (principal) => (RA.publiee
    ? encadre('ok', 'Demande publiée sur Breizhcosystem : les membres qui peuvent y répondre vous feront une proposition (réponses dans Breizhcosystem).')
    : h('button', { type: 'button', class: `bz-bouton ${principal ? 'bz-bouton--principal' : 'bz-bouton--secondaire'}`, onclick: publierDemandeAgent }, icone('megaphone'), 'Publier ma demande sur le réseau'));
  if (!P.length) return h('div', { class: 'bz-pile' }, blocVide({ titre: 'Rien sur le réseau pour l’instant.', texte: 'Publiez votre demande : les membres qui peuvent y répondre vous feront une proposition.', compact: true }), h('div', { class: 'bz-groupe-boutons' }, publier(true)));
  return h('div', { class: 'bz-pile' },
    h('p', { class: 'bz-t-petit', texte: `${pluriel(P.length, 'proposition', 'propositions')} de l’agent pour « ${RA.criteres?.texte ?? ''} » :` }),
    h('ul', { class: 'bz-nexus__grille', role: 'list' }, P.map((p, i) => h('li', {}, h('article', { class: 'bz-proposition', 'aria-labelledby': `prop-${i}` },
      h('p', { class: 'bz-proposition__tete bz-t-petit' }, icone('bot', { taille: 'sm' }), `Proposé par votre agent d’achat · ${TYPES_PROPOSITION[p.type] ?? p.type}`),
      h('h4', { class: 'bz-t-titre-4', id: `prop-${i}`, texte: p.titre }),
      h('p', { class: 'bz-t-petit' }, p.organisation, p.verifie ? h('span', { class: 'bz-badge bz-badge--ok' }, icone('shield-check', { taille: 'sm' }), 'SIRET vérifié') : null, p.departement ? ` · département ${p.departement}` : ''),
      lignePrix(p) ? h('p', { class: 'bz-t-chiffre', texte: lignePrix(p) }) : null,
      h('div', { class: 'bz-groupe-boutons' },
        commandable(p) ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--sm', onclick: () => commanderProposition(p) }, icone('shopping-cart', { taille: 'sm' }), 'Commander…') : null,
        // un prix se demande sur un stock (avec ou sans prix affiché) : c'est ce que le réseau accepte aujourd'hui ; pas de bouton si ce réseau ne connaît pas les échanges
        p.type === 'stock' && EA.erreur?.code !== 'echanges_indisponibles' ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => demanderPrixProposition(p) }, icone('tag', { taille: 'sm' }), 'Demander un prix') : null,
        commandable(p) ? null : h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => contacterMembre(p) }, icone('message-square', { taille: 'sm' }), 'Contacter')))))),
    h('div', { class: 'bz-groupe-boutons' }, h('span', { class: 'bz-t-petit bz-texte-2', texte: 'Rien ne convient ?' }), publier(false)));
}

function commanderProposition(p) {
  const voulu = RA.criteres?.quantite;
  // une clé par validation : renvoyée telle quelle si la personne réessaie après une erreur (pas de commande en double)
  const cle = crypto.randomUUID();
  confirmerCommande({
    surtitre: 'Commander', titre: p.titre, vendeur: p.organisation, verifie: p.verifie, unite: p.unite, prixUnitaire: p.prixUnitaire, modifiable: true,
    quantite: voulu && p.quantite ? Math.min(voulu, p.quantite) : (voulu ?? p.quantite ?? 1),
    envoyer: async (quantite) => {
      // le prix affiché dans cette boîte part avec la commande : s'il a changé depuis la recherche, elle est refusée
      const r = await api('POST', '/nexus/agent/commander', { stockId: p.id, quantite, cle, prixUnitaire: p.prixUnitaire });
      if (r.statut === 'a_valider') informer(`Commande${r.reference ? ` ${r.reference}` : ''} préparée, pas encore envoyée${typeof r.plafond === 'number' ? ` : elle dépasse le plafond fixé pour Living Business (${nf.format(r.plafond)} € HT par commande)` : ''}. Une personne de votre entreprise la valide sur ${MARQUE.reseau}, connectée.`, 'attention');
      else informer(`Commande${r.reference ? ` ${r.reference}` : ''} envoyée à ${p.organisation} : le vendeur doit encore la confirmer.`, 'ok');
      rendreAgents();
    },
  });
}

/** Validation humaine (§4.14 : de l'argent sort, donc confirmation) : quantité × prix = total, vendeur, et rappel. */
function confirmerCommande(o) {
  const S = { quantite: o.quantite, erreur: null, envoi: false };
  const total = () => (o.prixUnitaire === null || !(Number.isFinite(S.quantite) && S.quantite > 0) ? null : S.quantite * o.prixUnitaire);
  const ligneTotal = h('p', { class: 'bz-t-chiffre bz-commande__total', 'aria-live': 'polite' });
  const majTotal = () => remplir(ligneTotal, o.prixUnitaire === null
    ? `${nf.format(S.quantite)}${o.unite ? ` ${o.unite}` : ''} · prix à convenir avec le vendeur`
    : [`${Number.isFinite(S.quantite) ? nf.format(S.quantite) : '—'}${o.unite ? ` ${o.unite}` : ''} × ${nfEuroCts.format(o.prixUnitaire)} = `, h('strong', { texte: total() === null ? '—' : nfEuroCts.format(total()) })]);
  const D = dialogueVivant({
    titre: o.titre, surtitre: o.surtitre, taille: 'sm', alerte: true,
    onsubmit: async () => {
      if (S.envoi) return;
      if (!(Number.isFinite(S.quantite) && S.quantite > 0)) { S.erreur = 'Quantité : un nombre supérieur à 0.'; D.rendre(); return; }
      S.envoi = true; D.rendre();
      try { await o.envoyer(S.quantite); D.fermer(); } catch (err) { S.erreur = err.message; S.envoi = false; D.rendre(); }
    },
    contenu: () => {
      majTotal();
      const t = total();
      return {
        corps: [
          messageEnLigne('critique', S.erreur),
          h('p', {}, 'Vendeur : ', h('strong', { texte: o.vendeur ?? 'Membre Breizhcosystem' }), o.verifie ? h('span', { class: 'bz-badge bz-badge--ok' }, icone('shield-check', { taille: 'sm' }), 'vérifié') : null),
          o.modifiable ? h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'commande-quantite', texte: `Quantité${o.unite ? ` (${o.unite})` : ''}` }),
            h('input', { id: 'commande-quantite', class: 'bz-champ__saisie', type: 'number', min: '0', step: 'any', inputmode: 'decimal', required: true, value: String(S.quantite), oninput: (e) => { S.quantite = Number(e.target.value); majTotal(); } })) : null,
          ligneTotal,
          o.note ? h('p', { class: 'bz-t-petit', texte: o.note }) : null,
          encadre('info', `Le vendeur doit encore confirmer. ${SANS_NEXUS}`),
        ],
        pied: [
          h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', autofocus: true, onclick: () => D.fermer() }, 'Annuler'),
          h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, o.bouton ?? (t === null ? 'Confirmer la commande' : `Commander pour ${nfEuroCts.format(t)}`)),
        ],
      };
    },
  });
}

// ----- échanges entre agents : demander un prix n'engage à rien ; valider une proposition se fait sur Breizhcosystem
/** Demande de prix sur un stock trouvé par l'agent : quantité, prix souhaité facultatif. La réponse arrive dans « Échanges en cours ». */
function demanderPrixProposition(p) {
  const departement = RA.criteres?.departement ?? null;
  // une clé par demande : renvoyée telle quelle si la personne réessaie après une erreur (pas de demande en double) ; changée avec la saisie
  const S = { quantite: RA.criteres?.quantite ?? 1, prix: '', erreur: null, envoi: false, cle: cle() };
  const D = dialogueVivant({
    titre: p.titre, surtitre: 'Demander un prix', taille: 'sm',
    onsubmit: async () => {
      if (S.envoi) return;
      const souhaite = S.prix === '' ? null : Number(S.prix);
      if (!(Number.isFinite(S.quantite) && S.quantite > 0)) { S.erreur = 'Quantité : un nombre supérieur à 0.'; D.rendre(); $('#prix-quantite')?.focus(); return; }
      if (souhaite !== null && !(Number.isFinite(souhaite) && souhaite > 0)) { S.erreur = 'Prix souhaité : un montant supérieur à 0, ou laissez vide.'; D.rendre(); $('#prix-souhaite')?.focus(); return; }
      S.envoi = true; S.erreur = null; D.rendre();
      try {
        const r = await api('POST', '/nexus/echanges', { stockId: p.id, quantite: S.quantite, cle: S.cle, ...(souhaite !== null ? { prixSouhaite: souhaite } : {}), ...(departement ? { departement } : {}) });
        D.fermer();
        informer(...RESEAU.annonceDemandePrix(r.echange, p.organisation));
        rendreEchangesAgents();
      } catch (err) { S.erreur = err.message; S.envoi = false; D.rendre(); }
    },
    contenu: () => ({
      corps: [
        messageEnLigne('critique', S.erreur),
        h('p', {}, 'Vendeur : ', h('strong', { texte: p.organisation }), p.verifie ? h('span', { class: 'bz-badge bz-badge--ok' }, icone('shield-check', { taille: 'sm' }), 'vérifié') : null),
        h('p', { class: 'bz-t-petit', texte: `Votre agent demande au vendeur son prix et ce qu’il peut fournir${departement ? `, pour le département ${departement}` : ''}. Rien n’est commandé : cette demande ne vous engage à rien.` }),
        h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'prix-quantite', texte: `Quantité${p.unite ? ` (${p.unite})` : ''}` }),
          h('input', { id: 'prix-quantite', class: 'bz-champ__saisie', type: 'number', min: '0', step: 'any', inputmode: 'decimal', required: true, value: String(S.quantite), oninput: (e) => { S.quantite = Number(e.target.value); S.cle = cle(); } })),
        h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'prix-souhaite', texte: `Prix souhaité, hors taxes, par ${p.unite ?? 'unité'} (facultatif)` }),
          h('input', { id: 'prix-souhaite', class: 'bz-champ__saisie', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: S.prix, 'aria-describedby': 'prix-souhaite-aide', oninput: (e) => { S.prix = e.target.value; S.cle = cle(); } }),
          h('p', { class: 'bz-champ__aide', id: 'prix-souhaite-aide', texte: p.prixUnitaire !== null ? `Prix affiché : ${nfEuroCts.format(p.prixUnitaire)}. Laissez vide pour demander ce prix-là.` : 'Aucun prix affiché : laissez vide pour que le vendeur propose le sien.' })),
        encadre('info', 'La réponse arrivera dans « Échanges en cours ».', 'Si elle vous convient, une personne de votre entreprise la validera sur Breizhcosystem ; le vendeur confirmera ensuite.'),
      ],
      pied: [
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler'),
        h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, icone('send'), 'Envoyer la demande'),
      ],
    }),
  });
}

/** Un échange de la liste : sens et titre, état en clair, chiffres, suite pour la personne, et le lien vers Breizhcosystem s'il y a à y faire. */
function ligneEchange(e, page) {
  const p = RESEAU.presenterEchange(e);
  return h('li', { class: 'bz-commande' },
    h('div', { class: 'bz-commande__tete' },
      h('p', { class: 'bz-t-label', texte: `${RESEAU.sensEchange(e)} · ${e.titre}` }),
      h('span', { class: `bz-badge${p.ton ? ` bz-badge--${p.ton}` : ''}` }, p.ton ? icone(ICONE_TON[p.ton], { taille: 'sm' }) : null, p.etat)),
    p.chiffres ? h('p', { class: 'bz-t-chiffre bz-commande__total', texte: p.chiffres }) : null,
    p.detail ? h('p', { class: 'bz-t-petit bz-texte-2', texte: p.detail }) : null,
    p.suite ? h('p', { class: 'bz-t-petit', texte: p.suite }) : null,
    p.action && page ? h('div', { class: 'bz-groupe-boutons' }, lienExterne(page, p.libelleAction, `bz-bouton ${e.attend === 'vous' ? 'bz-bouton--principal' : 'bz-bouton--secondaire'} bz-bouton--sm`)) : null);
}

/** « Échanges en cours » : ce qui attend une personne de l'entreprise d'abord, puis le reste ; à part, les derniers terminés. */
function dessinerEchangesAgents() {
  const Z = $('#echanges-agents');
  if (!Z) return;
  const r = EA.reponse;
  // page du réseau où une personne valide ou répond : donnée par la passerelle, d'après l'adresse réglée dans le jeu
  const page = typeof r?.page === 'string' && /^https?:\/\//.test(r.page) ? r.page : null;
  const g = RESEAU.rangerEchanges(r?.echanges);
  const enCours = [...g.aFaire, ...g.enAttente];
  const liste = (echanges) => h('ul', { class: 'bz-liste-simple', role: 'list' }, echanges.map((e) => ligneEchange(e, page)));
  const absent = EA.erreur?.code === 'echanges_indisponibles';
  remplir(Z,
    h('div', { class: 'bz-carte__tete' }, h('h3', { class: 'bz-carte__titre', id: 'echanges-titre', texte: 'Échanges en cours' }),
      g.aFaire.length ? h('span', { class: 'bz-badge bz-badge--attention' }, icone('triangle-alert', { taille: 'sm' }), `${g.aFaire.length} à voir par vous`) : null),
    h('p', { class: 'bz-t-petit', texte: REGLE_ECHANGES }),
    EA.erreur ? (absent ? messageEnLigne('info', EA.erreur.message) : messageEnLigne('critique', 'Les échanges n’ont pas pu être chargés.', EA.erreur.message)) : null,
    !r ? (EA.erreur ? null : h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Chargement des échanges…' }))
      : enCours.length || g.termines.length ? [
        enCours.length ? liste(enCours) : h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Aucun échange en cours.' }),
        g.termines.length ? [h('h4', { class: 'bz-t-label', texte: 'Terminés récemment' }), liste(g.termines)] : null,
      ] : blocVide({ titre: 'Aucun échange pour l’instant.', texte: 'Cherchez ci-dessus ce qu’il vous faut, puis choisissez « Demander un prix » sur un stock : la réponse du vendeur arrivera ici.', compact: true }),
    r && page ? h('p', { class: 'bz-t-petit bz-texte-2' }, 'Pour refuser une proposition, annuler une demande ou régler les réponses de votre propre agent : ', lienExterne(page, 'ouvrir les échanges sur Breizhcosystem', 'bz-lien')) : null);
}
async function rendreEchangesAgents() {
  if (!$('#echanges-agents')) return;
  dessinerEchangesAgents();
  try { EA.reponse = await api('GET', '/nexus/echanges'); EA.erreur = null; } catch (e) { EA.erreur = e; }
  dessinerEchangesAgents();
}

function contacterMembre(p) {
  const c = RA.criteres;
  const S = { message: `Bonjour, je cherche : ${c?.texte ?? p.titre}${c?.quantite ? ` (quantité : ${nf.format(c.quantite)})` : ''}. Votre offre « ${p.titre} » m’intéresse : pouvez-vous me faire une proposition ?`, erreur: null, resultat: null, envoi: false };
  const D = dialogueVivant({
    titre: p.organisation, surtitre: 'Contacter', taille: 'md',
    onsubmit: async () => {
      if (S.envoi || S.resultat) { D.fermer(); return; }
      S.envoi = true; D.rendre();
      try { S.resultat = await api('POST', '/nexus/contacter', { objet: p.type, ref: p.id, message: S.message }); S.erreur = null; } catch (err) { S.erreur = err.message; }
      S.envoi = false; D.rendre();
    },
    contenu: () => ({
      corps: S.resultat ? [
        encadre('ok', `Demande envoyée à ${S.resultat.organisation ?? p.organisation} : elle la reçoit sur Breizhcosystem.`),
        S.resultat.contact ? h('div', { class: 'bz-carte bz-carte--plate' },
          h('p', {}, 'Contact : ', h('strong', { texte: S.resultat.contact.nom ?? '' }), S.resultat.contact.email ? ` · ${S.resultat.contact.email}` : ''),
          S.resultat.contact.email ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => copier(S.resultat.contact.email, 'Adresse e-mail copiée') }, icone('copy', { taille: 'sm' }), 'Copier l’e-mail')) : null) : null,
      ] : [
        messageEnLigne('critique', S.erreur),
        h('p', { class: 'bz-t-petit', texte: `À propos de : ${p.titre}` }),
        h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'contact-message', texte: 'Votre message' }),
          h('textarea', { id: 'contact-message', class: 'bz-champ__saisie', rows: '4', maxlength: '2000', oninput: (e) => (S.message = e.target.value) }, S.message)),
      ],
      pied: S.resultat ? [h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal' }, 'Fermer')]
        : [h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler'), h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, icone('send'), 'Envoyer')],
    }),
  });
}

// ----- mandats (budget, catégories, remise visée : jamais d'achat sans validation)
function blocMandats(mandats) {
  const N = { nom: '', budgetMensuel: '', categories: '', remise: '5', erreur: null };
  const racine = h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'mandats-titre' });
  const lancer = async () => {
    try {
      const r = await api('POST', '/nexus/agent/lancer', {});
      informer(r.preparees ? `Agent passé : ${pluriel(r.preparees, 'commande préparée', 'commandes préparées')}, à vous de ${accord(r.preparees, 'la', 'les')} valider.` : 'Agent passé : rien à préparer pour l’instant.', 'ok');
      rendreAgents();
    } catch (err) { N.erreur = err.message; rendre(); }
  };
  const champ = (id, libelle, aide, attrs, cle) => h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }),
    h('input', { id, class: 'bz-champ__saisie', value: N[cle], 'aria-describedby': aide ? `${id}-aide` : null, oninput: (e) => (N[cle] = e.target.value), ...attrs }),
    aide ? h('p', { class: 'bz-champ__aide', id: `${id}-aide`, texte: aide }) : null);
  const rendre = () => remplir(racine,
    h('h3', { class: 'bz-carte__titre', id: 'mandats-titre', texte: 'Vos mandats' }),
    h('p', { class: 'bz-t-petit', texte: 'Un mandat dit à l’agent quoi préparer et dans quel budget. Il ne commande jamais seul : chaque commande attend votre validation.' }),
    mandats.length ? h('ul', { class: 'bz-liste-simple', role: 'list' }, mandats.map((m) => h('li', {},
      h('label', { class: 'bz-interrupteur' },
        h('input', { type: 'checkbox', role: 'switch', checked: m.actif, onchange: async (e) => { try { await api('POST', `/nexus/mandats/${m.id}/${e.target.checked ? 'activer' : 'desactiver'}`, {}); } catch (err) { N.erreur = err.message; } rendreAgents(); } }),
        h('span', { class: 'bz-pile bz-pile--serre' }, h('span', { class: 'bz-t-label', texte: m.nom }), h('span', { class: 'bz-t-petit bz-texte-2', texte: `${nfEuro.format(m.budgetMensuel)} par mois · ${m.categories.length ? m.categories.join(', ') : 'toutes catégories'} · remise visée ${Math.round(m.remiseCible * 100)} %` })),
        h('span', { class: 'bz-interrupteur__etat', 'aria-hidden': 'true', texte: m.actif ? 'Actif' : 'En pause' }))))) : blocVide({ titre: 'Aucun mandat : créez-en un en trois réponses.', compact: true }),
    messageEnLigne('critique', N.erreur),
    h('form', { class: 'bz-formulaire', onsubmit: async (e) => {
      e.preventDefault();
      if (!(Number(N.budgetMensuel) > 0)) { N.erreur = 'Indiquez un budget par mois supérieur à 0 €.'; rendre(); $('#mandat-budget')?.focus(); return; }
      try {
        await api('POST', '/nexus/mandats', {
          nom: N.nom.trim() || 'Achats courants',
          budgetMensuel: Number(N.budgetMensuel),
          categories: N.categories.split(',').map((x) => x.trim()).filter(Boolean),
          ...(N.remise !== '' ? { remiseCible: Math.min(30, Math.max(0, Number(N.remise) || 0)) / 100 } : {}),
        });
        informer('Mandat créé : l’agent préparera les commandes, vous les validerez.', 'ok');
        rendreAgents();
      } catch (err) { N.erreur = err.message; rendre(); }
    } },
      champ('mandat-budget', 'Budget par mois (€)', 'L’agent ne prépare rien au-delà. Chaque commande attend quand même votre validation.', { type: 'number', min: '0', step: '1', inputmode: 'numeric', required: true }, 'budgetMensuel'),
      champ('mandat-categories', 'Catégories (séparées par des virgules, vide pour toutes)', null, { type: 'text', maxlength: '400', placeholder: 'Emballages, Bois, Consommables' }, 'categories'),
      champ('mandat-remise', 'Remise à négocier (%)', 'L’agent la propose au vendeur, qui accepte ou confirme au prix affiché.', { type: 'number', min: '0', max: '30', step: '1', inputmode: 'numeric' }, 'remise'),
      champ('mandat-nom', 'Nom du mandat (facultatif)', null, { type: 'text', maxlength: '80', placeholder: 'Achats courants' }, 'nom'),
      h('div', { class: 'bz-groupe-boutons' },
        h('button', { type: 'submit', class: 'bz-bouton bz-bouton--secondaire' }, icone('plus'), 'Créer le mandat'),
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: lancer }, icone('play'), 'Lancer l’agent maintenant'))));
  rendre();
  return racine;
}

// ----- commandes : validation, confirmation par le vendeur, paiement direct au vendeur
const prixCommande = (c) => c.prixPropose ?? c.prixUnitaire;
function blocCommandes(commandes) {
  const aValider = commandes.filter((c) => c.achat && c.statut === 'a_valider').length;
  return h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'commandes-titre' },
    h('div', { class: 'bz-carte__tete' }, h('h3', { class: 'bz-carte__titre', id: 'commandes-titre', texte: 'Commandes' }),
      aValider ? h('span', { class: 'bz-badge bz-badge--attention' }, icone('triangle-alert', { taille: 'sm' }), `${aValider} à valider`) : null),
    commandes.length ? h('ul', { class: 'bz-liste-simple', role: 'list' }, commandes.map(ligneCommande)) : blocVide({ titre: 'Aucune commande pour l’instant.', compact: true }));
}
function ligneCommande(c) {
  const pu = prixCommande(c);
  const prix = pu === null ? 'prix à convenir'
    : c.prixPropose !== null && c.prixUnitaire !== null && c.prixPropose !== c.prixUnitaire ? `${nfEuroCts.format(c.prixPropose)} (affiché ${nfEuroCts.format(c.prixUnitaire)})` : nfEuroCts.format(pu);
  const total = pu === null ? null : c.quantite * pu;
  const ton = tonCommande(c);
  return h('li', { class: 'bz-commande', 'data-statut': c.statut },
    h('div', { class: 'bz-commande__tete' },
      h('p', { class: 'bz-t-label' }, `${c.achat ? 'Achat' : 'Vente'} · ${c.titre}`, c.reference ? h('span', { class: 'bz-t-code bz-texte-2', 'data-brut': '', texte: ` ${c.reference}` }) : null),
      h('span', { class: `bz-badge${ton ? ` bz-badge--${ton}` : ''}` }, ton ? icone(ICONE_TON[ton], { taille: 'sm' }) : null, (!c.achat && LIB_CMD_VENTE[c.statut]) || LIB_CMD[c.statut] || c.statut)),
    h('p', { class: 'bz-t-petit bz-texte-2', texte: `${c.autre ?? 'Membre Breizhcosystem'} · ${nf.format(c.quantite)} × ${prix}${total !== null ? ` = ${nfEuroCts.format(total)}` : ''}${c.parAgent ? ' · préparée par l’agent' : ''}` }),
    actionsCommande(c, total));
}
function actionsCommande(c, total) {
  const agir = async (action, corps = {}, message = 'Commande mise à jour.') => {
    try {
      const r = await api('POST', `/nexus/commandes/${c.id}/${action}`, corps);
      informer(typeof message === 'function' ? message(r) : message, 'ok');
      rendreAgents();
    } catch (e) { informer(e.message, 'erreur'); }
  };
  const bouton = (libelle, faire, principal = false, ic = null) => h('button', { type: 'button', class: `bz-bouton ${principal ? 'bz-bouton--principal' : 'bz-bouton--secondaire'} bz-bouton--sm`, onclick: faire }, ic ? icone(ic, { taille: 'sm' }) : null, libelle);
  const annuler = bouton('Annuler la commande', () => agir('annuler', {}, 'Commande annulée.'));
  if (c.achat) {
    if (c.statut === 'a_valider') {
      return h('div', { class: 'bz-groupe-boutons' },
        bouton('Valider…', () => confirmerCommande({
          surtitre: 'Valider la commande', titre: c.titre, vendeur: c.autre, verifie: false, quantite: c.quantite, unite: null, prixUnitaire: prixCommande(c), modifiable: false,
          bouton: total !== null ? `Valider l’achat de ${nfEuroCts.format(total)}` : 'Valider la commande',
          note: c.prixPropose !== null && c.prixUnitaire !== null && c.prixPropose !== c.prixUnitaire ? `Prix négocié par l’agent : le vendeur peut l’accepter ou confirmer au prix affiché (${nfEuroCts.format(c.prixUnitaire)}).` : null,
          envoyer: async () => {
            await api('POST', `/nexus/commandes/${c.id}/valider`, {});
            informer(`Commande${c.reference ? ` ${c.reference}` : ''} validée : le vendeur doit encore la confirmer.`, 'ok');
            rendreAgents();
          },
        }), true, 'check'),
        annuler);
    }
    if (c.statut === 'validee') return h('div', { class: 'bz-groupe-boutons' }, h('span', { class: 'bz-t-petit bz-texte-2', texte: 'Le vendeur doit encore confirmer.' }), annuler);
    if (c.statut === 'confirmee') return blocPaiement(c, total, agir);
    if (c.statut === 'paiement_annonce') return h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Paiement annoncé : le vendeur confirme sa réception.' });
    return null;
  }
  if (c.statut === 'validee') {
    return h('div', { class: 'bz-groupe-boutons' },
      bouton('Accepter le prix proposé', () => agir('confirmer', { prix: 'propose' }, 'Commande confirmée : l’acheteur peut payer.'), true, 'check'),
      c.prixPropose !== null && c.prixPropose !== c.prixUnitaire ? bouton('Confirmer au prix affiché', () => agir('confirmer', { prix: 'affiche' }, 'Commande confirmée au prix affiché.')) : null,
      bouton('Refuser', () => agir('refuser', {}, 'Commande refusée.')));
  }
  if (c.statut === 'confirmee' || c.statut === 'paiement_annonce') {
    return h('div', { class: 'bz-groupe-boutons' },
      h('span', { class: 'bz-t-petit bz-texte-2', texte: c.statut === 'paiement_annonce' ? 'L’acheteur indique avoir payé : vérifiez votre compte.' : 'En attente du paiement de l’acheteur.' }),
      bouton('Paiement reçu', () => agir('recu', {}, 'Paiement reçu : commande payée.'), c.statut === 'paiement_annonce', 'circle-check'));
  }
  return null;
}

function blocPaiement(c, total, agir) {
  const p = c.paiement ?? { stripe: false, virement: false, lien: null };
  const lien = estLienHttps(p.lien) ? p.lien : null;
  const prepare = PAIEMENTS_NEXUS.get(c.id) ?? {};
  const aucun = !p.stripe && !p.virement && !lien;
  const bouton = (libelle, faire, principal = false, ic = null) => h('button', { type: 'button', class: `bz-bouton ${principal ? 'bz-bouton--principal' : 'bz-bouton--secondaire'} bz-bouton--sm`, onclick: faire }, ic ? icone(ic, { taille: 'sm' }) : null, libelle);
  return h('div', { class: 'bz-pile bz-pile--serre' },
    h('p', { class: 'bz-t-petit', texte: `À payer${total !== null ? ` : ${nfEuroCts.format(total)}` : ''}. ${SANS_NEXUS}` }),
    aucun ? h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Le vendeur n’a pas encore indiqué de moyen de paiement : contactez-le, puis annoncez votre paiement.' })
      : h('div', { class: 'bz-groupe-boutons' },
        p.stripe ? bouton('Payer en ligne', () => payerEnLigne(c), true, 'wallet') : null,
        p.virement ? bouton('Payer par virement', () => payerParVirement(c), !p.stripe, 'landmark') : null,
        lien ? lienExterne(lien, 'Ouvrir le lien du vendeur', `bz-bouton ${p.stripe || p.virement ? 'bz-bouton--secondaire' : 'bz-bouton--principal'} bz-bouton--sm`) : null),
    prepare.stripe ? h('p', { class: 'bz-t-petit' }, 'Page de paiement prête : ', lienExterne(prepare.stripe, 'ouvrir la page sécurisée Stripe', 'bz-lien')) : null,
    prepare.virement ? blocVirement(prepare.virement) : null,
    h('div', { class: 'bz-groupe-boutons' },
      p.virement || lien || aucun ? bouton('J’ai payé', () => agir('annoncer', {}, 'Paiement annoncé : le vendeur confirme sa réception.'), false, 'check') : null,
      p.stripe ? bouton('Vérifier le paiement en ligne', () => agir('verifier', {}, (r) => (r.statut === 'payee' ? 'Paiement en ligne reçu : commande payée.' : 'Paiement en ligne pas encore reçu : réessayez dans un instant.')), false, 'refresh-cw') : null));
}

async function payerEnLigne(c) {
  // onglet ouvert tout de suite (au clic) : ouvert après l'attente, le navigateur le bloquerait
  const onglet = window.open('', '_blank');
  if (onglet) onglet.opener = null;
  try {
    const r = await api('POST', `/nexus/commandes/${c.id}/payer`, { mode: 'stripe' });
    if (!estPageStripe(r.url)) throw new Error('Lien de paiement refusé : ce n’est pas une page Stripe Checkout.');
    PAIEMENTS_NEXUS.set(c.id, { stripe: r.url });
    if (onglet) onglet.location.replace(r.url);
    informer(onglet ? 'Page de paiement sécurisée (Stripe) ouverte dans un nouvel onglet.' : 'Page de paiement prête : ouvrez-la avec le lien sous la commande.', 'ok');
  } catch (e) {
    onglet?.close();
    informer(e.message, 'erreur');
  }
  rendreAgents();
}

async function payerParVirement(c) {
  try {
    PAIEMENTS_NEXUS.set(c.id, { virement: await api('POST', `/nexus/commandes/${c.id}/payer`, { mode: 'virement' }) });
  } catch (e) { informer(e.message, 'erreur'); }
  rendreAgents();
}

function blocVirement(v) {
  const ligneCopie = (libelle, valeur, affiche, copie) => h('div', { class: 'bz-virement__ligne' },
    h('dt', { class: 'bz-t-petit bz-texte-2', texte: libelle }), h('dd', { class: 'bz-t-identifiant', 'data-brut': '', texte: affiche }),
    h('dd', {}, h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', 'aria-label': `Copier ${libelle.toLowerCase()}`, onclick: () => copier(valeur, copie) }, icone('copy', { taille: 'sm' }), 'Copier')));
  return h('div', { class: 'bz-carte bz-carte--plate bz-pile' },
    h('dl', { class: 'bz-virement' },
      ligneCopie('IBAN', v.iban, v.iban.replace(/(.{4})/g, '$1 ').trim(), 'IBAN copié'),
      ligneCopie('Titulaire', v.titulaire, v.titulaire, 'Titulaire copié'),
      ligneCopie('Montant', v.montant.toFixed(2).replace('.', ','), nfEuroCts.format(v.montant), 'Montant copié'),
      ligneCopie('Référence', v.reference, v.reference, 'Référence copiée')),
    encadre('info', `Indiquez la référence ${v.reference} dans le libellé du virement : c’est ainsi que le vendeur reconnaît votre paiement. Puis touchez « J’ai payé ».`));
}
function repondreBesoin(x) {
  const S = { message: '', erreur: null, envoi: false };
  const D = dialogueVivant({
    titre: x.titre, surtitre: 'Répondre', taille: 'md',
    onsubmit: async () => {
      if (!S.message.trim()) { S.erreur = 'Écrivez votre réponse.'; D.rendre(); $('#reponse-besoin')?.focus(); return; }
      S.envoi = true; D.rendre();
      try { await api('POST', `/nexus/besoins/${encodeURIComponent(x.ref)}/repondre`, { message: S.message }); D.fermer(); informer('Réponse envoyée : l’entreprise la reçoit sur Breizhcosystem.', 'ok'); }
      catch (err) {
        S.envoi = false;
        if (err.statut === 402) { D.fermer(); expliquerVerrou('Répondre avec Breizhcosystem ACTIVE', 'Répondre à une demande du réseau fait partie de Breizhcosystem ACTIVE. Votre brouillon est gardé jusqu’à la fin de la session.', NEXUS_ETAT?.url); return; }
        S.erreur = err.message; D.rendre();
      }
    },
    contenu: () => ({
      corps: [
        messageEnLigne('critique', S.erreur),
        h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'reponse-besoin', texte: 'Votre message' }),
          h('textarea', { id: 'reponse-besoin', class: 'bz-champ__saisie', rows: '4', maxlength: '2000', 'aria-invalid': S.erreur ? 'true' : null, oninput: (e) => (S.message = e.target.value) }, S.message)),
      ],
      pied: [h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler'), h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, icone('send'), 'Envoyer')],
    }),
  });
}

// ---------------------------------------------------------------- clients en difficulté (Bodacc)
function blocBodacc() {
  const b = E.monde.bodacc;
  if (!b) return null;
  const activer = async (actif) => {
    try { await api('PUT', '/bodacc', { actif }); informer(actif ? 'Surveillance activée : vérification chaque jour au Bodacc.' : 'Surveillance désactivée.', 'ok'); await charger(); } catch (e) { informer(e.message, 'erreur'); }
  };
  if (!b.actif) {
    return E.monde.profil.peutAdministrer && !E.monde.organisation.demo ? h('section', { class: 'bz-pile' },
      h('p', { class: 'bz-t-label', texte: 'Être prévenu si un client est en difficulté' }),
      h('p', { class: 'bz-t-petit', texte: `Chaque jour, Living Business vérifie au Bodacc (données publiques, gratuites) si l’un de vos ${pluriel(b.surveilles, 'client', 'clients')} avec SIRET fait l’objet d’une procédure collective. Seuls leurs numéros SIREN sont envoyés au service public.` }),
      h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => activer(true) }, icone('bell'), 'Activer la surveillance'))) : null;
  }
  if (!b.alertes.length) return h('p', { class: 'bz-t-petit bz-ligne-icone' }, iconeEtat('ok', { taille: 'sm', decoratif: true }), h('span', { texte: `Bodacc : aucun de vos ${pluriel(b.surveilles, 'client surveillé', 'clients surveillés')} en procédure collective${b.verifieLe ? ` (vérifié ${dateRelative(b.verifieLe)})` : ''}.` }));
  return h('section', { class: 'bz-resultat', 'data-ton': 'critique', 'aria-labelledby': 'bodacc-titre' },
    iconeEtat('critique', { decoratif: true }),
    h('div', {},
      h('p', { class: 'bz-t-label', id: 'bodacc-titre', texte: 'Clients en difficulté : procédures collectives publiées au Bodacc (12 derniers mois)' }),
      h('ul', { class: 'bz-liste-simple' }, b.alertes.map((a) => h('li', {},
        h('button', { type: 'button', class: 'bz-lien', onclick: () => selectionner(a.objetId), texte: sansDemo(a.nom) }),
        h('span', { texte: ` · ${a.nature} (${date(a.le)})` }),
        a.url ? [' · ', lienExterne(a.url, 'voir l’annonce', 'bz-lien')] : null))),
      h('p', { class: 'bz-t-petit', texte: 'Avant de livrer à crédit : demandez un paiement d’avance ou un acompte, et déclarez vos créances au mandataire si besoin.' })));
}
function proposerNexus(o) {
  const roles = o?.roles?.map((r) => r.id) ?? [];
  const S = { relation: roles.includes('fournisseur') ? 'fournisseur' : roles.includes('client') ? 'client' : roles.includes('partenaire') ? 'partenaire' : 'ami', destinataire: o ? (valeurDe(o, 'email') ?? sansDemo(o.nom)) : '', resultat: null, erreur: null, envoi: false };
  const D = dialogueVivant({
    titre: o ? sansDemo(o.nom) : 'Inviter une entreprise', surtitre: 'Proposer Breizhcosystem', taille: 'md',
    onsubmit: async () => {
      if (S.resultat) { D.fermer(); return; }
      S.envoi = true; D.rendre();
      try { S.resultat = await api('POST', '/nexus/proposer', { relation: S.relation, destinataire: S.destinataire, canal: 'lien' }); S.erreur = null; } catch (err) { S.erreur = err.message; }
      S.envoi = false; D.rendre();
    },
    contenu: () => ({
      corps: S.resultat ? [
        encadre('ok', 'Invitation prête : un mois offert pour vous deux dès son inscription.'),
        h('div', { class: 'bz-groupe-boutons' },
          lienExterne(S.resultat.partage.whatsapp, 'WhatsApp', 'bz-bouton bz-bouton--principal bz-bouton--sm'),
          h('a', { class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', href: S.resultat.partage.email }, icone('mail', { taille: 'sm' }), 'E-mail'),
          h('a', { class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', href: S.resultat.partage.sms }, icone('message-square', { taille: 'sm' }), 'SMS'),
          lienExterne(S.resultat.partage.linkedin, 'LinkedIn', 'bz-bouton bz-bouton--secondaire bz-bouton--sm')),
        blocCode(S.resultat.lien, 'Copier le lien'),
        h('details', { class: 'bz-repli' }, h('summary', {}, h('span', { class: 'bz-repli__titre', texte: 'Voir le message' }), icone('chevron-down', { taille: 'sm' })), h('div', { class: 'bz-repli__corps' }, h('p', { class: 'bz-t-petit', texte: S.resultat.messages.sms }))),
      ] : [
        messageEnLigne('critique', S.erreur),
        S.erreur && /Reliez|relier|Adresse de Breizhcosystem/.test(S.erreur) ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { D.fermer(); changerVue('reglages:nexus'); } }, icone('link'), 'Relier Breizhcosystem (gratuit)')) : null,
        h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'proposer-relation', texte: 'Cette entreprise est votre…' }),
          h('div', { class: 'bz-select' }, h('select', { id: 'proposer-relation', class: 'bz-champ__saisie', onchange: (e) => (S.relation = e.target.value) }, [['client', 'Client'], ['fournisseur', 'Fournisseur'], ['partenaire', 'Partenaire'], ['ami', 'Contact ou ami']].map(([k, l]) => h('option', { value: k, selected: S.relation === k, texte: l }))), icone('chevron-down', { taille: 'sm' }))),
        h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: 'proposer-destinataire', texte: 'Destinataire (e-mail ou nom)' }),
          h('input', { id: 'proposer-destinataire', class: 'bz-champ__saisie', type: 'text', maxlength: '200', autocomplete: 'off', value: S.destinataire, oninput: (e) => (S.destinataire = e.target.value) })),
      ],
      pied: S.resultat ? [h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal' }, 'Terminé')]
        : [h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler'), h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, icone('link'), 'Préparer l’invitation')],
    }),
  });
}

// ---------------------------------------------------------------- satisfaction (clients et collaborateurs, §6.1 P8)
/* Courbe uPlot (moyenne mensuelle sur 12 mois, un mois sans réponse laisse un trou) et son tableau ; clients en
   tableau (liste sur téléphone) ; envoi du formulaire en dialogue ; baromètre d'équipe anonyme. Module pur :
   web/satisfaction.js. */
let SATIS = null;
const chargerSatisfaction = async () => (SATIS ??= await import('/satisfaction.js'));
const MOIS_AXE = new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' });
const MOIS_LONG = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Petite courbe des notes d'un client (sparkline 80 × 24, §4.22), décorative : la tendance est écrite à côté. */
function courbeNotes(historique) {
  const s = svg('svg', { class: 'bz-sparkline', viewBox: '0 0 80 24', 'aria-hidden': 'true', focusable: 'false' });
  const pts = historique.map((x, i) => [historique.length === 1 ? 40 : (i / (historique.length - 1)) * 76 + 2, 22 - (x.note / 10) * 20]);
  if (pts.length >= 2) s.append(svg('polyline', { class: 'bz-sparkline__trait', points: pts.map((p) => p.join(',')).join(' ') }));
  const [x, y] = pts.at(-1) ?? [40, 12];
  s.append(svg('circle', { class: 'bz-sparkline__point', cx: x, cy: y, r: 3 }));
  return s;
}

/** Ouvre le dialogue d'envoi d'un formulaire (lien personnel, e-mail prérempli, copie), sans rien envoyer de lui-même. */
async function envoyerFormulaire(cible) {
  const nom = sansDemo(E.monde.objets.find((o) => o.id === cible)?.nom ?? '');
  const S = { liens: null, erreur: null };
  const D = montrerLiens(S, `Formulaire pour ${nom}`);
  try { S.liens = [{ ...(await api('POST', '/enquetes', { cible })), nom }]; charger(); } catch (e) { S.erreur = e.message; }
  D.rendre();
}

/**
 * Rapprochements par le nom, à confirmer (administrateur) : la fiche du jeu et ce que l'outil dit du même nom, côte à
 * côte. « C'est la même » : lien ordinaire. « Ce n'est pas elle » : l'outil aura sa propre fiche.
 */
async function confirmerRapprochements(c, apres) {
  const S = { liste: null, erreur: null };
  const charger = async () => {
    try { S.liste = (await api('GET', '/synchro/rapprochements')).rapprochements.filter((r) => r.connecteur === c.id); } catch (e) { S.erreur = e.message; }
  };
  const decider = async (r, decision) => {
    try {
      await api('POST', `/synchro/${c.id}/rapprochements`, { externeId: r.externeId, decision });
      informer(decision === 'confirmer' ? `« ${sansDemo(r.fiche.nom)} » suit maintenant ${c.nom}.` : `« ${sansDemo(r.fiche.nom)} » n’est plus reliée : ${c.nom} aura sa propre fiche à la prochaine synchronisation.`, 'ok');
    } catch (e) { S.erreur = e.message; }
    await charger();
    D.rendre();
    if (S.liste && !S.liste.length) { D.fermer(); apres?.(); }
  };
  const cote = (titre, x) => h('div', {}, h('p', { class: 'bz-t-micro bz-texte-2', texte: titre }), h('p', { class: 'bz-t-label', texte: sansDemo(x.nom) }),
    h('p', { class: 'bz-t-petit bz-texte-2', texte: [x.email ? `E-mail : ${x.email}` : 'E-mail : non renseigné', x.siret ? `SIRET : ${x.siret}` : 'SIRET : non renseigné'].join(' · ') }));
  const D = dialogueVivant({
    titre: 'Est-ce bien la même fiche ?', surtitre: c.nom, taille: 'md',
    contenu: () => ({
      corps: S.erreur ? [messageEnLigne('critique', 'Les rapprochements n’ont pas pu être lus.', S.erreur)]
        : !S.liste ? [h('p', { class: 'bz-t-petit', 'aria-busy': 'true', texte: 'Lecture…' })]
        : [
          h('p', { class: 'bz-t-petit', texte: `Ces fiches ont été reliées à ${c.nom} parce qu’elles portent le même nom, sans e-mail ni SIRET commun. Tant que vous n’avez pas confirmé, ${c.nom} ne reçoit rien d’elles et n’y inscrit ni e-mail, ni contact, ni SIRET, ni adresse.` }),
          h('ul', { class: 'bz-liste-simple', role: 'list' }, S.liste.map((r) => h('li', { class: 'bz-carte bz-carte--plate bz-pile' },
            cote('Votre fiche', r.fiche), cote(`Dans ${c.nom}`, r.cote),
            h('div', { class: 'bz-groupe-boutons' },
              h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--sm', onclick: () => decider(r, 'confirmer') }, icone('check', { taille: 'sm' }), 'C’est la même'),
              h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => decider(r, 'separer') }, icone('unlink', { taille: 'sm' }), 'Ce n’est pas elle'))))),
        ],
      pied: [h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { D.fermer(); apres?.(); } }, 'Fermer')],
    }),
  });
  await charger();
  D.rendre();
  return D;
}

/** Liens de formulaires (un ou plusieurs) : chacun est personnel, à usage unique, valable 30 jours. */
function montrerLiens(S, titre) {
  const D = dialogueVivant({
    titre, surtitre: 'Formulaire de satisfaction', taille: 'md',
    contenu: () => ({
      corps: S.erreur ? [messageEnLigne('critique', 'Le formulaire n’a pas pu être préparé.', S.erreur)]
        : !S.liens ? [h('p', { class: 'bz-t-petit', 'aria-busy': 'true', texte: 'Préparation du lien…' })]
        : [
          h('p', { class: 'bz-t-petit', texte: 'Chaque lien est personnel, à usage unique, valable 30 jours. La réponse s’affiche en direct, datée, sur la fiche et sur la carte. Rien ne part sans vous : vous choisissez comment l’envoyer.' }),
          h('ul', { class: 'bz-liste-simple bz-liens-formulaires', role: 'list' }, S.liens.map((l) => h('li', { class: 'bz-carte bz-carte--plate' },
            h('p', { class: 'bz-t-label', texte: sansDemo(l.nom) }),
            h('div', { class: 'bz-groupe-boutons' },
              h('a', { class: 'bz-bouton bz-bouton--principal bz-bouton--sm', href: l.mailto }, icone('mail', { taille: 'sm' }), l.email ? `Écrire à ${l.email}` : 'Préparer un e-mail'),
              h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => copier(l.lien, 'Lien copié') }, icone('copy', { taille: 'sm' }), 'Copier le lien'),
              lienExterne(l.lien, 'Ouvrir', 'bz-bouton bz-bouton--fantome bz-bouton--sm'))))),
        ],
      pied: [
        S.liens?.length > 1 ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => telecharger('liens-formulaires.csv', texteCsv([['Nom', 'E-mail', 'Lien'], ...S.liens.map((l) => [sansDemo(l.nom), l.email ?? '', l.lien])])) }, icone('download'), 'Télécharger la liste (CSV)') : null,
        h('button', { type: 'button', class: `bz-bouton ${S.liens?.length ? 'bz-bouton--secondaire' : 'bz-bouton--principal'}`, onclick: () => D.fermer() }, 'Terminé'),
      ],
    }),
  });
  return D;
}

async function envoyerLot(genre, titre) {
  const S = { liens: null, erreur: null };
  const D = montrerLiens(S, titre);
  try {
    const r = await api('POST', '/enquetes/lot', { genre });
    if (!r.liens.length) { D.fermer(); informer(genre === 'client' ? 'Tous vos clients ont donné un avis récent.' : r.ecartes ? 'Chaque personne a déjà reçu un lien depuis moins de 30 jours (un seul lien par personne et par période), ou sa fiche a moins de 30 jours.' : 'Aucune personne à interroger.', 'ok'); return; }
    if (genre !== 'client' && r.ecartes) informer(`${r.ecartes === 1 ? '1 personne écartée' : `${r.ecartes} personnes écartées`} : lien déjà créé depuis moins de 30 jours, ou fiche créée depuis moins de 30 jours.`, 'attention');
    S.liens = r.liens;
    charger();
  } catch (e) { S.erreur = e.message; }
  D.rendre();
}

/** « 2026-11 » → « novembre 2026 » (commentaires du baromètre : datés au mois seulement). */
function moisEnLettres(m) {
  const d = /^\d{4}-\d{2}$/.test(m ?? '') ? new Date(`${m}-15T12:00:00Z`) : null;
  return d ? new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d) : (m ?? '');
}

let courbeSatisfaction = null;
async function rendreSatisfaction() {
  const Q = await chargerSatisfaction();
  if (E.vue !== 'satisfaction') return;
  const m = E.monde;
  const S = m.satisfaction;
  if (!S) { remplir($('#page'), erreurEcran('La satisfaction n’est pas disponible pour ce profil.', null, () => rendreSatisfaction())); return; }
  // personne à interroger encore (ni client, ni équipe, ni baromètre lancé) : ce que l'écran montrera, et une seule action
  if (!Object.keys(S.clients).length && !m.objets.some((o) => o.famille === 'personne') && !S.barometre?.invites && !S.barometre?.reponses) {
    const typeTiers = m.univers.types.find((t) => t.famille === 'tiers')?.id;
    courbeSatisfaction?.detruire();
    courbeSatisfaction = null;
    remplir($('#page'), h('div', { class: 'bz-ecran bz-satisfaction' }, videRubrique('satisfaction', {
      action: boutonConnecter(),
      secondaire: typeTiers ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => ouvrirSaisie({ type: typeTiers, roles: ['client'] }) }, 'Ajouter un client à la main') : null,
    })));
    return;
  }
  const objet = (id) => m.objets.find((o) => o.id === id);
  const nomDe = (id) => sansDemo(objet(id)?.nom ?? '?');
  const clients = Q.trierClients(Object.entries(S.clients).map(([id, c]) => ({ id, ...c })).filter((c) => dansFiltre(objet(c.id) ?? { champs: [] })), nomDe);
  const exemple = clients.some((c) => objet(c.id)?.mode === 'demo');
  const serie = Q.serieMensuelle(S.clients, new Date(m.maintenant ?? Date.now()));
  const R = Q.resumeSerie(serie);
  const lignes = Q.lignesSerie(serie);
  const ouvert = Boolean(E.satisTableau);
  const B = S.barometre;
  const g = S.global;
  const peut = Boolean(m.profil.peutPreparer);
  const tuile = (libelle, valeur, note, ton = null, certitude = null) => h('dl', { class: 'bz-tuile' },
    h('dt', {}, h('span', { texte: libelle }), ton ? iconeEtat(ton, { taille: 'sm', classe: 'bz-tuile__etat' }) : null),
    h('dd', { class: 'bz-tuile__valeur bz-t-chiffre', 'data-certitude': certitude, texte: valeur }),
    note ? h('dd', { class: 'bz-tuile__note', texte: note }) : null);
  const badgeNote = (c) => {
    const ton = Q.tonNote(c.note);
    return c.note === null || c.note === undefined
      ? h('span', { class: 'bz-texte-2' }, '—', h('span', { class: 'bz-t-petit', texte: ' Pas encore d’avis' }))
      : h('span', { class: `bz-badge bz-badge--${ton}` }, icone(ICONE_TON[ton] ?? 'info', { taille: 'sm' }), `${c.note} sur 10`);
  };
  courbeSatisfaction?.detruire();
  courbeSatisfaction = null;
  remplir($('#page'), h('div', { class: 'bz-ecran bz-satisfaction' },
    h('div', { class: 'bz-liste__tete' },
      h('p', { class: 'bz-liste__compte bz-t-petit bz-texte-2' }, pluriel(clients.length, 'client suivi', 'clients suivis'), exemple ? badgeExemple() : null),
      peut ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => envoyerLot('client', 'Clients sans avis récent') }, icone('send'), 'Demander l’avis des clients sans réponse')) : null),
    h('div', { class: 'bz-tuiles' },
      tuile('Satisfaction des clients', g.moyenne === null ? '—' : `${nf.format(g.moyenne)} sur 10`, g.moyenne === null ? 'Pas encore renseigné' : pluriel(g.avecAvis, 'client a répondu', 'clients ont répondu'), Q.tonNote(g.moyenne), g.moyenne === null ? 'absent' : null),
      tuile('Recommandation par vos clients', g.nps === null ? '—' : `${g.nps > 0 ? '+' : g.nps < 0 ? '−' : ''}${Math.abs(g.nps)}`, g.nps === null ? 'Pas encore renseigné' : 'de −100 à +100', g.nps === null ? null : g.nps >= 30 ? 'ok' : g.nps >= 0 ? 'attention' : 'critique', g.nps === null ? 'absent' : null)),
    g.sansAvis || g.enAttente ? h('p', { class: 'bz-t-petit bz-texte-2', texte: [g.sansAvis ? pluriel(g.sansAvis, 'client sans avis récent', 'clients sans avis récent') : null, g.enAttente ? pluriel(g.enAttente, 'formulaire en attente de réponse', 'formulaires en attente de réponse') : null].filter(Boolean).join(' · ') }) : null,
    h('section', { class: 'bz-carte bz-courbe', 'aria-labelledby': 'satis-courbe-titre' },
      h('div', { class: 'bz-carte__tete' }, h('h2', { class: 'bz-carte__titre', id: 'satis-courbe-titre', texte: 'Satisfaction sur 12 mois' })),
      h('p', { class: 'bz-courbe__resume' },
        R.variation !== null && R.variation !== undefined ? h('span', { class: 'bz-tuile__variation', 'data-sens': R.variation > 0 ? 'bon' : R.variation < 0 ? 'mauvais' : null }, icone(R.variation > 0 ? 'trending-up' : R.variation < 0 ? 'trending-down' : 'minus', { taille: 'sm' }), R.variationTexte) : null,
        h('span', { texte: R.texte })),
      R.vide ? blocVide({ titre: 'Pas encore de réponse.', texte: 'Chaque avis reçu ajoute un point à la courbe, daté.', compact: true }) : [
        h('div', { class: 'bz-courbe__cadre', tabindex: '0', role: 'group', 'aria-label': 'Courbe de la satisfaction. Flèches gauche et droite pour lire chaque mois.', 'aria-describedby': 'satis-lecture', cle: 'courbe-satisfaction' },
          h('div', { class: 'bz-courbe__trace', id: 'courbe-satisfaction', 'aria-hidden': 'true' })),
        h('p', { class: 'bz-courbe__lecture bz-t-micro', id: 'satis-lecture', texte: 'Survolez ou parcourez la courbe pour lire un mois.' }),
      ],
      lignes.length ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', 'aria-expanded': ouvert, 'aria-controls': 'tableau-satis', cle: 'voir-tableau-satis',
        onclick: () => { E.satisTableau = !ouvert; rendreSatisfaction(); } }, icone('table'), ouvert ? 'Masquer le tableau' : 'Voir le tableau') : null,
      lignes.length ? h('div', { class: 'bz-tableau-cadre', id: 'tableau-satis', hidden: !ouvert },
        h('table', { class: 'bz-tableau' }, h('caption', { class: 'bz-visuellement-cache', texte: 'Satisfaction moyenne par mois' }),
          h('thead', {}, h('tr', {}, h('th', { scope: 'col', texte: 'Mois' }), h('th', { scope: 'col', class: 'bz-num', texte: 'Moyenne sur 10' }), h('th', { scope: 'col', class: 'bz-num', texte: 'Réponses' }))),
          h('tbody', {}, lignes.map((l) => h('tr', {}, h('td', { texte: l.mois }), h('td', { class: 'bz-num', texte: nf.format(l.moyenne) }), h('td', { class: 'bz-num', texte: nombre(l.reponses) })))))) : null),
    filtreDepartements(),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'satis-clients' },
      h('h2', { class: 'bz-t-titre-4', id: 'satis-clients', texte: 'Clients' }),
      clients.length ? h('div', { class: 'bz-tableau-cadre' }, h('table', { class: 'bz-tableau bz-tableau--empile' },
        h('caption', { class: 'bz-visuellement-cache', texte: 'Satisfaction par client, les plus mécontents d’abord' }),
        h('thead', {}, h('tr', {}, ['Client', 'Dernière note', 'Reçue', 'Évolution', 'Moyenne', ''].map((t, i) => h('th', { scope: 'col', class: i === 4 ? 'bz-num' : null }, t ? t : h('span', { class: 'bz-visuellement-cache', texte: 'Action' }))))),
        h('tbody', {}, clients.map((c) => h('tr', { 'data-courant': E.selection === c.id ? '' : null },
          h('th', { scope: 'row', class: 'bz-tableau__nom' }, h('a', { href: '#/satisfaction', class: 'bz-liste__lien', cle: `satis-${c.id}`, onclick: (e) => { e.preventDefault(); selectionner(c.id); }, texte: nomDe(c.id) }),
            h('span', { class: 'bz-t-micro bz-texte-2 bz-satisfaction__statut', texte: Q.LIBELLE_STATUT[c.statut] ?? '' })),
          h('td', { 'data-colonne': 'Dernière note' }, badgeNote(c)),
          h('td', { 'data-colonne': 'Reçue' }, c.le ? h('span', { texte: dateRelative(c.le) }) : h('span', { class: 'bz-texte-2', texte: '—' })),
          h('td', { 'data-colonne': 'Évolution' }, c.historique.length ? h('span', { class: 'bz-satisfaction__evolution' }, courbeNotes(c.historique),
            c.tendance ? h('span', { class: 'bz-tuile__variation', 'data-sens': c.tendance > 0 ? 'bon' : 'mauvais' }, icone(c.tendance > 0 ? 'arrow-up' : 'arrow-down', { taille: 'sm' }), `${c.tendance > 0 ? '+' : '−'}${Math.abs(c.tendance)}`) : h('span', { class: 'bz-t-micro bz-texte-2', texte: 'stable' })) : h('span', { class: 'bz-texte-2', texte: '—' })),
          h('td', { class: 'bz-num', 'data-colonne': 'Moyenne' }, c.moyenne === null ? h('span', { class: 'bz-texte-2', texte: '—' }) : h('span', { class: 'bz-t-chiffre', texte: `${nf.format(c.moyenne)} (${pluriel(c.nb, 'avis', 'avis')})` })),
          h('td', { class: 'bz-tableau__action' }, peut ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', cle: `satis-envoyer-${c.id}`, onclick: () => envoyerFormulaire(c.id) },
            icone('send', { taille: 'sm' }), c.envoyeLe ? `Renvoyer (envoyé ${dateRelative(c.envoyeLe)})` : 'Envoyer un formulaire') : null)))))) : blocVide({ titre: 'Aucun client dans votre périmètre.', compact: true })),
    B ? h('section', { class: 'bz-carte bz-pile', 'aria-labelledby': 'satis-barometre' },
      h('div', { class: 'bz-carte__tete' },
        h('div', {}, h('h2', { class: 'bz-carte__titre', id: 'satis-barometre', texte: 'Baromètre de l’équipe' }),
          h('p', { class: 'bz-carte__sous-titre bz-t-petit', texte: `Anonyme · résultats publiés par lots d’au moins ${B.seuil ?? 5}\u00A0réponses · ${B.reponses ? pluriel(B.reponses, 'réponse publiée', 'réponses publiées') : 'aucune réponse publiée'} sur 4 mois` }))),
      h('div', { class: 'bz-tuiles' },
        tuile('Bien-être moyen', B.global === null ? '—' : `${nf.format(B.global)} sur 10`, B.global === null ? `Moins de ${B.seuil ?? 5}\u00A0réponses : masqué` : 'Toute l’équipe', B.global === null ? null : B.global >= 7 ? 'ok' : B.global >= 5 ? 'attention' : 'critique', B.global === null ? 'absent' : null),
        tuile('Participation', B.participation === null ? '—' : `${B.participation} %`, pluriel(B.invites, 'invitation', 'invitations'), null, B.participation === null ? 'absent' : null),
        tuile('Dernier envoi', B.dernierEnvoi ? date(B.dernierEnvoi) : 'Jamais', 'Conseillé : chaque trimestre', B.dernierEnvoi ? null : 'attention')),
      B.departements.length ? h('ul', { class: 'bz-liste-simple bz-barometre', role: 'list' }, B.departements.map((d) => h('li', { class: 'bz-barometre__ligne' },
        h('span', { class: 'bz-t-label', texte: sansDemo(d.nom) }),
        barreScore(d.note === null ? null : d.note * 10, d.note === null ? null : d.note >= 7 ? null : 'critique'),
        h('span', { class: 'bz-t-petit bz-texte-2', texte: d.note === null ? 'masqué (anonymat)' : `${nf.format(d.note)} sur 10${d.charge !== null ? ` · charge tenable ${nf.format(d.charge)} sur 10` : ''} · ${pluriel(d.reponses, 'réponse', 'réponses')}` })))) : null,
      B.reponses ? h('p', { class: 'bz-t-petit bz-texte-2', texte: `Un service n’apparaît qu’à partir de ${B.seuil ?? 5}\u00A0réponses publiées. Les commentaires reçus par formulaire ne sont montrés qu’à partir de ${B.seuilCommentaires ?? 10}\u00A0réponses. Le nom des personnes n’est jamais enregistré, et le lien ne dit pas qui a répondu. Un seul lien par personne et par période de 30 jours.` }) : null,
      B.commentaires.length ? h('ul', { class: 'bz-historique', 'aria-label': 'Commentaires anonymes' }, B.commentaires.map((c) => h('li', {}, h('p', { texte: `« ${c.texte} »` }), h('span', { class: 'bz-t-micro bz-texte-2', texte: moisEnLettres(c.le) })))) : null,
      m.profil.peutAdministrer ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => envoyerLot('collaborateur', 'Baromètre de l’équipe') }, icone('send'), 'Envoyer le baromètre à l’équipe')) : null) : null));
  const trace = $('#courbe-satisfaction');
  if (trace) {
    import('/courbe.js').then(({ courbe }) => (trace.isConnected ? courbe(trace, serie, { min: 0, max: 10, graduations: [0, 2, 4, 6, 8, 10], unite: 'sur 10', nomSerie: 'Satisfaction', vide: 'pas de réponse',
      seuils: [{ valeur: 6, libelle: 'Mitigé' }, { valeur: 8, libelle: 'Satisfait' }], lecture: $('#satis-lecture'), cadre: trace.parentElement, dateAxe: MOIS_AXE, dateLongue: MOIS_LONG }) : null))
      .then((c) => { courbeSatisfaction = c; })
      .catch(() => { if (trace.isConnected) remplir(trace.parentElement, h('p', { class: 'bz-t-petit bz-texte-2', texte: 'La courbe n’a pas pu s’afficher. Le tableau donne les mêmes chiffres.' })); });
  }
}

// ---------------------------------------------------------------- optimiser : ce qui peut être automatisé (§6.1 P8)
/* Gain total en tuile, puis les pistes en liste priorisée (la plus rentable d'abord), chacune sous la forme d'une
   « proposition à valider » (§4.28 : pointillés tant qu'elle n'est pas activée) avec son action ; puis les tâches
   répétitives décrites par une personne (« est-ce que ça vaut le coup ? ») ; puis les automatisations en tableau,
   avec leur interrupteur. */
/**
 * « J'automatise » : d'un geste, tout ce qui est prêt se met en marche. Ce qui ne peut pas l'être est dit, avec ce
 * qu'il faut relier. Pédagogie d'abord : ce qu'est une automatisation, ce qu'elle fera, ce qui reste à une personne.
 */
function blocAutomatiser(Pr, admin, apres) {
  const pretes = Pr.recettes.filter((r) => r.etat === 'prete');
  const manquantes = Pr.recettes.filter((r) => r.etat === 'a_brancher');
  if (!pretes.length && !manquantes.length) return resultatAssistant('ok', 'Tout ce que Living Business sait automatiser est déjà en marche.');
  const phrase = pretes.length
    ? `${pluriel(pretes.length, 'automatisation est prête', 'automatisations sont prêtes')} avec les données déjà reliées${Pr.heuresMois ? ` : environ ${nf.format(Pr.heuresMois)} h récupérées par mois, estimé` : ''}.`
    : 'Rien de plus à mettre en marche pour l’instant : il manque d’abord des données.';
  return h('section', { class: 'bz-carte bz-pile bz-optimiser__tout', 'aria-labelledby': 'tout-titre' },
    h('h2', { class: 'bz-t-titre-4', id: 'tout-titre', texte: 'J’automatise' }),
    h('p', { class: 'bz-t-corps', texte: phrase }),
    manquantes.length ? h('p', { class: 'bz-t-petit bz-texte-2', texte: `${pluriel(manquantes.length, 'autre attend', 'autres attendent')} des données que le jeu ne voit pas encore.` }) : null,
    h('div', { class: 'bz-groupe-boutons' },
      pretes.length && admin ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => ouvrirToutAutomatiser(Pr, admin, apres) }, icone('zap'), 'Tout automatiser') : null,
      !pretes.length || !admin ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => ouvrirToutAutomatiser(Pr, admin, apres) }, icone('list-checks'), pretes.length ? 'Voir le détail' : 'Voir ce qui manque') : null,
      pretes.length && !admin ? h('span', { class: 'bz-t-petit bz-texte-2', texte: 'À mettre en marche par la direction.' }) : null));
}

/** Le serveur exécute les automatisations 200 ms après leur activation : on relit un peu après. */
const DELAI_AUTOMATISATIONS = 700;
function ouvrirToutAutomatiser(Pr, admin, apres) {
  const S = { erreur: null, envoi: false };
  const pretes = Pr.recettes.filter((r) => r.etat === 'prete');
  const manquantes = Pr.recettes.filter((r) => r.etat === 'a_brancher');
  const actives = Pr.recettes.filter((r) => r.etat === 'active');
  const versOutil = pretes.some((r) => r.versOutil);
  const ligne = (r, sous) => h('li', { class: 'bz-pile bz-pile--serre' },
    h('p', { class: 'bz-t-label', texte: r.nom }),
    h('p', { class: 'bz-t-petit', texte: `Quand : ${r.quand.charAt(0).toLocaleLowerCase('fr-FR')}${r.quand.slice(1)}. Alors : ${r.alors.charAt(0).toLocaleLowerCase('fr-FR')}${r.alors.slice(1)}.` }),
    sous ? h('p', { class: 'bz-t-petit bz-texte-2', texte: sous }) : null);
  const groupe = (titre, liste, sous) => (liste.length ? h('section', { class: 'bz-pile bz-pile--serre' },
    h('h3', { class: 'bz-t-titre-4', texte: `${titre} · ${nombre(liste.length)}` }),
    h('ul', { class: 'bz-liste-simple bz-pile', role: 'list' }, liste.map((r) => ligne(r, sous(r))))) : null);
  const lancer = async () => {
    S.envoi = true; S.erreur = null; D.rendre();
    try {
      const nbTaches = () => tachesOuvertes(E.monde ?? {}).length;
      const avant = nbTaches();
      const r = await api('POST', '/automatisations/tout', {});
      D.fermer();
      // Ce que les automatisations préparent doit se voir tout de suite. Elles s'exécutent un instant après l'activation
      // (côté serveur) : on attend, on relit, on compte les tâches préparées et le message y mène. Un seul message : celui
      // de la nouvelle rubrique « Tâches » ne s'ajoute pas au nôtre.
      rubriquesDejaDites.add('taches');
      try {
        if (r.activees.length) await new Promise((ok) => setTimeout(ok, DELAI_AUTOMATISATIONS));
        await charger();
      } catch { /* hors ligne : le menu se mettra à jour à la prochaine lecture */ }
      const creees = Math.max(0, nbTaches() - avant);
      const marche = r.activees.length ? `${pluriel(r.activees.length, 'automatisation mise', 'automatisations mises')} en marche : ${r.activees.length > 1 ? 'elles agissent' : 'elle agit'} dès maintenant sur vos données réelles.` : 'Rien de plus à mettre en marche.';
      informer(creees ? `${marche} ${pluriel(creees, 'tâche préparée', 'tâches préparées')}.` : marche, 'ok',
        creees ? { libelle: creees > 1 ? 'Voir les tâches' : 'Voir la tâche', faire: () => changerVue('famille:tache') } : null);
      rubriquesDejaDites.delete('taches');
      apres?.();
    } catch (e) { S.envoi = false; S.erreur = e.message; D.rendre(); }
  };
  const D = dialogueVivant({
    titre: 'J’automatise', surtitre: 'Optimiser', taille: 'md',
    contenu: () => ({
      corps: [
        h('p', { class: 'bz-t-petit', texte: 'Une automatisation surveille vos données réelles et agit dès que la situation se présente : elle prépare la tâche pour la bonne personne, sans jamais faire deux fois la même chose. Vous l’arrêtez quand vous voulez, sur cette page.' }),
        versOutil ? resultatAssistant('info', Pr.outilBranche
          ? 'Votre outil d’automatisation (Make, Zapier ou n8n) reçoit chaque événement : c’est lui qui envoie les relances et les demandes d’avis.'
          : 'Les messages vers l’extérieur (relance, demande d’avis) ne partent pas tout seuls : le jeu prépare une tâche pour une personne.',
          Pr.outilBranche ? {} : { detail: 'Pour qu’ils partent sans vous : Connecter mes données → Mode avancé → Make · Zapier · n8n.' }) : null,
        messageEnLigne('critique', S.erreur),
        groupe('Prêtes à mettre en marche', pretes, (r) => (r.heuresMois ? `Environ ${nf.format(r.heuresMois)} h par mois, estimé sur vos données d’aujourd’hui.` : 'Rien à traiter aujourd’hui : elle agira dès qu’un cas se présentera.')),
        groupe('Il manque des données', manquantes, (r) => `Le jeu ne voit pas encore ${r.manque}.`),
        manquantes.length && admin ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { D.fermer(); ouvrirAssistant(); } }, icone('plug'), 'Connecter mes données')) : null,
        groupe('Déjà en marche', actives, () => null),
      ],
      pied: [
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, pretes.length && admin ? 'Pas maintenant' : 'Fermer'),
        pretes.length && admin ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', disabled: S.envoi ? '' : null, onclick: lancer }, icone('zap'), `Mettre en marche ${pluriel(pretes.length, 'automatisation', 'automatisations')}`) : null,
      ],
    }),
  });
  D.rendre();
  return D;
}

// ---------------------------------------------------------------- optimiser : tâches répétitives déclarées
/* « Est-ce que ça vaut le coup de l'automatiser ? » À côté de ce que le jeu DÉTECTE dans les données, ce qu'une
   personne DÉCLARE : une tâche qu'elle refait souvent. Le calcul et toutes les phrases (verdict, raison, calcul de
   chaque chiffre) viennent du serveur (src/core/taches-repetitives.ts) : l'écran ne recalcule rien. Le formulaire pose
   une question à la fois et montre le résultat avant de garder la tâche. Écritures : administrateurs seulement. */
const TON_VERDICT = { a_automatiser: 'ok', a_automatiser_en_validant: 'attention', a_planifier: 'info' };
const QUESTIONS_TACHE = ['nom', 'qui', 'temps', 'fois', 'recette', 'automatiser', 'memeFacon', 'casParticuliers', 'graviteErreur'];
const REPONSES_TACHE = {
  memeFacon: [['oui', 'Oui, toujours', 'Les mêmes étapes, dans le même ordre.'], ['souvent', 'Le plus souvent', 'Quelques variantes de temps en temps.'], ['variable', 'Non, ça change souvent', 'Chaque fois est un peu différente.']],
  casParticuliers: [['rarement', 'Rarement', 'Presque tout se traite de la même manière.'], ['parfois', 'Parfois', 'Quelques exceptions, à traiter à la main.'], ['souvent', 'Souvent', 'Beaucoup de situations demandent de réfléchir.']],
  graviteErreur: [['sans_gravite', 'Sans gravité', 'On corrige et on passe à autre chose.'], ['genante', 'Gênant', 'Du temps perdu, une explication à donner.'], ['grave', 'Grave', 'De l’argent, un client ou la sécurité sont en jeu.']],
};
const ETAT_RECETTE = { active: 'elle est en marche', prete: 'elle est prête à être mise en marche', a_brancher: 'il lui manque des données' };
const enMinuscule = (t) => `${t.charAt(0).toLocaleLowerCase('fr-FR')}${t.slice(1)}`;

/** Le verdict et sa raison, toujours ensemble : icône et libellé (jamais la couleur seule), puis la phrase. */
const verdictTacheRepetitive = (c) => h('div', { class: 'bz-pile bz-pile--serre' },
  h('p', { class: 'bz-ligne-icone' }, TON_VERDICT[c.verdict] ? iconeEtat(TON_VERDICT[c.verdict], { taille: 'sm', decoratif: true }) : icone('circle-off', { taille: 'sm' }), h('strong', { class: 'bz-t-label', texte: c.libelle })),
  h('p', { class: 'bz-t-petit', texte: c.raison }));

/** « D'où viennent ces chiffres ? » : le calcul de chaque nombre, écrit avec les chiffres de la personne. */
const calculTacheRepetitive = (c) => h('div', { class: 'bz-proposition__pourquoi' },
  h('p', { class: 'bz-t-label', texte: 'D’où viennent ces chiffres ?' }),
  h('ul', { class: 'bz-proposition__raisons' },
    [['Temps gagné', c.explications.temps], ['Rentabilité', c.explications.rentabilite], ['En euros', c.explications.euros], ['Dans la durée', c.explications.horizon]]
      .map(([titre, texte]) => h('li', {}, h('strong', { texte: `${titre}. ` }), texte)),
    h('li', { class: 'bz-texte-2', texte: 'Tout est compté en temps de travail : une année, c’est 228 jours, 45,6 semaines ou 11 mois travaillés.' })));

/**
 * Le lien avec ce qui existe, dit honnêtement : l'automatisation attachée (« celle-ci le fait déjà ») et son état, ou
 * ce qu'il reste à faire quand aucune ne correspond. `basculer` : met l'automatisation en marche (carte de la liste,
 * administrateur) ; absent dans le formulaire, où rien n'est encore enregistré.
 */
function suiteTacheRepetitive(t, T, { admin = false, basculer = null } = {}) {
  const a = t.automatisation;
  const c = t.calcul;
  const brancher = admin && basculer ? h('div', { class: 'bz-groupe-boutons' }, h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => ouvrirAssistant() }, icone('plug', { taille: 'sm' }), 'Connecter mes données')) : null;
  if (a) {
    const ceQuElleFait = `Quand : ${enMinuscule(a.quand)}. Alors : ${enMinuscule(a.alors)}.`;
    const validation = c.verdict !== 'a_automatiser_en_validant' ? ''
      : a.versOutil && T.outilBranche ? ' Votre outil d’automatisation reçoit l’événement : prévoyez-y une étape où vous validez avant l’envoi.'
      : ' Elle prépare une tâche pour une personne : rien ne part sans vous.';
    if (a.etat === 'active') return resultatAssistant('ok', `« ${a.nom} » fait déjà cette tâche : elle est en marche.`, { detail: `${ceQuElleFait}${validation}` });
    if (a.etat === 'prete') {
      return resultatAssistant('info', `« ${a.nom} » fait déjà cette tâche : elle est prête, il reste à la mettre en marche.`, {
        detail: `${ceQuElleFait}${validation}`,
        actions: basculer ? h('div', { class: 'bz-groupe-boutons' }, admin
          ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => basculer(a.id, true) }, icone('zap', { taille: 'sm' }), 'Mettre en marche')
          : h('span', { class: 'bz-t-petit', texte: 'À mettre en marche par la direction.' })) : null,
      });
    }
    return resultatAssistant('attention', `« ${a.nom} » sait faire cette tâche, mais il lui manque des données.`, { detail: `Le jeu ne voit pas encore ${a.manque ?? 'les données qu’elle regarde'}.`, actions: brancher });
  }
  if (!TON_VERDICT[c.verdict]) return h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Aucune automatisation de Living Business ne fait cette tâche : rien à mettre en marche ici.' });
  if (T.outilBranche) {
    return resultatAssistant('info', 'Aucune automatisation de Living Business ne fait cette tâche.', {
      detail: 'Elle reste à construire dans votre outil d’automatisation (Make, Zapier ou n8n), déjà branché : Living Business lui envoie des événements signés, qui peuvent la déclencher.' });
  }
  return resultatAssistant('info', 'Cette tâche ne peut pas encore être automatisée d’ici.', {
    detail: 'Aucune automatisation de Living Business ne la fait. Il reste une voie : la construire dans un outil d’automatisation (Make, Zapier ou n8n), à qui Living Business sait envoyer des événements signés. Pour le brancher : Connecter mes données → Mode avancé → Make · Zapier · n8n.',
    actions: brancher });
}

/** Idées de départ (universelles) : en choisir une remplit le formulaire avec des chiffres d'exemple, à ajuster. */
const ideesTachesRepetitives = (T, choisir, id) => h('div', { class: 'bz-pile bz-pile--serre' },
  h('p', { class: 'bz-t-label', id, texte: 'Des idées pour commencer' }),
  h('ul', { class: 'bz-puces', role: 'list', 'aria-labelledby': id }, T.idees.map((i) => h('li', {}, h('button', { type: 'button', class: 'bz-puce', onclick: () => choisir(i) }, i.nom)))),
  h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Les chiffres proposés sont des exemples : vous les remplacez par les vôtres, question après question.' }));

function carteTacheRepetitive(t, i, T, admin, { basculer, modifier, supprimer }) {
  const c = t.calcul;
  const active = t.automatisation?.etat === 'active';
  return h('li', {}, h('article', { class: `bz-proposition${active ? ' bz-proposition--validee' : ''}`, 'aria-labelledby': `tache-repetitive-${i}` },
    h('p', { class: 'bz-proposition__tete bz-t-petit' }, icone(active ? 'circle-check' : 'pencil', { taille: 'sm' }), `${active ? 'Tâche décrite par vous, automatisée' : 'Tâche décrite par vous'}${t.qui ? ` · faite par ${t.qui}` : ''}`),
    h('div', { class: 'bz-proposition__corps' },
      h('span', { class: 'bz-cat bz-cat--carre', 'aria-hidden': 'true' }, icone('rotate-cw', { taille: 'sm' })),
      h('div', { class: 'bz-pile bz-pile--serre' },
        h('h3', { class: 'bz-t-titre-4', id: `tache-repetitive-${i}`, texte: t.nom }),
        h('p', { class: 'bz-t-chiffre bz-proposition__gain', 'data-certitude': 'estime' }, `${c.tempsAn} par an`, h('span', { class: 'bz-t-petit bz-texte-2', texte: ` · ${nfEuro.format(c.euroAn)} par an, d’après vos chiffres` })))),
    verdictTacheRepetitive(c),
    c.risquee && c.verdict !== 'a_automatiser_en_validant' ? h('p', { class: 'bz-t-petit bz-ligne-icone' }, iconeEtat('attention', { taille: 'sm', decoratif: true }), h('span', { texte: `Si vous l’automatisez un jour, gardez la main : ${c.risques.join(', ')}.` })) : null,
    messageEnLigne('attention', c.aVerifier),
    calculTacheRepetitive(c),
    suiteTacheRepetitive(t, T, { admin, basculer }),
    admin ? h('div', { class: 'bz-groupe-boutons' },
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', cle: `tache-modifier-${t.id}`, onclick: modifier }, icone('pencil'), 'Modifier'),
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', cle: `tache-supprimer-${t.id}`, onclick: supprimer }, icone('trash-2'), 'Supprimer')) : null));
}

/** Section « Vos tâches répétitives » de l'écran Optimiser : la liste (ce qui vaut le plus le coup d'abord), ou l'invitation à commencer. */
function blocTachesRepetitives(T, Pr, admin, { basculer, apres }) {
  const ouvrir = (o = {}) => ouvrirTacheRepetitive(T, Pr, o, apres);
  const supprimer = async (t) => {
    if (!(await confirmerDialogue({ titre: `Supprimer « ${t.nom} » ?`, texte: 'La tâche disparaît de cette liste. Aucune automatisation n’est arrêtée.', confirmer: 'Supprimer', annuler: 'Garder', danger: true }))) return;
    try { await api('DELETE', `/automatisations/taches/${t.id}`); E.tachesErreur = null; informer('Tâche supprimée de la liste.', 'ok'); } catch (e) { E.tachesErreur = e.message; }
    apres();
  };
  const regler = async (e) => {
    try { await api('PUT', '/automatisations/reglages', { horizonAns: Number(e.target.value) }); E.tachesErreur = null; } catch (err) { E.tachesErreur = err.message; }
    apres();
  };
  const pleine = T.taches.length >= T.max;
  const decrire = admin && !pleine ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', cle: 'tache-decrire', onclick: () => ouvrir() }, icone('plus'), 'Décrire une tâche') : null;
  return h('section', { class: 'bz-pile', 'aria-labelledby': 'taches-repetitives-titre' },
    h('div', {}, h('h2', { class: 'bz-t-titre-4', id: 'taches-repetitives-titre', texte: 'Vos tâches répétitives : est-ce que ça vaut le coup de les automatiser ?' }),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Living Business ne voit pas tout votre travail. Décrivez une tâche que vous refaites souvent : il vous dit combien de temps elle vous prend sur une année, en combien de temps l’automatiser serait regagné, et si ça vaut le coup.' })),
    messageEnLigne('critique', E.tachesErreur ?? null),
    T.taches.length
      ? h('ol', { class: 'bz-liste-simple bz-optimiser__pistes', role: 'list' }, T.taches.map((t, i) => carteTacheRepetitive(t, i, T, admin, { basculer, modifier: () => ouvrir({ tache: t }), supprimer: () => supprimer(t) })))
      : blocVide({ titre: 'Aucune tâche décrite pour l’instant.',
        texte: admin ? 'Commencez par celle qui revient le plus souvent : neuf questions simples, une à la fois, puis le résultat.' : 'La direction peut décrire ici les tâches qui reviennent souvent, pour voir lesquelles automatiser.',
        actions: decrire }),
    admin && !T.taches.length ? ideesTachesRepetitives(T, (idee) => ouvrir({ idee }), 'taches-repetitives-idees') : null,
    T.taches.length && admin ? h('div', { class: 'bz-groupe-boutons' }, decrire,
      pleine ? h('span', { class: 'bz-t-petit bz-texte-2', texte: `Vous avez décrit ${pluriel(T.max, 'tâche', 'tâches')}, le maximum : supprimez-en une pour en décrire une autre.` }) : null) : null,
    T.taches.length && admin ? h('div', { class: 'bz-champ bz-optimiser__taux' },
      h('label', { class: 'bz-champ__libelle', for: 'horizon-ans', texte: 'Durée sur laquelle compter' }),
      h('div', { class: 'bz-select' },
        h('select', { id: 'horizon-ans', class: 'bz-champ__saisie', 'aria-describedby': 'horizon-aide', onchange: regler }, [1, 2, 3, 4, 5].map((a) => h('option', { value: String(a), selected: a === T.horizonAns, texte: pluriel(a, 'an', 'ans') }))),
        icone('chevron-down', { taille: 'sm' })),
      h('p', { class: 'bz-champ__aide', id: 'horizon-aide', texte: `Si le temps passé à automatiser n’est pas regagné dans ce délai, la tâche est dite « pas rentable ». 5 ans par défaut. Les euros sont comptés à ${nfEuro.format(T.tauxHoraire)} de l’heure, le coût horaire réglé plus haut.` })) : null,
    T.taches.length && !admin ? h('p', { class: 'bz-t-petit bz-texte-2', texte: `Calculé sur ${pluriel(T.horizonAns, 'an', 'ans')}, à ${nfEuro.format(T.tauxHoraire)} de l’heure.` }) : null);
}

/**
 * Formulaire d'une tâche répétitive : une question à la fois, en mots simples, puis le résultat AVANT de garder la
 * tâche (estimé par le serveur : rien n'est enregistré tant qu'on n'a pas choisi « Garder cette tâche »).
 * `tache` : modification ; `idee` : idée de départ, dont les chiffres d'exemple sont à ajuster.
 */
function ouvrirTacheRepetitive(T, Pr, { tache = null, idee = null } = {}, apres = null) {
  const nb = QUESTIONS_TACHE.length;
  const enTexte = (x) => (x === undefined || x === null ? '' : String(x).replace('.', ','));
  const reponses = (m) => ({
    nom: m?.nom ?? '', tempsGagne: enTexte(m?.tempsGagne), uniteTemps: m?.uniteTemps ?? 'minutes', fois: enTexte(m?.fois), periode: m?.periode ?? 'semaine',
    recette: m?.recette ?? '', tempsAutomatiser: enTexte(m?.tempsAutomatiser), uniteAutomatiser: m?.uniteAutomatiser ?? 'heures',
    memeFacon: m?.memeFacon ?? null, casParticuliers: m?.casParticuliers ?? null, graviteErreur: m?.graviteErreur ?? null,
  });
  const v = { ...reponses(tache ?? idee), qui: tache && !tache.personne ? tache.qui : '', personne: tache?.personne ?? '' };
  const S = { etape: 0, erreur: null, envoi: false, resultat: null, exemple: Boolean(idee) };
  const personnes = E.monde.objets.filter((o) => o.famille === 'personne').sort((a, b) => sansDemo(a.nom).localeCompare(sansDemo(b.nom), 'fr'));
  const lireNombre = (t) => { const brut = String(t).replace(/\s/g, '').replace(',', '.'); const x = Number(brut); return brut !== '' && Number.isFinite(x) ? x : null; };
  const declaration = () => ({
    nom: v.nom.trim(), qui: v.personne ? '' : v.qui.trim(), personne: v.personne || null, tempsGagne: lireNombre(v.tempsGagne), uniteTemps: v.uniteTemps, fois: lireNombre(v.fois), periode: v.periode,
    tempsAutomatiser: lireNombre(v.tempsAutomatiser), uniteAutomatiser: v.uniteAutomatiser, memeFacon: v.memeFacon, casParticuliers: v.casParticuliers, graviteErreur: v.graviteErreur, recette: v.recette || null,
  });
  const controler = (q) => {
    const temps = (t) => { const x = lireNombre(t); return x !== null && x > 0 && x <= 1000; };
    if (q === 'nom') return v.nom.trim() ? null : 'Donnez un nom à cette tâche.';
    if (q === 'temps') return temps(v.tempsGagne) ? null : 'Écrivez un temps en chiffres, plus grand que 0 (1 000 au plus). Une estimation suffit.';
    if (q === 'fois') { const x = lireNombre(v.fois); return x !== null && Number.isInteger(x) && x >= 1 && x <= 1000 ? null : 'Écrivez un nombre entier de fois, entre 1 et 1 000.'; }
    if (q === 'automatiser') return temps(v.tempsAutomatiser) ? null : 'Écrivez un temps en chiffres, plus grand que 0 (1 000 au plus). Une estimation suffit.';
    if (REPONSES_TACHE[q]) return v[q] ? null : 'Choisissez une des trois réponses.';
    return null;
  };
  // après un changement de question : le focus va à la réponse (ou au titre sur téléphone, sans ouvrir le clavier)
  const viser = () => setTimeout(() => {
    const corps = D.d.querySelector('.bz-dialogue__corps');
    const cible = S.etape < nb && !petitEcran() ? corps.querySelector('input:checked') ?? corps.querySelector('input, select') : null;
    (cible ?? D.d.querySelector('#tache-question'))?.focus();
  }, 0);
  const aller = async (etape) => {
    S.erreur = null;
    if (etape === nb) { // le résultat est estimé par le serveur, sans rien enregistrer
      S.envoi = true; D.rendre();
      try { S.resultat = await api('POST', '/automatisations/taches/estimation', declaration()); } catch (e) { S.envoi = false; S.erreur = e.message; D.rendre(); return; }
      S.envoi = false;
    }
    S.etape = etape; D.rendre(); viser();
  };
  const garder = async () => {
    S.envoi = true; S.erreur = null; D.rendre();
    try {
      const t = tache ? await api('PUT', `/automatisations/taches/${tache.id}`, declaration()) : await api('POST', '/automatisations/taches', declaration());
      D.fermer();
      E.tachesErreur = null;
      informer(`« ${t.nom} » est dans votre liste : ${enMinuscule(t.calcul.libelle)}.`, 'ok');
      apres?.();
    } catch (e) { S.envoi = false; S.erreur = e.message; D.rendre(); }
  };
  const continuer = () => {
    if (S.envoi) return undefined;
    if (S.etape === nb) return garder();
    const probleme = controler(QUESTIONS_TACHE[S.etape]);
    if (probleme) { S.erreur = probleme; D.rendre(); viser(); return undefined; }
    return aller(S.etape + 1);
  };
  const reprendre = (i) => { Object.assign(v, reponses(i)); S.exemple = true; S.erreur = null; D.rendre(); viser(); };

  const question = (texte, aide) => [
    h('p', { class: 'bz-t-micro bz-texte-2', texte: `Question ${S.etape + 1} sur ${nb}` }),
    h('h3', { class: 'bz-t-titre-4', id: 'tache-question', tabindex: '-1', texte }),
    h('p', { class: 'bz-t-petit', id: 'tache-aide', texte: aide }),
    S.exemple && S.etape > 1 ? h('p', { class: 'bz-t-petit bz-ligne-icone' }, icone('lightbulb', { taille: 'sm' }), h('span', { texte: 'Réponse d’exemple, tirée de l’idée choisie : remplacez-la par la vôtre.' })) : null,
  ];
  const erreurChamp = () => (S.erreur ? h('p', { class: 'bz-champ__erreur', id: 'tache-erreur', role: 'alert' }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: S.erreur })) : null);
  const decrit = () => (S.erreur ? 'tache-erreur' : 'tache-aide');
  const pourquoi = (texte) => h('aside', { class: 'bz-pourquoi', 'aria-label': 'Pourquoi on vous le demande' }, icone('info'), h('div', {}, h('strong', { texte: 'Pourquoi on vous le demande' }), h('p', { texte })));
  const saisie = (id, libelle, cle, attributs = {}) => h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }),
    h('input', { id, class: 'bz-champ__saisie', type: 'text', autocomplete: 'off', value: v[cle], 'aria-invalid': S.erreur ? 'true' : null, 'aria-describedby': decrit(), oninput: (e) => { v[cle] = e.target.value; }, ...attributs }));
  const liste = (id, libelle, options, valeur, changer) => h('div', { class: 'bz-champ' }, h('label', { class: 'bz-champ__libelle', for: id, texte: libelle }),
    h('div', { class: 'bz-select' }, h('select', { id, class: 'bz-champ__saisie', onchange: (e) => changer(e.target.value) }, options.map(([val, l]) => h('option', { value: val, selected: val === valeur, texte: l }))), icone('chevron-down', { taille: 'sm' })));
  const nombreEtUnite = (id, libelle, cle, libelleUnite, cleUnite, unites) => h('div', { class: 'bz-grille-champs' },
    saisie(id, libelle, cle, { inputmode: 'decimal', maxlength: '8' }), liste(`${id}-unite`, libelleUnite, unites, v[cleUnite], (val) => { v[cleUnite] = val; }));
  const choix = (cle) => h('fieldset', { class: 'bz-grille-choix', 'aria-labelledby': 'tache-question', 'aria-describedby': decrit() },
    REPONSES_TACHE[cle].map(([val, titre, detail]) => h('label', { class: 'bz-choix' },
      h('input', { type: 'radio', name: `tache-${cle}`, value: val, checked: v[cle] === val, onchange: () => { v[cle] = val; if (S.erreur) { S.erreur = null; D.rendre(); } } }),
      h('span', { class: 'bz-choix__texte' }, h('span', { class: 'bz-choix__titre', texte: titre }), h('span', { class: 'bz-choix__detail', texte: detail })))));

  const corpsQuestion = (q) => {
    if (q === 'nom') return [
      ...question('Quelle tâche refaites-vous souvent ?', 'Donnez-lui le nom que vous lui donnez entre vous. Une seule tâche à la fois : vous pourrez en décrire d’autres ensuite.'),
      saisie('tache-nom', 'Nom de la tâche', 'nom', { maxlength: '120', placeholder: 'Relancer les factures, préparer les commandes…' }),
      erreurChamp(),
      !tache ? ideesTachesRepetitives(T, reprendre, 'tache-idees') : null,
    ];
    if (q === 'qui') return [
      ...question('Qui la fait ?', 'Facultatif. Un prénom, un rôle ou une équipe : c’est à cette personne que l’automatisation rendrait du temps.'),
      saisie('tache-qui', 'Un nom, un rôle ou une équipe', 'qui', { maxlength: '80', placeholder: 'La comptable, l’accueil, toute l’équipe…', oninput: (e) => { v.qui = e.target.value; if (v.personne) { v.personne = ''; D.rendre(); } } }),
      personnes.length ? liste('tache-personne', 'Ou une personne de l’entreprise', [['', 'Choisir une personne'], ...personnes.map((p) => [p.id, sansDemo(p.nom)])], v.personne, (val) => { v.personne = val; if (val) v.qui = ''; D.rendre(); }) : null,
      erreurChamp(),
    ];
    if (q === 'temps') return [
      ...question('Combien de temps gagneriez-vous à chaque fois ?', 'Le temps que vous n’auriez plus à y passer si elle se faisait toute seule. Une estimation suffit.'),
      nombreEtUnite('tache-temps', 'Temps gagné à chaque fois', 'tempsGagne', 'Unité', 'uniteTemps', [['secondes', 'secondes'], ['minutes', 'minutes'], ['heures', 'heures']]),
      erreurChamp(),
      pourquoi('Ce temps, multiplié par le nombre de fois, donne ce que la tâche vous prend sur une année.'),
    ];
    if (q === 'fois') return [
      ...question('Combien de fois la faites-vous ?', 'Choisissez le rythme le plus naturel pour vous : par jour, par semaine, par mois ou par an.'),
      nombreEtUnite('tache-fois', 'Nombre de fois', 'fois', 'Rythme', 'periode', [['jour', 'par jour'], ['semaine', 'par semaine'], ['mois', 'par mois'], ['an', 'par an']]),
      erreurChamp(),
      pourquoi('Une tâche courte mais très fréquente pèse souvent plus qu’une longue tâche rare. Le calcul se fait en temps de travail, pas en jours du calendrier : une année, c’est 228 jours, 45,6 semaines ou 11 mois travaillés.'),
    ];
    if (q === 'recette') {
      const r = Pr.recettes.find((x) => x.id === v.recette);
      return [
        ...question('Une automatisation de Living Business fait-elle déjà cette tâche ?', `Living Business a ${pluriel(Pr.recettes.length, 'automatisation prête', 'automatisations prêtes')} à l’emploi. Si l’une d’elles correspond, il n’y a rien à construire : il suffit de la mettre en marche.`),
        liste('tache-recette', 'Automatisation existante', [['', 'Non, aucune ne correspond'], ...Pr.recettes.map((x) => [x.id, x.nom])], v.recette, (val) => { v.recette = val; D.rendre(); }),
        erreurChamp(),
        r ? resultatAssistant('info', `Celle-ci le fait déjà : ${enMinuscule(r.nom)}.`, { detail: `Quand : ${enMinuscule(r.quand)}. Alors : ${enMinuscule(r.alors)}. Aujourd’hui, ${ETAT_RECETTE[r.etat]}${r.etat === 'a_brancher' && r.manque ? ` : le jeu ne voit pas encore ${r.manque}` : ''}.` })
          : h('p', { class: 'bz-t-petit', texte: 'Aucune ne correspond ? Continuez : le résultat vous dira ce qu’il reste à faire.' }),
      ];
    }
    if (q === 'automatiser') return [
      ...question('Combien de temps faudrait-il pour l’automatiser ?', v.recette
        ? 'L’automatisation existe déjà : comptez seulement le temps de la mettre en marche et de vérifier qu’elle fait ce que vous attendez, souvent moins d’une heure.'
        : 'Le temps de la mettre au point, de l’essayer et de l’expliquer à ceux qui s’en servent. Une estimation suffit ; si vous hésitez, voyez large.'),
      nombreEtUnite('tache-automatiser', 'Temps pour l’automatiser', 'tempsAutomatiser', 'Unité', 'uniteAutomatiser', [['minutes', 'minutes'], ['heures', 'heures'], ['jours', 'jours de travail (7 h)']]),
      erreurChamp(),
      pourquoi('C’est la mise de départ. Elle est comparée au temps gagné chaque semaine, pour savoir en combien de temps elle est regagnée.'),
    ];
    const textes = {
      memeFacon: ['La faites-vous toujours de la même façon ?', 'Pensez aux dernières fois où vous l’avez faite.', 'Une automatisation refait exactement la même chose. Plus la tâche varie, plus il faut garder un œil dessus.'],
      casParticuliers: ['Y a-t-il des cas particuliers ?', 'Un client à part, un document différent, une exception à la règle…', 'Les cas particuliers sont ceux qu’une automatisation traite mal. S’ils sont fréquents, mieux vaut qu’elle prépare et que vous validiez.'],
      graviteErreur: ['Si l’automatisation se trompait, ce serait grave ?', 'Imaginez qu’elle envoie le mauvais document, ou au mauvais moment.', 'Quand une erreur coûte cher, l’automatisation doit préparer le travail et vous laisser le dernier mot.'],
    }[q];
    return [...question(textes[0], textes[1]), choix(q), erreurChamp(), pourquoi(textes[2])];
  };
  const corpsResultat = () => {
    const t = S.resultat;
    const c = t.calcul;
    const ligne = (dt, dd, note = null) => h('div', {}, h('dt', { texte: dt }), h('dd', {}, dd, note ? h('small', { texte: note }) : null));
    return [
      h('h3', { class: 'bz-t-titre-4', id: 'tache-question', tabindex: '-1', texte: `« ${t.nom} » : est-ce que ça vaut le coup ?` }),
      resultatAssistant(TON_VERDICT[c.verdict] ?? 'info', c.libelle, { detail: c.raison }),
      h('dl', { class: 'bz-chiffres' },
        ligne('Temps gagné par an', c.tempsAn, `soit ${nfEuro.format(c.euroAn)}`),
        ligne('Automatisation regagnée en', c.delai),
        ligne(`Bilan sur ${pluriel(c.horizonAns, 'an', 'ans')}`, c.tempsHorizon, `soit ${nfEuro.format(c.euroHorizon)}`)),
      messageEnLigne('attention', c.aVerifier),
      calculTacheRepetitive(c),
      suiteTacheRepetitive(t, T),
      messageEnLigne('critique', S.erreur),
      h('p', { class: 'bz-t-petit bz-texte-2', texte: tache ? 'Rien n’est encore changé : enregistrez, ou revenez corriger vos réponses.' : 'Rien n’est encore enregistré : gardez cette tâche pour la retrouver dans votre liste, ou revenez corriger vos réponses.' }),
    ];
  };
  const D = dialogueVivant({
    titre: tache ? 'Modifier une tâche répétitive' : 'Décrire une tâche répétitive', surtitre: 'Optimiser', taille: 'md', onsubmit: continuer,
    contenu: () => ({
      corps: S.etape === nb ? corpsResultat() : corpsQuestion(QUESTIONS_TACHE[S.etape]),
      pied: S.etape === nb ? [
        h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => aller(nb - 1) }, icone('arrow-left'), 'Revenir aux questions'),
        h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, icone('check'), tache ? 'Enregistrer' : 'Garder cette tâche'),
      ] : [
        S.etape === 0 ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => D.fermer() }, 'Annuler')
          : h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => aller(S.etape - 1) }, icone('arrow-left'), 'Retour'),
        h('button', { type: 'submit', class: 'bz-bouton bz-bouton--principal', 'aria-busy': S.envoi ? 'true' : null }, S.etape === nb - 1 ? 'Voir le résultat' : 'Continuer', S.etape === nb - 1 ? null : icone('arrow-right')),
      ],
    }),
  });
  return D;
}

async function rendreOptimiser() {
  const P = $('#page');
  let O;
  let A;
  let Pr;
  let T;
  try { [O, A, Pr, T] = await Promise.all([api('GET', '/optimisations'), api('GET', '/automatisations'), api('GET', '/automatisations/preparation'), api('GET', '/automatisations/taches')]); } catch (e) { if (E.vue === 'optimiser') remplir(P, erreurEcran('Les pistes d’optimisation n’ont pas pu être chargées.', e, () => rendreOptimiser())); return; }
  if (E.vue !== 'optimiser') return;
  const admin = E.monde.profil.peutAdministrer;
  const erreur = E.optimiserErreur ?? null;
  const basculer = async (id, actif) => {
    E.optimiserErreur = null;
    try { await api('POST', `/automatisations/${id}`, { actif }); informer(actif ? 'Automatisation activée : elle agit dès maintenant sur vos données réelles.' : 'Automatisation désactivée.', 'ok'); } catch (e) { E.optimiserErreur = e.message; }
    rendreOptimiser();
  };
  const pistes = [...O.opportunites].sort((a, b) => Number(a.active) - Number(b.active) || b.heuresMois - a.heuresMois);
  // une seule action principale par écran : « Tout automatiser » quand des automatisations sont prêtes, sinon la piste la plus rentable
  const toutPret = admin && Pr.recettes.some((r) => r.etat === 'prete');
  const premiere = toutPret ? null : pistes.find((o) => !o.active);
  const ICONE_CATEGORIE = (c) => (/factur|paiement|relance/i.test(c) ? 'receipt' : /stock|achat/i.test(c) ? 'boxes' : /courrier|mail/i.test(c) ? 'mail' : /planning|équipe/i.test(c) ? 'calendar-days' : /connect|outil|saisie/i.test(c) ? 'plug' : 'sparkles');
  remplir(P, h('div', { class: 'bz-ecran bz-optimiser' },
    h('div', { class: 'bz-tuiles' },
      h('dl', { class: 'bz-tuile bz-tuile--grande' },
        h('dt', {}, h('span', { texte: 'Temps à récupérer chaque mois' })),
        h('dd', { class: 'bz-tuile__valeur bz-t-chiffre', 'data-certitude': 'estime', texte: `${nf.format(O.heuresMois)} h` }),
        h('dd', { class: 'bz-tuile__note', texte: `Soit environ ${nfEuro.format(O.euroMois)} par mois, estimé` })),
      h('dl', { class: 'bz-tuile bz-tuile--grande' },
        h('dt', {}, h('span', { texte: 'Pistes déjà automatisées' })),
        h('dd', { class: 'bz-tuile__valeur bz-t-chiffre', texte: `${O.indice} %` }),
        h('dd', { class: 'bz-tuile__note', texte: `${nombre(O.opportunites.filter((o) => o.recette && o.active).length)} sur ${pluriel(O.opportunites.filter((o) => o.recette).length, 'piste automatisable', 'pistes automatisables')}` }))),
    blocAutomatiser(Pr, admin, () => rendreOptimiser()),
    admin ? h('div', { class: 'bz-champ bz-optimiser__taux' },
      h('label', { class: 'bz-champ__libelle', for: 'taux-horaire', texte: 'Coût horaire chargé' }),
      h('div', { class: 'bz-champ__suffixe' },
        h('input', { id: 'taux-horaire', class: 'bz-champ__saisie', type: 'number', min: '1', max: '999', inputmode: 'decimal', value: String(A.tauxHoraire), 'aria-describedby': 'taux-aide',
          onchange: async (e) => { try { await api('PUT', '/automatisations/reglages', { tauxHoraire: Number(e.target.value) }); E.optimiserErreur = null; } catch (err) { E.optimiserErreur = err.message; } rendreOptimiser(); } }),
        h('span', { class: 'bz-champ__unite', 'aria-hidden': 'true', texte: '€ / h' })),
      h('p', { class: 'bz-champ__aide', id: 'taux-aide', texte: 'Il sert à chiffrer chaque piste en euros. Ajustez-le à votre réalité.' })) : null,
    messageEnLigne('critique', erreur),
    h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Calculé sur vos données réelles (retards, stock, courrier, planning, gestes répétés). Chaque estimation affiche son hypothèse.' }),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'pistes-titre' },
      h('h2', { class: 'bz-t-titre-4', id: 'pistes-titre', texte: pistes.length ? 'Pistes, de la plus rentable à la moins rentable' : 'Pistes' }),
      pistes.length ? h('ol', { class: 'bz-liste-simple bz-optimiser__pistes', role: 'list' }, pistes.map((o, i) => h('li', {},
        h('article', { class: `bz-proposition${o.active ? ' bz-proposition--validee' : ''}`, 'aria-labelledby': `piste-${i}` },
          h('p', { class: 'bz-proposition__tete bz-t-petit' }, icone(o.active ? 'circle-check' : 'bot', { taille: 'sm' }), o.active ? 'Automatisé' : `Proposé par Living Business · ${o.categorie}`),
          h('div', { class: 'bz-proposition__corps' },
            h('span', { class: 'bz-cat bz-cat--carre', 'aria-hidden': 'true' }, icone(ICONE_CATEGORIE(o.categorie), { taille: 'sm' })),
            h('div', { class: 'bz-pile bz-pile--serre' },
              h('h3', { class: 'bz-t-titre-4', id: `piste-${i}`, texte: o.titre }),
              h('p', { class: 'bz-t-chiffre bz-proposition__gain', 'data-certitude': 'estime' }, `${nf.format(o.heuresMois)} h par mois`, h('span', { class: 'bz-t-petit bz-texte-2', texte: ` · ${nfEuro.format(o.euroMois)}, estimé` })))),
          h('div', { class: 'bz-proposition__pourquoi' },
            h('p', { class: 'bz-t-label', texte: 'Pourquoi ?' }),
            h('ul', { class: 'bz-proposition__raisons' }, h('li', { texte: o.constat }), h('li', { texte: o.proposition }), h('li', { class: 'bz-texte-2', texte: `Hypothèse : ${/^\p{Lu}\p{Ll}/u.test(o.hypothese) ? `${o.hypothese.charAt(0).toLocaleLowerCase('fr-FR')}${o.hypothese.slice(1)}` : o.hypothese}` }))),
          h('div', { class: 'bz-groupe-boutons' },
            o.recette && admin ? h('button', { type: 'button', class: `bz-bouton ${o === premiere ? 'bz-bouton--principal' : 'bz-bouton--secondaire'}`, onclick: () => basculer(o.recette, !o.active) }, icone(o.active ? 'pause' : 'zap'), o.active ? 'Désactiver' : 'Automatiser') : null,
            o.id === 'connecter' && admin ? h('button', { type: 'button', class: `bz-bouton ${o === premiere ? 'bz-bouton--principal' : 'bz-bouton--secondaire'}`, onclick: () => ouvrirAssistant() }, icone('plug'), 'Connecter mes données') : null,
            o.objets.length ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome', onclick: () => ouvrirSurCarte(o.objets[0]) }, icone('eye'), `Voir ${pluriel(o.objets.length, 'élément concerné', 'éléments concernés')}`) : null,
            o.recette && !admin ? h('span', { class: 'bz-t-petit bz-texte-2', texte: o.active ? 'Automatisé' : 'À activer par la direction' }) : null))))) : blocVide({ titre: 'Rien à optimiser pour l’instant.', texte: 'Connectez vos données pour une analyse complète.', actions: admin ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => ouvrirAssistant() }, icone('plug'), 'Connecter mes données') : null })),
    blocTachesRepetitives(T, Pr, admin, { basculer, apres: () => rendreOptimiser() }),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'recettes-titre' },
      h('div', {}, h('h2', { class: 'bz-t-titre-4', id: 'recettes-titre', texte: 'Automatisations' }),
        h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Quand… alors… Elles agissent sur le réel, jamais en simulation, sans jamais faire deux fois la même chose.' })),
      h('div', { class: 'bz-tableau-cadre' }, h('table', { class: 'bz-tableau bz-tableau--empile' },
        h('thead', {}, h('tr', {}, ['Automatisation', 'Quand', 'Alors', 'Déclenchée', 'Active'].map((t) => h('th', { scope: 'col', texte: t })))),
        h('tbody', {}, A.recettes.map((r) => h('tr', {},
          h('th', { scope: 'row', texte: r.nom }), h('td', { 'data-colonne': 'Quand', texte: r.quand }), h('td', { 'data-colonne': 'Alors', texte: r.alors }),
          h('td', { 'data-colonne': 'Déclenchée', texte: r.declenchements ? `${pluriel(r.declenchements, 'fois', 'fois')} · ${dateRelative(r.dernier)}` : 'Jamais' }),
          h('td', { 'data-colonne': 'Active' }, admin ? h('label', { class: 'bz-interrupteur' },
            h('input', { type: 'checkbox', role: 'switch', checked: r.active, cle: `recette-${r.id}`, onchange: (e) => basculer(r.id, e.target.checked) }),
            h('span', { class: 'bz-visuellement-cache', texte: r.nom }), h('span', { class: 'bz-interrupteur__etat', 'aria-hidden': 'true', texte: r.active ? 'Activée' : 'Désactivée' }))
            : h('span', { texte: r.active ? 'Active' : 'Inactive' }))))))),
      A.recettes.some((r) => r.id === 'relance-factures') ? h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Pour envoyer réellement des e-mails ou écrire dans vos logiciels, branchez Make, Zapier ou n8n (Réglages › Connecteurs) : chaque automatisation leur envoie un événement signé.' }) : null),
    encartEditeur()));
}

// ---------------------------------------------------------------- horloge
/** Date et heure de l'en-tête d'« Aujourd'hui » : « mardi 10 novembre · 15 h 42 ». */
function horloge() {
  const d = new Date();
  return typo(`${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })} · ${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`);
}
setInterval(() => { const el = $('#horloge'); if (el) el.textContent = horloge(); }, 20_000);

// ---------------------------------------------------------------- départements (§6.1 P8)
/* Cartes du §4.8 (plus de liseré de couleur), tableau des tâches en kanban : glisser une carte, toujours doublé du menu
   « Déplacer vers… » et d'Alt + flèche au clavier ; enregistrement optimiste avec « Annuler ». Module pur :
   web/departements.js. */
let DEPS = null;
const chargerDepartements = async () => (DEPS ??= await import('/departements.js'));
const valeurDe = (o, id) => o.champs.find((c) => c.id === id)?.valeur ?? null;
/** Départements d'un objet : direct (champ département) ou, pour un tiers, via ses commandes et projets. */
function departementsDe(o) {
  const d = valeurDe(o, 'departement');
  if (typeof d === 'string') return [d];
  if (o.famille !== 'tiers') return [];
  return [...new Set(E.monde.objets.filter((x) => x.champs.some((c) => c.lien?.id === o.id)).map((x) => valeurDe(x, 'departement')).filter((v) => typeof v === 'string'))];
}
const dansFiltre = (o) => E.filtreDep === 'tous' || departementsDe(o).includes(E.filtreDep);

function statsDepartement(d) {
  const m = E.monde;
  const membres = m.objets.filter((o) => valeurDe(o, 'departement') === d.id);
  const ids = new Set(membres.map((o) => o.id));
  const employes = membres.filter((o) => o.famille === 'personne');
  const dispo = employes.filter((e) => { const v = valeurDe(e, 'disponibilite'); return v === null || v === 'disponible'; });
  const taches = membres.filter((o) => o.famille === 'tache');
  const parStatut = Object.fromEntries((DEPS?.STATUTS ?? ['à faire', 'en cours', 'bloquée', 'terminée']).map((s) => [s, taches.filter((t) => (DEPS ? DEPS.statutDe(t) : valeurDe(t, 'statut') ?? 'à faire') === s)]));
  const situations = trierSituations(m.situations.filter((s) => ids.has(s.objetId)));
  const enRetard = new Set(situations.filter((s) => s.regle === 'tache_en_retard').map((s) => s.objetId));
  const commandes = membres.filter((o) => o.famille === 'commande');
  const ouvertes = commandes.filter((c) => valeurDe(c, 'payee') !== true && !['livrée', 'facturée', 'reçue', 'refusé'].includes(valeurDe(c, 'statut')));
  const montant = ouvertes.reduce((n, c) => n + (Number(valeurDe(c, 'montant')) || 0), 0);
  const ressources = membres.filter((o) => o.famille === 'ressource');
  const projets = membres.filter((o) => o.famille === 'projet');
  const responsable = m.objets.find((o) => o.id === valeurDe(d, 'responsable'));
  return { membres, employes, dispo, taches, parStatut, situations, enRetard, commandes, ouvertes, montant, ressources, projets, responsable };
}

/** Répartition des tâches (barre empilée, SVG) doublée du texte : « 3 à faire · 2 en cours · 1 bloquée ». */
function barreTaches(st) {
  const total = st.taches.length;
  const texte = (DEPS?.STATUTS ?? []).filter((s) => st.parStatut[s]?.length).map((s) => `${st.parStatut[s].length} ${s}`).join(' · ') || 'Aucune tâche';
  const s = svg('svg', { class: 'bz-barre bz-barre--empilee', viewBox: '0 0 100 8', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
  s.append(svg('rect', { class: 'bz-barre__piste', x: 0, y: 0, width: 100, height: 8 }));
  let x = 0;
  for (const st2 of DEPS?.STATUTS ?? []) {
    const n = st.parStatut[st2]?.length ?? 0;
    if (!n || !total) continue;
    const l = (100 * n) / total;
    s.append(svg('rect', { class: 'bz-barre__segment', 'data-statut': st2.replace(/\s/g, '-'), x, y: 0, width: l, height: 8 }));
    x += l;
  }
  return h('div', { class: 'bz-departement__taches' }, s, h('p', { class: 'bz-t-micro bz-texte-2', texte }));
}

async function rendreDepartements() {
  await chargerDepartements();
  if (E.vue !== 'departements') return;
  const m = E.monde;
  const deps = m.objets.filter((o) => o.famille === 'departement');
  const exemple = deps.some((d) => d.mode === 'demo');
  remplir($('#page'), h('div', { class: 'bz-ecran bz-departements' },
    h('div', { class: 'bz-liste__tete' },
      h('p', { class: 'bz-liste__compte bz-t-petit bz-texte-2' }, pluriel(deps.length, 'département', 'départements'), m.organisation.taille ? ` · ${m.organisation.taille}` : '', exemple ? badgeExemple() : null),
      h('div', { class: 'bz-groupe-boutons' },
        !E.sceneEchec ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: () => { E.vueCarte = 'departements'; changerVue('carte'); } }, icone('map'), 'Voir sur la carte') : null,
        m.profil.peutAdministrer ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => ouvrirSaisie({ type: 'departement' }) }, icone('plus'), 'Ajouter un département') : null)),
    h('p', { class: 'bz-t-petit bz-texte-2', texte: m.organisation.vueParDefaut === 'departements' ? 'La carte s’ouvre par département : chaque service a son équipe, ses tâches, ses dossiers et ses alertes.' : 'La carte montre l’entreprise d’un seul tenant. Vous pouvez la sectoriser par département à tout moment.' }),
    deps.length ? h('ul', { class: 'bz-departements__grille', role: 'list' }, deps.map((d) => {
      const st = statsDepartement(d);
      const crit = st.situations.filter((s) => s.gravite === 'critique' && s.statut === 'ouverte').length;
      const ton = crit ? 'critique' : st.situations.length ? 'attention' : null;
      const ouvertes = st.taches.length - (st.parStatut['terminée']?.length ?? 0);
      return h('li', {}, h('article', { class: 'bz-carte bz-departement', 'aria-labelledby': `dep-${idDom(d.id)}` },
        h('div', { class: 'bz-carte__tete' },
          h('span', { class: 'bz-cat bz-cat--carre', 'aria-hidden': 'true' }, icone('building-2', { taille: 'sm' })),
          h('h2', { class: 'bz-carte__titre', id: `dep-${idDom(d.id)}` }, h('a', { href: `#/dep:${d.id}`, class: 'bz-carte__lien', onclick: (e) => allerA(`dep:${d.id}`, e), texte: sansDemo(d.nom) })),
          ton ? h('span', { class: `bz-badge bz-badge--${ton}` }, icone(ICONE_TON[ton], { taille: 'sm' }), pluriel(st.situations.length, 'alerte', 'alertes'))
            : h('span', { class: 'bz-badge bz-badge--ok' }, icone('circle-check', { taille: 'sm' }), 'En ordre')),
        valeurDe(d, 'mission') ? h('p', { class: 'bz-t-petit bz-texte-2', texte: valeurDe(d, 'mission') }) : null,
        h('dl', { class: 'bz-chiffres bz-departement__chiffres' },
          h('div', {}, h('dt', { texte: 'Disponibles' }), h('dd', { class: 'bz-t-chiffre', texte: `${st.dispo.length} sur ${st.employes.length}` })),
          h('div', {}, h('dt', { texte: 'Tâches ouvertes' }), h('dd', { class: 'bz-t-chiffre', texte: nombre(ouvertes) })),
          st.ouvertes.length ? h('div', {}, h('dt', { texte: pluriel(st.ouvertes.length, 'dossier en cours', 'dossiers en cours') }), h('dd', { class: 'bz-t-chiffre', texte: nfEuro.format(st.montant) })) : null),
        barreTaches(st),
        st.responsable ? h('p', { class: 'bz-t-micro bz-texte-2', texte: `Responsable : ${sansDemo(st.responsable.nom)}` }) : null));
    })) : blocVide({ titre: 'Aucun département pour le moment.', texte: 'Ajoutez vos services pour lire l’entreprise par équipe.', actions: m.profil.peutAdministrer ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: () => ouvrirSaisie({ type: 'departement' }) }, icone('plus'), 'Ajouter un département') : null })));
}

/** Déplace une tâche (optimiste), avec « Annuler » ; un refus la remet en place, avec la raison sur la carte. */
async function deplacerTache(t, statut) {
  const avant = DEPS.statutDe(t);
  if (avant === statut) return;
  const c = t.champs.find((x) => x.id === 'statut');
  if (c) c.valeur = statut; else t.champs.push({ id: 'statut', libelle: 'Statut', type: 'choix', valeur: statut });
  (E.kanbanErreurs ??= new Map()).delete(t.id);
  E.kanbanFocus = t.id;
  rendreVue();
  annoncer(DEPS.texteDeplacement(statut));
  try {
    const a = await ecrireChamp(t, 'statut', statut);
    if (a.etat === 'echouee' || a.etat === 'resultat_inconnu') throw Object.assign(new Error(a.message ?? 'Déplacement refusé.'), { statut: 409 });
    if (a.etat === 'en_attente') informer('Déplacement envoyé pour approbation.', '');
    else actionAnnulable({ texte: DEPS.texteDeplacement(statut), libelle: `déplacement de la tâche ${sansDemo(t.nom)}`, annuler: async () => { await ecrireChamp(t, 'statut', avant); await charger(); } });
    await charger();
  } catch (e) {
    if (c) c.valeur = avant;
    E.kanbanErreurs.set(t.id, e.statut ? `Pas déplacée : ${e.message}` : 'Pas déplacée : la connexion a été perdue. Réessayez.');
    rendreVue();
  }
}

async function rendreDepartement(id) {
  const K = await chargerDepartements();
  if (E.vue !== `dep:${id}`) return;
  const m = E.monde;
  const d = m.objets.find((o) => o.id === id);
  if (!d) { E.vue = 'departements'; return rendreDepartements(); }
  const st = statsDepartement(d);
  const peut = Boolean(m.profil.peutPreparer);
  const erreurs = E.kanbanErreurs ?? new Map();
  const colonnes = K.colonnes(st.taches, st.enRetard);
  const carteTache = (t) => {
    const retard = st.enRetard.has(t.id);
    const ech = valeurDe(t, 'echeance');
    const statut = K.statutDe(t);
    const clavier = (e) => {
      if (!peut || !e.altKey || !['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
      e.preventDefault();
      const v = K.voisine(statut, e.key === 'ArrowLeft' ? 'gauche' : 'droite');
      if (v) deplacerTache(t, v);
    };
    return h('li', { class: 'bz-kanban__carte', draggable: peut ? 'true' : null, 'data-tache': t.id, 'data-retard': retard ? '' : null,
      ondragstart: (e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.setAttribute('data-glisse', ''); },
      ondragend: (e) => e.currentTarget.removeAttribute('data-glisse') },
      h('a', { href: `#/dep:${id}`, class: 'bz-kanban__titre', cle: `tache-${t.id}`, 'aria-keyshortcuts': peut ? 'Alt+ArrowLeft Alt+ArrowRight' : null, 'aria-describedby': `tache-meta-${idDom(t.id)}`,
        onclick: (e) => { e.preventDefault(); selectionner(t.id); }, onkeydown: clavier, texte: sansDemo(t.nom) }),
      h('p', { class: 'bz-t-micro bz-texte-2', id: `tache-meta-${idDom(t.id)}` },
        retard ? h('span', { class: 'bz-badge bz-badge--critique' }, icone('octagon-alert', { taille: 'sm' }), 'En retard') : null,
        ech ? ` Échéance ${date(ech)}` : ' Sans échéance'),
      erreurs.has(t.id) ? h('p', { class: 'bz-champ__erreur', role: 'alert' }, icone('circle-alert', { taille: 'sm' }), h('span', { texte: erreurs.get(t.id) })) : null,
      peut ? menuActions({ id: `menu-tache-${idDom(t.id)}`, libelle: `Déplacer ${sansDemo(t.nom)}`, texte: 'Déplacer vers…', icone: 'move', classe: 'bz-bouton bz-bouton--fantome bz-bouton--sm',
        items: [...K.destinations(t).map((x) => ({ libelle: x.libelle, icone: K.ICONE_STATUT[x.statut], faire: () => deplacerTache(t, x.statut) })), { libelle: 'Ouvrir la fiche', icone: 'panel-left', faire: () => selectionner(t.id) }] }) : null);
  };
  const colonne = (c) => h('section', { class: 'bz-kanban__colonne', 'data-statut': c.statut.replace(/\s/g, '-'), 'aria-labelledby': `col-${c.statut.replace(/\s/g, '-')}`,
    ondragover: (e) => { if (!peut) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; e.currentTarget.setAttribute('data-survol', ''); },
    ondragleave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) e.currentTarget.removeAttribute('data-survol'); },
    ondrop: (e) => { e.preventDefault(); e.currentTarget.removeAttribute('data-survol'); const t = st.taches.find((x) => x.id === e.dataTransfer.getData('text/plain')); if (t) deplacerTache(t, c.statut); } },
    h('h3', { class: 'bz-kanban__tete bz-t-label', id: `col-${c.statut.replace(/\s/g, '-')}` }, icone(K.ICONE_STATUT[c.statut], { taille: 'sm' }), h('span', { texte: c.libelle }), h('span', { class: 'bz-compteur', texte: String(c.taches.length) })),
    c.taches.length ? h('ul', { class: 'bz-kanban__liste', role: 'list' }, c.taches.map(carteTache)) : h('p', { class: 'bz-kanban__vide bz-t-petit bz-texte-2', texte: 'Aucune tâche' }));
  const ligneMembre = (o, sous) => h('li', {}, h('a', { href: `#/dep:${id}`, class: 'bz-ligne-lieu', onclick: (e) => { e.preventDefault(); selectionner(o.id); } },
    o.famille === 'personne' ? h('span', { class: 'bz-avatar', 'aria-hidden': 'true', 'data-absent': valeurDe(o, 'disponibilite') && valeurDe(o, 'disponibilite') !== 'disponible' ? '' : null, texte: initiale(o.nom) })
      : h('span', { class: `bz-cat bz-cat--${categorieDe(o).forme}`, 'aria-hidden': 'true' }, icone(categorieDe(o).icone, { taille: 'sm' })),
    h('span', { class: 'bz-ligne-lieu__texte' }, h('span', { class: 'bz-ligne-lieu__nom', texte: sansDemo(o.nom) }), sous ? h('span', { class: 'bz-ligne-lieu__meta', texte: sous }) : null)));
  remplir($('#page'), h('div', { class: 'bz-ecran bz-departement-page' },
    h('p', {}, h('a', { href: '#/departements', class: 'bz-lien-fleche', onclick: (e) => allerA('departements', e) }, icone('arrow-left', { taille: 'sm' }), 'Tous les départements')),
    h('div', { class: 'bz-liste__tete' },
      h('div', { class: 'bz-pile bz-pile--serre' },
        valeurDe(d, 'mission') ? h('p', { class: 'bz-t-chapeau', texte: valeurDe(d, 'mission') }) : null,
        st.responsable ? h('p', { class: 'bz-t-petit bz-texte-2', texte: `Responsable : ${sansDemo(st.responsable.nom)}` }) : null),
      h('div', { class: 'bz-groupe-boutons' },
        !E.sceneEchec ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire', onclick: async () => { E.vueCarte = 'departements'; E.vue = 'carte'; rendreBarre(); await rendreVue(); selectionner(d.id); } }, icone('map'), 'Voir sur la carte') : null,
        peut ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal', onclick: async () => { await selectionner(d.id); const a = E.fiche?.actionsPossibles?.find((x) => x.capacite === 'tache.creer'); if (a) { E.formulaire = nouveauFormulaire(a); rendreFiche(); } } }, icone('plus'), 'Créer une tâche') : null)),
    h('div', { class: 'bz-tuiles' },
      [['Disponibles', `${st.dispo.length} sur ${st.employes.length}`, 'Déclaré au planning', null],
        ['Tâches en retard', nombre(st.enRetard.size), pluriel(st.taches.length - (st.parStatut['terminée']?.length ?? 0), 'tâche ouverte', 'tâches ouvertes'), st.enRetard.size ? 'attention' : null],
        ['Alertes', nombre(st.situations.length), pluriel(st.situations.filter((s) => s.gravite === 'critique').length, 'critique', 'critiques'), st.situations.some((s) => s.gravite === 'critique') ? 'critique' : st.situations.length ? 'attention' : null],
        ['Dossiers en cours', nombre(st.ouvertes.length), st.montant ? nfEuro.format(st.montant) : 'Aucun montant', null],
      ].map(([l, v, n, ton]) => h('dl', { class: 'bz-tuile' }, h('dt', {}, h('span', { texte: l }), ton ? iconeEtat(ton, { taille: 'sm', classe: 'bz-tuile__etat' }) : null),
        h('dd', { class: 'bz-tuile__valeur bz-t-chiffre', texte: v }), h('dd', { class: 'bz-tuile__note', texte: n })))),
    h('section', { class: 'bz-pile', 'aria-labelledby': 'kanban-titre' },
      h('div', {}, h('h2', { class: 'bz-t-titre-4', id: 'kanban-titre', texte: 'Tableau des tâches' }),
        peut ? h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Glissez une carte d’une colonne à l’autre, ou utilisez « Déplacer vers… ». Au clavier : Alt + flèche gauche ou droite.' }) : null),
      h('div', { class: 'bz-kanban' }, colonnes.map(colonne))),
    st.situations.length ? h('section', { class: 'bz-pile', 'aria-labelledby': 'dep-regler' },
      h('h2', { class: 'bz-t-titre-4', id: 'dep-regler', texte: 'À régler dans le département' }),
      h('ol', { class: 'bz-priorites' }, st.situations.map((s) => lignePriorite(s)))) : null,
    h('div', { class: 'bz-deux-colonnes' },
      h('section', { class: 'bz-pile', 'aria-labelledby': 'dep-equipe' },
        h('h2', { class: 'bz-t-titre-4', id: 'dep-equipe', texte: `Équipe · ${st.employes.length}` }),
        st.employes.length ? h('ul', { class: 'bz-liste-simple', role: 'list' }, st.employes.map((e) => { const dispo = valeurDe(e, 'disponibilite'); return ligneMembre(e, [valeurDe(e, 'poste'), dispo && dispo !== 'disponible' ? dispo : null].filter(Boolean).join(' · ')); })) : blocVide({ titre: 'Personne dans ce département.', compact: true })),
      h('section', { class: 'bz-pile', 'aria-labelledby': 'dep-dossiers' },
        h('h2', { class: 'bz-t-titre-4', id: 'dep-dossiers', texte: 'Dossiers, stock et matériel' }),
        [...st.ouvertes, ...st.ressources, ...st.projets].length ? h('ul', { class: 'bz-liste-simple', role: 'list' }, [...st.ouvertes, ...st.ressources, ...st.projets].map((o) => ligneMembre(o, `${o.libelleType}${valeurDe(o, 'montant') ? ` · ${nfEuro.format(valeurDe(o, 'montant'))}` : ''}`))) : blocVide({ titre: 'Rien en cours.', compact: true })))));
  if (E.kanbanFocus) { const k = E.kanbanFocus; E.kanbanFocus = null; setTimeout(() => $(`[data-cle="tache-${CSS.escape(k)}"]`)?.focus({ preventScroll: true }), 0); }
}

/** Filtre par département (puces neutres, §4.12) : plus de couleur par département dans l'interface. */
function filtreDepartements() {
  const deps = E.monde.objets.filter((o) => o.famille === 'departement');
  if (!deps.length) return null;
  const choisir = (id) => { E.filtreDep = id; rendreVue(); };
  return h('ul', { class: 'bz-puces', 'aria-label': 'Filtrer par département' },
    h('li', {}, h('button', { type: 'button', class: 'bz-puce', 'aria-pressed': E.filtreDep === 'tous', onclick: () => choisir('tous') }, E.filtreDep === 'tous' ? icone('check', { taille: 'sm' }) : null, 'Toute l’entreprise')),
    deps.map((d) => h('li', {}, h('button', { type: 'button', class: 'bz-puce', 'aria-pressed': E.filtreDep === d.id, onclick: () => choisir(d.id) }, E.filtreDep === d.id ? icone('check', { taille: 'sm' }) : icone('building-2', { taille: 'sm' }), sansDemo(d.nom)))));
}

/** Situation à régler (§4.8) : objet et raison, preuve (source, date, fraîcheur), action directe et « Voir ». */
function lignePriorite(s) {
  const o = E.monde.objets.find((x) => x.id === s.objetId);
  const n = niveau(s);
  const ton = n === 'a_verifier' ? 'info' : n;
  const quete = o && E.monde.profil.peutPreparer && E.monde.quetes.find((q) => q.origine.objetId === o.id && q.statut === 'ouverte');
  return h('li', { class: 'bz-priorite' },
    h('span', { class: 'bz-priorite__icone' }, iconeEtat(ton, { decoratif: true })),
    h('div', { class: 'bz-priorite__texte' },
      h('p', { class: 'bz-priorite__titre', texte: o ? `${sansDemo(o.nom)} : ${s.description}` : s.description }),
      h('p', { class: 'bz-t-micro bz-texte-2', texte: [o?.libelleType, s.preuve.source.libelle, s.preuve.observeLe ? dateRelative(s.preuve.observeLe) : null, LIBELLES.fraicheur[s.preuve.fraicheur]].filter(Boolean).join(' · ') })),
    h('div', { class: 'bz-priorite__action bz-groupe-boutons' },
      quete ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--sm', onclick: () => ouvrirSurCarte(o.id, true) }, quete.actionProposee === 'mouvement' ? 'Enregistrer un mouvement' : 'Créer une tâche') : null,
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => ouvrirSurCarte(s.objetId) }, 'Voir')));
}

// ---------------------------------------------------------------- palette de commandes (⌘K, / ou « Chercher »)
const sansAccent = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const ouvrirRecherche = () => ouvrirPalette();
const fermerRecherche = () => fermerPalette();
const ICONE_FAMILLE = { tiers: 'handshake', personne: 'user', lieu: 'map-pin', departement: 'building-2', ressource: 'package', commande: 'receipt', projet: 'kanban', tache: 'circle-check', organisation: 'store' };
const ICONE_NIVEAU = { critique: 'octagon-alert', attention: 'triangle-alert', info: 'info', a_verifier: 'circle-help' };
const ICONE_VUE = { carte: 'map', matin: 'house', sante: 'heart-pulse', departements: 'building-2', planning: 'calendar-days', courrier: 'mail', satisfaction: 'star', optimiser: 'trending-up', nexus: 'bz-nexus', 'role:client': 'users', 'role:fournisseur': 'truck', 'famille:personne': 'user', 'famille:ressource': 'package', 'famille:commande': 'receipt', 'type:document': 'file-text', 'famille:lieu': 'map-pin' };
const RACCOURCI_VUE = { carte: 'g c', matin: 'g a', planning: 'g p', courrier: 'g m', nexus: 'g n', 'role:fournisseur': 'g f', 'famille:ressource': 'g s' };
const allerCarte = (vue) => { E.vue = 'carte'; rendreBarre(); rendreVue().then(() => changerVueCarte(vue)); };
function themeSuivant() {
  const t = window.bzTheme?.lire();
  return t?.themeEffectif === 'sombre' ? { valeur: 'clair', titre: 'Passer en thème clair', icone: 'sun' } : { valeur: 'sombre', titre: 'Passer en thème sombre', icone: 'moon' };
}
function groupeObjets(objets, filtre, groupe, contexte) {
  return { groupe, elements: objets.filter(filtre).map((o) => ({
    id: `objet:${o.id}`, titre: sansDemo(o.nom), contexte: contexte(o), icone: ICONE_FAMILLE[o.famille] ?? 'circle',
    mots: `${o.libelleType} ${o.roles.map((r) => r.libelle).join(' ')} ${o.champs.map((c) => c.lien?.nom ?? c.valeur ?? '').join(' ')}`,
    faire: () => selectionner(o.id),
  })) };
}
/** Contenu de la palette : Suggestions, Actions, Aller à (recherche vide), puis les objets du monde et l'aide. */
function contenuPalette(_requete = '', { plus = false } = {}) {
  const m = E.monde;
  if (!m) return [];
  const u = m.univers;
  const libelleRole = (id, defaut) => u.roles.find((r) => r.id === id)?.pluriel ?? defaut;
  const sits = trierSituations(m.situations.filter((s) => s.statut === 'ouverte' || s.statut === 'a_verifier'));
  const alerte = (s) => { const o = m.objets.find((x) => x.id === s.objetId); return { id: `situation:${s.id ?? s.objetId}:${s.regle ?? ''}`, titre: lisible(s.description), contexte: o ? sansDemo(o.nom) : 'Situation', icone: ICONE_NIVEAU[niveau(s)] ?? 'info', mots: o?.nom ?? '', faire: () => selectionner(s.objetId) }; };
  const ts = themeSuivant();
  const actions = [
    m.profil.peutAdministrer ? { id: 'action:connecter', titre: 'Connecter mes données', icone: 'plug', mots: 'importer fichier excel google', faire: () => ouvrirAssistant() } : null,
    { id: 'action:simulation', titre: m.mode === 'simulation' ? 'Quitter la simulation' : 'Passer en mode simulation', icone: 'flask-conical', raccourci: '$mod+shift+s', faire: () => basculerSimulation(m.mode !== 'simulation') },
    plus ? null : { id: 'action:plein-soleil', titre: window.bzTheme?.lire().pleinSoleil ? 'Quitter le mode Plein soleil' : 'Plein soleil', contexte: 'Contraste élevé, panneaux opaques', icone: 'sun', mots: 'contraste lumiere exterieur', faire: () => { const oui = window.bzTheme?.pleinSoleil(); informer(oui ? 'Plein soleil activé.' : 'Plein soleil désactivé.', 'ok'); } },
    { id: `action:theme-${ts.valeur}`, titre: ts.titre, icone: ts.icone, mots: 'theme apparence nuit jour', faire: () => window.bzTheme?.regler('theme', ts.valeur) },
    { id: 'action:theme-systeme', titre: 'Suivre le thème du système', icone: 'monitor', mots: 'theme apparence automatique', faire: () => window.bzTheme?.regler('theme', 'systeme') },
    { id: 'action:annuler', titre: 'Annuler la dernière action', icone: 'undo-2', raccourci: '$mod+z', faire: () => annulerDerniere() },
    { id: 'action:apparence', titre: 'Apparence et accessibilité', contexte: 'Thème, taille du texte, contraste, mode Calme', icone: 'sliders-horizontal', mots: 'reglages preferences theme police animations clavier calme', faire: ouvrirApparence },
    m.progression && !modeCalme() ? { id: 'action:progression', titre: 'Ma progression', contexte: JEU.texteNiveau(m.progression), icone: 'anchor', mots: 'xp niveau port quetes trophees jeu', faire: () => changerVue('progression') } : null,
    { id: 'action:calme', titre: modeCalme() ? 'Quitter le mode Calme' : 'Mode Calme', contexte: 'Masquer XP, quêtes et célébrations', icone: 'moon', mots: 'calme sobre jeu xp quetes', faire: () => reglerCalme(!modeCalme()) },
    plus ? null : { id: 'action:activite', titre: 'Activité récente', contexte: 'Ce qui s’est passé, ce qu’on peut encore annuler', icone: 'bell', mots: 'historique notifications annuler', faire: () => ouvrirActivite() },
    plus ? null : { id: 'action:aide', titre: 'Aide', icone: 'circle-help', mots: 'assistance visite raccourcis', faire: ouvrirAide },
    plus || !rubriquesEnAttente().length ? null : { id: 'action:tout-afficher', titre: toutAffiche() ? 'Revenir au menu simple' : 'Tout afficher dans le menu', contexte: 'Aussi les rubriques qui attendent vos données', icone: 'menu', mots: 'menu complet rubriques cachees masquees toutes simple', faire: () => reglerToutAfficher(!toutAffiche()) },
    estOrdinateur() ? { id: 'action:rail', titre: E.railReplie ? 'Déplier le menu' : 'Replier le menu', icone: E.railReplie ? 'panel-left' : 'panel-left-close', raccourci: 'b', mots: 'rail navigation barre laterale', faire: basculerRail } : null,
    m.profil.peutAdministrer ? { id: 'action:mise-en-route', titre: m.organisation.demo ? 'Créer mon entreprise' : 'Compléter mon entreprise pas à pas', icone: 'building-2', mots: 'accueil mise en route creer lieux equipe services', faire: () => changerVue('accueil') } : null,
    m.profil.peutAdministrer && !m.organisation.demo ? { id: 'action:premiers-pas', titre: 'Premiers pas', icone: 'list-checks', mots: 'accueil demarrer aide checklist', faire: ouvrirPremiersPas } : null,
    INVITE_INSTALLATION ? { id: 'action:installer', titre: 'Installer l’application', icone: 'download', mots: 'pwa ecran d accueil', faire: installerApplication } : null,
    ...(E.connexion?.connexion !== 'comptes' ? E.profilsDemo ?? [] : []).filter((x) => x.id !== m.profil.id).map((x) => ({ id: `action:voir-comme:${x.id}`, titre: `Voir comme ${x.nom}`, contexte: 'Démonstration', icone: 'eye', mots: 'role profil droits', faire: () => voirComme(x.id) })),
    E.connexion?.connexion === 'comptes' ? { id: 'action:deconnexion', titre: 'Se déconnecter', icone: 'log-out', faire: seDeconnecter } : null,
    ...(m.organisation.demo && m.profil.peutAdministrer ? Object.entries(m.organisation.exemples ?? {}) : []).filter(([k]) => k !== m.organisation.exemple)
      .map(([k, l]) => ({ id: `action:exemple:${k}`, titre: `Changer d’exemple : ${l}`, icone: 'flask-conical', mots: 'demo demonstration', faire: () => changerExemple(k) })),
  ].filter(Boolean);
  // « Aller à » sans rien taper montre le menu tel qu'il est ; les rubriques qui attendent leurs données restent
  // trouvées en tapant leur nom, sous leur propre intertitre (la recherche ouvre toujours tout)
  const destination = (o) => ({ id: `vue:${o.cle === 'aujourdhui' ? 'matin' : o.id}`, titre: o.libelle, contexte: o.groupe, icone: o.icone ?? ICONE_VUE[o.id] ?? 'chevron-right', raccourci: o.raccourci ?? RACCOURCI_VUE[o.id], epingle: o.id === 'nexus',
    faire: () => changerVue(o.cle === 'aujourdhui' ? vueAujourdhui() : o.id) });
  const toutes = onglets();
  const vues = [
    ...toutes.filter((o) => rubriqueMontree(o.cle)).map(destination),
    !E.sceneEchec ? { id: 'vue:carte', titre: 'Carte', contexte: 'Aujourd’hui', icone: 'map', raccourci: 'g c', faire: () => changerVue('carte') } : null,
    { id: 'vue:aujourdhui-liste', titre: 'Aujourd’hui en liste', contexte: 'Aujourd’hui', icone: 'list', faire: () => changerVue('matin') },
    m.organisation.departements ? { id: 'vue:carte-departements', titre: 'Carte par départements', icone: 'layers', faire: () => allerCarte('departements') } : null,
    { id: 'vue:carte-entreprise', titre: 'Carte de l’entreprise (lieux)', icone: 'map', faire: () => allerCarte('entreprise') },
    { id: 'vue:recentrer', titre: 'Ramène-moi à l’essentiel', contexte: 'Carte', icone: 'locate-fixed', faire: () => E.scene?.recentrer() },
    // « Réglages » est déjà parmi les destinations (pied du rail) : pas de doublon dans « Aller à »
    E.connexion?.connexion === 'comptes' ? { id: 'vue:compte', titre: 'Mon compte', icone: 'user', faire: () => changerVue('compte') } : null,
  ].filter(Boolean);
  const tiers = (role) => (o) => o.famille === 'tiers' && o.roles.some((r) => r.id === role);
  return [
    // sans rien à suggérer (premier jour), pas d'intertitre « Suggestions » au-dessus de rien
    ...(sits.length ? [{ groupe: 'Suggestions', vide: true, seulementVide: true, max: 5, elements: sits.slice(0, 5).map(alerte) }] : []),
    { groupe: 'Actions', vide: true, elements: actions },
    { groupe: 'Aller à', vide: true, max: 30, elements: vues },
    { groupe: 'Pas encore dans votre menu', elements: toutes.filter((o) => !rubriqueMontree(o.cle)).map(destination) },
    groupeObjets(m.objets, tiers('client'), libelleRole('client', 'Clients'), (o) => [o.libelleType, valeurDe(o, 'ville')].filter(Boolean).join(' · ')),
    groupeObjets(m.objets, tiers('fournisseur'), libelleRole('fournisseur', 'Fournisseurs'), (o) => [o.libelleType, valeurDe(o, 'ville')].filter(Boolean).join(' · ')),
    groupeObjets(m.objets, (o) => o.famille === 'tiers' && !o.roles.some((r) => r.id === 'client' || r.id === 'fournisseur'), 'Partenaires et prospects', (o) => o.roles.map((r) => r.libelle).join(', ') || o.libelleType),
    groupeObjets(m.objets, (o) => o.famille === 'personne', 'Équipe', (o) => o.libelleType),
    groupeObjets(m.objets, (o) => o.famille === 'lieu' || o.famille === 'departement', 'Lieux', (o) => o.libelleType),
    groupeObjets(m.objets, (o) => o.type === 'document' || o.type === 'courrier', 'Documents', (o) => o.libelleType),
    groupeObjets(m.objets, (o) => !['tiers', 'personne', 'lieu', 'departement'].includes(o.famille) && o.type !== 'document' && o.type !== 'courrier', 'Autres', (o) => o.libelleType),
    { groupe: 'Alertes', elements: sits.map(alerte) },
    { groupe: 'Aide', vide: true, elements: [
      { id: 'aide:rubriques', titre: 'Les rubriques du menu', contexte: 'À quoi sert chacune, et quand elle arrive', icone: 'list', mots: 'menu sections tout afficher debloquer apparaitre', faire: ouvrirRubriques },
      { id: 'aide:raccourcis', titre: 'Raccourcis clavier', icone: 'keyboard', raccourci: '?', faire: aideClavier },
      { id: 'aide:premiers-pas', titre: 'Premiers pas', icone: 'flag', mots: 'demarrer commencer', faire: () => changerVue('matin') },
      { id: 'aide:visite', titre: 'Visite guidée', icone: 'circle-help', faire: () => demarrerVisite(true) },
      { id: 'aide:licence', titre: 'Licence de Living Business', icone: 'file-text', mots: 'agpl logiciel libre conditions garantie responsabilite', faire: () => window.open('/licence.html', '_blank', 'noopener') },
      { id: 'aide:code-source', titre: LIBELLE_CODE_SOURCE, icone: 'code-xml', mots: 'sources depot github logiciel libre open source', faire: ouvrirCodeSource },
      { id: 'aide:licences', titre: 'Licences et crédits', icone: 'file-text', mots: 'open source polices icones', faire: () => window.open('/licences.html', '_blank', 'noopener') },
    ] },
  ];
}
sourcePalette(contenuPalette);

// ---------------------------------------------------------------- raccourcis clavier (§4.4) : liste « ? »
function aideClavier() {
  const groupes = raccourcisParGroupe();
  const gestes = Object.entries(GESTES).map(([k, l]) => [TITRES_GESTES[k], l.map((g) => g.split(' : '))]);
  dialogueVivant({
    titre: 'Raccourcis clavier', surtitre: 'Aide', taille: 'md',
    contenu: () => ({
      corps: [
        h('div', { class: 'bz-raccourcis' },
          [...groupes.entries()].map(([g, l]) => h('section', {}, h('h3', { class: 'bz-t-surtitre', texte: g }),
            h('dl', {}, l.map((r) => [h('dt', {}, h('kbd', { texte: r.touches })), h('dd', { texte: r.description })])))),
          gestes.map(([titre, l]) => h('section', {}, h('h3', { class: 'bz-t-surtitre', texte: `Carte · ${titre.toLowerCase()}` }),
            h('dl', {}, l.map(([k, d]) => [h('dt', { texte: k }), h('dd', { texte: d ?? '' })]))))),
        E.monde ? h('p', { class: 'bz-t-petit bz-texte-2', texte: 'Les raccourcis à une touche ne fonctionnent qu’en dehors des champs de saisie. Ils se désactivent dans Réglages › Clavier.' }) : null,
      ],
    }),
  });
}

// ---------------------------------------------------------------- visite guidée
const VISITE = [
  ['Bienvenue dans votre monde', 'Votre entreprise en maquette : mon entreprise au centre, vos clients à l’ouest, vos fournisseurs à l’est, partenaires au nord, prospects sur la plage et le phare Breizhcosystem sur la jetée. Glissez pour vous déplacer, clic droit pour tourner, molette pour zoomer.', () => E.scene?.recentrer()],
  ['Les bâtiments s’ouvrent', 'Double-cliquez sur un bâtiment pour entrer : les murs face à vous s’abaissent, on voit les postes, la salle de réunion, les rayonnages et qui travaille où, avec les prénoms. « Toits » referme tout.', () => { const l = E.monde.objets.find((o) => o.famille === 'lieu' || o.famille === 'departement'); if (l) E.scene?.selectionner(l.id); }],
  ['Entreprise ou départements', 'Petite ou moyenne : l’entreprise d’un seul tenant, par lieux. Plus grande : un bâtiment par département, avec son équipe, son tableau de tâches et ses dossiers. La bascule est en haut de la carte.', () => E.scene?.recentrer()],
  ['Ce que veulent dire les couleurs', 'Rouge : à régler. Orange : à traiter. Bleu : à vérifier (donnée manquante ou ancienne). Rien ne passe au vert sans preuve : une valeur à jour, une réponse, un paiement.', null],
  ['Les personnes', 'Chacun est placé à son lieu de rattachement — ce n’est pas une localisation. Anneau plein : présence confirmée. Pointillés : déclarée au planning. Silhouette grisée : absent.', null],
  ['Vos données', 'Le bouton « Connecter mes données » remplit votre monde : fichier CSV, Google Sheets, copier-coller ou saisie. Rien n’est importé sans votre validation.', null],
];
function demarrerVisite(force = false) {
  try { if (!force && localStorage.getItem('lb-visite-1')) return; } catch { /* stockage indisponible */ }
  if (E.vue !== 'carte') { E.vue = 'carte'; rendreBarre(); rendreVue(); }
  E.visite = 0;
  VISITE[0][2]?.();
  rendreHud();
}
function finirVisite() {
  E.visite = null;
  try { localStorage.setItem('lb-visite-1', '1'); } catch { /* stockage indisponible */ }
  rendreHud();
}
function rendreVisite() {
  const i = E.visite;
  const [titre, texte] = VISITE[i];
  const aller = (j) => { E.visite = j; VISITE[j][2]?.(); rendreHud(); };
  // aide relançable depuis Aide, jamais automatique (§4.20) : une étape à la fois, écrite « 2 sur 6 », sans pastilles
  return h('section', { class: 'bz-carte bz-pile bz-visite', 'aria-labelledby': 'visite-titre' },
    h('p', { class: 'bz-t-surtitre', texte: `Visite guidée · ${i + 1} sur ${VISITE.length}` }),
    h('h3', { class: 'bz-carte__titre', id: 'visite-titre', texte: titre }), h('p', { class: 'bz-t-petit', texte }),
    h('div', { class: 'bz-groupe-boutons' },
      h('button', { type: 'button', class: 'bz-bouton bz-bouton--fantome bz-bouton--sm', onclick: finirVisite }, 'Fermer la visite'),
      i > 0 ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: () => aller(i - 1) }, icone('arrow-left', { taille: 'sm' }), 'Précédent') : null,
      i < VISITE.length - 1 ? h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--sm', onclick: () => aller(i + 1) }, 'Suivant', icone('arrow-right', { taille: 'sm' }))
        : h('button', { type: 'button', class: 'bz-bouton bz-bouton--principal bz-bouton--sm', onclick: finirVisite }, 'Terminer la visite')),
  );
}

// ---------------------------------------------------------------- clavier (raccourcis.js) & lancement
/* Touches simples et séquences « G puis lettre » : hors champ de saisie, désactivables (Réglages › Apparence et
   accessibilité). Les touches propres à la carte ne marchent que sur la carte, quand rien d'autre n'a le focus. */
const dansMonde = () => Boolean(E.monde);
const aucunDialogue = () => !$('#modale')?.childElementCount && !paletteOuverte() && !document.querySelector('dialog[open]');
const surCarte = () => dansMonde() && E.vue === 'carte' && Boolean(E.scene) && aucunDialogue()
  && (document.activeElement === document.body || Boolean(document.activeElement?.closest('#zone')));
raccourci('$mod+k', () => (dansMonde() ? ouvrirPalette() : undefined), { portee: 'partout', dialogue: true, description: 'Rechercher ou faire une action', groupe: 'Général', quand: () => dansMonde() && !$('#modale')?.childElementCount });
raccourci('/', () => ouvrirPalette(), { description: 'Rechercher', groupe: 'Général', quand: dansMonde });
raccourci('?', () => aideClavier(), { description: 'Cette liste des raccourcis', groupe: 'Général', quand: dansMonde });
raccourci('$mod+shift+s', () => basculerSimulation(E.monde.mode !== 'simulation'), { portee: 'partout', description: 'Mode simulation (entrer ou sortir)', groupe: 'Général', quand: () => dansMonde() && aucunDialogue() });
raccourci('$mod+z', () => annulerDerniere(), { description: 'Annuler la dernière action', groupe: 'Général', quand: dansMonde });
raccourci('$mod+shift+z', () => retablirDerniere(), { description: 'Rétablir', groupe: 'Général', quand: dansMonde });
raccourci('$mod+y', () => retablirDerniere(), { quand: dansMonde });
raccourci('escape', () => { if (E.visite !== null) finirVisite(); else if (E.selection) fermerFiche(); }, { portee: 'partout', quand: () => dansMonde() && aucunDialogue() && !popoverOuvert() && (E.visite !== null || Boolean(E.selection)) });
for (const [touche, vue, libelle] of [['a', null, 'Aujourd’hui'], ['c', 'carte', 'Carte'], ['f', 'role:fournisseur', 'Fournisseurs'], ['s', 'famille:ressource', 'Stock'], ['p', 'planning', 'Planning'], ['m', 'courrier', 'Courrier'], ['n', 'nexus', 'Breizhcosystem'], ['r', 'reglages', 'Réglages']]) {
  raccourci(`g ${touche}`, () => changerVue(vue ?? vueAujourdhui()), { description: libelle, groupe: 'Aller à', quand: () => dansMonde() && Boolean($('#coque')) && (vue === null || (vue === 'carte' ? !E.sceneEchec : vueAutorisee(vue))) });
}
raccourci('b', () => basculerRail(), { description: 'Replier ou déplier le menu', groupe: 'Général', quand: () => dansMonde() && Boolean($('#coque')) && estOrdinateur() });
raccourci('h', () => basculerInterface(), { description: 'Masquer ou afficher l’interface', groupe: 'Carte', quand: surCarte });
raccourci('0', () => E.scene.recentrer(), { description: 'Recentrer', groupe: 'Carte', quand: surCarte });
raccourci('d', () => changerVueCarte(E.vueCarte === 'departements' ? 'entreprise' : 'departements'), { description: 'Vue Entreprise ou Départements', groupe: 'Carte', quand: () => surCarte() && Boolean(E.monde.organisation.departements) });
raccourci('p', () => E.scene.vueDessus(), { description: 'Vue de dessus', groupe: 'Carte', quand: surCarte });
raccourci('t', () => { E.scene.calques({ toits: !E.scene.etatCalques().toits }); rendreHud(); }, { description: 'Toits (vue fermée)', groupe: 'Carte', quand: surCarte });
raccourci('espace', () => { E.scene.pause(); rendreHud(); }, { description: 'Pause des animations', groupe: 'Carte', quand: surCarte });
raccourci('l', () => {
  if (estTelephone()) { E.ongletFeuille = E.ongletFeuille === 'aujourdhui' ? 'calques' : 'aujourdhui'; if (E.cranFeuille === 'poignee') E.cranFeuille = 'mi'; rendreHud(); return; }
  const menu = $('#menu-calques');
  if (menu) { if (estOuvert(menu)) cacher(menu); else { montrer(menu); menu.querySelector('button')?.focus(); } }
}, { description: 'Calques et légende', groupe: 'Carte', quand: surCarte });

// Lien d'évitement « Aller au contenu » : vise toujours le <main> de l'écran affiché
new MutationObserver(() => {
  const main = $('#app main');
  const lien = $('.bz-evitement');
  if (!main || !lien) return;
  if (!main.id) main.id = 'contenu';
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  lien.setAttribute('href', `#${main.id}`);
}).observe($('#app'), { childList: true, subtree: true });

demarrer().catch((e) => {
  remplir($('#app'), h('main', { class: 'bz-ecran' }, h('h1', { class: 'bz-t-titre-2', texte: MARQUE.jeu }), encadre('critique', 'Living Business ne répond pas.', `Impossible de joindre la passerelle : ${e.message}`)));
});
