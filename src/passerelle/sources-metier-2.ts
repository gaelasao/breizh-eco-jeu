/**
 * Connecteurs natifs « métier », deuxième série, dans les deux sens : Axonaut, Stripe, WooCommerce, PrestaShop, Sellsy.
 * Même contrat et mêmes outils que `sources-metier.ts` : tous les appels passent par `appeler()` (délai, taille bornée,
 * redirections refusées). Hôtes fixes pour Axonaut, Stripe et Sellsy ; l'adresse des boutiques auto-hébergées
 * (WooCommerce, PrestaShop) passe par `verifierUrl` (HTTPS, jamais d'adresse privée ou interne).
 * Écriture : seuls les champs connus de l'outil sont envoyés, une valeur vide dans le jeu n'est jamais envoyée (le jeu
 * n'efface rien dans l'outil) et un sous-objet partiel (adresse, mentions légales) est complété par la fiche actuelle.
 * Lecture : pagination suivie, 5000 enregistrements au plus. Aucun secret dans une adresse ni dans un message.
 */
import { createHash, randomBytes } from 'node:crypto';
import { parRelais } from './oauth-relais.ts';
import type { Adaptateur, Enregistrement, ValeurSortante } from './sources.ts';
import { aplatirNiveau, appelerOutil, corpsEcriture, enTexte, estObjet, exiger, idCree, idNumerique, jeton, MAX, separerNom, vide, type Conseils, type Objet, type TypeEcrit } from './sources-metier.ts';
import { CorpsBrut, ErreurSortante, verifierUrl, type Recuperateur } from './sortant.ts';

type Config = Readonly<Record<string, string>>;
type InitAppel = NonNullable<Parameters<typeof appelerOutil>[4]>;

const lectureSeule = (outil: string, quoi: string) => new ErreurSortante(`${outil} : ${quoi} en lecture seule ici, réglez ce connecteur en « lecture ».`);

/** « prénom nom » lisible, pour rapprocher une fiche de personne d'un tiers du jeu. */
const nomComplet = (...parties: unknown[]) => parties.map(enTexte).filter(Boolean).join(' ');

/** Nom complet du jeu → prénom / nom de l'outil, quand ceux-ci ne sont pas liés séparément. */
function decouperNom(valeurs: Readonly<Record<string, ValeurSortante>>, prenom: string, nom: string): Record<string, ValeurSortante> {
  const v = { ...valeurs };
  if (!vide(v.nom_complet) && vide(v[prenom]) && vide(v[nom])) [v[prenom], v[nom]] = separerNom(String(v.nom_complet));
  return v;
}

/** Complète un sous-objet partiel par ses valeurs actuelles dans l'outil (jamais tronqué, jamais effacé). */
function completer(corps: Objet, cle: string, actuel: unknown) {
  const partiel = corps[cle];
  if (!estObjet(partiel) || !estObjet(actuel)) return;
  const avant = Object.fromEntries(Object.entries(actuel).filter(([, x]) => x !== null && x !== undefined && x !== '' && typeof x !== 'object'));
  corps[cle] = { ...avant, ...partiel };
}

/** Une boutique auto-hébergée qui redirige (http → https, www…) : l'adresse saisie n'est pas la bonne. */
const REDIRECTION = 'l’adresse redirige ailleurs : indiquez l’adresse exacte de la boutique (https://, avec ou sans www).';
const CONSEILS_REDIRECTION: Conseils = { 301: REDIRECTION, 302: REDIRECTION, 307: REDIRECTION, 308: REDIRECTION };

/** Adresse de base d'un site auto-hébergé (anti-SSRF), sans le chemin d'API éventuellement collé par l'utilisateur. */
async function baseSite(brut: string | undefined, suffixe: RegExp): Promise<string> {
  const u = await verifierUrl(brut);
  return `${u.origin}${u.pathname.replace(suffixe, '').replace(/\/+$/, '')}`;
}

const basic = (identifiant: string, secret: string) => `Basic ${Buffer.from(`${identifiant}:${secret}`).toString('base64')}`;

// ---------------------------------------------------------------- Axonaut (API v2)

const AXONAUT = 'https://axonaut.com/api/v2';
const CONSEILS_AXONAUT: Conseils = {
  400: 'fiche refusée par Axonaut (champ invalide : pays, SIRET, devise…).',
  401: 'clé d’API refusée. Copiez-la dans Axonaut → Paramètres → API.',
  403: 'droits insuffisants pour l’utilisateur de cette clé Axonaut.',
  404: 'entreprise introuvable (supprimée ou archivée dans Axonaut ?).',
  429: 'trop de requêtes : nouvel essai à la prochaine synchronisation.',
};
const TYPES_AXONAUT = { clients: 'customer', prospects: 'prospect', fournisseurs: 'supplier' } as const;
const ADRESSE_AXONAUT: Record<string, TypeEcrit> = { name: 'texte', address_street: 'texte', address_zip_code: 'texte', address_city: 'texte', address_country: 'texte', siret: 'texte', intracommunity_number: 'texte', comments: 'texte' };
const ECRIT_AXONAUT: Record<string, TypeEcrit> = { ...ADRESSE_AXONAUT, thirdparty_code: 'texte', internal_id: 'texte', currency: 'texte', language: 'texte' };

const objetAxonaut = (cfg: Config) => exiger(cfg, 'objet', /^(clients|prospects|fournisseurs)$/, 'Objet Axonaut : clients, prospects ou fournisseurs.') as keyof typeof TYPES_AXONAUT;
function enteteAxonaut(secret: string | null) {
  const cle = jeton(secret, 'Axonaut');
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(cle)) throw new ErreurSortante('Axonaut : clé d’API invalide.');
  return { userApiKey: cle };
}

export const axonaut: Adaptateur = {
  id: 'axonaut', nom: 'Axonaut', categorie: 'Gestion', couleur: '#3a57e8',
  description: 'Clients, prospects ou fournisseurs de votre Axonaut (CRM et facturation), dans les deux sens.',
  etapes: [
    'Axonaut → Paramètres → API : affichez et copiez votre clé d’API (elle ouvre tout le compte, gardez-la secrète).',
    'Choisissez clients, prospects ou fournisseurs : chacun est lu à part dans les entreprises Axonaut.',
    'Collez la clé dans le champ chiffré ; IBAN, BIC et pièces jointes ne sont jamais importés.',
  ],
  champs: [
    { id: 'objet', libelle: 'Fiches Axonaut à lire', aide: 'Clients, prospects ou fournisseurs.', choix: ['clients', 'prospects', 'fournisseurs'], obligatoire: true },
    { id: 'jeton', libelle: 'Clé d’API Axonaut', aide: 'Chiffrée sur le serveur.', exemple: '0a1b2c3d4e5f…', secret: true, obligatoire: true },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = objetAxonaut(cfg);
    const entetes = enteteAxonaut(secret);
    const res: Enregistrement[] = [];
    const vus = new Set<string>();
    let taille = 0;
    // Pagination Axonaut : numéro de page (à partir de 1) dans l'en-tête « page », taille de page fixée par Axonaut.
    for (let page = 1; page <= 100 && res.length < MAX; page++) {
      const u = new URL(`${AXONAUT}/companies`);
      u.searchParams.set('type', TYPES_AXONAUT[objet]);
      u.searchParams.set('sort', 'id');
      const { donnees } = await appelerOutil('Axonaut', CONSEILS_AXONAUT, f, u, { entetes: { ...entetes, page: String(page) } });
      const lignes = Array.isArray(donnees) ? donnees.filter(estObjet) : [];
      let nouveaux = 0;
      for (const r of lignes) {
        const id = enTexte(r.id);
        if (!id || vus.has(id)) continue;
        vus.add(id);
        nouveaux++;
        // Coordonnées bancaires, contacts et documents ne sont jamais importés.
        res.push({ externeId: id, champs: aplatirNiveau(r, ['id', 'iban', 'bic', 'employees', 'documents']) });
      }
      if (!nouveaux || (taille && lignes.length < taille)) break;
      taille ||= lignes.length;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const objet = objetAxonaut(cfg);
    const entetes = enteteAxonaut(secret);
    const ecrire = async (methode: 'POST' | 'PATCH', chemin: string, corps: Objet) =>
      (await appelerOutil('Axonaut', CONSEILS_AXONAUT, f, new URL(`${AXONAUT}/${chemin}`), { methode, entetes, corps })).donnees;
    if (externeId) {
      const id = idNumerique(externeId, 'Axonaut');
      const corps = corpsEcriture(valeurs, ECRIT_AXONAUT);
      if (Object.keys(corps).length) await ecrire('PATCH', `companies/${id}`, corps);
      return externeId;
    }
    if (objet === 'fournisseurs') {
      // Un fournisseur se crée par son propre point ; il est lu (et modifié) ensuite comme entreprise : son company_id.
      const corps = corpsEcriture(valeurs, ADRESSE_AXONAUT);
      if (!corps.name) throw new ErreurSortante('Axonaut : nom du fournisseur manquant.');
      const d = await ecrire('POST', 'suppliers', corps);
      const id = estObjet(d) ? d.company_id : undefined;
      return typeof id === 'number' || (typeof id === 'string' && id) ? String(id) : null;
    }
    const corps = corpsEcriture(valeurs, ECRIT_AXONAUT);
    if (!corps.name) throw new ErreurSortante('Axonaut : nom de l’entreprise manquant.');
    return idCree(await ecrire('POST', 'companies', { ...(objet === 'clients' ? { is_customer: true } : { is_prospect: true }), ...corps }));
  },
};

// ---------------------------------------------------------------- Stripe (API v1, clé restreinte recommandée)

const STRIPE = 'https://api.stripe.com/v1';
const CONSEILS_STRIPE: Conseils = {
  400: 'demande refusée par Stripe (e-mail invalide, pays sur 2 lettres, téléphone de plus de 20 caractères…).',
  401: 'clé refusée : utilisez une clé restreinte (rk_…) ou secrète (sk_…) de Développeurs → Clés API, du bon mode (test ou production).',
  403: 'droits insuffisants : la clé restreinte doit avoir Clients en écriture (ou lecture) et Factures en lecture.',
  404: 'client introuvable (supprimé dans Stripe, ou clé d’un autre compte ou d’un autre mode ?).',
  429: 'trop de requêtes : nouvel essai à la prochaine synchronisation.',
};
const ADRESSE_STRIPE = ['line1', 'line2', 'postal_code', 'city', 'state', 'country'] as const;
const ECRIT_STRIPE: Record<string, TypeEcrit> = {
  name: 'texte', email: 'texte', phone: 'texte', description: 'texte', preferred_locales: 'liste',
  ...Object.fromEntries(ADRESSE_STRIPE.map((k) => [`address.${k}`, 'texte' as const])),
};
const METADATA_STRIPE = /^metadata\.[A-Za-z0-9_-]{1,40}$/;
/**
 * Devises sans décimale, ou à trois décimales, chez Stripe (montants en plus petite unité). Le shilling ougandais (UGX)
 * n'y est pas : Stripe le fait écrire sur deux décimales, comme l'euro (5 UGX = 500), ainsi que la couronne islandaise.
 */
const DEVISES_0 = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const DEVISES_3 = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);

const objetStripe = (cfg: Config) => exiger(cfg, 'objet', /^(customers|invoices)$/, 'Objet Stripe : customers (clients) ou invoices (factures).') as 'customers' | 'invoices';
function enteteStripe(secret: string | null) {
  const cle = jeton(secret, 'Stripe');
  if (/^pk_/.test(cle)) throw new ErreurSortante('Stripe : c’est la clé publiable (pk_…) ; il faut une clé restreinte (rk_…) ou secrète (sk_…).');
  if (!/^(sk|rk)_(live|test)_[A-Za-z0-9]{8,250}$/.test(cle)) throw new ErreurSortante('Stripe : clé invalide (rk_live_…, rk_test_…, sk_live_… ou sk_test_…).');
  return { authorization: `Bearer ${cle}` };
}

function montantStripe(v: unknown, devise: unknown): string {
  if (typeof v !== 'number') return '';
  const d = enTexte(devise).toLowerCase();
  const decimales = DEVISES_0.has(d) ? 0 : DEVISES_3.has(d) ? 3 : 2;
  return (v / 10 ** decimales).toFixed(decimales);
}
const dateStripe = (v: unknown) => (typeof v === 'number' && v > 0 ? new Date(v * 1000).toISOString().slice(0, 10) : '');

function champsStripe(objet: 'customers' | 'invoices', r: Objet): Record<string, string> {
  if (objet === 'invoices') {
    return {
      number: enTexte(r.number), customer: enTexte(r.customer), customer_name: enTexte(r.customer_name), customer_email: enTexte(r.customer_email),
      status: enTexte(r.status), currency: enTexte(r.currency).toUpperCase(), total: montantStripe(r.total, r.currency),
      amount_due: montantStripe(r.amount_due, r.currency), amount_paid: montantStripe(r.amount_paid, r.currency), amount_remaining: montantStripe(r.amount_remaining, r.currency),
      created: dateStripe(r.created), due_date: dateStripe(r.due_date), hosted_invoice_url: enTexte(r.hosted_invoice_url),
    };
  }
  const adresse = estObjet(r.address) ? r.address : {};
  const champs: Record<string, string> = {
    name: enTexte(r.name), email: enTexte(r.email), phone: enTexte(r.phone), description: enTexte(r.description),
    ...Object.fromEntries(ADRESSE_STRIPE.map((k) => [`address.${k}`, enTexte(adresse[k])])),
    currency: enTexte(r.currency).toUpperCase(), balance: montantStripe(r.balance, r.currency), delinquent: enTexte(r.delinquent),
    preferred_locales: enTexte(r.preferred_locales), created: dateStripe(r.created),
  };
  if (estObjet(r.metadata)) for (const [k, v] of Object.entries(r.metadata)) champs[`metadata.${k}`] = enTexte(v);
  return champs;
}

/** Stripe (v1) n'accepte que des corps « formulaire » : { address: { city } } → address[city]=…, listes → x[0]=…. */
function formulaire(corps: Objet): CorpsBrut {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(corps)) {
    if (Array.isArray(v)) v.forEach((x, i) => p.append(`${k}[${i}]`, String(x)));
    else if (estObjet(v)) for (const [k2, v2] of Object.entries(v)) p.append(`${k}[${k2}]`, String(v2));
    else p.append(k, String(v));
  }
  return new CorpsBrut('application/x-www-form-urlencoded', p.toString());
}

export const stripe: Adaptateur = {
  id: 'stripe', nom: 'Stripe', categorie: 'Paiement', couleur: '#635bff',
  description: 'Les clients de votre compte Stripe dans les deux sens ; factures en lecture (paiements jamais touchés).',
  etapes: [
    'Stripe → Développeurs → Clés API → « Créer une clé restreinte » : recommandé, plutôt que la clé secrète sk_… qui ouvre tout le compte.',
    'Droits de la clé : Clients en « Écriture » (ou « Lecture » pour ne faire que lire), Factures en « Lecture », tout le reste sur « Aucun ».',
    'Copiez la clé rk_live_… (ou rk_test_… pour essayer en mode test) et choisissez customers (clients) ou invoices (factures).',
  ],
  champs: [
    { id: 'objet', libelle: 'Fiches Stripe à lire', aide: 'Clients (dans les deux sens) ; factures en lecture seule.', choix: ['customers', 'invoices'], obligatoire: true },
    { id: 'jeton', libelle: 'Clé restreinte (ou secrète) Stripe', aide: 'Chiffrée sur le serveur.', exemple: 'rk_live_…', secret: true, obligatoire: true },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = objetStripe(cfg);
    const entetes = enteteStripe(secret);
    const res: Enregistrement[] = [];
    let apres = '';
    for (let page = 0; page < 50 && res.length < MAX; page++) {
      const u = new URL(`${STRIPE}/${objet}`);
      u.searchParams.set('limit', '100');
      if (apres) u.searchParams.set('starting_after', apres);
      const { donnees } = await appelerOutil('Stripe', CONSEILS_STRIPE, f, u, { entetes });
      const d = donnees as { data?: unknown[]; has_more?: boolean } | null;
      const lignes = (d?.data ?? []).filter(estObjet);
      for (const r of lignes) {
        const id = enTexte(r.id);
        if (id) res.push({ externeId: id, champs: champsStripe(objet, r) });
      }
      apres = enTexte(lignes.at(-1)?.id);
      if (!d?.has_more || !apres) break;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    if (objetStripe(cfg) !== 'customers') throw lectureSeule('Stripe', 'les factures sont');
    const entetes = enteteStripe(secret);
    const autorises: Record<string, TypeEcrit> = { ...ECRIT_STRIPE };
    for (const k of Object.keys(valeurs)) if (METADATA_STRIPE.test(k)) autorises[k] = 'texte';
    const corps = corpsEcriture(valeurs, autorises);
    if (externeId) {
      if (!/^cus_[A-Za-z0-9]{1,250}$/.test(externeId)) throw new ErreurSortante('Identifiant de client Stripe invalide.');
      if (!Object.keys(corps).length) return externeId;
      const u = new URL(`${STRIPE}/customers/${externeId}`);
      // Adresse partielle (ex. seule la ville est liée au jeu) : complétée par l'adresse actuelle du client.
      const adresse = corps.address;
      if (estObjet(adresse) && !ADRESSE_STRIPE.every((k) => adresse[k])) completer(corps, 'address', ((await appelerOutil('Stripe', CONSEILS_STRIPE, f, u, { entetes })).donnees as Objet | null)?.address);
      await appelerOutil('Stripe', CONSEILS_STRIPE, f, u, { methode: 'POST', entetes, corps: formulaire(corps) });
      return externeId;
    }
    if (!corps.name && !corps.email) throw new ErreurSortante('Stripe : nom ou e-mail du client manquant.');
    const { donnees } = await appelerOutil('Stripe', CONSEILS_STRIPE, f, new URL(`${STRIPE}/customers`), { methode: 'POST', entetes, corps: formulaire(corps) });
    return idCree(donnees);
  },
};

// ---------------------------------------------------------------- WooCommerce (REST API v3, auto-hébergé)

const CONSEILS_WOO: Conseils = {
  ...CONSEILS_REDIRECTION,
  400: 'fiche refusée par WooCommerce (e-mail invalide ou déjà utilisé par un autre compte ?).',
  401: 'clé ou secret refusés, ou clé sans droit d’écriture (WooCommerce → Réglages → Avancé → API REST, droits « Lecture/Écriture »). Clé correcte ? L’hébergeur retire peut-être l’en-tête Authorization.',
  403: 'accès refusé : l’utilisateur de la clé doit gérer la boutique (administrateur ou gestionnaire de boutique).',
  404: 'introuvable : vérifiez l’adresse de la boutique et que les permaliens WordPress ne sont pas « Simples » (ou fiche supprimée ?).',
  429: 'trop de requêtes : nouvel essai à la prochaine synchronisation.',
};
const PAGE_WOO = 100;
const ADRESSE_WOO = ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'] as const;
const ECRIT_WOO: Record<string, TypeEcrit> = {
  email: 'texte', first_name: 'texte', last_name: 'texte', 'billing.email': 'texte',
  ...Object.fromEntries(ADRESSE_WOO.flatMap((k) => [[`billing.${k}`, 'texte' as const], [`shipping.${k}`, 'texte' as const]])),
};

const objetWoo = (cfg: Config) => exiger(cfg, 'objet', /^(customers|products|orders)$/, 'Objet WooCommerce : customers, products ou orders.') as 'customers' | 'products' | 'orders';

async function accesWoo(cfg: Config, secret: string | null) {
  const base = `${await baseSite(cfg.boutique, /\/(wp-json|wp-admin)(\/.*)?$/)}/wp-json/wc/v3`;
  const cle = exiger(cfg, 'cle', /^ck_[A-Za-z0-9]{20,64}$/, 'Clé client WooCommerce invalide (ck_…).');
  const s = jeton(secret, 'WooCommerce');
  if (!/^cs_[A-Za-z0-9]{20,64}$/.test(s)) throw new ErreurSortante('WooCommerce : secret client invalide (cs_…).');
  return { base, entetes: { authorization: basic(cle, s) } };
}

function champsWoo(objet: 'customers' | 'products' | 'orders', r: Objet): Record<string, string> {
  const sous = (x: unknown, k: string) => (estObjet(x) ? enTexte(x[k]) : '');
  if (objet === 'customers') {
    return { nom_complet: nomComplet(r.first_name, r.last_name), ...aplatirNiveau(r, ['id', '_links', 'meta_data', 'avatar_url', 'password']) };
  }
  if (objet === 'products') {
    return {
      name: enTexte(r.name), sku: enTexte(r.sku), type: enTexte(r.type), status: enTexte(r.status), price: enTexte(r.price), regular_price: enTexte(r.regular_price),
      sale_price: enTexte(r.sale_price), stock_quantity: enTexte(r.stock_quantity), stock_status: enTexte(r.stock_status), total_sales: enTexte(r.total_sales),
      categories: enTexte(r.categories), date_created: enTexte(r.date_created), date_modified: enTexte(r.date_modified),
    };
  }
  return {
    number: enTexte(r.number), status: enTexte(r.status), currency: enTexte(r.currency), total: enTexte(r.total), total_tax: enTexte(r.total_tax),
    date_created: enTexte(r.date_created), date_paid: enTexte(r.date_paid), payment_method_title: enTexte(r.payment_method_title), customer_id: enTexte(r.customer_id),
    client: sous(r.billing, 'company') || nomComplet(sous(r.billing, 'first_name'), sous(r.billing, 'last_name')),
    'billing.company': sous(r.billing, 'company'), 'billing.email': sous(r.billing, 'email'), 'billing.city': sous(r.billing, 'city'),
  };
}

export const woocommerce: Adaptateur = {
  id: 'woocommerce', nom: 'WooCommerce', categorie: 'E-commerce', couleur: '#7f54b3',
  description: 'Les clients de votre boutique WooCommerce (WordPress) dans les deux sens ; produits et commandes en lecture.',
  etapes: [
    'WordPress → WooCommerce → Réglages → Avancé → API REST → « Ajouter une clé », droits « Lecture/Écriture » (ou « Lecture » seule).',
    'Copiez la clé client (ck_…) et le secret client (cs_…) : ils ne sont affichés qu’une fois.',
    'Indiquez l’adresse du site en https:// et ce que vous voulez synchroniser (créer un client crée son compte dans la boutique).',
  ],
  champs: [
    { id: 'boutique', libelle: 'Adresse de la boutique', aide: 'HTTPS uniquement : l’adresse du site WordPress.', exemple: 'https://boutique.exemple.fr', obligatoire: true },
    { id: 'objet', libelle: 'Fiches WooCommerce à lire', aide: 'Clients (dans les deux sens) ; produits et commandes en lecture seule.', choix: ['customers', 'products', 'orders'], obligatoire: true },
    { id: 'cle', libelle: 'Clé client (consumer key)', aide: 'Commence par ck_ ; inutile sans le secret.', exemple: 'ck_0123456789abcdef…', obligatoire: true, mode: 'cle' },
    { id: 'jeton', libelle: 'Secret client (consumer secret)', aide: 'Commence par cs_. Chiffré sur le serveur.', exemple: 'cs_0123456789abcdef…', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = objetWoo(cfg);
    const { base, entetes } = await accesWoo(cfg, secret);
    const res: Enregistrement[] = [];
    for (let page = 1; page <= MAX / PAGE_WOO && res.length < MAX; page++) {
      const u = new URL(`${base}/${objet}`);
      u.searchParams.set('per_page', String(PAGE_WOO));
      u.searchParams.set('page', String(page));
      u.searchParams.set('orderby', 'id');
      u.searchParams.set('order', 'asc');
      const { donnees, entetes: reponse } = await appelerOutil('WooCommerce', CONSEILS_WOO, f, u, { entetes });
      const lignes = Array.isArray(donnees) ? donnees.filter(estObjet) : [];
      for (const r of lignes) {
        const id = enTexte(r.id);
        if (id) res.push({ externeId: id, champs: champsWoo(objet, r) });
      }
      const pages = Number(reponse.get('x-wp-totalpages'));
      if (lignes.length < PAGE_WOO || (pages > 0 && page >= pages)) break;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const objet = objetWoo(cfg);
    if (objet !== 'customers') throw lectureSeule('WooCommerce', 'produits et commandes sont');
    if (externeId) idNumerique(externeId, 'WooCommerce');
    const corps = corpsEcriture(decouperNom(valeurs, 'first_name', 'last_name'), ECRIT_WOO);
    if (externeId && !Object.keys(corps).length) return externeId;
    if (!externeId && !corps.email) throw new ErreurSortante('WooCommerce : e-mail du client manquant (exigé pour créer son compte).');
    const { base, entetes } = await accesWoo(cfg, secret);
    // Adresses partielles acceptées : WooCommerce ne modifie que les sous-champs envoyés.
    const { donnees } = await appelerOutil('WooCommerce', CONSEILS_WOO, f, new URL(`${base}/customers${externeId ? `/${externeId}` : ''}`), { methode: externeId ? 'PUT' : 'POST', entetes, corps });
    return externeId ?? idCree(donnees);
  },
};

// ---------------------------------------------------------------- PrestaShop (webservice, auto-hébergé)

const CONSEILS_PRESTA: Conseils = {
  ...CONSEILS_REDIRECTION,
  400: 'fiche refusée par PrestaShop (prénom ou nom avec chiffres ou caractères spéciaux, e-mail invalide ou déjà utilisé…).',
  401: 'clé du webservice refusée, ou droit manquant sur cette ressource (Paramètres avancés → Webservice : customers, products).',
  403: 'accès refusé par la boutique : vérifiez la clé et ses droits.',
  404: 'webservice introuvable : vérifiez l’adresse de la boutique et la réécriture d’URL du serveur pour /api (ou fiche supprimée ?).',
  405: 'méthode refusée : la mise à jour (PATCH) demande PrestaShop 8 ou plus et le droit PATCH sur customers.',
  429: 'trop de requêtes : nouvel essai à la prochaine synchronisation.',
  503: 'webservice désactivé : Paramètres avancés → Webservice → « Activer le service web de PrestaShop ».',
};
const PAGE_PRESTA = 100;
const ECRIT_PRESTA: Record<string, TypeEcrit> = { firstname: 'texte', lastname: 'texte', email: 'texte', company: 'texte', siret: 'texte', ape: 'texte', website: 'texte', note: 'texte' };
/** Champs jamais importés : mot de passe (haché), clés et jetons de sécurité, adresse IP, liens internes. */
const IGNORES_PRESTA = ['id', 'passwd', 'secure_key', 'last_passwd_gen', 'reset_password_token', 'reset_password_validity', 'ip_registration_newsletter', 'associations'];
const AFFICHAGE_PRESTA = { customers: 'full', products: '[id,reference,ean13,name,price,wholesale_price,active,id_category_default,date_add,date_upd]' } as const;

const objetPresta = (cfg: Config) => exiger(cfg, 'objet', /^(customers|products)$/, 'Objet PrestaShop : customers ou products.') as keyof typeof AFFICHAGE_PRESTA;

async function accesPresta(cfg: Config, secret: string | null) {
  const base = `${await baseSite(cfg.boutique, /\/api(\/.*)?$/)}/api`;
  const cle = jeton(secret, 'PrestaShop');
  if (!/^[A-Za-z0-9]{32}$/.test(cle)) throw new ErreurSortante('PrestaShop : clé du webservice invalide (32 lettres et chiffres).');
  // L'en-tête Authorization (Basic, clé en identifiant, mot de passe vide) : la clé n'est jamais dans l'adresse.
  return { base, entetes: { authorization: basic(cle, ''), 'output-format': 'JSON' } };
}

/** Champ multilingue PrestaShop ([{ id, value }]) : première traduction non vide. */
function valeurPresta(v: unknown): string {
  if (Array.isArray(v) && v.length && v.every((x) => estObjet(x) && 'value' in x)) return enTexte(v.map((x) => enTexte((x as Objet).value)).find(Boolean));
  return enTexte(v);
}

/** Caractères interdits en XML 1.0 : contrôles (sauf tabulation et retours à la ligne), U+FFFE, U+FFFF, demi-paires UTF-16 isolées. */
const XML_INTERDIT = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const echapperXml = (s: string) => s.replace(XML_INTERDIT, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/** Le webservice PrestaShop ne lit que du XML (il répond en JSON) ; noms de balises issus de la liste autorisée. */
function xmlPresta(ressource: string, champs: Objet): CorpsBrut {
  const contenu = Object.entries(champs).map(([k, v]) => `<${k}>${echapperXml(String(v))}</${k}>`).join('');
  return new CorpsBrut('application/xml', `<?xml version="1.0" encoding="UTF-8"?><prestashop xmlns:xlink="http://www.w3.org/1999/xlink"><${ressource}>${contenu}</${ressource}></prestashop>`);
}

export const prestashop: Adaptateur = {
  id: 'prestashop', nom: 'PrestaShop', categorie: 'E-commerce', couleur: '#df0067',
  description: 'Les clients de votre boutique PrestaShop dans les deux sens (PrestaShop 8 ou plus pour écrire) ; produits en lecture.',
  etapes: [
    'Back-office PrestaShop → Paramètres avancés → Webservice : activez le service web, puis « Ajouter une nouvelle clé de webservice ».',
    'Droits de la clé : customers en GET, PATCH et POST (GET seul pour ne faire que lire), products en GET ; enregistrez et copiez la clé.',
    'Indiquez l’adresse de la boutique en https:// (l’API répond sur /api : la réécriture d’URL du serveur doit être active).',
  ],
  champs: [
    { id: 'boutique', libelle: 'Adresse de la boutique', aide: 'HTTPS uniquement : l’adresse publique de la boutique.', exemple: 'https://boutique.exemple.fr', obligatoire: true },
    { id: 'objet', libelle: 'Fiches PrestaShop à lire', aide: 'Clients (dans les deux sens) ; produits en lecture seule.', choix: ['customers', 'products'], obligatoire: true },
    { id: 'jeton', libelle: 'Clé du webservice', aide: '32 caractères. Chiffrée sur le serveur.', exemple: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ123456', secret: true, obligatoire: true },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = objetPresta(cfg);
    const { base, entetes } = await accesPresta(cfg, secret);
    const res: Enregistrement[] = [];
    for (let debut = 0; debut < MAX && res.length < MAX; debut += PAGE_PRESTA) {
      const u = new URL(`${base}/${objet}`);
      u.searchParams.set('output_format', 'JSON');
      u.searchParams.set('display', AFFICHAGE_PRESTA[objet]);
      u.searchParams.set('sort', '[id_ASC]');
      u.searchParams.set('limit', `${debut},${PAGE_PRESTA}`);
      const { donnees } = await appelerOutil('PrestaShop', CONSEILS_PRESTA, f, u, { entetes });
      // Liste vide : PrestaShop renvoie [] au lieu de { customers: [] }.
      const brut = estObjet(donnees) ? donnees[objet] : undefined;
      const lignes = Array.isArray(brut) ? brut.filter(estObjet) : [];
      for (const r of lignes) {
        const id = enTexte(r.id);
        if (!id) continue;
        const champs = Object.fromEntries(Object.entries(r).filter(([k]) => !IGNORES_PRESTA.includes(k)).map(([k, v]) => [k, valeurPresta(v)]));
        res.push({ externeId: id, champs: objet === 'customers' ? { nom_complet: nomComplet(r.firstname, r.lastname), ...champs } : champs });
      }
      if (lignes.length < PAGE_PRESTA) break;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    if (objetPresta(cfg) !== 'customers') throw lectureSeule('PrestaShop', 'les produits sont');
    if (externeId) idNumerique(externeId, 'PrestaShop');
    const champs = corpsEcriture(decouperNom(valeurs, 'firstname', 'lastname'), ECRIT_PRESTA);
    if (externeId && !Object.keys(champs).length) return externeId;
    if (!externeId && (!champs.firstname || !champs.lastname || !champs.email)) throw new ErreurSortante('PrestaShop : prénom, nom et e-mail du client exigés pour le créer.');
    const { base, entetes } = await accesPresta(cfg, secret);
    const appel = (chemin: string, methode: 'PATCH' | 'POST', corps: Objet) => {
      const u = new URL(`${base}/${chemin}`);
      u.searchParams.set('output_format', 'JSON');
      return appelerOutil('PrestaShop', CONSEILS_PRESTA, f, u, { methode, entetes, corps: xmlPresta('customer', corps) });
    };
    if (externeId) {
      // PATCH (PrestaShop 8+) : seuls les champs envoyés changent.
      await appel(`customers/${externeId}`, 'PATCH', { id: externeId, ...champs });
      return externeId;
    }
    // Le mot de passe est exigé par PrestaShop : aléatoire, jamais gardé (le client le réinitialise s'il veut se connecter).
    const { donnees } = await appel('customers', 'POST', { ...champs, passwd: randomBytes(24).toString('base64url') });
    return idCree(estObjet(donnees) ? donnees.customer : undefined);
  },
};

// ---------------------------------------------------------------- Sellsy (API v2, OAuth2 « client credentials »)

const SELLSY = 'https://api.sellsy.com/v2';
const JETON_SELLSY = 'https://login.sellsy.com/oauth2/access-tokens';
const CONSEILS_SELLSY: Conseils = {
  400: 'fiche refusée par Sellsy (e-mail, site web ou SIRET au mauvais format ?).',
  401: 'accès refusé : identifiants révoqués ou jeton expiré (nouvel essai à la prochaine synchronisation).',
  402: 'quota ou limite de votre offre Sellsy atteint.',
  403: 'droits insuffisants : l’accès API doit avoir les sociétés (companies) en lecture et en écriture.',
  404: 'société introuvable (supprimée dans Sellsy ?).',
  429: 'quota de requêtes Sellsy atteint : nouvel essai à la prochaine synchronisation.',
};
const CONSEILS_JETON_SELLSY: Conseils = { ...CONSEILS_SELLSY, 400: 'identifiant ou secret client refusés (l’accès API doit être de type « Personnel »).', 401: 'identifiant ou secret client refusés.' };
const TYPES_SELLSY = { clients: 'client', prospects: 'prospect', fournisseurs: 'supplier' } as const;
const PAGE_SELLSY = 100;
const ECRIT_SELLSY: Record<string, TypeEcrit> = {
  name: 'texte', email: 'texte', website: 'texte', phone_number: 'texte', mobile_number: 'texte', fax_number: 'texte', reference: 'texte', note: 'texte', auxiliary_code: 'texte', capital: 'texte',
  ...Object.fromEntries(['siret', 'siren', 'vat', 'ape_naf_code', 'company_type', 'rcs_immatriculation'].map((k) => [`legal_france.${k}`, 'texte' as const])),
  ...Object.fromEntries(['twitter', 'facebook', 'linkedin', 'viadeo'].map((k) => [`social.${k}`, 'texte' as const])),
};
/** Jetons d'accès obtenus par « client credentials », gardés en mémoire seulement (jamais écrits ni affichés). */
const jetonsSellsy = new Map<string, { jeton: string; expire: number }>();

const objetSellsy = (cfg: Config) => exiger(cfg, 'objet', /^(clients|prospects|fournisseurs)$/, 'Objet Sellsy : clients, prospects ou fournisseurs.') as keyof typeof TYPES_SELLSY;

async function accesSellsy(cfg: Config, secret: string | null, f: Recuperateur): Promise<{ cle: string; acces: string }> {
  // « Se connecter avec Sellsy » : jeton d'accès OAuth de la personne connectée, utilisé tel quel (renouvelé par la synchro)
  if (parRelais(cfg, 'sellsy')) return { cle: '', acces: jeton(secret, 'Sellsy') };
  const clientId = exiger(cfg, 'clientId', /^[A-Za-z0-9_.-]{8,128}$/, 'Identifiant client Sellsy invalide (client id de l’accès API).');
  const s = jeton(secret, 'Sellsy');
  const cle = createHash('sha256').update(`${clientId}\n${s}`).digest('hex');
  const connu = jetonsSellsy.get(cle);
  if (connu && connu.expire > Date.now()) return { cle, acces: connu.jeton };
  const corps = new CorpsBrut('application/x-www-form-urlencoded', new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: s }).toString());
  const { donnees } = await appelerOutil('Sellsy', CONSEILS_JETON_SELLSY, f, new URL(JETON_SELLSY), { methode: 'POST', corps });
  const d = donnees as { access_token?: unknown; expires_in?: unknown } | null;
  if (typeof d?.access_token !== 'string' || !d.access_token) throw new ErreurSortante('Sellsy n’a pas délivré de jeton d’accès.');
  const duree = Number(d.expires_in) > 0 ? Number(d.expires_in) : 3600;
  jetonsSellsy.set(cle, { jeton: d.access_token, expire: Date.now() + Math.max(0, duree - 120) * 1000 });
  return { cle, acces: d.access_token };
}

/** Appel authentifié ; un jeton refusé (révoqué, expiré plus tôt que prévu) est oublié pour la prochaine fois. */
async function appelSellsy(cfg: Config, secret: string | null, f: Recuperateur, url: URL, init: InitAppel = {}) {
  const { cle, acces } = await accesSellsy(cfg, secret, f);
  try {
    return await appelerOutil('Sellsy', CONSEILS_SELLSY, f, url, { ...init, entetes: { authorization: `Bearer ${acces}` } });
  } catch (e) {
    if (e instanceof ErreurSortante && e.statut === 401) jetonsSellsy.delete(cle);
    throw e;
  }
}

function champsSellsy(r: Objet): Record<string, string> {
  const champs = aplatirNiveau(r, ['id', '_embed', 'marketing_campaigns_subscriptions']);
  const adresse = estObjet(r._embed) ? r._embed.invoicing_address : undefined;
  if (estObjet(adresse)) for (const [k, v] of Object.entries(adresse)) if (k !== 'id' && typeof v !== 'object') champs[`invoicing_address.${k}`] = enTexte(v);
  return champs;
}

export const sellsy: Adaptateur = {
  id: 'sellsy', nom: 'Sellsy', categorie: 'CRM', couleur: '#2b59ff',
  description: 'Clients, prospects ou fournisseurs de votre CRM Sellsy, dans les deux sens.',
  etapes: [
    // doc Sellsy (Authentication) : seul un client « Personal » permet la connexion par identifiant et secret ; un client
    // « Private » ou « Public » impose le parcours par code d'autorisation
    'Sellsy → Réglages → Portail développeur (API v2) → « Créer un accès API » de type « Personnel » (Personal). Les types « Privé » et « Public » ne conviennent pas ici.',
    'Droits : sociétés (companies) en lecture et en écriture ; copiez l’identifiant client (client id) et le secret client.',
    'Choisissez clients, prospects ou fournisseurs ; le jeton d’accès obtenu reste en mémoire, il n’est jamais enregistré.',
  ],
  champs: [
    { id: 'objet', libelle: 'Fiches Sellsy à lire', aide: 'Clients, prospects ou fournisseurs.', choix: ['clients', 'prospects', 'fournisseurs'], obligatoire: true },
    { id: 'clientId', libelle: 'Identifiant client (client id)', aide: 'Affiché avec l’accès API.', exemple: '0a1b2c3d-4e5f-…', obligatoire: true, mode: 'cle' },
    { id: 'jeton', libelle: 'Secret client', aide: 'Chiffré sur le serveur.', secret: true, obligatoire: true, mode: 'cle' },
  ],
  lecture: 'appel',
  ecriture: true,
  async lire(cfg, secret, f) {
    const objet = objetSellsy(cfg);
    const res: Enregistrement[] = [];
    let offset = '';
    // Pagination « seek » : l'offset renvoyé désigne le dernier objet de la page.
    for (let page = 0; page < MAX / PAGE_SELLSY && res.length < MAX; page++) {
      const u = new URL(`${SELLSY}/companies/search`);
      u.searchParams.set('limit', String(PAGE_SELLSY));
      if (offset) u.searchParams.set('offset', offset);
      u.searchParams.append('embed[]', 'invoicing_address');
      const { donnees } = await appelSellsy(cfg, secret, f, u, { methode: 'POST', corps: { filters: { type: TYPES_SELLSY[objet] } } });
      const d = donnees as { data?: unknown[]; pagination?: { offset?: unknown } } | null;
      const lignes = (d?.data ?? []).filter(estObjet);
      for (const r of lignes) {
        const id = enTexte(r.id);
        if (id) res.push({ externeId: id, champs: champsSellsy(r) });
      }
      const suivant = enTexte(d?.pagination?.offset);
      if (lignes.length < PAGE_SELLSY || !suivant || suivant === offset) break;
      offset = suivant;
    }
    return res.slice(0, MAX);
  },
  async ecrire(cfg, secret, externeId, valeurs, f) {
    const objet = objetSellsy(cfg);
    const corps = corpsEcriture(valeurs, ECRIT_SELLSY);
    if (externeId) {
      const id = idNumerique(externeId, 'Sellsy');
      if (!Object.keys(corps).length) return externeId;
      const u = new URL(`${SELLSY}/companies/${id}`);
      // Mentions légales ou réseaux partiels : complétés par la fiche actuelle, pour ne rien effacer dans Sellsy.
      if (estObjet(corps.legal_france) || estObjet(corps.social)) {
        const actuelle = (await appelSellsy(cfg, secret, f, u)).donnees as Objet | null;
        completer(corps, 'legal_france', actuelle?.legal_france);
        completer(corps, 'social', actuelle?.social);
      }
      await appelSellsy(cfg, secret, f, u, { methode: 'PUT', corps });
      return externeId;
    }
    if (!corps.name) throw new ErreurSortante('Sellsy : nom de la société manquant.');
    const { donnees } = await appelSellsy(cfg, secret, f, new URL(`${SELLSY}/companies`), { methode: 'POST', corps: { type: TYPES_SELLSY[objet], ...corps } });
    return idCree(donnees);
  },
};
