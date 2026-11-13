/**
 * Catalogue « Connecter mes données » (chap. 7.3). HONNÊTE : un connecteur non développé est affiché
 * « bientôt », jamais comme disponible. L'utilisateur peut demander une intégration.
 *
 * Google Sheets ici : import PONCTUEL par lien « Publier sur le Web » (CSV). La synchro privée dans les deux sens passe par
 * Réglages → Outils branchés (script collé dans la feuille de l'entreprise : sources.ts).
 * Anti-SSRF : seul docs.google.com est appelé ; redirections suivies uniquement vers *.googleusercontent.com.
 * « Se connecter avec… » (un clic) passe par le relais de Breizhcosystem (`oauth-relais.ts`) ; en mode avancé, tout se branche
 * avec les identifiants de l'ENTREPRISE (jetons, script, application inscrite dans son annuaire).
 */
import { lireTexteBorne, recuperateurProtege } from './sortant.ts';

export type StatutConnecteur = 'disponible' | 'bientot';

export interface Connecteur {
  id: string;
  nom: string;
  categorie: 'Fichier' | 'Tableur' | 'Bureautique' | 'CRM' | 'Comptabilité' | 'Gestion' | 'Automatisation' | 'Technique';
  description: string;
  statut: StatutConnecteur;
  lecture: boolean;
  ecriture: boolean;
  couleur: string;
}

// HubSpot, Pennylane, Odoo, Qonto, Pipedrive, Shopify, Axonaut, Stripe, WooCommerce, PrestaShop, Sellsy, Airtable, Notion,
// Make/Zapier/n8n, API REST, MCP : branchés dans les deux sens via Réglages → Outils branchés (sources.ts, sources-metier*.ts).
export const CONNECTEURS: readonly Connecteur[] = [
  { id: 'csv', nom: 'Fichier CSV', categorie: 'Fichier', description: 'Clients, fournisseurs, employés, stock… Depuis Excel : Fichier, Enregistrer sous, format CSV. Un fichier .xlsx n’est pas encore lu.', statut: 'disponible', lecture: true, ecriture: false, couleur: '#1d6f42' },
  { id: 'sheets', nom: 'Google Sheets (lien publié)', categorie: 'Tableur', description: 'Import ponctuel d’une feuille publiée en CSV. Synchro privée dans les deux sens : « Google Sheets » ci-dessus.', statut: 'disponible', lecture: true, ecriture: false, couleur: '#188038' },
  { id: 'coller', nom: 'Copier-coller un tableau', categorie: 'Fichier', description: 'Depuis Excel ou un autre tableur : sélectionnez vos lignes, copiez, collez. Aucun fichier à convertir.', statut: 'disponible', lecture: true, ecriture: false, couleur: '#5b6470' },
  { id: 'manuel', nom: 'Saisie manuelle', categorie: 'Fichier', description: 'Ajoutez un client, un fournisseur, un employé… en quelques champs.', statut: 'disponible', lecture: true, ecriture: true, couleur: '#2f6f8f' },
  { id: 'fec', nom: 'Comptabilité (fichier FEC)', categorie: 'Comptabilité', description: 'Sage, EBP, Cegid, Ciel, Quadra, ACD… : l’export FEC remplit vos chiffres clés et le score financier.', statut: 'disponible', lecture: true, ecriture: false, couleur: '#00a650' },
  { id: 'sage-api', nom: 'Sage (connexion directe)', categorie: 'Comptabilité', description: 'Lecture automatique sans export. En attendant : fichier FEC.', statut: 'bientot', lecture: true, ecriture: false, couleur: '#00d639' },
  { id: 'ebp-api', nom: 'EBP (connexion directe)', categorie: 'Gestion', description: 'Gestion commerciale et stock en direct. En attendant : FEC ou export CSV.', statut: 'bientot', lecture: true, ecriture: false, couleur: '#e30613' },
];

const HOTE_SHEETS = 'docs.google.com';
const SUFFIXE_REDIRECTION = '.googleusercontent.com';

/** Valide un lien Google Sheets publié en CSV. Renvoie l'URL normalisée ou une erreur lisible. */
export function validerLienSheets(brut: unknown): { ok: true; url: URL } | { ok: false; erreur: string } {
  if (typeof brut !== 'string' || brut.length > 500) return { ok: false, erreur: 'Lien manquant ou trop long.' };
  let u: URL;
  try {
    u = new URL(brut.trim());
  } catch {
    return { ok: false, erreur: 'Ce n’est pas un lien valide.' };
  }
  if (u.protocol !== 'https:' || u.hostname !== HOTE_SHEETS || u.port !== '' || u.username || u.password) {
    return { ok: false, erreur: 'Seuls les liens https://docs.google.com/spreadsheets/… sont acceptés.' };
  }
  if (!u.pathname.startsWith('/spreadsheets/d/')) return { ok: false, erreur: 'Ce lien ne pointe pas vers une feuille Google Sheets.' };
  const publie = /\/pub$/.test(u.pathname) && u.searchParams.get('output') === 'csv';
  const export_ = /\/export$/.test(u.pathname) && u.searchParams.get('format') === 'csv';
  if (!publie && !export_) {
    return { ok: false, erreur: 'Dans Google Sheets : Fichier → Partager → Publier sur le Web → format « CSV », puis collez le lien obtenu.' };
  }
  u.hash = '';
  return { ok: true, url: u };
}

/** Télécharge le CSV publié : 10 s, 1 Mo, 3 redirections max, hôtes en liste blanche. */
export async function telechargerSheets(url: URL, f: typeof fetch = recuperateurProtege): Promise<string> {
  let courante = url;
  for (let i = 0; i < 4; i++) {
    const r = await f(courante, { redirect: 'manual', signal: AbortSignal.timeout(10_000), headers: { accept: 'text/csv' } });
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location');
      if (!loc) throw new Error('Redirection invalide.');
      const suivante = new URL(loc, courante);
      const sure = suivante.protocol === 'https:' && (suivante.hostname === HOTE_SHEETS || suivante.hostname.endsWith(SUFFIXE_REDIRECTION));
      if (!sure) throw new Error('Redirection vers un hôte non autorisé.');
      courante = suivante;
      continue;
    }
    if (!r.ok) throw new Error(r.status === 404 ? 'Feuille introuvable : est-elle bien publiée ?' : `Google Sheets a répondu ${r.status}.`);
    const taille = Number(r.headers.get('content-length') ?? 0);
    if (taille > 1_000_000) throw new Error('Feuille trop volumineuse (1 Mo max).');
    const texte = await lireTexteBorne(r, 1_000_000, 'Feuille trop volumineuse (1 Mo max).');
    if (/^\s*<!doctype html|^\s*<html/i.test(texte)) throw new Error('La feuille n’est pas publiée au format CSV.');
    return texte;
  }
  throw new Error('Trop de redirections.');
}
