# Durées de conservation

Trois parties : ce que **le code applique tout seul**, ce que **l'entreprise règle dans le jeu** (Réglages ›
Confidentialité › Durées de conservation), et ce qu'elle **doit faire à la main** (effacement par fiche).

## Appliqué par le code

| Donnée | Durée | Où (code) |
|---|---|---|
| Réponses au baromètre d'équipe | 400 jours (13 mois) après le mois de réception, puis effacement | `src/passerelle/enquetes.ts` (`CONSERVATION_JOURS`) |
| Invitations aux formulaires (avis clients, baromètre) | 400 jours après l'envoi ; lien valable 30 jours | `enquetes.ts` |
| Résultats du baromètre affichés | publications des 4 derniers mois | `enquetes.ts` |
| Sauvegardes quotidiennes sur la machine | 30 copies (30 jours) ; copies ponctuelles (« avant restauration ») : 30 jours d'après leur date | `src/passerelle/stockage.ts` (`CONSERVATION_JOURS`) |
| Copie chiffrée hors serveur (si activée) | envoi chaque nuit des sauvegardes de moins de 72 h, puis effacement dans le stockage des copies de plus de 31 jours (seulement si une copie récente est bien arrivée : une panne n'efface pas les dernières copies). Une règle de cycle de vie du conteneur S3 (31 jours) peut doubler cette purge. **Stockage verrouillé** (Object Lock et clé sans droit d'effacement, recommandé contre les rançongiciels, fichier `/etc/living-business/copie-verrouillee`) : le serveur n'efface rien, c'est la règle de cycle de vie, à créer par l'entreprise chez son hébergeur S3 (versions courantes expirées après 31 jours, anciennes versions supprimées 1 jour après), qui fait la purge ; sans cette règle, les copies ne seraient jamais effacées | `deploiement/installer-jeu.sh` (`CONSERVATION_HORS_SITE`, service `living-business-sauvegarde`) |
| Journal d'activité | les 5 000 dernières entrées (les plus anciennes sont effacées) ; une fiche effacée en disparaît (nom et textes remplacés par « [effacé] ») ; la même case de planning modifiée à la suite par la même personne ou la même clé ne fait qu'une ligne | `src/passerelle/monde.ts` |
| Journal de sécurité (exports et restaurations, clés d'API, accès et profils, comptes, liaison et partage avec le réseau Breizhcosystem, avis de sécurité, effacements, purges, installation) | **12 mois**, à part du journal d'activité qui ne le chasse pas ; 2 000 lignes au plus par type d'événement ; il suit dans l'état restauré après une restauration ; ni identifiant de connexion ni mot de passe, une fiche effacée en disparaît aussi | `src/passerelle/monde.ts` (`JOURNAL_SECURITE_DUREE_MS`) |
| Avis de sécurité aux administrateurs (export complet fait par un autre) | jusqu'à « J'ai vu », 90 jours au plus, 20 avis au plus | `src/passerelle/application.ts` (`AVIS_DUREE_MS`) |
| Registre des effacements (identifiants des fiches effacées, jamais un nom) | sans limite (20 000 au plus), à côté des sauvegardes et recopié chaque jour avec elles (`registre-effacements.jsonl`, qui suit la copie hors du serveur) : rejoué à chaque restauration, y compris sur un autre serveur si ce fichier est joint | `src/passerelle/stockage.ts` (`effacements.json`) |
| Enregistrements d'un outil dont la fiche a été effacée (identifiants de l'outil) | tant que le connecteur existe (20 000 au plus) : jamais réimportés | `src/passerelle/synchro.ts` (`exclus`) |
| Dernière version vue sur Breizhcosystem | remplacée à chaque vérification | `src/passerelle/mises-a-jour.ts` |
| Sessions | 8 heures ; attente du code de validation en deux étapes : 5 minutes | `src/passerelle/http.ts` |
| Invitation d'un collègue (compte) | 7 jours, usage unique | `src/passerelle/comptes.ts` |
| Lien de secours (mot de passe perdu) | 15 minutes, usage unique | `src/passerelle/secours.ts` |
| Code d'installation en ligne | jusqu'à l'installation, puis détruit | `src/passerelle/en-ligne.ts` |
| Connexion « Se connecter avec… » en cours | 30 minutes au plus, en mémoire | `src/passerelle/synchro.ts` |
| Vérification du téléphone (QR) | 10 minutes, en mémoire | `src/passerelle/verification-telephone.ts` |
| Partage Breizhcosystem publié (besoins) | durée décidée par Breizhcosystem (21 jours d'après Breizhcosystem) | côté Breizhcosystem |

## Réglées par l'entreprise dans le jeu (aucune durée imposée par défaut)

| Donnée | Choix | Effet |
|---|---|---|
| Planning passé (absences comprises, dont le motif « maladie ») | sans limite, 6 mois, 1, 2 ou 3 ans | cases plus anciennes effacées chaque jour |
| Avis clients | idem | fiches d'avis reçus avant la limite effacées (en cascade) |
| Courrier traité | idem | courrier marqué « traité » et reçu avant la limite effacé (le courrier à traiter reste) |

Le choix est confirmé à l'écran (« Ce qui est plus ancien est effacé tout de suite, puis chaque jour »), inscrit au
journal (`conservation.purge`, avec les nombres seulement). Les durées par défaut sont une décision de l'éditeur et
de l'entreprise.

## À faire par l'entreprise (effacement par fiche, repères)

Sur chaque fiche, un administrateur dispose de « Données personnelles » : **Télécharger ses données** (droit d'accès),
**Anonymiser** (nom et textes libres retirés, chiffres et dates gardés), **Effacer la fiche** (en cascade : planning,
références des autres fiches, actions, invitations aux formulaires, journal ; plus réimportée par un connecteur).

| Donnée | Repère (à adapter) |
|---|---|
| Prospects (fiches tiers sans commande) | 3 ans après le dernier contact (recommandation CNIL) |
| Clients | durée de la relation, puis archivage pour les obligations légales (ex. 10 ans pour les pièces comptables, qui restent dans le logiciel comptable) |
| Contacts des fournisseurs | durée de la relation |
| Salariés (fiche et planning) | durée du contrat ; planning passé : à limiter (ex. 1 an glissant) ; motif « maladie » : le plus court possible |
| Avis clients | ex. 3 ans |
| Courrier collé et tâches terminées | ex. 1 an |
| Journal d'activité | 5 000 entrées pour l'activité courante (durée variable selon l'usage) ; les événements de sécurité sont gardés 12 mois à part (repère CNIL pour les journaux de sécurité : 6 mois à 1 an) |
| Comptes désactivés | à supprimer après le départ de la personne (ex. 1 mois) |

Une purge automatique de ces catégories demande une décision de produit (durées par défaut, réglage par
l'entreprise).

## Après un effacement (droit à l'effacement, départ d'un salarié)

La donnée effacée dans le jeu reste dans les sauvegardes jusqu'à leur expiration : au plus 30 jours sur la machine,
31 jours dans la copie hors serveur. C'est la durée à indiquer à la personne. Les sauvegardes ne sont pas modifiées
une à une (elles sont chiffrées et servent à réparer un incident) ; une restauration ne doit pas faire revenir une
donnée effacée (voir [REGISTRE-TRAITEMENTS.md](REGISTRE-TRAITEMENTS.md), § Sauvegardes).

Un connecteur supprimé : sa clé disparaît tout de suite de l'état, l'accès est révoqué chez Google et HubSpot ; pour
les autres outils (et les clés collées), le jeu demande de retirer l'accès chez l'outil. La clé reste chiffrée dans
les sauvegardes jusqu'à leur expiration (la clé de déchiffrement n'est jamais copiée hors du serveur).
