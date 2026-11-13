/**
 * Démarrage en ligne de commande : `npm start` → http://127.0.0.1:4173 (autre port : `PORT=4174 npm start`).
 * Pour les entreprises, le paquet téléchargeable utilise le lanceur de bureau (`src/lanceur.ts`) : double-clic, navigateur ouvert.
 * Écoute en local par défaut. Exposer sur un réseau = derrière un proxy HTTPS (LB_COOKIE_SECURE=1, LB_ORIGINE=https://…).
 * Enregistrement : dossier `donnees/` (ou LB_DONNEES=/chemin) ; LB_DONNEES=memoire pour une démo jetable.
 * Démonstration sans mot de passe : `npm run demo`. Mot de passe ET code de secours perdus : `npm run secours`.
 * Réseau local (collègues) : HOST=0.0.0.0 ; noms d'hôte acceptés en plus des adresses IP : LB_HOTES=serveur.local,…
 * En ligne, sur le serveur de l'entreprise (service installé par deploiement/installer-jeu.sh) : LB_EN_LIGNE=1,
 * LB_PROXY=1, LB_ORIGINE=https://<domaine>, LB_HOTES=<domaine>, LB_COOKIE_SECURE=1, LB_DONNEES=/var/lib/living-business.
 */
import { fileURLToPath } from 'node:url';
import { ErreurLancement, lancer } from './lancement.ts';

const port = Number(process.env.PORT ?? 4173);
const hote = process.env.HOST ?? '127.0.0.1';
const dossier = process.env.LB_DONNEES === 'memoire' ? null : (process.env.LB_DONNEES ?? fileURLToPath(new URL('../../donnees/', import.meta.url)));
// Mode normal : comptes locaux, installation au premier lancement. Démonstration (`npm run demo`) : profils fictifs sans mot de passe.
const demo = process.env.LB_CONNEXION === 'demo';
const enLigne = process.env.LB_EN_LIGNE === '1';

try {
  const l = await lancer({ port, hote, dossier, demo, exemple: process.env.EXEMPLE === 'pme' ? 'pme' : 'eti', cookieSecure: process.env.LB_COOKIE_SECURE === '1', enLigne, proxy: process.env.LB_PROXY === '1' });
  console.log(`Living Business : http://${hote}:${l.port}${enLigne && process.env.LB_ORIGINE ? ` — en ligne : ${process.env.LB_ORIGINE}` : ''}`);
  console.log(dossier ? `Données enregistrées dans ${dossier} (sauvegarde automatique chaque jour dans sauvegardes/)` : 'En mémoire : rien n’est enregistré');
  if (demo) console.log('Démonstration : profils fictifs, sans mot de passe.');
  else if (!l.app().comptes.installe && enLigne) console.log(dossier ? `Première utilisation : lien d’installation à usage unique = ${process.env.LB_ORIGINE ?? 'https://<domaine>'}/installation#<code du fichier ${dossier}/installation.txt>` : 'En ligne sans dossier de données : installation impossible.');
  else if (!l.app().comptes.installe) console.log(`Première utilisation : ouvrez http://127.0.0.1:${l.port} SUR CET ORDINATEUR pour créer votre accès.`);
  if (enLigne && process.env.LB_PROXY !== '1') console.warn('Attention : LB_EN_LIGNE=1 sans LB_PROXY=1 — le jeu doit être derrière un proxy HTTPS sur cette machine.');
  console.log(enLigne ? 'Vos données restent sur VOTRE serveur : rien n’est envoyé à l’éditeur sans votre accord.' : 'Vos données restent sur cet ordinateur : rien n’est envoyé à l’éditeur sans votre accord.');
  console.log(`MCP (Claude, agents) : http://${hote}:${l.port}/mcp — clé d’API à créer dans Réglages → Clés d’API`);
  const arreter = () => { void l.arreter().then(() => process.exit(0)); };
  process.on('SIGINT', arreter);
  process.on('SIGTERM', arreter);
} catch (e) {
  if (e instanceof ErreurLancement && e.code === 'port_occupe') {
    console.error(`Le port ${port} est déjà utilisé (Living Business tourne peut-être déjà : http://${hote}:${port}).`);
    console.error(`Pour un autre port : PORT=${port + 1} npm start`);
  } else {
    console.error(`Démarrage impossible : ${e instanceof Error ? e.message : e}`);
  }
  process.exit(1);
}
