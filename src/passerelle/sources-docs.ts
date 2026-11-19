/**
 * GOOGLE DOCS : un document de travail, lu dans le jeu et enrichi depuis le jeu.
 *
 * POURQUOI ON COLLE UN LIEN, ET PAS UNE LISTE. L'API Docs ne sait pas énumérer les documents d'un compte : elle lit
 * un document dont on connaît l'identifiant. Pour en proposer la liste, il faudrait `drive.readonly` ou
 * `drive.metadata.readonly` — RESTREINTES chez Google, donc une évaluation de sécurité annuelle payante, pour une
 * simple liste. On demande donc le lien du document, exactement comme le connecteur Google Sheets demande celui de
 * la feuille. Les deux portées Docs, elles, sont « sensibles » : validation ordinaire, rien à payer.
 * https://developers.google.com/workspace/docs/api/auth
 *
 * CE QUI ENTRE : le titre du document et son texte. Pas les images, pas les commentaires, pas l'historique — le
 * jeu n'est pas un éditeur de texte, et ce qu'il garde doit tenir sur une fiche.
 *
 * CE QUI SORT, ET SEULEMENT CELA : un bloc daté AJOUTÉ À LA FIN. Le jeu n'efface jamais une ligne écrite par
 * quelqu'un et ne réécrit jamais le document : il ajoute à la suite, comme on ajoute une note au bas d'une page.
 * C'est la seule écriture qu'on puisse faire sans risquer de détruire le travail d'autrui, et elle suffit à ce
 * qu'on veut — qu'un compte rendu reparte enrichi de ce qui s'est décidé ici.
 */
import type { Adaptateur, Enregistrement, ValeurSortante } from './sources.ts';
import { appeler, ErreurSortante, type Recuperateur } from './sortant.ts';

type Config = Readonly<Record<string, string>>;
const API = 'https://docs.googleapis.com/v1/documents';
const ID_DOC = /^[A-Za-z0-9_-]{20,100}$/;

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Identifiant d'un document Google à partir de son lien (barre d'adresse ou « Copier le lien »), ou de l'identifiant seul. */
export function idDocumentGoogle(brut: string | undefined): string {
  const t = (brut ?? '').trim();
  if (ID_DOC.test(t)) return t;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new ErreurSortante('Collez le lien du document Google (https://docs.google.com/document/d/…).');
  }
  const m = /^\/document\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/.exec(u.pathname);
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.port !== '' || u.username || u.password || !m || t.length > 2000) {
    throw new ErreurSortante('Lien de document non reconnu : copiez l’adresse du document dans Google Docs (https://docs.google.com/document/d/…).');
  }
  return m[1] as string;
}

/** Le texte d'un document, dans l'ordre où il se lit. Les tableaux et les listes rendent leur texte, pas leur mise en forme. */
export function texteDuDocument(corps: unknown, max = 20_000): string {
  const morceaux: string[] = [];
  const parcourir = (x: unknown, profondeur = 0) => {
    if (profondeur > 12 || morceaux.join('').length > max) return;
    if (Array.isArray(x)) { for (const e of x) parcourir(e, profondeur + 1); return; }
    if (!estObj(x)) return;
    if (typeof x.content === 'string') { morceaux.push(x.content); return; }
    for (const [cle, v] of Object.entries(x)) {
      // `textRun.content` porte le texte ; le reste est de la structure (paragraphes, tableaux, listes)
      if (cle === 'textRun' && estObj(v) && typeof v.content === 'string') morceaux.push(v.content);
      else parcourir(v, profondeur + 1);
    }
  };
  parcourir(corps);
  return morceaux.join('').replace(/\u000b/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

/** Fin du document, pour y ajouter sans rien écraser : le dernier indice connu, moins le saut de ligne final. */
export function finDuDocument(donnees: unknown): number {
  const d = estObj(donnees) ? donnees : {};
  const contenu = estObj(d.body) && Array.isArray(d.body.content) ? d.body.content : [];
  let fin = 1;
  for (const e of contenu) if (estObj(e) && typeof e.endIndex === 'number' && e.endIndex > fin) fin = e.endIndex;
  // l'API refuse d'insérer APRÈS le saut de ligne qui termine le corps : on se place juste avant
  return Math.max(1, fin - 1);
}

const texteSortant = (v: ValeurSortante | undefined): string =>
  (v === null || v === undefined ? '' : String(v)).replace(/\r\n?/g, '\n').slice(0, 10_000);

export const googledocs: Adaptateur = {
  id: 'googledocs', nom: 'Google Docs', categorie: 'Documents', couleur: '#1a73e8',
  description: 'Un document Google lu dans le jeu, et enrichi depuis le jeu : ce qui se décide ici repart à la fin du document.',
  etapes: [
    'Ouvrez le document dans Google Docs et copiez son lien (la barre d’adresse).',
    'Collez-le ici : Living Business lit son titre et son texte.',
    'En « dans les deux sens », ce que vous écrivez ici est ajouté à la fin du document, daté. Rien n’y est jamais effacé.',
  ],
  champs: [
    { id: 'document', libelle: 'Lien du document', aide: 'Copiez le lien du document : la barre d’adresse de Google Docs (https://docs.google.com/document/d/…).', exemple: 'https://docs.google.com/document/d/…/edit', obligatoire: true },
    { id: 'jeton', libelle: 'Connexion', aide: 'Obtenue par « Se connecter avec… ». Chiffrée sur cet ordinateur, jamais affichée.', secret: true, obligatoire: true, mode: 'oauth' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg: Config, secret, f: Recuperateur) {
    if (!secret) throw new ErreurSortante('Connexion Google manquante : cliquez sur « Se connecter avec Google ».');
    const id = idDocumentGoogle(cfg.document);
    const { donnees } = await appeler(f, new URL(`${API}/${encodeURIComponent(id)}`), { entetes: { authorization: `Bearer ${secret}` }, delaiMs: 30_000 });
    const d = estObj(donnees) ? donnees : {};
    const titre = typeof d.title === 'string' && d.title.trim() ? d.title.trim().slice(0, 200) : 'Document sans titre';
    const enr: Enregistrement = {
      externeId: id,
      champs: {
        titre,
        texte: texteDuDocument(d.body),
        emplacement: `https://docs.google.com/document/d/${id}/edit`,
      },
    };
    return [enr];
  },
  /**
   * AJOUTER, JAMAIS RÉÉCRIRE. On relit la fin du document puis on y insère un bloc daté. Le document de la personne
   * reste le sien : aucune de ses lignes n'est touchée, et une erreur de notre côté ne peut pas lui en faire perdre.
   */
  async ecrire(cfg: Config, secret, externeId, valeurs, f: Recuperateur) {
    const texte = texteSortant(valeurs.texte ?? valeurs.note);
    if (!texte.trim()) return externeId;
    if (!secret) throw new ErreurSortante('Connexion Google manquante : reconnectez le document.');
    const id = externeId && ID_DOC.test(externeId) ? externeId : idDocumentGoogle(cfg.document);
    const entetes = { authorization: `Bearer ${secret}` };
    const { donnees } = await appeler(f, new URL(`${API}/${encodeURIComponent(id)}`), { entetes, delaiMs: 30_000 });
    const jour = new Date().toISOString().slice(0, 10);
    const bloc = `\n\nLiving Business — ${jour}\n${texte}\n`;
    await appeler(f, new URL(`${API}/${encodeURIComponent(id)}:batchUpdate`), {
      methode: 'POST', entetes,
      corps: { requests: [{ insertText: { location: { index: finDuDocument(donnees) }, text: bloc } }] },
    });
    return id;
  },
};
