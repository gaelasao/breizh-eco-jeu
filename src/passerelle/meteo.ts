/**
 * LE VRAI TEMPS QU'IL FAIT, sur la carte.
 *
 * Jusqu'ici le ciel de la carte suivait un tour écrit d'avance (`web/carte/meteo.js`) : une éclaircie, des nuages,
 * une averse, la lumière qui revient — 164 secondes, toujours les mêmes. De l'ambiance, pas une information. Ce
 * module branche ce ciel sur le temps qu'il fait vraiment là où l'entreprise travaille : quand il pleut chez vous,
 * il pleut sur la carte. Pour qui pose des fenêtres ou coule une dalle, ce n'est plus du décor.
 *
 * CE QUI SORT, ET RIEN D'AUTRE. Une latitude et une longitude arrondies au centième de degré — environ un kilomètre,
 * de quoi désigner une commune, pas une adresse. Aucun identifiant, aucun nom, aucun cookie : le service interrogé
 * ne peut pas savoir qui demande, ni deux fois de suite que c'est le même. L'appel part du serveur de l'entreprise,
 * jamais du navigateur, et seulement quand quelqu'un a allumé le réglage — éteint à l'installation.
 *
 * POURQUOI OPEN-METEO. C'est le seul service sérieux qui ne demande ni compte ni clé : rien de plus à déclarer, rien
 * de plus à renouveler, rien qui tombe en panne le jour où une clé expire. Données libres (CC-BY 4.0), modèles des
 * services météorologiques nationaux — Météo-France pour la Bretagne. Documentation lue le 18 novembre 2026 :
 * https://open-meteo.com/en/docs — `current=weather_code,temperature_2m,cloud_cover,precipitation`, codes WMO 4677.
 *
 * CE QU'IL EN SORT : l'un des quatre ciels que la carte sait peindre. Pas une valeur continue : les quatre passages
 * du tour sont réglés pour que la scène reste lisible sous les nuages (§5.2), et on ne va pas défaire cela pour
 * afficher 73 % de couverture. Le ciel dit « clair », « éclaircie », « nuages » ou « averse », et c'est déjà la
 * vérité. Le relevé exact (température, couverture, millimètres) accompagne la réponse, pour qui veut le lire.
 */
import { appeler, ErreurSortante, type Recuperateur } from './sortant.ts';

/** Hôte interrogé, et lui seul. */
export const HOTE = 'api.open-meteo.com';
/** Durée de garde d'un relevé : la météo ne change pas plus vite, et le service n'est pas sollicité pour rien. */
export const FRAICHEUR_MS = 15 * 60_000;
/** Précision des coordonnées envoyées : 2 décimales ≈ 1,1 km. Une commune, pas une adresse. */
export const PRECISION = 2;

/** Les quatre ciels de la carte, dans l'ordre du plus clair au plus couvert. */
export type Ciel = 'clair' | 'eclaircie' | 'nuages' | 'averse';

export interface Releve {
  /** Le ciel à peindre : l'un des quatre passages que la carte connaît. */
  ciel: Ciel;
  /** Ce que le service a répondu, pour qui veut le lire : 0 à 100. */
  couverture: number;
  /** Millimètres tombés dans l'heure. */
  pluie: number;
  /** Degrés Celsius. */
  temperature: number | null;
  /** Code WMO 4677 rendu par le service (0 ciel clair, 61 pluie, 95 orage…). */
  code: number;
  /** En clair, en français. */
  texte: string;
  /** Instant du relevé (ISO). */
  releveLe: string;
}

/** Coordonnée bornée et arrondie : hors des bornes, rien n'est demandé. */
export function coordonnee(x: unknown, max: number): number | null {
  const n = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : Number.NaN;
  if (!Number.isFinite(n) || Math.abs(n) > max) return null;
  return Number(n.toFixed(PRECISION));
}

/**
 * Code WMO 4677 → une phrase française. Les familles seulement : personne n'a besoin de lire « bruine verglaçante
 * d'intensité modérée » sur une carte, et le détail se perd de toute façon dans quatre ciels.
 */
export function texteDuCode(code: number): string {
  if (code === 0) return 'Ciel clair';
  if (code === 1) return 'Plutôt clair';
  if (code === 2) return 'Partiellement nuageux';
  if (code === 3) return 'Couvert';
  if (code === 45 || code === 48) return 'Brouillard';
  if (code >= 51 && code <= 57) return 'Bruine';
  if (code >= 61 && code <= 67) return 'Pluie';
  if (code >= 71 && code <= 77) return 'Neige';
  if (code >= 80 && code <= 82) return 'Averses';
  if (code === 85 || code === 86) return 'Averses de neige';
  if (code >= 95) return 'Orage';
  return 'Temps couvert';
}

/**
 * Le ciel à peindre, d'après ce que le service répond. La pluie l'emporte sur tout le reste : s'il tombe quelque
 * chose, la carte est sous l'averse, quelle que soit la couverture annoncée. Sinon, c'est la couverture qui tranche,
 * avec les mêmes seuils que les quatre passages du tour (8 %, 30 %, 74 %).
 */
export function cielDe(code: number, couverture: number, pluie: number): Ciel {
  if (pluie > 0 || (code >= 51 && code <= 99)) return 'averse';
  if (code === 45 || code === 48 || code === 3 || couverture >= 70) return 'nuages';
  if (code === 2 || couverture >= 25) return 'eclaircie';
  return 'clair';
}

const nombre = (x: unknown, defaut: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : defaut);
const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Adresse interrogée : un seul hôte, un seul chemin, et rien d'autre que les coordonnées. */
export function adresseMeteo(lat: number, lon: number): URL {
  const u = new URL(`https://${HOTE}/v1/forecast`);
  u.searchParams.set('latitude', String(lat));
  u.searchParams.set('longitude', String(lon));
  u.searchParams.set('current', 'weather_code,temperature_2m,cloud_cover,precipitation');
  u.searchParams.set('timezone', 'UTC');
  return u;
}

/** Réponse du service → relevé du jeu. Rend `null` si elle n'a pas la forme attendue. */
export function releveDe(donnees: unknown): Releve | null {
  const d = estObj(donnees) ? donnees : {};
  const c = estObj(d.current) ? d.current : null;
  if (!c) return null;
  const code = Math.round(nombre(c.weather_code, -1));
  if (code < 0 || code > 99) return null;
  const couverture = Math.max(0, Math.min(100, Math.round(nombre(c.cloud_cover, 0))));
  const pluie = Math.max(0, Math.round(nombre(c.precipitation, 0) * 10) / 10);
  const t = c.temperature_2m;
  return {
    ciel: cielDe(code, couverture, pluie),
    couverture,
    pluie,
    temperature: typeof t === 'number' && Number.isFinite(t) ? Math.round(t * 10) / 10 : null,
    code,
    texte: texteDuCode(code),
    releveLe: typeof c.time === 'string' && c.time.length <= 40 ? c.time : new Date().toISOString(),
  };
}

interface Garde { cle: string; releve: Releve; le: number }

/**
 * Le temps qu'il fait à cet endroit. Un relevé est gardé quinze minutes par couple de coordonnées : ouvrir la carte
 * dix fois n'appelle pas le service dix fois, et deux personnes de la même entreprise partagent le même relevé.
 */
export class Meteo {
  #f: Recuperateur;
  #maintenant: () => number;
  #garde: Garde | null = null;

  constructor({ fetch: f, maintenant = () => Date.now() }: { fetch: Recuperateur; maintenant?: () => number }) {
    this.#f = f;
    this.#maintenant = maintenant;
  }

  /** Relevé gardé pour ces coordonnées, s'il est encore frais. */
  gardee(lat: number, lon: number): Releve | null {
    const g = this.#garde;
    return g && g.cle === `${lat},${lon}` && this.#maintenant() - g.le < FRAICHEUR_MS ? g.releve : null;
  }

  async lire(latBrut: unknown, lonBrut: unknown): Promise<Releve> {
    const lat = coordonnee(latBrut, 90);
    const lon = coordonnee(lonBrut, 180);
    if (lat === null || lon === null) throw new ErreurSortante('Coordonnées manquantes : indiquez l’adresse de votre siège pour que la carte connaisse votre ciel.');
    const garde = this.gardee(lat, lon);
    if (garde) return garde;
    const { donnees } = await appeler(this.#f, adresseMeteo(lat, lon), { delaiMs: 10_000 });
    const releve = releveDe(donnees);
    if (!releve) throw new ErreurSortante('Le service de météo a répondu quelque chose d’illisible.');
    this.#garde = { cle: `${lat},${lon}`, releve, le: this.#maintenant() };
    return releve;
  }
}
