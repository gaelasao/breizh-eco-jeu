/**
 * Clés d'API : pour brancher Claude (MCP), Make, Zapier, n8n ou un script sur le monde.
 * Une clé agit AVEC LES DROITS d'un profil (même périmètre, mêmes actions). Elle n'est montrée qu'une fois ;
 * seule son empreinte SHA-256 est enregistrée. Révocable à tout moment, effet immédiat.
 * Une clé ne crée, ne liste ni ne révoque de clé, et ne touche pas aux accès : sinon un agent dont on révoque la clé
 * continuerait avec une autre qu'il se serait donnée (la passerelle refuse ces routes avec une clé). Chaque création et
 * révocation est au journal, avec la personne qui l'a faite.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Profil } from '../demo/donnees.ts';
import { ErreurApi, type Monde } from './monde.ts';

interface Cle {
  id: string;
  nom: string;
  profilId: string;
  empreinte: string;
  prefixe: string;
  creeLe: string;
  /** Profil avec lequel la clé a été créée. */
  creePar: string;
  /** Personne (identifiant du compte) qui l'a créée, depuis l'écran ; null en démonstration ou avant ce champ. */
  creeParPersonne?: string | null;
  derniereUtilisation: string | null;
}

export interface EtatCles {
  cles: Cle[];
}

const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest('base64url');

export class Cles {
  #cles: Cle[];
  #monde: Monde;
  #changement: () => void;

  constructor(monde: Monde, o: { etat?: EtatCles | null; changement?: () => void } = {}) {
    this.#monde = monde;
    this.#changement = o.changement ?? (() => {});
    this.#cles = Array.isArray(o.etat?.cles) ? (o.etat as EtatCles).cles : [];
  }

  instantane(): EtatCles {
    return { cles: this.#cles };
  }

  lister(p: Profil) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    return this.#cles.map(({ empreinte: _e, ...c }) => ({ ...c, profil: this.#monde.profil(c.profilId)?.nom ?? '(profil retiré)' }));
  }

  /** Création depuis l'écran seulement (la passerelle refuse les clés d'API ici) : `personne` = compte connecté. */
  creer(p: Profil, d: unknown, personne: string | null = null) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const x = (d ?? {}) as { nom?: unknown; profilId?: unknown };
    const nom = typeof x.nom === 'string' && x.nom.trim() && x.nom.length <= 80 ? x.nom.trim() : null;
    if (!nom) throw new ErreurApi(400, 'nom_invalide', 'Donnez un nom à la clé (ex. « Claude », « Make »).');
    const profil = this.#monde.profil(x.profilId);
    if (!profil) throw new ErreurApi(400, 'profil_inconnu');
    if (this.#cles.length >= 50) throw new ErreurApi(409, 'trop_de_cles');
    const jeton = `lb_${randomBytes(32).toString('base64url')}`;
    const c: Cle = { id: `cle-${randomUUID().slice(0, 8)}`, nom, profilId: profil.id, empreinte: empreinte(jeton), prefixe: jeton.slice(0, 7), creeLe: this.#monde.maintenant().toISOString(), creePar: p.id, creeParPersonne: personne, derniereUtilisation: null };
    this.#cles.push(c);
    this.#monde.tracer(p, 'cle.creee', null, `Clé d’API « ${nom} » (droits du profil ${profil.nom})${personne ? `, par ${personne}` : ''}`);
    this.#changement();
    return { id: c.id, nom: c.nom, profil: profil.nom, jeton };
  }

  revoquer(p: Profil, id: unknown) {
    if (!p.peutAdministrer) throw new ErreurApi(403, 'interdit');
    const i = this.#cles.findIndex((c) => c.id === id);
    if (i === -1) throw new ErreurApi(404, 'introuvable');
    const [retiree] = this.#cles.splice(i, 1);
    this.#monde.tracer(p, 'cle.revoquee', null, `Clé d’API « ${(retiree as Cle).nom} » révoquée`);
    this.#changement();
    return { ok: true };
  }

  /** Profil associé à un jeton valide (ou null). Le profil est relu : un droit retiré s'applique aussitôt. */
  verifier(jeton: string): { id: string; nom: string; profil: Profil } | null {
    if (!/^lb_[A-Za-z0-9_-]{43}$/.test(jeton)) return null;
    const e = empreinte(jeton);
    const c = this.#cles.find((x) => x.empreinte === e);
    if (!c) return null;
    const profil = this.#monde.profil(c.profilId);
    if (!profil) return null;
    const maintenant = this.#monde.maintenant().toISOString();
    if (!c.derniereUtilisation || maintenant.slice(0, 13) !== c.derniereUtilisation.slice(0, 13)) { c.derniereUtilisation = maintenant; this.#changement(); }
    return { id: c.id, nom: c.nom, profil };
  }
}
