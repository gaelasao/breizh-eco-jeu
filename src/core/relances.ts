/**
 * LES RELANCES, SUR LE MOTEUR DE SUIVI. Trois sujets, un seul mécanisme : une facture échue, un devis qui attend une
 * réponse, une étape qui traîne. Ce module ne regarde pas les données de l'entreprise — il lit les SUIVIS que
 * `suivi.ts` a déjà calculés, et dit lesquels méritent qu'on y revienne aujourd'hui.
 *
 * CE QU'IL NE REFAIT PAS. Aucune règle d'échéance, aucun calcul de retard : `suivi.ts` a déjà rangé chaque sujet par
 * étapes, donné son état à chacune, et dit laquelle attend quelqu'un d'autre. Une relance n'est donc qu'un RYTHME
 * posé sur une étape déjà connue. En particulier, « un devis sans réponse » n'est plus un compte de sept jours écrit
 * deux fois dans la passerelle : c'est `Suivi.attente`, lu dans la forme du parcours déclaré par l'univers.
 *
 * CHAQUE RELANCE PRÉPARE, UNE PERSONNE DÉCIDE. Ce module compose l'objet et le message, et s'arrête là. Rien ne
 * part : `signaler` reste compris dans Living Business, l'ENVOI AUTOMATIQUE relève de l'offre (`offre.ts`), et c'est
 * la passerelle qui le demande — pas un second verrou écrit ici.
 *
 * SANS DOUBLON, ET SANS ACHARNEMENT. Chaque relance porte une clé stable (sujet, fiche, étape). Un registre garde
 * combien de fois elle est partie et quand : elle ne repart qu'après le délai réglé, et jamais plus que le nombre de
 * fois réglé. Une facture payée entre-temps n'a plus d'étape ouverte : elle sort de la liste, et son compteur est
 * oublié — si elle revient un jour, elle repart de zéro.
 *
 * TOUT EST PUR ICI : aucune horloge, aucun disque, aucun appel. Le jour de référence vient du contexte.
 */
import { pluriel } from './texte.ts';
import { joursEntre } from './vehicules.ts';
import type { ContexteSuivi, Etape, Suivi } from './suivi.ts';

// ------------------------------------------------------------------ les trois sujets

export type SujetRelance = 'paiement' | 'reponse' | 'avancement';

/** Le rythme d'une relance, tel que l'entreprise le règle. Aucun des trois n'est obligatoire à régler. */
export interface Rythme {
  /** Combien de jours après l'échéance (ou le début de l'attente) la première relance se prépare. */
  apresJours: number;
  /** Puis une relance tous les N jours, tant que rien ne bouge. */
  tousLesJours: number;
  /** Au plus tant de relances pour la même chose. Au-delà, le logiciel se taît : à l'entreprise de décider. */
  maxFois: number;
}

/** Vers qui la relance est tournée : le tiers que le suivi concerne, ou la personne qui le tient. */
export type VersQui = 'dehors' | 'dedans';

export interface DefRelance {
  id: SujetRelance;
  /** Dit en langage d'entrepreneur, jamais « règle 3 ». */
  libelle: string;
  aide: string;
  /** Sujets de suivi concernés (ceux de `suivi.ts`) ; un sujet absent de l'univers disparaît simplement. */
  sujets: readonly string[];
  /**
   * Sur quoi la relance se pose :
   * - `echeance` : une étape datée et dépassée (une facture échue) ;
   * - `attente` : l'étape en cours attend quelqu'un d'autre depuis trop longtemps (un devis parti) ;
   * - `etape` : une étape datée et dépassée, à l'intérieur du suivi (un chantier qui traîne).
   */
  sur: 'echeance' | 'attente' | 'etape';
  vers: VersQui;
  defaut: Rythme;
}

export const RELANCES: readonly DefRelance[] = Object.freeze([
  {
    id: 'paiement', libelle: 'Une facture échue', sujets: ['facture'], sur: 'echeance', vers: 'dehors',
    aide: 'L’échéance est passée et la facture n’est pas marquée payée. Marquée payée, elle n’est plus relancée.',
    defaut: { apresJours: 3, tousLesJours: 14, maxFois: 3 },
  },
  {
    id: 'reponse', libelle: 'Un devis sans réponse', sujets: ['devis', 'livraison'], sur: 'attente', vers: 'dehors',
    aide: 'Le devis est parti et son parcours n’a pas bougé. Accepté ou refusé, il n’est plus relancé.',
    defaut: { apresJours: 7, tousLesJours: 10, maxFois: 2 },
  },
  {
    id: 'avancement', libelle: 'Une étape qui traîne', sujets: ['chantier', 'livraison'], sur: 'etape', vers: 'dedans',
    aide: 'Une étape dépasse la date annoncée. Le message va à la personne qui la tient, jamais au client.',
    defaut: { apresJours: 2, tousLesJours: 7, maxFois: 4 },
  },
] as const satisfies readonly DefRelance[]);

const PAR_ID: ReadonlyMap<string, DefRelance> = new Map(RELANCES.map((r) => [r.id, r]));
export const defRelance = (id: string): DefRelance | undefined => PAR_ID.get(id);

/** Les sujets de suivi pour lesquels une relance existe (pour n'en proposer qu'aux sujets concernés). */
export const sujetsRelances = (sujetSuivi: string): DefRelance[] => RELANCES.filter((r) => r.sujets.includes(sujetSuivi));

// ------------------------------------------------------------------ ce que l'entreprise règle, et ce qu'elle ne règle pas

/** Rythmes choisis par l'entreprise, relance par relance. Ce qui manque prend le rythme par défaut. */
export type ReglagesRelances = Readonly<Record<string, Rythme>>;

const borne = (n: unknown, min: number, max: number, defaut: number): number => {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(max, Math.max(min, Math.round(x))) : defaut;
};

/** Un rythme reçu du navigateur (ou relu du disque), borné : jamais une valeur qui ferait sonner tous les jours. */
export function lireRythme(x: unknown, defaut: Rythme): Rythme {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return { ...defaut };
  const b = x as Record<string, unknown>;
  return {
    apresJours: borne(b.apresJours, 0, 365, defaut.apresJours),
    // jamais moins de deux jours entre deux relances : une relance par jour n'est pas une relance, c'est du harcèlement
    tousLesJours: borne(b.tousLesJours, 2, 365, defaut.tousLesJours),
    maxFois: borne(b.maxFois, 1, 10, defaut.maxFois),
  };
}

/** Le rythme retenu pour une relance : celui de l'entreprise, sinon celui que le jeu propose. */
export function rythmeDe(reglages: ReglagesRelances | undefined, id: string): Rythme {
  const d = defRelance(id);
  if (d === undefined) return { apresJours: 7, tousLesJours: 14, maxFois: 2 };
  const r = reglages?.[id];
  return r === undefined ? { ...d.defaut } : lireRythme(r, d.defaut);
}

// ------------------------------------------------------------------ le registre : ce qui est déjà parti

/** Ce que le registre garde d'une relance : combien de fois, et le jour de la dernière. */
export interface RelanceFaite {
  fois: number;
  /** Jour de la dernière relance, AAAA-MM-JJ. */
  dernierJour: string;
}

export type RegistreRelances = Readonly<Record<string, RelanceFaite>>;

/** La clé d'une relance : elle ne contient que des identifiants, jamais un libellé (qui pourrait changer). */
export const cleRelance = (relance: string, suiviId: string, etapeId: string): string => `${relance}:${suiviId}:${etapeId}`;

/** Une relance relue du disque ; ce qui est illisible est écarté plutôt que de fausser un compteur. */
export function lireFaite(x: unknown): RelanceFaite | null {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return null;
  const b = x as Record<string, unknown>;
  const fois = Number(b.fois);
  const jour = typeof b.dernierJour === 'string' ? b.dernierJour.slice(0, 10) : '';
  if (!Number.isInteger(fois) || fois < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(jour)) return null;
  return { fois: Math.min(fois, 100), dernierJour: jour };
}

// ------------------------------------------------------------------ une relance préparée

export interface Relance {
  /** Identité stable : même relance, même fiche, même étape ⇒ même clé. C'est l'anti-doublon. */
  cle: string;
  relance: SujetRelance;
  libelle: string;
  suiviId: string;
  sujet: string;
  libelleSujet: string;
  nom: string;
  etapeId: string;
  etape: string;
  vers: VersQui;
  /** Le tiers concerné, ou la personne qui tient l'étape ; null quand la fiche n'en désigne aucun. */
  qui: string | null;
  /** La relance numéro… : 1 pour la première, 2 pour la suivante. */
  fois: number;
  /** Jours de retard sur l'échéance, ou jours d'attente sans réponse. */
  jours: number;
  /** Ce que l'entreprise lit en une phrase sur son écran. */
  phrase: string;
  /** Ce qui est PRÉPARÉ, à relire puis à envoyer : jamais un montant, jamais une obligation annoncée. */
  objet: string;
  message: string;
  /** Vrai : ce n'est pas la première, et c'est dit (une relance qui ne se souvient de rien agace). */
  rappel: boolean;
}

/** De quoi écrire le message : le nom de l'entreprise, et rien d'autre. */
export interface SourceRelance {
  entreprise?: string;
}

const jourFr = (iso: string | null): string => {
  const j = (iso ?? '').slice(0, 10).split('-');
  return j.length === 3 ? `${j[2]}/${j[1]}/${j[0]}` : '';
};

const nomPropre = (t: string): string => t.replace(/\s*\((démo|fictif|fictive)\)/gi, '').trim().slice(0, 120);

/**
 * « Facture F-052 » et non « Facture Facture F-052 ». Beaucoup d'entreprises écrivent déjà le nom du type dans
 * celui de la fiche : le répéter donne une phrase bègue, et ce n'est pas au vocabulaire de l'univers de s'excuser.
 */
function designer(libelleSujet: string, nom: string): string {
  const propre = nomPropre(nom);
  const bas = propre.toLocaleLowerCase('fr-FR');
  const type = libelleSujet.toLocaleLowerCase('fr-FR');
  return bas.startsWith(type) ? propre : `${libelleSujet} ${propre}`;
}

/**
 * L'objet et le message préparés, par sujet de relance. Ils se vouvoient, restent courts, et n'affirment AUCUNE
 * obligation légale : ni pénalité, ni mise en demeure, ni délai « réglementaire ». Une relance est une question
 * polie, et la personne qui l'envoie reste libre de la réécrire entièrement.
 */
function texte(r: DefRelance, s: Suivi, e: Etape, jours: number, fois: number, src: SourceRelance): { objet: string; message: string } {
  const quoi = designer(s.libelleSujet, s.nom);
  const signature = src.entreprise === undefined || src.entreprise === '' ? '' : `\n\n${nomPropre(src.entreprise)}`;
  const encore = fois > 1 ? 'Nous nous permettons de revenir une nouvelle fois vers vous' : 'Nous revenons vers vous';
  if (r.id === 'paiement') {
    return {
      objet: `${quoi} — échéance du ${jourFr(e.jour)}`,
      message: `Bonjour,\n\n${encore} au sujet de ${quoi}, dont l’échéance était le ${jourFr(e.jour)}.\n\nSi le règlement est déjà parti, merci de ne pas tenir compte de ce message. Sinon, pouvez-vous nous dire où cela en est ?\n\nBien cordialement,${signature}`,
    };
  }
  if (r.id === 'reponse') {
    const depuis = jours < 1 ? 'parti aujourd’hui et resté sans réponse' : `resté sans réponse depuis ${pluriel(jours, 'jour', 'jours')}`;
    return {
      objet: `${quoi} — toujours à votre disposition`,
      message: `Bonjour,\n\n${encore} au sujet de ${quoi}, ${depuis}.\n\nAvez-vous eu le temps de le regarder ? Nous restons disponibles pour en reparler, ou pour l’ajuster si besoin.\n\nBien cordialement,${signature}`,
    };
  }
  return {
    objet: `${quoi} — « ${nomPropre(e.libelle)} » en attente`,
    message: `Bonjour,\n\nL’étape « ${nomPropre(e.libelle)} » de ${quoi} était annoncée pour le ${jourFr(e.jour)}, il y a ${pluriel(jours, 'jour', 'jours')}.\n\nPouvez-vous dire où cela en est, et à quelle date elle peut être tenue ?\n\nMerci.${signature}`,
  };
}

/** La phrase que l'entreprise lit sur son écran : quoi, depuis quand, et la fois. */
function phrase(r: DefRelance, s: Suivi, e: Etape, jours: number, fois: number): string {
  const quoi = designer(s.libelleSujet, s.nom);
  const rang = fois > 1 ? ` (relance ${fois})` : '';
  if (r.id === 'paiement') return `${quoi} : échue depuis ${pluriel(jours, 'jour', 'jours')}${rang}.`;
  if (r.id === 'reponse') return jours < 1 ? `${quoi} : sans réponse pour l’instant${rang}.` : `${quoi} : sans réponse depuis ${pluriel(jours, 'jour', 'jours')}${rang}.`;
  return `${quoi} — ${nomPropre(e.libelle)} : en retard de ${pluriel(jours, 'jour', 'jours')}${rang}.`;
}

/** L'étape sur laquelle une relance se pose, et le nombre de jours qu'elle compte ; null : rien à relancer. */
function surQuoi(r: DefRelance, s: Suivi): { etape: Etape; jours: number } | null {
  if (r.sur === 'attente') {
    return s.attente === null ? null : { etape: s.attente.etape, jours: s.attente.depuisJours };
  }
  // une étape datée, dépassée, et pas encore faite : la plus en retard d'abord
  const candidates = s.etapes
    .filter((e) => !e.faite && e.jour !== null && e.joursRestants !== null && e.joursRestants < 0)
    // `echeance` ne relance que l'échéance que le suivi porte lui-même ; `etape`, n'importe laquelle de ses étapes
    .filter((e) => (r.sur === 'echeance' ? e.regle === null : true))
    .sort((a, b) => (a.joursRestants ?? 0) - (b.joursRestants ?? 0));
  const e = candidates[0];
  return e === undefined ? null : { etape: e, jours: -(e.joursRestants ?? 0) };
}

/**
 * CE QU'IL Y A À RELANCER AUJOURD'HUI. Pour chaque suivi et chaque sujet de relance : l'étape concernée, depuis
 * combien de jours, et la fois. Une relance n'y figure que si son délai est écoulé depuis la précédente, et jamais
 * au-delà du nombre de fois réglé. L'ordre est stable : deux passages donnent la même liste.
 *
 * Un suivi terminé n'y est jamais — c'est ce qui fait qu'une facture payée entre-temps n'est plus relancée, sans
 * qu'aucun code ne parle de paiement : son étape est faite, donc il n'y a plus rien à relancer.
 */
export function relancesDues(
  liste: readonly Suivi[],
  reglages: ReglagesRelances | undefined,
  faites: RegistreRelances,
  ctx: ContexteSuivi,
  src: SourceRelance = {},
): Relance[] {
  const res: Relance[] = [];
  for (const s of liste) {
    if (s.termine) continue;
    for (const r of RELANCES) {
      if (!r.sujets.includes(s.sujet)) continue;
      const quoi = surQuoi(r, s);
      if (quoi === null) continue;
      const rythme = rythmeDe(reglages, r.id);
      if (quoi.jours < rythme.apresJours) continue;
      const cle = cleRelance(r.id, s.id, quoi.etape.id);
      const deja = faites[cle];
      if (deja !== undefined) {
        if (deja.fois >= rythme.maxFois) continue; // on a dit ce qu'on avait à dire : la suite appartient à l'entreprise
        const depuis = joursEntre(deja.dernierJour, ctx.aujourdhui);
        if (depuis === null || depuis < rythme.tousLesJours) continue;
      }
      const fois = (deja?.fois ?? 0) + 1;
      const t = texte(r, s, quoi.etape, quoi.jours, fois, src);
      res.push({
        cle, relance: r.id, libelle: r.libelle, suiviId: s.id, sujet: s.sujet, libelleSujet: s.libelleSujet,
        nom: nomPropre(s.nom), etapeId: quoi.etape.id, etape: nomPropre(quoi.etape.libelle), vers: r.vers,
        qui: r.vers === 'dehors' ? s.destinataire : quoi.etape.responsable ?? s.responsable,
        fois, jours: quoi.jours, rappel: fois > 1,
        phrase: phrase(r, s, quoi.etape, quoi.jours, fois), objet: t.objet, message: t.message,
      });
    }
  }
  return res.sort((a, b) => b.jours - a.jours || a.cle.localeCompare(b.cle));
}

/**
 * Les clés du registre qui ne correspondent plus à rien : la facture a été payée, le devis a reçu sa réponse,
 * l'étape a été terminée, la fiche a disparu. Oublier le compteur est VOULU : si la même chose revient un jour, elle
 * repart de zéro plutôt que de buter sur un plafond atteint des mois plus tôt.
 *
 * `vivantes` sont les clés encore possibles — celles de `relancesPossibles`, et non celles qui sont dues
 * aujourd'hui : une relance qui attend simplement la fin de son délai ne doit pas perdre sa mémoire.
 */
export function oublis(faites: RegistreRelances, vivantes: ReadonlySet<string>): string[] {
  return Object.keys(faites).filter((c) => !vivantes.has(c)).sort();
}

/**
 * Toutes les clés qui ont encore un sens aujourd'hui, délai ou plafond mis de côté. C'est ce qui permet de distinguer
 * « plus rien à relancer » (on oublie) de « pas encore l'heure » (on garde).
 */
export function relancesPossibles(liste: readonly Suivi[]): Set<string> {
  const res = new Set<string>();
  for (const s of liste) {
    if (s.termine) continue;
    for (const r of RELANCES) {
      if (!r.sujets.includes(s.sujet)) continue;
      const quoi = surQuoi(r, s);
      if (quoi !== null) res.add(cleRelance(r.id, s.id, quoi.etape.id));
    }
  }
  return res;
}

// ------------------------------------------------------------------ le partage, et ce qu'il dit

/** À qui l'entreprise partage un suivi. Les trois sont au même prix : gratuit. */
export const DESTINATAIRES = Object.freeze(['client', 'fournisseur', 'comptable'] as const);
export type DestinatairePartage = (typeof DESTINATAIRES)[number];

const PARTAGE: Readonly<Record<DestinatairePartage, { libelle: string; aide: string; objet: string; intro: string }>> = {
  client: {
    libelle: 'À mon client', aide: 'Il voit où ça en est, sans vous appeler.',
    objet: 'Suivez l’avancement', intro: 'Vous pouvez suivre l’avancement en direct, à cette adresse :',
  },
  fournisseur: {
    libelle: 'À mon fournisseur', aide: 'Il voit les étapes qui l’attendent, et quand.',
    objet: 'Le suivi de notre commande', intro: 'Voici le suivi, pour que vous voyiez les étapes et leurs dates :',
  },
  comptable: {
    libelle: 'À mon comptable', aide: 'Il voit l’avancement, jamais un montant ni une marge.',
    objet: 'Le suivi du dossier', intro: 'Voici le suivi du dossier, pour information :',
  },
};

export const defPartage = (pour: string) => PARTAGE[pour as DestinatairePartage] ?? PARTAGE.client;
export const estDestinatairePartage = (x: unknown): x is DestinatairePartage =>
  typeof x === 'string' && (DESTINATAIRES as readonly string[]).includes(x);

/**
 * Le message que l'entreprise n'a plus qu'à envoyer, avec le lien de suivi. Aucun montant, aucune marge : la page
 * qu'il ouvre est déjà une liste blanche (`suivi-client.ts`), et le message n'en dit pas plus qu'elle.
 */
export function messagePartage(pour: string, nomSuivi: string, adresse: string | null, src: SourceRelance = {}): { objet: string; message: string } {
  const d = defPartage(pour);
  const quoi = nomPropre(nomSuivi);
  const signature = src.entreprise === undefined || src.entreprise === '' ? '' : `\n\n${nomPropre(src.entreprise)}`;
  const lien = adresse === null
    ? '\n\n(L’adresse du lien s’affiche dans Living Business : copiez-la ici avant d’envoyer.)'
    : `\n\n${adresse}`;
  return {
    objet: `${d.objet} — ${quoi}`,
    message: `Bonjour,\n\n${d.intro}${lien}\n\nCe lien ne montre que ce suivi, et rien d’autre.\n\nBien cordialement,${signature}`,
  };
}
