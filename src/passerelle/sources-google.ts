/**
 * Google Sheets par l'API Sheets (connexion « Se connecter avec Google » via le relais de Breizhcosystem).
 * Le jeton d'accès (portée `spreadsheets`) est celui de la personne connectée : seules les feuilles auxquelles elle a
 * déjà accès sont lisibles. Hôte fixe sheets.googleapis.com ; identifiant de la feuille validé avant d'entrer dans
 * l'adresse ; aucun jeton dans une adresse.
 * Écriture : une ligne existante n'est modifiée que sur les cellules synchronisées (les autres sont envoyées à null,
 * donc laissées telles quelles : formules conservées) ; une nouvelle fiche est ajoutée après le tableau (`:append`).
 * Un texte du jeu qui commence par « = » est écrit comme texte (préfixe ') : jamais de formule injectée dans la feuille.
 * Le mode « script dans la feuille » (Apps Script, `sources.ts`) reste disponible en mode avancé.
 */
import type { Enregistrement, ValeurSortante } from './sources.ts';
import { debutPlage, lettreColonne } from './sources-microsoft.ts';
import { appeler, ErreurSortante, type Recuperateur } from './sortant.ts';
import { lignesVersEnregistrements, sansFormule } from './tableau.ts';

type Config = Readonly<Record<string, string>>;
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const ID_FEUILLE = /^[A-Za-z0-9_-]{20,100}$/;

/** Identifiant d'une feuille Google à partir de son lien (barre d'adresse ou « Copier le lien »), ou l'identifiant seul. */
export function idFeuilleGoogle(brut: string | undefined): string {
  const t = (brut ?? '').trim();
  if (ID_FEUILLE.test(t)) return t;
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new ErreurSortante('Collez le lien de la feuille Google (https://docs.google.com/spreadsheets/d/…).');
  }
  const m = /^\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:\/|$)/.exec(u.pathname);
  if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || u.port !== '' || u.username || u.password || !m || t.length > 2000) {
    throw new ErreurSortante('Lien de feuille non reconnu : copiez l’adresse de la feuille dans Google Sheets (https://docs.google.com/spreadsheets/d/…).');
  }
  return m[1] as string;
}

/** Plage A1 sur un onglet : nom entre apostrophes (doublées à l'intérieur), ex. 'Mes clients'!B3:D3. */
export const plageGoogle = (onglet: string, cellules = '') => `'${onglet.replace(/'/g, "''")}'${cellules ? `!${cellules}` : ''}`;

/** Valeur envoyée : texte, nombre ou booléen ; un texte qui commencerait une formule est forcé en texte (`sansFormule`). */
function valeurGoogle(v: ValeurSortante | undefined): string | number | boolean {
  if (v === null || v === undefined) return '';
  return sansFormule(v) ?? '';
}

const entetesGoogle = (secret: string | null) => {
  if (!secret) throw new ErreurSortante('Connexion Google manquante : cliquez sur « Se connecter avec Google ».');
  return { authorization: `Bearer ${secret}` };
};

async function onglet(id: string, cfg: Config, entetes: Record<string, string>, f: Recuperateur): Promise<string> {
  const voulu = (cfg.feuille ?? '').trim();
  if (voulu) {
    if (voulu.length > 100 || /[\u0000-\u001f]/.test(voulu)) throw new ErreurSortante('Nom d’onglet invalide.');
    return voulu;
  }
  const u = new URL(`${API}/${id}`);
  u.searchParams.set('fields', 'sheets.properties.title');
  const { donnees } = await appeler(f, u, { entetes });
  const titre = (donnees as { sheets?: { properties?: { title?: unknown } }[] } | null)?.sheets?.[0]?.properties?.title;
  if (typeof titre !== 'string' || !titre) throw new ErreurSortante('Cette feuille Google n’a aucun onglet.');
  return titre;
}

interface PlageGoogle {
  id: string;
  onglet: string;
  entetes: Record<string, string>;
  lignes: string[][];
  /** Numéro (1 = première ligne) de la ligne d'en-têtes dans la feuille, et colonne de départ (0 = A). */
  ligne0: number;
  col0: number;
}

async function lirePlage(cfg: Config, secret: string | null, f: Recuperateur): Promise<PlageGoogle> {
  const id = idFeuilleGoogle(cfg.classeur);
  const entetes = entetesGoogle(secret);
  const nom = await onglet(id, cfg, entetes, f);
  const { donnees } = await appeler(f, new URL(`${API}/${id}/values/${encodeURIComponent(plageGoogle(nom))}`), { entetes, delaiMs: 30_000 });
  const d = donnees as { range?: unknown; values?: unknown } | null;
  // valeurs telles qu'affichées (FORMATTED_VALUE) ; une ligne illisible reste une ligne vide (numérotation conservée)
  let lignes = (Array.isArray(d?.values) ? d.values : []).slice(0, 20_001).map((l) => (Array.isArray(l) ? l.map((v) => (v === null || v === undefined ? '' : String(v))) : []));
  let { ligne0, col0 } = debutPlage(typeof d?.range === 'string' ? d.range : 'A1');
  const debut = lignes.findIndex((l) => l.some((x) => x.trim() !== ''));
  if (debut > 0) { lignes = lignes.slice(debut); ligne0 += debut; }
  return { id, onglet: nom, entetes, lignes, ligne0, col0 };
}

export async function lireFeuilleGoogle(cfg: Config, secret: string | null, f: Recuperateur): Promise<Enregistrement[]> {
  const p = await lirePlage(cfg, secret, f);
  return lignesVersEnregistrements(p.lignes, cfg.colonneId || undefined);
}

export async function ecrireFeuilleGoogle(cfg: Config, secret: string | null, externeId: string | null, valeurs: Record<string, ValeurSortante>, f: Recuperateur): Promise<string | null> {
  const p = await lirePlage(cfg, secret, f);
  const titres = (p.lignes[0] ?? []).map((x) => x.trim());
  if (!titres.some(Boolean)) throw new ErreurSortante('La feuille doit commencer par une ligne d’en-têtes.');
  const colonneId = cfg.colonneId || (titres[0] as string);
  const col = titres.indexOf(colonneId);
  if (col < 0) throw new ErreurSortante(`Colonne « ${colonneId} » absente de la feuille.`);
  const synchronise = (t: string) => t !== '' && Object.hasOwn(valeurs, t);
  const id = externeId ?? String(valeurs[colonneId] ?? '');
  const i = id ? p.lignes.findIndex((l, k) => k > 0 && (l[col] ?? '').trim() === id) : -1;
  if (i < 0) {
    const ligne = titres.map((t) => (synchronise(t) ? valeurGoogle(valeurs[t]) : ''));
    if (id && ligne[col] === '') ligne[col] = valeurGoogle(id);
    const u = new URL(`${API}/${p.id}/values/${encodeURIComponent(plageGoogle(p.onglet))}:append`);
    u.searchParams.set('valueInputOption', 'USER_ENTERED');
    u.searchParams.set('insertDataOption', 'INSERT_ROWS');
    await appeler(f, u, { methode: 'POST', entetes: p.entetes, corps: { majorDimension: 'ROWS', values: [ligne] } });
    return id || null;
  }
  const colonnes = titres.map((t, j) => (synchronise(t) ? j : -1)).filter((j) => j >= 0);
  if (!colonnes.length) return id;
  const a = Math.min(...colonnes);
  const b = Math.max(...colonnes);
  // null = cellule laissée telle quelle (formules des colonnes non synchronisées conservées)
  const ligne = titres.slice(a, b + 1).map((t) => (synchronise(t) ? valeurGoogle(valeurs[t]) : null));
  const n = p.ligne0 + i;
  const plage = plageGoogle(p.onglet, `${lettreColonne(p.col0 + a)}${n}:${lettreColonne(p.col0 + b)}${n}`);
  const u = new URL(`${API}/${p.id}/values/${encodeURIComponent(plage)}`);
  u.searchParams.set('valueInputOption', 'USER_ENTERED');
  await appeler(f, u, { methode: 'PUT', entetes: p.entetes, corps: { range: plage, majorDimension: 'ROWS', values: [ligne] } });
  return id;
}
