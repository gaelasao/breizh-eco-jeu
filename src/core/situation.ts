/**
 * Situations et preuves (LB-03, R02). Règles déterministes, sans IA, sans secteur codé en dur :
 * les règles de seuil sont déclarées dans l'univers (stock minimum, retard maximum, encours client…).
 * Une source périmée ou déconnectée ne rend jamais une situation « verte ».
 */
import { fraicheur, type Fraicheur, type ObjetMetier, type Provenance, type Source, type Valeur } from './model.ts';
import type { DefRegleSeuil, Univers } from './univers.ts';
import { mesure, pluriel } from './texte.ts';

export type Gravite = 'info' | 'attention' | 'critique';
export type StatutSituation = 'ouverte' | 'a_verifier' | 'resolue';

export interface Preuve {
  valeur: number | null;
  seuil: number | null;
  source: Source;
  observeLe: string | null;
  provenance: Provenance;
  fraicheur: Fraicheur;
}

export interface Situation {
  objetId: string;
  regle: string;
  description: string;
  gravite: Gravite;
  statut: StatutSituation;
  responsable: string | null;
  preuve: Preuve;
}

export interface ContexteRegle {
  maintenant: Date;
  ageMaxMs: number;
}

export type RegleSeuil = Pick<DefRegleSeuil, 'id' | 'libelle' | 'sens' | 'seuilCritique' | 'unite'>;

/**
 * La règle concerne-t-elle cet objet ? Type, rôle de tiers éventuel, et l'objet doit SUIVRE cette mesure :
 * champ mesuré ou champ de seuil présent (même à null = « suivi mais inconnu »).
 * Un client importé sans encours ni limite n'est pas « en donnée manquante » : il ne suit pas cette mesure.
 */
export function regleVise(r: DefRegleSeuil, o: ObjetMetier): boolean {
  if (r.type !== o.type || (r.role !== undefined && !o.roles.includes(r.role))) return false;
  return o.champs[r.champ] !== undefined || (typeof r.seuil === 'object' && o.champs[r.seuil.champ] !== undefined);
}

/**
 * - valeur ou seuil inconnu → `a_verifier` (donnée manquante, pas « tout va bien »)
 * - hors seuil → `ouverte` (preuve marquée périmée si besoin)
 * - dans le seuil mais source périmée → `a_verifier`
 * - dans le seuil et frais → aucune situation
 */
export function evaluerSeuil(
  objetId: string,
  m: Valeur<number>,
  seuil: number | null,
  regle: RegleSeuil,
  responsable: string | null,
  ctx: ContexteRegle,
): Situation | null {
  const f = fraicheur(m.observeLe, ctx.maintenant, ctx.ageMaxMs);
  const preuve: Preuve = {
    valeur: m.valeur,
    seuil,
    source: m.source,
    observeLe: m.observeLe,
    provenance: m.provenance,
    fraicheur: f,
  };
  const base = { objetId, regle: regle.id, responsable, preuve };
  const v = m.valeur;

  if (v === null) return { ...base, gravite: 'attention', statut: 'a_verifier', description: `${regle.libelle} : donnée manquante.` };
  if (seuil === null) return { ...base, gravite: 'attention', statut: 'a_verifier', description: `${regle.libelle} : seuil non renseigné.` };

  const hors = regle.sens === 'min' ? v < seuil : v > seuil;
  if (hors) {
    const c = regle.seuilCritique;
    const critique = c !== undefined && (regle.sens === 'min' ? v <= c : v >= c);
    const borne = regle.sens === 'min' ? 'minimum' : 'maximum';
    const suffixe = f === 'fraiche' ? '' : ' — dernière valeur potentiellement périmée';
    return {
      ...base,
      gravite: critique ? 'critique' : 'attention',
      statut: 'ouverte',
      // « Retard de paiement : 42 jours » (un seuil maximum de 0 ne s'écrit pas) ; « Encours : 6 800 € (maximum 5 000 €) »
      description: `${regle.libelle} : ${mesure(v, regle.unite)}${regle.sens === 'max' && seuil === 0 ? '' : ` (${borne} ${mesure(seuil, regle.unite)})`}${suffixe}`,
    };
  }
  if (f !== 'fraiche') {
    return { ...base, gravite: 'info', statut: 'a_verifier', description: `${regle.libelle} : dans les limites mais source non à jour.` };
  }
  return null;
}

const nombre = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

const JOUR = 86_400_000;

/** Échéance dépassée et objet non terminé ⇒ situation ouverte (preuve : jours de retard, seuil 0). */
export function evaluerEcheance(u: Univers, o: ObjetMetier, responsable: string | null, ctx: ContexteRegle): Situation[] {
  const res: Situation[] = [];
  const aujourdhui = Date.UTC(ctx.maintenant.getUTCFullYear(), ctx.maintenant.getUTCMonth(), ctx.maintenant.getUTCDate());
  for (const r of u.echeances) {
    if (r.type !== o.type) continue;
    const d = o.champs[r.champ];
    if (typeof d !== 'string') continue;
    const t = Date.parse(`${d.slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(t)) continue;
    if (r.termine && r.termine.valeurs.includes(String(o.champs[r.termine.champ] ?? ''))) continue;
    const f = fraicheur(o.majLe, ctx.maintenant, ctx.ageMaxMs);
    if (t >= aujourdhui) {
      const restant = Math.round((t - aujourdhui) / JOUR);
      if (r.avantJours !== undefined && restant <= r.avantJours) {
        res.push({
          objetId: o.id, regle: r.id, description: `${r.libelle} : ${restant === 0 ? 'échéance aujourd’hui' : restant === 1 ? 'échéance demain' : `échéance dans ${pluriel(restant, 'jour', 'jours')}`}`, gravite: 'attention',
          statut: f === 'fraiche' ? 'ouverte' : 'a_verifier', responsable,
          preuve: { valeur: -restant, seuil: 0, source: o.source, observeLe: o.majLe, provenance: o.provenance, fraicheur: f },
        });
      }
      continue;
    }
    const jours = Math.round((aujourdhui - t) / JOUR);
    res.push({
      objetId: o.id,
      regle: r.id,
      // « échéance » porte l'accord (« Document : échéance dépassée de 6 jours ») : le libellé peut être masculin
      description: `${r.libelle} : échéance dépassée de ${pluriel(jours, 'jour', 'jours')}`,
      gravite: r.critiqueApresJours !== undefined && jours > r.critiqueApresJours ? 'critique' : 'attention',
      statut: f === 'fraiche' ? 'ouverte' : 'a_verifier',
      responsable,
      preuve: { valeur: jours, seuil: 0, source: o.source, observeLe: o.majLe, provenance: o.provenance, fraicheur: f },
    });
  }
  return res;
}

/** Applique toutes les règles de l'univers (seuils et échéances) qui visent cet objet. */
export function situationsPour(u: Univers, o: ObjetMetier, responsable: string | null, ctx: ContexteRegle): Situation[] {
  const res: Situation[] = evaluerEcheance(u, o, responsable, ctx);
  for (const r of u.regles) {
    if (!regleVise(r, o)) continue;
    const valeur: Valeur<number> = { valeur: nombre(o.champs[r.champ]), provenance: o.provenance, source: o.source, observeLe: o.majLe };
    const seuil = typeof r.seuil === 'number' ? r.seuil : nombre(o.champs[r.seuil.champ]);
    const s = evaluerSeuil(o.id, valeur, seuil, r, responsable, ctx);
    if (s) res.push(s);
  }
  return res;
}
