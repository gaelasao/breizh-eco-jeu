/**
 * Lancement automatique à l'ouverture de session (sans droits administrateur, sans service système) :
 * - Mac : agent `~/Library/LaunchAgents/bzh.breizh-eco.living-business.plist` (relancé s'il plante) ;
 * - Windows : raccourci `.cmd` dans le dossier Démarrage de l'utilisateur (fenêtre réduite) ;
 * - Linux : entrée `~/.config/autostart/living-business.desktop`.
 * Le contenu est fixe : seuls les chemins du programme et des données y figurent (échappés selon le format).
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface CibleDemarrage {
  /** Exécutable Node.js (celui du paquet, ou celui qui tourne). */
  node: string;
  /** Chemin de `src/lanceur.ts`. */
  lanceur: string;
  /** Dossier des données (toujours explicite : on relance exactement la même entreprise). */
  donnees: string;
}

export interface Systeme {
  plateforme: NodeJS.Platform;
  maison: string;
  appdata?: string | undefined;
}

export const ETIQUETTE = 'bzh.breizh-eco.living-business';

export function fichierDemarrage(s: Systeme): string | null {
  if (s.plateforme === 'darwin') return join(s.maison, 'Library', 'LaunchAgents', `${ETIQUETTE}.plist`);
  if (s.plateforme === 'win32') return join(s.appdata ?? join(s.maison, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Living Business.cmd');
  if (s.plateforme === 'linux') return join(s.maison, '.config', 'autostart', 'living-business.desktop');
  return null;
}

const xml = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Argument de ligne `Exec=` (spécification freedesktop) : entre guillemets, \ " ` $ échappés. */
const execArg = (x: string) => `"${x.replace(/[\\"`$]/g, (c) => `\\${c}`)}"`;

export function contenuDemarrage(plateforme: NodeJS.Platform, c: CibleDemarrage): string {
  const dossierApp = dirname(dirname(c.lanceur));
  if (plateforme === 'darwin') {
    const args = [c.node, '--disable-warning=ExperimentalWarning', c.lanceur, '--arriere-plan'];
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      '<dict>',
      `  <key>Label</key><string>${ETIQUETTE}</string>`,
      '  <key>ProgramArguments</key>',
      '  <array>',
      ...args.map((a) => `    <string>${xml(a)}</string>`),
      '  </array>',
      `  <key>WorkingDirectory</key><string>${xml(dossierApp)}</string>`,
      '  <key>EnvironmentVariables</key>',
      `  <dict><key>LB_DONNEES</key><string>${xml(c.donnees)}</string></dict>`,
      '  <key>RunAtLoad</key><true/>',
      '  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>',
      '  <key>ThrottleInterval</key><integer>30</integer>',
      `  <key>StandardOutPath</key><string>${xml(join(c.donnees, 'journal-serveur.log'))}</string>`,
      `  <key>StandardErrorPath</key><string>${xml(join(c.donnees, 'journal-serveur.log'))}</string>`,
      '</dict>',
      '</plist>',
      '',
    ].join('\n');
  }
  if (plateforme === 'win32') {
    return [
      '@echo off',
      'rem Living Business : lancement automatique (Réglages → Équipe et réseau pour le retirer)',
      `cd /d "${dossierApp}"`,
      `set "LB_DONNEES=${c.donnees}"`,
      `start "Living Business" /min "${c.node}" --disable-warning=ExperimentalWarning "${c.lanceur}" --arriere-plan`,
      '',
    ].join('\r\n');
  }
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Living Business',
    'Comment=Votre entreprise, en local',
    `Exec=env LB_DONNEES=${execArg(c.donnees)} ${execArg(c.node)} --disable-warning=ExperimentalWarning ${execArg(c.lanceur)} --arriere-plan`,
    `Path=${dossierApp}`,
    'Terminal=false',
    'NoDisplay=true',
    'X-GNOME-Autostart-enabled=true',
    '',
  ].join('\n');
}

/** Chemins refusés dans un fichier de démarrage Windows (ils casseraient le script). */
const cheminWindowsSur = (x: string) => !/["%\r\n]/.test(x);

export function demarrageActif(s: Systeme): boolean {
  const f = fichierDemarrage(s);
  return f !== null && existsSync(f);
}

/** Active (écrit) ou retire le lancement automatique. */
export function regleDemarrage(s: Systeme, actif: boolean, c: CibleDemarrage): void {
  const f = fichierDemarrage(s);
  if (!f) throw new Error('Lancement automatique non disponible sur ce système.');
  if (!actif) {
    try { unlinkSync(f); } catch { /* déjà retiré */ }
    return;
  }
  if (s.plateforme === 'win32' && ![c.node, c.lanceur, c.donnees].every(cheminWindowsSur)) throw new Error('Chemin du dossier incompatible (guillemet ou %) : déplacez Living Business.');
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, contenuDemarrage(s.plateforme, c), { mode: 0o644 });
}

/** Le jeu a été déplacé ou mis à jour dans un autre dossier : on remet le lancement automatique à jour. */
export function reparerDemarrage(s: Systeme, c: CibleDemarrage): boolean {
  const f = fichierDemarrage(s);
  if (!f || !existsSync(f)) return false;
  const attendu = contenuDemarrage(s.plateforme, c);
  const actuel = readFileSync(f, 'utf8');
  if (actuel === attendu) return false;
  // seulement s'il s'agit de la même entreprise (même dossier de données) : jamais celle d'une autre installation
  const marqueur = s.plateforme === 'linux' ? `LB_DONNEES=${execArg(c.donnees)} ` : (attendu.split(/\r?\n/).find((l) => l.includes('LB_DONNEES')) ?? '').trim();
  if (!marqueur || !actuel.includes(marqueur)) return false;
  writeFileSync(f, attendu, { mode: 0o644 });
  return true;
}
