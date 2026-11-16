/* Living Business — « Ce que vos agents ont fait » : le relevé du réseau, lu dans le jeu (direction de design §6.1 P8).
   Module PUR, testé par src/ds/releve-reseau.test.ts : il met en forme, il ne calcule rien.

   Le jeu ne recompte rien et n'arrondit rien. Le relevé vient du réseau, qui l'a calculé depuis ses propres tables ; un
   second compte ici finirait par ne plus dire la même chose, et l'un des deux mentirait. Ce fichier tient donc trois
   règles, les mêmes que sur le site du réseau :
     1. une estimation sans son hypothèse ne s'affiche pas (le réseau l'a déjà écartée ; on ne la rattrape pas) ;
     2. une valeur absente ne devient jamais un tiret ni un « environ » : la ligne disparaît ;
     3. zéro s'affiche : un mois sans rien est un résultat, et le dire est honnête. */
import { accord, euros, nombre } from './bz/typo.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

/** « 45 min », « 3 h », « 3 h 15 ». Au-delà d'une journée, on reste en heures : « journée » serait une hypothèse de plus. */
export function duree(minutes) {
  const m = num(minutes);
  if (m === null || m <= 0) return null;
  const h = Math.floor(m / 60);
  const r = Math.round(m % 60);
  if (!h) return `${nombre(r)} min`;
  return r ? `${nombre(h)} h ${String(r).padStart(2, '0')}` : `${nombre(h)} h`;
}

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

/** « juin 2026 » ; un mois mal formé ne s'invente pas. */
export function titreMois(mois) {
  if (typeof mois !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mois)) return null;
  const [a, m] = mois.split('-');
  return `${MOIS[Number(m) - 1]} ${a}`;
}

/** Le mois précédent et le suivant, pour feuilleter ; jamais au-delà du mois en cours (il n'a rien à compter). */
export function voisins(mois, courant) {
  if (!titreMois(mois)) return { avant: null, apres: null };
  const [a, m] = mois.split('-').map(Number);
  const pas = (d) => {
    const t = m - 1 + d;
    return `${a + Math.floor(t / 12)}-${String(((t % 12) + 12) % 12 + 1).padStart(2, '0')}`;
  };
  const apres = pas(1);
  return { avant: pas(-1), apres: titreMois(courant) && apres > courant ? null : apres };
}

/**
 * Les lignes chiffrées d'un demi-relevé : un compte s'affiche toujours (zéro compris), une estimation seulement si le
 * réseau l'a calculée ET qu'elle porte son hypothèse. `agents` : le vocabulaire change, pas la règle.
 */
export function lignes(mesures, { agents = false } = {}) {
  if (!mesures || typeof mesures !== 'object') return [];
  const l = [];
  const compte = (cle, valeur, un, plusieurs) => {
    const n = num(valeur);
    if (n === null || n < 0) return;
    l.push({ cle, valeur: nombre(n), mot: accord(n, un, plusieurs), hypothese: null });
  };
  // Les occasions ne sont comptées que du côté de l'entreprise (la détection n'est jamais réservée) : les répéter du
  // côté des agents donnerait à lire deux occasions là où il n'y en a eu qu'une.
  if (agents) {
    compte('rapprochements', mesures.rapprochements, 'rapprochement préparé', 'rapprochements préparés');
  } else {
    compte('occasions', mesures.occasions, 'occasion vue', 'occasions vues');
    compte('gestes', mesures.gestes, 'geste de votre part', 'gestes de votre part');
  }
  compte('abouties', mesures.abouties, 'mise en relation aboutie', 'mises en relation abouties');
  const t = mesures.temps;
  if (t && num(t.valeur) !== null && typeof t.hypothese === 'string' && t.hypothese) l.push({ cle: 'temps', valeur: duree(t.valeur), mot: 'de temps gagné', hypothese: t.hypothese });
  const e = mesures.euros;
  if (e && num(e.valeur) !== null && typeof e.hypothese === 'string' && e.hypothese) l.push({ cle: 'euros', valeur: euros(e.valeur), mot: 'économisés', hypothese: e.hypothese });
  return l.filter((x) => x.valeur !== null);
}

/** Ce que dit l'en-tête : vrai quand il y a quelque chose, vrai aussi quand il n'y a rien. Jamais un reproche. */
export function phrase(r) {
  if (!r || typeof r !== 'object') return '';
  const main = r.aLaMain ?? {};
  const a = r.parLesAgents;
  if (!a) {
    const o = num(main.occasions) ?? 0;
    const g = num(main.gestes) ?? 0;
    if (!o && !g) return 'Rien ne s’est passé ce mois-ci sur le réseau : ni occasion vue, ni geste de votre part.';
    return `Ce mois-ci : ${nombre(o)} ${accord(o, 'occasion vue', 'occasions vues')} et ${nombre(g)} ${accord(g, 'geste de votre part', 'gestes de votre part')}.`;
  }
  const rp = num(a.rapprochements) ?? 0;
  const ab = num(a.abouties) ?? 0;
  if (!rp && !ab && !(num(a.occasions) ?? 0)) return 'Vos agents n’ont rien eu à faire ce mois-ci : aucune occasion ne s’est présentée.';
  return `Ce mois-ci : ${nombre(rp)} ${accord(rp, 'rapprochement préparé', 'rapprochements préparés')} par vos agents, ${nombre(ab)} ${accord(ab, 'mise en relation aboutie', 'mises en relation abouties')}.`;
}

/**
 * Ce que l'écran doit afficher, d'après l'état de la liaison et du relevé. Un seul endroit décide, pour que l'écran ne
 * puisse pas inventer un cas intermédiaire :
 *   - 'non_relie'  : l'entreprise n'est pas reliée au réseau — il n'y a rien à relever, et on le dit ;
 *   - 'illisible'  : le réseau a répondu quelque chose que le jeu n'a pas su relire — aucun chiffre n'est montré ;
 *   - 'sans_agent' : relevé lu, mais aucun agent n'agit — le travail de l'entreprise est montré, celui d'un agent non ;
 *   - 'complet'    : relevé lu, les deux moitiés sont montrées.
 */
export function etat({ relie, releve }) {
  if (!relie) return 'non_relie';
  if (!releve || typeof releve !== 'object' || !titreMois(releve.mois)) return 'illisible';
  return releve.parLesAgents ? 'complet' : 'sans_agent';
}

/** Ce que l'écran dit dans chaque état, sans culpabiliser et sans promettre un chiffre. */
export const TEXTES = Object.freeze({
  non_relie: {
    titre: 'Reliez votre entreprise pour voir ce que le réseau fait pour vous.',
    texte: 'Le relevé compte ce qui a vraiment eu lieu sur Breizhcosystem : occasions vues, mises en relation abouties, et ce que vos agents ont préparé.',
  },
  illisible: {
    titre: 'Le relevé n’a pas pu être lu.',
    texte: 'Plutôt qu’un chiffre approximatif, le jeu n’affiche rien. Réessayez : le relevé est recalculé à chaque fois depuis le réseau.',
  },
  sans_agent: {
    titre: 'Ce que vous avez fait vous-même, ce mois-ci.',
    texte: 'Les occasions que le réseau vous a montrées et les gestes que vous avez faits. Avec Breizhcosystem ACTIVE, un agent rapproche et prépare, et ce relevé compte ce qu’il a fait pour vous.',
  },
  complet: {
    titre: 'Ce que vos agents ont fait, ce mois-ci.',
    texte: 'Chaque chiffre est compté sur le réseau, et chaque estimation dit son hypothèse à côté.',
  },
});
