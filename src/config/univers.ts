/**
 * Chargement d'un univers depuis `univers/<id>.json`, avec héritage (`herite`).
 * Un univers d'entreprise = un fichier JSON de surcharge : pas de code à écrire.
 */
import { readFile } from 'node:fs/promises';
import { ErreurUnivers, personnaliser, validerUnivers, type Univers } from '../core/univers.ts';

const ID = /^[a-z][a-z0-9_]{0,39}$/;
const PROFONDEUR_MAX = 5;

export const DOSSIER_UNIVERS = new URL('../../univers/', import.meta.url);

export async function chargerUnivers(id: string, dossier: URL = DOSSIER_UNIVERS, profondeur = 0): Promise<Univers> {
  if (!ID.test(id)) throw new ErreurUnivers([`identifiant d'univers invalide : ${JSON.stringify(id)}`]);
  if (profondeur > PROFONDEUR_MAX) throw new ErreurUnivers(['héritage trop profond ou circulaire']);
  const brut: unknown = JSON.parse(await readFile(new URL(`${id}.json`, dossier), 'utf8'));
  const herite = typeof brut === 'object' && brut !== null ? (brut as { herite?: unknown }).herite : undefined;
  if (herite === undefined) return validerUnivers(brut);
  if (typeof herite !== 'string') throw new ErreurUnivers(['herite : texte attendu']);
  return personnaliser(await chargerUnivers(herite, dossier, profondeur + 1), brut);
}
