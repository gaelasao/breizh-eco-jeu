/** Tableau de tableur (1re ligne = en-têtes) → enregistrements identifiés par une colonne. Commun à Sheets et Excel. */
import type { Enregistrement, ValeurSortante } from './sources.ts';
import { ErreurSortante } from './sortant.ts';

/** Début de texte qu'un tableur lit comme une formule ou une commande : = + - @, tabulation, retour chariot. */
const DEBUT_FORMULE = /^[=+\-@\t\r]/;
/** Nombre négatif seul (« -12,5 ») : jamais une formule, il reste un nombre dans la feuille. */
const NEGATIF_SEUL = /^-\d+(?:[.,]\d+)?$/;

/**
 * Valeur écrite dans un tableur (Excel 365, Google Sheets par l'API ou par le script) : un texte qui commencerait une
 * formule reçoit une apostrophe devant, que le tableur n'affiche pas et qui le fait lire comme du texte (« =… »,
 * « +33 6… », « @… » arrivent tels quels, rien n'est exécuté). Nombres, booléens et cases vides sont inchangés.
 */
export function sansFormule(v: ValeurSortante): ValeurSortante {
  return typeof v === 'string' && DEBUT_FORMULE.test(v) && !NEGATIF_SEUL.test(v) ? `'${v}` : v;
}

export function lignesVersEnregistrements(tableau: readonly (readonly unknown[])[], colonneId: string | undefined): Enregistrement[] {
  const [entetesBruts = [], ...lignes] = tableau;
  const entetes = entetesBruts.map((x) => String(x ?? '').trim());
  const col = colonneId ? entetes.indexOf(colonneId) : 0;
  if (col < 0) throw new ErreurSortante(`Colonne « ${colonneId} » absente de la feuille.`);
  return lignes
    .map((l) => l.map((x) => (x === null || x === undefined ? '' : String(x))))
    .filter((l) => (l[col] ?? '').trim() !== '')
    .slice(0, 20_000)
    .map((l) => ({
      externeId: (l[col] as string).trim().slice(0, 200),
      champs: Object.fromEntries(entetes.map((e, i) => [e, l[i] ?? '']).filter(([e]) => e !== '')),
    }));
}
