# Registre des traitements — modèle pour l'entreprise qui utilise Living Business

Article 30 du RGPD. **Responsable du traitement : l'entreprise qui installe Living Business** (raison sociale,
adresse, représentant, et délégué à la protection des données s'il y en a un : à compléter par elle). L'éditeur n'a
pas accès à ces données (voir [README.md](README.md)).

Chaque fiche ci-dessous décrit ce que le **code** fait. Les cases « à compléter » dépendent de l'usage de l'entreprise.
Durées : voir [DUREES-CONSERVATION.md](DUREES-CONSERVATION.md). Destinataires extérieurs : voir
[SOUS-TRAITANTS-TRANSFERTS.md](SOUS-TRAITANTS-TRANSFERTS.md).

Mesures de sécurité communes à toutes les fiches (détail dans `SECURITY.md` et [SECURITE.md](SECURITE.md)) : données
dans un seul dossier (`LB_DONNEES`, fichiers 0600), secrets chiffrés au repos (AES-256-GCM), mots de passe hachés
scrypt, sessions de 8 h, validation en deux étapes obligatoire pour les administrateurs en ligne, droits par profil
contrôlés côté serveur à chaque requête, journal des actions, sauvegardes locales quotidiennes (copie hors serveur
chiffrée côté client si l'entreprise l'active), HTTPS et service isolé quand le jeu est en ligne.

---

## T1 — Comptes des utilisateurs de Living Business

- **Finalité** : permettre aux personnes de l'entreprise de se connecter, avec les droits de leur profil.
- **Base légale** : intérêt légitime de l'entreprise (art. 6.1.f) à sécuriser son outil de gestion ; exécution du contrat de travail.
- **Personnes** : dirigeants, salariés, prestataires invités.
- **Données** : identifiant, profil et droits, empreinte du mot de passe (scrypt), empreinte du code de secours, secret de validation en deux étapes (chiffré) et codes de récupération (empreintes), date de création et de dernière connexion, statut.
- **Destinataires** : administrateurs de l'entreprise. Aucun destinataire extérieur.
- **Durée** : tant que le compte existe ; désactivation et suppression par un administrateur (à compléter : délai après départ de la personne).

## T2 — Clients, prospects, fournisseurs et partenaires (fiches « tiers »)

- **Finalité** : gestion commerciale et relation client ou fournisseur (fiches, commandes, encours, tâches).
- **Base légale** : exécution des contrats (art. 6.1.b) ; intérêt légitime pour la prospection B2B (art. 6.1.f).
- **Personnes** : contacts des clients et fournisseurs ; clients particuliers et entrepreneurs individuels.
- **Données** : nom, raison sociale, SIRET, ville, département, nom du contact, e-mail, encours et limite d'encours, commandes, historique des actions. Données venues des outils branchés (T7) selon la correspondance de champs choisie.
- **Destinataires** : profils de l'entreprise qui voient ce type de fiche ; outils branchés « dans les deux sens » (T7) ; Breizhcosystem seulement pour ce que l'administrateur partage (T10 : jamais de nom de contact).
- **Durée** : à fixer par l'entreprise (repère CNIL : 3 ans après le dernier contact pour un prospect ; durée de la relation puis durées légales pour un client). **Aucune purge automatique dans le jeu**.

## T3 — Salariés et planning des équipes

- **Finalité** : organisation du travail (qui est où, affectations, besoins d'effectif), annuaire interne.
- **Base légale** : exécution du contrat de travail (art. 6.1.b) ; obligations légales de l'employeur (art. 6.1.c).
- **Personnes** : salariés, intérimaires, apprentis.
- **Données** : nom, poste, équipe, lieu, département, e-mail, disponibilité ; planning jour par jour (lieu, projet, mission, ou motif d'absence : « congé », « maladie », « formation »).
- **Point d'attention** : le motif « maladie » est une **donnée relative à la santé** (art. 9). Il ne contient aucun diagnostic (liste fermée : congé, maladie, formation). **Restriction en place** : seuls les profils qui ont le droit RH « Voir et saisir les motifs d'absence » (Réglages › Accès et visibilité ; par défaut, les administrateurs) voient et saisissent le motif ; les collègues qui voient le planning lisent « Absence ». Le journal d'activité n'écrit jamais le motif. Le critère « Absences maladie » du score de santé n'est vu que des profils « Voir le score » (taux global, jamais par personne) ; il ne part vers Breizhcosystem qu'à partir de 11 personnes.
- **Information des salariés** : [NOTICE-PLANNING-SALARIES.md](NOTICE-PLANNING-SALARIES.md).
- **Destinataires** : profils autorisés de l'entreprise ; Breizhcosystem seulement le **nombre** de personnes disponibles par jour si l'administrateur coche « Capacité disponible » (jamais de nom).
- **Durée** : durée du contrat de travail ; planning passé (absences et motifs compris) effacé automatiquement après la durée choisie par l'entreprise dans le jeu (6 mois, 1, 2 ou 3 ans ; aucune par défaut, voir [DUREES-CONSERVATION.md](DUREES-CONSERVATION.md)).
- **Analyse d'impact** : voir [ANALYSE-AIPD.md](ANALYSE-AIPD.md) (motifs d'absence, assistant d'IA branché sur le planning).

## T4 — Baromètre d'équipe (collaborateurs)

- **Finalité** : mesurer le climat de l'équipe et la charge de travail, de façon anonyme.
- **Base légale** : intérêt légitime de l'employeur (art. 6.1.f), santé et sécurité au travail ; réponse **facultative**.
- **Personnes** : salariés invités.
- **Données** : note de bien-être, charge ressentie, commentaire libre facultatif, département, **mois** de réception. Jamais le nom, ni l'heure, ni le lien avec l'invitation (le code ne les garde pas). L'invitation ne garde que le département, les dates d'envoi et d'expiration, et le mois d'utilisation.
- **Anonymat technique** : réponses dans un magasin à part (jamais un objet du monde, jamais au journal, jamais dans l'API des fiches ni le MCP), publiées par lots d'au moins 5 réponses (équipe ; et chaque département), commentaires sans département et datés au mois, ordre aléatoire, lien muet sur son utilisation. Comme les réponses ne sont pas reliées à une personne, les droits d'accès et d'effacement ne peuvent pas s'exercer sur une réponse précise (art. 11).
- **Destinataires** : direction et profils qui voient le baromètre : **résultats regroupés seulement**.
- **Durée** : 400 jours (13 mois) puis effacement automatique.
- **Information** : page du formulaire (« Qui voit quoi ? ») et [NOTICE-BAROMETRE-SALARIES.md](NOTICE-BAROMETRE-SALARIES.md) ; consultation du CSE s'il existe.

## T5 — Satisfaction des clients (avis)

- **Finalité** : mesurer la satisfaction et rappeler les clients mécontents.
- **Base légale** : intérêt légitime (art. 6.1.f) ; réponse facultative.
- **Personnes** : clients invités par un lien personnel.
- **Données** : note, recommandation, commentaire, date, client concerné.
- **Destinataires** : profils de l'entreprise qui voient les clients.
- **Durée** : choisie par l'entreprise dans le jeu (6 mois, 1, 2 ou 3 ans, puis effacement automatique ; aucune par défaut, voir [DUREES-CONSERVATION.md](DUREES-CONSERVATION.md)) ; l'invitation est gardée 400 jours.
- **Information** : le formulaire public affiche, avant la réponse, une notice repliable (responsable, but, données gardées et rattachées à la fiche client, qui les voit, durée réglée, caractère facultatif, droits, CNIL). Texte et points à compléter : [MODELE-MENTION-FORMULAIRES.md](MODELE-MENTION-FORMULAIRES.md).

## T6 — Courrier collé et tâches

- **Finalité** : trier un e-mail collé dans le jeu (bac, urgence, destinataire, action) et créer des tâches.
- **Données** : texte du mail collé, expéditeur, objet ; tâches. Tri par mots-clés, **sans IA**, rien ne sort du serveur.
- **Durée** : à fixer par l'entreprise.

## T7 — Connecteurs (synchronisation avec les outils de l'entreprise)

- **Finalité** : lire et, si l'entreprise le choisit, écrire les fiches dans ses outils (CRM, comptabilité, tableur, boutique, webhook, MCP…).
- **Données** : celles des fiches concernées (T2, T3), selon la correspondance de champs choisie ; secrets de connexion chiffrés.
- **Destinataires** : les éditeurs de ces outils, choisis par l'entreprise (ses sous-traitants : voir [SOUS-TRAITANTS-TRANSFERTS.md](SOUS-TRAITANTS-TRANSFERTS.md)).
- **« Se connecter avec… »** : les jetons passent par le relais de l'éditeur (sous-traitant : [CONDITIONS-RELAIS-CONNEXION.md](CONDITIONS-RELAIS-CONNEXION.md)) ; le relais n'est contacté qu'au clic ; le jeu ne demande que la **lecture** sauf synchro qui écrit ; information affichée avant le bouton et dans Réglages › Confidentialité.
- **Temps réel** (jeu relié à Breizhcosystem) : les avis des outils passent par Breizhcosystem, qui ne les garde pas et ne pousse au jeu que « tel branchement a changé » ; le jeu crée lui-même les abonnements chez l'outil et relit l'outil directement ([CONDITIONS-RELAIS-CONNEXION.md](CONDITIONS-RELAIS-CONNEXION.md) §3 bis). HubSpot et Pipedrive mettent une partie des données changées dans leurs avis.
- **Garanties du code** : une fiche tenue par un outil n'est jamais rattachée à l'enregistrement homonyme d'un autre outil ; un rattachement par le nom ne fait que compléter les champs vides ; un secret enregistré ne part jamais vers une autre adresse ni un autre outil ; réglages interdits aux clés d'API.

## T8 — Journal d'activité (sécurité et traçabilité)

- **Finalité** : savoir qui a fait quoi (création, modification, synchronisation, connexion).
- **Base légale** : intérêt légitime (sécurité, art. 32).
- **Données** : date et heure, acteur (profil ou système), **canal** (clé d'API qui a agi, absent pour une personne à l'écran), action, fiche concernée, court détail. Pas de contenu des réponses au baromètre, jamais le motif d'une absence. Création et révocation des clés d'API (`cle.creee`, `cle.revoquee`), avec le compte de la personne.
- **Durée** : les 5 000 dernières entrées pour l'activité courante ; les **événements de sécurité** (exports et restaurations, clés d'API, accès et profils, comptes, liaison et partage avec le réseau Breizhcosystem, avis de sécurité, effacements, purges) sont gardés à part pendant **12 mois**, pour que l'activité ne les chasse pas (voir [DUREES-CONSERVATION.md](DUREES-CONSERVATION.md)).

## T9 — Clés d'API et assistants (MCP, Make, Zapier, n8n, scripts)

- **Finalité** : permettre à un outil ou un assistant choisi par l'entreprise d'agir avec les droits d'un profil.
- **Données** : nom de la clé, profil, empreinte de la clé, date de création, compte de la personne qui l'a créée, date de dernière utilisation ; données lues ou modifiées par l'outil selon les droits du profil.
- **Garde-fous** : une clé ne prend jamais une décision réservée à une personne (achats et engagements Breizhcosystem, liaison et partage Breizhcosystem, clés, accès, automatisations, export, restauration, approbation d'une action) ; les modifications de fiche, tâches et mouvements de stock qu'elle demande attendent l'approbation d'une personne et gardent la clé qui les a demandés ; tout ce qu'elle fait est au journal avec son nom (T8) ; le profil administrateur n'est jamais proposé par défaut pour une nouvelle clé.
- **Point d'attention** : un assistant d'IA branché par MCP reçoit les données que le profil voit (voir [IA.md](IA.md)). Choisir un profil limité.

## T10 — Partage avec Breizhcosystem (facultatif)

- **Finalité** : trouver des solutions dans le réseau (réassort, location, renfort, surstocks), se comparer anonymement.
- **Base légale** : intérêt légitime de l'entreprise ; **accord explicite de l'administrateur dans le jeu**, catégorie par catégorie.
- **Ce qui peut partir** : secteur d'activité ; besoins (nom d'article et quantité, équipement à louer, « Renfort : N personnes — secteur, projet en cours » sans nom de projet, de lieu ni de client) ; surstocks (article, quantité) ; nombre de personnes disponibles par jour (jamais de nom) ; notes de santé sur 100 (jamais de montant). Données d'exemple jamais envoyées.
- **Notes de santé et petites équipes** : Breizhcosystem garde ces notes **rattachées à l'entreprise** (pseudonymes, pas anonymes pour l'éditeur ; les autres membres ne voient que des moyennes par groupes d'au moins 10). Sous **11 personnes**, aucune note du domaine social ne part (absences maladie, baromètre, formation, planning), et la note globale envoyée est recalculée sans ce domaine : une note d'absentéisme dans une équipe de deux révélerait un arrêt maladie.
- **Rien ne part** : tant que l'administrateur n'a rien coché dans le jeu ; après une nouvelle liaison ou une déliaison.
- **Destinataire** : Breizhcosystem (éditeur), puis les membres du réseau pour les besoins et surstocks.
- **Envoi** : manuel (« Envoyer maintenant »), puis automatique (1 min après un changement, toutes les 30 min) seulement après cet accord ; « Voir ce qui partirait » montre l'envoi mot pour mot avant tout accord.

## T11 — Alerte Bodacc (facultatif)

- **Finalité** : prévenir quand un client fait l'objet d'une procédure collective publiée au Bodacc.
- **Données envoyées** : les SIREN des clients seulement, à `bodacc-datadila.opendatasoft.com` (données publiques de la DILA), après activation par l'entreprise.

## T12 — Sauvegardes

- **Finalité** : pouvoir restaurer après une panne ou une erreur.
- **Données** : copie complète des données du jeu.
- **Durée** : 30 copies quotidiennes sur le serveur ; copie chiffrée hors du serveur (72 dernières heures envoyées chaque nuit) si l'entreprise l'active, effacée dans le stockage après 31 jours (purge automatique chaque nuit par le serveur, ou, en stockage verrouillé — Object Lock, clé sans droit d'effacement —, par la règle de cycle de vie du conteneur, à créer par l'entreprise).

## Droits des personnes (articles 15 à 17) — outils du jeu

- **Accès** : fiche › Données personnelles › « Télécharger ses données » (`GET /api/v1/objets/:id/donnees`) : champs,
  planning, actions, traces du journal, fiches qui y renvoient, formulaires envoyés (dates). Administrateurs.
- **Rectification** : « Modifier la fiche ».
- **Effacement** : « Effacer la fiche » ou « Anonymiser » (`DELETE /api/v1/objets/:id`, depuis l'écran seulement,
  jamais avec une clé d'API). Cascade décrite dans [DUREES-CONSERVATION.md](DUREES-CONSERVATION.md). Les sauvegardes
  l'oublient en 30 jours (31 pour la copie hors serveur) ; une restauration rejoue l'effacement — sur un autre
  serveur aussi, à condition d'y joindre le registre des effacements rangé avec les sauvegardes
  (`registre-effacements.jsonl`). Si la fiche venait
  d'un outil branché, l'écran nomme l'outil : l'effacement y reste à faire par l'entreprise.
- **Journalisation** : effacements (`objet.efface`, `objet.anonymise`), purges (`conservation.purge`) et exports
  complets (`sauvegarde.exportee`) sont inscrits au journal, sans nom de personne.
