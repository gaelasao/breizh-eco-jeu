/* Living Business — qualité du rendu et budgets de la carte 3D (direction de design §5.8, §5.10).
   Module PUR (aucun accès au DOM ni à three.js) : testé par src/ds/carte.test.ts. */

export const QUALITES = Object.freeze({ haute: 'Haute', standard: 'Standard', economie: 'Économie' });

/** Budget du §5.10 par profil (ordinateur, téléphone milieu de gamme, qualité Économie). */
export const BUDGETS = Object.freeze({
  ordinateur: Object.freeze({ images: 60, msParImage: 16, appels: 150, triangles: 300000, texturesMo: 48, ombres: 2048, densite: 2 }),
  telephone: Object.freeze({ images: 30, msParImage: 33, appels: 100, triangles: 120000, texturesMo: 24, ombres: 1024, densite: 1.5 }),
  economie: Object.freeze({ images: 30, msParImage: 33, appels: 60, triangles: 60000, texturesMo: 16, ombres: 0, densite: 1 }),
});

/** Cadence (§5.8) : pleine vitesse pendant l'interaction, 20 images/s pour l'ambiance après 30 s, pause après 2 min. */
export const CADENCE = Object.freeze({ ambiance: 20, ambianceApresMs: 30000, pauseApresMs: 120000 });

/** Profil de rendu d'une qualité. */
export function profil(qualite, { telephone = false } = {}) {
  const b = qualite === 'economie' ? BUDGETS.economie : telephone ? BUDGETS.telephone : BUDGETS.ordinateur;
  return {
    qualite,
    ombres: qualite === 'economie' ? 0 : telephone ? BUDGETS.telephone.ombres : BUDGETS.ordinateur.ombres,
    densiteMax: b.densite,
    gtao: qualite === 'haute' && !telephone,
    materiauPbr: qualite === 'haute',
    accessoires: qualite !== 'economie',
    images: qualite === 'economie' ? 30 : telephone ? 30 : 60,
    budget: b,
  };
}

/**
 * Qualité de départ. reglage : 'auto' (défaut) ou une qualité forcée dans Réglages › Carte.
 * Auto : téléphone → Standard (Économie sous 4 Go de mémoire) ; ordinateur → Haute avec 8 cœurs et 8 Go au moins,
 * Économie sous 4 cœurs ou 4 Go, Standard sinon. navigator.deviceMemory est absent sur Safari et Firefox.
 */
export function qualiteInitiale({ reglage = 'auto', telephone = false, memoire, coeurs } = {}) {
  if (reglage in QUALITES) return reglage;
  if (telephone) return typeof memoire === 'number' && memoire < 4 ? 'economie' : 'standard';
  if ((typeof memoire === 'number' && memoire < 4) || (typeof coeurs === 'number' && coeurs < 4)) return 'economie';
  if ((memoire ?? 8) >= 8 && (coeurs ?? 8) >= 8) return 'haute';
  return 'standard';
}

export const palierInferieur = (q) => (q === 'haute' ? 'standard' : 'economie');

/**
 * Surveillance du temps par image : pendant les 2 premières secondes, une moyenne au-delà du budget fait descendre
 * d'un palier ; ensuite, plus de 40 ms par image pendant 3 s font descendre d'un palier.
 * noter(ms, maintenant) → true quand il faut descendre (une seule fois par alerte).
 */
export function surveillance({ budgetMs = 16, debut = 0 } = {}) {
  let echantillons = [];
  let lentDepuis = null;
  let premierBilan = false;
  return {
    noter(ms, maintenant) {
      if (!premierBilan) {
        echantillons.push(ms);
        if (maintenant - debut >= 2000) {
          premierBilan = true;
          const moyenne = echantillons.reduce((a, b) => a + b, 0) / Math.max(1, echantillons.length);
          echantillons = [];
          if (moyenne > budgetMs * 1.6) return true;
        }
        return false;
      }
      if (ms > 40) {
        lentDepuis ??= maintenant;
        if (maintenant - lentDepuis >= 3000) { lentDepuis = null; return true; }
      } else lentDepuis = null;
      return false;
    },
  };
}

/** Réseau faible (§5.10) : jamais les modèles 3D sur des données mobiles faibles. */
export function reseauFaible(connexion) {
  if (!connexion) return false;
  if (connexion.saveData) return true;
  return ['slow-2g', '2g', '3g'].includes(String(connexion.effectiveType ?? ''));
}
