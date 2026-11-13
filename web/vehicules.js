/* Living Business — suivi du matériel roulant (direction de design §4.18, §4.20, §6.1 P7).
   Module PUR : aucun accès au DOM ni au stockage, testé par src/ds/vehicules.test.ts. Il décide QUOI montrer ;
   web/app.js dessine. Tout le calcul (dates, compteurs, historique) est fait par la passerelle et arrive déjà
   prêt dans `objet.vehicule` : ici, on ne fait que trier, nommer et mettre en mots.

   Deux sortes de matériel, suivies de la même façon : les VÉHICULES, comptés en kilomètres, et les ENGINS de
   chantier, comptés en heures de service. L'unité vient de la passerelle (`vehicule.unite`), elle ne se devine pas.

   Deux écrans : la liste (« vehicules ») et la fiche de suivi d'un matériel (« vehicule:<id> »).
   La rubrique n'apparaît que si l'entreprise a au moins un matériel — la règle est dans web/simplicite.js. */
import { euros, INSECABLE, nombre, pluriel } from './bz/typo.js';
import { sansDemo } from './navigation.js';

/** Un matériel suivi, tel que /api/v1/monde le rend : la passerelle a déjà posé son suivi dessus. */
export const estMaterielSuivi = (o) => Boolean(o && o.famille === 'ressource' && o.vehicule);
export const materielsDe = (m) => (m?.objets ?? []).filter(estMaterielSuivi);

const valeurDe = (o, id) => o?.champs?.find((c) => c.id === id)?.valeur ?? null;
const lienDe = (o, id) => o?.champs?.find((c) => c.id === id)?.lien ?? null;

/** Tons repris de « Aujourd'hui » : le même mot, la même couleur, partout. */
export const TON_STATUT = Object.freeze({ depassee: 'critique', aujourdhui: 'critique', bientot: 'attention', ok: 'ok', absente: null });
export const ICONE_STATUT = Object.freeze({ depassee: 'octagon-alert', aujourdhui: 'octagon-alert', bientot: 'triangle-alert', ok: 'circle-check', absente: 'circle-dashed' });
const RANG_STATUT = { depassee: 0, aujourdhui: 1, bientot: 2, ok: 3, absente: 4 };

/** Le plus pressant des matériels ou des échéances d'abord ; à égalité, l'ordre reçu. */
export const trierParUrgence = (liste, statutDe) => liste.map((x, i) => ({ x, i })).sort((a, b) => (RANG_STATUT[statutDe(a.x)] ?? 9) - (RANG_STATUT[statutDe(b.x)] ?? 9) || a.i - b.i).map((e) => e.x);

const jourCourt = (iso) => {
  const [a, m, j] = String(iso ?? '').slice(0, 10).split('-').map(Number);
  if (!a || !m || !j) return null;
  const d = new Date(a, m - 1, j);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
};
export const dateCourte = (iso) => jourCourt(iso) ?? '—';

/** Un relevé de compteur écrit : « 128 400 km » pour un véhicule, « 1 180 h » pour un engin ; « — » s'il manque. */
export const compteurEcrit = (n, unite) => (typeof n === 'number' && Number.isFinite(n) ? `${nombre(n)}${INSECABLE}${unite === 'h' ? 'h' : 'km'}` : '—');

/** Le mot juste pour une liste de matériels : « véhicule », « engin », ou « matériel » quand les deux se mélangent. */
export function motMateriel(sortes) {
  const s = new Set(sortes);
  if (s.size === 1 && s.has('engin')) return ['engin', 'engins'];
  if (s.size === 1 && s.has('vehicule')) return ['véhicule', 'véhicules'];
  return ['matériel', 'matériels'];
}

/**
 * Ce qu'on lit sous une échéance : le délai, en jours et au compteur, dans l'ordre du plus pressant.
 * Jamais un chiffre tout seul, et jamais un adjectif accordé : l'intitulé qui précède peut être masculin
 * (« Contrôle technique ») comme féminin (« Révision »), ou porter le nom que l'entreprise a choisi.
 */
export function delaiEcheance(e, unite = 'km') {
  const bouts = [];
  if (e.joursRestants !== null) {
    bouts.push(e.joursRestants < 0 ? `en retard de ${pluriel(-e.joursRestants, 'jour', 'jours')}`
      : e.joursRestants === 0 ? 'aujourd’hui'
      : e.joursRestants === 1 ? 'demain'
      : `dans ${pluriel(e.joursRestants, 'jour', 'jours')}`);
  }
  if (e.compteurRestant !== null && e.compteurRestant !== undefined) {
    bouts.push(e.compteurRestant <= 0 ? `compteur dépassé de ${compteurEcrit(-e.compteurRestant, unite)}` : `dans ${compteurEcrit(e.compteurRestant, unite)}`);
  } else if (e.compteur !== null && e.compteur !== undefined) bouts.push(`à ${compteurEcrit(e.compteur, unite)}`);
  return bouts.join(' · ');
}

/** La répétition, en clair : « Tous les 12 mois ou 20 000 km. » ; rien tant que l'entreprise n'a rien dit. */
export function texteRepetition(e, unite = 'km') {
  const bouts = [];
  if (e.periodeMois !== null) bouts.push(pluriel(e.periodeMois, 'mois', 'mois'));
  if (e.periodeCompteur !== null && e.periodeCompteur !== undefined) bouts.push(compteurEcrit(e.periodeCompteur, unite));
  if (!bouts.length) return '';
  return `Tous les ${bouts.join(' ou ')}.`;
}

/** Ce que « C'est fait » programmera : dit avant de cliquer, jamais après. */
export function texteSuivante(e, unite = 'km') {
  const bouts = [];
  if (e.suivante?.date) bouts.push(`le ${dateCourte(e.suivante.date)}`);
  if (e.suivante?.compteur !== null && e.suivante?.compteur !== undefined) bouts.push(`à ${compteurEcrit(e.suivante.compteur, unite)}`);
  if (!bouts.length) return 'La suivante sera à programmer à la main.';
  const indicatif = e.periodeMois === null && (e.periodeCompteur === null || e.periodeCompteur === undefined) ? ' (durée proposée, à vérifier pour ce matériel)' : '';
  return `La suivante sera programmée ${bouts.join(' et ')}${indicatif}.`;
}

/**
 * Ce qu'on lit sur la ligne du compteur : « 128 400 km, dernier relevé il y a 10 jours ». Tourné avec des noms,
 * jamais avec un participe accordé : l'intitulé est masculin (« Kilométrage ») ou féminin pluriel (« Heures de
 * service ») selon la sorte de matériel.
 */
export function texteCompteur(c) {
  const titre = c?.libelle ?? 'Compteur';
  if (!c || c.valeur === null) return `${titre} : aucun relevé.`;
  const quand = c.jours === null ? 'à une date inconnue' : c.jours <= 0 ? 'aujourd’hui' : c.jours === 1 ? 'hier' : `il y a ${pluriel(c.jours, 'jour', 'jours')}`;
  return `${compteurEcrit(c.valeur, c.unite)}, dernier relevé ${quand}.`;
}

/** Vrai quand il faut redemander le compteur : une échéance en dépend et il est trop vieux. */
export const compteurARelever = (v) => Boolean(v?.vehicule?.compteur?.perime && v.vehicule.echeances.some((e) => e.compteur !== null));

/** Identité d'un matériel en une ligne : « Camionnette · DEMO-001 · Atelier · Nolwenn ». */
export function identite(v, m) {
  const genre = valeurDe(v, 'genre');
  const lieu = lienDe(v, 'lieu') ?? (v.lieu ? (m?.objets ?? []).find((o) => o.id === v.lieu) : null);
  return [
    genre ? `${genre.charAt(0).toLocaleUpperCase('fr-FR')}${genre.slice(1)}` : null,
    v.vehicule?.identifiant ?? null,
    lieu ? sansDemo(lieu.nom) : null,
    lienDe(v, 'departement') ? sansDemo(lienDe(v, 'departement').nom) : null,
    lienDe(v, 'conducteur') ? sansDemo(lienDe(v, 'conducteur').nom) : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Résumé d'un matériel pour la liste : son état le plus pressant, ce qui vient, et le compteur.
 * → { id, nom, identite, sorte, unite, statut, ton, echeance (la plus pressante, ou null), aRegler, compteur }
 */
export function resume(v, m) {
  const suivi = v.vehicule;
  const vivantes = (suivi?.echeances ?? []).filter((e) => e.statut !== 'absente');
  const triees = trierParUrgence(vivantes, (e) => e.statut);
  const premiere = triees[0] ?? null;
  const statut = premiere?.statut ?? 'absente';
  return {
    id: v.id,
    nom: sansDemo(v.nom),
    identite: identite(v, m),
    sorte: suivi?.sorte ?? 'vehicule',
    unite: suivi?.unite ?? 'km',
    statut,
    ton: TON_STATUT[statut],
    echeance: premiere,
    aRegler: triees.filter((e) => e.statut === 'depassee' || e.statut === 'aujourdhui' || e.statut === 'bientot').length,
    compteur: suivi?.compteur ?? null,
    aRelever: compteurARelever(v),
  };
}

/** La liste entière, le plus pressant d'abord, avec de quoi écrire l'en-tête. */
export function planListe(m, { filtre = () => true } = {}) {
  const materiels = materielsDe(m).filter(filtre);
  const lignes = trierParUrgence(materiels.map((v) => resume(v, m)), (r) => r.statut);
  const aRegler = lignes.reduce((n, r) => n + r.aRegler, 0);
  const aRelever = lignes.filter((r) => r.aRelever).length;
  const [un, plusieurs] = motMateriel(lignes.map((r) => r.sorte));
  return {
    lignes,
    total: materiels.length,
    aRegler,
    aRelever,
    mot: [un, plusieurs],
    resume: materiels.length === 0 ? 'Aucun véhicule pour le moment.'
      : aRegler === 0 ? `${pluriel(materiels.length, un, plusieurs)}, rien à prévoir pour l’instant.`
      : `${pluriel(materiels.length, un, plusieurs)}, ${pluriel(aRegler, 'échéance à prévoir', 'échéances à prévoir')}.`,
  };
}

/**
 * La fiche de suivi : les échéances vivantes d'abord (le plus pressant en haut), puis celles qui restent à
 * renseigner, repliées. L'historique arrive tel que la passerelle l'a trié, avec le total de l'année.
 */
export function planFiche(v, m) {
  const suivi = v?.vehicule;
  if (!suivi) return null;
  const vivantes = trierParUrgence(suivi.echeances.filter((e) => e.statut !== 'absente'), (e) => e.statut);
  return {
    id: v.id,
    nom: sansDemo(v.nom),
    identite: identite(v, m),
    sorte: suivi.sorte,
    unite: suivi.unite,
    compteur: suivi.compteur,
    texteCompteur: texteCompteur(suivi.compteur),
    aRelever: compteurARelever(v),
    echeances: vivantes,
    aRemplir: suivi.echeances.filter((e) => e.statut === 'absente'),
    historique: suivi.historique.map((l) => ({ ...l, libelle: sansDemo(l.libelle) })),
    annee: suivi.annee,
    totalAnnee: suivi.totalAnnee,
    // le total au centime près : c'est de l'argent dépensé, il ne s'arrondit pas
    texteTotal: suivi.totalAnnee === null
      ? `Aucun coût saisi en ${suivi.annee}.`
      : `${euros(suivi.totalAnnee)} en ${suivi.annee}, sur ${pluriel(suivi.historique.filter((l) => l.cout !== null && String(l.faitLe ?? '').startsWith(`${suivi.annee}-`)).length, 'ligne', 'lignes')}.`,
  };
}

/** Ce qu'on envoie pour ajouter un matériel : un nom, un type, et c'est tout. */
export function nouveauMateriel(nom, genre, typeId = 'vehicule') {
  const propre = String(nom ?? '').trim().slice(0, 200);
  if (!propre) return { ok: false, erreur: 'Donnez un nom ou un surnom à ce matériel.' };
  const champs = genre ? { genre: String(genre) } : {};
  return { ok: true, valeur: { type: typeId, nom: propre, champs } };
}

/** Ce qu'on envoie pour un « C'est fait » : la date du jour, le compteur connu, le coût s'il est saisi. */
export function faitPour(e, { date, compteur, cout, note } = {}) {
  if (!e?.id) return { ok: false, erreur: 'Échéance inconnue.' };
  const lire = (x, nom) => {
    if (x === undefined || x === null || String(x).trim() === '') return null;
    const n = Number(String(x).replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : { erreur: nom };
  };
  const k = lire(compteur, 'Indiquez un relevé de compteur valide, ou laissez vide.');
  const c = lire(cout, 'Indiquez un coût valide, ou laissez vide.');
  for (const x of [k, c]) if (x && typeof x === 'object') return { ok: false, erreur: x.erreur };
  return {
    ok: true,
    valeur: { echeance: e.id, date: date || null, compteur: k, cout: c, note: String(note ?? '').trim().slice(0, 200) || null },
  };
}
