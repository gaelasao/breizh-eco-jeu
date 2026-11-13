/* Living Business — planning des équipes (direction de design §6.1 P7, §4.30, §4.31).
   Module PUR (aucun accès au DOM, au réseau ni au stockage), testé par src/ds/planning.test.ts. Il décide :
   - les jours affichés (du lundi au vendredi, samedi compris, ou 7 jours) ;
   - la vue « Aujourd'hui » par lieu (cartes avec avatars) et la vue par personne (téléphone) ;
   - la sélection de cases (rectangle depuis une ancre : Maj + clic, Maj + flèches, glisser pour remplir) ;
   - l'application optimiste d'un lot de changements, et le lot inverse qui l'annule. */
import { sansDemo } from './navigation.js';

export const JOURS_POSSIBLES = Object.freeze([
  { n: 5, libelle: 'Lun. – ven.' },
  { n: 6, libelle: 'Lun. – sam.' },
  { n: 7, libelle: '7 jours' },
]);
export const nbJoursValide = (n) => (JOURS_POSSIBLES.some((j) => j.n === Number(n)) ? Number(n) : 5);

const COURT = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', timeZone: 'UTC' });
const LONG = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const MOIS = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const date = (iso) => new Date(`${iso}T00:00:00Z`);
/** « lun. 9 » (en-tête de colonne), « lundi 9 novembre » (lecteur d'écran), « 9 nov. » (période). */
export const jourCourt = (iso) => COURT.format(date(iso));
export const jourLong = (iso) => LONG.format(date(iso));
export const jourMois = (iso) => MOIS.format(date(iso));
export const estWeekEnd = (iso) => [0, 6].includes(date(iso).getUTCDay());

/** Numéro de semaine ISO 8601. */
export function semaineIso(iso) {
  const d = date(iso);
  const jeudi = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86_400_000);
  const premier = new Date(Date.UTC(jeudi.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((jeudi - premier) / 86_400_000 - 3 + ((premier.getUTCDay() + 6) % 7)) / 7);
}
/** Lundi de la semaine précédente ou suivante (pas : −1 ou +1). */
export function decalerSemaine(debut, pas) {
  const d = date(debut);
  d.setUTCDate(d.getUTCDate() + 7 * pas);
  return d.toISOString().slice(0, 10);
}

export const typeCase = (v) => (v ? String(v).split(':')[0] : 'vide');
export function libelleCase(P, v) {
  if (!v) return 'Non affecté';
  return P.options?.find((o) => o.valeur === v)?.libelle ?? String(v).split(':')[1] ?? v;
}
/** Groupes d'options du choix d'une case, dans l'ordre du menu. */
export const GROUPES_OPTIONS = Object.freeze(['Lieux', 'Projets', 'Missions', 'Absences', 'Autre']);
export function optionsGroupees(P) {
  return GROUPES_OPTIONS.map((g) => ({ groupe: g, options: (P.options ?? []).filter((o) => o.groupe === g) })).filter((g) => g.options.length);
}

/**
 * « Aujourd'hui » par lieu : une carte par lieu ou projet occupé (personnes, besoin, sous-effectif), puis les absents,
 * en mission ou non affectés. jour : la date montrée (aujourd'hui si elle est dans la semaine, sinon le premier jour).
 */
export function parLieu(P, jour = P.jours?.includes(P.aujourdhui) ? P.aujourdhui : P.jours?.[0]) {
  const cartes = new Map();
  const hors = [];
  for (const c of P.cibles ?? []) cartes.set(c.valeur, { ...c, personnes: [] });
  for (const l of P.lignes ?? []) {
    const v = l.cases?.[jour] ?? '';
    const t = typeCase(v);
    if ((t === 'lieu' || t === 'projet') && cartes.has(v)) cartes.get(v).personnes.push(l);
    else hors.push({ ligne: l, valeur: v, libelle: libelleCase(P, v), type: t });
  }
  const lieux = [...cartes.values()].filter((c) => c.personnes.length || (c.besoin ?? 0) > 0).map((c) => ({
    ...c, nb: c.personnes.length, sous: typeof c.besoin === 'number' && c.personnes.length < c.besoin,
  })).sort((a, b) => Number(b.sous) - Number(a.sous) || b.nb - a.nb || a.libelle.localeCompare(b.libelle, 'fr'));
  return { jour, lieux, hors };
}

/** Vue par personne (téléphone) : chaque personne et ses jours, groupée comme la grille. */
export function parPersonne(P) {
  const groupes = [];
  for (const l of P.lignes ?? []) {
    let g = groupes.find((x) => x.groupe === l.groupe);
    if (!g) { g = { groupe: l.groupe, personnes: [] }; groupes.push(g); }
    g.personnes.push({ ...l, jours: (P.jours ?? []).map((j) => ({ jour: j, valeur: l.cases?.[j] ?? '', libelle: libelleCase(P, l.cases?.[j] ?? ''), type: typeCase(l.cases?.[j] ?? '') })) });
  }
  return groupes;
}

/**
 * Cases d'un rectangle de sélection entre une ancre et une case (Maj + clic, glisser) : [{ employe, date }].
 * lignes : identifiants des personnes dans l'ordre affiché ; jours : dates dans l'ordre affiché.
 */
export function rectangle(lignes, jours, a, b) {
  const l1 = lignes.indexOf(a.employe); const l2 = lignes.indexOf(b.employe);
  const j1 = jours.indexOf(a.date); const j2 = jours.indexOf(b.date);
  if (l1 < 0 || l2 < 0 || j1 < 0 || j2 < 0) return [];
  const sortie = [];
  for (let l = Math.min(l1, l2); l <= Math.max(l1, l2); l++) for (let j = Math.min(j1, j2); j <= Math.max(j1, j2); j++) sortie.push({ employe: lignes[l], date: jours[j] });
  return sortie;
}
export const cleCase = (c) => `${c.employe}|${c.date}`;

/** Déplacement du focus dans la grille au clavier (flèches, Début, Fin) ; renvoie la case visée ou null. */
export function caseVoisine(lignes, jours, c, touche) {
  const l = lignes.indexOf(c.employe); const j = jours.indexOf(c.date);
  if (l < 0 || j < 0) return null;
  const v = { ArrowUp: [l - 1, j], ArrowDown: [l + 1, j], ArrowLeft: [l, j - 1], ArrowRight: [l, j + 1], Home: [l, 0], End: [l, jours.length - 1] }[touche];
  if (!v) return null;
  const [nl, nj] = v;
  if (nl < 0 || nl >= lignes.length || nj < 0 || nj >= jours.length) return c;
  return { employe: lignes[nl], date: jours[nj] };
}

/** Lot de changements : chaque case sélectionnée prend `valeur` ; les cases déjà à cette valeur sont omises. */
export function lotPour(P, cases, valeur) {
  return cases.filter((c) => (P.lignes?.find((l) => l.id === c.employe)?.cases?.[c.date] ?? '') !== valeur).map((c) => ({ ...c, valeur }));
}
/** Glisser pour remplir : la valeur de l'ancre est recopiée sur les autres cases du rectangle. */
export function lotRemplir(P, ancre, cases) {
  const v = P.lignes?.find((l) => l.id === ancre.employe)?.cases?.[ancre.date] ?? '';
  return lotPour(P, cases.filter((c) => cleCase(c) !== cleCase(ancre)), v);
}

/** Lot qui annule `lot` (valeurs d'avant, lues dans P avant d'appliquer). */
export function lotInverse(P, lot) {
  return lot.map((c) => ({ employe: c.employe, date: c.date, valeur: P.lignes?.find((l) => l.id === c.employe)?.cases?.[c.date] ?? '' }));
}

/** Applique un lot à une copie du planning (interface optimiste) : cases et totaux par lieu ou projet. */
export function appliquer(P, lot) {
  const Q = { ...P, lignes: (P.lignes ?? []).map((l) => ({ ...l, cases: { ...l.cases } })), totaux: Object.fromEntries(Object.entries(P.totaux ?? {}).map(([k, v]) => [k, { ...v }])) };
  for (const c of lot) {
    const l = Q.lignes.find((x) => x.id === c.employe);
    if (!l || !(c.date in l.cases)) continue;
    const avant = l.cases[c.date] ?? '';
    if (avant === c.valeur) continue;
    if (Q.totaux[avant]?.[c.date] !== undefined) Q.totaux[avant][c.date] = Math.max(0, Q.totaux[avant][c.date] - 1);
    if (Q.totaux[c.valeur]?.[c.date] !== undefined) Q.totaux[c.valeur][c.date] += 1;
    l.cases[c.date] = c.valeur;
    l.planifie = true;
  }
  return Q;
}

/** Texte d'un lot pour le toast et Activité récente : « Gwen : atelier, mardi 10 novembre » ou « 4 cases modifiées ». */
export function texteLot(P, lot) {
  if (lot.length === 1) {
    const c = lot[0];
    const nom = sansDemo(P.lignes?.find((l) => l.id === c.employe)?.nom ?? '');
    return `${nom} : ${sansDemo(libelleCase(P, c.valeur))}, ${jourLong(c.date)}`;
  }
  return `${lot.length} cases modifiées`;
}
