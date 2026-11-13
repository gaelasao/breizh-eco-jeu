/**
 * Textes côté serveur (direction de design §8.3, §6.4 : plus de pluriel « (s) »). En français, 0 et 1 sont au
 * singulier : pluriel(1, 'facture en retard', 'factures en retard') → « 1 facture en retard ».
 */
const INSECABLE = ' ';
const FINE = ' ';
const NOMBRE = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

/** Nombre à la française : espace fine insécable entre les milliers, virgule décimale (« 6 800 », « 12,5 »). */
export const nombreFr = (n: number): string => NOMBRE.format(n);

export const pluriel = (n: number, un: string, plusieurs: string): string => `${nombreFr(n)}${INSECABLE}${Math.abs(n) < 2 ? un : plusieurs}`;

/** Unités qui s'accordent : « 1 jour », « 0 jour », « 42 jours ». */
const ACCORDS: Readonly<Record<string, readonly [string, string]>> = {
  jours: ['jour', 'jours'], jour: ['jour', 'jours'], heures: ['heure', 'heures'], heure: ['heure', 'heures'],
  semaines: ['semaine', 'semaines'], ans: ['an', 'ans'], an: ['an', 'ans'], personnes: ['personne', 'personnes'],
};

/**
 * Une mesure et son unité, à la française : « 6 800 € », « 42 jours », « 1 jour », « 12 % », « 3/10 », « 6 ».
 * Espace insécable entre le nombre et l'unité (fine avant %), jamais d'espace avant « /10 ».
 */
export function mesure(v: number, unite?: string | null): string {
  const u = (unite ?? '').trim();
  if (!u) return nombreFr(v);
  const accord = ACCORDS[u];
  if (accord) return pluriel(v, accord[0], accord[1]);
  if (u === '%') return `${nombreFr(v)}${FINE}%`;
  if (u.startsWith('/')) return `${nombreFr(v)}${u}`;
  return `${nombreFr(v)}${INSECABLE}${u}`;
}

/** Première lettre en capitale (casse de phrase) : « à traiter » → « À traiter ». */
export const casseDePhrase = (t: string): string => (t ? `${t.charAt(0).toLocaleUpperCase('fr-FR')}${t.slice(1)}` : t);
