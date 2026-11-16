/**
 * LES RELANCES ET LES ÉTAPES DÉCIDÉES PAR L'ENTREPRISE. Ce que ces essais vérifient, et qui ne se vérifie qu'ici :
 * - une relance ne part pas deux fois : le rythme tient, le plafond tient, le compteur tient ;
 * - une facture payée entre-temps n'est plus relancée, et son compteur est oublié ;
 * - « un devis sans réponse » se calcule DANS le moteur, lu dans la forme du parcours de l'univers — aucune valeur
 *   (« envoyé ») n'est écrite en dur, et un univers qui renomme ses statuts marche sans qu'on y touche ;
 * - les étapes d'une entreprise survivent à un changement d'univers ;
 * - une entreprise qui ne règle RIEN retrouve exactement ce qu'elle avait avant.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargerUnivers } from '../config/univers.ts';
import type { ObjetMetier, ValeurChamp } from './model.ts';
import { personnaliser } from './univers.ts';
import {
  defPartage, DESTINATAIRES, estDestinatairePartage, lireRythme, messagePartage, oublis, relancesDues,
  relancesPossibles, RELANCES, rythmeDe, sujetsRelances, type RegistreRelances,
} from './relances.ts';
import { contexteDe, lireModele, modelesUnivers, defSujet, suiviDe, suivis, type ModeleEtapes } from './suivi.ts';

const U = await chargerUnivers('generique');
const BTP = await chargerUnivers('btp');
const MAINTENANT = new Date('2026-11-16T09:00:00Z');
const JOUR = 86_400_000;
const ctx = contexteDe(MAINTENANT);
const jour = (n: number) => new Date(MAINTENANT.getTime() + n * JOUR).toISOString().slice(0, 10);
/** Le contexte d'un autre jour : c'est ainsi qu'on fait passer le temps sans toucher à une horloge. */
const ctxDans = (n: number) => contexteDe(new Date(MAINTENANT.getTime() + n * JOUR));

const objet = (
  id: string, type: string, champs: Record<string, ValeurChamp>, famille: ObjetMetier['famille'],
  nom = id, majLe = MAINTENANT.toISOString(),
): ObjetMetier => ({
  id, orgId: 'org', famille, type, roles: [], nom, champs,
  provenance: 'declare', source: { id: 'test', libelle: 'Essai', derniereSynchro: MAINTENANT.toISOString() },
  majLe, disponibilite: 'disponible', mode: 'reel',
});
const facture = (champs: Record<string, ValeurChamp> = {}, id = 'f1') => objet(id, 'facture', champs, 'commande', 'FA-7');
const devis = (champs: Record<string, ValeurChamp> = {}, id = 'd1', ilYaJours = 0) =>
  objet(id, 'devis', champs, 'commande', 'DEV-12', new Date(MAINTENANT.getTime() - ilYaJours * JOUR).toISOString());
const projet = (champs: Record<string, ValeurChamp> = {}, id = 'p1') => objet(id, 'projet', champs, 'projet', 'Toiture Le Goff');
const tache = (nom: string, champs: Record<string, ValeurChamp>, id = `t-${nom}`) => objet(id, 'tache', champs, 'tache', nom);

const unSuivi = (o: ObjetMetier, taches: ObjetMetier[] = [], modele: ModeleEtapes | null = null, c = ctx) => {
  const s = suiviDe(BTP, o, c, { tachesLiees: taches, modele });
  assert.ok(s);
  return s;
};

// ------------------------------------------------------------------ une relance ne part pas deux fois

test('une relance ne part pas deux fois : le rythme réglé est le seul qui décide', () => {
  const f = facture({ echeance: jour(-10), payee: false });
  const s = [unSuivi(f)];
  const rythme = { paiement: { apresJours: 3, tousLesJours: 14, maxFois: 3 } };

  const premiere = relancesDues(s, rythme, {}, ctx);
  assert.equal(premiere.length, 1, 'une facture échue depuis 10 jours, relancée après 3 : elle est due');
  const r = premiere[0];
  assert.ok(r);
  assert.equal(r.relance, 'paiement');
  assert.equal(r.fois, 1);
  assert.equal(r.rappel, false);
  assert.equal(r.jours, 10);

  // elle est partie aujourd'hui : rien ne repart avant quatorze jours, et surtout pas une deuxième fois tout de suite
  const faites: RegistreRelances = { [r.cle]: { fois: 1, dernierJour: ctx.aujourdhui } };
  assert.deepEqual(relancesDues(s, rythme, faites, ctx), [], 'le même jour : rien');
  assert.deepEqual(relancesDues([unSuivi(f)], rythme, faites, ctxDans(13)), [], 'treize jours : pas encore');
  const deuxieme = relancesDues([unSuivi(f)], rythme, faites, ctxDans(14));
  assert.equal(deuxieme.length, 1, 'quatorze jours : la deuxième');
  assert.equal(deuxieme[0]?.fois, 2);
  assert.equal(deuxieme[0]?.rappel, true);
  assert.match(String(deuxieme[0]?.phrase), /relance 2/);
  assert.match(String(deuxieme[0]?.message), /une nouvelle fois/, 'une relance qui ne se souvient de rien agace');

  // au bout du compte réglé, le logiciel se taît : la suite appartient à l'entreprise
  const aFond: RegistreRelances = { [r.cle]: { fois: 3, dernierJour: jour(-100) } };
  assert.deepEqual(relancesDues([unSuivi(f)], rythme, aFond, ctxDans(200)), [], 'trois fois, et plus un mot');
});

test('une facture payée entre-temps n’est plus relancée, et son compteur est oublié', () => {
  const echue = facture({ echeance: jour(-20), payee: false });
  const dues = relancesDues([unSuivi(echue)], undefined, {}, ctx);
  assert.equal(dues.length, 1);
  const cle = String(dues[0]?.cle);

  // la même facture, marquée payée : le suivi est terminé, donc il n'y a plus rien à relancer
  const payee = facture({ echeance: jour(-20), payee: true });
  const apres = unSuivi(payee);
  assert.equal(apres.termine, true);
  assert.deepEqual(relancesDues([apres], undefined, { [cle]: { fois: 1, dernierJour: jour(-15) } }, ctx), []);
  // et son compteur n'a plus de raison d'être : si elle revenait un jour, elle repartirait de zéro
  assert.deepEqual(oublis({ [cle]: { fois: 1, dernierJour: jour(-15) } }, relancesPossibles([apres])), [cle]);
  // tandis qu'une relance qui attend seulement son tour GARDE sa mémoire
  assert.deepEqual(oublis({ [cle]: { fois: 1, dernierJour: jour(-1) } }, relancesPossibles([unSuivi(echue)])), []);
});

// ------------------------------------------------------------------ le devis sans réponse, enfin dans le moteur

test('« sans réponse » se lit dans la FORME du parcours : aucune valeur n’est écrite en dur', () => {
  // un devis parti il y a 9 jours : son parcours est resté sur la valeur qui ENGAGE (ni la première, ni une fin)
  const d = devis({ statut: 'envoyé', client: 'cl1' }, 'd1', 9);
  const s = unSuivi(d);
  assert.ok(s.attente, 'le moteur sait que ce devis attend quelqu’un d’autre');
  assert.equal(s.attente.depuisJours, 9);
  assert.equal(s.attente.etape.libelle, 'Envoyé');
  const dues = relancesDues([s], undefined, {}, ctx);
  assert.deepEqual(dues.map((r) => r.relance), ['reponse']);
  assert.match(String(dues[0]?.phrase), /sans réponse depuis 9/);
  assert.equal(/\d+\s*€/.test(String(dues[0]?.message)), false, 'une relance ne parle pas d’argent');

  // un brouillon n'attend personne : c'est le travail de l'entreprise, pas celui du client
  assert.equal(unSuivi(devis({ statut: 'brouillon' }, 'd2', 30)).attente, null);
  // accepté ou refusé : le parcours est au bout, il n'y a plus rien à attendre
  for (const fin of ['accepté', 'refusé']) {
    const fini = unSuivi(devis({ statut: fin }, 'd3', 60));
    assert.equal(fini.termine, true);
    assert.deepEqual(relancesDues([fini], undefined, {}, ctx), []);
  }

  // UNE ENTREPRISE QUI RENOMME SES STATUTS : rien à toucher, parce qu'aucun mot n'est écrit dans le moteur
  const autre = personnaliser(U, {
    id: 'cabinet', nom: 'Cabinet', version: 1, herite: 'generique',
    types: [{ id: 'devis', libelle: 'Proposition', pluriel: 'Propositions', champs: [{ id: 'statut', libelle: 'Où ça en est', type: 'choix', choix: ['à rédiger', 'chez le client', 'signée', 'abandonnée'] }] }],
  });
  const p = objet('d9', 'devis', { statut: 'chez le client' }, 'commande', 'PROP-4', new Date(MAINTENANT.getTime() - 12 * JOUR).toISOString());
  const sp = suiviDe(autre, p, ctx);
  assert.ok(sp);
  assert.ok(sp.attente, 'le mot a changé, la forme non : le moteur sait encore que ça attend');
  assert.equal(sp.attente.etape.libelle, 'Chez le client');
  // le sujet de suivi garde les valeurs « finies » de l'univers générique : « signée » n'en est pas une,
  // et c'est bien pour cela que le moteur ne juge JAMAIS sur les mots mais sur la position dans la liste
  const dues2 = relancesDues([sp], undefined, {}, ctx);
  assert.deepEqual(dues2.map((r) => r.relance), ['reponse']);
  assert.match(String(dues2[0]?.objet), /Proposition PROP-4/, 'le vocabulaire vient de l’univers');
});

test('une étape qui traîne se relance vers l’intérieur, jamais vers le client', () => {
  const p = projet({ echeance: jour(30), client: 'cl1' });
  const taches = [
    tache('Terrassement', { concerne: 'p1', echeance: jour(-20), statut: 'terminée' }),
    tache('Charpente', { concerne: 'p1', echeance: jour(-4), statut: 'à faire', responsable: 'emp7' }),
  ];
  const dues = relancesDues([unSuivi(p, taches)], undefined, {}, ctx);
  assert.deepEqual(dues.map((r) => r.relance), ['avancement']);
  const r = dues[0];
  assert.ok(r);
  assert.equal(r.vers, 'dedans', 'le message va à la personne qui tient l’étape');
  assert.equal(r.qui, 'emp7');
  assert.equal(r.etape, 'Charpente');
  assert.equal(r.jours, 4);
  assert.match(r.phrase, /en retard de 4/);
  // l'étape terminée n'est jamais relancée
  assert.equal(dues.some((x) => x.etape === 'Terrassement'), false);
});

// ------------------------------------------------------------------ les rythmes, bornés

test('le rythme est réglable, et borné : jamais une relance par jour, jamais dix-huit relances', () => {
  for (const r of RELANCES) assert.deepEqual(rythmeDe(undefined, r.id), r.defaut, `${r.id} : le rythme proposé`);
  const dur = lireRythme({ apresJours: -5, tousLesJours: 1, maxFois: 99 }, { apresJours: 3, tousLesJours: 14, maxFois: 3 });
  assert.equal(dur.apresJours, 0, 'jamais négatif');
  assert.equal(dur.tousLesJours, 2, 'au moins deux jours entre deux relances');
  assert.equal(dur.maxFois, 10, 'dix fois au plus');
  // une valeur illisible revient au rythme proposé, jamais une erreur
  assert.deepEqual(lireRythme('n’importe quoi', { apresJours: 3, tousLesJours: 14, maxFois: 3 }), { apresJours: 3, tousLesJours: 14, maxFois: 3 });
  assert.deepEqual(lireRythme({ apresJours: 'x' }, { apresJours: 9, tousLesJours: 9, maxFois: 2 }).apresJours, 9);
  // chaque sujet de suivi sait quelles relances le concernent
  assert.deepEqual(sujetsRelances('facture').map((r) => r.id), ['paiement']);
  assert.deepEqual(sujetsRelances('devis').map((r) => r.id), ['reponse']);
  assert.deepEqual(sujetsRelances('livraison').map((r) => r.id), ['reponse', 'avancement']);
  assert.deepEqual(sujetsRelances('papiers'), [], 'un papier qui expire ne se relance pas : il se renouvelle');
});

test('un rythme plus patient retarde la première relance, et l’entreprise décide seule', () => {
  const f = facture({ echeance: jour(-5), payee: false });
  assert.equal(relancesDues([unSuivi(f)], { paiement: { apresJours: 3, tousLesJours: 14, maxFois: 3 } }, {}, ctx).length, 1);
  assert.equal(relancesDues([unSuivi(f)], { paiement: { apresJours: 30, tousLesJours: 14, maxFois: 3 } }, {}, ctx).length, 0, 'patiente : rien encore');
});

// ------------------------------------------------------------------ les étapes décidées par l'entreprise

test('les modèles de départ viennent de l’UNIVERS, et un univers qui n’en déclare pas n’en propose pas', () => {
  const chantier = defSujet('chantier');
  assert.ok(chantier);
  const proposes = modelesUnivers(BTP, chantier);
  assert.ok(proposes.length >= 1, 'le BTP propose les étapes d’un chantier');
  assert.deepEqual(proposes[0]?.etapes.map((e) => e.libelle).slice(0, 3), ['Préparation', 'Terrassement', 'Gros œuvre']);
  assert.equal(proposes[0]?.origine, 'univers');
  // l'univers générique ne déclare pas d'étapes de projet : il ne propose rien, et tout marche comme avant
  assert.deepEqual(modelesUnivers(U, chantier), []);
  // un sujet à parcours propose son parcours : le mécanisme qui existait déjà, nommé
  const devisSujet = defSujet('devis');
  assert.ok(devisSujet);
  const pourDevis = modelesUnivers(U, devisSujet);
  assert.equal(pourDevis.length, 1);
  assert.deepEqual(pourDevis[0]?.etapes.map((e) => e.libelle), ['Brouillon', 'Envoyé', 'Accepté', 'Refusé']);
});

test('les étapes de l’entreprise remplacent celles de l’univers, et les tâches en trop restent visibles', () => {
  const modele: ModeleEtapes = {
    id: 'me-1', sujet: 'chantier', nom: 'Mes étapes', origine: 'entreprise',
    etapes: [
      { id: 'a', libelle: 'Charpente', fin: { de: 'tache' } },
      { id: 'b', libelle: 'Couverture', fin: { de: 'tache' } },
      { id: 'c', libelle: 'Réception', fin: { de: 'tache' } },
    ],
  };
  const taches = [
    tache('Charpente', { concerne: 'p1', echeance: jour(-6), statut: 'terminée' }),
    tache('couverture', { concerne: 'p1', echeance: jour(3), statut: 'à faire' }), // la casse ne compte pas
    tache('Nettoyer le dépôt', { concerne: 'p1', echeance: jour(1), statut: 'à faire' }),
  ];
  const s = unSuivi(projet({ echeance: jour(20) }), taches, modele);
  assert.deepEqual(s.etapes.map((e) => e.libelle), ['Charpente', 'Couverture', 'Réception', 'Échéance', 'Nettoyer le dépôt']);
  assert.equal(s.modele, 'me-1');
  assert.equal(s.etapes[0]?.faite, true, 'la tâche du même nom, terminée, termine l’étape');
  assert.equal(s.etapes[1]?.enCours, true, 'c’est là qu’en est le chantier');
  assert.equal(s.etapes[1]?.jour, jour(3), 'l’étape prend la date de sa tâche');
  assert.equal(s.etapes[2]?.declaree, true, 'une étape sans tâche reste annoncée : elle viendra');
  assert.equal(s.etapes[2]?.jour, null);
  assert.equal(s.termine, false);

  // une tâche qui ne correspond à aucune étape du modèle n'est pas perdue : elle reste une étape à elle
  assert.ok(s.etapes.some((e) => e.libelle === 'Nettoyer le dépôt' && e.id.startsWith('tache:')));
  // la tâche prise par le modèle ne compte pas deux fois
  assert.equal(s.etapes.filter((e) => e.libelle.toLocaleLowerCase('fr-FR') === 'charpente').length, 1);
});

test('les étapes d’une entreprise SURVIVENT à un changement d’univers', () => {
  const miennes = {
    id: 'me-2', sujet: 'chantier', nom: 'Mes étapes à moi',
    etapes: [{ id: 'a', libelle: 'Visite' }, { id: 'b', libelle: 'Pose' }, { id: 'c', libelle: 'Réglage' }],
  };
  // écrites sous un univers BTP…
  const sousBtp = lireModele(miennes, BTP);
  assert.ok(sousBtp);
  assert.deepEqual(sousBtp.etapes.map((e) => e.libelle), ['Visite', 'Pose', 'Réglage']);
  // …relues sous un univers qui renomme tout et retire des champs : les étapes sont toujours là, intactes
  const ailleurs = personnaliser(U, {
    id: 'ailleurs', nom: 'Ailleurs', version: 1, herite: 'generique',
    types: [{ id: 'projet', libelle: 'Dossier', pluriel: 'Dossiers' }],
  });
  const sousAilleurs = lireModele(miennes, ailleurs);
  assert.ok(sousAilleurs);
  assert.deepEqual(sousAilleurs.etapes, sousBtp.etapes, 'pas une étape perdue en changeant d’univers');
  // et elles s'appliquent : le suivi se lit avec le vocabulaire du NOUVEL univers et les étapes de L'ENTREPRISE
  const s = suiviDe(ailleurs, projet({ echeance: jour(10) }), ctx, { modele: { ...sousAilleurs, id: 'me-2' } });
  assert.ok(s);
  assert.equal(s.libelleSujet, 'Dossier');
  assert.deepEqual(s.etapes.map((e) => e.libelle).slice(0, 3), ['Visite', 'Pose', 'Réglage']);

  // une étape attachée à une valeur de parcours que le nouvel univers ne déclare plus redevient une étape à cocher
  const surParcours = lireModele({
    id: 'me-3', sujet: 'devis', nom: 'Mon parcours',
    etapes: [{ id: 'a', libelle: 'Parti', fin: { de: 'parcours', valeur: 'envoyé' } }, { id: 'b', libelle: 'Plus là', fin: { de: 'parcours', valeur: 'inventé' } }],
  }, U);
  assert.ok(surParcours);
  assert.deepEqual(surParcours.etapes.map((e) => e.fin.de), ['parcours', 'tache'], 'ce qui n’existe plus ne casse rien');
});

test('un modèle illisible est écarté plutôt qu’enregistré à moitié', () => {
  assert.equal(lireModele(null, BTP), null);
  assert.equal(lireModele({ sujet: 'chantier', nom: '', etapes: [{ libelle: 'A' }] }, BTP), null, 'sans nom');
  assert.equal(lireModele({ sujet: 'inventé', nom: 'X', etapes: [{ libelle: 'A' }] }, BTP), null, 'sujet inconnu');
  assert.equal(lireModele({ sujet: 'chantier', nom: 'X', etapes: [] }, BTP), null, 'sans étape');
  assert.equal(lireModele({ sujet: 'chantier', nom: 'X', etapes: [{ libelle: '  ' }, { libelle: 'Bonne' }] }, BTP)?.etapes.length, 1);
});

// ------------------------------------------------------------------ le garde-fou de conception

test('une entreprise qui ne règle RIEN retrouve exactement ce qu’elle avait avant', () => {
  const monde = [
    facture({ echeance: jour(-6), payee: false }),
    devis({ statut: 'envoyé' }, 'd1', 2),
    projet({ echeance: jour(4) }),
  ];
  // aucun modèle, aucun rythme, aucun réglage : les étapes et l'ordre sont ceux de l'univers
  const sansRien = suivis(BTP, monde, ctx);
  const avecResolveurVide = suivis(BTP, monde, ctx, { modele: () => null });
  assert.deepEqual(JSON.stringify(sansRien), JSON.stringify(avecResolveurVide), 'pas un octet de différence');
  // et les relances se préparent quand même, au rythme proposé : rien à régler pour en profiter
  const dues = relancesDues(sansRien, undefined, {}, ctx);
  assert.deepEqual(dues.map((r) => r.relance).sort(), ['paiement']);
  assert.equal(dues[0]?.fois, 1);
});

// ------------------------------------------------------------------ le partage, et ses mots

test('le message de partage se vouvoie, ne parle pas d’argent, et dit ce que le lien montre', () => {
  assert.deepEqual([...DESTINATAIRES], ['client', 'fournisseur', 'comptable']);
  for (const pour of DESTINATAIRES) {
    const t = messagePartage(pour, 'Toiture Le Goff (démo)', 'https://chez-moi.exemple.fr/s/abc', { entreprise: 'Charpente Kerlann' });
    assert.match(t.objet, /Toiture Le Goff/);
    assert.equal(t.objet.includes('démo'), false, 'la mention de démonstration ne part pas chez un tiers');
    assert.match(t.message, /^Bonjour,/);
    assert.match(t.message, /https:\/\/chez-moi\.exemple\.fr\/s\/abc/);
    assert.match(t.message, /ne montre que ce suivi/);
    assert.match(t.message, /Charpente Kerlann$/);
    assert.equal(/\btu\b|\bton\b|montant|marge|prix/i.test(t.message), false, 'vouvoiement, et pas un mot d’argent');
    assert.ok(defPartage(pour).libelle.startsWith('À mon '));
  }
  // sans adresse publique, le message le dit plutôt que de laisser un trou
  assert.match(messagePartage('client', 'X', null).message, /copiez-la ici avant d’envoyer/);
  assert.equal(estDestinatairePartage('client'), true);
  assert.equal(estDestinatairePartage('n’importe qui'), false);
  assert.equal(defPartage('n’importe qui').libelle, 'À mon client', 'un destinataire inconnu retombe sur le client');
});
