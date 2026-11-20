# Breizhcosystem en SaaS — ce qui est décidé

Tenu à jour au fil des décisions. Ce qui est ici est tranché ; ce qui ne l'est pas n'y est pas.

## L'architecture

**Une instance par client.** Le jeu est déjà « une entreprise par installation » : un dossier, un processus, ses
données. Héberger une instance par client fait tourner le même code sans le toucher, et l'isolation est garantie
par construction plutôt que par la vigilance de chaque requête.

**La façade est déjà multi-locataire.** Le nexus tient les comptes de toutes les entreprises, et l'A2A porte déjà un
`tenant` dans son adresse (`/a2a/{tenant}/.well-known/agent-card.json`). C'est le jeu qui est mono-entreprise, et
c'est très bien ainsi.

**Pourquoi héberger, vraiment.** Pas pour éviter un installateur : pour que les deux côtés d'un échange entre
agents soient chez l'éditeur. C'est ce qui rend le réseau immédiat et garantissable.

## Les deux chemins, et ce qui les sépare

| | SaaS (breizhcosystem.fr) | Auto-hébergé (GitHub) |
|---|---|---|
| Données | chez l'éditeur | chez l'entreprise |
| Connexions Google / Microsoft | **le relais de l'éditeur** | **sa propre application**, avec un guide |
| Compte | un seul, sur la façade | le sien, chez lui |
| Prix | gratuit ou payant | gratuit, tout compris |

**Pourquoi l'auto-hébergé n'utilise PAS le relais.** Ce n'est pas une punition : c'est une protection. L'inscription
Google de l'éditeur est **une seule application**. Une installation qui s'en servirait mal ferait suspendre
l'application — donc le SaaS avec. Et les quotas d'API sont partagés : des auto-hébergés gratuits dégraderaient les
clients payants. Le mode clé existe déjà dans le jeu ; il ne manque que le guide.

## La frontière gratuit / payant

**Le gratuit ne synchronise pas en fond.** Il a tout le jeu : import de fichiers, saisie, écrans, carte. Mais son
instance ne tourne que quand quelqu'un est devant. Le payant tourne en continu et se met à jour tout seul.

Raison : avec une instance par client, un compte gratuit qui relève son courrier toutes les minutes coûte de
l'argent **en permanence, pour toujours**. Cette frontière tient le coût à prix fixe, se dit en une phrase, et
prolonge le partage que `core/offre.ts` pose déjà — ce qui REGARDE est gratuit, ce qui AGIT est payant.

## Le courrier : Outlook oui, Gmail plus tard

Décidé le 20 novembre 2026. On n'offre que ce que Google et Microsoft vérifient gratuitement :

- **Gratuit, donc ouvert à tous** : Google Agenda, Google Tasks, Sheets, Docs, Drive (`drive.file`), et chez
  Microsoft **tout**, courrier Outlook compris — Microsoft n'exige ni vérification ni accord d'administrateur pour
  les autorisations déléguées qu'on demande.
- **Payant, donc remis à plus tard** : le courrier **Gmail**. Ses portées sont « restreintes » chez Google :
  vérification complète ET évaluation de sécurité annuelle par un évaluateur agréé, à la charge de l'éditeur.
  On le fera quand il y aura des clients pour le payer.

### ⚠️ Verrou à poser AVANT le premier client extérieur

`RELAIS_GMAIL` est **ouvert** sur le relais en production (vérifié le 20/11/2026 : `googlecourrier` figure dans
`/v0/oauth/fournisseurs`). Tant que l'éditeur est seul utilisateur, cela ne gêne personne. Dès qu'un client
extérieur arrive, il verrait le bouton Gmail et tomberait sur une application non vérifiée pour ces portées.

**Il n'a pas été fermé tout de suite** parce que l'éditeur s'en sert : le renouvellement des jetons passe par le
relais, et un fournisseur fermé répond `fournisseur_indisponible` (`src/serveur/oauth.ts`, `rafraichir`). Fermer
Gmail coupe la connexion Gmail existante dans l'heure.

À faire le moment venu : basculer son propre courrier sur Outlook, puis `regler.sh` → 3 → `google` → répondre
**non** à Gmail.

## La porte : fait

La façade signe un jeton d'une minute (quelle entreprise, quelle personne, quel rôle), l'instance le vérifie avec
la seule clé **publique**. Aucun secret partagé, aucun aller-retour vers la façade au moment d'entrer : une panne de
Breizhcosystem n'empêche personne d'entrer chez lui.

Le jeton voyage dans le **fragment** (`…/porte#<jeton>`), comme le code d'installation : un fragment ne va jamais au
serveur dans l'adresse, ni dans les journaux du proxy, ni dans le `Referer` de la page suivante.

C'est un **mode** : sans `LB_FACADE_CLE` et `LB_FACADE_ENTREPRISE` posés au démarrage, la porte répond 404 comme un
chemin inconnu. Une installation auto-hébergée ne dépend de personne pour que quelqu'un entre.

Quatre refus : une autre entreprise, une signature étrangère, un lien périmé, un lien rejoué. Tous rendent la même
phrase — un refus ne doit pas apprendre à en fabriquer un bon.

Un essai croisé met les deux dépôts face à face (`porte-croisee.test.ts` côté réseau) : il signe avec le vrai code
de la façade et vérifie avec le vrai code du jeu. Sans lui, les deux moitiés pourraient s'éloigner en passant
chacune ses propres essais.

## Ce que la porte a appris, et que l'aiguillage devra régler

1. **Une instance doit être INSTALLÉE avant que la porte s'ouvre.** Sans installation, le jeu n'a aucun profil
   d'accès et la porte refuse. Créer l'instance ne suffit donc pas : il faut l'installer au moment où on la crée,
   avec le nom de l'entreprise venu de la façade.
2. **Une instance fraîche n'a qu'un profil : le propriétaire.** Un collaborateur invité sur la façade n'a nulle part
   où entrer, et la porte le refuse plutôt que de lui donner le profil qui administre tout. À décider : profil créé
   d'office à l'invitation, ou invitation faite par l'entreprise dans le jeu. **Rien ne doit créer un accès tout
   seul sans que ce soit un choix écrit.**

## Ce qui reste à construire

1. **L'aiguillage** — inscription → instance créée, installée, démarrée, servie ; puis arrêt, sauvegarde,
   effacement au départ. Le registre et les règles existent (`serveur/instances.ts`, table `instances`) ; **le
   pilote qui fait naître un processus ou un conteneur n'est pas écrit**, et rien n'a encore fait tourner une
   instance pour de vrai.
2. **L'adresse publique d'une instance** : le gabarit (`NEXUS_INSTANCE_URL`) est lu, mais aucun domaine n'est
   servi. À décider : un sous-domaine par entreprise, ou un chemin sur la façade.
3. **Le guide des connexions** pour l'auto-hébergé : créer son application Google et Microsoft, portée par portée.
