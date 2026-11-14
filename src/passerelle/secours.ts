/**
 * `npm run secours` : mot de passe ET code de secours perdus.
 * À lancer sur l'ordinateur qui fait tourner Living Business : avoir accès au dossier des données suffit à prouver
 * qu'on en est le propriétaire. Le lien n'est valable que 15 minutes, une fois, et seulement depuis cet ordinateur.
 * En ligne (LB_EN_LIGNE=1, `sudo living-business-secours` sur le serveur, lancé avec l'utilisateur du service) :
 * le lien est `${LB_ORIGINE}/secours/<jeton>` et s'ouvre depuis n'importe quel appareil (15 minutes, une fois).
 * La réinitialisation remet aussi à zéro la validation en deux étapes du compte choisi.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Stockage } from './stockage.ts';

const dossier = process.env.LB_DONNEES && process.env.LB_DONNEES !== 'memoire' ? process.env.LB_DONNEES : fileURLToPath(new URL('../../donnees/', import.meta.url));
const port = Number(process.env.PORT ?? 4173);
if (!existsSync(join(dossier, 'monde.json'))) {
  console.error(`Aucune installation trouvée dans ${dossier}.`);
  process.exit(1);
}
let origine: string | null = null;
if (process.env.LB_EN_LIGNE === '1') {
  try {
    const u = new URL(process.env.LB_ORIGINE ?? '');
    if (u.protocol === 'https:' || u.protocol === 'http:') origine = u.origin;
  } catch { /* LB_ORIGINE absente ou invalide */ }
  if (!origine) {
    console.error('LB_EN_LIGNE=1 : indiquez l’adresse de Living Business dans LB_ORIGINE (ex. https://jeu.monentreprise.fr).');
    process.exit(1);
  }
}
const jeton = Stockage.creerDemandeSecours(dossier);
if (origine) {
  console.log('Lien de réinitialisation (15 minutes, une seule fois) — ouvrez-le sur votre téléphone ou votre ordinateur :');
  console.log(`  ${origine}/secours/${jeton}`);
  console.log('Choisissez le compte administrateur et un nouveau mot de passe. Sa validation en deux étapes sera à refaire.');
} else {
  console.log('Lien de réinitialisation (15 minutes, une seule fois, depuis CET ordinateur uniquement) :');
  console.log(`  http://127.0.0.1:${port}/secours/${jeton}`);
  console.log('Living Business doit être lancé (npm start). Ouvrez le lien, choisissez le compte et un nouveau mot de passe.');
}
