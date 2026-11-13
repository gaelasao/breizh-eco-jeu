/**
 * Démarrage du serveur, partagé par `npm start` (serveur.ts) et le lanceur de bureau (lanceur.ts).
 * Écoute en local par défaut. Le port occupé est signalé par une erreur `port_occupe` (le lanceur essaie le suivant).
 */
import type { Server } from 'node:http';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Application, type Exemple } from './application.ts';
import type { Systeme } from './demarrage.ts';
import { creerServeur } from './http.ts';
import { Reseau } from './reseau.ts';

export interface OptionsLancement {
  port: number;
  /** Nombre de ports essayés à partir de `port` s'il est occupé (1 = seulement celui-là). */
  essais?: number;
  hote: string;
  /** Dossier des données ; null = en mémoire. */
  dossier: string | null;
  demo: boolean;
  exemple: Exemple;
  cookieSecure: boolean;
  /** Système (tests : dossier personnel fictif pour le lancement automatique). */
  systeme?: Systeme;
  /** Empêcher la mise en veille en mode équipe (Mac). Défaut : oui. */
  veille?: boolean;
  /**
   * Jeu en ligne sur le serveur de l'entreprise (LB_EN_LIGNE=1) : pas de mode équipe (le proxy HTTPS sert déjà
   * tout le monde ; l'adresse d'écoute reste celle imposée, même si une sauvegarde restaurée avait le mode équipe).
   */
  enLigne?: boolean;
  /** Derrière un proxy de la même machine (LB_PROXY=1). */
  proxy?: boolean;
}

export interface Lancement {
  url: string;
  port: number;
  serveur: Server;
  /** Application courante (elle change après une restauration). */
  app: () => Application;
  /** Mode équipe et lancement automatique (null : données en mémoire). */
  reseau: Reseau | null;
  arreter: () => Promise<void>;
}

export class ErreurLancement extends Error {
  readonly code: 'port_occupe' | 'demarrage';
  constructor(code: 'port_occupe' | 'demarrage', message: string) {
    super(message);
    this.code = code;
  }
}

export async function lancer(o: OptionsLancement): Promise<Lancement> {
  let app: Application;
  try {
    app = await Application.creer({ connexion: o.demo ? 'demo' : 'comptes', exemple: o.demo ? o.exemple : null, dossier: o.dossier });
  } catch (e) {
    throw new ErreurLancement('demarrage', e instanceof Error ? e.message : String(e));
  }
  let reseau: Reseau | null = null;
  const enLigne = o.enLigne === true;
  const serveur = creerServeur(app, { cookieSecure: o.cookieSecure, surRemplacement: (n) => { app = n; }, reseau: () => reseau, enLigne, proxy: o.proxy === true });
  // mode équipe enregistré : on rouvre au réseau du bureau (sauf adresse d'écoute imposée, ou jeu en ligne)
  const hote = o.hote === '127.0.0.1' && app.reglages.equipe && !enLigne ? '0.0.0.0' : o.hote;
  const essais = Math.max(1, o.essais ?? 1);
  for (let i = 0; ; i++) {
    const port = o.port === 0 ? 0 : o.port + i;
    try {
      await new Promise<void>((ok, ko) => {
        const echec = (e: NodeJS.ErrnoException) => ko(e);
        serveur.once('error', echec);
        serveur.listen(port, hote, () => { serveur.off('error', echec); ok(); });
      });
      break;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const occupe = code === 'EADDRINUSE' || code === 'EACCES';
      if (occupe && i + 1 < essais && o.port !== 0) continue;
      app.arreter();
      throw occupe ? new ErreurLancement('port_occupe', `Le port ${port} est déjà utilisé.`) : new ErreurLancement('demarrage', e instanceof Error ? e.message : String(e));
    }
  }
  app.demarrer();
  const port = (serveur.address() as { port: number }).port;
  if (o.dossier && !enLigne) {
    reseau = new Reseau({
      serveur, port, equipe: hote === '0.0.0.0',
      enregistrer: (equipe) => app.regler({ equipe }),
      cible: { node: process.execPath, lanceur: fileURLToPath(new URL('../lanceur.ts', import.meta.url)), donnees: o.dossier },
      systeme: o.systeme ?? { plateforme: process.platform, maison: homedir(), appdata: process.env.APPDATA },
      veille: o.veille ?? true,
    });
  }
  const hoteUrl = o.hote === '0.0.0.0' || o.hote === '::' ? '127.0.0.1' : o.hote.includes(':') ? `[${o.hote}]` : o.hote;
  let arrete: Promise<void> | null = null;
  return {
    url: `http://${hoteUrl}:${port}/`,
    port,
    serveur,
    app: () => app,
    reseau,
    arreter: () => (arrete ??= new Promise<void>((ok) => {
      reseau?.arreter();
      app.arreter();
      serveur.closeAllConnections?.();
      serveur.close(() => ok());
      setTimeout(ok, 1500).unref();
    })),
  };
}
