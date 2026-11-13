/* Living Business — écrans d'entrée (direction de design §6.1 P5, §2.3, §2.6, §4.6, §4.7).
   Module PUR (aucun accès au DOM ni au stockage), testé par src/ds/entree.test.ts : les 3 promesses du panneau de
   marque, les choix de départ de l'installation, les 2 temps de l'installation et l'indicateur de robustesse du mot de
   passe (en texte : « Faible », « Correct », « Solide »), aligné sur la règle de la passerelle (10 caractères au moins,
   pas un mot de passe courant, pas l'identifiant). */
import { pluriel } from './bz/typo.js';

/** Les 3 promesses, complètes, y compris sur téléphone (sous le formulaire). */
export function promesses({ enLigne = false } = {}) {
  return [
    enLigne
      ? { icone: 'shield-check', titre: 'Vos données restent sur votre serveur', texte: 'Votre site, à votre nom : l’éditeur ne voit rien et n’y a aucun accès.' }
      : { icone: 'shield-check', titre: 'Vos données restent chez vous', texte: 'Tout reste sur cet ordinateur. Rien n’est envoyé à l’éditeur sans votre accord.' },
    { icone: 'users', titre: 'Vous décidez de tout', texte: 'Équipe, droits, sauvegardes : tout se règle ici, sans abonnement ni assistance.' },
    { icone: 'bz-nexus', titre: 'Breizhcosystem seulement si vous le voulez', texte: 'Le réseau des entreprises bretonnes s’ouvre uniquement quand vous le choisissez.' },
  ];
}

/** Choix de départ (grandes cartes illustrées, §4.7). `existant` : données déjà présentes ({ reels, organisation }). */
export function departs(existant = null) {
  return [
    existant?.reels ? {
      id: 'garder', icone: 'archive', titre: 'Garder les données déjà présentes',
      texte: `${pluriel(existant.reels, 'élément déjà saisi', 'éléments déjà saisis')}${existant.organisation ? ` pour ${existant.organisation}` : ''}.`,
    } : null,
    { id: 'vide', icone: 'sunrise', titre: 'Partir de mon entreprise', texte: 'Une carte à votre nom, prête à recevoir vos données. On vous guide en 5 petites étapes.' },
    { id: 'exemple', icone: 'flask-conical', titre: 'Découvrir d’abord avec un exemple', texte: 'Une entreprise fictive pour essayer. Un clic suffit ensuite pour passer à la vôtre.' },
  ].filter(Boolean);
}

/** Les 2 temps de l'installation (§6.1 P5). */
export const TEMPS_INSTALLATION = Object.freeze([
  Object.freeze(['vous', 'Vous et l’entreprise']),
  Object.freeze(['securite', 'Sécurité']),
]);

const COURANTS = new Set(['motdepasse', 'motdepasse1', 'motdepasse123', 'azertyuiop', 'azerty1234', 'qwertyuiop', 'password123', 'bonjour123', 'soleil1234', 'jetaime123', 'bretagne29', 'bretagne56', 'bretagne22', 'bretagne35', 'livingbusiness', '1234567890', '0123456789', 'administrateur']);

/**
 * Robustesse d'un mot de passe, sans rien envoyer : { niveau: 'vide'|'faible'|'correct'|'solide', libelle, conseil, valide }.
 * `valide` suit la règle de la passerelle (le serveur reste seul juge) ; « Solide » demande 16 caractères, ou 12 avec
 * trois sortes de caractères ou trois mots. `minimum` : 10 pour un mot de passe, plus pour une phrase d'export.
 */
export function robustesse(mdp, identifiant = '', minimum = 10) {
  const m = typeof mdp === 'string' ? mdp : '';
  if (!m) return { niveau: 'vide', libelle: '', conseil: `${minimum} caractères au moins : une petite phrase marche très bien.`, valide: false };
  const bas = m.toLowerCase();
  const ident = String(identifiant ?? '').toLowerCase().split('@')[0] ?? '';
  if (m.length < minimum) return { niveau: 'faible', libelle: 'Faible', conseil: `Encore ${pluriel(minimum - m.length, 'caractère', 'caractères')} au moins.`, valide: false };
  if (m.length > 200) return { niveau: 'faible', libelle: 'Faible', conseil: '200 caractères au plus.', valide: false };
  if (COURANTS.has(bas.replace(/\s+/g, '')) || /^(.)\1+$/.test(m) || /^(0123456789|1234567890)+$/.test(m)) return { niveau: 'faible', libelle: 'Faible', conseil: 'Trop courant : choisissez-en un autre.', valide: false };
  if (ident.length >= 3 && bas.includes(ident)) return { niveau: 'faible', libelle: 'Faible', conseil: 'Il ne doit pas contenir votre identifiant.', valide: false };
  const sortes = [/[a-zà-ÿ]/, /[A-ZÀ-Ý]/, /\d/, /[^\p{L}\p{N}\s]/u].filter((r) => r.test(m)).length;
  const mots = m.trim().split(/\s+/).filter((x) => x.length >= 2).length;
  if (m.length >= 16 || (m.length >= 12 && (sortes >= 3 || mots >= 3))) return { niveau: 'solide', libelle: 'Solide', conseil: 'Très bien : notez-le dans votre gestionnaire de mots de passe.', valide: true };
  return { niveau: 'correct', libelle: 'Correct', conseil: 'Plus long, il serait plus sûr : ajoutez un mot ou deux.', valide: true };
}
