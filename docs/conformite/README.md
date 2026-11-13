# Conformité de Living Business (logiciel libre et gratuit)

Ces documents décrivent ce que fait réellement le code de ce dépôt (`breizh-eco-jeu`) et aident l'entreprise qui
l'installe à tenir ses propres obligations. Ils ne remplacent pas un conseil juridique. Les informations que seul
l'éditeur peut fixer (identité légale, contacts, décisions commerciales) ne sont **pas** inventées ici : elles relèvent
d'un document interne de l'éditeur.

## Qui est responsable de quoi ?

| Situation | Responsable du traitement | Rôle de l'éditeur (Breizhcosystem) |
|---|---|---|
| Living Business installé sur l'ordinateur ou le serveur de l'entreprise (cas général) | **L'entreprise** : elle choisit les données saisies, les outils branchés, qui y accède | **Aucun accès** aux données : ni compte, ni télémétrie, ni copie. L'éditeur fournit un logiciel ; il n'est pas sous-traitant pour ces données. |
| Mises à jour (`sudo living-business-mise-a-jour`, chaque nuit si l'entreprise l'a accepté, paquets téléchargés) | L'entreprise décide (à la main, ou mises à jour automatiques acceptées à l'installation) | Fournit des publications **signées hors ligne** ; le serveur de l'entreprise vérifie la signature avant d'exécuter quoi que ce soit (voir [SECURITE.md](SECURITE.md)). Le jeu lit la liste publique des versions sur Breizhcosystem pour prévenir d'un correctif, sans rien envoyer. |
| « Se connecter avec… » (HubSpot, Google, Microsoft…) | L'entreprise (elle autorise l'accès à ses outils) | **Sous-traitant** : le relais Breizhcosystem de l'éditeur voit passer les **jetons** au moment de la connexion et de chaque renouvellement, sans les garder ; les données ne passent jamais par Breizhcosystem. Contacté seulement au clic ; lecture seule demandée par défaut. Clauses : [CONDITIONS-RELAIS-CONNEXION.md](CONDITIONS-RELAIS-CONNEXION.md). |
| Partage vers Breizhcosystem (réseau payant, facultatif) | L'entreprise pour l'envoi ; l'éditeur pour Breizhcosystem | Rien ne part tant que l'administrateur n'a pas coché une catégorie **dans le jeu**. Ce qui part est décrit dans [REGISTRE-TRAITEMENTS.md](REGISTRE-TRAITEMENTS.md) (T10). |
| Un prestataire installe ou maintient le serveur pour l'entreprise | L'entreprise | Le prestataire est **sous-traitant** de l'entreprise : voir [CONTRAT-SOUS-TRAITANCE-TYPE.md](CONTRAT-SOUS-TRAITANCE-TYPE.md). |

## Documents

- [REGISTRE-TRAITEMENTS.md](REGISTRE-TRAITEMENTS.md) — modèle de registre (art. 30 RGPD) pré-rempli d'après le code, à compléter par l'entreprise.
- [SOUS-TRAITANTS-TRANSFERTS.md](SOUS-TRAITANTS-TRANSFERTS.md) — qui reçoit quoi (outils branchés, hébergeur, Breizhcosystem, services publics), transferts hors UE.
- [DUREES-CONSERVATION.md](DUREES-CONSERVATION.md) — durées appliquées par le code, celles que l'entreprise règle dans le jeu, effacement d'une fiche.
- [VIOLATION-DONNEES.md](VIOLATION-DONNEES.md) — procédure en cas de violation de données (art. 33 et 34 RGPD), avec le modèle de registre des violations (art. 33.5).
- [NOTICE-BAROMETRE-SALARIES.md](NOTICE-BAROMETRE-SALARIES.md) — information des salariés pour le baromètre d'équipe, et consultation du CSE.
- [CONTRAT-SOUS-TRAITANCE-TYPE.md](CONTRAT-SOUS-TRAITANCE-TYPE.md) — clauses art. 28 pour un prestataire qui installe ou maintient le serveur.
- [CONDITIONS-RELAIS-CONNEXION.md](CONDITIONS-RELAIS-CONNEXION.md) — information et clauses art. 28 du relais « Se connecter avec… » (projet, à publier par l'éditeur).
- [NOTICE-PLANNING-SALARIES.md](NOTICE-PLANNING-SALARIES.md) — information des salariés pour le planning (motifs d'absence réservés aux RH).
- [MODELE-MENTION-FORMULAIRES.md](MODELE-MENTION-FORMULAIRES.md) — notice affichée sur les formulaires publics (avis clients, baromètre), et ce que l'entreprise doit compléter.
- [ANALYSE-AIPD.md](ANALYSE-AIPD.md) — faut-il une analyse d'impact (art. 35) ? Critères appliqués au planning, au baromètre et à un assistant d'IA branché.
- [IA.md](IA.md) — Living Business et le règlement européen sur l'IA (AI Act).
- [SECURITE.md](SECURITE.md) — sécurité organisationnelle, clé de signature, procédure d'incident.
- [DIVULGATION-COORDONNEE.md](DIVULGATION-COORDONNEE.md) — signaler une faille, la traiter, la rendre publique, et la notifier au titre du règlement européen sur la cyberrésilience (CRA, article 14).
- [`LICENSE`](../../LICENSE) et [`NOTICE.md`](../../NOTICE.md) — Living Business est un logiciel libre : texte officiel de la licence GNU AGPL version 3 (en anglais, seul à faire foi) et notice en français (résumé, absence de garantie, marques, données, services liés, code source), joints aux paquets et affichés dans le jeu (`/licences/agpl-3.0.txt`, `/licence.html`).

Mise à jour : 12 novembre 2026 (lots de corrections 1 à 8 du jeu ; passage à la licence GNU AGPL version 3).
