/* Living Business — couche de jeu (direction de design §4.25, §4.27, §5.9, §6.1 P10). Module PUR : aucun accès
   au DOM ni au stockage, testé par src/ds/autres-ecrans.test.ts ; app.js le dessine.
   - Quêtes du jour (1 à 3) tirées des vraies quêtes ouvertes (une situation hors limites), groupées par règle, titre en
     verbe d'action, progression « 1 sur 3 », récompense en XP et preuve (« Pourquoi cette quête ? »).
   - L'XP et le niveau viennent du serveur (core/progression.ts) : jamais un point calculé ici.
   - Mode « Calme » : XP, quêtes et célébrations masquées (le choix est lu par app.js). */
import { pluriel } from './bz/typo.js';

const sansDemo = (nom) => String(nom ?? '').replace(/\s*\((?:entreprise )?(fictifs?|fictives?|démo)\)/gi, '');

/** XP d'une quête selon la gravité (même barème que le serveur, pour annoncer la récompense avant). */
export const RECOMPENSE = Object.freeze({ critique: 60, attention: 40 });

/** Titres en verbe d'action, par règle : pour un objet, puis pour plusieurs. */
const VERBES = {
  stock_minimum: { un: (n) => `Réapprovisionner ${n}`, plusieurs: (k) => `Réapprovisionner ${pluriel(k, 'article', 'articles')}`, icone: 'boxes' },
  // le nom commence souvent déjà par « Facture » : « Relancer la facture Facture F-041 » n'a jamais été écrit par personne
  retard_paiement: { un: (n) => (/^factures?\b/i.test(n) ? `Relancer ${n}` : `Relancer la facture ${n}`), plusieurs: (k) => `Relancer ${pluriel(k, 'facture en retard', 'factures en retard')}`, icone: 'receipt' },
  retard_projet: { un: (n) => `Rattraper le retard de ${n}`, plusieurs: (k) => `Rattraper le retard de ${pluriel(k, 'projet', 'projets')}`, icone: 'hourglass' },
  encours_client: { un: (n) => `Réduire l’encours de ${n}`, plusieurs: (k) => `Réduire l’encours de ${pluriel(k, 'client', 'clients')}`, icone: 'wallet' },
  avis_bas: { un: (n) => `Reprendre contact avec ${n}`, plusieurs: (k) => `Reprendre contact avec ${pluriel(k, 'client déçu', 'clients déçus')}`, icone: 'smile' },
};
const ICONE_DEFAUT = 'flag';

/** Titre en verbe d'une quête (ou d'un groupe de quêtes de la même règle). */
export function titreQuete(regle, noms) {
  const v = VERBES[regle];
  const liste = noms.map(sansDemo).filter(Boolean);
  if (liste.length === 1) return v ? v.un(liste[0]) : `Régler la situation de ${liste[0]}`;
  return v ? v.plusieurs(liste.length) : `Régler ${pluriel(liste.length, 'situation', 'situations')}`;
}
export const iconeQuete = (regle) => VERBES[regle]?.icone ?? ICONE_DEFAUT;

const jour = (iso) => String(iso ?? '').slice(0, 10);
/** Objectif d'une quête sans son libellé (« Objectif : ≥ 20… » → « ≥ 20… ») : le popover l'écrit déjà. */
const objectif = (q) => (q.objectif ? String(q.objectif).replace(/^Objectif\s*:\s*/u, '') : null);

/**
 * Quêtes du jour : 1 à 3 cartes. Chaque règle ayant des quêtes ouvertes donne une carte (les plus graves d'abord,
 * puis les plus nombreuses) ; « faites » compte les quêtes de la même règle achevées aujourd'hui.
 * Carte : { id, regle, titre, icone, faites, total, xp (récompense de ce qui reste), objets (ids à ouvrir),
 *          preuve (situation de la première quête : valeur, seuil, source, date), gravite }.
 */
export function quetesDuJour(m, { maintenant = new Date(), max = 3 } = {}) {
  const auj = jour(maintenant.toISOString ? maintenant.toISOString() : maintenant);
  const objets = new Map((m.objets ?? []).map((o) => [o.id, o]));
  const situations = m.situations ?? [];
  const parRegle = new Map();
  for (const q of m.quetes ?? []) {
    const regle = q.origine?.regle;
    if (!regle) continue;
    const g = parRegle.get(regle) ?? { ouvertes: [], faites: [] };
    if (q.statut === 'ouverte') g.ouvertes.push(q);
    else if (q.statut === 'achevee' && jour(q.acheveeLe) === auj) g.faites.push(q);
    parRegle.set(regle, g);
  }
  const rang = (g) => (g.ouvertes.some((q) => q.gravite === 'critique') ? 0 : 1);
  const cartes = [...parRegle].filter(([, g]) => g.ouvertes.length)
    .sort(([, a], [, b]) => rang(a) - rang(b) || b.ouvertes.length - a.ouvertes.length)
    .slice(0, max)
    .map(([regle, g]) => {
      const ouvertes = [...g.ouvertes].sort((a, b) => (a.gravite === 'critique' ? 0 : 1) - (b.gravite === 'critique' ? 0 : 1));
      const premiere = ouvertes[0];
      const s = situations.find((x) => x.objetId === premiere.origine.objetId && x.regle === regle) ?? null;
      const noms = ouvertes.map((q) => objets.get(q.origine.objetId)?.nom ?? '');
      return {
        id: `quete-du-jour:${regle}`,
        regle,
        titre: titreQuete(regle, noms),
        icone: iconeQuete(regle),
        gravite: ouvertes.some((q) => q.gravite === 'critique') ? 'critique' : 'attention',
        faites: g.faites.length,
        total: g.faites.length + ouvertes.length,
        xp: ouvertes.reduce((n, q) => n + (RECOMPENSE[q.gravite] ?? RECOMPENSE.attention), 0),
        objets: ouvertes.map((q) => q.origine.objetId),
        action: premiere.actionProposee ?? null,
        preuve: s ? {
          description: s.description,
          valeur: s.preuve?.valeur ?? null,
          seuil: s.preuve?.seuil ?? null,
          source: s.preuve?.source?.libelle ?? null,
          observeLe: s.preuve?.observeLe ?? null,
          objectif: objectif(premiere),
        } : { description: objectif(premiere) ?? '', valeur: null, seuil: null, source: null, observeLe: null, objectif: objectif(premiere) },
      };
    });
  return cartes;
}

/** « Niveau 4 · Port de pêche · 320 XP avant le niveau 5 » (ou « niveau maximal » au 10e). */
export function texteNiveau(p) {
  if (!p) return '';
  const tete = `Niveau ${p.niveau.n} · ${p.niveau.nom}`;
  return p.suivant ? `${tete} · ${p.suivant.reste} XP avant le niveau ${p.suivant.n}` : `${tete} · niveau maximal`;
}

/** Valeurs de la barre d'XP (§4.25) : remplissage de 0 à 100, et texte accessible. */
export function barreXp(p) {
  if (!p) return null;
  const pct = Math.round(Math.max(0, Math.min(1, p.avancement ?? 0)) * 100);
  return {
    pourcentage: pct,
    texte: texteNiveau(p),
    libelle: p.suivant ? `${p.xp} XP, niveau ${p.niveau.n} sur 10, ${pct} % du chemin vers le niveau ${p.suivant.n}` : `${p.xp} XP, niveau 10 sur 10`,
  };
}

/**
 * Ce qui vient de se passer entre deux chargements, pour la célébration (§4.25, §4.27) : réussites nouvelles (récentes
 * seulement : une réussite d'hier ne se fête pas au rechargement) et niveau gagné.
 */
export function aCelebrer(avant, apres, { maintenant = new Date(), fenetreMs = 10 * 60_000 } = {}) {
  if (!avant || !apres) return { reussites: [], niveau: null };
  const vues = new Set((avant.reussites ?? []).map((r) => r.id));
  const t = maintenant.getTime();
  const reussites = (apres.reussites ?? []).filter((r) => !vues.has(r.id) && t - Date.parse(r.le) <= fenetreMs);
  const niveau = apres.niveau?.n > (avant.niveau?.n ?? 0) && apres.exemple === avant.exemple ? apres.niveau : null;
  return { reussites, niveau };
}

/** Texte du toast de fin de quête : « Quête terminée : Réapprovisionner Panneaux · +40 XP ». */
export function texteCelebration(r) {
  return `Quête terminée : ${titreQuete(r.regle, [r.nom || r.titre])} · +${r.xp} XP`;
}

/** Les 10 niveaux tels qu'affichés (atteint, suivant, à venir), pour la page Progression. */
export function etapesNiveaux(p, niveaux) {
  return niveaux.map((n) => ({ ...n, atteint: p ? n.n <= p.niveau.n : n.n === 1, courant: p ? n.n === p.niveau.n : n.n === 1 }));
}

/** Niveaux du port (copie du barème du serveur, pour la page Progression ; le serveur fait foi). */
export const NIVEAUX = Object.freeze([
  { n: 1, nom: 'Cale', xp: 0, element: 'une cale de mise à l’eau' },
  { n: 2, nom: 'Quai', xp: 100, element: 'un quai en granit' },
  { n: 3, nom: 'Grue', xp: 250, element: 'une grue sur le quai' },
  { n: 4, nom: 'Port de pêche', xp: 450, element: 'des bateaux de pêche' },
  { n: 5, nom: 'Marché couvert', xp: 700, element: 'un marché couvert' },
  { n: 6, nom: 'Chantier naval', xp: 1000, element: 'un chantier naval' },
  { n: 7, nom: 'Criée', xp: 1400, element: 'une criée' },
  { n: 8, nom: 'Phare restauré', xp: 1900, element: 'le phare repeint' },
  { n: 9, nom: 'Ferry', xp: 2500, element: 'un ferry à quai' },
  { n: 10, nom: 'Port de commerce', xp: 3200, element: 'des conteneurs et un cargo' },
]);
