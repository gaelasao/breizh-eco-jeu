/**
 * RAPPROCHER LE BON DE LIVRAISON ET LA COMMANDE. Le moment où l'argent part sans qu'on s'en aperçoive : le
 * camion arrive, le bon est signé sur le capot, et trois semaines plus tard la facture est payée sans que personne
 * n'ait vérifié que c'était bien ce qui avait été commandé, dans les bonnes quantités, au bon prix.
 *
 * CE QUE LE LOGICIEL SAIT FAIRE, ET LE FAIT. Comparer deux montants, et reconnaître un numéro de bon déjà vu. Ce
 * sont les deux erreurs qu'une machine attrape mieux qu'un humain : l'écart de quelques euros qu'on ne recompte
 * jamais, et le bon envoyé deux fois par le fournisseur — qui se paie deux fois.
 *
 * CE QU'IL NE SAIT PAS, ET QU'IL DEMANDE. « Est-ce bien ce que j'avais demandé ? » et « les quantités y sont-elles ? »
 * ne se déduisent de rien : il n'y a pas de lignes d'articles dans une commande ici, et il n'y en aura pas tant que
 * personne ne les saisit. Ces deux questions sont donc POSÉES, et leur réponse « pas encore vérifié » est tenue
 * pour ce qu'elle est — une réponse manquante, pas un feu vert.
 *
 * LE BON À PAYER N'EST JAMAIS AUTOMATIQUE. Le logiciel dit ce qui manque et ce qui cloche ; c'est une personne qui
 * coche. Un bon à payer calculé tout seul serait un virement décidé par un logiciel sur deux champs mal remplis.
 */
import { fraicheur, type ObjetMetier, type ValeurChamp } from './model.ts';
import type { ContexteRegle, Situation } from './situation.ts';

/** Les réponses qui valent « je n'ai pas encore regardé » : elles ne comptent jamais comme un accord. */
const NON_VERIFIE = new Set(['pas encore vérifiées', 'pas encore vérifié', '']);

export interface EcartMontant {
  /** Montant de la commande, tel qu'il a été passé. */
  commande: number;
  /** Montant lu sur le bon de livraison. */
  bl: number;
  /** bl − commande : positif = on vous facture plus que ce que vous aviez commandé. */
  ecart: number;
  /** L'écart en pourcentage du montant commandé. */
  pourcent: number;
}

export interface EtatReception {
  /** Le bon porte-t-il un numéro déjà vu chez ce fournisseur ? L'identifiant de l'autre réception, le cas échéant. */
  doublon: string | null;
  ecartMontant: EcartMontant | null;
  /** Ce qui n'a pas encore été répondu, en français, dans l'ordre où on le vérifie sur le quai. */
  manque: string[];
  /** Ce qui cloche vraiment : quantités manquantes, mauvais articles, écart de montant, bon en double. */
  problemes: string[];
  /** Tout est vérifié et tout est bon : le bon à payer ne serait pas abusif. Il reste à cocher par une personne. */
  rienNeBloque: boolean;
  /** Payé alors que quelque chose cloche ou manque : le cas qu'on veut voir, pas celui qu'on veut taire. */
  payeQuandMeme: boolean;
}

const nombre = (v: ValeurChamp | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const texte = (v: ValeurChamp | undefined): string => (typeof v === 'string' ? v.trim() : '');

/** Numéro de bon comparable : sans espaces ni ponctuation, en minuscules. « BL-2026/114 » = « bl 2026 114 ». */
export const cleBl = (v: ValeurChamp | undefined): string => texte(v).toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * L'écart entre le bon de livraison et la commande. `null` tant qu'il manque l'un des deux montants : un écart
 * calculé contre un montant absent vaudrait « on vous facture 100 % de trop », ce qui est faux et alarmant.
 */
export function ecartMontant(reception: ObjetMetier, commande: ObjetMetier | null): EcartMontant | null {
  const bl = nombre(reception.champs.montant_bl);
  const cmd = commande === null ? null : nombre(commande.champs.montant);
  if (bl === null || cmd === null || cmd <= 0) return null;
  const ecart = Math.round((bl - cmd) * 100) / 100;
  return { commande: cmd, bl, ecart, pourcent: Math.round((ecart / cmd) * 1000) / 10 };
}

/**
 * Le même bon reçu deux fois. On ne compare qu'à l'intérieur d'un même fournisseur : deux fournisseurs qui
 * numérotent chacun « 114 » n'ont rien à voir, et crier au doublon là-dessus apprendrait à ignorer l'alerte.
 */
export function doublonBl(
  reception: ObjetMetier,
  autres: readonly ObjetMetier[],
  fournisseurDe: (r: ObjetMetier) => string | null,
): string | null {
  const cle = cleBl(reception.champs.bl_numero);
  if (!cle) return null;
  const mien = fournisseurDe(reception);
  const jumeau = autres.find((r) => r.id !== reception.id && cleBl(r.champs.bl_numero) === cle && fournisseurDe(r) === mien);
  return jumeau?.id ?? null;
}

/**
 * L'état d'une réception : ce qui manque à vérifier, ce qui cloche, et si quelque chose s'oppose au paiement.
 * `autres` sert au seul contrôle du doublon ; `fournisseurDe` dit de qui vient une réception (par sa commande).
 */
export function etatReception(
  reception: ObjetMetier,
  commande: ObjetMetier | null,
  autres: readonly ObjetMetier[] = [],
  fournisseurDe: (r: ObjetMetier) => string | null = () => null,
): EtatReception {
  const quantites = texte(reception.champs.quantites);
  const articles = texte(reception.champs.articles);
  const manque: string[] = [];
  const problemes: string[] = [];

  if (NON_VERIFIE.has(quantites)) manque.push('les quantités ne sont pas encore vérifiées');
  else if (quantites === 'manquantes') problemes.push('il manque des quantités');
  else if (quantites === 'en trop') problemes.push('il y a plus que commandé');

  if (NON_VERIFIE.has(articles)) manque.push('personne n’a encore dit si c’est bien ce qui avait été commandé');
  else if (articles === 'pas ce qui était demandé') problemes.push('ce n’est pas ce qui avait été demandé');
  else if (articles === 'en partie seulement') problemes.push('la livraison est incomplète');

  if (commande === null) manque.push('la réception n’est rattachée à aucune commande');
  else if (commande.type !== 'commande_fournisseur') problemes.push(`la réception est rattachée à ${commande.nom}, qui n’est pas une commande fournisseur`);

  /*
   * L'ORDRE EST CELUI DE CE QUE ÇA COÛTE. Un écran et une liste ne montrent que la première ligne : c'est donc
   * elle qui décide de ce que la personne va faire. Payer deux fois le même bon coûte le montant entier ; un écart
   * de 5 %, cinq pour cent. Le doublon passe devant.
   */
  const doublon = doublonBl(reception, autres, fournisseurDe);
  if (doublon) problemes.unshift('ce numéro de bon est déjà enregistré pour ce fournisseur : risque de payer deux fois');

  const ecart = ecartMontant(reception, commande);
  if (ecart === null && commande !== null && commande.type === 'commande_fournisseur') manque.push('le montant du bon de livraison n’est pas saisi');
  if (ecart !== null && ecart.ecart !== 0) {
    problemes.push(ecart.ecart > 0
      ? `le bon dépasse la commande de ${ecart.ecart.toFixed(2).replace('.', ',')} € (${ecart.pourcent} %)`
      : `le bon est inférieur à la commande de ${(-ecart.ecart).toFixed(2).replace('.', ',')} €`);
  }

  const rienNeBloque = manque.length === 0 && problemes.length === 0;
  return {
    doublon,
    ecartMontant: ecart,
    manque,
    problemes,
    rienNeBloque,
    payeQuandMeme: reception.champs.bon_a_payer === true && !rienNeBloque,
  };
}

/** La phrase de la réception : ce qui bloque d'abord, ce qui manque ensuite, et le feu vert en dernier. */
export function phraseReception(e: EtatReception): string {
  if (e.payeQuandMeme) return `Marquée bon à payer alors que ${e.problemes[0] ?? e.manque[0]}.`;
  if (e.problemes.length) return `À ne pas payer en l’état : ${e.problemes.join(' ; ')}.`;
  if (e.manque.length) return `Avant de payer, il reste à vérifier : ${e.manque.join(' ; ')}.`;
  return 'Bon de livraison et commande concordent. Rien ne s’oppose au paiement.';
}

/**
 * LA RÉCEPTION DANS LES SITUATIONS DU MONDE. Sans cela, la liste et le bandeau de la fiche affichaient « En ordre »
 * sur une réception qu'il ne faut surtout pas payer : le rapprochement était calculé, il sortait en alerte, et
 * l'écran disait le contraire. C'est l'écran qu'on croit.
 *
 * Rien n'est inventé ici : la situation reprend, mot pour mot, ce que `etatReception` a trouvé. Les questions sans
 * réponse sont « à vérifier », pas « critique » — une livraison de la veille qu'on n'a pas eu le temps de contrôler
 * n'est pas une anomalie.
 */
export function situationsReception(
  reception: ObjetMetier,
  commande: ObjetMetier | null,
  autres: readonly ObjetMetier[],
  fournisseurDe: (r: ObjetMetier) => string | null,
  responsable: string | null,
  ctx: ContexteRegle,
): Situation[] {
  const e = etatReception(reception, commande, autres, fournisseurDe);
  const preuve = {
    valeur: e.ecartMontant?.ecart ?? null, seuil: 0, source: reception.source, observeLe: reception.majLe,
    provenance: reception.provenance, fraicheur: fraicheur(reception.majLe, ctx.maintenant, ctx.ageMaxMs),
  };
  const base = { objetId: reception.id, responsable, statut: 'ouverte' as const, preuve };
  if (e.payeQuandMeme) {
    return [{ ...base, regle: 'reception_payee_quand_meme', gravite: 'critique', description: `Bon à payer coché alors que ${e.problemes[0] ?? e.manque[0] ?? 'tout n’est pas vérifié'}` }];
  }
  if (e.problemes.length) {
    return [{ ...base, regle: 'reception_ecart', gravite: 'critique', description: `À ne pas payer en l’état : ${e.problemes[0]}` }];
  }
  if (e.manque.length) {
    return [{ ...base, regle: 'reception_a_verifier', gravite: 'attention', description: `Reste à vérifier : ${e.manque[0]}` }];
  }
  return [];
}
