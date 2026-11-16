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
  contexteDe, defSujet, libelleSujet, lirePortes, PORTES, portesAlerte, portesDe, situationsRetenues, sorties, suiviDe,
  suivis, sujetDe, sujetsDeLUnivers, type ChoixPortes, type Porte, type Sortie, type Suivi,
} from '../core/suivi.ts';
import { fuite, pageClient, pageFermee, vueLien, type LienSuivi, type PageClient, type PageRefusee, type VueLien } from '../core/suivi-client.ts';
import type { Situation } from '../core/situation.ts';
import type { Profil } from '../demo/donnees.ts';

/**
 * Identifiant de l'automatisation qui porte la page de suivi, au sens de `core/offre.ts`. Il n'est pas dans
 * `GRATUITES` : publier la page et envoyer le lien demandent donc l'offre, comme tout ce qui sort vers un client.
 */
export const AUTOMATISATION_PAGE = 'page-suivi';

/** Préfixe des sources des fiches que le moteur écrit. Il sert aussi à ne JAMAIS les relire comme des étapes. */
export const SOURCE = 'suivi';
const sourceDe = (sujet: string) => ({ id: `${SOURCE}:${sujet}`, libelle: `Suivi — ${sujet}` });
/** Une fiche écrite par le moteur : on la reconnaît à sa source, et on ne la reprend jamais pour une donnée d'entrée. */
export const ecriteParLeMoteur = (o: ObjetMetier): boolean => o.source.id === SOURCE || o.source.id.startsWith(`${SOURCE}:`);

const ID_LIEN = /^sv-[a-f0-9]{12}$/;
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
}

/** Un état vide NEUF à chaque appel : deux installations ne doivent jamais partager le même objet. */
const etatVide = (): EtatSuivis => ({ portes: {}, inscrits: {}, liens: [] });

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
  return { portes, inscrits, liens };
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

  /** Tous les suivis de l'entreprise, calculés par le moteur. */
  suivis(): Suivi[] {
    return suivis(this.#monde.univers, this.#entrees(), this.#contexte());
  }

  #suivi(id: string): { objet: ObjetMetier; suivi: Suivi } | null {
    const objet = this.#monde.objetReel(id);
    if (objet === null || ecriteParLeMoteur(objet)) return null;
    const entrees = this.#entrees();
    const liees = entrees.filter((o) => o.famille === 'tache' && o.champs.concerne === id);
    const suivi = suiviDe(this.#monde.univers, objet, this.#contexte(), { tachesLiees: liees, objets: entrees });
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
    const verrou = verrouillee(AUTOMATISATION_PAGE, offre);
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
        };
      }),
      /** La page de suivi d'un client : comprise ou réservée, et pourquoi, dit une seule fois. */
      pageClient: { verrouillee: verrou, motif: verrou ? motifVerrou(AUTOMATISATION_PAGE) : null, phraseOffre: phraseOffre(offre) },
      liens: this.#etat.liens.map((l) => vueLien(l)),
    };
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
    const avant = this.#etat.liens.length;
    this.#etat.liens = this.#etat.liens.filter((l) => l.suiviId !== id);
    if (change || this.#etat.liens.length !== avant) this.#changement();
  }

  // ---------------------------------------------------------------- le lien partagé au client

  /**
   * Crée un lien de suivi pour un client. Le jeton n'est rendu QU'ICI, une seule fois : seule son empreinte est
   * gardée. Publier cette page relève de l'offre (`core/offre.ts`) : sans elle, rien n'est créé.
   */
  creerLien(p: Profil, suiviId: unknown, d: unknown = {}): { lien: VueLien; adresse: string | null; jeton: string } {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit');
    const offre = this.#offre();
    if (verrouillee(AUTOMATISATION_PAGE, offre)) {
      throw new ErreurApi(402, 'offre_requise', motifVerrou(AUTOMATISATION_PAGE));
    }
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
    return {
      id: objet.id, sujet: suivi.sujet, libelleSujet: suivi.libelleSujet, nom: objet.nom,
      etat: suivi.etat, termine: suivi.termine, etapes: suivi.etapes,
      destinataire: suivi.destinataire, responsable: suivi.responsable,
      portes: portesDe(this.#etat.portes, suivi.sujet),
      pourLeClient: def?.pourLeClient === true,
      liens: this.liensDe(objet.id),
    };
  }
}

/** Empreinte de ce qu'une sortie met dans sa fiche : si elle ne change pas, on ne réécrit rien. */
function empreinteSortie(s: Sortie): string {
  return createHash('sha256').update(JSON.stringify([s.porte, s.titre, s.jour, s.responsable])).digest('base64url').slice(0, 22);
}

export { sujetDe };
