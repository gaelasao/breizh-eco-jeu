/**
 * Ce qui est compris dans Living Business, et ce qui demande l'offre Breizhcosystem ACTIVE, sur l'écran « Optimiser ».
 *
 * LE PARTAGE, ET SA RAISON. Une automatisation qui ne fait que SIGNALER reste comprise : elle regarde les données de
 * l'entreprise et prévient une personne, rien ne sort, rien ne s'engage, cela ne coûte rien à personne. Celle qui
 * PRODUIT et ENVOIE — un e-mail, une facture, une commande, une enquête — demande l'offre. C'est là qu'est la valeur,
 * parce que le travail est fait et plus seulement annoncé ; c'est là qu'est le risque, parce qu'un envoi engage
 * l'entreprise auprès d'un client ou d'un fournisseur et ne se rattrape pas ; et c'est là que cela coûte quelque chose
 * à l'éditeur, puisque les envois partent par son service.
 *
 * CE VERROU EST UNE CONVENTION, PAS UNE SERRURE. Living Business est un logiciel libre et son code est public : qui
 * veut retirer ce verrou le retire en une ligne, ici, et c'est son droit — la licence le permet. Il est écrit quand
 * même, pour deux raisons. La grande majorité des entreprises n'ouvrent pas le code de leur logiciel, et un produit
 * doit dire ce qu'il vend plutôt que de cacher ses fonctions : une automatisation réservée reste donc VISIBLE, avec
 * son gain calculé sur les chiffres de l'entreprise. Le seul gage réel tient ailleurs : ce qui passe par les serveurs
 * de l'éditeur — l'envoi des e-mails, le réseau — est servi ou non selon les droits que ces serveurs confirment.
 * Que personne ne prenne ce fichier pour une sécurité : il n'en est pas une, et il n'a jamais prétendu l'être.
 *
 * L'état de l'offre est LU, jamais décidé ici : il vient des droits qu'un serveur Breizhcosystem a confirmés, et
 * seulement d'eux. Rien n'est appelé sur le réseau depuis ce module : on lit les derniers droits connus. Trois
 * conséquences voulues. Une entreprise non reliée garde tout ce qui est compris et voit le reste présenté.
 * L'affichage ne dépend jamais d'un appel qui pourrait être lent ou échouer. Et un réseau momentanément injoignable
 * ne coupe pas ce qu'une entreprise a payé : on garde ce qui a été confirmé la dernière fois.
 */

/** L'offre qui ouvre le reste, telle qu'elle s'écrit à l'écran. */
export const OFFRE = 'Breizhcosystem ACTIVE';

export type EtatOffre =
  /** Aucun réseau Breizhcosystem relié : l'entreprise travaille seule, et c'est un usage entier. */
  | 'non_reliee'
  /** Reliée, sans l'offre (ou paiement non confirmé) : les automatisations comprises tournent. */
  | 'sans_offre'
  /** Offre confirmée par le réseau : plus rien n'est réservé. */
  | 'offre_active';

export interface LectureOffre {
  /** Une clé de liaison vers un réseau Breizhcosystem est en place. */
  relie: boolean;
  /** Dernier plan confirmé par le réseau ; null tant qu'aucun ne l'a été. */
  plan: 'gratuit' | 'active' | null;
  /** Dernier état d'abonnement confirmé par le réseau ; null tant qu'aucun ne l'a été. */
  etatAbonnement: string | null;
}

/** Abonnement annoncé mais pas encore honoré : l'offre n'est pas ouverte (même règle que le pavillon de la carte). */
const EN_ATTENTE_DE_PAIEMENT: readonly string[] = ['paiement_en_attente', 'paiement_echoue'];

/**
 * Les six que l'entreprise garde quoi qu'il arrive : elles SIGNALENT, elles n'envoient rien.
 * Les quatre premières sont des automatisations ; les deux dernières, des gestes à faire une fois (écran Optimiser,
 * « À faire vous-même »), qui n'ont jamais rien envoyé non plus.
 */
export const GRATUITES: readonly string[] = [
  'trous-planning', // signale les trous du planning dès qu'ils apparaissent
  'documents', // anticipe les papiers à renouveler
  'vehicules', // planifie révisions et contrôles techniques
  'relance-devis', // signale les devis sans réponse ; l'envoi reste un clic humain
  'doublons', // fusionne les doublons de clients et de fournisseurs
  'connecter', // branche vos outils au lieu de ressaisir
];

const GRATUITES_SET: ReadonlySet<string> = new Set(GRATUITES);

/** Comprise dans Living Business : rien à souscrire, jamais verrouillée. */
export function estGratuite(id: string): boolean {
  return GRATUITES_SET.has(id);
}

/**
 * Lit l'état de l'offre à partir des derniers droits confirmés. Ne lance jamais, n'appelle rien : une lecture
 * incomplète (réseau jamais joint, réponse illisible) vaut « reliée sans l'offre », pas une erreur à l'écran.
 */
export function lireOffre(x: LectureOffre): EtatOffre {
  if (!x.relie) return 'non_reliee';
  if (x.plan !== 'active') return 'sans_offre';
  if (x.etatAbonnement !== null && EN_ATTENTE_DE_PAIEMENT.includes(x.etatAbonnement)) return 'sans_offre';
  return 'offre_active';
}

/** Cette automatisation-ci est-elle hors de portée de l'entreprise aujourd'hui ? */
export function verrouillee(id: string, offre: EtatOffre): boolean {
  return offre !== 'offre_active' && !estGratuite(id);
}

const MOTIF_PAR_DEFAUT = `Celle-ci ne se contente pas de signaler : elle produit et elle envoie à votre place. Ces envois partent par le service de l’éditeur et engagent votre entreprise ; ils sont compris dans ${OFFRE}.`;

const MOTIFS: Readonly<Record<string, string>> = {
  // le tri du courrier est la raison d'être de l'écran Courrier : il reste compris, et il reste dit
  'courrier-urgent': `Trier votre courrier reste compris, sur l’écran Courrier. C’est le routage automatique — la tâche créée et attribuée à la bonne personne sans vous — qui est compris dans ${OFFRE}.`,
};

/**
 * Pourquoi celle-ci est réservée, dit à l'écran : ce qu'elle fait de plus que signaler, et ce qui reste ouvert.
 * Jamais de reproche, jamais de perte annoncée : l'entreprise décide, et ce qu'elle a déjà lui suffit peut-être.
 */
export function motifVerrou(id: string): string {
  return MOTIFS[id] ?? MOTIF_PAR_DEFAUT;
}

/** Ce qui manque pour y accéder, en une phrase, ou rien quand l'offre est là. */
export function phraseOffre(offre: EtatOffre): string | null {
  if (offre === 'offre_active') return null;
  return offre === 'non_reliee'
    ? 'Votre entreprise n’est reliée à aucun réseau Breizhcosystem : ces automatisations sont présentées, sans rien changer à ce que vous utilisez.'
    : `Votre entreprise est reliée à Breizhcosystem ; l’offre ${OFFRE} n’y est pas ouverte pour l’instant.`;
}
