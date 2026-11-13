/**
 * Clé(s) publique(s) de signature de l'éditeur (deploiement/signataires-editeur, copié dans chaque paquet) : le jeu
 * les affiche dans Réglages → Mettre en ligne pour vérifier installer-jeu.sh AVANT de le lancer en root sur le serveur.
 * Les serveurs déjà installés gardent la clé enregistrée à l'installation (/etc/living-business/signataires).
 */
import { readFileSync } from 'node:fs';

const LIGNE = /^editeur-living-business namespaces="[a-z,-]+" (?:ssh-ed25519|sk-ssh-ed25519@openssh\.com|ecdsa-sha2-nistp256|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,2}(?: [A-Za-z0-9._@-]+)?$/;

/** Lignes de clés valables (format allowed_signers d'OpenSSH) ; vide si aucune clé n'est encore publiée. */
export function signatairesEditeur(fichier: string | URL = new URL('../../deploiement/signataires-editeur', import.meta.url)): string[] {
  try {
    return readFileSync(fichier, 'utf8').split('\n').map((l) => l.trim()).filter((l) => LIGNE.test(l)).slice(0, 4);
  } catch {
    return [];
  }
}
