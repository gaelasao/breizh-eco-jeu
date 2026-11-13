/**
 * Lanceur de bureau : ce que lance le double-clic sur « Living Business » dans le paquet téléchargé (Node.js inclus).
 *   node src/lanceur.ts            → lance Living Business (ou rouvre celui qui tourne) et ouvre le navigateur
 *   node src/lanceur.ts --secours  → lien de réinitialisation, si mot de passe ET code de secours sont perdus
 *   node src/lanceur.ts --arriere-plan → lancement automatique à l'ouverture de session (sans ouvrir le navigateur)
 * Variables utiles : LB_DONNEES (dossier des données), PORT (1er port essayé, 4173), LB_NAVIGATEUR=0 (pas de navigateur),
 * LB_NEXUS_URL (adresse de Breizhcosystem ; par défaut celle préréglée dans le paquet : `nexus` de app/package.json).
 */
import { dossierDonnees, ecrireInstance, effacerInstance, installationPresente, instanceActive, nexusDuPaquet, ouvrirNavigateur } from './passerelle/bureau.ts';
import { ErreurLancement, lancer } from './passerelle/lancement.ts';
import { Stockage } from './passerelle/stockage.ts';

process.env.LB_PAQUET ??= '1'; // textes d'aide adaptés au paquet (pas de commande « npm »)
// adresse de Breizhcosystem préréglée à la fabrication du paquet (scripts/paquets.ts --nexus), sauf si LB_NEXUS_URL est déjà donnée
const nexusPaquet = nexusDuPaquet(new URL('../package.json', import.meta.url));
if (nexusPaquet && !process.env.LB_NEXUS_URL) process.env.LB_NEXUS_URL = nexusPaquet;
const dossier = dossierDonnees();
const secours = process.argv.includes('--secours');
const arrierePlan = process.argv.includes('--arriere-plan');
const navigateur = process.env.LB_NAVIGATEUR !== '0' && !arrierePlan;

function afficher(...lignes: string[]) {
  const trait = '─'.repeat(60);
  console.log(`\n${trait}`);
  for (const l of lignes) console.log(l ? `  ${l}` : '');
  console.log(`${trait}\n`);
}

let chemin = '/';
if (secours) {
  if (!installationPresente(dossier)) {
    afficher('Aucune installation trouvée dans :', dossier, 'Lancez d’abord « Living Business ».');
    process.exit(1);
  }
  chemin = `/secours/${Stockage.creerDemandeSecours(dossier)}`;
}
const aideSecours = secours ? ['Lien de secours : valable 15 minutes, une seule fois, sur cet ordinateur.'] : [];

const deja = await instanceActive(dossier);
if (deja) {
  const url = `http://127.0.0.1:${deja.port}${chemin}`;
  const ouvert = navigateur && ouvrirNavigateur(url);
  afficher('Living Business est déjà ouvert.', ouvert ? `Le navigateur s’ouvre sur : ${url}` : `Ouvrez cette adresse dans votre navigateur : ${url}`, ...aideSecours);
  process.exit(0);
}

try {
  const l = await lancer({ port: Number(process.env.PORT ?? 4173), essais: 30, hote: '127.0.0.1', dossier, demo: false, exemple: 'pme', cookieSecure: false });
  ecrireInstance(dossier, l.port);
  const url = `http://127.0.0.1:${l.port}${chemin}`;
  const ouvert = navigateur && ouvrirNavigateur(url);
  afficher(
    'LIVING BUSINESS — votre entreprise, en local',
    '',
    ouvert ? `Le navigateur s’ouvre sur : ${url}` : `Ouvrez cette adresse dans votre navigateur : ${url}`,
    ...(l.app().comptes.installe ? [] : ['Première fois : créez votre entreprise et votre accès.']),
    ...aideSecours,
    ...(l.reseau?.equipe ? [`Mode équipe : vos collègues ouvrent ${l.reseau.etat().adresses[0] ?? '(aucune adresse réseau)'}`] : []),
    `Vos données : ${dossier}`,
    'Rien n’est envoyé à l’éditeur sans votre accord.',
    ...(process.env.LB_NEXUS_URL ? [`Réseau Breizhcosystem (facultatif) : ${process.env.LB_NEXUS_URL} — Réglages → Breizhcosystem pour relier votre entreprise.`] : []),
    '',
    'Laissez cette fenêtre ouverte pendant l’utilisation.',
    'Pour arrêter : fermez cette fenêtre (ou Ctrl+C).',
  );
  const arreter = () => {
    effacerInstance(dossier);
    void l.arreter().then(() => process.exit(0));
  };
  process.on('SIGINT', arreter);
  process.on('SIGTERM', arreter);
  process.on('SIGHUP', arreter); // fenêtre fermée (Terminal sur Mac, console sur Windows)
  process.on('exit', () => effacerInstance(dossier));
} catch (e) {
  afficher(
    'Living Business n’a pas pu démarrer :',
    e instanceof ErreurLancement && e.code === 'port_occupe' ? 'aucun port libre trouvé (4173 et suivants).' : e instanceof Error ? e.message : String(e),
    `Données : ${dossier}`,
  );
  process.exit(1);
}
