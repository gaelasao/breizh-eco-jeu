/**
 * Historique du score de santé (direction de design §6.1 P6 : « tendance sur 90 jours »).
 * - Un point par jour au plus : le score de l'entreprise entière (pas celui d'un périmètre), relevé quand on le calcule.
 * - Un jour sans relevé n'a pas de point (jamais 0) : la courbe montre un trou.
 * - Les données d'exemple ne sont jamais relevées. Pour l'entreprise exemple, une série d'exemple (marquée comme telle)
 *   est produite à la lecture, pour qu'on voie à quoi ressemble la tendance : elle n'est jamais enregistrée.
 */

export interface PointSante {
  /** Jour local du relevé (AAAA-MM-JJ). */
  jour: string;
  /** Score 0–100, null si pas assez de données ce jour-là. */
  score: number | null;
  /** Part des critères (pondérés) mesurés, 0–1. */
  couverture: number;
}

export interface SerieSante {
  /** Du plus ancien au plus récent, un jour sur deux ou plus peut manquer. */
  points: PointSante[];
  jours: number;
  exemple: boolean;
}

export const JOURS_TENDANCE = 90;
export const POINTS_MAX = 400;
const JOUR = 86_400_000;
const estJour = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** Relit un historique enregistré : points valides seulement, triés, un par jour, POINTS_MAX au plus. */
export function lireHistorique(x: unknown): PointSante[] {
  if (!Array.isArray(x)) return [];
  const parJour = new Map<string, PointSante>();
  for (const p of x) {
    if (!p || typeof p !== 'object') continue;
    const { jour, score, couverture } = p as Record<string, unknown>;
    if (!estJour(jour)) continue;
    const s = typeof score === 'number' && Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : null;
    const c = typeof couverture === 'number' && Number.isFinite(couverture) ? Math.max(0, Math.min(1, couverture)) : 0;
    parJour.set(jour, { jour, score: s, couverture: c });
  }
  return [...parJour.values()].sort((a, b) => a.jour.localeCompare(b.jour)).slice(-POINTS_MAX);
}

/** Ajoute ou remplace le relevé du jour (le dernier calcul de la journée l'emporte). Renvoie true si l'historique change. */
export function noter(h: PointSante[], p: PointSante): boolean {
  const dernier = h.at(-1);
  if (dernier && dernier.jour === p.jour) {
    if (dernier.score === p.score && Math.abs(dernier.couverture - p.couverture) < 1e-9) return false;
    h[h.length - 1] = { ...p };
    return true;
  }
  if (dernier && dernier.jour > p.jour) return false; // horloge revenue en arrière : on ne réécrit pas le passé
  h.push({ ...p });
  if (h.length > POINTS_MAX) h.splice(0, h.length - POINTS_MAX);
  return true;
}

/** Les points des `jours` derniers jours (aujourd'hui compris). */
export function derniersJours(h: readonly PointSante[], aujourdhui: string, jours = JOURS_TENDANCE): PointSante[] {
  const debut = iso(Date.parse(`${aujourdhui}T00:00:00Z`) - (jours - 1) * JOUR);
  return h.filter((p) => p.jour >= debut && p.jour <= aujourdhui);
}

/**
 * Série d'exemple déterministe (entreprise exemple seulement) : 90 jours qui finissent sur le score du jour, avec
 * quelques jours sans relevé. Toujours renvoyée avec `exemple: true`.
 */
export function serieExemple(aujourdhui: string, score: number | null, couverture: number, jours = JOURS_TENDANCE): PointSante[] {
  if (score === null) return [];
  const fin = Date.parse(`${aujourdhui}T00:00:00Z`);
  const depart = Math.max(0, Math.min(100, score - 9));
  const points: PointSante[] = [];
  for (let i = jours - 1; i >= 0; i--) {
    if (i === 40 || i === 41 || i === 63) continue; // jours sans relevé : pas de point (jamais 0)
    const t = (jours - 1 - i) / (jours - 1);
    const vague = Math.round(3 * Math.sin((jours - i) / 6) + 2 * Math.sin((jours - i) / 2.3));
    const s = i === 0 ? score : Math.max(0, Math.min(100, Math.round(depart + (score - depart) * t + vague * (1 - t * 0.6))));
    points.push({ jour: iso(fin - i * JOUR), score: s, couverture: Math.max(0, Math.min(1, couverture - 0.15 * (1 - t))) });
  }
  return points;
}
