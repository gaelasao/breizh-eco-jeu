/**
 * Appels sortants vers les outils de l'entreprise (CRM, tableurs, Make, Zapier, serveurs MCP…).
 * Anti-SSRF : HTTPS obligatoire, pas d'identifiants dans l'URL, adresse résolue jamais privée,
 * de bouclage, locale ou réservée (IPv4, IPv6 et IPv4 intégrée dans IPv6 sous toutes ses formes) ;
 * redirections refusées ; délai et taille de réponse bornés (lecture morceau par morceau).
 * `recuperateurProtege` revérifie l'adresse AU MOMENT DE LA CONNEXION (résolution DNS faite par la
 * connexion elle-même) : un nom qui change d'adresse entre la vérification et l'appel (« DNS rebinding »)
 * ne mène jamais vers le réseau interne.
 * Exception de développement : `LB_AUTORISER_LOCAL=1` autorise http://localhost / 127.0.0.1 (tests, n8n local).
 */
import { lookup } from 'node:dns/promises';
import { lookup as resoudre, type LookupAddress } from 'node:dns';
import { Agent as AgentHttp, request as requeteHttp, type IncomingMessage } from 'node:http';
import { Agent as AgentHttps, request as requeteHttps } from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { pipeline, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

export type Recuperateur = typeof fetch;

export class ErreurSortante extends Error {
  readonly statut: number | null;
  constructor(message: string, statut: number | null = null) {
    super(message);
    this.statut = statut;
  }
}

/**
 * Réglage du connecteur absent ou mal saisi (objet non choisi, jeton manquant…) : ce n'est pas une panne de l'outil.
 * La passerelle répond 422 (jamais 502) et nomme le champ, que l'assistant marque en erreur (§4.6).
 */
export class ErreurReglage extends ErreurSortante {
  readonly champ: string | null;
  constructor(message: string, champ: string | null = null) {
    super(message, 422);
    this.champ = champ;
  }
}

const PRIVEES_V4: [number, number][] = [
  [0x00000000, 8], [0x0a000000, 8], [0x64400000, 10], [0x7f000000, 8], [0xa9fe0000, 16], [0xac100000, 12],
  [0xc0000000, 24], [0xc0000200, 24], [0xc0586300, 24], [0xc0a80000, 16], [0xc6120000, 15], [0xc6336400, 24],
  [0xcb007100, 24], [0xe0000000, 4], [0xf0000000, 4],
];

/** Les 8 groupes de 16 bits d'une adresse IPv6 (forme compressée, longue ou terminée par une IPv4) ; null si illisible. */
function groupesV6(ip: string): number[] | null {
  const morceaux = (ip.split('%')[0] ?? '').split('::');
  if (morceaux.length > 2) return null;
  const lire = (s: string): number[] | null => {
    if (!s) return [];
    const parts = s.split(':');
    const sortie: number[] = [];
    for (const [i, p] of parts.entries()) {
      if (i === parts.length - 1 && p.includes('.')) {
        if (isIP(p) !== 4) return null;
        const o = p.split('.').map(Number) as [number, number, number, number];
        sortie.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
      } else if (/^[0-9a-f]{1,4}$/i.test(p)) sortie.push(parseInt(p, 16));
      else return null;
    }
    return sortie;
  };
  const tete = lire(morceaux[0] ?? '');
  const queue = morceaux.length === 2 ? lire(morceaux[1] ?? '') : [];
  if (!tete || !queue) return null;
  const manquants = 8 - tete.length - queue.length;
  if (manquants < 0 || (morceaux.length === 1 && manquants !== 0)) return null;
  return [...tete, ...new Array<number>(manquants).fill(0), ...queue];
}

const v4DeGroupes = (a: number, b: number) => `${a >>> 8}.${a & 0xff}.${b >>> 8}.${b & 0xff}`;

export function adressePrivee(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const n = ip.split('.').reduce((a, x) => (a << 8) + Number(x), 0) >>> 0;
    return PRIVEES_V4.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits)));
  }
  if (v === 6) {
    // lecture des 8 groupes : « ::ffff:7f00:1 » (forme que produit new URL) et « ::ffff:127.0.0.1 » sont la même adresse
    const g = groupesV6(ip);
    if (!g) return true;
    const [g0 = 0, g1 = 0, , , , g5 = 0, g6 = 0, g7 = 0] = g;
    // IPv4 mappée (::ffff:0:0/96) : c'est l'adresse IPv4 qui est jointe
    if (g.slice(0, 5).every((x) => x === 0) && g5 === 0xffff) return adressePrivee(v4DeGroupes(g6, g7));
    // hors de l'espace public 2000::/3 : ::, ::1, IPv4 compatible (::a.b.c.d), NAT64 64:ff9b::/96 et /48, 100::/64,
    // 5f00::/16, uniques locales fc00::/7, lien local fe80::/10, site local fec0::/10, multidiffusion ff00::/8…
    if ((g0 & 0xe000) !== 0x2000) return true;
    // réservés dans 2000::/3 : 2001::/23 (Teredo, ORCHID, bancs d'essai…), 2001:db8::/32 et 3fff::/20 (documentation),
    // 2002::/16 (6to4 : IPv4 quelconque intégrée, abandonné)
    if (g0 === 0x2001 && (g1 < 0x0200 || g1 === 0x0db8)) return true;
    if (g0 === 0x2002) return true;
    if (g0 === 0x3fff && g1 < 0x1000) return true;
    return false;
  }
  return true;
}

const localAutorise = () => process.env.LB_AUTORISER_LOCAL === '1';

/** Vérifie une URL fournie par l'utilisateur avant tout appel. */
export async function verifierUrl(brut: unknown, hotesAutorises?: readonly string[]): Promise<URL> {
  if (typeof brut !== 'string' || brut.length > 2000) throw new ErreurSortante('Adresse manquante ou trop longue.');
  let u: URL;
  try {
    u = new URL(brut.trim());
  } catch {
    throw new ErreurSortante('Adresse invalide.');
  }
  if (u.username || u.password) throw new ErreurSortante('Pas d’identifiant dans l’adresse : utilisez le champ « jeton ».');
  const local = localAutorise() && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw new ErreurSortante('Seules les adresses https:// sont acceptées.');
  if (hotesAutorises && !hotesAutorises.some((h) => u.hostname === h || (h.startsWith('.') && u.hostname.endsWith(h)))) {
    throw new ErreurSortante(`Hôte non autorisé pour ce connecteur (${hotesAutorises.join(', ')}).`);
  }
  if (local) return u;
  const hote = u.hostname.replace(/^\[|\]$/g, '');
  const adresses = isIP(hote) ? [{ address: hote }] : await lookup(hote, { all: true }).catch(() => []);
  if (!adresses.length) throw new ErreurSortante('Nom de domaine introuvable.');
  if (adresses.some((a) => adressePrivee(a.address))) throw new ErreurSortante('Adresse interne ou privée refusée.');
  return u;
}

const TAILLE_MAX = 5_000_000;

/**
 * Lit le corps d'une réponse sans jamais garder plus de `max` octets en mémoire : longueur annoncée trop grande
 * refusée d'emblée, puis lecture morceau par morceau interrompue dès que la limite est dépassée.
 */
export async function lireTexteBorne(r: Response, max: number = TAILLE_MAX, message = 'Réponse trop volumineuse.'): Promise<string> {
  const annoncee = Number(r.headers.get('content-length') ?? '');
  if (Number.isFinite(annoncee) && annoncee > max) {
    await r.body?.cancel().catch(() => undefined);
    throw new ErreurSortante(message, r.status);
  }
  if (!r.body) return '';
  const lecteur = r.body.getReader();
  const morceaux: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await lecteur.cancel().catch(() => undefined);
        throw new ErreurSortante(message, r.status);
      }
      morceaux.push(value);
    }
  } catch (e) {
    if (e instanceof ErreurSortante) throw e;
    throw new ErreurSortante(e instanceof Error && e.name === 'TimeoutError' ? 'Le service ne répond pas (délai dépassé).' : 'Réponse interrompue.', r.status);
  }
  return new TextDecoder().decode(Buffer.concat(morceaux));
}

// ---------------------------------------------------------------- appel à adresse vérifiée à la connexion

const localPour = (hote: string) => localAutorise() && (hote === 'localhost' || hote === '127.0.0.1');

/** Résolution DNS faite par la connexion elle-même : l'adresse jointe est celle qui vient d'être vérifiée. */
const resolutionVerifiee: LookupFunction = (hote, options, rappel) => {
  resoudre(hote, { ...options, all: true }, (err, adresses) => {
    if (err) { rappel(err, []); return; }
    const liste = adresses as LookupAddress[];
    const premiere = liste[0];
    if (!premiere || (!localPour(hote) && liste.some((a) => adressePrivee(a.address)))) {
      rappel(Object.assign(new Error('Adresse interne ou privée refusée.'), { code: 'ELB_ADRESSE_PRIVEE' }), []);
      return;
    }
    if (options.all) rappel(null, liste);
    else rappel(null, premiere.address, premiere.family);
  });
};

const AGENTS = {
  'http:': new AgentHttp({ keepAlive: true, lookup: resolutionVerifiee }),
  'https:': new AgentHttps({ keepAlive: true, lookup: resolutionVerifiee }),
} as const;

const SANS_CORPS = new Set([101, 103, 204, 205, 304]);

function corpsEnOctets(corps: unknown): Buffer | null {
  if (corps === null || corps === undefined) return null;
  if (typeof corps === 'string') return Buffer.from(corps);
  if (corps instanceof URLSearchParams) return Buffer.from(corps.toString());
  if (corps instanceof Uint8Array) return Buffer.from(corps);
  if (corps instanceof ArrayBuffer) return Buffer.from(corps);
  throw new TypeError('Corps de requête non pris en charge.');
}

const echec = (cause: unknown) => new TypeError('fetch failed', { cause });

/**
 * `fetch` des appels sortants (par défaut partout où le jeu joint un outil, Breizhcosystem ou une source publique) :
 * mêmes réponses que `fetch`, mais chaque connexion résout le nom elle-même et refuse une adresse privée (aucun
 * écart entre vérification et connexion), adresse IP littérale contrôlée aussi, redirections jamais suivies
 * (`redirect: 'error'` respecté), seuls http et https. Réponse compressée (gzip, deflate, br) décompressée.
 */
export const recuperateurProtege: Recuperateur = async (entree, init = {}) => {
  if (entree instanceof Request) throw new TypeError('Requête non prise en charge : passez une adresse.');
  const u = new URL(String(entree));
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw echec(new Error('Protocole refusé.'));
  const hote = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(hote) && !localPour(hote) && adressePrivee(hote)) throw echec(new ErreurSortante('Adresse interne ou privée refusée.'));
  const entetes: Record<string, string> = {};
  new Headers(init.headers).forEach((v, k) => { entetes[k] = v; });
  entetes['accept-encoding'] ??= 'gzip, deflate, br';
  const corps = corpsEnOctets(init.body);
  if (corps) {
    entetes['content-length'] = String(corps.length);
    if (init.body instanceof URLSearchParams) entetes['content-type'] ??= 'application/x-www-form-urlencoded;charset=UTF-8';
  }
  const signal = init.signal ?? undefined;
  signal?.throwIfAborted();
  const methode = (init.method ?? 'GET').toUpperCase();
  const rep = await new Promise<IncomingMessage>((ok, ko) => {
    const envoi = u.protocol === 'https:' ? requeteHttps : requeteHttp;
    const req = envoi(u, { method: methode, headers: entetes, agent: AGENTS[u.protocol as 'http:' | 'https:'], lookup: resolutionVerifiee, ...(signal ? { signal } : {}) }, ok);
    req.on('error', (e) => ko(signal?.aborted ? signal.reason : echec(e)));
    req.end(corps ?? undefined);
  });
  const statut = rep.statusCode ?? 0;
  if (statut < 200 || statut > 599 || (init.redirect === 'error' && statut >= 300 && statut < 400)) {
    rep.destroy();
    throw echec(new Error(statut >= 300 && statut < 400 ? 'Redirection refusée.' : `Statut HTTP invalide (${statut}).`));
  }
  const h = new Headers();
  for (let i = 0; i + 1 < rep.rawHeaders.length; i += 2) {
    try { h.append(rep.rawHeaders[i] ?? '', rep.rawHeaders[i + 1] ?? ''); } catch { /* en-tête mal formé : ignoré */ }
  }
  const options = { status: statut, headers: h };
  if (SANS_CORPS.has(statut) || methode === 'HEAD') {
    rep.resume();
    return new Response(null, options);
  }
  const codage = (h.get('content-encoding') ?? '').trim().toLowerCase();
  const decodeur = codage === 'gzip' || codage === 'x-gzip' ? createGunzip() : codage === 'deflate' ? createInflate() : codage === 'br' ? createBrotliDecompress() : null;
  const flux: Readable = decodeur ? pipeline(rep, decodeur, () => undefined) : rep;
  signal?.addEventListener('abort', () => flux.destroy(signal.reason instanceof Error ? signal.reason : new Error('Abandon.')), { once: true });
  return new Response(Readable.toWeb(flux) as unknown as ReadableStream<Uint8Array>, options);
};

/** Corps déjà encodé (formulaire, XML…), envoyé tel quel avec son type ; tout autre corps part en JSON. */
export class CorpsBrut {
  readonly type: string;
  readonly contenu: string;
  constructor(type: string, contenu: string) {
    this.type = type;
    this.contenu = contenu;
  }
}

/**
 * Appel HTTP borné. Renvoie le JSON (ou le texte si `texte`).
 * `statutsLus` : statuts d'erreur dont l'appelant veut lire le corps au lieu de recevoir une erreur (le client MCP
 * distingue ainsi, sur un 400, 404 ou 405, un serveur récent qui explique son refus d'un serveur ancien).
 */
export async function appeler(
  f: Recuperateur,
  url: URL,
  init: { methode?: string; entetes?: Record<string, string>; corps?: unknown; texte?: boolean; delaiMs?: number; statutsLus?: readonly number[] } = {},
): Promise<{ statut: number; donnees: unknown; entetes: Headers }> {
  let r: Response;
  const corps = init.corps === undefined ? null : init.corps instanceof CorpsBrut ? init.corps : new CorpsBrut('application/json', JSON.stringify(init.corps));
  try {
    r = await f(url, {
      method: init.methode ?? 'GET',
      headers: { accept: 'application/json', 'user-agent': 'LivingBusiness/0.1 (+auto-heberge)', ...(corps ? { 'content-type': corps.type } : {}), ...init.entetes },
      body: corps?.contenu ?? null,
      redirect: 'manual',
      signal: AbortSignal.timeout(init.delaiMs ?? 15_000),
    });
  } catch (e) {
    throw new ErreurSortante(e instanceof Error && e.name === 'TimeoutError' ? 'Le service ne répond pas (délai dépassé).' : 'Service injoignable.');
  }
  if (r.status >= 300 && r.status < 400) throw new ErreurSortante('Redirection refusée par sécurité.', r.status);
  const brut = await lireTexteBorne(r, TAILLE_MAX);
  if (init.texte && init.statutsLus?.includes(r.status)) return { statut: r.status, donnees: brut, entetes: r.headers };
  if (r.status === 401 || r.status === 403) throw new ErreurSortante('Accès refusé : vérifiez le jeton et ses droits.', r.status);
  if (r.status === 404) throw new ErreurSortante('Introuvable : vérifiez l’identifiant (base, table, base de données…).', r.status);
  if (r.status === 429) throw new ErreurSortante('Trop de requêtes : le service limite le débit, nouvel essai plus tard.', r.status);
  if (r.status >= 400) throw new ErreurSortante(`Erreur du service (${r.status}).`, r.status);
  if (init.texte) return { statut: r.status, donnees: brut, entetes: r.headers };
  try {
    return { statut: r.status, donnees: brut ? JSON.parse(brut) : null, entetes: r.headers };
  } catch {
    throw new ErreurSortante('Réponse illisible (JSON attendu).', r.status);
  }
}
