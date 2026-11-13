/**
 * Agendas : Google Agenda et l'agenda de Microsoft 365, dans les deux sens.
 *
 * Ce que la personne fait : « Se connecter avec Google » (ou Microsoft), puis elle choisit DANS QUEL agenda du compte
 * (il y en a souvent plusieurs : le sien, celui de l'équipe, celui des interventions) et SUR QUELLE PÉRIODE. Rien
 * d'autre. Les rendez-vous de cet agenda entrent dans le jeu ; un rendez-vous créé dans le jeu part dans ce même
 * agenda. L'anti-boucle est celui de tous les connecteurs (`synchro.ts`) : l'empreinte d'une fiche est notée après
 * chaque échange, et rien ne repart tant qu'elle n'a pas changé.
 *
 * Ce qui entre dans le jeu : le titre, le début, la fin, le lieu, l'état et le lien vers le rendez-vous chez l'outil.
 * Jamais la description ni la liste des invités : un rendez-vous en dit déjà beaucoup, son texte n'apporte rien au jeu.
 *
 * Documentation lue le 13 novembre 2026 (adresses dans docs/CONNECTEURS.md) :
 * - Google : /calendar/v3/users/me/calendarList, /calendar/v3/calendars/{id}/events (timeMin, timeMax, singleEvents,
 *   orderBy, showDeleted), events.insert, events.patch. Un identifiant d'événement Google est en base32hex (a-v, 0-9),
 *   de 5 à 1024 caractères ; `start`/`end` acceptent `date` (journée entière) ou `dateTime` + `timeZone`.
 * - Microsoft : GET /me/calendars, GET /me/calendars/{id}/calendarView?startDateTime&endDateTime (qui développe les
 *   séries répétées, contrairement à /events), POST /me/calendars/{id}/events, PATCH /me/events/{id}. Les dates
 *   s'écrivent `{ dateTime, timeZone }` ; l'en-tête `Prefer: outlook.timezone` fixe le fuseau des dates lues.
 */
import { parRelais } from './oauth-relais.ts';
import type { Adaptateur, Choix, Enregistrement, ValeurSortante } from './sources.ts';
import { appeler, ErreurSortante, type Recuperateur } from './sortant.ts';

type Config = Readonly<Record<string, string>>;

const GOOGLE = 'https://www.googleapis.com/calendar/v3';
const GRAPH = 'https://graph.microsoft.com/v1.0';

/** Périodes proposées, en jours à partir d'aujourd'hui (celle d'avant compte autant que celle d'après). */
export const PERIODES = Object.freeze([
  { valeur: '30', libelle: 'Les 30 prochains jours' },
  { valeur: '90', libelle: 'Les 90 prochains jours' },
  { valeur: '180', libelle: 'Les 6 prochains mois' },
  { valeur: '365', libelle: 'Les 12 prochains mois' },
]);
const PERIODE_DEFAUT = 90;
/** Jours déjà passés gardés : de quoi retrouver un rendez-vous d'hier sans charger des années d'archives. */
const PASSE_JOURS = 30;
/** Rendez-vous lus au plus en une synchronisation (au-delà, la période choisie est trop large). */
const MAX = 1000;

/** Nombre de jours de la période choisie, borné. */
export function joursPeriode(cfg: Config): number {
  const n = Number((cfg.periode ?? '').trim());
  return Number.isFinite(n) && n >= 1 && n <= 365 ? Math.round(n) : PERIODE_DEFAUT;
}

/** Bornes de la lecture : [début, fin], en ISO 8601 avec décalage (les deux API l'exigent). */
export function bornes(cfg: Config, maintenant = new Date()): { debut: string; fin: string } {
  const j = 86_400_000;
  return {
    debut: new Date(maintenant.getTime() - PASSE_JOURS * j).toISOString(),
    fin: new Date(maintenant.getTime() + joursPeriode(cfg) * j).toISOString(),
  };
}

const jeton = (secret: string | null, nom: 'Google' | 'Microsoft'): string => {
  if (!secret) throw new ErreurSortante(`Connexion ${nom} manquante : cliquez sur « Se connecter avec ${nom} ».`);
  return secret;
};
const bearer = (secret: string | null, nom: 'Google' | 'Microsoft') => ({ authorization: `Bearer ${jeton(secret, nom)}` });
const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Texte d'un outil ramené à une ligne, sans caractère de contrôle ni de direction. */
const texte = (x: unknown, max = 300): string =>
  (typeof x === 'string' ? x.replace(/[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
/** Adresse web d'un rendez-vous chez l'outil, pour le bouton « Ouvrir dans… » ; vide si elle n'est pas reconnue. */
const lienOutil = (x: unknown, hotes: readonly string[]): string => {
  if (typeof x !== 'string' || x.length > 2000) return '';
  try {
    const u = new URL(x);
    return u.protocol === 'https:' && !u.username && !u.password && hotes.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`)) ? u.toString() : '';
  } catch { return ''; }
};

/**
 * Date d'un rendez-vous telle que le jeu la garde : « 2026-11-20T09:00 » (minute près, fuseau de l'entreprise), ou
 * « 2026-11-20 » pour une journée entière. Une date illisible devient vide : le jeu n'invente jamais une valeur.
 */
export function dateJeu(iso: unknown, journee = false): string {
  const t = typeof iso === 'string' && iso.length <= 60 ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(t)) return '';
  if (journee) return new Date(t).toISOString().slice(0, 10);
  const d = new Date(t);
  const deux = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}T${deux(d.getHours())}:${deux(d.getMinutes())}`;
}

/** Fuseau de l'entreprise (celui de l'ordinateur) : exigé par Microsoft, et utile à Google pour une heure sans décalage. */
export const fuseau = (): string => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris'; } catch { return 'Europe/Paris'; }
};

/** Une date écrite par le jeu (« 2026-11-20T09:00 » ou « 2026-11-20 ») : [ISO sans fuseau, journée entière]. */
export function dateSortante(v: ValeurSortante | undefined): { valeur: string; journee: boolean } | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return { valeur: t, journee: true };
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?/.exec(t);
  if (m) return { valeur: `${m[1]}T${m[2]}:00`, journee: false };
  const d = t ? Date.parse(t) : Number.NaN;
  if (!Number.isFinite(d)) return null;
  return { valeur: dateJeu(new Date(d).toISOString()).replace(/$/, ':00'), journee: false };
}

/** Fin par défaut quand le jeu n'en donne pas : une heure après le début (ou le jour même). */
function finParDefaut(debut: { valeur: string; journee: boolean }): { valeur: string; journee: boolean } {
  if (debut.journee) return debut;
  const t = Date.parse(`${debut.valeur}Z`);
  if (!Number.isFinite(t)) return debut;
  return { valeur: `${new Date(t + 3600_000).toISOString().slice(0, 19)}`, journee: false };
}

const CHAMPS_COMMUNS = [
  { id: 'agenda', libelle: 'Agenda', aide: 'Lequel de vos agendas ? Choisissez-le dans la liste.', obligatoire: true, liste: true },
  { id: 'periode', libelle: 'Période', aide: 'Jusqu’où regarder dans le futur. Les 30 derniers jours sont toujours lus.', choix: PERIODES.map((p) => p.valeur), obligatoire: true },
] as const;

// ---------------------------------------------------------------- Google Agenda

const ID_EVENEMENT_GOOGLE = /^[a-v0-9_]{5,1024}$/;
/** Identifiant d'agenda Google : une adresse e-mail, « primary », ou un identifiant de groupe. */
const ID_AGENDA_GOOGLE = /^[A-Za-z0-9._%+@#-]{1,320}$/;

const agendaGoogle = (cfg: Config): string => {
  const a = (cfg.agenda ?? '').trim() || 'primary';
  if (!ID_AGENDA_GOOGLE.test(a)) throw new ErreurSortante('Choisissez l’agenda à brancher.');
  return a;
};

/** Un événement Google → une fiche du jeu. `null` : événement annulé ou illisible (il n'entre pas). */
export function fichierGoogle(e: unknown): Enregistrement | null {
  if (!estObj(e)) return null;
  const id = typeof e.id === 'string' && ID_EVENEMENT_GOOGLE.test(e.id) ? e.id : '';
  if (!id || e.status === 'cancelled') return null;
  const borne = (x: unknown) => (estObj(x) ? x : {});
  const debut = borne(e.start);
  const fin = borne(e.end);
  const journee = typeof debut.date === 'string';
  return {
    externeId: id,
    champs: {
      titre: texte(e.summary, 200) || 'Rendez-vous',
      debut: dateJeu(journee ? debut.date : debut.dateTime, journee),
      fin: dateJeu(journee ? fin.date : fin.dateTime, journee),
      lieu: texte(e.location, 200),
      etat: e.status === 'tentative' ? 'à confirmer' : 'confirmé',
      lien: lienOutil(e.htmlLink, ['google.com']),
    },
  };
}

/** Corps envoyé à Google pour créer ou modifier un rendez-vous (seulement ce que le jeu connaît). */
export function corpsGoogle(valeurs: Record<string, ValeurSortante>): Record<string, unknown> {
  const debut = dateSortante(valeurs.debut);
  if (!debut) throw new ErreurSortante('Un rendez-vous a besoin d’une date de début.');
  const fin = dateSortante(valeurs.fin) ?? finParDefaut(debut);
  const zone = fuseau();
  const borne = (d: { valeur: string; journee: boolean }) => (d.journee ? { date: d.valeur } : { dateTime: d.valeur, timeZone: zone });
  const corps: Record<string, unknown> = { start: borne(debut), end: borne(fin.journee === debut.journee ? fin : debut) };
  const titre = texte(valeurs.titre, 200);
  if (titre) corps.summary = titre;
  const lieu = texte(valeurs.lieu, 200);
  if (lieu) corps.location = lieu;
  const etat = texte(valeurs.etat, 40).toLowerCase();
  if (etat) corps.status = etat.startsWith('à confirmer') || etat === 'tentative' ? 'tentative' : 'confirmed';
  return corps;
}

export const agendagoogle: Adaptateur = {
  id: 'agendagoogle', nom: 'Google Agenda', categorie: 'Agenda', couleur: '#1a73e8',
  description: 'Les rendez-vous d’un de vos agendas Google, dans les deux sens : ils entrent dans le planning, et ceux que vous créez ici y repartent.',
  etapes: [
    'Cliquez sur « Se connecter avec Google » et choisissez votre compte.',
    'Choisissez l’agenda à brancher : votre compte en contient souvent plusieurs.',
    'Choisissez jusqu’où regarder (90 jours par défaut). C’est tout.',
  ],
  champs: CHAMPS_COMMUNS,
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const entetes = bearer(secret, 'Google');
    const { debut, fin } = bornes(cfg);
    const res: Enregistrement[] = [];
    let page = '';
    for (let n = 0; n < 20 && res.length < MAX; n++) {
      const u = new URL(`${GOOGLE}/calendars/${encodeURIComponent(agendaGoogle(cfg))}/events`);
      u.searchParams.set('timeMin', debut);
      u.searchParams.set('timeMax', fin);
      // singleEvents : une série répétée est développée en rendez-vous, un par date — c'est ce que montre le planning
      u.searchParams.set('singleEvents', 'true');
      u.searchParams.set('orderBy', 'startTime');
      u.searchParams.set('maxResults', '250');
      u.searchParams.set('fields', 'items(id,summary,location,status,start,end,htmlLink),nextPageToken');
      if (page) u.searchParams.set('pageToken', page);
      const { donnees } = await appeler(f, u, { entetes, delaiMs: 30_000 });
      const d = estObj(donnees) ? donnees : {};
      for (const e of Array.isArray(d.items) ? d.items : []) {
        const fiche = fichierGoogle(e);
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
    const agenda = encodeURIComponent(agendaGoogle(cfg));
    const corps = corpsGoogle(valeurs);
    if (externeId) {
      if (!ID_EVENEMENT_GOOGLE.test(externeId)) throw new ErreurSortante('Identifiant de rendez-vous Google invalide.');
      await appeler(f, new URL(`${GOOGLE}/calendars/${agenda}/events/${encodeURIComponent(externeId)}`), { methode: 'PATCH', entetes, corps });
      return externeId;
    }
    const { donnees } = await appeler(f, new URL(`${GOOGLE}/calendars/${agenda}/events`), { methode: 'POST', entetes, corps });
    const id = estObj(donnees) && typeof donnees.id === 'string' ? donnees.id : '';
    return ID_EVENEMENT_GOOGLE.test(id) ? id : null;
  },
  /** Agendas du compte connecté : ceux où la personne peut au moins lire (`accessRole`). */
  async choix(champ, _cfg, secret, f) {
    if (champ !== 'agenda') return [];
    const entetes = bearer(secret, 'Google');
    const res: Choix[] = [];
    let page = '';
    for (let n = 0; n < 5; n++) {
      const u = new URL(`${GOOGLE}/users/me/calendarList`);
      u.searchParams.set('maxResults', '250');
      u.searchParams.set('fields', 'items(id,summary,summaryOverride,primary,accessRole),nextPageToken');
      if (page) u.searchParams.set('pageToken', page);
      const { donnees } = await appeler(f, u, { entetes });
      const d = estObj(donnees) ? donnees : {};
      for (const x of Array.isArray(d.items) ? d.items : []) {
        if (!estObj(x) || typeof x.id !== 'string' || !ID_AGENDA_GOOGLE.test(x.id)) continue;
        // freeBusyReader ne voit que « occupé » : aucun titre, rien à faire entrer dans le jeu
        if (x.accessRole === 'freeBusyReader' || x.accessRole === 'none') continue;
        const nom = texte(x.summaryOverride, 120) || texte(x.summary, 120) || x.id;
        res.push({ valeur: x.id, libelle: x.primary === true ? `${nom} (votre agenda principal)` : nom });
      }
      const suite = typeof d.nextPageToken === 'string' && d.nextPageToken.length <= 2000 ? d.nextPageToken : '';
      if (!suite) break;
      page = suite;
    }
    return res.slice(0, 200);
  },
};

// ---------------------------------------------------------------- agenda Microsoft 365

/** Identifiant Graph : long, mais sans caractère qui changerait le sens d'une adresse. */
const ID_GRAPH = /^[A-Za-z0-9_=\-/+%.]{1,1800}$/;

const agendaMicrosoft = (cfg: Config): string => {
  const a = (cfg.agenda ?? '').trim();
  if (!a || !ID_GRAPH.test(a)) throw new ErreurSortante('Choisissez l’agenda à brancher.');
  return a;
};

/** Un événement Microsoft → une fiche du jeu. */
export function ficheMicrosoft(e: unknown): Enregistrement | null {
  if (!estObj(e)) return null;
  const id = typeof e.id === 'string' && ID_GRAPH.test(e.id) ? e.id : '';
  if (!id || e.isCancelled === true) return null;
  const journee = e.isAllDay === true;
  const quand = (x: unknown) => (estObj(x) && typeof x.dateTime === 'string' ? `${x.dateTime}${/[Zz]|[+-]\d{2}:?\d{2}$/.test(x.dateTime) ? '' : 'Z'}` : '');
  return {
    externeId: id,
    champs: {
      titre: texte(e.subject, 200) || 'Rendez-vous',
      debut: dateJeu(quand(e.start), journee),
      fin: dateJeu(quand(e.end), journee),
      lieu: texte(estObj(e.location) ? e.location.displayName : '', 200),
      etat: e.showAs === 'tentative' ? 'à confirmer' : 'confirmé',
      lien: lienOutil(e.webLink, ['outlook.office365.com', 'outlook.office.com', 'outlook.com']),
    },
  };
}

/** Corps envoyé à Microsoft Graph (dates en `{ dateTime, timeZone }`, comme sa documentation l'écrit). */
export function corpsMicrosoft(valeurs: Record<string, ValeurSortante>): Record<string, unknown> {
  const debut = dateSortante(valeurs.debut);
  if (!debut) throw new ErreurSortante('Un rendez-vous a besoin d’une date de début.');
  const fin = dateSortante(valeurs.fin) ?? finParDefaut(debut);
  const zone = fuseau();
  // une journée entière commence et finit à minuit, dans le même fuseau (exigence de Microsoft)
  const borne = (d: { valeur: string; journee: boolean }) => ({ dateTime: d.journee ? `${d.valeur}T00:00:00` : d.valeur, timeZone: zone });
  const corps: Record<string, unknown> = { start: borne(debut), end: borne(fin.journee === debut.journee ? fin : debut), isAllDay: debut.journee };
  const titre = texte(valeurs.titre, 200);
  if (titre) corps.subject = titre;
  const lieu = texte(valeurs.lieu, 200);
  if (lieu) corps.location = { displayName: lieu };
  const etat = texte(valeurs.etat, 40).toLowerCase();
  if (etat) corps.showAs = etat.startsWith('à confirmer') || etat === 'tentative' ? 'tentative' : 'busy';
  return corps;
}

export const agendamicrosoft: Adaptateur = {
  id: 'agendamicrosoft', nom: 'Agenda Microsoft 365', categorie: 'Agenda', couleur: '#0078d4',
  description: 'Les rendez-vous d’un de vos agendas Microsoft 365, dans les deux sens : ils entrent dans le planning, et ceux que vous créez ici y repartent.',
  etapes: [
    'Cliquez sur « Se connecter avec Microsoft » et choisissez votre compte professionnel.',
    'Choisissez l’agenda à brancher : votre compte en contient souvent plusieurs.',
    'Choisissez jusqu’où regarder (90 jours par défaut). C’est tout.',
  ],
  champs: CHAMPS_COMMUNS,
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    // Prefer: outlook.timezone — sans lui, Microsoft rend toutes les heures en UTC
    const entetes = { ...bearer(secret, 'Microsoft'), prefer: `outlook.timezone="${fuseau()}"` };
    const { debut, fin } = bornes(cfg);
    const res: Enregistrement[] = [];
    // calendarView (et non /events) : les séries répétées y sont développées, un rendez-vous par date
    let u: URL | null = new URL(`${GRAPH}/me/calendars/${encodeURIComponent(agendaMicrosoft(cfg))}/calendarView`);
    u.searchParams.set('startDateTime', debut);
    u.searchParams.set('endDateTime', fin);
    u.searchParams.set('$select', 'id,subject,start,end,location,isAllDay,showAs,isCancelled,webLink');
    u.searchParams.set('$top', '250');
    for (let n = 0; n < 20 && u && res.length < MAX; n++) {
      const { donnees }: { donnees: unknown } = await appeler(f, u, { entetes, delaiMs: 30_000 });
      const d = estObj(donnees) ? donnees : {};
      for (const e of Array.isArray(d.value) ? d.value : []) {
        const fiche = ficheMicrosoft(e);
        if (fiche) res.push(fiche);
      }
      u = pageSuivante(d['@odata.nextLink']);
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const entetes = bearer(secret, 'Microsoft');
    const corps = corpsMicrosoft(valeurs);
    if (externeId) {
      if (!ID_GRAPH.test(externeId)) throw new ErreurSortante('Identifiant de rendez-vous Microsoft invalide.');
      await appeler(f, new URL(`${GRAPH}/me/events/${encodeURIComponent(externeId)}`), { methode: 'PATCH', entetes, corps });
      return externeId;
    }
    const { donnees } = await appeler(f, new URL(`${GRAPH}/me/calendars/${encodeURIComponent(agendaMicrosoft(cfg))}/events`), { methode: 'POST', entetes, corps });
    const id = estObj(donnees) && typeof donnees.id === 'string' ? donnees.id : '';
    return ID_GRAPH.test(id) ? id : null;
  },
  async choix(champ, _cfg, secret, f) {
    if (champ !== 'agenda') return [];
    const entetes = bearer(secret, 'Microsoft');
    const u = new URL(`${GRAPH}/me/calendars`);
    u.searchParams.set('$select', 'id,name,isDefaultCalendar,canEdit');
    u.searchParams.set('$top', '200');
    const { donnees } = await appeler(f, u, { entetes });
    const res: Choix[] = [];
    for (const x of Array.isArray((estObj(donnees) ? donnees : {}).value) ? (donnees as { value: unknown[] }).value : []) {
      if (!estObj(x) || typeof x.id !== 'string' || !ID_GRAPH.test(x.id)) continue;
      const nom = texte(x.name, 120) || 'Agenda';
      res.push({ valeur: x.id, libelle: x.isDefaultCalendar === true ? `${nom} (votre agenda principal)` : nom });
    }
    return res.slice(0, 200);
  },
};

/**
 * Page suivante d'une liste Graph (`@odata.nextLink`) : relue avant usage, et seulement sur l'hôte de Graph — une
 * adresse de suite ne doit jamais emmener le jeton ailleurs.
 */
export function pageSuivante(x: unknown): URL | null {
  if (typeof x !== 'string' || x.length > 4000) return null;
  try {
    const u = new URL(x);
    return u.protocol === 'https:' && u.hostname === 'graph.microsoft.com' && !u.username && !u.password && u.port === '' ? u : null;
  } catch { return null; }
}

/** Les deux adaptateurs d'agenda ne se branchent que par « Se connecter avec… » : aucune clé à coller. */
export const AGENDAS = { agendagoogle, agendamicrosoft } as const;

/** Vrai si ce branchement passe par le relais (les adaptateurs d'agenda n'ont pas d'autre mode). */
export const agendaParRelais = (cfg: Config): boolean => parRelais(cfg, 'googleagenda') || parRelais(cfg, 'microsoftagenda');
