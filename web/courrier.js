/* Living Business — Courrier en boîte de réception classique (direction de design §6.1 P8, §4.11, §4.12).
   Module PUR : aucun accès au DOM ni au stockage, testé par src/ds/autres-ecrans.test.ts ; app.js le dessine.
   - Une ligne : expéditeur, avatar à initiales, objet, aperçu, bac en puce NEUTRE, urgence montrée seulement si elle
     est haute (P2 : la couleur se mérite).
   - Balayage « Traité » (vers la droite) ou « Déléguer » (vers la gauche), toujours doublé du menu « ⋯ » (2.5.7). */

export const BACS = Object.freeze(['clients', 'fournisseurs', 'paiements', 'administratif', 'équipe', 'publicité', 'autre']);
const RANG_URGENCE = { haute: 0, normale: 1, basse: 2 };
const sansDemo = (nom) => String(nom ?? '').replace(/\s*\((?:entreprise )?(fictifs?|fictives?|démo)\)/gi, '');
const val = (o, id) => o.champs?.find((c) => c.id === id)?.valeur ?? null;
const lien = (o, id) => o.champs?.find((c) => c.id === id)?.lien ?? null;

/** Libellé d'un bac, en casse de phrase : « publicité » → « Publicité ». */
export const libelleBac = (b) => (b ? `${String(b).charAt(0).toUpperCase()}${String(b).slice(1)}` : 'Autre');

/** Initiales d'un expéditeur (2 lettres) : « Kerlann Bois » → « KB » ; « compta@x.example » → « C ». */
export function initiales(nom) {
  const mots = sansDemo(nom).replace(/<[^>]*>/g, '').replace(/@.*$/, '').split(/[\s._-]+/).filter((m) => /\p{L}/u.test(m));
  if (!mots.length) return '?';
  return (mots.length === 1 ? mots[0].slice(0, 1) : `${mots[0][0]}${mots[1][0]}`).toUpperCase();
}

/** Aperçu d'une ligne : le résumé sur une ligne, coupé proprement à ~140 caractères. */
export function apercu(texte, max = 140) {
  const t = String(texte ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const coupe = t.slice(0, max);
  return `${coupe.slice(0, Math.max(coupe.lastIndexOf(' '), max - 20)).trimEnd()}…`;
}

/** Une ligne de la boîte de réception. */
export function ligne(o) {
  const dest = lien(o, 'destinataire');
  const tiers = lien(o, 'tiers');
  const expediteur = val(o, 'expediteur') ?? sansDemo(tiers?.nom) ?? '';
  return {
    id: o.id,
    expediteur: sansDemo(expediteur) || 'Expéditeur inconnu',
    initiales: initiales(expediteur),
    objet: val(o, 'objet') ?? sansDemo(o.nom),
    apercu: apercu(val(o, 'resume')),
    bac: val(o, 'bac') ?? 'autre',
    urgent: val(o, 'urgence') === 'haute',
    urgence: val(o, 'urgence') ?? 'normale',
    recuLe: val(o, 'recu_le'),
    traite: val(o, 'statut') === 'traité',
    action: val(o, 'action'),
    destinataire: dest ? { id: dest.id, nom: sansDemo(dest.nom) } : null,
    tiers: tiers ? { id: tiers.id, nom: sansDemo(tiers.nom) } : null,
    exemple: o.mode === 'demo',
  };
}

/** Courriers d'un monde, en lignes. */
export const lignes = (m) => (m.objets ?? []).filter((o) => o.type === 'courrier').map(ligne);

/**
 * Filtre et tri de la boîte : { bac: 'tous'|bac, pour: 'tous'|id, traites: bool, recherche }.
 * Ordre : à traiter d'abord, urgents d'abord, puis du plus récent au plus ancien.
 */
export function boite(toutes, { bac = 'tous', pour = 'tous', traites = false, recherche = '' } = {}) {
  const q = String(recherche).trim().toLowerCase();
  return toutes
    .filter((l) => (traites || !l.traite) && (bac === 'tous' || l.bac === bac) && (pour === 'tous' || l.destinataire?.id === pour)
      && (!q || [l.expediteur, l.objet, l.apercu].some((t) => String(t).toLowerCase().includes(q))))
    .sort((a, b) => Number(a.traite) - Number(b.traite) || (RANG_URGENCE[a.urgence] ?? 1) - (RANG_URGENCE[b.urgence] ?? 1) || String(b.recuLe ?? '').localeCompare(String(a.recuLe ?? '')));
}

/** Compteurs par bac (à traiter seulement) ; les bacs sans aucun courrier sont omis. */
export function bacs(toutes) {
  const ouverts = toutes.filter((l) => !l.traite);
  return BACS.filter((b) => toutes.some((l) => l.bac === b)).map((b) => ({ id: b, libelle: libelleBac(b), nb: ouverts.filter((l) => l.bac === b).length, urgents: ouverts.filter((l) => l.bac === b && l.urgent).length }));
}

/** Destinataires connus (pour « Pour qui » et « Déléguer à… »). */
export function destinataires(toutes) {
  return [...new Map(toutes.filter((l) => l.destinataire).map((l) => [l.destinataire.id, l.destinataire])).values()].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/**
 * Balayage d'une ligne (toucher) : au-delà du seuil, l'action est déclenchée au relâcher. Vers la droite : « Traité »
 * (ou « À traiter » si déjà traité) ; vers la gauche : « Déléguer ». En dessous : retour à la place, rien ne se passe.
 */
export const SEUIL_BALAYAGE = 0.35;
export function issueBalayage(dx, largeur, { traite = false } = {}) {
  if (!largeur || Math.abs(dx) < largeur * SEUIL_BALAYAGE) return null;
  return dx > 0 ? (traite ? 'remettre' : 'traiter') : 'deleguer';
}

/** Date courte d'une ligne : l'heure aujourd'hui, « hier », sinon « 3 nov. ». */
export function dateCourte(iso, maintenant = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const jour = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (jour(d) === jour(maintenant)) return `${d.getHours()} h ${String(d.getMinutes()).padStart(2, '0')}`;
  const hier = new Date(maintenant);
  hier.setDate(hier.getDate() - 1);
  if (jour(d) === jour(hier)) return 'hier';
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(d.getFullYear() !== maintenant.getFullYear() ? { year: 'numeric' } : {}) });
}
