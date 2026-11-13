/* Living Business — « Connecter mes données » (direction de design §6.1 P4, §4.21, §4.23, §2.6).
   Module PUR (aucun accès au DOM, au réseau ni au stockage), testé par src/ds/connecter.test.ts. Il décide QUOI proposer :
   (1) une question d'entrée, « Où sont vos clients aujourd'hui ? », à 6 réponses ; (2) 3 recommandations tirées de la
   réponse ; (3) le catalogue complet, filtrable par famille et par recherche, où « 1 clic » est la seule pastille qui
   distingue un logiciel d'un autre ; (4) les étapes de chaque parcours (assistant du §4.21).
   Le catalogue réunit les outils synchronisés (GET /sources, « Se connecter avec… » quand le relais de Breizhcosystem l'ouvre)
   et les imports ponctuels (GET /connecteurs : fichier, copier-coller, saisie, FEC). Le serveur MCP, le webhook et
   l'API REST passent dans « Mode avancé : pour votre informaticien ». */

export const QUESTION = 'Où sont vos clients aujourd’hui ?';

/** Les 6 réponses de la question d'entrée, chacune avec son illustration (icône du sprite, 48 px). */
export const REPONSES = Object.freeze([
  { id: 'excel', titre: 'Dans un fichier Excel', detail: 'Sur l’ordinateur, OneDrive ou SharePoint.', icone: 'file-spreadsheet' },
  { id: 'google', titre: 'Dans Google Sheets', detail: 'Une feuille de votre compte Google.', icone: 'sheet' },
  { id: 'facturation', titre: 'Dans mon logiciel de facturation', detail: 'Pennylane, Axonaut, Sage, EBP…', icone: 'receipt' },
  { id: 'crm', titre: 'Dans un CRM', detail: 'HubSpot, Pipedrive, Dynamics 365…', icone: 'contact' },
  { id: 'papier', titre: 'Sur papier', detail: 'Un carnet, des fiches, ou de tête.', icone: 'notebook-pen' },
  { id: 'nulle-part', titre: 'Nulle part pour l’instant', detail: 'Vous démarrez ou n’avez pas encore de clients.', icone: 'circle-off' },
].map(Object.freeze));

/** Familles du catalogue (puces filtrables, §4.12), dans l'ordre d'affichage. « avance » n'est jamais une puce. */
export const FAMILLES = Object.freeze([
  { id: 'tableurs', libelle: 'Tableurs et fichiers', icone: 'file-spreadsheet' },
  { id: 'facturation', libelle: 'Facturation et comptabilité', icone: 'receipt' },
  { id: 'crm', libelle: 'CRM', icone: 'contact' },
  { id: 'banque', libelle: 'Banque et paiement', icone: 'landmark' },
  { id: 'boutique', libelle: 'Boutique en ligne', icone: 'shopping-bag' },
  { id: 'bases', libelle: 'Bases et notes', icone: 'database' },
  { id: 'gestion', libelle: 'Gestion', icone: 'building-2' },
].map(Object.freeze));
const ICONE_AVANCE = 'code-xml';

/** Catégorie annoncée par le serveur → famille du catalogue. Une catégorie inconnue tombe dans « Gestion ». */
const FAMILLE_DE_CATEGORIE = Object.freeze({
  Tableur: 'tableurs', Fichier: 'tableurs', Bureautique: 'tableurs',
  Comptabilité: 'facturation', CRM: 'crm', Gestion: 'gestion', ERP: 'gestion',
  Banque: 'banque', Paiement: 'banque', 'E-commerce': 'boutique', 'Base de données': 'bases',
  Automatisation: 'avance', Technique: 'avance', 'IA et connecteurs': 'avance',
});
/** Quelques logiciels se cherchent d'abord ailleurs que dans leur catégorie déclarée. */
const FAMILLE_FORCEE = Object.freeze({ axonaut: 'facturation', 'ebp-api': 'facturation' });

/** Pseudo-entrée : le parcours « Compléter mon entreprise » (lieux, équipe, clients et fournisseurs, pas à pas). */
export const PAS_A_PAS = Object.freeze({
  cle: 'action:pas-a-pas', genre: 'action', id: 'pas-a-pas', nom: 'Compléter mon entreprise pas à pas',
  description: 'Lieux, équipe, clients et fournisseurs : quelques questions, enregistrées aussitôt.', famille: 'tableurs', icone: 'list-checks',
  unClic: false, avance: false, bientot: false,
});

/** Pour chaque réponse, les candidats dans l'ordre de préférence ; les 3 premiers disponibles sont recommandés. */
export const CONSEILS = Object.freeze({
  // un fichier .xlsx n'est pas encore lu : le copier-coller d'abord (aucune conversion), puis le CSV
  excel: ['outil:excel365', 'import:coller', 'import:csv'],
  google: ['outil:sheets', 'import:sheets', 'import:csv'],
  facturation: ['outil:pennylane', 'outil:axonaut', 'outil:sellsy', 'import:fec'],
  crm: ['outil:hubspot', 'outil:pipedrive', 'outil:dynamics365', 'outil:sellsy'],
  papier: ['import:manuel', 'action:pas-a-pas', 'import:coller'],
  'nulle-part': ['action:pas-a-pas', 'import:manuel', 'import:fec'],
});

const sansAccent = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const familleDe = (id, categorie) => FAMILLE_FORCEE[id] ?? FAMILLE_DE_CATEGORIE[categorie] ?? 'gestion';
export const iconeFamille = (famille) => (famille === 'avance' ? ICONE_AVANCE : FAMILLES.find((f) => f.id === famille)?.icone ?? 'plug');
export const libelleFamille = (famille) => (famille === 'avance' ? 'Mode avancé' : FAMILLES.find((f) => f.id === famille)?.libelle ?? '');

/**
 * Catalogue unique : outils synchronisés d'abord (ceux en « 1 clic » en tête), puis imports ponctuels, puis le parcours
 * pas à pas. Chaque entrée : { cle, genre ('outil' | 'import' | 'action'), id, nom, description, famille, icone,
 * unClic, avance, bientot, ecriture }.
 */
export function catalogue(sources = [], connecteurs = [], { pasAPas = true } = {}) {
  const outils = (Array.isArray(sources) ? sources : []).map((s) => {
    const famille = s.avance ? 'avance' : familleDe(s.id, s.categorie);
    return {
      cle: `outil:${s.id}`, genre: 'outil', id: s.id, nom: s.nom, description: s.description ?? '', famille, icone: iconeFamille(famille),
      unClic: Boolean(s.oauth), avance: Boolean(s.avance) || famille === 'avance', bientot: false, ecriture: Boolean(s.ecriture),
    };
  });
  const imports = (Array.isArray(connecteurs) ? connecteurs : []).map((c) => {
    const famille = familleDe(c.id, c.categorie);
    return {
      cle: `import:${c.id}`, genre: 'import', id: c.id, nom: c.nom, description: c.description ?? '', famille,
      icone: c.id === 'manuel' ? 'square-pen' : c.id === 'coller' ? 'clipboard-paste' : c.id === 'fec' ? 'calculator' : iconeFamille(famille),
      unClic: false, avance: false, bientot: c.statut !== 'disponible', ecriture: Boolean(c.ecriture),
    };
  });
  const rang = (x) => (x.unClic ? 0 : 1);
  return [...outils.sort((a, b) => rang(a) - rang(b)), ...imports, ...(pasAPas ? [PAS_A_PAS] : [])];
}

/**
 * 3 recommandations pour une réponse : candidats disponibles (ni « bientôt », ni mode avancé), ceux en « 1 clic » d'abord,
 * puis les imports (aucune clé à demander), puis les outils qui demandent une clé ; l'ordre des conseils départage.
 */
export function recommandations(reponse, cat, n = 3) {
  const candidats = CONSEILS[reponse] ?? [];
  const parCle = new Map((cat ?? []).map((x) => [x.cle, x]));
  const rang = (x) => (x.unClic ? 0 : x.genre === 'outil' ? 2 : 1);
  return candidats.map((c, i) => ({ x: parCle.get(c), i }))
    .filter(({ x }) => x && !x.bientot && !x.avance)
    .sort((a, b) => rang(a.x) - rang(b.x) || a.i - b.i)
    .slice(0, n)
    .map(({ x }) => x);
}

/** Filtre du catalogue : famille (puce) et recherche tolérante aux accents, sur le nom, la description et la famille. */
export function filtrer(cat, { famille = null, recherche = '' } = {}) {
  const mots = sansAccent(recherche).split(/\s+/).filter(Boolean);
  const garde = (x) => (!famille || x.famille === famille || x.avance) && mots.every((m) => sansAccent(`${x.nom} ${x.description} ${libelleFamille(x.famille)}`).includes(m));
  const tous = (cat ?? []).filter(garde);
  return {
    simples: tous.filter((x) => !x.avance && !x.bientot && (!famille || x.famille === famille)),
    bientot: tous.filter((x) => x.bientot && (!famille || x.famille === famille)),
    avances: tous.filter((x) => x.avance),
    total: tous.filter((x) => !x.avance && (!famille || x.famille === famille)).length,
  };
}

/** Familles réellement présentes dans le catalogue (on ne propose pas une puce qui ne filtre rien). */
export const famillesPresentes = (cat) => FAMILLES.filter((f) => (cat ?? []).some((x) => x.famille === f.id && !x.avance));

/** Étapes de chaque parcours de l'assistant (§4.21) : [clé, libellé]. « choisir » est toujours la première. */
export const PARCOURS = Object.freeze({
  fichier: [['choisir', 'Choisir'], ['contenu', 'Contenu'], ['fichier', 'Fichier'], ['colonnes', 'Associer les colonnes'], ['pret', 'C’est prêt']],
  manuel: [['choisir', 'Choisir'], ['contenu', 'Que voulez-vous ajouter ?']],
  outil: [['choisir', 'Choisir'], ['connexion', 'Se connecter'], ['colonnes', 'Associer les colonnes'], ['pret', 'C’est prêt']],
  fec: [['choisir', 'Choisir'], ['fec', 'Déposer le fichier'], ['pret', 'Vos chiffres clés']],
  zero: [['choisir', 'Choisir'], ['zero', 'Créer mon entreprise']],
});

/** Parcours d'une entrée du catalogue. */
export function parcoursDe(x) {
  if (!x) return 'fichier';
  if (x.genre === 'outil') return 'outil';
  if (x.id === 'fec') return 'fec';
  if (x.id === 'manuel') return 'manuel';
  return 'fichier';
}

/** Où en est l'assistant : { index, total, libelle, texte: « Étape 2 sur 5 · Associer les colonnes » }. */
export function progression(parcours, etape) {
  const etapes = PARCOURS[parcours] ?? PARCOURS.fichier;
  const i = Math.max(0, etapes.findIndex(([k]) => k === etape));
  const libelle = etapes[i]?.[1] ?? '';
  return { index: i, total: etapes.length, libelle, texte: `Étape ${i + 1} sur ${etapes.length} · ${libelle}` };
}

/**
 * Faut-il demander « Abandonner ? » avant de fermer ? Oui dès qu'un réglage a vraiment été commencé (au-delà du choix :
 * `saisie`, quelque chose d'écrit, de lu ou d'obtenu), sauf une fois le parcours terminé ; toujours pendant une
 * connexion en cours chez l'outil (§4.14). Rien de saisi : on ferme sans demander (P4).
 */
export function abandonAConfirmer({ etape, connexionEnCours = false, saisie = true } = {}) {
  if (connexionEnCours) return true;
  return Boolean(etape) && !['choisir', 'pret'].includes(etape) && Boolean(saisie);
}
