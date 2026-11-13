/**
 * Passerelle privée HTTP — zéro dépendance (node:http).
 * Sécurité : CSP stricte (aucun script inline), cookies HttpOnly SameSite=Strict,
 * en-tête anti-CSRF obligatoire sur les écritures, corps limités, fichiers statiques en liste blanche,
 * erreurs sans détail interne, contrôle de rôle et de périmètre sur chaque requête (dans Monde).
 * Anti « DNS rebinding » : seuls les noms d'hôte locaux, les adresses IP et les noms déclarés (LB_ORIGINE, LB_HOTES) sont servis.
 * Connexion : comptes locaux (mot de passe, puis code de validation en deux étapes si la personne l'a activée) ;
 * l'installation et la réinitialisation sur place exigent d'être SUR l'ordinateur.
 * En ligne (LB_EN_LIGNE=1, serveur de l'entreprise derrière un proxy HTTPS) : installation à distance avec le code à
 * usage unique du serveur, secours avec le lien créé sur le serveur, validation en deux étapes exigée des administrateurs.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import type { Profil } from '../demo/donnees.ts';
import { Application, DUREES_PROPOSEES } from './application.ts';
import type { Compte } from './comptes.ts';
import { CodeInstallation, ipClient, Verrous } from './en-ligne.ts';
import { dansApplicationMac } from './bureau.ts';
import { nomsMachine, type Reseau } from './reseau.ts';
import { estEcritureMcp, examinerMcp, statutMcpModerne, traiterMcp } from './mcp.ts';
import { CANAL, ErreurApi, Monde } from './monde.ts';
import { VERSION_JEU } from './mises-a-jour.ts';
import { contactEditeur } from '../config/editeur.ts';
import { qrDataUrl } from './qr.ts';
import { signatairesEditeur } from './signataires.ts';
import { adressesTailscale, JETON_VERIFICATION, VerificationsTelephone } from './verification-telephone.ts';
import { CACHE_IMMUABLE, fichiersStatiques } from './statiques.ts';

/** Version de Living Business (package.json), montrée dans Réglages › À propos. */
const VERSION = VERSION_JEU;

export interface OptionsServeur {
  cookieSecure: boolean; // true derrière HTTPS
  dureeSessionMs: number;
  limiteCorps: number;
  /** Adresse publique (liens de formulaires). Défaut : déduite de l'en-tête Host. */
  origine: string | null;
  /** Appelé quand une restauration remplace l'application (le lanceur arrête alors la bonne au signal d'arrêt). */
  surRemplacement: ((app: Application) => void) | null;
  /** Mode équipe et lancement automatique (fourni par le lanceur ; absent dans les tests). */
  reseau: (() => Reseau | null) | null;
  /** Jeu en ligne sur le serveur de l'entreprise (LB_EN_LIGNE=1) : installation à distance par code, 2 étapes pour les administrateurs. */
  enLigne: boolean;
  /** Derrière un proxy de la même machine (LB_PROXY=1) : adresse du client = dernière valeur de X-Forwarded-For. */
  proxy: boolean;
}

const ENTETES_SECURITE: Record<string, string> = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-frame-options': 'DENY',
};

interface Session {
  /** Mode comptes : compte connecté et sa version (un changement de mot de passe coupe les autres sessions). */
  compteId: string | null;
  version: number;
  /** Mode démo : profil choisi ; mode comptes : profil du compte. */
  profilId: string;
  /** Aperçu « voir comme » (lecture seule) d'un administrateur. */
  voirComme: string | null;
  /** Mot de passe vérifié, code de validation en deux étapes attendu : la session ne donne encore accès à rien. */
  attente: 'code' | null;
  expire: number;
}

const DUREE_ATTENTE_CODE_MS = 5 * 60_000;
/** Écritures permises à une clé d'API par fenêtre de 10 minutes (les lectures ne comptent pas). */
export const ECRITURES_CLE_MAX = 600;
const ECRITURES_CLE_FENETRE_MS = 10 * 60_000;
/** Une tâche répétitive déclarée tient en quelques centaines d'octets : corps limité à 8 ko. */
const LIMITE_TACHE = 8_000;

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** Accepte l'application complète, ou un monde seul (enveloppé, sans disque). */
export function creerServeur(source: Monde | Application, o: Partial<OptionsServeur> = {}): Server {
  if (source instanceof Monde) throw new Error('creerServeur : passez une Application (Application.creer)');
  let app = source;
  let monde = app.monde;
  const opts: OptionsServeur = {
    cookieSecure: false, dureeSessionMs: 8 * 3600_000, limiteCorps: 1_100_000, origine: process.env.LB_ORIGINE ?? null, surRemplacement: null, reseau: null,
    enLigne: process.env.LB_EN_LIGNE === '1', proxy: process.env.LB_PROXY === '1', ...o,
  };
  const statiques = fichiersStatiques();
  const sessions = new Map<string, Session>();
  const flux = new Map<string, number>();
  const fluxOuverts = new Set<ServerResponse>();

  // ---- hôtes servis (anti DNS rebinding) et « sur place »
  const nomHote = (req: IncomingMessage): string => {
    const h = String(req.headers.host ?? '');
    const m = /^\[([0-9A-Fa-f:.]+)\](?::\d{1,5})?$/.exec(h) ?? /^([A-Za-z0-9.-]+)(?::\d{1,5})?$/.exec(h);
    return m ? (m[1] as string).toLowerCase() : '';
  };
  const hotesDeclares = new Set<string>();
  for (const x of (process.env.LB_HOTES ?? '').split(',')) if (x.trim()) hotesDeclares.add(x.trim().toLowerCase());
  try { if (opts.origine) hotesDeclares.add(new URL(opts.origine).hostname.toLowerCase().replace(/^\[|\]$/g, '')); } catch { /* origine invalide : ignorée */ }
  const hoteServi = (req: IncomingMessage) => {
    const h = nomHote(req);
    return h !== '' && (isIP(h) !== 0 || h === 'localhost' || h.endsWith('.localhost') || hotesDeclares.has(h) || (opts.reseau?.()?.hotesAutorises().includes(h) ?? false));
  };
  /** Requête faite depuis l'ordinateur lui-même (pas via un proxy). */
  const surPlace = (req: IncomingMessage) =>
    LOOPBACK.has(req.socket.remoteAddress ?? '') && ['127.0.0.1', 'localhost', '::1'].includes(nomHote(req)) && !req.headers['x-forwarded-for'] && !req.headers.forwarded;
  const exigerSurPlace = (req: IncomingMessage) => {
    if (!surPlace(req)) throw new ErreurApi(403, 'sur_place', 'Cette opération se fait sur l’ordinateur où tourne Living Business (adresse http://127.0.0.1…).');
  };

  // ---- limite d'essais par adresse (connexion, invitation, secours) ; derrière le proxy : adresse donnée par le proxy
  const ip = (req: IncomingMessage) => ipClient(req, opts.proxy);
  const essaisIp = new Map<string, { n: number; debut: number }>();
  const verrous = new Verrous(5, 15 * 60_000);
  const verifications = new VerificationsTelephone();
  const limiterIp = (req: IncomingMessage) => {
    const adresse = ip(req);
    const t = Date.now();
    const e = essaisIp.get(adresse);
    if (!e || t - e.debut > 600_000) { essaisIp.set(adresse, { n: 1, debut: t }); if (essaisIp.size > 10_000) essaisIp.clear(); return; }
    if (++e.n > 40) throw new ErreurApi(429, 'trop_d_essais', 'Trop d’essais depuis cette adresse : réessayez dans 10 minutes.');
  };

  // ---- clés d'API : débit d'écriture borné (constat revue-jeu-1-4). Un agent ou un script qui s'emballe, ou dont la
  // consigne a été détournée, ne noie pas le journal ni les données : 600 écritures par 10 minutes et par clé.
  const ecrituresCle = new Map<string, { n: number; debut: number }>();
  const limiterEcrituresCle = (sid: string, nombre = 1) => {
    if (nombre <= 0) return;
    const t = Date.now();
    const e = ecrituresCle.get(sid);
    if (!e || t - e.debut > ECRITURES_CLE_FENETRE_MS) { ecrituresCle.set(sid, { n: nombre, debut: t }); if (ecrituresCle.size > 5000) ecrituresCle.clear(); return; }
    if (e.n + nombre > ECRITURES_CLE_MAX) throw new ErreurApi(429, 'trop_d_ecritures', `Trop d’écritures avec cette clé d’API (${ECRITURES_CLE_MAX} par 10 minutes au plus) : réessayez dans quelques minutes.`);
    e.n += nombre;
  };
  /** Trace d'un événement de sécurité (comptes, liaison au réseau…) au nom du profil qui agit ; gardée 12 mois. */
  const tracerSecurite = (p: Profil | null | undefined, action: string, detail: string) => { if (p) monde.tracer(p, action, null, detail); };

  // ---- en ligne : première installation à distance avec le code à usage unique du serveur
  const installation = new CodeInstallation(opts.enLigne ? app.stockage?.dossier ?? null : null);
  if (opts.enLigne && app.connexion === 'comptes') {
    if (app.comptes.installe) installation.consommer();
    else if (installation.fichier) installation.preparer();
  }
  const aideInstallation = installation.fichier
    ? `Ouvrez le lien affiché à la fin de l’installation du serveur. Perdu ? Sur le serveur : « sudo cat ${installation.fichier} », puis ouvrez ${opts.origine ?? 'l’adresse du jeu'}/installation#<le code>.`
    : 'L’installation se fait sur l’ordinateur où Living Business est lancé : ouvrez http://127.0.0.1:4173 sur cet ordinateur-là.';
  /** Installation : sur place, ou (en ligne seulement) avec le code du serveur — 5 codes faux par adresse → 15 min de blocage. */
  const autoriserInstallation = (req: IncomingMessage) => {
    if (surPlace(req)) return;
    if (!opts.enLigne || !installation.actif) exigerSurPlace(req);
    const cle = `installation:${ip(req)}`;
    verrous.verifier(cle);
    const code = req.headers['x-lb-installation'];
    if (!installation.verifier(typeof code === 'string' ? code.trim() : null)) {
      verrous.echec(cle);
      throw new ErreurApi(403, 'code_installation', `Lien d’installation invalide ou déjà utilisé. ${aideInstallation}`);
    }
    verrous.reussite(cle);
  };
  /** Administrateur d'un jeu en ligne sans validation en deux étapes : il doit l'activer avant toute autre chose. */
  const deuxEtapesRequise = (c: Compte | null) => Boolean(opts.enLigne && c && !c.deuxEtapes && monde.profil(c.profilId)?.peutAdministrer);

  /** Après une restauration : nouvelle application, toutes les sessions et flux sont fermés. */
  const remplacerApplication = (n: Application) => {
    app = n;
    monde = n.monde;
    sessions.clear();
    flux.clear();
    for (const r of fluxOuverts) { try { r.end(); } catch { /* déjà fermé */ } }
    fluxOuverts.clear();
    opts.surRemplacement?.(n);
  };
  /** Adresse mise dans les liens envoyés : publique (LB_ORIGINE), sinon celle du bureau en mode équipe, sinon celle utilisée. */
  const origineDe = (req: IncomingMessage) => {
    if (opts.origine) return opts.origine;
    const partage = opts.reseau?.()?.urlPartage();
    if (partage && ['127.0.0.1', 'localhost', '::1'].includes(nomHote(req))) return partage;
    return `${opts.cookieSecure ? 'https' : 'http'}://${String(req.headers.host ?? '127.0.0.1').replace(/[^A-Za-z0-9.:[\]-]/g, '')}`;
  };
  const memeOrigine = (req: IncomingMessage) => {
    const origine = req.headers.origin;
    return !origine || origine === `http://${req.headers.host}` || origine === `https://${req.headers.host}`;
  };

  const lireTexte = (req: IncomingMessage): Promise<string> =>
    new Promise((ok, ko) => {
      const morceaux: Buffer[] = [];
      let taille = 0;
      req.on('data', (c: Buffer) => {
        taille += c.length;
        if (taille > opts.limiteCorps) { ko(new ErreurApi(413, 'trop_volumineux')); req.destroy(); return; }
        morceaux.push(c);
      });
      req.on('end', () => ok(Buffer.concat(morceaux).toString('utf8')));
      req.on('error', () => ko(new ErreurApi(400, 'lecture_impossible')));
    });

  /** Profil d'une clé d'API (en-tête Authorization: Bearer lb_…). */
  const parCle = (req: IncomingMessage): { sid: string; profil: Profil; canal: string } | null => {
    const a = req.headers.authorization;
    if (!a?.startsWith('Bearer lb_')) return null;
    const v = app.cles.verifier(a.slice(7).trim());
    if (!v) throw new ErreurApi(401, 'cle_invalide');
    return { sid: `cle:${v.id}`, profil: v.profil, canal: `cle:${v.id} « ${v.nom} »` };
  };

  /**
   * Décisions qu'une PERSONNE prend à l'écran, jamais une clé d'API (agent IA, Make, script), même avec un profil
   * administrateur : achats et engagements Breizhcosystem (mandat, agent, validation, commande, paiement, contact, réponse,
   * publication, demande de prix entre agents), liaison et adresse de Breizhcosystem, accord de partage, clés et accès
   * (une clé ne se donne pas une autre clé qui survivrait à sa révocation), automatisations (réglages, mise en marche,
   * tâches répétitives déclarées),
   * surveillance Bodacc, avis de sécurité (« J'ai vu » : c'est la personne avertie qui le dit, pas une clé créée avec
   * son profil) et vérification des nouvelles versions.
   */
  const reserveeAuxPersonnes = (methode: string, chemin: string): boolean => {
    if (chemin === '/cles' || chemin.startsWith('/cles/') || chemin === '/acces' || chemin.startsWith('/acces/')) return true;
    if (methode === 'GET') return false;
    if (chemin.startsWith('/securite/') || chemin === '/mises-a-jour') return true;
    if (chemin === '/nexus' || chemin === '/nexus/adresse' || chemin === '/nexus/liaison' || chemin === '/nexus/partage') return true;
    if (chemin === '/nexus/mandats' || chemin.startsWith('/nexus/mandats/') || chemin.startsWith('/nexus/commandes/') || chemin.startsWith('/nexus/besoins/')) return true;
    if (['/nexus/agent/lancer', '/nexus/agent/commander', '/nexus/agent/publier', '/nexus/contacter', '/nexus/proposer'].includes(chemin)) return true;
    if (chemin === '/nexus/echanges' || chemin.startsWith('/nexus/echanges/')) return true;
    if (chemin === '/automatisations/taches' || chemin.startsWith('/automatisations/taches/')) return true;
    return chemin === '/automatisations/reglages' || /^\/automatisations\/[a-z-]{1,40}$/.test(chemin) || chemin === '/bodacc';
  };

  const envoyer = (res: ServerResponse, statut: number, corps: unknown, entetes: Record<string, string> = {}) => {
    const b = Buffer.from(JSON.stringify(corps));
    res.writeHead(statut, { ...ENTETES_SECURITE, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': String(b.length), ...entetes });
    res.end(b);
  };

  const lireCorps = (req: IncomingMessage, limite = opts.limiteCorps): Promise<unknown> =>
    new Promise((ok, ko) => {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return ko(new ErreurApi(415, 'json_attendu'));
      const morceaux: Buffer[] = [];
      let taille = 0;
      req.on('data', (c: Buffer) => {
        taille += c.length;
        if (taille > limite) { ko(new ErreurApi(413, 'trop_volumineux')); req.destroy(); return; }
        morceaux.push(c);
      });
      req.on('end', () => {
        try { ok(morceaux.length ? JSON.parse(Buffer.concat(morceaux).toString('utf8')) : {}); }
        catch { ko(new ErreurApi(400, 'json_invalide')); }
      });
      req.on('error', () => ko(new ErreurApi(400, 'lecture_impossible')));
    });

  const sessionDe = (req: IncomingMessage): [string, Session] | null => {
    const m = /(?:^|;\s*)lb_session=([A-Za-z0-9_-]{43})(?:;|$)/.exec(req.headers.cookie ?? '');
    if (!m?.[1]) return null;
    const s = sessions.get(m[1]);
    if (!s || s.expire < Date.now()) { if (s) fermerSession(m[1]); return null; }
    s.expire = Date.now() + (s.attente ? DUREE_ATTENTE_CODE_MS : opts.dureeSessionMs);
    return [m[1], s];
  };
  const fermerSession = (sid: string) => { sessions.delete(sid); monde.oublierSession(sid); };

  const cookie = (valeur: string, maxAge: number) =>
    `lb_session=${valeur}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${opts.cookieSecure ? '; Secure' : ''}`;

  /** Ouvre une session neuve (nouvel identifiant : pas de fixation de session). Renvoie l'en-tête set-cookie. */
  const ouvrirSession = (req: IncomingMessage, s: Omit<Session, 'expire'>): Record<string, string> => {
    const ancienne = sessionDe(req);
    if (ancienne) fermerSession(ancienne[0]);
    const sid = randomBytes(32).toString('base64url');
    sessions.set(sid, { ...s, expire: Date.now() + (s.attente ? DUREE_ATTENTE_CODE_MS : opts.dureeSessionMs) });
    return { 'set-cookie': cookie(sid, Math.floor(opts.dureeSessionMs / 1000)) };
  };
  const sessionCompte = (req: IncomingMessage, c: Compte) => ouvrirSession(req, { compteId: c.id, version: c.version, profilId: c.profilId, voirComme: null, attente: null });
  const vueProfil = (p: Profil) => ({ id: p.id, nom: p.nom, role: p.role, peutAdministrer: p.peutAdministrer });

  /** État de connexion (avant toute authentification) : ce qu'il faut afficher. */
  const etatSession = (req: IncomingMessage) => {
    const s = sessionDe(req);
    let profil: Profil | null = null;
    let compte: Compte | null = null;
    let attenteCode = false;
    if (s && app.connexion === 'comptes') {
      const c = app.comptes.actif(s[1].compteId, s[1].version);
      if (!c) fermerSession(s[0]);
      else if (s[1].attente) attenteCode = true;
      else { compte = c; profil = monde.profil(s[1].voirComme ?? c.profilId); }
    } else if (s) profil = monde.profil(s[1].profilId);
    const installe = app.connexion === 'demo' || app.comptes.installe;
    return {
      connexion: app.connexion,
      installe,
      surPlace: surPlace(req),
      enLigne: opts.enLigne,
      /** En ligne, pas encore installé : installation possible depuis ce navigateur avec le code du serveur. */
      installationADistance: opts.enLigne && !installe && installation.actif,
      aideInstallation: installe ? null : aideInstallation,
      attenteCode,
      deuxEtapesRequise: deuxEtapesRequise(compte),
      entreprise: installe ? monde.organisation.nom : null,
      profil: profil ? vueProfil(profil) : null,
      compte: compte ? { identifiant: compte.identifiant, profilId: compte.profilId, deuxEtapes: Boolean(compte.deuxEtapes) } : null,
      apercu: Boolean(s?.[1].voirComme && compte),
      profilsDemo: app.connexion === 'demo' ? monde.profils().map(vueProfil) : [],
      existant: !installe && surPlace(req) ? monde.contenuExistant() : null,
      enregistre: app.stockage !== null,
      aideSecours: opts.enLigne
        ? 'sur le serveur, lancez « sudo living-business-secours » : le lien de réinitialisation s’affiche (15 minutes, une fois)'
        : process.env.LB_PAQUET === '1'
          ? (dansApplicationMac() ? 'ouvrez Living Business en maintenant la touche ⌥ (Option) enfoncée, puis « Ouvrir la page de secours »' : 'double-cliquez sur « Secours mot de passe » dans le dossier de Living Business')
          : 'lancez « npm run secours » dans le dossier du jeu',
    };
  };

  /** Routes de connexion (sans session). Renvoie true si la route a été traitée. */
  async function routesConnexion(req: IncomingMessage, res: ServerResponse, methode: string, chemin: string): Promise<boolean> {
    if (chemin === '/session') {
      if (methode === 'GET') { envoyer(res, 200, etatSession(req)); return true; }
      if (methode === 'POST') {
        const d = (await lireCorps(req)) as Record<string, unknown>;
        if (app.connexion === 'demo') {
          const profil = monde.profil(d.profilId);
          if (!profil) throw new ErreurApi(400, 'profil_inconnu');
          envoyer(res, 200, { profil: vueProfil(profil) }, ouvrirSession(req, { compteId: null, version: 0, profilId: profil.id, voirComme: null, attente: null }));
          return true;
        }
        limiterIp(req);
        if (!app.comptes.installe) throw new ErreurApi(409, 'non_installe', 'Living Business n’est pas encore installé.');
        const c = await app.comptes.connecter(d.identifiant, d.motDePasse, ip(req));
        const profil = monde.profil(c.profilId);
        if (!profil) throw new ErreurApi(403, 'compte_desactive', 'Ce compte n’a plus de profil : demandez à un administrateur.');
        // validation en deux étapes activée : le mot de passe ne suffit pas, le code est demandé (5 minutes)
        if (c.deuxEtapes) { envoyer(res, 200, { deuxEtapes: true }, ouvrirSession(req, { compteId: c.id, version: c.version, profilId: c.profilId, voirComme: null, attente: 'code' })); return true; }
        envoyer(res, 200, { profil: vueProfil(profil), deuxEtapesRequise: deuxEtapesRequise(c) }, sessionCompte(req, c));
        return true;
      }
      if (methode === 'DELETE') {
        const s = sessionDe(req);
        if (s) fermerSession(s[0]);
        envoyer(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
        return true;
      }
      throw new ErreurApi(405, 'methode');
    }
    if (app.connexion !== 'comptes') return false;
    // deuxième étape de la connexion : code de l'application d'authentification ou code de récupération
    if (chemin === '/session/code' && methode === 'POST') {
      limiterIp(req);
      const s = sessionDe(req);
      const c = s?.[1].attente ? app.comptes.actif(s[1].compteId, s[1].version) : null;
      if (!s || !c) { if (s?.[1].attente) fermerSession(s[0]); throw new ErreurApi(401, 'non_authentifie', 'Reconnectez-vous : identifiant et mot de passe.'); }
      const r = app.comptes.verifierDeuxEtapes(c.id, ((await lireCorps(req)) as Record<string, unknown>).code);
      const profil = monde.profil(c.profilId);
      if (!profil) throw new ErreurApi(403, 'compte_desactive', 'Ce compte n’a plus de profil : demandez à un administrateur.');
      envoyer(res, 200, { profil: vueProfil(profil), recuperation: r.recuperation, codesRestants: r.codesRestants }, sessionCompte(req, c));
      return true;
    }
    if (chemin === '/installation/verifier' && methode === 'POST') {
      if (app.comptes.installe) throw new ErreurApi(409, 'deja_installe', 'Living Business est déjà installé : connectez-vous.');
      limiterIp(req);
      autoriserInstallation(req);
      envoyer(res, 200, { ok: true });
      return true;
    }
    if (chemin === '/installation' && methode === 'POST') {
      if (app.comptes.installe) throw new ErreurApi(409, 'deja_installe', 'Living Business est déjà installé : connectez-vous.');
      limiterIp(req);
      autoriserInstallation(req);
      const r = await app.installer(await lireCorps(req));
      if (app.comptes.installe) installation.consommer();
      envoyer(res, 200, { profil: vueProfil(r.profil), codeSecours: r.codeSecours, deuxEtapesRequise: deuxEtapesRequise(r.compte) }, sessionCompte(req, r.compte));
      return true;
    }
    if (chemin === '/installation/restaurer' && methode === 'POST') {
      if (app.comptes.installe) throw new ErreurApi(409, 'deja_installe', 'Déjà installé : restaurez depuis Réglages → Sauvegardes.');
      limiterIp(req);
      autoriserInstallation(req);
      const d = (await lireCorps(req, 40_000_000)) as Record<string, unknown>;
      // la copie est lue (et sa phrase vérifiée) avant de toucher au registre des effacements repris avec elle
      const etat = await app.lireExport(d.fichier, d.phrase);
      app.importerEffacements(d.registre);
      remplacerApplication(await app.remplacer(etat, { quoi: 'copie exportée restaurée à l’installation' }));
      if (app.comptes.installe) installation.consommer();
      envoyer(res, 200, { ok: true, installe: app.comptes.installe }, { 'set-cookie': cookie('', 0) });
      return true;
    }
    let m = /^\/invitation\/([A-Za-z0-9_-]{43})$/.exec(chemin);
    if (m) {
      limiterIp(req);
      if (methode === 'GET') {
        const i = app.comptes.infoInvitation(m[1]);
        envoyer(res, 200, { identifiant: i.identifiant, nom: monde.profil(i.profilId)?.nom ?? null, entreprise: monde.organisation.nom });
        return true;
      }
      if (methode === 'POST') {
        const c = await app.comptes.accepterInvitation(m[1], ((await lireCorps(req)) as Record<string, unknown>).motDePasse);
        const profil = monde.profil(c.profilId);
        if (!profil) throw new ErreurApi(404, 'invitation_inconnue');
        tracerSecurite(profil, 'compte.mot_de_passe', 'mot de passe choisi avec le lien d’invitation');
        envoyer(res, 200, { profil: vueProfil(profil) }, sessionCompte(req, c));
        return true;
      }
      throw new ErreurApi(405, 'methode');
    }
    if (chemin === '/secours' && methode === 'POST') {
      limiterIp(req);
      const d = (await lireCorps(req)) as Record<string, unknown>;
      const r = await app.comptes.parCodeSecours(d.identifiant, d.code, d.motDePasse, ip(req));
      const profil = monde.profil(r.compte.profilId);
      if (!profil) throw new ErreurApi(403, 'compte_desactive');
      tracerSecurite(profil, 'compte.secours', 'mot de passe réinitialisé avec le code de secours (validation en deux étapes remise à zéro)');
      envoyer(res, 200, { profil: vueProfil(profil), codeSecours: r.codeSecours }, sessionCompte(req, r.compte));
      return true;
    }
    m = /^\/secours-local\/([A-Za-z0-9_-]{43})$/.exec(chemin);
    if (m) {
      limiterIp(req);
      // en local : depuis l'ordinateur seulement ; en ligne : le lien créé sur le serveur (commande de secours) suffit
      if (!opts.enLigne) exigerSurPlace(req);
      const cle = `secours:${ip(req)}`;
      verrous.verifier(cle);
      if (!app.stockage?.verifierDemandeSecours(m[1])) {
        verrous.echec(cle);
        throw new ErreurApi(404, 'demande_inconnue', opts.enLigne ? 'Lien de secours inconnu ou expiré : relancez « sudo living-business-secours » sur le serveur.' : 'Lien de secours inconnu ou expiré : relancez le secours sur cet ordinateur.');
      }
      if (methode === 'GET') { envoyer(res, 200, { comptes: app.comptes.administrateurs(monde.profils()), entreprise: monde.organisation.nom }); return true; }
      if (methode === 'POST') {
        const d = (await lireCorps(req)) as Record<string, unknown>;
        const c = await app.comptes.reinitialiserSurPlace(d.identifiant, d.motDePasse, monde.profils());
        app.stockage.effacerDemandeSecours();
        const profil = monde.profil(c.profilId) as Profil;
        tracerSecurite(profil, 'compte.secours', `mot de passe réinitialisé ${opts.enLigne ? 'avec le lien de secours créé sur le serveur' : 'sur l’ordinateur du jeu'} (validation en deux étapes remise à zéro)`);
        envoyer(res, 200, { profil: vueProfil(profil) }, sessionCompte(req, c));
        return true;
      }
      throw new ErreurApi(405, 'methode');
    }
    return false;
  }

  async function api(req: IncomingMessage, res: ServerResponse, chemin: string): Promise<void> {
    const methode = req.method ?? 'GET';
    // Entrée webhook (Make, Zapier, n8n…) : pas de session ; secret Bearer ou signature HMAC exigés.
    const entrant = /^\/entrant\/([A-Za-z0-9-]{1,40})$/.exec(chemin);
    if (entrant) {
      if (methode !== 'POST') throw new ErreurApi(405, 'methode');
      return envoyer(res, 200, app.synchro.recevoir(entrant[1] as string, req.headers, await lireTexte(req)));
    }
    const cle = parCle(req);
    if (cle && reserveeAuxPersonnes(methode, chemin)) throw new ErreurApi(403, 'session_requise', 'Décision réservée à une personne, depuis l’écran de Living Business : une clé d’API (agent IA, Make, script) ne peut pas le faire.');
    if (cle && methode !== 'GET') limiterEcrituresCle(cle.sid);
    // tout ce qu'une clé fait est écrit au journal avec la clé (et pas seulement le profil dont elle a les droits)
    if (cle) return CANAL.run(cle.canal, () => apiSuite(req, res, chemin, methode, cle));
    return apiSuite(req, res, chemin, methode, null);
  }

  async function apiSuite(req: IncomingMessage, res: ServerResponse, chemin: string, methode: string, cle: ReturnType<typeof parCle>): Promise<void> {
    if (methode !== 'GET' && !cle) {
      // Anti-CSRF : en-tête personnalisé (impose une requête même origine) + Origin cohérent si présent.
      if (req.headers['x-lb-requete'] !== '1') throw new ErreurApi(403, 'csrf');
      const origine = req.headers.origin;
      if (origine && origine !== `http://${req.headers.host}` && origine !== `https://${req.headers.host}`) throw new ErreurApi(403, 'origine');
    }

    if (await routesConnexion(req, res, methode, chemin)) return;

    let sid: string;
    let profil: Profil;
    let compte: Compte | null = null;
    let session: Session | null = null;
    if (cle) ({ sid, profil } = cle);
    else {
      const s = sessionDe(req);
      if (!s || s[1].attente) throw new ErreurApi(401, 'non_authentifie');
      sid = s[0];
      session = s[1];
      if (app.connexion === 'comptes') {
        compte = app.comptes.actif(s[1].compteId, s[1].version);
        if (!compte) { fermerSession(sid); throw new ErreurApi(401, 'non_authentifie'); }
      }
      // le profil est relu à chaque requête : un droit retiré s'applique immédiatement
      const pr = monde.profil(compte ? s[1].voirComme ?? compte.profilId : s[1].profilId);
      if (!pr) { s[1].voirComme = null; fermerSession(sid); throw new ErreurApi(401, 'non_authentifie'); }
      profil = pr;
    }
    // administrateur d'un jeu en ligne : validation en deux étapes d'abord, rien d'autre n'est possible avant
    if (deuxEtapesRequise(compte) && !chemin.startsWith('/compte/deux-etapes')) throw new ErreurApi(403, 'deux_etapes_requise', 'Administrateur d’un jeu en ligne : activez d’abord la validation en deux étapes.');
    // Aperçu « voir comme » (administrateur, lecture seule)
    if (chemin === '/session/apercu' && methode === 'POST') {
      if (!compte || !session) throw new ErreurApi(400, 'compte_requis');
      const moi = monde.profil(compte.profilId);
      if (!moi?.peutAdministrer) throw new ErreurApi(403, 'interdit');
      const cible = ((await lireCorps(req)) as Record<string, unknown>).profilId;
      if (cible === null || cible === compte.profilId) session.voirComme = null;
      else {
        const p = monde.profil(cible);
        if (!p) throw new ErreurApi(404, 'introuvable');
        session.voirComme = p.id;
      }
      monde.oublierSession(sid);
      return envoyer(res, 200, { profil: vueProfil(monde.profil(session.voirComme ?? compte.profilId) as Profil), apercu: session.voirComme !== null });
    }
    if (session?.voirComme && compte && methode !== 'GET') throw new ErreurApi(409, 'apercu', 'Aperçu en lecture seule : revenez à votre vue pour agir.');

    // Mon compte
    if (chemin === '/compte' || chemin.startsWith('/compte/')) {
      if (!compte || !session) throw new ErreurApi(400, 'compte_requis', 'Réservé aux comptes connectés.');
      const obligatoire = Boolean(opts.enLigne && monde.profil(compte.profilId)?.peutAdministrer);
      if (methode === 'GET' && chemin === '/compte') return envoyer(res, 200, { identifiant: compte.identifiant, profil: monde.profil(compte.profilId)?.nom ?? null, creeLe: compte.creeLe, derniereConnexion: compte.derniereConnexion, aSecours: compte.secours !== null, deuxEtapes: { ...app.comptes.resumeDeuxEtapes(compte), obligatoire } });
      // validation en deux étapes : activer (QR code + secret, confirmé par un premier code), désactiver, nouveaux codes
      if (methode === 'POST' && chemin === '/compte/deux-etapes') {
        const nom = monde.organisation.nom.replace(/\s*\((fictive?s?|démo)\)/gi, '').replace(/[:]/g, ' ').trim().slice(0, 40);
        const r = app.comptes.demarrerDeuxEtapes(compte.id, nom ? `Living Business (${nom})` : 'Living Business');
        return envoyer(res, 200, { ...r, qr: qrDataUrl(r.uri) });
      }
      if (methode === 'POST' && chemin === '/compte/deux-etapes/confirmer') {
        const r = app.comptes.confirmerDeuxEtapes(compte.id, ((await lireCorps(req)) as Record<string, unknown>).code);
        session.version = r.compte.version; // cette session reste ouverte, les autres tombent
        tracerSecurite(monde.profil(compte.profilId), 'compte.deux_etapes', 'validation en deux étapes activée');
        return envoyer(res, 200, { codes: r.codes });
      }
      if (methode === 'POST' && chemin === '/compte/deux-etapes/desactiver') {
        const d = (await lireCorps(req)) as Record<string, unknown>;
        const etaitActive = Boolean(compte.deuxEtapes);
        await app.comptes.desactiverDeuxEtapes(compte.id, d.motDePasse, d.code);
        if (etaitActive) tracerSecurite(monde.profil(compte.profilId), 'compte.deux_etapes', 'validation en deux étapes désactivée');
        return envoyer(res, 200, { ok: true, obligatoire });
      }
      if (methode === 'POST' && chemin === '/compte/deux-etapes/codes') {
        const codes = await app.comptes.nouveauxCodesRecuperation(compte.id, ((await lireCorps(req)) as Record<string, unknown>).motDePasse);
        tracerSecurite(monde.profil(compte.profilId), 'compte.deux_etapes', 'nouveaux codes de récupération');
        return envoyer(res, 200, { codes });
      }
      if (methode === 'PUT' && chemin === '/compte/mot-de-passe') {
        const d = (await lireCorps(req)) as Record<string, unknown>;
        const c = await app.comptes.changerMotDePasse(compte.id, d.actuel, d.nouveau);
        session.version = c.version; // cette session reste ouverte, les autres tombent
        tracerSecurite(monde.profil(compte.profilId), 'compte.mot_de_passe', 'mot de passe changé');
        return envoyer(res, 200, { ok: true });
      }
      if (methode === 'POST' && chemin === '/compte/secours') {
        const codeSecours = await app.comptes.nouveauCodeSecours(compte.id, ((await lireCorps(req)) as Record<string, unknown>).motDePasse);
        tracerSecurite(monde.profil(compte.profilId), 'compte.secours', 'nouveau code de secours');
        return envoyer(res, 200, { codeSecours });
      }
      throw new ErreurApi(404, 'introuvable');
    }

    // Mode équipe et lancement automatique (administrateur ; réglage sur l'ordinateur lui-même)
    if (chemin === '/reseau') {
      if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
      const r = opts.reseau?.() ?? null;
      if (methode === 'GET') return envoyer(res, 200, r ? { disponible: true, surPlace: surPlace(req), enLigne: opts.enLigne, ...r.etat() } : { disponible: false, surPlace: surPlace(req), enLigne: opts.enLigne, origine: opts.enLigne ? opts.origine : null });
      if (methode === 'PUT') {
        if (cle) throw new ErreurApi(403, 'interdit', 'Réglage depuis l’écran, pas avec une clé d’API.');
        if (!r) throw new ErreurApi(409, 'indisponible', 'Mode équipe indisponible : données en mémoire (démonstration).');
        exigerSurPlace(req);
        const d = (await lireCorps(req)) as Record<string, unknown>;
        let etat = r.etat();
        try {
          if (typeof d.equipe === 'boolean') etat = await r.regler(d.equipe);
          if (typeof d.demarrage === 'boolean') etat = r.reglerDemarrage(d.demarrage);
        } catch (e) {
          throw new ErreurApi(409, 'reglage_impossible', e instanceof Error ? e.message : 'Réglage impossible.');
        }
        return envoyer(res, 200, { disponible: true, surPlace: true, ...etat });
      }
      throw new ErreurApi(405, 'methode');
    }

    // « Mettre en ligne » : utiliser le jeu partout (Tailscale, serveur de l'entreprise, installation par Claude) ;
    // nom de la machine : le nom court, celui que Tailscale donne à l'appareil
    if (chemin === '/en-ligne' || chemin === '/en-ligne/suggestion') {
      if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
      if (methode === 'GET' && chemin === '/en-ligne') {
        return envoyer(res, 200, {
          enLigne: opts.enLigne, origine: opts.enLigne ? opts.origine : null, nexus: app.nexus.instantane().url, signataires: signatairesEditeur(),
          nomMachine: nomsMachine()[0]?.replace(/\.local$/, '') ?? null, port: req.socket.localPort ?? 4173, equipe: opts.reseau?.()?.equipe ?? false,
          entreprise: monde.organisation.nom, suggestionMasquee: app.reglages.suggestionEnLigneMasquee,
        });
      }
      if (methode === 'PUT' && chemin === '/en-ligne/suggestion') {
        app.regler({ suggestionEnLigneMasquee: ((await lireCorps(req)) as Record<string, unknown>).masquee !== false });
        return envoyer(res, 200, { suggestionMasquee: app.reglages.suggestionEnLigneMasquee });
      }
      throw new ErreurApi(405, 'methode');
    }

    // « Mettre en ligne » : vérifier que le jeu répond sur le téléphone (QR code vers /telephone#<jeton>)
    if (chemin === '/en-ligne/verification' && methode === 'POST') {
      if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
      const { jeton, expire } = verifications.creer();
      const port = req.socket.localPort ?? 4173;
      const r = opts.reseau?.() ?? null;
      const etat = r?.etat();
      const bases: Array<{ genre: string; url: string }> = opts.enLigne && opts.origine
        ? [{ genre: 'en-ligne', url: opts.origine }]
        : [
          ...adressesTailscale().map((ip) => ({ genre: 'tailscale', url: `http://${ip}:${port}` })),
          ...(etat?.equipe ? etat.adresses.map((url) => ({ genre: 'equipe', url })) : []),
        ];
      const adresses = bases.slice(0, 4).map((b) => { const lien = `${b.url.replace(/\/+$/, '')}/telephone#${jeton}`; return { ...b, lien, qr: qrDataUrl(lien) }; });
      return envoyer(res, 200, { jeton, expire, adresses, equipe: etat?.equipe ?? false, enLigne: opts.enLigne });
    }
    const verif = /^\/en-ligne\/verification\/([A-Za-z0-9_-]{22})$/.exec(chemin);
    if (verif && methode === 'GET') {
      if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
      const e = verifications.etat(verif[1] as string);
      if (!e) throw new ErreurApi(404, 'introuvable', 'Vérification expirée : relancez-la.');
      return envoyer(res, 200, e);
    }

    // Durées de conservation (administrateur) : choisies par l'entreprise, appliquées tout de suite puis chaque jour
    if (chemin === '/conservation') {
      if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
      if (methode === 'GET') return envoyer(res, 200, { ...app.reglages.conservation, proposees: DUREES_PROPOSEES });
      if (methode === 'PUT') {
        if (cle) throw new ErreurApi(403, 'session_requise', 'Durées de conservation : depuis l’écran de Living Business.');
        const d = (await lireCorps(req)) as Record<string, unknown>;
        const actuel = app.reglages.conservation;
        const pris = (k: 'planning' | 'avis' | 'courrier') => (k in d ? d[k] : actuel[k]);
        for (const k of ['planning', 'avis', 'courrier'] as const) {
          const v = pris(k);
          if (v !== null && !(DUREES_PROPOSEES as readonly unknown[]).includes(v)) throw new ErreurApi(400, 'duree_invalide', 'Durée : 6 mois, 1, 2 ou 3 ans, ou « sans limite ».');
        }
        app.regler({ conservation: { planning: pris('planning') as number | null, avis: pris('avis') as number | null, courrier: pris('courrier') as number | null } });
        const r = app.purgerDonneesAnciennes();
        return envoyer(res, 200, { ...app.reglages.conservation, proposees: DUREES_PROPOSEES, efface: r });
      }
      throw new ErreurApi(405, 'methode');
    }

    // Nouvelles versions (administrateur) : état, vérification immédiate, vérification quotidienne oui/non
    if (chemin === '/mises-a-jour') {
      if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
      if (methode === 'GET') return envoyer(res, 200, app.misesAJour());
      if (methode === 'POST') return envoyer(res, 200, await app.verifierMisesAJour());
      if (methode === 'PUT') {
        const auto = ((await lireCorps(req)) as Record<string, unknown>).auto;
        if (typeof auto !== 'boolean') throw new ErreurApi(400, 'requete_invalide');
        app.regler({ verifierMisesAJour: auto });
        tracerSecurite(profil, 'securite.versions', auto ? 'vérification quotidienne des nouvelles versions activée' : 'vérification quotidienne des nouvelles versions coupée');
        return envoyer(res, 200, auto ? await app.verifierMisesAJour() : app.misesAJour());
      }
      throw new ErreurApi(405, 'methode');
    }

    // Clients en difficulté (Bodacc) : activation par l'entreprise, vérification quotidienne
    if (chemin === '/bodacc') {
      if (methode === 'PUT') {
        if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
        const actif = ((await lireCorps(req)) as Record<string, unknown>).actif === true;
        app.regler({ surveillanceBodacc: actif });
        if (actif) await app.verifierBodacc().catch((e) => { throw new ErreurApi(502, 'bodacc_injoignable', e instanceof Error ? e.message : 'Bodacc injoignable.'); });
        return envoyer(res, 200, app.bodacc);
      }
      if (methode === 'POST') {
        if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
        await app.verifierBodacc().catch((e) => { throw new ErreurApi(502, 'bodacc_injoignable', e instanceof Error ? e.message : 'Bodacc injoignable.'); });
        return envoyer(res, 200, app.bodacc);
      }
    }

    // Breizhcosystem : liaison, partage ciblé, opportunités, comparaison, « Proposer à… »
    if (chemin === '/nexus' || chemin.startsWith('/nexus/')) {
      const n = app.nexus;
      const admin = () => { if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit'); };
      if (methode === 'GET' && chemin === '/nexus') {
        let partage: string[] | null = null;
        if (n.relie && profil.peutAdministrer) partage = await n.partage().catch(() => null);
        await n.etatPavillon();
        return envoyer(res, 200, { ...n.etat(), partage });
      }
      if (methode === 'PUT' && chemin === '/nexus/adresse') {
        admin();
        const avant = n.instantane().url;
        const r = await n.reglerAdresse(((await lireCorps(req)) as Record<string, unknown>).url);
        if (r.url !== avant) tracerSecurite(profil, 'reseau.adresse', `adresse du réseau Breizhcosystem : ${r.url ?? 'retirée'}`);
        return envoyer(res, 200, r);
      }
      if (chemin === '/nexus/liaison') {
        admin();
        if (methode === 'POST') return envoyer(res, 200, await n.demarrerLiaison());
        if (methode === 'GET') {
          const dejaReliee = n.relie;
          const r = await n.suivreLiaison();
          if (!dejaReliee && r.statut === 'reliee') tracerSecurite(profil, 'reseau.liaison', `entreprise reliée au réseau Breizhcosystem${'organisation' in r && r.organisation ? ` (${r.organisation})` : ''}`);
          return envoyer(res, 200, r);
        }
      }
      if (methode === 'DELETE' && chemin === '/nexus') {
        admin();
        const etaitReliee = n.relie;
        const r = n.delier();
        if (etaitReliee) tracerSecurite(profil, 'reseau.liaison', 'liaison avec le réseau Breizhcosystem retirée');
        return envoyer(res, 200, r);
      }
      if (methode === 'GET' && chemin === '/nexus/apercu') {
        admin();
        const { CATEGORIES, construirePartage } = await import('./lien-nexus.ts');
        // ce qui part aujourd'hui (accord dans le jeu ET coché sur Breizhcosystem), et ce que chaque catégorie enverrait
        const cats = n.relie ? await n.partage() : [];
        const d = app.donneesPartage();
        return envoyer(res, 200, { categories: cats, donnees: construirePartage(d, cats), possibles: construirePartage(d, CATEGORIES) });
      }
      if (methode === 'PUT' && chemin === '/nexus/partage') {
        admin();
        const r = await n.reglerPartage(((await lireCorps(req)) as Record<string, unknown>).categories);
        tracerSecurite(profil, 'reseau.partage', `partage avec le réseau Breizhcosystem : ${r.categories.length ? r.categories.join(', ') : 'rien'}`);
        return envoyer(res, 200, r);
      }
      if (methode === 'POST' && chemin === '/nexus/envoyer') { admin(); return envoyer(res, 200, await n.envoyer(app.donneesPartage())); }
      if (methode === 'GET' && chemin === '/nexus/opportunites') { if (!profil.peutAdministrer && !profil.voitScore) throw new ErreurApi(403, 'interdit'); return envoyer(res, 200, await n.opportunites()); }
      if (methode === 'GET' && chemin === '/nexus/comparaison') { if (!profil.voitScore) throw new ErreurApi(403, 'interdit'); return envoyer(res, 200, await n.comparaison()); }
      if (methode === 'POST' && chemin === '/nexus/proposer') { if (!profil.peutAdministrer && !profil.peutPreparer) throw new ErreurApi(403, 'interdit'); return envoyer(res, 200, await n.proposer(await lireCorps(req))); }
      if (methode === 'GET' && chemin === '/nexus/parrainages') { admin(); return envoyer(res, 200, await n.parrainages()); }
      // agents d'achat : mandats et commandes (administrateur)
      if (chemin === '/nexus/mandats') { admin(); if (methode === 'GET') return envoyer(res, 200, await n.mandats()); if (methode === 'POST') return envoyer(res, 200, await n.creerMandat(await lireCorps(req))); }
      const mm = /^\/nexus\/mandats\/([0-9a-f-]{36})\/(activer|desactiver)$/.exec(chemin);
      if (methode === 'POST' && mm) { admin(); return envoyer(res, 200, await n.basculerMandat(mm[1] as string, mm[2] === 'activer')); }
      if (methode === 'POST' && chemin === '/nexus/agent/lancer') { admin(); return envoyer(res, 200, await n.lancerAgent()); }
      // « Recherche-moi ça » : chercher, commander un stock (après avoir vu le total), publier la demande, contacter
      if (methode === 'POST' && chemin === '/nexus/agent/recherche') { admin(); return envoyer(res, 200, await n.rechercher(await lireCorps(req))); }
      if (methode === 'POST' && chemin === '/nexus/agent/commander') { admin(); return envoyer(res, 200, await n.commanderRecherche(await lireCorps(req))); }
      if (methode === 'POST' && chemin === '/nexus/agent/publier') { admin(); return envoyer(res, 200, await n.publierDemande(await lireCorps(req))); }
      if (methode === 'POST' && chemin === '/nexus/contacter') { admin(); return envoyer(res, 200, await n.contacter(await lireCorps(req))); }
      if (methode === 'GET' && chemin === '/nexus/commandes') { admin(); return envoyer(res, 200, await n.commandes()); }
      // échanges entre agents de deux entreprises : demander un prix (n'engage à rien) et suivre ; valider une proposition se
      // fait sur Breizhcosystem, connecté : la réponse donne l'adresse de la page, le jeu n'a aucune route pour valider
      if (chemin === '/nexus/echanges') {
        admin();
        if (methode === 'GET') return envoyer(res, 200, await n.echanges());
        if (methode === 'POST') return envoyer(res, 200, await n.demanderPrix(await lireCorps(req)));
      }
      // paiement direct au vendeur (jamais via Breizhcosystem) : page Stripe Checkout ou coordonnées de virement
      const mp = /^\/nexus\/commandes\/([0-9a-f-]{36})\/payer$/.exec(chemin);
      if (methode === 'POST' && mp) { admin(); return envoyer(res, 200, await n.payer(mp[1] as string, ((await lireCorps(req)) as Record<string, unknown> | null)?.mode)); }
      const mc2 = /^\/nexus\/commandes\/([0-9a-f-]{36})\/([a-z]+)$/.exec(chemin);
      if (methode === 'POST' && mc2) { admin(); return envoyer(res, 200, await n.agirCommande(mc2[1] as string, mc2[2] as string, await lireCorps(req))); }
      const mb = /^\/nexus\/besoins\/([0-9a-f-]{36})\/repondre$/.exec(chemin);
      if (methode === 'POST' && mb) { admin(); return envoyer(res, 200, await n.repondre(mb[1] as string, await lireCorps(req))); }
      throw new ErreurApi(404, 'introuvable');
    }

    // Avis de sécurité (export complet fait par un autre administrateur…) : « J'ai vu »
    const avis = /^\/securite\/avis\/([A-Za-z0-9_-]{12})\/vu$/.exec(chemin);
    if (methode === 'POST' && avis) return envoyer(res, 200, app.voirAvis(profil, avis[1]));

    // Sauvegardes (administrateur)
    if (chemin === '/sauvegardes' || chemin.startsWith('/sauvegardes/')) {
      if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
      if (methode === 'GET' && chemin === '/sauvegardes') return envoyer(res, 200, { auto: app.sauvegardesAuto(), enregistre: app.stockage !== null });
      if (methode === 'POST' && chemin === '/sauvegardes/export') {
        // tout part dans le fichier (comptes, données, et sur demande la clé des accès) : depuis l'écran seulement,
        // identité revérifiée (mot de passe, et code si la validation en deux étapes est active)
        if (cle) throw new ErreurApi(403, 'session_requise', 'Export : depuis l’écran de Living Business, pas avec une clé d’API.');
        const d = (await lireCorps(req)) as Record<string, unknown>;
        if (app.connexion === 'comptes') {
          if (!compte) throw new ErreurApi(403, 'session_requise');
          await app.comptes.confirmerIdentite(compte.id, d.motDePasse, d.code);
        }
        return envoyer(res, 200, await app.exporter(profil, d));
      }
      if (methode === 'POST' && chemin === '/sauvegardes/restaurer') {
        if (cle) throw new ErreurApi(403, 'interdit', 'Restauration : depuis l’écran, pas avec une clé d’API.');
        const d = (await lireCorps(req, 40_000_000)) as Record<string, unknown>;
        // tout l'état est remplacé (comptes, mots de passe, validation en deux étapes, clés) : identité revérifiée
        // comme pour l'export, avant de lire quoi que ce soit — une session prise ne suffit pas
        if (app.connexion === 'comptes') {
          if (!compte) throw new ErreurApi(403, 'session_requise');
          await app.comptes.confirmerIdentite(compte.id, d.motDePasse, d.code);
        }
        const etat = typeof d.nom === 'string' ? app.lireSauvegardeAuto(d.nom) : await app.lireExport(d.fichier, d.phrase);
        // registre des effacements repris avec la copie (autre serveur) : réuni au registre local, puis rejoué
        app.importerEffacements(d.registre);
        remplacerApplication(await app.remplacer(etat, { par: profil, quoi: typeof d.nom === 'string' ? `copie automatique restaurée (${d.nom.slice(0, 60)})` : 'copie exportée restaurée' }));
        return envoyer(res, 200, { ok: true }, { 'set-cookie': cookie('', 0) });
      }
      throw new ErreurApi(404, 'introuvable');
    }

    if (methode === 'GET' && chemin === '/flux') return ouvrirFlux(req, res, sid);
    if (methode === 'GET' && chemin === '/monde') {
      const v = await monde.vue(profil, sid);
      const satisfaction = app.enquetes.resume(profil);
      const opt = profil.peutAdministrer || profil.peutApprouver ? app.automatisations.optimisations(profil) : null;
      const sante = profil.voitScore ? app.sante(profil, sid) : null;
      return envoyer(res, 200, {
        ...v,
        sante: sante ? { score: sante.score, couverture: sante.couverture, fiabilite: sante.fiabilite, domaines: sante.domaines.map((d) => ({ id: d.id, libelle: d.libelle, icone: d.icone, score: d.score, couverture: d.couverture })), priorites: sante.priorites.map((x) => ({ id: x.id, libelle: x.libelle, score: x.score, mesure: x.mesure })) } : null,
        satisfaction,
        synchro: app.synchro.resume(),
        optimisations: opt ? { heuresMois: opt.heuresMois, euroMois: opt.euroMois, pistes: opt.opportunites.filter((x) => !x.active).length } : null,
        tempsReel: true,
        version: VERSION,
        // « Envie de structurer votre entreprise ? » : numéro de l'éditeur, null tant qu'il n'est pas rempli (pas d'encart)
        contactEditeur: contactEditeur(),
        enregistre: app.stockage !== null,
        bodacc: profil.peutAdministrer || profil.voitScore ? app.bodacc : null,
        avisSecurite: app.avisSecurite(profil),
        miseAJour: profil.peutAdministrer && app.misesAJour().disponible ? (({ derniere, securite }) => ({ version: derniere, securite }))(app.misesAJour()) : null,
        enLigne: opts.enLigne,
        suggestionEnLigne: !opts.enLigne && profil.peutAdministrer && !session?.voirComme && app.connexion === 'comptes' && !app.reglages.suggestionEnLigneMasquee,
      });
    }
    if (methode === 'GET' && chemin === '/sante') return envoyer(res, 200, app.santeAvecTendance(profil, sid));
    if (methode === 'POST' && chemin === '/comptabilite/fec') return envoyer(res, 200, app.importerFec(profil, sid, await lireCorps(req, 80_000_000)));
    if (methode === 'PUT' && chemin === '/organisation') return envoyer(res, 200, monde.modifierOrganisation(profil, sid, await lireCorps(req)));
    if (methode === 'POST' && chemin === '/objets/lot') return envoyer(res, 200, monde.creerObjets(profil, sid, await lireCorps(req)));
    // connecteurs (synchro dans les deux sens). Réglages (secrets, adresses, connexions) : depuis l'écran seulement,
    // jamais avec une clé d'API (qui échappe aussi à la validation en deux étapes) ; lister et synchroniser restent permis
    if (cle && chemin.startsWith('/synchro') && !(methode === 'GET' && chemin === '/synchro') && !(methode === 'POST' && /^\/synchro\/[^/]+\/maintenant$/.test(chemin))) {
      throw new ErreurApi(403, 'session_requise', 'Les connecteurs se règlent depuis l’écran de Living Business, pas avec une clé d’API.');
    }
    if (methode === 'GET' && chemin === '/sources') return envoyer(res, 200, await app.synchro.catalogue());
    if (methode === 'GET' && chemin === '/synchro') return envoyer(res, 200, app.synchro.lister(profil));
    if (methode === 'POST' && chemin === '/synchro/apercu') return envoyer(res, 200, await app.synchro.apercu(profil, await lireCorps(req)));
    if (methode === 'POST' && chemin === '/synchro/outils-mcp') return envoyer(res, 200, await app.synchro.outilsMcp(profil, await lireCorps(req)));
    if (methode === 'POST' && chemin === '/synchro') return envoyer(res, 200, app.synchro.creer(profil, await lireCorps(req)));
    // compte tout juste connecté : il figure dans la liste sans que rien n'ait été importé, en attendant qu'on choisisse
    if (methode === 'POST' && chemin === '/synchro/connexion') return envoyer(res, 200, app.synchro.connecter(profil, await lireCorps(req)));
    if (methode === 'POST' && chemin === '/synchro/microsoft/connexion') return envoyer(res, 200, await app.synchro.connexionMicrosoft(profil, await lireCorps(req)));
    const mxMs = /^\/synchro\/microsoft\/connexion\/([A-Za-z0-9_-]{22})$/.exec(chemin);
    if (methode === 'POST' && mxMs) return envoyer(res, 200, await app.synchro.suivreMicrosoft(profil, mxMs[1]));
    // « Se connecter avec… » (relais de Breizhcosystem) : le navigateur ne reçoit qu'une adresse à ouvrir et une référence
    if (methode === 'POST' && chemin === '/synchro/oauth/demarrer') return envoyer(res, 200, await app.synchro.demarrerOAuth(profil, await lireCorps(req), origineDe(req)));
    const mxOa = /^\/synchro\/oauth\/([A-Za-z0-9_-]{22})$/.exec(chemin);
    if (methode === 'POST' && mxOa) return envoyer(res, 200, await app.synchro.suivreOAuth(profil, mxOa[1]));
    if (methode === 'DELETE' && mxOa) return envoyer(res, 200, app.synchro.annulerOAuth(profil, mxOa[1]));
    if (methode === 'POST' && chemin === '/synchro/choix') return envoyer(res, 200, await app.synchro.choix(profil, await lireCorps(req)));
    // rapprochements par homonymie à confirmer par un administrateur (constat revue-jeu-1-2)
    if (methode === 'GET' && chemin === '/synchro/rapprochements') return envoyer(res, 200, app.synchro.rapprochements(profil));
    const mxRa = /^\/synchro\/([^/]+)\/rapprochements$/.exec(chemin);
    if (methode === 'POST' && mxRa) return envoyer(res, 200, app.synchro.deciderRapprochement(profil, decodeURIComponent(mxRa[1] as string), await lireCorps(req)));
    let mx = /^\/synchro\/([^/]+)$/.exec(chemin);
    if (methode === 'PUT' && mx) return envoyer(res, 200, app.synchro.modifier(profil, decodeURIComponent(mx[1] as string), await lireCorps(req)));
    if (methode === 'DELETE' && mx) return envoyer(res, 200, await app.synchro.supprimer(profil, decodeURIComponent(mx[1] as string)));
    mx = /^\/synchro\/([^/]+)\/maintenant$/.exec(chemin);
    if (methode === 'POST' && mx) return envoyer(res, 200, await app.synchro.synchroniser(decodeURIComponent(mx[1] as string), profil));
    // fichier de suivi (miroir.ts). Comme les connecteurs : il se règle depuis l'écran, jamais avec une clé d'API
    // (créer le classeur se sert d'une connexion à un outil) ; lire son état et relancer un envoi restent permis.
    if (cle && chemin.startsWith('/suivi') && !(methode === 'GET' && chemin === '/suivi') && chemin !== '/suivi/maintenant') {
      throw new ErreurApi(403, 'session_requise', 'Le fichier de suivi se règle depuis l’écran de Living Business, pas avec une clé d’API.');
    }
    if (methode === 'GET' && chemin === '/suivi') return envoyer(res, 200, app.miroir.vue(profil));
    if (methode === 'POST' && chemin === '/suivi') return envoyer(res, 200, await app.miroir.creer(profil, await lireCorps(req)));
    if (methode === 'PUT' && chemin === '/suivi') return envoyer(res, 200, app.miroir.regler(profil, await lireCorps(req)));
    if (methode === 'DELETE' && chemin === '/suivi') return envoyer(res, 200, app.miroir.detacher(profil));
    if (methode === 'POST' && chemin === '/suivi/reecrire') return envoyer(res, 200, app.miroir.toutReecrire(profil));
    if (methode === 'POST' && chemin === '/suivi/maintenant') {
      app.miroir.relancer(); // « Envoyer maintenant » : les envois en attente repartent sans attendre leur tour
      const r = await app.miroir.passer();
      await app.miroir.adopter().catch(() => 0);
      return envoyer(res, 200, { ...app.miroir.vue(profil), envoyees: r.envoyees, restants: r.restants });
    }
    // satisfaction
    if (methode === 'GET' && chemin === '/satisfaction') return envoyer(res, 200, app.enquetes.resume(profil));
    if (methode === 'POST' && chemin === '/enquetes') return envoyer(res, 200, app.enquetes.inviter(profil, ((await lireCorps(req)) as { cible?: unknown }).cible, origineDe(req)));
    if (methode === 'POST' && chemin === '/enquetes/lot') return envoyer(res, 200, app.enquetes.inviterLot(profil, await lireCorps(req), origineDe(req)));
    // optimiser
    if (methode === 'GET' && chemin === '/optimisations') return envoyer(res, 200, app.automatisations.optimisations(profil));
    if (methode === 'GET' && chemin === '/automatisations') return envoyer(res, 200, app.automatisations.lister(profil));
    if (methode === 'PUT' && chemin === '/automatisations/reglages') return envoyer(res, 200, app.automatisations.regler(profil, await lireCorps(req)));
    // « J'automatise » : état de chaque automatisation, puis tout ce qui est prêt activé d'un geste
    if (methode === 'GET' && chemin === '/automatisations/preparation') return envoyer(res, 200, app.automatisations.preparation(profil));
    if (methode === 'POST' && chemin === '/automatisations/tout') return envoyer(res, 200, app.automatisations.toutActiver(profil));
    // tâches répétitives déclarées (« est-ce que ça vaut le coup de l'automatiser ? ») : lire, estimer sans enregistrer,
    // ajouter, modifier, supprimer — écritures réservées aux administrateurs, à l'écran (jamais une clé d'API)
    if (methode === 'GET' && chemin === '/automatisations/taches') return envoyer(res, 200, app.automatisations.taches(profil));
    if (methode === 'POST' && chemin === '/automatisations/taches') return envoyer(res, 200, app.automatisations.ajouterTache(profil, await lireCorps(req, LIMITE_TACHE)));
    if (methode === 'POST' && chemin === '/automatisations/taches/estimation') return envoyer(res, 200, app.automatisations.estimerTache(profil, await lireCorps(req, LIMITE_TACHE)));
    mx = /^\/automatisations\/taches\/([0-9a-f-]{36})$/.exec(chemin);
    if (methode === 'PUT' && mx) return envoyer(res, 200, app.automatisations.modifierTache(profil, mx[1], await lireCorps(req, LIMITE_TACHE)));
    if (methode === 'DELETE' && mx) return envoyer(res, 200, app.automatisations.supprimerTache(profil, mx[1]));
    mx = /^\/automatisations\/([a-z-]{1,40})$/.exec(chemin);
    if (methode === 'POST' && mx) return envoyer(res, 200, app.automatisations.activer(profil, mx[1], await lireCorps(req)));
    // clés d'API
    if (methode === 'GET' && chemin === '/cles') return envoyer(res, 200, app.cles.lister(profil));
    if (methode === 'POST' && chemin === '/cles') return envoyer(res, 200, app.cles.creer(profil, await lireCorps(req), compte?.identifiant ?? null));
    mx = /^\/cles\/([^/]+)$/.exec(chemin);
    if (methode === 'DELETE' && mx) return envoyer(res, 200, app.cles.revoquer(profil, decodeURIComponent(mx[1] as string)));
    let m = /^\/objets\/([^/]+)$/.exec(chemin);
    if (methode === 'GET' && m) return envoyer(res, 200, monde.fiche(profil, sid, decodeURIComponent(m[1] as string)));
    // droit à l'effacement (supprimer ou anonymiser, en cascade) : depuis l'écran, jamais avec une clé d'API
    if (methode === 'DELETE' && m) {
      if (cle) throw new ErreurApi(403, 'session_requise', 'Effacement : depuis l’écran de Living Business, pas avec une clé d’API.');
      return envoyer(res, 200, app.effacerObjet(profil, sid, decodeURIComponent(m[1] as string), await lireCorps(req)));
    }
    // droit d'accès : ce que le jeu garde sur cette fiche, à remettre à la personne
    m = /^\/objets\/([^/]+)\/donnees$/.exec(chemin);
    if (methode === 'GET' && m) return envoyer(res, 200, app.donneesObjet(profil, sid, decodeURIComponent(m[1] as string)));
    if (methode === 'POST' && chemin === '/actions') return envoyer(res, 200, await monde.preparerAction(profil, sid, await lireCorps(req)));
    m = /^\/actions\/([^/]+)\/approuver$/.exec(chemin);
    if (methode === 'POST' && m) return envoyer(res, 200, await monde.approuver(profil, sid, decodeURIComponent(m[1] as string)));
    if (methode === 'POST' && chemin === '/simulation') {
      const d = (await lireCorps(req)) as { actif?: unknown };
      if (typeof d.actif !== 'boolean') throw new ErreurApi(400, 'actif_attendu');
      monde.definirSimulation(sid, d.actif);
      return envoyer(res, 200, { mode: d.actif ? 'simulation' : 'reel' });
    }
    if (methode === 'POST' && chemin === '/univers') {
      const d = (await lireCorps(req)) as { id?: unknown };
      monde.changerUnivers(profil, sid, d.id);
      return envoyer(res, 200, monde.vueUnivers());
    }
    if (methode === 'POST' && chemin === '/import/analyse') return envoyer(res, 200, monde.analyserImport(profil, sid, await lireCorps(req)));
    if (methode === 'POST' && chemin === '/import/confirmer') return envoyer(res, 200, monde.confirmerImport(profil, sid, await lireCorps(req)));
    // journal d'activité (200 lignes par page, la plus récente d'abord) ; « ?genre=securite » : les événements de
    // sécurité gardés à part pendant 12 mois (exports, restaurations, clés, accès, comptes, effacements…)
    if (methode === 'GET' && chemin === '/journal') {
      const q = new URL(req.url ?? '/', 'http://local').searchParams;
      const j = monde.journalPage(profil, { securite: q.get('genre') === 'securite', page: Number(q.get('page') ?? '1') });
      return envoyer(res, 200, j.lignes, { 'x-lb-total': String(j.total), 'x-lb-page': String(j.page), 'x-lb-pages': String(j.pages) });
    }
    if (methode === 'GET' && chemin === '/connecteurs') return envoyer(res, 200, monde.connecteurs());
    if (methode === 'POST' && chemin === '/connecteurs/demande') return envoyer(res, 200, monde.demanderConnecteur(profil, ((await lireCorps(req)) as { id?: unknown }).id));
    if (methode === 'POST' && chemin === '/import/sheets') return envoyer(res, 200, await monde.analyserSheets(profil, sid, await lireCorps(req)));
    if (methode === 'POST' && chemin === '/objets') return envoyer(res, 200, monde.creerObjet(profil, sid, await lireCorps(req)));
    if (methode === 'GET' && chemin === '/planning') { const q = new URL(req.url ?? '/', 'http://local').searchParams; return envoyer(res, 200, monde.planning(profil, sid, q.get('debut'), q.get('jours'))); }
    if (methode === 'POST' && chemin === '/planning') return envoyer(res, 200, monde.affecter(profil, sid, await lireCorps(req)));
    let mc = /^\/courrier\/([^/]+)\/statut$/.exec(chemin);
    if (methode === 'POST' && mc) return envoyer(res, 200, monde.statutCourrier(profil, sid, decodeURIComponent(mc[1] as string), await lireCorps(req)));
    if (methode === 'POST' && chemin === '/courrier/trier') return envoyer(res, 200, monde.trierCourrier(profil, sid, await lireCorps(req)));
    if (methode === 'GET' && chemin === '/acces') {
      const r = monde.listerAcces(profil);
      return envoyer(res, 200, { ...r, connexion: app.connexion, profils: r.profils.map((x) => ({ ...x, connexion: app.connexion === 'comptes' ? app.comptes.pourProfil(x.id) : null })) });
    }
    if (methode === 'POST' && chemin === '/acces') return envoyer(res, 200, monde.creerAcces(profil, await lireCorps(req)));
    mc = /^\/acces\/([^/]+)$/.exec(chemin);
    if (methode === 'PUT' && mc) {
      const id = decodeURIComponent(mc[1] as string);
      const d = await lireCorps(req);
      if ((d as Record<string, unknown>).peutAdministrer === false) app.comptes.verifierAdministrateurs(monde.profils(), id);
      return envoyer(res, 200, monde.modifierAcces(profil, id, d));
    }
    if (methode === 'DELETE' && mc) {
      const id = decodeURIComponent(mc[1] as string);
      app.comptes.verifierAdministrateurs(monde.profils(), id);
      const r = monde.supprimerAcces(profil, id);
      app.comptes.retirer(id);
      return envoyer(res, 200, r);
    }
    mc = /^\/acces\/([^/]+)\/(invitation|desactiver|reactiver)$/.exec(chemin);
    if (methode === 'POST' && mc) {
      if (app.connexion !== 'comptes') throw new ErreurApi(409, 'mode_demo', 'Démonstration : pas de comptes.');
      if (!profil.peutAdministrer) throw new ErreurApi(403, 'interdit');
      const cible = monde.profil(decodeURIComponent(mc[1] as string));
      if (!cible) throw new ErreurApi(404, 'introuvable');
      if (mc[2] === 'desactiver') {
        const r = app.comptes.desactiver(profil, cible.id, monde.profils());
        tracerSecurite(profil, 'compte.desactive', `compte de « ${cible.nom} » désactivé`);
        return envoyer(res, 200, r);
      }
      if (mc[2] === 'reactiver') {
        const r = app.comptes.reactiver(profil, cible.id);
        tracerSecurite(profil, 'compte.reactive', `compte de « ${cible.nom} » réactivé`);
        return envoyer(res, 200, r);
      }
      const r = app.comptes.inviter(profil, cible, ((await lireCorps(req)) as Record<string, unknown>).identifiant);
      tracerSecurite(profil, 'compte.invite', `lien d’invitation créé pour « ${cible.nom} » (nouveau compte ou mot de passe à refaire)`);
      const lien = `${origineDe(req)}/invitation/${r.jeton}`;
      const sujet = `Votre accès à Living Business — ${monde.organisation.nom}`;
      const corps = `Bonjour,\n\nVoici votre lien personnel pour accéder à Living Business (${monde.organisation.nom}) :\n${lien}\n\nVotre identifiant : ${r.identifiant}\nOuvrez le lien et choisissez votre mot de passe. Il est valable jusqu’au ${new Date(r.expire).toLocaleDateString('fr-FR')} et ne sert qu’une fois.\n`;
      const dest = r.identifiant.includes('@') ? encodeURIComponent(r.identifiant) : '';
      return envoyer(res, 200, { lien, expire: r.expire, identifiant: r.identifiant, mailto: `mailto:${dest}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}` });
    }
    if (methode === 'POST' && chemin === '/monde/exemple') return envoyer(res, 200, monde.changerExemple(profil, sid, ((await lireCorps(req)) as { jeu?: unknown }).jeu));
    if (methode === 'POST' && chemin === '/monde/vider-demo') return envoyer(res, 200, monde.viderDemo(profil, sid, await lireCorps(req), app.comptes.profilsAvecCompte()));
    throw new ErreurApi(404, 'introuvable');
  }

  /** Flux temps réel (Server-Sent Events) : signale qu'il y a du nouveau ; le client relit avec ses droits. */
  function ouvrirFlux(req: IncomingMessage, res: ServerResponse, sid: string) {
    const n = flux.get(sid) ?? 0;
    if (n >= 5 || app.abonnes >= 500) throw new ErreurApi(429, 'trop_de_flux');
    flux.set(sid, n + 1);
    fluxOuverts.add(res);
    res.writeHead(200, { ...ENTETES_SECURITE, 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    res.write('retry: 3000\n\n');
    let attente: NodeJS.Timeout | null = null;
    const desabonner = app.abonner(() => {
      if (attente) return; // regroupe les rafales (import, synchro)
      attente = setTimeout(() => { attente = null; res.write(`event: maj\ndata: {"le":"${new Date().toISOString()}"}\n\n`); }, 250);
    });
    const battement = setInterval(() => res.write(': battement\n\n'), 25_000);
    req.on('close', () => {
      fluxOuverts.delete(res);
      desabonner();
      clearInterval(battement);
      if (attente) clearTimeout(attente);
      flux.set(sid, Math.max(0, (flux.get(sid) ?? 1) - 1));
    });
  }

  /** Formulaire public de satisfaction : seul le jeton donne accès, à ce formulaire uniquement. */
  async function formulairePublic(req: IncomingMessage, res: ServerResponse, jeton: string) {
    const adresse = ip(req);
    if (req.method === 'GET') {
      const f = app.enquetes.formulaire(jeton, adresse);
      // information du client (RGPD art. 13) : la durée de conservation des avis choisie par l'entreprise, ou null
      return envoyer(res, 200, f.genre === 'client' ? { ...f, conservationJours: app.reglages.conservation.avis } : f);
    }
    if (req.method === 'POST') {
      if (!memeOrigine(req)) throw new ErreurApi(403, 'origine');
      return envoyer(res, 200, app.enquetes.repondre(jeton, await lireCorps(req), adresse));
    }
    throw new ErreurApi(405, 'methode');
  }

  /** Point d'entrée MCP (Claude, agents IA), pour les deux ères du protocole : clé d'API obligatoire, réponses JSON. */
  async function pointMcp(req: IncomingMessage, res: ServerResponse) {
    if (!memeOrigine(req)) throw new ErreurApi(403, 'origine');
    const cle = parCle(req);
    if (!cle) {
      res.writeHead(401, { ...ENTETES_SECURITE, 'content-type': 'application/json', 'www-authenticate': 'Bearer realm="living-business"' });
      res.end(JSON.stringify({ erreur: 'cle_requise', message: 'Ajoutez l’en-tête Authorization: Bearer <clé d’API> (Réglages → Clés d’API).' }));
      return;
    }
    if (req.method !== 'POST') { res.writeHead(405, { ...ENTETES_SECURITE, allow: 'POST' }); res.end(); return; }
    // ère du protocole décidée requête par requête : moderne (version dans `_meta`, en-têtes recopiés du corps et
    // contrôlés) ou ancienne (`initialize`) ; une requête mal formée ou d'une version non servie s'arrête ici
    const x = examinerMcp(req.headers, await lireCorps(req));
    if (x.ere === 'refus') return envoyer(res, x.statut, x.corps);
    // même débit d'écriture que l'API : les outils qui modifient comptent, les lectures non
    limiterEcrituresCle(cle.sid, x.messages.filter((m) => estEcritureMcp(m)).length);
    const reponses = [];
    for (const m of x.messages) {
      const r = await CANAL.run(cle.canal, () => traiterMcp(app, cle.profil, cle.sid, m, origineDe(req), x.ere));
      if (r !== null) reponses.push(r);
    }
    if (!reponses.length) { res.writeHead(202, ENTETES_SECURITE); res.end(); return; }
    return envoyer(res, x.ere === 'moderne' ? statutMcpModerne(reponses[0]) : 200, x.lot ? reponses : reponses[0]);
  }

  return createServer(async (req, res) => {
    let chemin: string;
    try {
      chemin = new URL(req.url ?? '/', 'http://local').pathname;
    } catch {
      return envoyer(res, 400, { erreur: 'url_invalide' });
    }
    // Vérification de bon fonctionnement (installateur du serveur, supervision) : aucune donnée, quel que soit le nom d'hôte
    if (chemin === '/api/v1/vivant' && (req.method === 'GET' || req.method === 'HEAD')) return envoyer(res, 200, { ok: true });
    if (!hoteServi(req)) {
      res.writeHead(421, { ...ENTETES_SECURITE, 'content-type': 'text/plain; charset=utf-8' });
      res.end('Nom d’hôte non autorisé. Déclarez-le dans LB_HOTES ou LB_ORIGINE.');
      return;
    }
    try {
      if (chemin.startsWith('/api/v1/')) return await api(req, res, chemin.slice('/api/v1'.length));
      if (chemin === '/mcp') return await pointMcp(req, res);
      const pub = /^\/api\/public\/formulaire\/([A-Za-z0-9_-]{1,64})$/.exec(chemin);
      if (pub) return await formulairePublic(req, res, pub[1] as string);
      // page du téléphone (« Mettre en ligne ») : seul le jeton, valable 10 minutes ; aucune donnée renvoyée
      const tel = /^\/api\/public\/telephone\/([A-Za-z0-9_-]{1,64})$/.exec(chemin);
      if (tel) {
        if (req.method !== 'POST') return envoyer(res, 405, { erreur: 'methode' });
        if (!memeOrigine(req) || req.headers['x-lb-requete'] !== '1') throw new ErreurApi(403, 'origine');
        limiterIp(req);
        const jeton = tel[1] as string;
        if (!JETON_VERIFICATION.test(jeton) || !verifications.marquer(jeton, req.headers['user-agent'])) throw new ErreurApi(404, 'introuvable', 'Ce lien a expiré : relancez la vérification sur l’ordinateur.');
        return envoyer(res, 200, { ok: true });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return envoyer(res, 405, { erreur: 'methode' });
      const f = /^\/f\/[A-Za-z0-9_-]{1,64}$/.test(chemin) ? statiques.get('/formulaire.html')
        : chemin === '/telephone' ? statiques.get('/telephone.html')
        : /^\/(invitation|secours)\/[A-Za-z0-9_-]{43}$/.test(chemin) || chemin === '/installation' ? statiques.get('/') : statiques.get(chemin);
      if (!f) return envoyer(res, 404, { erreur: 'introuvable' });
      // demandé avec sa version exacte (« ?v=… », ex. le sprite d'icônes) : immuable ; sinon revalidé par l'ETag (304)
      const versionDemandee = new URL(req.url ?? '/', 'http://local').searchParams.get('v');
      const cache = versionDemandee && versionDemandee === f.version ? CACHE_IMMUABLE : f.cache;
      const etag = { etag: f.etag, 'cache-control': cache };
      if (req.headers['if-none-match']?.split(/\s*,\s*/).includes(f.etag)) { res.writeHead(304, { ...ENTETES_SECURITE, ...etag }); res.end(); return; }
      res.writeHead(200, { ...ENTETES_SECURITE, 'content-type': f.type, 'content-length': String(f.contenu.length), ...etag });
      res.end(req.method === 'HEAD' ? undefined : f.contenu);
    } catch (e) {
      if (e instanceof ErreurApi) return envoyer(res, e.statut, { erreur: e.code, message: e.message });
      console.error('[passerelle] erreur interne', e instanceof Error ? e.message : e);
      if (!res.headersSent) envoyer(res, 500, { erreur: 'interne' });
    }
  });
}
