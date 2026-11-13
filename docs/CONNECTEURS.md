# Connecteurs : ce qui a été comparé aux vrais outils

État au 12 novembre 2026.

## Ce qui a été fait, et ce qui ne l'a pas été

Jusqu'au 11 novembre 2026, chaque connecteur n'avait été essayé que contre un outil **simulé** par les essais du dépôt.
Les 11 et 12 novembre, chacun a été comparé, ligne à ligne, à la **documentation officielle** de son outil : adresses,
en-têtes, pagination, noms des champs lus, forme des écritures, droits demandés, arrêts annoncés.

**Rien n'a été essayé avec un vrai compte** : aucune application n'est déclarée chez les outils et le projet n'a aucun
identifiant réel. Seules les API publiques sans clé (BODACC) ont été interrogées pour de vrai. Tant qu'un essai avec un
compte de test n'a pas été fait pour un outil, « conforme » veut dire « conforme à la documentation ».

Le jeu et le réseau, eux, se parlent pour de vrai dans `src/passerelle/bout-en-bout-reseau.test.ts` (liaison, partage,
commande, paiement, suspension, « Se connecter avec… »). Ces essais ont besoin des sources du réseau (non publiques) dans le dossier
voisin : ils sont sautés dans la CI et se lancent sur le poste de l'éditeur avec `npm test`.

## État par outil

| Outil | État | Ce qui a changé |
|---|---|---|
| Airtable | conforme | — |
| Notion | corrigé | Version d'API 2026-03-11 : une base à plusieurs tableaux (« sources de données ») échouait. Chaque tableau est proposé sur sa ligne ; un branchement déjà enregistré lit le plus ancien tableau et le dit. |
| HubSpot | conforme, notice corrigée | HubSpot ne laisse plus créer d'application privée (26 octobre 2026) : la notice parle des clés de service. |
| Pennylane | conforme | — |
| Qonto | conforme | — |
| Odoo | conforme, notice corrigée | Forfait « Custom » exigé sur Odoo en ligne ; clé d'API de trois mois au plus. Voir les échéances. |
| Pipedrive | conforme | — |
| Shopify | conforme | Version 2026-10. Par « Se connecter avec… » : jetons qui expirent (1 h), renouvelés par le relais. |
| Axonaut | conforme | — |
| Stripe (clients, factures) | corrigé | Le shilling ougandais s'écrit sur deux décimales. |
| WooCommerce | conforme | — |
| PrestaShop | conforme | — |
| Sellsy | conforme, notice corrigée | L'accès API doit être de type « Personnel ». |
| Google Sheets | conforme | — |
| Excel Microsoft 365 | corrigé | OneDrive personnel refusé d'emblée (Microsoft n'y ouvre pas l'API Excel). La liste « partagés avec moi » est retirée (service arrêté par Microsoft en novembre 2026) : un classeur partagé se relie par son lien. |
| Dynamics 365 Sales | conforme | — |
| Business Central | corrigé | Le solde d'un client se lit dans `balanceDue` : la colonne restait vide. |
| Make, Zapier, n8n (webhook) | conforme, notice corrigée | Zapier : « Catch Raw Hook » pour voir la signature. n8n : nœud Webhook en POST. |
| API REST | corrigé | Une écriture réussie dont la réponse n'est pas du JSON n'est plus prise pour un échec (elle était retentée : doublons). Identifiant d'une création lu aussi dans l'en-tête `Location`. |
| MCP (serveur `/mcp`, client, pont pour Claude Desktop) | corrigé | La norme a changé le 28 juillet 2026 (plus de poignée de main, version et en-têtes à chaque requête). Les deux générations sont servies et parlées. Le pont répond toujours par un message valide, même quand le serveur refuse. |
| BODACC | corrigé | Les annonces au-delà de la centième d'un lot de clients sont lues. |

« Se connecter avec… » (relais du réseau) : HubSpot passe à l'API de jetons datée, et sa révocation se fait par le
relais ; Notion est renouvelé et vraiment révoqué au débranchement ; Shopify reçoit des jetons qui expirent ; Microsoft
n'accepte que les comptes professionnels.

## Échéances à surveiller

| Quand | Quoi | État |
|---|---|---|
| 16 février 2027 | HubSpot arrête son ancienne API de jetons (v1). | Fait : le relais utilise la version 2026-03. La révocation directe de secours s'éteint seule à cette date (`FIN_HUBSPOT_V1`). |
| 1er janvier puis 1er avril 2027 | Shopify déliste puis refuse les applications publiques sans jetons expirants. | Fait. |
| Septembre 2027 | HubSpot ne corrige plus ses API CRM v1 à v3 (pas d'arrêt annoncé). | À faire : passer aux versions datées du CRM. |
| 16 octobre 2027 | Shopify ne sert plus la version 2026-10 de son API. | À faire avant : relever `VERSION_SHOPIFY` (une version par trimestre, servie douze mois). |
| Hiver 2027 (Odoo en ligne 21.1), automne 2028 (Odoo 22) | Odoo retire l'accès JSON-RPC dont le connecteur se sert. | À faire : passer à l'API « JSON-2 » (`/json/2/<modèle>/<méthode>`, clé en en-tête). |
| Sans date | Pennylane remplacera les adresses de création et de modification par type de client. | À surveiller dans son journal des changements. |
| Sans date | Notion annonce une prochaine version d'API ; HubSpot arrêtera un jour la version 2026-03 de ses jetons. | À surveiller. |

## Limites connues

- **Aucun essai avec un vrai compte**, pour aucun outil.
- **Excel** : avec une connexion en lecture seule, l'ouverture d'un classeur par son lien de partage reste à essayer
  avec un vrai compte (la documentation de Microsoft se contredit sur le droit nécessaire).
- **Business Central** : l'identifiant de l'annuaire est lu dans le jeton d'accès, dont Microsoft ne garantit pas le
  format.
- **Shopify** : sans le droit `read_all_orders`, seules les commandes des 60 derniers jours sont lisibles. Tant que
  Shopify n'a pas approuvé l'accès de l'application aux données protégées des clients, la lecture des clients et des
  commandes échoue en bloc.
- **Pipedrive** : les affaires archivées ne sont pas lues.
- **API REST** : seule la première page de la liste est lue ; jeton « Bearer » seulement.
- **MCP** : les abonnements aux changements (`subscriptions/listen`) ne sont pas servis ; pas de repli sur l'ancien
  transport HTTP+SSE de 2024 ; un refus de clé (401, 403, 429) sur `/mcp` n'est pas un message MCP (le pont le
  convertit). Rien n'a été essayé avec une vraie application Claude.
- **Notion** : pour un branchement fait avant le 12 novembre 2026 sur une base à plusieurs tableaux, c'est le plus
  ancien tableau lisible qui est synchronisé ; l'ordre des tableaux n'est pas documenté par Notion.
- **Débit** : quand un outil limite le débit, la synchronisation s'arrête et reprend au passage suivant (Notion seul
  est réessayé tout de suite, deux fois au plus).
- **Google** : une connexion demandée en lecture seule peut porter aussi l'écriture si la personne l'avait déjà
  accordée à l'application.

## Avant la mise en ligne d'un outil

Pour chaque outil ouvert aux entreprises, avec un compte de test chez l'outil : brancher, lire, modifier une fiche dans
chaque sens, créer une fiche, débrancher et vérifier chez l'outil que l'accès est retiré. Refaire cette comparaison à la
documentation à chaque changement de version d'un outil.
