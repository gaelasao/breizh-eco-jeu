# Ce qui reste de la liste du 19 novembre 2026

Écrit pendant que tu dormais, pour que tu saches où on en est sans relire la conversation.
Dernière version publiée et installée : **0.12.26**. 1033 essais passent.

## Fait aujourd'hui

| Ce que tu avais demandé | Où c'est |
|---|---|
| Google Drive (déposer, relire) | Connecteurs › Google |
| Google Docs (lire, enrichir) | Connecteurs › Google |
| Fusion des entrées Google | une seule carte au lieu de trois |
| Microsoft To Do ouvert | relais |
| Prospects (relance et suivi) | Relations › Prospects |
| Demandes clients (appel → RDV → devis) | Relations › Demandes clients |
| Import CSV/Excel en mise à jour | Importer un fichier |
| Suivi de chantier (budget / réel / écart) | fiche d'un chantier |
| Indemnités kilométriques | fiche d'un véhicule (univers Services) |
| Catégorie sur les justificatifs | Saisir › photo d'un justificatif |
| Réception et rapprochement du BL | Commandes › Réceptions |
| Lignes de commande (quantités comptées) | Commandes › Lignes de commande |
| Stock par Telegram (« sortie 3 » + boutons) | Réglages › Alertes › Telegram |
| Autoriser les personnes du robot une par une | Réglages › Alertes › Qui peut écrire au robot |

## Ce que j'attends de toi (ce sont des règles, pas du code)

1. **Seuils de montant** pour décider RDV physique / téléphone / simple mail. Donne-moi les deux bornes.
2. **L'acompte de 30 %** : il vit où ? Un champ sur le devis, ou une facture d'acompte à part ? Et l'alerte se
   déclenche combien de jours après l'acceptation du devis ?
3. **Le fichier Excel de Camille** (planning, heures) : un exemplaire, même anonymisé, et je sais quoi en faire.

## Ce qui n'est pas fait, et pourquoi

- **Planification RH et programmation à six mois** — dépend du point 3 ci-dessus.
- **Envoi automatique des facturettes au comptable le X du mois** — l'export existe déjà (Saisir › exporter) ;
  l'envoi par mail depuis le poste demande de décider par où il passe. À faire ensemble.
- **Interface bancaire** — gros, et réglementé (il faut passer par un agrégateur agréé, avec un coût récurrent).
  À décider avant d'écrire une ligne.
- **Page « avant chantier : quel chantier, quel matériel »** — se greffera sur le robot Telegram maintenant qu'il
  sait poser des boutons.

## Ce qui n'a jamais tourné contre un vrai service

- Le stock par Telegram et l'autorisation des personnes sont couverts par des essais qui **simulent** Telegram.
  La boucle qui lit les boutons (`callback_query`) et l'accusé de réception n'ont jamais parlé au vrai service.
  Il faut ton robot, ta conversation et un téléphone pour le dire.
- Les connecteurs Google (Drive, Docs) et Microsoft To Do démarrent correctement (hôte et portées vérifiés), mais
  **aucun compte n'a été branché pour de vrai** : le consentement, c'est ton compte, pas le mien.

## Une case à cocher sur TON installation

Réglages › Alertes › **« Une réception qui ne concorde pas »**. Elle est cochée par défaut pour les installations
neuves, mais tes réglages sont déjà enregistrés et je ne les écrase pas.
