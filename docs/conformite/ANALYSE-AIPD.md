# Analyse d'impact (AIPD) : faut-il en faire une ?

Article 35 du RGPD, liste des traitements pour lesquels la CNIL exige une AIPD (délibération n° 2018-327) et critères
du CEPD (lignes directrices WP248 rév. 01) : une AIPD est en principe requise quand un traitement remplit **au moins
deux** des neuf critères ci-dessous. Ce document applique ces critères à ce que fait **le code** de Living Business.
Il ne remplace pas l'analyse que l'entreprise doit mener sur **son** usage, ni un conseil juridique.

## 1. L'éditeur du jeu

Pour les données de Living Business, l'éditeur n'est ni responsable du traitement ni sous-traitant : il n'y a pas
accès (voir [README.md](README.md)). Il n'a donc **pas d'AIPD à faire pour le jeu**. Les traitements de Breizhcosystem (réseau
payant, hébergé par l'éditeur) et du relais « Se connecter avec… » relèvent de la documentation de Breizhcosystem.

## 2. L'entreprise qui utilise Living Business

| Critère (WP248) | Dans Living Business | Rempli ? |
|---|---|---|
| 1. Évaluation ou notation de personnes | Aucune notation ni aucun classement de salariés. Le score de santé porte sur l'entreprise (taux globaux), le baromètre ne donne que des résultats regroupés par 5 au moins | Non (si l'entreprise n'utilise pas le jeu pour évaluer quelqu'un) |
| 2. Décision automatique produisant des effets juridiques | Aucune : le jeu propose, une personne décide ; une clé d'API (assistant d'IA) ne fait que préparer, une personne approuve | Non |
| 3. Surveillance systématique | Pas de géolocalisation, pas de suivi d'activité, pas de mesure du temps de travail. Le planning dit où chacun est affecté | Non, sauf usage du planning pour contrôler les salariés |
| 4. Données sensibles ou très personnelles | Le motif d'absence « maladie » est une donnée relative à la santé (sans diagnostic, liste fermée), vue des seuls profils qui ont le droit RH. Commentaires libres (avis, baromètre) : le formulaire client demande de ne pas y écrire de donnée de santé, celui du baromètre de n'y rien écrire qui permette de reconnaître quelqu'un | **Oui** dès que les motifs d'absence sont saisis |
| 5. Grande échelle | Une installation = une entreprise (TPE ou PME) | Non en général ; à revoir au-delà de quelques centaines de salariés |
| 6. Croisement de données | Synchronisation avec les outils de l'entreprise (CRM, tableur, boutique), annuaire Bodacc | Faible : mêmes données, mêmes finalités |
| 7. Personnes vulnérables | **Salariés** (déséquilibre de la relation avec l'employeur, selon le CEPD) | **Oui** pour le planning et le baromètre |
| 8. Usage innovant | Assistant d'IA branché par MCP (Claude ou autre), choisi par l'entreprise | **Oui** si l'entreprise branche un assistant d'IA sur des données de salariés |
| 9. Exclusion d'un droit, d'un service ou d'un contrat | Aucune | Non |

## 3. Conclusion par usage

- **Gestion commerciale seule** (clients, fournisseurs, stock, commandes, avis clients) : au plus un critère. **AIPD non
  requise** ; tenir le registre (T2, T5, T6, T7).
- **Planning sans motif d'absence** (« Absence » seulement) : critère 7. **AIPD non requise** en général.
- **Planning avec motifs d'absence** (« maladie ») : critères 4 et 7, donc **AIPD recommandée**. Elle peut rester
  courte, car les mesures sont déjà dans le code (droit RH, journal sans motif, durée de conservation réglable,
  effacement en cascade, aucune note sociale vers Breizhcosystem sous 11 personnes). Autre voie : ne pas saisir le motif
  (« Absence » suffit pour organiser le travail) et le garder dans le logiciel de paie.
- **Baromètre d'équipe** : critère 7 et, selon les commentaires, critère 4. L'anonymat est réel dans le code (aucun
  nom, publication par lots de 5, 13 mois). **AIPD conseillée si le CSE ou les salariés le demandent** ; dans tous les
  cas, informer et consulter le CSE avant le lancement ([NOTICE-BAROMETRE-SALARIES.md](NOTICE-BAROMETRE-SALARIES.md)).
- **Assistant d'IA branché sur le planning ou les salariés** : critères 7 et 8, et 4 si le profil de la clé a le droit
  RH. **AIPD requise.** L'usage peut aussi relever du « haut risque » de l'AI Act (annexe III, point 4) : voir
  [IA.md](IA.md). Le plus simple est de donner à la clé un profil **sans** le planning ou sans le droit RH.

## 4. Si une AIPD est faite : plan court

1. **Description** : reprendre les fiches du registre ([REGISTRE-TRAITEMENTS.md](REGISTRE-TRAITEMENTS.md), T3, T4, T9).
2. **Nécessité et proportionnalité** : pourquoi le motif est nécessaire (sinon, « Absence ») ; durée réglée dans le
   jeu ([DUREES-CONSERVATION.md](DUREES-CONSERVATION.md)) ; information ([NOTICE-PLANNING-SALARIES.md](NOTICE-PLANNING-SALARIES.md)).
3. **Risques** : accès d'un collègue au motif (mesure : droit RH contrôlé côté serveur) ; fuite d'une sauvegarde
   (mesure : export chiffré par phrase, copie hors serveur chiffrée) ; assistant d'IA qui lit ou modifie trop (mesures :
   profil limité, approbation humaine, journal avec la clé) ; ordinateur volé (mesure : chiffrement du disque, à la
   charge de l'entreprise).
4. **Avis** : délégué à la protection des données s'il y en a un, CSE s'il existe.
5. **Revue** : à chaque nouvel outil branché ou nouvel assistant d'IA.
