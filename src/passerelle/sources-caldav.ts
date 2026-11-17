/**
 * Agenda Apple (iCloud) — et tout serveur CalDAV : Fastmail, Nextcloud, Infomaniak, Zimbra, un Radicale chez soi.
 *
 * POURQUOI UN PROTOCOLE ET PAS UN « SE CONNECTER AVEC APPLE ». Apple n'ouvre AUCUN OAuth pour ses agendas : il n'y a
 * pas de bouton à faire. Le seul chemin, celui que prennent tous les autres logiciels, est CalDAV avec un **mot de
 * passe d'application** — une suite de lettres créée exprès sur le compte Apple, révocable d'un clic, qui ne donne
 * accès qu'à ça. La personne le crée sur account.apple.com, le colle ici une fois, et c'est fini.
 *
 * CE QUI ENTRE DANS LE JEU, comme pour les deux autres agendas (`sources-agenda.ts`) : le titre, le début, la fin, le
 * lieu et l'état. Jamais la description ni les invités. Un rendez-vous créé ici repart dans l'agenda choisi.
 *
 * TROIS APPELS, PAS UN DE PLUS. CalDAV se découvre : (1) PROPFIND à la racine → le « principal » du compte ;
 * (2) PROPFIND sur ce principal → l'adresse de ses agendas (`calendar-home-set`) ; (3) PROPFIND Depth:1 sur cette
 * adresse → la liste des agendas. Ensuite, un REPORT `calendar-query` par synchronisation ramène les événements de la
 * période. La découverte ne sert qu'à remplir la liste « Agenda » : une fois choisi, on va droit au REPORT.
 *
 * CE QUE CE MODULE NE FAIT PAS. Il ne lit pas les VTIMEZONE : une heure écrite dans un fuseau nommé (`TZID=Europe/
 * Paris`) est convertie avec le fuseau du système, qui connaît les mêmes règles ; une heure en UTC (`…Z`) et une
 * journée entière (`VALUE=DATE`) n'ont besoin de rien. Il n'écrit que des heures en UTC et des journées en date nue,
 * ce qui est valide partout et évite d'emporter une table de fuseaux. Les séries répétées (RRULE) sont lues telles
 * que le serveur les développe : iCloud développe, les serveurs qui ne le font pas rendent l'événement maître, et son
 * premier créneau entre dans le planning.
 *
 * Documentation lue le 17 novembre 2026 : RFC 4791 (CalDAV, calendar-query, calendar-home-set), RFC 5545
 * (iCalendar : pliage des lignes, échappement, VALUE=DATE), RFC 5397 (current-user-principal), et la page Apple
 * « Utiliser des mots de passe pour app avec votre identifiant Apple ».
 */
import type { Adaptateur, Choix, Enregistrement, ValeurSortante } from './sources.ts';
import { bornes, dateJeu, dateSortante, finParDefaut } from './sources-agenda.ts';
import { appeler, CorpsBrut, ErreurSortante, type Recuperateur } from './sortant.ts';

type Config = Readonly<Record<string, string>>;

/** Serveur par défaut : iCloud. Un autre serveur CalDAV se met à la place, en toutes lettres. */
export const SERVEUR_DEFAUT = 'caldav.icloud.com';
/** Événements lus au plus en une synchronisation. */
const MAX = 1000;
/** Taille maximale d'un agenda lu d'un coup : au-delà, la période choisie est trop large. */
const DELAI_MS = 30_000;

/** Un hôte de serveur CalDAV : un nom de domaine, rien d'autre (ni schéma, ni chemin, ni port exotique). */
const HOTE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function serveur(cfg: Config): string {
  const h = (cfg.serveur ?? '').trim().toLowerCase() || SERVEUR_DEFAUT;
  // un nom de domaine, pas une adresse IP : une IP nue ne passerait de toute façon pas le contrôle de `sortant.ts`
  if (!HOTE.test(h) || /^[\d.]+$/.test(h)) throw new ErreurSortante('Adresse de serveur CalDAV invalide : attendu un nom de domaine, par exemple caldav.icloud.com.');
  return h;
}

const identifiant = (cfg: Config): string => {
  const v = (cfg.identifiant ?? '').trim();
  if (!v || v.length > 320 || /[\s:]/.test(v)) throw new ErreurSortante('Indiquez l’identifiant du compte (votre adresse Apple, par exemple).');
  return v;
};

/**
 * En-têtes d'un appel CalDAV. Le mot de passe d'application part en authentification « Basic », sur HTTPS et
 * seulement sur l'hôte choisi : c'est ce que le protocole prévoit, et il n'y a pas d'autre forme.
 */
function entetes(cfg: Config, secret: string | null, profondeur: 0 | 1 | null = null): Record<string, string> {
  if (!secret) throw new ErreurSortante('Mot de passe d’application manquant : créez-en un sur votre compte Apple, puis collez-le ici.');
  const base = Buffer.from(`${identifiant(cfg)}:${secret}`, 'utf8').toString('base64');
  return {
    authorization: `Basic ${base}`,
    accept: 'application/xml, text/xml, text/calendar',
    ...(profondeur === null ? {} : { depth: String(profondeur) }),
  };
}

/** Adresse d'un chemin sur le serveur choisi : un href rendu par le serveur ne doit jamais emmener ailleurs. */
export function adresse(cfg: Config, chemin: string): URL {
  const h = serveur(cfg);
  const u = new URL(chemin.startsWith('http') ? chemin : `https://${h}${chemin.startsWith('/') ? '' : '/'}${chemin}`);
  if (u.protocol !== 'https:' || u.username || u.password) throw new ErreurSortante('Adresse CalDAV refusée (HTTPS seulement).');
  // iCloud répond avec ses serveurs de partition (p42-caldav.icloud.com) : même domaine, machine différente
  const racine = h.split('.').slice(-2).join('.');
  if (u.hostname !== h && !u.hostname.endsWith(`.${racine}`)) throw new ErreurSortante('Le serveur renvoie vers un autre domaine : refusé.');
  return u;
}

// ---------------------------------------------------------------- XML, au plus simple

/** Contenu des balises de ce nom local, quel que soit le préfixe de namespace (D:, d:, x1:…). */
export function balises(xml: string, nom: string): string[] {
  const re = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${nom}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${nom}>`, 'gi');
  const res: string[] = [];
  for (let m; (m = re.exec(xml)) && res.length < 500; ) res.push(m[1] ?? '');
  return res;
}

/** Texte d'une balise, dé-échappé (&amp; &lt; &gt; &quot; &#39;) et ramené à une ligne. */
export function texteXml(x: string | undefined): string {
  return String(x ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0*39;|&apos;/g, '’').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const premier = (xml: string, nom: string): string => texteXml(balises(xml, nom)[0]);

/** Les `<response>` d'un 207 Multi-Status, une par ressource. */
const reponses = (xml: string): string[] => balises(xml, 'response');

const PROPFIND_PRINCIPAL = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>';
const PROPFIND_MAISON = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>';
const PROPFIND_AGENDAS = '<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><d:resourcetype/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>';

const xml = (contenu: string) => new CorpsBrut('application/xml; charset=utf-8', contenu);

async function propfind(f: Recuperateur, cfg: Config, secret: string | null, chemin: string, corps: string, profondeur: 0 | 1): Promise<string> {
  const { donnees } = await appeler(f, adresse(cfg, chemin), {
    methode: 'PROPFIND', entetes: entetes(cfg, secret, profondeur), corps: xml(corps), texte: true, delaiMs: DELAI_MS,
  });
  return typeof donnees === 'string' ? donnees : '';
}

/**
 * Les agendas du compte : trois PROPFIND, en suivant ce que le serveur répond. Chaque étape vérifie que l'adresse
 * rendue reste sur le domaine choisi (`adresse`), pour qu'un serveur bavard n'emmène pas le mot de passe ailleurs.
 */
export async function agendas(f: Recuperateur, cfg: Config, secret: string | null): Promise<Choix[]> {
  const racine = await propfind(f, cfg, secret, '/', PROPFIND_PRINCIPAL, 0);
  const principal = premier(racine, 'current-user-principal') || premier(racine, 'href');
  if (!principal) throw new ErreurSortante('Le serveur n’a pas indiqué le compte : vérifiez l’identifiant et le mot de passe d’application.');
  const maison = await propfind(f, cfg, secret, principal, PROPFIND_MAISON, 0);
  const home = premier(balises(maison, 'calendar-home-set')[0] ?? '', 'href');
  if (!home) throw new ErreurSortante('Le serveur n’a pas indiqué où sont vos agendas (calendar-home-set).');
  const liste = await propfind(f, cfg, secret, home, PROPFIND_AGENDAS, 1);
  const res: Choix[] = [];
  for (const r of reponses(liste)) {
    const href = premier(r, 'href');
    // un agenda, et un agenda d'événements : ni la liste de tâches, ni le carnet d'adresses, ni le dossier parent
    if (!href || !/<(?:[A-Za-z0-9_.-]+:)?calendar\b[^>]*\/?>/i.test(r)) continue;
    if (/supported-calendar-component-set/i.test(r) && !/name="VEVENT"/i.test(r)) continue;
    const nom = premier(r, 'displayname');
    res.push({ valeur: href, libelle: nom || href.replace(/\/$/, '').split('/').pop() || 'Agenda' });
  }
  if (!res.length) throw new ErreurSortante('Aucun agenda trouvé sur ce compte.');
  return res.slice(0, 200);
}

// ---------------------------------------------------------------- iCalendar

/** Dépliage RFC 5545 : une ligne coupée reprend à la suivante, qui commence par une espace ou une tabulation. */
export const deplier = (ics: string): string[] => String(ics ?? '').replace(/\r\n|\r/g, '\n').replace(/\n[ \t]/g, '').split('\n');

/** Une propriété iCalendar : « DTSTART;TZID=Europe/Paris:20261117T150000 ». */
export interface Propriete { nom: string; params: Record<string, string>; valeur: string }

export function proprieteIcal(ligne: string): Propriete | null {
  const i = ligne.indexOf(':');
  if (i < 1) return null;
  const [nom, ...params] = ligne.slice(0, i).split(';');
  const p: Record<string, string> = {};
  for (const x of params) {
    const j = x.indexOf('=');
    if (j > 0) p[x.slice(0, j).trim().toUpperCase()] = x.slice(j + 1).trim().replace(/^"|"$/g, '');
  }
  return { nom: (nom ?? '').trim().toUpperCase(), params: p, valeur: ligne.slice(i + 1) };
}

/** Texte iCalendar dé-échappé (\\n, \\, \;, \,) et ramené à une ligne. */
export const texteIcal = (v: string, max = 300): string =>
  String(v ?? '').replace(/\\[nN]/g, ' ').replace(/\\([\\;,])/g, '$1')
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * Décalage, en minutes, du fuseau nommé à cet instant. `Intl` connaît les mêmes règles que le serveur : on formate
 * l'instant dans le fuseau, on relit les chiffres, et l'écart avec UTC donne le décalage (changements d'heure inclus).
 */
function decalageMinutes(tzid: string, t: number): number {
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: tzid, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const p: Record<string, string> = {};
    for (const x of f.formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = x.value;
    const vu = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
    return Math.round((vu - t) / 60_000);
  } catch { return 0; }
}

/**
 * Une date iCalendar → l'ISO du jeu. Trois formes, et trois seulement : journée entière (`20261117`), instant UTC
 * (`20261117T140000Z`), heure dans un fuseau nommé ou sans fuseau (prise comme heure locale de cet ordinateur).
 */
export function dateIcal(p: Propriete | null): { valeur: string; journee: boolean } {
  if (!p) return { valeur: '', journee: false };
  const v = p.valeur.trim();
  const jour = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (jour || p.params.VALUE === 'DATE') {
    const d = jour ?? /^(\d{4})(\d{2})(\d{2})/.exec(v);
    return d ? { valeur: `${d[1]}-${d[2]}-${d[3]}`, journee: true } : { valeur: '', journee: true };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return { valeur: '', journee: false };
  const [, a, mo, j, hh, mi, ss, z] = m;
  if (z) return { valeur: dateJeu(`${a}-${mo}-${j}T${hh}:${mi}:${ss}Z`), journee: false };
  const tz = p.params.TZID;
  if (!tz) return { valeur: `${a}-${mo}-${j}T${hh}:${mi}`, journee: false }; // heure flottante : telle quelle
  // deux passes : le décalage dépend de l'instant, que le décalage sert à trouver (changement d'heure)
  const brut = Date.UTC(Number(a), Number(mo) - 1, Number(j), Number(hh), Number(mi), Number(ss));
  const t1 = brut - decalageMinutes(tz, brut) * 60_000;
  const t = brut - decalageMinutes(tz, t1) * 60_000;
  return { valeur: dateJeu(new Date(t).toISOString()), journee: false };
}

const PROPRIETES_LUES = new Set(['UID', 'SUMMARY', 'DTSTART', 'DTEND', 'DURATION', 'LOCATION', 'STATUS', 'URL', 'RECURRENCE-ID']);

/** Les VEVENT d'un corps iCalendar, chacun réduit aux propriétés qui nous intéressent. */
export function evenements(ics: string): Propriete[][] {
  const res: Propriete[][] = [];
  let cours: Propriete[] | null = null;
  for (const ligne of deplier(ics)) {
    const nu = ligne.trim();
    if (/^BEGIN:VEVENT$/i.test(nu)) { cours = []; continue; }
    if (/^END:VEVENT$/i.test(nu)) { if (cours?.length) res.push(cours); cours = null; continue; }
    if (!cours || !nu) continue;
    const p = proprieteIcal(ligne);
    if (p && PROPRIETES_LUES.has(p.nom)) cours.push(p);
  }
  return res;
}

const trouver = (e: Propriete[], nom: string): Propriete | null => e.find((p) => p.nom === nom) ?? null;

/** Durée ISO 8601 d'un DURATION (PT1H30M, P1D) en millisecondes ; 0 si elle n'est pas lisible. */
export function dureeIcal(v: string): number {
  const m = /^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v ?? '').trim());
  if (!m) return 0;
  const n = (x: string | undefined) => Number(x ?? 0);
  const ms = ((n(m[2]) * 7 + n(m[3])) * 86_400 + n(m[4]) * 3600 + n(m[5]) * 60 + n(m[6])) * 1000;
  return m[1] ? -ms : ms;
}

/** Un VEVENT → une fiche du jeu. Sans identifiant ni début, il n'y a pas de rendez-vous. */
export function ficheCalDAV(e: Propriete[], href = ''): Enregistrement | null {
  const uid = texteIcal(trouver(e, 'UID')?.valeur ?? '', 300);
  if (!uid) return null;
  const debut = dateIcal(trouver(e, 'DTSTART'));
  if (!debut.valeur) return null;
  let fin = dateIcal(trouver(e, 'DTEND'));
  const duree = dureeIcal(trouver(e, 'DURATION')?.valeur ?? '');
  if (!fin.valeur && duree > 0) {
    const t = Date.parse(debut.journee ? `${debut.valeur}T00:00:00Z` : debut.valeur);
    if (Number.isFinite(t)) fin = { valeur: dateJeu(new Date(t + duree).toISOString(), debut.journee), journee: debut.journee };
  }
  const statut = texteIcal(trouver(e, 'STATUS')?.valeur ?? '', 40).toUpperCase();
  if (statut === 'CANCELLED') return null;
  // une occurrence d'une série porte le même UID que sa maîtresse : la date la distingue, sinon elles s'écrasent
  const occurrence = trouver(e, 'RECURRENCE-ID');
  return {
    externeId: `${occurrence ? `${uid}#${dateIcal(occurrence).valeur}` : uid}${href && !uid.includes('/') ? '' : ''}`.slice(0, 400),
    champs: {
      titre: texteIcal(trouver(e, 'SUMMARY')?.valeur ?? '', 200) || 'Rendez-vous',
      debut: debut.valeur,
      fin: fin.valeur,
      lieu: texteIcal(trouver(e, 'LOCATION')?.valeur ?? '', 200),
      etat: statut === 'TENTATIVE' ? 'à confirmer' : 'confirmé',
      lien: '',
    },
  };
}

// ---------------------------------------------------------------- écriture

/** Échappement RFC 5545 : la barre, le point-virgule, la virgule et les retours à la ligne. */
export const echapperIcal = (t: string): string =>
  String(t ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const horodatage = (t = Date.now()): string => `${new Date(t).toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;

/** Une date du jeu → une date iCalendar : journée entière en date nue, heure en UTC. */
export function versIcal(d: { valeur: string; journee: boolean }): { param: string; valeur: string } {
  if (d.journee) return { param: ';VALUE=DATE', valeur: d.valeur.replace(/-/g, '') };
  const t = Date.parse(/[Zz]|[+-]\d{2}:?\d{2}$/.test(d.valeur) ? d.valeur : `${d.valeur}:00`);
  return { param: '', valeur: horodatage(Number.isFinite(t) ? t : Date.now()) };
}

/** Le VCALENDAR complet d'un rendez-vous, plié à 75 octets comme le veut la RFC. */
export function vcalendar(uid: string, valeurs: Record<string, ValeurSortante>, maintenant = Date.now()): string {
  const debut = dateSortante(valeurs.debut);
  if (!debut) throw new ErreurSortante('Un rendez-vous a besoin d’une date de début.');
  const fin = dateSortante(valeurs.fin) ?? finParDefaut(debut);
  const d = versIcal(debut);
  const f = versIcal(fin.journee === debut.journee ? fin : debut);
  const titre = echapperIcal(texteIcal(String(valeurs.titre ?? ''), 200)) || 'Rendez-vous';
  const lieu = echapperIcal(texteIcal(String(valeurs.lieu ?? ''), 200));
  const etat = texteIcal(String(valeurs.etat ?? ''), 40).toLowerCase();
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Breizhcosystem//Living Business//FR', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${echapperIcal(uid)}`, `DTSTAMP:${horodatage(maintenant)}`,
    `DTSTART${d.param}:${d.valeur}`, `DTEND${f.param}:${f.valeur}`, `SUMMARY:${titre}`,
    ...(lieu ? [`LOCATION:${lieu}`] : []),
    `STATUS:${etat.startsWith('à confirmer') || etat === 'tentative' ? 'TENTATIVE' : 'CONFIRMED'}`,
    'END:VEVENT', 'END:VCALENDAR',
  ];
  return `${lignes.map(plier).join('\r\n')}\r\n`;
}

/** Pliage RFC 5545 : au-delà de 75 octets, la ligne continue à la suivante, précédée d'une espace. */
export function plier(ligne: string): string {
  if (Buffer.byteLength(ligne, 'utf8') <= 75) return ligne;
  const morceaux: string[] = [];
  let courant = '';
  for (const c of ligne) {
    if (Buffer.byteLength(courant + c, 'utf8') > (morceaux.length ? 74 : 75)) { morceaux.push(courant); courant = ''; }
    courant += c;
  }
  if (courant) morceaux.push(courant);
  return morceaux.map((m, i) => (i ? ` ${m}` : m)).join('\r\n');
}

/** Chemin du fichier d'un rendez-vous dans l'agenda : un UID sûr, suffixé .ics. */
export const cheminEvenement = (agenda: string, uid: string): string =>
  `${agenda.replace(/\/+$/, '')}/${encodeURIComponent(uid.replace(/[^A-Za-z0-9._@-]/g, '-')).slice(0, 180)}.ics`;

// ---------------------------------------------------------------- l'adaptateur

const CHEMIN = /^[/A-Za-z0-9._~%@:!$&'()*+,;=-]{1,500}$/;

function agenda(cfg: Config): string {
  const a = (cfg.agenda ?? '').trim();
  if (!a || !CHEMIN.test(a.replace(/^https:\/\/[^/]+/, ''))) throw new ErreurSortante('Choisissez l’agenda à brancher.');
  return a;
}

/** Corps du REPORT : les VEVENT de la période, avec leur contenu. */
export function requeteCalendrier(debut: string, fin: string): string {
  const q = (iso: string) => `${iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '').slice(0, 15)}Z`;
  return `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">`
    + `<d:prop><d:getetag/><c:calendar-data/></d:prop>`
    + `<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT">`
    + `<c:time-range start="${q(debut)}" end="${q(fin)}"/>`
    + `</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`;
}

export const agendaapple: Adaptateur = {
  id: 'agendaapple',
  nom: 'Agenda Apple (iCloud)',
  categorie: 'Agenda',
  couleur: '#1d1d1f',
  description: 'Les rendez-vous d’un agenda iCloud — ou de tout serveur CalDAV — dans les deux sens. Apple n’a pas de bouton « Se connecter avec » : un mot de passe d’application suffit, et se révoque d’un clic.',
  etapes: [
    'Sur account.apple.com, section Connexion et sécurité, créez un « mot de passe pour app » nommé Living Business.',
    'Collez-le ici avec votre adresse Apple. Il ne donne accès qu’à vos agendas et se révoque quand vous voulez.',
    'Choisissez l’agenda à brancher, puis jusqu’où regarder (90 jours par défaut).',
  ],
  champs: [
    { id: 'identifiant', libelle: 'Identifiant', aide: 'Votre adresse Apple (celle de votre iPhone), ou l’identifiant de votre compte CalDAV.', exemple: 'prenom@icloud.com', obligatoire: true },
    { id: 'motdepasse', libelle: 'Mot de passe d’application', aide: 'Créé sur account.apple.com › Connexion et sécurité › Mots de passe pour app. Jamais votre mot de passe Apple. Chiffré sur cet ordinateur, jamais affiché.', exemple: 'abcd-efgh-ijkl-mnop', secret: true, obligatoire: true },
    { id: 'serveur', libelle: 'Serveur', aide: 'Laissez vide pour iCloud. Un autre serveur CalDAV se met ici (Fastmail, Nextcloud, Infomaniak…).', exemple: SERVEUR_DEFAUT },
    { id: 'agenda', libelle: 'Agenda', aide: 'Lequel de vos agendas ? Choisissez-le dans la liste.', obligatoire: true, liste: true },
    { id: 'periode', libelle: 'Période', aide: 'Jusqu’où regarder dans le futur. Les 30 derniers jours sont toujours lus.', choix: ['periode30', 'periode90', 'periode180', 'periode365'], obligatoire: true },
  ],
  lecture: 'appel',
  ecriture: true,

  async lire(cfg, secret, f) {
    const { debut, fin } = bornes(cfg);
    const { donnees } = await appeler(f, adresse(cfg, agenda(cfg)), {
      methode: 'REPORT', entetes: entetes(cfg, secret, 1), corps: xml(requeteCalendrier(debut, fin)), texte: true, delaiMs: DELAI_MS,
    });
    const res: Enregistrement[] = [];
    const vus = new Set<string>();
    for (const r of reponses(typeof donnees === 'string' ? donnees : '')) {
      const ics = texteCalendrier(r);
      if (!ics) continue;
      for (const e of evenements(ics)) {
        const fiche = ficheCalDAV(e, premier(r, 'href'));
        if (fiche && !vus.has(fiche.externeId)) { vus.add(fiche.externeId); res.push(fiche); }
        if (res.length >= MAX) return res;
      }
    }
    return res;
  },

  async ecrire(cfg, secret, externeId, valeurs, f) {
    const uid = externeId && externeId.length <= 300 ? externeId.split('#')[0] ?? '' : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}@living-business`;
    const corps = vcalendar(uid, valeurs);
    await appeler(f, adresse(cfg, cheminEvenement(agenda(cfg), uid)), {
      methode: 'PUT',
      entetes: { ...entetes(cfg, secret), 'content-type': 'text/calendar; charset=utf-8' },
      corps: new CorpsBrut('text/calendar; charset=utf-8', corps),
      texte: true,
      delaiMs: DELAI_MS,
    });
    return uid;
  },

  async choix(champ, cfg, secret, f) {
    if (champ !== 'agenda') return [];
    return agendas(f, cfg, secret);
  },
};

/**
 * Le `calendar-data` d'une réponse : c'est du texte iCalendar à l'intérieur d'une balise XML, parfois en CDATA. Il est
 * dé-échappé comme du XML (&amp;), mais surtout pas « ramené à une ligne » : ses retours portent le sens.
 */
export function texteCalendrier(r: string): string {
  const brut = balises(r, 'calendar-data')[0];
  if (!brut) return '';
  return brut
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}
