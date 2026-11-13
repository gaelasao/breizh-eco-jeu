/**
 * Alerte « clients en difficulté » : procédures collectives publiées au Bodacc (données publiques, gratuites).
 * - Activée par l'entreprise (opt-in) : seuls les SIREN de ses clients sont envoyés au service public, rien d'autre.
 * - Hôte fixe, HTTPS, délai et taille bornés (sortant.ts). Lots de 20 SIREN par requête.
 */
import type { ObjetMetier } from '../core/model.ts';
import { appeler, recuperateurProtege, verifierUrl, type Recuperateur } from './sortant.ts';

export interface AlerteBodacc {
  siren: string;
  objetId: string;
  nom: string;
  le: string;
  nature: string;
  tribunal: string | null;
  url: string | null;
}

const HOTE = 'bodacc-datadila.opendatasoft.com';

/** Clé de contrôle (Luhn) d'un SIREN. */
export function sirenValide(s: string): boolean {
  if (!/^\d{9}$/.test(s)) return false;
  let t = 0;
  for (let i = 0; i < 9; i++) {
    let c = Number(s[8 - i]);
    if (i % 2 === 1) { c *= 2; if (c > 9) c -= 9; }
    t += c;
  }
  return t % 10 === 0;
}

/** Clients (tiers au rôle client) dont le SIRET/SIREN est connu et valide. */
export function clientsSurveilles(objets: readonly ObjetMetier[]): Map<string, ObjetMetier> {
  const m = new Map<string, ObjetMetier>();
  for (const o of objets) {
    if (o.famille !== 'tiers' || o.mode === 'demo' || !o.roles.includes('client')) continue;
    const brut = typeof o.champs.siret === 'string' ? o.champs.siret.replace(/\s/g, '') : '';
    const siren = brut.slice(0, 9);
    if (sirenValide(siren)) m.set(siren, o);
  }
  return m;
}

export async function proceduresCollectives(clients: ReadonlyMap<string, ObjetMetier>, depuis: Date, f: Recuperateur = recuperateurProtege): Promise<AlerteBodacc[]> {
  const sirens = [...clients.keys()];
  const alertes = new Map<string, AlerteBodacc>();
  const jour = depuis.toISOString().slice(0, 10);
  for (let i = 0; i < sirens.length; i += 20) {
    const lot = sirens.slice(i, i + 20);
    const where = `familleavis="collective" and dateparution >= date'${jour}' and (${lot.map((s) => `registre="${s}"`).join(' or ')})`;
    // 100 annonces par page au plus chez l'API : les pages suivantes sont lues tant que la page est pleine (un client dont
    // la procédure produit beaucoup d'annonces ne doit pas masquer celles des 19 autres du lot)
    const annonces: Record<string, unknown>[] = [];
    for (let debut = 0; debut < 1000; debut += 100) {
      const url = await verifierUrl(`https://${HOTE}/api/explore/v2.1/catalog/datasets/annonces-commerciales/records?limit=100&offset=${debut}&order_by=dateparution%20desc&select=registre,dateparution,jugement,tribunal,url_complete&where=${encodeURIComponent(where)}`, [HOTE]);
      const page = ((await appeler(f, url)).donnees as { results?: Record<string, unknown>[] } | null)?.results ?? [];
      annonces.push(...page);
      if (page.length < 100) break;
    }
    for (const x of annonces) {
      const registre = Array.isArray(x.registre) ? x.registre.filter((v): v is string => typeof v === 'string').map((v) => v.replace(/\s/g, '')) : [];
      const siren = registre.find((v) => lot.includes(v));
      if (!siren || alertes.has(siren)) continue; // la plus récente d'abord
      let nature = 'Procédure collective';
      try { const j = JSON.parse(String(x.jugement ?? '{}')) as { nature?: unknown; famille?: unknown }; nature = String(j.nature ?? j.famille ?? nature).slice(0, 200); } catch { /* texte brut */ }
      const o = clients.get(siren) as ObjetMetier;
      alertes.set(siren, {
        siren, objetId: o.id, nom: o.nom, le: String(x.dateparution ?? '').slice(0, 10), nature,
        tribunal: typeof x.tribunal === 'string' ? x.tribunal.slice(0, 200) : null,
        url: typeof x.url_complete === 'string' && x.url_complete.startsWith('https://www.bodacc.fr/') ? x.url_complete : null,
      });
    }
  }
  return [...alertes.values()].sort((a, b) => b.le.localeCompare(a.le));
}
