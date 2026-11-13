/**
 * Enregistrement sur disque (auto-hébergé, sans base de données) :
 * - un fichier JSON par installation (`donnees/monde.json`), écrit de façon ATOMIQUE (fichier temporaire + renommage),
 *   droits 0600, dossier 0700 ; une copie de l'état précédent est gardée (`monde.precedent.json`) ;
 * - écritures regroupées (une toutes les ~400 ms au plus) et forcées à l'arrêt du serveur ;
 * - secrets des connecteurs (jetons d'API) CHIFFRÉS au repos en AES-256-GCM. Clé : variable
 *   d'environnement `LB_CLE_SECRETS` (32 octets en base64) ; sinon identifiant systemd `cle-secrets`
 *   (`$CREDENTIALS_DIRECTORY`, jeu en ligne : clé HORS du dossier des données, chiffrée au repos par
 *   LoadCredentialEncrypted) ; à défaut (poste de bureau), fichier `donnees/cle-secrets` (0600) ;
 * - sauvegardes automatiques : une copie par jour dans `donnees/sauvegardes/` (30 jours gardés), sans rien envoyer ailleurs ;
 * - export portable : fichier chiffré par une phrase choisie par l'entreprise (scrypt + AES-256-GCM).
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface Chiffreur {
  chiffrer(clair: string): string;
  dechiffrer(chiffre: string): string;
}

export function creerChiffreur(cle: Buffer): Chiffreur {
  if (cle.length !== 32) throw new Error('clé de chiffrement : 32 octets attendus');
  return {
    chiffrer(clair) {
      const iv = randomBytes(12);
      const c = createCipheriv('aes-256-gcm', cle, iv);
      const donnees = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
      return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), donnees.toString('base64url')].join('.');
    },
    dechiffrer(chiffre) {
      const [v, iv, tag, donnees] = chiffre.split('.');
      if (v !== 'v1' || !iv || !tag || donnees === undefined) throw new Error('secret illisible');
      const d = createDecipheriv('aes-256-gcm', cle, Buffer.from(iv, 'base64url'));
      d.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([d.update(Buffer.from(donnees, 'base64url')), d.final()]).toString('utf8');
    },
  };
}

/** Chiffreur en mémoire (tests, démonstration sans disque). */
export const chiffreurEphemere = (): Chiffreur => creerChiffreur(randomBytes(32));

// ---------------------------------------------------------------- export chiffré par phrase

export const FORMAT_SAUVEGARDE = 'living-business-sauvegarde';

const cleDePhrase = (phrase: string, sel: Buffer): Promise<Buffer> =>
  new Promise((ok, ko) => scrypt(phrase.normalize('NFKC'), sel, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => (e ? ko(e) : ok(k))));

/** Chiffre un contenu (texte) avec une phrase. Le fichier produit ne contient rien de lisible sans la phrase. */
export async function chiffrerAvecPhrase(clair: string, phrase: string): Promise<Record<string, unknown>> {
  const sel = randomBytes(16);
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', await cleDePhrase(phrase, sel), iv);
  const donnees = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
  return { format: FORMAT_SAUVEGARDE, version: 1, le: new Date().toISOString(), kdf: 'scrypt-15-8-1', sel: sel.toString('base64url'), iv: iv.toString('base64url'), tag: c.getAuthTag().toString('base64url'), donnees: donnees.toString('base64url') };
}

export async function dechiffrerAvecPhrase(fichier: unknown, phrase: string): Promise<string> {
  const f = (typeof fichier === 'string' ? JSON.parse(fichier) : fichier) as Record<string, unknown> | null;
  if (!f || f.format !== FORMAT_SAUVEGARDE || f.version !== 1 || typeof f.sel !== 'string' || typeof f.iv !== 'string' || typeof f.tag !== 'string' || typeof f.donnees !== 'string') throw new Error('format');
  const d = createDecipheriv('aes-256-gcm', await cleDePhrase(phrase, Buffer.from(f.sel, 'base64url')), Buffer.from(f.iv, 'base64url'));
  d.setAuthTag(Buffer.from(f.tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(f.donnees, 'base64url')), d.final()]).toString('utf8');
}

/** Durée de conservation des sauvegardes sur la machine (jours) ; la copie hors site suit (installer-jeu.sh). */
export const CONSERVATION_JOURS = 30;
/** Copie du registre des effacements dans le dossier des sauvegardes (suit la copie hors du serveur). */
export const REGISTRE_EFFACEMENTS = 'registre-effacements.jsonl';

/** Une fiche effacée ou anonymisée : son identifiant, jamais un nom. */
export interface Effacement { id: string; mode: 'supprimer' | 'anonymiser'; le: string }
const estEffacement = (e: unknown): e is Effacement => typeof e === 'object' && e !== null
  && typeof (e as Effacement).id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test((e as Effacement).id)
  && ((e as Effacement).mode === 'supprimer' || (e as Effacement).mode === 'anonymiser')
  && typeof (e as Effacement).le === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test((e as Effacement).le);
/** Réunion de deux registres : une ligne par fiche ; « supprimer » l'emporte sur « anonymiser », sinon la plus ancienne reste. */
function unirEffacements(a: readonly Effacement[], b: readonly Effacement[]): Effacement[] {
  const parId = new Map<string, Effacement>();
  for (const e of [...a, ...b]) {
    const deja = parId.get(e.id);
    if (!deja || (deja.mode === 'anonymiser' && e.mode === 'supprimer')) parId.set(e.id, { id: e.id, mode: e.mode, le: e.le });
  }
  return [...parId.values()].sort((x, y) => x.le.localeCompare(y.le));
}

export interface SauvegardeAuto {
  nom: string;
  le: string;
  taille: number;
}

export class Stockage {
  readonly #fichier: string;
  readonly #precedent: string;
  readonly #dossier: string;
  readonly #sauvegardes: string;
  readonly #cle: Buffer;
  readonly chiffreur: Chiffreur;
  #dernierJour: string | null = null;
  #minuterie: NodeJS.Timeout | null = null;
  #source: (() => unknown) | null = null;
  #derniereErreur: string | null = null;

  constructor(dossier: string) {
    mkdirSync(dossier, { recursive: true, mode: 0o700 });
    this.#fichier = join(dossier, 'monde.json');
    this.#precedent = join(dossier, 'monde.precedent.json');
    this.#dossier = dossier;
    this.#sauvegardes = join(dossier, 'sauvegardes');
    this.#cle = Stockage.#lireCle(dossier);
    this.chiffreur = creerChiffreur(this.#cle);
  }

  /** Dossier des données (code d'installation à distance, demande de secours). */
  get dossier(): string {
    return this.#dossier;
  }

  /** Clé des secrets (pour ré-chiffrer les jetons d'une sauvegarde restaurée). */
  get cle(): Buffer {
    return this.#cle;
  }

  /**
   * Clé des secrets. `LB_CLE_HORS_DONNEES=1` (service en ligne) : jamais lue ni créée dans le dossier des données ;
   * sans `LB_CLE_SECRETS` ni identifiant systemd, le démarrage est refusé (une clé neuve rendrait tous les jetons
   * illisibles en silence).
   */
  static #lireCle(dossier: string): Buffer {
    const env = process.env.LB_CLE_SECRETS;
    if (env) {
      const b = Buffer.from(env, 'base64');
      if (b.length !== 32) throw new Error('LB_CLE_SECRETS doit contenir 32 octets encodés en base64');
      return b;
    }
    const identifiants = process.env.CREDENTIALS_DIRECTORY;
    const identifiant = identifiants ? join(identifiants, 'cle-secrets') : null;
    if (identifiant && existsSync(identifiant)) {
      const b = Buffer.from(readFileSync(identifiant, 'utf8').trim(), 'base64');
      if (b.length !== 32) throw new Error('Identifiant systemd « cle-secrets » : 32 octets encodés en base64 attendus');
      return b;
    }
    if (process.env.LB_CLE_HORS_DONNEES === '1') {
      throw new Error('Clé des secrets introuvable (identifiant systemd « cle-secrets » absent) : démarrage refusé. Relancez l’installation : sudo living-business-mise-a-jour');
    }
    const f = join(dossier, 'cle-secrets');
    if (existsSync(f)) return Buffer.from(readFileSync(f, 'utf8').trim(), 'base64');
    const cle = randomBytes(32);
    writeFileSync(f, cle.toString('base64'), { mode: 0o600 });
    return cle;
  }

  /** État enregistré, ou null au premier démarrage. Un fichier corrompu n'est jamais écrasé en silence. */
  lire(): unknown {
    if (!existsSync(this.#fichier)) return null;
    try {
      return JSON.parse(readFileSync(this.#fichier, 'utf8'));
    } catch (e) {
      throw new Error(`${this.#fichier} illisible (${e instanceof Error ? e.message : e}). Restaurez ${this.#precedent} ou déplacez le fichier.`);
    }
  }

  /** Programme une écriture (regroupée). `source` fournit l'état complet au moment d'écrire. */
  planifier(source: () => unknown, delaiMs = 400): void {
    this.#source = source;
    if (this.#minuterie) return;
    this.#minuterie = setTimeout(() => {
      this.#minuterie = null;
      this.ecrireMaintenant();
    }, delaiMs);
    this.#minuterie.unref?.();
  }

  ecrireMaintenant(): void {
    if (this.#minuterie) { clearTimeout(this.#minuterie); this.#minuterie = null; }
    if (!this.#source) return;
    try {
      const json = JSON.stringify(this.#source());
      const tmp = `${this.#fichier}.${process.pid}.tmp`;
      writeFileSync(tmp, json, { mode: 0o600 });
      if (existsSync(this.#fichier)) {
        copyFileSync(this.#fichier, this.#precedent);
        this.#sauvegardeDuJour();
      }
      renameSync(tmp, this.#fichier);
      chmodSync(this.#fichier, 0o600);
      this.#derniereErreur = null;
    } catch (e) {
      this.#derniereErreur = e instanceof Error ? e.message : String(e);
      console.error('[stockage] écriture impossible :', this.#derniereErreur);
    }
  }

  get derniereErreur(): string | null {
    return this.#derniereErreur;
  }

  // ---------------------------------------------------------------- sauvegardes automatiques (locales)

  /** Une copie par jour (la première écriture du jour copie l'état de la veille), 30 gardées ; copies ponctuelles 30 jours. */
  #sauvegardeDuJour(): void {
    const jour = new Date().toISOString().slice(0, 10);
    if (this.#dernierJour === jour) return;
    const cible = join(this.#sauvegardes, `monde-${jour}.json`);
    try {
      mkdirSync(this.#sauvegardes, { recursive: true, mode: 0o700 });
      if (!existsSync(cible)) { copyFileSync(this.#fichier, cible); chmodSync(cible, 0o600); }
      this.#dernierJour = jour;
      // le registre des effacements suit les sauvegardes hors du serveur (réécrit chaque jour : la copie ne retient
      // que les fichiers récents) — sans lui, restaurer sur un autre serveur ferait revenir les personnes effacées
      this.#copierRegistreEffacements();
      const fichiers = readdirSync(this.#sauvegardes).filter((f) => /^monde-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const f of fichiers.slice(0, Math.max(0, fichiers.length - CONSERVATION_JOURS))) unlinkSync(join(this.#sauvegardes, f));
      // copies ponctuelles (avant une restauration…) : même durée, d'après leur date (jamais gardées sans limite)
      const limite = Date.now() - CONSERVATION_JOURS * 86_400_000;
      for (const f of readdirSync(this.#sauvegardes)) {
        if (!/^[a-z0-9-]+\.json$/.test(f) || /^monde-\d{4}-\d{2}-\d{2}\.json$/.test(f)) continue;
        if (statSync(join(this.#sauvegardes, f)).mtimeMs < limite) unlinkSync(join(this.#sauvegardes, f));
      }
    } catch (e) {
      console.error('[stockage] sauvegarde du jour impossible :', e instanceof Error ? e.message : e);
    }
  }

  // ---------------------------------------------------------------- registre des effacements (hors sauvegardes)

  /**
   * Fiches effacées ou anonymisées (identifiants seulement, jamais un nom) : gardé À CÔTÉ des sauvegardes, pour que
   * restaurer une copie d'avant ne fasse pas revenir une personne effacée (rejoué à chaque restauration).
   * Une copie (`registre-effacements.jsonl`) est tenue dans le dossier des sauvegardes, celui qui part hors du serveur
   * (contre-revue de l'audit, constat revue-jeu-1-6) : sur un serveur neuf, la copie reprise avec les sauvegardes
   * compte autant que le registre local — les deux sont toujours lus ensemble, rien de l'un n'écrase l'autre.
   */
  lireEffacements(): Effacement[] {
    let locaux: Effacement[] = [];
    try {
      const x = JSON.parse(readFileSync(join(this.#dossier, 'effacements.json'), 'utf8')) as unknown;
      if (Array.isArray(x)) locaux = x.filter(estEffacement);
    } catch { /* pas encore de registre */ }
    let copie: Effacement[] = [];
    try {
      copie = readFileSync(join(this.#sauvegardes, REGISTRE_EFFACEMENTS), 'utf8').split('\n').filter((l) => l.trim())
        .map((l) => { try { return JSON.parse(l) as unknown; } catch { return null; } }).filter(estEffacement);
    } catch { /* pas de copie */ }
    return copie.length ? unirEffacements(locaux, copie) : locaux;
  }

  noterEffacement(id: string, mode: 'supprimer' | 'anonymiser'): void {
    this.#ecrireEffacements(unirEffacements(this.lireEffacements().filter((e) => e.id !== id), [{ id, mode, le: new Date().toISOString() }]));
  }

  #ecrireEffacements(liste: Effacement[]): void {
    const garde = liste.slice(-20_000);
    const f = join(this.#dossier, 'effacements.json');
    const tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(garde), { mode: 0o600 });
    renameSync(tmp, f);
    this.#copierRegistreEffacements(garde);
  }

  /**
   * Copie du registre dans le dossier des sauvegardes : une ligne JSON par effacement. Le nom (`.jsonl`) ne ressemble
   * pas à une sauvegarde : ni listé, ni restauré, ni purgé comme elles. Réécrite chaque jour (la copie hors du serveur
   * ne retient que les fichiers récents) et à chaque effacement.
   */
  #copierRegistreEffacements(liste: Effacement[] = this.lireEffacements()): void {
    try {
      const f = join(this.#sauvegardes, REGISTRE_EFFACEMENTS);
      if (!liste.length && !existsSync(f)) return;
      mkdirSync(this.#sauvegardes, { recursive: true, mode: 0o700 });
      const tmp = `${f}.${process.pid}.tmp`;
      writeFileSync(tmp, liste.map((e) => JSON.stringify(e)).join('\n') + (liste.length ? '\n' : ''), { mode: 0o600 });
      renameSync(tmp, f);
    } catch (e) {
      console.error('[stockage] copie du registre des effacements impossible :', e instanceof Error ? e.message : e);
    }
  }

  /**
   * Restauration sur un autre serveur avec une copie exportée : le registre joint (le fichier
   * `registre-effacements.jsonl` de l'ancien serveur) est réuni au registre d'ici, puis rejoué avec la restauration.
   * Fichier lu strictement (une ligne inattendue = refus). Renvoie le nombre d'effacements ajoutés.
   */
  importerEffacements(texte: unknown): number {
    if (typeof texte !== 'string' || !texte.trim()) return 0;
    if (texte.length > 4_000_000) throw new Error('Registre des effacements trop volumineux.');
    const recus: Effacement[] = [];
    for (const ligne of texte.split('\n')) {
      if (!ligne.trim()) continue;
      let e: unknown;
      try { e = JSON.parse(ligne); } catch { throw new Error('Ce fichier n’est pas un registre des effacements (une ligne illisible).'); }
      if (!estEffacement(e)) throw new Error('Ce fichier n’est pas un registre des effacements (une ligne inattendue).');
      recus.push({ id: e.id, mode: e.mode, le: e.le });
    }
    const avant = this.lireEffacements();
    const connus = new Set(avant.map((e) => e.id));
    this.#ecrireEffacements(unirEffacements(avant, recus));
    return recus.filter((e) => !connus.has(e.id)).length;
  }

  /** Copie immédiate (avant une restauration, par exemple). */
  sauvegarderMaintenant(etiquette: string): void {
    if (!existsSync(this.#fichier) || !/^[a-z0-9-]{1,40}$/.test(etiquette)) return;
    mkdirSync(this.#sauvegardes, { recursive: true, mode: 0o700 });
    const cible = join(this.#sauvegardes, `${etiquette}-${new Date().toISOString().replace(/[:.]/g, '-').toLowerCase()}.json`);
    copyFileSync(this.#fichier, cible);
    chmodSync(cible, 0o600);
  }

  listerSauvegardes(): SauvegardeAuto[] {
    if (!existsSync(this.#sauvegardes)) return [];
    return readdirSync(this.#sauvegardes)
      .filter((f) => /^[a-z0-9-]+\.json$/.test(f))
      .map((nom) => { const st = statSync(join(this.#sauvegardes, nom)); return { nom, le: st.mtime.toISOString(), taille: st.size }; })
      .sort((a, b) => b.le.localeCompare(a.le));
  }

  /** Lit une sauvegarde automatique par son nom (liste blanche : aucun chemin construit depuis la requête). */
  lireSauvegarde(nom: unknown): unknown {
    const f = this.listerSauvegardes().find((x) => x.nom === nom);
    if (!f) return null;
    return JSON.parse(readFileSync(join(this.#sauvegardes, f.nom), 'utf8'));
  }

  // ---------------------------------------------------------------- réinitialisation sur place (`npm run secours`)

  /** Demande créée par la commande `npm run secours` : prouve l'accès physique au dossier des données. */
  verifierDemandeSecours(jeton: unknown): boolean {
    const f = join(this.#dossier, 'secours.json');
    if (typeof jeton !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(jeton) || !existsSync(f)) return false;
    try {
      const d = JSON.parse(readFileSync(f, 'utf8')) as { empreinte?: unknown; expire?: unknown };
      if (typeof d.empreinte !== 'string' || typeof d.expire !== 'string' || d.expire < new Date().toISOString()) return false;
      const a = Buffer.from(createHash('sha256').update(jeton).digest('base64url'));
      const b = Buffer.from(d.empreinte);
      return a.length === b.length && timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }

  effacerDemandeSecours(): void {
    try { unlinkSync(join(this.#dossier, 'secours.json')); } catch { /* déjà effacée */ }
  }

  /** Écrit une demande (utilisé par la commande `npm run secours`). Renvoie le jeton à mettre dans le lien. */
  static creerDemandeSecours(dossier: string): string {
    mkdirSync(dossier, { recursive: true, mode: 0o700 });
    const jeton = randomBytes(32).toString('base64url');
    const expire = new Date(Date.now() + 15 * 60_000).toISOString();
    writeFileSync(join(dossier, 'secours.json'), JSON.stringify({ empreinte: createHash('sha256').update(jeton).digest('base64url'), expire }), { mode: 0o600 });
    return jeton;
  }
}
