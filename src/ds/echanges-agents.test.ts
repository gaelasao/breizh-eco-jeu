/**
 * Onglet Breizhcosystem, échanges entre agents de deux entreprises : « Demander un prix » sur un résultat de l'agent et
 * la liste « Échanges en cours ».
 * - web/reseau.js (module pur) : l'état dit en clair, les chiffres, la suite pour la personne, pour chaque statut connu et
 *   pour un échange d'un genre plus récent que cette version ;
 * - web/app.js (lu comme un texte, sans navigateur) : l'écran demande et suit, il ne valide jamais ; pour valider ou
 *   répondre, il ouvre la page de Breizhcosystem.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { STATUTS_ECHANGE, type Echange } from '../passerelle/lien-nexus.ts';

interface Presentation { ton: string | null; etat: string; chiffres: string | null; detail: string | null; suite: string | null; action: string | null; libelleAction: string | null }
const R = (await import(new URL('../../web/reseau.js', import.meta.url).href)) as {
  presenterEchange: (e: unknown) => Presentation; chiffresEchange: (e: unknown) => string | null; sensEchange: (e: unknown) => string;
  rangerEchanges: (l: unknown, o?: { termines?: number }) => { aFaire: Echange[]; enAttente: Echange[]; termines: Echange[] };
  annonceDemandePrix: (e: unknown, vendeur?: string | null) => [string, string];
};
const app = readFileSync(fileURLToPath(new URL('../../web/app.js', import.meta.url)), 'utf8');
const module = readFileSync(fileURLToPath(new URL('../../web/reseau.js', import.meta.url)), 'utf8');
/** Les sorties d'Intl peuvent changer d'espace selon la version d'ICU : on les normalise avant de comparer. */
const espaces = (t: string | null) => (t ?? '').replace(/[  ]/g, ' ');

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const echange = (o: Partial<Echange> = {}): Echange => ({
  id: ID(1), cote: 'acheteur', statut: 'attente_vendeur', avancement: 'attend_personne', attend: 'autre', titre: 'Plateaux de chêne 27 mm', stockId: ID(11),
  quantite: 4, prixSouhaite: 38, proposition: null, commande: null, message: null, majLe: '2026-11-12T09:00:00.000Z', ...o,
});
const PROPOSITION = { quantite: 4, prixUnitaire: 38, total: 152, valableJusquau: '2026-11-17T09:00:00.000Z', par: 'regle' as const };

test('échange en clair, côté acheteur : attendre le vendeur, puis valider sur Breizhcosystem (jamais dans Living Business), puis suivre la commande', () => {
  const attente = R.presenterEchange(echange());
  assert.deepEqual([attente.ton, attente.etat, attente.action], [null, 'En attente du vendeur', null]);
  assert.match(String(attente.suite), /^Rien à faire pour l’instant : une personne de chez le vendeur doit répondre/);
  assert.equal(espaces(attente.chiffres), 'Quantité demandée : 4, prix souhaité : 38,00 € HT l’unité');

  const proposee = R.presenterEchange(echange({ statut: 'proposee', attend: 'vous', proposition: PROPOSITION }));
  assert.deepEqual([proposee.ton, proposee.etat, proposee.action, proposee.libelleAction], ['attention', 'Prix proposé : à vous de valider', 'valider', 'Valider sur Breizhcosystem']);
  assert.equal(espaces(proposee.chiffres), '4 × 38,00 € HT = 152,00 € HT, valable jusqu’au 17 novembre');
  assert.match(String(proposee.suite), /n’engage personne/);
  assert.match(String(proposee.suite), /une personne de votre entreprise la valide sur Breizhcosystem, connectée/);
  assert.match(String(proposee.suite), /Living Business ne le fait pas à sa place/);
  assert.match(String(proposee.suite), /Le vendeur confirmera ensuite/);
  assert.match(espaces(R.chiffresEchange(echange({ statut: 'proposee', proposition: { ...PROPOSITION, valableJusquau: '2026-11-30T23:30:00.000Z' } }))), /valable jusqu’au 1er décembre$/, 'date à l’heure de Paris, « 1er »');
  // le vendeur propose ce qui lui reste : la quantité qui serait validée est dite, à côté de celle demandée
  assert.equal(espaces(R.chiffresEchange(echange({ statut: 'proposee', quantite: 10, proposition: { ...PROPOSITION, quantite: 6, total: 228 } }))), '6 × 38,00 € HT = 228,00 € HT (6 sur les 10 demandés), valable jusqu’au 17 novembre');

  const validee = R.presenterEchange(echange({ statut: 'acceptee', avancement: 'conclu', attend: null, proposition: PROPOSITION, commande: { reference: 'NX-7K2Q9A', statut: 'validee' } }));
  assert.deepEqual([validee.ton, validee.etat, validee.action], ['ok', 'Validée : commande créée', null]);
  assert.equal(validee.suite, 'Le vendeur doit encore confirmer la commande NX-7K2Q9A. Suivez-la dans « Commandes », plus bas.');
  assert.equal(espaces(validee.chiffres), '4 × 38,00 € HT = 152,00 € HT', 'plus de date de validité une fois validée');
  assert.equal(R.presenterEchange(echange({ statut: 'acceptee', avancement: 'conclu', attend: null, commande: { reference: null, statut: 'confirmee' } })).suite, 'Suivez la commande dans « Commandes », plus bas.');

  assert.match(String(R.presenterEchange(echange({ statut: 'expiree', avancement: 'arrete', attend: null, proposition: PROPOSITION })).suite), /pas été validée à temps/);
  assert.match(String(R.presenterEchange(echange({ statut: 'expiree', avancement: 'arrete', attend: null })).suite), /restée sans réponse/);
  assert.deepEqual(['refusee_vendeur', 'refusee_acheteur', 'annulee'].map((statut) => R.presenterEchange(echange({ statut: statut as Echange['statut'], avancement: 'arrete', attend: null })).etat), ['Sans suite du vendeur', 'Refusée par vous', 'Annulée par vous']);
});

test('échange en clair, côté vendeur : répondre sur Breizhcosystem, attendre l’acheteur, puis confirmer la commande dans « Commandes »', () => {
  const recue = R.presenterEchange(echange({ cote: 'vendeur', attend: 'vous' }));
  assert.deepEqual([recue.ton, recue.etat, recue.action, recue.libelleAction], ['attention', 'Demande de prix reçue : à vous de répondre', 'repondre', 'Répondre sur Breizhcosystem']);
  assert.match(String(recue.suite), /Une personne de votre entreprise lui répond sur Breizhcosystem, connectée\. Living Business ne le fait pas à sa place\./);
  const envoyee = R.presenterEchange(echange({ cote: 'vendeur', statut: 'proposee', attend: 'autre', proposition: PROPOSITION }));
  assert.deepEqual([envoyee.ton, envoyee.etat, envoyee.action], [null, 'Proposition envoyée : en attente de l’acheteur', null]);
  const aConfirmer = R.presenterEchange(echange({ cote: 'vendeur', statut: 'acceptee', avancement: 'conclu', attend: null, commande: { reference: 'NX-7K2Q9A', statut: 'validee' } }));
  assert.deepEqual([aConfirmer.ton, aConfirmer.etat, aConfirmer.suite], ['attention', 'Validée par l’acheteur : commande à confirmer', 'Confirmez ou refusez la commande NX-7K2Q9A dans « Commandes », plus bas.']);
  const confirmee = R.presenterEchange(echange({ cote: 'vendeur', statut: 'acceptee', avancement: 'conclu', attend: null, commande: { reference: 'NX-7K2Q9A', statut: 'payee' } }));
  assert.deepEqual([confirmee.ton, confirmee.etat], ['ok', 'Validée par l’acheteur : commande créée']);
  assert.deepEqual([R.sensEchange(echange()), R.sensEchange(echange({ cote: 'vendeur' })), R.sensEchange(echange({ cote: null }))], ['Achat', 'Vente', 'Échange']);
});

test('chaque statut connu du lien réseau a ses mots, des deux côtés ; un échange plus récent que cette version reste lisible et renvoie vers Breizhcosystem', () => {
  for (const statut of STATUTS_ECHANGE) {
    for (const cote of ['acheteur', 'vendeur'] as const) {
      const p = R.presenterEchange(echange({ statut, cote }));
      assert.ok(p.etat.length > 3 && p.detail === null, `${statut} ${cote}`);
      assert.ok(!/[a-z]_[a-z]/.test(p.etat + (p.suite ?? '')), `${statut} ${cote} : jamais un mot de programme`);
    }
  }
  // genre ou statut inconnu : l'avancement de la tâche situe l'échange, la phrase du réseau est montrée, la suite est sur le réseau
  const inconnu = (o: Partial<Echange>) => R.presenterEchange(echange({ statut: null, stockId: null, quantite: null, prixSouhaite: null, message: 'Contre-proposition du vendeur.', ...o }));
  const aVoir = inconnu({ attend: 'vous' });
  assert.deepEqual([aVoir.ton, aVoir.etat, aVoir.detail, aVoir.action, aVoir.libelleAction, aVoir.chiffres], ['attention', 'À voir par vous sur Breizhcosystem', 'Contre-proposition du vendeur.', 'voir', 'Voir sur Breizhcosystem', null]);
  assert.match(String(aVoir.suite), /plus récent que votre Living Business : ouvrez-le sur Breizhcosystem/);
  assert.deepEqual([inconnu({ attend: 'autre' }).etat, inconnu({ attend: null }).etat, inconnu({ avancement: 'en_cours', attend: null }).etat], ['En attente de l’autre entreprise', 'En attente d’une décision', 'En cours']);
  assert.deepEqual((['conclu', 'refuse', 'arrete'] as const).map((avancement) => { const p = inconnu({ avancement, attend: null }); return [p.ton, p.etat, p.suite, p.action]; }),
    [['ok', 'Conclu', null, null], [null, 'Refusé', null, null], [null, 'Arrêté', null, null]]);
  // statut connu sans côté, objet vide ou illisible : jamais d'erreur, toujours un état
  for (const e of [echange({ cote: null }), {}, null, { avancement: 'autre chose' }]) assert.ok(R.presenterEchange(e).etat.length > 3);
});

test('liste courte : ce qui attend l’entreprise, puis ce qui attend l’autre, puis les 5 derniers terminés ; annonce après une demande', () => {
  const l = [
    echange({ id: ID(1), statut: 'acceptee', avancement: 'conclu', attend: null }),
    echange({ id: ID(2) }),
    echange({ id: ID(3), statut: 'proposee', attend: 'vous', proposition: PROPOSITION }),
    echange({ id: ID(4), statut: null, avancement: 'en_cours', attend: null }),
    ...Array.from({ length: 8 }, (_, i) => echange({ id: ID(10 + i), statut: 'annulee', avancement: 'arrete', attend: null })),
  ];
  const g = R.rangerEchanges(l);
  assert.deepEqual([g.aFaire.map((e) => e.id), g.enAttente.map((e) => e.id), g.termines.map((e) => e.id)], [[ID(3)], [ID(2), ID(4)], [ID(1), ID(10), ID(11), ID(12), ID(13)]]);
  assert.deepEqual(R.rangerEchanges(null), { aFaire: [], enAttente: [], termines: [] });
  assert.equal(R.rangerEchanges([null, 'x', {}, echange()]).enAttente.length, 1);

  const [repondu, ton] = R.annonceDemandePrix(echange({ statut: 'proposee', attend: 'vous', proposition: PROPOSITION }), 'Scierie de l’Aulne');
  assert.equal(espaces(repondu), 'Scierie de l’Aulne a répondu aussitôt : 4 × 38,00 € HT = 152,00 € HT, valable jusqu’au 17 novembre. Sa proposition n’engage personne : la suite est dans « Échanges en cours ».');
  assert.equal(ton, 'attention');
  assert.deepEqual(R.annonceDemandePrix(echange(), 'Scierie de l’Aulne'), ['Demande envoyée à Scierie de l’Aulne. Une personne de cette entreprise doit répondre : sa réponse arrivera dans « Échanges en cours ».', 'ok']);
  assert.deepEqual(R.annonceDemandePrix(echange({ statut: null, avancement: 'en_cours' }), null), ['Demande envoyée au vendeur : suivez-la dans « Échanges en cours ».', 'ok']);
});

test('écran : « Demander un prix » sur un stock trouvé par l’agent, « Échanges en cours » à côté ; l’écran ne valide jamais, il ouvre la page de Breizhcosystem', () => {
  const debut = app.indexOf('// ----- échanges entre agents : demander un prix n\'engage à rien');
  const bloc = app.slice(debut, app.indexOf('function contacterMembre(p) {'));
  assert.ok(debut > 0 && bloc.length > 3000);
  // le bouton : sur un stock seulement (ce que le réseau accepte), à côté de « Commander… », jamais en bouton principal
  const resultats = app.slice(app.indexOf('function resultatsAgent(P) {'), app.indexOf('function commanderProposition(p) {'));
  assert.match(resultats, /p\.type === 'stock' && EA\.erreur\?\.code !== 'echanges_indisponibles' \? h\('button', \{ type: 'button', class: 'bz-bouton bz-bouton--secondaire bz-bouton--sm', onclick: \(\) => demanderPrixProposition\(p\) \}, icone\('tag', \{ taille: 'sm' \}\), 'Demander un prix'\)/);
  // la section : entre la demande à l'agent et les mandats, chargée à part (une panne des échanges ne cache ni les mandats ni les commandes)
  const agents = app.slice(app.indexOf('async function rendreAgents(N = NEXUS_ETAT) {'), app.indexOf('// ----- « Demander à l\'agent »'));
  const demande = agents.indexOf("id: 'demande-agent'");
  const echanges = agents.indexOf("id: 'echanges-agents'");
  const colonnes = agents.indexOf('blocMandats(mandats), blocCommandes(commandes)');
  assert.ok(demande > 0 && demande < echanges && echanges < colonnes);
  assert.match(agents, /rendreDemandeAgent\(\);\n\s+rendreEchangesAgents\(\);/);
  assert.match(bloc, /EA\.reponse = await api\('GET', '\/nexus\/echanges'\)/);
  assert.match(bloc, /texte: 'Échanges en cours'/);
  // demander : la seule écriture de l'écran sur les échanges, avec une clé par demande, changée quand la saisie change
  const ecritures = [...app.matchAll(/api\('(POST|PUT|DELETE)', [`'](\/nexus\/echanges[^`',]*)/g)].map((m) => `${m[1]} ${m[2]}`);
  assert.deepEqual(ecritures, ['POST /nexus/echanges'], 'aucune route pour valider, répondre ou refuser');
  assert.match(bloc, /api\('POST', '\/nexus\/echanges', \{ stockId: p\.id, quantite: S\.quantite, cle: S\.cle,/);
  assert.equal(bloc.match(/S\.cle = cle\(\)/g)?.length, 2, 'quantité ou prix modifié : c’est une autre demande');
  assert.match(bloc, /Rien n’est commandé : cette demande ne vous engage à rien\./);
  // valider ou répondre : un lien vers la page du réseau (nouvel onglet), principal seulement quand c'est à l'entreprise d'agir
  assert.match(bloc, /p\.action && page \? h\('div', \{ class: 'bz-groupe-boutons' \}, lienExterne\(page, p\.libelleAction, `bz-bouton \$\{e\.attend === 'vous' \? 'bz-bouton--principal' : 'bz-bouton--secondaire'\} bz-bouton--sm`\)\)/);
  assert.match(bloc, /const page = typeof r\?\.page === 'string' && \/\^https\?:\\\/\\\/\/\.test\(r\.page\) \? r\.page : null;/, 'adresse donnée par la passerelle, http(s) seulement');
  assert.doesNotMatch(bloc, /innerHTML|window\.open|location\./);
  // textes : état, chiffres, phrase du réseau et suite viennent du module pur ; rien n'est dit « validé » par l'écran
  for (const champ of ['p.etat', 'p.chiffres', 'p.detail', 'p.suite', 'RESEAU.sensEchange(e)', 'RESEAU.rangerEchanges(r?.echanges)', 'RESEAU.annonceDemandePrix(r.echange, p.organisation)']) assert.ok(bloc.includes(champ), champ);
  assert.match(bloc, /Aucun échange pour l’instant\./, 'état vide');
  assert.match(bloc, /enCours\.length \? liste\(enCours\) : h\('p', \{ class: 'bz-t-petit bz-texte-2', texte: 'Aucun échange en cours\.' \}\)/);
  assert.match(bloc, /g\.termines\.length \? \[h\('h4', \{ class: 'bz-t-label', texte: 'Terminés récemment' \}\), liste\(g\.termines\)\] : null/, 'les échanges terminés sont à part de ceux qui sont en cours');
  assert.match(bloc, /Les échanges n’ont pas pu être chargés\./);
  // dans le dialogue, un seul bouton principal : l'envoi
  const principaux = bloc.split('\n').filter((ligne) => ligne.includes("'bz-bouton bz-bouton--principal'"));
  assert.equal(principaux.length, 1);
  assert.ok(principaux[0]?.includes("type: 'submit'") && principaux[0].includes('Envoyer la demande'));
  // classes : seulement celles du système de design, déjà servies
  const css = readFileSync(fileURLToPath(new URL('../../web/bz/bz.css', import.meta.url)), 'utf8');
  for (const classe of new Set([...bloc.matchAll(/\bbz-[a-z0-9_-]+/g)].map((m) => m[0]))) {
    if (classe === 'bz-lien' || classe === 'bz-bouton--') continue; // repère sans règle propre, déjà posé sur les liens voisins ; début d'une classe composée
    assert.ok(css.includes(`.${classe}`), `classe inconnue du système de design : ${classe}`);
  }
  // l'ancien nom du réseau n'apparaît dans aucun texte (il ne reste que dans l'adresse des routes du jeu)
  for (const texte of [bloc, module.slice(module.indexOf('échanges entre agents de deux entreprises'))]) assert.doesNotMatch(texte.replaceAll("'/nexus/echanges'", ''), /nexus/i);
});
