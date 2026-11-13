# Clauses de sous-traitance (art. 28 RGPD) — prestataire qui installe ou maintient Living Business

**Quand l'utiliser** : l'entreprise confie à un prestataire (informaticien, infogérant, agence) l'installation, la mise
à jour ou la maintenance du serveur ou de l'ordinateur où tourne Living Business. Ce prestataire peut techniquement
accéder aux données : il est **sous-traitant** de l'entreprise. (L'éditeur du logiciel, lui, n'a pas accès aux données
du jeu et n'est pas partie à ce contrat.)

Modèle à adapter avec votre conseil ; les crochets sont à compléter.

---

**Entre** [Raison sociale de l'entreprise], responsable du traitement, **et** [Raison sociale du prestataire],
sous-traitant.

1. **Objet et durée.** Le sous-traitant [installe / met à jour / maintient] Living Business sur [serveur, adresse] pour
   la durée du contrat principal du [date].
2. **Nature des données et personnes.** Données présentes dans Living Business : comptes des utilisateurs, fiches
   clients et fournisseurs (contacts), salariés et planning (y compris motifs d'absence), résultats du baromètre
   d'équipe, courrier collé, journal d'activité ; voir le registre de l'entreprise.
3. **Instructions.** Le sous-traitant n'agit que sur instruction écrite de l'entreprise. En particulier il ne copie,
   n'exporte, ne télécharge ni n'affiche le contenu du dossier des données (`/var/lib/living-business`) ; il ne
   transfère pas lui-même les sauvegardes ; il ne désactive aucune protection (pare-feu, HTTPS, validation en deux
   étapes) ; il ne crée ni compte ni clé d'API pour lui-même sans accord écrit.
4. **Confidentialité.** Les personnes du sous-traitant qui interviennent sont tenues au secret.
5. **Sécurité (art. 32).** Accès au serveur par clé SSH personnelle seulement, retirée en fin d'intervention ; aucun
   mot de passe ni secret dans un courriel ou une messagerie ; mises à jour par `sudo living-business-mise-a-jour`
   (signature de l'éditeur vérifiée) ; journal des interventions remis à l'entreprise.
6. **Sous-traitants ultérieurs.** Aucun sans accord écrit préalable de l'entreprise.
7. **Transferts hors UE.** Aucun sans accord écrit et garanties appropriées.
8. **Aide au responsable.** Le sous-traitant aide l'entreprise à répondre aux demandes des personnes, à assurer la
   sécurité et à gérer une violation de données.
9. **Violation de données.** Le sous-traitant prévient l'entreprise **sans délai et au plus tard sous [24] heures**
   après en avoir eu connaissance, avec les informations de l'article 33.3 (voir `VIOLATION-DONNEES.md`).
10. **Fin du contrat.** Le sous-traitant retire ses accès, ne garde aucune copie et le confirme par écrit.
11. **Audit.** Le sous-traitant met à disposition les informations nécessaires pour démontrer le respect de ces
    obligations et permet les audits de l'entreprise.

Fait à [ville], le [date]. Signatures.
