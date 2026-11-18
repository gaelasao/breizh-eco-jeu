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
 * Ce que le jeu peut FAIRE chez l'outil (branchement « dans les deux sens ») : marquer un message comme lu,
 * l'archiver, et PRÉPARER UN BROUILLON de réponse — rien d'autre.
 *
 * LE JEU N'ENVOIE AUCUN MESSAGE. Le brouillon est déposé dans la messagerie, dans le fil du message d'origine ; la
 * personne l'ouvre, le relit et appuie sur Envoyer. Ce n'est pas une politesse : un logiciel qui écrirait aux
 * clients de quelqu'un, sous son nom, sans qu'il ait lu, serait dangereux — et il suffit d'une phrase mal tournée
 * pour le découvrir trop tard. Le brouillon laisse le dernier mot à la personne par construction.
 * C'est aussi vrai des droits demandés : `gmail.modify` et `Mail.ReadWrite`, que le branchement « dans les deux
 * sens » demande déjà, suffisent à déposer un brouillon. `Mail.Send`, qui enverrait, n'est jamais demandé.
 *
 * L'adresse du destinataire n'entre pas dans le jeu : la fiche ne garde qu'un nom, et l'adresse est relue chez
 * l'outil au moment d'écrire le brouillon (Gmail), ou jamais vue du tout (Outlook la remplit lui-même avec
 * `createReply`).
 *
 * Documentation lue le 13 novembre 2026 (adresses dans docs/CONNECTEURS.md) :
 * - Gmail : users.messages.list (labelIds, maxResults — `q` est INTERDIT avec la portée gmail.metadata),
 *   users.messages.get (format, metadataHeaders), users.messages.modify (addLabelIds, removeLabelIds ; libellés
 *   système UNREAD et INBOX).
 * - Microsoft Graph : GET /me/mailFolders('inbox')/messages, PATCH /me/messages/{id} (isRead),
 *   POST /me/messages/{id}/move (destinationId, nom de dossier connu `archive`).
 */
import type { Adaptateur, Enregistrement, ValeurSortante } from './sources.ts';
import { dateJeu, pageSuivante } from './sources-agenda.ts';
import { appeler, ErreurSortante, type Recuperateur } from './sortant.ts';
import { ACTION_DU_BAC, bacDe, type RangementOutil, urgenceDe } from './tri-courrier.ts';

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

/**
 * Date d'un message telle que le jeu la garde : « 2026-11-20T10:40 », à la minute et dans le fuseau de l'entreprise,
 * comme pour un rendez-vous. Vide si elle est illisible.
 *
 * POURQUOI PAS L'ISO COMPLET. Un champ « date » du jeu tient un jour, ou un jour et une heure à la minute — c'est
 * tout ce que `convertir()` accepte, et c'est ce qui se lit à l'écran. Un instant complet (« …T10:40:00.000Z ») était
 * refusé ligne après ligne : la boîte était branchée, relue, sans erreur visible, et vide. Un connecteur qui écrit
 * une valeur que le champ ne sait pas tenir ne rate pas une ligne, il rate tout.
 */
export function dateRecu(x: unknown): string {
  // Gmail donne des millisecondes (`internalDate`), Microsoft une date ISO : les deux mènent au même instant
  const brut = typeof x === 'string' && /^\d{10,16}$/.test(x.trim()) ? Number(x.trim()) : x;
  return dateJeu(brut);
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

/**
 * Les catégories de Gmail, telles qu'elles arrivent dans les libellés de chaque message. Google les calcule pour sa
 * propre boîte (ce sont les onglets « Promotions », « Réseaux sociaux » et « Forums ») : rien à demander de plus,
 * aucune permission supplémentaire, et c'est plus juste qu'une liste de mots écrite ici.
 * Documentation : https://developers.google.com/gmail/api/guides/labels (libellés système CATEGORY_*).
 */
const CATEGORIES_PUB_GMAIL = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'];

/** Ce que Gmail dit lui-même du message : publicité, ou rien. */
export const rangementGmail = (libelles: readonly unknown[]): RangementOutil =>
  (libelles.some((l) => typeof l === 'string' && CATEGORIES_PUB_GMAIL.includes(l)) ? 'publicite' : null);

/** Une fiche de courrier à partir de ce qu'on sait : expéditeur, objet, date, lu, lien. Le tri est fait ici. */
export function ficheCourrier(a: { id: string; expediteur: string; objet: string; recuLe: string; lu: boolean; lien: string; rangeParLOutil?: RangementOutil }): Enregistrement {
  const pourLeTri = `${a.expediteur} ${a.objet}`;
  const bac = bacDe(pourLeTri, a.rangeParLOutil ?? null);
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


/**
 * UN BROUILLON, JAMAIS UN ENVOI. Le jeu prépare la réponse chez l'outil ; c'est la personne qui la relit et appuie
 * sur Envoyer, dans sa messagerie. Ce n'est pas une précaution de façade : un logiciel qui écrirait à la place de
 * quelqu'un, à ses clients, sous son nom, sans qu'il ait lu, serait un logiciel dangereux. Le brouillon lui laisse
 * le dernier mot par construction, et ne demande aucun droit de plus que ce que le branchement a déjà.
 *
 * L'ADRESSE DU DESTINATAIRE N'ENTRE PAS DANS LE JEU. Elle est relue chez l'outil au moment d'écrire le brouillon,
 * à partir de l'identifiant du message, et elle reste dans l'appel : la fiche de courrier ne garde qu'un nom.
 */

/** Plié en lignes de 76 caractères comme l'exige le base64 d'un message (RFC 2045 §6.8). */
const base64url = (t: string): string => Buffer.from(t, 'utf8').toString('base64url');

/** En-tête RFC 2822 sans retour à la ligne injecté : une valeur ne peut pas en ajouter d'autres. */
const entete = (nom: string, valeur: string): string => `${nom}: ${valeur.replace(/[\r\n]+/g, ' ').slice(0, 400)}`;

/** « Re: » une seule fois, quoi qu'ait écrit l'expéditeur. */
export function objetReponse(objet: string): string {
  const o = texte(objet, 160);
  return /^re\s*:/i.test(o) ? o : `Re: ${o}`;
}

/** Le texte de la réponse, borné : un brouillon n'est pas un envoi de fichier. */
export const MAX_BROUILLON = 10_000;
const corpsReponse = (t: unknown): string => {
  const v = typeof t === 'string' ? t.replace(/\r\n?/g, '\n').trim() : '';
  if (!v) throw new ErreurSortante('Écrivez votre réponse avant de préparer le brouillon.');
  return v.slice(0, MAX_BROUILLON);
};

/**
 * LA RÉPONSE, FABRIQUÉE UNE SEULE FOIS. Brouillon et envoi partent du même message : même fil, même objet, même
 * destinataire. S'ils divergeaient, on relâcherait un jour un envoi différent de ce qui a été relu — et c'est
 * précisément ce qu'il ne faut pas.
 *
 * L'adresse du destinataire et le fil sont relus CHEZ GOOGLE au moment d'écrire, à partir de l'identifiant du
 * message : la fiche de courrier ne garde qu'un nom, et l'adresse ne fait que passer.
 */
async function reponseGmail(secret: string | null, externeId: string, texteReponse: string, f: Recuperateur) {
  if (!ID_GMAIL.test(externeId)) throw new ErreurSortante('Ce courrier ne vient pas de Gmail.');
  const corps = corpsReponse(texteReponse);
  const entetes = bearer(secret, 'Google');
  const d = new URL(`${GMAIL}/messages/${encodeURIComponent(externeId)}`);
  d.searchParams.set('format', 'metadata');
  for (const h of ENTETES_GMAIL) d.searchParams.append('metadataHeaders', h);
  const { donnees } = await appeler(f, d, { entetes });
  const x = estObj(donnees) ? donnees : {};
  const de = enteteGmail(x.payload, 'From');
  if (!de) throw new ErreurSortante('Gmail n’a pas rendu l’expéditeur de ce message : réponse impossible.');
  const messageId = enteteGmail(x.payload, 'Message-ID');
  const brut = [
    entete('To', de),
    entete('Subject', objetReponse(enteteGmail(x.payload, 'Subject'))),
    ...(messageId ? [entete('In-Reply-To', messageId), entete('References', messageId)] : []),
    'Content-Type: text/plain; charset=UTF-8',
    'MIME-Version: 1.0',
    '',
    corps,
  ].join('\r\n');
  const message: Record<string, unknown> = { raw: base64url(brut) };
  if (typeof x.threadId === 'string' && ID_GMAIL.test(x.threadId)) message.threadId = x.threadId;
  return { entetes, message };
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
  // `mode: 'oauth'` : ce jeton vient de « Se connecter avec… » et de nulle part ailleurs. Il n'est jamais montré, et
  // le catalogue n'y voit pas une clé qu'on pourrait coller : sans relais ouvert, la boîte n'est donc pas proposée.
  { id: 'jeton', libelle: 'Connexion', aide: 'Obtenue par « Se connecter avec… ». Chiffrée sur cet ordinateur, jamais affichée.', secret: true, obligatoire: true, mode: 'oauth' },
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
        // Google a déjà rangé ce message dans un de ses onglets : on le croit plutôt que de le deviner
        rangeParLOutil: rangementGmail(libelles),
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
  /**
   * Brouillon de réponse dans Gmail, dans le fil du message d'origine (`threadId`, `In-Reply-To`, `References` :
   * sans eux la réponse ouvrirait une conversation à part). La portée `gmail.modify`, celle que le branchement
   * « dans les deux sens » demande déjà, suffit : `users.drafts.create` l'accepte (documentation lue le
   * 18 novembre 2026). Rien n'est envoyé : `drafts.create` dépose, `drafts.send` enverrait, et il n'est pas appelé.
   */
  async brouillon(cfg, secret, externeId, texteReponse, f) {
    const { entetes, message } = await reponseGmail(secret, externeId, texteReponse, f);
    const { donnees: cree } = await appeler(f, new URL(`${GMAIL}/drafts`), { methode: 'POST', entetes, corps: { message } });
    const id = estObj(cree) && typeof cree.id === 'string' ? cree.id : '';
    return { lien: id && ID_GMAIL.test(id) ? `https://mail.google.com/mail/u/0/#drafts?compose=${encodeURIComponent(id)}` : 'https://mail.google.com/mail/u/0/#drafts' };
  },
  /**
   * ENVOYER, pour de bon. Le message est fabriqué exactement comme le brouillon — même fonction, même fil, même
   * destinataire relu chez Google — et part par `users.messages.send`, que `gmail.modify` autorise déjà
   * (documentation lue le 18 novembre 2026). Aucun droit nouveau à demander chez Google : c'est l'écran, et lui
   * seul, qui fait la différence entre préparer et envoyer. Il demande confirmation avant.
   */
  async envoyer(cfg, secret, externeId, texteReponse, f) {
    const { entetes, message } = await reponseGmail(secret, externeId, texteReponse, f);
    const { donnees: parti } = await appeler(f, new URL(`${GMAIL}/messages/send`), { methode: 'POST', entetes, corps: message });
    const id = estObj(parti) && typeof parti.id === 'string' && ID_GMAIL.test(parti.id) ? parti.id : '';
    return { lien: id ? `https://mail.google.com/mail/u/0/#sent/${encodeURIComponent(id)}` : 'https://mail.google.com/mail/u/0/#sent' };
  },
};

// ---------------------------------------------------------------- boîte Outlook (Microsoft 365)

/**
 * LA RÉPONSE OUTLOOK, FABRIQUÉE UNE SEULE FOIS, brouillon et envoi confondus. `createReply` laisse Microsoft
 * préparer le fil, le destinataire et l'objet : l'adresse ne passe donc jamais par ici. Il ne reste qu'à écrire.
 */
async function reponseOutlook(secret: string | null, externeId: string, texteReponse: string, f: Recuperateur) {
  if (!ID_GRAPH.test(externeId)) throw new ErreurSortante('Ce courrier ne vient pas d’Outlook.');
  const corps = corpsReponse(texteReponse);
  const entetes = bearer(secret, 'Microsoft');
  const { donnees } = await appeler(f, new URL(`${GRAPH}/me/messages/${encodeURIComponent(externeId)}/createReply`), { methode: 'POST', entetes, corps: {} });
  const d = estObj(donnees) ? donnees : {};
  const id = typeof d.id === 'string' && ID_GRAPH.test(d.id) ? d.id : '';
  if (!id) throw new ErreurSortante('Outlook n’a pas rendu le brouillon qu’il vient de créer.');
  await appeler(f, new URL(`${GRAPH}/me/messages/${encodeURIComponent(id)}`), { methode: 'PATCH', entetes, corps: { body: { contentType: 'Text', content: corps } } });
  return { id, lien: lienOutil(d.webLink, ['outlook.office365.com', 'outlook.office.com', 'outlook.com']) };
}


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
  /**
   * Brouillon de réponse dans Outlook. `createReply` fait le plus délicat : Microsoft prépare lui-même le
   * brouillon dans le fil, avec le bon destinataire et le bon objet — l'adresse ne passe donc jamais par ici. Il
   * ne reste qu'à écrire le texte. `Mail.ReadWrite`, que le branchement « dans les deux sens » demande déjà,
   * suffit (documentation lue le 18 novembre 2026) : aucun droit nouveau, et surtout pas `Mail.Send`, qui
   * enverrait. Le brouillon attend dans Outlook que la personne le relise.
   */
  async brouillon(cfg, secret, externeId, texteReponse, f) {
    const { lien } = await reponseOutlook(secret, externeId, texteReponse, f);
    return { lien: lien || 'https://outlook.office.com/mail/drafts' };
  },
  /**
   * ENVOYER, pour de bon. Le brouillon est fabriqué exactement comme ci-dessus, puis envoyé par
   * `POST /me/messages/{id}/send`, qui n'envoie qu'un brouillon existant et le range dans « Éléments envoyés »
   * (documentation lue le 18 novembre 2026). Ce dernier appel demande `Mail.Send`, que `Mail.ReadWrite` ne couvre
   * pas : une boîte branchée avant que ce droit soit demandé échoue ici, et il faut la rebrancher. Le message
   * reste alors en brouillon chez Outlook — rien n'est perdu, et c'est ce que dit l'erreur.
   */
  async envoyer(cfg, secret, externeId, texteReponse, f) {
    const { id, lien } = await reponseOutlook(secret, externeId, texteReponse, f);
    const entetes = bearer(secret, 'Microsoft');
    try {
      await appeler(f, new URL(`${GRAPH}/me/messages/${encodeURIComponent(id)}/send`), { methode: 'POST', entetes, corps: {} });
    } catch (e) {
      const statut = e instanceof ErreurSortante ? e.statut : 0;
      if (statut === 401 || statut === 403) {
        throw new ErreurSortante('Microsoft refuse l’envoi : cette boîte n’a pas le droit d’envoyer. Votre réponse est gardée en brouillon dans Outlook — rien n’est perdu, vous pouvez l’envoyer de là. Pour envoyer d’ici : rebranchez la boîte (Réglages → Outils branchés → « Se reconnecter »), en acceptant l’envoi. Si le refus revient, c’est que ce droit n’est pas encore ouvert sur votre Breizhcosystem.', statut);
      }
      throw e;
    }
    return { lien: lien || 'https://outlook.office.com/mail/sentitems' };
  },
};

export const COURRIERS = { gmail, outlook } as const;
