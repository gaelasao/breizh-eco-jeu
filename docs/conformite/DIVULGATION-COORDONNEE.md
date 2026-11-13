# Failles de sécurité : signalement, divulgation coordonnée et notification (CRA)

**Statut : projet de politique de l'éditeur, à valider.** Les délais marqués « proposé » et l'adresse dédiée sont des
décisions de l'éditeur. Ce document ne remplace pas l'avis d'un
juriste sur l'application du règlement (UE) 2024/2847 (« Cyber Resilience Act », CRA) à Living Business.

## 1. Périmètre et cadre

- **Produit** : Living Business, c'est-à-dire le jeu, ses paquets de bureau (Mac, Windows, Linux), l'installateur
  en ligne `installer-jeu.sh` et ses mises à jour signées. Breizhcosystem (autre dépôt) doit reprendre la même politique.
- **CRA** : Living Business est gratuit, mais il est diffusé dans le cadre d'une activité commerciale (le réseau Breizhcosystem
  est payant). C'est donc probablement un « produit comportant des éléments numériques » mis à disposition sur le
  marché, et l'éditeur en est le fabricant. Il ne figure a priori ni à l'annexe III ni à l'annexe IV (catégorie par
  défaut, auto-évaluation). Ces deux points sont **à confirmer par un juriste**.
- **Calendrier** : l'obligation de signaler les vulnérabilités activement exploitées et les incidents graves
  (article 14) s'applique depuis le **11 septembre 2026**. Le reste, notamment les exigences essentielles de
  l'annexe I (dont la partie II : point de contact, politique de divulgation coordonnée, nomenclature logicielle,
  mises à jour de sécurité), la documentation technique et le marquage CE, s'appliquera le **11 décembre 2027**.
- **Ce qui existe déjà dans le code** : publications signées hors ligne, mises à jour vérifiées et automatiques sur
  les serveurs, alerte « correctif de sécurité » dans le jeu, nomenclature `app/SBOM.cdx.json` dans chaque paquet,
  `PROVENANCE.txt` (commit et verrou de chaque version, voir [SECURITE.md](SECURITE.md) § 1).

## 2. Recevoir un signalement

- **Canal provisoire** : l'adresse de contact de l'éditeur publiée sur la page « Mentions légales » de Breizhcosystem
  (`<Breizhcosystem>/mentions-legales`), avec « Sécurité » en objet. Il est donné dans `SECURITY.md`, dans `LISEZMOI.txt` de
  chaque paquet et sur la page « Licences et crédits » du jeu (les trois sont vérifiés par
  `scripts/paquets.test.ts`).
- **À créer** : une adresse dédiée (par exemple une boîte « sécurité » du domaine de
  l'éditeur), puis, sur Breizhcosystem, `/.well-known/security.txt` (RFC 9116) avec `Contact:`, `Expires:` (moins d'un an),
  `Policy:` (lien vers la version publique de ce document), `Preferred-Languages: fr, en` et `Canonical:`. Quand
  l'adresse existe, la reporter dans les trois textes ci-dessus et dans ce document.
- **Ce qui est demandé à la personne qui signale** : version et système concernés, étapes pour reproduire, effet
  observé ; aucune donnée réelle d'une entreprise, aucun mot de passe ; aucun essai sur l'installation d'une autre
  entreprise ni sur Breizhcosystem en production, pas de déni de service ; ne pas rendre la faille publique avant le correctif.
- **Engagement à ne pas poursuivre** une recherche menée de bonne foi dans ces limites : à décider (point 31).

## 3. Traiter (divulgation coordonnée)

Délais proposés (point 31), repris de [SECURITE.md](SECURITE.md) § 3.3 :

| Étape | Délai proposé |
|---|---|
| Accusé de réception à la personne qui signale | 72 heures |
| Évaluation et gravité (grille de SECURITE.md § 3) | 7 jours |
| Correctif publié : gravité critique ou haute | au plus tôt, objectif 30 jours |
| Correctif publié : gravité moyenne | objectif 90 jours |
| Avis public | après la mise à jour des installations, au plus tard 90 jours après le signalement, sauf accord |

1. Inscrire le signalement au registre des incidents ([SECURITE.md](SECURITE.md) § 4), même s'il est écarté.
2. Reproduire, corriger avec un **test de non-régression**, publier une version signée **sous un nouveau numéro**.
3. Retrouver les versions touchées avec les `PROVENANCE.txt` (commit) et `SBOM.cdx.json` (composants) conservés pour
   chaque version publiée.
4. Signaler la version comme correctif de sécurité sur Breizhcosystem (`gravite: "securite"`) : bandeau dans les jeux,
   installation la nuit sur les serveurs à mise à jour automatique.
5. Avis public (bulletin de sécurité, point 15) : versions touchées, version corrigée, gravité, que faire ;
   remerciement de la personne qui a signalé si elle le souhaite. Pour une faille qui touche des installations
   réelles, demander un identifiant CVE à une autorité de numérotation (par exemple MITRE).
6. **Faille dans un composant** (Node.js, three.js, Caddy, une police…) : la signaler à son mainteneur selon sa propre
   politique (article 13, paragraphe 6, du CRA), et publier une version qui embarque le composant corrigé.

## 4. Notifier une vulnérabilité activement exploitée ou un incident grave (CRA, article 14)

**Quand** : l'éditeur a connaissance qu'une vulnérabilité de Living Business est **activement exploitée** (par exemple :
plusieurs serveurs d'entreprises piratés par la même faille), ou d'un **incident grave** qui touche la sécurité du
produit (par exemple : clé de signature des publications volée, Breizhcosystem compromis alors qu'il sert les mises à jour,
voir SECURITE.md § 3.1 et 3.2).

**Où** : la plateforme unique de signalement gérée par l'ENISA, adressée au CSIRT coordinateur de l'État membre où
l'éditeur est établi (pour la France, a priori le CERT-FR de l'ANSSI, à confirmer au moment de la première
notification).

| Notification | Vulnérabilité activement exploitée | Incident grave |
|---|---|---|
| Alerte précoce | 24 heures après en avoir eu connaissance | 24 heures |
| Notification | 72 heures : produit, nature de l'exploitation, mesures correctives ou d'atténuation prises et à prendre par les utilisateurs | 72 heures : nature de l'incident, mesures prises et à prendre |
| Rapport final | au plus tard 14 jours après la mise à disposition d'un correctif ou d'une mesure d'atténuation | 1 mois après la notification |

**Informer les utilisateurs** (article 14, paragraphe 8) sans attendre : entreprises concernées (bandeau
« correctif de sécurité » dans le jeu, page de téléchargement de Breizhcosystem, e-mail aux entreprises reliées à Breizhcosystem),
avec les mesures à prendre.

**Données personnelles** : la notification CRA ne remplace pas la notification à la CNIL. Pour une installation du
jeu, c'est l'entreprise qui est responsable de traitement : l'éditeur la prévient et lui fournit
[VIOLATION-DONNEES.md](VIOLATION-DONNEES.md). Pour Breizhcosystem, l'éditeur notifie lui-même (procédure côté Breizhcosystem).

## 5. Conserver

- Pour chaque version publiée : `PROVENANCE.txt`, `SHA256SUMS.txt` et sa signature, les `SBOM.cdx.json` des
  paquets, et la version GitHub correspondante. Durée : à partir du 11 décembre 2027, la documentation technique se
  garde au moins 10 ans après la mise sur le marché ou pendant la période de support si elle est plus longue.
- **Période de support** (durée pendant laquelle des correctifs de sécurité sont garantis, en principe au moins
  5 ans) : à décider et à afficher (point 32).
