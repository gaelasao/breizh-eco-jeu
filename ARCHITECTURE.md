# Architecture — plan privé

## Vue

```
Navigateur (scène 3D + vue liste)
   │  API privée versionnée /api/v1 (session, rôle vérifié côté serveur sur CHAQUE objet)
   ▼
Passerelle privée ───── Connecteurs (lecture seule par défaut ; écriture = capacité séparée)
   │   règles, événements, actions, journal privé, secrets (coffre / env)
   │
   └── Client Breizhcosystem (clé d'organisation) ──HTTPS──► réseau Breizhcosystem (service séparé)  [facultatif]
```

- Hébergement : local, serveur choisi ou prestataire mandaté. « Privé » = contrôlé par l'entreprise, pas forcément dans ses murs.
- Stockage privé : à confirmer par prototype (SQLite fichier unique visé pour l'auto-hébergement simple).
- Le rendu 3D est un client parmi d'autres : si WebGL échoue, la vue liste expose les mêmes données et actions (LB-10).

## Univers (vocabulaire de l'entreprise)

```
familles (code, stables) ── types / rôles / champs / règles (JSON, par entreprise)
  tiers                     entreprise, particulier… + rôles client, fournisseur, partenaire…
  projet                    « Projet », « Chantier », « Réparation », « Mission »…
  ressource                 « Article en stock », « Matériau », « Produit », « Engin »…
```

- Règles, moteur et scène travaillent sur les **familles** ; l'affichage utilise les libellés de l'univers.
- La scène associe une forme 3D par famille (+ `icone` optionnelle par type) : un nouveau type s'affiche sans nouvel asset.
- Un connecteur mappe ses colonnes vers un **type** de l'univers (ex. colonne « Client » d'un tableur → tiers rôle `client`).
- Univers = donnée non fiable : validé (identifiants, limites de taille, types de champ fermés), jamais exécuté.
- Évolution sûre : on masque, on ajoute ; on ne supprime pas, on ne change pas de famille.

## Modules

Chaque module : version, capacités déclarées, installation / activation / mise à jour / retrait.
Ajouter un connecteur ne modifie ni les scènes ni les autres connecteurs : il produit des **événements** dans le modèle commun.

### Contrat minimal d'un connecteur (chap. 7.2)

| Élément | Exigence |
|---|---|
| Identité | nom, version, éditeur |
| Opérations | lecture / écriture séparées, écriture désactivée par défaut |
| Auth | OAuth du fournisseur ou paramètres saisis dans un écran sécurisé ; jamais de mot de passe en conversation ou vers une IA |
| Schéma | champs, mapping proposé puis validé par l'entreprise, source faisant autorité par champ |
| Synchro | fréquence, état, date de dernière synchro visible |
| Erreurs | quotas, révocation, erreurs compréhensibles, reprise |
| Isolation | aucun code tiers n'a les privilèges du noyau ; extensions non fiables désactivées |

### Événement (chap. 7.5)

`id, orgId, type@version, objetId, horodatageSource, horodatageReception, origine, fraicheur, preuveRef` — traitements rejouables, doublons détectés, conflits présentés (jamais écrasés silencieusement).

### Webhook entrant (Zapier & co, chap. 7.4)

Signature HMAC + horodatage, contrôle org/périmètre/format, limite de débit, idempotence. URLs sortantes filtrées (anti-SSRF : pas d'IP privées/loopback/metadata).

## Liaison Breizhcosystem

- Le jeu lit `GET /v0/droits` et affiche le pavillon (`src/nexus/pavillon.ts`).
- Publier un besoin : l'utilisateur sélectionne les champs, prévisualise, confirme ⇒ seulement alors la passerelle envoie **ces champs** à Breizhcosystem. Le brouillon ne quitte jamais le plan privé (R06).
- Panne Breizhcosystem ⇒ pavillon « hors ligne », rien d'autre n'est bloqué.

## IA (facultative)

Le jeu fonctionne sans modèle. Toute IA : identité, périmètre, outils autorisés, historique. Contenus externes (emails, pages, CRM) = non fiables, ne modifient ni droits ni instructions (R11).
