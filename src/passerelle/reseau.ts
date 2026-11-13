/**
 * Mode équipe : rendre Living Business accessible aux collègues du même réseau (bureau), sans service extérieur.
 * - Fermé par défaut (écoute sur 127.0.0.1 : cet ordinateur seulement).
 * - Ouvert : écoute sur toutes les interfaces, même port, sans couper les connexions en cours ;
 *   les liens (invitations, formulaires) utilisent l'adresse du bureau ; le nom de la machine est accepté.
 * - Sur Mac, la mise en veille est empêchée tant que le mode équipe est ouvert (`caffeinate`).
 * - Lancement automatique à l'ouverture de session (voir demarrage.ts).
 * Réglages réservés à un administrateur SUR l'ordinateur lui-même (vérifié côté HTTP).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import type { Server } from 'node:http';
import { hostname, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { demarrageActif, fichierDemarrage, regleDemarrage, reparerDemarrage, type CibleDemarrage, type Systeme } from './demarrage.ts';

export interface EtatReseau {
  equipe: boolean;
  port: number;
  /** Adresses à donner aux collègues (la première est utilisée dans les liens). */
  adresses: string[];
  nomMachine: string | null;
  veilleEmpechee: boolean;
  demarrage: { possible: boolean; actif: boolean };
  erreur: string | null;
}

const VIRTUELLES = /^(docker|br-|veth|vmnet|vboxnet|utun|awdl|llw|bridge|tailscale|zt|wg|lo)/i;
const privee = (ip: string) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

/** Adresses IPv4 privées des cartes réseau réelles (Wi-Fi, Ethernet), les plus courantes d'abord. */
export function adressesBureau(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const ips: string[] = [];
  for (const [nom, liste] of Object.entries(interfaces)) {
    if (VIRTUELLES.test(nom)) continue;
    for (const a of liste ?? []) if (a.family === 'IPv4' && !a.internal && privee(a.address)) ips.push(a.address);
  }
  const rang = (ip: string) => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : 2);
  return [...new Set(ips)].sort((a, b) => rang(a) - rang(b));
}

/** Noms sous lesquels les collègues peuvent joindre la machine (ex. poste-atelier.local). */
export function nomsMachine(nom = hostname()): string[] {
  const n = nom.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(n)) return [];
  const court = n.replace(/\.local$/, '');
  return [...new Set([n, court, `${court}.local`])];
}

export interface OptionsReseau {
  serveur: Server;
  port: number;
  equipe: boolean;
  /** Enregistre le choix (état de l'application). */
  enregistrer: (equipe: boolean) => void;
  cible: CibleDemarrage;
  systeme: Systeme;
  /** Empêcher la veille sur Mac (désactivable pour les tests). */
  veille?: boolean;
}

export class Reseau {
  #o: OptionsReseau;
  #equipe = false;
  #caffeinate: ChildProcess | null = null;
  #erreur: string | null = null;

  constructor(o: OptionsReseau) {
    this.#o = o;
    this.#equipe = o.equipe;
    if (o.equipe) this.#veille(true);
    try { reparerDemarrage(o.systeme, o.cible); } catch { /* réparation au mieux */ }
  }

  get equipe(): boolean {
    return this.#equipe;
  }

  etat(): EtatReseau {
    return {
      equipe: this.#equipe,
      port: this.#o.port,
      adresses: adressesBureau().map((ip) => `http://${ip}:${this.#o.port}`),
      nomMachine: nomsMachine().find((n) => n.endsWith('.local')) ?? null,
      veilleEmpechee: this.#caffeinate !== null,
      demarrage: { possible: fichierDemarrage(this.#o.systeme) !== null, actif: demarrageActif(this.#o.systeme) },
      erreur: this.#erreur,
    };
  }

  /** Noms d'hôte acceptés en plus des adresses IP (mode équipe seulement). */
  hotesAutorises(): string[] {
    return this.#equipe ? nomsMachine() : [];
  }

  /** Adresse utilisée dans les liens envoyés (invitations, formulaires) quand on travaille depuis l'ordinateur lui-même. */
  urlPartage(): string | null {
    const ip = this.#equipe ? adressesBureau()[0] : undefined;
    return ip ? `http://${ip}:${this.#o.port}` : null;
  }

  /** Ouvre ou ferme l'accès au réseau du bureau, même port, sans couper les connexions déjà ouvertes. */
  async regler(equipe: boolean): Promise<EtatReseau> {
    if (equipe === this.#equipe) return this.etat();
    const s = this.#o.serveur;
    const ecouter = (hote: string) => new Promise<void>((ok, ko) => {
      const echec = (e: Error) => ko(e);
      s.once('error', echec);
      s.listen(this.#o.port, hote, () => { s.off('error', echec); ok(); });
    });
    await new Promise<void>((ok) => { s.close(); ok(); }); // n'accepte plus de nouvelles connexions ; les autres continuent
    try {
      await ecouter(equipe ? '0.0.0.0' : '127.0.0.1');
      this.#equipe = equipe;
      this.#erreur = null;
    } catch (e) {
      this.#erreur = `Ouverture impossible (${(e as NodeJS.ErrnoException).code ?? 'erreur'}) : port ${this.#o.port} pris sur le réseau ?`;
      await ecouter(this.#equipe ? '0.0.0.0' : '127.0.0.1');
    }
    this.#o.enregistrer(this.#equipe);
    this.#veille(this.#equipe);
    return this.etat();
  }

  reglerDemarrage(actif: boolean): EtatReseau {
    regleDemarrage(this.#o.systeme, actif, this.#o.cible);
    return this.etat();
  }

  /** Sur Mac : pas de mise en veille tant que l'équipe dépend de cet ordinateur (s'arrête avec Living Business). */
  #veille(empecher: boolean) {
    if (this.#o.veille === false || this.#o.systeme.plateforme !== 'darwin') return;
    if (empecher && !this.#caffeinate) {
      try {
        this.#caffeinate = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' });
        this.#caffeinate.on('error', () => { this.#caffeinate = null; });
        this.#caffeinate.on('exit', () => { this.#caffeinate = null; });
        this.#caffeinate.unref();
      } catch { this.#caffeinate = null; }
    } else if (!empecher && this.#caffeinate) {
      this.#caffeinate.kill();
      this.#caffeinate = null;
    }
  }

  arreter(): void {
    this.#veille(false);
  }
}
