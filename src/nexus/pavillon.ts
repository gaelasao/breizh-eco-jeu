/**
 * Apparence du pavillon Breizhcosystem dans le monde (chap. 4.3, 10.2, R08–R10).
 * Dérivée UNIQUEMENT de droits confirmés par le serveur Breizhcosystem — jamais d'un paramètre d'URL,
 * d'un retour navigateur après paiement, ni d'une animation.
 */
import type { Droits } from './droits.ts';

export type EtatNexus =
  | { statut: 'non_connecte' }
  | { statut: 'connecte'; droits: Droits }
  | { statut: 'indisponible'; dernierConnu: Droits | null; depuis: string }
  /** Entreprise suspendue par l'éditeur : la liaison (clé) est conservée, elle resservira à la levée. */
  | { statut: 'suspendu'; depuis: string; message: string | null };

export type Apparence = 'endormi' | 'gratuit' | 'actif' | 'en_attente' | 'hors_ligne';

export interface VuePavillon {
  apparence: Apparence;
  message: string;
  /** Transformation animée : seulement si actif ET animations autorisées (accessibilité). */
  animer: boolean;
  /** Les fonctions payantes restent décidées côté serveur ; ceci ne sert qu'à l'affichage. */
  afficherFonctionsActives: boolean;
}

export function vuePavillon(etat: EtatNexus, prefs: { animations: boolean }): VuePavillon {
  switch (etat.statut) {
    case 'non_connecte':
      return {
        apparence: 'endormi',
        message: 'Pavillon Breizhcosystem : découverte. Aucune donnée privée transmise.',
        animer: false,
        afficherFonctionsActives: false,
      };
    case 'indisponible':
      return {
        apparence: 'hors_ligne',
        message: `Réseau Breizhcosystem indisponible depuis ${etat.depuis}. Votre monde privé continue.`,
        animer: false,
        afficherFonctionsActives: false,
      };
    case 'suspendu':
      return {
        apparence: 'hors_ligne',
        message: 'Accès à Breizhcosystem suspendu par l’éditeur. La liaison est conservée : tout reprendra à la levée de la suspension. Votre monde privé continue.',
        animer: false,
        afficherFonctionsActives: false,
      };
    case 'connecte': {
      const d = etat.droits;
      if (d.etatAbonnement === 'paiement_en_attente' || d.etatAbonnement === 'paiement_echoue') {
        return {
          apparence: 'en_attente',
          message:
            d.etatAbonnement === 'paiement_echoue'
              ? 'Paiement en échec : Breizhcosystem ACTIVE non activé. Fonctions gratuites disponibles.'
              : 'Paiement en cours de confirmation par le prestataire.',
          animer: false,
          afficherFonctionsActives: false,
        };
      }
      if (d.plan === 'active') {
        return {
          apparence: 'actif',
          message:
            d.etatAbonnement === 'grace'
              ? 'Breizhcosystem ACTIVE (délai de grâce) : régularisez le paiement.'
              : 'Breizhcosystem ACTIVE : passerelle réseau ouverte.',
          animer: prefs.animations,
          afficherFonctionsActives: true,
        };
      }
      return {
        apparence: 'gratuit',
        message: 'Breizhcosystem gratuit : publiez un besoin, lisez vos réponses.',
        animer: false,
        afficherFonctionsActives: false,
      };
    }
  }
}
