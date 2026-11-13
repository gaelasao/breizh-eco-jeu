/**
 * Illustrations tirées de la maquette (direction de design §2.5) — outil de développement, jamais servi en production.
 *
 *   PORT=4180 node scripts/vignettes.ts
 *
 * Lance la démonstration (exemple PME, en mémoire) et ajoute une seule route de développement :
 * POST /__vignettes/<nom> (nom en liste blanche, corps : image WebP ou PNG de la carte, 8 Mo au plus), rangée dans
 * design/vignettes/<nom>-capture.<ext>. La capture se fait dans un navigateur ouvert sur la démo : heure de la carte
 * réglée (aube ou nuit), noms des quartiers masqués (calque « Noms des lieux »), puis l'image instantanée de la carte
 * (§5.10, Cache Storage « lb-carte-instantanee ») est envoyée à cette route. Ensuite :
 *
 *   python3 -I scripts/vignettes.py   → web/illustrations/<nom>.avif (≤ 20 Ko) et <nom>.webp (repli)
 *
 * Même scène, mêmes matériaux que la carte de l'entreprise : on y reconnaît son port.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { lancer } from '../src/passerelle/lancement.ts';

export const NOMS_VIGNETTES = ['port-aube', 'port-nuit'] as const;
const TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png' };
const MAX = 8_000_000;

/** Route de réception : renvoie true si la requête lui revenait. */
export function recevoirVignette(req: IncomingMessage, res: ServerResponse, dossier: URL): boolean {
  const m = /^\/__vignettes\/([a-z-]+)$/.exec(req.url ?? '');
  if (req.method !== 'POST' || !m || !(NOMS_VIGNETTES as readonly string[]).includes(m[1] as string)) return false;
  const ext = TYPES[String(req.headers['content-type'] ?? '').split(';')[0] as string];
  if (!ext) { res.writeHead(415).end(); return true; }
  const morceaux: Buffer[] = [];
  let taille = 0;
  req.on('data', (c: Buffer) => { taille += c.length; if (taille > MAX) req.destroy(); else morceaux.push(c); });
  req.on('end', () => {
    mkdirSync(dossier, { recursive: true });
    const fichier = new URL(`${m[1]}-capture.${ext}`, dossier);
    writeFileSync(fichier, Buffer.concat(morceaux));
    console.log(`Reçu : ${fileURLToPath(fichier)} (${taille} octets)`);
    res.writeHead(204).end();
  });
  return true;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT ?? 4180);
  const l = await lancer({ port, hote: '127.0.0.1', dossier: null, demo: true, exemple: 'pme', cookieSecure: false });
  const dossier = new URL('../design/vignettes/', import.meta.url);
  const origines = l.serveur.listeners('request') as Array<(req: IncomingMessage, res: ServerResponse) => void>;
  l.serveur.removeAllListeners('request');
  l.serveur.on('request', (req: IncomingMessage, res: ServerResponse) => {
    if (recevoirVignette(req, res, dossier)) return;
    for (const f of origines) f.call(l.serveur, req, res);
  });
  console.log(`Vignettes : démonstration sur ${l.url}, réception dans ${fileURLToPath(dossier)}`);
}
