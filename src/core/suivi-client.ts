/**
 * LA PAGE DE SUIVI DU CLIENT FINAL. Un lien partageable, nommé par l'univers : « Suivre mon chantier » (BTP),
 * « Suivre ma commande » (Commerce), « Suivre mon dossier » (générique). Le client y voit où ça en est, la prochaine
 * étape, les photos, et à la fin la demande d'avis. L'entreprise, de son côté, voit quand il l'a ouverte.
 *
 * TROIS GARDE-FOUS, NON NÉGOCIABLES. Chacun est tenu par un essai, et chacun est tenu ICI, dans une fonction pure,
 * pas dans un écran : un garde-fou qui dépend du gabarit d'une page saute à la première retouche de cette page.
 *
 * 1. AUCUNE DONNÉE D'UNE AUTRE ENTREPRISE. Le lien porte l'organisation à laquelle il appartient ; tout objet d'une
 *    autre organisation est refusé avant d'être lu, et le lien ne sert qu'au suivi pour lequel il a été créé.
 *
 * 2. AUCUN PRIX D'ACHAT, AUCUNE MARGE, AUCUN COÛT INTERNE. La page n'est pas un filtre qui retire les champs
 *    interdits : elle est une LISTE BLANCHE, construite champ par champ. Un champ ajouté demain à un univers
 *    n'apparaît donc pas tout seul chez le client. En plus de la liste blanche, `fuite` relit ce qui est sorti et
 *    refuse tout montant : deux verrous, parce qu'un seul finit toujours par être contourné par distraction.
 *
 * 3. LE LIEN EST RÉVOCABLE. Une page révoquée ne montre plus rien — ni le nom du client, ni celui de l'entreprise,
 *    ni l'étape en cours. Un lien partagé qu'on ne peut pas reprendre, c'est une fuite qui dure pour toujours.
 *
 * LA LIGNE GRATUIT / PAYANT ne se décide pas ici (voir `offre.ts`) : DÉTECTER et PRÉVENIR restent compris ; PUBLIER
 * cette page et ENVOYER le lien au client relèvent de l'offre. Ce module compose la page ; `passerelle/suivi.ts`
 * demande à `offre.ts` si elle a le droit d'être publiée.
 */
import type { ObjetMetier } from './model.ts';
import { libelleSujet, phraseEcheance, sujetDe, type EtatEtape, type Suivi } from './suivi.ts';
import { defType, type Univers } from './univers.ts';

/** Un lien de suivi, tel que l'entreprise le crée puis le reprend. Le jeton lui-même n'est jamais gardé en clair. */
export interface LienSuivi {
  id: string;
  /** Empreinte du jeton (le jeton ne vit que dans l'adresse envoyée au client). */
  empreinte: string;
  /** L'organisation à qui ce lien appartient : premier garde-fou. */
  orgId: string;
  /** L'objet suivi, et lui seul. */
  suiviId: string;
  creeLe: string;
  creePar: string;
  /** Révoqué le… : à partir de là la page ne montre plus rien. */
  revoqueLe: string | null;
  /** Quand le client l'a ouverte la première et la dernière fois, et combien de fois. */
  ouvertLe: string | null;
  dernierLe: string | null;
  ouvertures: number;
  /**
   * La demande d'avis de la fin, préparée par `enquetes.ts` quand l'entreprise l'a voulue en créant le lien. C'est
   * la même adresse qu'elle aurait envoyée par courriel : rien de plus secret n'est gardé ici.
   */
  lienAvis?: string | null;
}

/** Pourquoi une page ne montre rien. */
export type RefusPage = 'revoque' | 'introuvable' | 'autre_entreprise';

/** Une étape, telle que le client la voit. Rien d'autre n'en sort. */
export interface EtapeClient {
  libelle: string;
  etat: EtatEtape;
  /** Jour de l'échéance ; null quand l'entreprise n'en a pas annoncé — ou qu'elle ne montre pas son retard. */
  jour: string | null;
  faite: boolean;
  /**
   * Vrai : c'est là qu'en est le travail. C'est la seule chose que la page dise quand le retard reste à l'intérieur.
   * Nommée « courante » et non « en cours » : « encours » désigne de l'argent dû, et aucun mot d'argent n'a le droit
   * d'approcher cette page — un essai le vérifie, jusque dans les noms de champs.
   */
  courante: boolean;
}

/**
 * MONTRER LE RETARD, OU DIRE SEULEMENT L'ÉTAPE EN COURS. « Charpente : dépassée de 2 jours » est honnête, et c'est
 * ce que la page dit PAR DÉFAUT : une entreprise qui partage un suivi partage aussi ses retards, et les clients le
 * savent mieux que personne. Mais ce n'est pas au logiciel d'imposer cette franchise-là : une entreprise peut avoir
 * de bonnes raisons de dire seulement « Charpente : en cours » — un retard qui vient du client lui-même, d'un
 * fournisseur, d'une intempérie, ou simplement une relation qui se règle au téléphone.
 *
 * Le réglage ne cache RIEN d'autre : les étapes, leur ordre, l'avancement et ce qui est fait restent affichés, et
 * une étape terminée garde sa date. Seuls le RETARD et les dates encore à tenir sortent de la page. Et il ne touche
 * jamais ce que l'entreprise voit, elle : son écran dit le retard, toujours.
 */
export interface AffichageClient {
  /** Vrai (le défaut) : le client voit « dépassée de 2 jours ». Faux : il voit l'étape en cours, sans le retard. */
  montrerRetard: boolean;
}

export const AFFICHAGE_DEFAUT: AffichageClient = Object.freeze({ montrerRetard: true });

/** Un réglage d'affichage reçu du navigateur (ou relu du disque) : ce qui manque ou déborde revient au défaut. */
export function lireAffichage(x: unknown): AffichageClient {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return { ...AFFICHAGE_DEFAUT };
  const b = x as Record<string, unknown>;
  return { montrerRetard: b.montrerRetard === false ? false : true };
}

/** Une photo montrée au client (adresse seulement, jamais un fichier recopié ici). */
export interface PhotoClient { lien: string; le: string | null }

export interface PageClient {
  etat: 'ouverte';
  /** « Suivre mon chantier », « Suivre ma commande », « Suivre mon dossier » : nommé par l'univers. */
  titre: string;
  /** Le nom de l'entreprise qui suit, et celui du suivi. Jamais une autre fiche. */
  entreprise: string;
  reference: string;
  /** Où ça en est, en une phrase. */
  phrase: string;
  /** La prochaine étape, dite au client ; null quand tout est fait. */
  prochaine: string | null;
  etapes: EtapeClient[];
  avancement: { faites: number; total: number };
  termine: boolean;
  photos: PhotoClient[];
  /** La demande d'avis, à la fin, quand l'entreprise en a préparé une. */
  avis: { lien: string } | null;
}

export interface PageRefusee { etat: 'fermee'; refus: RefusPage; message: string }

const MESSAGES: Readonly<Record<RefusPage, string>> = {
  revoque: 'Ce lien de suivi a été retiré par l’entreprise. Contactez-la directement : elle vous en donnera un nouveau si besoin.',
  introuvable: 'Ce lien de suivi n’existe pas, ou plus.',
  autre_entreprise: 'Ce lien de suivi n’existe pas, ou plus.',
};

/** Une page fermée : le motif, une phrase, et RIEN d'autre — aucun nom, aucune étape, aucune date. */
export const pageFermee = (refus: RefusPage): PageRefusee => ({ etat: 'fermee', refus, message: MESSAGES[refus] });

/**
 * Genre du nom du sujet, pour écrire « mon chantier » ou « ma commande ». Il est déclaré dans l'univers
 * (`genre` du type) : la langue de l'entreprise appartient à son univers, pas à ce fichier. Sans déclaration, le
 * masculin, qui est la forme par défaut du français.
 */
function article(u: Univers, typeId: string | null): 'mon' | 'ma' {
  const d = typeId === null ? undefined : defType(u, typeId);
  return d?.genre === 'f' ? 'ma' : 'mon';
}

/** « Suivre mon chantier » : le verbe est à nous, le nom vient de l'univers. */
export function titrePage(u: Univers, o: ObjetMetier): string {
  const s = sujetDe(o);
  const nom = s === null ? (defType(u, o.type)?.libelle ?? o.type) : libelleSujet(u, s);
  return `Suivre ${article(u, o.type)} ${nom.toLocaleLowerCase('fr-FR')}`;
}

/** Ce que l'entreprise a attaché au suivi pour le client : une adresse d'image, rien de plus. */
export interface SourcePhotos {
  /** Les photos du suivi, dans l'ordre où elles sont arrivées. */
  photos?: readonly { lien: string; le: string | null }[];
  /** L'adresse de la demande d'avis préparée par l'entreprise, quand il y en a une. */
  lienAvis?: string | null;
}

const LIEN_SUR = (x: unknown): string | null => {
  if (typeof x !== 'string' || x.length > 2000) return null;
  try {
    const u = new URL(x);
    // jamais de « javascript: », jamais d'identifiant glissé dans l'adresse
    return u.protocol === 'https:' && !u.username && !u.password ? u.toString() : null;
  } catch { return null; }
};

/** Un nom montré au client, sans la mention de démonstration et sans caractère de mise en forme. */
const nomPropre = (t: string): string =>
  t.replace(/\s*\((démo|fictif|fictive)\)/gi, '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/ {2,}/g, ' ').trim().slice(0, 120);

/**
 * La page du client, construite champ par champ. `suivi` est le suivi déjà calculé par le moteur, `objet` la fiche
 * suivie, `entreprise` le nom de l'organisation. Tout ce qui n'est pas nommé ici ne sort pas.
 *
 * Les trois garde-fous passent AVANT la composition : un lien révoqué, un lien d'une autre organisation ou un suivi
 * qui n'est pas celui du lien rendent une page fermée.
 */
export function pageClient(
  u: Univers,
  lien: LienSuivi,
  objet: ObjetMetier | null,
  suivi: Suivi | null,
  entreprise: string,
  extra: SourcePhotos = {},
  affichage: AffichageClient = AFFICHAGE_DEFAUT,
): PageClient | PageRefusee {
  if (lien.revoqueLe !== null) return pageFermee('revoque');
  if (objet === null || suivi === null) return pageFermee('introuvable');
  // garde-fou 1 : ce lien ne montre que SON suivi, et seulement si le suivi appartient à son organisation
  if (objet.id !== lien.suiviId || suivi.id !== lien.suiviId) return pageFermee('introuvable');
  if (objet.orgId !== lien.orgId) return pageFermee('autre_entreprise');

  const montre = affichage.montrerRetard !== false;
  const etapes: EtapeClient[] = suivi.etapes
    // une étape sans date ni avancement ne dit rien au client, sauf si l'entreprise l'a DÉCLARÉE : celle-là viendra
    .filter((e) => e.faite || e.jour !== null || e.declaree || e.etat !== 'sans_date')
    .map((e) => ({
      libelle: nomPropre(e.libelle),
      // retard gardé à l'intérieur : une étape qui reste ne dit que « à venir », et sa date ne sort pas
      etat: montre || e.faite ? e.etat : 'a_venir',
      jour: montre || e.faite ? e.jour : null,
      faite: e.faite,
      courante: e.enCours,
    }));

  const photos: PhotoClient[] = (extra.photos ?? [])
    .map((p) => ({ lien: LIEN_SUR(p.lien), le: typeof p.le === 'string' ? p.le.slice(0, 10) : null }))
    .filter((p): p is PhotoClient => p.lien !== null)
    .slice(0, 24);

  const avisLien = LIEN_SUR(extra.lienAvis ?? null);
  // là où en est le travail : l'étape en cours quand il y en a une déclarée, sinon la prochaine échéance
  const ouverte = suivi.etapes.find((e) => e.enCours && !e.faite) ?? suivi.prochaine;
  return {
    etat: 'ouverte',
    titre: titrePage(u, objet),
    entreprise: nomPropre(entreprise),
    reference: nomPropre(objet.nom),
    phrase: suivi.termine
      ? 'C’est terminé.'
      : montre
        ? suivi.prochaine === null ? 'En cours.' : phraseEcheance(suivi.prochaine)
        : ouverte === null || ouverte === undefined ? 'En cours.' : `${nomPropre(ouverte.libelle)} : en cours`,
    prochaine: montre
      ? (suivi.prochaine === null ? null : nomPropre(suivi.prochaine.libelle))
      : (ouverte === null || ouverte === undefined ? null : nomPropre(ouverte.libelle)),
    etapes,
    avancement: { faites: etapes.filter((e) => e.faite).length, total: etapes.length },
    termine: suivi.termine,
    photos,
    avis: suivi.termine && avisLien !== null ? { lien: avisLien } : null,
  };
}

// ------------------------------------------------------------------ le deuxième verrou du garde-fou 2

/**
 * Les mots qui désignent de l'argent ou un coût interne. Ils ne servent pas à filtrer la page (elle est une liste
 * blanche) : ils servent à la RELIRE et à refuser qu'un montant y soit arrivé par une autre route — un libellé
 * d'étape, un nom de fiche, une note. Un essai le vérifie sur chaque page composée.
 */
const MOTS_ARGENT = [
  'montant', 'prix', 'marge', 'coût', 'cout', 'achat', 'tarif', 'remise', 'encours', 'honoraire',
  'bénéfice', 'benefice', 'taux horaire', 'débours', 'debours',
] as const;
/** Un nombre suivi d'une monnaie, ou une monnaie suivie d'un nombre : « 6 800 € », « € 6800 », « 1 200 EUR ». */
const MONTANT = /\d[\d  .,]*\s*(?:€|eur\b|euros?\b)|(?:€|eur\b)\s*\d/i;

/** Ce qu'une page laisse voir, mis à plat : tout le texte qui sortira vers le client. */
function texteDeLaPage(p: PageClient): string {
  return [p.titre, p.entreprise, p.reference, p.phrase, p.prochaine ?? '', ...p.etapes.map((e) => e.libelle)].join(' \n ');
}

/**
 * Un chiffre interne a-t-il fui dans la page ? Renvoie ce qui a été trouvé (vide = rien). Appelé par
 * `passerelle/suivi.ts` avant de servir la page : si ça déborde, la page se ferme plutôt que de montrer un montant.
 */
export function fuite(p: PageClient): string[] {
  const t = texteDeLaPage(p);
  const bas = t.toLocaleLowerCase('fr-FR');
  const trouves: string[] = MOTS_ARGENT.filter((m) => bas.includes(m));
  if (MONTANT.test(t)) trouves.push('montant chiffré');
  return trouves;
}

/** Vrai : cette page peut partir chez le client. */
export const pageSure = (p: PageClient | PageRefusee): boolean => p.etat === 'fermee' || fuite(p).length === 0;

// ------------------------------------------------------------------ ce que l'entreprise voit du lien

export interface VueLien {
  id: string;
  suiviId: string;
  creeLe: string;
  revoque: boolean;
  revoqueLe: string | null;
  /** Quand le client l'a ouverte la première fois ; null : il ne l'a pas encore ouverte. */
  ouvertLe: string | null;
  dernierLe: string | null;
  ouvertures: number;
  /** Dit à l'entreprise ce qu'elle veut savoir, en une phrase. */
  phrase: string;
}

/** Le lien vu de l'intérieur : jamais le jeton, jamais son empreinte. */
export function vueLien(l: LienSuivi): VueLien {
  const phrase = l.revoqueLe !== null
    ? 'Lien retiré : la page ne montre plus rien.'
    : l.ouvertLe === null
      ? 'Lien actif. Votre client ne l’a pas encore ouvert.'
      : l.ouvertures === 1
        ? `Votre client l’a ouvert une fois, le ${jourFr(l.ouvertLe)}.`
        : `Votre client l’a ouvert ${l.ouvertures} fois, la dernière le ${jourFr(l.dernierLe ?? l.ouvertLe)}.`;
  return {
    id: l.id, suiviId: l.suiviId, creeLe: l.creeLe, revoque: l.revoqueLe !== null, revoqueLe: l.revoqueLe,
    ouvertLe: l.ouvertLe, dernierLe: l.dernierLe, ouvertures: l.ouvertures, phrase,
  };
}

const jourFr = (iso: string): string => {
  const j = iso.slice(0, 10).split('-');
  return j.length === 3 ? `${j[2]}/${j[1]}/${j[0]}` : iso.slice(0, 10);
};
