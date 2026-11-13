/**
 * Fichier des Écritures Comptables (FEC, art. A47 A-1 du LPF) : export OBLIGATOIRE de tout logiciel comptable français
 * (Sage, EBP, Cegid, Ciel, Quadra, ACD, Pennylane, Tiime…). Un seul fichier, produit par l'entreprise elle-même :
 * aucun compte ni accès à donner, ni chez l'éditeur ni chez le logiciel.
 *
 * Seuls des TOTAUX en sortent (chiffre d'affaires, marge, trésorerie…) ; aucune écriture, aucun nom de tiers n'est conservé.
 * Comptes du plan comptable général : 6 charges, 7 produits, 51/53 trésorerie, 40 fournisseurs, 41 clients,
 * 16-17 emprunts, 10-14 capitaux propres. Montants « Debit/Credit » ou « Montant/Sens », virgule décimale, tabulation ou « | ».
 */

export interface SyntheseFec {
  debut: string;
  fin: string;
  mois: number;
  lignes: number;
  /** Chiffre d'affaires HT de la période (comptes 70). */
  chiffreAffaires: number;
  /** Achats consommés de marchandises et matières (601, 602, 603, 607, 609). */
  achatsConsommes: number;
  /** Charges décaissables de la période (classe 6 hors dotations 68 et valeurs de cession 675). */
  chargesDecaissables: number;
  masseSalariale: number;
  resultat: number;
  tresorerie: number;
  creancesClients: number;
  dettesFournisseurs: number;
  dettesFinancieres: number;
  capitauxPropres: number;
}

export interface ValeursFiche {
  tresorerie: number;
  charges_mensuelles: number;
  chiffre_affaires_annuel: number;
  marge_brute: number | null;
  resultat_net: number;
  creances_clients: number;
  dettes_fournisseurs: number;
  dettes_financieres: number;
  capitaux_propres: number;
  comptabilite_au: string;
}

export class ErreurFec extends Error {}

const normaliser = (x: string) => x.trim().replace(/^﻿/, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function montant(x: string | undefined): number {
  const v = (x ?? '').trim().replace(/[\s  ]/g, '');
  if (!v) return 0;
  // « 1.234,56 » ou « 1234,56 » ou « 1234.56 »
  const n = Number(v.includes(',') ? v.replace(/\./g, '').replace(',', '.') : v);
  if (!Number.isFinite(n)) throw new ErreurFec(`Montant illisible : « ${x} ».`);
  return n;
}

/** AAAAMMJJ (ou AAAA-MM-JJ, JJ/MM/AAAA) → AAAA-MM-JJ, ou null. */
function dateFec(x: string | undefined): string | null {
  const v = (x ?? '').trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

const commence = (compte: string, prefixes: readonly string[]) => prefixes.some((p) => compte.startsWith(p));

/** Lit un FEC (texte déjà décodé) et en tire les totaux utiles au score de santé. */
export function lireFec(texte: string): SyntheseFec {
  const lignesBrutes = texte.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lignesBrutes.length < 2) throw new ErreurFec('Fichier vide : exportez le FEC depuis votre logiciel comptable.');
  const entete = lignesBrutes[0] as string;
  const sep = entete.includes('\t') ? '\t' : entete.includes('|') ? '|' : entete.includes(';') ? ';' : null;
  if (!sep) throw new ErreurFec('Ce fichier n’est pas un FEC (colonnes séparées par tabulation ou « | »).');
  const cols = entete.split(sep).map(normaliser);
  const idx = (nom: string) => cols.indexOf(nom);
  const iCompte = idx('comptenum');
  const iDate = idx('ecrituredate');
  const iDebit = idx('debit');
  const iCredit = idx('credit');
  const iMontant = idx('montant');
  const iSens = idx('sens');
  if (iCompte < 0 || iDate < 0 || ((iDebit < 0 || iCredit < 0) && (iMontant < 0 || iSens < 0))) {
    throw new ErreurFec('Colonnes du FEC introuvables (CompteNum, EcritureDate, Debit/Credit). Exportez le « Fichier des écritures comptables » de votre logiciel.');
  }
  if (lignesBrutes.length > 2_000_001) throw new ErreurFec('Fichier trop volumineux (2 millions d’écritures au plus).');

  const soldes = new Map<string, number>(); // solde débiteur (débit − crédit) par compte
  let debut = '';
  let fin = '';
  let n = 0;
  for (let k = 1; k < lignesBrutes.length; k++) {
    const c = (lignesBrutes[k] as string).split(sep);
    const compte = (c[iCompte] ?? '').trim().replace(/\s/g, '');
    if (!/^\d/.test(compte)) continue;
    let solde: number;
    if (iDebit >= 0 && iCredit >= 0) solde = montant(c[iDebit]) - montant(c[iCredit]);
    else {
      const m = montant(c[iMontant]);
      const sens = (c[iSens] ?? '').trim().toUpperCase();
      solde = sens === 'D' || sens === '+1' || sens === '1' ? m : -m;
    }
    soldes.set(compte, (soldes.get(compte) ?? 0) + solde);
    n++;
    // les à-nouveaux sont datés du 1er jour de l'exercice : ils en marquent le début
    const d = dateFec(c[iDate]);
    if (d) {
      if (!debut || d < debut) debut = d;
      if (!fin || d > fin) fin = d;
    }
  }
  if (!n) throw new ErreurFec('Aucune écriture lisible dans ce fichier.');
  if (!debut) throw new ErreurFec('Dates d’écriture illisibles (format AAAAMMJJ attendu).');

  const total = (prefixes: readonly string[], sauf: readonly string[] = []) => {
    let t = 0;
    for (const [compte, s] of soldes) if (commence(compte, prefixes) && !commence(compte, sauf)) t += s;
    return t;
  };
  const chiffreAffaires = -total(['70']);
  const produits = -total(['7']);
  const charges = total(['6']);
  const d0 = Date.parse(`${debut}T00:00:00Z`);
  const d1 = Date.parse(`${fin}T00:00:00Z`);
  const mois = Math.max(1, Math.min(24, Math.round((d1 - d0 + 86_400_000) / (30.44 * 86_400_000)) || 1));
  const resultat = produits - charges;
  return {
    debut, fin, mois, lignes: n,
    chiffreAffaires,
    achatsConsommes: total(['601', '602', '603', '607', '609']),
    chargesDecaissables: total(['6'], ['68', '675']),
    masseSalariale: total(['64']),
    resultat,
    tresorerie: total(['51', '53']),
    creancesClients: total(['41']),
    dettesFournisseurs: -total(['40']),
    dettesFinancieres: -total(['16', '17']),
    // résultat de l'exercice ajouté tant qu'il n'est pas affecté (comptes de gestion encore soldés)
    capitauxPropres: -total(['10', '11', '12', '13', '14']) + (soldes.size && (charges || produits) ? resultat : 0),
  };
}

const arrondi = (x: number) => Math.round(x);

/** Valeurs de la fiche entreprise déduites du FEC (annualisées si la période est plus courte qu'un an). */
export function valeursFiche(s: SyntheseFec): ValeursFiche {
  const annuel = 12 / s.mois;
  return {
    tresorerie: arrondi(s.tresorerie),
    charges_mensuelles: arrondi(Math.max(0, s.chargesDecaissables) / s.mois),
    chiffre_affaires_annuel: arrondi(s.chiffreAffaires * annuel),
    marge_brute: s.chiffreAffaires > 0 ? Math.round(((s.chiffreAffaires - s.achatsConsommes) / s.chiffreAffaires) * 1000) / 10 : null,
    resultat_net: arrondi(s.resultat * annuel),
    creances_clients: arrondi(Math.max(0, s.creancesClients)),
    dettes_fournisseurs: arrondi(Math.max(0, s.dettesFournisseurs)),
    dettes_financieres: arrondi(Math.max(0, s.dettesFinancieres)),
    capitaux_propres: arrondi(s.capitauxPropres),
    comptabilite_au: s.fin,
  };
}
