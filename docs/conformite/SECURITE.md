# Sécurité organisationnelle et procédure d'incident

Complète `SECURITY.md` (mesures techniques du code). Ici : ce que doivent **faire** l'éditeur et l'entreprise.

## 1. Chaîne de publication (éditeur)

Le script d'installation s'exécute en root chez chaque entreprise : c'est l'actif le plus sensible de l'éditeur.

- **Clé de signature** : générée et gardée sur le poste de l'éditeur, de préférence sur une **clé matérielle FIDO2**
  (`ssh-keygen -t ed25519-sk -O resident -O verify-required -f ~/.ssh/living-business-signature`), avec une seconde
  clé matérielle de secours rangée à part. Jamais sur Breizhcosystem, jamais dans la CI, jamais dans un dépôt. Clé publique dans
  `deploiement/signataires-editeur`, publiée aussi sur un second canal.
- **Publier une version** :
  1. `npm version patch` (ou `minor`) sur une copie de travail propre : commit et étiquette `vX.Y.Z` ; pousser
     l'étiquette → la CI construit les paquets **depuis ce commit** (sources exportées, dépendances réinstallées
     depuis le verrou), `SHA256SUMS.txt` et `PROVENANCE.txt` (version GitHub). Une fabrication sur le poste
     (`npm run paquets`) suit les mêmes règles et refuse une copie modifiée ou un commit non étiqueté ; les essais
     (`--essai`) vont dans `dist/essai/` et ne peuvent pas être signés ;
  2. sur le poste de l'éditeur : `gh release download vX.Y.Z -D /tmp/lb-vX.Y.Z`, et `git checkout vX.Y.Z` sur une
     copie de travail propre (c'est son `installer-jeu.sh` qui sera signé) ;
  3. `node scripts/signer-publication.ts --nexus https://<Breizhcosystem> --cle ~/.ssh/living-business-signature --paquets /tmp/lb-vX.Y.Z`
     (contrôle la provenance : même commit étiqueté, paquets de publication ; revérifie les empreintes, signe
     l'installateur et `SHA256SUMS.txt`, revérifie comme un serveur) ;
  4. déposer le dossier `publication/X.Y.Z/dist` sur Breizhcosystem (outil de l'éditeur, hors de ce dépôt), puis commiter
     `deploiement/publications-signees.txt` (un numéro = un seul paquet : le script refuse un autre paquet sous un
     numéro déjà publié, ou un numéro plus ancien ; corriger = `npm version patch`) ;
  5. contrôle : `curl -fsSL https://<Breizhcosystem>/installer-jeu.sh` puis la commande de vérification du README ;
  6. garder `PROVENANCE.txt`, `SHA256SUMS.txt` et sa signature et la version GitHub de chaque version publiée : avec
     `app/SBOM.cdx.json` de chaque paquet, ils disent quelles versions sont touchées par une faille d'un composant
     ([DIVULGATION-COORDONNEE.md](DIVULGATION-COORDONNEE.md) § 3 et § 5).
- **Node.js embarqué** : `scripts/paquets.ts` refuse un Node.js dont `SHASUMS256.txt` n'est pas signé par un publieur
  de Node.js épinglé dans `scripts/node-cles-publication.asc`. Fabrication refusée avec « signataire inconnu » :
  comparer la liste « Release keys » du README de nodejs/node et de nodejs/release-keys (deux sources), ajouter la
  clé publique du nouveau publieur, relancer `npm test`. Ne jamais ajouter une clé reçue par un autre canal.
- **Veille Node.js** : le Node.js embarqué dans les paquets (`scripts/paquets.ts`) suit la branche LTS ; à chaque
  version de maintenance de sécurité de Node LTS (annonces nodejs.org/en/blog, rubrique « Vulnerabilities »), publier
  une version du jeu avec le Node corrigé. Les serveurs qui ont accepté les mises à jour automatiques la prennent dans
  la nuit ; les autres administrateurs voient le bandeau « Correctif de sécurité » si Breizhcosystem le signale (champ
  `gravite` de `/v0/telechargements`).
- **Dépendances npm** : aucune nouvelle version adoptée avant **7 jours** (14 pour une version majeure), qu'elle vienne
  de Dependabot (`cooldown`, vérifié par `scripts/chaine-ci.test.ts`) ou d'une mise à jour faite à la main
  (`npm view <paquet> time --json` donne la date de publication). Aucun script d'installation ne s'exécute
  (`.npmrc` : `ignore-scripts=true`) : une dépendance qui en demande un s'examine avant d'être adoptée.
- **Caddy des serveurs des entreprises** : pris dans le dépôt officiel du projet, dont la clé est inscrite dans
  `installer-jeu.sh` (empreinte `65760C51EDEA2017CEA2CA15155B6D79CA56EA34`, bloc « dépôt officiel de Caddy »).
  À chaque version : vérifier que `https://dl.cloudsmith.io/public/caddy/stable/gpg.key` a toujours cette empreinte
  (le workflow `installation-en-ligne` échoue si le dépôt ne s'installe plus). Si le projet Caddy change de clé :
  vérifier la nouvelle par une seconde source (annonce du projet Caddy, serveur de clés public), remplacer la clé et
  l'empreinte dans le script et dans `scripts/installateur.test.ts`, publier une version.
- **Paquets de bureau (Mac, Windows)** : pas encore signés par Apple ni Microsoft (décision de
  l'éditeur). L'éditeur ne les diffuse que par la page « Télécharger » de Breizhcosystem : jamais en pièce jointe, jamais
  par un lien de stockage partagé, jamais sur un autre site (la licence libre permet à d'autres de les redistribuer :
  seule cette page garantit qu'un paquet vient de l'éditeur).
  `LISEZMOI.txt` et Réglages › À propos le rappellent à
  l'entreprise et ne décrivent le passage de Gatekeeper ou SmartScreen que pour un paquet venu de cette page.
- **Chaîne de fabrication (GitHub Actions)** : actions épinglées par empreinte de commit (`scripts/chaine-ci.test.ts`
  refuse une étiquette mobile). Avant de fusionner une mise à jour proposée par Dependabot, vérifier que l'empreinte
  correspond bien à l'étiquette annoncée (`git ls-remote https://github.com/<action> refs/tags/<version>`) et lire
  le journal des changements de l'action. La fabrication des paquets n'a que le droit de lecture ; seul le job
  « publier » écrit, sans lancer le code du dépôt.
- **Changer de clé** (avant expiration ou départ d'une clé) : ajouter la nouvelle ligne, publier une version signée
  par l'**ancienne** clé (les serveurs enregistrent la nouvelle), puis retirer l'ancienne à la version suivante.
- **Accès au serveur Breizhcosystem** : clé SSH personnelle, la publication (`sudo rsync`) ne suffit plus à piéger les
  entreprises (la signature est vérifiée), mais un accès root à Breizhcosystem reste un incident (relais de connexion, Breizhcosystem).

## 2. Installation chez l'entreprise

- Un administrateur nommé, la validation en deux étapes activée (obligatoire en ligne), le code de secours rangé hors
  de l'ordinateur.
- Profils au plus juste (types de fiches, lieux, départements) ; « Voir comme » pour vérifier ; clés d'API limitées à
  un profil restreint, révoquées dès qu'elles ne servent plus. Une clé ne peut ni acheter sur Breizhcosystem, ni créer de clé,
  ni changer les accès ou la liaison Breizhcosystem (refusé par le serveur) : la révoquer coupe l'agent ou le scénario pour de
  bon. Le droit RH « Voir et saisir les motifs d'absence » n'est donné qu'aux personnes qui en ont besoin.
- Mises à jour : `sudo living-business-mise-a-jour` (signature vérifiée ; une version plus ancienne est refusée),
  chaque nuit si la minuterie a été acceptée à l'installation (`sudo living-business-mise-a-jour-auto oui|non`) ; mises
  à jour de sécurité du système automatiques (installateur). Dans le jeu : Réglages › À propos › Mises à jour. Sur un
  poste (Mac, Windows) : télécharger la nouvelle version seulement par le lien de cette page (page « Télécharger » de
  Breizhcosystem), jamais depuis un e-mail, une pièce jointe ou un autre site.
- SSH : connexion par clé seulement dès qu'une clé est installée ; le script le refait et le contrôle (`sshd -T`) à
  chaque passage. Message « Attention : SSH accepte ENCORE les mots de passe » : corriger le fichier nommé, relancer.
- Export complet des données : depuis l'écran seulement (jamais avec une clé d'API), mot de passe et code redemandés,
  sans la clé des accès aux logiciels connectés par défaut. Chaque export est au journal et signalé aux autres
  administrateurs : un avis « Copie complète des données exportée » inattendu se traite comme un incident (3.4).
- Sauvegardes : tester une restauration au moins une fois par an ; garder la phrase de chiffrement de la copie hors
  serveur dans un gestionnaire de mots de passe.
- Copie hors serveur et rançongiciel : les identifiants S3 et la phrase sont forcément sur le serveur (il chiffre et
  envoie chaque nuit) ; un attaquant devenu root les lit. Ce qui sauve les copies, c'est le **stockage** :
  1. chez l'hébergeur S3 (OVH Object Storage, Scaleway…), créer le conteneur avec le **versionnage** et le
     **verrouillage des objets** (Object Lock, mode conformité, rétention par défaut de 31 jours) ;
  2. ajouter une **règle de cycle de vie** : versions courantes expirées après 31 jours, versions anciennes supprimées
     1 jour après (c'est elle qui fait la purge de 31 jours, voir [DUREES-CONSERVATION.md](DUREES-CONSERVATION.md)) ;
  3. créer une clé d'accès **sans droit d'effacement** (lecture, écriture, liste seulement) ;
  4. répondre « o » à « Conteneur versionné et verrouillé » à l'installation, ou plus tard :
     `sudo touch /etc/living-business/copie-verrouillee && sudo living-business-mise-a-jour` (le serveur n'efface
     alors plus rien lui-même).
  Sans ce verrouillage, l'installateur prévient qu'un attaquant maître du serveur peut effacer les copies.
- Caddy : son API d'administration est coupée (`admin off`) ; après une modification à la main de
  `/etc/caddy/Caddyfile`, `sudo systemctl restart caddy` (`reload` ne marche plus, c'est voulu). Il vient du dépôt
  officiel du projet et se met à jour avec les mises à jour de sécurité automatiques ; contrôle :
  `apt-cache policy caddy` (version installée marquée `***`, venue de `dl.cloudsmith.io`). Message « Caddy … paquet
  d'Ubuntu … reste en service » à une mise à jour : le dépôt officiel n'a pas répondu, relancer
  `sudo living-business-mise-a-jour` plus tard. Ne jamais réinstaller le paquet `caddy` d'Ubuntu (il est écarté).
- Clé des secrets (jeu en ligne) : rangée hors du dossier des données, dans `/etc/living-business/cle-secrets.cred`,
  chiffrée par la clé propre au serveur (`/var/lib/systemd/credential.secret`) ; elle ne se lit que sur ce serveur.
  Changer de serveur : « Exporter » avec les accès depuis l'écran, puis restaurer sur le nouveau ; sinon les logiciels
  connectés sont à reconnecter (les données restent). Ne jamais copier ces deux fichiers avec les sauvegardes.
- Départ d'une personne : désactiver son compte le jour même, révoquer ses clés d'API, retirer sa clé SSH du serveur.

## 3. Procédure d'incident de sécurité

| Gravité | Exemples | Délai pour agir |
|---|---|---|
| Critique | clé de signature perdue ou volée ; Breizhcosystem compromis (root, exécution de code) ; installateur ou paquet modifié servi | immédiat |
| Haute | faille permettant de lire les données d'une installation ; relais de connexion détourné ; faux paquet ou faux site « Living Business » diffusé | 24 h |
| Moyenne | faille demandant un accès administrateur ; fuite d'un secret de test | 7 jours |

### 3.1 Clé de signature perdue ou volée (éditeur)

1. Retirer immédiatement les publications du dossier de téléchargements de Breizhcosystem (plus de mise à jour possible :
   c'est voulu).
2. Générer une nouvelle clé (clé de secours, ou nouvelle clé matérielle).
3. Si l'**ancienne clé est perdue mais pas compromise** : publier une version signée par la clé de secours si elle
   figure déjà dans `signataires-editeur` ; sinon, les serveurs devront enregistrer la nouvelle clé à la main
   (`/etc/living-business/signataires`, après vérification par un second canal).
4. Si l'**ancienne clé est compromise** : prévenir **toutes** les entreprises (e-mail, page de Breizhcosystem, second canal) de ne
   lancer aucune mise à jour, de comparer `/etc/living-business/signataires` à la nouvelle clé publiée sur le second
   canal, et de vérifier qu'aucune mise à jour n'a été lancée depuis la date suspecte ; leur fournir la procédure
   [VIOLATION-DONNEES.md](VIOLATION-DONNEES.md).

### 3.2 Breizhcosystem compromis (éditeur)

1. Couper Breizhcosystem (ou au moins `/installer-jeu.sh`, `/telechargements/`, le relais `/v0/oauth/*`).
2. Les serveurs des entreprises refusent tout script non signé : vérifier qu'aucune publication signée n'a été
   remplacée (comparer les empreintes à `SHA256SUMS.txt` de la version GitHub).
3. Relais de connexion : faire révoquer par les fournisseurs (Google, Microsoft, HubSpot…) les jetons de l'application
   de l'éditeur ; prévenir les entreprises de se reconnecter (« Se reconnecter »).
4. Les entreprises reliées : révoquer et recréer la clé d'organisation Breizhcosystem (délier puis relier).
5. Notification CNIL de l'éditeur pour les données de Breizhcosystem (procédure côté Breizhcosystem) ; information des entreprises
   concernées sans délai.

### 3.3 Faille signalée dans le jeu

Politique complète, délais proposés et notification au titre du CRA :
[DIVULGATION-COORDONNEE.md](DIVULGATION-COORDONNEE.md). Canal : celui de `SECURITY.md` (provisoirement l'adresse de
contact des « Mentions légales » de Breizhcosystem, objet « Sécurité »).

1. Accuser réception sous 72 h (délai proposé) ; ne rien publier avant le
   correctif. Si la faille est **activement exploitée** : alerte précoce sous 24 h sur la plateforme unique de
   signalement de l'ENISA (article 14 du CRA, applicable depuis le 11/09/2026), notification sous 72 h, rapport
   final sous 14 jours après le correctif ([DIVULGATION-COORDONNEE.md](DIVULGATION-COORDONNEE.md) § 4).
2. Corriger avec un test de non-régression, publier une version signée **sous un nouveau numéro** (jamais un paquet
   republié sous le même numéro : le registre des publications le refuse).
3. Signaler la version comme correctif de sécurité sur Breizhcosystem (champ `gravite: "securite"` de `/v0/telechargements`) :
   les jeux affichent l'alerte aux administrateurs, les serveurs à mise à jour automatique la prennent dans la nuit.
   Prévenir aussi par la page de téléchargement ; publier l'avis une fois les installations mises à jour (ou après
   90 jours).

### 3.4 Incident chez l'entreprise

Clé d'API divulguée ou agent IA qui se comporte mal : révoquer la clé (Réglages › Connecteurs › Clés d'API), puis lire
le journal (`GET /api/v1/journal` depuis une session d'administrateur, 200 lignes par page, `?page=2` pour les
précédentes) et le journal de sécurité (`GET /api/v1/journal?genre=securite` : exports, restaurations, clés, accès,
comptes, liaison au réseau, effacements, gardés 12 mois à part, que l'activité courante ne chasse pas ; une clé écrit
au plus 600 fois par 10 minutes). Chaque action faite avec une clé porte le champ
`canal` (`cle:<id> « nom »`), création et révocation de clé y sont aussi (`cle.creee`, `cle.revoquee`), ce qui permet
de dresser la liste de ce que la clé a modifié (les lectures ne sont pas journalisées : tout ce que voit le profil de
la clé est à considérer comme lu). Aucune clé n'a pu en créer une autre, ni approuver une action : les demandes
qu'elle a préparées (modifications de fiche, tâches, mouvements de stock) attendent dans Aujourd'hui, marquées
« Demandée par la clé d'API « nom » » ; ne pas les approuver, elles restent sans effet. Restent à vérifier dans le
journal les écritures directes qu'une clé peut faire : fiches créées (`objet.cree`), planning (`planning.affecte`),
courrier (`courrier.statut`), liens de formulaire.

Breizhcosystem suspend l'entreprise (contrôle, impayé) : le jeu le dit (Réglages › Breizhcosystem, pavillon de la carte) et **garde la
liaison** ; ne pas relier de nouveau, tout reprend à la levée. Si le jeu annonce une liaison **révoquée**, la clé a
été retirée côté Breizhcosystem : vérifier auprès de l'éditeur avant de relier.

Secret d'entrée d'un webhook (Make, Zapier, n8n) divulgué, ou adresse du webhook sortant divulguée : débrancher le
connecteur (Réglages › Connecteurs › Débrancher) puis le rebrancher, ce qui donne un nouveau secret et une nouvelle clé
de vérification des envois ; dans Make ou Zapier, régénérer l'adresse du webhook. Une requête signée captée ne peut
pas être rejouée au-delà de 5 minutes, ni deux fois ; une requête au porteur (`Authorization: Bearer`) peut l'être tant
que le secret n'est pas changé. Fiches reçues par ce connecteur : voir le journal du connecteur (Réglages › Connecteurs).

Serveur pris par un rançongiciel (données chiffrées ou effacées) : ne pas payer ; couper le serveur du réseau ;
en louer un neuf, `installer-jeu.sh`, puis restaurer la dernière copie hors serveur (phrase de chiffrement du
gestionnaire de mots de passe). Reprendre avec elle le dernier **registre des effacements**
(`registre-effacements.jsonl`, rangé avec les sauvegardes et recopié chaque jour hors du serveur) : remis dans le
dossier des sauvegardes du serveur neuf, il est rejoué tout seul ; avec une copie exportée (`.lbsauv`), le joindre
dans l'écran de restauration. Sans lui, les fiches effacées depuis la copie reviendraient. Les identifiants S3 et la phrase étaient sur le serveur : créer une nouvelle clé S3
et révoquer l'ancienne ; avec un stockage verrouillé (Object Lock), les copies des 31 derniers jours sont intactes,
sinon vérifier ce qui reste. Changer les mots de passe et révoquer les accès aux logiciels connectés (les jetons
étaient lisibles sur le serveur). Violation de données : [VIOLATION-DONNEES.md](VIOLATION-DONNEES.md).

Serveur perdu ou disque copié : la clé des secrets n'est lisible que sur le serveur (identifiant chiffré par la clé du
serveur) ; une copie du dossier des données ou des sauvegardes ne livre pas les jetons des logiciels connectés. Disque
entier copié (avec `/var/lib/systemd/credential.secret`) : révoquer les accès chez chaque outil et reconnecter.

Débrancher un logiciel connecté (Réglages › Connecteurs › Débrancher) : ce qui est coupé, outil par outil.

| Outil relié par « Se connecter avec… » | Ce que fait « Débrancher » |
|---|---|
| Google | Accès révoqué chez l'outil par Living Business lui-même. |
| Shopify | L'application se désinstalle de la boutique. |
| Pipedrive, Notion, HubSpot | Accès révoqué chez l'outil par le relais de Breizhcosystem (il faut le secret de l'application, que seul le relais détient). HubSpot : si le relais n'a pas pu le faire, Living Business le révoque lui-même par l'ancienne adresse de HubSpot, jusqu'à son arrêt le 16 février 2027. |
| Microsoft (Excel 365, Dynamics 365, Business Central), Airtable, Sellsy | Pas de révocation possible d'ici : retirer l'application dans le compte de l'outil. Le relais cesse de renouveler la connexion : le jeton d'accès s'éteint seul (une heure environ), une copie du jeton de renouvellement ne sert plus. |
| WooCommerce, clé collée (mode avancé) | Supprimer la clé dans l'outil : elle n'expire pas. |

Dans tous les cas, le relais ne renouvelle plus la connexion débranchée. Si un autre branchement utilise encore le même
outil, l'accès chez l'outil est gardé (le retirer couperait aussi l'autre) : Living Business le dit.

Procédure [VIOLATION-DONNEES.md](VIOLATION-DONNEES.md). L'éditeur n'a pas accès aux installations : il aide par
téléphone ou par écrit, sans jamais demander de mot de passe, de code ni de copie des données.

### 3.5 Faux paquet ou faux site en circulation (éditeur et entreprise)

Un faux site (nom proche, publicité) ou un e-mail « nouvelle version de Living Business » diffuse un paquet piégé ;
les paquets de bureau n'étant pas encore signés, macOS et Windows ne font pas la différence.

1. **Éditeur** : prévenir les entreprises par la page de téléchargement de Breizhcosystem et le canal du bulletin de sécurité ;
   rappeler que seule la page « Télécharger » de Breizhcosystem fait foi et que les
   empreintes à comparer sont celles de `SHA256SUMS.txt` signé par l'éditeur. Demander le retrait du faux site à son
   hébergeur et à son bureau d'enregistrement, signaler l'e-mail (signal-spam.fr) et le site (internet-signalement.gouv.fr).
   Inscrire l'incident au registre (section 4).
2. **Entreprise qui a ouvert le faux paquet** : considérer l'ordinateur comme compromis. Le débrancher du réseau ; depuis
   un autre appareil, changer les mots de passe de Living Business et révoquer les accès aux logiciels connectés et les
   clés d'API ; réinstaller le système (ou faire nettoyer l'ordinateur par un professionnel), puis installer Living
   Business depuis la page de Breizhcosystem et restaurer une copie chiffrée exportée **avant** l'ouverture (Réglages ›
   Sauvegardes ; les copies automatiques de l'ordinateur touché ne sont plus sûres). Le programme piégé a pu
   lire le dossier des données (fiches, planning, clients) : appliquer [VIOLATION-DONNEES.md](VIOLATION-DONNEES.md).

## 4. Registre des incidents

Tenu par l'éditeur (et par l'entreprise pour son installation) : date, découverte, description, gravité, actions,
personnes prévenues, clôture. Revue au moins une fois par an.
