/* Living Business — lire les trois champs sur la photo d'un justificatif.

   Module PUR : aucun accès au DOM, au réseau, au moteur de lecture ni au stockage. Il reçoit du TEXTE — celui qu'un
   moteur de lecture a trouvé sur la photo, ligne par ligne, avec la confiance de chaque ligne — et répond trois
   choses : le montant, la date et le fournisseur. Testé sans navigateur par src/ds/lecture-photo.test.ts.

   ON NE TRANSCRIT PAS LE TICKET, ON CHERCHE TROIS CHOSES. Un ticket de caisse froissé photographié de travers se lit
   mal : viser trois champs tolère les trous, là où une transcription fidèle échouerait. Le montant se trouve près de
   « TOTAL », « TTC », « NET À PAYER » ; la date aux formats français ; le
   fournisseur dans l'en-tête, et mieux encore quand c'est un fournisseur déjà saisi ici.
   Formats visés : « 47,90 € », « 1 234,56 », « jj/mm/aaaa », « jj.mm.aa », « 14 mars 2026 ».

   JAMAIS FAUX EN SILENCE. Chaque champ est PROPOSÉ, jamais enregistré, et reste modifiable. Quand la confiance est
   basse, ou quand deux lectures se contredisent, le champ reste VIDE et `silence` dit pourquoi, en français : un
   montant faux qui part chez le comptable est bien pire qu'un champ à taper. */

/** Confiance (0 à 100, celle du moteur de lecture) en dessous de laquelle une ligne ne sert à rien. */
export const CONFIANCE_LIGNE_MIN = 55;
/** Confiance qu'un champ doit atteindre pour être proposé. En dessous : champ vide. */
export const SEUILS = Object.freeze({ montant: 0.7, date: 0.7, fournisseur: 0.72 });
/** Montant au plus (au-delà, c'est une référence, un code-barres ou une lecture fautive, pas un justificatif). */
export const MONTANT_MAX = 1_000_000;
/** Un justificatif plus vieux que ça n'est plus une dépense de l'exercice : une telle date est une lecture fautive. */
export const ANS_MAX = 10;

// ---------------------------------------------------------------- texte reçu du moteur

/** Sans accent, en capitales : c'est là qu'on cherche les mots-clés, pour que « À PAYER » marche sans son accent. */
const plat = (t) => String(t ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();

/** Caractères de contrôle et de direction retirés, espaces conservés (ils portent les colonnes). */
const sansControle = (t) => String(t ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').replace(/[  ]/g, ' ').trim();
/** Une ligne lisible : espaces resserrés en plus. */
const uneLigne = (t) => sansControle(t).replace(/\s+/g, ' ');
/**
 * Une facture a deux colonnes en haut : le nom à gauche, « FACTURE N° … » à droite. Le moteur rend les deux sur la
 * MÊME ligne, séparées par un blanc large. On les sépare ici, sinon le nom proposé traîne un numéro de facture.
 */
const colonnes = (t) => sansControle(t).split(/\s{3,}/).map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);

/**
 * Lettres que le moteur confond avec des chiffres, réparées SEULEMENT dans un groupe qui est déjà presque un nombre
 * (« 47,9O » → « 47,90 », « 1OO,OO » → « 100,00 »). Un mot entier n'est jamais touché : « TOTAL » reste « TOTAL ».
 */
const CONFUSIONS = { O: '0', Q: '0', D: '0', I: '1', L: '1', '|': '1', '!': '1', S: '5', B: '8', Z: '2', G: '6' };
const NOMBRE_ABIME = /^[0-9OQDILS BZG|!.,  ]*[0-9][0-9OQDILS BZG|!.,  ]*$/;

/** Le groupe, réparé, et si on a dû le réparer (ce qui fait baisser la confiance du champ). */
function reparerNombres(ligne) {
  let repare = false;
  const sortie = ligne.split(' ').map((groupe) => {
    const haut = plat(groupe);
    if (!/[0-9]/.test(haut) || !/[OQDILSBZG|!]/.test(haut) || !NOMBRE_ABIME.test(haut)) return groupe;
    repare = true;
    return haut.replace(/[OQDILSBZG|!]/g, (c) => CONFUSIONS[c] ?? c);
  }).join(' ');
  return { texte: sortie, repare };
}

/**
 * Les lignes à examiner, dans l'ordre de la photo. `entree` : le texte entier (les sauts de ligne séparent), ou
 * `{ lignes: [{ texte, confiance }] }` tel que le moteur le donne — la confiance par ligne est ce qui permet de
 * laisser un champ vide au lieu de deviner.
 */
export function lignesDuTexte(entree) {
  const brutes = typeof entree === 'string' || entree === null || entree === undefined
    ? String(entree ?? '').split(/\r?\n/).map((texte) => ({ texte, confiance: 100 }))
    : Array.isArray(entree?.lignes) ? entree.lignes
      : String(entree?.texte ?? '').split(/\r?\n/).map((texte) => ({ texte, confiance: 100 }));
  const lignes = [];
  for (const l of brutes) {
    const texte = uneLigne(typeof l === 'string' ? l : l?.texte);
    if (!texte) continue;
    const confiance = Number.isFinite(Number(l?.confiance)) ? Math.max(0, Math.min(100, Number(l.confiance))) : 100;
    const { texte: nombres, repare } = reparerNombres(texte);
    lignes.push({ texte, confiance, repare, nombres, clef: plat(nombres), colonnes: colonnes(typeof l === 'string' ? l : l?.texte), rang: lignes.length });
  }
  return lignes;
}

/**
 * Ce que la confiance du moteur fait au score d'un champ : en dessous de `CONFIANCE_LIGNE_MIN` la ligne ne compte
 * pas du tout ; au-dessus elle pèse de 0,8 (lecture tout juste lisible) à 1 (lecture franche).
 */
function facteur(confiance) {
  if (confiance < CONFIANCE_LIGNE_MIN) return 0;
  return 0.8 + 0.2 * Math.min(1, (confiance - CONFIANCE_LIGNE_MIN) / 35);
}

// ---------------------------------------------------------------- le montant

/** Mots qui annoncent le montant à payer, du plus sûr au moins sûr. Écrits large : le moteur abîme les lettres. */
const MOTS_MONTANT = [
  { score: 0.95, indice: 'NET À PAYER', motif: /(NET\s*)?[A4]\s*P[A4]Y[E3]R|M[O0]NT[A4]NT\s*D[UÛ]|RESTE\s*[A4]\s*P[A4]Y[E3]R/ },
  { score: 0.9, indice: 'TOTAL TTC', motif: /T[O0C][T7][A4R]L\s*(G[E3]N[E3]R[A4]L\s*)?T\.?[T7]\.?C|M[O0]NT[A4]NT\s*T\.?[T7]\.?C|T[O0C][T7][A4R]L\s*(EUR|€)/ },
  { score: 0.75, indice: 'TOTAL', motif: /T[O0C][T7][A4R]L|M[O0]NT[A4]NT|S[O0]MM[E3]\s*DU/ },
];
/** Lignes qui portent un nombre en euros SANS être le montant du justificatif : on ne les regarde pas. */
const MOTS_PAS_MONTANT = /T[O0C][T7][A4R]L\s*H\.?T|M[O0]NT[A4]NT\s*H\.?T|S[O0]US[\s-]*T[O0C][T7][A4R]L|T\.?V\.?A|D[O0]NT\s*TVA|B[A4]S[E3]\s*H\.?T|[E3]SP[E3]C[E3]S|R[E3]NDU|M[O0]NN[A4]I[E3]|R[E3]MIS[E3]|[A4]C[O0]MPT[E3]|[A4]V[O0]IR|R[E3]F|QU[A4]NTIT[E3]/;

/** Nombres en euros d'une ligne, à la française (« 47,90 », « 1 234,56 », « 1.234,56 ») comme à l'anglaise (« 47.90 »). */
const NOMBRES = /(?<![\d])(\d{1,3}(?:[   .]\d{3})*|\d{1,7})[,.](\d{2})(?!\d)/g;

/** Les montants écrits sur une ligne, dans l'ordre. Les tickets alignent à droite : le dernier est le bon. */
function montantsDeLaLigne(ligne) {
  const res = [];
  for (const m of ligne.nombres.matchAll(NOMBRES)) {
    const n = Number(`${m[1].replace(/[   .]/g, '')}.${m[2]}`);
    if (Number.isFinite(n) && n > 0 && n <= MONTANT_MAX) res.push(Math.round(n * 100) / 100);
  }
  return res;
}

/**
 * Le montant à payer, ou null. Cherché près d'un mot qui l'annonce : sans ce mot, on ne propose RIEN — un nombre
 * pris au hasard sur un ticket, c'est une erreur de comptabilité, pas une aide.
 */
export function montantSurLaPhoto(lignes) {
  const trouves = [];
  for (const l of lignes) {
    if (MOTS_PAS_MONTANT.test(l.clef) && !/T\.?[T7]\.?C|P[A4]Y[E3]R/.test(l.clef)) continue;
    const mot = MOTS_MONTANT.find((m) => m.motif.test(l.clef));
    if (!mot) continue;
    const f = facteur(l.confiance);
    if (!f) continue;
    // le nombre est sur la ligne du mot ; parfois sur la suivante (le moteur coupe une colonne alignée à droite)
    let sur = montantsDeLaLigne(l);
    let suite = false;
    if (!sur.length) {
      const apres = lignes[l.rang + 1];
      if (!apres || MOTS_PAS_MONTANT.test(apres.clef) || !facteur(apres.confiance)) continue;
      sur = montantsDeLaLigne(apres);
      suite = true;
      if (!sur.length) continue;
    }
    const valeur = sur[sur.length - 1];
    const plusieursSurLaLigne = sur.length > 1 ? 0.9 : 1;
    trouves.push({ valeur, score: mot.score * f * plusieursSurLaLigne * (l.repare ? 0.9 : 1) * (suite ? 0.95 : 1), indice: mot.indice });
  }
  if (!trouves.length) return { valeur: null, confiance: 0, indice: '', silence: 'Le total n’a pas été trouvé sur la photo.' };
  const meilleur = trouves.reduce((a, b) => (b.score > a.score ? b : a));
  // deux lectures aussi sûres qui ne disent pas la même somme : on ne tranche pas à la place de la personne
  const concurrents = trouves.filter((t) => t.score >= meilleur.score - 0.01 && t.valeur !== meilleur.valeur);
  if (concurrents.length) return { valeur: null, confiance: 0, indice: '', silence: 'Plusieurs totaux différents ont été lus : à saisir à la main.' };
  if (meilleur.score < SEUILS.montant) return { valeur: null, confiance: meilleur.score, indice: '', silence: 'Le total lu n’est pas assez net pour être proposé.' };
  return { valeur: meilleur.valeur, confiance: meilleur.score, indice: meilleur.indice, silence: '' };
}

// ---------------------------------------------------------------- la date

const MOIS = {
  JANVIER: 1, JANV: 1, JAN: 1, FEVRIER: 2, FEVR: 2, FEV: 2, MARS: 3, AVRIL: 4, AVR: 4, MAI: 5, JUIN: 6,
  JUILLET: 7, JUIL: 7, AOUT: 8, SEPTEMBRE: 9, SEPT: 9, SEP: 9, OCTOBRE: 10, OCT: 10, NOVEMBRE: 11, NOV: 11,
  DECEMBRE: 12, DEC: 12,
};
const NOMS_MOIS = Object.keys(MOIS).sort((a, b) => b.length - a.length).join('|');
/** jj/mm/aaaa, jj-mm-aa, jj.mm.aaaa — et pas un morceau de numéro de téléphone (02.98.12.03.24) ni de référence. */
const DATE_CHIFFRES = /(?<![\d./-])(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?![\d./-])/g;
/** 14 mars 2026, 3 déc. 25 */
const DATE_MOIS = new RegExp(`(?<![\\d])(\\d{1,2})(?:ER)?\\s+(${NOMS_MOIS})\\.?\\s+(\\d{4}|\\d{2})(?!\\d)`, 'g');
/** 2026-03-14 (certaines caisses l'impriment ainsi) */
const DATE_ISO = /(?<![\d-])(\d{4})-(\d{2})-(\d{2})(?![\d-])/g;

const MOTS_DATE = /\bD[A4][T7][E3]\b|F[A4]C[T7]UR[E3]\s*DU|[E3]MIS[E3]\s*L[E3]|LIVR[E3]\s*L[E3]|V[E3]NDU\s*L[E3]|L[E3]\s*\d/;
/** Une date qui n'est pas celle du justificatif : échéance, validité, date limite, expiration de la carte. */
const MOTS_PAS_DATE = /[E3]CH[E3][A4]NC[E3]|[A4]V[A4]NT\s*L[E3]|V[A4]L[A4]BL[E3]|V[A4]LIDIT[E3]|[E3]XP|DLC|DLU[O0]|[A4]\s*C[O0]NS[O0]MM[E3]R|P[E3]R[E3]MP/;

/** Jour réel du calendrier, en AAAA-MM-JJ ; null quand la date n'existe pas (32/13, 30 février). */
export function jourValide(annee, mois, jour) {
  if (!(annee >= 1970 && annee <= 2999) || !(mois >= 1 && mois <= 12) || !(jour >= 1 && jour <= 31)) return null;
  const iso = `${String(annee).padStart(4, '0')}-${String(mois).padStart(2, '0')}-${String(jour).padStart(2, '0')}`;
  return new Date(`${iso}T00:00:00Z`).toISOString().startsWith(iso) ? iso : null;
}

/** Une année à deux chiffres se lit dans ce siècle ; la vraisemblance (plus bas) écarte ce qui tomberait trop loin. */
const anneeEntiere = (t) => (t.length === 4 ? Number(t) : 2000 + Number(t));

/** Les jours écrits sur une ligne, déjà vérifiés au calendrier. */
function datesDeLaLigne(ligne, bornes) {
  const res = [];
  const garder = (iso) => { if (iso && iso >= bornes.plusVieux && iso <= bornes.plusRecent && !res.includes(iso)) res.push(iso); };
  for (const m of ligne.nombres.matchAll(DATE_CHIFFRES)) garder(jourValide(anneeEntiere(m[3]), Number(m[2]), Number(m[1])));
  for (const m of ligne.clef.matchAll(DATE_MOIS)) garder(jourValide(anneeEntiere(m[3]), MOIS[m[2]], Number(m[1])));
  for (const m of ligne.nombres.matchAll(DATE_ISO)) garder(jourValide(Number(m[1]), Number(m[2]), Number(m[3])));
  return res;
}

/**
 * La date du justificatif, ou null. `aujourdhui` (AAAA-MM-JJ) borne le vraisemblable : un justificatif n'est pas daté
 * de l'an prochain, et une facture de plus de dix ans ne se saisit pas sur un chantier.
 */
export function dateSurLaPhoto(lignes, { aujourdhui = '' } = {}) {
  const base = /^\d{4}-\d{2}-\d{2}$/.test(String(aujourdhui)) ? String(aujourdhui) : new Date().toISOString().slice(0, 10);
  const demain = new Date(`${base}T00:00:00Z`);
  demain.setUTCDate(demain.getUTCDate() + 1);
  const vieux = new Date(`${base}T00:00:00Z`);
  vieux.setUTCFullYear(vieux.getUTCFullYear() - ANS_MAX);
  const bornes = { plusRecent: demain.toISOString().slice(0, 10), plusVieux: vieux.toISOString().slice(0, 10) };

  const trouves = [];
  for (const l of lignes) {
    if (MOTS_PAS_DATE.test(l.clef)) continue;
    const f = facteur(l.confiance);
    if (!f) continue;
    const annonce = MOTS_DATE.test(l.clef);
    for (const iso of datesDeLaLigne(l, bornes)) {
      trouves.push({ valeur: iso, score: (annonce ? 0.92 : 0.78) * f * (l.repare ? 0.9 : 1), indice: annonce ? 'Date' : 'date lue sur la photo' });
    }
  }
  if (!trouves.length) return { valeur: null, confiance: 0, indice: '', silence: 'La date n’a pas été trouvée sur la photo.' };
  const meilleur = trouves.reduce((a, b) => (b.score > a.score ? b : a));
  const concurrents = trouves.filter((t) => t.score >= meilleur.score - 0.01 && t.valeur !== meilleur.valeur);
  if (concurrents.length) return { valeur: null, confiance: 0, indice: '', silence: 'Plusieurs dates ont été lues : à saisir à la main.' };
  if (meilleur.score < SEUILS.date) return { valeur: null, confiance: meilleur.score, indice: '', silence: 'La date lue n’est pas assez nette pour être proposée.' };
  return { valeur: meilleur.valeur, confiance: meilleur.score, indice: meilleur.indice, silence: '' };
}

// ---------------------------------------------------------------- le fournisseur

/** Lignes d'en-tête examinées : le nom est en haut, jamais au milieu de la liste des articles. */
export const LIGNES_ENTETE = 8;
/** Mentions d'un ticket ou d'une facture : ce n'est pas le nom du fournisseur. */
const PAS_UN_NOM = /^([A4]?\s*F[A4]C[T7]UR[E3]\b.*|[T7]ICK[E3][T7]\b.*|R[E3]CU|DUPLIC[A4]T[A4]|C[O0]PI[E3]|D[E3]VIS|B[O0]N\b.*|CLI[E3]NT|V[E3]ND[E3]UR|C[A4]ISS[E3]|M[E3]RCI\b.*|BI[E3]NV[E3]NU[E3]\b.*|[A4]U\s*R[E3]V[O0]IR|[A4]\s*BI[E3]NT[O0]T|T[E3]L\b.*|T[E3]L[E3]PH[O0]N[E3]\b.*|F[A4]X\b.*|[A4]DR[E3]SS[E3]\b.*|SIR[E3][T7]\b.*|SIR[E3]N\b.*|[A4]P[E3]\b.*|N[A4]F\b.*|RCS\b.*|TV[A4]\b.*|T[O0C][T7][A4R]L\b.*|M[O0]NT[A4]NT\b.*|[E3]UR[O0]?S?|M[A4]G[A4]SIN|N\s*°.*|S[A4]RL|S[A4]SU?|[E3]URL|S[A4]|SCI)$/;
/** Formes juridiques : sur une ligne COURTE, c'est à coup sûr la raison sociale. */
const FORME = /\b(S[A4]RL|S[A4]SU?|[E3]URL|S[A4]\b|SNC|SCI|SC[O0]P|[E3][T7]S|S[T7][E3]|GI[E3]|[A4]SS[O0]CI[A4][T7]I[O0]N)\b/;
/**
 * Mentions légales et adresse : elles entourent le nom en haut d'une facture sans jamais être le nom. Le code postal
 * (cinq chiffres) suffit à reconnaître une ligne d'adresse ; « au capital de » une mention de statuts.
 */
const MENTION = /[A4]U\s*C[A4]PI[T7][A4]L|C[A4]PI[T7][A4]L\s*D[E3]|\bRCS\b|SIR[E3][T7]|SIR[E3]N|IN[T7]R[A4]C[O0]M|\b[A4]P[E3]\b|\bN[A4]F\b|\b\d{5}\b|\bT[E3]L\b|\bF[A4]X\b|\bM[A4]IL\b|@|WWW|H[T7][T7]P|\b(RU[E3]|[A4]V[E3]NU[E3]|B[O0]UL[E3]V[A4]RD|IMP[A4]SS[E3]|R[O0]U[T7][E3]|CH[E3]MIN|PL[A4]C[E3]|Z[A4]C?|ZI|BP|[A4]LL[E3][E3]|QU[A4]I|LI[E3]U[\s-]*DI[T7])\b/;

/**
 * Ce qu'un nom d'entreprise peut contenir : des lettres, des chiffres, et une poignée de signes (« Dupont & Fils »,
 * « Ty Glaz », « L'Atelier »). Une parenthèse ou une barre au milieu d'un nom, c'est le moteur qui s'est trompé sur
 * une lettre (« MENUISER(E ») : on préfère un champ vide à un nom faux.
 */
const CARACTERES_DE_NOM = /^[\p{L}\p{N} .,&'’-]+$/u;

/** Comparaison de noms : sans accent, sans ponctuation, sans espace — « Point-P » et « POINT P » se reconnaissent. */
export const nomAplati = (t) => plat(t).replace(/[^A-Z0-9]/g, '');

/**
 * Le fournisseur, ou ''. Un fournisseur DÉJÀ SAISI ici et reconnu dans l'en-tête est proposé avec son orthographe
 * d'origine : c'est le cas le plus fréquent (on retourne au même dépôt), et le plus sûr.
 */
export function fournisseurSurLaPhoto(lignes, { fournisseursConnus = [] } = {}) {
  const connus = (fournisseursConnus ?? []).map((n) => ({ nom: uneLigne(n), plat: nomAplati(n) })).filter((x) => x.plat.length >= 4);
  const entete = lignes.slice(0, LIGNES_ENTETE);

  for (const l of entete) {
    if (!facteur(l.confiance)) continue;
    for (const col of (l.colonnes ?? [l.texte])) {
      const aplati = nomAplati(col);
      const connu = connus.find((c) => aplati.includes(c.plat) || (aplati.length >= 4 && c.plat.includes(aplati)));
      if (connu) return { valeur: connu.nom, confiance: 0.95, indice: 'fournisseur déjà saisi ici', silence: '' };
    }
  }

  const candidats = [];
  for (const l of entete) {
    const f = facteur(l.confiance);
    // un nom ne se vérifie pas d'un coup d'œil comme un montant : en dessous de 70, on ne le propose pas
    if (!f || l.confiance < 70) continue;
    for (const col of (l.colonnes ?? [l.texte])) {
      const t = col.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.&'’-]+$/gu, '');
      if (t.length < 3 || t.length > 60 || !CARACTERES_DE_NOM.test(t)) continue;
      const lettres = (t.match(/\p{L}/gu) ?? []).length;
      const chiffres = (t.match(/\d/gu) ?? []).length;
      if (lettres < 3 || chiffres > lettres) continue;
      if (PAS_UN_NOM.test(plat(t)) || MENTION.test(plat(t))) continue;
      const colonne = { nombres: reparerNombres(t).texte, clef: plat(t) };
      if (montantsDeLaLigne(colonne).length || datesDeLaLigne(colonne, { plusVieux: '1900-01-01', plusRecent: '2999-12-31' }).length) continue;
      // la forme juridique ne compte que sur une ligne courte : « SARL au capital de… » est une mention, pas un nom
      const court = t.split(' ').length <= 5;
      const score = 0.8 * f * (court && FORME.test(plat(t)) ? 1.1 : 1) * (l.rang === 0 ? 1.05 : 1 - 0.03 * l.rang);
      candidats.push({ valeur: t, score: Math.min(1, score) });
    }
  }
  if (!candidats.length) return { valeur: '', confiance: 0, indice: '', silence: 'Le nom du fournisseur n’a pas été trouvé sur la photo.' };
  const meilleur = candidats.reduce((a, b) => (b.score > a.score ? b : a));
  if (meilleur.score < SEUILS.fournisseur) return { valeur: '', confiance: meilleur.score, indice: '', silence: 'Le nom lu en haut de la photo n’est pas assez net pour être proposé.' };
  return { valeur: meilleur.valeur, confiance: meilleur.score, indice: 'en-tête de la photo', silence: '' };
}

// ---------------------------------------------------------------- les trois champs

/**
 * Les trois champs lus sur une photo. `entree` : le texte du moteur (voir `lignesDuTexte`).
 * Options : `aujourdhui` (AAAA-MM-JJ, pour écarter une date invraisemblable) et `fournisseursConnus`.
 * Ce qui revient est une PROPOSITION : `silence` dit, champ par champ, pourquoi il reste vide.
 */
export function lireLaPhoto(entree, options = {}) {
  const lignes = lignesDuTexte(entree);
  const montant = montantSurLaPhoto(lignes);
  const date = dateSurLaPhoto(lignes, options);
  const fournisseur = fournisseurSurLaPhoto(lignes, options);
  const rien = montant.valeur === null && date.valeur === null && fournisseur.valeur === '';
  return {
    montant: montant.valeur,
    date: date.valeur,
    fournisseur: fournisseur.valeur,
    confiance: { montant: montant.confiance, date: date.confiance, fournisseur: fournisseur.confiance },
    indice: { montant: montant.indice, date: date.indice, fournisseur: fournisseur.indice },
    silence: { montant: montant.silence, date: date.silence, fournisseur: fournisseur.silence },
    rien,
    lignes: lignes.length,
  };
}

/** Ce qu'on dit quand la photo n'a rien donné. Sans jargon : la personne tape les trois champs, comme avant. */
export const RIEN_LU = 'Rien n’a pu être lu sur cette photo : les trois champs restent à remplir à la main.';

/**
 * Ce que l'écran affiche sous les champs : ce qui a été lu, et ce qui est resté vide. Une seule phrase, courte,
 * pour que personne ne croie que les trois champs ont été vérifiés par quelqu'un.
 */
export function direCeQuiEstLu(lu) {
  if (!lu || lu.rien) return RIEN_LU;
  const noms = [lu.montant !== null ? 'le montant' : null, lu.date ? 'la date' : null, lu.fournisseur ? 'le fournisseur' : null].filter(Boolean);
  const lus = noms.length === 1 ? noms[0] : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`;
  const vides = [lu.silence.montant, lu.silence.date, lu.silence.fournisseur].filter(Boolean);
  return `Lu sur la photo : ${lus}. À vérifier avant d’enregistrer.${vides.length ? ` ${vides.join(' ')}` : ''}`;
}
