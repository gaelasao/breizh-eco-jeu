/**
 * COMPTE RENDU DE RENDEZ-VOUS, lu dans ce qu'on colle.
 *
 * À qui ça sert : un consultant, un coach, un formateur, un courtier — toute personne dont le travail se mesure en
 * rendez-vous et non en commandes. Son suivi client, c'est la suite des rendez-vous : quand, avec qui, ce qui s'y est
 * dit, et ce qu'il reste à faire. Il n'a pas de stock ni de chantier ; il a des conversations.
 *
 * DEUX CHEMINS, UN SEUL ÉCRAN. Soit on écrit ses notes à la main, soit on colle le résumé rendu par l'outil qui a
 * écouté la réunion — Fathom, Otter, Fireflies, Zoom, Meet, Teams. Dans les deux cas, c'est du texte : ce module le
 * lit et en tire ce qui se range (la date, les participants, ce qu'il reste à faire). Rien n'est deviné en silence :
 * ce qu'il a compris est montré avant d'enregistrer, et se corrige.
 *
 * CE QU'IL NE FAIT PAS. Il n'appelle personne — ni Fathom, ni un modèle de langage. Pas de clé à demander, pas de
 * compte de plus, rien qui sorte de l'ordinateur. Le texte collé reste le compte rendu, mot pour mot : ce qui est lu
 * ici ne le remplace jamais, il s'y ajoute.
 *
 * COMMENT IL LIT. Par les intertitres que ces outils écrivent tous, en français ou en anglais (« Prochaines étapes »,
 * « Next steps », « Action items »…), et par les formes de date usuelles. Quand il ne trouve pas, il le dit en
 * rendant une valeur vide — jamais une date inventée.
 */

/**
 * Ce qu'on tire d'un texte collé :
 * @typedef {object} CompteRendu
 * @property {string} titre        la première ligne utile, sans la date qu'on y accroche souvent
 * @property {string} date         le jour, en ISO (2026-11-17) ; vide si le texte n'en porte pas
 * @property {string} heure        l'heure de début (14:00) ; vide si absente
 * @property {number} minutes      la durée en minutes, 0 si elle n'est pas écrite
 * @property {string[]} participants  les personnes nommées comme présentes
 * @property {string[]} actions    ce qu'il reste à faire, une ligne par action, dans l'ordre du texte
 * @property {string} texte        le texte nettoyé de ses blancs inutiles : c'est lui, le compte rendu
 */

const MOIS = Object.freeze({
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, fev: 2, mar: 3, apr: 4, avr: 4, jun: 6, jul: 7, juil: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
});

const sansAccent = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const deux = (n) => String(n).padStart(2, '0');
const iso = (a, m, j) => (m >= 1 && m <= 12 && j >= 1 && j <= 31 && a >= 1900 && a <= 2200 ? `${a}-${deux(m)}-${deux(j)}` : '');

/** Intertitres qui annoncent ce qu'il reste à faire, chez tous les outils qui résument une réunion. */
const TITRES_ACTIONS = /^\W*(?:prochaines?\s+[ée]tapes?|next\s+steps?|action\s*items?|actions?\s*[àa]\s*mener|[àa]\s*faire|to[\s-]?do|suites?\s*[àa]\s*donner|follow[\s-]?ups?|engagements?|d[ée]cisions?\s+et\s+actions?)\W*:?\s*$/i;
/** Intertitres qui ferment la section des actions (tout autre intertitre la ferme aussi). */
const AUTRE_TITRE = /^\W{0,3}[A-ZÉÈÀÂÎÔÛÇ][^.!?]{2,60}\W*:?\s*$/;
/** Ligne de liste : tiret, puce, case à cocher, ou numéro. */
const PUCE = /^\s*(?:[-–—*•▪·]|\[[ xX]?\]|\d{1,2}[.)])\s+/;
/** Ligne « Participants : … », « Attendees: … », « Présents — … ». */
const LIGNE_PARTICIPANTS = /^\W*(?:participants?|pr[ée]sents?|invit[ée]s?|attendees?|with|avec|personnes?\s+pr[ée]sentes?)\s*[:–—-]\s*(.+)$/i;
/** Ligne « Durée : 45 min », « 1 h 30 », « 45 minutes ». */
const DUREE = /(\d{1,2})\s*(?:h|heures?|hours?)\s*(\d{1,2})?|\b(\d{1,3})\s*(?:min(?:utes?)?|mn)\b/i;

/** Un jour dans un texte, dans les formes qu'écrivent les gens et les outils. Rend '' si rien de sûr. */
export function dateDuTexte(ligne, aujourdhui = new Date()) {
  const t = sansAccent(ligne);
  // 2026-11-17
  const i = /(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (i) return iso(Number(i[1]), Number(i[2]), Number(i[3]));
  // 17 novembre 2026 · 17 nov. 2026 · 17 novembre (année courante)
  const fr = /\b(\d{1,2})(?:er)?\s+([a-z]{3,10})\.?\s*(\d{4})?/.exec(t);
  if (fr && MOIS[fr[2] ?? '']) return iso(Number(fr[3] ?? aujourdhui.getFullYear()), MOIS[fr[2] ?? ''] ?? 0, Number(fr[1]));
  // November 17, 2026
  const en = /\b([a-z]{3,10})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?/.exec(t);
  if (en && MOIS[en[1] ?? '']) return iso(Number(en[3] ?? aujourdhui.getFullYear()), MOIS[en[1] ?? ''] ?? 0, Number(en[2]));
  // 17/11/2026 et 17.11.26 (jour d'abord : on écrit en français)
  const num = /\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/.exec(t);
  if (num) {
    const a = Number(num[3]);
    return iso(a < 100 ? 2000 + a : a, Number(num[2]), Number(num[1]));
  }
  return '';
}

/** L'heure de début dans une ligne : « 14:00 », « 14 h 30 », « 2:00 PM ». Rend '' si rien de sûr. */
export function heureDuTexte(ligne) {
  const ampm = /\b(\d{1,2})\s*[:h.]?\s*(\d{2})?\s*(am|pm)\b/i.exec(ligne);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (/pm/i.test(ampm[3] ?? '')) h += 12;
    return `${deux(h)}:${deux(Number(ampm[2] ?? 0))}`;
  }
  const m = /\b([01]?\d|2[0-3])\s*[:h]\s*([0-5]\d)\b/.exec(ligne);
  return m ? `${deux(Number(m[1]))}:${m[2]}` : '';
}

/** Les noms d'une ligne de participants : séparés par des virgules, des points médians, « et », « and », « & ». */
export function noms(liste) {
  return liste
    .split(/\s*(?:,|;|·|•|\||\/|&|\bet\b|\band\b)\s*/i)
    .map((x) => x.replace(/\([^)]*\)/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim())
    .map((x) => x.replace(/^[-–—*•]\s*/, '').replace(/[.:;]+$/, ''))
    .filter((x) => x.length >= 2 && x.length <= 60 && /\p{L}/u.test(x) && !/^(h|min|minutes?)$/i.test(x))
    .filter((x, i, l) => l.indexOf(x) === i)
    .slice(0, 30);
}

/** Durée en minutes écrite dans une ligne (« 45 min », « 1 h 30 ») ; 0 si rien. */
export function dureeDuTexte(ligne) {
  const m = DUREE.exec(ligne);
  if (!m) return 0;
  if (m[1]) return Number(m[1]) * 60 + Number(m[2] ?? 0);
  const n = Number(m[3] ?? 0);
  return n > 0 && n <= 600 ? n : 0;
}

const MAX_TEXTE = 20_000;
const MAX_ACTIONS = 30;

/**
 * Lit un compte rendu collé. Ne rend jamais d'erreur : un texte qu'il ne comprend pas reste un compte rendu, avec
 * son titre et rien d'autre — ce qui est déjà le cas des notes écrites à la main.
 */
export function lireCompteRendu(brut, aujourdhui = new Date()) {
  const texte = String(brut ?? '').replace(/\r\n|\r/g, '\n').replace(/[  ]/g, ' ').slice(0, MAX_TEXTE).trim();
  const lignes = texte.split('\n').map((l) => l.replace(/\s+$/, ''));
  const vide = { titre: '', date: '', heure: '', minutes: 0, participants: [], actions: [], texte };
  if (!texte) return vide;

  // ---- participants : la ligne qui les annonce, où qu'elle soit
  let participants = [];
  for (const l of lignes) {
    const m = LIGNE_PARTICIPANTS.exec(l.trim());
    if (m) { participants = noms(m[1] ?? ''); break; }
  }

  // ---- date, heure et durée : la première ligne qui en porte une, en tête du document
  let date = '';
  let heure = '';
  let minutes = 0;
  for (const l of lignes.slice(0, 12)) {
    if (LIGNE_PARTICIPANTS.test(l.trim())) continue;
    if (!date) date = dateDuTexte(l, aujourdhui);
    if (!heure) heure = heureDuTexte(l);
    if (!minutes) minutes = dureeDuTexte(l);
    if (date && heure && minutes) break;
  }

  // ---- titre : la première ligne utile, sans la date qu'on lui accroche
  let titre = '';
  for (const l of lignes) {
    const n = l.trim().replace(/^#+\s*/, '');
    if (!n || LIGNE_PARTICIPANTS.test(n) || TITRES_ACTIONS.test(n)) continue;
    if (dateDuTexte(n, aujourdhui) && n.length <= 40) continue; // une ligne qui n'est QUE la date
    titre = n.replace(/\s*[-–—|·]\s*\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\s*$/, '').replace(/\s+/g, ' ').slice(0, 120).trim();
    break;
  }

  // ---- actions : les puces de la section « Prochaines étapes », jusqu'à l'intertitre suivant
  const actions = [];
  let dedans = false;
  for (const l of lignes) {
    const n = l.trim();
    if (TITRES_ACTIONS.test(n)) { dedans = true; continue; }
    if (!dedans) continue;
    if (!n) continue;
    if (!PUCE.test(l) && AUTRE_TITRE.test(n)) { dedans = false; continue; }
    if (!PUCE.test(l)) continue;
    // « - [ ] Rappeler » porte deux marqueurs : le tiret de la liste et la case à cocher
    const action = n.replace(PUCE, '').replace(PUCE, '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (action && !actions.includes(action)) actions.push(action);
    if (actions.length >= MAX_ACTIONS) break;
  }

  return { titre, date, heure, minutes, participants, actions, texte };
}

/**
 * La fiche que ce compte rendu devient : un rendez-vous, avec sa date et son texte. Le client n'est pas deviné ici —
 * l'écran le propose et la personne confirme, parce qu'une fiche rattachée au mauvais client est pire qu'une fiche
 * non rattachée.
 */
export function rendezVousDuCompteRendu(cr, aujourdhui = new Date()) {
  const jour = cr.date || `${aujourdhui.getFullYear()}-${deux(aujourdhui.getMonth() + 1)}-${deux(aujourdhui.getDate())}`;
  const debut = cr.heure ? `${jour}T${cr.heure}` : jour;
  const champs = { debut, compte_rendu: cr.texte, etat: 'confirmé' };
  if (cr.heure && cr.minutes > 0) {
    const t = Date.parse(`${jour}T${cr.heure}:00`);
    if (Number.isFinite(t)) {
      const f = new Date(t + cr.minutes * 60_000);
      champs.fin = `${f.getFullYear()}-${deux(f.getMonth() + 1)}-${deux(f.getDate())}T${deux(f.getHours())}:${deux(f.getMinutes())}`;
    }
  }
  if (cr.actions.length) champs.suite = cr.actions.join(' · ').slice(0, 500);
  return { nom: cr.titre || 'Rendez-vous', champs };
}

/**
 * Le client le plus probable parmi ceux qu'on connaît : son nom est cité dans le titre, ou il porte le nom d'un
 * participant. Rend `null` dès qu'il y a un doute — deux candidats valent zéro candidat.
 */
export function clientProbable(cr, clients) {
  const foin = sansAccent(`${cr.titre} ${cr.participants.join(' ')}`);
  const vus = (clients ?? []).filter((c) => {
    const n = sansAccent(c.nom).replace(/\b(sarl|sas|sasu|eurl|sa|scop|sci|ets|cie)\b/g, '').replace(/\s+/g, ' ').trim();
    return n.length >= 3 && foin.includes(n);
  });
  return vus.length === 1 ? vus[0] ?? null : null;
}
