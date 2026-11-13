# Living Business par Breizhcosystem

Monde privé et vivant de l'entreprise. **Logiciel libre (GNU AGPL version 3), gratuit, auto-hébergeable, utilisable sans le réseau.**
Édité par **Breizhcosystem**. Le réseau Breizhcosystem (payant, facultatif) est un service distinct : son code n'est pas dans ce dépôt, et le jeu fonctionne sans lui.
Les noms techniques (`breizh-eco-jeu`, `bzh.breizh-eco.living-business`, préfixe `lb-`) viennent d'un ancien nom du projet ; ils restent inchangés, car ils servent aux installations existantes.

> Le dirigeant voit son activité, comprend ce qui demande son attention, consulte les preuves et agit sous contrôle.
> Le jeu ne remplace ni CRM, ni ERP, ni comptabilité. Il n'invente jamais une donnée.

## Logiciel libre

Living Business est un logiciel libre, distribué sous la **licence publique générale GNU Affero, version 3** (GNU AGPL v3, identifiant `AGPL-3.0-only`).

- **Texte de la licence** : [LICENSE](LICENSE) (en anglais, seul à faire foi). Résumé en français, sans valeur juridique : [NOTICE.md](NOTICE.md).
- **Ce que vous pouvez faire** : utiliser le jeu pour tout usage, l'étudier, le modifier et le redistribuer, modifié ou non. Rien à accepter pour l'utiliser.
- **Ce que la licence demande** : si vous le redistribuez, ou si vous ouvrez une version modifiée à d'autres personnes par un réseau (un site, un serveur), vous leur donnez accès au code source de votre version, sous la même licence, sans ajouter de restriction.
- **Aucune garantie**, dans les limites de la loi (articles 15 à 17 de la licence).
- **Marques** : les noms « Breizhcosystem » et « Living Business » et le symbole « Moucheture » restent des marques de l'éditeur. La licence ne donne aucun droit sur elles (terme additionnel permis par son article 7 : voir [NOTICE.md](NOTICE.md), § 4).
- **Composants tiers** (three.js, polices, icônes, modèles 3D, Node.js joint aux paquets) : chacun garde sa propre licence, voir [LICENCES-TIERS.md](LICENCES-TIERS.md).

Copyright (C) 2026 Breizhcosystem. Sauf mention contraire (composants tiers), tout ce dépôt est publié sous cette licence : code, essais, textes, documentation, illustrations.

**Le code source dans le jeu.** Toute personne qui utilise le jeu y trouve le lien « Code source (AGPL v3) » : au pied des écrans d'entrée, dans l'Aide, dans Réglages › À propos et sur la page « Licences et crédits ». Il mène à ce dépôt. Si vous mettez en ligne ou diffusez une version modifiée, mettez-y l'adresse du code source de **votre** version (`CODE_SOURCE` dans `src/passerelle/licence.ts` et dans `web/app.js`, lien de `web/licences.html`, adresse de `NOTICE.md`) : c'est ce que demande l'article 13 de la licence.

### Télécharger

Paquets prêts à l'emploi pour Mac, Windows et Linux (Node.js inclus, rien d'autre à installer) : https://reseau.breizhcosystem.com/telecharger. Seule cette page garantit qu'un paquet vient de l'éditeur ; son intégrité se vérifie avec `SHA256SUMS.txt` et sa signature. Le détail est plus bas : « Installer chez une entreprise ».

### Lancer depuis les sources

Il faut Node.js 22.18 ou plus récent (il exécute TypeScript directement, sans étape de fabrication).

```bash
git clone https://github.com/gaelasao/breizh-eco-jeu.git
cd breizh-eco-jeu
npm ci           # dépendances, depuis le verrou ; aucun script d'installation n'est lancé
npm run demo     # démonstration jetable : entreprise fictive, rien d'enregistré → http://127.0.0.1:4173
npm start        # votre entreprise : au premier lancement, créez-la ; données dans ./donnees/
npm run check    # vérification des types, puis tous les essais
```

Le détail (dossier des données, équipe au bureau, mise en ligne) est plus bas : « Démarrer (développement) ».

### Signaler un problème

- **Un bogue, une idée** : ouvrez un ticket sur https://github.com/gaelasao/breizh-eco-jeu/issues. N'y mettez ni donnée réelle de votre entreprise, ni mot de passe, ni clé.
- **Une faille de sécurité** : pas de ticket public. Suivez [SECURITY.md](SECURITY.md).

### Contribuer

Les contributions sont acceptées **sous la même licence** (GNU AGPL version 3), par demande de fusion (« pull request ») sur ce dépôt. En proposant une modification, vous confirmez que vous avez le droit de la publier sous cette licence. Avant de l'envoyer, lancez `npm run check` : la CI le lance aussi sur chaque demande.

Restent à décider par l'éditeur : un éventuel accord de contribution (certificat d'origine « DCO » ajouté à chaque commit, ou accord de licence « CLA ») et la politique de contributions. Ces décisions relèvent d'un document interne de l'éditeur.

## Principes non négociables

1. **Autonomie** : l'entreprise gère seule utilisateurs, sources, droits, réglages. Accompagnement = option.
2. **Inconnu ≠ 0** : valeur manquante = `null`, affichée comme telle. Source périmée ne rend jamais une situation verte.
3. **Réel ≠ simulation ≠ démo** : modes séparés, étiquetés. La simulation n'écrit jamais dans les outils réels ni dans Breizhcosystem.
4. **Action réelle** = approbation enregistrée + clé d'idempotence. Résultat incertain ⇒ `resultat_inconnu`, on vérifie avant de relancer.
5. **Breizhcosystem facultatif** : le pavillon affiche les droits confirmés par le serveur Breizhcosystem. Le jeu ne décide jamais d'un droit payant.
6. **Secrets côté passerelle privée uniquement** : jamais dans le navigateur, les journaux, ni un prompt d'IA.

## Une installation = une entreprise, qui se gère seule

Le jeu tourne **chez l'entreprise** (son ordinateur ou son serveur). L'éditeur n'a **aucun accès à ses données** : pas de compte
chez nous, pas de télémétrie, aucune donnée de l'entreprise envoyée (canal de l'éditeur vers le jeu : les mises à jour, lancées par l'entreprise ou chaque nuit si elle l'accepte, signées hors ligne par l'éditeur ; sur un serveur, leur code s'exécute en root : l'éditeur maîtrise donc le code qui tourne, pas les données). Ce qui peut joindre le serveur de l'éditeur, et seulement sur un geste de l'entreprise : la couche **Breizhcosystem** (optionnelle, payante), uniquement ce que l'entreprise publie ; « **Se connecter avec…** » (sans compte Breizhcosystem), dont le relais voit passer les **jetons de connexion** de l'outil (10 min au plus, en mémoire, puis à chaque renouvellement, jamais les données) ; la lecture de la liste publique des versions (adresse IP seulement). Tout est listé dans Réglages → Confidentialité. Tout le reste s'administre depuis l'écran, sans assistance :

| Besoin | Où | Sans l'éditeur ? |
|---|---|---|
| Créer l'entreprise | 1er lancement, **sur l'ordinateur lui-même** (nom, accès propriétaire, départ vide ou exemple) | oui |
| Ouvrir à l'équipe du bureau | Réglages → **Équipe et réseau** → « Ouvrir à mon équipe » : adresse à donner aux collègues (ex. `http://192.168.1.20:4173`), même réseau, sans Internet | oui |
| Faire tourner en permanence | même page → « Lancer au démarrage de l'ordinateur » (Mac : agent de session ; Windows : dossier Démarrage ; Linux : autostart) ; sur Mac, pas de mise en veille tant que l'équipe est ouverte | oui |
| Inviter l'équipe | Réglages → Accès et visibilité → **Inviter** : lien personnel (7 jours, une fois) à l'adresse du bureau, la personne choisit son mot de passe | oui |
| Régler qui voit quoi | même page : lieux, départements, types d'informations, rôles des tiers ; « Voir comme » en lecture seule | oui |
| Mot de passe oublié (collègue) | un administrateur envoie un **nouveau lien** | oui |
| Mot de passe oublié (propriétaire) | **code de secours** (donné à l'installation, renouvelable dans « Mon compte ») | oui |
| Plus de code de secours | `npm run secours` **sur l'ordinateur** : lien de 15 min, une fois | oui |
| Sauvegarder | automatique chaque jour (`donnees/sauvegardes/`, 30 jours) + **export chiffré par phrase** | oui |
| Changer d'ordinateur | 1er lancement → « Restaurer une sauvegarde » (jetons des outils ré-chiffrés pour la nouvelle machine) | oui |
| Revenir en arrière | Réglages → Sauvegardes → « Revenir à cette copie » (l'état actuel est gardé avant) | oui |
| Protéger son compte | Mon compte → **Validation en deux étapes** (code du téléphone, 8 codes de récupération) ; obligatoire pour les administrateurs d'un jeu en ligne | oui |
| Utiliser le jeu partout | Réglages → **Mettre en ligne** : Tailscale (sans serveur), ou **son propre serveur** à son nom (voir ci-dessous) | oui |
| Application sur le téléphone | « Installer l'application » (Android, ordinateur) ou Partager → « Sur l'écran d'accueil » (iPhone) | oui |

## Installer chez une entreprise : rien à installer

Un paquet par système, avec **Node.js officiel inclus** (vérifié par SHA-256) : l'entreprise n'installe rien.

1. Télécharger `living-business-<version>-<système>.zip` (Mac Apple ou Intel, Windows, Linux) sur https://reseau.breizhcosystem.com/telecharger et le décompresser où elle veut.
2. Double-cliquer sur **Living Business** : le navigateur s'ouvre sur l'écran de création de l'entreprise.
3. Laisser la petite fenêtre de texte ouverte pendant l'utilisation ; la fermer arrête le jeu. Un 2e double-clic rouvre le navigateur (une seule instance).

- Données dans le dossier de l'utilisateur, **hors du dossier du jeu** : `~/Library/Application Support/Living Business` (Mac), `%APPDATA%\Living Business` (Windows), `~/.local/share/living-business` (Linux). Mise à jour = remplacer le dossier du jeu, rien n'est perdu.
- Port 4173 occupé : le suivant libre est pris automatiquement.
- Mot de passe ET code de secours perdus : double-cliquer sur **Secours mot de passe** (ouvre la page de réinitialisation, 15 min).
- Notice pour l'entreprise : `LISEZMOI.txt` dans chaque paquet.
- 1er lancement : macOS (« Ouvrir quand même » dans Confidentialité et sécurité) et Windows (« Exécuter quand même ») préviennent une fois, car les lanceurs ne sont pas signés. `LISEZMOI.txt` ne décrit ce passage que pour un paquet téléchargé sur la page « Télécharger » de Breizhcosystem (ou par le lien de Réglages → À propos, qui y mène), jamais pour un fichier reçu par e-mail ou trouvé ailleurs. Pour supprimer l'avertissement : compte Apple Developer (signature + notarisation) et certificat de signature Windows (décision de l'éditeur).

Publication (faite par l'éditeur, avec sa clé de signature gardée hors ligne) : `node scripts/signer-publication.ts --nexus https://… --cle <clé de signature> --paquets <zips de la CI + SHA256SUMS.txt + PROVENANCE.txt>`, lancé sur le même commit étiqueté, copie de travail propre (c'est son `installer-jeu.sh` qui est signé ; des paquets d'un autre commit ou d'essai sont refusés) → `publication/<version>/` (installateur signé, empreintes signées), que l'éditeur met ensuite en ligne sur Breizhcosystem. **Un numéro de version ne sert qu'une fois** : `deploiement/publications-signees.txt` (à commiter après chaque signature) garde le paquet Linux de chaque numéro, et le script refuse un autre paquet sous un numéro déjà publié ou un numéro plus ancien ; corriger une publication = `npm version patch`, nouveaux paquets, nouvelle signature. Les serveurs installent chaque paquet dans un dossier nommé d'après son contenu (`/opt/living-business/versions/<version>-<empreinte>`). Voir SECURITY.md « Chaîne de publication ».

Fabrication d'une publication : sur le commit étiqueté par `npm version patch` (ou `minor`), copie de travail propre, `npm run paquets` (les 4) ou `node scripts/paquets.ts darwin-arm64` → `dist/` et `dist/PROVENANCE.txt` ; refusé sinon. Les sources sont exportées du commit (`git archive`) hors du dossier de travail et les dépendances réinstallées depuis le verrou (`npm ci --omit=dev --ignore-scripts`) : rien de non commité ni le `node_modules` du poste n'entre dans un paquet. Essai depuis la copie de travail : `node scripts/paquets.ts --essai` → `dist/essai/` (jamais signé pour publication). Adresse de Breizhcosystem préréglée dans les paquets : `node scripts/paquets.ts --nexus https://reseau.example` (ou `LB_NEXUS_URL=https://… npm run paquets` ; https seulement), donnée au jeu à chaque démarrage (`LB_NEXUS_URL` au lancement l'emporte). Sur GitHub : workflow **paquets** (à la main → artefacts ; tag `vX.Y.Z` → version publiée).

## Mettre le jeu en ligne chez soi

Une entreprise peut AUSSI faire tourner le jeu comme un site internet **sur son propre serveur, à son propre nom**
(ex. `https://jeu.monentreprise.fr`) et rester seule maîtresse de ses données : l'éditeur ne voit rien et n'a ni compte
ni accès ; il ne peut faire exécuter sur le serveur que des mises à jour signées par sa clé hors ligne, que vous lancez. Tout est expliqué dans le jeu : **Réglages → Mettre en ligne** (administrateurs, jeu non encore en ligne), avec
trois façons de faire :

1. **Sans serveur — Tailscale** (le plus simple) : Tailscale sur cet ordinateur et sur les téléphones (même compte),
   Réglages → Équipe et réseau → « Ouvrir à mon équipe », puis `http://<nom-de-la-machine>:4173` (ou l'adresse
   `100.x.y.z` de Tailscale) sur le téléphone. L'ordinateur doit rester allumé.
2. **Mon propre serveur** : un petit serveur Linux (Ubuntu 24.04, x86-64 ; OVHcloud, Scaleway, IONOS… ~5–7 €/mois),
   un enregistrement DNS `jeu` → adresse IP du serveur, puis sur le serveur :
   ```bash
   curl -fsSL <Breizhcosystem>/installer-jeu.sh -o installer-jeu.sh && sudo bash installer-jeu.sh jeu.mondomaine.fr
   ```
   (`<Breizhcosystem>` = l'adresse de Breizhcosystem connue du jeu, `LB_NEXUS_URL` ; le script est aussi dans chaque paquet
   téléchargé, `installer-jeu.sh` : ce modèle récupère la publication signée et la vérifie avant de l'exécuter).
   **Vérifier** avant de lancer : la page Réglages → Mettre en ligne donne la commande complète, qui vérifie la
   signature avec la clé de l'éditeur connue du jeu (`deploiement/signataires-editeur`) :
   ```bash
   tail -n 1 installer-jeu.sh | sed 's/^# signature-living-business: //' | base64 -d > installer-jeu.sh.sig
   sed '$d' installer-jeu.sh | ssh-keygen -Y verify -f signataires-editeur -I editeur-living-business -n living-business-installateur -s installer-jeu.sh.sig
   ```
   Il installe Caddy (HTTPS automatique), le pare-feu, le service système isolé et
   la sauvegarde quotidienne. SSH passe en connexion par clé seulement dès qu'une clé est installée (réglage
   `/etc/ssh/sshd_config.d/00-living-business.conf`, lu avant celui de cloud-init, refait à chaque passage et contrôlé
   avec `sshd -T` : sans clé, ajoutez-la avec `ssh-copy-id` puis relancez). Il affiche ensuite le lien **à usage unique** `https://jeu.mondomaine.fr/installation#<code>` :
   on y crée le compte administrateur, ou on **restaure la sauvegarde** exportée depuis l'ordinateur (bouton
   « Exporter mes données pour le serveur » de la même page). Mise à jour : `sudo living-business-mise-a-jour`, qui vérifie
   la signature de l'éditeur avec la clé enregistrée sur le serveur avant toute exécution (version plus ancienne refusée).
   **Mises à jour automatiques** proposées à l'installation (recommandé ; oui sans terminal, `LB_MAJ_AUTO=0` pour
   refuser) : la même commande chaque nuit (minuterie `living-business-mise-a-jour.timer`), le service ne redémarrant
   que si la version a changé ; `sudo living-business-mise-a-jour-auto oui|non` pour changer d'avis. Dans le jeu,
   Réglages › À propos › **Mises à jour** lit la liste publique des versions sur Breizhcosystem (rien n'est envoyé) et un
   bandeau prévient les administrateurs d'une nouvelle version ou d'un correctif de sécurité (lecture quotidienne
   par défaut en ligne, à la demande sur un poste).
3. **Faire installer par Claude** : un texte prêt à copier (nom de domaine et entreprise pré-remplis) à coller dans
   Claude Code ou Claude avec accès au terminal, qui fait l'étape 2 sur LE serveur de l'entreprise uniquement (accès
   SSH donné par la personne, jamais de mot de passe ni de clé dans la conversation, aucune donnée envoyée ailleurs,
   SSH par clé seulement, lien d'installation montré à la fin).

Une suggestion « Utiliser Living Business partout ? » apparaît une fois dans « Aujourd'hui » quand l'entreprise est en place
(refermable, retenue sur le serveur et dans le navigateur).

**Contrat avec l'installateur du serveur** (`deploiement/installer-jeu.sh`, service systemd) :

| Variable | Valeur | Effet dans le jeu |
|---|---|---|
| `LB_EN_LIGNE=1` | | mode en ligne : installation à distance par code, secours à distance, validation en deux étapes obligatoire pour les administrateurs, pas de mode équipe |
| `LB_PROXY=1` | | derrière Caddy sur la même machine : l'adresse du client (limites d'essais) est la **dernière** valeur de `X-Forwarded-For` |
| `LB_ORIGINE` | `https://<domaine>` | adresse des liens (invitations, formulaires, secours) |
| `LB_HOTES` | `<domaine>` | nom d'hôte accepté (anti DNS rebinding) |
| `LB_COOKIE_SECURE=1` | | cookie de session `Secure` |
| `LB_DONNEES` | `/var/lib/living-business` | données ; `installation.txt` (code d'installation) y est écrit |
| `HOST`, `PORT` | `127.0.0.1`, `4173` | écoute locale seulement (Caddy devant) |

- `GET /api/v1/vivant` → `{ "ok": true }` (public, sans donnée, quel que soit le nom d'hôte) : vérification de l'installateur.
- Premier démarrage sans compte : code de 256 bits dans `${LB_DONNEES}/installation.txt` (0600, le code seul et un
  saut de ligne ; repris tel quel au redémarrage ou à la mise à jour tant que rien n'est installé ; effacé dès l'installation ;
  pour en changer : supprimer le fichier puis `sudo systemctl restart living-business`).
  Perdu : `sudo cat /var/lib/living-business/installation.txt`.
- Mot de passe ET code de secours perdus : `sudo living-business-secours` (lance `src/passerelle/secours.ts` avec
  `LB_EN_LIGNE=1 LB_ORIGINE=…`) → lien `https://<domaine>/secours/<jeton>` (15 min, une fois), qui remet aussi à zéro
  la validation en deux étapes du compte choisi.
- Essai en local : `LB_EN_LIGNE=1 LB_PROXY=1 LB_ORIGINE=http://127.0.0.1:4173 LB_DONNEES=/tmp/essai npm start`
  (sans proxy, l'installation « sur place » reste possible sans code).

**Application installable** (PWA) : `web/manifest.webmanifest`, icônes `web/icone-*.png` et `apple-touch-icon.png`
(dessinées par `npm run icones`, sans dépendance), service worker `web/sw.js` minimal : les pages passent toujours par
le réseau (page « Pas de connexion » sinon), **rien d'autre n'est gardé** — ni l'API, ni les données. Installation
proposée en https (jeu en ligne) ou sur l'ordinateur lui-même (`http://127.0.0.1`).

## Démarrer (développement)

Prérequis : Node.js ≥ 22.18 (exécute TypeScript sans build).

```bash
npm ci
npm run check   # vérification des types + essais
npm start       # http://127.0.0.1:4173 → première fois : créer l'entreprise et l'accès propriétaire
npm run demo    # démonstration jetable : exemple fictif, profils sans mot de passe, rien d'enregistré
npm run secours # mot de passe ET code de secours perdus (sur l'ordinateur qui fait tourner le jeu)
```

Système de design Breizhcosystem (outils de développement, jamais envoyés au navigateur) :

```bash
npm run ds:synchro                        # web/bz/tokens.css et bz.css depuis design/ (-- --source <dossier> pour recopier d'abord un dossier de design tenu ailleurs)
npm run icones:sprite                     # web/bz/icones.svg depuis lucide-static (liste : web/bz/icones.txt)
python3 -I scripts/polices.py --inter … --fraunces … --atkinson …   # polices (fontTools + brotli dans un venv)
```

Tout est **enregistré sur disque** dans `donnees/` (fichier JSON écrit de façon atomique, droits 0600, copie de l'état précédent, copie quotidienne dans `sauvegardes/` ; jetons d'outils et adresse du webhook sortant chiffrés en AES-256-GCM, clé dans `donnees/cle-secrets` (poste de bureau) ou `LB_CLE_SECRETS` ; jeu en ligne : clé HORS du dossier des données, chiffrée par la clé du serveur (`systemd-creds`, `/etc/living-business/cle-secrets.cred`) et remise au seul service à son démarrage (`LoadCredentialEncrypted`), jamais créée dans `/var/lib/living-business` ; mots de passe hachés scrypt). Autre dossier : `LB_DONNEES=/chemin npm start`. Tout recommencer : arrêter le serveur et supprimer `donnees/` (**définitif** : exportez d'abord).

**Équipe au bureau** : un ordinateur (PC, Mac mini, NAS) fait tourner Living Business ; sur cet ordinateur, Réglages → Équipe et réseau → « Ouvrir à mon équipe » (+ « Lancer au démarrage »). Les collègues ouvrent l'adresse affichée. Le réglage est retenu. Pas de chiffrement sur le réseau du bureau (http) : jamais sur un Wi-Fi public. En ligne de commande : `HOST=0.0.0.0 npm start` ; autres noms d'hôte : `LB_HOTES=serveur.local`. Accès depuis Internet : voir « Mettre le jeu en ligne chez soi » (Tailscale, ou serveur de l'entreprise derrière Caddy).

## Ce que fait le jeu

### Maquette 3D réaliste

- Échelle réelle (1 unité = 1 m). Bureaux en open-space aménagés : îlots de postes avec écrans et claviers, employés assis à leur poste, salle de réunion vitrée, coin détente, rangements, plantes ; entrepôts avec racks à palettes, chariots élévateurs, quais et camions ; ateliers avec établis et machines.
- Navigation de carte : glisser pour déplacer, clic droit pour tourner, molette pour zoomer vers le curseur, **double-clic pour entrer dans un bâtiment** (prénoms et stocks apparaissent en zoomant). Rangée de calques en un clic au-dessus de la carte.
- Rendu : éclairage d'environnement, ombres, occlusion ambiante (coupée automatiquement si la machine peine), sols texturés.
- Modèles 3D : [KayKit](https://kaylousberg.com) *Furniture Bits* et *City Builder Bits* par Kay Lousberg, licence **CC0** (domaine public) — fichiers et licences dans `web/modeles/`.

### Entreprise entière ou par départements

- **Petite ou moyenne entreprise** : la carte montre l'entreprise d'un seul tenant, par lieux (siège, atelier, entrepôt…).
- **Entreprise plus grande** (choix « par départements » à la mise en route, ou taille « ETI ou grande » / effectif ≥ 250) : la carte s'ouvre **par département** — **tous les services dans le même siège** (plateaux vitrés à leur couleur le long d'allées, hall d'accueil avec banque et courrier général) ; tout ce qui est dehors est extérieur à l'entreprise (clients, fournisseurs, partenaires). Chaque plateau a son équipe à ses bureaux, son **tableau de tâches** (post-its à faire / en cours / bloquée / terminée), sa pile de dossiers, son stock, ses machines et ses véhicules (révision, contrôle technique). Des **flux animés** relient chaque département à ses clients et fournisseurs pour les commandes en cours.
- La bascule **Entreprise / Départements** est toujours disponible ; onglet **Départements** avec un tableau de bord par service (équipe, Kanban, alertes, dossiers, stock) ; filtre par département dans « Aujourd'hui » et les listes ; périmètre par département dans les profils.
- Deux exemples fictifs : `EXEMPLE=eti npm start` (défaut, « Armor Distribution », 7 départements, 40 employés modélisés) ou `EXEMPLE=pme npm start` (« Démo Breizh », 9 personnes) — aussi changeable dans le bandeau de démonstration.

### Recherche, calques, raccourcis et visite guidée

Recherche (`/` ou ⌘K), préréglages de calques « L'essentiel / Le travail / Tout », toits (vue fermée), anneaux de présence (plein = confirmé, pointillés = déclaré), prénoms, pause des animations, vue de dessus, rotation par quart, raccourcis clavier (`?`), visite guidée en 6 étapes (dans Aide, plus jamais lancée d'office), états des véhicules (révision, contrôle technique, pneus), échéances (tâches, livraisons) qui créent des alertes.

On arrive **directement sur la maquette 3D** d'une entreprise **fictive** (« Démo Breizh ») :

- **Mon entreprise** au centre : siège, agence, atelier, entrepôt — bâtiments ouverts (maison de poupée), employés à leur poste de rattachement, stock en rayonnages, véhicules immatriculés au parking, projets en échafaudage chez le client.
- **Clients** à l'ouest (boutiques, restaurant, hôtel, camping, mairie, particulier), **Fournisseurs** à l'est (entrepôts, usine, transporteur), **Clients & fournisseurs / partenaires** au nord, **Prospects** en bord de plage, **Phare Breizhcosystem** sur la jetée.
- Pastilles d'alerte avec preuve, calques (clients, fournisseurs, employés, stock, véhicules, alertes, noms, circulation).

Navigation groupée (libellés issus de l'univers) : **Aujourd'hui** (la carte et son panneau) · **Planning** (Planning, Tâches, Employés) · **Pilotage** (Santé, Optimiser, Départements) · **Relations** (Clients, Fournisseurs, Courrier, Satisfaction) · **Activité** (Commandes, Stock, Documents, Lieux) · **Réseau** (Breizhcosystem), puis Connecter mes données et Réglages. Sur ordinateur, un rail groupé (248 px, replié par `B`) ; sur tablette, le rail replié ; sur téléphone, une barre à 5 onglets (Aujourd'hui · Planning · Relations · Activité · Plus) dont « Plus » ouvre la palette en feuille basse (Plein soleil, Activité récente, Aide, Réglages à des places fixes). Chaque vue a son adresse (`#/planning`, `#/role:client`…) : lien partageable, bouton Retour.

**Aujourd'hui** (ex-« Ce matin ») est posé sur la carte : panneau de 360 px sur ordinateur, feuille basse à 3 crans (poignée, 40 %, 90 %) sur téléphone, ou page en liste (Réglages › Apparence › « Ouvrir sur », ou sans 3D). D'abord la chose à faire maintenant (carte héros avec sa preuve), puis 3 à 5 actions, chacune traitable ou reportable (« Plus tard » la renvoie à demain, annulable), puis des tuiles homogènes (choses à régler, « — » quand on ne sait pas) et l'anneau de santé ; le reste est replié (Premiers pas, annonces légales, qui est où, courrier, à vérifier, quêtes). La salutation (« Bonjour Anna » jusqu'à 11 h) est le titre de l'en-tête.

### Planning, courrier, papiers, visibilité

- **Planning des équipes** : semaine par semaine (lieu, chantier/projet, mission, absence), modifiable case par case selon les droits ; « Qui est où aujourd'hui » ; effectifs prévus face au besoin de chaque lieu ou projet (`besoin_effectif`) ; trous signalés (sous-effectif, personne non affectée) sur 6 jours ouvrés ; Gantt simple des projets. En simulation, le planning se modifie sans toucher au réel.
- **Courrier** : bacs (clients, fournisseurs, paiements, administratif, équipe, publicité), urgence, « pour qui », action proposée, « Traité » en un clic, création d'une tâche depuis un mail. **Trier un vrai mail** : collez-le, le tri par mots-clés (sans IA, rien ne sort du serveur) propose bac, urgence, destinataire et action.
- **Documents** (attestations, assurances, Kbis…) : date de validité, alerte 30 jours avant expiration.
- **Accès et visibilité** (dirigeant) : qui voit quels lieux, départements, rôles de tiers et types d'informations, avec l'aperçu en % de ce que chaque profil voit ; droits préparer / approuver / score / administrer ; « Voir comme » pour vérifier. Contrôlé côté serveur à chaque requête ; au moins un administrateur est toujours conservé.
- **Sur la maquette** : chacun est placé selon le planning du jour (poste vide avec le motif s'il est absent ou en déplacement, ouvriers casqués devant le chantier du client avec « Équipe n/besoin »), bac à courrier à l'accueil ou dans le département avec le nombre de plis et les urgents.

**Connecter mes données** (bouton jaune) : fichier CSV (un classeur .xlsx n'est pas encore lu : copier-coller ou « Enregistrer sous » CSV), Google Sheets (lien publié, import ponctuel), copier-coller, saisie manuelle, **comptabilité par fichier FEC** (Sage, EBP, Cegid, Ciel, Quadra, ACD…) ; les outils (Airtable, Notion, HubSpot, Google Sheets, Excel Microsoft 365, Dynamics 365 Sales, Dynamics 365 Business Central, Pennylane, Qonto, Odoo, Pipedrive, Shopify, Axonaut, Stripe, WooCommerce, PrestaShop, Sellsy, Make/Zapier/n8n, API REST, MCP) se branchent dans les deux sens via Réglages → Outils branchés — en **un clic** (« Se connecter avec HubSpot », Google, Microsoft, Notion, Airtable, Pipedrive, Sellsy, Shopify, WooCommerce) quand Breizhcosystem est réglé, sinon avec une clé. Encore à venir : connexion directe Sage et EBP (sans export) — « Demander » trace l'intérêt dans le journal.

**Mode avancé : tout se branche avec les identifiants de l'entreprise, rien chez l'éditeur** : jeton créé dans l'outil (HubSpot, Pipedrive, Pennylane…), script collé dans sa propre feuille Google, application inscrite dans son propre annuaire Microsoft, fichier FEC exporté de sa comptabilité. Aucune application OAuth, aucun compte développeur, rien ne transite par l'éditeur. (« Se connecter avec… », plus simple, passe par le relais de l'éditeur pour les jetons : voir plus bas.)

| Vue | Voit | Peut |
|---|---|---|
| Anna — dirigeante | tout + score privé | préparer, approuver, connecter des données, changer d'univers |
| Yann — responsable stock | entrepôt, stock, fournisseurs, son équipe | préparer des actions (approbation requise) |
| Nolwenn — technicienne | l'atelier uniquement | lecture seule |

### Mise en route pas à pas (accès pédagogique)

Bouton **🏁 Créer mon entreprise / Mise en route** : nom, activité, ville, **nombre de personnes** (qui conseille « d'un seul tenant » ou « par départements »), vocabulaire du métier, puis lieux, services, équipe, clients et fournisseurs en saisie rapide — avec, à chaque étape, **« Pourquoi on vous le demande »**, l'import CSV/Excel (modèle téléchargeable) et le branchement d'un outil. Chaque réponse est enregistrée aussitôt : on s'arrête et on reprend quand on veut.

### Le menu grandit avec l'entreprise (simplicité)

Le premier jour, une entreprise vide ne voit que **Aujourd'hui** (la carte et la chose à faire), **Connecter mes données** et **Réglages**. Une rubrique entre dans le menu quand elle a quelque chose à montrer : ce sont les données de l'entreprise qui l'ouvrent, jamais des points (un niveau du port n'ouvre aucune fonction). Rien n'est retiré du produit.

Les règles sont dans **un seul fichier**, `web/simplicite.js` (module pur, testé par `src/ds/simplicite.test.ts`), calculées sur ce que `/api/v1/monde` montre au profil :

| Rubrique | Apparaît dès que… |
|---|---|
| Aujourd'hui · Connecter mes données · Réglages | toujours (les deux dernières : administrateurs, comme avant) |
| Planning · Équipe | une première personne de l'équipe existe |
| Tâches | la première tâche existe, créée à la main ou préparée par une automatisation |
| Santé | un score est calculable (au moins 20 % des critères renseignés) |
| Optimiser | il y a de l'activité à alléger : commande, facture, stock, courrier, document, tâche ou équipe |
| Départements | un département existe |
| Clients · Fournisseurs | le premier client · le premier fournisseur |
| Courrier | le premier courrier |
| Satisfaction | il y a quelqu'un à interroger : un client ou une personne de l'équipe (ou un baromètre déjà lancé) |
| Commandes | la première commande, le premier devis ou la première facture |
| Stock · Documents · Lieux | le premier article, véhicule ou équipement · le premier document · le premier lieu |
| Breizhcosystem (le réseau) | l'entreprise est reliée au réseau, ou a ses premières données (client, fournisseur, stock ou commande) |
| Pipeline (bascule de la carte) | le premier prospect, devis, commande de client ou facture |
| Quêtes et barre d'XP | la première quête (une situation à régler) ou une réussite déjà acquise |

- **Rien n'est pris en otage.** L'interrupteur **« Tout afficher »** (pied du menu sur ordinateur, « Plus » sur téléphone, Aide › « Les rubriques du menu », palette) montre tout d'un coup : menu, tuiles et replis d'« Aujourd'hui », Pipeline, barre d'XP. Le choix est gardé **par personne, sur l'appareil** (`lb-simplicite:<profil>`). La recherche (⌘K), les raccourcis « G puis lettre », les liens directs (`#/planning`…) et les messages ouvrent toujours tout ; la rubrique où l'on se trouve et celle où quelque chose est dû s'affichent toujours.
- **Les droits ne changent pas.** `web/navigation.js` et la passerelle décident toujours de ce qui est permis ; la simplicité ne fait que retirer de la vue ce qui est encore vide. Une rubrique interdite reste interdite, avec ou sans « Tout afficher ».
- **Une entreprise déjà en place retrouve son menu** dès la première lecture, et ne reçoit aucune note sur ce qu'elle utilise déjà. L'exemple (`npm run demo`) montre toutes ses rubriques.
- **Quand une rubrique apparaît** : un message (« Nouvelle rubrique dans votre menu : Clients. », avec « Voir »), la mention « Nouveau » dans le menu, et à la première ouverture une note (« J'ai compris » la referme ; elle se range d'elle-même quand on quitte la rubrique) : à quoi elle sert, par quoi commencer. Jamais sous un bandeau d'exemple, de simulation ou d'aperçu ; jamais au démarrage. Toutes les notes se relisent dans Aide › « Les rubriques du menu ».
- **Écrans vides** : deux lignes (ce qui manque, ce que l'écran montrera) et une seule action.

Hypothèses retenues (à confirmer) : le choix « Tout afficher » et les notes lues restent sur l'appareil, comme les autres préférences (mode Calme, « Ouvrir sur ») — ils ne suivent pas la personne d'un appareil à l'autre ; un profil restreint ne voit dans son menu que les rubriques où il voit des données ; une rubrique dont les données disparaissent quitte le menu simple (elle reste ouverte par la recherche) ; la bascule « Pipeline » garde son nom (référence de design).

### Outils branchés : dans les deux sens, en temps réel

Réglages → **Outils branchés** : **Airtable, Notion, HubSpot, Google Sheets, Excel Microsoft 365, Make · Zapier · n8n (webhook), API REST** (tout logiciel avec une API JSON) et **serveur MCP** (tout outil qui expose ses outils en MCP).

**Se connecter avec… (un clic, recommandé)** : HubSpot, Google (Sheets), Microsoft (Excel 365), Notion, Airtable, Pipedrive, Sellsy, Shopify, WooCommerce — badge « 1 clic », en tête du catalogue. Un gros bouton « Se connecter avec X » ouvre la page de connexion DE L'OUTIL dans un nouvel onglet ; la personne s'y connecte avec SON compte et accepte ; de retour dans le jeu, c'est connecté (« Connecté à X »). Restent les derniers choix, proposés en liste quand l'outil le permet (bases et tables Airtable, bases de données Notion) ou un lien à coller (« Copiez le lien de la feuille » pour Google Sheets et Excel), puis test → correspondance → activation. Shopify demande d'abord l'adresse en .myshopify.com, WooCommerce l'adresse du site (vérifiée par l'anti-SSRF).
- Fonctionnement : chaque outil exige une application déclarée avec un secret et une adresse de retour https, ce que le jeu installé chez l'entreprise ne peut pas avoir. Le **relais de connexion de Breizhcosystem** (aucun compte Breizhcosystem nécessaire) le fait à sa place : il renvoie l'adresse de la page de l'outil, échange le code contre les jetons, puis les remet UNE fois au jeu (secret d'attente gardé par le serveur du jeu, jamais par le navigateur). Le renouvellement des jetons passe aussi par le relais ; les **données** vont toujours directement de l'outil au jeu.
- Les outils proposés en un clic sont ceux ouverts par l'éditeur sur Breizhcosystem (`GET /v0/oauth/fournisseurs`) ; sans adresse de Breizhcosystem, ou Breizhcosystem injoignable, le jeu propose simplement les clés.
- **Mode avancé** : « Utiliser une clé à la place (mode avancé) » affiche les champs habituels (jeton d'API, clé ck_/cs_, script Apps Script, application de l'annuaire Microsoft…) ; ils marchent exactement comme avant. Serveur MCP, webhook Make · Zapier · n8n et API REST sont rangés sous « Avancé ». Odoo, Axonaut, PrestaShop, Qonto, Pennylane et Stripe se branchent toujours par leur clé.
- Connexion expirée ou retirée chez l'outil : « Se reconnecter » dans Réglages → Outils branchés.
- **En temps réel** (Living Business relié à Breizhcosystem) : Airtable, Notion, Google Sheets, Excel, HubSpot et Pipedrive préviennent de leurs changements. Ils ne savent joindre qu'une adresse sur Internet : leurs avis passent par Breizhcosystem, qui les vérifie et prévient le jeu par un canal que celui-ci garde ouvert ; le jeu relit alors l'outil lui-même, une fois pour tous les avis des 2 secondes. Le branchement affiche « En temps réel », sinon « Toutes les N minutes » ; la relecture régulière reste en filet de sécurité (30 minutes en temps réel). Détails, droits et limites par outil : [docs/CONNECTEURS.md](docs/CONNECTEURS.md), « Temps réel ».

Détails par outil :
- **Google Sheets** (feuille privée) : « Se connecter avec Google » puis le lien de la feuille (API Sheets, seules les cellules synchronisées sont modifiées, un texte venu du jeu qui commencerait une formule — = + - @ — est écrit comme texte, jamais exécuté ; de même par le script et dans Excel 365). Mode avancé : l'entreprise colle le script fourni dans SA feuille (Extensions → Apps Script) et le déploie en Application Web ; le secret est généré par le jeu et déjà placé dans le script, toute requête sans lui est refusée. Lecture et écriture (seules les cellules synchronisées changent, les formules restent). Rien n'est publié sur le Web.
- **Dynamics 365 Sales** (CRM, Dataverse Web API v9.2) : comptes et contacts dans les deux sens, « Se connecter avec Microsoft » + adresse de l'organisation (https://…crm4.dynamics.com) ; pages suivies sur le même hôte seulement, seuls les champs connus sont écrits.
- **Dynamics 365 Business Central** (API v2.0) : clients, fournisseurs, articles dans les deux sens ; entreprise choisie dans la liste après connexion ; modification avec la version courante (ETag) ; solde et stock en lecture seule.
- **Excel Microsoft 365** (OneDrive, SharePoint, Microsoft Graph) : « Se connecter avec Microsoft » puis le lien du classeur. Mode avancé : l'entreprise inscrit une fois une application dans SON annuaire Entra ID (« Autoriser les flux de clients publics », aucun secret d'application), puis « Se connecter à Microsoft » affiche un code à saisir sur microsoft.com/devicelogin avec son compte. Le jeu ne voit jamais le mot de passe ; droits délégués (fichiers auxquels la personne a déjà accès) ; jeton de rafraîchissement chiffré et renouvelé à chaque usage ; seules les cellules synchronisées sont écrites, un texte qui commencerait une formule (= + - @) l'est comme texte.
- **Pennylane** (comptabilité, API V2, jeton Bearer) : clients et fournisseurs, lecture et écriture.
- **Qonto** (banque, clé API « identifiant:clé secrète ») : clients de la facturation Qonto, lecture et écriture (comptes et paiements jamais touchés).
- **Odoo** (ERP, odoo.com ou auto-hébergé, JSON-RPC + clé d'API) : clients, fournisseurs et produits, lecture et écriture ; adresse vérifiée par l'anti-SSRF.
- **Pipedrive** (CRM, API v2, jeton d'API) : organisations, personnes et affaires, lecture et écriture.
- **Shopify** (e-commerce, Admin API GraphQL, jeton shpat_… ou identifiant + secret client du Dev Dashboard) : clients en lecture et écriture, produits et commandes en lecture.
- **Axonaut** (CRM et facturation, API v2, clé d'API) : clients, prospects et fournisseurs, lecture et écriture (IBAN et BIC jamais importés).
- **Stripe** (paiement, API v1, clé restreinte rk_… recommandée) : clients en lecture et écriture, factures en lecture (paiements jamais touchés).
- **WooCommerce** (e-commerce WordPress auto-hébergé, API REST v3, clé + secret client en HTTPS) : clients en lecture et écriture, produits et commandes en lecture ; adresse vérifiée par l'anti-SSRF.
- **PrestaShop** (e-commerce auto-hébergé, webservice + clé, sortie JSON) : clients en lecture et écriture (PrestaShop 8 ou plus pour écrire), produits en lecture ; adresse vérifiée par l'anti-SSRF.
- **Sellsy** (CRM, API v2, OAuth2 « client credentials », jeton gardé en mémoire) : clients, prospects et fournisseurs, lecture et écriture.

- **Réel → jeu** : lecture périodique (30 s à 1 h) ou réception immédiate (webhook signé) ; rapprochement par nom à la première synchro (pas de doublon) ; correspondance des champs proposée puis validée.
- **Jeu → réel** : toute fiche modifiée dans le jeu (bouton **Modifier la fiche**, mouvement de stock, statut…) est renvoyée à l'outil d'origine ; les fiches créées dans le jeu y sont créées (« dans les deux sens »). Conflit : la dernière modification gagne, une fiche en attente d'envoi n'est jamais écrasée par la lecture. Anti-boucle par empreinte.
- **Temps réel** : la page se met à jour toute seule (Server-Sent Events, pastille « En direct ») quand un collègue, un outil ou un formulaire change quelque chose ; le flux ne transporte aucune donnée, chacun relit avec ses droits.
- Sécurité : réservé à la direction ; jetons chiffrés au repos et jamais renvoyés au navigateur ; appels sortants en HTTPS uniquement, adresses privées ou internes refusées (anti-SSRF, IPv6 et IPv4 intégrée dans IPv6 comprises, adresse revérifiée à la connexion), redirections refusées, délais bornés, réponse lue morceau par morceau et coupée au-delà de 5 Mo ; entrée webhook protégée par secret Bearer ou signature horodatée `X-LB-Signature: t=<secondes>,v1=<HMAC-SHA256(secret, « t.corps »)>` (5 minutes d'écart au plus, une signature ne sert qu'une fois ; l'ancienne forme `sha256=…` sans horodatage est refusée) ; envois du jeu signés de la même façon avec une clé DIFFÉRENTE, `HMAC-SHA256(secret, « living-business:webhook:envois:v1 »)` en hexadécimal, affichée à la création : une signature d'envoi n'est jamais acceptée en entrée.

### Claude, agents IA, Make : clés d'API et serveur MCP

Réglages → **Clés d'API · Claude · MCP** : une clé agit avec les droits d'un profil (même périmètre), montrée une seule fois, révocable ; elle ne prend jamais une décision réservée à une personne (achats Breizhcosystem, clés, accès, liaison et partage Breizhcosystem, automatisations) et tout ce qu'elle fait est au journal avec son nom. Point d'entrée **MCP** `/mcp` (Streamable HTTP) : résumé du jour, recherche, fiche, modification (avec approbation selon le profil), tâches, mouvements, planning, courrier, satisfaction, formulaires, optimisations.

```bash
claude mcp add --transport http living-business http://127.0.0.1:4173/mcp --header "Authorization: Bearer lb_…"
```

Claude Desktop : pont stdio `src/mcp/pont-stdio.ts` (configuration prête à copier dans la page). API REST : `Authorization: Bearer lb_…` sur `/api/v1/*`.

### Santé de l'entreprise : 6 domaines, 46 critères

Onglet **Santé** (et anneau sur la carte) : Finances, Commercial & clients, Opérations, Équipe & social, Gestion & administratif, Outils & automatisation. Chaque critère est noté 0–100 avec sa mesure (« 1,6 mois de charges », « NPS +60 »), sa source et un conseil ; une donnée absente est « à connecter », jamais 0 ; couverture affichée ; 3 priorités et 3 forces. Chiffres clés saisis en 2 minutes (trésorerie, charges, CA, marge), venus des outils branchés, ou **importés du FEC** de la comptabilité (Santé → « Importer ma comptabilité ») : chiffre d'affaires, marge, résultat, trésorerie, créances clients, emprunts, capitaux propres (plan comptable général, annualisés si l'exercice est en cours). Seuls ces totaux sont gardés : le fichier n'est ni conservé ni envoyé ailleurs. Seules des notes 0–100 (jamais de montant ni de nom) peuvent partir vers Breizhcosystem pour la comparaison (`ratiosSante`) : Breizhcosystem les garde rattachées à l'entreprise (données pseudonymes, pas anonymes) et les autres membres n'en voient que des moyennes de groupes d'au moins 10 ; sous 11 personnes, aucune note du domaine social ne part.

### Breizhcosystem : le réseau des entreprises, en partage ciblé

Réglages → **Breizhcosystem** : « Relier mon entreprise » (un clic : un code s'affiche, on le confirme sur Breizhcosystem — inscription en une minute avec le SIRET), puis 5 interrupteurs pour choisir **ce que le jeu partage** : profil (secteur), besoins détectés (rupture de stock, renfort de personnel, location de matériel), stocks à céder (surplus au-delà de 2× le seuil), capacité disponible (un **nombre** de personnes, jamais un nom), notes de santé 0–100 (jamais un montant). « Voir exactement ce qui part » affiche l'envoi mot pour mot ; les données d'exemple ne partent jamais ; la liste des catégories est relue sur Breizhcosystem à chaque envoi (1 min après un changement, puis toutes les 30 min). Onglet **Breizhcosystem** : opportunités du jour (on cherche ce que vous proposez, solutions à vos besoins, stocks, renforts, appels d'offres publics BOAMP, achats groupés). Page **Santé** : position face aux entreprises comparables (moyennes de groupes d'au moins 10). Sur chaque fiche client / fournisseur : **« Proposer Breizhcosystem à… »** (WhatsApp, e-mail, SMS, LinkedIn, un mois offert à chacun, relation créée des deux côtés). Adresse de Breizhcosystem : `LB_NEXUS_URL`, préréglée dans le paquet (`--nexus`) ou saisie dans Réglages. **Agents d'achat** (onglet Breizhcosystem) : « Demander à l'agent » (je cherche…, quantité, département, prix max) → propositions des membres : *Commander* (stock avec prix : quantité × prix = total affiché avant de valider), *Contacter* (catalogue, renfort) ou *Publier ma demande sur le réseau* si rien ne convient ; mandats (budget du mois, catégories, remise visée). L'agent prépare, vous validez toujours, le vendeur confirme ensuite. **Échanges entre agents** : *Demander un prix* sur un stock trouvé (quantité, prix souhaité facultatif) → l'agent du vendeur répond dans les règles de son entreprise, sinon une personne de chez lui ; « Échanges en cours » dit où en est chaque échange et quelle est la suite. Une proposition n'engage personne : une personne la valide **sur Breizhcosystem, connectée** (le jeu ouvre la page, il ne valide jamais à sa place) ; elle devient alors une commande, que le vendeur confirme. Paiement direct au vendeur, jamais via Breizhcosystem : en ligne (page Stripe Checkout du vendeur), par virement (IBAN, référence `NX-…` à mettre dans le libellé) ou par son lien, puis « J'ai payé » ; le vendeur clique « Paiement reçu ».

### Clients en difficulté (Bodacc)

Sur activation (Aujourd'hui → Annonces légales → « Activer la surveillance »), le jeu vérifie chaque jour au Bodacc (données publiques gratuites) si un client avec SIRET fait l'objet d'une procédure collective (12 derniers mois) : alerte dans Aujourd'hui et sur la fiche, lien vers l'annonce officielle. Seuls les SIREN des clients sont envoyés au service public.

### Satisfaction clients et baromètre d'équipe

- Onglet **Satisfaction** : note de chaque client (datée), évolution, moyenne, **NPS**, clients sans avis depuis 6 mois. **« Envoyer un formulaire »** (fiche client ou envoi groupé) : lien personnel à usage unique, valable 30 jours, prêt à envoyer par e-mail (ou par vos outils) ; la réponse **se greffe à la date** sur la fiche, la page et le bâtiment du client sur la carte (☺ 9/10, ☹ 5/10 ▼, « avis ? »). Un avis sous 7/10 crée une alerte.
- **Baromètre collaborateurs** : formulaire anonyme (seul le service est enregistré, jamais le nom), bien-être et charge de travail par service, **affichés à partir de 3 réponses**.

### Optimiser : ce qui peut être automatisé

Onglet **Optimiser** : pistes détectées sur vos données réelles (relances de factures et de devis, facturation à la livraison, réapprovisionnement, tri du courrier, papiers et véhicules, tâches sans responsable, trous de planning, satisfaction, baromètre, doublons, ressaisies, gestes répétés du journal), chacune avec son **constat chiffré, son hypothèse de calcul, les heures et euros gagnés par mois** (coût horaire réglable). **Automatiser** active une recette (« quand… alors… ») : tâche attribuée, formulaire, événement signé envoyé à Make/Zapier/n8n — jamais deux fois la même chose, jamais en simulation.

**Tâches répétitives déclarées** (même onglet) : à côté de ce que le jeu détecte, une personne décrit une tâche qu'elle refait souvent — une question à la fois : son nom, qui la fait, le temps gagné à chaque fois, sa fréquence, le temps qu'il faudrait pour l'automatiser, et trois réponses sur le risque (toujours pareil ? cas particuliers ? gravité d'une erreur ?). Le jeu répond « est-ce que ça vaut le coup ? » : heures gagnées par an **en temps de travail** (228 jours, 45,6 semaines, 11 mois par an), délai de rentabilité (temps d'automatisation ÷ heures gagnées par semaine du calendrier), euros au coût horaire réglé, et un verdict **toujours accompagné de sa raison et du calcul de chaque chiffre** : gain trop faible (moins d'1 h par an), pas rentable sur N ans (durée comptée réglable de 1 à 5 ans, 5 par défaut), à automatiser (au moins 15 h par an, regagné en 26 semaines au plus — « vous validez chaque envoi » si une erreur serait grave, si les cas particuliers sont fréquents ou si la façon de faire change souvent), intéressant à planifier (au moins 5 h par an, 52 semaines au plus), sinon petit gain. Une tâche peut être rattachée à l'une des 12 automatisations (« celle-ci le fait déjà ») : elle en montre alors l'état (en marche, prête, données manquantes) et le bouton pour la mettre en marche ; sinon l'écran dit ce qu'il reste à faire (outil d'automatisation branché, ou pas encore possible d'ici). Idées de départ universelles, 100 tâches au plus, calcul pur (`src/core/taches-repetitives.ts`), rien d'envoyé à l'extérieur. API : `GET /api/v1/automatisations/taches`, `POST …/taches`, `POST …/taches/estimation` (verdict sans enregistrer), `PUT` et `DELETE …/taches/:id` — lecture pour les administrateurs et les approbateurs, écritures pour les seuls administrateurs, à l'écran (jamais une clé d'API).

Limites assumées : les comptes sont réels (identifiant et mot de passe, validation en deux étapes disponible) ; les profils de démonstration ne servent qu'à `npm run demo`. Import Excel natif non inclus (CSV ou copier-coller). Connecteurs comparés à la documentation officielle de chaque outil et essayés contre des réponses simulées, pas encore contre de vrais comptes (détail : [docs/CONNECTEURS.md](docs/CONNECTEURS.md)). « Se connecter avec… » est essayé contre un relais et des outils simulés ; il ne marche pour un outil que si l'éditeur y a déclaré son application (sinon : mode avancé, par clé). Gmail, Agenda Google, Outlook et serveurs MCP à OAuth : via Make, Zapier ou n8n. Pas d'envoi d'e-mail par le serveur (lien `mailto:` ou vos outils). Paquets Mac et Windows non signés par Apple ni Microsoft : leur intégrité se vérifie avec `SHA256SUMS.txt` et sa signature.

## Universel et personnalisable

Le noyau ne connaît aucun secteur. Il connaît 10 **familles** stables (organisation, personne, **tiers**, lieu, projet, ressource, commande, tâche, événement, indicateur).
Tout le vocabulaire visible vient d'un **univers** JSON :

| Univers | Exemple de vocabulaire |
|---|---|
| [`generique`](univers/generique.json) | Clients, Fournisseurs, Partenaires, Prospects, Sous-traitants · Sites, Entrepôts · Projets · Articles en stock · Devis, Commandes clients / fournisseurs, Factures |
| [`btp`](univers/btp.json) | Projet → **Chantier**, Entrepôt → **Dépôt**, Article → **Matériau**, + Engins, + Maîtres d'ouvrage |
| [`commerce`](univers/commerce.json) | Site → **Magasin**, Article → **Produit**, Commande client → **Vente**, projets masqués |

- Un **tiers** porte des rôles : un même tiers peut être **client ET fournisseur** (fréquent dans un écosystème local).
- Personnaliser = un petit fichier qui `herite` d'un autre : renommer, masquer, ajouter types / rôles / champs / règles. Aucun code.
- Jamais de suppression ni de changement de famille : les données déjà saisies restent valides.
- Les **règles d'alerte** sont aussi déclarées dans l'univers (stock minimum, retard de projet, retard de paiement, encours client…).
- Chaque rôle se traduit vers le vocabulaire réseau commun de Breizhcosystem (`"reseau": "client"`) : chacun parle sa langue en privé, tout le monde se comprend sur le réseau.

```json
{
  "id": "mon_garage", "nom": "Garage (exemple)", "version": 1, "herite": "generique",
  "types": [
    { "id": "projet", "libelle": "Réparation", "pluriel": "Réparations" },
    { "id": "article", "libelle": "Pièce détachée", "pluriel": "Pièces détachées" }
  ]
}
```

## Structure

```
univers/      vocabulaires JSON (générique + exemples sectoriels)
src/
  core/       noyau métier pur, sans I/O
    model.ts      familles, objets, provenance, fraîcheur (LB-02/03)
    univers.ts    validation + personnalisation des univers, validation des objets
    situation.ts  règles de seuil déclaratives, preuves (LB-03, R02)
    actions.ts    commandes d'action, idempotence, simulation (LB-04/05, R03/R04)
    vitalite.ts   score explicable avec couverture (LB-07, R14)
    indicateurs.ts indicateurs dérivés des règles de l'univers
    quetes.ts     quêtes issues des situations, achevées sur preuve (LB-08)
  lanceur.ts  lanceur de bureau (double-clic) : dossier des données, port libre, navigateur, instance unique
  passerelle/ API privée /api/v1 (node:http, zéro dépendance)
    http.ts       sessions, CSP, anti-CSRF, anti DNS rebinding, fichiers statiques en liste blanche
    comptes.ts    comptes locaux : installation, invitations, scrypt, code de secours, deux étapes, blocage des essais
    en-ligne.ts   jeu en ligne : code d'installation à usage unique, adresse du client derrière le proxy, blocages
    totp.ts       validation en deux étapes (RFC 6238 / 4226, base32, otpauth://)
    qr.ts         encodeur de QR code sans dépendance (mode octet, niveau M, versions 1–40) → SVG
    reseau.ts     mode équipe : écoute bureau sans redémarrer, adresses, veille ; demarrage.ts : lancement automatique
    lien-nexus.ts liaison Breizhcosystem en un clic, partage ciblé (construirePartage), opportunités, comparaison, « Proposer à… »,
                  échanges entre agents (demande de prix et suivi par le protocole A2A ; jamais de validation)
    bodacc.ts     alerte clients en difficulté (procédures collectives, opt-in)
    sources-metier.ts connecteurs Pennylane, Qonto, Odoo, Pipedrive, Shopify
  core/sante.ts   score de santé : 6 domaines, 46 critères, notes partageables sans montant
    application.ts assemble le monde et ses modules, installation, sauvegardes (export / restauration)
    stockage.ts   disque atomique 0600, copies quotidiennes, chiffrement des secrets et des exports
    monde.ts      périmètres, actions préparer/approuver, simulation, import, journal
    csv.ts        analyse CSV, correspondance proposée, conversions
    connecteurs.ts catalogue honnête + Google Sheets publié (anti-SSRF)
    oauth-relais.ts « Se connecter avec… » : client du relais de Breizhcosystem, jetons relus, secret enregistré chiffré
    temps-reel.ts   temps réel : canal des avis vers Breizhcosystem, abonnements chez chaque outil (avec ses jetons)
    sources-google.ts Google Sheets par l'API Sheets (connexion « Se connecter avec Google »)
    sources-microsoft.ts  Excel Microsoft 365 (Graph, relais ou code d'appareil avec l'application de l'entreprise)
  core/fec.ts     lecture du FEC (totaux du plan comptable général)
  demo/       exemples fictifs : petite entreprise (donnees.ts) et entreprise à départements (eti.ts)
  demo/       données fictives + profils de démonstration
  nexus/      liaison au réseau — lecture seule des droits
    droits.ts     miroir validé du contrat GET /v0/droits
    pavillon.ts   apparence du pavillon selon l'état confirmé
    client.ts     client HTTP (passerelle uniquement), tolérant aux pannes (R10)
  config/
    univers.ts    chargement d'un univers et de son héritage
web/          client sans build : app.js (interface), scene.js (Three.js r186, géométries procédurales),
              navigation.js (destinations groupées) et aujourdhui.js (ce qu'« Aujourd'hui » montre) : modules purs, testés
              simplicite.js : quand chaque rubrique entre dans le menu (une seule table de règles), « Tout afficher », notes
              manifest.webmanifest, sw.js, hors-ligne.html : application installable (PWA)
  bz/         système de design Breizhcosystem : bz.css (jetons + polices + base + composants, assemblé),
              tokens.css (copie exacte de design/tokens.css), icones.svg (sprite Lucide), theme.js (script
              classique), typo.js, dialogue.js, toasts.js, palette.js (⌘K et feuille « Plus »), raccourcis.js, annuler.js,
              activite.js (Activité récente), infobulle.js, popover.js, marque.js…
  polices/    Inter 4.1 et Fraunces en sous-ensemble français, Atkinson Hyperlegible Next (OFL)
  licences/   textes complets des licences tierces ; licences.html : « Licences et crédits »
design/       jetons de design, générateur, rapport de contrastes et icônes maison (copie versionnée)
scripts/      paquets.ts (paquets « rien à installer »), icones.ts (icônes PNG via node:zlib),
              ds-synchro.ts (web/bz depuis design/), sprite.ts (icônes), polices.py (sous-ensembles, fontTools)
```

Fait : persistance, comptes locaux, connecteurs dans les deux sens, webhooks authentifiés, sauvegarde/restauration testée.
Fait aussi : paquets « rien à installer » (Node.js inclus) pour Mac, Windows, Linux.
Fait aussi : jeu en ligne sur le serveur de l'entreprise (installation par code, validation en deux étapes, application installable).
Fait aussi : installateur et mises à jour signés hors ligne par l'éditeur, vérifiés par le serveur avant exécution.
À venir : signature des lanceurs (Apple / Windows), écran de réglage de l'univers.

## Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — plans, modules, contrat de connecteur
- [SECURITY.md](SECURITY.md) — exigences et signalement
- [docs/CONNECTEURS.md](docs/CONNECTEURS.md) — ce qui a été comparé aux vrais outils, échéances des outils, limites connues
- [docs/conformite/](docs/conformite/README.md) — RGPD (registre, destinataires, durées, violation, baromètre), AI Act, sécurité organisationnelle
- [design/](design/) — jetons de design, leur générateur et le [rapport de contrastes](design/outils/rapport-contrastes.md)
- [LICENCES-TIERS.md](LICENCES-TIERS.md) — polices, icônes et bibliothèques embarquées, et leurs licences
- [LICENSE](LICENSE) et [NOTICE.md](NOTICE.md) — la licence (GNU AGPL version 3) et sa notice en français

Les repères « LB-… », « R… » et « chap. … » cités dans le code et les documents renvoient au cahier des charges du projet, qui n'est pas dans ce dépôt. De même, « direction de design §… » renvoie à la direction de design de l'éditeur, document interne.

## Licence

Logiciel libre sous licence GNU AGPL version 3 : voir « [Logiciel libre](#logiciel-libre) » en tête de ce fichier, [LICENSE](LICENSE) et [NOTICE.md](NOTICE.md).
