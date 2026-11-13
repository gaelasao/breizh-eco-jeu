/* Living Business — « Connecter mes données » (direction de design §6.1 P4, §4.21, §4.23, §2.6).
   Module PUR (aucun accès au DOM, au réseau ni au stockage), testé par src/ds/connecter.test.ts. Il décide QUOI proposer.

   Trois règles tiennent tout l'écran :
   (1) on branche un COMPTE, pas une API : un compte Google (ses feuilles de calcul aujourd'hui), un compte Microsoft
       (classeur Excel, Dynamics 365, Business Central). Ce que le compte contient se choisit APRÈS la connexion ;
   (2) trois sections seulement — « En un clic » (ce que le relais ouvre vraiment), « Avec une clé », « Par webhook ou
       API » — plus les imports de fichier, qui ne demandent aucune connexion ;
   (3) ce qui ne marche pas n'est pas proposé : un outil ouvert nulle part n'apparaît pas du tout, et rien dans
       « En un clic » ne mène à un refus.
   Le catalogue réunit les outils synchronisés (GET /sources) et les imports ponctuels (GET /connecteurs : fichier,
   copier-coller, saisie, FEC). Le serveur MCP, le webhook et l'API REST forment la section « Par webhook ou API ». */

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

/**
 * Les trois sections de l'écran, dans l'ordre. « fichier » n'est pas une façon de brancher un compte : c'est ce qu'on
 * fait quand il n'y a rien à brancher, et elle ferme la page.
 */
export const SECTIONS = Object.freeze([
  { id: 'un-clic', titre: 'En un clic', texte: 'Vous vous connectez avec votre compte, sans rien copier. Tout ce qui est ici fonctionne aujourd’hui.' },
  { id: 'cle', titre: 'Avec une clé', texte: 'Une clé (ou un jeton) à créer dans le logiciel, puis à coller ici. Votre informaticien peut s’en charger.' },
  { id: 'avance', titre: 'Par webhook ou API', texte: 'Pour un logiciel absent de la liste : webhook Make, Zapier ou n8n, API REST, serveur MCP.' },
  { id: 'fichier', titre: 'Sans rien connecter', texte: 'Un fichier, un copier-coller, ou quelques questions : rien à brancher, rien à autoriser.' },
].map(Object.freeze));

/**
 * Un compte, pas un connecteur. Google et Microsoft ouvrent chacun plusieurs outils : une seule entrée dans le
 * catalogue, une seule connexion, et le contenu se choisit après. `source: null` : prévu, pas encore fait — montré
 * comme tel sur l'écran « Que voulez-vous récupérer ? », jamais proposé au clic.
 */
export const COMPTES = Object.freeze([
  {
    id: 'google', nom: 'Google', icone: 'sheet', famille: 'tableurs',
    description: 'Une seule connexion pour votre compte Google : vos feuilles de calcul, votre agenda, votre courrier.',
    contenus: [
      { id: 'sheets', libelle: 'Feuilles de calcul', detail: 'Clients, commandes, stock… dans les deux sens.', source: 'sheets' },
      { id: 'agenda', libelle: 'Agenda', detail: 'Vos rendez-vous dans le planning, et ceux d’ici dans votre agenda.', source: 'agendagoogle' },
      { id: 'messagerie', libelle: 'Courrier Gmail', detail: 'Vos messages récents dans l’écran Courrier, triés dans vos bacs.', source: 'gmail' },
    ],
  },
  {
    id: 'microsoft', nom: 'Microsoft', icone: 'file-spreadsheet', famille: 'tableurs',
    description: 'Une seule entrée pour votre compte Microsoft 365 : Excel, agenda, courrier Outlook, Dynamics 365, Business Central.',
    professionnel: true,
    contenus: [
      { id: 'excel365', libelle: 'Un classeur Excel', detail: 'Sur OneDrive professionnel ou SharePoint.', source: 'excel365' },
      { id: 'agenda', libelle: 'Agenda', detail: 'Vos rendez-vous dans le planning, et ceux d’ici dans votre agenda.', source: 'agendamicrosoft' },
      { id: 'messagerie', libelle: 'Courrier Outlook', detail: 'Vos messages récents dans l’écran Courrier, triés dans vos bacs.', source: 'outlook' },
      { id: 'dynamics365', libelle: 'Dynamics 365', detail: 'Les comptes et les contacts de votre CRM.', source: 'dynamics365' },
      { id: 'businesscentral', libelle: 'Business Central', detail: 'Clients, fournisseurs et articles.', source: 'businesscentral' },
    ],
  },
].map(Object.freeze));

/** Compte auquel appartient un outil (sheets → Google, excel365 → Microsoft…) ; null s'il est seul de son espèce. */
export const compteDe = (sourceId) => COMPTES.find((c) => c.contenus.some((x) => x.source === sourceId)) ?? null;

/**
 * Outils dont ce qui entre dans le jeu est connu d'avance : un agenda contient des rendez-vous, une boîte contient du
 * courrier. Il n'y a donc rien à demander (« à quoi ça correspond ? ») et aucune colonne à associer : les noms des
 * champs sont déjà ceux du jeu. C'est ce qui tient la promesse « pas plus de trois clics après la connexion ».
 */
export const CIBLE_FIXE = Object.freeze({
  agendagoogle: 'rendez_vous', agendamicrosoft: 'rendez_vous', gmail: 'courrier', outlook: 'courrier',
});
export const cibleFixe = (sourceId) => CIBLE_FIXE[sourceId] ?? null;

/** Outils où « dans les deux sens » se choisit AVANT la connexion : la portée demandée en dépend. */
export const SENS_AVANT_CONNEXION = Object.freeze({
  agendagoogle: { lecture: 'Lire mes rendez-vous', deux: 'Lire mes rendez-vous, et ajouter dans l’agenda ceux que je crée ici' },
  agendamicrosoft: { lecture: 'Lire mes rendez-vous', deux: 'Lire mes rendez-vous, et ajouter dans l’agenda ceux que je crée ici' },
  gmail: { lecture: 'Lire l’expéditeur, l’objet et la date', deux: 'Lire, et marquer comme lu ou archiver quand je traite un courrier ici' },
  outlook: { lecture: 'Lire l’expéditeur, l’objet et la date', deux: 'Lire, et marquer comme lu ou archiver quand je traite un courrier ici' },
});
export const sensAvantConnexion = (sourceId) => SENS_AVANT_CONNEXION[sourceId] ?? null;

/** Pseudo-entrée : le parcours « Compléter mon entreprise » (lieux, équipe, clients et fournisseurs, pas à pas). */
export const PAS_A_PAS = Object.freeze({
  cle: 'action:pas-a-pas', genre: 'action', id: 'pas-a-pas', nom: 'Compléter mon entreprise pas à pas',
  description: 'Lieux, équipe, clients et fournisseurs : quelques questions, enregistrées aussitôt.', famille: 'tableurs', icone: 'list-checks',
  unClic: false, avance: false, bientot: false, section: 'fichier',
});

/** Pour chaque réponse, les candidats dans l'ordre de préférence ; les 3 premiers disponibles sont recommandés. */
export const CONSEILS = Object.freeze({
  // un fichier .xlsx n'est pas encore lu : le copier-coller d'abord (aucune conversion), puis le CSV
  excel: ['compte:microsoft', 'import:coller', 'import:csv'],
  google: ['compte:google', 'import:coller', 'import:csv'],
  facturation: ['outil:pennylane', 'outil:axonaut', 'outil:sellsy', 'import:fec'],
  crm: ['outil:hubspot', 'outil:pipedrive', 'compte:microsoft', 'outil:sellsy'],
  papier: ['import:manuel', 'action:pas-a-pas', 'import:coller'],
  'nulle-part': ['action:pas-a-pas', 'import:manuel', 'import:fec'],
});

const sansAccent = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const familleDe = (id, categorie) => FAMILLE_FORCEE[id] ?? FAMILLE_DE_CATEGORIE[categorie] ?? 'gestion';
export const iconeFamille = (famille) => (famille === 'avance' ? ICONE_AVANCE : FAMILLES.find((f) => f.id === famille)?.icone ?? 'plug');
export const libelleFamille = (famille) => (famille === 'avance' ? 'Mode avancé' : FAMILLES.find((f) => f.id === famille)?.libelle ?? '');
export const libelleSection = (id) => SECTIONS.find((s) => s.id === id)?.titre ?? '';

/** Un outil se branche-t-il avec une clé collée (jeton, secret, script) sans passer par le relais ? */
const aUneCle = (s) => (s.champs ?? []).some((ch) => ch.secret && ch.mode !== 'oauth');

/**
 * Catalogue unique, regroupé par COMPTE et rangé en sections. Chaque entrée :
 * { cle, genre ('compte' | 'outil' | 'import' | 'action'), id, nom, description, famille, icone, section,
 *   unClic, avance, bientot, ecriture, contenus? }.
 * Un outil qu'aucune voie n'ouvre (ni un clic, ni une clé, ni webhook) n'est pas proposé du tout, et un import annoncé
 * « bientôt » non plus : la liste ne contient que ce qui marche aujourd'hui.
 */
export function catalogue(sources = [], connecteurs = [], { pasAPas = true } = {}) {
  const liste = Array.isArray(sources) ? sources : [];
  const parId = new Map(liste.map((s) => [s.id, s]));
  const groupes = [];
  const regroupes = new Set();
  for (const c of COMPTES) {
    // règle (3) jusque dans un compte : un contenu dont AUCUNE voie n'est ouverte (ni un clic, ni une clé) n'est pas
    // « disponible ». C'est ce qui arrive quand le relais n'ouvre pas encore cet outil — Gmail, par exemple, tant que
    // l'éditeur n'a pas fait vérifier sa portée chez Google : l'entrée disparaît au lieu de mener à un refus.
    const contenus = c.contenus.map((x) => {
      const s = x.source ? parId.get(x.source) : null;
      const unClic = Boolean(s?.oauth);
      const cle = Boolean(s && aUneCle(s));
      return { ...x, source: s ? x.source : null, disponible: Boolean(s) && (unClic || cle), unClic, cle, ecriture: Boolean(s?.ecriture) };
    });
    const vivants = contenus.filter((x) => x.disponible);
    if (!vivants.length) continue;
    for (const x of vivants) regroupes.add(x.source);
    const unClic = vivants.some((x) => x.unClic);
    if (!unClic && !vivants.some((x) => x.cle)) continue;
    groupes.push({
      cle: `compte:${c.id}`, genre: 'compte', id: c.id, nom: c.nom, description: c.description, famille: c.famille, icone: c.icone,
      unClic, avance: false, bientot: false, ecriture: vivants.some((x) => x.ecriture), professionnel: Boolean(c.professionnel),
      section: unClic ? 'un-clic' : 'cle', contenus,
    });
  }
  const outils = [];
  for (const s of liste) {
    if (regroupes.has(s.id)) continue;
    const famille = s.avance ? 'avance' : familleDe(s.id, s.categorie);
    const avance = Boolean(s.avance) || famille === 'avance';
    const unClic = Boolean(s.oauth);
    // ni un clic, ni une clé, ni mode avancé : rien ne marcherait, on ne le montre pas
    if (!avance && !unClic && !aUneCle(s)) continue;
    outils.push({
      cle: `outil:${s.id}`, genre: 'outil', id: s.id, nom: s.nom, description: s.description ?? '', famille, icone: iconeFamille(famille),
      unClic, avance, bientot: false, ecriture: Boolean(s.ecriture), section: avance ? 'avance' : unClic ? 'un-clic' : 'cle',
    });
  }
  const imports = (Array.isArray(connecteurs) ? connecteurs : [])
    // « Google Sheets (lien publié) » ferait doublon avec le compte Google : il reste proposé dans l'import de fichier
    .filter((c) => c.statut === 'disponible' && c.id !== 'sheets')
    .map((c) => {
      const famille = familleDe(c.id, c.categorie);
      return {
        cle: `import:${c.id}`, genre: 'import', id: c.id, nom: c.nom, description: c.description ?? '', famille,
        icone: c.id === 'manuel' ? 'square-pen' : c.id === 'coller' ? 'clipboard-paste' : c.id === 'fec' ? 'calculator' : iconeFamille(famille),
        unClic: false, avance: false, bientot: false, ecriture: Boolean(c.ecriture), section: 'fichier',
      };
    });
  const rang = (x) => (x.genre === 'compte' ? 0 : x.unClic ? 1 : 2);
  return [...groupes, ...outils].sort((a, b) => rang(a) - rang(b)).concat(imports, pasAPas ? [PAS_A_PAS] : []);
}

/**
 * 3 recommandations pour une réponse : candidats disponibles, les comptes et les connexions en « 1 clic » d'abord,
 * puis les imports (aucune clé à demander), puis les outils qui demandent une clé ; l'ordre des conseils départage.
 */
export function recommandations(reponse, cat, n = 3) {
  const candidats = CONSEILS[reponse] ?? [];
  const parCle = new Map((cat ?? []).map((x) => [x.cle, x]));
  const rang = (x) => (x.unClic ? 0 : x.genre === 'outil' || x.genre === 'compte' ? 2 : 1);
  return candidats.map((c, i) => ({ x: parCle.get(c), i }))
    .filter(({ x }) => x && !x.bientot && !x.avance)
    .sort((a, b) => rang(a.x) - rang(b.x) || a.i - b.i)
    .slice(0, n)
    .map(({ x }) => x);
}

/**
 * Filtre du catalogue : famille (puce) et recherche tolérante aux accents, sur le nom, la description, la famille et
 * le contenu d'un compte (« Excel », « Dynamics »). Le résultat est rangé par section.
 */
export function filtrer(cat, { famille = null, recherche = '' } = {}) {
  const mots = sansAccent(recherche).split(/\s+/).filter(Boolean);
  const texteDe = (x) => `${x.nom} ${x.description} ${libelleFamille(x.famille)} ${(x.contenus ?? []).map((c) => `${c.libelle} ${c.detail}`).join(' ')}`;
  const garde = (x) => (!famille || x.famille === famille || x.avance) && mots.every((m) => sansAccent(texteDe(x)).includes(m));
  const tous = (cat ?? []).filter(garde);
  const dans = (id) => tous.filter((x) => x.section === id && (id === 'avance' || !famille || x.famille === famille));
  return {
    'un-clic': dans('un-clic'), cle: dans('cle'), avance: dans('avance'), fichier: dans('fichier'),
    total: tous.filter((x) => !x.avance && (!famille || x.famille === famille)).length,
  };
}

/** Familles réellement présentes dans le catalogue (on ne propose pas une puce qui ne filtre rien). */
export const famillesPresentes = (cat) => FAMILLES.filter((f) => (cat ?? []).some((x) => x.famille === f.id && !x.avance));

/** Étapes de chaque parcours de l'assistant (§4.21) : [clé, libellé]. « choisir » est toujours la première. */
export const PARCOURS = Object.freeze({
  fichier: [['choisir', 'Choisir'], ['contenu', 'Contenu'], ['fichier', 'Fichier'], ['colonnes', 'Associer les colonnes'], ['pret', 'C’est prêt']],
  manuel: [['choisir', 'Choisir'], ['contenu', 'Que voulez-vous ajouter ?']],
  // connecter n'est PAS importer : la connexion ne fait rien entrer ; « Que récupérer ? » vient après, puis l'import
  outil: [['choisir', 'Choisir'], ['connexion', 'Se connecter'], ['recuperer', 'Que récupérer ?'], ['colonnes', 'Associer les colonnes'], ['pret', 'C’est prêt']],
  // agenda, boîte de réception : rien à associer (les champs portent déjà les noms du jeu), donc une étape de moins
  outilDirect: [['choisir', 'Choisir'], ['connexion', 'Se connecter'], ['recuperer', 'Que récupérer ?'], ['pret', 'C’est prêt']],
  fec: [['choisir', 'Choisir'], ['fec', 'Déposer le fichier'], ['pret', 'Vos chiffres clés']],
  zero: [['choisir', 'Choisir'], ['zero', 'Créer mon entreprise']],
});

/** Parcours d'une entrée du catalogue. */
export function parcoursDe(x) {
  if (!x) return 'fichier';
  if (x.genre === 'outil' || x.genre === 'compte') return 'outil';
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
 * Ce qu'un tableau trouvé dans l'outil contient, d'après son nom : « Clients 2026 » → la cible « Clients ».
 * Simple proposition, toujours corrigeable à l'écran ; null quand rien ne ressort (la personne choisit).
 */
export function cibleProbable(nom, cibles) {
  const t = sansAccent(nom);
  if (!t) return null;
  let meilleure = null;
  for (const c of cibles ?? []) {
    const mot = sansAccent(c.libelle);
    if (!mot) continue;
    // « Clients » reconnaît « client », « Commandes » reconnaît « commande »
    const racine = mot.replace(/s$/, '');
    if (racine.length >= 4 && t.includes(racine) && (!meilleure || racine.length > sansAccent(meilleure.libelle).length)) meilleure = c;
  }
  return meilleure;
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
