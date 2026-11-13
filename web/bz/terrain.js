// Breizhcosystem — actions de terrain (direction de design §4.30) : appeler, prévenir d'un retard, y aller.
// Module pur (aucun accès au DOM ni au réseau) : l'adresse et le numéro ne quittent l'appareil qu'au tap de la personne,
// vers l'application qu'elle a choisie (souveraineté). Les liens sont construits avec encodeURIComponent.

/** Applications d'itinéraire proposées dans Réglages › Carte ; « systeme » : Plans sur iPhone et iPad, Google Maps ailleurs. */
export const APPLIS_ITINERAIRE = Object.freeze([
  { id: 'systeme', libelle: 'Celle du téléphone' },
  { id: 'plans', libelle: 'Plans' },
  { id: 'google', libelle: 'Google Maps' },
  { id: 'waze', libelle: 'Waze' },
]);

const INSECABLE = ' ';

/**
 * Premier numéro de téléphone français trouvé dans un texte (« Marie, 06 12 34 56 78 », « +33 2 98 12 34 56 »).
 * Renvoie { affiche: « 06 12 34 56 78 », international: « +33612345678 », lien: « tel:+33612345678 » } ou null.
 */
export function telephoneDe(texte) {
  if (typeof texte !== 'string') return null;
  const m = /(?:\+33[\s. -]*\(?0?\)?|0033[\s. -]*|\b0)([1-9](?:[\s. -]*\d){8})\b/.exec(texte);
  if (!m) return null;
  const neuf = m[1].replace(/\D/g, '');
  if (neuf.length !== 9) return null;
  const national = `0${neuf}`;
  const affiche = national.match(/\d{2}/g).join(INSECABLE);
  const international = `+33${neuf}`;
  return { affiche, international, lien: `tel:${international}` };
}

/** Le texte contient-il une adresse e-mail ? Renvoie le lien mailto: ou null. */
export function courrielDe(texte) {
  if (typeof texte !== 'string') return null;
  const m = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/.exec(texte);
  return m ? { adresse: m[0], lien: `mailto:${m[0]}` } : null;
}

/** Lien « Y aller » vers une adresse. appli : 'systeme' | 'plans' | 'google' | 'waze' ; ios : appareil Apple. */
export function lienItineraire(adresse, { appli = 'systeme', ios = false } = {}) {
  const a = String(adresse ?? '').trim();
  if (!a) return null;
  const q = encodeURIComponent(a);
  const choix = appli === 'systeme' ? (ios ? 'plans' : 'google') : appli;
  if (choix === 'plans') return `https://maps.apple.com/?daddr=${q}`;
  if (choix === 'waze') return `https://waze.com/ul?q=${q}&navigate=yes`;
  return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
}

/** Durées proposées pour « Prévenir d'un retard ». */
export const RETARDS_MINUTES = Object.freeze([5, 15, 30]);

/**
 * SMS prérempli, modifiable avant l'envoi : « Bonjour, j'aurai environ 15 min de retard. » La syntaxe change selon le
 * système (iOS : « &body= », Android : « ?body= »). Le message part de l'application SMS du téléphone, jamais du serveur.
 */
export function lienRetard(telephone, minutes = 15, { ios = false } = {}) {
  const t = typeof telephone === 'string' ? telephoneDe(telephone) : telephone;
  if (!t) return null;
  const corps = encodeURIComponent(`Bonjour, j’aurai environ ${minutes}${INSECABLE}min de retard.`);
  return `sms:${t.international}${ios ? '&' : '?'}body=${corps}`;
}
