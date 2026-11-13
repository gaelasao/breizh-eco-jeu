# Procédure en cas de violation de données personnelles

Articles 33 et 34 du RGPD. Une violation est une destruction, une perte, une altération, une divulgation ou un accès
non autorisé à des données personnelles, accidentel ou volontaire (ex. ordinateur volé, serveur piraté, sauvegarde
envoyée à la mauvaise personne, clé d'API divulguée, outil branché compromis).

Deux cas : la violation touche **l'installation de l'entreprise** (l'entreprise est responsable et notifie), ou elle
touche **la chaîne de l'éditeur** (Breizhcosystem, clé de signature, relais de connexion) : l'éditeur prévient alors chaque
entreprise concernée sans délai (voir [SECURITE.md](SECURITE.md)) et chacune applique la procédure ci-dessous.

## 1. Dans l'heure : contenir

- Couper l'accès en cause : désactiver le compte, **révoquer la clé d'API** (Réglages → Clés d'API, effet immédiat), délier Breizhcosystem, désactiver le connecteur, ou couper le service (`sudo systemctl stop living-business`).
- Changer les secrets exposés : mot de passe des comptes concernés (les sessions tombent), jetons des outils branchés (dans l'outil lui-même), « Se reconnecter » pour les connexions en un clic.
- Serveur suspect : ne pas l'effacer tout de suite (traces utiles) ; faire une copie du dossier des données et du journal système (`journalctl -u living-business`, `journalctl -u caddy`) ; ne **pas** lancer de mise à jour tant que la signature de l'éditeur n'est pas confirmée.
- Noter l'heure de découverte : le délai de 72 heures court à partir de là.

## 2. Sous 24 heures : comprendre

- Quelles données ? (fiches de quel type, salariés, motifs d'absence, contacts, réponses au baromètre, secrets.)
- Combien de personnes ? Depuis quand ?
- Sources dans le jeu : **journal d'activité** (qui a fait quoi, synchronisations : `GET /api/v1/journal` avec une session d'administrateur, 200 entrées par page, `?page=2` pour les précédentes, 5 000 entrées gardées) et **journal de sécurité** (`GET /api/v1/journal?genre=securite` : exports et restaurations, clés d'API, accès, comptes, liaison au réseau, effacements, gardés 12 mois à part : l'activité courante ne les chasse pas), historique de chaque connecteur (Réglages → Outils branchés), dernière utilisation de chaque clé d'API (Réglages → Clés d'API), journaux du serveur.
- Les données étaient-elles chiffrées (copie hors serveur chiffrée, secrets chiffrés) et la clé est-elle restée sûre ?

## 3. Sous 72 heures : notifier la CNIL (sauf risque improbable)

- Notification en ligne sur le site de la CNIL (téléservice « Notifier une violation de données »), par le responsable du traitement (l'entreprise). Si toutes les informations ne sont pas connues, notifier quand même puis compléter.
- Contenu : nature de la violation, catégories et nombre approximatif de personnes et d'enregistrements, contact, conséquences probables, mesures prises.
- Pas de notification seulement si le risque pour les personnes est **improbable** (ex. sauvegarde chiffrée perdue, phrase restée secrète) : le justifier dans le registre (point 5).

## 4. Sans délai si le risque est élevé : informer les personnes

- Exemples de risque élevé : motifs d'absence « maladie » divulgués, commentaires du baromètre rendus publics, coordonnées de clients exposées avec des informations bancaires ou d'encours.
- Message clair : ce qui s'est passé, données concernées, conséquences possibles, ce que fait l'entreprise, ce que la personne peut faire, contact.

## 5. Toujours : tenir le registre des violations

Même sans notification (art. 33.5). Modèle :

| Date de découverte | Date de la violation | Description | Données et personnes | Conséquences | Mesures | Notifiée à la CNIL (date, ou motif de non-notification) | Personnes informées |
|---|---|---|---|---|---|---|---|
| | | | | | | | |

## 6. Après : corriger

- Corriger la cause (droits trop larges, clé partagée, outil compromis, mise à jour en retard), puis vérifier par une restauration de sauvegarde si des données ont été altérées.
- Faille dans Living Business lui-même : la signaler à l'éditeur par la voie de `SECURITY.md` (sans la rendre publique).
