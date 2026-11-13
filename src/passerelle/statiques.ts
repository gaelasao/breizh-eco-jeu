/**
 * Fichiers statiques servis par la passerelle — LISTE BLANCHE : aucun chemin n'est construit depuis l'URL.
 * La liste est établie au démarrage (noms de fichiers vérifiés), chaque fichier est lu à sa première demande puis gardé
 * en mémoire (démarrage instantané, même si le disque est lent ou si macOS a déporté les fichiers dans iCloud).
 *
 * Servis : web/* (racine), web/bz/* (système de design Breizhcosystem), web/carte/*.js (modules purs de la carte 3D),
 * web/polices/*.woff2, web/licences/*.txt, web/illustrations/*.avif|webp (illustrations tirées de la maquette, §2.5),
 * web/modeles/<pack>/* (KayKit, CC0), three.js et ses modules complémentaires, et les bibliothèques du §7.2 de
 * la direction de design sous un chemin qui porte leur version exacte (cache immuable).
 * Licence (licence.ts) : /licences/agpl-3.0.txt = LICENSE, texte officiel de la GNU AGPL version 3, servi tel quel ;
 * /licence.html = page tirée de NOTICE.md, la notice en français (fichiers de la racine, ou de app/ dans un paquet).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHEMIN_TEXTE_LICENCE, FICHIER_LICENCE, FICHIER_NOTICE, pageNotice } from './licence.ts';

export const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.avif': 'image/avif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Bibliothèques JS épinglées (version exacte dans package.json ET dans le chemin servi). Source unique : la passerelle
 * les sert, scripts/paquets.ts les embarque dans les paquets téléchargeables.
 */
export const BIBLIOTHEQUES: ReadonlyArray<{ paquet: string; version: string; fichier: string; chemin: string; licence: string }> = [
  { paquet: 'camera-controls', version: '3.1.2', fichier: 'dist/camera-controls.module.min.js', chemin: '/vendor/camera-controls@3.1.2.js', licence: 'LICENSE' },
  { paquet: 'uplot', version: '1.6.32', fichier: 'dist/uPlot.iife.min.js', chemin: '/vendor/uplot@1.6.32.js', licence: 'LICENSE' },
  { paquet: 'uplot', version: '1.6.32', fichier: 'dist/uPlot.min.css', chemin: '/vendor/uplot@1.6.32.css', licence: 'LICENSE' },
  { paquet: '@github/combobox-nav', version: '3.0.2', fichier: 'dist/index.js', chemin: '/vendor/combobox-nav@3.0.2.js', licence: 'LICENSE' },
  { paquet: '@leeoniya/ufuzzy', version: '1.0.19', fichier: 'dist/uFuzzy.mjs', chemin: '/vendor/ufuzzy@1.0.19.js', licence: 'LICENSE' },
];

/** Sous-dossiers de web/ servis tels quels, avec les extensions admises. */
const DOSSIERS: ReadonlyArray<{ dossier: string; extensions: ReadonlySet<string> }> = [
  { dossier: 'bz', extensions: new Set(['.css', '.js', '.svg']) },
  { dossier: 'carte', extensions: new Set(['.js']) },
  { dossier: 'polices', extensions: new Set(['.woff2']) },
  { dossier: 'licences', extensions: new Set(['.txt']) },
  { dossier: 'illustrations', extensions: new Set(['.avif', '.webp']) },
];

const NOM_SUR = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const IMMUABLE = 'public, max-age=31536000, immutable';

/**
 * `etag` : empreinte du contenu servi (revalidation « 304 Not Modified » : un fichier inchangé n'est jamais
 * retéléchargé, §8.2) ; `version` : ses 10 premiers caractères. Demandé avec `?v=<version>`, le fichier est immuable.
 */
export interface FichierServi { contenu: Buffer; type: string; cache: string; etag: string; version: string }
export const CACHE_IMMUABLE = IMMUABLE;
interface Entree { source: URL; type: string; cache: string; transformer?: (code: string) => string }

/** Construit la liste blanche. `racine` : dossier du dépôt (tests : une copie temporaire). */
export function fichiersStatiques(racine: URL = new URL('../../', import.meta.url)): { get(chemin: string): FichierServi | undefined; chemins(): string[] } {
  const liste = new Map<string, Entree>();
  const cache = new Map<string, FichierServi>();
  const web = new URL('web/', racine);
  const modules = new URL('node_modules/', racine);
  const lister = (dossier: URL): string[] => { try { return readdirSync(dossier); } catch { return []; } };

  for (const nom of lister(web)) {
    const type = TYPES[extname(nom)];
    if (!type || !NOM_SUR.test(nom)) continue;
    liste.set(nom === 'index.html' ? '/' : `/${nom}`, { source: new URL(nom, web), type, cache: 'no-cache' });
  }
  for (const { dossier, extensions } of DOSSIERS) {
    const d = new URL(`${dossier}/`, web);
    for (const nom of lister(d)) {
      const ext = extname(nom);
      if (!extensions.has(ext) || !NOM_SUR.test(nom)) continue;
      liste.set(`/${dossier}/${nom}`, { source: new URL(nom, d), type: TYPES[ext] as string, cache: 'no-cache' });
    }
  }
  // Licence (GNU AGPL version 3) : le texte officiel est servi tel quel, la notice en français est mise en page à la
  // lecture. Une seule source pour chacun (LICENSE et NOTICE.md, joints à chaque paquet).
  const estFichier = (u: URL): boolean => { try { return statSync(u).isFile(); } catch { return false; } };
  const licence = new URL(FICHIER_LICENCE, racine);
  if (estFichier(licence)) liste.set(CHEMIN_TEXTE_LICENCE, { source: licence, type: TYPES['.txt'] as string, cache: 'no-cache' });
  const notice = new URL(FICHIER_NOTICE, racine);
  if (estFichier(notice)) liste.set('/licence.html', { source: notice, type: TYPES['.html'] as string, cache: 'no-cache', transformer: pageNotice });
  // Le sprite d'icônes est référencé par chaque <use> à chaque rendu de vue : icone.js le demande avec sa version
  // (« /bz/icones.svg?v=… »), servie en cache immuable ; une nouvelle version du sprite change l'adresse.
  const icone = liste.get('/bz/icone.js');
  if (icone && liste.has('/bz/icones.svg')) {
    icone.transformer = (code) => {
      const v = servis.get('/bz/icones.svg')?.version;
      return v ? code.replace("export const SPRITE = '/bz/icones.svg';", `export const SPRITE = '/bz/icones.svg?v=${v}';`) : code;
    };
  }
  // Modèles 3D libres (KayKit, CC0) : web/modeles/<pack>/*.gltf|bin|png
  const modeles = new URL('modeles/', web);
  for (const pack of lister(modeles)) {
    if (!NOM_SUR.test(pack)) continue;
    const dossier = new URL(`${pack}/`, modeles);
    try { if (!statSync(dossier).isDirectory()) continue; } catch { continue; }
    for (const nom of lister(dossier)) {
      const type = TYPES[extname(nom)];
      if (!type || !NOM_SUR.test(nom)) continue;
      liste.set(`/modeles/${pack}/${nom}`, { source: new URL(nom, dossier), type, cache: 'no-cache' });
    }
  }
  // Modules complémentaires three.js (contrôles, chargeur glTF, post-traitement) : import « three » réécrit.
  const addons = new URL('three/examples/jsm/', modules);
  const reecrire = (code: string) => code.replace(/from\s+(['"])three\1/g, "from '/vendor/three.module.js'");
  for (const sous of ['controls', 'loaders', 'environments', 'postprocessing', 'shaders', 'utils', 'math']) {
    for (const nom of lister(new URL(`${sous}/`, addons))) {
      if (nom.endsWith('.js') && NOM_SUR.test(nom)) liste.set(`/vendor/addons/${sous}/${nom}`, { source: new URL(`${sous}/${nom}`, addons), type: TYPES['.js'] as string, cache: 'no-cache', transformer: reecrire });
    }
  }
  const three = new URL('three/build/', modules);
  for (const nom of ['three.module.js', 'three.core.js']) liste.set(`/vendor/${nom}`, { source: new URL(nom, three), type: TYPES['.js'] as string, cache: 'no-cache' });
  // Bibliothèques épinglées : servies seulement si la version installée est bien celle du chemin
  for (const b of BIBLIOTHEQUES) {
    let version = '';
    try { version = (JSON.parse(readFileSync(new URL(`${b.paquet}/package.json`, modules), 'utf8')) as { version?: string }).version ?? ''; } catch { /* paquet absent */ }
    if (version !== b.version) continue;
    liste.set(b.chemin, { source: new URL(`${b.paquet}/${b.fichier}`, modules), type: TYPES[extname(b.chemin)] as string, cache: IMMUABLE });
  }

  const servis = {
    get(chemin: string): FichierServi | undefined {
      const c = cache.get(chemin);
      if (c) return c;
      const e = liste.get(chemin);
      if (!e) return undefined;
      try {
        const brut = readFileSync(fileURLToPath(e.source));
        const contenu = e.transformer ? Buffer.from(e.transformer(brut.toString('utf8'))) : brut;
        const empreinte = createHash('sha256').update(contenu).digest('base64url');
        const f = { contenu, type: e.type, cache: e.cache, etag: `"${empreinte.slice(0, 27)}"`, version: empreinte.slice(0, 10) };
        cache.set(chemin, f);
        return f;
      } catch {
        return undefined; // fichier absent (police, bibliothèque) : repli côté client
      }
    },
    chemins: () => [...liste.keys()],
  };
  return servis;
}
