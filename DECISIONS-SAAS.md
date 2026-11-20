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

## Comment une instance est servie : un sous-domaine

**Un sous-domaine par entreprise** (`kerlann.exemple.fr`), pas un chemin sur la façade.

La raison n'est pas générique. **Le jeu est construit sur l'idée qu'il possède son origine** : il vérifie
`memeOrigine` sur tout ce qui écrit, refuse les noms d'hôte non déclarés (`LB_HOTES`), pose son cookie sur son
hôte, et garde des choses dans le `localStorage` du navigateur. Avec un chemin, toutes les entreprises partagent
une origine : le `localStorage` devient commun, les cookies aussi, et `memeOrigine` ne sépare plus personne. Ce
serait remplacer une isolation garantie par construction par une isolation à re-prouver dans chaque vérification —
exactement ce qu'on a refusé en choisissant une instance par client.

Le coût est plus petit qu'il n'y paraît : un enregistrement DNS générique (`*.exemple.fr`) et un certificat
générique que Caddy obtient seul par la méthode DNS-01. Une mise en place, puis plus rien.

### Le piège des sous-domaines, et la parade (faite)

N'importe quel sous-domaine peut poser un cookie pour le domaine parent, et ce cookie est ensuite envoyé à tous ses
voisins ET à la façade. Une faille dans l'interface d'UNE entreprise suffirait donc à poser chez ses voisines un
cookie de session qui masque le vrai.

Les deux cookies portent maintenant le préfixe **`__Host-`** en HTTPS (`__Host-lb_session`, `__Host-nx_session`) :
le navigateur n'accepte un cookie qui le porte que de l'hôte lui-même, en `Secure`, `Path=/` et **sans** `Domain`.
Un voisin ne peut pas en poser un. L'ancien nom reste relu le temps que les sessions ouvertes s'éteignent — une
mise à jour ne déconnecte personne — et la déconnexion efface les deux.

En clair (développement local), le navigateur refuse le préfixe : l'ancien nom est gardé.

### Même domaine ou domaine séparé : les deux marchent, et ça ne change que le gabarit

Un **domaine séparé** pour les instances (`*.livingbusiness.fr`) supprime toute parenté de cookies entre les
clients et la façade : le navigateur les traite comme des sites étrangers. C'est le plus propre, et ça coûte un nom
de domaine. Le code ne voit pas la différence : seul `NEXUS_INSTANCE_URL` change
(`https://{org}.exemple.fr` ou `https://{org}.livingbusiness.fr`). La protection `__Host-` vaut dans les deux cas.

### À poser le jour de l'hébergement

- DNS : un enregistrement générique `*.<domaine des instances>` vers le serveur.
- Caddy : certificat générique par DNS-01 (il faut une clé d'API chez le fournisseur DNS).
- Chaque instance démarre avec `LB_HOTES=<son sous-domaine>` et `LB_ORIGINE=https://<son sous-domaine>` : une
  instance refuse déjà de répondre à un nom d'hôte qu'on ne lui a pas déclaré.
- La façade démarre avec `NEXUS_INSTANCE_URL` et `NEXUS_PORTE_CLE`.

## Ça tourne : la chaîne entière est vérifiée

Un essai (`pilote-processus.test.ts`, côté réseau) fait tout, sans rien simuler : une entreprise inscrite dans la
base de la façade, une instance **créée** par le pilote (un vrai processus), **installée** par la façade, un jeton
signé, **une personne qui entre** et lit le monde de SON entreprise — et le même jeton qui ne rouvre pas.

### Le pilote (`serveur/pilote-processus.ts`)

Un **processus par entreprise** : son dossier, son port, sur la boucle locale. Le proxy HTTPS est devant, et lui
seul. Chaque instance démarre avec sa clé de porte, son identifiant d'entreprise et son nom d'hôte déclaré — une
instance refuse déjà les hôtes qu'on ne lui a pas donnés.

Après un redémarrage de la façade, le pilote relit la fiche de chaque dossier (pid, port) et **reprend la main** au
lieu de laisser des processus que personne ne saurait arrêter.

**Ce qu'il ne fait pas, et qu'il faudra :** aucune limite de mémoire ni de processeur par instance. Une entreprise
qui s'emballe gêne ses voisines. C'est le premier manque à combler avant d'héberger pour de vrai — et c'est ce
qu'un conteneur apporterait sans rien coder.

### L'installation à la création

Créer ne suffit pas : sans installation, le jeu n'a aucun profil et la porte refuse tout le monde. La façade
installe donc l'instance dans la foulée, avec le nom de l'entreprise qu'elle connaît déjà.

Le compte local créé à ce moment a un **mot de passe aléatoire que personne ne connaît**, pas même l'éditeur : il
n'est ni enregistré ni renvoyé. Sur une instance hébergée, on entre par la porte ; une seconde serrure sans
serrurier ne protégerait personne. Si la façade tombe durablement, l'éditeur reprend la main sur le serveur avec le
code de secours du jeu, sur place.

### La console de l'éditeur

Elle montre l'état de chaque instance et sait **redémarrer** celle qui est en panne. Pas de bouton « arrêter » :
couper l'instance d'une entreprise qui travaille, depuis une console, c'est une panne qu'elle ne comprendra pas.
L'arrêt est une règle (l'inactivité d'un compte gratuit), pas un geste.

## Ce qui reste à construire

1. **Les limites par instance** (mémoire, processeur) : sans elles, une entreprise qui s'emballe gêne les autres.
2. **Le proxy** : Caddy devant, un sous-domaine par entreprise, et l'aiguillage qui lui dit où envoyer chacun.
3. **Les sauvegardes par instance**, et leur restauration essayée pour de vrai.
4. **L'abonnement branché sur la marche** : un paiement confirmé passe l'instance en continu, un impayé la repasse
   à la demande (`reglerMarche` existe, le webhook Stripe ne l'appelle pas encore).
2. **L'adresse publique d'une instance** : le gabarit (`NEXUS_INSTANCE_URL`) est lu, mais aucun domaine n'est
   servi. À décider : un sous-domaine par entreprise, ou un chemin sur la façade.
3. **Le guide des connexions** pour l'auto-hébergé : créer son application Google et Microsoft, portée par portée.
