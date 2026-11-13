# Contre-revue de l’audit — Living Business

> Les empreintes de commits citées ici renvoient à l'historique d'avant la publication du code, qui n'est pas public.

État au 11 novembre 2026. Après les corrections de l’audit (sécurité, RGPD, IA), un second relecteur a cherché les
corrections incomplètes, les contournements et les oublis. Un contradicteur a ensuite essayé de réfuter chaque constat :
les 11 ont tenu (reproduits par un essai). **Les 11 sont corrigés**, chacun avec un essai de non-régression.

## Corrigés

- **revue-jeu-1-1** (moyenne) — Baromètre « réellement anonyme » : la direction isolait la réponse d'une seule personne en remplissant elle-même 4 liens. Un seul lien par fiche et par 30 jours, aucun pour une fiche créée depuis moins de 30 jours, commentaires à partir de 10 réponses ; la limite qui reste est dite aux salariés — commit `ae52a19`.
- **revue-jeu-1-2** (moyenne) — Lien « faible » par homonymie : l'inconnu remplissait les champs vides de la vraie fiche, puis recevait ses données. Tant qu'un administrateur n'a pas confirmé (ou qu'un e-mail ou un SIRET n'est pas égal des deux côtés), rien ne part vers l'outil et il n'inscrit ni e-mail, ni contact, ni SIRET, ni adresse — commit `24a1986`.
- **revue-jeu-1-3** (moyenne) — Motif « maladie » réservé au droit RH, mais lisible par tout profil qui voit le score de santé (critère Absences maladie) — commit `a1f6be0`.
- **revue-jeu-1-4** (moyenne) — Journal d'audit effaçable par volume : 5000 lignes au plus (200 affichées), une clé d'API efface la trace d'un export complet et de sa propre création en 2 secondes — commit `76af32b`.
- **revue-jeu-1-5** (basse) — Déni de service sur la connexion : 5 mauvais mots de passe par identifiant bloquent le vrai titulaire, même avec le bon mot de passe — commit `0b6daf7`.
- **revue-jeu-1-6** (basse) — Droit à l'effacement : le registre des effacements n'était ni dans la copie hors serveur ni dans l'export. Il est recopié avec les sauvegardes (`registre-effacements.jsonl`) et rejoué sur un autre serveur — commit `f96c38c`.
- **revue-jeu-1-7** (basse) — « Commander » depuis le jeu n'envoyait pas le prix vu : le jeu envoie désormais le prix affiché à la personne, avec une clé d'idempotence par validation — commit `11418d8`.
- **revue-jeu-1-8** (basse) — Une clé d'API peut acquitter les avis de sécurité d'un administrateur et couper la vérification des nouvelles versions — commit `ca78c6a`.
- **revue-jeu-1-9** (basse) — Restauration complète sans nouvelle preuve d'identité, alors que l'export l'exige désormais — commit `2ea10d5`.
- **revue-jeu-1-10** (basse) — Notice du baromètre : « rien n'est envoyé à l'éditeur », alors que la note du climat partait vers Breizhcosystem. Les trois notes tirées du baromètre ne partent plus jamais ; domaine social et note globale recalculés sans elles — commit `1782282`.
- **revue-jeu-1-11** (basse) — Seuil de 11 personnes pour les notes sociales : les fiches anonymisées d'anciens salariés étaient comptées. Seules les personnes en poste comptent — commit `1782282`.

### Entre le jeu et le réseau

- « Débrancher » un outil relié par « Se connecter avec… » prévient désormais le relais du réseau
  (`POST /v0/oauth/revoquer`), qui cesse de renouveler la connexion et la révoque chez l'outil quand il faut le secret
  de l'application (Pipedrive, Notion) ; Shopify se désinstalle de la boutique ; Google et HubSpot restent révoqués
  directement — commit `9c1bf2f` (revue-reseau-11). Ce qui ne se révoque pas d'ici est écrit dans
  [SECURITE.md](SECURITE.md).

## Limites connues après ces corrections

- **Baromètre** : la direction crée et transmet les liens. Elle ne voit ni qui a répondu ni une réponse seule, mais
  rien n'empêche techniquement quelqu'un qui détient un lien de répondre à la place de son destinataire. Seul l'envoi
  des liens par le serveur le ferme : décision de l'éditeur.
- **Fiche créée depuis moins de 30 jours** : sa date de création est lue dans le journal d'activité (5 000 dernières
  lignes) ; une fiche créée par un import massif très ancien n'est pas concernée.
- **Rapprochements existants** : les liens par homonymie posés avant cette correction attendent eux aussi une
  confirmation (Réglages › Outils branchés › « Vérifier ») ; d'ici là, ces fiches ne partent plus vers l'outil.
- **Registre des effacements et copie exportée** : avec un fichier `.lbsauv` restauré sur un autre serveur, le
  registre doit être joint à la main (l'écran le propose) ; avec la copie hors serveur, il suit tout seul.
