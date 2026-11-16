/**
 * LE MOTEUR DE SUIVI, BRANCHÉ AU MONDE. `core/suivi.ts` dit ce qui DEVRAIT exister ; ce module le fait exister, et
 * surtout le RETIRE quand ce n'est plus dû.
 *
 * SANS DOUBLON, JAMAIS. Chaque sortie du moteur porte une clé stable (sujet, fiche, étape, porte). Un registre garde
 * « cette clé → cette fiche ». Un deuxième passage retrouve la clé et met à jour ; il ne crée rien. Une échéance
 * annulée, réglée, ou dont la porte vient d'être décochée n'a plus de clé : la fiche qu'elle avait créée est retirée.
 * C'est tout le mécanisme, et il tient en une comparaison d'ensembles.
 *
 * PAR OÙ ÇA SORT VRAIMENT. Le moteur n'appelle ni Google ni Microsoft : il écrit un RENDEZ-VOUS et une TÂCHE dans le
 * monde privé, comme l'entreprise les écrirait à la main. Ce sont les connecteurs déjà en place (`sources-agenda.ts`,
 * `sources-taches.ts`, poussés par `synchro.ts`) qui les emmènent dans l'agenda et la liste branchés. Conséquence
 * voulue : une entreprise SANS agenda branché voit tout fonctionner — ses échéances deviennent des rendez-vous dans
 * son planning, simplement ils ne partent nulle part. Rien de nouveau n'a été inventé pour sortir.
 *
 * LES DEUX AUTRES PORTES EXISTAIENT. « Aujourd'hui » lit les situations ; `alertes.ts` lit les mêmes situations sous
 * ses propres sujets, avec son propre anti-doublon. Ce module ne touche pas à `alertes.ts` : il appelle ce qu'il
 * expose (`SUJETS`) pour dire à l'entreprise quel sujet cocher, et c'est tout.
 *
 * LA LIGNE GRATUIT / PAYANT, telle que `core/offre.ts` la pose : DÉTECTER et PRÉVENIR restent compris — les quatre
 * portes écrivent chez l'entreprise, rien ne part vers un client, rien ne passe par les serveurs de l'éditeur.
 * PUBLIER la page de suivi et ENVOYER le lien au client relèvent de l'offre : le verrou est demandé à `offre.ts`,
 * sans second mécanisme.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SUJETS as SUJETS_ALERTE } from './alertes.ts';
import { ErreurApi, type Monde } from './monde.ts';
import type { ObjetMetier, ValeurChamp } from '../core/model.ts';
import { lireOffre, motifVerrou, phraseOffre, verrouillee, type EtatOffre, type LectureOffre } from '../core/offre.ts';
import {
  contexteDe, defSujet, libelleSujet, lireModele, lirePortes, modelesUnivers, MODELES_MAX, PORTES, portesAlerte,
  portesDe, situationsRetenues, sorties, suiviDe, suivis, sujetDe, sujetsDeLUnivers,
  type ChoixPortes, type DefSujetSuivi, type ModeleEtapes, type Porte, type Sortie, type Suivi,
} from '../core/suivi.ts';
import {
  defPartage, defRelance, DESTINATAIRES, estDestinatairePartage, lireFaite, lireRythme, messagePartage,
  oublis, relancesDues, relancesPossibles, RELANCES, rythmeDe, sujetsRelances,
  type Relance, type RelanceFaite, type Rythme,
} from '../core/relances.ts';
import {
  AFFICHAGE_DEFAUT, fuite, lireAffichage, pageClient, pageFermee, vueLien,
  type AffichageClient, type LienSuivi, type PageClient, type PageRefusee, type VueLien,
} from '../core/suivi-client.ts';
import type { Situation } from '../core/situation.ts';
import type { Profil } from '../demo/donnees.ts';

/**
 * Identifiant de l'automatisation qui porte la page de suivi, au sens de `core/offre.ts`. Il EST dans `GRATUITES` :
 * partager un suivi ne demande rien à personne. L'entreprise crée le lien, le colle dans son message et l'envoie
 * elle-même — rien ne part par le service de l'éditeur, et c'est ce qui fait connaître le produit.
 */
export const AUTOMATISATION_PAGE = 'page-suivi';
/** Préparer une relance reste compris : elle est écrite, relue, et c'est une personne qui l'envoie. */
export const AUTOMATISATION_RELANCES = 'relances-suivi';
/**
 * L'ENVOI AUTOMATIQUE, lui, relève de l'offre : le message qui part à chaque étape, et la relance qui part sans que
 * personne la relise. C'est le seul verrou de ce module, et il est demandé à `core/offre.ts`, sans second mécanisme.
 */
export const AUTOMATISATION_ENVOI = 'suivi-envoi';

/** Préfixe des sources des fiches que le moteur écrit. Il sert aussi à ne JAMAIS les relire comme des étapes. */
export const SOURCE = 'suivi';
const sourceDe = (sujet: string) => ({ id: `${SOURCE}:${sujet}`, libelle: `Suivi — ${sujet}` });
/** Une fiche écrite par le moteur : on la reconnaît à sa source, et on ne la reprend jamais pour une donnée d'entrée. */
export const ecriteParLeMoteur = (o: ObjetMetier): boolean => o.source.id === SOURCE || o.source.id.startsWith(`${SOURCE}:`);

const ID_LIEN = /^sv-[a-f0-9]{12}$/;
const ID_MODELE = /^[A-Za-z0-9_:-]{1,60}$/;
export const JETON = /^[A-Za-z0-9_-]{43}$/;
const LIENS_MAX = 2000;
const SORTIES_MAX = 2000;
const empreinteJeton = (jeton: string) => createHash('sha256').update(jeton).digest('base64url');
const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

/** Une image attachée au suivi : une adresse https qui finit par une extension d'image. */
const EXTENSION_IMAGE = /\.(jpe?g|png|webp|avif|heic|gif)(\?|$)/i;

/** Ce que le registre garde d'une sortie : la fiche écrite, et l'empreinte de ce qu'on y a mis. */
interface Inscrit { objetId: string; empreinte: string; porte: 'agenda' | 'tache' }

export interface EtatSuivis {
  /** Portes choisies, sujet par sujet. */
  portes: Record<string, Porte[]>;
  /** Clé de sortie → fiche écrite. C'est l'anti-doublon, et c'est aussi ce qui permet de défaire. */
  inscrits: Record<string, Inscrit>;
  /** Liens de suivi partagés aux clients (jetons jamais gardés en clair). */
  liens: LienSuivi[];
  /** Modèles d'étapes écrits par l'entreprise. Vide : elle n'en a écrit aucun, et tout marche comme avant. */
  modeles: ModeleEtapes[];
  /** Fiche → modèle d'étapes choisi pour elle. Une fiche absente garde les étapes de l'univers. */
  etapesPar: Record<string, string>;
  /** Rythmes de relance réglés par l'entreprise ; ce qui manque prend le rythme proposé. */
  rythmes: Record<string, Rythme>;
  /** Relances déjà parties : clé → combien de fois, et quand. C'est l'anti-doublon des relances. */
  relancesFaites: Record<string, RelanceFaite>;
  /** Ce que la page du client montre du retard. Par défaut : elle le montre. */
  affichage: AffichageClient;
}

/** Un état vide NEUF à chaque appel : deux installations ne doivent jamais partager le même objet. */
const etatVide = (): EtatSuivis => ({
  portes: {}, inscrits: {}, liens: [], modeles: [], etapesPar: {}, rythmes: {}, relancesFaites: {},
  affichage: { ...AFFICHAGE_DEFAUT },
});

/** Ce que le module a besoin de savoir du reste du jeu. */
export interface SourcesSuivis {
  /** Derniers droits confirmés par le réseau (lus, jamais appelés) : voir `core/offre.ts`. */
  droits(): LectureOffre;
  /** Sujets d'alerte cochés par l'entreprise dans Réglages, Alertes. */
  sujetsAlerte(): readonly string[];
  /** L'adresse publique du jeu, pour écrire le lien envoyé au client ; null si elle n'est pas connue. */
  adresse(): string | null;
  /**
   * Prépare la demande d'avis du client, par le mécanisme qui existe déjà (`enquetes.ts`, le même formulaire que
   * « Envoyer un formulaire »). Appelée seulement quand une personne crée le lien et le demande ; jamais toute seule.
   */
  inviterAvis?: (p: Profil, client: string) => string | null;
}

function lireEtat(x: unknown): EtatSuivis {
  if (!estObj(x)) return etatVide();
  const portes: Record<string, Porte[]> = {};
  if (estObj(x.portes)) {
    for (const [sujet, v] of Object.entries(x.portes)) {
      if (defSujet(sujet) === undefined) continue;
      portes[sujet] = [...lirePortes(v)];
    }
  }
  const inscrits: Record<string, Inscrit> = {};
  if (estObj(x.inscrits)) {
    for (const [cle, v] of Object.entries(x.inscrits).slice(0, SORTIES_MAX)) {
      if (!estObj(v) || typeof v.objetId !== 'string' || typeof v.empreinte !== 'string') continue;
      if (v.porte !== 'agenda' && v.porte !== 'tache') continue;
      inscrits[cle] = { objetId: v.objetId, empreinte: v.empreinte, porte: v.porte };
    }
  }
  const liens = (Array.isArray(x.liens) ? x.liens : []).filter((l): l is LienSuivi =>
    estObj(l) && typeof l.id === 'string' && ID_LIEN.test(l.id) && typeof l.empreinte === 'string'
    && typeof l.orgId === 'string' && typeof l.suiviId === 'string' && typeof l.creeLe === 'string').slice(-LIENS_MAX);
  // les modèles d'étapes sont recontrôlés à la relecture par `lireEtat` du noyau, qui a besoin de l'univers :
  // ici on ne garde que la forme, et `#modeles()` écarte ce que l'univers ne reconnaît plus
  const modeles = (Array.isArray(x.modeles) ? x.modeles : []).filter((m): m is ModeleEtapes =>
    estObj(m) && typeof m.id === 'string' && ID_MODELE.test(m.id) && typeof m.sujet === 'string'
    && defSujet(m.sujet) !== undefined && typeof m.nom === 'string' && Array.isArray(m.etapes)).slice(0, MODELES_MAX);
  const etapesPar: Record<string, string> = {};
  if (estObj(x.etapesPar)) {
    for (const [fiche, m] of Object.entries(x.etapesPar).slice(0, SORTIES_MAX)) {
      if (typeof m === 'string' && ID_MODELE.test(m)) etapesPar[fiche] = m;
    }
  }
  const rythmes: Record<string, Rythme> = {};
  if (estObj(x.rythmes)) {
    for (const [id, r] of Object.entries(x.rythmes)) {
      const d = defRelance(id);
      if (d !== undefined) rythmes[id] = lireRythme(r, d.defaut);
    }
  }
  const relancesFaites: Record<string, RelanceFaite> = {};
  if (estObj(x.relancesFaites)) {
    for (const [cle, f] of Object.entries(x.relancesFaites).slice(0, SORTIES_MAX)) {
      const lu = lireFaite(f);
      if (lu !== null) relancesFaites[cle] = lu;
    }
  }
  return { portes, inscrits, liens, modeles, etapesPar, rythmes, relancesFaites, affichage: lireAffichage(x.affichage) };
}

export class Suivis {
  #monde: Monde;
  #src: SourcesSuivis;
  #changement: () => void;
  #etat: EtatSuivis;
  #enCours = false;

  constructor(monde: Monde, src: SourcesSuivis, o: { etat?: EtatSuivis | null; changement?: () => void } = {}) {
    this.#monde = monde;
    this.#src = src;
    this.#changement = o.changement ?? (() => {});
    this.#etat = lireEtat(o.etat);
  }

  instantane(): EtatSuivis {
    return this.#etat;
  }

  // ---------------------------------------------------------------- lecture du monde

  /** Les fiches que le moteur a le droit de LIRE : tout, sauf ce qu'il a écrit lui-même (sinon il se relirait). */
  #entrees(): readonly ObjetMetier[] {
    return this.#monde.objetsReels().filter((o) => !ecriteParLeMoteur(o));
  }

  #contexte() {
    return contexteDe(this.#monde.maintenant());
  }

  // ---------------------------------------------------------------- les étapes, décidées par l'entreprise

  /**
   * Tous les modèles d'étapes à portée d'un sujet : ceux que l'univers propose (modifiables, recopiables) et ceux
   * que l'entreprise a écrits. Un modèle que l'univers ne reconnaît plus (type masqué, champ retiré) est relu à
   * travers `lireModele` : ses étapes de parcours devenues impossibles redeviennent des étapes à cocher.
   */
  #modeles(sujet: DefSujetSuivi): ModeleEtapes[] {
    const u = this.#monde.univers;
    const siens = this.#etat.modeles
      .filter((m) => m.sujet === sujet.id)
      .map((m) => { const lu = lireModele(m, u); return lu === null ? null : { ...lu, id: m.id }; })
      .filter((m): m is ModeleEtapes => m !== null);
    return [...modelesUnivers(u, sujet), ...siens];
  }

  /** Le modèle choisi pour une fiche ; null quand l'entreprise n'a rien choisi — les étapes de l'univers, alors. */
  #modeleDe(o: ObjetMetier, sujet: DefSujetSuivi): ModeleEtapes | null {
    const id = this.#etat.etapesPar[o.id];
    if (id === undefined) return null;
    return this.#modeles(sujet).find((m) => m.id === id) ?? null;
  }

  /** Tous les suivis de l'entreprise, calculés par le moteur. */
  suivis(): Suivi[] {
    return suivis(this.#monde.univers, this.#entrees(), this.#contexte(), { modele: (o, s) => this.#modeleDe(o, s) });
  }

  #suivi(id: string): { objet: ObjetMetier; suivi: Suivi } | null {
    const objet = this.#monde.objetReel(id);
    if (objet === null || ecriteParLeMoteur(objet)) return null;
    const entrees = this.#entrees();
    const liees = entrees.filter((o) => o.famille === 'tache' && o.champs.concerne === id);
    const def = sujetDe(objet);
    const suivi = suiviDe(this.#monde.univers, objet, this.#contexte(), {
      tachesLiees: liees, objets: entrees, modele: def === null ? null : this.#modeleDe(objet, def),
    });
    return suivi === null ? null : { objet, suivi };
  }

  /** Les situations que « Aujourd'hui » garde, selon les portes choisies. Rien n'est fabriqué : on filtre. */
  situations(liste: readonly Situation[]): Situation[] {
    return situationsRetenues(liste, this.#entrees(), this.#etat.portes);
  }

  #offre(): EtatOffre {
    try { return lireOffre(this.#src.droits()); } catch { return 'sans_offre'; }
  }

  // ---------------------------------------------------------------- réglages des portes

  /** Ce que montre l'écran de suivi : les sujets de l'entreprise, leurs portes, et où ça en est. */
  reglages(_p: Profil) {
    const u = this.#monde.univers;
    const offre = this.#offre();
    const liste = this.suivis();
    const parSujet = new Map<string, Suivi[]>();
    for (const s of liste) parSujet.set(s.sujet, [...(parSujet.get(s.sujet) ?? []), s]);
    const alerte = new Map(portesAlerte(u, this.#etat.portes, SUJETS_ALERTE.map((s) => s.id), this.#src.sujetsAlerte()).map((a) => [a.sujet, a]));
    // le seul verrou de ce module : l'ENVOI AUTOMATIQUE. Partager et préparer restent compris, reliée ou non.
    const verrou = verrouillee(AUTOMATISATION_ENVOI, offre);
    return {
      portes: PORTES,
      sujets: sujetsDeLUnivers(u).map((s) => {
        const choisies = portesDe(this.#etat.portes, s.id);
        const a = alerte.get(s.id);
        return {
          id: s.id,
          libelle: libelleSujet(u, s, 2),
          portes: choisies,
          suivis: (parSujet.get(s.id) ?? []).length,
          /** Le sujet à cocher dans Réglages, Alertes pour que la porte « alerte » serve à quelque chose. */
          sujetAlerte: a ? { id: a.sujetAlerte, coche: a.coche } : null,
          pourLeClient: s.pourLeClient === true,
          /** Les modèles d'étapes à portée de ce sujet, et combien l'entreprise en a écrit elle-même. */
          modeles: this.#modeles(s).map((m) => ({ id: m.id, nom: m.nom, origine: m.origine ?? 'entreprise', etapes: m.etapes.length })),
          /** Les relances qui existent pour ce sujet, avec le rythme retenu. */
          relances: sujetsRelances(s.id).map((r) => ({ id: r.id, libelle: r.libelle, aide: r.aide, rythme: rythmeDe(this.#etat.rythmes, r.id) })),
        };
      }),
      /** Partager un suivi est COMPRIS : rien n'est verrouillé ici, et on le dit. */
      pageClient: { verrouillee: false, motif: null, phraseOffre: phraseOffre(offre) },
      /** L'envoi automatique, lui, est réservé : visible, chiffré, jamais caché (voir `core/offre.ts`). */
      envoiAuto: { verrouillee: verrou, motif: motifVerrou(AUTOMATISATION_ENVOI), phraseOffre: phraseOffre(offre) },
      /** Ce que la page du client dit du retard. « Montrer » par défaut : l'entreprise peut le refermer. */
      affichage: { ...this.#etat.affichage },
      destinataires: DESTINATAIRES.map((d) => ({ id: d, ...defPartage(d) })),
      liens: this.#etat.liens.map((l) => vueLien(l)),
    };
  }

  /**
   * Ce que la page du client dit du retard : « montrer » (le défaut) ou « dire seulement l'étape en cours ».
   * Ce réglage ne touche jamais l'écran de l'entreprise — elle voit son retard, toujours.
   */
  reglerAffichage(p: Profil, d: unknown): AffichageClient {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    this.#etat.affichage = lireAffichage({ ...this.#etat.affichage, ...d });
    this.#changement();
    return { ...this.#etat.affichage };
  }

  // ---------------------------------------------------------------- modèles d'étapes

  /** Les modèles d'un sujet, ceux de l'univers compris, pour l'écran qui les montre et les fait recopier. */
  modeles(p: Profil, sujet: unknown) {
    const id = typeof sujet === 'string' ? sujet : '';
    const def = defSujet(id);
    if (def === undefined) throw new ErreurApi(404, 'sujet_inconnu', 'Ce sujet de suivi n’existe pas.');
    void p;
    return { sujet: id, libelle: libelleSujet(this.#monde.univers, def, 2), modeles: this.#modeles(def) };
  }

  /**
   * Écrire (ou réécrire) un modèle d'étapes. Un modèle de l'univers n'est jamais modifié : le recopier en crée un
   * nouveau, à l'entreprise, qu'elle façonne à sa guise. C'est ce qui fait qu'un changement d'univers ne détruit
   * jamais les étapes qu'elle a écrites.
   */
  enregistrerModele(p: Profil, d: unknown): ModeleEtapes {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const lu = lireModele(d, this.#monde.univers);
    if (lu === null) throw new ErreurApi(400, 'modele_invalide', 'Donnez un nom au modèle et au moins une étape.');
    const vise = estObj(d) && typeof d.id === 'string' && ID_MODELE.test(d.id) ? d.id : '';
    const i = vise === '' ? -1 : this.#etat.modeles.findIndex((m) => m.id === vise);
    if (i >= 0) {
      const ancien = this.#etat.modeles[i] as ModeleEtapes;
      this.#etat.modeles[i] = { ...lu, id: ancien.id, origine: 'entreprise' };
      this.#changement();
      return this.#etat.modeles[i] as ModeleEtapes;
    }
    if (this.#etat.modeles.length >= MODELES_MAX) {
      throw new ErreurApi(409, 'trop_de_modeles', `Vous avez déjà ${MODELES_MAX} modèles d’étapes : retirez-en un avant d’en ajouter.`);
    }
    const m: ModeleEtapes = { ...lu, id: `me-${randomUUID().replace(/-/g, '').slice(0, 12)}`, origine: 'entreprise' };
    this.#etat.modeles.push(m);
    this.#changement();
    return m;
  }

  /** Retirer un modèle. Les fiches qui s'en servaient reviennent aux étapes de l'univers : rien ne casse. */
  supprimerModele(p: Profil, id: unknown): { ok: true; id: string; fiches: number } {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const m = typeof id === 'string' ? this.#etat.modeles.find((x) => x.id === id) : undefined;
    if (m === undefined) throw new ErreurApi(404, 'introuvable');
    this.#etat.modeles = this.#etat.modeles.filter((x) => x.id !== m.id);
    let fiches = 0;
    for (const [fiche, choisi] of Object.entries(this.#etat.etapesPar)) {
      if (choisi !== m.id) continue;
      delete this.#etat.etapesPar[fiche];
      fiches++;
    }
    this.#changement();
    return { ok: true as const, id: m.id, fiches };
  }

  /** Choisir les étapes d'UNE fiche : un modèle, ou rien du tout (celles de l'univers, comme avant). */
  choisirModele(p: Profil, suiviId: unknown, d: unknown): { suiviId: string; modele: string | null; etapes: number } {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit');
    const trouve = this.#suivi(typeof suiviId === 'string' ? suiviId : '');
    if (trouve === null) throw new ErreurApi(404, 'introuvable', 'Cette fiche n’existe pas, ou n’est pas un suivi.');
    const def = defSujet(trouve.suivi.sujet);
    if (def === undefined) throw new ErreurApi(404, 'introuvable');
    const voulu = estObj(d) ? d.modele : null;
    if (voulu === null || voulu === undefined || voulu === '') {
      delete this.#etat.etapesPar[trouve.objet.id];
      this.#changement();
      const sans = this.#suivi(trouve.objet.id);
      return { suiviId: trouve.objet.id, modele: null, etapes: sans?.suivi.etapes.length ?? 0 };
    }
    const m = this.#modeles(def).find((x) => x.id === voulu);
    if (m === undefined) throw new ErreurApi(404, 'modele_inconnu', 'Ce modèle d’étapes n’existe pas pour ce sujet.');
    this.#etat.etapesPar[trouve.objet.id] = m.id;
    this.#changement();
    const apres = this.#suivi(trouve.objet.id);
    return { suiviId: trouve.objet.id, modele: m.id, etapes: apres?.suivi.etapes.length ?? 0 };
  }

  // ---------------------------------------------------------------- les relances

  /** Le rythme d'une relance : au bout de combien de jours, tous les combien, et combien de fois au plus. */
  reglerRythme(p: Profil, id: unknown, d: unknown): { relance: string; rythme: Rythme } {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const def = typeof id === 'string' ? defRelance(id) : undefined;
    if (def === undefined) throw new ErreurApi(404, 'relance_inconnue', 'Cette relance n’existe pas.');
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const rythme = lireRythme(d.rythme ?? d, def.defaut);
    this.#etat.rythmes[def.id] = rythme;
    this.#changement();
    return { relance: def.id, rythme };
  }

  /**
   * Les relances dues aujourd'hui, sans écran et sans profil : c'est ce que `alertes.ts` annonce et ce que
   * `automatisations.ts` transforme en tâche. Un seul calcul, partagé — plus de délai compté deux fois ailleurs.
   */
  relancesPreparees(): Relance[] {
    return relancesDues(this.suivis(), this.#etat.rythmes, this.#etat.relancesFaites, this.#contexte(), {
      entreprise: this.#monde.organisation.nom,
    });
  }

  /** Les relances préparées aujourd'hui, et ce qu'il faut savoir pour décider : le rythme, et ce qui est compris. */
  relances(p: Profil) {
    void p;
    const offre = this.#offre();
    const liste = this.suivis();
    const dues = relancesDues(liste, this.#etat.rythmes, this.#etat.relancesFaites, this.#contexte(), {
      entreprise: this.#monde.organisation.nom,
    });
    // une relance qui ne vaut plus rien (facture payée, devis répondu, étape terminée) oublie son compteur
    const vivantes = relancesPossibles(liste);
    const aOublier = oublis(this.#etat.relancesFaites, vivantes);
    if (aOublier.length > 0) {
      for (const c of aOublier) delete this.#etat.relancesFaites[c];
      this.#changement();
    }
    const verrou = verrouillee(AUTOMATISATION_ENVOI, offre);
    return {
      relances: dues.filter((r) => this.#monde.estVisible(p, r.suiviId)),
      sujets: RELANCES.map((r) => ({
        id: r.id, libelle: r.libelle, aide: r.aide, vers: r.vers, rythme: rythmeDe(this.#etat.rythmes, r.id), defaut: r.defaut,
      })),
      /** Préparer une relance est COMPRIS, et ne dépend d'aucun abonnement : c'est vérifié, pas affirmé. */
      compris: !verrouillee(AUTOMATISATION_RELANCES, offre),
      /** Envoyer sans personne relève de l'offre, et c'est dit une seule fois. */
      envoiAuto: { verrouillee: verrou, motif: motifVerrou(AUTOMATISATION_ENVOI), phraseOffre: phraseOffre(offre) },
    };
  }

  /**
   * « C'est envoyé. » Une personne a relu la relance et l'a envoyée : le moteur le note, et ne la repropose pas
   * avant le délai réglé. C'est tout l'anti-doublon — et c'est pour cela qu'une relance ne part jamais deux fois.
   */
  relanceEnvoyee(p: Profil, cle: unknown): { cle: string; fois: number; prochaine: string | null } {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit');
    const id = typeof cle === 'string' ? cle : '';
    const due = relancesDues(this.suivis(), this.#etat.rythmes, this.#etat.relancesFaites, this.#contexte())
      .find((r) => r.cle === id);
    if (due === undefined) throw new ErreurApi(404, 'introuvable', 'Cette relance n’est plus à faire : elle a déjà été notée, ou il n’y a plus rien à relancer.');
    if (!this.#monde.estVisible(p, due.suiviId)) throw new ErreurApi(403, 'interdit');
    const jour = this.#contexte().aujourdhui;
    this.#etat.relancesFaites[id] = { fois: due.fois, dernierJour: jour };
    this.#monde.tracer(p, 'suivi.relance', due.suiviId, `relance ${due.fois} notée pour « ${due.nom.slice(0, 80)} »`);
    this.#changement();
    const rythme = rythmeDe(this.#etat.rythmes, due.relance);
    const reste = due.fois < rythme.maxFois;
    return { cle: id, fois: due.fois, prochaine: reste ? `dans ${rythme.tousLesJours} jours` : null };
  }

  /** L'entreprise choisit ses portes, sujet par sujet. Tout décocher est un choix : plus rien ne sort pour ce sujet. */
  regler(p: Profil, sujet: unknown, d: unknown): { sujet: string; portes: readonly Porte[] } {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const id = typeof sujet === 'string' ? sujet : '';
    if (defSujet(id) === undefined) throw new ErreurApi(404, 'sujet_inconnu', 'Ce sujet de suivi n’existe pas.');
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const portes = lirePortes(d.portes);
    this.#etat.portes[id] = [...portes];
    this.#changement();
    return { sujet: id, portes };
  }

  // ---------------------------------------------------------------- la passe : faire exister, et défaire

  /**
   * Une passe. Compare ce qui DOIT exister (le moteur) à ce qui existe (le registre) : crée ce qui manque, met à jour
   * ce qui a changé, retire ce qui n'est plus dû. Repasser sans rien changer ne fait rien du tout — c'est l'essai.
   */
  passer(): { crees: number; majs: number; retires: number } {
    if (this.#enCours) return { crees: 0, majs: 0, retires: 0 };
    this.#enCours = true;
    let crees = 0;
    let majs = 0;
    let retires = 0;
    try {
      const dues = sorties(this.suivis(), this.#etat.portes).slice(0, SORTIES_MAX);
      const parCle = new Map(dues.map((s) => [s.cle, s]));

      // ce qui n'est plus dû (échéance annulée, réglée, porte décochée) : la fiche écrite pour elle est retirée
      for (const [cle, inscrit] of Object.entries(this.#etat.inscrits)) {
        if (parCle.has(cle)) continue;
        if (this.#monde.objetReel(inscrit.objetId) !== null) {
          this.#monde.retirerObjetsSysteme(`${SOURCE}:retrait`, [inscrit.objetId], inscrit.porte === 'agenda' ? 'rendez-vous d’échéance retirés' : 'tâches d’échéance retirées');
          retires++;
        }
        delete this.#etat.inscrits[cle];
      }

      for (const s of dues) {
        const empreinte = empreinteSortie(s);
        const inscrit = this.#etat.inscrits[s.cle];
        const vivant = inscrit !== undefined && this.#monde.objetReel(inscrit.objetId) !== null;
        if (vivant && (inscrit as Inscrit).empreinte === empreinte) continue; // rien n'a changé : on ne touche à rien
        if (vivant) {
          this.#monde.majObjetSysteme(`${SOURCE}:${s.sujet}`, (inscrit as Inscrit).objetId, this.#champs(s));
          this.#etat.inscrits[s.cle] = { ...(inscrit as Inscrit), empreinte };
          majs++;
          continue;
        }
        const objetId = this.#monde.creerObjetSysteme(
          `${SOURCE}:${s.sujet}`, s.porte === 'agenda' ? 'rendez_vous' : 'tache', s.titre, this.#champs(s), sourceDe(s.sujet),
        );
        this.#etat.inscrits[s.cle] = { objetId, empreinte, porte: s.porte };
        crees++;
      }
    } finally {
      this.#enCours = false;
    }
    if (crees || majs || retires) this.#changement();
    return { crees, majs, retires };
  }

  /** Les champs de la fiche écrite pour une sortie. Jamais un montant : un agenda partagé n'est pas un carnet de prix. */
  #champs(s: Sortie): Record<string, ValeurChamp> {
    const suivi = this.#monde.objetReel(s.suiviId);
    const departement = suivi !== null && typeof suivi.champs.departement === 'string' ? suivi.champs.departement : null;
    if (s.porte === 'agenda') {
      const champs: Record<string, ValeurChamp> = { debut: s.jour, fin: s.jour, concerne: s.suiviId, etat: 'à confirmer' };
      if (s.responsable !== null) champs.pour = s.responsable;
      return champs;
    }
    const champs: Record<string, ValeurChamp> = { echeance: s.jour, concerne: s.suiviId, statut: 'à faire' };
    if (s.responsable !== null) champs.responsable = s.responsable;
    if (departement !== null) champs.departement = departement;
    return champs;
  }

  /** Une fiche effacée : le moteur l'oublie, et oublie aussi ce qu'il avait écrit pour elle. */
  oublierObjet(id: string): void {
    let change = false;
    for (const [cle, inscrit] of Object.entries(this.#etat.inscrits)) {
      if (!cle.includes(`:${id}:`) && inscrit.objetId !== id) continue;
      delete this.#etat.inscrits[cle];
      change = true;
    }
    // les étapes choisies pour elle et les relances déjà parties s'en vont avec elle
    if (this.#etat.etapesPar[id] !== undefined) { delete this.#etat.etapesPar[id]; change = true; }
    for (const cle of Object.keys(this.#etat.relancesFaites)) {
      if (!cle.includes(`:${id}:`)) continue;
      delete this.#etat.relancesFaites[cle];
      change = true;
    }
    const avant = this.#etat.liens.length;
    this.#etat.liens = this.#etat.liens.filter((l) => l.suiviId !== id);
    if (change || this.#etat.liens.length !== avant) this.#changement();
  }

  // ---------------------------------------------------------------- le lien partagé au client

  /**
   * Crée un lien de suivi. Le jeton n'est rendu QU'ICI, une seule fois : seule son empreinte est gardée.
   *
   * PARTAGER EST COMPRIS, et rien ici ne demande l'offre. Le lien n'envoie rien tout seul : l'entreprise le crée,
   * le colle dans son message et l'envoie elle-même. Ce qui relève de l'offre est l'ENVOI AUTOMATIQUE à chaque
   * étape (`AUTOMATISATION_ENVOI`), demandé là où il se règle — pas à la création d'un lien.
   */
  creerLien(p: Profil, suiviId: unknown, d: unknown = {}): { lien: VueLien; adresse: string | null; jeton: string } {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit');
    const id = typeof suiviId === 'string' ? suiviId : '';
    const trouve = this.#suivi(id);
    if (trouve === null) throw new ErreurApi(404, 'introuvable', 'Cette fiche n’existe pas, ou n’est pas un suivi.');
    const def = defSujet(trouve.suivi.sujet);
    if (def?.pourLeClient !== true) {
      throw new ErreurApi(409, 'sans_page_client', 'Ce sujet-là ne se partage pas avec un client : il ne regarde que votre entreprise.');
    }
    if (this.#etat.liens.length >= LIENS_MAX) throw new ErreurApi(409, 'trop_de_liens', 'Trop de liens de suivi : retirez-en avant d’en créer.');
    // un seul lien vivant par suivi : en recréer un retire le précédent, pour qu'il n'en traîne pas deux
    for (const ancien of this.#etat.liens) if (ancien.suiviId === id && ancien.revoqueLe === null) ancien.revoqueLe = this.#monde.maintenant().toISOString();
    const jeton = randomBytes(32).toString('base64url');
    // la demande d'avis de la fin, si l'entreprise la veut : préparée par le mécanisme qui existe déjà (`enquetes.ts`)
    const client = trouve.suivi.destinataire;
    const avis = estObj(d) && d.avis === true && client !== null ? this.#src.inviterAvis?.(p, client) ?? null : null;
    const lien: LienSuivi = {
      id: `sv-${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      empreinte: empreinteJeton(jeton), orgId: trouve.objet.orgId, suiviId: id,
      creeLe: this.#monde.maintenant().toISOString(), creePar: p.id,
      revoqueLe: null, ouvertLe: null, dernierLe: null, ouvertures: 0, lienAvis: avis,
    };
    this.#etat.liens.push(lien);
    this.#monde.tracer(p, 'suivi.lien_cree', id, `page de suivi partagée pour « ${trouve.objet.nom.slice(0, 80)} »`);
    this.#changement();
    return { lien: vueLien(lien), adresse: this.#adresse(jeton), jeton };
  }

  /**
   * LE BOUTON « PARTAGER », en un geste. Il crée le lien de suivi et PRÉPARE le message — à son client, à son
   * fournisseur, à son comptable — que l'entreprise n'a plus qu'à relire et à envoyer. Les trois garde-fous du lien
   * sont les mêmes pour les trois destinataires (`core/suivi-client.ts`) : rien d'une autre entreprise, aucun prix
   * ni marge, lien révocable. Et c'est COMPRIS : aucun abonnement n'est demandé ici.
   */
  partager(p: Profil, suiviId: unknown, d: unknown = {}): {
    lien: VueLien; adresse: string | null; jeton: string; pour: string;
    objet: string; message: string; libelle: string; retrait: string;
  } {
    const pour = estObj(d) && estDestinatairePartage(d.pour) ? d.pour : 'client';
    const cree = this.creerLien(p, suiviId, d);
    const nom = this.#monde.objetReel(typeof suiviId === 'string' ? suiviId : '')?.nom ?? '';
    const t = messagePartage(pour, nom, cree.adresse, { entreprise: this.#monde.organisation.nom });
    return {
      ...cree, pour, libelle: defPartage(pour).libelle, objet: t.objet, message: t.message,
      retrait: 'Vous pouvez retirer ce lien à tout moment : la page ne montre alors plus rien.',
    };
  }

  /** L'adresse à envoyer au client ; null quand l'adresse publique du jeu n'est pas connue. */
  #adresse(jeton: string): string | null {
    const base = this.#src.adresse();
    return base === null ? null : `${base.replace(/\/$/, '')}/s/${jeton}`;
  }

  /**
   * Reprendre un lien. Une page révoquée ne montre plus rien : ni le nom du client, ni l'étape en cours. Le lien
   * reste dans la liste, marqué retiré — l'entreprise doit pouvoir constater qu'elle l'a bien reprise.
   */
  revoquerLien(p: Profil, id: unknown): VueLien {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit');
    const l = this.#etat.liens.find((x) => x.id === id);
    if (l === undefined) throw new ErreurApi(404, 'introuvable');
    if (l.revoqueLe === null) {
      l.revoqueLe = this.#monde.maintenant().toISOString();
      this.#monde.tracer(p, 'suivi.lien_retire', l.suiviId, 'page de suivi retirée : le lien ne montre plus rien');
      this.#changement();
    }
    return vueLien(l);
  }

  /** Les liens d'un suivi, vus de l'intérieur (jamais le jeton). */
  liensDe(suiviId: string): VueLien[] {
    return this.#etat.liens.filter((l) => l.suiviId === suiviId).map((l) => vueLien(l));
  }

  #parJeton(jeton: unknown): LienSuivi | null {
    if (typeof jeton !== 'string' || !JETON.test(jeton)) return null;
    const e = empreinteJeton(jeton);
    return this.#etat.liens.find((l) => l.empreinte === e) ?? null;
  }

  /**
   * La page que le client ouvre. Aucune session : le jeton seul, et il ne donne accès qu'à SON suivi.
   * `noter` est faux pour une simple prévisualisation côté entreprise (on ne lui compte pas une ouverture du client).
   */
  page(jeton: unknown, { noter = true } = {}): PageClient | PageRefusee {
    const lien = this.#parJeton(jeton);
    if (lien === null) return pageFermee('introuvable');
    if (lien.revoqueLe !== null) return pageFermee('revoque');
    const trouve = this.#suivi(lien.suiviId);
    const page = pageClient(
      this.#monde.univers, lien, trouve?.objet ?? null, trouve?.suivi ?? null,
      this.#monde.organisation.nom,
      { photos: this.#photos(lien.suiviId), lienAvis: lien.lienAvis ?? null },
      this.#etat.affichage,
    );
    // deuxième verrou du garde-fou : si un chiffre interne a trouvé un chemin jusque-là, la page se ferme
    if (page.etat === 'ouverte' && fuite(page).length > 0) return pageFermee('introuvable');
    if (noter && page.etat === 'ouverte') {
      const le = this.#monde.maintenant().toISOString();
      lien.ouvertLe ??= le;
      lien.dernierLe = le;
      lien.ouvertures++;
      this.#changement();
    }
    return page;
  }

  /**
   * Les images attachées au suivi : les fiches rattachées (`concerne`) dont le champ `lien` est une adresse https
   * d'image. Aucun champ n'a été ajouté à l'univers pour cela — ce qui arrive par une autre route (une photo prise
   * au téléphone, par exemple) entre par le même chemin, sans rien changer ici.
   */
  #photos(suiviId: string): { lien: string; le: string | null }[] {
    const res: { lien: string; le: string | null }[] = [];
    for (const o of this.#monde.objetsReels()) {
      if (o.champs.concerne !== suiviId) continue;
      const lien = typeof o.champs.lien === 'string' ? o.champs.lien : '';
      if (!lien.startsWith('https://') || !EXTENSION_IMAGE.test(lien)) continue;
      const le = typeof o.champs.recu_le === 'string' ? o.champs.recu_le : typeof o.champs.fait_le === 'string' ? o.champs.fait_le : null;
      res.push({ lien, le: le === null ? null : le.slice(0, 10) });
    }
    return res.sort((a, b) => String(a.le ?? '').localeCompare(String(b.le ?? ''))).slice(0, 24);
  }

  /** Ce que l'écran de l'entreprise montre d'un suivi : ses étapes, son client, et l'état de son lien. */
  fiche(p: Profil, id: unknown) {
    const trouve = this.#suivi(typeof id === 'string' ? id : '');
    if (trouve === null) throw new ErreurApi(404, 'introuvable');
    if (!this.#monde.estVisible(p, trouve.objet.id)) throw new ErreurApi(403, 'interdit');
    const { objet, suivi } = trouve;
    const def = defSujet(suivi.sujet);
    const dues = relancesDues(this.suivis(), this.#etat.rythmes, this.#etat.relancesFaites, this.#contexte(), {
      entreprise: this.#monde.organisation.nom,
    });
    return {
      id: objet.id, sujet: suivi.sujet, libelleSujet: suivi.libelleSujet, nom: objet.nom,
      etat: suivi.etat, termine: suivi.termine, etapes: suivi.etapes,
      destinataire: suivi.destinataire, responsable: suivi.responsable,
      portes: portesDe(this.#etat.portes, suivi.sujet),
      /** Partager n'est jamais verrouillé : c'est vrai pour tous les sujets qui regardent quelqu'un de dehors. */
      pourLeClient: def?.pourLeClient === true,
      liens: this.liensDe(objet.id),
      /** Les étapes de CETTE fiche : le modèle choisi, et ceux qu'elle peut prendre. */
      modele: suivi.modele,
      modeles: def === undefined ? [] : this.#modeles(def).map((m) => ({ id: m.id, nom: m.nom, origine: m.origine ?? 'entreprise', etapes: m.etapes.length })),
      /** Ce qu'il y a à relancer sur cette fiche, préparé et prêt à relire. */
      relances: dues.filter((r) => r.suiviId === objet.id),
      /** À qui elle peut partager ce suivi, et avec quel message. */
      destinataires: DESTINATAIRES.map((x) => ({ id: x, ...defPartage(x) })),
    };
  }
}

/** Empreinte de ce qu'une sortie met dans sa fiche : si elle ne change pas, on ne réécrit rien. */
function empreinteSortie(s: Sortie): string {
  return createHash('sha256').update(JSON.stringify([s.porte, s.titre, s.jour, s.responsable])).digest('base64url').slice(0, 22);
}

export { sujetDe };
