/**
 * Satisfaction des clients et baromètre des collaborateurs.
 * - Un formulaire = un lien personnel à usage unique (jeton aléatoire 192 bits, seule son empreinte est gardée),
 *   valable 30 jours. Un avis client est DATÉ et devient un objet du monde (« avis client »).
 * - Collaborateurs (anonymat réel, pas seulement affiché) :
 *   · la réponse n'est JAMAIS un objet du monde (ni /monde, ni /objets, ni MCP, ni connecteurs, ni journal) : elle va
 *     dans un magasin à part, sans nom, sans lien avec l'invitation, datée au mois, rangée dans un ordre aléatoire ;
 *   · l'invitation ne garde ni la personne ni l'heure de réponse ; le lien ne dit jamais s'il a déjà servi (une seconde
 *     réponse est ignorée en silence), pour que la direction, qui détient les liens, ne puisse pas savoir qui a répondu ;
 *   · rien n'est montré sous ANONYMAT_MIN (5) réponses, et les réponses sont publiées PAR LOTS d'au moins 5 (toute
 *     l'équipe d'un côté, chaque département de l'autre) : comparer deux affichages ne révèle jamais une réponse seule ;
 *   · commentaires seulement à partir de 10 réponses publiées, sans département, datés au mois ;
 *   · un seul lien par fiche et par période de 30 jours, et pas pour une fiche créée depuis moins de 30 jours : la
 *     direction ne peut plus se fabriquer quatre liens pour isoler, par soustraction, la réponse d'une cinquième
 *     personne (contre-revue de l'audit, constat revue-jeu-1-1). Le registre de ces envois (fiche et jour) est à part
 *     des invitations, sans lien avec le jeton. Limite dite aux salariés : la direction crée et transmet les liens ;
 *     rien n'empêche techniquement quelqu'un qui détient un lien de répondre à la place de son destinataire ;
 *   · effacement automatique après 400 jours (13 mois).
 * - Page publique sans session : seul le jeton donne accès, et uniquement à ce formulaire.
 */
import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import type { ObjetMetier } from '../core/model.ts';
import type { Profil } from '../demo/donnees.ts';
import { ErreurApi, type Monde } from './monde.ts';

export type GenreEnquete = 'client' | 'collaborateur';

interface Invitation {
  id: string;
  empreinte: string;
  genre: GenreEnquete;
  cible: string; // tiers ; vide pour un collaborateur (la personne n'est jamais gardée avec l'invitation)
  departement: string | null;
  creeLe: string;
  expire: string;
  envoyeePar: string;
  repondueLe: string | null; // client : date et heure ; collaborateur : le mois seulement (« AAAA-MM »)
}

/** Réponse au baromètre : ni nom, ni heure, ni lien avec l'invitation. */
export interface ReponseBarometre {
  recu: string; // mois de réception « AAAA-MM » (purge seulement, jamais affiché)
  departement: string | null;
  note: number;
  charge: number | null;
  commentaire: string | null;
  global: string | null; // mois de publication dans les résultats de l'équipe (lot ≥ 5) ; null = en attente
  service: string | null; // mois de publication dans les résultats de son département (lot ≥ 5) ; null = en attente
}

/** Lien de baromètre créé pour une fiche : la fiche et le JOUR, rien du jeton ni de l'invitation. */
interface EnvoiBarometre { fiche: string; le: string }

export interface EtatEnquetes {
  invitations: Invitation[];
  barometre?: ReponseBarometre[];
  envoisBarometre?: EnvoiBarometre[];
}

const JOUR = 86_400_000;
const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest('base64url');
const estObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
/** Seuil d'anonymat : aucun résultat du baromètre (moyenne, commentaire, compte) sous ce nombre de réponses. */
export const ANONYMAT_MIN = 5;
/** Commentaires du baromètre : montrés seulement à partir de ce nombre de réponses publiées. */
export const COMMENTAIRES_MIN = 10;
/** Un lien de baromètre par fiche sur cette durée, et aucun pour une fiche créée depuis moins longtemps (jours). */
export const BAROMETRE_DELAI_JOURS = 30;
/** Conservation des réponses au baromètre et des invitations (13 mois environ), puis effacement automatique. */
export const CONSERVATION_JOURS = 400;
const moisDe = (d: Date) => d.toISOString().slice(0, 7);
const estMois = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}$/.test(x);
const melanger = <T>(l: T[]) => { for (let i = l.length - 1; i > 0; i--) { const j = randomInt(i + 1); [l[i], l[j]] = [l[j] as T, l[i] as T]; } return l; };

function lireReponse(x: unknown): ReponseBarometre | null {
  if (!estObj(x) || !estMois(x.recu) || typeof x.note !== 'number') return null;
  return {
    recu: x.recu, departement: typeof x.departement === 'string' ? x.departement : null, note: x.note,
    charge: typeof x.charge === 'number' ? x.charge : null, commentaire: typeof x.commentaire === 'string' ? x.commentaire : null,
    global: estMois(x.global) ? x.global : null, service: estMois(x.service) ? x.service : null,
  };
}

export class Enquetes {
  #invitations: Invitation[] = [];
  #reponses: ReponseBarometre[] = [];
  #envois: EnvoiBarometre[] = [];
  #monde: Monde;
  #changement: () => void;
  #essais = new Map<string, { n: number; depuis: number }>();

  constructor(monde: Monde, o: { etat?: EtatEnquetes | null; changement?: () => void } = {}) {
    this.#monde = monde;
    this.#changement = o.changement ?? (() => {});
    this.#invitations = Array.isArray(o.etat?.invitations) ? (o.etat as EtatEnquetes).invitations : [];
    this.#reponses = Array.isArray(o.etat?.barometre) ? o.etat.barometre.map(lireReponse).filter((r): r is ReponseBarometre => r !== null) : [];
    this.#envois = Array.isArray(o.etat?.envoisBarometre)
      ? o.etat.envoisBarometre.filter((e): e is EnvoiBarometre => estObj(e) && typeof e.fiche === 'string' && typeof e.le === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.le)) : [];
    this.#rendreAnonymeLAncien();
  }

  /**
   * Pourquoi un lien de baromètre ne peut pas être créé pour cette fiche maintenant, ou null. Deux garde-fous contre
   * l'isolement d'une réponse par soustraction : un lien par fiche et par 30 jours ; pas de lien pour une fiche créée
   * depuis moins de 30 jours (une fiche créée pour l'occasion donnerait un lien de plus à celui qui la crée).
   */
  #refusBarometre(id: string): { code: string; message: string } | null {
    const maintenant = this.#monde.maintenant().getTime();
    const limite = maintenant - BAROMETRE_DELAI_JOURS * JOUR;
    if (this.#envois.some((e) => e.fiche === id && Date.parse(`${e.le}T00:00:00Z`) > limite - JOUR)) {
      return { code: 'barometre_deja_envoye', message: `Un lien de baromètre a déjà été créé pour cette personne il y a moins de ${BAROMETRE_DELAI_JOURS} jours : un seul lien par personne et par période, pour que personne ne réponde plusieurs fois.` };
    }
    if (this.#monde.journalBrut().some((l) => l.action === 'objet.cree' && l.cible === id && Date.parse(l.le) > limite)) {
      return { code: 'barometre_fiche_recente', message: `Cette fiche a été créée il y a moins de ${BAROMETRE_DELAI_JOURS} jours : le baromètre s’envoie aux personnes présentes depuis au moins ${BAROMETRE_DELAI_JOURS} jours.` };
    }
    return null;
  }

  /**
   * Données d'avant l'anonymat réel : invitations des collaborateurs détachées de la personne (mois seulement) et
   * réponses individuelles retirées du monde, versées au magasin anonyme puis publiées selon les mêmes règles.
   */
  #rendreAnonymeLAncien() {
    let change = false;
    for (const i of this.#invitations) {
      if (i.genre !== 'collaborateur') continue;
      if (i.cible) { i.cible = ''; change = true; }
      if (i.repondueLe && !/^\d{4}-\d{2}$/.test(i.repondueLe)) { i.repondueLe = i.repondueLe.slice(0, 7); change = true; }
    }
    const anciens = this.#monde.objetsReels().filter((o) => o.type === 'barometre' && o.source.id === 'formulaire' && o.mode === 'reel');
    if (anciens.length) {
      for (const o of anciens) {
        const recu = typeof o.champs.recu_le === 'string' && /^\d{4}-\d{2}/.test(o.champs.recu_le) ? o.champs.recu_le.slice(0, 7) : o.majLe.slice(0, 7);
        this.#reponses.push({
          recu, departement: typeof o.champs.departement === 'string' ? o.champs.departement : null, note: Number(o.champs.note) || 0,
          charge: typeof o.champs.charge === 'number' ? o.champs.charge : null, commentaire: typeof o.champs.commentaire === 'string' ? o.champs.commentaire : null,
          global: null, service: null,
        });
      }
      this.#monde.retirerObjetsSysteme('formulaire', anciens.map((o) => o.id), 'réponses au baromètre rendues anonymes');
      this.#publier();
      change = true;
    }
    if (change) this.#changement();
  }

  /** Droit d'accès : formulaires envoyés à cette fiche (genre et dates, jamais le lien). */
  invitationsDe(id: string): { genre: string; envoyeLe: string; reponduLe: string | null }[] {
    return this.#invitations.filter((i) => i.cible === id).map((i) => ({ genre: i.genre, envoyeLe: i.creeLe, reponduLe: i.repondueLe }));
  }

  /** Fiche effacée (droit à l'effacement) : ses invitations disparaissent (le lien ne marche plus). */
  oublierObjet(id: string): void {
    const n = this.#invitations.length + this.#envois.length;
    this.#invitations = this.#invitations.filter((i) => i.cible !== id);
    this.#envois = this.#envois.filter((e) => e.fiche !== id);
    if (this.#invitations.length + this.#envois.length !== n) this.#changement();
  }

  instantane(): EtatEnquetes {
    const maintenant = this.#monde.maintenant().getTime();
    const limite = maintenant - CONSERVATION_JOURS * JOUR;
    const moisLimite = moisDe(new Date(limite));
    return {
      invitations: this.#invitations.filter((i) => Date.parse(i.creeLe) > limite),
      barometre: this.#reponses.filter((r) => r.recu >= moisLimite),
      envoisBarometre: this.#envois.filter((e) => Date.parse(`${e.le}T00:00:00Z`) > limite),
    };
  }

  /**
   * Publie les réponses en attente par lots d'au moins ANONYMAT_MIN : toute l'équipe d'un côté, chaque département
   * de l'autre. Le magasin est ensuite mélangé : l'ordre ne dit rien de l'ordre d'arrivée.
   */
  #publier() {
    const mois = moisDe(this.#monde.maintenant());
    const enAttente = this.#reponses.filter((r) => !r.global);
    if (enAttente.length >= ANONYMAT_MIN) for (const r of enAttente) r.global = mois;
    const parDep = new Map<string, ReponseBarometre[]>();
    for (const r of this.#reponses) {
      if (r.service || !r.departement) continue;
      parDep.set(r.departement, [...(parDep.get(r.departement) ?? []), r]);
    }
    for (const l of parDep.values()) if (l.length >= ANONYMAT_MIN) for (const r of l) r.service = mois;
    melanger(this.#reponses);
  }

  /** Mois à partir duquel une publication est « récente » (fenêtre de 120 jours, mois entiers). */
  #depuis(): string {
    return moisDe(new Date(this.#monde.maintenant().getTime() - 120 * JOUR));
  }

  /**
   * Réponses publiées, réduites à ce que le score de santé et les pistes d'optimisation utilisent (note, charge, mois
   * de publication) : objets éphémères, jamais enregistrés ni renvoyés par l'API, sans département ni commentaire.
   */
  objetsSante(): ObjetMetier[] {
    return this.#reponses.filter((r) => r.global).map((r, i) => ({
      id: `barometre-publie-${i}`, orgId: 'org', famille: 'evenement', type: 'barometre', roles: [], nom: 'Baromètre (résultat anonyme)',
      champs: { note: r.note, ...(r.charge !== null ? { charge: r.charge } : {}), recu_le: `${r.global}-01` },
      provenance: 'declare', source: { id: 'formulaire', libelle: 'Baromètre collaborateurs (anonyme)', derniereSynchro: null },
      majLe: `${r.global}-01T00:00:00.000Z`, disponibilite: 'disponible', mode: 'reel',
    }) as ObjetMetier);
  }

  #genreDe(id: string): GenreEnquete | null {
    const o = this.#monde.objetReel(id);
    if (!o) return null;
    if (o.famille === 'personne') return 'collaborateur';
    if (o.famille === 'tiers') return 'client';
    return null;
  }

  /** Crée un lien de formulaire pour un client ou un collaborateur. Le jeton n'est renvoyé qu'ici. */
  inviter(p: Profil, cible: unknown, origine: string, acteur = p.id) {
    if (!p.peutPreparer) throw new ErreurApi(403, 'interdit');
    if (!this.#monde.estVisible(p, cible)) throw new ErreurApi(404, 'introuvable');
    const id = cible as string;
    const genre = this.#genreDe(id);
    if (!genre) throw new ErreurApi(400, 'cible_invalide', 'Un formulaire s’envoie à un client (ou autre tiers) ou à un collaborateur.');
    if (genre === 'collaborateur' && !p.peutAdministrer) throw new ErreurApi(403, 'interdit', 'Le baromètre collaborateurs est envoyé par la direction ou les RH.');
    if (genre === 'collaborateur') { const refus = this.#refusBarometre(id); if (refus) throw new ErreurApi(409, refus.code, refus.message); }
    const o = this.#monde.objetReel(id);
    const maintenant = this.#monde.maintenant();
    const jeton = randomBytes(24).toString('base64url');
    const inv: Invitation = {
      id: `inv-${randomUUID().slice(0, 12)}`, empreinte: empreinte(jeton), genre, cible: genre === 'collaborateur' ? '' : id,
      departement: typeof o?.champs.departement === 'string' ? o.champs.departement : null,
      creeLe: maintenant.toISOString(), expire: new Date(maintenant.getTime() + 30 * JOUR).toISOString(), envoyeePar: acteur, repondueLe: null,
    };
    this.#invitations.push(inv);
    if (this.#invitations.length > 20_000) this.#invitations.shift();
    if (genre === 'collaborateur') { this.#envois.push({ fiche: id, le: maintenant.toISOString().slice(0, 10) }); if (this.#envois.length > 20_000) this.#envois.shift(); }
    this.#changement();
    const lien = `${origine}/f/${jeton}`;
    const email = typeof o?.champs.email === 'string' ? o.champs.email : '';
    const org = this.#monde.organisation.nom;
    const sujet = genre === 'client' ? `${org} — votre avis compte (1 minute)` : `${org} — baromètre de l’équipe (anonyme, 1 minute)`;
    const corps = genre === 'client'
      ? `Bonjour,\n\nPouvez-vous nous dire en une minute comment s’est passée votre expérience avec ${org} ?\n${lien}\n\nMerci !`
      : `Bonjour,\n\nComment vas-tu au travail en ce moment ? Ta réponse est anonyme : ton nom n’est jamais enregistré avec elle, et la direction ne voit que des résultats regroupés (au moins ${ANONYMAT_MIN} réponses ; les commentaires à partir de ${COMMENTAIRES_MIN}). Répondre est facultatif. Ce lien est le tien : ne le transmets à personne.\n${lien}\n\nMerci !`;
    return {
      id: inv.id, lien, expire: inv.expire, email: email || null,
      mailto: `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(sujet)}&body=${encodeURIComponent(corps)}`,
    };
  }

  /** Envoi groupé : tous les clients sans avis récent, ou toute l'équipe (baromètre). */
  inviterLot(p: Profil, d: unknown, origine: string) {
    if (!estObj(d) || (d.genre !== 'client' && d.genre !== 'collaborateur')) throw new ErreurApi(400, 'genre_invalide');
    const toutes = d.genre === 'client' ? this.clientsSansAvis(p).map((x) => x.id) : this.#monde.objetsReels().filter((o) => o.famille === 'personne' && this.#monde.estVisible(p, o.id)).map((o) => o.id);
    // baromètre : les personnes qui ont déjà eu un lien depuis moins de 30 jours, ou dont la fiche est trop récente, sont écartées
    const cibles = d.genre === 'collaborateur' ? toutes.filter((c) => this.#refusBarometre(c) === null) : toutes;
    const liens = cibles.slice(0, 500).map((c) => ({ cible: c, nom: this.#monde.objetReel(c)?.nom ?? '', ...this.inviter(p, c, origine) }));
    return { liens, ecartes: toutes.length - cibles.length };
  }

  /** Clients sans réponse depuis 180 jours (ou jamais), visibles pour ce profil. */
  clientsSansAvis(p: Profil) {
    const limite = this.#monde.maintenant().getTime() - 180 * JOUR;
    const avis = this.#monde.objetsReels().filter((o) => o.type === 'avis_client');
    return this.#monde.objetsReels()
      .filter((o) => o.famille === 'tiers' && o.roles.includes('client') && this.#monde.estVisible(p, o.id))
      .filter((t) => !avis.some((a) => a.champs.concerne === t.id && Date.parse(String(a.champs.recu_le ?? a.majLe)) > limite));
  }

  #invitation(jeton: unknown): Invitation {
    if (typeof jeton !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(jeton)) throw new ErreurApi(404, 'introuvable');
    const e = empreinte(jeton);
    const inv = this.#invitations.find((i) => i.empreinte === e);
    if (!inv) throw new ErreurApi(404, 'introuvable');
    return inv;
  }

  #limiter(ip: string) {
    const t = Date.now();
    const e = this.#essais.get(ip);
    if (!e || t - e.depuis > 600_000) { this.#essais.set(ip, { n: 1, depuis: t }); return; }
    if (++e.n > 60) throw new ErreurApi(429, 'trop_de_requetes');
    if (this.#essais.size > 10_000) this.#essais.clear();
  }

  /** Contenu public du formulaire (aucune donnée interne au-delà du nom de l'entreprise). */
  formulaire(jeton: unknown, ip: string) {
    this.#limiter(ip);
    const inv = this.#invitation(jeton);
    const expire = Date.parse(inv.expire) < this.#monde.maintenant().getTime();
    const cible = this.#monde.objetReel(inv.cible);
    return {
      organisation: this.#monde.organisation.nom.replace(/\s*\(.*fictive.*\)/i, ''),
      genre: inv.genre,
      destinataire: inv.genre === 'client' ? (cible?.nom ?? null) : null,
      // baromètre : le lien ne dit jamais s'il a déjà servi (la direction, qui détient les liens, saurait qui a répondu)
      dejaRepondu: inv.genre === 'client' ? inv.repondueLe !== null : false,
      ...(inv.genre === 'collaborateur' ? { anonymat: ANONYMAT_MIN, commentairesMin: COMMENTAIRES_MIN, conservationMois: 13 } : {}),
      expire,
      questions: inv.genre === 'client'
        ? [
            { id: 'note', libelle: 'Globalement, êtes-vous satisfait(e) de notre travail ?', type: 'echelle', min: 0, max: 10, obligatoire: true },
            { id: 'recommande', libelle: 'Nous recommanderiez-vous à un proche ou un partenaire ?', type: 'echelle', min: 0, max: 10 },
            { id: 'commentaire', libelle: 'Un mot sur ce qui vous a plu, ou ce que nous devrions améliorer ?', type: 'texte' },
          ]
        : [
            { id: 'note', libelle: 'En ce moment, comment te sens-tu au travail ?', type: 'echelle', min: 0, max: 10, obligatoire: true },
            { id: 'charge', libelle: 'Ta charge de travail est-elle tenable ? (0 = pas du tout, 10 = tout à fait)', type: 'echelle', min: 0, max: 10 },
            { id: 'commentaire', libelle: 'Une idée, une difficulté ? (anonyme)', type: 'texte' },
          ],
    };
  }

  repondre(jeton: unknown, d: unknown, ip: string) {
    this.#limiter(ip);
    const inv = this.#invitation(jeton);
    if (inv.genre === 'client' && inv.repondueLe) throw new ErreurApi(409, 'deja_repondu', 'Merci, votre réponse est déjà enregistrée.');
    if (Date.parse(inv.expire) < this.#monde.maintenant().getTime()) throw new ErreurApi(410, 'expire', 'Ce lien a expiré.');
    if (!estObj(d)) throw new ErreurApi(400, 'requete_invalide');
    const echelle = (v: unknown, obligatoire: boolean) => {
      if ((v === undefined || v === null || v === '') && !obligatoire) return null;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0 || n > 10) throw new ErreurApi(400, 'note_invalide', 'Choisissez une note de 0 à 10.');
      return n;
    };
    const note = echelle(d.note, true) as number;
    const commentaire = typeof d.commentaire === 'string' ? d.commentaire.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 1500) : '';
    const jour = this.#monde.maintenant().toISOString().slice(0, 10);
    if (inv.genre === 'client') {
      const recommande = echelle(d.recommande, false);
      const cible = this.#monde.objetReel(inv.cible);
      this.#monde.creerObjetSysteme('formulaire', 'avis_client', `Avis — ${cible?.nom ?? 'client'} — ${jour}`, {
        concerne: inv.cible, note, ...(recommande !== null ? { recommande } : {}), ...(commentaire ? { commentaire } : {}), recu_le: jour, canal: 'formulaire',
      }, { id: 'formulaire', libelle: 'Formulaire de satisfaction' });
      inv.repondueLe = this.#monde.maintenant().toISOString();
    } else {
      const charge = echelle(d.charge, false);
      // lien déjà utilisé : même réponse, rien d'enregistré (aucun indice pour qui détient le lien)
      if (inv.repondueLe) return { ok: true };
      const mois = moisDe(this.#monde.maintenant());
      this.#reponses.push({ recu: mois, departement: inv.departement, note, charge, commentaire: commentaire || null, global: null, service: null });
      inv.repondueLe = mois;
      this.#publier();
    }
    this.#changement();
    return { ok: true };
  }

  /** Vue de synthèse pour le profil : satisfaction par client, baromètre par département, invitations en attente. */
  resume(p: Profil) {
    const objets = this.#monde.objetsReels();
    const maintenant = this.#monde.maintenant().getTime();
    const tiers = objets.filter((o) => o.famille === 'tiers' && this.#monde.estVisible(p, o.id));
    const avis = objets.filter((o) => o.type === 'avis_client' && this.#monde.estVisible(p, o.id));
    const clients: Record<string, { note: number | null; le: string | null; nb: number; moyenne: number | null; tendance: number | null; statut: string; envoyeLe: string | null; historique: { le: string; note: number }[] }> = {};
    for (const t of tiers) {
      const siens = avis.filter((a) => a.champs.concerne === t.id && typeof a.champs.note === 'number')
        .map((a) => ({ le: String(a.champs.recu_le ?? a.majLe).slice(0, 10), note: a.champs.note as number }))
        .sort((a, b) => a.le.localeCompare(b.le));
      const inv = this.#invitations.filter((i) => i.cible === t.id && !i.repondueLe && Date.parse(i.expire) > maintenant).at(-1);
      if (!siens.length && !t.roles.includes('client') && !inv) continue;
      const derniere = siens.at(-1) ?? null;
      const moyenne = siens.length ? Math.round((siens.reduce((s, x) => s + x.note, 0) / siens.length) * 10) / 10 : null;
      const ancien = derniere ? maintenant - Date.parse(derniere.le) > 180 * JOUR : true;
      clients[t.id] = {
        note: derniere?.note ?? null, le: derniere?.le ?? null, nb: siens.length, moyenne,
        tendance: siens.length >= 2 ? (siens.at(-1) as { note: number }).note - (siens.at(-2) as { note: number }).note : null,
        statut: !derniere ? 'inconnue' : ancien ? 'ancienne' : derniere.note >= 8 ? 'bonne' : derniere.note >= 6 ? 'moyenne' : 'mauvaise',
        envoyeLe: inv?.creeLe ?? null,
        historique: siens.slice(-12),
      };
    }
    const notes = Object.values(clients).filter((c) => c.note !== null);
    const recommandations = avis.map((a) => a.champs.recommande).filter((x): x is number => typeof x === 'number');
    const nps = recommandations.length ? Math.round(((recommandations.filter((x) => x >= 9).length - recommandations.filter((x) => x <= 6).length) / recommandations.length) * 100) : null;

    let barometre = null;
    if (p.peutAdministrer || p.types === 'tous' || (p.types as readonly string[]).includes('barometre')) {
      const depuis = this.#depuis();
      type Ligne = { departement: string | null; note: number; charge: number | null; commentaire: string | null; mois: string };
      // réponses publiées (lots d'au moins 5) ; plus les fiches « baromètre » déjà dans le monde (démonstration, import),
      // visibles de toute façon, comptées au mois
      const importees: Ligne[] = objets.filter((o) => o.type === 'barometre' && o.source.id !== 'formulaire' && this.#monde.estVisible(p, o.id) && typeof o.champs.note === 'number')
        .map((o) => ({ departement: typeof o.champs.departement === 'string' ? o.champs.departement : null, note: o.champs.note as number, charge: typeof o.champs.charge === 'number' ? o.champs.charge : null, commentaire: typeof o.champs.commentaire === 'string' ? o.champs.commentaire : null, mois: String(o.champs.recu_le ?? o.majLe).slice(0, 7) }))
        .filter((l) => l.mois >= depuis);
      const publiees: Ligne[] = this.#reponses.filter((r) => r.global && r.global >= depuis).map((r) => ({ ...r, mois: r.global as string }));
      const equipe: Ligne[] = [...publiees, ...importees];
      const parDep = new Map<string, Ligne[]>();
      for (const r of [...this.#reponses.filter((x) => x.service && x.service >= depuis).map((x) => ({ ...x, mois: x.service as string })), ...importees]) {
        if (!r.departement) continue;
        parDep.set(r.departement, [...(parDep.get(r.departement) ?? []), r]);
      }
      const moy = (l: (number | null)[]) => { const v = l.filter((x): x is number => typeof x === 'number'); return v.length ? Math.round((v.reduce((s, x) => s + x, 0) / v.length) * 10) / 10 : null; };
      const invCollab = this.#invitations.filter((i) => i.genre === 'collaborateur' && maintenant - Date.parse(i.creeLe) < 120 * JOUR);
      const assez = equipe.length >= ANONYMAT_MIN;
      barometre = {
        seuil: ANONYMAT_MIN,
        reponses: assez ? equipe.length : 0,
        invites: invCollab.length,
        participation: invCollab.length && assez ? Math.min(100, Math.round((equipe.length / invCollab.length) * 100)) : null,
        global: assez ? moy(equipe.map((r) => r.note)) : null,
        departements: [...parDep].filter(([, l]) => l.length >= ANONYMAT_MIN).map(([id, l]) => ({
          id, nom: this.#monde.objetReel(id)?.nom ?? '?', reponses: l.length, note: moy(l.map((x) => x.note)), charge: moy(l.map((x) => x.charge)),
        })),
        // un commentaire se reconnaît plus facilement qu'une moyenne : ceux des formulaires seulement à partir de 10
        // réponses publiées (les fiches importées, déjà visibles dans le monde, ne comptent pas dans ce seuil)
        commentaires: assez ? melanger([...(publiees.length >= COMMENTAIRES_MIN ? publiees : []), ...importees].filter((r) => r.commentaire)).slice(0, 8).map((r) => ({ le: r.mois, texte: r.commentaire as string })) : [],
        seuilCommentaires: COMMENTAIRES_MIN,
        dernierEnvoi: invCollab.map((i) => i.creeLe).sort().at(-1) ?? null,
      };
    }
    return {
      clients,
      global: { moyenne: notes.length ? Math.round((notes.reduce((s, c) => s + (c.note as number), 0) / notes.length) * 10) / 10 : null, avecAvis: notes.length, sansAvis: Object.values(clients).filter((c) => c.statut === 'inconnue' || c.statut === 'ancienne').length, nps, enAttente: this.#invitations.filter((i) => i.genre === 'client' && !i.repondueLe && Date.parse(i.expire) > maintenant && this.#monde.estVisible(p, i.cible)).length },
      barometre,
    };
  }

  /** Pour les automatisations : dernière invitation d'une cible. */
  derniereInvitation(cible: string): string | null {
    return this.#invitations.filter((i) => i.cible === cible).map((i) => i.creeLe).sort().at(-1) ?? null;
  }
}
