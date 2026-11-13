/**
 * Coordonnées commerciales de l'éditeur, montrées dans le jeu : « Envie de structurer votre entreprise ? Appelez le … ».
 * À remplir par l'éditeur avant de fabriquer les paquets. Tant que le numéro est vide, l'encart n'apparaît nulle part
 * (jamais un « appelez le » sans numéro). LB_CONTACT_TELEPHONE fait le même réglage par variable d'environnement.
 * Rien n'est envoyé à l'éditeur : c'est un texte affiché, et un lien « tel: » que la personne choisit de suivre.
 */
export const TELEPHONE_EDITEUR = '';

export interface ContactEditeur {
  /** Numéro tel qu'il s'affiche (« 02 98 00 00 00 »). */
  telephone: string;
  /** Le même pour un lien « tel: » (chiffres et « + » seulement). */
  lien: string;
}

/** Numéro lisible : chiffres, espaces et points, « + » possible en tête ; 6 à 20 caractères. Autre chose : pas d'encart. */
export function contactEditeur(env: NodeJS.ProcessEnv = process.env): ContactEditeur | null {
  const brut = (env.LB_CONTACT_TELEPHONE ?? TELEPHONE_EDITEUR).trim();
  if (!/^\+?[0-9][0-9 .]{5,19}$/.test(brut)) return null;
  return { telephone: brut, lien: `tel:${brut.replace(/[ .]/g, '')}` };
}
