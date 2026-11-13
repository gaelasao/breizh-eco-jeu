/**
 * Temps réel : Living Business voit les changements de ses outils dès qu'ils arrivent, au lieu de les relire toutes les
 * N minutes. Airtable, Notion, Google Sheets, Excel (OneDrive, SharePoint), HubSpot et Pipedrive savent prévenir d'un
 * changement, mais seulement une adresse publique sur Internet : Living Business, installé chez l'entreprise, n'en a
 * pas. Breizhcosystem en a une et sert de relais :
 *   1. le jeu relié à Breizhcosystem garde un canal ouvert vers lui (`CanalTempsReel`, flux d'événements), authentifié
 *      par sa clé de liaison ; battement régulier, reconnexion avec attente croissante, un seul canal ;
 *   2. au branchement d'un outil, le jeu demande un abonnement à Breizhcosystem (une adresse d'avis propre à ce
 *      branchement, et le secret qui prouvera l'origine des avis), puis le crée lui-même chez l'outil avec SON jeton
 *      (`OUTILS_TEMPS_REEL`), le renouvelle avant son expiration et le supprime au débranchement. Notion et HubSpot
 *      déclarent leurs avis dans l'application de l'éditeur : rien à créer chez eux, Breizhcosystem reconnaît le compte ;
 *   3. à chaque avis, Breizhcosystem pousse sur le canal `{ connecteur, fournisseur, objets? }` (quel branchement, et au
 *      plus quelques identifiants), jamais une donnée : le jeu relit l'outil directement, regroupé sur 2 secondes.
 * La relecture régulière reste en filet de sécurité : toutes les 30 minutes quand le temps réel vit, à l'intervalle
 * choisi sinon. Sans liaison avec Breizhcosystem, rien ne change : chaque outil est relu à son intervalle.
 * Documentation des outils lue le 13 novembre 2026 : docs/CONNECTEURS.md, « Temps réel ».
 */
import { randomUUID } from 'node:crypto';
import { idFeuilleGoogle } from './sources-google.ts';
import { entetePipedrive, hotePipedrive } from './sources-metier.ts';
import { idPartage } from './sources-microsoft.ts';
import { appeler, ErreurSortante, type Recuperateur } from './sortant.ts';
import type { TypeSource } from './sources.ts';

export const FOURNISSEURS_TEMPS_REEL = ['airtable', 'notion', 'google', 'microsoft', 'hubspot', 'pipedrive', 'googleagenda', 'microsoftagenda'] as const;
export type FournisseurTempsReel = (typeof FOURNISSEURS_TEMPS_REEL)[number];
const estFournisseur = (x: unknown): x is FournisseurTempsReel => (FOURNISSEURS_TEMPS_REEL as readonly unknown[]).includes(x);

/**
 * Connecteurs qui peuvent passer en temps réel, et l'outil qui prévient. Le COURRIER n'y est pas : Gmail n'envoie ses
 * avis que par Cloud Pub/Sub (un service Google de plus à tenir chez l'éditeur, et un abonnement à renouveler au moins
 * tous les 7 jours), et une boîte se relit très bien toutes les quelques minutes.
 */
export const TEMPS_REEL_DE: Readonly<Partial<Record<TypeSource, FournisseurTempsReel>>> = {
  airtable: 'airtable', notion: 'notion', sheets: 'google', excel365: 'microsoft', hubspot: 'hubspot', pipedrive: 'pipedrive',
  agendagoogle: 'googleagenda', agendamicrosoft: 'microsoftagenda',
};

/** Relecture de sécurité quand le temps réel vit (jamais plus souvent que l'intervalle choisi par l'entreprise). */
export const FILET_TEMPS_REEL_S = 1800;
/** Avis regroupés : une seule relecture pour tous ceux qui arrivent dans cet intervalle. */
export const REGROUPEMENT_MS = 2000;

const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const JOUR = 86_400_000;
const HEURE = 3_600_000;
const iso = (t: number) => new Date(t).toISOString();
const dateIso = (x: unknown): string | null => {
  const t = typeof x === 'string' && x.length <= 40 ? Date.parse(x) : typeof x === 'number' ? x : Number.NaN;
  return Number.isFinite(t) ? iso(t) : null;
};

// ---------------------------------------------------------------- avis reçus sur le canal

export interface AvisRecu {
  connecteur: string;
  fournisseur: FournisseurTempsReel;
  /** Identifiants de ce qui a changé (au plus 20), quand l'outil les donne ; vide : relire tout le branchement. */
  objets: string[];
  /** Avis gardé par Breizhcosystem pendant que le jeu était éteint. */
  enAttente: boolean;
}

/** Avis du canal relu avant usage : branchement et outil connus, identifiants bornés ; null sinon. */
export function lireAvis(x: unknown): AvisRecu | null {
  if (!estObj(x) || typeof x.connecteur !== 'string' || !/^cx-[a-f0-9]{12}$/.test(x.connecteur) || !estFournisseur(x.fournisseur)) return null;
  const objets = Array.isArray(x.objets) ? x.objets.slice(0, 20).filter((o): o is string => typeof o === 'string' && /^[A-Za-z0-9._:-]{1,100}$/.test(o)) : [];
  return { connecteur: x.connecteur, fournisseur: x.fournisseur, objets, enAttente: x.enAttente === true };
}

// ---------------------------------------------------------------- canal vers Breizhcosystem

export interface OptionsCanal {
  /** Ouvre le flux (`LienNexus.fluxRelais`). */
  ouvrir: (signal: AbortSignal) => Promise<Response>;
  /** Le canal a-t-il lieu d'être (relié à Breizhcosystem, au moins un branchement abonné) ? Revu à chaque essai. */
  utile: () => boolean;
  surAvis: (a: AvisRecu) => void;
  /** Le canal vient de s'ouvrir ou de se fermer. */
  surEtat?: (enLigne: boolean) => void;
  /** Silence au-delà duquel le canal est tenu pour perdu et rouvert (75 s : trois battements de Breizhcosystem). */
  silenceMs?: number;
  /** Attente entre deux essais : 1 s, doublée à chaque échec, 5 min au plus (essais : plus court). */
  attenteMinMs?: number;
  attenteMaxMs?: number;
}

/**
 * Un seul canal par Living Business. Reconnexion avec attente croissante (et un peu de hasard, pour que tous les jeux
 * ne reviennent pas à la même seconde après une panne) ; remise à zéro après une connexion tenue une minute. Clé refusée
 * ou Breizhcosystem sans temps réel : nouvel essai bien plus tard. `enLigne` : ouvert ET entendu récemment.
 */
export class CanalTempsReel {
  readonly #o: OptionsCanal;
  readonly #silenceMs: number;
  readonly #min: number;
  readonly #max: number;
  #arrete = true;
  #ac: AbortController | null = null;
  #minuterie: NodeJS.Timeout | null = null;
  #veille: NodeJS.Timeout | null = null;
  #essais = 0;
  #ouvert = false;
  #entendu = 0;
  #enCours = false;

  constructor(o: OptionsCanal) {
    this.#o = o;
    this.#silenceMs = o.silenceMs ?? 75_000;
    this.#min = o.attenteMinMs ?? 1000;
    this.#max = o.attenteMaxMs ?? 300_000;
  }

  get enLigne(): boolean {
    return this.#ouvert && Date.now() - this.#entendu < this.#silenceMs;
  }

  demarrer(): void {
    if (!this.#arrete) return;
    this.#arrete = false;
    this.#planifier(0);
  }

  arreter(): void {
    this.#arrete = true;
    if (this.#minuterie) clearTimeout(this.#minuterie);
    this.#minuterie = null;
    this.#ac?.abort();
    this.#fermer();
  }

  /** Quelque chose a changé (liaison faite, nouvel abonnement) : essai tout de suite si le canal est fermé. */
  relancer(): void {
    if (this.#arrete || this.#ouvert || this.#enCours) return;
    this.#essais = 0;
    this.#planifier(0);
  }

  #planifier(ms: number) {
    if (this.#arrete) return;
    if (this.#minuterie) clearTimeout(this.#minuterie);
    this.#minuterie = setTimeout(() => { this.#minuterie = null; void this.#connecter(); }, ms);
    this.#minuterie.unref?.();
  }

  #attente(): number {
    const base = Math.min(this.#max, this.#min * 2 ** Math.min(this.#essais, 20));
    this.#essais++;
    return Math.round(base * (0.8 + Math.random() * 0.4));
  }

  #fermer() {
    if (this.#veille) clearInterval(this.#veille);
    this.#veille = null;
    const etait = this.#ouvert;
    this.#ouvert = false;
    if (etait) this.#o.surEtat?.(false);
  }

  async #connecter(): Promise<void> {
    if (this.#arrete || this.#enCours) return;
    if (!this.#o.utile()) { this.#planifier(60_000); return; }
    this.#enCours = true;
    const ac = new AbortController();
    this.#ac = ac;
    const debut = Date.now();
    let attente: number | null = null;
    try {
      const r = await this.#o.ouvrir(ac.signal);
      if (r.status !== 200 || !r.body) {
        await r.body?.cancel().catch(() => undefined);
        // clé refusée, entreprise suspendue, Breizhcosystem sans temps réel : inutile d'insister
        attente = [401, 403, 404, 409].includes(r.status) ? 30 * 60_000 : this.#attente();
        return;
      }
      await this.#lire(r.body, ac);
      if (Date.now() - debut >= 60_000) this.#essais = 0;
      attente = this.#attente();
    } catch {
      attente = this.#attente();
    } finally {
      this.#enCours = false;
      this.#ac = null;
      this.#fermer();
      if (!this.#arrete) this.#planifier(attente ?? this.#attente());
    }
  }

  /** Lit le flux : événements « pret », « battement », « avis », « fin » ; silence trop long : canal rouvert. */
  async #lire(corps: ReadableStream<Uint8Array>, ac: AbortController): Promise<void> {
    const lecteur = corps.getReader();
    const dec = new TextDecoder();
    let tampon = '';
    this.#entendu = Date.now();
    this.#veille = setInterval(() => { if (Date.now() - this.#entendu > this.#silenceMs) ac.abort(); }, Math.min(5000, this.#silenceMs / 3));
    this.#veille.unref?.();
    try {
      for (;;) {
        const { done, value } = await lecteur.read();
        if (done) return;
        this.#entendu = Date.now();
        tampon += dec.decode(value, { stream: true });
        if (tampon.length > 1_000_000) return; // flux anormal : refermé, puis rouvert
        for (let i = tampon.indexOf('\n\n'); i >= 0; i = tampon.indexOf('\n\n')) {
          const bloc = tampon.slice(0, i);
          tampon = tampon.slice(i + 2);
          let evenement = 'message';
          let donnees = '';
          for (const l of bloc.split('\n')) {
            if (l.startsWith('event:')) evenement = l.slice(6).trim();
            else if (l.startsWith('data:')) donnees += l.slice(5).trim();
          }
          if (evenement === 'pret' && !this.#ouvert) { this.#ouvert = true; this.#o.surEtat?.(true); }
          if (evenement === 'fin') return;
          if (evenement !== 'avis' || donnees.length > 10_000) continue;
          let x: unknown = null;
          try { x = JSON.parse(donnees); } catch { /* avis illisible : ignoré */ }
          const a = lireAvis(x);
          if (a) this.#o.surAvis(a);
        }
      }
    } finally {
      await lecteur.cancel().catch(() => undefined);
    }
  }
}

// ---------------------------------------------------------------- abonnements chez chaque outil

type Config = Readonly<Record<string, string>>;

/** Ce que le jeu sait de l'abonnement chez l'outil (identifiant, fin, ressource suivie, curseur, repère). */
export interface AbonnementOutil {
  externe: string | null;
  expire: string | null;
  /** Base Airtable, ressource Google, « lecteur/élément » du classeur Microsoft, hôte Pipedrive. */
  ressource: string | null;
  /** Secret tiré par l'outil lui-même (Airtable), remis à Breizhcosystem qui vérifie les avis avec ; jamais gardé ici. */
  secretOutil?: string;
  /** Airtable : curseur des charges à lire. */
  curseur?: number;
  /** Microsoft : étiquette du contenu du classeur (cTag) à la dernière relecture. */
  repere?: string;
}

/** Ce que Breizhcosystem a remis pour ce branchement : adresse des avis, secret, identifiant de l'authentification. */
export interface AdresseAvis { adresse: string; secret: string | null; utilisateur: string | null }

export interface OutilTempsReel {
  /** Notion, HubSpot : avis déclarés dans l'application de l'éditeur, rien à créer chez l'outil. */
  parApplication: boolean;
  /** Durée de vie chez l'outil (null : sans fin) et marge de renouvellement. */
  dureeMs: number | null;
  margeMs: number;
  /** Vérification régulière que l'abonnement existe encore chez l'outil (Pipedrive efface un webhook sans livraison). */
  verificationMs?: number;
  creer(cfg: Config, jeton: string, f: Recuperateur, p: AdresseAvis): Promise<AbonnementOutil>;
  renouveler?(cfg: Config, jeton: string, f: Recuperateur, a: AbonnementOutil, p: AdresseAvis): Promise<AbonnementOutil>;
  /** Vrai si l'abonnement existe toujours chez l'outil. */
  verifier?(cfg: Config, jeton: string, f: Recuperateur, a: AbonnementOutil): Promise<boolean>;
  supprimer(cfg: Config, jeton: string, f: Recuperateur, a: AbonnementOutil): Promise<void>;
  /** À un avis, avant de relire : faut-il relire, et ce qui change dans l'abonnement (curseur, repère, expiration). */
  avantRelecture?(cfg: Config, jeton: string, f: Recuperateur, a: AbonnementOutil): Promise<{ relire: boolean; abonnement: AbonnementOutil }>;
}

const bearer = (jeton: string) => ({ authorization: `Bearer ${jeton}` });

// Airtable : un webhook par base (`notificationUrl`), avis « ping » sans contenu, charges lues par l'API avec un curseur
// (ce qui repousse aussi l'expiration de 7 jours), rafraîchi avant ses 7 jours, supprimé au débranchement.
const AIRTABLE = 'https://api.airtable.com/v0';
const BASE_AIRTABLE = /^app[A-Za-z0-9]{14}$/;
const WEBHOOK_AIRTABLE = /^ach[A-Za-z0-9]{14}$/;
const baseAirtable = (cfg: Config): string => {
  const b = (cfg.base ?? '').trim();
  if (!BASE_AIRTABLE.test(b)) throw new ErreurSortante('Identifiant de base Airtable invalide.');
  return b;
};
const webhookAirtable = (a: AbonnementOutil): { base: string; id: string } => {
  if (!a.ressource || !BASE_AIRTABLE.test(a.ressource) || !a.externe || !WEBHOOK_AIRTABLE.test(a.externe)) throw new ErreurSortante('Webhook Airtable inconnu.');
  return { base: a.ressource, id: a.externe };
};
const airtable: OutilTempsReel = {
  parApplication: false, dureeMs: 7 * JOUR, margeMs: 2 * JOUR,
  async creer(cfg, jeton, f, p) {
    const base = baseAirtable(cfg);
    const table = (cfg.table ?? '').trim();
    // une table désignée par son identifiant (tbl…) : seuls ses changements ; par son nom : toute la base (relue pareil)
    const filters = { dataTypes: ['tableData'], ...(/^tbl[A-Za-z0-9]{14}$/.test(table) ? { recordChangeScope: table } : {}) };
    const { donnees } = await appeler(f, new URL(`${AIRTABLE}/bases/${base}/webhooks`), { methode: 'POST', entetes: bearer(jeton), corps: { notificationUrl: p.adresse, specification: { options: { filters } } } });
    const d = estObj(donnees) ? donnees : {};
    const id = typeof d.id === 'string' && WEBHOOK_AIRTABLE.test(d.id) ? d.id : null;
    const mac = typeof d.macSecretBase64 === 'string' && /^[A-Za-z0-9+/=]{16,200}$/.test(d.macSecretBase64) ? d.macSecretBase64 : null;
    if (!id || !mac) throw new ErreurSortante('Réponse d’Airtable inattendue à la création du webhook.');
    return { externe: id, expire: dateIso(d.expirationTime), ressource: base, secretOutil: mac, curseur: 1 };
  },
  async renouveler(_cfg, jeton, f, a) {
    const w = webhookAirtable(a);
    const { donnees } = await appeler(f, new URL(`${AIRTABLE}/bases/${w.base}/webhooks/${w.id}/refresh`), { methode: 'POST', entetes: bearer(jeton), corps: {} });
    return { ...a, expire: dateIso(estObj(donnees) ? donnees.expirationTime : null) ?? iso(Date.now() + 7 * JOUR) };
  },
  async supprimer(_cfg, jeton, f, a) {
    const w = webhookAirtable(a);
    await appeler(f, new URL(`${AIRTABLE}/bases/${w.base}/webhooks/${w.id}`), { methode: 'DELETE', entetes: bearer(jeton), texte: true });
  },
  async avantRelecture(_cfg, jeton, f, a) {
    const w = webhookAirtable(a);
    let curseur = a.curseur && a.curseur > 0 ? a.curseur : 1;
    let lues = 0;
    for (let page = 0; page < 10; page++) {
      const u = new URL(`${AIRTABLE}/bases/${w.base}/webhooks/${w.id}/payloads`);
      u.searchParams.set('cursor', String(curseur));
      const { donnees } = await appeler(f, u, { entetes: bearer(jeton) });
      const d = estObj(donnees) ? donnees : {};
      lues += Array.isArray(d.payloads) ? d.payloads.length : 0;
      if (typeof d.cursor === 'number' && Number.isInteger(d.cursor) && d.cursor >= curseur) curseur = d.cursor;
      if (d.mightHaveMore !== true) break;
    }
    // lire les charges repousse l'expiration du webhook de 7 jours (documentation d'Airtable)
    return { relire: lues > 0, abonnement: { ...a, curseur, expire: iso(Date.now() + 7 * JOUR) } };
  },
};

// Google Sheets : avis de Google Drive sur la feuille (`files.watch`), canal d'un jour au plus, rouvert chaque jour ;
// le jeton du canal est le secret de Breizhcosystem (`X-Goog-Channel-Token`) ; corps vide : la feuille est relue.
const DRIVE = 'https://www.googleapis.com/drive/v3';
const google: OutilTempsReel = {
  parApplication: false, dureeMs: JOUR, margeMs: 3 * HEURE,
  async creer(cfg, jeton, f, p) {
    if (!p.secret) throw new ErreurSortante('Secret du canal manquant.');
    const id = idFeuilleGoogle(cfg.classeur);
    const canal = randomUUID();
    const fin = Date.now() + JOUR - 5 * 60_000;
    const { donnees } = await appeler(f, new URL(`${DRIVE}/files/${encodeURIComponent(id)}/watch`), { methode: 'POST', entetes: bearer(jeton),
      corps: { id: canal, type: 'web_hook', address: p.adresse, token: p.secret, expiration: String(fin) } });
    const d = estObj(donnees) ? donnees : {};
    const ressource = typeof d.resourceId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(d.resourceId) ? d.resourceId : null;
    if (!ressource) throw new ErreurSortante('Réponse de Google inattendue à l’ouverture du canal.');
    const expire = typeof d.expiration === 'string' && /^\d{10,16}$/.test(d.expiration) ? iso(Number(d.expiration)) : iso(fin);
    return { externe: canal, expire, ressource };
  },
  async renouveler(cfg, jeton, f, a, p) {
    // nouveau canal d'abord (les deux vivent un instant ensemble), puis l'ancien est arrêté
    const neuf = await google.creer(cfg, jeton, f, p);
    await google.supprimer(cfg, jeton, f, a).catch(() => undefined);
    return neuf;
  },
  async supprimer(_cfg, jeton, f, a) {
    if (!a.externe || !a.ressource) return;
    await appeler(f, new URL(`${DRIVE}/channels/stop`), { methode: 'POST', entetes: bearer(jeton), corps: { id: a.externe, resourceId: a.ressource }, texte: true });
  },
};

// Excel (OneDrive, SharePoint) : abonnement Microsoft Graph au dossier racine du lecteur qui porte le classeur (seul
// possible sur OneDrive professionnel), `clientState` = secret de Breizhcosystem, moins de 30 jours, renouvelé avant ;
// à un avis, l'étiquette de contenu du classeur (cTag) dit s'il a changé, lui (le lecteur entier prévient).
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SEGMENT = /^[A-Za-z0-9!_.,-]{1,300}$/;
const DUREE_GRAPH_MS = 42_000 * 60_000; // sous le maximum de Microsoft (42 300 minutes)
async function classeurGraph(cfg: Config, jeton: string, f: Recuperateur): Promise<{ lecteur: string; element: string; ctag: string | null }> {
  const u = new URL(`${GRAPH}/shares/${idPartage(cfg.fichier)}/driveItem`);
  u.searchParams.set('$select', 'id,parentReference,cTag');
  const { donnees } = await appeler(f, u, { entetes: bearer(jeton) });
  const d = estObj(donnees) ? donnees : {};
  const element = String(d.id ?? '');
  const lecteur = String(estObj(d.parentReference) ? d.parentReference.driveId ?? '' : '');
  if (!SEGMENT.test(element) || !SEGMENT.test(lecteur)) throw new ErreurSortante('Classeur introuvable : vérifiez le lien et que votre compte y a accès.');
  return { lecteur, element, ctag: typeof d.cTag === 'string' ? d.cTag.slice(0, 300) : null };
}
const microsoft: OutilTempsReel = {
  parApplication: false, dureeMs: DUREE_GRAPH_MS, margeMs: 3 * JOUR,
  async creer(cfg, jeton, f, p) {
    if (!p.secret) throw new ErreurSortante('Secret de l’abonnement manquant.');
    const c = await classeurGraph(cfg, jeton, f);
    const { donnees } = await appeler(f, new URL(`${GRAPH}/subscriptions`), { methode: 'POST', entetes: bearer(jeton), delaiMs: 30_000,
      corps: { changeType: 'updated', notificationUrl: p.adresse, resource: `drives/${c.lecteur}/root`, expirationDateTime: iso(Date.now() + DUREE_GRAPH_MS), clientState: p.secret, latestSupportedTlsVersion: 'v1_2' } });
    const d = estObj(donnees) ? donnees : {};
    const id = typeof d.id === 'string' && /^[0-9a-f-]{36}$/i.test(d.id) ? d.id : null;
    if (!id) throw new ErreurSortante('Réponse de Microsoft inattendue à la création de l’abonnement.');
    return { externe: id, expire: dateIso(d.expirationDateTime) ?? iso(Date.now() + DUREE_GRAPH_MS), ressource: `${c.lecteur}/${c.element}`, ...(c.ctag ? { repere: c.ctag } : {}) };
  },
  async renouveler(_cfg, jeton, f, a) {
    if (!a.externe) throw new ErreurSortante('Abonnement Microsoft inconnu.');
    const { donnees } = await appeler(f, new URL(`${GRAPH}/subscriptions/${encodeURIComponent(a.externe)}`), { methode: 'PATCH', entetes: bearer(jeton), corps: { expirationDateTime: iso(Date.now() + DUREE_GRAPH_MS) } });
    return { ...a, expire: dateIso(estObj(donnees) ? donnees.expirationDateTime : null) ?? iso(Date.now() + DUREE_GRAPH_MS) };
  },
  async supprimer(_cfg, jeton, f, a) {
    if (!a.externe) return;
    await appeler(f, new URL(`${GRAPH}/subscriptions/${encodeURIComponent(a.externe)}`), { methode: 'DELETE', entetes: bearer(jeton), texte: true });
  },
  async avantRelecture(_cfg, jeton, f, a) {
    const [lecteur, element] = (a.ressource ?? '').split('/');
    if (!lecteur || !element || !SEGMENT.test(lecteur) || !SEGMENT.test(element)) return { relire: true, abonnement: a };
    const u = new URL(`${GRAPH}/drives/${encodeURIComponent(lecteur)}/items/${encodeURIComponent(element)}`);
    u.searchParams.set('$select', 'cTag');
    const { donnees } = await appeler(f, u, { entetes: bearer(jeton) });
    const ctag = estObj(donnees) && typeof donnees.cTag === 'string' ? donnees.cTag.slice(0, 300) : null;
    if (ctag && ctag === a.repere) return { relire: false, abonnement: a };
    return { relire: true, abonnement: { ...a, ...(ctag ? { repere: ctag } : {}) } };
  },
};

// Notion, HubSpot : avis déclarés dans l'application de l'éditeur ; rien à créer, renouveler ni supprimer chez l'outil.
const parApplication: OutilTempsReel = {
  parApplication: true, dureeMs: null, margeMs: 0,
  async creer() { return { externe: null, expire: null, ressource: null }; },
  async supprimer() { /* rien chez l'outil */ },
};

// Pipedrive : webhook créé par l'API (version 2.0, objet du branchement, toutes actions), authentifié par un identifiant
// et un mot de passe de Breizhcosystem ; vérifié chaque jour (Pipedrive efface un webhook resté 3 jours sans livraison).
const OBJET_PIPEDRIVE: Readonly<Record<string, string>> = { organizations: 'organization', persons: 'person', deals: 'deal' };
const pipedrive: OutilTempsReel = {
  parApplication: false, dureeMs: null, margeMs: 0, verificationMs: JOUR,
  async creer(cfg, jeton, f, p) {
    const objet = OBJET_PIPEDRIVE[cfg.objet ?? ''];
    if (!objet) throw new ErreurSortante('Objet Pipedrive invalide.');
    if (!p.secret || !p.utilisateur) throw new ErreurSortante('Identifiants de l’abonnement manquants.');
    const hote = hotePipedrive(cfg);
    const { donnees } = await appeler(f, new URL(`https://${hote}/api/v1/webhooks`), { methode: 'POST', entetes: entetePipedrive(cfg, jeton),
      corps: { subscription_url: p.adresse, event_action: '*', event_object: objet, version: '2.0', http_auth_user: p.utilisateur, http_auth_password: p.secret, name: 'Living Business' } });
    const d = estObj(donnees) && estObj(donnees.data) ? donnees.data : {};
    const id = typeof d.id === 'number' || (typeof d.id === 'string' && /^\d{1,20}$/.test(d.id)) ? String(d.id) : null;
    if (!id) throw new ErreurSortante('Réponse de Pipedrive inattendue à la création du webhook.');
    return { externe: id, expire: null, ressource: hote };
  },
  async verifier(cfg, jeton, f, a) {
    const { donnees } = await appeler(f, new URL(`https://${a.ressource ?? hotePipedrive(cfg)}/api/v1/webhooks`), { entetes: entetePipedrive(cfg, jeton) });
    const liste = estObj(donnees) && Array.isArray(donnees.data) ? donnees.data : [];
    return liste.some((w) => estObj(w) && String(w.id) === a.externe);
  },
  async supprimer(cfg, jeton, f, a) {
    if (!a.externe) return;
    await appeler(f, new URL(`https://${a.ressource ?? hotePipedrive(cfg)}/api/v1/webhooks/${encodeURIComponent(a.externe)}`), { methode: 'DELETE', entetes: entetePipedrive(cfg, jeton), texte: true });
  },
};

// Google Agenda : un canal `events.watch` sur l'agenda branché. Même mécanique que Google Drive (jeton du canal dans
// l'en-tête X-Goog-Channel-Token, corps vide, canal à rouvrir), mais sur l'agenda : aucun droit Drive n'est demandé.
// La durée de vie par défaut d'un canal est de 604 800 secondes ; un jour suffit, et le canal est rouvert chaque jour.
// https://developers.google.com/workspace/calendar/api/v3/reference/events/watch
const CALENDAR = 'https://www.googleapis.com/calendar/v3';
const ID_AGENDA_GOOGLE = /^[A-Za-z0-9._%+@#-]{1,320}$/;
const googleAgenda: OutilTempsReel = {
  parApplication: false, dureeMs: JOUR, margeMs: 3 * HEURE,
  async creer(cfg, jeton, f, p) {
    if (!p.secret) throw new ErreurSortante('Secret du canal manquant.');
    const agenda = (cfg.agenda ?? '').trim() || 'primary';
    if (!ID_AGENDA_GOOGLE.test(agenda)) throw new ErreurSortante('Identifiant d’agenda Google invalide.');
    const canal = randomUUID();
    const fin = Date.now() + JOUR - 5 * 60_000;
    const { donnees } = await appeler(f, new URL(`${CALENDAR}/calendars/${encodeURIComponent(agenda)}/events/watch`), { methode: 'POST', entetes: bearer(jeton),
      corps: { id: canal, type: 'web_hook', address: p.adresse, token: p.secret, expiration: String(fin) } });
    const d = estObj(donnees) ? donnees : {};
    const ressource = typeof d.resourceId === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(d.resourceId) ? d.resourceId : null;
    if (!ressource) throw new ErreurSortante('Réponse de Google inattendue à l’ouverture du canal de l’agenda.');
    const expire = typeof d.expiration === 'string' && /^\d{10,16}$/.test(d.expiration) ? iso(Number(d.expiration)) : iso(fin);
    return { externe: canal, expire, ressource };
  },
  async renouveler(cfg, jeton, f, a, p) {
    const neuf = await googleAgenda.creer(cfg, jeton, f, p);
    await googleAgenda.supprimer(cfg, jeton, f, a).catch(() => undefined);
    return neuf;
  },
  async supprimer(_cfg, jeton, f, a) {
    if (!a.externe || !a.ressource) return;
    // une seule adresse d'arrêt pour tous les canaux de l'API Agenda
    await appeler(f, new URL(`${CALENDAR}/channels/stop`), { methode: 'POST', entetes: bearer(jeton), corps: { id: a.externe, resourceId: a.ressource }, texte: true });
  },
};

// Agenda Microsoft 365 : abonnement Graph sur `me/events`, `clientState` = secret de Breizhcosystem. Microsoft limite
// un abonnement à un événement Outlook à 10 080 minutes (moins de sept jours) ; renouvelé trois jours avant la fin.
// https://learn.microsoft.com/en-us/graph/change-notifications-overview
const DUREE_AGENDA_GRAPH_MS = 10_000 * 60_000;
const microsoftAgenda: OutilTempsReel = {
  parApplication: false, dureeMs: DUREE_AGENDA_GRAPH_MS, margeMs: 3 * JOUR,
  async creer(_cfg, jeton, f, p) {
    if (!p.secret) throw new ErreurSortante('Secret de l’abonnement manquant.');
    const { donnees } = await appeler(f, new URL(`${GRAPH}/subscriptions`), { methode: 'POST', entetes: bearer(jeton), delaiMs: 30_000,
      corps: { changeType: 'created,updated,deleted', notificationUrl: p.adresse, resource: 'me/events', expirationDateTime: iso(Date.now() + DUREE_AGENDA_GRAPH_MS), clientState: p.secret, latestSupportedTlsVersion: 'v1_2' } });
    const d = estObj(donnees) ? donnees : {};
    const id = typeof d.id === 'string' && /^[0-9a-f-]{36}$/i.test(d.id) ? d.id : null;
    if (!id) throw new ErreurSortante('Réponse de Microsoft inattendue à la création de l’abonnement à l’agenda.');
    return { externe: id, expire: dateIso(d.expirationDateTime) ?? iso(Date.now() + DUREE_AGENDA_GRAPH_MS), ressource: 'me/events' };
  },
  async renouveler(_cfg, jeton, f, a) {
    if (!a.externe) throw new ErreurSortante('Abonnement Microsoft inconnu.');
    const { donnees } = await appeler(f, new URL(`${GRAPH}/subscriptions/${encodeURIComponent(a.externe)}`), { methode: 'PATCH', entetes: bearer(jeton), corps: { expirationDateTime: iso(Date.now() + DUREE_AGENDA_GRAPH_MS) } });
    return { ...a, expire: dateIso(estObj(donnees) ? donnees.expirationDateTime : null) ?? iso(Date.now() + DUREE_AGENDA_GRAPH_MS) };
  },
  supprimer: (cfg, jeton, f, a) => microsoft.supprimer(cfg, jeton, f, a),
};

export const OUTILS_TEMPS_REEL: Readonly<Record<FournisseurTempsReel, OutilTempsReel>> = {
  airtable, notion: parApplication, google, microsoft, hubspot: parApplication, pipedrive, googleagenda: googleAgenda, microsoftagenda: microsoftAgenda,
};

/**
 * Ce que le branchement suit chez l'outil : s'il change (autre base, autre feuille, autre classeur, autre objet),
 * l'abonnement est refait.
 */
export function suiviDe(source: TypeSource, cfg: Config): string {
  const champs: Readonly<Partial<Record<TypeSource, readonly string[]>>> = {
    airtable: ['base', 'table'], notion: ['base'], sheets: ['classeur'], excel365: ['fichier'], hubspot: ['objet'], pipedrive: ['objet', 'domaine'],
    agendagoogle: ['agenda'], agendamicrosoft: ['agenda'],
  };
  return (champs[source] ?? []).map((k) => cfg[k] ?? '').join('|').slice(0, 2000);
}

/**
 * L'avis concerne-t-il ce branchement ? HubSpot et Pipedrive disent le genre de fiche (« contact:12 », « deal:7 ») :
 * un branchement sur les entreprises ne relit pas pour un contact. Notion : un branchement sur un tableau précis
 * (« source:<id> ») ne relit que pour lui. Sans identifiant : oui.
 */
export function concerne(source: TypeSource, cfg: Config, objets: readonly string[]): boolean {
  if (!objets.length) return true;
  const genres: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    hubspot: { contacts: 'contact', companies: 'company', deals: 'deal' },
    pipedrive: { persons: 'person', organizations: 'organization', deals: 'deal' },
  };
  const g = genres[source]?.[cfg.objet ?? ''];
  if (g) return objets.some((o) => o.startsWith(`${g}:`));
  if (source === 'notion') {
    const m = /^source:([0-9a-f]{32})$/i.exec((cfg.base ?? '').trim());
    if (m) return objets.some((o) => o.replace(/-/g, '').toLowerCase() === (m[1] as string).toLowerCase());
  }
  return true;
}
