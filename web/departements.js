/* Living Business — Départements en tableau kanban (direction de design §6.1 P8, §4.8). Module PUR, testé par
   src/ds/autres-ecrans.test.ts. Une tâche se déplace en glissant sa carte, ou par son menu « Déplacer vers… »
   (jamais le glisser seul, 2.5.7) ; l'enregistrement est optimiste et annulable. */

/** Colonnes, dans l'ordre (valeurs du champ « statut » des tâches). */
export const STATUTS = Object.freeze(['à faire', 'en cours', 'bloquée', 'terminée']);
export const LIBELLE_STATUT = Object.freeze({ 'à faire': 'À faire', 'en cours': 'En cours', bloquée: 'Bloquée', terminée: 'Terminée' });
export const ICONE_STATUT = Object.freeze({ 'à faire': 'circle', 'en cours': 'loader-circle', bloquée: 'octagon-alert', terminée: 'circle-check' });

const val = (o, id) => o.champs?.find((c) => c.id === id)?.valeur ?? null;
export const statutDe = (t) => (STATUTS.includes(val(t, 'statut')) ? val(t, 'statut') : 'à faire');

/** Colonnes du tableau : tâches par statut, les en retard d'abord puis par échéance. */
export function colonnes(taches, enRetard = new Set()) {
  return STATUTS.map((s) => ({
    statut: s,
    libelle: LIBELLE_STATUT[s],
    taches: taches.filter((t) => statutDe(t) === s).sort((a, b) => Number(enRetard.has(b.id)) - Number(enRetard.has(a.id)) || String(val(a, 'echeance') ?? '9999').localeCompare(String(val(b, 'echeance') ?? '9999'))),
  }));
}

/** Destinations du menu « Déplacer vers… » d'une tâche (toutes les colonnes sauf la sienne). */
export const destinations = (t) => STATUTS.filter((s) => s !== statutDe(t)).map((s) => ({ statut: s, libelle: LIBELLE_STATUT[s] }));

/** Colonne voisine au clavier (Alt + flèche gauche ou droite sur une carte) ; null au bord. */
export function voisine(statut, sens) {
  const i = STATUTS.indexOf(statut) + (sens === 'gauche' ? -1 : 1);
  return i >= 0 && i < STATUTS.length ? STATUTS[i] : null;
}

/** Déplacement optimiste : renvoie la liste de tâches avec la nouvelle valeur, sans toucher à l'original. */
export function deplacer(taches, id, statut) {
  return taches.map((t) => (t.id === id ? { ...t, champs: (t.champs ?? []).some((c) => c.id === 'statut') ? t.champs.map((c) => (c.id === 'statut' ? { ...c, valeur: statut } : c)) : [...(t.champs ?? []), { id: 'statut', libelle: 'Statut', type: 'choix', valeur: statut }] } : t));
}

/** Texte du toast : « Tâche déplacée vers En cours. » */
export const texteDeplacement = (statut) => `Tâche déplacée vers ${LIBELLE_STATUT[statut] ?? statut}.`;
