/**
 * UNIVERS = vocabulaire et structure propres à une entreprise, en pur JSON.
 * Clients, fournisseurs, sites, projets, stocks… sont des types/rôles déclarés ici, pas dans le code.
 *
 * Personnaliser = appliquer une SURCHARGE à un univers de base (`univers/*.json`) :
 *  - renommer (projet → « Chantier »), masquer, ajouter des types, rôles, champs, règles ;
 *  - jamais supprimer ni changer la famille d'un type : les données existantes restent valides.
 * Tout univers est validé avant usage (il peut venir d'un fichier ou d'un écran de réglage).
 */
import { FAMILLES, type Famille, type ObjetMetier } from './model.ts';

export const TYPES_CHAMP = ['texte', 'nombre', 'montant', 'date', 'booleen', 'choix', 'reference'] as const;
export type TypeChamp = (typeof TYPES_CHAMP)[number];

export interface DefChamp {
  id: string;
  libelle: string;
  type: TypeChamp;
  obligatoire?: boolean;
  unite?: string;
  choix?: readonly string[]; // type « choix »
  cible?: { famille: Famille; role?: string }; // type « reference » (ex. projet → client) ; absent = tout objet
}

export interface DefType {
  id: string;
  famille: Famille;
  libelle: string;
  pluriel: string;
  icone?: string;
  masque?: boolean;
  champs: readonly DefChamp[];
}

/** Vocabulaire commun avec le réseau Breizhcosystem. */
export const ROLES_RESEAU = ['fournisseur', 'sous_traitant', 'partenaire', 'client', 'autre'] as const;
export type RoleReseau = (typeof ROLES_RESEAU)[number];

export interface DefRole {
  id: string;
  libelle: string;
  pluriel: string;
  masque?: boolean;
  /** Traduction vers le réseau (ex. « Maître d'ouvrage » → client). Par défaut : l'id s'il est commun, sinon « autre ». */
  reseau?: RoleReseau;
}

/** Règle de seuil déclarative (stock minimum, retard maximum, encours client maximum…). */
export interface DefRegleSeuil {
  id: string;
  libelle: string;
  type: string; // type d'objet visé
  champ: string; // champ numérique mesuré
  sens: 'min' | 'max';
  seuil: number | { champ: string }; // fixe, ou lu sur l'objet
  seuilCritique?: number;
  unite?: string;
  /** true : la jauge accepte des mouvements enregistrés (entrée/sortie de stock, encaissement…). */
  mouvement?: boolean;
  /** Restreint la règle aux tiers portant ce rôle (ex. encours → clients seulement). */
  role?: string;
}

/**
 * Règle d'échéance déclarative : date dépassée et objet pas encore « terminé »
 * (tâche en retard, livraison attendue, révision de véhicule…).
 */
export interface DefRegleEcheance {
  id: string;
  libelle: string;
  type: string;
  champ: string; // champ de type date
  termine?: { champ: string; valeurs: readonly string[] };
  critiqueApresJours?: number;
  /** Préavis : signaler « à traiter » N jours AVANT l'échéance (contrôle technique, attestation…). */
  avantJours?: number;
}

export interface Univers {
  id: string;
  version: number;
  nom: string;
  roles: readonly DefRole[];
  types: readonly DefType[];
  regles: readonly DefRegleSeuil[];
  echeances: readonly DefRegleEcheance[];
}

export class ErreurUnivers extends Error {
  readonly problemes: readonly string[];
  constructor(problemes: readonly string[]) {
    super(`univers invalide : ${problemes.slice(0, 5).join(' ; ')}`);
    this.problemes = problemes;
  }
}

// ------------------------------------------------------------------ validation

const ID = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITES = { roles: 30, types: 100, champs: 50, choix: 50, regles: 100 } as const;

type Obj = Record<string, unknown>;
const estObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const texte = (x: unknown, max = 60): x is string => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const estFamille = (x: unknown): x is Famille => (FAMILLES as readonly unknown[]).includes(x);
const numerique = (c: DefChamp | undefined): boolean => c?.type === 'nombre' || c?.type === 'montant';

/** Valide un univers complet. Lève `ErreurUnivers` avec la liste de TOUS les problèmes. */
export function validerUnivers(x: unknown): Univers {
  const p: string[] = [];
  if (!estObj(x)) throw new ErreurUnivers(['univers : objet attendu']);
  if (typeof x.id !== 'string' || !ID.test(x.id)) p.push('id invalide');
  if (!texte(x.nom, 80)) p.push('nom invalide');
  if (!Number.isInteger(x.version) || (x.version as number) < 1) p.push('version invalide');

  const roles = Array.isArray(x.roles) ? x.roles : (p.push('roles : liste attendue'), []);
  const types = Array.isArray(x.types) ? x.types : (p.push('types : liste attendue'), []);
  const regles = Array.isArray(x.regles) ? x.regles : (p.push('regles : liste attendue'), []);
  if (roles.length > LIMITES.roles) p.push('trop de rôles');
  if (types.length > LIMITES.types) p.push('trop de types');
  if (regles.length > LIMITES.regles) p.push('trop de règles');

  const idsRoles = new Set<string>();
  for (const r of roles) {
    if (!estObj(r) || typeof r.id !== 'string' || !ID.test(r.id)) { p.push('rôle : id invalide'); continue; }
    if (idsRoles.has(r.id)) p.push(`rôle ${r.id} : doublon`);
    idsRoles.add(r.id);
    if (!texte(r.libelle) || !texte(r.pluriel)) p.push(`rôle ${r.id} : libellés invalides`);
    if (r.reseau !== undefined && !(ROLES_RESEAU as readonly unknown[]).includes(r.reseau)) p.push(`rôle ${r.id} : rôle réseau inconnu`);
  }

  const idsTypes = new Map<string, Map<string, DefChamp>>();
  for (const t of types) {
    if (!estObj(t) || typeof t.id !== 'string' || !ID.test(t.id)) { p.push('type : id invalide'); continue; }
    if (idsTypes.has(t.id)) p.push(`type ${t.id} : doublon`);
    if (!estFamille(t.famille)) p.push(`type ${t.id} : famille inconnue`);
    if (!texte(t.libelle) || !texte(t.pluriel)) p.push(`type ${t.id} : libellés invalides`);
    if (t.icone !== undefined && !texte(t.icone, 40)) p.push(`type ${t.id} : icône invalide`);
    const champs = new Map<string, DefChamp>();
    const liste = Array.isArray(t.champs) ? t.champs : (p.push(`type ${t.id} : champs attendus`), []);
    if (liste.length > LIMITES.champs) p.push(`type ${t.id} : trop de champs`);
    for (const c of liste) {
      const ou = `type ${t.id}, champ`;
      if (!estObj(c) || typeof c.id !== 'string' || !ID.test(c.id)) { p.push(`${ou} : id invalide`); continue; }
      if (champs.has(c.id)) p.push(`${ou} ${c.id} : doublon`);
      if (!texte(c.libelle)) p.push(`${ou} ${c.id} : libellé invalide`);
      if (!(TYPES_CHAMP as readonly unknown[]).includes(c.type)) p.push(`${ou} ${c.id} : type inconnu`);
      if (c.type === 'choix' && !(Array.isArray(c.choix) && c.choix.length > 0 && c.choix.length <= LIMITES.choix && c.choix.every((v) => texte(v)))) {
        p.push(`${ou} ${c.id} : liste de choix invalide`);
      }
      if (c.type === 'reference' && c.cible !== undefined) {
        // Sans cible : référence vers n'importe quel objet (ex. tâche « concerne »).
        const cible = c.cible;
        if (!estObj(cible) || !estFamille(cible.famille)) p.push(`${ou} ${c.id} : cible invalide`);
        else if (cible.role !== undefined && !idsRoles.has(cible.role as string)) p.push(`${ou} ${c.id} : rôle cible inconnu`);
      }
      champs.set(c.id, c as unknown as DefChamp);
    }
    idsTypes.set(t.id, champs);
  }

  const idsRegles = new Set<string>();
  for (const r of regles) {
    if (!estObj(r) || typeof r.id !== 'string' || !ID.test(r.id)) { p.push('règle : id invalide'); continue; }
    if (idsRegles.has(r.id)) p.push(`règle ${r.id} : doublon`);
    idsRegles.add(r.id);
    if (!texte(r.libelle)) p.push(`règle ${r.id} : libellé invalide`);
    if (r.sens !== 'min' && r.sens !== 'max') p.push(`règle ${r.id} : sens invalide`);
    const champs = idsTypes.get(r.type as string);
    if (!champs) { p.push(`règle ${r.id} : type inconnu`); continue; }
    if (!numerique(champs.get(r.champ as string))) p.push(`règle ${r.id} : champ mesuré non numérique`);
    const s = r.seuil;
    if (!(typeof s === 'number' && Number.isFinite(s)) && !(estObj(s) && numerique(champs.get(s.champ as string)))) {
      p.push(`règle ${r.id} : seuil invalide`);
    }
    if (r.mouvement !== undefined && typeof r.mouvement !== 'boolean') p.push(`règle ${r.id} : mouvement invalide`);
    if (r.role !== undefined && !idsRoles.has(r.role as string)) p.push(`règle ${r.id} : rôle inconnu`);
    if (r.seuilCritique !== undefined && !(typeof r.seuilCritique === 'number' && Number.isFinite(r.seuilCritique))) {
      p.push(`règle ${r.id} : seuil critique invalide`);
    }
  }

  const echeances = x.echeances === undefined ? [] : Array.isArray(x.echeances) ? x.echeances : (p.push('echeances : liste attendue'), []);
  if (echeances.length > LIMITES.regles) p.push('trop de règles d’échéance');
  for (const r of echeances) {
    if (!estObj(r) || typeof r.id !== 'string' || !ID.test(r.id)) { p.push('échéance : id invalide'); continue; }
    if (idsRegles.has(r.id)) p.push(`échéance ${r.id} : doublon`);
    idsRegles.add(r.id);
    if (!texte(r.libelle)) p.push(`échéance ${r.id} : libellé invalide`);
    const champs = idsTypes.get(r.type as string);
    if (!champs) { p.push(`échéance ${r.id} : type inconnu`); continue; }
    if (champs.get(r.champ as string)?.type !== 'date') p.push(`échéance ${r.id} : champ date attendu`);
    if (r.termine !== undefined) {
      const t = r.termine;
      if (!estObj(t) || !champs.has(t.champ as string) || !Array.isArray(t.valeurs) || !t.valeurs.every((v) => texte(v))) p.push(`échéance ${r.id} : condition « terminé » invalide`);
    }
    if (r.critiqueApresJours !== undefined && !(Number.isInteger(r.critiqueApresJours) && (r.critiqueApresJours as number) >= 0)) p.push(`échéance ${r.id} : seuil critique invalide`);
    if (r.avantJours !== undefined && !(Number.isInteger(r.avantJours) && (r.avantJours as number) >= 0 && (r.avantJours as number) <= 365)) p.push(`échéance ${r.id} : préavis invalide`);
  }

  if (p.length > 0) throw new ErreurUnivers(p);
  return { ...(x as unknown as Univers), echeances: echeances as unknown as DefRegleEcheance[] };
}

// ------------------------------------------------------------------ personnalisation

/**
 * Applique une surcharge (JSON) à un univers de base. Éléments fusionnés par `id`.
 * Interdit : changer la famille d'un type ou le type d'un champ existant (casserait les données).
 */
export function personnaliser(base: Univers, surcharge: unknown): Univers {
  if (!estObj(surcharge)) throw new ErreurUnivers(['surcharge : objet attendu']);
  if (surcharge.herite !== base.id) throw new ErreurUnivers([`surcharge : hérite de « ${String(surcharge.herite)} », base « ${base.id} »`]);
  const p: string[] = [];

  const fusion = <T extends { id: string }>(liste: readonly T[], ajouts: unknown, fusionner: (a: T, b: Obj) => T): T[] => {
    const res = [...liste];
    if (ajouts === undefined) return res;
    if (!Array.isArray(ajouts)) { p.push('surcharge : liste attendue'); return res; }
    for (const b of ajouts) {
      if (!estObj(b) || typeof b.id !== 'string') { p.push('surcharge : élément sans id'); continue; }
      const i = res.findIndex((a) => a.id === b.id);
      if (i === -1) res.push(b as unknown as T);
      else res[i] = fusionner(res[i] as T, b);
    }
    return res;
  };

  const roles = fusion(base.roles, surcharge.roles, (a, b) => ({ ...a, ...b }) as DefRole);
  const types = fusion(base.types, surcharge.types, (a, b) => {
    if (b.famille !== undefined && b.famille !== a.famille) p.push(`type ${a.id} : famille non modifiable`);
    const champs = fusion(a.champs, b.champs, (ca, cb) => {
      if (cb.type !== undefined && cb.type !== ca.type) p.push(`type ${a.id}, champ ${ca.id} : type non modifiable`);
      return { ...ca, ...cb } as DefChamp;
    });
    return { ...a, ...b, famille: a.famille, champs } as DefType;
  });
  const regles = fusion(base.regles, surcharge.regles, (_a, b) => b as unknown as DefRegleSeuil);
  const echeances = fusion(base.echeances, surcharge.echeances, (_a, b) => b as unknown as DefRegleEcheance);

  if (p.length > 0) throw new ErreurUnivers(p);
  return validerUnivers({ id: surcharge.id, nom: surcharge.nom, version: surcharge.version, roles, types, regles, echeances });
}

// ------------------------------------------------------------------ usage

export function defType(u: Univers, typeId: string): DefType | undefined {
  return u.types.find((t) => t.id === typeId);
}

/** Libellé affiché : « Client » / « Clients », « Chantier » / « Chantiers »… */
export function libelleType(u: Univers, typeId: string, nombre = 1): string {
  const t = defType(u, typeId);
  return t ? (nombre > 1 ? t.pluriel : t.libelle) : typeId;
}

export function libelleRole(u: Univers, roleId: string, nombre = 1): string {
  const r = u.roles.find((x) => x.id === roleId);
  return r ? (nombre > 1 ? r.pluriel : r.libelle) : roleId;
}

/** Rôle à utiliser sur Breizhcosystem pour un rôle de l'univers privé. */
export function roleReseau(u: Univers, roleId: string): RoleReseau {
  const r = u.roles.find((x) => x.id === roleId);
  if (r?.reseau) return r.reseau;
  return (ROLES_RESEAU as readonly string[]).includes(roleId) ? (roleId as RoleReseau) : 'autre';
}

export function typesVisibles(u: Univers, famille?: Famille): DefType[] {
  return u.types.filter((t) => !t.masque && (famille === undefined || t.famille === famille));
}

/** Ex. `tiersParRole(u, objets, 'client')` → tous les clients, y compris ceux qui sont aussi fournisseurs. */
export function tiersParRole(objets: readonly ObjetMetier[], roleId: string): ObjetMetier[] {
  return objets.filter((o) => o.famille === 'tiers' && o.roles.includes(roleId));
}

/** Vérifie un objet contre l'univers. Renvoie la liste des problèmes (vide = valide). */
export function validerObjet(u: Univers, o: ObjetMetier): string[] {
  const p: string[] = [];
  const t = defType(u, o.type);
  if (!t) return [`type « ${o.type} » inconnu de l'univers ${u.id}`];
  if (t.famille !== o.famille) p.push(`famille ${o.famille} ≠ ${t.famille}`);
  if (o.famille !== 'tiers' && o.roles.length > 0) p.push('seuls les tiers ont des rôles');
  for (const r of o.roles) if (!u.roles.some((x) => x.id === r)) p.push(`rôle « ${r} » inconnu`);

  const defs = new Map(t.champs.map((c) => [c.id, c]));
  for (const k of Object.keys(o.champs)) if (!defs.has(k)) p.push(`champ « ${k} » non déclaré`);
  for (const c of t.champs) {
    const v = o.champs[c.id];
    if (v === undefined || v === null) {
      if (c.obligatoire) p.push(`champ « ${c.id} » obligatoire`);
      continue;
    }
    const ok =
      c.type === 'texte' ? typeof v === 'string' && v.length <= 2000
      : c.type === 'nombre' || c.type === 'montant' ? typeof v === 'number' && Number.isFinite(v)
      : c.type === 'date' ? typeof v === 'string' && !Number.isNaN(Date.parse(v))
      : c.type === 'booleen' ? typeof v === 'boolean'
      : c.type === 'choix' ? typeof v === 'string' && (c.choix ?? []).includes(v)
      : typeof v === 'string' && v.length > 0; // reference
    if (!ok) p.push(`champ « ${c.id} » : valeur invalide pour ${c.type}`);
  }
  return p;
}
