/* Living Business — suivi des véhicules (direction de design §4.18, §4.20, §6.1 P7).
   Module PUR : aucun accès au DOM ni au stockage, testé par src/ds/vehicules.test.ts. Il décide QUOI montrer ;
   web/app.js dessine. Tout le calcul (dates, kilométrages, historique) est fait par la passerelle et arrive déjà
   prêt dans `objet.vehicule` : ici, on ne fait que trier, nommer et mettre en mots.

   Deux écrans : la liste des véhicules (« vehicules ») et la fiche de suivi d'un véhicule (« vehicule:<id> »).
   La rubrique n'apparaît que si l'entreprise a au moins un véhicule — la règle est dans web/simplicite.js. */
import { euros, nombre, pluriel } from './bz/typo.js';
import { sansDemo } from './navigation.js';

/** Un véhicule, tel que /api/v1/monde le rend : la passerelle a déjà posé son suivi dessus. */
export const estVehicule = (o) => Boolean(o && o.famille === 'ressource' && o.vehicule);
export const vehiculesDe = (m) => (m?.objets ?? []).filter(estVehicule);

const valeurDe = (o, id) => o?.champs?.find((c) => c.id === id)?.valeur ?? null;
const lienDe = (o, id) => o?.champs?.find((c) => c.id === id)?.lien ?? null;

/** Tons repris de « Aujourd'hui » : le même mot, la même couleur, partout. */
export const TON_STATUT = Object.freeze({ depassee: 'critique', aujourdhui: 'critique', bientot: 'attention', ok: 'ok', absente: null });
export const ICONE_STATUT = Object.freeze({ depassee: 'octagon-alert', aujourdhui: 'octagon-alert', bientot: 'triangle-alert', ok: 'circle-check', absente: 'circle-dashed' });
const RANG_STATUT = { depassee: 0, aujourdhui: 1, bientot: 2, ok: 3, absente: 4 };

/** Le plus pressant des véhicules ou des échéances d'abord ; à égalité, l'ordre reçu. */
export const trierParUrgence = (liste, statutDe) => liste.map((x, i) => ({ x, i })).sort((a, b) => (RANG_STATUT[statutDe(a.x)] ?? 9) - (RANG_STATUT[statutDe(b.x)] ?? 9) || a.i - b.i).map((e) => e.x);

const jourCourt = (iso) => {
  const [a, m, j] = String(iso ?? '').slice(0, 10).split('-').map(Number);
  if (!a || !m || !j) return null;
  const d = new Date(a, m - 1, j);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
};
export const dateCourte = (iso) => jourCourt(iso) ?? '—';

/** Kilométrage écrit : « 128 400 km », « — » tant qu'il n'a jamais été relevé. */
export const km = (n) => (typeof n === 'number' && Number.isFinite(n) ? `${nombre(n)} km` : '—');

/**
 * Ce qu'on lit sous une échéance : le délai, en jours et en kilomètres, dans l'ordre du plus pressant.
 * Jamais un chiffre tout seul, et jamais un adjectif accordé : l'intitulé qui précède peut être masculin
 * (« Contrôle technique ») comme féminin (« Révision »), ou porter le nom que l'entreprise a choisi.
 */
export function delaiEcheance(e) {
  const bouts = [];
  if (e.joursRestants !== null) {
    bouts.push(e.joursRestants < 0 ? `en retard de ${pluriel(-e.joursRestants, 'jour', 'jours')}`
      : e.joursRestants === 0 ? 'aujourd’hui'
      : e.joursRestants === 1 ? 'demain'
      : `dans ${pluriel(e.joursRestants, 'jour', 'jours')}`);
  }
  if (e.kmRestants !== null) {
    bouts.push(e.kmRestants <= 0 ? `compteur dépassé de ${pluriel(-e.kmRestants, 'km', 'km')}` : `dans ${pluriel(e.kmRestants, 'km', 'km')}`);
  } else if (e.km !== null) bouts.push(`à ${km(e.km)}`);
  return bouts.join(' · ');
}

/** La répétition, en clair : « Tous les 12 mois ou 20 000 km. » ; rien tant que l'entreprise n'a rien dit. */
export function texteRepetition(e) {
  const bouts = [];
  if (e.periodeMois !== null) bouts.push(pluriel(e.periodeMois, 'mois', 'mois'));
  if (e.periodeKm !== null) bouts.push(`${nombre(e.periodeKm)} km`);
  if (!bouts.length) return '';
  return `Tous les ${bouts.join(' ou ')}.`;
}

/** Ce que « C'est fait » programmera : dit avant de cliquer, jamais après. */
export function texteSuivante(e) {
  const bouts = [];
  if (e.suivante?.date) bouts.push(`le ${dateCourte(e.suivante.date)}`);
  if (e.suivante?.km !== null && e.suivante?.km !== undefined) bouts.push(`à ${km(e.suivante.km)}`);
  if (!bouts.length) return 'La suivante sera à programmer à la main.';
  const indicatif = e.periodeMois === null && e.periodeKm === null ? ' (durée proposée, à vérifier pour ce véhicule)' : '';
  return `La suivante sera programmée ${bouts.join(' et ')}${indicatif}.`;
}

/** Ce qu'on lit sur la ligne du compteur : « 128 400 km, relevé il y a 10 jours ». */
export function texteKilometrage(k) {
  if (!k || k.km === null) return 'Kilométrage jamais relevé.';
  const quand = k.jours === null ? 'date inconnue' : k.jours <= 0 ? 'relevé aujourd’hui' : k.jours === 1 ? 'relevé hier' : `relevé il y a ${pluriel(k.jours, 'jour', 'jours')}`;
  return `${km(k.km)}, ${quand}.`;
}

/** Vrai quand il faut redemander le compteur : une échéance en dépend et il est trop vieux. */
export const kilometrageARelever = (v) => Boolean(v?.vehicule?.kilometrage?.perime && v.vehicule.echeances.some((e) => e.km !== null));

/** Identité d'un véhicule en une ligne : « Camionnette · DEMO-001 · Atelier · Nolwenn ». */
export function identite(v, m) {
  const genre = valeurDe(v, 'genre');
  const lieu = lienDe(v, 'lieu') ?? (v.lieu ? (m?.objets ?? []).find((o) => o.id === v.lieu) : null);
  return [
    genre ? `${genre.charAt(0).toLocaleUpperCase('fr-FR')}${genre.slice(1)}` : null,
    valeurDe(v, 'immatriculation'),
    lieu ? sansDemo(lieu.nom) : null,
    lienDe(v, 'departement') ? sansDemo(lienDe(v, 'departement').nom) : null,
    lienDe(v, 'conducteur') ? sansDemo(lienDe(v, 'conducteur').nom) : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Résumé d'un véhicule pour la liste : son état le plus pressant, ce qui vient, et le compteur.
 * → { id, nom, identite, statut, ton, echeance (la plus pressante, ou null), aRegler, kilometrage }
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
    statut,
    ton: TON_STATUT[statut],
    echeance: premiere,
    aRegler: triees.filter((e) => e.statut === 'depassee' || e.statut === 'aujourdhui' || e.statut === 'bientot').length,
    kilometrage: suivi?.kilometrage ?? null,
    aRelever: kilometrageARelever(v),
  };
}

/** La liste entière, le plus pressant d'abord, avec de quoi écrire l'en-tête. */
export function planListe(m, { filtre = () => true } = {}) {
  const vehicules = vehiculesDe(m).filter(filtre);
  const lignes = trierParUrgence(vehicules.map((v) => resume(v, m)), (r) => r.statut);
  const aRegler = lignes.reduce((n, r) => n + r.aRegler, 0);
  const aRelever = lignes.filter((r) => r.aRelever).length;
  return {
    lignes,
    total: vehicules.length,
    aRegler,
    aRelever,
    resume: vehicules.length === 0 ? 'Aucun véhicule pour le moment.'
      : aRegler === 0 ? `${pluriel(vehicules.length, 'véhicule', 'véhicules')}, rien à prévoir pour l’instant.`
      : `${pluriel(vehicules.length, 'véhicule', 'véhicules')}, ${pluriel(aRegler, 'échéance à prévoir', 'échéances à prévoir')}.`,
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
    kilometrage: suivi.kilometrage,
    texteKilometrage: texteKilometrage(suivi.kilometrage),
    aRelever: kilometrageARelever(v),
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

/** Ce qu'on envoie pour ajouter un véhicule : un nom, un type, et c'est tout. */
export function nouveauVehicule(nom, genre, typeId = 'vehicule') {
  const propre = String(nom ?? '').trim().slice(0, 200);
  if (!propre) return { ok: false, erreur: 'Donnez un nom ou un surnom à ce véhicule.' };
  const champs = genre ? { genre: String(genre) } : {};
  return { ok: true, valeur: { type: typeId, nom: propre, champs } };
}

/** Ce qu'on envoie pour un « C'est fait » : la date du jour, le compteur connu, le coût s'il est saisi. */
export function faitPour(e, { date, km: compteur, cout, note } = {}) {
  if (!e?.id) return { ok: false, erreur: 'Échéance inconnue.' };
  const lire = (x, nom) => {
    if (x === undefined || x === null || String(x).trim() === '') return null;
    const n = Number(String(x).replace(',', '.').replace(/\s/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : { erreur: nom };
  };
  const k = lire(compteur, 'Indiquez un kilométrage valide, ou laissez vide.');
  const c = lire(cout, 'Indiquez un coût valide, ou laissez vide.');
  for (const x of [k, c]) if (x && typeof x === 'object') return { ok: false, erreur: x.erreur };
  return {
    ok: true,
    valeur: { echeance: e.id, date: date || null, km: k, cout: c, note: String(note ?? '').trim().slice(0, 200) || null },
  };
}
