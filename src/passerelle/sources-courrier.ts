/**
 * Courrier en reflet : Gmail et la boîte Outlook (Microsoft 365) apparaissent dans l'écran Courrier du jeu.
 *
 * LE TEXTE DES MESSAGES N'ENTRE JAMAIS DANS LE JEU, et encore moins sur le réseau Breizhcosystem. Ce n'est pas une
 * promesse, c'est la façon dont les appels sont faits :
 * - Gmail est lu avec `format=metadata`, qui, écrit Google, « Returns only email message ID, labels, and email
 *   headers » : le corps n'est pas dans la réponse. Les en-têtes demandés se comptent sur une main : From, Subject,
 *   Date, Message-ID ;
 * - Outlook est lu avec `$select=id,subject,from,receivedDateTime,isRead,webLink` : ni `body` ni `bodyPreview`. En
 *   lecture seule, la permission demandée est `Mail.ReadBasic`, dont Microsoft écrit elle-même qu'elle exclut le
 *   corps, l'aperçu et les pièces jointes.
 * Ce qui entre : l'expéditeur, l'objet, la date, l'état (lu, non lu) et le lien pour ouvrir le message chez l'outil.
 * Le tri en bacs se fait ici, sur l'expéditeur et l'objet, avec les mots-clés de `tri-courrier.ts`.
 *
 * Ce que le jeu peut FAIRE chez l'outil (branchement « dans les deux sens ») : marquer un message comme lu, et
 * l'archiver — rien d'autre. Le jeu n'envoie aucun message et n'en supprime aucun : ni Gmail ni Outlook n'ont été
 * branchés pour ça, et la portée demandée ne le permet pas. Pour répondre, le bouton « Ouvrir dans Gmail » ou
 * « Ouvrir dans Outlook » ouvre le message chez l'outil, où la personne répond comme d'habitude.
 *
 * Documentation lue le 13 novembre 2026 (adresses dans docs/CONNECTEURS.md) :
 * - Gmail : users.messages.list (labelIds, maxResults — `q` est INTERDIT avec la portée gmail.metadata),
 *   users.messages.get (format, metadataHeaders), users.messages.modify (addLabelIds, removeLabelIds ; libellés
 *   système UNREAD et INBOX).
 * - Microsoft Graph : GET /me/mailFolders('inbox')/messages, PATCH /me/messages/{id} (isRead),
 *   POST /me/messages/{id}/move (destinationId, nom de dossier connu `archive`).
 */
import type { Adaptateur, Enregistrement, ValeurSortante } from './sources.ts';
import { pageSuivante } from './sources-agenda.ts';
import { appeler, ErreurSortante, type Recuperateur } from './sortant.ts';
import { ACTION_DU_BAC, bacDe, urgenceDe } from './tri-courrier.ts';

type Config = Readonly<Record<string, string>>;

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Combien de messages récents le reflet montre (un appel par message chez Gmail : on reste raisonnable). */
export const COMBIEN = Object.freeze(['messages25', 'messages50', 'messages100']);
const COMBIEN_DEFAUT = 50;

/** Ce que le jeu fait chez l'outil quand un courrier passe à « traité ». */
export const QUAND_TRAITE = Object.freeze(['rien', 'lu', 'archiver']);

export function combien(cfg: Config): number {
  const n = Number(/^messages(\d{1,3})$/.exec((cfg.combien ?? '').trim())?.[1] ?? NaN);
  return Number.isFinite(n) && n >= 1 && n <= 200 ? n : COMBIEN_DEFAUT;
}

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const texte = (x: unknown, max = 300): string =>
  (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const jeton = (secret: string | null, nom: 'Google' | 'Microsoft'): string => {
  if (!secret) throw new ErreurSortante(`Connexion ${nom} manquante : cliquez sur « Se connecter avec ${nom} ».`);
  return secret;
};
const bearer = (secret: string | null, nom: 'Google' | 'Microsoft') => ({ authorization: `Bearer ${jeton(secret, nom)}` });

/** Date d'un message telle que le jeu la garde (ISO 8601) ; vide si elle est illisible. */
export function dateRecu(x: unknown): string {
  const t = typeof x === 'string' && x.length <= 60 ? Date.parse(x) : typeof x === 'number' ? x : Number.NaN;
  const n = typeof x === 'string' && /^\d{10,16}$/.test(x) ? Number(x) : t;
  return Number.isFinite(n) ? new Date(n).toISOString() : '';
}

/**
 * Nom lisible d'un expéditeur : « Kerlann Bois <kerlann@exemple.fr> » → « Kerlann Bois ». Sans nom, l'adresse seule.
 * Les chevrons sont retirés pour qu'aucune adresse ne ressemble à une balise à l'écran.
 */
export function nomExpediteur(brut: string): string {
  const t = texte(brut, 200);
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]*)>\s*$/.exec(t);
  if (m) return texte(m[1], 120) || texte(m[2], 120);
  return t.replace(/[<>]/g, '').slice(0, 120);
}

/** Une fiche de courrier à partir de ce qu'on sait : expéditeur, objet, date, lu, lien. Le tri est fait ici. */
export function ficheCourrier(a: { id: string; expediteur: string; objet: string; recuLe: string; lu: boolean; lien: string }): Enregistrement {
  const pourLeTri = `${a.expediteur} ${a.objet}`;
  const bac = bacDe(pourLeTri);
  return {
    externeId: a.id,
    champs: {
      expediteur: nomExpediteur(a.expediteur) || 'Expéditeur inconnu',
      objet: a.objet || '(sans objet)',
      // aucun résumé : le texte du message n'entre pas dans le jeu. L'action proposée tient lieu de repère.
      resume: '',
      bac,
      urgence: urgenceDe(pourLeTri, bac),
      recu_le: a.recuLe,
      action: ACTION_DU_BAC[bac],
      statut: a.lu ? 'traité' : 'à traiter',
      lien: a.lien,
    },
  };
}

/** Adresse web vérifiée (bouton « Ouvrir dans… ») ; vide si elle ne mène pas à l'outil attendu. */
function lienOutil(x: unknown, hotes: readonly string[]): string {
  if (typeof x !== 'string' || x.length > 2000) return '';
  try {
    const u = new URL(x);
    return u.protocol === 'https:' && !u.username && !u.password && hotes.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.toString() : '';
  } catch { return ''; }
}

const CHAMPS_COMMUNS = [
  { id: 'combien', libelle: 'Messages montrés', aide: 'Les plus récents de votre boîte de réception.', choix: COMBIEN, obligatoire: true },
  { id: 'quandTraite', libelle: 'Quand un courrier passe à « traité »', aide: 'Ce que Living Business fait alors dans votre boîte. Sans synchronisation « dans les deux sens », rien n’est fait.', choix: QUAND_TRAITE },
] as const;

/** Faut-il toucher à la boîte, et jusqu'où ? */
const quandTraite = (cfg: Config): 'rien' | 'lu' | 'archiver' => {
  const v = (cfg.quandTraite ?? '').trim();
  return v === 'rien' || v === 'archiver' ? v : 'lu';
};
/** Un courrier passé à « traité » dans le jeu ? (le seul changement que le jeu renvoie à une boîte) */
const estTraite = (valeurs: Record<string, ValeurSortante>): boolean => String(valeurs.statut ?? '').trim().toLowerCase() === 'traité';

// ---------------------------------------------------------------- Gmail

const ID_GMAIL = /^[0-9a-f]{1,32}$/i;
/** En-têtes demandés à Gmail : rien de plus que ce que l'écran Courrier montre. */
const ENTETES_GMAIL = ['From', 'Subject', 'Date', 'Message-ID'];

/** Valeur d'un en-tête dans la réponse de Gmail (`payload.headers`), insensible à la casse. */
export function enteteGmail(payload: unknown, nom: string): string {
  const liste = estObj(payload) && Array.isArray(payload.headers) ? payload.headers : [];
  const bas = nom.toLowerCase();
  for (const h of liste) if (estObj(h) && typeof h.name === 'string' && h.name.toLowerCase() === bas) return texte(h.value, 400);
  return '';
}

/**
 * Lien vers le message chez Gmail. Google ne documente AUCUNE adresse d'interface : ce qui est documenté, c'est
 * l'opérateur de recherche `rfc822msgid:` (page users.messages.list). Le bouton ouvre donc une recherche Gmail sur
 * l'identifiant du message — ce qui l'affiche —, et jamais une adresse devinée.
 */
export function lienGmail(messageId: string): string {
  const id = messageId.replace(/^<|>$/g, '').trim();
  if (!id || id.length > 400 || /[\u0000-\u001f\s]/.test(id)) return '';
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`rfc822msgid:${id}`)}`;
}

export const gmail: Adaptateur = {
  id: 'gmail', nom: 'Gmail', categorie: 'Courrier', couleur: '#ea4335',
  description: 'Vos messages Gmail récents dans l’écran Courrier : expéditeur, objet et date, triés dans vos bacs. Le texte des messages reste chez Gmail.',
  etapes: [
    'Cliquez sur « Se connecter avec Google » et choisissez votre compte.',
    'Choisissez combien de messages récents montrer.',
    'C’est tout : ils arrivent dans Courrier, triés comme le reste.',
  ],
  champs: CHAMPS_COMMUNS,
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const entetes = bearer(secret, 'Google');
    const n = combien(cfg);
    const u = new URL(`${GMAIL}/messages`);
    // labelIds (et non `q`) : avec la portée en lecture seule gmail.metadata, Google interdit le paramètre `q`
    u.searchParams.set('labelIds', 'INBOX');
    u.searchParams.set('maxResults', String(n));
    const { donnees } = await appeler(f, u, { entetes, delaiMs: 30_000 });
    const liste = Array.isArray((estObj(donnees) ? donnees : {}).messages) ? (donnees as { messages: unknown[] }).messages : [];
    const res: Enregistrement[] = [];
    for (const m of liste.slice(0, n)) {
      const id = estObj(m) && typeof m.id === 'string' && ID_GMAIL.test(m.id) ? m.id : '';
      if (!id) continue;
      const d = new URL(`${GMAIL}/messages/${encodeURIComponent(id)}`);
      // format=metadata : Google ne renvoie alors QUE l'identifiant, les libellés et les en-têtes demandés
      d.searchParams.set('format', 'metadata');
      for (const h of ENTETES_GMAIL) d.searchParams.append('metadataHeaders', h);
      const { donnees: msg } = await appeler(f, d, { entetes });
      const x = estObj(msg) ? msg : {};
      const libelles = Array.isArray(x.labelIds) ? x.labelIds : [];
      res.push(ficheCourrier({
        id,
        expediteur: enteteGmail(x.payload, 'From'),
        objet: texte(enteteGmail(x.payload, 'Subject'), 160),
        recuLe: dateRecu(x.internalDate) || dateRecu(enteteGmail(x.payload, 'Date')),
        lu: !libelles.includes('UNREAD'),
        lien: lienGmail(enteteGmail(x.payload, 'Message-ID')),
      }));
    }
    return res;
  },
  /**
   * Le jeu ne crée JAMAIS de message : sans identifiant, il n'y a rien à faire. Sur un message existant, le seul
   * changement renvoyé est « traité » : lu, et archivé si la personne l'a demandé.
   */
  async ecrire(cfg, secret, externeId, valeurs, f) {
    if (!externeId || !ID_GMAIL.test(externeId)) return externeId;
    const quoi = quandTraite(cfg);
    if (quoi === 'rien' || !estTraite(valeurs)) return externeId;
    const retirer = quoi === 'archiver' ? ['UNREAD', 'INBOX'] : ['UNREAD'];
    await appeler(f, new URL(`${GMAIL}/messages/${encodeURIComponent(externeId)}/modify`), { methode: 'POST', entetes: bearer(secret, 'Google'), corps: { removeLabelIds: retirer } });
    return externeId;
  },
};

// ---------------------------------------------------------------- boîte Outlook (Microsoft 365)

const ID_GRAPH = /^[A-Za-z0-9_=\-/+%.]{1,1800}$/;

export const outlook: Adaptateur = {
  id: 'outlook', nom: 'Courrier Outlook (Microsoft 365)', categorie: 'Courrier', couleur: '#0078d4',
  description: 'Vos messages Outlook récents dans l’écran Courrier : expéditeur, objet et date, triés dans vos bacs. Le texte des messages reste chez Microsoft.',
  etapes: [
    'Cliquez sur « Se connecter avec Microsoft » et choisissez votre compte professionnel.',
    'Choisissez combien de messages récents montrer.',
    'C’est tout : ils arrivent dans Courrier, triés comme le reste.',
  ],
  champs: CHAMPS_COMMUNS,
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const entetes = bearer(secret, 'Microsoft');
    const n = combien(cfg);
    const res: Enregistrement[] = [];
    let u: URL | null = new URL(`${GRAPH}/me/mailFolders('inbox')/messages`);
    // ni `body` ni `bodyPreview` : le texte des messages ne descend pas, même quand la permission le permettrait
    u.searchParams.set('$select', 'id,subject,from,receivedDateTime,isRead,webLink');
    u.searchParams.set('$orderby', 'receivedDateTime desc');
    u.searchParams.set('$top', String(Math.min(n, 100)));
    for (let page = 0; page < 5 && u && res.length < n; page++) {
      const { donnees }: { donnees: unknown } = await appeler(f, u, { entetes, delaiMs: 30_000 });
      const d = estObj(donnees) ? donnees : {};
      for (const m of Array.isArray(d.value) ? d.value : []) {
        if (!estObj(m) || typeof m.id !== 'string' || !ID_GRAPH.test(m.id)) continue;
        const de = estObj(m.from) && estObj(m.from.emailAddress) ? m.from.emailAddress : {};
        res.push(ficheCourrier({
          id: m.id,
          expediteur: texte(de.name, 120) || texte(de.address, 160),
          objet: texte(m.subject, 160),
          recuLe: dateRecu(m.receivedDateTime),
          lu: m.isRead === true,
          lien: lienOutil(m.webLink, ['outlook.office365.com', 'outlook.office.com', 'outlook.com']),
        }));
      }
      u = pageSuivante(d['@odata.nextLink']);
    }
    return res.slice(0, n);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    if (!externeId || !ID_GRAPH.test(externeId)) return externeId;
    const quoi = quandTraite(cfg);
    if (quoi === 'rien' || !estTraite(valeurs)) return externeId;
    const entetes = bearer(secret, 'Microsoft');
    const id = encodeURIComponent(externeId);
    await appeler(f, new URL(`${GRAPH}/me/messages/${id}`), { methode: 'PATCH', entetes, corps: { isRead: true } });
    // « archive » est l'un des noms de dossier connus de Microsoft : celui du bouton « Archiver » d'Outlook.
    // Un message déplacé change d'identifiant chez Microsoft ; il quitte la boîte de réception et n'est plus relu.
    if (quoi === 'archiver') await appeler(f, new URL(`${GRAPH}/me/messages/${id}/move`), { methode: 'POST', entetes, corps: { destinationId: 'archive' } });
    return externeId;
  },
};

export const COURRIERS = { gmail, outlook } as const;
