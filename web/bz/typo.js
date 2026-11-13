// Breizhcosystem — typographie française des textes d'interface (direction de design §8.3).
// Appliquée par h() aux textes et aux attributs aria-label, title, placeholder et alt (sauf code, pre, kbd, samp, data-brut).
// Sans dépendance ; module partagé avec le réseau Breizhcosystem.

export const FINE = ' ';
export const INSECABLE = ' ';
const UNITES = '(?:€|%|‰|km|kg|g|m²|m³|m|cm|mm|min|h|j|mois|ans?|HT|TTC|salariés?|caractères)';
const RE_UNITE = new RegExp(`(\\d)[ \\u00A0](?=${UNITES}(?![\\p{L}]))`, 'gu');

/** Typographie française d'un texte d'interface. Idempotente : peut être appliquée deux fois. */
export function typo(texte) {
  if (typeof texte !== 'string' || texte.length < 2) return texte;
  return texte
    .replace(/[   ]+([;!?»])/g, `${FINE}$1`) // espace fine avant ; ! ? »
    .replace(/«[   ]*/g, `«${FINE}`) // espace fine après «
    .replace(/[  ]+:(?=\s|$)/g, `${INSECABLE}:`) // insécable avant : (pas 14:30, pas https:)
    .replace(RE_UNITE, `$1${INSECABLE}`) // 12 km, 29 €
    .replace(/(\d)[  ]h[  ](\d{2})\b/g, `$1${INSECABLE}h${INSECABLE}$2`) // 14 h 30
    .replace(/(\d)[  ](?=\d{3}(?!\d))/g, `$1${FINE}`) // 2 000 : milliers insécables (sans lookbehind, pour iOS 15)
    .replace(/€[ ](HT|TTC)\b/g, `€${INSECABLE}$1`) // 29 € HT
    .replace(/(\p{L})'(?=\p{L})/gu, '$1’') // l'entreprise → l’entreprise
    .replace(/\.\.\./g, '…');
}

const REGLES = new Intl.PluralRules('fr-FR');
const NOMBRE = new Intl.NumberFormat('fr-FR');

/** pluriel(3, 'chose à régler', 'choses à régler') → « 3 choses à régler ». En français, 0 et 1 sont au singulier. */
export function pluriel(n, un, plusieurs, { zero } = {}) {
  if (n === 0 && zero) return zero; // pluriel(0, …, …, { zero: 'Rien à régler' })
  return `${NOMBRE.format(n)}${INSECABLE}${REGLES.select(n) === 'one' ? un : plusieurs}`;
}

/** Le mot seul, accordé : accord(2, 'ajouté', 'ajoutés') → « ajoutés » (pour les phrases où le nombre est déjà écrit). */
export const accord = (n, un, plusieurs) => (REGLES.select(n) === 'one' ? un : plusieurs);

/** nombre(18420) → « 18 420 » (espace fine insécable, virgule décimale). */
export const nombre = (n, options = {}) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2, ...options }).format(n);

/** euros(1240.5) → « 1 240,50 € » ; euros(18420, { arrondi: true }) → « 18 420 € » (tuiles, graphiques). */
export const euros = (n, { arrondi = false } = {}) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: arrondi ? 0 : 2, maximumFractionDigits: arrondi ? 0 : 2 }).format(n);

/** pourcentage(0.12) → « 12 % » ; pourcentage(0.12, { signe: true }) → « +12 % ». */
export const pourcentage = (n, { signe = false } = {}) =>
  new Intl.NumberFormat('fr-FR', { style: 'percent', maximumFractionDigits: 0, signDisplay: signe ? 'exceptZero' : 'auto' }).format(n);

const RELATIF = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
const JOUR_MOIS = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' });
const JOUR_MOIS_AN = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Date relative jusqu'à 7 jours (« hier », « il y a 3 jours », « dans 2 h »), absolue ensuite (« 12 novembre »). */
export function dateRelative(date, maintenant = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '—';
  const ecart = (d.getTime() - maintenant.getTime()) / 1000;
  const abs = Math.abs(ecart);
  if (abs < 60) return 'à l’instant';
  if (abs < 3600) return RELATIF.format(Math.round(ecart / 60), 'minute');
  if (abs < 86_400) return RELATIF.format(Math.round(ecart / 3600), 'hour');
  if (abs < 7 * 86_400) return RELATIF.format(Math.round(ecart / 86_400), 'day');
  return (d.getFullYear() === maintenant.getFullYear() ? JOUR_MOIS : JOUR_MOIS_AN).format(d);
}

// Formes juridiques et sigles gardés en capitales par casseTitre()
const SIGLES = new Set(['SA', 'SAS', 'SASU', 'SARL', 'EURL', 'SCI', 'SCOP', 'SNC', 'SCA', 'SCM', 'SEL', 'SELARL', 'GIE', 'EI', 'EIRL', 'GAEC', 'EARL', 'SCEA', 'CUMA', 'SEM', 'SPL', 'BTP', 'PME', 'TPE', 'ETI', 'SIRET', 'SIREN', 'TVA', 'HT', 'TTC', 'CE', 'CHU', 'EHPAD', 'IUT', 'BNP', 'CIC', 'LCL', 'SNCF', 'EDF', 'GDF', 'RATP']);
const MINUSCULES = new Set(['d', 'l', 'de', 'du', 'des', 'la', 'le', 'les', 'et', 'en', 'à', 'au', 'aux', 'sur', 'sous', 'pour', 'par']);

/** Raison sociale SIRENE en casse de titre : « KERLANN BOIS SARL » → « Kerlann Bois SARL ». Laisse un nom déjà en casse mixte. */
export function casseTitre(nom) {
  if (typeof nom !== 'string' || !nom || nom !== nom.toLocaleUpperCase('fr-FR')) return nom;
  let premier = true;
  return nom.toLocaleLowerCase('fr-FR').replace(/[\p{L}\p{N}]+/gu, (mot) => {
    const haut = mot.toLocaleUpperCase('fr-FR');
    const debut = premier;
    premier = false;
    if (SIGLES.has(haut)) return haut;
    if (!debut && MINUSCULES.has(mot)) return mot;
    return mot.charAt(0).toLocaleUpperCase('fr-FR') + mot.slice(1);
  });
}
