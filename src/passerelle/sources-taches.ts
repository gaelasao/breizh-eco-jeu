/**
 * Tâches : Google Tasks et Microsoft To Do, dans les deux sens.
 *
 * Ce que la personne fait : « Se connecter avec Google » (ou Microsoft), puis elle choisit DANS QUELLE liste du compte
 * (il y en a souvent plusieurs : la sienne, les courses, le chantier) et si les tâches déjà terminées doivent entrer.
 * Rien d'autre. Les tâches de cette liste arrivent dans l'écran Tâches ; une tâche créée ici part dans cette même
 * liste, et une tâche cochée ici y est cochée aussi. L'anti-boucle est celui de tous les connecteurs (`synchro.ts`) :
 * l'empreinte d'une fiche est notée après chaque échange, et rien ne repart tant qu'elle n'a pas changé.
 *
 * Ce qui entre dans le jeu : le titre, l'échéance, l'état (à faire, en cours, bloquée, terminée) et le lien vers la
 * tâche chez l'outil. JAMAIS LES NOTES d'une tâche : un intitulé suffit à savoir quoi faire, et le texte d'une note
 * contient souvent tout autre chose (un mot de passe, le prix d'un devis, une adresse). Google n'a pas de portée
 * « sans les notes » comme Gmail en a une « sans le corps » : ce sont donc les appels qui les laissent chez l'outil —
 * `fields` chez Google, `$select` chez Microsoft, et `notes`/`body` ne sont dans ni l'un ni l'autre.
 *
 * Une échéance n'a pas d'heure, ni chez l'un ni chez l'autre : Google écrit lui-même que seule la date est gardée, et
 * le jeu n'enregistre donc que « 2026-11-20 ».
 *
 * Documentation lue le 15 novembre 2026 (adresses dans docs/CONNECTEURS.md) :
 * - Google : GET /tasks/v1/users/@me/lists (maxResults 1000 au plus), GET /tasks/v1/lists/{liste}/tasks
 *   (showCompleted, showHidden, showDeleted, maxResults 100 au plus, pageToken), POST .../tasks,
 *   PATCH .../tasks/{id}. `due` et `completed` sont des dates RFC 3339 dont Google ne garde que le jour ;
 *   `status` vaut `needsAction` ou `completed` ; `webViewLink` est l'adresse de la tâche dans Google Tasks.
 * - Microsoft : GET /me/todo/lists ($select, $top), GET /me/todo/lists/{id}/tasks, POST .../tasks,
 *   PATCH /me/todo/lists/{id}/tasks/{id}. `dueDateTime` s'écrit `{ dateTime, timeZone }` ; `status` vaut
 *   `notStarted`, `inProgress`, `completed`, `waitingOnOthers` ou `deferred`. Microsoft ne donne aucune adresse web
 *   pour une tâche : le bouton « Ouvrir dans… » n'existe donc pas de ce côté.
 */
import { pageSuivante } from './sources-agenda.ts';
import type { Adaptateur, Choix, Enregistrement, ValeurSortante } from './sources.ts';
import { appeler, ErreurSortante } from './sortant.ts';

type Config = Readonly<Record<string, string>>;

const GOOGLE = 'https://tasks.googleapis.com/tasks/v1';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Les tâches déjà terminées entrent-elles aussi ? Par défaut non : l'écran Tâches montre ce qu'il reste à faire. */
export const TERMINEES = Object.freeze(['aFaire', 'tout']);
/** Tâches lues au plus en une synchronisation (au-delà, la liste branchée n'est pas une liste de travail). */
const MAX = 500;

export const avecTerminees = (cfg: Config): boolean => (cfg.terminees ?? '').trim() === 'tout';

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Texte d'un outil ramené à une ligne, sans caractère de contrôle ni de direction. */
const texte = (x: unknown, max = 300): string =>
  (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const jeton = (secret: string | null, nom: 'Google' | 'Microsoft'): string => {
  if (!secret) throw new ErreurSortante(`Connexion ${nom} manquante : cliquez sur « Se connecter avec ${nom} ».`);
  return secret;
};
const bearer = (secret: string | null, nom: 'Google' | 'Microsoft') => ({ authorization: `Bearer ${jeton(secret, nom)}` });
/** Adresse web d'une tâche chez l'outil, pour le bouton « Ouvrir dans… » ; vide si elle n'est pas reconnue. */
const lienOutil = (x: unknown, hotes: readonly string[]): string => {
  if (typeof x !== 'string' || x.length > 2000) return '';
  try {
    const u = new URL(x);
    return u.protocol === 'https:' && !u.username && !u.password && hotes.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.toString() : '';
  } catch { return ''; }
};

/**
 * Échéance telle que le jeu la garde : « 2026-11-20 ». Les deux outils donnent un instant complet, mais ni l'un ni
 * l'autre ne retient l'heure d'une tâche : le jour suffit, et une date illisible devient vide (le jeu n'en invente pas).
 */
export function jourTache(x: unknown): string {
  const t = typeof x === 'string' ? x.trim() : '';
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
  return m ? m[1]! : '';
}

/** Une échéance écrite par le jeu (« 2026-11-20 », ou une date avec heure) ramenée au jour ; null si illisible. */
export function jourSortant(v: ValeurSortante | undefined): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  if (!t) return null;
  const direct = jourTache(t);
  if (direct) return direct;
  const d = Date.parse(t);
  return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null;
}

/** Statut du jeu (liste de choix du type « Tâche »), ramené à l'une de ses quatre valeurs. */
const statutJeu = (v: ValeurSortante | undefined): 'à faire' | 'en cours' | 'bloquée' | 'terminée' => {
  const t = texte(v, 40).toLowerCase();
  if (t.startsWith('termin')) return 'terminée';
  if (t.startsWith('en cours')) return 'en cours';
  if (t.startsWith('bloqu')) return 'bloquée';
  return 'à faire';
};

const CHAMPS_COMMUNS = [
  { id: 'liste', libelle: 'Liste de tâches', aide: 'Laquelle de vos listes ? Choisissez-la dans la liste.', obligatoire: true, liste: true },
  { id: 'terminees', libelle: 'Tâches terminées', aide: 'Les tâches déjà cochées chez votre outil entrent-elles aussi ?', choix: TERMINEES, obligatoire: true },
  // `mode: 'oauth'` : ce jeton vient de « Se connecter avec… » et de nulle part ailleurs. Il n'est jamais montré, et
  // le catalogue n'y voit pas une clé qu'on pourrait coller : sans relais ouvert, les tâches ne sont pas proposées.
  { id: 'jeton', libelle: 'Connexion', aide: 'Obtenue par « Se connecter avec… ». Chiffrée sur cet ordinateur, jamais affichée.', secret: true, obligatoire: true, mode: 'oauth' },
] as const;

const ETAPES_COMMUNES = (compte: 'Google' | 'Microsoft') => [
  `Cliquez sur « Se connecter avec ${compte} » et choisissez votre compte${compte === 'Microsoft' ? ' professionnel' : ''}.`,
  'Choisissez la liste à brancher : votre compte en contient souvent plusieurs.',
  'Dites si les tâches déjà terminées doivent entrer elles aussi. C’est tout.',
] as const;

// ---------------------------------------------------------------- Google Tasks

/**
 * Identifiant de liste ou de tâche chez Google : la documentation n'en donne pas la forme. On n'accepte donc que des
 * caractères qui ne peuvent pas changer le sens d'une adresse (jamais de « / » ni de « .. »), en plus de l'encodage.
 */
const ID_GOOGLE = /^[A-Za-z0-9_=~-]{1,512}$/;

const listeGoogle = (cfg: Config): string => {
  const l = (cfg.liste ?? '').trim();
  if (!l || !ID_GOOGLE.test(l)) throw new ErreurSortante('Choisissez la liste de tâches à brancher.');
  return l;
};

/** Une tâche Google → une fiche du jeu. `null` : tâche supprimée ou illisible (elle n'entre pas). */
export function ficheGoogle(t: unknown): Enregistrement | null {
  if (!estObj(t)) return null;
  const id = typeof t.id === 'string' && ID_GOOGLE.test(t.id) ? t.id : '';
  if (!id || t.deleted === true) return null;
  return {
    externeId: id,
    champs: {
      titre: texte(t.title, 200) || 'Tâche',
      echeance: jourTache(t.due),
      // Google ne connaît que deux états : « à faire » et « terminée ». « En cours » et « bloquée » existent dans le
      // jeu seulement, et une tâche qui y passe reste « needsAction » chez Google — rien n'est inventé dans l'autre sens.
      statut: t.status === 'completed' ? 'terminée' : 'à faire',
      lien: lienOutil(t.webViewLink, ['google.com']),
    },
  };
}

/** Corps envoyé à Google pour créer ou modifier une tâche (seulement ce que le jeu connaît). */
export function corpsGoogle(valeurs: Record<string, ValeurSortante>): Record<string, unknown> {
  const corps: Record<string, unknown> = {};
  const titre = texte(valeurs.titre, 1024);
  if (titre) corps.title = titre;
  if ('echeance' in valeurs) {
    const jour = jourSortant(valeurs.echeance);
    // Google n'enregistre que le jour d'une échéance : minuit UTC dit ce jour-là sans ambiguïté de fuseau
    corps.due = jour ? `${jour}T00:00:00.000Z` : null;
  }
  if ('statut' in valeurs) corps.status = statutJeu(valeurs.statut) === 'terminée' ? 'completed' : 'needsAction';
  return corps;
}

export const tachesgoogle: Adaptateur = {
  id: 'tachesgoogle', nom: 'Google Tasks', categorie: 'Tâches', couleur: '#1a73e8',
  description: 'Les tâches d’une de vos listes Google, dans les deux sens : elles entrent dans l’écran Tâches, et celles que vous créez ou cochez ici repartent dans la liste.',
  etapes: ETAPES_COMMUNES('Google'),
  champs: CHAMPS_COMMUNS,
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const entetes = bearer(secret, 'Google');
    const tout = avecTerminees(cfg);
    const res: Enregistrement[] = [];
    let page = '';
    for (let n = 0; n < 10 && res.length < MAX; n++) {
      const u = new URL(`${GOOGLE}/lists/${encodeURIComponent(listeGoogle(cfg))}/tasks`);
      u.searchParams.set('showCompleted', tout ? 'true' : 'false');
      // showHidden : sans lui, Google cache les tâches cochées dans ses propres applications, pourtant terminées
      u.searchParams.set('showHidden', tout ? 'true' : 'false');
      u.searchParams.set('showDeleted', 'false');
      u.searchParams.set('maxResults', '100');
      // `fields` : les notes d'une tâche ne descendent même pas jusqu'ici (partial response, documentée pour toutes
      // les API de Google ; la page « Performance tips » de Tasks renvoie elle-même à ces mêmes principes)
      u.searchParams.set('fields', 'items(id,title,due,status,deleted,webViewLink),nextPageToken');
      if (page) u.searchParams.set('pageToken', page);
      const { donnees } = await appeler(f, u, { entetes, delaiMs: 30_000 });
      const d = estObj(donnees) ? donnees : {};
      for (const t of Array.isArray(d.items) ? d.items : []) {
        const fiche = ficheGoogle(t);
        if (fiche) res.push(fiche);
      }
      const suite = typeof d.nextPageToken === 'string' && d.nextPageToken.length <= 2000 ? d.nextPageToken : '';
      if (!suite) break;
      page = suite;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const entetes = bearer(secret, 'Google');
    const liste = encodeURIComponent(listeGoogle(cfg));
    const corps = corpsGoogle(valeurs);
    if (externeId) {
      if (!ID_GOOGLE.test(externeId)) throw new ErreurSortante('Identifiant de tâche Google invalide.');
      await appeler(f, new URL(`${GOOGLE}/lists/${liste}/tasks/${encodeURIComponent(externeId)}`), { methode: 'PATCH', entetes, corps });
      return externeId;
    }
    if (!corps.title) throw new ErreurSortante('Une tâche a besoin d’un intitulé.');
    const { donnees } = await appeler(f, new URL(`${GOOGLE}/lists/${liste}/tasks`), { methode: 'POST', entetes, corps });
    const id = estObj(donnees) && typeof donnees.id === 'string' ? donnees.id : '';
    return ID_GOOGLE.test(id) ? id : null;
  },
  /** Listes de tâches du compte connecté. */
  async choix(champ, _cfg, secret, f) {
    if (champ !== 'liste') return [];
    const entetes = bearer(secret, 'Google');
    const res: Choix[] = [];
    let page = '';
    for (let n = 0; n < 5; n++) {
      const u = new URL(`${GOOGLE}/users/@me/lists`);
      u.searchParams.set('maxResults', '100');
      u.searchParams.set('fields', 'items(id,title),nextPageToken');
      if (page) u.searchParams.set('pageToken', page);
      const { donnees } = await appeler(f, u, { entetes });
      const d = estObj(donnees) ? donnees : {};
      for (const x of Array.isArray(d.items) ? d.items : []) {
        if (!estObj(x) || typeof x.id !== 'string' || !ID_GOOGLE.test(x.id)) continue;
        res.push({ valeur: x.id, libelle: texte(x.title, 120) || 'Liste de tâches' });
      }
      const suite = typeof d.nextPageToken === 'string' && d.nextPageToken.length <= 2000 ? d.nextPageToken : '';
      if (!suite) break;
      page = suite;
    }
    return res.slice(0, 200);
  },
};

// ---------------------------------------------------------------- Microsoft To Do

/** Identifiant Graph : long, mais sans caractère qui changerait le sens d'une adresse. */
const ID_GRAPH = /^[A-Za-z0-9_=\-/+%.]{1,1800}$/;

const listeMicrosoft = (cfg: Config): string => {
  const l = (cfg.liste ?? '').trim();
  if (!l || !ID_GRAPH.test(l)) throw new ErreurSortante('Choisissez la liste de tâches à brancher.');
  return l;
};

/** Les cinq états de Microsoft, ramenés aux quatre du jeu. */
const STATUT_MICROSOFT: Readonly<Record<string, string>> = {
  notStarted: 'à faire', inProgress: 'en cours', completed: 'terminée', waitingOnOthers: 'bloquée', deferred: 'bloquée',
};
/** Et l'inverse, pour ce qui repart : « bloquée » devient « en attente de quelqu'un », le plus proche chez Microsoft. */
const VERS_MICROSOFT: Readonly<Record<string, string>> = {
  'à faire': 'notStarted', 'en cours': 'inProgress', 'bloquée': 'waitingOnOthers', 'terminée': 'completed',
};

/** Une tâche Microsoft → une fiche du jeu. */
export function ficheMicrosoft(t: unknown): Enregistrement | null {
  if (!estObj(t)) return null;
  const id = typeof t.id === 'string' && ID_GRAPH.test(t.id) ? t.id : '';
  if (!id) return null;
  const quand = (x: unknown) => (estObj(x) && typeof x.dateTime === 'string' ? x.dateTime : '');
  return {
    externeId: id,
    champs: {
      titre: texte(t.title, 200) || 'Tâche',
      echeance: jourTache(quand(t.dueDateTime)),
      statut: STATUT_MICROSOFT[String(t.status ?? '')] ?? 'à faire',
      // Microsoft ne publie aucune adresse web pour une tâche : pas de bouton « Ouvrir dans… » de ce côté
      lien: '',
    },
  };
}

/** Corps envoyé à Microsoft Graph. */
export function corpsMicrosoft(valeurs: Record<string, ValeurSortante>): Record<string, unknown> {
  const corps: Record<string, unknown> = {};
  const titre = texte(valeurs.titre, 255);
  if (titre) corps.title = titre;
  if ('echeance' in valeurs) {
    const jour = jourSortant(valeurs.echeance);
    // minuit en UTC : une échéance n'a pas d'heure, et écrire le jour dans un fuseau le déplacerait d'un jour à la relecture
    corps.dueDateTime = jour ? { dateTime: `${jour}T00:00:00`, timeZone: 'UTC' } : null;
  }
  if ('statut' in valeurs) corps.status = VERS_MICROSOFT[statutJeu(valeurs.statut)];
  return corps;
}

export const tachesmicrosoft: Adaptateur = {
  id: 'tachesmicrosoft', nom: 'Microsoft To Do', categorie: 'Tâches', couleur: '#0078d4',
  description: 'Les tâches d’une de vos listes Microsoft To Do, dans les deux sens : elles entrent dans l’écran Tâches, et celles que vous créez ou cochez ici repartent dans la liste.',
  etapes: ETAPES_COMMUNES('Microsoft'),
  champs: CHAMPS_COMMUNS,
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const entetes = bearer(secret, 'Microsoft');
    const tout = avecTerminees(cfg);
    const res: Enregistrement[] = [];
    let u: URL | null = new URL(`${GRAPH}/me/todo/lists/${encodeURIComponent(listeMicrosoft(cfg))}/tasks`);
    // ni `body` ni `bodyLastModifiedDateTime` : le texte d'une tâche ne descend pas
    u.searchParams.set('$select', 'id,title,status,dueDateTime');
    u.searchParams.set('$top', '100');
    for (let n = 0; n < 10 && u && res.length < MAX; n++) {
      const { donnees }: { donnees: unknown } = await appeler(f, u, { entetes, delaiMs: 30_000 });
      const d = estObj(donnees) ? donnees : {};
      for (const t of Array.isArray(d.value) ? d.value : []) {
        const fiche = ficheMicrosoft(t);
        // Microsoft n'offre pas de filtre sûr sur l'état : les tâches terminées sont écartées ici
        if (fiche && (tout || fiche.champs.statut !== 'terminée')) res.push(fiche);
      }
      u = pageSuivante(d['@odata.nextLink']);
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const entetes = bearer(secret, 'Microsoft');
    const liste = encodeURIComponent(listeMicrosoft(cfg));
    const corps = corpsMicrosoft(valeurs);
    if (externeId) {
      if (!ID_GRAPH.test(externeId)) throw new ErreurSortante('Identifiant de tâche Microsoft invalide.');
      await appeler(f, new URL(`${GRAPH}/me/todo/lists/${liste}/tasks/${encodeURIComponent(externeId)}`), { methode: 'PATCH', entetes, corps });
      return externeId;
    }
    if (!corps.title) throw new ErreurSortante('Une tâche a besoin d’un intitulé.');
    const { donnees } = await appeler(f, new URL(`${GRAPH}/me/todo/lists/${liste}/tasks`), { methode: 'POST', entetes, corps });
    const id = estObj(donnees) && typeof donnees.id === 'string' ? donnees.id : '';
    return ID_GRAPH.test(id) ? id : null;
  },
  async choix(champ, _cfg, secret, f) {
    if (champ !== 'liste') return [];
    const entetes = bearer(secret, 'Microsoft');
    const u = new URL(`${GRAPH}/me/todo/lists`);
    u.searchParams.set('$select', 'id,displayName,wellknownListName');
    u.searchParams.set('$top', '100');
    const { donnees } = await appeler(f, u, { entetes });
    const res: Choix[] = [];
    for (const x of Array.isArray((estObj(donnees) ? donnees : {}).value) ? (donnees as { value: unknown[] }).value : []) {
      if (!estObj(x) || typeof x.id !== 'string' || !ID_GRAPH.test(x.id)) continue;
      const nom = texte(x.displayName, 120) || 'Liste de tâches';
      res.push({ valeur: x.id, libelle: x.wellknownListName === 'defaultList' ? `${nom} (votre liste principale)` : nom });
    }
    return res.slice(0, 200);
  },
};

/** Les deux adaptateurs de tâches ne se branchent que par « Se connecter avec… » : aucune clé à coller. */
export const TACHES = { tachesgoogle, tachesmicrosoft } as const;
