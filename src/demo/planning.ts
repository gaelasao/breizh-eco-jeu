/**
 * Planning de DÉMONSTRATION (fictif) : semaine en cours + 2 suivantes, jours ouvrés.
 * Valeurs : `lieu:<id>` · `projet:<id>` · `absence:<motif>` · `mission:<motif>` · '' (non affecté = trou).
 */
import type { ObjetMetier } from '../core/model.ts';

export type Planning = Map<string, Map<string, string>>;

const JOUR = 86_400_000;
export const isoJour = (d: Date) => d.toISOString().slice(0, 10);

/** Lundi de la semaine contenant `d` (UTC). */
export function lundi(d: Date): Date {
  const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const j = (x.getUTCDay() + 6) % 7;
  return new Date(x.getTime() - j * JOUR);
}

/** Jours ouvrés (lun.–ven.) à partir d'un lundi. */
export function joursOuvres(debut: Date, semaines = 1): string[] {
  const res: string[] = [];
  for (let s = 0; s < semaines; s++) for (let j = 0; j < 5; j++) res.push(isoJour(new Date(debut.getTime() + (s * 7 + j) * JOUR)));
  return res;
}

export function planningDemo(objets: readonly ObjetMetier[], maintenant: Date): Planning {
  const p: Planning = new Map();
  const jours = joursOuvres(lundi(maintenant), 3);
  const aujourdhui = isoJour(maintenant);
  const iAuj = Math.max(0, jours.findIndex((j) => j >= aujourdhui));
  const champ = (o: ObjetMetier, id: string) => o.champs[id];
  const poste = (o: ObjetMetier) => String(champ(o, 'poste') ?? '').toLowerCase();
  const indispo = (o: ObjetMetier) => ['absent', 'en congé'].includes(String(champ(o, 'disponibilite')));
  const projets = objets.filter((o) => o.famille === 'projet');
  const employes = objets.filter((o) => o.famille === 'personne');
  const terrain = (o: ObjetMetier) => /technic|opérat|régleur|maintenance|monteu|pose|ouvri|chef d’équipe|chef d'équipe/.test(poste(o));

  // équipes de chantier stables : d'abord le personnel de terrain disponible du même lieu
  // (un absent peut rester affecté : le chantier passe alors en sous-effectif, comme en vrai)
  const equipe = new Map<string, string>();
  for (const pr of projets) {
    const besoin = typeof champ(pr, 'besoin_effectif') === 'number' ? (champ(pr, 'besoin_effectif') as number) : 1;
    const libres = employes.filter((e) => !equipe.has(e.id) && terrain(e));
    const rang = (e: ObjetMetier) => (indispo(e) ? 2 : 0) + (champ(e, 'lieu') === champ(pr, 'lieu') ? 0 : 1);
    const tri = [...libres].sort((a, b) => rang(a) - rang(b));
    for (const e of tri.slice(0, besoin)) equipe.set(e.id, pr.id);
  }
  const premierChantier = projets[0]?.id;
  let renfortRetire = false;

  employes.forEach((e, k) => {
    const cases = new Map<string, string>();
    const base = typeof champ(e, 'lieu') === 'string' ? `lieu:${champ(e, 'lieu')}` : '';
    const dispo = champ(e, 'disponibilite');
    const commercial = /commercial|chargée? d’affaires|chargée? d'affaires/.test(poste(e));
    const chantier = equipe.get(e.id);
    // une personne du premier chantier part en formation après-demain : sous-effectif visible
    const enFormation = chantier === premierChantier && !renfortRetire && (renfortRetire = true);
    jours.forEach((j, i) => {
      let v = chantier ? `projet:${chantier}` : base;
      if (commercial && (i + k) % 4 === 1) v = 'mission:déplacement';
      if (dispo === 'absent' && i >= iAuj && i < iAuj + 3) v = 'absence:maladie';
      if (dispo === 'en congé' && i >= iAuj && i < iAuj + 5) v = 'absence:congé';
      if (enFormation && i === iAuj + 2) v = 'absence:formation';
      if (!chantier && k % 11 === 2 && i === iAuj + 2) v = 'mission:rendez-vous';
      // deux trous volontaires dans la semaine prochaine
      if (!chantier && (k === 3 || k === 7) && i === iAuj + 5) v = '';
      cases.set(j, v);
    });
    p.set(e.id, cases);
  });
  return p;
}
