# Destinataires, sous-traitants et transferts hors de l'Union européenne

Living Business ne contacte **aucun service par défaut**. Chaque échange ci-dessous n'existe que si l'entreprise l'a
activé. Pour chacun, l'entreprise reste responsable du traitement ; le prestataire est **son** sous-traitant (ou un
destinataire), avec qui elle doit avoir un contrat conforme à l'article 28 (souvent les conditions de traitement des
données, « DPA », de l'outil).

Les pays et mécanismes indiqués sont des repères : **à vérifier dans le DPA de chaque outil** au moment du choix (les
offres et lieux d'hébergement changent).

## 1. Ce que le code envoie, et à qui

| Échange | Quand | Données qui sortent | Destinataire |
|---|---|---|---|
| Connecteurs (T7) | l'administrateur branche un outil | fiches du type choisi, selon la correspondance de champs ; jeton de l'outil | l'outil choisi (tableau 2) |
| « Se connecter avec… » | clic sur « Se connecter avec… » (jamais à l'ouverture du catalogue), puis chaque renouvellement | **jetons** de l'outil (10 min au plus, en mémoire), adresse de la boutique ou de l'organisation, adresse du jeu, adresse IP, droits demandés (lecture seule par défaut) ; pas de données métier | relais Breizhcosystem de l'éditeur, **sous-traitant** de l'entreprise ([CONDITIONS-RELAIS-CONNEXION.md](CONDITIONS-RELAIS-CONNEXION.md)), puis l'outil |
| Partage Breizhcosystem (T10) | catégorie cochée **dans le jeu** | secteur, besoins, surstocks, nombre de personnes disponibles, notes de santé | Breizhcosystem (éditeur) et membres du réseau |
| Alerte Bodacc (T11) | activée par l'entreprise | SIREN des clients | DILA (`bodacc-datadila.opendatasoft.com`), France |
| Webhook sortant | URL réglée par l'entreprise | fiches modifiées | service choisi (Make, Zapier, n8n…) |
| Mise en ligne | serveur loué par l'entreprise | toutes les données du jeu, sur ce serveur | hébergeur choisi (OVHcloud, Scaleway, IONOS…) |
| Certificat HTTPS | mise en ligne | nom de domaine du jeu | Let's Encrypt (ISRG, États-Unis) : aucune donnée personnelle |
| Logiciels du serveur | mise en ligne, puis mises à jour de sécurité automatiques | adresse IP du serveur (téléchargement de paquets) : aucune donnée de l'entreprise | Ubuntu (Canonical) ; Caddy depuis son dépôt officiel `dl.cloudsmith.io` (Cloudsmith, Royaume-Uni) |
| Copie hors serveur | activée à l'installation | sauvegardes **chiffrées sur le serveur** (rclone crypt), illisibles sans la phrase | stockage S3 au nom de l'entreprise |
| Accès d'équipe par Tailscale | choisi par l'entreprise | trafic chiffré de bout en bout entre ses appareils ; métadonnées de connexion chez Tailscale | Tailscale Inc. (États-Unis) |
| Mises à jour | lancées par l'administrateur, ou chaque nuit si la minuterie a été acceptée à l'installation | adresse IP du serveur (téléchargement) | Breizhcosystem (éditeur), qui sert des publications signées |
| Alerte « nouvelle version » | lecture à la demande (Réglages › À propos), ou chaque jour (par défaut en ligne, réglable) | **aucune donnée** : simple lecture de la liste publique des versions ; seule l'adresse IP est vue | Breizhcosystem (éditeur) |
| Révocation d'un accès | suppression d'un connecteur relié par « Se connecter avec Google » ou « … HubSpot » | le jeton de l'outil, pour le révoquer | Google (`oauth2.googleapis.com`) ; HubSpot : par le relais de Breizhcosystem, et directement (`api.hubapi.com`) seulement en secours, jusqu'au 16 février 2027 |

Rien d'autre : pas de télémétrie, pas de police ni de bibliothèque chargée depuis un service extérieur (tout est
servi par le jeu lui-même), pas d'IA appelée par le jeu.

## 2. Outils branchables (connecteurs) — repères

| Outil | Société (siège) | Transfert hors UE possible | À vérifier |
|---|---|---|---|
| Pennylane, Qonto, Axonaut, Sellsy | sociétés françaises | non en principe | hébergement et sous-traitants ultérieurs |
| Odoo (odoo.com) | Odoo SA (Belgique) | selon l'hébergement choisi | région d'hébergement |
| Pipedrive | Pipedrive OÜ (Estonie) | possible (groupe international) | DPA, sous-traitants |
| Make | Celonis (Union européenne) | possible selon les modules | DPA |
| n8n | auto-hébergé ou n8n GmbH (Allemagne) | non si auto-hébergé | — |
| HubSpot, Google (Sheets), Microsoft (Excel 365, Dynamics, Business Central), Stripe, Notion, Airtable, Zapier | groupes américains | **oui** | adhésion au Data Privacy Framework UE–États-Unis ou clauses contractuelles types ; région de données (ex. centre de données UE de HubSpot, EU Data Boundary de Microsoft) |
| Shopify | Shopify (Canada, Irlande pour l'UE) | possible (Canada : décision d'adéquation) | DPA |
| WooCommerce, PrestaShop | boutique de l'entreprise, chez son hébergeur | selon l'hébergeur | — |
| Serveur MCP, API REST, webhook | choisi par l'entreprise | selon le service | contrat avec ce service |

## 3. L'éditeur (Breizhcosystem)

- **Jeu** : aucun accès aux données, aucun traitement pour le compte de l'entreprise ; pas de contrat de sous-traitance nécessaire pour le jeu lui-même.
- **Relais « Se connecter avec… »** : l'éditeur traite les jetons de connexion pour le compte de l'entreprise : il est son **sous-traitant** pour ce traitement. Projet de clauses art. 28 et d'information : [CONDITIONS-RELAIS-CONNEXION.md](CONDITIONS-RELAIS-CONNEXION.md) (à publier par l'éditeur). Sans ces conditions acceptées, l'entreprise peut utiliser le mode avancé (clé), qui ne passe pas par l'éditeur.
- **Breizhcosystem** (relais de connexion, partage, téléchargements) : service séparé de ce dépôt, dont les traitements sont décrits dans la documentation de Breizhcosystem. Identité légale, contacts et hébergement de l'éditeur : voir les mentions légales de Breizhcosystem.
