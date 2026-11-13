/**
 * Lanceur de bureau : ce que lance le double-clic sur « Living Business » dans le paquet téléchargé (Node.js inclus).
 *   node src/lanceur.ts            → lance Living Business (ou rouvre celui qui tourne) et ouvre le navigateur
 *   node src/lanceur.ts --secours  → lien de réinitialisation, si mot de passe ET code de secours sont perdus
 *   node src/lanceur.ts --arriere-plan → lancement automatique à l'ouverture de session (sans ouvrir le navigateur)
 *   node src/lanceur.ts --application=<pid> [--secours] → appelé par l'application Mac (paquets/mac/application.applescript,
 *     processus <pid>) : rouvre le navigateur sur le jeu qui tourne, ou démarre le serveur en arrière-plan, attend
 *     qu'il réponde, puis ouvre le navigateur. Écrit une ligne « pret <pid> <port> » (serveur démarré par cet appel)
 *     ou « deja <pid> <port> » (il tournait déjà) ; en cas d'échec, le message sur la sortie d'erreur (code 1).
 *     Le serveur ainsi démarré s'arrête de lui-même quand le processus <pid> (l'application) disparaît.
 * Variables utiles : LB_DONNEES (dossier des données), PORT (1er port essayé, 4173), LB_NAVIGATEUR=0 (pas de navigateur),
 * LB_NEXUS_URL (adresse de Breizhcosystem ; par défaut celle préréglée dans le paquet : `nexus` de app/package.json).
 */
import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dossierDonnees, ecrireInstance, effacerInstance, installationPresente, instanceActive, nexusDuPaquet, ouvrirNavigateur, processusVivant } from './passerelle/bureau.ts';
import { Stockage } from './passerelle/stockage.ts';

process.env.LB_PAQUET ??= '1'; // textes d'aide adaptés au paquet (pas de commande « npm »)
// adresse de Breizhcosystem préréglée à la fabrication du paquet (scripts/paquets.ts --nexus), sauf si LB_NEXUS_URL est déjà donnée
const nexusPaquet = nexusDuPaquet(new URL('../package.json', import.meta.url));
if (nexusPaquet && !process.env.LB_NEXUS_URL) process.env.LB_NEXUS_URL = nexusPaquet;
const dossier = dossierDonnees();
const secours = process.argv.includes('--secours');
const arrierePlan = process.argv.includes('--arriere-plan');
const navigateur = process.env.LB_NAVIGATEUR !== '0' && !arrierePlan;
/** Processus de l'application Mac qui a demandé le lancement (--application=<pid>), sinon null. */
const application = (() => {
  const a = process.argv.find((x) => x.startsWith('--application='));
  const pid = a ? Number(a.slice('--application='.length)) : NaN;
  return Number.isInteger(pid) && pid > 1 ? pid : null;
})();
/** Serveur démarré pour l'application Mac : il s'arrête quand elle disparaît (LB_APPLICATION_PID, posé par --application). */
const surveille = Number(process.env.LB_APPLICATION_PID);
/** Démarré par le lanceur en mode --application : il lui dit par le canal de Node.js s'il est prêt, ou pourquoi il ne l'est pas. */
const signaler = (message: { pret: number } | { deja: { pid: number; port: number } } | { erreur: string }, puis?: () => void) => {
  if (process.send) process.send(message, () => puis?.());
  else puis?.();
};

function afficher(...lignes: string[]) {
  const trait = '─'.repeat(60);
  console.log(`\n${trait}`);
  for (const l of lignes) console.log(l ? `  ${l}` : '');
  console.log(`${trait}\n`);
}

/** Chemin à ouvrir dans le navigateur : la page de secours (lien à usage unique) ou l'accueil. */
function cheminOuvert(): string {
  if (!secours) return '/';
  if (!installationPresente(dossier)) throw new Error(`Aucune entreprise n’est encore créée sur cet ordinateur (dossier des données : ${dossier}). Ouvrez d’abord Living Business normalement.`);
  return `/secours/${Stockage.creerDemandeSecours(dossier)}`;
}

/** Démarre le serveur en arrière-plan (ce même fichier, sans --application) et attend qu'il réponde. */
function demarrerServeur(pidApplication: number): Promise<{ etat: 'pret' | 'deja'; pid: number; port: number }> {
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  const journal = join(dossier, 'journal-serveur.log');
  let taille = 0;
  try { taille = statSync(journal).size; } catch { /* premier lancement */ }
  const fd = openSync(journal, taille > 1e6 ? 'w' : 'a', 0o600);
  const enfant = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(import.meta.url)], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, LB_NAVIGATEUR: '0', LB_APPLICATION_PID: String(pidApplication) },
    detached: true,
    stdio: ['ignore', fd, fd, 'ipc'],
  });
  closeSync(fd);
  return new Promise((ok, ko) => {
    const finir = () => {
      clearTimeout(delai);
      enfant.removeAllListeners();
      if (enfant.connected) enfant.disconnect();
      enfant.unref();
    };
    const echec = (m: string) => { finir(); ko(new Error(m)); };
    const delai = setTimeout(() => echec(`Living Business met trop de temps à démarrer. Détails : ${journal}`), 60_000);
    enfant.on('message', (m: { pret?: number; deja?: { pid: number; port: number }; erreur?: string }) => {
      if (typeof m.pret === 'number') { finir(); ok({ etat: 'pret', pid: enfant.pid as number, port: m.pret }); }
      else if (m.deja) { finir(); ok({ etat: 'deja', ...m.deja }); }
      else if (typeof m.erreur === 'string') echec(m.erreur);
    });
    enfant.on('error', (e) => echec(`Living Business n’a pas pu démarrer : ${e.message}`));
    enfant.on('exit', (code) => echec(`Living Business s’est arrêté pendant son démarrage (code ${code}). Détails : ${journal}`));
  });
}

/** Mode --application : rouvrir ou démarrer, ouvrir le navigateur, puis dire à l'application ce qu'il en est. */
async function pourApplication(pidApplication: number) {
  try {
    const chemin = cheminOuvert();
    const deja = await instanceActive(dossier);
    const r = deja ? { etat: 'deja' as const, pid: deja.pid, port: deja.port } : await demarrerServeur(pidApplication);
    if (navigateur) ouvrirNavigateur(`http://127.0.0.1:${r.port}${chemin}`);
    process.stdout.write(`${r.etat} ${r.pid} ${r.port}\n`, () => process.exit(0));
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`, () => process.exit(1));
  }
}

async function serveur() {
  let chemin = '/';
  try { chemin = cheminOuvert(); } catch (e) {
    afficher(...(e instanceof Error ? e.message : String(e)).split(/(?<=\.) /));
    process.exit(1);
  }
  const aideSecours = secours ? ['Lien de secours : valable 15 minutes, une seule fois, sur cet ordinateur.'] : [];

  const deja = await instanceActive(dossier);
  if (deja) {
    const url = `http://127.0.0.1:${deja.port}${chemin}`;
    const ouvert = navigateur && ouvrirNavigateur(url);
    afficher('Living Business est déjà ouvert.', ouvert ? `Le navigateur s’ouvre sur : ${url}` : `Ouvrez cette adresse dans votre navigateur : ${url}`, ...aideSecours);
    signaler({ deja: { pid: deja.pid, port: deja.port } }, () => process.exit(0));
    return;
  }

  try {
    const { ErreurLancement, lancer } = await import('./passerelle/lancement.ts');
    const l = await lancer({ port: Number(process.env.PORT ?? 4173), essais: 30, hote: '127.0.0.1', dossier, demo: false, exemple: 'pme', cookieSecure: false })
      .catch((e: unknown) => {
        const raison = e instanceof ErreurLancement && e.code === 'port_occupe' ? 'aucun port libre trouvé (4173 et suivants).' : e instanceof Error ? e.message : String(e);
        afficher('Living Business n’a pas pu démarrer :', raison, `Données : ${dossier}`);
        signaler({ erreur: `Living Business n’a pas pu démarrer : ${raison}` }, () => process.exit(1));
        return null;
      });
    if (!l) return;
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
      ...(Number.isInteger(surveille) && surveille > 1
        ? ['Démarré par l’application Living Business : il s’arrête quand vous la quittez.']
        : ['Laissez cette fenêtre ouverte pendant l’utilisation.', 'Pour arrêter : fermez cette fenêtre (ou Ctrl+C).']),
    );
    let arrete = false;
    const arreter = () => {
      if (arrete) return;
      arrete = true;
      effacerInstance(dossier);
      void l.arreter().then(() => process.exit(0));
    };
    process.on('SIGINT', arreter);
    process.on('SIGTERM', arreter);
    process.on('SIGHUP', arreter); // fenêtre fermée (Terminal sur Mac, console sur Windows)
    process.on('exit', () => effacerInstance(dossier));
    // application Mac quittée (ou arrêtée de force) : le serveur qu'elle a démarré s'arrête proprement avec elle
    if (Number.isInteger(surveille) && surveille > 1) setInterval(() => { if (!processusVivant(surveille)) arreter(); }, 1000).unref();
    signaler({ pret: l.port });
  } catch (e) {
    afficher('Living Business n’a pas pu démarrer :', e instanceof Error ? e.message : String(e), `Données : ${dossier}`);
    signaler({ erreur: `Living Business n’a pas pu démarrer : ${e instanceof Error ? e.message : String(e)}` }, () => process.exit(1));
  }
}

if (application !== null) await pourApplication(application);
else await serveur();
