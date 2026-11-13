/**
 * Connecteurs natifs « métier », dans les deux sens : Pennylane, Qonto, Odoo, Pipedrive, Shopify.
 * Même contrat que les adaptateurs de `sources.ts` ; tous les appels passent par `appeler()`
 * (délai, taille bornée, redirections refusées). Hôtes fixes pour Pennylane et Qonto, sous-domaines validés
 * par expression régulière pour Pipedrive (*.pipedrive.com) et Shopify (*.myshopify.com) ; l'adresse Odoo,
 * libre, passe par `verifierUrl` (HTTPS, jamais d'adresse privée ou interne).
 * Écriture : seuls les champs connus de l'outil sont envoyés, et une valeur vide dans le jeu n'est jamais
 * envoyée (le jeu n'efface rien dans l'outil). Lecture : pagination suivie, 5000 enregistrements au plus.
 * Ce module n'importe de `sources.ts` que des types : aucun cycle d'import à l'exécution.
 */
import { createHash } from 'node:crypto';
import { parRelais } from './oauth-relais.ts';
import type { Adaptateur, Enregistrement, ValeurSortante } from './sources.ts';
import { appeler, ErreurReglage, ErreurSortante, verifierUrl, type Recuperateur } from './sortant.ts';

type Config = Readonly<Record<string, string>>;
type Valeurs = Record<string, ValeurSortante>;
type Objet = Record<string, unknown>;
type TypeEcrit = 'texte' | 'liste' | 'nombre' | 'booleen';

const MAX = 5000;

// ---------------------------------------------------------------- outils communs

const estObjet = (x: unknown): x is Objet => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Valeur d'API → texte lisible (listes jointes, objets nommés). */
function enTexte(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(enTexte).filter(Boolean).join(', ');
  if (estObjet(v)) {
    for (const k of ['name', 'title', 'label', 'value', 'amount', 'emailAddress', 'phoneNumber', 'id']) if (k in v && v[k] !== null && typeof v[k] !== 'object') return String(v[k]);
    return JSON.stringify(v).slice(0, 500);
  }
  return '';
}

/** Aplatit sur un niveau ({ adresse: { ville } } → « adresse.ville ») en ignorant les clés techniques. */
function aplatirNiveau(o: Objet, ignorer: readonly string[] = []): Record<string, string> {
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (ignorer.includes(k)) continue;
    if (estObjet(v)) for (const [k2, v2] of Object.entries(v)) r[`${k}.${k2}`] = enTexte(v2);
    else r[k] = enTexte(v);
  }
  return r;
}

const exiger = (cfg: Config, cle: string, re: RegExp, message: string): string => {
  const v = (cfg[cle] ?? '').trim();
  if (!re.test(v)) throw new ErreurReglage(message, cle);
  return v;
};

const jeton = (secret: string | null, nom: string): string => {
  if (!secret) throw new ErreurReglage(`${nom} : jeton manquant.`, 'jeton');
  return secret;
};

const vide = (v: ValeurSortante | undefined): boolean => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
const vrai = (v: ValeurSortante): boolean => v === true || /^(oui|o|vrai|true|1|x|yes)$/i.test(String(v).trim());
const liste = (v: ValeurSortante): string[] => String(v).split(/[,;]/).map((x) => x.trim()).filter(Boolean);

/** « Marie-Anne Le Goff » → ['Marie-Anne', 'Le Goff'] (prénom = premier mot). */
function separerNom(nom: string): [string, string] {
  const mots = nom.trim().split(/\s+/);
  return [mots[0] ?? '', mots.slice(1).join(' ')];
}

/** Corps d'écriture : champs autorisés uniquement, « a.b » → { a: { b } }, valeurs vides ignorées. */
function corpsEcriture(valeurs: Valeurs, autorises: Readonly<Record<string, TypeEcrit>>): Objet {
  const corps: Objet = {};
  for (const [cle, v] of Object.entries(valeurs)) {
    if (!Object.hasOwn(autorises, cle) || vide(v)) continue;
    const type = autorises[cle];
    let val: unknown = String(v).trim();
    if (type === 'liste') val = liste(v);
    else if (type === 'booleen') val = vrai(v);
    else if (type === 'nombre') {
      val = typeof v === 'number' ? v : Number(String(v).replace(/\s/g, '').replace(',', '.'));
      if (!Number.isFinite(val)) continue;
    }
    const [a, b] = cle.split('.') as [string, string | undefined];
    if (b === undefined) corps[a] = val;
    else {
      const existant = corps[a];
      const sous: Objet = estObjet(existant) ? existant : {};
      sous[b] = val;
      corps[a] = sous;
    }
  }
  return corps;
}

/** Messages lisibles par statut HTTP, propres à chaque outil (sinon ceux, génériques, de `appeler`). */
type Conseils = Readonly<Partial<Record<number, string>>>;
type InitAppel = NonNullable<Parameters<typeof appeler>[2]>;

async function appelerOutil(outil: string, conseils: Conseils, f: Recuperateur, url: URL, init: InitAppel = {}) {
  try {
    return await appeler(f, url, init);
  } catch (e) {
    const conseil = e instanceof ErreurSortante && e.statut !== null ? conseils[e.statut] : undefined;
    if (e instanceof ErreurSortante && conseil) throw new ErreurSortante(`${outil} : ${conseil}`, e.statut);
    throw e;
  }
}

const idNumerique = (id: string, outil: string): string => {
  if (!/^\d{1,20}$/.test(id)) throw new ErreurSortante(`Identifiant ${outil} invalide.`);
  return id;
};

const idCree = (x: unknown): string | null => {
  const id = estObjet(x) ? x.id : undefined;
  return typeof id === 'number' || (typeof id === 'string' && id) ? String(id) : null;
};

// ---------------------------------------------------------------- Pennylane (API V2)

const PENNYLANE = 'https://app.pennylane.com/api/external/v2';
const CONSEILS_PENNYLANE: Conseils = {
  401: 'jeton refusé (incomplet, révoqué ou expiré). Générez-en un dans Paramètres → Connectivité → Développeurs.',
  403: 'droits insuffisants : le jeton doit avoir l’accès API V2 « lecture et écriture » (clients et fournisseurs).',
  404: 'fiche introuvable (supprimée dans Pennylane ?).',
  429: 'trop de requêtes (25 toutes les 5 secondes) : nouvel essai à la prochaine synchronisation.',
};
const ADRESSE_PL = ['address', 'postal_code', 'city', 'country_alpha2'] as const;
const ADRESSE_PENNYLANE = (cle: string): Record<string, TypeEcrit> => Object.fromEntries(ADRESSE_PL.map((k) => [`${cle}.${k}`, 'texte' as const]));
const ECRIT_CLIENT_PENNYLANE: Record<string, TypeEcrit> = { name: 'texte', vat_number: 'texte', reg_no: 'texte', phone: 'texte', emails: 'liste', recipient: 'texte', reference: 'texte', notes: 'texte', external_reference: 'texte', ...ADRESSE_PENNYLANE('billing_address') };
const ECRIT_PARTICULIER_PENNYLANE: Record<string, TypeEcrit> = { first_name: 'texte', last_name: 'texte', phone: 'texte', emails: 'liste', recipient: 'texte', reference: 'texte', notes: 'texte', external_reference: 'texte', ...ADRESSE_PENNYLANE('billing_address') };
const ECRIT_FOURNISSEUR_PENNYLANE: Record<string, TypeEcrit> = { name: 'texte', establishment_no: 'texte', reg_no: 'texte', vat_number: 'texte', emails: 'liste', external_reference: 'texte', ...ADRESSE_PENNYLANE('postal_address') };
/** Type de chaque client lu (company | individual) : Pennylane a deux points d'écriture distincts. */
const typesPennylane = new Map<string, string>();

const objetPennylane = (cfg: Config) => exiger(cfg, 'objet', /^(clients|fournisseurs)$/, 'Choisissez les fiches Pennylane à lire : clients ou fournisseurs.') as 'clients' | 'fournisseurs';
const entetePennylane = (secret: string | null) => ({ authorization: `Bearer ${jeton(secret, 'Pennylane')}` });

/** Fiche actuelle (filtre sur l'identifiant) : type d'un client inconnu, ou adresse à compléter. */
async function fichePennylane(chemin: 'customers' | 'suppliers', id: string, secret: string | null, f: Recuperateur): Promise<Objet> {
  const u = new URL(`${PENNYLANE}/${chemin}`);
  u.searchParams.set('filter', JSON.stringify([{ field: 'id', operator: 'eq', value: id }]));
  u.searchParams.set('limit', '1');
  const { donnees } = await appelerOutil('Pennylane', CONSEILS_PENNYLANE, f, u, { entetes: entetePennylane(secret) });
  const fiche = (donnees as { items?: unknown[] } | null)?.items?.[0];
  if (!estObjet(fiche)) throw new ErreurSortante('Pennylane : fiche introuvable (supprimée dans Pennylane ?).', 404);
  if (chemin === 'customers' && fiche.customer_type) typesPennylane.set(id, enTexte(fiche.customer_type));
  return fiche;
}

/**
 * Pennylane exige les 4 sous-champs d'une adresse envoyée. Adresse partielle (ex. seule la ville est liée au jeu) :
 * complétée par l'adresse actuelle de la fiche (mise à jour) ou par des valeurs vides, pays FR (création).
 */
async function adressePennylane(corps: Objet, cle: string, actuelle: (() => Promise<Objet>) | null) {
  const partielle = corps[cle];
  if (!estObjet(partielle)) return;
  const complete = ADRESSE_PL.every((k) => typeof partielle[k] === 'string' && partielle[k] !== '');
  const avant = complete || !actuelle ? undefined : (await actuelle())[cle];
  const base: Objet = estObjet(avant) ? avant : {};
  corps[cle] = Object.fromEntries(ADRESSE_PL.map((k) => [k, enTexte(partielle[k]) || enTexte(base[k]) || (k === 'country_alpha2' ? 'FR' : '')]));
}

export const pennylane: Adaptateur = {
  id: 'pennylane', nom: 'Pennylane', categorie: 'Comptabilité', couleur: '#00b48a',
  description: 'Clients ou fournisseurs de votre comptabilité Pennylane, dans les deux sens.',
  etapes: [
    'Pennylane → Paramètres → Connectivité → Développeurs → « Générer un jeton API » (offre Essentiel ou plus, accès administrateur).',
    'Donnez-lui un nom, API V2 en « Lecture et écriture » (ou lecture seule pour ne faire que lire), puis une durée de validité.',
    'Copiez le jeton tout de suite (il n’est affiché qu’une fois) et choisissez clients ou fournisseurs.',
  ],
  champs: [
    { id: 'objet', libelle: 'Fiches Pennylane à lire', aide: 'Clients ou fournisseurs.', choix: ['clients', 'fournisseurs'], obligatoire: true },
    { id: 'jeton', libelle: 'Clé d’accès Pennylane', aide: 'Créée dans Pennylane par votre informaticien. Chiffrée sur cet ordinateur.', exemple: 'eyJ…', secret: true, obligatoire: true },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = objetPennylane(cfg);
    const res: Enregistrement[] = [];
    let curseur = '';
    for (let page = 0; page < 50 && res.length < MAX; page++) {
      const u = new URL(`${PENNYLANE}/${objet === 'clients' ? 'customers' : 'suppliers'}`);
      u.searchParams.set('limit', '100');
      if (curseur) u.searchParams.set('cursor', curseur);
      const { donnees } = await appelerOutil('Pennylane', CONSEILS_PENNYLANE, f, u, { entetes: entetePennylane(secret) });
      const d = donnees as { items?: Objet[]; has_more?: boolean; next_cursor?: string | null } | null;
      for (const r of d?.items ?? []) {
        const id = enTexte(r.id);
        if (!id) continue;
        if (objet === 'clients' && r.customer_type) typesPennylane.set(id, enTexte(r.customer_type));
        // IBAN et liens techniques (mandats, contacts, compte comptable) ne sont jamais importés.
        res.push({ externeId: id, champs: aplatirNiveau(r, ['id', 'billing_iban', 'iban', 'ledger_account', 'mandates', 'pro_account_mandates', 'contacts']) });
      }
      if (!d?.has_more || !d.next_cursor) break;
      curseur = d.next_cursor;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const objet = objetPennylane(cfg);
    const entetes = entetePennylane(secret);
    const ecrire = async (methode: 'POST' | 'PUT', chemin: string, corps: Objet) =>
      (await appelerOutil('Pennylane', CONSEILS_PENNYLANE, f, new URL(`${PENNYLANE}/${chemin}`), { methode, entetes, corps })).donnees;
    const chemin = objet === 'clients' ? 'customers' : 'suppliers';
    let fiche: Promise<Objet> | null = null;
    const actuelle = (id: string) => () => (fiche ??= fichePennylane(chemin, id, secret, f));
    if (objet === 'fournisseurs') {
      const corps = corpsEcriture(valeurs, ECRIT_FOURNISSEUR_PENNYLANE);
      if (externeId) {
        const id = idNumerique(externeId, 'Pennylane');
        await adressePennylane(corps, 'postal_address', actuelle(id));
        if (Object.keys(corps).length) await ecrire('PUT', `suppliers/${id}`, corps);
        return externeId;
      }
      if (!corps.name) throw new ErreurSortante('Pennylane : nom du fournisseur manquant.');
      await adressePennylane(corps, 'postal_address', null);
      return idCree(await ecrire('POST', 'suppliers', corps));
    }
    if (externeId) {
      const id = idNumerique(externeId, 'Pennylane');
      const type = typesPennylane.get(id) ?? enTexte((await actuelle(id)()).customer_type);
      const particulier = type === 'individual';
      const v = { ...valeurs };
      if (particulier && !vide(v.name) && vide(v.first_name) && vide(v.last_name)) [v.first_name, v.last_name] = separerNom(String(v.name));
      const corps = corpsEcriture(v, particulier ? ECRIT_PARTICULIER_PENNYLANE : ECRIT_CLIENT_PENNYLANE);
      await adressePennylane(corps, 'billing_address', actuelle(id));
      if (Object.keys(corps).length) await ecrire('PUT', `${particulier ? 'individual' : 'company'}_customers/${id}`, corps);
      return externeId;
    }
    // Création : un client entreprise (le jeu gère des tiers professionnels) ; l'adresse de facturation est exigée.
    const corps = corpsEcriture(valeurs, ECRIT_CLIENT_PENNYLANE);
    if (!corps.name) throw new ErreurSortante('Pennylane : nom du client manquant.');
    corps.billing_address ??= {};
    await adressePennylane(corps, 'billing_address', null);
    const id = idCree(await ecrire('POST', 'company_customers', corps));
    if (id) typesPennylane.set(id, 'company');
    return id;
  },
};

// ---------------------------------------------------------------- Qonto (clients de la facturation)

const QONTO = 'https://thirdparty.qonto.com/v2';
const CONSEILS_QONTO: Conseils = {
  401: 'identifiant ou clé secrète refusés. Vérifiez-les dans Qonto → Intégrations et partenariats → Clé API.',
  403: 'accès refusé à la facturation Qonto pour cette clé (clients en lecture / écriture).',
  404: 'client introuvable (supprimé dans Qonto ?).',
  429: 'trop de requêtes : nouvel essai à la prochaine synchronisation.',
};
const ECRIT_QONTO: Record<string, TypeEcrit> = {
  name: 'texte', first_name: 'texte', last_name: 'texte', email: 'texte', extra_emails: 'liste', vat_number: 'texte', tax_identification_number: 'texte',
  'billing_address.street_address': 'texte', 'billing_address.city': 'texte', 'billing_address.zip_code': 'texte', 'billing_address.country_code': 'texte', currency: 'texte', locale: 'texte',
};
const ADRESSE_QONTO = ['street_address', 'city', 'zip_code', 'country_code'] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Nature de chaque client lu (company | freelancer | individual). */
const sortesQonto = new Map<string, string>();

function enteteQonto(cfg: Config, secret: string | null) {
  const identifiant = exiger(cfg, 'identifiant', /^[A-Za-z0-9][A-Za-z0-9_-]{1,120}$/, 'Identifiant Qonto invalide (ex. ma-societe-1234).');
  const cle = jeton(secret, 'Qonto');
  if (/[\s:]/.test(cle)) throw new ErreurSortante('Qonto : clé secrète invalide.');
  return { authorization: `${identifiant}:${cle}` };
}

function champsQonto(r: Objet): Record<string, string> {
  // Champs d'adresse et de type à la racine : obsolètes chez Qonto (remplacés par billing_address et kind).
  const champs = aplatirNiveau(r, ['id', 'phone', 'phone_number', 'type', 'address', 'city', 'zip_code', 'province_code', 'country_code']);
  if (estObjet(r.phone)) champs.phone = [enTexte(r.phone.country_code), enTexte(r.phone.number)].filter(Boolean).join(' ');
  if (!champs.name) champs.name = [champs.first_name, champs.last_name].filter(Boolean).join(' ');
  return champs;
}

export const qonto: Adaptateur = {
  id: 'qonto', nom: 'Qonto', categorie: 'Banque', couleur: '#6c5ce7',
  description: 'Les clients de votre facturation Qonto, dans les deux sens (les comptes et paiements ne sont jamais touchés).',
  etapes: [
    'Qonto (app.qonto.com) → choisissez l’organisation → Intégrations et partenariats → Clé API → « Générer ».',
    'Copiez l’identifiant (ex. ma-societe-1234) et la clé secrète affichés.',
    'Collez-les ici : l’identifiant en clair, la clé secrète dans le champ chiffré.',
  ],
  champs: [
    { id: 'identifiant', libelle: 'Identifiant Qonto', aide: 'Affiché avec la clé API.', exemple: 'ma-societe-1234', obligatoire: true },
    { id: 'jeton', libelle: 'Clé secrète', aide: 'Chiffrée sur le serveur.', secret: true, obligatoire: true },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const entetes = enteteQonto(cfg, secret);
    const res: Enregistrement[] = [];
    let page = 1;
    for (let n = 0; n < 50 && res.length < MAX; n++) {
      const u = new URL(`${QONTO}/clients`);
      u.searchParams.set('per_page', '100');
      u.searchParams.set('page', String(page));
      const { donnees } = await appelerOutil('Qonto', CONSEILS_QONTO, f, u, { entetes });
      const d = donnees as { clients?: Objet[]; meta?: { next_page?: number | null } } | null;
      for (const r of d?.clients ?? []) {
        const id = enTexte(r.id);
        if (!id) continue;
        if (r.kind) sortesQonto.set(id, enTexte(r.kind));
        res.push({ externeId: id, champs: champsQonto(r) });
      }
      const suivante = d?.meta?.next_page;
      if (typeof suivante !== 'number' || suivante <= page) break;
      page = suivante;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const entetes = enteteQonto(cfg, secret);
    const v = { ...valeurs };
    const sorte = externeId ? sortesQonto.get(externeId) : /^(company|freelancer|individual)$/.test(String(v.kind ?? '')) ? String(v.kind) : 'company';
    if (sorte === 'individual' && !vide(v.name) && vide(v.first_name) && vide(v.last_name)) [v.first_name, v.last_name] = separerNom(String(v.name));
    const corps = corpsEcriture(v, ECRIT_QONTO);
    if (sorte === 'individual') delete corps.name;
    if (externeId) {
      if (!UUID.test(externeId)) throw new ErreurSortante('Identifiant de client Qonto invalide.');
      const u = new URL(`${QONTO}/clients/${externeId}`);
      // Adresse partielle (ex. seule la ville est liée au jeu) : complétée par l'adresse actuelle, jamais tronquée.
      const adresse = corps.billing_address;
      if (estObjet(adresse) && !ADRESSE_QONTO.every((k) => adresse[k])) {
        const actuel = (await appelerOutil('Qonto', CONSEILS_QONTO, f, u, { entetes })).donnees as { client?: Objet } | null;
        const avant = actuel?.client?.billing_address;
        if (estObjet(avant)) corps.billing_address = { ...Object.fromEntries(ADRESSE_QONTO.map((k) => [k, enTexte(avant[k])]).filter(([, x]) => x)), ...adresse };
      }
      if (Object.keys(corps).length) await appelerOutil('Qonto', CONSEILS_QONTO, f, u, { methode: 'PATCH', entetes, corps });
      return externeId;
    }
    if (sorte === 'individual' ? !corps.first_name || !corps.last_name : !corps.name) throw new ErreurSortante('Qonto : nom du client manquant.');
    // Devise et langue sont exigées par Qonto pour facturer le client.
    const { donnees } = await appelerOutil('Qonto', CONSEILS_QONTO, f, new URL(`${QONTO}/clients`), { methode: 'POST', entetes, corps: { kind: sorte, currency: 'EUR', locale: 'fr', ...corps } });
    const id = idCree((donnees as { client?: unknown } | null)?.client);
    if (id && sorte) sortesQonto.set(id, sorte);
    return id;
  },
};

// ---------------------------------------------------------------- Odoo (JSON-RPC, odoo.com ou auto-hébergé)

const CONSEILS_ODOO: Conseils = {
  401: 'accès refusé : vérifiez l’identifiant et la clé d’API.',
  403: 'accès refusé par le serveur Odoo.',
  404: 'adresse introuvable : indiquez l’adresse de votre Odoo, ex. https://maboite.odoo.com.',
  429: 'trop de requêtes : nouvel essai à la prochaine synchronisation.',
};
const MODELES_ODOO = {
  clients: { modele: 'res.partner', domaine: [['customer_rank', '>', 0]], rang: 'customer_rank' },
  fournisseurs: { modele: 'res.partner', domaine: [['supplier_rank', '>', 0]], rang: 'supplier_rank' },
  produits: { modele: 'product.template', domaine: [], rang: null },
} as const;
const LUS_ODOO: Record<string, string> = {
  'res.partner': 'name,is_company,email,phone,street,street2,zip,city,country_id,vat,website,ref',
  'product.template': 'name,default_code,barcode,list_price,standard_price,categ_id,type',
};
const ECRIT_ODOO: Record<string, Record<string, TypeEcrit>> = {
  'res.partner': { name: 'texte', is_company: 'booleen', email: 'texte', phone: 'texte', street: 'texte', street2: 'texte', zip: 'texte', city: 'texte', vat: 'texte', website: 'texte', ref: 'texte', comment: 'texte' },
  'product.template': { name: 'texte', default_code: 'texte', barcode: 'texte', list_price: 'nombre', standard_price: 'nombre', description_sale: 'texte' },
};
const CHAMP_ODOO = /^[a-z_][a-z0-9_]{0,62}$/;
const PAGE_ODOO = 200;

interface SessionOdoo { point: URL; base: string; uid: number; cle: string }

function erreurOdoo(e: { message?: string; data?: { name?: string; message?: string } }): ErreurSortante {
  const nom = e.data?.name ?? '';
  const message = String(e.data?.message ?? e.message ?? '').replace(/\s+/g, ' ').slice(0, 200);
  if (/AccessDenied/.test(nom)) return new ErreurSortante('Odoo refuse l’identifiant ou la clé d’API (Préférences → Sécurité du compte → Clés API).', 401);
  if (/AccessError/.test(nom)) return new ErreurSortante(`Odoo : droits insuffisants pour cet utilisateur${message ? ` (${message})` : ''}.`, 403);
  if (/MissingError/.test(nom)) return new ErreurSortante('Odoo : fiche introuvable (supprimée ou archivée ?).', 404);
  if (/database .*(not exist|introuvable)|KeyError/i.test(`${nom} ${message}`)) return new ErreurSortante('Odoo : base de données introuvable, vérifiez son nom.', 404);
  return new ErreurSortante(`Odoo a refusé la demande${message ? ` : ${message}` : '.'}`);
}

async function rpcOdoo(f: Recuperateur, point: URL, service: string, methode: string, args: unknown[]): Promise<unknown> {
  const { donnees } = await appelerOutil('Odoo', CONSEILS_ODOO, f, point, { methode: 'POST', corps: { jsonrpc: '2.0', method: 'call', params: { service, method: methode, args }, id: 1 }, delaiMs: 30_000 });
  const d = donnees as { result?: unknown; error?: { message?: string; data?: { name?: string; message?: string } } } | null;
  if (d?.error) throw erreurOdoo(d.error);
  return d?.result;
}

/** Vérifie l'adresse (anti-SSRF) puis ouvre la session : identifiant utilisateur (uid) obtenu par `common.login`. */
async function sessionOdoo(cfg: Config, secret: string | null, f: Recuperateur): Promise<SessionOdoo> {
  const u = await verifierUrl(cfg.url);
  const base = exiger(cfg, 'base', /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/, 'Nom de base de données Odoo invalide.');
  const identifiant = exiger(cfg, 'identifiant', /^[^\s]{1,200}$/, 'Identifiant Odoo manquant (votre e-mail de connexion).');
  const cle = jeton(secret, 'Odoo');
  const point = new URL('/jsonrpc', u.origin);
  const uid = await rpcOdoo(f, point, 'common', 'login', [base, identifiant, cle]);
  if (typeof uid !== 'number' || uid <= 0) throw new ErreurSortante('Odoo refuse l’identifiant ou la clé d’API (Préférences → Sécurité du compte → Clés API).', 401);
  return { point, base, uid, cle };
}

const executerOdoo = (f: Recuperateur, s: SessionOdoo, modele: string, methode: string, args: unknown[], kwargs: Objet = {}) =>
  rpcOdoo(f, s.point, 'object', 'execute_kw', [s.base, s.uid, s.cle, modele, methode, args, kwargs]);

const objetOdoo = (cfg: Config) => MODELES_ODOO[exiger(cfg, 'objet', /^(clients|fournisseurs|produits)$/, 'Objet Odoo : clients, fournisseurs ou produits.') as keyof typeof MODELES_ODOO];

const proprietesOdoo = (cfg: Config, modele: string): string[] =>
  (cfg.proprietes || LUS_ODOO[modele] || '').split(',').map((x) => x.trim()).filter((x) => CHAMP_ODOO.test(x) && x !== 'id').slice(0, 60);

/** Odoo renvoie `false` pour un champ vide et [id, « nom »] pour une relation. */
function valeurOdoo(v: unknown): string {
  if (v === false || v === null || v === undefined) return '';
  if (Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'string') return v[1];
  return enTexte(v);
}

export const odoo: Adaptateur = {
  id: 'odoo', nom: 'Odoo', categorie: 'ERP', couleur: '#714b67',
  description: 'Clients, fournisseurs ou produits de votre Odoo (odoo.com ou auto-hébergé), dans les deux sens.',
  etapes: [
    // doc Odoo 19 (API externe) : accès réservé au forfait « Custom » ; une clé d'API dure trois mois au plus
    'Odoo en ligne : l’accès par API demande le forfait « Custom » (il est fermé en « One App Free » et « Standard »). Odoo auto-hébergé : rien de particulier.',
    'Dans Odoo : avatar → Mon profil (Préférences) → Sécurité du compte → « Nouvelle clé API », copiez-la. Odoo limite sa durée à trois mois : notez la date, il faudra en coller une nouvelle ici.',
    'Indiquez l’adresse de votre Odoo (https://maboite.odoo.com), le nom de la base (souvent « maboite ») et votre e-mail de connexion.',
    'Choisissez clients, fournisseurs ou produits ; l’utilisateur doit avoir les droits Ventes / Achats / Facturation.',
  ],
  champs: [
    { id: 'url', libelle: 'Adresse de votre Odoo', aide: 'HTTPS uniquement.', exemple: 'https://maboite.odoo.com', obligatoire: true },
    { id: 'base', libelle: 'Base de données', aide: 'Sur odoo.com, souvent le début de l’adresse.', exemple: 'maboite', obligatoire: true },
    { id: 'identifiant', libelle: 'Identifiant (e-mail de connexion)', aide: 'L’utilisateur qui possède la clé d’API.', exemple: 'vous@maboite.fr', obligatoire: true },
    { id: 'objet', libelle: 'Fiches Odoo à lire', aide: 'Clients, fournisseurs ou produits.', choix: ['clients', 'fournisseurs', 'produits'], obligatoire: true },
    { id: 'proprietes', libelle: 'Champs Odoo (facultatif)', aide: 'Noms techniques séparés par des virgules.', exemple: LUS_ODOO['res.partner'] ?? '' },
    { id: 'jeton', libelle: 'Clé d’API Odoo', aide: 'Chiffrée sur le serveur.', secret: true, obligatoire: true },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const o = objetOdoo(cfg);
    const fields = proprietesOdoo(cfg, o.modele);
    const s = await sessionOdoo(cfg, secret, f);
    const res: Enregistrement[] = [];
    for (let offset = 0; offset < MAX; offset += PAGE_ODOO) {
      const lignes = await executerOdoo(f, s, o.modele, 'search_read', [o.domaine], { fields, limit: PAGE_ODOO, offset, order: 'id asc' });
      if (!Array.isArray(lignes)) break;
      for (const r of lignes) {
        if (!estObjet(r) || typeof r.id !== 'number') continue;
        res.push({ externeId: String(r.id), champs: Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'id').map(([k, v]) => [k, valeurOdoo(v)])) });
      }
      if (lignes.length < PAGE_ODOO) break;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const o = objetOdoo(cfg);
    // Champs écrits : liste connue + champs simples choisis par l'utilisateur (jamais les relations *_id / *_ids).
    const autorises: Record<string, TypeEcrit> = { ...ECRIT_ODOO[o.modele] };
    for (const p of proprietesOdoo(cfg, o.modele)) if (!/_ids?$/.test(p) && !/_rank$/.test(p) && !Object.hasOwn(autorises, p)) autorises[p] = 'texte';
    const corps = corpsEcriture(valeurs, autorises);
    if (externeId) {
      const id = Number(idNumerique(externeId, 'Odoo'));
      if (!Object.keys(corps).length) return externeId;
      const s = await sessionOdoo(cfg, secret, f);
      await executerOdoo(f, s, o.modele, 'write', [[id], corps]);
      return externeId;
    }
    if (!corps.name) throw new ErreurSortante('Odoo : nom manquant.');
    if (o.rang) corps[o.rang] = 1; // le partenaire apparaît comme client ou comme fournisseur
    const s = await sessionOdoo(cfg, secret, f);
    const r = await executerOdoo(f, s, o.modele, 'create', [corps]);
    const id = Array.isArray(r) ? r[0] : r;
    return typeof id === 'number' ? String(id) : null;
  },
};

// ---------------------------------------------------------------- Pipedrive (API v2)

const CONSEILS_PIPEDRIVE: Conseils = {
  401: 'jeton d’API refusé. Copiez-le dans Pipedrive → avatar → Préférences personnelles → API (connecté avec « Se connecter avec Pipedrive » : reconnectez-vous).',
  403: 'droits insuffisants pour cet utilisateur Pipedrive (lecture / modification de ces fiches).',
  404: 'introuvable : vérifiez le domaine de l’entreprise (ex. monentreprise.pipedrive.com) ou la fiche (supprimée ?).',
  429: 'trop de requêtes (limite de débit Pipedrive) : nouvel essai à la prochaine synchronisation.',
};
const ECRIT_PIPEDRIVE: Record<string, Record<string, TypeEcrit>> = {
  organizations: { name: 'texte', address: 'texte', website: 'texte' },
  persons: { name: 'texte', email: 'texte', emails: 'liste', phone: 'texte', phones: 'liste' },
  deals: { title: 'texte', value: 'nombre', currency: 'texte', expected_close_date: 'texte' },
};

function hotePipedrive(cfg: Config): string {
  const d = (cfg.domaine ?? '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/.*$/, '').replace(/\.pipedrive\.com$/, '');
  if (!d) return 'api.pipedrive.com';
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(d)) throw new ErreurSortante('Domaine Pipedrive invalide (ex. monentreprise pour monentreprise.pipedrive.com).');
  return `${d}.pipedrive.com`;
}
const objetPipedrive = (cfg: Config) => exiger(cfg, 'objet', /^(organizations|persons|deals)$/, 'Objet Pipedrive : organizations, persons ou deals.');
/** Jeton d'API personnel (mode avancé) : en-tête x-api-token ; « Se connecter avec Pipedrive » : jeton OAuth en Bearer. */
const entetePipedrive = (cfg: Config, secret: string | null): Record<string, string> =>
  parRelais(cfg, 'pipedrive') ? { authorization: `Bearer ${jeton(secret, 'Pipedrive')}` } : { 'x-api-token': jeton(secret, 'Pipedrive') };

function champsPipedrive(r: Objet): Record<string, string> {
  const champs: Record<string, string> = {};
  for (const [k, v] of Object.entries(r)) {
    if (k === 'id') continue;
    if ((k === 'emails' || k === 'phones') && Array.isArray(v)) {
      const items = v.filter(estObjet);
      champs[k] = items.map((x) => enTexte(x.value)).filter(Boolean).join(', ');
      champs[k === 'emails' ? 'email' : 'phone'] = enTexte((items.find((x) => x.primary) ?? items[0])?.value);
    } else if (k === 'address' && estObjet(v)) {
      champs.address = enTexte(v.value);
      for (const [k2, v2] of Object.entries(v)) if (k2 !== 'value') champs[`address.${k2}`] = enTexte(v2);
    } else if (estObjet(v)) for (const [k2, v2] of Object.entries(v)) champs[`${k}.${k2}`] = enTexte(v2);
    else champs[k] = enTexte(v);
  }
  return champs;
}

export const pipedrive: Adaptateur = {
  id: 'pipedrive', nom: 'Pipedrive', categorie: 'CRM', couleur: '#017737',
  description: 'Organisations, personnes ou affaires de votre CRM Pipedrive, dans les deux sens.',
  etapes: [
    'Pipedrive → avatar (en haut à droite) → Préférences personnelles → onglet API → copiez votre jeton d’API personnel.',
    'Facultatif : le domaine de votre entreprise, visible dans l’adresse (monentreprise.pipedrive.com).',
    'Choisissez organizations (entreprises), persons (contacts) ou deals (affaires).',
  ],
  champs: [
    { id: 'objet', libelle: 'Fiches Pipedrive à lire', aide: 'Entreprises, contacts ou affaires.', choix: ['organizations', 'persons', 'deals'], obligatoire: true },
    { id: 'domaine', libelle: 'Domaine de l’entreprise (facultatif)', aide: 'La partie avant .pipedrive.com.', exemple: 'monentreprise', mode: 'cle' },
    { id: 'jeton', libelle: 'Jeton d’API personnel', aide: 'Chiffré sur le serveur.', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = objetPipedrive(cfg);
    const hote = hotePipedrive(cfg);
    const res: Enregistrement[] = [];
    let curseur = '';
    for (let page = 0; page < 10 && res.length < MAX; page++) {
      const u = new URL(`https://${hote}/api/v2/${objet}`);
      u.searchParams.set('limit', '500');
      if (curseur) u.searchParams.set('cursor', curseur);
      const { donnees } = await appelerOutil('Pipedrive', CONSEILS_PIPEDRIVE, f, u, { entetes: entetePipedrive(cfg, secret) });
      const d = donnees as { data?: Objet[] | null; additional_data?: { next_cursor?: string | null } } | null;
      for (const r of d?.data ?? []) {
        const id = enTexte(r.id);
        if (id) res.push({ externeId: id, champs: champsPipedrive(r) });
      }
      curseur = d?.additional_data?.next_cursor ?? '';
      if (!curseur) break;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const objet = objetPipedrive(cfg);
    const hote = hotePipedrive(cfg);
    const corps = corpsEcriture(valeurs, ECRIT_PIPEDRIVE[objet] ?? {});
    // Formats Pipedrive : adresse = { value }, e-mails et téléphones = [{ value, primary, label }].
    if (typeof corps.address === 'string') corps.address = { value: corps.address };
    for (const [un, plusieurs] of [['email', 'emails'], ['phone', 'phones']] as const) {
      const valeursListe = [...new Set([...(typeof corps[un] === 'string' ? [corps[un] as string] : []), ...(Array.isArray(corps[plusieurs]) ? (corps[plusieurs] as string[]) : [])])];
      delete corps[un];
      if (valeursListe.length) corps[plusieurs] = valeursListe.map((value, i) => ({ value, primary: i === 0, label: 'work' }));
    }
    const entetes = entetePipedrive(cfg, secret);
    if (externeId) {
      const id = idNumerique(externeId, 'Pipedrive');
      if (Object.keys(corps).length) await appelerOutil('Pipedrive', CONSEILS_PIPEDRIVE, f, new URL(`https://${hote}/api/v2/${objet}/${id}`), { methode: 'PATCH', entetes, corps });
      return externeId;
    }
    if (!corps[objet === 'deals' ? 'title' : 'name']) throw new ErreurSortante('Pipedrive : nom manquant.');
    const { donnees } = await appelerOutil('Pipedrive', CONSEILS_PIPEDRIVE, f, new URL(`https://${hote}/api/v2/${objet}`), { methode: 'POST', entetes, corps });
    return idCree((donnees as { data?: unknown } | null)?.data);
  },
};

// ---------------------------------------------------------------- Shopify (Admin API GraphQL)

export const VERSION_SHOPIFY = '2026-10';
const PAGE_SHOPIFY = 100; // coût de requête GraphQL raisonnable (plafond 1000 par requête)
const CONSEILS_SHOPIFY: Conseils = {
  401: 'jeton refusé : utilisez le jeton Admin API (shpat_…) ou l’identifiant et le secret client de l’application.',
  402: 'boutique suspendue ou en attente de paiement.',
  403: 'droits insuffisants : l’application doit avoir read_customers, write_customers, read_products et read_orders.',
  404: 'boutique introuvable : vérifiez l’adresse …myshopify.com.',
  423: 'boutique verrouillée.',
  429: 'trop de requêtes : nouvel essai à la prochaine synchronisation.',
};
const CONSEILS_JETON_SHOPIFY: Conseils = {
  ...CONSEILS_SHOPIFY,
  400: 'échange de jeton refusé : l’application doit être installée sur cette boutique et appartenir à la même organisation Shopify.',
  401: 'identifiant ou secret client refusés.',
};
/** Jetons d'accès obtenus par « client credentials » (valables 24 h), gardés en mémoire seulement. */
const jetonsShopify = new Map<string, { jeton: string; expire: number }>();

const QUERIES_SHOPIFY = {
  customers: `query LivingBusiness($n: Int!, $apres: String) { customers(first: $n, after: $apres, sortKey: ID) { pageInfo { hasNextPage endCursor } nodes {
    id firstName lastName displayName note tags state numberOfOrders createdAt updatedAt
    defaultEmailAddress { emailAddress } defaultPhoneNumber { phoneNumber } amountSpent { amount currencyCode }
    defaultAddress { company address1 address2 zip city country } } } }`,
  products: `query LivingBusiness($n: Int!, $apres: String) { products(first: $n, after: $apres, sortKey: ID) { pageInfo { hasNextPage endCursor } nodes {
    id title handle status vendor productType tags totalInventory createdAt updatedAt priceRangeV2 { minVariantPrice { amount currencyCode } } } } }`,
  orders: `query LivingBusiness($n: Int!, $apres: String) { orders(first: $n, after: $apres, sortKey: ID) { pageInfo { hasNextPage endCursor } nodes {
    id name createdAt displayFinancialStatus displayFulfillmentStatus totalPriceSet { shopMoney { amount currencyCode } } customer { id displayName } } } }`,
} as const;
const MUTATION_CLIENT_SHOPIFY = (nom: 'customerCreate' | 'customerUpdate') =>
  `mutation LivingBusiness($input: CustomerInput!) { ${nom}(input: $input) { customer { id } userErrors { field message } } }`;
const ECRIT_SHOPIFY: Record<string, TypeEcrit> = { firstName: 'texte', lastName: 'texte', email: 'texte', phone: 'texte', note: 'texte', tags: 'liste' };

function hoteShopify(cfg: Config): string {
  const b = (cfg.boutique ?? '').trim().toLowerCase().replace(/^https:\/\//, '').replace(/\/.*$/, '');
  const m = /^([a-z0-9][a-z0-9-]{0,60})(?:\.myshopify\.com)?$/.exec(b);
  if (!m) throw new ErreurSortante('Boutique Shopify : indiquez son adresse en …myshopify.com (Paramètres → Domaines), pas le domaine public.');
  return `${m[1]}.myshopify.com`;
}
const objetShopify = (cfg: Config) => exiger(cfg, 'objet', /^(customers|products|orders)$/, 'Objet Shopify : customers, products ou orders.') as keyof typeof QUERIES_SHOPIFY;

/**
 * Jeton Admin API : soit le jeton fixe (shpat_…, ou celui de « Se connecter avec Shopify »), soit échangé contre
 * l'identifiant et le secret client (Dev Dashboard).
 */
async function accesShopify(hote: string, cfg: Config, secret: string | null, f: Recuperateur): Promise<string> {
  const s = jeton(secret, 'Shopify');
  const clientId = (cfg.clientId ?? '').trim();
  if (!clientId || parRelais(cfg, 'shopify')) return s;
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientId)) throw new ErreurSortante('Identifiant client Shopify invalide.');
  const cle = createHash('sha256').update(`${hote}\n${clientId}\n${s}`).digest('hex');
  const connu = jetonsShopify.get(cle);
  if (connu && connu.expire > Date.now()) return connu.jeton;
  const { donnees } = await appelerOutil('Shopify', CONSEILS_JETON_SHOPIFY, f, new URL(`https://${hote}/admin/oauth/access_token`), { methode: 'POST', corps: { grant_type: 'client_credentials', client_id: clientId, client_secret: s } });
  const d = donnees as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof d?.access_token !== 'string' || !d.access_token) throw new ErreurSortante('Shopify n’a pas délivré de jeton d’accès.');
  const duree = Number(d.expires_in) > 0 ? Number(d.expires_in) : 3600;
  jetonsShopify.set(cle, { jeton: d.access_token, expire: Date.now() + Math.max(0, duree - 120) * 1000 });
  return d.access_token;
}

interface ReponseShopify {
  data?: Record<string, unknown>;
  errors?: { message?: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { requestedQueryCost?: number; throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } } };
}

async function graphqlShopify(f: Recuperateur, hote: string, acces: string, query: string, variables: Objet): Promise<ReponseShopify> {
  const { donnees } = await appelerOutil('Shopify', CONSEILS_SHOPIFY, f, new URL(`https://${hote}/admin/api/${VERSION_SHOPIFY}/graphql.json`), { methode: 'POST', entetes: { 'x-shopify-access-token': acces }, corps: { query, variables } });
  const d = (donnees ?? {}) as ReponseShopify;
  const e = d.errors?.[0];
  if (e) {
    const code = e.extensions?.code;
    if (code === 'THROTTLED') throw new ErreurSortante(`Shopify : ${CONSEILS_SHOPIFY[429]}`, 429);
    if (code === 'ACCESS_DENIED') throw new ErreurSortante(`Shopify : ${CONSEILS_SHOPIFY[403]}`, 403);
    throw new ErreurSortante(`Shopify a refusé la requête : ${String(e.message ?? 'erreur inconnue').slice(0, 200)}`);
  }
  return d;
}

/** Laisse le seau de coût GraphQL se remplir avant la page suivante (5 s au plus). */
async function patienterShopify(d: ReponseShopify) {
  const cout = d.extensions?.cost;
  const dispo = cout?.throttleStatus?.currentlyAvailable;
  const debit = cout?.throttleStatus?.restoreRate;
  const besoin = cout?.requestedQueryCost;
  if (typeof dispo !== 'number' || typeof debit !== 'number' || typeof besoin !== 'number' || debit <= 0 || dispo >= besoin) return;
  await new Promise((ok) => setTimeout(ok, Math.min(5000, Math.ceil(((besoin - dispo) / debit) * 1000))));
}

const montant = (x: unknown) => (estObjet(x) ? enTexte(x.amount) : '');
const devise = (x: unknown) => (estObjet(x) ? enTexte(x.currencyCode) : '');

function champsShopify(objet: keyof typeof QUERIES_SHOPIFY, n: Objet): Record<string, string> {
  const sous = (x: unknown, k: string) => (estObjet(x) ? enTexte(x[k]) : '');
  if (objet === 'customers') {
    return {
      displayName: enTexte(n.displayName), firstName: enTexte(n.firstName), lastName: enTexte(n.lastName),
      email: sous(n.defaultEmailAddress, 'emailAddress'), phone: sous(n.defaultPhoneNumber, 'phoneNumber'),
      company: sous(n.defaultAddress, 'company'), address1: sous(n.defaultAddress, 'address1'), address2: sous(n.defaultAddress, 'address2'),
      zip: sous(n.defaultAddress, 'zip'), city: sous(n.defaultAddress, 'city'), country: sous(n.defaultAddress, 'country'),
      note: enTexte(n.note), tags: enTexte(n.tags), state: enTexte(n.state), numberOfOrders: enTexte(n.numberOfOrders),
      amountSpent: montant(n.amountSpent), currency: devise(n.amountSpent), createdAt: enTexte(n.createdAt), updatedAt: enTexte(n.updatedAt),
    };
  }
  if (objet === 'products') {
    const prix = estObjet(n.priceRangeV2) ? n.priceRangeV2.minVariantPrice : undefined;
    return {
      title: enTexte(n.title), handle: enTexte(n.handle), status: enTexte(n.status), vendor: enTexte(n.vendor), productType: enTexte(n.productType),
      tags: enTexte(n.tags), totalInventory: enTexte(n.totalInventory), price: montant(prix), currency: devise(prix), createdAt: enTexte(n.createdAt), updatedAt: enTexte(n.updatedAt),
    };
  }
  const total = estObjet(n.totalPriceSet) ? n.totalPriceSet.shopMoney : undefined;
  return {
    name: enTexte(n.name), createdAt: enTexte(n.createdAt), displayFinancialStatus: enTexte(n.displayFinancialStatus), displayFulfillmentStatus: enTexte(n.displayFulfillmentStatus),
    total: montant(total), currency: devise(total), customer: sous(n.customer, 'displayName'),
  };
}

export const shopify: Adaptateur = {
  id: 'shopify', nom: 'Shopify', categorie: 'E-commerce', couleur: '#5e8e3e',
  description: 'Les clients de votre boutique Shopify dans les deux sens ; produits et commandes en lecture.',
  etapes: [
    'Shopify → Paramètres → Applications → Développer des applications : créez l’application (Dev Dashboard), accès read_customers, write_customers, read_products, read_orders, puis installez-la sur la boutique.',
    'Copiez l’identifiant client (Client ID) et le secret client. Ancienne application personnalisée : son jeton shpat_… suffit, laissez l’identifiant client vide.',
    'Indiquez l’adresse …myshopify.com de la boutique (Paramètres → Domaines) et ce que vous voulez synchroniser.',
  ],
  champs: [
    { id: 'boutique', libelle: 'Adresse de la boutique', aide: 'Celle en .myshopify.com, pas le domaine public.', exemple: 'ma-boutique.myshopify.com', obligatoire: true },
    { id: 'objet', libelle: 'Fiches Shopify à lire', aide: 'Clients (dans les deux sens) ; produits et commandes en lecture seule.', choix: ['customers', 'products', 'orders'], obligatoire: true },
    { id: 'clientId', libelle: 'Identifiant client (facultatif)', aide: 'Client ID de l’application du Dev Dashboard ; vide si vous collez un jeton shpat_….', exemple: '0123456789abcdef0123456789abcdef', mode: 'cle' },
    { id: 'jeton', libelle: 'Secret client ou jeton Admin API', aide: 'Chiffré sur le serveur.', exemple: 'shpat_… ou shpss_…', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const hote = hoteShopify(cfg);
    const objet = objetShopify(cfg);
    const acces = await accesShopify(hote, cfg, secret, f);
    const res: Enregistrement[] = [];
    let apres: string | null = null;
    for (let page = 0; page < MAX / PAGE_SHOPIFY && res.length < MAX; page++) {
      const d = await graphqlShopify(f, hote, acces, QUERIES_SHOPIFY[objet], { n: PAGE_SHOPIFY, apres });
      const connexion = d.data?.[objet] as { nodes?: Objet[]; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } | undefined;
      for (const n of connexion?.nodes ?? []) {
        const id = enTexte(n.id);
        if (id) res.push({ externeId: id, champs: champsShopify(objet, n) });
      }
      if (!connexion?.pageInfo?.hasNextPage || !connexion.pageInfo.endCursor) break;
      apres = connexion.pageInfo.endCursor;
      await patienterShopify(d);
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const hote = hoteShopify(cfg);
    const objet = objetShopify(cfg);
    if (objet !== 'customers') throw new ErreurSortante('Shopify : produits et commandes sont en lecture seule ici, réglez ce connecteur en « lecture ».');
    const v = { ...valeurs };
    if (!vide(v.displayName) && vide(v.firstName) && vide(v.lastName)) [v.firstName, v.lastName] = separerNom(String(v.displayName));
    const input = corpsEcriture(v, ECRIT_SHOPIFY);
    if (externeId && !/^gid:\/\/shopify\/Customer\/\d{1,20}$/.test(externeId)) throw new ErreurSortante('Identifiant de client Shopify invalide.');
    if (externeId && !Object.keys(input).length) return externeId;
    if (!externeId && !input.firstName && !input.lastName && !input.email && !input.phone) throw new ErreurSortante('Shopify : nom, e-mail ou téléphone du client manquant.');
    const acces = await accesShopify(hote, cfg, secret, f);
    const nom = externeId ? 'customerUpdate' : 'customerCreate';
    const d = await graphqlShopify(f, hote, acces, MUTATION_CLIENT_SHOPIFY(nom), { input: externeId ? { id: externeId, ...input } : input });
    const r = d.data?.[nom] as { customer?: { id?: string } | null; userErrors?: { message?: string }[] } | undefined;
    if (r?.userErrors?.length) throw new ErreurSortante(`Shopify a refusé : ${r.userErrors.map((e) => e.message ?? '').join(' ; ').slice(0, 200)}`);
    return externeId ?? r?.customer?.id ?? null;
  },
};

// Outils communs, réutilisés par les connecteurs de `sources-metier-2.ts`.
export { aplatirNiveau, appelerOutil, corpsEcriture, enTexte, estObjet, exiger, idCree, idNumerique, jeton, MAX, separerNom, vide, vrai };
export type { Conseils, Objet, TypeEcrit };
