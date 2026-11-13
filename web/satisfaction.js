/* Living Business — Satisfaction (direction de design §6.1 P8, §4.22). Module PUR, testé par
   src/ds/autres-ecrans.test.ts. La courbe est la moyenne MENSUELLE des notes reçues (sur 10) : un mois sans réponse
   laisse un trou, jamais 0 ; le résumé en texte et le tableau donnent les mêmes chiffres. */
import { pluriel } from './bz/typo.js';

const NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const MOIS = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Statut d'un client, du plus urgent au plus calme (mécontent d'abord). */
export const RANG_STATUT = Object.freeze({ mauvaise: 0, inconnue: 1, ancienne: 2, moyenne: 3, bonne: 4 });
export const LIBELLE_STATUT = Object.freeze({ mauvaise: 'Mécontent', inconnue: 'Pas encore d’avis', ancienne: 'Avis de plus de 6 mois', moyenne: 'Mitigé', bonne: 'Satisfait' });
/** Ton d'état (badge) d'une note sur 10 ; null pour l'absence d'avis (jamais une couleur pour « inconnu »). */
export const tonNote = (n) => (n === null || n === undefined ? null : n >= 8 ? 'ok' : n >= 6 ? 'attention' : 'critique');

/** Les `n` derniers mois (premier jour, UTC), du plus ancien au plus récent. */
export function derniersMois(maintenant = new Date(), n = 12) {
  const res = [];
  for (let i = n - 1; i >= 0; i--) res.push(new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth() - i, 1)));
  return res;
}

/**
 * Série mensuelle pour uPlot : { x: secondes[], y: (moyenne sur 10 | null)[], n: réponses[] } sur 12 mois.
 * clients : S.clients (chacun avec historique [{ le: 'AAAA-MM-JJ', note }]).
 */
export function serieMensuelle(clients, maintenant = new Date(), nbMois = 12) {
  const mois = derniersMois(maintenant, nbMois);
  const cle = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  const sommes = new Map(mois.map((d) => [cle(d), { s: 0, n: 0 }]));
  for (const c of Object.values(clients ?? {})) {
    for (const h of c?.historique ?? []) {
      if (typeof h?.note !== 'number') continue;
      const m = sommes.get(String(h.le ?? '').slice(0, 7));
      if (m) { m.s += h.note; m.n += 1; }
    }
  }
  return {
    x: mois.map((d) => d.getTime() / 1000),
    y: mois.map((d) => { const m = sommes.get(cle(d)); return m && m.n ? Math.round((m.s / m.n) * 10) / 10 : null; }),
    n: mois.map((d) => sommes.get(cle(d))?.n ?? 0),
  };
}

/** Lignes du tableau équivalent à la courbe (mois avec au moins une réponse). */
export function lignesSerie(serie) {
  return serie.x.map((x, i) => ({ mois: MOIS.format(new Date(x * 1000)), moyenne: serie.y[i], reponses: serie.n[i] })).filter((l) => l.reponses > 0);
}

/** Résumé en texte au-dessus de la courbe (§4.22) : dernière moyenne, variation sur le mois relevé précédent. */
export function resumeSerie(serie) {
  const pts = serie.y.map((v, i) => ({ v, i })).filter((p) => p.v !== null);
  if (!pts.length) return { vide: true, texte: 'Pas encore de réponse sur les 12 derniers mois.', variation: null };
  const der = pts.at(-1);
  const total = serie.n.reduce((a, b) => a + b, 0);
  const base = `Satisfaction moyenne : ${NOMBRE.format(der.v)} sur 10 en ${MOIS.format(new Date(serie.x[der.i] * 1000))}, sur ${pluriel(total, 'réponse', 'réponses')} en 12 mois.`;
  if (pts.length < 2) return { vide: false, texte: base, variation: null };
  const d = Math.round((der.v - pts.at(-2).v) * 10) / 10;
  return { vide: false, texte: base, variation: d, variationTexte: d === 0 ? 'Stable' : `${d > 0 ? '+' : '−'}${NOMBRE.format(Math.abs(d))} point${Math.abs(d) >= 2 ? 's' : ''} sur le mois relevé précédent` };
}

/** Clients triés : mécontents, sans avis, anciens, puis mitigés et satisfaits ; à statut égal, par nom. */
export function trierClients(liste, nomDe) {
  return [...liste].sort((a, b) => (RANG_STATUT[a.statut] ?? 9) - (RANG_STATUT[b.statut] ?? 9) || nomDe(a.id).localeCompare(nomDe(b.id), 'fr'));
}
