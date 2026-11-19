/**
 * CE QU'ON ÉCRIT AU ROBOT, ET CE QU'IL EN COMPREND.
 *
 * Jusqu'ici Telegram allait dans un seul sens : le jeu prévenait, et deux boutons (« C'est fait », « Plus tard »)
 * revenaient. On ne pouvait rien LUI dire. Or c'est là qu'on est quand ça se passe : dans la voiture, sur le
 * chantier, entre deux rendez-vous. « Rappeler Dupont lundi » tapé à ce moment-là vaut mieux que la même phrase
 * oubliée avant d'avoir rouvert l'ordinateur.
 *
 * TROIS CHOSES, PAS QUINZE. On ne réinvente pas le logiciel dans une messagerie :
 *   · DEMANDER — « ? », « aujourd'hui », « quoi de neuf » : ce qui est à faire, en une réponse ;
 *   · NOTER UNE TÂCHE — « tâche : rappeler Dupont », ou simplement « rappeler Dupont lundi » ;
 *   · NOTER UN RENDEZ-VOUS — « note Boulangerie : ils veulent un devis », le compte rendu rejoint la fiche du client.
 * Tout le reste reçoit une réponse qui dit ce que le robot sait faire. Il ne devine jamais : une phrase qu'il ne
 * comprend pas n'écrit rien.
 *
 * MODULE PUR. Il ne connaît ni Telegram, ni le monde, ni les fiches : il lit une phrase et rend une intention. Ce
 * qui l'exécute est ailleurs, et c'est ailleurs aussi que les droits sont vérifiés.
 */

export type Intention =
  | { genre: 'resume' }
  | { genre: 'tache'; titre: string; quand: string | null }
  | { genre: 'note'; qui: string | null; texte: string }
  /**
   * Un mouvement de stock. La QUANTITÉ et le SENS se tapent ; la DÉNOMINATION se choisit dans une liste, parce
   * qu'un nom d'article tapé au doigt sur un quai (« panno 19 », « panneau19mm ») ne retrouve rien, et qu'un
   * mouvement rangé sur le mauvais article est pire qu'un mouvement pas saisi. `article` n'est qu'un filtre pour
   * raccourcir la liste proposée — jamais une désignation retenue d'office.
   */
  | { genre: 'stock'; sens: 'entree' | 'sortie'; quantite: number; article: string | null }
  | { genre: 'aide' };

const sansAccent = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const propre = (t: string): string => t.replace(/\s+/g, ' ').trim();

/** Taille d'un message pris au sérieux : au-delà, c'est un copier-coller, pas une consigne. */
export const MAX = 2000;

// « ? » seul n'a pas de frontière de mot après lui : la limite ne vaut que pour les formes écrites en lettres
const DEMANDER = /^(?:\?+|(?:quoi de neuf|aujourd['’\s]?hui|alors|ou en suis[- ]je|ca donne quoi|resume|point|etat|du neuf)\b)/;
const AIDE = /^(aide|help|\/start|\/aide|\/help|comment|quoi faire|tu sais faire quoi)\b/;
/* Ces deux-là s'appliquent à la phrase TELLE QU'ELLE EST ÉCRITE, pas à sa version sans accents : c'est la seule
   façon d'en retirer le début sans décaler d'un caractère ce qui suit. Le point joue l'accent (« tâche », « tache »,
   « à faire », « a faire ») — il attrape large, et c'est sans conséquence sur un début de phrase ancré. */
const TACHE = /^(?:\/?t.che|\/?todo|. faire|af|note moi|rappelle moi|penser .|pense .|ne pas oublier)\s*(?:de\s+)?[:\-–—]?\s*/i;
const NOTE = /^(?:\/?note|\/?cr|compte[\s-]?rendu|rdv|rendez[\s-]?vous|vu|appel)\s*[:\-–—]?\s*/i;
/*
 * LE STOCK, DANS LES MOTS DU QUAI. On écrit « sortie 3 », « sorti 12 panneaux », « -3 », « entrée 50 vis »,
 * « +10 ». Le signe compte autant que le mot : sur un téléphone, « -3 » se tape en deux touches, et c'est ce que
 * les gens font. La quantité peut précéder ou suivre le sens, parce que les deux s'écrivent.
 */
const STOCK_MOT = /^(?:\/?stock\s+)?(entree|entrees|entre|rentre|rentree|recu|recus|livre|livraison|sortie|sorties|sorti|sortis|sort|pris|prise|consomme|utilise)\b\s*/;
const STOCK_SIGNE = /^([+-])\s*(\d{1,6}(?:[.,]\d{1,3})?)\s*/;
const SORTIE = /^(sortie|sorties|sorti|sortis|sort|pris|prise|consomme|utilise)/;
const QUANTITE = /(?:^|\s)(\d{1,6}(?:[.,]\d{1,3})?)(?:\s|$)/;

/** Jours et repères de temps qu'on écrit vraiment dans un message. Rien de plus : une date mal devinée est pire. */
const QUAND = [
  [/\b(aujourd['’\s]?hui|ce soir|ce midi)\b/, 0],
  [/\bapres[- ]?demain\b/, 2],
  [/(?<!apres[- ])\bdemain\b/, 1],
  [/\blundi\b/, 'lundi'], [/\bmardi\b/, 'mardi'], [/\bmercredi\b/, 'mercredi'], [/\bjeudi\b/, 'jeudi'],
  [/\bvendredi\b/, 'vendredi'], [/\bsamedi\b/, 'samedi'], [/\bdimanche\b/, 'dimanche'],
] as const;
const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const deux = (n: number): string => String(n).padStart(2, '0');
const iso = (d: Date): string => `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`;

/**
 * La date écrite dans une phrase, si elle y est. « lundi » veut dire le prochain lundi, jamais celui qui vient de
 * passer. Rien trouvé : `null`, et la tâche n'a pas d'échéance — plutôt qu'une date inventée qui sonnera pour rien.
 */
export function quandDuTexte(phrase: string, aujourdhui = new Date()): string | null {
  const t = sansAccent(phrase);
  // une date écrite (12/03, 12 mars) l'emporte sur un nom de jour
  const num = /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/.exec(t);
  if (num) {
    const a = num[3] ? (Number(num[3]) < 100 ? 2000 + Number(num[3]) : Number(num[3])) : aujourdhui.getFullYear();
    const d = new Date(a, Number(num[2]) - 1, Number(num[1]));
    if (Number.isFinite(d.getTime()) && d.getMonth() === Number(num[2]) - 1) {
      // sans année écrite, une date déjà passée désigne l'an prochain
      if (!num[3] && d < new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate())) d.setFullYear(a + 1);
      return iso(d);
    }
  }
  for (const [re, valeur] of QUAND) {
    if (!re.test(t)) continue;
    const d = new Date(aujourdhui.getFullYear(), aujourdhui.getMonth(), aujourdhui.getDate());
    if (typeof valeur === 'number') { d.setDate(d.getDate() + valeur); return iso(d); }
    const vise = JOURS.indexOf(valeur);
    let delta = (vise - d.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // « lundi » un lundi, c'est le lundi suivant : on ne se donne pas une échéance d'aujourd'hui
    d.setDate(d.getDate() + delta);
    return iso(d);
  }
  return null;
}

/**
 * Ce qu'une phrase demande. L'ordre compte : on reconnaît d'abord ce qui est explicite (« tâche : … »), ensuite ce
 * qui est court et interrogatif, et seulement à la fin on accepte une phrase nue comme une tâche — parce qu'écrire
 * à son robot, neuf fois sur dix, c'est se noter quelque chose.
 */
export function comprendre(brut: unknown, aujourdhui = new Date()): Intention {
  const phrase = propre(String(brut ?? '')).slice(0, MAX);
  if (!phrase) return { genre: 'aide' };
  const t = sansAccent(phrase);
  if (AIDE.test(t)) return { genre: 'aide' };
  if (DEMANDER.test(t)) return { genre: 'resume' };

  /*
   * LE STOCK PASSE AVANT LA TÂCHE. « sorti 3 panneaux » est un mouvement, pas une chose à faire : sans cette
   * priorité, la phrase tomberait dans le filet des tâches (deux mots, cinq caractères) et créerait une tâche
   * intitulée « sorti 3 panneaux », que personne ne fermerait jamais.
   */
  const stock = stockDuTexte(phrase, t);
  if (stock) return stock;

  const note = NOTE.exec(phrase);
  if (note) {
    const reste = propre(phrase.slice(note[0].length));
    // « note Boulangerie : ils veulent un devis » — avant les deux points, le nom ; après, ce qui s'est dit
    const sep = /^([^:]{2,60}?)\s*:\s*(.+)$/s.exec(reste);
    if (sep) return { genre: 'note', qui: propre(sep[1] ?? ''), texte: propre(sep[2] ?? '') };
    return reste ? { genre: 'note', qui: null, texte: reste } : { genre: 'aide' };
  }

  const tache = TACHE.exec(phrase);
  if (tache) {
    const titre = propre(phrase.slice(tache[0].length));
    return titre ? { genre: 'tache', titre, quand: quandDuTexte(titre, aujourdhui) } : { genre: 'aide' };
  }

  // une phrase nue : une tâche, à condition qu'elle dise quelque chose (deux mots, pas un « ok »)
  if (phrase.split(' ').length >= 2 && phrase.length >= 5) return { genre: 'tache', titre: phrase, quand: quandDuTexte(phrase, aujourdhui) };
  return { genre: 'aide' };
}

/**
 * UN MOUVEMENT DE STOCK, S'IL Y EN A UN. Deux écritures : le mot (« sortie 3 panneaux ») et le signe (« -3 »).
 * Sans quantité, rien : « sortie » tout court ne dit pas combien, et deviner 1 ferait disparaître du stock sur un
 * message incomplet. Le reste de la phrase est rendu tel quel comme FILTRE de la liste, jamais comme désignation.
 */
function stockDuTexte(phrase: string, sansAccents: string): Intention | null {
  const signe = STOCK_SIGNE.exec(sansAccents);
  if (signe) {
    const q = Number(String(signe[2]).replace(',', '.'));
    if (!Number.isFinite(q) || q <= 0) return null;
    const reste = propre(phrase.slice(signe[0].length));
    return { genre: 'stock', sens: signe[1] === '-' ? 'sortie' : 'entree', quantite: q, article: reste || null };
  }
  const mot = STOCK_MOT.exec(sansAccents);
  if (!mot) return null;
  const reste = propre(phrase.slice(mot[0].length));
  const q = QUANTITE.exec(` ${reste} `);
  if (!q) return null;
  const quantite = Number(String(q[1]).replace(',', '.'));
  if (!Number.isFinite(quantite) || quantite <= 0) return null;
  // ce qui entoure le nombre sert à raccourcir la liste ; le nombre lui-même n'en fait pas partie
  const article = propre(reste.replace(q[1] as string, ' ')) || null;
  return { genre: 'stock', sens: SORTIE.test(mot[1] as string) ? 'sortie' : 'entree', quantite, article };
}

/** Ce que le robot répond quand il n'a pas compris : ce qu'il sait faire, en trois lignes et dans les mots des gens. */
export const AIDE_TEXTE = [
  'Je sais faire trois choses :',
  '• « ? » — ce qu’il y a à faire aujourd’hui.',
  '• « rappeler Dupont lundi » — je le note en tâche, avec sa date.',
  '• « note Boulangerie : ils veulent un devis » — je le range dans le suivi du client.',
  '• « sortie 3 » ou « -3 » — un mouvement de stock, et vous choisissez l’article dans la liste.',
].join('\n');
