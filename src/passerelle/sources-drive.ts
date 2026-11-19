/**
 * GOOGLE DRIVE : déposer un document dans le Drive de l'entreprise, et relire ce qui y a été déposé.
 *
 * UNE SEULE PORTÉE, ET LA PLUS ÉTROITE : `drive.file`. Google la classe NON SENSIBLE — validation la plus légère,
 * rien à payer, ni maintenant ni chaque année. Elle donne accès aux fichiers que CETTE application a créés, et à eux
 * seuls. Living Business ne voit donc rien de ce qui était déjà dans le Drive, et c'est voulu : lire le reste
 * exigerait `drive.readonly`, RESTREINTE, que Google n'ouvre qu'à certaines catégories d'applications et qui
 * déclenche une évaluation de sécurité annuelle payante.
 * https://developers.google.com/workspace/drive/api/guides/api-specific-auth
 *
 * CE QUE ÇA VEUT DIRE À L'USAGE. Le premier branchement ne ramène rien : il n'y a encore rien de déposé, et ce n'est
 * pas une panne. Dès qu'un document part d'ici, il apparaît dans la liste avec son lien — et ce lien revient dans la
 * fiche du jeu, au champ « Où le trouver ». C'est tout l'intérêt : le registre des papiers cesse de dire « classeur
 * bleu » et dit où est le fichier.
 *
 * LES TROIS CHAMPS, ET PAS D'AUTRES : `nom`, `emplacement`, `note`. Ce sont ceux du type « Document » du jeu. Un
 * connecteur qui rend des champs que rien ne reçoit n'est pas branchable : mieux vaut trois champs qui tombent juste
 * que six qui attendent une correspondance. La date de dernière modification et la taille se lisent dans la note —
 * elles renseignent, mais elles ne sont pas la date de validité d'un papier, et les confondre ferait expirer des
 * attestations valables.
 *
 * TÉLÉVERSEMENT EN DEUX TEMPS : la fiche du fichier (nom, type), puis son contenu. Un appel de plus qu'un envoi
 * « multipart », mais sans frontière à fabriquer à la main — et une frontière mal échappée, c'est un fichier
 * corrompu chez quelqu'un.
 */
import type { Adaptateur, Enregistrement, ValeurSortante } from './sources.ts';
import { appeler, CorpsBrut, ErreurSortante, type Recuperateur } from './sortant.ts';

type Config = Readonly<Record<string, string>>;
const API = 'https://www.googleapis.com/drive/v3/files';
const ENVOI = 'https://www.googleapis.com/upload/drive/v3/files';
const ID_FICHIER = /^[A-Za-z0-9_-]{10,100}$/;
const TAILLE_MAX_DEPOT = 2_000_000;

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const texte = (x: unknown, max = 300): string =>
  (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Combien de fichiers déposés la liste montre. Au-delà, c'est un espace de stockage, pas un registre. */
export const COMBIEN = Object.freeze(['fichiers25', 'fichiers50', 'fichiers100']);
export function combien(cfg: Config): number {
  const n = Number(/^fichiers(\d{1,3})$/.exec((cfg.combien ?? '').trim())?.[1] ?? NaN);
  return Number.isFinite(n) && n >= 1 && n <= 200 ? n : 50;
}

/** Nom de fichier sûr : ni chemin, ni caractère de contrôle. Vide : un nom daté, pour ne jamais écrire « undefined ». */
export function nomFichier(brut: unknown): string {
  const t = texte(brut, 120).replace(/[/\\]/g, '-').trim();
  return t || `Living Business — ${new Date().toISOString().slice(0, 10)}`;
}

/** Taille lisible : Google la rend en octets, dans une chaîne. */
export function tailleLisible(brut: unknown): string {
  const n = Number(brut);
  if (!Number.isFinite(n) || n < 0 || brut === null || brut === undefined || brut === '') return '';
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} ko`;
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} Mo`;
}

/**
 * Une fiche par fichier déposé. `note` dit ce qu'on sait du fichier en une phrase lisible plutôt qu'en cinq champs
 * que le jeu n'a pas : taille et dernière modification renseignent, sans jamais passer pour une date de validité.
 */
export function ficheFichier(f: Record<string, unknown>): Enregistrement {
  const id = typeof f.id === 'string' ? f.id : '';
  const taille = tailleLisible(f.size);
  const modifie = typeof f.modifiedTime === 'string' ? f.modifiedTime.slice(0, 10) : '';
  const note = [taille, modifie ? `modifié le ${modifie}` : ''].filter(Boolean).join(' — ');
  return {
    externeId: id,
    champs: {
      nom: texte(f.name, 200) || 'Document sans nom',
      emplacement: typeof f.webViewLink === 'string' && f.webViewLink.startsWith('https://') ? f.webViewLink
        : id ? `https://drive.google.com/file/d/${id}/view` : '',
      note: note ? `Déposé dans Google Drive (${note}).` : 'Déposé dans Google Drive.',
    },
  };
}

/**
 * Ce que contient le fichier déposé : la fiche du jeu, en clair. `emplacement` est écarté — c'est le lien du fichier
 * lui-même, l'écrire dedans ne renseignerait personne.
 */
const LIBELLES_DEPOT: Readonly<Record<string, string>> = {
  nom: 'Nom', note: 'Note', categorie: 'Catégorie', organisme: 'Organisme', valide_jusqu_au: 'Valide jusqu’au', departement: 'Département',
};
const libelleDepot = (cle: string): string =>
  LIBELLES_DEPOT[cle] ?? `${cle.charAt(0).toUpperCase()}${cle.slice(1).replace(/_/g, ' ')}`;

export function contenuDepot(valeurs: Record<string, ValeurSortante>): string {
  const lignes = Object.entries(valeurs)
    .filter(([cle, v]) => cle !== 'emplacement' && v !== null && v !== undefined && String(v).trim() !== '')
    .map(([cle, v]) => `${libelleDepot(cle)} : ${String(v).trim()}`);
  return lignes.length ? `Living Business — ${new Date().toISOString().slice(0, 10)}\n\n${lignes.join('\n')}\n` : '';
}

export const googledrive: Adaptateur = {
  id: 'googledrive', nom: 'Google Drive', categorie: 'Documents', couleur: '#1a73e8',
  description: 'Déposez vos documents dans votre Google Drive depuis Living Business, et retrouvez ici le lien de chacun. Rien de ce qui est déjà dans votre Drive n’est lu.',
  etapes: [
    'Connectez votre compte Google : Living Business n’obtient accès qu’aux fichiers qu’il dépose lui-même.',
    'En « dans les deux sens », chaque document du jeu est déposé dans votre Drive.',
    'Le lien du fichier revient dans la fiche, au champ « Où le trouver ». Vos fichiers déjà présents dans Drive ne sont jamais lus.',
  ],
  champs: [
    { id: 'combien', libelle: 'Combien de fichiers', aide: 'Les plus récents, parmi ceux que Living Business a déposés.', choix: [...COMBIEN] },
    { id: 'jeton', libelle: 'Connexion', aide: 'Obtenue par « Se connecter avec… ». Chiffrée sur cet ordinateur, jamais affichée.', secret: true, obligatoire: true, mode: 'oauth' },
  ],
  lecture: 'appel',
  ecriture: true,
  /**
   * Les fichiers déposés par Living Business, les plus récents d'abord. Avec `drive.file`, Google ne renvoie QUE
   * ceux-là : rien à filtrer de notre côté, et rien d'autre ne peut remonter par mégarde.
   */
  async lire(cfg: Config, secret, f: Recuperateur) {
    if (!secret) throw new ErreurSortante('Connexion Google manquante : cliquez sur « Se connecter avec Google ».');
    const u = new URL(API);
    u.searchParams.set('q', 'trashed = false');
    u.searchParams.set('orderBy', 'modifiedTime desc');
    u.searchParams.set('pageSize', String(Math.min(combien(cfg), 100)));
    u.searchParams.set('fields', 'files(id,name,mimeType,modifiedTime,size,webViewLink)');
    const { donnees } = await appeler(f, u, { entetes: { authorization: `Bearer ${secret}` }, delaiMs: 30_000 });
    const d = estObj(donnees) ? donnees : {};
    const liste = Array.isArray(d.files) ? d.files : [];
    return liste.filter(estObj).slice(0, combien(cfg)).map(ficheFichier).filter((e) => e.externeId);
  },
  /**
   * Déposer. Un fichier déjà déposé est remplacé par le contenu à jour ; un document encore inconnu est créé. Fiche
   * d'abord, contenu ensuite. Rien à écrire, rien n'est touché : on ne crée pas un fichier vide dans le Drive de
   * quelqu'un, et un échec à mi-chemin laisse au pire un fichier nommé mais vide, jamais un fichier écrasé à tort.
   */
  async ecrire(cfg: Config, secret, externeId, valeurs: Record<string, ValeurSortante>, f: Recuperateur) {
    const contenu = contenuDepot(valeurs);
    if (!contenu) return externeId;
    if (!secret) throw new ErreurSortante('Connexion Google manquante : reconnectez votre Drive.');
    const entetes = { authorization: `Bearer ${secret}` };
    let id = externeId && ID_FICHIER.test(externeId) ? externeId : '';
    if (!id) {
      const { donnees } = await appeler(f, new URL(API), {
        methode: 'POST', entetes, corps: { name: `${nomFichier(valeurs.nom)}.txt`, mimeType: 'text/plain' },
      });
      const d = estObj(donnees) ? donnees : {};
      id = typeof d.id === 'string' && ID_FICHIER.test(d.id) ? d.id : '';
      if (!id) throw new ErreurSortante('Google Drive n’a pas rendu l’identifiant du fichier qu’il vient de créer.');
    }
    const u = new URL(`${ENVOI}/${encodeURIComponent(id)}`);
    u.searchParams.set('uploadType', 'media');
    await appeler(f, u, {
      methode: 'PATCH', entetes, delaiMs: 30_000,
      corps: new CorpsBrut('text/plain; charset=utf-8', contenu.slice(0, TAILLE_MAX_DEPOT)),
    });
    return id;
  },
};
