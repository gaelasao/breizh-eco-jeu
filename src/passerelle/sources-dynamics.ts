/**
 * Microsoft Dynamics 365 (distinct de Microsoft 365 / Office) :
 * - **Dynamics 365 Sales** (CRM, Dataverse Web API v9.2) : comptes (entreprises) et contacts, dans les deux sens ;
 * - **Business Central** (gestion, comptabilité, API v2.0) : clients, fournisseurs, articles, dans les deux sens.
 * Connexion « Se connecter avec Microsoft » par le relais de Breizhcosystem (application Microsoft de l'éditeur, droits délégués :
 * l'entreprise ne voit que ce que son compte voit déjà). Hôtes fixes : <organisation>.crmN.dynamics.com (forme vérifiée)
 * et api.businesscentral.dynamics.com.
 */
import type { Adaptateur, Choix, Enregistrement, ValeurSortante } from './sources.ts';
import { appeler, ErreurReglage, ErreurSortante, type Recuperateur } from './sortant.ts';

export const ORGANISATION_DYNAMICS = /^https:\/\/[a-z0-9][a-z0-9-]{0,62}\.crm[0-9]{0,2}\.dynamics\.com$/;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHAMP = /^[a-zA-Z][a-zA-Z0-9_]{0,59}$/;
const MAX_PAGES = 40;

const jetonDe = (secret: string | null, nom: string): string => {
  if (!secret) throw new ErreurSortante(`Connexion ${nom} manquante : « Se connecter avec Microsoft ».`);
  return secret;
};
const texte = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? '' : String(v));

/** Suit @odata.nextLink seulement sur le même hôte (anti-redirection détournée). */
async function toutesLesPages(f: Recuperateur, premiere: URL, entetes: Record<string, string>): Promise<Record<string, unknown>[]> {
  const res: Record<string, unknown>[] = [];
  let u: URL | null = premiere;
  for (let page = 0; u && page < MAX_PAGES; page++) {
    const { donnees } = await appeler(f, u, { entetes, delaiMs: 30_000 });
    const d = donnees as { value?: unknown; '@odata.nextLink'?: unknown } | null;
    for (const x of Array.isArray(d?.value) ? d.value : []) if (x && typeof x === 'object') res.push(x as Record<string, unknown>);
    const suite = typeof d?.['@odata.nextLink'] === 'string' ? d['@odata.nextLink'] : null;
    let s: URL | null = null;
    try { s = suite ? new URL(suite) : null; } catch { s = null; }
    u = s && s.protocol === 'https:' && s.host === premiere.host ? s : null;
  }
  return res;
}

const valeursPermises = (valeurs: Record<string, ValeurSortante>, permis: readonly string[]) =>
  Object.fromEntries(Object.entries(valeurs).filter(([k]) => CHAMP.test(k) && permis.includes(k)).map(([k, v]) => [k, v === '' ? null : v]));

// ---------------------------------------------------------------- Dynamics 365 Sales (Dataverse)

const CHAMPS_DATAVERSE: Readonly<Record<'accounts' | 'contacts', { id: string; lecture: readonly string[]; ecriture: readonly string[] }>> = {
  accounts: {
    id: 'accountid',
    lecture: ['name', 'accountnumber', 'emailaddress1', 'telephone1', 'websiteurl', 'address1_line1', 'address1_postalcode', 'address1_city', 'address1_country', 'description'],
    ecriture: ['name', 'accountnumber', 'emailaddress1', 'telephone1', 'websiteurl', 'address1_line1', 'address1_postalcode', 'address1_city', 'address1_country', 'description'],
  },
  contacts: {
    id: 'contactid',
    lecture: ['fullname', 'firstname', 'lastname', 'emailaddress1', 'telephone1', 'mobilephone', 'jobtitle', 'address1_city'],
    ecriture: ['firstname', 'lastname', 'emailaddress1', 'telephone1', 'mobilephone', 'jobtitle', 'address1_city'],
  },
};

function organisation(cfg: Readonly<Record<string, string>>): string {
  const o = (cfg.organisation ?? '').trim().toLowerCase().replace(/\/+$/, '');
  if (!ORGANISATION_DYNAMICS.test(o)) throw new ErreurSortante('Adresse de l’organisation Dynamics 365 : https://votre-organisation.crm4.dynamics.com (Paramètres → Personnalisations → Ressources du développeur).');
  return o;
}
const objetDataverse = (cfg: Readonly<Record<string, string>>): 'accounts' | 'contacts' => {
  if (cfg.objet === 'accounts' || cfg.objet === 'contacts') return cfg.objet;
  throw new ErreurReglage('Choisissez ce que vous synchronisez : comptes (entreprises) ou contacts.', 'objet');
};
const entetesDataverse = (secret: string | null) => ({
  authorization: `Bearer ${jetonDe(secret, 'Dynamics 365')}`, accept: 'application/json', 'odata-version': '4.0', 'odata-maxversion': '4.0', prefer: 'odata.maxpagesize=500',
});

export const dynamics365: Adaptateur = {
  id: 'dynamics365', nom: 'Dynamics 365 Sales', categorie: 'CRM', couleur: '#002050',
  description: 'Comptes (entreprises) et contacts de votre CRM Dynamics 365, dans les deux sens.',
  etapes: [
    'Indiquez l’adresse de votre organisation Dynamics 365 (celle de la barre d’adresse : https://…crm4.dynamics.com).',
    '« Se connecter avec Microsoft » : connectez-vous avec votre compte et acceptez.',
    'Choisissez les comptes ou les contacts, vérifiez la correspondance des champs, activez.',
  ],
  champs: [
    { id: 'organisation', libelle: 'Adresse de l’organisation', aide: 'Ex. https://monentreprise.crm4.dynamics.com', exemple: 'https://monentreprise.crm4.dynamics.com', obligatoire: true },
    { id: 'objet', libelle: 'Fiches Dynamics 365 à lire', aide: 'Comptes (entreprises) ou contacts (personnes).', choix: ['accounts', 'contacts'], obligatoire: true },
    { id: 'jeton', libelle: 'Jeton d’accès Dataverse (avancé)', aide: 'Seulement sans « Se connecter avec Microsoft » : un jeton expire en 1 heure.', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f): Promise<Enregistrement[]> {
    const org = organisation(cfg);
    const objet = objetDataverse(cfg);
    const def = CHAMPS_DATAVERSE[objet];
    const u = new URL(`${org}/api/data/v9.2/${objet}`);
    u.searchParams.set('$select', [def.id, ...def.lecture].join(','));
    const lignes = await toutesLesPages(f, u, entetesDataverse(secret));
    return lignes
      .filter((l) => typeof l[def.id] === 'string' && GUID.test(l[def.id] as string))
      .map((l) => ({ externeId: l[def.id] as string, champs: Object.fromEntries(def.lecture.map((k) => [k, texte(l[k])])) }));
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const org = organisation(cfg);
    const objet = objetDataverse(cfg);
    const def = CHAMPS_DATAVERSE[objet];
    const corps = valeursPermises(valeurs, def.ecriture);
    const entetes = { ...entetesDataverse(secret), 'content-type': 'application/json' };
    if (externeId) {
      if (!GUID.test(externeId)) throw new ErreurSortante('Identifiant Dynamics 365 invalide.');
      await appeler(f, new URL(`${org}/api/data/v9.2/${objet}(${externeId})`), { methode: 'PATCH', entetes: { ...entetes, 'if-match': '*' }, corps });
      return externeId;
    }
    const { donnees } = await appeler(f, new URL(`${org}/api/data/v9.2/${objet}`), { methode: 'POST', entetes: { ...entetes, prefer: 'return=representation' }, corps });
    const id = (donnees as Record<string, unknown> | null)?.[def.id];
    return typeof id === 'string' && GUID.test(id) ? id : null;
  },
};

// ---------------------------------------------------------------- Business Central (API v2.0)

const BC = 'https://api.businesscentral.dynamics.com/v2.0';
// `source` : nom de la propriété chez Business Central quand il diffère de la colonne montrée dans le jeu. Le solde d'un
// client s'y appelle « balanceDue » (« balance » n'existe que pour un fournisseur) ; la colonne reste « balance » des
// deux côtés pour que les correspondances déjà enregistrées continuent de marcher.
const CHAMPS_BC: Readonly<Record<'customers' | 'vendors' | 'items', { lecture: readonly string[]; ecriture: readonly string[]; source?: Readonly<Record<string, string>> }>> = {
  customers: {
    lecture: ['number', 'displayName', 'email', 'phoneNumber', 'website', 'addressLine1', 'postalCode', 'city', 'country', 'balance', 'blocked'],
    ecriture: ['displayName', 'email', 'phoneNumber', 'website', 'addressLine1', 'postalCode', 'city', 'country'],
    source: { balance: 'balanceDue' },
  },
  vendors: {
    lecture: ['number', 'displayName', 'email', 'phoneNumber', 'website', 'addressLine1', 'postalCode', 'city', 'country', 'balance', 'blocked'],
    ecriture: ['displayName', 'email', 'phoneNumber', 'website', 'addressLine1', 'postalCode', 'city', 'country'],
  },
  items: {
    lecture: ['number', 'displayName', 'type', 'unitPrice', 'unitCost', 'inventory', 'baseUnitOfMeasureCode', 'blocked'],
    ecriture: ['displayName', 'unitPrice', 'unitCost'],
  },
};

/** Annuaire (tenant) du compte connecté, lu dans le jeton d'accès (non vérifié ici : Business Central le vérifie). */
export function annuaireDuJeton(jeton: string): string {
  const morceau = jeton.split('.')[1];
  try {
    const tid = (JSON.parse(Buffer.from(morceau ?? '', 'base64url').toString('utf8')) as { tid?: unknown }).tid;
    if (typeof tid === 'string' && GUID.test(tid)) return tid;
  } catch { /* plus bas */ }
  throw new ErreurSortante('Connexion Business Central illisible : reconnectez-vous avec Microsoft.');
}
const environnement = (cfg: Readonly<Record<string, string>>) => {
  const e = (cfg.environnement || 'production').trim();
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(e)) throw new ErreurSortante('Nom d’environnement Business Central invalide (souvent « production »).');
  return e;
};
const objetBC = (cfg: Readonly<Record<string, string>>): 'customers' | 'vendors' | 'items' => {
  if (cfg.objet === 'customers' || cfg.objet === 'vendors' || cfg.objet === 'items') return cfg.objet;
  throw new ErreurReglage('Choisissez ce que vous synchronisez : clients, fournisseurs ou articles.', 'objet');
};
function baseBC(cfg: Readonly<Record<string, string>>, secret: string | null): { base: string; entetes: Record<string, string> } {
  const j = jetonDe(secret, 'Business Central');
  const entreprise = (cfg.entreprise ?? '').trim();
  if (!GUID.test(entreprise)) throw new ErreurSortante('Choisissez l’entreprise Business Central.');
  return { base: `${BC}/${annuaireDuJeton(j)}/${environnement(cfg)}/api/v2.0/companies(${entreprise})`, entetes: { authorization: `Bearer ${j}`, accept: 'application/json' } };
}

export const businessCentral: Adaptateur = {
  id: 'businesscentral', nom: 'Dynamics 365 Business Central', categorie: 'Gestion', couleur: '#008575',
  description: 'Clients, fournisseurs et articles de Business Central, dans les deux sens.',
  etapes: [
    '« Se connecter avec Microsoft » : connectez-vous avec votre compte Business Central et acceptez.',
    'Choisissez l’entreprise (société) dans la liste, puis clients, fournisseurs ou articles.',
    'Vérifiez la correspondance des champs et activez.',
  ],
  champs: [
    { id: 'environnement', libelle: 'Environnement', aide: 'Presque toujours « production ».', exemple: 'production' },
    { id: 'entreprise', libelle: 'Entreprise', aide: 'Société Business Central à synchroniser.', obligatoire: true, liste: true },
    { id: 'objet', libelle: 'Fiches Business Central à lire', aide: 'Clients, fournisseurs ou articles.', choix: ['customers', 'vendors', 'items'], obligatoire: true },
    { id: 'jeton', libelle: 'Jeton d’accès (avancé)', aide: 'Seulement sans « Se connecter avec Microsoft » : un jeton expire en 1 heure.', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = objetBC(cfg);
    const { base, entetes } = baseBC(cfg, secret);
    const def = CHAMPS_BC[objet];
    const lignes = await toutesLesPages(f, new URL(`${base}/${objet}`), entetes);
    return lignes
      .filter((l) => typeof l.id === 'string' && GUID.test(l.id))
      .map((l) => ({ externeId: l.id as string, champs: Object.fromEntries(def.lecture.map((k) => [k, texte(l[def.source?.[k] ?? k] ?? l[k])])) }));
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const objet = objetBC(cfg);
    const { base, entetes } = baseBC(cfg, secret);
    const corps = valeursPermises(valeurs, CHAMPS_BC[objet].ecriture);
    for (const k of ['unitPrice', 'unitCost']) if (k in corps && corps[k] !== null) corps[k] = Number(corps[k]);
    const json = { ...entetes, 'content-type': 'application/json' };
    if (externeId) {
      if (!GUID.test(externeId)) throw new ErreurSortante('Identifiant Business Central invalide.');
      // Business Central exige la version courante (ETag) pour modifier
      const { donnees } = await appeler(f, new URL(`${base}/${objet}(${externeId})`), { entetes });
      const etag = (donnees as Record<string, unknown> | null)?.['@odata.etag'];
      if (typeof etag !== 'string' || etag.length > 200 || /[\r\n]/.test(etag)) throw new ErreurSortante('Version de la fiche Business Central illisible.');
      await appeler(f, new URL(`${base}/${objet}(${externeId})`), { methode: 'PATCH', entetes: { ...json, 'if-match': etag }, corps });
      return externeId;
    }
    const { donnees } = await appeler(f, new URL(`${base}/${objet}`), { methode: 'POST', entetes: json, corps });
    const id = (donnees as Record<string, unknown> | null)?.id;
    return typeof id === 'string' && GUID.test(id) ? id : null;
  },
  async choix(champ, cfg, secret, f): Promise<Choix[]> {
    if (champ !== 'entreprise') return [];
    const j = jetonDe(secret, 'Business Central');
    const u = new URL(`${BC}/${annuaireDuJeton(j)}/${environnement(cfg)}/api/v2.0/companies`);
    const lignes = await toutesLesPages(f, u, { authorization: `Bearer ${j}`, accept: 'application/json' });
    return lignes
      .filter((l) => typeof l.id === 'string' && GUID.test(l.id))
      .map((l) => ({ valeur: l.id as string, libelle: texte(l.displayName || l.name).slice(0, 120) || (l.id as string) }));
  },
};
