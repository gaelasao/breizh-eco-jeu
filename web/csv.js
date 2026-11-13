/* Living Business — fichiers CSV téléchargés (listes, modèles d'import, liens de formulaire). Module pur.
   Séparateur « ; » (Excel en français), chaque champ entre guillemets (un « ; » ou un retour à la ligne dans un nom ne
   décale plus les colonnes). Un texte qui commencerait une formule (= + - @, tabulation, retour chariot) reçoit une
   apostrophe devant : le tableur l'affiche comme du texte, sans jamais l'exécuter. Un nombre négatif seul
   (« -12,5 ») reste un nombre. Même règle que src/passerelle/tableau.ts (`sansFormule`) pour Excel 365 et Sheets. */

const DEBUT_FORMULE = /^[=+\-@\t\r]/;
const NEGATIF_SEUL = /^-\d+(?:[.,]\d+)?$/;

/** Une cellule : texte neutralisé, entre guillemets, guillemets internes doublés. */
export function celluleCsv(v) {
  const t = String(v ?? '');
  const sur = DEBUT_FORMULE.test(t) && !NEGATIF_SEUL.test(t) ? `'${t}` : t;
  return `"${sur.split('"').join('""')}"`;
}

/** Fichier complet : une ligne par tableau de cellules, fins de ligne CRLF. */
export const texteCsv = (lignes) => `${lignes.map((l) => l.map(celluleCsv).join(';')).join('\r\n')}\r\n`;
