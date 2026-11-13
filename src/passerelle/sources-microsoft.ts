/**
 * Microsoft 365 : un classeur Excel (OneDrive ou SharePoint) dans les deux sens, via Microsoft Graph.
 *
 * Tout se règle CHEZ L'ENTREPRISE, rien chez l'éditeur :
 * - elle inscrit une application dans SON annuaire Microsoft (Entra ID, gratuit) et y coche
 *   « Autoriser les flux de clients publics » : pas de secret d'application à garder ;
 * - la connexion se fait par code d'appareil : la personne ouvre microsoft.com/devicelogin, tape le code affiché
 *   et se connecte avec SON compte. Le jeu ne voit jamais le mot de passe ;
 * - droits délégués Files.ReadWrite.All : seulement les fichiers auxquels la personne connectée a déjà accès.
 * Le jeton de rafraîchissement est chiffré au repos et renouvelé à chaque usage (rotation enregistrée) ;
 * les jetons d'accès (1 h) restent en mémoire. Hôtes fixes : login.microsoftonline.com et graph.microsoft.com.
 *
 * Plus simple, quand Breizhcosystem est réglé : « Se connecter avec Microsoft » (relais de Breizhcosystem, application de l'éditeur,
 * portée Files.ReadWrite.All). Le jeu reçoit alors le jeton d'accès Graph tel quel (renouvelé par `synchro.ts`) :
 * ni annuaire ni application à inscrire. Le code d'appareil avec l'application de l'entreprise reste le mode avancé.
 */
import { createHash } from 'node:crypto';
import { parRelais } from './oauth-relais.ts';
import type { Adaptateur, ContexteAdaptateur, ValeurSortante } from './sources.ts';
import { appeler, ErreurSortante, lireTexteBorne, type Recuperateur } from './sortant.ts';
import { lignesVersEnregistrements, sansFormule } from './tableau.ts';

const CONNEXION = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
export const PORTEE_MICROSOFT = 'offline_access https://graph.microsoft.com/Files.ReadWrite.All';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOTES_VERIFICATION = ['microsoft.com', 'www.microsoft.com', 'login.microsoft.com', 'login.microsoftonline.com', 'aka.ms'];
const HOTES_FICHIER = ['.sharepoint.com'];
// OneDrive personnel (compte Microsoft grand public) : Microsoft n'y ouvre pas l'API Excel (« only the files stored in
// business platform are supported ») ; le lien est refusé tout de suite, avec la marche à suivre
const HOTES_PERSONNELS = ['onedrive.live.com', '1drv.ms'];
const REFUS_PERSONNEL = 'Ce classeur est sur un OneDrive personnel : Microsoft ne permet la synchronisation d’Excel qu’avec Microsoft 365 professionnel (OneDrive Entreprise ou SharePoint). Déposez le classeur sur votre OneDrive professionnel ou SharePoint, ou importez-le comme fichier (Connecter mes données → Fichier Excel / CSV).';

type Config = Readonly<Record<string, string>>;

export function annuaireMicrosoft(cfg: Config): string {
  const t = (cfg.tenant ?? '').trim().toLowerCase();
  if (t === 'consumers') throw new ErreurSortante(REFUS_PERSONNEL);
  if (GUID.test(t) || /^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63}){1,5}$/.test(t) || t === 'organizations') return t;
  throw new ErreurSortante('ID de l’annuaire invalide : un identifiant xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx ou votre domaine (ex. monentreprise.onmicrosoft.com).');
}

export function applicationMicrosoft(cfg: Config): string {
  const c = (cfg.client ?? '').trim().toLowerCase();
  if (!GUID.test(c)) throw new ErreurSortante('ID d’application invalide : xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (page « Vue d’ensemble » de l’application).');
  return c;
}

/** Message lisible pour une erreur du service de connexion Microsoft. */
function messageConnexion(json: Record<string, unknown>): string {
  const code = String(json.error ?? '');
  const detail = String(json.error_description ?? '');
  if (/AADSTS7000218/.test(detail)) return 'Dans l’inscription de l’application : Authentification → « Autoriser les flux de clients publics » → Oui, puis Enregistrer.';
  if (/AADSTS700016/.test(detail) || code === 'unauthorized_client') return 'Application introuvable dans cet annuaire : vérifiez l’ID d’application et l’ID de l’annuaire.';
  if (/AADSTS90002/.test(detail)) return 'Annuaire Microsoft introuvable : vérifiez l’ID de l’annuaire.';
  if (/AADSTS65001/.test(detail) || code === 'consent_required') return 'Autorisation manquante : reconnectez-vous et acceptez l’accès aux fichiers (ou demandez l’accord de l’administrateur Microsoft 365).';
  if (code === 'invalid_grant' || code === 'interaction_required') return 'Connexion Microsoft expirée ou retirée : reconnectez-vous (Réglages → Outils branchés).';
  return `Microsoft : ${(detail.split(/\r?\n/)[0] || code || 'connexion impossible').slice(0, 200)}`;
}

/** POST formulaire vers le service de connexion : renvoie aussi les erreurs OAuth (400) pour les interpréter. */
async function formulaireConnexion(f: Recuperateur, tenant: string, chemin: 'devicecode' | 'token', params: Record<string, string>): Promise<{ statut: number; json: Record<string, unknown> }> {
  const u = new URL(`${CONNEXION}/${encodeURIComponent(tenant)}/oauth2/v2.0/${chemin}`);
  let r: Response;
  try {
    r = await f(u, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(15_000),
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'LivingBusiness/0.1 (+auto-heberge)' },
      body: new URLSearchParams(params).toString(),
    });
  } catch {
    throw new ErreurSortante('Service de connexion Microsoft injoignable.');
  }
  const texte = await lireTexteBorne(r, 200_000, 'Réponse de connexion Microsoft trop volumineuse.');
  try {
    const json = JSON.parse(texte) as unknown;
    if (json && typeof json === 'object' && !Array.isArray(json)) return { statut: r.status, json: json as Record<string, unknown> };
  } catch { /* plus bas */ }
  throw new ErreurSortante(`Réponse de connexion Microsoft illisible (${r.status}).`);
}

// ---------------------------------------------------------------- jetons d'accès en mémoire

const ACCES = new Map<string, { acces: string; expire: number }>();
const empreinte = (r: string) => createHash('sha256').update(r).digest('base64url');

function memoriser(rafraichissement: string, acces: string, dureeS: number) {
  const maintenant = Date.now();
  for (const [k, v] of ACCES) if (v.expire <= maintenant) ACCES.delete(k);
  if (ACCES.size > 200) ACCES.clear();
  const d = Number.isFinite(dureeS) ? Math.max(60, Math.min(dureeS, 86_400)) : 3600;
  ACCES.set(empreinte(rafraichissement), { acces, expire: maintenant + d * 1000 });
}

/** Oublie les jetons d'accès en mémoire (tests). */
export function oublierJetonsMicrosoft() {
  ACCES.clear();
}

function lireSecret(secret: string | null): string {
  if (!secret) throw new ErreurSortante('Connexion Microsoft manquante : cliquez sur « Se connecter à Microsoft ».');
  try {
    const o = JSON.parse(secret) as { r?: unknown };
    if (typeof o.r === 'string' && o.r.length >= 10 && o.r.length <= 20_000) return o.r;
  } catch { /* plus bas */ }
  throw new ErreurSortante('Connexion Microsoft illisible : reconnectez-vous.');
}

// ---------------------------------------------------------------- connexion par code d'appareil

export interface DemandeAppareil {
  deviceCode: string;
  code: string;
  url: string;
  expireDans: number;
  intervalle: number;
}

export async function demarrerConnexionMicrosoft(cfg: Config, f: Recuperateur): Promise<DemandeAppareil> {
  const { statut, json } = await formulaireConnexion(f, annuaireMicrosoft(cfg), 'devicecode', { client_id: applicationMicrosoft(cfg), scope: PORTEE_MICROSOFT });
  if (statut !== 200) throw new ErreurSortante(messageConnexion(json));
  let v: URL;
  try {
    v = new URL(String(json.verification_uri ?? ''));
  } catch {
    throw new ErreurSortante('Adresse de connexion Microsoft manquante.');
  }
  if (v.protocol !== 'https:' || v.username || v.password || !HOTES_VERIFICATION.includes(v.hostname)) throw new ErreurSortante('Adresse de connexion Microsoft inattendue.');
  const code = String(json.user_code ?? '');
  const deviceCode = String(json.device_code ?? '');
  if (!/^[A-Za-z0-9-]{4,24}$/.test(code) || !deviceCode || deviceCode.length > 4000) throw new ErreurSortante('Réponse de connexion Microsoft incomplète.');
  const borne = (x: unknown, min: number, max: number, defaut: number) => { const n = Number(x); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : defaut; };
  return { deviceCode, code, url: v.toString(), expireDans: borne(json.expires_in, 60, 1800, 900), intervalle: borne(json.interval, 2, 30, 5) };
}

export type SuiviAppareil = { statut: 'attente' } | { statut: 'connecte'; secret: string } | { statut: 'refuse' | 'expire'; message: string };

export async function suivreConnexionMicrosoft(cfg: Config, deviceCode: string, f: Recuperateur): Promise<SuiviAppareil> {
  const { statut, json } = await formulaireConnexion(f, annuaireMicrosoft(cfg), 'token', {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: applicationMicrosoft(cfg), device_code: deviceCode,
  });
  if (statut === 200) {
    if (typeof json.refresh_token !== 'string' || typeof json.access_token !== 'string') return { statut: 'refuse', message: 'Microsoft n’a pas accordé l’accès durable (offline_access).' };
    memoriser(json.refresh_token, json.access_token, Number(json.expires_in));
    return { statut: 'connecte', secret: JSON.stringify({ r: json.refresh_token }) };
  }
  const e = String(json.error ?? '');
  if (e === 'authorization_pending' || e === 'slow_down') return { statut: 'attente' };
  if (e === 'authorization_declined' || e === 'access_denied') return { statut: 'refuse', message: 'Connexion refusée dans la fenêtre Microsoft.' };
  if (e === 'expired_token' || e === 'bad_verification_code') return { statut: 'expire', message: 'Le code a expiré : relancez « Se connecter à Microsoft ».' };
  return { statut: 'refuse', message: messageConnexion(json) };
}

/** Jeton d'accès Graph : en mémoire s'il est encore valable, sinon renouvelé (et la rotation enregistrée). */
export async function jetonAccesMicrosoft(cfg: Config, secret: string | null, f: Recuperateur, ctx?: ContexteAdaptateur): Promise<string> {
  const r = lireSecret(secret);
  const deja = ACCES.get(empreinte(r));
  if (deja && deja.expire - 60_000 > Date.now()) return deja.acces;
  const { statut, json } = await formulaireConnexion(f, annuaireMicrosoft(cfg), 'token', {
    grant_type: 'refresh_token', client_id: applicationMicrosoft(cfg), refresh_token: r, scope: PORTEE_MICROSOFT,
  });
  if (statut !== 200 || typeof json.access_token !== 'string') throw new ErreurSortante(messageConnexion(json));
  const nouveau = typeof json.refresh_token === 'string' && json.refresh_token.length >= 10 ? json.refresh_token : r;
  memoriser(nouveau, json.access_token, Number(json.expires_in));
  if (nouveau !== r) {
    memoriser(r, json.access_token, Number(json.expires_in));
    ctx?.majSecret(JSON.stringify({ r: nouveau }));
  }
  return json.access_token;
}

// ---------------------------------------------------------------- classeur Excel (Graph)

/** Identifiant de partage Graph d'un lien OneDrive/SharePoint : « u! » + base64url du lien. */
export function idPartage(lien: string | undefined): string {
  const brut = (lien ?? '').trim();
  let u: URL;
  try {
    u = new URL(brut);
  } catch {
    throw new ErreurSortante('Collez le lien du classeur copié depuis OneDrive ou SharePoint (Partager → Copier le lien).');
  }
  if (u.protocol === 'https:' && HOTES_PERSONNELS.includes(u.hostname)) throw new ErreurSortante(REFUS_PERSONNEL);
  const hoteOk = HOTES_FICHIER.some((h) => (h.startsWith('.') ? u.hostname.endsWith(h) : u.hostname === h));
  if (u.protocol !== 'https:' || u.username || u.password || !hoteOk || brut.length > 2000) {
    throw new ErreurSortante('Lien de classeur non reconnu : il doit venir de OneDrive ou SharePoint professionnel (une adresse en …sharepoint.com).');
  }
  return `u!${Buffer.from(brut, 'utf8').toString('base64url')}`;
}

export function indexColonne(lettres: string): number {
  let n = 0;
  for (const c of lettres.toUpperCase()) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export function lettreColonne(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Coin haut-gauche d'une adresse Graph (« Feuil1!B2:F30 » → ligne 2, colonne 1). */
export function debutPlage(adresse: string): { ligne0: number; col0: number } {
  const m = /^\$?([A-Z]{1,3})\$?(\d{1,7})/.exec((adresse.split('!').pop() ?? '').toUpperCase());
  return m ? { ligne0: Number(m[2]), col0: indexColonne(m[1] as string) } : { ligne0: 1, col0: 0 };
}

/** Valeur d'une cellule : nombres bruts, mais dates et heures telles qu'affichées. */
export function cellule(valeur: unknown, texte: unknown): string {
  const t = typeof texte === 'string' ? texte : '';
  if (typeof valeur === 'number') return /[/:]|\d{4}-\d{2}-\d{2}/.test(t) ? t : String(valeur);
  if (typeof valeur === 'boolean') return valeur ? 'oui' : 'non';
  return valeur === null || valeur === undefined ? '' : String(valeur);
}

interface Plage {
  lignes: string[][];
  ligne0: number;
  col0: number;
}

const SEGMENT = /^[A-Za-z0-9!_.,-]{1,300}$/;

async function classeur(cfg: Config, entetes: Record<string, string>, f: Recuperateur): Promise<string> {
  const u = new URL(`${GRAPH}/shares/${idPartage(cfg.fichier)}/driveItem`);
  u.searchParams.set('$select', 'id,name,parentReference');
  const { donnees } = await appeler(f, u, { entetes });
  const d = donnees as { id?: unknown; parentReference?: { driveId?: unknown } } | null;
  const item = String(d?.id ?? '');
  const drive = String(d?.parentReference?.driveId ?? '');
  if (!SEGMENT.test(item) || !SEGMENT.test(drive)) throw new ErreurSortante('Classeur introuvable : vérifiez le lien et que votre compte y a accès.');
  return `${GRAPH}/drives/${encodeURIComponent(drive)}/items/${encodeURIComponent(item)}/workbook`;
}

async function nomFeuille(base: string, cfg: Config, entetes: Record<string, string>, f: Recuperateur): Promise<string> {
  const voulue = (cfg.feuille ?? '').trim();
  if (voulue) {
    if (voulue.length > 31 || /[[\]*?/\\:]/.test(voulue)) throw new ErreurSortante('Nom de feuille Excel invalide.');
    return voulue;
  }
  const u = new URL(`${base}/worksheets`);
  u.searchParams.set('$select', 'name');
  const { donnees } = await appeler(f, u, { entetes });
  const nom = (donnees as { value?: { name?: unknown }[] } | null)?.value?.[0]?.name;
  if (typeof nom !== 'string' || !nom) throw new ErreurSortante('Ce classeur n’a aucune feuille.');
  return nom;
}

async function lirePlage(base: string, feuille: string, entetes: Record<string, string>, f: Recuperateur): Promise<Plage> {
  const u = new URL(`${base}/worksheets/${encodeURIComponent(feuille)}/usedRange(valuesOnly=true)`);
  u.searchParams.set('$select', 'address,values,text');
  const { donnees } = await appeler(f, u, { entetes, delaiMs: 30_000 });
  const d = donnees as { address?: unknown; values?: unknown; text?: unknown } | null;
  const valeurs = Array.isArray(d?.values) ? (d.values as unknown[]).filter(Array.isArray) as unknown[][] : [];
  const textes = Array.isArray(d?.text) ? d.text as unknown[][] : [];
  const { ligne0, col0 } = debutPlage(typeof d?.address === 'string' ? d.address : 'A1');
  return { lignes: valeurs.map((l, i) => l.map((v, j) => cellule(v, textes[i]?.[j]))), ligne0, col0 };
}

async function acces(cfg: Config, secret: string | null, f: Recuperateur, ctx?: ContexteAdaptateur) {
  // connexion par le relais : le secret EST le jeton d'accès Graph (renouvelé avant l'appel par la synchro)
  if (parRelais(cfg, 'microsoft') && !secret) throw new ErreurSortante('Connexion Microsoft manquante : cliquez sur « Se connecter avec Microsoft ».');
  const jeton = parRelais(cfg, 'microsoft') ? secret as string : await jetonAccesMicrosoft(cfg, secret, f, ctx);
  const entetes = { authorization: `Bearer ${jeton}` };
  const base = await classeur(cfg, entetes, f);
  return { entetes, base, feuille: await nomFeuille(base, cfg, entetes, f) };
}

export const excel365: Adaptateur = {
  id: 'excel365', nom: 'Excel Microsoft 365', categorie: 'Tableur', couleur: '#107c41',
  description: 'Un classeur Excel sur OneDrive professionnel ou SharePoint (Microsoft 365), dans les deux sens, avec votre propre compte Microsoft.',
  etapes: [
    'Une seule fois, sur entra.microsoft.com (compte administrateur Microsoft 365) : Applications → Inscriptions d’applications → « Nouvelle inscription » → nom « Living Business », comptes de cet annuaire uniquement → Inscrire.',
    'Dans cette application : Authentification → « Autoriser les flux de clients publics » → Oui → Enregistrer. Copiez l’ID d’application (client) et l’ID de l’annuaire (locataire) de la page « Vue d’ensemble ».',
    'Dans OneDrive ou SharePoint : classeur → Partager → Copier le lien, collez-le ici, puis « Se connecter à Microsoft » : saisissez le code affiché sur la page Microsoft, avec votre compte.',
  ],
  champs: [
    { id: 'tenant', libelle: 'ID de l’annuaire (locataire)', aide: 'Page « Vue d’ensemble » de l’application, ou votre domaine …onmicrosoft.com.', exemple: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', obligatoire: true, mode: 'cle' },
    { id: 'client', libelle: 'ID d’application (client)', aide: 'Même page « Vue d’ensemble ».', exemple: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx', obligatoire: true, mode: 'cle' },
    { id: 'fichier', libelle: 'Classeur', aide: 'Choisissez-le dans la liste (vos classeurs), ou collez son lien : OneDrive ou SharePoint → Partager → Copier le lien. Un classeur qu’on a partagé avec vous : collez son lien.', exemple: 'https://monentreprise.sharepoint.com/:x:/…', obligatoire: true, liste: true },
    { id: 'feuille', libelle: 'Feuille (facultatif)', aide: 'Nom exact de l’onglet ; par défaut le premier.' },
    { id: 'colonneId', libelle: 'Colonne identifiant', aide: 'Nom exact de la colonne (par défaut la 1re), ex. « Référence ».' },
    { id: 'jeton', libelle: 'Connexion Microsoft', aide: 'Votre mot de passe reste chez Microsoft : le jeu reçoit un jeton, chiffré sur votre ordinateur.', secret: true, obligatoire: true, connexion: 'microsoft', mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f, ctx) {
    const a = await acces(cfg, secret, f, ctx);
    const p = await lirePlage(a.base, a.feuille, a.entetes, f);
    return lignesVersEnregistrements(p.lignes, cfg.colonneId || undefined);
  },
  /**
   * Sélecteur de classeur (« Se connecter avec Microsoft », §6.1 P4) : les classeurs Excel du OneDrive de la personne
   * connectée, lus dans Microsoft Graph. La valeur est l'adresse du classeur, que `idPartage` accepte comme un lien de
   * partage (SharePoint et OneDrive professionnel, rien d'autre). Les classeurs partagés AVEC elle ne sont plus listés :
   * Microsoft arrête `sharedWithMe` (« will operate in a degraded state until November, 2026 », puis plus de données) ;
   * leur lien se colle.
   */
  async choix(champ, cfg, secret, f, ctx) {
    if (champ !== 'fichier') return [];
    if (parRelais(cfg, 'microsoft') && !secret) throw new ErreurSortante('Connexion Microsoft manquante : cliquez sur « Se connecter avec Microsoft ».');
    const jeton = parRelais(cfg, 'microsoft') ? secret as string : await jetonAccesMicrosoft(cfg, secret, f, ctx);
    const entetes = { authorization: `Bearer ${jeton}` };
    const vus = new Set<string>();
    const res: Array<{ valeur: string; libelle: string }> = [];
    const u = new URL(`${GRAPH}/me/drive/root/search(q='xlsx')`);
    u.searchParams.set('$top', '200');
    const { donnees } = await appeler(f, u, { entetes });
    for (const x of (donnees as { value?: unknown[] } | null)?.value ?? []) {
      const d = x as { name?: unknown; webUrl?: unknown; remoteItem?: { webUrl?: unknown; name?: unknown } } | null;
      const nom = String(d?.name ?? d?.remoteItem?.name ?? '');
      const adresse = String(d?.webUrl ?? d?.remoteItem?.webUrl ?? '');
      if (!/\.xls[xm]$/i.test(nom) || vus.has(adresse)) continue;
      try { idPartage(adresse); } catch { continue; } // seulement OneDrive et SharePoint
      vus.add(adresse);
      res.push({ valeur: adresse, libelle: nom.slice(0, 200) });
    }
    return res.sort((a, b) => a.libelle.localeCompare(b.libelle, 'fr')).slice(0, 500);
  },
  async ecrire(cfg, secret, externeId, valeurs, f, ctx) {
    const a = await acces(cfg, secret, f, ctx);
    const p = await lirePlage(a.base, a.feuille, a.entetes, f);
    const titres = (p.lignes[0] ?? []).map((x) => x.trim());
    if (!titres.some(Boolean)) throw new ErreurSortante('La feuille doit commencer par une ligne d’en-têtes.');
    const colonneId = cfg.colonneId || (titres[0] as string);
    const col = titres.indexOf(colonneId);
    if (col < 0) throw new ErreurSortante(`Colonne « ${colonneId} » absente de la feuille.`);
    const id = externeId ?? String(valeurs[colonneId] ?? '');
    let i = id ? p.lignes.findIndex((l, k) => k > 0 && (l[col] ?? '').trim() === id) : -1;
    const nouvelle = i < 0;
    if (nouvelle) i = Math.max(1, p.lignes.length);
    // null = cellule laissée telle quelle (formules des colonnes non synchronisées conservées) ; un texte du jeu qui
    // commencerait une formule est écrit comme texte (`sansFormule`)
    const ligne: (ValeurSortante | null)[] = titres.map((t) => (t && t in valeurs ? (sansFormule(valeurs[t] ?? '') ?? '') : null));
    if (nouvelle && id && ligne[col] === null) ligne[col] = sansFormule(id);
    const n = p.ligne0 + i;
    const adresse = `${lettreColonne(p.col0)}${n}:${lettreColonne(p.col0 + titres.length - 1)}${n}`;
    await appeler(f, new URL(`${a.base}/worksheets/${encodeURIComponent(a.feuille)}/range(address='${adresse}')`), { methode: 'PATCH', entetes: a.entetes, corps: { values: [ligne] } });
    return id || null;
  },
};
