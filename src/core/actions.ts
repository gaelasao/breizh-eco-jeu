/**
 * Commandes d'action (LB-04, LB-05, chap. 7.5, R03, R04).
 * - États explicites, transitions contrôlées.
 * - Clé d'idempotence : double clic ou reprise après timeout = un seul effet réel.
 * - Mode simulation : l'exécuteur réel n'est jamais appelé.
 */
import type { Mode } from './model.ts';

export type EtatAction =
  | 'brouillon'
  | 'en_attente'
  | 'approuvee'
  | 'en_cours'
  | 'reussie_technique'
  | 'echouee'
  | 'resultat_inconnu'
  | 'resultat_metier_confirme';

const TRANSITIONS: Readonly<Record<EtatAction, readonly EtatAction[]>> = {
  brouillon: ['en_attente'],
  en_attente: ['approuvee', 'echouee'],
  approuvee: ['en_cours'],
  en_cours: ['reussie_technique', 'echouee', 'resultat_inconnu'],
  // Résultat inconnu : on vérifie avant de relancer (pas de retour direct à en_cours).
  resultat_inconnu: ['reussie_technique', 'echouee'],
  reussie_technique: ['resultat_metier_confirme'],
  echouee: [],
  resultat_metier_confirme: [],
};

export interface CommandeAction {
  cleIdempotence: string;
  orgId: string;
  acteur: string;
  capacite: string; // ex. "stock.sortie"
  cible: string;
  parametres: Readonly<Record<string, unknown>>;
  approuvePar: string | null;
  etat: EtatAction;
  mode: Mode;
}

export class TransitionInterdite extends Error {}

export function transition(cmd: CommandeAction, vers: EtatAction): CommandeAction {
  if (!TRANSITIONS[cmd.etat].includes(vers)) {
    throw new TransitionInterdite(`${cmd.etat} → ${vers} interdit`);
  }
  return { ...cmd, etat: vers };
}

export type Executeur = (cmd: CommandeAction) => Promise<'ok' | 'echec' | 'inconnu'>;

/**
 * Registre d'exécution idempotent. En production : table avec contrainte unique (orgId, cleIdempotence).
 * Une même clé renvoie le même résultat, même si l'appel est concurrent.
 */
export class RegistreActions {
  #enCours = new Map<string, Promise<CommandeAction>>();

  executer(cmd: CommandeAction, reel: Executeur, simule: Executeur): Promise<CommandeAction> {
    if (cmd.etat !== 'approuvee') {
      return Promise.reject(new TransitionInterdite(`exécution impossible depuis ${cmd.etat}`));
    }
    if (cmd.mode === 'reel' && cmd.approuvePar === null) {
      return Promise.reject(new TransitionInterdite('action réelle sans approbation enregistrée'));
    }
    const cle = `${cmd.orgId}:${cmd.cleIdempotence}`;
    const existant = this.#enCours.get(cle);
    if (existant) return existant;

    const executeur = cmd.mode === 'reel' ? reel : simule;
    const p = (async () => {
      const lance = transition(cmd, 'en_cours');
      let r: 'ok' | 'echec' | 'inconnu';
      try {
        r = await executeur(lance);
      } catch {
        r = 'inconnu'; // timeout, coupure : on ne suppose ni succès ni échec
      }
      const fin: EtatAction = r === 'ok' ? 'reussie_technique' : r === 'echec' ? 'echouee' : 'resultat_inconnu';
      return transition(lance, fin);
    })();
    this.#enCours.set(cle, p);
    return p;
  }
}
