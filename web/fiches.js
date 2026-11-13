/* Living Business — fiches et listes (direction de design §6.1 P7, §4.11, §4.12, §4.29, §4.30).
   Module PUR (aucun accès au DOM ni au stockage), testé par src/ds/fiches.test.ts. Il décide :
   - les colonnes de chaque liste, déclarées par type d'objet (et non plus les premiers champs non vides) ;
   - le tri (nombres, dates, textes à la française ; une valeur absente toujours en dernier) ;
   - l'en-tête d'une fiche : état et 2 actions principales, toujours au même endroit ;
   - les champs de la fiche, groupés (repliables) ;
   - les vues enregistrées d'une liste (recherche, tri, filtre) : une préférence de cet appareil, sans donnée. */
import { courrielDe, telephoneDe } from './bz/terrain.js';

/** Colonnes par type (§4.11) : 4 au plus, après le nom ; le type d'un objet personnalisé retombe sur ses premiers champs. */
export const COLONNES = Object.freeze({
  entreprise: ['ville', 'contact', 'encours', 'activite'],
  particulier: ['ville', 'contact', 'email'],
  organisme_public: ['ville', 'contact', 'email'],
  employe: ['poste', 'equipe', 'lieu', 'disponibilite'],
  siege: ['adresse', 'besoin_effectif'],
  site: ['adresse', 'departement', 'besoin_effectif'],
  entrepot: ['adresse', 'departement', 'besoin_effectif'],
  atelier: ['adresse', 'departement', 'besoin_effectif'],
  boutique: ['adresse', 'departement', 'besoin_effectif'],
  projet: ['client', 'echeance', 'avancement', 'retard_jours'],
  article: ['quantite', 'seuil_alerte', 'unite', 'fournisseur'],
  equipement: ['lieu', 'disponible'],
  vehicule: ['immatriculation', 'prochaine_revision', 'controle_technique', 'disponible'],
  devis: ['client', 'montant', 'statut'],
  commande_client: ['client', 'montant', 'livraison_prevue', 'statut'],
  commande_fournisseur: ['fournisseur', 'montant', 'livraison_prevue', 'statut'],
  facture: ['tiers', 'montant', 'echeance', 'retard_jours'],
  tache: ['echeance', 'responsable', 'statut'],
  courrier: ['expediteur', 'objet', 'recu_le', 'statut'],
  document: ['categorie', 'valide_jusqu_au', 'organisme'],
  avis_client: ['concerne', 'note', 'recu_le'],
  barometre: ['note', 'charge', 'recu_le'],
  indicateur: ['valeur', 'objectif', 'unite'],
  departement: ['responsable', 'mission'],
});
export const COLONNES_MAX = 4;

const NUMERIQUES = new Set(['nombre', 'montant']);
export const estNumerique = (c) => NUMERIQUES.has(c?.type);

/**
 * Colonnes d'une liste qui peut mêler plusieurs types (clients entreprises et particuliers, stock et véhicules) :
 * l'union des colonnes déclarées des types présents, dans l'ordre, gardées si au moins une ligne a la valeur.
 * Renvoie [{ id, libelle, type, unite }].
 */
export function colonnesDe(objets) {
  const vus = new Map();
  const declarees = [];
  for (const o of objets) {
    for (const c of o.champs ?? []) if (!vus.has(c.id)) vus.set(c.id, c);
    for (const id of COLONNES[o.type] ?? []) if (!declarees.includes(id)) declarees.push(id);
  }
  const renseigne = (id) => objets.some((o) => { const c = o.champs?.find((x) => x.id === id); return c && c.valeur !== null && c.valeur !== undefined && c.valeur !== ''; });
  let ids = declarees.filter(renseigne);
  if (!ids.length) ids = [...vus.keys()].filter(renseigne);
  return ids.slice(0, COLONNES_MAX).map((id) => { const c = vus.get(id); return { id, libelle: c?.libelle ?? id, type: c?.type ?? 'texte', unite: c?.unite ?? null }; });
}

/** Valeur de tri d'un champ : nombre, date (AAAA-MM-JJ), texte en minuscules sans accents ; null si absente. */
export function valeurTri(c) {
  if (!c || c.valeur === null || c.valeur === undefined || c.valeur === '') return null;
  if (c.lien) return normaliser(c.lien.nom);
  if (c.type === 'booleen') return c.valeur ? 1 : 0;
  if (typeof c.valeur === 'number') return c.valeur;
  return normaliser(String(c.valeur));
}
const normaliser = (t) => String(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Trie une liste. tri : { colonne: 'nom' | 'etat' | id de champ, sens: 'asc' | 'desc' }. Les valeurs absentes restent
 * en dernier dans les deux sens (« inconnu » n'est jamais le plus petit). etatDe(o) : rang de l'état (0 = critique).
 */
export function trier(objets, tri, { etatDe = () => 9 } = {}) {
  const { colonne = 'nom', sens = 'asc' } = tri ?? {};
  const signe = sens === 'desc' ? -1 : 1;
  const cle = (o) => (colonne === 'nom' ? normaliser(o.nom) : colonne === 'etat' ? etatDe(o) : valeurTri(o.champs?.find((c) => c.id === colonne)));
  const coll = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
  return [...objets].map((o, i) => ({ o, i, k: cle(o) })).sort((a, b) => {
    if (a.k === null && b.k === null) return a.i - b.i;
    if (a.k === null) return 1;
    if (b.k === null) return -1;
    const d = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : coll.compare(String(a.k), String(b.k));
    return d * signe || a.i - b.i;
  }).map((x) => x.o);
}

/** Tri suivant au clic sur un en-tête : croissant, puis décroissant, puis retour au tri par nom. */
export function triSuivant(tri, colonne) {
  if (tri?.colonne !== colonne) return { colonne, sens: 'asc' };
  if (tri.sens === 'asc') return { colonne, sens: 'desc' };
  return { colonne: 'nom', sens: 'asc' };
}
export const ariaSort = (tri, colonne) => (tri?.colonne === colonne ? (tri.sens === 'desc' ? 'descending' : 'ascending') : 'none');

/** Groupes de champs d'une fiche (repliables, §6.1 P7), dans l'ordre de lecture ; groupes vides omis. */
const GROUPES = [
  { id: 'coordonnees', titre: 'Coordonnées', champs: ['contact', 'email', 'adresse', 'ville', 'num_departement', 'siret', 'activite', 'secteur', 'immatriculation', 'expediteur', 'organisme', 'emplacement'] },
  { id: 'suivi', titre: 'Suivi', champs: ['statut', 'payee', 'disponible', 'disponibilite', 'urgence', 'bac', 'categorie', 'avancement', 'retard_jours', 'genre', 'etat_pneus', 'pneus_saison', 'action', 'note', 'recommande', 'charge'] },
  { id: 'dates', titre: 'Dates', champs: ['echeance', 'livraison_prevue', 'valide_jusqu_au', 'prochaine_revision', 'controle_technique', 'pneus_le', 'assurance_le', 'carte_grise_le', 'autre_libelle', 'autre_le', 'kilometrage_le', 'fait_le', 'recu_le', 'comptabilite_au'] },
  { id: 'chiffres', titre: 'Chiffres', champs: ['montant', 'cout', 'encours', 'limite_encours', 'quantite', 'seuil_alerte', 'unite', 'besoin_effectif', 'effectif', 'valeur', 'objectif', 'kilometrage', 'revision_km', 'pneus_km', 'autre_km', 'ct_tous_les_mois', 'revision_tous_les_mois', 'revision_tous_les_km', 'pneus_tous_les_mois', 'pneus_tous_les_km', 'assurance_tous_les_mois', 'carte_grise_tous_les_mois', 'autre_tous_les_mois', 'autre_tous_les_km', 'prevenir_jours', 'tresorerie', 'charges_mensuelles', 'chiffre_affaires_annuel', 'marge_brute', 'resultat_net', 'creances_clients', 'dettes_fournisseurs', 'dettes_financieres', 'capitaux_propres'] },
  { id: 'liens', titre: 'Liens', champs: [] }, // références vers d'autres fiches
  { id: 'autres', titre: 'Autres informations', champs: [] },
];
export function groupesFiche(objet) {
  const champs = objet?.champs ?? [];
  const places = new Set();
  const sortie = GROUPES.map((g) => ({ id: g.id, titre: g.titre, champs: [] }));
  const groupe = (id) => sortie.find((g) => g.id === id);
  for (const g of GROUPES) {
    for (const id of g.champs) {
      const c = champs.find((x) => x.id === id);
      if (c && !places.has(c.id)) { places.add(c.id); groupe(g.id).champs.push(c); }
    }
  }
  for (const c of champs) {
    if (places.has(c.id)) continue;
    places.add(c.id);
    groupe(c.type === 'reference' ? 'liens' : 'autres').champs.push(c);
  }
  return sortie.filter((g) => g.champs.length);
}

const valeur = (o, id) => o?.champs?.find((c) => c.id === id)?.valeur ?? null;

/** Coordonnées de terrain d'un objet : numéro (lien tel:), e-mail (mailto:), adresse (« Y aller »). */
export function coordonnees(objet) {
  const textes = ['contact', 'telephone', 'email'].map((id) => valeur(objet, id)).filter((v) => typeof v === 'string');
  const tel = textes.map(telephoneDe).find(Boolean) ?? null;
  const courriel = textes.map(courrielDe).find(Boolean) ?? null;
  const adresse = [valeur(objet, 'adresse'), valeur(objet, 'ville')].filter((v) => typeof v === 'string' && v.trim()).join(', ') || null;
  return { tel, courriel, adresse };
}

/**
 * Les 2 actions principales de l'en-tête de fiche, toujours au même endroit (§6.1 P7) :
 * un tiers : Appeler et Écrire (ou Y aller) ; un lieu : Y aller et Entrer ; un article : le mouvement de stock ;
 * sinon les premières actions permises. Chaque entrée : { id, libelle, icone, genre: 'tel'|'mail'|'itineraire'|'action'|'modifier'|'entrer', capacite? }.
 * ctx : { actionsPossibles, peutEntrer }.
 */
export function actionsEntete(objet, { actionsPossibles = [], peutEntrer = false } = {}) {
  const { tel, courriel, adresse } = coordonnees(objet);
  const choix = [];
  if (tel) choix.push({ id: 'appeler', libelle: 'Appeler', icone: 'phone', genre: 'tel' });
  if (courriel) choix.push({ id: 'ecrire', libelle: 'Écrire', icone: 'mail', genre: 'mail' });
  if (adresse && objet?.famille !== 'tiers') choix.push({ id: 'y-aller', libelle: 'Y aller', icone: 'navigation', genre: 'itineraire' });
  if (peutEntrer) choix.push({ id: 'entrer', libelle: 'Entrer dans le bâtiment', icone: 'log-in', genre: 'entrer' });
  for (const a of actionsPossibles) {
    if (a.capacite === 'objet.modifier') continue; // l'édition se fait en place, champ par champ
    const libelle = a.capacite === 'mouvement' ? String(a.libelle).replace(/^Enregistrer un mouvement — /, 'Mouvement : ') : a.capacite === 'tache.creer' ? 'Créer une tâche' : a.libelle;
    choix.push({ id: `action-${a.capacite}-${a.champ ?? ''}`, libelle, icone: a.capacite === 'mouvement' ? 'arrow-up-down' : a.capacite === 'tache.creer' ? 'list-checks' : 'square-pen', genre: 'action', capacite: a.capacite, action: a });
  }
  if (adresse && objet?.famille === 'tiers') choix.push({ id: 'y-aller', libelle: 'Y aller', icone: 'navigation', genre: 'itineraire' });
  return choix.slice(0, 2);
}

/** Valeur d'un champ en texte d'édition (champ d'un formulaire) ; une date garde AAAA-MM-JJ. */
export function valeurEdition(c) {
  if (!c || c.valeur === null || c.valeur === undefined) return '';
  if (c.lien) return c.lien.id;
  if (c.type === 'date') return String(c.valeur).slice(0, 10);
  if (c.type === 'booleen') return c.valeur ? 'oui' : 'non';
  return String(c.valeur);
}

/**
 * Lit la saisie d'un champ édité en place. Renvoie { ok: true, valeur } (null = effacer) ou { ok: false, erreur }.
 * La virgule décimale est acceptée (« 12,5 ») ; un montant peut porter des espaces (« 1 240 »).
 */
export function lireSaisie(c, brut) {
  const t = String(brut ?? '').trim();
  if (t === '') return { ok: true, valeur: null };
  if (c.type === 'nombre' || c.type === 'montant') {
    const n = Number(t.replace(/[\s  €%]/g, '').replace(',', '.'));
    return Number.isFinite(n) ? { ok: true, valeur: n } : { ok: false, erreur: 'Indiquez un nombre, par exemple 12,5.' };
  }
  if (c.type === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T00:00:00Z`)) ? { ok: true, valeur: t } : { ok: false, erreur: 'Indiquez une date valide.' };
  if (c.type === 'booleen') return { ok: true, valeur: t === 'oui' || t === 'true' };
  if (c.type === 'choix' && Array.isArray(c.choix) && c.choix.length && !c.choix.includes(t)) return { ok: false, erreur: 'Choisissez une des valeurs proposées.' };
  if (t.length > 2000) return { ok: false, erreur: '2 000 caractères au plus.' };
  return { ok: true, valeur: t };
}

/** Une modification change-t-elle vraiment la valeur ? */
export function change(c, nouvelle) {
  const avant = c?.lien ? c.lien.id : c?.valeur ?? null;
  return String(avant ?? '') !== String(nouvelle ?? '');
}

/* ---------------------------------------------------------------- vues enregistrées (préférence de l'appareil) */
const NOM_VUE = /^[^<>]{1,40}$/;
/** Relit les vues enregistrées d'une liste depuis le texte stocké ; ignore tout ce qui n'a pas la bonne forme. */
export function lireVues(texte) {
  let brut;
  try { brut = JSON.parse(texte ?? '[]'); } catch { return []; }
  if (!Array.isArray(brut)) return [];
  return brut.filter((v) => v && typeof v.nom === 'string' && NOM_VUE.test(v.nom)).slice(0, 12).map((v) => ({
    nom: v.nom.trim(),
    recherche: typeof v.recherche === 'string' ? v.recherche.slice(0, 120) : '',
    tri: v.tri && typeof v.tri.colonne === 'string' && /^[\w-]{1,60}$/.test(v.tri.colonne) ? { colonne: v.tri.colonne, sens: v.tri.sens === 'desc' ? 'desc' : 'asc' } : { colonne: 'nom', sens: 'asc' },
    filtre: typeof v.filtre === 'string' && /^[\w:-]{1,80}$/.test(v.filtre) ? v.filtre : 'tous',
  }));
}
/** Ajoute (ou remplace, même nom) une vue ; 12 au plus. */
export function enregistrerVue(vues, vue) {
  const propre = lireVues(JSON.stringify([vue]))[0];
  if (!propre) return vues;
  return [...vues.filter((v) => v.nom.toLowerCase() !== propre.nom.toLowerCase()), propre].slice(-12);
}
export const memeVue = (v, etat) => v.recherche === (etat.recherche ?? '') && v.tri.colonne === (etat.tri?.colonne ?? 'nom') && v.tri.sens === (etat.tri?.sens ?? 'asc') && v.filtre === (etat.filtre ?? 'tous');
