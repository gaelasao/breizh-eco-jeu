/**
 * Saisie sur le terrain — fonctions pures partagées par la passerelle et l'écran.
 *
 * Deux gestes d'une personne qui a les mains sales et trois minutes : une note tapée ou dictée qui devient une tâche,
 * et « faire une tâche de ce rendez-vous », en un clic. Rien n'est inventé : une note vide n'est pas une tâche, un
 * rendez-vous sans date lisible donne une tâche sans échéance.
 */
import type { ObjetMetier } from './model.ts';

/** Longueur d'un intitulé de tâche (la même que `tache.creer` dans la passerelle). */
export const TITRE_MAX = 200;

/**
 * Intitulé d'une note tapée ou dictée : une seule ligne, espaces resserrés, première lettre en majuscule (la dictée
 * du navigateur rend souvent « poser les plinthes salle de bain » sans majuscule). Vide si la note ne dit rien.
 */
export function titreDeNote(texte: unknown): string {
  const t = (typeof texte === 'string' ? texte : '')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TITRE_MAX);
  return t ? t[0]!.toLocaleUpperCase('fr-FR') + t.slice(1) : '';
}

/** Jour d'une date écrite par le jeu (« 2026-11-20T09:00 » ou « 2026-11-20 ») ; vide si elle est illisible. */
export function jourDeDate(valeur: unknown): string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(typeof valeur === 'string' ? valeur.trim() : '');
  return m ? m[1]! : '';
}

/**
 * Ce que devient un rendez-vous quand on en fait une tâche : son intitulé, et son jour en échéance. L'heure ne suit
 * pas (une échéance de tâche n'a pas d'heure, ni ici ni chez Google ni chez Microsoft).
 */
export function tacheDeRendezVous(o: Pick<ObjetMetier, 'nom' | 'champs'>): { titre: string; echeance: string | null } {
  const titre = titreDeNote(o.nom) || 'Rendez-vous';
  const jour = jourDeDate(o.champs.debut);
  return { titre, echeance: jour || null };
}

/**
 * La tâche déjà faite depuis ce rendez-vous, s'il y en a une : celle qui lui est rattachée (`concerne`). Recliquer
 * « En faire une tâche » retombe donc sur elle au lieu d'en créer une deuxième — un artisan a quarante rendez-vous
 * par semaine, et quarante tâches de plus rendraient l'écran inutilisable.
 */
export function tacheDejaFaite(taches: readonly ObjetMetier[], rendezVousId: string): ObjetMetier | null {
  return taches.find((t) => t.famille === 'tache' && t.champs.concerne === rendezVousId) ?? null;
}
