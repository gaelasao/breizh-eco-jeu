/**
 * Import CSV (lot 1) : analyse, correspondance proposée colonne → champ de l'univers, conversion.
 * Excel : enregistrer en CSV (séparateur « ; » des Excel français détecté automatiquement).
 * Le fichier est une donnée non fiable : tailles bornées, aucune formule évaluée.
 */
import type { ValeurChamp } from '../core/model.ts';
import type { DefChamp, DefType } from '../core/univers.ts';

export const LIMITES_CSV = { octets: 1_000_000, lignes: 5000, colonnes: 60 } as const;

/** Cibles spéciales du mapping. */
export const NOM = '__nom';
export const ROLES = '__roles';

export function detecterSeparateur(premiereLigne: string): ',' | ';' | '\t' {
  const compte = (c: string) => premiereLigne.split(c).length - 1;
  const candidats = [';', ',', '\t'] as const;
  return candidats.reduce((a, b) => (compte(b) > compte(a) ? b : a));
}

/** RFC 4180 : guillemets, guillemets doublés, retours ligne dans un champ, CRLF, BOM. */
export function parserCsv(texte: string): string[][] {
  if (texte.length > LIMITES_CSV.octets) throw new RangeError('fichier trop volumineux (1 Mo max)');
  const t = texte.replace(/^﻿/, '');
  const sep = detecterSeparateur(t.slice(0, t.search(/\r?\n|$/)));
  const lignes: string[][] = [];
  let ligne: string[] = [];
  let champ = '';
  let guillemets = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (guillemets) {
      if (c === '"' && t[i + 1] === '"') { champ += '"'; i++; }
      else if (c === '"') guillemets = false;
      else champ += c;
      continue;
    }
    if (c === '"' && champ === '') guillemets = true;
    else if (c === sep) { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.some((x) => x.trim() !== '')) lignes.push(ligne);
      ligne = [];
      if (lignes.length > LIMITES_CSV.lignes + 1) throw new RangeError(`trop de lignes (${LIMITES_CSV.lignes} max)`);
    } else champ += c;
  }
  ligne.push(champ);
  if (ligne.some((x) => x.trim() !== '')) lignes.push(ligne);
  if (lignes.some((l) => l.length > LIMITES_CSV.colonnes)) throw new RangeError(`trop de colonnes (${LIMITES_CSV.colonnes} max)`);
  return lignes;
}

export function normaliser(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const ALIAS_NOM = ['nom', 'name', 'libelle', 'designation', 'raisonsociale', 'intitule', 'titre'];
const ALIAS_ROLES = ['role', 'roles', 'typedetiers', 'relation', 'categorie'];

/** Propose une correspondance ; l'utilisateur la valide ou la corrige avant import. */
export function proposerMapping(entetes: readonly string[], t: DefType): Record<string, string | null> {
  const pris = new Set<string>();
  const res: Record<string, string | null> = {};
  for (const e of entetes) {
    const n = normaliser(e);
    let cible: string | null = null;
    if (!pris.has(NOM) && ALIAS_NOM.includes(n)) cible = NOM;
    else if (t.famille === 'tiers' && !pris.has(ROLES) && ALIAS_ROLES.includes(n)) cible = ROLES;
    else {
      const c =
        t.champs.find((x) => !pris.has(x.id) && (normaliser(x.libelle) === n || normaliser(x.id) === n)) ??
        t.champs.find((x) => !pris.has(x.id) && n.length >= 4 && (normaliser(x.libelle).includes(n) || n.includes(normaliser(x.libelle))));
      cible = c?.id ?? null;
    }
    if (cible) pris.add(cible);
    res[e] = cible;
  }
  return res;
}

export type Conversion = { ok: true; valeur: ValeurChamp } | { ok: false; erreur: string };

const VRAI = ['oui', 'o', 'vrai', 'true', '1', 'x', 'yes'];
const FAUX = ['non', 'n', 'faux', 'false', '0', 'no'];

/** Convertit une cellule. Les références restent du texte (nom), résolues ensuite par la passerelle. */
export function convertir(brut: string, c: DefChamp): Conversion {
  const v = brut.trim();
  if (v === '') return { ok: true, valeur: null };
  switch (c.type) {
    case 'texte':
    case 'reference':
      return v.length <= 2000 ? { ok: true, valeur: v } : { ok: false, erreur: 'texte trop long' };
    case 'nombre':
    case 'montant': {
      const n = Number(v.replace(/[\s  €$%]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? { ok: true, valeur: n } : { ok: false, erreur: `« ${v} » n'est pas un nombre` };
    }
    case 'date': {
      const fr = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
      const iso = fr ? `${fr[3]}-${fr[2]?.padStart(2, '0')}-${fr[1]?.padStart(2, '0')}` : v;
      // un jour (2026-11-20), ou un jour et une heure à la minute (2026-11-20T09:00) : un rendez-vous a une heure,
      // une échéance n'en a pas. Les deux s'écrivent dans un champ « date », et se relisent tels quels.
      const m = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?$/.exec(iso);
      const jour = m ? new Date(`${m[1]}T00:00:00Z`) : null;
      const heure = m?.[2] ? Number(m[2].slice(0, 2)) * 60 + Number(m[2].slice(3)) : 0;
      return jour && !Number.isNaN(jour.getTime()) && jour.toISOString().startsWith(m?.[1] ?? '\u0000') && heure < 24 * 60
        ? { ok: true, valeur: m?.[2] ? `${m[1]}T${m[2]}` : (m?.[1] as string) }
        : { ok: false, erreur: `« ${v} » n'est pas une date (JJ/MM/AAAA)` };
    }
    case 'booleen': {
      const n = normaliser(v);
      if (VRAI.includes(n)) return { ok: true, valeur: true };
      if (FAUX.includes(n)) return { ok: true, valeur: false };
      return { ok: false, erreur: `« ${v} » : oui/non attendu` };
    }
    case 'choix': {
      const trouve = (c.choix ?? []).find((x) => normaliser(x) === normaliser(v));
      return trouve ? { ok: true, valeur: trouve } : { ok: false, erreur: `« ${v} » hors liste (${(c.choix ?? []).join(', ')})` };
    }
  }
}
