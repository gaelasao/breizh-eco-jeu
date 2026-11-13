/* Living Business — catégories d'entités : une forme et une icône, jamais une couleur (direction de design §4.12).
   client = rond ; fournisseur = carré ; partenaire = losange ; équipe = hexagone ; prospect = rond en pointillés ;
   lieu = goutte ; autre = carré en pointillés. Module PUR : utilisé par la carte, la liste des lieux et les tests. */

export const FORMES = Object.freeze({
  client: 'rond', fournisseur: 'carre', partenaire: 'losange', equipe: 'hexagone', prospect: 'rond-pointille', lieu: 'goutte', autre: 'carre-pointille',
});
export const LIBELLES_CATEGORIE = Object.freeze({
  client: 'Client', fournisseur: 'Fournisseur', partenaire: 'Partenaire', equipe: 'Équipe', prospect: 'Prospect', lieu: 'Lieu', autre: 'Autre',
});

const ICONE_LIEU = Object.freeze({ siege: 'building-2', entrepot: 'warehouse', atelier: 'wrench', magasin: 'store', site: 'map-pin', chantier: 'wrench' });

/** Catégorie d'un objet du monde : { categorie, forme, icone }. */
export function categorieDe(o) {
  if (!o) return { categorie: 'autre', forme: FORMES.autre, icone: 'circle-help' };
  const icone = o.icone ?? o.type;
  const cat = (categorie, ic) => ({ categorie, forme: FORMES[categorie], icone: ic });
  if (o.id === '__pavillon') return cat('lieu', 'bz-phare-allume');
  if (o.famille === 'lieu' || o.famille === 'organisation') return cat('lieu', ICONE_LIEU[icone] ?? 'map-pin');
  if (o.famille === 'departement') return cat('equipe', 'users');
  if (o.famille === 'personne') return cat('equipe', 'user');
  if (o.famille === 'tiers') {
    const roles = (o.roles ?? []).map((r) => (typeof r === 'string' ? r : r.id));
    const ic = o.type === 'particulier' ? 'house' : o.type === 'organisme_public' ? 'landmark' : null;
    if (roles.includes('client')) return cat('client', ic ?? 'handshake');
    if (roles.includes('fournisseur')) return cat('fournisseur', ic ?? 'truck');
    if (roles.includes('partenaire') || roles.includes('sous_traitant')) return cat('partenaire', ic ?? 'link');
    if (roles.includes('prospect')) return cat('prospect', ic ?? 'user-plus');
    return cat('autre', ic ?? 'building-2');
  }
  if (o.famille === 'ressource') return cat('autre', icone === 'vehicule' ? 'truck' : icone === 'outil' || icone === 'engin' ? 'wrench' : 'package');
  if (o.famille === 'projet') return cat('autre', 'flag');
  if (o.type === 'courrier') return cat('autre', 'mail');
  if (o.famille === 'commande') return cat('autre', 'receipt');
  if (o.famille === 'tache') return cat('autre', 'list-checks');
  return cat('autre', 'circle-help');
}

/** Quartier d'un tiers sur la carte (§5.5) : ouest = clients, est = fournisseurs, nord = les deux et partenaires. */
export function quartierDe(o) {
  if (!o) return null;
  if (o.famille === 'lieu' || o.famille === 'organisation' || o.famille === 'departement' || o.famille === 'personne') return 'entreprise';
  if (o.famille === 'ressource') return 'entreprise';
  if (o.famille !== 'tiers') return null;
  const r = (o.roles ?? []).map((x) => (typeof x === 'string' ? x : x.id));
  if (r.includes('client') && r.includes('fournisseur')) return 'nord';
  if (r.includes('fournisseur')) return 'fournisseurs';
  if (r.includes('client')) return 'clients';
  if (r.includes('partenaire') || r.includes('sous_traitant')) return 'nord';
  if (r.includes('prospect')) return 'prospects';
  return 'autres';
}

/** État de « peinture » d'un objet (§4.29, §5.4) : 'exemple', 'peint', 'perime' (plus de 7 jours) ou 'platre' (aucune donnée réelle). */
export function peintureDe(o) {
  if (!o) return 'platre';
  if (o.mode === 'demo') return 'exemple';
  if (o.provenance === 'infere' || o.provenance === 'inconnu' || o.fraicheur === 'inconnue') return 'platre';
  if (o.fraicheur === 'perimee') return 'perime';
  return 'peint';
}
