/**
 * Outils du lanceur de bureau (paquet téléchargeable, sans rien à installer) :
 * - dossier des données dans le dossier de l'utilisateur : il survit aux mises à jour (on remplace le dossier du jeu) ;
 * - une seule instance par dossier de données (fichier `instance.json`) : un 2e double-clic rouvre simplement le navigateur ;
 * - ouverture du navigateur par défaut, sans passer l'adresse à un interpréteur de commandes.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const NOM_APPLICATION = 'Living Business';

/** Dossier des données selon le système (LB_DONNEES l'emporte). */
export function dossierDonnees(plateforme: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, maison = homedir()): string {
  if (env.LB_DONNEES && env.LB_DONNEES !== 'memoire') return env.LB_DONNEES;
  if (plateforme === 'darwin') return join(maison, 'Library', 'Application Support', NOM_APPLICATION);
  if (plateforme === 'win32') return join(env.APPDATA ?? join(maison, 'AppData', 'Roaming'), NOM_APPLICATION);
  return join(env.XDG_DATA_HOME ?? join(maison, '.local', 'share'), 'living-business');
}

export interface Instance {
  pid: number;
  port: number;
  le: string;
}

const fichierInstance = (dossier: string) => join(dossier, 'instance.json');

export function lireInstance(dossier: string): Instance | null {
  try {
    const x = JSON.parse(readFileSync(fichierInstance(dossier), 'utf8')) as Partial<Instance>;
    return Number.isInteger(x.pid) && Number.isInteger(x.port) && (x.port as number) > 0 && (x.port as number) < 65536 ? (x as Instance) : null;
  } catch {
    return null;
  }
}

export function ecrireInstance(dossier: string, port: number): void {
  mkdirSync(dossier, { recursive: true, mode: 0o700 });
  writeFileSync(fichierInstance(dossier), JSON.stringify({ pid: process.pid, port, le: new Date().toISOString() }), { mode: 0o600 });
}

/** Retire le fichier d'instance s'il est bien le nôtre. */
export function effacerInstance(dossier: string): void {
  if (lireInstance(dossier)?.pid !== process.pid) return;
  try { unlinkSync(fichierInstance(dossier)); } catch { /* déjà retiré */ }
}

export const processusVivant = (pid: number) => {
  try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
};

/** Living Business répond-il sur ce port ? (vérifie que c'est bien lui, pas un autre programme) */
export async function repond(port: number, delaiMs = 1500): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/v1/session`, { signal: AbortSignal.timeout(delaiMs) });
    const d = (await r.json()) as { connexion?: unknown };
    return d.connexion === 'comptes' || d.connexion === 'demo';
  } catch {
    return false;
  }
}

/** Instance déjà lancée sur ce dossier de données (et qui répond), sinon null. */
export async function instanceActive(dossier: string): Promise<Instance | null> {
  const i = lireInstance(dossier);
  if (!i || !processusVivant(i.pid)) return null;
  return (await repond(i.port)) ? i : null;
}

/** Ouvre une adresse locale dans le navigateur par défaut. Renvoie false si impossible (l'adresse est alors affichée). */
export function ouvrirNavigateur(url: string, plateforme: NodeJS.Platform = process.platform): boolean {
  if (!/^http:\/\/127\.0\.0\.1:\d{1,5}\/[A-Za-z0-9/_-]*$/.test(url)) return false; // jamais autre chose qu'une adresse locale
  const [cmd, args] = plateforme === 'darwin' ? ['open', [url]]
    : plateforme === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : ['xdg-open', [url]];
  try {
    const p = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore', windowsHide: true });
    p.on('error', () => undefined);
    p.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Le jeu tourne-t-il depuis l'application Mac (Living Business.app : Node.js dans Contents/MacOS) ? Il se lance alors
 * d'un double-clic sur l'application, et le secours s'ouvre en la lançant avec la touche ⌥ (Option).
 */
export const dansApplicationMac = (executable: string = process.execPath, plateforme: NodeJS.Platform = process.platform) =>
  plateforme === 'darwin' && /\.app\/Contents\/MacOS\/node$/.test(executable);

/** Le dossier contient-il une installation ? */
export const installationPresente = (dossier: string) => existsSync(join(dossier, 'monde.json'));

/**
 * Adresse de Breizhcosystem préréglée dans un paquet : https seulement, sans identifiants, réduite à l'origine
 * (`https://hote[:port]`). Le jeu la revérifie à chaque appel (adresses internes refusées).
 */
export function adresseNexus(brut: unknown): string | null {
  if (typeof brut !== 'string' || brut.length > 300) return null;
  let u: URL;
  try { u = new URL(brut.trim()); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(u.hostname)) return null;
  return u.origin;
}

/** Adresse de Breizhcosystem écrite dans le package.json du paquet (null hors paquet, ou si elle est invalide). */
export function nexusDuPaquet(fichier: string | URL): string | null {
  try {
    return adresseNexus((JSON.parse(readFileSync(fichier, 'utf8')) as { nexus?: unknown }).nexus);
  } catch {
    return null;
  }
}
