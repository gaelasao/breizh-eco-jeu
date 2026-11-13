# Mention d'information des formulaires publics (avis clients et baromètre)

Article 13 du RGPD. Les formulaires envoyés par Living Business (lien personnel `/f/<jeton>`, valable 30 jours)
affichent **avant la réponse** une notice repliable, générée par `web/formulaire.js`. Ce document reprend son texte,
dit d'où vient chaque information et liste ce que **l'entreprise** doit vérifier ou compléter : c'est elle le
responsable du traitement. L'éditeur n'a pas accès aux réponses.

## 1. Avis client (« Votre avis compte »)

Texte affiché (l'entreprise est nommée par le nom enregistré dans Réglages › Entreprise) :

> **Vos données : ce que devient votre réponse**
> - **Responsable** : [entreprise], pour connaître votre avis sur son travail et l'améliorer.
> - **Ce qui est gardé** : votre note, votre réponse sur la recommandation et votre commentaire s'il y en a un, avec
>   la date, rattachés à votre fiche client.
> - **Qui le voit** : les personnes de [entreprise] qui suivent la relation avec ses clients. Il peut être repris
>   dans ses outils de suivi des clients.
> - **Où** : dans le logiciel de gestion de [entreprise], sur son ordinateur ou son serveur : l'éditeur du logiciel
>   n'y a pas accès.
> - **Combien de temps** : [6 mois | 1 an | 2 ans | 3 ans], puis effacement automatique. *Sans durée réglée :* la
>   durée fixée par [entreprise] : vous pouvez lui demander d'effacer votre avis à tout moment.
> - **Facultatif** : vous pouvez ne pas répondre. Dans le commentaire, n'écrivez ni information sur votre santé ni
>   donnée bancaire.
> - **Vos droits** : accès, rectification, effacement et opposition, auprès de [entreprise]. Vous pouvez aussi
>   adresser une réclamation à la CNIL (cnil.fr).

D'où viennent les informations (code) :

| Élément | Source |
|---|---|
| Nom de l'entreprise | `GET /api/public/formulaire/<jeton>` → `organisation` (fiche « organisation ») |
| Durée | `conservationJours` = durée des avis choisie dans le jeu (`DUREES-CONSERVATION.md`), `null` si aucune |
| Données gardées | `enquetes.ts` (`repondre`) : fiche « avis client » avec `note`, `recommande`, `commentaire`, `recu_le`, `concerne` |

À vérifier ou compléter par l'entreprise :

1. **Base légale** : le registre (T5) propose l'intérêt légitime (art. 6.1.f), la réponse restant facultative. Si
   l'entreprise retient une autre base, l'indiquer dans son registre.
2. **Contact pour les droits** : la notice renvoie à l'entreprise sans adresse, car le jeu ne la connaît pas. Mettre
   une adresse de contact (et celle du délégué à la protection des données s'il y en a un) dans le message qui
   accompagne le lien (e-mail préparé par « Envoyer un formulaire »), ou sur sa politique de confidentialité.
3. **Outils branchés** : si les avis sont synchronisés vers un CRM ou un tableur (Réglages › Connecteurs), ce CRM
   devient destinataire ; l'indiquer dans le registre (T7) et, s'il est hors de l'Union européenne, dans la politique
   de confidentialité (`SOUS-TRAITANTS-TRANSFERTS.md`).
4. **Durée** : régler une durée dans le jeu, plutôt que « durée fixée par l'entreprise » ; c'est elle qui s'affiche.

## 2. Baromètre d'équipe (collaborateurs)

La notice « Qui voit quoi ? (tes données) » est détaillée dans [NOTICE-BAROMETRE-SALARIES.md](NOTICE-BAROMETRE-SALARIES.md)
(texte, seuil de 5 réponses, 13 mois, consultation du CSE). Elle est affichée sur chaque formulaire de baromètre.

## 3. Ce que la notice ne remplace pas

- La politique de confidentialité générale de l'entreprise (site, conditions de vente), qui doit citer ce traitement.
- L'information des salariés avant la mise en service du baromètre ou du planning (Code du travail, art. L1222-4 ;
  consultation du CSE quand il existe) : voir [NOTICE-BAROMETRE-SALARIES.md](NOTICE-BAROMETRE-SALARIES.md) et
  [NOTICE-PLANNING-SALARIES.md](NOTICE-PLANNING-SALARIES.md).
