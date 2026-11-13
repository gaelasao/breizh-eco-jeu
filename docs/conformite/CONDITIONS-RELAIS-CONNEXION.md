# Relais « Se connecter avec… » — information et clauses de sous-traitance (art. 13 et 28 RGPD)

**Statut** : projet de conditions, rédigé d'après le code du jeu (`src/passerelle/oauth-relais.ts`,
`src/passerelle/synchro.ts`) et ce que le jeu sait du relais. Il doit être **complété, validé et publié par
l'éditeur** (identité, contact, hébergement), puis présenté à l'entreprise avant sa
première connexion par le relais. Rien ici ne vaut engagement tant que l'éditeur ne l'a pas publié.

## 1. Pourquoi un relais

HubSpot, Google, Microsoft, Notion, Airtable, Pipedrive, Sellsy et Shopify n'acceptent que des logiciels **déclarés**
chez eux, avec un secret et une adresse de retour https. Le jeu, installé chez l'entreprise, ne peut ni garder ce
secret ni recevoir ce retour : le serveur de l'éditeur (Breizhcosystem) le fait à sa place, **sans compte Breizhcosystem**. Une autre voie
existe toujours, sans l'éditeur : le **mode avancé** (clé créée par l'entreprise dans son outil).

## 2. Qui est qui

- **Responsable du traitement** : l'entreprise qui utilise Living Business. Elle décide de connecter son outil et de
  ce que le jeu en lit ou y écrit.
- **Sous-traitant** : l'éditeur de Living Business, pour l'exploitation du relais : [raison sociale, forme, SIREN,
  adresse de l'éditeur — à fournir].
- **Destinataires** : l'outil choisi par l'entreprise (son propre sous-traitant, sous son contrat avec lui).

## 3. Ce que le relais traite (d'après le code du jeu)

| Donnée | Quand | Durée chez l'éditeur |
|---|---|---|
| Jetons d'accès et de rafraîchissement remis par l'outil | à la connexion | **10 minutes au plus, en mémoire**, le temps de les remettre UNE fois au jeu |
| Jeton de rafraîchissement, puis nouveau jeton d'accès | à chaque renouvellement (environ toutes les heures pendant les synchronisations) | le temps de la requête |
| Adresse de la boutique Shopify, du site WooCommerce ou de l'organisation Dynamics | à la connexion et au renouvellement, si l'outil en a une | idem |
| Adresse de ce Living Business (adresse de retour), code court de la demande | à la connexion | 10 minutes au plus |
| Adresse IP du serveur ou de l'ordinateur du jeu | à chaque appel | journaux techniques du serveur : [durée à fixer par l'éditeur] |
| Droits demandés (`lecture` ou `ecriture`) | à la connexion et au renouvellement | idem |

Les **données** de l'entreprise (fiches, contacts, fichiers, tableurs) ne passent **jamais** par le relais : le jeu
appelle l'outil directement avec ses jetons. Le jeu ne contacte le relais qu'après un clic sur « Se connecter avec… »,
puis aux renouvellements ; ouvrir « Connecter mes données » ne le contacte pas. Seule exception, le temps réel (§3 bis) :
certains outils mettent une partie des données changées dans leurs avis, qui passent par Breizhcosystem.

## 3 bis. Temps réel (avis des outils), quand Living Business est relié à Breizhcosystem

Un outil ne prévient de ses changements qu'une adresse publique sur Internet : ses avis arrivent à Breizhcosystem,
qui prévient le Living Business de l'entreprise, lequel relit l'outil lui-même (`src/passerelle/temps-reel.ts`).

| Donnée | Quand | Durée chez l'éditeur |
|---|---|---|
| Avis de l'outil : identifiants (Airtable, Google, Microsoft, Notion), et **une partie des données changées** (HubSpot : valeur d'une propriété ; Pipedrive : l'objet changé) | à chaque changement chez l'outil | **jamais gardé** : vérifié, puis seuls le branchement et au plus 20 identifiants sont poussés au jeu |
| Abonnement : outil, identifiant chez l'outil, secret de vérification (chiffré), dates | du branchement au débranchement | tant que l'outil est branché |
| Compte chez l'outil (Notion : espace et robot ; HubSpot : numéro du compte), noté à la connexion en un clic | à la connexion | avec la connexion du relais |
| Date du premier avis en attente, quand le Living Business est éteint | à un avis | remise à la reconnexion, **24 heures au plus** |
| Empreinte (SHA-256) du jeton de renouvellement, envoyée par le jeu pour désigner sa connexion Notion ou HubSpot | au branchement | le temps de la requête |

Le jeu crée lui-même l'abonnement chez l'outil, avec ses jetons ; il n'accepte une adresse d'avis que sur l'origine
de Breizhcosystem qu'il connaît, et supprime l'abonnement au débranchement. Sans liaison avec Breizhcosystem, rien de
tout cela : chaque outil est relu à son intervalle. [Clause correspondante au §4 : à ajouter par l'éditeur.]

## 4. Clauses de sous-traitance (art. 28.3)

1. **Objet et durée** : remise et renouvellement des jetons de connexion des outils de l'entreprise, tant qu'une
   connexion par le relais existe dans son Living Business.
2. **Instructions** : l'éditeur ne traite ces données que pour remettre les jetons au Living Business qui a lancé la
   demande, et pour les renouveler à sa demande ; il ne les utilise pour **aucune** autre finalité, ne les lit pas, ne
   les enregistre pas au-delà de la durée du tableau 3, et n'appelle jamais l'outil avec.
3. **Portée minimale** : le relais demande à l'outil la portée la plus faible compatible avec le sens de synchronisation
   choisi par l'entreprise (lecture seule par défaut ; écriture seulement pour une synchronisation qui écrit).
4. **Confidentialité** : les personnes de l'éditeur qui exploitent le serveur sont tenues au secret.
5. **Sécurité (art. 32)** : chiffrement des jetons en mémoire, https seulement, secret d'attente remis au seul jeu
   demandeur, confirmation de la personne sur la page du relais (code court à recopier), adresse de retour limitée au
   jeu ; accès d'administration au serveur limité et journalisé ([mesures à confirmer par l'éditeur, voir
   [SECURITE.md](SECURITE.md)]).
6. **Sous-traitants ultérieurs** : hébergeur du serveur de l'éditeur [nom, pays — à fournir] ; aucun autre sans
   information préalable de l'entreprise et possibilité de s'y opposer (en cessant d'utiliser le relais).
7. **Transferts hors UE** : aucun par le relais lui-même [à confirmer par l'éditeur] ; les transferts vers l'outil
   relèvent du contrat de l'entreprise avec cet outil (voir [SOUS-TRAITANTS-TRANSFERTS.md](SOUS-TRAITANTS-TRANSFERTS.md)).
8. **Droits des personnes** : l'éditeur aide l'entreprise à y répondre ; il ne garde rien qui permette d'y répondre
   lui-même (pas de stockage).
9. **Violation de données** : l'éditeur prévient l'entreprise **sans délai** après en avoir eu connaissance (au plus tard
   sous [24] heures), avec les informations de l'article 33.3, et fait révoquer par les outils les jetons concernés
   quand c'est possible (voir [VIOLATION-DONNEES.md](VIOLATION-DONNEES.md), [SECURITE.md](SECURITE.md)).
10. **Fin** : quand l'entreprise supprime le connecteur, le jeu révoque l'accès chez Google et HubSpot et lui indique
    de le retirer chez les autres outils ; l'éditeur ne garde aucune copie.
11. **Audit** : l'éditeur met à disposition les informations nécessaires pour démontrer le respect de ces clauses.

## 5. Base légale, côté entreprise

Exécution des contrats avec ses clients et fournisseurs et intérêt légitime à tenir ses outils à jour (art. 6.1.b et
f) pour les contacts que contient l'outil connecté. Les personnes concernées (contacts du CRM, clients de la boutique)
sont informées par l'entreprise dans sa propre politique de confidentialité.
