# Connecteurs : ce qui a été comparé aux vrais outils

État au 13 novembre 2026.

## Ce qui a été fait, et ce qui ne l'a pas été

Jusqu'au 11 novembre 2026, chaque connecteur n'avait été essayé que contre un outil **simulé** par les essais du dépôt.
Les 11 et 12 novembre, chacun a été comparé, ligne à ligne, à la **documentation officielle** de son outil : adresses,
en-têtes, pagination, noms des champs lus, forme des écritures, droits demandés, arrêts annoncés.

**Rien n'a été essayé avec un vrai compte** : aucune application n'est déclarée chez les outils et le projet n'a aucun
identifiant réel. Seules les API publiques sans clé (BODACC) ont été interrogées pour de vrai. Tant qu'un essai avec un
compte de test n'a pas été fait pour un outil, « conforme » veut dire « conforme à la documentation ».

Le jeu et le réseau, eux, se parlent pour de vrai dans `src/passerelle/bout-en-bout-reseau.test.ts` (liaison, partage,
commande, paiement, suspension, « Se connecter avec… », temps réel). Ces essais ont besoin des sources du réseau (non publiques) dans le dossier
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

## Temps réel

Écrit le 13 novembre 2026 d'après la documentation de chaque outil lue ce jour-là (adresses ci-dessous). **Rien n'a été
essayé avec un vrai compte** : les essais (`src/passerelle/temps-reel.test.ts`) tournent contre des outils simulés, et
l'essai de bout en bout fait passer un avis d'Airtable simulé par le vrai réseau (un peu plus de 2 secondes entre l'avis
et la fiche dans le jeu, regroupement compris).

Un outil ne sait prévenir de ses changements qu'une adresse publique sur Internet, et Living Business, installé chez
l'entreprise, n'en a pas. Quand il est relié à Breizhcosystem, les avis passent donc par lui (`src/passerelle/temps-reel.ts`) :

- le jeu garde un canal ouvert vers Breizhcosystem (`GET /v0/relais/flux`, flux d'événements), avec sa clé de liaison :
  un seul, battement régulier, reconnexion avec attente croissante, ouvert seulement s'il a un branchement abonné ;
- au branchement, il demande à Breizhcosystem une adresse d'avis propre à ce branchement, puis crée l'abonnement chez
  l'outil **avec son propre jeton** ; il le renouvelle avant qu'il expire et le supprime au débranchement, avant de
  révoquer les jetons. Il n'accepte qu'une adresse d'avis sur l'origine de Breizhcosystem qu'il connaît ;
- Breizhcosystem vérifie que l'avis vient de l'outil et pousse seulement « tel branchement a changé » (et au plus
  quelques identifiants) ; **le jeu relit l'outil lui-même**, une fois pour tous les avis des 2 secondes. Les avis ne
  sont pas gardés par Breizhcosystem ; certains contiennent une partie des données changées (HubSpot, Pipedrive) ;
- le branchement affiche « En temps réel » quand l'abonnement vit et que le canal est ouvert, « Toutes les N minutes »
  sinon. La relecture régulière reste en filet de sécurité : toutes les 30 minutes en temps réel (jamais plus souvent
  que l'intervalle choisi), l'intervalle choisi sinon.

| Outil | Abonnement | Vérification de l'avis par Breizhcosystem | Avant de relire |
|---|---|---|---|
| Airtable | Webhook de la base (`POST /v0/bases/{base}/webhooks`, `tableData`, table choisie si son identifiant `tbl…` est connu), rafraîchi avant ses 7 jours, supprimé au débranchement. Droit `webhook:manage`. | Signature `X-Airtable-Content-MAC` (secret MAC tiré par Airtable, remis à Breizhcosystem, jamais gardé par le jeu). | Charges lues avec le curseur (`…/payloads?cursor=`), ce qui repousse aussi l'expiration de 7 jours ; rien de nouveau : rien relu. |
| Notion | Aucun chez Notion : les avis se déclarent dans l'application de l'éditeur. Le jeu désigne sa connexion par l'empreinte (SHA-256) de son jeton de renouvellement, jamais le jeton. | Signature `X-Notion-Signature` ; avis aiguillé par l'espace et le robot de la connexion (`accessible_by`). | Un branchement sur un tableau précis ne relit que pour lui. |
| Google Sheets | Canal Google Drive sur la feuille (`files.watch`, `web_hook`), un jour au plus, rouvert avant la fin (nouveau canal, puis l'ancien arrêté par `channels/stop`). Droit Drive des avis demandé par le relais (aucun droit Sheets ne vaut pour `files.watch`). | Jeton du canal (`X-Goog-Channel-Token`) ; message `sync` ignoré. | — |
| Excel (OneDrive, SharePoint) | Abonnement Microsoft Graph (`POST /subscriptions`) au dossier racine du lecteur qui porte le classeur (`changeType` `updated`), moins de 30 jours (`PATCH` avant la fin), supprimé au débranchement. | Échange de validation (`validationToken` renvoyé en texte brut), puis `clientState` de chaque avis. | Étiquette de contenu du classeur (`cTag`) : inchangée (un autre fichier du lecteur a changé), rien relu. |
| HubSpot | Aucun chez HubSpot (avis de l'application de l'éditeur, signature v3). Même preuve de connexion que Notion. | Signature `X-HubSpot-Signature-v3` (5 minutes au plus) ; avis aiguillé par le numéro du compte. | Un branchement sur les entreprises ne relit pas pour un contact. |
| Pipedrive | Webhook par l'API (`POST /v1/webhooks`, version 2.0, objet du branchement, toutes actions, identifiant et mot de passe de Breizhcosystem), vérifié chaque jour et recréé s'il a disparu, supprimé au débranchement. Droit `webhooks:full`. | Authentification de base de l'abonnement. | Un branchement sur les affaires ne relit pas pour une personne. |

Sans liaison avec Breizhcosystem, ou pour un outil que Breizhcosystem n'a pas encore ouvert au temps réel, rien ne
change : chaque branchement est relu à son intervalle. Notion et HubSpot branchés par une clé (mode avancé) restent
relus à leur intervalle ; une connexion « Se connecter avec… » faite avant le temps réel se refait (« Se reconnecter »).

Documentation lue : Airtable <https://airtable.com/developers/web/api/webhooks-overview>,
<https://airtable.com/developers/web/api/create-a-webhook>, <https://airtable.com/developers/web/api/list-webhook-payloads>,
<https://airtable.com/developers/web/api/refresh-a-webhook>, <https://airtable.com/developers/web/api/delete-a-webhook>,
<https://airtable.com/developers/web/api/model/webhooks-specification> ; Notion <https://developers.notion.com/reference/webhooks>,
<https://developers.notion.com/reference/webhooks-events-delivery> ; Google
<https://developers.google.com/workspace/drive/api/guides/push>,
<https://developers.google.com/workspace/drive/api/reference/rest/v3/files/watch>,
<https://developers.google.com/workspace/drive/api/guides/api-specific-auth> ; Microsoft
<https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks>,
<https://learn.microsoft.com/en-us/graph/api/subscription-post-subscriptions?view=graph-rest-1.0>,
<https://learn.microsoft.com/en-us/graph/api/resources/subscription?view=graph-rest-1.0> ; HubSpot
<https://developers.hubspot.com/docs/api-reference/latest/webhooks/guide>,
<https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/request-validation> ; Pipedrive
<https://pipedrive.readme.io/docs/guide-for-webhooks-v2>,
<https://pipedrive.readme.io/docs/marketplace-scopes-and-permissions-explanations>.

## Alertes : être prévenu sur Telegram ou WhatsApp

Écrit le 13 novembre 2026 d'après la documentation officielle lue ce jour-là (adresses à la fin de cette section).
**Rien n'a été essayé avec un vrai compte Telegram ni un vrai compte Meta** : pas de robot déclaré chez BotFather, pas
de portefeuille d'entreprise chez Meta. Les essais (`src/passerelle/alertes.test.ts`, 32 cas) tournent contre un
service simulé ; la chaîne complète (branchement, message d'essai, alertes composées à partir des données, signature,
nouvel essai) a été vérifiée de bout en bout contre un service local, à l'écran, dans Chrome sans tête.

Le module est `src/passerelle/alertes.ts`, l'écran est dans Réglages, Notifications, « Telegram et WhatsApp ». Sans
canal branché il ne fait rien : aucune minuterie utile, aucun appel sortant, aucun changement dans le jeu.

### Telegram — proposé, et c'est le chemin conseillé

Trois étapes : créer un robot chez BotFather et coller son jeton, écrire un message au robot, brancher. Trois appels,
tous en POST sur `https://api.telegram.org/bot<jeton>/<méthode>` :

- `getMe` : vérifie le jeton tout de suite et donne le nom du robot (pour le lien `https://t.me/<robot>`).
- `getUpdates` (`limit` 100, `timeout` 0, `allowed_updates` `["message"]`, **sans `offset`**) : retrouve la conversation
  à partir du message que la personne vient d'écrire. Sans `offset`, les messages ne sont pas confirmés : un deuxième
  essai les revoit. Telegram garde 24 heures au plus les messages non récupérés.
- `sendMessage` (`chat_id`, `text`, `link_preview_options.is_disabled`) : **texte brut, sans `parse_mode`**. Rien à
  échapper, donc rien à casser (MarkdownV2 demande d'échapper dix-huit caractères, HTML trois). Texte coupé à 4096
  caractères, comme la documentation l'impose.

Réponses lues telles que Telegram les décrit : `{ ok: true, result }`, ou `{ ok: false, error_code, description,
parameters: { retry_after } }`. Le statut HTTP n'est pas supposé : c'est le JSON qui décide. Un `retry_after` fixe
l'heure du nouvel essai. Un 401, un 403, « chat not found » ou « bot was blocked » sont tenus pour définitifs : le
canal se met en pause et l'écrit, plutôt que de retenter sans fin.

Un robot qui sert déjà ailleurs a un webhook posé, et `getUpdates` échoue : l'écran propose d'en créer un second chez
BotFather. **Le jeu n'appelle jamais `deleteWebhook`** : il ne débranche pas l'intégration d'un autre logiciel.

Débit : la documentation dit un message par seconde et par conversation, environ 30 par seconde en tout. Le jeu envoie
quelques messages par jour, regroupés, avec un plafond réglé par l'entreprise.

### WhatsApp — proposé seulement à qui a déjà un compte WhatsApp Business

La documentation de Meta est claire : il n'existe **aucun moyen officiel** pour un logiciel auto-hébergé d'écrire sur
WhatsApp sans passer par l'API WhatsApp Business (Cloud API). Il faut un portefeuille d'entreprise Meta, un compte
WhatsApp et un compte de messagerie, une application Meta, un numéro de téléphone **dédié** (un numéro déjà utilisé
dans l'application WhatsApp grand public est déconnecté de l'API), un jeton d'accès d'utilisateur système, et un moyen
de paiement. La « coexistence » avec l'application WhatsApp Business est réservée aux partenaires et aux fournisseurs
techniques : elle n'est pas ouverte à un éditeur qui s'intègre directement.

Surtout, la **fenêtre de 24 heures** : un message libre n'est accepté que dans les 24 heures qui suivent un message de
la personne. Une alerte arrive rarement dans cette fenêtre. Hors d'elle, seul un **modèle approuvé** passe ; la revue
de Meta peut prendre jusqu'à 24 heures, et chaque message est facturé.

D'où le choix fait ici :

- l'écran **dit tout cela en toutes lettres**, avant le formulaire, et renvoie à Telegram pour qui n'a pas ce compte ;
- aucun bouton « se connecter à WhatsApp » n'est proposé : il ne pourrait pas marcher ;
- le branchement demande les cinq choses qui, elles, marchent vraiment : identifiant du numéro, jeton permanent, numéro
  destinataire, nom du modèle approuvé, langue du modèle ;
- l'envoi est **toujours** un message de modèle (`type: "template"`), jamais un message libre, pour ne pas dépendre de
  la fenêtre de 24 heures : `POST https://graph.facebook.com/v27.0/<identifiant du numéro>/messages`, en-tête
  `Authorization: Bearer <jeton>`, corps `{ messaging_product, recipient_type, to, type: "template", template: { name,
  language: { code }, components: [{ type: "body", parameters: [{ type: "text", text }] }] } }`. Le modèle doit donc
  contenir **une seule variable** dans son corps, ce que l'écran explique (« Living Business : {{1}} »).
- la phrase glissée dans la variable est mise sur une seule ligne, sans tabulation ni espaces multiples : Meta refuse
  un paramètre mis en forme.
- `v27.0` est la version la plus récente servie par Meta au 13 novembre 2026 (vérifié : `v28.0` répond « unknown path
  components »). C'est la constante `VERSION_WHATSAPP`.
- une réponse acceptée ne veut pas dire livrée : Meta ne le dit que par webhook, que le jeu ne reçoit pas. L'écran ne
  promet donc pas la livraison, il dit que le message a été accepté.
- un 401, un 403, le code 190 (jeton expiré ou révoqué) ou un code 132xxx (modèle inconnu, non approuvé, mal rempli)
  mettent le canal en pause avec le mot de Meta : réessayer n'y changerait rien.

### Un autre service (webhook)

Pour qui veut brancher autre chose : une adresse https à soi, Make, Zapier, n8n, Slack. Le corps est
`{ evenement: "alerte", le, urgent, texte, lignes }`. Avec un secret, il est signé comme les envois entrants :
`X-LB-Signature: t=<secondes>,v1=<HMAC-SHA256 de « t.corps »>`. L'adresse passe par l'anti-SSRF de `sortant.ts`
(https obligatoire, adresse interne ou privée refusée, pas de redirection, taille et délai bornés).

### Ce qui n'a pas pu être vérifié

- Aucun envoi réel vers Telegram ni vers WhatsApp : ni robot, ni compte Meta, ni numéro.
- Les textes exacts des erreurs de Telegram (« chat not found », « bot was blocked by the user ») ne figurent pas dans
  les pages lues : ils viennent de l'usage courant de l'API. S'ils changent, la reconnaissance échoue sans danger — le
  canal réessaie au lieu de se mettre en pause, et finit en pause après huit échecs.
- La catégorie exacte à choisir pour un modèle d'alerte interne (« utilitaire » proposé par l'écran), le nombre de
  destinataires d'un numéro de test, les montants facturés par Meta et la durée d'un jeton temporaire n'ont pas été
  confirmés : les pages correspondantes n'ont pas été lues ou sont tronquées.
- La vérification d'entreprise chez Meta : les pages lues ne disent pas qu'elle est obligatoire, seulement qu'elle
  relève le plafond de destinataires (250 par 24 h sans elle, ce qui suffit largement ici).

### Adresses lues le 13 novembre 2026

Telegram : <https://core.telegram.org/bots/api>, <https://core.telegram.org/bots/api/methods/getme.md>,
<https://core.telegram.org/bots/api/methods/sendmessage.md>, <https://core.telegram.org/bots/api/formatting.md>,
<https://core.telegram.org/bots/api/types/responseparameters.md>, <https://core.telegram.org/bots/faq>,
<https://core.telegram.org/bots/features>.
Meta : <https://developers.facebook.com/docs/whatsapp/cloud-api/overview>,
<https://developers.facebook.com/docs/whatsapp/cloud-api/get-started>,
<https://developers.facebook.com/docs/whatsapp/cloud-api/guides/send-messages>,
<https://developers.facebook.com/docs/whatsapp/pricing>,
<https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates>,
<https://developers.facebook.com/documentation/business-messaging/whatsapp/access-tokens>,
<https://developers.facebook.com/documentation/business-messaging/whatsapp/messaging-limits>,
<https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users>.
(<https://developers.facebook.com/docs/whatsapp/cloud-api/guides/set-up-message-templates> répond 404 : les modèles
sont documentés sur la page « message-templates » ci-dessus.)

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
| Environ deux ans après sa sortie | Meta cesse de servir la version `v27.0` de l'API Graph (WhatsApp). | À faire avant : relever `VERSION_WHATSAPP` dans `src/passerelle/alertes.ts`. |

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
- **Alertes** : aucun envoi réel vers Telegram ni vers WhatsApp (ni robot, ni compte Meta) ; chez WhatsApp, une réponse
  acceptée par Meta ne prouve pas la livraison (elle n'arrive que par un webhook que le jeu ne reçoit pas) ; un message
  n'est envoyé qu'une fois par fait et, s'il n'a pas pu partir en 48 heures, il est abandonné (la chose reste à l'écran
  du jeu) ; quand plusieurs canaux sont branchés, il suffit qu'un seul accepte le message pour qu'il quitte la file.
- **Temps réel** : Airtable demande d'être « créateur » de la base et n'accepte que 2 webhooks par base pour une même
  application ; Microsoft refuse un second abonnement au même lecteur (le second branchement reste relu à son
  intervalle), écrit que ses abonnements n'acceptent pas un droit d'écriture quand la lecture suffit (connexion « dans
  les deux sens » à essayer), et peut mettre jusqu'à 6 heures à prévenir ; Notion regroupe certains avis sur une
  minute environ ; les propriétés HubSpot autres que celles lues par défaut ne sont vues qu'à la relecture de sécurité ;
  Dynamics 365, Business Central, Shopify, Sellsy, WooCommerce et les autres outils restent relus à leur intervalle.

## Avant la mise en ligne d'un outil

Pour chaque outil ouvert aux entreprises, avec un compte de test chez l'outil : brancher, lire, modifier une fiche dans
chaque sens, créer une fiche, débrancher et vérifier chez l'outil que l'accès est retiré. Refaire cette comparaison à la
documentation à chaque changement de version d'un outil.
